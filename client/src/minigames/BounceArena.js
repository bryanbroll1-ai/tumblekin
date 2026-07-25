import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  createCountdownSprite,
  updateCountdownSprite,
  setKinOpacity,
  noise
} from "./VoxelKit.js?v=tumblekin72";
import { mountStage, addStageLights, resizeStage, syncOwnMarker, teardownStage } from "./SceneKit.js?v=tumblekin72";
import { shakeScale } from "./Quality.js?v=tumblekin72";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin72";

const WORLD_SCALE = 2.03;
const PLATFORM_TOP_Y = 0.255;
const KIN_REST_Y = 0.55;
const WATER_Y = -2.1;

export class BounceArena {
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
    this.kins = new Map();
    this.animators = new Map();
    this.lastAlive = new Map();
    this.lastCollisions = new Map();
    this.splashed = new Set();
    this.joystick = null;
    this.bumpPulse = 0;
    this.shake = 0;
    this.countdownValue = null;
    this.lookTarget = new THREE.Vector3(0, 0.2, 0);
    this.lastFrameAt = performance.now();
    this.lastServerAt = performance.now();
    this.fxStamp = new Map();
    this.ownFxAt = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, {
      label: "3D Bumper Bloom Arena",
      canvasClass: "bounce-webgl",
      background: "#9fdcf2",
      fog: ["#aee2f5", 12, 26],
      fov: 44,
      far: 60
    });
    this.createScene();

    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>
    `;

    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Bumper Bloom lenken und rammen",
      intervalMs: 70,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "thrust", x, y }).catch(() => {}),
      onEngage: () => {
        this.feedback?.sound("move");
        this.feedback?.vibrate(10);
      }
    });
    this.loop();
  }

  handleUpdate(update) {
    const controlledId = this.getControlledPlayerId();
    const controlled = update.arena?.players?.[controlledId];
    const nowP = performance.now();
    // Throttled: rapid bump chains give one strong pulse, not a strobe.
    if ((controlled?.collisionCount || 0) > (this.lastCollisions.get(controlledId) || 0) && nowP - this.ownFxAt > 200) {
      this.ownFxAt = nowP;
      this.bumpPulse = 1;
      this.shake = Math.max(this.shake, 0.8);
      this.feedback?.sound("collision");
      this.feedback?.vibrate(18);
    }
    this.update = update;
    this.lastServerAt = nowP;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.joystick?.destroy();
    this.joystick = null;
    this.controls.innerHTML = "";
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    this.camera.position.set(0, 4.6, 5.6);
    this.renderer.toneMappingExposure = 1.0;

    addStageLights(this.scene, {
      sunPosition: [3.5, 7, 4.2],
      shadow: { left: -4, right: 4, top: 4, bottom: -4 },
      sunIntensity: 3.4,
      skyColor: 0xdfefff,
      groundColor: 0x7ab8c4,
      sunColor: 0xfff4d6
    });

    // Ocean far below — falling now actually goes somewhere.
    this.water = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.5, 30),
      new THREE.MeshLambertMaterial({ color: "#3cb0cf", transparent: true, opacity: 0.94 })
    );
    this.water.rotation.y = Math.PI / 4;
    this.water.position.y = WATER_Y - 0.25;
    this.scene.add(this.water);

    // Stone pedestal carrying the arena.
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.55, 1.9, 2.4, 8),
      new THREE.MeshLambertMaterial({ color: "#8a5a70" })
    );
    pedestal.position.y = -1.15;
    pedestal.castShadow = true;
    this.scene.add(pedestal);
    const pedestalTrim = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 1.75, 0.22, 8),
      new THREE.MeshLambertMaterial({ color: "#a06a88" })
    );
    pedestalTrim.position.y = -0.05;
    this.scene.add(pedestalTrim);

    // Candy platform: dirt base, bright cap, pulsing rim.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.42, 0.34, 8),
      new THREE.MeshLambertMaterial({ color: "#c487a3" })
    );
    base.position.y = 0.05;
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(base);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(2.16, 2.16, 0.09, 8),
      new THREE.MeshLambertMaterial({ color: "#b8ecff" })
    );
    cap.position.y = 0.21;
    cap.receiveShadow = true;
    this.scene.add(cap);

    this.rim = new THREE.Mesh(
      new THREE.TorusGeometry(2.13, 0.085, 4, 8),
      new THREE.MeshLambertMaterial({ color: "#ff4668", emissive: "#ff4668", emissiveIntensity: 0.8 })
    );
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.y = 0.27;
    this.scene.add(this.rim);

    [0.7, 1.35].forEach((radius, index) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.02, 4, 8),
        new THREE.MeshLambertMaterial({
          color: "#ffffff",
          transparent: true,
          opacity: index ? 0.35 : 0.5,
          emissive: "#ffffff",
          emissiveIntensity: 0.25
        })
      );
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = index * 0.4;
      ring.position.y = 0.26;
      this.scene.add(ring);
    });

    // Floating clouds + candy rocks around the arena.
    this.drifters = [];
    [[-4.2, 1.6, -2.4, 1], [4.4, 2.3, -1.2, 2], [-3.6, 2.8, 2.2, 3], [3.4, 1.2, 2.8, 4]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      cloud.userData = { baseY: y, phase: seed * 1.7, drift: 0.1 + noise(seed) * 0.1 };
      this.scene.add(cloud);
      this.drifters.push(cloud);
    });
    [[-3.2, -0.9, 1.6, "#8f82c4"], [3.1, -1.3, -1.9, "#c487a3"]].forEach(([x, y, z, color], index) => {
      const rock = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshLambertMaterial({ color }));
      rock.rotation.set(0.3, index * 0.8, 0.15);
      rock.position.set(x, y, z);
      rock.userData = { baseY: y, phase: index * 2.4, drift: 0.12 };
      this.scene.add(rock);
      this.drifters.push(rock);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);

    // Pool of flat shockwave rings that flash out from every hard bump.
    this.rings = [];
    for (let i = 0; i < 6; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.4, 0.06, 6, 20),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      ring.userData = { age: 0, life: 0.5 };
      this.scene.add(ring);
      this.rings.push(ring);
    }

    this.countdownSprite = createCountdownSprite();
    this.countdownSprite.position.set(0, 1.75, 0);
    this.countdownSprite.scale.set(1.7, 1.06, 1);
    this.scene.add(this.countdownSprite);

    const state = this.getState();
    state?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
  }

  spawnRing(x, z) {
    const ring = this.rings.find((candidate) => !candidate.visible);
    if (!ring) return;
    ring.position.set(x, PLATFORM_TOP_Y + 0.04, z);
    ring.scale.setScalar(0.3);
    ring.material.opacity = 0.85;
    ring.visible = true;
    ring.userData.age = 0;
  }

  updateRings(dt) {
    this.rings.forEach((ring) => {
      if (!ring.visible) return;
      ring.userData.age += dt;
      const t = ring.userData.age / ring.userData.life;
      if (t >= 1) { ring.visible = false; return; }
      ring.scale.setScalar(0.3 + t * 2.4);
      ring.material.opacity = 0.85 * (1 - t);
    });
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createVoxelKin(player.color, index);

    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);

    const shadow = createShadowBlob(0.56);
    this.scene.add(shadow);

    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.userData.target = new THREE.Vector3(0, KIN_REST_Y, 0);
    kin.userData.fallSpin = 0;
    kin.userData.wasInPlay = true;
    kin.userData.fallY = KIN_REST_Y;
    kin.position.set(0, KIN_REST_Y, 0);
    this.scene.add(kin);
    this.kins.set(player.id, kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_REST_Y;
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
    if (!minigame || !state || !this.renderer) return;
    this.resizeRenderer();

    const now = this.now();
    const frameNow = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (frameNow - this.lastFrameAt) / 1000));
    this.lastFrameAt = frameNow;
    const controlledId = this.getControlledPlayerId();

    state.players.forEach((player, index) => {
      const kin = this.ensureKin(player, index);
      const entry = minigame.arena?.players?.[player.id];
      if (!entry) return;
      const data = kin.userData;
      const invulnerable = entry.inPlay && now < entry.invulnUntil;

      // Transition edges: knocked off (fall) and respawn (pop).
      if (data.wasInPlay && !entry.inPlay) {
        data.fallY = KIN_REST_Y;
        data.fallSpin = 0;
        this.splashed.delete(player.id);
        this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.1, 0)), ["#ffffff", player.color], { count: 10, speed: 2.1, up: 2.2, size: 0.08, life: 0.6 });
        if (player.id === controlledId) {
          this.feedback?.sound("fall");
          this.feedback?.vibrate([35, 35, 48]);
        }
      }
      if (!data.wasInPlay && entry.inPlay) {
        kin.position.set(entry.x * WORLD_SCALE, KIN_REST_Y, entry.y * WORLD_SCALE);
        setKinOpacity(kin, 1);
        this.splashed.delete(player.id);
        this.bursts.spawn(new THREE.Vector3(entry.x * WORLD_SCALE, KIN_REST_Y, entry.y * WORLD_SCALE), ["#ffffff", player.color], { count: 8, speed: 1.4, up: 1.8, size: 0.07, life: 0.5 });
        if (player.id === controlledId) this.feedback?.sound("pop");
      }
      data.wasInPlay = entry.inPlay;

      // Collision juice for every player — but rate-limited per player so
      // grinding against someone doesn't spam rings, bursts and shakes.
      const animator = this.animators.get(player.id);
      const collisions = entry.collisionCount || 0;
      if (collisions > (this.lastCollisions.get(player.id) || 0)) {
        const stamp = this.fxStamp.get(player.id) || 0;
        if (frameNow - stamp > 240) {
          this.fxStamp.set(player.id, frameNow);
          this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.1, 0)), ["#ffffff", player.color], { count: 5, speed: 1.6, up: 1.6, size: 0.06, life: 0.45 });
          this.spawnRing(kin.position.x, kin.position.z);
          this.shake = Math.max(this.shake, 0.45);
          animator?.trigger("hit");
        }
      }
      this.lastCollisions.set(player.id, collisions);

      if (!entry.inPlay) {
        // Off the plate: tumble down toward the water, splash once, sink out.
        data.fallSpin += dt * 7;
        data.fallY = Math.max(WATER_Y - 1.4, data.fallY - dt * (1.6 + (KIN_REST_Y - data.fallY) * 0.9) - dt * 2.2);
        kin.position.set(entry.x * WORLD_SCALE, data.fallY, entry.y * WORLD_SCALE);
        data.body.rotation.x = data.fallSpin;
        if (!this.splashed.has(player.id) && kin.position.y < WATER_Y + 0.3) {
          this.splashed.add(player.id);
          this.bursts.spawn(new THREE.Vector3(kin.position.x, WATER_Y + 0.2, kin.position.z), ["#ffffff", "#7fdbe8"], { count: 18, speed: 2.5, up: 2.6, size: 0.09, life: 0.8, drag: 1.5 });
          this.bursts.ring(new THREE.Vector3(kin.position.x, WATER_Y + 0.25, kin.position.z), "#7fdbe8", { radius: 2, life: 0.6, y: WATER_Y + 0.25 });
          this.floaters.pop(new THREE.Vector3(kin.position.x, WATER_Y + 1, kin.position.z), "PLATSCH! 💦", { color: "#bfe9ff", size: 0.42, life: 1 });
          if (player.id === controlledId) this.feedback?.sound("land");
        }
        setKinOpacity(kin, Math.max(0, 1 - Math.max(0, WATER_Y + 0.3 - kin.position.y) * 1.4));
        data.shadow.visible = false;
        data.label.material.opacity = 0.25;
        return;
      }

      // On the plate: extrapolate the last server snapshot by its velocity and
      // the snapshot's age — the target then GLIDES between 90ms ticks instead
      // of stair-stepping at tick rate ("10fps feel"), and a time-based lerp
      // smooths the correction.
      const snapshotAge = Math.min(0.22, (frameNow - this.lastServerAt) / 1000);
      const lead = 0.05;
      data.target.set(
        (entry.x + (entry.vx || 0) * (snapshotAge + lead)) * WORLD_SCALE,
        KIN_REST_Y,
        (entry.y + (entry.vy || 0) * (snapshotAge + lead)) * WORLD_SCALE
      );
      kin.position.lerp(data.target, 1 - Math.pow(0.0004, dt));

      const speed = Math.hypot(entry.vx || 0, entry.vy || 0);
      if (speed > 0.05) {
        // Turn smoothly toward the travel direction instead of snapping.
        const targetRot = Math.atan2(entry.vx || 0, entry.vy || 0);
        const delta = Math.atan2(Math.sin(targetRot - kin.rotation.y), Math.cos(targetRot - kin.rotation.y));
        kin.rotation.y += delta * Math.min(1, dt * 14);
      }

      // Full animation state machine: sprint stride, breathing idle, hit
      // shock, and a victory dance during the finale.
      if (minigame.finaleAt && entry.inPlay) {
        animator?.set("cheer", { base: true });
        kin.rotation.y += dt * 5;
        if (!this.finaleCelebrated) {
          this.finaleCelebrated = true;
          this.bursts.spawn(kin.position.clone(), [player.color, "#ffffff", "#ffd15c"], { count: 28, speed: 3, up: 3.2, size: 0.1, life: 1, drag: 1.2 });
          this.bursts.ring(kin.position.clone().setY(PLATFORM_TOP_Y + 0.02), "#ffd15c", { radius: 2.2, life: 0.7, opacity: 0.6, y: PLATFORM_TOP_Y + 0.02 });
          this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "🏆", { size: 0.56, life: 1.3, rise: 1 });
          this.feedback?.sound("win");
          this.feedback?.vibrate([20, 24, 40]);
        }
      } else {
        animator?.set(speed > 0.3 ? "run" : "idle", { base: true });
      }
      animator?.update(now);
      // Extra lean into the direction of travel on top of the run cycle.
      data.body.rotation.x += Math.min(0.22, speed * 0.1);

      // Spawn grace: gently pulse translucent so it reads as "protected".
      const opacity = invulnerable ? 0.45 + Math.abs(Math.sin(now / 120)) * 0.4 : 1;
      setKinOpacity(kin, opacity);
      data.label.material.opacity = player.id === controlledId ? 1 : 0.85;

      data.shadow.visible = true;
      data.shadow.position.set(kin.position.x, PLATFORM_TOP_Y + 0.012, kin.position.z);
      const height = kin.position.y - KIN_REST_Y;
      data.shadow.scale.setScalar(Math.max(0.6, 1 - height * 1.5));
    });

    // Pulse pack: rim glow reacts to bumps and to anyone close to the edge.
    let edgeDanger = 0;
    state.players.forEach((player) => {
      const entry = minigame.arena?.players?.[player.id];
      if (!entry?.inPlay) return;
      edgeDanger = Math.max(edgeDanger, Math.min(1, Math.max(0, Math.hypot(entry.x, entry.y) - 0.62) / 0.4));
    });
    this.bumpPulse *= 0.85;
    this.shake *= 0.82;
    this.rim.material.emissiveIntensity = 0.55 + Math.sin(now / 190) * 0.2 + edgeDanger * 0.9 + this.bumpPulse * 1.4;

    const controlledKin = this.kins.get(controlledId);
    if (controlledKin) controlledKin.scale.setScalar(1 + this.bumpPulse * 0.14);

    this.drifters.forEach((drifter) => {
      const data = drifter.userData;
      drifter.position.y = data.baseY + Math.sin(now / 1400 + data.phase) * data.drift;
      drifter.position.x += Math.sin(now / 2600 + data.phase) * 0.0015;
    });
    this.water.position.y = WATER_Y - 0.25 + Math.sin(now / 900) * 0.04;

    this.bursts.update(dt);

    this.floaters.update(dt);
    this.updateRings(dt);

    // Camera: gentle follow of your kin plus a punchy impact shake.
    const followX = controlledKin && this.kins.size ? controlledKin.position.x * 0.22 : 0;
    const followZ = controlledKin ? controlledKin.position.z * 0.14 : 0;
    this.lookTarget.lerp(new THREE.Vector3(followX, 0.18, followZ), 0.06);
    const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
    const shakeY = Math.cos(now / 12) * this.shake * 0.12;
    this.camera.position.x = this.baseCamera.x + Math.sin(now / 3600) * 0.1 + shakeX;
    this.camera.position.y = this.baseCamera.y + shakeY;
    this.camera.lookAt(this.lookTarget);

    // The 3-2-1 countdown is shown once by the shared intro card, not here.
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    this.renderer.render(this.scene, this.camera);
  }

  updateCountdown(minigame, now) {
    const untilStart = minigame.startedAt - now;
    const afterStart = now - minigame.startedAt;
    const value = untilStart > 0 ? String(Math.ceil(untilStart / 1000)) : (afterStart < 480 ? "GO!" : "");
    if (value === this.countdownValue) return;
    this.countdownValue = value;
    this.countdownSprite.visible = Boolean(value);
    if (!value) return;
    updateCountdownSprite(this.countdownSprite, value, value === "GO!" ? "#43e38c" : "#ffe25c");
    this.countdownSprite.scale.set(value === "GO!" ? 2.1 : 1.7, value === "GO!" ? 1.31 : 1.06, 1);
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamera = portrait ? new THREE.Vector3(0, 5.0, 6.1) : new THREE.Vector3(0, 3.9, 5.8);
      camera.fov = portrait ? 47 : 43;
      camera.position.copy(this.baseCamera);
    }, { minHeight: 220 });
    if (!this.baseCamera) this.baseCamera = this.camera.position.clone();
  }
}
