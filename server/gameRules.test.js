const test = require("node:test");
const assert = require("node:assert/strict");
const { testRules } = require("./server");

const {
  BOARD_DEFINITIONS,
  FIELD_TYPES,
  GATE_COIN_BONUS,
  MINIGAMES,
  SEEK_SIZE,
  publicArcade,
  updatePlinko,
  PLINKO_BALL_R,
  GOLD_DICE_MIN,
  GOLD_DICE_SPAN,
  applyFieldEffect,

  arcadeRankingScore,
  beginMinigameFinale,
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
  GLIDE_DURATION_MS,
  DIVE_DURATION_MS,
  KNIFE_MIN_GAP_DEG,
  knifeRoundsFor,
  humansInRoom,
  DIVE_MAX_DEPTH,
  DIVE_RISK_MAX,
  diveGain,
  diveRisk,
  diveRiskAt,
  diveStepValue,
  diveBestDepth,
  GLIDE_VY_MAX,
  GLIDE_GATE_EVERY_MS,
  GLIDE_GATE_MAX_STEP,
  GLIDE_GATE_POINTS,
  GLIDE_CENTRE_BONUS,
  GLIDE_STALL_MS,
  buildGlideGates,
  SUMO_RING_RADIUS,
  SUMO_CHARGE_MS,
  SUMO_ZONE,
  SUMO_MIN_CHARGE_MS,
  SUMO_MAX_IMPULSE,
  SUMO_HITS_OUT,
  updateSumoStone,
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
  PAINT_BUMP_RADIUS,
  PAINT_CLAIM_RATE,
  PAINT_STEAL_RATE,
  PAINT_TILE_SECOND_POINTS,
  PAINT_BOOST_MS,
  PAINT_PICKUP_MAX,
  PAINT_DURATION_MS,
  paintIndex,
  paintInside,
  paintClaim,
  paintBrushTiles,
  paintOwnedCount,
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
  // Der Ring ist weiterhin 32 Felder lang; die Abzweigungen hängen dahinter.
  assert.ok(FIELD_TYPES.length >= 32);
  assert.ok(FIELD_TYPES.every((type) => allowed.has(type)));
  assert.deepEqual(
    FIELD_TYPES.slice(0, 32).map((type, index) => type === "gate" ? index : null).filter((index) => index !== null),
    [7, 15, 23, 31]
  );
});

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
      "farbenjagd", "fassrolle", "finishRush", "kanonenflug", "leuchtfolge",
      "lichtwaechter", "messerwurf", "muenzregen", "nagelbrett", "nervenprobe",
      "seilspringen", "sortierband", "spuersinn", "spurmaler", "sumoschubs", "tiefenrausch",
      "trampolin", "turmbau", "zuendstoff"
    ]
  );
});

