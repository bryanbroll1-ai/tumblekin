export class ClientNetwork {
  constructor() {
    // Polling zuerst, dann Upgrade auf WebSocket — die proxy-sichere Reihenfolge.
    // Mit WebSocket an erster Stelle scheitert die Verbindung komplett, sobald
    // etwas dazwischen den Upgrade ablehnt (gemessen: 403 beim Handshake hinter
    // einem Proxy). Über Polling kommt die Sitzung zustande und wird danach
    // automatisch aufgewertet, wenn der Weg frei ist.
    this.socket = window.io({
      transports: ["polling", "websocket"],
      upgrade: true
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
