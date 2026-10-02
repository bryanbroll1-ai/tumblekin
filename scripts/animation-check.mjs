// Gerüst und Posen im echten Three.js-Renderer: keine ungültigen Werte,
// kontrollierte Fußhöhe und dieselben Zustände bei drei Bildraten.
import assert from "node:assert/strict";
import { launchBrowser, startServer } from "./lib/harness.mjs";
const server = await startServer({ log: true });
const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`${server.base}/kin-lab.html?states=idle&t=0`);
  let variants = 0;
  let states = 0;
  for (const reducedMotion of ["no-preference", "reduce"]) {
    await page.emulateMedia({ reducedMotion });
    const results = await page.evaluate(async () => {
      const THREE = await import("/vendor/three/three.module.js");
      const { createKin, KinAnimator, KIN_STATES, standOn } = await import("/src/minigames/Kin.js?v=tumblekin207");
      const rows = [];
      const box = new THREE.Box3();
      for (const state of KIN_STATES) for (const hz of [30, 60, 120]) {
        const kin = createKin("#ff5d73", 0);
        const animator = new KinAnimator(kin);
        animator.phase = 0;
        animator.groundY = standOn(0);
        animator.update(0);
        animator.trigger(state);
        let minFeet = Infinity;
        let invalid = false;
        for (let frame = 0; frame <= hz * 2; frame += 1) {
          animator.update(1000 + frame * 1000 / hz);
          kin.updateMatrixWorld(true);
          kin.userData.legs.forEach((leg) => { minFeet = Math.min(minFeet, box.setFromObject(leg).min.y); });
          kin.traverse((object) => {
            if (![...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()].every(Number.isFinite)) invalid = true;
          });
        }
        rows.push({ state, hz, minFeet, invalid });
        kin.traverse((object) => object.geometry?.dispose());
        kin.userData.material.dispose();
      }
      return rows;
    });
    results.forEach((row) => {
      assert.equal(row.invalid, false, `${row.state} bei ${row.hz} Hz (${reducedMotion})`);
      assert.ok(row.minFeet >= -0.12, `${row.state}: Fuß steckt ${-row.minFeet} unter dem Boden`);
    });
    states = new Set(results.map((row) => row.state)).size;
    variants += results.length;
  }
  console.log(`✓ ${states} Animationszustände · ${variants} Varianten bei 30/60/120 Hz, mit und ohne reduzierte Bewegung`);
  const runner = await page.evaluate(async () => {
    const THREE = await import("/vendor/three/three.module.js");
    const { createKin, KinAnimator, standOn } = await import("/src/minigames/Kin.js?v=tumblekin207");
    const { RunnerDerby } = await import("/src/minigames/RunnerDerby.js?v=tumblekin207");
    const kin = createKin("#ff5d73", 0);
    const animator = new KinAnimator(kin);
    const host = { kins: new Map([["test", kin]]) };
    const box = new THREE.Box3();
    const sole = () => Math.min(...kin.userData.legs.map((leg) => box.setFromObject(leg).min.y));
    let before = Infinity;
    let after = Infinity;
    animator.groundY = standOn(0);
    for (const pose of ["run", "sprint", "tumble", "land"]) for (const tilt of [-0.4, 0, 0.4]) {
      kin.rotation.z = tilt;
      animator.trigger(pose);
      for (let frame = 0; frame < 120; frame += 1) {
        animator.update(animator.now * 1000 + 1000 / 60);
        kin.updateMatrixWorld(true);
        before = Math.min(before, sole());
        RunnerDerby.prototype.afterAnimate.call(host);
        kin.updateMatrixWorld(true);
        after = Math.min(after, sole());
      }
    }
    animator.groundY = standOn(0) + 1;
    animator.update(animator.now * 1000 + 1000 / 60);
    const jumpY = kin.position.y;
    RunnerDerby.prototype.afterAnimate.call(host);
    return { before, after, jumpShift: kin.position.y - jumpY };
  });
  assert.ok(runner.before < -0.001, "Gegenprobe enthält einen geneigten Schuh unter der Laufbahn");
  assert.ok(runner.after >= -1e-6, `Nach Korrektur: ${runner.after}`);
  assert.equal(runner.jumpShift, 0, "Eine Figur in der Luft darf nicht auf die Laufbahn gezogen werden");
  console.log("✓ Zielsprint: geneigte Schuhe bleiben über der Laufbahn, Sprunghöhe bleibt erhalten");
  assert.deepEqual(errors, []);
  assert.deepEqual(server.errorOutput, []);
} finally {
  await browser.close();
  server.stop();
}
