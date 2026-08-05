import * as THREE from "/vendor/three/three.module.js";
import {
  applyFinaleMood,
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  KIN_SOLE
} from "./VoxelKit.js?v=tumblekin112";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin112";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin112";
import { frameDecay, shakeScale } from "./Quality.js?v=tumblekin112";

// Farbenjagd — EINE geteilte Fläche für alle. Jeder Kin färbt das Feld, auf dem
// er steht, in seine Farbe, auch wenn dort schon eine fremde liegt. Damit ist es
// das erste Minispiel, in dem man sich gegenseitig Boden abnimmt statt
// nebeneinander zu punkten: ein fremdes Feld zu übermalen bringt dir eines UND
// nimmt dem anderen eines.
//
// Am Bild gerechnet, zweimal. Zuerst das Seitenverhältnis: mit 7 x 9 Feldern
// lagen die vorderen Ecken bei 1.83 NDC, also weit ausserhalb des Bildes; 5 x 11
// passt zum hohen Handybild (0.45 gegen 0.46).
//
// Dann die Lage: mit der ersten Kamera reichte das Feld bis 879 px hinunter und
// die beiden untersten Reihen lagen unter dem Stick. In einem Spiel um Fläche
// muss man aber seine eigene Ecke SEHEN. Der freie Bereich ist 60 bis 750 px
// (oben die Leisten, unten ab ~760 der Stick); bei 0.54 pro Feld und dieser
// Kamera liegt das Feld bei 194 bis 747 px, ist also ganz frei, und ein Feld ist
// vorne 77 px breit. Die Kamera bleibt geneigt, damit die Figuren Volumen haben.
const TILE = 0.54;
const KIN_SCALE = 0.55;
// Die Kacheln sind 0.06 hoch und liegen bei y=0.01, eingefärbte bei y=0.04 —
// ihre Oberkante also bei 0.07. Ohne eigene Höhe standen die Kins auf y=0 und
// steckten damit BIS ZU DEN KNÖCHELN IN der Platte statt darauf.
const TILE_TOP_Y = 0.07;            // Oberkante eines eingefärbten Feldes
// Die Figur steht AUF dem Feld, nicht darin — und weil sie verkleinert ist,
// schrumpft der Sohlenabstand mit. standOn() rechnet mit voller Grösse und
// hätte sie um denselben Betrag zu hoch gesetzt, um den sie vorher zu tief
// stand.
const KIN_Y = TILE_TOP_Y + KIN_SOLE * KIN_SCALE;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class ColorHunt {
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
    this.tiles = [];
    this.tileOwner = [];
    this.tileCharge = [];
    this.kins = new Map();
    this.animators = new Map();
    this.pickupMeshes = new Map();
    this.lastBumpAt = new Map();
    this.lastPickupAt = 0;
    this.cols = 0;
    this.rows = 0;
    this.lastFrameAt = performance.now();
    this.shake = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Farbenjagd", background: "#8fd6ef", fog: ["#a9e0f2", 14, 34], fov: 58, far: 70 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="paint-share" data-paint-share></div>
      <div class="color-banner paint-banner" data-paint-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>
    `;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Farbenjagd: Fläche färben",
      intervalMs: 70,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "steer", x, y }).catch(() => {}),
      onEngage: () => {
        this.feedback?.sound("move");
        this.feedback?.vibrate(10);
      }
    });
    this.loop();
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.joystick?.destroy?.();
    this.controls.innerHTML = "";
    teardownStage(this);
    this.tiles.length = 0;
    this.tileOwner.length = 0;
    this.kins.clear();
    this.animators.clear();
    this.pickupMeshes.clear();
  }

  // Feldkoordinaten (0 … cols) in Weltkoordinaten. Die Mitte des Feldes liegt im
  // Ursprung, damit die Kamera nicht nachgeführt werden muss.
  worldX(col) {
    return (col - this.cols / 2) * TILE;
  }

  worldZ(row) {
    return (row - this.rows / 2) * TILE;
  }

  createScene() {
    const arcade = this.minigame?.arcade;
    this.cols = arcade?.cols || 5;
    this.rows = arcade?.rows || 11;

    addStageLights(this.scene, {
      sunPosition: [-4, 10, 5],
      shadow: {
        left: -this.cols * TILE,
        right: this.cols * TILE,
        top: this.rows * TILE,
        bottom: -this.rows * TILE
      },
      hemiIntensity: 2.7
    });

    // Rahmen unter dem Feld: gibt der Fläche einen Rand, damit man die Grenze
    // sieht, an der man abprallt.
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(this.cols * TILE + 0.24, 0.18, this.rows * TILE + 0.24),
      new THREE.MeshLambertMaterial({ color: "#6b5b46" })
    );
    frame.position.y = -0.1;
    frame.receiveShadow = true;
    this.scene.add(frame);

    // Ein Mesh je Feld: 55 Kacheln sind billig, und die Farbe eines einzelnen
    // Feldes zu setzen ist damit ein Einzeiler.
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(TILE * 0.92, 0.06, TILE * 0.92),
          new THREE.MeshLambertMaterial({ color: "#e9e2cf" })
        );
        tile.position.set(this.worldX(col + 0.5), 0.01, this.worldZ(row + 0.5));
        tile.receiveShadow = true;
        this.scene.add(tile);
        this.tiles.push(tile);
        this.tileOwner.push(null);
        this.tileCharge.push(0);
      }
    }

    [[-3.4, 4.4, -5, 6], [3.2, 5.0, -6, 1]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    this.camera.position.set(0, 6.0, 4.6);
    this.camera.lookAt(0, 0, 0.6);
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createVoxelKin(player.color, index);
    kin.scale.setScalar(KIN_SCALE);
    kin.position.y = KIN_Y;
    const label = createNameLabel(player.name.slice(0, 6), player.color);
    label.position.y = 0.85;
    kin.add(label);
    kin.userData.label = label;
    const shadow = createShadowBlob(0.3);
    this.scene.add(shadow);
    kin.userData.shadow = shadow;
    this.scene.add(kin);
    this.kins.set(player.id, kin);
    this.animators.set(player.id, new KinAnimator(kin));
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

    this.syncTiles(arcade, state);
    this.syncPickups(arcade, now);

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const x = this.worldX(entry.px);
      const z = this.worldZ(entry.py);
      kin.position.x += (x - kin.position.x) * 0.4;
      kin.position.z += (z - kin.position.z) * 0.4;

      const speed = Math.hypot(entry.vx || 0, entry.vy || 0);
      if (minigame.finaleAt) applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
      else animator.set(speed > 0.35 ? "run" : "idle", { base: true });
      // Blickrichtung in die Fahrtrichtung, damit man sieht, wohin einer will.
      if (speed > 0.2) {
        const want = Math.atan2(entry.vx, entry.vy);
        kin.rotation.y += ((want - kin.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 0.25;
      }
      animator.update(now);

      kin.userData.shadow.position.set(kin.position.x, TILE_TOP_Y + 0.01, kin.position.z);
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.7;

      // Rempler: kurzer Funkenschlag, damit man merkt, dass man geschoben wurde.
      const seen = this.lastBumpAt.get(player.id) || 0;
      if (entry.lastBumpAt && entry.lastBumpAt !== seen) {
        this.lastBumpAt.set(player.id, entry.lastBumpAt);
        this.bursts.spawn(new THREE.Vector3(kin.position.x, 0.3, kin.position.z), [player.color, "#ffffff"], {
          count: 6, speed: 1.2, up: 0.9, size: 0.05, life: 0.35, drag: 2.6
        });
        if (player.id === controlledId) {
          this.feedback?.sound("pop");
          this.feedback?.vibrate(12);
          this.shake = Math.max(this.shake, 0.22);
        }
      }

      // Breite Rolle: aufgesammelt gibt es einen Ruf, und der Kin trägt sie
      // sichtbar (grösserer Schatten).
      if (player.id === controlledId && entry.lastPickupAt && entry.lastPickupAt !== this.lastPickupAt) {
        this.lastPickupAt = entry.lastPickupAt;
        this.floaters.pop(new THREE.Vector3(kin.position.x, 0.9, kin.position.z), "BREITE ROLLE!", {
          color: "#ffe36b", size: 0.3, life: 0.9
        });
        this.feedback?.sound("perfect");
        this.feedback?.vibrate([8, 12, 16]);
      }
      kin.userData.shadow.scale.setScalar(entry.wide ? 1.7 : 1);
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.88, dt);
    const shakeX = Math.sin(now / 13) * this.shake * 0.12 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * 0.4;
    this.camera.position.y = this.baseCamY || 6.0;
    this.camera.position.z = this.baseCamZ || 4.6;
    this.camera.lookAt(0, 0, this.baseLookZ ?? 0.6);

    syncOwnMarker(this, this.kins.get(controlledId), now, 0.62);
    this.updateHud(minigame, arcade, state, now);
    this.renderer.render(this.scene, this.camera);
  }

  // Nur geänderte Felder anfassen: über 55 Kacheln je Bild neu zu setzen wäre
  // Verschwendung. Neben dem Besitzer zählt der Anspruch — ein Feld, das gerade
  // abgetragen wird, blasst sichtbar aus, und genau daran sieht man, dass sich
  // jemand an seinem Revier zu schaffen macht.
  syncTiles(arcade, state) {
    const colors = new Map(state.players.map((player) => [player.id, player.color]));
    const grid = arcade.grid || [];
    const charge = arcade.charge || [];
    for (let at = 0; at < this.tiles.length; at += 1) {
      const owner = grid[at] ?? null;
      const claim = Math.round((charge[at] ?? 0) * 10) / 10;
      if (owner === this.tileOwner[at] && claim === this.tileCharge[at]) continue;
      this.tileOwner[at] = owner;
      this.tileCharge[at] = claim;
      const tile = this.tiles[at];
      const base = new THREE.Color(owner ? (colors.get(owner) || "#cccccc") : "#e9e2cf");
      if (owner) {
        // Fremder Abtrag: die Farbe verliert Kraft, je weiter er ist.
        tile.material.color.copy(base).lerp(new THREE.Color("#f4efe0"), (1 - claim) * 0.8);
      } else {
        // Freies Feld, an dem gerade gearbeitet wird: es dunkelt leicht nach.
        tile.material.color.copy(base).lerp(new THREE.Color("#b9b39f"), claim * 0.6);
      }
      // Gefärbte Felder liegen minimal höher: das gibt der Fläche Struktur und
      // man sieht auf einen Blick, wo noch nichts liegt.
      tile.position.y = owner ? 0.04 : 0.01;
      tile.scale.y = owner ? 1.5 : 1;
    }
  }

  syncPickups(arcade, now) {
    const live = new Set();
    (arcade.pickups || []).forEach((pickup) => {
      live.add(pickup.id);
      let mesh = this.pickupMeshes.get(pickup.id);
      if (!mesh) {
        mesh = new THREE.Group();
        const drum = new THREE.Mesh(
          new THREE.CylinderGeometry(0.13, 0.13, 0.26, 12),
          new THREE.MeshLambertMaterial({ color: "#ffe36b", emissive: "#ffb400", emissiveIntensity: 0.35 })
        );
        drum.rotation.z = Math.PI / 2;
        drum.castShadow = true;
        mesh.add(drum);
        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.22, 0.04),
          new THREE.MeshLambertMaterial({ color: "#7a5c3a" })
        );
        handle.position.y = 0.2;
        mesh.add(handle);
        this.scene.add(mesh);
        this.pickupMeshes.set(pickup.id, mesh);
      }
      mesh.position.set(this.worldX(pickup.col + 0.5), 0.28 + Math.sin(now / 260) * 0.05, this.worldZ(pickup.row + 0.5));
      mesh.rotation.y = now / 420;
    });
    // Eingesammelte Rollen abräumen.
    this.pickupMeshes.forEach((mesh, id) => {
      if (live.has(id)) return;
      this.scene.remove(mesh);
      this.pickupMeshes.delete(id);
    });
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.max(0, Math.round(own?.score || 0)));

    // Ein Balken, in dem alle vier Anteile nebeneinander liegen: das ist die
    // Wertung selbst, nicht nur eine Zahl, und man sieht sofort, wer führt.
    const share = this.hud.querySelector("[data-paint-share]");
    if (share) {
      const total = (arcade.grid || []).length || 1;
      share.innerHTML = state.players.map((player) => {
        const owned = arcade.players[player.id]?.owned || 0;
        const percent = Math.max(owned > 0 ? 4 : 0, Math.round((owned / total) * 100));
        const isOwn = player.id === this.getControlledPlayerId();
        return `<i class="paint-share-part${isOwn ? " is-own" : ""}" style="--chip:${player.color};width:${percent}%">${owned}</i>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-paint-banner]");
    if (!banner) return;
    const total = (arcade.grid || []).length || 1;
    const ranking = state.players
      .map((player) => ({ player, owned: arcade.players[player.id]?.owned || 0 }))
      .sort((a, b) => b.owned - a.owned);
    const leader = ranking[0];
    const ownOwned = own?.owned || 0;
    if (own?.wide) {
      banner.hidden = false;
      banner.textContent = "Breite Rolle läuft!";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3400";
    } else if (remaining <= 8 && leader && leader.player.id !== this.getControlledPlayerId()) {
      banner.hidden = false;
      banner.textContent = `${leader.player.name} führt mit ${leader.owned} — übermalen!`;
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (ownOwned > total * 0.4) {
      banner.hidden = false;
      banner.textContent = "Du hältst das Feld!";
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Am Bild gerechnet: äusserste Feldecke bei 0.90 NDC, Feld 77 px breit,
      // und das Feld endet bei 747 px — also über dem Stick.
      this.baseCamY = portrait ? 6.0 : 5.6;
      this.baseCamZ = portrait ? 4.6 : 5.0;
      this.baseLookZ = portrait ? 0.6 : 0.4;
      camera.fov = portrait ? 58 : 46;
    });
  }
}
