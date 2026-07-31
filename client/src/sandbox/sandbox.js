import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  KinAnimator,
  createNameLabel,
  createShadowBlob,
  createVoxelKin
} from "../minigames/VoxelKit.js?v=tumblekin82";
import { ENVIRONMENT_SETS, OBSTACLE_TYPES, createEnvironment, createObstacle } from "./EnvironmentKit.js?v=tumblekin82";

const PLAYER_COLORS = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"];
const PLAYER_NAMES = ["Spieler 1", "Spieler 2", "Spieler 3", "Spieler 4"];
const KIN_GROUND_Y = 0.3;
const WALK_SPEED = 1.5;

const ANIMATIONS = [
  { id: "run", name: "Laufen", base: true },
  { id: "jump", name: "Springen" },
  { id: "stumble", name: "Stolpern" },
  { id: "cheer", name: "Jubeln", base: true },
  { id: "sad", name: "Traurig", base: true },
  { id: "hit", name: "Getroffen" },
  { id: "fall", name: "Hinfallen" },
  { id: "idle", name: "Ruhe", base: true }
];

const VIEWPORTS = [
  { id: "full", name: "Voll" },
  { id: "phone", name: "Handy hoch", width: 390, height: 844 },
  { id: "phoneBig", name: "Handy groß", width: 430, height: 932 },
  { id: "landscape", name: "Handy quer", width: 844, height: 390 },
  { id: "tablet", name: "Tablet", width: 1024, height: 768 }
];

const stage = document.getElementById("stage");
const stageLabel = document.getElementById("stage-label");

// --- Renderer / scene (identical recipe to the 3D minigames) -----------
const scene = new THREE.Scene();
scene.background = new THREE.Color("#9fdcf2");
scene.fog = new THREE.Fog("#aee2f5", 14, 30);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 70);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.insertBefore(renderer.domElement, stageLabel);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x8fbf9a, 2.3));
const sun = new THREE.DirectionalLight(0xfff4d6, 3.4);
sun.position.set(4.5, 8.5, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
scene.add(sun);

const bursts = new CubeBurst(scene);

// --- Environment --------------------------------------------------------
let environment = null;
let activeSet = "meadow";

function setEnvironment(setId) {
  activeSet = setId;
  if (environment) {
    scene.remove(environment);
    environment.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => material.dispose?.());
    });
  }
  environment = createEnvironment(setId);
  scene.add(environment);
  const preset = ENVIRONMENT_SETS.find((set) => set.id === setId);
  scene.background.set(preset?.sky || "#9fdcf2");
  scene.fog.color.set(preset?.sky || "#aee2f5");
  document.querySelectorAll("#env-row .chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.id === setId);
  });
}

// --- Kins (AI test players) --------------------------------------------
const kins = [];

function spawnKins() {
  PLAYER_COLORS.forEach((color, index) => {
    const kin = createVoxelKin(color, index);
    kin.position.set(-1.5 + index, KIN_GROUND_Y, 1.2 - (index % 2) * 1.6);
    const label = createNameLabel(PLAYER_NAMES[index], color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.52);
    scene.add(shadow);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_GROUND_Y;
    kins.push({
      kin,
      shadow,
      animator,
      color,
      target: kin.position.clone(),
      waitUntil: performance.now() + index * 600,
      vx: 0,
      vz: 0,
      lastInteraction: 0
    });
    scene.add(kin);
  });
}
spawnKins();

let activePlayers = 4;
function setPlayerCount(count) {
  activePlayers = count;
  kins.forEach((entry, index) => {
    const visible = index < count;
    entry.kin.visible = visible;
    entry.shadow.visible = visible;
  });
  document.querySelectorAll("[data-players]").forEach((chip) => {
    chip.classList.toggle("active", Number(chip.dataset.players) === count);
  });
}

function pickWanderTarget(entry) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.8 + Math.random() * 3.4;
  entry.target.set(Math.cos(angle) * radius, KIN_GROUND_Y, Math.sin(angle) * radius);
}

// --- Obstacles ----------------------------------------------------------
const obstacles = [];

function spawnObstacle(type) {
  const item = createObstacle(type);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 1.4 + Math.random() * 2.9;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const blocked = obstacles.some((other) => Math.hypot(other.position.x - x, other.position.z - z) < 1.5);
    if (!blocked) {
      item.position.set(x, 0, z);
      break;
    }
  }
  item.userData.homeX = item.position.x;
  item.userData.phase = Math.random() * Math.PI * 2;
  item.rotation.y = Math.random() * Math.PI * 2;
  if (item.userData.obstacle.spin || item.userData.obstacle.type === "platform") item.rotation.y = 0;
  scene.add(item);
  obstacles.push(item);
  bursts.spawn(item.position.clone().add(new THREE.Vector3(0, 0.5, 0)), ["#ffffff", "#ffd15c"], { count: 8, size: 0.07 });
}

