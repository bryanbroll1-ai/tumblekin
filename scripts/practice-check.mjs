// Real browser input against isolated, bundled server rules; two clients verify
// that practice cannot ready a player or mutate the multiplayer match.
import assert from 'node:assert/strict';
import {launchBrowser,startServer,openRoom,request,backToLobby,watchErrors} from './lib/harness.mjs';
const server=await startServer({log:true}),browser=await launchBrowser();
const host=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
const guest=await browser.newPage({viewport:{width:390,height:844}});
const errors=[watchErrors(host),watchErrors(guest)];
for(const page of [host,guest]) await page.addInitScript(()=>{
  Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>4});
  Object.defineProperty(navigator,'deviceMemory',{get:()=>2});
});
const local=()=>host.evaluate(()=>window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice);
const snapshot=()=>host.evaluate(()=>{const s=window.__tumblekin.state();return JSON.stringify({phase:s.phase,game:s.currentMinigame,ready:s.readyForMinigame,players:s.players.map(p=>({id:p.id,score:p.score}))});});
async function start(type){
  await request(host,'selectMode',{mode:'single'});
  await request(host,'updateSettings',{settings:{single:type}});
  await request(host,'startGame');
  await guest.waitForSelector('#intro-ready');
  await guest.click('#intro-ready');
  await host.waitForFunction(()=>window.__tumblekin.state().readyForMinigame.length===1);
  if(type==='kanonenflug'){
    await host.waitForTimeout(400); // intro-card's arrival animation has settled
    for(const [width,height] of [[320,568],[844,390],[390,844]]){
      await host.setViewportSize({width,height});
      await host.waitForTimeout(100);
      const visible=await host.evaluate(()=>['intro-ready','intro-practice'].every(id=>{
        const r=document.getElementById(id).getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth && r.height>=44;
      }));
      assert.ok(visible,`Bereit und Üben bleiben bei ${width} × ${height} sichtbar`);
    }
  }
  await host.click('#intro-practice');
  await host.waitForFunction(()=>window.__tumblekin.ui.practice.scene?.hudScore && !document.querySelector('[data-practice-retry]').disabled);
  await host.waitForFunction(()=>Date.now()>=window.__tumblekin.ui.practice.state.currentMinigame.startedAt);
}
async function restart(){
  const before=await host.evaluate(()=>window.__tumblekin.ui.practice.state.currentMinigame.id);
  await host.click('[data-practice-retry]');
  await host.waitForFunction(id=>window.__tumblekin.ui.practice.state?.currentMinigame.id!==id && window.__tumblekin.ui.practice.scene?.hudScore && !document.querySelector('[data-practice-retry]').disabled,before);
}
try{
  await openRoom(host,server.base,{name:'Host',bots:false});
  const code=await host.evaluate(()=>window.__tumblekin.state().code);
  await guest.goto(`${server.base}/?dev=1`,{waitUntil:'networkidle'});
  await guest.fill('#player-name','Gast');await guest.fill('#room-code',code);await guest.click('#join-room');
  await guest.waitForSelector('#screen-lobby.active');
  for(const type of ['kanonenflug','eisstock','ballonfahrt','fassmut']){
    await start(type);
    const original=await snapshot();
    await host.evaluate(()=>document.querySelector('#intro-ready').click());
    assert.equal(await host.locator('#intro-ready').isDisabled(),true);
    assert.equal(await host.evaluate(()=>document.querySelector('#minigame-intro').inert),true);
    if(type==='kanonenflug'){
      await host.click('.practice-layer [data-cannon-launch]');
      await host.waitForFunction(()=>Boolean(window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice.powerAt));
      await host.waitForSelector('.practice-layer [data-cannon-aim]:not([hidden])');
      assert.match(await host.locator('.practice-layer [data-cannon-aim]').innerText(),/ohne Wind/);
      await host.waitForTimeout(250);
      await host.click('.practice-layer [data-cannon-launch]');
      await host.waitForFunction(()=>Boolean(window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice.launchedAt));
      assert.ok(Number.isFinite((await local()).distance));
      console.log('✓ Kanonenflug: Kraft, Winkel, Vorschau und echter Flug');
    }else if(type==='eisstock'){
      await host.waitForTimeout(1200); // camera intro settles before projecting a swipe
      await host.mouse.move(195,650);await host.mouse.down();await host.mouse.move(195,440,{steps:8});await host.mouse.up();
      await host.waitForFunction(()=>window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice.stonesLeft===2);
      assert.ok(await host.evaluate(()=>window.__tumblekin.ui.practice.state.currentMinigame.arcade.stones.some(s=>s.playerId==='practice')));
      console.log('✓ Eisstock: Wischrichtung, Kraft und verbrauchter Stein');
    }else if(type==='ballonfahrt'){
      await host.evaluate(()=>{
        const c=document.querySelector('.practice-layer canvas.kinetic-webgl'),b=document.querySelector('.practice-layer [data-glide-drop]');
        const fire=(el,t,id)=>el.dispatchEvent(new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:id===61,clientX:195,clientY:400}));
        fire(c,'pointerdown',61);fire(b,'pointerdown',62);fire(b,'pointerup',62);
      });
      await host.waitForFunction(()=>{const p=window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice;return p.holding && p.bags.length===1;});
      await host.evaluate(()=>document.querySelector('.practice-layer canvas.kinetic-webgl').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:61,pointerType:'touch'})));
      await host.waitForFunction(()=>!window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice.holding);
      console.log('✓ Ballonfahrt: Brenner halten, mit zweitem Finger Sandsack abwerfen, loslassen');
    }else{
      await host.waitForFunction(()=>{const p=window.__tumblekin.ui.practice,s=p.state?.currentMinigame;return s && Date.now()>=s.startedAt+s.arcade.leadIn && !document.querySelector('.practice-layer [data-dare-brake]').disabled;});
      await host.click('.practice-layer [data-dare-brake]');
      await host.waitForFunction(()=>window.__tumblekin.ui.practice.state.currentMinigame.arcade.players.practice.brakeAt!==null);
      assert.ok(Number.isFinite((await local()).brakeAt));
      console.log('✓ Fassmut: Seilziehen stoppt den echten Physiklauf');
    }
    assert.equal(await snapshot(),original,'Üben darf weder Bereitstatus noch die laufende Partie verändern');
    await restart();
    const fresh=await local();
    if(type==='kanonenflug') assert.ok(!fresh.powerAt && !fresh.launchedAt);
    if(type==='eisstock') assert.equal(fresh.stonesLeft,3);
    if(type==='ballonfahrt') assert.equal(fresh.bags.length,0);
    if(type==='fassmut') assert.equal(fresh.brakeAt,null);
    await host.keyboard.press('Escape');
    await host.waitForSelector('.practice-layer',{state:'detached'});
    assert.equal(await host.evaluate(()=>window.__tumblekin.ui.practice.scene),null);
    assert.equal(await host.evaluate(()=>document.querySelector('#minigame-intro').inert),false);
    assert.equal(await host.locator('#intro-ready').isDisabled(),false);
    assert.equal(await host.evaluate(()=>document.activeElement.id),'intro-practice');
    assert.equal(await snapshot(),original);
    await backToLobby(host);
  }
  await start('kanonenflug');
  await host.click('[data-practice-close]');await host.click('#intro-ready');
  await host.waitForSelector('#minigame-intro',{state:'hidden'});
  await host.waitForFunction(()=>window.__tumblekin.activeMinigame()?.minigame.type==='kanonenflug');
  assert.equal(await host.evaluate(()=>window.__tumblekin.ui.practice.active),false);
  assert.equal(await host.locator('[data-cannon-launch]').count(),1);
  for(const list of errors) assert.deepEqual(list,[]);
  assert.deepEqual(server.errorOutput,[]);
  console.log('✓ Zwei Geräte: Üben und Neustart lassen die Partie unverändert; Fertig/Escape räumen auf; Bereit startet anschließend die echte Runde');
}finally{await browser.close();server.stop();}
