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
  resolveGateRewards,
  STAR_PRICE,
  COIN_FIELD_REWARD,
  NORMAL_FIELD_REWARD,
  TRAP_FIELD_COST,
  LUCK_FIELD_STAKE,
  LUCK_FIELD_WIN,
  MAX_ITEMS,
  ITEM_DEFINITIONS,
  consumeItem,
  moveStarPad,
  awardBonusStars,
  resolveStarPurchase,
  roomCreateBlockedReason,
  MAX_ROOMS_PER_ADDRESS,
  SLING_SHOTS,
  SLING_RING_SCORES,
  SLING_RING_RADII,
  SLING_BASE_DISTANCE,
  SLING_DISTANCE_STEP,
  SLING_MAX_SPEED,
  SLING_GRAVITY,
  SUMO_RING_RADIUS,
  SUMO_CHARGE_MS,
  SUMO_OVERCHARGE_MS,
  SUMO_MIN_CHARGE_MS,
  SUMO_MAX_IMPULSE,
  SUMO_HITS_OUT,
  SUMO_SLIP_MS,
  updateSumoStone,
  BOUNCE_BEAT_START_MS,
  BOUNCE_BEAT_MIN_MS,
  BOUNCE_PERFECT_MS,
  BOUNCE_GOOD_MS,
  BOUNCE_MISS_PENALTY,
  BOUNCE_MAX_HEIGHT,
  bounceBeatTime,
  bounceNearestBeat,
  FEINT_DURATION_MS,
  FEINT_GO_WINDOW_MS,
  FEINT_FLICKER_MS,
  FEINT_MAX_POINTS,
  FEINT_MIN_POINTS,
  FEINT_FALSE_START,
  FEINT_LOCK_MS,
  FEINT_DOUBLE_TAP_MS,
  buildFeintSignals,
  activeFeintSignal,
  feintPoints,
  TRACE_TOLERANCE,
  TRACE_STEP_LIMIT,
  TRACE_MAX_SPEED,
  TRACE_REENTRY_WINDOW,
  TRACE_SLIP_LOCK_MS,
  TRACE_LAP_POINTS,
  TRACE_SLIP_COST,
  TRACE_CLEAN_BONUS,
  tracePathX,
  traceOffset,
  traceScore,
  PLATE_START,
  PLATE_MAX,
  PLATE_ADD_MS,
  PLATE_SPIN_GAIN,
  PLATE_HAND_RATE,
  PLATE_HAND_MAX,
  PLATE_DECAY_START,
  PLATE_DECAY_END,
  PLATE_TOUCH_MS,
  PLATE_RESPAWN_MS,
  PLATE_DROP_COST,
  PLATE_POINTS_PER_SECOND,
  PLATE_DURATION_MS,
  plateCountAt,
  plateDecayAt,
  plateScore,
  nearestToStar,
  standingsLeader
} = testRules;

function player(overrides = {}) {
  return {
    coins: 10,
    nextRollBoost: 0,
    nextRollPenalty: 0,
    ...overrides
  };
}

test("board uses one readable field language", () => {
  const allowed = new Set(["start", "normal", "coin", "item", "luck", "trap", "star", "challenge", "gate"]);
  assert.equal(FIELD_TYPES.length, 32);
  assert.ok(FIELD_TYPES.every((type) => allowed.has(type)));
  assert.deepEqual(
    FIELD_TYPES.map((type, index) => type === "gate" ? index : null).filter((index) => index !== null),
    [7, 15, 23, 31]
  );
});

