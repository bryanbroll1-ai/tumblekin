import * as THREE from "/vendor/three/three.module.js";
import { createCloud, noise } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameDecay, frameLerp } from "./Quality.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";

// Bumper Pool: jede Figur sitzt in einem gestreiften Schwimmring auf einer
// Badeinsel mitten im Freibad und rempelt die anderen ins Becken.
//
// Vorher war es eine Blütenscheibe über einem See, und die Figuren standen in
// Blütenringen. Die Physik ist dieselbe geblieben — nur passt das Bild jetzt
// zu dem, was passiert: wer hinausfliegt, landet mit seinem Ring im Wasser,
// treibt dort weiter und paddelt zurück, bis er wieder auf die Insel darf.
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
const POOL_W = 13;
const POOL_D = 10.5;

export class BounceArena extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.blooms = new Map();
    this.state = new Map();
    this.lastCollisions = new Map();
    this.lastServerAt = performance.now();
    this.ownFxAt = 0;
    this.labelY = 0.78;
    this.markerOffset = 0.7;
    this.pulse = 0;
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

    // Fahrspuren: flache Scheiben, die schnelle Figuren hinter sich lassen.
    this.trails = [];
    const trailGeo = new THREE.CircleGeometry(0.26, 10);
    for (let i = 0; i < 28; i += 1) {
      const mesh = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
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
      this.state.set(player.id, { inPlay: true, facing: 0, squash: 0, fly: null, float: null, index });
      this.animators.get(player.id).set("ready");
    });
  }

  // Der Schwimmring: ein dicker Schlauch, abwechselnd in der Spielerfarbe und
  // Weiss gestreift, auf Hüfthöhe. Die Hände liegen darauf.
  addBloom(player) {
    const bloom = new THREE.Group();
    const color = new THREE.Color(player.color);
    const colorMat = new THREE.MeshLambertMaterial({ color });
    const whiteMat = new THREE.MeshLambertMaterial({ color: "#fdfdfd" });
    const segments = 8;
    for (let i = 0; i < segments; i += 1) {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(BLOOM_R - 0.05, 0.1, 8, 5, (Math.PI * 2) / segments + 0.01),
        i % 2 ? whiteMat : colorMat
      );
      arc.rotation.x = Math.PI / 2;
      arc.rotation.z = (i / segments) * Math.PI * 2;
      arc.position.y = 0.2;
      arc.castShadow = true;
      bloom.add(arc);
    }
    // Das Ventil — ein kleines Detail, an dem man einen Schwimmring erkennt.
    const valve = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.05), whiteMat);
    valve.position.set(BLOOM_R - 0.05, 0.3, 0);
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
      new THREE.MeshLambertMaterial({ color: "#35c6e6", emissive: "#0d6f8f", emissiveIntensity: 0.18 })
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
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(60, 0.3, 30), new THREE.MeshLambertMaterial({ color: "#7fd47a" }));
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

  // Die Badeinsel: weiche Matte, rundherum ein dicker rot-weisser Wulst — der
  // Rand, über den man fliegt, wenn man zu hart gerammt wird.
  buildIsland() {
    const scene = this.scene;
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(PLATE_R, PLATE_R + 0.06, 0.44, 40), new THREE.MeshLambertMaterial({ color: "#d6c6ff" }));
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
    scene.add(print);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(PLATE_R * 0.66 - 0.04, PLATE_R * 0.66 + 0.04, 48),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.75, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = DECK_Y + 0.004;
    scene.add(ring);
    // Der Wulst: rot-weiss gestreift; er glüht, wenn jemand nah dran ist.
    this.rim = new THREE.Group();
    const red = new THREE.MeshLambertMaterial({ color: "#ff4668", emissive: "#ff4668", emissiveIntensity: 0.6 });
    const white = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    this.rim.material = red;
    const segments = 16;
    for (let i = 0; i < segments; i += 1) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(PLATE_R + 0.04, 0.16, 8, 6, (Math.PI * 2) / segments + 0.01), i % 2 ? white : red);
      arc.rotation.x = Math.PI / 2;
      arc.rotation.z = (i / segments) * Math.PI * 2;
      arc.castShadow = true;
      this.rim.add(arc);
    }
    this.rim.position.y = DECK_Y - 0.02;
    scene.add(this.rim);
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
    return `<div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>`;
  }

  shot() {
    return {
      look: [0, 0.2, 0.25],
      frame: { w: PLATE_R * 2 + 0.5, h: 4.4 },
      pitch: 0.72,
      fov: 36,
      ease: 0.06,
      intro: { yaw: 0.6, pitch: 0.25, zoom: 1.45 },
      finale: { pull: 0.7, zoom: 0.5, lift: 0.35, orbit: 0.2 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Schwimmring lenken und rammen",
      intervalMs: 70,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "thrust", x, y }).catch(() => {}),
      onEngage: () => {
        this.feedback?.sound("move");
        this.feedback?.vibrate(10);
      }
    });
  }

  unbind() {
    this.joystick?.destroy();
    this.joystick = null;
  }

  onUpdate(update) {
    const id = this.getControlledPlayerId();
    const own = update.arena?.players?.[id];
    const nowP = performance.now();
    // Viele Stösse hintereinander geben einen kräftigen Ruck, kein Flackern.
    if ((own?.collisionCount || 0) > (this.lastCollisions.get(`own:${id}`) || 0) && nowP - this.ownFxAt > 200) {
      this.ownFxAt = nowP;
      this.rig?.shake(0.5);
      this.feedback?.sound("collision");
      this.feedback?.vibrate(18);
    }
    this.lastCollisions.set(`own:${id}`, own?.collisionCount || 0);
    this.lastServerAt = nowP;
  }

  tick(f) {
    const { now, dt, minigame, players, controlledId, finale } = f;
    const arena = minigame.arena;
    if (!arena?.players) return;
    const frameNow = performance.now();
    const snapshotAge = Math.min(0.22, (frameNow - this.lastServerAt) / 1000);
    let danger = 0;

    players.forEach((player) => {
      const entry = arena.players[player.id];
      const kin = this.kins.get(player.id);
      const bloom = this.blooms.get(player.id);
      const animator = this.animators.get(player.id);
      const s = this.state.get(player.id);
      const shadow = this.shadows.get(player.id);
      if (!entry || !kin || !bloom || !animator || !s) return;

      // Hinausgeflogen: Bogen nach aussen, Überschlag, Platsch.
      if (s.inPlay && !entry.inPlay) {
        s.inPlay = false;
        // Für die Prüfwerkzeuge: diese Figur ist raus und treibt im Wasser —
        // sie muss weder auf dem Boden stehen noch im Bild sein.
        kin.userData.outOfPlay = true;
        const from = bloom.position.clone();
        const dir = new THREE.Vector3(from.x, 0, from.z);
        if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
        dir.normalize();
        const to = dir.clone().multiplyScalar(FLOAT_R + noise(player.id.length) * 0.4);
        to.y = WATER_Y + 0.02;
        s.fly = { from, to, start: now, spin: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3) };
        // Im Wasser paddelt man dann nach vorn, wo die Kamera einen sieht —
        // jeder an seinen eigenen Platz, damit keiner hinter dem anderen treibt.
        const count = Math.max(1, players.length);
        const home = Math.PI / 2 + (s.index - (count - 1) / 2) * 0.32;
        s.float = { angle: Math.atan2(to.z, to.x), home, x: to.x, z: to.z, phase: Math.random() * 6 };
        animator.trigger("tumble");
        animator.expression("scared", 900);
        this.burst(from.clone().add(new THREE.Vector3(0, 0.4, 0)), ["#ffffff", player.color], { count: 12, speed: 2.2, up: 2.2, size: 0.08, life: 0.6 });
        this.pop(from.clone().add(new THREE.Vector3(0, 1.1, 0)), "RAUS!", { color: player.color, size: 0.36, life: 0.9 });
        if (player.id === controlledId) {
          this.feedback?.sound("fall");
          this.feedback?.vibrate([35, 35, 48]);
          this.ownInView = false;
        }
      }

      if (!s.inPlay) {
        this.tickOut(player, entry, s, kin, bloom, animator, shadow, f);
        return;
      }

      // Zusammenstoss: der Ring drückt sich ein, die Figur zuckt.
      const collisions = entry.collisionCount || 0;
      if (collisions > (this.lastCollisions.get(player.id) || 0)) {
        s.squash = 1;
        animator.trigger("flinch");
        animator.expression(entry.launchedUntil > now ? "surprised" : "effort", 450);
        const stamp = this.trailStamp.get(`hit:${player.id}`) || 0;
        if (frameNow - stamp > 240) {
          this.trailStamp.set(`hit:${player.id}`, frameNow);
          this.burst(bloom.position.clone().add(new THREE.Vector3(0, 0.3, 0)), ["#ffffff", player.color], { count: 6, speed: 1.8, up: 1.6, size: 0.06, life: 0.45 });
          this.bursts.ring(bloom.position.clone().setY(DECK_Y + 0.03), "#ffffff", { radius: 1.1, life: 0.45, opacity: 0.8, y: DECK_Y + 0.03 });
          this.pulse = Math.max(this.pulse, 0.6);
        }
      }
      this.lastCollisions.set(player.id, collisions);

      // Position: Servertakt plus kleiner Vorlauf aus der Geschwindigkeit.
      const lead = snapshotAge + 0.05;
      const tx = (entry.x + (entry.vx || 0) * lead) * SCALE;
      const tz = (entry.y + (entry.vy || 0) * lead) * SCALE;
      const k = 1 - Math.pow(0.0004, dt);
      bloom.position.x += (tx - bloom.position.x) * k;
      bloom.position.z += (tz - bloom.position.z) * k;
      bloom.position.y = DECK_Y;

      // In Fahrtrichtung drehen und hineinlehnen.
      const speed = Math.hypot(entry.vx || 0, entry.vy || 0);
      if (finale) {
        // Der Sieger dreht sich zur Kamera.
        s.facing += Math.atan2(Math.sin(-s.facing), Math.cos(-s.facing)) * frameLerp(0.08, dt);
      } else if (speed > 0.12) {
        const want = Math.atan2(entry.vx, entry.vy);
        let diff = want - s.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        s.facing += diff * frameLerp(0.18, dt);
      }
      const lean = Math.min(0.22, speed * 0.1);
      bloom.rotation.set(Math.cos(s.facing) * lean, 0, -Math.sin(s.facing) * lean);
      bloom.rotation.y += dt * speed * 0.8;
      s.squash *= frameDecay(0.8, dt);
      const sq = s.squash * 0.28;
      bloom.scale.set(1 + sq, 1 - sq * 0.8, 1 + sq);

      kin.position.x = bloom.position.x;
      kin.position.z = bloom.position.z;
      kin.rotation.y = s.facing;
      kin.rotation.x = Math.cos(s.facing) * lean * 0.6;
      kin.rotation.z = -Math.sin(s.facing) * lean * 0.6;

      // Wie nah am Rand, und rutscht man darauf zu?
      const dist = Math.hypot(entry.x, entry.y);
      const outward = dist > 0.01 ? ((entry.vx || 0) * entry.x + (entry.vy || 0) * entry.y) / dist : 0;
      const edge = Math.max(0, (dist - 0.62) / 0.3);
      danger = Math.max(danger, Math.min(1, edge));
      const invulnerable = now < (entry.invulnUntil || 0);
      this.fade(player.id, invulnerable ? 0.5 + Math.abs(Math.sin(now / 120)) * 0.4 : 1);

      if (!finale) {
        if (edge > 0.6 && outward > 0.15) {
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
      if (speed > 1.1) {
        const last = this.trailStamp.get(player.id) || 0;
        if (frameNow - last > 60) {
          this.trailStamp.set(player.id, frameNow);
          const spur = this.trails[this.trailCursor];
          this.trailCursor = (this.trailCursor + 1) % this.trails.length;
          spur.mesh.position.set(bloom.position.x, DECK_Y + 0.012, bloom.position.z);
          spur.mesh.material.color.set(player.color);
          spur.mesh.scale.setScalar(0.8 + Math.min(1, speed / 4) * 0.6);
          spur.mesh.visible = true;
          spur.age = 0;
        }
      }
    });

    this.pulse *= frameDecay(0.85, dt);
    this.rim.material.emissiveIntensity = 0.35 + Math.sin(now / 190) * 0.15 + danger * 0.9 + this.pulse;
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
    // Im Wasser: im eigenen Ring nach vorn paddeln, dann zur Scheibe schauen.
    let diff = s.float.home - s.float.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const paddling = Math.abs(diff) > 0.04;
    s.float.angle += Math.sign(diff) * Math.min(Math.abs(diff), dt * 0.55);
    s.float.x = Math.cos(s.float.angle) * FLOAT_R;
    s.float.z = Math.sin(s.float.angle) * FLOAT_R;
    const bob = Math.sin(now / 520 + s.float.phase) * 0.05;
    bloom.position.set(s.float.x, WATER_Y - 0.2 + bob, s.float.z);
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

  keepInView(f) {
    return f.players.filter((player) => this.state.get(player.id)?.inPlay).map((player) => this.kins.get(player.id)).filter(Boolean);
  }

  // Die Kamera rückt näher, wenn das Gedränge eng wird, und zeigt die ganze
  // Scheibe, wenn sich alle verteilen.
  rigOptions() {
    const inPlay = [...this.state.entries()].filter(([, s]) => s.inPlay).map(([id]) => this.blooms.get(id)).filter(Boolean);
    if (!inPlay.length) return {};
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    inPlay.forEach((bloom) => {
      minX = Math.min(minX, bloom.position.x);
      maxX = Math.max(maxX, bloom.position.x);
      minZ = Math.min(minZ, bloom.position.z);
      maxZ = Math.max(maxZ, bloom.position.z);
    });
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const w = Math.min(PLATE_R * 2 + 0.5, Math.max(4.6, maxX - minX + 3));
    const h = Math.min(4.4, Math.max(3.2, (maxZ - minZ) * 0.7 + 2.2));
    const finale = Boolean((this.update || this.minigame)?.finaleAt);
    return { look: [cx * 0.75, 0.25, cz * 0.75 + 0.2], frame: { w, h }, pitch: finale ? 0.42 : undefined };
  }

  drawHud(f) {
    const entry = f.minigame.arena?.players?.[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    if (this.scoreNode) this.scoreNode.textContent = String(Math.round(entry?.score || 0));
  }
}
