import * as THREE from "/vendor/three/three.module.js";
import { createNameLabel } from "./VoxelKit.js?v=tumblekin211";
import { dressMeadow } from "./SceneKit.js?v=tumblekin211";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin211";
import { frameLerp } from "./Quality.js?v=tumblekin211";
import { kiste, lambert, viele, streuer, zaun, sonnenblumen, himmel, wolken } from "./Kulisse.js?v=tumblekin211";

// Honigwabe — ein Bienengarten im Abendlicht. Vom Ast eines grossen Baumes
// hängt eine Ranke: Äpfel, ab und zu ein goldener, dazwischen Honigwaben, um
// die Bienen summen. Wer dran ist, tritt an die Ranke und pflückt von unten
// eine oder zwei. Erwischt man eine Wabe, fallen einem vor Schreck vier
// der Früchte aus dem Korb, und die Bienen jagen einen einmal um den Baum.
const VINE_X = 0;
const VINE_Z = 0.15;
const VINE_BOTTOM = 1.0;
const SPACING = 0.34;
const BRANCH_Y = 5.75;
const PICK_SPOT = new THREE.Vector3(0.42, 0, 0.62);
const SLOT_INNER = 1.0;            // innerster Platz, weit genug neben dem Pflückplatz
const SLOT_GAP = 0.65;             // Abstand der Plätze, von der Ranke nach aussen
const FLY_MS = 520;

