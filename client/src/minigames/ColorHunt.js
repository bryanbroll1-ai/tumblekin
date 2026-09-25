import * as THREE from "/vendor/three/three.module.js";
import { createCloud, KIN_SOLE, reachArm } from "./VoxelKit.js?v=tumblekin200";
import { addStageLights } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Farbenjagd: jeder schiebt eine Farbwalze über eine grosse Leinwand. Was die
// Walze überrollt, hat sofort seine Farbe — und schliesst die eigene Farbe ein
// Stück Leinwand ein, läuft die Farbe als Welle über die ganze Tasche.
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
// Ab so vielen Feldern wird eine Einkreisung gefeiert. Kleinere entstehen
// nebenbei beim Malen (eine Lücke zwischen zwei Spuren) und liefen sonst
// dauernd als Fanfare über den Bildschirm.
const FILL_SHOW = 8;
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
    this.seenFill = 0;
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

  // Ein Farbfest-Platz: heller Steinboden voller Farbkleckse, ein Regenbogen
  // hinter der Leinwand und an jeder Startecke ein Farbeimer in der Farbe
  // dessen, der dort beginnt.
  buildPlaza(order, players) {
    const scene = this.scene;
    const w = this.cols * TILE;
    const d = this.rows * TILE;

    const ground = new THREE.Mesh(new THREE.BoxGeometry(80, 0.4, 80), new THREE.MeshLambertMaterial({ color: "#f1e2c2" }));
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

    // Regenbogen hinter dem Feld, auf dem Boden aufgesetzt.
    ["#ff5d73", "#ff9f43", "#ffd15c", "#71d97b", "#28c7d9", "#b57bff"].forEach((color, band) => {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(6.4 - band * 0.36, 0.19, 6, 42, Math.PI),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.18 })
      );
      arc.position.set(0, -0.3, -d / 2 - 7.5);
      scene.add(arc);
    });

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

    [[-3.6, 4.6, -7, 6], [3.4, 5.2, -9, 1]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });
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
      frame: { w: w + 0.4, h: d * Math.sin(0.8) + 0.8 },
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
  // Neue Farbe wird nicht sofort gezeigt, sondern zu ihrer Zeit: gewöhnliche
  // Spur gleich, eine Einkreisung als Welle von dort aus, wo sie geschlossen
  // wurde.
  syncCells(arcade, now, instant) {
    const text = arcade.paint;
    if (!text || text === this.lastPaint || !this.want) return;
    this.lastPaint = text;
    const fresh = (arcade.fills || []).filter((fill) => fill.id > this.seenFill);
    if (fresh.length) this.seenFill = Math.max(...fresh.map((fill) => fill.id));
    const bySlot = new Map(fresh.map((fill) => [fill.slot, fill]));
    for (let at = 0; at < text.length && at < this.want.length; at += 1) {
      const code = text.charCodeAt(at);
      const slot = code === 46 ? -1 : code - 48;
      if (slot === this.want[at]) continue;
      this.want[at] = slot;
      const fill = bySlot.get(slot);
      if (instant || !fill) {
        this.due[at] = now;
        continue;
      }
      const col = at % this.cols;
      const row = (at - col) / this.cols;
      this.due[at] = now + Math.hypot(col + 0.5 - fill.x, row + 0.5 - fill.y) * 26;
    }
    if (instant) {
      this.shown.set(this.want);
      for (let at = 0; at < this.shown.length; at += 1) this.placeCell(at, 1);
      this.cells.instanceMatrix.needsUpdate = true;
      this.cells.instanceColor.needsUpdate = true;
      return;
    }
    fresh.forEach((fill) => this.celebrateFill(fill, now));
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

  celebrateFill(fill, now) {
    if (fill.count < FILL_SHOW) return;
    const color = `#${(this.slotColors[fill.slot] || WHITE).getHexString()}`;
    const at = new THREE.Vector3(this.worldX(fill.x), BOARD_TOP + 0.05, this.worldZ(fill.y));
    this.bursts.ring(at, color, { radius: 1.1 + Math.min(2.2, fill.count * 0.03), life: 0.7, opacity: 0.75, y: BOARD_TOP + 0.07 });
    this.burst(at.clone().setY(0.45), [color, "#ffffff"], { count: 8 + Math.min(18, Math.round(fill.count / 3)), speed: 1.5, up: 1.8, size: 0.06, life: 0.8 });
    const ownSlot = this.order.indexOf(this.getControlledPlayerId());
    if (fill.slot === ownSlot) {
      this.pop(at.clone().setY(1.1), `+${fill.count}`, { color: "#ffffff", size: fill.count >= 30 ? 0.42 : 0.34, life: 1.1 });
      this.feedback?.sound(fill.count >= 30 ? "perfect" : "combo");
      this.feedback?.vibrate(fill.count >= 30 ? [12, 20, 30] : [10, 16]);
      this.rig.shake(fill.count >= 30 ? 0.28 : 0.16);
      this.flash = { text: `Eingekreist! +${fill.count}`, tone: "fill", until: now + 1500 };
    } else {
      this.pop(at.clone().setY(0.95), `+${fill.count}`, { color, size: 0.24, life: 0.8 });
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
      if (this.flash.tone === "fill") show(this.flash.text, "#7fe06f", "#14361a");
      else show(this.flash.text, "#ff8fc6", "#4a0a2a");
    } else if (own?.wide) {
      show("Breite Walze läuft!", "#ffd15c", "#4a3400");
    } else if (now < minigame.startedAt + 6000) {
      show("Fahr eine Schleife zurück in deine Farbe — alles darin wird deins!", "#ffffff", "#1d2b36");
    } else if (remaining <= 8 && leader && leader.player.id !== ownId && leader.owned > 0) {
      show(`${leader.player.name} führt — schneid die Fläche ab!`, "#ff6b7f", "#42101a");
    } else {
      banner.hidden = true;
    }
  }
}
