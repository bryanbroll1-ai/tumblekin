// Tiefenrausch: ein Taucher, genau wie der Server ihn rechnet (updateDiveEntry
// in server.js) — Schub gegen den Wasserwiderstand, Auftrieb, Wände, Luft,
// Einzahlen, Münzen, Quallen. Nur das sanfte Ausweichen zwischen zwei Tauchern
// fehlt: wo die anderen genau sind, weiss das Gerät erst hinterher.
//
// Damit rechnet das Gerät den eigenen Taucher bis zu dem Moment voraus, in dem
// eine JETZT geschickte Stickbewegung beim Server ankommt, und zeigt ihn dort —
// und die Quallen zur selben Zeit. Vorher lief die Figur dem Stick um die ganze
// Rundreise hinterher, und die Quallen standen eine halbe Rundreise zurück: bei
// 200 ms wich man sichtbar aus und wurde trotzdem gestochen. Ein Test auf dem
// Server hält beide Rechnungen gleich.

const DEFAULTS = {
  speed: 7.2, accel: 23, drag: 3.4, buoyancy: 1.1, refill: 80, stingO2: 20, stingDrop: 0.3,
  stunMs: 650, safeMs: 1400, faintRise: 14, pickRadius: 1.1, jellyRadius: 0.85
};
const TURN_S = 0.35;             // wie DIVE_TURN_S
const MAX_SPAN_MS = 600;         // weiter wird nie vorausgerechnet
export const STEP_MS = 30;       // wie DIVE_STEP_MS

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function swimRules(arcade) {
  return { ...DEFAULTS, ...(arcade?.swim || {}) };
}

// Wo eine Qualle steht — wie diveJellyAt.
export function jellyAt(jelly, width, elapsedMs) {
  const t = elapsedMs / 1000;
  return {
    x: width / 2 + Math.sin(t * jelly.speed + jelly.phase) * jelly.span,
    y: jelly.y + Math.sin(t * 1.7 + jelly.phase * 2) * 0.6
  };
}

// Luftverbrauch in dieser Tiefe, Prozent je Sekunde — wie diveO2Rate.
export function o2Rate(arcade, depth) {
  return (arcade.o2Base ?? 2) + (arcade.o2Depth ?? 7) * clamp(depth / (arcade.depth || 48), 0, 1);
}

// So viel Luft kostet der direkte Weg nach oben — wie diveAirToSurface. Das
// ist die Marke im Luftbalken.
export function airToSurface(arcade, depth) {
  const rules = swimRules(arcade);
  const surface = arcade.surfaceY ?? 1.2;
  const rise = Math.max(0, depth - surface);
  if (rise <= 0) return 0;
  const cruise = Math.min(rules.speed, rules.accel / rules.drag);
  return (rise / cruise + TURN_S) * o2Rate(arcade, (depth + surface) / 2);
}

// So lange dauert der direkte Weg nach oben, in Sekunden.
export function timeToSurface(arcade, depth) {
  const rules = swimRules(arcade);
  const rise = Math.max(0, depth - (arcade.surfaceY ?? 1.2));
  if (rise <= 0) return 0;
  return rise / Math.min(rules.speed, rules.accel / rules.drag) + TURN_S;
}

// Wie diveGlide: gleichbleibender Schub gegen den Widerstand, geschlossen gelöst.
function glide(v, a, drag, dt) {
  const cruise = a / drag;
  const fade = Math.exp(-drag * dt);
  return { v: cruise + (v - cruise) * fade, d: cruise * dt + (v - cruise) * (1 - fade) / drag };
}