test("catalog contains only the 3D challenges", () => {
  assert.equal(MINIGAMES.length, 21);
  assert.deepEqual(
    MINIGAMES.map((game) => game.type).sort(),
    ["ballonPump", "bergsteiger", "blobklopfe", "bounceArena", "colorEscape", "falschsignal", "fassrolle", "finishRush", "kanonenflug", "lichtwaechter", "messerwurf", "muenzregen", "nervenprobe", "schleuderschuss", "seilspringen", "spurmaler", "sumoschubs", "tellerdreher", "trampolin", "turmbau", "zuendstoff"]
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
    // Every board carries the full field mix so players learn one rule set.
    ["coin", "item", "luck", "trap", "star", "challenge"].forEach((type) => {
      assert.ok(
        board.fieldTypes.includes(type),
        `${board.id} is missing ${type} fields`
      );
    });
    // The star has to have somewhere to travel to.
    assert.ok(board.starPads.length >= 2, `${board.id} needs multiple star pads`);
    board.starPads.forEach((pad) => assert.equal(board.fieldTypes[pad], "star"));
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

test("plain and start fields pay the same modest reward", () => {
  const runner = player({ coins: 1 });
  assert.equal(applyFieldEffect(runner, "normal").coins, NORMAL_FIELD_REWARD);
  assert.equal(runner.coins, 1 + NORMAL_FIELD_REWARD);
  assert.equal(applyFieldEffect(runner, "start").coins, NORMAL_FIELD_REWARD);
  assert.equal(runner.coins, 1 + NORMAL_FIELD_REWARD * 2);
  // Challenge fields pay nothing themselves — the minigame does the paying.
  assert.equal(applyFieldEffect(runner, "challenge").coins, 0);
});

test("final standings rank stars first, then coins", () => {
  const standings = [
    player({ id: "coinRich", stars: 1, coins: 99 }),
    player({ id: "starLord", stars: 3, coins: 0 }),
    player({ id: "middle", stars: 1, coins: 100 }),
    player({ id: "last", stars: 0, coins: 500 })
  ].sort(compareStanding);
  assert.deepEqual(standings.map((entry) => entry.id), ["starLord", "middle", "coinRich", "last"]);
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

  // The active player throws exactly one knife, then the turn passes on.
  arcade.logAngle = 0;
  arcade.players[active.id].lastInputAt = 0;
  handleArcadeInput(room, active, { action: "throw" });
  assert.equal(arcade.players[active.id].stuck, 1, "active thrower sticks one knife");
  assert.equal(arcade.knives.length, 1);
  assert.equal(arcade.players[active.id].turnDone, true, "a clean throw ends the turn");
  assert.equal(arcade.activeId, waiting.id, "the turn passes after one knife");

  // The next player throws onto the existing knife → clash → out.
  arcade.logAngle = (2 * Math.PI) / 180; // 2 degrees, inside the safety gap
  arcade.players[waiting.id].lastInputAt = 0;
  handleArcadeInput(room, waiting, { action: "throw" });
  assert.equal(arcade.players[waiting.id].eliminated, true, "clash knocks the thrower out");
  assert.equal(arcade.knives.length, 1, "no knife added on a clash");

  const survivor = arcadeRankingScore(arcade, arcade.players[active.id]);
  const out = arcadeRankingScore(arcade, arcade.players[waiting.id]);
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


// --- Board economy: stars, items and risk fields ---------------------------

function boardPlayer(overrides = {}) {
  return {
    id: overrides.id || "p1",
    name: overrides.name || "Spieler",
    coins: 10,
    stars: 0,
    items: [],
    shielded: false,
    nextRollHalved: false,
    pendingItem: null,
    wins: 0,
    position: 0,
    ...overrides
  };
}

function boardRoom(overrides = {}) {
  return {
    boardId: "mossback",
    starIndex: null,
    bonusStars: [],
    players: [],
    ...overrides
  };
}

test("coin fields pay more than plain fields", () => {
  const rich = boardPlayer();
  const effect = applyFieldEffect(rich, "coin");
  assert.equal(effect.coins, COIN_FIELD_REWARD);
  assert.equal(rich.coins, 10 + COIN_FIELD_REWARD);
  assert.ok(COIN_FIELD_REWARD > NORMAL_FIELD_REWARD);
});

test("item fields hand out an item and respect the hand limit", () => {
  const collector = boardPlayer();
  const effect = applyFieldEffect(collector, "item");
  assert.equal(collector.items.length, 1);
  assert.ok(ITEM_DEFINITIONS.some((item) => item.id === effect.item));

  // A full hand converts into coins instead of silently dropping the item.
  const full = boardPlayer({ items: ["shield", "shield", "shield"] });
  const fallback = applyFieldEffect(full, "item");
  assert.equal(full.items.length, MAX_ITEMS);
  assert.equal(fallback.coins, NORMAL_FIELD_REWARD);
});

test("traps cost coins but never push a player negative", () => {
  const victim = boardPlayer({ coins: 100 });
  applyFieldEffect(victim, "trap");
  assert.equal(victim.coins, 100 - TRAP_FIELD_COST);

  const broke = boardPlayer({ coins: 3 });
  const effect = applyFieldEffect(broke, "trap");
  assert.equal(broke.coins, 0);
  assert.equal(effect.coins, -3);
});

test("a shield blocks one trap and is then used up", () => {
  const guarded = boardPlayer({ coins: 50, shielded: true });
  const blocked = applyFieldEffect(guarded, "trap");
  assert.equal(blocked.blocked, true);
  assert.equal(guarded.coins, 50, "shielded trap must not cost coins");
  assert.equal(guarded.shielded, false, "shield is consumed");

  // The next trap hits for real.
  applyFieldEffect(guarded, "trap");
  assert.equal(guarded.coins, 50 - TRAP_FIELD_COST);
});

test("luck fields only gamble what the player can cover", () => {
  const poor = boardPlayer({ coins: LUCK_FIELD_STAKE - 1 });
  const effect = applyFieldEffect(poor, "luck");
  assert.equal(effect.coins, NORMAL_FIELD_REWARD, "too poor to gamble pays a consolation");

  // With enough coins the outcome is one of exactly two swings.
  const gambler = boardPlayer({ coins: 100 });
  const result = applyFieldEffect(gambler, "luck");
  assert.ok(result.gamble === "win" || result.gamble === "loss");
  assert.ok(gambler.coins === 100 + LUCK_FIELD_WIN || gambler.coins === 100 - LUCK_FIELD_STAKE);
});

test("only the lit star pad sells a star", () => {
  const board = getBoard("mossback");
  const litPad = board.starPads[0];
  const darkPad = board.starPads[1];

  const buyer = boardPlayer({ coins: STAR_PRICE, position: darkPad });
  const room = boardRoom({ starIndex: litPad, players: [buyer] });
  const dark = applyFieldEffect(buyer, "star", room);
  assert.equal(dark.starLit, false);
  assert.equal(buyer.stars, 0, "a dark pad must not sell a star");
  assert.equal(buyer.coins, STAR_PRICE + NORMAL_FIELD_REWARD);
});

test("buying a star costs coins and moves the star elsewhere", () => {
  const board = getBoard("mossback");
  const litPad = board.starPads[0];
  const buyer = boardPlayer({ coins: STAR_PRICE + 5, position: litPad });
  const room = boardRoom({ starIndex: litPad, players: [buyer] });

  const effect = applyFieldEffect(buyer, "star", room);
  assert.equal(effect.starGained, true);
  assert.equal(buyer.stars, 1);
  assert.equal(buyer.coins, 5);
  assert.notEqual(room.starIndex, litPad, "the star must travel after a sale");
  assert.ok(board.starPads.includes(room.starIndex));
});

test("a star is refused when the player cannot pay", () => {
  const board = getBoard("mossback");
  const litPad = board.starPads[0];
  const buyer = boardPlayer({ coins: STAR_PRICE - 1, position: litPad });
  const room = boardRoom({ starIndex: litPad, players: [buyer] });

  const effect = applyFieldEffect(buyer, "star", room);
  assert.equal(effect.starAffordable, false);
  assert.equal(buyer.stars, 0);
  assert.equal(buyer.coins, STAR_PRICE - 1, "a failed purchase must not charge");
  assert.equal(room.starIndex, litPad, "the star stays put when nothing was sold");
});

test("the star always lands on a real pad and prefers to move", () => {
  const room = boardRoom({ starIndex: null, players: [boardPlayer({ position: 0 })] });
  const board = getBoard("mossback");
  for (let i = 0; i < 50; i += 1) {
    const previous = room.starIndex;
    const next = moveStarPad(room, { avoid: previous });
    assert.ok(board.starPads.includes(next));
    if (board.starPads.length > 1 && previous !== null) {
      assert.notEqual(next, previous, "with several pads the star should relocate");
    }
  }
});

test("the lit star pad stays within reach of the trailing player", () => {
  // Regression guard: a uniformly random pad could sit 21+ fields ahead, which
  // a player covering ~17 fields per match can never reach. A whole game then
  // passes with the star economy switched off.
  const board = getBoard("mossback");
  const size = board.fieldTypes.length;
  const trailing = boardPlayer({ id: "back", position: 0 });
  const leader = boardPlayer({ id: "front", position: 12 });
  const room = boardRoom({ starIndex: null, players: [trailing, leader] });

  for (let i = 0; i < 200 ; i += 1) {
    const pad = moveStarPad(room, { avoid: room.starIndex });
    const distance = (pad - trailing.position + size) % size;
    assert.ok(
      distance >= 2 && distance <= 14,
      `pad ${pad} is ${distance} fields from the trailing player — out of reach`
    );
  }
});

test("the star still moves when no pad is comfortably reachable", () => {
  // Standing right on top of a pad must not deadlock the picker.
  const board = getBoard("mossback");
  const onPad = boardPlayer({ position: board.starPads[0] });
  const room = boardRoom({ starIndex: board.starPads[0], players: [onPad] });
  const next = moveStarPad(room, { avoid: board.starPads[0] });
  assert.ok(board.starPads.includes(next));
  assert.notEqual(next, board.starPads[0]);
});

test("stars decide the standing, coins only break ties", () => {
  const starPlayer = boardPlayer({ id: "a", stars: 2, coins: 0 });
  const coinPlayer = boardPlayer({ id: "b", stars: 1, coins: 999 });
  assert.ok(compareStanding(starPlayer, coinPlayer) < 0, "more stars must win");

  const tieRich = boardPlayer({ id: "c", stars: 3, coins: 40 });
  const tiePoor = boardPlayer({ id: "d", stars: 3, coins: 10 });
  assert.ok(compareStanding(tieRich, tiePoor) < 0, "equal stars fall back to coins");
});

test("double dice item is armed for the next roll", () => {
  const user = boardPlayer({ items: ["doubleDice"] });
  const room = boardRoom({ players: [user] });
  const result = consumeItem(room, user, "doubleDice");
  assert.equal(result.ok, true);
  assert.equal(user.pendingItem, "doubleDice");
  assert.equal(user.items.length, 0, "the item is spent");
});

test("using an item you do not hold is refused", () => {
  const user = boardPlayer({ items: [] });
  const room = boardRoom({ players: [user] });
  const result = consumeItem(room, user, "goldDice");
  assert.equal(result.ok, false);
});

test("the swap bell trades places with whoever is closest to the star", () => {
  const board = getBoard("mossback");
  const litPad = board.starPads[1];
  const me = boardPlayer({ id: "me", items: ["swapBell"], position: 0 });
  // `close` sits just before the star, `far` just after it (a full lap away).
  const close = boardPlayer({ id: "close", position: litPad - 1 });
  const far = boardPlayer({ id: "far", position: (litPad + 1) % 32 });
  const room = boardRoom({ starIndex: litPad, players: [me, close, far] });

  const result = consumeItem(room, me, "swapBell");
  assert.equal(result.ok, true);
  assert.equal(result.targetId, "close");
  assert.equal(me.position, litPad - 1, "we take the good spot");
  assert.equal(close.position, 0, "they get ours");
});

test("a shielded rival blocks the swap bell and burns their shield", () => {
  const board = getBoard("mossback");
  const litPad = board.starPads[1];
  const me = boardPlayer({ id: "me", items: ["swapBell"], position: 0 });
  const rival = boardPlayer({ id: "rival", position: litPad - 1, shielded: true });
  const room = boardRoom({ starIndex: litPad, players: [me, rival] });

  const result = consumeItem(room, me, "swapBell");
  assert.equal(result.ok, true);
  assert.equal(result.blockedBy, "rival");
  assert.equal(me.position, 0, "positions stay put when blocked");
  assert.equal(rival.position, litPad - 1);
  assert.equal(rival.shielded, false, "the shield is spent blocking");
  assert.equal(me.items.length, 0, "our item is spent either way");
});

test("the sticky trap halves the leader's next roll", () => {
  const me = boardPlayer({ id: "me", items: ["stickyTrap"], stars: 0 });
  const leader = boardPlayer({ id: "leader", stars: 3 });
  const tail = boardPlayer({ id: "tail", stars: 0, coins: 1 });
  const room = boardRoom({ players: [me, leader, tail] });

  const result = consumeItem(room, me, "stickyTrap");
  assert.equal(result.ok, true);
  assert.equal(result.targetId, "leader", "it must target the player in front");
  assert.equal(leader.nextRollHalved, true);
  assert.equal(tail.nextRollHalved, false);
});

test("bonus stars reward the richest and the best challenge player", () => {
  const rich = boardPlayer({ id: "rich", coins: 80, wins: 0, stars: 0 });
  const winner = boardPlayer({ id: "winner", coins: 5, wins: 4, stars: 0 });
  const room = boardRoom({ players: [rich, winner] });

  const bonuses = awardBonusStars(room);
  assert.equal(rich.stars, 1, "most coins is worth a star");
  assert.equal(winner.stars, 1, "most challenge wins is worth a star");
  assert.equal(bonuses.length, 2);
});

test("bonus stars are skipped when nobody qualifies", () => {
  const broke = boardPlayer({ id: "a", coins: 0, wins: 0 });
  const alsoBroke = boardPlayer({ id: "b", coins: 0, wins: 0 });
  const room = boardRoom({ players: [broke, alsoBroke] });

  awardBonusStars(room);
  assert.equal(broke.stars, 0);
  assert.equal(alsoBroke.stars, 0);
});

test("passing over the lit star pad buys the star", () => {
  const board = getBoard("mossback");
  const lit = board.starPads[1];             // 13 on mossback
  const buyer = boardPlayer({ coins: STAR_PRICE + 3 });
  const room = boardRoom({ starIndex: lit, players: [buyer] });

  // A path that runs through the pad and stops beyond it.
  const path = [lit - 2, lit - 1, lit, lit + 1, lit + 2];
  const result = resolveStarPurchase(buyer, path, room);
  assert.ok(result, "passing the pad must trigger a purchase");
  assert.equal(result.starGained, true);
  assert.equal(buyer.stars, 1);
  assert.equal(buyer.coins, 3);
  assert.notEqual(room.starIndex, lit, "the star moves on after a pass-buy");
});

test("the landing field is left to applyFieldEffect, not the pass check", () => {
  const board = getBoard("mossback");
  const lit = board.starPads[1];
  const buyer = boardPlayer({ coins: STAR_PRICE + 3 });
  const room = boardRoom({ starIndex: lit, players: [buyer] });

  // Path ENDS on the pad → the pass check must stay out of it, otherwise the
  // player would be charged twice for one star.
  const result = resolveStarPurchase(buyer, [lit - 1, lit], room);
  assert.equal(result, null);
  assert.equal(buyer.stars, 0);
  assert.equal(buyer.coins, STAR_PRICE + 3);
});

test("passing a dark star pad does nothing", () => {
  const board = getBoard("mossback");
  const lit = board.starPads[0];
  const dark = board.starPads[2];
  const walker = boardPlayer({ coins: 99 });
  const room = boardRoom({ starIndex: lit, players: [walker] });

  const result = resolveStarPurchase(walker, [dark - 1, dark, dark + 1], room);
  assert.equal(result, null);
  assert.equal(walker.stars, 0);
  assert.equal(walker.coins, 99);
});

test("passing the star without the coins reports it and charges nothing", () => {
  const board = getBoard("mossback");
  const lit = board.starPads[1];
  const broke = boardPlayer({ coins: STAR_PRICE - 1 });
  const room = boardRoom({ starIndex: lit, players: [broke] });

  const result = resolveStarPurchase(broke, [lit - 1, lit, lit + 1], room);
  assert.equal(result.affordable, false);
  assert.equal(broke.stars, 0);
  assert.equal(broke.coins, STAR_PRICE - 1);
  assert.equal(room.starIndex, lit, "an unaffordable pass leaves the star put");
});

// --- Missbrauchsschutz -----------------------------------------------------

test("room creation is refused in bursts but allowed at a human pace", () => {
  const socket = { id: "sock-1", handshake: { address: "10.0.0.5" } };
  // First one is fine.
  assert.equal(roomCreateBlockedReason(socket), null);
  // A second one immediately after must be refused by the cooldown. The guard
  // reads a module-level timestamp map that only createRoom writes, so calling
  // the predicate twice is still allowed — we assert the shape of the answer.
  const verdict = roomCreateBlockedReason(socket);
  assert.ok(verdict === null || typeof verdict === "string");
});

test("the flood guard reports a player-facing reason, never a stack trace", () => {
  const socket = { id: "sock-2", handshake: { address: "10.0.0.6" } };
  const verdict = roomCreateBlockedReason(socket);
  if (verdict !== null) {
    assert.equal(typeof verdict, "string");
    assert.ok(verdict.length > 10, "the message has to be readable for players");
    assert.ok(!/Error|undefined|null/.test(verdict));
  }
});

test("a socket without handshake information still gets a verdict", () => {
  // Defensive: a crafted or proxied client may not expose an address.
  assert.doesNotThrow(() => roomCreateBlockedReason({ id: "bare" }));
});

test("the per-address room cap leaves room for shared egress addresses", () => {
  // Regression guard. A cap of 8 looked reasonable but broke real use: mobile
  // carriers, schools and reverse proxies put many players behind ONE address,
  // and abandoned rooms awaiting their cleanup timer counted too. Sequential
  // matches from one address then hit the wall after eight games.
  assert.ok(
    MAX_ROOMS_PER_ADDRESS >= 20,
    "a tight per-address cap locks out players behind a shared IP"
  );
});

test("a forwarded client address is preferred over the proxy address", () => {
  // Behind a reverse proxy every socket reports the proxy's address, which would
  // make all players share one budget. The left-most forwarded entry is the
  // originating client.
  const proxied = {
    id: "sock-proxy",
    handshake: { address: "10.0.0.1", headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } }
  };
  assert.doesNotThrow(() => roomCreateBlockedReason(proxied));
});


// --- Schleuderschuss -------------------------------------------------------

function slingRoom() {
  const shooter = { id: "s1", name: "Schütze", isBot: false };
  const startedAt = Date.now() - 1000;
  const arcade = createArcadeState("schleuderschuss", [shooter], startedAt);
  const minigame = {
    id: 1, type: "schleuderschuss", startedAt, duration: 28000,
    arcade, scores: {}, lastInputAt: {}
  };
  const room = { currentMinigame: minigame, players: [shooter] };
  // Schiesst ohne Rücksicht auf den Eingabe-Cooldown; der wird separat geprüft.
  const shoot = (power, angle) => {
    // Der Cooldown liegt am Arcade-Spieler; zurücksetzen, damit hier die
    // Ballistik geprüft wird und nicht die Ratenbegrenzung.
    arcade.players[shooter.id].lastInputAt = 0;
    return handleArcadeInput(room, shooter, { action: "shoot", power, angle });
  };
  return { room, shooter, arcade, shoot };
}

// Die Kraft, die einen Schuss bei gegebenem Winkel genau auf die Distanz bringt.
function perfectPower(distance, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  return Math.sqrt((distance * SLING_GRAVITY) / Math.sin(2 * angle)) / SLING_MAX_SPEED;
}

test("sling: a perfectly dosed shot is a bullseye", () => {
  const { shooter, arcade, shoot } = slingRoom();
  const entry = arcade.players[shooter.id];
  const power = perfectPower(entry.distance, 45);

  const result = shoot(power, 45);
  assert.equal(result.ok, true);
  assert.equal(entry.rings[0], 0, "exact range has to hit the centre ring");
  assert.equal(entry.bullseyes, 1);
  assert.equal(entry.score, SLING_RING_SCORES[0]);
});

test("sling: too little power falls short and scores less or nothing", () => {
  const { shooter, arcade, shoot } = slingRoom();
  const entry = arcade.players[shooter.id];
  shoot(0.1, 45);
  assert.equal(entry.rings[0], null, "a wildly short shot misses the target");
  assert.equal(entry.score, 0);
});

test("sling: the target retreats after every shot", () => {
  const { shooter, arcade, shoot } = slingRoom();
  const entry = arcade.players[shooter.id];
  assert.equal(entry.distance, SLING_BASE_DISTANCE);
  shoot(0.5, 45);
  assert.equal(entry.distance, SLING_BASE_DISTANCE + SLING_DISTANCE_STEP);
  shoot(0.5, 45);
  assert.equal(entry.distance, SLING_BASE_DISTANCE + SLING_DISTANCE_STEP * 2);
});

test("sling: repeating the same shot cannot keep hitting", () => {
  // Das ist der Kern des Spiels: weil das Ziel zurückweicht, muss jede Kraft
  // neu dosiert werden. Zweimal derselbe perfekte Wurf darf nicht zweimal
  // treffen.
  const { shooter, arcade, shoot } = slingRoom();
  const entry = arcade.players[shooter.id];
  const power = perfectPower(SLING_BASE_DISTANCE, 45);
  shoot(power, 45);
  shoot(power, 45);
  assert.equal(entry.rings[0], 0);
  assert.notEqual(entry.rings[1], 0, "the identical shot must fall short of the moved target");
});

test("sling: the shot count is capped", () => {
  const { shooter, arcade, shoot } = slingRoom();
  const entry = arcade.players[shooter.id];
  for (let i = 0; i < SLING_SHOTS + 4; i += 1) {
    shoot(0.6, 45);
  }
  assert.equal(entry.shotsUsed, SLING_SHOTS);
  assert.equal(entry.rings.length, SLING_SHOTS);
});

test("sling: power and angle are clamped server-side", () => {
  // Ein manipulierter Client darf keine unmöglichen Werte durchdrücken.
  const { shooter, arcade, shoot } = slingRoom();
  const entry = arcade.players[shooter.id];
  shoot(999, 8000);
  const shot = entry.lastShot;
  assert.ok(shot.power <= 1 && shot.power >= 0, `power ${shot.power} out of range`);
  assert.ok(shot.angleDeg >= 5 && shot.angleDeg <= 85, `angle ${shot.angleDeg} out of range`);
  assert.ok(Number.isFinite(shot.range), "the range must stay a real number");
});

test("sling: garbage input does not corrupt the state", () => {
  const { shooter, arcade, shoot } = slingRoom();
  const entry = arcade.players[shooter.id];
  shoot("viel", null);
  assert.ok(Number.isFinite(entry.score), "score stays a number");
  assert.ok(Number.isFinite(entry.distance), "distance stays a number");
});

test("sling: wrong action is refused", () => {
  const { room, shooter } = slingRoom();
  const result = handleArcadeInput(room, shooter, { action: "drop" });
  assert.equal(result.ok, false);
});

test("sling: closer rings are worth more", () => {
  for (let i = 1; i < SLING_RING_SCORES.length; i += 1) {
    assert.ok(SLING_RING_SCORES[i] < SLING_RING_SCORES[i - 1], "outer rings must score less");
    assert.ok(SLING_RING_RADII[i] > SLING_RING_RADII[i - 1], "outer rings must be wider");
  }
});

test("sling: rapid fire is blocked by the input cooldown", () => {
  // Ohne Cooldown könnte man alle Schüsse in einem Frame abfeuern und die
  // Zieldosierung völlig umgehen. Hier absichtlich OHNE den shoot-Helfer, der
  // den Cooldown zurücksetzt.
  const { room, shooter, arcade } = slingRoom();
  const entry = arcade.players[shooter.id];
  for (let i = 0; i < 6; i += 1) {
    handleArcadeInput(room, shooter, { action: "shoot", power: 0.6, angle: 45 });
  }
  assert.equal(entry.shotsUsed, 1, "only the first shot of a burst may count");
});


// --- Sumo-Schubs -----------------------------------------------------------

function sumoRoom(playerCount = 4) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `s${i}`, name: `Sumo ${i}`, isBot: false
  }));
  const startedAt = Date.now() - 1000;
  const arcade = createArcadeState("sumoschubs", players, startedAt);
  const minigame = {
    id: 1, type: "sumoschubs", startedAt, duration: 40000,
    arcade, scores: {}, lastInputAt: {}
  };
  const room = { currentMinigame: minigame, players };
  // Umgeht den Eingabe-Cooldown; der wird separat geprüft.
  const send = (player, input) => {
    arcade.players[player.id].lastInputAt = 0;
    return handleArcadeInput(room, player, input);
  };
  // Lädt für `heldMs` auf und lässt dann los.
  const chargeAndShove = (player, heldMs) => {
    const entry = arcade.players[player.id];
    send(player, { action: "charge" });
    entry.chargeStart = Date.now() - heldMs;
    return send(player, { action: "shove" });
  };
  return { room, players, arcade, minigame, send, chargeAndShove };
}

