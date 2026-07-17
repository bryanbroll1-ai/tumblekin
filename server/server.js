const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const { BOARD_DEFINITIONS, BOARD_SIZE, getBoard, publicBoard } = require("./boards");

const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 4;
const MAX_ROUNDS = 5;
const STARTING_COINS = 10;
const GATE_COIN_BONUS = 5;
const RESULT_HOLD_MS = 6500;
const DICE_REVEAL_MS = 700;
const BOARD_STEP_MS = 250;

const COLORS = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"];
const FIELD_TYPES = BOARD_DEFINITIONS[0].fieldTypes;

const MINIGAMES = [
  { type: "bounceArena", title: "Bumper Bloom", duration: 18000 },
  { type: "driftDocks", title: "Drift Docks", duration: 16000, arcadeFamily: "kinetic" },
  { type: "lanternLift", title: "Lantern Lift", duration: 15000, arcadeFamily: "direct" },
  { type: "balanceBrew", title: "Balance Brew", duration: 15000, arcadeFamily: "direct" },
  { type: "canopyClimb", title: "Vine Vault", duration: 18000 },
  { type: "fluxFloor", title: "Glow Grid", duration: 16000 },
  { type: "dodgeBlocks", title: "Cloudbreak", duration: 13000 },
  { type: "timingStop", title: "Pulse Pin", duration: 8000 },
  { type: "petalPanic", title: "Petal Panic", duration: 13000, arcadeFamily: "choice" },
  { type: "orbitDrop", title: "Orbit Drop", duration: 13000, arcadeFamily: "timing" },
  { type: "tideTap", title: "Tide Tap", duration: 13000, arcadeFamily: "timing" },
  { type: "fireflySweep", title: "Coin Sweep", duration: 15000, arcadeFamily: "steer" },
  { type: "iceDrift", title: "Ice Drift", duration: 15000, arcadeFamily: "steer" },
  { type: "magnetMates", title: "Magnet Mates", duration: 15000, arcadeFamily: "steer" },
  { type: "gravityGarden", title: "Gravity Garden", duration: 15000, arcadeFamily: "steer" },
  { type: "sparkSort", title: "Coin Sort", duration: 13000, arcadeFamily: "target" },
  { type: "bubblePop", title: "Bubble Bay", duration: 15000, arcadeFamily: "target" },
  { type: "plinkoDrop", title: "Plinko Falls", duration: 18000, arcadeFamily: "plinko" },
  { type: "curlingSlide", title: "Slide Stones", duration: 20000, arcadeFamily: "curling" }
];

const ARCADE_CONFIGS = {
  driftDocks: { family: "kinetic", kineticMode: "sweep", seed: 227 },
  lanternLift: { family: "direct", directMode: "catch", spawnMs: 720, seed: 257 },
  balanceBrew: { family: "direct", directMode: "balance", seed: 271 },
  petalPanic: { family: "choice", beatMs: 690, choiceDelay: 0, seed: 23 },
  orbitDrop: { family: "timing", periodMs: 1760, target: 0.25, timingWindow: 0.24, seed: 67 },
  tideTap: { family: "timing", periodMs: 1540, target: 0.75, timingWindow: 0.18, dynamicTiming: true, seed: 83 },
  fireflySweep: { family: "steer", steerMode: "collect", seed: 109 },
  iceDrift: { family: "steer", steerMode: "avoid", seed: 127 },
  magnetMates: { family: "steer", steerMode: "chase", seed: 139 },
  gravityGarden: { family: "steer", steerMode: "stay", seed: 151 },
  sparkSort: { family: "target", targetMode: "sort", spawnMs: 620, seed: 179 },
  bubblePop: { family: "target", targetMode: "bubble", spawnMs: 540, seed: 313 },
  plinkoDrop: { family: "plinko", seed: 331 },
  curlingSlide: { family: "curling", seed: 347 }
};

const PLINKO_SLOTS = [1, 4, 7, 12, 7, 4, 1];
const PLINKO_GRAVITY = 1.35;
const PLINKO_FLOOR_Y = 1.3;
const CURLING_SHEET_Y = 1.3;
const CURLING_RINGS = [
  { radius: 0.075, points: 15 },
  { radius: 0.15, points: 8 },
  { radius: 0.24, points: 4 }
];
const CURLING_STONES_PER_PLAYER = 3;

const ARENA_RADIUS = 1.02;
const ARENA_BALL_RADIUS = 0.16;
const ARENA_FORCE = 0.22;
const ARENA_BUMP_FORCE = 0.58;
const ARENA_MAX_SPEED = 1.65;
const ARENA_DRAG = 0.91;

const FLUX_SIZE = 9;
const FLUX_MOVE_COOLDOWN = 92;
const FLUX_BURST_COOLDOWN = 2900;
const FLUX_BLOCKED = [[0, 0], [8, 0], [0, 8], [8, 8], [4, 4]];

const rooms = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "../client")));
app.use("/vendor/three", express.static(path.join(__dirname, "../node_modules/three/build")));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get("/config", (_req, res) => {
  res.json({
    lanUrls: getLocalAddresses().map((address) => `http://${address}:${PORT}`)
  });
});
app.get("/qr.svg", async (req, res) => {
  const text = String(req.query.text || "").slice(0, 500);
  if (!text) {
    res.status(400).send("Missing text");
    return;
  }
  try {
    const svg = await QRCode.toString(text, {
      type: "svg",
      margin: 1,
      width: 168,
      color: {
        dark: "#282631",
        light: "#ffffff"
      }
    });
    res.type("image/svg+xml").send(svg);
  } catch (_error) {
    res.status(500).send("QR generation failed");
  }
});

io.on("connection", (socket) => {
  socket.on("createRoom", (payload, reply) => {
    leaveCurrentRoom(socket, false, true);

    const code = makeRoomCode();
    const player = createPlayer({
      id: socket.id,
      name: payload?.name,
      color: COLORS[0],
      isHost: true,
      controllerId: socket.id
    });
    const room = {
      code,
      hostId: player.id,
      boardId: BOARD_DEFINITIONS[0].id,
      status: "lobby",
      phase: "lobby",
      players: [player],
      round: 1,
      maxRounds: MAX_ROUNDS,
      currentTurnIndex: 0,
      minigameCounter: 0,
      devMode: false,
      currentMinigame: null,
      lastMinigameResult: null,
      resultEndsAt: null,
      lastMessage: "Raum erstellt.",
      lastMove: null,
      winnerIds: [],
      timers: new Set(),
      botTurnTimer: null,
      minigameTick: null,
      skipTurnTimer: null,
      cleanupTimer: null
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    replyOk(reply, room, player.id);
    emitRoom(room);
  });

  socket.on("joinRoom", (payload, reply) => {
    leaveCurrentRoom(socket, false, true);

    const code = normalizeCode(payload?.code);
    const room = rooms.get(code);
    if (!room) return replyError(reply, "Diesen Raum gibt es nicht.");
    if (room.status !== "lobby") return replyError(reply, "Das Spiel läuft bereits.");
    if (room.players.length >= MAX_PLAYERS) return replyError(reply, "Der Raum ist voll.");

    const player = createPlayer({
      id: socket.id,
      name: payload?.name,
      color: COLORS[room.players.length % COLORS.length],
      isHost: false,
      controllerId: socket.id
    });

    room.players.push(player);
    room.lastMessage = `${player.name} ist beigetreten.`;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    replyOk(reply, room, player.id);
    emitRoom(room);
  });

  socket.on("resumeRoom", (payload, reply) => {
    const code = normalizeCode(payload?.code);
    const room = rooms.get(code);
    if (!room) return replyError(reply, "Die vorherige Sitzung existiert nicht mehr.");
    const player = room.players.find((candidate) => candidate.id === payload?.playerId);
    if (!player) return replyError(reply, "Der Spieler gehört nicht mehr zu diesem Raum.");
    const controllerStillConnected = player.controllerId && io.sockets.sockets.has(player.controllerId);
    if (player.connected && controllerStillConnected && player.controllerId !== socket.id) {
      return replyError(reply, "Dieser Spieler ist bereits auf einem anderen Gerät verbunden.");
    }

    leaveCurrentRoom(socket, false, true);
    const controlledPlayers = room.devMode && player.id === room.hostId
      ? room.players.filter((candidate) => candidate.isLocalDev)
      : [player];
    controlledPlayers.forEach((candidate) => {
      candidate.controllerId = socket.id;
      candidate.connected = true;
    });

    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    room.lastMessage = `${player.name} ist wieder verbunden.`;
    replyOk(reply, room, player.id);
    emitRoom(room);
  });

  socket.on("leaveRoom", (_payload, reply) => {
    leaveCurrentRoom(socket, true, true);
    reply?.({ ok: true });
  });

  socket.on("addTestPlayers", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann Bots hinzufügen.");
    if (room.status !== "lobby") return replyError(reply, "Bots können nur in der Lobby hinzugefügt werden.");

    const sampleNames = ["Nova", "Pix", "Sol", "Mo"];
    while (room.players.length < MAX_PLAYERS) {
      const index = room.players.length;
      room.players.push(createPlayer({
        id: `bot_${room.code}_${index}_${Date.now()}`,
        name: sampleNames[index] || `Bot ${index + 1}`,
        color: COLORS[index % COLORS.length],
        isHost: false,
        isBot: true,
        controllerId: null
      }));
    }

    room.lastMessage = "Bots sind der Runde beigetreten.";
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  socket.on("enableDevMode", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann den Dev-Testmodus starten.");
    if (room.status !== "lobby") return replyError(reply, "Dev-Testmodus geht nur in der Lobby.");
    if (room.players.some((player) => player.id !== room.hostId && !player.isBot)) {
      return replyError(reply, "Dev-Testmodus geht nur, wenn du allein im Raum bist.");
    }

    const host = room.players.find((player) => player.id === room.hostId);
    room.players = [];
    const names = [host?.name || "Du", "Dev 2", "Dev 3", "Dev 4"];
    for (let index = 0; index < MAX_PLAYERS; index += 1) {
      room.players.push(createPlayer({
        id: index === 0 ? socket.data.playerId : `local_${room.code}_${index}_${Date.now()}`,
        name: names[index],
        color: COLORS[index % COLORS.length],
        isHost: index === 0,
        isBot: false,
        isLocalDev: true,
        controllerId: socket.id
      }));
    }

    room.devMode = true;
    room.lastMessage = "Dev-Testmodus aktiv: 4 lokale Spieler auf diesem Gerät.";
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  socket.on("selectBoard", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host wählt das Brett.");
    if (room.status !== "lobby") return replyError(reply, "Das Brett kann nur in der Lobby gewechselt werden.");
    const board = BOARD_DEFINITIONS.find((candidate) => candidate.id === payload?.boardId);
    if (!board) return replyError(reply, "Dieses Brett existiert nicht.");
    room.boardId = board.id;
    room.lastMessage = `${board.name} wurde gewählt.`;
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  socket.on("startGame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann starten.");
    if (!room.devMode && room.players.length < 2) {
      return replyError(reply, "Es braucht mindestens zwei Spieler. Lade jemanden ein oder fülle mit Bots auf.");
    }

    startGame(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  socket.on("startDevMinigame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room) || !room.devMode) return replyError(reply, "Diese Aktion gehört zum lokalen Dev-Testmodus.");
    if (room.status !== "board" || room.phase !== "waitingRoll") {
      return replyError(reply, "Die nächste Challenge kann erst auf dem ruhenden Board starten.");
    }
    startMinigame(room, "Dev-Challenge", "returnBoard", payload?.type);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  socket.on("chooseRoute", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    const current = getCurrentPlayer(room);
    if (!current) return replyError(reply, "Kein aktueller Spieler.");
    if (payload?.playerId && payload.playerId !== current.id) {
      return replyError(reply, `${current.name} ist am Zug.`);
    }
    if (!canControl(socket, current)) return replyError(reply, "Du steuerst diesen Spieler nicht.");
    if (room.status !== "board" || room.phase !== "waitingRoll") {
      return replyError(reply, "Der Weg kann nur vor dem Würfeln gewählt werden.");
    }
    if (payload?.routeChoice !== "scenic" && payload?.routeChoice !== "shortcut") {
      return replyError(reply, "Unbekannte Wegwahl.");
    }
    current.routeChoice = payload.routeChoice;
    room.lastMessage = payload.routeChoice === "shortcut"
      ? `${current.name} hält nach der Abkürzung Ausschau.`
      : `${current.name} bleibt auf dem großen Pfad.`;
    reply?.({ ok: true, routeChoice: current.routeChoice });
    emitRoom(room);
  });

  socket.on("rollDice", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    const current = getCurrentPlayer(room);
    if (!current) return replyError(reply, "Kein aktueller Spieler.");
    if (payload?.playerId && payload.playerId !== current.id) {
      return replyError(reply, `${current.name} ist am Zug. Wähle diesen Spieler im Dev-Controller.`);
    }
    if (!canControl(socket, current)) return replyError(reply, "Du bist gerade nicht am Zug.");

    const result = performRoll(room, current);
    if (!result.ok) return replyError(reply, result.error || "Würfeln ist gerade nicht möglich.");
    reply?.({ ok: true, dice: result.dice });
  });

  socket.on("useSabotage", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    const current = getCurrentPlayer(room);
    if (!current) return replyError(reply, "Kein aktueller Spieler.");
    if (payload?.playerId && payload.playerId !== current.id) {
      return replyError(reply, `${current.name} ist am Zug.`);
    }
    if (!canControl(socket, current)) return replyError(reply, "Du steuerst diesen Spieler nicht.");
    const result = performSabotage(room, current);
    if (!result.ok) return replyError(reply, result.error || "Sabotage nicht möglich.");
    reply?.({ ok: true, targetId: result.target.id });
    emitRoom(room);
  });

  socket.on("minigameInput", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    const player = room.players.find((candidate) => candidate.id === payload?.playerId)
      || room.players.find((candidate) => candidate.id === socket.data.playerId);
    if (!player) return replyError(reply, "Spieler nicht gefunden.");
    if (!canControl(socket, player)) return replyError(reply, "Du steuerst diesen Spieler nicht.");
    if (player.connected === false) return replyError(reply, "Dieser Spieler ist offline.");

    const result = handleMinigameInput(room, player, payload?.input || {});
    if (!result.ok) return replyError(reply, result.error || "Input wurde nicht angenommen.");
    reply?.({ ok: true });
  });

  socket.on("restartGame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann neu starten.");
    resetToLobby(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket, true, false);
  });
});

