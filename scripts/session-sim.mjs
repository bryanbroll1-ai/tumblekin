// Langzeittest: EINE Seite, viele Minispiele hintereinander.
//
//   npm run session-sim              # 20 Runden
//   npm run session-sim -- 30        # 30 Runden
//   npm run session-sim -- 20 --head # sichtbares Fenster
//
// Warum das eigene Skript: der Rauchtest öffnet für jedes Minispiel eine FRISCHE
// Seite. Damit misst er, ob eine Szene startet — aber nie, was passiert, wenn
// zwanzig davon nacheinander im selben Reiter laufen. Genau das ist der echte
// Abend: die Runde spielt zwei Stunden, ohne je neu zu laden.
//
// Drei Dinge können dabei kaputtgehen, und alle drei sieht man erst spät:
//
//  * WebGL-Kontexte. Browser geben pro Seite nur rund 16 Stück her. Bleibt bei
//    jedem Minispiel einer liegen, ist Runde 17 schwarz — auf dem Handy, mitten
//    auf der Party, und niemand versteht warum.
//  * Geometrien und Texturen auf der Grafikkarte. Die räumt der Sammler NICHT
//    von allein auf, dafür gibt es dispose(). Vergisst eine Szene das, wächst
//    der Verbrauch monoton.
//  * Zuhörer am window. Die überleben jede Szene, weil window bleibt.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const headed = argv.includes("--head");
const rounds = Number(argv.find((a) => /^\d+$/.test(a)) || 20);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright fehlt:  npm install --no-save playwright");
  process.exit(2);
}

const GAMES = [
  "bounceArena", "finishRush", "colorEscape", "nervenprobe", "lichtwaechter",
  "ballonPump", "fassrolle", "zuendstoff", "muenzregen", "blobklopfe",
  "seilspringen", "kanonenflug", "messerwurf", "turmbau", "bergsteiger",
  "ballonfahrt", "sumoschubs", "trampolin", "falschsignal", "spurmaler",
  "sortierband", "leuchtfolge", "blitzreflex", "nagelbrett", "eisstock",
  "tiefenrausch", "angelduell", "farbenjagd"
];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const server = spawn(process.execPath, ["server/server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), TUMBLEKIN_DEV_TOOLS: "1" },
  stdio: ["ignore", "ignore", "pipe"]
});
let serverLog = "";
server.stderr.on("data", (chunk) => { serverLog += chunk; });

const base = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try { if ((await fetch(`${base}/`)).ok) break; } catch { /* noch nicht da */ }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

// Browser suchen wie im Rauchtest: gebündelt, sonst die üblichen Pfade.
function findBrowser() {
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return undefined;
  } catch { /* playwright-core kennt keinen gebündelten Browser */ }
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome"
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  console.error("Kein Chromium gefunden. CHROMIUM_PATH setzen oder npx playwright install chromium");
  process.exit(2);
}

// --js-flags=--expose-gc, damit die Heap-Zahl das Aufgeräumte nicht mitzählt.
const executablePath = findBrowser();
const browser = await chromium.launch({
  headless: !headed,
  ...(executablePath ? { executablePath } : {}),
  args: [
    "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox",
    "--js-flags=--expose-gc"
  ]
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.split("\n")[0]));

// Zuhörer am window mitzählen. Das geht nur, wenn man addEventListener von
// Anfang an begleitet — darum vor dem ersten Skript der Seite.
await page.addInitScript(() => {
  window.__listenerCount = 0;
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  window.addEventListener = (...args) => { window.__listenerCount += 1; return add(...args); };
  window.removeEventListener = (...args) => { window.__listenerCount -= 1; return remove(...args); };
});

console.log(`Tumblekin Langzeittest — ${rounds} Runden in EINER Seite auf ${base}\n`);

await page.goto(`${base}/?dev=1`, { waitUntil: "networkidle" });
await page.fill("#player-name", "Langzeit");
await page.click("#create-room");
await page.waitForSelector("#screen-lobby.active", { timeout: 15000 });
await page.click("#enable-dev-mode");
await page.waitForTimeout(400);
await page.click("#start-game");
await page.waitForSelector("[data-dev-game-select]", { timeout: 15000 });

async function measure() {
  return page.evaluate(() => new Promise((resolve) => {
    if (window.gc) window.gc();
    const scene = window.__tumblekinScene;
    const done = () => resolve({
      geometries: scene?.renderer?.info?.memory?.geometries ?? null,
      textures: scene?.renderer?.info?.memory?.textures ?? null,
      listeners: window.__listenerCount,
      heapMB: performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null,
      // Wieviele lebende WebGL-Kontexte hängen noch in der Seite? Jedes
      // <canvas> im Dokument, das einen Kontext hat, zählt.
      canvases: document.querySelectorAll("canvas").length
    });
    requestAnimationFrame(() => requestAnimationFrame(done));
  }));
}

