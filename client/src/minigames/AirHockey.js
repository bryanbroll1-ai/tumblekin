import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin214";
import { frameLerp, fxScale, prefersReducedMotion } from "./Quality.js?v=tumblekin214";
import { createNameLabel } from "./VoxelKit.js?v=tumblekin214";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin214";
import { blockform } from "./Blockform.js?v=tumblekin214";
import { forecastHockey, hockeyRules, limits } from "./Puckbahn.js?v=tumblekin214";

// Luftpuck — Glow-Hockey in einer Neon-Spielhalle. Jeder Spieler IST ein
// Airhockey-Schläger: runder Fuss in der eigenen Farbe, ein Neonring in der
// Teamfarbe, Griff mit Knauf, darüber das Namensschild. Das eigene Tor liegt
// für Team 0 vorn, für Team 1 hinten.
//
// Vorher stand ein heller Tisch in einer leeren Halle, und ausser dem Puck
// bewegte sich kaum etwas — es sah langweilig aus. Jetzt: ein dunkler Tisch
// mit leuchtenden Linien, ein Puck, der die Farbe des letzten Schützen
// annimmt und eine Leuchtspur zieht, Funken und Schockwellen bei jedem Stoss,
// aufblitzende Banden, ein Lauflicht um den Tisch, Scheinwerfer, schwebende
// Luftteilchen und Publikum auf Tribünen, das den Puck verfolgt und bei
// jedem Tor aufspringt.
//
// Gesteuert wird RELATIV: man wischt irgendwo — gern unterhalb des Tisches —,
// und der Schläger macht dieselbe Bewegung. Vorher sprang er unter den Finger,
// und der Finger verdeckte genau die Stelle, an der der Puck ankam.
const TABLE_Y = 0.5;
const RAIL_H = 0.22;
const TEAM_COLORS = ["#ff3b8d", "#2fd6ff"];
const NEUTRAL = "#ffe25c";
const STICK_GAP_MS = 40;         // Stick höchstens so oft schicken
const TICK_LEAD_MS = 45;         // halber Servertakt (90 ms), siehe stickAt
// Ein Wisch von 100 Pixeln schiebt den Schläger auf dem Bildschirm um 125:
// quer über die eigene Hälfte reicht ein Daumenweg.
const DRAG_GAIN = 1.25;
const MATERIALIZE_MS = 450;      // so lange taucht der Puck vor dem Anstoss auf
const HARD_HIT = 6.5;            // ab diesem Tempo (m/s) ist ein Schuss „hart"

