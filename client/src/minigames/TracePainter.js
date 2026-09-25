import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Spurmaler: der Farbroller fährt von selbst die Spur hinauf, man LENKT ihn —
// irgendwo auf dem Bildschirm nach links oder rechts wischen.
//
// Vorher war der Finger selbst der Pinsel: er lag auf der Spur, verdeckte sie,
// musste in einem an Engstellen fingerbreiten Band bleiben, und jeder Ausrutscher
// riss den Strich mit Sperre und Wiedereinstieg ab. Jetzt gibt es kein Abreissen
// mehr. Jeder Abschnitt der Spur wird gewertet und färbt sich: kräftig in der
// eigenen Farbe (perfekt), hell (gut) oder grau (daneben). Wer auf der Linie
// bleibt, baut eine Serie auf (×2, ×3); wer daneben fährt, verliert sie, fährt
// aber einfach weiter.
const TOLERANCE = 0.09;
const BOARD_W = 3.0;
// Am gemessenen Bild gerechnet: die Tafel darf NICHT das ganze Fenster füllen.
// Oben sitzt die Kopfzeile des Minispiels, unten die Hinweiszeile.
const BOARD_H = 5.2;
const SEGMENTS = 80;          // Auflösung von Band und Spur (Vielfaches von CELLS)
const CELLS = 40;             // gewertete Abschnitte je Runde — wie auf dem Server
const STEER_SPEED = 2.2;      // wie auf dem Server: so schnell folgt der Pinsel
const PERFECT = 0.4;

function noise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Muss Zeichen für Zeichen der Serverfunktion entsprechen, sonst malt der
// Client eine andere Kurve als die, die gewertet wird.
function rawPathX(seed, lap, t) {
  const s = seed + lap * 97;
  const swing = 0.16 + noise(s) * 0.1;
  const detail = 0.015 + noise(s + 11) * 0.03;
  const phase = noise(s + 23) * Math.PI * 2;
  const bows = 1 + Math.floor(noise(s + 37) * 1.999);
  const raw = Math.sin(t * Math.PI * bows + phase) * swing
    + Math.sin(t * Math.PI * (bows * 2 + 1) + phase * 1.7) * detail;
  return clamp(0.5 + raw, 0.5 - (swing + detail), 0.5 + (swing + detail));
}

// Jede Runde beginnt dort, wo die vorige endet (wie auf dem Server).
function pathX(seed, lap, t) {
  const raw = rawPathX(seed, lap, t);
  if (lap <= 0) return raw;
  const shift = rawPathX(seed, lap - 1, 1) - rawPathX(seed, lap, 0);
  const fade = Math.max(0, 1 - t / 0.2);
  return raw + shift * fade * fade * (3 - 2 * fade);
}

// Ebenfalls wie auf dem Server: an Engstellen wird das Band schmaler, und dort
// MUSS das Bild schmaler werden.
const NARROW_MIN = 0.5;
function widthAt(seed, lap, t) {
  const s = seed + lap * 97;
  const knots = 2 + Math.floor(noise(s + 61) * 2);
  const phase = noise(s + 71) * Math.PI * 2;
  const wave = (Math.cos(t * Math.PI * 2 * knots + phase) + 1) / 2;
  const edge = Math.min(1, Math.min(t, 1 - t) / 0.12);
  const narrow = NARROW_MIN + (1 - NARROW_MIN) * wave;
  return narrow + (1 - narrow) * (1 - edge);
}

const boardX = (nx) => (nx - 0.5) * BOARD_W;
// Das Brett liegt flach: t = 0 vorn bei der Kamera, t = 1 hinten.
const boardZ = (t) => BOARD_H / 2 - t * BOARD_H;

const _open = new THREE.Color("#546472");
const _bandOpen = new THREE.Color("#c3d3e2");
const _miss = new THREE.Color("#a9b1b8");
const _white = new THREE.Color("#ffffff");

