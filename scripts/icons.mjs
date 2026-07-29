// Erzeugt alle Icon-Größen aus client/assets/icon.svg.
//
//   npm run icons
//
// Braucht einmalig:  npm install --no-save playwright && npx playwright install chromium
//
// Warum ein Browser: das Projekt hat keine Bildbibliothek als Abhängigkeit, und
// Chromium rendert das SVG identisch zu dem, was Spieler später sehen.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SVG = path.join(ROOT, "client", "assets", "icon.svg");
const OUT = path.join(ROOT, "client", "assets");

// "any" = normales Icon, randlos gerendert.
// "maskable" = Android/iOS beschneiden das Icon; Inhalt muss in der inneren
// Sicherheitszone (80 %) liegen, außen deckt die Hintergrundfarbe.
const TARGETS = [
  { size: 144, purpose: "any", file: "icon-144.png" },
  { size: 180, purpose: "any", file: "icon-180.png" },   // iOS Touch-Icon
  { size: 192, purpose: "any", file: "icon-192.png" },   // PWA-Minimum
  { size: 384, purpose: "any", file: "icon-384.png" },
  { size: 512, purpose: "any", file: "icon-512.png" },   // Play Store
  { size: 512, purpose: "maskable", file: "icon-512-maskable.png" },
  { size: 1024, purpose: "any", file: "icon-1024.png" }  // App Store
];

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

function findBrowser() {
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return undefined;
  } catch { /* playwright-core bündelt keinen Browser */ }
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  console.error("Kein Chromium gefunden. npx playwright install chromium — oder CHROMIUM_PATH setzen.");
  process.exit(2);
}

if (!existsSync(SVG)) {
  console.error(`Quelle fehlt: ${SVG}`);
  process.exit(1);
}
const svg = readFileSync(SVG, "utf8");
// Maskable-Icons werden beschnitten, der Rand muss also gefüllt sein. Wir malen
// denselben Verlauf wie im SVG randlos hinter das eingerückte Motiv — eine
// abweichende Volltonfarbe ließ die abgerundete SVG-Fläche wie einen
// aufgeklebten Sticker wirken.
const BACKDROP = "linear-gradient(180deg, #5fb8dd 0%, #8fdcb8 100%)";

const executablePath = findBrowser();
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ["--no-sandbox"]
});

for (const target of TARGETS) {
  const page = await browser.newPage({
    viewport: { width: target.size, height: target.size },
    deviceScaleFactor: 1
  });
  // Maskable: Motiv auf 80 % schrumpfen, Rest deckt der Hintergrund.
  const inset = target.purpose === "maskable" ? 10 : 0;
  await page.setContent(`
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
      body { background: ${target.purpose === "maskable" ? BACKDROP : "transparent"}; }
      .wrap {
        position: absolute;
        inset: ${inset}%;
        display: grid;
        place-items: center;
      }
      svg { width: 100%; height: 100%; display: block; }
    </style>
    <div class="wrap">${svg}</div>
  `, { waitUntil: "load" });

  const buffer = await page.screenshot({
    omitBackground: target.purpose !== "maskable",
    type: "png"
  });
  writeFileSync(path.join(OUT, target.file), buffer);
  console.log(`✓ ${target.file.padEnd(26)} ${target.size}×${target.size} (${target.purpose}) ${(buffer.length / 1024).toFixed(1)} kB`);
  await page.close();
}

await browser.close();
console.log("\nIcons erzeugt. manifest.json bei neuen Größen mitpflegen.");
process.exit(0);
