import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  disposeScene
} from "./VoxelKit.js?v=tumblekin63";
import { createOwnMarker, updateOwnMarker } from "./VoxelKit.js?v=tumblekin63";

// Nervenprobe — all four Kins face the camera behind a timer podium.
// The clock counts visibly for two seconds, then hides. Everyone slams
// their red button at the target time; at the end all times are revealed
// and the closest guess wins.
const PODIUM_GAP = 1.55;
const KIN_Y = 1.32;

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

// A blocky game-show clock driven by a canvas texture: dark glass screen,
// glowing digits, rounded accent bezel.
function createTimerDisplay() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const dark = new THREE.MeshLambertMaterial({ color: "#1a2230" });
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 0.6, 0.12),
    [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: texture }), dark]
  );
  panel.userData = { canvas, ctx, texture, lastText: null, lastAccent: null };
  return panel;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintDisplay(panel, text, accent = "#7df0a0") {
  const { ctx, canvas, texture, lastText, lastAccent } = panel.userData;
  if (lastText === text && lastAccent === accent) return;
  panel.userData.lastText = text;
  panel.userData.lastAccent = accent;
  // Screen glass with a soft top sheen.
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#182031");
  bg.addColorStop(0.45, "#0b1220");
  bg.addColorStop(1, "#060a12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(0, 0, canvas.width, 34);
  // Accent bezel with glow.
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 7;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 14;
  roundedRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 18);
  ctx.stroke();
  ctx.restore();
  // Corner rivets for the blocky look.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  [[20, 20], [canvas.width - 20, 20], [20, canvas.height - 20], [canvas.width - 20, canvas.height - 20]].forEach(([x, y]) => {
    ctx.fillRect(x - 3, y - 3, 6, 6);
  });
  // Glowing digits.
  ctx.save();
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  ctx.font = "bold 58px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  ctx.restore();
  texture.needsUpdate = true;
}

export class Nervenprobe {
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
    this.stations = new Map();
    this.lastStopped = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.revealed = false;
    this.hidAt = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.canvas.hidden = true;
    this.webglCanvas = document.createElement("canvas");
    this.webglCanvas.className = `${this.canvas.className} kinetic-webgl`;
    this.webglCanvas.setAttribute("aria-label", "3D Nervenprobe");
    this.canvas.insertAdjacentElement("afterend", this.webglCanvas);

