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
} from "./VoxelKit.js?v=tumblekin84";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin84";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin84";

// Trampolin — ein Takt schlägt gleichmässig; tippt man IM Takt, federt der Kin
// höher. Treffer in Folge bauen Resonanz auf, ein Fehltritt bricht sie. Der Takt
// wird schneller, man muss sich also immer neu einhören.
// Die Taktzeiten kommen jetzt aus dem Spielzustand (arcade.tempos und
// arcade.barBeats), NICHT aus abgeschriebenen Konstanten. Vorher standen hier
// drei Zahlen, die mit dem Server übereinstimmen mussten; wich eine davon ab,
// zeigte die Taktanzeige einen anderen Schlag an als der Server wertete, und der
// Versatz wuchs mit jeder Sekunde der Runde.
const FALLBACK_TEMPOS = [900, 800, 720, 650, 590, 540];
const FALLBACK_BAR = 8;
// Bahnabstand ist am Portrait-Bild gerechnet, nicht geschätzt: bei z=9.6 und
// 62° FOV reicht das sichtbare Fenster bis ±2.66. Mit 2.1 Abstand lagen die
// äusseren Bahnen bei ±3.15 — der eigene Kin war je nach Index gar nicht im
// Bild. 1.25 setzt sie auf ±1.88, die Ränder bleiben mit Rand sichtbar.
const LANE_GAP = 1.25;
const PAD_R = 0.46;
const PAD_Y = 0.3;
const WORLD_PER_HEIGHT = 0.28;   // Server-Höheneinheit → Weltmaß
// Höhenstufen. Vorher gab es genau zwei Zustände — springt oder steht — und auf
// dreissig Höhenmetern sah das aus wie auf drei. Der Aufstieg muss sich ansehen
// lassen, sonst fühlt er sich folgenlos an.
const TIER_HEIGHTS = [4, 9, 16, 26, 40];
const TIER_LABELS = ["ABGEHOBEN!", "HOCH HINAUS!", "ÜBER DEN WOLKEN!", "SCHWERELOS!", "IN DEN STERNEN!"];

// Der Abstand VOR dem Schlag mit dieser Nummer. Innerhalb eines Taktes gleich,
// an der Taktgrenze eine Stufe schneller.
function beatInterval(index, tempos, bar) {
  const step = Math.floor(Math.max(0, index - 1) / bar);
  return tempos[Math.min(step, tempos.length - 1)];
}

// Nächster Schlag zu `elapsed` plus der Abstand zum folgenden — für die Anzeige.
function beatWindow(elapsed, arcade) {
  const tempos = arcade?.tempos?.length ? arcade.tempos : FALLBACK_TEMPOS;
  const bar = arcade?.barBeats || FALLBACK_BAR;
  let index = 0;
  let time = 0;
  while (time + beatInterval(index + 1, tempos, bar) <= elapsed) {
    time += beatInterval(index + 1, tempos, bar);
    index += 1;
  }
  const interval = beatInterval(index + 1, tempos, bar);
  // Wie viele Schläge noch bis zum Tempowechsel — daran hängt die Ansage.
  const inBar = index % bar;
  const step = Math.floor(index / bar);
  const faster = step < tempos.length - 1;
  return { index, start: time, interval, inBar, bar, step, beatsToChange: faster ? bar - inBar : null };
}

