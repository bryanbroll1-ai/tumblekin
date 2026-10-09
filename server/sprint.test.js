const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../client/src/minigames/SprintPhysics');
const { testRules: rules } = require('./server');
const START = 100000;
function entry() { return P.player(0, START); }
function advance(e, ms, hurdles = []) { P.advance(e, hurdles, START, START + ms); }
function withClock(ms, fn) {
  const old = Date.now; Date.now = () => START + ms;
  try { return fn(); } finally { Date.now = old; }
}
function room(count = 2) {
  const players = Array.from({ length: count }, (_, i) => rules.createPlayer({ id: `p${i}`, name: `P${i}` }));
  const game = { type: 'finishRush', id: 'test', startedAt: START, duration: 32000, scores: {},
    arcade: rules.createArcadeState('finishRush', players, START) };
  return { players, currentMinigame: game, timers: new Set() };
}

test('sprint: four shared lanes and equal, reachable obstacle course at every table size', () => {
  assert.equal(P.C.LANES, 4); assert.equal(P.C.LENGTH, 120);
  for (const count of [1, 2, 3, 4]) {
    const r = room(count), a = r.currentMinigame.arcade;
    assert.equal(a.trackLength, P.C.LENGTH);
    assert.ok(Object.values(a.players).every(p=>p.lane>=0 && p.lane<P.C.LANES));
    // Bei vier Spielern startet jeder auf seiner eigenen Spur.
    assert.equal(new Set(Object.values(a.players).map(p=>p.lane)).size, count);
    assert.equal(a.segments, undefined);
    assert.equal(a.hurdles.length, P.C.ROWS);
    assert.ok(a.hurdles.every(row=>row.lanes.length===P.C.LANES && !row.lanes.every(kind=>kind==='block')));
    assert.ok(a.hurdles.at(-1).at < P.C.LENGTH - 5);
    for (let i = 1; i < a.hurdles.length; i++) assert.ok(a.hurdles[i].at - a.hurdles[i - 1].at > P.C.SPRINT * (P.AIR_MS + P.C.REST_MS) / 1000);
  }
  assert.deepEqual(P.course(77), P.course(77));
  assert.notDeepEqual(P.course(77), P.course(78));
});

test('sprint: countdown consumes neither distance nor stamina and rejects an early jump', () => {
  const r = room(), e = r.currentMinigame.arcade.players.p0;
  withClock(-300, () => rules.handleArcadeInput(r, r.players[0], { action: 'jump' }));
  withClock(-200, () => rules.updateArcade(r));
  assert.equal(e.progress, 0); assert.equal(e.energy, 100); assert.equal(e.jumps, 0);
});

test('sprint: held button gains speed, release immediately recovers energy', () => {
  const r = room(), e = r.currentMinigame.arcade.players.p0;
  r.currentMinigame.arcade.hurdles = [];
  for (let ms = 0; ms <= 1200; ms += 120) withClock(ms, () => rules.handleArcadeInput(r, r.players[0], { action: 'sprint', hold: true }));
  assert.ok(e.speed > 7.5); assert.ok(e.energy < 65);
  withClock(1201, () => rules.handleArcadeInput(r, r.players[0], { action: 'sprint', hold: false }));
  const energy = e.energy, speed = e.speed;
  withClock(1300, () => rules.updateArcade(r));
  assert.equal(e.holding, false); assert.ok(e.energy > energy); assert.ok(e.speed < speed - 0.5);
});

test('sprint: missing heartbeat releases hold at the deadline even across a long tick', () => {
  const e = entry(); e.holding = true; e.sprintAt = START;
  advance(e, 1500);
  assert.equal(e.holding, false); assert.ok(e.energy > 95); assert.ok(e.speed < P.C.JOG + 0.2);
});