function createPlayer({ id, name, color, isHost = false, isBot = false, isLocalDev = false, controllerId = null }) {
  return {
    id,
    name: cleanName(name, isBot ? "Bot" : "Spieler"),
    color,
    isHost,
    isBot,
    isLocalDev,
    controllerId,
    connected: true,
    coins: STARTING_COINS,
    routeChoice: "scenic",
    position: 0,
    diceValue: null,
    nextRollBoost: 0,
    nextRollPenalty: 0,
    glitchCharges: 0,
    minigameScore: 0
  };
}

function startGame(room) {
  clearRoomTimers(room);
  room.status = "board";
  room.phase = "waitingRoll";
  room.round = 1;
  room.currentTurnIndex = 0;
  room.lastMinigameResult = null;
  room.lastMove = null;
  room.winnerIds = [];
  room.resultEndsAt = null;
  room.lastMessage = `${getBoard(room.boardId).name} erwacht.`;
  room.players.forEach((player, index) => {
    player.isHost = player.id === room.hostId;
    player.coins = STARTING_COINS;
    player.routeChoice = "scenic";
    player.position = 0;
    player.diceValue = null;
    player.nextRollBoost = 0;
    player.nextRollPenalty = 0;
    player.glitchCharges = 0;
    player.minigameScore = 0;
    player.color = COLORS[index % COLORS.length];
  });
}

function resetToLobby(room) {
  clearRoomTimers(room);
  room.status = "lobby";
  room.phase = "lobby";
  room.round = 1;
  room.currentTurnIndex = 0;
  room.currentMinigame = null;
  room.lastMinigameResult = null;
  room.lastMove = null;
  room.winnerIds = [];
  room.resultEndsAt = null;
  room.lastMessage = "Zurück in der Lobby.";
  room.players.forEach((player, index) => {
    player.coins = STARTING_COINS;
    player.routeChoice = "scenic";
    player.position = 0;
    player.diceValue = null;
    player.nextRollBoost = 0;
    player.nextRollPenalty = 0;
    player.glitchCharges = 0;
    player.minigameScore = 0;
    player.color = COLORS[index % COLORS.length];
  });
}

function performRoll(room, player) {
  if (room.status !== "board" || room.phase !== "waitingRoll") {
    return { ok: false, error: "Das Board ist gerade beschäftigt." };
  }
  if (player.connected === false) {
    return { ok: false, error: "Dieser Spieler ist offline." };
  }
  if (getCurrentPlayer(room)?.id !== player.id) {
    return { ok: false, error: "Dieser Spieler ist nicht am Zug." };
  }

  room.phase = "moving";
  const baseDice = 1 + Math.floor(Math.random() * 6);
  const boost = player.nextRollBoost || 0;
  const penalty = player.nextRollPenalty || 0;
  player.nextRollBoost = 0;
  player.nextRollPenalty = 0;
  const dice = clamp(baseDice + boost - penalty, 1, 9);
  const board = getBoard(room.boardId);
  const from = player.position;
  const route = buildBoardPath(board, from, dice, player.routeChoice, player.coins);
  const pathSteps = route.path;
  const shortcuts = route.shortcuts;
  const routeCost = route.cost;
  const to = pathSteps[pathSteps.length - 1];
  player.diceValue = dice;

  const fieldType = board.fieldTypes[to];
  const movementDurationMs = Math.max(BOARD_STEP_MS, pathSteps.length * BOARD_STEP_MS);
  const move = {
    boardId: board.id,
    playerId: player.id,
    from,
    to,
    path: pathSteps,
    dice,
    fieldType,
    routeChoice: player.routeChoice,
    routeCost,
    shortcuts,
    diceDelayMs: DICE_REVEAL_MS,
    stepDurationMs: BOARD_STEP_MS,
    movementDurationMs,
    durationMs: DICE_REVEAL_MS + movementDurationMs,
    message: `${player.name} würfelt ${formatDiceRoll(baseDice, boost, penalty, dice)}.`
  };
  room.lastMove = move;
  room.lastMessage = `${player.name} zieht ${dice} Felder.`;

  io.to(room.code).emit("boardMove", move);
  emitRoom(room);

  const timer = setTrackedTimeout(room, () => {
    if (room.status !== "board" || room.phase !== "moving") return;
    player.position = to;
    const routeEffect = resolveRouteCost(player, board, routeCost, shortcuts.length);
    const gateEffects = resolveGateRewards(player, pathSteps, board);
    const fieldEffect = applyFieldEffect(player, fieldType);
    const messages = [routeEffect?.message, ...gateEffects.map((effect) => effect.message), fieldEffect.message].filter(Boolean);
    const landing = {
      ...move,
      routeEffect,
      fieldEffect,
      gateEffects,
      message: messages.join(" ")
    };
    room.lastMove = landing;
    room.phase = "fieldResult";
    room.lastMessage = landing.message;
    io.to(room.code).emit("boardLanded", landing);
    emitRoom(room);
    setTrackedTimeout(room, () => {
      if (room.status !== "board" || room.phase !== "fieldResult") return;
      if (fieldType === "challenge") {
        startMinigame(room, "Challenge-Feld", "advanceTurn");
        emitRoom(room);
        return;
      }
      advanceTurn(room);
    }, 950);
  }, move.durationMs);

  return { ok: true, dice, timer };
}

function buildBoardPath(board, from, steps, routeChoice = "scenic", coins = 0) {
  const path = [];
  const shortcuts = [];
  let cursor = from;
  let cost = 0;
  let availableCoins = coins;
  for (let step = 1; step <= steps; step += 1) {
    const routes = board.routes[cursor] || [(cursor + 1) % board.fieldTypes.length];
    let next = routes[0];
    if (routes.length > 1 && routeChoice === "shortcut" && availableCoins >= board.routeCost) {
      next = routes[1];
      availableCoins -= board.routeCost;
      cost += board.routeCost;
      shortcuts.push({ from: cursor, to: next });
    }
    path.push(next);
    cursor = next;
  }
  return { path, shortcuts, cost };
}

function resolveRouteCost(player, board, routeCost, shortcutCount) {
  if (!routeCost || !shortcutCount) return null;
  const cost = Math.min(player.coins, routeCost);
  player.coins -= cost;
  return {
    type: "shortcut",
    coins: -cost,
    count: shortcutCount,
    message: `${board.shortcutName}: ${shortcutCount > 1 ? `${shortcutCount} Sprünge` : "Abkürzung"} für ${cost} Münzen.`
  };
}

function resolveGateRewards(player, pathSteps, board = BOARD_DEFINITIONS[0]) {
  return pathSteps
    .filter((fieldIndex) => board.fieldTypes[fieldIndex] === "gate")
    .map((fieldIndex) => {
      const bandName = board.zones[Math.floor(fieldIndex / 8)] || "Band";
      player.coins += GATE_COIN_BONUS;
      return {
        type: "gate",
        fieldIndex,
        coins: GATE_COIN_BONUS,
        message: `${bandName}-Tor: +${GATE_COIN_BONUS} Münzen.`
      };
    });
}

function applyFieldEffect(player, fieldType) {
  if (fieldType === "spark" || fieldType === "start") {
    player.coins += 3;
    return { type: fieldType, coins: 3, message: "Münzfeld: +3 Münzen." };
  }
  if (fieldType === "snag") {
    const loss = Math.min(2, player.coins);
    player.coins -= loss;
    return { type: fieldType, coins: -loss, message: `Hakenfeld: -${loss} Münzen.` };
  }
  if (fieldType === "boost") {
    player.coins += 2;
    player.nextRollBoost = Math.min(4, (player.nextRollBoost || 0) + 2);
    return { type: fieldType, coins: 2, boost: 2, message: "Rückenwind: +2 Münzen und nächster Wurf +2." };
  }
  if (fieldType === "jinx") {
    const before = player.glitchCharges || 0;
    player.glitchCharges = Math.min(3, before + 1);
    player.coins += 1;
    const gained = player.glitchCharges - before;
    return {
      type: fieldType,
      coins: 1,
      glitch: gained,
      message: gained ? "Stupserfeld: +1 Münze und ein Stupser." : "Stupserfeld: Vorrat voll, aber +1 Münze."
    };
  }
  if (fieldType === "gate") {
    return { type: fieldType, coins: 0, message: "" };
  }
  return { type: "challenge", coins: 0, message: "Challenge-Feld: Ein Minispiel startet." };
}

function performSabotage(room, player) {
  if (room.status !== "board" || room.phase !== "waitingRoll") {
    return { ok: false, error: "Sabotage geht nur vor dem Würfeln." };
  }
  if (getCurrentPlayer(room)?.id !== player.id) {
    return { ok: false, error: "Du bist gerade nicht am Zug." };
  }
  if ((player.glitchCharges || 0) <= 0) {
    return { ok: false, error: "Kein Stupser verfügbar." };
  }
  const target = [...room.players]
    .filter((candidate) => candidate.id !== player.id)
    .sort((a, b) => compareStanding(a, b) || b.position - a.position)[0];
  if (!target) return { ok: false, error: "Kein Sabotage-Ziel verfügbar." };

  player.glitchCharges -= 1;
  target.nextRollPenalty = Math.min(4, (target.nextRollPenalty || 0) + 2);
  room.lastMessage = `${player.name} stupst ${target.name}: nächster Wurf -2.`;
  io.to(room.code).emit("roomNotice", { severity: "warning", message: room.lastMessage });
  return { ok: true, target };
}

function formatDiceRoll(baseDice, boost, penalty, result) {
  if (!boost && !penalty) return `eine ${result}`;
  const boostPart = boost ? `+${boost}` : "";
  const penaltyPart = penalty ? `-${penalty}` : "";
  return `${baseDice}${boostPart}${penaltyPart} = ${result}`;
}

function advanceTurn(room) {
  if (room.status !== "board") return;

  const outgoingPlayer = getCurrentPlayer(room);
  if (outgoingPlayer) outgoingPlayer.routeChoice = "scenic";
  room.phase = "waitingRoll";
  const lastIndex = room.players.length - 1;
  if (room.currentTurnIndex >= lastIndex) {
    startMinigame(room, "Runden-Minispiel", "completeRound");
    emitRoom(room);
    return;
  }

  room.currentTurnIndex += 1;
  room.lastMessage = `${getCurrentPlayer(room)?.name || "Nächster Spieler"} ist am Zug.`;
  emitRoom(room);
}

function startMinigame(room, reason, afterAction, forcedType = null) {
  clearRoomTimers(room);

  const template = MINIGAMES.find((minigame) => minigame.type === forcedType)
    || MINIGAMES[room.minigameCounter % MINIGAMES.length];
  room.minigameCounter += 1;
  room.status = "minigame";
  room.phase = "playingMinigame";
  room.lastMove = null;
  room.lastMinigameResult = null;
  room.afterMinigameAction = afterAction;

  const now = Date.now();
  const countdownMs = template.countdownMs || 4200;
  const minigame = {
    id: `${room.code}_${room.minigameCounter}_${now}`,
    type: template.type,
    title: template.title,
    reason,
    startedAt: now + countdownMs,
    duration: template.duration,
    scores: {},
    stopped: {},
    lanes: {},
    hits: {},
    arena: {},
    flux: {},
    canopy: {},
    arcade: null,
    blocks: [],
    resolvedBlocks: {},
    lastInputAt: {}
  };

  room.players.forEach((player) => {
    minigame.scores[player.id] = 0;
    minigame.stopped[player.id] = false;
    minigame.lanes[player.id] = 2;
    minigame.hits[player.id] = 0;
    player.minigameScore = 0;
  });

  if (template.type === "dodgeBlocks") {
    minigame.blocks = createDodgeBlocks(template.duration);
  }
  if (template.type === "bounceArena") {
    minigame.arena = createArenaState(room.players, minigame.startedAt);
  }
  if (template.type === "fluxFloor") {
    minigame.flux = createFluxState(room.players, minigame.startedAt);
    refreshFluxScores(room);
  }
  if (template.type === "canopyClimb") {
    minigame.canopy = createCanopyState(room.players, minigame.startedAt);
  }
  if (template.arcadeFamily) {
    minigame.arcade = createArcadeState(template.type, room.players, minigame.startedAt);
  }

  room.currentMinigame = minigame;
  room.lastMessage = `${template.title} startet.`;

  scheduleBotMinigameInputs(room);
  room.minigameTick = setInterval(() => {
    updateDodgeMinigame(room);
    updateBounceArena(room);
    updateFluxFloor(room);
    updateCanopyClimb(room);
    updateArcade(room);
    emitMinigameUpdate(room);
  }, 90);

  setTrackedTimeout(room, () => finishMinigame(room), countdownMs + template.duration + 350);
}

