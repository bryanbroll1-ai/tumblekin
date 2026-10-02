// Genuine input in an isolated match: no button or scripted ability exists.
import assert from 'node:assert/strict';
import { launchBrowser, startServer, openRoom, request, watchErrors } from './lib/harness.mjs';
const server=await startServer({log:true}), browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
await page.addInitScript(()=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>4});Object.defineProperty(navigator,'deviceMemory',{get:()=>2});});
const errors=watchErrors(page);
const practice=()=>page.evaluate(()=>window.__tumblekin.ui.practice.state.currentMinigame.arena);
const mainState=()=>page.evaluate(()=>JSON.stringify(window.__tumblekin.state().currentMinigame));
const cdp=await page.context().newCDPSession(page), touches=new Map();
const pointer=async(type,id,x=0,y=0)=>{
 const r=await page.locator('.practice-layer .virtual-joystick').boundingBox();
 const ended=touches.get(id);
 if(type==='pointerup')touches.delete(id);
 else touches.set(id,{id,x:r.x+r.width/2+x*r.width*.31,y:r.y+r.height/2+y*r.width*.31});
 await cdp.send('Input.dispatchTouchEvent',{type:type==='pointerdown'?'touchStart':type==='pointerup'?'touchEnd':'touchMove',touchPoints:type==='pointerup'?[ended]:[...touches.values()]});
};
try{
 await openRoom(page,server.base,{name:'Bumper'});
 await request(page,'selectMode',{mode:'single'});await request(page,'updateSettings',{settings:{single:'bounceArena'}});await request(page,'startGame');
 await page.waitForSelector('#intro-practice:not([hidden])');const original=await mainState();
 await page.click('#intro-practice');
 await page.waitForFunction(()=>window.__tumblekin.ui.practice.scene?.joystick && !document.querySelector('[data-practice-retry]').disabled);
 await page.waitForFunction(()=>Date.now()>=window.__tumblekin.ui.practice.state.currentMinigame.startedAt+950);
 assert.equal(await page.locator('.practice-layer .minigame-controls button').count(),0);
 assert.equal(await page.locator('.practice-layer .virtual-joystick').count(),1);
 await page.evaluate(()=>{
  const s=window.__tumblekin.ui.practice.scene,f=s.feedback,original=f.sound.bind(f);
  window.__bumperSounds=[];f.sound=(name,options)=>{window.__bumperSounds.push({name,options});original(name,options);};
 });
 await pointer('pointerdown',11);
 await pointer('pointerdown',22,-1,0);await pointer('pointerup',22);
 assert.ok(await page.evaluate(()=>window.__tumblekin.ui.practice.scene.joystick.vecX===0 && window.__tumblekin.ui.practice.scene.joystick.pointerId!==null),'a second finger cannot take over');
 await pointer('pointermove',11,0,1);
 await page.waitForFunction(()=>window.__tumblekin.ui.practice.state.currentMinigame.arena.players.trainer.lives<3,null,{timeout:10000});
 await pointer('pointerup',11);
 const hit=await practice();assert.ok(hit.players.practice.knockouts>=1);assert.equal(hit.players.trainer.lives,2);
 assert.ok(hit.events.some(e=>e.kind==='hit' && e.attacker==='practice'));
 await page.waitForFunction(()=>window.__bumperSounds.some(s=>s.name==='bumperSplash'));
 const sounds=await page.evaluate(()=>window.__bumperSounds);
 assert.ok(sounds.some(s=>s.name==='bumperHit' && Number.isFinite(s.options.strength)));
 console.log('✓ One stick, second-finger isolation, real run-up, knock-out and impact/splash sounds');
 await page.waitForFunction(()=>window.__tumblekin.ui.practice.state.currentMinigame.arena.players.practice.inPlay);
 await pointer('pointerdown',31,1,0);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await pointer('pointerup',31);
 await page.waitForFunction(()=>{const s=window.__tumblekin.ui.practice.scene,p=window.__tumblekin.ui.practice.state.currentMinigame.arena.players.practice;return s.joystick.pointerId===null && !p.thrustX && !p.thrustY;});
 await page.keyboard.down('a');await page.waitForFunction(()=>window.__tumblekin.ui.practice.state.currentMinigame.arena.players.practice.thrustX<0);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('a');
 await page.waitForFunction(()=>!window.__tumblekin.ui.practice.state.currentMinigame.arena.players.practice.thrustX);
 console.log('✓ Pointer and keyboard steering both release on blur');
 await page.locator('.practice-layer .virtual-joystick').focus();
 await page.keyboard.down('ArrowRight');
 await page.waitForFunction(()=>window.__tumblekin.ui.practice.state.currentMinigame.arena.players.practice.thrustX>0);
 await page.keyboard.press('Tab');await page.keyboard.up('ArrowRight');
 await page.waitForFunction(()=>{const s=window.__tumblekin.ui.practice.scene,p=window.__tumblekin.ui.practice.state.currentMinigame.arena.players.practice;return !p.thrustX&&!p.thrustY&&s.joystick.timer===null&&s.keyTimer===null;});
 console.log('✓ Leaving the focused joystick stops keyboard motion without a second steering timer');

 const id=await page.evaluate(()=>window.__tumblekin.ui.practice.state.currentMinigame.id);
 await page.click('[data-practice-retry]');await page.waitForFunction(id=>window.__tumblekin.ui.practice.state.currentMinigame.id!==id && !document.querySelector('[data-practice-retry]').disabled,id);
 assert.equal((await practice()).players.practice.lives,3);
 await page.waitForFunction(()=>Date.now()>=window.__tumblekin.ui.practice.state.currentMinigame.startedAt+950);
 await pointer('pointerdown',51,0,1);await page.waitForTimeout(250);const start=Date.now();let charge=0,speed=0,runUp=null;
 while(Date.now()-start<2200){
  const angle=Math.PI/2+(Date.now()-start)/1000*Math.PI;await pointer('pointermove',51,Math.cos(angle),Math.sin(angle));
  const p=(await practice()).players.practice;charge=Math.max(charge,p.swing);speed=Math.max(speed,Math.hypot(p.vx,p.vy));
  if(p.swing>.4 && p.inPlay){runUp=p;break;}
  await page.waitForTimeout(35);
 }
 if(runUp){const n=Math.hypot(runUp.vx,runUp.vy);await pointer('pointermove',51,runUp.vx/n,runUp.vy/n);const straight=Date.now();while(Date.now()-straight<300){const p=(await practice()).players.practice;speed=Math.max(speed,Math.hypot(p.vx,p.vy));await page.waitForTimeout(30);}}
 await pointer('pointerup',51);assert.ok(charge>.25,`charge ${charge}`);assert.ok(speed>1.6,`speed ${speed}, charge ${charge}, runUp ${JSON.stringify(runUp)}`);
 console.log(`✓ Genuine joystick arc builds ${Math.round(charge*100)}% swing and ${speed.toFixed(2)} speed`);
 await page.click('[data-practice-close]');await page.waitForSelector('.practice-layer',{state:'detached'});
 assert.equal(await mainState(),original);assert.equal(await page.evaluate(()=>window.__tumblekin.state().readyForMinigame.length),0);
 assert.deepEqual(errors,[]);assert.deepEqual(server.errorOutput,[]);
 console.log('✓ Retry resets all lives; closing practice leaves party state and ready status intact');
}finally{await browser.close();server.stop();}
