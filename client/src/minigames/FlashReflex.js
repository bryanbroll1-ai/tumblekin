import * as THREE from "/vendor/three/three.module.js";
import { noise } from "./VoxelKit.js?v=tumblekin215";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin215";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin215";
import { kiste, lambert, viele, streuer, himmel, zaun } from "./Kulisse.js?v=tumblekin215";

// Blitzreflex — Showdown bei Sonnenuntergang.
//
// Drei Duelle auf der Hauptstrasse einer Westernstadt. Jeder steht mit seiner
// Korkenpistole vor seiner Blechdose auf dem Zaun. Über der Strasse hängt ein
// Schild: erst „DUELL 1", dann drei Punkte — jetzt ist es scharf —, und
// irgendwann springt es auf ein gelbes „!". Wer dann am schnellsten tippt,
// schiesst seine Dose am schnellsten vom Zaun. Gewertet wird die BESTE der
// drei Reaktionen (Best of 3); ein Fehlstart kostet nur dieses Duell.
//
// Vorher war es eine Startampel mit drei Lampen: nüchtern, und zwischen Rot
// und Grün passierte nichts. Jetzt baut jedes Duell Spannung auf: die Kamera
// rückt langsam heran, und die Stadt versucht einen hereinzulegen — ein
// Steppenläufer rollt vorbei, eine Krähe landet auf dem Schild und krächzt,
// ein Windstoss lässt das Schild schaukeln. Wer darauf tippt, hat verloren.
// Die Ablenkungen hängen am Zeitplan des Duells und sind für alle gleich.
//
// Unter jeder Dose hängt ein Täfelchen mit der Zeit dieses Duells; die
// schnellste Hand des Duells bekommt Gold.
const LANE_GAP = 0.86;
const KIN_Z = 1.55;
const FENCE_Z = -1.15;
const SHELF_Y = 1.3;
const CAN_H = 0.3;
const SIGN_Z = -2.7;
const PIVOT_Y = 4.2;
const BOARD_W = 2.1;
const BOARD_H = 1.2;
const DRAW_MS = 1100;          // so lange bleibt der Arm nach dem Schuss oben
const CORK_MS = 150;           // Flugzeit des Korkens bis zur Dose
const WINDOW_MS = 2200;        // wie auf dem Server (REACT_WINDOW_MS)
const PENALTY_MS = 900;        // wie auf dem Server (REACT_PENALTY_MS)
const TEASES = ["tumbleweed", "crow", "gust"];

