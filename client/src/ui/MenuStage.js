import * as THREE from "/vendor/three/three.module.js";
import {
  createKin,
  KinAnimator,
  createNameLabel,
  createShadowBlob,
  createCloud,
  CubeBurst,
  standOn,
  setKinOpacity,
  finalePose,
  noise
} from "../minigames/VoxelKit.js?v=tumblekin200";
import { qualityTier, prefersReducedMotion, frameLerp } from "../minigames/Quality.js?v=tumblekin200";
import { entflechteSchilder } from "../minigames/SceneKit.js?v=tumblekin200";

// Die Bühne hinter den Menüs.
//
// Vorher tauchten die Figuren ausserhalb der Minispiele nur als flache Icons
// in Listen auf. Jetzt stehen sie auf einer schwebenden Insel: in der Lobby die
// echten Spieler (wer beitritt, plumpst herein), nach jedem Spiel auf dem
// Podest, am Ende bei der Siegerehrung. Dieselbe Figur, dieselben Bewegungen
// wie im Spiel — die Menüs gehören zur Welt, statt davor zu liegen.
//
// Die Bühne füllt den ganzen Bildschirm hinter der Oberfläche. Wo die Figuren
// erscheinen, sagt `setFocus`: das Band, das die Karten unten frei lassen. Die
// Kamera verschiebt ihr Bildzentrum dorthin, statt dass das Bild beschnitten
// würde.

const GROUND = 0;
const PODIUM = [
  { place: 1, x: 0, h: 0.72, color: "#ffd24a" },
  { place: 2, x: -1.02, h: 0.46, color: "#dfe7ef" },
  { place: 3, x: 1.02, h: 0.28, color: "#e7a86a" }
];
// Breite einer Stufe und Abstand der Figuren darauf. Teilen sich mehrere einen
// Platz, wird die Stufe breiter und die Nachbarstufen rücken zur Seite — vorher
// standen zwei Figuren nur ±0.22 auseinander auf einem 0.9 breiten Block und
// steckten ineinander, eine dritte fiel ganz vom Podest.
const STEP_W = 0.9;
const STEP_SLOT = 0.66;
const STEP_GAP = 0.12;
const STEP_DEPTH = 0.8;
const STEP_Z = -0.25;

function stepWidth(count) {
  return Math.max(STEP_W, count * STEP_SLOT + 0.24);
}

// Wo die drei Stufen stehen, wenn auf ihnen `counts[place]` Figuren stehen.
function podiumLayout(counts = {}) {
  const w1 = stepWidth(counts[1] || 1);
  const w2 = stepWidth(counts[2] || 1);
  const w3 = stepWidth(counts[3] || 1);
  const x2 = -(w1 / 2 + STEP_GAP + w2 / 2);
  const x3 = w1 / 2 + STEP_GAP + w3 / 2;
  return {
    1: { x: 0, w: w1 },
    2: { x: x2, w: w2 },
    3: { x: x3, w: w3 },
    left: x2 - w2 / 2,
    right: x3 + w3 / 2
  };
}
const COLORS = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"];

// Aufstellung für n Figuren: versetzt in zwei Reihen statt in einer langen
// Linie. Auf einem hochkanten Handy ist das Band über der Karte schmal; vier
// Figuren nebeneinander wurden dort zu Punkten.
function lineup(count) {
  const layouts = {
    1: [[0, 0.4]],
    2: [[-0.55, 0.4], [0.55, 0.4]],
    3: [[-0.92, 0.2], [0, 0.6], [0.92, 0.2]],
    4: [[-1.12, 0.15], [-0.38, 0.62], [0.38, 0.62], [1.12, 0.15]]
  };
  return layouts[Math.max(1, Math.min(4, count))];
}

export function kinVariantFor(color, fallback = 0) {
  const index = COLORS.indexOf(color);
  return index >= 0 ? index : fallback;
}

