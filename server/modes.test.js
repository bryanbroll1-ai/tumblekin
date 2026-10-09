const test = require("node:test");
const assert = require("node:assert/strict");
const modes = require("./modes");
const { testRules } = require("./server");

const ALL = testRules.MINIGAMES.map((game) => game.type);

function players(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `P${index}` }));
}

// Eine Runde mit festen Punktzahlen werten: scores[i] gehört zu Spieler i.
function round(match, list, scores) {
  return modes.scoreRound(match, list, list.map((player, index) => ({ playerId: player.id, score: scores[index] })));
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// --- Punkte ---------------------------------------------------------------

test("Punkte: der Letzte bekommt nichts, jeder Platz darüber einen mehr", () => {
  assert.deepEqual([1, 2, 3, 4].map((place) => modes.placementPoints(place, 4)), [3, 2, 1, 0]);
  assert.deepEqual([1, 2, 3].map((place) => modes.placementPoints(place, 3)), [2, 1, 0]);
  assert.deepEqual([1, 2].map((place) => modes.placementPoints(place, 2)), [1, 0]);
});

test("Punkte: Gleichstand teilt den besseren Platz", () => {
  const list = players(4);
  const match = modes.createMatch("marathon", modes.defaultSettings(), list, ALL, seeded(1));
  const outcome = round(match, list, [50, 50, 10, 0]);
  assert.equal(outcome.get("p0").place, 1);
  assert.equal(outcome.get("p1").place, 1);
  assert.equal(outcome.get("p2").place, 3);
  assert.equal(outcome.get("p0").points, 3);
  assert.equal(outcome.get("p1").points, 3);
  assert.equal(outcome.get("p2").points, 1);
  assert.equal(outcome.get("p3").points, 0);
  // Beide Ersten bekommen einen Rundensieg.
  assert.equal(list[0].wins, 1);
  assert.equal(list[1].wins, 1);
});

test("Punkte: alle gleichauf heisst alle Erster", () => {
  const list = players(3);
  const match = modes.createMatch("marathon", modes.defaultSettings(), list, ALL, seeded(2));
  const outcome = round(match, list, [7, 7, 7]);
  list.forEach((player) => assert.equal(outcome.get(player.id).place, 1));
});

// --- Spielliste -------------------------------------------------------------

test("Spielliste: ein Marathon wiederholt kein Spiel, solange der Pool reicht", () => {
  for (const length of modes.MARATHON_LENGTHS) {
    const match = modes.createMatch("marathon", { ...modes.defaultSettings(), length }, players(4), ALL, seeded(length));
    assert.equal(match.playlist.length, length);
    assert.equal(new Set(match.playlist).size, length, `Marathon ${length} hat Doppelte`);
    match.playlist.forEach((type) => assert.ok(ALL.includes(type)));
  }
});

test("Spielliste: eine eigene Auswahl wird eingehalten und nie direkt wiederholt", () => {
  const pool = ALL.slice(0, 3);
  const settings = modes.mergeSettings(modes.defaultSettings(), { pool, length: 15 }, ALL);
  const match = modes.createMatch("marathon", settings, players(4), ALL, seeded(9));
  assert.equal(match.playlist.length, 15);
  match.playlist.forEach((type) => assert.ok(pool.includes(type), `${type} ist nicht ausgewählt`));
  for (let i = 1; i < match.playlist.length; i += 1) {
    assert.notEqual(match.playlist[i], match.playlist[i - 1], `Spiel ${i} wiederholt das vorige`);
  }
});

test("Spielliste: Punktejagd und K.O. gehen nie aus", () => {
  for (const mode of ["hunt", "knockout"]) {
    const match = modes.createMatch(mode, modes.defaultSettings(), players(4), ALL, seeded(4));
    for (let i = 0; i < 60; i += 1) {
      const type = modes.nextGame(match, seeded(i));
      assert.ok(ALL.includes(type), `${mode}: Runde ${i + 1} ohne Spiel`);
      modes.ensureUpcoming(match, seeded(i + 100));
      assert.ok(modes.upcomingGame(match), `${mode}: nach Runde ${i + 1} keine Vorschau`);
    }
  }
});

test("Spielliste: ein Einzelspiel spielt genau das gewählte Spiel", () => {
  const settings = modes.mergeSettings(modes.defaultSettings(), { single: "turmbau" }, ALL);
  const match = modes.createMatch("single", settings, players(2), ALL);
  assert.deepEqual(match.playlist, ["turmbau"]);
  const random = modes.createMatch("single", modes.defaultSettings(), players(2), ALL);
  assert.equal(random.playlist.length, 1);
  assert.ok(ALL.includes(random.playlist[0]));
});

test("Spielliste: Zufall im Einzelspiel zieht aus der Spielauswahl und wiederholt nicht", () => {
  const pool = ALL.slice(0, 3);
  const settings = modes.mergeSettings(modes.defaultSettings(), { pool }, ALL);
  const seen = new Set();
  let last = null;
  for (let i = 0; i < 200; i += 1) {
    const match = modes.createMatch("single", settings, players(2), ALL, Math.random, last);
    const type = match.playlist[0];
    assert.ok(pool.includes(type), `${type} ist nicht in der Auswahl`);
    assert.notEqual(type, last, "dasselbe Spiel nicht zweimal hintereinander");
    seen.add(type);
    last = type;
  }
  assert.equal(seen.size, pool.length, "jedes Spiel der Auswahl kommt dran");
  // Ohne Auswahl: alle Spiele sind möglich, und über viele Ziehungen kommt jedes.
  const all = new Set();
  for (let i = 0; i < 2000; i += 1) all.add(modes.createMatch("single", modes.defaultSettings(), players(2), ALL).playlist[0]);
  assert.equal(all.size, ALL.length, "Zufall erreicht jedes verfügbare Spiel");
});

// --- Einstellungen ------------------------------------------------------------

test("Einstellungen: Unsinn vom Client ändert nichts", () => {
  const base = modes.defaultSettings();
  const junk = [null, 7, "x", { length: 7 }, { length: "10" }, { lives: 99 }, { pool: "alle" },
    { pool: ["gibtsnicht", "auchnicht"] }, { single: "gibtsnicht" }, { __proto__: { length: 15 } }];
  junk.forEach((raw) => {
    const next = modes.mergeSettings(base, raw, ALL);
    assert.ok(modes.MARATHON_LENGTHS.includes(next.length));
    assert.ok(modes.KNOCKOUT_LIVES.includes(next.lives));
    assert.ok(next.pool === null || next.pool.every((type) => ALL.includes(type)));
    assert.ok(next.single === null || ALL.includes(next.single));
  });
  // "10" als Zeichenkette ist eine gültige Länge — Formulare schicken Text.
  assert.equal(modes.mergeSettings(base, { length: "10" }, ALL).length, 10);
});

test("Einstellungen: eine Auswahl unter zwei Spielen oder mit allen ist keine Auswahl", () => {
  const base = modes.defaultSettings();
  assert.equal(modes.mergeSettings(base, { pool: [ALL[0]] }, ALL).pool, null);
  assert.equal(modes.mergeSettings(base, { pool: ALL }, ALL).pool, null);
  assert.deepEqual(modes.mergeSettings(base, { pool: [ALL[0], ALL[1], ALL[0]] }, ALL).pool, [ALL[0], ALL[1]]);
});

// --- Marathon ---------------------------------------------------------------

test("Marathon: endet nach genau der gewählten Zahl Spiele, die meisten Punkte gewinnen", () => {
  const list = players(4);
  const match = modes.createMatch("marathon", { ...modes.defaultSettings(), length: 5 }, list, ALL, seeded(5));
  for (let i = 0; i < 5; i += 1) {
    assert.equal(modes.matchOutcome(match, list).over, false, `vor Spiel ${i + 1} schon vorbei`);
    modes.nextGame(match);
    round(match, list, [40, 30, 20, 10]);
  }
  const verdict = modes.matchOutcome(match, list);
  assert.equal(verdict.over, true);
  assert.deepEqual(verdict.winnerIds, ["p0"]);
  assert.equal(list[0].points, 15);
});

test("Marathon: Gleichstand in Punkten entscheiden die Rundensiege", () => {
  const list = players(2);
  const match = modes.createMatch("marathon", { ...modes.defaultSettings(), length: 5 }, list, ALL, seeded(6));
  // p0 gewinnt zwei Runden allein, p1 eine — dazu zwei Unentschieden, die
  // beiden einen Punkt UND einen Rundensieg bringen.
  const rounds = [[1, 0], [1, 0], [0, 1], [5, 5], [5, 5]];
  rounds.forEach((scores) => { modes.nextGame(match); round(match, list, scores); });
  assert.equal(list[0].points, 4);
  assert.equal(list[1].points, 3);
  assert.deepEqual(modes.matchOutcome(match, list).winnerIds, ["p0"]);
});

// --- Punktejagd ---------------------------------------------------------------

test("Punktejagd: das Ziel wächst mit der Spielerzahl", () => {
  assert.equal(modes.huntTarget(2), 4);
  assert.equal(modes.huntTarget(3), 8);
  assert.equal(modes.huntTarget(4), 12);
});

test("Punktejagd: wer das Ziel allein erreicht, gewinnt sofort", () => {
  const list = players(4);
  const match = modes.createMatch("hunt", modes.defaultSettings(), list, ALL, seeded(7));
  let rounds = 0;
  while (!modes.matchOutcome(match, list).over) {
    modes.nextGame(match);
    round(match, list, [40, 30, 20, 10]);
    rounds += 1;
    assert.ok(rounds < 10);
  }
  assert.equal(rounds, 4);
  assert.deepEqual(modes.matchOutcome(match, list).winnerIds, ["p0"]);
});

test("Punktejagd: zwei gleichauf über dem Ziel spielen weiter", () => {
  const list = players(2);
  const match = modes.createMatch("hunt", modes.defaultSettings(), list, ALL, seeded(8));
  list[0].points = 3;
  list[1].points = 3;
  modes.nextGame(match);
  round(match, list, [9, 9]);
  assert.equal(list[0].points, 4);
  assert.equal(list[1].points, 4);
  assert.equal(modes.matchOutcome(match, list).over, false, "Gleichstand am Ziel ist Matchball, kein Ende");
  modes.nextGame(match);
  round(match, list, [9, 1]);
  assert.deepEqual(modes.matchOutcome(match, list), { over: true, winnerIds: ["p0"] });
});

test("Punktejagd: hat eine Notbremse, falls die Spitze ewig gleichauf bleibt", () => {
  const list = players(2);
  const match = modes.createMatch("hunt", modes.defaultSettings(), list, ALL, seeded(11));
  for (let i = 0; i < modes.HUNT_MAX_ROUNDS; i += 1) {
    modes.nextGame(match);
    round(match, list, [1, 1]);
  }
  const verdict = modes.matchOutcome(match, list);
  assert.equal(verdict.over, true);
  assert.deepEqual(verdict.winnerIds.sort(), ["p0", "p1"]);
});

test("Punktejagd: Matchball zeigt, wer mit einem Sieg gewinnt", () => {
  const list = players(4);
  const match = modes.createMatch("hunt", modes.defaultSettings(), list, ALL, seeded(12));
  list[0].points = 9;
  list[1].points = 8;
  assert.deepEqual(modes.matchPoint(match, list), ["p0"]);
});

// --- K.O. -------------------------------------------------------------------

test("K.O.: jeder startet mit der gewählten Zahl Leben", () => {
  const list = players(4);
  modes.createMatch("knockout", { ...modes.defaultSettings(), lives: 2 }, list, ALL);
  list.forEach((player) => assert.equal(player.lives, 2));
});

test("K.O.: der Letzte verliert ein Leben, bei null ist er raus", () => {
  const list = players(3);
  const match = modes.createMatch("knockout", { ...modes.defaultSettings(), lives: 2 }, list, ALL, seeded(13));
  modes.nextGame(match);
  const first = round(match, list, [3, 2, 1]);
  assert.equal(first.get("p2").lifeLost, true);
  assert.equal(list[2].lives, 1);
  assert.equal(list[2].out, false);
  modes.nextGame(match);
  round(match, list, [3, 2, 1]);
  assert.equal(list[2].lives, 0);
  assert.equal(list[2].out, true);
});

test("K.O.: wer schon raus ist, zählt nicht mehr — auch nicht als Letzter", () => {
  const list = players(3);
  const match = modes.createMatch("knockout", { ...modes.defaultSettings(), lives: 2 }, list, ALL, seeded(14));
  list[2].out = true;
  list[2].lives = 0;
  modes.nextGame(match);
  // p2 ist Letzter, aber schon raus: unter den Lebenden ist p1 Letzter.
  const outcome = round(match, list, [3, 2, 1]);
  assert.equal(outcome.get("p1").lifeLost, true);
  assert.equal(outcome.get("p2").lifeLost, false);
});

test("K.O.: sind alle Lebenden gleichauf, verliert niemand", () => {
  const list = players(4);
  const match = modes.createMatch("knockout", modes.defaultSettings(), list, ALL, seeded(15));
  modes.nextGame(match);
  const outcome = round(match, list, [5, 5, 5, 5]);
  list.forEach((player) => assert.equal(outcome.get(player.id).lifeLost, false));
});

test("K.O.: zwei gleichauf ganz hinten verlieren beide", () => {
  const list = players(4);
  const match = modes.createMatch("knockout", modes.defaultSettings(), list, ALL, seeded(16));
  modes.nextGame(match);
  const outcome = round(match, list, [9, 5, 1, 1]);
  assert.equal(outcome.get("p2").lifeLost, true);
  assert.equal(outcome.get("p3").lifeLost, true);
  assert.equal(outcome.get("p1").lifeLost, false);
});

test("K.O.: der Letzte, der übrig bleibt, gewinnt", () => {
  const list = players(3);
  const match = modes.createMatch("knockout", { ...modes.defaultSettings(), lives: 2 }, list, ALL, seeded(17));
  let rounds = 0;
  while (!modes.matchOutcome(match, list).over) {
    modes.nextGame(match);
    round(match, list, [3, 2, 1]);
    rounds += 1;
    assert.ok(rounds < 20);
  }
  // p2 fliegt nach zwei Runden, danach ist p1 unter den Lebenden Letzter.
  assert.equal(rounds, 4);
  assert.deepEqual(modes.matchOutcome(match, list).winnerIds, ["p0"]);
});

test("K.O.: der Stand ordnet nach Leben, dann nach Punkten", () => {
  const list = players(3);
  list[0].lives = 1; list[0].points = 9;
  list[1].lives = 2; list[1].points = 1;
  list[2].lives = 0; list[2].points = 20;
  const table = modes.standings("knockout", list);
  assert.deepEqual(table.map((row) => row.playerId), ["p1", "p0", "p2"]);
});

// --- Ablauf auf dem Server ----------------------------------------------------

function makeRoom(mode, count, settings = {}) {
  const room = {
    code: `T${mode}${count}`,
    hostId: "p0",
    mode,
    settings: modes.mergeSettings(modes.defaultSettings(), settings, ALL),
    match: null,
    status: "lobby",
    phase: "lobby",
    players: [],
    minigameCounter: 0,
    devMode: false,
    currentMinigame: null,
    lastMinigameResult: null,
    resultEndsAt: null,
    readyForNext: [],
    lastMessage: "",
    winnerIds: [],
    timers: new Set(),
    minigameTick: null,
    cleanupTimer: null
  };
  for (let index = 0; index < count; index += 1) {
    room.players.push(testRules.createPlayer({ id: `p${index}`, name: `P${index}`, color: "#fff", isHost: index === 0, isBot: index > 0 }));
  }
  return room;
}

// Eine ganze Partie durch den echten Ablauf: Start, Minispiel, Wertung,
// nächstes Minispiel — bis zum Ende. Die Minispiele laufen dabei nicht
// wirklich; jedes wird sofort beendet. Geprüft wird der Ablauf, nicht das Spiel.
function playThrough(room, maxRounds = 60) {
  testRules.startGame(room);
  let rounds = 0;
  try {
    while (room.status === "minigame" && rounds < maxRounds) {
      testRules.markMinigameReady(room, ["p0"], room.currentMinigame.id);
      testRules.finishMinigame(room);
      assert.equal(room.status, "result");
      testRules.continueAfterResult(room);
      rounds += 1;
    }
  } finally {
    testRules.clearRoomTimers(room);
  }
  return rounds;
}

test("Startkarte: ohne alle Menschen laufen weder Spieluhr noch Bots", () => {
  const room = makeRoom("single", 4, { single: "luftpuck" });
  room.players[1].isBot = false;
  testRules.startGame(room);
  const id = room.currentMinigame.id;
  try {
    assert.equal(room.phase, "waitingReady");
    assert.equal(room.currentMinigame.startedAt, null);
    assert.equal(room.currentMinigame.arcade, null);
    assert.equal(room.minigameTick, null);
    // Nur die sichtbare Frist der Startkarte läuft — keine Spieluhr, keine Bots.
    assert.equal(room.timers.size, 1);
    assert.ok(Math.abs(testRules.serializeRoom(room).readyEndsAt - (Date.now() + testRules.READY_MAX_MS)) < 1000);
    assert.equal(testRules.serializeRoom(room).readyNeeded, 2);
    assert.equal(testRules.markMinigameReady(room, ["fremd"], id).ok, false);
    assert.equal(testRules.markMinigameReady(room, ["p0"], id).ok, true);
    assert.equal(testRules.markMinigameReady(room, ["p0"], id).ok, true);
    assert.deepEqual(room.readyForMinigame, ["p0"]);
    assert.equal(room.phase, "waitingReady");
    assert.equal(testRules.markMinigameReady(room, ["p1"], id).ok, true);
    assert.equal(room.phase, "playingMinigame");
    assert.ok(room.currentMinigame.startedAt > Date.now());
    assert.ok(room.currentMinigame.arcade);
    assert.notEqual(room.currentMinigame.id, id);
    const startedAt = room.currentMinigame.startedAt;
    assert.equal(testRules.markMinigameReady(room, ["p1"], id).ok, false);
    assert.equal(room.currentMinigame.startedAt, startedAt);
  } finally {
    testRules.clearRoomTimers(room);
  }
});

test("Startkarte: wer das Handy weglegt, hält niemanden fest — nach der Frist beginnt die Runde mit allen", async () => {
  const room = makeRoom("single", 3, { single: "turmbau" });
  room.players[1].isBot = false;
  room.players[2].isBot = false;
  testRules.startGame(room);
  try {
    const id = room.currentMinigame.id;
    const endsAt = room.readyEndsAt;
    assert.ok(endsAt > Date.now() + testRules.READY_MAX_MS - 1000, "eine feste Frist zum Lesen und Üben");
    testRules.markMinigameReady(room, ["p0"], id);
    assert.equal(room.phase, "waitingReady");
    assert.equal(room.readyEndsAt, endsAt, "ein Bereit verkürzt sie nicht — wer übt, wird nicht herausgerissen");
    assert.equal(testRules.serializeRoom(room).readyEndsAt, endsAt, "die Geräte zeigen sie an");
    // Abgelaufen: die Runde beginnt mit allen, auch ohne p1 und p2.
    testRules.armReadyDeadline(room, Date.now());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(room.phase, "playingMinigame");
    assert.ok(room.currentMinigame.arcade);
    assert.equal(testRules.serializeRoom(room).readyEndsAt, null);
  } finally {
    testRules.clearRoomTimers(room);
  }
});

test("Startkarte: getrennte Geräte blockieren nicht, alle offline starten keine Uhr", () => {
  const room = makeRoom("single", 2, { single: "turmbau" });
  room.players[1].isBot = false;
  testRules.startGame(room);
  try {
    testRules.markMinigameReady(room, ["p0"], room.currentMinigame.id);
    room.players.forEach((player) => { player.connected = false; });
    assert.equal(testRules.maybeStartPreparedMinigame(room), false);
    assert.equal(room.currentMinigame.startedAt, null);
    room.players[0].connected = true;
    assert.equal(testRules.maybeStartPreparedMinigame(room), true);
    assert.equal(room.phase, "playingMinigame");
  } finally {
    testRules.clearRoomTimers(room);
  }
});

test("Startkarte: nächste Runde verlangt neues Bereit, lokale Spieler können gemeinsam starten", () => {
  const room = makeRoom("marathon", 3, { length: 5 });
  room.players.forEach((player) => { player.isBot = false; });
  testRules.startGame(room);
  const id = room.currentMinigame.id;
  try {
    assert.equal(testRules.markMinigameReady(room, ["p0", "p1", "p2"], id).ok, true);
    assert.equal(room.phase, "playingMinigame");
    testRules.finishMinigame(room);
    testRules.continueAfterResult(room);
    assert.equal(room.phase, "waitingReady");
    assert.deepEqual(room.readyForMinigame, []);
    assert.equal(testRules.markMinigameReady(room, ["p0", "p1", "p2"], id).ok, false);
    assert.equal(room.currentMinigame.startedAt, null);
    testRules.resetToLobby(room);
    assert.equal(room.currentMinigame, null);
    assert.deepEqual(room.readyForMinigame, []);
  } finally {
    testRules.clearRoomTimers(room);
  }
});

test("Ablauf: ein Marathon spielt genau seine Länge und endet auf dem Endbildschirm", () => {
  for (const length of modes.MARATHON_LENGTHS) {
    const room = makeRoom("marathon", 4, { length });
    const rounds = playThrough(room);
    assert.equal(rounds, length);
    assert.equal(room.status, "end");
    assert.ok(room.winnerIds.length >= 1);
  }
});

test("Ablauf: ein Einzelspiel führt zurück in die Lobby und zählt den Sitzungssieg", () => {
  const room = makeRoom("single", 2, { single: "turmbau" });
  testRules.startGame(room);
  assert.equal(room.currentMinigame.type, "turmbau");
  testRules.markMinigameReady(room, ["p0"], room.currentMinigame.id);
  testRules.finishMinigame(room);
  testRules.continueAfterResult(room);
  testRules.clearRoomTimers(room);
  assert.equal(room.status, "lobby");
  assert.equal(room.match, null);
  const credited = room.players.reduce((sum, player) => sum + player.sessionWins, 0);
  assert.ok(credited >= 1, "der Sieger des Einzelspiels steht nicht im Sitzungszähler");
});

test("Ablauf: Punktejagd und K.O. enden von selbst", () => {
  for (const mode of ["hunt", "knockout"]) {
    const room = makeRoom(mode, 3);
    playThrough(room, 80);
    assert.equal(room.status, "end", `${mode} endet nicht`);
  }
});

test("Ablauf: die Ergebnistafel trägt Platz, Punkte und die Vorschau", () => {
  const room = makeRoom("marathon", 4, { length: 5 });
  testRules.startGame(room);
  testRules.markMinigameReady(room, ["p0"], room.currentMinigame.id);
  testRules.finishMinigame(room);
  const result = room.lastMinigameResult;
  testRules.clearRoomTimers(room);
  assert.equal(result.ranking.length, 4);
  result.ranking.forEach((entry) => {
    assert.ok(Number.isInteger(entry.place));
    assert.ok(Number.isInteger(entry.points));
    assert.ok(Number.isInteger(entry.total));
  });
  assert.equal(result.matchOver, false);
  assert.ok(ALL.includes(result.next), "keine Vorschau auf das nächste Spiel");
  const state = testRules.serializeRoom(room);
  assert.equal(state.match.round, 1);
  assert.equal(state.match.total, 5);
  assert.equal(state.standings.length, 4);
});

test("Ablauf: zurück in die Lobby löscht den Spielstand, nicht die Sitzungssiege", () => {
  const room = makeRoom("marathon", 2, { length: 5 });
  playThrough(room);
  const before = room.players.map((player) => player.sessionWins);
  testRules.resetToLobby(room);
  assert.equal(room.status, "lobby");
  room.players.forEach((player, index) => {
    assert.equal(player.points, 0);
    assert.equal(player.wins, 0);
    assert.equal(player.sessionWins, before[index]);
  });
});

test("Ablauf: ein neuer Raum hat kein Brett mehr im Zustand", () => {
  const state = testRules.serializeRoom(makeRoom("marathon", 2));
  ["board", "boardId", "starIndex", "fieldTypes", "itemCatalog", "currentPlayerId", "pendingJunction"].forEach((key) => {
    assert.equal(key in state, false, `${key} steht noch im Raumzustand`);
  });
  state.players.forEach((player) => {
    ["coins", "stars", "items", "position"].forEach((key) => assert.equal(key in player, false, `Spieler hat noch ${key}`));
  });
});

test("Einstellungen: die Bot-Stufe nimmt nur bekannte Werte an", () => {
  const base = modes.defaultSettings();
  assert.equal(base.botLevel, "mixed");
  assert.equal(modes.mergeSettings(base, { botLevel: "hard" }, ALL).botLevel, "hard");
  assert.equal(modes.mergeSettings({ ...base, botLevel: "easy" }, { botLevel: "brutal" }, ALL).botLevel, "easy");
  assert.equal(modes.mergeSettings(base, { botLevel: { toString: null } }, ALL).botLevel, "mixed");
});

test("Bots: die eingestellte Stufe gilt für alle Bots, gemischt würfelt", () => {
  const players = [
    { id: "h", isBot: false },
    { id: "b1", isBot: true },
    { id: "b2", isBot: true }
  ];
  ["easy", "normal", "hard"].forEach((level) => {
    const entries = { h: {}, b1: {}, b2: {} };
    testRules.assignBotProfiles({ players, settings: { botLevel: level } }, entries);
    assert.equal(entries.h.botProfile, undefined, "Menschen bekommen kein Profil");
    assert.equal(entries.b1.botProfile.level, level);
    assert.equal(entries.b2.botProfile.level, level);
    assert.ok(entries.b1.botProfile.reactionMs > 0);
  });
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) seen.add(testRules.botProfileFor("mixed").level);
  assert.deepEqual([...seen].sort(), ["easy", "hard", "normal"]);
});
