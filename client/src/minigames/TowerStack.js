import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  createCloud,
  createNameLabel,
  createOwnMarker,
  updateOwnMarker
} from "./VoxelKit.js?v=tumblekin91";
import { mountStage, mountHud, addStageLights, resizeStage, teardownStage } from "./SceneKit.js?v=tumblekin91";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin91";

// Turmbau — a block slides back and forth over each player's tower; tap to
// drop it. Overhang is trimmed off, a perfect stack keeps full width, and a
// total miss topples the tower. Tallest tower wins.
const COL_GAP = 1.85;
const BLOCK_H = 0.32;
const BASE_Y = 0.2;
const WORLD_W = 1.35;      // world width of a full-width (=1) block
const SLIDE_W = 1.15;      // world half-range of the sliding block

export class TowerStack {
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
    this.towers = new Map();       // playerId -> { group, blocks:[], slider, x, color }
    this.lastHeight = new Map();
    this.lastToppled = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Turmbau", fog: ["#a8e2f4", 20, 46], fov: 46, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-stack-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-stack-drop>
        <span class="nerve-button-face">SETZEN!</span>
      </button>
    `;
    this.dropButton = this.controls.querySelector("[data-stack-drop]");
    this.onDropDown = (event) => {
      event.preventDefault();
      this.pressDrop();
    };
    this.dropButton.addEventListener("pointerdown", this.onDropDown);
    this.onCanvasTap = (event) => {
      event.preventDefault();
      this.pressDrop();
    };
    this.webglCanvas.addEventListener("pointerdown", this.onCanvasTap);
    this.loop();
  }

  pressDrop() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.toppled || own.height >= arcade.total) return;
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "drop" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    if (this.onCanvasTap) this.webglCanvas.removeEventListener("pointerdown", this.onCanvasTap);
    teardownStage(this);
    this.towers.clear();
  }

  createScene() {
    addStageLights(this.scene, { sunPosition: [-4, 12, 6], shadow: { top: 12, bottom: -6 } });

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 12),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    this.scene.add(ground);

    [[-7, 5.4, -4, 5], [7, 6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureTower(player, index, players.length));
    this.resizeRenderer();
    this.camera.position.set(0, this.baseCamY || 2.6, this.baseCamZ || 8);
    this.camera.lookAt(0, 1.3, 0);
  }

  columnX(index, count) {
    return (index - (count - 1) / 2) * COL_GAP;
  }

  ensureTower(player, index, count) {
    if (this.towers.has(player.id)) return this.towers.get(player.id);
    const isOwn = player.id === this.getControlledPlayerId();
    const x = this.columnX(index, count);
    const group = new THREE.Group();
    group.position.x = x;
    this.scene.add(group);
    // Foundation plinth — solid for every tower.
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD_W + 0.2, 0.4, 1.1),
      new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
    );
    base.position.y = 0;
    base.receiveShadow = true;
    base.castShadow = true;
    group.add(base);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.set(0, -0.5, 0.7);
    label.material.opacity = isOwn ? 1 : 0.8;
    group.add(label);
    // The sliding preview block (only really matters on your own tower).
    const slider = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD_W, BLOCK_H, 1),
      new THREE.MeshLambertMaterial({ color: player.color, transparent: true, opacity: isOwn ? 0.9 : 0.07 })
    );
    slider.castShadow = isOwn;
    group.add(slider);

    const tower = { group, blocks: [], slider, label, x, color: player.color };
    this.towers.set(player.id, tower);
    return tower;
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
    let topHeight = 0;

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const tower = this.ensureTower(player, index, players.length);

      // Reconcile placed blocks up to the server height. Placed blocks are
      // solid for every tower; only the sliding preview block of rivals is
      // faded (see the slider below).
      const isOwn = player.id === controlledId;
      while (tower.blocks.length < (entry.height || 0)) {
        const level = tower.blocks.length;
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.1, entry.width * WORLD_W), BLOCK_H, 1),
          new THREE.MeshLambertMaterial({
            color: tower.color,
            emissive: tower.color,
            emissiveIntensity: isOwn ? (level % 2 ? 0.12 : 0.04) : 0
          })
        );
        block.position.set(entry.offset * WORLD_W, BASE_Y + 0.2 + level * BLOCK_H, 0);
        block.castShadow = true;
        block.receiveShadow = true;
        tower.group.add(block);
        tower.blocks.push(block);
      }
      const height = tower.blocks.length;
      topHeight = Math.max(topHeight, height);

      // Grow/topple feedback.
      if (height > (this.lastHeight.get(player.id) || 0)) {
        this.lastHeight.set(player.id, height);
        const top = tower.blocks[height - 1];
        const topPos = top.getWorldPosition(new THREE.Vector3());
        const perfect = entry.flash === "good";
        this.bursts.spawn(topPos, [tower.color, "#ffffff"], {
          count: perfect ? 10 : 5,
          speed: perfect ? 1.7 : 1.2,
          up: perfect ? 1.6 : 1.2,
          size: 0.06,
          life: 0.45,
          drag: 2.2,
          fadePow: 1.6
        });
        if (perfect) {
          this.bursts.ring(topPos, "#fff2b0", { radius: 1.2, life: 0.5, opacity: 0.6, tilt: null });
          this.floaters.pop(topPos.clone().add(new THREE.Vector3(0, 0.35, 0)), "PERFEKT!", { color: "#ffe36b", size: 0.42 });
        } else {
          this.floaters.pop(topPos.clone().add(new THREE.Vector3(0, 0.3, 0)), "+1", { color: "#ffffff", size: 0.34, life: 0.7, rise: 0.7 });
        }
        if (player.id === controlledId) {
          this.feedback?.sound(perfect ? "perfect" : "pop", { pan: tower.x * 0.25 });
          this.feedback?.vibrate(perfect ? [8, 20, 12] : 8);
        }
      }
      // Sealed tower (a miss or a full stack): plant a little flag on top as
      // the end marker — the tower never falls over.
      const capped = entry.toppled || height >= arcade.total;
      if (capped && !this.lastToppled.get(player.id)) {
        this.lastToppled.set(player.id, true);
        const top = tower.blocks[height - 1];
        if (top) {
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), new THREE.MeshLambertMaterial({ color: "#5a4a3a" }));
          pole.position.set(top.position.x, top.position.y + BLOCK_H / 2 + 0.3, 0);
          tower.group.add(pole);
          const flag = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.05), new THREE.MeshLambertMaterial({ color: tower.color, emissive: tower.color, emissiveIntensity: 0.2 }));
          flag.position.set(top.position.x + 0.24, top.position.y + BLOCK_H / 2 + 0.42, 0);
          tower.group.add(flag);
          const topPos = top.getWorldPosition(new THREE.Vector3());
          const complete = !entry.toppled || height >= arcade.total;
          this.bursts.spawn(topPos, [tower.color, "#ffffff", "#ffe36b"], {
            count: complete ? 16 : 8,
            speed: complete ? 2.2 : 1.6,
            up: complete ? 2.2 : 1.8,
            size: 0.08,
            life: 0.7,
            drag: 1.6
          });
          this.bursts.ring(topPos, complete ? "#ffe36b" : "#ffffff", { radius: complete ? 2 : 1.3, life: 0.6, opacity: 0.6, tilt: null });
          this.floaters.pop(topPos.clone().add(new THREE.Vector3(0, 0.5, 0)), complete ? "🏆" : "🚩", { size: complete ? 0.6 : 0.42, life: 1.1, rise: 1.1 });
        }
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 0.6);
          this.feedback?.sound(entry.toppled && height < arcade.total ? "pop" : "win");
          this.feedback?.vibrate(entry.toppled && height < arcade.total ? 12 : [20, 20, 40]);
        }
      }

      // The sliding preview block sits one level above the tower.
      const active = !capped && !minigame.finaleAt;
      tower.slider.visible = active;
      if (active) {
        const speed = 1.1 + height * 0.06;
        const swing = Math.sin(elapsed / 1000 * speed + (entry.phase || 0) * Math.PI * 2);
        const blockCentre = swing * (0.85 - height * 0.01);
        tower.slider.geometry.dispose();
        tower.slider.geometry = new THREE.BoxGeometry(Math.max(0.1, entry.width * WORLD_W), BLOCK_H, 1);
        tower.slider.position.set(blockCentre * (SLIDE_W / 0.85), BASE_Y + 0.2 + height * BLOCK_H, 0);
      }

      tower.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    // Camera rises smoothly with the tallest tower (a damped height avoids the
    // jump when a block lands).
    this.shake *= frameDecay(0.9, dt);
    this.smoothTop = THREE.MathUtils.lerp(this.smoothTop ?? topHeight, topHeight, Math.min(1, dt * 4));
    const focusY = 1.3 + this.smoothTop * BLOCK_H * 0.5;
    // Bias slightly toward the own tower so it's never cut off, while all four
    // stay in frame.
    const ownX = (this.towers.get(controlledId)?.x || 0) * 0.3;
    const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
    const desired = new THREE.Vector3(ownX + shakeX, (this.baseCamY || 2.6) + this.smoothTop * BLOCK_H * 0.45, this.baseCamZ || 8);
    this.camera.position.lerp(desired, frameLerp(0.12, dt));
    this.camera.lookAt(ownX, focusY, 0);

    // Arrow over your own tower so you always know which one is yours.
    const ownTower = this.towers.get(controlledId);
    if (ownTower) {
      if (!this.ownMarker) { this.ownMarker = createOwnMarker(); this.scene.add(this.ownMarker); }
      const oh = arcade.players[controlledId]?.height || 0;
      this.ownMarker.visible = true;
      this.ownMarker.position.set(ownTower.x, 0, 0);
      updateOwnMarker(this.ownMarker, now, BASE_Y + 0.2 + oh * BLOCK_H + 0.5);
    }

    this.updateHud(minigame, arcade, state, now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.height || 0);

    const banner = this.hud.querySelector("[data-stack-banner]");
    if (banner) {
      if ((own?.height || 0) >= arcade.total) {
        banner.hidden = false;
        banner.textContent = "Turm komplett! 🏆";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if (own?.toppled) {
        banner.hidden = false;
        banner.textContent = "Turm gesetzt 🚩";
        banner.style.background = "#12aaff";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.dropButton) this.dropButton.disabled = Boolean(own?.toppled || (own?.height || 0) >= arcade.total || minigame.finaleAt);
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 2.7 : 2.6;
      this.baseCamZ = portrait ? 10.5 : 8.5;
      camera.fov = portrait ? 58 : 48;
    });
  }
}
