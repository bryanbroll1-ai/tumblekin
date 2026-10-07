import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin211";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin211";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin211";

// Spurmaler: der Farbroller fährt von selbst die Spur hinauf, man LENKT ihn —
// irgendwo auf dem Bildschirm nach links oder rechts wischen.
//
// Vorher war der Finger selbst der Pinsel: er lag auf der Spur, verdeckte sie,
// musste in einem an Engstellen fingerbreiten Band bleiben, und jeder Ausrutscher
// riss den Strich mit Sperre und Wiedereinstieg ab. Jetzt gibt es kein Abreissen
// mehr. Jeder Abschnitt der Spur wird gewertet und färbt sich: kräftig in der
// eigenen Farbe (perfekt), hell (gut) oder grau (daneben). Wer auf der Linie
// bleibt, baut eine Serie auf (×2, ×3); wer daneben fährt, verliert sie, fährt
// aber einfach weiter.
const TOLERANCE = 0.09;
const BOARD_W = 3.0;
// Am gemessenen Bild gerechnet: die Tafel darf NICHT das ganze Fenster füllen.
// Oben sitzt die Kopfzeile des Minispiels, unten die Hinweiszeile.
const BOARD_H = 5.2;
const SEGMENTS = 80;          // Auflösung von Band und Spur (Vielfaches von CELLS)
const CELLS = 40;             // gewertete Abschnitte je Runde — wie auf dem Server
const STEER_SPEED = 2.2;      // wie auf dem Server: so schnell folgt der Pinsel
const PERFECT = 0.4;
// Tempo in Runden je Sekunde, wie auf dem Server — gebraucht, um den eigenen
// Roller vorauszurechnen.
const SPEED_BASE = 0.2;
const SPEED_STEP = 0.025;
const SPEED_MAX = 0.34;
// Wie auf dem Server: verglichen wird auch mit der Spur ein kleines Stück
// hinter dem Pinsel. Der Leuchtring muss dieselbe Nachsicht zeigen, die der
// Server gewährt, sonst meldet er „daneben", wo es noch zählt.
const LAG_WINDOW = 0.03;
const GEM_REACH = 0.035;

function noise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Muss Zeichen für Zeichen der Serverfunktion entsprechen, sonst malt der
// Client eine andere Kurve als die, die gewertet wird.
function rawPathX(seed, lap, t) {
  const s = seed + lap * 97;
  const swing = 0.16 + noise(s) * 0.1;
  const detail = 0.015 + noise(s + 11) * 0.03;
  const phase = noise(s + 23) * Math.PI * 2;
  const bows = 1 + Math.floor(noise(s + 37) * 1.999);
  const raw = Math.sin(t * Math.PI * bows + phase) * swing
    + Math.sin(t * Math.PI * (bows * 2 + 1) + phase * 1.7) * detail;
  return clamp(0.5 + raw, 0.5 - (swing + detail), 0.5 + (swing + detail));
}

// Jede Runde beginnt dort, wo die vorige endet (wie auf dem Server).
function pathX(seed, lap, t) {
  const raw = rawPathX(seed, lap, t);
  if (lap <= 0) return raw;
  const shift = rawPathX(seed, lap - 1, 1) - rawPathX(seed, lap, 0);
  const fade = Math.max(0, 1 - t / 0.2);
  return raw + shift * fade * fade * (3 - 2 * fade);
}

// Ebenfalls wie auf dem Server: an Engstellen wird das Band schmaler, und dort
// MUSS das Bild schmaler werden.
const NARROW_MIN = 0.5;
function widthAt(seed, lap, t) {
  const s = seed + lap * 97;
  const knots = 2 + Math.floor(noise(s + 61) * 2);
  const phase = noise(s + 71) * Math.PI * 2;
  const wave = (Math.cos(t * Math.PI * 2 * knots + phase) + 1) / 2;
  const edge = Math.min(1, Math.min(t, 1 - t) / 0.12);
  const narrow = NARROW_MIN + (1 - NARROW_MIN) * wave;
  return narrow + (1 - narrow) * (1 - edge);
}

function speedFor(lap) {
  return Math.min(SPEED_MAX, SPEED_BASE + SPEED_STEP * lap);
}

function lagOffset(seed, lap, x, t) {
  let best = Infinity;
  for (let i = 0; i <= 4; i += 1) {
    const at = clamp(t - LAG_WINDOW * (i / 4), 0, 1);
    best = Math.min(best, Math.abs(x - pathX(seed, lap, at)));
  }
  return best;
}

