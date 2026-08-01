import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  standOn
} from "./VoxelKit.js?v=tumblekin111";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage,
  fitKinsInView
} from "./SceneKit.js?v=tumblekin111";
import { frameDecay, frameLerp, fxScale, shakeScale } from "./Quality.js?v=tumblekin111";

// Blitzreflex — drei Läufe, jeder eine Startampel. Rot, Rot, Rot … und dann
// GRÜN. Wer im richtigen Moment tippt, gewinnt Millisekunden; wer vorher tippt,
// kassiert einen Fehlstart, der teurer ist als jede langsame Reaktion.
//
// Der ganze Bildschirm ist der Knopf. Bei einem Spiel, in dem es um
// Hundertstel geht, ist jeder Weg zum Knopf verlorene Zeit — und ein kleiner
// Knopf am unteren Rand zwingt den Blick von der Ampel weg, genau in dem
// Moment, in dem sie umspringt.
const LAMP_Y = 3.5;
const LAMP_Z = -2.4;
const LANE_GAP = 1.0;
const KIN_Z = 1.8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class FlashReflex {
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
    this.lastCount = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.greenSeen = -1;
    this.lampPulse = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Blitzreflex", background: "#9fd9f0", fog: ["#c3e6f6", 16, 44], fov: 58, far: 80 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>—</strong></div>
      <div class="react-rounds" data-react-rounds></div>
      <div class="color-banner react-banner" data-react-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `<p class="trace-hint">Tippe irgendwo, sobald es GRÜN wird</p>`;
    this.controls.style.pointerEvents = "none";

    this.onTap = (event) => {
      event.preventDefault();
      const minigame2 = this.update || this.minigame;
      if (!minigame2 || minigame2.finaleAt) return;
      this.feedback?.sound("tap");
      this.sendInput({ action: "tap" }).catch(() => {});
    };
    this.webglCanvas.addEventListener("pointerdown", this.onTap);
    this.loop();
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    this.webglCanvas?.removeEventListener("pointerdown", this.onTap);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-4, 11, 7],
      shadow: { left: -5, right: 5, top: 8, bottom: -3 }
    });

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#6fc4a0" })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const track = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP * 4.6, 0.04, 7),
      new THREE.MeshLambertMaterial({ color: "#adbcb2" })
    );
    track.position.set(0, 0.01, 0);
    track.receiveShadow = true;
    this.scene.add(track);

    const line = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP * 4.6, 0.02, 0.16),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false })
    );
    line.position.set(0, 0.04, KIN_Z + 0.5);
    this.scene.add(line);

    this.buildLamp();

    [[-6.2, 6.4, -7, 4], [6.0, 7.1, -6, 9]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureKin(player, index, players.length));
    this.resizeRenderer();
    this.camera.position.set(0, 2.9, 6.4);
    this.camera.lookAt(0, 2.0, -0.6);
  }

  // Eine Startampel mit drei Lampen. Die beiden oberen sind Rot und bleiben es;
  // nur die unterste springt auf Grün. Drei Lampen statt einer, weil man dann
  // im Augenwinkel sieht, WO das Grün erscheinen wird.
  buildLamp() {
    const steel = new THREE.MeshLambertMaterial({ color: "#37445a" });
    const dark = new THREE.MeshLambertMaterial({ color: "#1b232f" });

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, LAMP_Y - 0.9, 10), steel);
    mast.position.set(0, (LAMP_Y - 0.9) / 2, LAMP_Z);
    mast.castShadow = true;
    this.scene.add(mast);

    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 0.4), dark);
    box.position.set(0, LAMP_Y, LAMP_Z - 0.1);
    box.castShadow = true;
    this.scene.add(box);

    this.lamps = [];
    for (let i = 0; i < 3; i += 1) {
      const lamp = new THREE.Mesh(
        new THREE.CircleGeometry(0.36, 22),
        new THREE.MeshBasicMaterial({ color: "#2a3340", toneMapped: false })
      );
      lamp.position.set(0, LAMP_Y + 0.85 - i * 0.85, LAMP_Z + 0.11);
      this.scene.add(lamp);
      this.lamps.push(lamp);
    }

    this.glow = new THREE.PointLight("#4dff7a", 0, 14);
    this.glow.position.set(0, LAMP_Y, LAMP_Z + 1.4);
    this.scene.add(this.glow);

    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.72, 26),
      new THREE.MeshBasicMaterial({ color: "#4dff7a", transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    this.halo.position.set(0, LAMP_Y - 0.85, LAMP_Z + 0.12);
    this.scene.add(this.halo);
  }

  ensureKin(player, index, count) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.66;
    kin.add(label);
    const x = (index - (count - 1) / 2) * LANE_GAP;
    kin.position.set(x, standOn(0), KIN_Z);
    this.scene.add(kin);
    const shadow = createShadowBlob(0.44);
    shadow.position.set(x, 0.06, KIN_Z);
    this.scene.add(shadow);
    kin.userData.laneX = x;
    this.kins.set(player.id, kin);
    const animator = new KinAnimator(kin);
    animator.groundY = standOn(0);
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
    const elapsed = Math.max(0, now - minigame.startedAt);
    const controlledId = this.getControlledPlayerId();
    const own = arcade.players[controlledId];

    const roundIndex = own ? Math.min((own.times || []).length, arcade.rounds.length - 1) : 0;
    const round = arcade.rounds[roundIndex];
    this.paintLamp(round, elapsed, dt, own);

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index, state.players.length);
      const animator = this.animators.get(player.id);
      const times = entry.times || [];

      if (times.length > (this.lastCount.get(player.id) || 0)) {
        this.lastCount.set(player.id, times.length);
        const last = times[times.length - 1];
        const at = kin.position.clone().add(new THREE.Vector3(0, 1.1, 0));
        // Ein Fehlstart kostet die volle Strafzeit — der Unterschied muss ohne
        // Text erkennbar sein.
        const falseStart = last >= 900;
        if (falseStart) {
          animator?.trigger("stumble");
          this.bursts.spawn(at, ["#ff6b7f", "#ffffff"], { count: 8 * fxScale(), speed: 1.4, up: 1.0, size: 0.06, life: 0.5, drag: 2.2 });
          if (player.id === controlledId) {
            this.floaters.pop(at, "FEHLSTART!", { color: "#ff9aa8", size: 0.38, life: 0.9 });
            this.feedback?.sound("error");
            this.feedback?.vibrate(26);
            this.shake = Math.max(this.shake, 0.4);
          }
        } else {
          animator?.trigger("jump");
          this.bursts.spawn(at, [player.color, "#4dff7a", "#ffffff"], { count: 12 * fxScale(), speed: 1.8, up: 2.0, size: 0.07, life: 0.6, drag: 1.8 });
          if (player.id === controlledId) {
            this.floaters.pop(at, `${last} ms`, { color: last < 260 ? "#ffe36b" : "#c6ffb0", size: last < 260 ? 0.42 : 0.34, life: 0.8 });
            this.feedback?.sound(last < 260 ? "perfect" : "pop");
            this.feedback?.vibrate([8, 10, 14]);
          }
        }
      }

      if (minigame.finaleAt) {
        applyFinaleMood(animator, this.finalePlace(arcade, state, player.id), state.players.length);
      } else {
        // Vor dem Grün geht jeder in die Hocke — das ist die Ansage, dass es
        // gleich losgeht, ohne dass ein Text es sagen muss.
        const armed = round && elapsed >= round.armFrom && elapsed < round.greenAt;
        animator?.set(armed ? "idle" : "idle", { base: true });
        kin.scale.y = armed ? 0.86 : 1;
        kin.position.z = KIN_Z - ((entry.times || []).length * 0.35);
      }
      animator?.update(now);
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.86, dt);
    const shakeX = Math.sin(now / 11) * this.shake * 0.2 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * frameLerp(0.4, dt);
    this.camera.position.y = this.baseCamY || 2.9;
    this.camera.position.z = this.baseCamZ || 6.4;
    this.camera.lookAt(0, 2.0, -0.6);

    this.updateHud(minigame, arcade, state, now, own, round, elapsed);
    // Sicherstellen, dass alle Figuren im Bild sind — notfalls weicht die
    // Kamera zurück. Auf dem Handy ist der Ausschnitt schmal, und wer sich
    // selbst nicht sieht, spielt blind.
    fitKinsInView(this);
    this.renderer.render(this.scene, this.camera);
  }

  paintLamp(round, elapsed, dt, own) {
    if (!this.lamps) return;
    const done = own ? (own.times || []).length >= (this.update || this.minigame).arcade.rounds.length : false;
    const armed = Boolean(round) && elapsed >= round.armFrom && elapsed < round.greenAt;
    const green = Boolean(round) && elapsed >= round.greenAt && !done;

    // Die beiden oberen Lampen zeigen an, dass der Lauf scharf ist. Sie gehen
    // NACHEINANDER an — daran sieht man, dass gleich etwas passiert, ohne zu
    // wissen wann.
    const since = round ? elapsed - round.armFrom : -1;
    this.lamps[0].material.color.set(armed && since > 0 ? "#ff4f68" : "#2a3340");
    this.lamps[1].material.color.set(armed && since > 420 ? "#ff4f68" : "#2a3340");
    this.lamps[2].material.color.set(green ? "#4dff7a" : "#2a3340");

    if (green && round.index !== this.greenSeen) {
      this.greenSeen = round.index;
      this.lampPulse = 1;
      this.feedback?.sound("countdown");
    }
    this.lampPulse = Math.max(0, this.lampPulse - dt * 3);
    this.lamps[2].scale.setScalar(1 + this.lampPulse * 0.3);

    this.glow.intensity += ((green ? 13 : 0) - this.glow.intensity) * 0.45;
    this.halo.material.opacity += ((green ? 0.6 : 0) - this.halo.material.opacity) * 0.35;
    this.halo.scale.setScalar(1 + this.lampPulse * 0.4);
  }

  finalePlace(arcade, state, playerId) {
    // Weniger Gesamtzeit ist besser.
    const total = (entry) => {
      const times = entry?.times || [];
      const missing = arcade.rounds.length - times.length;
      return times.reduce((sum, value) => sum + value, 0) + missing * 2200;
    };
    const scored = state.players
      .map((player) => ({ id: player.id, total: total(arcade.players[player.id]) }))
      .sort((a, b) => a.total - b.total);
    const index = scored.findIndex((entry) => entry.id === playerId);
    return index < 0 ? state.players.length : index + 1;
  }

  updateHud(minigame, arcade, state, now, own, round, elapsed) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    const times = own?.times || [];
    const best = times.length > 0 ? Math.min(...times) : null;
    this.hud.querySelector("[data-kinetic-score]").textContent = best === null ? "—" : `${best} ms`;

    const rounds = this.hud.querySelector("[data-react-rounds]");
    if (rounds) {
      rounds.innerHTML = arcade.rounds.map((_r, i) => {
        const value = times[i];
        const state2 = value === undefined ? "open" : (value >= 900 ? "bad" : "good");
        const text = value === undefined ? "–" : `${value}`;
        return `<span class="react-slot is-${state2}">${text}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-react-banner]");
    if (!banner) return;
    const done = times.length >= arcade.rounds.length;
    if (done) {
      banner.hidden = false;
      const total = times.reduce((sum, value) => sum + value, 0);
      banner.textContent = `Alle drei durch · ${total} ms gesamt`;
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
    } else if (round && elapsed >= round.greenAt) {
      banner.hidden = false;
      banner.textContent = "JETZT!";
      banner.style.background = "#4dff7a";
      banner.style.color = "#0d3218";
    } else if (round && elapsed >= round.armFrom) {
      banner.hidden = false;
      banner.textContent = "Achtung — noch nicht!";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Die Ampel muss im oberen Drittel gross im Bild stehen: darauf schaut man
      // die ganze Zeit, und jede Kopfbewegung kostet hier Hundertstel.
      this.baseCamY = portrait ? 2.9 : 2.6;
      this.baseCamZ = portrait ? 6.4 : 7.0;
      camera.fov = portrait ? 58 : 46;
    });
  }
}
