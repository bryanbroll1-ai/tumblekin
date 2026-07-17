export class Player {
  constructor(data) {
    Object.assign(this, data);
  }

  get label() {
    return `${this.name} · ${this.coins} Münzen`;
  }

  get isOnline() {
    return this.connected || this.isBot;
  }
}

export function asPlayers(rawPlayers = []) {
  return rawPlayers.map((player) => new Player(player));
}

export function playerStatus(player) {
  if (!player.connected) return "Offline";
  if (player.isLocalDev) return player.isHost ? "Host · Lokal" : "Lokal";
  if (player.isBot) return "Bot";
  if (player.isHost) return "Host";
  return "Bereit";
}
