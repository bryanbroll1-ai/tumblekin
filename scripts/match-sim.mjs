// Partie-Waage: spielt tausende Partien jedes Modus nur mit den Regeln aus
// server/modes.js durch — ohne Server, ohne Browser, in ein paar Sekunden —
// und misst, ob die Modi tun, was sie versprechen:
//
//  * Endet jede Partie? Und wie oft erst an der Notbremse (Punktejagd nach
//    30, K.O. nach 40 Spielen)? Die Bremse ist für Ausnahmen da; greift sie
//    regelmässig, ist der Modus falsch eingestellt.
//  * Wie lang wird eine Partie — im Mittel, und in den langen 5 %?
//  * Wie oft teilen sich mehrere den Sieg?
//  * Setzt sich ein etwas Besserer über die Partie durch, öfter als der
//    Zufall es ihm gäbe? Und je länger die Partie, desto verlässlicher?
//  * Läuft nie dasselbe Spiel zweimal hintereinander?
//
//   npm run match-sim           # 2000 Partien je Einstellung
//   npm run match-sim -- 10000
//
// Die Minispiele selbst werden hier nicht gespielt, nur ihre Ranglisten
// gewürfelt — mit einem Anteil an Spielen, in denen viele gleichauf liegen
// (alle überlebt, alle 0 Punkte). Gerade die bringen Punktejagd und K.O. aus
// dem Takt, darum sind sie absichtlich häufiger als im echten Spiel.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const modes = require("../server/modes.js");
const { testRules } = require("../server/server.js");

const ALL_TYPES = testRules.MINIGAMES.map((m) => m.type);
const RUNS = Math.max(100, Number(process.argv[2]) || 2000);
// Anteil der Runden mit groben Punktzahlen und darum vielen Gleichständen.
const TIE_HEAVY = 0.35;
// Ab diesem Anteil an Notbremsen gilt eine Einstellung als kaputt.
const MAX_BRAKE_SHARE = 0.01;

// Deterministischer Zufall: zwei Läufe liefern dieselben Zahlen, ein Befund
// lässt sich also nachstellen.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Eine Rangliste würfeln. Stärke verschiebt die Punktzahl, der Zufall bleibt
// gross genug, dass auch der Schwächste ab und zu gewinnt.
function rollScores(players, random) {
  const coarse = random() < TIE_HEAVY;
  return players.map((player) => {
    const luck = random() + random() - 1;
    const value = player.skill + luck * 0.6;
    return { playerId: player.id, score: coarse ? Math.max(0, Math.round(value * 2)) : value };
  });
}

function makePlayers(count, favourite) {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    skill: favourite && index === 0 ? 0.6 : 0.5
  }));
}

function playMatch(mode, settings, count, favourite, random) {
  const players = makePlayers(count, favourite);
  const match = modes.createMatch(mode, settings, players, ALL_TYPES, random);
  const played = [];
  const limit = mode === "hunt" ? modes.HUNT_MAX_ROUNDS : mode === "knockout" ? modes.KNOCKOUT_MAX_ROUNDS : settings.length;
  for (let guard = 0; guard < limit + 5; guard += 1) {
    const type = modes.nextGame(match, random);
    if (!type) return { error: `kein nächstes Spiel nach ${match.round} Runden`, players, match, played };
    played.push(type);
    modes.scoreRound(match, players, rollScores(players, random));
    const outcome = modes.matchOutcome(match, players);
    if (outcome.over) {
      const leaderPoints = Math.max(...players.map((p) => p.points));
      const alive = players.filter((p) => !p.out).length;
      const braked = (mode === "hunt" && !(leaderPoints >= match.target && outcome.winnerIds.length === 1))
        || (mode === "knockout" && alive > 1);
      return { players, match, played, outcome, braked };
    }
  }
  return { error: `läuft nach ${limit + 5} Runden noch`, players, match, played };
}

const CONFIGS = [
  ...modes.MARATHON_LENGTHS.map((length) => ({ mode: "marathon", settings: { ...modes.defaultSettings(), length }, label: `Marathon ${length}` })),
  { mode: "hunt", settings: modes.defaultSettings(), label: "Punktejagd" },
  ...modes.KNOCKOUT_LIVES.map((lives) => ({ mode: "knockout", settings: { ...modes.defaultSettings(), lives }, label: `K.O. ${lives} Leben` }))
];
const COUNTS = [2, 3, 4];

