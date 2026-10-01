// Regeln der Partyklassiker (partyGames.js). Gespielt wird über dieselben
// Eingänge wie im echten Spiel — handleArcadeInput, updateArcade,
// arcadeBotStep — mit verschobener Uhr, damit eine Runde keine 40 Sekunden
// dauert.
const test = require("node:test");
const assert = require("node:assert/strict");
const { testRules } = require("./server.js");
const { constants: C } = require("./partyGames.js");

const {
  MINIGAMES, createArcadeState, handleArcadeInput, updateArcade, arcadeBotStep,
  arcadeRankingScore, arcadeResultDetail, publicArcade
} = testRules;

const COLORS = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"];
function makePlayers(n, bots = false) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, color: COLORS[i], isBot: bots, connected: true }));
}

// Eine Runde mit eigener Uhr. `step(t)` wird vor jedem Servertakt gerufen.
function setup(type, n = 4, { bots = false } = {}) {
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  const players = makePlayers(n, bots);
  const startedAt = clock;
  const tpl = MINIGAMES.find((m) => m.type === type);
  const arcade = createArcadeState(type, players, startedAt);
  const minigame = { id: 1, type, startedAt, duration: tpl.duration, arcade, scores: {}, lastInputAt: {} };
  const room = { code: "TEST", players, currentMinigame: minigame };
  const api = {
    room, minigame, arcade, players,
    get now() { return clock; },
    at(ms) { clock = startedAt + ms; },
    input(player, input) { return handleArcadeInput(room, player, input); },
    tick() { updateArcade(room); },
    // Bis `until` laufen, alle `every` ms ein Takt, davor `step(t)`.
    run(from, until, every = 30, step = null) {
      for (let t = from; t <= until; t += every) {
        clock = startedAt + t;
        step?.(t);
        updateArcade(room);
      }
    },
    restore() { Date.now = realNow; }
  };
  return api;
}

// --- Tauziehen -------------------------------------------------------------

test("Zündstoff: bei gleicher Überlebensleistung gewinnt hektisches Weitergeben keinen Stichentscheid", () => {
  const g = setup("zuendstoff", 2);
  try {
    const [one, two] = g.players.map(p => g.arcade.players[p.id]);
    one.passes = 2; two.passes = 99;
    assert.equal(arcadeRankingScore(g.arcade, one), arcadeRankingScore(g.arcade, two));
    two.lives = one.lives - 1;
    assert.ok(arcadeRankingScore(g.arcade, one) > arcadeRankingScore(g.arcade, two));
  } finally { g.restore(); }
});

for (const type of ["tauziehen", "luftpuck"]) {
  for (const count of [2, 3, 4]) {
    test(`${type}: ${count} Spieler teilen den Teamplatz unabhängig vom Einzelbeitrag`, () => {
      const g = setup(type, count);
      try {
        if (type === "tauziehen") g.arcade.tug.wins = [2, 1];
        else g.arcade.hockey.score = [5, 3];
        g.players.forEach((p, i) => Object.assign(g.arcade.players[p.id], {
          work: i * 90, touches: i * 20, goals: i
        }));
        const places = testRules.rankPlaces(g.players, p => arcadeRankingScore(g.arcade, g.arcade.players[p.id]));
        const winners = g.players.filter(p => g.arcade.players[p.id].side === 0);
        winners.forEach(p => assert.equal(places[p.id], 1));
        const losers = g.players.filter(p => g.arcade.players[p.id].side === 1);
        losers.forEach(p => assert.equal(places[p.id], winners.length + 1));
        // Auch ein unentschiedener Teamstand bleibt für alle unentschieden.
        if (type === "tauziehen") g.arcade.tug.wins = [1, 1];
        else g.arcade.hockey.score = [3, 3];
        const draw = testRules.rankPlaces(g.players, p => arcadeRankingScore(g.arcade, g.arcade.players[p.id]));
        assert.deepEqual(Object.values(draw), Array(count).fill(1));
      } finally { g.restore(); }
    });
  }
}

test("Tauziehen: vier Spieler ergeben zwei gegen zwei, drei einer gegen zwei", () => {
  const four = setup("tauziehen", 4);
  const sides = four.players.map((p) => four.arcade.players[p.id].side);
  assert.deepEqual(sides.filter((s) => s === 0).length, 2);
  four.restore();
  const three = setup("tauziehen", 3);
  const count = [0, 1].map((side) => three.players.filter((p) => three.arcade.players[p.id].side === side).length);
  assert.deepEqual([...count].sort(), [1, 2]);
  // Der Einzelne zieht kräftiger als jeder aus dem Zweierteam.
  const soloSide = count[0] === 1 ? 0 : 1;
  const factor = three.arcade.tug.factor;
  assert.ok(factor[soloSide] > 2 * factor[1 - soloSide] * 1.1, `Faktor ${factor}`);
  three.restore();
});

test("Tauziehen: wild hämmern lässt abrutschen, ruhiger Takt nicht", () => {
  const g = setup("tauziehen", 2);
  const [masher, steady] = g.players;
  g.run(0, C.TUG_LEAD_MS, 30);
  let t = C.TUG_LEAD_MS;
  // Sechs Sekunden: einer tippt alle 70 ms, der andere alle 215 ms.
  let nextSteady = t;
  let nextMash = t;
  g.run(t, t + 6000, 10, (now) => {
    if (now >= nextMash) { g.input(masher, { action: "pull" }); nextMash = now + 70; }
    if (now >= nextSteady) { g.input(steady, { action: "pull" }); nextSteady = now + 215; }
  });
  const m = g.arcade.players[masher.id];
  const s = g.arcade.players[steady.id];
  assert.ok(m.slips >= 1, `Hämmerer rutscht ab (${m.slips})`);
  assert.equal(s.slips, 0, "wer im Takt bleibt, rutscht nicht ab");
  g.restore();
});

test("Tauziehen: gemeinsam ziehen gibt ein Hau-Ruck", () => {
  const g = setup("tauziehen", 4);
  const mates = g.players.filter((p) => g.arcade.players[p.id].side === 0);
  g.run(0, C.TUG_LEAD_MS + 100, 30);
  g.input(mates[0], { action: "pull" });
  const vorher = g.arcade.players[mates[1].id].work;
  g.at(C.TUG_LEAD_MS + 160);
  g.input(mates[1], { action: "pull" });
  const zug = g.arcade.players[mates[1].id].work - vorher;
  assert.equal(g.arcade.players[mates[1].id].syncs, 1);
  assert.ok(zug > C.TUG_IMPULSE * 1.2, `Hau-Ruck zählt mehr (${zug.toFixed(3)})`);
  g.restore();
});

test("Tauziehen: über die Linie gezogen entscheidet den Durchgang, zwei Siege das Spiel", () => {
  const g = setup("tauziehen", 2);
  const [left] = g.players;
  assert.equal(g.arcade.players[left.id].side, 0);
  let next = 0;
  g.run(0, g.minigame.duration, 20, (t) => {
    if (t >= next) { g.input(left, { action: "pull" }); next = t + 210; }
  });
  assert.equal(g.arcade.tug.wins[0], 2, "das ziehende Team gewinnt zwei Durchgänge");
  assert.equal(g.arcade.tug.phase, "over");
  assert.ok(g.arcade.tug.results.length === 2, "nach zwei Siegen ist Schluss");
  const winner = arcadeRankingScore(g.arcade, g.arcade.players[left.id]);
  const loser = arcadeRankingScore(g.arcade, g.arcade.players[g.players[1].id]);
  assert.ok(winner > loser);
  assert.equal(arcadeResultDetail(g.arcade, g.arcade.players[left.id]).value, 2);
  g.restore();
});

test("Tauziehen: Bots ziehen und niemand wirft", () => {
  const g = setup("tauziehen", 4, { bots: true });
  const next = g.players.map(() => 0);
  g.run(0, g.minigame.duration, 30, (t) => {
    g.players.forEach((p, i) => { if (t >= next[i]) { next[i] = t + 150; arcadeBotStep(g.room, p); } });
  });
  const taps = g.players.map((p) => g.arcade.players[p.id].taps);
  assert.ok(taps.every((n) => n > 40), `alle ziehen: ${taps}`);
  assert.ok(g.arcade.tug.results.length >= 2);
  assert.ok(publicArcade(g.arcade).tug, "der Seilzustand geht an die Geräte");
  g.restore();
});

// --- Grimassen -------------------------------------------------------------

const party = require("./partyGames.js");

test("Grimassen: wer nichts tut, bekommt nichts — wer genau trifft, alles", () => {
  for (let round = 0; round < C.FACE_ROUNDS; round += 1) {
    const target = party.faceTarget(823456, round);
    assert.equal(party.facePoints(party.faceError(new Array(12).fill(0), target), target), 0, `Runde ${round + 1}: neutral`);
    assert.equal(party.facePoints(party.faceError(target, target), target), 100, `Runde ${round + 1}: genau`);
    const moved = target.filter((v, i) => i % 2 === 0 && Math.hypot(v, target[i + 1]) > 0.3).length;
    assert.equal(moved, [3, 4, 6][round], `Runde ${round + 1}: ${moved} verzogene Punkte`);
  }
});

test("Grimassen: geformt wird nur in der Formphase, gewertet für alle gleichzeitig", () => {
  const g = setup("grimassen", 2);
  const [a, b] = g.players;
  const target = g.arcade.face.targets[0];
  // Während das Vorbild gezeigt wird, zählt keine Eingabe.
  g.run(0, C.FACE_LEAD_MS + 200, 50);
  g.input(a, { action: "shape", h: target });
  assert.deepEqual(g.arcade.players[a.id].shape, new Array(12).fill(0));
  // In der Formphase schon — und Unsinn wird begrenzt oder abgelehnt.
  g.run(C.FACE_LEAD_MS + 250, C.FACE_LEAD_MS + C.FACE_SHOW_MS + 500, 50);
  g.input(a, { action: "shape", h: target, final: true });
  g.input(b, { action: "shape", h: target.map((v) => v * 9), final: true });
  assert.ok(g.arcade.players[b.id].shape.every((v) => v >= -1 && v <= 1));
  assert.equal(g.input(b, { action: "shape", h: [1, 2, 3], final: true }).ok, false);
  g.run(C.FACE_LEAD_MS + C.FACE_SHOW_MS + 550, C.FACE_LEAD_MS + C.FACE_CYCLE_MS - 100, 50);
  assert.equal(g.arcade.players[a.id].results[0].points, 100);
  assert.ok(g.arcade.players[b.id].results[0].points < 100);
  // Nächste Runde: die Maske ist wieder neutral.
  g.run(C.FACE_LEAD_MS + C.FACE_CYCLE_MS, C.FACE_LEAD_MS + C.FACE_CYCLE_MS + 200, 50);
  assert.deepEqual(g.arcade.players[a.id].shape, new Array(12).fill(0));
  g.run(C.FACE_LEAD_MS + C.FACE_CYCLE_MS + 250, g.minigame.duration, 100);
  assert.equal(g.arcade.players[a.id].results.length, C.FACE_ROUNDS);
  assert.ok(arcadeRankingScore(g.arcade, g.arcade.players[a.id]) > arcadeRankingScore(g.arcade, g.arcade.players[b.id]));
  g.restore();
});

