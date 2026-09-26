import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Luftpuck — ein riesiger Airhockey-Tisch in einer Neon-Spielhalle. Jeder
// steht auf einer Schwebescheibe in seiner Hälfte und schiebt den Puck. Das
// eigene Tor liegt für Team 0 vorn, für Team 1 hinten; die Banden leuchten in
// der Farbe des Teams, das sie verteidigt.
//
// Drumherum: Spielautomaten mit flimmernden Bildschirmen, ein Greifautomat,
// Neonschriften, eine Discokugel, die Lichtpunkte über den Boden wirft, und
// ein Punktestand über dem Tisch.
const TABLE_Y = 0.5;
const RAIL_H = 0.22;
const TEAM_COLORS = ["#ff3b8d", "#2fd6ff"];

export class AirHockey extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lastServerAt = performance.now();
    this.discs = new Map();
    this.seenGoals = 0;
    this.labelY = 0.8;
    this.screens = [];
    this.spots = null;
    this.lastTouch = null;
  }

  stage() {
    return {
      label: "3D Luftpuck",
      background: "#12081f",
      fog: ["#12081f", 18, 44],
      lights: { sunPosition: [2, 12, 6], sunColor: 0xfff0ff, sunIntensity: 2.2, hemiIntensity: 1.5, skyColor: 0xb8a8ff, groundColor: 0x3a1a5a, fillColor: 0x6a4aff, fillIntensity: 0.9, shadow: { left: -4, right: 4, top: 5, bottom: -5 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0 : 0</strong></div>
      <div class="tug-teams" data-hockey-teams></div>
      <div class="color-banner" data-hockey-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame?.arcade;
    const state = arcade?.hockey;
    this.w = state?.w ?? 4.4;
    this.l = state?.l ?? 7.4;
    this.goalW = state?.goalW ?? 2.2;
    this.puckR = state?.puckR ?? 0.22;
    this.buildHall(scene);
    this.buildTable(scene);

    // Puck: flache Scheibe mit leuchtendem Rand.
    this.puck = new THREE.Group();
    const scheibe = new THREE.Mesh(new THREE.CylinderGeometry(this.puckR, this.puckR, 0.09, 24), lambert("#1c1c28"));
    scheibe.castShadow = true;
    this.puck.add(scheibe);
    const rand = new THREE.Mesh(new THREE.TorusGeometry(this.puckR, 0.025, 6, 24), new THREE.MeshBasicMaterial({ color: "#ffe25c" }));
    rand.rotation.x = Math.PI / 2;
    rand.position.y = 0.045;
    this.puck.add(rand);
    this.puck.position.set(0, TABLE_Y + 0.05, 0);
    scene.add(this.puck);
    this.trail = [];
    for (let i = 0; i < 8; i += 1) {
      const t = new THREE.Mesh(new THREE.CircleGeometry(this.puckR * (1 - i * 0.09), 16), new THREE.MeshBasicMaterial({ color: "#ffe25c", transparent: true, opacity: 0.25 * (1 - i / 8), depthWrite: false }));
      t.rotation.x = -Math.PI / 2;
      t.userData.isFx = true;
      scene.add(t);
      this.trail.push(t);
    }
    this.trailPoints = [];

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      const r = entry?.r ?? 0.36;
      const side = entry?.side ?? index % 2;
      this.addKin(player, index, { x: entry?.x ?? 0, ground: TABLE_Y + 0.12, z: entry?.z ?? 0, facing: side === 0 ? Math.PI : 0 });
      // Die Schwebescheibe unter der Figur, im Teamlicht.
      const disc = new THREE.Group();
      const koerper = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, 0.12, 28), lambert("#f4f6fb"));
      koerper.castShadow = true;
      disc.add(koerper);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 28), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[side] }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      disc.add(ring);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(r * 1.3, 24), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[side], transparent: true, opacity: 0.25, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = -0.055;
      glow.userData.isFx = true;
      disc.add(glow);
      const punkt = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), new THREE.MeshBasicMaterial({ color: player.color }));
      punkt.rotation.x = -Math.PI / 2;
      punkt.position.set(0, 0.061, r * 0.62);
      disc.add(punkt);
      disc.position.set(entry?.x ?? 0, TABLE_Y + 0.06, entry?.z ?? 0);
      scene.add(disc);
      this.discs.set(player.id, { disc, side, r });
    });
    if (state?.robot) {
      const robo = new THREE.Group();
      kiste(robo, 0.5, 0.36, 0.5, "#9aa6b8", [0, 0.3, 0]);
      kiste(robo, 0.36, 0.08, 0.04, "#ff3b3b", [0, 0.38, 0.26], { schatten: false });
      const scheibe2 = new THREE.Mesh(new THREE.CylinderGeometry(state.robot.r, state.robot.r, 0.12, 28), lambert("#c9d1dc"));
      robo.add(scheibe2);
      robo.position.set(state.robot.x, TABLE_Y + 0.06, state.robot.z);
      scene.add(robo);
      this.robot = robo;
    }
  }

  buildHall(scene) {
    // Boden: dunkle Kacheln, einige leuchten.
    kiste(scene, 40, 0.2, 40, "#1d1330", [0, -0.1, 0], { schatten: false });
    const zufall = streuer(71);
    const kacheln = [];
    const leuchten = [];
    for (let x = -9; x <= 9; x += 1) {
      for (let z = -9; z <= 9; z += 1) {
        if (Math.abs(x) < 3 && Math.abs(z) < 5) continue;
        (zufall() < 0.07 ? leuchten : kacheln).push({ p: [x, 0.005, z], r: [-Math.PI / 2, 0, 0], s: 0.9 });
      }
    }
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#2a1d45"), kacheln);
    this.glowTiles = viele(scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff" }), leuchten);
    this.glowCount = leuchten.length;
    this.tileColor = new THREE.Color();
    // Rückwand mit Spielautomaten.
    kiste(scene, 24, 6, 0.3, "#241640", [0, 3, -7.2], { schatten: false });
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
    // Seitlich: Greifautomat und Snackautomat.
    const greifer = new THREE.Group();
    kiste(greifer, 1.3, 0.9, 1.3, "#ff3b8d", [0, 0.45, 0]);
    const glas = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 1.2), new THREE.MeshLambertMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.25 }));
    glas.position.y = 1.55;
    greifer.add(glas);
    kiste(greifer, 1.3, 0.2, 1.3, "#ff3b8d", [0, 2.3, 0]);
    viele(greifer, new THREE.SphereGeometry(0.14, 8, 6), lambert("#ffd15c"), [[-0.3, 1.0, -0.2], [0.2, 1.0, 0.1], [0, 1.1, -0.3], [0.35, 1.0, -0.3], [-0.2, 1.05, 0.3]].map((p) => ({ p })));
    viele(greifer, new THREE.SphereGeometry(0.12, 8, 6), lambert("#71d97b"), [[0.1, 1.2, 0.3], [-0.35, 1.2, 0.1]].map((p) => ({ p })));
    kiste(greifer, 0.05, 0.4, 0.05, "#c0c8d8", [0.1, 2.0, 0]);
    greifer.position.set(-5.2, 0, -2.5);
    greifer.rotation.y = 0.5;
    scene.add(greifer);
    const snack = new THREE.Group();
    kiste(snack, 1.1, 2.2, 0.9, "#2fd6ff", [0, 1.1, 0]);
    const fenster = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.4), new THREE.MeshBasicMaterial({ color: "#d9f6ff" }));
    fenster.position.set(-0.1, 1.3, 0.46);
    snack.add(fenster);
    for (let r = 0; r < 4; r += 1) viele(snack, new THREE.BoxGeometry(0.12, 0.18, 0.05), lambert(automatenFarben[r]), [0, 1, 2].map((c) => ({ p: [-0.32 + c * 0.22, 0.8 + r * 0.33, 0.48] })));
    snack.position.set(5.3, 0, -2.2);
    snack.rotation.y = -0.5;
    scene.add(snack);
    // Neonschrift über den Automaten.
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
    kiste(scene, 0.3, 6, 16, "#241640", [-8.3, 3, -1], { schatten: false });
    kiste(scene, 0.3, 6, 16, "#241640", [8.3, 3, -1], { schatten: false });
    // Discokugel und ihre Lichtpunkte.
    const kugel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshLambertMaterial({ color: "#dfe6f2", flatShading: true, emissive: "#555566" }));
    kugel.position.set(0, 5.6, -1);
    scene.add(kugel);
    this.discoBall = kugel;
    const punkte = [];
    for (let i = 0; i < 26; i += 1) punkte.push({ p: [0, 0.012, 0], r: [-Math.PI / 2, 0, 0], s: 0.2 + zufall() * 0.15 });
    this.spots = viele(scene, new THREE.CircleGeometry(1, 10), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false }), punkte);
    this.spots.userData.isFx = true;
    this.spotSeeds = punkte.map(() => ({ a: zufall() * Math.PI * 2, r: 3 + zufall() * 6, s: 0.1 + zufall() * 0.2 }));
    // Anzeigetafel über dem Tisch.
    const tafel = new THREE.Group();
    kiste(tafel, 2.6, 0.9, 0.2, "#101018", [0, 0, 0]);
    this.boardCanvas = document.createElement("canvas");
    this.boardCanvas.width = 256;
    this.boardCanvas.height = 96;
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTexture.colorSpace = THREE.SRGBColorSpace;
    const anzeige = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.8), new THREE.MeshBasicMaterial({ map: this.boardTexture }));
    anzeige.position.z = 0.11;
    tafel.add(anzeige);
    tafel.position.set(0, 3.6, -5.2);
    scene.add(tafel);
    this.drawBoard([0, 0]);
  }

  buildTable(scene) {
    const w = this.w;
    const l = this.l;
    // Tischkörper und Beine.
    kiste(scene, w + 0.6, TABLE_Y - 0.05, l + 0.6, "#2c2f45", [0, (TABLE_Y - 0.05) / 2, 0]);
    // Spielfläche mit Luftlöchern.
    const flaeche = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, l), new THREE.MeshLambertMaterial({ map: flaechenTextur(w, l) }));
    flaeche.position.y = TABLE_Y - 0.02;
    flaeche.receiveShadow = true;
    scene.add(flaeche);
    // Banden: an den Längsseiten weiss, an den Stirnseiten in Teamfarbe mit
    // offenem Tor in der Mitte.
    [-1, 1].forEach((seite) => {
      kiste(scene, 0.22, RAIL_H, l + 0.44, "#e8ecf6", [seite * (w / 2 + 0.11), TABLE_Y + RAIL_H / 2 - 0.02, 0]);
      const leiste = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, l + 0.3), new THREE.MeshBasicMaterial({ color: "#b57bff" }));
      leiste.position.set(seite * (w / 2 + 0.11), TABLE_Y + RAIL_H + 0.01, 0);
      scene.add(leiste);
    });
    [[1, 0], [-1, 1]].forEach(([seite, team]) => {
      const z = seite * (l / 2 + 0.11);
      const stueck = (w - this.goalW) / 2;
      [-1, 1].forEach((s) => {
        kiste(scene, stueck + 0.22, RAIL_H, 0.22, "#e8ecf6", [s * (this.goalW / 2 + stueck / 2 + 0.11), TABLE_Y + RAIL_H / 2 - 0.02, z]);
        const leiste = new THREE.Mesh(new THREE.BoxGeometry(stueck + 0.2, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
        leiste.position.set(s * (this.goalW / 2 + stueck / 2 + 0.11), TABLE_Y + RAIL_H + 0.01, z);
        scene.add(leiste);
      });
      // Torschlitz: dunkler Kasten mit leuchtender Kante.
      kiste(scene, this.goalW, 0.3, 0.5, "#0c0814", [0, TABLE_Y - 0.2, z + seite * 0.2], { schatten: false });
      const torlicht = new THREE.Mesh(new THREE.BoxGeometry(this.goalW, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
      torlicht.position.set(0, TABLE_Y + 0.01, z);
      scene.add(torlicht);
      if (team === 0) this.goalLight0 = torlicht;
      else this.goalLight1 = torlicht;
    });
    // Beine.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => kiste(scene, 0.3, TABLE_Y, 0.3, "#1c1f30", [sx * (w / 2), TABLE_Y / 2 - 0.3, sz * (l / 2 - 0.4)]));
  }

  drawBoard(score) {
    const ctx = this.boardCanvas.getContext("2d");
    ctx.fillStyle = "#101018";
    ctx.fillRect(0, 0, 256, 96);
    ctx.font = "900 64px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = TEAM_COLORS[1];
    ctx.fillText(String(score[1]), 64, 52);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(":", 128, 48);
    ctx.fillStyle = TEAM_COLORS[0];
    ctx.fillText(String(score[0]), 192, 52);
    this.boardTexture.needsUpdate = true;
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

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Luftpuck: Scheibe steuern",
      intervalMs: 60,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "steer", x, y }).catch(() => {}),
      onEngage: () => this.feedback?.vibrate(8)
    });
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
  }

  onUpdate() {
    this.lastServerAt = performance.now();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId } = f;
    const state = arcade?.hockey;
    if (!state) return;
    const age = Math.min(0.12, (performance.now() - this.lastServerAt) / 1000);

    // Puck mit Vorausschau zwischen den Serverständen.
    const p = state.puck;
    const px = Math.max(-this.w / 2, Math.min(this.w / 2, p.x + p.vx * age));
    const pz = p.z + p.vz * age;
    const jump = Math.hypot(px - this.puck.position.x, pz - this.puck.position.z) > 1.2;
    this.puck.position.x = jump ? px : this.puck.position.x + (px - this.puck.position.x) * frameLerp(0.6, dt);
    this.puck.position.z = jump ? pz : this.puck.position.z + (pz - this.puck.position.z) * frameLerp(0.6, dt);
    this.puck.rotation.y += Math.hypot(p.vx, p.vz) * dt * 2;
    this.trailPoints.unshift(this.puck.position.clone());
    this.trailPoints.length = Math.min(this.trailPoints.length, this.trail.length * 2);
    const fast = Math.hypot(p.vx, p.vz) > 3;
    this.trail.forEach((t, i) => {
      const at = this.trailPoints[i * 2];
      t.visible = Boolean(at) && fast;
      if (at) t.position.set(at.x, TABLE_Y + 0.005, at.z);
    });

    // Scheiben und Figuren.
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const disc = this.discs.get(player.id);
      if (!entry || !kin || !animator || !disc) return;
      const tx = entry.x + (entry.vx || 0) * age;
      const tz = entry.z + (entry.vz || 0) * age;
      disc.disc.position.x += (tx - disc.disc.position.x) * frameLerp(0.5, dt);
      disc.disc.position.z += (tz - disc.disc.position.z) * frameLerp(0.5, dt);
      disc.disc.position.y = TABLE_Y + 0.06 + Math.sin(now / 200 + disc.r * 10) * 0.012;
      kin.position.x = disc.disc.position.x;
      kin.position.z = disc.disc.position.z;
      // Die Figur schaut zum Puck.
      const look = Math.atan2(this.puck.position.x - kin.position.x, this.puck.position.z - kin.position.z);
      kin.rotation.y += Math.atan2(Math.sin(look - kin.rotation.y), Math.cos(look - kin.rotation.y)) * frameLerp(0.2, dt);
      const moving = Math.hypot(entry.vx || 0, entry.vz || 0) > 0.6;
      if (f.finale) return;
      animator.set(moving ? "ride" : "ready");
      if ((entry.touches || 0) > (disc.touches ?? entry.touches ?? 0)) {
        animator.trigger("punch");
        this.burst(this.puck.position.clone().setY(TABLE_Y + 0.1), [TEAM_COLORS[disc.side], "#ffffff"], { count: 6, speed: 1.3, up: 0.8, size: 0.05, life: 0.35 });
        if (player.id === controlledId) {
          this.feedback?.sound("clack");
          this.feedback?.vibrate(10);
        }
      }
      disc.touches = entry.touches || 0;
    });
    if (this.robot && state.robot) {
      this.robot.position.x += (state.robot.x - this.robot.position.x) * frameLerp(0.5, dt);
      this.robot.position.z += (state.robot.z - this.robot.position.z) * frameLerp(0.5, dt);
    }

    // Tore.
    if ((state.goals?.length || 0) > this.seenGoals) {
      const goal = state.goals[state.goals.length - 1];
      this.seenGoals = state.goals.length;
      const z = goal.side === 1 ? this.l / 2 : -this.l / 2;
      const at = new THREE.Vector3(goal.x || 0, TABLE_Y + 0.4, z);
      this.burst(at, [TEAM_COLORS[goal.side], "#ffffff", "#ffe25c"], { count: 30, speed: 3, up: 3, size: 0.09, life: 1.2 });
      this.bursts.ring(at.clone().setY(TABLE_Y + 0.05), TEAM_COLORS[goal.side], { radius: 1.6, life: 0.6, opacity: 0.8 });
      this.drawBoard(state.score);
      const shooter = goal.by ? players.find((pl) => pl.id === goal.by) : null;
      this.pop(at.clone().add(new THREE.Vector3(0, 0.8, 0)), goal.own ? "EIGENTOR!" : "TOR!", { color: "#ffe36b", size: 0.6, life: 1.4 });
      if (shooter) this.animators.get(shooter.id)?.trigger("celebrate");
      const own = arcade.players[controlledId];
      this.rig.shake(0.45);
      if (own) {
        const ours = own.side === goal.side;
        this.feedback?.sound(ours ? "win" : "error");
        this.feedback?.vibrate(ours ? [20, 30, 50] : 40);
      }
      // Das Tor, in dem der Puck liegt, blinkt.
      const hitLight = goal.side === 1 ? this.goalLight0 : this.goalLight1;
      if (hitLight) hitLight.userData.flashUntil = performance.now() + 1200;
    }
    [this.goalLight0, this.goalLight1].forEach((licht, team) => {
      if (!licht) return;
      const flash = performance.now() < (licht.userData.flashUntil || 0);
      licht.material.color.set(flash && Math.floor(now / 90) % 2 ? "#ffffff" : TEAM_COLORS[team]);
    });

    // Halle: Bildschirme flimmern, Kacheln pulsieren, Discokugel dreht.
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
    if (this.discoBall) this.discoBall.rotation.y += dt * 0.8;
    if (this.spots) {
      const o = new THREE.Object3D();
      this.spotSeeds.forEach((sp, i) => {
        const a = sp.a + now / 1000 * 0.35;
        o.position.set(Math.cos(a) * sp.r, 0.015, -1 + Math.sin(a) * sp.r);
        o.rotation.set(-Math.PI / 2, 0, 0);
        o.scale.setScalar(sp.s);
        o.updateMatrix();
        this.spots.setMatrixAt(i, o.matrix);
      });
      this.spots.instanceMatrix.needsUpdate = true;
    }
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
      }
    }
    const banner = this.hud.querySelector("[data-hockey-banner]");
    const serving = now < state.serveAt;
    let message = null;
    let tone = "#b57bff";
    const last = state.goals?.[state.goals.length - 1];
    if (now < minigame.startedAt + 1500) message = ownSide === 0 ? "Dein Tor ist unten!" : "Dein Tor ist oben!";
    else if (serving && last && now - last.at < 1300) {
      const ours = last.side === ownSide;
      message = ours ? "TOR! 🎉" : "Gegentor …";
      tone = ours ? "#ffc400" : "#ff3b8d";
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
      banner.style.color = tone === "#ffc400" ? "#5c4508" : "#ffffff";
    }
  }
}

function flaechenTextur(w, l) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = Math.round(256 * (l / w));
  const ctx = canvas.getContext("2d");
  const H = canvas.height;
  ctx.fillStyle = "#eaf4ff";
  ctx.fillRect(0, 0, 256, H);
  // Luftlöcher.
  ctx.fillStyle = "rgba(90, 120, 170, 0.35)";
  for (let y = 8; y < H; y += 14) for (let x = 8; x < 256; x += 14) ctx.fillRect(x, y, 2, 2);
  // Mittellinie, Mittelkreis, Torraum-Halbkreise.
  ctx.strokeStyle = "#b57bff";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(256, H / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(128, H / 2, 42, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = TEAM_COLORS[1];
  ctx.beginPath(); ctx.arc(128, 0, 62, 0, Math.PI); ctx.stroke();
  ctx.strokeStyle = TEAM_COLORS[0];
  ctx.beginPath(); ctx.arc(128, H, 62, Math.PI, Math.PI * 2); ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
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
