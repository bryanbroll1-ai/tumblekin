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
