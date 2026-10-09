import * as THREE from "/vendor/three/three.module.js";
import { dressMeadow } from "./SceneKit.js?v=tumblekin214";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin214";
import { frameLerp } from "./Quality.js?v=tumblekin214";
import { kiste, lambert, viele, streuer, zaun, sonnenblumen, himmel, wolken } from "./Kulisse.js?v=tumblekin214";

// Honigwabe — Mutprobe am Bienenbaum. Vom Ast hängt eine Ranke voller
// geschlossener Knospen, alle stehen gemeinsam darunter, und vor jedem Griff
// entscheidet jeder gleichzeitig und geheim: WEITER pflücken oder HEIM. Dann
// geht die unterste Knospe auf: Äpfel werden unter allen am Baum geteilt (der
// Rest fällt in den Restkorb an der Ranke), ein goldener Apfel bleibt dort,
// bis einer allein heimgeht, und ein Nest weckt seine Sorte — oben am Ast
// summt es dann. Das zweite Nest derselben Sorte, und der Schwarm sticht alle,
// die noch am Baum sind: Korb leer. Wer heimgeht, kippt seinen Korb in die
// eigene Kiste vorn und teilt sich mit den anderen Heimgehern den Restkorb.
//
// Jede Figur hat ihre eigene Gasse: oben am Baum, unten bei ihrer Kiste. So
// verdeckt niemand den anderen, egal wer wo steht.
const VINE_X = 0;
const VINE_Z = 0.15;
const BRANCH_Y = 4.3;
const BUD_BOTTOM = 2.4;          // die nächste Knospe hängt immer hier
const BUD_GAP = 0.3;
const MAX_BUDS = 6;              // so viele Knospen sind zu sehen, der Rest steckt im Laub
const REST_Y = 1.88;             // Restkorb unter der Ranke
const LANE = 0.66;
const TREE_Z = 0.85;
const HOME_Z = 2.4;
const NEST_SLOTS = { bee: [-0.72, 0], wasp: [0.62, 0], hornet: [1.12, 0] };
const NEST_LOOK = {
  bee: { color: "#f0a91c", stripe: "#7a4a06", name: "Bienen", short: "B" },
  wasp: { color: "#c9c2b0", stripe: "#3a3630", name: "Wespen", short: "W" },
  hornet: { color: "#b8481e", stripe: "#3a1606", name: "Hornissen", short: "H" }
};
const FLY_MS = 560;
const SLEEP_GREY = new THREE.Color("#8d8a80");
const DUSK_WARN_MS = 12000;

