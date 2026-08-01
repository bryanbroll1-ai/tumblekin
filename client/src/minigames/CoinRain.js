import * as THREE from "/vendor/three/three.module.js";
import {
  applyFinaleMood,
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  standOn
} from "./VoxelKit.js?v=tumblekin111";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin111";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin111";

// Münzregen — coins and bombs rain into three lanes; hop lanes to catch
// the gold and dodge the black fizzers.
const LANE_WIDTH = 1.5;
const LANE_TOP_Y = 0.07;            // Oberkante des Fangstreifens
const KIN_Y = standOn(LANE_TOP_Y);
const DROP_TOP_Y = 4.4;

export class CoinRain {
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
    this.dropMeshes = new Map();
    this.lastCatches = new Map();
    this.lastBombs = new Map();
    this.lastFrameAt = performance.now();
    this.swipe = null;
    this.shake = 0;
    this.finaleDone = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Münzregen" });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
    `);
    this.createScene();

    // Kein Knopfstreifen. Die Spur wechselt man durch Wischen auf dem ganzen
    // Bild — ein Knopf am unteren Rand ist bei einem Spiel, in dem man nach
    // oben schaut, nur ein zweiter Ort für den Blick.
    this.controls.innerHTML = `<p class="trace-hint">◀ Wischen zum Spurwechsel ▶</p>`;
    this.controls.style.pointerEvents = "none";
    this.onCanvasPointerDown = (event) => { this.swipe = { x: event.clientX, y: event.clientY }; };
    this.onCanvasPointerUp = (event) => {
      if (!this.swipe) return;
      const dx = event.clientX - this.swipe.x;
      this.swipe = null;
      if (Math.abs(dx) < 24) return;
      this.sendLane(dx > 0 ? 1 : -1);
    };
    this.webglCanvas.addEventListener("pointerdown", this.onCanvasPointerDown);
    this.webglCanvas.addEventListener("pointerup", this.onCanvasPointerUp);
    this.loop();
  }

  sendLane(dir) {
    this.feedback?.sound("move");
    this.feedback?.vibrate(8);
    this.sendInput({ action: "lane", dir }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    if (this.onCanvasPointerDown) this.webglCanvas.removeEventListener("pointerdown", this.onCanvasPointerDown);
    if (this.onCanvasPointerUp) this.webglCanvas.removeEventListener("pointerup", this.onCanvasPointerUp);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
    this.dropMeshes.clear();
  }

  createScene() {
    addStageLights(this.scene, { shadow: { top: 10 } });

    // Meadow with three catch lanes.
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    this.scene.add(meadow);
    for (let lane = 0; lane < 3; lane += 1) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.12, 0.3, 2.8),
        new THREE.MeshLambertMaterial({ color: lane === 1 ? "#ffdd8a" : "#f4cd6e" })
      );
      strip.position.set(this.laneX(lane), -0.08, 0.4);
      strip.receiveShadow = true;
      this.scene.add(strip);
      // Bright catch marker so the landing spot is obvious.
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.3, 0.04, 0.16),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7 })
      );
      marker.position.set(this.laneX(lane), 0.09, 0);
      this.scene.add(marker);
    }
    // A giant cloud machine hangs above the lanes and spits the drops.
    const machine = new THREE.Group();
    const hopper = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.7, 1.2),
      new THREE.MeshLambertMaterial({ color: "#8f6ae0" })
    );
    machine.add(hopper);
    for (let lane = 0; lane < 3; lane += 1) {
      const spout = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.45, 0.55),
        new THREE.MeshLambertMaterial({ color: "#7a4ddb" })
      );
      spout.position.set(this.laneX(lane), -0.55, 0.3);
      machine.add(spout);
    }
    machine.position.set(0, DROP_TOP_Y + 0.85, -0.9);
    this.scene.add(machine);
    this.machine = machine;

    [[-7, 5.2, -5, 5], [7, 6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    this.camera.position.set(0, this.baseCamY || 3.2, this.baseCamZ || 7.2);
    this.camera.lookAt(0, 2, 0);
  }

  laneX(lane) {
    return (lane - 1) * LANE_WIDTH;
  }

  buildDropMesh(kind) {
    if (kind === "coin") {
      const coin = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.12, 8),
        new THREE.MeshLambertMaterial({ color: "#ffc400", emissive: "#c98f1e", emissiveIntensity: 0.4 })
      );
      body.rotation.x = Math.PI / 2;
      coin.add(body);
      return coin;
    }
    if (kind === "gem") {
      // A sparkly triple-value gem — two stacked pyramids.
      const gem = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: "#12d0ff", emissive: "#12aaff", emissiveIntensity: 0.6 });
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.3, 6), mat);
      top.position.y = 0.12;
      gem.add(top);
      const bottom = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.24, 6), mat);
      bottom.rotation.x = Math.PI;
      bottom.position.y = -0.11;
      gem.add(bottom);
      return gem;
    }
    const bomb = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      new THREE.MeshLambertMaterial({ color: "#1b2530" })
    );
    bomb.add(core);
    const spark = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ff8b2e", emissiveIntensity: 1 })
    );
    spark.position.y = 0.32;
    bomb.add(spark);
    return bomb;
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.userData.stagger = (index - 1.5) * 0.3;
    kin.position.set(this.laneX(1), KIN_Y, 1 + kin.userData.stagger);
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_Y;
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
    const elapsed = Math.max(0, now - minigame.startedAt);

    this.machine.position.x = Math.sin(now / 1600) * 0.2;

    // Falling drops: spawn a mesh during the fall window, land at catchAt.
    const active = new Set();
    (arcade.drops || []).forEach((drop) => {
      const fallFrom = drop.catchAt - (arcade.fallMs || 1400);
      if (elapsed < fallFrom || elapsed > drop.catchAt + 120) return;
      active.add(drop.id);
      let mesh = this.dropMeshes.get(drop.id);
      if (!mesh) {
        mesh = this.buildDropMesh(drop.kind);
        mesh.userData = { kind: drop.kind };
        this.scene.add(mesh);
        this.dropMeshes.set(drop.id, mesh);
      }
      const t = Math.min(1, (elapsed - fallFrom) / (arcade.fallMs || 1400));
      mesh.position.set(this.laneX(drop.lane), DROP_TOP_Y - t * (DROP_TOP_Y - 0.5), 0);
      mesh.rotation.y = now / 300 + drop.id;
      if (drop.kind === "bomb") mesh.rotation.z = Math.sin(now / 120) * 0.2;
    });
    this.dropMeshes.forEach((mesh, id) => {
      if (active.has(id)) return;
      this.scene.remove(mesh);
      this.dropMeshes.delete(id);
    });

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const targetX = this.laneX(entry.lane) + (index - (state.players.length - 1) / 2) * 0.26;
      const moving = Math.abs(kin.position.x - targetX) > 0.05;
      kin.position.x = THREE.MathUtils.lerp(kin.position.x, targetX, frameLerp(0.3, dt));

      if ((entry.catches || 0) > (this.lastCatches.get(player.id) || 0)) {
        const gained = (entry.catches || 0) - (this.lastCatches.get(player.id) || 0);
        this.lastCatches.set(player.id, entry.catches);
        animator.trigger("jump");
        const catchPos = kin.position.clone().add(new THREE.Vector3(0, 0.6, 0));
        this.bursts.spawn(catchPos, ["#ffc400", "#ffd15c", "#ffffff"], { count: 9, speed: 1.9, up: 2, size: 0.08, life: 0.6, drag: 1.8, fadePow: 1.4 });
        this.bursts.ring(kin.position.clone().setY(0.07), "#ffd15c", { radius: 1, life: 0.4, opacity: 0.45 });
        this.floaters.pop(catchPos, `+${gained}`, { color: "#ffe36b", size: 0.36, life: 0.7, rise: 0.75 });
        if (player.id === controlledId) {
          this.feedback?.sound(gained > 1 ? "sparkle" : "coin", { pan: kin.position.x * 0.2 });
          this.feedback?.vibrate(gained > 1 ? [8, 12, 10] : 10);
        }
      }
      if ((entry.bombs || 0) > (this.lastBombs.get(player.id) || 0)) {
        this.lastBombs.set(player.id, entry.bombs);
        animator.trigger("hit");
        const bombPos = kin.position.clone().add(new THREE.Vector3(0, 0.4, 0));
        this.bursts.spawn(bombPos, ["#1b2530", "#ff8b2e", "#ffffff"], { count: 14, speed: 2.5, up: 2, size: 0.09, life: 0.72, drag: 1.5 });
        this.bursts.ring(kin.position.clone().setY(0.07), "#ff8b2e", { radius: 1.5, life: 0.5, opacity: 0.5 });
        this.floaters.pop(bombPos, "AUTSCH!", { color: "#ff8b2e", size: 0.36, life: 0.8 });
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 0.8);
          this.feedback?.sound("error");
          this.feedback?.vibrate([24, 18, 30]);
        }
      }

      if (minigame.finaleAt) {
        applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
      } else {
        animator.set(moving ? "run" : "idle", { base: true });
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.06, kin.position.z);
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 15) * this.shake * 0.22 * shakeScale();
    const desired = new THREE.Vector3(shakeX, this.baseCamY || 3.2, this.baseCamZ || 7.2);
    this.camera.position.lerp(desired, frameLerp(0.1, dt));
    this.camera.lookAt(0, 2, 0);

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
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.catches || 0);
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 3.4 : 3.2;
      this.baseCamZ = portrait ? 8 : 7.2;
      camera.fov = portrait ? 58 : 50;
    });
  }
}
