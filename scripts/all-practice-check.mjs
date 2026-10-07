// Every scene in its real isolated practice Worker, driven through its visible
// controls. The waiting party must remain unchanged throughout.
import assert from 'node:assert/strict';
import {launchBrowser,startServer,openRoom,request,backToLobby,watchErrors,pickGames} from './lib/harness.mjs';
const games=pickGames(process.argv.slice(2));
const server=await startServer({log:true}), browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
await page.addInitScript(()=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>4});Object.defineProperty(navigator,'deviceMemory',{get:()=>2});});
const errors=watchErrors(page), cdp=await page.context().newCDPSession(page);
const state=()=>page.evaluate(()=>window.__tumblekin.ui.practice.state.currentMinigame);
const party=()=>page.evaluate(()=>JSON.stringify(window.__tumblekin.state()));
const wait=expression=>page.waitForFunction(expression=>{
  const session=window.__tumblekin.ui.practice,s=session.scene,a=session.state?.currentMinigame?.arcade,p=a?.players.practice;
  return s&&new Function('s','a','p','g','return '+expression)(s,a,p,session.state.currentMinigame);
},expression,{timeout:45000});
const read=expression=>page.evaluate(expression=>{
  const session=window.__tumblekin.ui.practice,s=session.scene,a=session.state.currentMinigame.arcade,p=a?.players.practice;
  return new Function('s','a','p','g','return '+expression)(s,a,p,session.state.currentMinigame);
},expression);
const tap=selector=>page.locator('.practice-layer '+selector).tap();
async function touch(type,x,y) {await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});}
async function drag(x,y,dx,dy){await touch('touchStart',x,y);for(let n=1;n<=5;n++){await touch('touchMove',x+dx*n/5,y+dy*n/5);await page.waitForTimeout(20);}await touch('touchEnd');}
async function center(selector){const box=await page.locator('.practice-layer '+selector).boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2};}
async function canvasTap(){const c=await center('canvas.kinetic-webgl');await touch('touchStart',c.x,c.y);await touch('touchEnd');}
async function held(selector,condition,release){const c=await center(selector);await touch('touchStart',c.x,c.y);await wait(condition);await touch('touchEnd');if(release)await wait(release);}
async function stick(){const c=await center('.virtual-joystick');await touch('touchStart',c.x,c.y);await touch('touchMove',c.x+30,c.y);await wait('(p?.dirX||p?.inX||g.arena?.players.practice.thrustX||0)>0');await page.waitForTimeout(250);await touch('touchEnd');await wait('s.joystick.vecX===0 && s.joystick.timer===null && !(p?.dirX||p?.inX||g.arena?.players.practice.thrustX)');}
async function projected(kind){return page.evaluate(async kind=>{
 const session=window.__tumblekin.ui.practice,s=session.scene;const THREE=await import('/vendor/three/three.module.js');const v=new THREE.Vector3();
 if(kind==='blob'){const b=[...s.blobs.values()].find(b=>b.userData.up&&!b.userData.whacked);if(!b)return null;b.userData.hitbox.getWorldPosition(v);}
 if(kind==='seek')s.hitTargets[0].getWorldPosition(v);
 if(kind==='face')s.handleWorld(s.masks.get(s.own),0,s.localShape,v);
 return s.rig.toScreen(v);
 },kind);}
