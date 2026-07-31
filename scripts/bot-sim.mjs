// Bot-Waage: spielt jedes Minispiel viele Male nur mit Bots durch und misst, ob
// Können sich überhaupt auszahlt — easy muss unter normal liegen, normal unter
// hard. Kippt eine Familie, ist das kein Schönheitsfehler: dann belohnt das
// Spiel etwas anderes als das, was der Mensch übt.
//
// Drei Fallen stecken hier drin, jede davon hat schon einmal falsche Zahlen
// geliefert:
//
//  * Gemessen wird `arcadeRankingScore`, NICHT `minigame.scores`. Die
//    rangbasierten Familien (Rennen, Überleben, Nähe zum Ziel) setzen `scores`
//    gar nicht — mit ihnen gemessen sahen alle Stufen identisch aus.
//  * Die Uhr darf nicht auf einem festen Raster laufen. Auf einem 30-ms-Gitter
//    entstanden künstliche Gleichstände (Kanonenflug 70 %, Nervenprobe 50 %),
//    die es im echten Spiel nicht gibt.
//  * Die Bots dürfen nicht alle im selben Augenblick ziehen. Taten sie es,
//    bekamen alle vier denselben Zeitstempel und damit dieselbe Entscheidung.
//    Jeder Bot hat darum eine eigene Periode und eine eigene Phase.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { testRules } = require("../server/server.js");

const {
  MINIGAMES,
  createArcadeState,
  updateArcade,
  arcadeBotStep,
  arcadeRankingScore
} = testRules;

const LEVELS = ["easy", "normal", "hard"];
const ROUNDS = Number(process.argv[3] || 24);
const ONLY = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;

// Vier Bots, einer je Stufe plus ein zweiter „normal" — vier ist die echte
// Tischgrösse, und mit nur drei Spielern verhalten sich Verdrängungsspiele
// (Sumo, Bumper) anders als im Spiel.
const SEATS = ["easy", "normal", "hard", "normal"];

function makeRoom(type) {
  const players = SEATS.map((level, index) => ({
    id: `b${index}`,
    name: `Bot ${index}`,
    isBot: true,
    color: ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"][index]
  }));
  const template = MINIGAMES.find((game) => game.type === type);
  const startedAt = Date.now();
  const arcade = createArcadeState(type, players, startedAt);
  if (!arcade) return null;
  // Die Stufe wird gesetzt, statt gewürfelt: sonst misst der Lauf, wer welche
  // Stufe gezogen hat, und nicht, was die Stufen taugen.
  players.forEach((player, index) => {
    arcade.players[player.id].botProfile = profileFor(SEATS[index]);
  });
  const minigame = {
    id: 1, type, startedAt, duration: template.duration,
    arcade, scores: {}, lastInputAt: {}
  };
  return { room: { currentMinigame: minigame, players }, minigame, arcade, players };
}

function profileFor(level) {
  if (level === "easy") return { level: "easy", reactionMs: 900, mistake: 0.3, spreadMs: 650 };
  if (level === "hard") return { level: "hard", reactionMs: 300, mistake: 0.08, spreadMs: 220 };
  return { level: "normal", reactionMs: 560, mistake: 0.18, spreadMs: 400 };
}

