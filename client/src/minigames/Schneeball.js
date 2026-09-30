// Schneeballhang: Figuren und Kugeln, genau wie der Server sie rechnet
// (snowStep in partyGames.js) — anfahren, wachsen, drehen, rempeln, rollen,
// treffen, blocken, zerplatzen, im selben Raster fester Schritte und in
// derselben Reihenfolge der Plätze.
//
// Damit rechnet das Gerät das ganze Feld bis zu dem Moment voraus, in dem ein
// JETZT geschickter Stick beim Server ankommt: die eigene Figur mit dem
// eigenen Stick (und dem eigenen Wurf), die anderen mit dem, den der Server
// gerade von ihnen hat. Vorher hing die eigene Figur eine Rundreise hinter
// dem Daumen, und ein Wurf flog erst los, wenn der Server ihn bestätigt hatte.
// Ein Test auf dem Server hält beide Rechnungen gleich.

export const STEP_MS = 30;       // wie SNOW_STEP_MS
const MAX_SPAN_MS = 600;         // weiter wird nie vorausgerechnet
const DEFAULTS = {
  w: 6.2, d: 8, speed: 3.3, drag: 0.25, accel: 14, turn: 9, grow: 0.3, minSize: 0.2, throwMin: 0.4,
  cooldownMs: 450, ballSpeed: 6.2, friction: 2.1, stop: 0.9, bodyR: 0.3, stunMs: 1200, safeMs: 900,
  bump: 0.62, sub: 0.12, shieldMin: 0.5, giant: 0.85, giantKeep: 0.7
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function snowRules(arcade) {
  return { ...DEFAULTS, ...(arcade?.snowRules || {}) };
}

export function ballRadius(size) {
  return 0.12 + size * 0.26;
}

export function ballValue(size, rules = DEFAULTS) {
  return size >= rules.giant ? 4 : size >= 0.6 ? 2 : 1;
}

function ease(v, target, rate, dt) {
  const fade = Math.exp(-rate * dt);
  return { v: target + (v - target) * fade, d: target * dt + (v - target) * (1 - fade) / rate };
}

// Wie snowThrowBall.
export function throwBall(rules, entry, id, owner, now) {
  const r = ballRadius(entry.size);
  const hx = Math.sin(entry.heading);
  const hz = Math.cos(entry.heading);
  return {
    id,
    owner,
    x: entry.x + hx * (rules.bodyR + r + 0.05),
    z: entry.z + hz * (rules.bodyR + r + 0.05),
    vx: hx * rules.ballSpeed + entry.vx * 0.3,
    vz: hz * rules.ballSpeed + entry.vz * 0.3,
    size: entry.size,
    r,
    value: ballValue(entry.size, rules),
    bornAt: now,
    spin: 0
  };
}

// Darf die Figur jetzt werfen? Wie die Prüfung in snow.input.
export function canThrow(rules, entry, now) {
  return now >= (entry.stunUntil || 0) && now - (entry.lastThrowAt || 0) >= rules.cooldownMs && entry.size >= rules.throwMin;
}

// Ein Rechenschritt. `world` = { rules, balls, players (id → entry für
// Punkte) }, `entries` = [{ id, entry }] in der Reihenfolge arcade.order.
// Ereignisse (hit, block, clash, fizzle) landen in `events`.
export function stepSnow(world, entries, dt, now, events) {
  const { rules } = world;
  const halfW = rules.w / 2 - rules.bodyR;
  const halfD = rules.d / 2 - rules.bodyR;
  entries.forEach(({ entry }) => {
    const stunned = now < entry.stunUntil;
    const want = stunned ? 0 : Math.min(1, Math.hypot(entry.dirX, entry.dirZ));
    const top = rules.speed * (1 - rules.drag * entry.size);
    const gx = ease(entry.vx, stunned ? 0 : entry.dirX * top, rules.accel, dt);
    const gz = ease(entry.vz, stunned ? 0 : entry.dirZ * top, rules.accel, dt);
    entry.vx = gx.v;
    entry.vz = gz.v;
    const x = entry.x + gx.d;
    const z = entry.z + gz.d;
    entry.x = clamp(x, -halfW, halfW);
    entry.z = clamp(z, -halfD, halfD);
    if (x !== entry.x) entry.vx = 0;
    if (z !== entry.z) entry.vz = 0;
    const speed = Math.hypot(entry.vx, entry.vz);
    if (!stunned && speed > 0.4) entry.size = Math.min(1, entry.size + rules.grow * (speed / rules.speed) * dt);
    if (want > 0.15) {
      const target = Math.atan2(entry.dirX, entry.dirZ);
      const diff = Math.atan2(Math.sin(target - entry.heading), Math.cos(target - entry.heading));
      entry.heading += clamp(diff, -rules.turn * dt, rules.turn * dt);
    }
  });

  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a].entry;
      const two = entries[b].entry;
      const dx = two.x - one.x;
      const dz = two.z - one.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= rules.bump || dist < 1e-6) continue;
      const push = (rules.bump - dist) / 2;
      one.x = clamp(one.x - (dx / dist) * push, -halfW, halfW);
      one.z = clamp(one.z - (dz / dist) * push, -halfD, halfD);
      two.x = clamp(two.x + (dx / dist) * push, -halfW, halfW);
      two.z = clamp(two.z + (dz / dist) * push, -halfD, halfD);
    }
  }

  const gone = new Set();
  const hits = (ball) => {
    entries.forEach(({ id, entry }) => {
      if (gone.has(ball.id) || id === ball.owner) return;
      if (now < entry.stunUntil || now < entry.safeUntil) return;
      const hx = Math.sin(entry.heading);
      const hz = Math.cos(entry.heading);
      const shieldR = ballRadius(entry.size);
      const sx = entry.x + hx * (rules.bodyR + shieldR);
      const sz = entry.z + hz * (rules.bodyR + shieldR);
      if (entry.size >= rules.shieldMin && Math.hypot(ball.x - sx, ball.z - sz) < ball.r + shieldR) {
        gone.add(ball.id);
        entry.size = rules.minSize;
        entry.blocks = (entry.blocks || 0) + 1;
        events?.push({ kind: "block", by: id, ball: ball.id, owner: ball.owner, x: (ball.x + sx) / 2, z: (ball.z + sz) / 2, at: now });
        return;
      }
      if (Math.hypot(ball.x - entry.x, ball.z - entry.z) < ball.r + rules.bodyR) {
        if (ball.size >= rules.giant) {
          ball.vx *= rules.giantKeep;
          ball.vz *= rules.giantKeep;
        } else {
          gone.add(ball.id);
        }
        entry.stunUntil = now + rules.stunMs;
        entry.safeUntil = now + rules.stunMs + rules.safeMs;
        entry.size = rules.minSize;
        entry.taken = (entry.taken || 0) + 1;
        entry.vx = ball.vx * 0.25;
        entry.vz = ball.vz * 0.25;
        const thrower = world.players?.get(ball.owner);
        if (thrower) {
          thrower.hits = (thrower.hits || 0) + 1;
          thrower.score = (thrower.score || 0) + ball.value;
        }
        events?.push({ kind: "hit", victim: id, by: ball.owner, ball: ball.id, value: ball.value, x: entry.x, z: entry.z, at: now });
      }
    });
  };
  world.balls.forEach((ball) => {
    const speed = Math.hypot(ball.vx, ball.vz);
    const slower = Math.max(0, speed - rules.friction * dt);
    if (speed > 0) {
      ball.vx *= slower / speed;
      ball.vz *= slower / speed;
    }
    ball.spin += (slower / Math.max(0.1, ball.r)) * dt;
    if (slower < rules.stop) {
      gone.add(ball.id);
      events?.push({ kind: "fizzle", ball: ball.id, x: ball.x, z: ball.z, at: now });
      return;
    }
    const teile = Math.max(1, Math.ceil((slower * dt) / rules.sub));
    for (let teil = 0; teil < teile && !gone.has(ball.id); teil += 1) {
      ball.x += (ball.vx * dt) / teile;
      ball.z += (ball.vz * dt) / teile;
      const limX = rules.w / 2 - ball.r;
      const limZ = rules.d / 2 - ball.r;
      if (Math.abs(ball.x) > limX) { ball.x = Math.sign(ball.x) * limX; ball.vx *= -0.55; ball.vz *= 0.8; }
      if (Math.abs(ball.z) > limZ) { ball.z = Math.sign(ball.z) * limZ; ball.vz *= -0.55; ball.vx *= 0.8; }
      hits(ball);
    }
  });
  for (let a = 0; a < world.balls.length; a += 1) {
    for (let b = a + 1; b < world.balls.length; b += 1) {
      const one = world.balls[a];
      const two = world.balls[b];
      if (gone.has(one.id) || gone.has(two.id)) continue;
      if (Math.hypot(one.x - two.x, one.z - two.z) < one.r + two.r) {
        gone.add(one.id);
        gone.add(two.id);
        events?.push({ kind: "clash", balls: [one.id, two.id], x: (one.x + two.x) / 2, z: (one.z + two.z) / 2, at: now });
      }
    }
  }
  if (gone.size) world.balls = world.balls.filter((ball) => !gone.has(ball.id));
}

