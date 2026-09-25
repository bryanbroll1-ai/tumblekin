import * as THREE from "/vendor/three/three.module.js";
import { createCloud, reachArm, standOn } from "./VoxelKit.js?v=tumblekin200";
import { addStageLights } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Bergsteiger — die Wand zeigt, welche Hand als Nächstes greifen muss. Der
// richtige Griff zieht eine Sprosse hoch, der falsche rutscht eine ab. Oben
// auf 70 wartet der Gipfel: wer ankommt, klettert über die Kante, hisst seine
// Fahne und jubelt; unter allen, die es schaffen, gewinnt die kürzere Zeit.
//
// Die Hände liegen AUF den Griffen. Früher hingen die Griffe fast einen Meter
// über der Figur und die Arme ruderten davor in der Luft. Jetzt sitzen die
// Griffe dort, wo eine Hand hinkommt, die Figur hängt dicht an der Wand, und
// nach der Pose richtet reachArm jede Hand auf ihren Griff aus — die greifende
// fährt dabei vom alten zum neuen Griff hinüber.
//
// Die Kletterbewegung war bisher von Hand an Arme und Füsse der alten Figur
// geschrieben; mit der neuen Figur griff sie ins Leere, und alle hingen steif
// an der Wand. Jetzt greift die Hand, die dran war, sichtbar nach oben, das
// Bein auf der anderen Seite drückt nach, und der Körper zieht sich hoch. Wer
// abrutscht, schaut erschrocken nach unten. Am Ende dreht sich jeder zur
// Kamera: der Sieger jubelt, der Rest hängt durch.
const LANE_GAP = 1.55;
// Kletterhöhe je Sprosse. Ein fester Abstand je Sprosse, die Kamera fährt mit.
const WORLD_PER_RUNG = 0.26;
// So viele Griffe je Bahn hängen an der Wand und wandern beim Steigen oben
// wieder an. MUSS mit CLIMB_PATTERN_LEN auf dem Server übereinstimmen: nur dann
// steht nach einem Umlauf wieder derselbe Griff da, den der Server verlangt.
const HOLDS_PER_LANE = 40;
// Griffe in Reichweite: bei Sprosse n hält eine Hand Griff n-1 (etwas über
// der Schulter), die andere den letzten auf ihrer Seite (etwas darunter). Die
// Schulter sitzt auf Höhe von kin.position.y, der Arm ist knapp 0,19 lang.
// Der Kopf ist 0,44 breit und hängt dicht an der Wand. Bei 0,3 Abstand und
// 0,3 breiten Griffen steckte die Innenkante jedes Griffs sieben Zentimeter im
// Kopf — von hinten sah es aus, als wüchse der Griff aus dem Gesicht. Jetzt
// liegt die Innenkante knapp ausserhalb, und die Hand reicht trotzdem hin.
const HOLD_REACH = 0.37;              // seitlicher Abstand des Griffs zur Bahn
const HOLD_W = 0.26;
const HOLD_LIFT = 0.39;               // Griffhöhe über der Schulter bei Sprosse 0
const HOLD_FACE_Z = -0.36;            // Vorderseite der Griffe
const KIN_Z = -0.36;                  // die Figur hängt dicht an der Wand
const PLATEAU_Z = -0.95;              // dort steht, wer oben angekommen ist
const WALL_SPAN = 40;                 // Höhe des Wandblocks, der mitgezogen wird
const WALL_WIDTH = 15;                // breit genug, dass nie Himmel daneben steht
const KIN_BASE_Y = 0.5;
const GRAB_MS = 340;
const _handA = new THREE.Vector3();
const _handB = new THREE.Vector3();
const _handFrom = new THREE.Vector3();

