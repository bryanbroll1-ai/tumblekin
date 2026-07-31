import { BoardGame } from "./game/BoardGame.js?v=tumblekin84";
import { ClientNetwork } from "./network/ClientNetwork.js?v=tumblekin84";
import { UIManager } from "./ui/UIManager.js?v=tumblekin84";
import { BounceArena } from "./minigames/BounceArena.js?v=tumblekin84";
import { RunnerDerby } from "./minigames/RunnerDerby.js?v=tumblekin84";
import { ColorRush } from "./minigames/ColorRush.js?v=tumblekin84";
import { Nervenprobe } from "./minigames/Nervenprobe.js?v=tumblekin84";
import { RedLightGate } from "./minigames/RedLightGate.js?v=tumblekin84";
import { BalloonPump } from "./minigames/BalloonPump.js?v=tumblekin84";
import { BarrelRoll } from "./minigames/BarrelRoll.js?v=tumblekin84";
import { BombPass } from "./minigames/BombPass.js?v=tumblekin84";
import { CoinRain } from "./minigames/CoinRain.js?v=tumblekin84";
import { WhackBlob } from "./minigames/WhackBlob.js?v=tumblekin84";
import { RopeSkip } from "./minigames/RopeSkip.js?v=tumblekin84";
import { CannonFly } from "./minigames/CannonFly.js?v=tumblekin84";
import { KnifeThrow } from "./minigames/KnifeThrow.js?v=tumblekin84";
import { TowerStack } from "./minigames/TowerStack.js?v=tumblekin84";
import { CliffClimb } from "./minigames/CliffClimb.js?v=tumblekin84";
import { BalloonGlide } from "./minigames/BalloonGlide.js?v=tumblekin84";
import { SumoPush } from "./minigames/SumoPush.js?v=tumblekin84";
import { Trampoline } from "./minigames/Trampoline.js?v=tumblekin84";
import { FalseSignal } from "./minigames/FalseSignal.js?v=tumblekin84";
import { TracePainter } from "./minigames/TracePainter.js?v=tumblekin84";
import { SortBelt } from "./minigames/SortBelt.js?v=tumblekin84";
import { FishDuel } from "./minigames/FishDuel.js?v=tumblekin84";
import { ColorHunt } from "./minigames/ColorHunt.js?v=tumblekin84";
import { Feedback } from "./game/Feedback.js?v=tumblekin84";

const network = new ClientNetwork();
const feedback = new Feedback();
feedback.attachUnlock();

let myPlayerId = null;
let currentState = null;
let activeMinigame = null;
let activeMinigameId = null;
let previousStatus = null;
let previousMinigameId = null;
let resumeInFlight = false;

const SESSION_KEY = "tumblekin-session";

const board = new BoardGame(document.getElementById("board-canvas-wrap"), feedback);
if (new URLSearchParams(location.search).has("dev")) {
  window.__board = board;
  window.__state = () => currentState;
}
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
    board.setActive(false);
    ui.render(null, null);
  },
  addTestPlayers: () => network.request("addTestPlayers", { code: currentState?.code }),
  enableDevMode: () => network.request("enableDevMode", { code: currentState?.code }),
  selectBoard: (boardId) => network.request("selectBoard", { code: currentState?.code, boardId }),
  selectMode: (mode) => network.request("selectMode", { code: currentState?.code, mode }),
  selectSingleGame: (type) => network.request("selectSingleGame", { code: currentState?.code, type }),
  startGame: () => network.request("startGame", { code: currentState?.code }),
  startDevMinigame: (type) => network.request("startDevMinigame", { code: currentState?.code, type }),
  rollDice: () => network.request("rollDice", { code: currentState?.code, playerId: ui.getControlledPlayerId() }),
  chooseRoute: (route) => network.request("chooseRoute", { code: currentState?.code, route }),
  restartGame: () => network.request("restartGame", { code: currentState?.code }),
  useItem: (itemId) => network.request("useItem", {
    code: currentState?.code,
    playerId: ui.getControlledPlayerId(),
    itemId
  })
}, feedback);

