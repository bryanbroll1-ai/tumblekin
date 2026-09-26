import * as THREE from "/vendor/three/three.module.js";
import { createCloud, KIN_SOLE, reachArm } from "./VoxelKit.js?v=tumblekin200";
import { addStageLights } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Farbenjagd: jeder schiebt eine Farbwalze über eine grosse Leinwand. Was die
// Walze überrollt, hat sofort seine Farbe, auch fremde. Auf der eigenen Farbe
// fährt man schneller, auf fremder langsamer — Einkreisen gibt es nicht mehr.
//
// Die Walze sitzt genau dort, wo der Server malt: vor der Figur, so breit wie
// der Pinsel, und die Figur hält den Stiel mit beiden Händen. In der alten
// Fassung rollte sie über Felder, die sich nicht färbten — gemalt wurde damals
// unter dem Bauch und erst nach einer Weile.
//
// Das Feld ist fein (12 x 26) und darum EIN InstancedMesh: 312 Kacheln in
// einem Zeichenaufruf, jede mit eigener Farbe und eigenem kleinen Aufploppen.
const TILE = 0.225;
const KIN_SCALE = 0.62;
const BOARD_TOP = 0.06;
const CELL_H = 0.035;
const POP_MS = 300;
const BLANK = [new THREE.Color("#fbf7ee"), new THREE.Color("#efe8d9")];
const FESTIVAL = ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#b57bff", "#ff9f43"];
const WHITE = new THREE.Color("#ffffff");

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _grip = new THREE.Vector3();

