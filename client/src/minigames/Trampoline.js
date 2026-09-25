import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Trampolin: im Takt tippen — jeder Treffer trägt höher hinaus, ein
// Fehlgriff kostet Höhe. Der Takt wird mit der Zeit schneller.
//
// Vorher hüpften die Figuren in derselben Haltung auf und ab und drehten
// sich ab einer gewissen Höhe um die eigene Achse. Jetzt federn sie sichtbar
// ins Tuch, stossen sich ab, rudern in der Luft, machen weiter oben Saltos
// und fliegen ganz oben wie Superhelden. Die Kamera steigt mit der eigenen
// Figur.
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

export class Trampoline extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.pads = new Map();
    this.lastTapAt = new Map();
    this.tierSeen = new Map();
    this.lastBarStep = null;
    this.lastBeatSeen = -1;
    this.labelY = 0.74;
    this.ownPeak = PAD_Y + 0.4;
  }

  stage() {
    return {
      label: "3D Trampolin",
      background: "#a8e2f4",
      fog: ["#a8e2f4", 18, 46],
      lights: { sunPosition: [-4, 14, 7], shadow: { left: -8, right: 8, top: 14, bottom: -4 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="beat-strip" data-beat-strip>
        <div class="beat-pulse" data-beat-pulse></div>
        <span data-beat-label>Im Takt tippen</span>
      </div>
      <div class="color-banner" data-bounce-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    // Kulisse: Bodenflecken, Büschel, Blumen, Steine und ein Baumkranz als
    // Horizont. Ohne sie stösst die Wiese als harte Kante gegen den Himmel.
    dressMeadow(this.scene, { seed: 18, keepOut: { x: 5.0, z: 3.4 }, spread: { x: 18, z: 15 }, grassColor: "#74c46a", patchColors: ["#84cf78", "#9bdd8c"], crownColor: "#e88fb5", crownColor2: "#f2b3cd", trunkColor: "#6b4a2c", crownShape: "blob", flowerColors: ["#ff8fb1", "#ffffff", "#ffd15c"] });

    // Höhenmarken an einem Messpfosten — die Höhe ist die Wertung, also muss
    // man sie ablesen können.
    for (let mark = 5; mark <= 30; mark += 5) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(9.5, 0.04, 0.06),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.28, depthWrite: false })
      );
      bar.position.set(0, PAD_Y + mark * WORLD_PER_HEIGHT, -1.4);
      scene.add(bar);
    }

    [[-7, 6.4, -6, 5], [7, 7.2, -4, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addPad(player, index, players.length));
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  addPad(player, index, count) {
    const x = this.laneX(index, count);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(PAD_R, 0.07, 6, 18), new THREE.MeshLambertMaterial({ color: "#40506a" }));
    frame.rotation.x = Math.PI / 2;
    frame.position.set(x, PAD_Y, 0);
    this.scene.add(frame);
    const cloth = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R - 0.06, PAD_R - 0.06, 0.05, 18), new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.15 }));
    cloth.position.set(x, PAD_Y, 0);
    cloth.receiveShadow = true;
    this.scene.add(cloth);
    [-1, 1].forEach((side) => {
      [-1, 1].forEach((depth) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, PAD_Y, 0.07), new THREE.MeshLambertMaterial({ color: "#40506a" }));
        leg.position.set(x + side * (PAD_R - 0.12), PAD_Y / 2, depth * (PAD_R - 0.12));
        this.scene.add(leg);
      });
    });
    this.addKin(player, index, { x, ground: PAD_Y + 0.1, z: 0, facing: 0 });
    this.pads.set(player.id, { x, cloth, color: player.color, flip: 0, lastSwing: 0 });
  }

  shot() {
    const count = Math.max(1, this.pads.size);
    return {
      look: [0, 1.3, 0],
      frame: { w: count * LANE_GAP + 0.6, h: 3.2 },
      pitch: 0.12,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-bounce-jump>
        <span class="nerve-button-face">HÜPFEN!</span>
      </button>`;
    this.button = this.controls.querySelector("[data-bounce-jump]");
    const tap = (event) => {
      event.preventDefault();
      this.pressJump();
    };
    this.on(this.button, "pointerdown", tap);
    this.on(this.webglCanvas, "pointerdown", tap);
  }

  pressJump() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    this.feedback?.sound("tap");
    this.sendInput({ action: "jump" }).catch(() => {});
  }

  heightTier(height) {
    let tier = 0;
    for (let i = 0; i < TIER_HEIGHTS.length; i += 1) {
      if (height >= TIER_HEIGHTS[i]) tier = i + 1;
    }
    return tier;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const beat = beatWindow(elapsed, arcade);
    this.lastWindow = beat;
    const phase = Math.min(1, Math.max(0, (elapsed - beat.start) / beat.interval));
    this.phase = phase;
    if (beat.index !== this.lastBeatSeen) {
      this.lastBeatSeen = beat.index;
      this.feedback?.sound(beat.inBar === 0 ? "clack" : "plink");
    }
    if (beat.step !== this.lastBarStep) {
      if (this.lastBarStep !== null) {
        this.pop(new THREE.Vector3(0, this.ownPeak + 1.2, 0), "SCHNELLER!", { color: "#ffe36b", size: 0.44, life: 1 });
        this.feedback?.sound("combo");
      }
      this.lastBarStep = beat.step;
    }
    const swing = Math.abs(Math.sin(phase * Math.PI));

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const pad = this.pads.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !pad || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const rest = PAD_Y + 0.4 - (1 - swing) * 0.08;
      const peak = PAD_Y + 0.4 + (entry.height || 0) * WORLD_PER_HEIGHT;
      animator.groundY = THREE.MathUtils.lerp(animator.groundY, rest + (peak - PAD_Y - 0.4) * swing, frameLerp(0.35, dt));
      // Das Tuch gibt unten nach.
      const dip = Math.max(0, 0.35 - swing) / 0.35;
      pad.cloth.position.y = PAD_Y - dip * 0.12;
      pad.cloth.scale.set(1 + dip * 0.05, 1, 1 + dip * 0.05);
      if (isOwn) this.ownPeak = peak;

      const tap = entry.lastTap;
      if (tap && tap.at !== this.lastTapAt.get(player.id)) {
        this.lastTapAt.set(player.id, tap.at);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.6, 0));
        if (tap.grade === "perfect") {
          animator.expression("joy", 500);
          this.burst(at, [pad.color, "#ffe36b", "#ffffff"], { count: 12, speed: 1.8, up: 2, size: 0.07, life: 0.6, drag: 1.8 });
          // Schrift nur über der eigenen Figur: bei vier Springern stapelten
          // sich sonst "33× IM TAKT!" und "fast" zu einem Textberg.
          if (isOwn) this.pop(at, entry.streak > 2 ? `${entry.streak}× IM TAKT!` : "IM TAKT!", { color: "#ffe36b", size: 0.36, life: 0.8 });
          if (isOwn) {
            this.feedback?.sound("perfect");
            this.feedback?.vibrate([8, 12, 14]);
          }
        } else if (tap.grade === "good") {
          animator.expression("happy", 400);
          if (isOwn) this.pop(at, "fast", { color: "#bfe9ff", size: 0.28, life: 0.6, rise: 0.6 });
          if (isOwn) this.feedback?.sound("pop");
        } else {
          animator.trigger("flinch");
          animator.expression("scared", 600);
          this.burst(at, ["#ff6b7f", "#ffffff"], { count: 8, speed: 1.4, up: 1, size: 0.06, life: 0.5, drag: 2.2 });
          if (isOwn) this.pop(at, "DANEBEN", { color: "#ff9aa8", size: 0.3, life: 0.7 });
          if (isOwn) {
            this.feedback?.sound("error");
            this.feedback?.vibrate(20);
            this.rig.shake(0.3);
          }
        }
      }
      const tier = this.heightTier(entry.height || 0);
      const known = this.tierSeen.get(player.id) ?? 0;
      if (tier > known) {
        this.tierSeen.set(player.id, tier);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.8, 0));
        this.burst(at, [pad.color, "#ffffff", "#ffe36b"], { count: 10 + tier * 6, speed: 2.0 + tier * 0.4, up: 2.2, size: 0.08, life: 0.8, drag: 1.5 });
        if (isOwn) this.pop(at, TIER_LABELS[Math.min(tier, TIER_LABELS.length - 1)], { color: "#ffe36b", size: 0.38 + tier * 0.04, life: 1 });
        if (isOwn) {
          this.feedback?.sound("sparkle");
          this.feedback?.vibrate([10, 8, 16]);
        }
      }
      // Aufsetzen: kurz stauchen.
      if (pad.lastSwing > 0.2 && swing <= 0.2) animator.trigger("land");
      pad.lastSwing = swing;
      if (finale) {
        kin.rotation.x = 0;
        return;
      }
      // Salto ab der zweiten Stufe, einmal je Sprung über den Scheitel.
      if (tier >= 2 && swing > 0.3) pad.flip = Math.min(Math.PI * 2, pad.flip + dt * Math.PI * 2 / Math.max(0.25, beat.interval / 1000 * 0.7));
      if (swing < 0.3) pad.flip = 0;
      kin.rotation.x = tier >= 2 && tier < 4 ? -pad.flip : 0;
      if (swing < 0.3) animator.set("ready");
      else if (tier >= 4) animator.set("fly");
      else if (tier >= 1) animator.set("float");
      else animator.set("float");
    });
  }

  // Mit der eigenen Figur steigen.
  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    return own ? [own] : [...this.kins.values()];
  }

  rigOptions(f) {
    const count = Math.max(1, this.pads.size);
    const top = this.ownPeak;
    return {
      look: [0, Math.max(1.3, top * 0.55 + 0.6), 0],
      frame: { w: count * LANE_GAP + 0.6, h: Math.max(3.2, top + 1.4) }
    };
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const phase = this.phase || 0;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = (own?.height || 0).toFixed(1);
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
}
