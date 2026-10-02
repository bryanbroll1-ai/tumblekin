// Real two-finger controls, authoritative jump, camera and isolated practice.
import assert from 'node:assert/strict';
import { launchBrowser, startServer, openRoom, startSingle, request, watchErrors } from './lib/harness.mjs';
const server = await startServer({ log: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
});
const errors = watchErrors(page);
const own = () => page.evaluate(() => {
  const s = window.__tumblekinScene; return s.update.arcade.players[s.getControlledPlayerId()];
});
const pointer = (selector, type, id) => page.dispatchEvent(selector, type, { pointerId: id, pointerType: 'touch', button: 0, bubbles: true });
const hold = '[data-sprint-hold]', jump = '[data-sprint-jump]';
try {
  await openRoom(page, server.base, { name: 'Sprinttest' });
  await startSingle(page, 'finishRush');
  await page.waitForSelector('#minigame-intro', { state: 'hidden' });
  await page.waitForFunction(() => { const s = window.__tumblekinScene; return s?.now() >= s?.minigame.startedAt; });
  await pointer(hold, 'pointerdown', 11);
  await page.waitForFunction(() => window.__tumblekinScene.ownEntry().sprinting);
  assert.ok(await page.locator(hold).evaluate(el => el.classList.contains('is-pressed')));
  await page.waitForTimeout(300);
  const before = await own(); assert.ok(before.energy < 100);
  await pointer(jump, 'pointerdown', 22);
  await pointer('body', 'pointerup', 22);
  await page.waitForFunction(() => window.__tumblekinScene.ownEntry().jumps > 0);
  assert.equal((await own()).holding, true, 'Releasing jump must not release held sprint');
  await page.waitForFunction(() => { const s = window.__tumblekinScene; return s.kins.get(s.getControlledPlayerId()).userData.sprintHeight > .08; });
  const feet = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.js');
    const s = window.__tumblekinScene, id = s.getControlledPlayerId(), kin = s.kins.get(id);
    kin.updateMatrixWorld(true); const box = new THREE.Box3();
    return { height: kin.userData.sprintHeight, sole: Math.min(...kin.userData.legs.map(leg => box.setFromObject(leg).min.y)) };
  });
  assert.ok(Math.abs(feet.height - feet.sole) < .002, 'Visible soles follow the same parabola as collisions');
  await pointer('body', 'pointerup', 11);
  await page.waitForFunction(() => !window.__tumblekinScene.ownEntry().holding);
  console.log('✓ Sprint costs energy, two fingers act independently, jump soles match rules, release reaches server');
  await page.waitForFunction(() => !document.querySelector('[data-sprint-jump]').disabled);
  await page.locator(hold).focus();
  await page.keyboard.down('Enter');
  await page.waitForFunction(() => window.__tumblekinScene.ownEntry().holding);
  await page.keyboard.up('Enter');
  await page.waitForFunction(() => !window.__tumblekinScene.ownEntry().holding);
  await pointer(hold, 'pointerdown', 31);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForFunction(() => !window.__tumblekinScene.ownEntry().holding);
  await pointer(hold, 'pointerdown', 41);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => !window.__tumblekinScene.ownEntry().holding);
  console.log('✓ Keyboard hold and release work; blur and orientation change release the finger');
  await page.waitForTimeout(700);
  const framing = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.js');
    const s = window.__tumblekinScene, id = s.getControlledPlayerId(), kin = s.kins.get(id);
    const r = s.webglCanvas.getBoundingClientRect(), v = kin.getWorldPosition(new THREE.Vector3()).project(s.camera);
    const y = r.top + (1 - v.y) * r.height / 2;
    return { y, bottom: document.querySelector('.sprint-controls').getBoundingClientRect().top, top: document.querySelector('.sprint-vitals').getBoundingClientRect().bottom };
  });
  assert.ok(framing.y > framing.top && framing.y < framing.bottom, JSON.stringify(framing));
  console.log('✓ Own runner remains between energy HUD and controls in landscape');

  // A real start waits for the second human, leaving room scores inspectable.
  await request(page, 'restartGame');
  await page.waitForSelector('#screen-lobby.active');
  const bots = await page.evaluate(() => window.__tumblekin.state().players.filter(p => p.isBot).map(p => p.id));
  for (const playerId of bots) await request(page, 'removeBot', { playerId });
  const code = await page.evaluate(() => window.__tumblekin.state().code);
  const second = await browser.newPage();
  await second.goto(`${server.base}/?dev=1`);
  await second.waitForFunction(() => window.__tumblekin?.request);
  await second.fill('#player-name', 'Wartend'); await second.fill('#room-code', code); await second.click('#join-room');
  await second.waitForSelector('#screen-lobby.active');
  await request(page, 'selectMode', { mode: 'single' });
  await request(page, 'updateSettings', { settings: { single: 'finishRush' } });
  await request(page, 'startGame');
  await page.waitForSelector('#intro-practice:not([hidden])');
  await page.click('#intro-practice');
  await page.waitForSelector('.practice-layer [data-sprint-hold]');
  await page.waitForFunction(() => !document.querySelector('.practice-layer [data-sprint-jump]').disabled);
  const courseAligned = await page.evaluate(() => {
    const s = window.__tumblekin.ui.practice.scene;
    return s.update.arcade.hurdles.every(h => Math.abs(s.hurdles.get(`practice:${h.index}`).position.z + h.at * .62) < 1e-8);
  });
  assert.ok(courseAligned, 'Practice construction and countdown use the same actual course');
  await page.locator('.practice-layer [data-sprint-hold]').focus();
  await page.keyboard.down('Enter');
  await page.waitForFunction(() => window.__tumblekin.ui.practice.scene.ownEntry().holding);
  await page.keyboard.up('Enter');
  await page.waitForFunction(() => !window.__tumblekin.ui.practice.scene.ownEntry().holding);
  await pointer('.practice-layer [data-sprint-jump]', 'pointerdown', 51);
  await pointer('body', 'pointerup', 51);
  await page.waitForFunction(() => window.__tumblekin.ui.practice.scene.ownEntry().jumps > 0);
  const practice = await page.evaluate(() => ({
    jumps: window.__tumblekin.ui.practice.scene.ownEntry().jumps,
    roomScores: window.__tumblekin.state().currentMinigame.scores,
    phase: window.__tumblekin.state().phase
  }));
  assert.equal(practice.phase, 'waitingReady'); assert.ok(Object.values(practice.roomScores).every(v => v === 0));
  await page.click('[data-practice-retry]');
  await page.waitForFunction(() => window.__tumblekin.ui.practice.scene?.ownEntry()?.jumps === 0);
  await page.click('[data-practice-close]');
  await page.waitForSelector('.practice-layer', { state: 'detached' });
  console.log('✓ Practice uses real sprint/jump rules and keyboard, retry resets, party has not started or scored');
  await second.close();
  assert.deepEqual(errors, []); assert.deepEqual(server.errorOutput, []);
} finally { await browser.close(); server.stop(); }
