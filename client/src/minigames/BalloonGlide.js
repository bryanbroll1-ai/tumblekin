import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Ballonfahrt — Zielabwurf über einer Patchwork-Landschaft. Halten heizt den
// Brenner (steigen), loslassen lässt sinken, der Knopf wirft einen Sandsack.
// Der Sack fliegt mit dem Ballon weiter, während er fällt: je höher, desto
// früher loslassen. Auf den Feldern liegen Zielscheiben, in der Luft hängen
// Sterne. Unter dem eigenen Ballon zeigt ein Schatten ungefähr, wo ein Sack
// jetzt landen würde — je tiefer man fliegt, desto schärfer.
//
// Vorher flog man durch Tore vor einer leeren Wand. Jetzt zieht eine
// Landschaft vorbei, und jeder Wurf endet mit einem Rums im Feld.
const SPEED = 2.2;                 // wie GLIDE_SPEED
const HEIGHT = 6;                  // wie GLIDE_HEIGHT
const BASKET = 0.4;                // wie GLIDE_BASKET
const FALL_G = 9;                  // wie GLIDE_FALL_G
const ROW_Z = [1.1, -0.2, -1.5, -2.8];
const COURSE_LEN = 90;

function fallMs(y) {
  const h = Math.max(0.05, y * HEIGHT + BASKET);
  return Math.sqrt((2 * h) / FALL_G) * 1000;
}

function groundX(ms) {
  return (SPEED * ms) / 1000;
}

function buildBalloon(color) {
  const group = new THREE.Group();
  const points = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = i / 24;
    const y = t * 2.3;
    let x;
    if (y < 0.55) x = 0.26 + (y / 0.55) * 0.42;
    else {
      const dy = y - 1.45;
      const r2 = 0.85 * 0.85 - dy * dy;
      x = r2 > 0 ? Math.sqrt(r2) + 0.18 : 0.18;
    }
    points.push(new THREE.Vector2(x, y));
  }
  const base = new THREE.Color(color);
  const light = base.clone().lerp(new THREE.Color("#ffffff"), 0.55);
  const segments = 12;
  for (let i = 0; i < segments; i += 1) {
    const gore = new THREE.Mesh(
      new THREE.LatheGeometry(points, 2, (i / segments) * Math.PI * 2, (Math.PI * 2) / segments + 0.001),
      new THREE.MeshLambertMaterial({ color: i % 2 ? light : base, side: THREE.DoubleSide })
    );
    gore.position.y = 0.95;
    gore.castShadow = true;
    group.add(gore);
  }
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.62), new THREE.MeshLambertMaterial({ color: "#9b6a3a" }));
  basket.position.y = 0.17;
  basket.castShadow = true;
  group.add(basket);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.06, 0.68), new THREE.MeshLambertMaterial({ color: "#6b4424" }));
  rim.position.y = 0.35;
  group.add(rim);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.65, 0.02), new THREE.MeshLambertMaterial({ color: "#5a4a3a" }));
    rope.position.set(sx * 0.28, 0.66, sz * 0.28);
    rope.rotation.z = -sx * 0.18;
    rope.rotation.x = sz * 0.18;
    group.add(rope);
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 6), new THREE.MeshBasicMaterial({ color: "#ffb13b", transparent: true, opacity: 0.9 }));
  flame.position.y = 1.1;
  group.add(flame);
  group.userData.flame = flame;
  return group;
}

function buildTarget() {
  const target = new THREE.Group();
  [[1.4, "#ffffff"], [1.12, "#ff4668"], [0.8, "#ffffff"], [0.56, "#ff4668"], [0.35, "#ffd15c"]].forEach(([r, color], i) => {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshLambertMaterial({ color }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02 + i * 0.004;
    ring.receiveShadow = true;
    target.add(ring);
  });
  return target;
}

const STAR_POP_MS = 110;       // Stern springt beim Einsammeln auf …
const STAR_FLY_MS = 280;       // … und fliegt dann in den Korb

function buildStar() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? 0.14 : 0.32;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const star = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false }),
    new THREE.MeshLambertMaterial({ color: "#ffd84a", emissive: "#ffb300", emissiveIntensity: 0.7 })
  );
  return star;
}

