import * as THREE from "/vendor/three/three.module.js";
import {
  createKin,
  KinAnimator,
  createNameLabel,
  createShadowBlob,
  CubeBurst,
  FloatingText,
  standOn,
  applyFinaleMood,
  setKinOpacity
} from "./VoxelKit.js?v=tumblekin200";
import { mountStage, mountHud, addStageLights, syncOwnMarker, teardownStage, entflechteSchilder } from "./SceneKit.js?v=tumblekin200";
import { CameraRig, finaleWinner } from "./CameraRig.js?v=tumblekin200";
import { frameChance } from "./Quality.js?v=tumblekin200";

const COLORS = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"];

// Die Farbe bestimmt das Accessoire (Spross, Heiligenschein, Fühler, Krone),
// damit dieselbe Person in jedem Spiel und auf der Menübühne gleich aussieht.
export function kinVariant(player, index = 0) {
  const at = COLORS.indexOf(player?.color);
  return at >= 0 ? at : index;
}

// Grundgerüst eines Minispiels.
//
// Jedes der 31 Spiele trug denselben Rahmen mit sich: Konstruktor mit zwölf
// Feldern, Start, Schleife, Zeitschritt, Figuren samt Schild und Schatten,
// eigener Pfeil, Partikel, Abbau — und eine Kamera aus geschätzten Zahlen.
// Hier steht das einmal. Ein Spiel beschreibt nur noch seine Welt, seine
// Steuerung und was in jedem Bild passiert.
//
// Ein Spiel überschreibt:
//   stage()        Himmel, Nebel, Licht        (optional)
//   hudHtml()      Markup der Anzeige           (optional)
//   build()        die Welt
//   shot()         die Kameraeinstellung (siehe CameraRig)
//   bind()         Steuerung anhängen           (optional)
//   tick(f)        je Bild; f = { now, dt, minigame, arcade, state, players,
//                  controlledId, finale, places, started }
//   drawHud(f)     Anzeige aktualisieren        (optional)
//
// `this.hud` ist das HUD-Element (so legt mountHud es ab; CameraRig misst daran
// das freie Band).
export class MinigameScene {
  constructor({ canvas, controls, sendInput, now, getState, getControlledPlayerId, myPlayerId, feedback }) {
    this.canvas = canvas;
    this.controls = controls;
    this.sendInput = sendInput;
    this.now = now;
    this.getState = getState;
    this.myPlayerId = myPlayerId;
    this.getControlledPlayerId = getControlledPlayerId || (() => myPlayerId);
    this.feedback = feedback;
    this.minigame = null;
    this.update = null;
    this.frame = null;
    this.kins = new Map();
    this.animators = new Map();
    this.shadows = new Map();
    this.labels = new Map();
    this.listeners = [];
    this.lastFrameAt = performance.now();
    this.finaleStarted = false;
    this.celebrated = new Set();
  }

