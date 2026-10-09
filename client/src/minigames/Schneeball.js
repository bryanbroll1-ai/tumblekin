// Schneeballhang: Figuren, Kugeln, Stösse und Abstürze, genau wie der Server
// sie rechnet (snowStep in partyGames.js) — anfahren, wachsen, drehen,
// Schwung, zusammenprallen, rutschen, über den Rand fallen, im selben Raster
// fester Schritte und in derselben Reihenfolge der Plätze.
//
// Damit rechnet das Gerät das ganze Plateau bis zu dem Moment voraus, in dem
// ein JETZT geschickter Stick beim Server ankommt: die eigene Figur mit dem
// eigenen Stick (und dem eigenen Schwung), die anderen mit dem, den der
// Server gerade von ihnen hat. Ein Test auf dem Server hält beide Rechnungen
// gleich.

export const STEP_MS = 30;       // wie SNOW_STEP_MS
const MAX_SPAN_MS = 600;         // weiter wird nie vorausgerechnet
const DEFAULTS = {
  r0: 4, rEnd: 2, shrinkFrom: 0.45, duration: 42000, speed: 3.2, drag: 0.2, accel: 10, slideAccel: 1.6,
  slideMs: 520, turn: 7, grow: 0.22, minSize: 0.2, bodyR: 0.3, dashSpeed: 6.2, dashMs: 260, dashCooldownMs: 1500,
  rest: 0.5, ram: 0.8, hard: 1.2, chip: 0.1, creditMs: 2500
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function snowRules(arcade) {
  return { ...DEFAULTS, ...(arcade?.snowRules || {}) };
}

export function ballRadius(size) {
  return 0.14 + size * 0.34;
}

function mass(size) {
  return 1 + 6 * size;
}

// Wie snowRadiusAt.
export function radiusAt(rules, elapsed, duration = rules.duration) {
  const from = duration * rules.shrinkFrom;
  const to = duration - 2000;
  const u = clamp((elapsed - from) / Math.max(1, to - from), 0, 1);
  return rules.r0 + (rules.rEnd - rules.r0) * u;
}

function ease(v, target, rate, dt) {
  const fade = Math.exp(-rate * dt);
  return { v: target + (v - target) * fade, d: target * dt + (v - target) * (1 - fade) / rate };
}

// Wie snowCircles: Körper und Kugel vorn.
export function circles(rules, e) {
  const r = ballRadius(e.size);
  const hx = Math.sin(e.heading);
  const hz = Math.cos(e.heading);
  return [
    { x: e.x, z: e.z, r: rules.bodyR, ball: false },
    { x: e.x + hx * (rules.bodyR + r), z: e.z + hz * (rules.bodyR + r), r, ball: true }
  ];
}

// Wie snowCanDash.
export function canDash(entry, now) {
  return entry.outAt === null && now >= entry.dashReadyAt && now >= entry.slideUntil;
}

export function dash(rules, entry, now) {
  if (!canDash(entry, now)) return false;
  entry.dashUntil = now + rules.dashMs;
  entry.dashReadyAt = now + rules.dashCooldownMs;
  entry.dashes = (entry.dashes || 0) + 1;
  return true;
}

// Ein Rechenschritt, wie snowStep. `world` = { rules, startedAt, duration,
// radius }, `entries` = [{ id, entry }]. Ereignisse (bump, fall) landen in
// `events`.
export function stepSnow(world, entries, dt, now, events) {
  const rules = world.rules;
  const elapsed = now - world.startedAt;
  const radius = radiusAt(rules, elapsed, world.duration);
  world.radius = radius;
  entries.forEach(({ entry }) => {
    if (entry.outAt !== null) {
      entry.x += entry.vx * dt;
      entry.z += entry.vz * dt;
      return;
    }
    const sliding = now < entry.slideUntil;
    const dashing = now < entry.dashUntil;
    const top = rules.speed * (1 - rules.drag * entry.size);
    let tx = entry.dirX * top;
    let tz = entry.dirZ * top;
    let rate = sliding ? rules.slideAccel : rules.accel;
    if (dashing) {
      tx = Math.sin(entry.heading) * rules.dashSpeed;
      tz = Math.cos(entry.heading) * rules.dashSpeed;
      rate = rules.accel * 2;
    }
    const gx = ease(entry.vx, tx, rate, dt);
    const gz = ease(entry.vz, tz, rate, dt);
    entry.vx = gx.v;
    entry.vz = gz.v;
    entry.x += gx.d;
    entry.z += gz.d;
    const speed = Math.hypot(entry.vx, entry.vz);
    if (!sliding && speed > 0.4) entry.size = Math.min(1, entry.size + rules.grow * Math.min(1, speed / rules.speed) * dt);
    if (!dashing && Math.hypot(entry.dirX, entry.dirZ) > 0.15) {
      const target = Math.atan2(entry.dirX, entry.dirZ);
      const diff = Math.atan2(Math.sin(target - entry.heading), Math.cos(target - entry.heading));
      entry.heading += clamp(diff, -rules.turn * dt, rules.turn * dt);
    }
  });
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const A = entries[a].entry;
      const B = entries[b].entry;
      if (A.outAt !== null || B.outAt !== null) continue;
      let best = null;
      circles(rules, A).forEach((ca) => circles(rules, B).forEach((cb) => {
        const dx = cb.x - ca.x;
        const dz = cb.z - ca.z;
        const d = Math.hypot(dx, dz);
        const overlap = ca.r + cb.r - d;
        if (overlap > 0 && (!best || overlap > best.overlap)) {
          best = { overlap, nx: d > 1e-6 ? dx / d : 1, nz: d > 1e-6 ? dz / d : 0, aBall: ca.ball, bBall: cb.ball, x: (ca.x + cb.x) / 2, z: (ca.z + cb.z) / 2 };
        }
      }));
      if (!best) continue;
      const mA = mass(A.size);
      const mB = mass(B.size);
      const inv = 1 / mA + 1 / mB;
      const { nx, nz } = best;
      A.x -= nx * best.overlap * (1 / mA) / inv;
      A.z -= nz * best.overlap * (1 / mA) / inv;
      B.x += nx * best.overlap * (1 / mB) / inv;
      B.z += nz * best.overlap * (1 / mB) / inv;
      const closing = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
      if (closing <= 0) continue;
      const j = (1 + rules.rest) * closing / inv;
      A.vx -= (j / mA) * nx;
      A.vz -= (j / mA) * nz;
      B.vx += (j / mB) * nx;
      B.vz += (j / mB) * nz;
      const rammtA = best.aBall ? (best.bBall ? 0.5 : 1) : 0;
      const rammtB = best.bBall ? (best.aBall ? 0.5 : 1) : 0;
      if (rammtA) {
        B.vx += nx * closing * rules.ram * rammtA * (0.5 + A.size);
        B.vz += nz * closing * rules.ram * rammtA * (0.5 + A.size);
      }
      if (rammtB) {
        A.vx -= nx * closing * rules.ram * rammtB * (0.5 + B.size);
        A.vz -= nz * closing * rules.ram * rammtB * (0.5 + B.size);
      }
      if (closing < rules.hard) continue;
      const slide = rules.slideMs * clamp(closing / 4, 0.6, 1.3);
      const aggA = best.aBall || !best.bBall;
      const aggB = best.bBall || !best.aBall;
      if (aggA) {
        B.slideUntil = Math.max(B.slideUntil, now + slide);
        B.lastHitBy = entries[a].id;
        B.lastHitAt = now;
      }
      if (aggB) {
        A.slideUntil = Math.max(A.slideUntil, now + slide);
        A.lastHitBy = entries[b].id;
        A.lastHitAt = now;
      }
      if (best.aBall) A.size = Math.max(rules.minSize, A.size - rules.chip * Math.min(1, closing / 5));
      if (best.bBall) B.size = Math.max(rules.minSize, B.size - rules.chip * Math.min(1, closing / 5));
      events?.push({ kind: "bump", x: best.x, z: best.z, at: now, power: Math.round(closing * 100) / 100, ids: [entries[a].id, entries[b].id] });
    }
  }
  entries.forEach(({ id, entry }) => {
    if (entry.outAt !== null) return;
    const d = Math.hypot(entry.x, entry.z);
    if (d <= radius) return;
    entry.outAt = elapsed;
    entry.fellAt = now;
    const out = Math.max(1.6, Math.hypot(entry.vx, entry.vz));
    entry.vx = (entry.x / d) * out;
    entry.vz = (entry.z / d) * out;
    let by = null;
    if (entry.lastHitBy && now - entry.lastHitAt <= rules.creditMs) {
      const pusher = entries.find((other) => other.id === entry.lastHitBy);
      if (pusher) {
        pusher.entry.knockouts += 1;
        by = entry.lastHitBy;
      }
    }
    entry.knockedBy = by;
    events?.push({ kind: "fall", id, x: entry.x, z: entry.z, at: now, by });
  });
}

