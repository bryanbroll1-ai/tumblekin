// Farbenjagd: die Walzen, genau wie der Server sie rechnet (paintStep in
// server.js) — anfahren, schwenken, rempeln, malen, Extras aufheben, im selben
// Raster fester Schritte und in derselben Reihenfolge der Plätze.
//
// Damit rechnet das Gerät das ganze Feld bis zu dem Moment voraus, in dem ein
// JETZT geschickter Stick beim Server ankommt: die eigene Walze mit dem
// eigenen Stick, die anderen mit dem, den der Server gerade von ihnen hat.
// Vorher fuhr die eigene Figur dem Daumen eine Rundreise hinterher, und die
// Farbe kam noch später — man lenkte nach einem Bild, das es nicht mehr gab.
// Ein Test auf dem Server hält beide Rechnungen gleich.

export const STEP_MS = 30;       // wie PAINT_STEP_MS
const MAX_SPAN_MS = 600;         // weiter wird nie vorausgerechnet
const DEFAULTS = {
  speed: 4.8, accel: 22, turn: 11, ahead: 0.9, brush: 1.05, brushWide: 2.05, bomb: 2.4,
  own: 1.2, rival: 0.82, groundLead: 0.6, bumpRadius: 1.7, bumpForce: 4.5, knockDecay: 5,
  bumpCooldownMs: 500, boostMs: 3000, pickupReach: 1.2
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function paintRules(arcade) {
  return { ...DEFAULTS, ...(arcade?.paintRules || {}) };
}

// Das Feld aus der Zeichenkette ("." frei, "0".."3" Platz in arcade.order).
export function parseCells(text, size) {
  const cells = new Int8Array(size).fill(-1);
  for (let at = 0; at < size && at < (text || "").length; at += 1) {
    const code = text.charCodeAt(at);
    cells[at] = code === 46 ? -1 : code - 48;
  }
  return cells;
}

// Wie paintSweep: alle Felder, deren Mitte die Walze auf dem Weg von a nach b
// überstreicht.
export function paintSweep(cols, rows, ax, ay, bx, by, radius) {
  const out = [];
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const col0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
  const col1 = Math.min(cols - 1, Math.floor(Math.max(ax, bx) + radius));
  const row0 = Math.max(0, Math.floor(Math.min(ay, by) - radius));
  const row1 = Math.min(rows - 1, Math.floor(Math.max(ay, by) + radius));
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      const cx = col + 0.5;
      const cy = row + 0.5;
      const t = length2 > 0 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / length2, 0, 1) : 0;
      if (Math.hypot(cx - ax - dx * t, cy - ay - dy * t) <= radius) out.push(row * cols + col);
    }
  }
  return out;
}

// Wie paintGround: die Farbe knapp vor der Vorderkante der Walze.
export function groundAhead(world, entry) {
  const { rules, cols, rows, cells } = world;
  const reach = rules.ahead + (entry.wide ? rules.brushWide : rules.brush) + rules.groundLead;
  const x = entry.px + Math.sin(entry.heading) * reach;
  const y = entry.py + Math.cos(entry.heading) * reach;
  if (x < 0 || y < 0 || x >= cols || y >= rows) return "empty";
  const cell = cells[Math.floor(y) * cols + Math.floor(x)];
  return cell === entry.slot ? "own" : cell >= 0 ? "rival" : "empty";
}

function ease(v, target, rate, dt) {
  const fade = Math.exp(-rate * dt);
  return { v: target + (v - target) * fade, d: target * dt + (v - target) * (1 - fade) / rate };
}

function paint(world, slot, list) {
  list.forEach((at) => { world.cells[at] = slot; });
}

