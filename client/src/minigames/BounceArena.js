import * as THREE from "/vendor/three/three.module.js";
import { createCloud, noise } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameDecay, frameLerp } from "./Quality.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { Nachlauf } from "./Nachlauf.js?v=tumblekin200";

// Bumper Pool: jede Figur sitzt in einem gestreiften Schwimmring auf einer
// Badeinsel mitten im Freibad. Mit dem Stick lenkt man, Rempeln schiebt nur
// weg — hinaus fliegt, wen ein RAMMEN-Schub am Rand erwischt. Drei Leben: wer
// hineinfliegt, treibt kurz neben der Insel und springt dann zurück; erst mit
// dem letzten Sturz paddelt man nach vorn und schaut zu. In den letzten
// zwanzig Sekunden schrumpft die Insel.
//
// Die Ringe laufen auf weichen Bahnen zwischen den Serverbildern (Nachlauf):
// vorher wurden sie über ihr Tempo vorausgerechnet und schossen an jedem
// Abpraller über den Kontaktpunkt hinaus. Stösse, Schübe und Stürze werden
// genau dann gezeigt, wenn sie im gezeichneten Bild passieren — nicht schon,
// wenn das Serverbild ankommt, eine Zehntelsekunde bevor sich die Ringe
// sichtbar berühren.
//
// Die Masse folgen der Physik des Servers: Insel 1.0, Figur 0.11 — hier mal
// SCALE. Der Ring ist etwas grösser als der Stossradius, damit er sich beim
// Aufprall sichtbar eindrückt statt kurz vorher abzuprallen.
const SCALE = 2.6;
const PLATE_R = 2.72;
const DECK_Y = 0.3;
const BLOOM_R = 0.11 * SCALE * 1.12;
const WATER_Y = -0.12;
const FLOAT_R = 3.75;
const FLY_MS = 900;
const CLIMB_MS = 520;           // Sprung aus dem Wasser zurück auf die Insel
const LIVES = 3;
const POOL_W = 13;
const POOL_D = 10.5;
const RIM_BLOCKS = 30;
const DASH_MS = 280;            // so lange ist ein Schub sichtbar (wie am Server)
const STRONG_HIT = 1.1;         // ab dieser Stossstärke gibt es das grosse Programm

