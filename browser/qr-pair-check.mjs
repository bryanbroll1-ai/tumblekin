// QR-Kopplung von Anfang bis Ende, mit zwei Geräten und echter Kamera —
// einer vorgespielten: Chromium liest das Kamerabild aus einer Datei, und
// zwar bei jedem Einschalten der Kamera neu. Beide Geräte sind getrennte
// Kontexte eines Browsers (eigener Speicher, eigene Seite); zwei ganze
// Browser bauten ohne Grafikkarte die 3D-Szenen so langsam, dass einer eine
// halbe Minute stand.
//
//   node browser/qr-pair-check.mjs            (vorher: node browser/build.mjs)
//
// 1. Host startet eine Party; sein QR-Code wird abfotografiert und dem Gast
//    als Kamerabild gegeben. Der Gast tippt „QR-Code scannen“.
// 2. Der Gast zeigt seinen Antwort-Code; der wird dem Host als Kamerabild
//    gegeben. Der Host tippt „Gast scannen“.
// 3. Beide sind direkt verbunden (WebRTC), der Gast sitzt in der Lobby, und
//    eine Runde Nervenprobe läuft bis zum Ergebnis.
// 4. Der Host geht; der Gast landet wieder am Start.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { launchBrowser, watchErrors } from "../scripts/lib/harness.mjs";
import { decodeQr } from "./qr-decode.mjs";

const port = 8794;
const dist = new URL("./dist/", import.meta.url).pathname;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "tumblekin-qr-"));
const camera = path.join(work, "kamera.y4m");
const failures = [];
const check = (ok, what) => { console.log((ok ? "ok    " : "FEHLER") + "  " + what); if (!ok) failures.push(what); };

// Ein Kamerabild (640×480, Graustufen) mit dem Bild in der Mitte, als Y4M.
function writeCamera(file, image = null) {
  const w = 640;
  const h = 480;
  const y = Buffer.alloc(w * h, 190);
  if (image) {
    const side = 400;
    const x0 = (w - side) / 2;
    const y0 = (h - side) / 2;
    for (let yy = 0; yy < side; yy += 1) {
      for (let xx = 0; xx < side; xx += 1) {
        const sx = Math.floor((xx / side) * image.width);
        const sy = Math.floor((yy / side) * image.height);
        y[(y0 + yy) * w + x0 + xx] = image.gray[sy * image.width + sx];
      }
    }
  }
  const chroma = Buffer.alloc((w / 2) * (h / 2), 128);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F15:1 Ip A1:1 C420jpeg\n`), Buffer.from("FRAME\n"), y, chroma, chroma]));
}

// Ein Element der Seite als Graustufenbild (wie es auf dem Bildschirm steht).
async function grab(page, selector) {
  const png = await page.locator(selector).screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Array(canvas.width * canvas.height);
    for (let i = 0; i < gray.length; i += 1) gray[i] = Math.round(data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11);
    return { width: canvas.width, height: canvas.height, gray };
  }, png.toString("base64"));
}

// Was die Kamera gleich sehen wird, muss sich auch hier lesen lassen — sonst
// liegt ein Fehler am Bild, nicht an der Seite.
function readable(image) {
  const data = new Uint8ClampedArray(image.width * image.height * 4);
  image.gray.forEach((v, i) => { data.set([v, v, v, 255], i * 4); });
  return decodeQr({ data, width: image.width, height: image.height });
}

writeCamera(camera);
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: dist, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await launchBrowser({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${camera}`, "--disable-features=WebRtcHideLocalIpsWithMdns"] });

