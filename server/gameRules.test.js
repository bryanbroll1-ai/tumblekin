const test = require("node:test");
const assert = require("node:assert/strict");
const { testRules } = require("./server");

const {
  MINIGAMES,
  SEEK_SIZE,
  publicArcade,
  updatePlinko,
  PLINKO_BALL_R,

  arcadeRankingScore,
  beginMinigameFinale,
  arcadeResultDetail,
  bounceResultScore,
  createArcadeState: createArcadeStateRandom,
  createArenaState,
  handleArenaInput,
  updateBounceArena,
  ARENA_RADIUS,
  ARENA_BALL_RADIUS,
  ARENA_RESPAWN_MS,
  createRunnerCourse,
  dareBarrelAt,
  dareRestingDistance,
  darePoints,
  DARE_START_M,
  DARE_ROUNDS,
  DARE_ROLL_MS,
  DARE_LEAD_IN_MS,
  DARE_SHOW_MS,
  runnerSegmentAt,
  runnerLaneFactor,
  advanceColorRound,
  handleArcadeInput,
  updateArcade,
  roomCreateBlockedReason,
  MAX_ROOMS_PER_ADDRESS,
  GLIDE_DURATION_MS,
  DIVE_DURATION_MS,
  humansInRoom,
  DIVE_MAX_DEPTH,
  DIVE_RISK_MAX,
  diveGain,
  diveRisk,
  diveRiskAt,
  diveStepValue,
  diveBestDepth,
  GLIDE_VY_MAX,
  GLIDE_STALL_MS,
  BOUNCE_BEAT_START_MS,
  BOUNCE_BEAT_MIN_MS,
  BOUNCE_PERFECT_MS,
  BOUNCE_GOOD_MS,
  BOUNCE_MISS_PENALTY,
  BOUNCE_MAX_HEIGHT,
  BOUNCE_BAR_BEATS,
  BOUNCE_TEMPOS,
  bounceBeatTime,
  bounceNearestBeat,
  FEINT_DURATION_MS,
  FEINT_GROW_MS,
  FEINT_FAKE_LIMITS,
  feintRadius,
  FEINT_MAX_POINTS,
  FEINT_MIN_POINTS,
  FEINT_FALSE_START,
  FEINT_LOCK_MS,
  FEINT_DOUBLE_TAP_MS,
  buildFeintSignals,
  activeFeintSignal,
  feintPoints,
  TRACE_TOLERANCE,
  TRACE_NARROW_MIN,
  TRACE_GEMS_PER_LAP,
  TRACE_GEM_POINTS,
  TRACE_GEM_REACH,
  traceWidthAt,
  traceToleranceAt,
  buildTraceGems,
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
  BELT_COLOURS,
  BELT_CHUTES,
  BELT_QUEUE,
  BELT_SPEED_START,
  BELT_SPEED_END,
  BELT_REACH_AT,
  BELT_SWAP_FIRST_MS,
  BELT_SWAP_WARN_MS,
  BELT_POINTS,
  BELT_STREAK_BONUS,
  BELT_STREAK_MAX,
  BELT_WRONG_COST,
  BELT_MISS_COST,
  BELT_DURATION_MS,
  beltSpeed,
  buildBeltChutePlan,
  FISH_DURATION_MS,
  FISH_REEL_SPEED,
  FISH_SLIP_SPEED,
  FISH_TENSION_CALM,
  FISH_TENSION_SURGE,
  FISH_RELAX,
  FISH_HOLD_GRACE_MS,
  FISH_SNAP_PAUSE_MS,
  FISH_SNAP_COST,
  FISH_LANDED_POINTS,
  FISH_SNAP_SHARE,
  FISH_SPECIES,
  fishSpeciesFor,
  FISH_LEAD_IN_MS,
  buildFishPhases,
  fishSurging,
  fishScore,
  PAINT_COLS,
  PAINT_ROWS,
  PAINT_SPEED,
  PAINT_BRUSH,
  PAINT_BRUSH_WIDE,
  PAINT_BOMB_RADIUS,
  PAINT_ENCLOSE_MAX,
  PAINT_ROLLER_AHEAD,
  PAINT_TURN_RATE,
  PAINT_BOOST_MS,
  PAINT_PICKUP_MAX,
  PAINT_DURATION_MS,
  paintIndex,
  paintSweep,
  paintPockets,
  paintOwnedCount,
  RUNNER_ATTACK_RANGE,
  RUNNER_ATTACKS_PER_RACE
} = testRules;

// Im Spiel wird der Startwert jeder Runde gewürfelt. Die Tests halten ihn je
// Spieltyp fest — sonst hinge ein Fehlschlag am Zufall und liesse sich nicht
// nachstellen. Wer ausdrücklich einen anderen will, gibt ihn mit.
function createArcadeState(type, players, startedAt, options = {}) {
  return createArcadeStateRandom(type, players, startedAt, { seed: testRules.ARCADE_CONFIGS[type]?.seed, ...options });
}

function player(overrides = {}) {
  return { ...overrides };
}

// Die Regel, die sich sonst über 22 Familien einzeln wieder auflöst: JEDES
// Minispiel zeigt am Ende genau EINE Zahl, und zwar die, nach der auch sortiert
// wird. Vorher standen dort bis zu fünf Angaben nebeneinander, und die
// auffälligste war nicht immer die, die über die Platzierung entschied.
test("every game reports exactly one number in its result", () => {
  const players = [{ id: "a", name: "A", isBot: false }, { id: "b", name: "B", isBot: false }];
  // Nebenangaben, die KEINE zweite Zahl sind, sondern zur ersten gehören.
  const allowed = new Set(["kind", "label", "value", "total", "survived"]);
  MINIGAMES.filter((game) => game.arcadeFamily).forEach((game) => {
    const arcade = createArcadeState(game.type, players, Date.now());
    const detail = arcadeResultDetail(arcade, arcade.players.a);
    assert.ok(detail, `${game.type} liefert gar kein Ergebnis`);
    assert.ok(detail.kind, `${game.type} hat keine Ergebnisart`);
    Object.keys(detail).forEach((key) => {
      assert.ok(allowed.has(key), `${game.type} zeigt eine zweite Zahl: ${key}`);
    });
  });
});

// Regression: `minigame.arena` wird für JEDES Minispiel als leeres Objekt
// angelegt, und ein leeres Objekt ist wahr. Die Prüfung `if (minigame.arena)`
// liess deshalb bei jedem Arcade-Spiel eine Ausnahme fliegen, bevor die Plätze
// verschickt wurden — die Schlussreaktion kam im echten Spiel nie an.
test("the finale ranks everyone without tripping over the empty arena slot", () => {
  const players = [
    { id: "a", name: "A", isBot: false },
    { id: "b", name: "B", isBot: false }
  ];
  const arcade = createArcadeState("sortierband", players, Date.now());
  arcade.players.a.score = 500;
  arcade.players.b.score = 100;
  const minigame = {
    id: 1, type: "sortierband", startedAt: Date.now(), duration: 30000,
    arcade, scores: {}, lastInputAt: {},
    // Genau wie beim echten Spielstart: leere Platzhalter für die anderen Modi.
    arena: {}, flux: {}, canopy: {}
  };
  const room = { code: "TEST", players, currentMinigame: minigame };
  beginMinigameFinale(room, minigame);
  assert.ok(minigame.finaleAt, "das Finale muss starten");
  assert.deepEqual(minigame.arcade.places, { a: 1, b: 2 });
});

test("catalog contains only the 3D challenges", () => {
  // Die Liste wird SORTIERT verglichen, damit ein neues Spiel nicht an einer
  // beliebigen Stelle eingefügt werden kann, ohne dass es auffällt.
  assert.deepEqual(
    MINIGAMES.map((game) => game.type).sort(),
    [
      "angelduell", "augenmass", "ballonPump", "ballonfahrt", "bergsteiger", "blitzreflex",
      "blobklopfe", "bounceArena", "colorEscape", "eisstock", "falschsignal",
      "farbenjagd", "fassmut", "fassrolle", "finishRush", "kanonenflug", "leuchtfolge",
      "lichtwaechter", "messerwurf", "muenzregen", "nagelbrett", "nervenprobe",
      "seilspringen", "sortierband", "spuersinn", "spurmaler", "tiefenrausch",
      "trampolin", "turmbau", "zuendstoff"
    ]
  );
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

test("bumper: a hard ram costs a life, the rival springs back — the last life is final", () => {
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
  assert.equal(vic.lives, 2, "ein Sturz kostet ein Leben");

  // Noch im Wasser: kein Zurück vor der Pause.
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);
  assert.equal(vic.inPlay, false, "direkt nach dem Sturz ist man noch im Becken");

  // Nach der Pause springt man zurück — innen und kurz unverwundbar.
  vic.outUntil = Date.now() - 1;
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);
  assert.equal(vic.inPlay, true, "mit Leben übrig geht es zurück auf die Insel");
  assert.ok(Math.hypot(vic.x, vic.y) < arena.radius * 0.5, "zurück nach innen, nicht an den Rand");
  assert.ok(vic.invulnUntil > Date.now(), "und kurz geschützt, damit niemand am Einstieg wartet");

  // Der letzte Sturz ist endgültig.
  vic.lives = 1;
  vic.invulnUntil = 0;
  vic.ejecting = true;
  vic.x = arena.radius + ARENA_BALL_RADIUS + 0.05;
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);
  assert.equal(vic.lives, 0);
  vic.outUntil = Date.now() - 1;
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);
  assert.equal(vic.inPlay, false, "ohne Leben kommt niemand zurück");
});

test("bumper: in the last fifteen seconds the island shrinks", () => {
  const one = player({ id: "s1", name: "S1", color: "#f00" });
  const two = player({ id: "s2", name: "S2", color: "#00f" });
  const duration = 45000;
  const startedAt = Date.now() - 10000;
  const arena = createArenaState([one, two], startedAt, duration);
  const minigame = { type: "bounceArena", arena, scores: {}, startedAt, duration, lastInputAt: {}, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);
  assert.equal(arena.radius, ARENA_RADIUS, "vorher bleibt die Insel ganz");
  // Kurz vor Schluss: deutlich kleiner, aber nicht weg.
  arena.shrinkFrom = Date.now() - 14000;
  arena.shrinkUntil = Date.now() + 1000;
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);
  assert.ok(arena.radius < ARENA_RADIUS * 0.7 && arena.radius > ARENA_RADIUS * 0.5, `Radius ${arena.radius}`);
  assert.equal(arena.shrinking, true);
  // Wer ausserhalb steht, wird zurückgeschoben, nicht hinausgeworfen.
  Object.values(arena.players).forEach((ap) => {
    assert.ok(Math.hypot(ap.x, ap.y) <= arena.radius, "niemand fällt, nur weil die Insel kleiner wird");
  });
});

test("bumper: deciding the round starts a finale window instead of an abrupt cut", () => {
  const one = player({ id: "one", name: "One", color: "#f00" });
  const two = player({ id: "two", name: "Two", color: "#00f" });
  const startedAt = Date.now() - 3000;
  const arena = createArenaState([one, two], startedAt);
  const minigame = { type: "bounceArena", arena, scores: {}, startedAt, duration: 18000, lastInputAt: {}, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };

  // Two is already off the plate with no lives left → the round is decided.
  arena.players[two.id].inPlay = false;
  arena.players[two.id].lives = 0;
  arena.lastUpdateAt = Date.now() - 90;
  updateBounceArena(room);

  assert.ok(minigame.finaleAt, "a finale window is scheduled");
  assert.ok(minigame.finaleAt > Date.now(), "the scoreboard waits for the finale to play out");
  assert.ok(!minigame.finishing, "the round is not finished during the finale");
});

test("bumper: lives rank first, then knockouts, then time on the island", () => {
  const survivor = bounceResultScore({ lives: 1, knockouts: 0, inPlay: true, playMs: 9000 });
  const eliminated = bounceResultScore({ lives: 0, knockouts: 3, inPlay: false, playMs: 40000 });
  assert.ok(survivor > eliminated, "wer noch Leben hat, steht vor jedem, der raus ist");
  const moreLives = bounceResultScore({ lives: 3, knockouts: 0, playMs: 1000 });
  const fewerLives = bounceResultScore({ lives: 2, knockouts: 5, playMs: 45000 });
  assert.ok(moreLives > fewerLives, "Leben zählen vor Rauswürfen");
  const hitter = bounceResultScore({ lives: 2, knockouts: 2, playMs: 1000 });
  const passive = bounceResultScore({ lives: 2, knockouts: 1, playMs: 45000 });
  assert.ok(hitter > passive, "bei gleichen Leben zählen die Rauswürfe");
  assert.equal(bounceResultScore(null), 0);
});

test("bumper: a bot too far out heads back to the middle instead of chasing", () => {
  // Im Ergebnis zählt Überleben weit mehr als Abschüsse. Ein Bot, der bis an den
  // Rand jagt, verliert deshalb — genau darum ging es einmal andersherum aus:
  // die vorsichtigste Einstellung gewann 49 % der Partien, die angriffslustigste
  // nur 9 %.
  const hunter = player({ id: "ah", name: "AH", color: "#f00" });
  const prey = player({ id: "ap", name: "AP", color: "#00f" });
  const startedAt = Date.now() - 3000;
  const arena = createArenaState([hunter, prey], startedAt);
  const me = arena.players[hunter.id];
  const target = arena.players[prey.id];

  // Der Jäger steht schon weit draussen, die Beute weiter aussen in derselben
  // Richtung — der Reiz, weiter zu jagen, ist also maximal.
  me.arenaProfile = { edge: 0.68, aggro: 1, picks: true };
  me.x = ARENA_RADIUS * 0.85;
  me.y = 0;
  me.invulnUntil = 0;
  target.x = ARENA_RADIUS * 0.95;
  target.y = 0;
  target.invulnUntil = 0;

  testRules.arenaBotStep(arena, hunter.id);

  // Schub muss zur Mitte zeigen, also entgegen der eigenen Auslenkung.
  assert.ok(me.thrustX < 0, `Schub muss nach innen zeigen, war ${me.thrustX}`);
});

test("runner course: jede Bahnlage ist fahrbar, Hürden stehen nie im Sand", () => {
  const segments = createRunnerCourse(367);
  assert.ok(segments.length > 8);
  segments.forEach((segment) => {
    // Genau eine Hürde je Abschnitt, und höchstens eine.
    assert.ok(segment.hurdle === null || [0, 1, 2].includes(segment.hurdle));
    // Es gibt IMMER eine Bahn ohne Hürde — sonst wäre der Abschnitt eine
    // Zufallsstrafe statt einer Entscheidung.
    const frei = [0, 1, 2].filter((lane) => segment.hurdle !== lane);
    assert.ok(frei.length >= 2, "mindestens zwei Bahnen ohne Hürde");
    // Eine Hürde im Sand träfe niemanden: dort steht ohnehin keiner freiwillig.
    if (segment.hurdle !== null) {
      assert.notEqual(segment.lanes[segment.hurdle], "sand", "keine Hürde im Sand");
    }
    // Beläge sind bekannt.
    segment.lanes.forEach((belag) => {
      assert.ok(["sand", "normal", "tempo"].includes(belag), `unbekannter Belag ${belag}`);
    });
  });
});

test("runner: die Tempobahn wandert, sie steht nie zweimal hintereinander gleich", () => {
  const segments = createRunnerCourse(367).filter((segment) => segment.lanes.includes("tempo"));
  assert.ok(segments.length > 6);
  for (let i = 1; i < segments.length; i += 1) {
    const vorher = segments[i - 1].lanes.indexOf("tempo");
    const jetzt = segments[i].lanes.indexOf("tempo");
    assert.notEqual(jetzt, vorher, `Abschnitt ${i}: Tempobahn blieb auf ${jetzt}`);
  }
});

