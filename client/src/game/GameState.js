import { minigameMeta } from "../minigames/catalog.js?v=tumblekin213";

// Helfer rund um den Raumzustand, den der Server schickt.

export const MODES = {
  marathon: {
    icon: "🏃",
    name: "Marathon",
    help: "Feste Zahl Spiele — wer am Ende die meisten Punkte hat, gewinnt."
  },
  hunt: {
    icon: "🎯",
    name: "Punktejagd",
    help: "Wer zuerst allein die Zielpunkte erreicht, gewinnt."
  },
  knockout: {
    icon: "💥",
    name: "K.O.",
    help: "Letzter Platz kostet ein Leben — wer übrig bleibt, gewinnt."
  },
  single: {
    icon: "🎮",
    name: "Ein Spiel",
    help: "Ein Spiel eurer Wahl, danach zurück in die Lobby."
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

// Was ins Codefeld getippt oder eingefügt wird: ein Code („zp2h", „ZP-2H",
// „Z P 2 H") oder gleich der ganze Einladungslink aus dem Chat. Übrig bleibt
// der Code. Vorher schnitt das Feld nach sechs Zeichen ab, BEVOR Leerzeichen
// entfernt wurden — aus „z p 2 h" wurde „ZP2", und Beitreten scheiterte.
export function extractRoomCode(text) {
  const raw = String(text ?? "");
  const fromLink = raw.match(/[?&]room=([A-Za-z0-9]+)/);
  return (fromLink ? fromLink[1] : raw).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

// Läuft der Server im Internet (Render), braucht es kein gemeinsames WLAN —
// nur auf einem Rechner im Heimnetz (localhost oder private Adresse).
export function isLocalNetworkHost(hostname) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.endsWith(".local")
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
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
