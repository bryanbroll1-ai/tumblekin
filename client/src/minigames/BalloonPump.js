import * as THREE from "/vendor/three/three.module.js";
import {
  applyFinaleMood,
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin119";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage,
  fitKinsInView,
  dressMeadow
} from "./SceneKit.js?v=tumblekin119";
import { frameChance, frameDecay, frameLerp } from "./Quality.js?v=tumblekin119";

// Pump-Panik — the tap battle: every tap pumps your balloon bigger.
// The best part is watching all four balloons swell live; at the finale the
// biggest balloon lifts its Kin into the sky.
// Enger: bei 1.95 ragten die äusseren Stationen samt Namensschild aus dem
// Bild — das Schild ist mit 0.62 Welteinheiten breiter als die Figur.
const STATION_GAP = 1.48;
const KIN_Y = 0.62;

export class BalloonPump {
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
    this.stations = new Map();
    this.lastPumps = new Map();
    this.pulse = new Map();
    this.localPumps = 0;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.finaleDone = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Pump-Panik" });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="pump-button" data-pump>
        <span class="pump-button-face">PUMPEN!</span>
      </button>
    `;
    this.pumpButton = this.controls.querySelector("[data-pump]");
    this.onPumpDown = (event) => {
      event.preventDefault();
      this.pressPump();
    };
    this.pumpButton.addEventListener("pointerdown", this.onPumpDown);
    this.onCanvasTap = (event) => {
      event.preventDefault();
      this.pressPump();
    };
    this.webglCanvas.addEventListener("pointerdown", this.onCanvasTap);
    this.loop();
  }

  pressPump() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    this.localPumps += 1;
    this.feedback?.sound("pop");
    this.feedback?.vibrate(6);
    this.sendInput({ action: "pump" }).catch(() => {});
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
    this.stations.clear();
  }

  createScene() {
    addStageLights(this.scene);

    // Festival meadow with a wooden pump deck.
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.5, 18),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    this.scene.add(meadow);
    // Kulisse: Bodenflecken, Büschel, Blumen, Steine und ein Baumkranz als
    // Horizont. Ohne sie stösst die Wiese als harte Kante gegen den Himmel.
    dressMeadow(this.scene, { seed: 6, keepOut: { x: 4.6, z: 3.4 }, spread: { x: 17, z: 15 }, grassColor: "#7ec96a", patchColors: ["#8ed477", "#a7e08c"], crownColor: "#3fa05a", crownColor2: "#5cb96f", crownShape: "palm", trunkColor: "#94693c" });
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(9.4, 0.3, 4.4),
      new THREE.MeshLambertMaterial({ color: "#c98d4e" })
    );
    deck.position.set(0, 0.15, 0);
    deck.receiveShadow = true;
    this.scene.add(deck);

    [[-7, 5.2, -5, 5], [7, 6, -3, 6], [0, 6.5, -8, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureStation(player, index, players.length));
    this.resizeRenderer();
    this.camera.position.set(0, 3.4, 9.4);
    this.camera.lookAt(0, 1.8, 0);
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * STATION_GAP;
  }

  // A blocky balloon: fat core + side bulges + knot, all in the player colour.
  buildBalloon(color) {
    const balloon = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color });
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.62), mat);
    balloon.add(core);
    [[0.3, 0, 0], [-0.3, 0, 0], [0, 0, 0.3], [0, 0, -0.3]].forEach(([x, y, z]) => {
      const bulge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.34), mat);
      bulge.position.set(x, y + 0.03, z);
      balloon.add(bulge);
    });
    const topBulge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), mat);
    topBulge.position.y = 0.42;
    balloon.add(topBulge);
    const highlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.2, 0.05),
      new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.6 })
    );
    highlight.position.set(-0.16, 0.22, 0.32);
    balloon.add(highlight);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat);
    knot.position.y = -0.44;
    balloon.add(knot);
    return balloon;
  }

  ensureStation(player, index, count) {
    if (this.stations.has(player.id)) return this.stations.get(player.id);
    const x = this.stationX(index, count);

    // Air pump box the Kin stomps on.
    const pump = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.34, 0.5),
      new THREE.MeshLambertMaterial({ color: "#e04a58" })
    );
    pump.position.set(x + 0.62, 0.47, 0.4);
    pump.castShadow = true;
    this.scene.add(pump);
    const hose = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.7),
      new THREE.MeshLambertMaterial({ color: "#40506a" })
    );
    hose.position.set(x + 0.35, 0.36, 0.12);
    hose.rotation.y = 0.5;
    this.scene.add(hose);

    const balloon = this.buildBalloon(player.color);
    balloon.position.set(x, 2.1, -0.2);
    balloon.scale.setScalar(0.42);
    this.scene.add(balloon);
    const string = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 1, 0.03),
      new THREE.MeshLambertMaterial({ color: "#5a4a3a" })
    );
    string.position.set(x, 1.2, -0.2);
    this.scene.add(string);

    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.position.set(x, KIN_Y, 0.55);
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_Y;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);

    const station = { pump, balloon, string, x };
    this.stations.set(player.id, station);
    return station;
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
    const finale = Boolean(minigame.finaleAt);

    // Find the live leader for the finale lift-off.
    let best = -1;
    state.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (entry && (entry.pumps || 0) > best) best = entry.pumps || 0;
    });

    const players = state.players || [];
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const station = this.ensureStation(player, index, players.length);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      // Own balloon uses the local tap count so growth feels instant.
      const pumps = player.id === controlledId
        ? Math.max(entry.pumps || 0, this.localPumps)
        : (entry.pumps || 0);

      // Balloon grows with every pump and jiggles on fresh ones.
      if (pumps > (this.lastPumps.get(player.id) || 0)) {
        this.lastPumps.set(player.id, pumps);
        this.pulse.set(player.id, 1);
        animator.trigger("jump");
        station.pump.scale.y = 0.55;
      }
      let pulse = (this.pulse.get(player.id) || 0) * 0.88;
      this.pulse.set(player.id, pulse);
      station.pump.scale.y = THREE.MathUtils.lerp(station.pump.scale.y, 1, frameLerp(0.2, dt));

      const size = 0.42 + Math.min(1.75, pumps * 0.018);
      const wobble = 1 + pulse * 0.16 + Math.sin(now / 300 + index) * 0.015;
      station.balloon.scale.set(size * wobble, size * (1 + pulse * 0.22), size * wobble);
      station.balloon.position.y = 2.1 + size * 0.4 + Math.sin(now / 700 + index * 1.7) * 0.06;
      station.balloon.rotation.z = Math.sin(now / 900 + index) * 0.06;
      const balloonBottom = station.balloon.position.y - size * 0.45;
      station.string.scale.y = Math.max(0.2, balloonBottom - KIN_Y);
      station.string.position.y = (balloonBottom + KIN_Y) / 2;

      if (finale) {
        const isWinner = (entry.pumps || 0) === best && best > 0;
        const sinceFinale = Math.max(0, now - minigame.finaleAt + 2600);
        if (isWinner) {
          animator.set("cheer", { base: true });
          if (!station.popped) {
            // Over-inflate dramatically ... and POP!
            const swell = 1 + Math.min(1.15, sinceFinale / 900) + Math.sin(now / 60) * 0.05;
            station.balloon.scale.multiplyScalar(swell / Math.max(0.001, station.balloon.userData.lastSwell || 1));
            station.balloon.userData.lastSwell = swell;
            if (sinceFinale > 1000) {
              station.popped = true;
              station.balloon.visible = false;
              station.string.visible = false;
              this.shake = 1;
              const at = station.balloon.position.clone();
              this.bursts.spawn(at, [player.color, "#ffffff"], { count: 30, speed: 4.2, up: 2.6, size: 0.12, life: 1.1, drag: 1.1 });
              this.bursts.spawn(at, ["#ffd15c", player.color, "#ffffff"], { count: 20, speed: 2.5, up: 3.4, size: 0.09, life: 1.3, drag: 0.9 });
              this.bursts.ring(at, "#ffffff", { radius: 2.6, life: 0.55, opacity: 0.65, tilt: null });
              this.floaters.pop(at.clone().add(new THREE.Vector3(0, 0.5, 0)), "PENG! 🎈", { color: "#ffe36b", size: 0.5, life: 1.1 });
              this.feedback?.sound("impact");
              this.feedback?.vibrate([40, 26, 50]);
              if (player.id === controlledId) this.feedback?.sound("win");
            }
          } else if (Math.random() < frameChance(0.2, dt)) {
            // Confetti keeps drizzling on the champion.
            this.bursts.spawn(new THREE.Vector3(station.x + (Math.random() - 0.5), 3.4, -0.2), [player.color, "#ffd15c", "#ffffff"], { count: 2, speed: 0.6, up: 0.2, size: 0.07, life: 1.2 });
          }
        } else {
          // Die anderen Ballons machen schlapp — aber nicht alle gleich: Platz 2
          // nimmt es gefasst, Platz 4 knickt ein. Vorher waren alle drei
          // gleichermassen traurig.
          applyFinaleMood(animator, arcade.places?.[player.id], players.length);
          if (!station.deflated) {
            station.deflated = true;
            station.deflateFrom = size;
          }
          const shrink = Math.max(0.12, (station.deflateFrom || size) * Math.max(0.1, 1 - sinceFinale / 1400));
          station.balloon.scale.setScalar(shrink);
          station.balloon.position.x = station.x + Math.sin(now / 90 + index) * Math.min(0.4, sinceFinale / 1200);
          if (sinceFinale < 1400 && Math.random() < frameChance(0.3, dt)) {
            this.bursts.spawn(station.balloon.position.clone(), ["#ffffff"], { count: 1, speed: 0.8, up: 0.3, size: 0.04, life: 0.3 });
          }
        }
      } else {
        animator.set("idle", { base: true });
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.32, kin.position.z);
      kin.userData.shadow.material.opacity = Math.max(0.08, 0.26 - (animator.groundY - KIN_Y) * 0.08);
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);

    this.floaters.update(dt, this.camera);

    this.shake *= frameDecay(0.9, dt);
    const desired = new THREE.Vector3(Math.sin(now / 3200) * 0.15, (this.baseCamY || 3.4), this.baseCamZ || 9.4);
    this.camera.position.lerp(desired, frameLerp(0.08, dt));
    this.camera.lookAt(0, 1.9, 0);

    this.updateHud(minigame, arcade, state, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    // Sicherstellen, dass alle Figuren im Bild sind — notfalls weicht die
    // Kamera zurück. Auf dem Handy ist der Ausschnitt schmal, und wer sich
    // selbst nicht sieht, spielt blind.
    fitKinsInView(this);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    const shown = Math.max(own?.pumps || 0, this.localPumps);
    this.hud.querySelector("[data-kinetic-score]").textContent = String(shown);
    if (this.pumpButton) this.pumpButton.disabled = Boolean(minigame.finaleAt);
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 3.8 : 3.4;
            // Weiter zurück: gemessen ragte die Hülle der äusseren Figuren
      // -0.037 über den Bildrand hinaus — meist das Namensschild, das
      // breiter ist als die Figur. Hochkant ist der sichtbare Ausschnitt
      // schmal, und die Reihe steht quer dazu.
this.baseCamZ = portrait ? 12.7 : 9.4;
      camera.fov = portrait ? 54 : 48;
    });
  }
}
