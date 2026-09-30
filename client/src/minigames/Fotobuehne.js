// Schnappschuss: die Figuren auf der Bühne, genau wie der Server sie rechnet
// (photoStep in partyGames.js) — anlaufen, drehen, vorschnellen, rammen,
// taumeln, drängeln, und der Blitz, im selben Raster fester Schritte und in
// derselben Reihenfolge der Plätze.
//
// Damit rechnet das Gerät die Bühne bis zu dem Moment voraus, in dem ein
// JETZT geschickter Stick beim Server ankommt: die eigene Figur mit dem
// eigenen Stick (und dem eigenen SCHUBS), die anderen mit dem, den der Server
// gerade von ihnen hat. Vorher hing die eigene Figur eine Rundreise hinter dem
// Daumen, und ob man beim Blitz im Bild stand, sah man erst hinterher.
// Ein Test auf dem Server hält beide Rechnungen gleich.

export const STEP_MS = 30;       // wie PHOTO_STEP_MS
const MAX_SPAN_MS = 600;         // weiter wird nie vorausgerechnet
const DEFAULTS = {
  w: 6.4, d: 7.2, speed: 3.3, accel: 14, turn: 10, body: 0.3, bump: 0.62, hold: 0.2, dashMs: 190, dashSpeed: 7,
  hitR: 0.75, hitCone: 0.35, kick: 5.5, stunMs: 450, stunDrag: 4, cooldownMs: 1300, inPts: 10, coverPts: 10, soloPts: 5, stepMs: 30
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function photoRules(arcade) {
  return { ...DEFAULTS, ...(arcade?.photoRules || {}) };
}

function ease(v, target, rate, dt) {
  const fade = Math.exp(-rate * dt);
  return { v: target + (v - target) * fade, d: target * dt + (v - target) * (1 - fade) / rate };
}

// Darf die Figur jetzt schubsen? Wie photoStartShove.
export function canShove(rules, entry, at) {
  return at >= (entry.stunUntil || 0) && at - (entry.lastShoveAt ?? -1e9) >= rules.cooldownMs;
}

// Wie photoStartShove.
export function startShove(rules, entry, start) {
  if (!canShove(rules, entry, start)) return false;
  entry.lastShoveAt = start;
  entry.dashUntil = start + rules.dashMs;
  entry.shoves = (entry.shoves || 0) + 1;
  return true;
}

// Ein Rechenschritt, wie photoStep. `state` = { shot, results }, `shots` mit
// Ausschnitten, `entries` = [{ id, entry }]. Ereignisse (shove, hit, flash)
// landen in `events`.
export function stepPhoto(rules, state, shots, entries, stepMs, now, startedAt, events) {
  const dt = stepMs / 1000;
  const start = now - stepMs;
  const halfW = rules.w / 2 - rules.body;
  const halfD = rules.d / 2 - rules.body;
  entries.forEach(({ id, entry }) => {
    if (entry.shoveQueued) {
      entry.shoveQueued = false;
      if (startShove(rules, entry, start)) events?.push({ kind: "shove", by: id, at: start });
    }
    const dashing = start < entry.dashUntil;
    const stunned = start < entry.stunUntil;
    let dx;
    let dz;
    if (dashing) {
      entry.vx = Math.sin(entry.heading) * rules.dashSpeed;
      entry.vz = Math.cos(entry.heading) * rules.dashSpeed;
      dx = entry.vx * dt;
      dz = entry.vz * dt;
    } else {
      const rate = stunned ? rules.stunDrag : rules.accel;
      const gx = ease(entry.vx, stunned ? 0 : entry.dirX * rules.speed, rate, dt);
      const gz = ease(entry.vz, stunned ? 0 : entry.dirZ * rules.speed, rate, dt);
      entry.vx = gx.v;
      entry.vz = gz.v;
      dx = gx.d;
      dz = gz.d;
      if (!stunned && Math.hypot(entry.dirX, entry.dirZ) > 0.15) {
        const want = Math.atan2(entry.dirX, entry.dirZ);
        const diff = Math.atan2(Math.sin(want - entry.heading), Math.cos(want - entry.heading));
        entry.heading += clamp(diff, -rules.turn * dt, rules.turn * dt);
      }
    }
    const x = entry.x + dx;
    const z = entry.z + dz;
    entry.x = clamp(x, -halfW, halfW);
    entry.z = clamp(z, -halfD, halfD);
    if (x !== entry.x) entry.vx = 0;
    if (z !== entry.z) entry.vz = 0;
  });
  const hits = [];
  entries.forEach(({ id, entry }) => {
    if (!(start < entry.dashUntil)) return;
    const hx = Math.sin(entry.heading);
    const hz = Math.cos(entry.heading);
    entries.forEach(({ id: otherId, entry: other }) => {
      if (other === entry || start < other.stunUntil) return;
      const ox = other.x - entry.x;
      const oz = other.z - entry.z;
      const dist = Math.hypot(ox, oz);
      if (dist > rules.hitR || dist < 1e-6) return;
      if ((ox * hx + oz * hz) / dist < rules.hitCone) return;
      hits.push({ by: id, shover: entry, victim: other, victimId: otherId, nx: ox / dist, nz: oz / dist });
    });
  });
  hits.forEach(({ by, shover, victim, victimId, nx, nz }) => {
    victim.vx = nx * rules.kick;
    victim.vz = nz * rules.kick;
    victim.stunUntil = now + rules.stunMs;
    victim.dashUntil = 0;
    victim.shoved = (victim.shoved || 0) + 1;
    victim.lastShovedBy = by;
    victim.lastShovedAt = now;
    if (shover.dashUntil > now) shover.dashUntil = now;
    shover.vx *= 0.3;
    shover.vz *= 0.3;
    shover.hits = (shover.hits || 0) + 1;
    events?.push({ kind: "hit", by, victim: victimId, x: victim.x, z: victim.z, at: now });
  });
  const moves = entries.map(() => ({ x: 0, z: 0 }));
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a].entry;
      const two = entries[b].entry;
      const dx = two.x - one.x;
      const dz = two.z - one.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= rules.bump || dist < 1e-6) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = rules.bump - dist;
      const inOne = Math.max(0, one.vx * nx + one.vz * nz);
      const inTwo = Math.max(0, -(two.vx * nx + two.vz * nz));
      const share = (inOne + rules.hold) / (inOne + inTwo + 2 * rules.hold);
      moves[a].x -= nx * overlap * share;
      moves[a].z -= nz * overlap * share;
      moves[b].x += nx * overlap * (1 - share);
      moves[b].z += nz * overlap * (1 - share);
    }
  }
  entries.forEach(({ entry }, i) => {
    entry.x = clamp(entry.x + moves[i].x, -halfW, halfW);
    entry.z = clamp(entry.z + moves[i].z, -halfD, halfD);
  });
  const elapsed = now - startedAt;
  shots.forEach((shot) => {
    if (shot.index <= state.shot || elapsed < shot.shootAt) return;
    state.shot = shot.index;
    const inside = entries
      .map(({ id, entry }) => ({ id, entry, d: Math.hypot(entry.x - shot.x, entry.z - shot.z) }))
      .filter((item) => item.d <= shot.r);
    const nearest = inside.reduce((best, item) => (!best || item.d < best.d ? item : best), null);
    const result = { index: shot.index, at: now, in: [] };
    inside.forEach((item) => {
      const cover = item === nearest;
      const solo = inside.length === 1;
      const points = rules.inPts + (cover ? rules.coverPts : 0) + (solo ? rules.soloPts : 0);
      item.entry.score = (item.entry.score || 0) + points;
      item.entry.photos = (item.entry.photos || 0) + 1;
      if (cover) item.entry.covers = (item.entry.covers || 0) + 1;
      result.in.push({ id: item.id, points, cover, solo });
    });
    state.results.push(result);
    if (state.results.length > 6) state.results.shift();
    events?.push({ kind: "flash", shot: shot.index, result, at: now });
  });
}

