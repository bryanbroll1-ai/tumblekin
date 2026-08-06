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
  standOn
} from "./VoxelKit.js?v=tumblekin116";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage,
  fitKinsInView,
  dressMeadow
} from "./SceneKit.js?v=tumblekin116";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin116";

// Messerwurf — a big log spins face-on; tap to stick a knife into it.
// Land on top of another player's knife and you are out. The log flips
// direction and speeds up each round, so timing gets trickier.
// Kleine Scheibe, mittig im Bild. Vorher füllte sie mit 1.5 fast die Breite;
// die Lücken zwischen den Messern waren dadurch riesige Flächen statt eines
// engen Ziels, und das Spiel wirkte grob.
const LOG_R = 1.02;
// Nur die SPITZE steckt. Der Angriffspunkt liegt deshalb ein Stück AUSSERHALB
// des Randes: von dort ragt die Klinge gerade so weit hinein, wie eine Spitze
// eben eindringt — vorher steckte die ganze Klinge bis zum Griff im Holz.
const KNIFE_R = LOG_R + 0.02;
const KNIFE_BITE = 0.14;              // wie tief die Spitze ins Holz geht
const GROUND_Y = 0;                 // Oberkante der Wiese
const KIN_Y = standOn(GROUND_Y);
const LOG_Y = 4.0;             // the disc floats a little higher above the throwers
const LOG_Z = -0.3;
const SPOTS = [-2.4, -0.8, 0.8, 2.4];

function buildKnife(color) {
  const knife = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.72, 0.035),
    new THREE.MeshLambertMaterial({ color: "#d8dee8" })
  );
  blade.position.y = 0.36;
  knife.add(blade);
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.055, 0.075),
    new THREE.MeshLambertMaterial({ color: "#ffd15c" })
  );
  guard.position.y = 0.02;
  knife.add(guard);
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.3, 0.07),
    new THREE.MeshLambertMaterial({ color: color || "#8a5a2c" })
  );
  handle.position.y = -0.16;
  knife.add(handle);
  return knife;
}

