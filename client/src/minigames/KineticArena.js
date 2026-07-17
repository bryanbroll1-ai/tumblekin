import * as THREE from "/vendor/three/three.module.js";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin36";
import {
  CubeBurst,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  disposeScene,
  noise
} from "./VoxelKit.js?v=tumblekin36";

const WORLD_SCALE = 5.6;
const DOCK_TOP_Y = 0.32;
const KIN_REST_Y = 0.62;
const WATER_Y = -1.5;

export class KineticArena {
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
    this.joystick = null;
    this.kins = new Map();
    this.lastScore = 0;
    this.lastHitAt = 0;
    this.lastTargetIndex = -1;
    this.lastTargetPosition = new THREE.Vector3();
    this.shake = 0;
    this.feedbackPulse = 0;
    this.lookTarget = new THREE.Vector3(0, 0.3, 0);
    this.lastFrameAt = performance.now();
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.canvas.hidden = true;
    this.webglCanvas = document.createElement("canvas");
    this.webglCanvas.className = `${this.canvas.className} kinetic-webgl`;
    this.webglCanvas.setAttribute("aria-label", "3D Drift Docks");
    this.canvas.insertAdjacentElement("afterend", this.webglCanvas);

    this.hud = document.createElement("div");
    this.hud.className = "kinetic-hud";
    this.hud.innerHTML = `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="kinetic-countdown" data-kinetic-countdown></div>
    `;
    this.webglCanvas.insertAdjacentElement("afterend", this.hud);
    this.createScene();

