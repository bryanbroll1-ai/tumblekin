// Export actual scenes rather than maintaining a second set of game drawings.
import {mkdir,writeFile} from 'node:fs/promises';
import {ALL_GAMES,pickGames,launchBrowser,startServer,openRoom,startSingle,backToLobby,watchErrors} from './lib/harness.mjs';
const games=pickGames(process.argv.slice(2));
const out=new URL('../client/assets/games/',import.meta.url);
await mkdir(out,{recursive:true});
const server=await startServer({log:true}),browser=await launchBrowser();
const page=await browser.newPage({viewport:{width:640,height:400}});
await page.addInitScript(()=>{Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>4});Object.defineProperty(navigator,'deviceMemory',{get:()=>2});});
const errors=watchErrors(page);
try{
  await openRoom(page,server.base,{name:'Du'});
  for(const game of games){
    await startSingle(page,game);
    await page.waitForSelector('#minigame-intro',{state:'hidden'});
    await page.waitForFunction(type=>{
      const s=window.__tumblekinScene;
      if(s?.minigame?.type!==type)return false;
      if(type==='rohrsalat')return Boolean(s.mazeGroup?.children.length);
      if(type==='grimassen')return s.canShape();
      if(type==='turmbau')return s.rig.current.frame.w<4.1;
      return Boolean(s.hudScore || type==='nervenprobe');
    },game);
    await page.waitForTimeout(700);
    const url=await page.evaluate(()=>{
      const s=window.__tumblekinScene;
      if(s.renderer)s.renderer.render(s.scene,s.camera);
      const source=s.webglCanvas||s.canvas,rect=source.getBoundingClientRect(),scale=source.width/rect.width;
      const band=s.rig?.band||{top:0,bottom:rect.height,left:0,right:rect.width};
      const height=band.bottom-band.top,width=Math.min(band.right-band.left,height*16/9);
      const x=(band.left+band.right-width)/2;
      const c=document.createElement('canvas');c.width=480;c.height=270;
      c.getContext('2d').drawImage(source,x*scale,band.top*scale,width*scale,height*scale,0,0,480,270);
      return c.toDataURL('image/jpeg',.86);
    });
    await writeFile(new URL(`${game}.jpg`,out),Buffer.from(url.split(',')[1],'base64'));
    console.log(`${ALL_GAMES.indexOf(game)+1}/40 ${game}`);
    await backToLobby(page);
  }
  if(errors.length||server.errorOutput.length)throw new Error(JSON.stringify({errors,server:server.errorOutput}));
  console.log(`✓ ${games.length} echte Spielansichten, 480 × 270`);
}finally{await browser.close();server.stop();}
