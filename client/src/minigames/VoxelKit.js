import * as THREE from "/vendor/three/three.module.js";
import { fxScale } from "./Quality.js?v=tumblekin119";

// Shared voxel building blocks for the 3D minigame dioramas.

// Der Nullpunkt einer Figur liegt in ihrer KÖRPERMITTE, nicht unter den Füssen:
// der Rumpf sitzt auf y=0, die Fusssohle rund 0.3 darunter. Wer eine Figur auf
// einen Boden stellt, muss diesen Betrag dazurechnen — sonst steckt sie bis zu
// den Knöcheln darin.
//
// Genau das war in einem Dutzend Szenen der Fall, weil "kin.position.y = Boden"
// wie die offensichtlich richtige Zeile aussieht. Es ist die falsche. Richtig
// ist standOn(bodenHöhe), und dieselbe Zahl gehört an animator.groundY.
export const KIN_SOLE = 0.3;
export function standOn(groundY) {
  return groundY + KIN_SOLE;
}

export function createVoxelKin(color, variant = 0) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const accent = new THREE.MeshLambertMaterial({ color, transparent: true });
  const accentLight = new THREE.MeshLambertMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.35),
    transparent: true
  });
  const dark = new THREE.MeshLambertMaterial({ color: "#18231e", transparent: true });
  const gold = new THREE.MeshLambertMaterial({ color: "#ffe36b", emissive: "#9d7420", emissiveIntensity: 0.12, transparent: true });
  const materials = [accent, accentLight, dark, gold];

  const blob = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.38), accent);
  blob.castShadow = true;
  body.add(blob);

  // Facial features are DEEP boxes centred right at the blob's front face
  // (z=0.19): their front stays clearly proud (~0.025) while their back is
  // buried well inside the solid head (~0.025). No near-coplanar faces means no
  // z-fighting even when a kin is small/far (e.g. mid-flight in Kanonenflug),
  // which was making the mouth flicker "through" the head.
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.05), accentLight);
  belly.position.set(0, -0.08, 0.19);
  body.add(belly);

  const eyes = [];
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.05), dark);
    eye.position.set(side * 0.095, 0.07, 0.19);
    body.add(eye);
    eyes.push(eye);
  });
  [-1, 1].forEach((side) => {
    const cheek = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.035, 0.045),
      new THREE.MeshLambertMaterial({ color: "#f9826b", transparent: true, opacity: 0.8 })
    );
    cheek.position.set(side * 0.15, -0.02, 0.19);
    body.add(cheek);
    materials.push(cheek.material);
  });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.028, 0.05), dark);
  mouth.position.set(0, -0.05, 0.19);
  body.add(mouth);

  const arms = [];
  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1), accent);
    arm.position.set(side * 0.25, -0.04, 0);
    arm.rotation.z = side * -0.35;
    arm.userData = { side, baseRotZ: side * -0.35, baseY: -0.04 };
    body.add(arm);
    arms.push(arm);
  });

  const feet = [];
  [-1, 1].forEach((side) => {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.18), dark);
    foot.position.set(side * 0.11, -0.26, 0.04);
    body.add(foot);
    feet.push(foot);
  });

  const style = variant % 4;
  if (style === 0) {
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), gold);
    peak.position.set(-0.03, 0.31, 0);
    peak.rotation.set(0.5, 0.5, 0.3);
    body.add(peak);
  } else if (style === 1) {
    const halo = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.24), gold);
    halo.position.y = 0.35;
    halo.rotation.y = Math.PI / 4;
    body.add(halo);
  } else if (style === 2) {
    [-1, 1].forEach((side) => {
      const nub = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), gold);
      nub.position.set(side * 0.12, 0.29, 0);
      nub.rotation.z = side * 0.4;
      body.add(nub);
    });
  } else {
    [-1, 0, 1].forEach((position, index) => {
      const point = new THREE.Mesh(new THREE.BoxGeometry(0.08, index === 1 ? 0.16 : 0.11, 0.08), gold);
      point.position.set(position * 0.11, 0.3, 0);
      body.add(point);
    });
  }

  group.add(body);
  // isKin gehört IN dieses Objekt, nicht davor: die Zuweisung ersetzt userData
  // komplett und hat eine früher gesetzte Markierung stillschweigend
  // weggeräumt. Der Prüfer fand daraufhin in allen 30 Szenen "keine Figuren"
  // und meldete fröhlich null Fehler.
  //
  // Genutzt von scripts/ground-check.mjs, das misst, ob eine Figur im Boden
  // steckt oder darüber schwebt.
  group.userData = { isKin: true, body, blob, eyes, feet, arms, materials, phase: Math.random() * Math.PI * 2 };
  return group;
}

