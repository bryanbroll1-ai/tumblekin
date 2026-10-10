// Mitspielen ohne Server: das Handy, das die Party startet, ist der Server.
//
// Der Spielserver läuft in dieser Fassung ohnehin im Fenster (siehe boot.js).
// Gäste schicken ihre Ereignisse an das Fenster des Hosts statt an ihr
// eigenes — über zwei Wege, die die claude.ai-Raumfunktion bereitstellt:
//
// - Direkt per WebRTC. Angebot und Antwort laufen über den Raum, danach geht
//   jedes Ereignis Gerät zu Gerät, ohne Umweg und ohne Mengenbegrenzung.
// - Über den Raum selbst, solange die Direktverbindung nicht steht (oder nie
//   zustande kommt). Der Host bündelt alle 80 ms, was an einen Gast geht,
//   behält von Raumzustand und Minispielstand nur den neuesten (beide sind
//   vollständig, nicht schrittweise), packt es und schickt es in Stücken
//   unter 4 KiB. Gäste melden ihre Eingaben über ihre Präsenz: ein Protokoll
//   der letzten Nachrichten mit laufender Nummer. Präsenz darf jeder setzen,
//   Ereignisse nur, wer mitwirken darf — so können auch Gäste mitspielen,
//   die das Artifact nur ansehen dürfen.
//
// Alles, was von anderen Geräten kommt, ist ungeprüfte Eingabe: der Server
// des Hosts prüft jede Aktion ohnehin, und Namen werden nur als Text gesetzt.
import QRCode from "qrcode/lib/browser.js";

const PROTOCOL = 1;
const ROOM_PREFIX = "tk-";
const FLUSH_MS = 80;
const CHUNK = 3600;
const EMIT_BUDGET = 28;           // je Sekunde; die Plattform erlaubt etwa 40
const PRESENCE_BUDGET = 3500;
const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const LATEST_ONLY = new Set(["state", "minigameUpdate"]);
const LEAVE_GRACE_MS = 8000;
const STATE_REPEAT_MS = 2000;

// ---------------------------------------------------------------- Helfer ---

let roomPromise = null;
function roomCapability() {
  if (!roomPromise) {
    roomPromise = Promise.resolve(window.claude?.use?.("room") ?? null).catch(() => null);
  }
  return roomPromise;
}

const roomName = (code) => ROOM_PREFIX + String(code).toLowerCase();
const normalizeCode = (code) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
const nonce = () => Math.random().toString(36).slice(2, 10);

function bytesToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

async function pack(text) {
  if (typeof CompressionStream === "undefined") return "r" + btoa(unescape(encodeURIComponent(text)));
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return "z" + bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function unpack(data) {
  const raw = atob(data.slice(1));
  if (data[0] === "r") return decodeURIComponent(escape(raw));
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function gathered(pc, ms = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(timer); resolve(); };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    const timer = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function waitFor(test, ms) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const value = test();
      if (value || Date.now() - started > ms) return resolve(value || null);
      setTimeout(tick, 100);
    };
    tick();
  });
}

const status = { room: undefined, hosting: null, guestOf: null, error: null };
const listeners = new Set();
function changed() { listeners.forEach((fn) => fn(status)); }

// ------------------------------------------------------------------ Host ---