test('sprint: depleted held sprint stays empty until release, and never blocks jumping', () => {
  const e = entry();e.energy=0;e.exhausted=true;
  assert.equal(P.jump(e,START),true);
  for(let ms=0;ms<2000;ms+=100){advance(e,ms);e.holding=true;e.sprintAt=START+ms;}
  assert.equal(e.energy,0);assert.equal(e.sprinting,false);assert.equal(e.exhausted,true);
  e.holding=false;advance(e,3500);assert.ok(e.energy>=30);assert.equal(e.exhausted,false);
});

test('sprint: take-off keeps horizontal momentum and parabola ends on the ground', () => {
  const e = entry(); e.speed = 7.8;
  assert.ok(P.jump(e, START));
  advance(e, 400);
  assert.ok(Math.abs(e.progress - 7.8 * .4) < .00001);
  assert.ok(P.height(e, START + 380) > 1);
  assert.equal(P.height(e, START + P.AIR_MS), 0);
  assert.equal(P.height(e, START - 1), 0);
});

test('sprint: repeated taps cannot extend a jump or spend additional stamina', () => {
  const e = entry(); P.jump(e, START);
  const until = e.jumpUntil, energy = e.energy;
  assert.equal(P.jump(e, START + 100), false);
  assert.equal(P.jump(e, until + 100), false);
  assert.equal(e.jumpUntil, until); assert.equal(e.energy, energy);
  assert.equal(P.jump(e, until + P.C.REST_MS), true);
});

function crossing(leadMs) {
  const e = entry(); e.speed = P.C.JOG;
  const hurdle = { index: 0, at: P.C.JOG * .6 };
  advance(e, 600 - leadMs, [hurdle]);
  P.jump(e, START + 600 - leadMs);
  advance(e, 620, [hurdle]);
  return e;
}
test('sprint: crossing at sufficient height clears the hurdle; early and late jumps hit', () => {
  assert.equal(crossing(380).cleared, 1);
  for (const lead of [30, 730]) {
    // Early take-off before the start is represented directly at its time.
    const e = lead === 730 ? (() => { const p = entry(); p.speed = 4.4; P.jump(p, START - 130); advance(p, 620, [{ index: 0, at: 2.64 }]); return p; })() : crossing(lead);
    assert.equal(e.stumbles, 1); assert.equal(e.cleared, 0);
  }
});

test('sprint: the same hurdle hits once and blocks jumping during recovery', () => {
  const e = entry(); e.speed = 4.4;
  advance(e, 300, [{ index: 0, at: 1 }]);
  assert.equal(e.stumbles, 1);
  assert.equal(P.jump(e, START + 300), false);
  advance(e, 2000, [{ index: 0, at: 1 }]);
  assert.equal(e.stumbles, 1); assert.equal(e.nextHurdle, 1);
});

test('sprint: late server input cannot clear a hurdle that was crossed before the tap', () => {
  const r = room(), e = r.currentMinigame.arcade.players.p0;
  r.currentMinigame.arcade.hurdles = [{ index: 0, at: 1 }]; e.speed = 4.4;
  withClock(400, () => rules.handleArcadeInput(r, r.players[0], { action: 'jump' }));
  assert.equal(e.stumbles, 1); assert.equal(e.jumps, 0);
});

test('sprint: invalid lane switches, attacks and non-boolean holds do not change the race', () => {
  const r = room(), e = r.currentMinigame.arcade.players.p0;
  for (const input of [{ action: 'lane', dir: 9 }, { action: 'attack' }, { action: 'sprint', hold: 'true' }, null]) {
    withClock(0, () => assert.equal(rules.handleArcadeInput(r, r.players[0], input).ok, false));
  }
  assert.equal(e.lane, 0); assert.equal(e.holding, false); assert.equal(e.progress, 0);
});

