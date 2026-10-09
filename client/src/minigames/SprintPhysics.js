// One set of metres, seconds and jump equations for the rules and renderer.
// A plain script module also works in the isolated practice Worker (CommonJS).
(function (root) {
  const C = Object.freeze({
    LENGTH: 120, JOG: 5.4, SPRINT: 8.8, ACCEL_TIME: 0.25,
    ENERGY: 100, DRAIN: 30, RECOVER: 22, JUMP_COST: 0,
    JUMP_V: 5.3, GRAVITY: 13.8, REST_MS: 160,
    HURDLE_HEIGHT: 0.64, CLEARANCE: 0.74,
    STUMBLE_MS: 750, STUMBLE_SPEED: 1.9, HOLD_TTL: 420,
    RESUME_ENERGY: 30, STEP_MS: 10, LANES: 4, LANE_MS: 200, SLIDE_MS: 700,
    ROWS: 13, FIRST_ROW: 9, ROW_GAP: 8.6
  });
  const AIR_MS = 2000 * C.JUMP_V / C.GRAVITY;
  // Vier Spuren: in jeder Reihe ist mindestens eine ohne Kiste, und meist
  // gibt es mehr als einen Weg — springen, sliden oder ausweichen. Welche
  // Spur was bekommt, würfelt die Saat je Reihe neu.
  function course(seed) {
    const patterns = [['jump', null, 'block', 'slide'], ['slide', 'slide', 'slide', 'slide'],
      ['block', 'jump', 'jump', 'block'], ['jump', 'jump', 'jump', 'jump'],
      ['block', 'slide', null, 'block'], ['slide', 'block', 'jump', 'jump'],
      ['block', null, 'slide', 'jump']];
    return Array.from({ length: C.ROWS }, (_, index) => {
      const pattern = patterns[index % patterns.length];
      const hash = Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453;
      const rotation = Math.floor((hash - Math.floor(hash)) * C.LANES) % C.LANES;
      return { index, at: C.FIRST_ROW + index * C.ROW_GAP + Math.sin(seed * .73 + index * 17.31) * .18,
        lanes: pattern.map((_, lane) => pattern[(lane + rotation) % C.LANES]) };
    });
  }
  // Die nächste Spur ohne Kiste — bei gleichem Weg lieber eine ganz freie.
  function escapeLane(row, from) {
    let best = null;
    (row?.lanes || []).forEach((kind, lane) => {
      if (kind === 'block') return;
      const cost = Math.abs(lane - from) * 2 + (kind ? 1 : 0);
      if (best === null || cost < best.cost) best = { lane, cost };
    });
    return best ? best.lane : from;
  }
  function player(lane, startedAt) {
    lane = Math.max(0, Math.min(C.LANES - 1, lane % C.LANES));
    return { lane, laneFrom: lane, laneAt: startedAt, laneUntil: startedAt,
      slideAt: null, slideUntil: 0, slideReadyAt: 0, slides: 0,
      diveAt: 0, diveUntil: 0, diveHeight: 0, progress: 0, speed: 0, energy: C.ENERGY, holding: false,
      sprintAt: 0, sprinting: false, exhausted: false, jumpAt: null,
      jumpUntil: 0, jumpReadyAt: 0, jumpSpeed: 0, stumbleUntil: 0,
      nextHurdle: 0, cleared: 0, stumbles: 0, jumps: 0,
      finishedAt: null, finishMs: null, updatedAt: startedAt, lastVerdict: null };
  }
  function height(entry, now) {
    if (now >= entry.diveAt && now < entry.diveUntil) return Math.max(0, entry.diveHeight * (1 - (now - entry.diveAt) / (entry.diveUntil - entry.diveAt)));
    if (entry.jumpAt === null || now < entry.jumpAt || now >= entry.jumpUntil) return 0;
    const t = (now - entry.jumpAt) / 1000;
    return Math.max(0, C.JUMP_V * t - C.GRAVITY * t * t / 2);
  }
  function jump(entry, now) {
    if (entry.finishedAt !== null || now < entry.jumpReadyAt || now < entry.stumbleUntil) return false;
    entry.slideUntil = 0; entry.diveUntil = 0;
    entry.jumpAt = now;
    entry.jumpUntil = now + AIR_MS;
    entry.jumpReadyAt = entry.jumpUntil + C.REST_MS;
    entry.jumpSpeed = entry.speed;
    entry.energy = Math.max(0, entry.energy - C.JUMP_COST);
    if (!entry.energy) entry.exhausted = true;
    entry.jumps++;
    return true;
  }
  function lanePosition(entry, now) {
    if (now >= entry.laneUntil) return entry.lane;
    const u = Math.max(0, Math.min(1, (now - entry.laneAt) / C.LANE_MS));
    return entry.laneFrom + (entry.lane - entry.laneFrom) * u * u * (3 - 2 * u);
  }
  function changeLane(entry, dir, now) {
    if (![1, -1].includes(dir) || entry.finishedAt !== null || now < entry.laneUntil) return false;
    const target = Math.max(0, Math.min(C.LANES - 1, entry.lane + dir));
    if (target === entry.lane) return false;
    entry.laneFrom = lanePosition(entry, now); entry.lane = target;
    entry.laneAt = now; entry.laneUntil = now + C.LANE_MS;
    return true;
  }
  function slide(entry, now) {
    if (entry.finishedAt !== null || now < entry.slideReadyAt || now < entry.stumbleUntil) return false;
    const lift = height(entry, now);
    entry.slideAt = now; entry.slideUntil = now + C.SLIDE_MS;
    entry.slideReadyAt = entry.slideUntil + 120; entry.slides++;
    if (lift > .01) {
      entry.diveAt = now; entry.diveHeight = lift; entry.diveUntil = now + 120;
      entry.jumpAt = null; entry.jumpUntil = entry.diveUntil;
      entry.jumpReadyAt = entry.diveUntil + 120;
    }
    return true;
  }
  function slideFactor(entry, now) {
    if (entry.slideAt === null) return 0;
    return Math.max(0, Math.min(1, (now - entry.slideAt) / 60, (entry.slideUntil - now) / 60));
  }
  function obstacle(entry, row, now) {
    if (!row) return null;
    const lanes = row.lanes || Array(C.LANES).fill('jump');
    const position = lanePosition(entry, now);
    const touching = lanes.filter((kind, lane) => kind && Math.abs(position - lane) < .55);
    const lift = height(entry, now);
    return touching.find(kind => kind === 'block' || kind === 'jump' && lift < C.CLEARANCE ||
      kind === 'slide' && !(slideFactor(entry, now) >= .85 && lift < .16)) || null;
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
      const rate = entry.sprinting ? -C.DRAIN : airborne || entry.holding ? 0 : C.RECOVER;
      const energyBoundary = rate < 0 ? entry.energy / -rate :
        rate > 0 && entry.exhausted ? (C.RESUME_ENERGY - entry.energy) / rate : Infinity;
      if (energyBoundary > 0.000001) end = Math.min(end, at + energyBoundary * 1000);
      let dt = (end - at) / 1000;
      const before = entry.progress;
      const target = stumble ? C.STUMBLE_SPEED : entry.sprinting ? C.SPRINT : C.JOG;
      const distanceAt = seconds => airborne && !stumble && !entry.exhausted ? entry.jumpSpeed * seconds :
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
      entry.speed = airborne && !stumble && !entry.exhausted ? entry.jumpSpeed : target + (entry.speed - target) * decay;
      entry.progress = crossing ? boundary : Math.min(C.LENGTH, before + distance);
      entry.energy = Math.min(C.ENERGY, Math.max(0, entry.energy + rate * dt));
      if (entry.energy < 1e-8) { entry.energy = 0; entry.exhausted = true; }
      if (entry.exhausted && entry.energy >= C.RESUME_ENERGY - 1e-8) {
        entry.energy = Math.max(entry.energy, C.RESUME_ENERGY); entry.exhausted = false;
      }
      if (hurdle && before <= hurdle.at && entry.progress >= hurdle.at) {
        const crossAt = at + (end - at) * (hurdle.at - before) / Math.max(1e-9, distance);
        const collision = obstacle(entry, hurdle, crossAt);
        const clear = !collision;
        entry.nextHurdle++;
        entry.lastVerdict = { index: hurdle.index, at: crossAt, kind: clear ? 'clear' : 'hit', obstacle: collision };
        if (clear) entry.cleared++;
        else {
          entry.stumbles++;
          entry.stumbleUntil = crossAt + C.STUMBLE_MS;
          entry.jumpAt = null; entry.jumpUntil = 0; entry.diveUntil = 0; entry.slideUntil = 0;
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
  const api = Object.freeze({ C, AIR_MS, course, escapeLane, player, height, jump, slide, slideFactor, changeLane, lanePosition, obstacle, rank, advance, jumpWindow });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TumblekinSprintPhysics = api;
})(globalThis);
