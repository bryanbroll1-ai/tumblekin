import * as THREE from "/vendor/three/three.module.js";

// Shared voxel building blocks for the 3D minigame dioramas.

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

  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.02), accentLight);
  belly.position.set(0, -0.08, 0.2);
  body.add(belly);

  const eyes = [];
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.02), dark);
    eye.position.set(side * 0.095, 0.07, 0.2);
    body.add(eye);
    eyes.push(eye);
  });
  [-1, 1].forEach((side) => {
    const cheek = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.035, 0.015),
      new THREE.MeshLambertMaterial({ color: "#f9826b", transparent: true, opacity: 0.8 })
    );
    cheek.position.set(side * 0.15, -0.02, 0.2);
    body.add(cheek);
    materials.push(cheek.material);
  });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.028, 0.02), dark);
  mouth.position.set(0, -0.05, 0.2);
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
  group.userData = { body, blob, eyes, feet, arms, materials, phase: Math.random() * Math.PI * 2 };
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
    this.stateStart = performance.now();
    this.groundY = kin.position.y;
  }

  set(state, { base = false } = {}) {
    if (base || state === "idle" || state === "run" || state === "sad" || state === "cheer") {
      this.baseState = state;
    }
    if (this.state === state) return;
    this.state = state;
    this.stateStart = performance.now();
  }

  trigger(state) {
    this.state = state;
    this.stateStart = performance.now();
  }

  update(now = performance.now()) {
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
        const stride = Math.sin(now / 90 + phase);
        d.feet.forEach((foot, index) => { foot.rotation.x = stride * (index === 0 ? 0.8 : -0.8); });
        d.arms.forEach((arm, index) => { arm.rotation.z = arm.userData.baseRotZ + stride * (index === 0 ? -0.5 : 0.5); });
        d.body.rotation.x = 0.14;
        this.kin.position.y = this.groundY + Math.abs(Math.sin(now / 90 + phase)) * 0.05;
        break;
      }
      case "jump": {
        const progress = Math.min(1, t / 0.62);
        this.kin.position.y = this.groundY + Math.sin(progress * Math.PI) * 0.55;
        d.body.scale.set(1 - progress * 0.06, 1 + Math.sin(progress * Math.PI) * 0.12, 1 - progress * 0.06);
        d.arms.forEach((arm) => { arm.rotation.z = arm.userData.baseRotZ * -2.4; });
        d.feet.forEach((foot) => { foot.rotation.x = 0.6; });
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
        const hop = Math.abs(Math.sin(now / 160 + phase));
        this.kin.position.y = this.groundY + hop * 0.22;
        d.body.scale.set(1 - hop * 0.05, 1 + hop * 0.1, 1 - hop * 0.05);
        d.arms.forEach((arm) => {
          arm.rotation.z = arm.userData.side * 2.4;
          arm.position.y = arm.userData.baseY + 0.12 + hop * 0.04;
        });
        d.body.rotation.z = Math.sin(now / 320 + phase) * 0.08;
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
        // idle
        const breathe = 1 + Math.sin(now / 520 + phase) * 0.02;
        d.body.scale.set(breathe, 2 - breathe, breathe);
        d.body.rotation.z = Math.sin(now / 900 + phase) * 0.03;
        this.kin.position.y = this.groundY + Math.sin(now / 640 + phase) * 0.012;
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
  }

  spawn(position, colors, { count = 10, speed = 1.9, up = 2.1, size = 0.075, gravity = 5.4, life = 0.7 } = {}) {
    const palette = Array.isArray(colors) ? colors : [colors];
    for (let index = 0; index < count; index += 1) {
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
        spinX: (Math.random() - 0.5) * 12,
        spinY: (Math.random() - 0.5) * 12,
        age: 0,
        life,
        gravity
      });
    }
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
      piece.mesh.position.x += piece.vx * dt;
      piece.mesh.position.y += piece.vy * dt;
      piece.mesh.position.z += piece.vz * dt;
      piece.mesh.rotation.x += piece.spinX * dt;
      piece.mesh.rotation.y += piece.spinY * dt;
      piece.mesh.material.opacity = 1 - piece.age / piece.life;
      return true;
    });
  }

  dispose() {
    this.pieces.forEach((piece) => {
      this.scene.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      piece.mesh.material.dispose();
    });
    this.pieces = [];
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
