import { mkdir, writeFile } from 'node:fs/promises';
import {
  ALL_GAMES, pickGames, launchBrowser, startServer, openRoom,
  startSingle, backToLobby, request, watchErrors
} from './lib/harness.mjs';

const games = pickGames(process.argv.slice(2));
const views = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'small', width: 320, height: 568 }
];
const out = process.env.TUMBLEKIN_SCREENSHOTS || '/tmp/tumblekin-refinement';
await mkdir(out, { recursive: true });
const server = await startServer({ log: true });
const browser = await launchBrowser();
const rows = [];

async function runningRound(page, game) {
  await startSingle(page, game);
  await page.waitForSelector('#minigame-intro', { state: 'hidden' });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__tumblekinScene?.hudScore ||
    window.__tumblekinScene?.minigame?.type === 'nervenprobe');
  // Board games reveal their task after a short lead-in. Capturing just the
  // scorebar would otherwise approve a completely blank pipe board.
  if (game === 'rohrsalat') await page.waitForFunction(() => window.__tumblekinScene.mazeGroup?.children.length);
  if (game === 'grimassen') await page.waitForFunction(() => window.__tumblekinScene.canShape());
  if (game === 'turmbau') await page.waitForFunction(() => window.__tumblekinScene.rig.current.frame.w < 4.1);
  await page.waitForTimeout(500);
}

function inspectLayout() {
  const scene = window.__tumblekinScene;
  const visible = el => !el.hidden && el.getClientRects().length &&
    getComputedStyle(el).visibility !== 'hidden';
  // Speed lines, camera and goal flashes, the air-hockey finger ring and flying
  // reward coins intentionally cover the HUD.
  const decorative = '[data-runner-speed], [data-photo-flash], [data-hockey-flash], [data-hockey-touch], .coin-fly';
  const items = [...document.querySelectorAll(
    '.kinetic-hud > *, #minigame-controls > *, #minigame-controls button, .kinetic-hud button'
  )].filter(visible).filter(el => !el.matches(decorative)).map(el => ({
    el, r: el.getBoundingClientRect(),
    id: Object.keys(el.dataset).join(',') || el.className,
    text: el.textContent.trim().slice(0, 80)
  })).filter(o => o.r.width > 4 && o.r.height > 4);
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (x > 3 && y > 3) overlaps.push({ a: a.id, b: b.id, x: Math.round(x), y: Math.round(y) });
  }
  return {
    phase: window.__tumblekin.state().phase,
    outside: items.filter(o => o.r.left < -1 || o.r.right > innerWidth + 1 ||
      o.r.top < -1 || o.r.bottom > innerHeight + 1).map(o => o.id),
    overlaps,
    smallButtons: items.filter(o => o.el.tagName === 'BUTTON' && !o.el.disabled &&
      (o.r.width < 44 || o.r.height < 44)).map(o => ({ id: o.id, w: Math.round(o.r.width), h: Math.round(o.r.height) })),
    hud: items.filter(o => o.el.closest('.kinetic-hud')).map(o => ({ id: o.id, text: o.text })),
    metric: scene?.hudScore?.dataset.metric || (scene?.minigame?.type === 'nervenprobe' ? 'Zielzeit' : null),
    calls: scene?.renderer?.info.render.calls
  };
}

try {
  const pages = [];
  const workers = Math.max(1, Math.min(2, Number(process.env.TUMBLEKIN_BROWSER_WORKERS) || 2));
  for (let i = 0; i < Math.min(workers, games.length); i++) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // Exercise the supported mobile quality tier. Software-rendered Chromium
    // otherwise spends whole short rounds drawing screenshots on a busy host.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 });
    });
    // Respect the server's per-IP room-creation cooldown.
    if (i) await page.waitForTimeout(1600);
    await openRoom(page, server.base, { name: 'Beobachtung' });
    pages.push(page);
  }
  await Promise.all(pages.map(async (page, worker) => {
    const errors = watchErrors(page);
    for (let index = worker; index < games.length; index += pages.length) {
      const game = games[index];
      const row = { game, index: ALL_GAMES.indexOf(game), views: [] };
      errors.length = 0;
      try {
        for (const view of views) {
          await page.setViewportSize({ width: view.width, height: view.height });
          // Every viewport gets a fresh round: a slow screenshot must not consume
          // the next viewport's playing time, especially in ten-second games.
          await runningRound(page, game);
          const layout = await page.evaluate(inspectLayout);
          row.views.push({ view: view.name, ...layout });
          await page.screenshot({ path: `${out}/${String(row.index + 1).padStart(2, '0')}-${game}-${view.name}.png` });
          await backToLobby(page);
        }
        await runningRound(page, game);
        await page.evaluate(() => {
          const scene = window.__tumblekinScene;
          scene.handleUpdate = () => {};
          const minigame = scene.update || scene.minigame;
          minigame.finaleAt = scene.now();
          (minigame.arcade || minigame.arena).places = Object.fromEntries(
            window.__tumblekin.state().players.map((p, i) => [p.id, i + 1])
          );
        });
        await page.waitForFunction(() => document.querySelector('#minigame-controls')?.inert &&
          window.__tumblekinScene?.webglCanvas.style.pointerEvents === 'none', null, { timeout: 5000 });
        row.finalLocked = true;
      } catch (error) {
        row.error = error.message.split('\n')[0];
      }
      row.errors = [...errors];
      rows.push(row);
      await writeFile(`${out}/observations.json`, JSON.stringify([...rows].sort((a, b) => a.index - b.index), null, 2));
      console.log(`${game}: ${row.error || row.views.map(v => `${v.view} ${v.overlaps.length} Überlappungen/${v.outside.length} außerhalb/${v.smallButtons.length} kleine Knöpfe`).join(' · ')}`);
      await backToLobby(page);
    }
    await page.close();
  }));
} finally {
  await browser.close();
  server.stop();
}

const failures = rows.filter(row => row.error || row.errors.length || !row.finalLocked ||
  row.views.length !== views.length || row.views.some(v => v.phase !== 'playingMinigame' ||
    v.outside.length || v.overlaps.length || v.smallButtons.length || !v.metric));
if (server.errorOutput.length) console.error(server.errorOutput.join(''));
console.log(`\n${rows.length - failures.length}/${games.length} Spiele: 3 Ansichten, Wertungsbeschriftung und Finale-Steuerung sauber`);
for (const row of failures) console.error(JSON.stringify(row));
process.exit(failures.length || rows.length !== games.length || server.errorOutput.length ? 1 : 0);