export class HoneyVine extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lanes = new Map();       // playerId → { tree, home }
    this.baskets = new Map();     // playerId → { group, pile, shown }
    this.crates = new Map();      // playerId → { group, pile, shown }
    this.buds = [];
    this.flying = [];
    this.nests = new Map();       // Sorte → { group, awake }
    this.bees = [];
    this.chase = new Map();       // playerId → bis wann die Bienen jagen
    this.thinks = new Map();      // playerId → Schild „?“/„✓“
    this.vineNumber = null;
    this.seenPicks = 0;
    this.choice = null;           // { step, action } — die eigene Wahl
    this.roundTrip = 0;
    this.measured = false;
    this.lastPingAt = 0;
    this.labelY = 0.78;
    this.restShown = "";
  }

  stage() {
    return {
      label: "3D Honigwabe",
      background: "#ffd9a8",
      fog: ["#ffe2bd", 22, 55],
      lights: { sunPosition: [-9, 7, 6], sunColor: 0xffd49a, sunIntensity: 3.2, hemiIntensity: 1.9, skyColor: 0xffe8c8, groundColor: 0x6a9a50, shadow: { left: -6, right: 6, top: 7, bottom: -3 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips" data-honey-chips></div>
      <div class="color-banner honey-banner" data-honey-banner hidden></div>
      <div class="honey-timer" data-honey-timer hidden><i></i></div>`;
  }

  build() {
    const scene = this.scene;
    this.sky = himmel(scene, { oben: "#6fa8e0", unten: "#ffcf96" });
    this.buildGarden(scene);
    this.buildTree(scene);

    const players = this.getState()?.players || [];
    const n = Math.max(1, players.length);
    players.forEach((player, index) => {
      const x = (index - (n - 1) / 2) * LANE;
      const tree = new THREE.Vector3(x, 0, TREE_Z + Math.abs(x) * 0.12);
      const home = new THREE.Vector3(x * 1.3, 0, HOME_Z);
      this.lanes.set(player.id, { tree, home });
      this.addKin(player, index, { x: tree.x, ground: 0, z: tree.z, facing: Math.PI });
      // Der Korb in der Hand — er wandert mit der Figur.
      const korb = this.makeBasket(0.16);
      scene.add(korb.group);
      this.baskets.set(player.id, korb);
      // Die Kiste daheim: hier liegt, was zählt.
      const kiste_ = new THREE.Group();
      kiste(kiste_, 0.5, 0.26, 0.34, "#b98a55", [0, 0.13, 0]);
      kiste(kiste_, 0.54, 0.05, 0.38, "#8a6238", [0, 0.27, 0], { schatten: false });
      const band = kiste(kiste_, 0.52, 0.06, 0.02, player.color, [0, 0.16, 0.175], { schatten: false });
      band.material = lambert(player.color);
      const pile = new THREE.Group();
      kiste_.add(pile);
      kiste_.position.set(home.x, 0, home.z + 0.38);
      scene.add(kiste_);
      this.crates.set(player.id, { group: kiste_, pile, shown: -1 });
      // Denkblase über dem Kopf: „?“ solange gewählt wird, „✓“ wenn gewählt.
      const think = this.makeBubble(player.color);
      think.sprite.visible = false;
      scene.add(think.sprite);
      this.thinks.set(player.id, think);
    });

    // Bienen: ein fester Satz, der um wache Nester kreist oder jemanden jagt.
    for (let i = 0; i < 24; i += 1) {
      const biene = new THREE.Group();
      kiste(biene, 0.07, 0.06, 0.09, "#ffc62e", [0, 0, 0], { schatten: false });
      kiste(biene, 0.072, 0.062, 0.025, "#2a2230", [0, 0, 0.01], { schatten: false });
      const f = kiste(biene, 0.1, 0.01, 0.05, "#ffffff", [0, 0.04, 0], { schatten: false });
      f.material = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7 });
      biene.userData = { phase: i * 0.77, wing: f, isFx: true };
      biene.visible = false;
      scene.add(biene);
      this.bees.push(biene);
    }
  }

  // Denkblase: ein runder Knopf mit „?“ oder „✓“ in der Spielerfarbe.
  makeBubble(color) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.renderOrder = 6;
    sprite.scale.set(0.3, 0.3, 1);
    const bubble = { sprite, canvas, texture, color, text: null };
    this.paintBubble(bubble, "?");
    return bubble;
  }

  paintBubble(bubble, text) {
    bubble.text = text;
    const ctx = bubble.canvas.getContext("2d");
    ctx.clearRect(0, 0, 128, 128);
    ctx.beginPath();
    ctx.arc(64, 64, 54, 0, Math.PI * 2);
    ctx.fillStyle = text === "✓" ? "#1fbf5b" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = bubble.color;
    ctx.stroke();
    ctx.fillStyle = text === "✓" ? "#ffffff" : "#2a2230";
    ctx.font = "1000 78px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 70);
    bubble.texture.needsUpdate = true;
  }

  makeBasket(r) {
    const group = new THREE.Group();
    const koerper = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.75, r * 1.1, 8, 1, true), lambert("#b98a55", { side: THREE.DoubleSide }));
    koerper.position.y = r * 0.55;
    koerper.castShadow = true;
    group.add(koerper);
    kiste(group, r * 1.5, 0.02, r * 1.5, "#8a6238", [0, 0.01, 0], { schatten: false });
    const henkel = new THREE.Mesh(new THREE.TorusGeometry(r * 0.85, 0.015, 5, 10, Math.PI), lambert("#8a6238"));
    henkel.position.y = r * 1.1;
    group.add(henkel);
    const pile = new THREE.Group();
    group.add(pile);
    return { group, pile, shown: -1, r };
  }

  // Äpfel in einem Korb oder einer Kiste anhäufen (bis `cap` sichtbar).
  fillPile(pile, count, { cap, r, y, gold = 0, w = null }) {
    pile.clear();
    const shown = Math.min(cap, count);
    for (let i = 0; i < shown; i += 1) {
      const golden = i < gold;
      const apfel = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshLambertMaterial({ color: golden ? "#ffe02e" : "#e0343c", emissive: golden ? "#fff09a" : "#000000", emissiveIntensity: golden ? 0.35 : 0 }));
      if (w) {
        const perRow = Math.max(1, Math.floor(w / (r * 2.1)));
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        apfel.position.set((col - (Math.min(perRow, shown) - 1) / 2) * r * 2.1, y + row * r * 1.6, ((row % 2) - 0.5) * r * 0.8);
      } else {
        const a = i * 2.4;
        const rr = i === 0 ? 0 : r * 1.2;
        apfel.position.set(Math.cos(a) * rr, y + Math.floor(i / 4) * r * 1.1, Math.sin(a) * rr);
      }
      pile.add(apfel);
    }
  }
  buildGarden(scene) {
    kiste(scene, 70, 0.5, 60, "#74ad62", [0, -0.25, 0], { schatten: false });
    dressMeadow(scene, {
      seed: 44,
      keepOut: { x: 3.2, z: 2.6 },
      spread: { x: 18, z: 15 },
      trees: 20,
      treeRing: { x: 17, z: 14 },
      grassColor: "#5fa94c",
      patchColors: ["#7db064", "#94bd78"],
      crownShape: "blob",
      crownColor: "#5a9e45",
      crownColor2: "#8fbf4a",
      flowerColors: ["#b98cff", "#ffffff", "#ffd15c", "#ff8fb1"],
      flowers: 70
    });
    // Lavendelreihen hinten links und rechts.
    const zufall = streuer(9);
    const lavendel = [];
    const busch = [];
    for (let reihe = 0; reihe < 4; reihe += 1) {
      for (let i = 0; i < 9; i += 1) {
        [-1, 1].forEach((seite) => {
          const x = seite * (3.6 + i * 0.62);
          const z = -2.6 - reihe * 1.05;
          busch.push({ p: [x, 0.16, z], s: [0.5, 0.32, 0.5] });
          for (let k = 0; k < 3; k += 1) lavendel.push({ p: [x + (zufall() - 0.5) * 0.4, 0.42 + zufall() * 0.12, z + (zufall() - 0.5) * 0.3], s: [1, 1 + zufall() * 0.5, 1] });
        });
      }
    }
    viele(scene, new THREE.DodecahedronGeometry(0.5, 0), lambert("#5f8f4e"), busch, { schatten: true });
    viele(scene, new THREE.BoxGeometry(0.07, 0.3, 0.07), lambert("#9b6be0"), lavendel);
    // Bienenstöcke: weisse Kästen mit Dach und Flugloch.
    [[-3.3, -1.4, 0.3], [-4.1, -1.9, 0.1], [3.4, -1.5, -0.3]].forEach(([x, z, dreh]) => {
      const stock = new THREE.Group();
      kiste(stock, 0.62, 0.12, 0.62, "#8a6238", [0, 0.06, 0]);
      kiste(stock, 0.56, 0.34, 0.56, "#fbf6ea", [0, 0.29, 0]);
      kiste(stock, 0.56, 0.34, 0.56, "#f1e8d2", [0, 0.64, 0]);
      kiste(stock, 0.66, 0.08, 0.66, "#c8413b", [0, 0.85, 0]);
      kiste(stock, 0.2, 0.05, 0.02, "#2a2230", [0, 0.18, 0.285], { schatten: false });
      stock.position.set(x, 0, z);
      stock.rotation.y = dreh;
      scene.add(stock);
    });
    zaun(scene, [-8, -3.2], [-5.2, -3.2], { color: "#d9c3a0", pfostenColor: "#b98a55" });
    zaun(scene, [5.2, -3.2], [8, -3.2], { color: "#d9c3a0", pfostenColor: "#b98a55" });
    sonnenblumen(scene, [[-2.6, -2.8, 1.3], [-2.1, -3.1, 1.1], [2.4, -2.9, 1.2], [2.9, -3.2, 1.4]]);
    // Vorn: Honigtöpfe auf einem Brett und ein paar Pusteblumen.
    kiste(scene, 1.2, 0.08, 0.4, "#b98a55", [-2.4, 0.3, 2.6]);
    [[-2.1, 0.08], [-2.3, 0.09], [-2.55, 0.08]].forEach(([dx]) => kiste(scene, 0.06, 0.3, 0.06, "#8a6238", [dx - 0.3, 0.15, 2.6]));
    [-2.8, -2.45, -2.1].forEach((x, i) => {
      const topf = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.2, 10), lambert(i === 1 ? "#ffb52e" : "#f59e1b"));
      topf.position.set(x, 0.44, 2.6);
      topf.castShadow = true;
      scene.add(topf);
      kiste(scene, 0.24, 0.04, 0.24, "#e84c4c", [x, 0.56, 2.6], { schatten: false });
    });
    const puste = [];
    for (let i = 0; i < 12; i += 1) puste.push({ p: [1.4 + zufall() * 2.4, 0.22 + zufall() * 0.08, 2.2 + zufall() * 1.6] });
    viele(scene, new THREE.SphereGeometry(0.06, 6, 5), lambert("#ffffff"), puste);
    viele(scene, new THREE.BoxGeometry(0.015, 0.22, 0.015), lambert("#6aa84f"), puste.map((p) => ({ p: [p.p[0], 0.1, p.p[2]] })));
    wolken(scene, [[-9, 8, -18, 1.8], [7, 9.5, -22, 2.2], [14, 7.5, -16, 1.4]], { color: "#ffe9d6" });
    // Vorn rechts ein Baumstumpf mit Imkerhut und Smoker, links Blumenkübel.
    const stumpf = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.4, 10), lambert("#8a6238"));
    stumpf.position.set(2.3, 0.2, 2.9);
    stumpf.castShadow = true;
    scene.add(stumpf);
    const ringe = new THREE.Mesh(new THREE.CircleGeometry(0.33, 10), lambert("#d9b98a"));
    ringe.rotation.x = -Math.PI / 2;
    ringe.position.set(2.3, 0.401, 2.9);
    scene.add(ringe);
    const hut = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 14), lambert("#f4ecd8"));
    hut.position.set(2.2, 0.42, 2.85);
    scene.add(hut);
    const krone = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.14, 12), lambert("#f4ecd8"));
    krone.position.set(2.2, 0.5, 2.85);
    scene.add(krone);
    const smoker = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), lambert("#b8c0c8"));
    smoker.position.set(2.48, 0.51, 3.0);
    scene.add(smoker);
    this.smoke = smoker;
    [[-2.5, 3.0, "#ff8fb1"], [-2.1, 3.5, "#ffd15c"]].forEach(([x, z, farbe]) => {
      const kuebel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.28, 10), lambert("#c8703b"));
      kuebel.position.set(x, 0.14, z);
      kuebel.castShadow = true;
      scene.add(kuebel);
      viele(scene, new THREE.SphereGeometry(0.07, 6, 5), lambert(farbe), [[0, 0], [0.08, 0.05], [-0.07, 0.06], [0.03, -0.08], [-0.05, -0.06]].map(([dx, dz]) => ({ p: [x + dx, 0.36, z + dz] })));
    });
  }

  buildTree(scene) {
    const rinde = lambert("#6b4a2e");
    const stamm = new THREE.Mesh(new THREE.BoxGeometry(0.75, BRANCH_Y + 0.6, 0.75), rinde);
    stamm.position.set(-1.45, (BRANCH_Y + 0.6) / 2, -1.2);
    stamm.castShadow = true;
    scene.add(stamm);
    [[-1.9, -1.2, 0.5], [-1.05, -1.0, -0.4], [-1.5, -0.75, 1.4]].forEach(([x, z, dreh]) => {
      const wurzel = kiste(scene, 0.25, 0.22, 0.7, "#6b4a2e", [x, 0.08, z]);
      wurzel.rotation.y = dreh;
    });
    // Der Ast quer über die Szene: links die Ranke, rechts die Nester.
    const ast = kiste(scene, 3.0, 0.28, 0.3, "#6b4a2e", [-0.1, BRANCH_Y, -0.1]);
    ast.rotation.z = 0.04;
    kiste(scene, 0.75, 0.26, 0.5, "#6b4a2e", [-1.2, BRANCH_Y + 0.05, -0.6]);
    const kronen = [[-1.4, 6.1, -1.4, 1.8], [0.2, 5.8, -1.0, 1.4], [-2.6, 5.6, -0.8, 1.3], [-0.7, 6.9, -1.8, 1.4], [1.2, 6.4, -1.6, 1.2], [-2.1, 6.7, -2.2, 1.2]];
    viele(scene, new THREE.DodecahedronGeometry(1, 0), lambert("#4f8f3e"), kronen.filter((_, i) => i % 2 === 0).map(([x, y, z, s]) => ({ p: [x, y, z], s, r: [0, x, 0] })), { schatten: true });
    viele(scene, new THREE.DodecahedronGeometry(1, 0), lambert("#6aa84f"), kronen.filter((_, i) => i % 2 === 1).map(([x, y, z, s]) => ({ p: [x, y, z], s, r: [0, x, 0] })), { schatten: true });
    // Die Ranke: ein Stängel vom Ast bis zum Restkorb.
    const stiel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, BRANCH_Y - REST_Y, 6), lambert("#4f8f3e"));
    stiel.position.set(VINE_X, (BRANCH_Y + REST_Y) / 2, VINE_Z - 0.03);
    stiel.castShadow = true;
    scene.add(stiel);
    // Der Restkorb unter der Ranke: was beim Teilen nicht aufgeht.
    const rest = this.makeBasket(0.22);
    rest.group.position.set(VINE_X, REST_Y - 0.24, VINE_Z);
    [-1, 1].forEach((seite) => {
      const schnur = kiste(rest.group, 0.015, 0.36, 0.015, "#8a6238", [seite * 0.17, 0.4, 0], { schatten: false });
      schnur.rotation.z = seite * -0.35;
    });
    scene.add(rest.group);
    this.rest = rest;
    // Nester am Ast: jede Sorte hat ihren Platz. Schlafend klein und blass,
    // wach gross, bunt und umschwirrt.
    Object.entries(NEST_SLOTS).forEach(([sorte, [x]]) => {
      const nest = this.makeNest(sorte);
      nest.position.set(x, BRANCH_Y - 0.36, VINE_Z);
      scene.add(nest);
      this.nests.set(sorte, { group: nest, awake: false, wake: 0 });
    });
  }

  makeNest(sorte) {
    const look = NEST_LOOK[sorte];
    const g = new THREE.Group();
    const faden = kiste(g, 0.02, 0.18, 0.02, "#6b4a2e", [0, 0.2, 0], { schatten: false });
    faden.castShadow = false;
    if (sorte === "bee") {
      // Bienenwabe: Bernstein-Sechseck mit dunklen Zellen.
      const wabe = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 6), new THREE.MeshLambertMaterial({ color: look.color }));
      wabe.rotation.x = Math.PI / 2;
      wabe.rotation.y = Math.PI / 6;
      g.add(wabe);
      [[0, 0], [0.09, 0.05], [-0.09, 0.05], [0.09, -0.05], [-0.09, -0.05], [0, 0.1], [0, -0.1]].forEach(([x, y]) => {
        const zelle = new THREE.Mesh(new THREE.CircleGeometry(0.045, 6), lambert(look.stripe));
        zelle.position.set(x, y, 0.072);
        g.add(zelle);
      });
    } else {
      // Wespen- und Hornissennest: Papierkugel mit Ringen und Flugloch.
      const kugel = new THREE.Mesh(new THREE.IcosahedronGeometry(sorte === "hornet" ? 0.23 : 0.2, 0), new THREE.MeshLambertMaterial({ color: look.color }));
      kugel.scale.y = 1.15;
      g.add(kugel);
      [-0.08, 0.02, 0.12].forEach((y) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(sorte === "hornet" ? 0.2 : 0.175, 0.018, 4, 8), lambert(look.stripe));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        g.add(ring);
      });
      const loch = new THREE.Mesh(new THREE.CircleGeometry(0.05, 6), lambert("#1a1410"));
      loch.position.set(0, -0.14, 0.17);
      g.add(loch);
    }
    // Eigene Materialien: schlafend wird die Farbe blass, wach wieder voll.
    g.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.material = child.material.clone();
      child.userData.baseColor = child.material.color.getHex();
    });
    g.userData.sorte = sorte;
    return g;
  }

  makeBud() {
    const g = new THREE.Group();
    // Geschlossene Knospe: zwei grüne Blätter um einen Kern — was drin ist,
    // weiss keiner.
    const kern = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), lambert("#5fae4a"));
    kern.scale.set(1, 1.3, 1);
    kern.castShadow = true;
    g.add(kern);
    [-1, 1].forEach((seite) => {
      const blatt = kiste(g, 0.1, 0.22, 0.04, "#3f8f36", [seite * 0.07, 0.02, 0.05], { schatten: false });
      blatt.rotation.z = seite * 0.35;
    });
    this.scene.add(g);
    return g;
  }

  // Was in einer offenen Knospe steckt, als kleines Bild zum Fliegen.
  makeContent(bud) {
    if (bud.kind === "nest") {
      const nest = this.makeNest(bud.nest);
      this.scene.add(nest);
      return nest;
    }
    const g = new THREE.Group();
    const gold = bud.kind === "gold";
    const count = gold ? 1 : bud.value;
    for (let i = 0; i < count; i += 1) {
      const a = (i / Math.max(1, count)) * Math.PI * 2;
      const r = count === 1 ? 0 : 0.12 + count * 0.008;
      const apfel = new THREE.Mesh(new THREE.SphereGeometry(gold ? 0.15 : 0.085, 10, 8), new THREE.MeshLambertMaterial({ color: gold ? "#ffe02e" : "#e0343c", emissive: gold ? "#fff09a" : "#000000", emissiveIntensity: gold ? 0.4 : 0 }));
      apfel.position.set(Math.cos(a) * r, Math.sin(a) * r * 0.8, 0.05);
      apfel.castShadow = true;
      g.add(apfel);
    }
    this.scene.add(g);
    return g;
  }

  rebuildBuds(count) {
    this.buds.forEach((bud) => this.scene.remove(bud));
    this.buds = Array.from({ length: Math.min(MAX_BUDS, count) }, (_, i) => {
      const bud = this.makeBud();
      bud.position.set(VINE_X, BUD_BOTTOM + i * BUD_GAP, VINE_Z + 0.02);
      return bud;
    });
  }

  shot() {
    return {
      look: [0, 1.95, 1.2],
      frame: { w: 3.4, h: 4.5 },
      pitch: 0.24,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.28, zoom: 1.4 },
      finale: { pull: 0.8, zoom: 0.7, lift: 0.3, orbit: 0.14 }
    };
  }

  keepInView() {
    // Alle Gassen stehen ohnehin im Bild; die Ranke ist das Wichtigste.
    return [];
  }

  // Oben stehen Stand, Nest-Anzeige und Ansage, unten die Knöpfe: das Bild
  // bekommt den Streifen dazwischen, sonst hingen die Nester hinter der Ansage.
  rigOptions() {
    const r = this.webglCanvas.getBoundingClientRect();
    const chips = this.hud.querySelector("[data-honey-chips]")?.getBoundingClientRect();
    const bar = this.hud.querySelector(".kinetic-scorebar")?.getBoundingClientRect();
    const buttons = this.controls.querySelector(".honey-controls")?.getBoundingClientRect();
    const wide = r.width > r.height && r.height <= 520;
    const top = Math.max(bar ? bar.bottom - r.top : 0, chips && chips.height ? chips.bottom - r.top : 0) + 62;
    // Im Querformat stehen die Knöpfe links und rechts: dann sind es die
    // Seiten, die frei bleiben müssen, nicht der untere Rand.
    const stay = this.controls.querySelector(".honey-stay")?.getBoundingClientRect();
    const home = this.controls.querySelector(".honey-home")?.getBoundingClientRect();
    const insets = wide && stay && home && stay.width
      ? { top: Math.round(top), bottom: 4, left: Math.round(stay.right - r.left + 10), right: Math.round(r.right - home.left + 10) }
      : { top: Math.round(top), bottom: Math.round(buttons && buttons.height ? r.bottom - buttons.top + 8 : 0), left: 0, right: 0 };
    const old = this.rig.base.insets;
    if (!old || Object.keys(insets).some((key) => insets[key] !== old[key])) this.rig.band = null;
    this.rig.base.insets = insets;
    // Quer zählt die Höhe: Blick etwas tiefer und näher an die Kisten, die
    // vorn sonst unten aus dem Bild ragten.
    return wide ? { look: [0, 1.7, 1.75], frame: { w: 3.4, h: 4.5 } } : null;
  }

  bind() {
    this.controls.innerHTML = `
      <div class="runner-lane-controls barrel-run-controls honey-controls">
        <button type="button" class="honey-stay" data-honey-choice="stay"><span>🍎</span><small>weiter</small></button>
        <button type="button" class="honey-home" data-honey-choice="home"><span>🏠</span><small>heim</small></button>
      </div>`;
    this.controls.querySelectorAll("[data-honey-choice]").forEach((button) => {
      this.on(button, "pointerdown", (event) => {
        event.preventDefault();
        if (button.disabled) return;
        this.choose(button.dataset.honeyChoice);
      });
    });
  }

  // Die eigene Wahl: sofort auf den Knöpfen zeigen, an den Server schicken.
  // Bis zum Ende der Wahl darf man umentscheiden.
  choose(action) {
    const minigame = this.update || this.minigame;
    const state = minigame?.arcade?.honey;
    const id = this.getControlledPlayerId();
    if (!state || !this.canChoose(minigame, state, id)) return;
    this.choice = { step: state.step.number, action };
    this.feedback?.vibrate(10);
    this.feedback?.sound(action === "home" ? "whoosh" : "select");
    const sentAt = performance.now();
    this.sendInput({ action }).then(() => this.noteRoundTrip(performance.now() - sentAt)).catch(() => {});
  }

  // Kann ich jetzt wählen — gemessen daran, wann ein Druck beim Server ankäme?
  canChoose(minigame, state, id) {
    const step = state.step;
    const entry = minigame?.arcade?.players?.[id];
    if (!step || step.closed || !entry || entry.at !== "tree" || minigame.finaleAt) return false;
    const arrival = this.now() + this.roundTrip - minigame.startedAt;
    return arrival >= step.from && arrival <= step.until + (state.graceMs ?? 150);
  }

  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.measured ? this.roundTrip * 0.7 + clamped * 0.3 : clamped;
    this.measured = true;
  }

  pingIfIdle(minigame) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.lastPingAt < (this.measured ? 1000 : 300)) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  fly(item, from, to, { delay = 0, arc = 0.6, done = null, shrink = 0.3 } = {}) {
    item.position.copy(from);
    this.flying.push({ item, from: from.clone(), to: to.clone(), at: performance.now() + delay, arc, done, shrink });
  }

  // Eine Auflösung im Bild: wer heimgeht, die offene Knospe, Teilen, Stich.
  showReveal(last, controlledId) {
    const isOwnLeaver = last.leavers.includes(controlledId);
    last.leavers.forEach((id) => {
      const kin = this.kins.get(id);
      const gained = last.banked?.[id] ?? 0;
      if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), gained ? `HEIM! +${gained}` : "HEIM!", { color: last.goldTo === id ? "#ffe36b" : "#b8ffb0", size: 0.36, life: 1.3 });
      this.animators.get(id)?.trigger("hop");
    });
    if (last.goldTo) {
      const lane = this.lanes.get(last.goldTo);
      for (let i = 0; i < (last.goldCount || 1); i += 1) {
        const gold = this.makeContent({ kind: "gold" });
        this.fly(gold, this.rest.group.position.clone().add(new THREE.Vector3(0, 0.25, 0)), lane.home.clone().add(new THREE.Vector3(0, 0.5, 0.38)), { delay: i * 120, arc: 1.2, done: () => this.scene.remove(gold) });
      }
      if (last.goldTo === controlledId) this.feedback?.sound("sparkle");
    }
    if (isOwnLeaver) {
      this.feedback?.sound("coin");
      this.feedback?.vibrate(14);
    }
    const bud = last.bud;
    if (!bud) return;
    // Die unterste Knospe platzt auf.
    const at = new THREE.Vector3(VINE_X, BUD_BOTTOM, VINE_Z + 0.08);
    const opened = this.buds.shift();
    if (opened) this.scene.remove(opened);
    this.burst(at, ["#5fae4a", "#3f8f36", "#9fd67a"], { count: 10, speed: 1.2, up: 0.8, size: 0.05, life: 0.5 });
    const content = this.makeContent(bud);
    content.position.copy(at);
    if (bud.kind === "fruit") {
      // Jeder am Baum bekommt seinen Teil in den Korb, der Rest fällt in den Restkorb.
      const share = last.share || 0;
      last.stayers.forEach((id, k) => {
        const korb = this.baskets.get(id);
        const kin = this.kins.get(id);
        if (!korb || !share) return;
        for (let i = 0; i < Math.min(share, 4); i += 1) {
          const apfel = this.makeContent({ kind: "fruit", value: 1 });
          this.fly(apfel, at, korb.group.position.clone().add(new THREE.Vector3(0, 0.25, 0)), { delay: 120 + k * 60 + i * 70, done: () => this.scene.remove(apfel) });
        }
        if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.15, 0)), `+${share}`, { color: "#ffffff", size: 0.32, life: 1 });
      });
      const rest = bud.value - share * last.stayers.length;
      for (let i = 0; i < rest; i += 1) {
        const apfel = this.makeContent({ kind: "fruit", value: 1 });
        this.fly(apfel, at, this.rest.group.position.clone().add(new THREE.Vector3(0, 0.25, 0)), { delay: 160 + i * 80, arc: 0.2, done: () => this.scene.remove(apfel) });
      }
      this.scene.remove(content);
      if (last.stayers.includes(controlledId)) this.feedback?.sound("coin");
    } else if (bud.kind === "gold") {
      this.fly(content, at, this.rest.group.position.clone().add(new THREE.Vector3(0, 0.3, 0)), { delay: 150, arc: 0.3, shrink: 0, done: () => this.scene.remove(content) });
      this.pop(at.clone().add(new THREE.Vector3(0.5, 0.2, 0.3)), "GOLD!", { color: "#ffe36b", size: 0.4, life: 1.2 });
      this.feedback?.sound("sparkle");
    } else {
      const nest = this.nests.get(bud.nest);
      const look = NEST_LOOK[bud.nest];
      if (last.bust) {
        // Das zweite Nest: der Schwarm bricht los.
        this.burst(at, [look.color, "#2a2230", "#ffc62e"], { count: 26, speed: 2.4, up: 1.6, size: 0.08, life: 1 });
        this.scene.remove(content);
        const until = performance.now() + 2600;
        last.stung.forEach((id) => {
          this.chase.set(id, until);
          const kin = this.kins.get(id);
          const korb = this.baskets.get(id);
          if (korb) this.burst(korb.group.position.clone().add(new THREE.Vector3(0, 0.2, 0)), ["#e0343c", "#e0343c", "#ffcf33"], { count: 10, speed: 1.6, up: 1.8, size: 0.07, life: 0.9 });
          if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.25, 0)), "AUA!", { color: "#ffb3bd", size: 0.42, life: 1.4 });
          const animator = this.animators.get(id);
          animator?.trigger("flinch");
          animator?.expression("scared", 2400);
        });
        if (last.stung.includes(controlledId)) {
          this.feedback?.sound("fall");
          this.feedback?.vibrate([40, 30, 40, 30, 60]);
          this.rig.shake(0.55);
        } else {
          this.feedback?.sound("pop");
        }
        if (nest) nest.wake = performance.now();
      } else {
        // Das erste Nest seiner Sorte fliegt an seinen Platz am Ast und wacht auf.
        nest.pendingUntil = performance.now() + 100 + FLY_MS;
        this.fly(content, at, nest.group.position, { delay: 100, arc: 0.4, shrink: 0, done: () => { this.scene.remove(content); nest.wake = performance.now(); } });
        this.pop(at.clone().add(new THREE.Vector3(0.6, 0.1, 0.3)), `${look.name} wach!`, { color: "#ffd08a", size: 0.34, life: 1.4 });
        this.feedback?.sound("whoosh");
      }
    }
  }
  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.honey;
    if (!state) return;
    const elapsed = now - minigame.startedAt;
    const nowP = performance.now();
    this.pingIfIdle(minigame);

    // Neue Ranke: Knospen wachsen nach, Nester schlafen, der Restkorb ist leer.
    if (this.vineNumber !== state.vineNumber) {
      const first = this.vineNumber === null;
      this.vineNumber = state.vineNumber;
      this.seenPicks = state.picks;
      this.rebuildBuds(state.vineNumber < 0 ? MAX_BUDS : state.budsLeft);
      this.nests.forEach((nest, sorte) => { nest.pendingUntil = 0; nest.wake = state.awake?.[sorte] ? nowP : 0; });
      if (!first && state.vineNumber > 0) this.pop(new THREE.Vector3(VINE_X + 0.7, BUD_BOTTOM + 0.3, VINE_Z + 0.4), "Neue Ranke!", { color: "#b8ffb0", size: 0.4 });
    }
    // Eine Auflösung kam an.
    if (state.picks > this.seenPicks && state.last) {
      this.seenPicks = state.picks;
      this.showReveal(state.last, controlledId);
    }
    // Knospen: nach dem Aufplatzen rutschen die übrigen nach unten; mehr als
    // der Server noch hat, bleibt keine.
    const wantBuds = Math.min(MAX_BUDS, state.budsLeft);
    while (this.buds.length > wantBuds) this.scene.remove(this.buds.pop());
    const step = state.step;
    const deciding = Boolean(step && !step.closed && elapsed >= step.from);
    this.buds.forEach((bud, i) => {
      const y = BUD_BOTTOM + i * BUD_GAP;
      bud.position.y += (y - bud.position.y) * frameLerp(0.14, dt);
      // Die nächste Knospe zittert, solange gewählt wird.
      const shake = i === 0 && deciding ? Math.sin(now / 45) * 0.12 : Math.sin(now / 700 + i * 0.6) * 0.06;
      bud.rotation.z = shake;
      bud.scale.setScalar(i === 0 && deciding ? 1.12 + Math.sin(now / 160) * 0.05 : 1);
    });

    // Restkorb: übrig gebliebene Äpfel und das hängende Gold.
    const restKey = `${state.leftover}/${state.golds}`;
    if (restKey !== this.restShown) {
      this.restShown = restKey;
      this.fillPile(this.rest.pile, state.leftover + state.golds, { cap: 12, r: 0.06, y: 0.16, gold: state.golds });
    }

    // Nester: schlafend klein und blass, wach gross und umschwirrt.
    this.nests.forEach((nest, sorte) => {
      const awake = Boolean(state.awake?.[sorte]) && nowP >= (nest.pendingUntil || 0);
      nest.awake = awake;
      const s = awake ? 1 + Math.max(0, 1 - (nowP - nest.wake) / 400) * 0.35 : 0.62;
      nest.group.scale.setScalar(nest.group.scale.x + (s - nest.group.scale.x) * frameLerp(0.2, dt));
      nest.group.rotation.z = awake ? Math.sin(now / 90) * 0.08 : 0;
      if (nest.shownAwake !== awake) {
        nest.shownAwake = awake;
        nest.group.traverse((child) => {
          if (!child.isMesh || child.userData.baseColor === undefined) return;
          child.material.color.setHex(child.userData.baseColor);
          if (!awake) child.material.color.lerp(SLEEP_GREY, 0.65);
        });
      }
    });

    // Fliegende Äpfel und Nester.
    this.flying = this.flying.filter((fly) => {
      const u = Math.max(0, Math.min(1, (nowP - fly.at) / FLY_MS));
      fly.item.position.lerpVectors(fly.from, fly.to, u);
      fly.item.position.y += Math.sin(u * Math.PI) * fly.arc;
      fly.item.scale.setScalar(1 - u * fly.shrink);
      if (u >= 1) {
        fly.done?.();
        return false;
      }
      return true;
    });

    // Figuren: am Baum in ihrer Gasse, daheim hinter der eigenen Kiste.
    players.forEach((player) => {
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const lane = this.lanes.get(player.id);
      const entry = arcade.players[player.id];
      if (!kin || !animator || !lane || !entry) return;
      const chasing = nowP < (this.chase.get(player.id) || 0);
      const atTree = entry.at === "tree";
      const target = atTree ? lane.tree : lane.home;
      const dx = target.x - kin.position.x;
      const dz = target.z - kin.position.z;
      const dist = Math.hypot(dx, dz);
      const speed = chasing ? 3.4 : 2.6;
      if (dist > 0.01) {
        const stepLen = Math.min(dist, speed * dt);
        kin.position.x += (dx / dist) * stepLen;
        kin.position.z += (dz / dist) * stepLen;
      }
      const moving = dist > 0.05;
      // Am Baum halb zur Kamera, halb zur Ranke; daheim zur Ranke hin.
      const faceTo = moving ? Math.atan2(dx, dz) : atTree ? Math.atan2(VINE_X - kin.position.x, 2.6 - kin.position.z) : Math.atan2(VINE_X - kin.position.x, VINE_Z - kin.position.z) + Math.PI;
      kin.rotation.y += Math.atan2(Math.sin(faceTo - kin.rotation.y), Math.cos(faceTo - kin.rotation.y)) * frameLerp(0.25, dt);
      // Der Korb geht mit: neben der Figur, auf Hüfthöhe.
      const korb = this.baskets.get(player.id);
      if (korb) {
        const side = kin.position.x >= 0 ? 1 : -1;
        korb.group.position.set(kin.position.x + side * 0.26, 0.34 + (moving ? Math.abs(Math.sin(now / 90)) * 0.05 : 0), kin.position.z + 0.12);
        korb.group.visible = atTree || moving;
        if (korb.shown !== entry.basket) {
          korb.shown = entry.basket;
          this.fillPile(korb.pile, entry.basket, { cap: 8, r: 0.045, y: 0.13 });
        }
      }
      const crate = this.crates.get(player.id);
      const goldKey = `${entry.banked}/${entry.golds}`;
      if (crate && crate.shown !== goldKey) {
        crate.shown = goldKey;
        this.fillPile(crate.pile, entry.banked, { cap: 18, r: 0.05, y: 0.33, gold: Math.min(entry.golds || 0, 3), w: 0.44 });
      }
      // Denkblase: wer am Baum wählt, zeigt „?“, wer gewählt hat, „✓“.
      const think = this.thinks.get(player.id);
      if (think) {
        const show = deciding && atTree && !moving && !f.finale;
        think.sprite.visible = show;
        if (show) {
          const text = entry.decided ? "✓" : "?";
          if (think.text !== text) this.paintBubble(think, text);
          think.sprite.position.set(kin.position.x, 1.5, kin.position.z);
        }
      }
      if (f.finale) return;
      if (chasing) animator.set("panic");
      else if (moving) animator.set("walk");
      else if (entry.at === "stung") animator.set("sad");
      else if (entry.at === "home") animator.set(elapsed - (state.last?.at ?? -1e9) < 900 && state.last?.leavers?.includes(player.id) ? "happy" : "idle");
      else if (deciding) animator.set(entry.decided ? "ready" : "think");
      else animator.set("focus");
      animator.lookAt(atTree ? new THREE.Vector3(VINE_X, BUD_BOTTOM, VINE_Z) : null);
    });

    // Bienen: um wache Nester — oder hinter Gestochenen her.
    const awakeNests = [...this.nests.values()].filter((nest) => nest.awake).map((nest) => nest.group.position);
    const chased = [...this.chase.entries()].filter(([, until]) => nowP < until).map(([id]) => this.kins.get(id)).filter(Boolean);
    this.bees.forEach((biene, i) => {
      const u = nowP / 1000 * (2.2 + (i % 3) * 0.5) + biene.userData.phase;
      let center = null;
      let radius = 0.34;
      if (chased.length && i < 16) {
        center = chased[i % chased.length].position.clone().add(new THREE.Vector3(0, 0.6, 0));
        radius = 0.42;
      } else if (awakeNests.length && i % 8 < 4) {
        center = awakeNests[i % awakeNests.length];
      }
      biene.visible = Boolean(center);
      if (!center) return;
      biene.position.set(center.x + Math.cos(u) * radius, center.y + Math.sin(u * 1.7) * 0.18, center.z + Math.sin(u) * radius);
      biene.rotation.y = -u;
      biene.userData.wing.rotation.z = Math.sin(nowP / 18) * 0.6;
    });

    // Abenddämmerung: die letzten Sekunden färben den Himmel.
    const dusk = Math.max(0, Math.min(1, 1 - (state.duskMs - elapsed) / DUSK_WARN_MS));
    if (this.sky && this.duskShown !== Math.round(dusk * 40)) {
      this.duskShown = Math.round(dusk * 40);
      this.sky.material.color.setRGB(1 - dusk * 0.35, 1 - dusk * 0.5, 1 - dusk * 0.2);
    }
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.honey;
    if (!state) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(own?.banked || 0);
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const chips = this.hud.querySelector("[data-honey-chips]");
    if (chips) {
      // Je Spieler: Vorrat daheim, dazu der Korb am Baum oder 🐝 nach einem Stich.
      const html = room.players.map((player) => {
        const entry = arcade.players[player.id];
        const where = entry?.at === "tree" ? ` 🧺${entry.basket || 0}` : entry?.at === "stung" ? " 🐝" : " 🏠";
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}${entry?.at === "stung" ? " is-out" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${entry?.banked || 0}${where}</span>`;
      }).join("")
        + `<span class="hud-chip honey-nests">${(state.nests || []).map((sorte) => `<i class="${state.awake?.[sorte] ? "is-awake" : ""}" style="--nest:${NEST_LOOK[sorte]?.color || "#fff"}" title="${NEST_LOOK[sorte]?.name || sorte}">${NEST_LOOK[sorte]?.short || "?"}</i>`).join("")}</span>`;
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }
    const elapsed = now - minigame.startedAt;
    const step = state.step;
    const canChoose = this.canChoose(minigame, state, controlledId);
    const last = state.last;
    const recent = last && elapsed - last.at < 1300;
    const nameOf = (id) => escapeName(room.players.find((p) => p.id === id)?.name);
    const banner = this.hud.querySelector("[data-honey-banner]");
    let message = null;
    let tone = "#12aaff";
    const duskIn = state.duskMs - elapsed;
    if (elapsed < state.leadMs) message = "Alle an den Baum!";
    else if (recent && last.dusk) {
      message = last.stung.includes(controlledId) ? "Sonnenuntergang — gestochen! 🐝" : "Feierabend!";
      tone = "#8a4fd6";
    } else if (recent && last.bust) {
      const look = NEST_LOOK[last.bud?.nest];
      message = last.stung.includes(controlledId) ? `${look?.name || "Bienen"}! Korb weg! 🐝` : `${look?.name || "Bienen"} stechen!`;
      tone = "#ff5d73";
    } else if (recent && last.goldTo) {
      message = last.goldTo === controlledId ? "Allein heim — das Gold ist deins!" : `${nameOf(last.goldTo)} holt das Gold!`;
      tone = "#ffc400";
    } else if (recent && last.leavers.length) {
      message = last.leavers.includes(controlledId) ? `Heim mit ${last.banked?.[controlledId] ?? 0}!` : `${last.leavers.map(nameOf).join(" + ")} ${last.leavers.length > 1 ? "gehen" : "geht"} heim`;
      tone = "#1fbf5b";
    } else if (canChoose) {
      message = duskIn < 6000 ? `Weiter oder heim? Sonne weg in ${Math.max(1, Math.ceil(duskIn / 1000))} s!` : "Weiter oder heim?";
      tone = duskIn < 6000 ? "#8a4fd6" : "#8a6238";
    } else if (own?.at === "home" && step) {
      message = "Daheim — schau zu!";
      tone = "#3d8fd6";
    } else if (own?.at === "stung" && step) {
      message = "Gestochen — nächste Ranke!";
      tone = "#ff5d73";
    } else if (!step && state.vineEnd !== null && state.overAt === null) {
      message = "Eine neue Ranke wächst …";
      tone = "#1fbf5b";
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
      banner.style.color = tone === "#ffc400" ? "#5c4508" : "#ffffff";
    }
    const timer = this.hud.querySelector("[data-honey-timer]");
    if (timer) {
      timer.hidden = !canChoose || Boolean(minigame.finaleAt);
      if (canChoose) {
        if (banner && !banner.hidden) timer.style.top = `${banner.offsetTop + banner.offsetHeight + 6}px`;
        const arrival = elapsed + this.roundTrip;
        const share = Math.max(0, Math.min(1, (step.until - arrival) / Math.max(1, step.until - step.from)));
        timer.firstElementChild.style.width = `${Math.round(share * 100)}%`;
      }
    }
    const mine = this.choice && step && this.choice.step === step.number ? this.choice.action : null;
    this.controls.querySelectorAll("[data-honey-choice]").forEach((button) => {
      button.disabled = !canChoose;
      button.classList.toggle("is-picked", canChoose && mine === button.dataset.honeyChoice);
    });
  }
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