test("runner: Belagfaktor kommt aus dem Abschnitt unter der Figur", () => {
  const arcade = { segments: createRunnerCourse(367) };
  const segment = runnerSegmentAt(arcade, 40);
  assert.ok(segment, "es gibt einen Abschnitt bei 40 Metern");
  const tempoLane = segment.lanes.indexOf("tempo");
  if (tempoLane >= 0) {
    assert.ok(runnerLaneFactor(arcade, 40, tempoLane) > 1.2, "Tempobahn ist schneller");
  }
  const sandLane = segment.lanes.indexOf("sand");
  if (sandLane >= 0) {
    assert.ok(runnerLaneFactor(arcade, 40, sandLane) < 0.8, "Sandbahn ist langsamer");
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
  assert.ok(targetTiles >= 6, "die erste Runde lässt genug sichere Felder");

  const minigame = { arcade, scores: {}, startedAt, duration: 31000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];

  const safeIndex = arcade.grid.findIndex((color) => color === arcade.targetColor);
  entry.gx = safeIndex % 6;
  entry.gy = Math.floor(safeIndex / 6);

  minigame.startedAt = Date.now() - (arcade.schedule[0].dropAt + 150);
  updateArcade(room);
  assert.equal(entry.survived, 1, "wer richtig steht, übersteht die Runde");
  assert.equal(entry.eliminated, false);
});

test("color escape never lets two players share a tile", () => {
  const one = player({ id: "one", name: "One", color: "#f00" });
  const two = player({ id: "two", name: "Two", color: "#00f" });
  const startedAt = Date.now();
  const arcade = createArcadeState("colorEscape", [one, two], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 31000, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };
  const a = arcade.players[one.id];
  const b = arcade.players[two.id];

  a.gx = 2; a.gy = 2;
  b.gx = 3; b.gy = 2;
  a.lastInputAt = 0;
  assert.deepEqual(handleArcadeInput(room, one, { action: "step", dir: "right" }), { ok: true });
  assert.equal(a.gx, 2, "step onto an occupied tile bounces off");
  assert.equal(a.gy, 2);

  a.lastInputAt = 0;
  handleArcadeInput(room, one, { action: "step", dir: "left" });
  assert.equal(a.gx, 1, "free tiles are steppable");
});

test("color escape drops a player standing on the wrong color", () => {
  const runner = player({ id: "cf", name: "CF", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("colorEscape", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 31000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];

  const wrongIndex = arcade.grid.findIndex((color) => color !== arcade.targetColor);
  entry.gx = wrongIndex % 6;
  entry.gy = Math.floor(wrongIndex / 6);

  minigame.startedAt = Date.now() - (arcade.schedule[0].dropAt + 150);
  updateArcade(room);
  assert.equal(entry.eliminated, true, "wer falsch steht, fällt");
  assert.equal(entry.fallenRound, 0);
  assert.equal(entry.survived, 0, "a fallen player scores no round");
});

test("color escape: laufen die ganze Ansage lang, gesperrt nur im Fall, die nächste Ansage direkt danach", () => {
  const { colorGridPhaseAt } = testRules;
  const runner = player({ id: "cp", name: "CP", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("colorEscape", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 31000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];
  const [first, second] = arcade.schedule;

  // Die Zielfarbe steht ab dem ersten Moment fest, laufen geht sofort.
  assert.equal(colorGridPhaseAt(arcade, 0).name, "announce");
  entry.gx = 2; entry.gy = 2; entry.lastInputAt = 0;
  minigame.startedAt = Date.now() - 50;
  handleArcadeInput(room, runner, { action: "step", dir: "right" });
  assert.equal(entry.gx, 3, "gleich zu Beginn der Ansage darf man laufen");

  // Kurz vor dem Fall noch.
  entry.lastInputAt = 0;
  minigame.startedAt = Date.now() - (first.dropAt - 60);
  handleArcadeInput(room, runner, { action: "step", dir: "right" });
  assert.equal(entry.gx, 4, "bis zum Fall darf man laufen");

  // Im Fall nicht.
  entry.lastInputAt = 0;
  minigame.startedAt = Date.now() - (first.dropAt + 200);
  handleArcadeInput(room, runner, { action: "step", dir: "left" });
  assert.equal(entry.gx, 4, "im Fall ist man festgenagelt");

  // Direkt danach beginnt die nächste Ansage.
  assert.equal(second.start, first.end, "keine tote Zeit zwischen Fall und nächster Ansage");
  assert.equal(colorGridPhaseAt(arcade, second.start + 10).name, "announce");
  assert.equal(colorGridPhaseAt(arcade, second.start + 10).round, 1);
});

test("color escape: spätere Runden warnen kürzer und haben weniger sichere Felder", () => {
  const runner = player({ id: "cg", name: "CG", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("colorEscape", [runner], startedAt);

  const measure = (round) => {
    advanceColorRound(arcade, round, startedAt);
    return {
      warn: arcade.schedule[round].dropAt - arcade.schedule[round].start,
      safe: arcade.grid.filter((color) => color === arcade.targetColor).length
    };
  };
  const first = measure(0);
  const last = measure(arcade.roundCount - 1);
  assert.ok(last.warn < first.warn * 0.6, `die Vorwarnung muss deutlich kürzer werden (${last.warn} von ${first.warn})`);
  assert.ok(last.safe < first.safe, `es müssen weniger sichere Felder werden (${last.safe} von ${first.safe})`);
  assert.ok(last.safe >= 2, "ein, zwei Felder bleiben immer");
  assert.ok(last.warn >= 1500, "aber die kürzeste Ansage lässt noch ein paar Schritte zu");
  const end = arcade.schedule[arcade.roundCount - 1].end;
  assert.ok(end <= 31000, `alle Runden passen in die Spielzeit (${end} ms)`);
});

test("Platzierung: Gleichstand teilt sich den Platz", () => {
  // Jede Szene reagiert auf den Platz — 1. jubelt, 4. ist geknickt. Zwei exakt
  // gleich gute Läufe dürfen darum nicht künstlich getrennt werden.
  const players = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const points = { a: 10, b: 30, c: 30, d: 5 };
  const places = testRules.rankPlaces(players, (player) => points[player.id]);

  assert.equal(places.b, 1);
  assert.equal(places.c, 1, "gleicher Punktestand, gleicher Platz");
  assert.equal(places.a, 3, "nach zwei geteilten Ersten folgt Platz 3, nicht 2");
  assert.equal(places.d, 4);
});

test("lichtwaechter: every red is announced by a visible turn, and running stays allowed in it", () => {
  const sprinter = player({ id: "rl", name: "RL", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("lichtwaechter", [sprinter], startedAt);
  // Jede Rotphase hat direkt davor eine Drehung — nie springt es ohne Warnung um.
  arcade.phases.forEach((phase, index) => {
    if (phase.kind === "red") assert.equal(arcade.phases[index - 1].kind, "turn", `Rot bei ${phase.from} ohne Drehung davor`);
  });
  assert.equal(arcade.phases[0].kind, "green");
  // Die Drehung wird im Lauf der Runde kürzer, bleibt aber menschlich.
  const turns = arcade.phases.filter((phase) => phase.kind === "turn");
  assert.ok(turns[0].until - turns[0].from > turns[turns.length - 1].until - turns[turns.length - 1].from);
  turns.forEach((turn) => assert.ok(turn.until - turn.from >= 300, "eine Drehung muss sichtbar sein"));
  // Finten gibt es, aber nicht gleich zu Beginn.
  assert.ok(arcade.phases.some((phase) => phase.kind === "feint"), "ohne Finte ist das Loslassen reines Mitzählen");
  assert.ok(arcade.phases.slice(0, 4).every((phase) => phase.kind !== "feint"));
});

test("lichtwaechter: holding on red costs ground and a moment, letting go in the turn is safe", () => {
  const sprinter = player({ id: "rl", name: "RL", color: "#fff" });
  const careful = player({ id: "rc", name: "RC", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("lichtwaechter", [sprinter, careful], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 32000, finishing: false };
  const room = { currentMinigame: minigame, players: [sprinter, careful] };
  const greedy = arcade.players[sprinter.id];
  const calm = arcade.players[careful.id];
  const [green, turn, red] = arcade.phases;
  assert.deepEqual([green.kind, turn.kind, red.kind], ["green", "turn", "red"]);

  // Beide laufen bei Grün.
  const greenNow = startedAt + Math.floor((green.from + green.until) / 2);
  [sprinter, careful].forEach((p) => {
    arcade.players[p.id].lastInputAt = 0;
    handleArcadeInput(room, p, { action: "run" });
    arcade.players[p.id].lastRunAt = greenNow;
  });
  testRules.updateRedlight(room, minigame, arcade, 0.1, greenNow);
  assert.ok(greedy.progress > 0 && calm.progress > 0, "Grün lässt laufen");

  // In der Drehung laufen beide noch.
  const turnNow = startedAt + turn.from + 50;
  greedy.lastRunAt = turnNow;
  calm.lastRunAt = turnNow;
  const beforeTurn = calm.progress;
  testRules.updateRedlight(room, minigame, arcade, 0.1, turnNow);
  assert.ok(calm.progress > beforeTurn, "in der Drehung darf man noch laufen");

  // Der Vorsichtige lässt los, der Gierige hält weiter bis ins Rot.
  greedy.progress = 12;
  calm.lastInputAt = 0;
  handleArcadeInput(room, careful, { action: "run", hold: false });
  const redNow = startedAt + red.from + 400;
  greedy.lastRunAt = redNow;
  const held = greedy.progress;
  testRules.updateRedlight(room, minigame, arcade, 0.1, redNow);
  assert.equal(greedy.caught, 1, "bei Rot gehalten heisst erwischt");
  assert.ok(greedy.progress < held && greedy.progress > 0, "ein Stück zurück, nicht auf Null");
  assert.ok(greedy.stunUntil > redNow, "und kurz benommen");
  assert.equal(calm.caught, 0, "wer in der Drehung losgelassen hat, ist sicher");

  // Dieselbe Rotphase straft nur einmal.
  greedy.lastRunAt = redNow + 100;
  testRules.updateRedlight(room, minigame, arcade, 0.1, redNow + 100);
  assert.equal(greedy.caught, 1);

  // Benommen läuft man auch bei Grün nicht los.
  const next = arcade.phases[3];
  greedy.stunUntil = startedAt + next.from + 5000;
  const stunned = greedy.progress;
  greedy.lastRunAt = startedAt + next.from + 100;
  testRules.updateRedlight(room, minigame, arcade, 0.1, startedAt + next.from + 100);
  assert.equal(greedy.progress, stunned);
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
  entry.holding = true;
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

test("zielgerade: Springen und Angreifen funktionieren", () => {
  const runner = player({ id: "rn", name: "RN", color: "#fff" });
  const rival = player({ id: "rv", name: "RV", color: "#000" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [runner, rival], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner, rival] };

  // Jump action sets jumpUntil timestamp
  assert.deepEqual(handleArcadeInput(room, runner, { action: "jump" }), { ok: true });
  assert.ok(arcade.players[runner.id].jumpUntil > Date.now());

  // Reset input cooldown for test
  arcade.players[runner.id].lastInputAt = 0;

  // Der Angriff geht nach vorne in die EIGENE Bahn und hat eine Reichweite.
  // Beides ist nicht kosmetisch: ohne das traf er immer den Fuehrenden, egal wo
  // der lief, und weil alle gleich oft angreifen, stellte das die Rangfolge auf
  // den Kopf (gemessen easy 2.23, hard 2.80).
  const laeufer = arcade.players[runner.id];
  const gegner = arcade.players[rival.id];
  laeufer.progress = 10;
  laeufer.lane = 1;
  gegner.lane = 1;

  // Zu weit weg: nichts passiert.
  gegner.progress = 10 + RUNNER_ATTACK_RANGE + 5;
  assert.deepEqual(handleArcadeInput(room, runner, { action: "attack" }), { ok: true });
  assert.ok(!(gegner.stumbleUntil > Date.now()), "ausser Reichweite trifft nicht");
  // Ein Fehlgriff kostet trotzdem einen Angriff — sonst waere Dauerdruecken
  // gratis, und genau daran ist die Rangfolge vorher gekippt.
  assert.equal(laeufer.attacksLeft, RUNNER_ATTACKS_PER_RACE - 1, "auch ein Fehlgriff kostet");
  laeufer.attacksLeft = RUNNER_ATTACKS_PER_RACE;

  // Andere Bahn: nichts passiert.
  laeufer.lastAttackAt = 0;
  laeufer.lastInputAt = 0;
  laeufer.attacksLeft = RUNNER_ATTACKS_PER_RACE;
  gegner.progress = 14;
  gegner.lane = 2;
  assert.deepEqual(handleArcadeInput(room, runner, { action: "attack" }), { ok: true });
  assert.ok(!(gegner.stumbleUntil > Date.now()), "eine andere Bahn trifft nicht");

  // Gleiche Bahn, in Reichweite: trifft.
  laeufer.lastAttackAt = 0;
  laeufer.lastInputAt = 0;
  laeufer.attacksLeft = RUNNER_ATTACKS_PER_RACE;
  gegner.lane = 1;
  assert.deepEqual(handleArcadeInput(room, runner, { action: "attack" }), { ok: true });
  assert.ok(gegner.stumbleUntil > Date.now(), "gleiche Bahn in Reichweite trifft");

  // Wer springt, wird verfehlt.
  gegner.stumbleUntil = 0;
  gegner.jumpUntil = Date.now() + 500;
  laeufer.lastAttackAt = 0;
  laeufer.lastInputAt = 0;
  laeufer.attacksLeft = RUNNER_ATTACKS_PER_RACE;
  assert.deepEqual(handleArcadeInput(room, runner, { action: "attack" }), { ok: true });
  assert.ok(!(gegner.stumbleUntil > Date.now()), "ein Sprung weicht dem Angriff aus");
});

test("zielgerade: Angriffe sind begrenzt", () => {
  // Der Angriff muss eine Entscheidung sein. Gemessen: ohne Angriffe trennen
  // sich die Spielstaerken um eine halbe Sekunde Zielzeit, mit Dauerfeuer kamen
  // vier Sekunden Stolper-Rauschen dazu und die Rangfolge war weg.
  const runner = player({ id: "ra", name: "RA", color: "#fff" });
  const rival = player({ id: "rb", name: "RB", color: "#000" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [runner, rival], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner, rival] };
  const laeufer = arcade.players[runner.id];
  const gegner = arcade.players[rival.id];
  laeufer.lane = 1;
  gegner.lane = 1;
  laeufer.progress = 10;
  gegner.progress = 14;

  assert.equal(laeufer.attacksLeft, RUNNER_ATTACKS_PER_RACE, "man startet mit vollem Vorrat");
  for (let i = 0; i < RUNNER_ATTACKS_PER_RACE; i += 1) {
    laeufer.lastAttackAt = 0;
    laeufer.lastInputAt = 0;
    assert.deepEqual(handleArcadeInput(room, runner, { action: "attack" }), { ok: true });
  }
  assert.equal(laeufer.attacksLeft, 0);
  laeufer.lastAttackAt = 0;
  laeufer.lastInputAt = 0;
  const leer = handleArcadeInput(room, runner, { action: "attack" });
  assert.equal(leer.ok, false, "ohne Vorrat geht nichts mehr");
});

test("zielgerade: Huerde stolpert den Läufer wenn er nicht springt", () => {
  const runner = player({ id: "rh", name: "RH", color: "#fff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };

  const mitHuerde = arcade.segments.find((segment) => segment.hurdle !== null);
  assert.ok(mitHuerde, "der Kurs enthaelt Huerden");

  entry = arcade.players[runner.id];
  entry.lane = mitHuerde.hurdle;
  entry.progress = mitHuerde.hurdleAt - 0.4;
  entry.nextHurdle = mitHuerde.index;
  arcade.lastUpdateAt = Date.now() - 300;
  testRules.updateArcade(room);

  assert.ok(entry.stumbleUntil > Date.now(), "die Huerde muss stolpern lassen");
  assert.equal(entry.stumbles, 1);
});

test("zielgerade: dieselbe Huerde zaehlt nur einmal", () => {
  const runner = player({ id: "r1", name: "R1", color: "#fff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [runner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner] };
  const entry = arcade.players[runner.id];
  const mitHuerde = arcade.segments.find((segment) => segment.hurdle !== null);
  entry.lane = mitHuerde.hurdle;
  entry.progress = mitHuerde.hurdleAt - 0.2;
  entry.nextHurdle = mitHuerde.index;
  for (let i = 0; i < 5; i += 1) {
    arcade.lastUpdateAt = Date.now() - 100;
    testRules.updateArcade(room);
  }
  assert.equal(entry.stumbles, 1, "eine Huerde, ein Stolperer");
});

function dareRoom(players = [{ id: "fa", name: "FA", isBot: false }]) {
  const startedAt = Date.now();
  const arcade = createArcadeState("fassmut", players, startedAt);
  const minigame = { id: 1, type: "fassmut", startedAt, duration: 60000, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];
  // Die Zeit wird gefaelscht, indem startedAt zurueckgeschoben wird — der
  // Server rechnet `elapsed` daraus.
  const bei = (ms) => {
    minigame.startedAt = Date.now() - ms;
    testRules.updateArcade(room);
  };
  // In Runde `r` zum Zeitpunkt `t` (Sekunden nach Rollbeginn) bremsen.
  const bremse = (r, t) => {
    minigame.startedAt = Date.now() - (arcade.leadIn + r * (DARE_ROLL_MS + DARE_SHOW_MS) + t * 1000);
    entry.lastInputAt = 0;
    return handleArcadeInput(room, me, { action: "brake" });
  };
  const rundeAb = (r) => arcade.leadIn + r * (DARE_ROLL_MS + DARE_SHOW_MS);
  return { room, me, arcade, entry, minigame, bei, bremse, rundeAb };
}

test("fassmut: ein einziger Versuch, losgelassen wird nicht immer gleich", () => {
  assert.equal(DARE_ROUNDS, 1, "ein Fass, ein Versuch");
  const leads = new Set();
  for (let i = 0; i < 6; i += 1) {
    const { arcade } = dareRoom([{ id: `fl${i}`, name: "FL", isBot: false }]);
    assert.ok(arcade.leadIn >= DARE_LEAD_IN_MS, "nie früher als der Mindestvorlauf");
    leads.add(Math.round(arcade.leadIn / 50));
    // Warten, damit der Zeitstempel im Seed sich ändert.
    const until = Date.now() + 3;
    while (Date.now() < until) { /* kurz */ }
  }
  assert.ok(leads.size > 1, "der Moment des Loslassens ändert sich");
});

test("fassmut: das Punktefenster ist breit genug zum Spielen", () => {
  // Gemessen statt geglaubt: wie lange dauert die Phase, in der ein Stopp
  // ueberhaupt Punkte bringt? Beim ersten Satz Zahlen waren es 250 ms, und
  // davor lagen zwei Sekunden ohne jeden Wert.
  let ersterPunkt = null;
  let letzterSicher = null;
  for (let t = 0; t <= DARE_ROLL_MS / 1000; t += 0.01) {
    const ruhe = dareRestingDistance(t);
    if (ruhe <= 0) break;
    if (ersterPunkt === null && darePoints(ruhe) > 0) ersterPunkt = t;
    letzterSicher = t;
  }
  assert.ok(ersterPunkt !== null, "irgendwann muss es Punkte geben");
  const fenster = letzterSicher - ersterPunkt;
  assert.ok(fenster > 1.2, `das Punktefenster ist zu schmal: ${fenster.toFixed(2)} s`);
  // Und wer gar nichts tut, muss ueberrollt werden — Abwarten darf nie die
  // sichere Wahl sein.
  assert.ok(letzterSicher < DARE_ROLL_MS / 1000 - 0.5,
    "das Fass muss die Linie innerhalb der Rollzeit erreichen");

  // Die Zahl, an der das Spiel wirklich haengt: um wie viele Meter verschiebt
  // sich der Ruhepunkt, wenn man 100 ms zu spaet tippt? Beim ersten Satz Zahlen
  // waren das 1.33 m — mehr, als zwischen „perfekt" und „gut" ueberhaupt liegt.
  // Ein Spiel, in dem der Bremsweg schneller waechst als die Hand reagieren
  // kann, misst kein Timing mehr, sondern Glueck.
  const kurzVorSchluss = letzterSicher - 0.1;
  const proZehntel = dareRestingDistance(kurzVorSchluss) - dareRestingDistance(letzterSicher);
  assert.ok(proZehntel < 0.8,
    `100 ms zu spaet kosten ${proZehntel.toFixed(2)} m — das ist nicht mehr spielbar`);
});

test("fassmut: der Bremsweg waechst mit dem Quadrat des Tempos", () => {
  // Das IST das Spiel. Spaeter bremsen heisst schneller sein, und der
  // Bremsweg waechst dann ueberproportional — sonst waere immer-spaet-bremsen
  // die einzige richtige Antwort und es gaebe nichts zu entscheiden.
  const frueh = DARE_START_M - dareRestingDistance(0.5);
  const mittel = DARE_START_M - dareRestingDistance(1.0);
  const spaet = DARE_START_M - dareRestingDistance(1.5);
  assert.ok(mittel > frueh && spaet > mittel, "spaeter bremsen laeuft weiter");
  // Ueberproportional: der Zuwachs von 1.0 auf 1.5 muss groesser sein als der
  // von 0.5 auf 1.0.
  assert.ok(spaet - mittel > mittel - frueh,
    `der Zuwachs muss wachsen (${spaet - mittel} gegen ${mittel - frueh})`);
});

test("fassmut: dicht an der Linie bringt deutlich mehr als weit weg", () => {
  assert.ok(darePoints(0.1) > darePoints(3.0) * 1.5, "dicht dran muss sich lohnen");
  assert.ok(darePoints(1.0) > darePoints(3.0), "naeher ist immer besser");
  assert.equal(darePoints(12), 0, "weit daneben gibt nichts");
  assert.equal(darePoints(0), 0, "auf der Linie selbst ist ueberrollt");
});

test("fassmut: das Fass rollt an und wird nach dem Tap langsamer", () => {
  const frei = dareBarrelAt(1.2, null);
  const gebremst = dareBarrelAt(1.2, 0.6);
  assert.ok(gebremst.distance > frei.distance, "gebremst kommt es weniger weit");
  assert.ok(gebremst.speed < frei.speed, "und es ist langsamer");
  // Lange nach dem Tap steht es still.
  const steht = dareBarrelAt(9, 0.6);
  assert.equal(steht.speed, 0);
  assert.ok(Math.abs(steht.distance - Math.max(0, dareRestingDistance(0.6))) < 1e-6,
    "der Standort muss zur geschlossenen Formel passen");
});

test("fassmut: wer bremst, bekommt Punkte; wer nicht bremst, wird ueberrollt", () => {
  const gut = dareRoom([{ id: "d1", name: "D1", isBot: false }]);
  gut.bei(0);                     // Vorlauf
  gut.bremse(0, 2.2);
  assert.notEqual(gut.entry.brakeAt, null, "der Tap muss ankommen");
  // Bis in die Auswertungsphase der ersten Runde laufen.
  gut.bei(gut.rundeAb(0) + DARE_ROLL_MS + 200);
  assert.equal(gut.entry.results.length, 1, "die Runde muss abgerechnet sein");
  assert.equal(gut.entry.results[0].hit, false);
  assert.ok(gut.entry.points > 0, "ein sauberer Stopp bringt Punkte");

  const faul = dareRoom([{ id: "d2", name: "D2", isBot: false }]);
  faul.bei(0);
  faul.bei(faul.rundeAb(0) + DARE_ROLL_MS + 200);
  assert.equal(faul.entry.results[0].hit, true, "Nichtstun heisst ueberrollt");
  assert.equal(faul.entry.points, 0);
});

test("fassmut: zu spaet gebremst heisst ueberrollt", () => {
  const { entry, bei, bremse, rundeAb } = dareRoom();
  bei(0);
  // So spaet, dass der Bremsweg laenger ist als der Rest der Strecke.
  bremse(0, DARE_ROLL_MS / 1000 - 0.1);
  bei(rundeAb(0) + DARE_ROLL_MS + 200);
  assert.equal(entry.results[0].hit, true, "zu spaet muss ueberrollen");
  assert.equal(entry.results[0].points, 0);
});

test("fassmut: jeder Durchgang wird genau einmal abgerechnet", () => {
  const { entry, bei, bremse, rundeAb } = dareRoom();
  bei(0);
  for (let r = 0; r < DARE_ROUNDS; r += 1) {
    bremse(r, 1.2);
    // Mehrfach in der Auswertungsphase ticken — die Punkte duerfen sich
    // dadurch nicht vervielfachen.
    bei(rundeAb(r) + DARE_ROLL_MS + 100);
    bei(rundeAb(r) + DARE_ROLL_MS + 400);
    bei(rundeAb(r) + DARE_ROLL_MS + 900);
  }
  assert.equal(entry.results.length, DARE_ROUNDS,
    `es muss genau ${DARE_ROUNDS} Ergebnisse geben, waren ${entry.results.length}`);
  const summe = entry.results.reduce((acc, r) => acc + r.points, 0);
  assert.equal(entry.points, summe, "die Gesamtpunkte sind die Summe der Durchgaenge");
});

test("fassmut: ein zweiter Tap im selben Durchgang aendert nichts", () => {
  const { entry, bei, bremse } = dareRoom();
  bei(0);
  bremse(0, 0.8);
  const ersterTap = entry.brakeAt;
  bremse(0, 1.6);
  assert.equal(entry.brakeAt, ersterTap, "der erste Tap zaehlt");
});

test("fassmut: mehr Punkte gewinnen, bei Gleichstand der dichteste Treffer", () => {
  const arcade = createArcadeState("fassmut", [player({ id: "dz", name: "DZ", color: "#fff" })], Date.now());
  assert.ok(arcadeRankingScore(arcade, { points: 500, best: 1.0 })
    > arcadeRankingScore(arcade, { points: 300, best: 0.1 }));
  assert.ok(arcadeRankingScore(arcade, { points: 500, best: 0.1 })
    > arcadeRankingScore(arcade, { points: 500, best: 1.2 }));
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
    const drift = b.offset + (arcade.barrelVel || testRules.barrelPhaseAt(arcade, t).vel) * 0.3;
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

test("fassrolle: wer läuft, dreht den Stamm auch unter den anderen", () => {
  const runner = player({ id: "br", name: "BR", color: "#fff" });
  const stander = player({ id: "bt", name: "BT", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("fassrolle", [runner, stander], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 32000, finishing: false };
  const room = { currentMinigame: minigame, players: [runner, stander] };
  const a = arcade.players[runner.id];
  // In der ruhigen Anfangsphase: nur der Läufer bewegt den Stamm.
  for (let t = 0; t < 1200; t += 50) {
    a.lastRunAt = startedAt + t;
    a.runDir = 1;
    a.offset = 0;
    testRules.updateBarrel(room, minigame, arcade, 0.05, startedAt + t);
  }
  assert.ok(arcade.barrelVel < -0.4, `nach rechts laufen dreht den Stamm nach links (${arcade.barrelVel})`);
  assert.ok(arcade.players[stander.id].offset < -0.2, "wer stehen bleibt, wird mitgenommen");
});

test("fassrolle: among survivors the steadier balance ranks higher", () => {
  // Zwei halten sich beide oben, aber unterschiedlich sauber. Ohne eine Wertung
  // der Ruhe bekämen beide exakt dieselbe Punktzahl (die verstrichene Zeit) und
  // die Partie ginge unentschieden aus.
  const steady = player({ id: "bs", name: "BS", color: "#fff" });
  const wobbly = player({ id: "bw", name: "BW", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("fassrolle", [steady, wobbly], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 32000, finishing: false };
  const room = { currentMinigame: minigame, players: [steady, wobbly] };
  const a = arcade.players[steady.id];
  const b = arcade.players[wobbly.id];

  // Beide Lagen werden vor jedem Schritt festgehalten: geprüft wird die WERTUNG,
  // nicht ein Regelkreis. (Ein enges Totband wäre dafür übrigens untauglich —
  // Gegenhalten ist eine feste Übergeschwindigkeit, wer zu früh gegensteuert,
  // schiesst über die Mitte hinaus und pendelt.)
  for (let t = 0; t < 8000; t += 50) {
    a.offset = 0;
    b.offset = arcade.limit * 0.8;
    testRules.updateBarrel(room, minigame, arcade, 0.05, startedAt + t);
  }

  assert.equal(a.fallenAt, null, "die Mitte darf nicht als Sturz gelten");
  assert.ok(
    a.balanceWork > b.balanceWork * 2,
    `Mitte muss deutlich mehr Ruhe sammeln (${a.balanceWork} gegen ${b.balanceWork})`
  );
  assert.ok(
    arcadeRankingScore(arcade, a) > arcadeRankingScore(arcade, b),
    "unter Überlebenden entscheidet die ruhigere Balance"
  );
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

test("muenzregen: eine Serie hebt den Wert, eine Bombe setzt ihn zurück", () => {
  const { catchMultiplier } = testRules;
  assert.equal(catchMultiplier(0), 1);
  assert.equal(catchMultiplier(4), 1);
  assert.equal(catchMultiplier(5), 2);
  assert.equal(catchMultiplier(10), 3);
  assert.equal(catchMultiplier(40), 3, "höchstens dreifach");

  const catcher = player({ id: "cs", name: "CS", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("muenzregen", [catcher], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 30500, finishing: false };
  const room = { currentMinigame: minigame, players: [catcher] };
  const entry = arcade.players[catcher.id];
  // Eine künstliche Folge: sechs Münzen, dann eine Bombe, alle in Spur 1.
  arcade.drops = [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, catchAt: i * 100, lane: 1, kind: "coin", processed: false }))
    .concat([{ id: 7, catchAt: 700, lane: 1, kind: "bomb", processed: false }]);
  entry.lane = 1;
  minigame.startedAt = Date.now() - 650;
  testRules.updateArcade(room);
  assert.equal(entry.catches, 4 + 2 * 2, "vier einfach, ab der fünften doppelt");
  minigame.startedAt = Date.now() - 750;
  testRules.updateArcade(room);
  assert.equal(entry.multiplier, 1, "die Bombe setzt die Serie zurück");
});

test("muenzregen: zum Schluss Goldrausch und eine Schatztruhe", () => {
  const catcher = player({ id: "cj", name: "CJ", color: "#fff" });
  const arcade = createArcadeState("muenzregen", [catcher], Date.now());
  const gold = arcade.drops.filter((drop) => drop.kind === "gold");
  assert.ok(gold.length > 5, "im Goldrausch fallen Goldmünzen");
  assert.ok(gold.every((drop) => drop.catchAt >= arcade.goldFrom), "erst am Ende");
  const jackpot = arcade.drops.filter((drop) => drop.kind === "jackpot");
  assert.equal(jackpot.length, 1, "genau eine Truhe");
  assert.equal(jackpot[0].catchAt, testRules.CATCH_JACKPOT_AT);
  assert.ok(arcade.drops.every((drop) => drop === jackpot[0] || drop.catchAt < jackpot[0].catchAt), "sie ist das Letzte");
  // Der Regen wird dichter.
  const early = arcade.drops.filter((drop) => drop.catchAt < 8000).length;
  const late = arcade.drops.filter((drop) => drop.catchAt >= arcade.goldFrom && drop.catchAt < arcade.goldFrom + 6000).length;
  assert.ok(late > early, `am Ende mehr als am Anfang (${late} gegen ${early})`);
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
  // Nur die Münze offen lassen — die Tropfen werden je Spiel neu gemischt.
  arcade.drops.forEach((drop) => { drop.processed = drop !== coin; });
  minigame.startedAt = Date.now() - coin.catchAt - 10;
  testRules.updateArcade(room);
  assert.equal(entry.catches, 1, "coin in own lane is caught");

  // Nur die Bombe stehen lassen. Ohne das springt die Uhr bis zu ihrem
  // Zeitpunkt und arbeitet ALLE Tropfen dazwischen in einem Tick ab — die
  // Zahlen danach sagen dann nichts mehr ueber die Bombe aus.
  arcade.drops.forEach((drop) => { drop.processed = true; });
  entry.lane = bomb.lane;
  minigame.startedAt = Date.now() - bomb.catchAt - 10;
  bomb.processed = false;
  testRules.updateArcade(room);
  assert.equal(entry.bombs, 1, "bomb in own lane hits");
  // Eine Bombe kostet eine Muenze, und zwar an der Muenzzahl selbst — das ist
  // dieselbe Zahl, die angezeigt und nach der gewertet wird. Frueher lief der
  // Abzug daran vorbei: angezeigt wurden die gefangenen Muenzen, gewertet
  // Muenzen minus Bomben, und wer 32 fing und zwei Bomben frass, stand hinter
  // jemandem mit 31 — auf dem Ergebnisbild sah es umgekehrt aus.
  assert.equal(entry.catches, 0, "die Bombe kostet die gefangene Muenze");
  assert.ok(
    arcadeRankingScore(arcade, { catches: 5 }) > arcadeRankingScore(arcade, { catches: 3 })
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

test("blobklopfe: wer einen Stachelblob trifft, ist kurz benommen", () => {
  const { WHACK_STUN_MS } = testRules;
  const whacker = player({ id: "wa3", name: "WA3", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("blobklopfe", [whacker], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 25000, finishing: false };
  const room = { currentMinigame: minigame, players: [whacker] };
  const entry = arcade.players[whacker.id];

  const bad = arcade.pops.find((pop) => pop.kind === "bad");
  minigame.startedAt = Date.now() - bad.from - 50;
  entry.lastInputAt = 0;
  handleArcadeInput(room, whacker, { action: "whack", cell: bad.cell });
  assert.ok(entry.stunUntil > Date.now(), "nach dem Stachel benommen");
  assert.ok(entry.stunUntil - Date.now() <= WHACK_STUN_MS);

  // Ein guter Blob, der genau jetzt oben ist, zählt während der Sperre nicht.
  const good = arcade.pops.find((pop) => pop.kind === "good" && pop.cell !== bad.cell);
  minigame.startedAt = Date.now() - good.from - 50;
  entry.lastInputAt = 0;
  handleArcadeInput(room, whacker, { action: "whack", cell: good.cell });
  assert.equal(entry.hits, 0, "benommen trifft man nichts");

  // Nach der Sperre wieder.
  entry.stunUntil = Date.now() - 1;
  entry.lastInputAt = 0;
  handleArcadeInput(room, whacker, { action: "whack", cell: good.cell });
  assert.equal(entry.hits, 1, "danach zählt es wieder");
});

test("kanonenflug: erster Tipp Kraft, zweiter Winkel, Punkte für die Nähe zur Flagge", () => {
  const { cannonDistance, cannonPoints } = testRules;
  const gunner = player({ id: "ka", name: "KA", color: "#fff" });
  const startedAt = Date.now() - 575;
  const arcade = createArcadeState("kanonenflug", [gunner], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 16000, finishing: false };
  const room = { currentMinigame: minigame, players: [gunner] };
  const entry = arcade.players[gunner.id];
  assert.ok(arcade.target >= 42 && arcade.target <= 90, "die Flagge steht im Feld");
  assert.ok(Math.abs(arcade.wind) <= 1, "Wind höchstens voll");

  // Halbe Periode = volle Kraft (Dreieck, nicht Sinus).
  handleArcadeInput(room, gunner, { action: "launch" });
  assert.equal(entry.launchedAt, null, "der erste Tipp legt nur die Kraft fest");
  assert.ok(entry.power > 0.95, `volle Kraft zur Hälfte der Periode (${entry.power})`);

  entry.powerAt = Date.now() - Math.round(arcade.anglePeriodMs / 4);
  entry.lastInputAt = 0;
  handleArcadeInput(room, gunner, { action: "launch" });
  assert.ok(entry.launchedAt, "der zweite Tipp schiesst");
  assert.ok(Math.abs(entry.angle - 45) <= 2, `ein Viertel der Periode ist 45° (${entry.angle})`);
  assert.ok(Math.abs(entry.distance - cannonDistance(entry.power, entry.angle, arcade.wind)) < 0.11);
  assert.equal(entry.points, cannonPoints(entry.distance, arcade.target));

  const first = entry.distance;
  entry.lastInputAt = 0;
  handleArcadeInput(room, gunner, { action: "launch" });
  assert.equal(entry.distance, first, "ein Schuss je Spiel");
});

test("kanonenflug: nicht mehr immer 45° und volle Kraft", () => {
  const { cannonDistance, cannonPoints, cannonTri } = testRules;
  // Die Kraft verweilt nicht am Maximum: 10 % der Periode neben der Spitze
  // sind deutlich schwächer (beim Sinus waren es 95 %).
  assert.ok(cannonTri(0.4) < 0.85, "die Kraftanzeige verweilt nicht oben");
  // Bei einer nahen Flagge schiesst volle Kraft auf 45° weit darüber hinaus.
  const target = 55;
  assert.ok(cannonPoints(cannonDistance(1, 45, 0), target) === 0, "volle Kraft auf 45° verfehlt eine nahe Flagge");
  // Es gibt eine Kombination, die trifft.
  let bestOff = Infinity;
  for (let deg = 10; deg <= 80; deg += 0.5) bestOff = Math.min(bestOff, Math.abs(cannonDistance(1, deg, 0) - target));
  assert.ok(bestOff < 1, "mit flacherem Winkel ist die Flagge erreichbar");
  // Näher ist besser, ein Volltreffer gibt Zugabe.
  assert.ok(cannonPoints(target + 1, target) > cannonPoints(target + 6, target));
  assert.ok(cannonPoints(target, target) > 100, "Volltreffer mit Zugabe");
  // Rückenwind trägt weiter.
  assert.ok(cannonDistance(1, 45, 1) > cannonDistance(1, 45, 0));
  assert.ok(cannonDistance(1, 45, -1) < cannonDistance(1, 45, 0));
});

function knifeRoom() {
  const one = player({ id: "ka", name: "KA", color: "#fff" });
  const startedAt = Date.now() - 2000;
  const arcade = createArcadeState("messerwurf", [one], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 40000, finishing: false };
  const room = { currentMinigame: minigame, players: [one] };
  return { one, arcade, minigame, room, entry: arcade.players[one.id] };
}

test("messerwurf: jeder hat seinen eigenen Stamm, freie Würfe stecken", () => {
  const { one, room, entry } = knifeRoom();
  assert.equal(entry.stage, 0);
  assert.equal(entry.knivesLeft, testRules.KNIFE_STAGES[0].knives);
  // Den Stamm künstlich stillstehen lassen: dann landet jedes Messer an
  // derselben Stelle — das erste steckt, das zweite trifft das erste.
  entry.spin = { kind: "steady", speed: 0 };
  entry.apples = [];
  handleArcadeInput(room, one, { action: "throw" });
  assert.equal(entry.stuck, 1, "das erste Messer steckt");
  assert.equal(entry.points, 1);
  entry.lastThrowAt = 0;
  entry.lastInputAt = 0;
  handleArcadeInput(room, one, { action: "throw" });
  assert.equal(entry.clashes, 1, "dieselbe Stelle ist ein Treffer auf ein Messer");
  assert.equal(entry.knivesLeft, 0, "der Stamm ist verloren");
  assert.ok(entry.stunUntil > Date.now(), "kurz gesperrt");
  // Während der Sperre zählt nichts.
  entry.lastThrowAt = 0;
  entry.lastInputAt = 0;
  handleArcadeInput(room, one, { action: "throw" });
  assert.equal(entry.throws, 2, "gesperrt wird nicht geworfen");
});

test("messerwurf: ein voller Stamm bringt Zugabe und den nächsten", () => {
  const { one, arcade, room, minigame, entry } = knifeRoom();
  // Schnell drehender Stamm, Würfe mit Abstand: alle stecken.
  entry.apples = [];
  const total = entry.knivesLeft;
  for (let i = 0; i < total; i += 1) {
    // Jeden Wurf an eine andere Stelle: die Stufe so zurückdatieren, dass der
    // Stamm um 360/total Grad weitergedreht ist.
    entry.spin = { kind: "steady", speed: 0 };
    entry.stuckAngles = entry.stuckAngles.map((knife) => ({ ...knife, angle: (knife.angle + 360 / total) % 360 }));
    entry.lastThrowAt = 0;
    entry.lastInputAt = 0;
    handleArcadeInput(room, one, { action: "throw" });
  }
  assert.equal(entry.stuck, total, "alle stecken");
  assert.equal(entry.cleared, 1, "Stamm geschafft");
  assert.ok(entry.points > total, "mit Zugabe");
  assert.ok(entry.nextStageAt, "der nächste Stamm kommt");
  entry.nextStageAt = Date.now() - 1;
  testRules.updateKnife(room, minigame, arcade, 0.05, Date.now());
  assert.equal(entry.stage, 1, "Stufe 2");
  assert.equal(entry.knivesLeft, testRules.KNIFE_STAGES[1].knives);
  assert.equal(entry.stuckAngles.filter((knife) => knife.preset).length, testRules.KNIFE_STAGES[1].preset, "mit vorgesteckten Messern");
});

test("messerwurf: ein Apfel bringt Punkte", () => {
  const { one, room, entry } = knifeRoom();
  entry.spin = { kind: "steady", speed: 0 };
  const angle = testRules.knifeImpactAngle(entry, Date.now());
  entry.apples = [{ angle, hit: false }];
  handleArcadeInput(room, one, { action: "throw" });
  assert.equal(entry.applesHit, 1);
  assert.ok(entry.points >= 4, "Messer plus Apfel");
});

test("messerwurf: die Stämme sind für alle gleich und drehen verschieden", () => {
  const a = createArcadeState("messerwurf", [player({ id: "x", name: "X" }), player({ id: "y", name: "Y" })], Date.now());
  const [ex, ey] = [a.players.x, a.players.y];
  assert.deepEqual(ex.stuckAngles, ey.stuckAngles);
  assert.deepEqual(ex.apples, ey.apples);
  const kinds = new Set(testRules.KNIFE_STAGES.map((stage) => stage.spin.kind));
  assert.ok(kinds.size >= 3, "mehrere Drehmuster");
  // Pendeln wechselt die Richtung: der Winkel läuft hin und wieder zurück.
  const swing = testRules.KNIFE_STAGES.find((stage) => stage.spin.kind === "swing").spin;
  const d1 = testRules.knifeLogAngle(swing, 400) - testRules.knifeLogAngle(swing, 300);
  const d2 = testRules.knifeLogAngle(swing, 2900) - testRules.knifeLogAngle(swing, 2800);
  assert.ok(Math.sign(d1) !== Math.sign(d2), "die Drehrichtung wechselt");
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

test("bergsteiger: die Griffolge sagt die Hand an, die falsche rutscht ab", () => {
  const climber = player({ id: "ca", name: "CA", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("bergsteiger", [climber], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 26000, finishing: false };
  const room = { currentMinigame: minigame, players: [climber] };
  const entry = arcade.players[climber.id];
  const sides = arcade.sides;

  assert.equal(sides.length, 40, "die Folge ist so lang wie das Griffband im Client");
  assert.equal(entry.nextSide, sides[0], "die erste Hand steht in der Folge");

  entry.lastInputAt = 0;
  handleArcadeInput(room, climber, { action: "grab", side: sides[0] });
  assert.equal(entry.rung, 1, "der richtige Griff bringt eine Sprosse");
  assert.equal(entry.nextSide, sides[1], "die nächste Hand kommt aus der Folge, nicht aus blossem Umdrehen");

  // Falsche Hand → Abrutscher.
  entry.lastInputAt = 0;
  handleArcadeInput(room, climber, { action: "grab", side: -sides[1] });
  assert.equal(entry.rung, 0, "die falsche Hand rutscht eine Sprosse ab");
  assert.equal(entry.slips, 1);
  assert.equal(entry.nextSide, sides[0], "nach dem Abrutschen gilt wieder der Griff der tieferen Sprosse");

  const higher = arcadeRankingScore(arcade, { rung: 12, finishedAt: null });
  const lower = arcadeRankingScore(arcade, { rung: 4, finishedAt: null });
  assert.ok(higher > lower, "climbing higher ranks better");
});

test("bergsteiger: der Gipfel liegt bei 70, oben zählt die Zeit", () => {
  const climber = player({ id: "cg", name: "CG", color: "#fff" });
  const startedAt = Date.now() - 9000;
  const arcade = createArcadeState("bergsteiger", [climber], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 26000, finishing: false };
  const room = { currentMinigame: minigame, players: [climber] };
  const entry = arcade.players[climber.id];
  assert.equal(arcade.height, 70);

  for (let step = 0; step < 70; step += 1) {
    entry.lastInputAt = 0;
    handleArcadeInput(room, climber, { action: "grab", side: entry.nextSide });
  }
  assert.equal(entry.rung, 70);
  assert.ok(entry.finishedAt, "oben angekommen ist man fertig");
  assert.ok(entry.finishMs >= 9000 && entry.finishMs < 10000, "die Gipfelzeit zählt ab Start");
  entry.lastInputAt = 0;
  handleArcadeInput(room, climber, { action: "grab", side: entry.nextSide });
  assert.equal(entry.rung, 70, "über den Gipfel hinaus geht es nicht");

  const fast = arcadeRankingScore(arcade, { rung: 70, finishedAt: 1, finishMs: 11000 });
  const slow = arcadeRankingScore(arcade, { rung: 70, finishedAt: 1, finishMs: 14000 });
  const almost = arcadeRankingScore(arcade, { rung: 69, finishedAt: null });
  assert.ok(fast > slow, "wer schneller oben war, liegt vorn");
  assert.ok(slow > almost, "oben angekommen schlägt jeden, der es nicht geschafft hat");
});

// Wer blind Hand über Hand trommelt, soll nicht durchkommen — aber die Wand
// muss lesbar bleiben. Beides steckt in der Form der Griffolge.
test("bergsteiger: Doppelsprossen sind eingestreut, aber nie drei am Stück", () => {
  const climber = player({ id: "cb", name: "CB", color: "#fff" });
  const sides = createArcadeState("bergsteiger", [climber], Date.now()).sides;
  const doppel = sides.filter((side, index) => index > 0 && side === sides[index - 1]).length;
  assert.ok(doppel >= 4, `zu wenige Doppelsprossen (${doppel}) — reines Wechseln`);
  assert.ok(doppel <= sides.length / 3, `zu viele Doppelsprossen (${doppel})`);

  // Auch über den Umlauf hinweg: das Griffband wiederholt sich, und an der
  // Nahtstelle darf keine dritte Sprosse auf derselben Seite entstehen.
  const zweimal = [...sides, ...sides];
  let lauf = 1;
  zweimal.forEach((side, index) => {
    if (index === 0) return;
    lauf = side === zweimal[index - 1] ? lauf + 1 : 1;
    assert.ok(lauf <= 2, `drei Griffe auf derselben Seite bei Sprosse ${index}`);
  });
});


// Eine Kugel, die nicht ankommt, ist eine verlorene Runde — und niemand sieht,
// warum. Die äussersten Nägel standen so nah an der Wand, dass dazwischen
// weniger Platz war, als eine Kugel breit ist: wer aussen ansetzte, dessen
// Kugel verkeilte sich und klackerte die ganze Runde lang auf der Stelle.
test("nagelbrett: jede Kugel kommt unten an, egal wo sie eingeworfen wird", () => {
  const werfer = player({ id: "pl", name: "PL", color: "#fff" });
  const haenger = [];
  let laengste = 0;
  for (let schritt = 0; schritt <= 40; schritt += 1) {
    const x = schritt / 40;
    const spieler = [player({ id: "pl", name: "PL", color: "#fff" })];
    const arcade = createArcadeState("nagelbrett", spieler, Date.now());
    const minigame = { arcade, scores: {}, startedAt: Date.now(), duration: 28000, finishing: false };
    const room = { currentMinigame: minigame, players: spieler };
    arcade.players.pl.lastInputAt = 0;
    handleArcadeInput(room, spieler[0], { action: "drop", x });
    let ms = 0;
    while (ms < 20000 && arcade.balls.length > 0) {
      ms += 90;
      updatePlinko(room, minigame, arcade, 0.09, Date.now() + ms);
    }
    if (arcade.balls.length > 0) haenger.push(x.toFixed(3));
    laengste = Math.max(laengste, ms);
  }
  assert.deepEqual(haenger, [], `Kugeln blieben hängen bei x = ${haenger.join(", ")}`);
  assert.ok(laengste < 12000, `längster Fall ${laengste} ms — das frisst die halbe Runde`);
  assert.ok(werfer);
});

// Der Abstand ist das Eigentliche: zwischen Wand und äusserstem Nagel muss eine
// ganze Kugel Platz haben, sonst hilft auch der Notfall-Schubs nur noch beim
// Aufräumen.
test("nagelbrett: zwischen Wand und äusserstem Nagel passt eine Kugel", () => {
  const arcade = createArcadeState("nagelbrett", [player({ id: "q", name: "Q", color: "#fff" })], Date.now());
  const links = Math.min(...arcade.pegs.map((peg) => peg.x - peg.r));
  const rechts = Math.max(...arcade.pegs.map((peg) => peg.x + peg.r));
  assert.ok(links >= PLINKO_BALL_R * 2, `links nur ${links.toFixed(3)} frei, nötig ${(PLINKO_BALL_R * 2).toFixed(3)}`);
  assert.ok(1 - rechts >= PLINKO_BALL_R * 2, `rechts nur ${(1 - rechts).toFixed(3)} frei`);
});

// Ein Klangname, den es nicht gibt, macht keinen Fehler — er macht STILLE. Genau
// das ist schon passiert: an einer Kreuzung wurde sound("select") gerufen, den
// es nicht gab, und die Wegwahl war lautlos. Nichts im Code fiel dabei auf.
// Darum hier: jeder Name, den irgendeine Datei ruft, muss in der Klangwerkstatt
// stehen.
test("Klänge: jeder gerufene Name existiert auch", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const werkstatt = fs.readFileSync(path.join(__dirname, "../client/src/game/Feedback.js"), "utf8");
  const tabelle = werkstatt.slice(werkstatt.indexOf("const sequences = {"));
  const bekannt = new Set([...tabelle.matchAll(/^\s{6}([a-zA-Z]+):/gm)].map((treffer) => treffer[1]));
  assert.ok(bekannt.size > 10, `nur ${bekannt.size} Klänge gefunden — Tabelle nicht erkannt`);

  const gerufen = new Map();
  const durchgehen = (ordner) => {
    fs.readdirSync(ordner, { withFileTypes: true }).forEach((eintrag) => {
      const voll = path.join(ordner, eintrag.name);
      if (eintrag.isDirectory()) return durchgehen(voll);
      if (!eintrag.name.endsWith(".js")) return;
      const text = fs.readFileSync(voll, "utf8");
      for (const treffer of text.matchAll(/sound\(\s*"([a-zA-Z]+)"/g)) {
        if (!gerufen.has(treffer[1])) gerufen.set(treffer[1], []);
        gerufen.get(treffer[1]).push(eintrag.name);
      }
    });
  };
  durchgehen(path.join(__dirname, "../client/src"));
  const stumm = [...gerufen.keys()].filter((name) => !bekannt.has(name));
  assert.deepEqual(stumm, [], `stumme Klänge: ${stumm.map((n) => `${n} (${gerufen.get(n).join(", ")})`).join("; ")}`);
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


// --- Ballonfahrt -----------------------------------------------------------

function glideRoom(players = [{ id: "g1", name: "Pilot", isBot: false }]) {
  const startedAt = Date.now();
  const arcade = createArcadeState("ballonfahrt", players, startedAt);
  const minigame = { id: 1, type: "ballonfahrt", startedAt, duration: GLIDE_DURATION_MS, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];

  // Der Tick deckelt seinen Zeitschritt auf 0.2 s. Ein Sprung von 2 s zaehlte
  // also nur 0.2 s — darum in Schritten laufen lassen.
  const STEP = 60;
  const advance = (ms) => {
    let left = ms;
    while (left > 0) {
      const chunk = Math.min(STEP, left);
      const now = Date.now();
      arcade.lastUpdateAt = now - chunk;
      minigame.startedAt -= chunk;
      if (entry.stallUntil) entry.stallUntil -= chunk;
      updateArcade(room);
      left -= chunk;
    }
  };
  const hold = (down) => {
    entry.lastInputAt = 0;
    return handleArcadeInput(room, me, { action: "lift", down });
  };
  return { room, me, arcade, entry, minigame, advance, hold };
}

test("glide: holding rises, letting go sinks", () => {
  const { entry, advance, hold } = glideRoom();
  const start = entry.y;
  hold(true);
  advance(700);
  assert.ok(entry.y > start, `Halten muss steigen, war ${entry.y}`);
  const high = entry.y;
  hold(false);
  // Deutlich laenger als beim Steigen: der Ballon traegt seinen Schwung noch
  // ein Stueck weiter, bevor er kippt. Genau das macht ihn spielbar.
  advance(1600);
  assert.ok(entry.y < high, `Loslassen muss sinken, war ${entry.y}`);
});

test("glide: the balloon never leaves the shaft", () => {
  const { entry, advance, hold } = glideRoom();
  hold(true);
  advance(6000);
  assert.ok(entry.y <= 1 && entry.y >= 0, `oben raus: ${entry.y}`);
  hold(false);
  advance(6000);
  assert.ok(entry.y <= 1 && entry.y >= 0, `unten raus: ${entry.y}`);
});

test("glide: bumping stalls the balloon for a moment", () => {
  // Die Strafe fuers Anecken ist kein Abzug, sondern ein Moment, in dem die
  // Hand nichts bewirkt. Ohne das waere der Boden ein bequemer Parkplatz.
  const { entry, advance, hold } = glideRoom();
  hold(false);
  advance(3000);
  assert.equal(entry.y, 0, "der Ballon muss auf dem Boden liegen");
  assert.ok(entry.bumps >= 1, "eine Bodenberuehrung muss zaehlen");
  // Die Stockung frisch stellen. Der Aufschlag liegt zu diesem Zeitpunkt
  // schon laenger zurueck als GLIDE_STALL_MS — die Regel selbst pruefen wir
  // aber an einer frischen Stockung, nicht an einer zufaellig noch laufenden.
  entry.stallUntil = Date.now() + GLIDE_STALL_MS;
  hold(true);
  advance(120);
  assert.ok(entry.y < 0.02, "waehrend der Stockung darf Halten nichts bringen");
  advance(GLIDE_STALL_MS + 300);
  assert.ok(entry.y > 0.05, "danach muss der Ballon wieder steigen");
});

test("glide: ein Sack fliegt mit und landet dort, wo die Fallzeit ihn hinträgt", () => {
  const { glideFallMs, glideGroundX } = testRules;
  const { room, me, entry, minigame } = glideRoom();
  entry.y = 0.5;
  minigame.startedAt = Date.now() - 4000;
  entry.lastInputAt = 0;
  handleArcadeInput(room, me, { action: "drop" });
  const bag = entry.bags[0];
  assert.ok(bag, "ein Sack ist unterwegs");
  assert.ok(Math.abs(bag.landAt - (bag.at + glideFallMs(0.5))) <= 1);
  assert.ok(Math.abs(bag.landX - glideGroundX(bag.landAt)) < 0.01, "er fliegt mit dem Ballon weiter");
  // Höher heisst länger fallen, also früher loslassen.
  assert.ok(glideFallMs(0.9) > glideFallMs(0.2) * 1.5);
});

test("glide: ein Treffer auf die Scheibe zählt nach Ring, einmal je Scheibe", () => {
  const { glideFallMs } = testRules;
  const { room, me, arcade, entry, minigame, advance } = glideRoom();
  const target = arcade.targets[0];
  entry.y = 0.3;
  entry.vy = 0;
  // Genau so loslassen, dass der Sack auf der Mitte landet.
  const dropAt = target.at - glideFallMs(0.3);
  minigame.startedAt = Date.now() - dropAt;
  entry.lastInputAt = 0;
  handleArcadeInput(room, me, { action: "drop" });
  entry.holding = false;
  advance(Math.ceil(glideFallMs(0.3)) + 120);
  const bag = entry.bags[0];
  assert.equal(bag.target, target.index);
  assert.ok(bag.points >= 60, `nah an der Mitte gibt viel (${bag.points}, ${bag.off})`);
  const score = entry.score;
  // Ein zweiter Sack auf dieselbe Scheibe zählt nicht noch einmal.
  entry.lastBagAt = 0;
  entry.lastInputAt = 0;
  entry.y = 0.3;
  const again = target.at - glideFallMs(0.3);
  minigame.startedAt = Date.now() - again;
  handleArcadeInput(room, me, { action: "drop" });
  advance(Math.ceil(glideFallMs(0.3)) + 120);
  assert.equal(entry.score, score, "je Scheibe nur der erste Treffer");
});

test("glide: Sterne in der richtigen Höhe bringen Punkte", () => {
  const { entry, arcade, advance, minigame } = glideRoom();
  const star = arcade.stars[0];
  minigame.startedAt = Date.now() - (star.at - 80);
  entry.y = star.y;
  entry.vy = 0;
  entry.holding = false;
  // Kurz vor dem Stern auf seine Höhe setzen und durchfliegen.
  advance(40);
  entry.y = star.y;
  entry.vy = 0;
  advance(80);
  assert.equal(entry.starsCaught, 1, "der Stern ist eingesammelt");
});

test("glide: Scheiben und Sterne sind für alle gleich", () => {
  const players = [{ id: "g1", name: "A", isBot: false }, { id: "g2", name: "B", isBot: false }];
  const arcade = createArcadeState("ballonfahrt", players, Date.now());
  assert.ok(arcade.targets.length >= 6, "genug Scheiben");
  assert.ok(arcade.targets.every((target) => target.at < GLIDE_DURATION_MS - 1000), "keine Scheibe nach dem Abpfiff");
  assert.equal(arcade.players.g1.bagsLeft, arcade.players.g2.bagsLeft);
  assert.ok(arcade.players.g1.bagsLeft > arcade.targets.length, "ein paar Säcke Reserve");
});

test("glide: wrong action is refused", () => {
  const { room, me } = glideRoom();
  assert.equal(handleArcadeInput(room, me, { action: "shoot" }).ok, false);
});

// --- Ergebnistafel ---------------------------------------------------------

test("result: only everyone together can skip the result table", () => {
  // Der Weiter-Knopf beschleunigt, er überspringt nicht. Ein einzelner
  // Ungeduldiger darf den anderen die Tafel nicht wegnehmen, bevor sie sie
  // gelesen haben — und ein Bot oder ein weggelegtes Handy darf die Runde
  // umgekehrt nicht blockieren.
  const room = {
    status: "result",
    players: [
      { id: "a", name: "A", isBot: false, connected: true },
      { id: "b", name: "B", isBot: false, connected: true },
      { id: "c", name: "C", isBot: true, connected: true },
      { id: "d", name: "D", isBot: false, connected: false }
    ],
    readyForNext: []
  };
  const humans = humansInRoom(room);
  assert.deepEqual(humans.map((player) => player.id), ["a", "b"],
    "Bots und getrennte Geräte zählen nicht mit");

  const allReady = () => humans.every((player) => room.readyForNext.includes(player.id));
  assert.equal(allReady(), false);
  room.readyForNext.push("a");
  assert.equal(allReady(), false, "einer allein reicht nicht");
  room.readyForNext.push("b");
  assert.equal(allReady(), true);
});

// --- Messerwurf ------------------------------------------------------------

// --- Tiefenrausch ----------------------------------------------------------

function diveRoom() {
  const players = [{ id: "d1", name: "Gräber", isBot: false }];
  const startedAt = Date.now();
  const arcade = createArcadeState("tiefenrausch", players, startedAt);
  const minigame = { id: 1, type: "tiefenrausch", startedAt, duration: DIVE_DURATION_MS, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];
  const send = (input) => {
    entry.lastInputAt = 0;
    entry.busyUntil = 0;              // Grab- und Auftauchzeit überspringen
    return handleArcadeInput(room, me, input);
  };
  return { room, me, arcade, entry, minigame, send };
}

test("dive: digging deeper pays more and risks more", () => {
  // Beide Kurven müssen steigen, sonst gäbe es gar keine Entscheidung: wäre die
  // Beute flach, ginge man nie tief, wäre das Risiko flach, immer.
  for (let depth = 2; depth <= DIVE_MAX_DEPTH; depth += 1) {
    assert.ok(diveGain(depth) > diveGain(depth - 1), `Stufe ${depth} bringt nicht mehr`);
    assert.ok(diveRisk(depth) >= diveRisk(depth - 1), `Stufe ${depth} ist nicht riskanter`);
  }
  assert.ok(diveRisk(DIVE_MAX_DEPTH) <= DIVE_RISK_MAX);
});

test("dive: there is a right answer, and it is not at the edge", () => {
  // Ein Optimum bei 1 oder beim Maximum wäre keine Entscheidung, sondern eine
  // Regel. Es muss in der Mitte liegen, damit man es überhaupt suchen kann.
  const best = diveBestDepth();
  assert.ok(best > 1 && best < DIVE_MAX_DEPTH, `beste Tiefe liegt am Rand: ${best}`);
  // Und der Grenznutzen muss irgendwo kippen — sonst lohnte sich immer eine
  // Stufe mehr.
  let flip = 0;
  for (let depth = 1; depth < DIVE_MAX_DEPTH; depth += 1) {
    if (diveStepValue(depth) <= 0) { flip = depth; break; }
  }
  assert.ok(flip > 0, "der Erwartungswert kippt nie");
});

test("dive: the shown risk is what actually decides the dig", () => {
  // Steht im Bild eine andere Zahl als die, mit der gerechnet wird, ist das
  // ganze Spiel eine Lüge.
  const { arcade, entry } = diveRoom();
  assert.equal(entry.nextRisk, diveRiskAt(arcade.seed, 0, 1));
  assert.equal(entry.nextGain, diveGain(1));
  // Und sie schwankt: ohne Schwankung gäbe es je Runde nur eine richtige Tiefe,
  // und die zu treffen ist keine Leistung.
  const seen = new Set();
  for (let depth = 1; depth <= 6; depth += 1) seen.add(diveRiskAt(arcade.seed, 0, depth).toFixed(3));
  assert.ok(seen.size >= 5, "das Risiko muss je Stufe eine eigene Zahl sein");
});

test("dive: banking is the only thing that scores", () => {
  const { entry, send, arcade } = diveRoom();
  // Nicht einstürzen lassen: das Risiko wird für diesen Test ausgeschaltet.
  const realRandom = Math.random;
  Math.random = () => 0.999;
  send({ action: "dig" });
  send({ action: "dig" });
  Math.random = realRandom;
  assert.equal(entry.depth, 2);
  assert.ok(entry.carried > 0);
  assert.equal(entry.banked, 0, "was im Schacht hängt, zählt nicht");
  assert.equal(arcadeRankingScore(arcade, entry), 0);

  const carried = entry.carried;
  send({ action: "bank" });
  assert.equal(entry.banked, carried);
  assert.equal(entry.carried, 0);
  assert.equal(entry.depth, 0);
  assert.equal(arcadeRankingScore(arcade, entry), carried);
});

test("dive: a collapse costs everything that was still down there", () => {
  const { entry, send } = diveRoom();
  const realRandom = Math.random;
  Math.random = () => 0.999;
  send({ action: "dig" });
  send({ action: "dig" });
  const lost = entry.carried;
  Math.random = () => 0;              // dieser Stich stürzt ein
  send({ action: "dig" });
  Math.random = realRandom;
  assert.equal(entry.collapses, 1);
  assert.equal(entry.carried, 0);
  assert.equal(entry.depth, 0);
  assert.equal(entry.banked, 0, "ein Einsturz darf nichts retten");
  assert.equal(entry.lastDive.kind, "collapsed");
  assert.equal(entry.lastDive.gold, lost);
});

test("dive: banking at the surface does nothing", () => {
  // Sonst liesse sich die Auftauchzeit als Pause missbrauchen.
  const { entry, send } = diveRoom();
  send({ action: "bank" });
  assert.equal(entry.dives, 0);
  assert.equal(entry.busyUntil, 0);
});

test("dive: you cannot act while you are still busy", () => {
  const { entry, room, me } = diveRoom();
  entry.busyUntil = Date.now() + 5000;
  entry.lastInputAt = 0;
  handleArcadeInput(room, me, { action: "dig" });
  assert.equal(entry.depth, 0, "während des Grabens geht kein zweiter Stich");
});

test("dive: the result reports one number and it is the one that ranks", () => {
  const { arcade, entry } = diveRoom();
  entry.banked = 320;
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "points");
  assert.equal(detail.value, 320);
  assert.equal(arcadeRankingScore(arcade, entry), 320);
});

test("dive: wrong action is refused", () => {
  const { room, me } = diveRoom();
  assert.equal(handleArcadeInput(room, me, { action: "jump" }).ok, false);
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

test("bounce: the tempo holds steady inside a bar and steps at the bar line", () => {
  // Das ist der Unterschied zwischen „Rhythmusspiel" und „Reaktionsspiel".
  // Vorher wurde JEDER Schlag um 3.5 % schneller als sein Vorgänger: kein
  // Abstand glich dem vorherigen, und man konnte sich nie einhören.
  for (let bar = 0; bar < BOUNCE_TEMPOS.length; bar += 1) {
    const gaps = [];
    for (let beat = 1; beat < BOUNCE_BAR_BEATS; beat += 1) {
      const index = bar * BOUNCE_BAR_BEATS + beat;
      gaps.push(bounceBeatTime(index + 1) - bounceBeatTime(index));
    }
    assert.equal(new Set(gaps).size, 1, `Takt ${bar} hat wechselnde Abstände: ${gaps.join(", ")}`);
    assert.equal(gaps[0], BOUNCE_TEMPOS[bar], `Takt ${bar} spielt das falsche Tempo`);
  }
  // Und jede Stufe ist wirklich schneller als die davor.
  for (let i = 1; i < BOUNCE_TEMPOS.length; i += 1) {
    assert.ok(BOUNCE_TEMPOS[i] < BOUNCE_TEMPOS[i - 1], "jede Stufe muss schneller sein");
  }
});

test("bounce: even at full tempo a tap can still miss", () => {
  // Der halbe Abstand zwischen zwei Schlägen muss GRÖSSER sein als das Fenster
  // für einen Teiltreffer. Sonst liegt jeder Tipper zwangsläufig innerhalb des
  // Fensters irgendeines Schlags und Danebentippen wäre unmöglich.
  assert.ok(
    BOUNCE_BEAT_MIN_MS / 2 > BOUNCE_GOOD_MS,
    `schnellster Takt ${BOUNCE_BEAT_MIN_MS} ms lässt bei ${BOUNCE_GOOD_MS} ms Fenster keinen Fehltritt zu`
  );
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

test("bounce: a miss high up costs more than the same miss near the ground", () => {
  // Tief: ein einzelner Treffer, dann daneben.
  const low = bounceRoom();
  low.tapAt(3, 0);
  const lowBefore = low.entry.height;
  low.tapAt(4, BOUNCE_GOOD_MS + 25);
  const lowLoss = lowBefore - low.entry.height;

  // Hoch: erst eine lange Serie, dann derselbe Fehltritt.
  const high = bounceRoom();
  for (let beat = 3; beat < 25; beat += 1) high.tapAt(beat, 0);
  const highBefore = high.entry.height;
  high.tapAt(25, BOUNCE_GOOD_MS + 25);
  const highLoss = highBefore - high.entry.height;

  assert.ok(highBefore > lowBefore * 3, "die Serie muss erst einmal Höhe aufgebaut haben");
  assert.ok(highLoss > lowLoss * 1.5, `oben muss ein Fehltritt teurer sein (${highLoss} gegen ${lowLoss})`);
  // Ganz unten frisst der Grundabzug (BOUNCE_MISS_PENALTY) die ganze Höhe auf,
  // tiefer als der Boden geht es aber nicht.
  assert.ok(lowBefore < BOUNCE_MISS_PENALTY, "die Ausgangslage soll wirklich knapp über dem Boden sein");
  assert.equal(low.entry.height, 0, "ein Fehltritt ganz unten setzt auf den Boden zurück");
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

test("feint: real and fake start at exactly the same speed", () => {
  // DAS ist der Kern des Spiels. Wäre der Unterschied von Anfang an sichtbar,
  // gäbe es nichts zu wetten — dann wäre es wieder ein Nachschlagespiel, bei
  // dem man es entweder sofort sieht oder gar nicht.
  const real = { real: true, limit: 1 };
  FEINT_FAKE_LIMITS.forEach((limit) => {
    const fake = { real: false, limit };
    for (const t of [10, 25, 50]) {
      const gap = Math.abs(feintRadius(real, t) - feintRadius(fake, t));
      assert.ok(gap < 0.006, `bei ${t} ms schon ${gap.toFixed(4)} Unterschied (limit ${limit})`);
    }
    // Und später muss der Unterschied ABLESBAR sein, sonst ist es Raten.
    const late = feintRadius(real, FEINT_GROW_MS * 0.9) - feintRadius(fake, FEINT_GROW_MS * 0.9);
    assert.ok(late > 0.06, `am Ende nur ${late.toFixed(3)} Unterschied (limit ${limit})`);
  });
});

test("feint: a fake never reaches the mark, a real one always does", () => {
  const real = { real: true, limit: 1 };
  assert.equal(feintRadius(real, FEINT_GROW_MS), 1);
  assert.equal(feintRadius(real, FEINT_GROW_MS * 3), 1, "und bleibt dann stehen");
  FEINT_FAKE_LIMITS.forEach((limit) => {
    const fake = { real: false, limit };
    assert.ok(feintRadius(fake, FEINT_GROW_MS * 10) < 1,
      `eine Fälschung mit limit ${limit} darf die Marke nie erreichen`);
    assert.ok(feintRadius(fake, FEINT_GROW_MS * 10) <= limit + 1e-9);
  });
});

test("feint: the fake limits all appear and none of them is trivially early", () => {
  const limits = new Set(buildFeintSignals(491, FEINT_DURATION_MS)
    .filter((signal) => !signal.real)
    .map((signal) => signal.limit));
  FEINT_FAKE_LIMITS.forEach((limit) => {
    assert.ok(limits.has(limit), `limit ${limit} kam in einer ganzen Runde nicht vor`);
  });
  // Keine Fälschung darf so früh stehenbleiben, dass sie niemanden je täuscht.
  FEINT_FAKE_LIMITS.forEach((limit) => assert.ok(limit >= 0.5));
});

test("feint: neither the real signal nor a single fake takes over the round", () => {
  // Über mehrere Seeds, damit ein glücklicher Startwert nichts vertuscht.
  for (const seed of [491, 100, 7, 55, 913]) {
    const signals = buildFeintSignals(seed, FEINT_DURATION_MS);
    // Keine Durststrecke ohne echten Ring, sonst fühlt sich die Runde kaputt an.
    let drought = 0;
    let worst = 0;
    signals.forEach((signal) => {
      drought = signal.real ? 0 : drought + 1;
      worst = Math.max(worst, drought);
    });
    assert.ok(worst <= 4, `seed ${seed} had ${worst} fakes in a row`);
    // Und dieselbe Fälschung nicht dreimal hintereinander — das würde sie
    // verraten, statt zu täuschen.
    for (let i = 2; i < signals.length; i += 1) {
      const triple = !signals[i].real
        && signals[i].limit === signals[i - 1].limit
        && signals[i].limit === signals[i - 2].limit;
      assert.ok(!triple, `seed ${seed}: dieselbe Fälschung dreimal in Folge`);
    }
    FEINT_FAKE_LIMITS.forEach((limit) => {
      assert.ok(signals.some((signal) => !signal.real && signal.limit === limit),
        `seed ${seed} zeigte limit ${limit} nie`);
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

test("feint: tapping at a smaller ring pays more", () => {
  // Der Preis für Sicherheit. Wer wartet, bis der Ring fast an der Marke ist,
  // weiss zwar Bescheid — bekommt dafür aber nur den Rest.
  assert.equal(feintPoints(0), FEINT_MAX_POINTS);
  assert.equal(feintPoints(1), FEINT_MIN_POINTS);
  assert.ok(feintPoints(0.3) > feintPoints(0.8), "früher muss mehr wert sein");
  // Auch ein spätes Erkennen bringt noch etwas — Nichtstun bringt nichts.
  assert.ok(FEINT_MIN_POINTS > 0);
});

test("feint: hitting the real signal scores by how small the ring was", () => {
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
  const { entry, reactTo, firstOfKind } = feintRoom();
  const fake = firstOfKind("fake");
  assert.ok(fake >= 0, "the plan needs a visible fake to tap");
  reactTo(fake, 60);
  assert.equal(entry.falseStarts, 1);
  assert.equal(entry.hits, 0);
  assert.equal(entry.score, -FEINT_FALSE_START);
  assert.ok(entry.lockUntil > Date.now(), "a false start has to lock the button");
  assert.equal(entry.lastReact.kind, "fake");
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
  reactTo(firstOfKind("fake"), 60);
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

test("feint: the result reports one number and it is the one that ranks", () => {
  const { arcade, entry, reactTo, firstOfKind } = feintRoom();
  reactTo(firstOfKind("go"), 120);
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "points");
  assert.equal(detail.value, Math.max(0, Math.round(entry.score)));
  assert.equal(arcadeRankingScore(arcade, entry), Math.round(entry.score));
});

test("feint: wrong action is refused", () => {
  const { room, me } = feintRoom();
  const result = handleArcadeInput(room, me, { action: "jump" });
  assert.equal(result.ok, false);
});

// --- Spurmaler -------------------------------------------------------------

test("trace: the band narrows in places and never pinches shut", () => {
  // Der Rhythmus aus weit und eng ist der halbe Reiz. Aber eine Engstelle, die
  // schmaler ist als die Handunruhe, wäre keine Schwierigkeit, sondern Pech.
  for (const seed of [503, 7, 91, 2024]) {
    let narrowest = 1;
    let widest = 0;
    for (let i = 0; i <= 100; i += 1) {
      const width = traceWidthAt(seed, 0, i / 100);
      narrowest = Math.min(narrowest, width);
      widest = Math.max(widest, width);
    }
    assert.ok(narrowest <= 0.6, `seed ${seed}: keine echte Engstelle (${narrowest.toFixed(2)})`);
    assert.ok(narrowest >= TRACE_NARROW_MIN - 1e-9, `seed ${seed}: zu eng (${narrowest.toFixed(2)})`);
    assert.ok(widest > 0.95, `seed ${seed}: nie richtig weit (${widest.toFixed(2)})`);
  }
  // Anfang und Ende einer Runde müssen weit sein: dort setzt man den Finger an
  // und hat die Kurve noch gar nicht gefunden.
  [503, 7, 91].forEach((seed) => {
    assert.ok(traceWidthAt(seed, 0, 0) > 0.95, "der Anfang darf keine Engstelle sein");
    assert.ok(traceWidthAt(seed, 0, 1) > 0.95, "das Ende auch nicht");
  });
});

test("trace: the crystals sit inside the band and never on a bottleneck", () => {
  // Ein Kristall am Bandrand PLUS eine Engstelle heisst: die eine Aufgabe macht
  // die andere unmöglich. Gemessen rutschte genau der Bot ab, der nach den
  // Kristallen griff, und der stur mittig ziehende gewann.
  for (const seed of [503, 7, 91, 2024]) {
    for (let lap = 0; lap < 4; lap += 1) {
      const gems = buildTraceGems(seed, lap);
      // In einer Runde mit vielen Engstellen bleiben weniger Plätze übrig —
      // dann gibt es eben weniger Kristalle. Lieber weniger als einer, der
      // nicht zu holen ist.
      assert.ok(gems.length >= 2 && gems.length <= TRACE_GEMS_PER_LAP,
        `seed ${seed} Runde ${lap}: ${gems.length} Kristalle`);
      gems.forEach((gem) => {
        const centre = tracePathX(seed, lap, gem.t);
        const tolerance = traceToleranceAt(seed, lap, gem.t);
        assert.ok(Math.abs(gem.x - centre) < tolerance,
          `seed ${seed} Runde ${lap}: Kristall ${gem.index} liegt ausserhalb des Bandes`);
        assert.ok(traceWidthAt(seed, lap, gem.t) >= 0.8,
          `seed ${seed} Runde ${lap}: Kristall ${gem.index} liegt auf einer Engstelle`);
        assert.ok(gem.t > 0.05 && gem.t < 0.92);
      });
      // Und sie liegen auseinander, nicht auf einem Haufen.
      for (let i = 1; i < gems.length; i += 1) {
        assert.ok(gems[i].t > gems[i - 1].t, "die Kristalle müssen der Reihe nach kommen");
      }
    }
  }
});

test("trace: a crystal counts once and only when the finger is on it", () => {
  const players = [{ id: "t1", name: "Maler", isBot: false }];
  const startedAt = Date.now();
  const arcade = createArcadeState("spurmaler", players, startedAt);
  const minigame = { id: 1, type: "spurmaler", startedAt, duration: 32000, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];
  const send = (x, y) => { entry.lastInputAt = 0; return handleArcadeInput(room, me, { action: "trace", x, y }); };

  const gem = entry.gems[0];
  // Bis kurz unter den Kristall ziehen — der Fortschritt ist gedeckelt, also in
  // Schritten, und zwischendurch die Uhr weiterlaufen lassen.
  for (let t = 0; t <= gem.t + 0.02; t += 0.02) {
    entry.lastAdvanceAt = Date.now() - 400;
    send(tracePathX(arcade.seed, 0, t), t);
  }
  assert.equal(entry.gemsTotal, 0, "auf der Mittellinie darf der Kristall nicht zufallen");

  const fresh = createArcadeState("spurmaler", players, startedAt);
  const room2 = { currentMinigame: { id: 2, type: "spurmaler", startedAt, duration: 32000, arcade: fresh, scores: {}, lastInputAt: {} }, players };
  const e2 = fresh.players[me.id];
  const send2 = (x, y) => { e2.lastInputAt = 0; return handleArcadeInput(room2, me, { action: "trace", x, y }); };
  const g2 = e2.gems[0];
  for (let t = 0; t <= g2.t + 0.02; t += 0.02) {
    e2.lastAdvanceAt = Date.now() - 400;
    // Auf der Höhe des Kristalls dorthin zielen, sonst mittig bleiben.
    const aim = Math.abs(t - g2.t) <= TRACE_GEM_REACH ? g2.x : tracePathX(fresh.seed, 0, t);
    send2(aim, t);
  }
  assert.equal(e2.gemsTotal, 1, "wer draufzieht, muss ihn bekommen");
  // Und ein zweites Mal darüber zählt nicht noch einmal.
  e2.progress = Math.max(0, g2.t - 0.01);
  e2.lastAdvanceAt = Date.now() - 400;
  send2(g2.x, g2.t);
  assert.equal(e2.gemsTotal, 1, "ein Kristall zählt genau einmal");
});

test("trace: crystals are worth taking but do not outweigh finishing laps", () => {
  // Wenn die Kristalle mehr brächten als die Runde, würde man aufhören zu
  // malen und nur noch einsammeln — dann wäre es ein anderes Spiel.
  const allGems = TRACE_GEMS_PER_LAP * TRACE_GEM_POINTS;
  assert.ok(allGems > 0);
  assert.ok(allGems < TRACE_LAP_POINTS + TRACE_CLEAN_BONUS,
    `Kristalle einer Runde (${allGems}) dürfen die Runde selbst nicht überholen`);
});


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

test("trace: the result reports one number and it is the one that ranks", () => {
  const { arcade, entry, traceUp } = traceRoom();
  traceUp(1);
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "points");
  assert.equal(detail.value, Math.max(0, Math.round(entry.score)));
  assert.equal(arcadeRankingScore(arcade, entry), Math.round(entry.score));
});

test("trace: wrong action is refused", () => {
  const { room, me } = traceRoom();
  const result = handleArcadeInput(room, me, { action: "jump" });
  assert.equal(result.ok, false);
});

// --- Sortierband -----------------------------------------------------------

function beltRoom(players = [{ id: "p1", name: "Sortierer", isBot: false }]) {
  const startedAt = Date.now();
  const arcade = createArcadeState("sortierband", players, startedAt);
  const minigame = { id: 1, type: "sortierband", startedAt, duration: BELT_DURATION_MS, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];

  // Der Tick deckelt seinen Zeitschritt auf 0.2 s (Schutz gegen einen
  // Aussetzer). Ein Sprung von 2 s zaehlte also nur 0.2 s — darum in Schritten.
  const STEP = 100;
  const advance = (ms) => {
    let left = ms;
    while (left > 0) {
      const chunk = Math.min(STEP, left);
      const now = Date.now();
      arcade.lastUpdateAt = now - chunk;
      minigame.startedAt -= chunk;
      updateArcade(room);
      left -= chunk;
    }
  };
  const sort = (chute) => {
    entry.lastInputAt = 0;
    return handleArcadeInput(room, me, { action: "sort", chute });
  };
  // Die Rutsche, in die das vorderste Paket gehoert.
  const rightChute = () => arcade.chutes.indexOf(entry.queue[0].colour);
  return { room, me, arcade, entry, minigame, advance, sort, rightChute };
}

test("belt: every parcel colour always has a chute", () => {
  // Mehr Farben als Rutschen hiesse: manche Pakete sind nicht sortierbar. Das
  // waere kein Koennen mehr, sondern Pech.
  assert.equal(BELT_COLOURS, BELT_CHUTES);
  const plan = buildBeltChutePlan(1234, BELT_DURATION_MS);
  plan.forEach((step) => {
    for (let colour = 0; colour < BELT_COLOURS; colour += 1) {
      assert.ok(step.chutes.includes(colour), `Farbe ${colour} fehlt bei ${step.at} ms`);
    }
  });
});

test("belt: every swap moves at least two chutes", () => {
  // Ein Tausch, bei dem sich nur eine Rutsche aendert, ist gar keiner: bei drei
  // Rutschen muessen mindestens zwei die Plaetze tauschen. Ein unsichtbarer
  // Tausch waere schlimmer als keiner — man wuerde ihn nur am Fehlgriff merken.
  for (let seed = 0; seed < 40; seed += 1) {
    const plan = buildBeltChutePlan(seed * 37 + 3, BELT_DURATION_MS);
    for (let i = 1; i < plan.length; i += 1) {
      const changed = plan[i].chutes.filter((colour, index) => colour !== plan[i - 1].chutes[index]).length;
      assert.ok(changed >= 2, `Startwert ${seed}, Schritt ${i}: nur ${changed} Rutschen bewegt`);
    }
  }
});

test("belt: the plan covers the whole round and is deterministic", () => {
  const a = buildBeltChutePlan(77, BELT_DURATION_MS);
  const b = buildBeltChutePlan(77, BELT_DURATION_MS);
  assert.deepEqual(a, b, "gleicher Startwert muss denselben Ablauf ergeben");
  assert.ok(a.length >= 2, "in einer Runde muss mindestens einmal getauscht werden");
  assert.ok(a[a.length - 1].at < BELT_DURATION_MS, "kein Tausch nach dem Abpfiff");
  assert.equal(a[0].at, 0);
});

test("belt: the belt runs faster towards the end", () => {
  assert.equal(beltSpeed(0, BELT_DURATION_MS), BELT_SPEED_START);
  assert.ok(Math.abs(beltSpeed(BELT_DURATION_MS, BELT_DURATION_MS) - BELT_SPEED_END) < 1e-9);
  assert.ok(beltSpeed(BELT_DURATION_MS / 2, BELT_DURATION_MS) > beltSpeed(0, BELT_DURATION_MS));
  assert.ok(BELT_SPEED_END > BELT_SPEED_START);
});

test("belt: a parcel out of reach cannot be sorted", () => {
  // Sonst koennte man blind vorsortieren, ohne je hinzuschauen.
  const { entry, sort } = beltRoom();
  entry.beltPos = 0;
  const before = entry.sorted;
  sort(0);
  assert.equal(entry.sorted, before, "vor der Greifkante darf nichts passieren");
  assert.equal(entry.wrong, 0, "und es darf auch nichts kosten");
});

test("belt: the right chute scores, the wrong one costs", () => {
  const { entry, sort, rightChute } = beltRoom();
  entry.beltPos = BELT_REACH_AT + 0.1;
  const wanted = rightChute();
  sort(wanted);
  assert.equal(entry.sorted, 1);
  assert.equal(entry.score, BELT_POINTS + BELT_STREAK_BONUS, "erstes Paket: Punkte plus eine Serie");

  entry.beltPos = BELT_REACH_AT + 0.1;
  const wrong = (rightChute() + 1) % BELT_CHUTES;
  const before = entry.score;
  sort(wrong);
  assert.equal(entry.wrong, 1);
  assert.equal(entry.score, before - BELT_WRONG_COST);
  assert.equal(entry.streak, 0, "ein Fehlgriff reisst die Serie ab");
});

test("belt: the streak bonus is capped", () => {
  const { entry, sort, rightChute } = beltRoom();
  let last = 0;
  for (let i = 0; i < BELT_STREAK_MAX + 6; i += 1) {
    entry.beltPos = BELT_REACH_AT + 0.1;
    const before = entry.score;
    sort(rightChute());
    last = entry.score - before;
  }
  assert.equal(last, BELT_POINTS + BELT_STREAK_MAX * BELT_STREAK_BONUS, "der Bonus muss gedeckelt sein");
  assert.equal(entry.bestStreak, BELT_STREAK_MAX + 6);
});

test("belt: letting a parcel through costs and resets the streak", () => {
  const { entry, advance, sort, rightChute } = beltRoom();
  entry.beltPos = BELT_REACH_AT + 0.1;
  sort(rightChute());
  const scored = entry.score;
  assert.equal(entry.streak, 1);

  entry.beltPos = 0.999;
  advance(200);
  assert.equal(entry.missed, 1, "ein durchgelaufenes Paket muss zaehlen");
  assert.equal(entry.streak, 0);
  assert.equal(entry.score, scored - BELT_MISS_COST);
});

test("belt: sorting early buys real time, missing does not cascade", () => {
  // Die Pakete stehen in festem Abstand, also ruecken sie beim Sortieren um
  // genau diesen Abstand vor: wer frueh greift, hat beim naechsten mehr Band.
  const early = beltRoom();
  early.entry.beltPos = BELT_REACH_AT + 0.02;
  early.sort(early.rightChute());
  const late = beltRoom();
  late.entry.beltPos = 0.95;
  late.sort(late.rightChute());
  assert.ok(early.entry.beltPos < late.entry.beltPos, "wer frueher greift, startet weiter hinten");
  assert.ok(late.entry.beltPos < 1, "und auch spaet greifen darf nicht sofort durchrutschen");

  // Ein durchgerutschtes Paket darf den naechsten Fehler nicht erzwingen —
  // sonst reisst ein Aussetzer die halbe Runde mit.
  const slipped = beltRoom();
  slipped.entry.beltPos = 0.999;
  slipped.advance(200);
  assert.equal(slipped.entry.missed, 1);
  assert.ok(slipped.entry.beltPos < 0.1, `nach einem Durchrutscher faengt das Band von vorne an, war ${slipped.entry.beltPos}`);
});

test("belt: the queue always looks the same distance ahead", () => {
  const { entry, sort, rightChute } = beltRoom();
  assert.equal(entry.queue.length, BELT_QUEUE);
  for (let i = 0; i < 12; i += 1) {
    entry.beltPos = BELT_REACH_AT + 0.1;
    sort(rightChute());
    assert.equal(entry.queue.length, BELT_QUEUE, "die Vorschau darf nie kuerzer werden");
    assert.ok(entry.queue.every((parcel) => parcel.colour >= 0 && parcel.colour < BELT_COLOURS));
  }
});

test("belt: two players get different parcel orders from the same round", () => {
  // Gleiche Schwierigkeit, aber man kann nicht beim Nachbarn ablesen.
  const { arcade } = beltRoom([
    { id: "p1", name: "A", isBot: false },
    { id: "p2", name: "B", isBot: false }
  ]);
  const a = arcade.players.p1.queue.map((parcel) => parcel.colour);
  const b = arcade.players.p2.queue.map((parcel) => parcel.colour);
  assert.notDeepEqual(a, b);
});

test("belt: the swap plan advances with the clock, not with the tick rate", () => {
  // Derselbe Fehler wie anderswo schon mehrfach: was pro Tick entschieden wird,
  // haengt an der Tickrate. Der Farbplan darf das nicht.
  const coarse = beltRoom();
  coarse.advance(BELT_SWAP_FIRST_MS + 500);
  const fine = beltRoom();
  for (let i = 0; i < (BELT_SWAP_FIRST_MS + 500) / 100; i += 1) fine.advance(100);
  assert.deepEqual(coarse.arcade.chutes, fine.arcade.chutes);
  assert.equal(coarse.arcade.swapIndex, 1, "nach der ersten Frist muss genau einmal getauscht sein");
});

test("belt: the swap is announced before it happens", () => {
  const { arcade, advance } = beltRoom();
  advance(BELT_SWAP_FIRST_MS - BELT_SWAP_WARN_MS - 800);
  assert.equal(arcade.nextChutes, null, "zu frueh gewarnt waere nur Rauschen");
  advance(1000);
  assert.ok(Array.isArray(arcade.nextChutes), "kurz davor muss die naechste Anordnung sichtbar sein");
  assert.notDeepEqual(arcade.nextChutes, arcade.chutes);
});

test("belt: the result reports one number and it is the one that ranks", () => {
  const { arcade, entry, sort, rightChute } = beltRoom();
  entry.beltPos = BELT_REACH_AT + 0.1;
  sort(rightChute());
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "points");
  assert.equal(detail.value, Math.round(entry.score));
  assert.equal(arcadeRankingScore(arcade, entry), Math.round(entry.score));
});

test("belt: unknown chute and wrong action are refused", () => {
  // lastInputAt jedes Mal zuruecksetzen: sonst verschluckt der Cooldown die
  // zweite Eingabe und der Test prueft nur noch die erste.
  const { room, me, entry } = beltRoom();
  const send = (input) => { entry.lastInputAt = 0; return handleArcadeInput(room, me, input); };
  assert.equal(send({ action: "jump" }).ok, false);
  assert.equal(send({ action: "sort", chute: 9 }).ok, false);
  assert.equal(send({ action: "sort", chute: -1 }).ok, false);
  assert.equal(send({ action: "sort", chute: "x" }).ok, false);
});

// --- Angelduell ------------------------------------------------------------

function fishRoom() {
  const players = [{ id: "a1", name: "Angler", isBot: false }];
  const startedAt = Date.now();
  const arcade = createArcadeState("angelduell", players, startedAt);
  const minigame = { id: 1, type: "angelduell", startedAt, duration: FISH_DURATION_MS, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];

  // Wie bei den anderen Tick-Spielen: der Tick deckelt seinen Zeitschritt auf
  // 0.2 s, und Halte-Ping wie Pause hängen an der ECHTEN Uhr. Beides muss der
  // Test nachbilden, sonst misst er etwas anderes als das Spiel.
  const STEP = 100;
  // `holding` darf auch eine Funktion sein: so lässt sich eine Strategie
  // spielen, die auf den Zustand REAGIERT — und nur so ist ein Vergleich
  // zwischen Gier und Können ehrlich.
  const advance = (ms, { holding = false, stopOnSnap = false } = {}) => {
    let left = ms;
    while (left > 0) {
      const chunk = Math.min(STEP, left);
      const now = Date.now();
      const snapsBefore = entry.snaps;
      const wants = typeof holding === "function" ? holding(entry) : holding;
      arcade.lastUpdateAt = now - chunk;
      entry.hookedAt -= chunk;
      if (entry.pauseUntil) entry.pauseUntil -= chunk;
      // Halten heisst: es kam gerade ein Ping.
      entry.lastReelAt = wants ? now : entry.lastReelAt - chunk;
      updateArcade(room);
      left -= chunk;
      if (stopOnSnap && entry.snaps > snapsBefore) return true;
    }
    return false;
  };
  const reel = () => {
    entry.lastInputAt = 0;
    return handleArcadeInput(room, me, { action: "reel" });
  };
  // Setzt den Fisch in eine ruhige bzw. kämpfende Phase.
  const intoCalm = () => { entry.hookedAt = Date.now(); };
  const intoSurge = () => { entry.hookedAt = Date.now() - entry.phases[0].at - 50; };
  // Die Art wird auf den Barsch festgenagelt (alle Multiplikatoren 1.0), damit
  // die Verhaltenstests das VERHALTEN prüfen und nicht, welche Art gerade
  // gezogen wurde. Die Unterschiede zwischen den Arten haben eigene Tests.
  const asBarsch = () => {
    entry.species = FISH_SPECIES.find((kind) => kind.id === "barsch");
    entry.phases = buildFishPhases(509, entry.catchIndex, FISH_DURATION_MS, entry.species);
  };
  asBarsch();
  return { room, me, arcade, entry, minigame, advance, reel, intoCalm, intoSurge, asBarsch };
}

test("fish: the fight alternates calm and surge and covers the round", () => {
  const phases = buildFishPhases(509, 0, FISH_DURATION_MS);
  assert.ok(phases.length >= 8, `only ${phases.length} surges in a round`);
  assert.ok(phases[0].at >= FISH_LEAD_IN_MS, "the fish needs a moment before its first surge");
  for (let i = 0; i < phases.length; i += 1) {
    assert.ok(phases[i].until > phases[i].at, "a surge has to last");
    if (i > 0) assert.ok(phases[i].at > phases[i - 1].until, "surges must not overlap");
  }
});

test("fish: every fish fights differently", () => {
  const shape = (index) => buildFishPhases(509, index, FISH_DURATION_MS).slice(0, 4).map((p) => Math.round(p.at)).join(",");
  assert.notEqual(shape(1), shape(0), "the next fish has to fight to its own plan");
  assert.notEqual(shape(2), shape(1));
});

test("fish: surging is only true inside a surge window", () => {
  const phases = buildFishPhases(509, 0, FISH_DURATION_MS);
  const first = phases[0];
  assert.equal(fishSurging(phases, first.at - 1), false);
  assert.equal(fishSurging(phases, first.at + 1), true);
  assert.equal(fishSurging(phases, first.until + 1), false);
});

test("fish: holding reels in and builds tension", () => {
  const { entry, advance, intoCalm } = fishRoom();
  intoCalm();
  advance(1000, { holding: true });
  assert.ok(entry.distance < 1, "holding has to bring the fish closer");
  assert.ok(entry.tension > 0, "and put tension on the line");
  assert.equal(entry.snaps, 0);
});

test("fish: letting go relaxes the line but loses ground", () => {
  const { entry, advance, intoCalm } = fishRoom();
  intoCalm();
  advance(1500, { holding: true });
  const pulled = entry.distance;
  const tense = entry.tension;
  advance(600, { holding: false });
  assert.ok(entry.tension < tense, "releasing has to drop the tension");
  assert.ok(entry.distance > pulled, "and let the fish take line back");
  assert.ok(entry.distance <= 1);
});

test("fish: holding through a surge snaps the line much faster", () => {
  const calm = fishRoom();
  calm.intoCalm();
  calm.advance(1000, { holding: true });

  const fight = fishRoom();
  fight.intoSurge();
  fight.advance(1000, { holding: true });
  assert.ok(fight.entry.surging, "the test has to actually be inside a surge");
  assert.ok(
    fight.entry.tension > calm.entry.tension * 2,
    `surge tension ${fight.entry.tension} vs calm ${calm.entry.tension}`
  );
});

test("fish: a snapped line costs the fish and pauses the fight", () => {
  const { entry, advance, intoSurge } = fishRoom();
  intoSurge();
  // Genau im Moment des Risses prüfen: läuft der Tick weiter, holt der
  // Dauerhaltende sofort den nächsten Fisch ein und die Werte sind wieder
  // unterwegs.
  const snapped = advance(4000, { holding: true, stopOnSnap: true });
  assert.equal(snapped, true, "holding through a long surge has to snap");
  assert.equal(entry.snaps, 1);
  assert.equal(entry.distance, 1, "the fish is gone");
  assert.equal(entry.tension, 0);
  assert.ok(entry.pauseUntil > Date.now(), "and there is a moment before the next bite");
});

test("fish: reeling is refused while the line is being re-cast", () => {
  const { entry, reel, intoSurge, advance } = fishRoom();
  intoSurge();
  advance(3000, { holding: true });
  const before = entry.lastReelAt;
  reel();
  assert.equal(entry.lastReelAt, before, "no reeling during the pause");
});

test("fish: landing a fish banks points and hooks the next one", () => {
  const { entry, advance, intoCalm } = fishRoom();
  // Ruhig einholen, zwischendurch lösen, damit die Schnur hält.
  for (let round = 0; round < 14; round += 1) {
    intoCalm();
    advance(900, { holding: true });
    advance(600, { holding: false });
    if (entry.landed > 0) break;
  }
  assert.ok(entry.landed >= 1, `no fish landed, distance ${entry.distance}, snaps ${entry.snaps}`);
  // Der nächste Fisch hängt sofort und startet weit weg. Nicht exakt 1: der
  // Tick läuft im selben Schritt weiter und zieht ihn schon ein Stück heran.
  assert.ok(entry.distance > 0.85, `der nächste Fisch startet zu nah: ${entry.distance}`);
  assert.ok(entry.haul > 0, "der gelandete Fisch muss zählen");
});

test("fish: the score counts what was landed, the started one and the snaps", () => {
  const barsch = FISH_SPECIES.find((kind) => kind.id === "barsch");
  assert.equal(fishScore({ haul: 500, distance: 1, snaps: 0, species: barsch }), 500);
  assert.equal(fishScore({ haul: 500, distance: 1, snaps: 3, species: barsch }), 500 - 3 * FISH_SNAP_COST);
  // Ein halb eingeholter Fisch zählt anteilig — und zwar zu SEINEM Wert.
  assert.equal(fishScore({ haul: 0, distance: 0.5, snaps: 0, species: barsch }), barsch.points / 2);
  const wels = FISH_SPECIES.find((kind) => kind.id === "wels");
  assert.ok(fishScore({ haul: 0, distance: 0.5, snaps: 0, species: wels })
    > fishScore({ haul: 0, distance: 0.5, snaps: 0, species: barsch }),
    "ein halber Wels muss mehr wert sein als ein halber Barsch");
});

test("fish: a heavy fish must actually be landable", () => {
  // Der erste Wels war mit reel 0.62 und surge 1.75 rechnerisch NICHT zu
  // landen: netto rund 0.028 Strecke pro Sekunde, also 36 Sekunden in einer
  // 34-Sekunden-Runde. Gemessen landete in 160 Bot-Runden kein einziger. Wert
  // darf aus Risiko kommen, nicht aus Unmöglichkeit.
  FISH_SPECIES.forEach((kind) => {
    // Grobe Abschätzung: die Hälfte der Zeit halten, die andere ruhen lassen.
    const netPerSecond = (FISH_REEL_SPEED * kind.reel - FISH_SLIP_SPEED) / 2;
    const seconds = 1 / netPerSecond;
    assert.ok(seconds < FISH_DURATION_MS / 1000 * 0.55,
      `${kind.name} braucht ${seconds.toFixed(1)} s — das passt nicht in eine Runde`);
  });
});

test("fish: losing a big fish costs more than losing a small one", () => {
  // Mit einem festen Abzug war Zocken die beste Strategie: gemessen riss der
  // unaufmerksamste Bot 2.45-mal pro Runde, landete dafür zwei Fische mehr und
  // gewann klar.
  const sprotte = FISH_SPECIES.find((k) => k.id === "sprotte");
  const wels = FISH_SPECIES.find((k) => k.id === "wels");
  assert.ok(Math.round(wels.points * FISH_SNAP_SHARE) > Math.round(sprotte.points * FISH_SNAP_SHARE) * 2);
  // Und ein Riss muss teurer sein, als der Fisch beim nächsten Versuch bringt —
  // sonst lohnt es sich, ihn absichtlich reissen zu lassen.
  assert.ok(FISH_SNAP_SHARE > 0.5);
});

test("fish: the species differ in what you actually feel", () => {
  // Reihenfolge und Richtung müssen stimmen: was mehr wert ist, muss auch
  // langsamer kommen und härter ziehen. Sonst wäre der teuerste Fisch auch der
  // einfachste und die Entscheidung, ihn durchzubringen, gäbe es gar nicht.
  const sorted = [...FISH_SPECIES].sort((a, b) => a.points - b.points);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i].points > sorted[i - 1].points, "die Werte müssen sich unterscheiden");
    assert.ok(sorted[i].reel < sorted[i - 1].reel, `${sorted[i].name} muss langsamer kommen`);
    assert.ok(sorted[i].surge > sorted[i - 1].surge, `${sorted[i].name} muss härter ziehen`);
  }
  // Und die seltenen sind die wertvollen.
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(sorted[i].weight <= sorted[i - 1].weight, `${sorted[i].name} darf nicht häufiger sein`);
  }
});

test("fish: which species bites is fixed by the seed, not by the clock", () => {
  const a = Array.from({ length: 12 }, (_, i) => fishSpeciesFor(509, i).id);
  const b = Array.from({ length: 12 }, (_, i) => fishSpeciesFor(509, i).id);
  assert.deepEqual(a, b, "gleicher Startwert muss dieselbe Folge ergeben");
  assert.ok(new Set(a).size >= 2, `nur eine Art in zwölf Fischen: ${a.join(",")}`);
  a.forEach((id) => assert.ok(FISH_SPECIES.some((kind) => kind.id === id)));
});

test("fish: a heavier fish surges longer and rests less", () => {
  const sprotte = buildFishPhases(509, 0, FISH_DURATION_MS, FISH_SPECIES.find((k) => k.id === "sprotte"));
  const wels = buildFishPhases(509, 0, FISH_DURATION_MS, FISH_SPECIES.find((k) => k.id === "wels"));
  const span = (phases) => (phases[0].until - phases[0].at);
  assert.ok(span(wels) > span(sprotte), `Wels schiebt ${span(wels)} ms, Sprotte ${span(sprotte)} ms`);
  assert.ok(wels.length > sprotte.length, "und er kommt öfter");
});

test("fish: reading the fish beats holding on regardless", () => {
  // Der erste Versuch verglich Dauerhalten mit einem STARREN Rhythmus — der
  // rutschte genauso oft in einen Schub und riss gleich oft. Das Können des
  // Spiels ist nicht "ab und zu loslassen", sondern auf den Fisch REAGIEREN.
  const greedy = fishRoom();
  greedy.advance(16000, { holding: true });

  const reader = fishRoom();
  reader.advance(16000, { holding: (entry) => !entry.surging && entry.tension < 0.72 });

  assert.ok(
    greedy.entry.snaps > reader.entry.snaps,
    `greedy snapped ${greedy.entry.snaps}, reader ${reader.entry.snaps}`
  );
  assert.ok(
    fishScore(reader.entry) > fishScore(greedy.entry),
    `reader ${fishScore(reader.entry)} vs greedy ${fishScore(greedy.entry)}`
  );
});

test("fish: a rigid rhythm is not enough — the surge has to be watched", () => {
  // Gegenprobe zum Test darüber: wer stur im Takt hält und löst, ohne auf den
  // Fisch zu schauen, reisst trotzdem. Sonst wäre das Spiel blindes Takten.
  const blind = fishRoom();
  for (let round = 0; round < 16; round += 1) {
    blind.advance(700, { holding: true });
    blind.advance(300, { holding: false });
  }
  assert.ok(blind.entry.snaps > 0, "a rhythm that ignores the surge has to snap sometimes");
});

test("fish: the result reports one number and it is the one that ranks", () => {
  // Seit die Arten unterschiedlich viel wert sind, sagt die STÜCKZAHL nichts
  // mehr: jemand mit weniger, aber grösseren Fischen liegt vorne. Die Anzeige
  // zeigte trotzdem die Stückzahl und behauptete damit das Gegenteil.
  const { arcade, entry, advance, intoCalm } = fishRoom();
  intoCalm();
  advance(1000, { holding: true });
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "points");
  assert.equal(detail.value, Math.max(0, Math.round(entry.score)));
  assert.equal(arcadeRankingScore(arcade, entry), Math.round(entry.score));
});

test("fish: wrong action is refused", () => {
  const { room, me } = fishRoom();
  assert.equal(handleArcadeInput(room, me, { action: "spin" }).ok, false);
});

// --- Farbenjagd ------------------------------------------------------------

function paintRoom(count = 2) {
  const names = ["Malerin", "Rivale", "Dritter", "Vierte"];
  const players = Array.from({ length: count }, (_unused, index) => ({ id: `c${index + 1}`, name: names[index], isBot: false }));
  const startedAt = Date.now();
  const arcade = createArcadeState("farbenjagd", players, startedAt);
  const minigame = { id: 1, type: "farbenjagd", startedAt, duration: PAINT_DURATION_MS, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const entry = arcade.players[me.id];

  const STEP = 60;
  const advance = (ms) => {
    let left = ms;
    while (left > 0) {
      const chunk = Math.min(STEP, left);
      const now = Date.now();
      arcade.lastUpdateAt = now - chunk;
      if (arcade.nextPickupAt) arcade.nextPickupAt -= chunk;
      players.forEach((player) => {
        const state = arcade.players[player.id];
        if (state.boostUntil) state.boostUntil -= chunk;
      });
      updateArcade(room);
      left -= chunk;
    }
  };
  const steer = (x, y, player = me) => {
    arcade.players[player.id].lastInputAt = 0;
    return handleArcadeInput(room, player, { action: "steer", x, y });
  };
  // Eine Figur hinstellen, samt Walze vor ihr — sonst malte der erste Tick
  // eine Spur von der alten Walzenstelle bis hierher.
  const place = (player, x, y, heading = null) => {
    const state = arcade.players[player.id];
    state.px = x;
    state.py = y;
    state.vx = 0;
    state.vy = 0;
    if (heading !== null) state.heading = heading;
    state.rx = x + Math.sin(state.heading) * PAINT_ROLLER_AHEAD;
    state.ry = y + Math.cos(state.heading) * PAINT_ROLLER_AHEAD;
  };
  const slotOf = (player) => arcade.order.indexOf(player.id);
  const at = (col, row) => arcade.cells[paintIndex(col, row)];
  const clear = () => arcade.cells.fill(-1);
  return { room, players, me, arcade, entry, minigame, advance, steer, place, slotOf, at, clear };
}

test("paint: one shared field, everyone starts with a patch in their own corner", () => {
  const { arcade, players } = paintRoom(4);
  assert.equal(arcade.cells.length, PAINT_COLS * PAINT_ROWS);
  assert.equal(arcade.paint.length, PAINT_COLS * PAINT_ROWS);
  const owners = players.map((player) => paintOwnedCount(arcade, player.id));
  assert.ok(owners.every((owned) => owned > 3 && owned === owners[0]), `ungleicher Start: ${owners}`);
  const spots = new Set(players.map((player) => {
    const state = arcade.players[player.id];
    return `${Math.floor(state.px)},${Math.floor(state.py)}`;
  }));
  assert.equal(spots.size, 4, "starting corners have to be distinct");
  // Zu zweit über Kreuz: die beiden stehen sich nicht gleich im Weg.
  const two = paintRoom(2);
  const [a, b] = two.players.map((player) => two.arcade.players[player.id]);
  assert.ok(Math.abs(a.px - b.px) > PAINT_COLS / 2 && Math.abs(a.py - b.py) > PAINT_ROWS / 2);
});

test("paint: the roller paints at once, and exactly where it rolls — in front of the kin", () => {
  // Das war der Fehler der alten Fassung: gemalt wurde unter dem Bauch und
  // erst nach einer Weile, die Walze rollte aber davor.
  const { entry, arcade, me, advance, place, slotOf, at, clear } = paintRoom(2);
  clear();
  place(me, 4.5, 12.5, Math.PI / 2);          // Blick nach +x
  advance(60);
  const ahead = Math.floor(4.5 + PAINT_ROLLER_AHEAD);
  assert.equal(at(ahead, 12), slotOf(me), "unter der Walze muss sofort Farbe liegen");
  assert.notEqual(at(2, 12), slotOf(me), "hinter der Figur liegt nichts");
  assert.equal(arcade.paint[paintIndex(ahead, 12)], String(slotOf(me)), "und die Geräte sehen es im selben Tick");
  assert.ok(entry.painted > 0);
});

test("paint: a fast stroke leaves no gaps", () => {
  // Eine Kapsel, keine Stichproben: auch ein langer Tick malt die ganze Strecke.
  const cells = new Set(paintSweep(1.5, 5.5, 9.5, 5.5, PAINT_BRUSH));
  for (let col = 1; col <= 9; col += 1) assert.ok(cells.has(paintIndex(col, 5)), `Lücke bei Spalte ${col}`);
  // Und die Walze ist breiter als eine Kachel.
  assert.ok(cells.has(paintIndex(5, 4)) && cells.has(paintIndex(5, 6)), "die Spur muss mehr als eine Reihe breit sein");
  assert.ok(!cells.has(paintIndex(5, 8)), "aber nicht beliebig breit");
  const wide = paintSweep(5.5, 12.5, 5.5, 12.5, PAINT_BRUSH_WIDE).length;
  const normal = paintSweep(5.5, 12.5, 5.5, 12.5, PAINT_BRUSH).length;
  assert.ok(wide > normal * 2, `die breite Walze (${wide}) muss deutlich mehr treffen als die normale (${normal})`);
  // Nichts ausserhalb des Feldes.
  paintSweep(-3, -3, 1, 1, PAINT_BRUSH_WIDE).forEach((index) => assert.ok(index >= 0 && index < PAINT_COLS * PAINT_ROWS));
});

test("paint: rival colour is painted over in a single pass", () => {
  const { entry, players, me, advance, steer, place, slotOf, at, clear, arcade } = paintRoom(2);
  clear();
  const rival = slotOf(players[1]);
  for (let col = 3; col <= 8; col += 1) arcade.cells[paintIndex(col, 12)] = rival;
  place(me, 1.5, 12.5, Math.PI / 2);
  steer(1, 0);
  advance(1800);
  for (let col = 3; col <= 8; col += 1) assert.equal(at(col, 12), slotOf(me), `Spalte ${col} gehört noch dem Rivalen`);
  assert.ok(entry.stolen >= 6, `übermalt: ${entry.stolen}`);
});

test("paint: closing a loop fills everything inside at once — rival colour too", () => {
  const { entry, players, me, arcade, advance, steer, place, slotOf, at, clear } = paintRoom(2);
  clear();
  const mine = slotOf(me);
  const rival = slotOf(players[1]);
  // Ein U aus eigener Farbe um ein 4 x 4-Feld, oben offen; drinnen liegt Fremdes.
  for (let row = 8; row <= 13; row += 1) {
    arcade.cells[paintIndex(3, row)] = mine;
    arcade.cells[paintIndex(8, row)] = mine;
  }
  for (let col = 3; col <= 8; col += 1) arcade.cells[paintIndex(col, 13)] = mine;
  for (let col = 4; col <= 7; col += 1) arcade.cells[paintIndex(col, 10)] = rival;
  // Noch offen: nichts ist eingeschlossen.
  assert.deepEqual(paintPockets(arcade.cells, mine), []);
  // Den Deckel ziehen: von links nach rechts über die Oberkante.
  place(me, 2.5, 7.5, Math.PI / 2);
  steer(1, 0);
  advance(1500);
  for (let row = 9; row <= 12; row += 1) {
    for (let col = 4; col <= 7; col += 1) assert.equal(at(col, row), mine, `(${col}, ${row}) ist nicht eingefärbt`);
  }
  assert.ok(entry.enclosed >= 8, `eingekreist: ${entry.enclosed}`);
  assert.ok(entry.biggestFill >= 8);
  assert.ok(arcade.fills.length > 0 && arcade.fills.at(-1).slot === mine, "die Szene braucht den Ursprung der Welle");
});

test("paint: the board edge is a wall — cutting off a corner fills it", () => {
  const { arcade, me, slotOf, clear } = paintRoom(2);
  clear();
  const mine = slotOf(me);
  // Ein L: Spalte 3 von oben bis Reihe 3, Reihe 3 von links bis Spalte 3.
  for (let i = 0; i <= 3; i += 1) {
    arcade.cells[paintIndex(3, i)] = mine;
    arcade.cells[paintIndex(i, 3)] = mine;
  }
  const pocket = paintPockets(arcade.cells, mine);
  assert.equal(pocket.length, 9, "die Ecke innerhalb des L ist eingeschlossen");
  // Eine schräge Treppe hält dicht: verbunden wird nur über Kanten.
  clear();
  for (let i = 0; i <= 4; i += 1) {
    arcade.cells[paintIndex(i, 4 - i)] = mine;
    if (i < 4) arcade.cells[paintIndex(i + 1, 4 - i)] = mine;
  }
  assert.ok(paintPockets(arcade.cells, mine).length > 0, "eine geschlossene Treppe schliesst die Ecke ab");
});

test("paint: the open field is never filled, and neither is a pocket over the cap", () => {
  const { arcade, me, slotOf, clear } = paintRoom(2);
  const mine = slotOf(me);
  // Quer über die Mitte: zwei grosse Hälften, keine davon wird genommen.
  clear();
  for (let col = 0; col < PAINT_COLS; col += 1) arcade.cells[paintIndex(col, 12)] = mine;
  assert.deepEqual(paintPockets(arcade.cells, mine), [], "ein Strich quer übers Feld darf nicht die halbe Welt nehmen");
  // Weiter oben quer: das kleine Stück darüber schon.
  clear();
  for (let col = 0; col < PAINT_COLS; col += 1) arcade.cells[paintIndex(col, 3)] = mine;
  const top = paintPockets(arcade.cells, mine);
  assert.equal(top.length, PAINT_COLS * 3);
  assert.ok(top.length <= PAINT_ENCLOSE_MAX);
  // Die grösste freie Fläche bleibt immer draussen.
  clear();
  assert.deepEqual(paintPockets(arcade.cells, mine), []);
});

test("paint: only the direction counts, not an oversized stick", () => {
  const { entry, steer } = paintRoom(2);
  steer(40, 0);
  assert.ok(Math.abs(entry.dirX) <= 1 + 1e-9, `direction was ${entry.dirX}`);
  steer(3, 4);
  assert.ok(Math.hypot(entry.dirX, entry.dirY) <= 1 + 1e-9, "a long vector has to be normalised");
});

test("paint: the kin drives at full speed and stays on the field", () => {
  const { entry, me, advance, steer, place } = paintRoom(2);
  place(me, 2.5, 12.5, Math.PI / 2);
  steer(1, 0);
  advance(1000);
  assert.ok(entry.px - 2.5 > PAINT_SPEED * 0.8, `in einer Sekunde nur ${entry.px - 2.5} Felder`);
  steer(-1, -1);
  advance(8000);
  assert.ok(entry.px >= 0 && entry.px <= PAINT_COLS, `x left the field: ${entry.px}`);
  assert.ok(entry.py >= 0 && entry.py <= PAINT_ROWS, `y left the field: ${entry.py}`);
  steer(1, 1);
  advance(8000);
  assert.ok(entry.px <= PAINT_COLS && entry.py <= PAINT_ROWS);
  // Loslassen heisst stehen.
  steer(0, 0);
  advance(500);
  assert.ok(Math.hypot(entry.vx, entry.vy) < 0.1, "ohne Stick bleibt die Figur stehen");
});

test("paint: turning swings the roller round instead of jumping", () => {
  // Die Szene dreht die Figur weich — springt die Walze auf dem Server, malt
  // sie woanders, als man sie sieht.
  const { entry, me, advance, steer, place } = paintRoom(2);
  place(me, 6, 12, Math.PI / 2);
  steer(-1, 0);
  advance(60);
  const turned = Math.abs(Math.atan2(Math.sin(entry.heading - Math.PI / 2), Math.cos(entry.heading - Math.PI / 2)));
  assert.ok(turned > 0.1 && turned <= PAINT_TURN_RATE * 0.06 + 1e-6, `in einem Tick um ${turned} gedreht`);
  advance(600);
  assert.ok(Math.abs(Math.sin(entry.heading) + 1) < 0.05, "nach einer halben Sekunde zeigt sie in die neue Richtung");
});

test("paint: two kins in the same spot push each other apart", () => {
  const { arcade, players, advance, place } = paintRoom(2);
  place(players[0], 6.5, 12.5);
  place(players[1], 6.55, 12.5);
  const one = arcade.players[players[0].id];
  const two = arcade.players[players[1].id];
  advance(300);
  const dist = Math.hypot(two.px - one.px, two.py - one.py);
  assert.ok(dist > 0.5, `they stayed on top of each other: ${dist}`);
  assert.ok(one.bumps > 0 && two.bumps > 0, "the bump has to be recorded for both");
});

test("paint: the golden roller widens the brush for a while, then wears off", () => {
  const { arcade, entry, me, advance, place } = paintRoom(2);
  place(me, 6.5, 12.5);
  arcade.pickups = [{ id: 99, kind: "wide", x: 6.5, y: 12.5 }];
  advance(60);
  assert.equal(entry.wide, true, "walking onto the roller has to pick it up");
  assert.equal(entry.lastPickupKind, "wide");
  assert.equal(arcade.pickups.length, 0, "and take it off the field");
  advance(PAINT_BOOST_MS + 300);
  assert.equal(entry.wide, false, "the roller has to wear off");
});

test("paint: a paint bomb splashes a whole disc at once", () => {
  const { arcade, entry, me, advance, place, clear } = paintRoom(2);
  clear();
  place(me, 6.5, 12.5);
  const before = paintOwnedCount(arcade, me.id);
  arcade.pickups = [{ id: 7, kind: "bomb", x: 6.5, y: 12.5 }];
  advance(60);
  const after = paintOwnedCount(arcade, me.id);
  assert.ok(after - before >= Math.floor(Math.PI * PAINT_BOMB_RADIUS ** 2 * 0.8), `der Klecks brachte nur ${after - before} Felder`);
  assert.equal(entry.lastPickupKind, "bomb");
  assert.equal(entry.wide, false, "die Bombe macht die Walze nicht breit");
});

test("paint: never more than two extras lie around", () => {
  const { arcade, advance } = paintRoom(2);
  advance(30000);
  assert.ok(arcade.pickups.length <= PAINT_PICKUP_MAX, `${arcade.pickups.length} extras on the field`);
  assert.ok(arcade.nextPickupId > 1, "es muss überhaupt welche geben");
  arcade.pickups.forEach((pickup) => {
    assert.ok(["wide", "bomb"].includes(pickup.kind));
    assert.ok(pickup.x > 0 && pickup.x < PAINT_COLS && pickup.y > 0 && pickup.y < PAINT_ROWS);
  });
});

test("paint: the score is the area held — the number in the bar", () => {
  const { arcade, entry, players, me, advance, steer, place, slotOf } = paintRoom(2);
  place(me, 2.5, 12.5, Math.PI / 2);
  steer(1, 0);
  advance(1200);
  assert.equal(entry.score, entry.owned);
  assert.equal(entry.owned, paintOwnedCount(arcade, me.id));
  // Wird die Fläche übermalt, sinkt der Stand mit.
  const held = entry.owned;
  const rival = slotOf(players[1]);
  arcade.cells = arcade.cells.map((cell) => (cell === slotOf(me) ? rival : cell));
  advance(60);
  assert.ok(entry.score < held, "verlorene Fläche zählt nicht mehr");
});

test("paint: the result reports one number and it is the one that ranks", () => {
  const { arcade, entry, advance, steer, me, place } = paintRoom(2);
  place(me, 2.5, 12.5, Math.PI / 2);
  steer(1, 0);
  advance(900);
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "points");
  assert.equal(detail.label, "Felder");
  assert.equal(detail.value, entry.owned);
  assert.equal(arcadeRankingScore(arcade, entry), entry.owned);
});

test("paint: the field goes out as a short string, the work list stays here", () => {
  const { arcade } = paintRoom(4);
  const sent = publicArcade(arcade);
  assert.equal(sent.cells, undefined, "die Arbeitsliste gehört nicht ins Netzpaket");
  assert.equal(typeof sent.paint, "string");
  assert.match(sent.paint, /^[.0-3]+$/);
  assert.ok(arcade.cells, "auf dem Server bleibt sie");
  assert.ok(JSON.stringify(sent).length < 4000, `das Paket ist ${JSON.stringify(sent).length} Zeichen lang`);
});

test("paint: wrong action and a broken direction are refused", () => {
  const { room, me, arcade } = paintRoom(2);
  assert.equal(handleArcadeInput(room, me, { action: "reel" }).ok, false);
  // Zwischen zwei Eingaben liegt ein Cooldown von 55 ms — der ist hier richtig,
  // weil eine gehaltene Richtung ohnehin stehen bleibt. Im Test muss er raus,
  // sonst prüft die zweite Zeile nur den Cooldown.
  arcade.players[me.id].lastInputAt = 0;
  assert.equal(handleArcadeInput(room, me, { action: "steer", x: "x", y: 0 }).ok, false);
});

// --- Katalog und Regeln dürfen nicht auseinanderlaufen ---------------------
// Der Hilfetext ist für viele Leute die EINZIGE Erklärung, die sie je lesen —
// er steht auf der Startkarte und sonst nirgends. Läuft er den Regeln davon,
// spielt die halbe Runde bewusst falsch. Genau das war beim Messerwurf
// passiert: der Text empfahl die enge Lücke, während die Wertung längst den
// sauberen Wurf belohnte.
//
// Automatisch prüfbar ist nur die Vollständigkeit — dass kein Minispiel ohne
// Text oder Geste ausgeliefert wird und kein Text ohne Minispiel übrig bleibt.
// Ob der Text auch STIMMT, muss beim Regeländern von Hand nachgezogen werden.
test("Katalog: jedes Minispiel hat Titel, Geste und Hilfetext", async () => {
  const { MINIGAME_CATALOG, GESTURES } = await import("../client/src/minigames/catalog.js");

  const serverTypes = MINIGAMES.map((game) => game.type);
  const catalogTypes = MINIGAME_CATALOG.map((game) => game.type);

  assert.deepEqual(
    serverTypes.filter((type) => !catalogTypes.includes(type)), [],
    "Minispiel ohne Katalogeintrag: es startet, erklärt sich aber nicht");
  assert.deepEqual(
    catalogTypes.filter((type) => !serverTypes.includes(type)), [],
    "Katalogeintrag ohne Minispiel: der Text zeigt auf nichts");
  assert.equal(new Set(catalogTypes).size, catalogTypes.length, "doppelter Katalogeintrag");

  MINIGAME_CATALOG.forEach((game) => {
    assert.ok(game.title && game.title.trim().length > 0, `${game.type}: kein Titel`);
    assert.ok(GESTURES[game.gesture], `${game.type}: unbekannte Geste "${game.gesture}"`);
    // Kurze Texte sind hier immer ein Versehen, kein Stil: unter 40 Zeichen
    // passt keine Regel rein, nur eine Umschreibung des Titels.
    assert.ok((game.help || "").trim().length >= 40, `${game.type}: Hilfetext zu dünn`);
  });

  // Die Familie im Katalog muss die des Servers sein — sonst zeigt die
  // Oberfläche das falsche Steuerungsbild.
  MINIGAME_CATALOG.forEach((game) => {
    const template = MINIGAMES.find((candidate) => candidate.type === game.type);
    assert.equal(game.family || undefined, template.arcadeFamily || undefined,
      `${game.type}: Familie im Katalog (${game.family}) passt nicht zum Server (${template.arcadeFamily})`);
  });
});

// --- Kein Klangname darf ins Leere zeigen ---------------------------------
// feedback.sound("…") mit unbekanntem Namen tut einfach NICHTS: kein Fehler,
// keine Warnung, nur Stille. Genau so war die Kreuzung stumm — der Aufruf stand
// seit jeher im Code, der Klang war nie definiert, und niemandem fiel auf, dass
// der einzige Moment mit ausdrücklich eigenem Ton keinen hatte.
test("Klänge: jeder gerufene Name ist auch definiert", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const clientDir = path.join(__dirname, "..", "client", "src");

  const files = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    });
  })(clientDir);

  const feedback = fs.readFileSync(path.join(clientDir, "game", "Feedback.js"), "utf8");
  const defined = new Set([...feedback.matchAll(/^ {6}([a-zA-Z]+):\s*\[/gm)].map((m) => m[1]));
  assert.ok(defined.size > 10, "Klangtabelle nicht gefunden — Muster angepasst?");

  const missing = new Map();
  files.forEach((file) => {
    const source = fs.readFileSync(file, "utf8");
    [...source.matchAll(/sound\("([a-zA-Z]+)"/g)].forEach((match) => {
      if (!defined.has(match[1])) {
        missing.set(match[1], path.relative(clientDir, file));
      }
    });
  });

  assert.deepEqual([...missing.entries()], [],
    "gerufen, aber nie definiert — diese Stellen sind stumm");
});

// --- Geheimnisse dürfen nicht im Netzpaket stehen --------------------------
// Der ganze Arcade-Zustand geht unverändert an jedes Gerät im Raum. Für die
// meisten Minispiele ist das richtig — dort IST der Zustand das, was man sieht.
// Spürsinn ist der erste Fall mit echtem Geheimnis: läge das Versteck im Paket,
// wäre das Spiel mit einem Blick in die Entwicklerkonsole erledigt.
test("Spürsinn: das Versteck verlässt den Server nicht", () => {
  const one = player({ id: "sk1", name: "SK1", color: "#fff" });
  const two = player({ id: "sk2", name: "SK2", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("spuersinn", [one, two], startedAt);

  // Auf dem Server muss es natürlich stehen, sonst könnte niemand werten.
  assert.ok(arcade.secret?.gems?.[one.id], "der Server kennt das Versteck");

  const sent = JSON.stringify(publicArcade(arcade));
  assert.ok(!sent.includes("secret"), "kein Geheimnisfach im Paket");
  assert.ok(!sent.includes("gems"), "keine Verstecke im Paket");

  // Und die Probe aufs Exempel: der Zustand, den ein Gerät bekommt, enthält
  // nirgends die Koordinaten des Verstecks als Paar.
  const gem = arcade.secret.gems[one.id];
  const parsed = JSON.parse(sent);
  assert.equal(parsed.players[one.id].gem, undefined, "der Eintrag trägt kein Versteck");
  assert.ok(gem.x >= 0 && gem.x < SEEK_SIZE && gem.y >= 0 && gem.y < SEEK_SIZE,
    "das Versteck liegt im Feld");

  // Was das Gerät braucht, ist weiterhin da — sonst wäre nichts zu spielen.
  assert.ok(Array.isArray(parsed.players[one.id].probes), "die eigenen Tipps kommen an");
  assert.equal(parsed.size, SEEK_SIZE, "die Feldgrösse kommt an");
});

// --- Die README darf dem Katalog nicht davonlaufen ------------------------
// Die Liste im README wurde von Hand gepflegt und ist dreimal abgedriftet: sie
// führte zuletzt zwei längst gelöschte Minispiele und kannte drei neue nicht,
// und danach blieben bei drei Spielen die Hilfetexte und bei zweien die
// Gestenüberschrift auf einem alten Stand stehen — die Zielgerade stand unter
// "Links/Rechts wischen", obwohl sie längst in jede Richtung gewischt wird.
// Wer die README liest, glaubt sie; das ist die erste Seite des Projekts.
//
// Der erste Anlauf prüfte nur die TITEL, und genau daran ist er vorbeigelaufen.
// Geprüft wird darum jetzt der ganze Abschnitt Zeichen für Zeichen gegen den
// Katalog: Reihenfolge, Gruppen, Überschriften und Hilfetexte.
test("README: der Challenge-Abschnitt steht Wort für Wort im Katalog", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { MINIGAME_CATALOG, GESTURES } = await import("../client/src/minigames/catalog.js");
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

  // Gruppiert nach Geste, in der Reihenfolge, in der die Gesten im Katalog
  // zum ersten Mal vorkommen — damit die README aus dem Katalog FOLGT und
  // nicht umgekehrt.
  const gruppen = new Map();
  for (const game of MINIGAME_CATALOG) {
    if (!gruppen.has(game.gesture)) gruppen.set(game.gesture, []);
    gruppen.get(game.gesture).push(game);
  }
  const erwartet = [...gruppen.entries()]
    .map(([gesture, games]) => {
      const geste = GESTURES[gesture];
      return `### ${geste.icon} ${geste.label}\n\n`
        + games.map((game) => `- **${game.title}:** ${game.help}`).join("\n");
    })
    .join("\n\n") + "\n\n";

  // Der Abschnitt steht zwischen der Challenge-Überschrift und "## Sandbox".
  const start = readme.indexOf("### ", readme.indexOf(`## ${MINIGAME_CATALOG.length} Challenges`));
  const ende = readme.indexOf("## Sandbox");
  assert.ok(start > 0 && ende > start, "Challenge-Abschnitt nicht gefunden");
  assert.equal(readme.slice(start, ende), erwartet,
    "Die Challenge-Liste im README weicht vom Katalog ab — sie wird aus ihm erzeugt, nicht daneben gepflegt");

  // Die Überschrift trägt die Zahl — auch die läuft sonst davon.
  assert.ok(readme.includes(`## ${MINIGAME_CATALOG.length} Challenges`),
    `Überschrift muss "## ${MINIGAME_CATALOG.length} Challenges" lauten`);
});

// Dieselbe Zahl steht an vier weiteren Stellen, und alle vier waren auf einem
// anderen Stand: die README sprach von 30, die package.json von 28, das
// Manifest von 18 — und das Manifest ist der Text, den das Handy beim
// Installieren anzeigt. Eine Zahl, fünf Orte, keiner davon geprüft.
test("Die Anzahl der Challenges stimmt überall, wo sie genannt wird", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { MINIGAME_CATALOG } = await import("../client/src/minigames/catalog.js");
  const wurzel = path.join(__dirname, "..");
  const anzahl = MINIGAME_CATALOG.length;

  const stellen = [
    ["README.md", `${anzahl} touch-optimierten Challenges`],
    ["README.md", `## ${anzahl} Challenges`],
    ["TESTEN-AUF-DEM-HANDY.md", `Alle ${anzahl} Minispiele`],
    ["package.json", `${anzahl} touch-first challenges`],
    ["client/manifest.json", `${anzahl} Touch-Challenges`]
  ];
  for (const [datei, text] of stellen) {
    const inhalt = fs.readFileSync(path.join(wurzel, datei), "utf8");
    assert.ok(inhalt.includes(text),
      `${datei} nennt nicht ${anzahl} Challenges — erwartet: "${text}"`);
  }
});