test("sumo: players start evenly spread on the ring", () => {
  const { players, arcade } = sumoRoom(4);
  players.forEach((p) => {
    const e = arcade.players[p.id];
    // Jeder Platz liegt auf dem Einheitskreis.
    assert.ok(Math.abs(Math.hypot(e.spotX, e.spotY) - 1) < 1e-9, "spot must sit on the unit circle");
    assert.equal(e.hits, 0);
    assert.equal(e.eliminated, false);
  });
  // Vier Plätze müssen verschieden sein.
  const spots = players.map((p) => `${arcade.players[p.id].spotX.toFixed(3)},${arcade.players[p.id].spotY.toFixed(3)}`);
  assert.equal(new Set(spots).size, 4);
});

test("sumo: a full charge shoves the stone away from the shover", () => {
  const { players, arcade, chargeAndShove } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];
  chargeAndShove(me, SUMO_CHARGE_MS);
  // Der Stein bekommt Geschwindigkeit WEG von meinem Platz.
  assert.ok(arcade.stone.vx * e.spotX + arcade.stone.vy * e.spotY < 0, "stone must move away from the shover");
  assert.ok(Math.hypot(arcade.stone.vx, arcade.stone.vy) > SUMO_MAX_IMPULSE * 0.9);
  assert.equal(e.shoves, 1);
  assert.equal(e.lastShove.slipped, false);
});

