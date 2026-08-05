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
  KIN_SOLE,
  standOn
} from "./VoxelKit.js?v=tumblekin112";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin112";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin112";

// Lichtwächter — hold the button to sprint towards the gate while the
// giant guard looks away. When the light flips to red he whirls around:
// anyone still running is caught and stumbles backwards.
const LANE_GAP = 1.5;
const START_Z = 5.2;
const TRACK_LEN = 19;
const LAWN_TOP_Y = 0;               // Oberkante der Wiese neben der Bahn
const GUARD_SCALE = 3.4;
const TRACK_TOP_Y = 0.05;           // Oberkante der Laufbahn
const KIN_Y = standOn(TRACK_TOP_Y);
const RUN_PING_MS = 90;

export class RedLightGate {
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
    this.lastCaught = new Map();
    this.lastFinished = new Map();
    this.smoothProgress = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.holdTimer = null;
    this.holding = false;
    this.lastPhaseKind = null;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Lichtwächter", fog: ["#a8e2f4", 20, 46], fov: 52, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0m</strong></div>
      <div class="color-banner" data-light-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="hold-button" data-hold-run>
        <span class="hold-button-face">HALTEN = LAUFEN</span>
      </button>
    `;
    this.holdButton = this.controls.querySelector("[data-hold-run]");
    this.onHoldDown = (event) => {
      event.preventDefault();
      this.holdButton.setPointerCapture?.(event.pointerId);
      this.setHolding(true);
    };
    this.onHoldUp = () => this.setHolding(false);
    this.holdButton.addEventListener("pointerdown", this.onHoldDown);
    this.holdButton.addEventListener("pointerup", this.onHoldUp);
    this.holdButton.addEventListener("pointercancel", this.onHoldUp);
    this.holdButton.addEventListener("lostpointercapture", this.onHoldUp);
    this.loop();
  }

  setHolding(active) {
    if (this.holding === active) return;
    this.holding = active;
    this.holdButton?.classList.toggle("is-holding", active);
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    if (active) {
      this.feedback?.vibrate(8);
      this.sendRun();
      this.holdTimer = setInterval(() => this.sendRun(), RUN_PING_MS);
    }
  }

  sendRun() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt) {
      this.setHolding(false);
      return;
    }
    this.sendInput({ action: "run" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    this.controls.innerHTML = "";
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-5, 12, 6],
      shadow: { left: -12, right: 12, top: 16, bottom: -16 },
      sunIntensity: 2.9,
      skyColor: 0xe6f6ff,
      groundColor: 0x76b8a8
    });

    // Meadow track with side hedges leading to the guard's gate.
    const lawn = new THREE.Mesh(
      new THREE.BoxGeometry(16, 0.5, TRACK_LEN + 14),
      new THREE.MeshLambertMaterial({ color: "#57cd63" })
    );
    lawn.position.set(0, -0.25, START_Z - (TRACK_LEN + 2) / 2);
    lawn.receiveShadow = true;
    this.scene.add(lawn);
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 0.54, TRACK_LEN + 4),
      new THREE.MeshLambertMaterial({ color: "#f7e3a8" })
    );
    track.position.set(0, -0.22, START_Z - TRACK_LEN / 2);
    track.receiveShadow = true;
    this.scene.add(track);

    // Distance stripes so movement reads clearly.
    for (let i = 0; i <= 6; i += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(7.4, 0.06, 0.16),
        new THREE.MeshLambertMaterial({ color: "#e6c96f" })
      );
      stripe.position.set(0, 0.08, START_Z - (i / 6) * TRACK_LEN);
      this.scene.add(stripe);
    }
    [[-4.6, "#3fae4e"], [4.6, "#3fae4e"]].forEach(([x, color]) => {
      for (let i = 0; i < 6; i += 1) {
        const hedge = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.9 + (i % 2) * 0.3, 1.6),
          new THREE.MeshLambertMaterial({ color })
        );
        hedge.position.set(x, 0.45, START_Z - 1.5 - i * 3.4);
        hedge.castShadow = true;
        this.scene.add(hedge);
      }
    });

    // The finish gate + giant guard.
    const gateZ = START_Z - TRACK_LEN - 1.2;
    const gateMat = new THREE.MeshLambertMaterial({ color: "#ffb400" });
    [[-3.4, 0], [3.4, 0]].forEach(([x]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), gateMat);
      post.position.set(x, 1.7, gateZ);
      post.castShadow = true;
      this.scene.add(post);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 0.5), gateMat);
    beam.position.set(0, 3.4, gateZ);
    this.scene.add(beam);

    // Der Riese stand einen ganzen Meter über der Wiese. Der Sohlenabstand
    // skaliert mit der Figur mit — bei Faktor 3.4 sind das gut ein Meter, und
    // genau um den lag er daneben.
    this.guard = createVoxelKin("#7a4ddb", 3);
    this.guard.scale.setScalar(GUARD_SCALE);
    const guardY = LAWN_TOP_Y + KIN_SOLE * GUARD_SCALE;
    this.guard.position.set(0, guardY, gateZ - 2.2);
    this.scene.add(this.guard);
    this.guardAnimator = new KinAnimator(this.guard);
    this.guardAnimator.groundY = guardY;

    // The big signal lamp above the guard.
    this.lampMat = new THREE.MeshLambertMaterial({ color: "#2ee86a", emissive: new THREE.Color("#2ee86a"), emissiveIntensity: 0.9 });
    const lampBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), this.lampMat);
    lampBox.position.set(0, 5, gateZ - 2.2);
    this.scene.add(lampBox);
    const lampPole = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 1.4, 0.24),
      new THREE.MeshLambertMaterial({ color: "#40506a" })
    );
    lampPole.position.set(0, 4.1, gateZ - 2.2);
    this.scene.add(lampPole);

    [[-7, 6, -6, 5], [7, 7, -12, 6], [-6, 7, -16, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.gateZ = gateZ;
    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    // Start on the final framing — no camera fly-in.
    this.camera.position.set(0, this.baseCamY || 4.4, START_Z + (this.baseCamBack || 7.2));
    this.camera.lookAt(0, 1.1, START_Z - 6);
  }

  laneX(index) {
    return (index - 1.5) * LANE_GAP;
  }

  progressZ(progress, goal) {
    return START_Z - (Math.max(0, progress) / Math.max(1, goal)) * TRACK_LEN;
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
    kin.position.set(this.laneX(index), KIN_Y, START_Z);
    kin.rotation.y = Math.PI;
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
    const phaseKind = arcade.phaseKind || "green";
    const isGreen = phaseKind === "green";

    // Phase flip: lamp + guard whirl + audio cue.
    if (phaseKind !== this.lastPhaseKind) {
      if (this.lastPhaseKind !== null) {
        this.feedback?.sound(isGreen ? "pop" : "impact");
        this.feedback?.vibrate(isGreen ? 10 : [26, 18, 26]);
        if (!isGreen) this.shake = Math.max(this.shake, 0.45);
      }
      this.lastPhaseKind = phaseKind;
    }
    const lampColor = isGreen ? "#2ee86a" : "#ff2038";
    this.lampMat.color.set(lampColor);
    this.lampMat.emissive.set(lampColor);
    this.lampMat.emissiveIntensity = 0.7 + Math.abs(Math.sin(now / 160)) * 0.5;

    // Guard: back turned on green, spins to face the runners on red.
    const guardTarget = isGreen ? Math.PI : 0;
    this.guard.rotation.y += (guardTarget - this.guard.rotation.y) * Math.min(1, dt * 9);
    this.guardAnimator.set(isGreen ? "idle" : "cheer", { base: true });
    this.guardAnimator.update(now);

    let ownKin = null;
    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const finished = Boolean(entry.finishedAt);

      // Smooth server progress; catching pulls players visibly backwards.
      const shown = THREE.MathUtils.lerp(
        this.smoothProgress.get(player.id) ?? 0,
        entry.progress || 0,
        Math.min(1, dt * 7)
      );
      this.smoothProgress.set(player.id, shown);
      const moving = Math.abs((entry.progress || 0) - shown) > 0.08;
      kin.position.x = this.laneX(index);
      kin.position.z = finished
        ? THREE.MathUtils.lerp(kin.position.z, this.gateZ - 0.6, frameLerp(0.08, dt))
        : this.progressZ(shown, arcade.goal);

      if ((entry.caught || 0) > (this.lastCaught.get(player.id) || 0)) {
        this.lastCaught.set(player.id, entry.caught);
        animator.trigger("stumble");
        this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.4, 0)), ["#ff2038", "#ffffff"], { count: 12, speed: 2.1, up: 1.6, size: 0.08, life: 0.6, drag: 1.6 });
        this.bursts.ring(kin.position.clone().setY(0.07), "#ff2038", { radius: 1.5, life: 0.5 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "ERWISCHT!", { color: "#ff6b7f", size: 0.4, life: 0.9 });
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 0.8);
          this.feedback?.sound("error");
          this.feedback?.vibrate([20, 16, 30]);
        }
      }
      if (finished && !this.lastFinished.get(player.id)) {
        this.lastFinished.set(player.id, true);
        animator.trigger("cheer");
        this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.5, 0)), [player.color, "#ffc400", "#ffffff"], { count: 20, speed: 2.6, up: 2.6, size: 0.09, life: 0.85, drag: 1.2 });
        this.bursts.ring(kin.position.clone().setY(0.07), "#ffc400", { radius: 2, life: 0.6, opacity: 0.6 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "GESCHAFFT! 🏁", { color: "#ffe36b", size: 0.44, life: 1.2, rise: 1 });
        if (player.id === controlledId) {
          this.feedback?.sound("win");
          this.feedback?.vibrate([24, 24, 48]);
          this.setHolding(false);
        }
      }

      if (minigame.finaleAt) {
        applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
      } else if (finished) {
        animator.set("cheer", { base: true });
      } else {
        animator.set(moving ? "run" : "idle", { base: true });
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.04, kin.position.z);
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
      if (player.id === controlledId) ownKin = kin;
    });

    this.bursts.update(dt);

    this.floaters.update(dt);

    this.shake *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 15) * this.shake * 0.24 * shakeScale();
    const shakeY = Math.cos(now / 12) * this.shake * 0.18;
    if (minigame.finaleAt) {
      // Time's up: zoom in on the winner(s) — the runner(s) furthest along.
      let best = -Infinity;
      state.players.forEach((player) => {
        const entry = arcade.players[player.id];
        const prog = entry?.finishedAt ? arcade.goal + 100 : (entry?.progress || 0);
        if (prog > best) best = prog;
      });
      const leaders = state.players.filter((player) => {
        const entry = arcade.players[player.id];
        const prog = entry?.finishedAt ? arcade.goal + 100 : (entry?.progress || 0);
        return best - prog < 1.5;
      });
      let cx = 0;
      let cz = 0;
      leaders.forEach((player) => {
        const kin = this.kins.get(player.id);
        if (kin) { cx += kin.position.x; cz += kin.position.z; }
      });
      if (leaders.length) { cx /= leaders.length; cz /= leaders.length; }
      const desired = new THREE.Vector3(cx * 0.6 + shakeX, 2.2 + shakeY, cz + 3.4);
      this.camera.position.lerp(desired, frameLerp(0.06, dt));
      this.camera.lookAt(cx * 0.4, 1.2, cz - 1.5);
    } else {
      // Chase camera behind the own runner.
      const focusZ = ownKin ? ownKin.position.z : START_Z;
      const desired = new THREE.Vector3(shakeX, (this.baseCamY || 4.4) + shakeY, focusZ + (this.baseCamBack || 7.2));
      this.camera.position.lerp(desired, frameLerp(0.1, dt));
      this.camera.lookAt(0, 1.1, focusZ - 6);
    }

    this.updateHud(minigame, arcade, state, isGreen, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, isGreen, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = `${Math.round(own?.progress || 0)}m`;

    const banner = this.hud.querySelector("[data-light-banner]");
    if (banner) {
      banner.hidden = false;
      if (own?.finishedAt) {
        banner.textContent = "Im Ziel!";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if (isGreen) {
        banner.textContent = "GRÜN – LAUF!";
        banner.style.background = "#2ee86a";
        banner.style.color = "#0c3a1c";
      } else {
        banner.textContent = "ROT – STOPP!";
        banner.style.background = "#ff2038";
        banner.style.color = "#ffffff";
      }
    }
    if (this.holdButton) this.holdButton.disabled = Boolean(own?.finishedAt);
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 5.2 : 4.4;
      this.baseCamBack = portrait ? 8.6 : 7.2;
      camera.fov = portrait ? 58 : 52;
    });
  }
}