export class MenuStage {
  constructor(host) {
    this.host = host;
    this.active = false;
    this.mode = "start";
    this.members = new Map();
    this.focus = { top: 0, bottom: window.innerHeight };
    this.lastFrame = performance.now();
    this.reduced = prefersReducedMotion();
    this.camPos = new THREE.Vector3(0, 3.2, 9);
    this.camLook = new THREE.Vector3(0, 0.6, 0);
    this.shot = { look: new THREE.Vector3(0, 0.6, 0), size: { w: 4.4, h: 2.2 }, pitch: 0.24, yaw: 0, orbit: 0 };
    this.confetti = 0;
    this.build();
    this.frame = null;
  }

  build() {
    const canvas = document.createElement("canvas");
    canvas.className = "menu-stage";
    canvas.setAttribute("aria-hidden", "true");
    this.host.prepend(canvas);
    this.canvas = canvas;

    const low = qualityTier() === "low";
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#8fd6f2");
    scene.fog = new THREE.Fog("#a9e1f5", 16, 42);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);

    scene.add(new THREE.HemisphereLight(0xeaf7ff, 0x86c39a, 2.4));
    const sun = new THREE.DirectionalLight(0xfff0cf, 2.9);
    sun.position.set(-4, 9, 7);
    sun.castShadow = true;
    const map = low ? 1024 : 2048;
    sun.shadow.mapSize.set(map, map);
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.8);
    fill.position.set(5, 4, -6);
    scene.add(fill);

    this.buildIsland();
    this.buildBackdrop();
    this.buildPodium();
    this.bursts = new CubeBurst(scene);
  }

  // Die Insel: Grasdeckel, Erdkante, ein hängender Felszapfen darunter.
  buildIsland() {
    const island = new THREE.Group();
    this.island = island;
    this.scene.add(island);
    const grass = new THREE.MeshLambertMaterial({ color: "#7fd06b" });
    const grassLight = new THREE.MeshLambertMaterial({ color: "#96dd7f" });
    const earth = new THREE.MeshLambertMaterial({ color: "#b98457" });
    const earthDark = new THREE.MeshLambertMaterial({ color: "#8f623d" });
    const stone = new THREE.MeshLambertMaterial({ color: "#9aa4ad" });

    const top = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.34, 4.4), grass);
    top.position.y = GROUND - 0.17;
    top.receiveShadow = true;
    island.add(top);
    // Abgerundete Ecken aus kleineren Klötzen — eine glatte Platte sah aus wie
    // ein Tisch, nicht wie ein Stück Land.
    [[-3.3, 1], [3.3, 1]].forEach(([x]) => {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 3.4), grass);
      cap.position.set(x + Math.sign(x) * 0.2, GROUND - 0.17, 0);
      cap.receiveShadow = true;
      island.add(cap);
    });
    const lip = new THREE.Mesh(new THREE.BoxGeometry(6.9, 0.5, 4.2), earth);
    lip.position.y = GROUND - 0.55;
    island.add(lip);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.6, 3.4), earthDark);
    mid.position.y = GROUND - 1.05;
    island.add(mid);
    [[0, -1.6, 4.2, 2.6], [0.4, -2.15, 2.6, 1.8], [-0.2, -2.6, 1.3, 1.0]].forEach(([x, y, w, d]) => {
      const rock = new THREE.Mesh(new THREE.BoxGeometry(w, 0.55, d), stone);
      rock.position.set(x, y, 0);
      island.add(rock);
    });

    // Grasflecken auf dem Deckel geben der Fläche Struktur.
    for (let i = 0; i < 10; i += 1) {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(0.6 + noise(i * 3) * 1.1, 0.02, 0.4 + noise(i * 7) * 0.7), grassLight);
      patch.position.set((noise(i * 11) - 0.5) * 5.6, GROUND + 0.005, (noise(i * 13) - 0.5) * 3.6);
      patch.rotation.y = noise(i * 17) * Math.PI;
      patch.receiveShadow = true;
      island.add(patch);
    }

    // Randbepflanzung: Büsche, Blumen, zwei Laternen.
    const bush = new THREE.MeshLambertMaterial({ color: "#4fae5c" });
    [[-2.9, -1.6], [2.8, -1.7], [-3.0, 1.2], [3.0, 1.1], [-1.9, -1.9], [2.0, -1.95]].forEach(([x, z], i) => {
      const size = 0.35 + noise(i * 5) * 0.25;
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), bush);
      b.position.set(x, GROUND + size * 0.6, z);
      b.castShadow = true;
      island.add(b);
    });
    const petals = ["#ffd15c", "#ff8fb1", "#ffffff", "#b98cff"];
    for (let i = 0; i < 22; i += 1) {
      const flower = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.09),
        new THREE.MeshLambertMaterial({ color: petals[i % petals.length] })
      );
      const edge = i % 2 === 0 ? 1 : -1;
      flower.position.set((noise(i * 19) - 0.5) * 6, GROUND + 0.06, edge * (1.75 + noise(i * 23) * 0.35));
      island.add(flower);
    }
    this.lanterns = [];
    [-2.6, 2.6].forEach((x) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), new THREE.MeshLambertMaterial({ color: "#7a5330" }));
      post.position.set(x, GROUND + 0.5, 1.55);
      post.castShadow = true;
      island.add(post);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.22, 0.2),
        new THREE.MeshLambertMaterial({ color: "#ffe08a", emissive: "#ffb52e", emissiveIntensity: 0.6 })
      );
      lamp.position.set(x, GROUND + 1.08, 1.55);
      island.add(lamp);
      this.lanterns.push(lamp);
    });

    // Der Wimpelbogen: zwei Pfosten und eine durchhängende Leine bunter Fähnchen.
    const poleMat = new THREE.MeshLambertMaterial({ color: "#f4efe4" });
    [-2.7, 2.7].forEach((x) => {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 0.12), poleMat);
      pole.position.set(x, GROUND + 1.15, -1.6);
      pole.castShadow = true;
      island.add(pole);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: "#ffd24a" }));
      cap.position.set(x, GROUND + 2.35, -1.6);
      island.add(cap);
    });
    this.flags = [];
    const flagColors = ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#b98cff", "#ff9a4d"];
    const count = 15;
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const x = -2.6 + t * 5.2;
      const y = GROUND + 2.2 - Math.sin(t * Math.PI) * 0.45;
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(0.13, 0.3, 3),
        new THREE.MeshLambertMaterial({ color: flagColors[i % flagColors.length] })
      );
      flag.rotation.x = Math.PI;
      flag.position.set(x, y - 0.15, -1.6);
      flag.userData.phase = i * 0.7;
      island.add(flag);
      this.flags.push(flag);
    }
  }

  buildBackdrop() {
    this.clouds = [];
    [[-7, 3.6, -10, 1.6], [6.5, 4.4, -12, 2], [-2, 5.4, -16, 2.4], [10, 2.4, -8, 1.4], [-11, 2.8, -14, 1.8]].forEach(([x, y, z, s], i) => {
      const cloud = createCloud(i + 2);
      cloud.position.set(x, y, z);
      cloud.scale.setScalar(s);
      cloud.userData.baseX = x;
      this.scene.add(cloud);
      this.clouds.push(cloud);
    });
    // Kleine Nachbarinseln in der Ferne: die Welt hört nicht an der Bühne auf.
    const mini = (x, y, z, s, color) => {
      const g = new THREE.Group();
      const topMat = new THREE.MeshLambertMaterial({ color });
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 1.0), topMat);
      g.add(top);
      const under = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.9, 5), new THREE.MeshLambertMaterial({ color: "#a37752" }));
      under.rotation.x = Math.PI;
      under.position.y = -0.55;
      g.add(under);
      const tree = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 6), new THREE.MeshLambertMaterial({ color: "#3f8f45" }));
      tree.position.set(0.3, 0.45, 0);
      g.add(tree);
      g.position.set(x, y, z);
      g.scale.setScalar(s);
      g.userData.baseY = y;
      this.scene.add(g);
      return g;
    };
    this.minis = [mini(-8.5, 0.6, -9, 1.3, "#8fd67a"), mini(9, 1.4, -11, 1.1, "#a5e08c"), mini(4.5, -1.6, -14, 1.6, "#7fcf6c")];
  }

  buildPodium() {
    this.podium = PODIUM.map((spec) => {
      const group = new THREE.Group();
      // Einheitswürfel: Breite und Höhe kommen aus der Skalierung der Gruppe.
      const block = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, STEP_DEPTH),
        new THREE.MeshLambertMaterial({ color: spec.color })
      );
      block.position.y = 0.5;
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
      group.position.set(spec.x, GROUND, STEP_Z);
      group.scale.set(STEP_W, 0.001, 1);
      group.visible = false;
      // Die Zahl klebt als flache Tafel auf der Vorderseite, nicht als
      // Billboard: das kippte mit dem Blickwinkel halb in den Block, und auf
      // der niedrigen Bronzestufe ragte es oben und unten heraus. Sie hängt
      // direkt in der Szene, damit die Skalierung der Stufe sie nicht verzerrt.
      const label = makeNumberPlate(String(spec.place));
      label.visible = false;
      this.scene.add(label);
      group.userData = { spec, block, label, height: 0, x: spec.x, width: STEP_W, targetX: spec.x, targetW: STEP_W };
      this.scene.add(group);
      return group;
    });
  }

  setActive(active) {
    if (this.active === active) return;
    this.active = active;
    this.canvas.hidden = !active;
    if (active) {
      this.lastFrame = performance.now();
      this.loop();
    } else {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  // Das freie Band (CSS-Pixel), in dem die Figuren erscheinen sollen.
  // Auf breiten Bildschirmen auch die Breite: dort steht die Karte rechts.
  setFocus(top, bottom, left = 0, right = window.innerWidth) {
    this.focus = {
      top: Math.max(0, top),
      bottom: Math.max(top + 60, bottom),
      left: Math.max(0, left),
      right: Math.max(left + 60, right)
    };
  }

  // --- Besetzung ------------------------------------------------------------

  member(player, index) {
    let entry = this.members.get(player.id);
    if (!entry) {
      const kin = createKin(player.color, kinVariantFor(player.color, index));
      const label = createNameLabel(shortName(player.name), player.color);
      label.position.y = 0.74;
      kin.add(label);
      const shadow = createShadowBlob(0.52);
      this.scene.add(shadow);
      this.scene.add(kin);
      const animator = new KinAnimator(kin);
      entry = {
        id: player.id,
        kin,
        label,
        shadow,
        animator,
        name: player.name,
        color: player.color,
        pos: new THREE.Vector3(0, 0, 0.3),
        target: new THREE.Vector3(0, 0, 0.3),
        standY: GROUND,
        facing: 0,
        mood: "idle",
        leaving: false
      };
      this.members.set(player.id, entry);
      entry.fresh = true;
    }
    if (entry.name !== player.name) {
      entry.name = player.name;
      entry.kin.remove(entry.label);
      entry.label.material.map?.dispose();
      entry.label.material.dispose();
      entry.label = createNameLabel(shortName(player.name), player.color);
      entry.label.position.y = 0.74;
      entry.kin.add(entry.label);
    }
    entry.leaving = false;
    return entry;
  }

  // Nicht mehr gebrauchte Figuren gehen ab (und werden dann entfernt).
  prune(keepIds) {
    this.members.forEach((entry, id) => {
      if (keepIds.has(id) || entry.leaving) return;
      entry.leaving = true;
      entry.leaveAt = performance.now();
      entry.animator.trigger("spin");
    });
  }

  removeMember(entry) {
    this.scene.remove(entry.kin);
    this.scene.remove(entry.shadow);
    entry.shadow.geometry.dispose();
    entry.shadow.material.dispose();
    entry.kin.traverse((object) => {
      object.geometry?.dispose?.();
      if (object.material && object.material !== entry.kin.userData.material) {
        object.material.map?.dispose?.();
        object.material.dispose?.();
      }
    });
    entry.kin.userData.material?.dispose?.();
    this.members.delete(entry.id);
  }

  // --- Auftritte --------------------------------------------------------------

  showStart() {
    this.mode = "start";
    const demo = [
      { id: "demo-0", name: "Nova", color: COLORS[0] },
      { id: "demo-1", name: "Pix", color: COLORS[1] },
      { id: "demo-2", name: "Sol", color: COLORS[2] },
      { id: "demo-3", name: "Mo", color: COLORS[3] }
    ];
    const keep = new Set(demo.map((player) => player.id));
    this.prune(keep);
    const moods = ["dance", "wave", "dance", "cheer"];
    const spots = lineup(4);
    demo.forEach((player, index) => {
      const entry = this.member(player, index);
      entry.label.visible = false;
      entry.target.set(spots[index][0], 0, spots[index][1]);
      entry.standY = GROUND;
      entry.mood = moods[index];
      entry.opacity = 1;
      this.arrive(entry, index * 0.15);
    });
    this.setPodium(0);
    this.setShot({ look: [0, 0.45, 0.35], w: 3.3, h: 1.6, pitch: 0.2, orbit: 0.06 });
  }

  showLobby(players, hostId, maxPlayers = 4) {
    this.mode = "lobby";
    const keep = new Set(players.map((player) => player.id));
    this.prune(keep);
    const count = Math.max(players.length, 1);
    const spots = lineup(count);
    players.forEach((player, index) => {
      const entry = this.member(player, index);
      entry.label.visible = true;
      entry.target.set(spots[index][0], 0, spots[index][1]);
      entry.standY = GROUND;
      entry.opacity = player.connected === false ? 0.45 : 1;
      entry.mood = player.connected === false ? "sad" : (player.id === hostId ? "wave" : "idle");
      this.arrive(entry, index * 0.12);
    });
    this.freeSlots = Math.max(0, maxPlayers - players.length);
    this.setPodium(0);
    const width = Math.max(1.6, Math.abs(spots[0][0]) * 2 + 0.9);
    this.setShot({ look: [0, 0.5, 0.4], w: width, h: 1.35, pitch: 0.2, orbit: 0 });
  }

  // Podest nach der Platzierung dieser Runde. `ranking`: [{ playerId, place }].
  showPodium(ranking, players, { final = false } = {}) {
    this.mode = final ? "end" : "result";
    const byId = new Map(players.map((player, index) => [player.id, { player, index }]));
    const keep = new Set(ranking.map((row) => row.playerId).filter((id) => byId.has(id)));
    this.prune(keep);
    const total = players.length;
    // Plätze auf Stufen verteilen; wer sich einen Platz teilt, steht zu zweit.
    const groups = new Map();
    ranking.forEach((row) => {
      if (!byId.has(row.playerId)) return;
      if (!groups.has(row.place)) groups.set(row.place, []);
      groups.get(row.place).push(row.playerId);
    });
    const counts = {};
    groups.forEach((ids, place) => { counts[place] = ids.length; });
    const layout = podiumLayout(counts);
    this.layoutPodium(layout);
    const floor = [];
    groups.forEach((ids, place) => {
      const step = PODIUM.find((spec) => spec.place === place);
      ids.forEach((id, i) => {
        const { player, index } = byId.get(id);
        const entry = this.member(player, index);
        entry.label.visible = true;
        entry.opacity = 1;
        entry.mood = finalePose(place, total).state;
        if (step) {
          // Alle, die sich den Platz teilen, stehen nebeneinander auf DERSELBEN
          // Stufe — mit festem Abstand, die Stufe ist entsprechend breiter.
          const offset = (i - (ids.length - 1) / 2) * STEP_SLOT;
          entry.target.set(layout[place].x + offset, 0, STEP_Z);
          entry.standY = GROUND + step.h;
        } else {
          floor.push(entry);
        }
        this.arrive(entry, (total - place) * 0.18);
      });
    });
    // Wer nicht aufs Podest passt, steht vorn neben den Stufen — nicht weit
    // daneben, sonst müsste die Kamera für einen einzigen Platz zurückweichen.
    floor.forEach((entry, i) => {
      const x = i % 2 === 0 ? layout.right + 0.1 + Math.floor(i / 2) * 0.66 : layout.left - 0.1 - Math.floor(i / 2) * 0.66;
      entry.target.set(x, 0, 0.55);
      entry.standY = GROUND;
    });
    this.setPodium(1);
    if (final) this.confetti = 6;
    const span = Math.max(Math.abs(layout.left), Math.abs(layout.right)) * 2 + (floor.length ? 1.0 : 0.3);
    this.setShot({ look: [0, 0.75, 0.05], w: Math.max(3.4, span), h: 2.0, pitch: 0.18, orbit: final ? 0.16 : 0.04 });
  }

  // Stufen an ihre Plätze schieben (weich, in draw()).
  layoutPodium(layout) {
    this.podium.forEach((group) => {
      const place = group.userData.spec.place;
      group.userData.targetX = layout[place].x;
      group.userData.targetW = layout[place].w;
    });
  }

  // Eine Figur kurz reagieren lassen (Tippen auf sich selbst in der Lobby,
  // jemand meldet sich bereit …).
  react(playerId, state = "hop") {
    const entry = this.members.get(playerId);
    entry?.animator.trigger(state);
  }

  arrive(entry, delay = 0) {
    if (!entry.fresh) return;
    entry.fresh = false;
    // Wer neu ist, fällt von oben herein. In der Lobby heisst das: da ist
    // jemand beigetreten — man sieht es, bevor man die Liste liest.
    entry.pos.copy(entry.target);
    entry.spawnAt = performance.now() + delay * 1000;
    entry.kin.visible = false;
    entry.shadow.visible = false;
  }

  setPodium(visible) {
    this.podiumTarget = visible;
  }

  setShot({ look, w, h, pitch = 0.22, orbit = 0 }) {
    this.shot.look.set(look[0], look[1], look[2]);
    this.shot.size = { w, h };
    this.shot.pitch = pitch;
    this.shot.orbit = orbit;
  }

  // --- Bild ---------------------------------------------------------------------

  loop = () => {
    if (!this.active) return;
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) this.renderer.setSize(width, height, false);
    return { width, height };
  }

  draw() {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const { width, height } = this.resize();
    const t = now / 1000;

    // Podest wächst aus dem Boden oder versinkt — und wird breiter, wenn sich
    // mehrere einen Platz teilen.
    this.podium.forEach((group) => {
      const data = group.userData;
      const spec = data.spec;
      const target = this.podiumTarget ? spec.h : 0;
      const h = data.height + (target - data.height) * frameLerp(0.12, dt);
      data.height = h;
      // Versunkene Stufen gehen auf ihre Grundform zurück.
      const wantX = this.podiumTarget ? data.targetX : spec.x;
      const wantW = this.podiumTarget ? data.targetW : STEP_W;
      data.x += (wantX - data.x) * frameLerp(0.18, dt);
      data.width += (wantW - data.width) * frameLerp(0.18, dt);
      group.visible = h > 0.01;
      group.position.x = data.x;
      group.scale.set(data.width, Math.max(0.001, h), 1);
      // Die Zahl: mittig auf der Vorderseite, nie grösser als die Stufe hoch ist.
      const size = Math.min(0.34, h * 0.78);
      data.label.visible = h > 0.12;
      data.label.scale.set(size, size, 1);
      data.label.position.set(data.x, GROUND + h / 2, STEP_Z + STEP_DEPTH / 2 + 0.004);
    });

    // Figuren: laufen zu ihrem Platz, springen aufs Podest, reagieren.
    this.members.forEach((entry) => {
      const { kin, animator, shadow } = entry;
      if (entry.spawnAt && now >= entry.spawnAt) {
        entry.spawnAt = null;
        kin.visible = true;
        shadow.visible = true;
        animator.trigger("spawn");
      }
      if (!kin.visible) return;
      if (entry.leaving) {
        const age = (now - entry.leaveAt) / 1000;
        kin.position.y += dt * 6 * Math.min(1, age * 2);
        kin.scale.setScalar(Math.max(0.01, 1 - age * 1.6));
        if (age > 0.65) this.removeMember(entry);
        return;
      }
      const toTarget = new THREE.Vector3().subVectors(entry.target, entry.pos);
      toTarget.y = 0;
      const distance = toTarget.length();
      const moving = distance > 0.04;
      if (moving) {
        const step = Math.min(distance, dt * 2.6);
        entry.pos.addScaledVector(toTarget.normalize(), step);
        entry.facing = Math.atan2(toTarget.x, toTarget.z);
        animator.set("run");
        animator.rate = 1.1;
      } else {
        entry.facing += (0 - entry.facing) * frameLerp(0.12, dt);
        animator.rate = 1;
        animator.set(entry.mood || "idle");
      }
      // Auf die Stufe: die Standhöhe folgt, sobald man darüber ist.
      const onStep = !moving || distance < 0.5;
      const standY = onStep ? entry.standY : GROUND;
      entry.curY = entry.curY === undefined ? standY : entry.curY + (standY - entry.curY) * frameLerp(0.25, dt);
      animator.groundY = standOn(entry.curY);
      kin.position.x = entry.pos.x;
      kin.position.z = entry.pos.z;
      kin.rotation.y = entry.facing;
      animator.update(now);
      shadow.position.set(kin.position.x, entry.curY + 0.012, kin.position.z);
      const lift = kin.position.y - animator.groundY;
      shadow.scale.setScalar(Math.max(0.4, 1 - lift * 0.6));
      shadow.material.opacity = Math.max(0.06, 0.26 - lift * 0.15);
      setKinOpacity(kin, entry.opacity ?? 1);
    });

    // Konfetti bei der Siegerehrung.
    if (this.confetti > 0) {
      this.confetti -= dt;
      if (Math.random() < dt * 14) {
        const at = new THREE.Vector3((Math.random() - 0.5) * 4, 3.4, (Math.random() - 0.5) * 1.5);
        this.bursts.spawn(at, ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#ffffff"], { count: 6, speed: 1.2, up: 0.3, gravity: 2.2, life: 2.2, size: 0.07, drag: 0.6 });
      }
    }
    this.bursts.update(dt);

    // Kulisse lebt: Wolken ziehen, Wimpel flattern, Laternen glimmen.
    this.clouds.forEach((cloud, i) => {
      cloud.position.x = cloud.userData.baseX + Math.sin(t * 0.05 + i) * 1.2;
    });
    this.minis.forEach((mini, i) => {
      mini.position.y = mini.userData.baseY + Math.sin(t * 0.6 + i * 1.7) * 0.12;
    });
    this.flags.forEach((flag) => {
      flag.rotation.z = Math.sin(t * 3 + flag.userData.phase) * 0.18;
    });
    this.lanterns.forEach((lamp, i) => {
      lamp.material.emissiveIntensity = 0.5 + Math.sin(t * 2.2 + i) * 0.12;
    });
    this.island.position.y = Math.sin(t * 0.7) * 0.03;

    this.updateCamera(dt, t, width, height);
    // Wer sich einen Platz teilt, steht dicht beisammen — die Schilder werden
    // gestaffelt, sonst liest man zwei Namen übereinander.
    const labels = [];
    this.members.forEach((entry) => { if (entry.label.visible && entry.kin.visible) labels.push(entry.label); });
    entflechteSchilder(labels, this.camera, { grundY: 0.74, stufe: 0.26, naehe: 0.16 });
    this.renderer.render(this.scene, this.camera);
  }

  // Kamera: rahmt die Einstellung ins freie Band und verschiebt das Bildzentrum
  // dorthin. Gerechnet, nicht geschätzt — das Band ist je nach Bildschirm und
  // Karte verschieden hoch.
  updateCamera(dt, t, width, height) {
    const camera = this.camera;
    const band = this.focus;
    const bandH = Math.max(80, band.bottom - band.top);
    const bandW = Math.max(80, Math.min(width, band.right ?? width) - (band.left ?? 0));
    const centerY = (band.top + band.bottom) / 2;
    const centerX = ((band.left ?? 0) + Math.min(width, band.right ?? width)) / 2;
    const fullH = 2 * Math.max(centerY, height - centerY);
    const offsetY = fullH / 2 - centerY;
    const fullW = 2 * Math.max(centerX, width - centerX);
    const offsetX = fullW / 2 - centerX;

    // Das Sichtfeld wird auf das BAND bezogen, nicht auf das virtuelle
    // Gesamtbild. Vorher galt es fürs Ganze — bei einem schmalen Band oben im
    // Hochformat stand die Kamera dadurch 30 bis 40 Einheiten weit weg, mitten
    // im Nebel, und die Figuren waren blasse Punkte.
    const bandAngle = THREE.MathUtils.degToRad(width < height ? 34 : 30);
    const tanBand = Math.tan(bandAngle / 2);
    const fill = 0.86;
    const { w, h } = this.shot.size;
    const byHeight = h / (2 * tanBand * fill);
    const byWidth = (w * bandH) / (2 * tanBand * fill * bandW);
    const distance = Math.max(byHeight, byWidth, 2.8);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanBand * fullH / bandH));

    const orbit = this.reduced ? 0 : this.shot.orbit;
    const yaw = Math.sin(t * 0.25) * orbit;
    const pitch = this.shot.pitch;
    const look = this.shot.look;
    const desired = new THREE.Vector3(
      look.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      look.y + Math.sin(pitch) * distance,
      look.z + Math.cos(yaw) * Math.cos(pitch) * distance
    );
    const k = frameLerp(0.06, dt);
    this.camPos.lerp(desired, k);
    this.camLook.lerp(look, k);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    // Nebel nur für die Ferne: er beginnt hinter der Bühne, egal wie weit die
    // Kamera gerade steht.
    const reach = this.camPos.distanceTo(this.camLook);
    this.scene.fog.near = reach + 6;
    this.scene.fog.far = reach + 30;
    // Das Seitenverhältnis gehört zum GANZEN virtuellen Bild, aus dem der
    // Bildschirm ein Ausschnitt ist — sonst würden die Figuren gestreckt.
    camera.aspect = fullW / fullH;
    camera.setViewOffset(fullW, fullH, offsetX, offsetY, width, height);
    camera.updateProjectionMatrix();
  }

  dispose() {
    this.setActive(false);
    this.members.forEach((entry) => this.removeMember(entry));
    this.bursts.dispose();
    this.scene.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => { material.map?.dispose?.(); material.dispose?.(); });
    });
    this.renderer.dispose();
    this.canvas.remove();
  }
}

// Die Platzzahl als flache Tafel für die Vorderseite einer Stufe.
function makeNumberPlate(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.font = "900 104px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(40, 50, 60, 0.35)";
  ctx.strokeText(text, 64, 70);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
  );
}

function shortName(name) {
  return String(name || "?").replace(/\s+/g, " ").trim().slice(0, 9);
}