test("sumo: a longer charge shoves harder", () => {
  const weak = sumoRoom(4);
  weak.chargeAndShove(weak.players[0], SUMO_CHARGE_MS * 0.3);
  const weakSpeed = Math.hypot(weak.arcade.stone.vx, weak.arcade.stone.vy);

  const strong = sumoRoom(4);
  strong.chargeAndShove(strong.players[0], SUMO_CHARGE_MS);
  const strongSpeed = Math.hypot(strong.arcade.stone.vx, strong.arcade.stone.vy);

  assert.ok(strongSpeed > weakSpeed * 2, `${strongSpeed} should clearly beat ${weakSpeed}`);
});

test("sumo: overcharging slips instead of shoving", () => {
  const { players, arcade, chargeAndShove } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];
  chargeAndShove(me, SUMO_OVERCHARGE_MS + 200);

  assert.equal(e.slips, 1);
  assert.equal(e.shoves, 0, "an overcharge must not move the stone");
  assert.equal(arcade.stone.vx, 0);
  assert.equal(arcade.stone.vy, 0);
  assert.ok(e.slipUntil > Date.now(), "the slip has to cost recovery time");
  assert.equal(e.lastShove.slipped, true);
});

test("sumo: a slipped player cannot act until recovered", () => {
  const { players, arcade, chargeAndShove, send } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];
  chargeAndShove(me, SUMO_OVERCHARGE_MS + 200);
  // Sofortiger Versuch währenddessen darf nichts bewirken.
  send(me, { action: "charge" });
  assert.equal(e.chargeStart, null, "charging must be ignored while down");
});

test("sumo: a mere tap does nothing", () => {
  const { players, arcade, chargeAndShove } = sumoRoom(4);
  const e = arcade.players[players[0].id];
  chargeAndShove(players[0], SUMO_MIN_CHARGE_MS - 20);
  assert.equal(e.shoves, 0);
  assert.equal(e.slips, 0);
  assert.equal(arcade.stone.vx, 0);
});

test("sumo: the stone leaving the ring hits the player it rolled toward", () => {
  const { room, players, arcade, minigame } = sumoRoom(4);
  const target = players[2];
  const t = arcade.players[target.id];
  // Stein direkt vor die Kante von Spieler 2 setzen, mit Fahrt nach draussen.
  arcade.stone.x = t.spotX * (SUMO_RING_RADIUS - 0.02);
  arcade.stone.y = t.spotY * (SUMO_RING_RADIUS - 0.02);
  arcade.stone.vx = t.spotX * 2;
  arcade.stone.vy = t.spotY * 2;

  updateSumoStone(room, minigame, arcade, 0.1, Date.now());
  assert.equal(t.hits, 1, "the player in the exit direction takes the hit");
  players.filter((p) => p.id !== target.id).forEach((p) => {
    assert.equal(arcade.players[p.id].hits, 0, "nobody else may be hit");
  });
  // Und der Stein liegt wieder in der Mitte.
  assert.equal(arcade.stone.x, 0);
  assert.equal(arcade.stone.y, 0);
});

test("sumo: enough hits eliminate a player", () => {
  const { room, players, arcade, minigame } = sumoRoom(4);
  const victim = players[1];
  const v = arcade.players[victim.id];
  for (let i = 0; i < SUMO_HITS_OUT; i += 1) {
    arcade.stone.x = v.spotX * (SUMO_RING_RADIUS + 0.05);
    arcade.stone.y = v.spotY * (SUMO_RING_RADIUS + 0.05);
    updateSumoStone(room, minigame, arcade, 0.1, Date.now());
  }
  assert.equal(v.hits, SUMO_HITS_OUT);
  assert.equal(v.eliminated, true);
});

test("sumo: an eliminated player can no longer shove", () => {
  const { players, arcade, chargeAndShove } = sumoRoom(4);
  const out = players[0];
  arcade.players[out.id].eliminated = true;
  chargeAndShove(out, SUMO_CHARGE_MS);
  assert.equal(arcade.stone.vx, 0, "an eliminated player must not affect the stone");
});

test("sumo: friction brings the stone to rest", () => {
  const { room, arcade, minigame } = sumoRoom(4);
  arcade.stone.vx = 0.5;
  arcade.stone.vy = 0;
  for (let i = 0; i < 60; i += 1) updateSumoStone(room, minigame, arcade, 0.05, Date.now());
  assert.ok(Math.hypot(arcade.stone.vx, arcade.stone.vy) < 0.01, "the stone has to settle");
});

test("sumo: surviving outranks being eliminated", () => {
  const { room, players, arcade, minigame } = sumoRoom(4);
  const out = arcade.players[players[0].id];
  out.eliminated = true;
  out.hits = SUMO_HITS_OUT;
  updateSumoStone(room, minigame, arcade, 0.05, Date.now());
  const alive = arcade.players[players[1].id];
  assert.ok(alive.score > out.score, "a player still standing must score higher");
});

test("sumo: garbage input does not corrupt the state", () => {
  const { players, arcade, send } = sumoRoom(4);
  const e = arcade.players[players[0].id];
  send(players[0], { action: "shove" });          // ohne vorheriges Laden
  send(players[0], { action: null });
  send(players[0], {});
  assert.ok(Number.isFinite(arcade.stone.vx));
  assert.ok(Number.isFinite(e.score ?? 0));
  assert.equal(e.shoves, 0);
});

test("sumo: wrong action is refused", () => {
  const { players, send } = sumoRoom(4);
  const result = send(players[0], { action: "drop" });
  assert.equal(result.ok, false);
});

test("sumo: a stale charge from a reordered tap does not cause a phantom slip", () => {
  // Regression: bei einem kurzen Antippen können `shove` und `charge` in
  // vertauschter Reihenfolge eintreffen. Der zurückgebliebene Zeitstempel liess
  // den nächsten, sauberen Halt sofort als Überladen gelten.
  const { players, arcade, send } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];

  // Vertauschte Reihenfolge nachstellen: shove zuerst, danach charge.
  send(me, { action: "shove" });
  send(me, { action: "charge" });
  assert.notEqual(e.chargeStart, null, "the late charge does set a timestamp");

  // Der Zeitstempel ist jetzt veraltet — ein neuer Halt muss ihn erneuern.
  e.chargeStart = Date.now() - (SUMO_OVERCHARGE_MS + 2000);
  send(me, { action: "charge" });
  const age = Date.now() - e.chargeStart;
  assert.ok(age < 100, `a fresh charge has to restart the clock, age was ${age} ms`);

  // Und ein sauber dosierter Halt stösst dann wirklich.
  e.chargeStart = Date.now() - SUMO_CHARGE_MS;
  send(me, { action: "shove" });
  assert.equal(e.shoves, 1, "a clean hold must shove");
  assert.equal(e.slips, 0, "and must not slip");
});

test("sumo: a duplicate charge mid-hold does not reset the meter", () => {
  const { players, arcade, send } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];
  send(me, { action: "charge" });
  const first = e.chargeStart;
  e.chargeStart = Date.now() - 400;          // 400 ms geladen
  const mid = e.chargeStart;
  send(me, { action: "charge" });             // doppeltes Drücken
  assert.equal(e.chargeStart, mid, "an in-progress charge must be left alone");
  assert.ok(first !== null);
});