// Ein Rechenschritt, `d` wird verändert. `input`: {x, y}; `gone(coin, now)`: ob
// die Münze gerade fehlt; Ereignisse landen in `events`.
export function stepDiver(d, arcade, rules, dt, now, elapsed, input, gone, events) {
  const width = arcade.width || 12;
  const depth = arcade.depth || 48;
  const surface = arcade.surfaceY ?? 1.2;
  if (d.fainted) {
    d.vx = 0;
    d.vy = 0;
    d.y = Math.max(0.4, d.y - rules.faintRise * dt);
    if (d.y <= surface) {
      d.fainted = false;
      d.safeUntil = now + rules.safeMs;
    }
    return;
  }
  const stunned = now < (d.stunUntil || 0);
  const ix = stunned ? 0 : input.x;
  const iy = stunned ? 0 : input.y;
  const gx = glide(d.vx, ix * rules.accel, rules.drag, dt);
  const gy = glide(d.vy, iy * rules.accel - (Math.hypot(ix, iy) < 0.1 ? rules.buoyancy : 0), rules.drag, dt);
  d.vx = gx.v;
  d.vy = gy.v;
  d.x += gx.d;
  d.y += gy.d;
  const speed = Math.hypot(d.vx, d.vy);
  if (speed > rules.speed) {
    d.vx *= rules.speed / speed;
    d.vy *= rules.speed / speed;
  }
  if (d.x < 0.6 || d.x > width - 0.6) { d.x = clamp(d.x, 0.6, width - 0.6); d.vx = 0; }
  if (d.y < 0.4 || d.y > depth - 0.7) { d.y = clamp(d.y, 0.4, depth - 0.7); d.vy = 0; }

  if (d.y <= surface) {
    d.o2 = Math.min(100, d.o2 + rules.refill * dt);
    if (d.carried > 0) {
      events?.push({ kind: "bank", gold: d.carried, at: now });
      d.carried = 0;
    }
  } else {
    d.o2 -= o2Rate(arcade, d.y) * dt;
    if (d.o2 <= 0) {
      d.o2 = 0;
      d.fainted = true;
      events?.push({ kind: "faint", gold: d.carried, at: now });
      d.carried = 0;
      return;
    }
  }

  for (const coin of arcade.coins || []) {
    if (gone(coin, now)) continue;
    if (Math.hypot(coin.x - d.x, coin.y - d.y) > rules.pickRadius * (coin.chest ? 1.3 : 1)) continue;
    d.picked.add(coin.id);
    d.pickedAt?.set(coin.id, now);
    d.carried += coin.value;
    events?.push({ kind: "pick", id: coin.id, value: coin.value, chest: Boolean(coin.chest), at: now });
  }

  if (now >= (d.safeUntil || 0)) {
    for (const jelly of arcade.jellies || []) {
      const at = jellyAt(jelly, width, elapsed);
      const dx = d.x - at.x;
      const dy = d.y - at.y;
      const dist = Math.hypot(dx, dy);
      if (dist > rules.jellyRadius) continue;
      const drop = Math.round(d.carried * rules.stingDrop);
      d.carried -= drop;
      d.o2 = Math.max(1, d.o2 - rules.stingO2);
      d.stunUntil = now + rules.stunMs;
      d.safeUntil = now + rules.safeMs;
      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : -1;
      d.vx = nx * 5;
      d.vy = ny * 5;
      events?.push({ kind: "sting", gold: drop, o2: rules.stingO2, at: now, x: at.x, y: at.y });
      break;
    }
  }
}

// Der Taucher zur Serverzeit `to`, gerechnet vom Serverstand `entry`, der zur
// Serverzeit `from` gilt (arcade.diveClock). Gerechnet wird im selben Raster
// wie auf dem Server; `inputAt(serverzeit)` sagt, welchen Stick der Server für
// den Schritt ab dieser Zeit hat. `claims` (Münze → Serverzeit): wann ein
// anderer Taucher sie voraussichtlich holt — ab dann ist sie auch hier weg.
export function forecastDiver(entry, arcade, { from, to, startedAt, inputAt, claims = null }) {
  const rules = swimRules(arcade);
  const d = {
    x: entry.x ?? 6, y: entry.y ?? 0.4, vx: entry.vx || 0, vy: entry.vy || 0,
    o2: entry.o2 ?? 100, carried: entry.carried || 0, fainted: Boolean(entry.fainted),
    stunUntil: entry.stunUntil || 0, safeUntil: entry.safeUntil || 0, picked: new Set(), pickedAt: new Map()
  };
  const events = [];
  const steps = Math.floor(clamp(to - from, 0, MAX_SPAN_MS) / STEP_MS);
  // Eine Münze fehlt, bis ein Schritt NACH ihrer Wiederkehr vorbei ist — auf
  // dem Server wird sie erst am Ende des Schritts zurückgelegt.
  const gone = (coin, now) => d.picked.has(coin.id)
    || Boolean(coin.takenUntil && now - STEP_MS < coin.takenUntil)
    || (claims?.get(coin.id) ?? Infinity) < now;
  for (let k = 0; k < steps; k += 1) {
    const now = from + (k + 1) * STEP_MS;
    stepDiver(d, arcade, rules, STEP_MS / 1000, now, now - startedAt, inputAt(now - STEP_MS), gone, events);
  }
  d.events = events;
  d.at = from + steps * STEP_MS;
  return d;
}
