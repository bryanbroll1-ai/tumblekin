import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createCloud,
  createNameLabel,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin125";
import {
  entflechteSchilder,
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin125";
import { frameDecay, frameLerp, fxScale, shakeScale } from "./Quality.js?v=tumblekin125";

// Ballonfahrt — halten steigt, loslassen sinkt, und der Kurs kommt in Toren auf
// einen zu. Alle vier fliegen denselben Kurs gleichzeitig und nebeneinander:
// man sieht die ganze Zeit, wer vorn liegt, und das ist der halbe Spass.
//
// Der Blick liegt seitlich auf den Schacht, wie bei einem Jump-and-Run. Auf dem
// hohen Handybild ist das die einzige Anordnung, in der man die eigene Höhe UND
// die nächsten zwei Tore gleichzeitig lesen kann.
const SHAFT_HEIGHT = 7.2;      // Weltmass fuer Hoehenanteil 0..1
const SHAFT_BOTTOM = 0.4;
const GATE_SPACING_X = 5.4;    // Weltabstand zweier Tore
// Die Bahnen liegen in der TIEFE, nicht seitlich — sie müssen es: der Kurs
// läuft in x, alle vier sind am selben Punkt des Kurses. Von vorn deckt der
// vorderste Ballon die drei anderen dadurch fast vollständig ab.
//
// Ein seitlich versetzter Blick fächert sie auf — probiert, und verworfen:
// aus dem Winkel wird aus jedem Tor, das über alle Bahnen reichen muss, eine
// mannshohe Platte quer im Bild. Die Tiefe des Tores ist nur deshalb gratis,
// weil man genau von vorn draufschaut. Also bleibt der Blick frontal, und die
// fremden Ballons werden durchscheinend: man sieht sie hintereinander stehen,
// ohne dass der eigene verdeckt wird.
const LANE_Z = [-1.35, -0.45, 0.45, 1.35];
const GATE_LOOKAHEAD = 4;      // so viele Tore stehen gleichzeitig im Bild

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shaftY(share) {
  return SHAFT_BOTTOM + clamp(share, 0, 1) * SHAFT_HEIGHT;
}

export class BalloonGlide {
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
    this.balloons = new Map();
    this.gateVisuals = [];
    this.lastGateAt = 0;
    this.lastBumpCount = 0;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.holding = false;
    this.flame = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Ballonfahrt", background: "#9fd8f2", fog: ["#cbe9f8", 26, 64], fov: 54, far: 120 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-glide-time>0s</span><strong data-glide-score>0</strong></div>
      <div class="glide-gates" data-glide-gates>0 Tore</div>
      <div class="glide-chips" data-glide-chips></div>
      <div class="color-banner glide-banner" data-glide-banner hidden></div>
    `);
    this.createScene();

    // Keine Knoepfe: der ganze Bildschirm ist der Brenner. Ein Knopfstreifen
    // waere hier nur ein kleineres Ziel fuer dieselbe eine Geste.
    this.controls.innerHTML = `<p class="trace-hint">Halten = steigen · Loslassen = sinken</p>`;
    this.controls.style.pointerEvents = "none";

    this.setHolding = (down) => {
      if (down === this.holding) return;
      this.holding = down;
      if (down) this.feedback?.sound("whoosh");
      this.sendInput({ action: "lift", down }).catch(() => {});
    };
    this.onDown = (event) => { event.preventDefault(); this.setHolding(true); };
    this.onUp = () => this.setHolding(false);

    this.webglCanvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    this.loop();
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    this.webglCanvas?.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    teardownStage(this);
    this.balloons.clear();
    this.gateVisuals.length = 0;
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-6, 14, 9],
      shadow: { left: -9, right: 9, top: 11, bottom: -3 }
    });

    // Boden und Decke sind die harten Grenzen des Schachts. Sie muessen als
    // solche zu lesen sein: an ihnen bleibt man haengen.
    // 34 tief statt 7: der Boden endete bei z = 3.5, die Kamera steht bei
    // 12.5 — im Bild lief unter dem Grün wieder Himmel durch, ein
    // schwebender Bodenstreifen quer über den Bildschirm.
    this.floor = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.6, 34),
      new THREE.MeshLambertMaterial({ color: "#7bbf5e" })
    );
    this.floor.position.set(0, SHAFT_BOTTOM - 0.3, -3);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    this.ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.5, 7),
      new THREE.MeshLambertMaterial({ color: "#8d9bb5" })
    );
    this.ceiling.position.set(0, SHAFT_BOTTOM + SHAFT_HEIGHT + 0.25, 0);
    this.scene.add(this.ceiling);

    // Zacken an Boden und Decke: sie sagen ohne Worte, dass Anecken wehtut.
    const spikeGeo = new THREE.ConeGeometry(0.26, 0.5, 4);
    const spikeMat = new THREE.MeshLambertMaterial({ color: "#c9d3e4" });
    for (let i = 0; i < 44; i += 1) {
      const x = -28 + i * 1.3;
      const down = new THREE.Mesh(spikeGeo, spikeMat);
      down.position.set(x, SHAFT_BOTTOM + SHAFT_HEIGHT - 0.25, 0);
      down.rotation.x = Math.PI;
      this.scene.add(down);
      const up = new THREE.Mesh(spikeGeo, new THREE.MeshLambertMaterial({ color: "#5f9c47" }));
      up.position.set(x, SHAFT_BOTTOM + 0.25, 0);
      this.scene.add(up);
    }

    for (let i = 0; i < 6; i += 1) {
      const cloud = createCloud(i * 3);
      cloud.position.set(-20 + i * 9, 2 + (i % 3) * 2.4, -7 - (i % 2) * 4);
      cloud.scale.setScalar(1.3);
      this.scene.add(cloud);
      if (!this.clouds) this.clouds = [];
      this.clouds.push(cloud);
    }

    this.buildGates();
    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildBalloons();
    this.resizeRenderer();
    this.camera.position.set(0, 4.0, 12.5);
    this.camera.lookAt(0, 4.0, 0);
  }

  // Torkoerper werden EINMAL gebaut und weiterverwendet — es laufen ueber eine
  // Runde gut zwanzig durchs Bild, und neue Meshes dafuer waeren auf dem Handy
  // der teuerste Teil der Szene.
  buildGates() {
    for (let i = 0; i < GATE_LOOKAHEAD + 1; i += 1) {
      const group = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: "#ffd15c" });
      // 3.2 tief, damit das Tor über alle vier Bahnen (±1.35) reicht. Die
      // Tiefe kostet im Bild nichts, weil die Kamera frontal draufschaut.
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1, 3.2), mat);
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1, 3.2), mat);
      top.castShadow = true;
      bottom.castShadow = true;
      group.add(top, bottom);

      // Ein leuchtender Balken in der Torluecke: er zeigt die Mitte, und genau
      // die ist mehr wert als der Rand.
      const centre = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 3.1),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false })
      );
      group.add(centre);
      this.scene.add(group);
      this.gateVisuals.push({ group, top, bottom, centre, mat, index: -1, flash: 0 });
    }
  }

  buildBalloons() {
    const state = this.getState();
    const eigeneId = this.getControlledPlayerId();
    (state?.players || []).forEach((player, index) => {
      // Fremde Ballons durchscheinend: sie stehen in derselben Bildspalte
      // hintereinander, und der vorderste hat vorher die drei dahinter
      // komplett verdeckt. Durchscheinend sieht man alle vier Höhen auf
      // einmal — und der eigene bleibt der einzige volldeckende.
      const fremd = player.id !== eigeneId;
      const huelle = (farbe) => new THREE.MeshLambertMaterial(
        fremd
          ? { color: farbe, transparent: true, opacity: 0.5, depthWrite: false }
          : { color: farbe }
      );
      const group = new THREE.Group();

      const envelope = new THREE.Mesh(
        new THREE.SphereGeometry(0.52, 12, 10),
        huelle(player.color)
      );
      envelope.scale.set(1, 1.18, 1);
      envelope.position.y = 0.95;
      envelope.castShadow = true;
      group.add(envelope);

      // Ein heller Streifen ueber den Ballon: er zeigt die Neigung, und die
      // Neigung ist das, woran man Steigen und Sinken zuerst sieht.
      const stripe = new THREE.Mesh(
        new THREE.SphereGeometry(0.53, 12, 10, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.16),
        huelle("#fff4dc")
      );
      stripe.scale.set(1, 1.18, 1);
      stripe.position.y = 0.95;
      group.add(stripe);

      const basket = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.32, 0.4),
        huelle("#a9763f")
      );
      basket.position.y = 0.1;
      basket.castShadow = true;
      group.add(basket);

      [[-0.16, 0.16], [0.16, 0.16], [-0.16, -0.16], [0.16, -0.16]].forEach(([x, z]) => {
        const rope = new THREE.Mesh(
          new THREE.BoxGeometry(0.03, 0.42, 0.03),
          new THREE.MeshLambertMaterial({ color: "#6c5540" })
        );
        rope.position.set(x, 0.46, z);
        group.add(rope);
      });

      // Die Flamme ist die einzige Rueckmeldung darauf, ob gerade gehalten wird.
      // Ohne sie fuehlt sich die Steuerung an, als reagiere sie verzoegert.
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.4, 6),
        new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
      );
      flame.position.y = 0.42;
      group.add(flame);

      const kin = createVoxelKin(player.color, index);
      kin.scale.setScalar(0.34);
      kin.position.y = 0.16;
      group.add(kin);

      const label = createNameLabel(player.name, player.color);
      label.position.y = 1.75;
      group.add(label);

      group.position.set(0, shaftY(0.5), LANE_Z[index % LANE_Z.length]);
      this.scene.add(group);

      this.balloons.set(player.id, {
        group, envelope, basket, flame, kin, label,
        animator: new KinAnimator(kin),
        bob: Math.random() * 6.28,
        lastBumps: 0,
        lastGateIndex: -1
      });
    });
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
    const own = arcade.players[this.getControlledPlayerId()];

    this.syncGates(arcade, elapsed, dt, own);
    this.syncBalloons(minigame, arcade, state, now, dt);
    this.scrollBackground(dt);

    this.bursts.update(dt);
    this.floaters.update(dt, this.camera);

    this.shake *= frameDecay(0.86, dt);
    const jolt = Math.sin(now / 11) * this.shake * 0.22 * shakeScale();

    // Die Kamera folgt der eigenen Hoehe, aber gedaempft und nur zur Haelfte:
    // eine Kamera, die jeder Bewegung voll folgt, laesst den eigenen Ballon
    // stillstehen — dann sieht man nicht mehr, ob man steigt oder faellt.
    const ownY = own ? shaftY(own.y ?? 0.5) : 4.0;
    const wanted = 4.0 + (ownY - 4.0) * 0.45;
    this.camY = (this.camY ?? wanted) + (wanted - (this.camY ?? wanted)) * frameLerp(0.09, dt);
    this.camera.position.set(jolt, this.camY, this.baseCamZ || 12.5);
    this.camera.lookAt(0, this.camY - 0.2, 0);

    this.updateHud(minigame, arcade, state, now, own);
    // Vier Ballons in derselben Bildspalte heisst vier Namensschilder
    // übereinander. Die Staffelung macht sie wieder lesbar.
    entflechteSchilder([...this.balloons.values()].map((b) => b.label), this.camera,
      { grundY: 1.75, stufe: 0.42, naehe: 0.2 });
    this.renderer.render(this.scene, this.camera);
  }

  // Die Tore stehen in Weltkoordinaten und wandern nach links. Welches Tor auf
  // welchem Koerper liegt, entscheidet allein die verstrichene Zeit — der
  // Server rechnet mit derselben Zahl, also stimmt Bild und Wertung ueberein.
  syncGates(arcade, elapsed, dt, own) {
    const gates = arcade.gates || [];
    const spacingMs = gates.length > 1 ? gates[1].at - gates[0].at : 1500;
    const perMs = GATE_SPACING_X / Math.max(1, spacingMs);

    this.gateVisuals.forEach((visual, slot) => {
      // Der erste sichtbare Torindex ergibt sich aus der Zeit; die Koerper
      // werden reihum weiterverwendet.
      const first = Math.max(0, Math.floor((elapsed - (gates[0]?.at ?? 0)) / spacingMs));
      const index = first + slot;
      const gate = gates[index];
      if (!gate) { visual.group.visible = false; return; }
      visual.group.visible = true;

      const x = (gate.at - elapsed) * perMs;
      const half = (gate.gap / 2) * SHAFT_HEIGHT;
      const centreY = shaftY(gate.y);
      const topLen = Math.max(0.2, SHAFT_BOTTOM + SHAFT_HEIGHT - (centreY + half));
      const bottomLen = Math.max(0.2, (centreY - half) - SHAFT_BOTTOM);

      visual.group.position.x = x;
      visual.top.scale.y = topLen;
      visual.top.position.y = centreY + half + topLen / 2;
      visual.bottom.scale.y = bottomLen;
      visual.bottom.position.y = SHAFT_BOTTOM + bottomLen / 2;
      visual.centre.position.y = centreY;

      // Das naechste Tor faerbt sich ein, sobald es das aktuelle ist. Ohne die
      // Markierung sucht man bei vier sichtbaren Toren immer wieder neu.
      const isNext = own ? index === (own.nextGate || 0) : slot === 0;
      visual.flash = Math.max(0, visual.flash - dt * 2.4);
      if (visual.index !== index) { visual.index = index; visual.flash = 0; }
      visual.mat.color.set(isNext ? "#ffd15c" : "#c8bda6");
      visual.centre.material.opacity = isNext ? 0.5 + Math.sin(elapsed / 120) * 0.2 : 0.12;
    });
  }

  syncBalloons(minigame, arcade, state, now, dt) {
    state.players.forEach((player) => {
      const visual = this.balloons.get(player.id);
      const entry = arcade.players[player.id];
      if (!visual || !entry) return;

      const y = shaftY(entry.y ?? 0.5);
      visual.group.position.y += (y - visual.group.position.y) * frameLerp(0.55, dt);

      // Neigung nach der Steiggeschwindigkeit: das ist die schnellste Art, ohne
      // Zahlen zu zeigen, ob es gerade hoch oder runter geht.
      const vy = entry.vy || 0;
      visual.group.rotation.z += ((-vy * 0.35) - visual.group.rotation.z) * frameLerp(0.2, dt);
      visual.bob += dt * (2.2 + Math.abs(vy) * 2);
      visual.group.position.x = Math.sin(visual.bob) * 0.07;

      const burning = entry.holding && !entry.stalled;
      const target = burning ? 0.85 + Math.sin(now / 45) * 0.15 : 0;
      visual.flame.material.opacity += (target - visual.flame.material.opacity) * frameLerp(0.3, dt);
      visual.flame.scale.y = 0.7 + visual.flame.material.opacity * 0.8;

      // Stockung nach dem Anecken: der Ballon flackert grau, damit klar ist,
      // warum der Brenner gerade nichts bringt.
      visual.envelope.material.color.set(entry.stalled ? "#8d9bb5" : player.color);

      if ((entry.bumps || 0) > visual.lastBumps) {
        visual.lastBumps = entry.bumps;
        if (player.id === this.getControlledPlayerId()) {
          this.shake = Math.max(this.shake, 0.5);
          this.feedback?.sound("impact");
          this.feedback?.vibrate(24);
        }
        this.bursts.spawn(visual.group.position.clone().setY(y + 0.4), ["#c9d3e4", player.color],
          { count: 8 * fxScale(), speed: 1.6, up: 0.6, size: 0.07, life: 0.5, drag: 2.2 });
      }

      const gate = entry.lastGate;
      if (gate && gate.index !== visual.lastGateIndex) {
        visual.lastGateIndex = gate.index;
        const at = visual.group.position.clone().setY(y + 1.1);
        if (gate.hit) {
          this.bursts.spawn(at, ["#ffd15c", "#ffffff"],
            { count: 12 * fxScale(), speed: 2.0, up: 1.2, size: 0.07, life: 0.5, drag: 2.0 });
          if (player.id === this.getControlledPlayerId()) {
            this.feedback?.sound(gate.centre >= 38 ? "perfect" : "coin");
            this.feedback?.vibrate(gate.centre >= 38 ? 16 : 10);
            this.floaters.pop(at, gate.centre >= 38 ? "MITTE!" : `+${100 + gate.centre}`,
              { color: gate.centre >= 38 ? "#ffe9a8" : "#c6ffb0", size: 0.34, life: 0.7 });
          }
        } else if (player.id === this.getControlledPlayerId()) {
          this.feedback?.sound("error");
          this.floaters.pop(at, "VORBEI", { color: "#ff9aa8", size: 0.34, life: 0.7 });
        }
      }

      if (minigame.finaleAt) {
        const place = this.finalePlace(arcade, state, player.id);
        applyFinaleMood(visual.animator, place, state.players.length);
      } else if (entry.stalled) {
        visual.animator.set("hit");
      } else if (burning) {
        visual.animator.set("cheer", { base: true });
      } else {
        visual.animator.set("idle", { base: true });
      }
      visual.animator.update(now);
    });
  }

  scrollBackground(dt) {
    if (!this.clouds) return;
    // Die Wolken laufen langsamer als die Tore. Das ist der billigste
    // Tiefeneindruck, den es gibt, und er macht den Schacht sofort raeumlich.
    this.clouds.forEach((cloud) => {
      cloud.position.x -= dt * 1.1;
      if (cloud.position.x < -26) cloud.position.x += 52;
    });
  }

  finalePlace(arcade, state, playerId) {
    const scored = state.players
      .map((player) => ({ id: player.id, score: arcade.players[player.id]?.score || 0 }))
      .sort((a, b) => b.score - a.score);
    const index = scored.findIndex((entry) => entry.id === playerId);
    return index < 0 ? state.players.length : index + 1;
  }

  updateHud(minigame, arcade, state, now, own) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-glide-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-glide-score]").textContent = String(Math.max(0, Math.round(own?.score || 0)));

    const gates = this.hud.querySelector("[data-glide-gates]");
    if (gates) gates.textContent = `${own?.gatesPassed || 0}/${arcade.gateCount || 0} Tore`;

    const chips = this.hud.querySelector("[data-glide-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="glide-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${entry?.gatesPassed || 0}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-glide-banner]");
    if (!banner) return;
    if (own?.stalled) {
      banner.hidden = false;
      banner.textContent = "Angeeckt — Brenner aus!";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Im Hochformat weiter weg: der Schacht ist hoch, und die naechsten zwei
      // Tore muessen mit ins Bild, sonst fliegt man blind.
      this.baseCamZ = portrait ? 12.5 : 14.5;
      camera.fov = portrait ? 54 : 42;
    });
  }
}