function clearObstacles() {
  obstacles.forEach((item) => {
    scene.remove(item);
    item.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => material.dispose?.());
    });
  });
  obstacles.length = 0;
}

// Shared physics feel: pushes decay like the minigames, spring launches,
// bumpers shove, spinner bars sweep, closed doors block.
function interact(entry, now) {
  obstacles.forEach((item) => {
    const config = item.userData.obstacle;
    const dx = entry.kin.position.x - item.position.x;
    const dz = entry.kin.position.z - item.position.z;
    const distance = Math.hypot(dx, dz);

    if (config.bounce && distance < config.radius && now - entry.lastInteraction > 700) {
      entry.lastInteraction = now;
      entry.animator.trigger("jump");
      bursts.spawn(item.position.clone().add(new THREE.Vector3(0, 0.5, 0)), ["#ffffff", "#ff5d73"], { count: 6, size: 0.06 });
      return;
    }
    if (config.push && distance < config.radius && now - entry.lastInteraction > 500) {
      entry.lastInteraction = now;
      const push = 3.4 / Math.max(0.3, distance);
      entry.vx += (dx / Math.max(0.05, distance)) * push;
      entry.vz += (dz / Math.max(0.05, distance)) * push;
      entry.animator.trigger("hit");
      bursts.spawn(entry.kin.position.clone(), ["#ffffff", entry.color], { count: 7, size: 0.07 });
      return;
    }
    if (config.spin && distance < config.radius && distance > 0.3) {
      const barAngle = config.bar.rotation.y % (Math.PI * 2);
      const kinAngle = Math.atan2(dz, dx);
      let diff = Math.abs(((barAngle - kinAngle) % Math.PI + Math.PI) % Math.PI);
      diff = Math.min(diff, Math.PI - diff);
      if (diff < 0.24 && now - entry.lastInteraction > 700) {
        entry.lastInteraction = now;
        const tangential = barAngle + Math.PI / 2;
        entry.vx += Math.cos(tangential) * 2.6;
        entry.vz += Math.sin(tangential) * 2.6;
        entry.animator.trigger("stumble");
        bursts.spawn(entry.kin.position.clone(), ["#ffffff", "#ff5d73"], { count: 6, size: 0.06 });
      }
      return;
    }
    // Solid blockers (crate, log, cone, platform, ramp, closed door).
    const solid = !config.bounce && !config.push && !config.spin && (!config.panel || !config.open);
    if (solid && distance < config.radius && distance > 0.01) {
      const overlap = config.radius - distance;
      entry.kin.position.x += (dx / distance) * overlap;
      entry.kin.position.z += (dz / distance) * overlap;
      if (Math.random() < 0.02) pickWanderTarget(entry);
    }
  });
}

// --- Touch simulation ---------------------------------------------------
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tapMarker = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.03, 0.4),
  new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0 })
);
tapMarker.rotation.y = Math.PI / 4;
scene.add(tapMarker);
let tapMarkerAt = 0;

renderer.domElement.addEventListener("pointerdown", (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit) && Math.hypot(hit.x, hit.z) < 5.6) {
    const leader = kins[0];
    leader.target.set(hit.x, KIN_GROUND_Y, hit.z);
    leader.waitUntil = 0;
    tapMarker.position.set(hit.x, 0.05, hit.z);
    tapMarkerAt = performance.now();
  }
});

// --- UI -----------------------------------------------------------------
function chip(label, onTap, { id, ghost } = {}) {
  const button = document.createElement("button");
  button.className = `chip${ghost ? " ghost" : ""}`;
  button.textContent = label;
  if (id) button.dataset.id = id;
  button.addEventListener("pointerdown", onTap);
  return button;
}

const envRow = document.getElementById("env-row");
ENVIRONMENT_SETS.forEach((set) => {
  envRow.append(chip(set.name, () => setEnvironment(set.id), { id: set.id }));
});

const obstacleRow = document.getElementById("obstacle-row");
OBSTACLE_TYPES.forEach((type) => {
  obstacleRow.append(chip(type.name, () => spawnObstacle(type.id)));
});
obstacleRow.append(chip("Aufräumen", clearObstacles, { ghost: true }));

const animRow = document.getElementById("anim-row");
ANIMATIONS.forEach((animation) => {
  animRow.append(chip(animation.name, () => {
    kins.forEach((entry) => {
      if (animation.base) entry.animator.set(animation.id, { base: true });
      else entry.animator.trigger(animation.id);
    });
  }));
});

const setupRow = document.getElementById("setup-row");
[1, 2, 3, 4].forEach((count) => {
  const button = chip(`${count} Spieler`, () => setPlayerCount(count));
  button.dataset.players = String(count);
  setupRow.append(button);
});
VIEWPORTS.forEach((preset) => {
  setupRow.append(chip(preset.name, () => setViewport(preset), { ghost: true, id: `vp-${preset.id}` }));
});