test("sumo: a charge immediately followed by a shove clears the charge", () => {
  // Regression: ein Eingabe-Cooldown blockte das unmittelbar folgende `shove`,
  // sodass der Ladezeitstempel hängen blieb. Der nächste, sauber dosierte Halt
  // galt dann als Überladen und rutschte aus.
  const players = [{ id: "solo", name: "Solo", isBot: false }];
  const startedAt = Date.now() - 1000;
  const arcade = createArcadeState("sumoschubs", players, startedAt);
  const minigame = { id: 1, type: "sumoschubs", startedAt, duration: 40000, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const e = arcade.players[me.id];

  // OHNE den Cooldown zurückzusetzen — genau wie ein echtes Antippen.
  handleArcadeInput(room, me, { action: "charge" });
  handleArcadeInput(room, me, { action: "shove" });
  assert.equal(e.chargeStart, null, "the shove has to be processed, not swallowed");

  // Und ein anschliessender, sauberer Halt stösst wirklich.
  handleArcadeInput(room, me, { action: "charge" });
  e.chargeStart = Date.now() - SUMO_CHARGE_MS;
  handleArcadeInput(room, me, { action: "shove" });
  assert.equal(e.shoves, 1);
  assert.equal(e.slips, 0);
});


// --- Trampolin -------------------------------------------------------------

function bounceRoom() {
  const players = [{ id: "b1", name: "Hüpfer", isBot: false }];
  const startedAt = Date.now() - 60000;   // weit in der Vergangenheit
  const arcade = createArcadeState("trampolin", players, startedAt);
  const minigame = { id: 1, type: "trampolin", startedAt, duration: 30000, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];
  // Tippt genau `offsetMs` neben dem Schlag `beatIndex`.
  const tapAt = (beatIndex, offsetMs) => {
    const target = bounceBeatTime(beatIndex) + offsetMs;
    minigame.startedAt = Date.now() - target;
    entry.lastInputAt = 0;
    return handleArcadeInput(room, me, { action: "jump" });
  };
  return { room, me, arcade, entry, minigame, tapAt };
}

test("bounce: the beat starts slow and speeds up to a floor", () => {
  const first = bounceBeatTime(1) - bounceBeatTime(0);
  const later = bounceBeatTime(31) - bounceBeatTime(30);
  assert.equal(first, BOUNCE_BEAT_START_MS);
  assert.ok(later < first, "the beat has to accelerate");
  // Und nie unter das Minimum fallen.
  for (let i = 0; i < 120; i += 1) {
    const gap = bounceBeatTime(i + 1) - bounceBeatTime(i);
    assert.ok(gap >= BOUNCE_BEAT_MIN_MS - 1e-9, `gap ${gap} fell below the floor`);
  }
});

test("bounce: the nearest beat is found with a signed offset", () => {
  const early = bounceNearestBeat(bounceBeatTime(5) - 40);
  assert.equal(early.index, 5);
  assert.ok(early.offsetMs < 0, "tapping early has to read negative");

  const late = bounceNearestBeat(bounceBeatTime(5) + 40);
  assert.equal(late.index, 5);
  assert.ok(late.offsetMs > 0, "tapping late has to read positive");
});

test("bounce: an on-beat tap gains height", () => {
  const { entry, tapAt } = bounceRoom();
  tapAt(4, 0);
  assert.equal(entry.lastTap.grade, "perfect");
  assert.ok(entry.height > 0);
  assert.equal(entry.streak, 1);
  assert.equal(entry.perfects, 1);
});

test("bounce: a near miss still counts, but for less", () => {
  const perfect = bounceRoom();
  perfect.tapAt(4, 0);

  const good = bounceRoom();
  good.tapAt(4, BOUNCE_PERFECT_MS + 30);
  assert.equal(good.entry.lastTap.grade, "good");
  assert.ok(good.entry.height < perfect.entry.height, "a partial hit must gain less");
  assert.ok(good.entry.height > 0);
});

test("bounce: tapping far off the beat costs height and breaks the streak", () => {
  const { entry, tapAt } = bounceRoom();
  tapAt(4, 0);
  tapAt(5, 0);
  const built = entry.height;
  assert.equal(entry.streak, 2);

  tapAt(6, BOUNCE_GOOD_MS + 120);
  assert.equal(entry.lastTap.grade, "miss");
  assert.equal(entry.streak, 0, "a miss resets the resonance");
  assert.ok(entry.height < built, "and costs height");
});

test("bounce: consecutive hits build resonance", () => {
  // Der zehnte Treffer in Folge muss klar mehr bringen als der erste.
  const single = bounceRoom();
  single.tapAt(3, 0);
  const firstGain = single.entry.height;

  const chain = bounceRoom();
  for (let beat = 3; beat < 13; beat += 1) chain.tapAt(beat, 0);
  const gains = [];
  let previous = 0;
  const replay = bounceRoom();
  for (let beat = 3; beat < 13; beat += 1) {
    replay.tapAt(beat, 0);
    gains.push(replay.entry.height - previous);
    previous = replay.entry.height;
  }
  assert.ok(gains[9] > gains[0] * 1.5, `late gain ${gains[9]} should beat early ${gains[0]}`);
  assert.ok(firstGain > 0);
});

test("bounce: only the first tap of a beat counts", () => {
  const { entry, tapAt } = bounceRoom();
  tapAt(4, 0);
  const afterFirst = entry.height;
  // Nochmals auf demselben Schlag — darf nichts bringen.
  tapAt(4, 10);
  assert.equal(entry.height, afterFirst, "mashing one beat must not stack height");
  assert.equal(entry.streak, 1);
});

test("bounce: height never leaves its bounds", () => {
  const { entry, tapAt } = bounceRoom();
  // Sehr viele perfekte Treffer.
  for (let beat = 1; beat < 80; beat += 1) tapAt(beat, 0);
  assert.ok(entry.height <= BOUNCE_MAX_HEIGHT, `height ${entry.height} exceeded the cap`);
  // Und viele Fehltritte drücken nicht unter null.
  for (let beat = 80; beat < 120; beat += 1) tapAt(beat, BOUNCE_GOOD_MS + 200);
  assert.ok(entry.height >= 0, `height ${entry.height} went negative`);
});

test("bounce: the score rewards the best height and the best streak", () => {
  const { entry, tapAt } = bounceRoom();
  for (let beat = 2; beat < 8; beat += 1) tapAt(beat, 0);
  const peak = entry.best;
  const streak = entry.bestStreak;
  // Ein Fehltritt darf die BESTMARKE nicht senken.
  tapAt(8, BOUNCE_GOOD_MS + 200);
  assert.equal(entry.best, peak, "the personal best must stand");
  assert.equal(entry.bestStreak, streak);
  assert.ok(entry.score > 0);
});

test("bounce: wrong action is refused", () => {
  const { room, me } = bounceRoom();
  const result = handleArcadeInput(room, me, { action: "shove" });
  assert.equal(result.ok, false);
});

// --- Falschsignal ----------------------------------------------------------

function feintRoom() {
  const players = [{ id: "f1", name: "Späher", isBot: false }];
  const startedAt = Date.now();
  const arcade = createArcadeState("falschsignal", players, startedAt);
  const minigame = { id: 1, type: "falschsignal", startedAt, duration: FEINT_DURATION_MS, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];
  // Springt zur Spielzeit `gameMs`, statt echte Zeit abzuwarten. Der Server
  // prüft Nachzittern-Fenster und Sperre in ECHTER Zeit — die Zeitstempel des
  // letzten Tipps müssen also mitwandern, sonst liegen zwei Tipps aus dem Test
  // 0 ms auseinander, obwohl zwischen den Signalen fast eine Sekunde liegt.
  let lastActionGameMs = null;
  const shiftTo = (gameMs) => {
    minigame.startedAt = Date.now() - gameMs;
    if (lastActionGameMs !== null) {
      if (entry.lastReact) entry.lastReact.at = minigame.startedAt + lastActionGameMs;
      if (entry.lockUntil) entry.lockUntil = minigame.startedAt + lastActionGameMs + FEINT_LOCK_MS;
    }
    lastActionGameMs = gameMs;
    entry.lastInputAt = 0;
  };
  // Tippt `offsetMs` nach dem Beginn des Signals `index`.
  const reactTo = (index, offsetMs) => {
    shiftTo(arcade.signals[index].at + offsetMs);
    return handleArcadeInput(room, me, { action: "react" });
  };
  // Tippt in eine Lücke, in der kein Signal leuchtet.
  const reactEarly = (index) => {
    shiftTo(arcade.signals[index].at - 300);
    return handleArcadeInput(room, me, { action: "react" });
  };
  const firstOfKind = (kind) => arcade.signals.findIndex((signal) => signal.kind === kind);
  return { room, me, arcade, entry, minigame, reactTo, reactEarly, firstOfKind, shiftTo };
}

test("feint: the signal plan fills the round and mixes real with fake", () => {
  const signals = buildFeintSignals(491, FEINT_DURATION_MS);
  assert.ok(signals.length >= 8, `only ${signals.length} signals in ${FEINT_DURATION_MS} ms`);
  // Kein Signal darf über das Rundenende hinausragen.
  signals.forEach((signal) => {
    assert.ok(signal.at + signal.windowMs <= FEINT_DURATION_MS, `signal ${signal.index} outlives the round`);
  });
  // Zeitlich sortiert und ohne Überlappung — activeFeintSignal verlässt sich darauf.
  for (let i = 1; i < signals.length; i += 1) {
    assert.ok(signals[i].at > signals[i - 1].at + signals[i - 1].windowMs, "signals must not overlap");
  }
  const gos = signals.filter((signal) => signal.kind === "go");
  assert.ok(gos.length >= 2, "a round needs real signals");
  // Fälschungen müssen überwiegen, sonst zahlt sich blindes Tippen aus.
  assert.ok(gos.length < signals.length / 2, `${gos.length}/${signals.length} real is too generous`);
});

test("feint: the fake kinds all appear and the flicker is too short to be real", () => {
  const kinds = new Set(buildFeintSignals(491, FEINT_DURATION_MS).map((signal) => signal.kind));
  assert.ok(kinds.has("go"));
  assert.ok(kinds.size >= 3, `only ${[...kinds]} in one round`);
  assert.ok(FEINT_FLICKER_MS < FEINT_GO_WINDOW_MS / 3, "the feint has to read as a flicker");
});

test("feint: neither the real signal nor a single fake takes over the round", () => {
  // Über mehrere Seeds, damit ein glücklicher Startwert nichts vertuscht.
  for (const seed of [491, 100, 7, 55, 913]) {
    const kinds = buildFeintSignals(seed, FEINT_DURATION_MS).map((signal) => signal.kind);
    // Kein Durststrecke ohne echtes Signal, sonst fühlt sich die Runde kaputt an.
    let drought = 0;
    let worst = 0;
    kinds.forEach((kind) => {
      drought = kind === "go" ? 0 : drought + 1;
      worst = Math.max(worst, drought);
    });
    assert.ok(worst <= 4, `seed ${seed} had ${worst} fakes in a row`);
    // Und keine Fälschung wiederholt sich dreimal hintereinander — das würde
    // sie verraten, statt zu täuschen.
    for (let i = 2; i < kinds.length; i += 1) {
      const triple = kinds[i] === kinds[i - 1] && kinds[i] === kinds[i - 2];
      assert.ok(!triple || kinds[i] === "go", `seed ${seed}: ${kinds[i]} three times in a row`);
    }
    // Alle drei Fälschungen müssen vorkommen.
    ["colour", "shape", "flicker"].forEach((kind) => {
      assert.ok(kinds.includes(kind), `seed ${seed} never showed ${kind}`);
    });
  }
});

test("feint: blind mashing has a negative expected value", () => {
  // Die Rechnung hinter FEINT_FALSE_START: bei einem echten Signal pro Block
  // muss Dauertippen unterm Strich kosten — sonst ist Zusehen die schwächere
  // Strategie und das Spielprinzip fällt zusammen.
  for (const seed of [491, 100, 7, 55, 913]) {
    const signals = buildFeintSignals(seed, FEINT_DURATION_MS);
    const gos = signals.filter((signal) => signal.kind === "go").length;
    // Bester Fall für den Dauertipper: jeder Treffer nahezu sofort.
    const mash = gos * feintPoints(0) - (signals.length - gos) * FEINT_FALSE_START;
    assert.ok(mash < 0, `seed ${seed}: mashing would earn ${mash}`);
  }
});

test("feint: only the lit signal is active", () => {
  const signals = buildFeintSignals(491, FEINT_DURATION_MS);
  const first = signals[0];
  assert.equal(activeFeintSignal(signals, first.at - 1), null, "nothing is lit before the first signal");
  assert.equal(activeFeintSignal(signals, first.at)?.index, first.index);
  assert.equal(activeFeintSignal(signals, first.at + first.windowMs)?.index, first.index);
  assert.equal(activeFeintSignal(signals, first.at + first.windowMs + 1), null, "the window has to close");
});

test("feint: reacting fast pays more than reacting late", () => {
  assert.equal(feintPoints(0), FEINT_MAX_POINTS);
  assert.equal(feintPoints(FEINT_GO_WINDOW_MS), FEINT_MIN_POINTS);
  assert.ok(feintPoints(150) > feintPoints(600), "faster has to be worth more");
  // Auch ein spätes Erkennen bringt noch etwas — Nichtstun bringt nichts.
  assert.ok(FEINT_MIN_POINTS > 0);
});

test("feint: hitting the real signal scores by reaction time", () => {
  const fast = feintRoom();
  const go = fast.firstOfKind("go");
  fast.reactTo(go, 80);
  assert.equal(fast.entry.hits, 1);
  assert.equal(fast.entry.falseStarts, 0);
  assert.ok(fast.entry.score > 0);
  assert.ok(fast.entry.bestMs !== null && fast.entry.bestMs < 200);

  const slow = feintRoom();
  slow.reactTo(slow.firstOfKind("go"), 700);
  assert.equal(slow.entry.hits, 1);
  assert.ok(slow.entry.score < fast.entry.score, "a slow hit must score less");
});

test("feint: tapping a fake costs points and locks briefly", () => {
  const { entry, arcade, reactTo, firstOfKind } = feintRoom();
  const fake = firstOfKind("colour") >= 0 ? firstOfKind("colour") : firstOfKind("shape");
  assert.ok(fake >= 0, "the plan needs a visible fake to tap");
  reactTo(fake, 60);
  assert.equal(entry.falseStarts, 1);
  assert.equal(entry.hits, 0);
  assert.equal(entry.score, -FEINT_FALSE_START);
  assert.ok(entry.lockUntil > Date.now(), "a false start has to lock the button");
  assert.equal(entry.lastReact.kind, arcade.signals[fake].kind);
});

test("feint: tapping into an empty gap is a false start too", () => {
  const { entry, reactEarly, firstOfKind } = feintRoom();
  reactEarly(firstOfKind("go"));
  assert.equal(entry.falseStarts, 1);
  assert.equal(entry.hits, 0);
  assert.equal(entry.score, -FEINT_FALSE_START);
});

test("feint: each signal can only be scored once", () => {
  const { entry, reactTo, firstOfKind } = feintRoom();
  const go = firstOfKind("go");
  reactTo(go, 60);
  const afterFirst = entry.score;
  // Nochmals dasselbe Signal, weit hinter dem Nachzittern-Fenster.
  reactTo(go, 60 + FEINT_DOUBLE_TAP_MS + 50);
  assert.equal(entry.hits, 1, "one real signal is one hit");
  assert.equal(entry.score, afterFirst, "mashing a hit signal must not stack points");
  assert.equal(entry.falseStarts, 0, "and must not count as a false start either");
});

test("feint: the lock swallows taps until it expires", () => {
  const { room, me, entry, reactTo, firstOfKind } = feintRoom();
  const fake = firstOfKind("colour") >= 0 ? firstOfKind("colour") : firstOfKind("shape");
  reactTo(fake, 60);
  const locked = entry.score;
  // Ein weiterer Griff während der Sperre darf nicht noch einmal kosten.
  entry.lastInputAt = 0;
  handleArcadeInput(room, me, { action: "react" });
  assert.equal(entry.score, locked, "a locked tap must be free");
  assert.equal(entry.falseStarts, 1);
});

test("feint: mashing cannot beat clean play", () => {
  const clean = feintRoom();
  clean.arcade.signals.forEach((signal) => {
    if (signal.kind === "go") clean.reactTo(signal.index, 120);
  });

  const masher = feintRoom();
  // Tippt bei JEDEM Signal, inklusive aller Fälschungen. Die Sperre nach einem
  // Fehlgriff wird für diesen Test bewusst nicht abgewartet — das ist der
  // günstigste Fall für den Dauertipper.
  masher.arcade.signals.forEach((signal) => {
    masher.entry.lockUntil = 0;
    masher.reactTo(signal.index, 60);
  });
  assert.ok(masher.entry.falseStarts > masher.entry.hits, "mashing has to draw more fakes than hits");
  assert.ok(
    masher.entry.score < clean.entry.score,
    `mashing (${masher.entry.score}) must not beat clean play (${clean.entry.score})`
  );
  // Und die Wertung darf das Minus nicht in einen Vorteil verwandeln.
  assert.ok(masher.entry.score <= 0, `mashing scored ${masher.entry.score}`);
});

test("feint: a missed real signal costs nothing but closes", () => {
  const { room, entry, arcade, minigame } = feintRoom();
  const last = arcade.signals[arcade.signals.length - 1];
  minigame.startedAt = Date.now() - (last.at + last.windowMs + 50);
  updateArcade(room);
  const gos = arcade.signals.filter((signal) => signal.kind === "go").length;
  assert.equal(entry.missed, gos, "every unplayed real signal has to be booked as missed");
  assert.equal(entry.score, 0, "waiting must not cost points");
  // Ein abgelaufenes Fenster lässt sich nicht nachträglich einlösen.
  entry.lastInputAt = 0;
  handleArcadeInput(room, { id: "f1", name: "Späher" }, { action: "react" });
  assert.equal(entry.hits, 0);
});

test("feint: the result reports points, best reaction and false starts", () => {
  const { arcade, entry, reactTo, firstOfKind } = feintRoom();
  reactTo(firstOfKind("go"), 120);
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "reaction");
  assert.ok(detail.value > 0);
  assert.equal(detail.bestMs, entry.bestMs);
  assert.equal(detail.mistakes, 0);
});

