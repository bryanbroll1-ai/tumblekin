import * as THREE from "/vendor/three/three.module.js";
import { createOwnMarker, updateOwnMarker, disposeScene } from "./VoxelKit.js?v=tumblekin70";
import { qualityTier } from "./Quality.js?v=tumblekin70";

// Shared stage plumbing for the 3D minigames. Every minigame used to carry a
// byte-identical copy of the renderer setup, the resize handler, the own-marker
// block and the teardown sequence; these helpers hold the single copy.
//
// Each helper takes the minigame instance as `host` and reads/writes the same
// fields the games already used (canvas, webglCanvas, renderer, scene, camera,
// hud, ownMarker), so they stay drop-in and the games keep their own structure.

const MAX_PIXEL_RATIO = 2;

// Creates the WebGL canvas next to the 2D fallback canvas, plus renderer,
// scene and camera. Returns the stage so callers can destructure if they like.
export function mountStage(host, {
  label,
  background = "#9adcf2",
  fog = ["#a8e2f4", 18, 42],
  fov = 48,
  near = 0.1,
  far = 80,
  canvasClass = "kinetic-webgl"
} = {}) {
  host.canvas.hidden = true;

  const webglCanvas = document.createElement("canvas");
  webglCanvas.className = `${host.canvas.className} ${canvasClass}`;
  if (label) webglCanvas.setAttribute("aria-label", label);
  host.canvas.insertAdjacentElement("afterend", webglCanvas);
  host.webglCanvas = webglCanvas;

  const low = qualityTier() === "low";
  const renderer = new THREE.WebGLRenderer({
    canvas: webglCanvas,
    antialias: !low,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  // PCFSoft is noticeably pricier; basic PCF keeps shadows without the cost.
  renderer.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  host.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  if (fog) scene.fog = new THREE.Fog(fog[0], fog[1], fog[2]);
  host.scene = scene;

  host.camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  return { webglCanvas, renderer, scene, camera: host.camera };
}

// Inserts the HUD overlay right after the WebGL canvas.
export function mountHud(host, innerHTML, className = "kinetic-hud") {
  const hud = document.createElement("div");
  hud.className = className;
  hud.innerHTML = innerHTML;
  host.webglCanvas.insertAdjacentElement("afterend", hud);
  host.hud = hud;
  return hud;
}

// The shared sun + hemisphere rig. Shadow bounds differ per game, so they are
// parameters rather than baked in.
export function addStageLights(scene, {
  sunPosition = [-4, 11, 6],
  shadow = {},
  hemiIntensity = 2.3,
  sunIntensity = 3.0,
  shadowMapSize = 1024,
  skyColor = 0xe8f6ff,
  groundColor = 0x7ab890,
  sunColor = 0xfff2cf
} = {}) {
  scene.add(new THREE.HemisphereLight(skyColor, groundColor, hemiIntensity));
  const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
  sun.position.set(sunPosition[0], sunPosition[1], sunPosition[2]);
  sun.castShadow = true;
  // Halved on low-tier devices: a 512 map is the single biggest cheap saving.
  const mapSize = qualityTier() === "low" ? Math.max(256, shadowMapSize / 2) : shadowMapSize;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.camera.left = shadow.left ?? -8;
  sun.shadow.camera.right = shadow.right ?? 8;
  sun.shadow.camera.top = shadow.top ?? 8;
  sun.shadow.camera.bottom = shadow.bottom ?? -8;
  scene.add(sun);
  return sun;
}

// Resizes the renderer to the CSS box when it actually changed. `tune` receives
// (portrait, camera) so each game can set its own camera framing — that is the
// only part that ever differed between the games. Returns true on a real resize.
export function resizeStage(host, tune, { minWidth = 320, minHeight = 240 } = {}) {
  const canvas = host.webglCanvas;
  if (!canvas || !host.renderer || !host.camera) return false;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(minWidth, Math.floor(rect.width));
  const height = Math.max(minHeight, Math.floor(rect.height));
  // Must match the ratio mountStage gave the renderer, or the size check below
  // never settles and every frame triggers a needless resize.
  const ratio = Math.min(window.devicePixelRatio || 1, qualityTier() === "low" ? 1.5 : MAX_PIXEL_RATIO);
  if (canvas.width === Math.floor(width * ratio) && canvas.height === Math.floor(height * ratio)) return false;
  host.renderer.setSize(width, height, false);
  host.camera.aspect = width / height;
  tune?.(height > width, host.camera);
  host.camera.updateProjectionMatrix();
  return true;
}

// Keeps the downward "you" arrow pinned over the controlled player's kin so you
// never lose yourself in the crowd. Pass the kin (or null to hide it).
export function syncOwnMarker(host, target, now, offset = 0.35) {
  if (!host.scene) return;
  if (!target) {
    if (host.ownMarker) host.ownMarker.visible = false;
    return;
  }
  if (!host.ownMarker) {
    host.ownMarker = createOwnMarker();
    host.scene.add(host.ownMarker);
  }
  host.ownMarker.visible = target.visible !== false;
  host.ownMarker.position.set(target.position.x, 0, target.position.z);
  updateOwnMarker(host.ownMarker, now, target.position.y + offset);
}

// Frees GPU resources and removes the DOM the stage owns. Safe to call twice.
export function teardownStage(host) {
  host.bursts?.dispose();
  host.floaters?.dispose();
  if (host.scene) disposeScene(host.scene);
  host.renderer?.dispose();
  host.renderer?.forceContextLoss?.();
  host.webglCanvas?.remove();
  host.hud?.remove();
  host.webglCanvas = null;
  host.hud = null;
  host.scene = null;
  host.renderer = null;
  host.ownMarker = null;
  if (host.canvas) host.canvas.hidden = false;
}
