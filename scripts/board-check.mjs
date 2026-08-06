// Spielt eine ganze Brettpartie im Browser und meldet JEDEN Fehler.
//
//   npm run board-check
//
// Es gab Tests für die Brettregeln (server) und für die Minispielszenen
// (smoke, scene-check) — aber keinen, der eine LANDUNG im Browser fährt. Genau
// dort lag ein Fehler monatelang unbemerkt: der Client las den Sternkauf im
// falschen Feld, die Feier löste nie aus, und beim Reparieren war prompt eine
// Variable ausserhalb ihres Gültigkeitsbereichs — beides hätte kein
// bestehender Test gefunden, weil keiner den Weg je entlanggelaufen ist.
//
// Geprüft wird darum das Gröbste und Wichtigste: dass beim Würfeln, Landen,
// Abbiegen und Feiern nichts in die Konsole kracht — und dass unterwegs
// überhaupt die verschiedenen Feldarten vorkommen.
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium"].find(existsSync);
const srv = spawn(process.execPath, ["server/server.js"], {
  cwd: "/home/user/tumblekin",
  env: { ...process.env, PORT: "3177", TUMBLEKIN_DEV_TOOLS: "1" },
  stdio: "ignore"
});
for (let i = 0; i < 150; i += 1) {
  try { if ((await fetch("http://127.0.0.1:3177/")).ok) break; } catch { /* noch nicht da */ }
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({
  headless: true,
  executablePath: exe,
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"]
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

const fehler = [];
page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => fehler.push(`pageerror: ${e.message}`.slice(0, 200)));

await page.goto("http://127.0.0.1:3177/?dev=1", { waitUntil: "networkidle" });
await page.fill("#player-name", "Brett");
await page.click("#create-room");
await page.waitForSelector("#screen-lobby.active");
await page.click("#enable-dev-mode");
await page.waitForTimeout(400);
await page.click("#start-game");
await page.waitForSelector("#screen-board.active", { timeout: 20000 });

// Was ist unterwegs passiert? Der Client hängt die Landemeldungen an, damit
// hinterher nachweisbar ist, dass die interessanten Fälle auch vorkamen.
await page.evaluate(() => {
  window.__landungen = [];
  const alt = window.__board?.showLanding?.bind(window.__board);
  if (alt) {
    window.__board.showLanding = (landing) => {
      window.__landungen.push({
        feld: landing.fieldType,
        stern: Boolean(landing.starPass?.starGained),
        zuTeuer: landing.starPass?.affordable === false,
        tor: Boolean(landing.gateEffects?.length)
      });
      return alt(landing);
    };
  }
});

let zuege = 0;
for (let schritt = 0; schritt < 400; schritt += 1) {
  if (await page.$("#screen-end.active")) break;
  if (await page.$("#screen-result.active")) {
    const weiter = await page.$("#result-ready");
    if (weiter && await weiter.isVisible()) await weiter.click().catch(() => {});
    await page.waitForTimeout(500);
    continue;
  }
  const weg = await page.$("#junction-options button");
  if (weg && await weg.isVisible()) {
    await weg.click().catch(() => {});
    await page.waitForTimeout(700);
    continue;
  }
  const wuerfel = await page.$("#roll-dice");
  if (wuerfel && await wuerfel.isVisible() && await wuerfel.isEnabled()) {
    await wuerfel.click().catch(() => {});
    zuege += 1;
    await page.waitForTimeout(2400);
  } else {
    await page.waitForTimeout(800);
  }
}

const landungen = await page.evaluate(() => window.__landungen || []);
const felder = [...new Set(landungen.map((l) => l.feld))].sort();
const sterne = landungen.filter((l) => l.stern).length;
const zuTeuer = landungen.filter((l) => l.zuTeuer).length;
const tore = landungen.filter((l) => l.tor).length;
const ende = Boolean(await page.$("#screen-end.active"));

await browser.close();
srv.kill();

console.log(`Züge ${zuege} · Landungen ${landungen.length} · Endbildschirm ${ende ? "erreicht" : "NICHT erreicht"}`);
console.log(`Feldarten: ${felder.join(", ") || "keine"}`);
console.log(`Sternkäufe ${sterne} · "zu teuer" ${zuTeuer} · Tore ${tore}`);

let schlimm = 0;
if (fehler.length) {
  console.log(`\n✗ ${fehler.length} Fehler in der Konsole:`);
  [...new Set(fehler)].slice(0, 12).forEach((f) => console.log("   " + f));
  schlimm += 1;
}
if (!ende) { console.log("\n✗ Die Partie kam nicht bis zum Endbildschirm."); schlimm += 1; }
if (felder.length < 4) { console.log("\n✗ Zu wenige Feldarten erlebt — die Fahrt sagt kaum etwas aus."); schlimm += 1; }
if (schlimm === 0) console.log("\nBrett läuft sauber durch.");
process.exit(schlimm ? 1 : 0);