// Die Bühne zur Serverzeit `to`, gerechnet vom Serverstand, der zur
// Serverzeit `from` gilt (arcade.photoClock). `ids`: die Spieler in der
// Reihenfolge der Plätze; `inputAt(id, serverzeit)` sagt, welchen Stick der
// Server für den Schritt ab dieser Zeit hat, und ob davor ein SCHUBS ankommt
// ({ x, y, shove }).
export function forecastPhoto(arcade, { from, to, ids, inputAt, startedAt }) {
  const rules = photoRules(arcade);
  const src = arcade.photo;
  const state = { shot: src.shot, results: (src.results || []).map((r) => ({ ...r, in: r.in.map((item) => ({ ...item })) })) };
  const entries = ids.map((id) => {
    const e = arcade.players[id];
    return {
      id,
      entry: {
        x: e.x, z: e.z, vx: e.vx || 0, vz: e.vz || 0, dirX: e.dirX || 0, dirZ: e.dirZ || 0, heading: e.heading || 0,
        dashUntil: e.dashUntil || 0, lastShoveAt: e.lastShoveAt ?? -1e9, shoveQueued: Boolean(e.shoveQueued), stunUntil: e.stunUntil || 0,
        shoves: e.shoves || 0, shoved: e.shoved || 0, hits: e.hits || 0, photos: e.photos || 0, covers: e.covers || 0, score: e.score || 0,
        lastShovedBy: e.lastShovedBy, lastShovedAt: e.lastShovedAt
      }
    };
  });
  const events = [];
  const steps = Math.floor(clamp(to - from, 0, MAX_SPAN_MS) / STEP_MS);
  // Nur Ausschnitte, die das Gerät schon kennt — die anderen blitzen ohnehin
  // noch lange nicht.
  const shots = (src.shots || []).filter((shot) => shot.x !== null && shot.x !== undefined);
  for (let k = 0; k < steps; k += 1) {
    const start = from + k * STEP_MS;
    entries.forEach(({ id, entry }) => {
      const input = inputAt(id, start);
      entry.dirX = input.x;
      entry.dirZ = input.y;
      if (input.shove) entry.shoveQueued = true;
    });
    stepPhoto(rules, state, shots, entries, STEP_MS, start + STEP_MS, startedAt, events);
  }
  return { at: from + steps * STEP_MS, state, entries: new Map(entries.map(({ id, entry }) => [id, entry])), events };
}
