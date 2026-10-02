import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser,startServer,openRoom,startSingle,watchErrors} from './lib/harness.mjs';
const server=await startServer({log:true}),browser=await launchBrowser(),page=await browser.newPage({viewport:{width:390,height:844}});
const errors=watchErrors(page),out=process.env.TUMBLEKIN_SCREENSHOTS||'/tmp/tumblekin-pipes';await mkdir(out,{recursive:true});
await page.addInitScript(()=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>4});Object.defineProperty(navigator,'deviceMemory',{get:()=>2});});
try{
 await openRoom(page,server.base);await startSingle(page,'rohrsalat');await page.waitForSelector('#minigame-intro',{state:'hidden'});
 for(let round=0;round<5;round++){
  await page.waitForFunction(r=>window.__tumblekinScene?.currentRound===r && document.querySelector('[data-valve="0"]:not(:disabled)'),round,{timeout:20000});
  if(round)assert.ok(await page.evaluate(()=>window.__pipeDisposed),'Das alte Ventilschild muss freigegeben werden');
  await page.evaluate(()=>{
   window.__pipeDisposed=false;
   const tag=window.__tumblekinScene.mazeGroup.children.find(o=>o.isSprite);
   tag.material.map.addEventListener('dispose',()=>{window.__pipeDisposed=true;});
  });
  if(round===3){
   assert.equal(await page.locator('[data-valve]').count(),6);
   for(const [name,width,height] of [['small',320,568],['landscape-small',568,320],['portrait',390,844],['landscape',844,390]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(500);
    const check=await page.evaluate(()=>{
     const s=window.__tumblekinScene,boxes=[...document.querySelectorAll('[data-valve]')].map(el=>el.getBoundingClientRect());
     const banner=s.hud.querySelector('[data-pipe-banner]').getBoundingClientRect();
     const labels=s.mazeGroup.children.filter(o=>o.isSprite).map(o=>({
      center:s.rig.toScreen(o.position),
      top:s.rig.toScreen(o.position.clone().setY(o.position.y+o.scale.y/2)).y,
      bottom:s.rig.toScreen(o.position.clone().setY(o.position.y-o.scale.y/2)).y
     }));
     const overlaps=labels.some(p=>p.center.x>=banner.left && p.center.x<=banner.right && p.top<=banner.bottom && p.bottom>=banner.top);
     return{small:boxes.some(r=>r.width<44 || r.height<44),outside:boxes.some(r=>r.left<0 || r.top<0 || r.right>innerWidth || r.bottom>innerHeight),overlaps};
    });
    assert.deepEqual(check,{small:false,outside:false,overlaps:false},name);
    await page.screenshot({path:`${out}/pipe-six-${name}.png`});
   }
   console.log('✓ Sechs Ventile: 320px, Hochformat, zwei Querformate; alle Knöpfe ≥44px und Schilder frei von Ansagen');
  }
  await page.click('[data-valve="0"]');
  await page.waitForFunction(r=>window.__tumblekinScene?.localPicks[r]===0,round);
  console.log(`✓ Rohrsalat Runde ${round+1}: echte Wahl und bestätigter Rundendurchlauf`);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(server.errorOutput,[]);
 console.log('✓ Fünf echte Runden und Freigabe der alten Schildtexturen');
}finally{await browser.close();server.stop();}
