import { minigameMeta } from "../minigames/catalog.js?v=tumblekin62";

// One calm colour for every normal field; the specials pop in strong candy hues.
export const FIELD_COLORS = {
  start: "#cfd8d3",
  normal: "#e9f2da",
  challenge: "#ff3d7f",
  gate: "#ffb400"
};

export function getCurrentPlayer(state) {
  if (!state) return null;
  return state.players.find((player) => player.id === state.currentPlayerId) || null;
}

export function getMyPlayer(state, myPlayerId) {
  if (!state || !myPlayerId) return null;
  return state.players.find((player) => player.id === myPlayerId) || null;
}

export function isHost(state, myPlayerId) {
  return Boolean(state && myPlayerId && state.hostId === myPlayerId);
}

export function isMyTurn(state, myPlayerId) {
  return Boolean(state?.status === "board" && state?.phase === "waitingRoll" && state.currentPlayerId === myPlayerId);
}

export function sortByStanding(players) {
  return [...players].sort((a, b) => b.coins - a.coins);
}

export function joinUrlFor(code, baseUrl = window.location.href) {
  const url = new URL(baseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}

export function minigameHelp(type) {
  return minigameMeta(type)?.help || "Sammle Punkte im Minispiel.";
}

export function boardZoneName(state, position = 0) {
  const zones = state?.board?.zones || ["Startzone", "Zweite Zone", "Dritte Zone", "Letzte Zone"];
  return zones[Math.min(zones.length - 1, Math.floor(position / 8))] || zones[0];
}
