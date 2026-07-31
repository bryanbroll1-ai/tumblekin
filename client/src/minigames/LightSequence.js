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
} from "./VoxelKit.js?v=tumblekin91";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin91";
import { frameDecay, frameLerp, fxScale, shakeScale } from "./Quality.js?v=tumblekin91";

// Leuchtfolge — vier Pilze leuchten der Reihe nach auf, danach tippt man sie in
// derselben Reihenfolge nach. Jede Runde ist die Folge einen Pilz länger.
//
// Die Pilze stehen im Quadrat und werden DIREKT angetippt, nicht über Knöpfe am
// unteren Rand. Beim Nachtippen schaut man ohnehin genau dorthin, wo eben etwas
// geleuchtet hat — ein Knopfstreifen wäre ein zweiter Ort für den Blick, und
// genau in dem Moment reisst die Erinnerung ab.
const COLOURS = ["#ff5d73", "#3fc5e8", "#ffd15c", "#71d97b"];
const COLOURS_DARK = ["#6d2230", "#164a5b", "#6b5417", "#2c5c33"];
const SPOTS = [
  { x: -1.15, z: -0.35 },
  { x: 1.15, z: -0.35 },
  { x: -1.15, z: 1.35 },
  { x: 1.15, z: 1.35 }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class LightSequence {
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
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pads = [];
    this.hitTargets = [];
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.shownStep = -1;
    this.shownRound = -1;
    this.lastProgress = 0;
    this.lastFailed = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Leuchtfolge", background: "#8fd3ef", fog: ["#b3e4f6", 20, 50], fov: 58, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-simon-round>Runde 1</div>
      <div class="simon-chips" data-simon-chips></div>
      <div class="color-banner simon-banner" data-simon-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `<p class="trace-hint">Erst zuschauen, dann in derselben Reihenfolge tippen</p>`;
    this.controls.style.pointerEvents = "none";

    this.onTap = (event) => {
      event.preventDefault();
      this.tapAt(event);
    };
    this.webglCanvas.addEventListener("pointerdown", this.onTap);
    this.loop();
  }

  tapAt(event) {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || !this.camera) return;
    // Während die Folge gezeigt wird, ist Tippen wirkungslos — der Server sagt
    // dasselbe, aber ohne Rückmeldung hier fühlt es sich wie ein Aussetzer an.
    if (!this.acceptingInput()) {
      this.feedback?.sound("clack");
      return;
    }
    const rect = this.webglCanvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitTargets, false);
    if (hits.length === 0) return;
    const index = hits[0].object.userData.padIndex;
    this.pads[index].press = 1;
    this.feedback?.sound("tap");
    this.sendInput({ action: "color", index }).catch(() => {});
  }

  activeRound() {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!arcade?.rounds) return null;
    const elapsed = Math.max(0, this.now() - minigame.startedAt);
    for (const round of arcade.rounds) {
      if (elapsed >= round.showFrom && elapsed <= round.until) return { round, elapsed };
      if (round.showFrom > elapsed) break;
    }
    return null;
  }

  acceptingInput() {
    const active = this.activeRound();
    return Boolean(active && active.elapsed >= active.round.inputFrom);
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
    this.pads.length = 0;
    this.hitTargets.length = 0;
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-4, 12, 8],
      shadow: { left: -5, right: 5, top: 8, bottom: -3 }
    });

    const glade = new THREE.Mesh(
      new THREE.BoxGeometry(14, 0.5, 14),
      new THREE.MeshLambertMaterial({ color: "#7bbf5e" })
    );
    glade.position.y = -0.25;
    glade.receiveShadow = true;
    this.scene.add(glade);

    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 0.06, 28),
      new THREE.MeshLambertMaterial({ color: "#5f9c47" })
    );
    ring.position.set(0, 0.03, 0.5);
    ring.receiveShadow = true;
    this.scene.add(ring);

    SPOTS.forEach((spot, index) => this.buildPad(spot, index));

    [[-5.4, 6.2, -8, 5], [5.2, 6.9, -9, 2]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildWatcher();
    this.resizeRenderer();
    this.camera.position.set(0, 5.0, 5.6);
    this.camera.lookAt(0, 0.5, 0.4);
  }

  // Ein Leuchtpilz je Farbe: Stiel, Hut und ein Leuchtring darunter. Der Hut
  // wächst beim Aufleuchten — Farbe allein liest man auf dem Handybild aus dem
  // Augenwinkel schlechter als Bewegung.
  buildPad(spot, index) {
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    this.scene.add(group);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 0.5, 10),
      new THREE.MeshLambertMaterial({ color: "#f2ece0" })
    );
    stem.position.y = 0.25;
    stem.castShadow = true;
    group.add(stem);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: COLOURS_DARK[index] })
    );
    cap.position.y = 0.5;
    cap.scale.y = 0.72;
    cap.castShadow = true;
    group.add(cap);

    // Weisse Tupfen auf dem Hut — sie zeigen die Drehung und machen aus der
    // Halbkugel einen Pilz statt einer Schüssel.
    for (let i = 0; i < 4; i += 1) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshLambertMaterial({ color: "#fff4dc" })
      );
      const angle = (i / 4) * Math.PI * 2;
      dot.position.set(Math.cos(angle) * 0.34, 0.68, Math.sin(angle) * 0.34);
      group.add(dot);
    }

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.86, 22),
      new THREE.MeshBasicMaterial({ color: COLOURS[index], transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    group.add(glow);

    const shadow = createShadowBlob(0.5);
    shadow.position.set(spot.x, 0.05, spot.z);
    this.scene.add(shadow);

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(spot.x, 0.5, spot.z);
    hit.userData.padIndex = index;
    this.scene.add(hit);
    this.hitTargets.push(hit);

    this.pads.push({
      index, group, cap, glow,
      base: new THREE.Color(COLOURS_DARK[index]),
      lit: new THREE.Color(COLOURS[index]),
      light: 0,
      press: 0,
      bob: Math.random() * 6.28
    });
  }

  buildWatcher() {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId()) || state?.players?.[0];
    const kin = createVoxelKin(me?.color || "#ff5d73", 0);
    kin.scale.setScalar(0.8);
    const label = createNameLabel("du", me?.color || "#ff5d73");
    label.position.y = 0.72;
    kin.add(label);
    kin.position.set(0, 0, 2.9);
    this.scene.add(kin);
    const shadow = createShadowBlob(0.45);
    shadow.position.set(0, 0.06, 2.9);
    this.scene.add(shadow);
    this.watcher = kin;
    this.watcherAnimator = new KinAnimator(kin);
    this.watcherAnimator.groundY = 0;
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
    const own = arcade.players[this.getControlledPlayerId()];
    const active = this.activeRound();

    this.playSequence(active, now);
    this.syncPads(dt, now);
    this.reactToOwn(own, active, now);
    this.syncWatcher(minigame, arcade, state, own, active, now);

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.88, dt);
    const shakeX = Math.sin(now / 12) * this.shake * 0.18 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * frameLerp(0.4, dt);
    this.camera.position.y = this.baseCamY || 5.0;
    this.camera.position.z = this.baseCamZ || 5.6;
    this.camera.lookAt(0, 0.5, 0.4);

    this.updateHud(minigame, arcade, state, now, own, active);
    this.renderer.render(this.scene, this.camera);
  }

  // Die Folge abspielen. Welcher Pilz gerade dran ist, hängt allein an der
  // verstrichenen Zeit — der Server rechnet mit derselben Zahl, also stimmt das
  // Gezeigte immer mit dem überein, was gewertet wird.
  playSequence(active, now) {
    if (!active) { this.shownStep = -1; return; }
    const { round, elapsed } = active;
    if (elapsed >= round.inputFrom) { this.shownStep = -1; return; }

    const perStep = (round.inputFrom - round.showFrom) / (round.sequence.length + 1);
    const step = Math.floor((elapsed - round.showFrom) / perStep);
    if (step < 0 || step >= round.sequence.length) { this.shownStep = -1; return; }
    // Innerhalb eines Schritts leuchtet der Pilz nur die erste Hälfte — sonst
    // liefen zwei gleiche Farben hintereinander zu einem langen Leuchten
    // zusammen und man zählte sie als eine.
    const withinStep = (elapsed - round.showFrom) - step * perStep;
    if (withinStep > perStep * 0.62) { this.shownStep = -1; return; }

    const pad = round.sequence[step];
    if (step !== this.shownStep || round.index !== this.shownRound) {
      this.shownStep = step;
      this.shownRound = round.index;
      this.pads[pad].light = 1;
      this.feedback?.sound("plink");
    }
  }

  syncPads(dt, now) {
    this.pads.forEach((pad) => {
      pad.light = Math.max(0, pad.light - dt * 3.4);
      pad.press = Math.max(0, pad.press - dt * 4.5);
      const heat = Math.max(pad.light, pad.press);
      pad.cap.material.color.copy(pad.base).lerp(pad.lit, heat);
      pad.cap.scale.setScalar(1 + heat * 0.22);
      pad.glow.material.opacity = heat * 0.85;
      pad.glow.scale.setScalar(1 + heat * 0.35);
      pad.bob += dt * 1.6;
      pad.group.position.y = Math.sin(pad.bob) * 0.03 + heat * 0.12;
    });
  }

  reactToOwn(own, active, now) {
    if (!own) return;
    const progress = own.roundProgress || 0;
    if (active && own.currentRound === active.round.index) {
      if (progress > this.lastProgress) {
        this.feedback?.vibrate(8);
        if (progress >= active.round.sequence.length) {
          const at = new THREE.Vector3(0, 1.6, 0.4);
          this.bursts.spawn(at, ["#ffe36b", "#ffffff"], { count: 14 * fxScale(), speed: 2.0, up: 1.6, size: 0.07, life: 0.6, drag: 1.8 });
          this.floaters.pop(at, "FOLGE GESCHAFFT!", { color: "#ffe36b", size: 0.4, life: 0.9 });
          this.feedback?.sound("perfect");
        }
      }
      if (own.roundFailed && !this.lastFailed) {
        this.floaters.pop(new THREE.Vector3(0, 1.6, 0.4), "FALSCH!", { color: "#ff9aa8", size: 0.38, life: 0.9 });
        this.feedback?.sound("error");
        this.feedback?.vibrate(24);
        this.shake = Math.max(this.shake, 0.45);
      }
      this.lastFailed = Boolean(own.roundFailed);
    } else {
      this.lastFailed = false;
    }
    this.lastProgress = progress;
  }

  syncWatcher(minigame, arcade, state, own, active, now) {
    if (minigame.finaleAt) {
      const place = this.finalePlace(arcade, state);
      applyFinaleMood(this.watcherAnimator, place, state.players.length);
    } else if (own?.roundFailed) {
      this.watcherAnimator.set("sad", { base: true });
    } else if (active && active.elapsed < active.round.inputFrom) {
      // Beim Zuschauen steht die Figur still — das ist die Ansage, dass jetzt
      // gemerkt und nicht getippt wird.
      this.watcherAnimator.set("idle", { base: true });
    } else {
      this.watcherAnimator.set("cheer", { base: true });
    }
    this.watcherAnimator.update(now);
  }

  finalePlace(arcade, state) {
    const scored = state.players
      .map((player) => ({ id: player.id, score: arcade.players[player.id]?.score || 0 }))
      .sort((a, b) => b.score - a.score);
    const index = scored.findIndex((entry) => entry.id === this.getControlledPlayerId());
    return index < 0 ? state.players.length : index + 1;
  }

  updateHud(minigame, arcade, state, now, own, active) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.survived || 0);

    const roundLabel = this.hud.querySelector("[data-simon-round]");
    if (roundLabel) {
      const total = arcade.rounds?.length || 0;
      roundLabel.textContent = active ? `Runde ${active.round.index + 1}/${total} · ${active.round.sequence.length} Farben` : "Gleich geht's los";
    }

    const chips = this.hud.querySelector("[data-simon-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="simon-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${entry?.survived || 0}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-simon-banner]");
    if (!banner) return;
    if (!active) {
      banner.hidden = true;
      return;
    }
    const watching = active.elapsed < active.round.inputFrom;
    if (own?.roundFailed && own.currentRound === active.round.index) {
      banner.hidden = false;
      banner.textContent = "Daneben — warte auf die nächste Folge";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (watching) {
      banner.hidden = false;
      banner.textContent = "MERKEN …";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
    } else {
      banner.hidden = false;
      const done = own?.currentRound === active.round.index ? (own.roundProgress || 0) : 0;
      banner.textContent = `Nachtippen: ${done}/${active.round.sequence.length}`;
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Im Hochformat höher und näher, damit alle vier Pilze im oberen Zweidrittel
      // liegen — beim Nachtippen greift der Daumen von unten.
      this.baseCamY = portrait ? 5.0 : 4.4;
      this.baseCamZ = portrait ? 5.6 : 6.2;
      camera.fov = portrait ? 58 : 48;
    });
  }
}
