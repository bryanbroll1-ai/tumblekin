import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createCloud,
  createNameLabel,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin126";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin126";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin126";

// Bergsteiger — die Wand zeigt, welche Hand als Nächstes greifen muss. Der
// richtige Griff zieht eine Sprosse hoch, der falsche rutscht eine ab.
const LANE_GAP = 1.55;
// Kletterhöhe je Sprosse. Vorher wurde die Höhe auf die gesamte Wand normiert
// (rung / arcade.height); seit es keinen Gipfel mehr gibt, ist arcade.height nur
// noch ein Sicherheitsnetz — normiert darauf käme man optisch kaum vom Boden.
// Jetzt zählt ein fester Abstand je Sprosse, und die Kamera fährt mit.
const WORLD_PER_RUNG = 0.42;
// So viele Griffe je Bahn hängen an der Wand und wandern beim Steigen oben
// wieder an. MUSS mit CLIMB_PATTERN_LEN auf dem Server übereinstimmen: nur dann
// steht nach einem Umlauf wieder derselbe Griff da, den der Server verlangt.
const HOLDS_PER_LANE = 40;
const HOLD_REACH = 0.4;               // seitlicher Abstand des Griffs zur Bahn
const HOLD_LIFT = 0.95;               // Griffhöhe über den Füssen — Reichweite
const WALL_SPAN = 40;                 // Höhe des Wandblocks, der mitgezogen wird
const WALL_WIDTH = 15;                // breit genug, dass nie Himmel daneben steht
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
    this.holdsByLane = [];
    this.ladderPips = new Map();
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
      <div class="climb-ladder" data-climb-ladder></div>
    `);
    this.createScene();
    this.buildLadder();

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
    this.holdsByLane = [];
    this.ladderPips.clear();
    this.nextMark = null;
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    // Sonne und Schattenfenster wandern mit (siehe scrollWall). Sie standen
    // vorher fest zwischen y -4 und 14 — sobald man höher kam als vierzehn
    // Einheiten, hörte die Schattenkarte auf, und quer über die Wand lief eine
    // harte Kante zwischen beschattet und unbeschattet.
    this.sun = addStageLights(this.scene, {
      sunPosition: [-4, 12, 8],
      shadow: { left: -9, right: 9, top: 11, bottom: -11 },
      sunIntensity: 2.9,
      groundColor: 0x8a9ab0
    });
    this.scene.add(this.sun.target);

    // Die Wand hat kein Ende mehr — geklettert wird auf Zeit. Sie ist deshalb
    // ein hoher Block, der mit der Kamera mitwandert, statt eines Stücks, das
    // irgendwann unter einem aufhört.
    // Sie ist BREITER als das Bild. Vorher war sie neun Einheiten breit, und
    // sobald die Kamera zurückwich, stand links und rechts Himmel neben ihr —
    // die Wand sah aus wie eine Platte, die im Nichts hängt.
    this.cliff = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_WIDTH, WALL_SPAN, 1),
      new THREE.MeshLambertMaterial({ color: "#9c8f7a" })
    );
    this.cliff.position.set(0, 0, -1.1);
    this.cliff.receiveShadow = true;
    this.scene.add(this.cliff);
    // Die Wand hatte bisher nur die bunten Griffe auf einer glatten Platte —
    // beim Klettern bewegte sich sichtbar gar nichts ausser den Figuren, und man
    // konnte nicht sehen, wie hoch man schon war. Drei Lagen ändern das, und
    // alle drei wandern mit demselben Band wie die Griffe (siehe scrollWall):
    //
    //  * Gesteinsschichten, die der Wand Struktur geben,
    //  * eine Höhenmarke alle zehn Sprossen,
    //  * Wolken, die im Vorbeiziehen zeigen, wie schnell es hochgeht.
    this.decor = [];
    const bandHeight = HOLDS_PER_LANE * WORLD_PER_RUNG;

    // Die Bahnen mit den Griffen liegen zwischen -2.8 und +2.8. ALLES, was aus
    // der Wand herausragt, muss draussen bleiben — sonst wächst mitten im Bild
    // ein Balken durch einen Griff. Genau daran krankte die alte Fassung: die
    // Felsstufen standen einen Drittelmeter vor der Wand, quer über die ganze
    // Breite, und sahen zwischen den Griffen aus wie angenagelte Bretter.
    //
    // Struktur INNERHALB der Bahnen ist deshalb flach: dünne Platten, die
    // knapp vor der Wandfläche liegen und nur über die Farbe wirken.
    // Durchgehende Gesteinsbänder über die ganze Breite, nur eine Nuance von der
    // Wandfarbe entfernt. Als einzelne Rechtecke sahen sie aus wie aufgeklebte
    // Zettel; als Bänder liest man sie als Schichtung — und weil die Bänder
    // waagrecht laufen, sieht man beim Steigen sofort, dass es aufwärts geht.
    const strata = [
      new THREE.MeshLambertMaterial({ color: "#94886f" }),
      new THREE.MeshLambertMaterial({ color: "#a79a82" }),
      new THREE.MeshLambertMaterial({ color: "#8e8268" })
    ];
    for (let i = 0; i < 16; i += 1) {
      const t = i / 16;
      const layer = new THREE.Mesh(
        // FLÄCHE, kein Quader. Ein 0.05 tiefer Quader zeigt der Kamera seine
        // Unterseite als haarfeine dunkle Linie — im Bild sah jede Schicht aus,
        // als hätte sie einen Kratzer darunter.
        new THREE.PlaneGeometry(WALL_WIDTH, 0.3 + (i % 4) * 0.28),
        strata[i % strata.length]
      );
      layer.position.set(0, 0.4 + t * bandHeight, -0.575);
      this.scene.add(layer);
      this.decor.push(layer);
    }
    // Ein paar unregelmässige Flecken darüber, damit die Bänder nicht wie ein
    // Streifenmuster wirken.
    for (let i = 0; i < 14; i += 1) {
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2 + (i % 4) * 1.1, 0.5 + (i % 3) * 0.4),
        strata[(i + 1) % strata.length]
      );
      patch.position.set(-6.2 + ((i * 4.3) % 12.4), 0.9 + ((i * 1.31) % 1) * bandHeight, -0.57);
      this.scene.add(patch);
      this.decor.push(patch);
    }

    // Echtes Relief nur am Rand, weit ausserhalb der Bahnen. Dort darf es
    // herausragen und Schatten werfen — da hängt kein Griff, durch den es
    // wachsen könnte.
    const boulderMat = new THREE.MeshLambertMaterial({ color: "#a2957d" });
    for (let i = 0; i < 12; i += 1) {
      const boulder = new THREE.Mesh(new THREE.BoxGeometry(0.9 + (i % 3) * 0.8, 0.45, 0.42), boulderMat);
      const side = i % 2 === 0 ? -1 : 1;
      boulder.position.set(side * (3.5 + (i % 3) * 1.1), ((i / 12) * bandHeight + 0.6) % bandHeight, -0.42);
      boulder.castShadow = true;
      boulder.receiveShadow = true;
      this.scene.add(boulder);
      this.decor.push(boulder);
    }

    // Höhenmarken: ein heller Streifen alle zehn Sprossen. Ohne sie fühlte sich
    // die Wand endlos gleich an, weil jeder Ausschnitt aussah wie der vorige.
    // Breiter und weicher als vorher — als dünne Linie sah der Streifen aus wie
    // ein Riss im Bild statt wie eine Markierung.
    this.marks = [];
    const markSpacing = 10 * WORLD_PER_RUNG;
    for (let i = 0; i < Math.ceil(bandHeight / markSpacing) + 1; i += 1) {
      // Gemalte Kreidelinie statt durchscheinendem Streifen: als halbdurch-
      // sichtige Fläche mit depthWrite:false wurde daraus im Bild ein dünner
      // dunkler Strich, der wie ein Kratzer aussah. Ein normal beleuchtetes
      // Band in hellem Ton liest sich als Markierung auf dem Fels.
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(WALL_WIDTH, 0.14),
        new THREE.MeshLambertMaterial({ color: "#e9dcc0" })
      );
      mark.position.set(0, i * markSpacing, -0.56);
      this.scene.add(mark);
      this.marks.push(mark);
    }

    // Wolken ziehen VOR der Wand vorbei und wandern mit demselben Band. Sie sind
    // der billigste Höhenmesser, den es gibt — aber sie dürfen nicht auf der
    // eigenen Figur parken. Vorher waren es sieben grosse, langsame Wolken auf
    // Kamerahöhe; eine davon stand sekundenlang direkt vor dem Kletterer.
    // Jetzt: weniger, kleiner, durchscheinend und deutlich schneller, also ein
    // Vorbeihuschen statt einer Nebelbank.
    this.driftClouds = [];
    for (let i = 0; i < 5; i += 1) {
      const cloud = createCloud(i * 5 + 2);
      cloud.position.set(-8 + i * 4.2, (i / 5) * bandHeight, 3.8 + (i % 2) * 1.3);
      cloud.scale.setScalar(0.45 + (i % 3) * 0.18);
      cloud.traverse((part) => {
        if (!part.material) return;
        // Leicht durchscheinend, aber MIT Tiefenschreiben. Ohne das sieht man
        // durch die vordere Wolkenhälfte in die hintere hinein, und der Klumpen
        // Würfel wird zu einem fleckigen Rechteck.
        part.material = part.material.clone();
        part.material.transparent = true;
        part.material.opacity = 0.88;
      });
      this.scene.add(cloud);
      this.driftClouds.push(cloud);
    }

    // Die Griffe stehen dort, wo der Server sie verlangt. Sie sind damit keine
    // Deko mehr, sondern die Ansage: wo der nächste Griff hängt, muss die Hand
    // hin. Meist wechseln sie die Seite, alle paar Sprossen kommen zwei auf
    // derselben — wer nur trommelt, rutscht dort ab.
    this.sides = this.readSides();
    const holdColors = ["#ff5c8a", "#ffc400", "#43e38c", "#4bb8ff"];
    const count = this.getState()?.players?.length || 4;
    for (let lane = 0; lane < count; lane += 1) {
      const lx = this.laneX(lane, count);
      const laneMat = new THREE.MeshLambertMaterial({ color: holdColors[lane % holdColors.length] });
      const laneHolds = [];
      // Genau so viele Griffe, wie ins Bild passen — sie werden beim Steigen
      // oben wieder angesetzt (siehe scrollWall). Ein endloser Vorrat wäre
      // sonst tausende Objekte für eine Wand, von der man immer nur ein Stück
      // sieht. Weil das Band genau so lang ist wie die Griffolge, steht nach
      // einem Umlauf wieder derselbe Griff da.
      for (let step = 0; step < HOLDS_PER_LANE; step += 1) {
        const hold = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.24), laneMat);
        hold.position.set(
          lx + this.sideAt(step) * HOLD_REACH,
          KIN_BASE_Y + step * WORLD_PER_RUNG + HOLD_LIFT,
          -0.48                 // bündig an der Wandfläche (die liegt bei -0.6)
        );
        hold.castShadow = true;
        hold.userData.step = step;
        this.scene.add(hold);
        this.holds.push(hold);
        laneHolds[step] = hold;
      }
      this.holdsByLane[lane] = laneHolds;
    }

    // Der nächste Griff der EIGENEN Bahn bekommt einen leuchtenden Ring. Ohne
    // ihn muss man die Seite aus der Hinweiszeile unten lesen, während der Blick
    // oben an der Wand hängt — genau der Blickwechsel, der beim Klettern
    // Sprossen kostet.
    this.nextMark = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.05, 8, 18),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, toneMapped: false })
    );
    this.nextMark.visible = false;
    this.scene.add(this.nextMark);

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

  // Die Griffolge kommt vom Server, damit Wand und Regel dasselbe sagen. Fehlt
  // sie (alter Server), bleibt es beim schlichten Hand über Hand.
  readSides() {
    const raw = (this.update || this.minigame)?.arcade?.sides;
    if (Array.isArray(raw) && raw.length > 0) return raw.map((side) => (side < 0 ? -1 : 1));
    return Array.from({ length: HOLDS_PER_LANE }, (_, step) => (step % 2 === 0 ? -1 : 1));
  }

  sideAt(rung) {
    const sides = this.sides;
    return sides[((rung % sides.length) + sides.length) % sides.length];
  }

  // Höhenleiter am Bildrand: ein Punkt je Spieler auf seiner Höhe. Alle vier
  // Figuren gleichzeitig ins Bild zu holen geht hier nicht — nach zehn Sekunden
  // liegen zwanzig Welteinheiten zwischen dem Ersten und dem Letzten, und die
  // Kamera müsste so weit weg, dass man die eigene Figur nicht mehr erkennt.
  // Die Leiter zeigt denselben Stand auf zwei Zentimetern.
  buildLadder() {
    const rail = this.hud?.querySelector("[data-climb-ladder]");
    if (!rail) return;
    const own = this.getControlledPlayerId();
    (this.getState()?.players || []).forEach((player) => {
      const pip = document.createElement("i");
      pip.className = player.id === own ? "is-own" : "";
      pip.style.background = player.color;
      rail.appendChild(pip);
      this.ladderPips.set(player.id, pip);
    });
  }

  syncLadder(arcade, state) {
    if (this.ladderPips.size === 0) return;
    let top = 8;
    state.players.forEach((player) => { top = Math.max(top, arcade.players[player.id]?.rung || 0); });
    state.players.forEach((player) => {
      const pip = this.ladderPips.get(player.id);
      if (!pip) return;
      const share = (arcade.players[player.id]?.rung || 0) / top;
      pip.style.bottom = `${(4 + share * 92).toFixed(1)}%`;
    });
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const count = this.getState()?.players?.length || 4;
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    // Kein Schattenfleck: an einer senkrechten Wand gibt es keinen Boden, auf
    // den er fallen könnte. Er lag bisher unbenutzt und unsichtbar im Ursprung.
    kin.userData.label = label;
    kin.userData.lane = index;
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

      // Am Ende bleibt jeder da hängen, wo er ist, und feiert oder hängt
      // durch — je nach Platz.
      //
      // Vorher liessen alle los und fielen im freien Fall bis auf Bodenhöhe.
      // Das konnte gar nicht funktionieren: nach 26 Sekunden ist der Erste
      // dreissig Welteinheiten über dem Boden, die Kamera stand auf einer festen
      // "Gipfelhöhe", die mit niemandem mehr etwas zu tun hatte, und man sah am
      // Schluss eine leere blaue Fläche mit einer Wandkante darin. Die erreichte
      // Höhe IST das Ergebnis — also bleibt das Bild dort, wo sie erreicht wurde.
      if (minigame.finaleAt) {
        const place = arcade.places?.[player.id] || 1;
        applyFinaleMood(animator, place, state.players.length);
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, kin.userData.laneX, frameLerp(0.3, dt));
        kin.rotation.z = 0;
        animator.update(now);
        if (player.id === controlledId && !this.placeShown) {
          this.placeShown = true;
          this.bursts.spawn(
            kin.position.clone().add(new THREE.Vector3(0, 0.6, 0.3)),
            place === 1 ? ["#ffd15c", "#ffffff", player.color] : [player.color, "#ffffff"],
            { count: place === 1 ? 26 : 12, speed: 2.4, up: 2.6, size: 0.1, life: 1, drag: 1.2 }
          );
          this.floaters.pop(
            kin.position.clone().add(new THREE.Vector3(0, 1.3, 0.3)),
            place === 1 ? "PLATZ 1! 🏔️" : `PLATZ ${place}`,
            { color: place === 1 ? "#ffe36b" : "#ffffff", size: 0.5, life: 1.6, rise: 0.8 }
          );
        }
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
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.75;
      if (player.id === controlledId) { ownY = y; this.ownX = kin.userData.laneX; this.ownLane = index; }
    });

    this.bursts.update(dt);

    this.floaters.update(dt, this.camera);

    // Welche Hand als Nächstes dran ist, steht in der Hinweiszeile UND als
    // leuchtender Ring am nächsten Griff. Ohne Knöpfe ist das die einzige
    // Ansage — und sie muss da sein, sonst tippt man auf Verdacht.
    const own = arcade.players[controlledId];
    const wantsLeft = own && !own.finishedAt && own.nextSide === -1;
    const hintKey = minigame.finaleAt ? "ende" : wantsLeft;
    if (own && hintKey !== this.hintSide) {
      this.hintSide = hintKey;
      const hint = this.controls?.querySelector("[data-climb-hint]");
      if (hint) {
        hint.textContent = minigame.finaleAt
          ? "Geschafft!"
          : wantsLeft ? "◀ Jetzt LINKS tippen" : "Jetzt RECHTS tippen ▶";
      }
    }
    this.syncNextMark(own, minigame, now);
    this.syncLadder(arcade, state);

    // Wand mitziehen: Griffe, die unter dem Bild verschwinden, werden oben
    // wieder angesetzt. So wirkt die Wand endlos, ohne endlos zu sein.
    this.scrollWall(ownY, dt);

    this.shake *= frameDecay(0.9, dt);
    // Die Kamera bleibt IMMER an der eigenen Figur — im Finale genauso wie
    // beim Klettern, nur einen Schritt weiter weg. Auf einem hochkanten Handy
    // liegen zwischen dem Ersten und dem Letzten nach kurzer Zeit zwanzig
    // Welteinheiten; alle vier gleichzeitig zu zeigen hiesse, die eigene Figur
    // auf ein paar Pixel zu schrumpfen. Wie sie zueinander stehen, sagt die
    // Höhenleiter am Bildrand.
    const followX = (this.ownX || 0) * 0.7;
    const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
    const eyeY = Math.max(2.4, ownY);
    const pullBack = minigame.finaleAt ? 1.6 : 0;
    const desired = new THREE.Vector3(
      followX + shakeX,
      eyeY + (this.baseCamLift || 0.4),
      (this.baseCamZ || 7.4) + pullBack
    );
    this.camera.position.lerp(desired, frameLerp(minigame.finaleAt ? 0.08 : 0.1, dt));
    this.camera.lookAt(followX, eyeY + 0.4, 0);

    this.updateHud(minigame, arcade, state, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    this.renderer.render(this.scene, this.camera);
  }

  // Ring auf den Griff setzen, der als Nächstes dran ist. Er sitzt an genau dem
  // Griff, der beim Umlauf des Bandes gerade diese Sprosse darstellt — deshalb
  // muss das Band so lang sein wie die Griffolge.
  syncNextMark(own, minigame, now) {
    const lane = this.holdsByLane[this.ownLane ?? 0];
    const hold = own && !own.finishedAt && !minigame.finaleAt
      ? lane?.[((own.rung || 0) % HOLDS_PER_LANE)]
      : null;
    if (!this.nextMark) return;
    this.nextMark.visible = Boolean(hold);
    if (!hold) return;
    this.nextMark.position.set(hold.position.x, hold.position.y, hold.position.z + 0.16);
    const pulse = 1 + Math.sin(now / 150) * 0.12;
    this.nextMark.scale.setScalar(pulse);
    this.nextMark.material.opacity = 0.55 + Math.sin(now / 150) * 0.25;
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
    if (!banner) return;
    // Das Banner sagte bisher "Gipfel!", sobald jemand fertig war — nur wird
    // niemand fertig, die Obergrenze liegt bei 400 Sprossen. Es war damit tote
    // Anzeige. Jetzt trägt es das Einzige, was am Ende wirklich zählt.
    const place = minigame.finaleAt ? (minigame.arcade?.places?.[this.getControlledPlayerId()] || 0) : 0;
    if (place) {
      banner.hidden = false;
      banner.textContent = place === 1 ? "PLATZ 1 — GESCHAFFT! 🏔️" : `PLATZ ${place} · ${own?.rung || 0} Sprossen`;
      banner.style.background = place === 1 ? "#ffc400" : "#0b1419";
      banner.style.color = place === 1 ? "#5c4508" : "#ffffff";
    } else {
      banner.hidden = true;
    }
  }

  // Setzt Griffe, die weit unter der Kamera liegen, um ein ganzes Band nach
  // oben. Der Wandblock selbst folgt stufenlos mit.
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
      cloud.position.x += dt * 1.5;
      if (cloud.position.x > 11) cloud.position.x -= 22;
      wrap(cloud);
    });
    // Sonne und Schattenfenster mitziehen, sonst endet die Schattenkarte
    // irgendwo auf halber Höhe und schneidet eine harte Kante quer durch die
    // Wand.
    if (this.sun) {
      this.sun.position.set(-4, ownY + 12, 8);
      this.sun.target.position.set(0, ownY, 0);
      this.sun.target.updateMatrixWorld();
    }
    // Die Wand bleibt um die eigene Figur zentriert. Sie sprang bisher in
    // Zwanzigerschritten nach: alle 48 Sprossen klappte ihre UNTERKANTE mitten
    // ins Bild, und darunter hingen Griffe, Stufen und Wolken frei im Himmel.
    // Genau das war der "Block, der durch alles durchbuggt".
    //
    // Gesprungen wurde, damit die Oberfläche nicht sichtbar mitrutscht — aber
    // die Wand hat gar keine Textur, sie ist eine einfarbige Fläche. Stufenlos
    // mitzuziehen sieht man ihr deshalb nicht an, und die Kante ist mit einem
    // halben Wandblock Abstand nach oben und unten nie wieder im Bild.
    if (this.cliff) this.cliff.position.y = ownY;
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamLift = portrait ? 0.6 : 0.4;
      // Etwas weiter zurück als vorher: die Kamera wird nicht mehr von
      // fitKinsInView aufgezogen, und ohne den Ausgleich stand man mit der Nase
      // an der Wand.
      this.baseCamZ = portrait ? 9.8 : 8.4;
      camera.fov = portrait ? 56 : 50;
    });
  }
}
