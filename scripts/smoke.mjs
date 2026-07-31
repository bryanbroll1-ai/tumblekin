// Lokaler Rauchtest: startet den Server, öffnet jedes Minispiel in einem
// echten Browser, spielt ein paar Sekunden und meldet Renderfehler.
//
//   npm run smoke              # alle Minispiele
//   npm run smoke -- turmbau   # nur ausgewählte
//   npm run smoke -- --head    # sichtbares Browserfenster
//
// Braucht einmalig:  npm install --no-save playwright && npx playwright install chromium
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ALL_GAMES = [
  "bounceArena", "finishRush", "colorEscape", "nervenprobe", "lichtwaechter",
  "ballonPump", "fassrolle", "zuendstoff", "muenzregen", "blobklopfe",
  "seilspringen", "kanonenflug", "messerwurf", "turmbau", "bergsteiger",
  "ballonfahrt", "sumoschubs", "trampolin", "falschsignal", "spurmaler", "sortierband", "leuchtfolge", "blitzreflex", "nagelbrett", "eisstock", "tiefenrausch", "angelduell", "farbenjagd"
];

const argv = process.argv.slice(2);
const headed = argv.includes("--head");
const picked = argv.filter((a) => !a.startsWith("--"));
const games = picked.length ? picked : ALL_GAMES;

const unknown = games.filter((g) => !ALL_GAMES.includes(g));
if (unknown.length) {
  console.error(`Unbekanntes Minispiel: ${unknown.join(", ")}`);
  console.error(`Verfügbar: ${ALL_GAMES.join(", ")}`);
  process.exit(2);
}

// --- Playwright laden (optionale Dev-Abhängigkeit) -------------------------
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    console.error("Playwright fehlt. Einmalig einrichten:\n");
    console.error("  npm install --no-save playwright");
    console.error("  npx playwright install chromium\n");
    process.exit(2);
  }
}

// Bündelt Playwright einen Browser, wird der genommen; sonst suchen wir die
// üblichen Installationsorte ab (auch die vorinstallierten Container-Pfade).
function findBrowser() {
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return undefined; // Playwright findet ihn selbst
  } catch { /* playwright-core kennt keinen gebündelten Browser */ }

  const candidates = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  const found = candidates.find((p) => existsSync(p));
  if (found) return found;

  console.error("Kein Chromium gefunden. Entweder:\n");
  console.error("  npx playwright install chromium");
  console.error("  oder CHROMIUM_PATH=/pfad/zu/chrome setzen\n");
  process.exit(2);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* noch nicht oben */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// --- Server hochfahren -----------------------------------------------------
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.join(ROOT, "server", "server.js")], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), TUMBLEKIN_DEV_TOOLS: "1" },
  stdio: "ignore"
});
const stopServer = () => { if (!server.killed) server.kill(); };
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

if (!(await waitForServer(base))) {
  stopServer();
  console.error(`Server auf ${base} nicht erreichbar.`);
  process.exit(1);
}

// --- Browser ---------------------------------------------------------------
const executablePath = findBrowser();
const browser = await chromium.launch({
  headless: !headed,
  ...(executablePath ? { executablePath } : {}),
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"]
});

console.log(`Tumblekin Rauchtest — ${games.length} Minispiel(e) auf ${base}\n`);

const results = [];
for (const game of games) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 180)); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.split("\n")[0]));

  let status = "ok";
  try {
    // Dev-Modus: ein Gerät, vier lokale Spieler, Challenge direkt startbar.
    await page.goto(`${base}/?dev=1`, { waitUntil: "networkidle" });
    await page.fill("#player-name", "Rauchtest");
    await page.click("#create-room");
    await page.waitForSelector("#screen-lobby.active", { timeout: 15000 });
    await page.click("#enable-dev-mode");
    await page.waitForTimeout(400);
    await page.click("#start-game");
    await page.waitForSelector("[data-dev-game-select]", { timeout: 15000 });
    await page.selectOption("[data-dev-game-select]", game);
    await page.click("[data-dev-challenge]");
    await page.waitForSelector("canvas.kinetic-webgl, canvas.bounce-webgl", { timeout: 15000 });

    // Countdown abwarten, dann spielen, damit auch die Effektpfade feuern.
    await page.waitForTimeout(4200);
    const canvas = await page.$("canvas.kinetic-webgl, canvas.bounce-webgl");
    const box = await canvas.boundingBox();
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.click(box.x + box.width * (0.35 + 0.3 * (i % 2)), box.y + box.height * 0.6);
      await page.waitForTimeout(240);
    }
    const alive = await page.evaluate(() => {
      const c = document.querySelector("canvas.kinetic-webgl, canvas.bounce-webgl");
      return Boolean(c && c.width > 0 && c.height > 0);
    });
    if (!alive) { status = "leer"; errors.push("Canvas hat keine Größe"); }
  } catch (err) {
    status = "FEHLER";
    errors.push("ABLAUF: " + err.message.split("\n")[0]);
  }
  if (errors.length && status === "ok") status = "Konsolenfehler";

  results.push({ game, status, errors });
  console.log(`${status === "ok" ? "✓" : "✗"} ${game.padEnd(14)} ${status}`);
  errors.slice(0, 3).forEach((e) => console.log(`    ${e}`));
  await page.close();
}

await browser.close();
stopServer();

const failed = results.filter((r) => r.status !== "ok");
console.log(`\n${results.length - failed.length}/${results.length} Minispiele sauber`);
process.exit(failed.length ? 1 : 0);
