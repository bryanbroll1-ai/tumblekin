// Authoritative ring sizes, movement and contact rules, also used by preview.
(function (root) {
  const C = Object.freeze({ RADIUS: 1, BALL_RADIUS: 0.13, LIVES: 3,
    ACCEL: 6.8, DRAG: 4.5, BRAKE: 12, HIT_DRAG: 2.4,
    RUBBER_KICK: 0.5, CURVE_GAIN: .85, CURVE_POWER: .65, CURVE_SETTLE_MS: 250,
    HIT_STUN: 220, RESTITUTION: 0.82, MAX_SPEED: 3.4,
    STEER_TTL: 350, RESPAWN_MS: 1700, INVULN_MS: 900,
    SHRINK_MS: 15000, SHRINK_TO: 0.62, CREDIT_MS: 1600,
    STEP_MS: 8, MAX_EVENTS: 64 });
  const unit = (x, y) => { const n = Math.hypot(x, y); return n > 1e-6 ? { x: x / n, y: y / n } : null; };
  function create(players, startedAt, duration = 45000) {
    const arena = { startedAt, duration, radius: C.RADIUS, ballRadius: C.BALL_RADIUS,
      lives: C.LIVES, shrinkFrom: startedAt + Math.max(0, duration - C.SHRINK_MS),
      shrinkUntil: startedAt + duration, shrinkTo: C.SHRINK_TO,
      lastUpdateAt: startedAt, tick: 0, eventId: 0, events: [], contacts: {}, players: {} };
    players.forEach((p, index) => {
      const angle = index / players.length * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * 0.5, y = Math.sin(angle) * 0.5;
      arena.players[p.id] = { x, y, vx: 0, vy: 0, thrustX: 0, thrustY: 0,
        aimX: -Math.cos(angle), aimY: -Math.sin(angle), lastThrustAt: 0,
        inPlay: true, lives: C.LIVES, ejecting: false, launchedUntil: 0,
        hitUntil: 0, swing: 0, curveMs: 0, curveSign: 0, outUntil: 0, invulnUntil: startedAt + C.INVULN_MS,
        score: 0, playMs: 0, knockouts: 0, falls: 0, lastHitBy: null,
        lastHitAt: 0, lastCollisionAt: 0, collisionCount: 0,
        knockedAt: 0, spawnedAt: startedAt, outAt: null, fall: null };
    });
    return arena;
  }
  function event(arena, data) {
    arena.events.push({ id: ++arena.eventId, ...data });
    if (arena.events.length > C.MAX_EVENTS) arena.events.shift();
  }
  function thrust(p, x, y, now) {
    const n = Math.max(1, Math.hypot(x, y));
    p.thrustX = x / n; p.thrustY = y / n; p.lastThrustAt = now;
    const aim = unit(x, y); if (aim) { p.aimX = aim.x; p.aimY = aim.y; }
  }
  function spawnPoint(arena, self) {
    let best = { x: 0, y: 0 }, bestGap = -1;
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * Math.PI * 2, r = arena.radius * 0.36;
      const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
      const gap = Object.values(arena.players).filter(p => p !== self && p.inPlay)
        .reduce((near, p) => Math.min(near, Math.hypot(p.x - x, p.y - y)), 9);
      if (gap > bestGap) { bestGap = gap; best = { x, y }; }
    }
    return best;
  }
  function off(arena, id, p, now) {
    if (!p.inPlay) return;
    p.inPlay = false; p.ejecting = false; p.knockedAt = now;
    p.falls++; p.lives = Math.max(0, p.lives - 1);
    p.outUntil = p.lives ? now + C.RESPAWN_MS : 0;
    if (!p.lives) p.outAt = now;
    p.fall = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, at: now };
    const hitter = arena.players[p.lastHitBy];
    const credited = hitter && now - p.lastHitAt <= C.CREDIT_MS ? p.lastHitBy : null;
    if (credited) { hitter.knockouts++; hitter.score += 60; }
    event(arena, { kind: 'fall', at: now, player: id, attacker: credited, x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    p.vx = 0; p.vy = 0; p.thrustX = 0; p.thrustY = 0;
    p.lastHitBy = null; p.swing = 0; p.curveMs = 0; p.curveSign = 0;
  }
  function collision(arena, idA, idB, now) {
    const a = arena.players[idA], b = arena.players[idB];
    if (!a.inPlay || !b.inPlay) return;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= C.BALL_RADIUS * 2) return;
    const nx = d > 1e-7 ? dx / d : 1, ny = d > 1e-7 ? dy / d : 0;
    const overlap = (C.BALL_RADIUS * 2 - d) / 2;
    a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
    const va = a.vx * nx + a.vy * ny, vb = b.vx * nx + b.vy * ny;
    const closing = va - vb;
    // Separation is not a hit. No repeated damage/sound or false knockout
    // credit from resting contact or rings moving away from each other.
    if (closing <= 0.045) return;
    const protectedA = now < a.invulnUntil, protectedB = now < b.invulnUntil;
    // Bounded elastic snap adds punch to a committed run-up. Its ceiling
    // prevents chain contacts from creating runaway velocities.
    const impulse = (1 + C.RESTITUTION) * closing / 2
      + Math.min(C.RUBBER_KICK, Math.max(0, (closing - .6) * .5));
    if (protectedA && protectedB) {
      const bounce = .75 * closing;
      a.vx -= bounce * nx; a.vy -= bounce * ny;
      b.vx += bounce * nx; b.vy += bounce * ny;
    } else if (protectedA || protectedB) {
      if (!protectedA) { a.vx -= 1.25 * Math.max(0, va) * nx; a.vy -= 1.25 * Math.max(0, va) * ny; }
      if (!protectedB) { b.vx += 1.25 * Math.max(0, -vb) * nx; b.vy += 1.25 * Math.max(0, -vb) * ny; }
    } else {
      a.vx -= impulse * nx; a.vy -= impulse * ny;
      b.vx += impulse * nx; b.vy += impulse * ny;
      if (impulse > 0.2) {
        // Credit each victim only if the other ring was moving into it.
        if (va > 0.15) { b.lastHitBy = idA; b.lastHitAt = now; }
        if (vb < -0.15) { a.lastHitBy = idB; a.lastHitAt = now; }
        a.hitUntil = Math.max(a.hitUntil, now + C.HIT_STUN);
        b.hitUntil = Math.max(b.hitUntil, now + C.HIT_STUN);
        a.launchedUntil = b.launchedUntil = now + 450;
      }
    }
    for (const p of [a, b]) {
      p.swing = 0; p.curveMs = 0; p.curveSign = 0;
      const speed = Math.hypot(p.vx, p.vy);
      if (speed > C.MAX_SPEED) { p.vx *= C.MAX_SPEED / speed; p.vy *= C.MAX_SPEED / speed; }
    }
    const pair = JSON.stringify([idA, idB].sort());
    arena.contacts ||= {};
    if (now - (arena.contacts[pair] ?? -Infinity) >= 80) {
      arena.contacts[pair] = now;
      a.collisionCount++; b.collisionCount++;
      const attacker = va > -vb + 0.08 ? idA : -vb > va + 0.08 ? idB : null;
      event(arena, { kind: protectedA || protectedB ? 'shield' : 'hit', at: now,
        a: idA, b: idB, attacker, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
        nx, ny, strength: Math.min(1, impulse / 2.3) });
      a.lastCollisionAt = b.lastCollisionAt = now;
    }
  }
  function motion(p, dt, at) {
    const stunned = at < p.hitUntil;
    const steering = !stunned && at - p.lastThrustAt < C.STEER_TTL;
    const input = steering ? Math.hypot(p.thrustX, p.thrustY) : 0;
    const drag = stunned ? C.HIT_DRAG : input > .08 ? C.DRAG : C.BRAKE;
    const speedBefore = Math.hypot(p.vx, p.vy);
    const turn = speedBefore > .55 && input > .7 ? (p.vx * p.thrustY - p.vy * p.thrustX) / (speedBefore * input) : 0;
    const forward = speedBefore > .55 && input > .7 ? (p.vx * p.thrustX + p.vy * p.thrustY) / (speedBefore * input) : 0;
    const turning = !stunned && Math.abs(turn) > .12 && forward > .5 && forward < .99;
    p.swing ||= 0; p.curveMs ||= 0;
    if (turning) {
      const sign = Math.sign(turn);
      if (p.curveSign !== sign) { p.curveSign = sign; p.curveMs = 0; }
      p.curveMs += dt * 1000;
      if (p.curveMs >= C.CURVE_SETTLE_MS) p.swing = Math.min(1, p.swing + C.CURVE_GAIN * dt * Math.min(1, Math.abs(turn) / .4));
    } else {
      p.curveMs = 0;
      p.swing = Math.max(0, p.swing - dt * (stunned ? 2 : input < .7 ? 1.5 : forward < 0 ? 2 : .38));
    }
    // Curves build real velocity. The eventual straight run-up keeps it
    // briefly; contact consumes the accumulated curve and transfers momentum.
    const force = C.ACCEL * (1 + p.swing * C.CURVE_POWER);
    const ax = steering ? p.thrustX * force : 0, ay = steering ? p.thrustY * force : 0;
    const decay = Math.exp(-drag * dt), f = (1 - decay) / drag;
    p.x += ax / drag * dt + (p.vx - ax / drag) * f;
    p.y += ay / drag * dt + (p.vy - ay / drag) * f;
    p.vx = p.vx * decay + ax * f; p.vy = p.vy * decay + ay * f;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > C.MAX_SPEED) { p.vx *= C.MAX_SPEED / speed; p.vy *= C.MAX_SPEED / speed; }
  }
  function advance(arena, to) {
    to = Math.min(to, arena.startedAt + arena.duration);
    let at = Math.max(arena.startedAt, arena.lastUpdateAt);
    const ids = Object.keys(arena.players);
    while (at < to) {
      let end = Math.min(to, at + C.STEP_MS);
      for (const p of Object.values(arena.players)) for (const t of [p.hitUntil,
        p.lastThrustAt + C.STEER_TTL, !p.inPlay && p.lives > 0 ? p.outUntil : 0]) if (t > at) end = Math.min(end, t);
      const dt = (end - at) / 1000;
      const shrink = Math.min(1, Math.max(0, (end - arena.shrinkFrom) / Math.max(1, arena.shrinkUntil - arena.shrinkFrom)));
      arena.radius = C.RADIUS * (1 - (1 - arena.shrinkTo) * shrink); arena.shrinking = shrink > 0;
      for (const id of ids) {
        const p = arena.players[id];
        if (!p.inPlay && p.lives > 0 && at >= p.outUntil) {
          Object.assign(p, spawnPoint(arena, p), { vx: 0, vy: 0, thrustX: 0, thrustY: 0,
            inPlay: true, ejecting: false, hitUntil: 0, swing: 0, curveMs: 0, curveSign: 0,
            invulnUntil: at + C.INVULN_MS, spawnedAt: at, lastHitBy: null });
          const aim = unit(-p.x, -p.y); p.aimX = aim?.x ?? 0; p.aimY = aim?.y ?? -1;
          event(arena, { kind: 'spawn', at, player: id, x: p.x, y: p.y });
        }
        if (!p.inPlay) continue;
        motion(p, dt, at); p.playMs += dt * 1000; p.score += dt * 10;
      }
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) collision(arena, ids[i], ids[j], end);
      for (const id of ids) {
        const p = arena.players[id]; if (!p.inPlay) continue;
        const dist = Math.hypot(p.x, p.y);
        p.ejecting = dist > arena.radius - C.BALL_RADIUS * 0.35;
        if (dist > arena.radius + 0.012) off(arena, id, p, end);
      }
      arena.tick++; at = end;
    }
    arena.lastUpdateAt = Math.max(arena.lastUpdateAt, arena.startedAt, to);
  }
  const api = Object.freeze({ C, create, thrust, motion, advance, collision, spawnPoint });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TumblekinBumperPhysics = api;
})(globalThis);