export class TracePainter extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.drawnLap = -1;
    this.paintedKey = "";
    this.lastMissAt = 0;
    this.lastLapAt = 0;
    this.lastGemAt = 0;
    this.drag = null;
    this.keyDir = 0;
    this.localTarget = null;   // wohin der eigene Finger gerade lenkt
    this.localBrush = null;    // vorhergesagte Querposition des eigenen Pinsels
    this.shownProgress = 0;
    this.sentTarget = null;
    this.sentAt = 0;
    this.shownCombo = 1;
    this.labelY = 0.74;
    // Nur die eigene Figur steht auf dem Brett — der „das bist du"-Pfeil wäre
    // hier nur ein Quadrat, das von oben gesehen über der Spur schwebt.
    this.ownMarker = false;
  }

  stage() {
    return {
      label: "3D Spurmaler",
      background: "#8fd3ef",
      fog: ["#a8e2f4", 22, 60],
      lights: { sunPosition: [-4, 12, 9], shadow: { left: -5, right: 5, top: 5, bottom: -5 }, hemiIntensity: 2.6 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="trace-lapbar" data-trace-laps></div>
      <div class="trace-combo" data-trace-combo hidden></div>
      <div class="color-banner trace-banner" data-trace-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(30, 0.4, 30), new THREE.MeshLambertMaterial({ color: "#7fce6f" }));
    lawn.position.y = -0.34;
    lawn.receiveShadow = true;
    scene.add(lawn);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.6, 0.16, BOARD_H + 0.6), new THREE.MeshLambertMaterial({ color: "#8a6b4a" }));
    frame.position.y = -0.1;
    scene.add(frame);
    const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.34, 0.1, BOARD_H + 0.34), new THREE.MeshLambertMaterial({ color: "#fdf6e6" }));
    board.position.y = -0.05;
    board.receiveShadow = true;
    scene.add(board);
    // Start- und Ziellinie: man sieht, wo eine Runde anfängt und wo sie endet.
    [[boardZ(0) + 0.05, "#ffffff"], [boardZ(1) - 0.05, "#ffd15c"]].forEach(([z, color]) => {
      const line = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.2, 0.012, 0.06), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      line.position.set(0, 0.006, z);
      scene.add(line);
    });
    this.buildRibbons();
    this.buildGems();
    [[-4.6, 5.4, -8, 3], [4.4, 6.2, -9, 8]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Die eigene Figur mit Farbroller.
    const players = this.getState()?.players || [];
    const index = Math.max(0, players.findIndex((player) => player.id === this.getControlledPlayerId()));
    const me = players[index];
    this.ownColor = me?.color || "#ff5d73";
    if (me) {
      const kin = this.addKin(me, index, { x: 0, ground: 0, z: boardZ(0), facing: Math.PI, scale: 0.72 });
      const roller = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), new THREE.MeshLambertMaterial({ color: "#6b4f35" }));
      handle.position.set(0, -0.12, 0.34);
      handle.rotation.x = 0.55;
      roller.add(handle);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 12), new THREE.MeshLambertMaterial({ color: this.ownColor }));
      drum.rotation.z = Math.PI / 2;
      drum.position.set(0, -0.2, 0.56);
      roller.add(drum);
      kin.add(roller);
      this.drum = drum;
      // Ein Leuchtring unter dem Roller: grün auf der Linie, rot daneben. Den
      // sieht man auch aus dem Augenwinkel, während der Blick nach vorn geht.
      this.cursor = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.16, 24),
        new THREE.MeshBasicMaterial({ color: "#7fe06f", transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false })
      );
      this.cursor.rotation.x = -Math.PI / 2;
      scene.add(this.cursor);
    }
  }

  buildRibbons() {
    const make = (halfWidth, lift, opacity) => {
      const count = SEGMENTS + 1;
      const positions = new Float32Array(count * 2 * 3);
      const colors = new Float32Array(count * 2 * 3);
      const indices = [];
      for (let i = 0; i < SEGMENTS; i += 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
      mesh.position.y = lift;
      this.scene.add(mesh);
      return { mesh, geometry, halfWidth, scaleWidth: false };
    };
    this.band = make(TOLERANCE, 0.012, 0.55);
    this.band.scaleWidth = true;
    // Der „perfekt"-Streifen in der Mitte des Bandes: dort soll der Roller hin.
    this.core = make(TOLERANCE * PERFECT, 0.016, 0.35);
    this.core.scaleWidth = true;
    this.trail = make(0.034, 0.024, 1);
  }

  layoutRibbons(seed, lap) {
    [this.band, this.core, this.trail].forEach((ribbon) => {
      const pos = ribbon.geometry.attributes.position;
      for (let i = 0; i <= SEGMENTS; i += 1) {
        const t = i / SEGMENTS;
        const px = pathX(seed, lap, t);
        const half = ribbon.scaleWidth ? ribbon.halfWidth * widthAt(seed, lap, t) : ribbon.halfWidth;
        pos.setXYZ(i * 2, boardX(px - half), 0, boardZ(t));
        pos.setXYZ(i * 2 + 1, boardX(px + half), 0, boardZ(t));
      }
      pos.needsUpdate = true;
      ribbon.geometry.computeBoundingSphere();
    });
    this.drawnLap = lap;
    this.paintedKey = "";
  }

  // Die Spur färbt sich Abschnitt für Abschnitt nach der Wertung des Servers.
  paintRibbons(cells) {
    const key = cells;
    if (key === this.paintedKey) return;
    this.paintedKey = key;
    const perfect = new THREE.Color(this.ownColor);
    const good = new THREE.Color(this.ownColor).lerp(_white, 0.5);
    const bandDone = new THREE.Color(this.ownColor).lerp(_white, 0.7);
    const set = (ribbon, i, color) => {
      ribbon.geometry.attributes.color.setXYZ(i * 2, color.r, color.g, color.b);
      ribbon.geometry.attributes.color.setXYZ(i * 2 + 1, color.r, color.g, color.b);
    };
    for (let i = 0; i <= SEGMENTS; i += 1) {
      const cell = Math.min(CELLS - 1, Math.floor((i / SEGMENTS) * CELLS));
      const mark = cells[cell];
      const trailC = mark === "P" ? perfect : mark === "G" ? good : mark === "-" ? _miss : _open;
      set(this.trail, i, trailC);
      set(this.band, i, mark ? bandDone : _bandOpen);
      set(this.core, i, mark ? bandDone : _white);
    }
    [this.band, this.core, this.trail].forEach((ribbon) => { ribbon.geometry.attributes.color.needsUpdate = true; });
  }

  // Die Kristalle. Sie werden EINMAL gebaut und je Runde umgesetzt.
  buildGems() {
    this.gems = [];
    for (let i = 0; i < 6; i += 1) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshBasicMaterial({ color: "#ffe36b", toneMapped: false }));
      gem.visible = false;
      this.scene.add(gem);
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.19, 18), new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
      halo.rotation.x = -Math.PI / 2;
      halo.visible = false;
      this.scene.add(halo);
      this.gems.push({ gem, halo });
    }
  }

  syncGems(own, now) {
    const list = own.gems || [];
    this.gems.forEach((visual, i) => {
      const data = list[i];
      const taken = data ? Boolean(own.gemsTaken?.[data.index]) : true;
      const show = Boolean(data) && !taken;
      visual.gem.visible = show;
      visual.halo.visible = show;
      if (!show) return;
      const x = boardX(data.x);
      const z = boardZ(data.t);
      visual.gem.position.set(x, 0.22 + Math.sin(now / 300 + i) * 0.04, z);
      visual.halo.position.set(x, 0.03, z);
      visual.gem.rotation.y = now / 420 + i;
      visual.halo.scale.setScalar(1 + Math.sin(now / 260 + i) * 0.12);
    });
  }

  shot() {
    return {
      look: [0, 0, 0.1],
      frame: { w: BOARD_W + 0.9, h: BOARD_H * Math.sin(1.1) + 0.9 },
      fill: 0.95,
      pitch: 1.1,
      fov: 36,
      intro: { yaw: 0.4, pitch: 0.3, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">◀ Irgendwo wischen zum Lenken ▶ · bleib auf der Linie</p>`;
    this.controls.style.pointerEvents = "none";
    // Relatives Lenken: wo der Finger aufsetzt, ist egal — gezählt wird, wie
    // weit er seitlich wandert, im Massstab des Bretts. So verdeckt er nie die
    // Spur, und der Roller springt beim Aufsetzen nicht.
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      this.webglCanvas.setPointerCapture?.(event.pointerId);
      this.drag = {
        id: event.pointerId,
        x0: event.clientX,
        from: this.localTarget ?? this.localBrush ?? 0.5,
        gain: 1 / Math.max(80, this.boardPixelWidth())
      };
    });
    this.on(this.webglCanvas, "pointermove", (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      event.preventDefault();
      this.localTarget = clamp(this.drag.from + (event.clientX - this.drag.x0) * this.drag.gain, 0.02, 0.98);
    });
    const up = (event) => {
      if (!this.drag || event.pointerId !== this.drag.id) return;
      this.drag = null;
      this.webglCanvas.releasePointerCapture?.(event.pointerId);
    };
    this.on(this.webglCanvas, "pointerup", up);
    this.on(this.webglCanvas, "pointercancel", up);
    // Am Rechner lenken die Pfeiltasten.
    this.on(window, "keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "a") this.keyDir = -1;
      else if (event.key === "ArrowRight" || event.key === "d") this.keyDir = 1;
    });
    this.on(window, "keyup", (event) => {
      if ((event.key === "ArrowLeft" || event.key === "a") && this.keyDir < 0) this.keyDir = 0;
      if ((event.key === "ArrowRight" || event.key === "d") && this.keyDir > 0) this.keyDir = 0;
    });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
  }

  // Wie breit das Brett auf dem Bildschirm ist, in CSS-Pixeln.
  boardPixelWidth() {
    const z = boardZ(clamp(this.shownProgress, 0, 1));
    const a = this.rig?.toScreen([boardX(0), 0, z]);
    const b = this.rig?.toScreen([boardX(1), 0, z]);
    if (!a || !b) return 300;
    return Math.abs(b.x - a.x);
  }

  // Lenkziel an den Server, gedrosselt — aber der letzte Stand kommt immer an.
  flushTarget(now) {
    if (this.localTarget === null) return;
    if (this.sentTarget !== null && Math.abs(this.localTarget - this.sentTarget) < 0.002) return;
    if (now - this.sentAt < 45) return;
    this.sentAt = now;
    this.sentTarget = this.localTarget;
    this.sendInput({ action: "steer", x: this.localTarget }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, controlledId, finale } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const kin = this.kins.get(controlledId);
    const animator = this.animators.get(controlledId);
    if (!own || !kin || !animator) return;

    if (own.lap !== this.drawnLap) {
      this.layoutRibbons(arcade.seed, own.lap);
      this.shownProgress = own.progress || 0;
    }
    this.paintRibbons(own.cells || "");

    // Eigenes Lenken: sofort im Bild, der Server bestätigt nur. Weicht er stark
    // ab (anderes Gerät, verlorene Pakete), wird sanft nachgezogen.
    if (this.localBrush === null) this.localBrush = own.brushX ?? 0.5;
    if (this.localTarget === null) this.localTarget = own.targetX ?? this.localBrush;
    if (this.keyDir && !finale) this.localTarget = clamp(this.localTarget + this.keyDir * STEER_SPEED * 0.55 * dt, 0.02, 0.98);
    if (!finale) this.flushTarget(now);
    const reach = STEER_SPEED * dt;
    this.localBrush += clamp(this.localTarget - this.localBrush, -reach, reach);
    const serverX = own.brushX ?? this.localBrush;
    if (Math.abs(serverX - this.localBrush) > 0.08) this.localBrush += (serverX - this.localBrush) * frameLerp(0.2, dt);

    // Vorwärts: lokal weiterfahren und zum Server hin korrigieren.
    const started = now >= (f.minigame?.startedAt || 0) + (arcade.leadInMs || 0);
    if (started && !finale) this.shownProgress += (own.speed || 0.2) * dt;
    this.shownProgress += ((own.progress || 0) - this.shownProgress) * frameLerp(0.18, dt);
    this.shownProgress = clamp(this.shownProgress, 0, 1);

    const t = this.shownProgress;
    const x = boardX(this.localBrush);
    const z = boardZ(t);
    kin.position.x = x;
    kin.position.z = z + 0.1;
    animator.groundY = 0.3 * 0.72;
    // In Fahrtrichtung drehen: nach hinten und etwas zur Seite, wohin gelenkt wird.
    const lean = clamp((this.localTarget - this.localBrush) * 6, -0.5, 0.5);
    if (!finale) kin.rotation.y += Math.atan2(Math.sin(Math.PI + lean - kin.rotation.y), Math.cos(Math.PI + lean - kin.rotation.y)) * frameLerp(0.2, dt);

    // Liegt der Roller auf der Linie? Das ist die Rückmeldung in jedem Bild.
    const offset = Math.abs(this.localBrush - pathX(arcade.seed, own.lap, t));
    const tolerance = TOLERANCE * widthAt(arcade.seed, own.lap, t);
    const quality = offset <= tolerance * PERFECT ? 2 : offset <= tolerance ? 1 : 0;
    if (this.cursor) {
      this.cursor.position.set(x, 0.035, z - 0.04);
      this.cursor.material.color.set(quality === 2 ? "#7fe06f" : quality === 1 ? "#ffd15c" : "#ff6b7f");
      this.cursor.scale.setScalar(quality === 2 ? 1 + Math.sin(now / 90) * 0.08 : 1);
    }
    if (this.drum && started && !finale) this.drum.rotation.x += dt * 12;
    if (!finale) {
      animator.set(started ? "shove" : "ready");
      animator.rate = started ? 0.8 + (own.speed || 0.2) * 1.2 : 1;
      if (quality === 0 && started) animator.expression("scared", 150);
      else if ((own.streak || 0) >= 20) animator.expression("happy", 150);
    }
    if (started && quality > 0 && Math.random() < frameChance(quality === 2 ? 0.5 : 0.25, dt)) {
      this.burst(new THREE.Vector3(x, 0.08, z - 0.15), [this.ownColor, "#ffffff"], { count: 1, speed: 0.4, up: 0.4, size: 0.045, life: 0.4, drag: 2.4 });
    }
    this.syncGems(own, now);
    this.reactToEvents(own, kin, animator);
  }

  reactToEvents(own, kin, animator) {
    // Daneben: kurz und nur, wenn wirklich eine Serie verloren ging — sonst
    // flackert beim Wiedereinfädeln eine Meldung nach der anderen.
    if (own.lastMissAt && own.lastMissAt !== this.lastMissAt) {
      this.lastMissAt = own.lastMissAt;
      if ((own.lastBrokenStreak || 0) >= 5) {
        animator.trigger("stumble");
        animator.expression("surprised", 600);
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.9, 0));
        this.pop(at, "Serie weg", { color: "#ff9aa8", size: 0.26, life: 0.7 });
        this.feedback?.sound("error");
        this.feedback?.vibrate(16);
      }
    }
    const combo = Math.min(3, 1 + Math.floor((own.streak || 0) / 10));
    if (combo !== this.shownCombo) {
      if (combo > this.shownCombo) {
        const at = kin.position.clone().add(new THREE.Vector3(0, 1.0, 0));
        this.pop(at, `×${combo}!`, { color: "#ffe36b", size: 0.4, life: 0.8 });
        this.burst(at, [this.ownColor, "#ffe36b", "#ffffff"], { count: 12, speed: 1.6, up: 1.4, size: 0.06, life: 0.5, drag: 2.0 });
        this.feedback?.sound("sparkle");
        this.feedback?.vibrate(10);
      }
      this.shownCombo = combo;
    }
    if (own.lastGemAt && own.lastGemAt !== this.lastGemAt) {
      this.lastGemAt = own.lastGemAt;
      const gem = own.lastGem;
      const at = new THREE.Vector3(boardX(gem?.x ?? 0.5), 0.4, boardZ(gem?.t ?? 0.5));
      this.burst(at, ["#ffe36b", "#ffffff"], { count: 14, speed: 1.8, up: 1.4, size: 0.06, life: 0.55, drag: 2.0 });
      this.pop(at, "+60", { color: "#ffe36b", size: 0.32, life: 0.7 });
      this.feedback?.sound("coin");
      this.feedback?.vibrate(8);
    }
    if (own.lastLapAt && own.lastLapAt !== this.lastLapAt) {
      this.lastLapAt = own.lastLapAt;
      const lap = own.lastLap;
      animator.trigger("celebrate");
      animator.expression("joy", 900);
      const at = new THREE.Vector3(0, 1, boardZ(0.9));
      this.burst(at, [this.ownColor, "#ffe36b", "#ffffff"], { count: 20, speed: 2.2, up: 2.4, size: 0.08, life: 0.7, drag: 1.6 });
      this.pop(at, lap?.clean ? `SAUBER! ${lap.accuracy} %` : `RUNDE · ${lap?.accuracy ?? 0} %`, { color: "#ffe36b", size: 0.42, life: 1.0 });
      this.feedback?.sound(lap?.clean ? "perfect" : "coin");
      this.feedback?.vibrate([10, 14, 18]);
    }
  }

  keepInView() {
    return [...this.kins.values()];
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
    const laps = this.hud.querySelector("[data-trace-laps]");
    if (laps) {
      const html = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="trace-lap-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.round(entry?.score || 0)}</span>`;
      }).join("");
      if (laps.innerHTML !== html) laps.innerHTML = html;
    }
    const combo = this.hud.querySelector("[data-trace-combo]");
    if (combo && own) {
      const streak = own.streak || 0;
      const factor = Math.min(3, 1 + Math.floor(streak / 10));
      const text = `×${factor} · Serie ${streak}`;
      combo.hidden = streak < 3;
      if (combo.textContent !== text) combo.textContent = text;
      combo.dataset.level = String(factor);
    }
    const banner = this.hud.querySelector("[data-trace-banner]");
    if (!banner) return;
    const waiting = f.now < (f.minigame?.startedAt || 0) + (arcade.leadInMs || 0);
    if (waiting) {
      banner.hidden = false;
      banner.textContent = "Wisch zum Lenken — gleich geht's los";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3400";
    } else {
      banner.hidden = true;
    }
  }
}
