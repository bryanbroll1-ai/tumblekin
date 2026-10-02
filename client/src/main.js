import { ClientNetwork } from "./network/ClientNetwork.js?v=tumblekin210";
import { UIManager } from "./ui/UIManager.js?v=tumblekin210";
import { MenuStage } from "./ui/MenuStage.js?v=tumblekin210";
import { Feedback } from "./game/Feedback.js?v=tumblekin210";
import { ButtonFeedback } from "./game/ButtonFeedback.js?v=tumblekin210";
import { MINIGAME_SCENES as MINIGAMES } from "./minigames/scenes.js?v=tumblekin210";

// socket.io kommt als eigenes Skript vom Server. Fehlt es, würde
// `new ClientNetwork()` beim Laden werfen — der Startbildschirm stünde schon im
// HTML und sähe heil aus, aber kein Knopf bekäme je einen Zuhörer. Darum eine
// Wache vor allem anderen: sie rettet die Verbindung nicht, sagt aber, was los ist.
if (typeof window.io !== "function") {
  const banner = document.getElementById("connection-banner");
  if (banner) {
    banner.hidden = false;
    banner.textContent = "Keine Verbindung zum Spielserver. Läuft er noch? Dann Seite neu laden.";
  }
  document.querySelectorAll("#screen-start button").forEach((button) => { button.disabled = true; });
  throw new Error("socket.io konnte nicht geladen werden — Spielserver nicht erreichbar.");
}



const network = new ClientNetwork();
const feedback = new Feedback();
feedback.attachUnlock();
feedback.buttons = new ButtonFeedback(feedback);

let myPlayerId = null;
let currentState = null;
let activeMinigame = null;
let activeMinigameId = null;
let previousStatus = null;
let previousMinigameId = null;
let resumeInFlight = false;

const SESSION_KEY = "tumblekin-session";
const devMode = new URLSearchParams(location.search).has("dev");

const stage = new MenuStage(document.getElementById("app"));
const request = (event, payload = {}) => network.request(event, { code: currentState?.code, ...payload });

const ui = new UIManager({
  createRoom: async (name) => {
    const response = await network.request("createRoom", { name });
    myPlayerId = response.playerId;
    rememberSession(response.room.code, response.playerId);
    handleState(response.room);
  },
  joinRoom: async (code, name) => {
    const response = await network.request("joinRoom", { code, name });
    myPlayerId = response.playerId;
    rememberSession(response.room.code, response.playerId);
    handleState(response.room);
  },
  leaveRoom: async () => {
    await network.request("leaveRoom");
    forgetSession();
    myPlayerId = null;
    currentState = null;
    stopMinigame();
    ui.render(null, null);
  },
  addBot: () => request("addBot"),
  removeBot: (playerId) => request("removeBot", { playerId }),
  enableDevMode: () => request("enableDevMode"),
  selectMode: (mode) => request("selectMode", { mode }),
  updateSettings: (settings) => request("updateSettings", { settings }),
  startGame: () => request("startGame"),
  rematch: () => request("rematch"),
  restartGame: () => request("restartGame"),
  readyForNext: () => request("readyForNext"),
  readyForMinigame: (minigameId) => request("readyForMinigame", { minigameId })
}, feedback, stage);

// Griff für die Prüfskripte: mit ?dev=1 lassen sich Räume und Spiele direkt
// über dieselben Ereignisse steuern, die auch die Knöpfe benutzen.
if (devMode) {
  window.__tumblekin = {
    request,
    state: () => currentState,
    stage,
    ui,
    activeMinigame: () => activeMinigame
  };
  window.__state = () => currentState;
}

network.on("state", handleState);
network.on("minigameUpdate", (update) => {
  if (activeMinigameId === update.id) activeMinigame?.handleUpdate(update);
});
network.on("roomNotice", (notice) => {
  if (notice?.severity === "error") feedback.sound("error");
  ui.showToast(notice?.message || "Hinweis vom Raum.");
});
network.on("roomClosed", (notice) => {
  feedback.sound("error");
  feedback.vibrate([40, 50, 40]);
  myPlayerId = null;
  forgetSession();
  currentState = null;
  stopMinigame();
  ui.render(null, null);
  ui.setConnectionStatus("error", notice?.message || "Der Raum wurde geschlossen.");
});
network.on("connect", async () => {
  const hadSession = Boolean((currentState?.code && myPlayerId) || savedSession());
  const resumed = await resumeSession();
  if (resumed || !hadSession) ui.setConnectionStatus("online");
});
network.on("disconnect", () => {
  ui.setConnectionStatus("offline", "Verbindung zum Server verloren. Prüfe WLAN oder lade neu.");
});
network.on("connect_error", () => {
  ui.setConnectionStatus("offline", "Server nicht erreichbar. Prüfe WLAN und Serverstart.");
});

