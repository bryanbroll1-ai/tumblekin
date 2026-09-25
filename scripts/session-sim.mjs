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
import { ALL_GAMES, finishRound, launchBrowser, openRoom, startServer, startSingle } from "./lib/harness.mjs";

const argv = process.argv.slice(2);
const headed = argv.includes("--head");
const rounds = Number(argv.find((a) => /^\d+$/.test(a)) || 20);
const GAMES = ALL_GAMES;

const { base, stop: stopServer, errorOutput: serverOutput } = await startServer({ log: true });
// --js-flags=--expose-gc, damit die Heap-Zahl das Aufgeräumte nicht mitzählt.
const browser = await launchBrowser({ headed, args: ["--js-flags=--expose-gc"] });
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

await openRoom(page, base, { name: "Langzeit" });

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
    await startSingle(page, game);
    await page.waitForTimeout(4200);          // Countdown

    const canvas = await page.$("canvas.kinetic-webgl");
    const box = await canvas.boundingBox();
    for (let i = 0; i < 5; i += 1) {
      await page.mouse.click(box.x + box.width * (0.35 + 0.3 * (i % 2)), box.y + box.height * 0.6);
      await page.waitForTimeout(160);
    }

    const sample = await measure();
    samples.push({ round: round + 1, game, ...sample });

    // Die Runde werten und zurück in die Lobby — dieselbe Seite, kein Neuladen.
    await finishRound(page);
    await page.waitForSelector("#screen-lobby.active", { timeout: 20000 });
    await page.waitForTimeout(300);
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
stopServer();
const serverLog = serverOutput.join("");

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
