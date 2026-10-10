// Prüft die Seite so, wie die Android-Test-App sie ausliefert — ohne Handy.
//
//   node android/web-check.mjs [minispiel]
//
// Die App beantwortet alle Anfragen an https://appassets.androidplatform.net/
// selbst aus ihren Assets (MainActivity.serve). Hier macht Chromium dasselbe:
// gleiche Adresse, gleiche Pfadregeln und dieselben MIME-Typen — die stehen
// nicht doppelt hier, sie werden aus MainActivity.java gelesen. Dazu der
// User-Agent einer Android-WebView mit dem Kennzeichen der App.
//
// Geprüft: die Seite startet ohne Fehler und ohne fehlende Dateien, sagt
// „Test-App“ statt „Browser-Fassung“, und eine Runde gegen Bots läuft bis
// zum Ergebnis.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, watchErrors } from "../scripts/lib/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, "..", "browser", "dist");
const java = fs.readFileSync(path.join(HERE, "src/app/tumblekin/test/MainActivity.java"), "utf8");

const HOST = java.match(/static final String HOST = "([^"]+)"/)[1];
const START = `https://${HOST}${java.match(/START_URL = "https:\/\/" \+ HOST \+ "([^"]+)"/)[1]}`;
const MIME = {};
let pending = [];
for (const line of java.slice(java.indexOf("static String mimeFor")).split("\n")) {
  for (const m of line.matchAll(/case "([a-z0-9]+)":/g)) pending.push(m[1]);
  const ret = line.match(/return "([^"]+)";/);
  if (ret && pending.length) { pending.forEach((ext) => { MIME[ext] = ret[1]; }); pending = []; }
  if (line.includes("default:")) break;
}
if (!MIME.js || !MIME.html) throw new Error("MIME-Tabelle in MainActivity.java nicht gefunden");

// Wie MainActivity.assetFor: "/" ist index.html, ".." und "//" sind verboten.
function assetFor(p) {
  if (!p || p === "/") return "index.html";
  if (p.includes("..") || p.includes("\\") || p.includes("//")) return null;
  return p.replace(/^\//, "");
}

const shot = (name) => path.join(os.tmpdir(), "tumblekin-app-" + name);
const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 TumblekinApp/check"
});
const served = [];
const missing = [];
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.protocol !== "https:" || url.host !== HOST) {
    missing.push("außerhalb: " + url.href);
    return route.abort();
  }
  const name = assetFor(decodeURIComponent(url.pathname));
  const file = name && path.join(DIST, name);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    missing.push("404 " + url.pathname);
    return route.fulfill({ status: 404, contentType: "text/plain", body: "" });
  }
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  served.push(name);
  return route.fulfill({ status: 200, contentType: MIME[ext] || "application/octet-stream", body: fs.readFileSync(file) });
});

const failures = [];
const check = (ok, what) => { console.log((ok ? "ok    " : "FEHLER") + "  " + what); if (!ok) failures.push(what); };

// 1) Genau die Startadresse der App.
let page = await context.newPage();
let errors = watchErrors(page);
await page.goto(START, { waitUntil: "networkidle" });
await page.waitForSelector("#create-room", { timeout: 15000 });
const look = await page.evaluate(() => ({
  inApp: document.documentElement.classList.contains("in-app"),
  note: document.querySelector(".offline-note")?.innerText.trim(),
  secure: window.isSecureContext,
  storage: (() => { try { localStorage.setItem("__probe", "1"); return localStorage.getItem("__probe") === "1"; } catch { return false; } })()
}));
check(look.inApp, "Seite erkennt die App");
check(/^Test-App: du spielst gegen Bots/.test(look.note || ""), `Hinweis: „${look.note}“`);
check(look.secure, "sicherer Ursprung (Modul-Skript, Vibration, Audio)");
check(look.storage, "localStorage");
await page.screenshot({ path: shot("start.png") });
check(errors.length === 0, `keine Fehler beim Start (${errors.length})`);
await page.close();

// 2) Eine Runde gegen Bots (mit ?dev=1 für die Steuerung der Prüfung).
page = await context.newPage();
errors = watchErrors(page);
await page.goto(START + "?dev=1", { waitUntil: "networkidle" });
await page.fill("#player-name", "Test");
await page.click("#create-room");
await page.waitForSelector("#screen-lobby.active", { timeout: 10000 });
for (let i = 0; i < 3; i++) { await page.click("#add-bot"); await page.waitForTimeout(250); }
const type = process.argv[2] || "kippboot";
await page.evaluate(async (type) => {
  await window.__tumblekin.request("selectMode", { mode: "single" });
  await window.__tumblekin.request("updateSettings", { settings: { single: type } });
  await window.__tumblekin.request("startGame");
}, type);
await page.waitForFunction(() => window.__tumblekin.state()?.phase === "waitingReady", null, { timeout: 15000 });
const preview = await page.evaluate(() => {
  const img = document.querySelector("#intro-preview") || document.querySelector(".intro-preview img");
  return img ? img.naturalWidth : 0;
});
check(preview > 0, `Vorschaubild geladen (${type})`);
await page.click("#intro-ready");
await page.waitForSelector("#screen-minigame.active", { timeout: 15000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: shot("game.png") });
const done = await page.waitForSelector("#screen-result.active, #screen-podium.active", { timeout: 150000 }).then(() => true, () => false);
check(done, "Runde endet mit Ergebnis");
await page.screenshot({ path: shot("result.png") });
check(errors.length === 0, `keine Fehler in der Runde (${errors.length})`);
errors.slice(0, 5).forEach((e) => console.log("   ", e));

check(missing.length === 0, `keine fehlenden Dateien (${missing.length})`);
missing.slice(0, 5).forEach((m) => console.log("   ", m));
console.log(`ausgeliefert: ${[...new Set(served)].length} Dateien · Bilder: ${shot("*.png")}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