// Ein Gast aus Sicht des Hosts: eine eigene Verbindung zum Spielserver im
// Fenster, als wäre er ein weiteres Gerät im WLAN.
class GuestLink {
  constructor(host, peer) {
    this.host = host;
    this.peer = peer;
    this.lastUp = 0;
    this.upReported = 0;
    this.upRepeats = 0;
    this.queue = [];
    this.acks = [];
    this.lastState = null;
    this.lastStateAt = 0;
    this.dc = null;
    this.pc = null;
    this.offerNonce = null;
    this.socket = globalThis.__tumblekinServer.accept(this);
  }
  get direct() { return this.dc?.readyState === "open"; }
  // Vom Spielserver: Ereignis an diesen Gast.
  deliver(event, args) { this.send(["e", event, args]); }
  send(message) {
    if (this.direct) {
      try { this.dc.send(JSON.stringify(message)); return; } catch { this.dc = null; }
    }
    // Antworten gehen über den Raum dreimal: ein Ereignis dort kann
    // verloren gehen, und ohne Antwort wartet die Oberfläche vergeblich.
    if (message[0] === "a") this.acks.push({ message, left: 3 });
    else this.queue.push(message);
  }
  handle(message) {
    if (!Array.isArray(message)) return;
    const [kind, a, b, c] = message;
    if (kind === "q" && typeof b === "string") {
      this.socket.receive(b, [c, (...response) => this.send(["a", a, response])]);
    } else if (kind === "m" && typeof a === "string") {
      this.socket.receive(a, [b]);
    }
  }
  // Was im nächsten Bündel für alle Gäste gleich ist: Ereignisse. Von
  // Raumzustand und Minispielstand zählt nur der neueste; der Raumzustand
  // kommt alle zwei Sekunden erneut, falls ein Bündel verloren ging.
  takeQueue() {
    const seen = new Set();
    const kept = [];
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      const m = this.queue[i];
      if (m[0] === "e" && LATEST_ONLY.has(m[1])) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        if (m[1] === "state") { this.lastState = m; this.lastStateAt = Date.now(); }
      }
      kept.push(m);
    }
    this.queue = [];
    if (!seen.has("state") && this.lastState && Date.now() - this.lastStateAt > STATE_REPEAT_MS) {
      kept.push(this.lastState);
      this.lastStateAt = Date.now();
    }
    return kept.reverse();
  }
  // Was nur diesem Gast gilt: Antworten und bis wohin seine Nachrichten
  // gelesen sind (damit er sein Protokoll kürzen kann).
  takeExtras() {
    const out = this.acks.map((entry) => entry.message);
    this.acks.forEach((entry) => { entry.left -= 1; });
    this.acks = this.acks.filter((entry) => entry.left > 0);
    if (this.lastUp !== this.upReported) { this.upReported = this.lastUp; this.upRepeats = 3; }
    if (this.upRepeats > 0) { out.push(["u", this.lastUp]); this.upRepeats -= 1; }
    return out;
  }
  hasPending() {
    return this.queue.length > 0 || this.acks.length > 0 || this.lastUp !== this.upReported || this.upRepeats > 0
      || Boolean(this.lastState && Date.now() - this.lastStateAt > STATE_REPEAT_MS);
  }
  async answer(offer) {
    if (!window.RTCPeerConnection || offer.n === this.offerNonce) return;
    this.offerNonce = offer.n;
    try {
      this.pc?.close();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;
      pc.ondatachannel = ({ channel }) => {
        const open = () => {
          this.dc = channel;
          // Was noch für den Raum gesammelt war, geht jetzt direkt.
          for (const m of [...this.takeExtras().filter((m) => m[0] === "a"), ...this.takeQueue()]) this.send(m);
        };
        // Der Kanal kann beim Eintreffen schon offen sein.
        if (channel.readyState === "open") open();
        else channel.onopen = open;
        channel.onmessage = ({ data }) => { try { this.handle(JSON.parse(data)); } catch { /* ungültig */ } };
        channel.onclose = () => { if (this.dc === channel) this.dc = null; };
      };
      await pc.setRemoteDescription({ type: "offer", sdp: await unpack(offer.z) });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      await this.host.room.emit("sig", { to: this.peer, n: offer.n, z: await pack(pc.localDescription.sdp) });
    } catch { /* bleibt beim Raum */ }
  }
  close() {
    this.closed = true;
    try { this.dc?.close(); this.pc?.close(); } catch { /* egal */ }
    this.socket.receive("disconnect", ["transport close"]);
  }
}