const samples = [];
let broke = null;

for (let round = 0; round < rounds; round += 1) {
  const game = GAMES[round % GAMES.length];
  const before = errors.length;
  try {
    await page.waitForSelector("[data-dev-game-select]", { timeout: 20000 });
    await page.selectOption("[data-dev-game-select]", game);
    await page.click("[data-dev-challenge]");
    await page.waitForSelector("canvas.kinetic-webgl, canvas.bounce-webgl", { timeout: 20000 });
    await page.waitForTimeout(4200);          // Countdown

    const canvas = await page.$("canvas.kinetic-webgl, canvas.bounce-webgl");
    const box = await canvas.boundingBox();
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.click(box.x + box.width * (0.35 + 0.3 * (i % 2)), box.y + box.height * 0.6);
      await page.waitForTimeout(160);
    }

    const sample = await measure();
    samples.push({ round: round + 1, game, ...sample });

    // Die Runde LÄUFT AUS. Von aussen beenden geht nicht: die Uhr gehört dem
    // Server, ein gesetztes finaleAt im Browser ändert daran nichts — der
    // Versuch hing hier zuverlässig fest. Also einmal ehrlich durchspielen; das
    // ist ohnehin näher am echten Abend, um den es hier geht.
    await page.waitForSelector("#screen-result.active", { timeout: 90000 });
    const ready = await page.$("#result-ready");
    if (ready && await ready.isVisible()) await ready.click().catch(() => {});
    await page.waitForSelector("#screen-board.active", { timeout: 30000 });
    await page.waitForTimeout(400);
  } catch (error) {
    broke = `Runde ${round + 1} (${game}): ${error.message.split("\n")[0]}`;
    break;
  }
  if (errors.length > before) {
    const fresh = errors.slice(before);
    console.log(`  Runde ${round + 1} ${game.padEnd(14)} ${fresh.length} Konsolenfehler: ${fresh[0]}`);
  }
}

await browser.close();
server.kill("SIGTERM");
await new Promise((resolve) => setTimeout(resolve, 200));

// --- Auswertung ------------------------------------------------------------
console.log("Runde  Spiel           Geometrien  Texturen  Zuhörer  Canvas  Heap");
samples.forEach((s) => {
  if (s.round % 5 === 1 || s.round === samples.length) {
    console.log(
      String(s.round).padStart(5),
      "  " + s.game.padEnd(14),
      String(s.geometries ?? "–").padStart(10),
      String(s.textures ?? "–").padStart(9),
      String(s.listeners).padStart(8),
      String(s.canvases).padStart(7),
      (s.heapMB === null ? "–" : `${s.heapMB} MB`).padStart(8)
    );
  }
});

let failed = false;
const say = (ok, text) => { console.log(`${ok ? "✓" : "✗"} ${text}`); if (!ok) failed = true; };

console.log("");
if (broke) { console.log(`✗ ${broke}`); failed = true; }
if (samples.length < 3) {
  console.log("✗ Zu wenige Runden gelaufen, um etwas auszusagen.");
  failed = true;
} else {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const half = samples[Math.floor(samples.length / 2)];

  // Canvas: das ist die harte Grenze. Bleibt pro Runde eines liegen, ist die
  // Partie nach etwa 16 Runden vorbei.
  say(last.canvases <= first.canvases + 1,
    `WebGL-Flächen stabil (${first.canvases} → ${last.canvases}); Browser geben rund 16 her`);

  // Geometrien/Texturen: three.js räumt die nicht von allein ab. Ein wenig
  // Schwankung ist normal (verschiedene Szenen sind verschieden gross), ein
  // monotoner Anstieg über die zweite Hälfte ist es nicht.
  if (first.geometries !== null) {
    const grewSteadily = last.geometries > half.geometries && half.geometries > first.geometries;
    say(!grewSteadily,
      `Geometrien wachsen nicht stetig (${first.geometries} → ${half.geometries} → ${last.geometries})`);
    say(last.textures <= first.textures + 4,
      `Texturen stabil (${first.textures} → ${last.textures})`);
  }

  // Zuhörer am window: jede Szene hängt welche an und muss sie wieder abnehmen.
  say(last.listeners <= first.listeners + 4,
    `window-Zuhörer stabil (${first.listeners} → ${last.listeners})`);

  if (first.heapMB !== null) {
    say(last.heapMB < first.heapMB * 3,
      `Heap im Rahmen (${first.heapMB} MB → ${last.heapMB} MB nach ${samples.length} Runden)`);
  }
}

say(errors.length === 0, `${errors.length} Konsolenfehler über ${samples.length} Runden`);
if (errors.length) [...new Set(errors)].slice(0, 8).forEach((line) => console.log(`   ${line}`));
if (serverLog.trim()) console.log(`\nServer meldete:\n${serverLog.trim().split("\n").slice(0, 8).join("\n")}`);

process.exit(failed ? 1 : 0);
