const test = require("node:test");
const assert = require("node:assert/strict");
const { testRules } = require("./server");

const {
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
  nearestLowerCanopyLeaf,
  refreshFluxScores,
  updateArcade,
  resolveGateRewards
} = testRules;

function player(overrides = {}) {
  return {
    coins: 10,
    nextRollBoost: 0,
    glitchCharges: 0,
    ...overrides
  };
}

test("board uses one readable field language", () => {
  const allowed = new Set(["start", "spark", "snag", "boost", "jinx", "challenge", "gate"]);
  assert.equal(FIELD_TYPES.length, 32);
  assert.ok(FIELD_TYPES.every((type) => allowed.has(type)));
  assert.deepEqual(
    FIELD_TYPES.map((type, index) => type === "gate" ? index : null).filter((index) => index !== null),
    [7, 15, 23, 31]
  );
});

test("catalog contains 19 unique challenges", () => {
  assert.equal(MINIGAMES.length, 19);
  assert.equal(new Set(MINIGAMES.map((game) => game.type)).size, 19);
});

test("plinko balls fall through pegs and score their slot", () => {
  const runner = player({ id: "plink", name: "Plink", color: "#fff" });
  const startedAt = Date.now() - 1200;
  const arcade = createArcadeState("plinkoDrop", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 18000 };
  const room = { currentMinigame: minigame, players: [runner] };

  assert.deepEqual(handleArcadeInput(room, runner, { action: "drop", x: 0.5 }), { ok: true });
  assert.equal(arcade.balls.length, 1);
  assert.deepEqual(handleArcadeInput(room, runner, { action: "drop", x: 0.5 }), { ok: true });
  assert.equal(arcade.balls.length, 1, "only one ball in flight per player");

  for (let tick = 0; tick < 400 && arcade.balls.length; tick += 1) {
    arcade.lastUpdateAt = Date.now() - 90;
    updateArcade(room);
  }
  assert.equal(arcade.balls.length, 0, "ball lands eventually");
  assert.equal(arcade.players[runner.id].successes, 1);
  assert.ok(arcade.players[runner.id].score >= 1);
});

test("curling stones slide with friction and score rings", () => {
  const runner = player({ id: "stone", name: "Stone", color: "#fff" });
  const startedAt = Date.now() - 1200;
  const arcade = createArcadeState("curlingSlide", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 20000 };
  const room = { currentMinigame: minigame, players: [runner] };
  arcade.players[runner.id].startX = arcade.house.x;

  assert.deepEqual(handleArcadeInput(room, runner, { action: "flick", dx: 0, dy: -0.5 }), { ok: true });
  assert.equal(arcade.stones.length, 1);
  assert.equal(arcade.players[runner.id].stonesLeft, 2);

  for (let tick = 0; tick < 300; tick += 1) {
    arcade.lastUpdateAt = Date.now() - 90;
    updateArcade(room);
  }
  const stone = arcade.stones[0];
  assert.ok(Math.hypot(stone.vx, stone.vy) < 0.02, "stone comes to rest");
  assert.ok(stone.y < 1.0, "stone travelled up the sheet");
});

test("bubble targets rise over time and are hit at their live position", () => {
  const runner = player({ id: "bubble", name: "Bubble", color: "#fff" });
  const startedAt = Date.now() - 3000;
  const arcade = createArcadeState("bubblePop", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 15000 };
  const room = { currentMinigame: minigame, players: [runner] };

  arcade.lastSpawnAt = Date.now() - 10000;
  updateArcade(room);
  assert.ok(arcade.targets.length >= 1);
  const target = arcade.targets[0];
  target.spawnAt = Date.now() - 2000;

  const position = testRules.arcadeTargetPosition(arcade, target, Date.now());
  assert.ok(position.y < target.y, "bubble moved upward");
  assert.deepEqual(handleArcadeInput(room, runner, { action: "target", x: position.x, y: position.y }), { ok: true });
  assert.equal(arcade.players[runner.id].successes, 1);
});

