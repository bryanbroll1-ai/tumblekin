import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  disposeScene
} from "./VoxelKit.js?v=tumblekin62";
import { createOwnMarker, updateOwnMarker } from "./VoxelKit.js?v=tumblekin62";

// Kanonenflug — one perfectly timed tap fires your Kin out of the cannon.
// The power gauge swings up and down; tap at the peak to fly the farthest.
const CANNON_GAP = 1.9;
const FLIGHT_SCALE = 0.16;
const FLIGHT_MS = 1600;

export class CannonFly {
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
    this.stations = new Map();
    this.lastLaunched = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.canvas.hidden = true;
    this.webglCanvas = document.createElement("canvas");
    this.webglCanvas.className = `${this.canvas.className} kinetic-webgl`;
    this.webglCanvas.setAttribute("aria-label", "3D Kanonenflug");
    this.canvas.insertAdjacentElement("afterend", this.webglCanvas);

    this.hud = document.createElement("div");
    this.hud.className = "kinetic-hud";
    this.hud.innerHTML = `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0m</strong></div>
      <div class="cannon-phase-label" data-cannon-label>KRAFT</div>
      <div class="cannon-gauge" data-cannon-gauge><div class="cannon-gauge-fill" data-cannon-fill></div></div>
    `;
    this.webglCanvas.insertAdjacentElement("afterend", this.hud);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-cannon-launch>
        <span class="nerve-button-face">FEUER!</span>
      </button>
    `;
    this.launchButton = this.controls.querySelector("[data-cannon-launch]");
    this.onLaunchDown = (event) => {
      event.preventDefault();
      this.pressLaunch();
    };
    this.launchButton.addEventListener("pointerdown", this.onLaunchDown);
    this.loop();
  }

  pressLaunch() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.launchedAt) return;
    this.feedback?.sound("impact");
    this.feedback?.vibrate([18, 12, 26]);
    this.shake = Math.max(this.shake, 0.7);
    this.sendInput({ action: "launch" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
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
    this.animators.clear();
    this.stations.clear();
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#9adcf2");
    this.scene.fog = new THREE.Fog("#a8e2f4", 22, 55);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.webglCanvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x7ab890, 2.3));
    const sun = new THREE.DirectionalLight(0xfff2cf, 3.0);
    sun.position.set(-4, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -10;
    sun.shadow.camera.right = 10;
    sun.shadow.camera.top = 10;
    sun.shadow.camera.bottom = -10;
    this.scene.add(sun);

    // Launch meadow with distance stripes marching away from the cannons.
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.5, 40),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.set(0, -0.25, -12);
    meadow.receiveShadow = true;
    this.scene.add(meadow);
    for (let m = 20; m <= 100; m += 20) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(9, 0.06, 0.22),
        new THREE.MeshLambertMaterial({ color: "#e6f2da" })
      );
      stripe.position.set(0, 0.05, -m * FLIGHT_SCALE - 2.4);
      this.scene.add(stripe);
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.24, 0.06),
        new THREE.MeshLambertMaterial({ color: m >= 80 ? "#ffc400" : "#ff5c8a" })
      );
      flag.position.set(4.8, 0.7, -m * FLIGHT_SCALE - 2.4);
      this.scene.add(flag);
      const pole = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.9, 0.07),
        new THREE.MeshLambertMaterial({ color: "#5a4a3a" })
      );
      pole.position.set(4.65, 0.45, -m * FLIGHT_SCALE - 2.4);
      this.scene.add(pole);
    }

    [[-7, 5.6, -8, 5], [7, 6.4, -12, 6], [0, 7, -18, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureStation(player, index, players.length));
    this.resizeRenderer();
    this.camera.position.set(0, 3.6, 7.4);
    this.camera.lookAt(0, 1.4, -3);
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * CANNON_GAP;
  }

  ensureStation(player, index, count) {
    if (this.stations.has(player.id)) return this.stations.get(player.id);
    const x = this.stationX(index, count);

    // Blocky cannon aiming down-range. The barrel pivots high above a tall
    // base so its rear end never pokes out the bottom during angle selection.
    const cannon = new THREE.Group();
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 1.2, 8),
      new THREE.MeshLambertMaterial({ color: "#40506a" })
    );
    barrel.rotation.x = Math.PI / 3.2;
    barrel.position.y = 1.05;
    barrel.castShadow = true;
    cannon.add(barrel);
    // A round trunnion hub the barrel appears to pivot on.
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1.0, 10),
      new THREE.MeshLambertMaterial({ color: player.color })
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.y = 1.05;
    cannon.add(hub);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.1, 1.0),
      new THREE.MeshLambertMaterial({ color: player.color })
    );
    base.position.y = 0.55;
    base.castShadow = true;
    base.receiveShadow = true;
    cannon.add(base);
    cannon.position.set(x, 0, 2.4);
    this.scene.add(cannon);

    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.45);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.position.set(x, 1.28, 2.05);
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = 1.28;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);

    const station = { cannon, barrel, x, flightDone: false, landedShown: false };
    this.stations.set(player.id, station);
    return station;
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
    const elapsed = Math.max(0, now - minigame.startedAt);

    const players = state.players || [];
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const station = this.ensureStation(player, index, players.length);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);

      if (entry.launchedAt && !this.lastLaunched.get(player.id)) {
        this.lastLaunched.set(player.id, true);
        this.bursts.spawn(new THREE.Vector3(station.x, 1.6, 1.9), ["#ffd15c", "#ff8b2e", "#ffffff"], { count: 16, speed: 3, up: 2.2, size: 0.1, life: 0.7 });
        this.shake = Math.max(this.shake, 0.6);
        if (player.id !== controlledId) this.feedback?.sound("whoosh");
      }

      // Live launch angle (degrees from horizontal), pointing down-range.
      let deg = 45;
      const angleActive = entry.powerAt && !entry.launchedAt;
      if (angleActive) {
        const angleT = Math.abs(Math.sin(((now - entry.powerAt) / (arcade.anglePeriodMs || 1500)) * Math.PI));
        deg = 5 + angleT * 80;
      } else if (entry.launchedAt && entry.angle) {
        deg = entry.angle;
      }
      // Barrel points up-and-forward (toward -z, down-range) at that angle.
      station.barrel.rotation.x = (deg - 90) * Math.PI / 180;

      // The barrel mouth in world space, where the kin sits before firing.
      const rad = (deg * Math.PI) / 180;
      const mouthY = 1.05 + 0.85 * Math.sin(rad);
      const mouthZ = 2.4 - 0.85 * Math.cos(rad);

      if (entry.launchedAt) {
        // Real shot: leave the muzzle along the barrel line, then arc down to
        // the landing distance.
        const t = Math.min(1, (now - entry.launchedAt) / FLIGHT_MS);
        const distance = (entry.distance || 10) * FLIGHT_SCALE;
        const angleRad = ((entry.angle || 45) * Math.PI) / 180;
        const landZ = mouthZ - (distance + 2.4);
        kin.position.x = station.x;
        kin.position.z = THREE.MathUtils.lerp(mouthZ, landZ, t);
        const peak = 0.9 + Math.sin(angleRad) * (1.5 + (entry.distance || 10) * 0.018);
        animator.groundY = THREE.MathUtils.lerp(mouthY, 0.62, t) + Math.sin(t * Math.PI) * peak;
        kin.rotation.x = -t * Math.PI * 1.6;
        if (t >= 1 && !station.landedShown) {
          station.landedShown = true;
          this.bursts.spawn(kin.position.clone(), ["#7fce6f", "#e6f2da", player.color], { count: 12, speed: 2, up: 1.8, size: 0.09, life: 0.7 });
          if (player.id === controlledId) {
            this.feedback?.sound("land");
            this.feedback?.vibrate(16);
          }
        }
        if (t >= 1) {
          kin.rotation.x = 0;
          animator.groundY = 0.62;
          animator.set(minigame.finaleAt && this.isWinner(arcade, players, entry) ? "cheer" : "idle", { base: true });
        }
      } else {
        // Sit tucked in the barrel mouth, tilted with the tube, ready to fire.
        animator.set("idle", { base: true });
        kin.position.x = station.x;
        kin.position.z = mouthZ;
        animator.groundY = mouthY;
        kin.rotation.x = (deg - 90) * Math.PI / 180 * 0.6;
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.05, kin.position.z);
      kin.userData.shadow.material.opacity = Math.max(0.05, 0.22 - (animator.groundY - 0.62) * 0.05);
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);

    this.shake *= 0.9;
    const shakeX = Math.sin(now / 15) * this.shake * 0.22;
    const desired = new THREE.Vector3(shakeX, this.baseCamY || 3.6, this.baseCamZ || 7.4);
    this.camera.position.lerp(desired, 0.1);
    this.camera.lookAt(0, 1.4, -3);

    this.updateHud(minigame, arcade, state, elapsed, now);
    // Global: a downward arrow marks your own kin so you never lose yourself.
    { const oid = this.getControlledPlayerId(); const ok = this.kins && this.kins.get(oid);
      if (ok) { if (!this.ownMarker) { this.ownMarker = createOwnMarker(); this.scene.add(this.ownMarker); }
        this.ownMarker.visible = ok.visible !== false;
        this.ownMarker.position.set(ok.position.x, 0, ok.position.z);
        updateOwnMarker(this.ownMarker, now, ok.position.y + 0.35); } }
    this.renderer.render(this.scene, this.camera);
  }

  isWinner(arcade, players, entry) {
    let best = 0;
    players.forEach((player) => {
      const candidate = arcade.players[player.id];
      if (candidate && (candidate.distance || 0) > best) best = candidate.distance || 0;
    });
    return (entry.distance || 0) === best && best > 0;
  }

  updateHud(minigame, arcade, state, elapsed, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = own?.launchedAt ? `${own.distance}m` : "—";

    // The live gauge: phase 1 shows power, phase 2 the sweeping angle.
    const fill = this.hud.querySelector("[data-cannon-fill]");
    const gauge = this.hud.querySelector("[data-cannon-gauge]");
    const label = this.hud.querySelector("[data-cannon-label]");
    if (fill && gauge) {
      if (own?.launchedAt || minigame.finaleAt || elapsed < 0) {
        gauge.classList.add("done");
        gauge.classList.remove("angle-phase");
        if (label) label.textContent = own?.angle ? `${own.angle}°` : "";
      } else if (own?.powerAt) {
        gauge.classList.remove("done");
        gauge.classList.add("angle-phase");
        const nowT = this.now();
        const angleT = Math.abs(Math.sin(((nowT - own.powerAt) / (arcade.anglePeriodMs || 1500)) * Math.PI));
        const deg = Math.round(5 + angleT * 80);
        fill.style.height = `${Math.round(angleT * 100)}%`;
        fill.classList.toggle("hot", Math.abs(deg - 45) < 8);
        if (label) label.textContent = `WINKEL ${deg}°`;
      } else {
        gauge.classList.remove("done");
        gauge.classList.remove("angle-phase");
        const power = Math.abs(Math.sin((elapsed / (arcade.periodMs || 1300)) * Math.PI));
        fill.style.height = `${Math.round(power * 100)}%`;
        fill.classList.toggle("hot", power > 0.85);
        if (label) label.textContent = "KRAFT";
      }
    }
    if (this.launchButton) {
      this.launchButton.disabled = Boolean(own?.launchedAt || minigame.finaleAt);
      const face = this.launchButton.querySelector(".nerve-button-face");
      if (face) face.textContent = own?.powerAt && !own?.launchedAt ? "WINKEL!" : "FEUER!";
    }
  }

  resizeRenderer() {
    const rect = this.webglCanvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (this.webglCanvas.width === Math.floor(width * ratio) && this.webglCanvas.height === Math.floor(height * ratio)) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const portrait = height > width;
    this.baseCamY = portrait ? 4 : 3.6;
    this.baseCamZ = portrait ? 9 : 7.4;
    this.camera.fov = portrait ? 56 : 50;
    this.camera.updateProjectionMatrix();
  }
}
