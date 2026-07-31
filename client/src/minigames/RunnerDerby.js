import * as THREE from "/vendor/three/three.module.js";
import {
  applyFinaleMood,
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin93";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin93";
import { frameChance, frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin93";

// Zielgerade — a blocky three-lane endless-runner sprint.
// The server auto-runs every kin forward; the player only swaps lanes to
// dodge hurdles and grab boost pads. Camera chases the controlled kin.
const LANE_WIDTH = 1.15;
// Grösse der wiederverwendeten Kulissen-Vorräte. Am Bild gerechnet: die Kamera
// sieht bei diesem Blickwinkel gut 14 Streckeneinheiten voraus, also reichen
// zwölf Striche und je zwölf Objekte pro Seite mit deutlichem Puffer.
const RUNG_POOL = 12;
const PROP_POOL = 24;
const PROP_SPACING = 2.6;
const SEGMENT = 0.62; // world units per track meter
const FLOOR_Y = 0;
const KIN_Y = 0.34;

// The chase camera looks toward +z, which mirrors the x axis on screen.
// Mapping lane 0→right … lane 2→left keeps the on-screen direction matching
// the ◀/▶ buttons and swipes.
function laneX(lane) {
  return (1 - lane) * LANE_WIDTH;
}

function frac(v) {
  const x = Math.sin(v * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export class RunnerDerby {
  constructor({ canvas, controls, sendInput, now, getState, getControlledPlayerId, myPlayerId, feedback }) {
    this.canvas = canvas;
    this.controls = controls;
    this.sendInput = sendInput;
    this.now = now;
    this.getState = getState;
    this.getControlledPlayerId = getControlledPlayerId || (() => myPlayerId);
    this.feedback = feedback;
    this.minigame = null;
    this.update = null;
    this.frame = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.webglCanvas = null;
    this.hud = null;
    this.kins = new Map();
    this.animators = new Map();
    this.obstacles = [];
    this.sliders = [];
    this.boosts = [];
    this.itemPads = [];
    this.scenery = [];
    this.streaks = [];
    this.spectators = [];
    this.spectatorParts = [];
    this.shotMeshes = new Map();
    this.lastFrameAt = performance.now();
    this.lastStumbles = new Map();
    this.lastBoostAt = new Map();
    this.lastFinished = new Map();
    this.lastHasItem = false;
    this.swipe = null;
    this.shake = 0;
    this.fov = 48;
    this.fovKick = 0;
    this.baseCamera = new THREE.Vector3(0, 3.6, -6.2);
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Zielgerade", background: "#8fd8f2", fog: ["#9fdef5", 10, 30], fov: 52 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0m</strong></div>
      <div class="kinetic-countdown" data-kinetic-countdown></div>
    `);
    this.createScene();

    // Gewischt wird auf der Szene — Bahnknöpfe braucht es dafür nicht, sie
    // verdoppelten nur die Geste und nahmen Platz weg. Der Wurf bleibt ein
    // Knopf: er hat keine Richtung und ist eine eigene Entscheidung.
    // Kein Knopf mehr. Wischen wechselt die Bahn, TIPPEN wirft — beides auf dem
    // ganzen Bild, beides dort, wo der Daumen ohnehin liegt. Der Wurfknopf sass
    // am unteren Rand und verlangte, den Blick von der Strecke zu nehmen, genau
    // in dem Moment, in dem man jemanden treffen will.
    this.controls.innerHTML = `
      <div class="runner-lane-controls">
        <p class="runner-swipe-hint" data-swipe-hint>◀ Wischen zum Bahnwechsel ▶</p>
      </div>
    `;
    this.onCanvasPointerDown = (event) => { this.swipe = { x: event.clientX, y: event.clientY, at: performance.now() }; };
    this.onCanvasPointerUp = (event) => this.resolveSwipe(event);
    this.webglCanvas.addEventListener("pointerdown", this.onCanvasPointerDown);
    this.webglCanvas.addEventListener("pointerup", this.onCanvasPointerUp);
    this.loop();
  }

  resolveSwipe(event) {
    if (!this.swipe) return;
    const dx = event.clientX - this.swipe.x;
    const dy = event.clientY - this.swipe.y;
    const held = performance.now() - this.swipe.at;
    this.swipe = null;
    // Kurzer Kontakt ohne Weg ist ein Tipp und damit ein Wurf; alles mit Weg
    // nach links oder rechts ist ein Bahnwechsel.
    if (Math.hypot(dx, dy) < 24) {
      if (held < 400) this.sendThrow();
      return;
    }
    if (Math.abs(dx) < 24) return;
    this.sendLane(dx > 0 ? 1 : -1);
  }

  sendLane(dir) {
    const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt) return;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "lane", dir }).catch(() => {});
  }

  sendThrow() {
    const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt || !own?.hasItem) return;
    this.feedback?.sound("pop");
    this.feedback?.vibrate([12, 10, 18]);
    this.sendInput({ action: "throw" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    if (this.onCanvasPointerDown) this.webglCanvas.removeEventListener("pointerdown", this.onCanvasPointerDown);
    if (this.onCanvasPointerUp) this.webglCanvas.removeEventListener("pointerup", this.onCanvasPointerUp);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    const arcade = this.minigame.arcade;
    const trackZ = arcade.trackLength * SEGMENT;

    addStageLights(this.scene, {
      sunPosition: [-4, 10, -2],
      sunIntensity: 3.2,
      skyColor: 0xdfefff,
      groundColor: 0x6fb0c4,
      sunColor: 0xfff4d6
    });

    // A wide meadow under everything — the world no longer falls away into
    // blue void beside the track.
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.5, trackZ + 34),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.set(0, FLOOR_Y - 0.31, trackZ / 2);
    meadow.receiveShadow = true;
    this.scene.add(meadow);

    // Rolling hills on the horizon left and right.
    for (let i = 0; i < 14; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const s = 2.6 + frac(i * 4.7) * 3.4;
      const hill = new THREE.Mesh(
        new THREE.BoxGeometry(s * 1.6, s, s * 1.4),
        new THREE.MeshLambertMaterial({ color: i % 3 === 0 ? "#8fd97b" : (i % 3 === 1 ? "#6bbf5e" : "#a5e08c") })
      );
      hill.position.set(side * (8.5 + frac(i * 2.3) * 5), FLOOR_Y - 0.3 + s / 2 - s * 0.35, (i / 14) * (trackZ + 20) - 6);
      hill.rotation.y = frac(i * 8.1) * 0.7;
      this.scene.add(hill);
    }

    // Track: three sand-coloured sprint lanes with white edge lines — reads
    // like a real race course against the meadow.
    const laneColors = ["#f4d98c", "#ffe6a3", "#f4d98c"];
    for (let lane = 0; lane < 3; lane += 1) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.04, 0.3, trackZ + 8),
        new THREE.MeshLambertMaterial({ color: laneColors[lane] })
      );
      strip.position.set(laneX(lane), FLOOR_Y - 0.15, trackZ / 2);
      strip.receiveShadow = true;
      this.scene.add(strip);
    }
    // Dirt shoulders framing the course.
    [-1, 1].forEach((side) => {
      const shoulder = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.34, trackZ + 8),
        new THREE.MeshLambertMaterial({ color: "#c98d4e" })
      );
      shoulder.position.set(side * (LANE_WIDTH * 1.5 + 0.15), FLOOR_Y - 0.16, trackZ / 2);
      this.scene.add(shoulder);
    });

    // Festival arches spanning the track every stretch.
    const archColors = ["#ff5c8a", "#12aaff", "#ffc400", "#33cf4d"];
    for (let a = 0; a < 4; a += 1) {
      const z = (a + 1) * (trackZ / 5);
      const color = archColors[a % archColors.length];
      [-1, 1].forEach((side) => {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.26, 2.5, 0.26),
          new THREE.MeshLambertMaterial({ color })
        );
        post.position.set(side * (LANE_WIDTH * 1.9), FLOOR_Y + 1.25, z);
        post.castShadow = true;
        this.scene.add(post);
      });
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH * 3.8 + 0.6, 0.32, 0.32),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 })
      );
      beam.position.set(0, FLOOR_Y + 2.55, z);
      this.scene.add(beam);
    }

    // A little cheering crowd along the course.
    const crowdColors = ["#ff8b2e", "#8f6ae0", "#2ec4b6", "#f45b9d", "#8bc34a", "#5c9dff"];
    for (let i = 0; i < 8; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const fan = createVoxelKin(crowdColors[i % crowdColors.length], i);
      fan.scale.setScalar(0.8);
      fan.position.set(side * (LANE_WIDTH * 2.55 + frac(i * 3.3) * 0.5), KIN_Y * 0.8, 6 + i * (trackZ / 9));
      fan.rotation.y = -side * Math.PI / 2;
      this.scene.add(fan);
      // Auch die Zuschauer wandern mit: sie stehen fest an der Strecke, und
      // acht Figuren zu je einem Dutzend Körpern sind der letzte grosse Posten.
      this.spectatorParts.push({ object: fan, z: fan.position.z });
      const fanAnimator = new KinAnimator(fan);
      fanAnimator.groundY = KIN_Y * 0.8;
      fanAnimator.set("cheer", { base: true });
      this.spectators.push(fanAnimator);
    }
    // Fahrbahnstriche. NUR so viele, wie ins Bild passen — sie wandern mit
    // (siehe recycleScenery). Vorher lag über die ganzen 150 Streckeneinheiten
    // ein Strich alle vier Meter, also 37 Meshes, von denen man nie mehr als
    // acht gleichzeitig sah.
    this.rungs = [];
    for (let i = 0; i < RUNG_POOL; i += 1) {
      const rung = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH * 3, 0.02, 0.12),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.25 })
      );
      rung.position.set(0, FLOOR_Y + 0.01, (4 + i * 4) * SEGMENT);
      this.scene.add(rung);
      this.rungs.push(rung);
    }

    // Finish line.
    const finish = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH * 3.2, 0.06, 0.5),
      new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#ffd15c", emissiveIntensity: 0.4 })
    );
    finish.position.set(0, FLOOR_Y + 0.02, trackZ);
    this.scene.add(finish);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.2), new THREE.MeshLambertMaterial({ color: "#ef6673" }));
      post.position.set(side * LANE_WIDTH * 1.7, FLOOR_Y + 0.8, trackZ);
      post.castShadow = true;
      this.scene.add(post);
    });

    // Obstacles from the shared course.
    //
    // Alles bekommt zusätzlich einen Eintrag in `courseParts`: weit entfernte
    // Hindernisse werden im Bild ausgeblendet. three.js überspringt unsichtbare
    // Objekte beim Zeichnen, das spart also echte Zeichenaufrufe — und man sieht
    // ohnehin nie mehr als ein paar Meter Strecke.
    this.courseParts = [];
    const partOf = (object, z) => { this.courseParts.push({ object, z }); return object; };
    arcade.rows.forEach((row, rowIndex) => {
      const z = row.position * SEGMENT;
      if (row.kind === "boost") {
        const pad = new THREE.Mesh(
          new THREE.BoxGeometry(LANE_WIDTH - 0.2, 0.08, 0.9),
          new THREE.MeshLambertMaterial({ color: "#ffe36b", emissive: "#c98f1e", emissiveIntensity: 0.5 })
        );
        pad.position.set(laneX(row.lane), FLOOR_Y + 0.05, z);
        this.scene.add(partOf(pad, z));
        const arrow = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.04, 0.5),
          new THREE.MeshBasicMaterial({ color: "#ffffff" })
        );
        arrow.position.set(laneX(row.lane), FLOOR_Y + 0.1, z);
        this.scene.add(partOf(arrow, z));
        this.boosts.push(pad);
      } else if (row.kind === "item") {
        // Floating pickup orb: grab it, then hurl it at the runner ahead.
        const orb = new THREE.Group();
        const core = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.34, 0.34),
          new THREE.MeshLambertMaterial({ color: "#ff8b2e", emissive: "#ff8b2e", emissiveIntensity: 0.55 })
        );
        orb.add(core);
        const spikes = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.14, 0.14),
          new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ffd15c", emissiveIntensity: 0.4 })
        );
        orb.add(spikes);
        const spikes2 = spikes.clone();
        spikes2.rotation.y = Math.PI / 2;
        orb.add(spikes2);
        orb.position.set(laneX(row.lane), FLOOR_Y + 0.55, z);
        orb.userData = { baseY: FLOOR_Y + 0.55, phase: z, rowIndex, taken: 0 };
        this.scene.add(partOf(orb, z));
        this.itemPads.push(orb);
      } else if (row.kind === "cone") {
        this.scene.add(partOf(this.makeHurdle(laneX(row.lane), z, "#ef6673"), z));
      } else if (row.kind === "log") {
        [0, 1, 2].filter((lane) => lane !== row.freeLane).forEach((lane) => {
          this.scene.add(partOf(this.makeHurdle(laneX(lane), z, "#8a5a34"), z));
        });
      } else if (row.kind === "slider") {
        // A pane of glass that shatters on contact (and the server slows you).
        const mesh = this.makeGlassPanel(laneX(row.baseLane), z);
        mesh.userData = { baseLane: row.baseLane, phase: row.phase, z, shattered: false };
        this.scene.add(partOf(mesh, z));
        this.sliders.push(mesh);
      }
    });

    [[-6, 4, 10, 5], [6, 5, 24, 6], [-5, 5, 40, 7], [7, 6, 58, 8], [-7, 5, 74, 9]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
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
      this.scene.add(prop);
      this.scenery.push(prop);
    }

    // Foreground speed streaks that rush toward the camera and recycle.
    const streakMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.32 });
    for (let i = 0; i < 22; i += 1) {
      const streak = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.9), streakMat);
      streak.position.set((Math.random() - 0.5) * 7, 0.3 + Math.random() * 3.2, Math.random() * 16);
      streak.userData = { speed: 14 + Math.random() * 10 };
      this.scene.add(streak);
      this.streaks.push(streak);
    }

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
  }

  // Setzt Striche und Bepflanzung, die hinter dem Läufer liegen, um ein ganzes
  // Band nach vorne. Dieselbe Mechanik wie an der Kletterwand: die Strecke wirkt
  // endlos, ohne endlos gebaut zu sein.
  recycleScenery(focusZ) {
    const behind = focusZ - 6 * SEGMENT;
    const rungBand = RUNG_POOL * 4 * SEGMENT;
    this.rungs?.forEach((rung) => {
      while (rung.position.z < behind) rung.position.z += rungBand;
      while (rung.position.z > behind + rungBand) rung.position.z -= rungBand;
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

  makeHurdle(x, z, color) {
    const group = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH - 0.24, 0.6, 0.34), new THREE.MeshLambertMaterial({ color }));
    block.position.y = FLOOR_Y + 0.3;
    block.castShadow = true;
    group.add(block);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH - 0.1, 0.12, 0.44), new THREE.MeshLambertMaterial({ color: "#ffffff" }));
    cap.position.y = FLOOR_Y + 0.62;
    group.add(cap);
    group.position.set(x, 0, z);
    return group;
  }

  makeGlassPanel(x, z) {
    const group = new THREE.Group();
    const glassMat = new THREE.MeshLambertMaterial({
      color: "#8fd4ff", emissive: "#2aa0ff", emissiveIntensity: 0.28,
      transparent: true, opacity: 0.5
    });
    const pane = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH - 0.14, 0.95, 0.09), glassMat);
    pane.position.y = FLOOR_Y + 0.48;
    group.add(pane);
    // Bright frame so the glass reads clearly against the track.
    const frameMat = new THREE.MeshLambertMaterial({ color: "#eaf7ff", emissive: "#7fd0ff", emissiveIntensity: 0.4 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH - 0.06, 0.08, 0.14), frameMat);
    top.position.y = FLOOR_Y + 0.96;
    group.add(top);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.98, 0.14), frameMat);
      post.position.set(side * (LANE_WIDTH - 0.1) / 2, FLOOR_Y + 0.48, 0);
      group.add(post);
    });
    group.position.set(x, 0, z);
    group.userData = {};
    return group;
  }

  shatterGlass(mesh) {
    if (mesh.userData.shattered) return;
    mesh.userData.shattered = true;
    // Blast a spray of glass shards, then the pane is gone.
    this.bursts.spawn(new THREE.Vector3(mesh.position.x, FLOOR_Y + 0.5, mesh.position.z), ["#cdeeff", "#ffffff", "#8fd4ff"], { count: 16, speed: 2.6, up: 2.4, size: 0.08, life: 0.7 });
    mesh.visible = false;
    this.feedback?.sound("clack");
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.position.set(laneX(1), KIN_Y, 0);

    // Dizzy stars that orbit the head while tumbling from a crash or a hit.
    const dizzy = new THREE.Group();
    for (let s = 0; s < 3; s += 1) {
      const star = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.05),
        new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ffd15c", emissiveIntensity: 0.7 })
      );
      const angle = (s / 3) * Math.PI * 2;
      star.position.set(Math.cos(angle) * 0.32, 0, Math.sin(angle) * 0.32);
      star.rotation.z = Math.PI / 4;
      dizzy.add(star);
    }
    dizzy.position.y = 0.5;
    dizzy.visible = false;
    kin.add(dizzy);
    kin.userData.dizzy = dizzy;

    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_Y;
    animator.set("run", { base: true });
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);
    return kin;
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    const arcade = minigame?.arcade;
    if (!minigame || !state || !arcade || !this.renderer) return;
    this.resizeRenderer();

    const now = this.now();
    const frameNow = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (frameNow - this.lastFrameAt) / 1000));
    this.lastFrameAt = frameNow;
    const controlledId = this.getControlledPlayerId();

    // Animate the oscillating glass panes to match the server's blocked lane.
    this.sliders.forEach((mesh) => {
      if (mesh.userData.shattered) return;
      const data = mesh.userData;
      const shifted = Math.sin(now / 650 + data.phase) > 0 ? 1 : 0;
      mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, laneX(data.baseLane + shifted), frameLerp(0.2, dt));
    });
    this.boosts.forEach((pad) => {
      pad.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(now / 240)) * 0.4;
    });
    // Kisten schweben und drehen sich einladend — und verschwinden, sobald man
    // sie eingesammelt hat. Vorher blieben sie stehen, und man sah dem Brett
    // nicht an, ob der Griff gesessen hatte.
    const takenRows = new Set(arcade.players[controlledId]?.takenRows || []);
    this.itemPads.forEach((orb) => {
      if (takenRows.has(orb.userData.rowIndex)) {
        // Einsaugen: schrumpfen und aufsteigen, dann ausblenden.
        orb.userData.taken = Math.min(1, orb.userData.taken + dt * 4);
        const t = orb.userData.taken;
        orb.scale.setScalar(Math.max(0.001, 1 - t));
        orb.position.y = orb.userData.baseY + t * 0.9;
        orb.rotation.y += dt * 14;
        orb.visible = t < 1;
        return;
      }
      orb.position.y = orb.userData.baseY + Math.sin(now / 420 + orb.userData.phase) * 0.09;
      orb.rotation.y = now / 500 + orb.userData.phase;
    });
    // Cheering crowd keeps bouncing.
    this.spectators.forEach((fanAnimator) => fanAnimator.update(now));

    let controlledKin = null;
    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      // Per-player stagger in x and z so runners never sit inside each other,
      // even when sharing a lane at the same distance.
      const spread = (index - (state.players.length - 1) / 2);
      const targetX = laneX(entry.lane) + spread * 0.17;
      const targetZ = entry.progress * SEGMENT + spread * 0.22;
      const prevX = kin.position.x;
      const prevZ = kin.position.z;
      kin.position.x = THREE.MathUtils.lerp(kin.position.x, targetX, frameLerp(0.25, dt));
      kin.position.z = THREE.MathUtils.lerp(kin.position.z, targetZ, frameLerp(0.4, dt));

      // Am Ende reagiert jeder Platz eigen. Vorher lief hier auch nach dem
      // Abpfiff einfach jeder weiter — das war die einzige Szene ganz ohne
      // Schlussreaktion.
      if (minigame.finaleAt) {
        applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
      }

      // Shatter any glass pane this runner passes through.
      this.sliders.forEach((pane) => {
        if (pane.userData.shattered) return;
        if (prevZ < pane.position.z && kin.position.z >= pane.position.z - 0.1
            && Math.abs(kin.position.x - pane.position.x) < LANE_WIDTH * 0.6) {
          this.shatterGlass(pane);
          if (player.id === controlledId) this.shake = Math.max(this.shake, 0.5);
        }
      });

      // Lean into a lane change, and add a little dust every stride.
      const laneVel = kin.position.x - prevX;
      kin.rotation.z = THREE.MathUtils.lerp(kin.rotation.z, -laneVel * 6, frameLerp(0.2, dt));
      if (!entry.finishedAt && Math.random() < frameChance(0.14, dt)) {
        this.bursts.spawn(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.05, kin.position.z - 0.2), ["#e8f0d8", "#ffffff"], { count: 1, speed: 0.5, up: 0.6, size: 0.05, life: 0.4, gravity: 1.5 });
      }

      // React to server events. A crash means a real tumble: stars, skid
      // debris, backwards lean — not just a flash.
      const stumbling = now < (entry.stumbleUntil || 0);
      if ((entry.stumbles || 0) > (this.lastStumbles.get(player.id) || 0)) {
        this.lastStumbles.set(player.id, entry.stumbles);
        animator.trigger("stumble");
        this.bursts.spawn(kin.position.clone(), ["#ffffff", "#ef6673", "#ffd15c"], { count: 12, speed: 2.0, up: 2.2, size: 0.08, life: 0.6 });
        this.bursts.spawn(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.06, kin.position.z - 0.3), ["#c98d4e", "#e8d4a8"], { count: 6, speed: 1.2, up: 0.9, size: 0.06, life: 0.5, gravity: 2, drag: 1.8 });
        this.bursts.ring(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.07, kin.position.z), "#ef6673", { radius: 1.3, life: 0.45, y: FLOOR_Y + 0.07 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1, 0)), "RUMMS!", { color: "#ef6673", size: 0.36, life: 0.8 });
        if (player.id === controlledId) {
          this.shake = 1;
          this.feedback?.sound("collision");
          this.feedback?.vibrate([20, 18, 30]);
        }
      }
      // While tumbling: dizzy stars orbit the head and the kin reels back.
      kin.userData.dizzy.visible = stumbling;
      if (stumbling) {
        kin.userData.dizzy.rotation.y = now / 110;
        kin.rotation.x = THREE.MathUtils.lerp(kin.rotation.x, -0.35, frameLerp(0.25, dt));
        kin.rotation.y = Math.sin(now / 90) * 0.25;
      } else {
        kin.rotation.x = THREE.MathUtils.lerp(kin.rotation.x, 0, frameLerp(0.2, dt));
        kin.rotation.y = THREE.MathUtils.lerp(kin.rotation.y, 0, frameLerp(0.2, dt));
      }
      if (entry.finishedAt && !this.lastFinished.get(player.id)) {
        this.lastFinished.set(player.id, true);
        animator.set("cheer", { base: true });
        this.bursts.spawn(kin.position.clone(), [player.color, "#ffffff", "#ffd15c"], { count: 24, speed: 2.8, up: 3.0, size: 0.1, life: 0.95, drag: 1.2 });
        this.bursts.ring(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.07, kin.position.z), "#ffd15c", { radius: 2, life: 0.65, opacity: 0.6, y: FLOOR_Y + 0.07 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "ZIEL! 🏁", { color: "#ffe36b", size: 0.46, life: 1.2, rise: 1 });
        if (player.id === controlledId) {
          this.feedback?.sound("perfect");
          this.feedback?.vibrate([12, 16, 24]);
        }
      }
      const boosted = now < entry.boostUntil;
      if (boosted) {
        if ((this.lastBoostAt.get(player.id) || 0) < entry.boostUntil - 100) {
          this.lastBoostAt.set(player.id, entry.boostUntil);
          this.bursts.spawn(kin.position.clone(), ["#ffe36b", "#ffffff"], { count: 10, speed: 2.2, up: 1.8, size: 0.08, life: 0.5 });
          if (player.id === controlledId) { this.fovKick = 1; this.feedback?.sound("whoosh"); }
        }
      }
      animator.update(now);
      if (boosted && animator.baseState === "run") kin.userData.body.scale.set(0.88, 1.18, 0.88);

      kin.userData.shadow.position.set(kin.position.x, FLOOR_Y + 0.02, kin.position.z);
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
      if (player.id === controlledId) controlledKin = kin;
    });

    // Thrown pickups: a spiky ball flies straight forward down the lane.
    const activeShotIds = new Set();
    (arcade.shots || []).forEach((shot) => {
      activeShotIds.add(shot.id);
      let mesh = this.shotMeshes.get(shot.id);
      if (!mesh) {
        mesh = new THREE.Group();
        const core = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.28, 0.28),
          new THREE.MeshLambertMaterial({ color: "#ff8b2e", emissive: "#ff8b2e", emissiveIntensity: 0.7 })
        );
        mesh.add(core);
        const spike = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.1, 0.5),
          new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ffd15c", emissiveIntensity: 0.5 })
        );
        mesh.add(spike);
        mesh.userData = { impactPlayed: false };
        this.scene.add(mesh);
        this.shotMeshes.set(shot.id, mesh);
        if (shot.fromId === controlledId) this.feedback?.sound("whoosh");
      }
      // Position from the server head progress (extrapolated by travel time).
      const travelled = ((now - shot.firedAt) / 1000) * (shot.speed || 60);
      const headProgress = shot.resolved && shot.resolvedAt
        ? (shot.fromProgress + ((shot.resolvedAt - shot.firedAt) / 1000) * (shot.speed || 60))
        : shot.fromProgress + travelled;
      const spread = ((this.kins.size ? 0 : 0)); // no stagger needed for shots
      if (!shot.resolved) {
        mesh.visible = true;
        mesh.position.set(laneX(shot.lane) + spread, KIN_Y + 0.3, headProgress * SEGMENT);
        mesh.rotation.z = now / 90;
        if (Math.random() < frameChance(0.4, dt)) {
          this.bursts.spawn(mesh.position.clone(), ["#ffd15c", "#ff8b2e"], { count: 1, speed: 0.4, up: 0.2, size: 0.05, life: 0.3 });
        }
      } else if (!mesh.userData.impactPlayed) {
        mesh.userData.impactPlayed = true;
        mesh.visible = false;
        const impactPos = new THREE.Vector3(laneX(shot.lane), KIN_Y + 0.3, headProgress * SEGMENT);
        this.bursts.spawn(impactPos, ["#ff8b2e", "#ffd15c", "#ffffff"], { count: 14, speed: 2.4, up: 2.2, size: 0.09, life: 0.7 });
        if (shot.hitId === controlledId) {
          this.shake = Math.max(this.shake, 1);
          this.feedback?.sound("impact");
          this.feedback?.vibrate([26, 18, 32]);
        } else if (shot.fromId === controlledId && shot.hitId) {
          this.feedback?.sound("perfect");
        }
      }
    });
    // Drop meshes for shots the server has cleaned up.
    this.shotMeshes.forEach((mesh, id) => {
      if (activeShotIds.has(id)) return;
      this.scene.remove(mesh);
      this.shotMeshes.delete(id);
    });

    // Eine aufgesammelte Stachelkugel wird gefeiert UND in der Hinweiszeile
    // angesagt — ohne Knopf muss der Hinweis sagen, dass jetzt getippt werden
    // kann, sonst weiss man nicht, dass man etwas hat.
    const own = arcade.players[controlledId];
    const hasItem = Boolean(own?.hasItem && !own?.finishedAt);
    if (hasItem && !this.lastHasItem) {
      const ownKin = this.kins.get(controlledId);
      if (ownKin) this.bursts.spawn(ownKin.position.clone(), ["#ff8b2e", "#ffd15c"], { count: 10, speed: 1.8, up: 2, size: 0.08, life: 0.6 });
      this.feedback?.sound("coin");
      this.feedback?.vibrate(14);
    }
    this.lastHasItem = hasItem;
    const hint = this.controls?.querySelector("[data-swipe-hint]");
    if (hint && hasItem !== this.hintShowsItem) {
      this.hintShowsItem = hasItem;
      hint.textContent = hasItem
        ? "💥 Tippen zum Werfen · ◀ Wischen ▶"
        : "◀ Wischen zum Bahnwechsel ▶";
      hint.classList.toggle("has-item", hasItem);
    }

    this.bursts.update(dt);

    this.floaters.update(dt);

    // Idle sway on the roadside scenery.
    this.scenery.forEach((prop) => {
      prop.rotation.z = Math.sin(now / 900 + prop.userData.phase) * prop.userData.sway;
    });

    const focusZ = controlledKin ? controlledKin.position.z : 0;
    const focusX = controlledKin ? controlledKin.position.x : 0;
    this.recycleScenery(focusZ);
    // Hindernisse ausserhalb des Sichtfensters ausblenden. Bei diesem
    // Blickwinkel sieht man gut 22 Streckeneinheiten voraus und drei zurück;
    // alles andere kostet nur Zeichenaufrufe.
    const cull = (part, back, front) => {
      const ahead = part.z - focusZ;
      part.object.visible = ahead > back && ahead < front;
    };
    this.courseParts?.forEach((part) => cull(part, -4 * SEGMENT, 24 * SEGMENT));
    this.spectatorParts?.forEach((part) => cull(part, -6 * SEGMENT, 26 * SEGMENT));

    // Speed streaks rush toward the camera, then recycle ahead of the runner.
    this.streaks.forEach((streak) => {
      streak.position.z -= streak.userData.speed * dt;
      if (streak.position.z < focusZ - 3) {
        streak.position.z = focusZ + 12 + Math.random() * 6;
        streak.position.x = focusX + (Math.random() - 0.5) * 7;
        streak.position.y = 0.3 + Math.random() * 3.2;
      }
    });

    // Chase camera behind the controlled kin, with impact shake + boost FOV kick.
    this.shake *= frameDecay(0.88, dt);
    this.fovKick *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 18) * this.shake * 0.16 * shakeScale();
    const shakeY = Math.cos(now / 15) * this.shake * 0.1;
    const desired = new THREE.Vector3(focusX * 0.35 + shakeX, this.baseCamera.y + shakeY, focusZ + this.baseCamera.z);
    this.camera.position.lerp(desired, frameLerp(0.16, dt));
    this.camera.lookAt(focusX * 0.2, KIN_Y + 0.4, focusZ + 4.5);
    const targetFov = this.fov + this.fovKick * 9;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, frameLerp(0.2, dt));
      this.camera.updateProjectionMatrix();
    }

    this.updateHud(minigame, state, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const arcade = minigame.arcade;
    const controlled = arcade?.players?.[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    const meters = controlled?.finishedAt ? "Ziel!" : `${Math.round(controlled?.progress || 0)}m`;
    this.hud.querySelector("[data-kinetic-score]").textContent = meters;

    // The 3-2-1 countdown is shown once by the shared intro card, not here.
    const countdown = this.hud.querySelector("[data-kinetic-countdown]");
    if (countdown) countdown.hidden = true;
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamera = portrait ? new THREE.Vector3(0, 4.2, -6.6) : new THREE.Vector3(0, 3.4, -6.0);
      this.fov = portrait ? 58 : 48;
      camera.fov = this.fov;
    });
  }
}
