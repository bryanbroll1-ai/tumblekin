import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer, himmel, wolken } from "./Kulisse.js?v=tumblekin200";

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

export class BalanceBoat extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.seenEvents = 0;
    this.boatNumber = -1;
    this.riders = [];               // Tiere im Boot
    this.falling = [];              // Tiere, die gerade ins Wasser fliegen
    this.tilt = 0;
    this.leaving = null;
    this.arriveAt = 0;
    this.labelY = 0.78;
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
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
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
    boot.userData = { mast, segel };
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

  shot() {
    return {
      // Steiler als zuerst (0.26): flach von der Seite lag das Boot als
      // schmaler Streifen im Bild, darunter nur Wasser. Von etwas oben sieht
      // man, wo die Passagiere sitzen — und genau darum geht es.
      look: [0.3, 1.3, -0.6],
      frame: { w: 6.4, h: 3.8 },
      pitch: 0.4,
      yaw: -0.18,
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
      this.sendInput({ action: "drop" }).catch(() => {});
    };
    this.on(this.dropButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.boat;
    if (!state) return;
    const elapsed = now - minigame.startedAt;
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
      const kin = this.kins.get(last.playerId);
      if (last.kind === "place") {
        this.syncRiders(state.passengers);
        const tier = this.riders[this.riders.length - 1];
        if (tier) this.burst(this.boat.localToWorld(tier.userData.spot ? new THREE.Vector3(tier.userData.spot.x, tier.userData.spot.y + 0.3, 0) : new THREE.Vector3()), ["#ffffff", "#bfe6ff"], { count: 6, speed: 1, up: 1, size: 0.05, life: 0.4 });
        if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), `+${last.points}`, { color: last.points >= 6 ? "#ffe36b" : "#ffffff", size: 0.4 });
        if (isOwn) {
          this.feedback?.sound(last.points >= 6 ? "perfect" : "pop");
          this.feedback?.vibrate(12);
        }
      } else if (last.kind === "capsize") {
        // Alles fliegt ins Wasser, das Boot schlägt um.
        this.syncRiders(last.passengers);
        this.riders.forEach((tier) => {
          const world = tier.getWorldPosition(new THREE.Vector3());
          this.boat.remove(tier);
          tier.position.copy(world);
          this.scene.add(tier);
          this.falling.push({ tier, at: nowP, vx: (Math.random() - 0.5) * 2 + last.side * 1.5, vy: 2.5 + Math.random(), vz: (Math.random() - 0.5) * 1.5 });
        });
        this.riders = [];
        this.leaving = { kind: "capsize", at: nowP, side: last.side || 1 };
        this.burst(new THREE.Vector3(last.side * 1.5, 0.3, -0.9), ["#ffffff", "#bfe6ff", "#35c3d6"], { count: 30, speed: 3, up: 3, size: 0.1, life: 1 });
        if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "PLATSCH! −10", { color: "#bfe6ff", size: 0.4, life: 1.3 });
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
          if (k) this.pop(k.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "+2 ⛵", { color: "#b8ffb0", size: 0.34 });
          this.animators.get(id)?.trigger("wave");
        });
        this.feedback?.sound("win");
      }
    }
    // Ein altes Boot verschwindet, ein neues kommt von links.
    if (this.leaving) {
      const u = (nowP - this.leaving.at) / 1400;
      if (this.leaving.kind === "capsize") {
        this.boat.rotation.z = Math.min(1, u * 2.2) * 1.9 * -this.leaving.side;
        this.boat.position.y = BOAT_Y - Math.max(0, u - 0.4) * 0.8;
      } else {
        this.boat.position.x = u * u * 9;
        this.riders.forEach((tier, i) => { tier.rotation.y = Math.sin(nowP / 150 + i) * 0.4; });
      }
      if (u >= 1) {
        this.leaving = null;
        this.riders.forEach((tier) => this.boat.remove(tier));
        this.riders = [];
        this.boat.userData.mast.visible = false;
        this.boat.userData.segel.visible = false;
        this.boat.rotation.z = 0;
        this.boat.position.set(-9, BOAT_Y, -0.9);
        this.arriveAt = nowP;
      }
    } else if (this.boat.position.x < -0.001) {
      this.boat.position.x += (0 - this.boat.position.x) * frameLerp(0.08, dt);
      if (this.boat.position.x > -0.01) this.boat.position.x = 0;
    }
    if (!this.leaving) this.syncRiders(state.passengers);

    // Neigung: folgt dem Drehmoment, dazu ein leichtes Schaukeln.
    const target = this.leaving ? this.tilt : Math.max(-0.42, Math.min(0.42, -(state.torque / state.torqueMax) * 0.38));
    this.tilt += (target - this.tilt) * frameLerp(0.1, dt);
    if (!this.leaving || this.leaving.kind !== "capsize") {
      this.boat.rotation.z = this.tilt + Math.sin(now / 700) * WOBBLE * 0.4;
      this.boat.position.y = BOAT_Y + Math.sin(now / 900) * 0.03;
    }
    this.riders.forEach((tier) => {
      const spot = tier.userData.spot;
      if (spot) tier.position.y += (spot.y - tier.position.y) * frameLerp(0.3, dt);
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
        fall.tier.rotation.x += dt * 5;
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
    const active = turn && elapsed >= turn.from && !f.finale;
    if (active) {
      const x = swingX(turn, elapsed, state.reach);
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
      this.hanging.position.set(x, HOOK_Y - 0.75, -0.9);
      this.hanging.rotation.z = Math.sin(now / 160) * 0.1;
      // Wo würde er landen? Ein Schatten auf dem Boot zeigt es.
    } else if (this.hanging) {
      this.hanging.visible = false;
    }
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
    const pulled = state.last && elapsed - state.last.at < 400;
    this.lever.rotation.x = pulled ? 0.6 : 0;
    this.leverKnob.position.z = -2.25 + (pulled ? 0.18 : 0);
    this.leverKnob.position.y = pulled ? 1.35 : 1.42;
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
    const turn = state.turn;
    const ownTurn = Boolean(turn && turn.playerId === controlledId && elapsed >= turn.from);
    const banner = this.hud.querySelector("[data-boat-banner]");
    let message = null;
    let tone = "#12aaff";
    const last = state.last;
    if (elapsed < state.leadMs) message = "Gleich kommt der erste Passagier …";
    else if (last && elapsed - last.at < 1400 && last.kind === "capsize") {
      const who = room.players.find((p) => p.id === last.playerId);
      message = last.playerId === controlledId ? "Gekentert! −10" : `${escapeName(who?.name)} hat's gekippt!`;
      tone = "#ff5d73";
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

function animalName(kind) {
  return { kueken: "Küken", pinguin: "Pinguin", schaf: "Schaf", schwein: "Schwein" }[kind] || "Passagier";
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
