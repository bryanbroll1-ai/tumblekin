import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createKin, KinAnimator, KIN_SOLE, standOn } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Zielgerade: drei Bahnen auf einer echten Laufbahn — Boostfelder, Matsch und
// Hürden. Wischen wechselt die Bahn, Tippen oder nach oben wischen springt,
// nach unten wischen wirft etwas auf den Vordermann.
//
// Die alte Strecke war blass und neblig, die Beläge flache Pastellplatten,
// Torbögen schnitten quer durchs Bild, die Hürden waren rote Kisten, und ein
// einfacher Tipp löste aus Versehen einen Angriff aus. Jetzt: rote Tartanbahn
// mit weissen Linien und Meterangaben, Boostfelder mit laufenden Pfeilen,
// Matschpfützen, die spritzen, Leichtathletik-Hürden, Tribünen und
// Wimpelketten an der Seite, eine höhere Kamera, und Tippen heisst Springen.
const LANE_WIDTH = 1.15;
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
const SURFACE_COLOUR = { sand: "#6b4424", normal: "#d4553f", tempo: "#1fe0b0" };
const FLOOR_Y = 0;                  // Oberkante der Laufbahn
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

function frac(v) {
  const x = Math.sin(v * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
    this.lastAttack = new Map();
    this.lastSplash = new Map();
    this.lastDodge = new Map();
    this.lastBox = new Map();
    this.throws = [];
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

  hudHtml() {
    return `<div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0m</strong></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame.arcade;
    const trackZ = arcade.trackLength * SEGMENT;
    this.trackZ = trackZ;
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.5, trackZ + 34),
      new THREE.MeshLambertMaterial({ color: "#58b85a" })
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
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, trackZ + 8), new THREE.MeshLambertMaterial({ color: "#2f7fd8" }));
      kerb.position.set(side * (LANE_WIDTH * 1.5 + 0.3), FLOOR_Y - 0.14, trackZ / 2);
      kerb.receiveShadow = true;
      scene.add(kerb);
    });

    // Beläge aus dem geteilten Kurs: Boost leuchtet und hat Pfeile, Matsch ist
    // eine dunkle Pfütze mit Blasen.
    const segLen = (arcade.segLen || 7.5) * SEGMENT;
    const felder = { tempo: [], sand: [] };
    (arcade.segments || []).forEach((segment) => {
      segment.lanes.forEach((belag, lane) => {
        if (belag === "normal") return;
        felder[belag].push({ lane, z: (segment.at + (arcade.segLen || 7.5) / 2) * SEGMENT });
      });
    });
    if (felder.tempo.length) {
      const pad = new THREE.InstancedMesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.16, 0.05, segLen - 0.2),
        new THREE.MeshLambertMaterial({ color: SURFACE_COLOUR.tempo, emissive: "#0fb88c", emissiveIntensity: 0.55 }),
        felder.tempo.length
      );
      const place = new THREE.Object3D();
      felder.tempo.forEach((entry, i) => {
        place.position.set(laneX(entry.lane), FLOOR_Y + 0.02, entry.z);
        place.updateMatrix();
        pad.setMatrixAt(i, place.matrix);
      });
      pad.instanceMatrix.needsUpdate = true;
      pad.receiveShadow = true;
      scene.add(pad);
      // Pfeile, die nacheinander aufleuchten: sie scheinen nach vorn zu laufen.
      const perPad = 4;
      const chevronGeo = new THREE.BufferGeometry();
      chevronGeo.setAttribute("position", new THREE.Float32BufferAttribute([
        -0.34, 0, -0.16, 0, 0, 0.2, 0, 0, 0.06,
        -0.34, 0, -0.16, 0, 0, 0.06, -0.34, 0, -0.3,
        0.34, 0, -0.16, 0, 0, 0.06, 0, 0, 0.2,
        0.34, 0, -0.16, 0.34, 0, -0.3, 0, 0, 0.06
      ], 3));
      chevronGeo.computeVertexNormals();
      this.chevrons = new THREE.InstancedMesh(chevronGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide }), felder.tempo.length * perPad);
      let k = 0;
      felder.tempo.forEach((entry) => {
        for (let n = 0; n < perPad; n += 1) {
          place.position.set(laneX(entry.lane), FLOOR_Y + 0.05, entry.z - segLen * 0.36 + n * (segLen * 0.72 / (perPad - 1)));
          place.updateMatrix();
          this.chevrons.setMatrixAt(k, place.matrix);
          this.chevrons.setColorAt(k, new THREE.Color("#ffffff"));
          k += 1;
        }
      });
      this.chevrons.instanceMatrix.needsUpdate = true;
      this.chevronsPerPad = perPad;
      scene.add(this.chevrons);
    }
    if (felder.sand.length) {
      const mud = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.5, 0.52, 0.05, 10),
        new THREE.MeshLambertMaterial({ color: SURFACE_COLOUR.sand }),
        felder.sand.length * 3
      );
      const bubbles = new THREE.InstancedMesh(
        new THREE.SphereGeometry(0.06, 6, 4),
        new THREE.MeshLambertMaterial({ color: "#8a5a34" }),
        felder.sand.length * 4
      );
      const place = new THREE.Object3D();
      let k = 0;
      let b = 0;
      felder.sand.forEach((entry, i) => {
        for (let n = 0; n < 3; n += 1) {
          place.position.set(laneX(entry.lane) + (frac(i * 3 + n) - 0.5) * 0.14, FLOOR_Y + 0.02 + n * 0.002, entry.z + (n - 1) * segLen * 0.3);
          place.scale.set(1.05, 1, (segLen * 0.42) / 1.04);
          place.rotation.y = frac(i + n * 7) * 0.4;
          place.updateMatrix();
          mud.setMatrixAt(k, place.matrix);
          k += 1;
        }
        place.scale.set(1, 1, 1);
        place.rotation.set(0, 0, 0);
        for (let n = 0; n < 4; n += 1) {
          place.position.set(laneX(entry.lane) + (frac(i * 5 + n) - 0.5) * 0.7, FLOOR_Y + 0.05, entry.z + (frac(i * 9 + n) - 0.5) * segLen * 0.8);
          place.updateMatrix();
          bubbles.setMatrixAt(b, place.matrix);
          b += 1;
        }
      });
      mud.instanceMatrix.needsUpdate = true;
      bubbles.instanceMatrix.needsUpdate = true;
      mud.receiveShadow = true;
      scene.add(mud);
      scene.add(bubbles);
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

    // Wasserbomben-Kisten: schwebend, drehend, mit einer Wasserbombe darin —
    // man sieht von weitem, in welcher Bahn die nächste steht.
    this.boxes = [];
    (arcade.segments || []).forEach((segment) => {
      if (segment.box === null || segment.box === undefined) return;
      const z = segment.boxAt * SEGMENT;
      const box = this.makeItemBox();
      box.position.set(laneX(segment.box), FLOOR_Y + 0.55, z);
      this.boxes.push({ group: box, index: segment.index, lane: segment.box, z });
      scene.add(partOf(box, z));
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
      // Die getragene Wasserbombe schwebt über der Figur — man sieht bei
      // jedem, ob er gerade werfen kann.
      const carried = this.makeBalloon("#39b8ff");
      carried.position.set(0.28, 0.95, 0);
      carried.scale.setScalar(0.75);
      carried.visible = false;
      kin.add(carried);
      kin.userData.carried = carried;
    });

    // Zielring: goldgelb unter dem, den man anvisiert, und ein roter unter
    // der eigenen Figur, wenn jemand auf einen zielt. Nicht in der eigenen
    // Farbe — bei der roten Figur sähe der Zielring aus wie die Warnung.
    const ring = (color) => {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.36, 0.48, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    };
    this.aimRing = ring("#ffe36b");
    this.dangerRing = ring("#ff4d5e");
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
      const leaves = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshLambertMaterial({ color: frac(seed) > 0.5 ? "#6fc06a" : "#8ad07f" }));
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

  makeItemBox() {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.46, 0.46),
      new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ffb020", emissiveIntensity: 0.35, transparent: true, opacity: 0.55, depthWrite: false })
    );
    group.add(shell);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.47, 0.47, 0.47)),
      new THREE.LineBasicMaterial({ color: "#fff4c2" })
    );
    group.add(edges);
    const balloon = this.makeBalloon("#39b8ff");
    balloon.scale.setScalar(0.8);
    group.add(balloon);
    group.userData.shell = shell;
    return group;
  }

  // Eine Wasserbombe: runder Körper, kleiner Knoten oben.
  makeBalloon(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 10),
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.25 })
    );
    body.scale.set(1, 1.15, 1);
    group.add(body);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.07, 6), new THREE.MeshLambertMaterial({ color }));
    knot.position.y = 0.17;
    group.add(knot);
    return group;
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
    const group = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    const red = new THREE.MeshLambertMaterial({ color: "#ff3b55" });
    [-1, 1].forEach((side) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), white);
      leg.position.set(side * (LANE_WIDTH / 2 - 0.14), FLOOR_Y + 0.31, 0);
      leg.castShadow = true;
      group.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.42), white);
      foot.position.set(side * (LANE_WIDTH / 2 - 0.14), FLOOR_Y + 0.03, -0.14);
      group.add(foot);
    });
    const stripes = 5;
    const width = LANE_WIDTH - 0.2;
    for (let i = 0; i < stripes; i += 1) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(width / stripes, 0.14, 0.06), i % 2 ? white : red);
      bar.position.set(-width / 2 + (i + 0.5) * (width / stripes), FLOOR_Y + 0.6, 0);
      bar.castShadow = true;
      group.add(bar);
    }
    group.position.set(x, 0, z);
    return group;
  }

  shot() {
    return {
      look: [0, 0.7, 2.4],
      frame: { w: 4.6, h: 3.4 },
      yaw: Math.PI - 0.12,
      pitch: 0.5,
      fov: 40,
      ease: 0.14,
      intro: { yaw: -0.8, pitch: 0.2, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="runner-lane-controls">
        <p class="runner-threat" data-runner-threat hidden>⚠</p>
        <div class="runner-row">
          <p class="runner-swipe-hint" data-swipe-hint>◀ Wischen ▶ · Tippen = Springen</p>
          <button class="runner-throw" type="button" data-runner-throw disabled>
            <span class="runner-throw-icon">🎈</span><span data-runner-throw-label>Kiste holen</span>
          </button>
        </div>
      </div>`;
    this.swipeHint = this.controls.querySelector("[data-swipe-hint]");
    this.threatNode = this.controls.querySelector("[data-runner-threat]");
    this.throwButton = this.controls.querySelector("[data-runner-throw]");
    this.throwLabel = this.controls.querySelector("[data-runner-throw-label]");
    // Ein eigener Knopf zum Werfen: ein Wisch nach unten war schwer zu treffen
    // und leicht mit einem Spurwechsel zu verwechseln.
    this.on(this.throwButton, "pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
      if (!own?.item || !own?.lockId || own.finishedAt) {
        this.feedback?.sound("error");
        return;
      }
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(14);
      this.sendInput({ action: "attack" }).catch(() => {});
    });
    this.on(this.webglCanvas, "pointerdown", (event) => {
      this.swipe = { x: event.clientX, y: event.clientY, at: performance.now(), moved: false };
    });
    this.on(this.webglCanvas, "pointermove", (event) => {
      if (!this.swipe) return;
      if (Math.hypot(event.clientX - this.swipe.x, event.clientY - this.swipe.y) > 16) this.swipe.moved = true;
    });
    this.on(window, "pointerup", (event) => this.resolveSwipe(event));
    this.on(window, "pointercancel", (event) => this.resolveSwipe(event));
  }

  resolveSwipe(event) {
    if (!this.swipe) return;
    const dx = event.clientX - this.swipe.x;
    const dy = event.clientY - this.swipe.y;
    this.swipe = null;
    
    // Ein einfacher Tipp springt. Er löste vorher einen Angriff aus — genau
    // das, was man beim hastigen Tippen vor einer Hürde nicht wollte.
    if (Math.abs(dx) < 26 && Math.abs(dy) < 26) {
       this.feedback?.sound("pop");
       this.sendInput({ action: "jump" }).catch(() => {});
       return;
    }
    
    if (Math.abs(dx) > Math.abs(dy)) {
       this.sendLane(dx > 0 ? 1 : -1);
    } else if (dy < 0) {
       // Nach oben wischen springt ebenfalls — wer es so erwartet, soll es haben.
       this.feedback?.sound("pop");
       this.sendInput({ action: "jump" }).catch(() => {});
    }
  }

  sendLane(dir) {
    const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt) return;
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "lane", dir }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    this.spectators.forEach((fan) => fan.update(now));
    this.tipHurdles(now);
    let ownKin = null;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      // Mitten in der eigenen Bahn und genau auf dem eigenen Fortschritt.
      // Vorher bekam jede Figur einen festen Seitenversatz (±0.45) und einen
      // Vorsprung nach Startplatz: auf den Aussenbahnen ragte sie über den
      // Bahnrand, und wer vorn aussah, lag nicht unbedingt vorn. Nur wenn zwei
      // in derselben Bahn Schulter an Schulter laufen, rücken sie innerhalb
      // der Bahn auseinander.
      let nudge = 0;
      players.forEach((other, j) => {
        if (j === index) return;
        const o = arcade.players[other.id];
        if (!o || o.lane !== entry.lane || o.finishedAt || entry.finishedAt) return;
        if (Math.abs((o.progress - entry.progress) * SEGMENT) > 0.7) return;
        nudge += index < j ? -1 : 1;
      });
      let targetX = laneX(entry.lane) + clamp(nudge, -1, 1) * 0.24;
      let targetZ = entry.progress * SEGMENT;
      // Im Ziel: nebeneinander hinter der Linie aufreihen, in der Reihenfolge
      // des Einlaufs — vorher standen alle auf demselben Fleck ineinander.
      if (entry.finishedAt) {
        const order = players
          .map((other) => arcade.players[other.id])
          .filter((o) => o?.finishedAt && (o.finishMs < entry.finishMs || (o.finishMs === entry.finishMs && o !== entry && players.findIndex((p) => arcade.players[p.id] === o) < index)))
          .length;
        targetX = (order - 1.5) * 0.78;
        targetZ = (this.trackZ || entry.progress * SEGMENT) + 1.1;
      }
      const prevX = kin.position.x;
      kin.position.x += (targetX - kin.position.x) * frameLerp(0.25, dt);
      kin.position.z += (targetZ - kin.position.z) * frameLerp(0.4, dt);
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
        this.knockHurdle(kin.position, now);
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
      // Angriff: ein Wurf nach vorn in die eigene Bahn.
      if (entry.lastAttackAt && entry.lastAttackAt !== this.lastAttack.get(player.id)) {
        const first = !this.lastAttack.has(player.id) && now - entry.lastAttackAt > 1500;
        this.lastAttack.set(player.id, entry.lastAttackAt);
        if (!first) {
          animator.trigger("throw");
          const ball = this.makeBalloon("#39b8ff");
          ball.position.copy(kin.position).add(new THREE.Vector3(0, 0.9, 0.2));
          this.scene.add(ball);
          // Die Wasserbombe fliegt im Bogen auf die BAHN des Ziels und landet
          // genau dann, wenn der Server den Treffer wertet. Wer ausweicht, lässt
          // sie neben sich platzen.
          const shot = entry.lastThrow;
          const dur = shot ? Math.max(200, shot.hitAt - shot.at) : 600;
          this.throws.push({
            mesh: ball,
            from: ball.position.clone(),
            at: now,
            dur,
            lane: shot?.lane ?? entry.lane,
            target: shot?.targetId ? this.kins.get(shot.targetId) : null
          });
          if (isOwn || shot?.targetId === controlledId) this.feedback?.sound("whoosh");
        }
      }
      // Getroffen: Platsch, Wasser spritzt, kurz benommen.
      if ((entry.splashes || 0) > (this.lastSplash.get(player.id) || 0)) {
        this.lastSplash.set(player.id, entry.splashes);
        animator.trigger("stumble");
        animator.expression("surprised", 900);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.7, 0));
        this.burst(at, ["#39b8ff", "#9fe3ff", "#ffffff"], { count: 22, speed: 2.4, up: 2.0, size: 0.08, life: 0.6, gravity: 6 });
        this.bursts.ring(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.06, kin.position.z), "#39b8ff", { radius: 1.0, life: 0.4, y: FLOOR_Y + 0.06 });
        this.pop(at.clone().add(new THREE.Vector3(0, 0.5, 0)), "PLATSCH!", { color: "#9fe3ff", size: isOwn ? 0.42 : 0.3, life: 0.8 });
        if (isOwn) {
          this.rig.shake(0.7);
          this.feedback?.sound("collision");
          this.feedback?.vibrate([24, 20, 24]);
        }
      }
      if ((entry.dodges || 0) > (this.lastDodge.get(player.id) || 0)) {
        this.lastDodge.set(player.id, entry.dodges);
        const at = kin.position.clone().add(new THREE.Vector3(0, 1.3, 0));
        this.pop(at, "AUSGEWICHEN!", { color: "#8ff5d8", size: isOwn ? 0.38 : 0.26, life: 0.8 });
        if (isOwn) this.feedback?.sound("sparkle");
      }
      if ((entry.boxes || 0) > (this.lastBox.get(player.id) || 0)) {
        this.lastBox.set(player.id, entry.boxes);
        if (isOwn) {
          const at = kin.position.clone().add(new THREE.Vector3(0, 1.1, 0));
          this.burst(at, ["#ffd15c", "#39b8ff", "#ffffff"], { count: 14, speed: 1.8, up: 1.6, size: 0.07, life: 0.5 });
          this.pop(at, "WASSERBOMBE!", { color: "#9fe3ff", size: 0.34, life: 0.8 });
          this.feedback?.sound("coin");
          this.feedback?.vibrate(12);
        }
      }
      kin.userData.carried.visible = Boolean(entry.item) && !finished;
      if (entry.item) kin.userData.carried.position.y = 0.95 + Math.sin(now / 180 + index) * 0.05;
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
        const phase = Math.max(0, entry.jumpUntil - now) / 650;
        lift = Math.pow(Math.sin(phase * Math.PI), 0.6) * 1.25;
        const hurdle = this.hurdles?.find((h) => Math.abs(h.x - kin.position.x) < LANE_WIDTH * 0.5
          && Math.abs(h.z - kin.position.z) < HURDLE_CLEAR_REACH && h.group.rotation.x === 0);
        if (hurdle) {
          const near = 1 - Math.abs(hurdle.z - kin.position.z) / HURDLE_CLEAR_REACH;
          lift = Math.max(lift, HURDLE_CLEAR * Math.min(1, near * 1.8));
        }
      }
      animator.groundY = standOn(FLOOR_Y) + lift;

      if (finished && !this.lastFinished.get(player.id)) {
        this.lastFinished.set(player.id, true);
        animator.trigger("celebrate");
        this.burst(kin.position.clone(), [player.color, "#ffffff", "#ffd15c"], { count: 24, speed: 2.8, up: 3.0, size: 0.1, life: 0.95, drag: 1.2 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "ZIEL! 🏁", { color: "#ffe36b", size: 0.46, life: 1.2, rise: 1 });
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

    // Wasserbomben fliegen im hohen Bogen auf die Bahn des Ziels. Das Ziel
    // läuft weiter — die Landestelle folgt ihm nach vorn, aber nicht zur Seite.
    this.throws = this.throws.filter((shot) => {
      const u = (now - shot.at) / shot.dur;
      const toZ = shot.target ? shot.target.position.z : shot.from.z + 5;
      const to = new THREE.Vector3(laneX(shot.lane), FLOOR_Y + 0.5, toZ);
      if (u >= 1) {
        this.burst(to.clone(), ["#39b8ff", "#9fe3ff", "#ffffff"], { count: 14, speed: 2.0, up: 1.4, size: 0.07, life: 0.5, gravity: 6 });
        this.bursts.ring(new THREE.Vector3(to.x, FLOOR_Y + 0.05, to.z), "#9fe3ff", { radius: 0.8, life: 0.35, y: FLOOR_Y + 0.05 });
        this.scene.remove(shot.mesh);
        shot.mesh.traverse((part) => { part.geometry?.dispose(); part.material?.dispose(); });
        return false;
      }
      shot.mesh.position.lerpVectors(shot.from, to, u);
      shot.mesh.position.y += Math.sin(u * Math.PI) * 1.5;
      shot.mesh.rotation.z += dt * 8;
      return true;
    });

    // Zielringe.
    const me = arcade.players[controlledId];
    const lockKin = me?.lockId && !me.finishedAt ? this.kins.get(me.lockId) : null;
    this.aimRing.visible = Boolean(lockKin) && !finale;
    if (lockKin) {
      this.aimRing.position.set(lockKin.position.x, FLOOR_Y + 0.03, lockKin.position.z);
      this.aimRing.rotation.z = now / 400;
      this.aimRing.scale.setScalar(1 + Math.sin(now / 120) * 0.08);
    }
    const bedrohtKin = ownKin && (me?.lockedBy || (me?.incomingAt || 0) > now) && !me.finishedAt ? ownKin : null;
    this.dangerRing.visible = Boolean(bedrohtKin) && !finale;
    if (bedrohtKin) {
      this.dangerRing.position.set(bedrohtKin.position.x, FLOOR_Y + 0.025, bedrohtKin.position.z);
      const incoming = (me?.incomingAt || 0) > now;
      this.dangerRing.scale.setScalar(incoming ? 1.2 + Math.sin(now / 50) * 0.12 : 1);
      this.dangerRing.material.opacity = incoming ? 0.95 : 0.55;
    }
    this.boxes?.forEach((box, i) => {
      box.group.rotation.y = now / 500 + i;
      box.group.position.y = FLOOR_Y + 0.55 + Math.sin(now / 300 + i) * 0.06;
    });

    const own = arcade.players[controlledId];
    const belag = own?.surface || "normal";
    if (belag !== this.letzterBelag) {
      const vorher = this.letzterBelag;
      this.letzterBelag = belag;
      if (ownKin && vorher !== undefined && !own?.finishedAt) {
        if (belag === "tempo") {
          this.pop(ownKin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "BOOST!", { color: "#8ff5d8", size: 0.36, life: 0.75 });
          this.feedback?.sound("coin");
        } else if (belag === "sand") {
          this.pop(ownKin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "MATSCH", { color: "#c99a5e", size: 0.3, life: 0.7 });
          this.feedback?.sound("clack");
        }
      }
    }
    // Jemand zielt auf einen: einmal kurz vibrieren, wenn es anfängt — die
    // Warnzeile allein übersieht man im Lauf.
    const bedroht = (Boolean(own?.lockedBy) || (own?.incomingAt || 0) > this.now()) && !own?.finishedAt;
    if (bedroht !== this.warBedroht) {
      this.warBedroht = bedroht;
      if (bedroht) this.feedback?.vibrate(12);
    }

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
    // Die Fahrtstreifen laufen mit dem Belag: auf der Tempobahn schneller.
    const streakSpeed = own?.surface === "tempo" ? 1.5 : own?.surface === "sand" ? 0.7 : 1;
    this.streaks.forEach((streak) => {
      streak.position.z -= streak.userData.speed * streakSpeed * dt;
      if (streak.position.z < focusZ - 3) {
        streak.position.z = focusZ + 12 + Math.random() * 6;
        streak.position.x = focusX + (Math.random() - 0.5) * 7;
        streak.position.y = 0.3 + Math.random() * 3.2;
      }
    });
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
    return { look: [this.focus.x * 0.3, 0.7, this.focus.z + 2.4] };
  }

  drawHud(f) {
    const { arcade, controlledId, state } = f;
    const controlled = arcade?.players?.[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = controlled?.finishedAt ? "Ziel!" : `${Math.round(controlled?.progress || 0)}m`;
    const nameOf = (id) => state?.players?.find((player) => player.id === id)?.name || "Jemand";
    // Der Wurfknopf sagt immer, was gerade geht: Kiste holen, kein Ziel, werfen.
    if (this.throwButton) {
      const hasItem = Boolean(controlled?.item) && !controlled?.finishedAt;
      const lock = hasItem ? controlled?.lockId : null;
      const mode = !hasItem ? "empty" : lock ? "ready" : "nolock";
      const label = mode === "empty" ? "Kiste holen" : mode === "nolock" ? "Kein Ziel" : `Auf ${nameOf(lock)}!`;
      if (this.throwButton.dataset.mode !== mode) this.throwButton.dataset.mode = mode;
      this.throwButton.disabled = mode !== "ready";
      if (this.throwLabel.textContent !== label) this.throwLabel.textContent = label;
    }
    if (this.threatNode) {
      const kommt = (controlled?.incomingAt || 0) > this.now();
      const zeigen = (kommt || Boolean(controlled?.lockedBy)) && !controlled?.finishedAt;
      const text = kommt ? "⚠ WASSERBOMBE — SPRING ODER WECHSLE!" : `⚠ ${nameOf(controlled?.lockedBy)} zielt auf dich!`;
      if (this.threatNode.textContent !== text) this.threatNode.textContent = text;
      if (this.threatNode.hidden === zeigen) this.threatNode.hidden = !zeigen;
      this.threatNode.dataset.urgent = kommt ? "1" : "0";
    }
  }
}