function setViewport(preset) {
  if (preset.id === "full") {
    stage.classList.remove("framed");
    stage.style.width = "100%";
    stage.style.height = "100%";
    stageLabel.textContent = "";
  } else {
    const wrap = document.getElementById("stage-wrap");
    const scaleFactor = Math.min(1, (wrap.clientWidth - 16) / preset.width, (wrap.clientHeight - 12) / preset.height);
    stage.classList.add("framed");
    stage.style.width = `${Math.round(preset.width * scaleFactor)}px`;
    stage.style.height = `${Math.round(preset.height * scaleFactor)}px`;
    stageLabel.textContent = `${preset.name} · ${preset.width}×${preset.height}`;
  }
  document.querySelectorAll("[data-id^='vp-']").forEach((button) => {
    button.classList.toggle("active", button.dataset.id === `vp-${preset.id}`);
  });
}

// --- Main loop ----------------------------------------------------------
let lastFrame = performance.now();

function resize() {
  const width = Math.max(280, stage.clientWidth);
  const height = Math.max(240, stage.clientHeight);
  const targetWidth = Math.floor(width * Math.min(window.devicePixelRatio || 1, 2));
  if (renderer.domElement.width !== targetWidth) {
    renderer.setSize(width, height, false);
  } else if (renderer.domElement.height !== Math.floor(height * Math.min(window.devicePixelRatio || 1, 2))) {
    renderer.setSize(width, height, false);
  }
  camera.aspect = width / height;
  const portrait = height > width;
  camera.position.set(0, portrait ? 7.6 : 5.6, portrait ? 9.4 : 8.6);
  camera.fov = portrait ? 50 : 44;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0.2, 0);
}

function tick() {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  resize();

  kins.forEach((entry, index) => {
    if (!entry.kin.visible) return;
    const { kin, animator } = entry;

    // Push velocities from bumpers/spinners decay like minigame physics.
    entry.vx *= Math.pow(0.82, dt * 10);
    entry.vz *= Math.pow(0.82, dt * 10);
    kin.position.x += entry.vx * dt;
    kin.position.z += entry.vz * dt;

    const transient = ["jump", "stumble", "hit", "fall"].includes(animator.state);
    const baseIsMobile = animator.baseState === "idle" || animator.baseState === "run";
    if (!transient && baseIsMobile) {
      if (now >= entry.waitUntil) {
        const dx = entry.target.x - kin.position.x;
        const dz = entry.target.z - kin.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.15) {
          animator.set("run", { base: true });
          kin.position.x += (dx / distance) * WALK_SPEED * dt;
          kin.position.z += (dz / distance) * WALK_SPEED * dt;
          kin.rotation.y = Math.atan2(dx, dz);
        } else {
          animator.set("idle", { base: true });
          entry.waitUntil = now + 700 + Math.random() * 1900;
          pickWanderTarget(entry);
          if (Math.random() < 0.18) animator.trigger("jump");
        }
      } else {
        animator.set("idle", { base: true });
      }
    }

    // Keep everyone on the diorama.
    const centerDistance = Math.hypot(kin.position.x, kin.position.z);
    if (centerDistance > 5.4) {
      kin.position.x *= 5.4 / centerDistance;
      kin.position.z *= 5.4 / centerDistance;
      pickWanderTarget(entry);
    }

    interact(entry, now);
    animator.update(now);

    entry.shadow.position.set(kin.position.x, 0.02, kin.position.z);
    const lift = kin.position.y - KIN_GROUND_Y;
    entry.shadow.scale.setScalar(Math.max(0.55, 1 - lift * 1.3));
  });

  obstacles.forEach((item) => {
    item.userData.obstacle.animate?.(item, now);
  });
  environment?.userData.animated.forEach((item) => {
    if (item.userData.kind === "float") {
      item.position.y = item.userData.baseY + Math.sin(now / 1300 + item.userData.phase) * 0.12;
    } else if (item.userData.kind === "waterline") {
      item.position.y = item.userData.baseY + Math.sin(now / 900) * 0.03;
      item.position.z = 4 + Math.sin(now / 1600) * 0.25;
    }
  });

  const markerAge = now - tapMarkerAt;
  tapMarker.material.opacity = markerAge < 600 ? (1 - markerAge / 600) * 0.8 : 0;
  tapMarker.scale.setScalar(markerAge < 600 ? 1 + markerAge / 600 : 1);

  bursts.update(dt);
  camera.position.x = Math.sin(now / 5200) * 0.18;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

setEnvironment("meadow");
setPlayerCount(4);
setViewport(VIEWPORTS[0]);
kins.forEach((entry) => pickWanderTarget(entry));
tick();
