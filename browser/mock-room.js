// Nur für Tests: die claude.ai-Raumfunktion nachgebaut über BroadcastChannel
// (alle Seiten im selben Browser-Kontext). Hält die dokumentierten Grenzen
// ein: 4 KiB je Ereignis und Präsenz, Ereignisse können verloren gehen
// (window.__mockDrop), Zustellung mit Verzögerung (window.__mockLatency).
(() => {
  const PEER = Math.random().toString(36).slice(2, 18);
  const latency = () => Number(window.__mockLatency || 0);
  const bc = new BroadcastChannel("tk-mock-room");
  const stats = { emits: 0, perSecond: [], maxPerSecond: 0, maxBytes: 0, presenceSets: 0, rejected: 0 };
  window.__mockRoomStats = stats;
  const rooms = new Map();
  const size = (v) => new TextEncoder().encode(JSON.stringify(v ?? null)).length;
  function countEmit(bytes) {
    const now = Date.now();
    stats.emits += 1;
    stats.maxBytes = Math.max(stats.maxBytes, bytes);
    stats.perSecond.push(now);
    while (stats.perSecond.length && now - stats.perSecond[0] > 1000) stats.perSecond.shift();
    stats.maxPerSecond = Math.max(stats.maxPerSecond, stats.perSecond.length);
  }
  function sender(peer, me) {
    return { peer, by: null, isMe: me, sameTab: me, kind: "viewer", guest: false };
  }
  function makeRoom(name) {
    const topics = new Map();
    const peerFns = new Set();
    const peers = new Map();
    let mine = {};
    const entry = (peer, presence, me) => Object.freeze({ ...sender(peer, me), presence: Object.freeze({ ...presence }), updatedAt: Date.now() });
    peers.set(PEER, entry(PEER, mine, true));
    const notify = (joined = [], left = [], updated = []) => setTimeout(() => {
      const snapshot = Object.freeze([...peers.values()]);
      peerFns.forEach((fn) => fn({ peers: snapshot, joined, left, updated }));
    }, 0);
    const post = (msg) => bc.postMessage({ room: name, from: PEER, ...msg });
    const room = {
      name,
      emit(topic, data) {
        const bytes = size(data);
        if (bytes > 4096) { stats.rejected += 1; return Promise.reject({ code: "invalid_argument", message: `over 4 KiB (${bytes})` }); }
        countEmit(bytes);
        if (Math.random() < Number(window.__mockDrop || 0)) return Promise.resolve();
        post({ kind: "emit", topic, data });
        setTimeout(() => (topics.get(topic) || []).forEach((fn) => fn({ ...sender(PEER, true), topic, data })), 0);
        return Promise.resolve();
      },
      on(topic, fn) {
        if (!topics.has(topic)) topics.set(topic, new Set());
        topics.get(topic).add(fn);
        return () => topics.get(topic).delete(fn);
      },
      presence(patch) {
        const merged = { ...mine, ...patch };
        for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
        if (size(merged) > 4096) { stats.rejected += 1; return Promise.reject({ code: "invalid_argument", message: `presence over 4 KiB (${size(merged)})` }); }
        mine = merged;
        stats.presenceSets += 1;
        peers.set(PEER, entry(PEER, mine, true));
        post({ kind: "presence", presence: mine });
        notify([], [], [peers.get(PEER)]);
        return Promise.resolve();
      },
      peers: () => Object.freeze([...peers.values()]),
      onPeers(fn) { peerFns.add(fn); notify([...peers.values()]); return () => peerFns.delete(fn); },
      connected: () => true,
      onConnection(fn) { setTimeout(() => fn(true), 0); return () => {}; },
      leave() { post({ kind: "bye" }); rooms.delete(name); return Promise.resolve(); },
      _receive(msg) {
        if (msg.kind === "emit") {
          (topics.get(msg.topic) || []).forEach((fn) => fn({ ...sender(msg.from, false), topic: msg.topic, data: msg.data }));
        } else if (msg.kind === "presence" || msg.kind === "hello") {
          const fresh = !peers.has(msg.from);
          if (msg.kind === "presence" || fresh) peers.set(msg.from, entry(msg.from, msg.presence || {}, false));
          if (msg.kind === "hello") post({ kind: "presence", presence: mine });
          notify(fresh ? [peers.get(msg.from)] : [], [], fresh ? [] : [peers.get(msg.from)]);
        } else if (msg.kind === "bye") {
          const gone = peers.get(msg.from);
          if (gone) { peers.delete(msg.from); notify([], [gone]); }
        }
      }
    };
    rooms.set(name, room);
    post({ kind: "hello", presence: mine });
    return room;
  }
  bc.onmessage = ({ data }) => setTimeout(() => rooms.get(data.room)?._receive(data), latency());
  const lobby = makeRoom("__lobby");
  lobby.join = (name) => Promise.resolve(rooms.get(name) || makeRoom(name));
  addEventListener("pagehide", () => rooms.forEach((r) => r.leave()));
  window.claude = { use: async (n) => (n === "room" ? lobby : null) };
})();
