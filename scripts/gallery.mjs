// Galerie: ein Bild von jedem Minispiel, im Handyformat.
//
//   npm run gallery
//
// Der Rauchtest sagt, ob eine Szene ohne Fehler rendert. Ob sie GUT AUSSIEHT,
// sagt er nicht — und genau dort lagen zuletzt vier echte Fehler, die kein
// Test gemeldet hat: ein Raster, von dem nur vier der sechs Spalten im Bild
// waren; ein Schwarm, dessen äussere Hälfte aus dem Bild ragte (bei einem
// Schätzspiel); eine Ansage hinter der Bedienleiste; Figuren, die bis zu den
// Knöcheln im Boden steckten.
//
// Darum dieses Skript: es spielt jedes Minispiel kurz an und legt einen
// Schnappschuss ab. Die Bilder sind zum ANSCHAUEN da, nicht zum automatischen
// Vergleichen — ein Mensch sieht in zehn Sekunden, was keine Zusicherung
// beschreiben könnte.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { ALL_GAMES, ROOT, finishRound, launchBrowser, openRoom, pickGames, startServer, startSingle } from "./lib/harness.mjs";

// Im Projekt, aber nicht im Repository (siehe .gitignore). Mit
// GALERIE_DIR=/pfad lässt sich der Ort ändern.
const OUT = process.env.GALERIE_DIR || path.join(ROOT, "galerie");
mkdirSync(OUT, { recursive: true });
// Einzelne Spiele als Argumente: ein Durchgang über alle dauert zehn Minuten,
// und beim Nachbessern schaut man ohnehin immer auf dasselbe eine.
const GAMES = pickGames(process.argv.slice(2).filter((a) => !a.startsWith("--")));
const { base, stop: stopServer } = await startServer();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
await openRoom(page, base, { name: "Galerie" });
let n = 0;
for (const game of GAMES) {
  try {
    await startSingle(page, game);
    await page.waitForTimeout(5200);
    const c = await page.$("canvas.kinetic-webgl");
    const b = await c.boundingBox();
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.click(b.x + b.width*(0.35+0.3*(i%2)), b.y + b.height*0.55);
      await page.waitForTimeout(220);
    }
    await page.screenshot({ path: `${OUT}/${String(ALL_GAMES.indexOf(game) + 1).padStart(2, "0")}-${game}.png` });
    n += 1;
    // Bedienung und Anzeigen gleich mitmessen: was sich überlappt oder aus dem
    // Bild ragt, sieht man im Standbild nicht immer — eine Ansage hinter der
    // Bedienleiste ist auf einem Bild von 430 Pixeln leicht zu übersehen.
    const layout = await page.evaluate(() => {
      const sicht = { w: innerWidth, h: innerHeight };
      const kaesten = [...document.querySelectorAll(
        ".kinetic-hud > *, #minigame-controls > *, #minigame-controls button, .kinetic-hud .color-banner")]
        .filter((el) => el.offsetParent !== null && !el.hidden)
        .map((el) => ({ el, r: el.getBoundingClientRect(),
          id: el.id || `${el.tagName.toLowerCase()}.${(el.className||"").toString().split(" ")[0]}` }))
        .filter((o) => o.r.width > 4 && o.r.height > 4);
      const raus = kaesten.filter((o) => o.r.left < -1 || o.r.right > sicht.w + 1
        || o.r.top < -1 || o.r.bottom > sicht.h + 1).map((o) => o.id);
      const ueber = [];
      for (let i = 0; i < kaesten.length; i += 1) for (let j = i + 1; j < kaesten.length; j += 1) {
        const a = kaesten[i], b = kaesten[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 3 && y > 3) ueber.push(`${a.id}⨯${b.id}(${Math.round(x)}×${Math.round(y)})`);
      }
      return { raus, ueber };
    });
    if (layout.raus.length || layout.ueber.length) {
      console.log(`✗ ${game.padEnd(14)}`
        + (layout.raus.length ? ` raus: ${layout.raus.join(", ")}` : "")
        + (layout.ueber.length ? ` überlappt: ${layout.ueber.join(", ")}` : ""));
    }
    await finishRound(page);
    await page.waitForSelector("#screen-lobby.active", { timeout: 20000 });
  } catch (e) { console.log("übersprungen:", game, e.message.split("\n")[0]); }
}
await browser.close();
stopServer();
console.log(`${n} Bilder in ${OUT}`);