export class BounceArena extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.blooms = new Map();
    this.state = new Map();
    this.labelY = 0.78;
    this.pulse = 0;
    this.nachlauf = new Nachlauf({ verzug: 110 });
    this.localDashAt = -1e9;
    this.tipShown = false;
  }

  stage() {
    return {
      label: "3D Bumper Pool",
      background: "#9fdcf2",
      fog: ["#bfe8f7", 16, 40],
      lights: {
        sunPosition: [3.5, 8, 4.2],
        shadow: { left: -4, right: 4, top: 4, bottom: -4 },
        sunIntensity: 2.7,
        skyColor: 0xdfefff,
        groundColor: 0x7ab8c4,
        sunColor: 0xfff4d6
      }
    };
  }

  build() {
    const scene = this.scene;

    this.buildPool();
    this.buildIsland();

    this.drifters = [];
    [[-6.5, 4.2, -9, 1], [5.8, 5, -10, 2], [-1.5, 5.6, -12, 3]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      cloud.userData = { baseY: y, phase: seed * 1.7, drift: 0.12 };
      scene.add(cloud);
      this.drifters.push(cloud);
    });
    this.buildToys();

    // Fahrspuren: flache Flecken, die schnelle Figuren hinter sich lassen.
    this.trails = [];
    const trailGeo = new THREE.BoxGeometry(0.34, 0.004, 0.34);
    for (let i = 0; i < 28; i += 1) {
      const mesh = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      mesh.userData.isFx = true;
      scene.add(mesh);
      this.trails.push({ mesh, age: 0, life: 0.45 });
    }
    this.trailCursor = 0;
    this.trailStamp = new Map();

    const players = this.getState()?.players || [];
    const arena = this.minigame.arena;
    players.forEach((player, index) => {
      const entry = arena?.players?.[player.id];
      const x = (entry?.x || 0) * SCALE;
      const z = (entry?.y || 0) * SCALE;
      this.addKin(player, index, { x, ground: DECK_Y + 0.06, z, facing: 0, scale: 0.92 });
      this.addBloom(player);
      this.blooms.get(player.id).position.set(x, DECK_Y, z);
      this.state.set(player.id, {
        inPlay: true, facing: Math.atan2(-x, -z), squash: 0, stretch: 0, fly: null, float: null, climb: null,
        final: false, index, seenImpactAt: entry?.lastImpactAt || 0, seenDashAt: entry?.dashAt || 0, dashFxUntil: 0
      });
      this.animators.get(player.id).set("ready");
    });
  }

  // Der Schwimmring aus Blöcken: acht Stücke im Achteck, abwechselnd in der
  // Spielerfarbe und Weiss, auf Hüfthöhe; dazu das Ventil.
  addBloom(player) {
    const bloom = new THREE.Group();
    const colorMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(player.color) });
    const whiteMat = new THREE.MeshLambertMaterial({ color: "#fdfdfd" });
    const segments = 8;
    const r = BLOOM_R - 0.05;
    const length = 2 * r * Math.tan(Math.PI / segments) + 0.2;
    const piece = new THREE.BoxGeometry(0.2, 0.2, length);
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const block = new THREE.Mesh(piece, i % 2 ? whiteMat : colorMat);
      block.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r);
      block.rotation.y = -a;
      block.castShadow = true;
      bloom.add(block);
    }
    const valve = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.06), whiteMat);
    valve.position.set(r, 0.32, 0);
    bloom.add(valve);
    bloom.position.y = DECK_Y;
    this.scene.add(bloom);
    this.blooms.set(player.id, bloom);
    const shadow = this.shadows.get(player.id);
    if (shadow) {
      shadow.userData.manual = true;
      shadow.scale.setScalar(1.25);
    }
  }

  // Das Freibad: Becken mit Fliesenrand, Wasser, dahinter Liegen, Schirme,
  // Palmen und eine Rutsche.
  buildPool() {
    const scene = this.scene;
    this.water = new THREE.Mesh(
      new THREE.BoxGeometry(POOL_W, 0.4, POOL_D),
      new THREE.MeshLambertMaterial({ color: "#46b2cc", emissive: "#0d6f8f", emissiveIntensity: 0.08 })
    );
    this.water.position.y = WATER_Y - 0.2;
    this.water.receiveShadow = true;
    scene.add(this.water);
    // Heller Schimmer auf dem Wasser: flache, langsam treibende Flecken.
    this.shimmer = [];
    const shimmerMat = new THREE.MeshBasicMaterial({ color: "#c9f6ff", transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < 18; i += 1) {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.9 + (i % 3) * 0.5, 0.12), shimmerMat);
      patch.rotation.x = -Math.PI / 2;
      patch.rotation.z = (i * 0.7) % Math.PI;
      const x = -POOL_W / 2 + 0.8 + ((i * 3.7) % (POOL_W - 1.6));
      const z = -POOL_D / 2 + 0.8 + ((i * 2.3) % (POOL_D - 1.6));
      patch.position.set(x, WATER_Y + 0.01, z);
      patch.userData = { x, z, phase: i * 1.3 };
      scene.add(patch);
      this.shimmer.push(patch);
    }
    // Fliesenrand rundherum und die Liegewiese dahinter.
    const tile = new THREE.MeshLambertMaterial({ color: "#f2f5f7" });
    const tileBlue = new THREE.MeshLambertMaterial({ color: "#2f8fc4" });
    const edge = 0.8;
    [
      [0, -POOL_D / 2 - edge / 2, POOL_W + edge * 2, edge],
      [0, POOL_D / 2 + edge / 2, POOL_W + edge * 2, edge],
      [-POOL_W / 2 - edge / 2, 0, edge, POOL_D],
      [POOL_W / 2 + edge / 2, 0, edge, POOL_D]
    ].forEach(([x, z, w, d]) => {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), tile);
      rim.position.set(x, WATER_Y + 0.12, z);
      rim.receiveShadow = true;
      scene.add(rim);
      const band = new THREE.Mesh(new THREE.BoxGeometry(Math.min(w, POOL_W + 0.02), 0.08, Math.min(d, POOL_D + 0.02)), tileBlue);
      band.position.set(x, WATER_Y - 0.02, z);
      scene.add(band);
    });
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(60, 0.3, 30), new THREE.MeshLambertMaterial({ color: "#7fb476" }));
    lawn.position.set(0, WATER_Y + 0.05, -POOL_D / 2 - edge - 15);
    lawn.receiveShadow = true;
    scene.add(lawn);
    const sideLawn = new THREE.Mesh(new THREE.BoxGeometry(60, 0.3, 30), new THREE.MeshLambertMaterial({ color: "#86da80" }));
    sideLawn.position.set(0, WATER_Y + 0.05, POOL_D / 2 + edge + 15);
    scene.add(sideLawn);
    [-1, 1].forEach((side) => {
      const flank = new THREE.Mesh(new THREE.BoxGeometry(20, 0.3, POOL_D + edge * 2), sideLawn.material);
      flank.position.set(side * (POOL_W / 2 + edge + 10), WATER_Y + 0.05, 0);
      scene.add(flank);
    });

    // Liegen und Sonnenschirme am hinteren Rand.
    const backZ = -POOL_D / 2 - edge - 1.2;
    const chairColors = ["#ff6f91", "#ffd15c", "#6fd3ff", "#9b7bff"];
    [-4.8, -2.6, 2.6, 4.8].forEach((x, i) => {
      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 1.5), new THREE.MeshLambertMaterial({ color: chairColors[i] }));
      seat.position.y = 0.3;
      chair.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.7), seat.material);
      back.position.set(0, 0.55, -0.85);
      back.rotation.x = -0.9;
      chair.add(back);
      chair.position.set(x, WATER_Y + 0.2, backZ);
      scene.add(chair);
      if (i % 2 === 0) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.1, 6), new THREE.MeshLambertMaterial({ color: "#ffffff" }));
        pole.position.set(x + 1.1, WATER_Y + 1.25, backZ);
        scene.add(pole);
        const shade = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.5, 8), new THREE.MeshLambertMaterial({ color: i ? "#ff8a3d" : "#ff5d73" }));
        shade.position.set(x + 1.1, WATER_Y + 2.35, backZ);
        shade.castShadow = true;
        scene.add(shade);
      }
    });
    // Palmen links und rechts, eine Rutsche hinten rechts.
    [[-7.8, -3.5], [7.9, -4.4], [-8.3, 3.2]].forEach(([x, z], i) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 6), new THREE.MeshLambertMaterial({ color: "#b98a57" }));
      trunk.position.set(x, WATER_Y + 1.6, z);
      trunk.rotation.z = (i % 2 ? -1 : 1) * 0.12;
      scene.add(trunk);
      for (let k = 0; k < 6; k += 1) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.42), new THREE.MeshLambertMaterial({ color: k % 2 ? "#3fae5d" : "#58c774" }));
        const angle = (k / 6) * Math.PI * 2;
        leaf.position.set(x + Math.cos(angle) * 0.7, WATER_Y + 3.2, z + Math.sin(angle) * 0.7);
        leaf.rotation.y = -angle;
        leaf.rotation.z = -0.35;
        scene.add(leaf);
      }
    });
    const slideMat = new THREE.MeshLambertMaterial({ color: "#ffcf3f" });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.6, 0.9), new THREE.MeshLambertMaterial({ color: "#5aa7e0" }));
    tower.position.set(5.9, WATER_Y + 1.3, -POOL_D / 2 - edge - 0.9);
    scene.add(tower);
    const chute = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 3.2), slideMat);
    chute.position.set(5.2, WATER_Y + 1.3, -POOL_D / 2 + 0.55);
    chute.rotation.x = -0.72;
    chute.rotation.y = 0.35;
    scene.add(chute);
  }

  // Die Badeinsel: weiche Matte, rundherum ein Wulst aus rot-weissen
  // Blöcken — der Rand, über den man fliegt, wenn einen ein Schub erwischt.
  buildIsland() {
    // Alles, was zur Insel gehört, hängt an einer Gruppe: so schrumpft sie zum
    // Schluss als Ganzes, Stern und Wulst eingeschlossen.
    const scene = new THREE.Group();
    this.island = scene;
    this.scene.add(scene);
    // Feine Stufen: an diesem Rand fällt man hinunter, der sichtbare Rand
    // muss zur Kante passen, die der Server rechnet.
    const plateGeo = new THREE.CylinderGeometry(PLATE_R, PLATE_R + 0.06, 0.44, 40);
    plateGeo.userData.zellen = 25;
    const mat = new THREE.Mesh(plateGeo, new THREE.MeshLambertMaterial({ color: "#d6c6ff" }));
    mat.position.y = DECK_Y - 0.22;
    mat.receiveShadow = true;
    mat.castShadow = true;
    scene.add(mat);
    // Ein grosser Stern aufgedruckt, damit die Mitte lesbar ist.
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i += 1) {
      const r = (i % 2 ? 0.45 : 1) * PLATE_R * 0.36;
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const print = new THREE.Mesh(new THREE.ShapeGeometry(star), new THREE.MeshLambertMaterial({ color: "#fbf7ff" }));
    print.rotation.x = -Math.PI / 2;
    print.position.y = DECK_Y + 0.003;
    print.userData.isFx = true;
    scene.add(print);
    // Die Warnlinie: ausserhalb davon wird es gefährlich.
    const ringGeo = new THREE.RingGeometry(PLATE_R * 0.66 - 0.06, PLATE_R * 0.66 + 0.06, 48);
    ringGeo.userData.zellen = 25;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.75, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = DECK_Y + 0.004;
    ring.userData.isFx = true;
    scene.add(ring);
    // Der Wulst: rot-weisse Blöcke. Die roten glühen, wenn jemand vor ihnen
    // am Rand steht — man sieht, wo es gleich jemanden erwischt.
    this.rim = new THREE.Group();
    this.rimBlocks = [];
    const white = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    const r = PLATE_R + 0.06;
    const length = 2 * r * Math.tan(Math.PI / RIM_BLOCKS) + 0.04;
    const piece = new THREE.BoxGeometry(0.34, 0.3, length);
    for (let i = 0; i < RIM_BLOCKS; i += 1) {
      const a = (i / RIM_BLOCKS) * Math.PI * 2;
      const red = i % 2 === 0;
      const material = red ? new THREE.MeshLambertMaterial({ color: "#ff4668", emissive: "#ff4668", emissiveIntensity: 0.4 }) : white;
      const block = new THREE.Mesh(piece, material);
      block.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      block.rotation.y = -a;
      block.castShadow = true;
      block.receiveShadow = true;
      this.rim.add(block);
      this.rimBlocks.push({ block, angle: a, red, glow: 0 });
    }
    this.rim.position.y = DECK_Y - 0.02;
    scene.add(this.rim);
  }

  // Der aktuelle Inselradius in Weltmass.
  plateR() {
    return PLATE_R * ((this.update || this.minigame)?.arena?.radius ?? 1);
  }

  // Was sonst im Becken treibt: ein Wasserball, eine Quietscheente.
  buildToys() {
    const scene = this.scene;
    this.toys = [];
    const ball = new THREE.Group();
    ["#ff5d73", "#ffffff", "#ffd15c", "#ffffff", "#4bb8ff", "#ffffff"].forEach((color, i) => {
      const slice = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8, (i / 6) * Math.PI * 2, Math.PI / 3), new THREE.MeshLambertMaterial({ color }));
      ball.add(slice);
    });
    ball.position.set(-4.6, WATER_Y + 0.22, -2.6);
    scene.add(ball);
    this.toys.push({ mesh: ball, x: -4.6, z: -2.6, phase: 0.4, spin: 0.4 });
    const duck = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.52), new THREE.MeshLambertMaterial({ color: "#ffd84a" }));
    body.position.y = 0.1;
    duck.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), body.material);
    head.position.set(0, 0.34, 0.14);
    duck.add(head);
    const beak = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.12), new THREE.MeshLambertMaterial({ color: "#ff8a2a" }));
    beak.position.set(0, 0.32, 0.33);
    duck.add(beak);
    duck.position.set(4.7, WATER_Y, -1.9);
    scene.add(duck);
    this.toys.push({ mesh: duck, x: 4.7, z: -1.9, phase: 2.1, spin: -0.25 });
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="arena-lives" data-arena-lives></div>
      <div class="color-banner arena-banner" data-arena-banner hidden></div>`;
  }

  shot() {
    return {
      look: [0, 0.2, 0.25],
      frame: { w: PLATE_R * 2 + 0.75, h: 4.4 },
      pitch: 0.72,
      fov: 36,
      ease: 0.06,
      intro: { yaw: 0.6, pitch: 0.25, zoom: 1.45 },
      finale: { pull: 0.6, zoom: 0.72, lift: 0.35, orbit: 0.16 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls arena-controls">
        <div class="joystick-slot"></div>
        <button type="button" class="snow-throw arena-dash" data-arena-dash>
          <span class="snow-meter"><i data-arena-meter></i></span>
          <b>RAMMEN!</b>
        </button>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Schwimmring lenken",
      intervalMs: 70,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "thrust", x, y }).catch(() => {}),
      onEngage: () => {
        this.feedback?.sound("move");
        this.feedback?.vibrate(10);
      }
    });
    this.dashButton = this.controls.querySelector("[data-arena-dash]");
    this.dashMeter = this.controls.querySelector("[data-arena-meter]");
    this.on(this.dashButton, "pointerdown", (event) => {
      event.preventDefault();
      this.pressDash();
    });
    // Am Rechner: Leertaste rammt.
    this.on(window, "keydown", (event) => {
      if (event.repeat || event.code !== "Space") return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable], dialog, .overlay")) return;
      const menu = document.getElementById("game-menu");
      if (menu && !menu.hidden) return;
      event.preventDefault();
      this.pressDash();
    });
  }

  unbind() {
    this.joystick?.destroy();
    this.joystick = null;
  }

  // RAMMEN: sofort spürbar auf dem eigenen Gerät — Ton, Ruck, Wasserfahne —,
  // die Bewegung selbst rechnet der Server.
  pressDash() {
    const minigame = this.update || this.minigame;
    const now = this.now();
    if (!minigame || minigame.finaleAt || now < minigame.startedAt) return;
    const id = this.getControlledPlayerId();
    const entry = minigame.arena?.players?.[id];
    if (!entry?.inPlay) return;
    if (now < (entry.dashReadyAt || 0) - 80) {
      // Noch nicht bereit: der Knopf zuckt, statt dass nichts passiert.
      this.dashButton?.animate?.([{ transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "none" }], { duration: 160 });
      this.feedback?.sound("tap", { pitch: 0.6 });
      return;
    }
    const x = this.joystick?.vecX || 0;
    const y = this.joystick?.vecY || 0;
    this.sendInput({ action: "dash", x, y }).catch(() => {});
    this.localDashAt = now;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(16);
    this.dashButton?.animate?.([{ transform: "translateY(6px) scale(0.97)" }, { transform: "none" }], { duration: 140, easing: "ease-out" });
    const s = this.state.get(id);
    if (s) this.dashFx(id, s, true);
  }

  onUpdate(update) {
    const players = update.arena?.players;
    if (!players) return;
    this.nachlauf.merke(update.sentAt, this.now(), Object.entries(players).filter(([, ap]) => ap.inPlay), ([id, ap]) => ({ id, x: ap.x, y: ap.y, vx: ap.vx, vy: ap.vy }));
  }

  // Ein Schub: der Ring streckt sich, hinter ihm spritzt eine Wasserfahne.
  dashFx(id, s, mine) {
    const bloom = this.blooms.get(id);
    const player = this.getState()?.players?.find((p) => p.id === id);
    if (!bloom) return;
    s.stretch = 1;
    s.dashFxUntil = this.now() + DASH_MS + 120;
    const back = new THREE.Vector3(-Math.sin(s.facing), 0, -Math.cos(s.facing));
    const at = bloom.position.clone().addScaledVector(back, 0.35);
    at.y = DECK_Y + 0.15;
    this.burst(at, ["#ffffff", "#bff1ff", player?.color || "#ffffff"], { count: mine ? 12 : 8, speed: 1.6, up: 1.1, size: 0.07, life: 0.4, gravity: 3 });
    this.animators.get(id)?.expression("effort", 450);
  }

  // Ein Zusammenstoss, so stark wie er am Server war.
  impactFx(player, s, strength, involvesMe, bloom) {
    const animator = this.animators.get(player.id);
    s.squash = Math.min(1, 0.45 + strength * 0.35);
    animator?.trigger("flinch");
    const strong = strength >= STRONG_HIT;
    const at = bloom.position.clone();
    at.y = DECK_Y + 0.3;
    this.burst(at, ["#ffffff", player.color], { count: strong ? 12 : 5, speed: strong ? 2.6 : 1.6, up: strong ? 2 : 1.3, size: strong ? 0.08 : 0.06, life: 0.45 });
    if (strong) {
      this.bursts.ring(at.clone().setY(DECK_Y + 0.03), "#ffffff", { radius: 1.4, life: 0.45, opacity: 0.85, y: DECK_Y + 0.03 });
      this.pulse = Math.max(this.pulse, 0.9);
      animator?.expression("surprised", 600);
    }
    if (involvesMe) {
      this.rig?.shake(strong ? 0.6 : 0.25);
      this.feedback?.sound(strong ? "impact" : "collision", { pitch: strong ? 1 : 1.25 - Math.min(0.4, strength * 0.2) });
      this.feedback?.vibrate(strong ? [26, 20, 30] : 14);
    } else if (strong) {
      this.feedback?.sound("clack", { pan: Math.max(-1, Math.min(1, bloom.position.x / 3)) });
    }
  }

  tick(f) {
    const { now, dt, minigame, players, controlledId, finale } = f;
    const arena = minigame.arena;
    if (!arena?.players) return;
    const frameNow = performance.now();
    const zeit = this.nachlauf.zeichenzeit(now);
    let danger = 0;
    const edgeAt = [];

    players.forEach((player) => {
      const entry = arena.players[player.id];
      const kin = this.kins.get(player.id);
      const bloom = this.blooms.get(player.id);
      const animator = this.animators.get(player.id);
      const s = this.state.get(player.id);
      const shadow = this.shadows.get(player.id);
      if (!entry || !kin || !bloom || !animator || !s) return;
      const mine = player.id === controlledId;
      const drawn = this.nachlauf.wo(player.id, now);

      // Hinausgeflogen: erst, wenn der Ring im Bild auch am Rand ist — dann
      // Bogen nach aussen, Überschlag, Platsch.
      if (s.inPlay && !entry.inPlay && (!drawn || zeit >= (entry.knockedAt || 0))) {
        this.knockOff(player, entry, s, kin, bloom, animator, f);
      }

      // Zurück aus dem Wasser: ein Sprung auf die Stelle, die der Server
      // freigegeben hat.
      if (!s.inPlay && entry.inPlay) {
        s.inPlay = true;
        s.fly = null;
        s.float = null;
        s.climb = { from: bloom.position.clone(), start: now };
        s.seenImpactAt = entry.lastImpactAt || 0;
        s.seenDashAt = entry.dashAt || 0;
        kin.userData.outOfPlay = false;
        kin.userData.versetzt = performance.now() + CLIMB_MS;
        s.facing = Math.atan2(-entry.x, -entry.y);
        kin.rotation.set(0, s.facing, 0);
        animator.trigger("jump");
        animator.expression("effort", 500);
        if (kin.userData.label) kin.userData.label.material.opacity = 1;
        if (mine) {
          this.ownInView = true;
          this.feedback?.sound("whoosh");
        }
      }

      if (!s.inPlay) {
        this.tickOut(player, entry, s, kin, bloom, animator, shadow, f);
        return;
      }

      if (s.climb) {
        const u = Math.min(1, (now - s.climb.start) / CLIMB_MS);
        const tx = entry.x * SCALE;
        const tz = entry.y * SCALE;
        bloom.position.set(
          THREE.MathUtils.lerp(s.climb.from.x, tx, u),
          THREE.MathUtils.lerp(s.climb.from.y, DECK_Y, u) + Math.sin(u * Math.PI) * 1.1,
          THREE.MathUtils.lerp(s.climb.from.z, tz, u)
        );
        bloom.rotation.set(0, bloom.rotation.y, 0);
        kin.position.x = bloom.position.x;
        kin.position.z = bloom.position.z;
        animator.groundY = bloom.position.y + 0.36;
        if (shadow) shadow.visible = false;
        if (u >= 1) {
          s.climb = null;
          animator.groundY = DECK_Y + 0.36;
          this.bursts.ring(new THREE.Vector3(tx, DECK_Y + 0.03, tz), player.color, { radius: 1, life: 0.45, y: DECK_Y + 0.03 });
        }
        return;
      }

      // Stösse und Schübe genau dann, wenn sie im Bild passieren.
      if ((entry.lastImpactAt || 0) > s.seenImpactAt && zeit >= entry.lastImpactAt) {
        s.seenImpactAt = entry.lastImpactAt;
        const partner = players.find((other) => other.id !== player.id && arena.players[other.id]?.lastImpactAt === entry.lastImpactAt);
        this.impactFx(player, s, entry.lastImpact || 0, mine || partner?.id === controlledId, bloom);
      }
      if ((entry.dashAt || 0) > s.seenDashAt && zeit >= entry.dashAt) {
        s.seenDashAt = entry.dashAt;
        // Den eigenen Schub hat das Gerät schon beim Drücken gezeigt.
        if (!(mine && now - this.localDashAt < 600)) this.dashFx(player.id, s, false);
      }

      // Position: die weiche Bahn zwischen den Serverbildern.
      const px = drawn ? drawn.x : entry.x;
      const pz = drawn ? drawn.y : entry.y;
      const vx = drawn ? drawn.vx : (entry.vx || 0);
      const vz = drawn ? drawn.vy : (entry.vy || 0);
      bloom.position.x = px * SCALE;
      bloom.position.z = pz * SCALE;
      bloom.position.y = DECK_Y;

      // In Fahrtrichtung drehen und hineinlehnen. Die eigene Figur dreht sich
      // sofort mit dem Stick — das Gerät weiss es vor dem Server.
      const speed = Math.hypot(vx, vz);
      const stick = mine && this.joystick?.engaged ? Math.hypot(this.joystick.vecX, this.joystick.vecY) : 0;
      if (finale) {
        s.facing += Math.atan2(Math.sin(-s.facing), Math.cos(-s.facing)) * frameLerp(0.08, dt);
      } else if (stick > 0.3) {
        const want = Math.atan2(this.joystick.vecX, this.joystick.vecY);
        s.facing += Math.atan2(Math.sin(want - s.facing), Math.cos(want - s.facing)) * frameLerp(0.3, dt);
      } else if (speed > 0.12) {
        const want = Math.atan2(vx, vz);
        s.facing += Math.atan2(Math.sin(want - s.facing), Math.cos(want - s.facing)) * frameLerp(0.18, dt);
      }
      const dashing = now < s.dashFxUntil;
      const lean = Math.min(0.26, speed * 0.1 + (dashing ? 0.12 : 0));
      bloom.rotation.set(Math.cos(s.facing) * lean, 0, -Math.sin(s.facing) * lean);
      bloom.rotation.y += dt * speed * 0.8;
      s.squash *= frameDecay(0.8, dt);
      s.stretch *= frameDecay(0.86, dt);
      const sq = s.squash * 0.28;
      const st = s.stretch * 0.22;
      bloom.scale.set(1 + sq - st * 0.4, 1 - sq * 0.8, 1 + sq + st);

      kin.position.x = bloom.position.x;
      kin.position.z = bloom.position.z;
      kin.rotation.y = s.facing;
      kin.rotation.x = Math.cos(s.facing) * lean * 0.6;
      kin.rotation.z = -Math.sin(s.facing) * lean * 0.6;

      // Wie nah am Rand, und rutscht man darauf zu?
      const dist = Math.hypot(px, pz);
      const outward = dist > 0.01 ? (vx * px + vz * pz) / dist : 0;
      const edge = Math.max(0, (dist / (arena.radius || 1) - 0.62) / 0.3);
      if (mine) danger = Math.max(danger, Math.min(1, edge));
      if (edge > 0.2) edgeAt.push({ angle: Math.atan2(pz, px), edge: Math.min(1, edge) });
      const invulnerable = now < (entry.invulnUntil || 0);
      this.fade(player.id, invulnerable ? 0.5 + Math.abs(Math.sin(now / 120)) * 0.4 : 1);

      if (!finale) {
        if (dashing) {
          animator.set("charge", { params: { power: 1 } });
        } else if (edge > 0.6 && outward > 0.15) {
          animator.set("balance", { params: { wobble: Math.sin(now / 90) } });
          animator.expression("scared", 200);
        } else if (speed > 0.35) {
          animator.set("ride");
          if (speed > 1.4) animator.expression("effort", 150);
        } else {
          animator.set("ready");
        }
      }

      if (shadow) {
        shadow.visible = true;
        shadow.position.set(bloom.position.x, DECK_Y + 0.012, bloom.position.z);
        shadow.material.opacity = 0.24;
      }

      // Spur legen, solange Fahrt drin ist.
      if (speed > 1.0) {
        const last = this.trailStamp.get(player.id) || 0;
        if (frameNow - last > 60) {
          this.trailStamp.set(player.id, frameNow);
          const spur = this.trails[this.trailCursor];
          this.trailCursor = (this.trailCursor + 1) % this.trails.length;
          spur.mesh.position.set(bloom.position.x, DECK_Y + 0.012, bloom.position.z);
          spur.mesh.material.color.set(player.color);
          spur.mesh.rotation.y = s.facing;
          spur.mesh.scale.setScalar(0.8 + Math.min(1, speed / 3) * 0.6);
          spur.mesh.visible = true;
          spur.age = 0;
        }
      }
    });

    this.pulse *= frameDecay(0.85, dt);
    const radius = arena.radius ?? 1;
    this.island.scale.set(radius, 1, radius);
    // Der Wulst glüht dort, wo jemand am Rand steht; schrumpft die Insel,
    // pulsiert er ringsum.
    const shrinkGlow = arena.shrinking ? 0.45 + Math.sin(now / 110) * 0.3 : 0;
    this.rimBlocks.forEach((rb) => {
      if (!rb.red) return;
      let near = 0;
      edgeAt.forEach(({ angle, edge }) => {
        const d = Math.abs(Math.atan2(Math.sin(angle - rb.angle), Math.cos(angle - rb.angle)));
        if (d < 0.5) near = Math.max(near, edge * (1 - d / 0.5));
      });
      rb.glow += (near - rb.glow) * frameLerp(0.25, dt);
      rb.block.material.emissiveIntensity = 0.3 + Math.sin(now / 190 + rb.angle) * 0.08 + rb.glow * 1.3 + this.pulse * 0.5 + shrinkGlow;
    });
    this.dangerOwn = danger;
    this.shimmer?.forEach((patch) => {
      const d = patch.userData;
      patch.position.x = d.x + Math.sin(now / 1700 + d.phase) * 0.4;
      patch.position.z = d.z + Math.cos(now / 2100 + d.phase) * 0.3;
      patch.material.opacity = 0.22 + Math.sin(now / 900 + d.phase) * 0.1;
    });
    this.toys?.forEach((toy) => {
      toy.mesh.position.x = toy.x + Math.sin(now / 2600 + toy.phase) * 0.5;
      toy.mesh.position.z = toy.z + Math.cos(now / 3100 + toy.phase) * 0.4;
      toy.mesh.position.y = (toy.mesh === this.toys[0].mesh ? WATER_Y + 0.22 : WATER_Y) + Math.sin(now / 600 + toy.phase) * 0.04;
      toy.mesh.rotation.y += dt * toy.spin;
    });
    this.drifters.forEach((drifter) => {
      const data = drifter.userData;
      drifter.position.y = data.baseY + Math.sin(now / 1400 + data.phase) * data.drift;
    });
    this.water.position.y = WATER_Y - 0.2 + Math.sin(now / 900) * 0.015;
    this.trails.forEach((spur) => {
      if (!spur.mesh.visible) return;
      spur.age += dt;
      const t = spur.age / spur.life;
      if (t >= 1) {
        spur.mesh.visible = false;
        return;
      }
      spur.mesh.material.opacity = 0.42 * (1 - t);
      spur.mesh.scale.multiplyScalar(1 + dt * 0.8);
    });
  }

  knockOff(player, entry, s, kin, bloom, animator, f) {
    const { now, players, controlledId } = f;
    s.inPlay = false;
    s.climb = null;
    s.final = (entry.lives ?? 0) <= 0;
    // Für die Prüfwerkzeuge: diese Figur ist gerade nicht im Spiel — sie
    // muss weder auf dem Boden stehen noch im Bild sein.
    kin.userData.outOfPlay = true;
    this.nachlauf.bahnen.delete(player.id);
    const from = bloom.position.clone();
    const dir = new THREE.Vector3(from.x, 0, from.z);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    // Mit Leben übrig landet man gleich neben der Insel und springt von dort
    // zurück; wer raus ist, fliegt weiter hinaus und paddelt nach vorn.
    const reach = s.final ? FLOAT_R + noise(player.id.length) * 0.4 : this.plateR() + 0.75;
    const to = dir.clone().multiplyScalar(reach);
    to.y = WATER_Y + 0.02;
    s.fly = { from, to, start: now, spin: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3) };
    const count = Math.max(1, players.length);
    const angle = Math.atan2(to.z, to.x);
    const home = s.final ? Math.PI / 2 + (s.index - (count - 1) / 2) * 0.32 : angle;
    s.float = { angle, home, reach, x: to.x, z: to.z, phase: Math.random() * 6 };
    animator.trigger("tumble");
    animator.expression("scared", 900);
    this.burst(from.clone().add(new THREE.Vector3(0, 0.4, 0)), ["#ffffff", player.color], { count: 12, speed: 2.2, up: 2.2, size: 0.08, life: 0.6 });
    this.pop(from.clone().add(new THREE.Vector3(0, 1.1, 0)), s.final ? "RAUS!" : "−1 ♥", { color: player.color, size: 0.36, life: 0.9 });
    // Wer hat geschoben? Der bekommt seinen Moment.
    const hitter = entry.knockedBy && this.kins.get(entry.knockedBy);
    if (hitter && entry.knockedBy !== player.id) {
      this.animators.get(entry.knockedBy)?.trigger("fistpump");
      if (entry.knockedBy === controlledId) {
        this.pop(hitter.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "Rauswurf!", { color: "#ffe36b", size: 0.34, life: 0.9 });
        this.feedback?.sound("success");
        this.feedback?.vibrate([20, 30, 20]);
      }
    }
    if (player.id === controlledId) {
      this.feedback?.sound("fall");
      this.feedback?.vibrate([35, 35, 48]);
      if (s.final) {
        this.ownInView = false;
        this.flash = { text: "Raus! Schau zu, wer übrig bleibt.", until: now + 2600, tone: "out" };
      } else {
        const left = entry.lives ?? 0;
        this.flash = { text: left === 1 ? "Letztes Leben!" : `Noch ${left} Leben`, until: now + 1600, tone: left === 1 ? "out" : "warn" };
      }
    }
  }

  tickOut(player, entry, s, kin, bloom, animator, shadow, f) {
    const { now, dt, controlledId } = f;
    if (s.fly) {
      const u = Math.min(1, (now - s.fly.start) / FLY_MS);
      bloom.position.lerpVectors(s.fly.from, s.fly.to, u);
      bloom.position.y = THREE.MathUtils.lerp(s.fly.from.y, s.fly.to.y, u * u) + Math.sin(u * Math.PI) * 1.3;
      bloom.rotation.x += dt * s.fly.spin;
      kin.position.x = bloom.position.x;
      kin.position.z = bloom.position.z;
      animator.groundY = bloom.position.y + 0.36;
      kin.rotation.x = bloom.rotation.x;
      if (u >= 1) {
        s.fly = null;
        bloom.rotation.set(0, 0, 0);
        const at = new THREE.Vector3(s.float.x, WATER_Y + 0.1, s.float.z);
        this.burst(at, ["#ffffff", "#7fdbe8"], { count: 18, speed: 2.4, up: 2.6, size: 0.09, life: 0.8, drag: 1.5 });
        this.bursts.ring(at, "#7fdbe8", { radius: 1.6, life: 0.6, y: WATER_Y + 0.05 });
        this.pop(at.clone().add(new THREE.Vector3(0, 1, 0)), "PLATSCH! 💦", { color: "#bfe9ff", size: 0.4, life: 1 });
        if (player.id === controlledId) this.feedback?.sound("land");
        animator.expression("dizzy", 1400);
      }
      if (shadow) shadow.visible = false;
      return;
    }
    // Im Wasser: im eigenen Ring nach vorn paddeln, dann zur Insel schauen.
    let diff = s.float.home - s.float.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const paddling = Math.abs(diff) > 0.04;
    s.float.angle += Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.55);
    // Nicht raus, nur nass: neben der Insel treiben, zur Mitte schauen und
    // auf den Sprung zurück warten. Die Insel schrumpft womöglich — der Platz
    // im Wasser rückt mit.
    if (!s.final) s.float.reach = Math.min(s.float.reach, this.plateR() + 0.75);
    s.float.x = Math.cos(s.float.angle) * (s.float.reach ?? FLOAT_R);
    s.float.z = Math.sin(s.float.angle) * (s.float.reach ?? FLOAT_R);
    const bob = Math.sin(now / 520 + s.float.phase) * 0.05;
    bloom.position.set(s.float.x, WATER_Y - 0.2 + bob, s.float.z);
    bloom.scale.set(1, 1, 1);
    bloom.rotation.set(Math.sin(now / 700 + s.float.phase) * 0.06, bloom.rotation.y + dt * 0.2, Math.cos(now / 800 + s.float.phase) * 0.06);
    kin.position.x = s.float.x;
    kin.position.z = s.float.z;
    // Beim Paddeln in Schwimmrichtung, sonst zur Mitte.
    const tangent = Math.atan2(-Math.sin(s.float.angle) * Math.sign(diff), Math.cos(s.float.angle) * Math.sign(diff));
    const facing = paddling ? tangent : Math.atan2(-s.float.x, -s.float.z);
    kin.rotation.set(0, facing, 0);
    animator.groundY = WATER_Y + 0.14 + bob;
    if (!f.finale) animator.set("float");
    if (kin.userData.label) kin.userData.label.material.opacity = 0.55;
    if (shadow) shadow.visible = false;
  }

  finaleOverride(player) {
    // Wer im Wasser treibt, bleibt dort und schaut dem Sieger zu.
    const s = this.state.get(player.id);
    if (s && !s.inPlay) {
      this.animators.get(player.id)?.set("float");
      return true;
    }
    return false;
  }

  // Im Bild: wer auf der Insel ist oder gleich zurückspringt. Wer endgültig
  // raus ist, paddelt vorn am Rand und ist Zuschauer.
  keepInView(f) {
    return f.players.filter((player) => {
      const s = this.state.get(player.id);
      return s && (s.inPlay || !s.final);
    }).map((player) => this.kins.get(player.id)).filter(Boolean);
  }

  // Die Kamera zeigt immer die ganze Insel — man muss sehen, wie nah der Rand
  // ist. Sie rückt nur ein wenig zur eigenen Figur, und wenn die Insel
  // schrumpft, rückt sie mit heran: das Finale wird enger, auch im Bild.
  rigOptions(f) {
    if (f.finale) return {};
    const own = this.blooms.get(f.controlledId);
    const s = this.state.get(f.controlledId);
    const bias = own && s?.inPlay ? 0.1 : 0;
    const w = this.plateR() * 2 + 0.75;
    return {
      look: [(own?.position.x || 0) * bias, 0.2, (own?.position.z || 0) * bias + 0.25],
      frame: { w, h: Math.max(3.4, w * 0.7) }
    };
  }

  drawHud(f) {
    const arena = f.minigame.arena;
    const entry = arena?.players?.[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    // Oben die eigenen Leben — danach wird gewertet.
    const livesText = `${entry?.lives ?? 0}♥`;
    if (this.scoreNode && this.scoreNode.textContent !== livesText) this.scoreNode.textContent = livesText;
    const lives = this.livesNode ||= this.hud.querySelector("[data-arena-lives]");
    if (lives && arena?.players) {
      const html = f.players.map((player) => {
        const ap = arena.players[player.id];
        const left = ap?.lives ?? 0;
        const dots = Array.from({ length: LIVES }, (_, i) => `<i class="${i < left ? "on" : ""}"></i>`).join("");
        const cls = `arena-life${left <= 0 ? " is-out" : ""}${player.id === f.controlledId ? " is-own" : ""}`;
        return `<span class="${cls}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${dots}</span>`;
      }).join("");
      if (html !== this.livesHtml) {
        this.livesHtml = html;
        lives.innerHTML = html;
      }
    }

    // Der RAMMEN-Knopf füllt sich wieder auf; voll leuchtet er.
    if (this.dashButton && entry) {
      const cooldown = arena.dashCooldownMs || 2200;
      const wait = Math.max(0, (entry.dashReadyAt || 0) - f.now);
      const share = f.started ? Math.max(0, Math.min(1, 1 - wait / cooldown)) : 0;
      const usable = entry.inPlay && !f.finale && f.started;
      const ready = usable && wait <= 0;
      if (this.dashMeter) this.dashMeter.style.width = `${Math.round(share * 100)}%`;
      this.dashButton.classList.toggle("is-ready", ready);
      this.dashButton.classList.toggle("is-off", !usable);
      if (ready && !this.wasReady && f.started && this.everDashed) this.feedback?.vibrate(6);
      if (!ready && this.wasReady) this.everDashed = true;
      this.wasReady = ready;
    }

    const banner = this.bannerNode ||= this.hud.querySelector("[data-arena-banner]");
    if (!banner) return;
    // Einmal kurz erklären, wenn RAMMEN frei wird — das ist der Kern.
    if (!this.tipShown && entry && f.started && f.now >= (entry.dashReadyAt || 0)) {
      this.tipShown = true;
      this.flash = { text: "RAMMEN am Rand wirft raus!", until: f.now + 2600, tone: "warn" };
    }
    if (arena?.shrinking && !this.shrinkAnnounced && !f.finale) {
      this.shrinkAnnounced = true;
      this.flash = { text: "Die Insel schrumpft!", until: f.now + 2400, tone: "warn" };
      this.feedback?.sound("countdown");
    }
    if (this.flash && f.now < this.flash.until && !f.finale) {
      banner.hidden = false;
      if (banner.textContent !== this.flash.text) banner.textContent = this.flash.text;
      banner.dataset.tone = this.flash.tone;
    } else {
      banner.hidden = true;
    }
  }
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