async function device(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2, permissions: ["camera"] });
  const page = await context.newPage();
  page.errors = watchErrors(page);
  await page.goto(`http://127.0.0.1:${port}/?dev=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.classList.contains("qr-join"), null, { timeout: 15000 });
  await page.fill("#player-name", name);
  return page;
}
const net = (p) => p.evaluate(() => globalThis.__tumblekinNetStatus());
// Wartet und sagt im Fehlerfall, worauf.
const step = (what, promise) => promise.catch((error) => { throw new Error(`${what}: ${error.message.split("\n")[0]}`); });
const state = (p) => p.evaluate(() => window.__tumblekin.state());

try {
  const host = await device("Bryan");
  const guest = await device("Lina");
  check(await guest.locator("#scan-qr").isVisible(), "Startbildschirm: „QR-Code scannen“ statt Codefeld");

  await host.click("#create-room");
  await host.waitForSelector("#screen-lobby.active");
  await host.waitForFunction(() => globalThis.__tumblekinNetStatus().invite, null, { timeout: 15000 });
  await host.click("#open-invite");
  await host.waitForFunction(() => {
    const img = document.querySelector("#qr-code");
    return img?.complete && img.naturalWidth > 0 && decodeURIComponent(img.src).includes("svg");
  }, null, { timeout: 10000 });
  // Die Karte springt beim Öffnen auf (von 90 % Grösse): erst abfotografieren,
  // wenn sie steht.
  await host.waitForFunction(() => Math.abs(document.querySelector("#qr-code").getBoundingClientRect().width - 260) < 1, null, { timeout: 10000 });
  await host.waitForTimeout(300);
  const invite = (await net(host)).invite;
  check(Boolean(invite) && invite.length < 260, `Einladung: ${invite?.length} Zeichen im QR-Code`);
  await host.screenshot({ path: path.join(work, "host-einladung.png") });
  const hostShot = await grab(host, "#qr-code");
  check(readable(hostShot) === invite, `Bild des Host-Codes lesbar (${hostShot.width}×${hostShot.height})`);
  writeCamera(camera, hostShot);

  // Gast scannt den Host.
  let t = Date.now();
  await guest.click("#scan-qr");
  await guest.waitForSelector(".qr-show.has-code img", { timeout: 30000 });
  check(true, `Gast hat den Code des Hosts gelesen (${Date.now() - t} ms) und zeigt seine Antwort`);
  await guest.waitForTimeout(400);
  await guest.screenshot({ path: path.join(work, "gast-antwort.png") });
  const guestShot = await grab(guest, ".qr-show .qr-code-box img");
  check(Boolean(readable(guestShot)?.startsWith("TK1|A|")), `Bild des Gast-Codes lesbar (${guestShot.width}×${guestShot.height})`);
  writeCamera(camera, guestShot);

  // Host scannt den Gast.
  t = Date.now();
  await host.click("#scan-guest");
  const joined = await guest.waitForSelector("#screen-lobby.active", { timeout: 40000 }).then(() => true, () => false);
  if (!joined) {
    const look = (p) => p.evaluate(() => ({
      overlay: document.querySelector(".qr-overlay")?.className || null,
      hint: document.querySelector(".qr-overlay .qr-hint")?.textContent || null,
      toast: document.querySelector("#toast")?.textContent || null,
      net: globalThis.__tumblekinNetStatus()
    }));
    console.log("Host:", JSON.stringify(await look(host)));
    console.log("Gast:", JSON.stringify(await look(guest)));
    await host.screenshot({ path: path.join(work, "host-haengt.png") });
    throw new Error("Gast kam nicht in die Lobby");
  }
  check(true, `Gast ist in der Lobby (${Date.now() - t} ms nach „Gast scannen“)`);
  await host.click("#invite-close").catch(() => {});
  await host.waitForFunction(() => window.__tumblekin.state()?.players.length === 2, null, { timeout: 15000 });
  const players = (await state(host)).players.map((p) => p.name);
  check(players.includes("Lina"), `Spieler beim Host: ${players.join(", ")}`);
  const ways = { host: await net(host), guest: await net(guest) };
  check(ways.guest.via === "rtc" && ways.host.guests.join() === "rtc", `Direkt verbunden: Gast ${ways.guest.via}, Host ${ways.host.guests.join()}`);
  check(Boolean(ways.host.invite) && ways.host.invite !== invite, "Host hat schon ein neues Angebot für den nächsten Gast");
  await guest.screenshot({ path: path.join(work, "gast-lobby.png") });

  // Eine Runde zusammen. Ohne Grafikkarte steht hier beim Aufbau der Szene
  // jede Seite bis zu 20 s still — eine kurze Nervenprobe ist dann vorbei,
  // bevor der Gast seinen Knopf sieht. Geprüft wird darum, dass die Eingabe
  // des Gasts beim Host ankommt (sein „Bereit“) und der Rundenverlauf beim
  // Gast (Spiel, Ergebnis, Lobby).
  await host.evaluate(async () => {
    await window.__tumblekin.request("selectMode", { mode: "single" });
    await window.__tumblekin.request("updateSettings", { settings: { single: "nervenprobe" } });
    await window.__tumblekin.request("startGame");
  });
  for (const p of [host, guest]) await step("Startkarte", p.waitForFunction(() => window.__tumblekin.state()?.phase === "waitingReady", null, { timeout: 30000 }));
  await step("Bereit beim Gast", guest.click("#intro-ready"));
  await step("Bereit des Gasts beim Host", host.waitForFunction(() => {
    const s = window.__tumblekin.state();
    const lina = s?.players.find((p) => p.name === "Lina");
    return Boolean(lina && s.readyForMinigame?.includes(lina.id));
  }, null, { timeout: 15000 }));
  check(true, "„Bereit“ des Gasts kam beim Host an");
  await step("Bereit beim Host", host.click("#intro-ready"));
  await step("Spielbeginn beim Gast", guest.waitForFunction(() => window.__tumblekin.state()?.phase === "playingMinigame", null, { timeout: 60000 }));
  check(true, "Runde läuft auch beim Gast");
  const result = await guest.waitForFunction(() => ["minigameResult", "lobby"].includes(window.__tumblekin.state()?.phase), null, { timeout: 120000 }).then(() => true, () => false);
  check(result, "Ergebnis der Runde beim Gast angekommen");
  const both = await guest.waitForFunction(() => window.__tumblekin.state()?.players.length === 2, null, { timeout: 10000 }).then(() => true, () => false);
  check(both, "Gast sieht weiter beide Spieler");

  // Der Host geht: der Gast landet wieder am Start.
  await host.close();
  const back = await guest.waitForFunction(() => !window.__tumblekin.state(), null, { timeout: 25000 }).then(() => true, () => false);
  check(back, "Host weg: Gast ist wieder am Start");
  check(host.errors.length === 0 && guest.errors.length === 0, `keine Fehler in den Seiten (${JSON.stringify([...host.errors, ...guest.errors]).slice(0, 200)})`);
} catch (error) {
  failures.push(error.message);
  console.log("FEHLER  " + error.message.split("\n")[0]);
  for (const [name, context] of [["Host", browser.contexts()[0]], ["Gast", browser.contexts()[1]]]) {
    const page = context?.pages()[0];
    if (!page || page.isClosed()) continue;
    await page.screenshot({ path: path.join(work, `fehler-${name}.png`) }).catch(() => {});
    console.log(name + " Fehler:", JSON.stringify(page.errors || []).slice(0, 400));
    console.log(name + ":", JSON.stringify(await page.evaluate(() => {
      const s = window.__tumblekin.state();
      const m = window.__tumblekin.activeMinigame?.();
      return { phase: s?.phase, startedAt: s?.currentMinigame?.startedAt, type: s?.currentMinigame?.type, scene: Boolean(m), now: m?.now?.(), date: Date.now(), net: globalThis.__tumblekinNetStatus() };
    }).catch((e) => e.message)));
  }
} finally {
  await browser.close();
  srv.kill();
}
console.log(failures.length ? `\n${failures.length} Fehler · Bilder: ${work}` : `\nQR-Kopplung funktioniert · Bilder: ${work}`);
process.exit(failures.length ? 1 : 0);