const problems = [];
const pct = (n, of) => `${((100 * n) / of).toFixed(1).padStart(5)} %`;

console.log(`Tumblekin Partie-Waage — ${RUNS} Partien je Zeile, ${ALL_TYPES.length} Minispiele im Pool\n`);
console.log("Einstellung        Sp.  Runden Ø   95 %  max  Bremse  geteilt  Favorit");
console.log("─".repeat(76));

let seed = 1;
for (const config of CONFIGS) {
  for (const count of COUNTS) {
    const rounds = [];
    let braked = 0;
    let shared = 0;
    let favouriteWins = 0;
    let favouriteRuns = 0;
    for (let run = 0; run < RUNS; run += 1) {
      // Die Hälfte der Partien mit einem etwas Besseren — gerade so viel,
      // dass man es über eine Partie merkt, nicht in jedem Spiel —, die
      // andere mit gleich Starken: dort entstehen die meisten Gleichstände.
      const favourite = run % 2 === 0;
      const random = mulberry32(seed += 1);
      const result = playMatch(config.mode, config.settings, count, favourite, random);
      const where = `${config.label}, ${count} Spieler, Lauf ${seed}`;
      if (result.error) {
        problems.push(`${where}: ${result.error}`);
        continue;
      }
      const { outcome, played, match } = result;
      rounds.push(match.round);
      if (result.braked) braked += 1;
      if (outcome.winnerIds.length === 0) problems.push(`${where}: kein Sieger`);
      if (outcome.winnerIds.length > 1) shared += 1;
      if (favourite) {
        favouriteRuns += 1;
        if (outcome.winnerIds.length === 1 && outcome.winnerIds[0] === "p1") favouriteWins += 1;
      }
      const repeat = played.findIndex((type, index) => index > 0 && played[index - 1] === type);
      if (repeat > 0) problems.push(`${where}: ${played[repeat]} zweimal hintereinander (Spiel ${repeat}/${repeat + 1})`);
      if (config.mode === "marathon" && match.round !== config.settings.length) {
        problems.push(`${where}: Marathon endete nach ${match.round} statt ${config.settings.length} Spielen`);
      }
    }
    rounds.sort((a, b) => a - b);
    const mean = rounds.reduce((sum, n) => sum + n, 0) / Math.max(1, rounds.length);
    const p95 = rounds[Math.floor(rounds.length * 0.95)] || 0;
    const max = rounds[rounds.length - 1] || 0;
    console.log(
      `${config.label.padEnd(18)} ${String(count).padStart(3)}  ${mean.toFixed(1).padStart(8)} ${String(p95).padStart(6)} ${String(max).padStart(4)}`
      + ` ${pct(braked, RUNS)} ${pct(shared, RUNS)}  ${pct(favouriteWins, Math.max(1, favouriteRuns))}`
    );
    if (braked / RUNS > MAX_BRAKE_SHARE) {
      problems.push(`${config.label}, ${count} Spieler: ${pct(braked, RUNS).trim()} der Partien enden erst an der Notbremse`);
    }
    // Ein Favorit muss öfter gewinnen als der Durchschnitt — sonst zählt
    // Können in diesem Modus nicht.
    if (favouriteRuns && favouriteWins / favouriteRuns <= 1 / count) {
      problems.push(`${config.label}, ${count} Spieler: Favorit gewinnt nur ${pct(favouriteWins, favouriteRuns).trim()} — nicht besser als Zufall`);
    }
  }
  console.log("");
}

// Der Pool eines Laufs: wer nur zwei Spiele wählt, bekommt sie abwechselnd.
{
  const random = mulberry32(99);
  const pair = ALL_TYPES.slice(0, 2);
  const list = modes.drawGames(pair, 20, random);
  const alternating = list.every((type, index) => index === 0 || list[index - 1] !== type);
  if (!alternating) problems.push(`Pool mit zwei Spielen wiederholt direkt: ${list.join(", ")}`);
}

if (problems.length) {
  console.log(`${problems.length} Befund(e):`);
  [...new Set(problems)].slice(0, 30).forEach((text) => console.log(`  ✗ ${text}`));
  process.exit(1);
}
console.log("Alle Modi enden, keine Wiederholung, Können zahlt sich aus.");
process.exit(0);
