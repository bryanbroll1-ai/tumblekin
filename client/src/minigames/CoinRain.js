import * as THREE from "/vendor/three/three.module.js";
import { flashKin } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer, schild } from "./Kulisse.js?v=tumblekin200";

// Münzregen: drei Spuren, oben eine Münzmaschine, die Münzen, Edelsteine und
// Bomben ausspuckt. Wischen wechselt die Spur. Eine Serie ohne Bombe hebt den
// Wert (×2, ×3), in den letzten Sekunden kommt der Goldrausch, und zum Schluss
// fällt eine Schatztruhe in eine vorher angesagte Spur.
//
// Vorher stand die Kamera tief, die Maschine war oben abgeschnitten und die
// rechte Spur halb aus dem Bild. Jetzt ist alles im Bild, die Figuren schauen
// nach oben zu dem, was in ihrer Spur fällt, strecken die Arme zum Fangen,
// rennen seitlich in die neue Spur und fliegen bei einer Bombe rußig zurück.
const LANE_WIDTH = 1.35;
const DROP_TOP_Y = 3.05;
const CATCH_Y = 1.05;
const KIN_Z = 0.7;
const BULB_COLORS = ["#ffe36b", "#ffe36b", "#ff4fd8", "#3a2a5a"].map((c) => new THREE.Color(c));

