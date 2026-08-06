import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
const games = process.argv.slice(2);
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome","/usr/bin/chromium"].find(existsSync);
const srv = spawn(process.execPath, ["server/server.js"], { cwd: "/home/user/tumblekin",
  env: { ...process.env, PORT: "3161", TUMBLEKIN_DEV_TOOLS: "1" }, stdio: "ignore" });
for (let i = 0; i < 150; i += 1) { try { if ((await fetch("http://127.0.0.1:3161/")).ok) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
const browser = await chromium.launch({ headless: true, executablePath: exe,
  args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
await page.goto("http://127.0.0.1:3161/?dev=1", { waitUntil: "networkidle" });
await page.fill("#player-name", "Rand");
await page.click("#create-room");
await page.waitForSelector("#screen-lobby.active");
await page.click("#enable-dev-mode");
await page.waitForTimeout(400);
await page.click("#start-game");
for (const game of games) {
  await page.waitForSelector("[data-dev-game-select]", { timeout: 20000 });
  await page.selectOption("[data-dev-game-select]", game);
  await page.click("[data-dev-challenge]");
  await page.waitForSelector("canvas.kinetic-webgl, canvas.bounce-webgl", { timeout: 20000 });
  await page.waitForTimeout(4600);
  const out = await page.evaluate(async () => {
    const host = window.__tumblekinScene;
    const THREE = await import("/vendor/three/three.module.js");
    const cam = host.camera; cam.updateMatrixWorld();
    const n = (v) => Number(v.toFixed(3));
    const spieler = host.kins instanceof Map ? [...host.kins.values()] : [];
    return {
      kam: [cam.position.x, cam.position.y, cam.position.z].map(n), fov: n(cam.fov), seite: n(cam.aspect),
      figuren: spieler.map((kin) => {
        const w = kin.getWorldPosition(new THREE.Vector3());
        const p = w.clone().project(cam);
        // Welcher UNTERKNOTEN ragt am weitesten hinaus?
        let schlimmst = { name: "-", rand: 1 };
        kin.traverse((o) => {
          if (!o.isMesh && !o.isSprite) return;
          const b = new THREE.Box3().setFromObject(o);
          if (!Number.isFinite(b.min.x)) return;
          let r = 1;
          [b.min.x, b.max.x].forEach((x) => [b.min.y, b.max.y].forEach((y) => [b.min.z, b.max.z].forEach((z) => {
            const q = new THREE.Vector3(x, y, z).project(cam);
            r = Math.min(r, 1 - Math.abs(q.x), 1 - Math.abs(q.y));
          })));
          if (r < schlimmst.rand) schlimmst = { name: o.isSprite ? "SCHILD" : (o.geometry?.type || "mesh"), rand: n(r) };
        });
        return { x: n(w.x), y: n(w.y), z: n(w.z), ndcX: n(p.x), ndcY: n(p.y), ...schlimmst };
      })
    };
  });
  console.log(`\n── ${game}  Kamera ${out.kam} fov ${out.fov} Seite ${out.seite}`);
  out.figuren.forEach((f, i) => console.log(`   #${i} welt(${f.x}, ${f.y}, ${f.z}) ndc(${f.ndcX}, ${f.ndcY})  engster Teil: ${f.name} Luft ${f.rand}`));
  await page.waitForSelector("#screen-result.active", { timeout: 90000 });
  const r = await page.$("#result-ready");
  if (r && await r.isVisible()) await r.click().catch(()=>{});
  await page.waitForSelector("#screen-board.active", { timeout: 30000 });
}
await browser.close(); srv.kill();