    this.hud = document.createElement("div");
    this.hud.className = "kinetic-hud";
    this.hud.innerHTML = `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-nerve-target></strong></div>
      <div class="color-banner" data-nerve-banner hidden></div>
    `;
    this.webglCanvas.insertAdjacentElement("afterend", this.hud);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-nerve-stop>
        <span class="nerve-button-face">STOPP</span>
      </button>
    `;
    this.stopButton = this.controls.querySelector("[data-nerve-stop]");
    this.onStopDown = (event) => {
      event.preventDefault();
      this.pressStop();
    };
    this.stopButton.addEventListener("pointerdown", this.onStopDown);
    this.loop();
  }

  pressStop() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.stoppedMs !== null) return;
    this.feedback?.sound("pop");
    this.feedback?.vibrate([14, 10, 22]);
    this.shake = Math.max(this.shake, 0.5);
    this.sendInput({ action: "stop" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.canvas.hidden = false;
    this.bursts?.dispose();
    if (this.scene) disposeScene(this.scene);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.webglCanvas?.remove();
    this.hud?.remove();
    this.webglCanvas = null;
    this.hud = null;
    this.scene = null;
    this.renderer = null;
    this.kins.clear();
    this.animators.clear();
    this.stations.clear();
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#a4e0f5");
    this.scene.fog = new THREE.Fog("#b0e6f7", 18, 42);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.webglCanvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x74b6c8, 2.3));
    const sun = new THREE.DirectionalLight(0xfff2cf, 3.0);
    sun.position.set(-4, 10, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    this.scene.add(sun);

    // A proper game-show stage: warm floor, red carpet, curtain backdrop,
    // bunting between golden pillars, sweeping spotlights and star sparkles.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(13, 0.5, 9),
      new THREE.MeshLambertMaterial({ color: "#e8a94f" })
    );
    floor.position.y = -0.25;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(9.6, 0.4, 4.8),
      new THREE.MeshLambertMaterial({ color: "#b8478a" })
    );
    stage.position.set(0, 0.06, -0.4);
    stage.receiveShadow = true;
    this.scene.add(stage);
    const carpet = new THREE.Mesh(
      new THREE.BoxGeometry(7.8, 0.06, 1.15),
      new THREE.MeshLambertMaterial({ color: "#e0334f" })
    );
    carpet.position.set(0, 0.3, 1.55);
    carpet.receiveShadow = true;
    this.scene.add(carpet);

    // Curtain backdrop: alternating pleats instead of one flat slab.
    for (let i = 0; i < 12; i += 1) {
      const pleat = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 4.6, 0.4 + (i % 2) * 0.18),
        new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? "#7a4ddb" : "#6a3fc4" })
      );
      pleat.position.set((i - 5.5) * 0.95, 2.1, -3.6);
      this.scene.add(pleat);
    }
    const valance = new THREE.Mesh(
      new THREE.BoxGeometry(11.6, 0.55, 0.7),
      new THREE.MeshLambertMaterial({ color: "#ffb400" })
    );
    valance.position.set(0, 4.55, -3.5);
    this.scene.add(valance);

    [[-4.9, "#ffc400"], [4.9, "#ffc400"]].forEach(([x, color]) => {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 4.6, 0.6),
        new THREE.MeshLambertMaterial({ color })
      );
      pillar.position.set(x, 2.05, -3.1);
      this.scene.add(pillar);
      const knob = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.35, 0.8),
        new THREE.MeshLambertMaterial({ color: "#ff5c8a" })
      );
      knob.position.set(x, 4.5, -3.1);
      this.scene.add(knob);
    });

    // Bunting: candy flags strung between the pillars.
    const flagColors = ["#ff2e6a", "#12aaff", "#ffc400", "#33cf4d", "#ff8b2e"];
    for (let i = 0; i < 11; i += 1) {
      const t = i / 10;
      const sag = Math.sin(t * Math.PI) * 0.55;
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.3, 0.06),
        new THREE.MeshLambertMaterial({ color: flagColors[i % flagColors.length] })
      );
      flag.position.set(-4.9 + t * 9.8, 4.32 - sag, -2.95);
      flag.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.12;
      this.scene.add(flag);
    }

    // Two soft spotlight cones sweeping over the stage.
    this.spotCones = [];
    [[-2.6, "#fff3c4"], [2.6, "#ffe1f0"]].forEach(([x, color], index) => {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, 5.2, 8, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
      );
      cone.position.set(x, 3.2, -1);
      cone.rotation.x = 0.3;
      cone.userData = { phase: index * Math.PI };
      this.scene.add(cone);
      this.spotCones.push(cone);
    });

    // Gold star sparkles on the curtain.
    this.stars = [];
    [[-3.4, 3.3], [-1.2, 2.6], [1.6, 3.5], [3.6, 2.8], [0.2, 1.7], [-2.4, 1.4], [2.6, 1.6]].forEach(([x, y], index) => {
      const star = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.1),
        new THREE.MeshLambertMaterial({ color: "#ffd76a", emissive: "#ffd76a", emissiveIntensity: 0.6 })
      );
      star.position.set(x, y, -3.28);
      star.rotation.z = Math.PI / 4;
      star.userData = { phase: index * 0.9 };
      this.scene.add(star);
      this.stars.push(star);
    });

    [[-6, 5.4, -4, 5], [6, 6, -2, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureStation(player, index, players.length));
    this.resizeRenderer();
    // Start on the final framing — no camera fly-in.
    this.camera.position.set(0, 3.1, this.baseCameraZ || 9.6);
    this.camera.lookAt(0, 1.35, 0);
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * PODIUM_GAP;
  }

  ensureStation(player, index, count) {
    if (this.stations.has(player.id)) return this.stations.get(player.id);
    const x = this.stationX(index, count);

    // Podium with a big red buzzer on top.
    const podium = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.8, 0.9),
      new THREE.MeshLambertMaterial({ color: "#fdf5e6" })
    );
    podium.position.set(x, 0.66, 0.7);
    podium.castShadow = true;
    podium.receiveShadow = true;
    this.scene.add(podium);
    const buzzerBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.1, 0.5),
      new THREE.MeshLambertMaterial({ color: "#c0c9d4" })
    );
    buzzerBase.position.set(x, 1.11, 0.7);
    this.scene.add(buzzerBase);
    const buzzer = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.2, 0.38),
      new THREE.MeshLambertMaterial({ color: "#ff2038" })
    );
    buzzer.position.set(x, 1.26, 0.7);
    buzzer.castShadow = true;
    this.scene.add(buzzer);

    // The timer clock floats above the podium: player-coloured bezel frame,
    // glass screen, status bulb on top.
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.32, 0.74, 0.1),
      new THREE.MeshLambertMaterial({ color: player.color })
    );
    frame.position.set(x, 1.95, 0.49);
    this.scene.add(frame);
    const display = createTimerDisplay();
    display.position.set(x, 1.95, 0.55);
    this.scene.add(display);
    const bulb = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.18),
      new THREE.MeshLambertMaterial({ color: "#2ee86a", emissive: new THREE.Color("#2ee86a"), emissiveIntensity: 0.8 })
    );
    bulb.position.set(x + 0.57, 2.42, 0.5);
    this.scene.add(bulb);

    // The player's name floats above their clock, not over the digits.
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.set(x, 2.62, 0.5);
    this.scene.add(label);
    // Little stand legs connecting clock and podium.
    [[-0.4], [0.4]].forEach(([dx]) => {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.55, 0.08),
        new THREE.MeshLambertMaterial({ color: "#c0c9d4" })
      );
      leg.position.set(x + dx, 1.35, 0.52);
      this.scene.add(leg);
    });

    // A riser step so every Kin stands visibly above the podium edge,
    // looking straight into the camera.
    const riser = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.62, 0.8),
      new THREE.MeshLambertMaterial({ color: "#e8709f" })
    );
    riser.position.set(x, 0.57, -0.42);
    riser.castShadow = true;
    riser.receiveShadow = true;
    this.scene.add(riser);

    // The Kin stands behind the podium and looks straight at the camera.
    const kin = createVoxelKin(player.color, index);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.shadow = shadow;
    kin.position.set(x, KIN_Y, -0.35);
    kin.rotation.y = 0;
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_Y;

    const station = { podium, buzzer, display, bulb, label, x };
    this.stations.set(player.id, station);
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);
    return station;
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
    const elapsed = Math.max(0, now - minigame.startedAt);
    const hidden = elapsed >= arcade.hideAfterMs;
    const revealAll = Boolean(minigame.finaleAt);

    if (hidden && !this.hidAt) {
      this.hidAt = true;
      this.feedback?.sound("move");
    }
    if (revealAll && !this.revealed) {
      this.revealed = true;
      this.feedback?.sound("win");
      this.feedback?.vibrate([30, 30, 60]);
    }

    const players = state.players || [];
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const station = this.ensureStation(player, index, players.length);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const stopped = entry.stoppedMs !== null && entry.stoppedMs !== undefined;

      // Timer panel: visible count → hidden "?" → reveal at the end.
      if (revealAll) {
        const deviation = entry.deviationMs ?? null;
        paintDisplay(
          station.display,
          stopped ? formatSeconds(entry.stoppedMs) : "—",
          deviation !== null && deviation < 400 ? "#7df0a0" : "#ffd166"
        );
      } else if (stopped) {
        paintDisplay(station.display, "STOP", "#8fd4ff");
      } else if (!hidden) {
        paintDisplay(station.display, formatSeconds(elapsed), "#7df0a0");
      } else {
        // Hidden phase: pulsing question marks keep the tension up.
        const blink = Math.floor(now / 400) % 2 === 0;
        paintDisplay(station.display, "? ? ?", blink ? "#ff5c8a" : "#c86a92");
      }

      // Buzzer sinks in once pressed.
      station.buzzer.position.y = THREE.MathUtils.lerp(station.buzzer.position.y, stopped ? 1.18 : 1.26, 0.25);

      // Status bulb: green while counting, blinking red while hidden,
      // blue once stopped, gold at the reveal.
      const bulbColor = revealAll ? "#ffd76a" : stopped ? "#12aaff" : hidden ? "#ff2038" : "#2ee86a";
      station.bulb.material.color.set(bulbColor);
      station.bulb.material.emissive.set(bulbColor);
      station.bulb.material.emissiveIntensity = hidden && !stopped && !revealAll
        ? (Math.floor(now / 320) % 2 === 0 ? 1.1 : 0.15)
        : 0.8;

      if (stopped && !this.lastStopped.get(player.id)) {
        this.lastStopped.set(player.id, true);
        animator.trigger("jump");
        this.bursts.spawn(new THREE.Vector3(station.x, 1.4, 0.7), ["#ff2038", "#ffffff"], { count: 8, speed: 1.8, up: 1.6, size: 0.07, life: 0.5 });
        if (player.id !== controlledId) this.feedback?.sound("move");
      }

      // Finale: closest guess celebrates, everyone else applauds/sighs.
      if (revealAll) {
        const best = Math.min(...players
          .map((candidate) => arcade.players[candidate.id]?.deviationMs)
          .filter((value) => value !== null && value !== undefined));
        const isWinner = stopped && entry.deviationMs === best;
        animator.set(isWinner ? "cheer" : (stopped ? "idle" : "sad"), { base: true });
        if (isWinner && !kin.userData.confettiDone) {
          kin.userData.confettiDone = true;
          this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.4, 0)), [player.color, "#ffc400", "#ffffff"], { count: 18, speed: 2.4, up: 2.8, size: 0.09, life: 0.9 });
        }
      } else {
        // Nervous idle while waiting, tiny shiver during the hidden phase.
        animator.set("idle", { base: true });
        if (hidden && !stopped) {
          kin.position.x = station.x + Math.sin(now / 90 + index * 2) * 0.02;
        } else {
          kin.position.x = station.x;
        }
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.9, kin.position.z);
      station.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);

    // Ambient show life: spotlights sweep, curtain stars twinkle.
    this.spotCones?.forEach((cone) => {
      cone.rotation.z = Math.sin(now / 1600 + cone.userData.phase) * 0.35;
      cone.material.opacity = 0.1 + Math.abs(Math.sin(now / 900 + cone.userData.phase)) * 0.08;
    });
    this.stars?.forEach((star) => {
      star.material.emissiveIntensity = 0.35 + Math.abs(Math.sin(now / 500 + star.userData.phase)) * 0.65;
    });

    // Static show camera with a light breathing motion + press shake.
    this.shake *= 0.88;
    const shakeX = Math.sin(now / 17) * this.shake * 0.1;
    const breathe = Math.sin(now / 1400) * 0.08;
    const desired = new THREE.Vector3(shakeX, 3.1 + breathe, this.baseCameraZ || 9.6);
    this.camera.position.lerp(desired, 0.1);
    this.camera.lookAt(0, 1.35, 0);

    this.updateHud(minigame, arcade, state, hidden, revealAll, now, elapsed);
    // Global: a downward arrow marks your own kin so you never lose yourself.
    { const oid = this.getControlledPlayerId(); const ok = this.kins && this.kins.get(oid);
      if (ok) { if (!this.ownMarker) { this.ownMarker = createOwnMarker(); this.scene.add(this.ownMarker); }
        this.ownMarker.visible = ok.visible !== false;
        this.ownMarker.position.set(ok.position.x, 0, ok.position.z);
        updateOwnMarker(this.ownMarker, now, ok.position.y + 0.35); } }
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, hidden, revealAll, now, elapsed) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-nerve-target]").textContent = `Ziel: ${(arcade.targetMs / 1000).toFixed(1)}s`;

    const banner = this.hud.querySelector("[data-nerve-banner]");
    const own = arcade.players[this.getControlledPlayerId()];
    const stopped = own?.stoppedMs !== null && own?.stoppedMs !== undefined;
    if (revealAll) {
      banner.hidden = false;
      banner.textContent = "Auflösung!";
      banner.style.background = "#ffc400";
      banner.style.color = "#5c4508";
    } else if (stopped) {
      banner.hidden = false;
      banner.textContent = "Gestoppt ✓";
      banner.style.background = "#12aaff";
      banner.style.color = "#ffffff";
    } else if (hidden) {
      banner.hidden = false;
      banner.textContent = "Zähl im Kopf weiter!";
      banner.style.background = "#ff2e6a";
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }

    if (this.stopButton) this.stopButton.disabled = stopped || revealAll;
  }

  resizeRenderer() {
    const rect = this.webglCanvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (this.webglCanvas.width === Math.floor(width * ratio) && this.webglCanvas.height === Math.floor(height * ratio)) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const portrait = height > width;
    this.baseCameraZ = portrait ? 12.2 : 9.6;
    this.camera.fov = portrait ? 54 : 44;
    this.camera.updateProjectionMatrix();
  }
}
