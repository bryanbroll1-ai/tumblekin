import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Kanonenflug: erster Tipp legt die Kraft fest, der zweite den Winkel — dann
// fliegt die Figur. Ziel ist die FLAGGE, deren Abstand jede Runde wechselt;
// Wind schiebt oder bremst. Beim Winkel zeigt ein Ring am Boden, wo man ohne
// Wind landen würde — den Wind muss man selbst einrechnen.
//
// Vorher sass die Figur von Anfang an im Rohr, die Kamera stand dahinter, und
// man sah vier Hinterköpfe. Jetzt steht jeder neben seiner Kanone und schaut
// in die Kamera, springt beim ersten Tipp hinein, lugt mit dem Kopf aus der
// Mündung, während das Rohr schwenkt, und fliegt wie ein Superheld hinaus.
// Nach der Landung ein Purzelbaum, dann dreht man sich um und freut sich —
// oder zuckt mit den Schultern. Die Kamera fliegt mit der eigenen Figur mit.
const LANE_GAP = 1.5;
const CANNON_Z = 1.4;
// Mit der Verkleinerung der Kanone (0.8) gerechnet.
const PIVOT_Y = 0.92 * 0.8;
const BARREL_LEN = 0.9 * 0.8;
const METER = 0.15;
const HOP_MS = 420;
const FACING = 0.5;

function flightMs(distance) {
  return 1000 + Math.min(110, distance || 0) * 8;
}

// Dieselben Rechnungen wie auf dem Server (cannonTri, cannonDistance).
function tri(x) {
  const frac = x - Math.floor(x);
  return 1 - Math.abs(frac * 2 - 1);
}
function shotDistance(power, angleDeg, wind, windM = 11) {
  const rad = (angleDeg * Math.PI) / 180;
  return 6 + power * power * Math.sin(2 * rad) * 94 + wind * windM * power * Math.sin(rad);
}
function landZ(distance) {
  return CANNON_Z - 0.9 - distance * METER;
}

