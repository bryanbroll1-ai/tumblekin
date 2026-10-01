const test = require("node:test");
const assert = require("node:assert/strict");
const { testRules: r } = require("./server");

// Die zentrale Eingabegrenze und beide Regelschichten prüfen: die Physik und
// die Siegerpose müssen denselben endgültigen Stand zeigen.
for (const template of r.MINIGAMES) {
  test(`${template.title}: Lesepause, Countdown und Finale lassen keine Eingaben durch`, () => {
    const realNow = Date.now;
    let clock = 1000000;
    Date.now = () => clock;
    const players = ["a", "b"].map((id, i) => r.createPlayer({ id, name: id, color: i ? "#28c7d9" : "#ff5d73" }));
    const minigame = {
      id: "boundary", type: template.type, title: template.title,
      startedAt: clock + 4200, duration: template.duration,
      scores: {}, lastInputAt: {}, arena: {},
      arcade: template.arcadeFamily ? r.createArcadeState(template.type, players, clock + 4200) : null
    };
    if (template.type === "bounceArena") minigame.arena = r.createArenaState(players, minigame.startedAt, minigame.duration);
    const room = { code: "TEST", players, status: "minigame", phase: "waitingReady", currentMinigame: minigame, timers: new Set() };
    const input = { action: template.type === "bounceArena" ? "thrust" : "pump", x: 1, y: 1 };
    const snapshot = () => structuredClone({ arcade: minigame.arcade, arena: minigame.arena, scores: minigame.scores });
    try {
      const prepared = snapshot();
      assert.equal(r.handleMinigameInput(room, players[0], input).ok, false);
      assert.deepEqual(snapshot(), prepared);
      room.phase = "playingMinigame";
      assert.equal(r.handleMinigameInput(room, players[0], input).ok, false);
      assert.deepEqual(snapshot(), prepared);
      clock = minigame.startedAt + 1000;
      r.beginMinigameFinale(room, minigame);
      const final = snapshot();
      const direct = minigame.arcade ? r.handleArcadeInput : r.handleArenaInput;
      for (const action of ["pump", "tap", "thrust", "steer", "drop", "flick", "take", "lift"]) {
        const late = { action, x: 1, y: 1, count: 1, dx: 0, dy: -1, down: true };
        assert.equal(r.handleMinigameInput(room, players[0], late).ok, false);
        assert.equal(direct(room, players[0], late).ok, false);
        assert.deepEqual(snapshot(), final, `${action} darf die bereits festgelegten Plätze nicht verändern`);
      }
      r.finishMinigame(room);
      const places = minigame.arcade?.places || minigame.arena.places;
      room.lastMinigameResult.ranking.forEach((entry) => assert.equal(entry.place, places[entry.playerId]));
      // Auch ohne Finale-Signal muss die abgelaufene Uhr Eingaben abweisen.
      room.currentMinigame = minigame;
      minigame.finaleAt = null;
      clock = minigame.startedAt + minigame.duration + 1;
      const expired = snapshot();
      assert.equal(direct(room, players[0], input).ok, false);
      assert.deepEqual(snapshot(), expired);
    } finally {
      r.clearRoomTimers(room);
      Date.now = realNow;
    }
  });
}
