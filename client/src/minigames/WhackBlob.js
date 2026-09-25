import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Blob-Klopfe: aus zwölf Löchern (3 breit, 4 tief — hochkant wie das Handy)
// kommen Blobs, wer zuerst draufhaut, bekommt den Punkt. Die roten mit
// Stacheln tun weh.
//
// Vorher gab es keine Figuren, nur einen Hammer, der aus dem Nichts
// erschien. Jetzt stehen alle mit ihrem Holzhammer an den Ecken des Hügels,
// springen zum Loch, in dem sie getroffen haben, holen über den Kopf aus und
// hauen drauf. Wer einen Stachelblob erwischt, fliegt zurück und sieht
// Sterne.
const CELL = 1.35;
const COLS = 3;
const ROWS = 4;
const HOME = 2.05;
const HOME_Z = (ROWS / 2) * CELL + 0.1;
const MOUND_TOP = 0.3;
// Nach dem Schlag bleibt die Figur so lange am Loch, dann springt sie zurück.
const STAY_MS = 650;

// Ein Sprung dauert mit der Weite etwas länger — der weiteste landet genau im
// Schlag der Hammer-Bewegung (dig schlägt nach knapp 300 ms zu).
function leapMs(from, to) {
  return 170 + Math.hypot(to.x - from.x, to.z - from.z) * 25;
}