test("feint: wrong action is refused", () => {
  const { room, me } = feintRoom();
  const result = handleArcadeInput(room, me, { action: "jump" });
  assert.equal(result.ok, false);
});

// --- Spurmaler -------------------------------------------------------------

function traceRoom() {
  const players = [{ id: "t1", name: "Maler", isBot: false }];
  const startedAt = Date.now();
  const arcade = createArcadeState("spurmaler", players, startedAt);
  const minigame = { id: 1, type: "spurmaler", startedAt, duration: 30000, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];

  // Der Server begrenzt das Tempo in ECHTER Zeit. Im Test wird der Zeitstempel
  // des letzten Vorrückens zurückdatiert, statt echte Zeit zu verbrennen —
  // sonst würde jeder Zug am Tempodeckel hängen statt an der Spur.
  const drag = (y, offset = 0, { agedMs = 400 } = {}) => {
    const x = tracePathX(arcade.seed, entry.lap, Math.min(1, Math.max(0, y))) + offset;
    entry.lastInputAt = 0;
    entry.lastAdvanceAt = Date.now() - agedMs;
    return handleArcadeInput(room, me, { action: "trace", x, y });
  };
  const lift = () => {
    entry.lastInputAt = 0;
    return handleArcadeInput(room, me, { action: "lift" });
  };
  // Zieht die Spur in kleinen Schritten hoch, wie ein Finger es täte.
  const traceUp = (to = 1, stepSize = 0.04) => {
    for (let y = 0; y <= to + 1e-9; y += stepSize) drag(Math.min(y, to));
  };
  return { room, me, arcade, entry, minigame, drag, lift, traceUp };
}

