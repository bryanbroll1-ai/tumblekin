import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { addStageLights } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Farbenjagd: jeder schiebt einen Farbroller in seiner Farbe über das Feld und
// färbt, was er überrollt. Wer die meisten Felder hält, gewinnt.
//
// Vorher liefen winzige Figuren mit leeren Händen über ein Brett, das aus
// grosser Höhe gefilmt war. Jetzt hat jeder seinen Roller vor sich, der bei
// der "breiten Rolle" sichtbar breiter wird, die Figuren schieben im Schritt,
// prallen beim Zusammenstoss zurück, und das Brett füllt das Bild.
const TILE = 0.54;
const KIN_SCALE = 0.66;
const TILE_TOP_Y = 0.07;

export class ColorHunt extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.tiles = [];
    this.tileOwner = [];
    this.tileCharge = [];
    this.pickupMeshes = new Map();
    this.rollers = new Map();
    this.lastBumpAt = new Map();
    this.lastPickupAt = new Map();
    this.cols = 0;
    this.rows = 0;
    this.labelY = 0.95;
    this.markerOffset = 0.75;
  }

  stage() {
    return { label: "3D Farbenjagd", background: "#8fd6ef", fog: ["#a9e0f2", 16, 38], lights: false };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="paint-share" data-paint-share></div>
      <div class="color-banner paint-banner" data-paint-banner hidden></div>`;
  }

  worldX(col) {
    return (col - this.cols / 2) * TILE;
  }

  worldZ(row) {
    return (row - this.rows / 2) * TILE;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame?.arcade;
    this.cols = arcade?.cols || 5;
    this.rows = arcade?.rows || 11;
    this.addLights();

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(this.cols * TILE + 0.24, 0.18, this.rows * TILE + 0.24),
      new THREE.MeshLambertMaterial({ color: "#6b5b46" })
    );
    frame.position.y = -0.1;
    frame.receiveShadow = true;
    scene.add(frame);

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
        scene.add(tile);
        this.tiles.push(tile);
        this.tileOwner.push(null);
        this.tileCharge.push(0);
      }
    }

    // Das Spielfeld schwebte in flachem Cyan — kein Boden, kein Horizont,
    // nichts. Jetzt liegt es als Holzsteg über einem flachen Becken: das
    // Wasser reicht bis unter die Kamera und weit hinter das Feld, ein Rand
    // aus Bohlen fasst es ein. Kein Wiesenkranz — acht andere Spiele stehen
    // schon auf Gras, und dieses hier soll man daran erkennen können.
    const becken = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.4, 60),
      new THREE.MeshLambertMaterial({ color: "#2f9fc4" })
    );
    becken.position.set(0, -0.62, -6);
    becken.receiveShadow = true;
    scene.add(becken);

    const stegBreit = this.cols * TILE + 1.5;
    const stegLang = this.rows * TILE + 1.5;
    const steg = new THREE.Mesh(
      new THREE.BoxGeometry(stegBreit, 0.24, stegLang),
      new THREE.MeshLambertMaterial({ color: "#8a7356" })
    );
    steg.position.y = -0.24;
    steg.receiveShadow = true;
    scene.add(steg);
    // Bohlenfugen auf dem umlaufenden Rand.
    const bohlen = new THREE.InstancedMesh(
      new THREE.BoxGeometry(stegBreit, 0.03, 0.08),
      new THREE.MeshLambertMaterial({ color: "#6b5843" }),
      14
    );
    const fuge = new THREE.Object3D();
    for (let i = 0; i < 14; i += 1) {
      fuge.position.set(0, -0.1, -stegLang / 2 + 0.3 + i * (stegLang / 14));
      fuge.updateMatrix();
      bohlen.setMatrixAt(i, fuge.matrix);
    }
    bohlen.instanceMatrix.needsUpdate = true;
    scene.add(bohlen);

    // Seerosenblätter im Becken, ausserhalb des Stegs.
    const blaetter = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.05, 7),
      new THREE.MeshLambertMaterial({ color: "#3f8f55" }),
      18
    );
    const blatt = new THREE.Object3D();
    for (let i = 0; i < 18; i += 1) {
      // Fester Streuer: dasselbe Becken bei jedem Start.
      const winkel = (i * 2.399) % (Math.PI * 2);
      const radius = Math.max(stegBreit, stegLang) / 2 + 1.2 + ((i * 13) % 8) * 1.1;
      blatt.position.set(Math.cos(winkel) * radius, -0.4, Math.sin(winkel) * radius - 3);
      blatt.rotation.y = winkel;
      blatt.scale.setScalar(0.6 + ((i * 7) % 5) * 0.26);
      blatt.updateMatrix();
      blaetter.setMatrixAt(i, blatt.matrix);
    }
    blaetter.instanceMatrix.needsUpdate = true;
    scene.add(blaetter);

    [[-3.4, 4.4, -5, 6], [3.2, 5.0, -6, 1]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });


    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      const kin = this.addKin(player, index, {
        x: this.worldX(entry?.px ?? this.cols / 2),
        ground: TILE_TOP_Y,
        z: this.worldZ(entry?.py ?? this.rows / 2),
        scale: KIN_SCALE
      });
      this.rollers.set(player.id, this.addRoller(kin, player.color));
    });
  }

  addLights() {
    // Das Schattenfenster über das ganze Brett.
    addStageLights(this.scene, {
      sunPosition: [-4, 10, 5],
      shadow: { left: -this.cols * TILE, right: this.cols * TILE, top: this.rows * TILE, bottom: -this.rows * TILE },
      hemiIntensity: 2.7
    });
  }

  // Der Farbroller: Griff von den Händen schräg nach vorn unten, die Walze in
  // der Spielerfarbe vorn auf dem Boden. Er hängt an der Figur und dreht sich
  // mit ihr.
  addRoller(kin, color) {
    const roller = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), new THREE.MeshLambertMaterial({ color: "#6b4f35" }));
    handle.position.set(0, -0.12, 0.36);
    handle.rotation.x = 0.55;
    roller.add(handle);
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.04), new THREE.MeshLambertMaterial({ color: "#8a8f99" }));
    fork.position.set(0, -0.23, 0.55);
    roller.add(fork);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.46, 12), new THREE.MeshLambertMaterial({ color }));
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -0.19, 0.6);
    drum.castShadow = true;
    roller.add(drum);
    kin.add(roller);
    roller.userData = { drum, fork, width: 1 };
    return roller;
  }

  shot() {
    const w = this.cols * TILE;
    const d = this.rows * TILE;
    return {
      look: [0, 0, 0.25],
      frame: { w: w + 0.3, h: d * Math.sin(0.8) + 0.8 },
      fill: 0.96,
      pitch: 0.8,
      fov: 36,
      intro: { yaw: 0.5, pitch: 0.3, zoom: 1.35 },
      finale: { pull: 0.85, zoom: 0.6, lift: 0.3, orbit: 0.12 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>`;
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
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
    this.tiles.length = 0;
    this.tileOwner.length = 0;
    this.pickupMeshes.clear();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, state } = f;
    if (!arcade) return;
    this.syncTiles(arcade, state);
    this.syncPickups(arcade, now);

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const roller = this.rollers.get(player.id);
      if (!entry || !kin || !animator) return;
      const x = this.worldX(entry.px);
      const z = this.worldZ(entry.py);
      kin.position.x += (x - kin.position.x) * frameLerp(0.4, dt);
      kin.position.z += (z - kin.position.z) * frameLerp(0.4, dt);

      const speed = Math.hypot(entry.vx || 0, entry.vy || 0);
      if (speed > 0.2 && !finale) {
        const want = Math.atan2(entry.vx, entry.vy);
        let diff = want - kin.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        kin.rotation.y += diff * frameLerp(0.25, dt);
      }
      if (finale) {
        kin.rotation.y += Math.atan2(Math.sin(-kin.rotation.y), Math.cos(-kin.rotation.y)) * frameLerp(0.1, dt);
      } else if (speed > 0.3) {
        animator.set("shove");
        animator.rate = 0.7 + speed * 0.35;
      } else {
        animator.set("ready");
        animator.rate = 1;
      }

      // Walze dreht sich mit der Fahrt, wird bei der breiten Rolle breiter.
      if (roller) {
        const u = roller.userData;
        u.drum.rotation.x += speed * dt * 6;
        u.width += ((entry.wide ? 2.1 : 1) - u.width) * frameLerp(0.2, dt);
        u.drum.scale.y = u.width;
        u.fork.scale.x = u.width;
        roller.visible = !finale;
        if (speed > 0.3 && Math.random() < frameChance(0.25, dt)) {
          const at = roller.localToWorld(new THREE.Vector3(0, -0.3, 0.6));
          this.burst(at, [player.color], { count: 1, speed: 0.4, up: 0.4, size: 0.05, life: 0.35 });
        }
      }

      const seen = this.lastBumpAt.get(player.id) || 0;
      if (entry.lastBumpAt && entry.lastBumpAt !== seen) {
        this.lastBumpAt.set(player.id, entry.lastBumpAt);
        animator.trigger("flinch");
        animator.expression("surprised", 400);
        this.burst(new THREE.Vector3(kin.position.x, 0.35, kin.position.z), [player.color, "#ffffff"], { count: 6, speed: 1.2, up: 0.9, size: 0.05, life: 0.35, drag: 2.6 });
        if (player.id === controlledId) {
          this.feedback?.sound("pop");
          this.feedback?.vibrate(12);
          this.rig.shake(0.22);
        }
      }
      if (entry.lastPickupAt && entry.lastPickupAt !== (this.lastPickupAt.get(player.id) || 0)) {
        this.lastPickupAt.set(player.id, entry.lastPickupAt);
        animator.trigger("fistpump");
        animator.expression("joy", 700);
        if (player.id === controlledId) {
          this.pop(new THREE.Vector3(kin.position.x, 1, kin.position.z), "BREITE ROLLE!", { color: "#ffe36b", size: 0.3, life: 0.9 });
          this.feedback?.sound("perfect");
          this.feedback?.vibrate([8, 12, 16]);
        }
      }
      if (kin.userData.label) kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });
  }

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

  drawHud(f) {
    const { arcade, state, now, minigame } = f;
    if (!arcade) return;
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
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
}