export class Trampoline {
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
    this.pads = new Map();
    this.lastTapAt = new Map();
    this.tierSeen = new Map();
    this.lastBarStep = null;
    this.lastBeatSeen = -1;
    this.lastFrameAt = performance.now();
    this.shake = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Trampolin", fog: ["#a8e2f4", 18, 46], fov: 50, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="beat-strip" data-beat-strip>
        <div class="beat-pulse" data-beat-pulse></div>
        <span data-beat-label>Im Takt tippen</span>
      </div>
      <div class="color-banner" data-bounce-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-bounce-jump>
        <span class="nerve-button-face">HÜPFEN!</span>
      </button>
    `;
    this.button = this.controls.querySelector("[data-bounce-jump]");
    this.onTap = (event) => {
      event.preventDefault();
      this.pressJump();
    };
    this.button.addEventListener("pointerdown", this.onTap);
    this.webglCanvas.addEventListener("pointerdown", this.onTap);
    this.loop();
  }

  pressJump() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    this.feedback?.sound("tap");
    this.sendInput({ action: "jump" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.button?.removeEventListener("pointerdown", this.onTap);
    this.webglCanvas?.removeEventListener("pointerdown", this.onTap);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
    this.pads.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-4, 14, 7],
      shadow: { left: -8, right: 8, top: 14, bottom: -4 }
    });

    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    this.scene.add(meadow);

    // Höhenmarken an einem Messpfosten — die Höhe ist die Wertung, also muss
    // man sie ablesen können.
    for (let mark = 5; mark <= 30; mark += 5) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(9.5, 0.04, 0.06),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.28, depthWrite: false })
      );
      bar.position.set(0, PAD_Y + mark * WORLD_PER_HEIGHT, -1.4);
      this.scene.add(bar);
    }

    [[-7, 6.4, -6, 5], [7, 7.2, -4, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensurePad(player, index, players.length));
    this.resizeRenderer();
    this.camera.position.set(0, 2.6, 7.4);
    this.camera.lookAt(0, 1.6, 0);
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  ensurePad(player, index = 0, count = 4) {
    if (this.pads.has(player.id)) return this.pads.get(player.id);
    const x = this.laneX(index, count);

    // Trampolin: Rahmen plus federndes Tuch.
    const frame = new THREE.Mesh(
      new THREE.TorusGeometry(PAD_R, 0.07, 6, 18),
      new THREE.MeshLambertMaterial({ color: "#40506a" })
    );
    frame.rotation.x = Math.PI / 2;
    frame.position.set(x, PAD_Y, 0);
    this.scene.add(frame);
    const cloth = new THREE.Mesh(
      new THREE.CylinderGeometry(PAD_R - 0.06, PAD_R - 0.06, 0.05, 18),
      new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.15 })
    );
    cloth.position.set(x, PAD_Y, 0);
    cloth.receiveShadow = true;
    this.scene.add(cloth);
    [-1, 1].forEach((side) => {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, PAD_Y, 0.08),
        new THREE.MeshLambertMaterial({ color: "#40506a" })
      );
      leg.position.set(x + side * (PAD_R - 0.1), PAD_Y / 2, 0);
      this.scene.add(leg);
    });

    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.position.set(x, PAD_Y + 0.4, 0);
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = PAD_Y + 0.4;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);

    const pad = { x, cloth, frame, color: player.color };
    this.pads.set(player.id, pad);
    return pad;
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

    // Takt: wo stehen wir zwischen zwei Schlägen?
    const window = beatWindow(elapsed, arcade);
    this.lastWindow = window;
    const phase = Math.min(1, Math.max(0, (elapsed - window.start) / window.interval));
    // Hörbarer Taktschlag, damit man sich einhören kann statt nur zu schauen.
    if (window.index !== this.lastBeatSeen) {
      this.lastBeatSeen = window.index;
      // Die EINS eines Taktes klingt anders als die übrigen sieben. Genau daran
      // hört man, wo der Takt anfängt — ohne diese Betonung ist ein
      // gleichmässiger Puls nur ein Ticken, in das man sich nicht einhören kann.
      this.feedback?.sound(window.inBar === 0 ? "clack" : "plink");
    }
    // Tempowechsel: er kommt an einer Taktgrenze und wird angekündigt, statt
    // schleichend zu passieren.
    if (window.step !== this.lastBarStep) {
      if (this.lastBarStep !== undefined && this.lastBarStep !== null) {
        this.floaters.pop(new THREE.Vector3(0, 3.2, 0), "SCHNELLER!", { color: "#ffe36b", size: 0.44, life: 1 });
        this.feedback?.sound("combo");
      }
      this.lastBarStep = window.step;
    }

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const pad = this.ensurePad(player, index, state.players.length);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);

      // Höhe federn: der Kin schwingt zwischen Tuch und erreichter Höhe.
      const peak = PAD_Y + 0.4 + (entry.height || 0) * WORLD_PER_HEIGHT;
      const swing = Math.abs(Math.sin(phase * Math.PI));
      animator.groundY = THREE.MathUtils.lerp(
        animator.groundY,
        PAD_Y + 0.4 + ((peak - PAD_Y - 0.4) * swing),
        0.35
      );
      // Tuch dellt sich, wenn der Kin unten ist.
      pad.cloth.scale.y = 1 - (1 - swing) * 0.5;
      pad.cloth.position.y = PAD_Y - (1 - swing) * 0.06;

      // Rückmeldung zum letzten Tipp.
      const tap = entry.lastTap;
      const seen = this.lastTapAt.get(player.id);
      if (tap && tap.at !== seen) {
        this.lastTapAt.set(player.id, tap.at);
        const at = new THREE.Vector3(pad.x, animator.groundY + 0.5, 0);
        if (tap.grade === "perfect") {
          this.bursts.spawn(at, [pad.color, "#ffe36b", "#ffffff"], { count: 12, speed: 1.8, up: 2, size: 0.07, life: 0.6, drag: 1.8 });
          this.floaters.pop(at, entry.streak > 2 ? `${entry.streak}× IM TAKT!` : "IM TAKT!", { color: "#ffe36b", size: 0.38, life: 0.8 });
          if (player.id === controlledId) { this.feedback?.sound("perfect"); this.feedback?.vibrate([8, 12, 14]); }
        } else if (tap.grade === "good") {
          this.floaters.pop(at, "fast", { color: "#bfe9ff", size: 0.3, life: 0.6, rise: 0.6 });
          if (player.id === controlledId) this.feedback?.sound("pop");
        } else {
          this.bursts.spawn(at, ["#ff6b7f", "#ffffff"], { count: 8, speed: 1.4, up: 1, size: 0.06, life: 0.5, drag: 2.2 });
          this.floaters.pop(at, "DANEBEN", { color: "#ff9aa8", size: 0.32, life: 0.7 });
          if (player.id === controlledId) {
            this.feedback?.sound("error");
            this.feedback?.vibrate(20);
            this.shake = Math.max(this.shake, 0.3);
          }
        }
      }

      // Je höher man kommt, desto ausgelassener wird die Figur. Vorher gab es
      // genau zwei Zustände (springt / steht) — auf 30 Höhenmetern sah das
      // exakt so aus wie auf dreien, und der ganze Aufstieg fühlte sich
      // folgenlos an.
      const tier = this.heightTier(entry.height || 0);
      if (minigame.finaleAt) {
        const place = this.finalePlace(arcade, state, player.id);
        applyFinaleMood(animator, place, state.players.length);
      } else if (swing > 0.35) {
        animator.set(tier >= 2 ? "cheer" : "jump", { base: true });
      } else {
        animator.set("idle", { base: true });
      }
      // Der Kin dreht sich in der Luft, sobald es richtig hoch geht — das ist
      // die Belohnung dafür, den Takt gehalten zu haben.
      kin.rotation.y = tier >= 1 ? kin.rotation.y + dt * (1.6 + tier * 1.8) * swing : 0;
      // Und er streckt sich am höchsten Punkt.
      kin.scale.setScalar(1 + swing * 0.06 * tier);
      animator.update(now);

      // Beim Überschreiten einer Höhenstufe gibt es einen sichtbaren Moment.
      const known = this.tierSeen.get(player.id) ?? 0;
      if (tier > known) {
        this.tierSeen.set(player.id, tier);
        const at = new THREE.Vector3(pad.x, animator.groundY + 0.7, 0);
        this.bursts.spawn(at, [pad.color, "#ffffff", "#ffe36b"],
          { count: 10 + tier * 6, speed: 2.0 + tier * 0.4, up: 2.2, size: 0.08, life: 0.8, drag: 1.5 });
        this.floaters.pop(at, TIER_LABELS[Math.min(tier, TIER_LABELS.length - 1)],
          { color: "#ffe36b", size: 0.4 + tier * 0.04, life: 1 });
        if (player.id === controlledId) {
          this.feedback?.sound("sparkle");
          this.feedback?.vibrate([10, 8, 16]);
        }
      }

      kin.userData.shadow.position.set(pad.x, 0.05, 0);
      kin.userData.shadow.material.opacity = 0.1 + (1 - swing) * 0.2;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    // Kamera steigt mit der höchsten Figur, damit der Rekord im Bild bleibt.
    const highest = Math.max(0, ...state.players.map((p) => arcade.players[p.id]?.height || 0));
    this.shake *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
    const lift = highest * WORLD_PER_HEIGHT * 0.5;
    // Leichte Vorspannung zur eigenen Bahn, damit man sich immer sieht, ohne
    // die Rivalen aus dem Bild zu schieben.
    const ownX = (this.pads.get(controlledId)?.x || 0) * 0.35;
    const desired = new THREE.Vector3(ownX + shakeX, (this.baseCamY || 2.6) + lift, (this.baseCamZ || 8.0) + lift * 0.5);
    this.camera.position.lerp(desired, frameLerp(0.08, dt));
    this.camera.lookAt(ownX * 0.6, 1.6 + lift, 0);

    this.updateHud(minigame, arcade, state, now, phase);
    syncOwnMarker(this, this.kins?.get(controlledId), now);
    this.renderer.render(this.scene, this.camera);
  }

  // Welche Höhenstufe gerade erreicht ist. 0 = noch am Boden herumfedern.
  heightTier(height) {
    let tier = 0;
    for (let i = 0; i < TIER_HEIGHTS.length; i += 1) {
      if (height >= TIER_HEIGHTS[i]) tier = i + 1;
    }
    return tier;
  }

  finalePlace(arcade, state, playerId) {
    const scored = state.players
      .map((player) => ({ id: player.id, height: arcade.players[player.id]?.height || 0 }))
      .sort((a, b) => b.height - a.height);
    const index = scored.findIndex((entry) => entry.id === playerId);
    return index < 0 ? state.players.length : index + 1;
  }

  updateHud(minigame, arcade, state, now, phase) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = (own?.height || 0).toFixed(1);

    // Taktanzeige: der Puls läuft von links nach rechts, der Treffer liegt am
    // rechten Ende. So sieht man den Schlag kommen statt ihn zu erraten.
    const pulse = this.hud.querySelector("[data-beat-pulse]");
    if (pulse) {
      pulse.style.transform = `scaleX(${phase.toFixed(3)})`;
      pulse.style.background = phase > 0.86 ? "#7fe06f" : "#ffe36b";
    }
    const label = this.hud.querySelector("[data-beat-label]");
    if (label) {
      label.textContent = own?.streak > 1 ? `${own.streak}× in Folge` : "Im Takt tippen";
    }

    const banner = this.hud.querySelector("[data-bounce-banner]");
    if (banner) {
      const beatsLeft = this.lastWindow?.beatsToChange;
      if (beatsLeft !== null && beatsLeft !== undefined && beatsLeft <= 2) {
        // Der Tempowechsel wird ZWEI Schläge vorher angesagt. Überraschend
        // schneller zu werden ist kein Können, sondern Pech — vorbereitet
        // schneller zu werden ist genau das, worum es geht.
        banner.hidden = false;
        banner.textContent = "Gleich schneller!";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if ((own?.streak || 0) >= 5) {
        banner.hidden = false;
        banner.textContent = `Resonanz ${own.streak}× — weiter so!`;
        banner.style.background = "#7fe06f";
        banner.style.color = "#14361a";
      } else {
        banner.hidden = true;
      }
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 2.9 : 2.6;
      this.baseCamZ = portrait ? 9.6 : 8.0;
      camera.fov = portrait ? 62 : 52;
    });
  }
}
