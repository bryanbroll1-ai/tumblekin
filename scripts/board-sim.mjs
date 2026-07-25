// Spielt komplette Brettpartien gegen den echten Server und berichtet, ob die
// Board-Ökonomie greift: Wandert der Stern? Werden Sterne gekauft? Feuern alle
// Feldtypen? Gedacht zum Balancing — dieser Simulator hat aufgedeckt, dass ein
// zufällig platzierter Stern eine ganze Partie unerreichbar bleiben kann.
//
//   npm run board-sim          # eine Partie
//   npm run board-sim -- 3     # drei Partien, mit Sammelbilanz
//
// Braucht einmalig:  npm install --no-save socket.io-client
import { spawn } from "node:child_process";
import net from "node:net";

let io;
try {
  ({ io } = await import("socket.io-client"));
} catch {
  console.error("socket.io-client fehlt. Einmalig einrichten:\n");
  console.error("  npm install --no-save socket.io-client\n");
  process.exit(2);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const runs = Math.max(1, Math.min(10, Number(process.argv[2]) || 1));
const totals = { stars: 0, starMoves: 0, bought: 0, itemsUsed: 0, errors: 0, effects: new Set() };

for (let run = 1; run <= runs; run += 1) {
  console.log(`\n=== Partie ${run}/${runs} ===`);
  await playOne(run);
}

if (runs > 1) {
  console.log(`\n=== Bilanz über ${runs} Partien ===`);
  console.log(`Sterne insgesamt gekauft: ${totals.bought}`);
  console.log(`Sternversetzungen: ${totals.starMoves}`);
  console.log(`Items benutzt: ${totals.itemsUsed}`);
  console.log(`Feldtypen je erlebt: ${[...totals.effects].sort().join(", ")}`);
  console.log(`Serverfehler: ${totals.errors}`);
  if (totals.bought === 0) {
    console.log("\nWARNUNG: In keiner Partie wurde ein Stern gekauft — das Kernziel läuft leer.");
    process.exit(1);
  }
}
process.exit(0);

async function playOne() {
  const PORT = await freePort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const server = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"]
  });
  let serverLog = "";
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1600);

  const sock = io(BASE, { transports: ["websocket"], reconnection: false });
  await new Promise((res, rej) => { sock.on("connect", res); sock.on("connect_error", rej); });

  const req = (event, payload, ms = 2500) => new Promise((res) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; res({ timeout: true }); } }, ms);
    sock.emit(event, payload, (r) => { if (!done) { done = true; clearTimeout(t); res(r); } });
  });

  let state = null;
  const seen = { starIndexes: new Set(), items: new Set(), effects: new Set(), bought: 0 };
  sock.on("state", (s) => {
    state = s;
    if (s.starIndex !== null && s.starIndex !== undefined) seen.starIndexes.add(s.starIndex);
    s.players?.forEach((p) => (p.items || []).forEach((i) => seen.items.add(i)));
  });
  sock.on("boardLanded", (l) => {
    const e = l.fieldEffect || {};
    if (e.type) seen.effects.add(e.type);
    if (e.starGained) { seen.effects.add("stern:gelandet"); seen.bought += 1; }
    if (l.starPass?.starGained) { seen.effects.add("stern:passiert"); seen.bought += 1; }
    if (e.gamble) seen.effects.add(`glueck:${e.gamble}`);
    if (e.item) seen.effects.add("item");
    if (e.blocked) seen.effects.add("schild");
  });

  const created = await req("createRoom", { name: "Sim" });
  const code = created?.room?.code;
  await req("enableDevMode", { code });
  await req("startGame", { code });
  await sleep(500);
  console.log(`Raum ${code}, Startstern auf Feld ${state?.starIndex} (Podeste ${JSON.stringify(state?.board?.starPads)})`);

  async function waitForRoll(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (state?.status === "end") return "end";
      if (state?.status === "board" && state?.phase === "waitingRoll") return "ready";
      await sleep(250);
    }
    return "timeout";
  }

  let rolls = 0;
  let itemsUsed = 0;
  const hardStop = Date.now() + 8 * 60 * 1000;
  while (Date.now() < hardStop) {
    if ((await waitForRoll()) !== "ready") break;
    const current = state.players.find((p) => p.id === state.currentPlayerId);
    if (!current) break;
    if ((current.items || []).length && !current.pendingItem) {
      const r = await req("useItem", { code, playerId: current.id, itemId: current.items[0] });
      if (r?.ok) itemsUsed += 1;
    }
    const rolled = await req("rollDice", { code, playerId: current.id });
    if (rolled?.ok === false) { await sleep(400); continue; }
    rolls += 1;
    await sleep(400);
  }

  await sleep(800);
  const players = state?.players || [];
  console.log(`Würfe ${rolls}, Items benutzt ${itemsUsed}, Sterne gekauft ${seen.bought}`);
  console.log(`Stern stand auf: ${[...seen.starIndexes].join(", ")}`);
  console.log(`Erlebt: ${[...seen.effects].sort().join(", ")}`);
  players.forEach((p) => console.log(`  ${p.name.padEnd(9)} ★${p.stars ?? 0}  ●${p.coins}  Siege ${p.wins}`));
  (state?.bonusStars || []).forEach((b) => console.log(`  Bonus: ${b.name} +${b.stars} (${b.label})`));

  const errors = (serverLog.match(/Unerwarteter Fehler/g) || []).length;
  if (errors) console.log(`Serverfehler: ${errors}`);

  totals.bought += seen.bought;
  totals.starMoves += Math.max(0, seen.starIndexes.size - 1);
  totals.itemsUsed += itemsUsed;
  totals.errors += errors;
  seen.effects.forEach((e) => totals.effects.add(e));

  sock.close();
  server.kill();
  await sleep(200);
}
