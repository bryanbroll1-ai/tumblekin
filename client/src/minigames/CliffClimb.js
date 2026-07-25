import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin
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

// Bergsteiger — race up the cliff by tapping left / right in alternation.
// The correct hand pulls you up a rung; the wrong hand slips you back one.
const LANE_GAP = 1.55;
const CLIMB_WORLD = 12;    // world height of the whole climb
const KIN_BASE_Y = 0.5;

export class CliffClimb {
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
    this.smoothRung = new Map();
    this.lastRung = new Map();
    this.lastSlips = new Map();
    this.lastFinished = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Bergsteiger", fog: ["#a8e2f4", 22, 48], fov: 50, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-climb-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <div class="runner-lane-controls">
        <button type="button" data-climb-side="-1" aria-label="Linke Hand">✋</button>
        <button type="button" data-climb-side="1" aria-label="Rechte Hand">🤚</button>
      </div>
    `;
    this.buttons = {};
    this.controls.querySelectorAll("[data-climb-side]").forEach((button) => {
      const side = Number(button.dataset.climbSide);
      this.buttons[side] = button;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.sendGrab(side);
      });
    });
    this.loop();
  }

  sendGrab(side) {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt) return;
    this.feedback?.vibrate(6);
    this.sendInput({ action: "grab", side }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-4, 12, 8],
      shadow: { top: 14, bottom: -4 },
      sunIntensity: 2.9,
      groundColor: 0x8a9ab0
    });

    // The cliff face: a tall stone wall with ledges and a green summit.
    const cliff = new THREE.Mesh(
      new THREE.BoxGeometry(9, CLIMB_WORLD + 3, 1),
      new THREE.MeshLambertMaterial({ color: "#9c8f7a" })
    );
    cliff.position.set(0, CLIMB_WORLD / 2 - 0.5, -1.1);
    cliff.receiveShadow = true;
    this.scene.add(cliff);
    // No protruding grey rocks — only the colourful climbing holds stand out.
    // Colourful climbing holds in each lane, staggered left/right so the
    // hand-over-hand motion has something to grip.
    const holdColors = ["#ff5c8a", "#ffc400", "#43e38c", "#4bb8ff"];
    const count = this.getState()?.players?.length || 4;
    for (let lane = 0; lane < count; lane += 1) {
      const lx = this.laneX(lane, count);
      for (let step = 0; step < 24; step += 1) {
        const side = step % 2 === 0 ? -1 : 1;
        const hold = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.18, 0.22),
          new THREE.MeshLambertMaterial({ color: holdColors[lane % holdColors.length] })
        );
        hold.position.set(lx + side * 0.34, 0.7 + step * (CLIMB_WORLD / 24), -0.42);
        hold.castShadow = true;
        this.scene.add(hold);
      }
    }
    // Summit deck the finishers hop onto — a wooden lookout platform (no more
    // green slab), wide enough to hold everyone who reaches the top.
    this.summitY = CLIMB_WORLD + 0.2;    // world height of the deck's top surface
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(4, count * LANE_GAP + 1.4), 0.4, 2.2),
      new THREE.MeshLambertMaterial({ color: "#c98b52" })
    );
    deck.position.set(0, this.summitY - 0.2, 0.1);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.scene.add(deck);
    // A flag planted at the back of the deck.
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.1), new THREE.MeshLambertMaterial({ color: "#5a4a3a" }));
    pole.position.set(0, this.summitY + 0.7, -0.65);
    this.scene.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.44, 0.06), new THREE.MeshLambertMaterial({ color: "#ff2e6a" }));
    flag.position.set(0.4, this.summitY + 1.1, -0.65);
    this.scene.add(flag);

    [[-7, 6, -4, 5], [7, 8, -3, 6], [0, 10, -6, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    this.camera.position.set(0, 2.4, 7.4);
    this.camera.lookAt(0, 2.4, 0);
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const count = this.getState()?.players?.length || 4;
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.42);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.userData.laneX = this.laneX(index, count);
    kin.position.set(kin.userData.laneX, KIN_BASE_Y, 0);
    // Face the cliff — back to the player.
    kin.rotation.y = Math.PI;
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_BASE_Y;
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
    let ownY = KIN_BASE_Y;

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);

      const shown = THREE.MathUtils.lerp(this.smoothRung.get(player.id) ?? 0, entry.rung || 0, Math.min(1, dt * 10));
      this.smoothRung.set(player.id, shown);
      const y = KIN_BASE_Y + (shown / arcade.height) * CLIMB_WORLD;
      animator.groundY = y;

      if ((entry.rung || 0) > (this.lastRung.get(player.id) || 0)) {
        this.lastRung.set(player.id, entry.rung);
        kin.userData.grabAt = now;
        if (player.id === controlledId) {
          this.feedback?.sound("step");
          this.feedback?.vibrate(6);
        }
      }
      if ((entry.slips || 0) > (this.lastSlips.get(player.id) || 0)) {
        this.lastSlips.set(player.id, entry.slips);
        animator.trigger("stumble");
        this.bursts.spawn(kin.position.clone(), ["#ab9e88", "#ffffff"], { count: 8, speed: 1.5, up: 0.8, size: 0.06, life: 0.5, gravity: 2, drag: 1.8 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 0.9, 0)), "ABGERUTSCHT!", { color: "#ffb37a", size: 0.32, life: 0.8 });
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 0.5);
          this.feedback?.sound("error");
          this.feedback?.vibrate([18, 14, 22]);
        }
      }
      if (entry.finishedAt && !this.lastFinished.get(player.id)) {
        this.lastFinished.set(player.id, true);
        animator.trigger("cheer");
        this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.5, 0)), [player.color, "#ffd15c", "#ffffff"], { count: 22, speed: 2.6, up: 2.8, size: 0.1, life: 0.9, drag: 1.2 });
        this.bursts.ring(kin.position.clone().add(new THREE.Vector3(0, 0.3, 0)), "#ffd15c", { radius: 1.8, life: 0.6, opacity: 0.6, tilt: null });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "OBEN! 🏔️", { color: "#ffe36b", size: 0.46, life: 1.2, rise: 1 });
        if (player.id === controlledId) {
          this.feedback?.sound("win");
          this.feedback?.vibrate([22, 22, 44]);
        }
      }

      // At the finale, everyone who reached the top hops up onto the summit
      // deck, turns around to face the camera and celebrates.
      const celebrating = Boolean(minigame.finaleAt && entry.finishedAt);
      if (celebrating) {
        const spreadX = kin.userData.laneX * 0.6;
        animator.groundY = THREE.MathUtils.lerp(animator.groundY, this.summitY + 0.3, Math.min(1, dt * 3));
        animator.set("cheer", { base: true });
        animator.update(now);
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, spreadX, Math.min(1, dt * 3));
        kin.position.z = THREE.MathUtils.lerp(kin.position.z, 0.4, Math.min(1, dt * 3));
        kin.rotation.y = THREE.MathUtils.lerp(kin.rotation.y, 0, Math.min(1, dt * 4));
      } else {
        // Sway toward the reaching hand while climbing.
        const reach = now < (entry.lastHitAt || 0) + 220 ? entry.nextSide * -0.12 : 0;
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, kin.userData.laneX + reach, 0.3);
        animator.set(entry.finishedAt ? "cheer" : "idle", { base: true });
        animator.update(now);

        // Hand-over-hand climbing pose (runs after the base animator so it wins):
        // the hand that just grabbed reaches up the wall, the other pulls down,
        // with alternating legs and a gentle body bob — no more stiff standing.
        const d = kin.userData;
        if (d.arms && !entry.finishedAt && !minigame.finaleAt) {
          const grabP = Math.max(0, 1 - (now - (d.grabAt || 0)) / 340);
          const usedSide = -entry.nextSide;           // hand that just grabbed
          d.arms.forEach((arm) => {
            const up = arm.userData.side === usedSide;
            arm.rotation.z = arm.userData.baseRotZ + arm.userData.side * (up ? -1.3 : 0.5) * (0.55 + grabP * 0.6);
            arm.rotation.x = up ? -1.15 * (0.5 + grabP * 0.5) : 0.35;
            arm.position.y = arm.userData.baseY + (up ? 0.16 * (0.4 + grabP * 0.6) : -0.05);
          });
          if (d.feet) d.feet.forEach((foot, fi) => { foot.rotation.x = (fi === 0 ? 1 : -1) * (0.35 + grabP * 0.35); });
          d.body.position.y = Math.sin(now / 200 + d.phase) * 0.02 - grabP * 0.04;
          d.body.rotation.z = usedSide * 0.06 * grabP;
        }
      }
      kin.userData.shadow.visible = false;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.75;
      if (player.id === controlledId) { ownY = y; this.ownX = kin.userData.laneX; }
    });

    this.bursts.update(dt);

    this.floaters.update(dt);

    // Highlight the hand the controlled player should tap next.
    const own = arcade.players[controlledId];
    if (own && this.buttons) {
      Object.entries(this.buttons).forEach(([side, button]) => {
        const isNext = !own.finishedAt && Number(side) === own.nextSide;
        button.classList.toggle("climb-next", isNext);
      });
    }

    this.shake *= 0.9;
    if (minigame.finaleAt) {
      // Pull back to frame the whole summit deck and the celebration.
      const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
      const desired = new THREE.Vector3(shakeX, this.summitY + 0.6, (this.baseCamZ || 7.4) + 1.8);
      this.camera.position.lerp(desired, 0.08);
      this.camera.lookAt(0, this.summitY + 0.2, 0);
    } else {
      // Follow the own climber in x (portrait is too narrow for all four lanes)
      // and in y as it rises.
      const followX = (this.ownX || 0) * 0.7;
      const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
      const desired = new THREE.Vector3(followX + shakeX, Math.max(2.4, ownY) + (this.baseCamLift || 0.4), this.baseCamZ || 7.4);
      this.camera.position.lerp(desired, 0.1);
      this.camera.lookAt(followX, Math.max(2.4, ownY) + 0.4, 0);
    }

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
    this.hud.querySelector("[data-kinetic-score]").textContent = `${own?.rung || 0}/${arcade.height}`;

    const banner = this.hud.querySelector("[data-climb-banner]");
    if (banner) {
      if (own?.finishedAt) {
        banner.hidden = false;
        banner.textContent = "Gipfel! 🏔️";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else {
        banner.hidden = true;
      }
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamLift = portrait ? 0.6 : 0.4;
      this.baseCamZ = portrait ? 8.6 : 7.4;
      camera.fov = portrait ? 56 : 50;
    });
  }
}