export class CannonFly extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stations = new Map();
    this.focusId = null;
    this.focusUntil = 0;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Kanonenflug",
      background: "#a8e2f4",
      fog: ["#a8e2f4", 24, 60],
      lights: { sunPosition: [5, 12, 7], shadow: { left: -10, right: 10, top: 10, bottom: -10 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>—</strong></div>
      <div class="simon-round" data-cannon-info></div>
      <div class="cannon-phase-label" data-cannon-label>KRAFT</div>
      <div class="cannon-gauge" data-cannon-gauge><div class="cannon-gauge-fill" data-cannon-fill></div></div>`;
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 48), new THREE.MeshLambertMaterial({ color: "#7fce6f" }));
    meadow.position.set(0, -0.25, -14);
    meadow.receiveShadow = true;
    scene.add(meadow);
    dressMeadow(scene, {
      seed: 12,
      keepOut: { x: 5.2, z: 30 },
      spread: { x: 19, z: 30 },
      treeRing: { x: 14, z: 28 },
      frontCut: 4,
      trees: 30,
      patches: 30,
      grassColor: "#6fbe63",
      patchColors: ["#7cc86e", "#93d684"],
      crownColor: "#2f7f5a",
      crownColor2: "#46996b"
    });

    // Die Flugbahn: ein gemähter Streifen mit Linien alle zehn Meter und
    // Schildern alle zwanzig.
    const lane = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.04, 17), new THREE.MeshLambertMaterial({ color: "#8fda7c" }));
    lane.position.set(0, 0.02, CANNON_Z - 0.9 - 8.5);
    lane.receiveShadow = true;
    scene.add(lane);
    for (let m = 10; m <= 100; m += 10) {
      const z = CANNON_Z - 0.9 - m * METER;
      const big = m % 20 === 0;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.05, big ? 0.12 : 0.06), new THREE.MeshLambertMaterial({ color: m >= 80 ? "#ffe07a" : "#f2fae8" }));
      stripe.position.set(0, 0.05, z);
      scene.add(stripe);
      if (big) scene.add(this.sign(`${m}`, -4.3, z, m >= 80));
    }

    [[-7, 5.6, -8, 5], [7, 6.4, -12, 6], [0, 7, -20, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    this.buildTarget();
    this.buildWindsock();
    this.buildCastle(scene);

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addStation(player, index, players.length));

    // Die Landevorschau der eigenen Figur: ein Ring am Boden.
    this.preview = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.34, 24),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false })
    );
    this.preview.rotation.x = -Math.PI / 2;
    this.preview.visible = false;
    this.scene.add(this.preview);
  }

  // Ein Burghof: am Ende der Flugbahn die Burgmauer mit Zinnen, zwei Türmen,
  // Tor und wehenden Fahnen; an den Seiten gestreifte Zelte, bei den Kanonen
  // Kugelpyramiden und Pulverfässer, entlang der Bahn Wimpelmasten.
  buildCastle(scene) {
    const zufall = streuer(33);
    const stein = lambert("#a8a39a");
    const mauerZ = -21;
    kiste(scene, 22, 3.6, 1.4, "#a8a39a", [0, 1.8, mauerZ]);
    const zinnen = [];
    for (let x = -10.6; x <= 10.6; x += 0.9) zinnen.push({ p: [x, 3.85, mauerZ + 0.3] });
    viele(scene, new THREE.BoxGeometry(0.5, 0.5, 0.6), stein, zinnen, { schatten: true });
    const steine = [];
    for (let i = 0; i < 40; i += 1) steine.push({ p: [(zufall() - 0.5) * 21, 0.4 + zufall() * 3, mauerZ + 0.71], s: [0.5 + zufall() * 0.5, 0.25, 0.02] });
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#938e84"), steine);
    // Tor.
    kiste(scene, 2.4, 2.6, 0.2, "#5a3e2a", [0, 1.3, mauerZ + 0.72]);
    const gitter = [];
    for (let x = -1; x <= 1.01; x += 0.33) gitter.push({ p: [x, 1.3, mauerZ + 0.84] });
    viele(scene, new THREE.BoxGeometry(0.06, 2.5, 0.06), lambert("#2c2f38"), gitter);
    // Türme.
    this.castleFlags = [];
    [[-5.5, "#c8413b"], [5.5, "#2f6fb0"]].forEach(([x, farbe]) => {
      const turm = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 6, 14), stein);
      turm.position.set(x, 3, mauerZ + 0.2);
      turm.castShadow = true;
      scene.add(turm);
      const dach = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.2, 14), lambert(farbe));
      dach.position.set(x, 7.1, mauerZ + 0.2);
      scene.add(dach);
      const fenster = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.8), lambert("#2c2f38"));
      fenster.position.set(x, 4.2, mauerZ + 1.51);
      scene.add(fenster);
      kiste(scene, 0.07, 1.4, 0.07, "#5a3e2a", [x, 8.9, mauerZ + 0.2]);
      const fahne = kiste(scene, 0.9, 0.5, 0.03, farbe, [x + 0.47, 9.3, mauerZ + 0.2], { schatten: false });
      fahne.geometry.translate(0, 0, 0);
      this.castleFlags.push(fahne);
    });
    // Zelte an den Seiten.
    [[-7.2, -3.5, "#ff5d73"], [7.4, -6.5, "#28c7d9"], [-7.8, -11, "#ffd15c"]].forEach(([x, z, farbe]) => {
      const zelt = new THREE.Group();
      const wand = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.1, 12), lambert("#fff4e0"));
      wand.position.y = 0.55;
      zelt.add(wand);
      const streifen = [];
      for (let i = 0; i < 6; i += 1) streifen.push({ p: [Math.cos((i / 6) * Math.PI * 2) * 1.11, 0.55, Math.sin((i / 6) * Math.PI * 2) * 1.11], r: [0, -(i / 6) * Math.PI * 2 + Math.PI / 2, 0] });
      viele(zelt, new THREE.BoxGeometry(0.3, 1.1, 0.02), lambert(farbe), streifen);
      const dach = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1.2, 12), lambert(farbe));
      dach.position.y = 1.7;
      zelt.add(dach);
      kiste(zelt, 0.05, 0.6, 0.05, "#5a3e2a", [0, 2.5, 0]);
      kiste(zelt, 0.3, 0.2, 0.02, "#ffffff", [0.16, 2.7, 0], { schatten: false });
      zelt.position.set(x, 0, z);
      scene.add(zelt);
    });
    // Kugelpyramiden und Pulverfässer neben den Kanonen.
    const count = Math.max(1, this.getState()?.players?.length || 4);
    const aussen = (count * LANE_GAP) / 2 + 0.7;
    const kugeln = [];
    [-1, 1].forEach((seite) => {
      const x0 = seite * aussen;
      [[0, 0, 0], [0.26, 0, 0], [0.13, 0, 0.22], [0.13, 0.2, 0.08]].forEach(([dx, dy, dz]) => kugeln.push({ p: [x0 + dx, 0.13 + dy, CANNON_Z + 0.4 + dz] }));
    });
    viele(scene, new THREE.SphereGeometry(0.14, 10, 8), lambert("#2c2f38"), kugeln, { schatten: true });
    [[-aussen - 0.2, CANNON_Z - 0.6], [aussen + 0.3, CANNON_Z - 0.3]].forEach(([x, z]) => {
      const fass = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.55, 10), lambert("#8a5a3a"));
      fass.position.set(x, 0.28, z);
      fass.castShadow = true;
      scene.add(fass);
      kiste(scene, 0.54, 0.05, 0.54, "#2c2f38", [x, 0.4, z], { schatten: false });
    });
    // Wimpelmasten entlang der Bahn.
    const masten = [];
    const wimpel = [[], []];
    for (let m = 10; m <= 90; m += 20) {
      const z = CANNON_Z - 0.9 - m * 0.15;
      [-1, 1].forEach((seite, i) => {
        masten.push({ p: [seite * 4.4, 1.1, z] });
        wimpel[i].push({ p: [seite * 4.4 + 0.24, 2.0, z] });
      });
    }
    viele(scene, new THREE.BoxGeometry(0.06, 2.2, 0.06), lambert("#5a3e2a"), masten, { schatten: true });
    viele(scene, new THREE.BoxGeometry(0.44, 0.28, 0.02), lambert("#c8413b"), wimpel[0]);
    viele(scene, new THREE.BoxGeometry(0.44, 0.28, 0.02), lambert("#2f6fb0"), wimpel[1]);
  }

  // Die Zielzone quer über alle Bahnen: gold um die Flagge, heller aussen,
  // dazu eine grosse Flagge mit Schild am Rand.
  buildTarget() {
    const arcade = this.minigame?.arcade;
    const target = arcade?.target || 70;
    const z = landZ(target);
    [[8, "#fff3c4", 0.03], [2, "#ffc93c", 0.035]].forEach(([meters, color, y]) => {
      const zone = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.02, meters * 2 * METER), new THREE.MeshLambertMaterial({ color }));
      zone.position.set(0, y + 0.03, z);
      zone.receiveShadow = true;
      this.scene.add(zone);
    });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), new THREE.MeshLambertMaterial({ color: "#f2f2f2" }));
    pole.position.set(4.1, 1.2, z);
    pole.castShadow = true;
    this.scene.add(pole);
    this.targetFlag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.04), new THREE.MeshLambertMaterial({ color: "#ff3b55" }));
    this.targetFlag.position.set(4.55, 2.1, z);
    this.scene.add(this.targetFlag);
    const sign = this.sign(`ZIEL ${target}`, 4.1, z + 0.2, true);
    sign.scale.setScalar(1.25);
    this.scene.add(sign);
  }

  // Windsack neben den Kanonen: zeigt, wohin der Wind weht und wie stark.
  buildWindsock() {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.8, 0.07), new THREE.MeshLambertMaterial({ color: "#d8dde6" }));
    pole.position.set(-3.6, 0.9, CANNON_Z - 0.4);
    this.scene.add(pole);
    this.sock = new THREE.Group();
    const stripes = ["#ff6a3d", "#ffffff", "#ff6a3d", "#ffffff"];
    stripes.forEach((color, i) => {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.16 - i * 0.025, 0.14 - i * 0.025, 0.26, 10, 1, true), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
      ring.rotation.x = Math.PI / 2;
      ring.position.z = -0.13 - i * 0.26;
      this.sock.add(ring);
    });
    this.sock.position.set(-3.6, 1.72, CANNON_Z - 0.4);
    this.scene.add(this.sock);
  }

  // Ein Schild mit der Meterzahl am linken Rand der Bahn.
  sign(text, x, z, gold) {
    const group = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), new THREE.MeshLambertMaterial({ color: "#6b5238" }));
    post.position.y = 0.4;
    group.add(post);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const pen = canvas.getContext("2d");
    pen.fillStyle = gold ? "#ffc400" : "#ffffff";
    pen.fillRect(0, 0, 128, 64);
    pen.fillStyle = "#28313f";
    pen.font = "900 40px ui-rounded, system-ui, sans-serif";
    pen.textAlign = "center";
    pen.textBaseline = "middle";
    pen.fillText(`${text}m`, 64, 35);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.36, 0.05), [
      new THREE.MeshLambertMaterial({ color: "#6b5238" }),
      new THREE.MeshLambertMaterial({ color: "#6b5238" }),
      new THREE.MeshLambertMaterial({ color: "#6b5238" }),
      new THREE.MeshLambertMaterial({ color: "#6b5238" }),
      new THREE.MeshLambertMaterial({ map: texture }),
      new THREE.MeshLambertMaterial({ color: "#6b5238" })
    ]);
    board.position.y = 0.86;
    group.add(board);
    group.position.set(x, 0, z);
    group.rotation.y = 0.35;
    return group;
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  addStation(player, index, count) {
    const x = this.laneX(index, count);
    const cannon = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: "#8a5a3a" });
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.95), wood);
    carriage.position.set(0, 0.45, 0.05);
    carriage.castShadow = true;
    cannon.add(carriage);
    [-1, 1].forEach((side) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.12, 12), new THREE.MeshLambertMaterial({ color: "#5c3d28" }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * 0.38, 0.36, 0.08);
      wheel.castShadow = true;
      cannon.add(wheel);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: player.color }));
      hub.position.set(side * 0.46, 0.36, 0.08);
      cannon.add(hub);
    });
    // Das Rohr hängt an einem Drehpunkt und zeigt entlang seiner +y-Achse.
    const pivot = new THREE.Group();
    pivot.position.set(0, PIVOT_Y, 0);
    const metal = new THREE.MeshLambertMaterial({ color: "#3a4660" });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.32, BARREL_LEN + 0.3, 12), metal);
    barrel.position.y = BARREL_LEN / 2 - 0.15;
    barrel.castShadow = true;
    pivot.add(barrel);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.12, 12), new THREE.MeshLambertMaterial({ color: player.color }));
    band.position.y = BARREL_LEN - 0.06;
    pivot.add(band);
    const rear = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), metal);
    rear.position.y = -0.3;
    pivot.add(rear);
    const spark = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: "#ffd15c" }));
    spark.position.set(0, -0.5, 0.12);
    spark.visible = false;
    pivot.add(spark);
    cannon.add(pivot);
    cannon.position.set(x, 0, CANNON_Z);
    cannon.scale.setScalar(0.8);
    this.scene.add(cannon);

    // Die Figur wartet rechts neben ihrer Kanone.
    const standX = x + 0.55;
    const standZ = CANNON_Z + 0.55;
    this.addKin(player, index, { x: standX, ground: 0, z: standZ, facing: FACING });

    // Fähnchen für die Landestelle.
    const pin = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), new THREE.MeshLambertMaterial({ color: "#f2f2f2" }));
    stick.position.y = 0.45;
    pin.add(stick);
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.03), new THREE.MeshLambertMaterial({ color: player.color }));
    cloth.position.set(0.19, 0.76, 0);
    pin.add(cloth);
    pin.visible = false;
    this.scene.add(pin);

    this.stations.set(player.id, {
      x,
      cannon,
      pivot,
      spark,
      pin,
      stand: new THREE.Vector3(standX, 0, standZ),
      phase: "wait",
      hopAt: 0,
      launched: false,
      landed: false,
      landedAt: 0,
      reacted: false
    });
  }

  shot() {
    const count = Math.max(1, this.stations.size);
    return {
      look: [0.3, 0.8, CANNON_Z + 0.3],
      frame: { w: count * LANE_GAP * 0.82 + 0.8, h: 2.4 },
      yaw: 0.32,
      pitch: 0.26,
      fov: 36,
      ease: 0.07,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.5 },
      finale: { pull: 0.75, zoom: 0.6, lift: 0.4, orbit: 0.15 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-cannon-launch>
        <span class="nerve-button-face">FEUER!</span>
      </button>`;
    this.launchButton = this.controls.querySelector("[data-cannon-launch]");
    this.on(this.launchButton, "pointerdown", (event) => {
      event.preventDefault();
      this.pressLaunch();
    });
  }

  pressLaunch() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.launchedAt) return;
    this.feedback?.sound(own.powerAt ? "impact" : "pop");
    this.feedback?.vibrate(own.powerAt ? [18, 12, 26] : 12);
    this.sendInput({ action: "launch" }).catch(() => {});
  }

  angleOf(entry, arcade, now) {
    if (entry.launchedAt && entry.angle) return entry.angle;
    if (entry.powerAt) {
      const t = tri((now - entry.powerAt) / (arcade.anglePeriodMs || 1300));
      return (arcade.angleMin ?? 10) + t * ((arcade.angleMax ?? 80) - (arcade.angleMin ?? 10));
    }
    return 38;
  }

  tick(f) {
    this.castleFlags?.forEach((fahne, i) => { fahne.rotation.y = Math.sin(f.now / 280 + i) * 0.35; });
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    const elapsed = now - f.minigame.startedAt;
    const gauge = tri(Math.max(0, elapsed) / (arcade.periodMs || 1150));
    // Windsack: zeigt mit der Spitze dorthin, wohin der Wind weht.
    const wind = arcade.wind || 0;
    if (this.sock) {
      this.sock.rotation.y = wind >= 0 ? 0 : Math.PI;
      this.sock.scale.set(1, 1, 0.35 + Math.abs(wind) * 0.65);
      this.sock.rotation.z = Math.sin(now / 160) * 0.08 * Math.abs(wind);
      this.sock.rotation.x = -(1 - Math.abs(wind)) * 0.9;
    }
    if (this.targetFlag) this.targetFlag.rotation.y = Math.sin(now / 300) * 0.25;

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const st = this.stations.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !st || !kin || !animator) return;

      const deg = this.angleOf(entry, arcade, now);
      const rad = THREE.MathUtils.degToRad(deg);
      st.pivot.rotation.x = rad - Math.PI / 2;
      const dir = new THREE.Vector3(0, Math.sin(rad), -Math.cos(rad));
      const muzzle = new THREE.Vector3(st.x, PIVOT_Y, CANNON_Z).addScaledVector(dir, BARREL_LEN);
      // Im Rohr: Körper entlang des Rohrs, nur der Kopf schaut heraus.
      const seat = muzzle.clone().addScaledVector(dir, -0.36);

      // Erster Tipp: hinein ins Rohr.
      if (entry.powerAt && st.phase === "wait") {
        st.phase = "hop";
        st.hopAt = now;
        animator.trigger("jump");
        if (player.id === controlledId) this.feedback?.vibrate(10);
      }
      // Zweiter Tipp: Schuss.
      if (entry.launchedAt && !st.launched) {
        st.launched = true;
        st.phase = "fly";
        st.flightFrom = muzzle.clone();
        this.burst(muzzle.clone(), ["#ffd15c", "#ff8b2e", "#ffffff", "#9aa6b8"], { count: 22, speed: 3.2, up: 2.2, size: 0.1, life: 0.7, drag: 1.6 });
        this.bursts.ring(muzzle.clone(), "#ffffff", { radius: 1.3, life: 0.45, opacity: 0.6, tilt: null });
        // Fremden Schüssen folgt die Kamera erst, wenn der eigene raus ist:
        // wer noch zielt, muss sein Rohr sehen. Vorher schwenkte sie beim
        // ersten Bot-Schuss weg, und man zielte blind.
        const ownDone = !arcade.players[controlledId] || Boolean(arcade.players[controlledId].launchedAt);
        if (player.id === controlledId || (ownDone && (!this.focusId || now > this.focusUntil))) {
          this.focusId = player.id;
          this.focusUntil = now + flightMs(entry.distance) + 1800;
        }
        if (player.id === controlledId) this.rig.shake(0.7);
        else this.feedback?.sound("whoosh");
        st.cannon.position.z = CANNON_Z + 0.25;
      }
      st.cannon.position.z += (CANNON_Z - st.cannon.position.z) * frameLerp(0.12, dt);
      st.spark.visible = st.phase === "aim" && Math.sin(now / 45) > -0.2;

      if (st.phase === "wait") {
        kin.position.x = st.stand.x;
        kin.position.z = st.stand.z;
        kin.rotation.set(0, FACING, 0);
        animator.groundY = 0.3;
        if (!finale) {
          animator.set("ready");
          if (player.id === controlledId && gauge > 0.88) animator.expression("effort", 120);
        }
        return;
      }

      if (st.phase === "hop") {
        const u = Math.min(1, (now - st.hopAt) / HOP_MS);
        kin.position.x = THREE.MathUtils.lerp(st.stand.x, seat.x, u);
        kin.position.z = THREE.MathUtils.lerp(st.stand.z, seat.z, u);
        animator.groundY = THREE.MathUtils.lerp(0.3, seat.y, u) + Math.sin(u * Math.PI) * 0.9;
        kin.rotation.set((rad - Math.PI / 2) * u, FACING * (1 - u), 0);
        if (u >= 1) st.phase = entry.launchedAt ? "fly" : "aim";
        return;
      }

      if (st.phase === "aim") {
        kin.position.x = seat.x;
        kin.position.z = seat.z;
        animator.groundY = seat.y;
        kin.rotation.set(rad - Math.PI / 2, 0, 0);
        animator.set("brace");
        animator.expression("focus", 120);
        return;
      }

      // Flug: im Bogen zur Landestelle, danach Purzelbaum und Reaktion.
      const distance = entry.distance || 10;
      const range = 0.9 + distance * METER;
      const landing = new THREE.Vector3(st.x, 0.3, CANNON_Z - range);
      const from = st.flightFrom || muzzle;
      const ms = flightMs(distance);
      const u = Math.min(1, (now - entry.launchedAt) / ms);
      if (u < 1) {
        const peak = Math.max(0.8, Math.min(6, (range * Math.tan(THREE.MathUtils.degToRad(entry.angle || 45))) / 4));
        kin.position.x = st.x;
        kin.position.z = THREE.MathUtils.lerp(from.z, landing.z, u);
        animator.groundY = THREE.MathUtils.lerp(from.y, landing.y, u) + 4 * peak * u * (1 - u);
        // Nase in Flugrichtung: steigt am Anfang, sinkt am Ende.
        const slope = (1 - 2 * u) * Math.min(1.1, peak / Math.max(0.5, range) * 3);
        kin.rotation.set(-slope * 0.6, Math.PI, 0);
        animator.set("fly");
        if (Math.random() < frameChance(0.35, dt)) this.burst(kin.position.clone(), ["#ffffff", "#dde7f2"], { count: 1, speed: 0.2, up: 0.1, size: 0.08, life: 0.5, gravity: 0 });
        return;
      }

      if (!st.landed) {
        st.landed = true;
        st.landedAt = now;
        kin.position.set(landing.x, landing.y, landing.z);
        animator.groundY = landing.y;
        animator.trigger("tumble");
        this.burst(landing.clone().setY(0.2), ["#7fce6f", "#e6f2da", player.color], { count: 16, speed: 2.2, up: 1.8, size: 0.09, life: 0.7, drag: 1.7 });
        this.bursts.ring(landing.clone().setY(0.07), "#e6f2da", { radius: 1.4, life: 0.5 });
        const pts = entry.points || 0;
        this.pop(landing.clone().add(new THREE.Vector3(0, 1.3, 0)), `${Math.round(distance)} m · ${pts}`, { color: pts >= 100 ? "#7fe0a8" : pts >= 50 ? "#ffe36b" : "#ffffff", size: 0.44, life: 1.6, rise: 0.8 });
        st.pin.position.set(st.x - 0.42, 0, landing.z);
        st.pin.visible = true;
        if (player.id === controlledId) {
          this.feedback?.sound("land");
          this.feedback?.vibrate(16);
        }
      }
      kin.position.x = st.x;
      kin.position.z = landing.z;
      animator.groundY = 0.3;
      // Aufstehen und zur Kamera drehen.
      const since = now - st.landedAt;
      const turn = Math.min(1, Math.max(0, (since - 900) / 500));
      kin.rotation.set(0, Math.PI + (FACING - Math.PI) * turn, 0);
      if (!finale && since > 1300 && !st.reacted) {
        st.reacted = true;
        const pts = entry.points || 0;
        animator.set(pts >= 100 ? "celebrate" : pts >= 50 ? "happy" : "shrug");
      }
    });

    // Landevorschau der eigenen Figur, solange der Winkel läuft.
    const own = arcade.players[controlledId];
    const ownStation = this.stations.get(controlledId);
    if (this.preview) {
      const aiming = own?.powerAt && !own.launchedAt && ownStation && !finale;
      this.preview.visible = Boolean(aiming);
      if (aiming) {
        const predicted = shotDistance(own.power || 0, this.angleOf(own, arcade, now), 0, arcade.windM || 11);
        this.preview.position.set(ownStation.x, 0.07, landZ(predicted));
        const close = Math.abs(predicted - (arcade.target || 0)) <= 3;
        this.preview.material.color.set(close ? "#57e08a" : "#ffffff");
        this.preview.scale.setScalar(1 + Math.sin(now / 90) * 0.08);
      }
    }

    this.chooseFocus(f);
  }

  // Wohin die Kamera schaut: der eigenen (oder zuletzt abgeschossenen) Figur
  // hinterher, sonst auf die Kanonen, am Ende auf alle Landestellen.
  chooseFocus(f) {
    const { now, arcade, players, finale } = f;
    const count = Math.max(1, players.length);
    const waiting = players.filter((player) => !arcade.players[player.id]?.launchedAt);
    const followed = this.focusId && now < this.focusUntil ? this.kins.get(this.focusId) : null;
    if (followed && !finale) {
      // Vorausschauen: zwischen Figur und Landestelle, damit die Kamera
      // nicht hinterherhinkt.
      const entry = arcade.players[this.focusId];
      const landZ = CANNON_Z - 0.9 - (entry?.distance || 10) * METER;
      const at = followed.position;
      const midZ = (at.z + landZ) / 2;
      const gap = Math.abs(at.z - landZ);
      this.focus = { look: [at.x * 0.6, Math.max(0.8, at.y * 0.5), midZ], frame: { w: 4.4, h: Math.max(3.2, gap * 0.45 + 2) }, keep: [followed] };
      return;
    }
    if (waiting.length && !finale) {
      this.focus = { look: [0.3, 0.8, CANNON_Z + 0.3], frame: { w: count * LANE_GAP * 0.82 + 0.8, h: 2.4 }, keep: waiting.map((player) => this.kins.get(player.id)).filter(Boolean) };
      return;
    }
    // Alle gelandet: die Bahn von der kürzesten bis zur weitesten Landung.
    const landed = players.filter((player) => arcade.players[player.id]?.launchedAt).map((player) => this.kins.get(player.id)).filter(Boolean);
    if (!landed.length) {
      this.focus = null;
      return;
    }
    let near = -Infinity;
    let far = Infinity;
    landed.forEach((kin) => {
      near = Math.max(near, kin.position.z);
      far = Math.min(far, kin.position.z);
    });
    const span = near - far;
    this.focus = {
      look: [0, 0.7, (near + far) / 2],
      frame: { w: count * LANE_GAP + 1, h: Math.max(2.6, span * 0.4 + 1.4) },
      keep: landed
    };
  }

  keepInView() {
    return this.focus?.keep || [...this.kins.values()];
  }

  rigOptions() {
    return this.focus ? { look: this.focus.look, frame: this.focus.frame } : {};
  }

  drawHud(f) {
    const { arcade, minigame, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = own?.launchedAt ? `${own.points || 0}` : "—";
    const info = this.hud.querySelector("[data-cannon-info]");
    if (info) {
      const wind = arcade.wind || 0;
      const windText = Math.abs(wind) < 0.15 ? "windstill" : `${wind > 0 ? "Rückenwind" : "Gegenwind"} ${Math.round(Math.abs(wind) * 10)}`;
      info.textContent = `Ziel ${arcade.target || "?"} m · ${windText}`;
    }
    const fill = this.hud.querySelector("[data-cannon-fill]");
    const gauge = this.hud.querySelector("[data-cannon-gauge]");
    const label = this.hud.querySelector("[data-cannon-label]");
    const elapsed = now - minigame.startedAt;
    if (fill && gauge) {
      if (own?.launchedAt || minigame.finaleAt || elapsed < 0) {
        gauge.classList.add("done");
        gauge.classList.remove("angle-phase");
        if (label) label.textContent = own?.angle ? `${Math.round(own.angle)}°` : "";
      } else if (own?.powerAt) {
        gauge.classList.remove("done");
        gauge.classList.add("angle-phase");
        const t = tri((now - own.powerAt) / (arcade.anglePeriodMs || 1300));
        const deg = Math.round((arcade.angleMin ?? 10) + t * ((arcade.angleMax ?? 80) - (arcade.angleMin ?? 10)));
        fill.style.height = `${Math.round(t * 100)}%`;
        fill.classList.remove("hot");
        if (label) label.textContent = `WINKEL ${deg}°`;
      } else {
        gauge.classList.remove("done", "angle-phase");
        const power = tri(Math.max(0, elapsed) / (arcade.periodMs || 1150));
        fill.style.height = `${Math.round(power * 100)}%`;
        fill.classList.toggle("hot", power > 0.9);
        if (label) label.textContent = "KRAFT";
      }
    }
    if (this.launchButton) {
      this.launchButton.disabled = Boolean(own?.launchedAt || minigame.finaleAt);
      const face = this.launchButton.querySelector(".nerve-button-face");
      if (face) face.textContent = own?.powerAt && !own?.launchedAt ? "WINKEL!" : "FEUER!";
    }
  }
}
