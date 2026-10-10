import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin214";
import { frameLerp } from "./Quality.js?v=tumblekin214";
import { kiste, lambert, viele, streuer, himmel, wolken } from "./Kulisse.js?v=tumblekin214";
import "./Bootsphysik.js?v=tumblekin214";

const Boot = globalThis.TumblekinBootsphysik;

// Kippboot — eine Südsee-Lagune. Über einem Ruderboot spannt sich eine
// Kranbrücke; an ihr fährt eine Laufkatze hin und her, und am Haken hängt der
// nächste Passagier: ein Küken, ein Pinguin, ein Schaf oder ein Schwein. Wer
// dran ist, tippt, und der Passagier fällt ins Boot.
//
// Boot und Tiere sind echte Körper (Bootsphysik.js, dieselbe Rechnung wie auf
// dem Server): ein Tier landet auf dem Deck oder auf einem anderen, rutscht,
// kippt um, fällt über Bord, und das Boot neigt sich unter dem Gewicht. Das
// Gerät rechnet vom letzten Serverstand bis zu dem Augenblick voraus, in dem
// ein jetzt geschickter Tipp ankommt — darum fällt der eigene Passagier
// sofort, und was man sieht, ist das, was der Server rechnet. Vorher standen
// die Tiere nur an ausgerechneten Plätzen und steckten ineinander.
//
// Die Figuren stehen auf dem Steg rechts und schauen zu; wer dran ist, steht
// vorn am Hebel. Drumherum Strand mit Palmen, Strandhütten, Sonnenschirm,
// Surfbretter und eine Vulkaninsel am Horizont.
const WATER_Y = 0;
const BOAT_Y = Boot.PIVOT_Y;     // Drehpunkt des Boots
const BEAM_Y = 3.5;
const HOOK_Y = Boot.DROP_Y + 0.75;
const PIER_X = 3.4;
const RAFT_Z = -0.9;             // das Boot liegt auf dieser Linie, die Tiere darin
const BAND_Z = 0.74;             // Sicherheitsleiste an der vorderen Bordwand
const CAPSIZE_ACCEL = 7;         // rad/s²: so schnell rollt ein kenterndes Boot um
// Ein farbiges Halstuch zeigt, wem ein Tier gehört: Lage je Tierart.
const SCARF = {
  kueken: { y: 0.27, z: 0.16, w: 0.22 },
  pinguin: { y: 0.49, z: 0.17, w: 0.3 },
  schaf: { y: 0.33, z: 0.32, w: 0.22 },
  schwein: { y: 0.27, z: 0.45, w: 0.26 }
};

