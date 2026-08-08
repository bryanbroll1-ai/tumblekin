// Wie lange passiert in einem Minispiel nichts mehr?
//
// Totzeit ist die stillste Art, ein Partyspiel kaputtzumachen: die Uhr laeuft,
// auf dem Bild bewegt sich nichts, und alle warten. Sie faellt in keinem Test
// auf, weil nichts abstuerzt und keine Zusicherung bricht.
//
// Gemessen wird der Abstand zwischen der LETZTEN Aenderung an irgendeinem
// Punktestand und dem Rundenende — abzueglich dessen, was der Server selbst
// schon frueher beendet haette (maybeFinishArcadeEarly). Bots spielen zuegig,
// also ist das eine Untergrenze: was hier auffaellt, ist im echten Spiel eher
// schlimmer.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { testRules } = require("../server/server.js");

const {
  MINIGAMES, createArcadeState, updateArcade, arcadeBotStep, arcadeRankingScore
} = testRules;

const PROFILE = {
  easy: { level: "easy", reactionMs: 900, mistake: 0.3, spreadMs: 650 },
  normal: { level: "normal", reactionMs: 560, mistake: 0.18, spreadMs: 400 },
  hard: { level: "hard", reactionMs: 300, mistake: 0.08, spreadMs: 220 }
};
const SEATS = ["easy", "normal", "hard", "normal"];
const RUNDEN = Number(process.argv[3] || 8);
const NUR = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
// Ab hier lohnt das Hinschauen. Zwei Sekunden Ausklang sind gewollt (man will
// sehen, wie es ausgeht); fuenf sind Warten.
const SCHWELLE_MS = 4000;

function lauf(type) {
  const tpl = MINIGAMES.find((m) => m.type === type);
  const players = SEATS.map((_, i) => ({
    id: `b${i}`, name: `Bot ${i}`, isBot: true, connected: true,
    color: ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"][i]
  }));
  const echt = Date.now;
  let clock = echt();
  Date.now = () => clock;
  const startedAt = clock;
  const arcade = createArcadeState(type, players, startedAt);
  if (!arcade) { Date.now = echt; return null; }
  players.forEach((p, i) => { arcade.players[p.id].botProfile = PROFILE[SEATS[i]]; });
  const minigame = { id: 1, type, startedAt, duration: tpl.duration, arcade, scores: {}, lastInputAt: {} };
  const room = { id: "r", players, currentMinigame: minigame };
  const takt = players.map((_, i) => 110 + i * 17 + Math.random() * 40);
  const naechst = players.map(() => Math.random() * 120);

  let letzteAenderung = 0;
  let frueherSchluss = null;
  let vorher = players.map(() => 0);
  for (let t = 0; t <= tpl.duration; t += 24) {
    clock = startedAt + t;
    players.forEach((p, i) => {
      if (t < naechst[i]) return;
      naechst[i] = t + takt[i];
      arcadeBotStep(room, p);
    });
    updateArcade(room);
    // Der Server beendet manche Familien von selbst frueher. Das zaehlt nicht
    // als Totzeit — es ist genau die Gegenmassnahme.
    if (frueherSchluss === null && (minigame.finishing || minigame.finaleAt)) frueherSchluss = t;
    const jetzt = players.map((p) => arcadeRankingScore(arcade, arcade.players[p.id]));
    if (jetzt.some((wert, i) => wert !== vorher[i])) letzteAenderung = t;
    vorher = jetzt;
  }
  Date.now = echt;
  const ende = frueherSchluss === null ? tpl.duration : frueherSchluss;
  return Math.max(0, ende - letzteAenderung);
}

const liste = NUR ? [NUR] : MINIGAMES.filter((m) => m.arcadeFamily).map((m) => m.type);
let befunde = 0;
for (const type of liste) {
  const werte = [];
  for (let r = 0; r < RUNDEN; r += 1) {
    const wert = lauf(type);
    if (wert !== null) werte.push(wert);
  }
  if (!werte.length) continue;
  const mittel = werte.reduce((a, b) => a + b, 0) / werte.length;
  const marke = mittel >= SCHWELLE_MS ? "✗" : " ";
  if (mittel >= SCHWELLE_MS) befunde += 1;
  console.log(`${marke} ${type.padEnd(14)} ${(mittel / 1000).toFixed(1)} s still am Ende`);
}
console.log(befunde === 0
  ? "\nKein Spiel steht am Ende laenger als vier Sekunden still."
  : `\n${befunde} Spiel(e) stehen am Ende still.`);