test('sprint: same inputs produce the same race at 30/60/120 Hz and with delayed ticks', () => {
  function race(period) {
    const e = entry(), hurdles = P.course(367);
    const events = [];
    for (let ms = 0; ms <= 30000; ms += 120) events.push({ ms, hold: ms % 4000 < 1700 });
    for (let ms = 1800; ms < 26000; ms += 2100) events.push({ ms, jump: true });
    for (let ms = period; ms < 32000; ms += period) events.push({ ms });
    events.sort((a, b) => a.ms - b.ms);
    for (const evt of events) {
      advance(e, evt.ms, hurdles);
      if (e.finishedAt !== null) break;
      if (evt.jump) P.jump(e, START + evt.ms);
      if (evt.hold !== undefined) { e.holding = evt.hold; e.sprintAt = START + evt.ms; }
    }
    advance(e, 32000, hurdles); return e;
  }
  const base = race(30);
  for (const period of [1000/30, 1000/60, 1000/120, 180, 550]) {
    const e = race(period);
    assert.equal(e.cleared, base.cleared); assert.equal(e.stumbles, base.stumbles);
    assert.ok(Math.abs(e.finishMs - base.finishMs) <= 20, `${period} ms: ${e.finishMs} vs ${base.finishMs}`);
  }
});

test('sprint: even an idle player finishes the complete course within the limit', () => {
  const e = entry(); advance(e, 32000, P.course(367));
  assert.equal(e.progress, P.C.LENGTH); assert.ok(e.stumbles > 0); assert.ok(e.finishMs < 32000);
});

test('sprint: exact finish crossing outranks progress, visible equal times share the rank', () => {
  const e = entry(); e.progress = P.C.LENGTH - 0.5; e.speed = 4.4; e.updatedAt = START + 1000;
  advance(e, 1400);
  assert.ok(e.finishedAt < START + 1200); assert.ok(e.finishMs < 1200);
  assert.ok(P.rank(e) > P.rank({ finishedAt: null, progress: P.C.LENGTH - 0.001 }));
  assert.equal(P.rank({ finishedAt: 1, finishMs: 17031 }), P.rank({ finishedAt: 1, finishMs: 17034 }));
});

test('sprint: a finished player cannot spend energy or jump again', () => {
  const r = room(), e = r.currentMinigame.arcade.players.p0;
  e.finishedAt = START + 10000; e.finishMs = 10000;
  const energy = e.energy;
  withClock(10001, () => {
    rules.handleArcadeInput(r, r.players[0], { action: 'jump' });
    rules.handleArcadeInput(r, r.players[0], { action: 'sprint', hold: true });
  });
  assert.equal(e.jumps, 0); assert.equal(e.energy, energy); assert.equal(e.holding, false);
});

// Epoch timestamps have coarser floating-point precision than a test clock.
test('sprint: exhaustion and recovery progress at real epoch timestamps without a zero-length step', () => {
  const start = 1780000000000;
  const e = P.player(0, start);
  for (let ms = 0; ms < 32000 && e.finishedAt === null; ms += 137) {
    P.advance(e, P.course(44), start, start + ms);
    e.holding = true; e.sprintAt = start + ms;
  }
  assert.equal(e.progress, P.C.LENGTH);
  assert.ok(e.energy >= 0 && e.energy <= 100);
  assert.ok(e.finishMs < 32000);
});

test('sprint: releasing during flight does not regenerate stamina in mid-air', () => {
  const e = entry(); e.energy = 50; e.speed = 7.8;
  P.jump(e, START);
  const energy = e.energy;
  advance(e, 700); assert.equal(e.energy, energy);
  advance(e, 1100); assert.ok(e.energy > energy);
});

