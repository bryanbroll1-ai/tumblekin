import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin213";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin213";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin213";

// Augenmaß: auf einer Sommerwiese schwirren kurz Tiere herum — wie viele
// waren es? Geschätzt wird mit dem Schieber.
//
// Jeder Durchgang zeigt andere Tiere (Bienen, Schmetterlinge, Vögel,
// Libellen; die Reihenfolge würfelt der Server), alle als kleine Blockfiguren.
// Vorher blitzten bis zu 44 gelbe Leuchtpunkte zwei Sekunden auf — das war
// nicht zu schaffen, und alle Durchgänge sahen gleich aus. Jetzt sind es 4 bis
// 20 Tiere, die drei bis vier Sekunden lang zu sehen sind (ESTIMATE_BANDS,
// ESTIMATE_SHOW_BY_ROUND auf dem Server).
//
// Die Figuren sitzen zusammen auf einem Baumstamm vor der Wiese, folgen den
// Tieren mit den Augen, grübeln beim Schätzen und drehen sich bei der
// Auflösung um. Früher sassen sie IM Stamm: der Sitz lag 21 cm unter seiner
// Oberkante.
const MAX_CRITTERS = 24;
// Die Tiere müssen GANZ ins Bild — wer einen Teil nicht sieht, schätzt nicht,
// sondern rät. Auf einem hochkanten Handy ergibt das Sichtfeld rund 6,3
// Einheiten Breite; die Wiese der Tiere ist 5,2 breit.
const SPAWN_RADIUS = 2.6;
const MIN_GAP = 0.85;            // so weit stehen zwei Tiere mindestens auseinander
const CRITTER_SIZE = 1.5;        // auf dem Handy rund 30 Pixel je Tier

const KIND_WORDS = {
  bee: "Bienen",
  butterfly: "Schmetterlinge",
  bird: "Vögel",
  dragonfly: "Libellen"
};

// Ein eigener Zufallszahlengeber je Durchgang: alle Geräte zeigen dieselben
// Tiere am selben Ort, und die Auflösung zählt genau die hoch, die man sah.
function seededRandom(seed) {
  let state = (seed * 9301 + 49297) % 233280;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Der Stamm ist ein Blockbalken; seine Oberkante ist der Sitz.
const LOG_Z = 2.5;
const LOG_TOP = 0.42;

// Wie hoch die Tiere fliegen. Hochkant bestimmt die BREITE den Ausschnitt,
// darum bekommen sie dort mehr Höhe; quer bleibt es flacher.
function swarmShape() {
  const portrait = typeof window !== "undefined" && window.innerHeight > window.innerWidth * 1.15;
  return portrait
    ? { base: 1.4, height: 4.6, look: 3.0, frameH: 6.6 }
    : { base: 1.0, height: 3.2, look: 2.0, frameH: 4.6 };
}

const GUESS_GAP_MS = 60;         // so dicht folgen Reglermeldungen höchstens

const _geo = new Map();
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!_geo.has(key) || _geo.get(key).userData.disposed) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    const dispose = geometry.dispose.bind(geometry);
    geometry.dispose = () => { geometry.userData.disposed = true; dispose(); };
    _geo.set(key, geometry);
  }
  return _geo.get(key);
}