// Genauigkeit muss zählen. Vorher brachte es schon zwei Drittel der Punkte,
// jeden verzogenen Punkt einfach halb zum Ziel zu ziehen.
test("Grimassen: halb getroffen ist nur ein Viertel wert", () => {
  for (let round = 0; round < C.FACE_ROUNDS; round += 1) {
    const target = party.faceTarget(823456, round);
    const half = target.map((v) => v / 2);
    const points = party.facePoints(party.faceError(half, target), target);
    assert.ok(points >= 20 && points <= 30, `Runde ${round + 1}: halb getroffen ${points}`);
  }
});

// Was man in der letzten Rundreise vor dem Ende noch zieht, kommt erst danach
// an. Innerhalb der Schonfrist zählt es; gewertet wird erst hinter ihr.
test("Grimassen: ein Zug kurz nach dem Ende zählt noch, einer nach der Schonfrist nicht", () => {
  const g = setup("grimassen", 2);
  const [a] = g.players;
  const target = g.arcade.face.targets[0];
  const shapeEnd = C.FACE_LEAD_MS + C.FACE_SHOW_MS + C.FACE_SHAPE_MS;
  g.run(0, shapeEnd - 100, 50);
  g.input(a, { action: "shape", h: target.map((v) => v / 2), final: true });
  g.run(shapeEnd - 50, shapeEnd + 50, 50);
  assert.equal(g.arcade.players[a.id].results.length, 0, "noch nicht gewertet — die Frist läuft");
  g.at(shapeEnd + C.FACE_GRACE_MS - 40);
  g.input(a, { action: "shape", h: target, final: true });
  g.run(shapeEnd + C.FACE_GRACE_MS + 10, shapeEnd + C.FACE_GRACE_MS + 100, 50);
  assert.equal(g.arcade.players[a.id].results[0].points, 100, "in der Frist angekommen, also gezählt");
  g.at(shapeEnd + C.FACE_GRACE_MS + 150);
  g.input(a, { action: "shape", h: new Array(12).fill(0), final: true });
  assert.equal(g.arcade.players[a.id].results[0].points, 100, "nach der Wertung ändert nichts mehr etwas");
  g.restore();
});

test("Grimassen: der starke Bot trifft besser als der schwache", () => {
  const scores = { easy: 0, hard: 0 };
  for (let run = 0; run < 6; run += 1) {
    const g = setup("grimassen", 2, { bots: true });
    const [e, h] = g.players;
    g.arcade.players[e.id].botProfile = { level: "easy" };
    g.arcade.players[h.id].botProfile = { level: "hard" };
    const next = [0, 0];
    g.run(0, g.minigame.duration, 40, (t) => {
      g.players.forEach((p, i) => { if (t >= next[i]) { next[i] = t + 280; arcadeBotStep(g.room, p); } });
    });
    scores.easy += g.arcade.players[e.id].score;
    scores.hard += g.arcade.players[h.id].score;
    g.restore();
  }
  assert.ok(scores.hard > scores.easy, JSON.stringify(scores));
});

// --- Flaggen hoch ----------------------------------------------------------

test("Flaggen hoch: jede Runde hat Täuschungen und Doppelkommandos, nie zwei Fallen nacheinander", () => {
  for (const seed of [827001, 827555, 827999, 12]) {
    const commands = party.buildFlagCommands(seed);
    const kinds = commands.map((c) => c.kind);
    assert.ok(commands.length >= 20, `${commands.length} Kommandos`);
    assert.ok(kinds.filter((k) => k === "fake").length >= 3, kinds.join(","));
    assert.ok(kinds.filter((k) => k === "both").length >= 2, kinds.join(","));
    assert.ok(kinds.slice(0, 3).every((k) => k === "red" || k === "blue"), "die ersten drei sind einfach");
    kinds.forEach((k, i) => { if (i > 0) assert.ok(!(k === "fake" && kinds[i - 1] === "fake"), "zwei Fallen nacheinander"); });
    commands.forEach((c, i) => { if (i > 0) assert.ok(c.at >= commands[i - 1].at + commands[i - 1].window, "Fenster überlappen"); });
  }
});

test("Flaggen hoch: richtig, falsch, zu spät und reingefallen", () => {
  const g = setup("flaggenhoch", 3);
  const [a, b, c] = g.players;
  const commands = g.arcade.secret.flagCommands;
  const first = commands[0];
  g.run(0, first.at + 100, 30);
  g.input(a, { action: "flag", flag: first.kind });
  g.input(b, { action: "flag", flag: first.kind === "red" ? "blue" : "red" });
  g.run(first.at + 130, first.at + first.window + C.FLAG_GRACE_MS + 60, 30);
  assert.equal(g.arcade.players[a.id].answers[0].result, "ok");
  assert.equal(g.arcade.players[b.id].answers[0].result, "wrong");
  assert.equal(g.arcade.players[c.id].answers[0].result, "late", "wer nichts tut, ist zu spät");
  assert.equal(g.arcade.players[b.id].lives, C.FLAG_LIVES - 1);
  // Eine Falle: wer drückt, fällt rein; wer stillhält, hat richtig.
  const fake = commands.find((command) => command.kind === "fake");
  // Die Zwischenkommandos beantworten: sonst fallen die zwei anderen aus,
  // das Finale beginnt vor der Falle und diese Eingabe ist zurecht gesperrt.
  g.run(first.at + first.window + C.FLAG_GRACE_MS + 90, fake.at + 50, 30, (t) => {
    const active = party.activeFlagCommand(commands, t);
    if (!active || active === first || active === fake || active.kind === "fake") return;
    g.players.forEach((player) => {
      if (g.arcade.players[player.id].answers[active.index]) return;
      const flags = active.kind === "both" ? ["red", "blue"] : [active.kind];
      flags.forEach((flag) => g.input(player, { action: "flag", flag }));
    });
  });
  g.input(a, { action: "flag", flag: fake.side });
  g.run(fake.at + 80, fake.at + fake.window + 60, 30);
  assert.equal(g.arcade.players[a.id].answers[fake.index].result, "fooled");
  g.restore();
});

test("Flaggen hoch: bei BEIDE zählt es erst, wenn beide Flaggen oben sind", () => {
  const g = setup("flaggenhoch", 2);
  const [p] = g.players;
  const commands = g.arcade.secret.flagCommands;
  const both = commands.find((command) => command.kind === "both");
  // Bis dahin alles richtig beantworten, damit niemand vorher rausfliegt.
  g.run(0, both.at + 50, 20, (t) => {
    const active = party.activeFlagCommand(commands, t);
    if (!active || active === both || active.kind === "fake") return;
    g.players.forEach((player) => {
      if (g.arcade.players[player.id].answers[active.index]) return;
      const flags = active.kind === "both" ? ["red", "blue"] : [active.kind];
      flags.forEach((flag) => g.input(player, { action: "flag", flag }));
    });
  });
  const vorher = g.arcade.players[p.id].correct;
  g.input(p, { action: "flag", flag: "red" });
  assert.equal(g.arcade.players[p.id].answers[both.index], undefined, "eine Flagge reicht nicht");
  g.at(both.at + 120);
  g.input(p, { action: "flag", flag: "blue" });
  assert.equal(g.arcade.players[p.id].answers[both.index].result, "ok");
  assert.equal(g.arcade.players[p.id].correct, vorher + 1);
  g.restore();
});

// Alle beantworten jedes echte Kommando richtig — damit niemand vorzeitig
// ausscheidet und die Runde lange genug läuft.
function flagPerfect(g) {
  const commands = g.arcade.secret.flagCommands;
  return (t) => {
    const active = party.activeFlagCommand(commands, t);
    if (!active || active.kind === "fake" || t < active.at + 100) return;
    g.players.forEach((p) => {
      if (g.arcade.players[p.id].answers[active.index]) return;
      if (active.kind === "both") {
        g.input(p, { action: "flag", flag: "red" });
        g.input(p, { action: "flag", flag: "blue" });
      } else g.input(p, { action: "flag", flag: active.kind });
    });
  };
}

test("Flaggen hoch: der Fahrplan bleibt geheim, bis ein Kommando kurz bevorsteht", () => {
  const g = setup("flaggenhoch", 2);
  const commands = g.arcade.secret.flagCommands;
  const shown = () => JSON.parse(JSON.stringify(publicArcade(g.arcade)));
  assert.ok(!JSON.stringify(shown()).includes("flagCommands"), "kein Geheimfach im Paket");
  // Die Zeiten sehen alle — das Gerät braucht sie für den Takt.
  assert.deepEqual(shown().flags.commands.map((c) => c.at), commands.map((c) => c.at));
  const later = commands[6];
  g.run(0, later.at - C.FLAG_PUBLISH_LEAD_MS - 40, 30, flagPerfect(g));
  assert.equal(shown().flags.commands[6].kind, null, "zu früh: die Art ist noch geheim");
  assert.ok(shown().flags.commands.slice(7).every((c) => c.kind === null), "und alle späteren erst recht");
  g.run(later.at - C.FLAG_PUBLISH_LEAD_MS, later.at - C.FLAG_PUBLISH_LEAD_MS + 30, 30);
  assert.equal(shown().flags.commands[6].kind, later.kind, "kurz vorher: jetzt darf das Gerät es wissen");
  if (later.kind === "fake") assert.equal(shown().flags.commands[6].side, later.side);
  g.restore();
});

test("Flaggen hoch: bei BEIDE! zählen zwei Daumen im selben Augenblick", () => {
  const g = setup("flaggenhoch", 2);
  const [p] = g.players;
  const both = g.arcade.secret.flagCommands.find((command) => command.kind === "both");
  g.run(0, both.at - 60, 30, flagPerfect(g));
  g.at(both.at + 300);
  g.input(p, { action: "flag", flag: "red" });
  g.input(p, { action: "flag", flag: "blue" });
  assert.equal(g.arcade.players[p.id].answers[both.index]?.result, "ok", "der zweite Daumen ging verloren");
  // Dieselbe Flagge doppelt bleibt entprellt.
  const q = g.players[1];
  g.input(q, { action: "flag", flag: "red" });
  g.input(q, { action: "flag", flag: "red" });
  assert.equal(g.arcade.players[q.id].answers[both.index], undefined, "zweimal Rot ist nicht BEIDE");
  g.restore();
});

test("Flaggen hoch: ein Druck kurz nach dem Fenster zählt noch, einer nach der Nachfrist nicht", () => {
  const g = setup("flaggenhoch", 3);
  const [a, b, c] = g.players;
  const commands = g.arcade.secret.flagCommands;
  const target = commands.slice(3).find((command) => command.kind === "red" || command.kind === "blue");
  g.run(0, target.at - 60, 30, flagPerfect(g));
  const end = target.at + target.window;
  g.at(end + C.FLAG_GRACE_MS - 20);
  g.input(a, { action: "flag", flag: target.kind });
  g.tick();
  g.at(end + C.FLAG_GRACE_MS + 20);
  g.input(b, { action: "flag", flag: target.kind });
  g.tick();
  assert.equal(g.arcade.players[a.id].answers[target.index]?.result, "ok", "innerhalb der Nachfrist angekommen");
  assert.equal(g.arcade.players[b.id].answers[target.index]?.result, "late", "nach der Nachfrist ist es zu spät");
  assert.equal(g.arcade.players[c.id].answers[target.index]?.result, "late");
  g.restore();
});

