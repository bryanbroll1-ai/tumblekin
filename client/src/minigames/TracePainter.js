import * as THREE from "/vendor/three/three.module.js";
import { createNameLabel } from "./VoxelKit.js?v=tumblekin213";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin213";
import { frameLerp } from "./Quality.js?v=tumblekin213";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin213";
import "./SketchFigures.js?v=tumblekin213";

// Spurmaler: ein riesiger Bleistift zeichnet auf der Staffelei eine Figur
// vor — Welle, Herz, Stern, Blitz, Schnecke, das Haus vom Nikolaus … Danach
// fährt jeder sie mit dem Finger auf dem grossen Blatt nach, so genau er
// kann; die Vorlage bleibt blass zu sehen. Gewertet wird auf dem Server
// (SketchFigures.scoreStroke): wie viel der Figur man getroffen hat und wie
// wenig daneben ging. Drei Figuren, jede kniffliger.
//
// Die Bilder der anderen hängen klein über dem Blatt und füllen sich, während
// sie malen.
const S = globalThis.TumblekinSketchFigures;
const BOARD = 3.2;                 // Kantenlänge des Blatts
const BOARD_Y = 2.25;              // Mitte des Blatts
const MINI = 0.86;                 // Kantenlänge der kleinen Bilder
const MINI_Y = BOARD_Y + BOARD / 2 + 0.72;
const TEX = 512;
const MINI_TEX = 128;
const SEND_EVERY_MS = 70;
const MIN_STEP = 0.006;            // so weit muss der Finger mindestens weiter

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Ein Blatt Papier als Leinwand-Textur.
function makeSheet(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, ctx: canvas.getContext("2d"), texture, key: "" };
}

function paper(ctx, size) {
  ctx.fillStyle = "#fffaf0";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(120, 150, 190, 0.12)";
  ctx.lineWidth = Math.max(1, size / 256);
  const step = size / 16;
  ctx.beginPath();
  for (let i = 1; i < 16; i += 1) {
    ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size);
    ctx.moveTo(0, i * step); ctx.lineTo(size, i * step);
  }
  ctx.stroke();
}

function polyline(ctx, size, points, upTo = points.length) {
  if (!points.length || upTo < 1) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0] * size, points[0][1] * size);
  for (let i = 1; i < Math.min(points.length, upTo); i += 1) ctx.lineTo(points[i][0] * size, points[i][1] * size);
  if (upTo === 1) ctx.lineTo(points[0][0] * size + 0.1, points[0][1] * size);
  ctx.stroke();
}

