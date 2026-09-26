import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Trampolin: im Takt tippen — jeder Treffer trägt höher hinaus, ein
// Fehlgriff kostet Höhe. Der Takt wird mit der Zeit schneller.
//
// Vorher hüpften die Figuren in derselben Haltung auf und ab und drehten
// sich ab einer gewissen Höhe um die eigene Achse. Jetzt federn sie sichtbar
// ins Tuch, stossen sich ab, rudern in der Luft, machen weiter oben Saltos
// und fliegen ganz oben wie Superhelden. Die Kamera steigt mit der eigenen
// Figur.
const FALLBACK_TEMPOS = [900, 800, 720, 650, 590, 540];
const FALLBACK_BAR = 8;
// Bahnabstand ist am Portrait-Bild gerechnet, nicht geschätzt: bei z=9.6 und
// 62° FOV reicht das sichtbare Fenster bis ±2.66. Mit 2.1 Abstand lagen die
// äusseren Bahnen bei ±3.15 — der eigene Kin war je nach Index gar nicht im
// Bild. 1.25 setzt sie auf ±1.88, die Ränder bleiben mit Rand sichtbar.
const LANE_GAP = 1.25;
const PAD_R = 0.46;
const PAD_Y = 0.3;
const WORLD_PER_HEIGHT = 0.28;   // Server-Höheneinheit → Weltmaß
// Höhenstufen. Vorher gab es genau zwei Zustände — springt oder steht — und auf
// dreissig Höhenmetern sah das aus wie auf drei. Der Aufstieg muss sich ansehen
// lassen, sonst fühlt er sich folgenlos an.
const TIER_HEIGHTS = [4, 9, 16, 26, 40];
const TIER_LABELS = ["ABGEHOBEN!", "HOCH HINAUS!", "ÜBER DEN WOLKEN!", "SCHWERELOS!", "IN DEN STERNEN!"];

// Der Abstand VOR dem Schlag mit dieser Nummer. Innerhalb eines Taktes gleich,
// an der Taktgrenze eine Stufe schneller.
function beatInterval(index, tempos, bar) {
  const step = Math.floor(Math.max(0, index - 1) / bar);
  return tempos[Math.min(step, tempos.length - 1)];
}

// Nächster Schlag zu `elapsed` plus der Abstand zum folgenden — für die Anzeige.
function beatWindow(elapsed, arcade) {
  const tempos = arcade?.tempos?.length ? arcade.tempos : FALLBACK_TEMPOS;
  const bar = arcade?.barBeats || FALLBACK_BAR;
  let index = 0;
  let time = 0;
  while (time + beatInterval(index + 1, tempos, bar) <= elapsed) {
    time += beatInterval(index + 1, tempos, bar);
    index += 1;
  }
  const interval = beatInterval(index + 1, tempos, bar);
  // Wie viele Schläge noch bis zum Tempowechsel — daran hängt die Ansage.
  const inBar = index % bar;
  const step = Math.floor(index / bar);
  const faster = step < tempos.length - 1;
  return { index, start: time, interval, inBar, bar, step, beatsToChange: faster ? bar - inBar : null };
}

