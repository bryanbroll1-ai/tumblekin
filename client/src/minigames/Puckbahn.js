// Luftpuck: Scheiben und Puck, genau wie der Server sie rechnet (hockeyStep in
// partyGames.js) — Zonen, Stösse, Banden, Tore, Anstoss, Freiblasen und der
// Torwart-Roboter, im selben Raster fester Schritte und in derselben
// Reihenfolge der Plätze.
//
// Damit rechnet das Gerät den Tisch bis zu dem Moment voraus, in dem ein
// JETZT geschickter Stick beim Server ankommt: die eigene Scheibe mit dem
// eigenen Stick, die anderen mit dem, den der Server gerade von ihnen hat.
// Vorher fuhr die eigene Scheibe dem Daumen eine Rundreise hinterher — beim
// Airhockey, wo alles am Moment des Schlags hängt, traf man so kaum.
// Ein Test auf dem Server hält beide Rechnungen gleich.

export const STEP_MS = 30;       // wie HOCKEY_STEP_MS
const MAX_SPAN_MS = 600;         // weiter wird nie vorausgerechnet
const DEFAULTS = {
  w: 4.4, l: 7.4, puckR: 0.22, malletR: 0.36, speed: 4.3, accel: 16, damp: 0.18, max: 9.5, wallRest: 0.9,
  hitRest: 0.85, push: 0.35, serveMs: 1300, stepMs: 30, substeps: 5, stuckMs: 1500, laneSturm: 2.4, laneAbwehr: 1.4,
  aimSpeed: 7.5, aimGain: 18, aimAccel: 45
};
const ROBOT = "robot";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Wie noise in partyGames.js.
function noise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export function hockeyRules(arcade) {
  return { ...DEFAULTS, ...(arcade?.hockeyRules || {}) };
}

// Wie hockeyLimits.
export function limits(rules, side, r, lane = null) {
  let zMin = side === 0 ? 0.12 + r : -rules.l / 2 + r;
  let zMax = side === 0 ? rules.l / 2 - r : -0.12 - r;
  if (lane === "sturm") {
    if (side === 0) zMax = Math.min(zMax, rules.laneSturm);
    else zMin = Math.max(zMin, -rules.laneSturm);
  } else if (lane === "abwehr") {
    if (side === 0) zMin = Math.max(zMin, rules.laneAbwehr);
    else zMax = Math.min(zMax, -rules.laneAbwehr);
  }
  return { xMin: -rules.w / 2 + r, xMax: rules.w / 2 - r, zMin, zMax };
}

function serve(rules, state, towardSide, now) {
  state.puck = { x: 0, z: 0, vx: 0, vz: 0 };
  state.serveAt = now + rules.serveMs;
  state.serveToward = towardSide;
  state.served = false;
  state.lastTouch = null;
  state.lastInbound = false;
  state.lastBy = [null, null];
  state.stuck = null;
}

