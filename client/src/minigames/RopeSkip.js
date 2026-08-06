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
  setKinOpacity
} from "./VoxelKit.js?v=tumblekin116";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage,
  fitKinsInView,
  dressMeadow
} from "./SceneKit.js?v=tumblekin116";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin116";

// Seilspringen — two Kins swing a giant rope, everyone else jumps it.
// Same server rhythm as the waves: the rope sweeps the ground exactly at
// each hitAt; tap to be mid-air. Trip once and you are out.
const KIN_Y = 0.36;   // feet rest on the sand pit instead of floating above it
const ROPE_R = 3.1;
const SPOTS = [-1.7, -0.57, 0.57, 1.7];
const JUMP_HEIGHT = 1.3;

export class RopeSkip {
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
    this.lastEliminated = new Map();
    this.lastSurvived = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.localJumpUntil = 0;
    this.finaleDone = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Seilspringen", fog: ["#a8e2f4", 16, 40] });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-rope-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="jump-button" data-rope-jump>
        <span class="jump-button-face">SPRUNG</span>
      </button>
    `;
    this.jumpButton = this.controls.querySelector("[data-rope-jump]");
    this.onJumpDown = (event) => {
      event.preventDefault();
      this.pressJump();
    };
    this.jumpButton.addEventListener("pointerdown", this.onJumpDown);
    this.onCanvasTap = (event) => {
      event.preventDefault();
      this.pressJump();
    };
    this.webglCanvas.addEventListener("pointerdown", this.onCanvasTap);
    this.loop();
  }

  pressJump() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.eliminated) return;
    const nowT = this.now();
    if (nowT < Math.max(own.jumpUntil || 0, this.localJumpUntil)) return;
    this.localJumpUntil = nowT + (arcade?.jumpMs || 650);
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "jump" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    if (this.onCanvasTap) this.webglCanvas.removeEventListener("pointerdown", this.onCanvasTap);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    addStageLights(this.scene);

    // Schoolyard: meadow + sand pit under the rope line.
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.5, 18),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    this.scene.add(meadow);
    // Kulisse: Bodenflecken, Büschel, Blumen, Steine und ein Baumkranz als
    // Horizont. Ohne sie stösst die Wiese als harte Kante gegen den Himmel.
    dressMeadow(this.scene, { seed: 11, keepOut: { x: 4.8, z: 3.0 }, spread: { x: 17, z: 15 } });
    const pit = new THREE.Mesh(
      new THREE.BoxGeometry(7.6, 0.34, 2.6),
      new THREE.MeshLambertMaterial({ color: "#ffe6a3" })
    );
    pit.position.set(0, -0.1, 0);
    pit.receiveShadow = true;
    this.scene.add(pit);

    // The two rope swingers stand at the sides.
    this.swingers = [];
    [[-2.9, "#ff8b2e", 4], [2.9, "#2ec4b6", 5]].forEach(([x, color, variant]) => {
      const swinger = createVoxelKin(color, variant);
      swinger.position.set(x, KIN_Y, 0);
      swinger.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      this.scene.add(swinger);
      const animator = new KinAnimator(swinger);
      animator.groundY = KIN_Y;
      animator.set("idle", { base: true });
      this.swingers.push(animator);
    });

    // The rope itself: a chain of small boxes forming an arc between the
    // swingers, rotating around the x-axis line at hand height.
    this.rope = new THREE.Group();
    this.ropeSegments = [];
    for (let i = 0; i <= 30; i += 1) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.075, 0.075),
        new THREE.MeshLambertMaterial({ color: i % 5 === 0 ? "#ffffff" : "#e0334f" })
      );
      this.rope.add(seg);
      this.ropeSegments.push(seg);
    }
    this.rope.position.y = 0.72;   // hand height, matched to the grounded kins
    this.scene.add(this.rope);

    [[-6, 5.2, -4, 5], [6, 6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    this.camera.position.set(0, 2.6, 8.2);
    this.camera.lookAt(0, 1.3, 0);
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const x = SPOTS[index % SPOTS.length];
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.48);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.userData.spotX = x;
    kin.position.set(x, KIN_Y, 0);
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

  // Rope angle: 0 = at the ground (hit moment). Between passes the rope does
  // one full swing, timed so it hits the ground exactly at each hitAt. Every
  // few passes it reverses direction — a clear visual change, but the jump
  // timing at each hitAt stays identical, so it is never unfair.
  ropeAngle(arcade, elapsed) {
    const waves = arcade.waves || [];
    let previous = 0;
    for (let i = 0; i < waves.length; i += 1) {
      const wave = waves[i];
      if (elapsed < wave.hitAt) {
        const span = wave.hitAt - previous;
        const t = span > 0 ? (elapsed - previous) / span : 0;
        // Reverse the swing direction on every third pass.
        const dir = Math.floor(i / 3) % 2 === 0 ? 1 : -1;
        this.ropeReversed = dir < 0;
        return t * Math.PI * 2 * dir;
      }
      previous = wave.hitAt;
    }
    return 0;
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
    const elapsed = Math.max(0, now - minigame.startedAt);

    // Swing the rope arc: sag depends on the angle so it sweeps the sand but
    // never dips through it. The swing radius is capped so the lowest point
    // just grazes the ground (~0.05 above it).
    const angle = this.ropeAngle(arcade, elapsed);
    const swing = Math.cos(angle);
    const depth = Math.sin(angle);
    const groundClear = 0.05;
    const swingRadius = this.rope.position.y - groundClear; // hand height to floor
    this.ropeSegments.forEach((seg, i) => {
      const t = i / (this.ropeSegments.length - 1);
      const x = -2.75 + t * 5.5;
      const sag = Math.sin(t * Math.PI);
      // Local y is relative to the rope group at hand height; clamp the world
      // height so the rope stays on or above the sand.
      let localY = -swing * sag * swingRadius;
      if (this.rope.position.y + localY < groundClear) localY = groundClear - this.rope.position.y;
      seg.position.set(x, localY, depth * sag * ROPE_R * 0.42);
      seg.rotation.x = Math.atan2(depth, -swing);
      const nextT = Math.min(1, t + 1 / this.ropeSegments.length);
      const nextSag = Math.sin(nextT * Math.PI);
      seg.rotation.z = Math.atan2(-swing * (nextSag - sag) * swingRadius, 6.8 / this.ropeSegments.length);
    });
    this.swingers.forEach((animator) => animator.update(now));

    let nextHitIn = null;
    (arcade.waves || []).forEach((wave) => {
      const untilHit = wave.hitAt - elapsed;
      if (untilHit > 0 && (nextHitIn === null || untilHit < nextHitIn)) nextHitIn = untilHit;
    });

    let survivorKin = null;
    let survivorPlayer = null;
    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const out = Boolean(entry.eliminated);

      const jumpUntil = player.id === controlledId
        ? Math.max(entry.jumpUntil || 0, this.localJumpUntil)
        : (entry.jumpUntil || 0);
      const jumpStart = jumpUntil - arcade.jumpMs;
      const jumping = !out && now >= jumpStart && now < jumpUntil;
      let y = KIN_Y;
      if (jumping) {
        const t = (now - jumpStart) / arcade.jumpMs;
        y += Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) * JUMP_HEIGHT;
      }

      if (out && !this.lastEliminated.get(player.id)) {
        this.lastEliminated.set(player.id, true);
        animator.trigger("fall");
        this.bursts.spawn(kin.position.clone(), ["#e0334f", player.color, "#ffffff"], { count: 14, speed: 2.4, up: 2, size: 0.09, life: 0.8, drag: 1.4 });
        this.bursts.ring(kin.position.clone().setY(0.08), "#e0334f", { radius: 1.6, life: 0.55 });
        // Kurz und gestaffelt. "GESTOLPERT!" ist breiter als der Abstand
        // zwischen zwei Springern — stolpern zwei gleichzeitig, schoben sich
        // die Schriftzüge ineinander und ergaben "GESTOLGESTOLPERT!". Der
        // Ausruf steht jetzt je Bahn eine Stufe höher und ist kurz genug.
        this.floaters.pop(
          kin.position.clone().add(new THREE.Vector3(0, 1.1 + (index % 4) * 0.42, 0)),
          "RAUS!",
          { color: "#ff6b7f", size: 0.42 }
        );
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 0.9);
          this.feedback?.sound("error");
          this.feedback?.vibrate([26, 20, 34]);
        }
      }
      if (!out && (entry.survived || 0) > (this.lastSurvived.get(player.id) || 0)) {
        this.lastSurvived.set(player.id, entry.survived);
        this.floaters.pop(
          kin.position.clone().add(new THREE.Vector3(0, 1, 0)),
          `${entry.survived}`,
          { color: "#ffe36b", size: 0.32, life: 0.6, rise: 0.6 }
        );
        if (player.id === controlledId) {
          this.feedback?.sound("pop", { pan: kin.position.x * 0.18 });
          this.feedback?.vibrate(8);
        }
      }

      if (out) {
        // Tripped: sit dazed beside the pit.
        setKinOpacity(kin, 0.45);
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, kin.userData.spotX, frameLerp(0.2, dt));
        kin.position.z = THREE.MathUtils.lerp(kin.position.z, 1.9, frameLerp(0.06, dt));
        animator.set("sad", { base: true });
        animator.groundY = KIN_Y;
        animator.update(now);
        kin.userData.label.material.opacity = 0.35;
        kin.userData.shadow.material.opacity = 0.12;
        return;
      }

      setKinOpacity(kin, 1);
      kin.position.x = THREE.MathUtils.lerp(kin.position.x, kin.userData.spotX, frameLerp(0.2, dt));
      kin.position.z = THREE.MathUtils.lerp(kin.position.z, 0, frameLerp(0.2, dt));
      animator.groundY = y;
      if (minigame.finaleAt) {
        applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
        survivorKin = kin;
        survivorPlayer = player;
      } else {
        animator.set(jumping ? "jump" : "idle", { base: true });
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.09, kin.position.z);
      kin.userData.shadow.material.opacity = jumping ? 0.14 : 0.26;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    if (minigame.finaleAt && survivorKin && !this.finaleDone) {
      this.finaleDone = true;
      this.bursts.spawn(survivorKin.position.clone(), [survivorPlayer.color, "#ffd15c", "#ffffff"], { count: 24, speed: 2.8, up: 3, size: 0.1, life: 0.95, drag: 1.2 });
      this.bursts.ring(survivorKin.position.clone().setY(0.08), "#ffd15c", { radius: 2.2, life: 0.7, opacity: 0.6 });
      this.floaters.pop(survivorKin.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "🏆", { size: 0.6, life: 1.3, rise: 1.1 });
      if (survivorPlayer.id === controlledId) this.feedback?.sound("win");
    }

    this.bursts.update(dt);

    this.floaters.update(dt);

    this.shake *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 16) * this.shake * 0.24 * shakeScale();
    const desired = new THREE.Vector3(shakeX, this.baseCamY || 2.6, this.baseCamZ || 8.2);
    this.camera.position.lerp(desired, frameLerp(0.1, dt));
    this.camera.lookAt(0, 1.3, 0);

    this.updateHud(minigame, arcade, state, nextHitIn, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    // Sicherstellen, dass alle Figuren im Bild sind — notfalls weicht die
    // Kamera zurück. Auf dem Handy ist der Ausschnitt schmal, und wer sich
    // selbst nicht sieht, spielt blind.
    fitKinsInView(this);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, nextHitIn, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.survived || 0);

    const banner = this.hud.querySelector("[data-rope-banner]");
    if (banner) {
      if (own?.eliminated) {
        banner.hidden = false;
        banner.textContent = "Gestolpert!";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      } else if (nextHitIn !== null && nextHitIn < 900) {
        banner.hidden = false;
        banner.textContent = "JETZT!";
        banner.style.background = "#e0334f";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.jumpButton) this.jumpButton.disabled = Boolean(own?.eliminated);
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Näher heran und tiefer. Die Szene ist ein waagrechter Streifen: Seil,
      // zwei Schwinger, vier Springer — und die stand als sechzig Pixel hohes
      // Band mitten in einem sonst leeren Bild. Sie füllt die Höhe nie ganz,
      // aber sie darf wenigstens gross genug sein, dass man die Sprünge sieht.
      this.baseCamY = portrait ? 2.6 : 3.4;
      this.baseCamZ = portrait ? 8.2 : 8.6;
      camera.fov = portrait ? 54 : 48;
    });
  }
}
