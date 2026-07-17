export class ClientNetwork {
  constructor() {
    this.socket = window.io({
      transports: ["websocket", "polling"]
    });
    this.clockOffset = 0;
  }

  on(event, handler) {
    this.socket.on(event, handler);
  }

  request(event, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket.connected) {
        reject(new Error("Keine Verbindung zum Server."));
        return;
      }
      this.socket.timeout(6000).emit(event, payload, (error, response) => {
        if (error) {
          reject(new Error("Server antwortet nicht."));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "Aktion fehlgeschlagen."));
          return;
        }
        resolve(response);
      });
    });
  }

  syncClock(serverTime) {
    if (!serverTime) return;
    const measured = serverTime - Date.now();
    this.clockOffset = this.clockOffset * 0.82 + measured * 0.18;
  }

  now() {
    return Date.now() + this.clockOffset;
  }

  isConnected() {
    return this.socket.connected;
  }
}