function handleMinigameInput(room, player, input) {
  const minigame = room.currentMinigame;
  if (room.status !== "minigame" || !minigame) {
    return { ok: false, error: "Gerade läuft kein Minispiel." };
  }
  const now = Date.now();
  if (now < minigame.startedAt) {
    return { ok: false, error: "Das Minispiel startet gleich." };
  }
  if (now > minigame.startedAt + minigame.duration) {
    return { ok: false, error: "Das Minispiel ist vorbei." };
  }

  if (minigame.type === "timingStop") {
    if (input.action !== "stop") return { ok: false, error: "Ungültiger Timing-Input." };
    if (minigame.stopped[player.id]) return { ok: true };
    const score = computeTimingScore(minigame, now);
    minigame.scores[player.id] = score;
    minigame.stopped[player.id] = true;
    player.minigameScore = score;
    emitMinigameUpdate(room);
    if (room.players.every((candidate) => minigame.stopped[candidate.id])) {
      finishMinigame(room);
    }
    return { ok: true };
  }

  if (minigame.type === "dodgeBlocks") {
    if (input.action !== "left" && input.action !== "right") {
      return { ok: false, error: "Ungültiger Dodge-Input." };
    }
    const last = minigame.lastInputAt[player.id] || 0;
    if (now - last < 90) return { ok: true };
    minigame.lastInputAt[player.id] = now;
    const lane = minigame.lanes[player.id] ?? 2;
    minigame.lanes[player.id] = clamp(lane + (input.action === "left" ? -1 : 1), 0, 4);
    emitMinigameUpdate(room);
    return { ok: true };
  }

  if (minigame.type === "bounceArena") {
    const result = handleArenaInput(room, player, input);
    if (!result.ok) return result;
    emitMinigameUpdate(room);
    return { ok: true };
  }

  if (minigame.type === "fluxFloor") {
    const result = handleFluxInput(room, player, input);
    if (!result.ok) return result;
    refreshFluxScores(room);
    emitMinigameUpdate(room);
    return { ok: true };
  }

  if (minigame.type === "canopyClimb") {
    const result = handleCanopyInput(room, player, input);
    if (!result.ok) return result;
    updateCanopyClimb(room);
    if (maybeFinishCanopy(room)) return { ok: true };
    emitMinigameUpdate(room);
    return { ok: true };
  }

  if (minigame.arcade) {
    const result = handleArcadeInput(room, player, input);
    if (!result.ok) return result;
    emitMinigameUpdate(room);
    return { ok: true };
  }

  return { ok: false, error: "Unbekanntes Minispiel." };
}

function scheduleBotMinigameInputs(room) {
  const minigame = room.currentMinigame;
  if (!minigame) return;

  room.players.filter((player) => player.isBot).forEach((bot) => {
    if (minigame.type === "timingStop") {
      const stopDelay = 1600 + Math.floor(Math.random() * (minigame.duration - 1800));
      setTrackedTimeout(room, () => {
        if (room.currentMinigame?.id !== minigame.id || minigame.stopped[bot.id]) return;
        const score = computeTimingScore(minigame, Date.now());
        minigame.scores[bot.id] = Math.max(score, 20 + Math.floor(Math.random() * 45));
        minigame.stopped[bot.id] = true;
        bot.minigameScore = minigame.scores[bot.id];
        emitMinigameUpdate(room);
      }, stopDelay);
    }

    if (minigame.type === "dodgeBlocks") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id) return;
        const elapsed = Date.now() - minigame.startedAt;
        const nextBlock = minigame.blocks.find((block) => block.impactAt > elapsed + 350);
        if (!nextBlock) return;
        const currentLane = minigame.lanes[bot.id] ?? 2;
        if (currentLane === nextBlock.lane) {
          minigame.lanes[bot.id] = currentLane <= 2 ? currentLane + 1 : currentLane - 1;
        } else if (Math.random() > 0.72) {
          minigame.lanes[bot.id] = clamp(currentLane + pick([-1, 1]), 0, 4);
        }
      }, 420 + Math.floor(Math.random() * 180));
      return timer;
    }

    if (minigame.type === "bounceArena") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt) return;
        arenaBotStep(minigame.arena, bot.id);
      }, 180 + Math.floor(Math.random() * 110));
      return timer;
    }

    if (minigame.type === "fluxFloor") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt) return;
        fluxBotStep(room, bot);
      }, 165 + Math.floor(Math.random() * 80));
      return timer;
    }

    if (minigame.type === "canopyClimb") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt) return;
        canopyBotStep(room, bot);
      }, 190 + Math.floor(Math.random() * 100));
      return timer;
    }

    if (minigame.arcade) {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt) return;
        arcadeBotStep(room, bot);
      }, 260 + Math.floor(Math.random() * 150));
      return timer;
    }

    return null;
  });
}

function updateDodgeMinigame(room) {
  const minigame = room.currentMinigame;
  if (!minigame || minigame.type !== "dodgeBlocks") return;
  const elapsed = Date.now() - minigame.startedAt;
  minigame.blocks.forEach((block) => {
    if (minigame.resolvedBlocks[block.id] || elapsed < block.impactAt) return;
    minigame.resolvedBlocks[block.id] = true;
    room.players.forEach((player) => {
      if ((minigame.lanes[player.id] ?? 2) === block.lane) {
        minigame.hits[player.id] = (minigame.hits[player.id] || 0) + 1;
      }
    });
  });
}

function updateBounceArena(room) {
  const minigame = room.currentMinigame;
  if (!minigame || minigame.type !== "bounceArena") return;
  const arena = minigame.arena;
  const now = Date.now();
  if (now < minigame.startedAt) {
    arena.lastUpdateAt = now;
    return;
  }

  const dt = Math.min(0.12, Math.max(0.016, (now - (arena.lastUpdateAt || now)) / 1000));
  arena.lastUpdateAt = now;
  arena.tick = (arena.tick || 0) + 1;

  Object.values(arena.players).forEach((arenaPlayer) => {
    if (!arenaPlayer.alive) return;
    arenaPlayer.vx *= Math.pow(ARENA_DRAG, dt * 10);
    arenaPlayer.vy *= Math.pow(ARENA_DRAG, dt * 10);
    arenaPlayer.x += arenaPlayer.vx * dt;
    arenaPlayer.y += arenaPlayer.vy * dt;
    arenaPlayer.score += dt * 5;
  });

  const entries = Object.entries(arena.players);
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      resolveArenaCollision(entries[a], entries[b]);
    }
  }

  entries.forEach(([playerId, arenaPlayer]) => {
    if (!arenaPlayer.alive) return;
    const distance = Math.hypot(arenaPlayer.x, arenaPlayer.y);
    if (distance <= ARENA_RADIUS) return;
    arenaPlayer.alive = false;
    arenaPlayer.outAt = now;
    arenaPlayer.vx = 0;
    arenaPlayer.vy = 0;
    if (arenaPlayer.lastHitBy && arena.players[arenaPlayer.lastHitBy]) {
      const hitter = arena.players[arenaPlayer.lastHitBy];
      hitter.knockouts += 1;
      hitter.score += 45;
    }
    minigame.scores[playerId] = Math.max(0, Math.round(arenaPlayer.score));
  });

  let aliveCount = 0;
  room.players.forEach((player) => {
    const arenaPlayer = arena.players[player.id];
    if (!arenaPlayer) return;
    if (arenaPlayer.alive) aliveCount += 1;
    minigame.scores[player.id] = Math.max(0, Math.round(arenaPlayer.score));
    player.minigameScore = minigame.scores[player.id];
  });

  const elapsed = now - minigame.startedAt;
  if (aliveCount <= 1 && elapsed > 2400 && room.players.length > 1) {
    finishMinigame(room);
  }
}

function finishMinigame(room) {
  const minigame = room.currentMinigame;
  if (!minigame || room.status !== "minigame") return;

  updateDodgeMinigame(room);
  updateFluxFloor(room);
  updateCanopyClimb(room);
  updateArcade(room);
  clearRoomTimers(room);
  const finishedAt = Date.now();

  room.players.forEach((player) => {
    if (minigame.type === "dodgeBlocks") {
      const hits = minigame.hits[player.id] || 0;
      minigame.scores[player.id] = Math.max(0, 100 - hits * 25);
    }
    if (minigame.type === "bounceArena") {
      const arenaPlayer = minigame.arena.players[player.id];
      minigame.scores[player.id] = bounceResultScore(arenaPlayer, minigame.startedAt, finishedAt);
    }
    if (minigame.type === "timingStop" && !minigame.stopped[player.id]) {
      minigame.scores[player.id] = 0;
    }
    if (minigame.arcade) {
      minigame.scores[player.id] = arcadeRankingScore(minigame.arcade, minigame.arcade.players[player.id]);
    }
    player.minigameScore = minigame.scores[player.id] || 0;
  });

  const ranking = room.players
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      color: player.color,
      score: minigame.scores[player.id] || 0,
      hits: minigame.hits[player.id] || 0,
      detail: minigameResultDetail(minigame, player.id, finishedAt),
      award: 0,
      glitchAward: 0
    }))
    .sort((a, b) => b.score - a.score);

  const awards = [10, 6, 3, 1];
  let rankIndex = 0;
  while (rankIndex < ranking.length) {
    let tieEnd = rankIndex + 1;
    while (tieEnd < ranking.length && ranking[tieEnd].score === ranking[rankIndex].score) tieEnd += 1;
    const occupiedAwards = awards.slice(rankIndex, tieEnd);
    const sharedAward = Math.round(occupiedAwards.reduce((sum, award) => sum + award, 0) / occupiedAwards.length);
    ranking.slice(rankIndex, tieEnd).forEach((entry) => {
      const player = room.players.find((candidate) => candidate.id === entry.playerId);
      entry.award = sharedAward;
      if (player) player.coins += sharedAward;
    });
    rankIndex = tieEnd;
  }

  const winningScore = ranking[0]?.score;
  ranking.filter((entry) => entry.score === winningScore).forEach((entry) => {
    const player = room.players.find((candidate) => candidate.id === entry.playerId);
    if (!player) return;
    const before = player.glitchCharges || 0;
    player.glitchCharges = Math.min(3, before + 1);
    entry.glitchAward = player.glitchCharges - before;
  });

  room.status = "result";
  room.phase = "minigameResult";
  room.lastMinigameResult = {
    id: minigame.id,
    type: minigame.type,
    title: minigame.title,
    reason: minigame.reason,
    ranking
  };
  room.resultEndsAt = Date.now() + RESULT_HOLD_MS;
  room.currentMinigame = null;
  room.lastMessage = `${minigame.title}: ${ranking[0]?.name || "Niemand"} gewinnt.`;
  emitRoom(room);

  setTrackedTimeout(room, () => continueAfterResult(room), RESULT_HOLD_MS);
}

function bounceResultScore(arenaPlayer, startedAt, finishedAt) {
  if (!arenaPlayer) return 0;
  const survivedUntil = arenaPlayer.outAt || finishedAt;
  const survivalMs = Math.max(0, survivedUntil - startedAt);
  const survivorBonus = arenaPlayer.alive ? 100000 : 0;
  return survivorBonus + survivalMs * 10 + (arenaPlayer.knockouts || 0);
}

function arcadeRankingScore(arcade, arcadePlayer) {
  if (!arcadePlayer) return 0;
  const score = Math.max(0, Math.round(arcadePlayer.score || 0));
  const successes = arcadePlayer.successes || 0;
  const mistakes = arcadePlayer.mistakes || 0;
  if (arcade.mode === "sweep" || arcade.mode === "collect") {
    return Math.max(0, 50000 + successes * 100000 - mistakes * 1000 + score);
  }
  if (arcade.mode === "course" || arcade.mode === "avoid") {
    return Math.max(0, 10000000 - mistakes * 100000 + Math.round(arcadePlayer.activeMs || 0));
  }
  if (arcade.mode === "catch") {
    return Math.max(0, 50000 + successes * 100000 - mistakes * 1000 + score);
  }
  if (arcade.mode === "balance" || arcade.mode === "chase" || arcade.mode === "stay") {
    return Math.max(0, Math.round(arcadePlayer.activeMs || 0));
  }
  if (arcade.family === "choice" || arcade.family === "target") {
    return Math.max(0, 50000 + successes * 100000 - mistakes * 100 + score);
  }
  if (arcade.family === "plinko" || arcade.family === "curling") {
    return Math.max(0, score * 1000 + successes);
  }
  return score;
}