network.on("state", handleState);
network.on("boardMove", (move) => {
  feedback.sound("roll");
  feedback.vibrate([25, 30, 45]);
  ui.showBoardMove(move);
  board.animateMove(move);
});
// An der Kreuzung: der Würfel ist gefallen, aber der Weg ist noch offen. Ein
// eigener Ton und ein spürbarer Impuls, weil hier eine Entscheidung ansteht und
// nicht bloss eine Figur weiterläuft.
network.on("boardJunction", (junction) => {
  feedback.sound("select");
  feedback.vibrate([18, 40, 18]);
  board.focusField?.(junction.at);
});
network.on("boardRouteChosen", (choice) => {
  feedback.sound(choice.saves > 0 ? "whoosh" : "tap");
});
network.on("boardLanded", (landing) => {
  const effect = landing.fieldEffect || {};
  const gateBonus = landing.gateEffects?.some((gate) => gate.coins > 0);
  board.showLanding(landing);
  ui.showFieldResult(landing);
  if (gateBonus) {
    feedback.sound("coin");
    feedback.vibrate([22, 28, 32, 28, 44]);
  } else if (effect.type === "challenge") {
    feedback.sound("impact");
    feedback.vibrate(28);
  } else if ((effect.coins || 0) > 0) {
    feedback.sound("coin");
    feedback.vibrate(16);
  } else if ((effect.coins || 0) < 0) {
    feedback.sound("error");
    feedback.vibrate([24, 20, 24]);
  } else {
    feedback.sound("land");
    feedback.vibrate(12);
  }
});
network.on("minigameUpdate", (update) => {
  if (activeMinigameId === update.id) {
    activeMinigame?.handleUpdate(update);
  }
});
network.on("itemUsed", (event) => {
  feedback.sound(event.blockedBy ? "error" : "lock");
  feedback.vibrate(event.blockedBy ? [22, 18, 26] : [14, 10, 20]);
  ui.showToast(event.message || "Item benutzt.");
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
  board.setActive(false);
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
  if (statusChanged && previousStatus !== null && ["board", "minigame", "result", "end"].includes(state.status)) {
    ui.playSceneTransition(state.status);
  }
  if (statusChanged && state.status === "minigame") board.prepareMinigame();
  currentState = state;
  board.setActive(state.status === "board" || state.status === "end");
  network.syncClock(state.serverTime);
  if (state.hostConnected === false) {
    ui.setConnectionStatus("warning", "Host-Verbindung verloren. Keine Host-Aktionen möglich.");
  } else {
    ui.setConnectionStatus("online");
  }
  ui.render(state, myPlayerId);

  if (state.status === "board" || state.status === "end") {
    board.resize();
    board.setState(state);
    if (previousStatus === "result" && state.status === "board") board.returnToBoard();
  }

  if (state.status === "minigame" && state.currentMinigame) {
    startOrUpdateMinigame(state.currentMinigame);
  } else {
    stopMinigame();
  }

  if (state.status !== previousStatus) {
    if (state.status === "result" || state.status === "end") {
      feedback.sound("win");
      feedback.vibrate([40, 40, 80]);
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
  const MinigameClass = {
    bounceArena: BounceArena,
    finishRush: RunnerDerby,
    colorEscape: ColorRush,
    nervenprobe: Nervenprobe,
    lichtwaechter: RedLightGate,
    ballonPump: BalloonPump,
    fassrolle: BarrelRoll,
    zuendstoff: BombPass,
    muenzregen: CoinRain,
    blobklopfe: WhackBlob,
    seilspringen: RopeSkip,
    kanonenflug: CannonFly,
    messerwurf: KnifeThrow,
    turmbau: TowerStack,
    bergsteiger: CliffClimb,
    ballonfahrt: BalloonGlide,
    sumoschubs: SumoPush,
    trampolin: Trampoline,
    falschsignal: FalseSignal,
    spurmaler: TracePainter,
    sortierband: SortBelt,
    angelduell: FishDuel,
    farbenjagd: ColorHunt
  }[minigame.type] || null;

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
  if (previousMinigameId !== minigame.id) {
    feedback.sound("countdown");
    feedback.vibrate(24);
    previousMinigameId = minigame.id;
  }
  activeMinigame.start(minigame);
  if (new URLSearchParams(location.search).has("dev")) window.__activeMinigame = activeMinigame;
}

function stopMinigame() {
  if (!activeMinigame) return;
  activeMinigame.destroy();
  activeMinigame = null;
  activeMinigameId = null;
}

function rememberSession(code, playerId) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId }));
}

function forgetSession() {
  sessionStorage.removeItem(SESSION_KEY);
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
    board.setActive(false);
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
