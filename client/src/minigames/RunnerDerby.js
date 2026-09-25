import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createKin, KinAnimator, KIN_SOLE, standOn } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Zielgerade: drei Bahnen, Hürden, Sand und Tempofelder. Wischen wechselt die
// Bahn, nach oben springt, nach unten wirft man etwas auf den Vordermann.
//
// Vorher schaute die Kamera von hinten auf vier Rücken im Dauerlauf, eine
// Hürde vorn im Bild verdeckte das halbe Feld, und ein Angriff war nur eine
// Zahl, die kleiner wurde. Jetzt läuft die Kamera leicht seitlich versetzt
// mit, man sieht Sprint, Sprung, den Wurf nach vorn, den Purzelbaum nach
// einer Hürde samt Sternchen, und im Ziel dreht man sich jubelnd um.
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
const SURFACE_COLOUR = { sand: "#a97a42", normal: "#f4d98c", tempo: "#9b7bff" };
const FLOOR_Y = 0;                  // Oberkante der Laufbahn
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

function frac(v) {
  const x = Math.sin(v * 12.9898) * 43758.5453;
  return x - Math.floor(x);
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
    this.throws = [];
    this.swipe = null;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Zielgerade",
      background: "#8fd8f2",
      fog: ["#9fdef5", 18, 48],
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
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.set(0, FLOOR_Y - 0.31, trackZ / 2);
    meadow.receiveShadow = true;
    scene.add(meadow);

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
      scene.add(hill);
    }

    // Die Bahn IST das Spiel: jeder Abschnitt gibt den drei Bahnen einen Belag,
    // und den muss man von weitem lesen können. Ein durchgehend sandfarbener
    // Streifen je Bahn wäre hier eine Lüge — er würde behaupten, alle drei
    // seien gleich.
    //
    // Ein Grundband je Bahn (damit unter den Belägen nie eine Lücke klafft),
    // darüber je Belagsorte eine Instanz. Drei Zeichenaufrufe für die ganzen
    // sechzig Felder.
    for (let lane = 0; lane < 3; lane += 1) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.04, 0.3, trackZ + 8),
        new THREE.MeshLambertMaterial({ color: SURFACE_COLOUR.normal })
      );
      strip.position.set(laneX(lane), FLOOR_Y - 0.15, trackZ / 2);
      strip.receiveShadow = true;
      scene.add(strip);
    }
    const segLen = (arcade.segLen || 7.5) * SEGMENT;
    const felder = { tempo: [], sand: [] };
    (arcade.segments || []).forEach((segment) => {
      segment.lanes.forEach((belag, lane) => {
        if (belag === "normal") return;
        felder[belag].push({ lane, z: (segment.at + (arcade.segLen || 7.5) / 2) * SEGMENT });
      });
    });
    Object.entries(felder).forEach(([belag, liste]) => {
      if (liste.length === 0) return;
      const feld = new THREE.InstancedMesh(
        new THREE.BoxGeometry(LANE_WIDTH - 0.1, 0.06, segLen - 0.12),
        new THREE.MeshLambertMaterial({ color: SURFACE_COLOUR[belag] }),
        liste.length
      );
      const platz = new THREE.Object3D();
      liste.forEach((eintrag, i) => {
        platz.position.set(laneX(eintrag.lane), FLOOR_Y + 0.02, eintrag.z);
        platz.updateMatrix();
        feld.setMatrixAt(i, platz.matrix);
      });
      feld.instanceMatrix.needsUpdate = true;
      feld.receiveShadow = true;
      scene.add(feld);
    });
    // Pfeile auf den Tempofeldern: die Farbe sagt "schnell", die Pfeile sagen
    // "in diese Richtung" — und sie sind auch dann noch zu erkennen, wenn die
    // Bahn im Dunst liegt.
    if (felder.tempo.length) {
      const pfeile = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.16, 0.03, 0.42),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, depthWrite: false }),
        felder.tempo.length * 3
      );
      const platz = new THREE.Object3D();
      let k = 0;
      felder.tempo.forEach((eintrag) => {
        for (let n = -1; n <= 1; n += 1) {
          platz.position.set(laneX(eintrag.lane), FLOOR_Y + 0.06, eintrag.z + n * segLen * 0.28);
          platz.updateMatrix();
          pfeile.setMatrixAt(k, platz.matrix);
          k += 1;
        }
      });
      pfeile.instanceMatrix.needsUpdate = true;
      scene.add(pfeile);
    }
    // Dirt shoulders framing the course.
    [-1, 1].forEach((side) => {
      const shoulder = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.34, trackZ + 8),
        new THREE.MeshLambertMaterial({ color: "#6cb95c" })
      );
      shoulder.position.set(side * (LANE_WIDTH * 1.5 + 0.15), FLOOR_Y - 0.16, trackZ / 2);
      scene.add(shoulder);
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
        scene.add(post);
      });
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_WIDTH * 3.8 + 0.6, 0.32, 0.32),
        new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.15 })
      );
      beam.position.set(0, FLOOR_Y + 2.55, z);
      scene.add(beam);
    }

    // A little cheering crowd along the course.
    const crowdColors = ["#ff8b2e", "#8f6ae0", "#2ec4b6", "#f45b9d", "#8bc34a", "#5c9dff"];
    for (let i = 0; i < 8; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const fan = createKin(crowdColors[i % crowdColors.length], i);
      fan.scale.setScalar(FAN_SCALE);
      fan.position.set(side * (LANE_WIDTH * 2.55 + frac(i * 3.3) * 0.5), FAN_Y, 6 + i * (trackZ / 9));
      fan.rotation.y = -side * Math.PI / 2;
      scene.add(fan);
      // Auch die Zuschauer wandern mit: sie stehen fest an der Strecke, und
      // acht Figuren zu je einem Dutzend Körpern sind der letzte grosse Posten.
      this.spectatorParts.push({ object: fan, z: fan.position.z });
      const fanAnimator = new KinAnimator(fan);
      fanAnimator.groundY = FAN_Y;
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
      scene.add(rung);
      this.rungs.push(rung);
    }

    // Finish line.
    const finish = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH * 3.2, 0.06, 0.5),
      new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#ffd15c", emissiveIntensity: 0.4 })
    );
    finish.position.set(0, FLOOR_Y + 0.02, trackZ);
    scene.add(finish);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.6, 0.2), new THREE.MeshLambertMaterial({ color: "#ef6673" }));
      post.position.set(side * LANE_WIDTH * 1.7, FLOOR_Y + 0.8, trackZ);
      post.castShadow = true;
      scene.add(post);
    });

    // Hürden aus dem geteilten Kurs. Sie sind kein Zufallspech mehr, sondern
    // der Grund, an dieser Stelle NICHT zu sprinten: wer sprintet, kann nicht
    // ausweichen.
    //
    // Alles bekommt zusätzlich einen Eintrag in `courseParts`: weit entfernte
    // Hürden werden im Bild ausgeblendet. three.js überspringt unsichtbare
    // Objekte beim Zeichnen, das spart also echte Zeichenaufrufe — und man
    // sieht ohnehin nie mehr als ein paar Meter Strecke.
    this.courseParts = [];
    const partOf = (object, z) => { this.courseParts.push({ object, z }); return object; };
    (arcade.segments || []).forEach((segment) => {
      if (segment.hurdle === null || segment.hurdle === undefined) return;
      const z = segment.hurdleAt * SEGMENT;
      scene.add(partOf(this.makeHurdle(laneX(segment.hurdle), z, "#ef6673"), z));
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
    });
  }

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

  shot() {
    return {
      look: [0, 0.9, 2],
      frame: { w: 4.4, h: 3 },
      yaw: Math.PI - 0.2,
      pitch: 0.3,
      fov: 40,
      ease: 0.14,
      intro: { yaw: -0.8, pitch: 0.2, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="runner-lane-controls">
        <p class="runner-swipe-hint" data-swipe-hint>◀ Wischen ▶ · ⬆ Springen · ⬇ Angriff</p>
      </div>`;
    this.swipeHint = this.controls.querySelector("[data-swipe-hint]");
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
    
    if (Math.abs(dx) < 26 && Math.abs(dy) < 26) {
       this.sendInput({ action: "attack" }).catch(() => {});
       return;
    }
    
    if (Math.abs(dx) > Math.abs(dy)) {
       this.sendLane(dx > 0 ? 1 : -1);
    } else {
       if (dy < 0) {
          this.feedback?.sound("pop");
          this.sendInput({ action: "jump" }).catch(() => {});
       } else {
          this.feedback?.sound("move");
          this.sendInput({ action: "attack" }).catch(() => {});
       }
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
    let ownKin = null;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const spread = index - (players.length - 1) / 2;
      const targetX = laneX(entry.lane) + spread * 0.3;
      const targetZ = entry.progress * SEGMENT + spread * 0.3;
      const prevX = kin.position.x;
      kin.position.x += (targetX - kin.position.x) * frameLerp(0.25, dt);
      kin.position.z += (targetZ - kin.position.z) * frameLerp(0.4, dt);
      const laneVel = kin.position.x - prevX;
      kin.rotation.z += (-laneVel * 6 - kin.rotation.z) * frameLerp(0.2, dt);
      const finished = Boolean(entry.finishedAt);
      const stumbling = now < (entry.stumbleUntil || 0);
      const jumping = now < (entry.jumpUntil || 0);

      if (!finished && Math.random() < frameChance(0.14, dt)) {
        this.burst(new THREE.Vector3(kin.position.x, FLOOR_Y + 0.05, kin.position.z - 0.2), ["#e8f0d8", "#ffffff"], { count: 1, speed: 0.5, up: 0.6, size: 0.05, life: 0.4, gravity: 1.5 });
      }
      if ((entry.stumbles || 0) > (this.lastStumbles.get(player.id) || 0)) {
        this.lastStumbles.set(player.id, entry.stumbles);
        animator.trigger("tumble");
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
          const ball = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.3 }));
          ball.position.copy(kin.position).add(new THREE.Vector3(0, 0.6, 0.2));
          this.scene.add(ball);
          this.throws.push({ mesh: ball, from: ball.position.clone(), at: now });
          if (isOwn) this.feedback?.sound("whoosh");
        }
      }
      kin.userData.dizzy.visible = stumbling;
      kin.userData.dizzy.rotation.y = now / 200;
      animator.groundY = standOn(FLOOR_Y) + (jumping ? Math.sin((Math.max(0, entry.jumpUntil - now) / 650) * Math.PI) * 1.4 : 0);

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
      } else if (entry.sprintingNow) {
        animator.set("sprint");
        animator.rate = 0.9;
        animator.expression("effort", 150);
      } else {
        animator.set("run");
        animator.rate = Math.max(0.6, Math.min(1.8, (entry.speed || 5.2) / 5.2));
      }
      if (entry.surface === "sand") animator.expression("effort", 150);
    });

    // Würfe fliegen ein Stück nach vorn und zerplatzen.
    this.throws = this.throws.filter((shot) => {
      const u = (now - shot.at) / 450;
      if (u >= 1) {
        this.burst(shot.mesh.position.clone(), [shot.mesh.material.color.getStyle(), "#ffffff"], { count: 8, speed: 1.6, up: 1.2, size: 0.06, life: 0.4 });
        this.scene.remove(shot.mesh);
        return false;
      }
      shot.mesh.position.copy(shot.from).add(new THREE.Vector3(0, Math.sin(u * Math.PI) * 0.6, u * 5));
      shot.mesh.rotation.x += dt * 12;
      return true;
    });

    const own = arcade.players[controlledId];
    const belag = own?.surface || "normal";
    if (belag !== this.letzterBelag) {
      const vorher = this.letzterBelag;
      this.letzterBelag = belag;
      if (ownKin && vorher !== undefined && !own?.finishedAt) {
        if (belag === "tempo") {
          this.pop(ownKin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "TEMPO!", { color: "#b9a2ff", size: 0.34, life: 0.75 });
          this.feedback?.sound("coin");
        } else if (belag === "sand") {
          this.pop(ownKin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "SAND", { color: "#c99a5e", size: 0.3, life: 0.7 });
          this.feedback?.sound("clack");
        }
      }
    }
    const sprintet = Boolean(own?.sprintingNow);
    if (sprintet !== this.warAmSprinten) {
      this.warAmSprinten = sprintet;
      this.feedback?.vibrate(sprintet ? 14 : 8);
    }

    this.scenery.forEach((prop) => {
      prop.rotation.z = Math.sin(now / 900 + prop.userData.phase) * prop.userData.sway;
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
    const streakSpeed = sprintet ? 1.7 : 1;
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
    const sprint = f.arcade?.players?.[f.controlledId]?.sprintingNow;
    return {
      look: [this.focus.x * 0.3, 0.9, this.focus.z + 1.8],
      frame: sprint ? { w: 4.8, h: 3.2 } : undefined
    };
  }

  drawHud(f) {
    const { arcade, controlledId } = f;
    const controlled = arcade?.players?.[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = controlled?.finishedAt ? "Ziel!" : `${Math.round(controlled?.progress || 0)}m`;
    if (this.swipeHint) {
      const uebrig = controlled?.attacksLeft;
      const pfeile = uebrig === undefined ? "" : ` (${"⬇".repeat(Math.max(0, uebrig)) || "—"})`;
      const hinweis = `◀ Wischen ▶ · ⬆ Springen · ⬇ Angriff${pfeile}`;
      if (this.letzterHinweis !== hinweis) {
        this.letzterHinweis = hinweis;
        this.swipeHint.textContent = hinweis;
      }
    }
  }
}
