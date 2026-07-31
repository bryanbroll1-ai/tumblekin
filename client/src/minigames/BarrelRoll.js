import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  setKinOpacity
} from "./VoxelKit.js?v=tumblekin85";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin85";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin85";

// Fassrolle — everyone stands on one giant rolling barrel above the water.
// The barrel spins faster and keeps flipping direction; hold ◀ or ▶ to run
// against it. Slide too far around the curve and you splash off.
const BARREL_R = 2.1;
const BARREL_CENTER_Y = 1.1;
const RUN_PING_MS = 90;
const WATER_Y = -1.15;

export class BarrelRoll {
  constructor({ canvas, controls, sendInput, now, getState, getControlledPlayerId, myPlayerId, feedback }) {
    this.canvas = canvas;
    this.controls = controls;
    this.sendInput = sendInput;
    this.now = now;
    this.getState = getState;
    this.getControlledPlayerId = getControlledPlayerId || (() => myPlayerId);
    this.feedback = feedback;
    this.minigame = null;
    this.update = null;
    this.frame = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.webglCanvas = null;
    this.hud = null;
    this.kins = new Map();
    this.animators = new Map();
    this.smoothOffset = new Map();
    this.lastFallen = new Map();
    this.lastFrameAt = performance.now();
    this.lastServerAt = performance.now();
    this.shake = 0;
    this.holdDir = 0;
    this.holdTimer = null;
    this.localAngle = 0;
    this.finaleDone = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Fassrolle", background: "#8fd8f2", fog: ["#9fdef5", 16, 40], fov: 50 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0s</strong></div>
      <div class="color-banner" data-barrel-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <div class="runner-lane-controls">
        <button type="button" data-barrel-run="-1" aria-label="Nach links laufen">◀</button>
        <button type="button" data-barrel-run="1" aria-label="Nach rechts laufen">▶</button>
      </div>
    `;
    this.controls.querySelectorAll("[data-barrel-run]").forEach((button) => {
      const dir = Number(button.dataset.barrelRun);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        this.setHold(dir);
        button.classList.add("is-holding");
      });
      const release = () => {
        button.classList.remove("is-holding");
        if (this.holdDir === dir) this.setHold(0);
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    });
    this.loop();
  }

  setHold(dir) {
    this.holdDir = dir;
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    if (dir !== 0) {
      this.feedback?.vibrate(8);
      this.sendRun();
      this.holdTimer = setInterval(() => this.sendRun(), RUN_PING_MS);
    }
  }

  sendRun() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.fallenAt || this.holdDir === 0) {
      this.setHold(0);
      return;
    }
    this.sendInput({ action: "run", dir: this.holdDir }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
    this.lastServerAt = performance.now();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    this.controls.innerHTML = "";
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-5, 11, 7],
      hemiIntensity: 2.4,
      sunIntensity: 2.9,
      skyColor: 0xe6f6ff,
      groundColor: 0x5aa8c8
    });

    // River water below the barrel.
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.5, 30),
      new THREE.MeshLambertMaterial({ color: "#1f8fd6" })
    );
    water.position.y = WATER_Y - 0.25;
    water.receiveShadow = true;
    this.scene.add(water);
    this.waterMesh = water;
    // Banks left and right.
    [[-13, "#7fce6f"], [13, "#7fce6f"]].forEach(([x, color]) => {
      const bank = new THREE.Mesh(
        new THREE.BoxGeometry(14, 1.6, 30),
        new THREE.MeshLambertMaterial({ color })
      );
      bank.position.set(x, WATER_Y + 0.3, 0);
      this.scene.add(bank);
    });

    // The giant barrel: horizontal cylinder with wood stripes, seen from
    // slightly above so the curve and all four runners stay readable.
    this.barrel = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: "#b07a3e" });
    const stripeMat = new THREE.MeshLambertMaterial({ color: "#8a5a2c" });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R, BARREL_R, 3.4, 12), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.barrel.add(body);
    // Plank stripes around the curve so the spin is clearly visible.
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 3.46), i % 2 === 0 ? stripeMat : bodyMat);
      plank.position.set(Math.sin(angle) * (BARREL_R + 0.02), Math.cos(angle) * (BARREL_R + 0.02), 0);
      plank.rotation.z = -angle;
      this.barrel.add(plank);
    }
    // Dark end lids so the barrel face reads as a barrel, not a wall.
    [-1.74, 1.74].forEach((z) => {
      const lid = new THREE.Mesh(
        new THREE.CylinderGeometry(BARREL_R - 0.12, BARREL_R - 0.12, 0.1, 12),
        new THREE.MeshLambertMaterial({ color: "#6e4522" })
      );
      lid.rotation.x = Math.PI / 2;
      lid.position.z = z;
      this.barrel.add(lid);
      const hub = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.16),
        new THREE.MeshLambertMaterial({ color: "#546a86" })
      );
      hub.position.z = z;
      this.barrel.add(hub);
    });
    // Smooth metal rings near the ends.
    [-1.55, 1.55].forEach((z) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(BARREL_R + 0.05, 0.06, 6, 14),
        new THREE.MeshLambertMaterial({ color: "#546a86" })
      );
      ring.position.z = z;
      this.barrel.add(ring);
    });
    this.barrel.position.set(0, BARREL_CENTER_Y, 0);
    this.scene.add(this.barrel);

    // Danger edges: bright striped rails at the exact world angle where a
    // Kin slides off, so you can see how much room you have left.
    const limitAngle = 1.35 / BARREL_R; // matches server BARREL_LIMIT / radius
    this.edgeMarkers = [];
    [-1, 1].forEach((sign) => {
      const angle = sign * limitAngle;
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 3.5),
        new THREE.MeshLambertMaterial({ color: "#ff2038", emissive: "#ff2038", emissiveIntensity: 0.9 })
      );
      rail.position.set(Math.sin(angle) * (BARREL_R + 0.12), BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.12), 0);
      rail.rotation.z = -angle;
      this.scene.add(rail);
      this.edgeMarkers.push(rail);
      // Warning chevrons just outside, over the water.
      const arrow = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.12, 0.5),
        new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ffb400", emissiveIntensity: 0.5 })
      );
      arrow.position.set(Math.sin(angle) * (BARREL_R + 0.7), BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.7) - 0.3, 0);
      this.scene.add(arrow);
    });

    [[-7, 5.4, -6, 5], [7, 6.2, -4, 6], [0, 6.8, -9, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    // Three-quarter view: raised and offset sideways so all four runners on
    // the barrel stay visible instead of hiding behind each other.
    this.camera.position.set(this.baseCamX || 3.4, this.baseCamY || 5, this.baseCamZ || 8.2);
    this.camera.lookAt(0, 1.9, 0);
  }

  laneZ(index) {
    return (index - 1.5) * 0.8;
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.45);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.position.set(0, BARREL_CENTER_Y + BARREL_R + 0.32, this.laneZ(index));
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = kin.position.y;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);
    return kin;
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    const arcade = minigame?.arcade;
    if (!minigame || !state || !arcade || !this.renderer) return;
    this.resizeRenderer();

    const now = this.now();
    const frameNow = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (frameNow - this.lastFrameAt) / 1000));
    this.lastFrameAt = frameNow;
    const controlledId = this.getControlledPlayerId();

    // Spin the barrel: extrapolate the server angle with the current speed so
    // the roll stays smooth between ticks.
    const snapshotAge = Math.min(0.25, (frameNow - this.lastServerAt) / 1000);
    const targetAngle = (arcade.barrelAngle || 0) + (arcade.barrelVel || 0) * snapshotAge;
    this.localAngle += (targetAngle - this.localAngle) * Math.min(1, dt * 10);
    this.barrel.rotation.z = -this.localAngle / BARREL_R * 1.0;

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const fallen = Boolean(entry.fallenAt);

      // Smooth the arc offset, then place the Kin on the barrel's curve.
      const shown = THREE.MathUtils.lerp(
        this.smoothOffset.get(player.id) ?? 0,
        entry.offset || 0,
        Math.min(1, dt * 9)
      );
      this.smoothOffset.set(player.id, shown);
      const angle = shown / BARREL_R;

      if (fallen && !this.lastFallen.get(player.id)) {
        this.lastFallen.set(player.id, true);
        animator.trigger("fall");
        kin.userData.fellAt = now;
        this.bursts.spawn(kin.position.clone(), ["#1f8fd6", "#bfe9ff", player.color], { count: 18, speed: 2.5, up: 2, size: 0.09, life: 0.8, drag: 1.5 });
        this.bursts.ring(kin.position.clone().setY(0.08), "#bfe9ff", { radius: 1.8, life: 0.55 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "PLATSCH! 💦", { color: "#8fd8f2", size: 0.42, life: 1 });
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 0.9);
          this.feedback?.sound("fall");
          this.feedback?.vibrate([28, 20, 36]);
          this.setHold(0);
        } else {
          this.feedback?.sound("land");
        }
      }

      if (fallen) {
        // Slide down the curve and sink into the river.
        const since = (now - (kin.userData.fellAt || now)) / 1000;
        const fallAngle = Math.sign(shown || 1) * Math.min(2.2, Math.abs(angle) + since * 2.4);
        kin.position.x = Math.sin(fallAngle) * (BARREL_R + 0.35);
        animator.groundY = Math.max(WATER_Y - 0.9, BARREL_CENTER_Y + Math.cos(fallAngle) * (BARREL_R + 0.32) - since * 2.2);
        const depth = Math.max(0, WATER_Y + 0.4 - animator.groundY);
        setKinOpacity(kin, Math.max(0, 1 - depth * 1.4));
        kin.visible = animator.groundY > WATER_Y - 0.85;
        kin.userData.label.material.opacity = 0;
        kin.userData.shadow.visible = false;
        animator.update(now);
        return;
      }

      kin.visible = true;
      setKinOpacity(kin, 1);
      kin.position.x = Math.sin(angle) * BARREL_R;
      kin.position.z = this.laneZ(index);
      animator.groundY = BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.32);
      kin.rotation.z = -angle;
      // Face sideways in run direction while counter-running.
      const holding = now - (entry.lastRunAt || 0) <= 260;
      if (minigame.finaleAt) {
        // Reaktion nach Platzierung statt Jubel für alle: der Server schickt die
        // Plätze mit, sobald das Finale beginnt.
        const pose = applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
        if (pose.cheer && !this.finaleDone) {
          this.finaleDone = true;
          this.bursts.spawn(kin.position.clone(), [player.color, "#ffd15c", "#ffffff"], { count: 24, speed: 2.8, up: 3, size: 0.1, life: 0.95, drag: 1.2 });
          this.bursts.ring(kin.position.clone().setY(0.08), "#ffd15c", { radius: 2, life: 0.65, opacity: 0.6 });
          this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "🏆", { size: 0.56, life: 1.2, rise: 1 });
          if (player.id === controlledId) this.feedback?.sound("win");
        }
      } else {
        animator.set(holding ? "run" : "idle", { base: true });
        kin.rotation.y = holding ? (entry.runDir < 0 ? -1 : 1) * Math.PI / 2 : 0;
      }
      animator.update(now);
      kin.userData.shadow.visible = true;
      kin.userData.shadow.position.set(kin.position.x, BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.02) + 0.03, kin.position.z);
      kin.userData.shadow.rotation.z = -angle;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);

    this.floaters.update(dt);
    this.waterMesh.position.y = WATER_Y - 0.25 + Math.sin(now / 900) * 0.05;

    this.shake *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 16) * this.shake * 0.24 * shakeScale();
    const shakeY = Math.cos(now / 13) * this.shake * 0.18;
    const desired = new THREE.Vector3((this.baseCamX || 3.4) + shakeX, (this.baseCamY || 5) + shakeY, this.baseCamZ || 8.2);
    this.camera.position.lerp(desired, frameLerp(0.1, dt));
    this.camera.lookAt(0, 1.9, 0);

    this.updateHud(minigame, arcade, state, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    const survived = own?.fallenAt ? own.survivedMs : Math.max(0, now - minigame.startedAt);
    this.hud.querySelector("[data-kinetic-score]").textContent = `${Math.floor((survived || 0) / 1000)}s`;

    const banner = this.hud.querySelector("[data-barrel-banner]");
    if (banner) {
      if (own?.fallenAt) {
        banner.hidden = false;
        banner.textContent = "Ins Wasser gerollt!";
        banner.style.background = "#1f8fd6";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamX = portrait ? 3.6 : 3.4;
      this.baseCamY = portrait ? 5.2 : 5;
      this.baseCamZ = portrait ? 9.4 : 8.2;
      camera.fov = portrait ? 54 : 48;
    });
  }
}
