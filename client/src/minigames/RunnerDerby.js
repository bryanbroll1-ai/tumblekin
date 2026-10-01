import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createKin, KinAnimator, KIN_SOLE, standOn } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp, prefersReducedMotion } from "./Quality.js?v=tumblekin200";

// Zielgerade: drei Bahnen auf einer echten Laufbahn — Boostplatten, Matsch,
// Hürden und Heuballen. Wischen wechselt die Bahn, Tippen oder nach oben
// wischen springt. Gegenstände gibt es keine.
//
// Die alte Strecke war blass und neblig, die Beläge flache Pastellplatten,
// Torbögen schnitten quer durchs Bild, die Hürden waren rote Kisten, und ein
// einfacher Tipp löste aus Versehen einen Angriff aus. Jetzt: rote Tartanbahn
// mit weissen Linien und Meterangaben, Boostfelder mit laufenden Pfeilen,
// Matschpfützen, die spritzen, Leichtathletik-Hürden, Tribünen und
// Wimpelketten an der Seite, eine höhere Kamera, und Tippen heisst Springen.
const LANE_WIDTH = 1.15;
const footBounds = new THREE.Box3();
// Grösse der wiederverwendeten Kulissen-Vorräte. Am Bild gerechnet: die Kamera
// sieht bei diesem Blickwinkel gut 14 Streckeneinheiten voraus, also reichen
// zwölf Striche und je zwölf Objekte pro Seite mit deutlichem Puffer.
const RUNG_POOL = 12;
const PROP_POOL = 24;
const PROP_SPACING = 2.6;
const SEGMENT = 0.62; // world units per track meter
// Die Belagfarben müssen aus zwanzig Metern Entfernung zu unterscheiden sein —
// die ganze Entscheidung des Spiels hängt daran, sie VORAUS zu lesen.
//
// Tempo war zuerst hellblau. Gemessen am Bild war das die schlechteste
// mögliche Wahl: der Himmel ist hellblau, und am Horizont, also genau dort,
// wo man vorausliest, gingen Bahn und Himmel ineinander über. Violett kommt
// in dieser Szene sonst nirgends vor — nicht im Himmel, nicht in der Wiese,
// nicht im Sand und nicht im normalen Belag.
const SURFACE_COLOUR = { sand: "#6b4424", normal: "#c8624c", tempo: "#3ccfa8" };
const FLOOR_Y = 0;                  // Oberkante der Laufbahn
// Wie viel Platz eine laufende Figur braucht. Zwei passen nebeneinander in
// eine Bahn (je 0.28 aus der Mitte), eine dritte läuft ein Stück dahinter.
const KIN_BREIT = 0.56;
const KIN_TIEF = 0.55;
const BAHN_SPIEL = LANE_WIDTH / 2 - KIN_BREIT / 2;
const JUMP_REST_MS = 350;           // wie auf dem Server: so lange nach der Landung kein neuer Sprung
const SHOT_FOV = 40;
const KICK_MS = 700;                // so lange wirkt der Anschub im Bild nach
const TRAIL_POOL = 14;
const HURDLE_CLEAR = 0.78;           // so hoch sind die Füsse über einer Hürde mindestens
const HURDLE_CLEAR_REACH = 0.9;      // ab diesem Abstand zur Hürde gilt das
const KIN_Y = standOn(FLOOR_Y);
// Die Zuschauer sind kleiner — und weil der Sohlenabstand mitskaliert,
// muss auch er mit dem Massstab multipliziert werden.
const FAN_SCALE = 0.8;
// Die Zuschauer stehen NEBEN der Bahn auf der Wiese, nicht auf dem
// Seitenstreifen: sie sitzen bei |x| ≈ 3.1, der Streifen endet bei 1.9.
const MEADOW_TOP_Y = FLOOR_Y - 0.31 + 0.25;
const FAN_Y = MEADOW_TOP_Y + KIN_SOLE * FAN_SCALE;

// The chase camera looks toward +z, which mirrors the x axis on screen.
// Mapping lane 0→right … lane 2→left keeps the on-screen direction matching
// the ◀/▶ buttons and swipes.
function laneX(lane) {
  return (1 - lane) * LANE_WIDTH;
}

const _white = new THREE.Color("#ffffff");
const _mint = new THREE.Color("#8ff5d8");
const _trail = new THREE.Color();

