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
  teardownStage
} from "./SceneKit.js?v=tumblekin76";
import { shakeScale } from "./Quality.js?v=tumblekin76";

// Tellerdreher — mehrere Teller laufen langsam aus, ein Antippen gibt Schwung
// zurück. Man hat aber nur EINE Hand: jeder Griff kostet aus einem Vorrat, der
// sich mit fester Rate füllt, und ein fast voller Teller verschluckt ihn.
// Dauertippen bringt darum nichts — das Können liegt im Verteilen.
//
// Drei Reihen à zwei Teller statt einer Reihe zu sechs: auf dem hohen Handybild
// (Seitenverhältnis 0.46) ist die Breite der Engpass und die Tiefe gratis. Am
// Bild gerechnet liegt die äusserste Kante bei 0.81 NDC und der kleinste Teller
// hat 68 px Radius — bequem mit dem Daumen zu treffen.
const PLATE_R = 0.38;
const SPREAD_X = 0.66;
const WOBBLE_AT = 0.34;

// Feste Plätze je Tellernummer. Die ersten beiden liegen vorne in der Mitte,
// später kommende weiter hinten — die Runde wird also nicht nur voller, sondern
// die Wege werden auch länger.
const SLOTS = [
  { x: -SPREAD_X, y: 1.15, z: 2.6 },
  { x: SPREAD_X, y: 1.15, z: 2.6 },
  { x: -SPREAD_X, y: 2.0, z: 0.4 },
  { x: SPREAD_X, y: 2.0, z: 0.4 },
  { x: -SPREAD_X, y: 2.9, z: -1.8 },
  { x: SPREAD_X, y: 2.9, z: -1.8 }
];

