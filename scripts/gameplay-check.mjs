// Alle Regeln über ganze Runden: 2/3/4 Spieler, kurze/normale/lange Takte,
// mehrere reproduzierbare Seeds und fehlerhafte Eingaben zwischen Bot-Zügen.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { testRules: r } = createRequire(import.meta.url)("../server/server.js");
const wanted = process.argv.slice(2);
const games = wanted.length ? r.MINIGAMES.filter((g) => wanted.includes(g.type)) : r.MINIGAMES;
assert.equal(games.length, wanted.length || r.MINIGAMES.length, "Unbekanntes Spiel");
const profiles = [
  { level: "easy", reactionMs: 900, mistake: 0.3, spreadMs: 650 },
  { level: "normal", reactionMs: 560, mistake: 0.18, spreadMs: 400 },
  { level: "hard", reactionMs: 300, mistake: 0.08, spreadMs: 220 }
];
const coordinates = new Set(["x", "y", "z", "px", "py", "vx", "vy", "vz", "depth", "width", "height", "radius", "tension"]);
function finiteMotion(value, location = "state") {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (coordinates.has(key) && typeof item === "number") assert.ok(Number.isFinite(item), `${location}.${key} = ${item}`);
    if (item && typeof item === "object") finiteMotion(item, `${location}.${key}`);
  }
}
const malformed = [null, "tap", { action: "unknown" }, { action: "steer", x: 1e308, y: -1e308 },
  { action: "thrust", x: { bad: true }, y: [] }, { action: "flick", dx: NaN, dy: Infinity },
  { action: "drop", x: null }, { action: "shape", h: [] }, { action: "take", count: {} }];
let rounds = 0;
for (const game of games) {
  for (const seats of [2, 3, 4]) for (const stepMs of [30, 90, 180]) for (const seed of [11, 37, 101]) {
    const realNow = Date.now;
    const realRandom = Math.random;
    let clock = 1000000;
    let randomState = seed;
    Math.random = () => ((randomState = randomState * 16807 % 2147483647) - 1) / 2147483646;
    Date.now = () => clock;
    const players = Array.from({ length: seats }, (_, i) => r.createPlayer({ id: `p${i}`, name: `P${i}`, color: "#ff5d73", isBot: true }));
    const minigame = { id: "simulation", type: game.type, startedAt: clock, duration: game.duration, scores: {}, lastInputAt: {} };
    const room = { code: "TEST", players, status: "minigame", phase: "playingMinigame", currentMinigame: minigame, timers: new Set() };
    const state = game.arcadeFamily ? r.createArcadeState(game.type, players, clock, { seed }) : r.createArenaState(players, clock, game.duration);
    if (game.arcadeFamily) minigame.arcade = state; else minigame.arena = state;
    players.forEach((player, i) => { state.players[player.id].botProfile = { ...profiles[i % 3] }; });
    const input = game.arcadeFamily ? r.handleArcadeInput : r.handleArenaInput;
    const update = game.arcadeFamily ? r.updateArcade : r.updateBounceArena;
    const score = (player) => game.arcadeFamily ? r.arcadeRankingScore(state, state.players[player.id]) : r.bounceResultScore(state.players[player.id]);
    const nextBot = players.map((_, i) => i * 23);
    let nextBad = 500;
    let badIndex = 0;
    try {
      for (let elapsed = 0; elapsed <= game.duration && !minigame.finaleAt; elapsed += stepMs) {
        clock = minigame.startedAt + elapsed;
        players.forEach((player, i) => {
          if (elapsed < nextBot[i]) return;
          nextBot[i] = elapsed + 130 + i * 11;
          if (game.arcadeFamily) r.arcadeBotStep(room, player);
          else r.arenaBotStep(state, player.id);
        });
        if (elapsed >= nextBad) {
          nextBad += 500;
          const reply = input(room, players[0], malformed[badIndex++ % malformed.length]);
          assert.equal(typeof reply?.ok, "boolean", "Eingaben antworten strukturiert");
        }
        update(room);
        finiteMotion(state);
        players.forEach((player) => assert.ok(Number.isFinite(score(player)), `Ungültiger Rangwert für ${player.id}`));
      }
      const places = r.rankPlaces(players, score);
      assert.equal(Object.keys(places).length, seats);
      Object.values(places).forEach((place) => assert.ok(Number.isInteger(place) && place >= 1 && place <= seats));
      rounds += 1;
    } catch (error) {
      throw new Error(`${game.type}, ${seats} Spieler, ${stepMs} ms, Seed ${seed}: ${error.message}`, { cause: error });
    } finally {
      r.clearRoomTimers(room);
      Date.now = realNow;
      Math.random = realRandom;
    }
  }
  console.log(`✓ ${game.type.padEnd(14)} 27 vollständige Regelsimulationen`);
}
console.log(`\n${games.length} Spiele · ${rounds} Runden · keine ungültigen Positionen oder Rangwerte`);