// Ein Rechenschritt. `mallets` = [{ id, e, robot }] in der Reihenfolge
// arcade.order, der Roboter zuletzt. Ereignisse (touch, goal, nudge) landen
// in `events`.
export function stepHockey(rules, state, mallets, now, seed, events) {
  const dt = rules.stepMs / 1000 / rules.substeps;
  const serving = now < state.serveAt;
  if (!serving && !state.served) {
    state.served = true;
    state.puck.vz = (state.serveToward === 0 ? 1 : -1) * 1.1;
    state.puck.vx = (noise(seed + state.goals.length * 7 + 3) - 0.5) * 0.6;
  }
  if (state.robot) {
    const p = state.puck;
    const tx = clamp(p.x * 0.7, -state.goalW / 2, state.goalW / 2);
    const tz = p.z < -0.6 && p.vz < 0.5 ? p.z - 0.2 : -rules.l / 2 + 0.9;
    const dx = tx - state.robot.x;
    const dz = tz - state.robot.z;
    const d = Math.hypot(dx, dz);
    state.robot.dirX = d > 0.05 ? (dx / d) * Math.min(1, d * 2) * 0.55 : 0;
    state.robot.dirZ = d > 0.05 ? (dz / d) * Math.min(1, d * 2) * 0.55 : 0;
  }
  const limitsOf = (m) => limits(rules, m.robot ? 1 : m.e.side, m.e.r, m.robot ? null : m.e.lane);
  for (let sub = 0; sub < rules.substeps; sub += 1) {
    mallets.forEach((m) => {
      const e = m.e;
      let tvx;
      let tvz;
      let k;
      if (e.aimX !== null && e.aimX !== undefined) {
        const cap = rules.aimSpeed * (e.cap ?? 1);
        tvx = (e.aimX - e.x) * rules.aimGain;
        tvz = (e.aimZ - e.z) * rules.aimGain;
        const want = Math.hypot(tvx, tvz);
        if (want > cap) { tvx *= cap / want; tvz *= cap / want; }
        k = Math.min(1, rules.aimAccel * dt);
      } else {
        const speed = rules.speed * (e.r > rules.malletR ? 1.08 : 1);
        tvx = (e.dirX || 0) * speed;
        tvz = (e.dirZ || 0) * speed;
        k = Math.min(1, rules.accel * dt);
      }
      e.vx += (tvx - e.vx) * k;
      e.vz += (tvz - e.vz) * k;
      const lim = limitsOf(m);
      const nx = clamp(e.x + e.vx * dt, lim.xMin, lim.xMax);
      const nz = clamp(e.z + e.vz * dt, lim.zMin, lim.zMax);
      e.mvx = (nx - e.x) / dt;
      e.mvz = (nz - e.z) / dt;
      e.x = nx;
      e.z = nz;
    });
    for (let a = 0; a < mallets.length; a += 1) {
      for (let b = a + 1; b < mallets.length; b += 1) {
        const one = mallets[a].e;
        const two = mallets[b].e;
        const dx = two.x - one.x;
        const dz = two.z - one.z;
        const dist = Math.hypot(dx, dz);
        const min = one.r + two.r;
        if (dist >= min || dist < 1e-6) continue;
        const push = (min - dist) / 2;
        const la = limitsOf(mallets[a]);
        const lb = limitsOf(mallets[b]);
        one.x = clamp(one.x - (dx / dist) * push, la.xMin, la.xMax);
        one.z = clamp(one.z - (dz / dist) * push, la.zMin, la.zMax);
        two.x = clamp(two.x + (dx / dist) * push, lb.xMin, lb.xMax);
        two.z = clamp(two.z + (dz / dist) * push, lb.zMin, lb.zMax);
      }
    }
    if (serving) continue;
    const p = state.puck;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    mallets.forEach(({ id, e }) => {
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const dist = Math.hypot(dx, dz);
      const min = e.r + rules.puckR;
      if (dist >= min || dist < 1e-6) return;
      const nx = dx / dist;
      const nz = dz / dist;
      const inbound = id !== ROBOT && p.vz * (e.side === 0 ? 1 : -1) > 0.5;
      p.x = e.x + nx * min;
      p.z = e.z + nz * min;
      const rvx = p.vx - (e.mvx || 0);
      const rvz = p.vz - (e.mvz || 0);
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        p.vx -= (1 + rules.hitRest) * vn * nx;
        p.vz -= (1 + rules.hitRest) * vn * nz;
      }
      const into = (e.mvx || 0) * nx + (e.mvz || 0) * nz;
      if (into > 0) {
        p.vx += nx * into * rules.push;
        p.vz += nz * into * rules.push;
      }
      if (id !== ROBOT && now - (e.lastTouchAt || 0) > 150) {
        e.touches = (e.touches || 0) + 1;
        e.lastTouchAt = now;
        state.touches += 1;
        events?.push({ kind: "touch", id, at: now, x: p.x, z: p.z });
      }
      state.lastTouch = id;
      state.lastInbound = inbound;
      if (id !== ROBOT) {
        state.lastBy ||= [null, null];
        state.lastBy[e.side] = { id, at: now };
      }
    });
    const speed = Math.hypot(p.vx, p.vz);
    if (speed > rules.max) {
      p.vx *= rules.max / speed;
      p.vz *= rules.max / speed;
    }
    const halfW = rules.w / 2 - rules.puckR;
    const halfL = rules.l / 2 - rules.puckR;
    if (Math.abs(p.x) > halfW) { p.x = Math.sign(p.x) * halfW; p.vx = -p.vx * rules.wallRest; }
    const inMouth = Math.abs(p.x) < state.goalW / 2 - rules.puckR * 0.4;
    if (Math.abs(p.z) > halfL && !inMouth) { p.z = Math.sign(p.z) * halfL; p.vz = -p.vz * rules.wallRest; }
    mallets.forEach((m) => {
      const e = m.e;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const dist = Math.hypot(dx, dz);
      const min = e.r + rules.puckR;
      if (dist >= min) return;
      const nx = dist < 1e-6 ? -Math.sign(p.x || 1) : dx / dist;
      const nz = dist < 1e-6 ? -Math.sign(p.z || 1) : dz / dist;
      const lim = limitsOf(m);
      e.x = clamp(p.x + nx * min, lim.xMin, lim.xMax);
      e.z = clamp(p.z + nz * min, lim.zMin, lim.zMax);
    });
    if (Math.abs(p.z) > rules.l / 2 + rules.puckR) {
      const scoringSide = p.z > 0 ? 1 : 0;
      state.score[scoringSide] += 1;
      const touched = mallets.find((m) => m.id === state.lastTouch && !m.robot);
      let shooter = touched ? touched.e : null;
      let by = shooter ? state.lastTouch : null;
      const attacker = state.lastBy?.[scoringSide];
      if (shooter && shooter.side !== scoringSide && state.lastInbound && attacker && now - attacker.at < 2000) {
        const found = mallets.find((m) => m.id === attacker.id);
        if (found) {
          shooter = found.e;
          by = attacker.id;
        }
      }
      if (shooter) {
        if (shooter.side === scoringSide) shooter.goals = (shooter.goals || 0) + 1;
        else shooter.ownGoals = (shooter.ownGoals || 0) + 1;
      }
      const own = Boolean(shooter && shooter.side !== scoringSide);
      const goal = { side: scoringSide, by: own ? null : by, at: now, x: p.x, own };
      state.goals.push(goal);
      events?.push({ kind: "goal", ...goal });
      serve(rules, state, 1 - scoringSide, now);
      break;
    }
  }
  const p = state.puck;
  if (now < state.serveAt) {
    state.stuck = null;
  } else if (!state.stuck || Math.hypot(p.x - state.stuck.x, p.z - state.stuck.z) > 0.45) {
    state.stuck = { x: p.x, z: p.z, at: now };
  } else if (now - state.stuck.at > rules.stuckMs) {
    state.nudges = (state.nudges || 0) + 1;
    p.vx = -Math.sign(p.x || 0.01) * 2.2 + (noise(seed + state.nudges * 13) - 0.5) * 0.6;
    p.vz = -Math.sign(p.z || 0.01) * 2.8;
    state.nudgeAt = now;
    state.stuck = { x: p.x, z: p.z, at: now };
    events?.push({ kind: "nudge", at: now });
  }
  const exp = Math.exp(-rules.damp * (rules.stepMs / 1000));
  p.vx *= exp;
  p.vz *= exp;
}

