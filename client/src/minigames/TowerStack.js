import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Turmbau: über dem eigenen Turm pendelt der nächste Block, ein Tipp lässt ihn
// fallen. Was übersteht, wird abgeschnitten — wer am höchsten baut, gewinnt.
//
// Vorher gab es gar keine Figuren, nur Türme und Namensschilder. Jetzt steht
// auf jedem Turm sein Baumeister. Der nächste Block hängt am Haken darüber;
// fällt er, springt die Figur auf den neuen Block, jubelt bei einem perfekten
// Treffer und steckt am Ende ihre Fahne auf.
const COL_GAP = 1.5;
const BLOCK_H = 0.46;
const BASE_Y = 0.2;
const WORLD_W = 1.35;
const SLIDE_W = 1.15;
const HOVER = 1.55;
const DROP_MS = 200;

export class TowerStack extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.towers = new Map();
    this.lastHeight = new Map();
    this.lastToppled = new Map();
    this.labelY = 0.74;
    this.smoothTop = 0;
  }

  stage() {
    return {
      label: "3D Turmbau",
      background: "#a8e2f4",
      fog: ["#a8e2f4", 20, 46],
      lights: { sunPosition: [-4, 12, 6], shadow: { top: 12, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-stack-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(44, 0.5, 40),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    scene.add(ground);

    // Kulisse statt leerer Wiese: Büschel, Blumen, Steine und ein Baumkranz,
    // der dem Bild einen Horizont gibt. Freigehalten wird der Streifen mit den
    // vier Türmen.
    dressMeadow(this.scene, { seed: 14, keepOut: { x: 4.2, z: 2.6 }, spread: { x: 16, z: 14 }, grassColor: "#6cb95c", patchColors: ["#74c465", "#8ad97a"], crownColor: "#4a9c4e", crownColor2: "#6ab857", crownShape: "blob" });

    [[-7, 5.4, -4, 5], [7, 6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addTower(player, index, players.length));
  }

  columnX(index, count) {
    return (index - (count - 1) / 2) * COL_GAP;
  }

  levelTop(level) {
    return BASE_Y + 0.2 + level * BLOCK_H - BLOCK_H / 2;
  }

  addTower(player, index, count) {
    const x = this.columnX(index, count);
    const group = new THREE.Group();
    group.position.x = x;
    this.scene.add(group);
    const base = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W, 0.4, 1.1), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
    base.receiveShadow = true;
    base.castShadow = true;
    group.add(base);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W + 0.06, 0.1, 1.16), new THREE.MeshLambertMaterial({ color: player.color }));
    stripe.position.y = 0.2;
    group.add(stripe);
    // Der Haken, an dem der nächste Block hängt.
    const hook = new THREE.Group();
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), new THREE.MeshLambertMaterial({ color: "#5a4a3a" }));
    rope.position.y = BLOCK_H / 2 + 0.5;
    hook.add(rope);
    const slider = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W, BLOCK_H, 1), new THREE.MeshLambertMaterial({ color: player.color, transparent: true, opacity: 0.92 }));
    slider.castShadow = true;
    hook.add(slider);
    group.add(hook);
    // Der Baumeister oben drauf.
    this.addKin(player, index, { x, ground: BASE_Y + 0.2, z: 0.1, facing: 0, scale: 0.9 });
    this.towers.set(player.id, { group, blocks: [], hook, slider, x, color: player.color, dropping: null, flagged: false });
  }

  shot() {
    const count = Math.max(1, this.towers.size);
    return {
      look: [0, 1.4, 0],
      frame: { w: count * COL_GAP + 1.2, h: 3.4 },
      pitch: 0.16,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-stack-drop>
        <span class="nerve-button-face">SETZEN!</span>
      </button>`;
    this.dropButton = this.controls.querySelector("[data-stack-drop]");
    const press = (event) => {
      event.preventDefault();
      this.pressDrop();
    };
    this.on(this.dropButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  unbind() {
    this.towers.clear();
  }

  pressDrop() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.toppled || own.height >= arcade.total) return;
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "drop" }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    let topHeight = 0;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const tower = this.towers.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !tower || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      // Neue Blöcke fallen vom Haken, die Figur springt hinauf.
      while (tower.blocks.length < (entry.height || 0)) {
        const level = tower.blocks.length;
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.1, entry.width * WORLD_W), BLOCK_H, 1),
          new THREE.MeshLambertMaterial({ color: tower.color, emissive: tower.color, emissiveIntensity: level % 2 ? 0.1 : 0.03 })
        );
        const restY = BASE_Y + 0.2 + level * BLOCK_H;
        block.position.set(entry.offset * WORLD_W, restY, 0);
        block.castShadow = true;
        block.receiveShadow = true;
        tower.group.add(block);
        tower.blocks.push(block);
        tower.dropping = { block, from: tower.hook.position.y, to: restY, at: now };
        animator.trigger("jump");
      }
      if (tower.dropping) {
        const u = Math.min(1, (now - tower.dropping.at) / DROP_MS);
        tower.dropping.block.position.y = THREE.MathUtils.lerp(tower.dropping.from, tower.dropping.to, u * u);
        if (u >= 1) tower.dropping = null;
      }
      const height = tower.blocks.length;
      topHeight = Math.max(topHeight, height);
      if (height > (this.lastHeight.get(player.id) || 0)) {
        this.lastHeight.set(player.id, height);
        const top = tower.blocks[height - 1];
        const topPos = top.getWorldPosition(new THREE.Vector3());
        topPos.y = BASE_Y + 0.2 + (height - 1) * BLOCK_H;
        const perfect = entry.flash === "good";
        this.burst(topPos, [tower.color, "#ffffff"], { count: perfect ? 10 : 5, speed: perfect ? 1.7 : 1.2, up: perfect ? 1.6 : 1.2, size: 0.06, life: 0.45, drag: 2.2, fadePow: 1.6 });
        if (perfect) {
          animator.trigger("fistpump");
          animator.expression("joy", 700);
          this.bursts.ring(topPos, "#fff2b0", { radius: 1.2, life: 0.5, opacity: 0.6, tilt: null });
          this.pop(topPos.clone().add(new THREE.Vector3(0, 1.1, 0)), "PERFEKT!", { color: "#ffe36b", size: 0.4 });
        } else {
          animator.expression("effort", 500);
        }
        if (isOwn) {
          this.feedback?.sound(perfect ? "perfect" : "pop", { pan: tower.x * 0.25 });
          this.feedback?.vibrate(perfect ? [8, 20, 12] : 8);
        }
      }
      // Die Figur steht auf dem obersten Block, mittig darüber.
      const top = tower.blocks[height - 1];
      const standY = height ? BASE_Y + 0.2 + (height - 1) * BLOCK_H + BLOCK_H / 2 : BASE_Y + 0.2;
      animator.groundY = standY + 0.3 * 0.9;
      const topX = tower.x + (top ? top.position.x : 0);
      kin.position.x += (topX - kin.position.x) * frameLerp(0.3, dt);

      const capped = entry.toppled || height >= arcade.total;
      if (capped && !this.lastToppled.get(player.id)) {
        this.lastToppled.set(player.id, true);
        const complete = !entry.toppled || height >= arcade.total;
        if (top) {
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), new THREE.MeshLambertMaterial({ color: "#5a4a3a" }));
          pole.position.set(top.position.x + 0.42, top.position.y + BLOCK_H / 2 + 0.4, -0.2);
          tower.group.add(pole);
          const flag = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.05), new THREE.MeshLambertMaterial({ color: tower.color, emissive: tower.color, emissiveIntensity: 0.2 }));
          flag.position.set(top.position.x + 0.66, top.position.y + BLOCK_H / 2 + 0.66, -0.2);
          tower.group.add(flag);
          this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), complete ? "🏆" : "🚩", { size: complete ? 0.6 : 0.42, life: 1.1, rise: 1.1 });
        }
        animator.trigger(complete ? "celebrate" : "wave");
        if (isOwn) {
          this.rig.shake(0.5);
          this.feedback?.sound(entry.toppled && height < arcade.total ? "pop" : "win");
          this.feedback?.vibrate(entry.toppled && height < arcade.total ? 12 : [20, 20, 40]);
        }
      }
      // Der Haken pendelt über der Figur.
      const active = !capped && !finale;
      tower.hook.visible = active;
      if (active) {
        const speed = 1.1 + height * 0.06;
        const swing = Math.sin((elapsed / 1000) * speed + (entry.phase || 0) * Math.PI * 2);
        const blockCentre = swing * (0.85 - height * 0.01);
        tower.slider.geometry.dispose();
        tower.slider.geometry = new THREE.BoxGeometry(Math.max(0.1, entry.width * WORLD_W), BLOCK_H, 1);
        tower.hook.position.set(blockCentre * (SLIDE_W / 0.85), standY + HOVER, 0);
        tower.slider.material.opacity = isOwn ? 0.95 : 0.55;
      }
      if (finale) return;
      animator.lookAt(active ? tower.slider.getWorldPosition(new THREE.Vector3()) : null);
      animator.set(capped ? "happy" : "ready");
    });
    this.smoothTop += (topHeight - this.smoothTop) * frameLerp(0.08, dt);
  }

  rigOptions() {
    const count = Math.max(1, this.towers.size);
    const topY = BASE_Y + this.smoothTop * BLOCK_H;
    return {
      look: [0, topY * 0.55 + 1.0, 0],
      frame: { w: count * COL_GAP + 1.2, h: Math.max(3.4, topY + 2.6) }
    };
  }

  drawHud(f) {
    const { arcade, state, minigame } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.height || 0);
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
}
