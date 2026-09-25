// Gemeinsames Gerüst der Browser-Prüfskripte: Chromium finden, einen eigenen
// Server auf freiem Port starten, einen Raum mit Bots öffnen und ein
// einzelnes Minispiel starten.
//
// Vorher stand dasselbe in jedem Skript noch einmal — und jedes fuhr über
// Knöpfe, die es mit dem Brett nicht mehr gibt (Dev-Knopf in der Lobby,
// Challenge-Auswahl auf dem Brettbildschirm). Jetzt geht es über denselben
// Griff, den der Client mit `?dev=1` offenlegt: window.__tumblekin.request
// schickt dieselben Ereignisse wie die Knöpfe.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Aus dem Server abgeleitet statt daneben gepflegt.
export const ALL_GAMES = createRequire(import.meta.url)("../../server/server.js")
  .testRules.MINIGAMES.map((m) => m.type);

// Spielnamen aus der Befehlszeile prüfen; ohne Angabe alle.
export function pickGames(names) {
  const games = names.length ? names : ALL_GAMES;
  const unknown = games.filter((g) => !ALL_GAMES.includes(g));
  if (unknown.length) {
    console.error(`Unbekanntes Minispiel: ${unknown.join(", ")}`);
    console.error(`Verfügbar: ${ALL_GAMES.join(", ")}`);
    process.exit(2);
  }
  return games;
}

export async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {
    try {
      return (await import("playwright-core")).chromium;
    } catch {
      console.error("Playwright fehlt. Einmalig einrichten:\n");
      console.error("  npm install --no-save playwright");
      console.error("  npx playwright install chromium\n");
      process.exit(2);
    }
  }
  return null;
}

// Bündelt Playwright einen Browser, wird der genommen; sonst die üblichen
// Installationsorte (auch die vorinstallierten Container-Pfade).
function findBrowser(chromium) {
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return undefined;
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
  return undefined;
}

export async function launchBrowser({ headed = false, args = [] } = {}) {
  const chromium = await loadChromium();
  const executablePath = findBrowser(chromium);
  return chromium.launch({
    headless: !headed,
    ...(executablePath ? { executablePath } : {}),
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", ...args]
  });
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

// Eigener Server mit Dev-Werkzeugen auf freiem Port; beendet sich mit dem
// Skript.
export async function startServer({ log = false } = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(ROOT, "server", "server.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), TUMBLEKIN_DEV_TOOLS: "1" },
    stdio: log ? ["ignore", "pipe", "pipe"] : "ignore"
  });
  // stdout ist das übliche Startgeplauder; was zählt, landet auf stderr.
  const output = [];
  const errorOutput = [];
  if (log) {
    server.stdout.on("data", (d) => output.push(String(d)));
    server.stderr.on("data", (d) => errorOutput.push(String(d)));
  }
  const stop = () => { if (!server.killed) server.kill(); };
  process.on("exit", stop);
  process.on("SIGINT", () => { stop(); process.exit(130); });
  if (!(await waitForServer(base))) {
    stop();
    console.error(`Server auf ${base} nicht erreichbar.`);
    process.exit(1);
  }
  return { base, stop, output, errorOutput };
}

// Fehler einer Seite mitschreiben (404 für optionale Dateien ausgenommen).
export function watchErrors(page) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text().slice(0, 180));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.split("\n")[0]));
  return errors;
}

// Raum öffnen und mit Bots auffüllen.
export async function openRoom(page, base, { name = "Test", bots = true } = {}) {
  await page.goto(`${base}/?dev=1`, { waitUntil: "networkidle" });
  await page.fill("#player-name", name);
  await page.click("#create-room");
  await page.waitForSelector("#screen-lobby.active", { timeout: 15000 });
  if (bots) await request(page, "addTestPlayers");
}

export async function request(page, event, payload = {}) {
  return page.evaluate(([e, p]) => window.__tumblekin.request(e, p), [event, payload]);
}

// Ein einzelnes Minispiel aus der Lobby starten und warten, bis es läuft.
export async function startSingle(page, type) {
  await request(page, "selectMode", { mode: "single" });
  await request(page, "updateSettings", { settings: { single: type } });
  await request(page, "startGame");
  await page.waitForSelector("#screen-minigame.active", { timeout: 15000 });
  await page.waitForSelector("canvas.kinetic-webgl", { timeout: 15000 });
}

// Wie weit ist das laufende Minispiel? Negativ = Countdown läuft noch.
export async function msSinceStart(page) {
  return page.evaluate(() => {
    const state = window.__tumblekin.state();
    const minigame = state?.currentMinigame;
    if (!minigame) return null;
    return Date.now() + (state.serverTime ? state.serverTime - Date.now() : 0) - minigame.startedAt;
  });
}

// Das laufende Minispiel sofort werten (nur mit TUMBLEKIN_DEV_TOOLS=1) und
// die Ergebnistafel überspringen. Im Einzelspiel geht es danach in die Lobby,
// in einer Partie zum nächsten Spiel oder zum Ende.
export async function finishRound(page) {
  await request(page, "devSkipMinigame");
  await page.waitForSelector("#screen-result.active", { timeout: 15000 });
  await request(page, "readyForNext");
}

// Zurück in die Lobby, egal wo die Seite gerade steht.
export async function backToLobby(page) {
  await request(page, "restartGame");
  await page.waitForSelector("#screen-lobby.active", { timeout: 15000 });
}