test("kinetic games turn one joystick direction into scored movement", () => {
  const runner = player({ id: "kin", name: "Kin", color: "#fff" });
  const startedAt = Date.now() - 900;
  const arcade = createArcadeState("driftDocks", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 18000 };
  const room = { currentMinigame: minigame, players: [runner] };

  assert.deepEqual(handleArcadeInput(room, runner, { action: "right" }), { ok: true });
  assert.equal(arcade.players[runner.id].hasMoved, true);
  assert.ok(arcade.players[runner.id].vx > 0);
  arcade.lastUpdateAt = Date.now() - 120;
  updateArcade(room);
  assert.ok(arcade.players[runner.id].score > 0);
});

test("direct games preserve the horizontal touch position", () => {
  const runner = player({ id: "touch", name: "Touch", color: "#fff" });
  const startedAt = Date.now() - 900;
  const catchArcade = createArcadeState("lanternLift", [runner], startedAt);
  const catchRoom = { currentMinigame: { arcade: catchArcade, scores: {}, startedAt, duration: 16000 }, players: [runner] };
  assert.deepEqual(handleArcadeInput(catchRoom, runner, { action: "move", x: 0.82 }), { ok: true });
  assert.equal(catchArcade.players[runner.id].x, 0.82);

  const balanceArcade = createArcadeState("balanceBrew", [runner], startedAt);
  const balanceRoom = { currentMinigame: { arcade: balanceArcade, scores: {}, startedAt, duration: 16000 }, players: [runner] };
  assert.deepEqual(handleArcadeInput(balanceRoom, runner, { action: "move", x: 0.24 }), { ok: true });
  assert.equal(balanceArcade.players[runner.id].desiredX, 0.24);
});

test("three themed boards share a clear field grammar", () => {
  assert.equal(BOARD_DEFINITIONS.length, 3);
  assert.equal(new Set(BOARD_DEFINITIONS.map((board) => board.id)).size, 3);
  BOARD_DEFINITIONS.forEach((board) => {
    assert.equal(board.fieldTypes.length, 32);
    assert.equal(board.routes.length, 32);
    assert.equal(board.zones.length, 4);
    assert.equal(board.fieldTypes.filter((type) => type === "gate").length, 4);
    assert.equal(board.routes.filter((routes) => routes.length === 2).length, 4);
  });
});

test("each world has a distinct shortcut price and only charges a used branch", () => {
  const mossback = getBoard("mossback");
  assert.deepEqual(buildBoardPath(mossback, 4, 1, "scenic", 12), {
    path: [5],
    shortcuts: [],
    cost: 0
  });
  assert.deepEqual(buildBoardPath(mossback, 4, 1, "shortcut", 1), {
    path: [7],
    shortcuts: [{ from: 4, to: 7 }],
    cost: 1
  });
  assert.deepEqual(buildBoardPath(mossback, 4, 1, "shortcut", 0), {
    path: [5],
    shortcuts: [],
    cost: 0
  });

  const cloudpantry = getBoard("cloudpantry");
  assert.deepEqual(buildBoardPath(cloudpantry, 2, 1, "shortcut", 2), {
    path: [7],
    shortcuts: [{ from: 2, to: 7 }],
    cost: 2
  });

  const tideworks = getBoard("tideworks");
  assert.deepEqual(buildBoardPath(tideworks, 1, 1, "shortcut", 3), {
    path: [7],
    shortcuts: [{ from: 1, to: 7 }],
    cost: 3
  });
});