function handleState(state) {
  const statusChanged = state.status !== previousStatus;
  if (statusChanged && previousStatus !== null && ["lobby", "minigame", "result", "end"].includes(state.status)) {
    ui.playSceneTransition(state.status);
  }
  currentState = state;
  network.syncClock(state.serverTime);
  if (state.hostConnected === false) {
    ui.setConnectionStatus("warning", "Host-Verbindung verloren. Keine Host-Aktionen möglich.");
  } else {
    ui.setConnectionStatus("online");
  }
  ui.render(state, myPlayerId);

  if (state.status === "minigame" && state.phase !== "waitingReady" && state.currentMinigame) {
    startOrUpdateMinigame(state.currentMinigame);
  } else {
    stopMinigame();
  }

  if (statusChanged) {
    if (state.status === "end") {
      const won = state.winnerIds?.includes(myPlayerId);
      feedback.sound(won ? "win" : "success");
      feedback.vibrate(won ? [40, 40, 80, 40, 120] : [30, 30, 40]);
    }
    previousStatus = state.status;
  }
}

function startOrUpdateMinigame(minigame) {
  if (activeMinigameId === minigame.id) {
    activeMinigame.handleUpdate(minigame);
    return;
  }

  stopMinigame();
  const MinigameClass = MINIGAMES[minigame.type] || null;
  if (!MinigameClass) return;
  activeMinigameId = minigame.id;
  activeMinigame = new MinigameClass({
    canvas: document.getElementById("minigame-canvas"),
    controls: document.getElementById("minigame-controls"),
    sendInput: (input) => network.request("minigameInput", { code: currentState?.code, playerId: ui.getControlledPlayerId(), input }),
    now: () => network.now(),
    getState: () => currentState,
    getControlledPlayerId: () => ui.getControlledPlayerId(),
    myPlayerId,
    feedback
  });
  activeMinigame.onInputError = error => {
    if (activeMinigameId !== minigame.id || currentState?.phase !== "playingMinigame") return;
    feedback.sound("error");
    ui.showToast(error.message || "Die Aktion ist nicht angekommen. Versuch es noch einmal.");
  };
  if (previousMinigameId !== minigame.id) {
    feedback.sound("countdown");
    feedback.vibrate(24);
    previousMinigameId = minigame.id;
  }
  activeMinigame.start(minigame);
  if (devMode) window.__activeMinigame = activeMinigame;
}

function stopMinigame() {
  if (!activeMinigame) return;
  activeMinigame.destroy();
  if (devMode && window.__activeMinigame === activeMinigame) window.__activeMinigame = null;
  activeMinigame = null;
  activeMinigameId = null;
}

function rememberSession(code, playerId) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId })); } catch (_error) { /* privat */ }
}

function forgetSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_error) { /* privat */ }
}

function savedSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    if (!session?.code || !session?.playerId) return null;
    return session;
  } catch (_error) {
    forgetSession();
    return null;
  }
}

async function resumeSession() {
  if (resumeInFlight) return false;
  const session = currentState?.code && myPlayerId
    ? { code: currentState.code, playerId: myPlayerId }
    : savedSession();
  if (!session) return false;

  resumeInFlight = true;
  try {
    const response = await network.request("resumeRoom", session);
    myPlayerId = response.playerId;
    rememberSession(response.room.code, response.playerId);
    handleState(response.room);
    ui.setConnectionStatus("online");
    ui.showToast("Wieder verbunden.");
    return true;
  } catch (error) {
    forgetSession();
    myPlayerId = null;
    currentState = null;
    stopMinigame();
    ui.render(null, null);
    ui.setConnectionStatus("error", error.message || "Die Sitzung konnte nicht wiederhergestellt werden.");
    return false;
  } finally {
    resumeInFlight = false;
  }
}

queueMicrotask(() => {
  if (network.isConnected()) resumeSession();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