test("Flaggen hoch: die Bots sind gestaffelt wie Menschen, nicht übermenschlich", () => {
  // Gezählt wird, wer gewinnt — mit der Wertung des Spiels. Richtige allein
  // taugen dafür nicht: normal und schwer liegen beide bei 96–97 %, den
  // Ausschlag gibt die schnellere Hand. Mit 24 Runden kippte die Reihenfolge
  // der Richtigen darum jedes fünfte Mal; 200 Runden kosten eine Zehntelsekunde.
  const sums = { easy: 0, normal: 0, hard: 0 };
  const outs = { easy: 0, normal: 0, hard: 0 };
  const wins = { easy: 0, normal: 0, hard: 0 };
  const speed = { hard: 0, n: 0 };
  const runs = 200;
  for (let r = 0; r < runs; r += 1) {
    const g = setup("flaggenhoch", 3, { bots: true });
    const levels = ["easy", "normal", "hard"];
    g.players.forEach((p, i) => {
      g.arcade.players[p.id].botProfile = { level: levels[i], reactionMs: 500, spreadMs: 200, mistake: 0.1 };
    });
    for (let t = 0; t <= g.minigame.duration + 1000; t += 150) {
      g.at(t);
      g.players.forEach((p) => arcadeBotStep(g.room, p));
      g.tick();
    }
    g.players.forEach((p, i) => {
      const entry = g.arcade.players[p.id];
      sums[levels[i]] += entry.correct;
      outs[levels[i]] += entry.outAt ? 1 : 0;
      if (levels[i] === "hard" && entry.correct) { speed.hard += entry.reactionSum / entry.correct; speed.n += 1; }
    });
    const scores = g.players.map((p) => arcadeRankingScore(g.arcade, g.arcade.players[p.id]));
    const best = Math.max(...scores);
    scores.forEach((score, i) => { if (score === best) wins[levels[i]] += 1; });
    g.restore();
  }
  assert.ok(wins.hard > wins.normal && wins.normal > wins.easy, `Siege ${JSON.stringify(wins)}`);
  assert.ok(sums.hard > sums.easy && sums.normal > sums.easy, `Richtige ${JSON.stringify(sums)}`);
  assert.ok(outs.easy < runs, "auch der leichte Bot hält manchmal bis zum Schluss durch");
  assert.ok(speed.hard / speed.n > 380, `der schwere Bot reagiert wie ein guter Mensch, nicht schneller (Ø ${Math.round(speed.hard / speed.n)} ms)`);
});

test("Flaggen hoch: drei Fehler, und man ist raus", () => {
  const g = setup("flaggenhoch", 2);
  const [lazy] = g.players;
  g.run(0, g.minigame.duration, 40);
  const entry = g.arcade.players[lazy.id];
  assert.equal(entry.lives, 0);
  assert.ok(entry.outAt, "wer nie drückt, fliegt nach drei echten Kommandos raus");
  assert.ok(entry.correct <= 3, "danach sammelt man nichts mehr");
  g.restore();
});

// --- Honigwabe -------------------------------------------------------------

test("Honigwabe: nur wer dran ist, pflückt — und eine Wabe kostet vier Früchte", () => {
  const g = setup("honigwabe", 3);
  g.run(0, C.HONEY_LEAD_MS + 50, 30);
  const state = g.arcade.honey;
  const turn = state.turn;
  assert.ok(turn, "nach dem Vorlauf ist jemand dran");
  const current = g.players.find((p) => p.id === turn.playerId);
  const other = g.players.find((p) => p.id !== turn.playerId);
  assert.equal(g.input(other, { action: "take", count: 1 }).ok, false, "wer nicht dran ist, darf nicht");
  assert.equal(g.input(current, { action: "take", count: 3 }).ok, false, "mehr als zwei gibt es nicht");
  // Die Ranke so stellen, dass eine Frucht und dann eine Wabe unten hängen.
  state.vine = ["gold", "comb", "fruit", "fruit"];
  const entry = g.arcade.players[current.id];
  g.at(turn.from + 400);             // über die Eingabesperre der Fehlgriffe hinaus
  g.input(current, { action: "take", count: 1 });
  assert.equal(entry.fruits, C.HONEY_GOLD, "goldener Apfel zählt drei");
  // Der Nächste ist dran; er greift zwei und erwischt die Wabe.
  const next = g.players.find((p) => p.id === state.turn.playerId);
  assert.notEqual(next.id, current.id);
  g.arcade.players[next.id].fruits = 7;
  g.at(state.turn.from + 10);
  g.input(next, { action: "take", count: 2 });
  assert.equal(g.arcade.players[next.id].stings, 1);
  assert.equal(g.arcade.players[next.id].fruits, 7 - C.HONEY_STING_COST, "ein fester Teil fällt herunter");
  assert.equal(state.last.stung, true);
  g.restore();
});

test("Honigwabe: einmal schieben — die Ranke bleibt, der Nächste ist dran", () => {
  const g = setup("honigwabe", 3);
  g.run(0, C.HONEY_LEAD_MS + 50, 30);
  const state = g.arcade.honey;
  const turn = state.turn;
  const current = g.players.find((p) => p.id === turn.playerId);
  const entry = g.arcade.players[current.id];
  const vorher = [...state.vine];
  g.at(turn.from + 10);
  assert.equal(g.input(current, { action: "pass" }).ok, true);
  assert.deepEqual(state.vine, vorher, "geschoben wird, nicht gepflückt");
  assert.equal(entry.passes, 0);
  assert.equal(state.last.passed, true);
  assert.notEqual(state.turn.playerId, current.id, "der Nächste ist dran");
  // Ein zweites Mal geht es nicht — auch nicht, wenn man wieder dran ist.
  while (state.turn.playerId !== current.id) {
    const who = g.players.find((p) => p.id === state.turn.playerId);
    g.at(state.turn.from + 10);
    g.input(who, { action: "take", count: 1 });
  }
  g.at(state.turn.from + 10);
  assert.equal(g.input(current, { action: "pass" }).ok, false, "der Joker ist verbraucht");
  g.restore();
});

test("Honigwabe: wer zu lange zögert, pflückt automatisch eine", () => {
  const g = setup("honigwabe", 2);
  g.run(0, C.HONEY_LEAD_MS + 50, 30);
  const first = g.arcade.honey.turn;
  g.run(C.HONEY_LEAD_MS + 80, first.until + C.HONEY_GRACE_MS + 60, 30);
  assert.equal(g.arcade.honey.last.auto, true);
  assert.notEqual(g.arcade.honey.turn.playerId, first.playerId, "danach ist der Nächste dran");
  g.restore();
});

test("Honigwabe: ein Zug, der knapp nach der Bedenkzeit ankommt, zählt noch", () => {
  const g = setup("honigwabe", 2);
  g.run(0, C.HONEY_LEAD_MS + 50, 30);
  const state = g.arcade.honey;
  const first = state.turn;
  const current = g.players.find((p) => p.id === first.playerId);
  state.vine = ["fruit", "gold", "fruit", "comb", "fruit"];
  // Der Server tickt über das Ende der Bedenkzeit, dann kommt der Zug an.
  g.run(first.until - 20, first.until + C.HONEY_GRACE_MS - 40, 30);
  assert.equal(state.turn.number, first.number, "innerhalb der Frist pflückt der Server nicht von selbst");
  g.at(first.until + C.HONEY_GRACE_MS - 30);
  assert.equal(g.input(current, { action: "take", count: 2 }).ok, true);
  assert.equal(state.last.auto, false, "der eigene Zug zählt, nicht der automatische");
  assert.equal(g.arcade.players[current.id].fruits, 1 + C.HONEY_GOLD);
  g.restore();
});

test("Honigwabe: das Risiko-Abzählen stimmt zu zweit mit dem Rest-drei-Gesetz überein", () => {
  // Zu zweit ist Abstand 3 (und jedes Vielfache) verloren: was ich auch nehme,
  // der andere kann mir die Wabe zurückschieben.
  assert.equal(Math.min(party.honeyRisk(3, 1, 2), party.honeyRisk(3, 2, 2)), 1);
  assert.equal(Math.min(party.honeyRisk(4, 1, 2), party.honeyRisk(4, 2, 2)), 0);
  assert.equal(Math.min(party.honeyRisk(5, 1, 2), party.honeyRisk(5, 2, 2)), 0);
  assert.equal(party.honeyRisk(1, 2, 2), 1, "wer über die Wabe greift, hat sie");
});

test("Honigwabe: eine leere Ranke wächst nach, und die Runde läuft bis zum Schluss", () => {
  const g = setup("honigwabe", 4, { bots: true });
  const next = g.players.map(() => 0);
  g.run(0, g.minigame.duration, 40, (t) => {
    g.players.forEach((p, i) => { if (t >= next[i]) { next[i] = t + 300; arcadeBotStep(g.room, p); } });
  });
  assert.ok(g.arcade.honey.vineNumber >= 1, "mindestens eine Ranke wurde leergepflückt");
  assert.ok(g.arcade.honey.picks > 12);
  g.restore();
});

// --- Schneeballhang --------------------------------------------------------

test("Schneeballhang: die Kugel wächst nur beim Rollen und ist erst ab einer Mindestgrösse wurfbereit", () => {
  const g = setup("schneeball", 2);
  const [a] = g.players;
  const entry = g.arcade.players[a.id];
  g.run(0, 1000, 30);
  assert.equal(entry.size, C.SNOW_MIN_SIZE, "im Stehen wächst nichts");
  g.input(a, { action: "throw" });
  assert.equal(g.arcade.snow.balls.length, 0, "zu klein zum Werfen");
  g.input(a, { action: "steer", x: 1, y: 0 });
  g.run(1030, 2600, 30, (t) => { if (t % 300 < 30) g.input(a, { action: "steer", x: t % 600 < 300 ? 1 : -1, y: 0 }); });
  assert.ok(entry.size >= C.SNOW_THROW_MIN, `nach anderthalb Sekunden Rollen: ${entry.size.toFixed(2)}`);
  g.input(a, { action: "throw" });
  assert.equal(g.arcade.snow.balls.length, 1);
  assert.equal(entry.size, C.SNOW_MIN_SIZE, "nach dem Wurf beginnt eine neue Kugel");
  g.restore();
});

test("Schneeballhang: ein Treffer wirft um und bringt dem Werfer Punkte", () => {
  const g = setup("schneeball", 2);
  const [a, b] = g.players;
  const ea = g.arcade.players[a.id];
  const eb = g.arcade.players[b.id];
  // Aufstellen: a schaut auf b, b steht mit kleiner Kugel still.
  Object.assign(ea, { x: 0, z: 2, heading: Math.PI, size: 0.9, dirX: 0, dirZ: 0 });
  Object.assign(eb, { x: 0, z: -2, heading: 0.5 * Math.PI, size: C.SNOW_MIN_SIZE, dirX: 0, dirZ: 0 });
  g.at(1000);
  g.input(a, { action: "throw" });
  g.run(1030, 2200, 20);
  assert.equal(eb.taken, 1, "b wurde getroffen");
  assert.ok(eb.stunUntil > 1000 + g.minigame.startedAt, "und liegt kurz");
  assert.equal(ea.score, party.snowValue(0.9), "eine Riesenkugel bringt vier");
  assert.equal(party.snowValue(0.9), 4);
  g.restore();
});

