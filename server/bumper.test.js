const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../client/src/minigames/BumperPhysics.js');
const { testRules: r } = require('./server.js');
const START = 100000;
function arena() {
  const a = P.create([{id:'a'}, {id:'b'}], START);
  a.lastUpdateAt = START + 1000;
  for (const p of Object.values(a.players)) p.invulnUntil = 0;
  Object.assign(a.players.a, {x:-.35,y:0}); Object.assign(a.players.b,{x:.65,y:0});
  return a;
}
function run(a, ms, x=0, y=0, step=30) {
  const until = a.lastUpdateAt + ms;
  while(a.lastUpdateAt < until) {
    P.thrust(a.players.a,x,y,a.lastUpdateAt);
    P.advance(a,Math.min(until,a.lastUpdateAt+step));
  }
}
test('bumper: full joystick run-up ejects a target without an ability',()=>{
  const a=arena();run(a,1200,1,0);
  assert.ok(a.events.some(e=>e.kind==='hit' && e.attacker==='a'));
  assert.equal(a.players.b.lives,P.C.LIVES-1);assert.equal(a.players.a.knockouts,1);
  assert.ok(a.events.find(e=>e.kind==='fall').vx>0);
});
test('bumper: releasing the stick brakes within one ring radius',()=>{
  const a=arena();a.players.b.inPlay=false;
  run(a,350,1,0);const p=a.players.a,x=p.x;run(a,300);
  assert.ok(p.x-x<P.C.BALL_RADIUS);assert.ok(p.vx<.04);
});
test('bumper: diagonals cannot exceed straight joystick speed',()=>{
  const a=arena(),b=arena();a.players.b.inPlay=b.players.b.inPlay=false;
  run(a,250,1,0);run(b,250,1,1);
  assert.ok(Math.abs(Math.hypot(b.players.a.vx,b.players.a.vy)-a.players.a.vx)<1e-8);
});
test('bumper: reversing steers momentum rather than teleporting velocity',()=>{
  const a=arena();a.players.b.inPlay=false;run(a,250,1,0);
  P.thrust(a.players.a,-1,0,a.lastUpdateAt);P.advance(a,a.lastUpdateAt+8);
  assert.ok(a.players.a.vx>0);run(a,200,-1,0);assert.ok(a.players.a.vx<0);
});
test('bumper: stale joystick input brakes when its refresh expires',()=>{
  const a=arena();a.players.b.inPlay=false;
  P.thrust(a.players.a,1,0,a.lastUpdateAt);P.advance(a,a.lastUpdateAt+650);
  assert.ok(a.players.a.vx<.04);
});
test('bumper: resting and separating overlaps do not make hits or credit',()=>{
  const a=arena();Object.assign(a.players.a,{x:0,vx:-1});Object.assign(a.players.b,{x:.2,vx:1});
  P.collision(a,'a','b',START+1000);
  assert.equal(a.events.length,0);assert.equal(a.players.b.lastHitBy,null);
  assert.ok(Math.abs(a.players.b.x-a.players.a.x-.26)<1e-8);
});
test('bumper: head-on impact is symmetric and speed is bounded immediately',()=>{
  const a=arena();Object.assign(a.players.a,{x:-.1,vx:3.4});Object.assign(a.players.b,{x:.1,vx:-3.4});
  P.collision(a,'a','b',START+1000);
  assert.ok(Math.abs(a.players.a.vx+a.players.b.vx)<1e-8);
  assert.ok(a.players.a.vx<0);assert.ok(Math.abs(a.players.a.vx)<=P.C.MAX_SPEED);
});
test('bumper: shield contact remains solid without hit credit',()=>{
  const a=arena();Object.assign(a.players.a,{x:0,vx:2});Object.assign(a.players.b,{x:.2,invulnUntil:START+2000});
  P.collision(a,'a','b',START+1000);
  assert.equal(a.events[0].kind,'shield');assert.equal(a.players.b.vx,0);
  assert.equal(a.players.b.lastHitBy,null);assert.ok(a.players.a.vx<=0);
});
test('bumper: soft repeated resting contacts cannot spam hit events',()=>{
  const a=arena();Object.assign(a.players.a,{x:0,vx:1});Object.assign(a.players.b,{x:.2});
  P.collision(a,'a','b',START+1000);
  for(let i=0;i<20;i++)P.collision(a,'a','b',START+1000+i);
  assert.equal(a.events.length,1);
});
test('bumper: timed control at 30/60/120 Hz or delayed frames has the same knock-out',()=>{
  for(const step of [1000/30,1000/60,1000/120,180]) {
    const a=arena();run(a,1300,1,0,step);
    assert.equal(a.players.b.lives,P.C.LIVES-1,`step ${step}`);assert.equal(a.players.a.knockouts,1);
    for(const p of Object.values(a.players))assert.ok(Number.isFinite(p.x+p.y+p.vx+p.vy));
  }
});
test('bumper: countdown does not move and older snapshots cannot rewind the clock',()=>{
  const a=P.create([{id:'a'}],START);P.thrust(a.players.a,1,0,START-500);
  P.advance(a,START-100);assert.equal(a.players.a.x,Math.cos(-Math.PI/2)*.5);
  P.advance(a,START+100);P.advance(a,START);assert.equal(a.lastUpdateAt,START+100);
});
test('bumper: one fall is out in a match',()=>{
  assert.equal(P.C.LIVES,1);
  const a=arena(),p=a.players.a;Object.assign(p,{x:1.02,y:0,vx:1,vy:0});
  P.advance(a,a.lastUpdateAt+8);run(a,P.C.RESPAWN_MS+500);
  assert.equal(p.lives,0);assert.equal(p.inPlay,false);assert.ok(p.outAt);
});
// Mit mehr Leben (der Trainingsring der Übung) kommt man zurück.
test('bumper: falling costs exactly one life, preserves direction and resets input on respawn',()=>{
  const a=arena(),p=a.players.a;Object.assign(p,{lives:3,x:1.02,y:0,vx:1,vy:0,thrustX:1,lastThrustAt:a.lastUpdateAt});
  P.advance(a,a.lastUpdateAt+8);const at=p.knockedAt;
  assert.equal(p.lives,2);assert.ok(p.fall.vx>0);assert.equal(p.fall.vy,0);
  P.advance(a,at+P.C.RESPAWN_MS-1);assert.equal(p.inPlay,false);assert.equal(p.falls,1);
  P.advance(a,at+P.C.RESPAWN_MS+8);assert.equal(p.inPlay,true);
  assert.equal(p.thrustX,0);assert.equal(p.vx,0);assert.ok(p.invulnUntil>=at+P.C.RESPAWN_MS+P.C.INVULN_MS);
  assert.ok(Math.hypot(p.x,p.y)<a.radius*.5);
});
test('bumper: last life never respawns',()=>{
  const a=arena(),p=a.players.a;Object.assign(p,{x:1.02,lives:1});P.advance(a,a.lastUpdateAt+8);run(a,3000);
  assert.equal(p.lives,0);assert.equal(p.inPlay,false);assert.equal(p.falls,1);
});
test('bumper: expired hit credit does not award a self-inflicted fall',()=>{
  const a=arena();Object.assign(a.players.b,{x:1.02,lastHitBy:'a',lastHitAt:START-2000});
  P.advance(a,a.lastUpdateAt+8);assert.equal(a.players.a.knockouts,0);
});
test('bumper: protection does not act as an invisible wall at the pool edge',()=>{
  const a=arena();Object.assign(a.players.a,{x:1.02,invulnUntil:START+9000});P.advance(a,a.lastUpdateAt+8);
  assert.equal(a.players.a.lives,P.C.LIVES-1);
});
test('bumper: shrinking floor uses the actual edge, without secretly moving players',()=>{
  const a=arena();a.players.a.x=.85;a.players.b.inPlay=false;
  a.lastUpdateAt=a.shrinkFrom;P.advance(a,a.shrinkUntil);
  assert.equal(a.radius,P.C.SHRINK_TO);assert.ok(a.players.a.falls>0);
});
test('bumper: duration freezes motion and scoring at the exact end',()=>{
  const a=arena();P.advance(a,START+45000);const before=JSON.stringify(a);
  P.advance(a,START+90000);assert.equal(JSON.stringify(a),before);
});
test('bumper: server rejects separate dash, ram and jump actions',()=>{
  const a=arena(),room={currentMinigame:{type:'bounceArena',startedAt:START,duration:45000,arena:a}};
  const real=Date.now;Date.now=()=>START+1000;
  try{for(const action of ['ram','dash','jump','ability'])assert.equal(r.handleArenaInput(room,{id:'a'},{action}).ok,false);}finally{Date.now=real;}
});
test('bumper: huge and invalid network vectors stay finite and normalized',()=>{
  const a=arena(),room={currentMinigame:{type:'bounceArena',startedAt:START,duration:45000,arena:a}};
  const real=Date.now;Date.now=()=>START+1000;
  try{for(const input of [{x:1e308,y:1e308},{x:'bad',y:null},{x:Infinity,y:NaN}]) {
    assert.equal(r.handleArenaInput(room,{id:'a'},{action:'thrust',...input}).ok,true);
    assert.ok(Math.hypot(a.players.a.thrustX,a.players.a.thrustY)<=1.000001);
  }}finally{Date.now=real;}
});
test('bumper: one ring can produce two distinct hits in the same chain',()=>{
  const a=arena();a.players.c={...a.players.b,x:-.2,y:0,vx:1};
  Object.assign(a.players.a,{x:0,vx:1});Object.assign(a.players.b,{x:.2});
  P.collision(a,'a','b',START+1000);
  Object.assign(a.players.a,{x:0,vx:0});Object.assign(a.players.c,{x:-.2,vx:1});
  P.collision(a,'c','a',START+1000);
  assert.equal(a.events.filter(e=>e.kind==='hit').length,2);
  assert.equal(new Set(a.events.map(e=>e.id)).size,2);
});
test('bumper: two protected rings bounce without assigning knock-out credit',()=>{
  const a=arena();Object.assign(a.players.a,{x:-.1,vx:1,invulnUntil:START+2000});
  Object.assign(a.players.b,{x:.1,vx:-1,invulnUntil:START+2000});
  P.collision(a,'a','b',START+1000);
  assert.ok(a.players.a.vx<0 && a.players.b.vx>0);
  assert.equal(a.players.a.lastHitBy,null);assert.equal(a.players.b.lastHitBy,null);
});
function curvedRing(zigzag=false){
  const p=P.create([{id:'a'}],START).players.a;Object.assign(p,{x:0,y:0,vx:1.016,vy:-.709});
  for(let ms=0;ms<2200;ms+=8){const angle=zigzag?(Math.floor(ms/80)%2?-.65:.65):ms/1000*Math.PI;
    P.thrust(p,Math.cos(angle),Math.sin(angle),START+ms);P.motion(p,.008,START+ms);}
  return p;
}
test('bumper: a sustained moving arc builds charge and genuine extra velocity',()=>{
  const curved=curvedRing();assert.ok(curved.swing>.9);assert.ok(Math.hypot(curved.vx,curved.vy)>1.9);
  const straight=P.create([{id:'a'}],START).players.a;
  for(let ms=0;ms<2200;ms+=8){P.thrust(straight,1,0,START+ms);P.motion(straight,.008,START+ms);}
  assert.equal(straight.swing,0);assert.ok(Math.hypot(curved.vx,curved.vy)>straight.vx+.3);
});
test('bumper: short stick wiggles cannot build arc charge',()=>{assert.equal(curvedRing(true).swing,0);});
test('bumper: curved run-up launches the target farther and consumes charge',()=>{
  function impact(speed,swing){const a=arena();Object.assign(a.players.a,{x:0,y:0,vx:speed,vy:0,swing});Object.assign(a.players.b,{x:.25,y:0});P.collision(a,'a','b',START+1000);return a;}
  const p=curvedRing(),strong=impact(Math.hypot(p.vx,p.vy),p.swing),normal=impact(1.51,0);
  assert.ok(strong.players.b.vx>normal.players.b.vx+.3);assert.equal(strong.players.a.swing,0);
});
test('bumper: releasing brakes and clears curve charge, without permanent boost',()=>{
  const p=curvedRing();P.thrust(p,0,0,START+2200);
  for(let ms=2200;ms<3000;ms+=8)P.motion(p,.008,START+ms);
  assert.equal(p.swing,0);assert.ok(Math.hypot(p.vx,p.vy)<.001);
});
