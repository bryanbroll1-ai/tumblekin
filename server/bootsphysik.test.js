// Bootsphysik (Kippboot): Tiere als Körper auf einem schwimmenden Boot.
// Geprüft wird, was man im Spiel sieht und worauf die Regeln bauen: nichts
// steckt ineinander, Stapel halten, Schiefes kippt, Zuviel kentert — und das
// Gerät rechnet aus einem Serverstand genau dasselbe voraus.
const test = require("node:test");
const assert = require("node:assert/strict");
const Boot = require("../client/src/minigames/Bootsphysik.js");

const DECK = Boot.PIVOT_Y + Boot.DECK_TOP;

function run(drops, ms = 3000) {
  const world = Boot.createWorld(0);
  const queue = drops.map((d, i) => ({ at: d.at ?? i * 1200, id: i + 1, kind: d.kind, x: d.x, turn: i }));
  const events = [];
  Boot.advance(world, queue, ms, events);
  return { world, events };
}

// Überdecken sich zwei gedrehte Rechtecke? (Trennachsen, mit kleiner Toleranz.)
function overlap(a, b) {
  const box = (body) => {
    const k = Boot.kind(body.kind);
    const c = Math.cos(body.a);
    const s = Math.sin(body.a);
    return [[-k.hw, -k.hh], [k.hw, -k.hh], [k.hw, k.hh], [-k.hw, k.hh]].map(([x, y]) => [body.x + x * c - y * s, body.y + x * s + y * c]);
  };
  const pa = box(a);
  const pb = box(b);
  for (const poly of [pa, pb]) {
    for (let i = 0; i < 4; i += 1) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % 4];
      const nx = y2 - y1;
      const ny = x1 - x2;
      const proj = (p) => p.map(([x, y]) => x * nx + y * ny);
      const ra = proj(pa);
      const rb = proj(pb);
      const len = Math.hypot(nx, ny);
      if ((Math.min(...rb) - Math.max(...ra)) / len > -0.02 || (Math.min(...ra) - Math.max(...rb)) / len > -0.02) return false;
    }
  }
  return true;
}

test("Bootsphysik: ein Tier fällt aufs Deck und bleibt dort ruhig liegen", () => {
  const { world } = run([{ kind: "kueken", x: 0.2 }]);
  const [chick] = world.bodies;
  assert.ok(Math.abs(chick.y - (DECK + Boot.kind("kueken").hh)) < 0.02, `liegt auf dem Deck (${chick.y.toFixed(3)})`);
  assert.ok(Math.hypot(chick.vx, chick.vy) < 0.05 && Math.abs(chick.a) < 0.05, "ruhig und aufrecht");
  assert.ok(Boot.settled(world));
});

test("Bootsphysik: Tiere stapeln sich, statt ineinanderzustecken", () => {
  const { world } = run([{ kind: "schwein", x: 0 }, { kind: "schwein", x: 0.05 }, { kind: "schaf", x: -0.05 }], 5000);
  assert.equal(world.bodies.length, 3);
  for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) {
    assert.ok(!overlap(world.bodies[i], world.bodies[j]), `${world.bodies[i].kind} und ${world.bodies[j].kind} durchdringen sich nicht`);
  }
  const heights = world.bodies.map((b) => b.y).sort((a, b) => a - b);
  assert.ok(heights[2] > heights[1] + 0.4 && heights[1] > heights[0] + 0.4, `ein Turm: ${heights.map((h) => h.toFixed(2))}`);
  assert.ok(Math.abs(world.boat.a) < 0.1, "mittig gestapelt neigt sich das Boot kaum");
});

test("Bootsphysik: wer schief auf einem anderen landet, kippt um", () => {
  const { world } = run([{ kind: "kueken", x: 0 }, { kind: "pinguin", x: 0.22 }]);
  const penguin = world.bodies.find((b) => b.kind === "pinguin");
  assert.ok(Math.abs(Math.sin(penguin.a)) > 0.7, `der Pinguin liegt auf der Seite (${(penguin.a * 57.3).toFixed(0)}°)`);
  assert.ok(!overlap(world.bodies[0], world.bodies[1]));
});

test("Bootsphysik: Gewicht neigt das Boot, Gegengewicht richtet es wieder auf", () => {
  const one = run([{ kind: "schaf", x: 1.2 }]).world;
  assert.ok(one.boat.a < -0.1, `das Boot neigt sich zum Schaf (${one.boat.a.toFixed(2)})`);
  const two = run([{ kind: "schaf", x: 1.2 }, { kind: "schaf", x: -1.2 }], 4500).world;
  assert.ok(Math.abs(two.boat.a) < 0.05, `ausgeglichen (${two.boat.a.toFixed(3)})`);
  assert.ok(Math.abs(Boot.torque(two)) < 0.3);
});

test("Bootsphysik: zu viel auf einer Seite kentert, und was über den Rand fällt, geht über Bord", () => {
  const capsized = run([{ kind: "schwein", x: 1.6 }]);
  assert.ok(capsized.world.capsized, "ein Schwein am Rand wirft das leere Boot um");
  assert.ok(capsized.events.some((e) => e.kind === "capsize"));
  const safe = run([{ kind: "schwein", x: 1.0 }]);
  assert.ok(!safe.world.capsized, "näher an der Mitte hält es");
  const world = Boot.createWorld(0);
  Boot.spawn(world, { id: 1, kind: "schaf", x: 2.4, y: 0.6, turn: null });
  const events = [];
  Boot.advance(world, [], 1500, events);
  assert.equal(world.bodies.length, 0);
  assert.equal(events.find((e) => e.kind === "overboard")?.body.id, 1);
});

test("Bootsphysik: das Gerät rechnet aus jedem Serverstand genau dasselbe voraus", () => {
  // Der Server rechnet durch; das Gerät bekommt mittendrin einen Stand (als
  // JSON, wie übers Netz) und rechnet von dort weiter — mit dem Passagier,
  // der noch in der Warteschlange hängt.
  const drops = [{ kind: "schaf", x: 0.9, at: 0 }, { kind: "schwein", x: -0.4, at: 900 }, { kind: "pinguin", x: 0.3, at: 1900 }];
  const server = Boot.createWorld(0);
  const queue = drops.map((d, i) => ({ at: d.at, id: i + 1, kind: d.kind, x: d.x, turn: i }));
  Boot.advance(server, queue, 1600, []);
  const sent = JSON.parse(JSON.stringify({ world: server, queue }));
  Boot.advance(server, queue, 3200, []);
  const device = Boot.copyWorld(sent.world);
  Boot.advance(device, sent.queue, 3200, []);
  assert.deepEqual(device, server);
});