// Ein Servertakt dauert 90 ms und mehr. Eine frisch geworfene kleine Kugel
// rollt in dieser Zeit weiter, als sie und eine Figur zusammen breit sind —
// in einem Stück gerechnet rollte sie durch jemanden hindurch.
test("Schneeballhang: eine schnelle Kugel rollt nicht durch eine Figur hindurch", () => {
  const g = setup("schneeball", 2);
  const [a, b] = g.players;
  const ea = g.arcade.players[a.id];
  const eb = g.arcade.players[b.id];
  Object.assign(ea, { x: -2, z: 3, heading: Math.PI, size: C.SNOW_MIN_SIZE, dirX: 0, dirZ: 0, vx: 0, vz: 0 });
  Object.assign(eb, { x: 0.33, z: 0, heading: 0.5 * Math.PI, size: C.SNOW_MIN_SIZE, dirX: 0, dirZ: 0, vx: 0, vz: 0 });
  // Eine kleine Kugel streift b knapp: getroffen wird nur auf einem kurzen
  // Stück ihrer Bahn, kürzer als der Weg in einem Takt.
  g.arcade.snow.balls.push({ id: 99, owner: a.id, x: 0, z: 0.45, vx: 0, vz: -6.2, size: 0.4, r: 0.12, value: 1, bornAt: g.now, spin: 0 });
  g.at(1000);
  g.arcade.snowClock = g.now;
  g.at(1120);
  g.tick();
  assert.equal(eb.taken, 1, "die Kugel trifft, statt durchzurollen");
  g.restore();
});

test("Schneeballhang: die eigene grosse Kugel ist ein Schild", () => {
  const g = setup("schneeball", 2);
  const [a, b] = g.players;
  const ea = g.arcade.players[a.id];
  const eb = g.arcade.players[b.id];
  Object.assign(ea, { x: 0, z: 2, heading: Math.PI, size: 0.6, dirX: 0, dirZ: 0 });
  Object.assign(eb, { x: 0, z: -2, heading: 0, size: 0.9, dirX: 0, dirZ: 0 });   // schaut auf a, Kugel vorn
  g.at(1000);
  g.input(a, { action: "throw" });
  g.run(1030, 2200, 20);
  assert.equal(eb.taken, 0, "der Schild hat gehalten");
  assert.equal(eb.blocks, 1);
  assert.equal(ea.score, 0);
  g.restore();
});

test("Schneeballhang: eine Riesenkugel walzt weiter und wirft einen Zweiten um", () => {
  const g = setup("schneeball", 3);
  const [a, b, c] = g.players;
  const [ea, eb, ec] = [a, b, c].map((p) => g.arcade.players[p.id]);
  Object.assign(ea, { x: 0, z: 3, heading: Math.PI, size: 0.95, dirX: 0, dirZ: 0, vx: 0, vz: 0 });
  Object.assign(eb, { x: 0, z: 0.5, heading: 0.5 * Math.PI, size: C.SNOW_MIN_SIZE, dirX: 0, dirZ: 0, vx: 0, vz: 0 });
  Object.assign(ec, { x: 0.1, z: -1.2, heading: 0.5 * Math.PI, size: C.SNOW_MIN_SIZE, dirX: 0, dirZ: 0, vx: 0, vz: 0 });
  g.at(1000);
  g.arcade.snowClock = g.now;
  g.input(a, { action: "throw" });
  g.run(1030, 2400, 30);
  assert.equal(eb.taken, 1, "der Erste liegt");
  assert.equal(ec.taken, 1, "und der Zweite auch");
  assert.equal(ea.score, 8, "zweimal vier Punkte");
  g.restore();
});

test("Schneeballhang: wer gegen den Zaun drückt, rollt nicht — und seine Kugel wächst nicht", () => {
  const g = setup("schneeball", 2);
  const [a] = g.players;
  const entry = g.arcade.players[a.id];
  const wall = C.SNOW_W / 2 - C.SNOW_BODY_R;
  Object.assign(entry, { x: wall, z: 0, vx: 0, vz: 0, size: C.SNOW_MIN_SIZE });
  g.input(a, { action: "steer", x: 1, y: 0 });
  g.run(0, 2000, 30, () => g.input(a, { action: "steer", x: 1, y: 0 }));
  assert.equal(entry.x, wall);
  assert.equal(entry.size, C.SNOW_MIN_SIZE, "im Stehen am Zaun wächst nichts");
  g.restore();
});

test("Schneeballhang: gleich schnell, egal wie lang der Servertakt ist", () => {
  const pos = (every) => {
    const g = setup("schneeball", 2);
    const [a] = g.players;
    const entry = g.arcade.players[a.id];
    Object.assign(entry, { x: -2, z: 0, vx: 0, vz: 0, heading: Math.PI / 2 });
    g.input(a, { action: "steer", x: 1, y: 0.3 });
    g.run(0, 1440, every);        // 1440 ist ein Vielfaches von 30 und 90
    const out = { x: entry.x, z: entry.z, size: entry.size };
    g.restore();
    return out;
  };
  const fine = pos(30);
  const coarse = pos(90);
  assert.ok(Math.abs(fine.x - coarse.x) < 1e-9 && Math.abs(fine.z - coarse.z) < 1e-9, JSON.stringify({ fine, coarse }));
  assert.ok(Math.abs(fine.size - coarse.size) < 1e-9);
});

// Das Gerät rechnet das Feld bis zur Ankunft seines Sticks voraus
// (Schneeball.js). Dafür muss es Schritt für Schritt genauso rechnen.
test("Schneeballhang: Gerät und Server rechnen Schritt für Schritt gleich", async () => {
  const { stepSnow, snowRules, throwBall, canThrow } = await import("../client/src/minigames/Schneeball.js");
  const g = setup("schneeball", 4);
  const arcade = g.arcade;
  const rules = snowRules(arcade);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ids = arcade.order;
  const server = ids.map((id) => ({ id, entry: arcade.players[id] }));
  const device = ids.map((id) => ({ id, entry: JSON.parse(JSON.stringify(arcade.players[id])) }));
  const world = { rules, balls: [], players: new Map(device.map(({ id, entry }) => [id, entry])) };
  let now = arcade.startedAt;
  let nextId = 1;
  for (let k = 0; k < 900; k += 1) {
    if (k % 8 === 0) {
      server.forEach(({ entry }, i) => {
        // Meist auf einen Gegner zu, damit es Treffer gibt.
        const other = server[(i + 1 + Math.floor(rnd() * 3)) % 4].entry;
        const a = rnd() < 0.7 ? Math.atan2(other.x - entry.x, other.z - entry.z) : rnd() * Math.PI * 2;
        const m = 0.3 + rnd() * 0.7;
        [entry, device[i].entry].forEach((e) => { e.dirX = Math.sin(a) * m; e.dirZ = Math.cos(a) * m; });
      });
    }
    if (k % 20 === 7) {
      server.forEach(({ id, entry }, i) => {
        if (!canThrow(rules, device[i].entry, now)) return;
        arcade.snow.balls.push(party.snowThrowBall(entry, nextId, id, now));
        world.balls.push(throwBall(rules, device[i].entry, nextId, id, now));
        nextId += 1;
        [entry, device[i].entry].forEach((e) => { e.size = C.SNOW_MIN_SIZE; e.lastThrowAt = now; });
      });
    }
    now += C.SNOW_STEP_MS;
    party.snowStep(arcade, server, C.SNOW_STEP_MS / 1000, now);
    stepSnow(world, device, C.SNOW_STEP_MS / 1000, now, []);
  }
  const keys = ["x", "z", "vx", "vz", "heading", "size", "stunUntil", "safeUntil", "score", "taken", "blocks"];
  server.forEach(({ entry }, i) => {
    keys.forEach((key) => assert.ok(Math.abs((entry[key] || 0) - (device[i].entry[key] || 0)) < 1e-6, `${key}: ${entry[key]} gegen ${device[i].entry[key]}`));
  });
  assert.deepEqual(arcade.snow.balls.map((b) => b.id), world.balls.map((b) => b.id));
  const hits = server.reduce((sum, { entry }) => sum + entry.taken + entry.blocks, 0);
  assert.ok(hits >= 3, `es gab Treffer und Blocks (${hits}) — sonst prüft der Test wenig`);
  g.restore();
});

// --- Luftpuck --------------------------------------------------------------

test("Luftpuck: jeder bleibt in seiner Hälfte", () => {
  const g = setup("luftpuck", 2);
  const [a, b] = g.players;
  g.input(a, { action: "steer", x: 0, y: -1 });      // Team 0 will nach oben über die Mitte
  g.input(b, { action: "steer", x: 0, y: 1 });       // Team 1 nach unten
  g.run(0, 3000, 30, () => { g.input(a, { action: "steer", x: 0, y: -1 }); g.input(b, { action: "steer", x: 0, y: 1 }); });
  assert.ok(g.arcade.players[a.id].z > 0, "Team 0 bleibt unten");
  assert.ok(g.arcade.players[b.id].z < 0, "Team 1 bleibt oben");
  g.restore();
});

test("Luftpuck: ein Schuss ins Tor zählt für das andere Team, dann Anstoss", () => {
  const g = setup("luftpuck", 2);
  const [a] = g.players;
  const state = g.arcade.hockey;
  g.run(0, C.HOCKEY_SERVE_MS + 100, 30);
  // Puck direkt aufs obere Tor (das von Team 1) schicken; der Torwart steht
  // aus dem Weg.
  Object.assign(g.arcade.players[g.players[1].id], { x: 1.8, z: -1 });
  Object.assign(state.puck, { x: 0, z: -2, vx: 0, vz: -8 });
  state.lastTouch = a.id;
  g.run(C.HOCKEY_SERVE_MS + 130, C.HOCKEY_SERVE_MS + 900, 20);
  assert.deepEqual(state.score, [1, 0]);
  assert.equal(g.arcade.players[a.id].goals, 1);
  assert.equal(state.puck.x, 0);
  assert.equal(state.puck.z, 0, "nach dem Tor liegt der Puck in der Mitte");
  g.restore();
});

test("Luftpuck: ein eingeklemmter Puck wird freigeblasen", () => {
  const g = setup("luftpuck", 2);
  const [a] = g.players;
  const state = g.arcade.hockey;
  g.run(0, C.HOCKEY_SERVE_MS + 100, 30);
  // Scheibe drückt den Puck in die Ecke.
  const corner = { x: C.HOCKEY_W / 2 - C.HOCKEY_PUCK_R, z: C.HOCKEY_L / 2 - C.HOCKEY_PUCK_R };
  Object.assign(state.puck, { ...corner, vx: 0, vz: 0 });
  Object.assign(g.arcade.players[a.id], { x: corner.x - 0.4, z: corner.z - 0.4 });
  g.run(C.HOCKEY_SERVE_MS + 130, C.HOCKEY_SERVE_MS + 2600, 30, () => g.input(a, { action: "steer", x: 1, y: 1 }));
  assert.ok(state.nudges >= 1, "der Tisch hat geblasen");
  g.restore();
});

test("Luftpuck: fünf Tore beenden das Spiel", () => {
  const g = setup("luftpuck", 2);
  g.arcade.hockey.score = [5, 2];
  g.run(0, 2000, 50);
  assert.ok(g.minigame.finaleAt, "Finale beginnt");
  const [a, b] = g.players;
  assert.ok(arcadeRankingScore(g.arcade, g.arcade.players[a.id]) > arcadeRankingScore(g.arcade, g.arcade.players[b.id]));
  g.restore();
});

