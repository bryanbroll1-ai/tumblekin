// Player motion preference and device quality tier.
//
// Deliberately dependency-free: both VoxelKit (particle counts) and SceneKit
// (renderer settings) need these, and importing between those two would create
// a cycle.

// --- Motion preference -----------------------------------------------------
// The CSS `prefers-reduced-motion` rule only tames CSS animations, but the
// WebGL scenes are the dominant motion in this game. The 3D code reads these
// to damp camera shake and thin out particles.
const reducedMotionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

export function prefersReducedMotion() {
  return Boolean(reducedMotionQuery?.matches);
}

// Scales camera shake. Returns 0 under reduced motion, so screen shake stops
// entirely rather than merely softening — shake is what triggers discomfort.
export function shakeScale() {
  return prefersReducedMotion() ? 0 : 1;
}

// Scales particle counts: fewer shards under reduced motion and on weak GPUs,
// so the effect still reads without flooding the device.
export function fxScale() {
  if (prefersReducedMotion()) return 0.35;
  return qualityTier() === "low" ? 0.6 : 1;
}

// --- Device quality tier ---------------------------------------------------
// A mobile-first game runs on everything from flagships to old budget Androids.
// Pixel ratio, antialiasing and shadow maps are the costs worth scaling.
let cachedTier = null;

export function qualityTier() {
  if (cachedTier) return cachedTier;
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  const memory = (typeof navigator !== "undefined" && navigator.deviceMemory) || 4;
  cachedTier = (cores <= 4 || memory <= 3) ? "low" : "high";
  return cachedTier;
}

// Test seam: force a tier without having to fake hardware.
export function setQualityTier(tier) {
  cachedTier = tier === "low" || tier === "high" ? tier : null;
}

// --- Rahmenratenunabhängige Bewegung ---------------------------------------
// `position.lerp(ziel, 0.1)` je Bild sieht auf 60 Hz richtig aus und ist auf
// jedem anderen Gerät falsch: bei 120 Hz zieht die Kamera doppelt so schnell
// nach, bei 30 Hz halb so schnell. Auf einem Handy mit 120-Hz-Bildschirm wirkt
// dieselbe Szene dadurch hart und ruckartig, auf einem schwachen Gerät träge.
//
// Beide Helfer nehmen genau den Wert, der bisher fest im Code stand, und deuten
// ihn als „Anteil je Bild bei 60 Hz". Bei dt = 1/60 kommt derselbe Wert wieder
// heraus — auf 60 Hz ändert sich also nichts, alles andere zieht sich zurecht.

// Für Nachziehen: aus dem Anteil je Bild wird der Anteil für diesen Zeitschritt.
export function frameLerp(perFrameAt60, dt) {
  const step = Math.max(0, Math.min(0.25, dt || 0)) * 60;
  return 1 - Math.pow(1 - perFrameAt60, step);
}

// Für Abklingen (`wert *= 0.9`): derselbe Gedanke, nur behält der Faktor hier
// den verbleibenden statt den zurückgelegten Anteil.
export function frameDecay(keepPerFrameAt60, dt) {
  const step = Math.max(0, Math.min(0.25, dt || 0)) * 60;
  return Math.pow(keepPerFrameAt60, step);
}

// Für Funken und Staub, die je Bild mit einer Wahrscheinlichkeit entstehen
// (`if (Math.random() < 0.14)`). Rechnerisch ist das dieselbe Umrechnung: die
// Chance, dass im Zeitschritt mindestens einmal ausgelöst wird. Ohne sie
// rieselt auf einem 120-Hz-Gerät doppelt so viel Staub wie gedacht.
export function frameChance(perFrameAt60, dt) {
  return frameLerp(perFrameAt60, dt);
}
