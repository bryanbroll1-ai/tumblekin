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
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome","/usr/bin/chromium"].find(existsSync);
const OUT = "/tmp/claude-0/-home-user-tumblekin/6615fb5b-58b2-5604-9f2e-566ed2634f35/scratchpad/galerie";
mkdirSync(OUT, { recursive: true });
const GAMES = ["bounceArena","finishRush","colorEscape","nervenprobe","lichtwaechter","ballonPump",
  "fassrolle","zuendstoff","muenzregen","blobklopfe","seilspringen","kanonenflug","messerwurf",
  "turmbau","bergsteiger","ballonfahrt","sumoschubs","trampolin","falschsignal","spurmaler",
  "sortierband","leuchtfolge","blitzreflex","nagelbrett","eisstock","tiefenrausch","angelduell",
  "farbenjagd","spuersinn","augenmass"];
const srv = spawn(process.execPath, ["server/server.js"], { cwd: "/home/user/tumblekin",
  env: { ...process.env, PORT: "3111", TUMBLEKIN_DEV_TOOLS: "1" }, stdio: "ignore" });
for (let i = 0; i < 120; i += 1) { try { if ((await fetch("http://127.0.0.1:3111/")).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
const browser = await chromium.launch({ headless: true, executablePath: exe,
  args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:3111/?dev=1", { waitUntil: "networkidle" });
await page.fill("#player-name", "Galerie");
await page.click("#create-room");
await page.waitForSelector("#screen-lobby.active");
await page.click("#enable-dev-mode");
await page.waitForTimeout(500);
await page.click("#start-game");
let n = 0;
for (const game of GAMES) {
  try {
    await page.waitForSelector("[data-dev-game-select]", { timeout: 20000 });
    await page.selectOption("[data-dev-game-select]", game);
    await page.click("[data-dev-challenge]");
    await page.waitForSelector("canvas.kinetic-webgl, canvas.bounce-webgl", { timeout: 20000 });
    await page.waitForTimeout(5200);
    const c = await page.$("canvas.kinetic-webgl, canvas.bounce-webgl");
    const b = await c.boundingBox();
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.click(b.x + b.width*(0.35+0.3*(i%2)), b.y + b.height*0.55);
      await page.waitForTimeout(220);
    }
    await page.screenshot({ path: `${OUT}/${String(++n).padStart(2,"0")}-${game}.png` });
    await page.waitForSelector("#screen-result.active", { timeout: 90000 });
    const r = await page.$("#result-ready");
    if (r && await r.isVisible()) await r.click().catch(()=>{});
    await page.waitForSelector("#screen-board.active", { timeout: 30000 });
    await page.waitForTimeout(300);
  } catch (e) { console.log("übersprungen:", game, e.message.split("\n")[0]); }
}
await browser.close(); srv.kill();
console.log(`${n} Bilder in ${OUT}`);