export class AirHockey extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.mallets = new Map();      // playerId → { group, body, ring, glow, side, r, hit, hop, phase }
    this.roundTrip = 0;
    this.stickLog = [];            // { at, x, y }: was das Gerät wann geschickt hat (Geräteuhr)
    this.inputWanted = null;       // { kind: "aim", x, z } oder { kind: "steer", x, y }
    this.inputSent = null;
    this.stickSent = { x: 0, y: 0, clock: 0 };
    this.lastPingAt = 0;
    this.view = null;              // Vorausrechnung zur Ankunftszeit (forecastHockey)
    this.ownTouchAt = 0;           // wann das Gerät den eigenen Stoss schon gezeigt hat
    this.seenGoals = 0;
    this.goalFxAt = 0;             // letztes vorausgesehenes Tor (Versinken im Schlitz)
    this.labelY = 0.78;
    this.screens = [];
    this.spots = null;
    this.drag = null;              // { id, fx, fy, bx, by }: Wisch und Ankerpunkt
    this.hype = [0, 0];            // Jubel je Fanblock, klingt ab
    this.ooh = 0;                  // Raunen bei harten Schüssen
    this.ledFlash = { until: 0, color: null };
    this.beamFocus = { until: 0, x: 0, z: 0, color: null };
    this.wallAt = { x: 0, z: 0 };
    this.prevPuck = null;
    this.puckColor = new THREE.Color(NEUTRAL);
    this.lastTeam = -1;
    this.scoreSeen = [0, 0];
    this.hurryShown = false;
  }

  stage() {
    return {
      label: "3D Luftpuck",
      background: "#0d0618",
      fog: ["#0d0618", 18, 46],
      lights: { sunPosition: [2, 12, 6], sunColor: 0xfff0ff, sunIntensity: 2.0, hemiIntensity: 1.35, skyColor: 0xb8a8ff, groundColor: 0x3a1a5a, fillColor: 0x6a4aff, fillIntensity: 0.9, shadow: { left: -4, right: 4, top: 5, bottom: -5 } }
    };
  }

  hudHtml() {
    return `
      <div class="hockey-flash" data-hockey-flash hidden></div>
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0 : 0</strong></div>
      <div class="tug-teams" data-hockey-teams></div>
      <div class="color-banner" data-hockey-banner hidden></div>
      <div class="hockey-touch" data-hockey-touch hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame?.arcade;
    const state = arcade?.hockey;
    this.w = state?.w ?? 4.4;
    this.l = state?.l ?? 7.4;
    this.goalW = state?.goalW ?? 2.2;
    this.puckR = state?.puckR ?? 0.22;
    this.glowTex = leuchtTextur();
    this.buildHall(scene);
    this.buildCrowd(scene);
    this.buildTable(scene);
    this.buildBeams(scene);

    // Effekte aus festen Töpfen: Funken leuchten (additiv), Konfetti nicht.
    // Was auf den Tisch fällt, bleibt auf dem Tisch liegen.
    const floor = (x, z) => (Math.abs(x) < this.w / 2 + 0.3 && Math.abs(z) < this.l / 2 + 0.3 ? TABLE_Y + 0.02 : 0.02);
    this.sparks = new Splitter(scene, { capacity: 260, size: 0.06, additive: true, floor });
    this.confetti = new Splitter(scene, { capacity: 240, size: 0.09, additive: false, floor });
    this.waves = new Wellen(scene, 12);
    this.glows = new Leuchten(scene, this.glowTex, 10);

    // Puck: helle Scheibe, oben eine Kappe in der Farbe des letzten Schützen,
    // ringsum ein leuchtender Rand, darunter ein Schein.
    this.puck = new THREE.Group();
    const scheibe = new THREE.Mesh(new THREE.CylinderGeometry(this.puckR, this.puckR, 0.09, 24), lambert("#eef2ff", { emissive: "#7d8cff", emissiveIntensity: 0.35 }));
    scheibe.castShadow = true;
    this.puck.add(scheibe);
    this.puckCap = new THREE.Mesh(new THREE.CylinderGeometry(this.puckR * 0.62, this.puckR * 0.62, 0.012, 24), new THREE.MeshBasicMaterial({ color: NEUTRAL }));
    this.puckCap.position.y = 0.05;
    this.puck.add(this.puckCap);
    // Ein Streifen auf der Kappe zeigt den Drall.
    const streifen = new THREE.Mesh(new THREE.BoxGeometry(this.puckR * 1.1, 0.014, 0.05), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    streifen.position.y = 0.052;
    this.puck.add(streifen);
    this.puckRim = new THREE.Mesh(new THREE.TorusGeometry(this.puckR, 0.028, 6, 24), new THREE.MeshBasicMaterial({ color: NEUTRAL }));
    this.puckRim.rotation.x = Math.PI / 2;
    this.puckRim.position.y = 0.0;
    this.puck.add(this.puckRim);
    this.puck.position.set(0, TABLE_Y + 0.05, 0);
    scene.add(this.puck);
    this.puckHalo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.glowTex, color: NEUTRAL, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.puckHalo.rotation.x = -Math.PI / 2;
    this.puckHalo.renderOrder = 2;
    this.puckHalo.userData.isFx = true;
    scene.add(this.puckHalo);
    this.trail = new Spur(scene, 26);
    // Der versenkte Puck: rutscht nach einem Tor in den Schlitz und sinkt ab.
    this.ghost = new THREE.Mesh(new THREE.CylinderGeometry(this.puckR, this.puckR, 0.09, 24), new THREE.MeshBasicMaterial({ color: "#eef2ff", transparent: true }));
    this.ghost.visible = false;
    this.ghost.userData.isFx = true;
    scene.add(this.ghost);
    this.ghostState = null;

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      const r = entry?.r ?? 0.36;
      const side = entry?.side ?? index % 2;
      const mallet = buildMallet(player.color, TEAM_COLORS[side], r, this.glowTex);
      mallet.group.position.set(entry?.x ?? 0, TABLE_Y, entry?.z ?? 0);
      const label = createNameLabel(String(player.name || "?").slice(0, 8), player.color, { own: player.id === this.getControlledPlayerId() });
      label.position.y = this.labelY;
      mallet.group.add(label);
      this.labels.set(player.id, label);
      scene.add(mallet.group);
      this.mallets.set(player.id, { ...mallet, side, r, hit: 0, hop: 0, phase: index * 1.7 });
      if (player.id !== this.getControlledPlayerId()) return;
      // Der eigene Schläger trägt einen pulsierenden Ring auf dem Tisch —
      // beim Wischen sucht das Auge ihn, nicht den Finger.
      const ownRing = new THREE.Mesh(new THREE.RingGeometry(r * 1.22, r * 1.42, 32), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ownRing.rotation.x = -Math.PI / 2;
      ownRing.position.y = 0.012;
      ownRing.userData.isFx = true;
      mallet.group.add(ownRing);
      this.ownRing = ownRing;
      // Im Zweierteam hat jeder eine Zone — die eigene leuchtet schwach auf
      // dem Tisch, damit klar ist, warum die Scheibe dort stehen bleibt.
      if (entry?.lane) {
        const lim = limits(hockeyRules(arcade), side, 0, entry.lane);
        const w = lim.xMax - lim.xMin;
        const d = lim.zMax - lim.zMin;
        const zone = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[side], transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }));
        zone.rotation.x = -Math.PI / 2;
        zone.position.set(0, TABLE_Y + 0.004, (lim.zMin + lim.zMax) / 2);
        zone.userData.isFx = true;
        scene.add(zone);
        const kante = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.035), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[side], transparent: true, opacity: 0.7, depthWrite: false }));
        kante.rotation.x = -Math.PI / 2;
        // Die Kante, an der die Zone mitten im Feld endet.
        const edge = entry.lane === "sturm" ? (side === 0 ? lim.zMax : lim.zMin) : (side === 0 ? lim.zMin : lim.zMax);
        kante.position.set(0, TABLE_Y + 0.005, edge);
        kante.userData.isFx = true;
        scene.add(kante);
      }
    });
    if (state?.robot) {
      // Allein spielt man gegen einen Automaten-Schläger: grau, rotes Licht.
      const robo = buildMallet("#9aa6b8", "#ff3b3b", state.robot.r, this.glowTex);
      robo.group.position.set(state.robot.x, TABLE_Y, state.robot.z);
      scene.add(robo.group);
      this.robot = robo.group;
    }
  }

  buildHall(scene) {
    // Boden: dunkle Kacheln, einige leuchten im Takt.
    kiste(scene, 40, 0.2, 40, "#1a112c", [0, -0.1, 0], { schatten: false });
    const zufall = streuer(71);
    const kacheln = [];
    const leuchten = [];
    for (let x = -9; x <= 9; x += 1) {
      for (let z = -9; z <= 9; z += 1) {
        if (Math.abs(x) < 3 && Math.abs(z) < 5) continue;
        (zufall() < 0.07 ? leuchten : kacheln).push({ p: [x, 0.005, z], r: [-Math.PI / 2, 0, 0], s: 0.9 });
      }
    }
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#261a40"), kacheln);
    this.glowTiles = viele(scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff" }), leuchten);
    this.glowCount = leuchten.length;
    this.tileColor = new THREE.Color();
    // Rückwand mit Spielautomaten.
    kiste(scene, 24, 6, 0.3, "#211338", [0, 3, -7.2], { schatten: false });
    const automatenFarben = ["#ff3b8d", "#2fd6ff", "#ffd15c", "#71d97b", "#b57bff", "#ff9f43"];
    for (let i = 0; i < 9; i += 1) {
      const x = -6.4 + i * 1.6;
      const a = new THREE.Group();
      kiste(a, 1.1, 1.9, 0.9, "#2c2f45", [0, 0.95, 0]);
      kiste(a, 1.12, 0.3, 0.92, automatenFarben[i % automatenFarben.length], [0, 2.0, 0]);
      const bildschirm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshBasicMaterial({ color: automatenFarben[(i + 2) % automatenFarben.length] }));
      bildschirm.position.set(0, 1.35, 0.46);
      bildschirm.rotation.x = -0.15;
      a.add(bildschirm);
      this.screens.push({ mesh: bildschirm, phase: i * 1.3, base: new THREE.Color(automatenFarben[(i + 2) % automatenFarben.length]) });
      kiste(a, 0.9, 0.12, 0.35, "#3b3f5a", [0, 0.9, 0.55]);
      kiste(a, 0.08, 0.14, 0.08, "#ff3b3b", [-0.2, 1.02, 0.58], { schatten: false });
      kiste(a, 0.08, 0.08, 0.08, "#ffe25c", [0.15, 1.0, 0.6], { schatten: false });
      kiste(a, 0.08, 0.08, 0.08, "#2fd6ff", [0.3, 1.0, 0.6], { schatten: false });
      a.position.set(x, 0, -6.4);
      scene.add(a);
    }
    // In den hinteren Ecken: Greifautomat und Snackautomat (weiter vorn
    // stehen jetzt die Tribünen).
    const greifer = new THREE.Group();
    kiste(greifer, 1.3, 0.9, 1.3, "#ff3b8d", [0, 0.45, 0]);
    const glas = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 1.2), new THREE.MeshLambertMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.25 }));
    glas.position.y = 1.55;
    greifer.add(glas);
    kiste(greifer, 1.3, 0.2, 1.3, "#ff3b8d", [0, 2.3, 0]);
    viele(greifer, new THREE.SphereGeometry(0.14, 8, 6), lambert("#ffd15c"), [[-0.3, 1.0, -0.2], [0.2, 1.0, 0.1], [0, 1.1, -0.3], [0.35, 1.0, -0.3], [-0.2, 1.05, 0.3]].map((p) => ({ p })));
    viele(greifer, new THREE.SphereGeometry(0.12, 8, 6), lambert("#71d97b"), [[0.1, 1.2, 0.3], [-0.35, 1.2, 0.1]].map((p) => ({ p })));
    kiste(greifer, 0.05, 0.4, 0.05, "#c0c8d8", [0.1, 2.0, 0]);
    greifer.position.set(-6.9, 0, -5.0);
    greifer.rotation.y = 0.6;
    scene.add(greifer);
    const snack = new THREE.Group();
    kiste(snack, 1.1, 2.2, 0.9, "#2fd6ff", [0, 1.1, 0]);
    const fenster = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.4), new THREE.MeshBasicMaterial({ color: "#d9f6ff" }));
    fenster.position.set(-0.1, 1.3, 0.46);
    snack.add(fenster);
    for (let r = 0; r < 4; r += 1) viele(snack, new THREE.BoxGeometry(0.12, 0.18, 0.05), lambert(automatenFarben[r]), [0, 1, 2].map((c) => ({ p: [-0.32 + c * 0.22, 0.8 + r * 0.33, 0.48] })));
    snack.position.set(6.9, 0, -4.8);
    snack.rotation.y = -0.6;
    scene.add(snack);
    // Neonschrift über den Automaten; sie flackert ab und zu.
    const schrift = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.1), new THREE.MeshBasicMaterial({ map: neonTextur("LUFTPUCK"), transparent: true }));
    schrift.position.set(0, 4.7, -7.0);
    scene.add(schrift);
    this.neon = schrift;
    // Neonröhren an den Wänden.
    [["#ff3b8d", -8], ["#2fd6ff", 8]].forEach(([farbe, x]) => {
      const roehre = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 10), new THREE.MeshBasicMaterial({ color: farbe }));
      roehre.position.set(x, 3.2, -2);
      scene.add(roehre);
    });
    kiste(scene, 0.3, 6, 16, "#211338", [-8.3, 3, -1], { schatten: false });
    kiste(scene, 0.3, 6, 16, "#211338", [8.3, 3, -1], { schatten: false });
    // Discokugel und ihre Lichtpunkte: weiche, farbige Lichtflecken.
    const kugel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshLambertMaterial({ color: "#dfe6f2", flatShading: true, emissive: "#555566" }));
    // Hoch unter der Decke: vorher hing sie mitten in der Stand-Leiste.
    kugel.position.set(0, 7.4, -3.5);
    scene.add(kugel);
    this.discoBall = kugel;
    const punkte = [];
    for (let i = 0; i < 26; i += 1) punkte.push({ p: [0, 0.012, 0], r: [-Math.PI / 2, 0, 0], s: 0.5 + zufall() * 0.4 });
    this.spots = viele(scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.glowTex, color: "#ffffff", transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }), punkte);
    const neon = ["#ff3b8d", "#2fd6ff", "#b57bff", "#ffe25c"].map((c) => new THREE.Color(c));
    punkte.forEach((_, i) => this.spots.setColorAt(i, neon[i % neon.length]));
    if (this.spots.instanceColor) this.spots.instanceColor.needsUpdate = true;
    this.spots.userData.isFx = true;
    this.spotSeeds = punkte.map(() => ({ a: zufall() * Math.PI * 2, r: 3.4 + zufall() * 5.5, s: 0.1 + zufall() * 0.2, size: 0.55 + zufall() * 0.5 }));
  }

  // Publikum: links die Fans des vorderen Teams, rechts die des hinteren,
  // hinter dem Tor gemischt. Jeder Zuschauer ist ein Klötzchenmännchen mit
  // Armen und manchmal einem Leuchtstab in der Teamfarbe; alle folgen dem
  // Puck mit dem Kopf und springen bei Toren ihres Teams auf.
  buildCrowd(scene) {
    const zufall = streuer(907);
    const fans = [];
    const stufen = 3;
    [-1, 1].forEach((seite) => {
      const team = seite < 0 ? 0 : 1;
      for (let r = 0; r < stufen; r += 1) {
        const x = seite * (3.45 + r * 0.72);
        const h = 0.22 * (r + 1);
        kiste(scene, 0.72, h, 7.6, r % 2 ? "#2a1d48" : "#33245a", [x, h / 2, 0], { schatten: false });
        // Leuchtkante an jeder Stufe in der Teamfarbe.
        const kante = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 7.6), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
        kante.position.set(x - seite * 0.36, h + 0.01, 0);
        scene.add(kante);
        for (let z = -3.3; z <= 3.31; z += 0.55) {
          if (zufall() < 0.18) continue;
          fans.push({ x: x + (zufall() - 0.5) * 0.12, y: h, z: z + (zufall() - 0.5) * 0.14, team, stick: zufall() < 0.7 });
        }
      }
    });
    // Hinter dem fernen Tor: zwei Reihen, die hintere auf einem Podest.
    kiste(scene, 6.4, 0.26, 0.7, "#2a1d48", [0, 0.13, -5.75], { schatten: false });
    for (let reihe = 0; reihe < 2; reihe += 1) {
      for (let x = -2.9; x <= 2.91; x += 0.52) {
        if (zufall() < 0.15) continue;
        fans.push({ x: x + (zufall() - 0.5) * 0.12, y: reihe ? 0.26 : 0, z: reihe ? -5.75 : -5.05, team: zufall() < 0.5 ? 0 : 1, stick: zufall() < 0.6 });
      }
    }
    const shirts = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b", "#b57bff", "#ff9f43", "#f2f2f2", "#5b6cff"].map((c) => new THREE.Color(c));
    const haut = ["#ffd9b8", "#f1c09a", "#c98e64", "#8d5a3b", "#ffe6cc"].map((c) => new THREE.Color(c));
    const n = fans.length;
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.5, 0.22), new THREE.MeshLambertMaterial({ color: "#ffffff" }), n);
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), new THREE.MeshLambertMaterial({ color: "#ffffff" }), n);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), new THREE.MeshLambertMaterial({ color: "#ffffff" }), n * 2);
    const sticks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.26, 0.05), new THREE.MeshBasicMaterial({ color: "#ffffff" }), n);
    [body, head, arms, sticks].forEach((mesh) => {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.userData.isFx = true;
      scene.add(mesh);
    });
    fans.forEach((fan, i) => {
      // Blickrichtung: von den Seiten quer zum Tisch, von hinten über den
      // Tisch nach vorn, leicht zur Mitte gedreht.
      fan.yaw = Math.abs(fan.x) > 3 ? Math.atan2(-fan.x, 0) : Math.atan2(-fan.x * 0.3, -fan.z);
      fan.phase = zufall() * Math.PI * 2;
      fan.tempo = 0.8 + zufall() * 0.5;
      fan.jump = 0;
      const shirt = shirts[Math.floor(zufall() * shirts.length)];
      body.setColorAt(i, shirt);
      arms.setColorAt(i * 2, shirt);
      arms.setColorAt(i * 2 + 1, shirt);
      head.setColorAt(i, haut[Math.floor(zufall() * haut.length)]);
      sticks.setColorAt(i, new THREE.Color(TEAM_COLORS[fan.team]));
    });
    [body, head, arms, sticks].forEach((mesh) => { if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; });
    // Eine kleine Gelenkkette, mit der jedes Männchen gestellt wird.
    const torso = new THREE.Object3D();
    const rumpf = new THREE.Object3D();
    const kopf = new THREE.Object3D();
    const schulterL = new THREE.Object3D();
    const schulterR = new THREE.Object3D();
    const armL = new THREE.Object3D();
    const armR = new THREE.Object3D();
    const stab = new THREE.Object3D();
    rumpf.position.set(0, 0.25, 0);
    kopf.position.set(0, 0.62, 0);
    // Erst drehen, dann im eigenen Körper neigen und nicken.
    torso.rotation.order = "YXZ";
    kopf.rotation.order = "YXZ";
    schulterL.position.set(-0.2, 0.5, 0);
    schulterR.position.set(0.2, 0.5, 0);
    armL.position.set(0, -0.13, 0);
    armR.position.set(0, -0.13, 0);
    stab.position.set(0, -0.36, 0);
    torso.add(rumpf, kopf, schulterL, schulterR);
    schulterL.add(armL);
    schulterR.add(armR, stab);
    this.crowd = { fans, body, head, arms, sticks, torso, rumpf, kopf, schulterL, schulterR, armL, armR, stab, nullMatrix: new THREE.Matrix4().makeScale(0, 0, 0) };
  }

  buildTable(scene) {
    const w = this.w;
    const l = this.l;
    // Tischkörper und Beine.
    kiste(scene, w + 0.6, TABLE_Y - 0.05, l + 0.6, "#1b1d33", [0, (TABLE_Y - 0.05) / 2, 0]);
    // Spielfläche: dunkel, mit leuchtenden Linien (Glow-Hockey).
    const textur = flaechenTextur(w, l);
    const flaeche = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, l), new THREE.MeshLambertMaterial({ map: textur, emissive: "#ffffff", emissiveMap: textur, emissiveIntensity: 0.6 }));
    flaeche.position.y = TABLE_Y - 0.02;
    flaeche.receiveShadow = true;
    scene.add(flaeche);
    // Banden: dunkles Metall mit Neonleisten — an den Längsseiten lila, an den
    // Stirnseiten in Teamfarbe, in der Mitte das offene Tor.
    this.railStrips = [];
    [-1, 1].forEach((seite) => {
      kiste(scene, 0.22, RAIL_H, l + 0.44, "#3a3f63", [seite * (w / 2 + 0.11), TABLE_Y + RAIL_H / 2 - 0.02, 0]);
      const leiste = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, l + 0.3), new THREE.MeshBasicMaterial({ color: "#b57bff" }));
      leiste.position.set(seite * (w / 2 + 0.11), TABLE_Y + RAIL_H + 0.01, 0);
      scene.add(leiste);
    });
    [[1, 0], [-1, 1]].forEach(([seite, team]) => {
      const z = seite * (l / 2 + 0.11);
      const stueck = (w - this.goalW) / 2;
      [-1, 1].forEach((s) => {
        kiste(scene, stueck + 0.22, RAIL_H, 0.22, "#3a3f63", [s * (this.goalW / 2 + stueck / 2 + 0.11), TABLE_Y + RAIL_H / 2 - 0.02, z]);
        const leiste = new THREE.Mesh(new THREE.BoxGeometry(stueck + 0.2, 0.05, 0.07), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
        leiste.position.set(s * (this.goalW / 2 + stueck / 2 + 0.11), TABLE_Y + RAIL_H + 0.01, z);
        scene.add(leiste);
      });
      // Torschlitz: dunkler Kasten mit leuchtender Kante.
      kiste(scene, this.goalW, 0.3, 0.5, "#06040c", [0, TABLE_Y - 0.2, z + seite * 0.2], { schatten: false });
      const torlicht = new THREE.Mesh(new THREE.BoxGeometry(this.goalW, 0.04, 0.05), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
      torlicht.position.set(0, TABLE_Y + 0.01, z);
      scene.add(torlicht);
      if (team === 0) this.goalLight0 = torlicht;
      else this.goalLight1 = torlicht;
    });
    // Beine.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => kiste(scene, 0.3, TABLE_Y, 0.3, "#14162a", [sx * (w / 2), TABLE_Y / 2 - 0.3, sz * (l / 2 - 0.4)]));
    // Lauflicht rund um den Tischkörper: läuft mit dem Tempo des Pucks und
    // färbt sich bei einem Tor in der Farbe des Schützenteams.
    const leds = [];
    const ledY = TABLE_Y - 0.16;
    const hw = w / 2 + 0.31;
    const hl = l / 2 + 0.31;
    const umfang = 2 * (2 * hw + 2 * hl);
    const schritte = 64;
    for (let i = 0; i < schritte; i += 1) {
      let d = (i / schritte) * umfang;
      let p;
      if (d < 2 * hw) p = [-hw + d, ledY, hl + 0.005];
      else if ((d -= 2 * hw) < 2 * hl) p = [hw + 0.005, ledY, hl - d];
      else if ((d -= 2 * hl) < 2 * hw) p = [hw - d, ledY, -hl - 0.005];
      else { d -= 2 * hw; p = [-hw - 0.005, ledY, -hl + d]; }
      leds.push({ p });
    }
    this.leds = viele(scene, new THREE.BoxGeometry(0.09, 0.07, 0.09), new THREE.MeshBasicMaterial({ color: "#ffffff" }), leds);
    this.ledSpots = leds.map((led) => led.p);
    this.ledPhase = 0;
    this.ledColor = new THREE.Color();
    this.ledTeam = TEAM_COLORS.map((c) => new THREE.Color(c));
    // Luft, die aus den Düsen steigt: feine Lichtpunkte über dem Tisch.
    const anzahl = Math.round(70 * fxScale());
    const pos = new Float32Array(anzahl * 3);
    const zufall = streuer(33);
    this.motes = [];
    for (let i = 0; i < anzahl; i += 1) {
      const m = { x: (zufall() - 0.5) * w * 0.95, z: (zufall() - 0.5) * l * 0.95, y: zufall() * 0.6, v: 0.12 + zufall() * 0.2 };
      this.motes.push(m);
      pos.set([m.x, TABLE_Y + m.y, m.z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.motePoints = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#bfe4ff", size: 0.05, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.motePoints.frustumCulled = false;
    this.motePoints.userData.isFx = true;
    scene.add(this.motePoints);
  }

  // Zwei Scheinwerfer unter der Decke streichen über den Tisch; bei einem Tor
  // richten sie sich auf das Tor.
  buildBeams(scene) {
    this.beams = [TEAM_COLORS[0], TEAM_COLORS[1]].map((farbe, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(i ? 3.2 : -3.2, 8.2, -1.5);
      // Spitze im Drehpunkt, Öffnung entlang −y des Halters; der Halter liegt
      // auf +z, damit lookAt den Kegel aufs Ziel richtet. Die Länge ist die
      // y-Skalierung des Halters.
      const halter = new THREE.Group();
      halter.rotation.x = -Math.PI / 2;
      const kegel = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      kegel.position.y = -0.5;
      kegel.userData.isFx = true;
      halter.add(kegel);
      pivot.add(halter);
      scene.add(pivot);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.glowTex, color: farbe, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      pool.rotation.x = -Math.PI / 2;
      pool.renderOrder = 1;
      pool.userData.isFx = true;
      scene.add(pool);
      return { pivot, halter, kegel, pool, x: 0, z: 0, color: new THREE.Color(farbe), base: new THREE.Color(farbe) };
    });
  }

  shot() {
    return {
      look: [0, TABLE_Y, 0.25],
      frame: { w: this.w + 1.4, h: this.l * Math.sin(0.9) + 1.6 },
      pitch: 0.9,
      fov: 36,
      fill: 0.96,
      intro: { yaw: 0.6, pitch: 0.35, zoom: 1.4 },
      finale: { pull: 0.85, zoom: 0.62, lift: 0.3, orbit: 0.12 }
    };
  }

  // Relativ gesteuert: wo man den Finger aufsetzt, ist egal — gern unterhalb
  // des Tisches, damit nichts verdeckt ist. Der Schläger macht die Bewegung
  // des Fingers mit (etwas verstärkt). Lässt man los, bleibt er stehen. Am
  // Computer gehen auch die Pfeiltasten.
  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Wisch irgendwo – auch unter dem Tisch. Dein Schläger macht die Bewegung mit.</p>`;
    this.controls.style.pointerEvents = "none";
    const surface = this.webglCanvas;
    surface.style.touchAction = "none";
    this.drag = null;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_Y);
    this.touchNode = this.hud.querySelector("[data-hockey-touch]");
    this.on(surface, "pointerdown", (event) => {
      if (this.drag) return;
      event.preventDefault();
      this.capturePointer(surface, event.pointerId);
      this.startDrag(event);
      this.feedback?.vibrate(6);
    });
    this.on(surface, "pointermove", (event) => {
      if (event.pointerId !== this.drag?.id) return;
      event.preventDefault();
      this.moveDrag(event);
    });
    const end = (event) => {
      if (event.pointerId !== this.drag?.id) return;
      this.drag = null;
      if (this.touchNode) this.touchNode.hidden = true;
    };
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => this.on(surface, type, end));
    this.keys = new Set();
    const keyDir = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
    const steerKeys = () => {
      let x = 0;
      let y = 0;
      this.keys.forEach((code) => { x += keyDir[code][0]; y += keyDir[code][1]; });
      const len = Math.hypot(x, y) || 1;
      this.queueInput({ kind: "steer", x: x / len, y: y / len });
    };
    this.on(window, "keydown", (event) => {
      if (!keyDir[event.code] || event.target?.closest?.("input,textarea,select")) return;
      event.preventDefault();
      if (this.keys.has(event.code)) return;
      this.keys.add(event.code);
      steerKeys();
    });
    this.on(window, "keyup", (event) => {
      if (!this.keys.has(event.code)) return;
      this.keys.delete(event.code);
      steerKeys();
    });
  }

  unbind() {
    this.drag = null;
    this.controls.style.pointerEvents = "";
  }

  // Wo steht der eigene Schläger für den Wisch? Fährt er noch auf das zuletzt
  // geschickte Ziel zu, gilt das Ziel — sonst zöge ein neuer Wisch ihn erst
  // ein Stück zurück.
  ownMalletAt() {
    const shown = this.mallets.get(this.getControlledPlayerId())?.group.position;
    const aim = this.inputWanted?.kind === "aim" ? this.inputWanted : null;
    if (aim && shown && Math.hypot(aim.x - shown.x, aim.z - shown.z) < 0.6) return { x: aim.x, z: aim.z };
    return shown ? { x: shown.x, z: shown.z } : null;
  }

  // Tischpunkt → Punkt auf der Zeichenfläche (CSS-Pixel) und zurück.
  toCanvas(x, z, rect) {
    const v = new THREE.Vector3(x, TABLE_Y, z).project(this.camera);
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  fromCanvas(sx, sy, rect) {
    this.ndc.set((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.tablePlane, new THREE.Vector3());
  }

  startDrag(event) {
    const at = this.ownMalletAt();
    if (!at || !this.camera) return;
    const rect = this.webglCanvas.getBoundingClientRect();
    const base = this.toCanvas(at.x, at.z, rect);
    this.drag = { id: event.pointerId, fx: event.clientX, fy: event.clientY, bx: base.x, by: base.y };
    this.showTouch(event);
  }

  moveDrag(event) {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    const entry = arcade?.players?.[this.getControlledPlayerId()];
    const drag = this.drag;
    if (!entry || !drag || !this.camera) return;
    this.showTouch(event);
    const rect = this.webglCanvas.getBoundingClientRect();
    const dx = (event.clientX - drag.fx) * DRAG_GAIN;
    const dy = (event.clientY - drag.fy) * DRAG_GAIN;
    const hit = this.fromCanvas(drag.bx + dx, drag.by + dy, rect);
    if (!hit) return;
    const lim = limits(hockeyRules(arcade), entry.side, entry.r, entry.lane || null);
    const x = Math.max(lim.xMin, Math.min(lim.xMax, hit.x));
    const z = Math.max(lim.zMin, Math.min(lim.zMax, hit.z));
    if (x !== hit.x || z !== hit.z) {
      // Am Rand der Zone: den Anker mitziehen. Sonst müsste der Finger den
      // ganzen Weg über den Rand hinaus erst zurück, bevor sich etwas rührt.
      const back = this.toCanvas(x, z, rect);
      drag.bx = back.x - dx;
      drag.by = back.y - dy;
    }
    this.queueInput({ kind: "aim", x, z });
  }

  // Ein Ring unter dem Finger zeigt, dass der Wisch ankommt.
  showTouch(event) {
    const node = this.touchNode;
    if (!node) return;
    const box = this.hud.getBoundingClientRect();
    const side = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()]?.side ?? 0;
    node.hidden = false;
    node.style.setProperty("--touch", TEAM_COLORS[side]);
    node.style.transform = `translate(${Math.round(event.clientX - box.left)}px, ${Math.round(event.clientY - box.top)}px)`;
  }

  // Ziel oder Stick: geschickt wird, was sich geändert hat, höchstens alle
  // 40 ms; jede Meldung kommt ins Log, damit die Vorausrechnung weiss, ab
  // wann der Server sie hat.
  queueInput(want) {
    this.inputWanted = want;
    this.flushInput();
  }

  flushInput() {
    const want = this.inputWanted;
    const minigame = this.update || this.minigame;
    if (!want || !minigame || minigame.finaleAt) return;
    const clock = performance.now();
    const sent = this.inputSent;
    const same = sent && sent.kind === want.kind && (want.kind === "aim"
      ? Math.abs(want.x - sent.x) < 0.01 && Math.abs(want.z - sent.z) < 0.01
      : Math.abs(want.x - sent.x) < 0.02 && Math.abs(want.y - sent.y) < 0.02);
    if (same && clock - sent.clock < 400) return;
    if (sent && clock - sent.clock < STICK_GAP_MS) return;
    this.inputSent = { ...want, clock };
    this.stickSent = { x: 0, y: 0, clock };
    const at = this.now();
    this.stickLog.push(want.kind === "aim" ? { at, aimX: want.x, aimZ: want.z } : { at, x: want.x, y: want.y, aimX: null, aimZ: null });
    while (this.stickLog.length > 2 && this.stickLog[1].at < at - 3000) this.stickLog.shift();
    const payload = want.kind === "aim" ? { action: "aim", x: want.x, z: want.z } : { action: "steer", x: want.x, y: want.y };
    this.sendInput(payload).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Ohne Stick keine Antworten, also keine Laufzeit: dann misst ein Ping.
  pingIfIdle(minigame) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.stickSent.clock < 1000 || clock - this.lastPingAt < 1000) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Rundreise zum Server, geglättet und wie überall auf 250 ms gedeckelt.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.roundTrip ? this.roundTrip * 0.8 + clamped * 0.2 : clamped;
  }

  // Welchen Stick der Server für den Schritt ab Serverzeit `at` hat: was dieses
  // Gerät eine Rundreise vorher geschickt hat, abzüglich eines halben Takts
  // (der Server liest den Stick einmal je Takt). Kam die Meldung vor dem
  // Serverstand an, steht sie schon in ihm.
  stickAt(at, from, entry) {
    const lands = (sent) => sent.at + this.roundTrip - TICK_LEAD_MS;
    let pick = null;
    for (const sent of this.stickLog) {
      if (lands(sent) <= at) pick = sent;
      else break;
    }
    if (!pick || lands(pick) <= from) return served(entry);
    return { x: pick.x || 0, y: pick.y || 0, aimX: pick.aimX ?? null, aimZ: pick.aimZ ?? null };
  }

  // Der Tisch zu der Serverzeit, zu der ein jetzt geschickter Stick ankommt.
  forecast(f) {
    const { arcade, minigame, players, controlledId } = f;
    const from = arcade.hockeyClock || minigame.sentAt || f.now;
    const endAt = (minigame.startedAt || 0) + (minigame.duration || 0);
    const to = minigame.finaleAt ? from : Math.min(Math.max(from, f.now + this.roundTrip), Math.max(from, endAt));
    const present = new Set(players.map((player) => player.id));
    const ids = (arcade.order || players.map((player) => player.id)).filter((id) => present.has(id) && arcade.players[id]);
    this.view = forecastHockey(arcade, {
      from,
      to,
      ids,
      inputAt: (id, at) => {
        const entry = arcade.players[id];
        return id === controlledId ? this.stickAt(at, from, entry) : served(entry);
      }
    });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId } = f;
    const state = arcade?.hockey;
    if (!state) return;
    this.flushInput();
    this.pingIfIdle(f.minigame);
    this.forecast(f);
    const view = this.view;
    const clock = performance.now();
    const p = view.state.puck;
    const speed = Math.hypot(p.vx, p.vz);

    // Wer zuletzt am Puck war, färbt ihn ein.
    const lastId = view.state.lastTouch;
    const lastSide = lastId === "robot" ? 1 : (lastId ? arcade.players[lastId]?.side ?? -1 : -1);
    if (lastSide !== this.lastTeam) {
      this.lastTeam = lastSide;
      this.puckColor.set(lastSide >= 0 ? TEAM_COLORS[lastSide] : NEUTRAL);
      this.puckCap.material.color.copy(this.puckColor);
      this.puckRim.material.color.copy(this.puckColor);
      this.puckHalo.material.color.copy(this.puckColor);
    }

    // Der Puck, wie er beim Eintreffen des eigenen Sticks liegt. Vor dem
    // Anstoss ist er weg und taucht in der Mitte auf.
    const untilServe = view.state.serveAt - view.at;
    const shown = untilServe < MATERIALIZE_MS;
    const appear = shown ? Math.min(1, 1 - untilServe / MATERIALIZE_MS) : 0;
    const jump = Math.hypot(p.x - this.puck.position.x, p.z - this.puck.position.z) > 1.2;
    if (shown && !this.puck.visible) {
      // Erscheinen: ein Lichtring zieht sich zusammen, ein Plopp.
      this.waves.spawn(0, TABLE_Y + 0.02, 0, "#ffffff", { radius: 0.2, from: 1.4, life: 0.4, opacity: 0.9 });
      this.glows.spawn(0, TABLE_Y + 0.01, 0, NEUTRAL, { size: 1.6, life: 0.5, opacity: 0.7 });
      if (now > f.minigame.startedAt) this.feedback?.sound("pop", { strength: 0.6 });
      this.trail.reset();
    }
    this.puck.visible = shown;
    this.puckHalo.visible = shown;
    this.puck.position.x = jump ? p.x : this.puck.position.x + (p.x - this.puck.position.x) * frameLerp(0.7, dt);
    this.puck.position.z = jump ? p.z : this.puck.position.z + (p.z - this.puck.position.z) * frameLerp(0.7, dt);
    this.puck.position.y = TABLE_Y + 0.05 + (1 - appear) * 0.5;
    this.puck.scale.setScalar(Math.max(0.05, appear));
    this.puck.rotation.y += speed * dt * 2;
    // Schein und Spur: je schneller, desto heller und länger.
    const heat = Math.min(1, speed / 8);
    this.puckHalo.position.set(this.puck.position.x, TABLE_Y + 0.008, this.puck.position.z);
    this.puckHalo.scale.setScalar((0.9 + heat * 0.9) * appear);
    this.puckHalo.material.opacity = 0.35 + heat * 0.45;
    this.trail.update(this.puck.position.x, this.puck.position.z, TABLE_Y + 0.012, this.puckColor, shown ? Math.min(1, Math.max(0, (speed - 1.2) / 5)) : 0, this.puckR * (0.6 + heat * 0.25), 0.5 + heat * 1.1, dt);
    this.watchWalls(f, speed, shown && !jump);

    // Der eigene Stoss: sofort, wenn die Vorausrechnung ihn sieht.
    if (!f.finale) {
      view.events.forEach((event) => {
        if (event.kind === "goal" && event.at > this.goalFxAt) {
          this.goalFxAt = event.at;
          this.sinkPuck(event);
        }
        if (event.kind !== "touch" || event.id !== controlledId || event.at <= this.ownTouchAt) return;
        this.ownTouchAt = event.at;
        this.ownTouchShownAt = clock;
        const own = this.mallets.get(controlledId);
        if (own) own.hit = 1;
        this.impact(event.x, event.z, arcade.players[controlledId]?.side ?? 0, speed, true);
      });
    }
    this.updateGhost(dt);

    // Die Schläger.
    const sieger = f.finale ? ((state.score?.[0] || 0) > (state.score?.[1] || 0) ? 0 : (state.score?.[1] || 0) > (state.score?.[0] || 0) ? 1 : -1) : -1;
    players.forEach((player) => {
      const entry = view.mallets.get(player.id) || arcade.players[player.id];
      const servedEntry = arcade.players[player.id];
      const m = this.mallets.get(player.id);
      if (!entry || !m) return;
      const isOwn = player.id === controlledId;
      // Der eigene Schläger folgt der Vorausrechnung fast ohne Verzug — er
      // IST schon die Antwort auf den Stick.
      const follow = isOwn ? 0.75 : 0.5;
      const g = m.group;
      const px = g.position.x;
      const pz = g.position.z;
      g.position.x += (entry.x - g.position.x) * frameLerp(follow, dt);
      g.position.z += (entry.z - g.position.z) * frameLerp(follow, dt);
      // Neigt sich leicht in die Bewegung, wie unter einer Hand.
      const vx = dt > 0 ? (g.position.x - px) / dt : 0;
      const vz = dt > 0 ? (g.position.z - pz) / dt : 0;
      const fahrt = Math.min(1, Math.hypot(vx, vz) / 5);
      m.body.rotation.z += (Math.max(-0.22, Math.min(0.22, -vx * 0.035)) - m.body.rotation.z) * frameLerp(0.3, dt);
      m.body.rotation.x += (Math.max(-0.22, Math.min(0.22, vz * 0.035)) - m.body.rotation.x) * frameLerp(0.3, dt);
      // Stoss: kurz breiter und flacher, der Ring blitzt weiss; Tor: ein
      // Hüpfer; am Ende hüpft das Siegerteam. Dazwischen schwebt er leicht
      // auf dem Luftkissen.
      m.hit = Math.max(0, m.hit - dt * 5);
      m.hop = Math.max(0, m.hop - dt * 1.6);
      const cheer = sieger === m.side ? Math.max(0, Math.sin(now / 140 + m.r * 7)) * 0.18 : 0;
      const schweben = Math.sin(now / 260 + m.phase) * 0.012;
      g.position.y = TABLE_Y + 0.012 + schweben + Math.sin(m.hop * Math.PI * 2) * 0.12 * m.hop + cheer;
      m.body.scale.set(1 + m.hit * 0.14, 1 - m.hit * 0.18, 1 + m.hit * 0.14);
      m.ring.material.color.copy(m.ringColor).lerp(WHITE, m.hit * 0.8);
      m.glow.material.opacity = 0.3 + fahrt * 0.3 + m.hit * 0.4;
      m.glow.scale.setScalar(1 + fahrt * 0.25 + m.hit * 0.3);
      if (isOwn && this.ownRing) {
        const puls = 0.5 + 0.5 * Math.sin(now / 220);
        this.ownRing.material.opacity = (this.drag ? 0.55 : 0.25) + puls * 0.2;
        this.ownRing.scale.setScalar(1 + puls * 0.06);
      }
      if (f.finale) return;
      // Stösse der anderen (und eigene, die die Vorausrechnung nicht sah)
      // kommen vom Server.
      if ((servedEntry?.touches || 0) > (m.touches ?? servedEntry?.touches ?? 0)) {
        const shownOwn = isOwn && clock - (this.ownTouchShownAt || 0) < 500;
        if (!shownOwn) {
          m.hit = 1;
          this.impact(this.puck.position.x, this.puck.position.z, m.side, speed, isOwn);
        }
      }
      m.touches = servedEntry?.touches || 0;
    });
    const robot = view.state.robot || state.robot;
    if (this.robot && robot) {
      this.robot.position.x += (robot.x - this.robot.position.x) * frameLerp(0.5, dt);
      this.robot.position.z += (robot.z - this.robot.position.z) * frameLerp(0.5, dt);
    }

    // Tore (vom Server bestätigt): das grosse Fest.
    if ((state.goals?.length || 0) > this.seenGoals) {
      const goal = state.goals[state.goals.length - 1];
      this.seenGoals = state.goals.length;
      this.celebrateGoal(f, goal);
    }
    [this.goalLight0, this.goalLight1].forEach((licht, team) => {
      if (!licht) return;
      const flash = clock < (licht.userData.flashUntil || 0);
      licht.material.color.set(flash && Math.floor(now / 90) % 2 ? "#ffffff" : TEAM_COLORS[team]);
    });

    this.sparks.update(dt);
    this.confetti.update(dt);
    this.waves.update(dt);
    this.glows.update(dt);
    this.animateHall(f, speed);
    this.animateCrowd(f);
    this.animateBeams(f);
    this.animateLeds(f, speed);
    this.animateMotes(dt);
  }

  // Ein Stoss: Funken in Stossrichtung, eine Schockwelle, ein Lichtfleck.
  // Harte Schüsse knallen lauter, rütteln das Bild und lassen die Halle
  // raunen.
  impact(x, z, side, speed, own) {
    const k = Math.min(1, speed / 9);
    const farbe = TEAM_COLORS[side] || NEUTRAL;
    const p = this.view?.state.puck;
    const dir = p && Math.hypot(p.vx, p.vz) > 0.3 ? { x: p.vx, z: p.vz } : null;
    this.sparks.spawn(x, TABLE_Y + 0.08, z, [farbe, "#ffffff"], { count: 8 + Math.round(k * 14), speed: 1.4 + k * 3.2, up: 0.9, life: 0.32 + k * 0.2, gravity: 4, drag: 3, dir, cone: 1.6 });
    this.waves.spawn(x, TABLE_Y + 0.02, z, farbe, { radius: 0.45 + k * 0.6, life: 0.3 + k * 0.12, opacity: 0.85 });
    this.glows.spawn(x, TABLE_Y + 0.01, z, farbe, { size: 1.2 + k * 1.4, life: 0.3, opacity: 0.6 + k * 0.3 });
    const pan = Math.max(-1, Math.min(1, x / (this.w / 2)));
    if (own) {
      this.feedback?.sound("clack", { pan, strength: 0.8 + k * 0.5, pitch: 0.9 + k * 0.3 });
      this.feedback?.vibrate(speed > HARD_HIT ? 18 : 10);
    } else {
      this.feedback?.sound("clack", { pan, strength: 0.4 + k * 0.4, pitch: 0.95 + k * 0.2 });
    }
    if (speed > HARD_HIT) {
      this.rig.shake(0.1 + (k - 0.7) * 0.3);
      this.ooh = Math.min(1, this.ooh + 0.6);
      this.waves.spawn(x, TABLE_Y + 0.02, z, "#ffffff", { radius: 1.2, life: 0.4, opacity: 0.45 });
    }
  }

  // Banden: der gezeigte Puck kehrt an der Wand um → Funken, die Leiste
  // blitzt an der Stelle auf, ein heller Klick.
  watchWalls(f, speed, live) {
    const pos = this.puck.position;
    const prev = this.prevPuck;
    // Nach einem Sprung (Anstoss) zählt die Bewegung nicht als Tempo.
    this.prevPuck = live ? { x: pos.x, z: pos.z, vx: prev ? (pos.x - prev.x) / f.dt : 0, vz: prev ? (pos.z - prev.z) / f.dt : 0 } : null;
    if (!prev || !live || f.finale) return;
    const now = performance.now();
    const vx = this.prevPuck.vx;
    const vz = this.prevPuck.vz;
    const halfW = this.w / 2 - this.puckR;
    const halfL = this.l / 2 - this.puckR;
    const hit = (x, z, v, axis) => {
      if (now - this.wallAt[axis] < 140 || Math.abs(v) < 1) return;
      this.wallAt[axis] = now;
      const k = Math.min(1, Math.abs(v) / 8);
      const farbe = axis === "x" ? "#c79bff" : TEAM_COLORS[z > 0 ? 0 : 1];
      this.sparks.spawn(x, TABLE_Y + 0.12, z, [farbe, "#ffffff"], { count: 5 + Math.round(k * 8), speed: 1 + k * 2, up: 1.2, life: 0.3, gravity: 5, drag: 3 });
      this.glows.spawn(x, TABLE_Y + RAIL_H + 0.02, z, farbe, { size: 0.9 + k * 1.1, life: 0.35, opacity: 0.9 });
      this.feedback?.sound("bank", { pan: Math.max(-1, Math.min(1, x / (this.w / 2))), strength: 0.5 + k * 0.6, pitch: 0.9 + k * 0.35 });
    };
    if (Math.abs(pos.x) > halfW - 0.06 && Math.sign(prev.vx || 0) === Math.sign(pos.x) && Math.sign(vx) !== Math.sign(prev.vx || 0)) {
      hit(Math.sign(pos.x) * (this.w / 2 + 0.02), pos.z, prev.vx, "x");
    }
    const inMouth = Math.abs(pos.x) < this.goalW / 2 - this.puckR * 0.4;
    if (!inMouth && Math.abs(pos.z) > halfL - 0.06 && Math.sign(prev.vz || 0) === Math.sign(pos.z) && Math.sign(vz) !== Math.sign(prev.vz || 0)) {
      hit(pos.x, Math.sign(pos.z) * (this.l / 2 + 0.02), prev.vz, "z");
    }
  }

  // Vorausgesehenes Tor: der Puck rutscht in den Schlitz und versinkt, das
  // Tor leuchtet auf. Gefeiert wird erst, wenn der Server es bestätigt.
  sinkPuck(event) {
    const zSign = event.side === 1 ? 1 : -1;
    const x = Math.max(-this.goalW / 2 + this.puckR, Math.min(this.goalW / 2 - this.puckR, event.x || this.puck.position.x));
    this.ghostState = { x, z: zSign * (this.l / 2 - 0.05), vz: zSign * 3.2, age: 0 };
    this.ghost.material.color.copy(this.puckColor).lerp(WHITE, 0.5);
    this.ghost.visible = true;
    this.glows.spawn(x, TABLE_Y + 0.02, zSign * (this.l / 2 + 0.1), TEAM_COLORS[event.side], { size: 2.6, life: 0.6, opacity: 1 });
    this.sparks.spawn(x, TABLE_Y + 0.05, zSign * (this.l / 2 + 0.15), [TEAM_COLORS[event.side], "#ffffff", NEUTRAL], { count: 22, speed: 1.6, up: 4.2, life: 0.8, gravity: 7, drag: 1.2 });
    this.trail.reset();
  }

  updateGhost(dt) {
    const g = this.ghostState;
    if (!g) return;
    g.age += dt;
    g.z += g.vz * dt;
    const t = g.age / 0.4;
    this.ghost.position.set(g.x, TABLE_Y + 0.05 - t * t * 0.45, g.z);
    this.ghost.material.opacity = Math.max(0, 1 - t);
    if (t >= 1) {
      this.ghost.visible = false;
      this.ghostState = null;
    }
  }

  celebrateGoal(f, goal) {
    const { arcade, players, controlledId } = f;
    const z = goal.side === 1 ? this.l / 2 : -this.l / 2;
    const x = goal.x || 0;
    const farbe = TEAM_COLORS[goal.side];
    // Die Schrift steht vor dem Tor auf dem Tisch — am Tor selbst lag sie
    // hinten unter der Teamleiste.
    const schrift = new THREE.Vector3(0, TABLE_Y + 0.9, z * 0.62);
    // Konfetti aus beiden Ecken der Torseite und ein Feuerwerk über dem Tor.
    [-1, 1].forEach((s) => {
      this.confetti.spawn(s * (this.w / 2 - 0.1), TABLE_Y + 0.3, z, [farbe, "#ffffff", NEUTRAL], { count: 28, speed: 1.6, up: 5.2, life: 1.6, gravity: 5, drag: 1.4, dir: { x: -s, z: -Math.sign(z) }, cone: 1.2 });
    });
    this.sparks.spawn(x, TABLE_Y + 0.6, z, [farbe, "#ffffff", NEUTRAL], { count: 34, speed: 3.4, up: 3.4, life: 0.9, gravity: 4, drag: 1.6 });
    this.waves.spawn(x, TABLE_Y + 0.03, z, farbe, { radius: 2.4, life: 0.7, opacity: 0.9 });
    this.waves.spawn(x, TABLE_Y + 0.03, z, "#ffffff", { radius: 1.4, life: 0.5, opacity: 0.7 });
    const shooter = goal.by ? players.find((pl) => pl.id === goal.by) : null;
    this.pop(schrift, goal.own ? "EIGENTOR!" : "TOR!", { color: "#ffe36b", size: 0.8, life: 1.5 });
    const torschuetze = shooter && this.mallets.get(shooter.id);
    if (torschuetze && !goal.own) torschuetze.hop = 1;
    this.rig.shake(0.45);
    this.hype[goal.side] = 1;
    this.hype[1 - goal.side] = Math.min(this.hype[1 - goal.side], 0);
    this.ledFlash = { until: performance.now() + 1500, color: new THREE.Color(farbe) };
    this.beamFocus = { until: performance.now() + 1600, x, z, color: new THREE.Color(farbe) };
    const own = arcade.players[controlledId];
    this.feedback?.sound("horn");
    this.feedback?.sound("cheer");
    if (own) {
      const ours = own.side === goal.side;
      this.feedback?.sound(ours ? "win" : "error");
      this.feedback?.vibrate(ours ? [20, 30, 50] : 40);
      this.flash(farbe, goal.side === 1 ? "100%" : "0%");
    }
    // Das Tor, in dem der Puck liegt, blinkt.
    const hitLight = goal.side === 1 ? this.goalLight0 : this.goalLight1;
    if (hitLight) hitLight.userData.flashUntil = performance.now() + 1200;
  }

  // Bildschirmblitz in der Farbe des Schützenteams, vom Tor her.
  flash(color, y) {
    const node = this.hud.querySelector("[data-hockey-flash]");
    if (!node || prefersReducedMotion()) return;
    node.style.setProperty("--flash", color);
    node.style.setProperty("--flash-y", y);
    node.hidden = false;
    node.classList.remove("is-on");
    void node.offsetWidth;
    node.classList.add("is-on");
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { node.hidden = true; node.classList.remove("is-on"); }, 750);
  }

  onFinale(f) {
    const score = f.arcade?.hockey?.score || [0, 0];
    const sieger = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1;
    const farben = sieger >= 0 ? [TEAM_COLORS[sieger], "#ffffff", NEUTRAL] : [...TEAM_COLORS, NEUTRAL];
    if (sieger >= 0) this.hype[sieger] = 1;
    // Konfettiregen über dem Tisch, in Wellen.
    [0, 350, 700, 1050].forEach((ms, i) => setTimeout(() => {
      if (!this.confetti) return;
      [-1, 1].forEach((s) => this.confetti.spawn(s * (this.w / 2), TABLE_Y + 0.4, (i % 2 ? -1 : 1) * this.l * 0.25, farben, { count: 22, speed: 1.4, up: 5.5, life: 1.8, gravity: 4.5, drag: 1.2, dir: { x: -s, z: 0 }, cone: 1.4 }));
    }, ms));
    this.feedback?.sound("cheer");
  }

  animateHall(f, speed) {
    const { now, dt } = f;
    this.screens.forEach((s) => {
      const k = 0.65 + 0.35 * Math.sin(now / 240 + s.phase * 3) * Math.sin(now / 90 + s.phase);
      s.mesh.material.color.copy(s.base).multiplyScalar(k);
    });
    if (this.glowTiles) {
      const colors = ["#ff3b8d", "#2fd6ff", "#b57bff", "#ffd15c"];
      const beat = Math.floor(now / 460);
      for (let i = 0; i < this.glowCount; i += 1) this.glowTiles.setColorAt(i, this.tileColor.set(colors[(i + beat) % colors.length]).multiplyScalar(0.32));
      this.glowTiles.instanceColor.needsUpdate = true;
    }
    if (this.neon) {
      // Ab und zu flackert eine Röhre.
      const flacker = Math.sin(now / 1700) > 0.97 && Math.random() < 0.5;
      this.neon.material.opacity = flacker ? 0.35 : 1;
    }
    if (this.discoBall) this.discoBall.rotation.y += dt * (0.8 + speed * 0.05);
    if (this.spots) {
      const o = (this._o ||= new THREE.Object3D());
      this.spotSeeds.forEach((sp, i) => {
        const a = sp.a + now / 1000 * 0.35;
        o.position.set(Math.cos(a) * sp.r, 0.015, -1 + Math.sin(a) * sp.r);
        o.rotation.set(-Math.PI / 2, 0, 0);
        o.scale.setScalar(sp.size * 1.6);
        o.updateMatrix();
        this.spots.setMatrixAt(i, o.matrix);
      });
      this.spots.instanceMatrix.needsUpdate = true;
    }
  }

  animateCrowd(f) {
    const c = this.crowd;
    if (!c) return;
    const { now, dt, finale } = f;
    const t = now / 1000;
    this.hype = this.hype.map((h) => Math.max(0, h - dt * 0.45));
    this.ooh = Math.max(0, this.ooh - dt * 1.4);
    const puck = this.puck.position;
    c.fans.forEach((fan, i) => {
      const hype = finale ? Math.max(this.hype[fan.team], 0.35) : this.hype[fan.team];
      const traurig = !finale && this.hype[1 - fan.team] > 0.4 ? this.hype[1 - fan.team] : 0;
      // Springen: im Jubel hoch und im Takt, sonst ein leichtes Wippen.
      const takt = t * fan.tempo * (2.2 + hype * 4) + fan.phase;
      const wippen = Math.abs(Math.sin(takt)) * (0.03 + hype * 0.32 + this.ooh * 0.05);
      c.torso.position.set(fan.x, fan.y + wippen - traurig * 0.05, fan.z);
      c.torso.rotation.set(traurig * 0.25, fan.yaw, Math.sin(takt * 0.5) * 0.06);
      // Der Kopf folgt dem Puck (nicht weiter als über die Schulter).
      const blick = Math.atan2(puck.x - fan.x, puck.z - fan.z) - fan.yaw;
      const kopf = Math.atan2(Math.sin(blick), Math.cos(blick));
      c.kopf.rotation.set(traurig * 0.5, Math.max(-0.9, Math.min(0.9, kopf)), 0);
      // Arme: hängen, beim Jubel hoch und winkend, beim Raunen halb hoch.
      const hoch = Math.min(1, hype * 1.6 + this.ooh * 0.5);
      const winken = Math.sin(t * 9 + fan.phase) * 0.35 * hoch;
      c.schulterL.rotation.set(0, 0, -(0.12 + hoch * 2.5 + winken));
      c.schulterR.rotation.set(0, 0, 0.12 + hoch * 2.5 - winken + (fan.stick ? Math.sin(t * 3 + fan.phase) * 0.25 : 0));
      c.torso.updateMatrixWorld(true);
      c.body.setMatrixAt(i, c.rumpf.matrixWorld);
      c.head.setMatrixAt(i, c.kopf.matrixWorld);
      c.arms.setMatrixAt(i * 2, c.armL.matrixWorld);
      c.arms.setMatrixAt(i * 2 + 1, c.armR.matrixWorld);
      c.sticks.setMatrixAt(i, fan.stick ? c.stab.matrixWorld : c.nullMatrix);
    });
    c.body.instanceMatrix.needsUpdate = true;
    c.head.instanceMatrix.needsUpdate = true;
    c.arms.instanceMatrix.needsUpdate = true;
    c.sticks.instanceMatrix.needsUpdate = true;
  }

  animateBeams(f) {
    if (!this.beams) return;
    const { now, dt } = f;
    const focus = performance.now() < this.beamFocus.until;
    this.beams.forEach((beam, i) => {
      const a = now / 1000 * (0.42 + i * 0.13) + i * 2.1;
      const tx = focus ? this.beamFocus.x : Math.sin(a) * (this.w / 2 + 0.6);
      const tz = focus ? this.beamFocus.z : Math.cos(a * 0.8) * (this.l / 2);
      beam.x += (tx - beam.x) * frameLerp(focus ? 0.25 : 0.08, dt);
      beam.z += (tz - beam.z) * frameLerp(focus ? 0.25 : 0.08, dt);
      const ziel = (this._beamTarget ||= new THREE.Vector3()).set(beam.x, TABLE_Y, beam.z);
      beam.pivot.lookAt(ziel);
      const lang = beam.pivot.position.distanceTo(ziel);
      const breit = focus ? 0.9 : 0.7;
      beam.halter.scale.set(breit, lang, breit);
      beam.color.copy(focus ? this.beamFocus.color : beam.base);
      const blitz = focus && Math.floor(now / 110) % 2 ? 1.6 : 1;
      beam.kegel.material.color.copy(beam.color);
      beam.kegel.material.opacity = 0.07 * blitz;
      beam.pool.material.color.copy(beam.color);
      beam.pool.position.set(beam.x, TABLE_Y + 0.006, beam.z);
      beam.pool.scale.setScalar(breit * 2.6);
      beam.pool.material.opacity = 0.28 * blitz;
    });
  }

  animateLeds(f, speed) {
    if (!this.leds) return;
    const { now, dt } = f;
    this.ledPhase += dt * (3 + speed * 1.4);
    const flash = performance.now() < this.ledFlash.until ? this.ledFlash.color : null;
    const n = this.ledSpots.length;
    for (let i = 0; i < n; i += 1) {
      const lauf = Math.pow(Math.max(0, Math.sin(this.ledPhase - i * 0.42)), 6);
      if (flash) {
        const an = Math.floor(now / 100 + i) % 2 ? 1 : 0.25;
        this.ledColor.copy(flash).multiplyScalar(an);
      } else {
        const team = this.ledSpots[i][2] > 0 ? 0 : 1;
        this.ledColor.copy(this.ledTeam[team]).multiplyScalar(0.18 + lauf * 0.82);
      }
      this.leds.setColorAt(i, this.ledColor);
    }
    this.leds.instanceColor.needsUpdate = true;
  }

  animateMotes(dt) {
    if (!this.motePoints) return;
    const pos = this.motePoints.geometry.attributes.position;
    const puck = this.puck.position;
    this.motes.forEach((m, i) => {
      m.y += m.v * dt;
      // Der Puck wirbelt die Luft auf.
      const dx = m.x - puck.x;
      const dz = m.z - puck.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6 && d > 0.01) {
        m.x += (dx / d) * dt * 0.8;
        m.z += (dz / d) * dt * 0.8;
      }
      if (m.y > 0.65) {
        m.y = 0;
        m.x = (Math.random() - 0.5) * this.w * 0.95;
        m.z = (Math.random() - 0.5) * this.l * 0.95;
      }
      pos.setXYZ(i, m.x, TABLE_Y + 0.02 + m.y, m.z);
    });
    pos.needsUpdate = true;
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.hockey;
    if (!state) return;
    const own = arcade.players[controlledId];
    const ownSide = own?.side ?? 0;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = `${state.score[ownSide]} : ${state.score[1 - ownSide]}`;
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const teams = this.hud.querySelector("[data-hockey-teams]");
    if (teams) {
      const html = [ownSide, 1 - ownSide].map((side) => {
        const members = room.players.filter((player) => arcade.players[player.id]?.side === side);
        const names = members.length
          ? members.map((player) => `<b style="--chip:${player.color}">${escapeName(player.name)}</b>`).join("")
          : "<b style=\"--chip:#9aa6b8\">Roboter</b>";
        return `<div class="tug-team${side === ownSide ? " is-own" : ""}" style="box-shadow: inset 0 0 0 2px ${TEAM_COLORS[side]}">${names}<span class="hockey-goals">${state.score[side]}</span></div>`;
      }).join("<span class=\"tug-vs\">vs</span>");
      if (html !== this.teamsHtml) {
        this.teamsHtml = html;
        teams.innerHTML = html;
        // Die Zahl des Teams, das gerade getroffen hat, springt kurz auf.
        [ownSide, 1 - ownSide].forEach((side, i) => {
          if ((state.score[side] || 0) > this.scoreSeen[side]) teams.children[i * 2]?.querySelector(".hockey-goals")?.classList.add("is-bump");
        });
        this.scoreSeen = [state.score[0] || 0, state.score[1] || 0];
      }
    }
    // Die letzten zehn Sekunden: die Uhr pulsiert rot.
    const rest = minigame.startedAt + minigame.duration - now;
    this.scorebar ||= this.hud.querySelector(".kinetic-scorebar");
    this.scorebar?.classList.toggle("pump-hurry", !minigame.finaleAt && rest <= 10000 && rest > 0);
    const banner = this.hud.querySelector("[data-hockey-banner]");
    const serving = now < state.serveAt;
    let message = null;
    let tone = "#b57bff";
    const last = state.goals?.[state.goals.length - 1];
    const win = state.win || 5;
    if (now < minigame.startedAt + 1500) message = ownSide === 0 ? "Dein Tor ist unten!" : "Dein Tor ist oben!";
    else if (serving && last && now - last.at < 1300) {
      const ours = last.side === ownSide;
      const name = last.by ? escapeName(room.players.find((player) => player.id === last.by)?.name) : "";
      if (last.own) message = ours ? "Eigentor der Gegner! 🎉" : "Eigentor …";
      else message = ours ? (name ? `TOR von ${name}! 🎉` : "TOR! 🎉") : (name ? `Gegentor – ${name} trifft` : "Gegentor …");
      tone = ours ? "#ffc400" : "#ff3b8d";
    } else if (serving && last && now - last.at < 2600 && Math.max(...state.score) === win - 1) {
      const ours = state.score[ownSide] === win - 1;
      const beide = state.score[0] === state.score[1];
      message = beide ? "Matchball für beide!" : ours ? "Matchball – noch ein Tor!" : "Matchball für die Gegner!";
      tone = ours ? "#ffc400" : "#ff3b8d";
    } else if (rest <= 10000 && rest > 8200) {
      message = "Letzte 10 Sekunden!";
      tone = "#ff3b52";
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
      banner.style.color = tone === "#ffc400" ? "#5c4508" : "#ffffff";
    }
  }
}