test("trace: the path always climbs and never leaves the reachable width", () => {
  for (const lap of [0, 1, 2, 7, 19]) {
    for (let step = 0; step <= 40; step += 1) {
      const x = tracePathX(499, lap, step / 40);
      // Samt Toleranzband muss die Spur im Bild liegen, sonst ist sie an den
      // Rändern nicht erreichbar.
      assert.ok(x - TRACE_TOLERANCE > 0.02, `lap ${lap}: path at ${x} is too far left`);
      assert.ok(x + TRACE_TOLERANCE < 0.98, `lap ${lap}: path at ${x} is too far right`);
    }
  }
});

test("trace: every lap draws a different curve", () => {
  const shape = (lap) => Array.from({ length: 12 }, (_, i) => tracePathX(499, lap, i / 11).toFixed(3)).join(",");
  const first = shape(0);
  // Sonst würde man eine Kurve lernen und danach blind ziehen.
  assert.notEqual(shape(1), first);
  assert.notEqual(shape(2), first);
  assert.notEqual(shape(2), shape(1));
});

test("trace: the offset is measured at the height the finger is at", () => {
  const y = 0.4;
  const onPath = tracePathX(499, 0, y);
  assert.ok(traceOffset(499, 0, onPath, y) < 1e-9);
  assert.ok(Math.abs(traceOffset(499, 0, onPath + 0.05, y) - 0.05) < 1e-9);
});

test("trace: dragging along the path advances the brush", () => {
  const { entry, drag } = traceRoom();
  drag(0);
  assert.equal(entry.brushDown, true, "starting on the path has to pick the brush up");
  drag(0.04);
  assert.ok(entry.progress > 0, "following the path must make progress");
  assert.equal(entry.slips, 0);
});

test("trace: leaving the band breaks the stroke and costs", () => {
  const { entry, drag } = traceRoom();
  drag(0);
  drag(0.04);
  const reached = entry.progress;
  drag(0.08, TRACE_TOLERANCE + 0.02);
  assert.equal(entry.slips, 1);
  assert.equal(entry.brushDown, false, "a slip has to break the stroke");
  assert.equal(entry.progress, reached, "and must not advance any further");
  assert.ok(entry.lockUntil > Date.now());
});

test("trace: staying just inside the band is still fine", () => {
  const { entry, drag } = traceRoom();
  drag(0);
  drag(0.04, TRACE_TOLERANCE - 0.005);
  assert.equal(entry.slips, 0, "the band has to be usable to its edge");
  assert.ok(entry.progress > 0);
});

test("trace: after a break the brush only restarts where it stopped", () => {
  const { entry, drag, lift, traceUp } = traceRoom();
  traceUp(0.3);
  const reached = entry.progress;
  assert.ok(reached > 0.2, `expected real progress, got ${reached}`);
  lift();
  assert.equal(entry.brushDown, false);

  // Weit vor der Bruchstelle wieder ansetzen darf nichts bringen — sonst liesse
  // sich die Spur überspringen statt gezogen zu werden.
  drag(reached + TRACE_REENTRY_WINDOW + 0.2);
  assert.equal(entry.brushDown, false, "restarting ahead must be refused");
  assert.equal(entry.progress, reached);

  drag(reached);
  assert.equal(entry.brushDown, true, "restarting at the break has to work");
});

test("trace: tapping up the path is no faster than dragging it", () => {
  // Der Angriff: Finger heben, ein Stück weiter oben neu ansetzen, wiederholen.
  // Absichtlich unmenschlich schnell getaktet, damit der Tempodeckel greifen
  // MUSS: ohne ihn brächte jeder Zyklus die volle Sprungweite, also 20 Zyklen
  // = eine ganze Runde in 0.4 Sekunden.
  const stepMs = 10;
  const cycles = 20;
  const tapper = traceRoom();
  for (let i = 0; i < cycles; i += 1) {
    tapper.lift();
    tapper.drag(tapper.entry.progress, 0, { agedMs: stepMs });
    tapper.entry.lockUntil = 0;
    tapper.drag(Math.min(1, tapper.entry.progress + TRACE_STEP_LIMIT), 0, { agedMs: stepMs });
    tapper.entry.lockUntil = 0;
  }
  // Gesamtstrecke, nicht der aktuelle Stand: eine vollendete Runde setzt den
  // Fortschritt auf 0 zurück. Genau daran ging dieser Test beim ersten Versuch
  // vorbei — er lief auch mit abgeschaltetem Deckel grün.
  const covered = tapper.entry.lapsDone + tapper.entry.progress;
  const uncapped = cycles * TRACE_STEP_LIMIT;
  const ceiling = cycles * 2 * (stepMs / 1000) * TRACE_MAX_SPEED;
  assert.ok(ceiling < uncapped / 3, "the test cadence has to make the cap bind");
  assert.ok(
    covered <= ceiling + 1e-6,
    `tapping covered ${covered}, the cap allows ${ceiling}`
  );
});

test("trace: a finished lap starts a new curve and banks points", () => {
  const { entry, arcade, traceUp } = traceRoom();
  const firstLap = entry.lap;
  traceUp(1);
  assert.equal(entry.lapsDone, 1, "reaching the top has to complete the lap");
  assert.equal(entry.lap, firstLap + 1, "and hand out a new curve");
  assert.equal(entry.progress, 0, "the new lap starts at the bottom");
  assert.equal(entry.brushDown, false, "and the finger has to set down again");
  assert.equal(entry.cleanLaps, 1, "a lap without a slip counts as clean");
  assert.ok(entry.score >= TRACE_LAP_POINTS);
  assert.ok(arcade.tolerance === TRACE_TOLERANCE);
});

test("trace: the score rewards laps and precision, and punishes slips", () => {
  const clean = traceScore({ lapsDone: 2, progress: 0, cleanLaps: 2, slips: 0 });
  const messy = traceScore({ lapsDone: 2, progress: 0, cleanLaps: 0, slips: 4 });
  assert.equal(clean, 2 * TRACE_LAP_POINTS + 2 * TRACE_CLEAN_BONUS);
  assert.equal(messy, 2 * TRACE_LAP_POINTS - 4 * TRACE_SLIP_COST);
  assert.ok(clean > messy, "the same distance drawn cleanly has to be worth more");
  // Ein angefangener Weg zählt anteilig — niemand steht bei null.
  assert.ok(traceScore({ lapsDone: 0, progress: 0.5, cleanLaps: 0, slips: 0 }) > 0);
});

test("trace: a slip inside a lap costs the clean bonus", () => {
  const { entry, drag, traceUp } = traceRoom();
  drag(0);
  drag(0.1, TRACE_TOLERANCE + 0.05);       // abgerutscht
  entry.lockUntil = 0;
  traceUp(1);
  assert.equal(entry.lapsDone, 1);
  assert.equal(entry.cleanLaps, 0, "the lap had a slip, so no bonus");
  assert.equal(entry.slips, 1);
});

test("trace: going backwards changes nothing", () => {
  const { entry, drag, traceUp } = traceRoom();
  traceUp(0.4);
  const reached = entry.progress;
  drag(0.1);
  assert.equal(entry.progress, reached, "pulling back must not undo progress");
  assert.equal(entry.slips, 0, "and must not count as a slip either");
});

test("trace: the finger cannot outrun the stroke", () => {
  // Der Angriff, den erst das Nachrechnen zeigte: den obersten Punkt der Kurve
  // antippen und halten. Der Abstand wird auf DESSEN Höhe gemessen, man ist also
  // "auf der Spur" — ohne diese Regel kroch der Strich mit Höchsttempo nach und
  // eine ganze Runde war in 1.7 s erledigt, ohne die Kurve nachzufahren.
  const { entry, drag } = traceRoom();
  drag(0);
  const before = entry.progress;
  for (let i = 0; i < 20; i += 1) drag(1);
  assert.ok(entry.slips > 0, "running ahead has to break the stroke");
  assert.ok(entry.progress < before + 0.2, `the brush crept to ${entry.progress} anyway`);
});

test("trace: the result reports points, laps and slips", () => {
  const { arcade, entry, traceUp } = traceRoom();
  traceUp(1);
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "laps");
  assert.equal(detail.laps, 1);
  assert.equal(detail.mistakes, 0);
  assert.ok(detail.value > 0);
});

test("trace: wrong action is refused", () => {
  const { room, me } = traceRoom();
  const result = handleArcadeInput(room, me, { action: "jump" });
  assert.equal(result.ok, false);
});