// Der Tisch zur Serverzeit `to`, gerechnet vom Serverstand, der zur Serverzeit
// `from` gilt (arcade.hockeyClock). `ids`: die Spieler in der Reihenfolge der
// Plätze; `inputAt(id, serverzeit)` sagt, welchen Stick der Server für den
// Schritt ab dieser Zeit hat.
export function forecastHockey(arcade, { from, to, ids, inputAt }) {
  const rules = hockeyRules(arcade);
  const src = arcade.hockey;
  const copy = (value) => (value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value);
  const state = {
    goalW: src.goalW,
    score: [...src.score],
    goals: [...(src.goals || [])],
    puck: { ...src.puck },
    serveAt: src.serveAt,
    serveToward: src.serveToward,
    served: src.served,
    lastTouch: src.lastTouch,
    lastInbound: src.lastInbound,
    lastBy: copy(src.lastBy) || [null, null],
    touches: src.touches || 0,
    nudges: src.nudges || 0,
    stuck: copy(src.stuck),
    robot: src.robot ? { ...src.robot } : null
  };
  const mallets = ids.map((id) => {
    const e = arcade.players[id];
    return {
      id,
      robot: false,
      e: {
        x: e.x, z: e.z, vx: e.vx || 0, vz: e.vz || 0, mvx: e.mvx || 0, mvz: e.mvz || 0, dirX: e.dirX || 0, dirZ: e.dirZ || 0,
        aimX: e.aimX ?? null, aimZ: e.aimZ ?? null, cap: e.cap ?? 1,
        r: e.r, side: e.side, lane: e.lane || null, touches: e.touches || 0, lastTouchAt: e.lastTouchAt || 0, goals: e.goals || 0, ownGoals: e.ownGoals || 0
      }
    };
  });
  if (state.robot) mallets.push({ id: ROBOT, robot: true, e: state.robot });
  const events = [];
  const steps = Math.floor(clamp(to - from, 0, MAX_SPAN_MS) / STEP_MS);
  for (let k = 0; k < steps; k += 1) {
    const start = from + k * STEP_MS;
    mallets.forEach((m) => {
      if (m.robot) return;
      // Entweder ein Stick (x, y) oder ein Ziel auf dem Tisch (aimX, aimZ).
      const input = inputAt(m.id, start);
      m.e.dirX = input.x || 0;
      m.e.dirZ = input.y || 0;
      m.e.aimX = input.aimX ?? null;
      m.e.aimZ = input.aimZ ?? null;
    });
    stepHockey(rules, state, mallets, start + STEP_MS, arcade.seed || 0, events);
  }
  return { at: from + steps * STEP_MS, state, mallets: new Map(mallets.map((m) => [m.id, m.e])), events };
}
