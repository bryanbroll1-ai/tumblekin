import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin81";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin81";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin81";

// Schleuderschuss — zurückziehen lädt Kraft, der Winkel bestimmt die Bahn.
// Nach jedem Schuss weicht die Zielscheibe zurück, also muss jede Kraft neu
// dosiert werden. Der Server rechnet die Flugbahn; hier wird sie nachgespielt.
const KIN_Y = 0.62;
const LANE_GAP = 3.2;
const WORLD_PER_METRE = 0.42;   // Server-Meter → Weltmaß
const SLING_MAX_SPEED = 15;     // muss zum Server passen
const GRAVITY = 9.81;
const FLIGHT_MS = 900;

export class SlingShot {
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
    this.kins = new Map();
    this.animators = new Map();
    this.lanes = new Map();        // playerId -> { group, target, rings, x }
    this.projectiles = [];
    this.lastShots = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
    // Zieh-Geste: Startpunkt, aktueller Zug, daraus Kraft und Winkel.
    this.drag = null;
    this.aim = { power: 0, angle: 45 };
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Schleuderschuss", fog: ["#a8e2f4", 24, 60], fov: 50, far: 110 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="sling-readout" data-sling-readout hidden>
        <span data-sling-power>Kraft 0%</span>
        <span data-sling-angle>45°</span>
      </div>
      <div class="color-banner" data-sling-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <div class="sling-pad" data-sling-pad>
        <div class="sling-pad-hint" data-sling-hint>Ziehen &amp; loslassen</div>
        <div class="sling-pad-vector" data-sling-vector hidden></div>
      </div>
    `;
    this.pad = this.controls.querySelector("[data-sling-pad]");
    this.hint = this.controls.querySelector("[data-sling-hint]");
    this.vector = this.controls.querySelector("[data-sling-vector]");

    // Ziehen funktioniert auf dem Pad UND direkt auf der Szene, damit man den
    // Daumen nicht umsetzen muss.
    this.onDragStart = (event) => this.beginDrag(event);
    this.onDragMove = (event) => this.moveDrag(event);
    this.onDragEnd = (event) => this.endDrag(event);
    [this.pad, this.webglCanvas].forEach((element) => {
      element.addEventListener("pointerdown", this.onDragStart);
    });
    window.addEventListener("pointermove", this.onDragMove, { passive: false });
    window.addEventListener("pointerup", this.onDragEnd);
    window.addEventListener("pointercancel", this.onDragEnd);
    this.loop();
  }

  ownEntry() {
    const arcade = (this.update || this.minigame)?.arcade;
    return arcade?.players?.[this.getControlledPlayerId()] || null;
  }

  canShoot() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = this.ownEntry();
    if (!arcade || !own) return false;
    if ((this.update || this.minigame)?.finaleAt) return false;
    return (own.shotsUsed || 0) < arcade.shots;
  }

  beginDrag(event) {
    if (!this.canShoot()) return;
    event.preventDefault();
    this.drag = { x: event.clientX, y: event.clientY };
    this.aim = { power: 0, angle: 45 };
    this.feedback?.sound("tap");
    this.updateAimUi(true);
  }

  moveDrag(event) {
    if (!this.drag) return;
    event.preventDefault();
    // Nach unten/hinten ziehen spannt die Schleuder: Länge = Kraft,
    // Richtung = Abschusswinkel. Genau wie eine echte Zwille.
    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;
    const length = Math.min(160, Math.hypot(dx, dy));
    this.aim.power = length / 160;
    // Winkelabbildung: senkrecht nach unten ziehen ist die natürliche Bewegung
    // und ergibt deshalb 45° — den weitesten Wurf. Seitlicher Zug kippt den
    // Winkel flacher oder steiler. Erster Versuch bildete senkrecht auf 80° ab,
    // wodurch der intuitive Zug die kürzeste Flugbahn erzeugte.
    const sideways = Math.max(-1, Math.min(1, dx / 120));
    this.aim.angle = 45 + sideways * 25;   // 20°..70°
    this.updateAimUi(true);
  }

  endDrag(event) {
    if (!this.drag) return;
    if (event) event.preventDefault();
    this.drag = null;
    const { power, angle } = this.aim;
    this.updateAimUi(false);
    if (power < 0.06) return;             // versehentliches Antippen
    if (!this.canShoot()) return;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate([12, 8, 18]);
    this.sendInput({ action: "shoot", power, angle }).catch(() => {});
  }

  updateAimUi(active) {
    if (!this.hud) return;
    const readout = this.hud.querySelector("[data-sling-readout]");
    if (readout) {
      readout.hidden = !active;
      const power = this.hud.querySelector("[data-sling-power]");
      const angle = this.hud.querySelector("[data-sling-angle]");
      if (power) power.textContent = `Kraft ${Math.round(this.aim.power * 100)}%`;
      if (angle) angle.textContent = `${Math.round(this.aim.angle)}°`;
    }
    if (this.vector) {
      this.vector.hidden = !active;
      this.vector.style.setProperty("--sling-power", String(this.aim.power));
      this.vector.style.setProperty("--sling-angle", `${this.aim.angle}deg`);
    }
    if (this.hint) this.hint.hidden = active;
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    [this.pad, this.webglCanvas].forEach((element) => {
      element?.removeEventListener("pointerdown", this.onDragStart);
    });
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragEnd);
    window.removeEventListener("pointercancel", this.onDragEnd);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
    this.lanes.clear();
    this.projectiles = [];
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-5, 13, 8],
      shadow: { left: -12, right: 12, top: 12, bottom: -12 }
    });

    // Wiese, die weit nach hinten reicht — die Ziele wandern ja fort.
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.5, 60),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.set(0, -0.25, -20);
    meadow.receiveShadow = true;
    this.scene.add(meadow);

    // Entfernungsmarken, damit man die Distanz einschätzen kann.
    for (let metre = 5; metre <= 25; metre += 5) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(30, 0.05, 0.16),
        new THREE.MeshLambertMaterial({ color: "#e6f2da" })
      );
      stripe.position.set(0, 0.03, -metre * WORLD_PER_METRE);
      this.scene.add(stripe);
    }

    [[-9, 6.4, -14, 5], [9, 7.2, -20, 6], [0, 8, -28, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    // Landevorschau: gepunktete Flugbahn plus Ring am Aufschlagpunkt. Ohne sie
    // ist Ballistik mit dem Daumen kaum dosierbar — der erste Testlauf verfehlte
    // dreimal in Folge, weil man die Wirkung des Zuges nicht sehen konnte.
    this.previewDots = [];
    for (let i = 0; i < 14; i += 1) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 6, 5),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.75, depthWrite: false })
      );
      dot.visible = false;
      this.scene.add(dot);
      this.previewDots.push(dot);
    }
    this.previewRing = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.36, 20),
      new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    this.previewRing.rotation.x = -Math.PI / 2;
    this.previewRing.visible = false;
    this.scene.add(this.previewRing);

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureLane(player, index, players.length));
    this.resizeRenderer();
    this.camera.position.set(0, 3.6, 6.2);
    this.camera.lookAt(0, 1.2, -4);
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  // Zielscheibe: konzentrische Ringe, deren Farben zu den Punkten passen.
  buildTarget() {
    const group = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 1.1, 0.12),
      new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
    );
    post.position.y = 0.55;
    post.castShadow = true;
    group.add(post);

    const colors = ["#ffe36b", "#ff9f4a", "#7bd0ff", "#cfd8d3"];
    const radii = [0.22, 0.4, 0.58, 0.78];
    for (let index = radii.length - 1; index >= 0; index -= 1) {
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(radii[index], radii[index], 0.06 + (radii.length - index) * 0.01, 20),
        new THREE.MeshLambertMaterial({
          color: colors[index],
          emissive: colors[index],
          emissiveIntensity: index === 0 ? 0.4 : 0.1
        })
      );
      disc.rotation.x = Math.PI / 2;
      disc.position.set(0, 1.35, -0.02 * index);
      disc.castShadow = index === radii.length - 1;
      group.add(disc);
    }
    group.userData = { phase: Math.random() * Math.PI * 2 };
    return group;
  }

  ensureLane(player, index = 0, count = 4) {
    if (this.lanes.has(player.id)) return this.lanes.get(player.id);
    const x = this.laneX(index, count);

    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.45);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.position.set(x, KIN_Y, 1.6);
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_Y;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);

    // Die Schleuder vor der Figur — sichtbares Werkzeug statt abstrakter Geste.
    const fork = new THREE.Group();
    [-0.14, 0.14].forEach((side) => {
      const prong = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.5, 0.07),
        new THREE.MeshLambertMaterial({ color: "#a9713c" })
      );
      prong.position.set(side, 0.55, 0);
      prong.rotation.z = side * -0.28;
      fork.add(prong);
    });
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.34, 0.1),
      new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
    );
    grip.position.y = 0.18;
    fork.add(grip);
    fork.position.set(x, 0, 1.1);
    this.scene.add(fork);

    const target = this.buildTarget();
    this.scene.add(target);

    const lane = { x, target, fork, color: player.color };
    this.lanes.set(player.id, lane);
    return lane;
  }

  // Bahn nachspielen: gleiche Formel wie auf dem Server, damit das Bild zur
  // Wertung passt.
  spawnProjectile(playerId, shot) {
    const lane = this.lanes.get(playerId);
    if (!lane) return;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshLambertMaterial({ color: "#3d4a58" })
    );
    mesh.castShadow = true;
    this.scene.add(mesh);
    const speed = shot.power * SLING_MAX_SPEED;
    const angle = (shot.angleDeg * Math.PI) / 180;
    this.projectiles.push({
      mesh,
      playerId,
      laneX: lane.x,
      vy: speed * Math.sin(angle),
      vz: speed * Math.cos(angle),
      range: shot.range,
      ring: shot.ring,
      startedAt: this.now()
    });
    this.feedback?.sound("whoosh", { pan: lane.x * 0.2 });
  }

  updateProjectiles(now, dt) {
    this.projectiles = this.projectiles.filter((shot) => {
      const t = (now - shot.startedAt) / FLIGHT_MS;
      if (t >= 1) {
        this.landProjectile(shot);
        return false;
      }
      // Flugzeit auf FLIGHT_MS normiert, Bahn bleibt eine echte Parabel.
      const flightTime = (2 * shot.vy) / GRAVITY;
      const time = t * flightTime;
      const height = shot.vy * time - 0.5 * GRAVITY * time * time;
      const distance = shot.vz * time;
      shot.mesh.position.set(
        shot.laneX,
        Math.max(0.1, 0.9 + height * WORLD_PER_METRE),
        1.1 - distance * WORLD_PER_METRE
      );
      // Drehung je SEKUNDE: fest je Bild wirbelte das Geschoss auf einem
      // 120-Hz-Schirm doppelt so schnell.
      shot.mesh.rotation.x += 18 * dt;
      return true;
    });
  }

  landProjectile(shot) {
    const at = shot.mesh.position.clone();
    this.scene.remove(shot.mesh);
    shot.mesh.geometry.dispose();
    shot.mesh.material.dispose();

    const own = shot.playerId === this.getControlledPlayerId();
    if (shot.ring === 0) {
      this.bursts.spawn(at, ["#ffe36b", "#ffffff", "#ffb400"], { count: 26, speed: 2.6, up: 2.6, size: 0.08, life: 0.9, drag: 1.2 });
      this.bursts.ring(at, "#ffe36b", { radius: 1.8, life: 0.6, opacity: 0.7, tilt: null });
      this.floaters.pop(at.clone().add(new THREE.Vector3(0, 0.6, 0)), "BULLSEYE!", { color: "#ffe36b", size: 0.5, life: 1.3 });
      if (own) { this.feedback?.sound("perfect"); this.feedback?.vibrate([10, 18, 26]); this.shake = Math.max(this.shake, 0.5); }
    } else if (shot.ring === null) {
      this.bursts.spawn(at, ["#c9b79a", "#e6f2da"], { count: 10, speed: 1.5, up: 1.2, size: 0.06, life: 0.6, gravity: 7, drag: 2 });
      this.floaters.pop(at.clone().add(new THREE.Vector3(0, 0.5, 0)), "DANEBEN", { color: "#ff9aa8", size: 0.36, life: 0.9 });
      if (own) { this.feedback?.sound("error"); this.feedback?.vibrate(18); }
    } else {
      this.bursts.spawn(at, ["#7bd0ff", "#ffffff"], { count: 14, speed: 1.9, up: 1.8, size: 0.07, life: 0.7, drag: 1.6 });
      this.floaters.pop(at.clone().add(new THREE.Vector3(0, 0.55, 0)), `RING ${shot.ring + 1}`, { color: "#bfe9ff", size: 0.38, life: 1 });
      if (own) { this.feedback?.sound("pop"); this.feedback?.vibrate(12); }
    }
  }

  // Zeichnet die Flugbahn des aktuellen Zuges. Nutzt exakt die Serverformel,
  // damit die Vorschau nicht lügt.
  updatePreview(arcade, controlledId) {
    const active = Boolean(this.drag) && this.canShoot();
    const lane = this.lanes.get(controlledId);
    if (!active || !lane) {
      this.previewDots.forEach((dot) => { dot.visible = false; });
      if (this.previewRing) this.previewRing.visible = false;
      return;
    }
    const speed = this.aim.power * SLING_MAX_SPEED;
    const angle = (this.aim.angle * Math.PI) / 180;
    const range = (speed * speed * Math.sin(2 * angle)) / GRAVITY;
    const flightTime = (2 * speed * Math.sin(angle)) / GRAVITY || 0.0001;

    this.previewDots.forEach((dot, index) => {
      const t = ((index + 1) / (this.previewDots.length + 1)) * flightTime;
      const height = speed * Math.sin(angle) * t - 0.5 * GRAVITY * t * t;
      const distance = speed * Math.cos(angle) * t;
      dot.position.set(lane.x, 0.9 + height * WORLD_PER_METRE, 1.1 - distance * WORLD_PER_METRE);
      dot.visible = true;
      dot.material.opacity = 0.28 + (1 - index / this.previewDots.length) * 0.5;
    });

    const own = arcade.players[controlledId];
    const target = own ? own.distance : 0;
    const miss = Math.abs(range - target);
    this.previewRing.position.set(lane.x, 0.08, 1.1 - range * WORLD_PER_METRE);
    this.previewRing.visible = true;
    // Der Ring wird grün, wenn der Zug treffen würde — sofortige Rückmeldung.
    this.previewRing.material.color.set(miss <= 0.35 ? "#7fe06f" : (miss <= 1.6 ? "#ffe36b" : "#ff9aa8"));
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

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const lane = this.ensureLane(player, index, state.players.length);
      const animator = this.animators.get(player.id);
      const kin = this.kins.get(player.id);

      // Zielscheibe auf die aktuelle Distanz stellen; sie weicht sichtbar zurück.
      const targetZ = 1.1 - entry.distance * WORLD_PER_METRE;
      lane.target.position.x = lane.x;
      lane.target.position.z = THREE.MathUtils.lerp(lane.target.position.z || targetZ, targetZ, frameLerp(0.12, dt));
      lane.target.position.y = Math.sin(now / 900 + lane.target.userData.phase) * 0.04;

      // Neuer Schuss vom Server → Flugbahn nachspielen.
      const shot = entry.lastShot;
      const seen = this.lastShots.get(player.id);
      if (shot && shot.at !== seen) {
        this.lastShots.set(player.id, shot.at);
        this.spawnProjectile(player.id, shot);
        animator?.trigger(shot.ring === 0 ? "cheer" : "hit");
      }

      const done = (entry.shotsUsed || 0) >= arcade.shots;
      if (minigame.finaleAt) animator?.set("cheer", { base: true });
      else animator?.set(done ? "sad" : "idle", { base: true });
      animator?.update(now);

      // Die Schleuder spannt sich mit, während man zieht.
      const aiming = player.id === controlledId && this.drag;
      lane.fork.rotation.x = aiming ? -this.aim.power * 0.25 : 0;

      if (kin) {
        kin.userData.shadow.position.set(kin.position.x, 0.05, kin.position.z);
        kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
      }
    });

    this.updatePreview(arcade, controlledId);
    this.updateProjectiles(now, dt);
    this.bursts.update(dt);
    this.floaters.update(dt);

    // Kamera bleibt auf der eigenen Bahn und folgt der Distanz nach hinten.
    this.shake *= frameDecay(0.9, dt);
    const own = arcade.players[controlledId];
    const ownLane = this.lanes.get(controlledId);
    const depth = own ? own.distance * WORLD_PER_METRE : 4;
    const shakeX = Math.sin(now / 15) * this.shake * 0.2 * shakeScale();
    // Voll auf die eigene Bahn zentrieren. Ein Bruchteil davon (erster Versuch:
    // 0.55) schob den eigenen Kin an den Bildrand, während der Nachbar mittig
    // stand — man sah beim Zielen die falsche Bahn.
    const ownX = ownLane?.x || 0;
    const desired = new THREE.Vector3(
      ownX + shakeX,
      (this.baseCamY || 3.6) + depth * 0.14,
      (this.baseCamZ || 6.2) + depth * 0.12
    );
    this.camera.position.lerp(desired, frameLerp(0.08, dt));
    // Blick zwischen Schütze und Zielscheibe, damit beide im Bild bleiben.
    this.camera.lookAt(ownX, 1.0, 1.1 - depth * 0.62);

    this.updateHud(minigame, arcade, state, now);
    syncOwnMarker(this, this.kins?.get(controlledId), now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.score || 0);

    const banner = this.hud.querySelector("[data-sling-banner]");
    if (banner) {
      const left = Math.max(0, arcade.shots - (own?.shotsUsed || 0));
      if (!own) {
        banner.hidden = true;
      } else if (left === 0) {
        banner.hidden = false;
        banner.textContent = `Alle Schüsse raus — ${own.score} Punkte`;
        banner.style.background = "#12aaff";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = false;
        banner.textContent = `${left} ${left === 1 ? "Schuss" : "Schüsse"} · ${Math.round(own.distance)} m`;
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      }
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 3.9 : 3.6;
      this.baseCamZ = portrait ? 7.0 : 6.2;
      camera.fov = portrait ? 58 : 50;
    });
  }
}