test("each passed gate awards a visible coin bonus", () => {
  const runner = player({ coins: 2 });
  const effects = resolveGateRewards(runner, [31, 0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(effects.length, 2);
  assert.equal(runner.coins, 2 + GATE_COIN_BONUS * 2);
  assert.ok(effects.every((effect) => effect.coins === GATE_COIN_BONUS));
});

test("gate rewards never create a second board currency", () => {
  const runner = player({ coins: 0 });
  const [effect] = resolveGateRewards(runner, [7]);
  assert.deepEqual(Object.keys(effect).sort(), ["coins", "fieldIndex", "message", "type"]);
  assert.equal(runner.coins, GATE_COIN_BONUS);
});

test("field effects are deterministic and bounded", () => {
  const runner = player({ coins: 1 });
  assert.equal(applyFieldEffect(runner, "snag").coins, -1);
  assert.equal(runner.coins, 0);
  assert.equal(applyFieldEffect(runner, "boost").boost, 2);
  assert.equal(runner.nextRollBoost, 2);
  assert.equal(applyFieldEffect(runner, "jinx").glitch, 1);
  assert.equal(runner.glitchCharges, 1);
});

test("final standings are ordered by coins only", () => {
  const standings = [
    player({ id: "second", coins: 8 }),
    player({ id: "rich", coins: 99 }),
    player({ id: "third", coins: 1 })
  ].sort(compareStanding);
  assert.deepEqual(standings.map((entry) => entry.id), ["rich", "second", "third"]);
});

test("canopy finish time outranks progress and faster finishes win", () => {
  const unfinished = canopyRaceScore({ level: 17, maxLevel: 18, mistakes: 0, finishedAt: null });
  const fast = canopyRaceScore({ finishMs: 4200, finishedAt: 1 });
  const slow = canopyRaceScore({ finishMs: 7900, finishedAt: 1 });
  assert.ok(fast > slow);
  assert.ok(slow > unfinished);
});

test("wrong canopy input falls to the nearest lower leaf on that side without waiting for motion", () => {
  const runner = player({ id: "leaf", name: "Leaf" });
  const startedAt = Date.now() - 1000;
  const canopy = createCanopyState([runner], startedAt);
  canopy.leaves = [
    { level: 0, side: "center" },
    { level: 1, side: "left" },
    { level: 2, side: "right" },
    { level: 3, side: "left" },
    { level: 4, side: "right" },
    { level: 5, side: "left" }
  ];
  canopy.goal = 5;
  canopy.players[runner.id].level = 4;
  canopy.players[runner.id].maxLevel = 4;
  canopy.players[runner.id].motion = { type: "jump", from: 3, to: 4, startedAt: Date.now(), duration: 170 };
  const minigame = { type: "canopyClimb", startedAt, canopy, lastInputAt: {}, scores: {} };
  const room = { currentMinigame: minigame, players: [runner] };

  assert.equal(nearestLowerCanopyLeaf(canopy, 4, "right"), 2);
  assert.deepEqual(handleCanopyInput(room, runner, { action: "right" }), { ok: true, correct: false });
  assert.equal(canopy.players[runner.id].level, 2);
  assert.equal(canopy.players[runner.id].motion.type, "fall");
});

test("glow grid score equals owned territory", () => {
  const a = player({ id: "a" });
  const b = player({ id: "b" });
  const flux = {
    grid: [["a", "a", "b"], ["a", null, "b"]],
    players: {
      a: { territory: 0, bumps: 99, bursts: 99 },
      b: { territory: 0, bumps: 0, bursts: 0 }
    }
  };
  const room = { players: [a, b], currentMinigame: { type: "fluxFloor", flux, scores: {} } };
  refreshFluxScores(room);
  assert.equal(room.currentMinigame.scores.a, 3);
  assert.equal(room.currentMinigame.scores.b, 2);
});

test("bumper survivor always outranks an eliminated player", () => {
  const startedAt = 1000;
  const finishedAt = 9000;
  const survivor = bounceResultScore({ alive: true, knockouts: 0, outAt: null }, startedAt, finishedAt);
  const eliminated = bounceResultScore({ alive: false, knockouts: 3, outAt: 8999 }, startedAt, finishedAt);
  assert.ok(survivor > eliminated);
});

test("arcade rankings prioritize the visible objective", () => {
  const sweep = { family: "kinetic", mode: "sweep" };
  const oneCoin = arcadeRankingScore(sweep, { successes: 1, mistakes: 8, score: 1 });
  const noCoin = arcadeRankingScore(sweep, { successes: 0, mistakes: 0, score: 9999 });
  assert.ok(oneCoin > noCoin);

  const course = { family: "kinetic", mode: "course" };
  const cleanRun = arcadeRankingScore(course, { mistakes: 0, activeMs: 1000, score: 0 });
  const hitRun = arcadeRankingScore(course, { mistakes: 1, activeMs: 18000, score: 9999 });
  assert.ok(cleanRun > hitRun);
});