const PLATE_COLORS = ["#ffd15c", "#7fd8ff", "#ff9ec4", "#9de88a", "#ffb47a", "#c8a9ff"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class PlateSpin {
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
    this.plates = [];
    this.hitTargets = [];
    this.lastDropAt = 0;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.spinPhase = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Tellerdreher", background: "#9ad7ef", fog: ["#b3e4f6", 20, 52], fov: 62, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="plate-chips" data-plate-chips></div>
      <div class="plate-hand" data-plate-hand>
        <span class="plate-hand-label">Hand</span>
        <span class="plate-hand-track"><i data-plate-hand-fill></i></span>
      </div>
      <div class="color-banner plate-banner" data-plate-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `<p class="trace-hint">Tippe den Teller an, der am langsamsten dreht</p>`;
    this.controls.style.pointerEvents = "none";

    this.onTap = (event) => {
      event.preventDefault();
      this.tapAt(event);
    };
    this.webglCanvas.addEventListener("pointerdown", this.onTap);
    this.loop();
  }

  // Tippen trifft den Teller, auf den gezeigt wird. Die Trefferflächen sind
  // absichtlich grösser als die Teller — Daumen sind ungenau, und ein Fehlgriff
  // wäre hier doppelt bitter, weil er die Hand kostet.
  tapAt(event) {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || !this.camera) return;
    const rect = this.webglCanvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitTargets, false);
    if (hits.length === 0) return;
    const index = hits[0].object.userData.plateIndex;
    this.feedback?.sound("tap");
    this.sendInput({ action: "spin", plate: index }).catch(() => {});
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
    this.plates.length = 0;
    this.hitTargets.length = 0;
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-4, 12, 8],
      shadow: { left: -5, right: 5, top: 8, bottom: -2 }
    });

    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(9, 0.5, 12),
      new THREE.MeshLambertMaterial({ color: "#c98f6a" })
    );
    stage.position.y = -0.25;
    stage.receiveShadow = true;
    this.scene.add(stage);

    const carpet = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.04, 8.4),
      new THREE.MeshLambertMaterial({ color: "#a3405a" })
    );
    carpet.position.set(0, 0.02, 0.4);
    carpet.receiveShadow = true;
    this.scene.add(carpet);

    SLOTS.forEach((slot, index) => this.buildPlate(slot, index));

    [[-4.4, 6.2, -8, 5], [4.2, 6.9, -9, 2]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildArtist();
    this.resizeRenderer();
    this.camera.position.set(0, 3.1, 7.0);
    this.camera.lookAt(0, 2.0, 0);
  }

  buildPlate(slot, index) {
    const color = PLATE_COLORS[index % PLATE_COLORS.length];
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.07, slot.y, 8),
      new THREE.MeshLambertMaterial({ color: "#6c5540" })
    );
    pole.position.set(slot.x, slot.y / 2, slot.z);
    pole.castShadow = true;
    this.scene.add(pole);

    // Der Teller hängt in einem Kipp-Pivot, damit das Wackeln um die Stangen-
    // spitze dreht und nicht um die Tellermitte.
    const pivot = new THREE.Group();
    pivot.position.set(slot.x, slot.y, slot.z);
    this.scene.add(pivot);

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(PLATE_R, PLATE_R * 0.82, 0.07, 20),
      new THREE.MeshLambertMaterial({ color })
    );
    disc.castShadow = true;
    pivot.add(disc);

    // Ein Muster auf dem Teller, damit man die Drehung überhaupt sieht — eine
    // glatte Scheibe sieht gedreht genauso aus wie stehend.
    for (let i = 0; i < 4; i += 1) {
      const mark = new THREE.Mesh(
        new THREE.BoxGeometry(PLATE_R * 0.62, 0.02, 0.06),
        new THREE.MeshLambertMaterial({ color: "#ffffff" })
      );
      mark.position.set(Math.cos((i / 4) * Math.PI * 2) * PLATE_R * 0.42, 0.05, Math.sin((i / 4) * Math.PI * 2) * PLATE_R * 0.42);
      mark.rotation.y = (i / 4) * Math.PI * 2;
      pivot.add(mark);
    }

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(PLATE_R * 1.16, 0.035, 6, 24),
      new THREE.MeshBasicMaterial({ color: "#ff6b7f", transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    pivot.add(ring);

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(PLATE_R * 1.7, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(slot.x, slot.y + 0.1, slot.z);
    hit.userData.plateIndex = index;
    this.scene.add(hit);
    this.hitTargets.push(hit);

    this.plates.push({
      index, slot, pivot, disc, ring, pole, color,
      baseColor: new THREE.Color(color),
      alarmColor: new THREE.Color("#ff4f68"),
      fall: 0,
      wobble: Math.random() * Math.PI * 2,
      wasActive: index < 2
    });
  }

  // Ein Kin als Artist am Bühnenrand: er jubelt, wenn alles läuft, und wird
  // traurig, wenn gerade ein Teller zerbricht.
  buildArtist() {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId()) || state?.players?.[0];
    const kin = createVoxelKin(me?.color || "#ff5d73", 0);
    kin.scale.setScalar(0.85);
    const label = createNameLabel("du", me?.color || "#ff5d73");
    label.position.y = 0.72;
    kin.add(label);
    // Hinten links auf der Bühne. Vorne (z=3.5) lag der Kin bei y=873 px und
    // damit vollständig hinter der Hinweisleiste — sichtbar war nur sein Name.
    // Hier steht er bei y≈522 px im Bild und wird von den vorderen Tellern
    // korrekt verdeckt, weil er weiter hinten ist.
    kin.position.set(-1.6, 0, -4.4);
    this.scene.add(kin);
    const shadow = createShadowBlob(0.45);
    shadow.position.set(-1.6, 0.06, -4.4);
    this.scene.add(shadow);
    this.artist = kin;
    this.artistAnimator = new KinAnimator(kin);
    this.artistAnimator.groundY = 0;
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

    if (own) {
      this.syncPlates(own, dt, now);
      this.reactToDrop(own);
    }

    const spinning = own?.spinning || 0;
    const total = own?.plateCount || 0;
    if (minigame.finaleAt) this.artistAnimator.set("cheer", { base: true });
    else if (spinning > 0 && spinning === total) this.artistAnimator.set("cheer", { base: true });
    else if (spinning < total - 1) this.artistAnimator.set("sad", { base: true });
    else this.artistAnimator.set("idle", { base: true });
    this.artistAnimator.update(now);

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= 0.9;
    const shakeX = Math.sin(now / 13) * this.shake * 0.16 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * 0.4;
    this.camera.position.y = this.baseCamY || 3.1;
    this.camera.position.z = this.baseCamZ || 7.0;
    this.camera.lookAt(0, 2.0, 0);

    this.updateHud(minigame, arcade, state, now, own);
    this.renderer.render(this.scene, this.camera);
  }

  syncPlates(own, dt, now) {
    this.plates.forEach((visual) => {
      const plate = own.plates?.[visual.index];
      const known = Boolean(plate);
      const active = known && plate.active;
      const spin = known ? plate.spin : 0;
      const inRound = visual.index < (own.plateCount || 0);

      // Noch nicht dabei: Stange und Teller bleiben unsichtbar, damit man nur
      // sieht, was gerade zu halten ist.
      visual.pole.visible = inRound;
      visual.pivot.visible = inRound;
      this.hitTargets[visual.index].userData.enabled = active;

      if (!inRound) return;

      // Fallanimation: ein verlorener Teller kippt von der Stange.
      visual.fall = clamp(visual.fall + (active ? -dt * 5 : dt * 3.2), 0, 1);
      const fall = visual.fall;

      // Drehung: schneller Schwung heisst schnelle Drehung. Unter WOBBLE_AT
      // beginnt das Kippeln, und es wird zum Schluss hektisch — das ist die
      // Warnung, auf die man reagieren soll.
      const rate = 1.2 + spin * 10;
      visual.disc.rotation.y += rate * dt;
      visual.wobble += dt * (6 + (1 - spin) * 16);
      const shakiness = spin >= WOBBLE_AT ? 0 : (WOBBLE_AT - spin) / WOBBLE_AT;
      // Der Teller selbst färbt sich rot. Nur Kippeln plus ein flacher Warnring
      // reichte nicht: die hinteren Teller sieht man fast von der Kante, der
      // Ring war dort kaum zu erkennen, und auf dem kleinen Bild war nicht
      // auszumachen, welcher Teller gleich fällt. Farbe liest man aus jedem
      // Winkel.
      visual.disc.material.color.copy(visual.baseColor).lerp(visual.alarmColor, shakiness * 0.85);
      const tilt = shakiness * 0.5 + fall * 1.35;
      visual.pivot.rotation.z = Math.sin(visual.wobble) * tilt;
      visual.pivot.rotation.x = Math.cos(visual.wobble * 0.8) * tilt * 0.6;
      visual.pivot.position.y = visual.slot.y - fall * (visual.slot.y - 0.12);
      visual.pivot.position.x = visual.slot.x + fall * 0.34;

      // Warnring: ab dem Kippeln sichtbar, damit man den Teller auch im
      // Augenwinkel findet.
      visual.ring.material.opacity = shakiness * 0.85 * (active ? 1 : 0);
      visual.ring.material.color.set(spin < WOBBLE_AT * 0.45 ? "#ff4f68" : "#ffb24f");
      visual.ring.scale.setScalar(1 + Math.sin(now / 110) * shakiness * 0.12);

      if (visual.wasActive && !active) {
        const at = new THREE.Vector3(visual.slot.x, visual.slot.y, visual.slot.z);
        this.bursts.spawn(at, [visual.color, "#ffffff"], { count: 14, speed: 1.6, up: 1.2, size: 0.06, life: 0.6, drag: 2.0 });
      }
      visual.wasActive = active;
    });
  }

  reactToDrop(own) {
    if (!own.lastDropAt || own.lastDropAt === this.lastDropAt) return;
    this.lastDropAt = own.lastDropAt;
    this.floaters.pop(new THREE.Vector3(0, 3.4, 0), "TELLER HIN!", { color: "#ff9aa8", size: 0.36, life: 0.9 });
    this.feedback?.sound("error");
    this.feedback?.vibrate(24);
    this.shake = Math.max(this.shake, 0.4);
  }

  updateHud(minigame, arcade, state, now, own) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.max(0, Math.round(own?.score || 0)));

    // Der Handvorrat ist die zentrale Regel des Spiels — er MUSS sichtbar sein,
    // sonst wirkt ein Griff ins Leere wie ein Fehler des Spiels.
    const fill = this.hud.querySelector("[data-plate-hand-fill]");
    if (fill) {
      const share = clamp((own?.hand || 0) / (arcade.handMax || 1), 0, 1);
      fill.style.transform = `scaleX(${share.toFixed(3)})`;
      fill.style.background = share >= (arcade.spinGain || 0.34) / (arcade.handMax || 1) ? "#7fe06f" : "#ff6b7f";
    }

    const chips = this.hud.querySelector("[data-plate-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const up = entry?.spinning ?? 0;
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="plate-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${up}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-plate-banner]");
    if (!banner) return;
    const spinning = own?.spinning || 0;
    const total = own?.plateCount || 0;
    if ((own?.hand || 0) < (arcade.spinGain || 0.34)) {
      banner.hidden = false;
      banner.textContent = "Hand leer — kurz warten";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (total >= (arcade.plateMax || 6) && spinning === total) {
      banner.hidden = false;
      banner.textContent = `Alle ${total} laufen!`;
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Am Bild gerechnet: bei diesen Werten liegt die äusserste Tellerkante bei
      // 0.81 NDC und der kleinste Teller hat 68 px Radius.
      this.baseCamY = portrait ? 3.1 : 2.9;
      this.baseCamZ = portrait ? 7.0 : 6.6;
      camera.fov = portrait ? 62 : 48;
    });
  }
}
