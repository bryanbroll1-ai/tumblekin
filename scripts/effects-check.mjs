import assert from 'node:assert/strict';
import { launchBrowser,startServer,watchErrors } from './lib/harness.mjs';
const server=await startServer({log:true}),browser=await launchBrowser(),page=await browser.newPage();
const errors=watchErrors(page);
try{
 await page.goto(`${server.base}/kin-lab.html?states=idle&t=0`);
 const result=await page.evaluate(async()=>{
  const THREE=await import('/vendor/three/three.module.js');
  const { CubeBurst,disposeScene }=await import('/src/minigames/VoxelKit.js?v=tumblekin204');
  const { blockform,blockformCacheInfo }=await import('/src/minigames/Blockform.js?v=tumblekin211');
  const rows=[];
  for(const drag of [0,1.5])for(const gravity of [5.4,-1.2])for(const hz of [30,60,120]){
   const world=new THREE.Scene(),burst=new CubeBurst(world),random=Math.random;
   Math.random=()=>0.5;
   try{burst.spawn(new THREE.Vector3(0,1,0),['#fff'],{count:1,life:1,speed:2,up:3,drag,gravity});}finally{Math.random=random;}
   for(let frame=0;frame<hz*0.4;frame++)burst.update(1/hz);
   const p=burst.pieces[0];rows.push({drag,gravity,hz,position:p.mesh.position.toArray(),velocity:[p.vx,p.vy,p.vz]});burst.dispose();
  }
  const world=new THREE.Scene(),sharedGeometry=new THREE.BoxGeometry(),sharedMaterial=new THREE.MeshBasicMaterial();
  const keep=new THREE.Mesh(sharedGeometry,sharedMaterial),removed=new THREE.Group();world.add(keep,removed);
  removed.add(new THREE.Mesh(sharedGeometry,sharedMaterial));
  const uniqueGeometry=new THREE.BoxGeometry(),texture=new THREE.CanvasTexture(document.createElement('canvas'));
  const uniqueMaterial=new THREE.MeshBasicMaterial({map:texture,alphaMap:texture});removed.add(new THREE.Mesh(uniqueGeometry,uniqueMaterial));
  const disposed={sharedGeometry:0,sharedMaterial:0,uniqueGeometry:0,uniqueMaterial:0,texture:0};
  Object.entries({sharedGeometry,sharedMaterial,uniqueGeometry,uniqueMaterial,texture}).forEach(([name,value])=>value.addEventListener('dispose',()=>disposed[name]++));
  removed.removeFromParent();disposeScene(removed,{retain:world});const afterRemoval={...disposed};disposeScene(world);
  const initial=new THREE.SphereGeometry(0.199,12,8),active=blockform(initial);initial.dispose();let activeDisposed=0;
  active.addEventListener('dispose',()=>activeDisposed++);
  for(let i=0;i<320;i++){
   const source=new THREE.SphereGeometry(0.2+i*0.0001,12,8);blockform(source);source.dispose();
  }
  const byEntries=blockformCacheInfo();
  for(let i=0;i<36;i++){
   const source=new THREE.SphereGeometry(3+i*0.1,12,8);blockform(source);source.dispose();
  }
  return {rows,afterRemoval,disposed,byEntries,byBytes:blockformCacheInfo(),activeDisposed,activeVertices:active.attributes.position.count};
 });
 for(const row of result.rows){
  const reference=result.rows.find(r=>r.drag===row.drag&&r.gravity===row.gravity&&r.hz===60);
  row.position.forEach((value,i)=>assert.ok(Math.abs(value-reference.position[i])<1e-9));
  row.velocity.forEach((value,i)=>assert.ok(Math.abs(value-reference.velocity[i])<1e-9));
 }
 assert.deepEqual(result.afterRemoval,{sharedGeometry:0,sharedMaterial:0,uniqueGeometry:1,uniqueMaterial:1,texture:1});
 assert.deepEqual(result.disposed,{sharedGeometry:1,sharedMaterial:1,uniqueGeometry:1,uniqueMaterial:1,texture:1});
 for(const info of [result.byEntries,result.byBytes]){
  assert.ok(info.entries>0 && info.entries<=info.maxEntries);assert.ok(info.bytes<=info.maxBytes);
 }
 assert.equal(result.activeDisposed,0,'Eviction darf aktive Geometrie nicht entsorgen');assert.ok(result.activeVertices>0);
 console.log('✓ Partikelflug bei 30/60/120 Hz identisch, mit Gravitation/Auftrieb und mit/ohne Luftwiderstand');
 console.log('✓ Geteilte Geometrie und Materialien bleiben intakt, entfernte Ressourcen werden genau einmal entsorgt');
 console.log('✓ Blockform-Vorrat begrenzt auf 8 MiB / 256 Einträge, aktive Formen bleiben intakt');
 await page.emulateMedia({reducedMotion:'reduce'});
 const reduced=await page.evaluate(async()=>{
  const THREE=await import('/vendor/three/three.module.js');
  const {CubeBurst,FloatingText}=await import('/src/minigames/VoxelKit.js?v=tumblekin204');
  const scene=new THREE.Scene(),text=new FloatingText(scene),burst=new CubeBurst(scene);
  text.pop(new THREE.Vector3(0,1,0),'+100',{size:0.5,life:1,rise:1});
  text.update(0.1);const a=text.items[0].sprite.scale.y;text.update(0.1);const b=text.items[0].sprite.scale.y;
  burst.spawn(new THREE.Vector3(),['#fff'],{count:1,spin:12});
  const result={a,b,rise:text.items[0].sprite.position.y-1,spinX:burst.pieces[0].spinX,spinY:burst.pieces[0].spinY};text.dispose();burst.dispose();return result;
 });
 assert.equal(reduced.a,0.5);assert.equal(reduced.b,0.5);assert.ok(reduced.rise<0.1);assert.ok(reduced.spinX===0);assert.ok(reduced.spinY===0);
 console.log('✓ Reduzierte Bewegung: ruhige Punktetexte ohne Überschwingen, Partikel ohne Rotation');
 assert.deepEqual(errors,[]);assert.deepEqual(server.errorOutput,[]);
}finally{await browser.close();server.stop();}
