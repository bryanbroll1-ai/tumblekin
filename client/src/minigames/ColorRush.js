import * as THREE from "/vendor/three/three.module.js";
import { createCloud, setKinOpacity } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Farbflucht: eine Farbe wird angesagt, alle anderen Felder fallen weg. Mit
// Wischen hüpft man Feld für Feld. Runde und Phase kommen aus dem Zeitplan des
// Servers; die Farbe steht vom ersten Moment der Ansage an fest.
//
// Vorher standen die Figuren reglos auf zu grossen Feldern und rutschten
// von Feld zu Feld. Jetzt hüpft man, schaut in Sprungrichtung, zappelt
// ängstlich, solange man auf der falschen Farbe steht, jubelt, wenn man
// sicher ist, und wer fällt, rudert mit den Armen in die Tiefe.
const TILE = 0.76;
// Hochkant wie das Handy — dieselben Zahlen wie auf dem Server.
const COLS = 5;
const ROWS = 8;
const TILE_H = 0.3;
const TILE_TOP_Y = TILE_H / 2;
const WATER_Y = -3.9;
const COLORS = ["#f23f6c", "#2a9ff0", "#f7c21e", "#3cbf58"];
const COLOR_NAMES = ["Pink", "Blau", "Gelb", "Grün"];

function tileX(gx) {
  return (gx - (COLS - 1) / 2) * TILE;
}
function tileZ(gy) {
  return (gy - (ROWS - 1) / 2) * TILE;
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
    const spanX = COLS * TILE;
    const spanZ = ROWS * TILE;
    // Die Grube liegt in einer Wiese: vier Erdblöcke mit Grasdecke rundum.
    // Vorher stand vorn eine sieben Einheiten hohe Wand, deren Vorderseite ein
    // Drittel des Bildes braun füllte.
    const earth = new THREE.MeshLambertMaterial({ color: "#5a4030" });
    const earthDark = new THREE.MeshLambertMaterial({ color: "#3c2a1e" });
    const grass = new THREE.MeshLambertMaterial({ color: "#78ab69" });
    const rimX = spanX / 2 + 0.12;
    const rimZ = spanZ / 2 + 0.12;
    const far = 18;
    [
      [0, -(rimZ + far / 2), far * 2 + spanX, far, earth],
      [0, rimZ + far / 2, far * 2 + spanX, far, earth],
      [-(rimX + far / 2), 0, far, spanZ + 0.24, earthDark],
      [rimX + far / 2, 0, far, spanZ + 0.24, earthDark]
    ].forEach(([x, z, w, d, side]) => {
      const block = new THREE.Mesh(new THREE.BoxGeometry(w, 7, d), [side, side, grass, side, side, side]);
      block.position.set(x, -3.7, z);
      block.receiveShadow = true;
      scene.add(block);
    });

    // Die Wiese ringsum bekommt Flecken, Blumen, Steine und einen Baumkranz —
    // vorher war sie eine einzige grüne Fläche.
    dressMeadow(scene, { groundY: -0.2, seed: 33, keepOut: { x: rimX + 0.5, z: rimZ + 0.5 }, spread: { x: 12, z: 14 }, trees: 22, treeRing: { x: 12, z: 14 }, crownShape: "blob", crownColor: "#4aa65a", crownColor2: "#63bf6b" });

    this.buildFestival(scene, rimX, rimZ);

    // Unten in der Grube steht Wasser — wer fällt, landet mit einem Platsch,
    // statt in einem schwarzen Loch zu verschwinden. Die Wände sind Stein.
    const stone = new THREE.MeshLambertMaterial({ color: "#8b8f99" });
    [[0, -rimZ + 0.06, spanX + 0.24, 0.12], [0, rimZ - 0.06, spanX + 0.24, 0.12], [-rimX + 0.06, 0, 0.12, spanZ], [rimX - 0.06, 0, 0.12, spanZ]].forEach(([x, z, w, d]) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 4.6, d), stone);
      wall.position.set(x, -2.45, z);
      scene.add(wall);
    });
    this.pool = new THREE.Mesh(
      new THREE.BoxGeometry(spanX + 0.2, 0.3, spanZ + 0.2),
      new THREE.MeshLambertMaterial({ color: "#2bb6d8", emissive: "#0c6f8f", emissiveIntensity: 0.35 })
    );
    this.pool.position.y = WATER_Y - 0.15;
    scene.add(this.pool);

    // Der Rand der Grube leuchtet in der angesagten Farbe — so steht sie auch
    // im Bild, nicht nur im Banner.
    this.rimMat = new THREE.MeshLambertMaterial({ color: COLORS[0], emissive: COLORS[0], emissiveIntensity: 0.6 });
    [[0, -rimZ, spanX + 0.48, 0.16], [0, rimZ, spanX + 0.48, 0.16], [-rimX, 0, 0.16, spanZ + 0.16], [rimX, 0, 0.16, spanZ + 0.16]].forEach(([x, z, w, d]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), this.rimMat);
      bar.position.set(x, 0.02, z);
      scene.add(bar);
    });

    // Das Farbfeld.
    for (let gy = 0; gy < ROWS; gy += 1) {
      for (let gx = 0; gx < COLS; gx += 1) {
        const tile = new THREE.Mesh(
          new THREE.BoxGeometry(TILE - 0.08, TILE_H, TILE - 0.08),
          new THREE.MeshLambertMaterial({ color: COLORS[0] })
        );
        tile.position.set(tileX(gx), 0, tileZ(gy));
        tile.receiveShadow = true;
        tile.castShadow = true;
        tile.userData = { gx, gy, restY: 0 };
        scene.add(tile);
        this.tiles[gy * COLS + gx] = tile;
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

  // Ein Farbenfest rund um die Grube: Farbkleckse im Gras, umgekippte Eimer
  // mit Pfützen, Wimpelstäbe in den vier Farben und Farbpulverwolken, die über
  // die Wiese ziehen. Vorher war die Grube eine grüne Fläche wie jede andere.
  buildFestival(scene, rimX, rimZ) {
    const zufall = streuer(47);
    const kleckse = COLORS.map(() => []);
    for (let i = 0; i < 16; i += 1) {
      const vorn = i % 2 === 0;
      const x = (zufall() - 0.5) * 7;
      const z = (vorn ? 1 : -1) * (rimZ + 0.35 + zufall() * 2.6);
      if (Math.abs(x) < rimX + 0.2 && Math.abs(z) < rimZ + 0.3) continue;
      kleckse[i % COLORS.length].push({ p: [x, 0.003 + (i % 4) * 0.001, z], r: [-Math.PI / 2, 0, zufall() * 3], s: [0.18 + zufall() * 0.26, 0.14 + zufall() * 0.2, 1] });
    }
    COLORS.forEach((farbe, i) => viele(scene, new THREE.CircleGeometry(1, 9), lambert(farbe), kleckse[i], { empfangen: true }));
    // Umgekippte Eimer mit Pfütze.
    [[-1.5, rimZ + 1.0, 0], [1.6, rimZ + 1.5, 1], [-1.2, -rimZ - 1.2, 2], [1.4, -rimZ - 0.9, 3]].forEach(([x, z, c]) => {
      const eimer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.36, 12, 1, true), lambert("#dfe4ea", { side: THREE.DoubleSide }));
      eimer.rotation.set(0, zufall() * 3, Math.PI / 2 - 0.1);
      eimer.position.set(x, 0.19, z);
      eimer.castShadow = true;
      scene.add(eimer);
      const pfuetze = new THREE.Mesh(new THREE.CircleGeometry(1, 12), lambert(COLORS[c]));
      pfuetze.rotation.x = -Math.PI / 2;
      pfuetze.scale.set(0.4, 0.28, 1);
      pfuetze.position.set(x + 0.35, 0.006, z + 0.1);
      scene.add(pfuetze);
    });
    // Wimpelstäbe vorn und hinten am Rand.
    const staebe = [];
    const wimpel = COLORS.map(() => []);
    [-1, 1].forEach((seite) => {
      for (let i = 0; i < 6; i += 1) {
        const x = -rimX + 0.2 + i * ((2 * rimX - 0.4) / 5);
        const z = seite * (rimZ + 0.28);
        staebe.push({ p: [x, 0.35, z] });
        wimpel[(i + (seite > 0 ? 0 : 2)) % COLORS.length].push({ p: [x + 0.12, 0.62, z], s: [1, 1, 1] });
      }
    });
    viele(scene, new THREE.BoxGeometry(0.035, 0.7, 0.035), lambert("#8a6238"), staebe, { schatten: true });
    COLORS.forEach((farbe, i) => viele(scene, new THREE.BoxGeometry(0.22, 0.15, 0.02), lambert(farbe), wimpel[i]));
    // Farbpulverwolken, die über die Wiese ziehen — aussen, nie über der Grube.
    this.powder = [];
    for (let i = 0; i < 3; i += 1) {
      const wolke = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshLambertMaterial({ color: COLORS[i % COLORS.length], transparent: true, opacity: 0.2, depthWrite: false }));
      wolke.userData = { isFx: true, phase: i * 1.1, side: i % 2 ? 1 : -1, z: (zufall() - 0.5) * 2 * (rimZ + 1.5) };
      scene.add(wolke);
      this.powder.push(wolke);
    }
  }

  shot() {
    const spanX = COLS * TILE;
    const spanZ = ROWS * TILE;
    return {
      look: [0, 0.2, 0.25],
      // Seitlich etwas Luft: auf der vorderen, grössten Reihe stand eine Figur
      // auf dem Randfeld sonst mit dem Namensschild fast am Bildrand.
      frame: { w: spanX + 0.8, h: spanZ * Math.sin(0.86) + 1.1 },
      fill: 0.95,
      pitch: 0.86,
      fov: 36,
      intro: { yaw: 0.5, pitch: 0.25, zoom: 1.4 },
      // Im Finale nicht dicht an den Sieger heran: sonst füllen die Löcher
      // neben ihm das halbe Bild.
      finale: { pull: 0.9, zoom: 0.8, lift: 0.4, orbit: 0.1 }
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

  // Runde und Phase kommen aus dem Zeitplan, den der Server mitschickt — dieselbe
  // Rechnung wie dort, statt eigener Formeln aus Werten, die sich je Runde
  // ändern. `t` läuft je Phase von 0 bis 1, `left` sind die Millisekunden bis
  // zum nächsten Wechsel.
  computePhase(arcade, minigame, now) {
    const elapsed = Math.max(0, now - minigame.startedAt);
    const schedule = arcade.schedule || [];
    let round = 0;
    schedule.forEach((slot, index) => { if (elapsed >= slot.start) round = index; });
    const slot = schedule[round];
    if (!slot) return { name: "announce", t: 0, left: 0, round };
    if (elapsed < slot.dropAt) {
      return { name: "announce", t: (elapsed - slot.start) / (slot.dropAt - slot.start), left: slot.dropAt - elapsed, round };
    }
    const t = Math.min(1, (elapsed - slot.dropAt) / (slot.end - slot.dropAt));
    return { name: elapsed < slot.end || round < schedule.length - 1 ? "drop" : "over", t, left: slot.end - elapsed, round };
  }

  tick(f) {
    this.powder?.forEach((wolke) => {
      const u = f.now / 1000 * 0.25 + wolke.userData.phase;
      const rimX = (COLS * TILE) / 2 + 0.12;
      wolke.position.set(wolke.userData.side * (rimX + 1.2 + Math.sin(u) * 0.6), 1.2 + Math.sin(u * 1.7) * 0.3, wolke.userData.z + Math.cos(u) * 0.8);
      wolke.scale.setScalar(0.9 + Math.sin(u * 2.3) * 0.25);
    });
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

    const targetColor = COLORS[arcade.targetColor] || COLORS[0];
    this.rimMat.color.set(targetColor);
    this.rimMat.emissive.set(targetColor);
    // Je näher der Fall, desto hektischer pulsiert der Rand.
    const urgency = phase.name === "announce" ? phase.t : 0;
    this.rimMat.emissiveIntensity = 0.45 + Math.abs(Math.sin(now / (170 - urgency * 110))) * (0.4 + urgency * 0.8);
    this.pool.position.y = WATER_Y - 0.15 + Math.sin(now / 700) * 0.03;

    this.tiles.forEach((tile, index) => {
      const color = arcade.grid[index];
      tile.material.color.set(COLORS[color] || COLORS[0]);
      const isTarget = color === arcade.targetColor;
      const gx = index % COLS;
      const gy = Math.floor(index / COLS);
      let targetY = 0;
      let opacity = 1;
      let jitterX = 0;
      let jitterZ = 0;
      if (phase.name === "announce" && !isTarget) {
        const menace = Math.pow(phase.t, 2) * 0.06;
        jitterX = Math.sin(now / 40 + index) * menace;
        jitterZ = Math.cos(now / 37 + index * 1.3) * menace;
      } else if ((phase.name === "drop" || phase.name === "over") && !isTarget) {
        targetY = -3.4 * Math.min(1, phase.t * 1.6);
        opacity = Math.max(0, 1 - phase.t * 2);
        if (droppedNow) this.burst(new THREE.Vector3(tileX(gx), TILE_TOP_Y, tileZ(gy)), [COLORS[color], "#ffffff"], { count: 3, speed: 1.6, up: 1.4, size: 0.09, life: 0.6 });
      } else if (phase.name === "announce") {
        // Zu Beginn der Ansage kommen die gefallenen Felder in neuer Farbe
        // wieder hoch.
        opacity = Math.min(1, (tile.material.opacity ?? 1) + dt * 4);
      }
      tile.position.x = tileX(gx) + jitterX;
      tile.position.z = tileZ(gy) + jitterZ;
      tile.position.y = THREE.MathUtils.lerp(tile.position.y, targetY, frameLerp(0.3, dt));
      tile.material.transparent = opacity < 1;
      tile.material.opacity = opacity;
      if (isTarget && phase.name !== "over") {
        tile.material.emissive.set(COLORS[color]);
        tile.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(now / 150)) * 0.7;
        if (phase.name === "announce") tile.position.y += Math.abs(Math.sin(now / 150 + gx + gy)) * 0.06;
      } else {
        tile.material.emissiveIntensity = 0;
      }
    });

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
        // Fällt mit rudernden Armen ins Wasser, platscht und taucht ab.
        kin.userData.outOfPlay = true;
        const since = (now - (this.fallAt.get(player.id) || now)) / 1000;
        const bottom = TILE_TOP_Y + 0.3 - WATER_Y;
        const drop = Math.min(bottom + 0.9, since * since * 4.5);
        animator.groundY = TILE_TOP_Y + 0.3 - drop;
        if (since > 0.5) animator.set("panic");
        if (drop >= bottom && !kin.userData.splashed) {
          kin.userData.splashed = true;
          const at = new THREE.Vector3(kin.position.x, WATER_Y + 0.05, kin.position.z);
          this.burst(at, ["#bfefff", "#ffffff", player.color], { count: 16, speed: 2.2, up: 2.6, size: 0.08, life: 0.7, drag: 1.4 });
          this.bursts.ring(at, "#bfefff", { radius: 1.3, life: 0.55, y: WATER_Y + 0.05 });
        }
        const visibility = Math.max(0, 1 - Math.max(0, drop - bottom) / 0.9);
        setKinOpacity(kin, visibility);
        kin.visible = visibility > 0.02;
        if (kin.userData.label) kin.userData.label.material.opacity = 0;
        return;
      }
      // Auf der ECHTEN Oberkante des eigenen Feldes. Die leuchtenden
      // Zielfelder wippen in der Ansage bis zu sechs Zentimeter hoch — mit
      // fester Standhöhe steckten die Füsse genau dann im Block, wenn man
      // sich endlich auf das richtige Feld gerettet hatte.
      const under = this.tiles[entry.gy * COLS + entry.gx];
      animator.groundY = Math.max(0, under?.position.y ?? 0) + TILE_TOP_Y + 0.3;
      kin.visible = true;
      setKinOpacity(kin, 1);
      if (kin.userData.label) kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
      if (finale) return;

      const onTarget = arcade.grid[entry.gy * COLS + entry.gx] === arcade.targetColor;
      if (phase.name === "announce" && !onTarget) {
        animator.set(phase.t > 0.5 ? "panic" : "ready");
        if (phase.t > 0.5) animator.expression("scared", 200);
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
      const own = controlled;
      const show = phase.name === "announce" || phase.name === "drop";
      banner.hidden = !show;
      if (show) {
        const name = COLOR_NAMES[arcade.targetColor];
        if (own?.eliminated) {
          banner.textContent = "Reingefallen — schau zu";
          banner.style.background = "#0b1419";
          banner.style.color = "#ffffff";
        } else {
          const secs = Math.max(0, phase.left / 1000).toFixed(1);
          banner.textContent = phase.name === "drop" ? `${name}!` : `Lauf auf ${name}!  ${secs}`;
          banner.style.background = COLORS[arcade.targetColor];
          banner.style.color = arcade.targetColor === 2 ? "#5c4508" : "#1b2530";
        }
        banner.classList.add("locked");
      }
    }
  }
}