// Procedural animation state machine for voxel kins.
// States: idle, run, jump, stumble, cheer, sad, hit, fall.
// Transient states (jump, stumble, hit, fall) return to the base state on their own.
export class KinAnimator {
  constructor(kin) {
    this.kin = kin;
    this.state = "idle";
    this.baseState = "idle";
    // stateStart is stamped lazily with the SAME clock update() receives —
    // callers pass network-synced time, so performance.now() here would make
    // every one-shot state (hit/stumble/jump/fall) finish instantly.
    this.stateStart = null;
    this.groundY = kin.position.y;
  }

  set(state, { base = false } = {}) {
    if (base || state === "idle" || state === "run" || state === "sad" || state === "cheer") {
      this.baseState = state;
    }
    if (this.state === state) return;
    this.state = state;
    this.stateStart = null;
  }

  trigger(state) {
    this.state = state;
    this.stateStart = null;
  }

  update(now = performance.now()) {
    if (this.stateStart === null) this.stateStart = now;
    const t = (now - this.stateStart) / 1000;
    const d = this.kin.userData;
    const phase = d.phase;

    // Baseline pose — states modify from here.
    d.body.rotation.set(0, 0, 0);
    d.body.position.y = 0;
    d.body.scale.set(1, 1, 1);
    this.kin.position.y = this.groundY;
    d.feet.forEach((foot) => { foot.rotation.x = 0; });
    d.arms.forEach((arm) => {
      arm.rotation.z = arm.userData.baseRotZ;
      arm.position.y = arm.userData.baseY;
    });
    const blink = Math.sin(now / 830 + phase * 2.1) > 0.985 ? 0.14 : 1;
    d.eyes.forEach((eye) => { eye.scale.y = blink; });

    switch (this.state) {
      case "run": {
        // Bouncy, exaggerated sprint with head bob and body roll.
        const stride = Math.sin(now / 78 + phase);
        d.feet.forEach((foot, index) => { foot.rotation.x = stride * (index === 0 ? 1.05 : -1.05); });
        d.arms.forEach((arm, index) => { arm.rotation.z = arm.userData.baseRotZ + stride * (index === 0 ? -0.75 : 0.75); });
        d.body.rotation.x = 0.2;
        d.body.rotation.z = stride * 0.09;
        const bounce = Math.abs(Math.sin(now / 78 + phase));
        d.body.scale.set(1 - bounce * 0.05, 1 + bounce * 0.08, 1 - bounce * 0.05);
        this.kin.position.y = this.groundY + bounce * 0.09;
        break;
      }
      case "jump": {
        // Three-beat jump with anticipation and a landing squash so hops read
        // as a real spring rather than a floaty bob.
        const progress = Math.min(1, t / 0.72);
        if (progress < 0.14) {
          const crouch = progress / 0.14;
          d.body.scale.set(1 + crouch * 0.12, 1 - crouch * 0.16, 1 + crouch * 0.12);
          d.body.position.y = -crouch * 0.06;
          d.arms.forEach((arm) => { arm.rotation.z = arm.userData.baseRotZ * (1 - crouch * 1.8); });
          d.feet.forEach((foot) => { foot.rotation.x = -crouch * 0.3; });
        } else if (progress < 0.85) {
          const air = (progress - 0.14) / 0.71;
          const lift = Math.sin(air * Math.PI);
          this.kin.position.y = this.groundY + lift * 0.6;
          d.body.scale.set(1 - lift * 0.08, 1 + lift * 0.17, 1 - lift * 0.08);
          d.arms.forEach((arm) => { arm.rotation.z = arm.userData.baseRotZ * -2.4; });
          // Legs tuck at the apex, reach out again toward the ground.
          d.feet.forEach((foot) => { foot.rotation.x = 0.7 - Math.abs(air - 0.5) * 0.5; });
        } else {
          const land = (progress - 0.85) / 0.15;
          const squash = Math.sin(land * Math.PI);
          d.body.scale.set(1 + squash * 0.17, 1 - squash * 0.2, 1 + squash * 0.17);
          d.body.position.y = -squash * 0.05;
          d.arms.forEach((arm) => { arm.rotation.z = arm.userData.baseRotZ * (1 + squash * 0.6); });
        }
        if (progress >= 1) this.set(this.baseState);
        break;
      }
      case "stumble": {
        const progress = Math.min(1, t / 0.9);
        const wobble = Math.sin(progress * Math.PI * 3) * (1 - progress);
        d.body.rotation.x = 0.5 * (1 - progress) + wobble * 0.15;
        d.body.rotation.z = wobble * 0.3;
        d.arms.forEach((arm, index) => { arm.rotation.z = arm.userData.baseRotZ + wobble * (index === 0 ? 1.2 : -1.2); });
        this.kin.position.y = this.groundY - Math.sin(progress * Math.PI) * 0.05;
        if (progress >= 1) this.set(this.baseState);
        break;
      }
      case "cheer": {
        // Explosive celebration: big hops, arms thrown up, a happy wiggle-spin.
        const hop = Math.abs(Math.sin(now / 150 + phase));
        this.kin.position.y = this.groundY + hop * 0.34;
        d.body.scale.set(1 - hop * 0.08, 1 + hop * 0.16, 1 - hop * 0.08);
        d.arms.forEach((arm) => {
          arm.rotation.z = arm.userData.side * (2.6 + hop * 0.4);
          arm.position.y = arm.userData.baseY + 0.16 + hop * 0.06;
        });
        d.feet.forEach((foot, index) => { foot.rotation.x = hop * (index === 0 ? 0.5 : -0.5); });
        d.body.rotation.y = Math.sin(now / 150 + phase) * 0.4;
        d.body.rotation.z = Math.sin(now / 210 + phase) * 0.12;
        break;
      }
      case "sad": {
        d.body.rotation.x = 0.32;
        d.body.position.y = -0.05;
        d.body.scale.set(1.03, 0.94, 1.03);
        d.body.rotation.z = Math.sin(now / 900 + phase) * 0.04;
        d.arms.forEach((arm) => { arm.rotation.z = arm.userData.baseRotZ * 0.3; });
        d.eyes.forEach((eye) => { eye.scale.y = 0.55; });
        break;
      }
      case "hit": {
        const progress = Math.min(1, t / 0.5);
        const shock = (1 - progress);
        d.body.rotation.x = -0.4 * shock;
        d.body.scale.set(1 + shock * 0.18, 1 - shock * 0.14, 1 + shock * 0.18);
        d.eyes.forEach((eye) => { eye.scale.y = 1.6 * shock + blink * progress; });
        d.arms.forEach((arm, index) => { arm.rotation.z = arm.userData.baseRotZ + shock * (index === 0 ? 1.6 : -1.6); });
        if (progress >= 1) this.set(this.baseState);
        break;
      }
      case "fall": {
        // Fall over, lie flat for a moment, then get back up.
        const progress = Math.min(1, t / 1.6);
        let lie;
        if (progress < 0.25) lie = progress / 0.25;
        else if (progress < 0.72) lie = 1;
        else lie = 1 - (progress - 0.72) / 0.28;
        d.body.rotation.x = lie * (Math.PI / 2 - 0.12);
        d.body.position.y = -lie * 0.16;
        if (progress >= 0.72) {
          const up = (progress - 0.72) / 0.28;
          this.kin.position.y = this.groundY + Math.sin(up * Math.PI) * 0.1;
        }
        if (progress >= 1) this.set(this.baseState);
        break;
      }
      default: {
        // Lively idle: breathing, weight-shift sway, looking around, arm sway,
        // and an occasional little hop so nobody ever stands frozen.
        const breath = Math.sin(now / 430 + phase);
        d.body.scale.set(1 - breath * 0.02, 1 + breath * 0.04, 1 - breath * 0.02);
        d.body.rotation.z = Math.sin(now / 760 + phase) * 0.06;
        d.body.rotation.y = Math.sin(now / 1150 + phase) * 0.14;
        d.arms.forEach((arm, index) => {
          arm.rotation.z = arm.userData.baseRotZ + Math.sin(now / 610 + phase + index * 1.6) * 0.13;
        });
        let y = this.groundY + Math.sin(now / 430 + phase) * 0.02;
        const hopCycle = ((now / 1000) + phase) % 3.6;
        if (hopCycle < 0.34) {
          const h = Math.sin((hopCycle / 0.34) * Math.PI);
          y += h * 0.09;
          d.body.scale.y *= 1 + h * 0.07;
          d.feet.forEach((foot, index) => { foot.rotation.x = h * (index === 0 ? 0.4 : -0.4); });
        }
        this.kin.position.y = y;
      }
    }
  }
}