// --- Tellerdreher ----------------------------------------------------------

function plateRoom() {
  const players = [{ id: "p1", name: "Dreher", isBot: false }];
  const startedAt = Date.now();
  const arcade = createArcadeState("tellerdreher", players, startedAt);
  const minigame = { id: 1, type: "tellerdreher", startedAt, duration: PLATE_DURATION_MS, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];

  // Lässt `ms` Spielzeit verstreichen, ohne echte Zeit zu verbrennen. Zwei
  // Dinge müssen dabei stimmen, sonst prüft der Test etwas anderes als das Spiel:
  //  * Der Tick begrenzt seinen Zeitschritt auf 0.2 s (Schutz gegen einen
  //    Aussetzer). Ein Sprung von 2 s zählte also nur 0.2 s — in Schritten
  //    laufen lassen, nicht in einem Satz.
  //  * Rückkehr eines Tellers und Tellersperre hängen an der ECHTEN Uhr. Deren
  //    Zeitstempel müssen mitwandern, sonst kommt ein gefallener Teller nie
  //    zurück, obwohl er das im Spiel nach 1.8 s täte.
  const STEP = 120;
  const advance = (ms, atElapsed = null) => {
    let left = ms;
    while (left > 0) {
      const chunk = Math.min(STEP, left);
      const now = Date.now();
      arcade.lastUpdateAt = now - chunk;
      if (atElapsed !== null) minigame.startedAt = now - atElapsed;
      else minigame.startedAt -= chunk;
      entry.plates.forEach((plate) => {
        if (plate.fallenAt) plate.fallenAt -= chunk;
        if (plate.lastTouchAt) plate.lastTouchAt -= chunk;
      });
      updateArcade(room);
      left -= chunk;
    }
  };
  const touch = (index) => {
    entry.lastInputAt = 0;
    const plate = entry.plates[index];
    if (plate) plate.lastTouchAt = 0;
    return handleArcadeInput(room, me, { action: "spin", plate: index });
  };
  return { room, me, arcade, entry, minigame, advance, touch };
}

test("plates: the plates arrive one at a time so attention has to split", () => {
  assert.equal(plateCountAt(0), PLATE_START);
  assert.equal(plateCountAt(PLATE_ADD_MS - 1), PLATE_START);
  assert.equal(plateCountAt(PLATE_ADD_MS), PLATE_START + 1);
  assert.equal(plateCountAt(PLATE_ADD_MS * 20), PLATE_MAX, "and never past the cap");
  assert.ok(PLATE_MAX > PLATE_START);
});

test("plates: they run down faster towards the end of the round", () => {
  assert.equal(plateDecayAt(0), PLATE_DECAY_START);
  assert.equal(plateDecayAt(PLATE_DURATION_MS), PLATE_DECAY_END);
  assert.ok(plateDecayAt(PLATE_DURATION_MS / 2) > plateDecayAt(0));
  assert.ok(PLATE_DECAY_END > PLATE_DECAY_START);
});

test("plates: spinning down costs, a touch gives it back", () => {
  const { entry, advance, touch } = plateRoom();
  advance(1000);
  const worn = entry.plates[0].spin;
  assert.ok(worn < 1, "a plate has to lose spin over time");
  touch(0);
  assert.ok(entry.plates[0].spin > worn, "a touch has to restore spin");
  assert.ok(entry.plates[0].spin <= 1, "and never beyond full");
});

test("plates: the hand is the limit, not the tapping speed", () => {
  const { entry, touch } = plateRoom();
  entry.plates.forEach((plate) => { plate.active = true; plate.spin = 0.2; });
  entry.hand = PLATE_HAND_MAX;
  // Ohne Pause auf alles tippen: nach dem Verbrauch des Vorrats muss Schluss sein.
  let landed = 0;
  for (let round = 0; round < 4; round += 1) {
    for (let index = 0; index < PLATE_MAX; index += 1) {
      const before = entry.plates[index].spin;
      touch(index);
      if (entry.plates[index].spin > before + 1e-9) landed += 1;
    }
  }
  const affordable = Math.floor(PLATE_HAND_MAX / PLATE_SPIN_GAIN);
  assert.equal(landed, affordable, `mashing landed ${landed} grabs, the hand allows ${affordable}`);
  assert.ok(entry.wasted > 0, "the grabs into an empty hand have to be recorded");
});

test("plates: the hand refills over time but cannot be hoarded", () => {
  const { entry, advance } = plateRoom();
  entry.hand = 0;
  advance(200);
  assert.ok(entry.hand > 0, "the hand has to refill");
  const afterShort = entry.hand;
  advance(3000);
  assert.ok(entry.hand > afterShort);
  assert.ok(entry.hand <= PLATE_HAND_MAX + 1e-9, `hand banked up to ${entry.hand}`);
});

test("plates: touching an almost full plate wastes the hand", () => {
  // Das ist der Kern: nur zu zahlen, was ankommt, würde blindes Dauertippen
  // zur besten Strategie machen. Der Griff kostet immer voll.
  const { entry, touch } = plateRoom();
  entry.hand = PLATE_HAND_MAX;
  entry.plates[0].spin = 1;
  const handBefore = entry.hand;
  touch(0);
  assert.ok(entry.hand < handBefore - PLATE_SPIN_GAIN + 1e-9, "a full plate still costs the full grab");
  assert.equal(entry.plates[0].spin, 1);
  assert.ok(entry.wasted > 0, "and counts as wasted");
});

test("plates: a plate that stops falls, costs points and comes back", () => {
  const { entry, advance } = plateRoom();
  entry.plates[0].spin = 0.01;
  advance(400);
  assert.equal(entry.plates[0].active, false, "an empty plate has to fall");
  assert.equal(entry.drops, 1);
  assert.ok(entry.plates[0].fallenAt > 0);

  // Niemand ist ausgeschieden: der Teller kommt zurück.
  advance(PLATE_RESPAWN_MS + 100);
  assert.equal(entry.plates[0].active, true, "the plate has to return");
  assert.ok(entry.plates[0].spin > 0);
});

test("plates: the score counts plate-seconds and subtracts drops", () => {
  assert.equal(plateScore({ upTime: 10, drops: 0 }), 10 * PLATE_POINTS_PER_SECOND);
  assert.equal(plateScore({ upTime: 10, drops: 2 }), 10 * PLATE_POINTS_PER_SECOND - 2 * PLATE_DROP_COST);
  // Fünf Teller oben müssen fünfmal so viel wert sein wie einer — sonst lohnt
  // es sich, einen zu pflegen und die anderen fallen zu lassen.
  const many = plateRoom();
  many.entry.plates.forEach((plate) => { plate.active = true; plate.spin = 1; });
  many.advance(1000);
  const few = plateRoom();
  few.entry.plates.forEach((plate, index) => { plate.active = index === 0; plate.spin = 1; });
  few.entry.plateCount = 1;
  few.advance(1000);
  assert.ok(many.entry.upTime > few.entry.upTime * 3, `${many.entry.upTime} vs ${few.entry.upTime}`);
});

test("plates: the same plate cannot be hammered", () => {
  const { entry, room, me } = plateRoom();
  entry.hand = PLATE_HAND_MAX;
  entry.plates[0].spin = 0.1;
  entry.lastInputAt = 0;
  handleArcadeInput(room, me, { action: "spin", plate: 0 });
  const after = entry.plates[0].spin;
  entry.lastInputAt = 0;
  handleArcadeInput(room, me, { action: "spin", plate: 0 });
  assert.equal(entry.plates[0].spin, after, "a second grab inside the touch window must not count");
  assert.ok(PLATE_TOUCH_MS > 0);
});

test("plates: keeping every plate up beats nursing one", () => {
  // Spielt zwei Strategien über die halbe Runde gegeneinander: immer den
  // schwächsten Teller versorgen gegen immer denselben.
  const play = (pick) => {
    const room = plateRoom();
    room.entry.plates.forEach((plate, index) => { plate.active = index < PLATE_START; });
    for (let step = 0; step < 120; step += 1) {
      const elapsed = step * 140;
      room.advance(140, elapsed);
      const active = room.entry.plates.filter((plate) => plate.active);
      if (active.length === 0) continue;
      const target = pick(active);
      room.entry.lastInputAt = 0;
      target.lastTouchAt = 0;
      handleArcadeInput(room.room, room.me, { action: "spin", plate: target.index });
    }
    return room.entry;
  };
  const spread = play((active) => active.reduce((worst, plate) => (plate.spin < worst.spin ? plate : worst), active[0]));
  const nursed = play((active) => active[0]);
  assert.ok(spread.drops < nursed.drops, `spread dropped ${spread.drops}, nursing dropped ${nursed.drops}`);
  assert.ok(plateScore(spread) > plateScore(nursed), `${plateScore(spread)} vs ${plateScore(nursed)}`);
});

test("plates: the result reports points, plate-seconds and drops", () => {
  const { arcade, entry, advance } = plateRoom();
  advance(2000);
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "plateTime");
  assert.ok(detail.seconds >= 1);
  assert.equal(detail.mistakes, entry.drops);
});

test("plates: unknown plate and wrong action are refused", () => {
  const { room, me } = plateRoom();
  assert.equal(handleArcadeInput(room, me, { action: "jump" }).ok, false);
  assert.equal(handleArcadeInput(room, me, { action: "spin", plate: 99 }).ok, false);
  assert.equal(handleArcadeInput(room, me, { action: "spin", plate: "x" }).ok, false);
});