  // --- Lebenszyklus ------------------------------------------------------------

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    const stage = this.stage?.() || {};
    mountStage(this, { label: stage.label || `3D ${minigame.title}`, background: stage.background, fog: stage.fog });
    if (stage.lights !== false) addStageLights(this.scene, stage.lights || {});
    mountHud(this, this.hudHtml?.() ?? `<div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>`);
    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.build();
    this.rig = new CameraRig(this, this.shot());
    this.bind?.();
    this.loop();
  }

  handleUpdate(update) {
    this.update = update;
    this.onUpdate?.(update);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.frame = null;
    this.listeners.forEach(({ target, type, fn, options }) => target.removeEventListener(type, fn, options));
    this.listeners = [];
    this.unbind?.();
    this.controls.innerHTML = "";
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
    this.shadows.clear();
    this.labels.clear();
  }

  // Zuhörer, die beim Abbau von selbst wieder abgehängt werden.
  on(target, type, fn, options) {
    if (!target) return;
    target.addEventListener(type, fn, options);
    this.listeners.push({ target, type, fn, options });
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    if (!minigame || !state || !this.renderer) return;
    const now = this.now();
    const frameNow = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (frameNow - this.lastFrameAt) / 1000));
    this.lastFrameAt = frameNow;
    const arcade = minigame.arcade || null;
    const places = arcade?.places || minigame.arena?.places || null;
    const finale = Boolean(minigame.finaleAt);
    const f = {
      now,
      dt,
      minigame,
      arcade,
      state,
      players: state.players || [],
      controlledId: this.getControlledPlayerId(),
      finale,
      places,
      started: now >= minigame.startedAt,
      remaining: Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000))
    };

    if (finale && !this.finaleStarted) {
      this.finaleStarted = true;
      this.onFinale?.(f);
    }
    this.tick(f);
    if (finale && places && this.autoFinale !== false) this.finaleMoods(f);

    this.animators.forEach((animator) => animator.update(now));
    this.shadows.forEach((shadow, id) => {
      const kin = this.kins.get(id);
      const animator = this.animators.get(id);
      if (!kin || !animator || shadow.userData.manual) return;
      shadow.visible = kin.visible;
      const ground = animator.groundY - 0.3;
      shadow.position.set(kin.position.x, ground + 0.012, kin.position.z);
      const lift = Math.max(0, kin.position.y - animator.groundY);
      shadow.scale.setScalar(Math.max(0.35, 1 - lift * 0.55));
      shadow.material.opacity = Math.max(0.05, 0.26 - lift * 0.12);
    });
    this.bursts.update(dt);
    this.floaters.update(dt, this.camera);
    this.drawHud?.(f);
    this.updateHudBasics(f);

    const own = this.kins.get(f.controlledId) || null;
    // Im Finale fährt die Kamera auf den Sieger zu. Hielte sie dabei weiter
    // alle im Bild, höbe die Sicherung das Heranfahren wieder auf.
    const winner = finaleWinner(minigame, this.kins);
    this.rig.update(dt, now, {
      minigame,
      keep: winner ? [winner] : (this.keepInView?.(f) ?? [...this.kins.values()]),
      own: winner || this.ownInView === false ? null : own,
      winner,
      ...(this.rigOptions?.(f) || {})
    });
    if (this.ownMarker !== false) syncOwnMarker(this, own, now, this.markerOffset ?? 0.62, this.markerLift ?? 0.55);
    if (this.labels.size > 1) entflechteSchilder([...this.labels.values()], this.camera, { grundY: this.labelY ?? 0.74, stufe: 0.26, naehe: 0.14 });
    this.renderer.render(this.scene, this.camera);
  }

  updateHudBasics(f) {
    if (!this.hud) return;
    this.hudTime ||= this.hud.querySelector("[data-kinetic-time]");
    if (this.hudTime) this.hudTime.textContent = `${f.remaining}s`;
    this.hud.classList.toggle("dev-mode", Boolean(f.state.devMode));
  }

  // --- Figuren ------------------------------------------------------------------

  // Legt eine Figur mit Schild, Schatten und Animator an.
  addKin(player, index, { x = 0, ground = 0, z = 0, facing = 0, label = true, scale = 1 } = {}) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createKin(player.color, kinVariant(player, index));
    kin.scale.setScalar(scale);
    kin.position.set(x, standOn(ground), z);
    kin.rotation.y = facing;
    if (label) {
      const sprite = createNameLabel(String(player.name || "?").slice(0, 8), player.color);
      sprite.position.y = this.labelY ?? 0.74;
      kin.add(sprite);
      this.labels.set(player.id, sprite);
      kin.userData.label = sprite;
    }
    const shadow = createShadowBlob(0.5 * scale);
    this.scene.add(shadow);
    kin.userData.shadow = shadow;
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = standOn(ground);
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);
    this.shadows.set(player.id, shadow);
    return kin;
  }

  // Die Figur auf eine andere Bodenhöhe stellen.
  setGround(playerId, ground) {
    const animator = this.animators.get(playerId);
    if (animator) animator.groundY = standOn(ground);
  }

  fade(playerId, opacity) {
    const kin = this.kins.get(playerId);
    if (kin) setKinOpacity(kin, opacity);
  }

  // Jeder Platz reagiert eigen — Siegerpose, klatschen, Schulterzucken,
  // geknickt. Der Sieger bekommt dazu Konfetti.
  finaleMoods(f) {
    const total = f.players.length;
    f.players.forEach((player) => {
      const place = f.places?.[player.id];
      const animator = this.animators.get(player.id);
      if (!animator || !place) return;
      if (this.finaleOverride?.(player, place, f)) return;
      applyFinaleMood(animator, place, total);
      const kin = this.kins.get(player.id);
      if (place === 1 && kin && Math.random() < frameChance(0.18, f.dt)) {
        const at = kin.getWorldPosition(new THREE.Vector3());
        at.y += 1.1 + Math.random() * 0.4;
        at.x += (Math.random() - 0.5) * 0.8;
        this.bursts.spawn(at, [player.color, "#ffd15c", "#ffffff"], { count: 3, speed: 0.8, up: 0.5, gravity: 2.4, size: 0.07, life: 1.2 });
      }
      if (place === 1 && !this.celebrated.has(player.id)) {
        this.celebrated.add(player.id);
        if (player.id === f.controlledId) this.feedback?.sound("win");
      }
    });
  }

  // --- Kleinkram ------------------------------------------------------------------

  pop(position, text, options) {
    this.floaters.pop(position, text, options);
  }

  burst(position, colors, options) {
    this.bursts.spawn(position, colors, options);
  }

  kinPosition(playerId, lift = 0) {
    const kin = this.kins.get(playerId);
    if (!kin) return null;
    const at = kin.getWorldPosition(new THREE.Vector3());
    at.y += lift;
    return at;
  }
}