export function setKinOpacity(kin, opacity) {
  kin.userData.materials.forEach((material) => {
    material.opacity = opacity;
  });
}

export function createShadowBlob(size = 0.55) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, 0.015, size),
    new THREE.MeshBasicMaterial({ color: "#0a2430", transparent: true, opacity: 0.26, depthWrite: false })
  );
  mesh.renderOrder = 1;
  // Ein Schattenfleck ist ein Aufkleber, kein Boden. Ohne die Markierung hält
  // ihn der Bodenprüfer für die Fläche, auf der die Figur steht.
  mesh.userData.isShadow = true;
  return mesh;
}

export function createCloud(seed = 0) {
  const group = new THREE.Group();
  const cloudMaterial = new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.92 });
  const chunks = 2 + (seed % 2);
  for (let index = 0; index <= chunks; index += 1) {
    const size = 0.5 + noise(seed * 3 + index * 7) * 0.5;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.5, size * 0.8), cloudMaterial);
    chunk.position.set(index * 0.42 - chunks * 0.21, (index % 2) * 0.12, noise(seed + index) * 0.2);
    group.add(chunk);
  }
  return group;
}

// A downward-pointing "you" arrow that bobs above the controlled player's
// kin so you can always find yourself among the crowd. Attach it to a kin and
// call updateOwnMarker() each frame.
export function createOwnMarker(color = "#ffe25c") {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.26, 0.12),
    new THREE.MeshBasicMaterial({ color })
  );
  shaft.position.y = 0.2;
  group.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.26, 4),
    new THREE.MeshBasicMaterial({ color })
  );
  tip.rotation.x = Math.PI;
  tip.rotation.y = Math.PI / 4;
  group.add(tip);
  // A white outline cone just behind for contrast against any background.
  const outline = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.32, 4),
    new THREE.MeshBasicMaterial({ color: "#ffffff" })
  );
  outline.rotation.x = Math.PI;
  outline.rotation.y = Math.PI / 4;
  outline.position.z = -0.02;
  outline.scale.setScalar(1);
  group.add(outline);
  group.renderOrder = 999;
  group.userData = { phase: Math.random() * Math.PI * 2 };
  return group;
}