class Host {
  constructor(code) {
    this.code = code;
    this.guests = new Map();
    this.messageId = 0;
    this.lobbyInfo = null;
  }
  async start() {
    const lobby = await roomCapability();
    if (!lobby) return false;
    this.lobby = lobby;
    try {
      this.room = await lobby.join(roomName(this.code));
    } catch {
      return false;
    }
    if (this.stopped) { this.room.leave(); return false; }
    await this.room.presence({ host: PROTOCOL, code: this.code }).catch(() => {});
    this.offPeers = this.room.onPeers((change) => this.onPeers(change));
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.onVisible = () => { if (document.visibilityState === "visible") this.keepAwake(this.guests.size > 0); };
    document.addEventListener("visibilitychange", this.onVisible);
    return true;
  }
  // Solange Gäste da sind, soll das Handy des Hosts nicht einschlafen —
  // ohne sein Fenster steht das Spiel für alle.
  async keepAwake(on) {
    try {
      if (on && !this.wakeLock && navigator.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener?.("release", () => { this.wakeLock = null; });
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch { /* nicht erlaubt: dann eben nicht */ }
  }
  onPeers(change) {
    setTimeout(() => this.keepAwake(this.guests.size > 0), 0);
    // Kurze Aussetzer erneuert die Plattform von selbst; erst wer acht
    // Sekunden weg bleibt, gilt als gegangen.
    for (const peer of change.left) {
      const link = this.guests.get(peer.peer);
      if (link && !link.leaving) {
        link.leaving = setTimeout(() => {
          if (this.guests.get(peer.peer) !== link) return;
          link.close();
          this.guests.delete(peer.peer);
        }, LEAVE_GRACE_MS);
      }
    }
    for (const peer of change.peers) {
      const back = this.guests.get(peer.peer);
      if (back?.leaving) { clearTimeout(back.leaving); back.leaving = null; }
    }
    for (const peer of change.peers) {
      const p = peer.presence || {};
      if (peer.sameTab || p.guest !== PROTOCOL || p.to !== this.code) continue;
      let link = this.guests.get(peer.peer);
      if (!link) { link = new GuestLink(this, peer.peer); this.guests.set(peer.peer, link); }
      if (p.offer && typeof p.offer.z === "string") link.answer(p.offer);
      if (Array.isArray(p.up)) {
        for (const entry of p.up) {
          if (!Array.isArray(entry) || typeof entry[0] !== "number" || entry[0] <= link.lastUp) continue;
          link.lastUp = entry[0];
          try { link.handle(JSON.parse(entry[1])); } catch { /* ungültig */ }
        }
      }
    }
  }
  async flush() {
    if (this.flushing) return;
    // Über dem Budget wartet das Bündel eine Runde; vom Spielstand zählt
    // ohnehin nur der neueste.
    const now = Date.now();
    this.sent = (this.sent || []).filter((t) => now - t < 1000);
    if (this.sent.length >= EMIT_BUDGET) return;
    this.flushing = true;
    try {
      // Gleiche Ereignisse für mehrere Gäste gehen nur einmal in den Raum;
      // was nur einem gilt (Antworten, Lesestand), reist im selben Bündel
      // unter seinem Namen mit. Alles zusammen gepackt und in Stücken.
      const groups = new Map();
      for (const [peer, link] of this.guests) {
        if (link.direct || !link.hasPending()) continue;
        const events = link.takeQueue();
        const key = JSON.stringify(events);
        if (!groups.has(key)) groups.set(key, { peers: [], events, extras: {} });
        const group = groups.get(key);
        group.peers.push(peer);
        const extras = link.takeExtras();
        if (extras.length) group.extras[peer] = extras;
      }
      for (const group of groups.values()) {
        const data = await pack(JSON.stringify({ e: group.events, x: group.extras }));
        const k = ++this.messageId;
        const n = Math.ceil(data.length / CHUNK);
        for (let i = 0; i < n; i += 1) {
          this.sent.push(Date.now());
          this.room.emit("dn", { to: group.peers, k, i, n, d: data.slice(i * CHUNK, (i + 1) * CHUNK) }).catch((error) => {
            if (error?.code === "not_permitted") { status.error = "not_permitted"; changed(); }
          });
        }
      }
    } finally {
      this.flushing = false;
    }
  }
  // In der Lobby zeigen, dass hier eine Party offen ist.
  advertise(info) {
    const text = JSON.stringify(info);
    if (!this.lobby || text === this.lobbyInfo) return;
    this.lobbyInfo = text;
    this.lobby.presence({ party: info }).catch(() => {});
  }
  stop() {
    this.stopped = true;
    this.keepAwake(false);
    document.removeEventListener("visibilitychange", this.onVisible);
    clearInterval(this.timer);
    this.offPeers?.();
    for (const link of this.guests.values()) link.close();
    this.guests.clear();
    this.room?.leave().catch(() => {});
    this.lobby?.presence({ party: null }).catch(() => {});
  }
}

// ----------------------------------------------------------------- Gast ---

// Aus Sicht der Oberfläche des Gastes: die Gegenstelle, an die sein
// ClientSocket Ereignisse reicht — wie sonst an den Server im Fenster.
class HostLink {
  constructor(code) {
    this.code = code;
    this.id = "remote-" + nonce();
    this.remoteHost = true;
    this.pending = new Map();
    this.requestId = 0;
    this.seq = 0;
    this.upLog = [];
    this.parts = new Map();
    this.dc = null;
    this.offer = null;
  }
  async connect(client) {
    this.client = client;
    const lobby = await roomCapability();
    if (!lobby) throw new Error("Mitspielen geht nur in der claude.ai-Ansicht dieses Artifacts.");
    this.room = await lobby.join(roomName(this.code));
    const host = await waitFor(() => this.room.peers().find((p) => !p.sameTab && p.presence?.host === PROTOCOL && p.presence?.code === this.code), 5000);
    this.me = this.room.peers().find((p) => p.sameTab)?.peer;
    if (!host || !this.me) {
      this.room.leave().catch(() => {});
      throw new Error("Diesen Raum gibt es nicht. Stimmt der Code, und ist das Handy des Hosts noch offen?");
    }
    this.hostPeer = host.peer;
    this.room.on("dn", (msg) => this.onDown(msg));
    this.room.on("sig", (msg) => this.onSignal(msg));
    this.offPeers = this.room.onPeers((change) => {
      const here = change.peers.some((p) => p.peer === this.hostPeer && !change.left.includes(p));
      if (here) { clearTimeout(this.leaving); this.leaving = null; return; }
      if (!this.leaving && change.left.some((p) => p.peer === this.hostPeer)) {
        this.leaving = setTimeout(() => this.lost(), LEAVE_GRACE_MS);
      }
    });
    await this.publish();
    this.startRtc();
  }
  // ClientSocket → Host.
  receive(event, args) {
    const last = args[args.length - 1];
    if (typeof last === "function") {
      const id = ++this.requestId;
      this.pending.set(id, last);
      this.send(["q", id, event, args[0]]);
    } else {
      this.send(["m", event, args[0]]);
    }
  }
  send(message) {
    if (this.dc?.readyState === "open") {
      try { this.dc.send(JSON.stringify(message)); return; } catch { this.dc = null; }
    }
    this.upLog.push([++this.seq, JSON.stringify(message)]);
    this.publish();
  }
  publish() {
    // Das Protokoll hält die letzten Nachrichten, solange es in die Präsenz
    // passt; der Host liest nur, was neuer ist als das zuletzt Gelesene.
    const body = () => ({ guest: PROTOCOL, to: this.code, offer: this.offer, up: this.upLog });
    while (this.upLog.length > 1 && JSON.stringify(body()).length > PRESENCE_BUDGET) this.upLog.shift();
    // Ein zu grosses Angebot verdrängte sonst die Eingaben — dann eben ohne
    // Direktverbindung.
    if (this.offer && JSON.stringify(body()).length > PRESENCE_BUDGET) this.offer = null;
    return this.room?.presence(body()).catch(() => {});
  }
  handle(message) {
    if (!Array.isArray(message)) return;
    if (message[0] === "e" && typeof message[1] === "string" && Array.isArray(message[2])) {
      this.client?.deliver(message[1], message[2]);
      // Der Host hat seine Party beendet: zurück zum eigenen Server.
      if (message[1] === "roomClosed") setTimeout(() => this.onClosed?.(), 0);
    } else if (message[0] === "u" && typeof message[1] === "number") {
      // Der Host hat bis hierher gelesen: das Protokoll darf kürzer werden.
      const before = this.upLog.length;
      this.upLog = this.upLog.filter((entry) => entry[0] > message[1]);
      if (this.upLog.length !== before) this.publish();
    } else if (message[0] === "a") {
      const ack = this.pending.get(message[1]);
      if (!ack) return;
      this.pending.delete(message[1]);
      ack(...(Array.isArray(message[2]) ? message[2] : []));
    }
  }
  async onDown(msg) {
    if (msg.peer !== this.hostPeer) return;
    const data = msg.data || {};
    if (!Array.isArray(data.to) || !data.to.includes(this.me) || typeof data.d !== "string") return;
    let entry = this.parts.get(data.k);
    if (!entry) {
      entry = { n: data.n, got: new Array(data.n), count: 0, at: Date.now() };
      this.parts.set(data.k, entry);
    }
    if (entry.got[data.i] === undefined) { entry.got[data.i] = data.d; entry.count += 1; }
    for (const [k, other] of this.parts) if (Date.now() - other.at > 3000) this.parts.delete(k);
    if (entry.count !== entry.n) return;
    this.parts.delete(data.k);
    try {
      const bundle = JSON.parse(await unpack(entry.got.join("")));
      const mine = bundle?.x?.[this.me];
      if (Array.isArray(mine)) mine.forEach((m) => this.handle(m));
      if (Array.isArray(bundle?.e)) bundle.e.forEach((m) => this.handle(m));
    } catch { /* unvollständig */ }
  }
  async startRtc() {
    if (!window.RTCPeerConnection) return;
    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;
      const dc = pc.createDataChannel("tk", { ordered: true });
      dc.onopen = () => {
        this.dc = dc;
        this.offer = null;
        this.publish();
      };
      dc.onmessage = ({ data }) => { try { this.handle(JSON.parse(data)); } catch { /* ungültig */ } };
      dc.onclose = () => { if (this.dc === dc) this.dc = null; };
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      this.offerNonce = nonce();
      this.offer = { n: this.offerNonce, z: await pack(pc.localDescription.sdp) };
      this.publish();
      // Kommt keine Direktverbindung zustande, bleibt es beim Raum.
      setTimeout(() => { if (!this.dc) { this.offer = null; this.publish(); } }, 12000);
    } catch { /* bleibt beim Raum */ }
  }
  async onSignal(msg) {
    const data = msg.data || {};
    if (msg.peer !== this.hostPeer || data.to !== this.me || data.n !== this.offerNonce || !this.pc) return;
    try { await this.pc.setRemoteDescription({ type: "answer", sdp: await unpack(data.z) }); } catch { /* bleibt beim Raum */ }
  }
  lost() {
    if (this.closed) return;
    this.close();
    this.onLost?.();
  }
  close() {
    this.closed = true;
    clearTimeout(this.leaving);
    this.offPeers?.();
    try { this.dc?.close(); this.pc?.close(); } catch { /* egal */ }
    this.room?.leave().catch(() => {});
    for (const ack of this.pending.values()) ack({ ok: false, error: "Verbindung zum Host verloren." });
    this.pending.clear();
  }
}

// ----------------------------------------------- Anschluss an ClientSocket ---

const localCodes = new Set();
let host = null;
let guest = null;
let lastState = null;

function startHosting(code) {
  host?.stop();
  host = new Host(code);
  status.hosting = code;
  status.error = null;
  changed();
  host.start().then((ok) => {
    if (!ok && host?.code === code) { status.error = "no_room"; changed(); }
    else if (lastState) advertise(lastState);
  });
}

function stopHosting() {
  host?.stop();
  host = null;
  status.hosting = null;
  changed();
}

function advertise(state) {
  if (!host || state?.code !== host.code) return;
  const owner = state.players?.find((p) => p.id === state.hostId);
  host.advertise({
    c: state.code,
    h: String(owner?.name || "Jemand").slice(0, 18),
    n: state.players?.filter((p) => !p.isBot).length || 1,
    s: state.status === "lobby" ? "lobby" : "play"
  });
}

async function joinRemote(client, event, args) {
  const payload = args[0] || {};
  const reply = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
  const code = normalizeCode(payload.code);
  const link = new HostLink(code);
  try {
    await link.connect(client);
  } catch (error) {
    reply?.({ ok: false, error: error.message });
    return;
  }
  guest?.close();
  guest = link;
  status.guestOf = code;
  changed();
  link.onLost = () => {
    if (guest !== link) return;
    guest = null;
    status.guestOf = null;
    changed();
    client.switchTo(globalThis.__tumblekinServer.accept(client), { announce: false });
    client.deliver("roomClosed", [{ message: "Das Handy des Hosts ist nicht mehr erreichbar. Die Party ist vorbei." }]);
  };
  link.onClosed = () => { if (guest === link) leaveRemote(client); };
  client.switchTo(link, { announce: false });
  link.receive(event, args);
}

function leaveRemote(client) {
  if (!guest) return;
  const link = guest;
  guest = null;
  status.guestOf = null;
  changed();
  link.close();
  client.switchTo(globalThis.__tumblekinServer.accept(client), { announce: false });
}

globalThis.__tumblekinNet = {
  // Entscheidet, wohin ein Ereignis der Oberfläche geht. true = erledigt.
  intercept(client, event, args) {
    const reply = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
    if (event === "createRoom") {
      if (guest) leaveRemote(client);
      if (reply) {
        args[args.length - 1] = (response, ...rest) => {
          if (response?.ok && response.room?.code) {
            localCodes.add(response.room.code);
            startHosting(response.room.code);
          }
          reply(response, ...rest);
        };
      }
      return false;
    }
    if ((event === "joinRoom" || event === "resumeRoom") && !guest) {
      const code = normalizeCode(args[0]?.code);
      if (!code || localCodes.has(code) || status.room === null) return false;
      joinRemote(client, event, args);
      return true;
    }
    if (event === "leaveRoom") {
      if (guest) {
        if (reply) {
          args[args.length - 1] = (...response) => { leaveRemote(client); reply(...response); };
          return false;
        }
        leaveRemote(client);
        return true;
      }
      stopHosting();
    }
    return false;
  },
  // Beitreten wartet auf den Verbindungsaufbau — dafür reichen 6 s nicht.
  timeoutFor(event, ms) {
    return event === "joinRoom" || event === "resumeRoom" ? Math.max(ms, 20000) : ms;
  },
  // Was der eigene Server an die eigene Oberfläche schickt.
  observe(event, args) {
    if (event !== "state") return;
    lastState = args[0];
    if (host && guest === null) advertise(lastState);
  }
};

// Für die Prüfskripte: wer verbunden ist und auf welchem Weg.
globalThis.__tumblekinNetStatus = () => ({
  room: Boolean(status.room),
  hosting: status.hosting,
  guestOf: status.guestOf,
  error: status.error,
  via: guest ? (guest.dc?.readyState === "open" ? "rtc" : "relay") : null,
  guests: host ? [...host.guests.values()].map((g) => (g.dc?.readyState === "open" ? "rtc" : "relay")) : []
});

// ------------------------------------------------------- Oberfläche -------

globalThis.__tumblekinJoinUrl = (code) => `${__ARTIFACT_URL__}?room=${encodeURIComponent(code)}`;
globalThis.__tumblekinQr = (text, done) => {
  QRCode.toString(text, { type: "svg", margin: 1, width: 168, color: { dark: "#282631", light: "#ffffff" } })
    .then((svg) => done("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)))
    .catch(() => {});
};

function partyList(lobby) {
  const sheet = document.querySelector(".start-sheet");
  if (!sheet || document.querySelector(".party-list")) return;
  const box = document.createElement("div");
  box.className = "party-list";
  box.hidden = true;
  box.innerHTML = `<p class="party-list-title">Offene Partys</p><div class="party-items"></div>`;
  sheet.appendChild(box);
  const items = box.querySelector(".party-items");
  const render = () => {
    const parties = lobby.peers()
      .filter((p) => !p.isMe && p.presence?.party && typeof p.presence.party.c === "string")
      .map((p) => p.presence.party);
    box.hidden = parties.length === 0;
    items.replaceChildren(...parties.slice(0, 6).map((party) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "party-item";
      const name = document.createElement("strong");
      name.textContent = `${String(party.h || "Jemand").slice(0, 18)}s Party`;
      const meta = document.createElement("span");
      meta.textContent = `${normalizeCode(party.c)} · ${Math.max(1, Math.min(4, Number(party.n) || 1))}/4${party.s === "play" ? " · spielt gerade" : ""}`;
      button.append(name, meta);
      button.addEventListener("click", () => {
        const input = document.getElementById("room-code");
        input.value = normalizeCode(party.c);
        input.dispatchEvent(new Event("input"));
        const nameField = document.getElementById("player-name");
        if (!nameField.value.trim()) nameField.focus();
        else document.getElementById("join-room").click();
      });
      return button;
    }));
  };
  lobby.onPeers(render);
}

function inviteHint() {
  const hint = document.getElementById("invite-hint");
  if (!hint) return;
  hint.textContent = status.error === "not_permitted"
    ? "Gäste können nicht verbunden werden: Eine Party leiten darf nur, wer dieses Artifact bearbeiten oder mitwirken darf."
    : status.room
      ? "Freunde öffnen dieses Tumblekin auf claude.ai — teile das Artifact mit ihnen — und tippen den Raumcode ein oder wählen deine Party aus der Liste."
      : globalThis.__tumblekinApp
        ? "In der Test-App spielst du gegen Bots. Mitspielen mit Freunden geht hier noch nicht."
        : "Mitspielen geht nur in der claude.ai-Ansicht dieses Artifacts. Hier spielst du gegen Bots.";
}

roomCapability().then((lobby) => {
  status.room = lobby;
  changed();
  document.body.classList.toggle("can-join", Boolean(lobby));
  if (lobby) partyList(lobby);
});
document.addEventListener("click", (event) => {
  if (event.target?.closest?.("#open-invite")) setTimeout(inviteHint, 0);
});
