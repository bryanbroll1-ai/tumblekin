import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  createCloud,
  disposeScene
} from "./VoxelKit.js?v=tumblekin63";

// Blob-Klopfe — blobs pop out of a 3x3 field of holes. Tap the matching
// grid button fast; the spiky red ones bite back.
const CELL = 1.35;

export class WhackBlob {
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
    this.blobs = new Map();
    this.lastHits = new Map();
    this.lastBad = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.canvas.hidden = true;
    this.webglCanvas = document.createElement("canvas");
    this.webglCanvas.className = `${this.canvas.className} kinetic-webgl`;
    this.webglCanvas.setAttribute("aria-label", "3D Blob-Klopfe");
    this.canvas.insertAdjacentElement("afterend", this.webglCanvas);

    this.hud = document.createElement("div");
    this.hud.className = "kinetic-hud";
    this.hud.innerHTML = `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
    `;
    this.webglCanvas.insertAdjacentElement("afterend", this.hud);
    this.createScene();

    // No button pad — you simply tap the holes on the 3D field directly.
    this.controls.innerHTML = "";
    this.raycaster = new THREE.Raycaster();
    this.onCanvasWhack = (event) => {
      event.preventDefault();
      const cell = this.cellFromPointer(event);
      if (cell >= 0) this.sendWhack(cell);
    };
    this.webglCanvas.addEventListener("pointerdown", this.onCanvasWhack);
    this.loop();
  }

  cellFromPointer(event) {
    if (!this.camera || !this.cellPlane) return -1;
    const rect = this.webglCanvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.cellPlane)[0];
    if (!hit) return -1;
    // Map the hit point on the field back to a 0..8 grid cell.
    const gx = Math.round(hit.point.x / CELL) + 1;
    const gy = Math.round(hit.point.z / CELL) + 1;
    if (gx < 0 || gx > 2 || gy < 0 || gy > 2) return -1;
    return gy * 3 + gx;
  }

  sendWhack(cell) {
    this.feedback?.vibrate(8);
    this.sendInput({ action: "whack", cell }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    if (this.onCanvasWhack) this.webglCanvas.removeEventListener("pointerdown", this.onCanvasWhack);
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
    this.blobs.clear();
  }

  cellPos(cell) {
    const gx = cell % 3;
    const gy = Math.floor(cell / 3);
    return { x: (gx - 1) * CELL, z: (gy - 1) * CELL };
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#9adcf2");
    this.scene.fog = new THREE.Fog("#a8e2f4", 16, 40);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.webglCanvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x7ab890, 2.3));
    const sun = new THREE.DirectionalLight(0xfff2cf, 3.0);
    sun.position.set(-4, 11, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    this.scene.add(sun);

    // Grass mound with nine dark holes.
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    this.scene.add(meadow);
    const mound = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * 3 + 0.9, 0.4, CELL * 3 + 0.9),
      new THREE.MeshLambertMaterial({ color: "#8ad07f" })
    );
    mound.position.y = 0.1;
    mound.receiveShadow = true;
    this.scene.add(mound);
    // Invisible pick plane spanning the 3x3 field for direct hole taps.
    this.cellPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * 3 + 0.6, CELL * 3 + 0.6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.cellPlane.rotation.x = -Math.PI / 2;
    this.cellPlane.position.y = 0.34;
    this.scene.add(this.cellPlane);
    for (let cell = 0; cell < 9; cell += 1) {
      const pos = this.cellPos(cell);
      const hole = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.1, 0.85),
        new THREE.MeshLambertMaterial({ color: "#2f2418" })
      );
      hole.position.set(pos.x, 0.32, pos.z);
      this.scene.add(hole);
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(1.02, 0.08, 1.02),
        new THREE.MeshLambertMaterial({ color: "#6bbf5e" })
      );
      rim.position.set(pos.x, 0.3, pos.z);
      this.scene.add(rim);
    }

    // A picket fence and flowers frame the field so it doesn't float in
    // empty green.
    const fenceMat = new THREE.MeshLambertMaterial({ color: "#e8d8b0" });
    for (let i = -4; i <= 4; i += 1) {
      [-3.4, 3.4].forEach((z) => {
        const picket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.12), fenceMat);
        picket.position.set(i * 0.85, 0.28, z);
        this.scene.add(picket);
      });
      const rail = i < 4 ? null : new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.1, 0.08), fenceMat);
      if (rail) {
        [-3.4, 3.4].forEach((z) => {
          const bar = rail.clone();
          bar.position.set(0, 0.44, z);
          this.scene.add(bar);
        });
      }
    }
    const flowerColors = ["#ff8aa0", "#ffd15c", "#8f6ae0", "#5c9dff"];
    [[-3.4, -2.2], [3.5, -1.4], [-3.6, 1.8], [3.3, 2.4], [-2.6, 3.1], [2.4, -3.1]].forEach(([x, z], index) => {
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), new THREE.MeshLambertMaterial({ color: "#4f9b4a" }));
      stem.position.set(x, 0.15, z);
      this.scene.add(stem);
      const bloom = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshLambertMaterial({ color: flowerColors[index % flowerColors.length] })
      );
      bloom.position.set(x, 0.36, z);
      this.scene.add(bloom);
    });

    [[-6, 5, -4, 5], [6, 5.6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    // A cartoon mallet that swings down on the blob you bonk.
    this.hammer = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 1.1, 0.14),
      new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
    );
    handle.position.y = 0.55;
    this.hammer.add(handle);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.5, 0.5),
      new THREE.MeshLambertMaterial({ color: "#e04a58" })
    );
    head.position.y = 1.15;
    this.hammer.add(head);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.14, 0.54),
      new THREE.MeshLambertMaterial({ color: "#ffffff" })
    );
    band.position.y = 1.15;
    this.hammer.add(band);
    this.hammer.visible = false;
    this.scene.add(this.hammer);
    this.hammerHit = null;   // { cell, startedAt }

    this.bursts = new CubeBurst(this.scene);
    this.resizeRenderer();
    this.camera.position.set(0, this.baseCamY || 5.2, this.baseCamZ || 7);
    this.camera.lookAt(0, 0.2, -0.4);
  }

  // A cheeky blob: round body, eyes; spiky red ones get thorns.
  buildBlob(kind) {
    const blob = new THREE.Group();
    const color = kind === "bad" ? "#ff2038" : "#8f6ae0";
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.6, 0.62),
      new THREE.MeshLambertMaterial({ color })
    );
    body.castShadow = true;
    blob.add(body);
    [[-0.14, 0.1], [0.14, 0.1]].forEach(([x, y]) => {
      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.12, 0.05),
        new THREE.MeshLambertMaterial({ color: "#1b2530" })
      );
      eye.position.set(x, y, 0.33);
      blob.add(eye);
    });
    if (kind === "bad") {
      [[0, 0.42, 0], [-0.25, 0.36, 0], [0.25, 0.36, 0]].forEach(([x, y, z]) => {
        const spike = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.24, 0.12),
          new THREE.MeshLambertMaterial({ color: "#8a0f1e" })
        );
        spike.position.set(x, y, z);
        blob.add(spike);
      });
    }
    return blob;
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
    const own = arcade.players[controlledId];

    // Blobs rise and sink according to the shared schedule; the ones the own
    // player already whacked collapse instantly.
    const active = new Set();
    (arcade.pops || []).forEach((pop) => {
      if (elapsed < pop.from - 100 || elapsed > pop.until + 150) return;
      active.add(pop.id);
      let blob = this.blobs.get(pop.id);
      if (!blob) {
        blob = this.buildBlob(pop.kind);
        const pos = this.cellPos(pop.cell);
        blob.position.set(pos.x, -0.3, pos.z);
        blob.userData = { hitShown: false };
        this.scene.add(blob);
        this.blobs.set(pop.id, blob);
      }
      const upTime = Math.min(1, Math.max(0, (elapsed - pop.from) / 160));
      const downTime = Math.min(1, Math.max(0, (elapsed - (pop.until - 200)) / 200));
      const whackedByMe = Boolean(own?.hitPopIds?.[pop.id]);
      if (whackedByMe && !blob.userData.hitShown) {
        blob.userData.hitShown = true;
        const pos = this.cellPos(pop.cell);
        this.bursts.spawn(new THREE.Vector3(pos.x, 0.9, pos.z), pop.kind === "bad" ? ["#ff2038", "#8a0f1e"] : ["#8f6ae0", "#ffd15c", "#ffffff"], { count: 10, speed: 2, up: 2, size: 0.08, life: 0.6 });
        // Swing the mallet down on this cell.
        this.hammerHit = { cell: pop.cell, startedAt: now };
      }
      const squash = whackedByMe ? 0.15 : 1;
      const height = (upTime - downTime) * 0.95;
      blob.position.y = -0.35 + Math.max(0, height) * squash;
      blob.scale.y = whackedByMe ? 0.3 : (1 + Math.sin(now / 140 + pop.id) * 0.05);
      blob.rotation.y = Math.sin(now / 400 + pop.id * 2) * 0.3;
    });
    this.blobs.forEach((blob, id) => {
      if (active.has(id)) return;
      this.scene.remove(blob);
      this.blobs.delete(id);
    });

    // Own hit feedback (sound/vibration + shake on bad).
    if ((own?.hits || 0) > (this.lastHits.get(controlledId) || 0)) {
      this.lastHits.set(controlledId, own.hits);
      this.feedback?.sound("pop");
      this.feedback?.vibrate(10);
    }
    if ((own?.badHits || 0) > (this.lastBad.get(controlledId) || 0)) {
      this.lastBad.set(controlledId, own.badHits);
      this.shake = Math.max(this.shake, 0.7);
      this.feedback?.sound("error");
      this.feedback?.vibrate([22, 16, 28]);
    }

    // Mallet swing: rear back, slam down at ~110ms, then lift and vanish.
    if (this.hammerHit) {
      const age = now - this.hammerHit.startedAt;
      const life = 320;
      if (age > life) {
        this.hammer.visible = false;
        this.hammerHit = null;
      } else {
        const pos = this.cellPos(this.hammerHit.cell);
        this.hammer.visible = true;
        this.hammer.position.set(pos.x + 0.35, 0.3, pos.z + 0.3);
        const t = age / life;
        // 0→0.35 wind up (tilted back), 0.35→0.5 slam, then recover.
        const swing = t < 0.4 ? -1.1 + t / 0.4 * 0.2 : (t < 0.55 ? -0.9 + (t - 0.4) / 0.15 * 1.5 : 0.6 - (t - 0.55) / 0.45 * 1.7);
        this.hammer.rotation.z = swing;
        if (age > 110 && !this.hammerHit.thumped) {
          this.hammerHit.thumped = true;
          this.shake = Math.max(this.shake, 0.4);
        }
      }
    }

    this.bursts.update(dt);

    this.shake *= 0.9;
    const shakeX = Math.sin(now / 15) * this.shake * 0.2;
    const desired = new THREE.Vector3(shakeX, this.baseCamY || 5.2, this.baseCamZ || 7);
    this.camera.position.lerp(desired, 0.1);
    this.camera.lookAt(0, 0.2, -0.4);

    this.updateHud(minigame, arcade, state, now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.hits || 0);
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
    this.baseCamY = portrait ? 5.8 : 5.2;
    this.baseCamZ = portrait ? 7.6 : 7;
    this.camera.fov = portrait ? 54 : 48;
    this.camera.updateProjectionMatrix();
  }
}
