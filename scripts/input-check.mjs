import assert from "node:assert/strict";
import { backToLobby, launchBrowser, openRoom, startServer, startSingle, watchErrors } from "./lib/harness.mjs";
const server = await startServer({ log: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = watchErrors(page);
const pointer = (selector, type, pointerId) => page.dispatchEvent(selector, type, { pointerId, pointerType: "touch", bubbles: true, cancelable: true });
const blur = () => page.evaluate(() => window.dispatchEvent(new Event("blur")));
try {
  await openRoom(page, server.base, { name: "Eingaben" });
  await startSingle(page, "ballonfahrt");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  await pointer("canvas.kinetic-webgl", "pointerdown", 11);
  await page.waitForFunction(() => window.__tumblekinScene.holding === true);
  await pointer("[data-glide-drop]", "pointerdown", 22);
  await pointer("[data-glide-drop]", "pointerup", 22);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.__tumblekinScene.holding), true, "Abwurf mit zweitem Finger darf den Brenner nicht lösen");
  await page.waitForFunction(() => {
    const s = window.__tumblekinScene;
    const p = s.update.arcade.players[s.getControlledPlayerId()];
    return p.holding && p.bags.length > 0;
  });
  await blur();
  await page.waitForFunction(() => {
    const s = window.__tumblekinScene;
    return !s.holding && !s.update.arcade.players[s.getControlledPlayerId()].holding;
  });
  await pointer("canvas.kinetic-webgl", "pointerdown", 33);
  await page.waitForFunction(() => window.__tumblekinScene.holding === true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
  assert.equal(await page.evaluate(() => window.__tumblekinScene.holding), false);
  console.log("✓ Ballon: zweiter Finger wirft ab, Brenner bleibt an; Blur und versteckter Tab lösen ihn");

  await backToLobby(page);
  await startSingle(page, "angelduell");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  await pointer("[data-fish-reel]", "pointerdown", 11);
  await page.waitForFunction(() => window.__tumblekinScene.holding);
  await pointer("body", "pointerup", 22);
  assert.equal(await page.evaluate(() => window.__tumblekinScene.holding), true);
  await blur();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__tumblekinScene.holding), false);
  console.log("✓ Angel: fremder Finger stoppt Einholen nicht, Blur stoppt es");

  await backToLobby(page);
  await startSingle(page, "lichtwaechter");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  await pointer("[data-hold-run]", "pointerdown", 11);
  await page.waitForFunction(() => window.__tumblekinScene.holding);
  await blur();
  await page.waitForFunction(() => {
    const s = window.__tumblekinScene;
    return !s.holding && s.holdTimer === null && !s.update.arcade.players[s.getControlledPlayerId()].running;
  });
  console.log("✓ Lichtwächter: Blur beendet Lauf und Halte-Pings auf Gerät und Server");

  await backToLobby(page);
  await startSingle(page, "fassrolle");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  await pointer('[data-barrel-run="-1"]', "pointerdown", 11);
  await pointer('[data-barrel-run="1"]', "pointerdown", 22);
  assert.equal(await page.evaluate(() => window.__tumblekinScene.holdDir), 1);
  await pointer('[data-barrel-run="1"]', "pointerup", 22);
  assert.equal(await page.evaluate(() => window.__tumblekinScene.holdDir), -1);
  await blur();
  assert.deepEqual(await page.evaluate(() => {
    const s = window.__tumblekinScene;
    return { dir: s.holdDir, timer: s.holdTimer, pressed: s.controls.querySelectorAll(".is-holding").length };
  }), { dir: 0, timer: null, pressed: 0 });
  console.log("✓ Fassrolle: letzter gehaltener Knopf bestimmt Richtung, Blur beendet beide Hände");

  await backToLobby(page);
  await startSingle(page, "bounceArena");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  const box = await page.locator(".virtual-joystick").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height / 2);
  await page.waitForFunction(() => window.__tumblekinScene.joystick.vecX > 0);
  await blur();
  assert.deepEqual(await page.evaluate(() => {
    const j = window.__tumblekinScene.joystick;
    return { pointer: j.pointerId, x: j.vecX, y: j.vecY, timer: j.timer };
  }), { pointer: null, x: 0, y: 0, timer: null });
  await page.mouse.up();
  console.log("✓ Joystick: Blur setzt Richtung, Finger und Wiederholung zurück");
  assert.deepEqual(errors, []);
  assert.deepEqual(server.errorOutput, []);
} finally {
  await browser.close();
  server.stop();
}