// Ein Tier aus ein paar Blöcken. Der Körper zeigt nach +x; Flügel hängen an
// eigenen Gelenken, damit sie schlagen können.
function makeCritter(kind, random) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const wings = [];
  const add = (w, h, d, color, [x, y, z], parent = body, extra) => {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), lambert(color, extra));
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const wing = (side, [x, y, z], size, color, extra) => {
    const joint = new THREE.Group();
    joint.position.set(x, y, z * side);
    body.add(joint);
    add(size[0], size[1], size[2], color, [0, 0, side * size[2] / 2], joint, extra);
    wings.push({ joint, side });
  };
  const glass = { transparent: true, opacity: 0.72 };
  if (kind === "bee") {
    add(0.28, 0.2, 0.2, "#ffc928", [0, 0, 0]);
    add(0.06, 0.205, 0.205, "#2a2118", [-0.05, 0, 0]);
    add(0.06, 0.205, 0.205, "#2a2118", [0.06, 0, 0]);
    add(0.11, 0.14, 0.14, "#2a2118", [0.18, 0.01, 0]);
    add(0.05, 0.04, 0.04, "#2a2118", [-0.16, 0, 0]);
    [-1, 1].forEach((side) => wing(side, [0, 0.11, 0.04], [0.15, 0.02, 0.17], "#ffffff", glass));
  } else if (kind === "butterfly") {
    const colours = [["#ff7ab0", "#ffd15c"], ["#5fb8ff", "#ffffff"], ["#ffa13d", "#5a2a14"], ["#b57bff", "#ffe36b"]];
    const [wingColour, dotColour] = colours[Math.floor(random() * colours.length)];
    add(0.24, 0.07, 0.07, "#3a2a24", [0, 0, 0]);
    add(0.07, 0.08, 0.08, "#3a2a24", [0.14, 0.01, 0]);
    [-1, 1].forEach((side) => {
      const joint = new THREE.Group();
      body.add(joint);
      add(0.2, 0.02, 0.24, wingColour, [0.04, 0, side * 0.13], joint);
      add(0.14, 0.02, 0.16, wingColour, [-0.1, 0, side * 0.1], joint);
      add(0.07, 0.025, 0.07, dotColour, [0.06, 0.005, side * 0.17], joint);
      wings.push({ joint, side });
    });
  } else if (kind === "bird") {
    const colours = ["#e8463c", "#3d8bd8", "#f2b632", "#5cb85c"];
    const colour = colours[Math.floor(random() * colours.length)];
    add(0.3, 0.17, 0.17, colour, [0, 0, 0]);
    add(0.14, 0.15, 0.15, colour, [0.19, 0.06, 0]);
    add(0.08, 0.05, 0.06, "#ffb020", [0.3, 0.05, 0]);
    add(0.03, 0.04, 0.035, "#1c1c28", [0.23, 0.1, 0.075]);
    add(0.03, 0.04, 0.035, "#1c1c28", [0.23, 0.1, -0.075]);
    add(0.12, 0.04, 0.12, colour, [-0.2, 0.03, 0]);
    add(0.2, 0.1, 0.1, "#ffffff", [0.02, -0.06, 0]);
    [-1, 1].forEach((side) => wing(side, [0, 0.05, 0.08], [0.18, 0.03, 0.24], colour));
  } else {
    const colours = ["#2fd0c0", "#4a7dff", "#9b5cff"];
    const colour = colours[Math.floor(random() * colours.length)];
    add(0.4, 0.06, 0.06, colour, [-0.04, 0, 0]);
    add(0.1, 0.1, 0.12, colour, [0.18, 0.01, 0]);
    add(0.04, 0.05, 0.05, "#1c1c28", [0.22, 0.04, 0.05]);
    add(0.04, 0.05, 0.05, "#1c1c28", [0.22, 0.04, -0.05]);
    [-1, 1].forEach((side) => {
      wing(side, [0.08, 0.04, 0.02], [0.08, 0.015, 0.28], "#e8fbff", glass);
      wing(side, [0.0, 0.04, 0.02], [0.07, 0.015, 0.24], "#e8fbff", glass);
    });
  }
  group.userData = { kind, body, wings };
  return group;
}

