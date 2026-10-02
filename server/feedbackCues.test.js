const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const CUES = pathToFileURL(path.join(__dirname, "../client/src/minigames/FeedbackCues.js")).href;

test("Landung: früher Aufprall, kleines Nachfedern und vollständige Ruhe", async () => {
  const { landingCompression } = await import(CUES);
  assert.equal(landingCompression(0), 0);
  assert.equal(landingCompression(50), 1);
  assert.ok(Math.abs(landingCompression(125) + 0.18) < 1e-12);
  assert.equal(landingCompression(300), 0);
  assert.equal(landingCompression(1000), 0);
  for (const age of [-1, NaN, Infinity]) assert.equal(landingCompression(age), 0);
  for (let age = 0; age <= 300; age += 1) {
    const compression = landingCompression(age);
    assert.ok(compression >= -0.18 - 1e-12 && compression <= 1);
    const sy = 1 - compression * 0.22;
    const side = 1 / Math.sqrt(sy);
    assert.ok(Math.abs(side * side * sy - 1) < 1e-12, "Ein Sack behält beim Stauchen sein Volumen");
    assert.ok(Math.abs(landingCompression(age + 0.001) - compression) < 0.0001, "Keine Sprünge zwischen Animationsphasen");
  }
});

test("Landung: gleiche Pose zu gleicher Zeit bei 30, 60 und 120 Hz", async () => {
  const { landingCompression } = await import(CUES);
  const at = (hz, frame) => landingCompression(frame * 1000 / hz);
  for (let frame = 0; frame <= 9; frame += 1) {
    assert.ok(Math.abs(at(30, frame) - at(60, frame * 2)) < 1e-12);
    assert.ok(Math.abs(at(30, frame) - at(120, frame * 4)) < 1e-12);
  }
});

test("Insel: Warnung genau fünf Sekunden vor dem Server-Zeitpunkt und kein Alarm nach Ende", async () => {
  const { arenaShrinkCue } = await import(CUES);
  const arena = { shrinkFrom: 20000, shrinkUntil: 35000 };
  assert.deepEqual(arenaShrinkCue(arena, 14999), { phase: "none", seconds: 0 });
  assert.deepEqual(arenaShrinkCue(arena, 15000), { phase: "soon", seconds: 5 });
  assert.deepEqual(arenaShrinkCue(arena, 16001), { phase: "soon", seconds: 4 });
  assert.deepEqual(arenaShrinkCue(arena, 19999), { phase: "soon", seconds: 1 });
  assert.deepEqual(arenaShrinkCue(arena, 20000), { phase: "active", seconds: 0 });
  assert.deepEqual(arenaShrinkCue(arena, 34999), { phase: "active", seconds: 0 });
  assert.deepEqual(arenaShrinkCue(arena, 35000), { phase: "none", seconds: 0 });
  for (const state of [null, {}, { shrinkFrom: NaN, shrinkUntil: Infinity }]) {
    assert.deepEqual(arenaShrinkCue(state, 19000), { phase: "none", seconds: 0 });
  }
});
