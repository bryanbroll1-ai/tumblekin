// Mitspielen in der Browser-Fassung: Host + Gast über Raum (ohne WebRTC) + Gast über WebRTC.
import { launchBrowser, watchErrors } from "../scripts/lib/harness.mjs";
import { spawn } from "node:child_process";
import os from "node:os";
import pathMod from "node:path";
// Bildschirmfotos landen im Temp-Ordner, nicht im Repository.
const shot = (name) => pathMod.join(os.tmpdir(), "tumblekin-" + name);
import fs from "node:fs";
const port = 8781;
const latency = Number(process.argv[2] || 60);
const game = process.argv[3] || "nervenprobe";
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: new URL("./dist/", import.meta.url).pathname, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const mock = fs.readFileSync(new URL("./mock-room.js", import.meta.url), "utf8");
const browser = await launchBrowser({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
async function device(name, { rtc = true } = {}) {
  const page = await ctx.newPage();
  await page.addInitScript(({ mock, latency, rtc }) => {
    // Jedes Gerät hat seinen eigenen Speicher (sonst teilten sich die Seiten die Sitzung).
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("eigenes Gerät"); } });
    window.__mockLatency = latency;
    if (!rtc) { delete window.RTCPeerConnection; window.RTCPeerConnection = undefined; }
    eval(mock);
  }, { mock, latency, rtc });
  page.errors = watchErrors(page);
  await page.goto(`http://127.0.0.1:${port}/?dev=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.classList.contains("can-join"), null, { timeout: 15000 });
  await page.fill("#player-name", name);
  return page;
}
const state = (p) => p.evaluate(() => window.__tumblekin.state());
const net = (p) => p.evaluate(() => globalThis.__tumblekinNetStatus());
const host = await device("Bryan");
await host.click("#create-room");
await host.waitForSelector("#screen-lobby.active");
const code = (await state(host)).code;
console.log("Raumcode:", code);
await host.click("#open-invite");
await host.waitForTimeout(600);
console.log("Einladung:", await host.evaluate(() => ({ qr: document.querySelector("#qr-code").src.slice(0, 26), hint: document.querySelector("#invite-hint").textContent.slice(0, 60) })));
await host.screenshot({ path: shot("join-invite.png") });
await host.click("#invite-close");

const relay = await device("Lina", { rtc: false });
await relay.fill("#room-code", code.toLowerCase());
let t = Date.now();
await relay.click("#join-room");
await relay.waitForSelector("#screen-lobby.active", { timeout: 25000 });
console.log("Lina (Raum) in der Lobby nach", Date.now() - t, "ms");

const direct = await device("Tom");
await direct.waitForSelector(".party-item", { timeout: 10000 });
console.log("Partyliste bei Tom:", await direct.textContent(".party-item"));
await direct.screenshot({ path: shot("join-partylist.png") });
t = Date.now();
await direct.click(".party-item");
await direct.waitForSelector("#screen-lobby.active", { timeout: 25000 });
console.log("Tom (Liste) in der Lobby nach", Date.now() - t, "ms");
await direct.waitForTimeout(3000);
console.log("Spieler beim Host:", (await state(host)).players.map((p) => p.name));
console.log("Spieler bei Lina:", (await state(relay)).players.map((p) => p.name));
console.log("Wege:", JSON.stringify({ host: await net(host), lina: await net(relay), tom: await net(direct) }));
await relay.screenshot({ path: shot("join-guest-lobby.png") });

// Ein Spiel zusammen
await host.evaluate(async (game) => {
  await window.__tumblekin.request("selectMode", { mode: "single" });
  await window.__tumblekin.request("updateSettings", { settings: { single: game } });
  await window.__tumblekin.request("startGame");
}, game);
for (const p of [host, relay, direct]) await p.waitForFunction(() => window.__tumblekin.state()?.phase === "waitingReady", null, { timeout: 15000 });
for (const p of [relay, direct, host]) await p.click("#intro-ready");
for (const p of [host, relay, direct]) await p.waitForFunction(() => window.__tumblekin.state()?.phase === "playingMinigame", null, { timeout: 20000 });
console.log("Spiel läuft auf allen drei Geräten");
await relay.waitForSelector("canvas.kinetic-webgl", { timeout: 15000 });
// Bis 4,5 s nach dem Start (Serveruhr laut Gast), dann drücken beide Gäste.
await relay.waitForFunction(() => { const s = window.__tumblekin.state(); const m = window.__tumblekin.activeMinigame(); return m && m.now() > s.currentMinigame.startedAt + 4500; }, null, { timeout: 30000, polling: 100 });
if (game === "nervenprobe") {
  for (const p of [relay, direct]) await p.dispatchEvent("[data-nerve-stop]", "pointerdown", { pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, bubbles: true, cancelable: true });
  await host.waitForTimeout(1500);
  const arcade = await host.evaluate(() => window.__tumblekin.activeMinigame()?.update?.arcade || window.__tumblekin.activeMinigame()?.minigame?.arcade);
  const ids = Object.fromEntries((await state(host)).players.map((p) => [p.name, p.id]));
  await relay.screenshot({ path: shot("join-guest-game.png") });
  console.log("Beim Host angekommen — Stopps (ms):", { Lina: arcade?.players?.[ids.Lina]?.stoppedMs, Tom: arcade?.players?.[ids.Tom]?.stoppedMs });
}
await relay.waitForSelector("#screen-result.active", { timeout: 90000 }).then(() => console.log("Ergebnis bei Lina angekommen")).catch(() => console.log("KEIN Ergebnis bei Lina"));
await relay.waitForTimeout(800);
await relay.screenshot({ path: shot("join-guest-result.png") });
console.log("Raum-Statistik Host:", await host.evaluate(() => { const s = window.__mockRoomStats; return { emits: s.emits, maxProSekunde: s.maxPerSecond, maxBytes: s.maxBytes, abgelehnt: s.rejected }; }));
console.log("Raum-Statistik Lina:", await relay.evaluate(() => { const s = window.__mockRoomStats; return { praesenz: s.presenceSets, abgelehnt: s.rejected }; }));
// Tom geht, dann beendet der Host die Party, Lina startet ihre eigene.
await direct.click("#leave-room");
await direct.waitForSelector("#screen-start.active", { timeout: 15000 });
await host.waitForFunction(() => window.__tumblekin.state()?.players.length === 2, null, { timeout: 15000 }).then(() => console.log("Tom ist gegangen, beim Host noch 2 Spieler")).catch(async () => console.log("Tom noch beim Host:", (await state(host))?.players.map((p) => p.name)));
await host.click("#screen-result.active #result-ready").catch(() => {});
await host.waitForSelector("#screen-lobby.active", { timeout: 30000 }).catch(() => {});
await host.click("#leave-room");
await relay.waitForFunction(() => !window.__tumblekin.state(), null, { timeout: 20000 }).then(() => console.log("Host hat beendet: Lina zurück am Start")).catch(() => console.log("Lina hängt nach Host-Ende"));
console.log("Lina danach:", JSON.stringify(await net(relay)));
await relay.click("#create-room");
await relay.waitForSelector("#screen-lobby.active", { timeout: 15000 }).then(async () => console.log("Lina leitet jetzt selbst eine Party:", JSON.stringify(await net(relay)))).catch(() => console.log("Lina kann keine eigene Party starten"));
// Host schliesst das Fenster: Gäste erfahren es nach der Schonfrist.
await direct.fill("#room-code", (await state(relay)).code);
await direct.click("#join-room");
await direct.waitForSelector("#screen-lobby.active", { timeout: 25000 });
await relay.close();
await direct.waitForFunction(() => !window.__tumblekin.state(), null, { timeout: 25000 }).then(() => console.log("Fenster des Hosts zu: Tom zurück am Start")).catch(() => console.log("Tom hängt, nachdem das Host-Fenster zu ist"));
console.log("Fehler:", JSON.stringify({ host: host.errors, lina: relay.errors, tom: direct.errors }));
console.log("Toast bei Tom:", await direct.evaluate(() => document.querySelector("#toast")?.textContent));
await browser.close(); srv.kill(); process.exit(0);
