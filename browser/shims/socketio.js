// socket.io ohne Netz: Server und Client liegen im selben Browserfenster.
// Alles, was hin und her geht, wird wie auf der Leitung serialisiert und eine
// Runde später zugestellt — sonst teilten sich Server und Oberfläche dieselben
// Objekte, und der Ablauf wäre ein anderer als im echten Spiel.
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const later = (fn) => setTimeout(fn, 0);
let counter = 0;

class ServerSocket {
  constructor(server, client) {
    this.server = server;
    this.client = client;
    counter += 1;
    this.id = `local-${counter}-${Math.random().toString(36).slice(2, 8)}`;
    this.data = {};
    this.handshake = { address: "127.0.0.1", headers: {}, query: {} };
    this.conn = { transport: { name: "memory" }, on() {} };
    this.handlers = new Map();
    this.anyHandlers = [];
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }
  onAny(fn) { this.anyHandlers.push(fn); }
  join(room) {
    if (!this.server.rooms.has(room)) this.server.rooms.set(room, new Set());
    this.server.rooms.get(room).add(this.id);
  }
  leave(room) { this.server.rooms.get(room)?.delete(this.id); }
  emit(event, ...args) { this.send(event, args); }
  send(event, args) {
    const copy = args.map(clone);
    later(() => this.client.deliver(event, copy));
  }
  receive(event, args) {
    const last = args[args.length - 1];
    const ack = typeof last === "function" ? last : null;
    const payload = (ack ? args.slice(0, -1) : args).map(clone);
    const reply = ack ? (...response) => { const copy = response.map(clone); later(() => ack(...copy)); } : undefined;
    this.anyHandlers.forEach((fn) => fn(event, ...payload));
    (this.handlers.get(event) || []).forEach((fn) => fn(...payload, ...(reply ? [reply] : [])));
  }
}

class Server {
  constructor() {
    this.sockets = { sockets: new Map() };
    this.rooms = new Map();
    this.onConnection = null;
    globalThis.__tumblekinServer = this;
  }
  on(event, fn) { if (event === "connection") this.onConnection = fn; }
  to(room) {
    return {
      emit: (event, ...args) => {
        [...(this.rooms.get(room) || [])].forEach((id) => this.sockets.sockets.get(id)?.send(event, args));
      }
    };
  }
  accept(client) {
    const socket = new ServerSocket(this, client);
    this.sockets.sockets.set(socket.id, socket);
    this.onConnection?.(socket);
    return socket;
  }
}

module.exports = { Server };
