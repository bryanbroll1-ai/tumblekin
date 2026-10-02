// One set of metres, seconds and jump equations for the rules and renderer.
// A plain script module also works in the isolated practice Worker (CommonJS).
(function (root) {
  const C = Object.freeze({
    LENGTH: 100, JOG: 4.4, SPRINT: 7.8, ACCEL_TIME: 0.25,
    ENERGY: 100, DRAIN: 30, RECOVER: 22, JUMP_COST: 12,
    JUMP_V: 5.3, GRAVITY: 13.8, REST_MS: 160,
    HURDLE_HEIGHT: 0.64, CLEARANCE: 0.74,
    STUMBLE_MS: 750, STUMBLE_SPEED: 1.9, HOLD_TTL: 420,
    RESUME_ENERGY: 30, STEP_MS: 10
  });
  const AIR_MS = 2000 * C.JUMP_V / C.GRAVITY;
  function course(seed) {
    return Array.from({ length: 7 }, (_, index) => ({ index,
      at: (index + 1) * 12 + Math.sin(seed * 0.73 + index * 17.31) * 0.8 }));
  }
  function player(lane, startedAt) {
    return { lane, progress: 0, speed: 0, energy: C.ENERGY, holding: false,
      sprintAt: 0, sprinting: false, exhausted: false, jumpAt: null,
      jumpUntil: 0, jumpReadyAt: 0, jumpSpeed: 0, stumbleUntil: 0,
      nextHurdle: 0, cleared: 0, stumbles: 0, jumps: 0,
      finishedAt: null, finishMs: null, updatedAt: startedAt, lastVerdict: null };
  }
  function height(entry, now) {
    if (entry.jumpAt === null || now < entry.jumpAt || now >= entry.jumpUntil) return 0;
    const t = (now - entry.jumpAt) / 1000;
    return Math.max(0, C.JUMP_V * t - C.GRAVITY * t * t / 2);
  }
  function jump(entry, now) {
    if (entry.finishedAt !== null || now < entry.jumpReadyAt || now < entry.stumbleUntil) return false;
    entry.jumpAt = now;
    entry.jumpUntil = now + AIR_MS;
    entry.jumpReadyAt = entry.jumpUntil + C.REST_MS;
    entry.jumpSpeed = entry.speed;
    entry.energy = Math.max(0, entry.energy - C.JUMP_COST);
    if (!entry.energy) entry.exhausted = true;
    entry.jumps++;
    return true;
  }
  function rank(entry) {
    return entry.finishedAt !== null
      ? 10000000 - Math.round(entry.finishMs / 10)
      : Math.round(entry.progress * 1000);
  }
  function advance(entry, hurdles, startedAt, to) {
    if (entry.finishedAt !== null || to <= startedAt) return;
    let at = Math.max(startedAt, entry.updatedAt);
    while (at < to && entry.finishedAt === null) {
      if (entry.holding && at >= entry.sprintAt + C.HOLD_TTL) entry.holding = false;
      if (entry.exhausted && entry.energy >= C.RESUME_ENERGY) entry.exhausted = false;
      const airborne = at < entry.jumpUntil;
      const stumble = at < entry.stumbleUntil;
      entry.sprinting = entry.holding && !entry.exhausted && !stumble && entry.energy > 0;
      let end = Math.min(to, at + C.STEP_MS);
      // Split exactly at changes of motion. Delayed server ticks must neither
      // lengthen a jump nor turn a disconnected finger into unlimited sprint.
      for (const boundary of [entry.jumpUntil, entry.stumbleUntil,
        entry.holding ? entry.sprintAt + C.HOLD_TTL : 0]) {
        if (boundary > at) end = Math.min(end, boundary);
      }
      const rate = entry.sprinting ? -C.DRAIN : airborne ? 0 : C.RECOVER;
      const energyBoundary = rate < 0 ? entry.energy / -rate :
        rate > 0 && entry.exhausted ? (C.RESUME_ENERGY - entry.energy) / rate : Infinity;
      if (energyBoundary > 0.000001) end = Math.min(end, at + energyBoundary * 1000);
      let dt = (end - at) / 1000;
      const before = entry.progress;
      const target = stumble ? C.STUMBLE_SPEED : entry.sprinting ? C.SPRINT : C.JOG;
      const distanceAt = seconds => airborne && !stumble ? entry.jumpSpeed * seconds :
        target * seconds + (entry.speed - target) * C.ACCEL_TIME * (1 - Math.exp(-seconds / C.ACCEL_TIME));
      const hurdle = hurdles[entry.nextHurdle];
      const boundary = Math.min(C.LENGTH, hurdle?.at ?? C.LENGTH);
      const crossing = before < boundary && before + distanceAt(dt) >= boundary;
      if (crossing) {
        // Stop the integration at contact, then integrate the remainder with
        // the resulting state. Crossing late in a tick never buys free speed.
        let low = 0, high = dt;
        for (let i = 0; i < 24; i++) {
          const mid = (low + high) / 2;
          if (distanceAt(mid) < boundary - before) low = mid; else high = mid;
        }
        dt = high; end = at + dt * 1000;
      }
      const decay = Math.exp(-dt / C.ACCEL_TIME);
      const distance = distanceAt(dt);
      entry.speed = airborne && !stumble ? entry.jumpSpeed : target + (entry.speed - target) * decay;
      entry.progress = crossing ? boundary : Math.min(C.LENGTH, before + distance);
      entry.energy = Math.min(C.ENERGY, Math.max(0, entry.energy + rate * dt));
      if (entry.energy < 1e-8) { entry.energy = 0; entry.exhausted = true; }
      if (entry.exhausted && entry.energy >= C.RESUME_ENERGY - 1e-8) {
        entry.energy = Math.max(entry.energy, C.RESUME_ENERGY); entry.exhausted = false;
      }
      if (hurdle && before <= hurdle.at && entry.progress >= hurdle.at) {
        const crossAt = at + (end - at) * (hurdle.at - before) / Math.max(1e-9, distance);
        const clear = height(entry, crossAt) >= C.CLEARANCE;
        entry.nextHurdle++;
        entry.lastVerdict = { index: hurdle.index, at: crossAt, kind: clear ? 'clear' : 'hit' };
        if (clear) entry.cleared++;
        else {
          entry.stumbles++;
          entry.stumbleUntil = crossAt + C.STUMBLE_MS;
          entry.jumpAt = null; entry.jumpUntil = 0;
          entry.jumpReadyAt = entry.stumbleUntil;
          entry.speed = C.STUMBLE_SPEED;
          entry.flash = 'bad'; entry.lastHitAt = crossAt;
        }
      }
      if (entry.progress >= C.LENGTH) {
        entry.finishedAt = at + (end - at) * (C.LENGTH - before) / Math.max(1e-9, distance);
        entry.finishMs = Math.round((entry.finishedAt - startedAt) / 10) * 10;
        entry.holding = false; entry.sprinting = false;
        entry.flash = 'good'; entry.lastHitAt = entry.finishedAt;
      }
      at = end;
    }
    entry.updatedAt = to;
    entry.score = rank(entry);
  }
  // Predict the result of jumping now, using the actual take-off velocity.
  function jumpWindow(entry, hurdle) {
    if (!hurdle || entry.speed < 0.5) return false;
    const t = (hurdle.at - entry.progress) / entry.speed;
    return t > 0 && C.JUMP_V * t - C.GRAVITY * t * t / 2 >= C.CLEARANCE;
  }
  const api = Object.freeze({ C, AIR_MS, course, player, height, jump, rank, advance, jumpWindow });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TumblekinSprintPhysics = api;
})(globalThis);