// Ein Rechenschritt für alle Walzen, `entries` in der Reihenfolge der Plätze.
// `inputOf(entry)` gibt den Stick für diesen Schritt; Ereignisse landen in
// `events`.
export function stepPaint(world, entries, dt, now, inputOf, events) {
  const { rules, cols, rows } = world;
  entries.forEach((entry) => {
    const stick = inputOf(entry);
    entry.dirX = stick.x;
    entry.dirY = stick.y;
    if (entry.boostUntil && now >= entry.boostUntil) {
      entry.wide = false;
      entry.boostUntil = 0;
    }
    const ground = groundAhead(world, entry);
    entry.ground = ground;
    const top = rules.speed * (ground === "own" ? rules.own : ground === "rival" ? rules.rival : 1);
    const gx = ease(entry.vx, entry.dirX * top, rules.accel, dt);
    const gy = ease(entry.vy, entry.dirY * top, rules.accel, dt);
    const fade = Math.exp(-rules.knockDecay * dt);
    const kick = (1 - fade) / rules.knockDecay;
    entry.vx = gx.v;
    entry.vy = gy.v;
    entry.px = clamp(entry.px + gx.d + entry.kx * kick, 0.3, cols - 0.3);
    entry.py = clamp(entry.py + gy.d + entry.ky * kick, 0.3, rows - 0.3);
    entry.kx *= fade;
    entry.ky *= fade;
    if (Math.hypot(entry.dirX, entry.dirY) > 0.15) {
      const want = Math.atan2(entry.dirX, entry.dirY);
      const diff = Math.atan2(Math.sin(want - entry.heading), Math.cos(want - entry.heading));
      const turn = rules.turn * dt;
      entry.heading += clamp(diff, -turn, turn);
    }
  });

  const share = dt / 0.09;
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a];
      const two = entries[b];
      const dx = two.px - one.px;
      const dy = two.py - one.py;
      const dist = Math.hypot(dx, dy);
      if (dist >= rules.bumpRadius || dist < 1e-6) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = rules.bumpRadius - dist;
      const push = overlap * rules.bumpForce * share;
      one.kx -= nx * push;
      one.ky -= ny * push;
      two.kx += nx * push;
      two.ky += ny * push;
      const part = overlap * 0.25 * share;
      one.px = clamp(one.px - nx * part, 0.3, cols - 0.3);
      one.py = clamp(one.py - ny * part, 0.3, rows - 0.3);
      two.px = clamp(two.px + nx * part, 0.3, cols - 0.3);
      two.py = clamp(two.py + ny * part, 0.3, rows - 0.3);
      [one, two].forEach((entry) => {
        if (now - entry.lastBumpAt <= rules.bumpCooldownMs) return;
        entry.lastBumpAt = now;
        events?.push({ kind: "bump", id: entry.id, at: now });
      });
    }
  }

  entries.forEach((entry) => {
    const rx = clamp(entry.px + Math.sin(entry.heading) * rules.ahead, 0, cols);
    const ry = clamp(entry.py + Math.cos(entry.heading) * rules.ahead, 0, rows);
    paint(world, entry.slot, paintSweep(cols, rows, entry.rx, entry.ry, rx, ry, entry.wide ? rules.brushWide : rules.brush));
    entry.rx = rx;
    entry.ry = ry;
    const taken = world.pickups.findIndex((pickup) => Math.hypot(pickup.x - entry.px, pickup.y - entry.py) < rules.pickupReach);
    if (taken >= 0) {
      const [pickup] = world.pickups.splice(taken, 1);
      events?.push({ kind: "pickup", id: entry.id, pickup: pickup.id, what: pickup.kind, at: now });
      if (pickup.kind === "wide") {
        entry.wide = true;
        entry.boostUntil = now + rules.boostMs;
      } else {
        paint(world, entry.slot, paintSweep(cols, rows, entry.px, entry.py, entry.px, entry.py, rules.bomb));
      }
    }
  });
}

// Das Feld zur Serverzeit `to`, gerechnet vom Serverstand, der zur Serverzeit
// `from` gilt (arcade.paintClock). `ids`: die Spieler in der Reihenfolge der
// Plätze; `inputAt(id, serverzeit)` sagt, welchen Stick der Server für den
// Schritt ab dieser Zeit von ihm hat.
export function forecastPaint(arcade, { from, to, ids, inputAt, cells = null }) {
  const rules = paintRules(arcade);
  const cols = arcade.cols || 12;
  const rows = arcade.rows || 26;
  const world = {
    rules,
    cols,
    rows,
    cells: cells ? Int8Array.from(cells) : parseCells(arcade.paint, cols * rows),
    pickups: (arcade.pickups || []).map((pickup) => ({ ...pickup }))
  };
  const entries = ids.map((id) => {
    const e = arcade.players[id];
    return {
      id, slot: e.slot, px: e.px, py: e.py, vx: e.vx || 0, vy: e.vy || 0, kx: e.kx || 0, ky: e.ky || 0,
      dirX: e.dirX || 0, dirY: e.dirY || 0, heading: e.heading || 0, rx: e.rx ?? e.px, ry: e.ry ?? e.py,
      wide: Boolean(e.wide), boostUntil: e.boostUntil || 0, lastBumpAt: e.lastBumpAt || 0, ground: e.ground
    };
  });
  const events = [];
  const steps = Math.floor(clamp(to - from, 0, MAX_SPAN_MS) / STEP_MS);
  for (let k = 0; k < steps; k += 1) {
    const now = from + (k + 1) * STEP_MS;
    stepPaint(world, entries, STEP_MS / 1000, now, (entry) => inputAt(entry.id, now - STEP_MS), events);
  }
  return { at: from + steps * STEP_MS, cells: world.cells, pickups: world.pickups, entries: new Map(entries.map((entry) => [entry.id, entry])), events };
}