// Das Plateau zur Serverzeit `to`, gerechnet vom Serverstand, der zur
// Serverzeit `from` gilt (arcade.snowClock). `ids`: die Spieler in der
// Reihenfolge der Plätze; `inputAt(id, serverzeit)` sagt, welchen Stick der
// Server für den Schritt ab dieser Zeit hat, und ob ein Schwung davor
// ankommt ({ x, y, dash }).
export function forecastSnow(arcade, { from, to, ids, inputAt }) {
  const rules = snowRules(arcade);
  const src = arcade.snow || {};
  const entries = ids.map((id) => {
    const e = arcade.players[id];
    return {
      id,
      entry: {
        x: e.x, z: e.z, vx: e.vx || 0, vz: e.vz || 0, dirX: e.dirX || 0, dirZ: e.dirZ || 0, heading: e.heading || 0,
        size: e.size ?? rules.minSize, slideUntil: e.slideUntil || 0, dashUntil: e.dashUntil || 0, dashReadyAt: e.dashReadyAt || 0,
        dashes: e.dashes || 0, lastHitBy: e.lastHitBy ?? null, lastHitAt: e.lastHitAt || 0, outAt: e.outAt ?? null,
        fellAt: e.fellAt || 0, knockedBy: e.knockedBy ?? null, knockouts: e.knockouts || 0
      }
    };
  });
  const world = { rules, startedAt: src.startedAt || 0, duration: src.duration || rules.duration, radius: src.radius ?? rules.r0 };
  const events = [];
  const steps = Math.floor(clamp(to - from, 0, MAX_SPAN_MS) / STEP_MS);
  for (let k = 0; k < steps; k += 1) {
    const start = from + k * STEP_MS;
    entries.forEach(({ id, entry }) => {
      const input = inputAt(id, start);
      entry.dirX = input.x;
      entry.dirZ = input.y;
      // Ein Schwung, der vor diesem Schritt ankommt: wie auf dem Server.
      if (input.dash && dash(rules, entry, start)) events.push({ kind: "dash", id, at: start });
    });
    stepSnow(world, entries, STEP_MS / 1000, start + STEP_MS, events);
  }
  return { at: from + steps * STEP_MS, radius: world.radius, entries: new Map(entries.map(({ id, entry }) => [id, entry])), events };
}
