import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  setKinOpacity
} from "./VoxelKit.js?v=tumblekin76";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin76";
import { shakeScale } from "./Quality.js?v=tumblekin76";

// Farbflucht — a blocky "stand on the called colour" party round.
// Each round a colour is announced; when the floor drops, every tile of a
// different colour falls into the void along with anyone still on it.
const TILE = 1.06;
const GRID = 6;
const TILE_TOP = 0.32;
const KIN_Y = TILE_TOP + 0.34;
const COLORS = ["#ff2e6a", "#12aaff", "#ffc400", "#33cf4d"];
const COLOR_NAMES = ["Pink", "Blau", "Gelb", "Grün"];

function tileX(gx) {
  return (gx - (GRID - 1) / 2) * TILE;
}
function tileZ(gy) {
  return (gy - (GRID - 1) / 2) * TILE;
}

export class ColorRush {
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
    this.tiles = [];
    this.kins = new Map();
    this.animators = new Map();
    this.lastFallen = new Map();
    this.lastSurvived = new Map();
    this.lastRound = -1;
    this.lastFrameAt = performance.now();
    this.swipe = null;
    this.shake = 0;
    this.lastPhaseName = null;
    this.baseCamera = new THREE.Vector3(0, 8.2, 6.6);
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Farbflucht", background: "#8fd8f2", fog: ["#9fdef5", 16, 40] });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-color-banner hidden></div>
      <div class="kinetic-countdown" data-kinetic-countdown></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <div class="color-dpad">
        <button type="button" data-step="up" aria-label="Hoch">▲</button>
        <div class="color-dpad-row">
          <button type="button" data-step="left" aria-label="Links">◀</button>
          <button type="button" data-step="right" aria-label="Rechts">▶</button>
        </div>
        <button type="button" data-step="down" aria-label="Runter">▼</button>
      </div>
    `;
    this.controls.querySelectorAll("[data-step]").forEach((button) => {
      button.addEventListener("pointerdown", () => this.sendStep(button.dataset.step));
    });
    this.onCanvasPointerDown = (event) => { this.swipe = { x: event.clientX, y: event.clientY }; };
    this.onCanvasPointerUp = (event) => this.resolveSwipe(event);
    this.webglCanvas.addEventListener("pointerdown", this.onCanvasPointerDown);
    this.webglCanvas.addEventListener("pointerup", this.onCanvasPointerUp);
    this.loop();
  }

  resolveSwipe(event) {
    if (!this.swipe) return;
    const dx = event.clientX - this.swipe.x;
    const dy = event.clientY - this.swipe.y;
    this.swipe = null;
    if (Math.hypot(dx, dy) < 24) return;
    // Screen up/down maps to moving away/toward the camera on the grid.
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    this.sendStep(dir);
  }

  sendStep(dir) {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.eliminated) return;
    this.feedback?.sound("move");
    this.feedback?.vibrate(8);
    this.sendInput({ action: "step", dir }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    if (this.onCanvasPointerDown) this.webglCanvas.removeEventListener("pointerdown", this.onCanvasPointerDown);
    if (this.onCanvasPointerUp) this.webglCanvas.removeEventListener("pointerup", this.onCanvasPointerUp);
    teardownStage(this);
    this.tiles = [];
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      hemiIntensity: 2.4,
      skyColor: 0xdfefff,
      groundColor: 0x6fb0c4,
      sunColor: 0xfff4d6
    });

    // The canyon below: falling means dropping into a dark chasm and
    // vanishing from sight — not floating in the sky.
    const span = GRID * TILE;
    const wallMat = new THREE.MeshLambertMaterial({ color: "#5a4030" });
    const wallMatDark = new THREE.MeshLambertMaterial({ color: "#3c2a1e" });
    [[0, -span / 2 - 0.4, span + 2.4, 0.8, wallMat], [0, span / 2 + 0.4, span + 2.4, 0.8, wallMat]].forEach(([x, z, w, d, mat]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), mat);
      wall.position.set(x, -3.7, z);
      this.scene.add(wall);
    });
    [[-span / 2 - 0.4, 0, 0.8, span + 2.4, wallMatDark], [span / 2 + 0.4, 0, 0.8, span + 2.4, wallMatDark]].forEach(([x, z, w, d, mat]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), mat);
      wall.position.set(x, -3.7, z);
      this.scene.add(wall);
    });
    const pit = new THREE.Mesh(
      new THREE.BoxGeometry(span + 2.4, 0.4, span + 2.4),
      new THREE.MeshLambertMaterial({ color: "#1c130c" })
    );
    pit.position.y = -7.2;
    this.scene.add(pit);

    // The 6×6 colour floor.
    for (let gy = 0; gy < GRID; gy += 1) {
      for (let gx = 0; gx < GRID; gx += 1) {
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(TILE - 0.08, TILE_TOP, TILE - 0.08),
          new THREE.MeshLambertMaterial({ color: COLORS[0] })
        );
        tile.position.set(tileX(gx), 0, tileZ(gy));
        tile.receiveShadow = true;
        tile.castShadow = true;
        tile.userData = { gx, gy, restY: 0 };
        this.scene.add(tile);
        this.tiles[gy * GRID + gx] = tile;
      }
    }

    [[-6, 5, -4, 5], [6, 6, -2, 6], [-5, 6, 5, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
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
    kin.position.set(0, KIN_Y, 0);
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

  computePhase(arcade, minigame, now) {
    const elapsed = Math.max(0, now - minigame.startedAt);
    // Mirror the server's calm lead-in before the first drop.
    const shifted = elapsed - (arcade.leadMs || 0);
    if (shifted < 0) return { name: "announce", t: Math.max(0, 1 + shifted / Math.max(1, arcade.leadMs || 1)) };
    const round = arcade.round;
    const roundElapsed = shifted - round * arcade.roundMs;
    if (roundElapsed < arcade.announceMs) return { name: "announce", t: roundElapsed / arcade.announceMs };
    if (roundElapsed < arcade.dropEndMs) return { name: "drop", t: (roundElapsed - arcade.announceMs) / (arcade.dropEndMs - arcade.announceMs) };
    return { name: "rest", t: (roundElapsed - arcade.dropEndMs) / Math.max(1, arcade.roundMs - arcade.dropEndMs) };
  }

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
    const phase = this.computePhase(arcade, minigame, now);

    if (arcade.round !== this.lastRound) {
      this.lastRound = arcade.round;
      this.feedback?.sound("countdown");
    }

    // The moment the floor drops: shake the camera, thump, and blast debris
    // out of every tile that is falling away.
    const droppedNow = phase.name === "drop" && this.lastPhaseName === "announce";
    if (droppedNow) {
      this.shake = 1;
      this.feedback?.sound("impact");
      this.feedback?.vibrate([24, 20, 34]);
    }
    this.lastPhaseName = phase.name;

    // Recolour + animate tiles.
    this.tiles.forEach((tile, index) => {
      const color = arcade.grid[index];
      tile.material.color.set(COLORS[color] || COLORS[0]);
      const isTarget = color === arcade.targetColor;
      const gx = index % GRID;
      const gy = Math.floor(index / GRID);
      let targetY = 0;
      let opacity = 1;
      let jitterX = 0;
      let jitterZ = 0;
      if (phase.name === "announce" && !isTarget) {
        // Doomed tiles tremble harder as the drop approaches (telegraph).
        const menace = Math.pow(phase.t, 2) * 0.06;
        jitterX = Math.sin(now / 40 + index) * menace;
        jitterZ = Math.cos(now / 37 + index * 1.3) * menace;
      } else if (phase.name === "drop" && !isTarget) {
        targetY = -3.4 * phase.t;
        opacity = Math.max(0, 1 - phase.t * 1.4);
        if (droppedNow) {
          this.bursts.spawn(new THREE.Vector3(tileX(gx), TILE_TOP, tileZ(gy)), [COLORS[color], "#ffffff"], { count: 3, speed: 1.6, up: 1.4, size: 0.09, life: 0.6 });
        }
      } else if (phase.name === "rest" && !isTarget) {
        targetY = -3.4 * (1 - phase.t);
        opacity = Math.min(1, phase.t * 1.4);
      }
      tile.position.x = tileX(gx) + jitterX;
      tile.position.z = tileZ(gy) + jitterZ;
      tile.position.y = THREE.MathUtils.lerp(tile.position.y, targetY, 0.3);
      tile.material.transparent = opacity < 1;
      tile.material.opacity = opacity;
      // Target tiles glow and gently bob during the warning so the safe
      // colour pops out boldly, Mario-Party style.
      if (isTarget && (phase.name === "announce" || phase.name === "drop")) {
        tile.material.emissive = tile.material.emissive || new THREE.Color();
        tile.material.emissive.set(COLORS[color]);
        tile.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(now / 150)) * 0.7;
        if (phase.name === "announce") tile.position.y += Math.abs(Math.sin(now / 150 + gx + gy)) * 0.06;
      } else {
        tile.material.emissiveIntensity = 0;
      }
    });

    let controlledKin = null;
    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const fallen = Boolean(entry.eliminated);

      const targetX = tileX(entry.gx);
      const targetZ = tileZ(entry.gy);
      kin.position.x = THREE.MathUtils.lerp(kin.position.x, targetX, 0.35);
      kin.position.z = THREE.MathUtils.lerp(kin.position.z, targetZ, 0.35);

      if (fallen && !this.lastFallen.get(player.id)) {
        animator.trigger("fall");
        this.bursts.spawn(kin.position.clone(), [player.color, "#ffffff", "#1b2530"], { count: 14, speed: 2.3, up: 1.6, size: 0.09, life: 0.7, drag: 1.5 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1, 0)), "REINGEFALLEN!", { color: "#ff6b7f", size: 0.36, life: 0.9 });
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 0.7);
          this.feedback?.sound("error");
          this.feedback?.vibrate([18, 18, 18]);
        }
      }
      this.lastFallen.set(player.id, fallen);

      if ((entry.survived || 0) > (this.lastSurvived.get(player.id) || 0)) {
        this.lastSurvived.set(player.id, entry.survived);
        this.bursts.spawn(kin.position.clone(), [player.color, "#ffffff"], { count: 10, speed: 2, up: 2.2, size: 0.08, life: 0.6, drag: 1.8, fadePow: 1.4 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1, 0)), "SICHER!", { color: "#ffe36b", size: 0.32, life: 0.65, rise: 0.7 });
        if (player.id === controlledId) {
          this.feedback?.sound("pop", { pan: kin.position.x * 0.18 });
          this.feedback?.vibrate(10);
        }
      }

      // Eliminated kins plunge into the chasm, fade out and disappear.
      if (fallen) {
        animator.groundY = THREE.MathUtils.lerp(animator.groundY, KIN_Y - 7.5, 0.06);
        const depth = KIN_Y - animator.groundY;
        const visibility = Math.max(0, 1 - depth / 2.6);
        setKinOpacity(kin, visibility);
        kin.userData.label.material.opacity = 0;
        kin.visible = visibility > 0.02;
      } else {
        animator.groundY = KIN_Y;
        kin.visible = true;
        setKinOpacity(kin, 1);
      }
      // Finale: the survivor celebrates on camera before the scoreboard.
      if (!fallen) {
        animator.set(minigame.finaleAt ? "cheer" : "idle", { base: true });
        if (minigame.finaleAt && !this.finaleCelebrated) {
          this.finaleCelebrated = true;
          this.bursts.spawn(kin.position.clone(), [player.color, "#ffffff", "#ffc400"], { count: 24, speed: 2.8, up: 3, size: 0.1, life: 0.95, drag: 1.2 });
          this.bursts.ring(kin.position.clone().setY(0.08), "#ffc400", { radius: 2, life: 0.65, opacity: 0.6 });
          this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "🏆", { size: 0.56, life: 1.2, rise: 1 });
          if (player.id === controlledId) this.feedback?.sound("win");
        }
      }
      animator.update(now);

      kin.userData.shadow.position.set(kin.position.x, TILE_TOP / 2 + 0.02, kin.position.z);
      kin.userData.shadow.material.opacity = fallen ? 0 : 0.26;
      kin.userData.label.material.opacity = fallen ? 0 : (player.id === controlledId ? 1 : 0.8);
      if (player.id === controlledId) controlledKin = kin;
    });

    this.bursts.update(dt);

    this.floaters.update(dt);

    // Camera: gentle follow plus a drop/fall impact shake.
    this.shake *= 0.9;
    const focusX = controlledKin ? controlledKin.position.x : 0;
    const focusZ = controlledKin ? controlledKin.position.z : 0;
    const shakeX = Math.sin(now / 16) * this.shake * 0.28 * shakeScale();
    const shakeY = Math.cos(now / 13) * this.shake * 0.2;
    const desired = new THREE.Vector3(focusX * 0.25 + shakeX, this.baseCamera.y + shakeY, focusZ * 0.25 + this.baseCamera.z);
    this.camera.position.lerp(desired, 0.12);
    this.camera.lookAt(0, 0, 0);

    this.updateHud(minigame, state, arcade, phase, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, state, arcade, phase, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const controlled = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(controlled?.survived || 0);

    // Mario-Party-style colour roulette: during the announce the banner spins
    // fast through the colours, then locks onto the target with a callout.
    const banner = this.hud.querySelector("[data-color-banner]");
    if (banner) {
      const showWarning = phase.name === "announce" || phase.name === "drop";
      banner.hidden = !showWarning;
      if (showWarning) {
        const spinning = phase.name === "announce" && phase.t < 0.55;
        const colorIdx = spinning ? Math.floor(now / 90) % COLORS.length : arcade.targetColor;
        const secs = phase.name === "announce" ? Math.max(1, Math.ceil((1 - phase.t) * arcade.announceMs / 1000)) : 0;
        banner.textContent = spinning
          ? "Welche Farbe? …"
          : (phase.name === "drop" ? `${COLOR_NAMES[arcade.targetColor]}!` : `Steh auf ${COLOR_NAMES[arcade.targetColor]}!  ${secs}`);
        banner.style.background = COLORS[colorIdx];
        banner.style.color = colorIdx === 2 ? "#5c4508" : "#1b2530";
        banner.classList.toggle("locked", !spinning);
      }
    }

    // No big centre countdown — it would cover the grid.
    const countdown = this.hud.querySelector("[data-kinetic-countdown]");
    if (countdown) countdown.hidden = true;
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamera = portrait ? new THREE.Vector3(0, 12.5, 9.8) : new THREE.Vector3(0, 11.5, 9.2);
      camera.fov = portrait ? 50 : 46;
    });
  }
}
