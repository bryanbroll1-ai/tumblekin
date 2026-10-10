// Vorbereitungen, bevor Spielserver und Oberfläche laden.
globalThis.process = globalThis.process || { env: {}, on() {}, exit() {} };

// Die Android-Test-App (android/) meldet sich im User-Agent. Dort gibt es
// keine claude.ai-Raumfunktion: man spielt gegen Bots, die Hinweise sagen das.
globalThis.__tumblekinApp = /\bTumblekinApp\//.test(navigator.userAgent || "");
if (globalThis.__tumblekinApp) document.documentElement.classList.add("in-app");

// Manche Browser (private Fenster, gesperrte Websitedaten) werfen schon beim
// Zugriff auf localStorage. Dann gilt ein Speicher im Arbeitsspeicher.
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; }
  };
}
["localStorage", "sessionStorage"].forEach((name) => {
  try {
    const store = window[name];
    store.setItem("__probe", "1");
    store.removeItem("__probe");
  } catch {
    try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch { /* bleibt */ }
  }
});

// /config kommt sonst vom Server.
const realFetch = window.fetch?.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url;
  if (url === "/config") {
    return Promise.resolve(new Response(JSON.stringify({ lanUrls: [], version: __APP_VERSION__, devTools: false }), {
      headers: { "Content-Type": "application/json" }
    }));
  }
  return realFetch(input, init);
};

// Der Client verbindet sich wie gewohnt über window.io() — mit dem Server im
// selben Fenster, oder als Gast mit dem Fenster des Hosts (siehe net.js).
class ClientSocket {
  constructor() {
    this.connected = false;
    this.handlers = new Map();
    this.attach(globalThis.__tumblekinServer.accept(this), true);
  }
  attach(remote, announce) {
    this.remote = remote;
    this.id = remote.id;
    if (!announce) return;
    setTimeout(() => {
      this.connected = true;
      this.deliver("connect", []);
    }, 0);
  }
  // Andere Gegenstelle: vom eigenen Server zum Host und zurück. Der alte
  // Anschluss wird abgemeldet, damit der eigene Server niemanden festhält.
  switchTo(remote, { announce = false } = {}) {
    const old = this.remote;
    if (old === remote) return;
    if (!old?.remoteHost) {
      try { old?.receive?.("disconnect", ["client namespace disconnect"]); } catch { /* weg */ }
    }
    this.attach(remote, announce);
    this.connected = true;
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
    return this;
  }
  off(event, fn) {
    const list = this.handlers.get(event) || [];
    this.handlers.set(event, fn ? list.filter((h) => h !== fn) : []);
    return this;
  }
  emit(event, ...args) {
    if (globalThis.__tumblekinNet?.intercept(this, event, args)) return this;
    const remote = this.remote;
    setTimeout(() => remote.receive(event, args), 0);
    return this;
  }
  timeout(ms) {
    return {
      emit: (event, payload, callback) => {
        let done = false;
        const wait = globalThis.__tumblekinNet?.timeoutFor(event, ms) ?? ms;
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          callback(new Error("timeout"));
        }, wait);
        this.emit(event, payload, (...response) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          callback(null, ...response);
        });
      }
    };
  }
  deliver(event, args) {
    if (!this.remote?.remoteHost) globalThis.__tumblekinNet?.observe(event, args);
    (this.handlers.get(event) || []).slice().forEach((fn) => fn(...args));
  }
}
window.io = () => new ClientSocket();
document.body.dataset.screen = document.body.dataset.screen || "start";