const boardX = (nx) => (nx - 0.5) * BOARD_W;
// Das Brett liegt flach: t = 0 vorn bei der Kamera, t = 1 hinten.
const boardZ = (t) => BOARD_H / 2 - t * BOARD_H;

const _open = new THREE.Color("#546472");
const _bandOpen = new THREE.Color("#c3d3e2");
const _miss = new THREE.Color("#a9b1b8");
const _white = new THREE.Color("#ffffff");

export class TracePainter extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.drawnLap = -1;
    // null, nicht "": sonst hielt paintRibbons die leere Wertung zu Beginn
    // für schon gemalt, und die Spur blieb bis zum ersten Abschnitt schwarz.
    this.paintedKey = null;
    this.lastMissAt = 0;
    this.lastLapAt = 0;
    this.lastGemAt = 0;
    this.drag = null;
    this.keyDir = 0;
    this.localTarget = null;   // wohin der eigene Finger gerade lenkt
    this.localBrush = null;    // vorhergesagte Querposition des eigenen Pinsels
    this.shownProgress = 0;
    this.shownTotal = null;    // gezeigte Runde + Fortschritt, vorausgerechnet
    this.shownLap = 0;
    this.localCells = [];      // vorläufige Wertung der Abschnitte, bis der Server sie bestätigt
    this.localGems = new Map();  // Kristalle, die der eigene Roller schon eingesammelt haben dürfte
    this.roundTrip = 0;
    this.sentTarget = null;
    this.sentAt = 0;
    this.shownCombo = 1;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Spurmaler",
      background: "#6b4f3a",
      fog: ["#6b4f3a", 22, 60],
      lights: { sunPosition: [-4, 12, 9], shadow: { left: -5, right: 5, top: 5, bottom: -5 }, hemiIntensity: 2.6 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="trace-lapbar" data-trace-laps></div>
      <div class="trace-combo" data-trace-combo hidden></div>
      <div class="color-banner trace-banner" data-trace-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    // Die Leinwand liegt auf dem Arbeitstisch eines Malerateliers — vorher lag
    // sie auf einer Wiese, und um sie herum war nichts.
    this.buildStudio(scene);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.6, 0.16, BOARD_H + 0.6), new THREE.MeshLambertMaterial({ color: "#8a6b4a" }));
    frame.position.y = -0.1;
    scene.add(frame);
    const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.34, 0.1, BOARD_H + 0.34), new THREE.MeshLambertMaterial({ color: "#fdf6e6" }));
    board.position.y = -0.05;
    board.receiveShadow = true;
    scene.add(board);
    // Start- und Ziellinie: man sieht, wo eine Runde anfängt und wo sie endet.
    [[boardZ(0) + 0.05, "#ffffff"], [boardZ(1) - 0.05, "#ffd15c"]].forEach(([z, color]) => {
      const line = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.2, 0.012, 0.06), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      line.position.set(0, 0.006, z);
      scene.add(line);
    });
    this.buildRibbons();
    this.buildGems();

    // Die eigene Figur mit Farbroller.
    const players = this.getState()?.players || [];
    const index = Math.max(0, players.findIndex((player) => player.id === this.getControlledPlayerId()));
    const me = players[index];
    this.ownColor = me?.color || "#ff5d73";
    if (me) {
      const kin = this.addKin(me, index, { x: 0, ground: 0, z: boardZ(0), facing: Math.PI, scale: 0.72 });
      const roller = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), new THREE.MeshLambertMaterial({ color: "#6b4f35" }));
      handle.position.set(0, -0.12, 0.34);
      handle.rotation.x = 0.55;
      roller.add(handle);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 12), new THREE.MeshLambertMaterial({ color: this.ownColor }));
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, -0.2, 0.56);
      roller.add(drum);
      kin.add(roller);
      this.drum = drum;
      // Ein Leuchtring unter dem Roller: grün auf der Linie, rot daneben. Den
      // sieht man auch aus dem Augenwinkel, während der Blick nach vorn geht.
      this.cursor = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.16, 24),
        new THREE.MeshBasicMaterial({ color: "#7fe06f", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })
      );
      this.cursor.rotation.x = -Math.PI / 2;
      scene.add(this.cursor);
    }
  }

  buildRibbons() {
    const make = (halfWidth, lift, opacity) => {
      const count = SEGMENTS + 1;
      const positions = new Float32Array(count * 2 * 3);
      const colors = new Float32Array(count * 2 * 3);
      const indices = [];
      for (let i = 0; i < SEGMENTS; i += 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      mesh.position.y = lift;
      this.scene.add(mesh);
      return { mesh, geometry, halfWidth, scaleWidth: false };
    };
    this.band = make(TOLERANCE, 0.012, 0.55);
    this.band.scaleWidth = true;
    // Der „perfekt"-Streifen in der Mitte des Bandes: dort soll der Roller hin.
    this.core = make(TOLERANCE * PERFECT, 0.016, 0.35);
    this.core.scaleWidth = true;
    this.trail = make(0.034, 0.024, 1);
  }

  layoutRibbons(seed, lap) {
    [this.band, this.core, this.trail].forEach((ribbon) => {
      const pos = ribbon.geometry.attributes.position;
      for (let i = 0; i <= SEGMENTS; i += 1) {
        const t = i / SEGMENTS;
        const px = pathX(seed, lap, t);
        const half = ribbon.scaleWidth ? ribbon.halfWidth * widthAt(seed, lap, t) : ribbon.halfWidth;
        pos.setXYZ(i * 2, boardX(px - half), 0, boardZ(t));
        pos.setXYZ(i * 2 + 1, boardX(px + half), 0, boardZ(t));
      }
      pos.needsUpdate = true;
      ribbon.geometry.computeBoundingSphere();
    });
    this.drawnLap = lap;
    this.paintedKey = null;
  }

  // Die Spur färbt sich Abschnitt für Abschnitt nach der Wertung des Servers.
  paintRibbons(cells) {
    const key = cells;
    if (key === this.paintedKey) return;
    this.paintedKey = key;
    const perfect = new THREE.Color(this.ownColor);
    const good = new THREE.Color(this.ownColor).lerp(_white, 0.5);
    const bandDone = new THREE.Color(this.ownColor).lerp(_white, 0.7);
    const set = (ribbon, i, color) => {
      ribbon.geometry.attributes.color.setXYZ(i * 2, color.r, color.g, color.b);
      ribbon.geometry.attributes.color.setXYZ(i * 2 + 1, color.r, color.g, color.b);
    };
    for (let i = 0; i <= SEGMENTS; i += 1) {
      const cell = Math.min(CELLS - 1, Math.floor((i / SEGMENTS) * CELLS));
      const mark = cells[cell];
      const done = mark === "P" || mark === "G" || mark === "-";
      const trailC = mark === "P" ? perfect : mark === "G" ? good : mark === "-" ? _miss : _open;
      set(this.trail, i, trailC);
      set(this.band, i, done ? bandDone : _bandOpen);
      set(this.core, i, done ? bandDone : _white);
    }
    [this.band, this.core, this.trail].forEach((ribbon) => { ribbon.geometry.attributes.color.needsUpdate = true; });
  }

  // Die Kristalle. Sie werden EINMAL gebaut und je Runde umgesetzt.
  buildGems() {
    this.gems = [];
    for (let i = 0; i < 6; i += 1) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshBasicMaterial({ color: "#ffe36b", toneMapped: false }));
      gem.visible = false;
      gem.userData.isFx = true;
      this.scene.add(gem);
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.19, 18), new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.visible = false;
      this.scene.add(halo);
      this.gems.push({ gem, halo });
    }
  }

  // Welche Kristalle zur GEZEIGTEN Runde gehören. Der Roller ist dem Server
  // um die Netzverzögerung voraus und steht deshalb am Rundenwechsel kurz schon
  // auf der neuen Spur — dafür schickt der Server deren Kristalle mit.
  gemsFor(own, lap) {
    if (own.lap === lap) return { list: own.gems || [], taken: own.gemsTaken || {} };
    if (own.lap + 1 === lap) return { list: own.nextGems || [], taken: {} };
    return { list: [], taken: {} };
  }

  syncGems(own, lap, t, now) {
    const { list, taken } = this.gemsFor(own, lap);
    const clock = performance.now();
    this.gems.forEach((visual, i) => {
      const data = list[i];
      // Eingesammelt: vom Server bestätigt, oder eben erst vom eigenen Roller
      // berührt. Bestätigt der Server den Griff nicht, taucht der Kristall
      // nach kurzer Zeit als verpasst wieder auf — ehrlich statt geschönt.
      const local = data ? this.localGems.get(data.index) : null;
      const gone = !data || Boolean(taken[data.index]) || (local && clock - local < 700);
      visual.gem.visible = !gone;
      visual.halo.visible = !gone;
      if (gone) return;
      const missed = t > data.t + 0.03;
      const x = boardX(data.x);
      const z = boardZ(data.t);
      visual.gem.material.color.set(missed ? "#b9b2a0" : "#ffe36b");
      visual.halo.material.opacity = missed ? 0 : 0.5;
      visual.gem.scale.setScalar(missed ? 0.6 : 1);
      visual.gem.position.set(x, (missed ? 0.12 : 0.22) + (missed ? 0 : Math.sin(now / 300 + i) * 0.04), z);
      visual.halo.position.set(x, 0.03, z);
      visual.gem.rotation.y = now / 420 + i;
      visual.halo.scale.setScalar(1 + Math.sin(now / 260 + i) * 0.12);
    });
  }

  // Der eigene Roller berührt einen Kristall — so misst auch der Server:
  // seitlicher Abstand zur Mittellinie an der Stelle des Kristalls.
  grabGems(own, seed, lap, t) {
    const { list, taken } = this.gemsFor(own, lap);
    list.forEach((gem) => {
      if (taken[gem.index] || this.localGems.has(gem.index)) return;
      if (Math.abs(t - gem.t) > 0.02) return;
      const lateral = this.localBrush - pathX(seed, lap, gem.t);
      if (Math.abs(lateral - gem.offset) > GEM_REACH) return;
      this.localGems.set(gem.index, performance.now());
      this.burst(new THREE.Vector3(boardX(gem.x), 0.3, boardZ(gem.t)), ["#ffe36b", "#ffffff"], { count: 10, speed: 1.5, up: 1.2, size: 0.055, life: 0.45, drag: 2.0 });
      this.feedback?.vibrate(6);
    });
  }

  buildStudio(scene) {
    const zufall = streuer(23);
    // Tischplatte aus Holz mit Farbspritzern.
    const platte = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 13), new THREE.MeshLambertMaterial({ color: "#b9895a" }));
    platte.position.y = -0.34;
    platte.receiveShadow = true;
    scene.add(platte);
    const maserung = [];
    for (let i = 0; i < 16; i += 1) maserung.push({ p: [-5.5 + i * 0.75, -0.139, 0], s: [0.04, 1, 13] });
    viele(scene, new THREE.BoxGeometry(1, 0.001, 1), lambert("#a57a4e"), maserung);
    const farben = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b", "#b57bff"];
    const spritzer = farben.map(() => []);
    for (let i = 0; i < 40; i += 1) {
      const x = (zufall() - 0.5) * 9;
      const z = (zufall() - 0.5) * 11;
      if (Math.abs(x) < BOARD_W / 2 + 0.45 && Math.abs(z) < BOARD_H / 2 + 0.45) continue;
      spritzer[i % farben.length].push({ p: [x, -0.138, z], r: [-Math.PI / 2, 0, zufall() * 3], s: [0.05 + zufall() * 0.14, 0.04 + zufall() * 0.12, 1] });
    }
    farben.forEach((farbe, i) => viele(scene, new THREE.CircleGeometry(1, 8), lambert(farbe), spritzer[i]));
    // Farbtuben, halb ausgedrückt.
    // Ausserhalb der Leinwand, aber im hochkanten Bild: oben und unten.
    [[-1.3, 3.05, 0.3, 0], [-0.6, 3.25, -0.4, 1], [0.9, 3.1, 0.2, 2], [1.5, -3.15, 0.9, 3], [0.7, -3.3, -0.2, 4]].forEach(([x, z, dreh, c]) => {
      const tube = new THREE.Group();
      kiste(tube, 0.5, 0.1, 0.18, "#e8eaee", [0, 0, 0]);
      kiste(tube, 0.14, 0.08, 0.16, farben[c], [-0.2, 0.001, 0], { schatten: false });
      kiste(tube, 0.08, 0.06, 0.06, "#2c2f38", [0.29, 0, 0], { schatten: false });
      const klecks = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lambert(farben[c]));
      klecks.scale.y = 0.5;
      klecks.position.set(0.38, -0.03, 0);
      tube.add(klecks);
      tube.position.set(x, -0.08, z);
      tube.rotation.y = dreh;
      scene.add(tube);
    });
    // Palette mit Farbklecksen.
    const palette = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 20), lambert("#d9b27a"));
    palette.scale.z = 0.72;
    palette.position.set(-1.1, -0.12, -3.25);
    scene.add(palette);
    viele(scene, new THREE.SphereGeometry(0.07, 8, 6), lambert("#ffffff"), [[0, 0]].map(() => ({ p: [-0.9, -0.09, -3.5], s: [1, 0.4, 1] })));
    farben.forEach((farbe, i) => {
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lambert(farbe));
      k.scale.y = 0.4;
      const a = -0.6 + i * 0.5;
      k.position.set(-1.1 + Math.cos(a) * 0.42, -0.09, -3.25 + Math.sin(a) * 0.3);
      scene.add(k);
    });
    // Pinselglas.
    const glas = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.44, 12, 1, true), new THREE.MeshLambertMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    glas.position.set(1.55, 0.08, 3.2);
    scene.add(glas);
    [[-0.05, 0.2, "#ff5d73"], [0.06, -0.15, "#28c7d9"], [0.02, 0.05, "#ffd15c"]].forEach(([dx, tilt, farbe]) => {
      const stiel = kiste(scene, 0.04, 0.7, 0.04, "#8a6238", [1.55 + dx, 0.32, 3.2]);
      stiel.rotation.z = tilt;
      kiste(scene, 0.05, 0.1, 0.05, farbe, [1.55 + dx + Math.sin(-tilt) * -0.35, 0.68, 3.2], { schatten: false });
    });
    // Klebeband an den Ecken der Leinwand.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const band = kiste(scene, 0.34, 0.012, 0.14, "#f1e4b8", [sx * (BOARD_W / 2 + 0.2), -0.005, sz * (BOARD_H / 2 + 0.2)], { schatten: false });
      band.rotation.y = sx * sz * 0.78;
    });
    // Schwamm und Bleistift.
    kiste(scene, 0.44, 0.16, 0.3, "#ffd84a", [-1.7, -0.06, 3.3]).rotation.y = 0.4;
    const stift = kiste(scene, 0.06, 0.06, 0.9, "#ffc400", [0.2, -0.1, -3.3]);
    stift.rotation.y = -1.2;
  }

  shot() {
    return {
      look: [0, 0, 0.1],
      frame: { w: BOARD_W + 0.9, h: BOARD_H * Math.sin(1.1) + 0.9 },
      fill: 0.95,
      pitch: 1.1,
      fov: 36,
      intro: { yaw: 0.4, pitch: 0.3, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">◀ Irgendwo wischen zum Lenken ▶ · bleib auf der Linie</p>`;
    this.controls.style.pointerEvents = "none";
    // Relatives Lenken: wo der Finger aufsetzt, ist egal — gezählt wird, wie
    // weit er seitlich wandert, im Massstab des Bretts. So verdeckt er nie die
    // Spur, und der Roller springt beim Aufsetzen nicht.
    this.on(this.webglCanvas, "pointerdown", (event) => {
      if (this.drag) return;
      event.preventDefault();
      this.capturePointer(this.webglCanvas, event.pointerId);
      this.drag = {
        id: event.pointerId,
        x0: event.clientX,
        from: this.localTarget ?? this.localBrush ?? 0.5,
        gain: 1 / Math.max(80, this.boardPixelWidth())
      };
    });
    this.on(this.webglCanvas, "pointermove", (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      event.preventDefault();
      this.localTarget = clamp(this.drag.from + (event.clientX - this.drag.x0) * this.drag.gain, 0.02, 0.98);
    });
    const up = (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.drag = null;
      this.webglCanvas.releasePointerCapture?.(event.pointerId);
    };
    this.on(this.webglCanvas, "pointerup", up);
    this.on(this.webglCanvas, "pointercancel", up);
    this.on(this.webglCanvas, "lostpointercapture", up);
    // Am Rechner lenken die Pfeiltasten.
    this.on(window, "keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "a") this.keyDir = -1;
      else if (event.key === "ArrowRight" || event.key === "d") this.keyDir = 1;
    });
    this.on(window, "keyup", (event) => {
      if ((event.key === "ArrowLeft" || event.key === "a") && this.keyDir < 0) this.keyDir = 0;
      if ((event.key === "ArrowRight" || event.key === "d") && this.keyDir > 0) this.keyDir = 0;
    });
    const interrupt = () => { this.drag = null; this.keyDir = 0; };
    this.on(window, "blur", interrupt);
    this.on(document, "visibilitychange", () => { if (document.hidden) interrupt(); });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
  }

  // Wie breit das Brett auf dem Bildschirm ist, in CSS-Pixeln.
  boardPixelWidth() {
    const z = boardZ(clamp(this.shownProgress, 0, 1));
    const a = this.rig?.toScreen([boardX(0), 0, z]);
    const b = this.rig?.toScreen([boardX(1), 0, z]);
    if (!a || !b) return 300;
    return Math.abs(b.x - a.x);
  }

  // Lenkziel an den Server, gedrosselt — aber der letzte Stand kommt immer an:
  // was die Drossel zurückhält, geht im nächsten freien Bild raus, und der
  // Server verschluckt beim Lenken nichts mehr (kein Cooldown).
  flushTarget(now) {
    if (this.localTarget === null) return;
    if (this.sentTarget !== null && Math.abs(this.localTarget - this.sentTarget) < 0.002) return;
    if (now - this.sentAt < 45) return;
    this.sentAt = now;
    this.steeredAt = now;
    this.sentTarget = this.localTarget;
    const sentAt = performance.now();
    this.sendInput({ action: "steer", x: this.localTarget })
      .then(() => this.noteRoundTrip(performance.now() - sentAt))
      .catch(() => {});
  }

  // Wie lange eine Lenkung zum Server und zurück braucht, geglättet.
  //
  // Der Server wertet den Pinsel dort, wo SEIN Roller gerade ist. Das Bild auf
  // dem Gerät ist aber um die einfache Laufzeit alt, und die Lenkung braucht
  // noch einmal so lange hin — gelenkt wurde also immer auf eine Stelle, die
  // der Server längst hinter sich hatte. Bei 200 ms Rundreise kostete das in
  // der Messung fast jeden dritten Abschnitt. Darum zeigt das Gerät den
  // eigenen Roller genau um diese Rundreise voraus.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.roundTrip * 0.7 + clamped * 0.3;
  }

  // Wo der Server den eigenen Roller haben wird, wenn eine JETZT geschickte
  // Lenkung ankommt — als Runde + Fortschritt. Die Uhr des Geräts läuft der
  // des Servers um die einfache Laufzeit hinterher; eine Rundreise dazu ist
  // die Ankunftszeit. Vor dem Anlauf und nach dem Schluss fährt nichts.
  predictTotal(own, f, rollStart) {
    const minigame = f.minigame || {};
    const endAt = (minigame.startedAt || 0) + (minigame.duration || 0);
    const snapAt = minigame.sentAt || f.now;
    let lap = own.lap || 0;
    let progress = own.progress || 0;
    const aheadMs = Math.min(f.now + this.roundTrip, endAt) - Math.max(snapAt, rollStart);
    const ahead = clamp(aheadMs / 1000, 0, 0.6);
    if (ahead > 0 && !f.finale) {
      progress += speedFor(lap) * ahead;
      if (progress >= 1) {
        const over = (progress - 1) / speedFor(lap);
        lap += 1;
        progress = over * speedFor(lap);
      }
    }
    return lap + clamp(progress, 0, 0.9999);
  }

  tick(f) {
    const { now, dt, arcade, controlledId, finale } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const kin = this.kins.get(controlledId);
    const animator = this.animators.get(controlledId);
    if (!own || !kin || !animator) return;

    // Gefahren wird ab dem Ende des Anlaufs — auf der Serveruhr, zu der die
    // Lenkung ankommt.
    const rollStart = (f.minigame?.startedAt || 0) + (arcade.leadInMs || 0);
    const endAt = (f.minigame?.startedAt || 0) + (f.minigame?.duration || 0);
    const started = now + this.roundTrip >= rollStart;
    // Nach dem Schluss fährt auch der Server nicht mehr — sonst liefe der
    // Roller bis zum Finale weiter und würde dann zurückgezogen.
    const moving = started && !finale && now + this.roundTrip < endAt;

    // Vorwärts: lokal weiterfahren und sanft zur Vorhersage hin korrigieren.
    // Ein grosser Unterschied (Aussetzer, Wiedereinstieg) wird übernommen.
    const target = this.predictTotal(own, f, rollStart);
    if (this.shownTotal === null || Math.abs(target - this.shownTotal) > 0.12) {
      this.shownTotal = target;
    } else {
      if (moving) this.shownTotal += speedFor(Math.floor(this.shownTotal)) * dt;
      this.shownTotal += (target - this.shownTotal) * frameLerp(0.15, dt);
    }
    // Die gezeigte Runde läuft nur vorwärts: ein Zurückzucken über die
    // Ziellinie hätte die Spur zweimal neu gelegt.
    let lap = Math.floor(this.shownTotal);
    let t = this.shownTotal - lap;
    if (lap < this.shownLap) {
      lap = this.shownLap;
      t = 0;
    }
    this.shownLap = lap;
    this.shownProgress = t;

    if (lap !== this.drawnLap) {
      const neueRunde = this.drawnLap >= 0;
      this.layoutRibbons(arcade.seed, lap);
      this.localCells = [];
      this.localGems.clear();
      // Neue Runde: der Roller springt vom Ziel zurück an den Start. Das ist
      // gewollt, sah aber aus wie ein Aussetzer — jetzt ploppt die Figur mit
      // einem Farbwölkchen unten wieder auf. Die Markierung sagt den
      // Prüfskripten, dass dieser Sprung Absicht ist.
      if (neueRunde) {
        kin.userData.versetzt = performance.now();
        animator.trigger("spawn");
        this.burst(new THREE.Vector3(boardX(this.localBrush ?? 0.5), 0.3, boardZ(t)), ["#ffffff", "#ffe36b"], { count: 10, speed: 1.4, up: 1.2, size: 0.06, life: 0.5 });
      }
    }

    // Eigenes Lenken: sofort im Bild, der Server bestätigt nur. Lenkt dieses
    // Gerät gerade nicht (anderes Gerät, Autopilot), folgt das Bild dem Server.
    if (this.localBrush === null) this.localBrush = own.brushX ?? 0.5;
    if (this.localTarget === null) this.localTarget = own.targetX ?? this.localBrush;
    if (this.keyDir && !finale) this.localTarget = clamp(this.localTarget + this.keyDir * STEER_SPEED * 0.55 * dt, 0.02, 0.98);
    if (!finale) this.flushTarget(now);
    const idle = !this.drag && !this.keyDir && now - (this.steeredAt || 0) > 400;
    if (idle && Number.isFinite(own.targetX) && Math.abs(own.targetX - this.localTarget) > 0.004) {
      this.localTarget = own.targetX;
      this.sentTarget = own.targetX;
    }
    const reach = STEER_SPEED * dt;
    this.localBrush += clamp(this.localTarget - this.localBrush, -reach, reach);
    const serverX = own.brushX ?? this.localBrush;
    if (idle && Math.abs(serverX - this.localBrush) > 0.02) this.localBrush += (serverX - this.localBrush) * frameLerp(0.2, dt);

    const x = boardX(this.localBrush);
    const z = boardZ(t);
    kin.position.x = x;
    kin.position.z = z + 0.1;
    animator.groundY = 0.3 * 0.72;
    // In Fahrtrichtung drehen: nach hinten und etwas zur Seite, wohin gelenkt wird.
    const lean = clamp((this.localTarget - this.localBrush) * 6, -0.5, 0.5);
    if (!finale) kin.rotation.y += Math.atan2(Math.sin(Math.PI + lean - kin.rotation.y), Math.cos(Math.PI + lean - kin.rotation.y)) * frameLerp(0.2, dt);

    // Liegt der Roller auf der Linie? Gerechnet wie auf dem Server, samt dessen
    // Nachsicht — das ist die Rückmeldung in jedem Bild.
    const offset = lagOffset(arcade.seed, lap, this.localBrush, t);
    const tolerance = TOLERANCE * widthAt(arcade.seed, lap, t);
    const quality = offset <= tolerance * PERFECT ? 2 : offset <= tolerance ? 1 : 0;
    const rolling = moving;

    // Vorläufig malen: der Server wertet denselben Abschnitt erst eine
    // Rundreise später. Bis dahin färbt das Gerät ihn nach eigener Rechnung,
    // danach gilt die Wertung des Servers.
    const cell = Math.min(CELLS - 1, Math.floor(t * CELLS));
    if (rolling) this.localCells[cell] = Math.max(this.localCells[cell] ?? -1, quality);
    const serverCells = own.lap === lap ? (own.cells || "") : "";
    let marks = "";
    for (let i = 0; i < CELLS; i += 1) {
      if (i < serverCells.length) marks += serverCells[i];
      else if (i < cell && this.localCells[i] !== undefined) marks += this.localCells[i] === 2 ? "P" : this.localCells[i] === 1 ? "G" : "-";
      else marks += " ";
    }
    this.paintRibbons(marks);

    if (this.cursor) {
      this.cursor.position.set(x, 0.035, z - 0.04);
      this.cursor.material.color.set(quality === 2 ? "#7fe06f" : quality === 1 ? "#ffd15c" : "#ff6b7f");
      this.cursor.scale.setScalar(quality === 2 ? 1 + Math.sin(now / 90) * 0.08 : 1);
    }
    if (this.drum && rolling) this.drum.rotation.x += dt * 12;
    if (!finale) {
      animator.set(started ? "shove" : "ready");
      animator.rate = started ? 0.8 + speedFor(lap) * 1.2 : 1;
      if (quality === 0 && started) animator.expression("scared", 150);
      else if ((own.streak || 0) >= 20) animator.expression("happy", 150);
    }
    if (rolling && quality > 0 && Math.random() < frameChance(quality === 2 ? 0.5 : 0.25, dt)) {
      this.burst(new THREE.Vector3(x, 0.08, z - 0.15), [this.ownColor, "#ffffff"], { count: 1, speed: 0.4, up: 0.4, size: 0.045, life: 0.4, drag: 2.4 });
    }
    if (rolling) this.grabGems(own, arcade.seed, lap, t);
    this.syncGems(own, lap, t, now);
    this.reactToEvents(own, kin, animator);
  }

  reactToEvents(own, kin, animator) {
    // Daneben: kurz und nur, wenn wirklich eine Serie verloren ging — sonst
    // flackert beim Wiedereinfädeln eine Meldung nach der anderen.
    if (own.lastMissAt && own.lastMissAt !== this.lastMissAt) {
      this.lastMissAt = own.lastMissAt;
      if ((own.lastBrokenStreak || 0) >= 5) {
        animator.trigger("stumble");
        animator.expression("surprised", 600);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        this.pop(at, "Serie weg", { color: "#ff9aa8", size: 0.26, life: 0.7 });
        this.feedback?.sound("error");
        this.feedback?.vibrate(16);
      }
    }
    const combo = Math.min(3, 1 + Math.floor((own.streak || 0) / 10));
    if (combo !== this.shownCombo) {
      if (combo > this.shownCombo) {
        const at = kin.position.clone().add(new THREE.Vector3(0, 1.0, 0));
        this.pop(at, `×${combo}!`, { color: "#ffe36b", size: 0.4, life: 0.8 });
        this.burst(at, [this.ownColor, "#ffe36b", "#ffffff"], { count: 12, speed: 1.6, up: 1.4, size: 0.06, life: 0.5, drag: 2.0 });
        this.feedback?.sound("sparkle");
        this.feedback?.vibrate(10);
      }
      this.shownCombo = combo;
    }
    if (own.lastGemAt && own.lastGemAt !== this.lastGemAt) {
      this.lastGemAt = own.lastGemAt;
      const gem = own.lastGem;
      const at = new THREE.Vector3(boardX(gem?.x ?? 0.5), 0.4, boardZ(gem?.t ?? 0.5));
      // Das Funkeln kam schon beim Berühren (grabGems); hier nur, wenn das
      // Gerät den Griff nicht selbst gesehen hat.
      if (!this.localGems.has(gem?.index)) this.burst(at, ["#ffe36b", "#ffffff"], { count: 14, speed: 1.8, up: 1.4, size: 0.06, life: 0.55, drag: 2.0 });
      this.pop(at, "+60", { color: "#ffe36b", size: 0.32, life: 0.7 });
      this.feedback?.sound("coin");
      this.feedback?.vibrate(8);
    }
    if (own.lastLapAt && own.lastLapAt !== this.lastLapAt) {
      this.lastLapAt = own.lastLapAt;
      const lap = own.lastLap;
      animator.trigger("celebrate");
      animator.expression("joy", 900);
      const at = new THREE.Vector3(0, 1, boardZ(0.9));
      this.burst(at, [this.ownColor, "#ffe36b", "#ffffff"], { count: 20, speed: 2.2, up: 2.4, size: 0.08, life: 0.7, drag: 1.6 });
      this.pop(at, lap?.clean ? `SAUBER! ${lap.accuracy} %` : `RUNDE · ${lap?.accuracy ?? 0} %`, { color: "#ffe36b", size: 0.42, life: 1.0 });
      this.feedback?.sound(lap?.clean ? "perfect" : "coin");
      this.feedback?.vibrate([10, 14, 18]);
    }
  }

  keepInView() {
    return [...this.kins.values()];
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
    const laps = this.hud.querySelector("[data-trace-laps]");
    if (laps) {
      const html = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="trace-lap-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.round(entry?.score || 0)}</span>`;
      }).join("");
      if (laps.innerHTML !== html) laps.innerHTML = html;
    }
    const combo = this.hud.querySelector("[data-trace-combo]");
    if (combo && own) {
      const streak = own.streak || 0;
      const factor = Math.min(3, 1 + Math.floor(streak / 10));
      const text = `×${factor} · Serie ${streak}`;
      combo.hidden = streak < 3;
      if (combo.textContent !== text) combo.textContent = text;
      combo.dataset.level = String(factor);
    }
    // Im Finale gibt es nichts mehr zu lenken.
    this.hintNode ||= this.controls.querySelector(".trace-hint");
    if (this.hintNode) this.hintNode.hidden = Boolean(f.finale);
    const banner = this.hud.querySelector("[data-trace-banner]");
    if (!banner) return;
    const waiting = f.now + this.roundTrip < (f.minigame?.startedAt || 0) + (arcade.leadInMs || 0);
    if (waiting) {
      banner.hidden = false;
      banner.textContent = "Wisch zum Lenken — gleich geht's los";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3400";
    } else {
      banner.hidden = true;
    }
  }
}
