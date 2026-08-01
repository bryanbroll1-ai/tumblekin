import * as THREE from "/vendor/three/three.module.js";
import {
  applyFinaleMood,
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin102";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin102";
import { frameDecay, shakeScale } from "./Quality.js?v=tumblekin102";

// Spurmaler — eine geschwungene Spur läuft von unten nach oben. Der eigene Kin
// reitet als Pinsel darauf und malt sie aus, solange der Finger im Toleranzband
// bleibt. Verlässt er es, reisst der Strich ab und man muss an der Bruchstelle
// neu ansetzen. Jede geschaffte Runde bringt eine neue Kurve.
//
// Die Eingabe wird per Strahl auf die Brettebene gerechnet, nicht über die
// Bildschirmmitte geschätzt: bei einem Präzisionsspiel muss der Pinsel genau
// dort sitzen, wo der Finger liegt — auch wenn die Kamera leicht schräg steht.
//
// Kurve und Toleranz kommen aus derselben Formel wie auf dem Server.
const TOLERANCE = 0.085;
const BOARD_W = 3.0;
// Am gemessenen Bild gerechnet: die Tafel darf NICHT das ganze Fenster füllen.
// Oben sitzt die Kopfzeile des Minispiels (und im Dev-Modus die Spielerreiter),
// unten die Hinweiszeile. Mit einer bildschirmhohen Tafel lagen Anfang und Ende
// der Spur unter dieser Leiste — eine Runde war per Finger nicht zu schaffen,
// während die Bots seelenruhig neun Runden malten. 5.2 von 6.93 sichtbaren
// Einheiten lässt oben und unten je gut 12% frei.
const BOARD_H = 5.2;
const SEGMENTS = 72;          // Auflösung von Band und Spur
// INNERHALB der Tafel: aussen daneben lag die Leiste hinter dem Bildrand, weil
// die Tafel selbst schon etwas breiter ist als das sichtbare Fenster — die
// Rivalenpunkte waren damit unsichtbar. Die Spur reicht bis x=1.02, hier ist
// also Platz.
const RAIL_X = BOARD_W / 2 - 0.14;
const KIN_LIFT = 0.3;      // hebt die Figur auf die Spur statt unter sie

function noise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Muss Zeichen für Zeichen der Serverfunktion entsprechen, sonst malt der
// Client eine andere Kurve als die, die gewertet wird.
function pathX(seed, lap, t) {
  const s = seed + lap * 97;
  const swing = 0.18 + noise(s) * 0.08;
  const detail = 0.04 + noise(s + 11) * 0.04;
  const phase = noise(s + 23) * Math.PI * 2;
  const bows = 1 + Math.floor(noise(s + 37) * 2.999);
  const raw = Math.sin(t * Math.PI * bows + phase) * swing
    + Math.sin(t * Math.PI * (bows * 2 + 1) + phase * 1.7) * detail;
  return clamp(0.5 + raw, 0.5 - (swing + detail), 0.5 + (swing + detail));
}

// Ebenfalls Zeichen für Zeichen wie auf dem Server: die Bandbreite ist an
// Engstellen kleiner, und dort MUSS das Bild schmaler werden — sonst reisst der
// Strich an einer Stelle ab, an der die Spur noch breit aussieht.
const NARROW_MIN = 0.42;
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
const boardY = (ny) => ny * BOARD_H;

export class TracePainter {
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
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.rails = new Map();
    this.drawnLap = -1;
    this.paintedUpTo = -1;
    this.lastSlipAt = 0;
    this.lastLapAt = 0;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.dragging = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Spurmaler", background: "#8fd3ef", fog: ["#a8e2f4", 22, 60], fov: 60, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="trace-lapbar" data-trace-laps></div>
      <div class="color-banner trace-banner" data-trace-banner hidden></div>
    `);
    this.createScene();

    // Keine Knopfleiste: die ganze Fläche IST die Steuerung. Ein Knopf würde nur
    // Platz von der Spur nehmen. Die Leiste muss Zeigerereignisse durchlassen,
    // sonst schluckt sie genau die Berührungen am unteren Ende der Spur.
    this.controls.innerHTML = `<p class="trace-hint">Zieh den Finger auf der Spur nach oben</p>`;
    this.controls.style.pointerEvents = "none";

    this.onDown = (event) => {
      event.preventDefault();
      this.dragging = true;
      this.webglCanvas.setPointerCapture?.(event.pointerId);
      this.sendPointer(event);
    };
    this.onMove = (event) => {
      if (!this.dragging) return;
      event.preventDefault();
      this.sendPointer(event);
    };
    this.onUp = (event) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.webglCanvas.releasePointerCapture?.(event.pointerId);
      this.sendInput({ action: "lift" }).catch(() => {});
    };
    this.webglCanvas.addEventListener("pointerdown", this.onDown);
    this.webglCanvas.addEventListener("pointermove", this.onMove);
    this.webglCanvas.addEventListener("pointerup", this.onUp);
    this.webglCanvas.addEventListener("pointercancel", this.onUp);
    this.webglCanvas.addEventListener("pointerleave", this.onUp);
    this.loop();
  }

  // Fingerposition → Punkt auf dem Brett → normierte Spurkoordinaten.
  sendPointer(event) {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || !this.camera) return;
    const rect = this.webglCanvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, hit)) return;
    const x = clamp(hit.x / BOARD_W + 0.5, 0, 1);
    const y = clamp(hit.y / BOARD_H, 0, 1);
    this.sendInput({ action: "trace", x, y }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    this.webglCanvas?.removeEventListener("pointerdown", this.onDown);
    this.webglCanvas?.removeEventListener("pointermove", this.onMove);
    this.webglCanvas?.removeEventListener("pointerup", this.onUp);
    this.webglCanvas?.removeEventListener("pointercancel", this.onUp);
    this.webglCanvas?.removeEventListener("pointerleave", this.onUp);
    teardownStage(this);
    this.rails.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-4, 12, 9],
      shadow: { left: -5, right: 5, top: 9, bottom: -1 },
      hemiIntensity: 2.6
    });

    // Leinwand: eine helle Tafel, auf der gemalt wird.
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.34, BOARD_H + 0.34, 0.24),
      new THREE.MeshLambertMaterial({ color: "#fdf6e6" })
    );
    board.position.set(0, BOARD_H / 2, -0.18);
    board.receiveShadow = true;
    this.scene.add(board);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.6, BOARD_H + 0.6, 0.16),
      new THREE.MeshLambertMaterial({ color: "#8a6b4a" })
    );
    frame.position.set(0, BOARD_H / 2, -0.32);
    this.scene.add(frame);

    this.buildRibbons();
    this.buildGems();
    this.buildRail();

    [[-4.6, 6.4, -8, 3], [4.4, 7.2, -9, 8]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildBrush();
    this.resizeRenderer();
    this.camera.position.set(0, BOARD_H / 2, 6.0);
    this.camera.lookAt(0, BOARD_H / 2, 0);
  }

  // Band und Spur als je ein Streifen mit Eckfarben. Beim Malen werden nur die
  // Farben aktualisiert — deutlich billiger als 72 einzelne Meshes.
  buildRibbons() {
    const make = (halfWidth, z, baseColor) => {
      const count = SEGMENTS + 1;
      const positions = new Float32Array(count * 2 * 3);
      const colors = new Float32Array(count * 2 * 3);
      const indices = [];
      for (let i = 0; i < SEGMENTS; i += 1) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: baseColor.opacity,
        depthWrite: false,
        toneMapped: false
      }));
      mesh.position.z = z;
      this.scene.add(mesh);
      return { mesh, geometry, halfWidth, scaleWidth: false };
    };

    this.band = make(TOLERANCE, 0.02, { opacity: 0.55 });
    this.band.scaleWidth = true;
    this.trail = make(0.032, 0.05, { opacity: 1 });
  }

  // Legt Band und Spur auf die Kurve der angegebenen Runde.
  layoutRibbons(seed, lap) {
    [this.band, this.trail].forEach((ribbon) => {
      const pos = ribbon.geometry.attributes.position;
      for (let i = 0; i <= SEGMENTS; i += 1) {
        const t = i / SEGMENTS;
        const px = pathX(seed, lap, t);
        // Nur das Toleranzband verengt sich; der gemalte Strich behält seine
        // Breite, sonst sähe die fertige Spur an den Engstellen aus wie ein
        // Fehler statt wie eine Engstelle.
        const half = ribbon.scaleWidth ? ribbon.halfWidth * widthAt(seed, lap, t) : ribbon.halfWidth;
        pos.setXYZ(i * 2, boardX(px - half), boardY(t), 0);
        pos.setXYZ(i * 2 + 1, boardX(px + half), boardY(t), 0);
      }
      pos.needsUpdate = true;
      ribbon.geometry.computeBoundingSphere();
    });
    this.drawnLap = lap;
    this.paintedUpTo = -1;
  }

  // Färbt die Spur bis `progress` in der Spielerfarbe. Alles darüber bleibt
  // blass — man sieht auf einen Blick, wie weit man ist.
  paintRibbons(progress, color) {
    const step = Math.round(progress * SEGMENTS);
    if (step === this.paintedUpTo) return;
    this.paintedUpTo = step;
    // Die noch offene Spur muss KRÄFTIG sein, nicht dezent: sie ist die Anweisung,
    // wohin der Finger soll. Im ersten Wurf war sie hellgrau auf creme und auf
    // dem Handybild kaum zu sehen.
    const painted = new THREE.Color(color);
    const bandPainted = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.55);
    const bandOpen = new THREE.Color("#c3d3e2");
    const trailOpen = new THREE.Color("#546472");
    for (let i = 0; i <= SEGMENTS; i += 1) {
      const done = i <= step;
      const bandC = done ? bandPainted : bandOpen;
      const trailC = done ? painted : trailOpen;
      this.band.geometry.attributes.color.setXYZ(i * 2, bandC.r, bandC.g, bandC.b);
      this.band.geometry.attributes.color.setXYZ(i * 2 + 1, bandC.r, bandC.g, bandC.b);
      this.trail.geometry.attributes.color.setXYZ(i * 2, trailC.r, trailC.g, trailC.b);
      this.trail.geometry.attributes.color.setXYZ(i * 2 + 1, trailC.r, trailC.g, trailC.b);
    }
    this.band.geometry.attributes.color.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;
  }

  // Die Kristalle. Sie werden EINMAL gebaut und je Runde umgesetzt — neue
  // Meshes pro Runde wären auf dem Handy der teuerste Teil der Szene.
  buildGems() {
    this.gems = [];
    for (let i = 0; i < 8; i += 1) {
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.11),
        new THREE.MeshBasicMaterial({ color: "#ffe36b", toneMapped: false })
      );
      gem.visible = false;
      gem.position.z = 0.09;
      this.scene.add(gem);
      // Ein Ring darum, damit man ihn auch dann sieht, wenn er farblich im Band
      // liegt — und damit klar ist, dass er eingesammelt werden will.
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.14, 0.19, 18),
        new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false })
      );
      halo.position.z = 0.07;
      halo.visible = false;
      this.scene.add(halo);
      this.gems.push({ gem, halo });
    }
  }

  // Setzt die Kristalle der aktuellen Runde und blendet eingesammelte aus.
  syncGems(own, now) {
    if (!this.gems) return;
    const list = own.gems || [];
    this.gems.forEach((visual, i) => {
      const data = list[i];
      const taken = data ? Boolean(own.gemsTaken?.[data.index]) : true;
      const show = Boolean(data) && !taken;
      visual.gem.visible = show;
      visual.halo.visible = show;
      if (!show) return;
      const x = boardX(data.x);
      const y = boardY(data.t);
      visual.gem.position.set(x, y, 0.09);
      visual.halo.position.set(x, y, 0.07);
      visual.gem.rotation.y = now / 420 + i;
      visual.gem.rotation.z = Math.sin(now / 600 + i) * 0.3;
      const pulse = 1 + Math.sin(now / 260 + i) * 0.12;
      visual.halo.scale.setScalar(pulse);
    });
  }

  // Rivalen laufen auf einer Leiste am Rand mit. Sie auf die Tafel zu setzen
  // wäre irreführend: ab der zweiten Runde malt jeder eine andere Kurve.
  buildRail() {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, BOARD_H, 0.06),
      new THREE.MeshLambertMaterial({ color: "#7d8f84" })
    );
    rail.position.set(RAIL_X, BOARD_H / 2, 0);
    this.scene.add(rail);
  }

  ensureRail(player) {
    if (this.rails.has(player.id)) return this.rails.get(player.id);
    const pip = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.3 })
    );
    pip.position.set(RAIL_X, 0, 0.14);
    this.scene.add(pip);
    const entry = { pip, color: player.color };
    this.rails.set(player.id, entry);
    return entry;
  }

  // Der eigene Kin ist der Pinsel: er reitet auf der Spur und malt sie aus.
  buildBrush() {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId())
      || state?.players?.[0];
    this.ownColor = me?.color || "#ff5d73";
    const kin = createVoxelKin(this.ownColor, 0);
    kin.scale.setScalar(0.62);
    const label = createNameLabel("du", this.ownColor);
    label.position.y = 0.7;
    kin.add(label);
    kin.position.set(0, 0, 0.34);
    this.scene.add(kin);
    this.brush = kin;
    this.brushAnimator = new KinAnimator(kin);
    this.brushAnimator.groundY = 0;
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
    const own = arcade.players[controlledId];

    if (own) {
      if (own.lap !== this.drawnLap) this.layoutRibbons(arcade.seed, own.lap);
      this.paintRibbons(own.progress || 0, this.ownColor);
      this.moveBrush(own, arcade, now, dt);
      if (minigame.finaleAt) {
        applyFinaleMood(this.brushAnimator, arcade.places?.[controlledId], state.players.length);
        this.brushAnimator.update(now);
      }
      this.syncGems(own, now);
      this.reactToEvents(own, now);
    }

    state.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const rail = this.ensureRail(player);
      const target = boardY(clamp(entry.progress || 0, 0, 1));
      rail.pip.position.y += (target - rail.pip.position.y) * 0.2;
      rail.pip.visible = player.id !== controlledId;
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.88, dt);
    const shakeX = Math.sin(now / 13) * this.shake * 0.14 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * 0.4;
    this.camera.position.y = this.baseCamY || BOARD_H / 2;
    this.camera.position.z = this.baseCamZ || 6.0;
    this.camera.lookAt(0, BOARD_H / 2, 0);

    this.updateHud(minigame, arcade, state, now, own);
    this.renderer.render(this.scene, this.camera);
  }

  moveBrush(own, arcade, now, dt) {
    // Der Pinsel sitzt auf dem gewerteten Fortschritt, nicht auf der rohen
    // Fingerposition — sonst würde er dem Strich davonlaufen und der Spieler
    // hielte den Vorsprung für echt.
    const t = clamp(own.progress || 0, 0, 1);
    const px = pathX(arcade.seed, own.lap, t);
    const targetX = boardX(px);
    // KIN_LIFT hebt die Figur auf die Spur: der Animator setzt die Höhe auf den
    // Ursprung des Modells, und der liegt in der Körpermitte. Ohne den Versatz
    // steckte der Pinsel-Kin am Anfang der Spur halb unter dem Bildrand.
    const targetY = boardY(t) + KIN_LIFT;
    this.brush.position.x += (targetX - this.brush.position.x) * 0.28;
    this.brushAnimator.groundY = targetY;
    const lifted = !own.brushDown;
    this.brush.position.z = lifted ? 0.78 : 0.34;
    this.brushAnimator.set(lifted ? "sad" : "run", { base: true });
    this.brushAnimator.update(now);
    // Farbklecks am Pinsel: solange gemalt wird, sprüht es leicht.
    if (own.brushDown && Math.random() < dt * 12) {
      this.bursts.spawn(
        new THREE.Vector3(targetX, targetY, 0.2),
        [this.ownColor, "#ffffff"],
        { count: 2, speed: 0.5, up: 0.5, size: 0.045, life: 0.4, drag: 2.4 }
      );
    }
  }

  reactToEvents(own, now) {
    if (own.lastSlipAt && own.lastSlipAt !== this.lastSlipAt) {
      this.lastSlipAt = own.lastSlipAt;
      const at = new THREE.Vector3(this.brush.position.x, this.brushAnimator.groundY + 0.3, 0.3);
      this.bursts.spawn(at, ["#ff6b7f", "#ffffff"], { count: 12, speed: 1.4, up: 1.0, size: 0.06, life: 0.5, drag: 2.2 });
      this.floaters.pop(at, "ABGERUTSCHT", { color: "#ff9aa8", size: 0.3, life: 0.8 });
      this.feedback?.sound("error");
      this.feedback?.vibrate(20);
      this.shake = Math.max(this.shake, 0.4);
    }
    if (own.lastGemAt && own.lastGemAt !== this.lastGemAt) {
      this.lastGemAt = own.lastGemAt;
      const gem = own.lastGem;
      const at = new THREE.Vector3(boardX(gem?.x ?? 0.5), boardY(gem?.t ?? 0.5), 0.3);
      this.bursts.spawn(at, ["#ffe36b", "#ffffff"], { count: 10, speed: 1.6, up: 1.2, size: 0.055, life: 0.5, drag: 2.0 });
      this.floaters.pop(at, "+70", { color: "#ffe36b", size: 0.3, life: 0.6 });
      this.feedback?.sound("coin");
      this.feedback?.vibrate(8);
    }
    if (own.lastLapAt && own.lastLapAt !== this.lastLapAt) {
      this.lastLapAt = own.lastLapAt;
      const at = new THREE.Vector3(0, BOARD_H * 0.55, 0.4);
      this.bursts.spawn(at, [this.ownColor, "#ffe36b", "#ffffff"], { count: 20, speed: 2.2, up: 2.4, size: 0.08, life: 0.7, drag: 1.6 });
      this.floaters.pop(at, own.lapSlips === 0 ? "SAUBER!" : "RUNDE!", { color: "#ffe36b", size: 0.42, life: 0.9 });
      this.feedback?.sound("perfect");
      this.feedback?.vibrate([10, 14, 18]);
    }
  }

  updateHud(minigame, arcade, state, now, own) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.max(0, Math.round(own?.score || 0)));

    const laps = this.hud.querySelector("[data-trace-laps]");
    if (laps) {
      laps.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const done = entry?.lapsDone || 0;
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="trace-lap-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${done}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-trace-banner]");
    if (!banner) return;
    const locked = (own?.lockUntil || 0) > now;
    if (locked) {
      banner.hidden = false;
      banner.textContent = "Strich abgerissen — wieder ansetzen";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (!own?.brushDown) {
      banner.hidden = false;
      banner.textContent = (own?.progress || 0) > 0.01 ? "Setz den Finger an der Bruchstelle an" : "Unten auf der Spur ansetzen";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3400";
    } else if ((own?.cleanLaps || 0) >= 2) {
      banner.hidden = false;
      banner.textContent = `${own.cleanLaps} Runden ohne Abrutscher!`;
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Die Tafel soll gross sein, aber ganz im freien Bereich liegen. Gemessen:
      // bei z=6.0 nimmt sie die mittleren 75% der Höhe ein, ihr oberer Rand
      // liegt bei 116 px. Im Dev-Modus reicht die Spielerleiste bis 135 px —
      // dort also etwas weiter weg, sonst ist das Ende der Spur beim Testen
      // nicht erreichbar. Im Querformat ist die Höhe der Engpass.
      const dev = Boolean(this.getState()?.devMode);
      this.baseCamY = BOARD_H / 2;
      this.baseCamZ = portrait ? (dev ? 6.7 : 6.0) : 8.2;
      camera.fov = portrait ? 60 : 46;
    });
  }
}
