import { minigameMeta } from "../minigames/catalog.js?v=tumblekin71";

// Calm colours for the filler fields; anything that changes your plan pops in a
// strong candy hue. Each type also gets a distinct icon (see BoardGame.js) so
// the board stays readable for colour-blind players.
export const FIELD_COLORS = {
  start: "#cfd8d3",
  normal: "#e9f2da",
  coin: "#ffd45c",
  item: "#7bd0ff",
  luck: "#b98cff",
  trap: "#5b6b7a",
  star: "#ffe36b",
  challenge: "#ff3d7f",
  gate: "#ffb400"
};

// What each field does, in one short line. Shown on the board legend and when
// a player lands, so nobody has to memorise the rules.
export const FIELD_LEGEND = {
  start: { icon: "▶", label: "Start", help: "+2 Münzen." },
  normal: { icon: "•", label: "Feld", help: "+2 Münzen." },
  coin: { icon: "◉", label: "Münzader", help: "+6 Münzen." },
  item: { icon: "?", label: "Itemfeld", help: "Zieh ein Item für deinen nächsten Zug." },
  luck: { icon: "◆", label: "Glücksfeld", help: "Setze 10 Münzen: 50/50 auf +25." },
  trap: { icon: "✕", label: "Falle", help: "-8 Münzen, außer du hast ein Schild." },
  star: { icon: "★", label: "Sternenpodest", help: "Leuchtet es, kaufst du hier einen Stern." },
  challenge: { icon: "✦", label: "Challenge", help: "Ein Minispiel startet." },
  gate: { icon: "⌂", label: "Bandtor", help: "Passieren zahlt +5 Münzen." }
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
