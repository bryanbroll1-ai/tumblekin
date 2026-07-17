import * as THREE from "/vendor/three/three.module.js";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin36";
import {
  CubeBurst,
  createCloud,
  createCountdownSprite,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  disposeScene,
  noise,
  setKinOpacity,
  updateCountdownSprite
} from "./VoxelKit.js?v=tumblekin36";

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
    this.lastAlive = new Map();
    this.lastCollisions = new Map();
    this.splashed = new Set();
    this.joystick = null;
    this.bumpPulse = 0;
    this.shake = 0;
    this.countdownValue = null;
    this.lookTarget = new THREE.Vector3(0, 0.2, 0);
    this.lastFrameAt = performance.now();
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.canvas.hidden = true;
    this.webglCanvas = document.createElement("canvas");
    this.webglCanvas.className = `${this.canvas.className} bounce-webgl`;
    this.webglCanvas.setAttribute("aria-label", "3D Bumper Bloom Arena");
    this.canvas.insertAdjacentElement("afterend", this.webglCanvas);
    this.createScene();

    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>
    `;

    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Bumper Bloom bewegen und rammen",
      intervalMs: 92,
      feedback: this.feedback,
      onDirection: (action) => this.sendInput({ action }).catch(() => {}),
      onEngage: () => {
        this.bumpPulse = 1;
        this.feedback?.sound("impact");
        this.feedback?.vibrate([14, 18, 36]);
        this.sendInput({ action: "bump" }).catch(() => {});
      }
    });
    this.loop();
  }

  handleUpdate(update) {
    const controlled = update.arena?.players?.[this.getControlledPlayerId()];
    if ((controlled?.collisionCount || 0) > (this.lastCollisions.get(this.getControlledPlayerId()) || 0)) {
      this.bumpPulse = 1;
      this.shake = 1;
      this.feedback?.sound("collision");
      this.feedback?.vibrate(18);
    }
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.joystick?.destroy();
    this.joystick = null;
    this.controls.innerHTML = "";
    this.canvas.hidden = false;
    this.bursts?.dispose();
    if (this.scene) disposeScene(this.scene);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.webglCanvas?.remove();
    this.webglCanvas = null;
    this.renderer = null;
    this.scene = null;
    this.kins.clear();
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#9fdcf2");
    this.scene.fog = new THREE.Fog("#aee2f5", 12, 26);

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.1, 60);
    this.camera.position.set(0, 4.6, 5.6);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.webglCanvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x7ab8c4, 2.3));
    const sun = new THREE.DirectionalLight(0xfff4d6, 3.4);
    sun.position.set(3.5, 7, 4.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -4;
    sun.shadow.camera.right = 4;
    sun.shadow.camera.top = 4;
    sun.shadow.camera.bottom = -4;
    this.scene.add(sun);

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

    this.countdownSprite = createCountdownSprite();
    this.countdownSprite.position.set(0, 1.75, 0);
    this.countdownSprite.scale.set(1.7, 1.06, 1);
    this.scene.add(this.countdownSprite);

    const state = this.getState();
    state?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
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
    kin.position.set(0, KIN_REST_Y, 0);
    this.scene.add(kin);
    this.kins.set(player.id, kin);
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

      // Sounds + burst on knock-out of the controlled player.
      const wasAlive = this.lastAlive.get(player.id);
      if (wasAlive === true && entry.alive === false && player.id === controlledId) {
        this.feedback?.sound("fall");
        this.feedback?.vibrate([35, 35, 48]);
      }
      this.lastAlive.set(player.id, entry.alive);

      // Collision juice for every player, not just your own.
      const collisions = entry.collisionCount || 0;
      if (collisions > (this.lastCollisions.get(player.id) || 0)) {
        this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.1, 0)), ["#ffffff", player.color], { count: 7, speed: 1.6, up: 1.6, size: 0.06, life: 0.5 });
      }
      this.lastCollisions.set(player.id, collisions);

      const outAge = entry.outAt ? Math.max(0, now - entry.outAt) : 0;
      data.target.set(
        entry.x * WORLD_SCALE,
        entry.alive ? KIN_REST_Y : Math.max(WATER_Y - 1.2, KIN_REST_Y - (outAge / 1000) * (outAge / 1000) * 8),
        entry.y * WORLD_SCALE
      );
      kin.position.lerp(data.target, entry.alive ? 0.42 : 0.2);

      if (!entry.alive) {
        // Tumble, splash once, then sink away.
        data.fallSpin += dt * 7;
        data.body.rotation.x = data.fallSpin;
        if (!this.splashed.has(player.id) && kin.position.y < WATER_Y + 0.3) {
          this.splashed.add(player.id);
          this.bursts.spawn(new THREE.Vector3(kin.position.x, WATER_Y + 0.2, kin.position.z), ["#ffffff", "#7fdbe8"], { count: 14, speed: 2.4, up: 2.6, size: 0.09, life: 0.8 });
          if (player.id === controlledId) this.feedback?.sound("land");
        }
        setKinOpacity(kin, Math.max(0, 1 - Math.max(0, WATER_Y + 0.3 - kin.position.y) * 1.4));
        data.shadow.visible = false;
        data.label.material.opacity = Math.max(0, 0.9 - outAge / 900);
      } else {
        // Juicy locomotion: squash by speed, lean into the direction of travel.
        const speed = Math.hypot(entry.vx || 0, entry.vy || 0);
        const stretch = Math.min(0.16, speed * 0.07);
        data.body.scale.set(1 + stretch, 1 - stretch * 0.7, 1 + stretch * 0.4);
        data.body.rotation.x = Math.min(0.3, speed * 0.14);
        kin.rotation.y = speed > 0.05 ? Math.atan2(entry.vx || 0, entry.vy || 0) : kin.rotation.y;
        const bounce = Math.abs(Math.sin(now / 130 + data.phase)) * Math.min(0.08, speed * 0.05);
        kin.position.y = KIN_REST_Y + bounce;
        setKinOpacity(kin, 1);
        data.label.material.opacity = player.id === controlledId ? 1 : 0.85;

        data.shadow.visible = true;
        data.shadow.position.set(kin.position.x, PLATFORM_TOP_Y + 0.012, kin.position.z);
        const height = kin.position.y - KIN_REST_Y;
        data.shadow.scale.setScalar(Math.max(0.6, 1 - height * 1.5));
      }
    });

    // Pulse pack: rim glow reacts to bumps and to anyone close to the edge.
    let edgeDanger = 0;
    state.players.forEach((player) => {
      const entry = minigame.arena?.players?.[player.id];
      if (!entry?.alive) return;
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

    // Camera: gentle follow of your kin plus impact shake.
    const followX = controlledKin && this.kins.size ? controlledKin.position.x * 0.22 : 0;
    const followZ = controlledKin ? controlledKin.position.z * 0.14 : 0;
    this.lookTarget.lerp(new THREE.Vector3(followX, 0.18, followZ), 0.06);
    const shakeX = Math.sin(now / 26) * this.shake * 0.06;
    this.camera.position.x = this.baseCamera.x + Math.sin(now / 3600) * 0.1 + shakeX;
    this.camera.position.y = this.baseCamera.y + this.shake * 0.03;
    this.camera.lookAt(this.lookTarget);

    this.updateCountdown(minigame, now);
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
    const rect = this.webglCanvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(220, Math.floor(rect.height));
    const targetWidth = Math.floor(width * Math.min(window.devicePixelRatio || 1, 2));
    const targetHeight = Math.floor(height * Math.min(window.devicePixelRatio || 1, 2));
    if (this.webglCanvas.width !== targetWidth || this.webglCanvas.height !== targetHeight) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      const portrait = height > width;
      this.baseCamera = portrait ? new THREE.Vector3(0, 5.0, 6.1) : new THREE.Vector3(0, 3.9, 5.8);
      this.camera.fov = portrait ? 47 : 43;
      this.camera.position.copy(this.baseCamera);
      this.camera.updateProjectionMatrix();
    }
    if (!this.baseCamera) this.baseCamera = this.camera.position.clone();
  }
}