export function updateOwnMarker(marker, now, baseY) {
  if (!marker) return;
  marker.position.y = baseY + 0.9 + Math.sin(now / 260 + marker.userData.phase) * 0.1;
  marker.rotation.y = Math.sin(now / 500) * 0.3;
}

export function createNameLabel(text, accent) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 88;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(21, 33, 38, 0.88)";
  roundRect(ctx, 10, 12, 236, 64, 30);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 40px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 46);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.62, 0.21, 1);
  return sprite;
}

export function createCountdownSprite() {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  sprite.visible = false;
  return sprite;
}

export function updateCountdownSprite(sprite, text, accent) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  ctx.lineJoin = "round";
  ctx.font = "900 130px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 26;
  ctx.strokeStyle = "rgba(31, 90, 110, 0.55)";
  ctx.strokeText(text, 160, 104);
  ctx.fillStyle = accent;
  ctx.fillText(text, 160, 100);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  sprite.material.map?.dispose?.();
  sprite.material.map = texture;
  sprite.material.needsUpdate = true;
}

export class CubeBurst {
  constructor(scene) {
    this.scene = scene;
    this.pieces = [];
    this.rings = [];
  }

  // Confetti/spark burst. `drag` adds air resistance so shards decelerate for a
  // punchier pop; `fadePow` shapes the fade (>1 keeps pieces solid then snaps
  // out); `spin` scales the tumble speed. All optional and backward compatible.
  spawn(position, colors, { count = 10, speed = 1.9, up = 2.1, size = 0.075, gravity = 5.4, life = 0.7, drag = 0, fadePow = 1, spin = 12 } = {}) {
    const palette = Array.isArray(colors) ? colors : [colors];
    // Thinned for reduced-motion players and low-tier GPUs. Scaling here covers
    // every spawn call in every minigame; at least one shard always survives so
    // the event stays readable.
    const total = Math.max(1, Math.round(count * fxScale()));
    for (let index = 0; index < total; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size * (0.7 + Math.random() * 0.6), size, size),
        new THREE.MeshBasicMaterial({ color: palette[index % palette.length], transparent: true })
      );
      mesh.position.copy(position);
      const angle = Math.random() * Math.PI * 2;
      const radial = speed * (0.4 + Math.random() * 0.6);
      this.scene.add(mesh);
      this.pieces.push({
        mesh,
        vx: Math.cos(angle) * radial,
        vy: up * (0.5 + Math.random() * 0.6),
        vz: Math.sin(angle) * radial,
        spinX: (Math.random() - 0.5) * spin,
        spinY: (Math.random() - 0.5) * spin,
        age: 0,
        life: life * (0.85 + Math.random() * 0.3),
        gravity,
        drag,
        fadePow
      });
    }
  }

  // Flat, ground-hugging shockwave ring that scales out and fades — great for
  // impacts, perfect hits and eliminations.
  ring(position, color = "#ffffff", { life = 0.5, radius = 1.7, opacity = 0.55, y = 0.06, tilt = -Math.PI / 2 } = {}) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })
    );
    mesh.position.set(position.x, tilt === null ? position.y : y, position.z);
    if (tilt !== null) mesh.rotation.x = tilt;
    mesh.scale.setScalar(0.12);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, radius, opacity });
  }

  update(dt) {
    this.pieces = this.pieces.filter((piece) => {
      piece.age += dt;
      if (piece.age >= piece.life) {
        this.scene.remove(piece.mesh);
        piece.mesh.geometry.dispose();
        piece.mesh.material.dispose();
        return false;
      }
      piece.vy -= piece.gravity * dt;
      if (piece.drag) {
        const damp = Math.max(0, 1 - piece.drag * dt);
        piece.vx *= damp;
        piece.vy *= damp;
        piece.vz *= damp;
      }
      piece.mesh.position.x += piece.vx * dt;
      piece.mesh.position.y += piece.vy * dt;
      piece.mesh.position.z += piece.vz * dt;
      piece.mesh.rotation.x += piece.spinX * dt;
      piece.mesh.rotation.y += piece.spinY * dt;
      piece.mesh.material.opacity = Math.pow(Math.max(0, 1 - piece.age / piece.life), piece.fadePow);
      return true;
    });
    this.rings = this.rings.filter((ring) => {
      ring.age += dt;
      const progress = ring.age / ring.life;
      if (progress >= 1) {
        this.scene.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        ring.mesh.material.dispose();
        return false;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      ring.mesh.scale.setScalar(0.12 + eased * ring.radius);
      ring.mesh.material.opacity = ring.opacity * (1 - progress);
      return true;
    });
  }

  dispose() {
    this.pieces.forEach((piece) => {
      this.scene.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      piece.mesh.material.dispose();
    });
    this.rings.forEach((ring) => {
      this.scene.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      ring.mesh.material.dispose();
    });
    this.pieces = [];
    this.rings = [];
  }
}

