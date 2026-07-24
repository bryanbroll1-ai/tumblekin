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
  arcadeResultDetail,
  bounceResultScore,
  buildBoardPath,
  canopyRaceScore,
  compareStanding,
  createArcadeState,
  createArenaState,
  handleArenaInput,
  updateBounceArena,
  ARENA_RADIUS,
  ARENA_BALL_RADIUS,
  ARENA_RESPAWN_MS,
  createCanopyState,
  createRunnerCourse,
  runnerBlockedLanes,
  advanceColorRound,
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
    nextRollPenalty: 0,
    ...overrides
  };
}

test("board uses one readable, simplified field language", () => {
  const allowed = new Set(["start", "normal", "challenge", "gate"]);
  assert.equal(FIELD_TYPES.length, 32);
  assert.ok(FIELD_TYPES.every((type) => allowed.has(type)));
  assert.deepEqual(
    FIELD_TYPES.map((type, index) => type === "gate" ? index : null).filter((index) => index !== null),
    [7, 15, 23, 31]
  );
});

test("catalog contains only the 3D challenges", () => {
  assert.equal(MINIGAMES.length, 15);
  assert.deepEqual(
    MINIGAMES.map((game) => game.type).sort(),
    ["ballonPump", "bergsteiger", "blobklopfe", "bounceArena", "colorEscape", "fassrolle", "finishRush", "kanonenflug", "lichtwaechter", "messerwurf", "muenzregen", "nervenprobe", "seilspringen", "turmbau", "zuendstoff"]
  );
});

test("three themed boards share a clear field grammar", () => {
  assert.equal(BOARD_DEFINITIONS.length, 3);
  assert.equal(new Set(BOARD_DEFINITIONS.map((board) => board.id)).size, 3);
  BOARD_DEFINITIONS.forEach((board) => {
    assert.equal(board.fieldTypes.length, 32);
    assert.equal(board.routes.length, 32);
    assert.equal(board.zones.length, 4);
    assert.equal(board.fieldTypes.filter((type) => type === "gate").length, 4);
    // Simple loop: every field has exactly one way forward (no shortcuts).
    assert.ok(board.routes.every((routes) => routes.length === 1));
  });
});

