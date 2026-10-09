const test = require('node:test');
const assert = require('node:assert/strict');
const {testRules:r} = require('./server');
const {boatSwingX} = require('./partyGames');
function round(type, fn) {
  const real = Date.now; let clock = 1000000; Date.now = () => clock;
  const players = ['a','b'].map(id => r.createPlayer({id,name:id,color:'#ff5d73'}));
  const tpl = r.MINIGAMES.find(g => g.type === type);
  const minigame = {id:'audit',type,startedAt:clock,duration:tpl.duration,scores:{},lastInputAt:{}};
  const arcade = minigame.arcade = r.createArcadeState(type, players, clock, {seed:39});
  const room = {code:'TEST',status:'minigame',phase:'playingMinigame',players,currentMinigame:minigame,timers:new Set()};
  const at = ms => { clock = minigame.startedAt + ms; };
  const input = (data, id=0) => r.handleArcadeInput(room, players[id], data);
  try { fn({at,input,room,arcade,entry:arcade.players.a,minigame,players}); }
  finally { r.clearRoomTimers(room); Date.now = real; }
}
test('Lichtwächter: Loslassen 10 ms nach dem Halteping wird sofort übernommen', () => round('lichtwaechter', ({at,input,entry}) => {
  at(2000); input({action:'run',hold:true}); at(2010); input({action:'run',hold:false}); assert.equal(entry.holding,false);
}));
test('Fassrolle: Loslassen hinter einem Ping beendet den Lauf ohne 220 ms Nachlauf', () => round('fassrolle', ({at,input,entry}) => {
  at(2000); input({action:'run',dir:-1}); at(2010); input({action:'run',hold:false}); assert.equal(entry.lastRunAt,0);
}));
test('Münzregen: ein Spurwechsel nach dem Fangzeitpunkt holt keine verpasste Münze', () => round('muenzregen', ({at,input,arcade,entry}) => {
  entry.lane=0; arcade.drops=[{id:1,kind:'coin',lane:1,catchAt:2000,processed:false}]; at(2001); input({action:'lane',dir:1});
  assert.equal(entry.lane,1); assert.equal(entry.catches,0); assert.equal(arcade.drops[0].processed,true);
}));
test('Münzregen: ein spätes Ausweichen entkommt keiner bereits gelandeten Bombe', () => round('muenzregen', ({at,input,arcade,entry}) => {
  entry.lane=0; entry.catches=10; arcade.drops=[{id:1,kind:'bomb',lane:0,catchAt:2000,processed:false}]; at(2001); input({action:'lane',dir:1}); assert.equal(entry.catches,9);
}));
test('Zündstoff: der bisherige Halter trägt die abgelaufene Bombe, nicht der Empfänger eines späten Passes', () => round('zuendstoff', ({at,input,arcade,entry}) => {
  arcade.holderId='a'; arcade.fuseAt=1002000; arcade.canPassAt=0; const lives=entry.lives; at(2001); input({action:'pass'});
  assert.equal(entry.lives,lives-1); assert.equal(arcade.lastBoomId,'a'); assert.equal(arcade.players.b.lives,lives);
}));
test('Turmbau: perfekte Blöcke rasten genau auf dem bestehenden Zentrum ein', () => round('turmbau', ({at,input,entry}) => {
  at(2000); entry.offset=Math.sin(2*1.1+entry.phase*Math.PI*2)*.85+.025; const offset=entry.offset; input({action:'drop'});
  assert.equal(entry.height,1); assert.equal(entry.offset,offset); assert.equal(entry.width,1); assert.equal(entry.layers[0].perfect,true);
}));
test('Turmbau: ältere Ebenen behalten Breite und Lage auch nach mehreren Setzungen zwischen Bildern', () => round('turmbau', ({at,input,entry}) => {
  for(let i=0;i<3;i++) { const t=2000+i*300; at(t); const h=entry.height; entry.offset=Math.sin(t/1000*(1.1+h*.06)+entry.phase*Math.PI*2)*(.85-h*.01)+.15; input({action:'drop'}); }
  assert.equal(entry.layers.length,3); assert.ok(Math.abs(entry.layers[0].width+entry.layers[0].cuts.reduce((sum,c)=>sum+c.width,0)-1)<1e-9,'Überstand und gesetztes Stück erhalten die gesamte Eingangsbreite'); assert.ok(entry.layers[0].width>entry.layers[2].width); assert.notEqual(entry.layers[0].offset,entry.layers[2].offset);
}));
test('Trampolin: ausgelassene Schläge brechen Resonanz, die Besthöhe bleibt gespeichert', () => round('trampolin', ({at,input,entry,room,minigame}) => {
  at(r.bounceBeatTime(1)); input({action:'jump'}); at(r.bounceBeatTime(2)); input({action:'jump'}); const best=entry.best;
  at(r.bounceBeatTime(3)+r.BOUNCE_GOOD_MS+1); r.updateArcade(room);
  assert.equal(entry.streak,0); assert.equal(entry.misses,1); assert.ok(entry.height<best); assert.equal(entry.best,best); assert.equal(entry.lastTap.skipped,true);
  at(r.bounceBeatTime(4)); input({action:'jump'}); assert.equal(entry.streak,1); assert.equal(entry.bestStreak,2);
}));
test('Trampolin: mehrere ausgefallene Schläge werden einmalig und unabhängig vom Servertakt abgeschlossen', () => {
  const play = stepped => {let result; round('trampolin', ({at,input,entry,room}) => {
    at(r.bounceBeatTime(1)); input({action:'jump'});
    for(const t of stepped ? [2000,3000,4000,5000] : [5000]) {at(t);r.updateArcade(room);}
    result={misses:entry.misses,height:entry.height,last:entry.lastBeatIndex}; r.updateArcade(room); assert.equal(entry.misses,result.misses);
  });return result;}; assert.deepEqual(play(false),play(true));
});
test('Honigwabe: eine Wahl nach Ablauf der Frist ändert nichts, die Auflösung kommt genau einmal', () => round('honigwabe', ({at,input,arcade,room}) => {
  at(1700); r.updateArcade(room); const step=arcade.honey.step; arcade.secret.deck=[{kind:'fruit',value:4},{kind:'fruit',value:4}]; arcade.honey.budsLeft=2;
  at(step.until+151); r.updateArcade(room); input({action:'home'},0); r.updateArcade(room);
  const [a,b]=Object.values(arcade.players); assert.equal(arcade.honey.picks,1); assert.equal(a.at,'tree'); assert.equal(a.basket,2); assert.equal(b.basket,2);
}));
test('Kippboot: ein verspäteter Abwurf fällt an der Deadline statt an der späteren Hakenposition', () => round('kippboot', ({at,input,arcade,room}) => {
  at(1600); r.updateArcade(room); const turn=arcade.boat.turn; const id=turn.playerId==='a'?0:1; const expected=Math.round(boatSwingX(turn,turn.until)*100)/100;
  at(turn.until+100); input({action:'drop'},id); assert.equal(arcade.boat.last.auto,true); assert.equal(arcade.boat.last.x,expected); assert.equal(arcade.boat.last.at,turn.until);
}));