// Schiebt eine Einblendung so weit zur Seite, dass sie ganz im Bild bleibt.
//
// Die Texte erscheinen über der Figur, der sie gelten — und Figuren stehen am
// Bildrand. "FEHLSTART!" über dem linken Läufer war damit halb abgeschnitten,
// "GESTOLPERT!" über zwei Springern gleichzeitig ergab Buchstabensalat. Ein
// Ausruf, den man nicht lesen kann, ist schlimmer als keiner: man sieht, dass
// etwas passiert ist, erfährt aber nicht was.
//
// Gerechnet wird im Bildraum: die halbe Textbreite in Bildkoordinaten ergibt
// sich aus der Weltbreite geteilt durch die sichtbare Breite in dieser Tiefe.
// Verschoben wird entlang der Kamera-Rechtsachse, damit der Text auf gleicher
// Höhe bleibt und nur seitlich einrückt.
const _rechts = new THREE.Vector3();
const _ndc = new THREE.Vector3();
function haltImBild(sprite, camera, weltBreite) {
  camera.updateMatrixWorld();
  _ndc.copy(sprite.position).project(camera);
  const tiefe = sprite.position.distanceTo(camera.position);
  const halbSichtbar = tiefe * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
  if (!(halbSichtbar > 0)) return;
  const halbText = (weltBreite / 2) / halbSichtbar;
  const grenze = 0.97 - halbText;
  if (grenze <= 0) return;                     // breiter als das Bild — nichts zu retten
  const ueber = Math.abs(_ndc.x) - grenze;
  if (ueber <= 0) return;
  camera.matrixWorld.extractBasis(_rechts, new THREE.Vector3(), new THREE.Vector3());
  sprite.position.addScaledVector(_rechts, -Math.sign(_ndc.x) * ueber * halbSichtbar);
}

