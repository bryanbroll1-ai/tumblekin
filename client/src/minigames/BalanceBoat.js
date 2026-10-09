import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin213";
import { frameLerp } from "./Quality.js?v=tumblekin213";
import { kiste, lambert, viele, streuer, himmel, wolken } from "./Kulisse.js?v=tumblekin213";

// Kippboot — eine Südsee-Lagune. Über einem Ruderboot spannt sich eine
// Kranbrücke; an ihr fährt eine Laufkatze hin und her, und am Haken hängt der
// nächste Passagier: ein Küken, ein Pinguin, ein Schaf oder ein Schwein. Wer
// dran ist, tippt, und der Passagier plumpst ins Boot. Das Boot neigt sich mit
// dem Gewicht — kippt es zu weit, gehen alle baden.
//
// Die Figuren stehen auf dem Steg rechts und schauen zu; wer dran ist, steht
// vorn am Hebel. Drumherum Strand mit Palmen, Strandhütten, Sonnenschirm,
// Surfbretter und eine Vulkaninsel am Horizont.
const WATER_Y = 0;
const BOAT_Y = 0.12;
const DECK_Y = 0.42;
const BEAM_Y = 3.5;
const HOOK_Y = 2.35;
const PIER_X = 3.4;
const WOBBLE = 0.06;
const BAND_Z = 0.74;             // Sicherheitsleiste an der vorderen Bordwand
const CAPSIZE_ACCEL = 7;         // rad/s²: so schnell rollt ein kenterndes Boot um

