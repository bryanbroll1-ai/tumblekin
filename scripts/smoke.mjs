// Lokaler Rauchtest: startet den Server, öffnet jedes Minispiel in einem
// echten Browser, spielt ein paar Sekunden und meldet Renderfehler.
//
//   npm run smoke              # alle Minispiele
//   npm run smoke -- turmbau   # nur ausgewählte
//   npm run smoke -- --head    # sichtbares Browserfenster
//
// Braucht einmalig:  npm install --no-save playwright && npx playwright install chromium
import { launchBrowser, openRoom, pickGames, startServer, startSingle, watchErrors } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const headed = argv.includes("--head");
const games = pickGames(argv.filter((a) => !a.startsWith("--")));

const { base, stop: stopServer } = await startServer();
const browser = await launchBrowser({ headed });

console.log(`Tumblekin Rauchtest — ${games.length} Minispiel(e) auf ${base}\n`);

const results = [];
for (const game of games) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors = watchErrors(page);

  let status = "ok";
  let perf = null;
  try {
    // Ein Raum mit Bots, das Spiel als Einzelspiel gestartet.
    await openRoom(page, base, { name: "Rauchtest" });
    await startSingle(page, game);

    // Countdown abwarten, dann spielen, damit auch die Effektpfade feuern.
    await page.waitForTimeout(4200);
    const canvas = await page.$("canvas.kinetic-webgl");
    const box = await canvas.boundingBox();
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.click(box.x + box.width * (0.35 + 0.3 * (i % 2)), box.y + box.height * 0.6);
      await page.waitForTimeout(240);
    }
    const alive = await page.evaluate(() => {
      const c = document.querySelector("canvas.kinetic-webgl");
      return Boolean(c && c.width > 0 && c.height > 0);
    });
    if (!alive) { status = "leer"; errors.push("Canvas hat keine Größe"); }

    // Bildlast messen. Auf einem Mittelklasse-Handy entscheidet die Zahl der
    // Zeichenaufrufe darüber, ob eine Szene mit 60 oder mit 25 Bildern läuft —
    // und das merkt man bei einem Reaktionsspiel sofort. Gemessen wird über die
    // Renderer-Statistik von three.js, nicht geschätzt.
    // Und einmal bis ins FINALE laufen lassen. Der Schlussmoment — Platz 1
    // freut sich sehr, Platz 4 knickt ein — ist eigener Code in jeder Szene und
    // lief bisher in keinem Test. Genau dort steckte zuletzt ein Fehler, der im
    // Spiel nie auffiel, weil die Ausnahme serverseitig abgefangen wurde.
    const finaleErrorsBefore = errors.length;
    await page.evaluate(() => {
      // Die Runde von aussen beenden, statt 30 Sekunden zu warten.
      const game = window.__tumblekinScene;
      if (!game) return;
      const mg = game.update || game.minigame;
      if (mg) {
        mg.finaleAt = Date.now();
        if (mg.arcade) {
          mg.arcade.places = {};
          Object.keys(mg.arcade.players || {}).forEach((id, index) => {
            mg.arcade.places[id] = index + 1;
          });
        }
        if (mg.arena) mg.arena.places = mg.arcade ? mg.arcade.places : {};
      }
    });
    await page.waitForTimeout(1200);
    if (errors.length > finaleErrorsBefore) status = "Finale kaputt";

    perf = await page.evaluate(() => new Promise((resolve) => {
      const scene = window.__tumblekinScene;
      if (!scene?.renderer) { resolve(null); return; }
      // Zwei Bilder abwarten, damit die Statistik ein volles Bild beschreibt.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const info = scene.renderer.info;
        let objects = 0;
        scene.scene?.traverse(() => { objects += 1; });
        resolve({
          calls: info.render.calls,
          triangles: info.render.triangles,
          objects,
          textures: info.memory.textures,
          geometries: info.memory.geometries
        });
      }));
    }));
  } catch (err) {
    status = "FEHLER";
    errors.push("ABLAUF: " + err.message.split("\n")[0]);
  }
  if (errors.length && status === "ok") status = "Konsolenfehler";

  results.push({ game, status, errors, perf });
  const load = perf ? `${String(perf.calls).padStart(4)} Aufrufe · ${String(Math.round(perf.triangles / 1000)).padStart(3)}k Dreiecke · ${String(perf.objects).padStart(4)} Objekte` : "";
  console.log(`${status === "ok" ? "✓" : "✗"} ${game.padEnd(14)} ${status.padEnd(14)} ${load}`);
  errors.slice(0, 3).forEach((e) => console.log(`    ${e}`));
  await page.close();
}

await browser.close();
stopServer();

const failed = results.filter((r) => r.status !== "ok");
console.log(`\n${results.length - failed.length}/${results.length} Minispiele sauber`);
process.exit(failed.length ? 1 : 0);