export class CoinRain extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.dropMeshes = new Map();
    this.lastCatches = new Map();
    this.lastBombs = new Map();
    this.sootUntil = new Map();
    this.lastMult = new Map();
    this.swipe = null;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Münzregen",
      background: "#1e1636",
      fog: ["#1e1636", 22, 42],
      lights: { sunPosition: [-3, 10, 8], sunColor: 0xfff0d8, sunIntensity: 2.1, hemiIntensity: 1.7, skyColor: 0xe0d0ff, groundColor: 0x4a3a6a, shadow: { top: 10 } }
    };
  }

  build() {
    const scene = this.scene;
    this.buildArcadeHall(scene);
    this.laneStrips = [];
    for (let lane = 0; lane < 3; lane += 1) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH - 0.1, 0.12, 2.6), new THREE.MeshLambertMaterial({ color: lane === 1 ? "#ffdd8a" : "#f4cd6e" }));
      strip.position.set(this.laneX(lane), 0.0, KIN_Z - 0.2);
      strip.receiveShadow = true;
      scene.add(strip);
      this.laneStrips.push(strip);
    }

    // Die Münzmaschine: ein Kasten mit drei Rohren, der leicht hin und her
    // wackelt und blinkt, wenn er etwas ausspuckt.
    const machine = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 3 + 0.4, 0.8, 0.9), new THREE.MeshLambertMaterial({ color: "#7a4ddb" }));
    body.position.y = 0.6;
    machine.add(body);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 3 + 0.5, 0.14, 1.0), new THREE.MeshLambertMaterial({ color: "#ffc400" }));
    trim.position.y = 1.02;
    machine.add(trim);
    this.lamps = [];
    for (let lane = 0; lane < 3; lane += 1) {
      const x = this.laneX(lane);
      const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.4, 8), new THREE.MeshLambertMaterial({ color: "#8f6ae0" }));
      chute.position.set(x, 0.05, 0);
      machine.add(chute);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.06), new THREE.MeshBasicMaterial({ color: "#5a3aa8" }));
      lamp.position.set(x, 0.62, 0.47);
      machine.add(lamp);
      this.lamps.push({ lamp, flash: 0 });
    }
    machine.position.set(0, DROP_TOP_Y + 0.1, -0.2);
    scene.add(machine);
    this.machine = machine;

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      this.addKin(player, index, { x: this.laneX(1) + this.offset(index, players.length), ground: 0.06, z: KIN_Z + this.depth(index), facing: 0 });
    });
  }

  // Eine Spielhalle: Teppich mit Konfettimuster, dunkle Wand mit Neonleisten,
  // eine Reihe einarmiger Banditen, ein JACKPOT-Schild mit Lauflichtern, ein
  // Greifautomat und ein Münzschieber, vorn Münzhaufen.
  buildArcadeHall(scene) {
    const zufall = streuer(64);
    const boden = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 16), lambert("#3b2a63"));
    boden.position.y = -0.25;
    boden.receiveShadow = true;
    scene.add(boden);
    ["#ffc400", "#28c7d9", "#ff4fa8"].forEach((farbe, k) => {
      const tupfen = [];
      for (let i = 0; i < 50; i += 1) tupfen.push({ p: [(zufall() - 0.5) * 14, 0.004 + k * 0.001, -4.5 + zufall() * 10], r: [-Math.PI / 2, 0, zufall() * 3], s: 0.08 + zufall() * 0.1 });
      viele(scene, k === 1 ? new THREE.CircleGeometry(1, 3) : new THREE.CircleGeometry(1, 12), lambert(farbe), tupfen);
    });

    // Rückwand mit Neon.
    const wandZ = -5.2;
    kiste(scene, 18, 8, 0.3, "#2a1f4a", [0, 4, wandZ], { schatten: false });
    kiste(scene, 18, 0.08, 0.05, "", [0, 6.2, wandZ + 0.18], { schatten: false, material: new THREE.MeshBasicMaterial({ color: "#ff4fd8" }) });
    kiste(scene, 18, 0.06, 0.05, "", [0, 0.25, wandZ + 0.18], { schatten: false, material: new THREE.MeshBasicMaterial({ color: "#28e0f0" }) });
    const tafel = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshBasicMaterial({ map: schild("JACKPOT", { grund: "#1a1230", schrift: "#ffe36b", rahmen: "#ff4fd8", groesse: 76, glow: "#ffb000" }) }));
    tafel.position.set(0, 4.7, wandZ + 0.17);
    scene.add(tafel);
    const birnen = [];
    for (let i = 0; i < 18; i += 1) {
      const t = i / 18;
      const umfang = 2 * (3.7 + 1.15);
      let d = t * umfang;
      let x;
      let y;
      if (d < 3.7) { x = -1.85 + d; y = 0.58; } else if ((d -= 3.7) < 1.15) { x = 1.85; y = 0.58 - d; } else if ((d -= 1.15) < 3.7) { x = 1.85 - d; y = -0.58; } else { d -= 3.7; x = -1.85; y = -0.58 + d; }
      birnen.push({ p: [x, 4.7 + y, wandZ + 0.2] });
    }
    this.hallBulbs = viele(scene, new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }), birnen);

    // Einarmige Banditen an der Wand.
    const spots = [-3.9, -2.9, -1.9, 1.9, 2.9, 3.9].map((x) => ({ x, z: wandZ + 0.7 }));
    viele(scene, new THREE.BoxGeometry(0.8, 1.5, 0.6), lambert("#c8413b"), spots.filter((_, i) => i % 2 === 0).map((m) => ({ p: [m.x, 0.75, m.z] })), { schatten: true });
    viele(scene, new THREE.BoxGeometry(0.8, 1.5, 0.6), lambert("#2f6fb0"), spots.filter((_, i) => i % 2 === 1).map((m) => ({ p: [m.x, 0.75, m.z] })), { schatten: true });
    viele(scene, new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12, 1, false, 0, Math.PI), lambert("#ffc400"), spots.map((m) => ({ p: [m.x, 1.5, m.z], r: [0, 0, Math.PI / 2] })));
    viele(scene, new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: walzenTextur() }), spots.map((m) => ({ p: [m.x, 1.1, m.z + 0.305] })));
    viele(scene, new THREE.BoxGeometry(0.5, 0.1, 0.2), lambert("#ffc400"), spots.map((m) => ({ p: [m.x, 0.45, m.z + 0.36] })));
    viele(scene, new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), lambert("#c9d1dc"), spots.map((m) => ({ p: [m.x + 0.46, 1.25, m.z] })));
    viele(scene, new THREE.SphereGeometry(0.08, 10, 8), lambert("#ff4668"), spots.map((m) => ({ p: [m.x + 0.46, 1.58, m.z] })));

    // Greifautomat links, Münzschieber rechts.
    const greifer = new THREE.Group();
    greifer.position.set(-2.9, 0, -2.6);
    scene.add(greifer);
    kiste(greifer, 1.1, 0.9, 1.1, "#ff7ab6", [0, 0.45, 0]);
    const glas = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 1.0), new THREE.MeshLambertMaterial({ color: "#cfefff", transparent: true, opacity: 0.25, depthWrite: false }));
    glas.position.y = 1.45;
    greifer.add(glas);
    kiste(greifer, 1.1, 0.25, 1.1, "#ff7ab6", [0, 2.1, 0]);
    const pluesch = [];
    ["#ffd15c", "#71d97b", "#28c7d9", "#b98cff", "#ff9a3c"].forEach((farbe, i) => {
      const kugel = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lambert(farbe));
      kugel.position.set((i % 3 - 1) * 0.28, 1.05 + (i > 2 ? 0.2 : 0), (i % 2 - 0.5) * 0.3);
      greifer.add(kugel);
      pluesch.push(kugel);
    });
    kiste(greifer, 0.03, 0.4, 0.03, "#c9d1dc", [0.15, 1.75, 0.1], { schatten: false });
    kiste(greifer, 0.2, 0.08, 0.2, "#c9d1dc", [0.15, 1.55, 0.1], { schatten: false });

    const schieber = new THREE.Group();
    schieber.position.set(2.9, 0, -2.6);
    scene.add(schieber);
    kiste(schieber, 1.2, 1.0, 1.1, "#ffc400", [0, 0.5, 0]);
    kiste(schieber, 1.1, 0.06, 0.9, "#7a4ddb", [0, 1.05, 0.05]);
    const muenzen = [];
    for (let i = 0; i < 16; i += 1) muenzen.push({ p: [(zufall() - 0.5) * 0.9, 1.1 + (i > 11 ? 0.04 : 0), (zufall() - 0.4) * 0.7] });
    viele(schieber, new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), lambert("#ffd23a"), muenzen);
    kiste(schieber, 1.2, 0.9, 0.2, "#7a4ddb", [0, 1.55, -0.45]);
    kiste(schieber, 0.9, 0.3, 0.02, "#ffe36b", [0, 1.6, -0.34], { schatten: false });

    // Münzhaufen vorn links und rechts.
    const haufen = [];
    [[-2.3, 2.9], [2.3, 3.1]].forEach(([hx, hz]) => {
      for (let i = 0; i < 26; i += 1) {
        const r = Math.sqrt(zufall()) * 0.45;
        const a = zufall() * Math.PI * 2;
        haufen.push({ p: [hx + Math.cos(a) * r, 0.03 + (0.45 - r) * 0.5 * zufall(), hz + Math.sin(a) * r * 0.8], r: [(zufall() - 0.5) * 0.6, 0, (zufall() - 0.5) * 0.6] });
      }
    });
    viele(scene, new THREE.CylinderGeometry(0.11, 0.11, 0.035, 12), lambert("#ffd23a", { emissive: "#6a4a00" }), haufen, { schatten: true });
  }

  laneX(lane) {
    return (lane - 1) * LANE_WIDTH;
  }

  // Wer in derselben Spur steht, soll trotzdem zu sehen sein: jeder hat seine
  // eigene Reihe in der Tiefe, und die Kamera schaut etwas von oben, damit
  // die Reihen im Bild übereinander liegen statt hintereinander. Vorher
  // standen alle vier in einer Spur als ein einziger Klumpen da.
  offset(index, count) {
    return (index - (count - 1) / 2) * 0.12;
  }

  depth(index) {
    return (index - 1.5) * 0.42;
  }

  buildDropMesh(kind) {
    if (kind === "gold") {
      const coin = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 12), new THREE.MeshLambertMaterial({ color: "#ffd84a", emissive: "#ffb300", emissiveIntensity: 0.8 }));
      disc.rotation.x = Math.PI / 2;
      coin.add(disc);
      const star = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.14), new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#fff1a8", emissiveIntensity: 0.8 }));
      star.rotation.z = Math.PI / 4;
      coin.add(star);
      return coin;
    }
    if (kind === "jackpot") {
      const chest = new THREE.Group();
      const wood = new THREE.MeshLambertMaterial({ color: "#8a4f22" });
      const trim = new THREE.MeshLambertMaterial({ color: "#ffc400", emissive: "#c98f1e", emissiveIntensity: 0.6 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), wood);
      chest.add(box);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.22, 0.64), wood);
      lid.position.y = 0.36;
      chest.add(lid);
      [-0.3, 0.3].forEach((x) => {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.76, 0.66), trim);
        band.position.set(x, 0.1, 0);
        chest.add(band);
      });
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.08), trim);
      lock.position.set(0, 0.2, 0.33);
      chest.add(lock);
      const glow = new THREE.PointLight(0xffd15c, 2.5, 3, 2);
      glow.position.y = 0.5;
      chest.add(glow);
      return chest;
    }
    if (kind === "coin") {
      const coin = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.1, 10), new THREE.MeshLambertMaterial({ color: "#ffc400", emissive: "#c98f1e", emissiveIntensity: 0.45 }));
      disc.rotation.x = Math.PI / 2;
      coin.add(disc);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.12), new THREE.MeshLambertMaterial({ color: "#fff1a8", emissive: "#e8b84a", emissiveIntensity: 0.4 }));
      coin.add(mark);
      return coin;
    }
    if (kind === "gem") {
      const gem = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: "#12d0ff", emissive: "#12aaff", emissiveIntensity: 0.6 });
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.28, 6), mat);
      top.position.y = 0.11;
      gem.add(top);
      const bottom = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.22, 6), mat);
      bottom.rotation.x = Math.PI;
      bottom.position.y = -0.1;
      gem.add(bottom);
      return gem;
    }
    const bomb = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshLambertMaterial({ color: "#1b2530" }));
    bomb.add(core);
    const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.06), new THREE.MeshLambertMaterial({ color: "#c9a86a" }));
    fuse.position.y = 0.28;
    bomb.add(fuse);
    const spark = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ff8b2e", emissiveIntensity: 1 }));
    spark.position.y = 0.4;
    bomb.add(spark);
    return bomb;
  }

  shot() {
    return {
      look: [0, 1.45, 0.5],
      frame: { w: LANE_WIDTH * 3 + 0.6, h: 3.9 },
      fill: 0.96,
      pitch: 0.3,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.25, zoom: 1.4 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">◀ Wischen zum Spurwechsel ▶</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      this.swipe = { x: event.clientX, y: event.clientY };
    });
    this.on(this.webglCanvas, "pointerup", (event) => {
      if (!this.swipe) return;
      const dx = event.clientX - this.swipe.x;
      this.swipe = null;
      if (Math.abs(dx) < 24) return;
      this.sendLane(dx > 0 ? 1 : -1);
    });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.dropMeshes.clear();
  }

  sendLane(dir) {
    this.feedback?.sound("move");
    this.feedback?.vibrate(8);
    this.sendInput({ action: "lane", dir }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (this.hallBulbs) {
      const schritt = Math.floor(now / 140);
      for (let i = 0; i < this.hallBulbs.count; i += 1) this.hallBulbs.setColorAt(i, BULB_COLORS[(i + schritt) % BULB_COLORS.length]);
      this.hallBulbs.instanceColor.needsUpdate = true;
    }
    if (!arcade) return;
    const elapsed = Math.max(0, now - f.minigame.startedAt);
    const fallMs = arcade.fallMs || 1400;
    this.machine.position.x = Math.sin(now / 1600) * 0.12;
    // Goldrausch: die Maschine blinkt golden, der Himmel wird warm.
    const gold = arcade.goldFrom && elapsed >= arcade.goldFrom && !finale;
    if (gold && !this.goldStarted) {
      this.goldStarted = true;
      this.rig.shake(0.5);
      this.feedback?.sound("sparkle");
      this.feedback?.vibrate([12, 20, 12, 20, 24]);
      this.burst(new THREE.Vector3(0, DROP_TOP_Y + 0.6, 0), ["#ffd84a", "#ffffff", "#ff9a4d"], { count: 40, speed: 3.4, up: 2.6, size: 0.1, life: 1.2, drag: 1.2 });
    }
    if (this.scene.background?.isColor) {
      this.scene.background.lerp(new THREE.Color(gold ? "#ffe3a6" : "#bfe6f2"), frameLerp(0.03, dt));
    }
    // Die Truhe: ihre Spur leuchtet vorher auf.
    const jackpot = (arcade.drops || []).find((drop) => drop.kind === "jackpot" && !drop.processed);
    const warn = jackpot && elapsed >= jackpot.catchAt - (arcade.jackpotWarnMs || 2600) && elapsed < jackpot.catchAt;
    this.laneStrips?.forEach((strip, lane) => {
      const lit = warn && jackpot.lane === lane;
      strip.material.emissive.set(lit ? "#ffb300" : "#000000");
      strip.material.emissiveIntensity = lit ? 0.5 + Math.abs(Math.sin(now / 120)) * 0.5 : 0;
    });
    this.jackpotLane = warn ? jackpot.lane : null;

    // Was gerade fällt, und das Nächste je Spur (dorthin schauen die Figuren).
    const active = new Set();
    const nextInLane = [null, null, null];
    (arcade.drops || []).forEach((drop) => {
      const fallFrom = drop.catchAt - fallMs;
      if (elapsed < fallFrom || elapsed > drop.catchAt + 120) return;
      active.add(drop.id);
      let mesh = this.dropMeshes.get(drop.id);
      if (!mesh) {
        mesh = this.buildDropMesh(drop.kind);
        this.scene.add(mesh);
        this.dropMeshes.set(drop.id, mesh);
        const lamp = this.lamps[drop.lane];
        if (lamp) lamp.flash = 1;
      }
      const t = Math.min(1, (elapsed - fallFrom) / fallMs);
      mesh.position.set(this.laneX(drop.lane) + this.machine.position.x * (1 - t), DROP_TOP_Y - t * t * (DROP_TOP_Y - CATCH_Y), KIN_Z - 0.1);
      mesh.rotation.y = drop.kind === "jackpot" ? Math.sin(now / 300) * 0.4 : now / 260 + drop.id;
      // Gefangen: die Münze blitzt kurz auf und dreht sich weg, statt einfach
      // zu verschwinden. Steht niemand in der Spur, fällt sie einfach durch.
      const caughtBy = drop.kind !== "bomb" && elapsed >= drop.catchAt
        && players.some((player) => arcade.players[player.id]?.lane === drop.lane);
      if (caughtBy) {
        const u = Math.min(1, (elapsed - drop.catchAt) / 120);
        mesh.scale.setScalar(1 + Math.sin(u * Math.PI) * 0.45);
        mesh.rotation.y += u * 6;
        if (!mesh.userData.flashed) {
          mesh.userData.flashed = true;
          this.bursts.ring(mesh.position.clone(), "#ffe36b", { radius: drop.kind === "coin" ? 0.45 : 0.7, life: 0.3, y: mesh.position.y });
        }
      }
      if (drop.kind === "bomb") mesh.rotation.z = Math.sin(now / 120) * 0.25;
      const current = nextInLane[drop.lane];
      if (!current || drop.catchAt < current.catchAt) nextInLane[drop.lane] = { catchAt: drop.catchAt, mesh, kind: drop.kind };
    });
    this.dropMeshes.forEach((mesh, id) => {
      if (active.has(id)) return;
      this.scene.remove(mesh);
      this.dropMeshes.delete(id);
    });
    this.lamps.forEach((entry) => {
      entry.flash = Math.max(0, entry.flash - dt * 3);
      entry.lamp.material.color.set(entry.flash > 0.05 ? "#ffe36b" : "#5a3aa8");
    });

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const targetX = this.laneX(entry.lane) + this.offset(index, players.length);
      const gap = targetX - kin.position.x;
      const moving = Math.abs(gap) > 0.06;
      kin.position.x += gap * frameLerp(0.22, dt);
      // Beim Spurwechsel seitlich laufen, sonst zur Kamera.
      const facing = moving ? Math.sign(gap) * Math.PI * 0.42 : 0;
      kin.rotation.y += (facing - kin.rotation.y) * frameLerp(0.3, dt);

      if ((entry.catches || 0) > (this.lastCatches.get(player.id) || 0)) {
        const gained = (entry.catches || 0) - (this.lastCatches.get(player.id) || 0);
        this.lastCatches.set(player.id, entry.catches);
        animator.trigger("catch");
        animator.trigger("hop", { height: gained > 1 ? 0.3 : 0.16 });
        animator.expression(gained > 1 ? "joy" : "happy", 500);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.75, 0));
        const big = gained >= 10;
        this.burst(at, ["#ffc400", "#ffd15c", "#ffffff"], { count: big ? 40 : 9, speed: big ? 3.4 : 1.9, up: big ? 3 : 2, size: 0.08, life: big ? 1.1 : 0.6, drag: 1.8, fadePow: 1.4 });
        // Zahlen nur über der eigenen Figur (und der Schatz für alle): vier
        // Figuren in einer Spur stapelten sonst "+2 +2 +2 +2" übereinander.
        if (player.id === controlledId || big) this.pop(at, big ? `SCHATZ! +${gained}` : `+${gained}`, { color: "#ffe36b", size: big ? 0.5 : 0.36, life: big ? 1.3 : 0.7, rise: 0.75 });
        if (big) animator.trigger("celebrate");
        // Neuer Faktor erreicht.
        const mult = entry.multiplier || 1;
        if (mult > (this.lastMult.get(player.id) || 1)) {
          if (player.id === controlledId) this.pop(at.clone().add(new THREE.Vector3(0, 0.55, 0)), `×${mult}!`, { color: mult >= 3 ? "#ff6bd6" : "#7fe0a8", size: 0.46, life: 1, rise: 0.6 });
          if (player.id === controlledId) this.feedback?.sound("perfect");
        }
        this.lastMult.set(player.id, mult);
        if (player.id === controlledId) {
          this.feedback?.sound(gained > 1 ? "sparkle" : "coin", { pan: kin.position.x * 0.2 });
          this.feedback?.vibrate(gained > 1 ? [8, 12, 10] : 10);
        }
      }
      if ((entry.bombs || 0) > (this.lastBombs.get(player.id) || 0)) {
        this.lastBombs.set(player.id, entry.bombs);
        this.lastMult.set(player.id, 1);
        animator.trigger("knockback");
        animator.expression("dizzy", 1400);
        this.sootUntil.set(player.id, now + 1400);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.6, 0));
        this.burst(at, ["#1b2530", "#ff8b2e", "#ffffff"], { count: 16, speed: 2.6, up: 2.1, size: 0.09, life: 0.72, drag: 1.5 });
        this.bursts.ring(kin.position.clone().setY(0.08), "#ff8b2e", { radius: 1.4, life: 0.5, opacity: 0.5, y: 0.08 });
        if (player.id === controlledId) this.pop(at.clone().add(new THREE.Vector3(0, 0.4, 0)), "AUTSCH!", { color: "#ff8b2e", size: 0.36, life: 0.8 });
        if (player.id === controlledId) {
          this.rig.shake(0.8);
          this.feedback?.sound("error");
          this.feedback?.vibrate([24, 18, 30]);
        }
      }
      // Rußig nach einer Bombe, dann wieder sauber.
      const soot = Math.max(0, ((this.sootUntil.get(player.id) || 0) - now) / 1400);
      flashKin(kin, "#1b2530", soot * 0.7);

      if (finale) return;
      const next = nextInLane[entry.lane];
      animator.lookAt(next ? next.mesh.position : null);
      if (moving) animator.set("run");
      else if (next && next.catchAt - elapsed < 450 && next.kind !== "bomb") animator.set("reach", { params: { side: 0 } });
      else if (next && next.kind === "bomb" && next.catchAt - elapsed < 700) {
        animator.set("cower");
        animator.expression("scared", 200);
      } else animator.set("ready");
    });
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round coin-mult" data-coin-mult>×1</div>
      <div class="color-banner" data-coin-banner hidden></div>`;
  }

  drawHud(f) {
    const { arcade, now, minigame } = f;
    const own = arcade?.players?.[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.catches || 0);
    const mult = this.hud.querySelector("[data-coin-mult]");
    if (mult) {
      const m = own?.multiplier || 1;
      const streak = own?.streak || 0;
      mult.textContent = m > 1 ? `Serie ${streak} · ×${m}` : `Serie ${streak}`;
      mult.classList.toggle("hot", m > 1);
    }
    const banner = this.hud.querySelector("[data-coin-banner]");
    if (!banner || !arcade) return;
    const elapsed = now - minigame.startedAt;
    if (this.jackpotLane !== null && this.jackpotLane !== undefined) {
      banner.hidden = false;
      banner.textContent = `SCHATZTRUHE! ${["links", "Mitte", "rechts"][this.jackpotLane]}`;
      banner.style.background = "#ffc400";
      banner.style.color = "#5c3a05";
    } else if (arcade.goldFrom && elapsed >= arcade.goldFrom && elapsed < arcade.goldFrom + 1800) {
      banner.hidden = false;
      banner.textContent = "GOLDRAUSCH! ✨";
      banner.style.background = "#ff9a4d";
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }
  }
}

// Walzen eines Spielautomaten: drei Felder mit 7, Kirsche und Glocke.
function walzenTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1a1230";
  ctx.fillRect(0, 0, 192, 96);
  for (let i = 0; i < 3; i += 1) {
    ctx.fillStyle = "#fff8e6";
    ctx.fillRect(8 + i * 62, 10, 52, 76);
  }
  ctx.fillStyle = "#e0453b";
  ctx.font = "900 56px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("7", 34, 52);
  ctx.fillText("7", 158, 52);
  ctx.beginPath();
  ctx.arc(88, 58, 11, 0, Math.PI * 2);
  ctx.arc(104, 60, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#2f8f4a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(88, 48);
  ctx.quadraticCurveTo(96, 24, 108, 22);
  ctx.moveTo(104, 50);
  ctx.lineTo(108, 22);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
