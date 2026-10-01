const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const quality = () => import(pathToFileURL(path.join(__dirname, '../client/src/minigames/Quality.js')).href);

test('Effekte: Wahrscheinlichkeiten bleiben auch bei 120 Hz und zu großen Werten gültig', async () => {
  const { frameChance, frameDecay, frameLerp } = await quality();
  for (const hz of [30, 60, 120]) for (const value of [-1, 0, 0.08, 0.35, 0.9, 1, 2.2]) {
    for (const fn of [frameChance, frameDecay, frameLerp]) {
      const result = fn(value, 1 / hz);
      assert.ok(Number.isFinite(result) && result >= 0 && result <= 1, `${value} bei ${hz} Hz`);
    }
  }
});

test('Effekte: dieselbe Sekunde hat bei 30/60/120 Hz dieselbe Ereignischance', async () => {
  const { eventChance, frameChance } = await quality();
  for (const rate of [0, 0.3, 0.6, 0.9, 2.2, 2.5, 2.6, 4, 5]) for (const hz of [30, 60, 120]) {
    const once = 1 - (1 - eventChance(rate, 1 / hz)) ** hz;
    assert.ok(Math.abs(once - (1 - Math.exp(-rate))) < 1e-12);
  }
  for (const chance of [0.08, 0.35]) for (const hz of [30, 60, 120]) {
    const once = 1 - (1 - frameChance(chance, 1 / hz)) ** hz;
    assert.ok(Math.abs(once - (1 - (1 - chance) ** 60)) < 1e-12);
  }
});