function minigameResultDetail(minigame, playerId, finishedAt) {
  if (minigame.type === "canopyClimb") {
    const climber = minigame.canopy.players[playerId];
    return climber?.finishedAt
      ? { kind: "time", value: climber.finishMs, label: "Zielzeit" }
      : { kind: "progress", value: climber?.level || 0, total: minigame.canopy.goal, label: "Blätter" };
  }
  if (minigame.type === "fluxFloor") {
    return { kind: "territory", value: minigame.flux.players[playerId]?.territory || 0, label: "Felder" };
  }
  if (minigame.type === "bounceArena") {
    const arenaPlayer = minigame.arena.players[playerId];
    return {
      kind: "survival",
      value: Math.max(0, (arenaPlayer?.outAt || finishedAt) - minigame.startedAt),
      alive: Boolean(arenaPlayer?.alive),
      knockouts: arenaPlayer?.knockouts || 0,
      label: "Überlebt"
    };
  }
  if (minigame.type === "dodgeBlocks") {
    return { kind: "hits", value: minigame.hits[playerId] || 0, label: "Treffer" };
  }
  if (minigame.arcade) return arcadeResultDetail(minigame.arcade, minigame.arcade.players[playerId]);
  return null;
}

function arcadeResultDetail(arcade, arcadePlayer) {
  if (!arcadePlayer) return null;
  if (arcade.mode === "sweep" || arcade.mode === "collect") {
    return { kind: "coins", value: arcadePlayer.successes || 0, mistakes: arcadePlayer.mistakes || 0, label: "Münzen" };
  }
  if (arcade.mode === "course" || arcade.mode === "avoid") {
    return { kind: "hits", value: arcadePlayer.mistakes || 0, label: "Treffer" };
  }
  if (arcade.mode === "catch") {
    return { kind: "catches", value: arcadePlayer.successes || 0, mistakes: arcadePlayer.mistakes || 0, label: "Lichter" };
  }
  if (arcade.mode === "balance" || arcade.mode === "chase" || arcade.mode === "stay") {
    return { kind: "zoneTime", value: Math.round(arcadePlayer.activeMs || 0), label: "Im Ziel" };
  }
  if (arcade.family === "choice") {
    return { kind: "correct", value: arcadePlayer.successes || 0, mistakes: arcadePlayer.mistakes || 0, label: "Richtig" };
  }
  if (arcade.family === "timing") {
    return { kind: "precision", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Präzision" };
  }
  if (arcade.family === "target") {
    return { kind: "targets", value: arcadePlayer.successes || 0, mistakes: arcadePlayer.mistakes || 0, label: "Treffer" };
  }
  if (arcade.family === "plinko") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "curling") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Ring-Punkte" };
  }
  return null;
}

function continueAfterResult(room) {
  if (room.status !== "result") return;

  if (room.afterMinigameAction === "returnBoard") {
    room.status = "board";
    room.phase = "waitingRoll";
    room.afterMinigameAction = null;
    room.lastMessage = `${getCurrentPlayer(room)?.name || "Nächster Spieler"} ist am Zug.`;
    emitRoom(room);
    return;
  }

  if (room.afterMinigameAction === "completeRound") {
    if (room.round >= room.maxRounds) {
      finishGame(room);
      emitRoom(room);
      return;
    }
    room.round += 1;
    room.currentTurnIndex = 0;
    room.status = "board";
    room.phase = "waitingRoll";
    room.lastMessage = `Runde ${room.round} startet.`;
    emitRoom(room);
    return;
  }

  room.status = "board";
  room.phase = "waitingRoll";
  room.afterMinigameAction = null;
  advanceTurn(room);
}

function finishGame(room) {
  room.status = "end";
  room.phase = "finished";
  const standings = [...room.players].sort(compareStanding);
  const leader = standings[0];
  room.winnerIds = room.players
    .filter((player) => player.coins === leader?.coins)
    .map((player) => player.id);
  room.lastMessage = "Die meisten Münzen gewinnen.";
}

function compareStanding(a, b) {
  return b.coins - a.coins;
}

function createCanopyState(players, startedAt) {
  const leaves = [{ level: 0, side: "center", bend: 0 }];
  let previousSide = Math.random() > 0.5 ? "left" : "right";
  let runLength = 0;
  for (let level = 1; level <= 18; level += 1) {
    let side = Math.random() > 0.5 ? "left" : "right";
    if (side === previousSide) runLength += 1;
    else runLength = 1;
    if (runLength > 2) {
      side = previousSide === "left" ? "right" : "left";
      runLength = 1;
    }
    leaves.push({
      level,
      side,
      bend: Number((Math.random() * 0.34 - 0.17).toFixed(3))
    });
    previousSide = side;
  }

  const canopy = {
    goal: leaves.length - 1,
    leaves,
    players: {},
    actionCounter: 0,
    lastMistake: null
  };
  players.forEach((player) => {
    canopy.players[player.id] = {
      level: 0,
      maxLevel: 0,
      correct: 0,
      mistakes: 0,
      score: 0,
      motion: null,
      finishedAt: null,
      finishMs: null
    };
  });
  return canopy;
}

function handleCanopyInput(room, player, input) {
  const minigame = room.currentMinigame;
  const canopy = minigame?.canopy;
  const climber = canopy?.players?.[player.id];
  if (!canopy || !climber) return { ok: false, error: "Vine-Vault-Zustand fehlt." };
  if (input.action !== "left" && input.action !== "right") {
    return { ok: false, error: "Wähle links oder rechts." };
  }
  const now = Date.now();
  if (climber.finishedAt) return { ok: true };
  const lastInput = minigame.lastInputAt[player.id] || 0;
  if (now - lastInput < 45) return { ok: true };
  minigame.lastInputAt[player.id] = now;
  const nextLevel = Math.min(canopy.goal, climber.level + 1);
  const expectedSide = canopy.leaves[nextLevel]?.side;
  canopy.actionCounter += 1;

  if (input.action === expectedSide) {
    const from = climber.level;
    climber.level = nextLevel;
    climber.maxLevel = Math.max(climber.maxLevel, nextLevel);
    climber.correct += 1;
    if (nextLevel >= canopy.goal) {
      climber.finishedAt = now;
      climber.finishMs = Math.max(0, now - minigame.startedAt);
    }
    climber.motion = {
      id: canopy.actionCounter,
      type: "jump",
      from,
      to: nextLevel,
      side: input.action,
      startedAt: now,
      duration: 170
    };
    return { ok: true, correct: true };
  }

  const from = climber.level;
  const fallback = nearestLowerCanopyLeaf(canopy, from, input.action);
  const distance = Math.max(1, from - fallback);
  const duration = Math.min(430, 170 + distance * 48);
  climber.level = fallback;
  climber.motion = {
    id: canopy.actionCounter,
    type: "fall",
    from,
    to: fallback,
    side: input.action,
    startedAt: now,
    duration
  };
  climber.mistakes += 1;
  canopy.lastMistake = { playerId: player.id, side: input.action, at: now, id: canopy.actionCounter };
  return { ok: true, correct: false };
}

function nearestLowerCanopyLeaf(canopy, fromLevel, side) {
  for (let level = Math.max(0, fromLevel - 1); level > 0; level -= 1) {
    if (canopy.leaves[level]?.side === side) return level;
  }
  return 0;
}

function updateCanopyClimb(room) {
  const minigame = room.currentMinigame;
  const canopy = minigame?.canopy;
  if (!canopy || minigame.type !== "canopyClimb") return;
  const now = Date.now();

  room.players.forEach((player) => {
    const climber = canopy.players[player.id];
    if (!climber) return;
    if (climber.motion && now >= climber.motion.startedAt + climber.motion.duration) {
      climber.motion = null;
    }
    climber.score = canopyRaceScore(climber);
    minigame.scores[player.id] = climber.score;
    player.minigameScore = climber.score;
  });
}

function canopyRaceScore(climber) {
  if (climber.finishedAt) return 100000 - Math.min(99999, climber.finishMs || 0);
  return Math.max(0, climber.level * 1000 + climber.maxLevel * 10 - climber.mistakes);
}

function maybeFinishCanopy(room) {
  const canopy = room.currentMinigame?.canopy;
  if (!canopy || room.currentMinigame?.type !== "canopyClimb") return false;
  if (!room.players.length || !room.players.every((player) => canopy.players[player.id]?.finishedAt)) return false;
  finishMinigame(room);
  return true;
}

function canopyBotStep(room, bot) {
  const canopy = room.currentMinigame?.canopy;
  const climber = canopy?.players?.[bot.id];
  if (!canopy || !climber || climber.finishedAt) return;
  const expected = canopy.leaves[Math.min(canopy.goal, climber.level + 1)]?.side || "left";
  const action = Math.random() > 0.12 ? expected : (expected === "left" ? "right" : "left");
  handleCanopyInput(room, bot, { action });
  updateCanopyClimb(room);
  maybeFinishCanopy(room);
}

function createFluxState(players, startedAt) {
  const starts = [[1, 1], [7, 7], [7, 1], [1, 7]];
  const flux = {
    size: FLUX_SIZE,
    blocked: FLUX_BLOCKED.map((cell) => [...cell]),
    grid: Array.from({ length: FLUX_SIZE }, () => Array(FLUX_SIZE).fill(null)),
    players: {},
    actionCounter: 0,
    lastAction: null
  };

  players.forEach((player, index) => {
    const [x, y] = starts[index % starts.length];
    flux.players[player.id] = {
      x,
      y,
      territory: 0,
      bumps: 0,
      bursts: 0,
      nextBurstAt: startedAt + 650,
      lastMoveAt: startedAt
    };
    paintFluxCell(flux, player.id, x, y);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      paintFluxCell(flux, player.id, x + dx, y + dy);
    });
  });
  return flux;
}

function handleFluxInput(room, player, input) {
  const minigame = room.currentMinigame;
  const flux = minigame?.flux;
  const fluxPlayer = flux?.players?.[player.id];
  if (!flux || !fluxPlayer) return { ok: false, error: "Flux-Spieler nicht gefunden." };

  const action = input.action;
  const directions = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
  };
  const now = Date.now();

  if (action === "burst") {
    if (now < fluxPlayer.nextBurstAt) return { ok: true };
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        paintFluxCell(flux, player.id, fluxPlayer.x + dx, fluxPlayer.y + dy);
      }
    }

    Object.entries(flux.players).forEach(([otherId, other]) => {
      if (otherId === player.id) return;
      const deltaX = other.x - fluxPlayer.x;
      const deltaY = other.y - fluxPlayer.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 1) return;
      const pushX = other.x + Math.sign(deltaX || (Math.random() > 0.5 ? 1 : -1));
      const pushY = other.y + Math.sign(deltaY);
      if (!isFluxBlocked(flux, pushX, pushY) && !fluxPlayerAt(flux, pushX, pushY, otherId)) {
        other.x = pushX;
        other.y = pushY;
        paintFluxCell(flux, otherId, pushX, pushY);
      }
      fluxPlayer.bumps += 1;
    });

    fluxPlayer.bursts += 1;
    fluxPlayer.nextBurstAt = now + FLUX_BURST_COOLDOWN;
    markFluxAction(flux, player.id, action, fluxPlayer.x, fluxPlayer.y, now);
    return { ok: true };
  }

  const direction = directions[action];
  if (!direction) return { ok: false, error: "Ungültiger Flux-Floor-Input." };
  if (now - fluxPlayer.lastMoveAt < FLUX_MOVE_COOLDOWN) return { ok: true };
  fluxPlayer.lastMoveAt = now;

  const [dx, dy] = direction;
  const targetX = fluxPlayer.x + dx;
  const targetY = fluxPlayer.y + dy;
  if (isFluxBlocked(flux, targetX, targetY)) return { ok: true };

  const occupantEntry = Object.entries(flux.players)
    .find(([otherId, other]) => otherId !== player.id && other.x === targetX && other.y === targetY);
  if (occupantEntry) {
    const [otherId, other] = occupantEntry;
    const pushX = targetX + dx;
    const pushY = targetY + dy;
    if (!isFluxBlocked(flux, pushX, pushY) && !fluxPlayerAt(flux, pushX, pushY, otherId)) {
      other.x = pushX;
      other.y = pushY;
    } else {
      other.x = fluxPlayer.x;
      other.y = fluxPlayer.y;
    }
    paintFluxCell(flux, otherId, other.x, other.y);
    fluxPlayer.bumps += 1;
  }

  fluxPlayer.x = targetX;
  fluxPlayer.y = targetY;
  paintFluxCell(flux, player.id, targetX, targetY);
  markFluxAction(flux, player.id, action, targetX, targetY, now);
  return { ok: true };
}

function updateFluxFloor(room) {
  const minigame = room.currentMinigame;
  if (!minigame || minigame.type !== "fluxFloor") return;
  refreshFluxScores(room);
}

function refreshFluxScores(room) {
  const minigame = room.currentMinigame;
  const flux = minigame?.flux;
  if (!flux || minigame.type !== "fluxFloor") return;

  const territory = {};
  flux.grid.forEach((row) => row.forEach((ownerId) => {
    if (ownerId) territory[ownerId] = (territory[ownerId] || 0) + 1;
  }));

  room.players.forEach((player) => {
    const fluxPlayer = flux.players[player.id];
    if (!fluxPlayer) return;
    fluxPlayer.territory = territory[player.id] || 0;
    minigame.scores[player.id] = fluxPlayer.territory;
    player.minigameScore = minigame.scores[player.id];
  });
}