export class CliffClimb extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.smoothRung = new Map();
    this.holds = [];
    this.holdsByLane = [];
    this.ladderPips = new Map();
    this.lastRung = new Map();
    this.lastSlips = new Map();
    this.lastFinished = new Map();
    this.grabAt = new Map();
    this.finishSeenAt = new Map();
    this.ownY = KIN_BASE_Y;
    this.ownX = 0;
    this.ownLane = 0;
    this.finaleFocus = false;
    this.labelY = 0.72;
  }

  stage() {
    return { label: "3D Bergsteiger", background: "#a8e2f4", fog: ["#a8e2f4", 22, 48], lights: false };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-climb-banner hidden></div>
      <div class="climb-ladder" data-climb-ladder></div>`;
  }

  build() {
    const scene = this.scene;
    // Sonne und Schattenfenster wandern mit (siehe scrollWall).
    this.sun = addStageLights(scene, {
      sunPosition: [-4, 12, 8],
      shadow: { left: -9, right: 9, top: 11, bottom: -11 },
      sunIntensity: 2.9,
      groundColor: 0x8a9ab0
    });
    scene.add(this.sun.target);

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
    // Der Gipfel: die Wand endet eine Handbreit über dem letzten Griff.
    this.summit = (this.update || this.minigame)?.arcade?.height || 70;
    this.summitTop = KIN_BASE_Y + this.summit * WORLD_PER_RUNG + 0.3;
    this.cliff.position.set(0, this.summitTop - WALL_SPAN / 2, -1.1);
    this.cliff.receiveShadow = true;
    scene.add(this.cliff);
    this.buildSummit();
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
    // Die flachen Lagen liegen nur Millimeter voreinander, und benachbarte
    // Bänder und Flecken überlappen sich. Über die Kameraentfernung reichte
    // die Tiefengenauigkeit dafür nicht — sie kämpften um dieselben Pixel, und
    // die Wand flackerte in schraffierten Streifen.
    //
    // Deshalb entscheidet über die Deko nicht mehr die Tiefe, sondern die
    // Reihenfolge: die Lagen schreiben keine Tiefe und werden nach der Wand in
    // fester Folge gemalt (Bänder, Flecken, Marken). Der Polygon-Versatz hält
    // sie sicher vor der Wandfläche; Griffe und Figuren sind zu dem Zeitpunkt
    // schon im Tiefenpuffer und verdecken sie weiter richtig.
    const decal = (color, layer) => new THREE.MeshLambertMaterial({
      color,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -layer,
      polygonOffsetUnits: -layer * 4
    });
    const flat = (geometry, material) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1 + Math.abs(material.polygonOffsetFactor);
      mesh.receiveShadow = true;
      return mesh;
    };
    const strata = [decal("#94886f", 1), decal("#a79a82", 1), decal("#8e8268", 1)];
    const patchMats = [decal("#94886f", 2), decal("#a79a82", 2), decal("#8e8268", 2)];
    for (let i = 0; i < 16; i += 1) {
      const t = i / 16;
      const layer = flat(
        // FLÄCHE, kein Quader. Ein 0.05 tiefer Quader zeigt der Kamera seine
        // Unterseite als haarfeine dunkle Linie — im Bild sah jede Schicht aus,
        // als hätte sie einen Kratzer darunter.
        new THREE.PlaneGeometry(WALL_WIDTH, 0.3 + (i % 4) * 0.28),
        strata[i % strata.length]
      );
      layer.position.set(0, 0.4 + t * bandHeight, -0.59);
      scene.add(layer);
      this.decor.push(layer);
    }
    // Ein paar unregelmässige Flecken darüber, damit die Bänder nicht wie ein
    // Streifenmuster wirken.
    for (let i = 0; i < 14; i += 1) {
      const patch = flat(
        new THREE.PlaneGeometry(1.2 + (i % 4) * 1.1, 0.5 + (i % 3) * 0.4),
        patchMats[(i + 1) % patchMats.length]
      );
      patch.position.set(-6.2 + ((i * 4.3) % 12.4), 0.9 + ((i * 1.31) % 1) * bandHeight, -0.58);
      scene.add(patch);
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
      scene.add(boulder);
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
      const mark = flat(
        new THREE.PlaneGeometry(WALL_WIDTH, 0.14),
        decal("#e9dcc0", 3)
      );
      mark.position.set(0, i * markSpacing, -0.57);
      scene.add(mark);
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
      scene.add(cloud);
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
        const hold = new THREE.Mesh(new THREE.BoxGeometry(HOLD_W, 0.2, 0.24), laneMat);
        hold.position.set(
          lx + this.sideAt(step) * HOLD_REACH,
          KIN_BASE_Y + step * WORLD_PER_RUNG + HOLD_LIFT,
          -0.48                 // bündig an der Wandfläche (die liegt bei -0.6)
        );
        hold.castShadow = true;
        hold.userData.step = step;
        scene.add(hold);
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
      new THREE.TorusGeometry(0.22, 0.045, 8, 18),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, toneMapped: false })
    );
    this.nextMark.visible = false;
    scene.add(this.nextMark);

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = this.laneX(index, players.length);
      this.addKin(player, index, { x, ground: KIN_BASE_Y - 0.3, z: KIN_Z, facing: Math.PI });
      // An einer senkrechten Wand gibt es keinen Boden für einen Schatten.
      const shadow = this.shadows.get(player.id);
      shadow.userData.manual = true;
      shadow.visible = false;
      this.kins.get(player.id).userData.laneX = x;
      if (player.id === this.getControlledPlayerId()) {
        this.ownX = x;
        this.ownLane = index;
      }
    });
    this.buildLadder();
  }

  // Schnee auf der Kante, Felsspitzen dahinter und je Bahn eine Fahnenstange,
  // an der die Fahne hochgeht, sobald jemand oben ist.
  buildSummit() {
    const scene = this.scene;
    const top = this.summitTop;
    const snow = new THREE.Mesh(new THREE.BoxGeometry(WALL_WIDTH, 0.16, 1.3), new THREE.MeshLambertMaterial({ color: "#f7fbff" }));
    snow.position.set(0, top + 0.02, -1.05);
    snow.receiveShadow = true;
    scene.add(snow);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(WALL_WIDTH, 0.1, 0.16), new THREE.MeshLambertMaterial({ color: "#e4eef8" }));
    // Eine Spur vor der Schneekante: bündig mit ihr flimmerte die Front.
    lip.position.set(0, top - 0.02, -0.46);
    scene.add(lip);
    const rock = new THREE.MeshLambertMaterial({ color: "#8d8069" });
    const cap = new THREE.MeshLambertMaterial({ color: "#f3f8fd" });
    [[-5.6, 2.6, 2.2], [-3.1, 3.8, 2.8], [0.4, 5.2, 3.4], [3.6, 3.4, 2.6], [6, 2.2, 2]].forEach(([x, h, w], i) => {
      const peak = new THREE.Mesh(new THREE.ConeGeometry(w, h, 4), rock);
      peak.position.set(x, top + h / 2, -3.2 - (i % 2) * 1.4);
      peak.rotation.y = Math.PI / 4 + i * 0.3;
      scene.add(peak);
      // Die Kappe ist etwas bauchiger als der Berg. Mit derselben Steigung lag
      // ihre Fläche genau auf der Bergflanke, und die Spitzen flimmerten
      // schraffiert zwischen Schnee und Fels.
      const tip = new THREE.Mesh(new THREE.ConeGeometry(w * 0.4, h * 0.36, 4), cap);
      tip.position.set(x, top + h - h * 0.18 + 0.03, peak.position.z);
      tip.rotation.y = peak.rotation.y;
      scene.add(tip);
    });
    this.flags = new Map();
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = this.laneX(index, players.length) + 0.42;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.05), new THREE.MeshLambertMaterial({ color: "#6b4a2e" }));
      pole.position.set(x, top + 0.6, PLATEAU_Z - 0.2);
      pole.castShadow = true;
      scene.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.02), new THREE.MeshLambertMaterial({ color: player.color }));
      flag.position.set(x + 0.19, top + 0.25, PLATEAU_Z - 0.2);
      scene.add(flag);
      this.flags.set(player.id, { flag, low: top + 0.25, high: top + 1.02, raisedAt: null });
    });
  }

  // Wo Griff Nummer `step` einer Bahn in der Welt hängt (Vorderseite).
  holdPoint(laneX, step, out = new THREE.Vector3()) {
    return out.set(
      laneX + this.sideAt(step) * HOLD_REACH,
      KIN_BASE_Y + step * WORLD_PER_RUNG + HOLD_LIFT,
      HOLD_FACE_Z
    );
  }

  shot() {
    return {
      look: [this.ownX * 0.7, KIN_BASE_Y + 0.9, 0],
      frame: { w: 3.3, h: 3.6 },
      yaw: 0.18,
      pitch: -0.1,
      fov: 40,
      ease: 0.12,
      keepMargin: 0.85,
      intro: { yaw: 0.45, pitch: 0.2, zoom: 1.35 },
      finale: false
    };
  }

  // Keine Knöpfe: die LINKE Bildhälfte ist die linke Hand, die rechte die
  // rechte. Das ist dieselbe Geste, aber sie zeigt direkt auf das, was man
  // meint — und der Blick bleibt oben an der Wand.
  bind() {
    this.controls.innerHTML = `<p class="trace-hint" data-climb-hint>Abwechselnd links und rechts tippen</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      const rect = this.webglCanvas.getBoundingClientRect();
      const share = (event.clientX - rect.left) / Math.max(1, rect.width);
      this.sendGrab(share < 0.5 ? -1 : 1);
    });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.holds = [];
    this.holdsByLane = [];
    this.ladderPips.clear();
    this.nextMark = null;
  }

  sendGrab(side) {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt) return;
    this.feedback?.vibrate(6);
    this.sendInput({ action: "grab", side }).catch(() => {});
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
    const top = this.summit || arcade.height || 70;
    state.players.forEach((player) => {
      const pip = this.ladderPips.get(player.id);
      if (!pip) return;
      const share = (arcade.players[player.id]?.rung || 0) / top;
      pip.style.bottom = `${(4 + share * 92).toFixed(1)}%`;
    });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;

      const shown = THREE.MathUtils.lerp(this.smoothRung.get(player.id) ?? 0, entry.rung || 0, Math.min(1, dt * 10));
      this.smoothRung.set(player.id, shown);
      const y = KIN_BASE_Y + shown * WORLD_PER_RUNG;
      animator.groundY = y;

      if ((entry.rung || 0) > (this.lastRung.get(player.id) || 0)) {
        this.lastRung.set(player.id, entry.rung);
        this.grabAt.set(player.id, now);
        // Kreidestaub an genau dem Griff, der eben gepackt wurde.
        this.burst(
          this.holdPoint(kin.userData.laneX, entry.rung - 1).add(new THREE.Vector3(0, 0.04, 0.05)),
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
        animator.expression("scared", 700);
        this.burst(kin.position.clone(), ["#ab9e88", "#ffffff"], { count: 8, speed: 1.5, up: 0.8, size: 0.06, life: 0.5, gravity: 2, drag: 1.8 });
        // Die Schrift nur bei der eigenen Figur. Rutschten zwei Nachbarn
        // gleichzeitig ab, stapelten sich drei Schriftzüge übereinander.
        if (player.id === controlledId) {
          this.pop(kin.position.clone().add(new THREE.Vector3(0, 0.9, 0)), "ABGERUTSCHT!", { color: "#ffb37a", size: 0.32, life: 0.8 });
          this.rig.shake(0.5);
          this.feedback?.sound("error");
          this.feedback?.vibrate([18, 14, 22]);
        }
      }
      if (entry.finishedAt && !this.lastFinished.get(player.id)) {
        this.lastFinished.set(player.id, true);
        this.finishSeenAt.set(player.id, now);
        const flag = this.flags?.get(player.id);
        if (flag) flag.raisedAt = now;
        this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.5, 0)), [player.color, "#ffd15c", "#ffffff"], { count: 22, speed: 2.6, up: 2.8, size: 0.1, life: 0.9, drag: 1.2 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), `OBEN! ${((entry.finishMs || 0) / 1000).toFixed(1)} s`, { color: "#ffe36b", size: 0.46, life: 1.4, rise: 1 });
        if (player.id === controlledId) this.feedback?.sound("win");
      }

      if (entry.finishedAt) {
        // Oben: über die Kante auf das Plateau, zur Kamera drehen, jubeln.
        const over = Math.min(1, (now - (this.finishSeenAt.get(player.id) ?? now)) / 650);
        kin.position.x += (kin.userData.laneX - kin.position.x) * frameLerp(0.2, dt);
        kin.position.z += (PLATEAU_Z - kin.position.z) * frameLerp(over < 1 ? 0.14 : 0.3, dt);
        animator.groundY = standOn(this.summitTop + 0.1) + Math.sin(over * Math.PI) * 0.32;
        kin.rotation.y += Math.atan2(Math.sin(-kin.rotation.y), Math.cos(-kin.rotation.y)) * frameLerp(over < 1 ? 0.06 : 0.14, dt);
        animator.set(over < 1 ? "clamber" : finale && (f.places?.[player.id] || 9) !== 1 ? "wave" : "cheer");
      } else if (finale) {
        // Wer es nicht geschafft hat, bleibt an seinen Griffen hängen und
        // schaut über die Schulter zur Kamera. Bisher drehte sich die Figur
        // quer zur Wand, liess los und machte dann die Siegerpose des
        // Podiums — ein Hüpfer mitten in der Luft neben den Griffen.
        const place = f.places?.[player.id] || players.length;
        kin.position.x += (kin.userData.laneX - kin.position.x) * frameLerp(0.3, dt);
        kin.position.z = KIN_Z;
        kin.rotation.y += (Math.PI * 0.8 - kin.rotation.y) * frameLerp(0.08, dt);
        animator.set("hang");
        animator.lookAt(this.camera.position);
        animator.expression(place === 1 ? "joy" : place >= players.length ? "sad" : "happy", 400);
        if (player.id === controlledId && !this.placeShown) {
          this.placeShown = true;
          this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0.3)), `PLATZ ${place}`, { color: "#ffffff", size: 0.46, life: 1.6, rise: 0.8 });
        }
      } else {
        // Zur greifenden Hand hin pendeln; die Hände legt afterAnimate auf die
        // Griffe.
        const since = now - (this.grabAt.get(player.id) || -1e9);
        const grab = Math.max(0, 1 - since / GRAB_MS);
        const usedSide = -(entry.nextSide || 1);
        const reach = usedSide * 0.06 * grab;
        kin.position.x += (kin.userData.laneX + reach - kin.position.x) * frameLerp(0.3, dt);
        kin.position.z = KIN_Z;
        kin.rotation.y = Math.PI;
        // Zur Wand gedreht liegt der linke Arm des Gerüsts rechts im Bild.
        animator.set("clamber", { params: { up: usedSide > 0 ? -1 : 1, grab } });
      }
      if (kin.userData.label) kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.75;
      if (player.id === controlledId) {
        this.ownY = y;
        this.ownX = kin.userData.laneX;
        this.ownLane = index;
      }
    });

    // Fahnen gehen hoch, sobald jemand oben ist.
    this.flags?.forEach((entry) => {
      const t = entry.raisedAt === null ? 0 : Math.min(1, (now - entry.raisedAt) / 1100);
      const eased = 1 - (1 - t) * (1 - t);
      entry.flag.position.y = entry.low + (entry.high - entry.low) * eased;
      entry.flag.rotation.y = t > 0 ? Math.sin(now / 180) * 0.25 : 0;
    });

    // Welche Hand als Nächstes dran ist: Hinweiszeile und leuchtender Ring.
    const own = arcade.players[controlledId];
    const wantsLeft = own && !own.finishedAt && own.nextSide === -1;
    const hintKey = finale ? "ende" : own?.finishedAt ? "oben" : wantsLeft;
    if (own && hintKey !== this.hintSide) {
      this.hintSide = hintKey;
      const hint = this.controls?.querySelector("[data-climb-hint]");
      if (hint) {
        hint.textContent = finale ? (own.finishedAt ? "Geschafft!" : "Zeit um!")
          : own.finishedAt ? `Oben in ${((own.finishMs || 0) / 1000).toFixed(1)} s — warte auf die anderen`
            : wantsLeft ? "◀ Jetzt LINKS tippen" : "Jetzt RECHTS tippen ▶";
      }
    }
    this.syncNextMark(own, f.minigame, now);
    this.syncLadder(arcade, f.state);
    this.scrollWall(this.ownY, dt);
  }

  // Hände auf die Griffe. Bei Sprosse n hält die zuletzt greifende Hand Griff
  // n-1, die andere den letzten Griff auf ihrer Seite. Direkt nach einem Zug
  // fährt die greifende Hand vom alten Griff ihrer Seite zum neuen hinüber,
  // mit einem kleinen Bogen von der Wand weg.
  afterAnimate(f) {
    const { arcade, players, now } = f;
    if (!arcade) return;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      if (!entry || !kin || entry.finishedAt) return;
      const rung = entry.rung || 0;
      if (rung < 1) return;
      const laneX = kin.userData.laneX;
      const newest = rung - 1;
      const sideA = this.sideAt(newest);
      const target = this.holdPoint(laneX, newest, _handA);
      const since = now - (this.grabAt.get(player.id) || -1e9);
      if (since < GRAB_MS) {
        const prev = this.lastOnSide(newest - 1, sideA);
        if (prev !== null) {
          const t = since / GRAB_MS;
          const eased = t * t * (3 - 2 * t);
          this.holdPoint(laneX, prev, _handFrom);
          target.lerpVectors(_handFrom, target, eased);
          target.z += Math.sin(t * Math.PI) * 0.18;
        }
      }
      reachArm(kin, sideA < 0 ? 0 : 1, target, 1);
      const other = this.lastOnSide(newest - 1, -sideA);
      if (other !== null) reachArm(kin, sideA < 0 ? 1 : 0, this.holdPoint(laneX, other, _handB), 1);
    });
  }

  // Oben Angekommene feiern wie auf jedem Podium. Wer noch an der Wand hängt,
  // behält seine Pose aus tick — eine Siegerpose hiesse loslassen.
  finaleOverride(player, place, f) {
    return !f.arcade?.players?.[player.id]?.finishedAt;
  }

  // Die letzte Sprosse bis einschliesslich `from`, deren Griff auf `side` liegt.
  lastOnSide(from, side) {
    for (let step = from; step >= Math.max(0, from - 4); step -= 1) {
      if (this.sideAt(step) === side) return step;
    }
    return null;
  }

  // Die Kamera bleibt an der eigenen Figur. Nach zehn Sekunden liegen zwanzig
  // Welteinheiten zwischen dem Ersten und dem Letzten — alle zu zeigen hiesse,
  // die eigene Figur auf ein paar Pixel zu schrumpfen. Den Stand zeigt die
  // Höhenleiter am Rand.
  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    return own ? [own] : [];
  }

  rigOptions(f) {
    // Etwas über die Figur: dorthin, wo die nächsten Griffe hängen.
    const eyeY = Math.max(KIN_BASE_Y + 0.9, this.ownY + 0.75);
    return {
      look: [this.ownX * 0.85, eyeY, 0],
      frame: f.finale ? { w: 4.6, h: 4.6 } : undefined
    };
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

  drawHud(f) {
    const { arcade, minigame, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = own?.finishedAt
      ? `🏔️ ${((own.finishMs || 0) / 1000).toFixed(1)} s`
      : `${own?.rung || 0}/${this.summit || arcade.height || 70}`;
    const banner = this.hud.querySelector("[data-climb-banner]");
    if (!banner) return;
    const place = minigame.finaleAt ? (arcade.places?.[controlledId] || 0) : 0;
    if (place) {
      banner.hidden = false;
      banner.textContent = own?.finishedAt
        ? `PLATZ ${place} · oben in ${((own.finishMs || 0) / 1000).toFixed(1)} s${place === 1 ? " 🏔️" : ""}`
        : `PLATZ ${place} · ${own?.rung || 0} von ${this.summit || 70} Griffen`;
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
    const top = this.summitTop ?? Infinity;
    this.holds.forEach((hold) => {
      wrap(hold);
      // Über dem Gipfel hängen keine Griffe mehr.
      const step = Math.round((hold.position.y - KIN_BASE_Y - HOLD_LIFT) / WORLD_PER_RUNG);
      hold.visible = step >= 0 && step < (this.summit ?? Infinity);
    });
    [...(this.decor || []), ...(this.marks || [])].forEach((part) => {
      wrap(part);
      part.visible = part.position.y < top - 0.1;
    });
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
    // Seit es einen Gipfel gibt, steht die Wand fest: ihre Oberkante IST der
    // Gipfel, die Unterkante liegt weit unter dem Einstieg.
  }
}
