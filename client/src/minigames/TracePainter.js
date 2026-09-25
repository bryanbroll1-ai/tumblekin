import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Spurmaler: der Finger zieht die Spur nach — bleibt er im Band, färbt sich
// die Spur, rutscht er ab, reisst der Strich.
//
// Vorher hing eine kleine Figur vor einer senkrechten Tafel in der Luft und
// "lief" auf der Stelle. Jetzt liegt das Brett flach, die Figur läuft die
// Spur entlang und schiebt einen Farbroller, der die Linie malt, stolpert,
// wenn der Strich reisst, und jubelt nach jeder sauberen Runde. Die Kamera
// schaut steil von oben, damit das Nachziehen weiter "nach oben" geht.
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
const RAIL_X = BOARD_W / 2 + 0.3;

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
// Das Brett liegt flach: t = 0 vorn bei der Kamera, t = 1 hinten.
const boardZ = (t) => BOARD_H / 2 - t * BOARD_H;

export class TracePainter extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.rails = new Map();
    this.drawnLap = -1;
    this.paintedUpTo = -1;
    this.lastSlipAt = 0;
    this.lastLapAt = 0;
    this.lastGemAt = 0;
    this.dragging = false;
    this.labelY = 0.74;
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
    this.buildRibbons();
    this.buildGems();
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, BOARD_H), new THREE.MeshLambertMaterial({ color: "#7d8f84" }));
    rail.position.set(RAIL_X, 0, 0);
    scene.add(rail);
    [[-4.6, 5.4, -8, 3], [4.4, 6.2, -9, 8]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Die eigene Figur mit Farbroller; die anderen als Punkte am Rand.
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
    this.trail = make(0.032, 0.024, 1);
  }

  layoutRibbons(seed, lap) {
    [this.band, this.trail].forEach((ribbon) => {
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
    this.paintedUpTo = -1;
  }

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

  ensureRail(player) {
    if (this.rails.has(player.id)) return this.rails.get(player.id);
    const pip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.3 }));
    pip.position.set(RAIL_X, 0.14, boardZ(0));
    this.scene.add(pip);
    const entry = { pip, color: player.color };
    this.rails.set(player.id, entry);
    return entry;
  }

  shot() {
    return {
      look: [0.1, 0, 0.1],
      frame: { w: BOARD_W + 1.2, h: BOARD_H * Math.sin(1.1) + 0.9 },
      fill: 0.95,
      pitch: 1.1,
      fov: 36,
      intro: { yaw: 0.4, pitch: 0.3, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Zieh den Finger auf der Spur nach oben</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      this.dragging = true;
      this.webglCanvas.setPointerCapture?.(event.pointerId);
      this.sendPointer(event);
    });
    this.on(this.webglCanvas, "pointermove", (event) => {
      if (!this.dragging) return;
      event.preventDefault();
      this.sendPointer(event);
    });
    const up = (event) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.webglCanvas.releasePointerCapture?.(event.pointerId);
      this.sendInput({ action: "lift" }).catch(() => {});
    };
    this.on(this.webglCanvas, "pointerup", up);
    this.on(this.webglCanvas, "pointercancel", up);
    this.on(this.webglCanvas, "pointerleave", up);
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.rails.clear();
  }

  sendPointer(event) {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || !this.camera) return;
    const rect = this.webglCanvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, hit)) return;
    const x = clamp(hit.x / BOARD_W + 0.5, 0, 1);
    const y = clamp((BOARD_H / 2 - hit.z) / BOARD_H, 0, 1);
    const jetzt = performance.now();
    if (jetzt - (this.letzterStrich || 0) > 110) {
      this.letzterStrich = jetzt;
      this.feedback?.sound("paint", { pan: (x - 0.5) * 0.6 });
    }
    this.sendInput({ action: "trace", x, y }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const kin = this.kins.get(controlledId);
    const animator = this.animators.get(controlledId);
    if (own && kin && animator) {
      if (own.lap !== this.drawnLap) this.layoutRibbons(arcade.seed, own.lap);
      this.paintRibbons(own.progress || 0, this.ownColor);
      // Die Figur läuft die Spur entlang, in Laufrichtung gedreht.
      const t = clamp(own.progress || 0, 0, 1);
      const px = pathX(arcade.seed, own.lap, t);
      const ahead = pathX(arcade.seed, own.lap, Math.min(1, t + 0.03));
      const targetX = boardX(px);
      const targetZ = boardZ(t);
      kin.position.x += (targetX - kin.position.x) * frameLerp(0.3, dt);
      kin.position.z += (targetZ - kin.position.z) * frameLerp(0.3, dt);
      animator.groundY = 0.3 * 0.72;
      const heading = Math.atan2(boardX(ahead) - targetX, -BOARD_H * 0.03);
      if (!finale) kin.rotation.y += Math.atan2(Math.sin(heading - kin.rotation.y), Math.cos(heading - kin.rotation.y)) * frameLerp(0.2, dt);
      if (this.drum && own.brushDown) this.drum.rotation.x += dt * 10;
      if (!finale) {
        if (own.brushDown) {
          animator.set("shove");
          animator.rate = 0.9;
        } else {
          animator.set("ready");
          animator.rate = 1;
        }
      }
      if (own.brushDown && Math.random() < frameChance(0.4, dt)) {
        this.burst(new THREE.Vector3(targetX, 0.1, targetZ - 0.2), [this.ownColor, "#ffffff"], { count: 1, speed: 0.4, up: 0.4, size: 0.045, life: 0.4, drag: 2.4 });
      }
      this.syncGems(own, now);
      this.reactToEvents(own, kin, animator);
    }
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry || player.id === controlledId) return;
      const rail = this.ensureRail(player);
      const target = boardZ(clamp(entry.progress || 0, 0, 1));
      rail.pip.position.z += (target - rail.pip.position.z) * frameLerp(0.2, dt);
    });
  }

  reactToEvents(own, kin, animator) {
    if (own.lastSlipAt && own.lastSlipAt !== this.lastSlipAt) {
      this.lastSlipAt = own.lastSlipAt;
      animator.trigger("stumble");
      animator.expression("surprised", 700);
      const at = kin.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      this.burst(at, ["#ff6b7f", "#ffffff"], { count: 12, speed: 1.4, up: 1.0, size: 0.06, life: 0.5, drag: 2.2 });
      this.pop(at.clone().add(new THREE.Vector3(0, 0.5, 0)), "ABGERUTSCHT", { color: "#ff9aa8", size: 0.3, life: 0.8 });
      this.feedback?.sound("error");
      this.feedback?.vibrate(20);
      this.rig.shake(0.4);
    }
    if (own.lastGemAt && own.lastGemAt !== this.lastGemAt) {
      this.lastGemAt = own.lastGemAt;
      const gem = own.lastGem;
      const at = new THREE.Vector3(boardX(gem?.x ?? 0.5), 0.4, boardZ(gem?.t ?? 0.5));
      this.burst(at, ["#ffe36b", "#ffffff"], { count: 10, speed: 1.6, up: 1.2, size: 0.055, life: 0.5, drag: 2.0 });
      this.pop(at, "+70", { color: "#ffe36b", size: 0.3, life: 0.6 });
      this.feedback?.sound("coin");
      this.feedback?.vibrate(8);
    }
    if (own.lastLapAt && own.lastLapAt !== this.lastLapAt) {
      this.lastLapAt = own.lastLapAt;
      animator.trigger("celebrate");
      animator.expression("joy", 900);
      const at = new THREE.Vector3(0, 1, 0);
      this.burst(at, [this.ownColor, "#ffe36b", "#ffffff"], { count: 20, speed: 2.2, up: 2.4, size: 0.08, life: 0.7, drag: 1.6 });
      this.pop(at, own.lapSlips === 0 ? "SAUBER!" : "RUNDE!", { color: "#ffe36b", size: 0.42, life: 0.9 });
      this.feedback?.sound("perfect");
      this.feedback?.vibrate([10, 14, 18]);
    }
  }

  keepInView() {
    return [...this.kins.values()];
  }

  drawHud(f) {
    const { arcade, state, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
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
}