test("Luftpuck: im Zweierteam bleibt jeder in seiner Zone", () => {
  const g = setup("luftpuck", 4);
  const sturm = g.players.find((p) => g.arcade.players[p.id].side === 0 && g.arcade.players[p.id].lane === "sturm");
  const abwehr = g.players.find((p) => g.arcade.players[p.id].side === 0 && g.arcade.players[p.id].lane === "abwehr");
  assert.ok(sturm && abwehr, "Team 0 hat Sturm und Abwehr");
  const steer = () => {
    g.input(sturm, { action: "steer", x: 0, y: 1 });     // der Sturm will zum eigenen Tor
    g.input(abwehr, { action: "steer", x: 0, y: -1 });   // die Abwehr zur Mittellinie
  };
  steer();
  g.run(0, 3000, 30, steer);
  assert.ok(g.arcade.players[sturm.id].z <= C.HOCKEY_LANE_STURM + 1e-9, "der Sturm bleibt vorn");
  assert.ok(g.arcade.players[abwehr.id].z >= C.HOCKEY_LANE_ABWEHR - 1e-9, "die Abwehr bleibt hinten");
  g.restore();
});

test("Luftpuck: eine zurückweichende Scheibe schiebt den Puck nicht ins eigene Tor", () => {
  const g = setup("luftpuck", 2);
  const [a] = g.players;
  const state = g.arcade.hockey;
  const entry = g.arcade.players[a.id];
  g.run(0, C.HOCKEY_SERVE_MS + 100, 30);
  // Der Puck kommt schnell aufs Tor von Team 0 zu, die Scheibe weicht vor ihm
  // zurück, langsamer als er.
  Object.assign(entry, { x: 0, z: 1.5, vx: 0, vz: 3, dirX: 0, dirZ: 1 });
  Object.assign(state.puck, { x: 0, z: 0.85, vx: 0, vz: 5 });
  g.at(C.HOCKEY_SERVE_MS + 130);
  g.arcade.hockeyClock = g.now;
  for (let t = C.HOCKEY_SERVE_MS + 160; t <= C.HOCKEY_SERVE_MS + 400; t += 30) {
    g.at(t);
    g.input(a, { action: "steer", x: 0, y: 1 });
    g.tick();
    if (entry.touches) break;
  }
  assert.ok(entry.touches >= 1, "die Scheibe hat den Puck berührt");
  assert.ok(state.puck.vz < 5, `der Puck wird gebremst, nicht angeschoben (vz ${state.puck.vz.toFixed(2)})`);
  g.restore();
});

test("Luftpuck: ein abgefälschter Schuss zählt für den Schützen, nicht als Eigentor", () => {
  const g = setup("luftpuck", 2);
  const [a, b] = g.players;          // a: Team 0 (unten), b: Team 1 (oben)
  const state = g.arcade.hockey;
  g.run(0, C.HOCKEY_SERVE_MS + 100, 30);
  // b steht still vor dem eigenen Tor, a hat eben aufs Tor geschossen.
  Object.assign(g.arcade.players[b.id], { x: 0.55, z: -C.HOCKEY_L / 2 + 0.7, vx: 0, vz: 0, dirX: 0, dirZ: 0 });
  Object.assign(g.arcade.players[a.id], { x: -1.5, z: 3, vx: 0, vz: 0, dirX: 0, dirZ: 0 });
  Object.assign(state.puck, { x: 0, z: -1.5, vx: 0, vz: -8 });
  state.lastTouch = a.id;
  state.lastBy = [{ id: a.id, at: g.now }, null];
  g.at(C.HOCKEY_SERVE_MS + 130);
  g.arcade.hockeyClock = g.now;
  g.run(C.HOCKEY_SERVE_MS + 160, C.HOCKEY_SERVE_MS + 1200, 30);
  assert.deepEqual(state.score, [1, 0], "Tor für Team 0");
  assert.equal(g.arcade.players[b.id].touches, 1, "der Verteidiger hat ihn gestreift");
  assert.equal(state.goals[0].own, false, "kein Eigentor");
  assert.equal(state.goals[0].by, a.id);
  assert.equal(g.arcade.players[a.id].goals, 1);
  g.restore();
});

test("Luftpuck: gleich schnell, egal wie lang der Servertakt ist", () => {
  const pos = (every) => {
    const g = setup("luftpuck", 2);
    const [a] = g.players;
    g.arcade.seed = 853;                   // der Anstoss hängt am Seed
    g.input(a, { action: "steer", x: 0.8, y: -0.4 });
    g.run(0, 1440, every);                // 1440 ist ein Vielfaches von 30 und 90
    const out = { x: g.arcade.players[a.id].x, z: g.arcade.players[a.id].z, puck: { ...g.arcade.hockey.puck } };
    g.restore();
    return out;
  };
  const fine = pos(30);
  const coarse = pos(90);
  assert.ok(Math.abs(fine.x - coarse.x) < 1e-9 && Math.abs(fine.z - coarse.z) < 1e-9, JSON.stringify({ fine, coarse }));
  assert.ok(Math.abs(fine.puck.x - coarse.puck.x) < 1e-9 && Math.abs(fine.puck.z - coarse.puck.z) < 1e-9);
});

