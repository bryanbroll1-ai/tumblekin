export function playerStatus(player, hostId = null) {
  if (player.connected === false) return "offline";
  if (player.isLocalDev) return player.id === hostId || player.isHost ? "Host · lokal" : "lokal";
  if (player.isBot) return "Bot";
  if (player.id === hostId || player.isHost) return "Host";
  return "";
}
