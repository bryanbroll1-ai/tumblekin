import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin92";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin92";
import { frameDecay, frameLerp, fxScale, shakeScale } from "./Quality.js?v=tumblekin92";

// Eisstock — drei Steine je Person, gewischt auf ein Ringziel. Länge des Wisches
// ist Kraft, Richtung ist Richtung. Fremde Steine darf man wegrempeln, und genau
// das ist der Reiz: der letzte Stein einer Runde entscheidet oft alles.
//
// Der Blick liegt flach über die Bahn, nicht von oben. Von oben läge das Ziel
// als Scheibe im Bild und man sähe die Entfernung nicht — und Entfernung ist
// hier die ganze Aufgabe.
const SHEET_W = 4.2;
const SHEET_LEN = 9.5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class IceStock {
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
    this.stoneMeshes = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.drag = null;
    this.lastClacks = 0;
  }

  // Logikraum (x 0…1 quer, y 0…sheetY längs) auf Weltkoordinaten. Eine einzige
  // Umrechnung, damit gezeichnete und gerechnete Position nie auseinanderlaufen.
  worldX(x) { return (x - 0.5) * SHEET_W; }
  worldZ(y, sheetY) { return SHEET_LEN / 2 - (y / sheetY) * SHEET_LEN; }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Eisstock", background: "#bfe6f7", fog: ["#dff2fb", 20, 56], fov: 54, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="stock-left" data-stock-left>3 Steine</div>
      <div class="stock-chips" data-stock-chips></div>
      <div class="color-banner stock-banner" data-stock-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `<p class="trace-hint">Nach vorne wischen — länger heisst weiter</p>`;
    this.controls.style.pointerEvents = "none";
    this.bindDrag();
    this.loop();
  }

  bindDrag() {
    this.onDown = (event) => {
      event.preventDefault();
      this.drag = { x: event.clientX, y: event.clientY };
    };
    this.onMove = (event) => {
      if (!this.drag) return;
      this.drag.cx = event.clientX;
      this.drag.cy = event.clientY;
    };
    this.onUp = (event) => {
      if (!this.drag) return;
      const rect = this.webglCanvas.getBoundingClientRect();
      const dx = (event.clientX - this.drag.x) / Math.max(1, rect.width);
      // Nach OBEN wischen heisst nach vorne schieben — deshalb das Vorzeichen.
      // Die Höhe des Bildes ist der Massstab, nicht die Breite: der Wisch geht
      // im Wesentlichen längs.
      const dy = (event.clientY - this.drag.y) / Math.max(1, rect.height);
      this.drag = null;
      const power = Math.hypot(dx, dy);
      if (power < 0.05) return;
      // Kraft aus der Wischlänge, gedeckelt. 55 % der Bildhöhe sind volle Kraft
      // — mehr schafft ein Daumen in einer Bewegung ohnehin nicht.
      const scale = Math.min(1, power / 0.55) / Math.max(1e-6, power);
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(12);
      this.sendInput({ action: "flick", dx: clamp(dx * scale * 2.2, -1, 1), dy: clamp(dy * scale * 2.2, -1, 0.1) }).catch(() => {});
    };
    this.onCancel = () => { this.drag = null; };

    this.webglCanvas.addEventListener("pointerdown", this.onDown);
    this.webglCanvas.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    this.webglCanvas?.removeEventListener("pointerdown", this.onDown);
    this.webglCanvas?.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    teardownStage(this);
    this.stoneMeshes.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-4, 12, 6],
      shadow: { left: -5, right: 5, top: 8, bottom: -8 }
    });

    const arcade = this.minigame.arcade;
    const sheetY = arcade.sheetY || 1.3;

    const snow = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 22),
      new THREE.MeshLambertMaterial({ color: "#eaf6fd" })
    );
    snow.position.y = -0.25;
    snow.receiveShadow = true;
    this.scene.add(snow);

    const ice = new THREE.Mesh(
      new THREE.BoxGeometry(SHEET_W, 0.06, SHEET_LEN),
      new THREE.MeshLambertMaterial({ color: "#cfeaf8" })
    );
    ice.position.set(0, 0.02, 0);
    ice.receiveShadow = true;
    this.scene.add(ice);

    [-1, 1].forEach((side) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.22, SHEET_LEN),
        new THREE.MeshLambertMaterial({ color: "#8fb6cc" })
      );
      rail.position.set(side * (SHEET_W / 2 + 0.07), 0.11, 0);
      this.scene.add(rail);
    });

    // Das Haus: konzentrische Ringe. Die Farben sind die Punktwerte — von aussen
    // nach innen wird es heller, damit man den Wert sieht statt ihn zu lernen.
    const shades = ["#8fb6cc", "#4bb8ff", "#ffffff", "#ff5d73"];
    const rings = [...(arcade.rings || [])].sort((a, b) => b.radius - a.radius);
    rings.forEach((ring, index) => {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry((ring.radius / 1) * SHEET_W, 32),
        new THREE.MeshBasicMaterial({ color: shades[index % shades.length], toneMapped: false })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(this.worldX(arcade.house.x), 0.06 + index * 0.004, this.worldZ(arcade.house.y, sheetY));
      this.scene.add(disc);
    });

    // Abwurflinie: von hier starten alle Steine.
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(SHEET_W, 0.02, 0.1),
      new THREE.MeshBasicMaterial({ color: "#7b98ad", transparent: true, opacity: 0.9, depthWrite: false })
    );
    line.position.set(0, 0.07, this.worldZ(sheetY - 0.14, sheetY));
    this.scene.add(line);

    [[-7.4, 5.6, -9, 6], [7.0, 6.2, -11, 1]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildThrower(sheetY);
    this.resizeRenderer();
    this.camera.position.set(0, 3.4, 7.4);
    this.camera.lookAt(0, 0.2, -1.4);
  }

  buildThrower(sheetY) {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId()) || state?.players?.[0];
    const entry = this.minigame.arcade.players[me?.id];
    const x = this.worldX(entry?.startX ?? 0.5);
    const z = this.worldZ(sheetY, sheetY) + 0.9;
    const kin = createVoxelKin(me?.color || "#ff5d73", 0);
    kin.scale.setScalar(0.85);
    const label = createNameLabel("du", me?.color || "#ff5d73");
    label.position.y = 0.72;
    kin.add(label);
    kin.position.set(x, 0, z);
    this.scene.add(kin);
    const shadow = createShadowBlob(0.45);
    shadow.position.set(x, 0.08, z);
    this.scene.add(shadow);
    this.thrower = kin;
    this.throwerAnimator = new KinAnimator(kin);
    this.throwerAnimator.groundY = 0;
  }

  ensureStone(stone, colour) {
    if (this.stoneMeshes.has(stone.id)) return this.stoneMeshes.get(stone.id);
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.24, 0.16, 16),
      new THREE.MeshLambertMaterial({ color: "#5e6b78" })
    );
    body.position.y = 0.08;
    body.castShadow = true;
    group.add(body);
    // Der Griff trägt die Spielerfarbe — der Stein selbst bleibt Granit, sonst
    // sieht das Haus aus wie ein Farbklecks.
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.035, 6, 14),
      new THREE.MeshLambertMaterial({ color: colour })
    );
    handle.position.y = 0.2;
    handle.rotation.x = Math.PI / 2;
    group.add(handle);
    this.scene.add(group);
    const visual = { group, body, handle };
    this.stoneMeshes.set(stone.id, visual);
    return visual;
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
    const own = arcade.players[controlledId];
    const sheetY = arcade.sheetY || 1.3;
    const colourOf = (id) => state.players.find((player) => player.id === id)?.color || "#ffffff";

    const alive = new Set();
    (arcade.stones || []).forEach((stone) => {
      alive.add(stone.id);
      const visual = this.ensureStone(stone, colourOf(stone.playerId));
      visual.group.position.set(this.worldX(stone.x), 0, this.worldZ(stone.y, sheetY));
      visual.group.rotation.y += dt * Math.hypot(stone.vx, stone.vy) * 2.4;
      visual.handle.material.color.set(colourOf(stone.playerId));
    });
    this.stoneMeshes.forEach((visual, id) => {
      if (alive.has(id)) return;
      this.scene.remove(visual.group);
      this.stoneMeshes.delete(id);
    });

    // Rempler hörbar machen: sie sind der Grund, warum der letzte Stein zählt.
    if ((arcade.clacks || 0) > this.lastClacks) {
      this.lastClacks = arcade.clacks;
      this.feedback?.sound("clack");
      this.feedback?.vibrate(10);
      this.shake = Math.max(this.shake, 0.2);
    }

    if (minigame.finaleAt) {
      applyFinaleMood(this.throwerAnimator, this.finalePlace(arcade, state), state.players.length);
    } else {
      this.throwerAnimator.set((own?.stonesLeft || 0) > 0 ? "idle" : "cheer", { base: true });
    }
    this.throwerAnimator.update(now);

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.86, dt);
    const shakeX = Math.sin(now / 12) * this.shake * 0.16 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * frameLerp(0.4, dt);
    this.camera.position.y = this.baseCamY || 3.4;
    this.camera.position.z = this.baseCamZ || 7.4;
    this.camera.lookAt(0, 0.2, -1.4);

    this.updateHud(minigame, arcade, state, now, own);
    this.renderer.render(this.scene, this.camera);
  }

  finalePlace(arcade, state) {
    const scored = state.players
      .map((player) => ({ id: player.id, score: arcade.players[player.id]?.score || 0 }))
      .sort((a, b) => b.score - a.score);
    const index = scored.findIndex((entry) => entry.id === this.getControlledPlayerId());
    return index < 0 ? state.players.length : index + 1;
  }

  updateHud(minigame, arcade, state, now, own) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.max(0, Math.round(own?.score || 0)));

    const left = this.hud.querySelector("[data-stock-left]");
    if (left) {
      const count = own?.stonesLeft ?? 0;
      left.textContent = count === 1 ? "1 Stein" : `${count} Steine`;
    }

    const chips = this.hud.querySelector("[data-stock-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="stock-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.max(0, Math.round(entry?.score || 0))}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-stock-banner]");
    if (!banner) return;
    if ((own?.stonesLeft ?? 0) <= 0) {
      banner.hidden = false;
      banner.textContent = "Alle Steine draussen — jetzt zählt, was liegen bleibt";
      banner.style.background = "#4bb8ff";
      banner.style.color = "#0d2b3a";
    } else if ((own?.stonesLeft ?? 0) === 1) {
      banner.hidden = false;
      banner.textContent = "Letzter Stein!";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Flach über die Bahn: die Entfernung zum Haus ist die ganze Aufgabe, und
      // von oben gesehen wäre sie nicht mehr ablesbar.
      this.baseCamY = portrait ? 3.4 : 3.0;
      this.baseCamZ = portrait ? 7.4 : 8.6;
      camera.fov = portrait ? 54 : 44;
    });
  }
}