function frac(v) {
  const x = Math.sin(v * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Mehrere Quader zu einer Geometrie mit einer Farbe je Quader.
function mergeBoxes(teile) {
  const pos = [];
  const norm = [];
  const col = [];
  const idx = [];
  const farbe = new THREE.Color();
  teile.forEach(({ size, at, color }) => {
    const box = new THREE.BoxGeometry(...size);
    box.translate(...at);
    farbe.set(color);
    const start = pos.length / 3;
    const p = box.getAttribute("position");
    const n = box.getAttribute("normal");
    for (let i = 0; i < p.count; i += 1) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      norm.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(farbe.r, farbe.g, farbe.b);
    }
    box.getIndex().array.forEach((v) => idx.push(start + v));
    box.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

export class RunnerDerby extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.obstacles = [];
    this.scenery = [];
    this.streaks = [];
    this.spectators = [];
    this.spectatorParts = [];
    this.lastStumbles = new Map();
    this.lastFinished = new Map();
    this.lastJump = new Map();
    this.lastCrash = new Map();
    this.boost = 0;
    this.kick = 0;
    this.trail = [];
    this.trailAt = 0;
    this.swipe = null;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Zielgerade",
      background: "#6fc3f0",
      fog: ["#a9dcf5", 34, 90],
      lights: { sunPosition: [-4, 10, -2], sunIntensity: 3.2, skyColor: 0xdfefff, groundColor: 0x6fb0c4, sunColor: 0xfff4d6 }
    };
  }

  // Oben links Zeit, Platz und Meter bis ins Ziel; rechts am Rand die
  // Rennleiste mit allen Läufern. Vorher stand dort nur, wie weit man selbst
  // gelaufen war — ob man vorn oder hinten lag, sah man nur, wenn die anderen
  // zufällig im Bild waren.
  hudHtml() {
    return `
      <div class="runner-speed" data-runner-speed></div>
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong class="runner-place" data-kinetic-score>1.</strong><span class="runner-togo" data-runner-togo>150m</span></div>
      <div class="race-rail" data-race-rail><b class="race-rail-flag">🏁</b></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame.arcade;
    const trackZ = arcade.trackLength * SEGMENT;
    this.trackZ = trackZ;
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.5, trackZ + 34),
      new THREE.MeshLambertMaterial({ color: "#6a9f5e" })
    );
    meadow.position.set(0, FLOOR_Y - 0.31, trackZ / 2);
    meadow.receiveShadow = true;
    scene.add(meadow);

    // Die Laufbahn: roter Tartan, weisse Linien zwischen den Bahnen.
    for (let lane = 0; lane < 3; lane += 1) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.02, 0.3, trackZ + 8),
        new THREE.MeshLambertMaterial({ color: SURFACE_COLOUR.normal })
      );
      strip.position.set(laneX(lane), FLOOR_Y - 0.15, trackZ / 2);
      strip.receiveShadow = true;
      scene.add(strip);
    }
    const lineMat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    for (let k = 0; k <= 3; k += 1) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, trackZ + 8), lineMat);
      line.position.set((1.5 - k) * LANE_WIDTH, FLOOR_Y + 0.011, trackZ / 2);
      scene.add(line);
    }
    // Aussen ein Kunststoffrand und dahinter die Wiese.
    [-1, 1].forEach((side) => {
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, trackZ + 8), new THREE.MeshLambertMaterial({ color: "#4178bd" }));
      kerb.position.set(side * (LANE_WIDTH * 1.5 + 0.3), FLOOR_Y - 0.14, trackZ / 2);
      kerb.receiveShadow = true;
      scene.add(kerb);
    });

    // Beläge aus dem geteilten Kurs. Beides sind DINGE auf der Bahn, keine
    // eingefärbten Rechtecke: Boost ist eine Reihe leuchtender Boostplatten
    // mit Pfeil, verbunden durch Leuchtstreifen an den Bahnrändern; Matsch
    // ist eine unregelmässige Pfütze mit Blasen und Steinchen am Rand. Beide
    // bleiben innerhalb ihrer Bahn.
    const segLen = (arcade.segLen || 7.5) * SEGMENT;
    const felder = { tempo: [], sand: [] };
    (arcade.segments || []).forEach((segment) => {
      segment.lanes.forEach((belag, lane) => {
        if (belag === "normal") return;
        felder[belag].push({ lane, z: (segment.at + (arcade.segLen || 7.5) / 2) * SEGMENT });
      });
    });
    const place = new THREE.Object3D();
    const setze = (mesh, i, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => {
      place.position.set(x, y, z);
      place.scale.set(sx, sy, sz);
      place.rotation.set(0, ry, 0);
      place.updateMatrix();
      mesh.setMatrixAt(i, place.matrix);
    };
    if (felder.tempo.length) {
      const perPad = 3;
      const spacing = segLen / perPad;
      const count = felder.tempo.length * perPad;
      // Die Platte: ein dunkler Rahmen, darin eine leuchtende Fläche, darauf
      // ein grosser Pfeil. Flach genug, dass niemand darin versinkt.
      const frame = new THREE.InstancedMesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.22, 0.022, spacing * 0.78),
        new THREE.MeshLambertMaterial({ color: "#1f4a52" }),
        count
      );
      const glow = new THREE.InstancedMesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.36, 0.024, spacing * 0.78 - 0.14),
        new THREE.MeshLambertMaterial({ color: SURFACE_COLOUR.tempo, emissive: "#19d9a4", emissiveIntensity: 0.55 }),
        count
      );
      const chevronGeo = new THREE.BufferGeometry();
      chevronGeo.setAttribute("position", new THREE.Float32BufferAttribute([
        -0.34, 0, -0.16, 0, 0, 0.2, 0, 0, 0.06,
        -0.34, 0, -0.16, 0, 0, 0.06, -0.34, 0, -0.3,
        0.34, 0, -0.16, 0, 0, 0.06, 0, 0, 0.2,
        0.34, 0, -0.16, 0.34, 0, -0.3, 0, 0, 0.06
      ], 3));
      chevronGeo.computeVertexNormals();
      this.chevrons = new THREE.InstancedMesh(chevronGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide }), count);
      // Leuchtstreifen links und rechts über den ganzen Abschnitt: so liest
      // sich die Reihe der Platten als EINE Boostspur.
      const rails = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.06, 0.025, segLen - 0.06),
        new THREE.MeshBasicMaterial({ color: "#8ff5d8" }),
        felder.tempo.length * 2
      );
      let k = 0;
      felder.tempo.forEach((entry, i) => {
        const x = laneX(entry.lane);
        for (let n = 0; n < perPad; n += 1) {
          const z = entry.z - segLen / 2 + spacing * (n + 0.5);
          setze(frame, k, x, FLOOR_Y + 0.011, z);
          setze(glow, k, x, FLOOR_Y + 0.012, z);
          setze(this.chevrons, k, x, FLOOR_Y + 0.026, z, 0.95, 1, 1.25);
          this.chevrons.setColorAt(k, new THREE.Color("#ffffff"));
          k += 1;
        }
        [-1, 1].forEach((side, j) => setze(rails, i * 2 + j, x + side * (LANE_WIDTH / 2 - 0.1), FLOOR_Y + 0.013, entry.z));
      });
      [frame, glow, this.chevrons, rails].forEach((mesh) => {
        // Flach im Belag wie eine Markierung: für die Prüfwerkzeuge kein Boden.
        mesh.userData.isFx = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.receiveShadow = mesh !== this.chevrons;
        scene.add(mesh);
      });
      this.boostGlow = glow.material;
      this.boostRails = rails.material;
      this.chevronsPerPad = perPad;
    }
    if (felder.sand.length) {
      // Die Pfütze: fünf ineinanderlaufende Flecken unterschiedlicher Grösse,
      // darauf dunklere Tiefen und nasse Glanzstellen, am Rand Steinchen.
      const flecken = 5;
      const mud = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(1, 1, 0.014, 20),
        new THREE.MeshLambertMaterial({ color: SURFACE_COLOUR.sand }),
        felder.sand.length * flecken
      );
      const deep = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(1, 1, 0.012, 16),
        new THREE.MeshLambertMaterial({ color: "#3f2512" }),
        felder.sand.length * 3
      );
      const wet = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(1, 1, 0.01, 12),
        new THREE.MeshLambertMaterial({ color: "#9a6a3e", emissive: "#3a2410", emissiveIntensity: 0.3 }),
        felder.sand.length * 2
      );
      const stones = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.1, 0.06, 0.09),
        new THREE.MeshLambertMaterial({ color: "#8d8a82" }),
        felder.sand.length * 4
      );
      const bubbles = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.06, 6, 4),
        new THREE.MeshLambertMaterial({ color: "#8a5a34" }),
        felder.sand.length * 4
      );
      [mud, deep, wet, bubbles, stones].forEach((mesh) => { mesh.userData.isFx = true; });
      const innen = LANE_WIDTH / 2 - 0.05;
      felder.sand.forEach((entry, i) => {
        const x0 = laneX(entry.lane);
        for (let n = 0; n < flecken; n += 1) {
          const r = 0.34 + frac(i * 5 + n * 1.7) * 0.18;
          const dx = clamp((frac(i * 7 + n * 2.3) - 0.5) * 0.3, -(innen - r), innen - r);
          const z = entry.z + (n / (flecken - 1) - 0.5) * segLen * 0.84;
          setze(mud, i * flecken + n, x0 + dx, FLOOR_Y + 0.008 + n * 0.0006, z, r, 1, r * (1.05 + frac(i * 3 + n) * 0.35));
        }
        for (let n = 0; n < 3; n += 1) {
          const r = 0.16 + frac(i * 11 + n) * 0.1;
          setze(deep, i * 3 + n, x0 + (frac(i * 13 + n) - 0.5) * 0.3, FLOOR_Y + 0.016, entry.z + (n - 1) * segLen * 0.3, r, 1, r * 1.3);
        }
        for (let n = 0; n < 2; n += 1) {
          setze(wet, i * 2 + n, x0 + (frac(i * 17 + n) - 0.5) * 0.4, FLOOR_Y + 0.018, entry.z + (n - 0.5) * segLen * 0.4, 0.09, 1, 0.16);
        }
        for (let n = 0; n < 4; n += 1) {
          const side = n % 2 ? 1 : -1;
          setze(stones, i * 4 + n, x0 + side * (innen - 0.08), FLOOR_Y + 0.03, entry.z + (frac(i * 19 + n) - 0.5) * segLen * 0.8, 1, 1, 1, frac(i + n) * 1.5);
        }
        for (let n = 0; n < 4; n += 1) {
          setze(bubbles, i * 4 + n, x0 + (frac(i * 5 + n) - 0.5) * 0.6, FLOOR_Y + 0.03, entry.z + (frac(i * 9 + n) - 0.5) * segLen * 0.8);
        }
      });
      [mud, deep, wet, stones, bubbles].forEach((mesh) => {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      });
    }

    // Tribünen auf beiden Seiten: Stufen mit bunten Zuschauerwürfeln. Sie
    // wandern mit wie die übrige Kulisse.
    this.stands = [];
    const crowdColors = ["#ff8b2e", "#8f6ae0", "#2ec4b6", "#f45b9d", "#8bc34a", "#5c9dff", "#ffd15c"];
    for (let i = 0; i < 8; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const stand = new THREE.Group();
      for (let step = 0; step < 3; step += 1) {
        const tier = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35 + step * 0.35, 5.6), new THREE.MeshLambertMaterial({ color: step % 2 ? "#e9eef5" : "#d4dde8" }));
        tier.position.set(side * step * 1.0, (0.35 + step * 0.35) / 2, 0);
        tier.receiveShadow = true;
        stand.add(tier);
        const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), new THREE.MeshLambertMaterial({ color: "#ffffff" }), 6);
        const place = new THREE.Object3D();
        for (let c = 0; c < 6; c += 1) {
          place.position.set(side * step * 1.0, 0.35 + step * 0.35 + 0.17, -2.4 + c * 0.95);
          place.updateMatrix();
          crowd.setMatrixAt(c, place.matrix);
          crowd.setColorAt(c, new THREE.Color(crowdColors[(i * 3 + step * 5 + c) % crowdColors.length]));
        }
        crowd.userData.baseY = 0.35 + step * 0.35 + 0.17;
        crowd.userData.side = side;
        crowd.userData.step = step;
        stand.add(crowd);
        stand.userData.crowds = (stand.userData.crowds || []).concat(crowd);
      }
      stand.position.set(side * (LANE_WIDTH * 2.1 + 1.0), FLOOR_Y - 0.06, 3 + Math.floor(i / 2) * 6.2);
      scene.add(stand);
      this.stands.push(stand);
    }

    // Wimpelketten über den Seitenrändern, nicht quer über die Bahn.
    this.bunting = [];
    const flagColors = ["#ff5c8a", "#12aaff", "#ffc400", "#33cf4d", "#9b7bff"];
    for (let i = 0; i < 12; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const group = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.2, 0.07), new THREE.MeshLambertMaterial({ color: "#ffffff" }));
      pole.position.y = 1.1;
      group.add(pole);
      for (let f = 0; f < 5; f += 1) {
        const flag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 3), new THREE.MeshLambertMaterial({ color: flagColors[(i + f) % flagColors.length] }));
        flag.rotation.x = Math.PI;
        flag.position.set(0, 1.95 - f * 0.02, 0.35 + f * 0.36);
        group.add(flag);
      }
      group.position.set(side * (LANE_WIDTH * 1.5 + 0.55), FLOOR_Y, 2 + Math.floor(i / 2) * 4);
      scene.add(group);
      this.bunting.push(group);
    }

    // Jubelnde Zuschauer vorn an der Bande.
    for (let i = 0; i < 8; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const fan = createKin(crowdColors[i % crowdColors.length], i);
      fan.scale.setScalar(FAN_SCALE);
      fan.position.set(side * (LANE_WIDTH * 2.2 + frac(i * 3.3) * 0.3), FAN_Y, 6 + i * (trackZ / 9));
      fan.rotation.y = -side * Math.PI / 2;
      scene.add(fan);
      this.spectatorParts.push({ object: fan, z: fan.position.z });
      const fanAnimator = new KinAnimator(fan);
      fanAnimator.groundY = FAN_Y;
      fanAnimator.set("cheer", { base: true });
      this.spectators.push(fanAnimator);
    }

    // Meterangaben auf der Bahn, alle zehn Meter — sie wandern mit.
    this.rungs = [];
    for (let i = 0; i < RUNG_POOL; i += 1) {
      const rung = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH * 3, 0.02, 0.1),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55 })
      );
      rung.position.set(0, FLOOR_Y + 0.012, (4 + i * 4) * SEGMENT);
      scene.add(rung);
      this.rungs.push(rung);
    }

    // Das Ziel: Karo-Linie und ein hoher Bogen mit Karo-Banner.
    const checker = document.createElement("canvas");
    checker.width = 128;
    checker.height = 32;
    const pen = checker.getContext("2d");
    for (let cx = 0; cx < 16; cx += 1) {
      for (let cy = 0; cy < 4; cy += 1) {
        pen.fillStyle = (cx + cy) % 2 ? "#111111" : "#ffffff";
        pen.fillRect(cx * 8, cy * 8, 8, 8);
      }
    }
    const checkerTex = new THREE.CanvasTexture(checker);
    checkerTex.colorSpace = THREE.SRGBColorSpace;
    checkerTex.magFilter = THREE.NearestFilter;
    const finish = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 3, 0.03, 0.5), new THREE.MeshLambertMaterial({ map: checkerTex }));
    finish.position.set(0, FLOOR_Y + 0.02, trackZ);
    scene.add(finish);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.4, 0.28), new THREE.MeshLambertMaterial({ color: "#ffc400" }));
      post.position.set(side * (LANE_WIDTH * 1.5 + 0.35), FLOOR_Y + 1.7, trackZ);
      post.castShadow = true;
      scene.add(post);
    });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 3 + 0.9, 0.5, 0.1), new THREE.MeshLambertMaterial({ map: checkerTex }));
    banner.position.set(0, FLOOR_Y + 3.2, trackZ);
    scene.add(banner);

    // Die Startlinie: weiss über alle drei Bahnen, davor je Bahn ein
    // Startblock. Vorher begann das Rennen irgendwo auf der Bahn.
    const startLine = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 3, 0.02, 0.14), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
    startLine.position.set(0, FLOOR_Y + 0.013, 0.35);
    scene.add(startLine);
    for (let lane = 0; lane < 3; lane += 1) {
      [-1, 1].forEach((side) => {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.22), new THREE.MeshLambertMaterial({ color: "#3a4a58" }));
        block.position.set(laneX(lane) + side * 0.2, FLOOR_Y + 0.05, -0.55);
        block.rotation.x = -0.35;
        block.castShadow = true;
        scene.add(block);
      });
    }

    // Hürden aus dem geteilten Kurs; weit entfernte werden ausgeblendet.
    this.courseParts = [];
    this.hurdles = [];
    const partOf = (object, z) => { this.courseParts.push({ object, z }); return object; };
    (arcade.segments || []).forEach((segment) => {
      if (segment.hurdle === null || segment.hurdle === undefined) return;
      const z = segment.hurdleAt * SEGMENT;
      const hurdle = this.makeHurdle(laneX(segment.hurdle), z);
      this.hurdles.push({ group: hurdle, x: laneX(segment.hurdle), z, hitAt: -Infinity });
      scene.add(partOf(hurdle, z));
    });

    // Heuballen: zu hoch zum Springen, man muss drumherum.
    this.walls = [];
    (arcade.segments || []).forEach((segment) => {
      if (segment.wall === null || segment.wall === undefined) return;
      const z = segment.wallAt * SEGMENT;
      const wall = this.makeBales(laneX(segment.wall), z, segment.index);
      this.walls.push({ ...wall, x: laneX(segment.wall), z, hitAt: -Infinity });
      scene.add(partOf(wall.group, z));
    });

    [[-6, 4, 10, 5], [6, 5, 24, 6], [-5, 5, 40, 7], [7, 6, 58, 8], [-7, 5, 74, 9]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Side scenery whipping past sells the speed — blocky trees, bushes, rocks
    // marching down both edges of the track, with a gentle idle sway.
    // Auch die Randbepflanzung ist ein POOL, kein ausgelegter Wald.
    //
    // Vorher stand über die ganzen 150 Streckeneinheiten alle 2.6 Meter auf
    // jeder Seite ein Objekt — rund 113 Gruppen mit je zwei bis drei Meshes.
    // Gemessen kam Zielgerade damit auf 527 Zeichenaufrufe und 832 Objekte, das
    // Fünf- bis Zehnfache jeder anderen Szene, und man sah davon nie mehr als
    // ein Zwanzigstel gleichzeitig. Auf einem Mittelklasse-Handy ist das der
    // Unterschied zwischen 60 und 25 Bildern — bei einem Rennen merkt man das
    // sofort.
    const edge = LANE_WIDTH * 2.4;
    for (let i = 0; i < PROP_POOL; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = 3 + Math.floor(i / 2) * PROP_SPACING;
      const seed = z * 7.3 + (side + 1);
      const jitter = (frac(seed) - 0.5) * 0.9;
      const prop = this.makeSideProp(seed);
      prop.position.set(side * (edge + frac(seed * 1.7) * 1.6) + jitter, 0, z * SEGMENT + jitter);
      prop.userData.phase = seed;
      prop.userData.baseX = prop.position.x;
      scene.add(prop);
      this.scenery.push(prop);
    }

    // Foreground speed streaks that rush toward the camera and recycle.
    const streakMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.32 });
    this.streakMat = streakMat;
    // Die Leuchtspur hinter der eigenen Figur auf dem Boost: flache Streifen,
    // die hinter ihr liegen bleiben und verblassen.
    // Ein Zeichenaufruf für alle Streifen: additiv gemischt, verblassen sie,
    // indem ihre Farbe dunkler wird.
    this.trailMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.012, 0.5),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      TRAIL_POOL
    );
    this.trailMesh.userData.isFx = true;
    this.trailMesh.frustumCulled = false;
    for (let i = 0; i < TRAIL_POOL; i += 1) {
      this.trail.push({ age: 1, life: 0.38, x: 0, z: 0 });
      this.trailMesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    scene.add(this.trailMesh);
    for (let i = 0; i < 22; i += 1) {
      const streak = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.9), streakMat);
      streak.position.set((Math.random() - 0.5) * 7, 0.3 + Math.random() * 3.2, Math.random() * 16);
      streak.userData = { speed: 14 + Math.random() * 10 };
      scene.add(streak);
      this.streaks.push(streak);
    }

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const kin = this.addKin(player, index, { x: laneX(1), ground: FLOOR_Y, z: 0, facing: 0 });
      // Sternchen über dem Kopf, wenn man benommen ist.
      const dizzy = new THREE.Group();
      for (let s = 0; s < 3; s += 1) {
        const star = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.05), new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ffd15c", emissiveIntensity: 0.7 }));
        const angle = (s / 3) * Math.PI * 2;
        star.position.set(Math.cos(angle) * 0.32, 0, Math.sin(angle) * 0.32);
        star.rotation.z = Math.PI / 4;
        dizzy.add(star);
      }
      dizzy.position.y = 0.62;
      dizzy.visible = false;
      kin.add(dizzy);
      kin.userData.dizzy = dizzy;
    });
  }

  recycleScenery(focusZ) {
    const behind = focusZ - 6 * SEGMENT;
    const rungBand = RUNG_POOL * 4 * SEGMENT;
    this.rungs?.forEach((rung) => {
      while (rung.position.z < behind) rung.position.z += rungBand;
      while (rung.position.z > behind + rungBand) rung.position.z -= rungBand;
    });
    const standBand = 4 * 6.2;
    this.stands?.forEach((stand) => {
      while (stand.position.z < behind - 3) stand.position.z += standBand;
      while (stand.position.z > behind - 3 + standBand) stand.position.z -= standBand;
    });
    const flagBand = 6 * 4;
    this.bunting?.forEach((flag) => {
      while (flag.position.z < behind) flag.position.z += flagBand;
      while (flag.position.z > behind + flagBand) flag.position.z -= flagBand;
    });
    const propBand = (PROP_POOL / 2) * PROP_SPACING * SEGMENT;
    this.scenery.forEach((prop) => {
      while (prop.position.z < behind) prop.position.z += propBand;
      while (prop.position.z > behind + propBand) prop.position.z -= propBand;
    });
  }

  makeSideProp(seed) {
    const group = new THREE.Group();
    const kind = Math.floor(frac(seed * 3.1) * 3);
    if (kind === 0) {
      // Blocky tree.
      const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), new THREE.MeshLambertMaterial({ color: "#8a5a34" }));
      trunk.position.y = 0.35;
      trunk.castShadow = true;
      group.add(trunk);
      const leaves = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshLambertMaterial({ color: frac(seed) > 0.5 ? "#68a55f" : "#84b378" }));
      leaves.position.y = 1.05;
      leaves.castShadow = true;
      group.add(leaves);
      group.userData.sway = 0.05;
    } else if (kind === 1) {
      // Round bush cluster.
      const c = frac(seed * 2.2) > 0.5 ? "#7fd0b0" : "#9be0a8";
      [[0, 0.3, 0.6], [0.3, 0.24, 0.44], [-0.28, 0.22, 0.4]].forEach(([x, y, s]) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color: c }));
        b.position.set(x, y, 0);
        b.castShadow = true;
        group.add(b);
      });
      group.userData.sway = 0.07;
    } else {
      // Candy rock + flower.
      const rock = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.42, 0.55), new THREE.MeshLambertMaterial({ color: "#c9b6d8" }));
      rock.position.y = 0.21;
      rock.rotation.y = frac(seed) * 0.8;
      rock.castShadow = true;
      group.add(rock);
      const flower = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: "#ff8aa0", emissive: "#a83c5a", emissiveIntensity: 0.2 }));
      flower.position.set(0.24, 0.5, 0.1);
      group.add(flower);
      group.userData.sway = 0.02;
    }
    return group;
  }

  // Ein Stapel Heuballen, der die Bahn füllt: unten zwei, in der Mitte
  // zwei, oben einer. Mit gut 1,3 m zu hoch für jeden Sprung — das sieht man.
  makeBales(x, z, seed) {
    const group = new THREE.Group();
    this.baleMat ||= new THREE.MeshLambertMaterial({ vertexColors: true });
    const bales = [];
    const w = (LANE_WIDTH - 0.12) / 2;
    [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1], [0, 2]].forEach(([col, row], i) => {
      // Ein Ballen ist EIN Mesh: Körper, zwei Schnüre und ein Büschel Halme
      // in einer Geometrie mit Farben je Teil — fünf Zeichenaufrufe je
      // Stapel statt zwanzig.
      const teile = [
        { size: [w - 0.03, 0.42, 0.58], at: [0, 0, 0], color: (i + seed) % 3 ? "#e4c35c" : "#c9a444" },
        { size: [0.035, 0.425, 0.585], at: [-w * 0.22, 0, 0], color: "#8b5e2b" },
        { size: [0.035, 0.425, 0.585], at: [w * 0.22, 0, 0], color: "#8b5e2b" },
        { size: [0.12, 0.05, 0.08], at: [(frac(seed + i) - 0.5) * w * 0.6, 0.23, (frac(seed * 3 + i) - 0.5) * 0.3], color: "#f0d578" }
      ];
      const bale = new THREE.Mesh(mergeBoxes(teile), this.baleMat);
      bale.castShadow = true;
      bale.receiveShadow = true;
      const home = new THREE.Vector3(col * w, FLOOR_Y + 0.21 + row * 0.42, (row === 1 ? 0.03 : 0) + (frac(seed + i * 5) - 0.5) * 0.06);
      bale.position.copy(home);
      bale.rotation.y = (frac(seed * 2 + i) - 0.5) * 0.12;
      group.add(bale);
      bales.push({ mesh: bale, home, spin: bale.rotation.y, dir: col === 0 ? (frac(seed + i) < 0.5 ? -1 : 1) : Math.sign(col) });
    });
    group.position.set(x, 0, z);
    return { group, bales };
  }

  // Wer in den Stapel rennt, wirft ihn um: die Ballen fliegen zur Seite und
  // nach vorn, kullern aus, und nach gut einer Sekunde steht der Stapel
  // wieder. Sonst liefe die Figur beim Stolpern mitten durch das Stroh.
  crashBales(at, now) {
    let best = null;
    this.walls?.forEach((wall) => {
      const dz = Math.abs(wall.z - at.z);
      if (Math.abs(wall.x - at.x) > LANE_WIDTH * 0.6 || dz > 1.6) return;
      if (!best || dz < Math.abs(best.z - at.z)) best = wall;
    });
    if (best) best.hitAt = now;
    return best;
  }

  tumbleBales(now) {
    this.walls?.forEach((wall) => {
      const t = (now - wall.hitAt) / 1000;
      const aktiv = t >= 0 && t <= 1.5;
      wall.group.userData.isFx = aktiv;
      if (!aktiv) {
        if (wall.moved) {
          wall.moved = false;
          wall.bales.forEach((bale) => {
            bale.mesh.position.copy(bale.home);
            bale.mesh.rotation.set(0, bale.spin, 0);
            bale.mesh.scale.setScalar(1);
          });
        }
        return;
      }
      wall.moved = true;
      // Wegfliegen und aufkommen, liegen bleiben, verschwinden — und dann
      // steht der Stapel mit einem kleinen Plopp wieder da.
      const flug = Math.min(t, 0.7);
      wall.bales.forEach((bale, i) => {
        if (t >= 1.3) {
          const u = Math.min(1, (t - 1.3) / 0.2);
          bale.mesh.position.copy(bale.home);
          bale.mesh.rotation.set(0, bale.spin, 0);
          bale.mesh.scale.setScalar(Math.max(0.01, u * (1 + Math.sin(u * Math.PI) * 0.15)));
          return;
        }
        const hoch = bale.home.y + (1.6 + i * 0.25) * flug - 4.2 * flug * flug;
        bale.mesh.position.set(
          bale.home.x + bale.dir * (0.9 + i * 0.12) * flug,
          Math.max(FLOOR_Y + 0.21, hoch),
          bale.home.z + (0.8 + (i % 2) * 0.4) * flug
        );
        bale.mesh.rotation.set(bale.dir * flug * 2.2, bale.spin, bale.dir * flug * 1.4);
        bale.mesh.scale.setScalar(t > 1.1 ? Math.max(0.01, 1 - (t - 1.1) / 0.2) : 1);
      });
    });
  }

  // Wer in eine Hürde rennt, reisst sie um: sie kippt nach vorn und federt
  // wieder hoch. Vorher blieb sie stehen, und die Figur lief mitten durch
  // die Latte hindurch.
  knockHurdle(at, now) {
    let best = null;
    this.hurdles.forEach((hurdle) => {
      const dz = Math.abs(hurdle.z - at.z);
      if (Math.abs(hurdle.x - at.x) > LANE_WIDTH * 0.6 || dz > 1.4) return;
      if (!best || dz < Math.abs(best.z - at.z)) best = hurdle;
    });
    if (best) best.hitAt = now;
  }

  tipHurdles(now) {
    this.hurdles?.forEach((hurdle) => {
      const t = now - hurdle.hitAt;
      // Eine Hürde, die gerade umgerissen wird, fällt absichtlich durch den
      // Läufer — für die Prüfskripte ist sie in der Zeit kein Boden.
      hurdle.group.userData.isFx = t >= 0 && t <= 1300;
      if (t < 0 || t > 1300) {
        if (hurdle.group.rotation.x !== 0) hurdle.group.rotation.x = 0;
        return;
      }
      // Schnell um, kurz liegen, dann mit einem Nachwippen zurück.
      let tilt;
      if (t < 160) tilt = (t / 160) * 1.4;
      else if (t < 650) tilt = 1.4;
      else {
        const u = (t - 650) / 650;
        tilt = 1.4 * (1 - u) + Math.sin(u * Math.PI * 3) * 0.12 * (1 - u);
      }
      hurdle.group.rotation.x = tilt;
    });
  }

  // Leichtathletik-Hürde: zwei dünne Füsse, oben eine rot-weiss gestreifte
  // Latte. Leicht und klar lesbar statt eines Klotzes.
  makeHurdle(x, z) {
    // Alle Teile in EINER Geometrie: bei der dichteren Strecke stehen oft
    // fünf, sechs Hürden im Bild, und neun Meshes je Hürde kosteten jeweils
    // neun Zeichenaufrufe, mit Schatten achtzehn.
    const teile = [];
    [-1, 1].forEach((side) => {
      teile.push({ size: [0.06, 0.62, 0.06], at: [side * (LANE_WIDTH / 2 - 0.14), FLOOR_Y + 0.31, 0], color: "#ffffff" });
      teile.push({ size: [0.08, 0.05, 0.42], at: [side * (LANE_WIDTH / 2 - 0.14), FLOOR_Y + 0.03, -0.14], color: "#ffffff" });
    });
    const stripes = 5;
    const width = LANE_WIDTH - 0.2;
    for (let i = 0; i < stripes; i += 1) {
      teile.push({ size: [width / stripes, 0.14, 0.06], at: [-width / 2 + (i + 0.5) * (width / stripes), FLOOR_Y + 0.6, 0], color: i % 2 ? "#ffffff" : "#ff3b55" });
    }
    this.hurdleMat ||= new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(mergeBoxes(teile), this.hurdleMat);
    mesh.castShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    group.position.set(x, 0, z);
    return group;
  }

  shot() {
    return {
      look: [0, 0.7, 2.4],
      frame: { w: 4.6, h: 3.4 },
      yaw: Math.PI - 0.12,
      pitch: 0.5,
      fov: SHOT_FOV,
      ease: 0.14,
      intro: { yaw: -0.8, pitch: 0.2, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="runner-lane-controls">
        <p class="runner-swipe-hint" data-swipe-hint>◀ Wischen ▶ · Tippen = Springen</p>
      </div>`;
    this.swipeHint = this.controls.querySelector("[data-swipe-hint]");
    // Wischen wirkt, sobald der Finger weit genug gezogen hat — nicht erst
    // beim Loslassen. Vorher kam der Spurwechsel eine Wischlänge zu spät, und
    // wer knapp vor einer Hürde wechselte, lief noch hinein. Gewischt werden
    // darf auch über der Leiste unten, wo der Daumen ohnehin liegt.
    const beginne = (event) => {
      this.swipe = { x: event.clientX, y: event.clientY, at: performance.now(), done: false };
    };
    this.on(this.webglCanvas, "pointerdown", beginne);
    this.on(this.controls, "pointerdown", beginne);
    this.on(window, "pointermove", (event) => {
      const swipe = this.swipe;
      if (!swipe || swipe.done) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (Math.abs(dx) >= 28 && Math.abs(dx) > Math.abs(dy)) {
        swipe.done = true;
        this.sendLane(dx > 0 ? 1 : -1);
      } else if (dy <= -34 && -dy > Math.abs(dx)) {
        // Nach oben wischen springt ebenfalls — wer es so erwartet, soll es haben.
        swipe.done = true;
        this.springen();
      }
    });
    this.on(window, "pointerup", (event) => this.resolveSwipe(event));
    this.on(window, "pointercancel", () => { this.swipe = null; });
    const interrupt = () => { this.swipe = null; };
    this.on(window, "blur", interrupt);
    this.on(document, "visibilitychange", () => { if (document.hidden) interrupt(); });
  }

  // Die Laufbahn ist eben. Hürden und umfliegende Heuballen sind keine
  // Standflächen; Prüfer können diese bekannte Höhe statt einer Latte nutzen.
  groundHeightAt(x) { return Math.abs(x) <= LANE_WIDTH * 1.5 ? FLOOR_Y : MEADOW_TOP_Y; }

  afterAnimate() {
    this.kins.forEach((kin) => {
      kin.updateMatrixWorld(true);
      let sole = Infinity;
      kin.userData.legs.forEach((leg) => { sole = Math.min(sole, footBounds.setFromObject(leg).min.y); });
      // Kurvenneigung und Sprintpose kippen auch die Schuhe. Nur den Teil
      // unter der Laufbahn anheben; der gewollte Sprung bleibt unverändert.
      if (Number.isFinite(sole) && sole < FLOOR_Y) kin.position.y += FLOOR_Y - sole;
    });
  }

  resolveSwipe(event) {
    const swipe = this.swipe;
    this.swipe = null;
    if (!swipe || swipe.done) return;
    // Ein einfacher Tipp springt. Er löste vorher einen Angriff aus — genau
    // das, was man beim hastigen Tippen vor einer Hürde nicht wollte.
    if (Math.abs(event.clientX - swipe.x) < 26 && Math.abs(event.clientY - swipe.y) < 26) this.springen();
  }

  // Springen, wenn es geht. In der Luft oder direkt nach der Landung verwirft
  // der Server den Tipp; dann gibt es auch keinen Sprung-Ton, der etwas
  // verspricht, das nicht passiert.
  springen() {
    const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.finishedAt) return;
    if (this.now() < (own.jumpUntil || 0) + JUMP_REST_MS) return;
    this.feedback?.sound("pop");
    this.feedback?.vibrate(8);
    this.sendInput({ action: "jump" }).catch(() => {});
  }

  sendLane(dir) {
    const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt) return;
    // Schon ganz aussen: kein Wechsel, also auch kein Wechsel-Ton.
    if (own && (own.lane + dir < 0 || own.lane + dir > 2)) return;
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "lane", dir }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    this.spectators.forEach((fan) => fan.update(now));
    this.tipHurdles(now);
    this.tumbleBales(now);
    const ziele = this.zielpunkte(arcade, players);
    const laeufer = [];
    let ownKin = null;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const ziel = ziele.get(player.id);
      const targetX = ziel.x;
      const targetZ = ziel.z;
      const prevX = kin.position.x;
      kin.position.x += (targetX - kin.position.x) * frameLerp(0.25, dt);
      kin.position.z += (targetZ - kin.position.z) * frameLerp(0.4, dt);
      if (ziel.lane !== null) laeufer.push({ kin, lane: ziel.lane });
      const laneVel = kin.position.x - prevX;
      kin.rotation.z += (-laneVel * 6 - kin.rotation.z) * frameLerp(0.2, dt);
      const finished = Boolean(entry.finishedAt);
      const stumbling = now < (entry.stumbleUntil || 0);
      const jumping = now < (entry.jumpUntil || 0);

      if (!finished && entry.surface === "sand" && Math.random() < frameChance(0.6, dt)) {
        this.burst(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.08, kin.position.z - 0.1), ["#6b4424", "#8a5a34"], { count: 2, speed: 1.1, up: 1.4, size: 0.07, life: 0.45, gravity: 5 });
      }
      if (!finished && entry.surface === "tempo" && Math.random() < frameChance(0.8, dt)) {
        this.burst(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.3, kin.position.z - 0.3), ["#8ff5d8", "#ffffff"], { count: 1, speed: 0.4, up: 0.3, size: 0.06, life: 0.35, gravity: 0 });
      }
      if (!finished && Math.random() < frameChance(0.14, dt)) {
        this.burst(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.05, kin.position.z - 0.2), ["#e8f0d8", "#ffffff"], { count: 1, speed: 0.5, up: 0.6, size: 0.05, life: 0.4, gravity: 1.5 });
      }
      if ((entry.stumbles || 0) > (this.lastStumbles.get(player.id) || 0)) {
        this.lastStumbles.set(player.id, entry.stumbles);
        animator.trigger("tumble");
        // Heuballen oder Hürde? Der Ballen-Zähler sagt es.
        const ballen = (entry.crashes || 0) > (this.lastCrash.get(player.id) || 0);
        this.lastCrash.set(player.id, entry.crashes || 0);
        if (ballen) {
          this.crashBales(kin.position, now);
          this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.6, 0.3)), ["#e4c35c", "#f3dc8a", "#c9a444"], { count: 22, speed: 2.6, up: 2.4, size: 0.07, life: 0.8, gravity: 5 });
        } else {
          this.knockHurdle(kin.position, now);
        }
        this.burst(kin.position.clone(), ["#ffffff", "#ef6673", "#ffd15c"], { count: 12, speed: 2.0, up: 2.2, size: 0.08, life: 0.6 });
        this.bursts.ring(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.07, kin.position.z), "#ef6673", { radius: 1.3, life: 0.45, y: FLOOR_Y + 0.07 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1, 0)), "RUMMS!", { color: "#ef6673", size: 0.36, life: 0.8 });
        if (isOwn) {
          this.rig.shake(1);
          this.feedback?.sound("collision");
          this.feedback?.vibrate([20, 18, 30]);
        }
      }
      if (jumping && (entry.jumpUntil || 0) !== this.lastJump.get(player.id)) {
        this.lastJump.set(player.id, entry.jumpUntil);
        animator.trigger("jump");
      }
      kin.userData.dizzy.visible = stumbling;
      kin.userData.dizzy.rotation.y = now / 200;
      // Sprungbogen: schnell hoch, oben kurz schweben, schnell wieder runter.
      // Mit reinem Sinus war der Bogen an beiden Enden flach — wer knapp vor
      // oder nach der Hürde absprang, dem ging die Stange sichtbar durch die
      // Beine, obwohl der Server den Sprung als geschafft wertete. Dazu gilt:
      // wer springt und gerade über einer stehenden Hürde ist, ist mindestens
      // so hoch, dass die Füsse über der Stange bleiben.
      let lift = 0;
      if (jumping) {
        // Ein neues Server-Update kann der abgeglichenen Client-Uhr leicht
        // voraus sein. Außerhalb [0, 1] würde sin negativ und die gebrochene
        // Potenz NaN — damit verschwindet der Läufer bis zum nächsten Bild.
        const phase = Math.min(1, Math.max(0, (entry.jumpUntil - now) / 650));
        lift = Math.pow(Math.sin(phase * Math.PI), 0.6) * 1.25;
        // Auch beim Bahnwechsel: wer zwischen zwei Bahnen über eine Hürde
        // springt, streift sonst ihren Seitenpfosten.
        const hurdle = this.hurdles?.find((h) => Math.abs(h.x - kin.position.x) < LANE_WIDTH * 0.8
          && Math.abs(h.z - kin.position.z) < HURDLE_CLEAR_REACH && h.group.rotation.x === 0);
        if (hurdle) {
          const near = 1 - Math.abs(hurdle.z - kin.position.z) / HURDLE_CLEAR_REACH;
          lift = Math.max(lift, HURDLE_CLEAR * Math.min(1, near * 1.8));
        }
      }
      animator.groundY = standOn(FLOOR_Y) + lift;

      // Die letzten 25 Meter: einmal kurz ansagen, dass es jetzt zählt.
      if (isOwn && !finished && !this.endspurt && entry.progress >= (arcade.trackLength || 150) - 25) {
        this.endspurt = true;
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.35, 0)), "ENDSPURT!", { color: "#ffe36b", size: 0.4, life: 0.9 });
        this.feedback?.sound("whoosh");
        this.feedback?.vibrate(10);
      }
      if (finished && !this.lastFinished.get(player.id)) {
        this.lastFinished.set(player.id, true);
        animator.trigger("celebrate");
        this.burst(kin.position.clone(), [player.color, "#ffffff", "#ffd15c"], { count: 24, speed: 2.8, up: 3.0, size: 0.1, life: 0.95, drag: 1.2 });
        const platz = ziel.platz;
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), isOwn && platz ? `${platz}. PLATZ! 🏁` : "ZIEL! 🏁", { color: "#ffe36b", size: isOwn ? 0.5 : 0.4, life: isOwn ? 1.6 : 1.2, rise: 1 });
        if (isOwn) {
          this.feedback?.sound("perfect");
          this.feedback?.vibrate([12, 16, 24]);
        }
      }
      if (isOwn) ownKin = kin;
      if (finale) return;
      if (finished) {
        kin.rotation.y += Math.atan2(Math.sin(Math.PI - kin.rotation.y), Math.cos(Math.PI - kin.rotation.y)) * frameLerp(0.08, dt);
        animator.set("happy");
        return;
      }
      kin.rotation.y = 0;
      // Auf dem Boost legt sich die Figur nach vorn in den Wind.
      const vorlage = !stumbling && entry.surface === "tempo" ? 0.16 : 0;
      kin.rotation.x += (vorlage - kin.rotation.x) * frameLerp(0.15, dt);
      if (stumbling) {
        animator.set("run");
        animator.rate = 0.55;
        animator.expression("dizzy", 150);
      } else if (entry.surface === "tempo") {
        // Auf der Tempobahn sieht man den Schub: tiefer, weiter ausgreifend.
        animator.set("sprint");
        animator.rate = 0.9;
        animator.expression("effort", 150);
      } else {
        animator.set("run");
        animator.rate = Math.max(0.6, Math.min(1.8, (entry.speed || 5.2) / 5.2));
      }
      if (entry.surface === "sand") animator.expression("effort", 150);
    });

    this.entwirren(laeufer);

    const own = arcade.players[controlledId];
    const belag = own?.surface || "normal";
    if (belag !== this.letzterBelag) {
      const vorher = this.letzterBelag;
      this.letzterBelag = belag;
      if (ownKin && vorher !== undefined && !own?.finishedAt && belag === "sand") {
        this.pop(ownKin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "MATSCH", { color: "#c99a5e", size: 0.3, life: 0.7 });
        this.feedback?.sound("clack");
      }
    }

    // --- Boost, der sich nach Boost anfühlt ---------------------------------
    // Die Tempobahn macht nur etwas schneller, und weil die Kamera mitläuft,
    // sah man davon kaum etwas. Darum mehrere Tricks zugleich:
    //  * das Sichtfeld weitet sich (die Kamera rückt dafür näher, die Figur
    //    bleibt gleich gross): die Bahn rast stärker auf einen zu;
    //  * beim Anschub bleibt die Kamera kurz zurück, die Figur schiesst davon;
    //  * Fahrtwindlinien am Bildrand, mehr und längere Streifen in der Luft;
    //  * eine Leuchtspur hinter der Figur, die sich nach vorn legt;
    //  * der Anschub selbst: Zischen, ein kurzer Ruck, ein Ring am Boden.
    const ruhig = prefersReducedMotion();
    const aufBoost = Boolean(ownKin && own && !own.finishedAt && !finale && belag === "tempo" && now >= (own.stumbleUntil || 0));
    this.boost += ((aufBoost ? 1 : 0) - this.boost) * frameLerp(aufBoost ? 0.14 : 0.07, dt);
    this.kick = aufBoost ? Math.max(0, 1 - (now - (own.kickAt || 0)) / KICK_MS) : 0;
    const kicks = own?.kicks || 0;
    if (ownKin && this.lastKicks !== undefined && kicks > this.lastKicks && aufBoost) {
      const fuss = new THREE.Vector3(ownKin.position.x, FLOOR_Y + 0.05, ownKin.position.z);
      this.bursts.ring(fuss, "#8ff5d8", { radius: 1.4, life: 0.4, y: FLOOR_Y + 0.05 });
      this.burst(fuss.clone().add(new THREE.Vector3(0, 0.2, -0.3)), ["#8ff5d8", "#ffffff"], { count: 14, speed: 2.4, up: 0.8, size: 0.06, life: 0.4, gravity: 1 });
      this.pop(ownKin.position.clone().add(new THREE.Vector3(0, 1.25, 0)), "BOOST!", { color: "#8ff5d8", size: 0.42, life: 0.7 });
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate([8, 12, 16]);
      this.rig?.shake(0.28);
    }
    this.lastKicks = kicks;
    if (this.rig?.base) this.rig.base.fov = SHOT_FOV + (ruhig ? 0 : this.boost * 9 + this.kick * 6);
    // Leuchtspur: alle 45 ms ein Streifen unter den Füssen, der liegen bleibt.
    if (aufBoost && now - this.trailAt > 45) {
      this.trailAt = now;
      const slot = this.trail.find((t) => t.age >= t.life) || this.trail[0];
      slot.age = 0;
      slot.x = ownKin.position.x;
      slot.z = ownKin.position.z - 0.2;
    }
    if (this.trailMesh) {
      const halt = new THREE.Object3D();
      this.trail.forEach((t, i) => {
        t.age = Math.min(t.life, t.age + dt);
        const u = t.age / t.life;
        halt.position.set(t.x, FLOOR_Y + 0.03, t.z);
        halt.scale.set(Math.max(0.001, 1 - u * 0.7), 1, 1 + u * 0.6);
        halt.updateMatrix();
        this.trailMesh.setMatrixAt(i, halt.matrix);
        this.trailMesh.setColorAt(i, _trail.setRGB(0.56, 0.96, 0.85).multiplyScalar((1 - u) * 0.8));
      });
      this.trailMesh.instanceMatrix.needsUpdate = true;
      this.trailMesh.instanceColor.needsUpdate = true;
    }
    // Die Boostplatten leuchten stärker, wenn man selbst darauf ist.
    if (this.boostGlow) this.boostGlow.emissiveIntensity = 0.55 + this.boost * 0.35 + Math.sin(now / 90) * 0.08;

    this.scenery.forEach((prop) => {
      prop.rotation.z = Math.sin(now / 900 + prop.userData.phase) * prop.userData.sway;
    });
    // Boostpfeile leuchten nacheinander auf und scheinen nach vorn zu laufen.
    if (this.chevrons) {
      const per = this.chevronsPerPad || 4;
      const beat = Math.floor(now / 110) % per;
      for (let i = 0; i < this.chevrons.count; i += 1) {
        const lit = i % per === beat;
        this.chevrons.setColorAt(i, lit ? _white : _mint);
      }
      this.chevrons.instanceColor.needsUpdate = true;
    }
    // Die Tribünen hüpfen.
    this.stands?.forEach((stand, i) => {
      stand.userData.crowds.forEach((crowd, c) => {
        crowd.position.y = Math.max(0, Math.sin(now / 160 + i * 1.3 + c)) * 0.08;
      });
    });
    const focusZ = ownKin ? ownKin.position.z : 0;
    const focusX = ownKin ? ownKin.position.x : 0;
    this.focus = { x: focusX, z: focusZ };
    this.recycleScenery(focusZ);
    const cull = (part, back, front) => {
      const ahead = part.z - focusZ;
      part.object.visible = ahead > back && ahead < front;
    };
    this.courseParts?.forEach((part) => cull(part, -4 * SEGMENT, 24 * SEGMENT));
    this.spectatorParts?.forEach((part) => cull(part, -6 * SEGMENT, 26 * SEGMENT));
    // Die Fahrtstreifen laufen mit dem Belag: auf der Tempobahn schneller,
    // länger und deutlicher, im Matsch langsamer.
    const streakSpeed = own?.surface === "sand" ? 0.7 : 1 + this.boost * 1.4 + this.kick * 0.8;
    if (this.streakMat) this.streakMat.opacity = 0.32 + this.boost * 0.4;
    this.streaks.forEach((streak) => {
      streak.scale.z = 1 + this.boost * 2.2;
      streak.position.z -= streak.userData.speed * streakSpeed * dt;
      if (streak.position.z < focusZ - 3) {
        streak.position.z = focusZ + 12 + Math.random() * 6;
        streak.position.x = focusX + (Math.random() - 0.5) * 7;
        streak.position.y = 0.3 + Math.random() * 3.2;
      }
    });
  }

  // Wo jede Figur hinläuft: Mitte ihrer Bahn auf ihrem Fortschritt, im Ziel
  // nebeneinander hinter der Linie in der Reihenfolge des Einlaufs.
  zielpunkte(arcade, players) {
    const ziele = new Map();
    const einlauf = players
      .map((player, index) => ({ id: player.id, index, entry: arcade.players[player.id] }))
      .filter((r) => r.entry?.finishedAt)
      .sort((a, b) => (a.entry.finishMs - b.entry.finishMs) || (a.index - b.index));
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const platz = einlauf.findIndex((r) => r.id === player.id);
      if (platz >= 0) {
        ziele.set(player.id, { x: (platz - 1.5) * 0.78, z: (this.trackZ || entry.progress * SEGMENT) + 1.1, lane: null, index, platz: platz + 1 });
      } else {
        ziele.set(player.id, { x: laneX(entry.lane), z: entry.progress * SEGMENT, lane: entry.lane, index, platz: 0 });
      }
    });
    return ziele;
  }

  // Zwei Läufer stecken nie ineinander. Vorher bekam, wer mit anderen in einer
  // Bahn lief, einen festen Versatz von ±0.24 — liefen drei oder vier in
  // einer Bahn, landeten je zwei auf demselben Fleck und steckten ganz
  // ineinander, am Start sogar alle. Jetzt rücken zwei Nachbarn innerhalb der
  // Bahn zur Seite; ist dort kein Platz mehr, weichen sie in der Tiefe
  // auseinander. Gerechnet wird auf den Figuren, wie sie gerade stehen, nicht
  // auf ihren Zielpunkten: sonst tauschten zwei gleich schnelle bei jedem
  // Führungswechsel die Plätze und liefen dabei durcheinander hindurch. Nur
  // fürs Bild — der Fortschritt bleibt der des Servers.
  entwirren(laeufer) {
    const inBahn = (x, lane, vorher) => clamp(
      x,
      Math.min(vorher, laneX(lane) - BAHN_SPIEL),
      Math.max(vorher, laneX(lane) + BAHN_SPIEL)
    );
    for (let runde = 0; runde < 4; runde += 1) {
      let eng = false;
      for (let i = 0; i < laeufer.length; i += 1) {
        for (let j = i + 1; j < laeufer.length; j += 1) {
          const a = laeufer[i].kin.position;
          const b = laeufer[j].kin.position;
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          if (Math.abs(dx) >= KIN_BREIT - 1e-3 || Math.abs(dz) >= KIN_TIEF - 1e-3) continue;
          eng = true;
          const seite = Math.abs(dx) > 1e-4 ? Math.sign(dx) : 1;
          const fehlt = (KIN_BREIT - Math.abs(dx)) / 2;
          a.x = inBahn(a.x - seite * fehlt, laeufer[i].lane, a.x);
          b.x = inBahn(b.x + seite * fehlt, laeufer[j].lane, b.x);
          if (Math.abs(b.x - a.x) >= KIN_BREIT - 1e-3) continue;
          // Seitlich ist kein Platz mehr: der Hintere etwas zurück, der
          // Vordere etwas vor.
          const tiefe = Math.abs(dz) > 1e-4 ? Math.sign(dz) : 1;
          const fehltZ = (KIN_TIEF - Math.abs(dz)) / 2;
          a.z -= tiefe * fehltZ;
          b.z += tiefe * fehltZ;
        }
      }
      if (!eng) break;
    }
  }

  // Mitlaufen: die eigene Figur und wer in ihrer Nähe läuft.
  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    if (!own) return [...this.kins.values()];
    return [...this.kins.values()].filter((kin) => Math.abs(kin.position.z - own.position.z) < 2.2);
  }

  rigOptions(f) {
    // Im Finale auf die Ziellinie, nicht zurück zum Start.
    if (f.finale) return { look: [0, 0.9, (this.trackZ || 0) - 1.2], frame: { w: 5, h: 3.4 } };
    if (!this.focus) return {};
    // Beim Anschub zielt die Kamera kurz hinter die Figur: sie fällt zurück,
    // die Figur schiesst nach vorn aus ihr heraus und wird wieder eingeholt.
    const zurueck = prefersReducedMotion() ? 0 : this.kick * 1.1;
    return { look: [this.focus.x * 0.3, 0.7, this.focus.z + 2.4 - zurueck] };
  }

  // Die Rennleiste: ein Punkt je Läufer auf seinem Weg zum Ziel, der eigene
  // grösser und mit weissem Ring. Man sieht auf einen Blick, wie weit der
  // Vordermann weg ist und wer von hinten kommt.
  syncRail(arcade, state, controlledId) {
    this.railNode ||= this.hud.querySelector("[data-race-rail]");
    if (!this.railNode || !arcade) return;
    this.railPips ||= new Map();
    const laenge = arcade.trackLength || 150;
    // Wer die Runde verlassen hat, verschwindet auch von der Leiste.
    this.railPips.forEach((pip, id) => {
      if (state?.players?.some((player) => player.id === id)) return;
      pip.remove();
      this.railPips.delete(id);
    });
    (state?.players || []).forEach((player) => {
      let pip = this.railPips.get(player.id);
      if (!pip) {
        pip = document.createElement("i");
        pip.className = player.id === controlledId ? "is-own" : "";
        pip.style.background = player.color;
        this.railNode.appendChild(pip);
        this.railPips.set(player.id, pip);
      }
      const entry = arcade.players[player.id];
      const anteil = entry?.finishedAt ? 1 : Math.min(1, (entry?.progress || 0) / laenge);
      const unten = `${(3 + anteil * 90).toFixed(1)}%`;
      if (pip.style.bottom !== unten) pip.style.bottom = unten;
    });
  }

  drawHud(f) {
    const { arcade, controlledId, state } = f;
    const controlled = arcade?.players?.[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.togoNode ||= this.hud.querySelector("[data-runner-togo]");
    // Platz: wer im Ziel ist, nach Einlaufzeit, dann alle anderen nach Weg.
    const reihe = (state?.players || [])
      .map((player) => ({ id: player.id, entry: arcade?.players?.[player.id] }))
      .filter((r) => r.entry)
      .sort((a, b) => {
        const fa = a.entry.finishedAt ? 1 : 0;
        const fb = b.entry.finishedAt ? 1 : 0;
        if (fa !== fb) return fb - fa;
        if (fa) return (a.entry.finishMs || 0) - (b.entry.finishMs || 0);
        return (b.entry.progress || 0) - (a.entry.progress || 0);
      });
    const platz = reihe.findIndex((r) => r.id === controlledId) + 1;
    // Wer nur zuschaut, hat keinen Platz.
    const platzText = platz > 0 ? `${platz}.` : "–";
    if (this.scoreNode.textContent !== platzText) {
      // Überholt oder überholt worden: die Zahl springt kurz grün oder rot.
      const vorher = this.letzterPlatz;
      this.letzterPlatz = platz;
      this.scoreNode.textContent = platzText;
      if (vorher && platz && !f.finale) {
        this.scoreNode.dataset.move = platz < vorher ? "up" : "down";
        this.platzBis = performance.now() + 650;
      }
    }
    if (this.scoreNode.dataset.move && performance.now() > (this.platzBis || 0)) delete this.scoreNode.dataset.move;
    const rest = Math.max(0, Math.ceil((arcade?.trackLength || 150) - (controlled?.progress || 0)));
    const togoText = controlled?.finishedAt ? "Ziel!" : `🏁 ${rest}m`;
    if (this.togoNode && this.togoNode.textContent !== togoText) this.togoNode.textContent = togoText;
    this.syncRail(arcade, state, controlledId);
    // Fahrtwindlinien am Bildrand: nur auf dem Boost, beim Anschub am dichtesten.
    this.speedNode ||= this.hud.querySelector("[data-runner-speed]");
    if (this.speedNode) {
      const staerke = prefersReducedMotion() ? 0 : Math.min(1, this.boost * 0.65 + this.kick * 0.45);
      const text = staerke < 0.02 ? "0" : staerke.toFixed(2);
      if (this.speedNode.style.opacity !== text) this.speedNode.style.opacity = text;
      const an = staerke >= 0.02;
      if (this.speedNode.classList.contains("is-on") !== an) this.speedNode.classList.toggle("is-on", an);
    }
  }
}