export class BalloonGlide extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.balloons = new Map();
    this.bagMeshes = new Map();
    this.stars = [];
    this.holding = false;
    this.labelY = 0.8;
    this.finaleFocus = false;
    this.lastStars = new Map();
    this.lastBagsSeen = new Map();
  }

  stage() {
    return {
      label: "3D Ballonfahrt",
      background: "#8fd3f5",
      fog: ["#b8e4f7", 22, 60],
      lights: { sunPosition: [-6, 14, 9], sunIntensity: 3.0, shadow: { left: -10, right: 10, top: 10, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-glide-bags></div>
      <div class="color-banner" data-glide-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame?.arcade;

    // Felder in Streifen: Weizen, Wiese, Acker, Raps — quer zur Fahrtrichtung.
    const fieldColors = ["#e8c75a", "#7cc860", "#a8d76a", "#b07a4a", "#f2dc4a", "#6db85a"];
    for (let x = -12, i = 0; x < COURSE_LEN + 12; i += 1) {
      const width = 3 + ((i * 37) % 5) * 0.8;
      const field = new THREE.Mesh(new THREE.BoxGeometry(width, 0.3, 40), new THREE.MeshLambertMaterial({ color: fieldColors[i % fieldColors.length] }));
      field.position.set(x + width / 2, -0.15, -6);
      field.receiveShadow = true;
      scene.add(field);
      // Furchen, damit man die Fahrt am Boden sieht.
      for (let r = 0; r < 3; r += 1) {
        const furrow = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 40), new THREE.MeshLambertMaterial({ color: new THREE.Color(fieldColors[i % fieldColors.length]).multiplyScalar(0.85) }));
        furrow.position.set(x + (r + 1) * (width / 4), 0.01, -6);
        scene.add(furrow);
      }
      x += width;
    }
    // Hinten Hügel, Höfe, Windmühlen und Bäume.
    this.mills = [];
    for (let i = 0; i < 16; i += 1) {
      const x = -8 + i * 6.5;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(4 + (i % 3), 10, 6), new THREE.MeshLambertMaterial({ color: i % 2 ? "#79c267" : "#8ccf73" }));
      hill.scale.set(1.6, 0.55, 1);
      hill.position.set(x, -0.6, -12 - (i % 3) * 2);
      scene.add(hill);
      if (i % 3 === 0) {
        const house = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.9), new THREE.MeshLambertMaterial({ color: "#fff3df" }));
        body.position.y = 0.4;
        house.add(body);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.6, 4), new THREE.MeshLambertMaterial({ color: "#d9534f" }));
        roof.position.y = 1.1;
        roof.rotation.y = Math.PI / 4;
        house.add(roof);
        house.position.set(x + 2, 0, -6.5);
        scene.add(house);
      }
      if (i % 3 === 1) {
        const mill = new THREE.Group();
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.6, 8), new THREE.MeshLambertMaterial({ color: "#f5ecd8" }));
        tower.position.y = 1.3;
        mill.add(tower);
        const hub = new THREE.Group();
        hub.position.set(0, 2.5, 0.45);
        for (let b = 0; b < 4; b += 1) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.3, 0.04), new THREE.MeshLambertMaterial({ color: "#b98a57" }));
          blade.position.y = 0.65;
          const arm = new THREE.Group();
          arm.rotation.z = (b / 4) * Math.PI * 2;
          arm.add(blade);
          hub.add(arm);
        }
        mill.add(hub);
        mill.position.set(x + 1, 0, -7.5);
        scene.add(mill);
        this.mills.push(hub);
      }
      if (i % 2 === 0) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), new THREE.MeshLambertMaterial({ color: "#7a5330" }));
        trunk.position.y = 0.35;
        tree.add(trunk);
        const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), new THREE.MeshLambertMaterial({ color: "#3f9b52" }));
        crown.position.y = 0.95;
        tree.add(crown);
        tree.position.set(x - 1.5, 0, -5.5 - (i % 4) * 0.4);
        scene.add(tree);
      }
    }
    this.clouds = [];
    for (let i = 0; i < 10; i += 1) {
      const cloud = createCloud(i + 3);
      cloud.position.set(-6 + i * 10, 7.5 + (i % 3) * 1.2, -8 - (i % 2) * 4);
      cloud.scale.setScalar(1.2);
      scene.add(cloud);
      this.clouds.push(cloud);
    }

    // Zielscheiben in jeder Reihe an derselben Stelle.
    this.targetMeshes = [];
    const players = this.getState()?.players || [];
    const own = this.getControlledPlayerId();
    const ownIndex = Math.max(0, players.findIndex((player) => player.id === own));
    this.rowOf = new Map();
    players.forEach((player, index) => {
      const row = index === ownIndex ? 0 : index < ownIndex ? index + 1 : index;
      this.rowOf.set(player.id, row);
    });
    (arcade?.targets || []).forEach((target) => {
      players.forEach((player) => {
        const mesh = buildTarget();
        mesh.position.set(target.x, 0, ROW_Z[this.rowOf.get(player.id) || 0]);
        if (player.id !== own) mesh.scale.setScalar(0.8);
        scene.add(mesh);
        this.targetMeshes.push({ mesh, target, playerId: player.id });
      });
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), new THREE.MeshLambertMaterial({ color: "#ff4668" }));
      flag.position.set(target.x + 0.2, 1.7, ROW_Z[0] - 1.6);
      scene.add(flag);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.05), new THREE.MeshLambertMaterial({ color: "#ffffff" }));
      pole.position.set(target.x - 0.05, 0.95, ROW_Z[0] - 1.6);
      scene.add(pole);
    });

    // Sterne in der eigenen Reihe.
    (arcade?.stars || []).forEach((star) => {
      const mesh = buildStar();
      mesh.position.set(groundX(star.at), star.y * HEIGHT + BASKET + 0.35, ROW_Z[0]);
      scene.add(mesh);
      this.stars.push({ mesh, star, taken: false });
    });

    // Die Ballons mit den Figuren im Korb.
    players.forEach((player, index) => {
      const row = this.rowOf.get(player.id) || 0;
      const balloon = buildBalloon(player.color);
      balloon.position.set(0, BASKET + (arcade?.players?.[player.id]?.y ?? 0.45) * HEIGHT, ROW_Z[row]);
      if (player.id !== own) {
        // Die anderen fliegen als halb durchsichtige Schatten mit: alle vier
        // hängen an derselben Stelle der Strecke, und der eigene Ballon ging
        // hinter den fremden verloren.
        balloon.scale.setScalar(0.85);
        balloon.traverse((part) => {
          if (!part.material) return;
          part.material = part.material.clone();
          part.material.transparent = true;
          part.material.opacity = Math.min(part.material.opacity ?? 1, 0.42);
          part.material.depthWrite = false;
        });
      }
      scene.add(balloon);
      const kin = this.addKin(player, index, { x: 0, ground: 0, z: ROW_Z[row], facing: 0.4, scale: player.id === own ? 0.75 : 0.65 });
      if (player.id !== own) this.fade(player.id, 0.5);
      this.shadows.get(player.id).userData.manual = true;
      this.shadows.get(player.id).visible = false;
      this.balloons.set(player.id, { balloon, kin, row });
    });

    // Der Landeschatten unter dem eigenen Ballon.
    this.aim = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: "#1b2530", transparent: true, opacity: 0.28, depthWrite: false })
    );
    this.aim.rotation.x = -Math.PI / 2;
    this.aim.position.set(0, 0.06, ROW_Z[0]);
    scene.add(this.aim);
  }

  shot() {
    return {
      look: [2, 3.2, 0],
      frame: { w: 7.4, h: 7.6 },
      pitch: 0.1,
      yaw: 0,
      fov: 40,
      ease: 0.2,
      intro: { yaw: 0.4, pitch: 0.2, zoom: 1.3 },
      finale: false
    };
  }

  rigOptions(f) {
    const x = groundX(Math.max(0, f.now - f.minigame.startedAt));
    return { look: [x + 2, 3.2, 0] };
  }

  keepInView() {
    return [];
  }

  bind() {
    this.controls.innerHTML = `
      <p class="trace-hint glide-hint">Halten = Brenner · Knopf = Sandsack</p>
      <button type="button" class="nerve-button glide-drop" data-glide-drop>
        <span class="nerve-button-face">ABWURF</span>
      </button>`;
    this.dropButton = this.controls.querySelector("[data-glide-drop]");
    this.on(this.dropButton, "pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.pressDrop();
    });
    const down = (event) => {
      event.preventDefault();
      this.setHolding(true);
    };
    const up = () => this.setHolding(false);
    this.on(this.webglCanvas, "pointerdown", down);
    this.on(window, "pointerup", up);
    this.on(window, "pointercancel", up);
  }

  unbind() {
    this.setHolding(false);
  }

  setHolding(value) {
    if (this.holding === value) return;
    this.holding = value;
    this.sendInput({ action: "lift", down: value }).catch(() => {});
  }

  pressDrop() {
    const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.bagsLeft <= 0) {
      this.feedback?.sound("clack");
      return;
    }
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(10);
    this.animators.get(this.getControlledPlayerId())?.trigger("throw");
    this.sendInput({ action: "drop" }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, minigame, players, controlledId, finale } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const x = groundX(elapsed);
    this.mills.forEach((hub, i) => { hub.rotation.z += dt * (0.8 + i * 0.1); });

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const item = this.balloons.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !item || !animator) return;
      const { balloon, kin, row } = item;
      const mine = player.id === controlledId;
      const y = BASKET + entry.y * HEIGHT;
      balloon.position.x = x;
      balloon.position.y += (y - balloon.position.y) * frameLerp(0.35, dt);
      balloon.rotation.z = -Math.max(-0.12, Math.min(0.12, (entry.vy || 0) * 0.25));
      kin.position.set(x + 0.02, balloon.position.y + 0.3, ROW_Z[row] + 0.05);
      animator.groundY = balloon.position.y + 0.3 + 0.3 * (mine ? 0.75 : 0.65) - 0.05;
      const burning = mine ? this.holding : entry.holding;
      const flame = balloon.userData.flame;
      flame.visible = Boolean(burning) && !entry.stalled;
      flame.scale.setScalar(1 + Math.sin(now / 40) * 0.2);
      if (flame.visible && Math.random() < frameChance(4, dt)) {
        this.burst(new THREE.Vector3(x, balloon.position.y + 1.25, ROW_Z[row]), ["#ffb13b", "#ffe36b"], { count: 1, speed: 0.3, up: 1.1, size: 0.06, life: 0.3, gravity: -2 });
      }

      // Neue Säcke: fallen im Bogen mit.
      (entry.bags || []).forEach((bag) => {
        const key = `${player.id}:${bag.id}`;
        let mesh = this.bagMeshes.get(key);
        if (!mesh && elapsed < bag.landAt + 1200) {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.2), new THREE.MeshLambertMaterial({ color: "#c9a26f" }));
          mesh.castShadow = true;
          this.scene.add(mesh);
          this.bagMeshes.set(key, mesh);
          if (!mine) animator.trigger("throw");
        }
        if (!mesh) return;
        const t = Math.max(0, Math.min(elapsed, bag.landAt) - bag.at) / 1000;
        const h0 = bag.fromY * HEIGHT + BASKET;
        mesh.position.set(groundX(bag.at) + SPEED * t, Math.max(0.13, h0 - 0.5 * FALL_G * t * t), ROW_Z[row]);
        mesh.rotation.z = -t * 3;
        if (elapsed >= bag.landAt && !mesh.userData.landed && bag.points !== null && bag.points !== undefined) {
          mesh.userData.landed = true;
          const at = mesh.position.clone().setY(0.1);
          this.burst(at, ["#c9a26f", "#8a5a34", "#ffffff"], { count: 10, speed: 1.6, up: 1.4, size: 0.08, life: 0.5 });
          if (bag.points > 0) {
            this.bursts.ring(at, bag.points >= 100 ? "#ffd15c" : "#ffffff", { radius: 1.8, life: 0.6, y: 0.1 });
            const text = bag.points >= 100 ? "VOLLTREFFER! +100" : `+${bag.points}`;
            if (mine || bag.points >= 100) this.pop(at.clone().add(new THREE.Vector3(0, 1.2, 0.5)), text, { color: bag.points >= 100 ? "#ffe36b" : "#ffffff", size: bag.points >= 100 ? 0.5 : 0.4, life: 1.2 });
            if (bag.points >= 100) this.burst(at.clone().add(new THREE.Vector3(0, 0.5, 0)), ["#ffd15c", "#ff4668", "#ffffff", player.color], { count: 26, speed: 3, up: 3, size: 0.09, life: 1 });
            if (mine) {
              this.feedback?.sound(bag.points >= 100 ? "perfect" : "coin");
              this.feedback?.vibrate(bag.points >= 100 ? [12, 20, 30] : 12);
              animator.trigger(bag.points >= 100 ? "celebrate" : "fistpump");
            }
          } else if (mine) {
            this.pop(at.clone().add(new THREE.Vector3(0, 1, 0.5)), "daneben", { color: "#ffffff", size: 0.32, life: 0.8 });
            this.feedback?.sound("clack");
          }
        }
        if (elapsed > bag.landAt + 1200) {
          this.scene.remove(mesh);
          this.bagMeshes.delete(key);
        }
      });

      // Eingesammelte Sterne.
      if ((entry.starsCaught || 0) > (this.lastStars.get(player.id) || 0)) {
        this.lastStars.set(player.id, entry.starsCaught);
        if (mine) {
          const star = this.stars.find((candidate) => candidate.star.index === entry.lastStar?.index);
          if (star && !star.taken) {
            // Einsammeln in zwei Takten: der Stern springt kurz auf und
            // blitzt (Ring, Funken, Ton), dann fliegt er in den eigenen Korb
            // und klingelt dort. Vorher schrumpfte er nur an Ort und Stelle.
            star.taken = true;
            star.takenAt = now;
            star.from = star.mesh.position.clone();
            star.kin = kin;
            const at = star.mesh.position.clone();
            this.burst(at, ["#ffd84a", "#ffffff", "#fff3b0"], { count: 16, speed: 2.4, up: 1.2, size: 0.07, life: 0.55, drag: 2.2, fadePow: 1.5 });
            this.bursts.ring(at, "#ffe36b", { radius: 1.1, life: 0.35, opacity: 0.8, tilt: null, y: at.y });
            this.pop(at.clone().add(new THREE.Vector3(0, 0.55, 0.5)), "+15 ⭐", { color: "#ffe36b", size: 0.4, life: 0.9, rise: 0.7 });
            this.feedback?.sound("sparkle");
            this.feedback?.vibrate(10);
          }
        }
      }

      if (finale) return;
      animator.lookAt(mine ? new THREE.Vector3(x + 3, 0, ROW_Z[row]) : null);
      animator.set(burning ? "focus" : "ready");
    });

    // Sterne drehen sich, genommene verschwinden, verpasste verblassen.
    this.stars.forEach((star) => {
      if (star.taken && star.takenAt) {
        const age = now - star.takenAt;
        if (age < STAR_POP_MS) {
          // Aufspringen: grösser werden und schnell drehen.
          const u = age / STAR_POP_MS;
          star.mesh.scale.setScalar(1 + Math.sin(u * Math.PI * 0.5) * 0.7);
          star.mesh.rotation.y += dt * 22;
        } else if (age < STAR_POP_MS + STAR_FLY_MS && star.kin) {
          // In den Korb: beschleunigt hin, dabei kleiner werden.
          const u = (age - STAR_POP_MS) / STAR_FLY_MS;
          const target = star.kin.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0.1));
          star.mesh.position.lerpVectors(star.from, target, u * u);
          star.mesh.position.y += Math.sin(u * Math.PI) * 0.35;
          star.mesh.scale.setScalar(1.7 * (1 - u) + 0.15);
          star.mesh.rotation.y += dt * 16;
        } else if (star.mesh.visible) {
          star.mesh.visible = false;
          if (star.kin) {
            this.burst(star.kin.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.35, 0.1)), ["#ffd84a", "#ffffff"], { count: 8, speed: 1.3, up: 1.1, size: 0.06, life: 0.4, drag: 2.4 });
            this.feedback?.sound("coin");
          }
        }
        return;
      }
      star.mesh.rotation.y = now / 400 + star.star.index;
      if (star.taken) star.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 6));
      else if (star.star.at < elapsed - 200) star.mesh.visible = false;
    });

    // Landeschatten: wo ein Sack jetzt ungefähr landen würde. Je höher, desto
    // grösser und blasser.
    const own = arcade.players[controlledId];
    if (own && this.aim) {
      const land = x + SPEED * (fallMs(own.y) / 1000);
      this.aim.position.x = land;
      const r = 0.35 + own.y * 1.3;
      this.aim.scale.setScalar(r);
      this.aim.material.opacity = 0.34 - own.y * 0.16;
      this.aim.visible = !finale && own.bagsLeft > 0;
    }
    this.clouds.forEach((cloud, i) => { cloud.position.x -= dt * (0.1 + (i % 3) * 0.05); });
  }

  drawHud(f) {
    const { arcade } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.round(own?.score || 0));
    const bags = this.hud.querySelector("[data-glide-bags]");
    if (bags && own) bags.textContent = `Säcke ${own.bagsLeft} · Treffer ${own.hits || 0}`;
    const banner = this.hud.querySelector("[data-glide-banner]");
    if (banner) {
      if (own?.stalled) {
        banner.hidden = false;
        banner.textContent = own.y <= 0.01 ? "Aufgesetzt!" : "Zu hoch!";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.dropButton) this.dropButton.disabled = !own || own.bagsLeft <= 0;
  }
}
