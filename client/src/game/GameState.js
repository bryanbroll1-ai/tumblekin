import { minigameMeta } from "../minigames/catalog.js?v=tumblekin200";

// Helfer rund um den Raumzustand, den der Server schickt.

export const MODES = {
  marathon: {
    icon: "🏃",
    name: "Marathon",
    help: "Eine feste Zahl Minispiele hintereinander. Platz 1 bringt die meisten Punkte — wer am Ende vorn liegt, gewinnt."
  },
  hunt: {
    icon: "🎯",
    name: "Punktejagd",
    help: "Kein festes Ende: wer als Erster allein die Zielpunktzahl erreicht, gewinnt. Gleichstand am Ziel heisst Matchball."
  },
  knockout: {
    icon: "💥",
    name: "K.O.",
    help: "Jeder hat Leben. Wer ein Spiel als Letzter beendet, verliert eins. Wer zuletzt noch Leben hat, gewinnt."
  },
  single: {
    icon: "🎮",
    name: "Einzelspiel",
    help: "Ein Minispiel eurer Wahl — danach geht es zurück in die Lobby."
  }
};

export const MARATHON_LENGTHS = [5, 10, 15];
export const KNOCKOUT_LIVES = [2, 3, 5];

export function modeInfo(mode) {
  return MODES[mode] || MODES.marathon;
}

// Dieselbe Rechnung wie auf dem Server (server/modes.js huntTarget).
export function huntTarget(playerCount) {
  return Math.max(4, 4 * (Math.max(2, playerCount) - 1));
}

export function getMyPlayer(state, myPlayerId) {
  if (!state || !myPlayerId) return null;
  return state.players.find((player) => player.id === myPlayerId) || null;
}

export function isHost(state, myPlayerId) {
  return Boolean(state && myPlayerId && state.hostId === myPlayerId);
}

// Gesamtstand wie auf dem Server (server/modes.js compareStanding): Punkte,
// dann Rundensiege; im K.O. zuerst die Leben.
export function sortByStanding(players, mode) {
  const compare = (a, b) => {
    if (mode === "knockout") {
      return ((b.lives || 0) - (a.lives || 0)) || ((b.points || 0) - (a.points || 0)) || ((b.wins || 0) - (a.wins || 0));
    }
    return ((b.points || 0) - (a.points || 0)) || ((b.wins || 0) - (a.wins || 0));
  };
  return [...players].sort(compare);
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

export function minigameTitle(state, type) {
  return state?.minigameTitles?.find((game) => game.type === type)?.title || minigameMeta(type)?.title || type;
}