function clampNum(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleDiff(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

export class BalanceBoat extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.seenEvents = 0;
    this.splashSeen = 0;
    this.boatNumber = -1;
    this.shown = new Map();         // Körper-ID → { holder, tier, vy, squash, body }
    this.riders = [];               // beim Kentern oder Ablegen am Boot festgemacht
    this.falling = [];              // Tiere, die gerade ins Wasser fliegen
    this.leaving = null;
    this.labelY = 0.78;
    this.roundTrip = 0;
    this.lastPingAt = 0;
    this.pendingDrop = null;        // { turn, x, at, kind, boatNumber, clock } — eigener Tipp, noch ohne Antwort
    this.roundSeen = -1;
    this.roundBannerUntil = 0;
    this.lagSamples = [];           // { clock, sample }: sentAt − Empfangszeit je Bild
    this.lagOffset = null;
    this.viewAngle = 0;
    this.viewTorque = 0;
  }

  stage() {
    return {
      label: "3D Kippboot",
      background: "#8fdcf5",
      fog: ["#c8f0ff", 24, 60],
      lights: { sunPosition: [-6, 12, 7], sunIntensity: 3.1, hemiIntensity: 2.2, skyColor: 0xe8fbff, groundColor: 0x3aa0b0, shadow: { left: -6, right: 6, top: 5, bottom: -4 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-boat-round>1/4</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips" data-boat-chips></div>
      <div class="boat-level" data-boat-level><i></i></div>
      <div class="color-banner" data-boat-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    himmel(scene, { oben: "#3fa9ec", unten: "#d6f6ff" });
    this.buildLagoon(scene);
    this.buildCrane(scene);
    // Boot und Tiere liegen zusammen in einem Floss: es schaukelt sanft auf
    // den Wellen, und alles darin schaukelt mit.
    this.raft = new THREE.Group();
    this.raft.position.set(0, 0, RAFT_Z);
    scene.add(this.raft);
    this.boat = this.makeBoat();
    this.raft.add(this.boat);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const z = 1.9 - index * 0.95;
      this.addKin(player, index, { x: PIER_X + 0.9, ground: 0.42, z, facing: -Math.PI / 2 + 0.35 });
      this.kins.get(player.id).userData.home = new THREE.Vector3(PIER_X + 0.9, 0, z);
    });
  }

  buildLagoon(scene) {
    // Wasser mit Wellen (flaches Gitter, im Takt bewegt).
    const geo = new THREE.PlaneGeometry(70, 60, 48, 40);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: "#48b2c4", transparent: true, opacity: 0.94 }));
    this.water.position.y = WATER_Y - 0.05;
    this.water.receiveShadow = true;
    scene.add(this.water);
    this.waterBase = geo.attributes.position.array.slice();
    // Sandgrund, der durch das flache Wasser schimmert, und Riff-Flecken.
    kiste(scene, 70, 0.2, 60, "#e9d9a4", [0, -0.9, 0], { schatten: false });
    const zufall = streuer(61);
    const riff = [];
    for (let i = 0; i < 24; i += 1) riff.push({ p: [(zufall() - 0.5) * 30, -0.75, (zufall() - 0.5) * 20 - 2], s: [0.4 + zufall() * 1.1, 0.25, 0.4 + zufall() * 0.9] });
    viele(scene, new THREE.DodecahedronGeometry(0.8, 0), lambert("#ff8f7a"), riff.filter((_, i) => i % 2 === 0));
    viele(scene, new THREE.DodecahedronGeometry(0.8, 0), lambert("#b98cff"), riff.filter((_, i) => i % 2 === 1));
    // Strand hinten.
    kiste(scene, 60, 0.6, 12, "#f4e2ac", [0, -0.15, -16], { schatten: false });
    kiste(scene, 60, 0.6, 14, "#8fd07a", [0, -0.05, -24], { schatten: false });
    // Palmen: geschwungene Stämme und Wedel.
    const palmen = [[-7.5, -10.5, 3.2], [-4.2, -11.5, 3.8], [4.6, -10.8, 3.4], [8.2, -11.2, 4.0], [-11, -12, 3.6], [11.5, -12.5, 3.3]];
    palmen.forEach(([x, z, h], i) => {
      const palme = new THREE.Group();
      for (let k = 0; k < 6; k += 1) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h / 6 + 0.05, 7), lambert(k % 2 ? "#a07a4a" : "#8a6238"));
        seg.position.set(Math.sin(k / 6) * 0.5 * (i % 2 ? 1 : -1), (k + 0.5) * (h / 6), 0);
        palme.add(seg);
      }
      const krone = new THREE.Vector3(Math.sin(1) * 0.5 * (i % 2 ? 1 : -1), h, 0);
      for (let k = 0; k < 7; k += 1) {
        const wedel = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.45), lambert(k % 2 ? "#3f9e4d" : "#5cb85c"));
        wedel.geometry.translate(0.9, 0, 0);
        wedel.position.copy(krone);
        wedel.rotation.set(0, (k / 7) * Math.PI * 2, -0.45);
        palme.add(wedel);
      }
      viele(palme, new THREE.SphereGeometry(0.14, 8, 6), lambert("#6b4a2e"), [[0.15, -0.15, 0.1], [-0.12, -0.18, 0.05], [0, -0.2, -0.14]].map(([dx, dy, dz]) => ({ p: [krone.x + dx, krone.y + dy, krone.z + dz] })));
      palme.position.set(x, 0.1, z);
      scene.add(palme);
    });
    // Strandhütten mit Strohdach.
    [[-2.2, -12.5], [1.6, -12.8]].forEach(([x, z]) => {
      const huette = new THREE.Group();
      kiste(huette, 1.8, 1.3, 1.5, "#d9b27a", [0, 0.65, 0]);
      const dach = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.1, 4), lambert("#c9a14a"));
      dach.rotation.y = Math.PI / 4;
      dach.position.y = 1.85;
      huette.add(dach);
      kiste(huette, 0.5, 0.8, 0.05, "#6b4a2e", [0, 0.4, 0.77]);
      huette.position.set(x, 0.1, z);
      scene.add(huette);
    });
    // Sonnenschirm, Surfbretter.
    kiste(scene, 0.06, 1.8, 0.06, "#ffffff", [-5.4, 1, -9.3], { schatten: false });
    const schirm = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.5, 8), lambert("#ff5d73"));
    schirm.position.set(-5.4, 1.95, -9.3);
    scene.add(schirm);
    [["#ffd15c", -3.2], ["#28c7d9", -2.8], ["#ff8fb1", -2.4]].forEach(([farbe, x]) => {
      const brett = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.6, 4, 8), lambert(farbe));
      brett.scale.z = 0.25;
      brett.position.set(x, 1.1, -10.2);
      brett.rotation.z = (x + 2.8) * 0.3;
      scene.add(brett);
    });
    // Vulkaninsel am Horizont mit Rauch.
    const vulkan = new THREE.Mesh(new THREE.ConeGeometry(7, 7, 9), lambert("#6f8a5a"));
    vulkan.position.set(-16, 2.8, -34);
    scene.add(vulkan);
    const krater = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 1.2, 9), lambert("#8a6a5a"));
    krater.position.set(-16, 6.3, -34);
    scene.add(krater);
    this.smoke = [];
    for (let i = 0; i < 5; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: "#eef0f2", transparent: true, opacity: 0.6 }));
      puff.userData.phase = i / 5;
      scene.add(puff);
      this.smoke.push(puff);
    }
    wolken(scene, [[-6, 9, -26, 2.2], [9, 10, -30, 2.8], [20, 8.5, -24, 1.8]]);
    // Vorn im Wasser: ein aufblasbarer Flamingo, ein Wasserball und Fische
    // unter der Oberfläche — auf dem hochkanten Handy liegt hier viel Wasser
    // im Bild.
    this.bobbing = [];
    const flamingo = new THREE.Group();
    const reifen = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.22, 10, 20), lambert("#ff8fb8"));
    reifen.rotation.x = Math.PI / 2;
    flamingo.add(reifen);
    const hals = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.09, 8, 12, Math.PI * 1.2), lambert("#ff8fb8"));
    hals.position.set(0.5, 0.35, 0);
    hals.rotation.z = -0.4;
    flamingo.add(hals);
    kiste(flamingo, 0.22, 0.2, 0.2, "#ff8fb8", [0.2, 0.72, 0]);
    kiste(flamingo, 0.16, 0.08, 0.1, "#2a2230", [0.02, 0.68, 0], { schatten: false });
    flamingo.position.set(-2.3, 0.05, 2.4);
    scene.add(flamingo);
    this.bobbing.push({ obj: flamingo, phase: 0, y: 0.05 });
    const ball = new THREE.Group();
    ["#ff5d73", "#ffffff", "#28c7d9", "#ffffff", "#ffd15c", "#ffffff"].forEach((farbe, i) => {
      const teil = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8, (i / 6) * Math.PI * 2, Math.PI / 3), lambert(farbe));
      ball.add(teil);
    });
    ball.position.set(1.5, 0.12, 3.0);
    scene.add(ball);
    this.bobbing.push({ obj: ball, phase: 1.3, y: 0.12, spin: true });
    this.fish = [];
    for (let i = 0; i < 6; i += 1) {
      const fisch = new THREE.Group();
      kiste(fisch, 0.12, 0.14, 0.3, i % 2 ? "#ff9f43" : "#ffd15c", [0, 0, 0], { schatten: false });
      kiste(fisch, 0.04, 0.14, 0.12, "#ff7a2e", [0, 0, -0.2], { schatten: false });
      fisch.userData = { r: 1.2 + zufall() * 1.8, speed: 0.4 + zufall() * 0.4, phase: zufall() * 6, cx: (zufall() - 0.5) * 4, cz: 1.5 + zufall() * 2 };
      scene.add(fisch);
      this.fish.push(fisch);
    }
    // Steg rechts mit Pfählen.
    kiste(scene, 1.9, 0.12, 5.2, "#b98a55", [PIER_X + 0.9, 0.36, -0.2]);
    const bretter = [];
    for (let z = -2.6; z <= 2.3; z += 0.34) bretter.push({ p: [PIER_X + 0.9, 0.43, z] });
    viele(scene, new THREE.BoxGeometry(1.92, 0.02, 0.3), lambert("#c99b62"), bretter);
    const pfaehle = [];
    [-2.6, -0.9, 0.8, 2.3].forEach((z) => [PIER_X, PIER_X + 1.8].forEach((x) => pfaehle.push({ p: [x, -0.2, z] })));
    viele(scene, new THREE.CylinderGeometry(0.1, 0.1, 1.3, 8), lambert("#6b4a2e"), pfaehle, { schatten: true });
    // Hebel am Stegkopf.
    kiste(scene, 0.3, 0.5, 0.3, "#6b4a2e", [PIER_X + 0.35, 0.67, -2.25]);
    this.lever = kiste(scene, 0.06, 0.6, 0.06, "#c8413b", [PIER_X + 0.35, 1.1, -2.25]);
    this.leverKnob = kiste(scene, 0.16, 0.16, 0.16, "#ffd15c", [PIER_X + 0.35, 1.42, -2.25]);
    // Rettungsring am Steg.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 8, 16), lambert("#ff5d3b"));
    ring.position.set(PIER_X + 1.86, 0.62, 1.2);
    ring.rotation.y = Math.PI / 2;
    scene.add(ring);
  }

  buildCrane(scene) {
    // Zwei Pfosten im Wasser, darüber ein Balken; die Laufkatze fährt darauf.
    [-2.7, 2.7].forEach((x) => {
      kiste(scene, 0.8, 0.3, 0.8, "#8a6238", [x, 0.05, -0.9]);
      kiste(scene, 0.22, BEAM_Y, 0.22, "#c8413b", [x, BEAM_Y / 2, -0.9]);
      const strebe = kiste(scene, 0.1, 1.1, 0.1, "#c8413b", [x - Math.sign(x) * 0.3, BEAM_Y - 0.45, -0.9]);
      strebe.rotation.z = Math.sign(x) * 0.6;
    });
    kiste(scene, 5.8, 0.24, 0.3, "#c8413b", [0, BEAM_Y, -0.9]);
    kiste(scene, 5.8, 0.05, 0.32, "#ffd15c", [0, BEAM_Y - 0.14, -0.9], { schatten: false });
    this.trolley = new THREE.Group();
    kiste(this.trolley, 0.5, 0.3, 0.5, "#3b3f4a", [0, 0, 0]);
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), lambert("#d8b27a"));
    this.trolley.add(this.rope);
    const haken = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12, Math.PI * 1.4), lambert("#9aa6b8"));
    this.hook = haken;
    this.trolley.add(haken);
    this.trolley.position.set(0, BEAM_Y - 0.25, -0.9);
    scene.add(this.trolley);
    // Markierung an der Bootsmitte, damit man die Mitte sieht.
    this.hanging = null;
  }


  makeBoat() {
    const boot = new THREE.Group();
    const rumpf = new THREE.Group();
    const deck = Boot.DECK_TOP;
    // Der Rumpf ist hohl: unten der Körper bis knapp unter das Deck, darauf
    // die Planken, ringsum Bordwände. Vorher waren Rumpf und Reling massive
    // Kisten bis 16 cm über dem Deck — die Tiere standen sichtbar im Boot.
    const unter = deck - 0.03;
    kiste(rumpf, 4.0, unter + 0.2, 1.5, "#c8413b", [0, (unter - 0.2) / 2, 0]);
    [-1, 1].forEach((seite) => {
      const spitze = kiste(rumpf, 1.06, unter + 0.2, 1.06, "#c8413b", [seite * 2.0, (unter - 0.2) / 2, 0]);
      spitze.rotation.y = Math.PI / 4;
    });
    kiste(rumpf, 3.8, 0.06, 1.3, "#c99b62", [0, deck - 0.03, 0]);
    [-1.1, 1.1].forEach((x) => kiste(rumpf, 0.2, 0.012, 1.3, "#8a6238", [x, deck + 0.006, 0], { schatten: false }));
    // Bordwände an den Längsseiten, oben ein weisser Rand.
    const wand = Boot.LIP_TOP - unter;
    [-1, 1].forEach((seite) => {
      kiste(rumpf, 4.1, wand, 0.1, "#c8413b", [0, unter + wand / 2, seite * 0.72]);
      kiste(rumpf, 4.12, 0.05, 0.16, "#ffffff", [0, Boot.LIP_TOP + 0.02, seite * 0.72], { schatten: false });
    });
    // Bug und Heck stehen als niedrige Kante über das Deck (wie in der Physik).
    [-1, 1].forEach((seite) => kiste(rumpf, 0.15, Boot.LIP_TOP - deck, 1.44, "#ffffff", [seite * (Boot.DECK_HALF + 0.075), (Boot.LIP_TOP + deck) / 2, 0]));
    // Mittelmarke.
    kiste(rumpf, 0.08, 0.012, 1.32, "#ffd15c", [0, deck + 0.008, 0], { schatten: false });
    // Ruder an der Seite.
    const ruder = kiste(rumpf, 0.08, 0.08, 2.2, "#b98a55", [-0.5, 0.36, 1.0]);
    ruder.rotation.y = Math.PI / 2 - 0.12;
    boot.add(rumpf);
    // Segel (nur beim Ablegen sichtbar).
    const mast = kiste(boot, 0.08, 1.6, 0.08, "#8a5a3a", [0, deck + 0.85, -0.55]);
    const segel = kiste(boot, 0.04, 1.1, 1.0, "#fffaf0", [0.1, deck + 1.05, -0.55], { schatten: false });
    mast.visible = false;
    segel.visible = false;
    // Auf der vorderen Bordwand: wo der Passagier das Boot sicher hält (grün)
    // und wo es kentern würde (rot), dazu ein Stift, wo er jetzt fallen würde.
    // Als dicke Leiste über der Kante — ein flacher Streifen oben auf der
    // Bordwand war von der Kamera aus nur ein Strich.
    const streifen = (farbe) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: farbe }));
      m.position.set(0, 0.4, BAND_Z);
      m.userData.isFx = true;
      boot.add(m);
      return m;
    };
    const band = { safe: streifen("#2fe070"), left: streifen("#ff2244"), right: streifen("#ff2244") };
    const marke = new THREE.Group();
    const stift = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.1), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    stift.position.y = 0.21;
    const kappe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.2), stift.material);
    kappe.position.y = 0.44;
    marke.add(stift, kappe);
    marke.position.set(0, 0.47, BAND_Z);
    marke.userData.isFx = true;
    marke.userData.material = stift.material;
    boot.add(marke);
    Object.values(band).forEach((m) => { m.visible = false; });
    marke.visible = false;
    boot.userData = { mast, segel, band, marke };
    boot.position.set(0, BOAT_Y, 0);
    return boot;
  }

  makeAnimal(kind) {
    const g = new THREE.Group();
    if (kind === "kueken") {
      kiste(g, 0.3, 0.28, 0.3, "#ffe25c", [0, 0.14, 0]);
      kiste(g, 0.2, 0.2, 0.2, "#ffe25c", [0, 0.36, 0.05]);
      kiste(g, 0.08, 0.05, 0.08, "#ff9f2e", [0, 0.34, 0.18], { schatten: false });
      kiste(g, 0.03, 0.04, 0.02, "#1c1c28", [-0.05, 0.4, 0.15], { schatten: false });
      kiste(g, 0.03, 0.04, 0.02, "#1c1c28", [0.05, 0.4, 0.15], { schatten: false });
    } else if (kind === "pinguin") {
      kiste(g, 0.36, 0.5, 0.32, "#1f2230", [0, 0.25, 0]);
      kiste(g, 0.26, 0.38, 0.05, "#ffffff", [0, 0.24, 0.16], { schatten: false });
      kiste(g, 0.3, 0.26, 0.28, "#1f2230", [0, 0.62, 0]);
      kiste(g, 0.1, 0.06, 0.12, "#ff9f2e", [0, 0.58, 0.19], { schatten: false });
      kiste(g, 0.04, 0.05, 0.02, "#ffffff", [-0.07, 0.66, 0.145], { schatten: false });
      kiste(g, 0.04, 0.05, 0.02, "#ffffff", [0.07, 0.66, 0.145], { schatten: false });
      kiste(g, 0.12, 0.04, 0.16, "#ff9f2e", [-0.1, 0.02, 0.06], { schatten: false });
      kiste(g, 0.12, 0.04, 0.16, "#ff9f2e", [0.1, 0.02, 0.06], { schatten: false });
    } else if (kind === "schaf") {
      viele(g, new THREE.SphereGeometry(0.18, 8, 6), lambert("#fbfbf6"), [[-0.12, 0.3, 0], [0.12, 0.3, 0], [0, 0.4, -0.1], [0, 0.3, 0.12], [-0.12, 0.34, -0.12], [0.12, 0.34, -0.12]].map((p) => ({ p })), { schatten: true });
      kiste(g, 0.22, 0.24, 0.22, "#2a2230", [0, 0.44, 0.24]);
      kiste(g, 0.05, 0.05, 0.02, "#ffffff", [-0.05, 0.48, 0.355], { schatten: false });
      kiste(g, 0.05, 0.05, 0.02, "#ffffff", [0.05, 0.48, 0.355], { schatten: false });
      [[-0.12, -0.1], [0.12, -0.1], [-0.12, 0.12], [0.12, 0.12]].forEach(([x, z]) => kiste(g, 0.07, 0.2, 0.07, "#2a2230", [x, 0.1, z]));
    } else {
      kiste(g, 0.6, 0.42, 0.42, "#ff9fb5", [0, 0.28, 0]);
      kiste(g, 0.3, 0.3, 0.3, "#ff9fb5", [0, 0.38, 0.3]);
      kiste(g, 0.16, 0.12, 0.06, "#ff7a9a", [0, 0.34, 0.47], { schatten: false });
      kiste(g, 0.04, 0.05, 0.02, "#1c1c28", [-0.07, 0.46, 0.455], { schatten: false });
      kiste(g, 0.04, 0.05, 0.02, "#1c1c28", [0.07, 0.46, 0.455], { schatten: false });
      kiste(g, 0.08, 0.08, 0.04, "#ff7a9a", [-0.1, 0.56, 0.3], { schatten: false });
      kiste(g, 0.08, 0.08, 0.04, "#ff7a9a", [0.1, 0.56, 0.3], { schatten: false });
      [[-0.2, -0.12], [0.2, -0.12], [-0.2, 0.12], [0.2, 0.12]].forEach(([x, z]) => kiste(g, 0.1, 0.14, 0.1, "#ff8fa8", [x, 0.07, z]));
    }
    g.userData.kind = kind;
    return g;
  }


  keepInView() {
    return [];
  }

  shot() {
    return {
      // Ein fester Ausschnitt auf Boot und Kran, von schräg oben. Vorher
      // rahmte die Kamera auch alle Figuren auf dem Steg ein — und weil bei
      // jedem Zug einer zum Hebel lief, zoomte sie jedes Mal heraus und
      // wieder herein. Wer dran ist, steht in der Anzeige oben; der Steg
      // ragt rechts ins Bild.
      look: [0.25, 1.05, -0.7],
      frame: { w: 6.2, h: 3.6 },
      pitch: 0.5,
      yaw: -0.12,
      fov: 38,
      intro: { yaw: -0.5, pitch: 0.3, zoom: 1.4 },
      finale: { pull: 0.8, zoom: 0.7, lift: 0.3, orbit: 0.12 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button boat-button" data-boat-drop>
        <span class="nerve-button-face">LOSLASSEN!</span>
      </button>`;
    this.dropButton = this.controls.querySelector("[data-boat-drop]");
    const press = (event) => {
      event.preventDefault();
      if (this.dropButton.disabled) return;
      this.feedback?.sound("move");
      this.feedback?.vibrate(12);
      // Der Server lässt los, wo der Haken hängt, wenn der Tipp ankommt —
      // genau dort zeigt ihn das Bild (siehe arrival). Die Vorausrechnung
      // lässt den Passagier im selben Augenblick fallen, also fällt er sofort,
      // nicht erst eine Rundreise später.
      const minigame = this.update || this.minigame;
      const state = minigame?.arcade?.boat;
      const turn = state?.turn;
      const at = this.arrival(minigame);
      if (turn && turn.playerId === this.getControlledPlayerId() && at >= turn.from && at < turn.until && this.pendingDrop?.turn !== turn.number) {
        this.pendingDrop = { turn: turn.number, x: Math.round(swingX(turn, at, state.reach) * 100) / 100, at, kind: turn.kind, boatNumber: state.boatNumber, clock: performance.now() };
      }
      const clock = performance.now();
      this.sendInput({ action: "drop" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
    };
    this.on(this.dropButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  // Rundreise zum Server, geglättet und wie überall auf 250 ms gedeckelt.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.roundTrip ? this.roundTrip * 0.8 + clamped * 0.2 : clamped;
  }

  // Getippt wird selten — die Laufzeit misst darum ein Ping, jede Sekunde.
  pingIfIdle(minigame) {
    if (!minigame || minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.lastPingAt < 1000) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Jedes Bild trägt die Serverzeit, zu der es abging (sentAt). Das am
  // wenigsten verspätete der letzten Sekunden sagt am genauesten, wie weit
  // die Geräteuhr hinter dem Server liegt: die allgemeine Uhr gleicht sich nur
  // mit den seltenen vollen Raumständen ab, und jede Verzögerung beim Empfang
  // (ein langes Bild auf dem Hauptfaden) verschob sie — gemessen um 50 ms, bei
  // schnellem Haken ein Drittel Bootsbreite.
  onUpdate(update) {
    if (!Number.isFinite(update?.sentAt)) return;
    const clock = performance.now();
    this.lagSamples.push({ clock, sample: update.sentAt - Date.now() });
    while (this.lagSamples.length > 1 && this.lagSamples[0].clock < clock - 4000) this.lagSamples.shift();
    this.lagOffset = Math.max(...this.lagSamples.map((item) => item.sample));
  }

  // Serverzeit, um den Hinweg verspätet — wie die Bilder sie zeigen.
  serverSeen() {
    return this.lagOffset === null ? this.now() : Date.now() + this.lagOffset;
  }

  // Spielzeit, zu der ein JETZT geschickter Tipp beim Server ankommt. Die
  // Bilder zeigen die Serverzeit um den Hinweg verspätet, der Tipp braucht
  // noch einmal so lange — und der Server setzt sofort ab, nicht erst im
  // nächsten Takt. Vorher zeigte das Bild den Haken eine Rundreise zu früh:
  // bei 100 ms und schnellem Haken landete der Passagier bis zu 0,8 daneben.
  arrival(minigame) {
    if (!minigame) return 0;
    if (minigame.finaleAt) return this.now() - minigame.startedAt;
    return this.serverSeen() + this.roundTrip - minigame.startedAt;
  }

  // Boot und Tiere zu der Spielzeit, zu der ein jetzt geschickter Tipp
  // ankommt: vom Serverstand aus mit derselben Physik weitergerechnet — der
  // eigene, schon losgelassene Passagier eingeschlossen.
  forecastBoat(f, hookAt) {
    const state = f.arcade.boat;
    const world = Boot.copyWorld(state.world);
    const queue = state.queue.map((item) => ({ ...item }));
    const p = this.pendingDrop;
    if (p && p.boatNumber === state.boatNumber && state.turn?.number === p.turn && !state.passengers.some((x) => x.turn === p.turn)) {
      queue.push({ at: p.at, id: `p${p.turn}`, kind: p.kind, x: p.x, turn: p.turn });
    }
    const events = [];
    const to = f.minigame.finaleAt ? world.t : Math.min(world.t + Boot.MAX_SPAN_MS, Math.max(world.t, hookAt));
    Boot.advance(world, queue, to, events);
    return { world, events };
  }

  ownerColor(body, state, players) {
    if (typeof body.id === "string") return players.find((p) => p.id === this.getControlledPlayerId())?.color || "#ffffff";
    const by = state.passengers.find((p) => p.id === body.id)?.by;
    return players.find((p) => p.id === by)?.color || "#ffffff";
  }

  // Ein Tier in der Szene: ein Halter im Schwerpunkt (die Physik dreht um
  // ihn), darin das Modell mit der Unterkante an der Unterseite des Klotzes,
  // und ein Halstuch in der Farbe dessen, der es losgelassen hat.
  makeShown(body, color) {
    const k = Boot.kind(body.kind);
    const holder = new THREE.Group();
    const tier = this.makeAnimal(body.kind);
    tier.position.y = -k.hh;
    tier.rotation.y = ((Number(String(body.id).replace(/\D/g, "")) || 0) % 3 - 1) * 0.18;
    const tuch = SCARF[body.kind] || SCARF.kueken;
    kiste(tier, tuch.w, 0.06, 0.06, color, [0, tuch.y, tuch.z], { schatten: false });
    holder.add(tier);
    holder.position.set(body.x, body.y, 0);
    holder.rotation.z = body.a;
    this.raft.add(holder);
    return { holder, tier, vy: body.vy, squash: 0, body };
  }

  // Die Körper der Vorausrechnung zeigen. Neue bekommen ein Modell, fehlende
  // gingen über Bord (oder es war ein Irrtum der Vorausrechnung).
  drawBodies(view, f, state) {
    const { dt, now } = f;
    const seen = new Set();
    view.world.bodies.forEach((b) => {
      const key = b.id;
      // Der eigene Passagier bekommt vom Server seine ID: dasselbe Modell.
      if (!this.shown.has(key) && b.turn !== null && b.turn !== undefined && this.shown.has(`p${b.turn}`)) {
        this.shown.set(key, this.shown.get(`p${b.turn}`));
        this.shown.delete(`p${b.turn}`);
      }
      let s = this.shown.get(key);
      if (!s) {
        s = this.makeShown(b, this.ownerColor(b, state, f.players));
        this.shown.set(key, s);
      } else {
        const k = frameLerp(0.6, dt);
        s.holder.position.x += (b.x - s.holder.position.x) * k;
        s.holder.position.y += (b.y - s.holder.position.y) * k;
        s.holder.rotation.z += angleDiff(b.a, s.holder.rotation.z) * k;
      }
      seen.add(key);
      // Aufgeschlagen: kurz gestaucht, Staub, ein dumpfer Ton.
      if (s.vy < -1.4 && b.vy > -0.5) this.landed(s, -s.vy);
      s.vy = b.vy;
      s.body = b;
      s.squash = Math.max(0, s.squash - dt * 5);
      const atmen = Math.sin(now / 420 + (Number(String(key).replace(/\D/g, "")) || 0)) * 0.015;
      s.tier.scale.set(1 + s.squash * 0.12, 1 - s.squash * 0.18 + atmen, 1 + s.squash * 0.12);
    });
    for (const [key, s] of this.shown) {
      if (seen.has(key)) continue;
      this.shown.delete(key);
      const predicted = view.events.find((e) => e.kind === "overboard" && e.body.id === key)?.body;
      const confirmed = state.splashes?.find((e) => e.id === key);
      const body = predicted || confirmed || null;
      if (body) this.toWater(s, body);
      else s.holder.removeFromParent();
    }
  }

  landed(s, speed) {
    const w = Boot.kind(s.body.kind).w;
    s.squash = Math.min(1, speed / 4);
    const foot = s.holder.getWorldPosition(new THREE.Vector3());
    foot.y -= Boot.kind(s.body.kind).hh * 0.8;
    this.burst(foot, ["#ffffff", "#f4e2ac", "#c99b62"], { count: 4 + w * 2, speed: 0.8 + speed * 0.15, up: 0.8, size: 0.05, life: 0.4 });
    this.feedback?.sound("land", { strength: Math.min(1.2, 0.4 + speed * 0.12 + w * 0.1) });
    if (speed > 3.5 && w >= 2) this.rig.shake(0.08 * w);
  }

  // Über Bord: das Modell löst sich vom Floss, fliegt mit seinem Schwung
  // weiter, platscht und treibt.
  toWater(s, body) {
    if (this.falling.some((fall) => fall.tier === s.holder)) return;
    this.scene.attach(s.holder);
    this.falling.push({ tier: s.holder, at: performance.now(), vx: body.vx || 0, vy: body.vy || 0, vz: 0.2, spin: body.va || 0 });
  }

  // Kentern oder Ablegen: alles, was gerade an Bord ist, wird am Boot
  // festgemacht und fährt (oder rollt) mit ihm.
  boardAll() {
    for (const s of this.shown.values()) {
      this.boat.attach(s.holder);
      s.holder.userData.spot = { x: s.holder.position.x, y: s.holder.position.y };
      this.riders.push(s.holder);
    }
    this.shown.clear();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.boat;
    if (!state) return;
    this.pingIfIdle(minigame);
    const elapsed = now - minigame.startedAt;
    const hookAt = this.arrival(minigame);
    const nowP = performance.now();

    // Wellen.
    const pos = this.water.geometry.attributes.position;
    const t = now / 1000;
    for (let i = 0; i < pos.count; i += 1) {
      const x = this.waterBase[i * 3];
      const z = this.waterBase[i * 3 + 2];
      pos.array[i * 3 + 1] = Math.sin(x * 0.6 + t * 1.3) * 0.05 + Math.cos(z * 0.5 + t * 1.1) * 0.05;
    }
    pos.needsUpdate = true;
    this.bobbing.forEach((b) => {
      b.obj.position.y = b.y + Math.sin(t * 1.4 + b.phase) * 0.05;
      b.obj.rotation.z = Math.sin(t * 1.1 + b.phase) * 0.06;
      if (b.spin) b.obj.rotation.y += dt * 0.3;
    });
    this.fish.forEach((fisch) => {
      const d = fisch.userData;
      const a = t * d.speed + d.phase;
      fisch.position.set(d.cx + Math.cos(a) * d.r, -0.45, d.cz + Math.sin(a) * d.r * 0.6);
      fisch.rotation.y = -a;
    });
    this.smoke.forEach((puff) => {
      const u = ((now / 5000) + puff.userData.phase) % 1;
      puff.position.set(-16 + u * 3, 7 + u * 5, -34);
      puff.scale.setScalar(0.8 + u * 2.2);
      puff.material.opacity = 0.6 * (1 - u);
    });

    // Neue Ereignisse vom Server: losgelassen, gekentert, abgelegt.
    if (this.boatNumber < 0) {
      this.boatNumber = state.boatNumber;
      this.seenEvents = state.events;
      this.splashSeen = state.splashCount || 0;
    }
    if (state.events > this.seenEvents && state.last) {
      this.seenEvents = state.events;
      this.onBoatEvent(state.last, f);
    }
    // Über Bord (vom Server bestätigt): die Punkte gehen verloren.
    if ((state.splashCount || 0) > this.splashSeen) {
      (state.splashes || []).filter((sp) => sp.number >= this.splashSeen).forEach((sp) => {
        const kin = sp.by && this.kins.get(sp.by);
        if (kin && sp.points) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), `ÜBER BORD −${sp.points}`, { color: "#bfe6ff", size: 0.34, life: 1.3 });
        if (sp.by === controlledId) {
          this.feedback?.sound("fall");
          this.feedback?.vibrate(30);
        } else this.feedback?.sound("drop");
      });
      this.splashSeen = state.splashCount;
    }
    if (this.pendingDrop && (nowP - this.pendingDrop.clock > 2000 || this.pendingDrop.boatNumber !== state.boatNumber)) this.pendingDrop = null;

    // Boot und Tiere aus der Vorausrechnung.
    const view = this.forecastBoat(f, hookAt);
    this.viewAngle = view.world.boat.a;
    this.viewTorque = Boot.torque(view.world);
    this.raft.position.y = Math.sin(now / 900) * 0.03;
    if (!this.leaving) {
      this.boat.rotation.z += angleDiff(view.world.boat.a, this.boat.rotation.z) * frameLerp(0.6, dt);
      if (this.boat.position.x < -0.001) {
        this.boat.position.x += (0 - this.boat.position.x) * frameLerp(0.12, dt);
        if (this.boat.position.x > -0.01) this.boat.position.x = 0;
      }
      this.drawBodies(view, f, state);
    }
    this.animateLeaving(nowP, dt);

    // Fallende Tiere: Bogen ins Wasser, platschen, treiben kurz.
    this.falling = this.falling.filter((fall) => {
      const s = (nowP - fall.at) / 1000;
      if (s > 2.6) {
        fall.tier.removeFromParent();
        return false;
      }
      fall.tier.position.x += fall.vx * dt;
      fall.tier.position.z += fall.vz * dt;
      if (!fall.wet) {
        fall.vy -= 9.81 * dt;
        fall.tier.position.y += fall.vy * dt;
        fall.tier.rotation.z += dt * (fall.spin ?? 5);
        fall.tier.rotation.x += dt * 1.2;
        if (fall.tier.position.y < 0.05) {
          fall.wet = true;
          fall.vx *= 0.2;
          fall.vz *= 0.2;
          this.burst(fall.tier.position.clone().setY(0.1), ["#ffffff", "#bfe6ff"], { count: 10, speed: 1.4, up: 2.2, size: 0.07, life: 0.6 });
          this.bursts.ring(fall.tier.position.clone().setY(0.03), "#ffffff", { radius: 0.9, life: 0.6, opacity: 0.6 });
          this.feedback?.sound("bumperSplash", { strength: 0.6 });
        }
      } else {
        fall.tier.position.y = -0.12 + Math.sin(nowP / 200) * 0.05;
        fall.tier.rotation.x *= 0.92;
        fall.tier.rotation.z *= 0.95;
      }
      return true;
    });

    // Kran: Laufkatze und Passagier am Haken. Ist der eigene losgelassen
    // (oder fällt der eines anderen schon), hängt nichts mehr am Haken.
    const turn = state.turn;
    const active = turn && hookAt >= turn.from && !f.finale;
    const pending = this.pendingDrop?.turn === turn?.number ? this.pendingDrop : null;
    const falling = active && (view.world.bodies.some((b) => b.turn === turn.number) || state.passengers.some((p) => p.turn === turn.number));
    if (active) {
      const x = pending ? pending.x : swingX(turn, hookAt, state.reach);
      this.trolley.position.x = x;
      const rope = BEAM_Y - 0.25 - HOOK_Y;
      this.rope.scale.y = rope;
      this.rope.position.y = -rope / 2;
      this.hook.position.y = -rope - 0.08;
      if (!this.hanging || this.hanging.userData.turn !== turn.number) {
        if (this.hanging) this.scene.remove(this.hanging);
        this.hanging = this.makeAnimal(turn.kind);
        this.hanging.userData.turn = turn.number;
        this.scene.add(this.hanging);
      }
      this.hanging.visible = !falling;
      this.hanging.position.set(x, HOOK_Y - 0.75, RAFT_Z);
      this.hanging.rotation.z = pending ? 0 : Math.sin(now / 160) * 0.1;
    } else if (this.hanging) {
      this.hanging.visible = false;
    }
    this.drawSafeBand(state, active && !falling && !this.leaving ? turn : null, hookAt);
    if (!active) {
      this.rope.scale.y = 0.6;
      this.rope.position.y = -0.3;
      this.hook.position.y = -0.68;
    }

    // Figuren: wer dran ist, geht an den Hebel.
    players.forEach((player) => {
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!kin || !animator) return;
      const home = kin.userData.home;
      const mine = turn && turn.playerId === player.id && elapsed >= turn.from - 400;
      const goal = mine ? new THREE.Vector3(PIER_X + 0.8, 0, -2.15) : home;
      const dx = goal.x - kin.position.x;
      const dz = goal.z - kin.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.02) {
        const step = Math.min(dist, 2.6 * dt);
        kin.position.x += (dx / dist) * step;
        kin.position.z += (dz / dist) * step;
      }
      const moving = dist > 0.05;
      const face = moving ? Math.atan2(dx, dz) : -Math.PI / 2 + (mine ? 0 : 0.35);
      kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(0.25, dt);
      if (f.finale) return;
      if (moving) animator.set("walk");
      else if (mine) {
        animator.set("focus");
        animator.lookAt(this.hanging?.position || null);
      } else {
        animator.set("idle");
        animator.lookAt(this.boat.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0)));
      }
    });
    const pulled = (state.last && elapsed - state.last.at < 400) || (this.pendingDrop && nowP - this.pendingDrop.clock < 400);
    this.lever.rotation.x = pulled ? 0.6 : 0;
    this.leverKnob.position.z = -2.25 + (pulled ? 0.18 : 0);
    this.leverKnob.position.y = pulled ? 1.35 : 1.42;
  }

  onBoatEvent(last, f) {
    const { controlledId } = f;
    const nowP = performance.now();
    const isOwn = last.playerId === controlledId;
    const kin = this.kins.get(last.playerId);
    if (last.kind === "place") {
      if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), `+${last.points}`, { color: last.points >= 40 ? "#ffe36b" : "#ffffff", size: 0.4 });
      if (isOwn) {
        this.feedback?.sound(last.points >= 40 ? "perfect" : "pop");
        this.feedback?.vibrate(12);
      }
    } else if (last.kind === "capsize") {
      // Das Boot rollt um, immer schneller, wie ein fallender Körper. Die
      // Passagiere bleiben erst sitzen und rutschen ab, sobald es steil
      // genug wird — die auf der tiefen Seite zuerst.
      this.pendingDrop = null;
      this.boardAll();
      const side = last.side || 1;
      this.riders.forEach((tier) => {
        const outward = (tier.userData.spot?.x || 0) * side;
        tier.userData.detachAt = clampNum(0.62 - outward * 0.12 + (tier.userData.spot?.y || 0) * 0.15, 0.35, 1.1);
      });
      this.leaving = { kind: "capsize", at: nowP, side, from: this.boat.rotation.z };
      this.burst(new THREE.Vector3(side * 1.5, 0.3, RAFT_Z), ["#ffffff", "#bfe6ff", "#35c3d6"], { count: 30, speed: 3, up: 3, size: 0.1, life: 1 });
      if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "PLATSCH! −30", { color: "#bfe6ff", size: 0.4, life: 1.3 });
      this.animators.get(last.playerId)?.trigger("facepalm");
      this.rig.shake(0.6);
      this.feedback?.sound(isOwn ? "fall" : "impact");
      if (isOwn) this.feedback?.vibrate([50, 40, 70]);
    } else if (last.kind === "depart") {
      this.boardAll();
      this.leaving = { kind: "depart", at: nowP };
      this.boat.userData.mast.visible = true;
      this.boat.userData.segel.visible = true;
      (last.loaders || []).forEach((id) => {
        const k = this.kins.get(id);
        if (k) this.pop(k.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "+5 ⛵", { color: "#b8ffb0", size: 0.34 });
        this.animators.get(id)?.trigger("wave");
      });
      this.feedback?.sound("win");
    }
  }

  // Ein altes Boot verschwindet (kentert oder segelt davon), ein neues kommt
  // von links.
  animateLeaving(nowP, dt) {
    if (!this.leaving) return;
    const u = (nowP - this.leaving.at) / (this.leaving.kind === "capsize" ? 1700 : 1400);
    if (this.leaving.kind === "capsize") {
      // Gleichmässig beschleunigt bis kieloben (π), dann treibt es kurz und
      // sinkt. Die Drehung kippt zur schweren Seite.
      const s = (nowP - this.leaving.at) / 1000;
      const dir = -this.leaving.side;
      const room = Math.max(0, Math.PI - Math.abs(this.leaving.from));
      const roll = Math.min(room, 0.5 * CAPSIZE_ACCEL * s * s);
      const spin = Math.min(CAPSIZE_ACCEL * s, 6);
      this.boat.rotation.z = this.leaving.from + dir * roll;
      const flipped = roll >= room - 1e-3;
      this.boat.position.y = BOAT_Y + (flipped ? -Math.min(0.9, (s - 0.95) * 0.7) : -Math.sin(roll) * 0.12);
      this.boat.position.x = dir * -Math.sin(roll * 0.5) * 0.35;
      // Wer zu steil sitzt, rutscht ab: mit der Bahngeschwindigkeit der
      // Drehung (ω × r) und etwas nach aussen.
      this.riders = this.riders.filter((tier) => {
        if (roll < tier.userData.detachAt) return true;
        const world = tier.getWorldPosition(new THREE.Vector3());
        const boatAt = this.boat.getWorldPosition(new THREE.Vector3());
        this.scene.attach(tier);
        const rx = world.x - boatAt.x;
        const ry = world.y - boatAt.y;
        const omega = dir * spin;
        this.falling.push({ tier, at: nowP, vx: -omega * ry + dir * 0.6, vy: omega * rx + 0.6, vz: (Math.random() - 0.5) * 0.6, spin: dir * (3 + Math.random() * 3) });
        return false;
      });
    } else {
      // Hinaus aufs Meer, weg von der Kamera. Vorher segelte das Boot nach
      // rechts — mitten durch den Steg, und die Passagiere fuhren durch die
      // Figuren, die dort warten.
      this.boat.position.z = -u * u * 16;
      this.boat.position.x = u * u * 1.5;
      this.boat.rotation.y = -u * 0.35;
      this.boat.rotation.z *= 0.9;
      this.riders.forEach((tier, i) => { tier.children[0].rotation.y = Math.sin(nowP / 150 + i) * 0.4; });
    }
    if (u >= 1) {
      this.leaving = null;
      this.riders.forEach((tier) => tier.removeFromParent());
      this.riders = [];
      this.boat.userData.mast.visible = false;
      this.boat.userData.segel.visible = false;
      this.boat.rotation.set(0, 0, 0);
      this.boat.position.set(-9, BOAT_Y, 0);
    }
  }

  // Der Streifen auf der Bordwand: grün, wo der Passagier das Boot sicher
  // hält, rot, wo es kentern würde — und eine Marke, wo er JETZT fallen
  // würde. Gerechnet mit der Kippgrenze beim Absetzen; landet er auf einem
  // anderen Tier und rutscht ab, kann es trotzdem anders kommen.
  drawSafeBand(state, turn, hookAt) {
    const { band, marke } = this.boat.userData;
    const show = Boolean(turn);
    Object.values(band).forEach((m) => { m.visible = show; });
    marke.visible = show;
    if (!show) return;
    const reach = state.reach;
    const limit = state.torqueMax;
    const torque = this.viewTorque;
    const lo = Math.max(-reach, (-limit - torque) / turn.w);
    const hi = Math.min(reach, (limit - torque) / turn.w);
    const setSpan = (m, a, b) => {
      m.visible = b - a > 0.01;
      m.scale.x = Math.max(0.01, b - a);
      m.position.x = (a + b) / 2;
    };
    setSpan(band.safe, Math.min(lo, hi), Math.max(lo, hi));
    setSpan(band.left, -reach, Math.min(lo, reach));
    setSpan(band.right, Math.max(hi, -reach), reach);
    const x = swingX(turn, hookAt, reach);
    marke.position.x = x;
    const safe = x >= lo && x <= hi;
    marke.userData.material.color.set(safe ? "#ffffff" : "#ff2244");
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.boat;
    if (!state) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(Math.round(own?.score || 0));
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const chips = this.hud.querySelector("[data-boat-chips]");
    if (chips) {
      const html = room.players.map((player) => {
        const entry = arcade.players[player.id];
        const active = state.turn?.playerId === player.id;
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}${active ? " is-turn" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${Math.round(entry?.score || 0)}</span>`;
      }).join("");
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }
    // Wasserwaage: wie schief liegt das Boot, und wo kentert es.
    const level = this.hud.querySelector("[data-boat-level]");
    if (level) {
      const share = Math.max(-1, Math.min(1, -this.viewAngle / (state.capAngle || 0.45)));
      level.firstElementChild.style.left = `${50 + share * 46}%`;
      level.dataset.risk = Math.abs(share) > 0.75 ? "high" : Math.abs(share) > 0.45 ? "mid" : "low";
    }
    const elapsed = now - minigame.startedAt;
    const hookAt = this.arrival(minigame);
    const turn = state.turn;
    const ownTurn = Boolean(turn && turn.playerId === controlledId && hookAt >= turn.from && this.pendingDrop?.turn !== turn.number);
    const roundNode = this.hud.querySelector("[data-boat-round]");
    const roundText = `${Math.max(1, (state.round ?? 0) + 1)}/${state.rounds || 4}`;
    if (roundNode && roundNode.textContent !== roundText) roundNode.textContent = roundText;
    if (turn && turn.round !== this.roundSeen) {
      this.roundSeen = turn.round;
      this.roundBannerUntil = performance.now() + 1700;
    }
    const banner = this.hud.querySelector("[data-boat-banner]");
    let message = null;
    let tone = "#12aaff";
    const last = state.last;
    const splash = state.splashes?.[state.splashes.length - 1];
    if (elapsed < state.leadMs) message = "Gleich kommt der erste Passagier …";
    else if (last && elapsed - last.at < 1400 && last.kind === "capsize") {
      const who = room.players.find((p) => p.id === last.playerId);
      message = last.playerId === controlledId ? "Gekentert! −30" : `${escapeName(who?.name)} hat's gekippt!`;
      tone = "#ff5d73";
    } else if (splash && elapsed - splash.at < 1200 && splash.points) {
      const who = room.players.find((p) => p.id === splash.by);
      message = splash.by === controlledId ? `Dein ${animalName(splash.kind)} ist über Bord! −${splash.points}` : `${animalName(splash.kind)} von ${escapeName(who?.name)} über Bord!`;
      tone = "#2f8fb0";
    } else if (turn && performance.now() < this.roundBannerUntil) {
      message = `Runde ${turn.round + 1}/${state.rounds}: ${animalName(turn.kind, true)}!`;
      tone = "#b57bff";
    } else if (last && elapsed - last.at < 1400 && last.kind === "depart") {
      message = "Boot voll — ablegen! ⛵";
      tone = "#1fbf5b";
    } else if (state.full) {
      message = "Boot voll — hält alles?";
      tone = "#2f8fb0";
    } else if (ownTurn) {
      message = `Du bist dran — ${animalName(turn.kind)} loslassen!`;
      tone = "#1fbf5b";
    } else if (turn) {
      const who = room.players.find((p) => p.id === turn.playerId);
      message = `${escapeName(who?.name)} ist dran …`;
      tone = "#2f8fb0";
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
    }
    if (this.dropButton) this.dropButton.disabled = !ownTurn || Boolean(minigame.finaleAt);
  }
}

function swingX(turn, elapsed, reach) {
  const t = Math.max(0, elapsed - turn.from) / 1000;
  return reach * Math.sin(turn.omega * t + turn.phase);
}

function animalName(kind, plural = false) {
  if (plural) return { kueken: "Küken", pinguin: "Pinguine", schaf: "Schafe", schwein: "Schweine" }[kind] || "Passagiere";
  return { kueken: "Küken", pinguin: "Pinguin", schaf: "Schaf", schwein: "Schwein" }[kind] || "Passagier";
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