// Pop-up 3D score/emote text that springs in, floats up and fades. One manager
// per scene; call pop() on events and update(dt) each frame.
export class FloatingText {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  pop(position, text, { color = "#ffffff", size = 0.5, life = 0.95, rise = 0.9, stroke = "rgba(18,38,48,0.6)" } = {}) {
    const FONT_PX = 82;
    const PAD = 26;                 // room for the outline stroke on both sides
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const font = `900 ${FONT_PX}px ui-rounded, system-ui, sans-serif`;

    // Size the canvas to the text instead of clipping it: a fixed 256px canvas
    // cut off anything past ~5 characters ("PERFEKT!" rendered as "ERFEK").
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + PAD * 2;
    const height = FONT_PX + PAD * 2;
    canvas.width = width;
    canvas.height = height;

    // Resizing the canvas resets the 2D context, so restyle after sizing.
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 18;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, width / 2, height / 2 + 2);
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.position.copy(position);
    sprite.renderOrder = 1000;
    this.scene.add(sprite);
    // Keep the sprite's on-screen aspect equal to the canvas so wide labels
    // stay legible instead of being squeezed into a fixed 2:1 box.
    this.items.push({ sprite, age: 0, life, rise, baseY: position.y, size, aspect: width / height });
  }

  // `camera` ist freiwillig, aber ohne sie kann der Text nicht im Bild gehalten
  // werden. Alle Szenen reichen sie durch.
  update(dt, camera = null) {
    this.items = this.items.filter((item) => {
      item.age += dt;
      const progress = item.age / item.life;
      if (progress >= 1) {
        this.scene.remove(item.sprite);
        item.sprite.material.map?.dispose?.();
        item.sprite.material.dispose();
        return false;
      }
      item.sprite.position.y = item.baseY + item.rise * (1 - Math.pow(1 - progress, 2));
      // Springy pop-in (overshoot) then settle; fade out over the final third.
      const pop = progress < 0.22 ? Math.sin((progress / 0.22) * (Math.PI / 2)) * 1.15 : 1 + (0.15 * Math.max(0, 1 - (progress - 0.22) / 0.15));
      const scale = item.size * pop;
      item.sprite.scale.set(scale * (item.aspect || 2), scale, 1);
      item.sprite.material.opacity = progress < 0.66 ? 1 : 1 - (progress - 0.66) / 0.34;
      if (camera) haltImBild(item.sprite, camera, scale * (item.aspect || 2));
      return true;
    });
  }

  dispose() {
    this.items.forEach((item) => {
      this.scene.remove(item.sprite);
      item.sprite.material.map?.dispose?.();
      item.sprite.material.dispose();
    });
    this.items = [];
  }
}

export function disposeScene(scene) {
  scene.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      material.map?.dispose?.();
      material.dispose?.();
    });
  });
}

export function noise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// --- Reaktion auf die Platzierung -----------------------------------------
// Vorher kannte jede Szene nur „Sieger ja/nein" und liess entweder jubeln oder
// trauern — Platz 2 sah damit genauso aus wie Platz 4. Der Server schickt seit
// dem Finale die Platzierung mit; daraus wird hier eine abgestufte Reaktion.
//
//   1. Platz  jubelt ausgelassen
//   2. Platz  freut sich
//   3. Platz  nimmt es gelassen
//   4. Platz  ist geknickt
export function finalePose(place, total = 4) {
  if (!place) return { state: "idle", cheer: false, hop: 0 };
  if (place === 1) return { state: "cheer", cheer: true, hop: 1 };
  if (place === 2) return { state: "cheer", cheer: true, hop: 0.45 };
  // Der vorletzte Platz ist nur dann „okay", wenn es überhaupt jemanden hinter
  // einem gibt — im Zweikampf ist Platz 2 der letzte und darf knicken.
  if (place < total) return { state: "idle", cheer: false, hop: 0 };
  return { state: "sad", cheer: false, hop: 0 };
}

// Setzt die Figur auf die Reaktion ihrer Platzierung. Gibt zurück, ob gejubelt
// wird — Szenen hängen daran gern noch Konfetti.
export function applyFinaleMood(animator, place, total = 4) {
  const pose = finalePose(place, total);
  animator?.set(pose.state, { base: true });
  return pose;
}
