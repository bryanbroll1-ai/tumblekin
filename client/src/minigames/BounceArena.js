import * as THREE from "/vendor/three/three.module.js";
import { createCloud, noise } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameDecay, frameLerp } from "./Quality.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";

// Bumper Bloom: jede Figur fährt in einem Blütenring über eine Bonbon-Scheibe
// und rempelt die anderen ins Wasser.
//
// Vorher rollten hier Kugeln mit zwei Augen — das einzige Spiel ohne echte
// Figuren. Jetzt steht die Figur in ihrem Ring, lehnt sich in die Fahrt,
// zuckt beim Zusammenstoss, schaut ängstlich, wenn es am Rand eng wird, und
// wer hinausfliegt, überschlägt sich, landet im Wasser und treibt dort im
// eigenen Ring weiter mit.
//
// Die Masse folgen der Physik des Servers: Scheibe 1.0, Figur 0.11 — hier
// mal SCALE. Die Blüte ist etwas grösser als der Stossradius, damit die Ringe
// sich beim Aufprall sichtbar eindrücken statt kurz vorher abzuprallen.
const SCALE = 2.6;
const PLATE_R = 2.72;
const DECK_Y = 0.3;
const BLOOM_R = 0.11 * SCALE * 1.12;
const WATER_Y = -1.35;
const FLOAT_R = 3.75;
const FLY_MS = 900;

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
      label: "3D Bumper Bloom",
      background: "#9fdcf2",
      fog: ["#aee2f5", 14, 34],
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

    this.water = new THREE.Mesh(new THREE.BoxGeometry(60, 0.5, 60), new THREE.MeshLambertMaterial({ color: "#3cb0cf" }));
    this.water.position.y = WATER_Y - 0.25;
    this.water.receiveShadow = true;
    scene.add(this.water);

    // Stiel und Kelch der Blume, die die Scheibe trägt.
    // Oberkante deutlich unter der Scheibe: bündig flackerte sie hindurch.
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, 1.4, 8), new THREE.MeshLambertMaterial({ color: "#5fbf6f" }));
    stem.position.y = WATER_Y + 0.55;
    scene.add(stem);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2 + 0.2;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.7), new THREE.MeshLambertMaterial({ color: i % 2 ? "#4fae62" : "#6ccb78" }));
      leaf.position.set(Math.cos(angle) * 2.2, WATER_Y + 0.05, Math.sin(angle) * 2.2);
      leaf.rotation.y = -angle;
      leaf.rotation.z = 0.12;
      scene.add(leaf);
    }

    const base = new THREE.Mesh(new THREE.CylinderGeometry(PLATE_R + 0.12, PLATE_R - 0.35, 0.5, 16), new THREE.MeshLambertMaterial({ color: "#c487a3" }));
    base.position.y = DECK_Y - 0.3;
    base.castShadow = true;
    base.receiveShadow = true;
    scene.add(base);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(PLATE_R, PLATE_R, 0.08, 32), new THREE.MeshLambertMaterial({ color: "#a58ddd" }));
    cap.position.y = DECK_Y - 0.04;
    cap.receiveShadow = true;
    scene.add(cap);
    // Weiche Ringe als Orientierung: Mitte sicher, aussen wird es eng.
    [0.35, 0.68].forEach((r, index) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(PLATE_R * r - 0.035, PLATE_R * r + 0.035, 40),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: index ? 0.5 : 0.65, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = DECK_Y + 0.004;
      scene.add(ring);
    });
    // Warnstreifen am Rand; er glüht, wenn jemand nah dran ist.
    this.rim = new THREE.Mesh(
      new THREE.TorusGeometry(PLATE_R - 0.02, 0.07, 6, 40),
      new THREE.MeshLambertMaterial({ color: "#ff4668", emissive: "#ff4668", emissiveIntensity: 0.6 })
    );
    this.rim.rotation.x = Math.PI / 2;
    this.rim.position.y = DECK_Y + 0.02;
    scene.add(this.rim);
    // Blütenblätter unter dem Rand.
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.62), new THREE.MeshLambertMaterial({ color: i % 2 ? "#ff9cc0" : "#ffb8d2" }));
      petal.position.set(Math.cos(angle) * (PLATE_R + 0.2), DECK_Y - 0.42, Math.sin(angle) * (PLATE_R + 0.2));
      petal.rotation.y = -angle;
      petal.rotation.z = -0.25;
      scene.add(petal);
    }

    this.drifters = [];
    [[-5.2, 1.4, -3.4, 1], [5.4, 2.1, -2.2, 2], [-4.8, 2.6, 2.4, 3], [4.6, 1.1, 3.2, 4]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      cloud.userData = { baseY: y, phase: seed * 1.7, drift: 0.1 + noise(seed) * 0.1 };
      scene.add(cloud);
      this.drifters.push(cloud);
    });

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

  // Der Blütenring: ein Schlauch in der Spielerfarbe, Blätter aussen herum,
  // ein dunkler Boden. Die Figur steht darin.
  addBloom(player) {
    const bloom = new THREE.Group();
    const color = new THREE.Color(player.color);
    const light = color.clone().lerp(new THREE.Color("#ffffff"), 0.45);
    const tube = new THREE.Mesh(new THREE.TorusGeometry(BLOOM_R - 0.07, 0.085, 6, 16), new THREE.MeshLambertMaterial({ color }));
    tube.rotation.x = Math.PI / 2;
    tube.position.y = 0.13;
    tube.castShadow = true;
    bloom.add(tube);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(BLOOM_R - 0.06, BLOOM_R - 0.02, 0.07, 14), new THREE.MeshLambertMaterial({ color: "#4a3d55" }));
    floor.position.y = 0.04;
    bloom.add(floor);
    const petalMat = new THREE.MeshLambertMaterial({ color: light });
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const petal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.12), petalMat);
      petal.position.set(Math.cos(angle) * (BLOOM_R + 0.02), 0.07, Math.sin(angle) * (BLOOM_R + 0.02));
      petal.rotation.y = -angle;
      bloom.add(petal);
    }
    bloom.position.y = DECK_Y;
    this.scene.add(bloom);
    this.blooms.set(player.id, bloom);
    const shadow = this.shadows.get(player.id);
    if (shadow) {
      shadow.userData.manual = true;
      shadow.scale.setScalar(1.25);
    }
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
      label: "Bumper Bloom lenken und rammen",
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
    this.rim.material.emissiveIntensity = 0.5 + Math.sin(now / 190) * 0.2 + danger * 0.9 + this.pulse;
    this.drifters.forEach((drifter) => {
      const data = drifter.userData;
      drifter.position.y = data.baseY + Math.sin(now / 1400 + data.phase) * data.drift;
    });
    this.water.position.y = WATER_Y - 0.25 + Math.sin(now / 900) * 0.03;
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
    bloom.position.set(s.float.x, WATER_Y - 0.08 + bob, s.float.z);
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
    const w = Math.min(PLATE_R * 2 + 0.5, Math.max(4.1, maxX - minX + 3));
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