function clampNum(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class BalanceBoat extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.seenEvents = 0;
    this.boatNumber = -1;
    this.riders = [];               // Tiere im Boot
    this.falling = [];              // Tiere, die gerade ins Wasser fliegen
    this.tilt = 0;
    this.tiltVel = 0;               // Schaukeln als gedämpfte Feder
    this.leaving = null;
    this.arriveAt = 0;
    this.labelY = 0.78;
    this.roundTrip = 0;
    this.lastPingAt = 0;
    this.pendingDrop = null;        // { turn, x, at, vy } — eigener Tipp, noch ohne Antwort
    this.roundSeen = -1;
    this.roundBannerUntil = 0;
    this.lagSamples = [];           // { clock, sample }: sentAt − Empfangszeit je Bild
    this.lagOffset = null;
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
    this.boat = this.makeBoat();
    scene.add(this.boat);
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
    kiste(rumpf, 4.0, 0.5, 1.5, "#c8413b", [0, 0.1, 0]);
    [-1, 1].forEach((seite) => {
      const spitze = kiste(rumpf, 1.06, 0.5, 1.06, "#c8413b", [seite * 2.0, 0.1, 0]);
      spitze.rotation.y = Math.PI / 4;
      spitze.scale.set(1, 1, 1);
    });
    kiste(rumpf, 4.1, 0.1, 1.6, "#ffffff", [0, 0.36, 0], { schatten: false });
    kiste(rumpf, 3.8, 0.06, 1.3, "#c99b62", [0, DECK_Y - BOAT_Y - 0.08, 0]);
    kiste(rumpf, 0.2, 0.2, 1.3, "#8a6238", [-1.1, DECK_Y - BOAT_Y, 0]);
    kiste(rumpf, 0.2, 0.2, 1.3, "#8a6238", [1.1, DECK_Y - BOAT_Y, 0]);
    // Mittelmarke.
    kiste(rumpf, 0.08, 0.02, 1.32, "#ffd15c", [0, DECK_Y - BOAT_Y - 0.04, 0], { schatten: false });
    // Ruder an der Seite.
    const ruder = kiste(rumpf, 0.08, 0.08, 2.2, "#b98a55", [-0.5, 0.4, 0.95]);
    ruder.rotation.y = 0.3;
    boot.add(rumpf);
    // Segel (nur beim Ablegen sichtbar).
    const mast = kiste(boot, 0.08, 1.6, 0.08, "#8a5a3a", [0, DECK_Y + 0.8, -0.55]);
    const segel = kiste(boot, 0.04, 1.1, 1.0, "#fffaf0", [0.1, DECK_Y + 1.0, -0.55], { schatten: false });
    mast.visible = false;
    segel.visible = false;
    // Auf der vorderen Bordwand: wo der Passagier sicher landet (grün) und wo
    // das Boot kentern würde (rot), dazu ein Stift, wo er jetzt landen würde.
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
    boot.position.set(0, BOAT_Y, -0.9);
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

  // Wo steht ein Passagier im Boot? Liegen zwei an derselben Stelle, stapelt
  // sich der zweite obendrauf.
  riderSpot(passengers, index) {
    const p = passengers[index];
    let stack = 0;
    for (let i = 0; i < index; i += 1) if (Math.abs(passengers[i].x - p.x) < 0.42) stack += 1;
    return { x: p.x, y: DECK_Y - BOAT_Y - 0.04 + stack * 0.42, z: ((index % 3) - 1) * 0.28 };
  }

  syncRiders(passengers) {
    while (this.riders.length > passengers.length) this.boat.remove(this.riders.pop());
    passengers.forEach((p, i) => {
      if (this.riders[i]?.userData.kind === p.kind && this.riders[i].userData.x === p.x) return;
      if (this.riders[i]) this.boat.remove(this.riders[i]);
      const tier = this.makeAnimal(p.kind);
      tier.userData.x = p.x;
      const spot = this.riderSpot(passengers, i);
      tier.position.set(spot.x, spot.y + 0.9, spot.z);
      tier.userData.spot = spot;
      tier.rotation.y = (i % 2 ? 0.4 : -0.4);
      this.boat.add(tier);
      this.riders[i] = tier;
    });
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
        <span class="nerve-button-face">ABSETZEN!</span>
      </button>`;
    this.dropButton = this.controls.querySelector("[data-boat-drop]");
    const press = (event) => {
      event.preventDefault();
      if (this.dropButton.disabled) return;
      this.feedback?.sound("move");
      this.feedback?.vibrate(12);
      // Der Server setzt ab, wo der Haken hängt, wenn der Tipp ankommt — genau
      // dort zeigt ihn das Bild (siehe arrival). Also fällt der Passagier sofort,
      // nicht erst eine Rundreise später.
      const minigame = this.update || this.minigame;
      const state = minigame?.arcade?.boat;
      const turn = state?.turn;
      const at = this.arrival(minigame);
      if (turn && turn.playerId === this.getControlledPlayerId() && at >= turn.from && at < turn.until && this.pendingDrop?.turn !== turn.number) {
        this.pendingDrop = { turn: turn.number, x: swingX(turn, at, state.reach), at: performance.now(), vy: 0 };
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

    // Neue Ereignisse: absetzen, kentern, ablegen.
    if (this.boatNumber < 0) {
      this.boatNumber = state.boatNumber;
      this.seenEvents = state.events;
    }
    if (state.events > this.seenEvents && state.last) {
      this.seenEvents = state.events;
      const last = state.last;
      const isOwn = last.playerId === controlledId;
      // Der eigene Passagier fiel schon; jetzt übernimmt ihn das Boot.
      if (this.pendingDrop && this.pendingDrop.turn === last.turn) {
        this.pendingDrop = null;
        if (this.hanging) this.hanging.visible = false;
      }
      const kin = this.kins.get(last.playerId);
      if (last.kind === "place") {
        this.syncRiders(state.passengers);
        // Der Aufprall drückt die Seite kurz herunter: das Boot schaukelt
        // nach, je schwerer und je weiter aussen, desto mehr.
        this.tiltVel += -Math.sign(last.x || 0) * Math.min(1.4, 0.25 + last.w * Math.abs(last.x) * 0.3);
        const tier = this.riders[this.riders.length - 1];
        if (tier) this.burst(this.boat.localToWorld(tier.userData.spot ? new THREE.Vector3(tier.userData.spot.x, tier.userData.spot.y + 0.3, 0) : new THREE.Vector3()), ["#ffffff", "#bfe6ff"], { count: 6, speed: 1, up: 1, size: 0.05, life: 0.4 });
        if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), `+${last.points}`, { color: last.points >= 6 ? "#ffe36b" : "#ffffff", size: 0.4 });
        if (isOwn) {
          this.feedback?.sound(last.points >= 6 ? "perfect" : "pop");
          this.feedback?.vibrate(12);
        }
      } else if (last.kind === "capsize") {
        // Das Boot rollt um, immer schneller, wie ein fallender Körper. Die
        // Passagiere bleiben erst sitzen und rutschen ab, sobald es steil
        // genug wird — die auf der tiefen Seite zuerst. Vorher flogen alle
        // im selben Augenblick in Zufallsrichtungen davon.
        this.syncRiders(last.passengers);
        const side = last.side || 1;
        this.riders.forEach((tier) => {
          const outward = (tier.userData.spot?.x || 0) * side;
          tier.userData.detachAt = clampNum(0.62 - outward * 0.12 + (tier.userData.spot?.y || 0) * 0.15, 0.35, 1.1);
        });
        this.leaving = { kind: "capsize", at: nowP, side, from: this.boat.rotation.z };
        this.burst(new THREE.Vector3(last.side * 1.5, 0.3, -0.9), ["#ffffff", "#bfe6ff", "#35c3d6"], { count: 30, speed: 3, up: 3, size: 0.1, life: 1 });
        if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "PLATSCH! −30", { color: "#bfe6ff", size: 0.4, life: 1.3 });
        this.animators.get(last.playerId)?.trigger("facepalm");
        this.rig.shake(0.6);
        this.feedback?.sound(isOwn ? "fall" : "impact");
        if (isOwn) this.feedback?.vibrate([50, 40, 70]);
      } else if (last.kind === "depart") {
        this.syncRiders(last.passengers);
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
    // Ein altes Boot verschwindet, ein neues kommt von links.
    if (this.leaving) {
      const u = (nowP - this.leaving.at) / (this.leaving.kind === "capsize" ? 1700 : 1400);
      if (this.leaving.kind === "capsize") {
        // Gleichmässig beschleunigt bis kieloben (π), dann treibt es kurz und
        // sinkt. Die Drehung kippt zur schweren Seite.
        const s = (nowP - this.leaving.at) / 1000;
        const dir = -this.leaving.side;
        const roll = Math.min(Math.PI - Math.abs(this.leaving.from), 0.5 * CAPSIZE_ACCEL * s * s);
        const spin = Math.min(CAPSIZE_ACCEL * s, 6);
        this.boat.rotation.z = this.leaving.from + dir * roll;
        const flipped = roll >= Math.PI - Math.abs(this.leaving.from) - 1e-3;
        this.boat.position.y = BOAT_Y + (flipped ? -Math.min(0.9, (s - 0.95) * 0.7) : -Math.sin(roll) * 0.12);
        this.boat.position.x = dir * -Math.sin(roll * 0.5) * 0.35;
        // Wer zu steil sitzt, rutscht ab: mit der Bahngeschwindigkeit der
        // Drehung (ω × r) und etwas nach aussen.
        this.riders = this.riders.filter((tier) => {
          if (roll < tier.userData.detachAt) {
            tier.rotation.z = -dir * Math.min(0.5, roll * 0.4);
            return true;
          }
          const world = tier.getWorldPosition(new THREE.Vector3());
          const quat = tier.getWorldQuaternion(new THREE.Quaternion());
          this.boat.remove(tier);
          tier.position.copy(world);
          tier.quaternion.copy(quat);
          this.scene.add(tier);
          const rx = world.x - this.boat.position.x;
          const ry = world.y - this.boat.position.y;
          const omega = dir * spin;
          this.falling.push({ tier, at: nowP, vx: -omega * ry + dir * 0.6, vy: omega * rx + 0.6, vz: (Math.random() - 0.5) * 0.6, spin: dir * (3 + Math.random() * 3) });
          return false;
        });
      } else {
        // Hinaus aufs Meer, weg von der Kamera. Vorher segelte das Boot nach
        // rechts — mitten durch den Steg, und die Passagiere fuhren durch die
        // Figuren, die dort warten.
        this.boat.position.z = -0.9 - u * u * 16;
        this.boat.position.x = u * u * 1.5;
        this.boat.rotation.y = -u * 0.35;
        this.riders.forEach((tier, i) => { tier.rotation.y = Math.sin(nowP / 150 + i) * 0.4; });
      }
      if (u >= 1) {
        this.leaving = null;
        this.riders.forEach((tier) => this.boat.remove(tier));
        this.riders = [];
        this.boat.userData.mast.visible = false;
        this.boat.userData.segel.visible = false;
        this.boat.rotation.z = 0;
        this.boat.rotation.y = 0;
        this.tilt = 0;
        this.tiltVel = 0;
        this.boat.position.set(-9, BOAT_Y, -0.9);
        this.arriveAt = nowP;
      }
    } else if (this.boat.position.x < -0.001) {
      this.boat.position.x += (0 - this.boat.position.x) * frameLerp(0.08, dt);
      if (this.boat.position.x > -0.01) this.boat.position.x = 0;
    }
    if (!this.leaving) this.syncRiders(state.passengers);

    // Neigung: eine gedämpfte Feder zum Drehmoment hin — das Boot schwingt
    // nach jedem Aufprall nach und kommt dann zur Ruhe. Nahe der Kippgrenze
    // wird die Feder weich: dann wackelt es bedrohlich.
    const target = this.leaving ? this.tilt : Math.max(-0.42, Math.min(0.42, -(state.torque / state.torqueMax) * 0.38));
    if (!this.leaving) {
      const danger = Math.min(1, Math.abs(state.torque) / state.torqueMax);
      const stiffness = 16 - danger * 7;
      const step = Math.min(dt, 0.05);
      this.tiltVel += ((target - this.tilt) * stiffness - this.tiltVel * 3.2) * step;
      this.tilt += this.tiltVel * step;
    }
    if (!this.leaving || this.leaving.kind !== "capsize") {
      this.boat.rotation.z = this.tilt + Math.sin(now / 700) * WOBBLE * 0.4;
      this.boat.position.y = BOAT_Y + Math.sin(now / 900) * 0.03 - Math.abs(this.tiltVel) * 0.02;
    }
    this.riders.forEach((tier, i) => {
      const spot = tier.userData.spot;
      if (spot) tier.position.y += (spot.y - tier.position.y) * frameLerp(0.3, dt);
      // Die Tiere stemmen sich gegen die Schräge und wanken beim Schaukeln.
      if (!this.leaving) tier.rotation.z = -this.tilt * 0.55 - this.tiltVel * 0.08 + Math.sin(now / 260 + i) * 0.02;
    });

    // Fallende Tiere: Bogen ins Wasser, platschen, treiben kurz.
    this.falling = this.falling.filter((fall) => {
      const s = (nowP - fall.at) / 1000;
      if (s > 2.4) {
        this.scene.remove(fall.tier);
        return false;
      }
      fall.tier.position.x += fall.vx * dt;
      fall.tier.position.z += fall.vz * dt;
      if (!fall.wet) {
        fall.vy -= 9 * dt;
        fall.tier.position.y += fall.vy * dt;
        fall.tier.rotation.z += dt * (fall.spin ?? 5);
        fall.tier.rotation.x += dt * 1.5;
        if (fall.tier.position.y < 0) {
          fall.wet = true;
          fall.vx *= 0.2;
          fall.vz *= 0.2;
          this.burst(fall.tier.position.clone().setY(0.1), ["#ffffff", "#bfe6ff"], { count: 8, speed: 1.4, up: 2, size: 0.07, life: 0.6 });
        }
      } else {
        fall.tier.position.y = -0.15 + Math.sin(nowP / 200) * 0.05;
        fall.tier.rotation.x *= 0.9;
      }
      return true;
    });

    // Kran: Laufkatze und Passagier am Haken.
    const turn = state.turn;
    const pending = this.pendingDrop;
    if (pending && nowP - pending.at > 1500) this.pendingDrop = null;
    const active = turn && hookAt >= turn.from && !f.finale;
    if (active) {
      const x = pending?.turn === turn.number ? pending.x : swingX(turn, hookAt, state.reach);
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
      this.hanging.visible = true;
      if (pending?.turn === turn.number) {
        // Losgelassen: er fällt, bis das Boot ihn übernimmt.
        pending.vy += 9 * dt;
        const floor = BOAT_Y + DECK_Y - 0.04;
        this.hanging.position.set(x, Math.max(floor, this.hanging.position.y - pending.vy * dt), -0.9);
        this.hanging.rotation.z *= 0.8;
      } else {
        this.hanging.position.set(x, HOOK_Y - 0.75, -0.9);
        this.hanging.rotation.z = Math.sin(now / 160) * 0.1;
      }
    } else if (this.hanging) {
      this.hanging.visible = false;
    }
    this.drawSafeBand(state, active && !this.leaving ? turn : null, hookAt);
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
        animator.lookAt(this.boat.position.clone().add(new THREE.Vector3(0, 0.6, 0)));
      }
    });
    const pulled = (state.last && elapsed - state.last.at < 400) || (this.pendingDrop && nowP - this.pendingDrop.at < 400);
    this.lever.rotation.x = pulled ? 0.6 : 0;
    this.leverKnob.position.z = -2.25 + (pulled ? 0.18 : 0);
    this.leverKnob.position.y = pulled ? 1.35 : 1.42;
  }

  // Der Streifen auf der Bordwand: grün, wo der Passagier sicher landet, rot,
  // wo das Boot kentern würde — und eine Marke, wo er JETZT landen würde.
  drawSafeBand(state, turn, hookAt) {
    const { band, marke } = this.boat.userData;
    const show = Boolean(turn);
    Object.values(band).forEach((m) => { m.visible = show; });
    marke.visible = show;
    if (!show) return;
    const reach = state.reach;
    const limit = state.torqueMax;
    const torque = state.torque;
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
    const x = this.pendingDrop?.turn === turn.number ? this.pendingDrop.x : swingX(turn, hookAt, reach);
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
    // Wasserwaage: wie schief liegt das Boot, und wo wäre es zu viel.
    const level = this.hud.querySelector("[data-boat-level]");
    if (level) {
      const share = Math.max(-1, Math.min(1, state.torque / state.torqueMax));
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
    if (elapsed < state.leadMs) message = "Gleich kommt der erste Passagier …";
    else if (last && elapsed - last.at < 1400 && last.kind === "capsize") {
      const who = room.players.find((p) => p.id === last.playerId);
      message = last.playerId === controlledId ? "Gekentert! −30" : `${escapeName(who?.name)} hat's gekippt!`;
      tone = "#ff5d73";
    } else if (turn && performance.now() < this.roundBannerUntil) {
      message = `Runde ${turn.round + 1}/${state.rounds}: ${animalName(turn.kind, true)}!`;
      tone = "#b57bff";
    } else if (last && elapsed - last.at < 1400 && last.kind === "depart") {
      message = "Boot voll — ablegen! ⛵";
      tone = "#1fbf5b";
    } else if (ownTurn) {
      message = `Du bist dran — ${animalName(turn.kind)} absetzen!`;
      tone = "#1fbf5b";
    } else if (turn) {
      const who = room.players.find((p) => p.id === turn.playerId);
      message = `${escapeName(who?.name)} setzt ab …`;
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