    this.controls.innerHTML = `<div class="mobile-stick-controls joystick-only"><div class="joystick-slot"></div></div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Tumblekin bewegen",
      intervalMs: 82,
      feedback: this.feedback,
      onDirection: (action) => this.sendInput({ action }).catch(() => {}),
      onEngage: () => {
        this.feedback?.sound("move");
        this.feedback?.vibrate(10);
      }
    });
    this.loop();
  }

  handleUpdate(update) {
    const current = update.arcade?.players?.[this.getControlledPlayerId()];
    const score = current?.score || 0;
    if (score > this.lastScore + 4) {
      this.feedbackPulse = 1;
      this.feedback?.sound("coin");
      this.feedback?.vibrate([10, 14, 18]);
    }
    if ((current?.lastHitAt || 0) > this.lastHitAt && current?.flash === "bad") {
      this.feedbackPulse = -1;
      this.shake = 1;
      this.feedback?.sound("collision");
      this.feedback?.vibrate([20, 18, 30]);
    }
    this.lastScore = score;
    this.lastHitAt = current?.lastHitAt || this.lastHitAt;
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
    this.hud?.remove();
    this.webglCanvas = null;
    this.hud = null;
    this.scene = null;
    this.renderer = null;
    this.kins.clear();
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#8fd8f2");
    this.scene.fog = new THREE.Fog("#9fdef5", 12, 28);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 60);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.webglCanvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x6fb0c4, 2.3));
    const sun = new THREE.DirectionalLight(0xfff4d6, 3.5);
    sun.position.set(-3.5, 8, 5.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    this.scene.add(sun);

    // Harbor water with drifting buoys.
    this.water = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.5, 34),
      new THREE.MeshLambertMaterial({ color: "#3cb0cf", transparent: true, opacity: 0.94 })
    );
    this.water.rotation.y = Math.PI / 4;
    this.water.position.y = WATER_Y - 0.25;
    this.scene.add(this.water);

    this.drifters = [];
    [[-4.6, -1.1, 2.6, 0], [4.8, -1.15, 1.4, 1], [3.6, -1.05, -3.4, 2], [-4.1, -1.2, -2.6, 3]].forEach(([x, y, z, seed]) => {
      const buoy = createBuoy(seed);
      buoy.position.set(x, y, z);
      buoy.userData = { baseY: y, phase: seed * 1.9, drift: 0.09 };
      this.scene.add(buoy);
      this.drifters.push(buoy);
    });
    [[-5.2, 2.4, -3.2, 5], [5.4, 3.1, -2.0, 6], [-4.0, 3.4, 3.0, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      cloud.userData = { baseY: y, phase: seed, drift: 0.12 };
      this.scene.add(cloud);
      this.drifters.push(cloud);
    });

    // Dock on wooden stilts.
    [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]].forEach(([x, z]) => {
      const stilt = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.2, 0.34), new THREE.MeshLambertMaterial({ color: "#7a4a2a" }));
      stilt.position.set(x, -0.95, z);
      stilt.castShadow = true;
      this.scene.add(stilt);
    });

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 3.05, 0.4, 8),
      new THREE.MeshLambertMaterial({ color: "#9a6a48" })
    );
    base.position.y = -0.02;
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(base);

    const planks = new THREE.Mesh(
      new THREE.CylinderGeometry(2.85, 2.85, 0.14, 8),
      new THREE.MeshLambertMaterial({ color: "#f5cd80" })
    );
    planks.position.y = 0.25;
    planks.receiveShadow = true;
    this.scene.add(planks);
    for (let seam = 0; seam < 8; seam += 1) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.02, 2.7),
        new THREE.MeshBasicMaterial({ color: "#9a6a48", transparent: true, opacity: 0.4 })
      );
      line.position.y = DOCK_TOP_Y + 0.002;
      line.rotation.y = seam / 8 * Math.PI * 2;
      this.scene.add(line);
    }

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(2.87, 0.085, 4, 8),
      new THREE.MeshLambertMaterial({ color: "#75e6ec", emissive: "#267d85", emissiveIntensity: 0.4 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.34;
    this.scene.add(rim);

    // Rotating boom: striped bar with glowing lantern ends — easy to read.
    this.sweeper = new THREE.Group();
    for (let segment = 0; segment < 6; segment += 1) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.86, 0.24, 0.26),
        new THREE.MeshLambertMaterial({ color: segment % 2 ? "#ffffff" : "#ef6673" })
      );
      bar.position.set(-2.15 + segment * 0.86, 0.72, 0);
      bar.castShadow = true;
      this.sweeper.add(bar);
    }
    [-2.62, 2.62].forEach((x) => {
      const lantern = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, 0.4),
        new THREE.MeshLambertMaterial({ color: "#ffe56f", emissive: "#c98f1e", emissiveIntensity: 0.55 })
      );
      lantern.position.set(x, 0.72, 0);
      lantern.rotation.y = Math.PI / 4;
      lantern.castShadow = true;
      this.sweeper.add(lantern);
    });
    const axle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), new THREE.MeshLambertMaterial({ color: "#35515c" }));
    axle.position.y = 0.55;
    axle.castShadow = true;
    this.sweeper.add(axle);
    const axleCap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), new THREE.MeshLambertMaterial({ color: "#75e6ec" }));
    axleCap.position.y = 1.1;
    axleCap.rotation.y = Math.PI / 4;
    this.sweeper.add(axleCap);
    this.scene.add(this.sweeper);

    // The coin everyone chases.
    this.coin = new THREE.Group();
    const coinDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.09, 8),
      new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#8b5c08", emissiveIntensity: 0.35 })
    );
    coinDisc.rotation.x = Math.PI / 2;
    coinDisc.castShadow = true;
    this.coin.add(coinDisc);
    const coinCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.11),
      new THREE.MeshBasicMaterial({ color: "#fff6bd", transparent: true, opacity: 0.9 })
    );
    coinCore.rotation.z = Math.PI / 4;
    this.coin.add(coinCore);
    const coinShadow = createShadowBlob(0.44);
    coinShadow.position.y = DOCK_TOP_Y + 0.01;
    this.coinShadow = coinShadow;
    this.scene.add(coinShadow);
    this.scene.add(this.coin);

    this.bursts = new CubeBurst(this.scene);

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
    kin.position.y = KIN_REST_Y;
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
    const arcade = minigame?.arcade;
    if (!minigame || !state || !arcade || !this.renderer) return;
    this.resizeRenderer();

    const now = this.now();
    const frameNow = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (frameNow - this.lastFrameAt) / 1000));
    this.lastFrameAt = frameNow;
    const controlledId = this.getControlledPlayerId();

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const data = kin.userData;
      data.target.set((entry.x - 0.5) * WORLD_SCALE, KIN_REST_Y, (entry.y - 0.5) * WORLD_SCALE);
      kin.position.lerp(data.target, 0.38);

      const speed = Math.hypot(entry.vx || 0, entry.vy || 0);
      const stretch = Math.min(0.16, speed * 0.32);
      data.body.scale.set(1 + stretch, 1 - stretch * 0.7, 1 + stretch * 0.4);
      data.body.rotation.x = Math.min(0.3, speed * 0.6);
      if (speed > 0.02) kin.rotation.y = Math.atan2(entry.vx || 0, entry.vy || 0);
      const hop = Math.abs(Math.sin(now / 130 + data.phase)) * Math.min(0.07, speed * 0.25);
      kin.position.y = KIN_REST_Y + hop;

      data.shadow.position.set(kin.position.x, DOCK_TOP_Y + 0.012, kin.position.z);
      data.shadow.scale.setScalar(Math.max(0.65, 1 - hop * 2));
      data.label.material.opacity = player.id === controlledId ? 1 : 0.85;

      // Red flash burst when this player gets swept.
      if (entry.flash === "bad" && entry.lastHitAt && entry.lastHitAt > (data.lastHitShown || 0)) {
        data.lastHitShown = entry.lastHitAt;
        this.bursts.spawn(kin.position.clone(), ["#ffffff", "#ef6673"], { count: 8, speed: 1.8, up: 1.9, size: 0.08, life: 0.55 });
      }
    });

    // Boom rotation straight from server state.
    this.sweeper.rotation.y = -arcade.sweepAngle;

    // Coin hop + collect burst whenever it relocates.
    const targetWorld = new THREE.Vector3(
      (arcade.target.x - 0.5) * WORLD_SCALE,
      KIN_REST_Y + 0.12 + Math.sin(now / 150) * 0.07,
      (arcade.target.y - 0.5) * WORLD_SCALE
    );
    if (arcade.target.index !== this.lastTargetIndex) {
      if (this.lastTargetIndex >= 0) {
        this.bursts.spawn(this.lastTargetPosition.clone(), ["#ffd15c", "#fff6bd"], { count: 12, speed: 2.1, up: 2.4, size: 0.08, life: 0.65 });
      }
      this.lastTargetIndex = arcade.target.index;
    }
    this.lastTargetPosition.copy(targetWorld);
    this.coin.position.copy(targetWorld);
    this.coin.rotation.y += dt * 2.6;
    this.coinShadow.position.set(targetWorld.x, DOCK_TOP_Y + 0.01, targetWorld.z);

    this.drifters.forEach((drifter) => {
      const data = drifter.userData;
      drifter.position.y = data.baseY + Math.sin(now / 1300 + data.phase) * data.drift;
    });
    this.water.position.y = WATER_Y - 0.25 + Math.sin(now / 900) * 0.045;

    this.bursts.update(dt);
    this.feedbackPulse *= 0.85;
    this.shake *= 0.82;

    const controlledKin = this.kins.get(controlledId);
    const followX = controlledKin ? controlledKin.position.x * 0.2 : 0;
    const followZ = controlledKin ? controlledKin.position.z * 0.12 : 0;
    this.lookTarget.lerp(new THREE.Vector3(followX, 0.26, followZ), 0.06);
    const shakeX = Math.sin(now / 24) * this.shake * 0.07;
    this.camera.position.x = this.baseCamera.x + Math.sin(now / 3600) * 0.12 + shakeX;
    this.camera.position.y = this.baseCamera.y + this.shake * 0.04;
    this.camera.lookAt(this.lookTarget);

    this.updateHud(minigame, state, now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const controlled = minigame.arcade?.players?.[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.max(0, Math.round(controlled?.score || 0)));

    const untilStart = minigame.startedAt - now;
    const afterStart = now - minigame.startedAt;
    const value = untilStart > 0 ? String(Math.ceil(untilStart / 1000)) : (afterStart < 460 ? "GO!" : "");
    const countdown = this.hud.querySelector("[data-kinetic-countdown]");
    countdown.textContent = value;
    countdown.classList.toggle("go", value === "GO!");
    countdown.hidden = !value;
  }

  resizeRenderer() {
    const rect = this.webglCanvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (this.webglCanvas.width === Math.floor(width * ratio) && this.webglCanvas.height === Math.floor(height * ratio)) {
      if (!this.baseCamera) this.baseCamera = this.camera.position.clone();
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const portrait = height > width;
    this.baseCamera = portrait ? new THREE.Vector3(0, 7.0, 7.5) : new THREE.Vector3(0, 5.2, 7.4);
    this.camera.fov = portrait ? 50 : 42;
    this.camera.position.copy(this.baseCamera);
    this.camera.updateProjectionMatrix();
  }
}

function createBuoy(seed = 0) {
  const group = new THREE.Group();
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshLambertMaterial({ color: "#ef6673" }));
  group.add(bottom);
  const middle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.4), new THREE.MeshLambertMaterial({ color: "#ffffff" }));
  middle.position.y = 0.28;
  group.add(middle);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.28), new THREE.MeshLambertMaterial({ color: "#ef6673" }));
  top.position.y = 0.53;
  group.add(top);
  const light = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.14),
    new THREE.MeshLambertMaterial({ color: "#ffe56f", emissive: "#c98f1e", emissiveIntensity: 0.5 })
  );
  light.position.y = 0.72;
  light.rotation.y = Math.PI / 4 + seed;
  group.add(light);
  group.rotation.y = seed * 0.8;
  return group;
}