export class WhackBlob extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.blobs = new Map();
    this.hitsSeen = new Map();
    this.lastBad = new Map();
    this.swings = new Map();
    this.raycaster = new THREE.Raycaster();
    this.labelY = 0.74;
  }

  stage() {
    return { label: "3D Blob-Klopfe", background: "#a8e2f4", fog: ["#a8e2f4", 16, 40], lights: { shadow: { left: -6, right: 6, top: 6, bottom: -6 } } };
  }

  cellPos(cell) {
    const gx = cell % COLS;
    const gy = Math.floor(cell / COLS);
    return { x: (gx - (COLS - 1) / 2) * CELL, z: (gy - (ROWS - 1) / 2) * CELL };
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    // Kulisse: Bodenflecken, Büschel, Blumen, Steine und ein Baumkranz als
    // Horizont. Ohne sie stösst die Wiese als harte Kante gegen den Himmel.
    dressMeadow(this.scene, { seed: 10, keepOut: { x: 4.4, z: 5.2 }, spread: { x: 16, z: 15 }, grassColor: "#57ab52", patchColors: ["#69bd5f", "#87d276"], crownColor: "#2f7f45", crownColor2: "#4a9c58", flowers: 80 });
    const mound = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * COLS + 0.9, 0.4, CELL * ROWS + 0.9),
      new THREE.MeshLambertMaterial({ color: "#8ad07f" })
    );
    mound.position.y = 0.1;
    mound.receiveShadow = true;
    scene.add(mound);
    // Invisible pick plane spanning the 3x3 field for direct hole taps.
    this.cellPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * COLS + 0.6, CELL * ROWS + 0.6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.cellPlane.rotation.x = -Math.PI / 2;
    this.cellPlane.position.y = 0.34;
    scene.add(this.cellPlane);
    // Echte Erdlöcher statt schwarzer Quadrate.
    //
    // Vorher lag über jeder Zelle eine dunkle Platte — und zwar OBERHALB der
    // Grasnarbe. Damit sah das Feld aus wie neun aufgemalte Kacheln, aus denen
    // dann unvermittelt ein Blob wuchs. Ein Loch braucht drei Dinge: einen
    // Rand, der herausschaut, eine Wand, die nach innen führt, und einen
    // Grund, der dunkel genug ist, dass man nicht hineinsieht.
    const GRAS_Y = 0.3;                  // Oberkante des Hügels
    const schachtMat = new THREE.MeshLambertMaterial({ color: "#4a3826" });
    const grundMat = new THREE.MeshLambertMaterial({ color: "#241a10" });
    const randMat = new THREE.MeshLambertMaterial({ color: "#8a6a45" });
    for (let cell = 0; cell < COLS * ROWS; cell += 1) {
      const pos = this.cellPos(cell);
      // Aufgeworfene Erde rundherum — der Teil, den man von oben zuerst sieht.
      const rand = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.08, 6, 16), randMat);
      rand.rotation.x = Math.PI / 2;
      rand.position.set(pos.x, GRAS_Y + 0.03, pos.z);
      rand.receiveShadow = true;
      scene.add(rand);
      // Der dunkle Grund liegt ÜBER der Grasnarbe, nicht darunter.
      //
      // Naheliegend wäre ein echter Schacht: Wand nach unten, Boden tief drin.
      // Nur ist der Hügel ein massiver Quader — seine Deckfläche verdeckt alles
      // darunter, und im Bild blieben neun Ringe mit Gras darin. Ein Loch von
      // schräg oben ist ohnehin fast nur seine Öffnung: eine dunkle Scheibe
      // knapp über dem Gras, gefasst von aufgeworfener Erde, liest sich als
      // Loch — und der Blob steigt weiterhin von unten durch den Hügel herauf
      // und erscheint genau dort.
      const grund = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), grundMat);
      grund.rotation.x = -Math.PI / 2;
      grund.position.set(pos.x, GRAS_Y + 0.02, pos.z);
      scene.add(grund);
      // Ein zweiter, kleinerer Ring gibt der Öffnung Tiefe, ohne dass ein
      // einziges Dreieck mehr im Boden verschwindet.
      const tiefe = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), schachtMat);
      tiefe.rotation.x = -Math.PI / 2;
      tiefe.position.set(pos.x, GRAS_Y + 0.025, pos.z - 0.06);
      scene.add(tiefe);
    }

    // A picket fence and flowers frame the field so it doesn't float in
    // empty green.
    const fenceMat = new THREE.MeshLambertMaterial({ color: "#e8d8b0" });
    for (let i = -4; i <= 4; i += 1) {
      [-4.1, 4.1].forEach((z) => {
        const picket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.12), fenceMat);
        picket.position.set(i * 0.85, 0.28, z);
        scene.add(picket);
      });
      const rail = i < 4 ? null : new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.1, 0.08), fenceMat);
      if (rail) {
        [-4.1, 4.1].forEach((z) => {
          const bar = rail.clone();
          bar.position.set(0, 0.44, z);
          scene.add(bar);
        });
      }
    }
    const flowerColors = ["#ff8aa0", "#ffd15c", "#8f6ae0", "#5c9dff"];
    [[-3.4, -2.2], [3.5, -1.4], [-3.6, 1.8], [3.3, 2.4], [-2.6, 3.1], [2.4, -3.1]].forEach(([x, z], index) => {
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), new THREE.MeshLambertMaterial({ color: "#4f9b4a" }));
      stem.position.set(x, 0.15, z);
      scene.add(stem);
      const bloom = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshLambertMaterial({ color: flowerColors[index % flowerColors.length] })
      );
      bloom.position.set(x, 0.36, z);
      scene.add(bloom);
    });

    [[-6, 5, -4, 5], [6, 5.6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // A cartoon mallet that swings down on the blob you bonk.
    const homes = [[-HOME, HOME_Z], [HOME, HOME_Z], [-HOME, -HOME_Z], [HOME, -HOME_Z]];
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const [x, z] = homes[index % homes.length];
      const kin = this.addKin(player, index, { x, ground: MOUND_TOP, z, facing: Math.atan2(-x, -z) });
      // Holzhammer in der rechten Hand, Kopf in der Spielerfarbe.
      const mallet = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.46), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
      handle.position.z = 0.2;
      mallet.add(handle);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: player.color }));
      head.position.z = 0.44;
      mallet.add(head);
      mallet.position.set(0, -0.18, 0.02);
      kin.userData.arms?.[1]?.add(mallet);
      this.swings.set(player.id, { home: new THREE.Vector3(x, 0, z), target: null, at: -1e9 });
    });
  }

  buildBlob(kind) {
    const blob = new THREE.Group();
    const color = kind === "bad" ? "#ff2038" : "#8f6ae0";
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.6, 0.62),
      new THREE.MeshLambertMaterial({ color })
    );
    body.castShadow = true;
    blob.add(body);
    [[-0.14, 0.1], [0.14, 0.1]].forEach(([x, y]) => {
      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.12, 0.05),
        new THREE.MeshLambertMaterial({ color: "#1b2530" })
      );
      eye.position.set(x, y, 0.33);
      blob.add(eye);
    });
    if (kind === "bad") {
      [[0, 0.42, 0], [-0.25, 0.36, 0], [0.25, 0.36, 0]].forEach(([x, y, z]) => {
        const spike = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 0.24, 0.12),
          new THREE.MeshLambertMaterial({ color: "#8a0f1e" })
        );
        spike.position.set(x, y, z);
        blob.add(spike);
      });
    }
    return blob;
  }

  shot() {
    return {
      look: [0, 0.35, 0.3],
      frame: { w: HOME * 2 + 1.2, h: HOME_Z * 2 * Math.sin(0.82) + 1.6 },
      finale: { pull: 0.6, zoom: 0.85, lift: 0.4, orbit: 0.1 },
      pitch: 0.82,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.25, zoom: 1.35 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner whack-stun" data-whack-stun hidden>Aua! Kurz benommen …</div>`;
  }

  bind() {
    this.controls.innerHTML = "";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      const cell = this.cellFromPointer(event);
      const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
      if (this.now() < (own?.stunUntil || 0)) {
        this.feedback?.vibrate(4);
        return;
      }
      if (cell >= 0) {
        this.feedback?.vibrate(8);
        this.sendInput({ action: "whack", cell }).catch(() => {});
      }
    });
  }

  unbind() {
    this.blobs.clear();
  }

  cellFromPointer(event) {
    if (!this.camera || !this.cellPlane) return -1;
    const rect = this.webglCanvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.cellPlane)[0];
    if (!hit) return -1;
    const gx = Math.round(hit.point.x / CELL + (COLS - 1) / 2);
    const gy = Math.round(hit.point.z / CELL + (ROWS - 1) / 2);
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return -1;
    return gy * COLS + gx;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const active = new Set();
    const popById = new Map();
    (arcade.pops || []).forEach((pop) => {
      popById.set(pop.id, pop);
      if (elapsed < pop.from - 100 || elapsed > pop.until + 150) return;
      active.add(pop.id);
      let blob = this.blobs.get(pop.id);
      if (!blob) {
        blob = this.buildBlob(pop.kind);
        const pos = this.cellPos(pop.cell);
        blob.position.set(pos.x, -0.3, pos.z);
        blob.userData = { whacked: false };
        this.scene.add(blob);
        this.blobs.set(pop.id, blob);
      }
      const upTime = Math.min(1, Math.max(0, (elapsed - pop.from) / 160));
      const downTime = Math.min(1, Math.max(0, (elapsed - (pop.until - 200)) / 200));
      const squash = blob.userData.whacked ? 0.15 : 1;
      blob.position.y = -0.35 + Math.max(0, (upTime - downTime) * 0.95) * squash;
      blob.scale.y = blob.userData.whacked ? 0.3 : 1 + Math.sin(now / 140 + pop.id) * 0.05;
      blob.rotation.y = Math.sin(now / 400 + pop.id * 2) * 0.3;
    });
    this.blobs.forEach((blob, id) => {
      if (active.has(id)) return;
      this.scene.remove(blob);
      this.blobs.delete(id);
    });

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const swing = this.swings.get(player.id);
      if (!entry || !kin || !animator || !swing) return;
      const isOwn = player.id === controlledId;
      // Neue Treffer: zum Loch springen und draufhauen.
      const seen = this.hitsSeen.get(player.id) || new Set();
      Object.keys(entry.hitPopIds || {}).forEach((key) => {
        if (seen.has(key)) return;
        seen.add(key);
        const pop = popById.get(Number(key)) || popById.get(key);
        if (!pop) return;
        const pos = this.cellPos(pop.cell);
        const bad = pop.kind === "bad";
        const away = new THREE.Vector3(swing.home.x - pos.x, 0, swing.home.z - pos.z).normalize().multiplyScalar(0.8);
        swing.target = new THREE.Vector3(pos.x + away.x, 0, pos.z + away.z);
        swing.from = new THREE.Vector3(kin.position.x, 0, kin.position.z);
        swing.leap = leapMs(swing.from, swing.target);
        swing.at = now;
        swing.hopped = false;
        swing.face = Math.atan2(pos.x - swing.target.x, pos.z - swing.target.z);
        animator.trigger("dig");
        const blob = this.blobs.get(pop.id);
        if (blob) blob.userData.whacked = true;
        this.burst(new THREE.Vector3(pos.x, 0.9, pos.z), bad ? ["#ff2038", "#8a0f1e"] : ["#8f6ae0", "#ffd15c", player.color], { count: 11, speed: 2.1, up: 2, size: 0.08, life: 0.6, drag: 2, fadePow: 1.4 });
        this.bursts.ring(new THREE.Vector3(pos.x, 0.42, pos.z), bad ? "#ff2038" : "#ffd15c", { radius: bad ? 1.3 : 1, life: 0.45, opacity: 0.5, tilt: null });
        this.pop(new THREE.Vector3(pos.x, 1.3, pos.z), bad ? "AUA!" : "+1", { color: bad ? "#ff6b7f" : player.color, size: bad ? 0.38 : 0.32, life: bad ? 0.8 : 0.65, rise: 0.7 });
        if (bad) {
          animator.trigger("knockback");
          animator.expression("dizzy", 1300);
        } else {
          animator.expression("joy", 500);
        }
        if (isOwn) {
          this.feedback?.sound(bad ? "error" : "pop");
          this.feedback?.vibrate(bad ? [22, 16, 28] : 10);
          this.rig.shake(bad ? 0.7 : 0.35);
        }
      });
      this.hitsSeen.set(player.id, seen);

      // Zum Loch und zurück wird GESPRUNGEN, nicht gelaufen. Der Weg von der
      // Ecke zum fernen Loch führt über das mittlere, und wer dort durchlief,
      // hatte den Blob im Bauch. Der Bogen trägt über jeden Blob hinweg, und
      // der Hammer ist oben, während man fliegt — die Landung ist der Schlag.
      const since = now - swing.at;
      let from = swing.home;
      let to = swing.home;
      let t = 1;
      let leap = 0;
      if (swing.target) {
        const back = leapMs(swing.target, swing.home);
        if (since < swing.leap) {
          from = swing.from;
          to = swing.target;
          t = since / swing.leap;
          leap = swing.leap;
        } else if (since < STAY_MS) {
          from = to = swing.target;
        } else if (since < STAY_MS + back) {
          from = swing.target;
          t = (since - STAY_MS) / back;
          leap = back;
          if (!swing.hopped) {
            swing.hopped = true;
            animator.trigger("hop", { height: 0 });
          }
        }
      }
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      kin.position.x = from.x + (to.x - from.x) * t;
      kin.position.z = from.z + (to.z - from.z) * t;
      const arc = leap ? 4 * t * (1 - t) * Math.min(1.25, 0.3 + dist * 0.3) : 0;
      this.setGround(player.id, MOUND_TOP + arc);
      if (finale) return;
      const face = since < STAY_MS ? swing.face : leap ? Math.atan2(to.x - from.x, to.z - from.z) : Math.atan2(-swing.home.x, -swing.home.z * 0.3 - 1.2);
      kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(leap ? 0.6 : 0.35, dt);
      animator.set(now < (entry.stunUntil || 0) ? "dizzy" : "ready");
    });
  }

  keepInView() {
    return [...this.kins.values()];
  }

  drawHud(f) {
    const own = f.arcade?.players?.[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.hits || 0);
    this.stunNode ||= this.hud.querySelector("[data-whack-stun]");
    const stunned = f.now < (own?.stunUntil || 0);
    this.stunNode.hidden = !stunned;
    this.webglCanvas?.classList.toggle("is-stunned", stunned);
  }
}