export class TracePainter extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.ownInView = false;
    this.drag = null;
    this.strokes = [];             // eigene Striche dieses Durchgangs
    this.pending = [];             // noch nicht geschickte Punkte
    this.pendingStart = false;
    this.lastSentAt = 0;
    this.localRound = -1;
    this.openRound = -1;
    this.roundTrip = 0;
    this.lastPingAt = 0;
    this.seenScored = -1;
    this.paths = [];
    this.minis = new Map();
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Spurmaler",
      background: "#f3e2c8",
      fog: ["#f3e2c8", 18, 46],
      lights: { sunPosition: [-3, 10, 9], sunIntensity: 2.5, hemiIntensity: 2.2, skyColor: 0xfff4e0, groundColor: 0x8a6a4a, shadow: { left: -4, right: 4, top: 6, bottom: -1 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-sketch-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame.arcade;
    this.paths = (arcade.sketch?.figures || []).map((name) => S.figurePath(name));
    this.buildStudio(scene);

    // Die Staffelei mit dem grossen Blatt.
    const holz = "#a0703f";
    [[-1.25, 0.12], [1.25, -0.12]].forEach(([x, tilt]) => {
      const bein = kiste(scene, 0.12, BOARD_Y + BOARD / 2 + 0.3, 0.12, holz, [x, (BOARD_Y + BOARD / 2 + 0.3) / 2, -0.25]);
      bein.rotation.z = tilt;
    });
    kiste(scene, BOARD + 0.4, 0.12, 0.3, holz, [0, BOARD_Y - BOARD / 2 - 0.08, 0.02]);
    kiste(scene, BOARD + 0.24, BOARD + 0.24, 0.1, "#7a5330", [0, BOARD_Y, -0.08]);
    this.sheet = makeSheet(TEX);
    const blatt = new THREE.Mesh(new THREE.PlaneGeometry(BOARD, BOARD), new THREE.MeshLambertMaterial({ map: this.sheet.texture }));
    blatt.position.set(0, BOARD_Y, -0.02);
    blatt.receiveShadow = true;
    scene.add(blatt);
    this.blatt = blatt;

    // Der riesige Bleistift.
    this.pencil = this.makePencil();
    this.pencil.position.set(BOARD / 2 - 0.15, BOARD_Y - BOARD / 2 + 0.25, 0.45);
    scene.add(this.pencil);

    // Die Bilder der anderen, klein über dem Blatt.
    const players = this.getState()?.players || [];
    const own = this.getControlledPlayerId();
    this.own = own;
    const others = players.filter((player) => player.id !== own);
    others.forEach((player, i) => {
      const x = (i - (others.length - 1) / 2) * (MINI + 0.28);
      kiste(scene, MINI + 0.1, MINI + 0.1, 0.06, player.color, [x, MINI_Y, -0.12], { schatten: false });
      const sheet = makeSheet(MINI_TEX);
      const bild = new THREE.Mesh(new THREE.PlaneGeometry(MINI, MINI), new THREE.MeshBasicMaterial({ map: sheet.texture }));
      bild.position.set(x, MINI_Y, -0.08);
      scene.add(bild);
      const tag = createNameLabel(String(player.name || "?").slice(0, 8), player.color);
      tag.position.set(x, MINI_Y - MINI / 2 - 0.16, 0.02);
      tag.scale.multiplyScalar(0.6);
      scene.add(tag);
      this.minis.set(player.id, { sheet, bild });
    });

    // Die Figuren stehen unten vor der Staffelei.
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * 0.78;
      this.addKin(player, index, { x, ground: 0, z: 1.0, facing: 0, scale: 0.72, label: false });
      if (player.id === own) {
        const spot = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 28), new THREE.MeshBasicMaterial({ color: "#ffe25c", transparent: true, opacity: 0.85 }));
        spot.rotation.x = -Math.PI / 2;
        spot.position.set(x, 0.015, 1.0);
        scene.add(spot);
      }
    });
    this.drawSheet(true);
  }

  // Ein Malatelier: Holzboden, Wand mit Bildern, Farbtöpfe und ein Regal.
  buildStudio(scene) {
    const zufall = streuer(31);
    ["#c69a6b", "#b98d5e"].forEach((farbe, i) => {
      viele(scene, new THREE.BoxGeometry(0.6, 0.1, 9), lambert(farbe), Array.from({ length: 14 }, (_, k) => k).filter((k) => k % 2 === i).map((k) => ({ p: [-4.2 + k * 0.6, -0.05, 1.5] })), { empfangen: true });
    });
    kiste(scene, 14, 7, 0.3, "#f6e7cf", [0, 3.4, -1.2], { schatten: false });
    kiste(scene, 14, 0.5, 0.34, "#d9c3a2", [0, 0.25, -1.18], { schatten: false });
    // Bilder an der Wand links und rechts.
    [[-3.1, 3.6, "#7ab8e8", "#ffd15c"], [3.1, 3.2, "#ff9fb0", "#71d97b"], [-3.0, 1.7, "#b57bff", "#ffffff"]].forEach(([x, y, a, b]) => {
      kiste(scene, 1.2, 0.9, 0.08, "#8a5a32", [x, y, -1.0], { schatten: false });
      kiste(scene, 1.0, 0.7, 0.04, a, [x, y, -0.95], { schatten: false });
      kiste(scene, 0.36, 0.36, 0.03, b, [x + 0.15, y - 0.05, -0.92], { schatten: false });
    });
    // Farbtöpfe und Pinsel.
    [[-2.2, 0.5, "#ff5d73"], [-1.85, 0.75, "#28c7d9"], [2.0, 0.6, "#ffd15c"], [2.35, 0.4, "#71d97b"]].forEach(([x, z, farbe]) => {
      kiste(scene, 0.26, 0.24, 0.26, "#d9dde2", [x, 0.12, z]);
      kiste(scene, 0.22, 0.02, 0.22, farbe, [x, 0.245, z], { schatten: false });
      const pinsel = kiste(scene, 0.035, 0.42, 0.035, "#8a6238", [x + 0.05, 0.36, z], { schatten: false });
      pinsel.rotation.z = -0.35 + zufall() * 0.3;
    });
    // Ein Regal mit Papierrollen rechts.
    kiste(scene, 1.0, 0.08, 0.4, "#8a5a32", [3.0, 1.0, -0.9]);
    ["#fffaf0", "#ffe9c4", "#d8ecff"].forEach((farbe, i) => {
      const rolle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8), lambert(farbe));
      rolle.rotation.z = Math.PI / 2;
      rolle.position.set(3.0, 1.12 + i * 0.02, -0.95 + i * 0.12);
      scene.add(rolle);
    });
  }

  // Ein Bleistift aus Blöcken: gelber Schaft, Metallring, rosa Radiergummi,
  // Holzspitze mit Mine. Der Ursprung liegt an der Minenspitze.
  makePencil() {
    const group = new THREE.Group();
    const stift = new THREE.Group();
    group.add(stift);
    kiste(stift, 0.07, 0.12, 0.07, "#2b2b36", [0, 0.06, 0]);
    const spitze = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.32, 6), lambert("#e8c48e"));
    spitze.rotation.x = Math.PI;
    spitze.position.y = 0.26;
    spitze.castShadow = true;
    stift.add(spitze);
    kiste(stift, 0.27, 1.7, 0.27, "#ffc928", [0, 1.27, 0]);
    [-1, 1].forEach((side) => kiste(stift, 0.03, 1.7, 0.275, "#f2a900", [side * 0.07, 1.27, 0], { schatten: false }));
    kiste(stift, 0.29, 0.16, 0.29, "#c9ced6", [0, 2.18, 0]);
    kiste(stift, 0.27, 0.24, 0.27, "#ff8fa8", [0, 2.38, 0]);
    // Schräg zum Blatt geneigt, wie eine Hand ihn hält.
    stift.rotation.set(0.45, 0, -0.42);
    return group;
  }

  // Wo auf dem Blatt ein Punkt (0..1, y nach unten) in der Welt liegt.
  sheetToWorld(u, v, into = new THREE.Vector3()) {
    return into.set((u - 0.5) * BOARD, BOARD_Y + (0.5 - v) * BOARD, 0);
  }

  shot() {
    return {
      look: [0, (MINI_Y + MINI / 2 + 0.1) / 2, 0],
      frame: { w: BOARD + 0.5, h: MINI_Y + MINI / 2 + 0.2 },
      fill: 0.97,
      pitch: 0.04,
      fov: 38,
      intro: { yaw: 0.3, pitch: 0.12, zoom: 1.25 },
      finale: { pull: 0.85, zoom: 0.8, lift: 0.1, orbit: 0.08 }
    };
  }

  keepInView() {
    return [];
  }

  // --- Phasen ------------------------------------------------------------

  phaseOf(at) {
    const minigame = this.update || this.minigame;
    const sketch = minigame?.arcade?.sketch;
    if (!sketch) return { phase: "lead", round: 0, since: 0 };
    const elapsed = at - minigame.startedAt;
    const cycle = sketch.drawMs + sketch.traceMs + sketch.scoreMs;
    const t = elapsed - sketch.leadMs;
    if (t < 0) return { phase: "lead", round: 0, since: elapsed };
    const round = Math.floor(t / cycle);
    if (round >= sketch.rounds) return { phase: "over", round: sketch.rounds - 1, since: t - sketch.rounds * cycle };
    const inner = t - round * cycle;
    if (inner < sketch.drawMs) return { phase: "draw", round, since: inner };
    if (inner < sketch.drawMs + sketch.traceMs) return { phase: "trace", round, since: inner - sketch.drawMs, left: sketch.drawMs + sketch.traceMs - inner };
    return { phase: "score", round, since: inner - sketch.drawMs - sketch.traceMs };
  }

  // Die Phase zu dem Moment, in dem ein JETZT geschickter Punkt ankommt.
  arrivalPhase() {
    return this.phaseOf(this.now() + this.roundTrip);
  }

  canTrace() {
    const minigame = this.update || this.minigame;
    return Boolean(minigame && !minigame.finaleAt && this.arrivalPhase().phase === "trace");
  }

  // --- Eingabe -------------------------------------------------------------

  bind() {
    this.controls.innerHTML = `<p class="trace-hint" data-sketch-hint>Fahr die Figur mit dem Finger nach</p>`;
    this.controls.style.pointerEvents = "none";
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0.02);
    const sheetAt = (event) => {
      const rect = this.webglCanvas.getBoundingClientRect();
      this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
      return [clamp(hit.x / BOARD + 0.5, 0, 1), clamp(0.5 - (hit.y - BOARD_Y) / BOARD, 0, 1)];
    };
    this.webglCanvas.style.touchAction = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      if (this.drag) return;
      this.drag = { pointerId: event.pointerId, last: null, fresh: true };
      this.capturePointer(this.webglCanvas, event.pointerId);
      this.addPoint(sheetAt(event));
    });
    this.on(this.webglCanvas, "pointermove", (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      // Bei schnellen Bewegungen liefert der Browser Zwischenpunkte mit.
      const events = event.getCoalescedEvents?.() || [event];
      events.forEach((e) => this.addPoint(sheetAt(e)));
    });
    const release = (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      this.flush(true);
    };
    this.on(this.webglCanvas, "pointerup", release);
    this.on(this.webglCanvas, "pointercancel", release);
    this.on(this.webglCanvas, "lostpointercapture", release);
    const interrupt = () => { if (this.drag) release({ pointerId: this.drag.pointerId }); };
    this.on(window, "blur", interrupt);
    this.on(window, "resize", interrupt);
    this.on(document, "visibilitychange", () => { if (document.hidden) interrupt(); });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
  }

  // Ein Punkt unter dem Finger. Gemalt wird nur im Nachfahrfenster; davor
  // bleibt das Blatt leer, damit niemand über die noch laufende Vorlage malt.
  addPoint(point) {
    if (!point || !this.drag || !this.canTrace()) return;
    const last = this.drag.last;
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < MIN_STEP) return;
    if (this.drag.fresh || !last || !this.strokes.length) {
      // Ein neuer Strich: was vom alten noch wartet, geht vorher hinaus,
      // damit die Server-Markierung „neuer Strich“ am richtigen Punkt sitzt.
      this.flush(true);
      this.drag.fresh = false;
      this.strokes.push([]);
      this.pendingStart = true;
    }
    const rounded = [Math.round(point[0] * 1000) / 1000, Math.round(point[1] * 1000) / 1000];
    this.strokes[this.strokes.length - 1].push(rounded);
    this.pending.push(rounded);
    this.drag.last = rounded;
    this.sheetDirty = true;
    if (performance.now() - this.lastSentAt > SEND_EVERY_MS || this.pending.length >= 40) this.flush(false);
  }

  flush(force) {
    if (!this.pending.length) return;
    if (!force && performance.now() - this.lastSentAt < SEND_EVERY_MS) return;
    const pts = this.pending.splice(0, 48);
    const start = this.pendingStart;
    this.pendingStart = false;
    const clock = performance.now();
    this.lastSentAt = clock;
    this.sendInput({ action: "stroke", pts, start }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
    if (this.pending.length) this.flush(true);
  }

  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.roundTrip ? this.roundTrip * 0.8 + clamped * 0.2 : clamped;
  }

  pingIfIdle(minigame) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.lastSentAt < 1000 || clock - this.lastPingAt < 1000) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Schliesst das Fenster (nach Ankunftszeit), geht der Rest noch hinaus.
  syncWindow(f) {
    const open = this.arrivalPhase().phase === "trace" && !f.finale;
    if (open) {
      this.openRound = this.arrivalPhase().round;
      return;
    }
    if (this.openRound < 0) return;
    this.openRound = -1;
    this.flush(true);
    if (this.drag) this.drag.last = null;
  }

  // --- Zeichnen ------------------------------------------------------------

  // Das grosse Blatt: Papier, die Vorlage (beim Vorzeichnen so weit, wie der
  // Stift ist, danach blass), die eigenen Striche, bei der Wertung die
  // Vorlage kräftig darüber.
  drawSheet(force = false) {
    const { phase, round, since } = this.phaseOf(this.now());
    const sketch = (this.update || this.minigame)?.arcade?.sketch;
    const path = this.paths[round] || [];
    const share = phase === "draw" ? clamp(since / ((sketch?.drawMs || 2600) * 0.85), 0, 1) : phase === "lead" ? 0 : 1;
    const upTo = Math.ceil(share * path.length);
    const key = `${phase}|${round}|${upTo}|${this.strokes.reduce((n, s) => n + s.length, 0)}`;
    if (!force && !this.sheetDirty && key === this.sheet.key) return;
    this.sheet.key = key;
    this.sheetDirty = false;
    const { ctx } = this.sheet;
    paper(ctx, TEX);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (phase === "draw") {
      ctx.strokeStyle = "#2b2b36";
      ctx.lineWidth = 11;
      polyline(ctx, TEX, path, upTo);
    } else if (phase === "trace" || phase === "score" || phase === "over") {
      // Die Toleranz als breites, blasses Band, darüber die gestrichelte Linie.
      ctx.strokeStyle = "rgba(43, 43, 54, 0.1)";
      ctx.lineWidth = (sketch?.tolerance || 0.024) * 2 * TEX;
      polyline(ctx, TEX, path);
      ctx.setLineDash([12, 12]);
      ctx.strokeStyle = "rgba(43, 43, 54, 0.38)";
      ctx.lineWidth = 6;
      polyline(ctx, TEX, path);
      ctx.setLineDash([]);
      if (phase === "trace" && path.length) {
        // Startpunkt: hier fängt die Figur an.
        ctx.fillStyle = "#1fbf5b";
        ctx.beginPath();
        ctx.arc(path[0][0] * TEX, path[0][1] * TEX, 13, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const own = (this.getState()?.players || []).find((p) => p.id === this.own);
    ctx.strokeStyle = own?.color || "#ff5d73";
    ctx.lineWidth = 10;
    this.strokes.forEach((stroke) => polyline(ctx, TEX, stroke));
    if (phase === "score") {
      ctx.strokeStyle = "rgba(43, 43, 54, 0.85)";
      ctx.lineWidth = 4;
      polyline(ctx, TEX, path);
    }
    this.sheet.texture.needsUpdate = true;
  }

  drawMinis(arcade, players, phase, round) {
    players.forEach((player) => {
      const mini = this.minis.get(player.id);
      if (!mini) return;
      const entry = arcade.players[player.id];
      const trail = entry?.strokeRound === round && phase !== "draw" && phase !== "lead" ? entry.trail || "" : "";
      const key = `${phase === "draw" ? "d" : "t"}|${round}|${trail}`;
      if (mini.sheet.key === key) return;
      mini.sheet.key = key;
      const { ctx } = mini.sheet;
      paper(ctx, MINI_TEX);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (phase !== "lead" && phase !== "draw") {
        ctx.strokeStyle = "rgba(43, 43, 54, 0.3)";
        ctx.lineWidth = 2;
        polyline(ctx, MINI_TEX, this.paths[round] || []);
      }
      ctx.strokeStyle = player.color;
      ctx.lineWidth = 4;
      S.unpackStrokes(trail).forEach((stroke) => polyline(ctx, MINI_TEX, stroke));
      mini.sheet.texture.needsUpdate = true;
    });
  }

  // Der Bleistift: beim Vorzeichnen sitzt seine Spitze auf der Linie, danach
  // hebt er ab und wartet oben rechts.
  movePencil(phase, round, since, dt, now) {
    const sketch = (this.update || this.minigame)?.arcade?.sketch;
    const path = this.paths[round] || [];
    // Ausserhalb des Zeichnens lehnt er rechts unten am Blattrand.
    const want = new THREE.Vector3(BOARD / 2 - 0.15, BOARD_Y - BOARD / 2 + 0.25, 0.45);
    let drawing = false;
    if (phase === "draw" && path.length) {
      const share = since / ((sketch?.drawMs || 2600) * 0.85);
      if (share <= 1) {
        const at = path[Math.min(path.length - 1, Math.floor(share * path.length))];
        this.sheetToWorld(at[0], at[1], want);
        want.z = 0.02;
        drawing = true;
      }
    }
    const follow = drawing ? 0.7 : 0.12;
    this.pencil.position.lerp(want, frameLerp(follow, dt));
    this.pencil.rotation.z = drawing ? Math.sin(now / 90) * 0.03 : Math.sin(now / 700) * 0.05;
  }

  // --- Lauf ---------------------------------------------------------------

  tick(f) {
    const { now, dt, arcade, players, controlledId } = f;
    const sketch = arcade?.sketch;
    if (!sketch) return;
    if (!this.paths.length && sketch.figures) this.paths = sketch.figures.map((name) => S.figurePath(name));
    this.syncWindow(f);
    this.flush(false);
    this.pingIfIdle(f.minigame);
    const { phase, round, since } = this.phaseOf(now);

    // Neuer Durchgang: leeres Blatt.
    if (this.localRound !== round && (phase === "draw" || phase === "trace")) {
      this.localRound = round;
      this.strokes = [];
      this.pending = [];
      if (this.drag) this.drag.last = null;
      this.sheetDirty = true;
      this.feedback?.sound("sparkle");
    }
    this.drawSheet();
    this.drawMinis(arcade, players, phase, round);
    this.movePencil(phase, round, since, dt, now);

    // Gewertet: Punkte über dem Blatt, die Figuren reagieren.
    if (sketch.scored > this.seenScored && sketch.scored >= 0) {
      this.seenScored = sketch.scored;
      const results = players.map((player) => ({ player, points: arcade.players[player.id]?.results?.[sketch.scored]?.points ?? 0 }));
      const best = Math.max(...results.map((r) => r.points));
      results.forEach(({ player, points }) => {
        const animator = this.animators.get(player.id);
        const isOwn = player.id === controlledId;
        if (isOwn) {
          this.pop(new THREE.Vector3(0, BOARD_Y + 0.3, 0.6), `+${points}`, { color: points >= 75 ? "#ffe36b" : points >= 45 ? "#ffffff" : "#ffb3bd", size: 0.6, life: 1.6, rise: 0.5 });
          this.feedback?.sound(points >= 75 ? "perfect" : points >= 45 ? "coin" : "error");
          this.feedback?.vibrate(points >= 75 ? [10, 30, 10] : 12);
          if (points >= 75) this.burst(new THREE.Vector3(0, BOARD_Y, 0.5), ["#ffe25c", "#ff5d73", "#28c7d9", "#ffffff"], { count: 24, speed: 2.2, up: 1.8, size: 0.07, life: 1 });
        } else {
          const mini = this.minis.get(player.id);
          if (mini) this.pop(mini.bild.position.clone().add(new THREE.Vector3(0, 0.1, 0.3)), `+${points}`, { color: "#ffffff", size: 0.3, life: 1.4 });
        }
        if (animator) {
          if (points === best && best > 0) { animator.trigger("fistpump"); animator.expression("joy", 1500); }
          else if (points < 35) { animator.trigger("facepalm"); animator.expression("sad", 1400); }
          else { animator.trigger("clap"); animator.expression("happy", 1000); }
        }
      });
    }

    if (f.finale) return;
    players.forEach((player) => {
      const animator = this.animators.get(player.id);
      if (!animator) return;
      if (phase === "trace") {
        animator.set(player.id === controlledId && this.drag ? "reach" : "think");
        animator.lookAt(this.blatt.position);
      } else if (phase === "draw") {
        animator.set("focus");
        animator.lookAt(this.pencil.position);
      } else {
        animator.set("idle");
        animator.lookAt(null);
      }
    });
  }

  drawHud(f) {
    const { arcade, controlledId, minigame } = f;
    const sketch = arcade?.sketch;
    if (!sketch) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(Math.round(own?.score || 0));
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const banner = this.hud.querySelector("[data-sketch-banner]");
    const { phase, round, since } = this.phaseOf(f.now);
    const arrival = this.arrivalPhase();
    const name = S.NAMES[sketch.figures?.[round]] || "Figur";
    let message = null;
    let tone = "#12aaff";
    if (phase === "lead") message = "Gleich zeichnet der Stift vor …";
    else if (phase === "draw") { message = `Figur ${round + 1}/${sketch.rounds}: ${name} — schau zu!`; tone = "#b57bff"; }
    else if (phase === "trace") {
      const secs = Math.ceil((arrival.phase === "trace" ? arrival.left : 0) / 1000);
      message = since < 1300 ? "Fahr nach — beim grünen Punkt anfangen!" : secs <= 3 ? (secs <= 0 ? "Stopp!" : `Noch ${secs} …`) : null;
      tone = secs <= 3 ? "#ff5d73" : "#1fbf5b";
    } else if (phase === "score") {
      const result = own?.results?.[round];
      if (result) {
        const points = result.points;
        message = points >= 85 ? `Meisterhaft! +${points}` : points >= 60 ? `Gut getroffen! +${points}` : points >= 35 ? `Na ja … +${points}` : `Daneben … +${points}`;
        tone = points >= 60 ? "#ffc400" : points >= 35 ? "#12aaff" : "#ff5d73";
      }
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
      banner.style.color = tone === "#ffc400" ? "#5c4508" : "#ffffff";
    }
    this.hintNode ||= this.controls.querySelector("[data-sketch-hint]");
    if (this.hintNode) {
      const hint = phase === "trace" ? "Fahr die Figur mit dem Finger nach" : phase === "draw" ? "Schau zu, wie der Stift zeichnet" : " ";
      if (this.hintNode.textContent !== hint) this.hintNode.textContent = hint;
    }
  }
}
