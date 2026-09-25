import * as THREE from "/vendor/three/three.module.js";
import { createCloud, setKinOpacity } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Farbflucht: eine Farbe wird angesagt, alle anderen Felder fallen weg. Mit
// Wischen hüpft man Feld für Feld.
//
// Vorher standen die Figuren reglos auf zu grossen Feldern und rutschten
// von Feld zu Feld. Jetzt hüpft man, schaut in Sprungrichtung, zappelt
// ängstlich, solange man auf der falschen Farbe steht, jubelt, wenn man
// sicher ist, und wer fällt, rudert mit den Armen in die Tiefe.
const TILE = 0.76;
const GRID = 6;
const TILE_H = 0.3;
const TILE_TOP_Y = TILE_H / 2;
const COLORS = ["#ff2e6a", "#12aaff", "#ffc400", "#33cf4d"];
const COLOR_NAMES = ["Pink", "Blau", "Gelb", "Grün"];

function tileX(gx) {
  return (gx - (GRID - 1) / 2) * TILE;
}
function tileZ(gy) {
  return (gy - (GRID - 1) / 2) * TILE;
}

export class ColorRush extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.tiles = [];
    this.lastFallen = new Map();
    this.lastSurvived = new Map();
    this.lastCell = new Map();
    this.fallAt = new Map();
    this.lastRound = -1;
    this.swipe = null;
    this.lastPhaseName = null;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Farbflucht",
      background: "#8fd8f2",
      fog: ["#9fdef5", 16, 40],
      lights: { hemiIntensity: 2.4, skyColor: 0xdfefff, groundColor: 0x6fb0c4, sunColor: 0xfff4d6 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-color-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const span = GRID * TILE;
    // Die Grube liegt in einer Wiese: vier Erdblöcke mit Grasdecke rundum.
    // Vorher stand vorn eine sieben Einheiten hohe Wand, deren Vorderseite ein
    // Drittel des Bildes braun füllte.
    const earth = new THREE.MeshLambertMaterial({ color: "#5a4030" });
    const earthDark = new THREE.MeshLambertMaterial({ color: "#3c2a1e" });
    const grass = new THREE.MeshLambertMaterial({ color: "#78c46a" });
    const rim = span / 2 + 0.12;
    const far = 18;
    [
      [0, -(rim + far / 2), far * 2 + span, far, earth],
      [0, rim + far / 2, far * 2 + span, far, earth],
      [-(rim + far / 2), 0, far, span + 0.24, earthDark],
      [rim + far / 2, 0, far, span + 0.24, earthDark]
    ].forEach(([x, z, w, d, side]) => {
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), [side, side, grass, side, side, side]);
      block.position.set(x, -3.7, z);
      block.receiveShadow = true;
      scene.add(block);
    });
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2 + 0.3;
      const radius = span / 2 + 1.4 + (i % 3) * 1.1;
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2 + (i % 2) * 0.12, 0.3), new THREE.MeshLambertMaterial({ color: i % 2 ? "#5fae55" : "#8ad27a" }));
      tuft.position.set(Math.cos(angle) * radius * 1.3, -0.1, Math.sin(angle) * radius);
      scene.add(tuft);
    }
    const pit = new THREE.Mesh(
      new THREE.BoxGeometry(span + 2.4, 0.4, span + 2.4),
      new THREE.MeshLambertMaterial({ color: "#1c130c" })
    );
    pit.position.y = -7.2;
    scene.add(pit);

    // The 6×6 colour floor.
    for (let gy = 0; gy < GRID; gy += 1) {
      for (let gx = 0; gx < GRID; gx += 1) {
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(TILE - 0.08, TILE_H, TILE - 0.08),
          new THREE.MeshLambertMaterial({ color: COLORS[0] })
        );
        tile.position.set(tileX(gx), 0, tileZ(gy));
        tile.receiveShadow = true;
        tile.castShadow = true;
        tile.userData = { gx, gy, restY: 0 };
        scene.add(tile);
        this.tiles[gy * GRID + gx] = tile;
      }
    }

    // Weiter hinten und höher: durch den versetzten Blickpunkt liegt der
    // sichtbare Himmel jetzt über der Rasterkante, nicht mehr seitlich davon.
    [[-6.5, 4.6, -13, 5], [6.2, 6.2, -16, 6], [-1, 7.4, -20, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });


    const players = this.getState()?.players || [];
    const arcade = this.minigame.arcade;
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      this.addKin(player, index, { x: tileX(entry?.gx ?? 2), ground: TILE_TOP_Y, z: tileZ(entry?.gy ?? 2), facing: 0 });
    });
  }

  shot() {
    const span = GRID * TILE;
    return {
      look: [0, 0.2, 0.25],
      frame: { w: span + 0.4, h: span * Math.sin(0.86) + 1.1 },
      fill: 0.95,
      pitch: 0.86,
      fov: 36,
      intro: { yaw: 0.5, pitch: 0.25, zoom: 1.4 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">In die angesagte Farbe wischen</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      this.swipe = { x: event.clientX, y: event.clientY };
    });
    this.on(this.webglCanvas, "pointerup", (event) => this.resolveSwipe(event));
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.tiles = [];
  }

  resolveSwipe(event) {
    if (!this.swipe) return;
    const dx = event.clientX - this.swipe.x;
    const dy = event.clientY - this.swipe.y;
    this.swipe = null;
    if (Math.hypot(dx, dy) < 24) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    this.sendStep(dir);
  }

  sendStep(dir) {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.eliminated) return;
    this.feedback?.sound("move");
    this.feedback?.vibrate(8);
    this.sendInput({ action: "step", dir }).catch(() => {});
  }

  computePhase(arcade, minigame, now) {
    const elapsed = Math.max(0, now - minigame.startedAt);
    // Mirror the server's calm lead-in before the first drop.
    const shifted = elapsed - (arcade.leadMs || 0);
    if (shifted < 0) return { name: "announce", t: Math.max(0, 1 + shifted / Math.max(1, arcade.leadMs || 1)) };
    const round = arcade.round;
    const roundElapsed = shifted - round * arcade.roundMs;
    if (roundElapsed < arcade.announceMs) return { name: "announce", t: roundElapsed / arcade.announceMs };
    if (roundElapsed < arcade.dropEndMs) return { name: "drop", t: (roundElapsed - arcade.announceMs) / (arcade.dropEndMs - arcade.announceMs) };
    return { name: "rest", t: (roundElapsed - arcade.dropEndMs) / Math.max(1, arcade.roundMs - arcade.dropEndMs) };
  }

  tick(f) {
    const { now, dt, arcade, minigame, players, controlledId, finale } = f;
    if (!arcade) return;
    const phase = this.computePhase(arcade, minigame, now);
    this.phase = phase;

    if (arcade.round !== this.lastRound) {
      this.lastRound = arcade.round;
      this.feedback?.sound("countdown");
    }
    const droppedNow = phase.name === "drop" && this.lastPhaseName === "announce";
    if (droppedNow) {
      this.rig.shake(0.9);
      this.feedback?.sound("impact");
      this.feedback?.vibrate([24, 20, 34]);
    }
    this.lastPhaseName = phase.name;

    this.tiles.forEach((tile, index) => {
      const color = arcade.grid[index];
      tile.material.color.set(COLORS[color] || COLORS[0]);
      const isTarget = color === arcade.targetColor;
      const gx = index % GRID;
      const gy = Math.floor(index / GRID);
      let targetY = 0;
      let opacity = 1;
      let jitterX = 0;
      let jitterZ = 0;
      if (phase.name === "announce" && !isTarget) {
        const menace = Math.pow(phase.t, 2) * 0.06;
        jitterX = Math.sin(now / 40 + index) * menace;
        jitterZ = Math.cos(now / 37 + index * 1.3) * menace;
      } else if (phase.name === "drop" && !isTarget) {
        targetY = -3.4 * phase.t;
        opacity = Math.max(0, 1 - phase.t * 1.4);
        if (droppedNow) this.burst(new THREE.Vector3(tileX(gx), TILE_TOP_Y, tileZ(gy)), [COLORS[color], "#ffffff"], { count: 3, speed: 1.6, up: 1.4, size: 0.09, life: 0.6 });
      } else if (phase.name === "rest" && !isTarget) {
        targetY = -3.4 * (1 - phase.t);
        opacity = Math.min(1, phase.t * 1.4);
      }
      tile.position.x = tileX(gx) + jitterX;
      tile.position.z = tileZ(gy) + jitterZ;
      tile.position.y = THREE.MathUtils.lerp(tile.position.y, targetY, frameLerp(0.3, dt));
      tile.material.transparent = opacity < 1;
      tile.material.opacity = opacity;
      if (isTarget && (phase.name === "announce" || phase.name === "drop")) {
        tile.material.emissive.set(COLORS[color]);
        tile.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(now / 150)) * 0.7;
        if (phase.name === "announce") tile.position.y += Math.abs(Math.sin(now / 150 + gx + gy)) * 0.06;
      } else {
        tile.material.emissiveIntensity = 0;
      }
    });

    const targetKnown = phase.name !== "announce" || phase.t >= 0.55;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const fallen = Boolean(entry.eliminated);
      const targetX = tileX(entry.gx);
      const targetZ = tileZ(entry.gy);

      // Ein Schritt ist ein Hüpfer in Sprungrichtung.
      const cell = `${entry.gx},${entry.gy}`;
      const last = this.lastCell.get(player.id);
      if (last && last !== cell && !fallen) {
        const [lx, ly] = last.split(",").map(Number);
        kin.userData.hopFacing = Math.atan2(entry.gx - lx, entry.gy - ly);
        kin.userData.hopAt = now;
        animator.trigger("hop", { height: 0.28 });
      }
      this.lastCell.set(player.id, cell);
      kin.position.x += (targetX - kin.position.x) * frameLerp(0.3, dt);
      kin.position.z += (targetZ - kin.position.z) * frameLerp(0.3, dt);
      const hopping = now - (kin.userData.hopAt || -1e9) < 380;
      const facing = hopping ? kin.userData.hopFacing : 0;
      let diff = facing - kin.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      kin.rotation.y += diff * frameLerp(0.3, dt);

      if (fallen && !this.lastFallen.get(player.id)) {
        this.fallAt.set(player.id, now);
        animator.trigger("fall");
        animator.expression("scared", 1600);
        this.burst(kin.position.clone(), [player.color, "#ffffff", "#1b2530"], { count: 14, speed: 2.3, up: 1.6, size: 0.09, life: 0.7, drag: 1.5 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1, 0)), "REINGEFALLEN!", { color: "#ff6b7f", size: 0.36, life: 0.9 });
        if (player.id === controlledId) {
          this.rig.shake(0.7);
          this.feedback?.sound("error");
          this.feedback?.vibrate([18, 18, 18]);
        }
      }
      this.lastFallen.set(player.id, fallen);

      if ((entry.survived || 0) > (this.lastSurvived.get(player.id) || 0)) {
        this.lastSurvived.set(player.id, entry.survived);
        animator.trigger("fistpump");
        animator.expression("joy", 600);
        this.burst(kin.position.clone(), [player.color, "#ffffff"], { count: 10, speed: 2, up: 2.2, size: 0.08, life: 0.6, drag: 1.8, fadePow: 1.4 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1, 0)), "SICHER!", { color: "#ffe36b", size: 0.32, life: 0.65, rise: 0.7 });
        if (player.id === controlledId) {
          this.feedback?.sound("pop", { pan: kin.position.x * 0.18 });
          this.feedback?.vibrate(10);
        }
      }

      if (fallen) {
        // Fällt mit rudernden Armen in die Tiefe und verblasst.
        const since = (now - (this.fallAt.get(player.id) || now)) / 1000;
        const drop = Math.min(7.5, since * since * 4.5);
        animator.groundY = TILE_TOP_Y + 0.3 - drop;
        if (since > 0.5) animator.set("panic");
        const visibility = Math.max(0, 1 - drop / 2.6);
        setKinOpacity(kin, visibility);
        kin.visible = visibility > 0.02;
        if (kin.userData.label) kin.userData.label.material.opacity = 0;
        return;
      }
      animator.groundY = TILE_TOP_Y + 0.3;
      kin.visible = true;
      setKinOpacity(kin, 1);
      if (kin.userData.label) kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
      if (finale) return;

      const onTarget = arcade.grid[entry.gy * GRID + entry.gx] === arcade.targetColor;
      if (phase.name === "announce" && targetKnown && !onTarget) {
        animator.set("panic");
        animator.expression("scared", 200);
      } else if (phase.name === "announce" && !targetKnown) {
        animator.set("think");
      } else if (phase.name === "announce" && onTarget) {
        animator.set("ready");
      } else {
        animator.set("idle");
      }
    });
  }

  keepInView(f) {
    return f.players.filter((player) => !f.arcade?.players?.[player.id]?.eliminated).map((player) => this.kins.get(player.id)).filter(Boolean);
  }

  drawHud(f) {
    const { arcade, now } = f;
    if (!arcade || !this.phase) return;
    const phase = this.phase;
    const controlled = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(controlled?.survived || 0);
    const banner = this.hud.querySelector("[data-color-banner]");
    if (banner) {
      const showWarning = phase.name === "announce" || phase.name === "drop";
      banner.hidden = !showWarning;
      if (showWarning) {
        const spinning = phase.name === "announce" && phase.t < 0.55;
        const colorIdx = spinning ? Math.floor(now / 90) % COLORS.length : arcade.targetColor;
        const secs = phase.name === "announce" ? Math.max(1, Math.ceil((1 - phase.t) * arcade.announceMs / 1000)) : 0;
        banner.textContent = spinning
          ? "Welche Farbe? …"
          : (phase.name === "drop" ? `${COLOR_NAMES[arcade.targetColor]}!` : `Steh auf ${COLOR_NAMES[arcade.targetColor]}!  ${secs}`);
        banner.style.background = COLORS[colorIdx];
        banner.style.color = colorIdx === 2 ? "#5c4508" : "#1b2530";
        banner.classList.toggle("locked", !spinning);
      }
    }
  }
}