function fluxBotStep(room, bot) {
  const minigame = room.currentMinigame;
  const flux = minigame?.flux;
  const fluxPlayer = flux?.players?.[bot.id];
  if (!fluxPlayer) return;

  const now = Date.now();
  const nearbyRival = Object.entries(flux.players).some(([id, other]) => (
    id !== bot.id && Math.max(Math.abs(other.x - fluxPlayer.x), Math.abs(other.y - fluxPlayer.y)) <= 1
  ));
  if (now >= fluxPlayer.nextBurstAt && (nearbyRival || Math.random() > 0.72)) {
    handleFluxInput(room, bot, { action: "burst" });
    refreshFluxScores(room);
    return;
  }

  let target = null;
  let bestDistance = Infinity;
  flux.grid.forEach((row, y) => row.forEach((ownerId, x) => {
    if (ownerId === bot.id || isFluxBlocked(flux, x, y)) return;
    const distance = Math.abs(x - fluxPlayer.x) + Math.abs(y - fluxPlayer.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      target = { x, y };
    }
  }));

  let action = pick(["up", "down", "left", "right"]);
  if (target && Math.random() > 0.18) {
    const dx = target.x - fluxPlayer.x;
    const dy = target.y - fluxPlayer.y;
    if (Math.abs(dx) > Math.abs(dy)) action = dx < 0 ? "left" : "right";
    else if (dy !== 0) action = dy < 0 ? "up" : "down";
  }
  handleFluxInput(room, bot, { action });
  refreshFluxScores(room);
}

function paintFluxCell(flux, playerId, x, y) {
  if (isFluxBlocked(flux, x, y)) return false;
  const previousOwner = flux.grid[y][x];
  if (previousOwner === playerId) return false;
  flux.grid[y][x] = playerId;
  return true;
}

function fluxPlayerAt(flux, x, y, ignoredId = null) {
  return Object.entries(flux.players)
    .some(([playerId, player]) => playerId !== ignoredId && player.x === x && player.y === y);
}

function isFluxBlocked(flux, x, y) {
  if (x < 0 || x >= flux.size || y < 0 || y >= flux.size) return true;
  return flux.blocked.some(([blockedX, blockedY]) => blockedX === x && blockedY === y);
}

function markFluxAction(flux, playerId, action, x, y, at) {
  flux.actionCounter += 1;
  flux.lastAction = { id: flux.actionCounter, playerId, action, x, y, at };
}

function createArenaState(players, startedAt) {
  const arena = {
    radius: ARENA_RADIUS,
    ballRadius: ARENA_BALL_RADIUS,
    lastUpdateAt: startedAt,
    tick: 0,
    players: {}
  };
  players.forEach((player, index) => {
    const angle = (index / Math.max(1, players.length)) * Math.PI * 2 - Math.PI / 2;
    arena.players[player.id] = {
      x: Math.cos(angle) * 0.46,
      y: Math.sin(angle) * 0.46,
      vx: -Math.sin(angle) * 0.08,
      vy: Math.cos(angle) * 0.08,
      alive: true,
      score: 0,
      knockouts: 0,
      lastHitBy: null,
      collisionCount: 0,
      lastCollisionAt: 0,
      outAt: null
    };
  });
  return arena;
}

function handleArenaInput(room, player, input) {
  const minigame = room.currentMinigame;
  const arenaPlayer = minigame?.arena?.players?.[player.id];
  if (!arenaPlayer || !arenaPlayer.alive) return { ok: false, error: "Deine Kugel ist schon raus." };

  const now = Date.now();
  const last = minigame.lastInputAt[player.id] || 0;
  if (now - last < 45) return { ok: true };
  minigame.lastInputAt[player.id] = now;

  const action = input.action;
  if (action === "up" || action === "down" || action === "left" || action === "right") {
    const dx = action === "left" ? -1 : action === "right" ? 1 : 0;
    const dy = action === "up" ? -1 : action === "down" ? 1 : 0;
    arenaPlayer.vx += dx * ARENA_FORCE;
    arenaPlayer.vy += dy * ARENA_FORCE;
    clampArenaSpeed(arenaPlayer);
    return { ok: true };
  }

  if (action === "bump") {
    let dx = arenaPlayer.vx;
    let dy = arenaPlayer.vy;
    const speed = Math.hypot(dx, dy);
    if (speed < 0.18) {
      dx = arenaPlayer.x || 0.01;
      dy = arenaPlayer.y || 0.01;
    }
    const length = Math.max(0.01, Math.hypot(dx, dy));
    arenaPlayer.vx += (dx / length) * ARENA_BUMP_FORCE;
    arenaPlayer.vy += (dy / length) * ARENA_BUMP_FORCE;
    arenaPlayer.score += 1;
    clampArenaSpeed(arenaPlayer);
    return { ok: true };
  }

  return { ok: false, error: "Ungültiger Bounce-Arena-Input." };
}

function resolveArenaCollision(entryA, entryB) {
  const [idA, a] = entryA;
  const [idB, b] = entryB;
  if (!a.alive || !b.alive) return;

  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  const minDistance = ARENA_BALL_RADIUS * 2;
  if (distance >= minDistance) return;

  if (distance < 0.001) {
    dx = 0.01;
    dy = 0;
    distance = 0.01;
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = (minDistance - distance) / 2;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  const relVel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  const approachSpeed = Math.max(0, -relVel);
  const impulse = 0.48 + approachSpeed * 1.42;
  a.vx -= nx * impulse;
  a.vy -= ny * impulse;
  b.vx += nx * impulse;
  b.vy += ny * impulse;
  clampArenaSpeed(a);
  clampArenaSpeed(b);

  a.lastHitBy = idB;
  b.lastHitBy = idA;
  const collisionAt = Date.now();
  if (collisionAt - a.lastCollisionAt > 120) a.collisionCount += 1;
  if (collisionAt - b.lastCollisionAt > 120) b.collisionCount += 1;
  a.lastCollisionAt = collisionAt;
  b.lastCollisionAt = collisionAt;
  a.score += 2;
  b.score += 2;
}

function arenaBotStep(arena, playerId) {
  const bot = arena?.players?.[playerId];
  if (!bot?.alive) return;

  const distanceFromCenter = Math.hypot(bot.x, bot.y);
  let targetX = -bot.x;
  let targetY = -bot.y;

  if (distanceFromCenter < ARENA_RADIUS * 0.72) {
    const opponents = Object.entries(arena.players)
      .filter(([id, candidate]) => id !== playerId && candidate.alive)
      .map(([_id, candidate]) => candidate)
      .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y));
    if (opponents[0]) {
      targetX = opponents[0].x - bot.x;
      targetY = opponents[0].y - bot.y;
    }
  }

  const length = Math.max(0.01, Math.hypot(targetX, targetY));
  bot.vx += (targetX / length) * ARENA_FORCE * 0.82;
  bot.vy += (targetY / length) * ARENA_FORCE * 0.82;
  if (Math.random() > 0.72) {
    bot.vx += (targetX / length) * ARENA_BUMP_FORCE * 0.55;
    bot.vy += (targetY / length) * ARENA_BUMP_FORCE * 0.55;
  }
  clampArenaSpeed(bot);
}

function clampArenaSpeed(arenaPlayer) {
  const speed = Math.hypot(arenaPlayer.vx, arenaPlayer.vy);
  if (speed <= ARENA_MAX_SPEED) return;
  arenaPlayer.vx = (arenaPlayer.vx / speed) * ARENA_MAX_SPEED;
  arenaPlayer.vy = (arenaPlayer.vy / speed) * ARENA_MAX_SPEED;
}

function createArcadeState(type, players, startedAt) {
  const config = ARCADE_CONFIGS[type];
  const arcade = {
    type,
    family: config.family,
    mode: config.steerMode || config.targetMode || config.kineticMode || config.directMode || null,
    seed: config.seed,
    beatMs: config.beatMs || null,
    choiceDelay: config.choiceDelay || 0,
    periodMs: config.periodMs || null,
    timingTarget: config.target ?? null,
    timingWindow: config.timingWindow || null,
    dynamicTiming: Boolean(config.dynamicTiming),
    spawnMs: config.spawnMs || null,
    cueIndex: -1,
    cue: "left",
    cueAt: startedAt,
    target: { x: 0.5, y: 0.46, index: 0, changedAt: startedAt },
    targets: [],
    hazards: [],
    drops: [],
    sweepAngle: 0,
    zoneWidth: 0.16,
    nextTargetId: 1,
    lastSpawnAt: startedAt - (config.spawnMs || 0),
    lastUpdateAt: startedAt,
    players: {}
  };

  players.forEach((player, index) => {
    const angle = (index / Math.max(1, players.length)) * Math.PI * 2 - Math.PI / 2;
    arcade.players[player.id] = {
      x: 0.5 + Math.cos(angle) * 0.22,
      y: 0.5 + Math.sin(angle) * 0.2,
      desiredX: 0.5,
      vx: 0,
      vy: 0,
      score: 0,
      streak: 0,
      successes: 0,
      mistakes: 0,
      activeMs: 0,
      lastCueIndex: -1,
      lastTimingCycle: -1,
      lastInputAt: 0,
      lastHitAt: 0,
      hasMoved: false,
      flash: null,
      hitTargets: {},
      inside: false,
      collisionUntil: 0
    };
  });

  if (config.steerMode === "collect") relocateArcadeTarget(arcade);
  if (config.steerMode === "avoid") {
    arcade.hazards = Array.from({ length: 4 }, (_, index) => ({
      id: index,
      x: 0.2 + arcadeNoise(config.seed + index * 7) * 0.6,
      y: 0.18 + arcadeNoise(config.seed + index * 11 + 3) * 0.58,
      vx: (arcadeNoise(config.seed + index * 13 + 5) - 0.5) * 0.34,
      vy: (arcadeNoise(config.seed + index * 17 + 9) - 0.5) * 0.34,
      radius: 0.055 + (index % 2) * 0.012
    }));
  }
  if (config.kineticMode === "sweep") {
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const angle = index / Math.max(1, players.length) * Math.PI * 2 - Math.PI / 2;
      entry.x = 0.5 + Math.cos(angle) * 0.23;
      entry.y = 0.5 + Math.sin(angle) * 0.23;
    });
    relocateArcadeTarget(arcade);
  }
  if (config.kineticMode === "course") {
    arcade.hazards = Array.from({ length: 7 }, (_, index) => ({
      id: index,
      x: 0.12 + arcadeNoise(config.seed + index * 19) * 0.76,
      y: -0.08 + index * 0.17,
      speed: 0.15 + arcadeNoise(config.seed + index * 31 + 7) * 0.12,
      radius: 0.055 + (index % 3) * 0.009,
      wraps: 0
    }));
  }
  if (config.directMode) {
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.x = 0.5;
      entry.y = 0.78;
      entry.desiredX = 0.5;
    });
  }
  if (config.family === "plinko") {
    // Logical space is 1 wide and PLINKO_FLOOR_Y tall so client pixels can
    // use one uniform scale on both axes (collisions look exact on screen).
    arcade.pegs = [];
    for (let row = 0; row < 5; row += 1) {
      const count = row % 2 === 0 ? 6 : 5;
      for (let index = 0; index < count; index += 1) {
        arcade.pegs.push({
          x: (index + (row % 2 === 0 ? 0.5 : 1)) / 6,
          y: 0.32 + row * 0.19,
          r: 0.024
        });
      }
    }
    arcade.floorY = PLINKO_FLOOR_Y;
    arcade.slots = [...PLINKO_SLOTS];
    arcade.balls = [];
    arcade.nextBallId = 1;
    players.forEach((player, index) => {
      arcade.players[player.id].aimX = 0.2 + index * 0.2;
      arcade.players[player.id].plinks = 0;
    });
  }
  if (config.family === "curling") {
    // Logical sheet is 1 wide and CURLING_SHEET_Y tall (uniform scale, see plinko).
    arcade.house = { x: 0.5, y: 0.3 };
    arcade.sheetY = CURLING_SHEET_Y;
    arcade.rings = CURLING_RINGS.map((ring) => ({ ...ring }));
    arcade.stones = [];
    arcade.nextStoneId = 1;
    arcade.clacks = 0;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      entry.stonesLeft = CURLING_STONES_PER_PLAYER;
      entry.startX = 0.2 + index * 0.2;
    });
  }
  return arcade;
}