export class HoneyVine extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.items = [];              // Meshes entlang der Ranke, von unten
    this.flying = [];
    this.seenPicks = 0;
    this.vineNumber = -1;
    this.homes = new Map();
    this.baskets = new Map();
    this.chase = new Map();       // playerId → bis wann die Bienen jagen
    this.labelY = 0.78;
    this.bees = [];
    this.roundTrip = 0;
    this.measured = false;
    this.lastPingAt = 0;
    // Der eigene Zug, schon gezeigt, aber vom Server noch nicht bestätigt:
    // { number, count, passed, at }.
    this.pending = null;
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
    himmel(scene, { oben: "#6fa8e0", unten: "#ffcf96" });
    this.buildGarden(scene);
    this.buildTree(scene);

    const players = this.getState()?.players || [];
    const n = Math.max(1, players.length);
    const left = Math.ceil(n / 2);
    players.forEach((player, index) => {
      // Links und rechts der Ranke, mit einer Lücke in der Mitte. Im
      // Halbkreis standen die beiden inneren genau zwischen Kamera und
      // Pflückplatz — wer gerade dran war, verschwand hinter dem Nachbarn.
      const outward = index < left ? left - 1 - index : index - left;
      const x = (n === 1 ? 1 : index < left ? -1 : 1) * (SLOT_INNER + outward * SLOT_GAP);
      const z = 1.5 - Math.abs(x) * 0.15;
      const home = new THREE.Vector3(x, 0, z);
      this.homes.set(player.id, home);
      this.addKin(player, index, { x, ground: 0, z, facing: Math.atan2(VINE_X - x, VINE_Z - z) });
      // Korb neben der Figur.
      const korb = new THREE.Group();
      const koerper = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.22, 10, 1, true), lambert("#b98a55", { side: THREE.DoubleSide }));
      koerper.position.y = 0.11;
      koerper.castShadow = true;
      korb.add(koerper);
      kiste(korb, 0.3, 0.02, 0.3, "#8a6238", [0, 0.01, 0], { schatten: false });
      const henkel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 12, Math.PI), lambert("#8a6238"));
      henkel.position.y = 0.22;
      korb.add(henkel);
      const pile = new THREE.Group();
      korb.add(pile);
      // Der Korb steht vorn neben den Füssen — seitlich fiel er aussen aus dem Bild.
      const side = x >= 0 ? 1 : -1;
      korb.position.set(x + side * 0.22, 0, z + 0.42);
      scene.add(korb);
      this.baskets.set(player.id, { group: korb, pile, shown: -1 });
    });

    // Ring unter dem, der dran ist.
    this.turnRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 32), new THREE.MeshBasicMaterial({ color: "#ffe25c", transparent: true, opacity: 0.9 }));
    this.turnRing.rotation.x = -Math.PI / 2;
    this.turnRing.position.y = 0.02;
    scene.add(this.turnRing);

    // Zahlen neben den beiden untersten Früchten, wenn man selbst dran ist.
    this.tags = ["1", "2"].map((text) => {
      const tag = createNameLabel(text, "#ffd15c");
      tag.scale.multiplyScalar(0.85);
      tag.visible = false;
      scene.add(tag);
      return tag;
    });

    // Bienen — ein fester Satz, der um die Waben kreist oder jemanden jagt.
    for (let i = 0; i < 12; i += 1) {
      const biene = new THREE.Group();
      kiste(biene, 0.07, 0.06, 0.09, "#ffc62e", [0, 0, 0], { schatten: false });
      kiste(biene, 0.072, 0.062, 0.025, "#2a2230", [0, 0, 0.01], { schatten: false });
      const f = kiste(biene, 0.1, 0.01, 0.05, "#ffffff", [0, 0.04, 0], { schatten: false });
      f.material = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7 });
      // Fliegende Bienen sind kein Boden, auf dem jemand stehen könnte — auch
      // wenn eine im Finale dicht über den Kopf des Siegers schwirrt.
      biene.userData = { phase: i * 0.77, wing: f, isFx: true };
      biene.visible = false;
      scene.add(biene);
      this.bees.push(biene);
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
    stamm.position.set(-1.25, (BRANCH_Y + 0.6) / 2, -1.2);
    stamm.castShadow = true;
    scene.add(stamm);
    // Wurzeln.
    [[-1.7, -1.2, 0.5], [-0.85, -1.0, -0.4], [-1.3, -0.75, 1.4]].forEach(([x, z, dreh]) => {
      const wurzel = kiste(scene, 0.25, 0.22, 0.7, "#6b4a2e", [x, 0.08, z]);
      wurzel.rotation.y = dreh;
    });
    // Der Ast, an dem die Ranke hängt.
    const ast = kiste(scene, 1.8, 0.32, 0.32, "#6b4a2e", [-0.4, BRANCH_Y, -0.55]);
    ast.rotation.y = -0.55;
    kiste(scene, 0.4, 0.26, 0.9, "#6b4a2e", [VINE_X, BRANCH_Y, VINE_Z - 0.3]);
    // Krone.
    const kronen = [[-1.2, 7.2, -1.4, 2.0], [0.3, 6.9, -1.0, 1.5], [-2.5, 6.6, -0.8, 1.4], [-0.6, 8.1, -1.8, 1.5], [1.1, 7.6, -1.8, 1.2], [-2.0, 7.8, -2.2, 1.3]];
    viele(scene, new THREE.DodecahedronGeometry(1, 0), lambert("#4f8f3e"), kronen.filter((_, i) => i % 2 === 0).map(([x, y, z, s]) => ({ p: [x, y, z], s, r: [0, x, 0] })), { schatten: true });
    viele(scene, new THREE.DodecahedronGeometry(1, 0), lambert("#6aa84f"), kronen.filter((_, i) => i % 2 === 1).map(([x, y, z, s]) => ({ p: [x, y, z], s, r: [0, x, 0] })), { schatten: true });
    // Ein paar Äpfel in der Krone.
    viele(scene, new THREE.SphereGeometry(0.12, 8, 6), lambert("#e0343c"), [[-0.2, 6.3, -0.3], [-2.2, 6.1, -0.2], [0.9, 7.0, -1.0], [-1.6, 6.5, 0.1]].map((p) => ({ p })));
    // Die Ranke selbst: ein dünner Stängel von Ast bis zur untersten Frucht.
    this.stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6), lambert("#4f8f3e"));
    this.stem.castShadow = true;
    scene.add(this.stem);
    this.leaves = viele(scene, new THREE.BoxGeometry(0.14, 0.02, 0.08), lambert("#6aa84f"), Array.from({ length: 10 }, (_, i) => ({
      p: [VINE_X + (i % 2 ? 0.07 : -0.07), VINE_BOTTOM + 0.17 + i * SPACING * 1.3, VINE_Z],
      r: [0, 0, i % 2 ? 0.5 : -0.5]
    })));
  }

  makeItem(kind) {
    const g = new THREE.Group();
    if (kind === "comb") {
      // Dunkler Bernstein mit fast schwarzen Zellen: auf dem Handy muss die
      // Wabe auf einen Blick anders aussehen als ein goldener Apfel — vorher
      // waren beide gelb-orange.
      const wabe = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.13, 6), new THREE.MeshLambertMaterial({ color: "#d9820a", emissive: "#a85a00", emissiveIntensity: 0.12 }));
      wabe.rotation.x = Math.PI / 2;
      wabe.rotation.y = Math.PI / 6;
      wabe.castShadow = true;
      g.add(wabe);
      // Zellen als dunklere Sechsecke auf der Vorderseite.
      [[0, 0], [0.09, 0.05], [-0.09, 0.05], [0.09, -0.05], [-0.09, -0.05], [0, 0.1], [0, -0.1]].forEach(([x, y]) => {
        const zelle = new THREE.Mesh(new THREE.CircleGeometry(0.045, 6), lambert("#4a2604"));
        zelle.position.set(x, y, 0.068);
        g.add(zelle);
      });
      const tropfen = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), lambert("#ffb52e"));
      tropfen.position.set(0.04, -0.2, 0.02);
      tropfen.scale.y = 1.4;
      g.add(tropfen);
    } else {
      const gold = kind === "gold";
      const apfel = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 9), new THREE.MeshLambertMaterial({ color: gold ? "#ffe02e" : "#e0343c", emissive: gold ? "#fff09a" : "#000000", emissiveIntensity: gold ? 0.32 : 0 }));
      apfel.scale.y = 0.92;
      apfel.castShadow = true;
      g.add(apfel);
      kiste(g, 0.025, 0.08, 0.025, "#6b4a2e", [0, 0.15, 0], { schatten: false });
      const blatt = kiste(g, 0.09, 0.015, 0.05, "#4f9b4a", [0.05, 0.16, 0], { schatten: false });
      blatt.rotation.z = -0.4;
      if (gold) {
        const glanz = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.225, 20), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
        g.add(glanz);
        g.userData.glanz = glanz;
      }
    }
    g.userData.kind = kind;
    this.scene.add(g);
    return g;
  }

  rebuildVine(vine, from = null) {
    this.items.forEach((item) => this.scene.remove(item));
    this.items = vine.map((kind, i) => {
      const item = this.makeItem(kind);
      item.position.set(VINE_X, from ?? VINE_BOTTOM + i * SPACING, VINE_Z);
      return item;
    });
  }

  shot() {
    return {
      look: [0, 1.55, 0.55],
      frame: { w: 4.3, h: 3.6 },
      pitch: 0.3,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.28, zoom: 1.4 },
      finale: { pull: 0.8, zoom: 0.7, lift: 0.3, orbit: 0.14 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="runner-lane-controls barrel-run-controls honey-controls">
        <button type="button" data-honey-take="1"><span>1</span><small>pflücken</small></button>
        <button type="button" data-honey-take="2"><span>2</span><small>pflücken</small></button>
        <button type="button" class="honey-pass" data-honey-pass><span>↷</span><small>schieben</small></button>
      </div>`;
    // Einmal im Spiel: den Zug weitergeben, ohne zu pflücken.
    const pass = this.controls.querySelector("[data-honey-pass]");
    this.on(pass, "pointerdown", (event) => {
      event.preventDefault();
      if (pass.disabled) return;
      this.feedback?.vibrate(10);
      this.play({ action: "pass" });
    });
    this.controls.querySelectorAll("[data-honey-take]").forEach((button) => {
      this.on(button, "pointerdown", (event) => {
        event.preventDefault();
        if (button.disabled) return;
        this.feedback?.vibrate(10);
        this.play({ action: "take", count: Number(button.dataset.honeyTake) });
      });
    });
  }

  // Den eigenen Zug sofort zeigen: was gepflückt wird, steht ja fest — die
  // untersten Früchte der Ranke. Der Server bestätigt ihn nur noch; kommt
  // etwas anderes zurück (etwa der automatische Griff), gilt das.
  play(input) {
    const minigame = this.update || this.minigame;
    const state = minigame?.arcade?.honey;
    const id = this.getControlledPlayerId();
    const entry = minigame?.arcade?.players?.[id];
    if (!state || !entry || !this.canPlay(minigame, state, id)) return;
    const sentAt = performance.now();
    this.sendInput(input).then(() => this.noteRoundTrip(performance.now() - sentAt)).catch(() => {});
    if (input.action === "pass") {
      this.pending = { number: state.picks, passed: true, at: sentAt };
      this.showPick({ playerId: id, taken: [], passed: true }, true);
      return;
    }
    const taken = state.vine.slice(0, input.count);
    const stung = taken.includes("comb");
    const gained = stung ? 0 : taken.reduce((sum, item) => sum + (item === "gold" ? (state.gold || 3) : item === "fruit" ? 1 : 0), 0);
    const dropped = stung ? Math.min(entry.fruits || 0, state.stingCost ?? 4) : 0;
    this.pending = { number: state.picks, count: input.count, passed: false, at: sentAt };
    this.showPick({ playerId: id, taken, stung, gained, dropped, passed: false }, true);
  }

  // Bin ich dran — gemessen daran, wann ein Druck jetzt beim Server ankäme?
  canPlay(minigame, state, id) {
    const turn = state.turn;
    if (!turn || turn.playerId !== id || minigame.finaleAt || this.pending) return false;
    const arrival = this.now() + this.roundTrip - minigame.startedAt;
    return arrival >= turn.from && arrival <= turn.until + (state.graceMs ?? 150);
  }

  // Wie lange ein Zug zum Server und zurück braucht, geglättet und bei
  // 250 ms gedeckelt. Die erste Messung gilt sofort.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.measured ? this.roundTrip * 0.7 + clamped * 0.3 : clamped;
    this.measured = true;
  }

  // Solange man nicht selbst dran ist, ein ping pro Sekunde (bis zur ersten
  // Messung öfter): er ändert nichts und hält die Messung frisch.
  pingIfIdle(minigame, state, id) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.lastPingAt < (this.measured ? 1000 : 300)) return;
    if (state.turn?.playerId === id || this.pending) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Ein Zug im Bild: Früchte fliegen in den Korb (oder die Wabe platzt),
  // dazu Zahl, Ton und Figur. `fly: false`, wenn die Ranke schon neu steht.
  showPick(last, isOwn, fly = true) {
    const basket = this.baskets.get(last.playerId);
    const kin = this.kins.get(last.playerId);
    const animator = this.animators.get(last.playerId);
    if (fly && basket) {
      const count = Math.min(last.taken.length, this.items.length);
      const gone = this.items.splice(0, count);
      gone.forEach((item, i) => {
        const to = item.userData.kind === "comb"
          ? (kin ? kin.position.clone().add(new THREE.Vector3(0, 0.5, 0)) : item.position.clone())
          : basket.group.position.clone().add(new THREE.Vector3(0, 0.35, 0));
        this.flying.push({ item, from: item.position.clone(), to, at: performance.now() + i * 90, comb: item.userData.kind === "comb" });
      });
    }
    if (animator && !last.passed) animator.trigger(last.stung ? "panic" : "reach");
    if (last.passed) {
      // Geschoben: nichts gepflückt, der Nächste steht vor derselben Ranke.
      if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.15, 0)), "GESCHOBEN!", { color: "#b8e4ff", size: 0.36, life: 1.1 });
      if (animator) animator.trigger("shrug");
      if (isOwn) this.feedback?.sound("whoosh");
    } else if (last.stung) {
      this.chase.set(last.playerId, performance.now() + 2600);
      if (kin) {
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "AUA! RAUS!", { color: "#ffb3bd", size: 0.42, life: 1.4 });
        if (basket) this.burst(basket.group.position.clone().add(new THREE.Vector3(0, 0.3, 0)), ["#e0343c", "#ffcf33", "#e0343c"], { count: Math.min(20, 4 + (last.dropped || 0) * 2), speed: 1.6, up: 2, size: 0.09, life: 0.9 });
      }
      if (animator) {
        animator.set("panic");
        animator.expression("scared", 2400);
      }
      if (isOwn) {
        this.feedback?.sound("fall");
        this.feedback?.vibrate([40, 30, 40, 30, 60]);
        this.rig.shake(0.55);
      } else {
        this.feedback?.sound("pop");
      }
    } else {
      if (kin && last.gained) {
        const gold = last.taken.includes("gold");
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.15, 0)), `+${last.gained}`, { color: gold ? "#ffe36b" : "#ffffff", size: gold ? 0.46 : 0.36 });
      }
      if (isOwn) {
        this.feedback?.sound(last.taken.includes("gold") ? "sparkle" : "coin");
        this.feedback?.vibrate(12);
      }
    }
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.honey;
    if (!state) return;
    const elapsed = now - minigame.startedAt;

    if (this.vineNumber < 0) {
      this.vineNumber = state.vineNumber;
      this.seenPicks = state.picks;
      this.rebuildVine(state.vine);
    }

    this.pingIfIdle(minigame, state, controlledId);
    // Gepflückt: die untersten fliegen in den Korb (oder platzen als Wabe).
    // Den eigenen Zug hat das Gerät schon gezeigt (play) — kommt er so
    // zurück, ist nichts mehr zu tun.
    if (state.picks > this.seenPicks && state.last) {
      this.seenPicks = state.picks;
      const last = state.last;
      const isOwn = last.playerId === controlledId;
      const mine = this.pending;
      const confirmed = mine && isOwn && !last.auto && last.number === mine.number
        && (mine.passed ? last.passed : !last.passed && last.taken.length === mine.count);
      this.pending = null;
      if (!confirmed) {
        // Anders als vorhergesagt: die Ranke steht schon verschoben da, also
        // nur Zahl, Ton und Figur — die Ranke richtet sich unten nach dem Server.
        if (mine) this.rebuildVine(state.vine);
        this.showPick(last, isOwn, !mine);
      }
    } else if (this.pending && performance.now() - this.pending.at > 2500) {
      // Keine Antwort: zurück auf den Stand des Servers.
      this.pending = null;
      this.rebuildVine(state.vine);
    }
    // Neue Ranke wächst nach.
    if (state.vineNumber !== this.vineNumber) {
      this.vineNumber = state.vineNumber;
      this.rebuildVine(state.vine, BRANCH_Y);
      this.pop(new THREE.Vector3(VINE_X, BRANCH_Y - 0.6, VINE_Z + 0.4), "Neue Ranke!", { color: "#b8ffb0", size: 0.34 });
    } else if (!this.pending && this.items.length !== state.vine.length) {
      this.rebuildVine(state.vine);
    }

    // Ranke rutscht nach: jede Frucht zu ihrem Platz.
    this.items.forEach((item, i) => {
      const y = VINE_BOTTOM + i * SPACING;
      item.position.y += (y - item.position.y) * frameLerp(0.12, dt);
      item.rotation.z = Math.sin(now / 700 + i * 0.6) * 0.08;
      if (item.userData.glanz) item.userData.glanz.scale.setScalar(1 + Math.sin(now / 200) * 0.12);
    });
    const top = BRANCH_Y;
    const bottom = this.items.length ? this.items[0].position.y + 0.1 : top - 0.2;
    this.stem.position.set(VINE_X, (top + bottom) / 2, VINE_Z - 0.02);
    this.stem.scale.y = Math.max(0.05, top - bottom);

    // Fliegende Früchte.
    const nowP = performance.now();
    this.flying = this.flying.filter((fly) => {
      const u = Math.max(0, Math.min(1, (nowP - fly.at) / FLY_MS));
      fly.item.position.lerpVectors(fly.from, fly.to, u);
      fly.item.position.y += Math.sin(u * Math.PI) * 0.6;
      fly.item.scale.setScalar(1 - u * 0.4);
      if (u >= 1) {
        if (fly.comb) this.burst(fly.to, ["#f5a524", "#ffcf33", "#2a2230"], { count: 16, speed: 1.8, up: 1.4, size: 0.07, life: 0.8 });
        this.scene.remove(fly.item);
        return false;
      }
      return true;
    });

    // Körbe: sichtbare Früchte je nach Stand.
    players.forEach((player) => {
      const basket = this.baskets.get(player.id);
      const entry = arcade.players[player.id];
      if (!basket || !entry) return;
      const shown = Math.min(9, entry.fruits || 0);
      if (shown !== basket.shown) {
        basket.shown = shown;
        basket.pile.clear();
        for (let i = 0; i < shown; i += 1) {
          const a = i * 2.4;
          const r = i === 0 ? 0 : 0.09;
          const apfel = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), lambert(i % 4 === 3 ? "#ffcf33" : "#e0343c"));
          apfel.position.set(Math.cos(a) * r, 0.2 + Math.floor(i / 4) * 0.07, Math.sin(a) * r);
          basket.pile.add(apfel);
        }
      }
    });

    // Wer ist dran?
    const turn = state.turn;
    const turnKin = turn ? this.kins.get(turn.playerId) : null;
    this.turnRing.visible = Boolean(turnKin) && !f.finale;
    if (turnKin) {
      this.turnRing.position.x = turnKin.position.x;
      this.turnRing.position.z = turnKin.position.z;
      this.turnRing.material.opacity = 0.6 + Math.sin(now / 150) * 0.3;
    }
    const ownTurn = !f.finale && this.canPlay(minigame, state, controlledId);
    this.tags.forEach((tag, i) => {
      const item = this.items[i];
      tag.visible = Boolean(ownTurn && item);
      // Auf der Seite der Ranke, auf der man NICHT steht — sonst sass die
      // Zahl genau über dem eigenen Namensschild.
      const side = (this.homes.get(controlledId)?.x ?? -1) >= 0 ? -1 : 1;
      if (tag.visible) tag.position.set(VINE_X + side * 0.42, VINE_BOTTOM + i * SPACING, VINE_Z + 0.1);
    });

    // Figuren: wer dran ist, tritt an die Ranke; wer gestochen wurde, rennt.
    const nowPerf = performance.now();
    players.forEach((player) => {
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const home = this.homes.get(player.id);
      if (!kin || !animator || !home) return;
      const chasing = nowPerf < (this.chase.get(player.id) || 0);
      const active = turn && turn.playerId === player.id && elapsed >= turn.from - 300;
      let target = home;
      if (chasing) {
        // Eine kleine Runde neben dem eigenen Platz, vom eigenen Korb weg.
        // Vorher kreiste man weit um den Platz — mitten durch den eigenen Korb
        // und bis in den des Nachbarn (die Körbe stehen zwischen den Figuren).
        const u = (nowPerf / 1000) * 2.6;
        const weg = home.x >= 0 ? -1 : 1;
        target = new THREE.Vector3(home.x + weg * 0.25 + Math.cos(u) * 0.3, 0, home.z - 0.15 + Math.sin(u) * 0.22);
      } else if (active) {
        target = PICK_SPOT.clone().setX(home.x >= 0 ? 0.42 : -0.42);
      }
      const dx = target.x - kin.position.x;
      const dz = target.z - kin.position.z;
      const dist = Math.hypot(dx, dz);
      const step = Math.min(dist, (chasing ? 3.2 : 2.4) * dt);
      if (dist > 0.01) {
        kin.position.x += (dx / dist) * step;
        kin.position.z += (dz / dist) * step;
      }
      const moving = dist > 0.05;
      const face = moving ? Math.atan2(dx, dz) : Math.atan2(VINE_X - kin.position.x, VINE_Z - kin.position.z);
      kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(0.25, dt);
      if (f.finale) return;
      const out = arcade.players[player.id]?.outAt != null;
      if (chasing) animator.set("panic");
      else if (moving) animator.set("walk");
      else if (out) {
        // Raus: sitzt traurig neben dem Korb und schaut den anderen zu.
        animator.set("sad");
        animator.lookAt(turnKin ? turnKin.position.clone().add(new THREE.Vector3(0, 0.6, 0)) : null);
      }
      else if (active) {
        animator.set("think");
        animator.lookAt(this.items[0]?.position || null);
      } else {
        animator.set("idle");
        animator.lookAt(turnKin ? turnKin.position.clone().add(new THREE.Vector3(0, 0.6, 0)) : null);
      }
    });

    // Bienen: kreisen um die sichtbaren Waben — oder jagen einen Gestochenen.
    const combs = this.items.filter((item) => item.userData.kind === "comb" && item.position.y < BRANCH_Y - 0.3);
    const chased = [...this.chase.entries()].filter(([, until]) => nowPerf < until).map(([id]) => this.kins.get(id)).filter(Boolean);
    this.bees.forEach((biene, i) => {
      const u = nowPerf / 1000 * (2.2 + (i % 3) * 0.5) + biene.userData.phase;
      let center = null;
      let radius = 0.32;
      if (chased.length && i < 8) {
        center = chased[i % chased.length].position.clone().add(new THREE.Vector3(0, 0.55, 0));
        radius = 0.45;
      } else if (combs.length) {
        center = combs[i % combs.length].position;
      }
      biene.visible = Boolean(center);
      if (!center) return;
      biene.position.set(center.x + Math.cos(u) * radius, center.y + Math.sin(u * 1.7) * 0.18, center.z + Math.sin(u) * radius);
      biene.rotation.y = -u;
      biene.userData.wing.rotation.z = Math.sin(nowPerf / 18) * 0.6;
    });
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.honey;
    if (!state) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(own?.fruits || 0);
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const chips = this.hud.querySelector("[data-honey-chips]");
    if (chips) {
      const html = room.players.map((player) => {
        const entry = arcade.players[player.id];
        const active = state.turn?.playerId === player.id;
        const out = entry?.outAt != null;
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}${active ? " is-turn" : ""}${out ? " is-out" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${out ? "raus" : `🍎${entry?.fruits || 0}`}</span>`;
      }).join("");
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }
    const elapsed = now - minigame.startedAt;
    const turn = state.turn;
    // Ob man dran ist und wie viel Bedenkzeit bleibt, gilt für die Ankunft
    // beim Server — der Balken ist leer, wenn ein Druck nicht mehr ankäme.
    const arrival = elapsed + this.roundTrip;
    const ownTurn = this.canPlay(minigame, state, controlledId);
    const banner = this.hud.querySelector("[data-honey-banner]");
    let message = null;
    let tone = "#12aaff";
    const lastWho = state.last ? room.players.find((p) => p.id === state.last.playerId) : null;
    if (elapsed < state.leadMs) message = "Schau dir die Ranke an …";
    else if (ownTurn) {
      // Der eigene Zug geht vor: wer dran ist, muss es sofort sehen — auch
      // wenn der Vorgänger eben erst geschoben hat.
      // Kurz, damit es in eine Zeile passt: die Knöpfe zeigen die Wahl.
      message = state.last?.passed && elapsed - state.last.at < 1100 && state.last.playerId !== controlledId
        ? `${escapeName(lastWho?.name)} schiebt zu dir!`
        : "Du bist dran!";
      tone = "#1fbf5b";
    } else if (state.last && elapsed - state.last.at < 1300 && state.last.stung) {
      message = state.last.playerId === controlledId ? "Gestochen — du bist raus! 🐝" : `${escapeName(lastWho?.name)} ist raus! 🐝`;
      tone = "#ff5d73";
    } else if (state.last && elapsed - state.last.at < 1100 && state.last.passed) {
      message = state.last.playerId === controlledId ? "Geschoben!" : `${escapeName(lastWho?.name)} schiebt weiter!`;
      tone = "#3d8fd6";
    } else if (turn && !(turn.playerId === controlledId && this.pending)) {
      const who = room.players.find((p) => p.id === turn.playerId);
      message = turn.playerId === controlledId ? "Gleich bist du dran …" : `${escapeName(who?.name)} ist dran …`;
      tone = "#8a6238";
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
    }
    const timer = this.hud.querySelector("[data-honey-timer]");
    if (timer) {
      timer.hidden = !ownTurn || Boolean(minigame.finaleAt);
      if (ownTurn) {
        // Mehrzeilige Ansagen und kleine Ansichten dürfen den Balken nicht überdecken.
        if (banner && !banner.hidden) timer.style.top = `${banner.offsetTop + banner.offsetHeight + 6}px`;
        const share = Math.max(0, Math.min(1, (turn.until - arrival) / Math.max(1, turn.until - turn.from)));
        timer.firstElementChild.style.width = `${Math.round(share * 100)}%`;
      }
    }
    this.controls.querySelectorAll("[data-honey-take]").forEach((button) => {
      const count = Number(button.dataset.honeyTake);
      button.disabled = !ownTurn || state.vine.length < count;
    });
    const pass = this.controls.querySelector("[data-honey-pass]");
    if (pass) {
      const left = own?.passes || 0;
      pass.disabled = !ownTurn || left <= 0 || room.players.length < 2;
      pass.classList.toggle("is-used", left <= 0);
    }
  }
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
