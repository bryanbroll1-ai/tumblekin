const smooth = (value) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

// Aufprall nach 50 ms, kleines Nachfedern, nach 300 ms wieder in Ruhe.
// Absolute Zeit statt eines Faktors pro Bild: gleich auf 30, 60 und 120 Hz.
export function landingCompression(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs <= 0 || ageMs >= 300) return 0;
  if (ageMs < 50) return smooth(ageMs / 50);
  if (ageMs < 125) return 1 - 1.18 * smooth((ageMs - 50) / 75);
  return -0.18 * (1 - smooth((ageMs - 125) / 175));
}

// Die Zeitpunkte kommen vom Server; die Anzeige kündigt keine eigene Regel an.
export function arenaShrinkCue(arena, now) {
  const off = { phase: "none", seconds: 0 };
  if (!Number.isFinite(now) || !Number.isFinite(arena?.shrinkFrom)
    || !Number.isFinite(arena?.shrinkUntil) || now >= arena.shrinkUntil) return off;
  const left = arena.shrinkFrom - now;
  if (left <= 0) return { phase: "active", seconds: 0 };
  return left <= 5000 ? { phase: "soon", seconds: Math.ceil(left / 1000) } : off;
}
