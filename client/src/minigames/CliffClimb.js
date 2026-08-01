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
} from "./VoxelKit.js?v=tumblekin108";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin108";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin108";

// Bergsteiger — race up the cliff by tapping left / right in alternation.
// The correct hand pulls you up a rung; the wrong hand slips you back one.
const LANE_GAP = 1.55;
const CLIMB_WORLD = 12;    // Welthöhe des SICHTBAREN Wandstücks
// Kletterhöhe je Sprosse. Vorher wurde die Höhe auf die gesamte Wand normiert
// (rung / arcade.height); seit es keinen Gipfel mehr gibt, ist arcade.height nur
// noch ein Sicherheitsnetz — normiert darauf käme man optisch kaum vom Boden.
// Jetzt zählt ein fester Abstand je Sprosse, und die Kamera fährt mit.
const WORLD_PER_RUNG = 0.42;
const HOLDS_PER_LANE = 40;            // so viele Griffe je Bahn wandern mit
const WALL_SPAN = 90;                 // Höhe des Wandblocks, der mitgezogen wird
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
    this.holds = [];
    this.fallFrom = new Map();     // Höhe, aus der jemand losgelassen hat
    this.fellDone = new Set();
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

    // Keine Knöpfe: die LINKE Bildhälfte ist die linke Hand, die rechte die
    // rechte. Das ist dieselbe Geste, aber sie zeigt direkt auf das, was man
    // meint — und der Blick bleibt oben an der Wand, statt zwischen Wand und
    // Knopfleiste zu pendeln.
    this.controls.innerHTML = `<p class="trace-hint" data-climb-hint>Abwechselnd links und rechts tippen</p>`;
    this.controls.style.pointerEvents = "none";
    this.onClimbTap = (event) => {
      event.preventDefault();
      const rect = this.webglCanvas.getBoundingClientRect();
      const share = (event.clientX - rect.left) / Math.max(1, rect.width);
      this.sendGrab(share < 0.5 ? -1 : 1);
    };
    this.webglCanvas.addEventListener("pointerdown", this.onClimbTap);
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
    this.controls.style.pointerEvents = "";
    if (this.onClimbTap) this.webglCanvas?.removeEventListener("pointerdown", this.onClimbTap);
    this.holds = [];
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

    // Die Wand hat kein Ende mehr — geklettert wird auf Zeit. Sie ist deshalb
    // ein hoher Block, der mit der Kamera mitwandert, statt eines Stücks, das
    // irgendwann unter einem aufhört.
    this.cliff = new THREE.Mesh(
      new THREE.BoxGeometry(9, WALL_SPAN, 1),
      new THREE.MeshLambertMaterial({ color: "#9c8f7a" })
    );
    this.cliff.position.set(0, WALL_SPAN / 2 - 2, -1.1);
    this.cliff.receiveShadow = true;
    this.scene.add(this.cliff);
    // Die Wand hatte bisher nur die bunten Griffe auf einer glatten Platte —
    // beim Klettern bewegte sich sichtbar gar nichts ausser den Figuren, und man
    // konnte nicht sehen, wie hoch man schon war. Drei Lagen ändern das, und
    // alle drei wandern mit demselben Band wie die Griffe (siehe scrollWall):
    //
    //  * Felsstufen, die der Wand Tiefe geben,
    //  * eine Höhenmarke alle zehn Sprossen,
    //  * Wolken, die im Vorbeiziehen zeigen, wie schnell es hochgeht.
    this.decor = [];
    const bandHeight = HOLDS_PER_LANE * WORLD_PER_RUNG;
    const ledgeMat = new THREE.MeshLambertMaterial({ color: "#8a7d69" });
    const crackMat = new THREE.MeshLambertMaterial({ color: "#7a6e5c" });
    for (let i = 0; i < 26; i += 1) {
      const t = i / 26;
      const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.9 + (i % 3) * 0.7, 0.26, 0.5), ledgeMat);
      ledge.position.set(-3.6 + ((i * 2.7) % 7.2), 0.4 + t * bandHeight, -0.72);
      ledge.castShadow = true;
      this.scene.add(ledge);
      this.decor.push(ledge);

      const crack = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9 + (i % 4) * 0.5, 0.06), crackMat);
      crack.position.set(-4.0 + ((i * 3.4) % 8.0), 0.9 + t * bandHeight, -0.58);
      crack.rotation.z = ((i % 5) - 2) * 0.09;
      this.scene.add(crack);
      this.decor.push(crack);
    }

    // Höhenmarken: ein heller Streifen alle zehn Sprossen. Ohne sie fühlte sich
    // die Wand endlos gleich an, weil jeder Ausschnitt aussah wie der vorige.
    this.marks = [];
    const markSpacing = 10 * WORLD_PER_RUNG;
    for (let i = 0; i < Math.ceil(bandHeight / markSpacing) + 1; i += 1) {
      const mark = new THREE.Mesh(
        new THREE.BoxGeometry(9, 0.07, 0.06),
        new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })
      );
      mark.position.set(0, i * markSpacing, -0.55);
      this.scene.add(mark);
      this.marks.push(mark);
    }

    // Wolken ziehen seitlich vorbei und wandern mit demselben Band. Sie sind der
    // billigste Höhenmesser, den es gibt.
    this.driftClouds = [];
    for (let i = 0; i < 7; i += 1) {
      const cloud = createCloud(i * 5 + 2);
      cloud.position.set(-7 + (i % 3) * 6.5, (i / 7) * bandHeight, 2.6 + (i % 2) * 1.6);
      cloud.scale.setScalar(0.9 + (i % 3) * 0.35);
      this.scene.add(cloud);
      this.driftClouds.push(cloud);
    }

    // Colourful climbing holds in each lane, staggered left/right so the
    // hand-over-hand motion has something to grip.
    const holdColors = ["#ff5c8a", "#ffc400", "#43e38c", "#4bb8ff"];
    const count = this.getState()?.players?.length || 4;
    for (let lane = 0; lane < count; lane += 1) {
      const lx = this.laneX(lane, count);
      // Genau so viele Griffe, wie ins Bild passen — sie werden beim Steigen
      // oben wieder angesetzt (siehe scrollWall). Ein endloser Vorrat wäre
      // sonst tausende Objekte für eine Wand, von der man immer nur ein Stück
      // sieht.
      for (let step = 0; step < HOLDS_PER_LANE; step += 1) {
        const side = step % 2 === 0 ? -1 : 1;
        const hold = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.18, 0.22),
          new THREE.MeshLambertMaterial({ color: holdColors[lane % holdColors.length] })
        );
        hold.position.set(lx + side * 0.34, 0.7 + step * WORLD_PER_RUNG, -0.42);
        hold.castShadow = true;
        hold.userData.step = step;
        this.scene.add(hold);
        this.holds.push(hold);
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
      const y = KIN_BASE_Y + shown * WORLD_PER_RUNG;
      animator.groundY = y;

      if ((entry.rung || 0) > (this.lastRung.get(player.id) || 0)) {
        this.lastRung.set(player.id, entry.rung);
        kin.userData.grabAt = now;
        // Kreidestaub am Griff: die einzige Rückmeldung, die man beim Klettern
        // im Augenwinkel sieht, ohne von der eigenen Figur wegzuschauen.
        this.bursts.spawn(
          kin.position.clone().add(new THREE.Vector3(entry.nextSide * -0.3, 0.5, 0.1)),
          ["#f2ece0", "#ffffff"],
          { count: 4, speed: 0.7, up: 0.5, size: 0.045, life: 0.35, gravity: 1.4, drag: 2.6 }
        );
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
      if (minigame.finaleAt) {
        // Es gibt keinen Gipfel mehr, auf den man klettert — am Ende lassen alle
        // los und fallen. Wer weiter oben war, hängt länger, bevor es ihn
        // erwischt: die Reihenfolge des Sturzes IST die Platzierung.
        const place = arcade.places?.[player.id] || 1;
        const since = Math.max(0, now - minigame.finaleAt + 2600);
        const letGoAt = (place - 1) * 340;
        const pose = applyFinaleMood(animator, place, state.players.length);
        if (since > letGoAt) {
          const falling = (since - letGoAt) / 1000;
          // Freier Fall mit Erdbeschleunigung, bis der Boden kommt.
          const drop = 0.5 * 9.81 * falling * falling;
          animator.groundY = Math.max(KIN_BASE_Y, (this.fallFrom.get(player.id) ?? animator.groundY) - drop);
          kin.rotation.z = Math.sin(falling * 7) * 0.5;
          if (!this.fellDone.has(player.id) && animator.groundY <= KIN_BASE_Y + 0.01) {
            this.fellDone.add(player.id);
            this.bursts.spawn(kin.position.clone(), ["#ab9e88", "#ffffff"], { count: 12, speed: 1.8, up: 1, size: 0.07, life: 0.6, gravity: 2.4 });
            if (player.id === controlledId) this.feedback?.vibrate([20, 14, 26]);
          }
        } else {
          this.fallFrom.set(player.id, animator.groundY);
        }
        animator.update(now);
        if (pose.cheer) kin.rotation.z = 0;
      } else {
        // Sway toward the reaching hand while climbing.
        const reach = now < (entry.lastHitAt || 0) + 220 ? entry.nextSide * -0.12 : 0;
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, kin.userData.laneX + reach, frameLerp(0.3, dt));
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

    // Welche Hand als Nächstes dran ist, steht in der Hinweiszeile. Ohne Knöpfe
    // ist das die einzige Ansage — und sie muss da sein, sonst tippt man auf
    // Verdacht und rutscht ab.
    const own = arcade.players[controlledId];
    const wantsLeft = own && !own.finishedAt && own.nextSide === -1;
    if (own && wantsLeft !== this.hintSide) {
      this.hintSide = wantsLeft;
      const hint = this.controls?.querySelector("[data-climb-hint]");
      if (hint) hint.textContent = wantsLeft ? "◀ Jetzt LINKS tippen" : "Jetzt RECHTS tippen ▶";
    }

    // Wand mitziehen: Griffe, die unter dem Bild verschwinden, werden oben
    // wieder angesetzt. So wirkt die Wand endlos, ohne endlos zu sein.
    this.scrollWall(ownY, dt);

    this.shake *= frameDecay(0.9, dt);
    if (minigame.finaleAt) {
      // Pull back to frame the whole summit deck and the celebration.
      const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
      const desired = new THREE.Vector3(shakeX, this.summitY + 0.6, (this.baseCamZ || 7.4) + 1.8);
      this.camera.position.lerp(desired, frameLerp(0.08, dt));
      this.camera.lookAt(0, this.summitY + 0.2, 0);
    } else {
      // Follow the own climber in x (portrait is too narrow for all four lanes)
      // and in y as it rises.
      const followX = (this.ownX || 0) * 0.7;
      const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
      const desired = new THREE.Vector3(followX + shakeX, Math.max(2.4, ownY) + (this.baseCamLift || 0.4), this.baseCamZ || 7.4);
      this.camera.position.lerp(desired, frameLerp(0.1, dt));
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
    // Ohne Gipfel gibt es kein „von" — die erreichte Höhe IST die Wertung.
    this.hud.querySelector("[data-kinetic-score]").textContent = `${own?.rung || 0}`;

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

  // Setzt Griffe, die weit unter der Kamera liegen, um ein ganzes Band nach
  // oben. Der Wandblock folgt in groben Schritten, damit seine Textur nicht
  // sichtbar mitrutscht.
  scrollWall(ownY, dt = 0) {
    const band = HOLDS_PER_LANE * WORLD_PER_RUNG;
    const floor = ownY - band * 0.3;
    const wrap = (object) => {
      while (object.position.y < floor) object.position.y += band;
      while (object.position.y > floor + band) object.position.y -= band;
    };
    this.holds.forEach(wrap);
    this.decor?.forEach(wrap);
    this.marks?.forEach(wrap);
    this.driftClouds?.forEach((cloud) => {
      // Wolken driften seitlich, damit die Wand auch dann lebt, wenn man
      // gerade nicht steigt.
      cloud.position.x += dt * 0.55;
      if (cloud.position.x > 9) cloud.position.x -= 18;
      wrap(cloud);
    });
    if (this.cliff) {
      const target = Math.floor(ownY / 20) * 20;
      this.cliff.position.y = target + WALL_SPAN / 2 - 2;
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
