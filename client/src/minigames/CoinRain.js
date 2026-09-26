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
      background: "#f2b27a",
      fog: ["#f0c090", 22, 46],
      lights: { sunPosition: [-4, 11, 8], sunColor: 0xffe2b8, sunIntensity: 2.6, hemiIntensity: 1.8, skyColor: 0xffe8cc, groundColor: 0x8a6440, shadow: { top: 10 } }
    };
  }

  build() {
    const scene = this.scene;
    this.buildMine(scene);
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
    const body = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 3 + 0.4, 0.8, 0.9), new THREE.MeshLambertMaterial({ color: "#7a5230" }));
    body.position.y = 0.6;
    machine.add(body);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 3 + 0.5, 0.14, 1.0), new THREE.MeshLambertMaterial({ color: "#5a5f68" }));
    trim.position.y = 1.02;
    machine.add(trim);
    this.lamps = [];
    for (let lane = 0; lane < 3; lane += 1) {
      const x = this.laneX(lane);
      const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.4, 8), new THREE.MeshLambertMaterial({ color: "#6f757e" }));
      chute.position.set(x, 0.05, 0);
      machine.add(chute);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.06), new THREE.MeshBasicMaterial({ color: "#5a3a22" }));
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

  // Eine Goldmine im Abendlicht: staubiger Boden, hinten die Felswand mit
  // abgestütztem Stolleneingang und Schild, Gleise mit einer Lore voller Gold,
  // links Dynamitkisten, rechts ein Wasserturm, Grubenlampen, und vorn
  // Goldhaufen, Spitzhacke und Säcke. Die Münzmaschine ist die Erzrutsche.
  buildMine(scene) {
    const zufall = streuer(64);
    const boden = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 16), lambert("#c49a6a"));
    boden.position.y = -0.25;
    boden.receiveShadow = true;
    scene.add(boden);
    ["#b08658", "#d2ab7c"].forEach((farbe, k) => {
      const flecken = [];
      for (let i = 0; i < 14; i += 1) flecken.push({ p: [(zufall() - 0.5) * 14, 0.004 + k * 0.002, -4 + zufall() * 9], r: [-Math.PI / 2, 0, zufall() * 3], s: [1 + zufall() * 1.6, 0.6 + zufall(), 1] });
      viele(scene, new THREE.CircleGeometry(1, 10), lambert(farbe), flecken);
    });
    const kiesel = [];
    for (let i = 0; i < 50; i += 1) kiesel.push({ p: [(zufall() - 0.5) * 12, 0.04, -4.5 + zufall() * 9.5], r: [zufall(), zufall(), 0], s: 0.05 + zufall() * 0.07 });
    viele(scene, new THREE.DodecahedronGeometry(1, 0), lambert("#8f8474"), kiesel);

    // Felswand mit Stollen.
    const wandZ = -6.4;
    const fels = [];
    for (let x = -9; x <= 9; x += 1.0) {
      for (let y = 0.4; y < 7; y += 0.95) fels.push({ p: [x + (zufall() - 0.5) * 0.5, y + (zufall() - 0.5) * 0.4, wandZ - zufall() * 0.5], r: [zufall(), zufall(), zufall()], s: 0.55 + zufall() * 0.35 });
    }
    viele(scene, new THREE.DodecahedronGeometry(1, 0), lambert("#a8845e"), fels.filter((_, i) => i % 2 === 0), { schatten: true });
    viele(scene, new THREE.DodecahedronGeometry(1, 0), lambert("#937252"), fels.filter((_, i) => i % 2 === 1), { schatten: true });
    kiste(scene, 20, 8, 0.4, "#86684a", [0, 4, wandZ - 0.6], { schatten: false });
    const stollen = new THREE.Group();
    stollen.position.set(0, 0, wandZ + 0.8);
    scene.add(stollen);
    kiste(stollen, 2.6, 3.4, 0.2, "#1a120c", [0, 1.7, -0.3], { schatten: false });
    [-1.45, 1.45].forEach((x) => kiste(stollen, 0.3, 3.7, 0.3, "#6b4a2e", [x, 1.85, 0]));
    kiste(stollen, 3.4, 0.34, 0.36, "#6b4a2e", [0, 3.8, 0]);
    const tafel = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), new THREE.MeshBasicMaterial({ map: schild("GOLDMINE", { grund: "#8a5a32", schrift: "#ffe08a", rahmen: "#5a3522", groesse: 66 }) }));
    tafel.position.set(0, 4.4, 0.12);
    stollen.add(tafel);

    // Gleise aus dem Stollen nach links hinten, mit Lore.
    const start = [-1.0, wandZ + 1.1];
    const ende = [-6.6, wandZ + 3.0];
    const lang = Math.hypot(ende[0] - start[0], ende[1] - start[1]);
    const richtung = [(ende[0] - start[0]) / lang, (ende[1] - start[1]) / lang];
    const dreh = -Math.atan2(richtung[1], richtung[0]);
    const schwellen = [];
    for (let t = 0.2; t < lang; t += 0.5) schwellen.push({ p: [start[0] + richtung[0] * t, 0.04, start[1] + richtung[1] * t], r: [0, dreh, 0] });
    viele(scene, new THREE.BoxGeometry(0.16, 0.06, 0.9), lambert("#6b4a2e"), schwellen);
    [-0.32, 0.32].forEach((d) => {
      const schiene = kiste(scene, lang, 0.06, 0.06, "#6f757e", [(start[0] + ende[0]) / 2 - richtung[1] * d, 0.1, (start[1] + ende[1]) / 2 + richtung[0] * d], { schatten: false });
      schiene.rotation.y = dreh;
    });
    const lore = new THREE.Group();
    lore.position.set(start[0] + richtung[0] * 3.4, 0, start[1] + richtung[1] * 3.4);
    lore.rotation.y = dreh;
    scene.add(lore);
    kiste(lore, 1.2, 0.55, 0.8, "#5a5f68", [0, 0.45, 0]);
    const gold = [];
    for (let i = 0; i < 14; i += 1) gold.push({ p: [(zufall() - 0.5) * 1.0, 0.75 + zufall() * 0.15, (zufall() - 0.5) * 0.6], r: [zufall(), zufall(), 0], s: 0.1 + zufall() * 0.06 });
    viele(lore, new THREE.DodecahedronGeometry(1, 0), lambert("#ffc83a", { emissive: "#6a4a00" }), gold);
    [-0.4, 0.4].forEach((x) => [-0.42, 0.42].forEach((z) => {
      const rad = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 10), lambert("#2c2f38"));
      rad.rotation.x = Math.PI / 2;
      rad.position.set(x, 0.16, z);
      lore.add(rad);
    }));

    // Dynamitkisten rechts, Wasserturm dahinter.
    [[2.9, -2.9, 0.3], [3.5, -3.1, -0.2], [3.2, -2.9, 0.1, 0.5]].forEach(([x, z, dreh, y = 0]) => {
      const box = kiste(scene, 0.7, 0.5, 0.5, "#a8743f", [x, y + 0.25, z]);
      box.rotation.y = dreh;
      kiste(box, 0.5, 0.18, 0.02, "#c8313b", [0, 0.02, 0.26], { schatten: false });
    });
    const stangen = [0, 1, 2].map((i) => ({ p: [2.6 + i * 0.1, 0.06, -2.2], r: [0, 0, Math.PI / 2] }));
    viele(scene, new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), lambert("#d8313b"), stangen);
    const turm = new THREE.Group();
    turm.position.set(4.4, 0, -5.2);
    scene.add(turm);
    [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(([x, z]) => kiste(turm, 0.14, 2.6, 0.14, "#6b4a2e", [x, 1.3, z]));
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.3, 14), lambert("#8a5a32"));
    tank.position.y = 3.25;
    turm.add(tank);
    const tankDach = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.6, 14), lambert("#5a3522"));
    tankDach.position.y = 4.2;
    turm.add(tankDach);

    // Grubenlampen an Pfählen.
    this.mineLamps = [];
    [[-2.4, -3.7], [2.1, -3.9], [-4.6, -1.0]].forEach(([x, z]) => {
      kiste(scene, 0.1, 2.2, 0.1, "#6b4a2e", [x, 1.1, z]);
      kiste(scene, 0.4, 0.06, 0.06, "#6b4a2e", [x + 0.18, 2.1, z], { schatten: false });
      const lampe = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), new THREE.MeshBasicMaterial({ color: "#ffcf6a" }));
      lampe.position.set(x + 0.34, 1.9, z);
      scene.add(lampe);
      this.mineLamps.push(lampe);
    });

    // Vorn: Goldhaufen, Spitzhacke, Säcke.
    const haufen = [];
    [[-2.3, 2.9], [2.3, 3.1]].forEach(([hx, hz]) => {
      for (let i = 0; i < 22; i += 1) {
        const r = Math.sqrt(zufall()) * 0.45;
        const a = zufall() * Math.PI * 2;
        haufen.push({ p: [hx + Math.cos(a) * r, 0.03 + (0.45 - r) * 0.5 * zufall(), hz + Math.sin(a) * r * 0.8], r: [(zufall() - 0.5) * 0.6, 0, (zufall() - 0.5) * 0.6] });
      }
    });
    viele(scene, new THREE.CylinderGeometry(0.11, 0.11, 0.035, 12), lambert("#ffd23a", { emissive: "#6a4a00" }), haufen, { schatten: true });
    viele(scene, new THREE.DodecahedronGeometry(0.1, 0), lambert("#ffc83a", { emissive: "#6a4a00" }), [[-2.0, 3.2], [-2.6, 2.7], [2.6, 3.3]].map(([x, z]) => ({ p: [x, 0.12, z] })));
    const hacke = new THREE.Group();
    hacke.position.set(-1.7, 0.05, 3.6);
    hacke.rotation.set(0, 0.6, Math.PI / 2 - 0.1);
    scene.add(hacke);
    kiste(hacke, 0.05, 0.9, 0.05, "#a8743f", [0, 0.45, 0]);
    const kopf = kiste(hacke, 0.7, 0.07, 0.07, "#6f757e", [0, 0.88, 0]);
    kopf.rotation.z = 0.15;
    [[1.75, 3.7], [2.05, 3.9]].forEach(([x, z], i) => {
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lambert("#c9b28a"));
      sack.scale.set(1, 1.15 - i * 0.2, 1);
      sack.position.set(x, 0.22, z);
      sack.castShadow = true;
      scene.add(sack);
      kiste(scene, 0.12, 0.06, 0.12, "#8a5a32", [x, 0.47 - i * 0.05, z], { schatten: false });
    });
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
    this.mineLamps?.forEach((lampe, i) => lampe.scale.setScalar(1 + Math.sin(now / 90 + i * 2) * 0.04));
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
      entry.lamp.material.color.set(entry.flash > 0.05 ? "#ffe36b" : "#5a3a22");
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
