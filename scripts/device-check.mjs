// Geräte-Matrix: dieselben Bildschirme auf allen Geräteformen, die es gibt —
// zugeklapptes und aufgeklapptes Fold, Flip, Surface Duo (einzeln und über
// beide Bildschirme), kleine und grosse Handys, quer gehaltene Handys,
// Tablets hoch und quer, Desktop und Ultrawide.
//
//   npm run device-check                    (alle Geräte)
//   npm run device-check -- fold-zu tablet  (nur diese)
//
// Je Gerät: Start, Lobby, Mehr, Spielauswahl, Einladung, Startkarte, zwei
// laufende Spiele (Stick und Knöpfe), Menü und Ergebnis. Zu jedem Bild misst
// die Seite selbst, was man mit dem Auge leicht übersieht:
//   - waagrechtes Scrollen (etwas ist breiter als der Bildschirm),
//   - sichtbare Knöpfe und Felder, die über den Rand ragen,
//   - Text, der in seinem Knopf oder seiner Pille abgeschnitten wird,
//   - Knöpfe kleiner als 40 px (zu klein für den Daumen).
// Bilder und Befunde: TUMBLEKIN_SCREENSHOTS (Standard /tmp/tumblekin-devices).
import { mkdir, writeFile } from "node:fs/promises";
import { launchBrowser, startServer, request, watchErrors } from "./lib/harness.mjs";

export const DEVICES = [
  { name: "fold-zu", width: 280, height: 653, label: "Galaxy Fold zugeklappt" },
  { name: "fold5-zu", width: 344, height: 882, label: "Galaxy Z Fold 5 zugeklappt" },
  { name: "fold-auf", width: 690, height: 829, label: "Galaxy Z Fold aufgeklappt" },
  { name: "fold-auf-quer", width: 829, height: 690, label: "Galaxy Z Fold aufgeklappt, quer" },
  { name: "flip", width: 412, height: 1004, label: "Galaxy Z Flip (22:9)" },
  { name: "duo", width: 540, height: 720, label: "Surface Duo, ein Bildschirm" },
  // Aufgespannt mit Scharnier (34 px) zwischen den beiden Bildschirmen.
  { name: "duo-gespannt", width: 1114, height: 720, label: "Surface Duo über beide Bildschirme", hinge: { orientation: "vertical", offset: 540, maskLength: 34 } },
  { name: "duo-gespannt-hoch", width: 720, height: 1114, label: "Surface Duo über beide, hoch", hinge: { orientation: "horizontal", offset: 540, maskLength: 34 } },
  { name: "handy-klein", width: 360, height: 640, label: "kleines Android" },
  { name: "handy-se", width: 375, height: 667, label: "iPhone SE" },
  { name: "handy", width: 390, height: 844, label: "iPhone 14" },
  { name: "handy-gross", width: 430, height: 932, label: "iPhone Pro Max" },
  { name: "handy-quer", width: 844, height: 390, label: "Handy quer" },
  { name: "handy-quer-klein", width: 667, height: 375, label: "iPhone SE quer" },
  { name: "fold-zu-quer", width: 653, height: 280, label: "Galaxy Fold zugeklappt, quer" },
  { name: "tablet-mini", width: 768, height: 1024, label: "iPad mini" },
  { name: "tablet", width: 820, height: 1180, label: "iPad Air" },
  { name: "tablet-quer", width: 1180, height: 820, label: "iPad Air quer" },
  { name: "tablet-gross", width: 1024, height: 1366, label: "iPad Pro 12,9" },
  { name: "tablet-gross-quer", width: 1366, height: 1024, label: "iPad Pro 12,9 quer" },
  { name: "android-tablet", width: 800, height: 1280, label: "Android-Tablet" },
  { name: "desktop", width: 1280, height: 800, label: "Laptop" },
  { name: "fullhd", width: 1920, height: 1080, label: "Full HD" },
  { name: "ultrawide", width: 2560, height: 1080, label: "Ultrawide" }
];

const wanted = process.argv.slice(2);
const devices = wanted.length ? DEVICES.filter((d) => wanted.includes(d.name)) : DEVICES;
if (!devices.length) {
  console.error(`Unbekanntes Gerät. Verfügbar: ${DEVICES.map((d) => d.name).join(", ")}`);
  process.exit(2);
}
const out = process.env.TUMBLEKIN_SCREENSHOTS || "/tmp/tumblekin-devices";

// Grosse Bildschirme rendert der Testbrowser ohne Grafikkarte mit wenigen
// Bildern pro Sekunde. Darum wird der Spielstand im Takt abgefragt statt pro
// Bild (requestAnimationFrame), und die Fristen sind grosszügig.
// Auf Ultrawide (2560 × 1080) blockiert das Kompilieren der Shader nach
// „Bereit!“ den Hauptthread dort rund 35 Sekunden — gemessen; auf echter
// Hardware Sekundenbruchteile. Für so grosse Flächen gelten 120 Sekunden.
let patience = 45000;
const phase = (page, wanted, timeout = patience) => page.waitForFunction(
  (names) => names.includes(window.__tumblekin.state()?.phase), [wanted].flat(), { timeout, polling: 250 });
