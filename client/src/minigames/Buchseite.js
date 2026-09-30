// Bücherwurm: die Figuren und das Aufschlagen der Seiten, genau wie der
// Server sie rechnet (bookStep in partyGames.js) — anlaufen, rempeln, in
// Deckung gehen, platt werden, im selben Raster fester Schritte und in
// derselben Reihenfolge der Plätze.
//
// Damit rechnet das Gerät das Buch bis zu dem Moment voraus, in dem ein
// JETZT geschickter Stick beim Server ankommt, und zeigt Figuren UND Seite zu
// dieser Zeit. Vorher sah man sich noch im Loch, während der Server einen
// schon eine Rundreise früher gewertet hatte — oder umgekehrt.
// Ein Test auf dem Server hält beide Rechnungen gleich.

export const STEP_MS = 30;       // wie BOOK_STEP_MS
const MAX_SPAN_MS = 600;         // weiter wird nie vorausgerechnet
const DEFAULTS = { w: 6, d: 7.6, speed: 3.4, accel: 14, body: 0.3, bump: 0.64, inside: 0.1, flatMs: 1500, stepMs: 30 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function bookRules(arcade) {
  return { ...DEFAULTS, ...(arcade?.bookRules || {}) };
}

// Wie bookInHole.
export function inHole(rules, page, x, z) {
  return (page?.holes || []).some((h) => Math.abs(x - h.x) <= h.w / 2 - rules.inside && Math.abs(z - h.z) <= h.d / 2 - rules.inside);
}

function ease(v, target, rate, dt) {
  const fade = Math.exp(-rate * dt);
  return { v: target + (v - target) * fade, d: target * dt + (v - target) * (1 - fade) / rate };
}

// Ein Rechenschritt, wie bookStep. `state` = { slammed, lastHits },
// `pages` mit Löchern, `entries` = [{ id, entry }]. Ereignisse (slam) landen
// in `events`.
export function stepBook(rules, state, pages, entries, dt, now, startedAt, events) {
  const halfW = rules.w / 2 - rules.body;
  const halfD = rules.d / 2 - rules.body;
  const elapsed = now - startedAt;
  entries.forEach(({ entry }) => {
    const stuck = entry.outAt || now < entry.flatUntil;
    const gx = ease(entry.vx, stuck ? 0 : entry.dirX * rules.speed, rules.accel, dt);
    const gz = ease(entry.vz, stuck ? 0 : entry.dirZ * rules.speed, rules.accel, dt);
    entry.vx = gx.v;
    entry.vz = gz.v;
    const x = entry.x + gx.d;
    const z = entry.z + gz.d;
    entry.x = clamp(x, -halfW, halfW);
    entry.z = clamp(z, -halfD, halfD);
    if (x !== entry.x) entry.vx = 0;
    if (z !== entry.z) entry.vz = 0;
  });
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a].entry;
      const two = entries[b].entry;
      if (one.outAt || two.outAt) continue;
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
  const coming = pages.find((page) => page.index > state.slammed);
  if (coming && elapsed >= coming.at) {
    entries.forEach(({ entry }) => {
      if (entry.outAt) return;
      if (inHole(rules, coming, entry.x, entry.z)) {
        if (entry.safeSince === null || entry.safeSince === undefined) entry.safeSince = elapsed;
      } else {
        entry.safeSince = null;
      }
    });
  }
  pages.forEach((page) => {
    if (page.index <= state.slammed || elapsed < page.slamAt) return;
    state.slammed = page.index;
    const hits = [];
    entries.forEach(({ id, entry }) => {
      if (entry.outAt) return;
      if (inHole(rules, page, entry.x, entry.z)) {
        const since = entry.safeSince ?? page.slamAt;
        entry.safeMs = (entry.safeMs || 0) + clamp(since - page.at, 0, page.flip);
        entry.survived += 1;
      } else {
        entry.lives -= 1;
        entry.squashed += 1;
        entry.flatUntil = now + rules.flatMs;
        hits.push(id);
        if (entry.lives <= 0) {
          entry.outAt = elapsed;
          entry.outMs = elapsed;
        }
      }
      entry.lastPage = page.index;
      entry.safeSince = null;
      entry.score = entry.survived;
    });
    state.lastHits = { page: page.index, ids: hits };
    events?.push({ kind: "slam", page: page.index, hits, at: now });
  });
}

// Das Buch zur Serverzeit `to`, gerechnet vom Serverstand, der zur Serverzeit
// `from` gilt (arcade.bookClock). `ids`: die Spieler in der Reihenfolge der
// Plätze; `inputAt(id, serverzeit)` sagt, welchen Stick der Server für den
// Schritt ab dieser Zeit hat.
export function forecastBook(arcade, { from, to, ids, inputAt, startedAt }) {
  const rules = bookRules(arcade);
  const src = arcade.book;
  const state = { slammed: src.slammed, lastHits: src.lastHits };
  const entries = ids.map((id) => {
    const e = arcade.players[id];
    return {
      id,
      entry: {
        x: e.x, z: e.z, vx: e.vx || 0, vz: e.vz || 0, dirX: e.dirX || 0, dirZ: e.dirZ || 0, lives: e.lives, flatUntil: e.flatUntil || 0,
        survived: e.survived || 0, squashed: e.squashed || 0, outAt: e.outAt ?? null, outMs: e.outMs, lastPage: e.lastPage,
        score: e.score || 0, safeSince: e.safeSince ?? null, safeMs: e.safeMs || 0
      }
    };
  });
  const events = [];
  const steps = Math.floor(clamp(to - from, 0, MAX_SPAN_MS) / STEP_MS);
  // Nur Seiten, deren Löcher das Gerät schon kennt — die anderen schlagen
  // ohnehin noch lange nicht auf.
  const pages = (src.pages || []).filter((page) => page.holes);
  for (let k = 0; k < steps; k += 1) {
    const start = from + k * STEP_MS;
    entries.forEach(({ id, entry }) => {
      const input = inputAt(id, start);
      entry.dirX = input.x;
      entry.dirZ = input.y;
    });
    stepBook(rules, state, pages, entries, STEP_MS / 1000, start + STEP_MS, startedAt, events);
  }
  return { at: from + steps * STEP_MS, state, entries: new Map(entries.map(({ id, entry }) => [id, entry])), events };
}