const WHITE = new THREE.Color("#ffffff");

// --- Effekt-Töpfe ------------------------------------------------------------
// Funken und Konfetti als EINE InstancedMesh je Art: vorher bekam jeder
// Splitter ein eigenes Mesh samt Geometrie und Material — bei einem Tor mit
// Konfetti aus zwei Ecken wären das über hundert Zeichenaufrufe gewesen.
class Splitter {
  constructor(scene, { capacity, size, additive, floor = () => 0.02 }) {
    this.floor = floor;
    const material = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive
    });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, WHITE);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.userData.isFx = true;
    scene.add(this.mesh);
    this.capacity = capacity;
    this.items = [];
    this.o = new THREE.Object3D();
    this.colors = new Map();
  }

  color(value) {
    if (!this.colors.has(value)) this.colors.set(value, new THREE.Color(value));
    return this.colors.get(value);
  }

  spawn(x, y, z, colors, { count = 8, speed = 2, up = 1.5, life = 0.5, gravity = 6, drag = 2, dir = null, cone = Math.PI * 2 } = {}) {
    const total = Math.max(1, Math.round(count * fxScale()));
    const base = dir ? Math.atan2(dir.z, dir.x) : 0;
    for (let i = 0; i < total && this.items.length < this.capacity; i += 1) {
      const a = dir ? base + (Math.random() - 0.5) * cone : Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.items.push({
        x, y, z,
        vx: Math.cos(a) * s,
        vy: up * (0.3 + Math.random() * 0.9),
        vz: Math.sin(a) * s,
        age: 0,
        life: life * (0.7 + Math.random() * 0.6),
        gravity,
        drag,
        size: 0.6 + Math.random() * 0.8,
        spin: (Math.random() - 0.5) * 14,
        color: this.color(colors[i % colors.length])
      });
    }
  }

  update(dt) {
    const o = this.o;
    let n = 0;
    for (let i = 0; i < this.items.length; i += 1) {
      const it = this.items[i];
      it.age += dt;
      if (it.age >= it.life) continue;
      const damp = Math.exp(-it.drag * dt);
      it.vx *= damp;
      it.vz *= damp;
      it.vy = it.vy * damp - it.gravity * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      const boden = this.floor(it.x, it.z);
      if (it.y < boden && it.vy < 0) { it.y = boden; it.vy *= -0.3; it.vx *= 0.6; it.vz *= 0.6; }
      const t = it.age / it.life;
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(it.spin * it.age, it.spin * it.age * 0.7, 0);
      o.scale.setScalar(it.size * Math.pow(1 - t, 0.6));
      o.updateMatrix();
      this.mesh.setMatrixAt(n, o.matrix);
      this.mesh.setColorAt(n, it.color);
      this.items[n] = it;
      n += 1;
    }
    this.items.length = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

// Schockwellen: flache Ringe, die sich ausbreiten und verblassen.
class Wellen {
  constructor(scene, count) {
    // Gross gebaut und klein skaliert: die Blockform gibt grossen Ringen mehr
    // Ecken — ein Ring mit Radius 1 wurde zum groben Zehneck.
    const roh = new THREE.RingGeometry(2.1, 2.5, 48);
    const geometry = blockform(roh) || roh;
    this.items = [];
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.userData.isFx = true;
      scene.add(mesh);
      this.items.push({ mesh, age: 0, life: 1, radius: 1, from: 0.1, opacity: 1 });
    }
  }

  spawn(x, y, z, color, { radius = 1, life = 0.4, opacity = 0.8, from = 0.12 } = {}) {
    const item = this.items.find((it) => !it.mesh.visible) || this.items.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    Object.assign(item, { age: 0, life, radius, from, opacity });
    item.mesh.position.set(x, y, z);
    item.mesh.material.color.set(color);
    item.mesh.visible = true;
  }

  update(dt) {
    this.items.forEach((it) => {
      if (!it.mesh.visible) return;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.mesh.visible = false; return; }
      const eased = 1 - Math.pow(1 - t, 3);
      it.mesh.scale.setScalar(Math.max(0.004, (it.from + (it.radius - it.from) * eased) / 2.5));
      it.mesh.material.opacity = it.opacity * (1 - t);
    });
  }
}

