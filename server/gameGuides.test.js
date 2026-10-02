const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { testRules } = require("./server");

test("Startkarten und Kategorien decken alle spielbaren Minispiele ab", async () => {
  const { MINIGAME_GUIDES, GAME_CATEGORIES } = await import(pathToFileURL(path.join(__dirname, "../client/src/minigames/guides.js")).href);
  const games = testRules.MINIGAMES.map((game) => game.type).sort();
  assert.deepEqual(Object.keys(MINIGAME_GUIDES).sort(), games);
  const categories = new Set(GAME_CATEGORIES.map((category) => category.id));
  for (const [type, guide] of Object.entries(MINIGAME_GUIDES)) {
    assert.ok(categories.has(guide.category), `${type}: unbekannte Kategorie`);
    assert.ok(guide.goal.trim() && guide.tip.trim(), `${type}: Ziel oder Tipp fehlt`);
    assert.ok(guide.goal.split(/\s+/).length <= 24, `${type}: Kurzregel ist zu lang`);
  }
});