export class SwarmCount extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.critters = [];
    this.critterKind = null;
    this.shownRound = -1;
    this.shownPhase = "";
    this.countUpUntil = 0;
    this.roundTrip = 0;
    this.wantGuess = null;
    this.lastSentGuess = null;
    this.lastGuessSentAt = -1e9;
    this.guessOpen = false;
    this.reacted = new Map();
    this.labelY = 0.74;
    this.swarmCentre = new THREE.Vector3(0, 2.6, -0.4);
  }

  stage() {
    return {
      label: "3D Augenmaß",
      background: "#9fd8f0",
      // Der Nebel macht den Waldrand blass: hinter den Tieren soll nichts
      // Kräftiges stehen, sonst verschwinden sie davor.
      fog: ["#bfe6f2", 12, 40],
      lights: { sunPosition: [-4, 11, 7], sunIntensity: 2.6, skyColor: 0xeaf8ff, groundColor: 0x6f9a55, shadow: { left: -6, right: 6, top: 8, bottom: -4 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-swarm-round>Durchgang 1/4</div>
      <div class="simon-chips" data-swarm-chips></div>
      <div class="color-banner" data-swarm-banner hidden></div>`;
  }

  // Eine Sommerwiese: Hügel und Blocktannen hinten, Blumen und Gräser vorn,
  // ein Teich links, ein Bienenstock rechts. Ruhige Flächen hinter den Tieren,
  // damit sie sich abheben.
  build() {
    const scene = this.scene;
    const zufall = streuer(52);
    kiste(scene, 60, 0.5, 60, "#7cbf5a", [0, -0.25, -12], { schatten: false });
    // Hügel als flache Blöcke am Horizont.
    [[-14, -26, 18, 5, "#8fcf6a"], [8, -30, 24, 7, "#86c463"], [24, -24, 14, 4, "#94d470"]].forEach(([x, z, w, h, farbe]) => {
      kiste(scene, w, h, 6, farbe, [x, h / 2 - 0.5, z], { schatten: false });
    });
    // Blocktannen am Waldrand.
    const stamm = [];
    const kronen = [];
    for (let i = 0; i < 18; i += 1) {
      const x = -18 + i * 2.1 + (zufall() - 0.5);
      const z = -15 - zufall() * 4;
      const s = 0.8 + zufall() * 0.6;
      stamm.push({ p: [x, 0.5 * s, z], s: [0.35 * s, 1 * s, 0.35 * s] });
      kronen.push({ p: [x, 1.6 * s, z], s: [1.6 * s, 1.4 * s, 1.6 * s] });
      kronen.push({ p: [x, 2.6 * s, z], s: [1.0 * s, 1.0 * s, 1.0 * s] });
    }
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#7a5330"), stamm);
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#3f8a46"), kronen);
    // Wolken.
    const wolken = [];
    [[-8, 9, -24], [5, 11, -26], [14, 8.5, -22]].forEach(([x, y, z]) => {
      wolken.push({ p: [x, y, z], s: [3.2, 0.9, 1] }, { p: [x + 0.8, y + 0.5, z], s: [1.8, 0.8, 1] });
    });
    viele(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff", fog: false }), wolken);
    // Blumen und Grasbüschel rund um die Wiese, nicht hinter den Tieren.
    const stiele = [];
    const blueten = { "#ff6f91": [], "#ffd15c": [], "#ffffff": [], "#b57bff": [] };
    const farben = Object.keys(blueten);
    for (let i = 0; i < 46; i += 1) {
      const x = (zufall() - 0.5) * 12;
      const z = -4.5 + zufall() * 8.5;
      if (Math.abs(x) < 3 && z > LOG_Z - 0.6 && z < LOG_Z + 0.6) continue;
      const h = 0.18 + zufall() * 0.2;
      stiele.push({ p: [x, h / 2, z], s: [0.03, h, 0.03] });
      blueten[farben[i % farben.length]].push({ p: [x, h + 0.04, z], s: [0.12, 0.08, 0.12] });
    }
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#3f8a46"), stiele);
    farben.forEach((farbe) => viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert(farbe), blueten[farbe]));
    const gras = [];
    for (let i = 0; i < 40; i += 1) gras.push({ p: [(zufall() - 0.5) * 14, 0.06, -6 + zufall() * 11], r: [0, zufall() * 3, 0], s: [0.16, 0.12, 0.05] });
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#5ea64a"), gras);
    // Teich links hinten mit Seerosen.
    kiste(scene, 3.2, 0.04, 2.2, "#4aa8d8", [-4.6, 0.02, -2.6], { schatten: false });
    kiste(scene, 3.5, 0.06, 0.18, "#8f8474", [-4.6, 0.03, -1.45], { schatten: false });
    [[-5.2, -2.9], [-4.1, -2.3], [-4.8, -3.2]].forEach(([x, z]) => kiste(scene, 0.32, 0.03, 0.32, "#4f9a48", [x, 0.05, z], { schatten: false }));
    // Bienenstock rechts auf einem Pfahl.
    kiste(scene, 0.12, 1.1, 0.12, "#7a5330", [4.4, 0.55, -2.4]);
    [0, 1, 2].forEach((i) => kiste(scene, 0.7 - i * 0.12, 0.2, 0.7 - i * 0.12, i % 2 ? "#e9a93a" : "#f4c04e", [4.4, 1.2 + i * 0.2, -2.4]));
    kiste(scene, 0.14, 0.08, 0.04, "#3a2a14", [4.4, 1.2, -2.04], { schatten: false });

    // Der Stamm: ein Blockbalken mit Rinde und Jahresringen. Seine Oberkante
    // ist LOG_TOP — genau dort sitzen die Figuren.
    const players = this.getState()?.players || [];
    const count = Math.max(1, players.length);
    const laenge = count * 0.95 + 0.8;
    kiste(scene, laenge, LOG_TOP, 0.42, "#7a5330", [0, LOG_TOP / 2, LOG_Z]);
    kiste(scene, laenge + 0.02, 0.06, 0.44, "#5e3f24", [0, LOG_TOP - 0.03, LOG_Z], { schatten: false });
    [-1, 1].forEach((seite) => {
      kiste(scene, 0.02, LOG_TOP - 0.06, 0.36, "#d9b27a", [seite * (laenge / 2 + 0.005), LOG_TOP / 2 - 0.02, LOG_Z], { schatten: false });
      kiste(scene, 0.025, 0.14, 0.14, "#b08654", [seite * (laenge / 2 + 0.008), LOG_TOP / 2 - 0.02, LOG_Z], { schatten: false });
    });
    players.forEach((player, index) => {
      const x = (index - (count - 1) / 2) * 0.95;
      // Etwas vor der Mitte: so hängen die Beine über die Vorderkante statt
      // im Holz zu stecken (sie zeigen zur Wiese, also nach -z).
      this.addKin(player, index, { x, ground: LOG_TOP + 0.01, z: LOG_Z - 0.06, facing: Math.PI });
    });
  }

  // Die Tiere eines Durchgangs: an Plätzen mit Mindestabstand, damit keines
  // hinter einem anderen verschwindet. Alle Geräte würfeln gleich.
  layoutSwarm(round) {
    const random = seededRandom(round.index * 977 + round.count * 31 + 7);
    const shape = swarmShape();
    this.swarmCentre.set(0, shape.base + shape.height / 2, -0.4);
    const kind = round.kind || "bee";
    this.clearCritters();
    this.critterKind = kind;
    const homes = [];
    for (let index = 0; index < Math.min(MAX_CRITTERS, round.count); index += 1) {
      let best = null;
      let bestGap = -1;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const candidate = new THREE.Vector3(
          (random() * 2 - 1) * SPAWN_RADIUS,
          shape.base + random() * shape.height,
          -0.4 + (random() * 2 - 1) * 0.9
        );
        const gap = homes.reduce((nearest, home) => Math.min(nearest, home.distanceTo(candidate)), Infinity);
        if (gap >= MIN_GAP) { best = candidate; break; }
        if (gap > bestGap) { bestGap = gap; best = candidate; }
      }
      homes.push(best);
      const mesh = makeCritter(kind, random);
      mesh.position.copy(best);
      mesh.scale.setScalar(0.001);
      mesh.userData.isFx = true;
      this.scene.add(mesh);
      this.critters.push({ mesh, home: best, phase: random() * Math.PI * 2, speed: 0.8 + random() * 0.5, lit: 0, last: best.clone() });
    }
  }

  clearCritters() {
    this.critters.forEach(({ mesh }) => this.scene.remove(mesh));
    this.critters.length = 0;
  }

  activeRound() {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!arcade?.rounds) return null;
    const elapsed = Math.max(0, this.now() - minigame.startedAt);
    const round = arcade.rounds.find((candidate) => elapsed >= candidate.showFrom && elapsed < candidate.until);
    if (!round) return null;
    const phase = elapsed < round.guessFrom ? "show"
      : elapsed < round.revealFrom ? "guess" : "reveal";
    return { round, phase, elapsed };
  }

  shot() {
    const shape = swarmShape();
    return {
      look: [0, shape.look, 0.6],
      frame: { w: SPAWN_RADIUS * 2 + 0.8, h: shape.frameH },
      yaw: 0.28,
      pitch: 0.06,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.3 }
    };
  }

  bind() {
    this.buildControls();
  }

  unbind() {
    this.clearCritters();
  }

  buildControls() {
    this.controls.innerHTML = `
      <div class="estimate-pad">
        <div class="estimate-value"><strong data-estimate-value>?</strong><span>Stück</span></div>
        <input type="range" class="estimate-slider" data-estimate-slider
          min="0" max="10" step="1" value="5" aria-label="Deine Schätzung" disabled>
        <div class="estimate-timer" data-estimate-timer-bar><i data-estimate-timer></i></div>
        <div class="estimate-scale"><span data-estimate-low>0</span><span data-estimate-high>10</span></div>
      </div>
    `;
    this.slider = this.controls.querySelector("[data-estimate-slider]");
    this.valueLabel = this.controls.querySelector("[data-estimate-value]");
    this.lowLabel = this.controls.querySelector("[data-estimate-low]");
    this.highLabel = this.controls.querySelector("[data-estimate-high]");
    this.timerBar = this.controls.querySelector("[data-estimate-timer-bar]");
    this.timerFill = this.controls.querySelector("[data-estimate-timer]");

    this.onSlide = () => {
      const value = Number(this.slider.value);
      if (this.valueLabel) this.valueLabel.textContent = String(value);
      if (value !== this.wantGuess) this.feedback?.sound("step");
      this.wantGuess = value;
      this.flushGuess();
    };
    // Loslassen schickt den Stand sofort, ohne auf die Drossel zu warten.
    this.onRelease = () => {
      this.onSlide();
      this.flushGuess(true);
    };
    this.on(this.slider, "input", this.onSlide);
    this.on(this.slider, "change", this.onRelease);
    this.on(this.slider, "pointerup", this.onRelease);
  }

  // Gesendet wird höchstens alle 60 ms — und der jeweils letzte Stand immer,
  // spätestens im nächsten Frame. Vorher ging der Wert beim Loslassen direkt
  // hinter einer Zwischenmeldung in der Sperrzeit des Servers verloren, und
  // gewertet wurde eine andere Zahl als die auf dem Regler.
  flushGuess(force = false) {
    const value = this.wantGuess;
    if (value === null || value === undefined || value === this.lastSentGuess || !this.guessOpen) return;
    const clock = performance.now();
    if (!force && clock - this.lastGuessSentAt < GUESS_GAP_MS) return;
    this.lastGuessSentAt = clock;
    this.lastSentGuess = value;
    this.sendInput({ action: "guess", value })
      .then(() => this.noteRoundTrip(performance.now() - clock))
      .catch(() => { if (this.lastSentGuess === value) this.lastSentGuess = null; });
  }

  // Rundreise zum Server, geglättet und wie überall auf 250 ms gedeckelt.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.roundTrip ? this.roundTrip * 0.8 + clamped * 0.2 : clamped;
  }

  // Ohne Regler keine Antworten, also keine Laufzeit: dann misst ein Ping.
  pingIfIdle(minigame) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.lastGuessSentAt < 1000 || clock - (this.lastPingAt || 0) < 1000) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  syncPhase(active, own, now) {
    if (!active) {
      if (this.slider && !this.slider.disabled) this.slider.disabled = true;
      return;
    }
    const { round, phase } = active;

    if (round.index !== this.shownRound) {
      this.shownRound = round.index;
      this.shownPhase = "";
      this.laidOut = null;
      this.lastSentGuess = null;
      this.wantGuess = null;
    }
    // Die Anzahl kommt erst kurz vor dem Hinsehen vom Server — aufgebaut wird
    // der Schwarm, sobald sie da ist.
    if (round.count !== null && round.count !== undefined && this.laidOut !== round.index) {
      this.laidOut = round.index;
      this.layoutSwarm(round);
    }
    if (phase === this.shownPhase) return;
    this.shownPhase = phase;

    if (phase === "show") {
      this.feedback?.sound("sparkle");
      // Die Spanne steht schon beim HINSEHEN da, der Regler bleibt aber
      // gesperrt. Zu wissen, dass es zwischen 9 und 16 Tiere sind, gehört zur
      // Aufgabe — man schätzt anders, wenn man den Rahmen kennt. Erst danach
      // die Skala einzublenden hiesse, die Hälfte der Information zu spät zu
      // geben.
      if (this.slider) {
        const middle = Math.round((round.low + round.high) / 2);
        this.slider.min = String(round.low);
        this.slider.max = String(round.high);
        this.slider.value = String(middle);
        this.slider.disabled = true;
        if (this.valueLabel) this.valueLabel.textContent = "?";
        if (this.lowLabel) this.lowLabel.textContent = String(round.low);
        if (this.highLabel) this.highLabel.textContent = String(round.high);
      }
    }

    if (phase === "guess") {
      // Die Mitte als Startwert zeigen — das ist auch der Wert, mit dem der
      // Server rechnet, wenn niemand den Regler anfasst. Was man sieht, ist
      // also genau das, was gewertet wird. Frei gibt den Regler tick().
      if (this.slider && this.valueLabel) this.valueLabel.textContent = String(this.slider.value);
      this.feedback?.sound("lock");
    }

    if (phase === "reveal") {
      if (this.slider) this.slider.disabled = true;
      // Beim Auflösen tauchen die Tiere wieder auf und werden hochgezählt.
      this.countUpUntil = now + 1100;
      // Die Reaktion übernimmt tick() — für alle, nicht nur die eigene Figur.
    }
  }

  celebrate(result, round) {
    const at = this.swarmCentre.clone().setZ(0);
    if (result.error === 0) {
      this.burst(at, ["#ffe36b", "#ffffff"], { count: Math.round(20 * fxScale()), speed: 2.4, up: 2.0, size: 0.08, life: 0.8, drag: 1.6 });
      this.pop(at, "GENAU!", { color: "#ffe36b", size: 0.46, life: 1.0 });
      this.rig.shake(0.6);
      this.feedback?.sound("win");
    } else if (result.points > 0) {
      this.pop(at, `+${result.points}`, { color: "#c6ffb0", size: 0.38, life: 0.9 });
      this.feedback?.sound("coin");
    } else {
      this.pop(at, `${result.guess} statt ${round.count}`, { color: "#ff9aa8", size: 0.34, life: 0.9 });
      this.feedback?.sound("error");
    }
  }

  // Jede Tierart bewegt sich auf ihre Weise um ihren Platz: Bienen
  // schwirren in kleinen schnellen Schleifen, Schmetterlinge gaukeln,
  // Vögel ziehen Kreise, Libellen stehen und schiessen ein Stück weiter.
  // Alle bleiben in der Nähe ihres Platzes — zählbar, aber nicht still.
  critterOffset(kind, t, phase) {
    if (kind === "bee") return [Math.cos(t * 2.6 + phase) * 0.26, Math.sin(t * 4.1 + phase) * 0.1, Math.sin(t * 2.6 + phase) * 0.18];
    if (kind === "butterfly") return [Math.sin(t * 0.9 + phase) * 0.32, Math.sin(t * 2.3 + phase) * 0.16, Math.cos(t * 0.7 + phase) * 0.22];
    if (kind === "bird") return [Math.cos(t * 1.1 + phase) * 0.38, Math.sin(t * 1.6 + phase) * 0.08, Math.sin(t * 1.1 + phase) * 0.26];
    const dart = Math.sin(t * 1.2 + phase);
    return [Math.sign(dart) * Math.abs(dart) ** 0.3 * 0.3, Math.sin(t * 3 + phase) * 0.04, Math.cos(t * 0.6 + phase) * 0.16];
  }

  syncSwarm(active, dt, now) {
    const showing = active && (active.phase === "show" || active.phase === "reveal");
    // Beim Auflösen tauchen die Tiere NACHEINANDER wieder auf — das ist das
    // Zählen, das man selbst nicht geschafft hat.
    const counting = active?.phase === "reveal";
    const progress = counting ? clamp(1 - (this.countUpUntil - now) / 1100, 0, 1) : 1;
    const t = now / 1000;
    const count = this.critters.length;
    this.critters.forEach((critter, index) => {
      const wanted = !showing ? 0 : counting ? (index < progress * count ? 1 : 0) : 1;
      const before = critter.lit;
      critter.lit += (wanted - critter.lit) * frameLerp(counting ? 0.5 : 0.3, dt);
      if (counting && before < 0.5 && critter.lit >= 0.5) this.feedback?.sound("plink");
      const { kind, body, wings } = critter.mesh.userData;
      const [ox, oy, oz] = this.critterOffset(kind, t * critter.speed, critter.phase);
      const x = critter.home.x + ox;
      const y = critter.home.y + oy;
      const z = critter.home.z + oz;
      // In Flugrichtung drehen.
      const dx = x - critter.last.x;
      const dz = z - critter.last.z;
      if (Math.hypot(dx, dz) > 1e-4) {
        const want = Math.atan2(-dz, dx);
        const diff = Math.atan2(Math.sin(want - body.rotation.y), Math.cos(want - body.rotation.y));
        body.rotation.y += diff * frameLerp(0.25, dt);
      }
      critter.last.set(x, y, z);
      critter.mesh.position.set(x, y, z);
      // Flügel schlagen: schnell bei Bienen und Libellen, weit beim
      // Schmetterling, mit Gleitpausen beim Vogel.
      const beat = kind === "bee" ? Math.sin(t * 60) * 0.7
        : kind === "dragonfly" ? Math.sin(t * 48) * 0.35
          : kind === "butterfly" ? Math.sin(t * 9 + critter.phase) * 1.1
            : (Math.sin(t * 1.3 + critter.phase) > 0 ? Math.sin(t * 14 + critter.phase) * 0.8 : 0.15);
      wings.forEach(({ joint, side }) => { joint.rotation.x = side * beat; });
      const pop = critter.lit < 0.999 ? Math.sin(critter.lit * Math.PI) * 0.25 : 0;
      critter.mesh.scale.setScalar(Math.max(0.001, (critter.lit + pop) * CRITTER_SIZE));
      critter.mesh.visible = critter.lit > 0.01;
    });
  }

  tick(f) {
    const { now, dt, arcade, players, finale } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const active = this.activeRound();
    this.syncPhase(active, own, now);
    this.syncGuessWindow(active, f);
    this.flushGuess();
    this.pingIfIdle(f.minigame);
    this.syncSwarm(active, dt, now);
    const swarmCentre = this.swarmCentre;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const revealing = active?.phase === "reveal";
      const key = active ? active.round.index : -1;
      if (revealing && this.reacted.get(player.id) !== key) {
        this.reacted.set(player.id, key);
        const mine = (entry.guesses || []).find((guess) => guess.round === active.round.index);
        if (mine?.error === 0) {
          animator.trigger("celebrate");
          animator.expression("joy", 1500);
        } else if (mine?.points > 0) {
          animator.trigger("clap");
          animator.expression("happy", 1200);
        } else {
          animator.trigger("facepalm");
          animator.expression("sad", 1400);
        }
        if (player.id === f.controlledId && mine) this.celebrate(mine, active.round);
      }
      if (finale) return;
      // Beim Auflösen zur Kamera gedreht, sonst zum Schwarm.
      const face = revealing ? 0.2 : Math.PI;
      kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(0.12, dt);
      animator.lookAt(revealing ? null : swarmCentre);
      animator.set("sit");
      if (active?.phase === "guess") animator.expression("focus", 150);
    });
  }

  // Der Regler zählt, solange eine Bewegung noch vor dem Ende des Fensters beim
  // Server ankommt: Geräteuhr plus Rundreise. Vorher blieb er bis zum Ende
  // nach Geräteuhr offen, und was man in der letzten Rundreise noch zog, kam
  // zu spät und zählte nicht.
  syncGuessWindow(active, f) {
    const startedAt = f.minigame?.startedAt || 0;
    const arrive = f.now + this.roundTrip - startedAt;
    const open = Boolean(active && active.phase === "guess" && !f.finale && arrive < active.round.revealFrom);
    if (open !== this.guessOpen) {
      // Beim Schliessen geht der letzte Stand noch hinaus, auch wenn die
      // Drossel ihn gerade zurückhielte — er kommt so zum Ende des Fensters
      // an, in der Schonfrist des Servers.
      if (!open) this.flushGuess(true);
      this.guessOpen = open;
      if (this.slider) this.slider.disabled = !open;
    }
    if (this.timerFill) {
      const span = active ? active.round.revealFrom - active.round.guessFrom : 1;
      const left = active && active.phase === "guess" ? clamp((active.round.revealFrom - arrive) / span, 0, 1) : 0;
      this.timerFill.style.width = `${(left * 100).toFixed(1)}%`;
      const late = left > 0 && left < 0.25 ? "1" : "0";
      if (this.timerBar && this.timerBar.dataset.late !== late) this.timerBar.dataset.late = late;
    }
  }

  keepInView(f) {
    return f.players.map((player) => this.kins.get(player.id)).filter(Boolean);
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const active = this.activeRound();
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.round(own?.score || 0));
    const roundLabel = this.hud.querySelector("[data-swarm-round]");
    if (roundLabel) {
      const total = arcade.rounds?.length || 0;
      roundLabel.textContent = active
        ? `Durchgang ${active.round.index + 1}/${total}`
        : "Gleich geht's los";
    }

    const chips = this.hud.querySelector("[data-swarm-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="simon-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.round(entry?.score || 0)}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-swarm-banner]");
    if (!banner) return;
    if (!active) { banner.hidden = true; return; }
    if (active.phase === "show") {
      banner.hidden = false;
      banner.textContent = `${(KIND_WORDS[active.round.kind] || "Tiere").toUpperCase()} — HINSEHEN …`;
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
      return;
    }
    if (active.phase === "guess") {
      banner.hidden = false;
      banner.textContent = `Wie viele ${KIND_WORDS[active.round.kind] || "Tiere"} waren es?`;
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
      return;
    }
    const mine = (own?.guesses || []).find((entry) => entry.round === active.round.index);
    // Der Regler zeigt bei der Auflösung die Zahl, die GEWERTET wurde. Wer im
    // letzten Moment noch zog, sah sonst eine andere Zahl als im Banner.
    if (mine && this.slider && this.valueLabel && this.valueLabel.textContent !== String(mine.guess)) {
      this.slider.value = String(mine.guess);
      this.valueLabel.textContent = String(mine.guess);
    }
    banner.hidden = false;
    banner.textContent = mine
      ? `Es waren ${active.round.count} — du: ${mine.guess} (+${mine.points})`
      : `Es waren ${active.round.count}`;
    banner.style.background = mine && mine.error === 0 ? "#ffe36b" : "#9fc7ff";
    banner.style.color = "#152436";
  }
}
