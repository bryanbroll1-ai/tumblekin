const test = require("node:test");
const assert = require("node:assert/strict");
const { testRules: r } = require("./server");

// Ein Raum mit Host und zwei Gästen, ohne echte Verbindungen: leaveCurrentRoom
// braucht vom Socket nur die Kennungen.
function roomWith(status) {
  const players = ["host", "lina", "tom"].map((id, i) => r.createPlayer({ id, name: id, color: "#ff5d73", isHost: i === 0, controllerId: id }));
  const room = {
    code: "HAND", hostId: "host", status, phase: status, players, timers: new Set(),
    settings: {}, match: null, readyForNext: [], readyForMinigame: []
  };
  r.rooms.set(room.code, room);
  return room;
}
const socketOf = (id) => ({ id, data: { roomCode: "HAND", playerId: id }, leave() {} });

test("Host bleibt weg: nach der Frist leitet der nächste verbundene Mensch", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = roomWith("end");
  try {
    room.players[1].connected = false;      // Lina ist auch weg
    r.leaveCurrentRoom(socketOf("host"), true, false);
    assert.equal(room.hostId, "host");
    t.mock.timers.tick(r.HOST_HANDOVER_MS - 1);
    assert.equal(room.hostId, "host");
    t.mock.timers.tick(1);
    assert.equal(room.hostId, "tom");
    assert.deepEqual(room.players.map((p) => p.isHost), [false, false, true]);
  } finally {
    r.rooms.delete(room.code);
    r.clearRoomTimers(room);
  }
});

test("Host kommt rechtzeitig zurück: keine Übergabe", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = roomWith("result");
  try {
    r.leaveCurrentRoom(socketOf("host"), true, false);
    t.mock.timers.tick(r.HOST_HANDOVER_MS / 2);
    room.players[0].connected = true;       // wie resumeRoom
    t.mock.timers.tick(r.HOST_HANDOVER_MS);
    assert.equal(room.hostId, "host");
  } finally {
    r.rooms.delete(room.code);
    r.clearRoomTimers(room);
  }
});

test("Ohne andere Menschen bleibt der Host Host, und ein gelöschter Raum wird nicht mehr angefasst", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const room = roomWith("lobby");
  try {
    room.players[1].isBot = true;
    room.players[2].isBot = true;
    r.leaveCurrentRoom(socketOf("host"), true, false);
    t.mock.timers.tick(r.HOST_HANDOVER_MS);
    assert.equal(room.hostId, "host");
    const other = roomWith("minigame");
    r.leaveCurrentRoom(socketOf("host"), true, false);
    r.rooms.delete(other.code);
    t.mock.timers.tick(r.HOST_HANDOVER_MS);
    assert.equal(other.hostId, "host");
  } finally {
    r.rooms.delete(room.code);
    r.clearRoomTimers(room);
  }
});