await mkdir(out, { recursive: true });

// Läuft in der Seite: was ragt hinaus, was ist abgeschnitten, was ist zu klein.
function inspect() {
  // Gemessen wird das fertige Layout: Einblend-Animationen (Pillen wachsen
  // von 60 % auf volle Grösse) werden vorher abgeschlossen. Bei wenigen
  // Bildern pro Sekunde erwischte die Messung sie sonst mittendrin.
  for (const animation of document.getAnimations()) {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.finish();
  }
  const visible = (el) => {
    if (el.closest("[hidden]")) return false;
    // Inhalt einer zugeklappten <details> ist nicht zu sehen, nur ihr <summary>.
    const details = el.closest("details:not([open])");
    if (details && !el.closest("summary")) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  // Nur was zur aktiven Ansicht gehört: ein offenes Overlay, sonst der aktive Bildschirm.
  const overlay = [...document.querySelectorAll(".overlay:not([hidden]), .qr-overlay")].find(visible);
  const root = overlay || document.querySelector(".screen.active") || document.body;
  const scopes = [root];
  if (!overlay) scopes.push(...document.querySelectorAll(".kinetic-hud, #minigame-controls, .game-menu-button"));
  const pick = (selector) => scopes.flatMap((scope) => (scope.matches?.(selector) ? [scope] : [])
    .concat([...scope.querySelectorAll(selector)])).filter(visible);
  const W = innerWidth;
  const H = innerHeight;
  const name = (el) => (el.id ? `#${el.id}` : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : el.tagName.toLowerCase())
    + (el.textContent.trim() ? ` „${el.textContent.trim().replace(/\s+/g, " ").slice(0, 28)}“` : "");
  // In einer scrollbaren Karte darf etwas unter dem Rand liegen — man
  // erreicht es. Gezählt wird nur, was in keinem scrollbaren Vorfahren steckt.
  const scrollable = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
    }
    return false;
  };
  const controls = pick("button, input, select, .btn, .chip");
  const outside = controls.filter((el) => {
    const r = el.getBoundingClientRect();
    const horizontal = r.left < -1 || r.right > W + 1;
    const vertical = (r.top < -1 || r.bottom > H + 1) && !scrollable(el);
    return horizontal || vertical;
  }).map(name);
  const clipped = pick("button, .btn, .chip, .simon-round, .hud-chip, .kinetic-scorebar strong, .qr-hint, h1, h2, h3, strong")
    .filter((el) => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== "visible"
      || el.scrollWidth > el.getBoundingClientRect().width + 4 && el.tagName === "BUTTON")
    .map(name);
  const tiny = controls.filter((el) => (el.tagName === "BUTTON" || el.classList.contains("btn")) && !el.disabled)
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 40 || r.height < 40; })
    .map((el) => `${name(el)} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);
  return {
    scrollX: document.documentElement.scrollWidth > W + 1 ? document.documentElement.scrollWidth - W : 0,
    outside: [...new Set(outside)].slice(0, 8),
    clipped: [...new Set(clipped)].slice(0, 8),
    tiny: [...new Set(tiny)].slice(0, 8)
  };
}

const server = await startServer({ log: true });
const browser = await launchBrowser();
const report = [];
let problems = 0;
try {
  for (const device of devices) {
    const context = await browser.newContext({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: 1,
      hasTouch: device.width < 1200,
      isMobile: device.width < 1200
    });
    const page = await context.newPage();
    patience = device.width * device.height > 2.5e6 ? 120000 : 45000;
    let cdp = null;
    if (device.hinge) {
      // Chromium kann das Scharnier vortäuschen: dann gelten die
      // Viewport-Segmente in CSS (horizontal-viewport-segments) und JS.
      // Nur über die Gerätemetrik — setDisplayFeaturesOverride allein
      // ändert die Segmente nicht.
      cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: device.width, height: device.height, deviceScaleFactor: 1, mobile: true, displayFeature: device.hinge
      }).catch((error) => console.log(`    (Scharnier nicht nachstellbar: ${error.message.split("\n")[0]})`));
    }
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 4 });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 2 });
    });
    const errors = watchErrors(page);
    const row = { device: device.name, label: device.label, size: `${device.width}×${device.height}`, shots: [] };
    // page.screenshot setzt Playwrights eigene Gerätemetrik wieder ein und
    // nähme das Scharnier weg — mit Scharnier also direkt über CDP.
    const capture = async (file) => {
      if (!cdp) return page.screenshot({ path: file });
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(file, Buffer.from(data, "base64"));
    };
    const shot = async (what, wait = 600) => {
      await page.waitForTimeout(wait);
      const file = `${out}/${device.name}-${what}.png`;
      await capture(file);
      const found = await page.evaluate(inspect);
      row.shots.push({ what, ...found });
    };
    try {
      await page.goto(`${server.base}/?dev=1`, { waitUntil: "networkidle" });
      if (device.hinge && !(await page.evaluate(() => (window.viewport?.segments?.length || 1) === 2))) {
        throw new Error("Scharnier kommt in der Seite nicht an (viewport.segments)");
      }
      await shot("01-start", 1200);
      await page.fill("#player-name", "Mia");
      await page.click("#create-room");
      await page.waitForSelector("#screen-lobby.active");
      await request(page, "addTestPlayers");
      await shot("02-lobby", 1200);
      await page.click(".more-options summary").catch(() => {});
      await shot("03-mehr");
      await page.click('[data-open-picker="pool"]').catch(() => {});
      await shot("04-auswahl");
      await page.click("#picker-close").catch(() => {});
      await page.click("#open-invite").catch(() => {});
      await shot("05-einladung");
      await page.click("#invite-close").catch(() => {});
      for (const [index, game] of [["06", "farbenjagd"], ["08", "flaggenhoch"]]) {
        await request(page, "selectMode", { mode: "single" });
        await request(page, "updateSettings", { settings: { single: game } });
        await request(page, "startGame");
        await page.waitForSelector("#screen-minigame.active", { timeout: patience });
        await phase(page, "waitingReady");
        if (index === "06") await shot("06-startkarte", 1200);
        await page.click("#intro-ready");
        await phase(page, "playingMinigame");
        await page.waitForSelector("#minigame-intro", { state: "hidden", timeout: patience });
        await shot(`${index === "06" ? "07" : "09"}-${game}`, 2500);
        if (index === "06") {
          await page.click("#game-menu-button").catch(() => {});
          await shot("08-menue", 500);
          await page.click("#menu-resume").catch(() => {});
        }
        // Flaggen hoch kann bei langsamen Bildern schon vorbei sein.
        const playing = await page.evaluate(() => window.__tumblekin.state()?.phase === "playingMinigame");
        if (playing) await request(page, "devSkipMinigame").catch(() => {});
        // Das Einzelspiel kehrt nach der Ergebnistafel von selbst in die
        // Lobby zurück — bei wenigen Bildern pro Sekunde manchmal schneller,
        // als die Abfrage sie zu sehen bekommt.
        const status = (wanted) => page.waitForFunction(
          (names) => names.includes(window.__tumblekin.state()?.status), wanted, { timeout: patience, polling: 250 });
        await status(["result", "lobby"]);
        const onResult = await page.evaluate(() => window.__tumblekin.state()?.status === "result");
        if (index === "08" && onResult) await shot("10-ergebnis", 2500);
        else if (index === "08") row.shots.push({ what: "10-ergebnis (übersprungen)", scrollX: 0, outside: [], clipped: [], tiny: [] });
        if (await page.evaluate(() => window.__tumblekin.state()?.status !== "lobby")) await request(page, "restartGame");
        await status(["lobby"]);
        await page.waitForSelector("#screen-lobby.active", { timeout: patience });
      }
    } catch (error) {
      const where = await page.evaluate(() => {
        const state = window.__tumblekin?.state();
        return `${state?.status ?? "?"}/${state?.phase ?? "?"}`;
      }).catch(() => "?");
      row.error = `${error.message.split("\n")[0]} (Stand: ${where})`;
      await capture(`${out}/${device.name}-fehler.png`).catch(() => {});
    }
    row.errors = [...errors];
    const bad = row.shots.filter((s) => s.scrollX || s.outside.length || s.clipped.length || s.tiny.length);
    if (bad.length || row.error || row.errors.length) problems += 1;
    console.log(`${bad.length || row.error || row.errors.length ? "✗" : "✓"} ${device.name.padEnd(18)} ${row.size.padEnd(10)} ${row.error ? "FEHLER " + row.error : `${row.shots.length} Bilder`}`);
    for (const s of bad) {
      const parts = [];
      if (s.scrollX) parts.push(`${s.scrollX}px zu breit`);
      if (s.outside.length) parts.push(`ragt hinaus: ${s.outside.join(", ")}`);
      if (s.clipped.length) parts.push(`abgeschnitten: ${s.clipped.join(", ")}`);
      if (s.tiny.length) parts.push(`zu klein: ${s.tiny.join(", ")}`);
      console.log(`    ${s.what}: ${parts.join(" · ")}`);
    }
    row.errors.slice(0, 3).forEach((e) => console.log(`    Fehler: ${e}`));
    report.push(row);
    await writeFile(`${out}/befunde.json`, JSON.stringify(report, null, 2));
    await context.close();
  }
} finally {
  await browser.close();
  server.stop();
}
console.log(`\n${devices.length - problems}/${devices.length} Geräte ohne Befund · Bilder: ${out}`);
process.exit(problems ? 1 : 0);
