// Real swipes and sustained touch against the same isolated/party rules.
import assert from 'node:assert/strict';
import {launchBrowser,startServer,openRoom,request,watchErrors} from './lib/harness.mjs';
const server=await startServer({log:true}),browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
await page.addInitScript(()=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>4});Object.defineProperty(navigator,'deviceMemory',{get:()=>2});});
const errors=watchErrors(page),cdp=await page.context().newCDPSession(page),touches=new Map();
let scope='.practice-layer';
const own=()=>page.evaluate(()=>window.__tumblekinScene.ownEntry());
async function touch(type,id,x,y){
 const point=touches.get(id);
 if(type==='touchEnd')touches.delete(id);else touches.set(id,{id,x,y});
 await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[point]:[...touches.values()]});
}
async function prepared(){await page.waitForFunction(()=>{const s=window.__tumblekinScene;return s?.minigame?.type==='finishRush' && s.now()>=(s.update||s.minigame).startedAt;});}
try{
 await openRoom(page,server.base,{name:'Swipe'});
 await request(page,'selectMode',{mode:'single'});await request(page,'updateSettings',{settings:{single:'finishRush'}});await request(page,'startGame');
 await page.waitForSelector('#intro-practice:not([hidden])');
 const before=await page.evaluate(()=>JSON.stringify(window.__tumblekin.state().currentMinigame));
 await page.click('#intro-practice');await page.waitForSelector('.practice-loading',{state:'hidden'});await prepared();
 assert.equal(await page.locator(`${scope} .minigame-controls button`).count(),0);
 assert.ok(await page.evaluate(()=>{const s=window.__tumblekinScene;return s.update.arcade.hurdles.every(row=>row.lanes.every((kind,lane)=>{const mesh=s.hurdles.get(`${row.index}:${lane}`);return kind?mesh?.userData.kind===kind && Math.abs(mesh.position.z+row.at*.62)<1e-8:!mesh;}));}),'practice geometry matches the actual prepared course');

 await touch('touchStart',11,170,470);await page.waitForFunction(()=>window.__tumblekinScene.ownEntry().holding);
 await page.waitForTimeout(70);assert.ok((await own()).energy<99);
 await touch('touchMove',11,230,470);await page.waitForFunction(()=>window.__tumblekinScene.ownEntry().lane===1);
 await page.waitForTimeout(210);await touch('touchMove',11,230,390);
 await page.waitForFunction(()=>window.__tumblekinScene.ownEntry().jumps>0);
 await page.waitForFunction(()=>window.__tumblekinScene.kins.get('practice').userData.sprintHeight>.3);
 await touch('touchStart',22,100,420);await touch('touchEnd',22);
 assert.equal((await own()).holding,true,'second finger must not stop held sprint');
 await page.waitForTimeout(160);await touch('touchMove',11,230,470);
 await page.waitForFunction(()=>window.__tumblekinScene.ownEntry().slides>0);
 await page.waitForFunction(()=>{const s=window.__tumblekinScene,k=s.kins.get('practice');return k.userData.runnerSlide>.95 && !k.userData.sprintAir;});
 const geometry=await page.evaluate(async()=>{
  const THREE=await import('/vendor/three/three.module.js'),s=window.__tumblekinScene,k=s.kins.get('practice');k.updateMatrixWorld(true);
  const box=new THREE.Box3();return {head:box.setFromObject(k.userData.head).max.y,feet:Math.min(...k.userData.legs.map(l=>box.setFromObject(l).min.y))};
 });
 assert.ok(Math.abs(geometry.feet)<.003,JSON.stringify(geometry));assert.ok(geometry.head<.54,JSON.stringify(geometry));
 await touch('touchEnd',11);await page.waitForFunction(()=>!window.__tumblekinScene.ownEntry().holding);
 console.log('✓ No buttons: sustained touch sprints, side/up/down swipes change lane/jump/dive-slide; second finger is independent; visible slide fits below gate');
 await page.waitForTimeout(300);
 const energy=(await own()).energy;await page.waitForTimeout(150);assert.ok((await own()).energy>energy);
 await page.locator(`${scope} canvas.kinetic-webgl`).focus();await page.keyboard.down('Space');await page.waitForFunction(()=>window.__tumblekinScene.ownEntry().holding);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Space');await page.waitForFunction(()=>!window.__tumblekinScene.ownEntry().holding);
 await touch('touchStart',31,170,470);await page.waitForFunction(()=>window.__tumblekinScene.ownEntry().holding);
 await page.setViewportSize({width:844,height:390});await page.waitForFunction(()=>!window.__tumblekinScene.ownEntry().holding);await touch('touchEnd',31);
 await page.waitForTimeout(300);
 const visible=await page.evaluate(async()=>{
  const THREE=await import('/vendor/three/three.module.js'),s=window.__tumblekinScene,k=s.kins.get('practice'),v=k.getWorldPosition(new THREE.Vector3()).project(s.camera),r=s.webglCanvas.getBoundingClientRect();
  return {x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2,top:s.hud.querySelector('.sprint-vitals').getBoundingClientRect().bottom,bottom:s.controls.getBoundingClientRect().top};
 });assert.ok(visible.x>0 && visible.x<844 && visible.y>visible.top && visible.y<visible.bottom,JSON.stringify(visible));
 console.log('✓ Release recharges; keyboard, blur and orientation release; own runner stays visible in landscape');
 await page.click('[data-practice-retry]');await page.waitForFunction(()=>window.__tumblekinScene?.ownEntry()?.jumps===0 && !document.querySelector('[data-practice-retry]').disabled);
 assert.equal((await own()).slides,0);assert.equal((await own()).energy,100);
 await page.click('[data-practice-close]');await page.waitForSelector('.practice-layer',{state:'detached'});
 assert.equal(await page.evaluate(()=>JSON.stringify(window.__tumblekin.state().currentMinigame)),before);
 await page.click('#intro-ready');await page.waitForSelector('#minigame-intro',{state:'hidden'});await prepared();scope='#screen-minigame';
 assert.equal(await page.locator('#minigame-controls button').count(),0);
 await touch('touchStart',41,170,240);await page.waitForFunction(()=>window.__tumblekinScene.ownEntry().holding);
 await touch('touchMove',41,230,240);await page.waitForFunction(()=>window.__tumblekinScene.ownEntry().lane===1);
 await touch('touchEnd',41);await page.waitForFunction(()=>!window.__tumblekinScene.ownEntry().holding);
 console.log('✓ Practice retry/close leaves party unchanged; actual multiplayer scene uses the same swipe/hold controls');
 assert.deepEqual(errors,[]);assert.deepEqual(server.errorOutput,[]);
}finally{await browser.close();server.stop();}