export class FlashReflex extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lanes = new Map();
    this.lastCount = new Map();
    this.crowned = new Set();
    this.flying = [];
    this.greenSeen = -1;
    this.armSeen = -1;
    this.flash = 0;
    this.labelY = 0.74;
    this.roundTrip = 0;
    this.lastPingAt = 0;
    this.ownPredicted = new Map();   // Duell -> "draw" | "foul", schon beim Tipp gezeigt
    this.signState = "";
    this.teaseSeen = -1;
    this.tension = 0;
  }

  stage() {
    return {
      label: "3D Blitzreflex",
      background: "#f6a46a",
      fog: ["#f2a06e", 20, 62],
      lights: {
        sunPosition: [2.5, 5.5, -12],
        sunColor: 0xffb070,
        sunIntensity: 2.6,
        skyColor: 0xffd2a0,
        groundColor: 0xa8653a,
        hemiIntensity: 2.0,
        fillColor: 0xd2b4ff,
        fillIntensity: 1.5,
        shadow: { left: -6, right: 6, top: 6, bottom: -6 }
      }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>—</strong></div>
      <div class="react-rounds" data-react-rounds></div>
      <div class="color-banner react-banner" data-react-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    this.buildTown(scene);
    this.buildSign(scene);
    this.buildTeases(scene);
    // Das Dosenregal: ein hoher Bretterzaun mit Ablage. So hoch, dass die
    // Dosen und ihre Täfelchen über den Namensschildern der Figuren stehen.
    zaun(scene, [-2.6, FENCE_Z], [2.6, FENCE_Z], { hoehe: SHELF_Y - 0.04, abstand: 0.65, color: "#9b6a3f", pfostenColor: "#6e4526" });
    kiste(scene, 5.4, 0.08, 0.36, "#a8743f", [0, SHELF_Y, FENCE_Z]);

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addLane(player, index, players.length));
  }

  // Die Hauptstrasse: Sand, Fahrspuren, Häuser mit falschen Fassaden links und
  // rechts, ein Saloon, ein Wasserturm, Kakteen, am Ende tiefstehend die Sonne
  // zwischen Tafelbergen.
  buildTown(scene) {
    himmel(scene, { oben: "#4b3b8f", unten: "#ffb36b" });
    kiste(scene, 80, 0.5, 80, "#d7a978", [0, -0.25, -12], { schatten: false });
    kiste(scene, 5.8, 0.02, 34, "#bf8a5c", [0, 0.01, -10], { schatten: false });
    viele(scene, new THREE.BoxGeometry(0.22, 0.02, 34), lambert("#b97f4b"), [[-1.1, 0.025, -10], [1.1, 0.025, -10]].map((p) => ({ p })));

    // Sonne und Tafelberge in der Ferne: der Nebel färbt sie orange ein.
    // Die Sonne steht genau hinter dem Schild (in Blickrichtung der Kamera).
    const sonne = new THREE.Mesh(new THREE.CircleGeometry(5, 32), new THREE.MeshBasicMaterial({ color: "#ffd47e", fog: false, toneMapped: false }));
    sonne.position.set(-9.5, 7.5, -52);
    scene.add(sonne);
    this.sun = sonne;
    const schein = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: "#ffb35c", transparent: true, opacity: 0.35, fog: false, depthWrite: false }));
    schein.position.set(-9.5, 7.5, -52.2);
    scene.add(schein);
    const zufall = streuer(29);
    const berge = [];
    for (let i = 0; i < 9; i += 1) {
      const x = -30 + i * 7.5 + (zufall() - 0.5) * 3;
      if (Math.abs(x + 9.5) < 5) continue;
      const h = 4 + zufall() * 6;
      berge.push({ p: [x, h / 2, -40 - zufall() * 6], s: [5 + zufall() * 5, h, 4] });
    }
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#9a4f3c"), berge);
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#b8634a"), berge.map((b) => ({ p: [b.p[0], b.s[1] + 0.25, b.p[2]], s: [b.s[0] * 1.15, 0.5, b.s[2] * 1.1] })));

    // Häuser beidseits der Strasse, die Fassaden zur Strasse gedreht.
    const haeuser = [
      { x: -4.3, z: -4.2, w: 2.6, h: 2.4, farbe: "#b5653e", dach: "#7a3f28", schild: "BANK" },
      { x: -4.5, z: -8.0, w: 2.8, h: 2.9, farbe: "#8d6a4a", dach: "#5a4030", schild: "HOTEL" },
      { x: -4.4, z: -11.8, w: 2.4, h: 2.2, farbe: "#a8835a", dach: "#6b5038", schild: null },
      { x: 4.3, z: -4.6, w: 3.0, h: 2.6, farbe: "#c27a45", dach: "#7a4528", schild: "SALOON" },
      { x: 4.5, z: -8.6, w: 2.6, h: 2.3, farbe: "#7f8a6a", dach: "#4f5a40", schild: "LADEN" },
      { x: 4.4, z: -12.2, w: 2.4, h: 2.8, farbe: "#a35f52", dach: "#6a3a32", schild: null }
    ];
    haeuser.forEach((haus) => this.buildHouse(scene, haus));

    // Wasserturm hinten links.
    const turm = new THREE.Group();
    [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(([x, z]) => kiste(turm, 0.14, 3, 0.14, "#6e4526", [x, 1.5, z]));
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.4, 12), lambert("#8a5a33"));
    tank.position.y = 3.6;
    tank.castShadow = true;
    turm.add(tank);
    const kappe = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.6, 12), lambert("#5c3a22"));
    kappe.position.y = 4.6;
    turm.add(kappe);
    turm.position.set(-7.2, 0, -15);
    scene.add(turm);

    // Kakteen, Fässer, Felsen.
    [[-3.0, -2.2, 1], [3.3, -1.9, 0.8], [-6.5, -6.5, 1.2], [6.8, -10, 1.1], [-2.6, 2.6, 0.7], [3.1, 3.0, 0.9]].forEach(([x, z, s]) => {
      kiste(scene, 0.32 * s, 1.5 * s, 0.32 * s, "#4f8f4a", [x, 0.75 * s, z]);
      kiste(scene, 0.22 * s, 0.6 * s, 0.22 * s, "#4f8f4a", [x + 0.32 * s, 0.95 * s, z]);
      kiste(scene, 0.22 * s, 0.22 * s, 0.22 * s, "#4f8f4a", [x + 0.2 * s, 0.68 * s, z]);
      kiste(scene, 0.2 * s, 0.5 * s, 0.2 * s, "#4f8f4a", [x - 0.3 * s, 1.1 * s, z]);
    });
    const fass = new THREE.CylinderGeometry(0.28, 0.28, 0.6, 10);
    viele(scene, fass, lambert("#7a4a2a"), [[2.9, 0.3, -2.6], [3.4, 0.3, -2.9], [-3.3, 0.3, -3.0]].map((p) => ({ p })), { schatten: true });
    viele(scene, new THREE.DodecahedronGeometry(0.4, 0), lambert("#a8724e"), [[-2.4, 0.2, 0.4, 0.8], [2.6, 0.18, 0.9, 0.6], [-5.2, 0.3, -1.6, 1.2], [5.6, 0.25, -2.4, 1]].map(([x, y, z, s]) => ({ p: [x, y, z], s })), { schatten: true });

    // Staubkörnchen in der Abendluft — bei einem Windstoss jagen sie quer.
    const count = Math.round(36 * fxScale());
    this.dust = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: "#fff1d6", transparent: true, opacity: 0.6 }), Math.max(8, count));
    this.dust.frustumCulled = false;
    this.dustSeeds = Array.from({ length: this.dust.count }, (_, i) => ({
      x: (noise(i * 3.1) - 0.5) * 9,
      y: 0.4 + noise(i * 5.7) * 3.4,
      z: -4.5 + noise(i * 7.3) * 6.5,
      speed: 0.2 + noise(i * 1.9) * 0.3
    }));
    scene.add(this.dust);
  }

  buildHouse(scene, { x, z, w, h, farbe, dach, schild }) {
    const g = new THREE.Group();
    const tiefe = 2.4;
    kiste(g, tiefe, h, w, farbe, [0, h / 2, 0]);
    // Falsche Fassade: zur Strasse höher als das Haus, mit Zinne.
    kiste(g, 0.16, h + 0.9, w + 0.2, farbe, [tiefe / 2 + 0.08, (h + 0.9) / 2, 0]);
    kiste(g, 0.22, 0.14, w + 0.34, dach, [tiefe / 2 + 0.1, h + 0.92, 0]);
    // Vordach auf Pfosten, darunter Fenster und Tür.
    kiste(g, 1.0, 0.1, w + 0.1, dach, [tiefe / 2 + 0.6, 1.62, 0]);
    [-w / 2 + 0.1, w / 2 - 0.1].forEach((pz) => kiste(g, 0.08, 1.6, 0.08, "#6e4526", [tiefe / 2 + 1.05, 0.8, pz]));
    kiste(g, 0.04, 0.9, 0.6, "#3a2418", [tiefe / 2 + 0.17, 0.45, 0], { schatten: false });
    [-w / 4 - 0.1, w / 4 + 0.1].forEach((pz) => kiste(g, 0.04, 0.5, 0.5, "#ffd98a", [tiefe / 2 + 0.17, 1.05, pz], { schatten: false, material: new THREE.MeshBasicMaterial({ color: "#ffcf7a" }) }));
    kiste(g, 1.0, 0.06, w + 0.1, "#9b6a3f", [tiefe / 2 + 0.6, 0.06, 0], { schatten: false });
    if (schild) {
      const tafel = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.42), new THREE.MeshBasicMaterial({ map: holzschild(schild), toneMapped: false }));
      tafel.position.set(tiefe / 2 + 0.17, h + 0.42, 0);
      tafel.rotation.y = Math.PI / 2;
      g.add(tafel);
    }
    g.position.set(x, 0, z);
    // Links stehende Häuser schauen nach rechts (+x), rechte nach links.
    g.rotation.y = x < 0 ? 0 : Math.PI;
    scene.add(g);
  }

  // Das Schild über der Strasse — DIE Ansage. Ein Holzrahmen an zwei Pfosten,
  // darin eine Tafel an Ketten, die beim Windstoss schaukeln kann.
  buildSign(scene) {
    [-1.45, 1.45].forEach((x) => kiste(scene, 0.2, PIVOT_Y + 0.25, 0.2, "#5c3a22", [x, (PIVOT_Y + 0.25) / 2, SIGN_Z]));
    kiste(scene, 3.2, 0.22, 0.26, "#6e4526", [0, PIVOT_Y + 0.12, SIGN_Z]);
    this.signPivot = new THREE.Group();
    this.signPivot.position.set(0, PIVOT_Y, SIGN_Z);
    scene.add(this.signPivot);
    [-0.75, 0.75].forEach((x) => kiste(this.signPivot, 0.04, 0.5, 0.04, "#3a2a1e", [x, -0.25, 0], { schatten: false }));
    kiste(this.signPivot, BOARD_W + 0.16, BOARD_H + 0.16, 0.14, "#4a2c18", [0, -0.5 - BOARD_H / 2, -0.02]);
    this.signTextures = {
      wait: signTexture("wait"),
      draw: signTexture("draw"),
      done: signTexture("label", "FERTIG", ""),
      duels: [1, 2, 3].map((n) => signTexture("label", `DUELL ${n}`, "von 3"))
    };
    this.signFace = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W, BOARD_H),
      new THREE.MeshBasicMaterial({ map: this.signTextures.duels[0], toneMapped: false })
    );
    this.signFace.position.set(0, -0.5 - BOARD_H / 2, 0.06);
    this.signPivot.add(this.signFace);
    // Ecken für die Kamera: das Schild bleibt immer ganz im Bild.
    this.signCorners = [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => {
      const corner = new THREE.Object3D();
      corner.position.set(sx * (BOARD_W / 2 + 0.1), -0.5 - BOARD_H / 2 + sy * (BOARD_H / 2 + 0.12), 0);
      this.signPivot.add(corner);
      return corner;
    });
    this.signLight = new THREE.PointLight("#ffd25a", 0, 12);
    this.signLight.position.set(0, PIVOT_Y - 1.1, SIGN_Z + 1.4);
    scene.add(this.signLight);
  }

  // Die Ablenkungen: Steppenläufer, Krähe, Windstoss.
  buildTeases(scene) {
    const weed = new THREE.Group();
    const ast = lambert("#a8834f");
    for (let i = 0; i < 9; i += 1) {
      const stick = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.05, 0.05), ast);
      stick.rotation.set(noise(i * 2.3) * Math.PI, noise(i * 4.1) * Math.PI, noise(i * 6.7) * Math.PI);
      weed.add(stick);
    }
    weed.visible = false;
    scene.add(weed);
    this.weed = weed;

    const crow = new THREE.Group();
    const schwarz = lambert("#1d1b22");
    kiste(crow, 0.32, 0.17, 0.15, null, [0, 0, 0], { material: schwarz });
    kiste(crow, 0.14, 0.14, 0.13, null, [0.2, 0.08, 0], { material: schwarz });
    kiste(crow, 0.1, 0.04, 0.05, "#e8b23a", [0.31, 0.07, 0]);
    kiste(crow, 0.16, 0.05, 0.12, null, [-0.22, 0.02, 0], { material: schwarz });
    crow.userData.wings = [-1, 1].map((side) => {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.06, side * 0.07);
      kiste(pivot, 0.22, 0.03, 0.3, null, [0, 0, side * 0.15], { material: schwarz });
      crow.add(pivot);
      return { pivot, side };
    });
    crow.visible = false;
    scene.add(crow);
    this.crow = crow;
  }

  addLane(player, index, count) {
    const x = (index - (count - 1) / 2) * LANE_GAP;
    const kin = this.addKin(player, index, { x, ground: 0, z: KIN_Z, facing: Math.PI });
    // Korkenpistole in der rechten Hand: der Lauf zeigt am hängenden Arm nach
    // unten, beim Ziehen nach vorn auf die Dose.
    const pistol = new THREE.Group();
    kiste(pistol, 0.07, 0.11, 0.07, player.color, [0, 0, 0], { schatten: false });
    kiste(pistol, 0.055, 0.2, 0.055, "#3b3f4a", [0, -0.12, 0.03], { schatten: false });
    const tip = kiste(pistol, 0.06, 0.05, 0.06, "#d9a066", [0, -0.24, 0.03], { schatten: false });
    pistol.position.set(0, -0.2, 0.05);
    kin.userData.arms?.[1]?.add(pistol);

    const can = new THREE.Group();
    const blech = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, CAN_H, 12), lambert(player.color));
    blech.castShadow = true;
    can.add(blech);
    [-1, 1].forEach((s) => {
      const rand = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.04, 12), lambert("#d6dbe3"));
      rand.position.y = s * (CAN_H / 2 - 0.02);
      can.add(rand);
    });
    const home = new THREE.Vector3(x, SHELF_Y + 0.04 + CAN_H / 2, FENCE_Z);
    can.position.copy(home);
    this.scene.add(can);

    const tagCanvas = document.createElement("canvas");
    tagCanvas.width = 256;
    tagCanvas.height = 96;
    const tagTexture = new THREE.CanvasTexture(tagCanvas);
    tagTexture.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.27), new THREE.MeshBasicMaterial({ map: tagTexture, toneMapped: false }));
    tag.position.set(x, SHELF_Y - 0.22, FENCE_Z + 0.2);
    this.scene.add(tag);

    const lane = { x, color: player.color, kin, pistol, tip, can, home, canFlight: null, tag, tagCanvas, tagTexture, tagKey: "", drawAt: -1e9 };
    this.lanes.set(player.id, lane);
    this.paintTag(lane, { text: "–", tone: "plain" });
  }

  keepInView() {
    return [...this.kins.values(), ...(this.signCorners || [])];
  }

  shot() {
    return {
      look: [0, 1.85, -0.9],
      frame: { w: 4.5, h: 4.6 },
      yaw: 0.2,
      pitch: 0.12,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.18, zoom: 1.4 },
      finale: { pull: 0.7, zoom: 0.7, lift: 0.5, orbit: 0.12 }
    };
  }

  // Die Kamera rückt heran, solange ein Duell scharf ist — und springt beim
  // „!" zurück. Das baut die Spannung, ohne dass sich etwas verschiebt, auf
  // das man schauen muss: das Schild bleibt in der Mitte.
  rigOptions(f) {
    const tension = this.tension || 0;
    if (f.finale || tension <= 0) return null;
    const base = this.rig.base.frame;
    return { frame: { w: base.w * (1 - 0.07 * tension), h: base.h * (1 - 0.07 * tension) } };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Tippe irgendwo, sobald das „!“ erscheint</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      const minigame = this.update || this.minigame;
      if (!minigame || minigame.finaleAt) return;
      this.feedback?.sound("tap");
      const sentAt = performance.now();
      this.sendInput({ action: "tap" }).then(() => this.noteRoundTrip(performance.now() - sentAt)).catch(() => {});
      // Gleich zeigen, was der Server werten wird: nach dem „!" zieht die
      // Figur sofort, davor zuckt sie zusammen. Die Zeit kommt vom Server.
      const id = this.getControlledPlayerId();
      const own = minigame.arcade?.players?.[id];
      const elapsed = this.now() + this.roundTrip - minigame.startedAt;
      const round = roundAt(minigame.arcade, elapsed);
      if (!own || !round || (own.times || []).length !== round.index || this.ownPredicted.has(round.index)) return;
      if (elapsed >= round.greenAt) {
        this.ownPredicted.set(round.index, "draw");
        this.drawPistol(id, true);
      } else {
        this.ownPredicted.set(round.index, "foul");
        this.flinch(id, true);
      }
    });
  }

  // Wie lange eine Eingabe zum Server und zurück braucht, geglättet.
  //
  // Hier IST die Zeit die Wertung: der Server misst vom „!" bis zur Ankunft
  // des Tipps. Das Bild auf dem Gerät ist um die einfache Laufzeit alt, der
  // Tipp braucht noch einmal so lange — ohne Ausgleich steckte die ganze
  // Rundreise in der Reaktionszeit, gegen Bots, die gar keine haben. Darum
  // springt das Schild auf dem Gerät genau um diese Rundreise früher.
  // Gemessen wird schon vor dem ersten Duell (ping), denn der erste Tipp ist
  // bereits gewertet.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.measured ? this.roundTrip * 0.7 + clamped * 0.3 : clamped;
    this.measured = true;
  }

  // Zwischen den Duellen (nicht während eines scharf ist) ein ping pro
  // Sekunde: er ändert auf dem Server nichts und hält die Messung frisch.
  pingIfIdle(minigame, arcade, elapsed) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.lastPingAt < 1000) return;
    const round = roundAt(arcade, elapsed);
    const live = round && elapsed < round.greenAt + 1200;
    if (live) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    if (this.webglCanvas) this.webglCanvas.style.filter = "";
  }

  // --- Ziehen, Zucken, Dose --------------------------------------------------

  drawPistol(playerId, own) {
    const lane = this.lanes.get(playerId);
    if (!lane) return;
    const now = this.now();
    lane.drawAt = now;
    this.animators.get(playerId)?.set("aim");
    // Der Korken fliegt erst los, wenn der Arm oben ist.
    this.flying.push({ playerId, start: now + 90, from: null });
    if (own) {
      this.feedback?.sound("cork");
      this.feedback?.vibrate([8, 10, 14]);
    }
  }

  flinch(playerId, own) {
    const lane = this.lanes.get(playerId);
    const animator = this.animators.get(playerId);
    animator?.trigger("flinch");
    animator?.expression("angry", 1200);
    if (lane) {
      const at = lane.kin.position.clone().add(new THREE.Vector3(0, 1.15, 0));
      this.burst(at, ["#ff6b7f", "#ffffff"], { count: 8 * fxScale(), speed: 1.4, up: 1.0, size: 0.06, life: 0.5, drag: 2.2 });
      // Der Korken plumpst kraftlos aus dem Lauf.
      const tip = lane.tip.getWorldPosition(new THREE.Vector3());
      this.burst(tip, ["#d9a066"], { count: 2, speed: 0.4, up: 0.2, gravity: 6, size: 0.06, life: 0.6 });
    }
    if (own) {
      this.pop(this.kinPosition(playerId, 1.15), "ZU FRÜH!", { color: "#ff9aa8", size: 0.38, life: 0.9 });
      this.feedback?.sound("error");
      this.feedback?.vibrate(26);
      this.rig.shake(0.4);
    }
  }

  knockCan(lane, own) {
    if (lane.canFlight) return;
    const side = (noise(lane.x * 9.1 + this.now() * 0.001) - 0.5) * 1.4;
    lane.canFlight = { vel: new THREE.Vector3(side, 3.0, -1.6), spin: new THREE.Vector3(6 + side * 4, 2, 9 * Math.sign(side || 1)), start: this.now() };
    this.burst(lane.can.position.clone(), [lane.color, "#ffffff", "#ffe36b"], { count: 10 * fxScale(), speed: 2.2, up: 1.4, size: 0.06, life: 0.5, drag: 2 });
    this.feedback?.sound("clack", { strength: own ? 1 : 0.5 });
  }

  resetCans() {
    this.lanes.forEach((lane) => {
      if (!lane.canFlight && lane.can.position.distanceTo(lane.home) < 0.01) return;
      lane.canFlight = null;
      lane.can.position.copy(lane.home);
      lane.can.rotation.set(0, 0, 0);
      lane.can.visible = true;
      lane.can.scale.setScalar(0.2);
      lane.canPopAt = this.now();
    });
  }

  // --- Bild für Bild ---------------------------------------------------------

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    // Die Zeitleiste des Schilds läuft um die Rundreise voraus (noteRoundTrip).
    const elapsed = Math.max(0, now + this.roundTrip - minigame.startedAt);
    const own = arcade.players[controlledId];
    this.pingIfIdle(minigame, arcade, elapsed);
    const live = roundAt(arcade, elapsed);
    const ownTimes = own?.times || [];
    const armed = Boolean(live) && ownTimes.length === live.index && elapsed >= live.armFrom && elapsed < live.greenAt;
    const green = Boolean(live) && elapsed >= live.greenAt && elapsed < live.greenAt + WINDOW_MS;

    // Neues Duell: Dosen wieder aufstellen.
    if (live && live.index !== this.armSeen) {
      this.armSeen = live.index;
      if (live.index > 0) {
        this.resetCans();
        this.lanes.forEach((lane) => this.paintTag(lane, { text: "–", tone: "plain" }));
        this.feedback?.sound("pop", { strength: 0.5 });
      }
    }

    this.paintSign(arcade, live, elapsed, green, dt);
    this.runTeases(live, elapsed, dt, now);
    this.tension += ((armed ? Math.min(1, (elapsed - live.armFrom) / 2400) : 0) - (this.tension || 0)) * frameLerp(armed ? 0.06 : 0.3, dt);

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const lane = this.lanes.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !lane || !kin || !animator) return;
      const times = entry.times || [];
      const isOwn = player.id === controlledId;

      if (times.length > (this.lastCount.get(player.id) || 0)) {
        this.lastCount.set(player.id, times.length);
        this.onResult(player, entry, times.length - 1, isOwn);
      }

      kin.position.x = lane.x;
      kin.position.z = KIN_Z;
      if (finale) {
        kin.rotation.y += Math.atan2(Math.sin(0.2 - kin.rotation.y), Math.cos(0.2 - kin.rotation.y)) * frameLerp(0.08, dt);
        return;
      }
      kin.rotation.y = Math.PI;
      const done = times.length >= arcade.rounds.length;
      const round = live && times.length === live.index ? live : null;
      const playerArmed = round && elapsed >= round.armFrom;
      if (now - lane.drawAt < DRAW_MS) animator.set("aim");
      else if (done) animator.set(bestOf(entry) !== null ? "happy" : "idle");
      else if (playerArmed) {
        animator.set("focus");
        animator.expression("focus", 200);
      } else animator.set("idle");
    });

    this.moveCorks(now);
    this.moveCans(dt, now);
    this.crownFastest(arcade, players, controlledId);
    this.moveDust(dt, now);
  }

  onResult(player, entry, index, isOwn) {
    const times = entry.times;
    const value = times[index];
    const foul = isFoul(entry, index);
    const lane = this.lanes.get(player.id);
    const animator = this.animators.get(player.id);
    const predicted = isOwn ? this.ownPredicted.get(index) : null;
    if (foul) {
      if (predicted !== "foul") this.flinch(player.id, isOwn);
      if (lane) this.paintTag(lane, { text: "ZU FRÜH", tone: "bad" });
      return;
    }
    if (value >= WINDOW_MS) {
      animator?.expression("sad", 1200);
      if (lane) this.paintTag(lane, { text: "ZU SPÄT", tone: "bad" });
      if (isOwn) this.pop(this.kinPosition(player.id, 1.15), "ZU SPÄT", { color: "#ff9aa8", size: 0.34, life: 0.9 });
      return;
    }
    // Gezogen: wer schon beim Tipp gezogen hat, zieht nicht noch einmal.
    if (predicted !== "draw") this.drawPistol(player.id, false);
    animator?.expression(value < 260 ? "joy" : "happy", 900);
    if (lane) this.paintTag(lane, { text: `${value} ms`, tone: "good" });
    if (isOwn) {
      const at = this.kinPosition(player.id, 1.2);
      const earlier = bestOf(entry, index);
      const record = earlier === null || value < earlier;
      this.pop(at, `${value} ms`, { color: value < 260 ? "#ffe36b" : "#c6ffb0", size: value < 260 ? 0.42 : 0.34, life: 0.8 });
      if (record && index > 0) this.pop(at.clone().add(new THREE.Vector3(0, 0.45, 0)), "NEUE BESTZEIT!", { color: "#ffe36b", size: 0.3, life: 1, rise: 0.6 });
      if (record) this.feedback?.sound("perfect");
    }
  }

  // Die schnellste Hand eines Duells bekommt Gold — sobald alle durch sind.
  crownFastest(arcade, players, controlledId) {
    (arcade.rounds || []).forEach((round) => {
      const key = round.index;
      if (this.crowned.has(key)) return;
      const entries = players.map((player) => ({ player, entry: arcade.players[player.id] })).filter(({ entry }) => entry);
      if (!entries.length || entries.some(({ entry }) => (entry.times || []).length <= key)) return;
      this.crowned.add(key);
      // Kam die Wertung erst, als schon das nächste Duell lief, bleibt es
      // still: dessen Täfelchen gehören schon dem neuen Duell.
      if (this.armSeen !== key) return;
      const valid = entries.filter(({ entry }) => !isFoul(entry, key) && entry.times[key] < WINDOW_MS);
      if (!valid.length) return;
      const fastest = Math.min(...valid.map(({ entry }) => entry.times[key]));
      valid.filter(({ entry }) => entry.times[key] === fastest).forEach(({ player }) => {
        const lane = this.lanes.get(player.id);
        if (lane) this.paintTag(lane, { text: `${fastest} ms`, tone: "best" });
        const at = this.kinPosition(player.id, 1.55);
        if (!at) return;
        this.burst(at, ["#ffd15c", "#ffffff", player.color], { count: 14 * fxScale(), speed: 1.8, up: 1.8, size: 0.07, life: 0.8, drag: 1.6 });
        this.pop(at, "SCHNELLSTE HAND", { color: "#ffe36b", size: 0.3, life: 1.2, rise: 0.5 });
        this.animators.get(player.id)?.trigger("fistpump");
        if (player.id === controlledId) this.feedback?.sound("success");
      });
    });
  }

  moveCorks(now) {
    this.flying = this.flying.filter((cork) => {
      const lane = this.lanes.get(cork.playerId);
      if (!lane) return false;
      if (now < cork.start) return true;
      if (!cork.mesh) {
        cork.from = lane.tip.getWorldPosition(new THREE.Vector3());
        cork.mesh = kiste(this.scene, 0.07, 0.07, 0.1, "#d9a066", [cork.from.x, cork.from.y, cork.from.z], { schatten: false });
        this.burst(cork.from.clone(), ["#ffffff", "#ffe8a8"], { count: 5, speed: 1.2, up: 0.4, size: 0.05, life: 0.3, drag: 3 });
      }
      const t = Math.min(1, (now - cork.start) / CORK_MS);
      const to = lane.can.position;
      cork.mesh.position.lerpVectors(cork.from, to, t);
      cork.mesh.position.y += Math.sin(t * Math.PI) * 0.12;
      if (t < 1) return true;
      this.removeObject(cork.mesh);
      this.knockCan(lane, cork.playerId === this.getControlledPlayerId());
      return false;
    });
  }

  moveCans(dt, now) {
    this.lanes.forEach((lane) => {
      const can = lane.can;
      if (lane.canPopAt) {
        const u = Math.min(1, (now - lane.canPopAt) / 260);
        can.scale.setScalar(0.2 + 0.8 * (1 - Math.pow(1 - u, 3)) + Math.sin(u * Math.PI) * 0.15);
        if (u >= 1) lane.canPopAt = 0;
      }
      const flight = lane.canFlight;
      if (!flight) return;
      flight.vel.y -= 9 * dt;
      can.position.addScaledVector(flight.vel, dt);
      can.rotation.x += flight.spin.x * dt;
      can.rotation.z += flight.spin.z * dt;
      if (can.position.y < 0.15) {
        can.position.y = 0.15;
        flight.vel.y = Math.abs(flight.vel.y) * 0.35;
        flight.vel.x *= 0.6;
        flight.vel.z *= 0.6;
        flight.spin.multiplyScalar(0.5);
      }
    });
  }

  moveDust(dt, now) {
    if (!this.dust) return;
    const gust = this.gust || 0;
    const m = new THREE.Matrix4();
    this.dustSeeds.forEach((seed, i) => {
      seed.x += (seed.speed + gust * 7) * dt;
      if (seed.x > 4.6) seed.x -= 9.2;
      const y = seed.y + Math.sin(now / 900 + i) * 0.08;
      m.makeTranslation(seed.x, y, seed.z);
      this.dust.setMatrixAt(i, m);
    });
    this.dust.instanceMatrix.needsUpdate = true;
    this.dust.material.opacity = 0.45 + gust * 0.4;
  }

  // Das Schild: DUELL n → • • • (scharf) → ! → DUELL n+1 … → FERTIG.
  paintSign(arcade, round, elapsed, green, dt) {
    if (!this.signFace) return;
    const rounds = arcade.rounds || [];
    const last = rounds[rounds.length - 1];
    let state;
    if (!round) state = "duel0";
    else if (elapsed >= round.greenAt && elapsed < round.greenAt + 1400) state = "draw";
    else if (elapsed >= round.armFrom && elapsed < round.greenAt) state = "wait";
    else if (last && round.index === last.index && elapsed >= round.greenAt + 1400) state = "done";
    else state = `duel${Math.min(rounds.length - 1, round.index + (elapsed >= round.greenAt ? 1 : 0))}`;
    if (state !== this.signState) {
      this.signState = state;
      const textures = this.signTextures;
      this.signFace.material.map = state === "draw" ? textures.draw
        : state === "wait" ? textures.wait
          : state === "done" ? textures.done
            : textures.duels[Number(state.slice(4)) || 0] || textures.duels[0];
      this.signFace.material.needsUpdate = true;
    }
    if (green && round.index !== this.greenSeen && elapsed < round.greenAt + 400) {
      this.greenSeen = round.index;
      this.flash = 1;
      this.signPunch = 1;
      this.feedback?.sound("showdown");
      this.rig.shake(0.18);
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.signPunch = Math.max(0, (this.signPunch || 0) - dt * 4);
    this.signFace.scale.setScalar(1 + this.signPunch * 0.18);
    this.signLight.intensity += ((state === "draw" ? 10 : 0) + this.flash * 18 - this.signLight.intensity) * 0.4;
    if (this.sun) this.sun.scale.setScalar(1 + this.flash * 0.12);
  }

  // Die Ablenkungen eines Duells: Zeitpunkt und Art hängen am Zeitplan des
  // Duells (greenAt) — für alle gleich, und nie in der letzten Dreiviertel-
  // sekunde vor dem „!".
  runTeases(round, elapsed, dt, now) {
    let sway = 0;
    this.gust = Math.max(0, (this.gust || 0) - dt * 1.5);
    this.weed.visible = false;
    this.crow.visible = false;
    if (round) {
      const kind = TEASES[(Math.floor(noise(round.greenAt * 0.013) * TEASES.length) + round.index) % TEASES.length];
      const room = Math.max(0, round.greenAt - round.armFrom - 1250);
      const at = round.armFrom + 450 + noise(round.greenAt * 0.071) * room;
      const since = elapsed - at;
      if (since >= 0 && since < 2400) {
        if (this.teaseSeen !== round.index) {
          this.teaseSeen = round.index;
          if (kind === "tumbleweed") this.feedback?.sound("swish", { strength: 0.5 });
          if (kind === "gust") this.feedback?.sound("whoosh", { strength: 0.8 });
        }
        if (kind === "tumbleweed") this.rollWeed(since);
        if (kind === "crow") this.flyCrow(since);
        if (kind === "gust") {
          this.gust = Math.max(this.gust, Math.max(0, 1 - since / 1600));
          sway = Math.sin(since / 170) * 0.2 * Math.max(0, 1 - since / 2000);
        }
        if (kind === "crow" && since > 700 && since < 1500) sway = Math.sin(since / 90) * 0.04;
      }
    }
    if (this.signPivot) this.signPivot.rotation.z = sway;
  }

  rollWeed(since) {
    const u = since / 2200;
    if (u > 1) return;
    const weed = this.weed;
    weed.visible = true;
    weed.position.set(-4.8 + u * 9.6, 0.34 + Math.abs(Math.sin(u * Math.PI * 4)) * 0.4, -1.9);
    weed.rotation.z = -u * 18;
    weed.rotation.x = u * 4;
  }

  flyCrow(since) {
    const crow = this.crow;
    const seat = new THREE.Vector3(0.55, PIVOT_Y + 0.33, SIGN_Z);
    const from = new THREE.Vector3(-5, 5.6, -3.5);
    const to = new THREE.Vector3(5.5, 6.2, -4.5);
    let flap = 0;
    if (since < 650) {
      const u = since / 650;
      crow.position.lerpVectors(from, seat, 1 - Math.pow(1 - u, 2));
      flap = 1;
    } else if (since < 1700) {
      crow.position.copy(seat);
      if (since > 900 && !this.cawed) {
        this.cawed = true;
        this.feedback?.sound("crow");
      }
      crow.rotation.z = since > 900 && since < 1300 ? Math.sin(since / 40) * 0.12 : 0;
    } else if (since < 2400) {
      const u = (since - 1700) / 700;
      crow.position.lerpVectors(seat, to, u * u);
      flap = 1;
      this.cawed = false;
    } else {
      return;
    }
    crow.visible = true;
    crow.userData.wings.forEach(({ pivot, side }) => {
      pivot.rotation.x = side * (flap ? Math.sin(since / 45) * 0.9 : -0.1);
    });
  }

  paintTag(lane, { text, tone }) {
    const key = `${text}|${tone}`;
    if (lane.tagKey === key) return;
    lane.tagKey = key;
    const ctx = lane.tagCanvas.getContext("2d");
    const { width: w, height: h } = lane.tagCanvas;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = tone === "best" ? "#ffd23f" : tone === "bad" ? "#7a2b2b" : "#5a3a22";
    roundRect(ctx, 4, 4, w - 8, h - 8, 16);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = tone === "best" ? "#fff3b0" : lane.color;
    ctx.stroke();
    ctx.font = "900 46px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = tone === "best" ? "#4a3000" : tone === "bad" ? "#ffd0d6" : "#fff4e0";
    ctx.fillText(text, w / 2, h / 2 + 3);
    lane.tagTexture.needsUpdate = true;
  }

  drawHud(f) {
    const { arcade, minigame, now, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const elapsed = Math.max(0, now + this.roundTrip - minigame.startedAt);
    const times = own?.times || [];
    const live = roundAt(arcade, elapsed);
    const round = live && times.length === live.index ? live : null;
    const best = own ? bestOf(own) : null;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = best === null ? "—" : `${best} ms`;
    const rounds = this.hud.querySelector("[data-react-rounds]");
    if (rounds) {
      // Duell 1, 2, 3 — das beste leuchtet gold. Nur neu schreiben, wenn sich
      // etwas geändert hat, sonst flackert die Leiste.
      const key = `${times.join(",")}|${(own?.fouls || []).join(",")}|${times.length}`;
      if (rounds.dataset.key !== key) {
        rounds.dataset.key = key;
        const bestIndex = best === null ? -1 : times.findIndex((value, i) => value === best && !isFoul(own, i));
        rounds.innerHTML = arcade.rounds.map((_r, i) => {
          const value = times[i];
          const foul = value !== undefined && isFoul(own, i);
          const missed = value !== undefined && !foul && value >= WINDOW_MS;
          const state2 = value === undefined ? (i === times.length ? "now" : "open")
            : foul || missed ? "bad" : i === bestIndex ? "best" : "good";
          const text = value === undefined ? "–" : foul ? "Fehlstart" : missed ? "zu spät" : `${value} ms`;
          return `<span class="react-slot is-${state2}"><small>Duell ${i + 1}</small>${text}</span>`;
        }).join("");
      }
    }

    // Das „!" blitzt einmal übers ganze Bild: die Spielfläche hellt kurz auf.
    const glare = this.flash > 0.02 ? `brightness(${(1 + this.flash * 0.55).toFixed(2)})` : "";
    if (this.webglCanvas && this.webglCanvas.style.filter !== glare) this.webglCanvas.style.filter = glare;

    const banner = this.hud.querySelector("[data-react-banner]");
    if (!banner) return;
    const done = times.length >= arcade.rounds.length;
    this.hintNode ||= this.controls.querySelector(".trace-hint");
    if (this.hintNode) this.hintNode.hidden = Boolean(f.finale) || done;
    if (done) {
      banner.hidden = false;
      banner.textContent = best === null ? "Kein gültiges Duell" : `BEST: ${best} ms`;
      banner.style.background = best === null ? "#ff6b7f" : "#ffd15c";
      banner.style.color = best === null ? "#42101a" : "#4a3400";
    } else if (round && elapsed >= round.greenAt && elapsed < round.greenAt + WINDOW_MS) {
      banner.hidden = false;
      banner.textContent = "ZIEH!";
      banner.style.background = "#ffd23f";
      banner.style.color = "#5a1010";
    } else if (round && elapsed >= round.armFrom) {
      banner.hidden = false;
      banner.textContent = "Ruhig … noch nicht ziehen";
      banner.style.background = "#3a2418";
      banner.style.color = "#ffe3c4";
    } else {
      banner.hidden = true;
    }
  }
}

// Wie auf dem Server: ein Versuch ist ungültig, wenn er ein Fehlstart war
// (ältere Stände ohne `fouls`: die feste Strafzeit) oder ausserhalb des
// Fensters lag.
function isFoul(entry, index) {
  const fouls = entry?.fouls;
  if (Array.isArray(fouls) && fouls[index] !== undefined) return Boolean(fouls[index]);
  return (entry?.times?.[index] ?? 0) === PENALTY_MS;
}

// Das Duell, das nach der Uhr gerade läuft: das letzte, das schon scharf ist
// (wie reactRoundAt auf dem Server).
function roundAt(arcade, elapsed) {
  let found = null;
  for (const round of arcade?.rounds || []) {
    if (elapsed >= round.armFrom) found = round;
  }
  return found;
}

function bestOf(entry, upTo = Infinity) {
  let best = null;
  (entry?.times || []).forEach((value, index) => {
    if (index >= upTo || isFoul(entry, index) || value >= WINDOW_MS) return;
    if (best === null || value < best) best = value;
  });
  return best;
}

// Die Tafel des Schilds als Textur: Holz mit Schrift, drei Punkte (scharf)
// oder das gelbe „!" mit Strahlen.
function signTexture(kind, title = "", sub = "") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 292;
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  if (kind === "draw") {
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#ff9a2e";
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * w, h / 2 + Math.sin(a) * w);
      ctx.lineTo(w / 2 + Math.cos(a + 0.18) * w, h / 2 + Math.sin(a + 0.18) * w);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = "900 250px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 18;
    ctx.strokeStyle = "#3a0d0d";
    ctx.strokeText("!", w / 2, h / 2 + 10);
    ctx.fillStyle = "#e8243a";
    ctx.fillText("!", w / 2, h / 2 + 10);
  } else {
    ctx.fillStyle = "#7a4a28";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#6a3f22";
    for (let y = 0; y < h; y += 58) ctx.fillRect(0, y, w, 6);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffe8c4";
    if (kind === "wait") {
      [-1, 0, 1].forEach((i) => {
        ctx.beginPath();
        ctx.arc(w / 2 + i * 92, h / 2 - 14, 26, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.font = "800 40px system-ui, sans-serif";
      ctx.fillStyle = "#e8c49a";
      ctx.fillText("RUHIG BLEIBEN", w / 2, h - 52);
    } else {
      ctx.font = "900 96px system-ui, sans-serif";
      ctx.fillText(title, w / 2, sub ? h / 2 - 20 : h / 2);
      if (sub) {
        ctx.font = "800 42px system-ui, sans-serif";
        ctx.fillStyle = "#e8c49a";
        ctx.fillText(sub, w / 2, h / 2 + 62);
      }
    }
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#3a2418";
    ctx.strokeRect(6, 6, w - 12, h - 12);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function holzschild(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f2dfb8";
  ctx.fillRect(0, 0, 384, 96);
  ctx.strokeStyle = "#5a3a22";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 376, 88);
  ctx.font = "900 58px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#6a2a1a";
  ctx.fillText(text, 192, 52);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
