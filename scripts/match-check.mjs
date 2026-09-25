// Spielt ganze Partien im Browser — Marathon, K.O. und Punktejagd — und meldet
// jeden Fehler auf dem Weg: Lobby, Ansage, Minispiel, Ergebnistafel,
// Zwischenstand, Siegerehrung, Revanche, zurück zur Lobby.
//
//   npm run match-check
//   npm run match-check -- --head
//
// Die Regeln der Modi prüfen die Servertests. Hier geht es um den Weg durch
// die Oberfläche: dass nach jedem Spiel die Tafel alle Spieler zeigt, dass
// die Punkte, die sie verteilt, auch im Stand ankommen, und dass eine Partie
// wirklich endet — und nicht in einer Schleife aus Unentschieden hängt.
//
// Damit das keine halbe Stunde dauert, wird jedes Minispiel nach ein paar
// Sekunden über das Dev-Ereignis `devSkipMinigame` gewertet. Die Bots haben
// bis dahin Punkte gemacht; sonst gäbe es nur Unentschieden, und eine
// Punktejagd liefe bis an ihre Obergrenze.
import { launchBrowser, openRoom, request, startServer, watchErrors } from "./lib/harness.mjs";

const headed = process.argv.includes("--head");

// Spiele, in denen Bots in den ersten Sekunden verlässlich punkten.
const POOL = ["muenzregen", "blobklopfe", "farbenjagd", "ballonPump", "bounceArena", "finishRush", "trampolin", "spurmaler"];

const PLANS = [
  { mode: "marathon", settings: { length: 5, pool: POOL }, label: "Marathon über 5" },
  { mode: "knockout", settings: { lives: 2, pool: POOL }, label: "K.O. mit 2 Leben" },
  { mode: "hunt", settings: { pool: POOL }, label: "Punktejagd" }
];

const { base, stop: stopServer } = await startServer();
const browser = await launchBrowser({ headed });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const errors = watchErrors(page);
const problems = [];
const fail = (text) => {
  problems.push(text);
  console.log(`  ✗ ${text}`);
};

await openRoom(page, base, { name: "Partie" });
const players = await page.evaluate(() => window.__tumblekin.state().players.length);
console.log(`Tumblekin Partieprüfung — ${players} Spieler auf ${base}\n`);

for (const plan of PLANS) {
  console.log(`${plan.label}`);
  const errorsBefore = errors.length;
  // Den Modus über die Oberfläche wählen, die Einstellungen über das Ereignis.
  await page.click(`#mode-tabs [data-mode="${plan.mode}"]`);
  await page.waitForFunction((mode) => window.__tumblekin.state().mode === mode, plan.mode, { timeout: 5000 });
  await request(page, "updateSettings", { settings: plan.settings });
  await page.click("#start-game");

  let rounds = 0;
  let ended = false;
  while (rounds < 45) {
    const where = await page.waitForFunction(() => {
      const status = window.__tumblekin.state()?.status;
      return status === "minigame" || status === "end" ? status : null;
    }, null, { timeout: 30000 }).then((handle) => handle.jsonValue()).catch(() => "zeitüberschreitung");
    if (where === "end") {
      ended = true;
      break;
    }
    if (where !== "minigame") {
      fail(`Runde ${rounds + 1}: weder Minispiel noch Ende (${where})`);
      break;
    }
    rounds += 1;
    await page.waitForSelector("#screen-minigame.active", { timeout: 15000 });
    await page.waitForSelector("canvas.kinetic-webgl", { timeout: 15000 });
    const reason = await page.textContent("#intro-reason").catch(() => "");
    // Der Stand vor der Wertung — gleich zu Beginn, falls das Spiel früh endet.
    const before = await page.evaluate(() => {
      const state = window.__tumblekin.state();
      return state.players.reduce((sum, player) => sum + (player.points || 0), 0);
    });
    // Ansage abwarten und ein paar Sekunden spielen lassen.
    await page.waitForFunction(() => {
      const state = window.__tumblekin.state();
      const mg = state?.currentMinigame;
      return mg && Date.now() > mg.startedAt - (state.serverTime - Date.now()) + 2600;
    }, null, { timeout: 20000, polling: 200 }).catch(() => {});
    // Manche Spiele enden von selbst früher (alle fertig) — dann ist schon
    // gewertet, und das Ereignis kommt zu spät. Das ist kein Fehler.
    const skipped = await request(page, "devSkipMinigame").then(() => true).catch((error) => String(error.message || error));
    if (skipped !== true && !/kein Minispiel/.test(skipped)) fail(`Runde ${rounds}: ${skipped}`);
    await page.waitForSelector("#screen-result.active", { timeout: 15000 });
    await page.waitForTimeout(700);

    // Die Tafel: alle Spieler, und die verteilten Punkte kommen im Stand an.
    const board = await page.evaluate(() => {
      const state = window.__tumblekin.state();
      const result = state.lastMinigameResult;
      return {
        rows: document.querySelectorAll("#result-list > li").length,
        standings: document.querySelector("#standings")?.children.length || 0,
        awarded: (result?.ranking || []).reduce((sum, entry) => sum + (entry.points || 0), 0),
        total: state.players.reduce((sum, player) => sum + (player.points || 0), 0),
        title: result?.title || "?",
        over: Boolean(result?.matchOver)
      };
    });
    if (board.rows !== players) fail(`Runde ${rounds} (${board.title}): Tafel zeigt ${board.rows} statt ${players} Zeilen`);
    if (board.standings === 0) fail(`Runde ${rounds}: kein Zwischenstand`);
    if (plan.mode !== "knockout" && board.total !== before + board.awarded) {
      fail(`Runde ${rounds}: ${board.awarded} Punkte verteilt, Stand wuchs von ${before} auf ${board.total}`);
    }
    console.log(`  · ${String(rounds).padStart(2)} ${reason.trim().padEnd(26)} ${board.title}${board.over ? " — Ende" : ""}`);
    await request(page, "readyForNext");
  }

  if (!ended) {
    fail(`keine Siegerehrung nach ${rounds} Runden`);
  } else {
    await page.waitForSelector("#screen-end.active", { timeout: 15000 });
    const end = await page.evaluate(() => ({
      banner: document.querySelector("#winner-banner")?.textContent.trim() || "",
      rows: document.querySelectorAll("#final-list > li").length,
      winners: window.__tumblekin.state().winnerIds?.length || 0
    }));
    if (!end.banner) fail("Siegerehrung ohne Siegerzeile");
    if (end.rows !== players) fail(`Endliste zeigt ${end.rows} statt ${players} Zeilen`);
    if (end.winners === 0) fail("kein Sieger gesetzt");
    console.log(`  ✓ Ende nach ${rounds} Runden: ${end.banner.replace(/\s+/g, " ").slice(0, 60)}`);

    // Revanche startet dieselbe Partie neu, die Lobby-Taste führt zurück.
    await page.click("#rematch");
    await page.waitForSelector("#screen-minigame.active", { timeout: 15000 });
    const fresh = await page.evaluate(() => window.__tumblekin.state().match?.round);
    if (fresh !== 1) fail(`Revanche beginnt bei Runde ${fresh} statt 1`);
    await request(page, "restartGame");
    await page.waitForSelector("#screen-lobby.active", { timeout: 15000 });
  }
  const fresh = errors.slice(errorsBefore);
  if (fresh.length) fail(`${fresh.length} Konsolenfehler: ${fresh[0]}`);
  console.log("");
}

await browser.close();
stopServer();
console.log(problems.length ? `${problems.length} Befund(e).` : "Alle Partien sauber durchgelaufen.");
process.exit(problems.length ? 1 : 0);