export class KnifeThrow {
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
    this.knifeMeshes = [];
    this.lastStuck = new Map();
    this.lastEliminated = new Map();
    this.lastFrameAt = performance.now();
    this.lastServerAt = performance.now();
    this.localAngle = 0;
    this.shake = 0;
    this.finaleDone = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Messerwurf" });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-knife-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-knife-throw>
        <span class="nerve-button-face">WERFEN!</span>
      </button>
    `;
    this.throwButton = this.controls.querySelector("[data-knife-throw]");
    this.onThrowDown = (event) => {
      event.preventDefault();
      this.pressThrow();
    };
    this.throwButton.addEventListener("pointerdown", this.onThrowDown);
    this.onCanvasTap = (event) => {
      event.preventDefault();
      this.pressThrow();
    };
    this.webglCanvas.addEventListener("pointerdown", this.onCanvasTap);
    this.loop();
  }

  pressThrow() {
    const arcade = (this.update || this.minigame)?.arcade;
    const id = this.getControlledPlayerId();
    const own = arcade?.players?.[id];
    if (!own || own.eliminated || own.turnDone) return;
    if (arcade.activeId !== id) return;   // only on your own turn
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(12);
    this.sendInput({ action: "throw" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
    this.lastServerAt = performance.now();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    if (this.onCanvasTap) this.webglCanvas.removeEventListener("pointerdown", this.onCanvasTap);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
    this.knifeMeshes = [];
  }

  createScene() {
    addStageLights(this.scene);

    // Forest clearing with a mounted log to throw at.
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    this.scene.add(meadow);
    // Kulisse: Bodenflecken, Büschel, Blumen, Steine und ein Baumkranz als
    // Horizont. Ohne sie stösst die Wiese als harte Kante gegen den Himmel.
    dressMeadow(this.scene, { seed: 13, keepOut: { x: 4.2, z: 4.6 }, spread: { x: 17, z: 15 } });
    // Two tall support posts holding the disc up above the throwers.
    [-2.1, 2.1].forEach((x) => {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, LOG_Y + 1.2, 0.34),
        new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
      );
      post.position.set(x, (LOG_Y + 1.2) / 2 - 0.25, LOG_Z - 0.3);
      post.castShadow = true;
      this.scene.add(post);
    });
    const crossbeam = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 0.3, 0.3),
      new THREE.MeshLambertMaterial({ color: "#6e4522" })
    );
    crossbeam.position.set(0, LOG_Y + 1.1, LOG_Z - 0.3);
    this.scene.add(crossbeam);

    // The spinning log: a cylinder face-on to the camera.
    this.log = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(LOG_R, LOG_R, 0.7, 20),
      new THREE.MeshLambertMaterial({ color: "#b07a3e" })
    );
    trunk.rotation.x = Math.PI / 2;
    trunk.castShadow = true;
    this.log.add(trunk);
    // Bark rings + a face with tree-ring circles so the spin is readable.
    for (let r = 0.55; r < LOG_R; r += 0.55) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.035, 6, 24),
        new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
      );
      ring.position.z = 0.36;
      this.log.add(ring);
    }
    // A bright wedge marker so the rotation is obvious.
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, LOG_R * 0.9, 0.06),
      new THREE.MeshLambertMaterial({ color: "#ff5c8a" })
    );
    marker.position.set(0, LOG_R * 0.45, 0.37);
    this.log.add(marker);
    this.log.position.set(0, LOG_Y, LOG_Z);
    this.scene.add(this.log);

    this.knifeGroup = new THREE.Group();
    this.log.add(this.knifeGroup);
    // Pool for knives flying up from a thrower into the disc.
    this.flyingKnives = [];

    [[-6, 5.2, -5, 5], [6, 6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    this.camera.position.set(0, 2.9, 7.4);
    this.camera.lookAt(0, 2.7, LOG_Z);
  }

  // The ACTIVE thrower stands dead centre, directly under the disc; the others
  // flank them symmetrically so everyone stays readable.
  spotForPlayer(playerId, index, count) {
    const arcade = (this.update || this.minigame)?.arcade;
    const centreId = arcade?.activeId || this.getControlledPlayerId();
    if (playerId === centreId) return 0;
    const players = this.getState()?.players || [];
    const others = players.filter((p) => p.id !== centreId).map((p) => p.id);
    // Gerechnet: die Werfer stehen bei z = 2.4, die Kamera bei 8.9 — macht rund
    // 7 Einheiten Abstand, und sichtbar sind davon 1.64 nach jeder Seite. Bei
    // ±2.4 stand der äussere Werfer samt Namensschild ausserhalb des Bildes.
    const flanks = [-1.35, 1.35, -0.72, 0.72];
    const slot = others.indexOf(playerId);
    return flanks[(slot >= 0 ? slot : index) % flanks.length];
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.45);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    const count = this.getState()?.players?.length || 4;
    kin.userData.spotX = this.spotForPlayer(player.id, index, count);
    kin.position.set(kin.userData.spotX, KIN_Y, 2.4);
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_Y;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);
    return kin;
  }

  // Reconcile the shared knife list into the spinning group, launching a
  // knife that visibly flies up from the thrower into the disc.
  syncKnives(arcade) {
    const knives = arcade.knives || [];
    while (this.knifeMeshes.length < knives.length) {
      const data = knives[this.knifeMeshes.length];
      const owner = this.getState()?.players?.find((player) => player.id === data.playerId);
      const holder = new THREE.Group();
      holder.rotation.z = -(data.angleDeg * Math.PI) / 180;
      const knife = buildKnife(owner?.color);
      // Stick into the bottom rim of the wheel, blade pointing up into it, like
      // the mobile knife game — the knife then rides around as the log spins.
      // Ansatz am Rand, Klinge zeigt nach innen — nur KNIFE_BITE tief. Der Griff
      // bleibt damit sichtbar draussen, so wie ein steckendes Messer aussieht.
      knife.position.set(0, -(KNIFE_R + 0.36 - KNIFE_BITE), 0.42);
      holder.add(knife);
      holder.visible = false;   // revealed once the flying knife arrives
      this.knifeGroup.add(holder);
      this.knifeMeshes.push(holder);

      // A world-space knife that flies from the thrower up into the disc's
      // bottom rim.
      const fromKin = this.kins.get(data.playerId);
      const flyer = buildKnife(owner?.color);
      const startX = fromKin ? fromKin.position.x : 0;
      flyer.position.set(startX, KIN_Y + 0.4, 2.2);
      this.scene.add(flyer);
      this.flyingKnives.push({ mesh: flyer, holder, startX, startedAt: this.now() });
      if (data.playerId === this.getControlledPlayerId()) this.feedback?.sound("whoosh");
    }
  }

  updateFlyingKnives(now) {
    const life = 240;
    this.flyingKnives = this.flyingKnives.filter((fk) => {
      const t = (now - fk.startedAt) / life;
      if (t >= 1) {
        this.scene.remove(fk.mesh);
        fk.holder.visible = true;
        this.bursts.spawn(new THREE.Vector3(0, LOG_Y - LOG_R, LOG_Z + 0.4), ["#d8dee8", "#ffffff"], { count: 5, speed: 1.4, up: 1, size: 0.05, life: 0.4 });
        return false;
      }
      // Straight up from the thrower into the disc's bottom rim.
      fk.mesh.position.x = THREE.MathUtils.lerp(fk.startX, 0, t);
      fk.mesh.position.y = THREE.MathUtils.lerp(KIN_Y + 0.4, LOG_Y - LOG_R, t);
      fk.mesh.position.z = THREE.MathUtils.lerp(2.2, LOG_Z + 0.4, t);
      return true;
    });
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

    // Extrapolate the log spin between server ticks for a smooth roll.
    const dir = (arcade.round || 0) % 2 === 0 ? 1 : -1;
    const snapshotAge = Math.min(0.25, (frameNow - this.lastServerAt) / 1000);
    const target = (arcade.logAngle || 0) + (arcade.spinSpeed || 1) * dir * snapshotAge;
    this.localAngle += (target - this.localAngle) * Math.min(1, dt * 12);
    this.log.rotation.z = this.localAngle;

    this.syncKnives(arcade);
    this.updateFlyingKnives(now);

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const out = Boolean(entry.eliminated);
      // The active thrower slides to centre each turn; others glide to flanks.
      const targetX = this.spotForPlayer(player.id, index, state.players.length);
      kin.userData.spotX = targetX;
      kin.position.x = THREE.MathUtils.lerp(kin.position.x, targetX, frameLerp(0.12, dt));
      // The active player stands a step forward, under the disc.
      const isActive = arcade.activeId === player.id;
      kin.position.z = THREE.MathUtils.lerp(kin.position.z, isActive ? 1.9 : 2.6, frameLerp(0.1, dt));

      if ((entry.stuck || 0) > (this.lastStuck.get(player.id) || 0)) {
        this.lastStuck.set(player.id, entry.stuck);
        animator.trigger("cheer");
        const hitPos = new THREE.Vector3(0, LOG_Y - LOG_R, LOG_Z + 0.4);
        this.bursts.spawn(hitPos, ["#d8dee8", "#ffe36b", "#ffffff"], { count: 8, speed: 1.8, up: 1.4, size: 0.06, life: 0.5, drag: 2.4, fadePow: 1.5 });
        this.bursts.ring(hitPos, "#ffe36b", { radius: 1, life: 0.4, opacity: 0.5, tilt: null });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "TREFFER!", { color: "#ffe36b", size: 0.4, life: 0.85 });
        if (player.id === controlledId) {
          this.feedback?.sound("pop");
          this.feedback?.vibrate(10);
        }
      }
      if (out && !this.lastEliminated.get(player.id)) {
        this.lastEliminated.set(player.id, true);
        animator.trigger("stumble");
        this.shake = Math.max(this.shake, 0.7);
        const outPos = kin.position.clone().add(new THREE.Vector3(0, 0.5, 0));
        this.bursts.spawn(outPos, ["#ff2038", player.color, "#ffffff"], { count: 14, speed: 2.4, up: 2, size: 0.09, life: 0.75, drag: 1.4 });
        this.bursts.ring(kin.position.clone().setY(0.05), "#ff2038", { radius: 1.6, life: 0.55, opacity: 0.55 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "RAUS!", { color: "#ff6b7f", size: 0.44, life: 0.95 });
        if (player.id === controlledId) {
          this.feedback?.sound("error");
          this.feedback?.vibrate([26, 20, 34]);
        }
      }

      if (minigame.finaleAt) {
        applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
      } else {
        animator.set(out ? "sad" : "idle", { base: true });
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.05, kin.position.z);
      kin.userData.shadow.material.opacity = out ? 0.12 : 0.26;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 15) * this.shake * 0.22 * shakeScale();
    const desired = new THREE.Vector3(shakeX, this.baseCamY || 2.9, this.baseCamZ || 7.4);
    this.camera.position.lerp(desired, frameLerp(0.1, dt));
    this.camera.lookAt(0, 2.7, LOG_Z);

    this.updateHud(minigame, arcade, state, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    // Auch die Mitspieler gehören ins Bild — sonst weiss man nicht, wie man
    // gerade dasteht.
    fitKinsInView(this);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.stuck || 0);

    const id = this.getControlledPlayerId();
    const myTurn = arcade.activeId === id && !own?.eliminated && !own?.turnDone;
    const turnLeft = arcade.turnEndsAt ? Math.max(0, Math.ceil((arcade.turnEndsAt - now) / 1000)) : 0;
    const activePlayer = state.players.find((p) => p.id === arcade.activeId);
    const banner = this.hud.querySelector("[data-knife-banner]");
    // Runde und Leben gehören sichtbar dazu: es wird mehrfach geworfen, und ein
    // Fehlwurf ist nicht sofort das Aus. Ohne die Anzeige wäre beides Rätselraten.
    // Keine Rundenzahl mehr — gespielt wird, bis nur noch einer steht. Was
    // zählt, ist also, wie viele noch dabei sind.
    const übrig = Object.values(arcade.players || {}).filter((entry) => !entry.eliminated).length;
    const roundLabel = übrig > 1 ? ` · noch ${übrig} dabei` : "";
    if (banner) {
      banner.hidden = false;
      if (own?.eliminated) {
        banner.textContent = "Zweimal daneben – raus!";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      } else if ((own?.clashes || 0) > 0 && myTurn) {
        banner.textContent = `Letzter Versuch! ${turnLeft}s${roundLabel}`;
        banner.style.background = "#e0334f";
        banner.style.color = "#ffffff";
      } else if (myTurn) {
        banner.textContent = `Du bist dran! ${turnLeft}s${roundLabel}`;
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if (arcade.activeId) {
        banner.textContent = `${(activePlayer?.name || "Gegner").slice(0, 8)} wirft … ${turnLeft}s${roundLabel}`;
        banner.style.background = "#12aaff";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.throwButton) this.throwButton.disabled = !myTurn || Boolean(minigame.finaleAt);
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 3.2 : 2.9;
      this.baseCamZ = portrait ? 8.9 : 7.7;
      camera.fov = portrait ? 54 : 48;
    });
  }
}