function handleArcadeInput(room, player, input) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  const arcadePlayer = arcade?.players?.[player.id];
  if (!arcade || !arcadePlayer) return { ok: false, error: "Arcade-Spiel nicht bereit." };

  const now = Date.now();
  const cooldown = arcade.family === "steer" || arcade.family === "kinetic"
    ? 55
    : (arcade.family === "direct" ? 42 : (arcade.family === "plinko" || arcade.family === "curling" ? 180 : 100));
  if (now - arcadePlayer.lastInputAt < cooldown) return { ok: true };
  arcadePlayer.lastInputAt = now;

  if (arcade.family === "plinko") {
    if (input.action !== "drop") return { ok: false, error: "Tippe, um eine Kugel fallen zu lassen." };
    const inFlight = arcade.balls.some((ball) => ball.playerId === player.id);
    if (inFlight) return { ok: true };
    const x = clamp(Number(input.x) || 0.5, 0.06, 0.94);
    arcadePlayer.aimX = x;
    arcadePlayer.hasMoved = true;
    arcade.balls.push({
      id: arcade.nextBallId++,
      playerId: player.id,
      x,
      y: 0.05,
      vx: (arcadeNoise(arcade.seed + arcade.nextBallId * 13) - 0.5) * 0.06,
      vy: 0.05,
      plinks: 0
    });
    return { ok: true };
  }

  if (arcade.family === "curling") {
    if (input.action !== "flick") return { ok: false, error: "Wische, um einen Stein zu schieben." };
    if ((arcadePlayer.stonesLeft || 0) <= 0) return { ok: false, error: "Keine Steine mehr." };
    const dx = clamp(Number(input.dx) || 0, -1, 1);
    const dy = clamp(Number(input.dy) || 0, -1, 0.1);
    const power = Math.min(1, Math.hypot(dx, dy));
    if (power < 0.08) return { ok: true };
    arcadePlayer.stonesLeft -= 1;
    arcadePlayer.successes += 1;
    arcadePlayer.hasMoved = true;
    arcade.stones.push({
      id: arcade.nextStoneId++,
      playerId: player.id,
      x: arcadePlayer.startX || 0.5,
      y: CURLING_SHEET_Y - 0.14,
      vx: dx * 1.35,
      vy: dy * 1.7,
      lastCollisionAt: 0
    });
    arcadePlayer.flash = "good";
    arcadePlayer.lastHitAt = now;
    return { ok: true };
  }

  if (arcade.family === "choice") {
    if (input.action !== "left" && input.action !== "right") {
      return { ok: false, error: "Wähle links oder rechts." };
    }
    const cueIndex = Math.max(0, Math.floor((now - minigame.startedAt) / arcade.beatMs));
    const answerIndex = cueIndex - (arcade.choiceDelay || 0);
    if (answerIndex < 0) return { ok: true };
    const expected = arcadeChoice(arcade, answerIndex);
    if (arcadePlayer.lastCueIndex === cueIndex) return { ok: true };
    arcadePlayer.lastCueIndex = cueIndex;
    const correct = input.action === expected;
    if (correct) arcadePlayer.successes += 1;
    else arcadePlayer.mistakes += 1;
    arcadePlayer.streak = correct ? arcadePlayer.streak + 1 : 0;
    arcadePlayer.score = Math.max(0, arcadePlayer.score + (correct ? 8 + Math.min(8, arcadePlayer.streak) : -4));
    arcadePlayer.flash = correct ? "good" : "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(minigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "timing") {
    if (input.action !== "tap") return { ok: false, error: "Tippe im richtigen Moment." };
    const cycle = Math.max(0, Math.floor((now - minigame.startedAt) / arcade.periodMs));
    if (arcadePlayer.lastTimingCycle === cycle) return { ok: true };
    arcadePlayer.lastTimingCycle = cycle;
    if (arcade.dynamicTiming) arcade.timingTarget = arcadeDynamicTimingTarget(arcade, cycle);
    const phase = arcadeTimingPhase(arcade, minigame.startedAt, now);
    const distance = circularDistance(phase, arcade.timingTarget);
    const timingWindow = arcade.timingWindow || 0.27;
    const points = Math.round(Math.max(0, 24 * (1 - distance / timingWindow)));
    if (points > 0) arcadePlayer.successes += 1;
    else arcadePlayer.mistakes += 1;
    arcadePlayer.score = Math.max(0, arcadePlayer.score + (points > 0 ? points : -4));
    arcadePlayer.streak = points >= 12 ? arcadePlayer.streak + 1 : 0;
    arcadePlayer.flash = points >= 12 ? "good" : "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(minigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "steer" || arcade.family === "kinetic") {
    const directions = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const direction = directions[input.action];
    if (!direction) return { ok: false, error: "Ungültige Richtung." };
    const impulse = arcade.family === "kinetic" ? (arcade.mode === "sweep" ? 0.38 : 0.31) : (arcade.mode === "avoid" ? 0.28 : 0.34);
    arcadePlayer.hasMoved = true;
    arcadePlayer.vx = clamp(arcadePlayer.vx + direction[0] * impulse, -0.9, 0.9);
    arcadePlayer.vy = clamp(arcadePlayer.vy + direction[1] * impulse, -0.9, 0.9);
    return { ok: true };
  }

  if (arcade.family === "direct") {
    if (input.action !== "move") return { ok: false, error: "Ziehe horizontal über das Spielfeld." };
    const x = clamp(Number(input.x) || 0, 0.06, 0.94);
    arcadePlayer.hasMoved = true;
    arcadePlayer.desiredX = x;
    if (arcade.mode === "catch") arcadePlayer.x = x;
    return { ok: true };
  }

  if (arcade.family === "target") {
    if (input.action !== "target") return { ok: false, error: "Tippe ein Ziel an." };
    const x = clamp(Number(input.x) || 0, 0, 1);
    const y = clamp(Number(input.y) || 0, 0, 1);
    const active = arcade.targets
      .filter((target) => now >= target.spawnAt && now <= target.expiresAt && !arcadePlayer.hitTargets[target.id])
      .map((target) => ({ target, position: arcadeTargetPosition(arcade, target, now) }))
      .sort((a, b) => Math.hypot(a.position.x - x, a.position.y - y) - Math.hypot(b.position.x - x, b.position.y - y));
    const nearest = active[0];
    if (!nearest || Math.hypot(nearest.position.x - x, nearest.position.y - y) > nearest.target.radius * 1.35) {
      arcadePlayer.mistakes += 1;
      arcadePlayer.score = Math.max(0, arcadePlayer.score - 2);
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
      syncArcadeScore(minigame, player, arcadePlayer);
      return { ok: true };
    }

    const target = nearest.target;
    const correct = target.kind !== "bad";
    arcadePlayer.hitTargets[target.id] = true;
    const base = target.kind === "gold" ? 22 : 12;
    if (correct) arcadePlayer.successes += 1;
    else arcadePlayer.mistakes += 1;
    arcadePlayer.streak = correct ? arcadePlayer.streak + 1 : 0;
    arcadePlayer.score = Math.max(0, arcadePlayer.score + (correct ? base + Math.min(5, arcadePlayer.streak) : -9));
    arcadePlayer.flash = correct ? "good" : "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(minigame, player, arcadePlayer);
    return { ok: true };
  }

  return { ok: false, error: "Unbekannte Arcade-Steuerung." };
}

function updateArcade(room) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  if (!arcade) return;
  const now = Date.now();
  if (now < minigame.startedAt) {
    arcade.lastUpdateAt = now;
    return;
  }

  if (arcade.family === "choice") {
    arcade.cueIndex = Math.max(0, Math.floor((now - minigame.startedAt) / arcade.beatMs));
    arcade.cue = arcadeChoice(arcade, arcade.cueIndex);
    const echoIndex = arcade.cueIndex - (arcade.choiceDelay || 0);
    arcade.echoCue = echoIndex >= 0 ? arcadeChoice(arcade, echoIndex) : null;
    arcade.cueAt = minigame.startedAt + arcade.cueIndex * arcade.beatMs;
  }
  if (arcade.family === "timing" && arcade.dynamicTiming) {
    const cycle = Math.max(0, Math.floor((now - minigame.startedAt) / arcade.periodMs));
    arcade.timingTarget = arcadeDynamicTimingTarget(arcade, cycle);
  }
  if (arcade.family === "target") updateArcadeTargets(arcade, now);

  if (arcade.family === "steer") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    const elapsed = Math.max(0, now - minigame.startedAt);
    arcade.lastUpdateAt = now;
    updateArcadeWorld(arcade, elapsed, dt, now);
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      entry.vx *= Math.pow(0.82, dt * 10);
      entry.vy *= Math.pow(0.82, dt * 10);
      entry.x += entry.vx * dt;
      entry.y += entry.vy * dt;
      bounceArcadePlayer(entry);
      scoreArcadeSteerPlayer(arcade, entry, dt, now);
      syncArcadeScore(minigame, player, entry);
    });
  }

  if (arcade.family === "kinetic") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    const elapsed = Math.max(0, now - minigame.startedAt);
    arcade.lastUpdateAt = now;
    updateKineticWorld(arcade, elapsed, dt, now);
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      entry.vx *= Math.pow(0.8, dt * 10);
      entry.vy *= Math.pow(0.8, dt * 10);
      entry.x += entry.vx * dt;
      entry.y += entry.vy * dt;
      if (arcade.mode === "sweep") containKineticPlayer(entry);
      else bounceArcadePlayer(entry);
      scoreKineticPlayer(arcade, entry, dt, now);
      syncArcadeScore(minigame, player, entry);
    });
  }

  if (arcade.family === "direct") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    const elapsed = Math.max(0, now - minigame.startedAt);
    arcade.lastUpdateAt = now;
    updateDirectWorld(room, minigame, arcade, elapsed, dt, now);
  }

  if (arcade.family === "plinko") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updatePlinko(room, minigame, arcade, dt, now);
  }

  if (arcade.family === "curling") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updateCurling(room, minigame, arcade, dt, now);
  }
}

function updatePlinko(room, minigame, arcade, dt, now) {
  arcade.balls.forEach((ball) => {
    ball.vy += PLINKO_GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < 0.035) {
      ball.x = 0.035;
      ball.vx = Math.abs(ball.vx) * 0.6;
    } else if (ball.x > 0.965) {
      ball.x = 0.965;
      ball.vx = -Math.abs(ball.vx) * 0.6;
    }

    arcade.pegs.forEach((peg) => {
      const dx = ball.x - peg.x;
      const dy = ball.y - peg.y;
      const distance = Math.hypot(dx, dy);
      const minDistance = peg.r + 0.028;
      if (distance >= minDistance || distance === 0) return;
      const nx = dx / distance;
      const ny = dy / distance;
      ball.x = peg.x + nx * minDistance;
      ball.y = peg.y + ny * minDistance;
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
        ball.vx *= 0.55;
        ball.vy *= 0.55;
        ball.vx += (arcadeNoise(arcade.seed + ball.id * 7 + ball.plinks * 3) - 0.5) * 0.09;
        ball.plinks += 1;
        const owner = arcade.players[ball.playerId];
        if (owner) owner.plinks = (owner.plinks || 0) + 1;
      }
    });
  });

  const landed = arcade.balls.filter((ball) => ball.y >= arcade.floorY - 0.03);
  landed.forEach((ball) => {
    const slot = clamp(Math.floor(ball.x * arcade.slots.length), 0, arcade.slots.length - 1);
    const points = arcade.slots[slot];
    const owner = arcade.players[ball.playerId];
    if (owner) {
      owner.score += points;
      owner.successes += 1;
      owner.streak = points >= 7 ? owner.streak + 1 : 0;
      owner.flash = points >= 7 ? "good" : "bad";
      owner.lastHitAt = now;
      owner.lastSlot = { slot, points, at: now };
    }
  });
  arcade.balls = arcade.balls.filter((ball) => ball.y < arcade.floorY - 0.03);

  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (entry) syncArcadeScore(minigame, player, entry);
  });
}

function updateCurling(room, minigame, arcade, dt, now) {
  arcade.stones.forEach((stone) => {
    const speed = Math.hypot(stone.vx, stone.vy);
    if (speed < 0.015) {
      stone.vx = 0;
      stone.vy = 0;
      return;
    }
    const damping = Math.pow(0.38, dt);
    stone.vx *= damping;
    stone.vy *= damping;
    stone.x += stone.vx * dt;
    stone.y += stone.vy * dt;
    if (stone.x < 0.05) { stone.x = 0.05; stone.vx = Math.abs(stone.vx) * 0.5; }
    if (stone.x > 0.95) { stone.x = 0.95; stone.vx = -Math.abs(stone.vx) * 0.5; }
    if (stone.y < 0.06) { stone.y = 0.06; stone.vy = Math.abs(stone.vy) * 0.5; }
    if (stone.y > CURLING_SHEET_Y - 0.06) { stone.y = CURLING_SHEET_Y - 0.06; stone.vy = -Math.abs(stone.vy) * 0.5; }
  });

  const stoneRadius = 0.042;
  for (let a = 0; a < arcade.stones.length; a += 1) {
    for (let b = a + 1; b < arcade.stones.length; b += 1) {
      const first = arcade.stones[a];
      const second = arcade.stones[b];
      let dx = second.x - first.x;
      let dy = second.y - first.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= stoneRadius * 2) continue;
      if (distance < 0.001) { dx = 0.01; dy = 0; distance = 0.01; }
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = (stoneRadius * 2 - distance) / 2;
      first.x -= nx * overlap;
      first.y -= ny * overlap;
      second.x += nx * overlap;
      second.y += ny * overlap;
      const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
      if (relative < 0) {
        const impulse = -relative * 0.86;
        first.vx -= nx * impulse;
        first.vy -= ny * impulse;
        second.vx += nx * impulse;
        second.vy += ny * impulse;
        if (now - Math.max(first.lastCollisionAt, second.lastCollisionAt) > 140) {
          arcade.clacks = (arcade.clacks || 0) + 1;
        }
        first.lastCollisionAt = now;
        second.lastCollisionAt = now;
      }
    }
  }

  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return;
    let points = 0;
    arcade.stones.forEach((stone) => {
      if (stone.playerId !== player.id) return;
      const distance = Math.hypot(stone.x - arcade.house.x, stone.y - arcade.house.y);
      const ring = arcade.rings.find((candidate) => distance <= candidate.radius);
      if (ring) points += ring.points;
    });
    entry.score = points;
    syncArcadeScore(minigame, player, entry);
  });
}

function arcadeTargetPosition(arcade, target, now) {
  if (arcade.mode !== "bubble") return { x: target.x, y: target.y };
  const seconds = Math.max(0, now - target.spawnAt) / 1000;
  return {
    x: clamp(target.x + Math.sin(seconds * 2.2 + target.id) * 0.045, 0.05, 0.95),
    y: target.y - (target.rise || 0.2) * seconds
  };
}

