import * as THREE from "/vendor/three/three.module.js";
import { flashKin, createShadowBlob, noise } from "./VoxelKit.js?v=tumblekin215";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin215";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin215";
import { createKin, KinAnimator, standOn } from "./Kin.js?v=tumblekin215";
import { kiste, lambert, viele, streuer, himmel, laternen } from "./Kulisse.js?v=tumblekin215";
import { fillBlockText } from "./BlockFont.js?v=tumblekin215";

// Falschsignal — Hau den Lukas auf dem nächtlichen Jahrmarkt.
//
// Der Lukas-Turm steht in der Mitte, daneben der Kraftprotz mit dem Hammer.
// Jeder Schlag schickt einen Puck die Schiene hinauf, und die Lampen am Turm
// leuchten mit. Nur ein echter Schlag bringt den Puck bis zur Glocke — die
// anderen werden langsamer, bleiben stehen und rutschen zurück. Wer tippt,
// setzt darauf, dass DIESER Puck läutet: je tiefer der Puck beim Tippen, desto
// mehr Punkte (links am Turm steht, was ein Tipp auf dieser Höhe bringt).
// Früh tippen ist geraten, spät tippen sicher und billig. Ein Tipp auf einen
// falschen Puck kostet Punkte und sperrt kurz.
//
// Rechts am Turm steckt jeder sein Fähnchen auf die Höhe, auf der er getippt
// hat — so sieht man, wer sich was getraut hat.
//
// Die Regeln sind dieselben wie vorher mit dem wachsenden Ring: die Höhe des
// Pucks IST der Radius des Rings, nach derselben Formel wie auf dem Server.
// Vorher war es ein Ring auf einer Signaltafel an einem Raketenstartplatz —
// klar, aber ohne Witz und ohne Grund, warum der Ring wächst.
const TOWER_Z = -1.9;
const RAIL_BOTTOM = 0.85;
const RAIL_TOP = 4.3;
const RAIL_H = RAIL_TOP - RAIL_BOTTOM;
const BELL_Y = RAIL_TOP + 0.45;
const LAMPS = 14;
const LANE_GAP = 1.05;
const PLATE = [-1.25, TOWER_Z + 1.05];   // Schlagplatte (x, z) vor dem Kraftprotz
const KIN_Z = 2.1;
const FALL_G = 14;
const PAYOUTS = [500, 400, 300, 200, 100, 80];
// Wie auf dem Server (FEINT_MIN_POINTS / FEINT_MAX_POINTS, feintPoints).
const MIN_POINTS = 80;
const MAX_POINTS = 500;

const REACT_LABELS = {
  fake: "FALSCHER PUCK!",
  early: "ZU FRÜH!"
};