// Das Feld zur Serverzeit `to`, gerechnet vom Serverstand, der zur Serverzeit
// `from` gilt (arcade.snowClock). `ids`: die Spieler in der Reihenfolge der
// Plätze; `inputAt(id, serverzeit)` sagt, welchen Stick der Server für den
// Schritt ab dieser Zeit hat, und ob ein Wurf davor ankommt ({ x, y, throw }).
export function forecastSnow(arcade, { from, to, ids, inputAt }) {
  const rules = snowRules(arcade);
  const entries = ids.map((id) => {
    const e = arcade.players[id];
    return {
      id,
      entry: {
        x: e.x, z: e.z, vx: e.vx || 0, vz: e.vz || 0, dirX: e.dirX || 0, dirZ: e.dirZ || 0, heading: e.heading || 0,
        size: e.size ?? rules.minSize, stunUntil: e.stunUntil || 0, safeUntil: e.safeUntil || 0, lastThrowAt: e.lastThrowAt || 0,
        score: e.score || 0, hits: e.hits || 0, taken: e.taken || 0, blocks: e.blocks || 0, throws: e.throws || 0
      }
    };
  });
  const world = {
    rules,
    balls: (arcade.snow?.balls || []).map((ball) => ({ ...ball })),
    players: new Map(entries.map(({ id, entry }) => [id, entry]))
  };
  const events = [];
  let predicted = 0;
  const steps = Math.floor(clamp(to - from, 0, MAX_SPAN_MS) / STEP_MS);
  for (let k = 0; k < steps; k += 1) {
    const start = from + k * STEP_MS;
    entries.forEach(({ id, entry }) => {
      const input = inputAt(id, start);
      entry.dirX = input.x;
      entry.dirZ = input.y;
      // Ein Wurf, der vor diesem Schritt ankommt: wie auf dem Server aus dem
      // Stand des letzten Schritts.
      if (input.throw && canThrow(rules, entry, start)) {
        predicted += 1;
        world.balls.push(throwBall(rules, entry, `p${predicted}`, id, start));
        events.push({ kind: "throw", by: id, ball: `p${predicted}`, at: start });
        entry.size = rules.minSize;
        entry.lastThrowAt = start;
        entry.throws += 1;
      }
    });
    stepSnow(world, entries, STEP_MS / 1000, start + STEP_MS, events);
  }
  return { at: from + steps * STEP_MS, balls: world.balls, entries: new Map(entries.map(({ id, entry }) => [id, entry])), events };
}