export class Trampoline extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.pads = new Map();
    this.lastTapAt = new Map();
    this.tierSeen = new Map();
    this.lastBarStep = null;
    this.lastBeatSeen = -1;
    this.labelY = 0.74;
    this.ownPeak = PAD_Y + 0.4;
  }

  stage() {
    return {
      label: "3D Trampolin",
      background: "#a8e2f4",
      fog: ["#a8e2f4", 18, 46],
      lights: { sunPosition: [-4, 14, 7], shadow: { left: -8, right: 8, top: 14, bottom: -4 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="beat-strip" data-beat-strip>
        <div class="beat-pulse" data-beat-pulse></div>
        <span data-beat-label>Im Takt tippen</span>
      </div>
      <div class="color-banner" data-bounce-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fb06c" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    // Kulisse: Bodenflecken, Büschel, Blumen, Steine und ein Baumkranz als
    // Horizont. Ohne sie stösst die Wiese als harte Kante gegen den Himmel.
    dressMeadow(this.scene, { seed: 18, keepOut: { x: 5.0, z: 2.2 }, spread: { x: 18, z: 15 }, grassColor: "#6ea462", patchColors: ["#7cb071", "#8dba82"], crownColor: "#e88fb5", crownColor2: "#f2b3cd", trunkColor: "#6b4a2c", crownShape: "blob", flowerColors: ["#ff8fb1", "#ffffff", "#ffd15c"] });

    // Höhenmarken an einem Messpfosten — die Höhe ist die Wertung, also muss
    // man sie ablesen können.
    for (let mark = 5; mark <= 30; mark += 5) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(9.5, 0.04, 0.06),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.28, depthWrite: false })
      );
      bar.position.set(0, PAD_Y + mark * WORLD_PER_HEIGHT, -1.4);
      scene.add(bar);
    }

    const players = this.getState()?.players || [];
    this.buildWorld(players.length);
    this.buildCircus(players.length);
    players.forEach((player, index) => this.addPad(player, index, players.length));
  }

  // Die Welt nach oben. Die Stufen heissen "Über den Wolken", "Schwerelos",
  // "In den Sternen" — vorher flog man in einen leeren, überall gleich
  // blassen Himmel, und die Kamera zeigte oben wie unten dasselbe Nichts.
  // Jetzt wird der Himmel mit der Höhe dunkler, auf Höhe der Wolken-Stufe
  // liegt eine Wolkenschicht, darüber treiben Heissluftballons, ganz oben
  // stehen Sterne und ein Mond. Hinten liegen Hügel in der Ferne, über den
  // Trampolinen hängen Wimpelketten.
  buildWorld(count) {
    const scene = this.scene;
    const heightOf = (tier) => PAD_Y + tier * WORLD_PER_HEIGHT;

    // Himmelskuppel mit Verlauf: hell am Horizont, tiefblau oben. Ohne Nebel,
    // sonst verschwindet der Verlauf im Dunst.
    const skyGeo = new THREE.SphereGeometry(52, 24, 16);
    const colors = [];
    const low = new THREE.Color("#bfe9f7");
    const mid = new THREE.Color("#6fbde9");
    const high = new THREE.Color("#1c2560");
    const pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      // Der Verlauf beginnt knapp über dem Horizont: die Kamera schaut nur
      // flach nach oben, und erst ab halber Kuppel wurde es sonst blauer.
      const c = y < 2 ? low.clone() : y < 12 ? low.clone().lerp(mid, (y - 2) / 10) : mid.clone().lerp(high, Math.min(1, (y - 12) / 14));
      colors.push(c.r, c.g, c.b);
    }
    skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    sky.renderOrder = -10;
    scene.add(sky);

    // Hügel in der Ferne, zwei Reihen, vom Dunst aufgehellt.
    [[-16, -24, 9, "#8fd18a"], [-4, -28, 12, "#84c98a"], [10, -25, 10, "#8fd18a"], [22, -30, 13, "#7fc28a"], [-26, -30, 11, "#7fc28a"]].forEach(([x, z, r, color]) => {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshLambertMaterial({ color }));
      hill.scale.y = 0.45;
      hill.position.set(x, -r * 0.12, z);
      scene.add(hill);
    });

    // Wimpelketten über den Trampolinen, knapp dahinter — man springt davor
    // hindurch nach oben.
    const span = count * LANE_GAP / 2 + 1.1;
    const poleMat = new THREE.MeshLambertMaterial({ color: "#f3e6cf" });
    [-1, 1].forEach((side) => {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.9, 0.1), poleMat);
      pole.position.set(side * span, 1.45, -1.2);
      pole.castShadow = true;
      scene.add(pole);
    });
    const flagColors = ["#ff5d73", "#ffd15c", "#4bb8ff", "#7fe06f", "#ff9f43", "#c38cff"];
    [2.75, 2.35].forEach((y, row) => {
      const flags = 16;
      for (let i = 0; i < flags; i += 1) {
        const t = (i + 0.5) / flags;
        const x = -span + t * span * 2;
        const sag = Math.sin(t * Math.PI) * 0.35;
        const flag = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 3), new THREE.MeshLambertMaterial({ color: flagColors[(i + row * 3) % flagColors.length] }));
        flag.rotation.x = Math.PI;
        flag.position.set(x, y - sag - 0.12, -1.2 - row * 0.05);
        scene.add(flag);
      }
    });

    // Wolkenschicht auf Höhe der Stufe "Über den Wolken" — seitlich und
    // dahinter, nie vor den Springern.
    this.skyClouds = [];
    for (let i = 0; i < 9; i += 1) {
      const cloud = createCloud(i + 3);
      const side = i % 2 ? 1 : -1;
      const x = side * (1.8 + (i * 1.7) % 7.5);
      cloud.position.set(x, heightOf(16) + ((i * 0.37) % 1) * 1.2 - 0.4, -2.5 - (i % 3) * 2.2);
      cloud.scale.setScalar(1.1 + (i % 3) * 0.35);
      scene.add(cloud);
      this.skyClouds.push({ cloud, speed: 0.12 + (i % 3) * 0.05, baseX: x });
    }
    // Zwei tiefere Wolken für den Horizont.
    [[-7, 3.6, -9, 1], [7.5, 3.1, -10, 2]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      cloud.scale.setScalar(1.4);
      scene.add(cloud);
    });

    // Heissluftballons auf Höhe von "Schwerelos".
    this.balloons = [];
    [[-2.9, heightOf(26), -7, "#ff5d73", "#ffd15c"], [3.4, heightOf(31), -9, "#4bb8ff", "#ffffff"]].forEach(([x, y, z, a, b], i) => {
      const group = new THREE.Group();
      for (let k = 0; k < 6; k += 1) {
        const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10, (k / 6) * Math.PI * 2, Math.PI / 3), new THREE.MeshLambertMaterial({ color: k % 2 ? a : b }));
        stripe.scale.y = 1.15;
        group.add(stripe);
      }
      const basket = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
      basket.position.y = -1.45;
      group.add(basket);
      group.position.set(x, y, z);
      scene.add(group);
      this.balloons.push({ group, baseY: y, phase: i * 2.1 });
    });

    // Sterne und Mond ganz oben ("In den Sternen").
    const starCount = 70;
    const stars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), new THREE.MeshBasicMaterial({ color: "#fff7c9", fog: false }), starCount);
    const m = new THREE.Object3D();
    for (let i = 0; i < starCount; i += 1) {
      const r1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      const r2 = Math.abs(Math.sin(i * 78.233) * 12345.678) % 1;
      const r3 = Math.abs(Math.sin(i * 39.425) * 24634.634) % 1;
      m.position.set((r1 - 0.5) * 30, heightOf(36) + r2 * 9, -10 - r3 * 10);
      m.rotation.set(r1 * 3, r2 * 3, 0);
      m.scale.setScalar(0.7 + r3 * 1.3);
      m.updateMatrix();
      stars.setMatrixAt(i, m.matrix);
    }
    stars.instanceMatrix.needsUpdate = true;
    scene.add(stars);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshBasicMaterial({ color: "#fff3c4", fog: false }));
    moon.position.set(6.5, heightOf(44), -16);
    scene.add(moon);
  }

  // Zirkuswiese: eine Manege mit Sägemehl und rot-weissem Rand um die
  // Trampoline, dahinter das gestreifte Zirkuszelt mit Fahne, vorn ein
  // Popcornwagen und Artistenpodeste mit Sternen.
  buildCircus(count) {
    const scene = this.scene;
    const zufall = streuer(61);
    const manege = new THREE.Mesh(new THREE.CircleGeometry(4.4, 40), lambert("#e6c58f"));
    manege.rotation.x = -Math.PI / 2;
    manege.position.set(0, 0.012, -0.6);
    manege.receiveShadow = true;
    scene.add(manege);
    const spaene = [];
    for (let i = 0; i < 70; i += 1) {
      const a = zufall() * Math.PI * 2;
      const r = Math.sqrt(zufall()) * 4.2;
      spaene.push({ p: [Math.cos(a) * r, 0.016, -0.6 + Math.sin(a) * r], r: [-Math.PI / 2, 0, zufall() * 3], s: 0.05 + zufall() * 0.05 });
    }
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#cfa56a"), spaene);
    const rand = [[], []];
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * Math.PI * 2;
      rand[i % 2].push({ p: [Math.cos(a) * 4.5, 0.16, -0.6 + Math.sin(a) * 4.5], r: [0, -a, 0] });
    }
    viele(scene, new THREE.BoxGeometry(0.28, 0.32, 0.8), lambert("#d8313b"), rand[0], { schatten: true });
    viele(scene, new THREE.BoxGeometry(0.28, 0.32, 0.8), lambert("#fdf6ea"), rand[1], { schatten: true });

    // Zirkuszelt.
    const streifen = zirkusTextur();
    const zelt = new THREE.Group();
    zelt.position.set(1.6, 0, -10);
    scene.add(zelt);
    const wand = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 2.4, 24, 1, true), new THREE.MeshLambertMaterial({ map: streifen }));
    wand.position.y = 1.2;
    zelt.add(wand);
    const dach = new THREE.Mesh(new THREE.ConeGeometry(3.7, 2.6, 24, 1, true), new THREE.MeshLambertMaterial({ map: streifen }));
    dach.position.y = 3.7;
    zelt.add(dach);
    const zacken = [];
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      zacken.push({ p: [Math.sin(a) * 3.72, 2.3, Math.cos(a) * 3.72], r: [Math.PI, a, 0] });
    }
    viele(zelt, new THREE.ConeGeometry(0.26, 0.34, 3), lambert("#ffd15c"), zacken);
    const eingang = new THREE.Mesh(new THREE.CircleGeometry(1.0, 3), lambert("#3a1a2a"));
    eingang.geometry.rotateZ(Math.PI / 2);
    eingang.position.set(0, 0.5, 3.41);
    zelt.add(eingang);
    kiste(zelt, 0.08, 1.4, 0.08, "#f3e6cf", [0, 5.6, 0], { schatten: false });
    this.circusFlag = kiste(zelt, 0.8, 0.45, 0.03, "#d8313b", [0.42, 6.05, 0], { schatten: false });

    // Popcornwagen links vorn.
    const wagen = new THREE.Group();
    // Tief und weit vorn: höher stehend verdeckte die Glashaube im Bild das
    // Trampolin ganz links.
    wagen.position.set(-1.75, 0, 7.2);
    wagen.rotation.y = 0.4;
    wagen.scale.setScalar(0.7);
    scene.add(wagen);
    kiste(wagen, 0.9, 0.6, 0.55, "#d8313b", [0, 0.55, 0]);
    const glas = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.5), new THREE.MeshLambertMaterial({ color: "#fff6c8", transparent: true, opacity: 0.55, depthWrite: false }));
    glas.position.y = 1.13;
    wagen.add(glas);
    const koerner = [];
    for (let i = 0; i < 24; i += 1) koerner.push({ p: [(zufall() - 0.5) * 0.7, 0.9 + zufall() * 0.22, (zufall() - 0.5) * 0.4] });
    viele(wagen, new THREE.DodecahedronGeometry(0.05, 0), lambert("#fff4d0"), koerner);
    kiste(wagen, 1.0, 0.1, 0.62, "#fdf6ea", [0, 1.45, 0]);
    [[-0.4, 0.3], [0.4, 0.3]].forEach(([x, z]) => {
      const rad = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 12), lambert("#2c2f38"));
      rad.rotation.x = Math.PI / 2;
      rad.position.set(x, 0.18, z);
      wagen.add(rad);
    });

    // Artistenpodeste mit Sternen rechts vorn.
    [[1.35, 6.4, 0.42, "#2f6fb0"], [1.85, 7.0, 0.3, "#ffd15c"]].forEach(([x, z, h, farbe]) => {
      const podest = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, h, 16), lambert(farbe));
      podest.position.set(x, h / 2, z);
      podest.castShadow = true;
      scene.add(podest);
      const stern = new THREE.Mesh(new THREE.CircleGeometry(0.14, 5), lambert("#ffffff"));
      stern.position.set(x, h / 2, z + 0.37);
      scene.add(stern);
    });
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  addPad(player, index, count) {
    const x = this.laneX(index, count);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(PAD_R, 0.07, 6, 18), new THREE.MeshLambertMaterial({ color: "#40506a" }));
    frame.rotation.x = Math.PI / 2;
    frame.position.set(x, PAD_Y, 0);
    this.scene.add(frame);
    const cloth = new THREE.Mesh(new THREE.CylinderGeometry(PAD_R - 0.06, PAD_R - 0.06, 0.05, 18), new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.15 }));
    cloth.position.set(x, PAD_Y, 0);
    cloth.receiveShadow = true;
    this.scene.add(cloth);
    [-1, 1].forEach((side) => {
      [-1, 1].forEach((depth) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, PAD_Y, 0.07), new THREE.MeshLambertMaterial({ color: "#40506a" }));
        leg.position.set(x + side * (PAD_R - 0.12), PAD_Y / 2, depth * (PAD_R - 0.12));
        this.scene.add(leg);
      });
    });
    this.addKin(player, index, { x, ground: PAD_Y + 0.1, z: 0, facing: 0 });
    this.pads.set(player.id, { x, cloth, color: player.color, flip: 0, lastSwing: 0 });
  }

  shot() {
    const count = Math.max(1, this.pads.size);
    return {
      look: [0, 1.3, 0],
      frame: { w: count * LANE_GAP + 0.6, h: 3.2 },
      pitch: 0.12,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-bounce-jump>
        <span class="nerve-button-face">HÜPFEN!</span>
      </button>`;
    this.button = this.controls.querySelector("[data-bounce-jump]");
    const tap = (event) => {
      event.preventDefault();
      this.pressJump();
    };
    this.on(this.button, "pointerdown", tap);
    this.on(this.webglCanvas, "pointerdown", tap);
  }

  pressJump() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    this.feedback?.sound("tap");
    this.sendInput({ action: "jump" }).catch(() => {});
  }

  heightTier(height) {
    let tier = 0;
    for (let i = 0; i < TIER_HEIGHTS.length; i += 1) {
      if (height >= TIER_HEIGHTS[i]) tier = i + 1;
    }
    return tier;
  }

  tick(f) {
    if (this.circusFlag) this.circusFlag.rotation.y = Math.sin(f.now / 380) * 0.35;
    // Wolken ziehen, Ballons schweben.
    const drift = (f.dt || 0);
    this.skyClouds?.forEach((entry) => {
      entry.cloud.position.x += drift * entry.speed;
      if (entry.cloud.position.x > 11) entry.cloud.position.x -= 22;
    });
    this.balloons?.forEach((entry) => {
      entry.group.position.y = entry.baseY + Math.sin(f.now / 1400 + entry.phase) * 0.25;
    });
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const beat = beatWindow(elapsed, arcade);
    this.lastWindow = beat;
    const phase = Math.min(1, Math.max(0, (elapsed - beat.start) / beat.interval));
    this.phase = phase;
    if (beat.index !== this.lastBeatSeen) {
      this.lastBeatSeen = beat.index;
      this.feedback?.sound(beat.inBar === 0 ? "clack" : "plink");
    }
    if (beat.step !== this.lastBarStep) {
      if (this.lastBarStep !== null) {
        this.pop(new THREE.Vector3(0, this.ownPeak + 1.2, 0), "SCHNELLER!", { color: "#ffe36b", size: 0.44, life: 1 });
        this.feedback?.sound("combo");
      }
      this.lastBarStep = beat.step;
    }
    const swing = Math.abs(Math.sin(phase * Math.PI));

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const pad = this.pads.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !pad || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const rest = PAD_Y + 0.4 - (1 - swing) * 0.08;
      const peak = PAD_Y + 0.4 + (entry.height || 0) * WORLD_PER_HEIGHT;
      animator.groundY = THREE.MathUtils.lerp(animator.groundY, rest + (peak - PAD_Y - 0.4) * swing, frameLerp(0.35, dt));
      // Das Tuch gibt unten nach.
      const dip = Math.max(0, 0.35 - swing) / 0.35;
      pad.cloth.position.y = PAD_Y - dip * 0.12;
      pad.cloth.scale.set(1 + dip * 0.05, 1, 1 + dip * 0.05);
      if (isOwn) this.ownPeak = peak;

      const tap = entry.lastTap;
      if (tap && tap.at !== this.lastTapAt.get(player.id)) {
        this.lastTapAt.set(player.id, tap.at);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.6, 0));
        if (tap.grade === "perfect") {
          animator.expression("joy", 500);
          this.burst(at, [pad.color, "#ffe36b", "#ffffff"], { count: 12, speed: 1.8, up: 2, size: 0.07, life: 0.6, drag: 1.8 });
          // Schrift nur über der eigenen Figur: bei vier Springern stapelten
          // sich sonst "33× IM TAKT!" und "fast" zu einem Textberg.
          if (isOwn) this.pop(at, entry.streak > 2 ? `${entry.streak}× IM TAKT!` : "IM TAKT!", { color: "#ffe36b", size: 0.36, life: 0.8 });
          if (isOwn) {
            this.feedback?.sound("perfect");
            this.feedback?.vibrate([8, 12, 14]);
          }
        } else if (tap.grade === "good") {
          animator.expression("happy", 400);
          if (isOwn) this.pop(at, "fast", { color: "#bfe9ff", size: 0.28, life: 0.6, rise: 0.6 });
          if (isOwn) this.feedback?.sound("pop");
        } else {
          animator.trigger("flinch");
          animator.expression("scared", 600);
          this.burst(at, ["#ff6b7f", "#ffffff"], { count: 8, speed: 1.4, up: 1, size: 0.06, life: 0.5, drag: 2.2 });
          if (isOwn) this.pop(at, "DANEBEN", { color: "#ff9aa8", size: 0.3, life: 0.7 });
          if (isOwn) {
            this.feedback?.sound("error");
            this.feedback?.vibrate(20);
            this.rig.shake(0.3);
          }
        }
      }
      const tier = this.heightTier(entry.height || 0);
      const known = this.tierSeen.get(player.id) ?? 0;
      if (tier > known) {
        this.tierSeen.set(player.id, tier);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.8, 0));
        this.burst(at, [pad.color, "#ffffff", "#ffe36b"], { count: 10 + tier * 6, speed: 2.0 + tier * 0.4, up: 2.2, size: 0.08, life: 0.8, drag: 1.5 });
        if (isOwn) this.pop(at, TIER_LABELS[Math.min(tier, TIER_LABELS.length - 1)], { color: "#ffe36b", size: 0.38 + tier * 0.04, life: 1 });
        if (isOwn) {
          this.feedback?.sound("sparkle");
          this.feedback?.vibrate([10, 8, 16]);
        }
      }
      // Aufsetzen: kurz stauchen.
      if (pad.lastSwing > 0.2 && swing <= 0.2) animator.trigger("land");
      pad.lastSwing = swing;
      if (finale) {
        kin.rotation.x = 0;
        return;
      }
      // Salto ab der zweiten Stufe, einmal je Sprung über den Scheitel.
      if (tier >= 2 && swing > 0.3) pad.flip = Math.min(Math.PI * 2, pad.flip + dt * Math.PI * 2 / Math.max(0.25, beat.interval / 1000 * 0.7));
      if (swing < 0.3) pad.flip = 0;
      kin.rotation.x = tier >= 2 && tier < 4 ? -pad.flip : 0;
      if (swing < 0.3) animator.set("ready");
      else if (tier >= 4) animator.set("fly");
      else if (tier >= 1) animator.set("float");
      else animator.set("float");
    });
  }

  // Mit der eigenen Figur steigen.
  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    return own ? [own] : [...this.kins.values()];
  }

  rigOptions(f) {
    const count = Math.max(1, this.pads.size);
    const top = this.ownPeak;
    return {
      look: [0, Math.max(1.3, top * 0.55 + 0.6), 0],
      frame: { w: count * LANE_GAP + 0.6, h: Math.max(3.2, top + 1.4) }
    };
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const phase = this.phase || 0;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = (own?.height || 0).toFixed(1);
    const pulse = this.hud.querySelector("[data-beat-pulse]");
    if (pulse) {
      pulse.style.transform = `scaleX(${phase.toFixed(3)})`;
      pulse.style.background = phase > 0.86 ? "#7fe06f" : "#ffe36b";
    }
    const label = this.hud.querySelector("[data-beat-label]");
    if (label) {
      label.textContent = own?.streak > 1 ? `${own.streak}× in Folge` : "Im Takt tippen";
    }

    const banner = this.hud.querySelector("[data-bounce-banner]");
    if (banner) {
      const beatsLeft = this.lastWindow?.beatsToChange;
      if (beatsLeft !== null && beatsLeft !== undefined && beatsLeft <= 2) {
        // Der Tempowechsel wird ZWEI Schläge vorher angesagt. Überraschend
        // schneller zu werden ist kein Können, sondern Pech — vorbereitet
        // schneller zu werden ist genau das, worum es geht.
        banner.hidden = false;
        banner.textContent = "Gleich schneller!";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if ((own?.streak || 0) >= 5) {
        banner.hidden = false;
        banner.textContent = `Resonanz ${own.streak}× — weiter so!`;
        banner.style.background = "#7fe06f";
        banner.style.color = "#14361a";
      } else {
        banner.hidden = true;
      }
    }
  }
}

// Rot-weisse Zirkusstreifen für Zeltwand und Dach.
function zirkusTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 16; i += 1) {
    ctx.fillStyle = i % 2 ? "#fdf6ea" : "#d8313b";
    ctx.fillRect(i * 16, 0, 16, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
