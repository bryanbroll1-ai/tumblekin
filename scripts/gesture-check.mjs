import assert from 'node:assert/strict';
import { backToLobby, launchBrowser, openRoom, startServer, startSingle, watchErrors } from './lib/harness.mjs';
const server=await startServer({log:true});const browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=watchErrors(page);
const pointer=(selector,type,id,x=170,y=400)=>page.dispatchEvent(selector,type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,bubbles:true,cancelable:true});
const prepare=async game=>{await startSingle(page,game);await page.waitForSelector('#minigame-intro',{state:'hidden'});};
const read=()=>page.evaluate(()=>window.__gestureCalls);
try{
 await openRoom(page,server.base,{name:'Gesten'});
 for(const [game,method] of [['colorEscape','sendStep'],['muenzregen','sendLane'],['finishRush','sendLane']]){
  await prepare(game);
  await page.evaluate(method=>{window.__gestureCalls=[];window.__tumblekinScene[method]=(...args)=>window.__gestureCalls.push(args);},method);
  await pointer('canvas.kinetic-webgl','pointerdown',11);
  await pointer('canvas.kinetic-webgl','pointerdown',22,60,200);
  await pointer('body','pointermove',22,300);
  await pointer('body','pointerup',22,300);
  assert.deepEqual(await read(),[],'Fremder Finger darf weder lenken noch beenden');
  assert.equal(await page.evaluate(()=>window.__tumblekinScene.swipe?.pointerId),11);
  await pointer('body','pointermove',11,270);
  assert.equal((await read()).length,1,'Eigener Finger lenkt weiterhin');
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await pointer('body','pointermove',11,350);
  assert.equal((await read()).length,1,'Tabwechsel beendet die alte Geste');
  console.log(`✓ ${game}: zweiter Finger übernimmt nicht, Originalfinger lenkt, Blur beendet`);
  await backToLobby(page);
 }
 await prepare('eisstock');
 await page.evaluate(()=>{window.__gestureCalls=[];window.__tumblekinScene.sendInput=(input)=>{window.__gestureCalls.push(input);return Promise.resolve();};});
 await pointer('canvas.kinetic-webgl','pointerdown',11,180,600);
 await pointer('canvas.kinetic-webgl','pointerdown',22,50,400);
 await pointer('canvas.kinetic-webgl','pointermove',22,260,200);
 await pointer('body','pointerup',22,260,200);
 assert.equal(await page.evaluate(()=>window.__tumblekinScene.drag?.pointerId),11);
 assert.deepEqual(await read(),[],'Zweiter Finger löst keinen Wurf aus');
 await pointer('canvas.kinetic-webgl','pointermove',11,180,370);
 await pointer('body','pointerup',11,180,370);
 assert.equal((await read()).length,1);
 assert.equal((await read())[0].action,'flick');
 console.log('✓ Eisstock: ein fremdes Loslassen wirft nicht, der eigene Wisch wirft genau einmal');
 await backToLobby(page);
 await prepare('sortierband');
 await page.evaluate(()=>{window.__gestureCalls=[];window.__tumblekinScene.sortTo=(chute)=>window.__gestureCalls.push(chute);});
 await pointer('canvas.kinetic-webgl','pointerdown',11,200,400);
 await pointer('canvas.kinetic-webgl','pointerdown',22,350,300);
 await pointer('body','pointerup',22,350,200);
 assert.deepEqual(await read(),[]);
 await pointer('body','pointerup',11,80,400);
 assert.deepEqual(await read(),[0]);
 await pointer('canvas.kinetic-webgl','pointerdown',33,200,400);
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
 await pointer('body','pointerup',33,350,400);
 assert.deepEqual(await read(),[0]);
 console.log('✓ Sortierband: fremder Finger sortiert nicht, eigenes Loslassen außerhalb der Fläche zählt, Blur verwirft');
 await backToLobby(page);
 for(const game of ['spurmaler','grimassen']){
  await prepare(game);
  if(game==='grimassen')await page.waitForFunction(()=>window.__tumblekinScene.canShape());
  const at=await page.evaluate(async game=>{
   const s=window.__tumblekinScene;
   if(game!=='grimassen')return {x:190,y:420};
   const THREE=await import('/vendor/three/three.module.js');
   const v=new THREE.Vector3();s.handleWorld(s.masks.get(s.own),0,s.localShape,v);v.project(s.camera);
   const r=s.webglCanvas.getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2};
  },game);
  // Grimassen's handle stays reachable within its CSS-pixel hit area.
  await page.mouse.move(at.x+(game==='grimassen'?18:0),at.y);await page.mouse.down();
  await page.waitForFunction(()=>Boolean(window.__tumblekinScene.drag));
  if(game==='grimassen'){
   assert.equal(await page.evaluate(()=>window.__tumblekinScene.drag.index),0);
   await page.mouse.move(at.x+35,at.y-20,{steps:4});
   await page.waitForFunction(()=>{const s=window.__tumblekinScene;return s.update.arcade.players[s.own].shape.some(v=>Math.abs(v)>.1);});
  }
  const original=await page.evaluate(()=>window.__tumblekinScene.drag.id??window.__tumblekinScene.drag.pointerId);
  await pointer('canvas.kinetic-webgl','pointerdown',22,180,440);
  assert.equal(await page.evaluate(()=>window.__tumblekinScene.drag.id??window.__tumblekinScene.drag.pointerId),original);
  if(game==='grimassen'){
   await page.setViewportSize({width:844,height:390});
   await page.waitForFunction(()=>!window.__tumblekinScene.drag && window.__tumblekinScene.wideLayout);
   console.log('✓ Grimassen: Griff aus 18px Entfernung, echte Formänderung am Server, Drehen beendet den Zug und ordnet Masken neu');
  }
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  assert.equal(await page.evaluate(()=>window.__tumblekinScene.drag),null);
  await page.mouse.up();
  console.log(`✓ ${game}: echte Pointer-Capture, zweiter Finger übernimmt nicht, Blur löst`);
  await backToLobby(page);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(server.errorOutput,[]);
}finally{await browser.close();server.stop();}