async function act(type){
 const button={nervenprobe:['[data-nerve-stop]','p.stoppedMs!==null'],ballonPump:['[data-pump]','p.pumps>0'],fassmut:['[data-dare-brake]','p.brakeAt!==null'],kanonenflug:['[data-cannon-launch]','Boolean(p.powerAt)'],messerwurf:['[data-knife-throw]','p.throws>0'],turmbau:['[data-stack-drop]','p.hasMoved'],trampolin:['[data-bounce-jump]','p.lastTap!==null'],falschsignal:['[data-signal-react]','p.lastReact!==null'],tauziehen:['[data-tug-pull]','p.taps>0'],flaggenhoch:['[data-flag="red"]','p.raised!==null'],honigwabe:['[data-honey-take="1"]','p.picks>0'],kippboot:['[data-boat-drop]','p.drops>0']};
 if(button[type]){
  if(type==='fassmut')await wait('Date.now()>=g.startedAt+a.leadIn && !s.brakeButton?.disabled');
  if(type==='tauziehen')await wait('a.tug.phase==="pull"');
  if(type==='honigwabe')await wait('a.honey.turn?.playerId==="practice" && Date.now()-g.startedAt>=a.honey.turn.from');
  if(type==='kippboot')await wait('a.boat.turn?.playerId==="practice" && Date.now()-g.startedAt>=a.boat.turn.from');
  await tap(button[type][0]);await wait(button[type][1]);return;
 }
 if(['bounceArena','tiefenrausch','farbenjagd','schneeball','luftpuck','buecherwurm','schnappschuss'].includes(type)){await stick();return;}
 if(type==='finishRush'){await drag(190,400,-50,0);await wait('p.lane===0');await drag(190,400,0,-65);await wait('p.jumps>0');return;}
 if(type==='colorEscape'){const dir=await read('(()=>{const dirs=[[1,0],[-1,0],[0,1],[0,-1]];return dirs.find(([x,y])=>p.gx+x>=0&&p.gx+x<5&&p.gy+y>=0&&p.gy+y<8&&!Object.values(a.players).some(q=>q!==p&&!q.eliminated&&q.gx===p.gx+x&&q.gy===p.gy+y));})()');assert.ok(dir);await drag(190,400,dir[0]*60,dir[1]*60);await wait('p.lastStepAt>g.startedAt');assert.equal(await read('s.tiles.filter(t=>t.userData.symbol.visible).length'),40);return;}
 if(type==='lichtwaechter'){await held('[data-hold-run]','p.holding','!p.holding');return;}
 if(type==='fassrolle'){await held('[data-barrel-run="-1"]','p.lastRunAt>g.startedAt','p.lastRunAt===0');return;}
 if(type==='zuendstoff'){await wait('a.holderId==="practice" && Date.now()>=a.canPassAt');await tap('[data-bomb-pass]');await wait('p.passes>0');return;}
 if(type==='muenzregen'){const before=await read('p.lane');await drag(190,400,before===2?-55:55,0);await wait('p.lane!=='+before);const edge=await read('p.lane');await drag(190,400,edge===2?-110:110,0);await wait('p.lane==='+ (edge===2?0:2)+' && !s.laneInFlight && !s.laneQueue.length');return;}
 if(type==='blobklopfe'){await wait('[...s.blobs.values()].some(b=>b.userData.up&&!b.userData.whacked)');const c=await projected('blob');await touch('touchStart',c.x,c.y);await touch('touchEnd');await wait('p.lastWhack!=null');return;}
 if(type==='seilspringen'){await tap('[data-rope-jump]');await wait('p.jumpUntil>Date.now()');return;}
 if(type==='bergsteiger'){const side=await read('p.nextSide');await touch('touchStart',side<0?80:310,400);await touch('touchEnd');await wait('p.rung>0');return;}
 if(type==='ballonfahrt'){await held('canvas.kinetic-webgl','p.holding','!p.holding');await tap('[data-glide-drop]');await wait('p.bags.length===1');return;}
 if(type==='spurmaler'){const before=await read('p.targetX');await drag(190,400,60,0);await wait('p.targetX>'+before);return;}
 if(type==='sortierband'){
  await wait('s.reachableNow');const before=await read('({sorted:p.sorted,wrong:p.wrong})');await drag(190,400,0,-65);assert.deepEqual(await read('({sorted:p.sorted,wrong:p.wrong})'),before,'upward swipe must not sort right');await wait('s.reachableNow');
  const chute=await read('s.layout.indexOf(s.displayQueue[0].colour)');await drag(190,400,chute===1?0:chute===0?-70:70,chute===1?70:0);await wait('p.sorted>0');return;
 }
 if(type==='angelduell'){await held('[data-fish-reel]','p.lastReelAt>g.startedAt','p.lastReelAt===0');return;}
 if(type==='leuchtfolge'){await wait('!s.controls.querySelector("button").disabled');const index=await read('a.rounds.find(r=>Date.now()-g.startedAt>=r.inputFrom && Date.now()-g.startedAt<r.until)?.sequence[0] ?? a.rounds[0].sequence[0]');await tap('[data-memory-pad="'+index+'"]');await wait('p.roundProgress>0');return;}
 if(type==='blitzreflex'){await canvasTap();await wait('p.times.length>0');return;}
 if(type==='nagelbrett'){await canvasTap();await wait('p.ballsLeft===4');return;}
 if(type==='eisstock'){await page.waitForTimeout(650);await drag(195,650,0,-210);await wait('p.stonesLeft===2');return;}
 if(type==='spuersinn'){const c=await projected('seek');await touch('touchStart',c.x,c.y);await touch('touchEnd');await wait('p.totalProbes>0');return;}
 if(type==='augenmass'){await wait('s.guessOpen');await page.locator('.practice-layer input[type="range"]').focus();await page.keyboard.press('ArrowRight');await wait('p.hasMoved');return;}
 if(type==='grimassen'){await wait('s.canShape()');const c=await projected('face');await drag(c.x,c.y,35,-20);await wait('p.shape.some(v=>Math.abs(v)>.05)');return;}
 if(type==='rohrsalat'){await wait('s.buttonRow.querySelector("button:not(:disabled)")');await tap('[data-valve="0"]');await wait('p.picked.some(Boolean)');return;}
 throw new Error('Missing action '+type);
}
try{
 await openRoom(page,server.base,{name:'Alle Spiele'});
 for(const type of games){
  console.log('Prüfe '+type);
  await request(page,'selectMode',{mode:'single'});await request(page,'updateSettings',{settings:{single:type}});await request(page,'startGame');
  // Erst vergleichen, wenn die Startkarte beim Gerät angekommen ist — direkt
  // nach startGame stand hier gelegentlich noch die Lobby.
  await page.waitForFunction(()=>window.__tumblekin.state()?.phase==='waitingReady',null,{timeout:15000});
  const original=await party();await page.click('#intro-practice');await wait('s.webglCanvas && !document.querySelector("[data-practice-retry]").disabled && Date.now()>=g.startedAt');
  await act(type);assert.equal(await party(),original,type+': practice must not change the party');
  if(['lichtwaechter','turmbau','farbenjagd','honigwabe','grimassen','rohrsalat'].includes(type)){
   const before=(await state()).id;await page.click('[data-practice-retry]');await wait('g.id!=='+JSON.stringify(before)+' && !document.querySelector("[data-practice-retry]").disabled');assert.equal(await party(),original);
  }
  await page.click('[data-practice-close]');assert.equal(await page.locator('.practice-layer').count(),0);assert.equal(await page.evaluate(()=>window.__tumblekin.ui.practice.scene),null);assert.equal(await party(),original);
  console.log('✓ '+type+' · echte Eingabe, lokale Regelwirkung, Partie unverändert, sauber geschlossen');await backToLobby(page);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(server.errorOutput,[]);console.log(games.length+' Übungen bestanden, keine Browserfehler');
}catch(error){console.error(JSON.stringify({errors,toast:await page.locator('#toast').textContent(),practice:await page.evaluate(()=>({active:window.__tumblekin.ui.practice.active,type:window.__tumblekin.ui.practice.type,scene:window.__tumblekin.ui.practice.scene?.constructor.name,canvas:!!window.__tumblekin.ui.practice.scene?.webglCanvas,retry:document.querySelector("[data-practice-retry]")?.disabled,now:Date.now(),started:window.__tumblekin.ui.practice.state?.currentMinigame.startedAt,title:document.querySelector("#practice-title")?.textContent}))}));throw error;}finally{await browser.close();server.stop();}