function updateKineticWorld(arcade, elapsed, dt, now) {
  if (arcade.mode === "sweep") {
    arcade.sweepAngle = (elapsed / 940) % (Math.PI * 2);
    if (now - arcade.target.changedAt > 4300) relocateArcadeTarget(arcade);
    return;
  }

  if (arcade.mode === "course") {
    arcade.hazards.forEach((hazard) => {
      hazard.y += hazard.speed * dt;
      if (hazard.y <= 1.08) return;
      hazard.wraps += 1;
      hazard.y = -0.08;
      hazard.x = 0.1 + arcadeNoise(arcade.seed + hazard.id * 37 + hazard.wraps * 53) * 0.8;
      hazard.speed = 0.16 + arcadeNoise(arcade.seed + hazard.id * 17 + hazard.wraps * 29) * 0.13;
    });
  }
}

function containKineticPlayer(player) {
  const dx = player.x - 0.5;
  const dy = player.y - 0.5;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.43) return;
  const nx = dx / Math.max(0.001, distance);
  const ny = dy / Math.max(0.001, distance);
  player.x = 0.5 + nx * 0.43;
  player.y = 0.5 + ny * 0.43;
  const outward = player.vx * nx + player.vy * ny;
  if (outward > 0) {
    player.vx -= nx * outward * 1.72;
    player.vy -= ny * outward * 1.72;
  }
}

function scoreKineticPlayer(arcade, player, dt, now) {
  player.activeMs += dt * 1000;
  player.score += dt * 5;

  if (arcade.mode === "sweep") {
    const targetDistance = Math.hypot(player.x - arcade.target.x, player.y - arcade.target.y);
    if (targetDistance < 0.095 && now - arcade.target.changedAt > 330) {
      player.successes += 1;
      player.score += 18 + Math.min(6, player.streak);
      player.streak += 1;
      player.flash = "good";
      player.lastHitAt = now;
      relocateArcadeTarget(arcade);
    }

    if (now < player.collisionUntil) return;
    const dx = player.x - 0.5;
    const dy = player.y - 0.5;
    const cos = Math.cos(arcade.sweepAngle);
    const sin = Math.sin(arcade.sweepAngle);
    const along = Math.abs(dx * cos + dy * sin);
    const signedAcross = dx * -sin + dy * cos;
    if (along < 0.42 && Math.abs(signedAcross) < 0.055) {
      const side = Math.sign(signedAcross) || 1;
      player.vx += -sin * side * 0.78;
      player.vy += cos * side * 0.78;
      player.mistakes += 1;
      player.score = Math.max(0, player.score - 8);
      player.streak = 0;
      player.flash = "bad";
      player.lastHitAt = now;
      player.collisionUntil = now + 720;
    }
    return;
  }

  if (arcade.mode === "course" && now >= player.collisionUntil) {
    const hazard = arcade.hazards.find((candidate) => Math.hypot(player.x - candidate.x, player.y - candidate.y) < candidate.radius + 0.06);
    if (!hazard) return;
    const dx = player.x - hazard.x || 0.01;
    const dy = player.y - hazard.y || -0.01;
    const distance = Math.max(0.01, Math.hypot(dx, dy));
    player.vx += dx / distance * 0.72;
    player.vy += dy / distance * 0.72;
    player.mistakes += 1;
    player.score = Math.max(0, player.score - 10);
    player.streak = 0;
    player.flash = "bad";
    player.lastHitAt = now;
    player.collisionUntil = now + 620;
  }
}

function updateDirectWorld(room, minigame, arcade, elapsed, dt, now) {
  if (arcade.mode === "catch") {
    while (now - arcade.lastSpawnAt >= arcade.spawnMs && arcade.drops.length < 12) {
      arcade.lastSpawnAt += arcade.spawnMs;
      const id = arcade.nextTargetId;
      arcade.nextTargetId += 1;
      const spawnAt = Math.max(minigame.startedAt, arcade.lastSpawnAt);
      arcade.drops.push({
        id,
        x: 0.1 + arcadeNoise(arcade.seed + id * 41) * 0.8,
        kind: arcadeNoise(arcade.seed + id * 67 + 9) < 0.22 ? "storm" : "glow",
        tone: id % 4,
        spawnAt,
        impactAt: spawnAt + 1800,
        expiresAt: spawnAt + 2250
      });
    }
    arcade.drops = arcade.drops.filter((drop) => now < drop.expiresAt + 500);
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      arcade.drops.forEach((drop) => {
        if (now < drop.impactAt || entry.hitTargets[drop.id]) return;
        entry.hitTargets[drop.id] = true;
        const caught = Math.abs(entry.x - drop.x) < 0.135;
        if (caught && drop.kind === "glow") {
          entry.successes += 1;
          entry.streak += 1;
          entry.score += 11 + Math.min(6, entry.streak);
          entry.flash = "good";
          entry.lastHitAt = now;
        } else if (caught) {
          entry.mistakes += 1;
          entry.streak = 0;
          entry.score = Math.max(0, entry.score - 10);
          entry.flash = "bad";
          entry.lastHitAt = now;
        } else if (drop.kind === "glow") {
          entry.streak = 0;
        }
      });
      syncArcadeScore(minigame, player, entry);
    });
    return;
  }

  if (arcade.mode === "balance") {
    arcade.target.x = clamp(0.5 + Math.sin(elapsed / 710) * 0.25 + Math.sin(elapsed / 260 + 1.4) * 0.055, 0.15, 0.85);
    arcade.wind = Math.sin(elapsed / 840 + arcade.seed) * 0.5 + Math.sin(elapsed / 310) * 0.5;
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const response = Math.min(1, dt * 8.5);
      entry.x += (entry.desiredX - entry.x) * response;
      entry.x = clamp(entry.x + arcade.wind * dt * 0.018, 0.06, 0.94);
      const wasInside = entry.inside;
      entry.inside = Math.abs(entry.x - arcade.target.x) <= arcade.zoneWidth;
      if (entry.hasMoved) {
        if (entry.inside) entry.activeMs += dt * 1000;
        entry.score = Math.max(0, entry.score + (entry.inside ? dt * 14 : -dt * 2));
        if (entry.inside !== wasInside) {
          entry.flash = entry.inside ? "good" : "bad";
          entry.lastHitAt = now;
        }
      }
      syncArcadeScore(minigame, player, entry);
    });
  }
}

function updateArcadeWorld(arcade, elapsed, dt, now) {
  if (arcade.mode === "chase") {
    arcade.target.x = 0.5 + Math.sin(elapsed / 880) * 0.3;
    arcade.target.y = 0.48 + Math.cos(elapsed / 1160) * 0.27;
  } else if (arcade.mode === "stay") {
    arcade.target.x = 0.5 + Math.sin(elapsed / 1320) * 0.24;
    arcade.target.y = 0.48 + Math.sin(elapsed / 920 + 1.3) * 0.22;
  } else if (arcade.mode === "avoid") {
    arcade.hazards.forEach((hazard) => {
      hazard.x += hazard.vx * dt;
      hazard.y += hazard.vy * dt;
      if (hazard.x < 0.08 || hazard.x > 0.92) hazard.vx *= -1;
      if (hazard.y < 0.1 || hazard.y > 0.9) hazard.vy *= -1;
      hazard.x = clamp(hazard.x, 0.08, 0.92);
      hazard.y = clamp(hazard.y, 0.1, 0.9);
    });
  }
  if (arcade.mode === "collect" && now - arcade.target.changedAt > 3300) relocateArcadeTarget(arcade);
}

function scoreArcadeSteerPlayer(arcade, player, dt, now) {
  if (!player.hasMoved && arcade.mode !== "avoid") return;
  const distance = Math.hypot(player.x - arcade.target.x, player.y - arcade.target.y);
  if (arcade.mode === "collect" && now - arcade.target.changedAt > 450 && distance < 0.105) {
    player.successes += 1;
    player.score += 14;
    player.streak += 1;
    player.flash = "good";
    player.lastHitAt = now;
    relocateArcadeTarget(arcade);
  } else if (arcade.mode === "chase") {
    if (distance < 0.16) {
      player.activeMs += dt * 1000;
      player.score += dt * 12;
    }
  } else if (arcade.mode === "stay") {
    if (distance < 0.22) {
      player.activeMs += dt * 1000;
      player.score += dt * 10;
    }
    else if (distance > 0.38) player.score = Math.max(0, player.score - dt * 2);
  } else if (arcade.mode === "avoid") {
    player.activeMs += dt * 1000;
    player.score += dt * 5;
    if (now >= player.collisionUntil) {
      const hazard = arcade.hazards.find((candidate) => Math.hypot(player.x - candidate.x, player.y - candidate.y) < candidate.radius + 0.06);
      if (hazard) {
        const dx = player.x - hazard.x || 0.01;
        const dy = player.y - hazard.y || 0.01;
        const distanceToHazard = Math.max(0.01, Math.hypot(dx, dy));
        player.vx += dx / distanceToHazard * 0.7;
        player.vy += dy / distanceToHazard * 0.7;
        player.mistakes += 1;
        player.score = Math.max(0, player.score - 10);
        player.flash = "bad";
        player.lastHitAt = now;
        player.collisionUntil = now + 650;
      }
    }
  }
}

function updateArcadeTargets(arcade, now) {
  arcade.targets = arcade.targets.filter((target) => now < target.expiresAt + 900);
  if (now - arcade.lastSpawnAt < arcade.spawnMs) return;
  arcade.lastSpawnAt = now;
  const id = arcade.nextTargetId;
  arcade.nextTargetId += 1;

  if (arcade.mode === "bubble") {
    const rise = 0.17 + arcadeNoise(arcade.seed + id * 23) * 0.09;
    arcade.targets.push({
      id,
      x: 0.14 + arcadeNoise(arcade.seed + id * 13) * 0.72,
      y: 1.04,
      rise,
      radius: 0.06 + arcadeNoise(id * 5) * 0.03,
      kind: arcadeNoise(arcade.seed + id * 29) < 0.24 ? "gold" : "good",
      order: id,
      spawnAt: now,
      expiresAt: now + Math.round((1.16 / rise) * 1000)
    });
    return;
  }

  const badChance = arcade.mode === "sort" ? 0.32 : 0;
  arcade.targets.push({
    id,
    x: 0.12 + arcadeNoise(arcade.seed + id * 13) * 0.76,
    y: 0.19 + arcadeNoise(arcade.seed + id * 19 + 7) * 0.62,
    radius: 0.065 + arcadeNoise(id * 5) * 0.025,
    kind: arcadeNoise(arcade.seed + id * 29) < badChance ? "bad" : "good",
    order: id,
    spawnAt: now,
    expiresAt: now + 1900
  });
}

function arcadeBotStep(room, bot) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  const player = arcade?.players?.[bot.id];
  if (!arcade || !player) return;
  if (arcade.family === "choice") {
    const cueIndex = Math.max(0, Math.floor((Date.now() - minigame.startedAt) / arcade.beatMs));
    const answerIndex = cueIndex - (arcade.choiceDelay || 0);
    if (answerIndex < 0) return;
    const expected = arcadeChoice(arcade, answerIndex);
    handleArcadeInput(room, bot, { action: Math.random() > 0.18 ? expected : (expected === "left" ? "right" : "left") });
    return;
  }
  if (arcade.family === "timing") {
    if (Math.random() > 0.44) handleArcadeInput(room, bot, { action: "tap" });
    return;
  }
  if (arcade.family === "kinetic") {
    let target = arcade.target;
    if (arcade.mode === "course") {
      const nearest = [...arcade.hazards]
        .sort((a, b) => Math.hypot(player.x - a.x, player.y - a.y) - Math.hypot(player.x - b.x, player.y - b.y))[0];
      target = nearest && Math.hypot(player.x - nearest.x, player.y - nearest.y) < 0.3
        ? { x: nearest.x < 0.5 ? 0.82 : 0.18, y: clamp(player.y - 0.08, 0.18, 0.82) }
        : { x: 0.5, y: 0.52 };
    }
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const action = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    handleArcadeInput(room, bot, { action });
    return;
  }
  if (arcade.family === "direct") {
    let targetX = arcade.target.x;
    if (arcade.mode === "catch") {
      const now = Date.now();
      const nextGlow = arcade.drops
        .filter((drop) => drop.kind === "glow" && !player.hitTargets[drop.id] && drop.impactAt >= now)
        .sort((a, b) => a.impactAt - b.impactAt)[0];
      const nextStorm = arcade.drops
        .filter((drop) => drop.kind === "storm" && !player.hitTargets[drop.id] && Math.abs(drop.x - player.x) < 0.16)
        .sort((a, b) => a.impactAt - b.impactAt)[0];
      targetX = nextGlow?.x ?? (nextStorm ? (nextStorm.x < 0.5 ? 0.82 : 0.18) : 0.5);
    }
    const wobble = (Math.random() - 0.5) * 0.08;
    handleArcadeInput(room, bot, { action: "move", x: clamp(targetX + wobble, 0.08, 0.92) });
    return;
  }
  if (arcade.family === "steer") {
    let target = arcade.target;
    if (arcade.mode === "avoid") {
      const nearest = [...arcade.hazards].sort((a, b) => Math.hypot(player.x - a.x, player.y - a.y) - Math.hypot(player.x - b.x, player.y - b.y))[0];
      target = { x: clamp(player.x + (player.x - nearest.x), 0.1, 0.9), y: clamp(player.y + (player.y - nearest.y), 0.1, 0.9) };
    }
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const action = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    handleArcadeInput(room, bot, { action });
    return;
  }
  if (arcade.family === "target") {
    const now = Date.now();
    const active = arcade.targets
      .filter((target) => target.kind !== "bad" && !player.hitTargets[target.id] && now <= target.expiresAt)
      .sort((a, b) => a.order - b.order)[0];
    if (active && Math.random() > 0.24) {
      const position = arcadeTargetPosition(arcade, active, now);
      handleArcadeInput(room, bot, { action: "target", x: position.x, y: position.y });
    }
    return;
  }
  if (arcade.family === "plinko") {
    const inFlight = arcade.balls.some((ball) => ball.playerId === bot.id);
    if (!inFlight && Math.random() > 0.35) {
      handleArcadeInput(room, bot, { action: "drop", x: 0.32 + Math.random() * 0.36 });
    }
    return;
  }
  if (arcade.family === "curling") {
    if ((player.stonesLeft || 0) <= 0 || Math.random() < 0.82) return;
    const startX = player.startX || 0.5;
    const dx = clamp((arcade.house.x - startX) * 0.75 + (Math.random() - 0.5) * 0.1, -1, 1);
    const dy = clamp(-0.5 + (Math.random() - 0.5) * 0.12, -1, -0.3);
    handleArcadeInput(room, bot, { action: "flick", dx, dy });
  }
}

