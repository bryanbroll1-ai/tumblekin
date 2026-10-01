// Prüft die neuen Hinweise im echten Renderer. Die Insel-Uhr wird auf die
// Server-Zeitpunkte gesetzt, damit Vorwarnung und Ende ohne Warten prüfbar sind.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { backToLobby, launchBrowser, openRoom, startServer, startSingle, watchErrors } from "./lib/harness.mjs";

const server = await startServer({ log: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = watchErrors(page);
const shots = process.env.TUMBLEKIN_SCREENSHOTS;
if (shots) await mkdir(shots, { recursive: true });
const snapshot = async (name) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  await openRoom(page, server.base, { name: "Feedback" });
  await startSingle(page, "bounceArena");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  await page.evaluate(() => {
    const scene = window.__tumblekinScene;
    scene.handleUpdate = () => {};
    scene.now = () => window.__cueNow;
    window.__cueNow = scene.update.arena.shrinkFrom - 4500;
    window.__cueSounds = 0;
    scene.feedback = { sound: (name) => { if (name === "countdown") window.__cueSounds += 1; }, vibrate: () => {} };
  });
  await frames();
  const warning = page.locator("[data-arena-shrink]");
  assert.ok(await warning.isVisible());
  assert.match(await warning.textContent(), /in 5 s/);
  await snapshot("bumper-vorwarnung");
  await frames();
  assert.equal(await page.evaluate(() => window.__cueSounds), 1);
  await page.evaluate(() => { window.__cueNow = window.__tumblekinScene.update.arena.shrinkFrom + 100; });
  await frames();
  assert.equal(await warning.getAttribute("data-phase"), "active");
  assert.match(await warning.textContent(), /zur Mitte/);
  assert.equal(await page.evaluate(() => window.__cueSounds), 2);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(700);
  await snapshot("bumper-querformat");
  const box = await warning.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 844 && box.y >= 0 && box.y + box.height <= 390);
  const scorebar = await page.locator(".kinetic-scorebar").boundingBox();
  assert.ok(box.x >= scorebar.x + scorebar.width && box.y < 50, "Die Warnung bleibt neben dem Stand und über dem Spielfeld");
  await page.evaluate(() => { window.__cueNow = window.__tumblekinScene.update.arena.shrinkUntil; });
  await frames();
  assert.equal(await warning.isVisible(), false);
  console.log("✓ Insel-Vorwarnung, aktive Warnung, einmaliger Ton und Ende des Hinweises");

  await backToLobby(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await startSingle(page, "bounceArena");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  await page.evaluate(() => {
    const scene = window.__tumblekinScene;
    scene.handleUpdate = () => {};
    scene.pulse = 0;
    window.__cueNow = scene.update.arena.shrinkFrom - 4500;
    scene.now = () => window.__cueNow;
  });
  await frames();
  const glow = await page.evaluate(() => window.__tumblekinScene.rim.material.emissiveIntensity);
  await page.evaluate(() => { window.__cueNow += 700; });
  await frames();
  assert.equal(await page.evaluate(() => window.__tumblekinScene.rim.material.emissiveIntensity), glow);
  console.log("✓ Bei reduzierter Bewegung leuchtet der Inselrand ohne Pulsieren");

  await backToLobby(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await startSingle(page, "ballonfahrt");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  const landed = await page.evaluate(async () => {
    const THREE = await import("/vendor/three/three.module.js");
    const id = window.__tumblekin.state().players.find((p) => p.isHost).id;
    // Observe in the same task as the press. A slow automation round trip can
    // otherwise miss the sack's entire 1.2-second lifetime after landing.
    const button = document.querySelector("[data-glide-drop]");
    button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 11, bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointerup", { pointerId: 11, bubbles: true }));
    const until = performance.now() + 6000;
    while (performance.now() < until) {
      await new Promise(requestAnimationFrame);
      const pair = [...window.__tumblekinScene.bagMeshes].find(([key, mesh]) => key.startsWith(id + ":") && mesh.userData.landed);
      if (!pair) continue;
      const [key, mesh] = pair;
      return { key, bottom: new THREE.Box3().setFromObject(mesh).min.y, volume: mesh.scale.x * mesh.scale.y * mesh.scale.z };
    }
    throw new Error("Der abgeworfene Sack ist nicht gelandet");
  });
  assert.ok(landed.bottom >= -0.005, "Der gelandete Sack darf nicht im Feld stecken");
  assert.ok(Math.abs(landed.volume - 1) < 1e-9);
  await page.waitForFunction((key) => !window.__tumblekinScene.bagMeshes.has(key), landed.key, { timeout: 4000 });
  await page.evaluate(() => {
    const scene = window.__tumblekinScene;
    scene.handleUpdate = () => {};
    const own = scene.update.arcade.players[scene.getControlledPlayerId()];
    own.y = 0.1;
    own.bagsLeft = 1;
  });
  await frames();
  const low = await page.evaluate(() => window.__tumblekinScene.aimRing.scale.x);
  assert.ok(await page.evaluate(() => window.__tumblekinScene.aimRing.visible));
  await snapshot("ballon-landering-tief");
  await page.evaluate(() => {
    const scene = window.__tumblekinScene;
    scene.update.arcade.players[scene.getControlledPlayerId()].y = 0.9;
  });
  await frames();
  const high = await page.evaluate(() => window.__tumblekinScene.aimRing.scale.x);
  assert.ok(high > low * 2, "Große Flughöhe behält den breiteren Landebereich");
  await snapshot("ballon-landering-hoch");
  await page.evaluate(() => {
    const scene = window.__tumblekinScene;
    scene.update.arcade.players[scene.getControlledPlayerId()].bagsLeft = 0;
  });
  await frames();
  assert.equal(await page.evaluate(() => window.__tumblekinScene.aimRing.visible), false);
  console.log("✓ Sack landet über dem Feld, federt ohne Volumenverlust und wird entfernt; Ring wächst mit der Höhe");

  // Eine isolierte Figur: alle Bilder der Landung prüfen, einschließlich der
  // eigentlichen Fußhöhe. Hier hängt das Ergebnis nicht vom Bot-Verhalten ab.
  const measureLanding = () => page.evaluate(async () => {
    const THREE = await import("/vendor/three/three.module.js");
    const { createKin, KinAnimator, standOn } = await import("/src/minigames/Kin.js?v=tumblekin202");
    const kin = createKin("#ff5d73", 0);
    const animator = new KinAnimator(kin);
    animator.groundY = standOn(0);
    // Gleiche Ausgangspose für beide Einstellungen: die zufällige Atemphase
    // würde sonst beim Überblenden als Nachfedern der Landung mitgemessen.
    animator.phase = 0;
    animator.set("idle");
    animator.update(0);
    animator.trigger("land");
    const scales = [];
    let bottom = Infinity;
    for (let ms = 0; ms <= 350; ms += 5) {
      animator.update(1000 + ms);
      kin.updateMatrixWorld(true);
      bottom = Math.min(bottom, new THREE.Box3().setFromObject(kin).min.y);
      if (animator.state === "land") scales.push(animator.out.sq);
    }
    return { bottom, low: Math.min(...scales), high: Math.max(...scales), reduced: animator.reduced };
  });
  const landing = await measureLanding();
  assert.ok(landing.bottom >= -0.015, `Figur steckt bei Landung im Boden: ${landing.bottom}`);
  assert.ok(landing.low <= 0.82 && landing.high > 1 && landing.high <= 1.04);
  console.log("✓ Figur federt früh ein, leicht nach und bleibt über dem Boden");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await frames();
  const quietLanding = await measureLanding();
  assert.equal(quietLanding.reduced, true);
  assert.ok(quietLanding.low > landing.low && quietLanding.high <= 1,
    `Reduzierte Bewegung dämpft den Aufprall ohne Nachfedern: ${JSON.stringify(quietLanding)}`);
  assert.ok(quietLanding.bottom >= -0.015);
  console.log("✓ Reduzierte Bewegung dämpft die Landung ohne Nachfedern");

  await backToLobby(page);
  await startSingle(page, "finishRush");
  await page.waitForSelector("#minigame-intro", { state: "hidden" });
  await page.evaluate(() => {
    const scene = window.__tumblekinScene;
    scene.handleUpdate = () => {};
    window.__runnerNow = scene.now();
    scene.now = () => window.__runnerNow;
  });
  for (const remaining of [750, 651, 650, 325, 1, 0]) {
    await page.evaluate((remaining) => {
      const scene = window.__tumblekinScene;
      const own = scene.update.arcade.players[scene.getControlledPlayerId()];
      own.jumpUntil = window.__runnerNow + remaining;
      own.finishedAt = null;
    }, remaining);
    await frames();
    const finite = await page.evaluate(() => {
      const scene = window.__tumblekinScene;
      const id = scene.getControlledPlayerId();
      return Number.isFinite(scene.animators.get(id).groundY)
        && scene.kins.get(id).position.toArray().every(Number.isFinite);
    });
    assert.ok(finite, `Läufer bleibt sichtbar, auch wenn das Server-Update der Uhr voraus ist (${remaining} ms)`);
  }
  console.log("✓ Sprungbogen bleibt bei vorauslaufender Server-Zeit endlich");
  assert.deepEqual(errors, []);
  assert.deepEqual(server.errorOutput, []);
} finally {
  await browser.close();
  server.stop();
}