// Lichtflecken: weiche, additive Scheiben, die kurz aufleuchten.
class Leuchten {
  constructor(scene, texture, count) {
    this.items = [];
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, color: "#ffffff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.userData.isFx = true;
      scene.add(mesh);
      this.items.push({ mesh, age: 0, life: 1, size: 1, opacity: 1 });
    }
  }

  spawn(x, y, z, color, { size = 1, life = 0.35, opacity = 0.8 } = {}) {
    const item = this.items.find((it) => !it.mesh.visible) || this.items.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    Object.assign(item, { age: 0, life, size, opacity });
    item.mesh.position.set(x, y, z);
    item.mesh.material.color.set(color);
    item.mesh.visible = true;
  }

  update(dt) {
    this.items.forEach((it) => {
      if (!it.mesh.visible) return;
      it.age += dt;
      const t = it.age / it.life;
      if (t >= 1) { it.mesh.visible = false; return; }
      it.mesh.scale.setScalar(it.size * (0.8 + t * 0.4));
      it.mesh.material.opacity = it.opacity * (1 - t) * (1 - t);
    });
  }
}

// Leuchtspur hinter dem Puck: ein Band aus Vierecken, das sich zum Ende hin
// verjüngt und verblasst.
class Spur {
  constructor(scene, n) {
    this.n = n;
    this.points = [];
    this.strength = 0;
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const index = [];
    for (let i = 0; i < n - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.userData.isFx = true;
    scene.add(this.mesh);
  }

  reset() {
    this.points.length = 0;
    this.strength = 0;
  }

  // `length`: so lang darf die Spur höchstens sein (Welteinheiten). Vorher
  // hing sie an der Zahl der Punkte, und ein schneller Puck zog ein Band
  // quer über den halben Tisch.
  update(x, z, y, color, strength, width, length, dt) {
    const head = this.points[0];
    if (!head || Math.hypot(x - head.x, z - head.z) > 0.04) {
      this.points.unshift({ x, z });
      if (this.points.length > this.n) this.points.pop();
    } else {
      head.x = x;
      head.z = z;
    }
    let summe = 0;
    for (let i = 1; i < this.points.length; i += 1) {
      summe += Math.hypot(this.points[i].x - this.points[i - 1].x, this.points[i].z - this.points[i - 1].z);
      if (summe > length) { this.points.length = i + 1; break; }
    }
    this.strength += (strength - this.strength) * frameLerp(0.2, dt);
    const pts = this.points;
    const count = pts.length;
    this.mesh.visible = count > 1 && this.strength > 0.02;
    if (!this.mesh.visible) return;
    for (let i = 0; i < this.n; i += 1) {
      const p = pts[Math.min(i, count - 1)];
      const a = pts[Math.max(0, Math.min(i, count - 1) - 1)];
      const b = pts[Math.min(count - 1, i + 1)];
      let dx = a.x - b.x;
      let dz = a.z - b.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const t = Math.min(i, count - 1) / (this.n - 1);
      const half = width * (1 - t) * (i < count ? 1 : 0);
      this.pos.set([p.x - dz * half, y, p.z + dx * half, p.x + dz * half, y, p.z - dx * half], i * 6);
      const alpha = this.strength * Math.pow(1 - t, 1.4) * 0.75;
      const r = color.r + (1 - color.r) * (1 - t) * 0.2;
      const g = color.g + (1 - color.g) * (1 - t) * 0.2;
      const bl = color.b + (1 - color.b) * (1 - t) * 0.2;
      this.col.set([r, g, bl, alpha, r, g, bl, alpha], i * 8);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

// Weicher Lichtfleck: weiss in der Mitte, nach aussen durchsichtig.
function leuchtTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const verlauf = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  verlauf.addColorStop(0, "rgba(255,255,255,1)");
  verlauf.addColorStop(0.35, "rgba(255,255,255,0.55)");
  verlauf.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = verlauf;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Die Spielfläche: dunkel, die eigene Hälfte leicht in der Teamfarbe, mit
// Luftlöchern und leuchtenden Linien.
function flaechenTextur(w, l) {
  const canvas = document.createElement("canvas");
  const W = 512;
  canvas.width = W;
  canvas.height = Math.round(W * (l / w));
  const ctx = canvas.getContext("2d");
  const H = canvas.height;
  const grund = ctx.createLinearGradient(0, 0, 0, H);
  grund.addColorStop(0, "#0c2340");
  grund.addColorStop(0.5, "#14112e");
  grund.addColorStop(1, "#2a0f33");
  ctx.fillStyle = grund;
  ctx.fillRect(0, 0, W, H);
  // Luftlöcher.
  ctx.fillStyle = "rgba(140, 170, 255, 0.22)";
  for (let y = 10; y < H; y += 18) for (let x = 10; x < W; x += 18) ctx.fillRect(x, y, 3, 3);
  const linie = (farbe, breite, zeichne) => {
    ctx.save();
    ctx.strokeStyle = farbe;
    ctx.lineWidth = breite;
    ctx.shadowColor = farbe;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    zeichne();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = breite * 0.45;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.stroke();
    ctx.restore();
  };
  // Rand, Mittellinie, Mittelkreis, Torräume.
  linie("#7a5cff", 5, () => ctx.rect(6, 6, W - 12, H - 12));
  linie("#c08bff", 9, () => { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); });
  linie("#c08bff", 8, () => ctx.arc(W / 2, H / 2, 86, 0, Math.PI * 2));
  linie(TEAM_COLORS[1], 9, () => ctx.arc(W / 2, 0, 128, 0, Math.PI));
  linie(TEAM_COLORS[0], 9, () => ctx.arc(W / 2, H, 128, Math.PI, Math.PI * 2));
  // Anstosspunkt und vier Bullys.
  ctx.fillStyle = "#e9d8ff";
  ctx.shadowColor = "#c08bff";
  ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 10, 0, Math.PI * 2); ctx.fill();
  [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].forEach(([fx, fy]) => {
    ctx.fillStyle = fy < 0.5 ? TEAM_COLORS[1] : TEAM_COLORS[0];
    ctx.shadowColor = ctx.fillStyle;
    ctx.beginPath(); ctx.arc(W * fx, H * fy, 7, 0, Math.PI * 2); ctx.fill();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function neonTextur(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext("2d");
  ctx.font = "900 84px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ff3b8d";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#ffd0ea";
  ctx.fillText(text, 256, 58);
  ctx.shadowBlur = 8;
  ctx.fillText(text, 256, 58);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}

// Ein Airhockey-Schläger: flacher Fuss, Neonring, kegeliger Aufbau, Griff
// mit Knauf. `body` neigt und staucht sich, `group` trägt die Position.
function buildMallet(color, ringColor, r, glowTex) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hell = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.18);
  const dunkel = new THREE.Color(color).lerp(new THREE.Color("#000000"), 0.25);
  const fuss = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, 0.08, 32), lambert(color));
  fuss.position.y = 0.04;
  fuss.castShadow = true;
  body.add(fuss);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.93, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: ringColor }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.085;
  body.add(ring);
  const aufbau = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.8, 0.1, 28), lambert(color));
  aufbau.position.y = 0.13;
  aufbau.castShadow = true;
  body.add(aufbau);
  const griff = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.3, 0.18, 20), new THREE.MeshLambertMaterial({ color: dunkel }));
  griff.position.y = 0.27;
  griff.castShadow = true;
  body.add(griff);
  const knauf = new THREE.Mesh(new THREE.SphereGeometry(r * 0.36, 20, 14), new THREE.MeshLambertMaterial({ color: hell }));
  knauf.scale.y = 0.8;
  knauf.position.y = 0.38;
  knauf.castShadow = true;
  body.add(knauf);
  // Ein weicher Schein in der Ringfarbe unter dem Fuss.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(r * 3.2, r * 3.2), new THREE.MeshBasicMaterial({ map: glowTex, color: ringColor, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.004;
  glow.userData.isFx = true;
  group.add(glow);
  return { group, body, ring, glow, ringColor: new THREE.Color(ringColor) };
}

// Was der Server von einem Schläger hat: Stick oder Ziel.
function served(entry) {
  return { x: entry.dirX || 0, y: entry.dirZ || 0, aimX: entry.aimX ?? null, aimZ: entry.aimZ ?? null };
}
