// Zeigt die Oberflaeche die Zahl, nach der auch gewonnen wird?
//
// Das ist eine ganze Fehlerklasse, und sie ist im Spiel besonders teuer: wer am
// Ende auf Platz drei steht, obwohl die groesste Zahl bei ihm stand, glaubt dem
// Spiel nicht mehr. Gefunden wurden damit unter anderem eine Anzeige der
// Stueckzahl bei nach Wert gestaffelten Fischen und eine Standzeit bei einem
// Spiel, das die Zeit in der Mitte wertet.
//
// Verfahren: jedes Minispiel ein paar Mal mit unterschiedlich guten Bots
// durchspielen, danach die Rangfolge nach arcadeRankingScore mit der Rangfolge
// nach der ANGEZEIGTEN Zahl vergleichen. Widersprechen sie sich, ist das ein
// Befund — es sei denn, die Anzeige ist erklaertermassen keine Rangzahl
// (Ausgeschieden-Anzeigen etwa tragen ihre Rangaussage im Feld `survived`).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { testRules } = require("../server/server.js");

const {
  MINIGAMES, createArcadeState, updateArcade, arcadeBotStep,
  arcadeRankingScore, arcadeResultDetail,
  createArenaState, updateBounceArena, arenaBotStep,
  bounceResultScore, minigameResultDetail
} = testRules;

const PROFILE = {
  easy: { level: "easy", reactionMs: 900, mistake: 0.3, spreadMs: 650 },
  normal: { level: "normal", reactionMs: 560, mistake: 0.18, spreadMs: 400 },
  hard: { level: "hard", reactionMs: 300, mistake: 0.08, spreadMs: 220 }
};
const SEATS = ["easy", "normal", "hard", "normal"];
const RUNDEN = Number(process.argv[3] || 12);
const NUR = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;

// Arten, die absichtlich keine Rangzahl sind: sie tragen die Rangaussage in
// einem eigenen Feld und die Zahl ist nur Beiwerk.
const KEINE_RANGZAHL = new Set(["standing", "out", "time", "deviation", "sumTime", "progress"]);

// Bumper Bloom laeuft nicht ueber die Arcade-Familien, sondern hat einen
// eigenen Zustand. Es faellt damit auch aus der Bot-Waage heraus — und war
// prompt das einzige Spiel, dessen Ergebniskarte noch die falsche Zahl zeigte.
function spieleArena() {
  const tpl = MINIGAMES.find((m) => m.type === "bounceArena");
  const players = SEATS.map((_, i) => ({
    id: `b${i}`, name: `Bot ${i}`, isBot: true, connected: true,
    color: ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"][i]
  }));
  const echt = Date.now;
  let clock = echt();
  Date.now = () => clock;
  const startedAt = clock;
  const arena = createArenaState(players, startedAt);
  const minigame = { id: 1, type: "bounceArena", startedAt, duration: tpl.duration, arena, scores: {}, lastInputAt: {} };
  const room = { id: "r", players, currentMinigame: minigame };
  for (let t = 0; t <= tpl.duration; t += 18 + Math.random() * 26) {
    clock = startedAt + t;
    players.forEach((p) => arenaBotStep(arena, p.id));
    updateBounceArena(room);
  }
  Date.now = echt;
  return players.map((p) => ({
    rang: bounceResultScore(arena.players[p.id]),
    detail: minigameResultDetail(minigame, p.id, clock)
  }));
}

function spiele(type) {
  if (type === "bounceArena") return spieleArena();
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
  for (let t = 0; t <= tpl.duration; t += 18 + Math.random() * 26) {
    clock = startedAt + t;
    players.forEach((p, i) => {
      if (t < naechst[i]) return;
      naechst[i] = t + takt[i];
      arcadeBotStep(room, p);
    });
    updateArcade(room);
  }
  Date.now = echt;
  return players.map((p) => ({
    rang: arcadeRankingScore(arcade, arcade.players[p.id]),
    detail: arcadeResultDetail(arcade, arcade.players[p.id])
  }));
}

const spiele_liste = MINIGAMES.filter((m) => m.arcadeFamily || m.type === "bounceArena").map((m) => m.type);
const liste = NUR ? [NUR] : spiele_liste;
let befunde = 0;

for (const type of liste) {
  const widerspruch = [];
  let art = null;
  let fehlt = false;
  for (let r = 0; r < RUNDEN; r += 1) {
    const sitze = spiele(type);
    if (!sitze) break;
    if (!sitze[0].detail) { fehlt = true; break; }
    art = sitze.map((s) => s.detail.kind).find((k) => !KEINE_RANGZAHL.has(k)) || sitze[0].detail.kind;
    // Jedes Paar pruefen: wer besser rangiert, darf keine kleinere Zahl zeigen.
    // Die Pruefung geht je EINTRAG, nicht je Spiel: dasselbe Spiel liefert fuer
    // Ausgeschiedene eine andere Art als fuer Ueberlebende, und ein Vergleich
    // ueber diese Grenze hinweg sagt nichts — der Rangunterschied steckt dann
    // gerade in der Art und nicht in der Zahl.
    for (let a = 0; a < sitze.length; a += 1) {
      for (let b = a + 1; b < sitze.length; b += 1) {
        const A = sitze[a];
        const B = sitze[b];
        if (KEINE_RANGZAHL.has(A.detail?.kind) || KEINE_RANGZAHL.has(B.detail?.kind)) continue;
        if (A.detail?.value === null || B.detail?.value === null) continue;
        const rangDiff = A.rang - B.rang;
        const zahlDiff = (A.detail?.value || 0) - (B.detail?.value || 0);
        if (rangDiff * zahlDiff < 0) {
          widerspruch.push(`${A.detail.value} rangiert vor ${B.detail.value}`);
        }
      }
    }
  }
  if (fehlt) {
    console.log(`✗ ${type.padEnd(14)} zeigt gar keine Ergebniszahl`);
    befunde += 1;
  } else if (widerspruch.length) {
    console.log(`✗ ${type.padEnd(14)} Anzeige (${art}) widerspricht der Wertung: ${widerspruch.slice(0, 3).join(", ")}`);
    befunde += 1;
  } else {
    console.log(`  ${type.padEnd(14)} ${art}`);
  }
}
console.log(befunde === 0
  ? "\nJede Anzeige entscheidet auch die Rangfolge."
  : `\n${befunde} Anzeige(n) widersprechen der Wertung.`);
process.exit(befunde === 0 ? 0 : 1);