function arcadeChoice(arcade, cueIndex) {
  return arcadeNoise(arcade.seed + cueIndex * 17) > 0.5 ? "right" : "left";
}

function arcadeTimingPhase(arcade, startedAt, now) {
  return ((now - startedAt) / arcade.periodMs) % 1;
}

function arcadeDynamicTimingTarget(arcade, cycle) {
  return arcadeNoise(arcade.seed + cycle * 43) > 0.5 ? 0.25 : 0.75;
}

function circularDistance(a, b) {
  const distance = Math.abs(a - b);
  return Math.min(distance, 1 - distance);
}

function relocateArcadeTarget(arcade) {
  arcade.target.index += 1;
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    x: 0.14 + arcadeNoise(arcade.seed + arcade.target.index * 31 + index * 17) * 0.72,
    y: 0.2 + arcadeNoise(arcade.seed + arcade.target.index * 37 + index * 23 + 4) * 0.58
  }));
  const playerPositions = Object.values(arcade.players || {});
  let destination = candidates
    .map((candidate) => ({
      ...candidate,
      clearance: Math.min(...playerPositions.map((player) => Math.hypot(player.x - candidate.x, player.y - candidate.y)))
    }))
    .sort((a, b) => b.clearance - a.clearance)[0] || candidates[0];
  if (arcade.mode === "sweep") {
    const dx = destination.x - 0.5;
    const dy = destination.y - 0.5;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.34) {
      destination = {
        ...destination,
        x: 0.5 + dx / distance * 0.34,
        y: 0.5 + dy / distance * 0.34
      };
    }
  }
  arcade.target.x = destination.x;
  arcade.target.y = destination.y;
  arcade.target.changedAt = Date.now();
}

function bounceArcadePlayer(player) {
  if (player.x < 0.06 || player.x > 0.94) player.vx *= -0.72;
  if (player.y < 0.08 || player.y > 0.92) player.vy *= -0.72;
  player.x = clamp(player.x, 0.06, 0.94);
  player.y = clamp(player.y, 0.08, 0.92);
}

function syncArcadeScore(minigame, player, arcadePlayer) {
  const score = Math.max(0, Math.round(arcadePlayer.score));
  minigame.scores[player.id] = score;
  player.minigameScore = score;
}

function arcadeNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function createDodgeBlocks(duration) {
  const blocks = [];
  let time = 350;
  let id = 0;
  while (time < duration - 850) {
    const lane = Math.floor(Math.random() * 5);
    blocks.push({
      id: `block_${id}`,
      lane,
      spawnAt: time,
      impactAt: time + 980
    });
    id += 1;
    time += Math.max(430, 800 - id * 18);
  }
  return blocks;
}

function computeTimingScore(minigame, now) {
  const period = 1450;
  const elapsed = Math.max(0, now - minigame.startedAt);
  const phase = (elapsed % period) / period;
  const position = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const distance = Math.abs(position - 0.5) * 2;
  return Math.max(0, Math.round((1 - distance) * 100));
}

function emitMinigameUpdate(room) {
  if (!room.currentMinigame) return;
  io.to(room.code).emit("minigameUpdate", serializeMinigame(room.currentMinigame));
}

function emitRoom(room) {
  io.to(room.code).emit("state", serializeRoom(room));
  scheduleBotTurn(room);
  scheduleDisconnectedTurnSkip(room);
}

function scheduleBotTurn(room) {
  if (room.status !== "board" || room.phase !== "waitingRoll") return;
  if (room.botTurnTimer) return;
  const current = getCurrentPlayer(room);
  if (!current?.isBot) return;

  room.botTurnTimer = setTimeout(() => {
    room.botTurnTimer = null;
    if (room.status !== "board" || getCurrentPlayer(room)?.id !== current.id) return;
    current.routeChoice = current.coins >= getBoard(room.boardId).routeCost && Math.random() > 0.56
      ? "shortcut"
      : "scenic";
    if ((current.glitchCharges || 0) > 0 && Math.random() > 0.48) performSabotage(room, current);
    performRoll(room, current);
  }, 900 + Math.floor(Math.random() * 900));
}

function scheduleDisconnectedTurnSkip(room) {
  if (room.status !== "board" || room.phase !== "waitingRoll") return;
  if (room.skipTurnTimer) return;
  const current = getCurrentPlayer(room);
  if (!current || current.connected !== false || current.isBot) return;

  room.skipTurnTimer = setTimeout(() => {
    room.skipTurnTimer = null;
    if (room.status !== "board" || room.phase !== "waitingRoll") return;
    const stillCurrent = getCurrentPlayer(room);
    if (!stillCurrent || stillCurrent.id !== current.id || stillCurrent.connected !== false) return;
    room.lastMessage = `${stillCurrent.name} ist offline. Zug übersprungen.`;
    io.to(room.code).emit("roomNotice", { severity: "warning", message: room.lastMessage });
    advanceTurn(room);
  }, 1400);
}

function serializeRoom(room) {
  const board = getBoard(room.boardId);
  return {
    code: room.code,
    hostId: room.hostId,
    boardId: board.id,
    board: publicBoard(board),
    availableBoards: BOARD_DEFINITIONS.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      shortName: candidate.shortName,
      subtitle: candidate.subtitle,
      badge: candidate.badge,
      feature: candidate.feature,
      routeCost: candidate.routeCost,
      swatches: candidate.swatches
    })),
    status: room.status,
    phase: room.phase,
    boardSize: board.fieldTypes.length,
    fieldTypes: board.fieldTypes,
    round: room.round,
    maxRounds: room.maxRounds,
    devMode: room.devMode,
    hostConnected: room.players.some((player) => player.id === room.hostId && player.connected),
    currentTurnIndex: room.currentTurnIndex,
    currentPlayerId: getCurrentPlayer(room)?.id || null,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      isHost: player.isHost,
      isBot: player.isBot,
      isLocalDev: player.isLocalDev,
      connected: player.connected,
      coins: player.coins,
      routeChoice: player.routeChoice || "scenic",
      position: player.position,
      diceValue: player.diceValue,
      nextRollBoost: player.nextRollBoost || 0,
      nextRollPenalty: player.nextRollPenalty || 0,
      glitchCharges: player.glitchCharges || 0,
      minigameScore: player.minigameScore
    })),
    currentMinigame: room.currentMinigame ? serializeMinigame(room.currentMinigame) : null,
    lastMinigameResult: room.lastMinigameResult,
    resultEndsAt: room.resultEndsAt,
    lastMove: room.lastMove,
    lastMessage: room.lastMessage,
    winnerIds: room.winnerIds,
    serverTime: Date.now()
  };
}

function serializeMinigame(minigame) {
  return {
    id: minigame.id,
    type: minigame.type,
    title: minigame.title,
    reason: minigame.reason,
    startedAt: minigame.startedAt,
    duration: minigame.duration,
    scores: minigame.scores,
    stopped: minigame.stopped,
    lanes: minigame.lanes,
    hits: minigame.hits,
    arena: minigame.arena,
    flux: minigame.flux,
    canopy: minigame.canopy,
    arcade: minigame.arcade,
    blocks: minigame.blocks
  };
}

function leaveCurrentRoom(socket, notify, intentional = false) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  const player = room.players.find((candidate) => candidate.id === socket.data.playerId);
  const controlledPlayers = room.players.filter((candidate) => candidate.controllerId === socket.id || candidate.id === socket.data.playerId);
  if (controlledPlayers.length > 0) {
    if (room.status === "lobby") {
      const controlsHost = controlledPlayers.some((candidate) => candidate.id === room.hostId);
      if (controlsHost && intentional) {
        io.to(code).emit("roomClosed", { message: "Der Host hat die Lobby verlassen. Erstelle einen neuen Raum." });
        clearRoomTimers(room);
        rooms.delete(code);
        socket.leave(code);
        socket.data.roomCode = null;
        socket.data.playerId = null;
        return;
      }
      if (intentional) {
        const controlledIds = new Set(controlledPlayers.map((candidate) => candidate.id));
        room.players = room.players.filter((candidate) => !controlledIds.has(candidate.id));
      } else {
        controlledPlayers.forEach((candidate) => {
          if (!candidate.isBot) candidate.connected = false;
        });
      }
    } else {
      controlledPlayers.forEach((candidate) => {
        if (!candidate.isBot) candidate.connected = false;
      });
    }
  }

  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.playerId = null;

  if (room.players.length === 0 || !room.players.some((candidate) => !candidate.isBot && candidate.connected)) {
    if (!room.cleanupTimer) {
      room.cleanupTimer = setTimeout(() => {
        clearRoomTimers(room);
        rooms.delete(code);
      }, room.status === "lobby" ? 30000 : 120000);
    }
  } else {
    if (notify) {
      const hostLeft = controlledPlayers.some((candidate) => candidate.id === room.hostId);
      room.lastMessage = hostLeft
        ? "Host-Verbindung verloren. Das Spiel bleibt sichtbar, aber Host-Aktionen sind gesperrt."
        : `${player?.name || "Ein Spieler"} hat die Verbindung verloren.`;
      io.to(room.code).emit("roomNotice", {
        severity: hostLeft ? "error" : "warning",
        message: room.lastMessage
      });
      emitRoom(room);
      scheduleDisconnectedTurnSkip(room);
    }
  }
}

function findRoomForSocket(socket, code) {
  const normalized = normalizeCode(code || socket.data.roomCode);
  const room = rooms.get(normalized);
  if (!room) return null;
  return room;
}

function getCurrentPlayer(room) {
  return room.players[room.currentTurnIndex] || null;
}

function canControl(socket, player) {
  return player.id === socket.data.playerId || player.controllerId === socket.id;
}

function isHost(socket, room) {
  return socket.data.playerId === room.hostId;
}

function replyOk(reply, room, playerId) {
  reply?.({ ok: true, playerId, room: serializeRoom(room) });
}

function replyError(reply, message) {
  reply?.({ ok: false, error: message });
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(name, fallback) {
  const cleaned = String(name || fallback)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>&"']/g, "")
    .slice(0, 18);
  return cleaned || fallback;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function setTrackedTimeout(room, callback, ms) {
  const timer = setTimeout(() => {
    room.timers.delete(timer);
    callback();
  }, ms);
  room.timers.add(timer);
  return timer;
}

function setTrackedInterval(room, callback, ms) {
  const timer = setInterval(callback, ms);
  room.timers.add(timer);
  return timer;
}

function clearMinigameTimers(room) {
  if (room.minigameTick) {
    clearInterval(room.minigameTick);
    room.minigameTick = null;
  }
}

function clearRoomTimers(room) {
  if (room.botTurnTimer) {
    clearTimeout(room.botTurnTimer);
    room.botTurnTimer = null;
  }
  if (room.skipTurnTimer) {
    clearTimeout(room.skipTurnTimer);
    room.skipTurnTimer = null;
  }
  clearMinigameTimers(room);
  room.timers.forEach((timer) => {
    clearTimeout(timer);
    clearInterval(timer);
  });
  room.timers.clear();
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getLocalAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Tumblekin server running at http://localhost:${PORT}`);
    getLocalAddresses().forEach((address) => {
      console.log(`WLAN URL: http://${address}:${PORT}`);
    });
  });
}

module.exports = {
  testRules: {
    BOARD_DEFINITIONS,
    FIELD_TYPES,
    GATE_COIN_BONUS,
    MINIGAMES,
    applyFieldEffect,
    arcadeRankingScore,
    bounceResultScore,
    buildBoardPath,
    canopyRaceScore,
    compareStanding,
    createArcadeState,
    createCanopyState,
    getBoard,
    handleArcadeInput,
    handleCanopyInput,
    arcadeTargetPosition,
    nearestLowerCanopyLeaf,
    refreshFluxScores,
    updateArcade,
    resolveGateRewards
  }
};
