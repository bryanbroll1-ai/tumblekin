import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  disposeScene,
  setKinOpacity
} from "./VoxelKit.js?v=tumblekin64";
import { createOwnMarker, updateOwnMarker } from "./VoxelKit.js?v=tumblekin64";

// Zündstoff — hot-potato with a blocky bomb. The fuse length is secret:
// tap to pass the bomb on before it blows. Whoever holds it when it pops
// is out; the last Kin standing wins.
const RING_R = 2.3;
const KIN_Y = 0.62;

export class BombPass {
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
    this.lastOut = new Map();
    this.lastHolderId = null;
    this.lastExplosions = 0;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.finaleDone = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.canvas.hidden = true;
    this.webglCanvas = document.createElement("canvas");
    this.webglCanvas.className = `${this.canvas.className} kinetic-webgl`;
    this.webglCanvas.setAttribute("aria-label", "3D Zündstoff");
    this.canvas.insertAdjacentElement("afterend", this.webglCanvas);

    this.hud = document.createElement("div");
    this.hud.className = "kinetic-hud";
    this.hud.innerHTML = `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-bomb-banner hidden></div>
    `;
    this.webglCanvas.insertAdjacentElement("afterend", this.hud);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="bomb-button" data-bomb-pass>
        <span class="bomb-button-face">WEITERGEBEN</span>
      </button>
    `;
    this.passButton = this.controls.querySelector("[data-bomb-pass]");
    this.onPassDown = (event) => {
      event.preventDefault();
      this.pressPass();
    };
    this.passButton.addEventListener("pointerdown", this.onPassDown);
    this.loop();
  }

  pressPass() {
    const arcade = (this.update || this.minigame)?.arcade;
    const controlledId = this.getControlledPlayerId();
    const own = arcade?.players?.[controlledId];
    if (!own || own.outAt || arcade.holderId !== controlledId) return;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(12);
    this.sendInput({ action: "pass" }).catch(() => {});
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
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#ffd9b8");
    this.scene.fog = new THREE.Fog("#ffe3c4", 16, 40);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.webglCanvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Warm sunset light — it is a tense evening around the campfire circle.
    this.scene.add(new THREE.HemisphereLight(0xffe9cf, 0xa8785a, 2.2));
    const sun = new THREE.DirectionalLight(0xffd9a0, 2.8);
    sun.position.set(-5, 10, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    this.scene.add(sun);

    // Desert-canyon plateau with a stone circle.
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.5, 20),
      new THREE.MeshLambertMaterial({ color: "#e8b077" })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const plateau = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.9, 0.5, 8),
      new THREE.MeshLambertMaterial({ color: "#d89a5e" })
    );
    plateau.position.y = 0.05;
    plateau.receiveShadow = true;
    this.scene.add(plateau);
    // Stone markers around the circle.
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const stone = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.3 + (i % 3) * 0.12, 0.4),
        new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? "#b5793f" : "#c9884a" })
      );
      stone.position.set(Math.cos(angle) * 3.3, 0.35, Math.sin(angle) * 3.3);
      stone.rotation.y = angle;
      stone.castShadow = true;
      this.scene.add(stone);
    }
    // Distant mesas.
    [[-8, 2.2, -7], [8, 3, -6], [0, 2.6, -10]].forEach(([x, h, z], index) => {
      const mesa = new THREE.Mesh(
        new THREE.BoxGeometry(3 + index, h, 2.4),
        new THREE.MeshLambertMaterial({ color: index % 2 === 0 ? "#c9793f" : "#b5642f" })
      );
      mesa.position.set(x, h / 2 - 0.3, z);
      this.scene.add(mesa);
    });
    [[-6, 5, -4, 5], [6, 5.6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    // The bomb: black voxel ball, fuse stub, spark.
    this.bomb = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshLambertMaterial({ color: "#1b2530" })
    );
    core.castShadow = true;
    this.bomb.add(core);
    [[0.28, 0, 0], [-0.28, 0, 0], [0, 0, 0.28], [0, 0, -0.28], [0, -0.28, 0]].forEach(([x, y, z]) => {
      const bulge = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.32, 0.26),
        new THREE.MeshLambertMaterial({ color: "#232f3d" })
      );
      bulge.position.set(x, y, z);
      this.bomb.add(bulge);
    });
    const fuse = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.3, 0.08),
      new THREE.MeshLambertMaterial({ color: "#c9a86a" })
    );
    fuse.position.y = 0.42;
    this.bomb.add(fuse);
    this.spark = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ff8b2e", emissiveIntensity: 1.2 })
    );
    this.spark.position.y = 0.62;
    this.bomb.add(this.spark);

    // A floating timer plate above the bomb: shows the fuse seconds for a
    // moment after each pass, then hides behind a "?" so you must remember it.
    this.timerCanvas = document.createElement("canvas");
    this.timerCanvas.width = 128;
    this.timerCanvas.height = 128;
    this.timerCtx = this.timerCanvas.getContext("2d");
    this.timerTex = new THREE.CanvasTexture(this.timerCanvas);
    this.timerTex.colorSpace = THREE.SRGBColorSpace;
    this.timerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.timerTex, transparent: true, depthTest: false }));
    this.timerSprite.scale.set(0.9, 0.9, 0.9);
    this.timerSprite.position.y = 0.95;
    this.timerLast = null;
    this.bomb.add(this.timerSprite);
    this.scene.add(this.bomb);

    this.bursts = new CubeBurst(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    this.camera.position.set(0, 4.6, 7.8);
    this.camera.lookAt(0, 0.8, 0);
  }

  spotFor(index, count) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2 + Math.PI / 4;
    return { x: Math.cos(angle) * RING_R, z: Math.sin(angle) * RING_R };
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const count = this.getState()?.players?.length || 4;
    const spot = this.spotFor(index, count);
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.userData.spot = spot;
    kin.position.set(spot.x, KIN_Y, spot.z);
    // Face the middle of the circle.
    kin.rotation.y = Math.atan2(-spot.x, -spot.z);
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

    // Explosion moment: the previous holder just went out.
    if ((arcade.explosions || 0) > this.lastExplosions) {
      this.lastExplosions = arcade.explosions;
      this.shake = 1;
      this.feedback?.sound("impact");
      this.feedback?.vibrate([34, 24, 40]);
    }

    // Bomb hovers over the current holder and gets twitchier over time.
    const holderKin = this.kins.get(arcade.holderId);
    const heldFor = Math.max(0, now - (arcade.holderSince || now)) / 1000;
    const nervous = Math.min(1, heldFor / 6);
    if (holderKin) {
      const targetPos = new THREE.Vector3(
        holderKin.position.x + Math.sin(now / (90 - nervous * 40)) * nervous * 0.08,
        holderKin.position.y + 1.45 + Math.sin(now / 260) * 0.06,
        holderKin.position.z + Math.cos(now / (110 - nervous * 40)) * nervous * 0.08
      );
      this.bomb.position.lerp(targetPos, Math.min(1, dt * 9));
      this.bomb.rotation.y = now / 700;
      this.bomb.visible = true;
    } else {
      this.bomb.visible = false;
    }
    // Timer plate: reveal the whole-second fuse briefly, then a "?".
    const revealing = arcade.revealUntil && now < arcade.revealUntil;
    const secsLeft = Math.max(0, Math.ceil((arcade.fuseAt - now) / 1000));
    const text = revealing ? `${secsLeft}s` : "?";
    if (text !== this.timerLast) {
      this.timerLast = text;
      const c = this.timerCtx;
      c.clearRect(0, 0, 128, 128);
      c.fillStyle = revealing ? "rgba(255,32,56,0.92)" : "rgba(20,28,38,0.86)";
      c.beginPath();
      c.arc(64, 64, 56, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 6;
      c.strokeStyle = "#ffffff";
      c.stroke();
      c.fillStyle = "#ffffff";
      c.font = `bold ${revealing ? 44 : 60}px 'Trebuchet MS', sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(text, 64, 70);
      this.timerTex.needsUpdate = true;
    }
    // Only reveal-phase counting needs a per-frame refresh.
    if (revealing) this.timerLast = null;

    // Spark flickers faster the longer the bomb is held.
    this.spark.material.emissiveIntensity = 0.7 + Math.abs(Math.sin(now / (150 - nervous * 90))) * (0.8 + nervous);
    if (Math.random() < 0.25) {
      this.bursts.spawn(this.bomb.position.clone().add(new THREE.Vector3(0, 0.35, 0)), ["#ffd15c", "#ff8b2e"], { count: 1, speed: 0.5, up: 0.5, size: 0.04, life: 0.3 });
    }

    if (this.lastHolderId !== arcade.holderId) {
      if (this.lastHolderId !== null && arcade.holderId === controlledId) {
        this.feedback?.sound("impact");
        this.feedback?.vibrate([16, 12, 20]);
      }
      this.lastHolderId = arcade.holderId;
    }

    let survivorKin = null;
    let survivorPlayer = null;
    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const out = Boolean(entry.outAt);
      const isHolder = arcade.holderId === player.id;

      if (out && !this.lastOut.get(player.id)) {
        this.lastOut.set(player.id, true);
        animator.trigger("fall");
        this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.6, 0)), ["#ff8b2e", "#ffd15c", "#1b2530", "#ffffff"], { count: 24, speed: 3, up: 2.6, size: 0.1, life: 0.9 });
        if (player.id === controlledId) {
          this.feedback?.sound("error");
          this.feedback?.vibrate([30, 24, 40]);
        }
      }

      if (out) {
        // Scorched and sitting out at the edge of the circle.
        setKinOpacity(kin, 0.35);
        const spot = kin.userData.spot;
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, spot.x * 1.45, 0.05);
        kin.position.z = THREE.MathUtils.lerp(kin.position.z, spot.z * 1.45, 0.05);
        animator.set("sad", { base: true });
        animator.update(now);
        kin.userData.label.material.opacity = 0.3;
        kin.userData.shadow.material.opacity = 0.1;
        return;
      }

      setKinOpacity(kin, 1);
      if (minigame.finaleAt) {
        animator.set("cheer", { base: true });
        survivorKin = kin;
        survivorPlayer = player;
      } else if (isHolder) {
        // Panicky shuffle while holding the ticking bomb.
        animator.set("run", { base: true });
        kin.position.x = kin.userData.spot.x + Math.sin(now / 120) * 0.05 * (0.5 + nervous);
      } else {
        animator.set("idle", { base: true });
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, kin.userData.spot.x, 0.15);
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.32, kin.position.z);
      kin.userData.shadow.material.opacity = 0.26;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    if (minigame.finaleAt && survivorKin && !this.finaleDone) {
      this.finaleDone = true;
      this.bursts.spawn(survivorKin.position.clone(), [survivorPlayer.color, "#ffd15c", "#ffffff"], { count: 22, speed: 2.6, up: 3, size: 0.1, life: 1 });
      if (survivorPlayer.id === controlledId) this.feedback?.sound("win");
    }

    this.bursts.update(dt);

    this.shake *= 0.88;
    const shakeX = Math.sin(now / 15) * this.shake * 0.3;
    const shakeY = Math.cos(now / 12) * this.shake * 0.22;
    const desired = new THREE.Vector3(shakeX, (this.baseCamY || 4.6) + shakeY, this.baseCamZ || 7.8);
    this.camera.position.lerp(desired, 0.1);
    this.camera.lookAt(0, 0.8, 0);

    this.updateHud(minigame, arcade, state, now);
    // Global: a downward arrow marks your own kin so you never lose yourself.
    { const oid = this.getControlledPlayerId(); const ok = this.kins && this.kins.get(oid);
      if (ok) { if (!this.ownMarker) { this.ownMarker = createOwnMarker(); this.scene.add(this.ownMarker); }
        this.ownMarker.visible = ok.visible !== false;
        this.ownMarker.position.set(ok.position.x, 0, ok.position.z);
        updateOwnMarker(this.ownMarker, now, ok.position.y + 0.35); } }
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const controlledId = this.getControlledPlayerId();
    const own = arcade.players[controlledId];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.passes || 0);

    const banner = this.hud.querySelector("[data-bomb-banner]");
    const isHolder = arcade.holderId === controlledId && !own?.outAt;
    if (banner) {
      if (own?.outAt) {
        banner.hidden = false;
        banner.textContent = "BOOM – raus!";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      } else if (isHolder) {
        banner.hidden = false;
        banner.textContent = "DU hast die Bombe!";
        banner.style.background = "#ff2038";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.passButton) this.passButton.disabled = !isHolder || Boolean(minigame.finaleAt);
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
    this.baseCamY = portrait ? 5.4 : 4.6;
    this.baseCamZ = portrait ? 9.6 : 7.8;
    this.camera.fov = portrait ? 54 : 48;
    this.camera.updateProjectionMatrix();
  }
}
