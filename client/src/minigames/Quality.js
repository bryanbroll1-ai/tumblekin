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