function playRound(type) {
  const setup = makeRoom(type);
  if (!setup) return null;
  const { room, minigame, arcade, players } = setup;

  // Jeder Bot bekommt eine eigene Periode und Phase. Gleichgetaktet lieferten
  // alle vier dieselben Zeitstempel und damit dieselben Entscheidungen.
  const clocks = players.map((player, index) => ({
    player,
    every: 110 + index * 17 + Math.random() * 40,
    next: Math.random() * 120
  }));

  let elapsed = 0;
  const realStart = Date.now();
  while (elapsed < minigame.duration) {
    // Ungleichmässige Schritte: ein festes Raster erzeugt Gleichstände, die es
    // im Spiel nicht gibt.
    const step = 18 + Math.random() * 26;
    elapsed += step;
    const now = realStart + elapsed;
    minigame.startedAt = now - elapsed;
    arcade.lastUpdateAt = now - step;
    shiftClock(now);
    clocks.forEach((clock) => {
      if (elapsed < clock.next) return;
      clock.next = elapsed + clock.every;
      arcadeBotStep(room, clock.player);
    });
    updateArcade(room);
  }
  restoreClock();

  // Gemessen wird die PLATZIERUNG, nicht die Punktzahl. Die Familien werten in
  // ganz verschiedenen Groessenordnungen, und mehrere kodieren einen Rang in
  // eine riesige Grundzahl (10 Mio. minus Fehler mal 100 000). Auf der Punktzahl
  // verschwand ein echter Unterschied dort im Rauschen der Grundzahl und sah
  // aus wie „flach" — obwohl der starke Bot jede Runde gewann. Der Platz ist
  // ausserdem genau das, was im Spiel zaehlt.
  const scored = players.map((player, index) => ({
    level: SEATS[index],
    score: arcadeRankingScore(arcade, arcade.players[player.id])
  })).sort((a, b) => b.score - a.score);

  const byLevel = {};
  scored.forEach((seat, position) => {
    // Gleichstand teilt sich den Platz — sonst entschiede die Reihenfolge im
    // Array, also der Zufall der Sitzordnung.
    const place = scored.findIndex((other) => other.score === seat.score) + 1;
    (byLevel[seat.level] = byLevel[seat.level] || []).push(place);
  });
  return byLevel;
}

// Die Spielregeln lesen die echte Uhr (Sperren, Rückkehrzeiten, Cooldowns). Für
// den Lauf wird sie verschoben, damit eine Runde nicht wirklich 34 Sekunden
// dauert — sonst wären 24 Runden mal 25 Spiele über fünf Stunden.
const realNow = Date.now;
function shiftClock(value) { Date.now = () => value; }
function restoreClock() { Date.now = realNow; }

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

// bounceArena laeuft nicht ueber die Arcade-Familien, sondern hat ein eigenes
// System — es kann hier nicht mitgemessen werden.
const families = MINIGAMES.filter((game) => game.arcadeFamily);
const targets = ONLY ? families.filter((game) => game.type === ONLY) : families;
if (targets.length === 0) {
  console.error(`Kein Minispiel mit dem Namen "${ONLY}".`);
  process.exit(1);
}

let broken = 0;
console.log(`Bot-Waage · ${ROUNDS} Runden je Spiel\n`);
console.log("Spiel               easy      normal    hard      Urteil   (Ø Platz, klein = gut)");
console.log("-".repeat(66));

for (const game of targets) {
  const totals = { easy: [], normal: [], hard: [] };
  for (let round = 0; round < ROUNDS; round += 1) {
    const result = playRound(game.type);
    if (!result) break;
    LEVELS.forEach((level) => totals[level].push(...(result[level] || [])));
  }
  if (totals.easy.length === 0) {
    console.log(`${game.type.padEnd(20)}(kein Arcade-Zustand)`);
    continue;
  }
  const avg = {
    easy: mean(totals.easy),
    normal: mean(totals.normal),
    hard: mean(totals.hard)
  };
  // Kleiner Platz ist besser. Gleichstand ist genauso schlimm wie eine
  // Umkehrung: beides heisst, dass Koennen nichts bringt. 0.12 Plaetze ist die
  // Schwelle — darunter entscheidet ueber vier Runden der Zufall.
  const gapLow = avg.easy - avg.normal;
  const gapHigh = avg.normal - avg.hard;
  let verdict = "ok";
  if (gapLow < -0.12 || gapHigh < -0.12) verdict = "UMGEKEHRT";
  else if (gapLow < 0.12 || gapHigh < 0.12) verdict = "flach";
  if (verdict !== "ok") broken += 1;

  const fmt = (value) => value.toFixed(2).padEnd(10);
  console.log(`${game.type.padEnd(20)}${fmt(avg.easy)}${fmt(avg.normal)}${fmt(avg.hard)}${verdict}`);
}

console.log("-".repeat(66));
if (broken === 0) console.log("Alle Familien belohnen Können.");
else console.log(`${broken} Familie(n) brauchen Arbeit.`);
process.exit(broken === 0 ? 0 : 1);