export class FalseSignal extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lanes = new Map();
    this.lastReactAt = new Map();
    this.lastSignalIndex = -1;
    this.labelY = 0.74;
    this.puck = { y: 0, vy: 0, mode: "rest", ringAt: -1e9 };
    this.markers = [];
    this.slamAt = -1e9;
  }

  stage() {
    return {
      label: "3D Falschsignal",
      background: "#1b1440",
      fog: ["#2a1d4a", 18, 52],
      lights: {
        sunPosition: [-4, 9, 7],
        sunColor: 0xc8ceff,
        sunIntensity: 2.4,
        skyColor: 0xb4a8ff,
        groundColor: 0x5a4060,
        hemiIntensity: 2.3,
        fillColor: 0xffb070,
        fillIntensity: 1.1,
        shadow: { left: -6, right: 6, top: 7, bottom: -4 }
      }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="signal-legend" data-signal-legend>
        <span class="signal-chip signal-chip-real"></span>
        <span>Tippe, wenn der Puck die Glocke <strong>schafft</strong></span>
      </div>
      <div class="color-banner" data-signal-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    this.buildFair(scene);
    this.buildTower(scene);
    this.buildStrongman(scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addLane(player, index, players.length));
  }

  // Der Jahrmarkt bei Nacht: Sterne, Mond, ein Riesenrad mit Lichtern,
  // gestreifte Zelte, Lichterketten, ein Popcornwagen.
  buildFair(scene) {
    himmel(scene, { oben: "#120e36", unten: "#4d2a6e" });
    kiste(scene, 80, 0.5, 80, "#3a3352", [0, -0.25, -10], { schatten: false });
    kiste(scene, 6.4, 0.02, 30, "#4d4466", [0, 0.01, -6], { schatten: false });
    const zufall = streuer(41);
    const sterne = [];
    for (let i = 0; i < 70; i += 1) {
      const a = zufall() * Math.PI - Math.PI;
      const h = 0.25 + zufall() * 0.6;
      sterne.push({ p: [Math.cos(a) * 55, 10 + h * 30, Math.sin(a) * 55 - 5], s: 0.6 + zufall() * 0.9 });
    }
    viele(scene, new THREE.BoxGeometry(0.18, 0.18, 0.18), new THREE.MeshBasicMaterial({ color: "#fff6d8", fog: false }), sterne);
    const mond = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), new THREE.MeshBasicMaterial({ color: "#f4f1ff", fog: false, toneMapped: false }));
    mond.position.set(13, 17, -50);
    scene.add(mond);

    this.buildWheel(scene);
    [[6.2, -6.8, ["#ff4d6d", "#fff3e0"], 1], [3.6, -12.5, ["#2fb7ff", "#fff3e0"], 0.8], [-4.6, -4.8, ["#ffb300", "#7a2bd6"], 0.7]].forEach(([x, z, farben, s]) => this.buildTent(scene, x, z, farben, s));

    // Lichterketten an Masten links und rechts und quer im Hintergrund.
    this.bulbs = [];
    [[[-3.6, 3.2, 2.4], [-3.6, 3.2, -8.5]], [[3.6, 3.2, 2.4], [3.6, 3.2, -8.5]], [[-5.5, 3.6, -9], [5.5, 3.6, -9]]].forEach(([a, b], k) => {
      viele(scene, new THREE.BoxGeometry(0.12, 1, 0.12), lambert("#2a2438"), [a, b].map(([x, y, z]) => ({ p: [x, y / 2, z], s: [1, y, 1] })));
      this.lightString(scene, a, b, k);
    });
    laternen(scene, [[-2.4, 3.2], [2.4, 3.2], [-4.2, -1.5], [4.4, -2.0]], { licht: "#ffe2a0" });

    // Popcornwagen.
    const wagen = new THREE.Group();
    kiste(wagen, 1.2, 0.8, 0.8, "#e83a4a", [0, 0.6, 0]);
    kiste(wagen, 1.25, 0.12, 0.85, "#ffffff", [0, 1.05, 0]);
    kiste(wagen, 1.0, 0.6, 0.6, "#ffe9a8", [0, 1.4, 0], { material: new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, opacity: 0.85 }) });
    kiste(wagen, 1.3, 0.14, 0.9, "#e83a4a", [0, 1.78, 0]);
    viele(wagen, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10), lambert("#2a2438"), [[-0.45, 0.2, 0.42], [0.45, 0.2, 0.42], [-0.45, 0.2, -0.42], [0.45, 0.2, -0.42]].map((p) => ({ p, r: [Math.PI / 2, 0, 0] })));
    wagen.position.set(3.4, 0, -2.4);
    wagen.rotation.y = -0.5;
    scene.add(wagen);

    // Warmes Licht vom Turm auf den Platz.
    const warm = new THREE.PointLight("#ffb060", 5, 11);
    warm.position.set(0, 3.2, -0.2);
    scene.add(warm);
  }

  buildWheel(scene) {
    const R = 3.6;
    const g = new THREE.Group();
    g.position.set(-8.5, 4.6, -19);
    scene.add(g);
    const stahl = lambert("#cfd3e6");
    // A-Gestell.
    [-1, 1].forEach((side) => {
      [-0.9, 0.9].forEach((dz) => {
        const bein = kiste(scene, 0.16, 5.2, 0.16, null, [-8.5 + side * 1.45, 2.3, -19 + dz], { material: stahl });
        bein.rotation.z = side * 0.28;
      });
    });
    const rad = new THREE.Group();
    g.add(rad);
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const speiche = kiste(rad, 0.08, R, 0.08, null, [Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0], { material: stahl, schatten: false });
      speiche.rotation.z = a - Math.PI / 2;
    }
    const farben = ["#ff4d6d", "#ffd23f", "#2fb7ff", "#7cff6b", "#c77dff"];
    this.wheelLights = [];
    for (let i = 0; i < 30; i += 1) {
      const a = (i / 30) * Math.PI * 2;
      const lampe = kiste(rad, 0.22, 0.22, 0.12, null, [Math.cos(a) * R, Math.sin(a) * R, 0], { schatten: false, material: new THREE.MeshBasicMaterial({ color: farben[i % farben.length] }) });
      lampe.userData.base = new THREE.Color(farben[i % farben.length]);
      this.wheelLights.push(lampe);
    }
    this.gondolas = [];
    for (let i = 0; i < 10; i += 1) {
      const gondel = new THREE.Group();
      kiste(gondel, 0.7, 0.5, 0.5, farben[i % farben.length], [0, -0.4, 0], { schatten: false });
      kiste(gondel, 0.06, 0.3, 0.06, "#cfd3e6", [0, -0.05, 0], { schatten: false });
      g.add(gondel);
      this.gondolas.push({ gondel, a: (i / 10) * Math.PI * 2 });
    }
    kiste(g, 0.5, 0.5, 0.5, "#ffd23f", [0, 0, 0], { schatten: false });
    this.wheel = { rad, R };
  }

  buildTent(scene, x, z, [a, b], s) {
    const zelt = new THREE.Group();
    const streifen = 10;
    for (let i = 0; i < streifen; i += 1) {
      const w = (2.6 / streifen);
      kiste(zelt, w, 1.6, 0.06, i % 2 ? b : a, [-1.3 + w * (i + 0.5), 0.8, 1.3], { schatten: false });
      kiste(zelt, 0.06, 1.6, w, i % 2 ? b : a, [1.3, 0.8, -1.3 + w * (i + 0.5)], { schatten: false });
      kiste(zelt, 0.06, 1.6, w, i % 2 ? b : a, [-1.3, 0.8, -1.3 + w * (i + 0.5)], { schatten: false });
    }
    kiste(zelt, 2.5, 1.55, 2.5, b, [0, 0.78, 0]);
    const dach = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.5, 8), lambert(a));
    dach.position.y = 2.35;
    dach.rotation.y = Math.PI / 8;
    zelt.add(dach);
    kiste(zelt, 0.05, 0.6, 0.05, "#ffffff", [0, 3.35, 0], { schatten: false });
    kiste(zelt, 0.35, 0.22, 0.03, b, [0.18, 3.55, 0], { schatten: false });
    kiste(zelt, 0.7, 1.0, 0.04, "#2a1d3a", [0, 0.5, 1.34], { schatten: false });
    zelt.position.set(x, 0, z);
    zelt.scale.setScalar(s);
    zelt.rotation.y = Math.atan2(-x, 4 - z) * 0.6;
    scene.add(zelt);
  }

  lightString(scene, a, b, seed) {
    const farben = ["#ff6b8b", "#ffd23f", "#6be3ff", "#9dff6b", "#ffffff"];
    const teile = farben.map(() => []);
    const n = 14;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.5, a[2] + (b[2] - a[2]) * t];
      teile[(i + seed) % farben.length].push({ p });
    }
    farben.forEach((farbe, i) => {
      const mesh = viele(scene, new THREE.BoxGeometry(0.12, 0.14, 0.12), new THREE.MeshBasicMaterial({ color: farbe }), teile[i]);
      if (mesh) this.bulbs.push({ mesh, phase: i + seed * 2, base: new THREE.Color(farbe) });
    });
  }

  // Der Lukas: Sockel mit Schlagplatte, die Säule mit Lampen und Schiene, der
  // Puck, oben die Glocke. Links die Auszahlung je Höhe, rechts die Fähnchen.
  buildTower(scene) {
    kiste(scene, 2.0, 0.36, 1.4, "#7a2b2b", [0, 0.18, TOWER_Z]);
    kiste(scene, 2.06, 0.08, 1.46, "#ffd23f", [0, 0.4, TOWER_Z], { schatten: false });
    // Die Schlagplatte liegt vor dem Sockel; ein Hebel führt in den Turm.
    this.plate = new THREE.Group();
    kiste(this.plate, 0.56, 0.12, 0.56, "#c8ccd8", [0, 0, 0]);
    kiste(this.plate, 0.32, 0.04, 0.32, "#e8243a", [0, 0.08, 0], { schatten: false });
    this.plate.position.set(PLATE[0], 0.14, PLATE[1]);
    scene.add(this.plate);
    const hebel = kiste(scene, 0.9, 0.08, 0.1, "#8a8fa0", [(PLATE[0] - 0.55) / 2 - 0.1, 0.2, (PLATE[1] + TOWER_Z + 0.4) / 2]);
    hebel.rotation.y = Math.atan2(PLATE[1] - TOWER_Z - 0.4, -(PLATE[0] + 0.45));
    const lukas = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.3), new THREE.MeshBasicMaterial({ map: textTexture("HAU DEN LUKAS", { w: 512, h: 112, bg: "#7a2b2b", fg: "#ffe9a8", size: 52 }), toneMapped: false }));
    lukas.position.set(0, 0.2, TOWER_Z + 0.71);
    scene.add(lukas);

    const top = RAIL_TOP + 0.3;
    kiste(scene, 0.62, top - 0.4, 0.34, "#262a63", [0, 0.4 + (top - 0.4) / 2, TOWER_Z]);
    [-1, 1].forEach((side) => kiste(scene, 0.06, top - 0.4, 0.38, "#ffd23f", [side * 0.33, 0.4 + (top - 0.4) / 2, TOWER_Z], { schatten: false }));

    // Die Lampen: unten grün, oben rot — wie bei jedem Lukas.
    this.lamps = [];
    const hoehe = RAIL_H / LAMPS;
    for (let i = 0; i < LAMPS; i += 1) {
      const t = i / (LAMPS - 1);
      const farbe = new THREE.Color().setHSL(0.36 - t * 0.36, 1, 0.55);
      const lampe = new THREE.Mesh(new THREE.BoxGeometry(0.44, hoehe - 0.05, 0.04), new THREE.MeshBasicMaterial({ color: farbe.clone().multiplyScalar(0.16), toneMapped: false }));
      lampe.position.set(0, RAIL_BOTTOM + hoehe * (i + 0.5), TOWER_Z + 0.18);
      scene.add(lampe);
      this.lamps.push({ lampe, farbe, from: i / LAMPS });
    }
    kiste(scene, 0.07, RAIL_H + 0.2, 0.06, "#d6dbe3", [0, RAIL_BOTTOM + RAIL_H / 2, TOWER_Z + 0.24], { schatten: false });

    this.puckMesh = kiste(scene, 0.34, 0.16, 0.16, "#f4f6fb", [0, RAIL_BOTTOM, TOWER_Z + 0.31]);
    this.puckGlow = new THREE.PointLight("#9dffb0", 0, 3.5);
    this.puckGlow.position.set(0, RAIL_BOTTOM, TOWER_Z + 0.6);
    scene.add(this.puckGlow);
    this.trail = [0, 1, 2].map((i) => {
      const geist = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }));
      geist.position.set(0, RAIL_BOTTOM, TOWER_Z + 0.3);
      scene.add(geist);
      return { geist, lag: (i + 1) * 0.05 };
    });

    // Glocke mit Halter.
    this.bell = new THREE.Group();
    const glocke = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.42, 0.5, 10), lambert("#ffcc33", { emissive: "#ffb300", emissiveIntensity: 0.25 }));
    this.bell.add(glocke);
    kiste(this.bell, 0.16, 0.12, 0.16, "#ffcc33", [0, 0.31, 0], { schatten: false });
    this.bell.position.set(0, BELL_Y, TOWER_Z + 0.06);
    scene.add(this.bell);
    this.bellMaterial = glocke.material;
    kiste(scene, 0.9, 0.12, 0.2, "#262a63", [0, RAIL_TOP + 0.34, TOWER_Z], { schatten: false });
    this.bellLight = new THREE.PointLight("#ffd96b", 0, 8);
    this.bellLight.position.set(0, BELL_Y, TOWER_Z + 0.9);
    scene.add(this.bellLight);
    this.bellCorners = [[-0.9, BELL_Y + 0.5], [0.9, BELL_Y + 0.5]].map(([x, y]) => {
      const corner = new THREE.Object3D();
      corner.position.set(x, y, TOWER_Z);
      scene.add(corner);
      return corner;
    });

    // Auszahlung je Höhe: genau das, was ein Tipp bei dieser Puckhöhe bringt.
    PAYOUTS.forEach((points) => {
      const r = radiusFor(points);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.22), new THREE.MeshBasicMaterial({ map: textTexture(String(points), { w: 128, h: 64, bg: points === MIN_POINTS ? "#5a4a1a" : "#2a1d3a", fg: "#ffd23f", size: 44 }), toneMapped: false }));
      plate.position.set(-0.6, RAIL_BOTTOM + r * RAIL_H, TOWER_Z + 0.18);
      scene.add(plate);
      kiste(scene, 0.12, 0.025, 0.02, "#ffd23f", [-0.33, RAIL_BOTTOM + r * RAIL_H, TOWER_Z + 0.19], { schatten: false });
    });
  }

  // Der Kraftprotz: eine grosse Figur mit Vorschlaghammer links vom Turm.
  buildStrongman(scene) {
    const man = createKin("#efe6d2", 3);
    man.scale.setScalar(1.4);
    // Halb zur Kamera gedreht: so sieht man den Hammer in seiner rechten Hand
    // und den Schlag auf die Platte vor ihm.
    man.position.set(-1.55, standOn(0), TOWER_Z + 0.1);
    man.rotation.y = 0.5;
    scene.add(man);
    // Der Stiel zeigt am hängenden Arm nach vorn (wie der Holzhammer bei der
    // Blob-Klopfe); nach unten hinge der Kopf im Boden.
    const hammer = new THREE.Group();
    kiste(hammer, 0.06, 0.06, 0.62, "#8a5a33", [0, 0, 0.28], { schatten: false });
    kiste(hammer, 0.3, 0.2, 0.22, "#4a4f5c", [0, 0, 0.62]);
    hammer.position.set(0, -0.18, 0.02);
    man.userData.arms?.[1]?.add(hammer);
    const shadow = createShadowBlob(0.8);
    shadow.position.set(man.position.x, 0.012, man.position.z);
    scene.add(shadow);
    this.strongman = new KinAnimator(man);
    this.strongman.groundY = standOn(0);
    this.animators.set("__lukas", this.strongman);
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  // Figur hinter ihrem Pult; der Buzzer liegt zwischen ihr und dem Turm.
  addLane(player, index, count) {
    const x = this.laneX(index, count);
    const facing = Math.PI + Math.atan2(x, KIN_Z - TOWER_Z) * 0.6;
    this.addKin(player, index, { x, ground: 0, z: KIN_Z, facing });
    const podium = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.38), lambert("#3a2a5a"));
    body.position.y = 0.26;
    body.castShadow = true;
    podium.add(body);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.4), lambert(player.color));
    front.position.y = 0.48;
    podium.add(front);
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.1, 14), new THREE.MeshLambertMaterial({ color: "#ff3b4f", emissive: "#ff3b4f", emissiveIntensity: 0.2 }));
    dome.position.y = 0.59;
    podium.add(dome);
    podium.position.set(x + Math.sin(facing) * 0.44, 0, KIN_Z + Math.cos(facing) * 0.44);
    podium.rotation.y = facing;
    this.scene.add(podium);
    this.lanes.set(player.id, { x, index, color: player.color, facing, dome, pressedAt: -1e9, glow: null });
  }

  keepInView() {
    return [...this.kins.values(), ...(this.bellCorners || [])];
  }

  shot() {
    return {
      look: [0, 2.3, -0.4],
      frame: { w: 4.1, h: 4.8 },
      yaw: 0.18,
      pitch: 0.27,
      fov: 36,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-signal-react data-tap-button>
        <span class="nerve-button-face">JETZT!</span>
      </button>`;
    this.button = this.controls.querySelector("[data-signal-react]");
    const tap = (event) => {
      event.preventDefault();
      this.pressReact();
    };
    this.on(this.button, "pointerdown", tap);
    this.on(this.webglCanvas, "pointerdown", tap);
  }

  pressReact() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    this.feedback?.sound("tap");
    // Sofort zuschlagen, nicht erst auf die Antwort warten.
    const id = this.getControlledPlayerId();
    this.animators.get(id)?.trigger("punch");
    const lane = this.lanes.get(id);
    if (lane) lane.pressedAt = this.now();
    const sentAt = performance.now();
    this.sendInput({ action: "react" }).then(() => this.noteRoundTrip(performance.now() - sentAt)).catch(() => {});
  }

  // Wie lange ein Tipp zum Server und zurück braucht, geglättet.
  //
  // Der Puck stieg auf der Uhr des Geräts, die einen Hinweg hinter der des
  // Servers hängt, und gewertet wird bei Ankunft, noch einen Hinweg später.
  // Bis dahin war er um eine Rundreise weiter — jeder Treffer brachte
  // dadurch weniger, als die Höhe beim Tippen versprach, und die Bots (ohne
  // Netz) hatten diesen Abzug nie. Der Puck zeigt darum, wo er bei Ankunft
  // ist. Der Server glaubt dem Gerät dabei nichts.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = (this.roundTrip ?? 0) * 0.7 + clamped * 0.3;
  }

  activeSignal(arcade, elapsed) {
    const signals = arcade.signals || [];
    for (const signal of signals) {
      if (elapsed >= signal.at && elapsed <= signal.at + signal.windowMs) return signal;
      if (signal.at > elapsed) break;
    }
    return null;
  }

  nextSignal(arcade, elapsed) {
    return (arcade.signals || []).find((signal) => signal.at > elapsed) || null;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    this.animateFair(now, dt);
    if (!arcade) return;
    const elapsed = Math.max(0, now + (this.roundTrip || 0) - minigame.startedAt);
    const signal = this.activeSignal(arcade, elapsed);
    this.swingHammer(arcade, elapsed, signal);
    this.movePuck(signal, elapsed, dt, now, arcade);
    const height = this.puck.y;

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const lane = this.lanes.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !lane || !kin || !animator) return;

      const react = entry.lastReact;
      if (react && react.at !== this.lastReactAt.get(player.id)) {
        this.lastReactAt.set(player.id, react.at);
        if (player.id !== controlledId) {
          animator.trigger("punch");
          lane.pressedAt = now;
        }
        this.showReaction(player, lane, react, controlledId);
      }

      // Buzzer: gedrückt, leuchtend nach einem Treffer oder rot nach einem Fehler.
      const press = Math.max(0, 1 - (now - lane.pressedAt) / 220);
      lane.dome.position.y = 0.59 - press * 0.05;
      const glowLeft = lane.glow ? Math.max(0, 1 - (now - lane.glow.at) / 900) : 0;
      lane.dome.material.emissive.set(lane.glow?.good ? "#4dff7a" : "#ff3b4f");
      lane.dome.material.color.set(lane.glow?.good && glowLeft > 0 ? "#4dff7a" : "#ff3b4f");
      lane.dome.material.emissiveIntensity = 0.2 + glowLeft * 1.2;

      const locked = (entry.lockUntil || 0) > now;
      flashKin(kin, "#ff6b7f", locked ? 0.25 : 0);
      if (finale) {
        kin.rotation.y += Math.atan2(Math.sin(0.3 - kin.rotation.y), Math.cos(0.3 - kin.rotation.y)) * frameLerp(0.08, dt);
        return;
      }
      kin.rotation.y = lane.facing;
      animator.lookAt(new THREE.Vector3(0, RAIL_BOTTOM + height * RAIL_H, TOWER_Z));
      if (locked) {
        animator.set("sad");
      } else if (signal && this.puck.mode === "rise" && height > 0.45) {
        animator.set("ready");
        animator.expression("focus", 150);
      } else {
        animator.set("focus");
      }
    });

    this.moveMarkers(dt, now);
  }

  // Der Kraftprotz holt aus, bevor ein Puck startet, und schlägt genau zum
  // Start auf die Platte. Echte und falsche Schläge sehen gleich aus.
  swingHammer(arcade, elapsed, signal) {
    const next = this.nextSignal(arcade, elapsed);
    const windup = next ? next.at - elapsed : Infinity;
    if (next && windup < 520 && this.windingFor !== next.index) {
      this.windingFor = next.index;
      this.strongman.set("charge", { params: { power: 1 } });
    }
    if (next && this.windingFor === next.index && windup < 170 && this.swungFor !== next.index) {
      this.swungFor = next.index;
      this.strongman.trigger("throw");
    }
    if (signal && signal.index !== this.lastSignalIndex) {
      this.lastSignalIndex = signal.index;
      this.slamAt = this.now();
      this.strongman.set("idle");
      // Der Schlag klingt für echt und falsch gleich. Alles andere wäre ein
      // Verrat, und dann gäbe es nichts mehr zu entscheiden.
      this.feedback?.sound("hammer");
      this.rig.shake(0.12);
      this.burst(new THREE.Vector3(PLATE[0], 0.3, PLATE[1]), ["#ffe9a8", "#ffffff"], { count: 6 * fxScale(), speed: 1.6, up: 1.2, size: 0.05, life: 0.35, drag: 2.5 });
      this.clearMarkers();
    }
    const slam = Math.max(0, 1 - (this.now() - this.slamAt) / 160);
    if (this.plate) this.plate.position.y = 0.14 - slam * 0.06;
  }

  // Die Höhe des Pucks (0 = unten, 1 = Glocke) ist der Radius des Rings auf
  // dem Server. Bleibt ein falscher stehen, rutscht er danach zurück; ein
  // echter läutet und sinkt nach seinem Fenster langsam wieder.
  movePuck(signal, elapsed, dt, now, arcade) {
    const puck = this.puck;
    const growMs = arcade.growMs || 950;
    if (signal) {
      const since = elapsed - signal.at;
      const r = puckHeight(signal, since, growMs);
      const stalled = !signal.real && since > growMs * signal.limit * 1.2;
      if (signal.index !== puck.signalIndex) {
        puck.signalIndex = signal.index;
        puck.mode = "rise";
        puck.vy = 0;
        puck.rang = false;
        puck.stallSeen = false;
      }
      if (puck.mode === "rise") {
        puck.y = r;
        if (signal.real && r >= 1 && !puck.rang) {
          puck.rang = true;
          puck.mode = "ring";
          puck.ringAt = now;
          this.ringBell();
        }
        if (stalled && !puck.stallSeen) {
          puck.stallSeen = true;
          puck.mode = "fall";
          puck.vy = 0;
          this.feedback?.sound("womp", { strength: 0.8 });
        }
      }
    } else if (puck.mode === "rise" || puck.mode === "ring") {
      puck.mode = "fall";
      puck.vy = 0;
    }
    if (puck.mode === "fall") {
      puck.vy -= FALL_G * dt;
      puck.y = Math.max(0, puck.y + (puck.vy * dt) / RAIL_H);
      if (puck.y <= 0) {
        puck.mode = "rest";
        puck.vy = 0;
        this.feedback?.sound("clack", { strength: 0.4 });
      }
    }

    const y = RAIL_BOTTOM + puck.y * RAIL_H;
    this.puckMesh.position.y = y;
    const live = puck.mode === "rise" || puck.mode === "ring";
    this.puckGlow.position.y = y;
    this.puckGlow.intensity += ((live ? 3 : 0) - this.puckGlow.intensity) * 0.3;
    this.trail.forEach(({ geist, lag }) => {
      geist.position.y += (y - geist.position.y) * Math.min(1, dt / lag);
      geist.material.opacity = live && puck.mode === "rise" ? 0.25 * (1 - lag * 4) : Math.max(0, geist.material.opacity - dt * 2);
    });

    // Die Lampen leuchten bis zur Höhe des Pucks. Nach dem Läuten läuft eine
    // Lichterkette rauf und runter.
    const ringing = Math.max(0, 1 - (now - puck.ringAt) / 1100);
    this.lamps.forEach(({ lampe, farbe, from }, i) => {
      const on = puck.y > from + 0.001;
      const chase = ringing > 0 && Math.floor(now / 60 + i) % 3 === 0;
      lampe.material.color.copy(farbe).multiplyScalar(chase ? 1.3 : on ? 1 : 0.16);
    });
    this.bell.rotation.z = Math.sin(now / 35) * 0.25 * ringing;
    this.bellMaterial.emissiveIntensity = 0.25 + ringing * 1.4;
    this.bellLight.intensity = ringing * 14;
  }

  ringBell() {
    this.feedback?.sound("bell");
    this.rig.shake(0.22);
    const at = new THREE.Vector3(0, BELL_Y + 0.1, TOWER_Z + 0.2);
    this.burst(at, ["#ffd23f", "#ffffff", "#ff6b8b", "#6be3ff"], { count: 22 * fxScale(), speed: 2.6, up: 1.8, gravity: 4, size: 0.07, life: 0.9, drag: 1.2 });
  }

  clearMarkers() {
    this.markers.forEach((marker) => this.removeObject(marker.group));
    this.markers = [];
  }

  // Ein Fähnchen rechts am Turm, auf der Höhe, auf der jemand getippt hat.
  plantMarker(lane, react) {
    const radius = Math.max(0, Math.min(1, react.radius ?? 0));
    const group = new THREE.Group();
    kiste(group, 0.02, 0.3, 0.02, "#e8e8f0", [0, 0, 0], { schatten: false });
    const fahne = kiste(group, 0.2, 0.13, 0.03, lane.color, [0.11, 0.08, 0], { schatten: false });
    group.position.set(0.42 + lane.index * 0.24, RAIL_BOTTOM + radius * RAIL_H, TOWER_Z + 0.2);
    this.scene.add(group);
    this.markers.push({ group, fahne, good: react.kind === "go", born: this.now(), vy: 0 });
  }

  moveMarkers(dt, now) {
    this.markers.forEach((marker) => {
      const age = now - marker.born;
      marker.group.scale.setScalar(Math.min(1, age / 140));
      if (!marker.good && age > 500 && marker.group.position.y > 0.5) {
        marker.vy -= 9 * dt;
        marker.group.position.y = Math.max(0.5, marker.group.position.y + marker.vy * dt);
        marker.group.rotation.z = Math.min(1.2, marker.group.rotation.z + dt * 3);
      }
    });
  }

  animateFair(now, dt) {
    const t = now / 1000;
    if (this.wheel) {
      const turn = t * 0.12;
      this.wheel.rad.rotation.z = turn;
      this.gondolas.forEach(({ gondel, a }) => {
        gondel.position.set(Math.cos(a + turn) * this.wheel.R, Math.sin(a + turn) * this.wheel.R, 0.3);
      });
      this.wheelLights.forEach((lampe, i) => {
        const on = Math.floor(t * 4 + i * 0.5) % 4 !== 0;
        lampe.material.color.copy(lampe.userData.base).multiplyScalar(on ? 1 : 0.3);
      });
    }
    this.bulbs?.forEach(({ mesh, phase, base }) => {
      mesh.material.color.copy(base).multiplyScalar(0.7 + 0.3 * Math.sin(t * 2.2 + phase));
    });
  }

  showReaction(player, lane, react, controlledId) {
    const own = player.id === controlledId;
    const at = new THREE.Vector3(lane.x, 1.1, KIN_Z);
    const animator = this.animators.get(player.id);
    const now = this.now();
    this.plantMarker(lane, react);
    if (react.kind === "go") {
      lane.glow = { at: now, good: true };
      animator?.trigger("hop", { height: 0.22 });
      animator?.trigger("fistpump");
      animator?.expression("joy", 700);
      this.burst(at, [lane.color, "#4dff7a", "#ffffff"], { count: 14, speed: 2.0, up: 2.2, size: 0.07, life: 0.6, drag: 1.8 });
      const bold = (react.radius ?? 1) < 0.45;
      this.pop(at, bold ? `MUTIG! +${react.points}` : `+${react.points}`, { color: "#4dff7a", size: bold ? 0.4 : 0.34, life: 0.8 });
      if (own) {
        this.feedback?.sound(bold ? "perfect" : "pop");
        this.feedback?.vibrate([8, 10, 14]);
      }
      return;
    }
    lane.glow = { at: now, good: false };
    animator?.trigger("stumble");
    animator?.trigger("facepalm");
    animator?.expression("angry", 900);
    this.burst(at, ["#ff6b7f", "#ffffff"], { count: 10, speed: 1.5, up: 1.1, size: 0.06, life: 0.5, drag: 2.2 });
    this.pop(at, REACT_LABELS[react.kind] || "FEHLGRIFF", { color: "#ff9aa8", size: 0.34, life: 0.9 });
    if (own) {
      this.feedback?.sound("error");
      this.feedback?.vibrate(24);
      this.rig.shake(0.35);
    }
  }

  drawHud(f) {
    const { arcade, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, own?.score || 0));
    const banner = this.hud.querySelector("[data-signal-banner]");
    if (!banner) return;
    const locked = (own?.lockUntil || 0) > now;
    this.button.disabled = locked || f.finale;
    this.button.querySelector(".nerve-button-face").textContent = locked ? "ERHOLEN" : "JETZT!";
    // Bewusst KEIN "JETZT!"-Banner beim echten Puck: der Turm ist die Ansage,
    // der Banner nur Beiwerk — er läge sonst auf dem Turm.
    if (locked) {
      banner.hidden = false;
      banner.textContent = `Fehlgriff — gesperrt (${Math.ceil((own.lockUntil - now) / 100) / 10}s)`;
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if ((own?.hits || 0) >= 3 && (own?.falseStarts || 0) === 0
      && own.lastReact?.kind === "go" && now - own.lastReact.at < 1800) {
      // Nur kurz nach einem sauberen Treffer. Der Mut ist die eigentliche
      // Leistung — die tiefste Höhe, bei der ein Treffer sass.
      banner.hidden = false;
      const bold = Math.round((own.boldest ?? 1) * 100);
      banner.textContent = `${own.hits}× sauber · mutigster Tipp bei ${bold} % Höhe`;
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3400";
    } else {
      banner.hidden = true;
    }
  }
}

// Wie feintRadius auf dem Server: echt gleichmässig bis 1, falsch langsamer
// werdend bis zu seiner Grenze.
function puckHeight(signal, since, growMs) {
  const t = Math.max(0, since);
  if (signal.real) return Math.min(1, t / growMs);
  return signal.limit * Math.tanh(t / (growMs * signal.limit));
}

// Die Höhe, auf der ein Tipp genau `points` bringt (Umkehrung von
// feintPoints auf dem Server).
function radiusFor(points) {
  const share = Math.max(0, Math.min(1, (points - MIN_POINTS) / (MAX_POINTS - MIN_POINTS)));
  return 1 - Math.pow(share, 1 / 1.25);
}

function textTexture(text, { w, h, bg, fg, size }) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(4, h * 0.07);
  ctx.strokeRect(3, 3, w - 6, h - 6);
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = fg;
  fillBlockText(ctx, text, w / 2, h / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
