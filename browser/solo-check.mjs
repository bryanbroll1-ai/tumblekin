// Offline-Fassung: Startkarte mit Vorschaubild, Übung ohne Server, dann die
// echte Runde gegen Bots bis zum Ergebnis.
import { launchBrowser, watchErrors } from "../scripts/lib/harness.mjs";
import { spawn } from "node:child_process";
import os from "node:os";
import pathMod from "node:path";
// Bildschirmfotos landen im Temp-Ordner, nicht im Repository.
const shot = (name) => pathMod.join(os.tmpdir(), "tumblekin-" + name);
const port = 8766;
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: new URL("./dist/", import.meta.url).pathname, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = watchErrors(page);
const failed = [];
page.on("requestfailed", (req) => failed.push(req.url()));
page.on("response", (res) => { if (res.status() >= 400) failed.push(res.status() + " " + res.url()); });
await page.goto(`http://127.0.0.1:${port}/?dev=1`, { waitUntil: "networkidle" });
await page.fill("#player-name", "Bryan");
await page.click("#create-room");
await page.waitForSelector("#screen-lobby.active", { timeout: 10000 });
for (let i = 0; i < 3; i++) { await page.click("#add-bot"); await page.waitForTimeout(250); }
const type = process.argv[2] || "kanonenflug";
await page.evaluate(async (type) => {
  await window.__tumblekin.request("selectMode", { mode: "single" });
  await window.__tumblekin.request("updateSettings", { settings: { single: type } });
  await window.__tumblekin.request("startGame");
}, type);
await page.waitForFunction(() => window.__tumblekin.state()?.phase === "waitingReady", null, { timeout: 15000 });
await page.waitForTimeout(1500);
const preview = await page.evaluate(() => { const img = document.querySelector("#intro-preview") || document.querySelector(".intro-preview img"); return img ? { src: img.getAttribute("src"), w: img.naturalWidth } : null; });
console.log("Vorschaubild:", preview);
await page.screenshot({ path: shot("shots-intro.png") });
// Übung
await page.click("#intro-practice");
await page.waitForFunction(() => { const p = window.__tumblekin.ui.practice; return p.scene?.webglCanvas && p.state?.currentMinigame && Date.now() >= p.state.currentMinigame.startedAt; }, null, { timeout: 30000 });
const before = await page.evaluate(() => JSON.stringify(window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice));
const button = { kanonenflug: "[data-cannon-launch]", nervenprobe: "[data-nerve-stop]", ballonPump: "[data-pump]", messerwurf: "[data-knife-throw]" }[type];
if (button) await page.locator(".practice-layer " + button).tap();
await page.waitForTimeout(2500);
const after = await page.evaluate(() => JSON.stringify(window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice));
console.log("Übung reagiert:", before !== after);
await page.screenshot({ path: shot("shots-practice.png") });
await page.locator("[data-practice-close]").click();
await page.waitForTimeout(500);
// Runde
await page.click("#intro-ready");
await page.waitForSelector("#screen-minigame.active", { timeout: 15000 });
await page.waitForTimeout(6000);
await page.screenshot({ path: shot("shots-game.png") });
await page.waitForSelector("#screen-result.active, #screen-podium.active, #screen-lobby.active", { timeout: 90000 }).catch(() => console.log("kein Ergebnis-Bildschirm"));
await page.waitForTimeout(1500);
await page.screenshot({ path: shot("shots-result.png") });
console.log("Fehler:", errors.length, errors.slice(0, 5));
console.log("Fehlgeschlagene Anfragen:", failed.filter((u) => !u.includes("sw.js")).slice(0, 5));
await browser.close(); srv.kill(); process.exit(0);
