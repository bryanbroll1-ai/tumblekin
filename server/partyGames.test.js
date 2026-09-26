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
  const commands = g.arcade.flags.commands;
  const first = commands[0];
  g.run(0, first.at + 100, 30);
  g.input(a, { action: "flag", flag: first.kind });
  g.input(b, { action: "flag", flag: first.kind === "red" ? "blue" : "red" });
  g.run(first.at + 130, first.at + first.window + 60, 30);
  assert.equal(g.arcade.players[a.id].answers[0].result, "ok");
  assert.equal(g.arcade.players[b.id].answers[0].result, "wrong");
  assert.equal(g.arcade.players[c.id].answers[0].result, "late", "wer nichts tut, ist zu spät");
  assert.equal(g.arcade.players[b.id].lives, C.FLAG_LIVES - 1);
  // Eine Falle: wer drückt, fällt rein; wer stillhält, hat richtig.
  const fake = commands.find((command) => command.kind === "fake");
  g.run(first.at + first.window + 90, fake.at + 50, 30);
  g.input(a, { action: "flag", flag: fake.side });
  g.run(fake.at + 80, fake.at + fake.window + 60, 30);
  assert.equal(g.arcade.players[a.id].answers[fake.index].result, "fooled");
  g.restore();
});

test("Flaggen hoch: bei BEIDE zählt es erst, wenn beide Flaggen oben sind", () => {
  const g = setup("flaggenhoch", 2);
  const [p] = g.players;
  const commands = g.arcade.flags.commands;
  const both = commands.find((command) => command.kind === "both");
  // Bis dahin alles richtig beantworten, damit niemand vorher rausfliegt.
  g.run(0, both.at + 50, 20, (t) => {
    const active = party.activeFlagCommand(commands, t);
    if (!active || active === both || g.arcade.players[p.id].answers[active.index]) return;
    if (active.kind === "red" || active.kind === "blue") g.input(p, { action: "flag", flag: active.kind });
    if (active.kind === "both" && t > active.at + 100) { g.input(p, { action: "flag", flag: "red" }); g.at(t + 50); g.input(p, { action: "flag", flag: "blue" }); }
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

test("Honigwabe: nur wer dran ist, pflückt — und eine Wabe kostet die Hälfte", () => {
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
  assert.equal(g.arcade.players[next.id].fruits, 4, "die Hälfte (abgerundet) fällt herunter");
  assert.equal(state.last.stung, true);
  g.restore();
});

test("Honigwabe: wer zu lange zögert, pflückt automatisch eine", () => {
  const g = setup("honigwabe", 2);
  g.run(0, C.HONEY_LEAD_MS + 50, 30);
  const first = g.arcade.honey.turn;
  g.run(C.HONEY_LEAD_MS + 80, first.until + 60, 30);
  assert.equal(g.arcade.honey.last.auto, true);
  assert.notEqual(g.arcade.honey.turn.playerId, first.playerId, "danach ist der Nächste dran");
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
  assert.equal(ea.score, party.snowValue(0.9), "eine grosse Kugel bringt drei");
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