test("movement is a simple loop around the board", () => {
  const mossback = getBoard("mossback");
  assert.deepEqual(buildBoardPath(mossback, 4, 1), [5]);
  assert.deepEqual(buildBoardPath(mossback, 4, 3), [5, 6, 7]);
  // Wraps around the end of the 32-field loop.
  assert.deepEqual(buildBoardPath(mossback, 31, 2), [0, 1]);
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

test("field effects are simple: coins only", () => {
  const runner = player({ coins: 1 });
  // Every normal field pays the same modest coin reward — one field language.
  assert.equal(applyFieldEffect(runner, "normal").coins, 2);
  assert.equal(runner.coins, 3);
  assert.equal(applyFieldEffect(runner, "start").coins, 2);
  assert.equal(runner.coins, 5);
  assert.equal(applyFieldEffect(runner, "challenge").coins, 0);
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

test("bumper: you cannot drive yourself off the plate", () => {
  const solo = player({ id: "solo", name: "Solo", color: "#fff" });
  const startedAt = Date.now() - 2000;
  const arena = createArenaState([solo], startedAt);
  const minigame = { type: "bounceArena", arena, scores: {}, startedAt, duration: 18000, lastInputAt: {} };
  const room = { currentMinigame: minigame, players: [solo] };
  const entry = arena.players[solo.id];
  entry.invulnUntil = 0; // past the spawn grace

  // Slam the stick outward for a couple of seconds of ticks.
  for (let tick = 0; tick < 60; tick += 1) {
    handleArenaInput(room, solo, { action: "thrust", x: 1, y: 0 });
    arena.lastUpdateAt = Date.now() - 90;
    updateBounceArena(room);
  }
  assert.ok(entry.inPlay, "self-thrust never launches you over the rim");
  assert.ok(Math.hypot(entry.x, entry.y) <= ARENA_RADIUS, "stays on the plate");
});

test("bumper: a hard ram knocks a rival off for good (single elimination)", () => {
  const attacker = player({ id: "atk", name: "Atk", color: "#f00" });
  const victim = player({ id: "vic", name: "Vic", color: "#00f" });
  const third = player({ id: "third", name: "Third", color: "#0f0" });
  const startedAt = Date.now() - 3000;
  const arena = createArenaState([attacker, victim, third], startedAt);
  const minigame = { type: "bounceArena", arena, scores: {}, startedAt, duration: 18000, lastInputAt: {}, finishing: false };
  const room = { currentMinigame: minigame, players: [attacker, victim, third] };
  const atk = arena.players[attacker.id];
  const vic = arena.players[victim.id];
  Object.values(arena.players).forEach((ap) => { ap.invulnUntil = 0; });

  // Line them up: victim near the rim, attacker charging into it fast.
  vic.x = ARENA_RADIUS - ARENA_BALL_RADIUS - 0.02; vic.y = 0; vic.vx = 0; vic.vy = 0;
  atk.x = vic.x - ARENA_BALL_RADIUS * 2 - 0.05; atk.y = 0; atk.vx = 3.2; atk.vy = 0;

  let knocked = false;
  for (let tick = 0; tick < 40 && !knocked; tick += 1) {
    arena.lastUpdateAt = Date.now() - 90;
    updateBounceArena(room);
    if (!vic.inPlay) knocked = true;
  }
  assert.ok(knocked, "the rammed rival is knocked off the plate");
  assert.equal(atk.knockouts, 1, "the attacker is credited the knockout");

  // No respawn — the victim stays out for the rest of the round.
  vic.outUntil = Date.now() - 1;
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);
  assert.equal(vic.inPlay, false, "a knocked-off player never comes back");
});

test("bumper: deciding the round starts a finale window instead of an abrupt cut", () => {
  const one = player({ id: "one", name: "One", color: "#f00" });
  const two = player({ id: "two", name: "Two", color: "#00f" });
  const startedAt = Date.now() - 3000;
  const arena = createArenaState([one, two], startedAt);
  const minigame = { type: "bounceArena", arena, scores: {}, startedAt, duration: 18000, lastInputAt: {}, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };

  // Two is already off the plate → the round is decided.
  arena.players[two.id].inPlay = false;
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);

  assert.ok(minigame.finaleAt, "a finale window is scheduled");
  assert.ok(minigame.finaleAt > Date.now(), "the scoreboard waits for the finale to play out");
  assert.ok(!minigame.finishing, "the round is not finished during the finale");
});

test("bumper: a survivor still on the plate outranks anyone eliminated", () => {
  const survivor = bounceResultScore({ score: 90, knockouts: 0, inPlay: true });
  const eliminated = bounceResultScore({ score: 240, knockouts: 3, inPlay: false });
  assert.ok(survivor > eliminated, "last one standing wins");
  assert.equal(bounceResultScore(null), 0);
});

test("runner course always leaves at least one open lane per row", () => {
  const rows = createRunnerCourse(367);
  assert.ok(rows.length > 4);
  for (let sample = 0; sample < 6; sample += 1) {
    const now = sample * 220;
    rows.forEach((row) => {
      if (row.kind === "boost") return;
      const blocked = runnerBlockedLanes(row, now);
      assert.ok(blocked.length < 3, "never all three lanes blocked");
    });
  }
});

test("runner auto-runs, stumbles on obstacles and ranks finishers by time", () => {
  const runner = player({ id: "rn", name: "RN", color: "#fff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];
  assert.equal(entry.progress, 0);

  for (let tick = 0; tick < 900 && !entry.finishedAt; tick += 1) {
    arcade.lastUpdateAt = Date.now() - 60;
    updateArcade(room);
  }
  assert.ok(entry.progress > 0, "the runner moves forward on its own");

  const finished = arcadeRankingScore(arcade, { finishedAt: 1, finishMs: 5000 });
  const stillGoing = arcadeRankingScore(arcade, { finishedAt: null, progress: 40 });
  assert.ok(finished > stillGoing, "finishers outrank runners still on the track");
});

test("runner lane input clamps to the three lanes", () => {
  const runner = player({ id: "ln", name: "LN", color: "#fff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000 };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];
  entry.lastInputAt = 0;
  handleArcadeInput(room, runner, { action: "lane", dir: -1 });
  entry.lastInputAt = 0;
  handleArcadeInput(room, runner, { action: "lane", dir: -1 });
  assert.equal(entry.lane, 0, "lane cannot go below 0");
  entry.lastInputAt = 0;
  handleArcadeInput(room, runner, { action: "lane", dir: 1 });
  entry.lastInputAt = 0;
  handleArcadeInput(room, runner, { action: "lane", dir: 1 });
  entry.lastInputAt = 0;
  handleArcadeInput(room, runner, { action: "lane", dir: 1 });
  assert.equal(entry.lane, 2, "lane cannot exceed 2");
});

test("color escape guarantees safe tiles and rewards standing on the target color", () => {
  const runner = player({ id: "ce", name: "CE", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("colorEscape", [runner], startedAt);
  const targetTiles = arcade.grid.filter((color) => color === arcade.targetColor).length;
  assert.ok(targetTiles >= 6, "every round keeps enough safe tiles");

  const minigame = { arcade, scores: {}, startedAt, duration: 38000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];

  // Move onto a guaranteed safe tile before the floor drops.
  const safeIndex = arcade.grid.findIndex((color) => color === arcade.targetColor);
  entry.gx = safeIndex % 6;
  entry.gy = Math.floor(safeIndex / 6);

  // Advance time into the drop phase of round 0.
  minigame.startedAt = Date.now() - (arcade.leadMs + arcade.announceMs + 200);
  updateArcade(room);
  assert.equal(entry.survived, 1, "surviving a drop scores a round");
  assert.notEqual(entry.fallenRound, arcade.round, "safe player did not fall");
});

test("color escape never lets two players share a tile", () => {
  const one = player({ id: "one", name: "One", color: "#f00" });
  const two = player({ id: "two", name: "Two", color: "#00f" });
  const startedAt = Date.now();
  const arcade = createArcadeState("colorEscape", [one, two], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 38000, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };
  const a = arcade.players[one.id];
  const b = arcade.players[two.id];

  // Place them side by side and try to step onto the occupied tile.
  a.gx = 2; a.gy = 2;
  b.gx = 3; b.gy = 2;
  a.lastInputAt = 0;
  assert.deepEqual(handleArcadeInput(room, one, { action: "step", dir: "right" }), { ok: true });
  assert.equal(a.gx, 2, "step onto an occupied tile bounces off");
  assert.equal(a.gy, 2);

  // A free tile still works.
  a.lastInputAt = 0;
  handleArcadeInput(room, one, { action: "step", dir: "left" });
  assert.equal(a.gx, 1, "free tiles are steppable");
});

test("color escape drops a player standing on the wrong color", () => {
  const runner = player({ id: "cf", name: "CF", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("colorEscape", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 38000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];

  const wrongIndex = arcade.grid.findIndex((color) => color !== arcade.targetColor);
  entry.gx = wrongIndex % 6;
  entry.gy = Math.floor(wrongIndex / 6);

  minigame.startedAt = Date.now() - (arcade.leadMs + arcade.announceMs + 200);
  updateArcade(room);
  assert.equal(entry.fallenRound, arcade.round, "wrong-color player falls");
  assert.equal(entry.survived, 0, "a fallen player scores no round");
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

test("lichtwaechter: running on green moves, running on red costs progress", () => {
  const sprinter = player({ id: "rl", name: "RL", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("lichtwaechter", [sprinter], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 32000, finishing: false };
  const room = { currentMinigame: minigame, players: [sprinter] };
  const entry = arcade.players[sprinter.id];

  // Phases alternate strictly green/red starting on green.
  assert.equal(arcade.phases[0].kind, "green");
  assert.equal(arcade.phases[1].kind, "red");

  // Hold the button in the middle of the first green phase.
  const greenNow = startedAt + Math.floor((arcade.phases[0].from + arcade.phases[0].until) / 2);
  entry.lastRunAt = greenNow;
  testRules.updateRedlight(room, minigame, arcade, 0.1, greenNow);
  assert.ok(entry.progress > 0, "green light lets the runner move");
  const afterGreen = entry.progress;

  // Keep holding well into the red phase (past the grace window).
  const redPhase = arcade.phases[1];
  const redNow = startedAt + redPhase.from + 800;
  entry.lastRunAt = redNow;
  testRules.updateRedlight(room, minigame, arcade, 0.1, redNow);
  assert.equal(entry.caught, 1, "sprinting on red gets caught");
  assert.ok(entry.progress < afterGreen, "getting caught costs progress");

  // The same red phase only punishes once.
  entry.lastRunAt = redNow + 100;
  testRules.updateRedlight(room, minigame, arcade, 0.1, redNow + 100);
  assert.equal(entry.caught, 1);
});

test("lichtwaechter: reaching the gate finishes the run and ranks by time", () => {
  const sprinter = player({ id: "rl2", name: "RL2", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("lichtwaechter", [sprinter], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 32000, finishing: false };
  const room = { currentMinigame: minigame, players: [sprinter] };
  const entry = arcade.players[sprinter.id];

  entry.progress = arcade.goal - 0.01;
  const greenNow = startedAt + Math.floor((arcade.phases[0].from + arcade.phases[0].until) / 2);
  entry.lastRunAt = greenNow;
  testRules.updateRedlight(room, minigame, arcade, 0.1, greenNow);
  assert.ok(entry.finishedAt, "crossing the goal line finishes");
  assert.ok(entry.finishMs > 0);

  const finished = arcadeRankingScore(arcade, entry);
  const stillRunning = arcadeRankingScore(arcade, { progress: arcade.goal - 1, finishedAt: null });
  assert.ok(finished > stillRunning, "finishers beat runners");
});

test("seilspringen: airborne players survive the wave, grounded players are out", () => {
  const jumper = player({ id: "wa", name: "WA", color: "#fff" });
  const sleeper = player({ id: "wb", name: "WB", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("seilspringen", [jumper, sleeper], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 36000, finishing: false };
  const room = { currentMinigame: minigame, players: [jumper, sleeper] };
  const a = arcade.players[jumper.id];
  const b = arcade.players[sleeper.id];

  const wave = arcade.waves[0];
  // Jumper takes off shortly before impact and is mid-air when the wave hits.
  a.jumpUntil = startedAt + wave.hitAt + Math.floor(testRules.WAVE_JUMP_MS * 0.4);
  const now = startedAt + wave.hitAt + 10;
  testRules.updateWave(room, minigame, arcade, now);

  assert.equal(a.eliminated, false, "mid-air player survives");
  assert.equal(a.survived, 1, "survivor banks the wave");
  assert.equal(b.eliminated, true, "grounded player is swept away");
  assert.ok(wave.processed, "each wave resolves exactly once");

  const survivorScore = arcadeRankingScore(arcade, a);
  const sweptScore = arcadeRankingScore(arcade, b);
  assert.ok(survivorScore > sweptScore, "survivors outrank the eliminated");
});

test("seilspringen: a jump that already landed does not save the player", () => {
  const early = player({ id: "wc", name: "WC", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("seilspringen", [early], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 36000, finishing: false };
  const room = { currentMinigame: minigame, players: [early] };
  const entry = arcade.players[early.id];

  const wave = arcade.waves[0];
  // Jump so early that the player is back on the raft before impact.
  entry.jumpUntil = startedAt + wave.hitAt - 50;
  testRules.updateWave(room, minigame, arcade, startedAt + wave.hitAt + 10);
  assert.equal(entry.eliminated, true, "landing before the wave means elimination");
});

test("zielgerade: pickups can be thrown and tumble the runner ahead", () => {
  const chaser = player({ id: "ra", name: "RA", color: "#fff" });
  const leader = player({ id: "rb", name: "RB", color: "#0ff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [chaser, leader], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000, finishing: false };
  const room = { currentMinigame: minigame, players: [chaser, leader] };
  const a = arcade.players[chaser.id];
  const b = arcade.players[leader.id];

  // The course always contains pickup rows.
  assert.ok(arcade.rows.some((row) => row.kind === "item"), "course has item pads");

  // Without an item the throw does nothing.
  assert.deepEqual(handleArcadeInput(room, chaser, { action: "throw" }), { ok: true });
  assert.equal(arcade.shots.length, 0);

  // With an item, the shot flies straight forward down the thrower's lane.
  a.hasItem = true;
  a.lane = 1;
  b.lane = 1;
  a.progress = 10;
  b.progress = 24;
  a.lastInputAt = 0;
  handleArcadeInput(room, chaser, { action: "throw" });
  assert.equal(a.hasItem, false, "throwing consumes the pickup");
  assert.equal(arcade.shots.length, 1);
  assert.equal(arcade.shots[0].lane, 1, "shot travels down the thrower's lane");

  // The shot overtakes the leader in the same lane and tumbles them.
  arcade.shots[0].firedAt = Date.now() - 1000; // 1s * 60 m/s = 60m travelled
  testRules.updateArcade(room);
  assert.ok(b.stumbleUntil > Date.now(), "hit runner is tumbling");
  assert.equal(b.stumbles, 1);
  assert.equal(a.throwsHit, 1, "thrower gets the credit");

  // A runner in a different lane is not hit.
  const dodger = player({ id: "rd", name: "RD", color: "#0f0" });
  arcade.players[dodger.id] = { lane: 0, progress: 30, stumbles: 0, finishedAt: null };
  room.players.push(dodger);
  a.hasItem = true;
  a.lastInputAt = 0;
  a.progress = 10;
  handleArcadeInput(room, chaser, { action: "throw" });
  const laneShot = arcade.shots[arcade.shots.length - 1];
  laneShot.firedAt = Date.now() - 1000;
  testRules.updateArcade(room);
  assert.equal(arcade.players[dodger.id].stumbles, 0, "a runner in another lane is safe");
});

test("zielgerade: running over an item pad picks it up", () => {
  const runner = player({ id: "rc", name: "RC", color: "#fff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];

  const itemRow = arcade.rows.find((row) => row.kind === "item");
  const itemIndex = arcade.rows.indexOf(itemRow);
  entry.lane = itemRow.lane;
  entry.nextRow = itemIndex;
  entry.progress = itemRow.position - 0.01;
  testRules.updateArcade(room);
  assert.equal(entry.hasItem, true, "pad on the own lane grants the pickup");
});

test("marathon plan picks distinct minigames", () => {
  const plan = testRules.buildArcadePlan(5);
  assert.equal(plan.length, 5);
  assert.equal(new Set(plan).size, 5, "no repeats in a marathon plan");
  plan.forEach((type) => assert.ok(MINIGAMES.some((game) => game.type === type)));
});

test("pump-panik: every tap counts and ranks by taps", () => {
  const tapper = player({ id: "pa", name: "PA", color: "#fff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("ballonPump", [tapper], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 12000, finishing: false };
  const room = { currentMinigame: minigame, players: [tapper] };
  const entry = arcade.players[tapper.id];

  for (let i = 0; i < 5; i += 1) {
    entry.lastInputAt = 0;
    handleArcadeInput(room, tapper, { action: "pump" });
  }
  assert.equal(entry.pumps, 5);
  assert.ok(arcadeRankingScore(arcade, { pumps: 9 }) > arcadeRankingScore(arcade, { pumps: 5 }));
});

test("fassrolle: the spinning barrel slides idle players off, counter-running holds", () => {
  const idle = player({ id: "ba", name: "BA", color: "#fff" });
  const runner = player({ id: "bb", name: "BB", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("fassrolle", [idle, runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 32000, finishing: false };
  const room = { currentMinigame: minigame, players: [idle, runner] };
  const a = arcade.players[idle.id];
  const b = arcade.players[runner.id];

  // Simulate 20 seconds in 50ms steps; the runner counters their drift.
  for (let t = 0; t < 20000; t += 50) {
    const now = startedAt + t;
    const phase = testRules.barrelPhaseAt(arcade, t);
    const drift = b.offset + phase.vel * 0.3;
    if (Math.abs(drift) > 0.1) {
      b.lastRunAt = now;
      b.runDir = drift > 0 ? -1 : 1;
    }
    testRules.updateBarrel(room, minigame, arcade, 0.05, now);
  }
  assert.ok(a.fallenAt, "an idle player slides off the barrel");
  assert.equal(b.fallenAt, null, "counter-running keeps you on top");
  assert.ok(arcadeRankingScore(arcade, b) > arcadeRankingScore(arcade, a), "survivor outranks the fallen");
});

test("zuendstoff: passing moves the bomb, the fuse eliminates the holder", () => {
  const one = player({ id: "za", name: "ZA", color: "#fff" });
  const two = player({ id: "zb", name: "ZB", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("zuendstoff", [one, two], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 45000, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };

  const first = arcade.holderId;
  const holderPlayer = room.players.find((p) => p.id === first);
  const holderEntry = arcade.players[first];

  // Passing before the lock does nothing; after the lock it moves on.
  arcade.canPassAt = Date.now() + 1000;
  holderEntry.lastInputAt = 0;
  handleArcadeInput(room, holderPlayer, { action: "pass" });
  assert.equal(arcade.holderId, first, "pass lock holds the bomb briefly");
  arcade.canPassAt = 0;
  holderEntry.lastInputAt = 0;
  handleArcadeInput(room, holderPlayer, { action: "pass" });
  assert.notEqual(arcade.holderId, first, "after the lock the bomb moves on");
  assert.equal(holderEntry.passes, 1);

  // Boom: whoever holds the bomb when the fuse runs out is eliminated.
  const victimId = arcade.holderId;
  arcade.fuseAt = Date.now() - 1;
  testRules.updateBomb(room, minigame, arcade, Date.now());
  assert.ok(arcade.players[victimId].outAt, "fuse eliminates the holder");
  assert.notEqual(arcade.holderId, victimId, "a survivor gets the next bomb");
  const survivorScore = arcadeRankingScore(arcade, arcade.players[arcade.holderId]);
  const victimScore = arcadeRankingScore(arcade, arcade.players[victimId]);
  assert.ok(survivorScore > victimScore, "survivors outrank the exploded");
});

test("muenzregen: catching coins scores, catching bombs costs", () => {
  const catcher = player({ id: "ca", name: "CA", color: "#fff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("muenzregen", [catcher], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 30000, finishing: false };
  const room = { currentMinigame: minigame, players: [catcher] };
  const entry = arcade.players[catcher.id];

  const coin = arcade.drops.find((drop) => drop.kind === "coin");
  const bomb = arcade.drops.find((drop) => drop.kind === "bomb");
  entry.lane = coin.lane;
  testRules.updateArcade && null;
  updateArcade; // silence lint
  // Process the coin drop.
  minigame.startedAt = Date.now() - coin.catchAt - 10;
  coin.processed = false;
  testRules.updateArcade(room);
  assert.equal(entry.catches, 1, "coin in own lane is caught");

  entry.lane = bomb.lane;
  minigame.startedAt = Date.now() - bomb.catchAt - 10;
  bomb.processed = false;
  testRules.updateArcade(room);
  assert.equal(entry.bombs, 1, "bomb in own lane hits");
  assert.ok(
    arcadeRankingScore(arcade, { catches: 5, bombs: 0 }) > arcadeRankingScore(arcade, { catches: 5, bombs: 2 })
  );
});

test("blobklopfe: only live blobs count, spiky ones backfire", () => {
  const whacker = player({ id: "wa2", name: "WA2", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("blobklopfe", [whacker], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 25000, finishing: false };
  const room = { currentMinigame: minigame, players: [whacker] };
  const entry = arcade.players[whacker.id];

  const good = arcade.pops.find((pop) => pop.kind === "good");
  minigame.startedAt = Date.now() - good.from - 50;
  entry.lastInputAt = 0;
  handleArcadeInput(room, whacker, { action: "whack", cell: good.cell });
  assert.equal(entry.hits, 1, "live good blob counts");
  entry.lastInputAt = 0;
  handleArcadeInput(room, whacker, { action: "whack", cell: good.cell });
  assert.equal(entry.hits, 1, "each blob only counts once");

  const bad = arcade.pops.find((pop) => pop.kind === "bad");
  minigame.startedAt = Date.now() - bad.from - 50;
  entry.lastInputAt = 0;
  handleArcadeInput(room, whacker, { action: "whack", cell: bad.cell });
  assert.equal(entry.badHits, 1, "spiky blob backfires");
});

test("kanonenflug: tap one locks power, tap two locks the angle (45° flies farthest)", () => {
  const gunner = player({ id: "ka", name: "KA", color: "#fff" });
  const arcade = createArcadeState("kanonenflug", [gunner], Date.now() - 650);
  const minigame = { arcade, scores: {}, startedAt: Date.now() - 650, duration: 16000, finishing: false };
  const room = { currentMinigame: minigame, players: [gunner] };
  const entry = arcade.players[gunner.id];

  // 650ms into a 1300ms period = the power gauge peak.
  handleArcadeInput(room, gunner, { action: "launch" });
  assert.equal(entry.launchedAt, null, "first tap only locks the power");
  assert.ok(entry.power > 0.95, "mid-period tap is near max power");
  assert.ok(entry.powerAt, "the angle phase starts");

  // Second tap timed to the 45° sweet spot (angleT = 0.5 at period/6).
  entry.powerAt = Date.now() - Math.round(arcade.anglePeriodMs / 6);
  entry.lastInputAt = 0;
  handleArcadeInput(room, gunner, { action: "launch" });
  assert.ok(entry.launchedAt, "second tap fires");
  assert.ok(Math.abs(entry.angle - 45) <= 4, "sweet-spot tap lands near 45 degrees");
  assert.ok(entry.distance > 90, "full power at 45° flies farthest");

  const firstDistance = entry.distance;
  entry.lastInputAt = 0;
  handleArcadeInput(room, gunner, { action: "launch" });
  assert.equal(entry.distance, firstDistance, "only one shot per game");

  // A flat angle with the same power flies much shorter.
  const flat = { power: 1, powerAt: Date.now(), lastInputAt: 0, launchedAt: null, angle: null };
  arcade.players.flatTest = flat;
  const flatPlayer = { id: "flatTest", name: "Flat", color: "#000" };
  room.players.push(flatPlayer);
  flat.powerAt = Date.now() - 40; // barely into the sweep → shallow angle
  handleArcadeInput(room, flatPlayer, { action: "launch" });
  assert.ok(flat.distance < firstDistance, "shallow angles cost distance");
});

test("messerwurf: only the active thrower may throw; a clash ends their turn", () => {
  const one = player({ id: "ka", name: "KA", color: "#fff" });
  const two = player({ id: "kb", name: "KB", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("messerwurf", [one, two], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 46000, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };
  const active = arcade.activeId === one.id ? one : two;
  const waiting = active === one ? two : one;

  // The waiting player cannot throw out of turn.
  arcade.logAngle = Math.PI;
  arcade.players[waiting.id].lastInputAt = 0;
  handleArcadeInput(room, waiting, { action: "throw" });
  assert.equal(arcade.players[waiting.id].stuck, 0, "off-turn throws are ignored");

  // The active player sticks several knives in their window.
  arcade.logAngle = 0;
  arcade.players[active.id].lastInputAt = 0;
  handleArcadeInput(room, active, { action: "throw" });
  assert.equal(arcade.players[active.id].stuck, 1, "active thrower sticks a knife");
  assert.equal(arcade.knives.length, 1);

  // Throwing onto an existing knife clashes → out, turn passes on.
  arcade.logAngle = (2 * Math.PI) / 180; // 2 degrees, inside the safety gap
  arcade.players[active.id].lastInputAt = 0;
  handleArcadeInput(room, active, { action: "throw" });
  assert.equal(arcade.players[active.id].eliminated, true, "clash knocks the thrower out");
  assert.equal(arcade.knives.length, 1, "no knife added on a clash");
  assert.equal(arcade.activeId, waiting.id, "the turn passes to the next player");

  const survivor = arcadeRankingScore(arcade, arcade.players[waiting.id]);
  const out = arcadeRankingScore(arcade, arcade.players[active.id]);
  assert.ok(survivor > out, "survivors outrank the eliminated");
});

test("messerwurf: the turn timer hands the disc to the next player", () => {
  const one = player({ id: "kc", name: "KC", color: "#fff" });
  const two = player({ id: "kd", name: "KD", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("messerwurf", [one, two], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 46000, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };
  const first = arcade.activeId;

  // Force the active window to expire; the tick advances the turn.
  arcade.turnEndsAt = Date.now() - 1;
  testRules.updateKnife(room, minigame, arcade, 0.05, Date.now());
  assert.notEqual(arcade.activeId, first, "the timer passes the turn on");
  assert.equal(arcade.players[first].turnDone, true, "the first player's turn is done");
});

test("turmbau: an aligned drop stacks, a miss topples the tower", () => {
  const builder = player({ id: "sa", name: "SA", color: "#fff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("turmbau", [builder], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 30000, finishing: false };
  const room = { currentMinigame: minigame, players: [builder] };
  const entry = arcade.players[builder.id];

  // Force the sliding block to sit right over the tower centre, then drop.
  entry.offset = 0;
  entry.phase = 0;
  minigame.startedAt = Date.now(); // elapsed ~0 → swing ~0 → block centred
  handleArcadeInput(room, builder, { action: "drop" });
  assert.equal(entry.height, 1, "a lined-up drop stacks a block");

  // Shift the tower far off, drop when the block is centred → no overlap.
  entry.offset = 5;
  entry.lastInputAt = 0;
  handleArcadeInput(room, builder, { action: "drop" });
  assert.equal(entry.toppled, true, "a total miss topples the tower");
  assert.ok(arcadeRankingScore(arcade, { height: 6, perfects: 2 }) > arcadeRankingScore(arcade, { height: 5, perfects: 9 }));
});

test("bergsteiger: alternating hands climb, a wrong hand slips", () => {
  const climber = player({ id: "ca", name: "CA", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("bergsteiger", [climber], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 26000, finishing: false };
  const room = { currentMinigame: minigame, players: [climber] };
  const entry = arcade.players[climber.id];

  const first = entry.nextSide;
  entry.lastInputAt = 0;
  handleArcadeInput(room, climber, { action: "grab", side: first });
  assert.equal(entry.rung, 1, "the right hand climbs one rung");
  assert.equal(entry.nextSide, -first, "the next hand alternates");

  // Repeat the same hand → wrong side → slip.
  entry.lastInputAt = 0;
  handleArcadeInput(room, climber, { action: "grab", side: first });
  assert.equal(entry.rung, 0, "the wrong hand slips back down");
  assert.equal(entry.slips, 1);

  const higher = arcadeRankingScore(arcade, { rung: 12, finishedAt: null });
  const lower = arcadeRankingScore(arcade, { rung: 4, finishedAt: null });
  assert.ok(higher > lower, "climbing higher ranks better");
});