test('sprint: properly timed jumps and pacing beat permanent sprint and jump spam', () => {
  function race(seed, mode) {
    const e = entry(), hurdles = P.course(seed);
    for (let ms = 0; ms < 32000 && e.finishedAt === null; ms += 10) {
      advance(e, ms, hurdles);
      e.holding = mode !== 'timed' || (e.energy > 24 && !e.exhausted);
      e.sprintAt = START + ms;
      const row=hurdles[e.nextHurdle],kind=row?.lanes[e.lane],arrival=row?(row.at-e.progress)/Math.max(1,e.speed):Infinity;
      if(mode==='spam')P.jump(e,START+ms);
      if(mode==='timed' && kind==='jump' && P.jumpWindow(e,row))P.jump(e,START+ms);
      if(mode==='timed' && kind==='slide' && arrival<.42 && arrival>.1)P.slide(e,START+ms);
      if(mode==='timed' && kind==='block' && arrival<.8)P.changeLane(e,Math.sign(P.escapeLane(row,e.lane)-e.lane),START+ms);
    }
    return e;
  }
  for (const seed of [37, 367, 509, 1203]) {
    const timed = race(seed, 'timed');
    assert.equal(timed.cleared, P.C.ROWS); assert.equal(timed.stumbles, 0);
    assert.ok(timed.finishMs < race(seed, 'sprint').finishMs);
    assert.ok(timed.finishMs < race(seed, 'spam').finishMs);
  }
});
test('sprint: a lane swipe animates across the real collision lanes',()=>{
  const e=entry();e.speed=4.4;assert.ok(P.changeLane(e,1,START));
  assert.ok(P.lanePosition(e,START+100)>.49 && P.lanePosition(e,START+100)<.51);
  assert.equal(P.changeLane(e,1,START+100),false);
  assert.equal(P.obstacle(e,{lanes:['block',null,null]},START+100),'block');
  assert.equal(P.obstacle(e,{lanes:['block',null,null]},START+200),null);
  assert.ok(P.changeLane(e,1,START+200));assert.equal(e.lane,2);
  assert.ok(P.changeLane(e,1,START+400));assert.equal(e.lane,3);
  assert.equal(P.changeLane(e,1,START+600),false);assert.equal(e.lane,3);
});
test('sprint: only a timed slide clears an overhead gate',()=>{
  const row={index:0,at:2.64,lanes:['slide','slide','slide']};
  const good=entry();good.speed=4.4;advance(good,300,[row]);P.slide(good,START+300);advance(good,650,[row]);
  assert.equal(good.cleared,1);assert.equal(good.stumbles,0);
  const standing=entry();standing.speed=4.4;advance(standing,650,[row]);assert.equal(standing.stumbles,1);
  const late=entry();late.speed=4.4;advance(late,590,[row]);P.slide(late,START+590);advance(late,650,[row]);assert.equal(late.stumbles,1);
});
test('sprint: downward swipe in the air descends continuously before crouching',()=>{
  const e=entry();e.speed=7.8;P.jump(e,START);advance(e,300);
  const before=P.height(e,START+300);assert.ok(before>.9);P.slide(e,START+300);
  assert.equal(P.height(e,START+300),before);assert.ok(P.height(e,START+360)<before*.51);
  assert.equal(P.height(e,START+420),0);assert.equal(P.slideFactor(e,START+430),1);
});
test('sprint: jumping cannot clear the tall crate; changing to its empty lane can',()=>{
  const row={index:0,at:2.64,lanes:['block',null,'jump']};
  const jump=entry();jump.speed=4.4;P.jump(jump,START+200);advance(jump,650,[row]);assert.equal(jump.stumbles,1);
  const lane=entry();lane.speed=4.4;P.changeLane(lane,1,START+200);advance(lane,650,[row]);assert.equal(lane.cleared,1);
});
test('sprint: slide and lateral changes do not spend sprint stamina',()=>{
  const e=entry();P.slide(e,START);P.changeLane(e,1,START);assert.equal(e.energy,100);
});
test('sprint: jumping with an empty held sprint cannot preserve free sprint speed',()=>{
 const e=entry();e.energy=0;e.exhausted=true;e.speed=7.8;e.holding=true;e.sprintAt=START;
 P.jump(e,START);advance(e,400);assert.ok(e.speed<P.C.JOG+.6);assert.equal(e.energy,0);
});
test('sprint: a collision slows the runner but still permits steering away',()=>{
 const e=entry();e.stumbleUntil=START+750;
 assert.equal(P.changeLane(e,1,START),true);assert.equal(P.jump(e,START),false);
});