test("three themed boards share a clear field grammar", () => {
  assert.equal(BOARD_DEFINITIONS.length, 3);
  assert.equal(new Set(BOARD_DEFINITIONS.map((board) => board.id)).size, 3);
  BOARD_DEFINITIONS.forEach((board) => {
    assert.equal(board.ringSize, 32);
    assert.equal(board.zones.length, 4);
    assert.equal(board.fieldTypes.filter((type) => type === "gate").length, 4);

    // Jedes Brett muss echte Entscheidungen anbieten. Vorher war jedes Feld ein
    // Ring mit genau einem Weg weiter — der Würfel bestimmte alles, man selbst
    // nichts. Mindestens zwei Kreuzungen je Brett.
    const junctions = board.routes.filter((routes) => routes.length > 1);
    assert.ok(junctions.length >= 2, `${board.id} braucht mindestens zwei Kreuzungen`);

    // Keine Route darf ins Leere zeigen.
    board.routes.forEach((routes, index) => {
      assert.ok(routes.length >= 1, `Feld ${index} auf ${board.id} hat keinen Weg weiter`);
      routes.forEach((next) => {
        assert.ok(
          Number.isInteger(next) && next >= 0 && next < board.fieldTypes.length,
          `${board.id}: Route ${index} → ${next} zeigt ins Leere`
        );
      });
    });

    // Jede Abkürzung muss auch kürzer sein, sonst ist die Wahl keine — und sie
    // muss auf dem Ring wieder ankommen, sonst läuft man aus dem Brett heraus.
    board.branches.forEach((branch) => {
      assert.ok(branch.saves > 0, `${board.id}: ${branch.label} spart keine Schritte`);
      assert.equal(board.routes[branch.from].length, 2, `${board.id}: ${branch.label} beginnt an keiner Kreuzung`);
      let cursor = branch.fields[0];
      let guard = 0;
      while (cursor >= board.ringSize && guard < 20) { cursor = board.routes[cursor][0]; guard += 1; }
      assert.equal(cursor, branch.to, `${board.id}: ${branch.label} mündet nicht auf ${branch.to}`);
      // Risiko als Gegengewicht zur Ersparnis: ohne Falle wäre die Abkürzung
      // gratis und damit immer richtig.
      assert.ok(
        branch.fields.some((index) => board.fieldTypes[index] === "trap"),
        `${board.id}: ${branch.label} hat kein Risiko`
      );
    });
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

test("movement follows the loop where there is nothing to decide", () => {
  const mossback = getBoard("mossback");
  assert.deepEqual(buildBoardPath(mossback, 4, 1).path, [5]);
  assert.deepEqual(buildBoardPath(mossback, 4, 3).path, [5, 6, 7]);
  // Wraps around the end of the 32-field loop.
  assert.deepEqual(buildBoardPath(mossback, 31, 2).path, [0, 1]);
  // Ohne Kreuzung im Weg bleibt nichts offen.
  assert.equal(buildBoardPath(mossback, 4, 3).pendingAt, null);
});

test("movement stops at a junction and hands the choice to the player", () => {
  const mossback = getBoard("mossback");
  const junction = mossback.branches[0].from;   // Feld 3, „Dickicht"

  // Von Feld 1 aus mit 4 Schritten: Feld 3 ist eine Kreuzung, dort ist Schluss.
  const walk = buildBoardPath(mossback, 1, 4);
  assert.deepEqual(walk.path, [2, 3], "der Zug hält auf der Kreuzung an");
  assert.equal(walk.pendingAt, junction);
  assert.equal(walk.remaining, 2, "die übrigen Schritte bleiben stehen");

  // Route 0 ist der Ring, Route 1 der Zweig.
  const ring = buildBoardPath(mossback, junction, 2, 0);
  assert.deepEqual(ring.path, [4, 5]);
  const branch = buildBoardPath(mossback, junction, 2, 1);
  assert.deepEqual(branch.path, mossback.branches[0].fields, "der Zweig führt durch seine eigenen Felder");

  // Genau AUF der Kreuzung stehen zu bleiben fragt noch nicht — erst der
  // nächste Zug tut das. Sonst käme die Frage zweimal.
  const landsOn = buildBoardPath(mossback, 1, 2);
  assert.deepEqual(landsOn.path, [2, 3]);
  assert.equal(landsOn.pendingAt, null, "wer auf der Kreuzung stehenbleibt, wird nicht gefragt");
});

test("the branch really is the shortcut it claims to be", () => {
  const mossback = getBoard("mossback");
  const branch = mossback.branches[0];
  // Über den Zweig laufen und zählen, wie viele Schritte bis zur Einmündung
  // nötig sind — gegen den Ring gerechnet.
  let cursor = branch.from;
  let steps = 0;
  let route = 1;
  while (cursor !== branch.to && steps < 40) {
    cursor = mossback.routes[cursor][Math.min(route, mossback.routes[cursor].length - 1)];
    route = 0;
    steps += 1;
  }
  assert.equal(cursor, branch.to);
  assert.equal(steps, branch.steps);
  assert.equal(branch.ringSteps - steps, branch.saves);
  assert.ok(steps < branch.ringSteps, "sonst wäre es keine Abkürzung");
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

test("color escape: later rounds warn shorter and offer fewer safe tiles", () => {
  const runner = player({ id: "cg", name: "CG", color: "#fff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("colorEscape", [runner], startedAt);

  const measure = (round) => {
    advanceColorRound(arcade, round, startedAt);
    return {
      warn: arcade.announceMs,
      safe: arcade.grid.filter((color) => color === arcade.targetColor).length
    };
  };

  const first = measure(0);
  const last = measure(arcade.roundCount - 1);

  assert.ok(last.warn < first.warn * 0.6, `die Vorwarnung muss deutlich kürzer werden (${last.warn} von ${first.warn})`);
  assert.ok(last.safe < first.safe, `es müssen weniger sichere Felder werden (${last.safe} von ${first.safe})`);
  assert.ok(last.safe >= 4, "aber nie so wenige, dass vier Mitspielende keinen Platz mehr finden");

  // Die Fallphase darf dabei nicht mitschrumpfen — sonst wäre am Ende gar keine
  // Zeit mehr, den Sturz zu sehen.
  assert.ok(arcade.dropEndMs > arcade.announceMs, "nach der Vorwarnung muss eine Fallphase bleiben");

  // Und die Runde muss immer noch in ihr Zeitfenster passen.
  for (let round = 0; round < arcade.roundCount; round += 1) {
    advanceColorRound(arcade, round, startedAt);
    assert.ok(arcade.dropEndMs <= arcade.roundMs, `Runde ${round} läuft über ihr Fenster hinaus`);
  }
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

test("zielgerade: a shot that has already passed cannot hit someone from behind", () => {
  // Der Schuss war vorher ein WACHSENDES Band ab dem Abschusspunkt statt eines
  // fliegenden Geschosses. Wer von hinten über diesen Punkt lief, während der
  // Schuss noch unterwegs war, wurde nachträglich getroffen — im Spiel sah es
  // so aus, als träfe der Schuss zufällig jemanden hinter einem.
  const shooter = player({ id: "sa", name: "SA", color: "#fff" });
  const behind = player({ id: "sb", name: "SB", color: "#0ff" });
  const startedAt = Date.now() - 100;
  const arcade = createArcadeState("finishRush", [shooter, behind], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 42000, finishing: false };
  const room = { currentMinigame: minigame, players: [shooter, behind] };
  const me = arcade.players[shooter.id];
  const other = arcade.players[behind.id];

  me.lane = 1; other.lane = 1;
  me.progress = 50;
  other.progress = 20;          // deutlich HINTER mir
  me.hasItem = true;
  me.lastInputAt = 0;
  handleArcadeInput(room, shooter, { action: "throw" });

  // Der Schuss fliegt los und ist nach kurzer Zeit weit vorn.
  arcade.shots[0].firedAt = Date.now() - 400;   // 0.4 s * 60 = 24 m voraus
  testRules.updateArcade(room);
  // Gezählt wird die Treffergutschrift des Schützen: `stumbles` steigt auch
  // durch Hindernisse auf der Strecke und würde hier das Falsche messen.
  assert.equal(me.throwsHit || 0, 0, "wer hinten ist, wird vom Schuss nach vorn nicht getroffen");

  // Jetzt läuft der Hintermann über den Abschusspunkt hinaus, während der Schuss
  // noch in der Luft ist. Genau hier schlug der alte Fehler zu.
  other.progress = 62;
  arcade.shots[0].firedAt = Date.now() - 500;
  testRules.updateArcade(room);
  assert.equal(me.throwsHit || 0, 0, "ein längst vorbeigeflogener Schuss darf nicht nachträglich treffen");

  // Gegenprobe: wer WIRKLICH im überstrichenen Stück steht, wird getroffen.
  other.progress = arcade.shots[0].headProgress + 4;
  arcade.shots[0].firedAt = Date.now() - 900;
  testRules.updateArcade(room);
  assert.equal(me.throwsHit, 1, "ein Ziel im Flugweg muss sehr wohl getroffen werden");
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

  // The next player throws onto the existing knife → clash → costs a life.
  arcade.logAngle = (2 * Math.PI) / 180; // 2 degrees, inside the safety gap
  arcade.players[waiting.id].lastInputAt = 0;
  handleArcadeInput(room, waiting, { action: "throw" });
  assert.equal(arcade.players[waiting.id].clashes, 1, "a clash costs a life");
  assert.equal(arcade.players[waiting.id].eliminated, false, "the first clash is not the end");
  assert.equal(arcade.knives.length, 1, "no knife added on a clash");

  // Both have thrown, so the next round starts and the clash victim may retry.
  assert.equal(arcade.round, 1, "a new round begins once everyone has thrown");
  assert.equal(arcade.players[waiting.id].turnDone, false, "the round resets the throwing window");

  // The second clash is the end.
  arcade.activeId = waiting.id;
  arcade.logAngle = (2 * Math.PI) / 180;
  arcade.players[waiting.id].lastInputAt = 0;
  handleArcadeInput(room, waiting, { action: "throw" });
  assert.equal(arcade.players[waiting.id].clashes, 2);
  assert.equal(arcade.players[waiting.id].eliminated, true, "the second clash knocks the thrower out");

  const survivor = arcadeRankingScore(arcade, arcade.players[active.id]);
  const out = arcadeRankingScore(arcade, arcade.players[waiting.id]);
  assert.ok(survivor > out, "survivors outrank the eliminated");
});

test("messerwurf: der sauberere Wurf zählt mehr, nicht der riskantere", () => {
  // Das Spiel verlangt, in freien Raum zu werfen. Die Feinwertung muss in
  // dieselbe Richtung zeigen — vorher belohnte sie die ENGE Lücke, also genau
  // das Gegenteil, und "normal" und "hard" lagen gemessen gleichauf.
  const one = player({ id: "kn1", name: "KN1", color: "#fff" });
  const two = player({ id: "kn2", name: "KN2", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("messerwurf", [one, two], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 46000, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };

  // Zwei Messer stehen schon: eine Lücke von 60 Grad, der grosse Rest 300 Grad.
  const standing = () => [{ angleDeg: 0, playerId: "x" }, { angleDeg: 60, playerId: "x" }];
  const first = arcade.activeId === one.id ? one : two;
  const second = first === one ? two : one;

  // Sauber in die Mitte des grossen Bogens: 210 Grad, also das Bestmögliche.
  arcade.knives = standing();
  arcade.logAngle = (210 * Math.PI) / 180;
  arcade.players[first.id].lastInputAt = 0;
  handleArcadeInput(room, first, { action: "throw" });
  const clean = arcade.players[first.id].precision;

  // Knapp am zweiten Messer vorbei: gerade noch erlaubt, aber schlampig.
  arcade.knives = standing();
  arcade.activeId = second.id;
  arcade.logAngle = (83 * Math.PI) / 180;
  arcade.players[second.id].lastInputAt = 0;
  handleArcadeInput(room, second, { action: "throw" });
  const sloppy = arcade.players[second.id].precision;

  assert.equal(arcade.players[second.id].stuck, 1, "a legal throw still sticks");
  assert.ok(clean > sloppy, `der saubere Wurf zählt mehr (${clean} > ${sloppy})`);
  assert.ok(clean > 0.98, `der bestmögliche Wurf zählt voll (${clean})`);
});

test("messerwurf: die Feinwertung ist reihenfolgeneutral", () => {
  // Die Scheibe füllt sich, der erste Werfer jeder Runde hat strukturell mehr
  // Platz. Gemessen wird darum der Wurf gegen das, was in diesem Augenblick
  // möglich war — der perfekte Wurf auf voller Scheibe zählt genauso viel wie
  // der perfekte Wurf auf leerer.
  const one = player({ id: "kp1", name: "KP1", color: "#fff" });
  const two = player({ id: "kp2", name: "KP2", color: "#0ff" });
  const startedAt = Date.now();
  const arcade = createArcadeState("messerwurf", [one, two], startedAt);
  const minigame = { arcade, scores: {}, startedAt, duration: 46000, finishing: false };
  const room = { currentMinigame: minigame, players: [one, two] };
  const first = arcade.activeId === one.id ? one : two;
  const second = first === one ? two : one;

  // Früh dran: nur ein Messer steht, der grösste Bogen ist fast die ganze Scheibe.
  arcade.knives = [{ angleDeg: 0, playerId: "x" }];
  arcade.logAngle = Math.PI;                       // 180 Grad, genau gegenüber
  arcade.players[first.id].lastInputAt = 0;
  handleArcadeInput(room, first, { action: "throw" });
  const early = arcade.players[first.id].precision;

  // Spät dran: die Scheibe ist voll, der beste Bogen viel kleiner.
  arcade.knives = [0, 40, 80, 120, 160, 200, 260].map((angleDeg) => ({ angleDeg, playerId: "x" }));
  arcade.activeId = second.id;
  arcade.logAngle = (310 * Math.PI) / 180;          // Mitte des 260–360-Bogens
  arcade.players[second.id].lastInputAt = 0;
  handleArcadeInput(room, second, { action: "throw" });
  const late = arcade.players[second.id].precision;

  assert.equal(arcade.players[second.id].stuck, 1, "der späte Wurf steckt");
  assert.ok(Math.abs(early - late) < 0.05,
    `perfekt ist perfekt, egal wann (früh ${early}, spät ${late})`);
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

// Der Sternkauf steht in einem EIGENEN Feld der Landemeldung, nicht in der
// Feldwirkung — weil man den Stern im VORBEIGEHEN kauft und die Feldwirkung zum
// Feld gehört, auf dem man stehenbleibt. Der Client las lange nur die
// Feldwirkung; damit war starGained dort nie wahr, die Sternfeier loeste nie
// aus, und weil der Kauf Muenzen kostet, spielte er den Fehlerklang. Dieser
// Test haelt fest, WO die Nachricht steht.
test("Stern: der Kauf steht in starPass, nicht in der Feldwirkung", () => {
  const brett = getBoard("mossback");
  const stern = brett.starPads[1];
  const kaeufer = boardPlayer({ coins: STAR_PRICE + 5 });
  const room = boardRoom({ starIndex: stern, players: [kaeufer] });
  // Weg fuehrt UEBER das Sternfeld hinweg und endet dahinter.
  const pfad = [stern - 2, stern - 1, stern, stern + 1, stern + 2];
  const ergebnis = resolveStarPurchase(kaeufer, pfad, room);
  assert.ok(ergebnis, "kein Ergebnis — der Stern lag nicht auf dem Weg");
  assert.equal(ergebnis.starGained, true, "starGained fehlt in starPass");
  assert.equal(kaeufer.stars, 1);
  assert.ok(ergebnis.coins < 0, "der Kauf kostet Münzen — genau deshalb darf er nicht wie ein Verlust klingen");

  // Und die Feldwirkung des Zielfelds weiss davon NICHTS. Wer nur sie liest,
  // sieht den Stern nie.
  const wirkung = applyFieldEffect(kaeufer, "normal", room);
  assert.notEqual(wirkung.starGained, true);
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

test("every sold star makes the next one dearer", () => {
  // Fester Preis machte das Spätspiel flach: wer vorn lag, kaufte einfach
  // weiter. Der steigende Preis lässt einen Rückstand aufholbar bleiben.
  const board = getBoard("mossback");
  const buyer = boardPlayer({ coins: 500, position: board.starPads[0] });
  const room = boardRoom({ starIndex: board.starPads[0], players: [buyer] });

  const paid = [];
  for (let round = 0; round < 4; round += 1) {
    buyer.position = room.starIndex;
    const effect = applyFieldEffect(buyer, "star", room);
    assert.equal(effect.starGained, true, `Kauf ${round + 1} muss klappen`);
    paid.push(effect.price);
  }

  assert.equal(paid[0], STAR_PRICE, "der erste Stern kostet den Grundpreis");
  for (let index = 1; index < paid.length; index += 1) {
    assert.ok(paid[index] > paid[index - 1], `Stern ${index + 1} (${paid[index]}) muss teurer sein als ${paid[index - 1]}`);
  }
  assert.equal(buyer.coins, 500 - paid.reduce((sum, price) => sum + price, 0));
  assert.equal(room.starsSold, 4);
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
  hold(true);
  advance(120);
  assert.ok(entry.y < 0.02, "waehrend der Stockung darf Halten nichts bringen");
  advance(GLIDE_STALL_MS + 300);
  assert.ok(entry.y > 0.05, "danach muss der Ballon wieder steigen");
});

test("glide: every gate is reachable from the one before", () => {
  // Ein Tor, das aus der vorherigen Hoehe in der Zeit nicht erreichbar ist,
  // waere nicht schwer, sondern unfair. Aus der Physik gerechnet: mit
  // GLIDE_VY_MAX schafft man in einem Torabstand hoechstens diese Strecke, und
  // Beschleunigen wie Abbremsen kosten davon.
  const reach = (GLIDE_VY_MAX * GLIDE_GATE_EVERY_MS) / 1000;
  for (let seed = 0; seed < 30; seed += 1) {
    const gates = buildGlideGates(seed * 61 + 7, GLIDE_DURATION_MS);
    for (let i = 1; i < gates.length; i += 1) {
      const step = Math.abs(gates[i].y - gates[i - 1].y);
      assert.ok(step <= GLIDE_GATE_MAX_STEP + 1e-9, `Startwert ${seed}, Tor ${i}: Sprung ${step}`);
      assert.ok(step < reach, `Tor ${i} liegt ausserhalb der Reichweite (${step} > ${reach})`);
    }
  }
});

test("glide: no gate sits half outside the shaft", () => {
  for (let seed = 0; seed < 30; seed += 1) {
    const gates = buildGlideGates(seed * 61 + 7, GLIDE_DURATION_MS);
    gates.forEach((gate) => {
      assert.ok(gate.y - gate.gap / 2 >= 0, `Tor ${gate.index} ragt unten raus`);
      assert.ok(gate.y + gate.gap / 2 <= 1, `Tor ${gate.index} ragt oben raus`);
    });
  }
});

test("glide: every gate demands a move, and the course gets tighter", () => {
  const gates = buildGlideGates(467, GLIDE_DURATION_MS);
  assert.ok(gates.length >= 15, `zu wenige Tore: ${gates.length}`);
  for (let i = 1; i < gates.length; i += 1) {
    const step = Math.abs(gates[i].y - gates[i - 1].y);
    assert.ok(step >= gates[i].gap * 0.4, `Tor ${i} steht praktisch still (${step})`);
  }
  assert.ok(gates[gates.length - 1].gap < gates[0].gap, "die Tore muessen enger werden");
  assert.ok(gates[gates.length - 1].at < GLIDE_DURATION_MS, "kein Tor nach dem Abpfiff");
});

test("glide: the course is the same for everyone and deterministic", () => {
  const a = buildGlideGates(99, GLIDE_DURATION_MS);
  const b = buildGlideGates(99, GLIDE_DURATION_MS);
  assert.deepEqual(a, b);
  const room = glideRoom([
    { id: "g1", name: "A", isBot: false },
    { id: "g2", name: "B", isBot: false }
  ]);
  assert.ok(room.arcade.gates.length > 0);
});

test("glide: passing a gate scores, missing it does not", () => {
  const { arcade, entry, advance } = glideRoom();
  const gate = arcade.gates[0];
  entry.y = gate.y;
  entry.vy = 0;
  entry.holding = false;
  // Genau bis kurz hinter das erste Tor laufen lassen und die Hoehe halten.
  const keep = () => { entry.y = gate.y; entry.vy = 0; };
  for (let t = 0; t < gate.at + 200; t += 60) { keep(); advance(60); }
  assert.equal(entry.gatesPassed, 1);
  assert.ok(entry.score >= GLIDE_GATE_POINTS, `Punkte: ${entry.score}`);
  assert.equal(entry.gatesMissed, 0);

  const missed = glideRoom();
  const other = missed.arcade.gates[0];
  const away = other.y > 0.5 ? 0 : 1;
  for (let t = 0; t < other.at + 200; t += 60) {
    missed.entry.y = away;
    missed.entry.vy = 0;
    missed.advance(60);
  }
  assert.equal(missed.entry.gatesPassed, 0);
  assert.equal(missed.entry.gatesMissed, 1);
  assert.equal(missed.entry.score, 0);
});

test("glide: the centre of a gate is worth more than its edge", () => {
  // Sonst waere jeder Durchflug gleich viel wert und die Runde endete
  // reihenweise unentschieden.
  const run = (offsetShare) => {
    const room = glideRoom();
    const gate = room.arcade.gates[0];
    const y = Math.min(1, Math.max(0, gate.y + (gate.gap / 2) * offsetShare));
    for (let t = 0; t < gate.at + 200; t += 60) {
      room.entry.y = y;
      room.entry.vy = 0;
      room.advance(60);
    }
    return room.entry.score;
  };
  assert.ok(run(0) > run(0.9), `Mitte ${run(0)} muss mehr sein als Rand ${run(0.9)}`);
  // Nicht auf den Punkt genau: der Ballon faellt waehrend des Ticks um ein
  // Tausendstel, bevor das Tor abgerechnet wird. Geprueft wird die Regel, nicht
  // die Rundung.
  assert.ok(run(0) >= GLIDE_GATE_POINTS + GLIDE_CENTRE_BONUS - 3, `Mitte gab nur ${run(0)}`);
});

test("glide: gates settle once, not once per tick", () => {
  // Derselbe Fehler wie anderswo schon mehrfach: was pro Tick geprueft wird,
  // haengt an der Tickrate. Ein Tor darf nur EINMAL zaehlen.
  const coarse = glideRoom();
  const fine = glideRoom();
  const gate = coarse.arcade.gates[0];
  for (let t = 0; t < gate.at + 400; t += 200) { coarse.entry.y = gate.y; coarse.entry.vy = 0; coarse.advance(200); }
  for (let t = 0; t < gate.at + 400; t += 30) { fine.entry.y = gate.y; fine.entry.vy = 0; fine.advance(30); }
  assert.equal(coarse.entry.gatesPassed, 1);
  assert.equal(fine.entry.gatesPassed, 1);
  assert.equal(coarse.entry.nextGate, fine.entry.nextGate, "beide muessen genau ein Tor abgerechnet haben");
});

test("glide: the result reports one number and it is the one that ranks", () => {
  const { arcade, entry } = glideRoom();
  entry.score = 640;
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "points");
  assert.equal(detail.value, 640);
  assert.equal(arcadeRankingScore(arcade, entry), 640);
});

test("glide: wrong action is refused", () => {
  const { room, me } = glideRoom();
  assert.equal(handleArcadeInput(room, me, { action: "shoot" }).ok, false);
});

// --- Ergebnistafel ---------------------------------------------------------

test("result: only everyone together can skip the board", () => {
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

test("knife: the disc can actually hold every knife that gets thrown", () => {
  // Bei 360 Grad und 22 Grad Mindestabstand passen rechnerisch 16 Messer auf
  // die Scheibe, in der Praxis eher zwölf. Mit acht festen Runden landeten bei
  // vier Personen 32 dort — das Spiel war mathematisch nicht zu überleben, und
  // gemessen flogen in JEDER Partie alle raus. Gewonnen hatte, wer zufällig
  // zuletzt ausschied.
  const theoretical = Math.floor(360 / KNIFE_MIN_GAP_DEG);
  for (let count = 2; count <= 4; count += 1) {
    const total = knifeRoundsFor(count) * count;
    assert.ok(total <= theoretical,
      `${count} Personen werfen ${total} Messer, es passen aber nur ${theoretical}`);
    // Und es muss auch genug zu tun geben: unter drei Würfen je Person ist es
    // kein Spiel mehr, sondern eine Stichprobe.
    assert.ok(knifeRoundsFor(count) >= 3, `${count} Personen bekommen nur ${knifeRoundsFor(count)} Würfe`);
  }
});

test("knife: fewer players means more throws each", () => {
  assert.ok(knifeRoundsFor(2) > knifeRoundsFor(4));
  assert.ok(knifeRoundsFor(3) >= knifeRoundsFor(4));
});

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
  // Legt den Stein in Reichweite des Spielers, damit ein Stoss ihn erwischt.
  const stoneAt = (player, reach, towards = true) => {
    const e = arcade.players[player.id];
    arcade.stone.x = e.spotX * SUMO_RING_RADIUS * reach;
    arcade.stone.y = e.spotY * SUMO_RING_RADIUS * reach;
    const sign = towards ? 1 : -1;
    arcade.stone.vx = e.spotX * sign * 0.9;
    arcade.stone.vy = e.spotY * sign * 0.9;
  };
  // Lädt für `heldMs` auf und lässt dann los.
  const chargeAndShove = (player, heldMs) => {
    const entry = arcade.players[player.id];
    entry.recoverUntil = 0;
    send(player, { action: "charge" });
    entry.chargeStart = Date.now() - heldMs;
    return send(player, { action: "shove" });
  };
  return { room, players, arcade, minigame, send, stoneAt, chargeAndShove };
}

test("sumo: players start evenly spread on the ring", () => {
  const { players, arcade } = sumoRoom(4);
  players.forEach((p) => {
    const e = arcade.players[p.id];
    assert.ok(Math.abs(Math.hypot(e.spotX, e.spotY) - 1) < 1e-9, "spot must sit on the unit circle");
    assert.equal(e.hits, 0);
    assert.equal(e.eliminated, false);
  });
  const spots = players.map((p) => `${arcade.players[p.id].spotX.toFixed(3)},${arcade.players[p.id].spotY.toFixed(3)}`);
  assert.equal(new Set(spots).size, 4);
});

test("sumo: nobody is a structural sink — the ring turns at different speeds", () => {
  // Bei festen Plätzen zeigt die Summe der Stossrichtungen von drei Leuten
  // zwangsläufig auf den vierten. Ohne Absicht wirkte das wie Absicht. Liefen
  // alle gleich schnell um, drehte sich nur die Welt und die Abstände blieben —
  // die Senke bliebe damit, wo sie war.
  const { players, arcade } = sumoRoom(4);
  const rates = players.map((p) => arcade.players[p.id].orbit);
  assert.equal(new Set(rates).size, 4, "jede Person muss anders schnell umlaufen");
  rates.forEach((rate) => assert.ok(rate > 0));
});

test("sumo: the stone is never at rest at the start", () => {
  // Lag er in der Mitte, hatte ihn niemand im eigenen Viertel, also stiess
  // niemand, also blieb er liegen — gemessen kam so eine ganze Runde ohne einen
  // einzigen Stoss zustande.
  const { arcade } = sumoRoom(4);
  assert.ok(Math.hypot(arcade.stone.vx, arcade.stone.vy) > 0.1, "der Stein muss anrollen");
});

test("sumo: a shove only bites inside your own quarter", () => {
  // DIE zentrale Regel. Vorher schob jeder Stoss den Stein vom eigenen Platz
  // weg — er war damit Angriff und Verteidigung zugleich, ohne Zielkonflikt,
  // und Dauerdrücken war die beste Antwort auf alles.
  const near = sumoRoom(4);
  near.stoneAt(near.players[0], SUMO_ZONE + 0.2);
  const before = Math.hypot(near.arcade.stone.vx, near.arcade.stone.vy);
  near.chargeAndShove(near.players[0], SUMO_CHARGE_MS);
  assert.equal(near.arcade.players[near.players[0].id].shoves, 1);
  assert.ok(Math.hypot(near.arcade.stone.vx, near.arcade.stone.vy) !== before);

  const far = sumoRoom(4);
  far.stoneAt(far.players[0], SUMO_ZONE - 0.2);
  const stale = { vx: far.arcade.stone.vx, vy: far.arcade.stone.vy };
  far.chargeAndShove(far.players[0], SUMO_CHARGE_MS);
  const e = far.arcade.players[far.players[0].id];
  assert.equal(e.shoves, 0, "ein Stoss ins Leere darf den Stein nicht bewegen");
  assert.equal(e.whiffs, 1);
  assert.equal(far.arcade.stone.vx, stale.vx);
  assert.equal(far.arcade.stone.vy, stale.vy);
});

test("sumo: a whiff costs the swing time, and that is when you are open", () => {
  const { players, arcade, stoneAt, chargeAndShove, send } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];
  stoneAt(me, SUMO_ZONE - 0.2);
  chargeAndShove(me, SUMO_CHARGE_MS);
  assert.ok(e.recoverUntil > Date.now(), "nach einem Fehlgriff holt man aus");
  send(me, { action: "charge" });
  assert.equal(e.chargeStart, null, "und kann in der Zeit nicht laden");
});

test("sumo: a full charge shoves the stone away from the shover", () => {
  const { players, arcade, stoneAt, chargeAndShove } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];
  stoneAt(me, SUMO_ZONE + 0.2);
  arcade.stone.vx = 0;
  arcade.stone.vy = 0;
  chargeAndShove(me, SUMO_CHARGE_MS);
  assert.ok(arcade.stone.vx * e.spotX + arcade.stone.vy * e.spotY < 0, "stone must move away from the shover");
  assert.equal(e.shoves, 1);
  assert.equal(e.lastShove.whiffed, undefined);
});

test("sumo: a counter against the rolling stone beats shoving it from behind", () => {
  const impulseWith = (towards) => {
    const { players, arcade, stoneAt, chargeAndShove } = sumoRoom(4);
    const me = players[0];
    stoneAt(me, SUMO_ZONE + 0.2, towards);
    const before = { vx: arcade.stone.vx, vy: arcade.stone.vy };
    chargeAndShove(me, SUMO_CHARGE_MS);
    return Math.hypot(arcade.stone.vx - before.vx, arcade.stone.vy - before.vy);
  };
  const counter = impulseWith(true);
  const chase = impulseWith(false);
  assert.ok(counter > chase * 1.5, `Konter muss deutlich mehr tragen (${counter} gegen ${chase})`);
});

test("sumo: a longer charge shoves harder", () => {
  const run = (share) => {
    const room = sumoRoom(4);
    room.stoneAt(room.players[0], SUMO_ZONE + 0.2);
    room.arcade.stone.vx = 0;
    room.arcade.stone.vy = 0;
    room.chargeAndShove(room.players[0], SUMO_CHARGE_MS * share);
    return Math.hypot(room.arcade.stone.vx, room.arcade.stone.vy);
  };
  assert.ok(run(1) > run(0.3) * 2, "volle Kraft muss klar mehr tragen");
});

test("sumo: holding is free — it IS the defence", () => {
  // Früher rutschte man beim Überladen aus. Das machte Abwarten unmöglich und
  // zwang alle in einen Dauertakt aus Laden und Danebenstossen.
  const { players, arcade, stoneAt, chargeAndShove } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];
  stoneAt(me, SUMO_ZONE + 0.2);
  chargeAndShove(me, SUMO_CHARGE_MS * 6);
  assert.equal(e.shoves, 1, "ein langer Halt muss trotzdem stossen");
  assert.equal(e.whiffs, 0);
});

test("sumo: a mere tap does nothing", () => {
  const { players, arcade, stoneAt, chargeAndShove } = sumoRoom(4);
  const e = arcade.players[players[0].id];
  stoneAt(players[0], SUMO_ZONE + 0.2);
  const before = { vx: arcade.stone.vx, vy: arcade.stone.vy };
  chargeAndShove(players[0], SUMO_MIN_CHARGE_MS - 20);
  assert.equal(e.shoves, 0);
  assert.equal(e.whiffs, 0);
  assert.equal(arcade.stone.vx, before.vx);
});

test("sumo: the stone leaving the ring hits the player it rolled toward", () => {
  const { room, players, arcade, minigame } = sumoRoom(4);
  const target = players[2];
  const t = arcade.players[target.id];
  arcade.stone.x = t.spotX * (SUMO_RING_RADIUS - 0.02);
  arcade.stone.y = t.spotY * (SUMO_RING_RADIUS - 0.02);
  arcade.stone.vx = t.spotX * 2;
  arcade.stone.vy = t.spotY * 2;

  updateSumoStone(room, minigame, arcade, 0.1, Date.now());
  assert.equal(t.hits, 1, "the player in the exit direction takes the hit");
  players.filter((p) => p.id !== target.id).forEach((p) => {
    assert.equal(arcade.players[p.id].hits, 0, "nobody else may be hit");
  });
  // Und der Stein rollt sofort wieder los, statt liegen zu bleiben.
  assert.ok(Math.hypot(arcade.stone.vx, arcade.stone.vy) > 0.1);
});

test("sumo: enough hits eliminate a player", () => {
  const { room, players, arcade, minigame } = sumoRoom(4);
  const victim = players[1];
  const v = arcade.players[victim.id];
  for (let i = 0; i < SUMO_HITS_OUT; i += 1) {
    // Der Ring läuft um, also wird die Position jedes Mal neu gelesen.
    arcade.stone.x = v.spotX * (SUMO_RING_RADIUS + 0.05);
    arcade.stone.y = v.spotY * (SUMO_RING_RADIUS + 0.05);
    updateSumoStone(room, minigame, arcade, 0.01, Date.now());
  }
  assert.equal(v.hits, SUMO_HITS_OUT);
  assert.equal(v.eliminated, true);
});

test("sumo: an eliminated player can no longer shove", () => {
  const { players, arcade, stoneAt, chargeAndShove } = sumoRoom(4);
  const out = players[0];
  stoneAt(out, SUMO_ZONE + 0.2);
  const before = { vx: arcade.stone.vx, vy: arcade.stone.vy };
  arcade.players[out.id].eliminated = true;
  chargeAndShove(out, SUMO_CHARGE_MS);
  assert.equal(arcade.stone.vx, before.vx, "an eliminated player must not affect the stone");
});

test("sumo: the stone keeps rolling long enough to be seen coming", () => {
  // Mit zu viel Reibung war der Stein nach einem Stoss sofort wieder still, und
  // wer getroffen wurde, hatte das nicht kommen sehen können.
  const { room, arcade, minigame } = sumoRoom(4);
  arcade.stone.x = 0;
  arcade.stone.y = 0;
  arcade.stone.vx = 0.9;
  arcade.stone.vy = 0;
  for (let i = 0; i < 10; i += 1) updateSumoStone(room, minigame, arcade, 0.05, Date.now());
  assert.ok(Math.hypot(arcade.stone.vx, arcade.stone.vy) > 0.4, "nach einer halben Sekunde muss er noch rollen");
});

test("sumo: surviving outranks being eliminated", () => {
  const { room, players, arcade, minigame } = sumoRoom(4);
  const out = arcade.players[players[0].id];
  out.eliminated = true;
  out.eliminatedMs = 12000;
  out.hits = SUMO_HITS_OUT;
  const alive = arcade.players[players[1].id];
  assert.ok(arcadeRankingScore(arcade, alive) > arcadeRankingScore(arcade, out),
    "a player still standing must rank higher");
});

test("sumo: the result reports one number and it is the one that ranks", () => {
  const { arcade, players } = sumoRoom(4);
  const a = arcade.players[players[0].id];
  const b = arcade.players[players[1].id];
  a.blocks = 7;
  b.blocks = 3;
  assert.equal(arcadeResultDetail(arcade, a).kind, "points");
  assert.equal(arcadeResultDetail(arcade, a).value, 7);
  assert.ok(arcadeRankingScore(arcade, a) > arcadeRankingScore(arcade, b),
    "wer mehr abgewehrt hat, muss vorne liegen");
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

test("sumo: a duplicate charge mid-hold does not reset the meter", () => {
  const { players, arcade, send } = sumoRoom(4);
  const me = players[0];
  const e = arcade.players[me.id];
  send(me, { action: "charge" });
  e.chargeStart = Date.now() - 400;          // 400 ms geladen
  const mid = e.chargeStart;
  send(me, { action: "charge" });             // doppeltes Drücken
  assert.equal(e.chargeStart, mid, "an in-progress charge must be left alone");
});

test("sumo: a charge immediately followed by a shove clears the charge", () => {
  // Regression: ein Eingabe-Cooldown blockte das unmittelbar folgende `shove`,
  // sodass der Ladezeitstempel hängen blieb.
  const players = [{ id: "solo", name: "Solo", isBot: false }];
  const startedAt = Date.now() - 1000;
  const arcade = createArcadeState("sumoschubs", players, startedAt);
  const minigame = { id: 1, type: "sumoschubs", startedAt, duration: 40000, arcade, scores: {}, lastInputAt: {} };
  const room = { currentMinigame: minigame, players };
  const me = players[0];
  const e = arcade.players[me.id];

  handleArcadeInput(room, me, { action: "charge" });
  handleArcadeInput(room, me, { action: "shove" });
  assert.equal(e.chargeStart, null, "the shove has to be processed, not swallowed");
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
  const place = (player, col, row) => {
    const state = arcade.players[player.id];
    state.px = col + 0.5;
    state.py = row + 0.5;
    state.vx = 0;
    state.vy = 0;
  };
  return { room, players, me, arcade, entry, minigame, advance, steer, place };
}

test("paint: the field is one shared grid and everyone starts in a corner", () => {
  const { arcade, players } = paintRoom(4);
  assert.equal(arcade.grid.length, PAINT_COLS * PAINT_ROWS);
  // Jeder beginnt mit genau einem Feld, und keine zwei teilen sich einen Start.
  const owners = players.map((player) => paintOwnedCount(arcade, player.id));
  assert.deepEqual(owners, [1, 1, 1, 1]);
  const spots = new Set(players.map((player) => {
    const state = arcade.players[player.id];
    return `${Math.floor(state.px)},${Math.floor(state.py)}`;
  }));
  assert.equal(spots.size, 4, "starting corners have to be distinct");
});

test("paint: a free tile has to be worked on before it is yours", () => {
  const { arcade, players, entry } = paintRoom(2);
  // Ein Bruchteil der nötigen Zeit reicht nicht — genau das war der Umbau: mit
  // sofortigem Umfärben war das Feld nach vier Sekunden voll und danach nur noch
  // Geflacker.
  const short = 0.4 / PAINT_CLAIM_RATE;
  assert.equal(paintClaim(arcade, entry, 2, 4, players[0].id, short), "claiming");
  assert.equal(paintOwnedCount(arcade, players[0].id), 1, "not yet mine");
  assert.equal(paintClaim(arcade, entry, 2, 4, players[0].id, 1 / PAINT_CLAIM_RATE), "claimed");
  assert.equal(paintOwnedCount(arcade, players[0].id), 2);

  // Nochmals darauf: es ist schon meins, es gibt nichts zu holen.
  assert.equal(paintClaim(arcade, entry, 2, 4, players[0].id, 1), "mine");
  assert.equal(entry.claimed, 1, "topping up my own tile must not count again");
});

test("paint: one pass over a rival tile takes it — no second lap", () => {
  const { arcade, players, entry } = paintRoom(2);
  const other = arcade.players[players[1].id];
  const full = 1 / PAINT_CLAIM_RATE;
  paintClaim(arcade, entry, 2, 4, players[0].id, full);
  assert.equal(paintOwnedCount(arcade, players[0].id), 2);

  // Angefangen zählt noch nicht — man muss schon drüberbleiben.
  assert.equal(paintClaim(arcade, other, 2, 4, players[1].id, full * 0.3), "eroding");
  assert.equal(paintOwnedCount(arcade, players[1].id), 1, "eroding alone gains nothing");

  // Aber EIN durchgezogener Strich reicht. Vorher wurde das Feld dabei nur
  // neutral und man musste ein zweites Mal darüber — das fühlte sich an, als
  // würde das Malen nicht wirken.
  const rest = (1 / PAINT_STEAL_RATE) * full;
  assert.equal(paintClaim(arcade, other, 2, 4, players[1].id, rest), "claimed");
  assert.equal(paintOwnedCount(arcade, players[1].id), 2, "das Feld gehört jetzt ihm");
  assert.equal(paintOwnedCount(arcade, players[0].id), 1, "und mir nicht mehr");
});

test("paint: a rival tile still costs more than an empty one", () => {
  // Sonst wäre Angriff immer richtig und die freie Fläche wertlos.
  const step = 0.02;
  // Ein Feld nehmen, das beim Start wirklich niemandem gehört.
  const free = paintRoom(2);
  const spot = free.arcade.grid.findIndex((owner) => !owner);
  const col = spot % PAINT_COLS;
  const row = Math.floor(spot / PAINT_COLS);
  let freeSteps = 0;
  while (paintClaim(free.arcade, free.entry, col, row, free.players[0].id, step) !== "claimed" && freeSteps < 500) freeSteps += 1;

  const taken = paintRoom(2);
  const rival = taken.arcade.players[taken.players[1].id];
  paintClaim(taken.arcade, taken.entry, col, row, taken.players[0].id, 1);
  let stealSteps = 0;
  while (paintClaim(taken.arcade, rival, col, row, taken.players[1].id, step) !== "claimed" && stealSteps < 500) stealSteps += 1;

  assert.ok(stealSteps > freeSteps, `Übermalen (${stealSteps}) muss länger dauern als ein freies Feld (${freeSteps})`);
});

test("paint: the grid edges cannot be painted past", () => {
  const { arcade, entry, players } = paintRoom(2);
  assert.equal(paintClaim(arcade, entry, -1, 0, players[0].id, 1), "outside");
  assert.equal(paintClaim(arcade, entry, PAINT_COLS, 0, players[0].id, 1), "outside");
  assert.equal(paintClaim(arcade, entry, 0, PAINT_ROWS, players[0].id, 1), "outside");
  assert.equal(paintInside(0, 0), true);
  assert.equal(paintInside(PAINT_COLS - 1, PAINT_ROWS - 1), true);
});

test("paint: the wide roller covers a cross, the normal brush one tile", () => {
  assert.deepEqual(paintBrushTiles(3, 4, false), [[3, 4]]);
  const wide = paintBrushTiles(3, 4, true);
  assert.equal(wide.length, 5, "the roller has to take the four neighbours along");
  assert.ok(wide.some(([c, r]) => c === 2 && r === 4));
  assert.ok(wide.some(([c, r]) => c === 3 && r === 5));
});

test("paint: steering moves the kin and paints its trail", () => {
  const { entry, advance, steer, place } = paintRoom(2);
  place({ id: "c1" }, 1, 4);
  steer(1, 0);
  const startX = entry.px;
  advance(900);
  assert.ok(entry.px > startX + 0.5, `the kin barely moved: ${startX} → ${entry.px}`);
  assert.ok(entry.owned > 1, "driving across the field has to paint it");
});

test("paint: only the direction counts, not an oversized stick", () => {
  const { entry, steer } = paintRoom(2);
  steer(40, 0);
  assert.ok(Math.abs(entry.dirX) <= 1 + 1e-9, `direction was ${entry.dirX}`);
  steer(3, 4);
  assert.ok(Math.hypot(entry.dirX, entry.dirY) <= 1 + 1e-9, "a long vector has to be normalised");
});

test("paint: the kin stays on the field", () => {
  const { entry, advance, steer } = paintRoom(2);
  steer(-1, -1);
  advance(4000);
  assert.ok(entry.px >= 0 && entry.px <= PAINT_COLS, `x left the field: ${entry.px}`);
  assert.ok(entry.py >= 0 && entry.py <= PAINT_ROWS, `y left the field: ${entry.py}`);
  steer(1, 1);
  advance(6000);
  assert.ok(entry.px <= PAINT_COLS && entry.py <= PAINT_ROWS);
});

test("paint: two kins in the same spot push each other apart", () => {
  const { arcade, players, advance, place } = paintRoom(2);
  place(players[0], 3, 4);
  place(players[1], 3, 4);
  const one = arcade.players[players[0].id];
  const two = arcade.players[players[1].id];
  // Minimal versetzt, damit es eine Richtung gibt.
  two.px += 0.05;
  advance(300);
  const dist = Math.hypot(two.px - one.px, two.py - one.py);
  assert.ok(dist > 0.2, `they stayed on top of each other: ${dist}`);
  assert.ok(one.bumps > 0 && two.bumps > 0, "the bump has to be recorded for both");
});

test("paint: a roller widens the brush for a while, then wears off", () => {
  const { arcade, entry, players, advance, place } = paintRoom(2);
  arcade.pickups = [{ id: 99, col: 3, row: 4 }];
  place(players[0], 3, 4);
  advance(120);
  assert.equal(entry.wide, true, "walking onto the roller has to pick it up");
  assert.equal(arcade.pickups.length, 0, "and take it off the field");
  // Nach der Laufzeit ist die Rolle weg.
  advance(PAINT_BOOST_MS + 300);
  assert.equal(entry.wide, false, "the roller has to wear off");
});

test("paint: never more than two rollers lie around", () => {
  const { arcade, advance } = paintRoom(2);
  advance(30000);
  assert.ok(arcade.pickups.length <= PAINT_PICKUP_MAX, `${arcade.pickups.length} rollers on the field`);
});

test("paint: the score is area over TIME, not the final snapshot", () => {
  // Der Kern des Umbaus: gewertet wird, wie lange man wie viel gehalten hat.
  // Vorher entschied der Stand im letzten Tick — bei einem Feld, das mehrmals
  // pro Sekunde die Farbe wechselt, war das ein Münzwurf.
  const { entry, players, advance, steer, place } = paintRoom(2);
  place(players[0], 1, 4);
  steer(0, 1);
  advance(1500);
  assert.ok(entry.tileSeconds > 0, "holding tiles has to accumulate");
  assert.equal(entry.score, Math.round(entry.tileSeconds * PAINT_TILE_SECOND_POINTS));

  // Alles verlieren senkt den STAND, aber nicht das schon Verdiente.
  const banked = entry.score;
  const held = entry.owned;
  assert.ok(held > 0);
  advance(600);
  assert.ok(entry.score >= banked, "what was earned cannot be taken away again");
});

test("paint: the result reports one number and it is the one that ranks", () => {
  const { arcade, entry, advance, steer, players, place } = paintRoom(2);
  place(players[0], 1, 4);
  steer(1, 0);
  advance(900);
  const detail = arcadeResultDetail(arcade, entry);
  assert.equal(detail.kind, "points");
  assert.equal(detail.value, Math.round(entry.score));
  assert.equal(arcadeRankingScore(arcade, entry), Math.round(entry.score));
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

// --- Würfel-Items: keines darf das andere schlucken -----------------------
// Der Stern wird auch beim VORBEIGEHEN gekauft, es zählt also "mindestens so
// weit" und nicht "genau". Damit lassen sich die beiden Würfel-Items direkt
// vergleichen: für jede Sternentfernung gewinnt, wer sie eher erreicht.
//
// Mit 7–9 war der Goldwürfel bei JEDER Entfernung besser, die einer von beiden
// überhaupt schafft — höherer Schnitt, höherer Boden, und selbst bei neun
// Feldern noch die bessere Chance. Eines von fünf Items war Ausschuss.
test("Items: Gold- und Doppelwürfel tauschen die Rollen, keiner dominiert", () => {
  const reachGold = (need) => {
    let hits = 0;
    for (let face = 0; face < GOLD_DICE_SPAN; face += 1) {
      if (GOLD_DICE_MIN + face >= need) hits += 1;
    }
    return hits / GOLD_DICE_SPAN;
  };
  const reachDouble = (need) => {
    let hits = 0;
    for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 6; b += 1) if (a + b >= need) hits += 1;
    return hits / 36;
  };

  // Gleicher Schnitt: keiner ist schlicht der stärkere Würfel.
  const meanGold = GOLD_DICE_MIN + (GOLD_DICE_SPAN - 1) / 2;
  assert.equal(meanGold, 7, "Goldwürfel im Schnitt 7");
  assert.equal(reachDouble(2), 1, "zwei Würfel schaffen immer mindestens 2");

  // Es muss eine Entfernung geben, bei der Gold führt, und eine, bei der der
  // Doppelwürfel führt. Sonst ist eines der beiden Items überflüssig.
  const goldAhead = [];
  const doubleAhead = [];
  for (let need = 1; need <= 12; need += 1) {
    const gold = reachGold(need);
    const dbl = reachDouble(need);
    if (gold > dbl) goldAhead.push(need);
    if (dbl > gold) doubleAhead.push(need);
  }
  assert.ok(goldAhead.length > 0, "der Goldwürfel muss irgendwo vorne liegen");
  assert.ok(doubleAhead.length > 0,
    `der Doppelwürfel muss irgendwo vorne liegen — Gold führt bei ${goldAhead.join(",")}`);

  // Und der Wechsel muss sauber sein: erst Gold, dann Doppel, nicht kreuz und
  // quer. Sonst kann kein Mensch die Entscheidung am Tisch treffen.
  assert.ok(Math.max(...goldAhead) < Math.min(...doubleAhead),
    `Gold bis ${Math.max(...goldAhead)}, Doppel ab ${Math.min(...doubleAhead)}`);
});

test("Items: jedes hat Name, Symbol und Hilfetext", () => {
  assert.ok(ITEM_DEFINITIONS.length >= 4, "zu wenige Items für echte Entscheidungen");
  ITEM_DEFINITIONS.forEach((item) => {
    assert.ok(item.id && item.name && item.icon, `${item.id}: unvollständig`);
    assert.ok((item.help || "").trim().length >= 20, `${item.id}: Hilfetext zu dünn`);
  });
  assert.equal(new Set(ITEM_DEFINITIONS.map((i) => i.id)).size, ITEM_DEFINITIONS.length, "doppelte Item-Id");
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

// --- Schlusstabelle und Sieger müssen dieselbe Reihenfolge meinen ----------
// Der Server kürt nach compareStanding: Sterne zuerst, Münzen nur bei
// Gleichstand. Die Schlusstabelle im Browser sortierte allein nach Münzen und
// konnte damit dem Sieger widersprechen, den sie im Banner darüber gerade
// genannt hatte.
test("Schlusstabelle: der Browser sortiert wie der Server wertet", async () => {
  const { sortByStanding } = await import("../client/src/game/GameState.js");

  const field = [
    { id: "a", name: "A", stars: 0, coins: 90 },
    { id: "b", name: "B", stars: 3, coins: 12 },
    { id: "c", name: "C", stars: 1, coins: 70 },
    { id: "d", name: "D", stars: 3, coins: 40 }
  ];

  const fromServer = [...field].sort(compareStanding).map((player) => player.id);
  const fromClient = sortByStanding(field).map((player) => player.id);
  assert.deepEqual(fromClient, fromServer,
    "die Tabelle im Browser muss dieselbe Rangfolge zeigen wie die Wertung");

  // Und der konkrete Fall, der vorher schiefging: viele Münzen schlagen keinen
  // einzigen Stern. B und D haben beide drei Sterne, dann entscheidet das Geld
  // — D führt, B ist zweiter, und der Millionär ohne Stern bleibt letzter.
  assert.deepEqual(fromClient, ["d", "b", "c", "a"],
    "Sterne zuerst, Münzen nur bei Gleichstand");
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
// Die Liste im README wurde von Hand gepflegt und ist zweimal abgedriftet: sie
// führte zuletzt zwei längst gelöschte Minispiele und kannte drei neue nicht.
// Wer sie liest, glaubt sie — das ist die erste Seite des Projekts.
test("README: jedes Minispiel aus dem Katalog steht drin, und keines zu viel", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { MINIGAME_CATALOG } = await import("../client/src/minigames/catalog.js");
  const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

  const fehlend = MINIGAME_CATALOG
    .map((game) => game.title)
    .filter((title) => !readme.includes(`**${title}:**`));
  assert.deepEqual(fehlend, [], "Minispiele ohne Eintrag in der README");

  // Und andersherum: ein Eintrag, den es nicht mehr gibt. Die Liste steht
  // zwischen der Überschrift "## 30 Challenges" und "## Sandbox".
  const start = readme.indexOf("## 30 Challenges");
  const ende = readme.indexOf("## Sandbox");
  assert.ok(start > 0 && ende > start, "Challenge-Abschnitt nicht gefunden");
  const titel = [...readme.slice(start, ende).matchAll(/^- \*\*(.+?):\*\*/gm)].map((m) => m[1]);
  const bekannt = new Set(MINIGAME_CATALOG.map((game) => game.title));
  assert.deepEqual(titel.filter((t) => !bekannt.has(t)), [],
    "README nennt Minispiele, die es nicht mehr gibt");
  assert.equal(titel.length, MINIGAME_CATALOG.length, "Anzahl stimmt nicht");

  // Die Überschrift trägt die Zahl — auch die läuft sonst davon.
  assert.ok(readme.includes(`## ${MINIGAME_CATALOG.length} Challenges`),
    `Überschrift muss "## ${MINIGAME_CATALOG.length} Challenges" lauten`);
});