export class ColorHunt extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.rollers = new Map();
    this.pickupMeshes = new Map();
    this.seenBump = new Map();
    this.seenPickup = new Map();
    this.lastPaint = null;
    this.popping = new Set();
    this.cols = 0;
    this.rows = 0;
    this.slotColors = [];
    this.flash = null;
    this.labelY = 0.95;
    this.markerOffset = 0.75;
  }

  stage() {
    return { label: "3D Farbenjagd", background: "#a8defc", fog: ["#c4e9ff", 18, 44], lights: false };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="paint-share" data-paint-share></div>
      <div class="color-banner paint-banner" data-paint-banner hidden></div>`;
  }

  worldX(x) {
    return (x - this.cols / 2) * TILE;
  }

  worldZ(y) {
    return (y - this.rows / 2) * TILE;
  }

  build() {
    const arcade = this.minigame?.arcade;
    this.cols = arcade?.cols || 12;
    this.rows = arcade?.rows || 26;
    this.ahead = arcade?.rollerAhead ?? 0.9;
    this.brush = arcade?.brush ?? 1.05;
    this.brushWide = arcade?.brushWide ?? 1.9;
    addStageLights(this.scene, {
      sunPosition: [-4, 10, 6],
      shadow: { left: -this.cols * TILE, right: this.cols * TILE, top: this.rows * TILE, bottom: -this.rows * TILE },
      hemiIntensity: 2.0
    });

    const players = this.getState()?.players || [];
    const order = arcade?.order || players.map((player) => player.id);
    this.order = order;
    this.slotColors = order.map((id) => new THREE.Color(players.find((player) => player.id === id)?.color || "#bbbbbb"));

    this.buildPlaza(order, players);
    this.buildBoard();
    this.buildCells();

    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      const kin = this.addKin(player, index, {
        x: this.worldX(entry?.px ?? this.cols / 2),
        // Kleine Figur: die Sohle liegt KIN_SOLE * Massstab unter der Mitte.
        ground: BOARD_TOP - KIN_SOLE * (1 - KIN_SCALE),
        z: this.worldZ(entry?.py ?? this.rows / 2),
        facing: entry?.heading ?? 0,
        scale: KIN_SCALE
      });
      this.rollers.set(player.id, this.addRoller(kin, player.color));
    });
    if (arcade) this.syncCells(arcade, 0, true);
  }

  // Ein Graffiti-Hinterhof: Asphalt voller Farbkleckse, hinten eine
  // besprühte Backsteinmauer mit Feuerleiter, vorn Sprühdosen, ein
  // Gullydeckel, ein Müllcontainer und Paletten — und an jeder Startecke ein
  // Farbeimer in der Farbe dessen, der dort beginnt. (Das Farbfest mit
  // Pulverwolken gehört der Farbflucht.)
  buildPlaza(order, players) {
    const scene = this.scene;
    const w = this.cols * TILE;
    const d = this.rows * TILE;

    const ground = new THREE.Mesh(new THREE.BoxGeometry(80, 0.4, 80), new THREE.MeshLambertMaterial({ color: "#62666e" }));
    ground.position.set(0, -0.45, -8);
    ground.receiveShadow = true;
    scene.add(ground);

    // Kleckse rund um die Leinwand, nie darunter.
    const splats = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 0.02, 9),
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      40
    );
    for (let i = 0; i < 40; i += 1) {
      const angle = (i * 2.399) % (Math.PI * 2);
      const reach = 1 + ((i * 7) % 11) * 0.55;
      const x = Math.cos(angle) * (w / 2 + reach);
      const z = Math.sin(angle) * (d / 2 + reach) - (i % 3 === 0 ? 2 : 0);
      _dummy.position.set(x, -0.24, z);
      _dummy.rotation.set(0, angle, 0);
      const size = 0.25 + ((i * 5) % 7) * 0.12;
      _dummy.scale.set(size, 1, size * (0.7 + ((i * 3) % 4) * 0.12));
      _dummy.updateMatrix();
      splats.setMatrixAt(i, _dummy.matrix);
      splats.setColorAt(i, _color.set(FESTIVAL[i % FESTIVAL.length]));
    }
    splats.instanceMatrix.needsUpdate = true;
    splats.instanceColor.needsUpdate = true;
    scene.add(splats);

    this.buildBackyard(w, d);

    // Farbeimer an den Startecken, ausserhalb des Rahmens.
    const corners = [[-1, -1], [1, 1], [1, -1], [-1, 1]];
    order.forEach((id, slot) => {
      const player = players.find((candidate) => candidate.id === id);
      const [sx, sz] = corners[slot % corners.length];
      const bucket = this.makeBucket(player?.color || "#bbbbbb");
      bucket.position.set(sx * (w / 2 + 0.45), -0.25, sz * (d / 2 + 0.2));
      bucket.rotation.y = slot * 1.3;
      scene.add(bucket);
    });

  }

  buildBackyard(w, d) {
    const scene = this.scene;
    const zufall = streuer(43);
    const mauerZ = -d / 2 - 1.25;
    const mauer = new THREE.Mesh(new THREE.BoxGeometry(16, 3.6, 0.4), [lambert("#9a4a3a"), lambert("#9a4a3a"), lambert("#8a4234"), lambert("#8a4234"), new THREE.MeshLambertMaterial({ map: graffitiTextur() }), lambert("#8a4234")]);
    mauer.position.set(0, 1.4, mauerZ);
    mauer.receiveShadow = true;
    scene.add(mauer);
    kiste(scene, 16.2, 0.2, 0.5, "#b8b2a8", [0, 3.3, mauerZ]);
    // Feuerleiter rechts an der Mauer.
    const leiter = [];
    for (let y = 0.4; y < 3.2; y += 0.35) leiter.push({ p: [4.2, y, mauerZ + 0.4] });
    viele(scene, new THREE.BoxGeometry(0.6, 0.04, 0.04), lambert("#2c2f38"), leiter);
    [3.9, 4.5].forEach((x) => kiste(scene, 0.05, 3.1, 0.05, "#2c2f38", [x, 1.6, mauerZ + 0.4], { schatten: false }));
    kiste(scene, 1.6, 0.06, 0.8, "#2c2f38", [4.2, 2.4, mauerZ + 0.6], { schatten: false });

    // Müllcontainer links hinten, Paletten rechts vorn.
    const tonne = new THREE.Group();
    tonne.position.set(-w / 2 - 1.3, 0, -d / 2 + 0.2);
    tonne.rotation.y = 0.3;
    scene.add(tonne);
    kiste(tonne, 1.5, 0.9, 0.9, "#2f7a4a", [0, 0.2, 0]);
    kiste(tonne, 1.55, 0.08, 0.95, "#255e3a", [0, 0.68, 0]).rotation.x = -0.15;
    kiste(tonne, 0.5, 0.2, 0.02, "#ffd15c", [0.2, 0.3, 0.46], { schatten: false });
    [0, 0.14, 0.28].forEach((y, i) => kiste(scene, 1.2, 0.1, 0.8, "#b8874f", [w / 2 + 1.1, -0.2 + y, d / 2 + 0.3 + i * 0.03]));

    // Sprühdosen und Gullydeckel vorn.
    const dosen = [[-1.1, d / 2 + 0.7, "#ff5d73"], [-0.5, d / 2 + 1.1, "#28c7d9"], [0.7, d / 2 + 0.8, "#ffd15c"], [1.3, d / 2 + 1.3, "#71d97b"], [-1.9, d / 2 + 1.3, "#b57bff"]];
    dosen.forEach(([x, z, farbe], i) => {
      const dose = new THREE.Group();
      dose.position.set(x, -0.25, z);
      if (i % 2) dose.rotation.set(0, zufall() * 3, Math.PI / 2);
      scene.add(dose);
      const koerper = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 10), lambert(farbe));
      koerper.position.y = i % 2 ? 0.07 : 0.13;
      dose.add(koerper);
      const kappe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 10), lambert("#f6f3ec"));
      kappe.position.y = (i % 2 ? 0.07 : 0.13) + 0.16;
      dose.add(kappe);
    });
    const gully = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 18), lambert("#3a3d44"));
    gully.position.set(1.9, -0.24, d / 2 + 1.6);
    scene.add(gully);
    const rillen = [];
    for (let i = -2; i <= 2; i += 1) rillen.push({ p: [1.9 + i * 0.13, -0.22, d / 2 + 1.6], s: [0.04, 0.01, 0.6 - Math.abs(i) * 0.1] });
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#2a2c31"), rillen);
    // Aufgesprühte Pfeile auf dem Asphalt.
    const pfeile = [];
    for (let i = 0; i < 6; i += 1) pfeile.push({ p: [(zufall() - 0.5) * (w + 4), -0.24, d / 2 + 0.6 + zufall() * 2.4], r: [-Math.PI / 2, 0, zufall() * 6], s: [0.5, 0.1, 1] });
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#f6f3ec"), pfeile);
  }

  makeBucket(color) {
    const bucket = new THREE.Group();
    const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.21, 0.42, 14), new THREE.MeshLambertMaterial({ color: "#dfe4ea" }));
    tin.position.y = 0.21;
    tin.castShadow = true;
    bucket.add(tin);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.245, 0.14, 14), new THREE.MeshLambertMaterial({ color }));
    band.position.y = 0.2;
    bucket.add(band);
    const paint = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.02, 14), new THREE.MeshPhongMaterial({ color, shininess: 70 }));
    paint.position.y = 0.41;
    bucket.add(paint);
    // Ein Tropfen über den Rand und eine Pfütze davor.
    const drip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.03), new THREE.MeshLambertMaterial({ color }));
    drip.position.set(0, 0.34, 0.25);
    bucket.add(drip);
    const puddle = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.015, 12), new THREE.MeshLambertMaterial({ color }));
    puddle.position.set(0.08, 0.01, 0.34);
    puddle.scale.z = 0.6;
    bucket.add(puddle);
    return bucket;
  }

  // Die Leinwand: eine helle Platte im Holzrahmen.
  buildBoard() {
    const w = this.cols * TILE;
    const d = this.rows * TILE;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.3, d + 0.08), new THREE.MeshLambertMaterial({ color: "#d9d2c3" }));
    slab.position.y = BOARD_TOP - 0.16;
    slab.receiveShadow = true;
    this.scene.add(slab);
    const wood = new THREE.MeshLambertMaterial({ color: "#a2703f" });
    const rim = 0.13;
    [
      [w + rim * 2, d / 2 + rim / 2, 0, true],
      [w + rim * 2, -d / 2 - rim / 2, 0, true],
      [d, w / 2 + rim / 2, 0, false],
      [d, -w / 2 - rim / 2, 0, false]
    ].forEach(([length, offset, _unused, across]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(across ? length : rim, 0.2, across ? rim : length), wood);
      if (across) bar.position.set(0, BOARD_TOP - 0.05, offset);
      else bar.position.set(offset, BOARD_TOP - 0.05, 0);
      bar.castShadow = true;
      bar.receiveShadow = true;
      this.scene.add(bar);
    });
  }

  buildCells() {
    const count = this.cols * this.rows;
    this.cells = new THREE.InstancedMesh(
      new THREE.BoxGeometry(TILE, CELL_H, TILE),
      new THREE.MeshPhongMaterial({ color: "#ffffff", shininess: 40, specular: "#222222" }),
      count
    );
    this.cells.receiveShadow = true;
    this.want = new Int8Array(count).fill(-1);
    this.shown = new Int8Array(count).fill(-1);
    this.due = new Float64Array(count);
    this.popAt = new Float64Array(count);
    for (let at = 0; at < count; at += 1) this.placeCell(at, 1);
    this.cells.instanceMatrix.needsUpdate = true;
    this.cells.instanceColor.needsUpdate = true;
    this.scene.add(this.cells);
  }

  // Eine Kachel setzen. `t` läuft beim Umfärben von 0 bis 1: die frische Farbe
  // quillt kurz auf und setzt sich dann — so sieht man die Spur entstehen.
  placeCell(at, t) {
    const col = at % this.cols;
    const row = (at - col) / this.cols;
    const slot = this.shown[at];
    const painted = slot >= 0;
    const swell = t < 1 ? Math.sin(Math.min(1, t) * Math.PI) : 0;
    const height = painted ? 1 + swell * 2.2 : 0.55;
    const spread = painted ? 0.84 + 0.16 * Math.min(1, t * 2.4) : 0.9;
    _dummy.position.set(this.worldX(col + 0.5), BOARD_TOP + (CELL_H * height) / 2 - 0.012, this.worldZ(row + 0.5));
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(spread, height, spread);
    _dummy.updateMatrix();
    this.cells.setMatrixAt(at, _dummy.matrix);
    if (painted) _color.copy(this.slotColors[slot] || BLANK[0]).lerp(WHITE, swell * 0.18);
    else _color.copy(BLANK[(col + row) % 2]);
    this.cells.setColorAt(at, _color);
  }

  // Die Walze: Stiel von den Händen schräg nach vorn unten, die Rolle in der
  // Spielerfarbe genau so breit wie der Pinsel und genau dort, wo er malt.
  // Alle Masse in Figur-Einheiten — die Walze hängt an der Figur und dreht
  // sich mit ihr.
  addRoller(kin, color) {
    const s = KIN_SCALE;
    const radius = 0.07 / s;
    const axle = new THREE.Vector3(0, -KIN_SOLE + radius, (this.ahead * TILE) / s);
    const grip = new THREE.Vector3(0, 0.02, 0.3);
    const roller = new THREE.Group();

    const along = axle.clone().sub(grip);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, along.length()), new THREE.MeshLambertMaterial({ color: "#7a5433" }));
    handle.position.copy(grip).addScaledVector(along, 0.5);
    handle.rotation.x = Math.atan2(-along.y, along.z);
    roller.add(handle);

    const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.05), new THREE.MeshLambertMaterial({ color: "#8d949e" }));
    bar.position.copy(axle).add(new THREE.Vector3(0, radius * 0.2, 0));
    roller.add(bar);

    const spin = new THREE.Group();
    spin.position.copy(axle);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 16), new THREE.MeshPhongMaterial({ color, shininess: 60 }));
    drum.rotation.z = Math.PI / 2;
    drum.castShadow = true;
    spin.add(drum);
    // Zwei dunklere Ringe machen das Drehen sichtbar.
    [-0.25, 0.25].forEach((offset) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.5, radius * 2.08, radius * 2.08), new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.62) }));
      stripe.position.x = offset;
      spin.add(stripe);
      spin.userData[offset < 0 ? "left" : "right"] = stripe;
    });
    roller.add(spin);
    kin.add(roller);

    const width = (2 * this.brush * TILE) / s * 0.92;
    roller.userData = { spin, drum, bar, grip, axle, width, base: width };
    this.applyRollerWidth(roller.userData, width);
    return roller;
  }

  applyRollerWidth(u, width) {
    u.drum.scale.y = width;
    u.bar.scale.x = width + 0.08;
    u.spin.userData.left.position.x = -width * 0.28;
    u.spin.userData.right.position.x = width * 0.28;
  }

  shot() {
    const w = this.cols * TILE;
    const d = this.rows * TILE;
    return {
      look: [0, 0, 0.25],
      // Etwas Luft an den Seiten: wer am Leinwandrand fährt, ragte samt
      // Walze sonst aus dem Bild.
      frame: { w: w + 1.0, h: d * Math.sin(0.8) + 0.8 },
      fill: 0.96,
      pitch: 0.8,
      fov: 36,
      intro: { yaw: 0.5, pitch: 0.3, zoom: 1.35 },
      finale: { pull: 0.85, zoom: 0.6, lift: 0.3, orbit: 0.12 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Farbenjagd: Walze lenken",
      intervalMs: 70,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "steer", x, y }).catch(() => {}),
      onEngage: () => {
        this.feedback?.sound("move");
        this.feedback?.vibrate(10);
      }
    });
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
    this.pickupMeshes.clear();
    this.popping.clear();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    this.syncCells(arcade, now, false);
    this.stepCells(now);
    this.syncPickups(arcade, now);

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const roller = this.rollers.get(player.id);
      if (!entry || !kin || !animator) return;
      // Die eigene Figur folgt enger: sie ist die, deren Walze man verfolgt.
      const follow = player.id === controlledId ? 0.55 : 0.4;
      kin.position.x += (this.worldX(entry.px) - kin.position.x) * frameLerp(follow, dt);
      kin.position.z += (this.worldZ(entry.py) - kin.position.z) * frameLerp(follow, dt);

      const speed = Math.hypot(entry.vx || 0, entry.vy || 0);
      const wantYaw = finale ? 0 : (entry.heading ?? kin.rotation.y);
      const diff = Math.atan2(Math.sin(wantYaw - kin.rotation.y), Math.cos(wantYaw - kin.rotation.y));
      kin.rotation.y += diff * frameLerp(finale ? 0.1 : 0.45, dt);
      if (!finale) {
        if (speed > 0.6) {
          animator.set("shove");
          animator.rate = 0.55 + speed * 0.16;
        } else {
          animator.set("ready");
          animator.rate = 1;
        }
      }

      if (roller) {
        const u = roller.userData;
        roller.visible = !finale;
        u.spin.rotation.x += (speed * TILE * dt) / 0.07;
        const target = entry.wide ? (u.base * this.brushWide) / this.brush : u.base;
        u.width += (target - u.width) * frameLerp(0.25, dt);
        this.applyRollerWidth(u, u.width);
        // Ein paar Spritzer hinter der Walze, solange sie rollt.
        if (!finale && speed > 0.8 && Math.random() < frameChance(0.3, dt)) {
          const at = roller.localToWorld(u.axle.clone());
          at.y = BOARD_TOP + 0.06;
          this.burst(at, [player.color], { count: 2, speed: 0.5, up: 0.7, size: 0.045, life: 0.35, gravity: 4 });
        }
        // Auf eigener Farbe schneller: helle Tempostreifen hinter der Figur.
        if (!finale && entry.ground === "own" && speed > 2 && Math.random() < frameChance(0.6, dt)) {
          const at = kin.position.clone();
          at.y = BOARD_TOP + 0.12;
          this.burst(at, ["#ffffff", player.color], { count: 1, speed: 0.3, up: 0.2, size: 0.05, life: 0.3, gravity: 0 });
        }
      }

      const bumpSeen = this.seenBump.get(player.id) || 0;
      if (entry.lastBumpAt && entry.lastBumpAt !== bumpSeen) {
        this.seenBump.set(player.id, entry.lastBumpAt);
        if (bumpSeen) {
          animator.trigger("flinch");
          animator.expression("surprised", 400);
          this.burst(new THREE.Vector3(kin.position.x, 0.4, kin.position.z), [player.color, "#ffffff"], { count: 5, speed: 1.1, up: 0.8, size: 0.045, life: 0.35, drag: 2.6 });
          if (player.id === controlledId) {
            this.feedback?.sound("pop");
            this.feedback?.vibrate(12);
            this.rig.shake(0.18);
          }
        }
      }

      const pickupSeen = this.seenPickup.get(player.id) || 0;
      if (entry.lastPickupAt && entry.lastPickupAt !== pickupSeen) {
        this.seenPickup.set(player.id, entry.lastPickupAt);
        this.celebratePickup(player, entry, kin, animator, controlledId, now);
      }
      if (kin.userData.label) kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });
  }

  // Die Hände an den Stiel — nach der Pose, damit der Schritt der Beine
  // bleibt und nur die Arme zur Walze greifen.
  afterAnimate(f) {
    if (f.finale) return;
    this.rollers.forEach((roller, playerId) => {
      const kin = this.kins.get(playerId);
      if (!kin || !roller.visible) return;
      const grip = roller.userData.grip;
      reachArm(kin, 0, roller.localToWorld(_grip.set(grip.x + 0.1, grip.y, grip.z + 0.06)), 1);
      reachArm(kin, 1, roller.localToWorld(_grip.set(grip.x - 0.1, grip.y, grip.z + 0.06)), 1);
    });
  }

  celebratePickup(player, entry, kin, animator, controlledId, now) {
    const own = player.id === controlledId;
    animator.trigger("fistpump");
    animator.expression("joy", 700);
    const at = new THREE.Vector3(kin.position.x, BOARD_TOP + 0.05, kin.position.z);
    if (entry.lastPickupKind === "bomb") {
      // Der Klecks: ein Ring über die ganze Bombenfläche und viel Farbe.
      this.bursts.ring(at, player.color, { radius: 1.6, life: 0.55, opacity: 0.8, y: BOARD_TOP + 0.06 });
      this.burst(at.clone().setY(0.35), [player.color, "#ffffff"], { count: 18, speed: 1.8, up: 1.9, size: 0.07, life: 0.8 });
      if (own) {
        this.pop(new THREE.Vector3(kin.position.x, 1.05, kin.position.z), "FARBBOMBE!", { color: "#ffffff", size: 0.3, life: 0.9 });
        this.feedback?.sound("impact");
        this.feedback?.vibrate([10, 20, 30]);
        this.rig.shake(0.3);
        this.flash = { text: "Farbbombe!", tone: "bomb", until: now + 1300 };
      }
    } else {
      this.burst(at.clone().setY(0.5), ["#ffe36b", "#ffffff"], { count: 10, speed: 1.2, up: 1.4, size: 0.05, life: 0.6 });
      if (own) {
        this.pop(new THREE.Vector3(kin.position.x, 1.05, kin.position.z), "BREITE WALZE!", { color: "#ffe36b", size: 0.3, life: 0.9 });
        this.feedback?.sound("sparkle");
        this.feedback?.vibrate([8, 12, 16]);
      }
    }
  }

  // Das Feld kommt als Zeichenkette ("." frei, "0".."3" Platz in arcade.order).
  // Neue Farbe erscheint sofort, jede Kachel mit einem kleinen Hüpfer.
  syncCells(arcade, now, instant) {
    const text = arcade.paint;
    if (!text || text === this.lastPaint || !this.want) return;
    this.lastPaint = text;
    for (let at = 0; at < text.length && at < this.want.length; at += 1) {
      const code = text.charCodeAt(at);
      const slot = code === 46 ? -1 : code - 48;
      if (slot === this.want[at]) continue;
      this.want[at] = slot;
      this.due[at] = now;
    }
    if (instant) {
      this.shown.set(this.want);
      for (let at = 0; at < this.shown.length; at += 1) this.placeCell(at, 1);
      this.cells.instanceMatrix.needsUpdate = true;
      this.cells.instanceColor.needsUpdate = true;
      return;
    }
  }

  stepCells(now) {
    if (!this.cells) return;
    let dirty = false;
    for (let at = 0; at < this.want.length; at += 1) {
      if (this.shown[at] === this.want[at] || now < this.due[at]) continue;
      this.shown[at] = this.want[at];
      this.popAt[at] = now;
      this.popping.add(at);
    }
    this.popping.forEach((at) => {
      const t = (now - this.popAt[at]) / POP_MS;
      if (t >= 1) this.popping.delete(at);
      this.placeCell(at, Math.min(1, t));
      dirty = true;
    });
    if (dirty) {
      this.cells.instanceMatrix.needsUpdate = true;
      this.cells.instanceColor.needsUpdate = true;
    }
  }

  // Extras: die breite Walze als goldene Rolle, die Farbbombe als Kugel mit
  // Lunte. Darunter ein pulsierender Ring, damit man sie auch auf bunter
  // Fläche sofort findet.
  syncPickups(arcade, now) {
    const live = new Set();
    (arcade.pickups || []).forEach((pickup) => {
      live.add(pickup.id);
      let mesh = this.pickupMeshes.get(pickup.id);
      if (!mesh) {
        mesh = pickup.kind === "bomb" ? this.makeBomb() : this.makeGoldRoller();
        this.scene.add(mesh);
        this.pickupMeshes.set(pickup.id, mesh);
        mesh.userData.bornAt = now;
      }
      const grow = Math.min(1, (now - mesh.userData.bornAt) / 320);
      const x = this.worldX(pickup.x);
      const z = this.worldZ(pickup.y);
      mesh.userData.body.position.set(x, 0.32 + Math.sin(now / 240) * 0.05, z);
      mesh.userData.body.rotation.y = now / 380;
      mesh.userData.body.scale.setScalar(grow);
      const pulse = 0.85 + Math.sin(now / 160) * 0.12;
      mesh.userData.ring.position.set(x, BOARD_TOP + 0.05, z);
      mesh.userData.ring.scale.setScalar(pulse * grow);
    });
    this.pickupMeshes.forEach((mesh, id) => {
      if (live.has(id)) return;
      this.scene.remove(mesh);
      this.pickupMeshes.delete(id);
    });
  }

  pickupRing(color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.27, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 2;
    return ring;
  }

  makeGoldRoller() {
    const group = new THREE.Group();
    const body = new THREE.Group();
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.3, 14),
      new THREE.MeshPhongMaterial({ color: "#ffd84a", emissive: "#ffae00", emissiveIntensity: 0.35, shininess: 90 })
    );
    drum.rotation.z = Math.PI / 2;
    drum.castShadow = true;
    body.add(drum);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.24, 0.035), new THREE.MeshLambertMaterial({ color: "#7a5433" }));
    handle.position.y = 0.18;
    body.add(handle);
    group.add(body);
    const ring = this.pickupRing("#ffd84a");
    group.add(ring);
    group.userData = { body, ring };
    return group;
  }

  makeBomb() {
    const group = new THREE.Group();
    const body = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 16, 12),
      new THREE.MeshPhongMaterial({ color: "#ff4fa3", emissive: "#b0105e", emissiveIntensity: 0.3, shininess: 90 })
    );
    ball.castShadow = true;
    body.add(ball);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 20), new THREE.MeshLambertMaterial({ color: "#ffd15c" }));
    band.rotation.x = Math.PI / 2;
    body.add(band);
    const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), new THREE.MeshLambertMaterial({ color: "#5a4632" }));
    fuse.position.y = 0.17;
    body.add(fuse);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: "#fff3a0" }));
    spark.position.y = 0.23;
    body.add(spark);
    group.add(body);
    const ring = this.pickupRing("#ff4fa3");
    group.add(ring);
    group.userData = { body, ring };
    return group;
  }

  drawHud(f) {
    const { arcade, state, now, minigame } = f;
    if (!arcade) return;
    const ownId = this.getControlledPlayerId();
    const own = arcade.players[ownId];
    const total = (arcade.paint || "").length || 1;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.owned || 0)));
    const share = this.hud.querySelector("[data-paint-share]");
    if (share) {
      share.innerHTML = state.players.map((player) => {
        const owned = arcade.players[player.id]?.owned || 0;
        const percent = Math.max(owned > 0 ? 6 : 0, Math.round((owned / total) * 100));
        const isOwn = player.id === ownId;
        // Die Zahl nur, wo sie hineinpasst — sonst schoben sich die Ziffern
        // schmaler Anteile ineinander.
        const label = percent >= 13 ? `${Math.round((owned / total) * 100)}%` : "";
        return `<i class="paint-share-part${isOwn ? " is-own" : ""}" style="--chip:${player.color};width:${percent}%">${label}</i>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-paint-banner]");
    if (!banner) return;
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    const ranking = state.players
      .map((player) => ({ player, owned: arcade.players[player.id]?.owned || 0 }))
      .sort((a, b) => b.owned - a.owned);
    const leader = ranking[0];
    const show = (text, background, color) => {
      banner.hidden = false;
      banner.textContent = text;
      banner.style.background = background;
      banner.style.color = color;
    };
    if (f.finale) {
      banner.hidden = true;
    } else if (this.flash && now < this.flash.until) {
      show(this.flash.text, "#ff8fc6", "#4a0a2a");
    } else if (own?.wide) {
      show("Breite Walze läuft!", "#ffd15c", "#4a3400");
    } else if (now < minigame.startedAt + 6000) {
      show("Überroll alles mit deiner Farbe — auf ihr bist du schneller!", "#ffffff", "#1d2b36");
    } else if (remaining <= 8 && leader && leader.player.id !== ownId && leader.owned > 0) {
      show(`${leader.player.name} führt — übermal seine Farbe!`, "#ff6b7f", "#42101a");
    } else {
      banner.hidden = true;
    }
  }
}

// Graffiti auf Backstein: Fugen, bunte Blasenbuchstaben und Tags.
function graffitiTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#9a4a3a";
  ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = "#7d3a2c";
  ctx.lineWidth = 3;
  for (let row = 0; row < 16; row += 1) {
    const y = row * 16;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
    for (let x = (row % 2) * 24; x < 1024; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 16);
      ctx.stroke();
    }
  }
  const farben = ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#b57bff", "#ff9f43"];
  ctx.lineJoin = "round";
  ctx.font = "900 150px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  [["PAINT", 60, 140, 0], ["WOW", 620, 120, 2], ["ZAP", 860, 170, 4]].forEach(([text, x, y, f]) => {
    ctx.lineWidth = 22;
    ctx.strokeStyle = "#1c1c24";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = farben[f];
    ctx.fillText(text, x, y);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(text, x, y);
  });
  for (let i = 0; i < 24; i += 1) {
    ctx.fillStyle = farben[i % farben.length];
    ctx.beginPath();
    ctx.arc((i * 211) % 1024, 20 + ((i * 97) % 220), 6 + (i % 4) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
