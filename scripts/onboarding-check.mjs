// Zwei echte Geräte: Lesen, Filter, gemeinsames Bereit und Steuerung nach
// Drehung ins Querformat. Ausführbar mit npm run onboarding-check.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { launchBrowser, openRoom, request, startServer, startSingle, watchErrors } from "./lib/harness.mjs";

const server = await startServer({ log: true });
const browser = await launchBrowser();
const host = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const guest = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [...[host, guest].map((page) => watchErrors(page))];
const screenshotDir = process.env.TUMBLEKIN_SCREENSHOTS;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
const screenshot = async (page, name) => {
  if (!screenshotDir) return;
  await page.waitForSelector(".scene-transition.active", { state: "hidden" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${screenshotDir}/${name}.png` });
};

try {
  await openRoom(host, server.base, { name: "Host", bots: false });
  const code = await host.evaluate(() => window.__tumblekin.state().code);
  await guest.goto(`${server.base}/?dev=1`, { waitUntil: "networkidle" });
  await guest.fill("#player-name", "Gast");
  await guest.fill("#room-code", code);
  await guest.click("#join-room");
  await guest.waitForSelector("#screen-lobby.active");
  await host.waitForFunction(() => window.__tumblekin.state().players.length === 2);

  // Pool filtern, Suchergebnisse hinzufügen, Auswahl erhalten und speichern.
  await host.click('[data-open-picker="pool"]');
  assert.equal(await host.locator("[data-pick]").count(), 40);
  await host.click("[data-picker-none]");
  assert.equal(await host.locator("#picker-done").isDisabled(), true);
  await host.click('[data-category="thinking"]');
  const thinkers = await host.locator("[data-pick]").count();
  assert.ok(thinkers >= 5);
  await host.click("[data-picker-visible]");
  await host.fill("#picker-search", "Pump");
  assert.equal(await host.locator("[data-pick]").count(), 0);
  assert.ok(await host.locator(".pick-empty").isVisible());
  await host.click('[data-category="all"]');
  assert.equal(await host.locator("[data-pick]").count(), 1);
  await host.click("[data-picker-visible]");
  await host.fill("#picker-search", "augenmass");
  assert.equal(await host.locator('[data-pick="augenmass"]').count(), 1);
  await host.fill("#picker-search", "");
  assert.equal(await host.locator(".pick-card.is-picked").count(), thinkers + 1);
  const textFits = await host.evaluate(() => [...document.querySelectorAll(".pick-card")].every((card) =>
    card.querySelector("small").getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom));
  assert.ok(textFits, "Gestenbeschriftungen müssen in ihre Spielkarten passen");
  await screenshot(host, "picker");
  await host.setViewportSize({ width: 844, height: 390 });
  const gridHeight = await host.locator("#picker-grid").boundingBox();
  assert.ok(gridHeight.height >= 80, "Auch im Querformat bleibt die Spielauswahl bedienbar");
  await screenshot(host, "picker-landscape");
  await host.setViewportSize({ width: 390, height: 844 });
  await host.click("#picker-done");
  await host.waitForFunction((count) => window.__tumblekin.state().settings.pool?.length === count, thinkers + 1);
  console.log("✓ Kategorien, Suche, leere Treffer und gespeicherte Mehrfachauswahl");

  await host.click('[data-mode="single"]');
  await host.click('[data-open-picker="single"]');
  await host.fill("#picker-search", "Rohr");
  await host.click('[data-pick="rohrsalat"]');
  await host.waitForFunction(() => window.__tumblekin.state().settings.single === "rohrsalat");
  await host.click("#start-game");
  await host.waitForSelector("#intro-ready");
  await guest.waitForSelector("#intro-ready");
  await host.click("#intro-details summary");
  assert.ok((await host.textContent("#intro-rules")).includes("Querrohr"));
  await host.click("#intro-details summary");
  await screenshot(host, "intro-portrait");
  await host.waitForTimeout(4500);
  assert.equal(await host.evaluate(() => window.__tumblekin.state().currentMinigame.startedAt), null);
  assert.equal(await host.locator("canvas.kinetic-webgl").count(), 0);
  await assert.rejects(request(host, "minigameInput", { input: { action: "tap" } }));
  await host.setViewportSize({ width: 844, height: 390 });
  await screenshot(host, "intro-landscape");
  await host.click("#intro-ready");
  await guest.waitForFunction(() => window.__tumblekin.state().readyForMinigame.length === 1);
  await host.waitForFunction(() => document.querySelector("#intro-ready").disabled);
  assert.equal(await host.locator("#intro-ready").isDisabled(), true);
  assert.equal(await host.evaluate(() => window.__tumblekin.state().phase), "waitingReady");
  await guest.click("#intro-ready");
  await host.waitForSelector("canvas.kinetic-webgl");
  await guest.waitForSelector("canvas.kinetic-webgl");
  const hostId = await host.evaluate(() => window.__tumblekin.state().currentMinigame.id);
  const guestId = await guest.evaluate(() => window.__tumblekin.state().currentMinigame.id);
  assert.equal(hostId, guestId);
  await host.waitForSelector("#minigame-intro", { state: "hidden", timeout: 10000 });
  console.log("✓ Lesepause ohne Zeitdruck, volle Regeln und gemeinsamer Countdown auf zwei Geräten");

  // Vor der nächsten Runde muss erneut jeder bereit sein; ein Gerät trennt
  // sich während der Startkarte. Die verbleibende Person kann weitergehen.
  await request(host, "restartGame");
  await host.waitForSelector("#screen-lobby.active");
  await request(host, "updateSettings", { settings: { single: "luftpuck" } });
  await request(host, "startGame");
  await host.waitForSelector("#intro-ready");
  await guest.waitForSelector("#intro-ready");
  await host.click("#intro-ready");
  await guest.close();
  await host.waitForFunction(() => window.__tumblekin.state().phase === "playingMinigame");
  await host.waitForSelector("#minigame-intro", { state: "hidden", timeout: 10000 });
  await host.waitForTimeout(1000);
  const layout = await host.evaluate(() => {
    const stick = document.querySelector(".virtual-joystick").getBoundingClientRect();
    const scene = window.__tumblekinScene;
    return { stick: { x: stick.x, width: stick.width }, band: scene.rig.band };
  });
  assert.ok(layout.stick.x < 40 && layout.stick.width <= 120);
  assert.ok(layout.band.left >= layout.stick.x + layout.stick.width);
  assert.ok(layout.band.bottom - layout.band.top > 250);
  await screenshot(host, "luftpuck-landscape");
  const box = await host.locator(".virtual-joystick").boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();
  await host.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
  await host.waitForTimeout(250);
  assert.ok(await host.locator(".virtual-joystick.active").count());
  await host.mouse.up();
  await host.setViewportSize({ width: 390, height: 844 });
  await host.waitForTimeout(800);
  const portraitStick = await host.locator(".virtual-joystick").boundingBox();
  assert.ok(portraitStick.x > 90 && portraitStick.width > 150);
  console.log("✓ Geräteabbruch während Bereit, seitlicher Stick, Kameraband und Drehung zurück ins Hochformat");

  // Stick + Aktionsknopf müssen beide erreichbar bleiben; dazwischen wird
  // gespielt. Prüft auch den Szenenwechsel nach einer vorherigen Stick-Szene.
  await request(host, "restartGame");
  await host.waitForSelector("#screen-lobby.active");
  await host.setViewportSize({ width: 667, height: 375 });
  await startSingle(host, "schnappschuss");
  await host.waitForSelector("#minigame-intro", { state: "hidden", timeout: 10000 });
  const sides = await host.evaluate(() => {
    const stick = document.querySelector(".virtual-joystick").getBoundingClientRect();
    const action = document.querySelector("[data-photo-shove]").getBoundingClientRect();
    return { stickRight: stick.right, actionLeft: action.left, actionRight: action.right, band: window.__tumblekinScene.rig.band };
  });
  assert.ok(sides.actionLeft > 500 && sides.actionRight <= 667);
  assert.ok(sides.band.left >= sides.stickRight && sides.band.right <= sides.actionLeft);
  assert.ok(sides.band.right - sides.band.left >= 350);
  await screenshot(host, "schnappschuss-landscape");
  console.log("✓ Querformat mit Stick und Aktionsknopf auf einem kleineren Handy");
  assert.deepEqual(errors.flat(), []);
  assert.deepEqual(server.errorOutput, []);
} finally {
  await browser.close();
  server.stop();
}
