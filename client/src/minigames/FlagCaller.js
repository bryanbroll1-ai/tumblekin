import * as THREE from "/vendor/three/three.module.js";
import { createKin, KinAnimator, reachArm, KIN_SOLE } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer, wolken, himmel } from "./Kulisse.js?v=tumblekin200";

// Flaggen hoch — auf dem Deck eines Segelschiffs. Oben auf der Brücke steht
// der Käpt'n mit einer roten und einer blauen Signalflagge. Ruft er „Käpt'n
// sagt: ROT!", heben alle Rot; ruft er nur „ROT!", ist es eine Falle. Die
// Kommandos kommen immer schneller, drei Fehler und man sitzt an Deck.
//
// Rot ist für alle auf der LINKEN Bildseite, Blau rechts — beim Käpt'n, bei
// den Matrosen und auf den Knöpfen. Wer nachdenken muss, welche Hand, hat
// schon verloren.
const DECK_Y = 0.35;
const BRIDGE_Y = 1.25;
const CAPTAIN_SCALE = 1.35;
const ROW_Z = 0.55;
const RAISE_MS = 520;
const RED = "#ff3b52";
const BLUE = "#2f7bff";
const UP = new THREE.Vector3(0, 1, 0);

export class FlagCaller extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.flagsOf = new Map();       // playerId → { red, blue, raise: { red, blue }, until: { red, blue } }
    this.seenRaised = new Map();
    this.seenAnswers = new Map();
    this.seenOut = new Set();
    this.shownCommand = -1;
    this.labelY = 0.78;
    this.gulls = [];
    this.caps = null;
  }

  stage() {
    return {
      label: "3D Flaggen hoch",
      background: "#7cc8f5",
      fog: ["#bfe6ff", 26, 70],
      lights: { sunPosition: [-5, 12, 7], shadow: { left: -6, right: 6, top: 5, bottom: -4 }, groundColor: 0x4a90b8 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips" data-flag-lives></div>
      <div class="flag-call" data-flag-call hidden><small>Käpt'n sagt:</small><b></b></div>`;
  }

  build() {
    const scene = this.scene;
    himmel(scene, { oben: "#4aa8f0", unten: "#cdeeff" });
    this.buildSea(scene);
    this.buildShip(scene);

    // Der Käpt'n auf der Brücke.
    this.captain = createKin("#27407a", 2);
    this.captain.scale.setScalar(CAPTAIN_SCALE);
    const capY = BRIDGE_Y + KIN_SOLE * CAPTAIN_SCALE;
    this.captain.position.set(0, capY, -2.35);
    scene.add(this.captain);
    this.captainAnimator = new KinAnimator(this.captain);
    this.captainAnimator.groundY = capY;
    // Kapitänsmütze.
    const muetze = new THREE.Group();
    kiste(muetze, 0.5, 0.12, 0.44, "#ffffff", [0, 0, 0]);
    kiste(muetze, 0.52, 0.05, 0.2, "#1d2a4a", [0, -0.05, 0.26]);
    kiste(muetze, 0.12, 0.08, 0.02, "#ffd15c", [0, 0.01, 0.225], { schatten: false });
    muetze.position.set(0, 0.37, 0);
    this.captain.userData.head.add(muetze);
    this.captainFlags = { red: makeFlag(RED, 1.2), blue: makeFlag(BLUE, 1.2), raise: { red: 0, blue: 0 } };
    scene.add(this.captainFlags.red, this.captainFlags.blue);

    // Die Matrosen in einer Reihe an Deck, jeder mit zwei Flaggen.
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * 1.05;
      this.addKin(player, index, { x, ground: DECK_Y, z: ROW_Z, facing: 0 });
      const red = makeFlag(RED);
      const blue = makeFlag(BLUE);
      scene.add(red, blue);
      this.flagsOf.set(player.id, { red, blue, raise: { red: 0, blue: 0 }, until: { red: 0, blue: 0 } });
    });
  }

  buildSea(scene) {
    const meer = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), lambert("#2a8fd0"));
    meer.rotation.x = -Math.PI / 2;
    meer.position.y = -0.4;
    meer.receiveShadow = true;
    scene.add(meer);
    // Schaumkronen: flache weisse Streifen, die auf und ab tanzen.
    const zufall = streuer(31);
    const kronen = [];
    for (let i = 0; i < 80; i += 1) {
      const a = zufall() * Math.PI * 2;
      const r = 6 + zufall() * 40;
      kronen.push({ p: [Math.cos(a) * r, -0.37, Math.sin(a) * r - 6], r: [-Math.PI / 2, 0, zufall() * 3], s: [0.6 + zufall() * 1.2, 0.12, 1] });
    }
    this.caps = viele(scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: "#e8f6ff", transparent: true, opacity: 0.8 }), kronen);
    this.capBase = kronen;
    // Inseln mit Leuchtturm am Horizont.
    [[-22, -40, 5], [26, -46, 7], [8, -58, 4]].forEach(([x, z, s]) => {
      const insel = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert("#6cb35a"));
      insel.scale.y = 0.35;
      insel.position.set(x, -0.4, z);
      scene.add(insel);
      const strand = new THREE.Mesh(new THREE.CylinderGeometry(s * 1.08, s * 1.12, 0.3, 16), lambert("#f1dfa6"));
      strand.position.set(x, -0.35, z);
      scene.add(strand);
    });
    const turm = new THREE.Group();
    [0, 1, 2, 3].forEach((i) => kiste(turm, 0.9 - i * 0.08, 1, 0.9 - i * 0.08, i % 2 ? "#ffffff" : "#e0344a", [0, 0.5 + i, 0], { schatten: false }));
    const lampe = kiste(turm, 0.6, 0.5, 0.6, "#fff4b0", [0, 4.25, 0], { schatten: false });
    lampe.material = new THREE.MeshBasicMaterial({ color: "#fff4b0" });
    kiste(turm, 0.8, 0.2, 0.8, "#3b3f4a", [0, 4.6, 0], { schatten: false });
    turm.position.set(26, 0.8, -46);
    scene.add(turm);
    wolken(scene, [[-14, 9, -30, 2.2], [10, 11, -38, 2.8], [24, 8, -26, 1.8], [-28, 10, -40, 2.4]]);
    // Möwen kreisen.
    for (let i = 0; i < 4; i += 1) {
      const moewe = new THREE.Group();
      kiste(moewe, 0.2, 0.1, 0.12, "#ffffff", [0, 0, 0], { schatten: false });
      const fluegel = [-1, 1].map((seite) => {
        const f = kiste(moewe, 0.3, 0.03, 0.12, "#e8eef4", [seite * 0.22, 0.02, 0], { schatten: false });
        f.userData.seite = seite;
        return f;
      });
      moewe.userData = { fluegel, r: 4 + i * 1.6, h: 4.5 + i * 0.6, speed: 0.25 + i * 0.07, phase: i * 1.9 };
      scene.add(moewe);
      this.gulls.push(moewe);
    }
  }

  buildShip(scene) {
    // Rumpf, Deck aus Planken, Reling, Brücke, Mast mit Segel.
    const rumpf = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.2, 8), lambert("#8c3b2b"));
    rumpf.position.set(0, DECK_Y - 0.62, -0.8);
    rumpf.receiveShadow = true;
    scene.add(rumpf);
    kiste(scene, 7.3, 0.12, 8.1, "#f4f0e6", [0, DECK_Y - 0.16, -0.8], { schatten: false });
    const planken = [];
    for (let i = 0; i < 14; i += 1) planken.push({ p: [-3.25 + i * 0.5, DECK_Y - 0.03, -0.8] });
    viele(scene, new THREE.BoxGeometry(0.48, 0.06, 8), lambert("#c99b62"), planken.filter((_, i) => i % 2 === 0), { empfangen: true });
    viele(scene, new THREE.BoxGeometry(0.48, 0.06, 8), lambert("#b98a55"), planken.filter((_, i) => i % 2 === 1), { empfangen: true });
    // Reling an den Seiten.
    [-1, 1].forEach((seite) => {
      const pfosten = [];
      for (let z = -4.4; z <= 3; z += 0.6) pfosten.push({ p: [seite * 3.5, DECK_Y + 0.3, z] });
      viele(scene, new THREE.BoxGeometry(0.08, 0.6, 0.08), lambert("#6b3a2e"), pfosten, { schatten: true });
      kiste(scene, 0.12, 0.08, 7.6, "#8a5a3a", [seite * 3.5, DECK_Y + 0.62, -0.7]);
    });
    // Brücke mit Treppe und Geländer.
    kiste(scene, 3.4, BRIDGE_Y - DECK_Y, 1.8, "#a86b3f", [0, (BRIDGE_Y + DECK_Y) / 2, -2.6]);
    kiste(scene, 3.5, 0.08, 1.9, "#c99b62", [0, BRIDGE_Y - 0.04, -2.6], { schatten: false });
    const stufen = [];
    for (let i = 0; i < 4; i += 1) stufen.push({ p: [1.95, DECK_Y + 0.11 + i * 0.22, -1.95 - i * 0.2], s: [0.7, 1, 1] });
    viele(scene, new THREE.BoxGeometry(1, 0.1, 0.3), lambert("#8a5a3a"), stufen);
    const gel = [];
    for (let x = -1.6; x <= 1.61; x += 0.4) gel.push({ p: [x, BRIDGE_Y + 0.28, -1.72] });
    viele(scene, new THREE.BoxGeometry(0.06, 0.56, 0.06), lambert("#ffffff"), gel);
    kiste(scene, 3.3, 0.06, 0.08, "#ffffff", [0, BRIDGE_Y + 0.56, -1.72]);
    // Mast, Rahe, Segel, Wimpel.
    kiste(scene, 0.22, 7, 0.22, "#8a5a3a", [0, 3.5, -4.2]);
    kiste(scene, 4.2, 0.12, 0.12, "#8a5a3a", [0, 5.8, -4.1]);
    const segel = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.6, 8, 4), lambert("#fffaf0", { side: THREE.DoubleSide }));
    const sp = segel.geometry.attributes.position;
    for (let i = 0; i < sp.count; i += 1) sp.setZ(i, Math.sin(((sp.getX(i) + 1.9) / 3.8) * Math.PI) * 0.35);
    segel.geometry.computeVertexNormals();
    segel.position.set(0, 4.45, -4.05);
    scene.add(segel);
    this.pennant = kiste(scene, 0.9, 0.3, 0.02, "#ffd15c", [0.5, 7.05, -4.2], { schatten: false });
    // Tampen: Wanten vom Mast zur Reling.
    const tau = new THREE.LineBasicMaterial({ color: "#5d4a3a" });
    [[-3.4, 1.0], [3.4, 1.0], [-3.4, -3.6], [3.4, -3.6]].forEach(([x, z]) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 6.9, -4.2), new THREE.Vector3(x, DECK_Y + 0.62, z)]);
      scene.add(new THREE.Line(g, tau));
    });
    // Rettungsring, Fässer, Taurolle, Kanonen — was auf einem Deck so liegt.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 8, 16), lambert("#ff5d3b"));
    ring.position.set(-3.42, DECK_Y + 0.35, -0.6);
    ring.rotation.y = Math.PI / 2;
    scene.add(ring);
    [[-2.8, -3.3], [-2.4, -3.6], [2.8, -3.4]].forEach(([x, z]) => {
      const fass = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.6, 10), lambert("#8a5a3a"));
      fass.position.set(x, DECK_Y + 0.3, z);
      fass.castShadow = true;
      scene.add(fass);
      kiste(scene, 0.54, 0.05, 0.54, "#3b3f4a", [x, DECK_Y + 0.5, z], { schatten: false });
    });
    const rolle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 6, 14), lambert("#d8b27a"));
    rolle.rotation.x = -Math.PI / 2;
    rolle.position.set(2.6, DECK_Y + 0.08, 1.9);
    scene.add(rolle);
    [-1, 1].forEach((seite) => {
      const kanone = new THREE.Group();
      kiste(kanone, 0.5, 0.28, 0.6, "#6b3a2e", [0, 0.14, 0]);
      const rohr = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.8, 10), lambert("#2c2f38"));
      rohr.rotation.z = Math.PI / 2;
      rohr.position.set(seite * 0.35, 0.36, 0);
      kanone.add(rohr);
      kanone.position.set(seite * 2.9, DECK_Y, 0.9);
      scene.add(kanone);
    });
    // Bug vorn: spitz zulaufend, mit Klüverbaum und Schaum an der Wasserlinie.
    // Auf dem hochkanten Handy liegt dieser Teil unten im Bild — vorher war
    // dort nur eine rote Kante über leerem Blau.
    const bug = new THREE.Mesh(new THREE.BoxGeometry(5.1, 1.2, 5.1), lambert("#8c3b2b"));
    bug.rotation.y = Math.PI / 4;
    bug.position.set(0, DECK_Y - 0.68, 3.2);
    scene.add(bug);
    // Das Deck des Bugs als Dreieck mit Plankentextur — ein gedrehter Kasten
    // hätte die Planken quer gelegt.
    const form = new THREE.Shape();
    form.moveTo(-3.62, -1.38);
    form.lineTo(3.62, -1.38);
    form.lineTo(0, -6.8);
    form.closePath();
    const bugDeck = new THREE.Mesh(new THREE.ShapeGeometry(form), new THREE.MeshLambertMaterial({ map: plankenTextur() }));
    bugDeck.rotation.x = -Math.PI / 2;
    bugDeck.position.set(0, DECK_Y - 0.0, 0);
    bugDeck.receiveShadow = true;
    scene.add(bugDeck);
    // Reling am Bug entlang der beiden Schrägen.
    [-1, 1].forEach((seite) => {
      const a = new THREE.Vector3(seite * 3.5, 0, 1.38);
      const b = new THREE.Vector3(0, 0, 6.6);
      const laenge = a.distanceTo(b);
      const leiste = kiste(scene, 0.1, 0.08, laenge, "#8a5a3a", [(a.x + b.x) / 2, DECK_Y + 0.62, (a.z + b.z) / 2]);
      leiste.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      const pfosten = [];
      for (let t = 0.1; t < 0.95; t += 0.14) pfosten.push({ p: [a.x + (b.x - a.x) * t, DECK_Y + 0.3, a.z + (b.z - a.z) * t] });
      viele(scene, new THREE.BoxGeometry(0.08, 0.6, 0.08), lambert("#6b3a2e"), pfosten, { schatten: true });
    });
    // Namensschild am Rumpf.
    const schild = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), new THREE.MeshBasicMaterial({ map: namensTextur("MS TUMBLEKIN") }));
    schild.position.set(-1.9, DECK_Y - 0.5, 4.36);
    schild.rotation.y = -Math.PI / 4;
    scene.add(schild);
    // Schaum an der Wasserlinie rund um den Rumpf.
    const zufall = streuer(77);
    const schaum = [];
    for (let i = 0; i < 46; i += 1) {
      const t = i / 46;
      const seite = i % 2 ? 1 : -1;
      const z = -4.6 + t * 10.6;
      const halb = z > 1.4 ? Math.max(0.3, 3.6 - (z - 1.4) * 1.0) : 3.62;
      schaum.push({ p: [seite * (halb + 0.1 + zufall() * 0.3), -0.36, z], r: [-Math.PI / 2, 0, zufall() * 3], s: [0.5 + zufall() * 0.6, 0.3 + zufall() * 0.3, 1] });
    }
    viele(scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 }), schaum);
    // Delfine springen neben dem Bug.
    this.dolphins = [-1, 1].map((seite, i) => {
      const d = new THREE.Group();
      const koerper = kiste(d, 0.34, 0.3, 1.0, "#6f8fb3", [0, 0, 0], { schatten: false });
      kiste(d, 0.3, 0.12, 0.7, "#dfe8f2", [0, -0.14, 0.05], { schatten: false });
      kiste(d, 0.1, 0.28, 0.24, "#5d7ea3", [0, 0.24, -0.05], { schatten: false }).rotation.x = -0.4;
      kiste(d, 0.5, 0.06, 0.2, "#5d7ea3", [0, 0, -0.58], { schatten: false });
      kiste(d, 0.14, 0.12, 0.26, "#6f8fb3", [0, -0.02, 0.6], { schatten: false });
      void koerper;
      d.userData = { seite, phase: i * 2.3 };
      d.visible = false;
      scene.add(d);
      return d;
    });
  }

  shot() {
    return {
      look: [0, 1.4, -0.4],
      frame: { w: 4.8, h: 4.0 },
      pitch: 0.2,
      fov: 38,
      intro: { yaw: 0.6, pitch: 0.28, zoom: 1.5 },
      finale: { pull: 0.8, zoom: 0.7, lift: 0.3, orbit: 0.14 }
    };
  }

  keepInView() {
    return [...this.kins.values(), this.captain];
  }

  bind() {
    this.controls.innerHTML = `
      <div class="runner-lane-controls barrel-run-controls flag-controls">
        <button type="button" class="flag-red" data-flag="red" aria-label="Rote Flagge">ROT</button>
        <button type="button" class="flag-blue" data-flag="blue" aria-label="Blaue Flagge">BLAU</button>
      </div>`;
    this.controls.querySelectorAll("[data-flag]").forEach((button) => {
      this.on(button, "pointerdown", (event) => {
        event.preventDefault();
        const minigame = this.update || this.minigame;
        if (!minigame || minigame.finaleAt) return;
        const flag = button.dataset.flag;
        this.feedback?.sound("tap");
        this.feedback?.vibrate(8);
        // Sofort heben — nicht auf den Server warten.
        const own = this.flagsOf.get(this.getControlledPlayerId());
        if (own) own.until[flag] = performance.now() + RAISE_MS;
        this.sendInput({ action: "flag", flag }).catch(() => {});
      });
    });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.flags;
    if (!state) return;
    const elapsed = now - minigame.startedAt;
    const nowP = performance.now();

    // Meer, Möwen, Wimpel.
    if (this.caps) {
      const t = now / 1000;
      this.capBase.forEach((teil, i) => {
        const s = 0.5 + 0.5 * Math.sin(t * 1.3 + i * 1.7);
        teil.s[1] = 0.05 + s * 0.14;
      });
      if (Math.floor(now / 90) !== this.capFrame) {
        this.capFrame = Math.floor(now / 90);
        const o = new THREE.Object3D();
        this.capBase.forEach((teil, i) => {
          o.position.set(teil.p[0], teil.p[1], teil.p[2]);
          o.rotation.set(teil.r[0], teil.r[1], teil.r[2]);
          o.scale.set(teil.s[0], teil.s[1], 1);
          o.updateMatrix();
          this.caps.setMatrixAt(i, o.matrix);
        });
        this.caps.instanceMatrix.needsUpdate = true;
      }
    }
    this.gulls.forEach((moewe) => {
      const u = now / 1000 * moewe.userData.speed + moewe.userData.phase;
      moewe.position.set(Math.cos(u) * moewe.userData.r, moewe.userData.h + Math.sin(u * 2) * 0.3, -3 + Math.sin(u) * moewe.userData.r * 0.6);
      moewe.rotation.y = -u;
      const flap = Math.sin(now / 90 + moewe.userData.phase) * 0.5;
      moewe.userData.fluegel.forEach((f) => { f.rotation.z = f.userData.seite * flap; });
    });
    if (this.pennant) this.pennant.rotation.y = Math.sin(now / 300) * 0.3;
    this.dolphins?.forEach((d) => {
      const period = 4.6;
      const u = ((now / 1000 + d.userData.phase) % period) / 1.4;
      d.visible = u < 1;
      if (!d.visible) return;
      const x = d.userData.seite * (3.4 + u * 0.4);
      const z = 5.2 - u * 3.2;
      d.position.set(x, -0.4 + Math.sin(u * Math.PI) * 1.2, z);
      d.rotation.x = -Math.cos(u * Math.PI) * 0.9;
      d.rotation.y = Math.PI;
      if (u > 0.94 && !d.userData.splashed) {
        d.userData.splashed = true;
        this.burst(new THREE.Vector3(x, -0.3, z), ["#ffffff", "#bfe6ff"], { count: 8, speed: 1.1, up: 1.6, size: 0.07, life: 0.6 });
      }
      if (u < 0.5) d.userData.splashed = false;
    });

    // Der Käpt'n: hebt, was er ruft — bei der Falle genauso.
    const command = activeCommand(state.commands, elapsed);
    const capTarget = { red: 0, blue: 0 };
    if (command) {
      const hold = elapsed - command.at < command.window * 0.85;
      if (hold) {
        if (command.kind === "red" || command.kind === "both" || (command.kind === "fake" && command.side === "red")) capTarget.red = 1;
        if (command.kind === "blue" || command.kind === "both" || (command.kind === "fake" && command.side === "blue")) capTarget.blue = 1;
      }
    }
    ["red", "blue"].forEach((flag) => {
      this.captainFlags.raise[flag] += (capTarget[flag] - this.captainFlags.raise[flag]) * frameLerp(0.35, dt);
    });
    if (command && command.index !== this.shownCommand) {
      this.shownCommand = command.index;
      this.captainAnimator.trigger("nod");
      this.feedback?.sound(command.kind === "fake" ? "whoosh" : "countdown");
    }
    this.captainAnimator.set(command ? "focus" : "idle");
    this.captainAnimator.expression(command?.kind === "fake" ? "smug" : "focus", 200);
    this.captainAnimator.update(now);

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const flags = this.flagsOf.get(player.id);
      if (!entry || !kin || !animator || !flags) return;
      const isOwn = player.id === controlledId;
      // Gehobene Flaggen aus dem Serverstand (auch die der anderen).
      const raised = entry.raised;
      const key = raised ? `${raised.flag}@${raised.at}` : null;
      if (key && key !== this.seenRaised.get(player.id)) {
        this.seenRaised.set(player.id, key);
        flags.until[raised.flag] = Math.max(flags.until[raised.flag], nowP + RAISE_MS);
      }
      const out = Boolean(entry.outAt);
      ["red", "blue"].forEach((flag) => {
        const want = !out && nowP < flags.until[flag] ? 1 : 0;
        flags.raise[flag] += (want - flags.raise[flag]) * frameLerp(0.45, dt);
      });

      // Antworten: Häkchen oder Kreuz über dem Kopf.
      const answers = entry.answers || {};
      const count = Object.keys(answers).length;
      if (count > (this.seenAnswers.get(player.id) ?? count)) {
        const newest = Object.values(answers).reduce((a, b) => ((b.at || 0) >= (a?.at || 0) ? b : a), null);
        const head = kin.position.clone().add(new THREE.Vector3(0, 1.05, 0));
        if (newest?.result === "ok") {
          if (isOwn) {
            this.pop(head, "✓", { color: "#6dff9a", size: 0.5, life: 0.7 });
            this.feedback?.sound("coin");
          }
          animator.expression("happy", 500);
        } else if (newest && newest.result !== "out") {
          const text = newest.result === "fooled" ? "Reingelegt!" : newest.result === "late" ? "Zu spät!" : "Falsch!";
          this.pop(head, text, { color: "#ffb3bd", size: 0.34, life: 1 });
          animator.trigger("flinch");
          animator.expression("surprised", 900);
          if (isOwn) {
            this.feedback?.sound("error");
            this.feedback?.vibrate([30, 40, 30]);
            this.rig.shake(0.3);
          }
        }
      }
      this.seenAnswers.set(player.id, count);
      if (out && !this.seenOut.has(player.id)) {
        this.seenOut.add(player.id);
        this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.6, 0)), ["#9aa7b4", "#ffffff"], { count: 10, speed: 1.2, up: 1.2, size: 0.06, life: 0.7 });
      }
      if (f.finale) return;
      if (out) {
        animator.set("sit");
        animator.expression("sad", 300);
      } else {
        animator.set(command ? "ready" : "idle");
        animator.lookAt(this.captain.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
      }
    });
  }

  // Arme heben und Flaggen an die Hände setzen.
  afterAnimate(f) {
    const place = (kin, flags, scale = 1, sitting = false) => {
      ["red", "blue"].forEach((flag) => {
        const armIndex = flag === "red" ? 1 : 0;       // Arm 1 liegt links im Bild
        const side = flag === "red" ? -1 : 1;
        const raise = flags.raise[flag];
        const shoulder = kin.localToWorld(new THREE.Vector3(side * 0.22, 0.05, 0));
        const low = shoulder.clone().add(new THREE.Vector3(side * 0.12 * scale, -0.3 * scale, 0.32 * scale));
        const high = shoulder.clone().add(new THREE.Vector3(side * 0.28 * scale, 0.9 * scale, 0.05 * scale));
        const target = low.lerp(high, raise);
        if (!sitting) reachArm(kin, armIndex, target, 1);
        const arm = kin.userData.arms?.[armIndex];
        const hand = arm ? arm.localToWorld(new THREE.Vector3(0, -0.16, 0.02)) : shoulder;
        const flagObj = flag === "red" ? flags.red : flags.blue;
        flagObj.position.copy(hand);
        const down = new THREE.Vector3(side * 0.25, -0.25, 0.95).normalize();
        const up = new THREE.Vector3(side * 0.18, 1, 0.05).normalize();
        const dir = down.lerp(up, raise).normalize();
        flagObj.quaternion.setFromUnitVectors(UP, dir);
        flagObj.userData.cloth.position.x = side * 0.17 * flagObj.userData.size;
        flagObj.visible = !sitting;
      });
    };
    place(this.captain, this.captainFlags, CAPTAIN_SCALE);
    this.kins.forEach((kin, id) => {
      const flags = this.flagsOf.get(id);
      const entry = f.arcade?.players?.[id];
      if (flags) place(kin, flags, 1, Boolean(entry?.outAt) && !f.finale);
    });
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.flags;
    if (!state) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(own?.correct || 0);
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const lives = this.hud.querySelector("[data-flag-lives]");
    if (lives) {
      const html = room.players.map((player) => {
        const entry = arcade.players[player.id];
        const hearts = "❤".repeat(entry?.lives || 0) + "·".repeat(Math.max(0, state.lives - (entry?.lives || 0)));
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}${entry?.outAt ? " is-out" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${hearts}</span>`;
      }).join("");
      if (html !== this.livesHtml) {
        this.livesHtml = html;
        lives.innerHTML = html;
      }
    }
    // Das Kommando: gross die Farbe, darüber „Käpt'n sagt:" — oder eben nicht.
    const call = this.hud.querySelector("[data-flag-call]");
    const elapsed = now - minigame.startedAt;
    const command = activeCommand(state.commands, elapsed);
    if (call) {
      if (!command || minigame.finaleAt) {
        call.hidden = true;
      } else {
        const color = command.kind === "fake" ? command.side : command.kind;
        const word = color === "both" ? "BEIDE!" : color === "red" ? "ROT!" : "BLAU!";
        call.hidden = false;
        call.dataset.color = color;
        call.classList.toggle("is-fake", command.kind === "fake");
        const b = call.querySelector("b");
        if (b.textContent !== word) b.textContent = word;
      }
    }
    const out = Boolean(own?.outAt);
    this.controls.querySelectorAll("[data-flag]").forEach((button) => { button.disabled = out || Boolean(minigame.finaleAt); });
  }
}

function activeCommand(commands, elapsed) {
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const c = commands[i];
    if (elapsed >= c.at) return elapsed <= c.at + c.window ? c : null;
  }
  return null;
}

// Signalflagge: Stock mit Tuch. Der Ursprung ist die Hand; der Stock zeigt
// entlang +y.
function makeFlag(color, size = 1) {
  const g = new THREE.Group();
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.62, 0.03), lambert("#e8e2d4"));
  stock.position.y = 0.25;
  stock.castShadow = true;
  g.add(stock);
  const tuch = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.02), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.12 }));
  tuch.position.set(0.17, 0.44, 0);
  tuch.castShadow = true;
  g.add(tuch);
  g.scale.setScalar(size);
  g.userData.cloth = tuch;
  g.userData.size = 1;
  return g;
}

function plankenTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i % 2 ? "#b98a55" : "#c99b62";
    ctx.fillRect(i * 32, 0, 32, 256);
    ctx.fillStyle = "rgba(90, 60, 30, 0.45)";
    ctx.fillRect(i * 32, 0, 2, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Ein Texturfeld = 4 Welteinheiten (8 Planken zu 0.5).
  texture.repeat.set(0.25, 0.25);
  return texture;
}

function namensTextur(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1d2a4a";
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = "#ffd15c";
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 84);
  ctx.fillStyle = "#ffd15c";
  ctx.font = "900 52px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 52);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