// Das Gerät rechnet den Tisch bis zur Ankunft seines Sticks voraus
// (Puckbahn.js). Dafür muss es Schritt für Schritt genauso rechnen.
test("Luftpuck: Gerät und Server rechnen Schritt für Schritt gleich", async () => {
  const { stepHockey, hockeyRules } = await import("../client/src/minigames/Puckbahn.js");
  for (const count of [4, 1]) {
    const g = setup("luftpuck", count);
    const arcade = g.arcade;
    const rules = hockeyRules(arcade);
    let seed = 5 + count;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const server = party.hockeyMallets(arcade, g.room);
    const device = JSON.parse(JSON.stringify(server));
    const devState = JSON.parse(JSON.stringify(arcade.hockey));
    const devRobot = device.find((m) => m.robot);
    if (devRobot) devState.robot = devRobot.e;
    let now = arcade.startedAt;
    for (let k = 0; k < 1500; k += 1) {
      if (k % 6 === 0) {
        server.forEach((m, i) => {
          if (m.robot) return;
          // Meist auf den Puck zu, damit es Stösse, Tore und Abpraller gibt.
          const p = arcade.hockey.puck;
          const a = rnd() < 0.7 ? Math.atan2(p.x - m.e.x, p.z - m.e.z) : rnd() * Math.PI * 2;
          const mag = 0.4 + rnd() * 0.6;
          [m.e, device[i].e].forEach((e) => { e.dirX = Math.sin(a) * mag; e.dirZ = Math.cos(a) * mag; });
        });
      }
      now += C.HOCKEY_STEP_MS;
      party.hockeyStep(arcade.hockey, server, now, arcade.seed || 0);
      stepHockey(rules, devState, device, now, arcade.seed || 0, []);
    }
    const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} gegen ${b} (${count} Spieler)`);
    server.forEach((m, i) => ["x", "z", "vx", "vz"].forEach((key) => near(m.e[key], device[i].e[key], `${m.id}.${key}`)));
    ["x", "z", "vx", "vz"].forEach((key) => near(arcade.hockey.puck[key], devState.puck[key], `puck.${key}`));
    assert.deepEqual(arcade.hockey.score, devState.score);
    assert.ok(arcade.hockey.touches >= 8, `es gab Stösse (${arcade.hockey.touches})`);
    g.restore();
  }
});

// --- Bücherwurm ------------------------------------------------------------

test("Bücherwurm: Seiten mit Löchern, die weniger werden, und Löcher liegen im Buch", () => {
  for (const seed of [857001, 857444, 3]) {
    const pages = party.buildBookPages(seed);
    assert.ok(pages.length >= 10, `${pages.length} Seiten`);
    assert.ok(pages[0].holes.length >= 3 && pages[pages.length - 1].holes.length === 1);
    pages.forEach((page) => {
      assert.ok(page.holes.length >= 1, "jede Seite hat mindestens ein Loch");
      page.holes.forEach((h) => {
        assert.ok(Math.abs(h.x) + h.w / 2 <= C.BOOK_W / 2 && Math.abs(h.z) + h.d / 2 <= C.BOOK_D / 2, "Loch ragt über die Seite");
        assert.ok(h.w >= 0.62 + 0.2 && h.d >= 0.62 + 0.2, "in jedes Loch passt eine Figur");
      });
    });
  }
});

test("Bücherwurm: wer im Loch steht, übersteht die Seite — wer nicht, wird platt", () => {
  const g = setup("buecherwurm", 2);
  const [a, b] = g.players;
  const page = g.arcade.secret.bookPages[0];
  const hole = page.holes[0];
  Object.assign(g.arcade.players[a.id], { x: hole.x, z: hole.z });
  // b steht sicher ausserhalb aller Löcher: in einer Ecke, die kein Loch trifft.
  const corners = [[-2.6, -3.4], [2.6, -3.4], [-2.6, 3.4], [2.6, 3.4]];
  const free = corners.find(([x, z]) => !party.bookInHole(page, x, z));
  Object.assign(g.arcade.players[b.id], { x: free[0], z: free[1] });
  g.run(0, page.slamAt + 60, 30);
  assert.equal(g.arcade.players[a.id].survived, 1);
  assert.equal(g.arcade.players[b.id].lives, C.BOOK_LIVES - 1);
  assert.ok(g.arcade.players[b.id].flatUntil > g.now - 50, "b ist platt und kann kurz nicht laufen");
  g.restore();
});

test("Bücherwurm: drei Mal platt, und man ist raus", () => {
  const g = setup("buecherwurm", 2);
  const [, b] = g.players;
  g.run(0, g.minigame.duration, 40, () => {
    // b rennt immer in die Ecke, die gerade kein Loch hat.
    const page = g.arcade.secret.bookPages.find((p) => p.index > g.arcade.book.slammed);
    if (!page) return;
    const free = [[-2.6, -3.4], [2.6, -3.4], [-2.6, 3.4], [2.6, 3.4]].find(([x, z]) => !party.bookInHole(page, x, z));
    if (free) Object.assign(g.arcade.players[b.id], { x: free[0], z: free[1] });
  });
  assert.ok(g.arcade.players[b.id].outAt, "nach drei Seiten ist b raus");
  assert.equal(g.arcade.players[b.id].lives, 0);
  g.restore();
});

test("Bücherwurm: die Löcher einer Seite sieht das Gerät erst kurz vorher", () => {
  const g = setup("buecherwurm", 2);
  const pages = g.arcade.secret.bookPages;
  const shown = () => JSON.parse(JSON.stringify(publicArcade(g.arcade)));
  assert.ok(!JSON.stringify(shown()).includes("bookPages"), "kein Geheimfach im Paket");
  assert.deepEqual(shown().book.pages.map((p) => p.slamAt), pages.map((p) => p.slamAt), "die Zeiten sehen alle");
  // Seite 1: bis sie kommt, kann noch niemand ausgeschieden sein (drei
  // Leben) — bei einer späteren wäre das Spiel mit zwei Stillstehenden
  // womöglich schon vorbei.
  const later = pages[1];
  assert.equal(shown().book.pages[2].holes, null, "spätere Seiten sind geheim");
  g.run(0, later.at - C.BOOK_PUBLISH_LEAD_MS - 40, 30);
  assert.equal(shown().book.pages[1].holes, null, "zu früh: die Löcher sind noch geheim");
  g.run(later.at - C.BOOK_PUBLISH_LEAD_MS, later.at - C.BOOK_PUBLISH_LEAD_MS + 30, 30);
  assert.deepEqual(shown().book.pages[1].holes, later.holes, "kurz vorher: jetzt darf das Gerät sie kennen");
  g.restore();
});

test("Bücherwurm: gleich schnell, egal wie lang der Servertakt ist", () => {
  const pos = (every) => {
    const g = setup("buecherwurm", 2);
    const [a] = g.players;
    g.input(a, { action: "steer", x: 0.7, y: -0.6 });
    g.run(0, 1440, every);                // 1440 ist ein Vielfaches von 30 und 90
    const e = g.arcade.players[a.id];
    const out = { x: e.x, z: e.z };
    g.restore();
    return out;
  };
  const fine = pos(30);
  const coarse = pos(90);
  assert.ok(Math.abs(fine.x - coarse.x) < 1e-9 && Math.abs(fine.z - coarse.z) < 1e-9, JSON.stringify({ fine, coarse }));
});

// Das Gerät rechnet das Buch bis zur Ankunft seines Sticks voraus
// (Buchseite.js). Dafür muss es Schritt für Schritt genauso rechnen.
test("Bücherwurm: Gerät und Server rechnen Schritt für Schritt gleich", async () => {
  const { stepBook, bookRules } = await import("../client/src/minigames/Buchseite.js");
  const g = setup("buecherwurm", 4);
  const arcade = g.arcade;
  const rules = bookRules(arcade);
  const pages = arcade.secret.bookPages;
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const server = arcade.order.map((id) => ({ id, entry: arcade.players[id] }));
  const device = JSON.parse(JSON.stringify(server));
  const devState = { slammed: arcade.book.slammed, lastHits: null };
  let now = arcade.startedAt;
  const steps = Math.ceil((pages[pages.length - 1].slamAt + 200) / C.BOOK_STEP_MS);
  for (let k = 0; k < steps; k += 1) {
    if (k % 7 === 0) {
      server.forEach(({ entry }, i) => {
        // Meist auf ein Loch der kommenden Seite zu, damit manche überleben.
        const page = pages.find((p) => p.index > arcade.book.slammed) || pages[0];
        const hole = page.holes[Math.floor(rnd() * page.holes.length)];
        const a = rnd() < 0.75 ? Math.atan2(hole.x - entry.x, hole.z - entry.z) : rnd() * Math.PI * 2;
        const m = rnd();
        [entry, device[i].entry].forEach((e) => { e.dirX = Math.sin(a) * m; e.dirZ = Math.cos(a) * m; });
      });
    }
    now += C.BOOK_STEP_MS;
    party.bookStep(arcade.book, pages, server, C.BOOK_STEP_MS / 1000, now, arcade.startedAt);
    stepBook(rules, devState, pages, device, C.BOOK_STEP_MS / 1000, now, arcade.startedAt, []);
  }
  const keys = ["x", "z", "vx", "vz", "lives", "flatUntil", "survived", "squashed", "safeMs"];
  server.forEach(({ entry }, i) => keys.forEach((key) => assert.ok(Math.abs((entry[key] || 0) - (device[i].entry[key] || 0)) < 1e-6, `${key}: ${entry[key]} gegen ${device[i].entry[key]}`)));
  assert.equal(devState.slammed, arcade.book.slammed);
  const survived = server.reduce((sum, { entry }) => sum + entry.survived, 0);
  const squashed = server.reduce((sum, { entry }) => sum + entry.squashed, 0);
  assert.ok(survived > 0 && squashed > 0, `es gab Überstandene (${survived}) und Platte (${squashed})`);
  g.restore();
});

// --- Schnappschuss ---------------------------------------------------------

test("Schnappschuss: wer im Ausschnitt steht, ist auf dem Foto — die Mitte bekommt das Titelbild", () => {
  const g = setup("schnappschuss", 3);
  const [a, b, c] = g.players;
  const shot = g.arcade.secret.photoShots[0];
  Object.assign(g.arcade.players[a.id], { x: shot.x, z: shot.z });
  Object.assign(g.arcade.players[b.id], { x: shot.x + shot.r * 0.7, z: shot.z });
  Object.assign(g.arcade.players[c.id], { x: shot.x + shot.r + 1.5 > 3 ? shot.x - shot.r - 1.5 : shot.x + shot.r + 1.5, z: shot.z });
  g.run(0, shot.shootAt + 40, 30);
  const result = g.arcade.photo.results[0];
  const pts = Object.fromEntries(result.in.map((item) => [item.id, item.points]));
  assert.equal(pts[a.id], C.PHOTO_IN + C.PHOTO_COVER, "Mitte: Foto plus Titelbild");
  assert.equal(pts[b.id], C.PHOTO_IN, "am Rand: nur aufs Foto");
  assert.equal(pts[c.id], undefined, "daneben: nicht drauf");
  g.restore();
});

test("Schnappschuss: allein im Bild gibt es noch etwas dazu", () => {
  const g = setup("schnappschuss", 2);
  const [a, b] = g.players;
  const shot = g.arcade.secret.photoShots[0];
  Object.assign(g.arcade.players[a.id], { x: shot.x, z: shot.z });
  Object.assign(g.arcade.players[b.id], { x: shot.x > 0 ? -2.8 : 2.8, z: shot.z > 0 ? -3.2 : 3.2 });
  g.run(0, shot.shootAt + 40, 30);
  assert.equal(g.arcade.players[a.id].score, C.PHOTO_IN + C.PHOTO_COVER + C.PHOTO_SOLO);
  g.restore();
});

test("Schnappschuss: SCHUBS stösst den, der vor einem steht, weg — danach erst wieder nach der Pause", () => {
  const g = setup("schnappschuss", 2);
  const [a, b] = g.players;
  Object.assign(g.arcade.players[a.id], { x: 0, z: 1, heading: Math.PI });
  Object.assign(g.arcade.players[b.id], { x: 0, z: 0.4 });
  g.run(0, 480, 30);
  g.input(a, { action: "shove" });
  g.run(510, 600, 30);
  assert.ok(g.arcade.players[b.id].stunUntil > g.now, "b taumelt");
  g.run(630, 1000, 30);
  assert.ok(g.arcade.players[b.id].z < -0.2, `b wurde weggeschoben (z ${g.arcade.players[b.id].z.toFixed(2)})`);
  g.input(a, { action: "shove" });
  g.run(1030, 1100, 30);
  assert.equal(g.arcade.players[a.id].shoves, 1, "danach erst wieder nach der Pause");
  g.restore();
});

test("Schnappschuss: SCHUBS trifft bei Berührung, nicht schon beim Drücken", () => {
  const g = setup("schnappschuss", 3);
  const [a, near, far] = g.players;
  Object.assign(g.arcade.players[a.id], { x: 0, z: 2, heading: Math.PI });
  Object.assign(g.arcade.players[near.id], { x: 0, z: 0.7 });            // 1,3 vor a: erst nach dem Vorschnellen erreicht
  Object.assign(g.arcade.players[far.id], { x: 2.5, z: 2 });             // daneben, nicht in Blickrichtung
  g.run(0, 480, 30);
  g.input(a, { action: "shove" });
  g.run(510, 510, 30);
  assert.equal(g.arcade.players[near.id].stunUntil, 0, "noch nicht erreicht — noch nicht getroffen");
  g.run(540, 800, 30);
  assert.ok(g.arcade.players[near.id].shoved === 1, "beim Aufprall fliegt er");
  assert.equal(g.arcade.players[far.id].shoved, 0, "wer daneben steht, bleibt stehen");
  assert.ok(g.arcade.players[a.id].z > 0.2, `wer trifft, bleibt stehen, statt durchzuschiessen (z ${g.arcade.players[a.id].z.toFixed(2)})`);
  g.restore();
});

test("Schnappschuss: im Gedränge hält die Mitte, wer zuerst da ist — auf jedem Platz", () => {
  // Vorher wurde das Gedränge Paar für Paar aufgelöst: wer zuletzt gerechnet
  // wurde, blieb in der Mitte stehen — liefen alle hin, bekam Platz 4 zwölf
  // von dreizehn Titelbildern.
  for (let first = 0; first < 4; first += 1) {
    const g = setup("schnappschuss", 4);
    const shot = g.arcade.secret.photoShots[0];
    let runner = 0;
    g.players.forEach((p, i) => {
      const e = g.arcade.players[p.id];
      if (i === first) Object.assign(e, { x: shot.x, z: shot.z });
      else {
        const a = (runner * Math.PI * 2) / 3 + 0.3;
        runner += 1;
        Object.assign(e, { x: shot.x + Math.sin(a) * 1.2, z: shot.z + Math.cos(a) * 1.2 });
      }
    });
    g.run(0, shot.shootAt + 40, 30, () => {
      g.players.forEach((p, i) => {
        if (i === first) return;
        const e = g.arcade.players[p.id];
        const dx = shot.x - e.x;
        const dz = shot.z - e.z;
        const d = Math.hypot(dx, dz) || 1;
        g.input(p, { action: "steer", x: dx / d, y: dz / d });
      });
    });
    const cover = g.arcade.photo.results[0].in.find((item) => item.cover);
    assert.equal(cover?.id, g.players[first].id, `Platz ${first + 1} stand zuerst in der Mitte`);
    g.restore();
  }
});

test("Schnappschuss: wo der nächste Ausschnitt liegt, sieht das Gerät erst kurz vorher", () => {
  const g = setup("schnappschuss", 2);
  const shots = g.arcade.secret.photoShots;
  const shown = () => JSON.parse(JSON.stringify(publicArcade(g.arcade)));
  assert.ok(!JSON.stringify(shown()).includes("photoShots"), "kein Geheimfach im Paket");
  assert.deepEqual(shown().photo.shots.map((s) => s.shootAt), shots.map((s) => s.shootAt), "die Zeiten sehen alle");
  const later = shots[3];
  g.run(0, later.at - C.PHOTO_PUBLISH_LEAD_MS - 60, 30);
  assert.equal(shown().photo.shots[3].x, null, "zu früh: noch geheim");
  assert.ok(shown().photo.shots.slice(4).every((s) => s.x === null), "und alle späteren erst recht");
  g.run(later.at - C.PHOTO_PUBLISH_LEAD_MS - 30, later.at - C.PHOTO_PUBLISH_LEAD_MS + 30, 30);
  const now = shown().photo.shots[3];
  assert.deepEqual([now.x, now.z, now.r], [later.x, later.z, later.r], "kurz vorher: jetzt darf das Gerät es wissen");
  g.restore();
});

test("Schnappschuss: gleich schnell, egal wie lang der Servertakt ist", () => {
  const pos = (every) => {
    const g = setup("schnappschuss", 2);
    const [a] = g.players;
    g.input(a, { action: "steer", x: 0.7, y: -0.6 });
    g.run(0, 1440, every);                // 1440 ist ein Vielfaches von 30 und 90
    const e = g.arcade.players[a.id];
    const out = { x: e.x, z: e.z, heading: e.heading };
    g.restore();
    return out;
  };
  const fine = pos(30);
  const coarse = pos(90);
  assert.ok(Math.abs(fine.x - coarse.x) < 1e-9 && Math.abs(fine.z - coarse.z) < 1e-9 && Math.abs(fine.heading - coarse.heading) < 1e-9, JSON.stringify({ fine, coarse }));
});

test("Schnappschuss: Gerät und Server rechnen Schritt für Schritt gleich", async () => {
  const { stepPhoto, photoRules } = await import("../client/src/minigames/Fotobuehne.js");
  const g = setup("schnappschuss", 4);
  const arcade = g.arcade;
  const rules = photoRules(arcade);
  const shots = arcade.secret.photoShots;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const server = arcade.order.map((id) => ({ id, entry: arcade.players[id] }));
  const device = JSON.parse(JSON.stringify(server));
  const devState = { shot: arcade.photo.shot, results: [] };
  let now = arcade.startedAt;
  const steps = Math.ceil((shots[shots.length - 1].shootAt + 200) / C.PHOTO_STEP_MS);
  for (let k = 0; k < steps; k += 1) {
    if (k % 6 === 0) {
      server.forEach(({ entry }, i) => {
        // Meist zum Ausschnitt, damit es Gedränge und Treffer gibt.
        const shot = shots.find((s) => s.index > arcade.photo.shot) || shots[0];
        const a = rnd() < 0.8 ? Math.atan2(shot.x - entry.x, shot.z - entry.z) : rnd() * Math.PI * 2;
        const m = 0.4 + rnd() * 0.6;
        [entry, device[i].entry].forEach((e) => { e.dirX = Math.sin(a) * m; e.dirZ = Math.cos(a) * m; });
        if (rnd() < 0.3) [entry, device[i].entry].forEach((e) => { e.shoveQueued = true; });
      });
    }
    now += C.PHOTO_STEP_MS;
    party.photoStep(arcade.photo, shots, server, C.PHOTO_STEP_MS, now, arcade.startedAt);
    stepPhoto(rules, devState, shots, device, C.PHOTO_STEP_MS, now, arcade.startedAt, []);
  }
  const keys = ["x", "z", "vx", "vz", "heading", "stunUntil", "dashUntil", "lastShoveAt", "shoves", "shoved", "hits", "photos", "covers", "score"];
  server.forEach(({ entry }, i) => keys.forEach((key) => assert.ok(Math.abs((entry[key] || 0) - (device[i].entry[key] || 0)) < 1e-6, `${key}: ${entry[key]} gegen ${device[i].entry[key]}`)));
  assert.equal(devState.shot, arcade.photo.shot);
  const shoved = server.reduce((sum, { entry }) => sum + entry.shoved, 0);
  const covers = server.reduce((sum, { entry }) => sum + entry.covers, 0);
  assert.ok(shoved >= 8 && covers > 5, `es gab Treffer (${shoved}) und Titelbilder (${covers})`);
  g.restore();
});

test("Schnappschuss: die Bots sind gestaffelt, der starke reagiert wie ein Mensch", () => {
  const sums = { easy: 0, normal: 0, hard: 0 };
  const reactions = [];
  const runs = 30;
  for (let r = 0; r < runs; r += 1) {
    const g = setup("schnappschuss", 3, { bots: true });
    const levels = ["easy", "normal", "hard"];
    g.players.forEach((p, i) => { g.arcade.players[p.id].botProfile = { level: levels[i] }; });
    const hard = g.arcade.players[g.players[2].id];
    const shots = g.arcade.secret.photoShots;
    const seen = new Set();
    for (let t = 0; t <= g.minigame.duration; t += 30) {
      g.at(t);
      if (t % 150 === 0) g.players.forEach((p) => arcadeBotStep(g.room, p));
      g.tick();
      // Wann zeigt der Stick des starken auf den neuen Ausschnitt? Zwischen
      // den Bildern läuft er zur Bühnenmitte — Laufen allein heisst nichts.
      const shot = shots.find((s) => s.index > g.arcade.photo.shot && t >= s.at);
      if (!shot || seen.has(shot.index)) continue;
      const dx = shot.x - hard.x;
      const dz = shot.z - hard.z;
      const d = Math.hypot(dx, dz);
      const stick = Math.hypot(hard.dirX, hard.dirZ);
      if (d > 0.4 && stick > 0.3 && (hard.dirX * dx + hard.dirZ * dz) / (stick * d) > 0.9) {
        seen.add(shot.index);
        reactions.push(t - shot.at);
      }
    }
    g.players.forEach((p, i) => { sums[levels[i]] += g.arcade.players[p.id].score; });
    g.restore();
  }
  assert.ok(sums.hard > sums.normal && sums.normal > sums.easy, JSON.stringify(sums));
  reactions.sort((x, y) => x - y);
  const median = reactions[Math.floor(reactions.length / 2)];
  assert.ok(median >= 350, `der starke läuft erst los, wenn ein Mensch den Ausschnitt gesehen hätte (Median ${median} ms)`);
});

// --- Kippboot --------------------------------------------------------------

test("Kippboot: abgesetzt wird, wo der Haken gerade hängt — aussen gibt es mehr", () => {
  const g = setup("kippboot", 2);
  g.run(0, C.BOAT_LEAD_MS + 50, 30);
  const state = g.arcade.boat;
  const turn = state.turn;
  const current = g.players.find((p) => p.id === turn.playerId);
  const other = g.players.find((p) => p.id !== turn.playerId);
  assert.equal(g.input(other, { action: "drop" }).ok, false, "wer nicht dran ist, darf nicht");
  // Ein Augenblick, in dem der Haken sicher über dem Boot hängt. Vorher war
  // es fest +400 ms: hing dort ein Schwein weit aussen, kenterte schon das
  // leere Boot — und die Punkte kamen aus dem ungerundeten statt dem
  // abgesetzten x, was an einer Rundungsgrenze ab und zu um eins danebenlag.
  let t = 300;
  while (Math.abs(party.boatSwingX(turn, turn.from + t)) > 0.9 && t < 3000) t += 10;
  g.at(turn.from + t);
  const x = party.boatSwingX(turn, turn.from + t);
  g.input(current, { action: "drop" });
  assert.equal(state.passengers.length, 1);
  const placed = state.passengers[0];
  assert.ok(Math.abs(placed.x - x) < 0.006, "dort, wo der Haken war");
  assert.equal(g.arcade.players[current.id].score, party.boatPoints(turn.w, placed.x));
  assert.ok(party.boatPoints(2, C.BOAT_REACH) === 3 * party.boatPoints(2, 0), "Rand dreifach, Mitte einfach");
  g.restore();
});

test("Kippboot: zu viel auf einer Seite kentert — der Kipper verliert, alle gehen baden", () => {
  const g = setup("kippboot", 2);
  g.run(0, C.BOAT_LEAD_MS + 50, 30);
  const state = g.arcade.boat;
  state.passengers = [{ kind: "schwein", w: 3, x: 1.2, by: "x", slot: 0 }];
  state.torque = 3.6;
  const turn = state.turn;
  // Den Moment abpassen, in dem der Haken weit rechts ist.
  let t = 0;
  while (party.boatSwingX(turn, turn.from + t) < 1.3 && t < 4000) t += 10;
  g.at(turn.from + t);
  const current = g.players.find((p) => p.id === turn.playerId);
  g.input(current, { action: "drop" });
  assert.equal(state.last.kind, "capsize");
  assert.equal(g.arcade.players[current.id].score, -C.BOAT_CAPSIZE_COST);
  assert.equal(state.passengers.length, 0, "ein neues, leeres Boot");
  g.restore();
});

test("Kippboot: ein volles Boot legt ab, und alle Lader bekommen die Zugabe", () => {
  const g = setup("kippboot", 2);
  g.run(0, C.BOAT_LEAD_MS + 50, 30);
  const state = g.arcade.boat;
  const [a, b] = g.players;
  state.passengers = Array.from({ length: C.BOAT_CAPACITY - 1 }, (_, i) => ({ kind: "kueken", w: 1, x: 0, by: i % 2 ? a.id : b.id, slot: i }));
  state.torque = 0;
  const turn = state.turn;
  let t = 0;
  while (Math.abs(party.boatSwingX(turn, turn.from + t)) > 0.2 && t < 4000) t += 10;
  g.at(turn.from + t);
  const current = g.players.find((p) => p.id === turn.playerId);
  const before = { a: g.arcade.players[a.id].score, b: g.arcade.players[b.id].score };
  g.input(current, { action: "drop" });
  assert.equal(state.last.kind, "depart");
  assert.ok(g.arcade.players[a.id].score >= before.a + C.BOAT_DEPART_BONUS);
  assert.ok(g.arcade.players[b.id].score >= before.b + C.BOAT_DEPART_BONUS);
  g.restore();
});

test("Kippboot: jeder ist gleich oft dran, und in jeder Runde bekommen alle dasselbe Tier", () => {
  // Vorher mischte jedes neue Boot die Reihenfolge neu, und die Tiere kamen
  // nach Zufall: einer hatte drei Züge, ein anderer sechs, und unter gleich
  // guten Spielern gewann meist, wer die schwersten Tiere bekam.
  for (const n of [2, 3, 4]) {
    const g = setup("kippboot", n, { bots: true });
    const seen = [];
    let lastTurn = -1;
    for (let t = 0; t <= g.minigame.duration; t += 30) {
      g.at(t);
      if (t % 150 === 0) g.players.forEach((p) => arcadeBotStep(g.room, p));
      g.tick();
      const turn = g.arcade.boat.turn;
      if (turn && turn.number !== lastTurn) {
        lastTurn = turn.number;
        seen.push(turn);
      }
      if (g.arcade.boat.finishedAt !== null && t > g.arcade.boat.finishedAt + C.BOAT_END_MS) break;
    }
    const rounds = party.boatRounds(n);
    const drops = g.players.map((p) => g.arcade.players[p.id].drops);
    assert.ok(drops.every((d) => d === rounds), `${n} Spieler: je ${rounds} Züge, nicht ${drops}`);
    for (let r = 0; r < rounds; r += 1) {
      const kinds = new Set(seen.filter((turn) => turn.round === r).map((turn) => turn.kind));
      const omegas = new Set(seen.filter((turn) => turn.round === r).map((turn) => turn.omega));
      assert.equal(kinds.size, 1, `Runde ${r + 1}: ein Tier für alle`);
      assert.equal(omegas.size, 1, `Runde ${r + 1}: gleich schneller Haken für alle`);
    }
    assert.equal(seen[0].kind, "kueken", "es beginnt mit dem Küken");
    assert.equal(seen[seen.length - 1].kind, "schwein", "und endet mit dem Schwein");
    g.restore();
  }
});

test("Kippboot: auch wenn keiner tippt, passen alle Runden in die Zeit", () => {
  const g = setup("kippboot", 4);
  let end = null;
  for (let t = 0; t <= g.minigame.duration; t += 30) {
    g.at(t);
    g.tick();
    if (g.arcade.boat.finishedAt !== null && end === null) end = g.arcade.boat.finishedAt;
  }
  const drops = g.players.map((p) => g.arcade.players[p.id].drops);
  assert.ok(drops.every((d) => d === party.boatRounds(4)), `alle gleich oft: ${drops}`);
  assert.ok(end !== null && end + C.BOAT_END_MS <= g.minigame.duration, `fertig vor der Obergrenze (${end} ms)`);
  g.restore();
});

test("Kippboot: nur Bots dürfen einen geplanten Augenblick mitschicken", () => {
  const g = setup("kippboot", 2);
  g.run(0, C.BOAT_LEAD_MS + 50, 30);
  const turn = g.arcade.boat.turn;
  const current = g.players.find((p) => p.id === turn.playerId);
  // Ein Augenblick, der sich lohnen würde — und einer, in dem der Tipp ankommt.
  let t = 600;
  while (Math.abs(party.boatSwingX(turn, turn.from + t) - party.boatSwingX(turn, turn.from + 300)) < 0.5 && t < 3000) t += 10;
  g.at(turn.from + t);
  g.input(current, { action: "drop", botAt: turn.from + 300 });
  const x = g.arcade.boat.passengers[0]?.x ?? g.arcade.boat.last.x;
  assert.ok(Math.abs(x - party.boatSwingX(turn, turn.from + t)) < 0.006, "ein Gerät kann keine Zeit mitschicken");
  g.restore();
});

test("Kippboot: die Bots sind gestaffelt", () => {
  // Gezählt wird, wer gewinnt — die Punkte liegen eng beieinander (der
  // starke trifft nur etwas genauer), darum 400 Partien; sie kosten
  // zusammen eine Fünftelsekunde.
  const wins = { easy: 0, normal: 0, hard: 0 };
  for (let r = 0; r < 400; r += 1) {
    const g = setup("kippboot", 3, { bots: true });
    const levels = ["easy", "normal", "hard"];
    g.players.forEach((p, i) => { g.arcade.players[p.id].botProfile = { level: levels[i] }; });
    for (let t = 0; t <= g.minigame.duration; t += 30) {
      g.at(t);
      if (t % 150 === 0) g.players.forEach((p) => arcadeBotStep(g.room, p));
      g.tick();
      if (g.arcade.boat.finishedAt !== null && t > g.arcade.boat.finishedAt + C.BOAT_END_MS) break;
    }
    const scores = g.players.map((p) => arcadeRankingScore(g.arcade, g.arcade.players[p.id]));
    const best = Math.max(...scores);
    scores.forEach((score, i) => { if (score === best) wins[levels[i]] += 1; });
    g.restore();
  }
  assert.ok(wins.hard > wins.normal && wins.normal > wins.easy, JSON.stringify(wins));
});

// --- Rohrsalat -------------------------------------------------------------

test("Rohrsalat: jedes Rohrnetz ist eine Vertauschung mit genau einer richtigen Lösung", () => {
  for (const seed of [877001, 877555, 42]) {
    for (let round = 0; round < C.PIPE_ROUNDS; round += 1) {
      const maze = party.buildPipeRound(seed, round);
      const ends = [...Array(maze.cols).keys()].map((v) => party.pipeTrace(maze.rungs, v));
      assert.deepEqual([...ends].sort((a, b) => a - b), [...Array(maze.cols).keys()], "jeder Ausgang genau einmal");
      assert.equal(party.pipeTrace(maze.rungs, maze.answer), maze.target);
      // Zwei Querrohre auf derselben Höhe teilen sich nie ein Rohr.
      maze.rungs.forEach((r, i) => maze.rungs.forEach((o, k) => {
        if (i !== k && r.level === o.level) assert.ok(Math.abs(r.col - o.col) >= 2);
      }));
    }
  }
});

test("Rohrsalat: richtig und schnell bringt am meisten, falsch nichts, eine Wahl je Runde", () => {
  const g = setup("rohrsalat", 3);
  const [fast, slow, wrong] = g.players;
  const maze = g.arcade.secret.pipeRounds[0];
  g.run(0, C.PIPE_LEAD_MS + 500, 50);
  g.input(fast, { action: "pick", valve: maze.answer });
  g.input(fast, { action: "pick", valve: (maze.answer + 1) % maze.cols });
  g.input(wrong, { action: "pick", valve: (maze.answer + 1) % maze.cols });
  g.run(C.PIPE_LEAD_MS + 550, C.PIPE_LEAD_MS + 6000, 50);
  g.input(slow, { action: "pick", valve: maze.answer });
  g.run(C.PIPE_LEAD_MS + 6050, C.PIPE_LEAD_MS + C.PIPE_ANSWER_MS[0] + 400, 50);
  const r = (p) => g.arcade.players[p.id].results[0];
  assert.equal(r(fast).valve, maze.answer, "die erste Wahl zählt");
  assert.ok(r(fast).correct && r(slow).correct && !r(wrong).correct);
  assert.ok(r(fast).points > r(slow).points && r(slow).points >= C.PIPE_POINTS);
  assert.equal(r(wrong).points, 0);
  g.restore();
});

test("Rohrsalat: Lösung, spätere Rohre und fremde Wahl bleiben geheim bis zur Auflösung", () => {
  const g = setup("rohrsalat", 2);
  const [a, b] = g.players;
  const full = g.arcade.secret.pipeRounds;
  const shown = () => JSON.parse(JSON.stringify(publicArcade(g.arcade)));
  assert.ok(!JSON.stringify(shown()).includes("pipePicks") && !JSON.stringify(shown()).includes("pipeRounds"), "kein Geheimfach im Paket");
  assert.ok(shown().pipes.rounds.every((r) => r.answer === null), "keine Lösung vorab");
  assert.ok(shown().pipes.rounds.every((r) => r.rungs === null), "kein Gewirr vorab");
  g.run(0, full[0].startAt - C.PIPE_PUBLISH_LEAD_MS + 30, 30);
  assert.deepEqual(shown().pipes.rounds[0].rungs, full[0].rungs, "kurz vor der Runde: jetzt das Gewirr");
  assert.equal(shown().pipes.rounds[1].rungs, null, "die nächste Runde noch nicht");
  g.run(full[0].startAt, full[0].startAt + 600, 30);
  g.input(a, { action: "pick", valve: full[0].answer });
  const seen = shown();
  assert.equal(seen.players[a.id].picked[0], true, "dass a gewählt hat, sieht man");
  assert.ok(!JSON.stringify(seen.players[a.id]).includes('"valve"'), "welches Ventil, nicht");
  assert.equal(seen.pipes.rounds[0].answer, null, "die Lösung auch nicht");
  g.input(b, { action: "pick", valve: (full[0].answer + 1) % full[0].cols });
  g.run(full[0].startAt + 630, full[0].endAt + C.PIPE_GRACE_MS + 60, 30);
  assert.equal(shown().pipes.rounds[0].answer, full[0].answer, "nach der Wertung: die Lösung");
  assert.equal(shown().players[b.id].results[0].valve, (full[0].answer + 1) % full[0].cols, "und wer was gewählt hat");
  g.restore();
});

test("Rohrsalat: haben alle gewählt, beginnt die Auflösung gleich — und alles rückt nach", () => {
  const g = setup("rohrsalat", 2);
  const [a, b] = g.players;
  const full = g.arcade.secret.pipeRounds;
  const later = full[1].startAt;
  g.run(0, full[0].startAt + 1000, 30);
  g.input(a, { action: "pick", valve: 0 });
  assert.equal(full[0].endAt, full[0].startAt + C.PIPE_ANSWER_MS[0], "einer fehlt noch: die Zeit läuft weiter");
  g.input(b, { action: "pick", valve: 1 });
  const t = g.now - g.minigame.startedAt;
  assert.equal(full[0].endAt, t + C.PIPE_ALL_IN_MS, "beide haben: gleich zur Auflösung");
  assert.ok(full[1].startAt < later, "die nächste Runde kommt früher");
  assert.equal(g.arcade.pipes.rounds[1].startAt, full[1].startAt, "und das Gerät weiss es");
  g.restore();
});

test("Rohrsalat: knapp nach Ablauf zählt der Tipp noch, danach nicht", () => {
  const g = setup("rohrsalat", 3);
  const [a, b] = g.players;
  const full = g.arcade.secret.pipeRounds;
  g.run(0, full[0].endAt - 30, 30);
  g.at(full[0].endAt + C.PIPE_GRACE_MS - 40);
  g.input(a, { action: "pick", valve: full[0].answer });
  g.at(full[0].endAt + C.PIPE_GRACE_MS + 40);
  g.input(b, { action: "pick", valve: full[0].answer });
  g.tick();
  const r = (p) => g.arcade.players[p.id].results[0];
  assert.ok(r(a).correct, "in der Nachfrist angekommen");
  assert.equal(r(b).valve, null, "danach ist es zu spät");
  assert.ok(r(a).points >= C.PIPE_POINTS, "mit den vollen Grundpunkten");
  g.restore();
});

test("Rohrsalat: die Bots sind gestaffelt und folgen den Rohren wie Menschen", () => {
  const wins = { easy: 0, normal: 0, hard: 0 };
  const firstPick = [];
  for (let r = 0; r < 120; r += 1) {
    const g = setup("rohrsalat", 3, { bots: true });
    const levels = ["easy", "normal", "hard"];
    g.players.forEach((p, i) => { g.arcade.players[p.id].botProfile = { level: levels[i] }; });
    for (let t = 0; t <= g.minigame.duration; t += 50) {
      g.at(t);
      if (t % 300 === 0) g.players.forEach((p) => arcadeBotStep(g.room, p));
      g.tick();
    }
    const hard = g.arcade.players[g.players[2].id];
    hard.results.forEach((res) => { if (res.ms !== null) firstPick.push(res.ms); });
    const scores = g.players.map((p) => arcadeRankingScore(g.arcade, g.arcade.players[p.id]));
    const best = Math.max(...scores);
    scores.forEach((score, i) => { if (score === best) wins[levels[i]] += 1; });
    g.restore();
  }
  assert.ok(wins.hard > wins.normal && wins.normal > wins.easy, JSON.stringify(wins));
  firstPick.sort((x, y) => x - y);
  const median = firstPick[Math.floor(firstPick.length / 2)];
  assert.ok(median >= 2000, `der starke braucht so lange wie ein guter Mensch (Median ${median} ms)`);
});

// --- Robustheit --------------------------------------------------------------

test("Partyklassiker: Objekte statt Zahlen in Eingaben werfen nicht", () => {
  const boese = [Object.create(null), { toString: null, valueOf: null }, { valueOf: () => { throw new Error("x"); } }];
  const faelle = [
    ["schneeball", (v) => ({ action: "steer", x: v, y: v })],
    ["luftpuck", (v) => ({ action: "steer", x: v, y: 0 })],
    ["buecherwurm", (v) => ({ action: "steer", x: 0, y: v })],
    ["schnappschuss", (v) => ({ action: "steer", x: v, y: v })],
    ["honigwabe", (v) => ({ action: "take", count: v })],
    ["rohrsalat", (v) => ({ action: "pick", valve: v })],
    ["grimassen", (v) => ({ action: "shape", h: Array(12).fill(v), final: true })]
  ];
  faelle.forEach(([type, bau]) => {
    const g = setup(type, 2);
    g.at(12000);
    boese.forEach((v) => assert.doesNotThrow(() => g.input(g.players[0], bau(v)), type));
    assert.doesNotThrow(() => g.tick(), type);
    g.restore();
  });
});
