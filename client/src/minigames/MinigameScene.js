import * as THREE from "/vendor/three/three.module.js";
import {
  createKin,
  KinAnimator,
  createNameLabel,
  setNameLabelOwn,
  createShadowBlob,
  CubeBurst,
  FloatingText,
  standOn,
  applyFinaleMood,
  setKinOpacity,
  disposeScene
} from "./VoxelKit.js?v=tumblekin211";
import { MINIGAME_METRICS } from "./presentation.js?v=tumblekin211";
import { mountStage, mountHud, addStageLights, teardownStage, entflechteSchilder } from "./SceneKit.js?v=tumblekin211";
import { CameraRig, finaleWinner } from "./CameraRig.js?v=tumblekin211";
import { frameChance } from "./Quality.js?v=tumblekin211";
import { verblocke } from "./Blockform.js?v=tumblekin211";

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
//   afterAnimate(f) nach den Posen, z. B. Hände an Griffe legen (optional)
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
    this.sendInput = (input) => {
      // Auch Tippen auf die Bühne drückt den zugehörigen Aktionsknopf.
      // Dauersteuerung und Laufzeit-Pings erzeugen keinen Knopfimpuls.
      if (!["ping", "steer", "thrust", "hold", "lift", "release", "run", "reel", "sprint"].includes(input.action)) {
        const buttons = [...this.controls.querySelectorAll("button")];
        if (buttons.length === 1) feedback?.buttons?.pulse(buttons[0]);
      }
      // Jede Antwort misst nebenbei die Rundreise (siehe arrivalNow) — auch
      // eine Ablehnung kommt ja vom Server zurück.
      const clock = performance.now();
      this.net.lastSentAt = clock;
      return sendInput(input).then(reply => {
        this.noteNetRoundTrip(performance.now() - clock);
        return reply;
      }, error => {
        this.noteNetRoundTrip(performance.now() - clock);
        if (input.action !== "ping" && performance.now() - (this.inputErrorAt || -1000) > 1000) {
          this.inputErrorAt = performance.now();
          this.onInputError?.(error);
        }
        throw error;
      });
    };
    this.net = { samples: [], lagOffset: null, roundTrip: null, lastSentAt: 0, used: false };
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
    this.prepareHud();
    this.loop();
  }

  handleUpdate(update) {
    this.update = update;
    // Jedes Bild trägt die Serverzeit, zu der es abging. Das am wenigsten
    // verspätete der letzten Sekunden sagt, wie weit dieses Gerät hinter dem
    // Server liegt.
    if (Number.isFinite(update?.sentAt)) {
      const clock = performance.now();
      const net = this.net;
      net.samples.push({ clock, sample: update.sentAt - Date.now() });
      while (net.samples.length > 1 && net.samples[0].clock < clock - 4000) net.samples.shift();
      net.lagOffset = Math.max(...net.samples.map(item => item.sample));
    }
    this.onUpdate?.(update);
  }

  // Rundreise zum Server, geglättet und auf 250 ms gedeckelt — mehr gleicht
  // niemand aus, sonst liefe das Bild bei einem Funkloch weit voraus.
  noteNetRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.net.roundTrip = this.net.roundTrip === null ? clamped : this.net.roundTrip * 0.8 + clamped * 0.2;
  }

  // Serverzeit, zu der ein JETZT geschickter Tipp beim Server ankommt. Die
  // Bilder zeigen den Server um den Hinweg verspätet, der Tipp braucht noch
  // einmal so lange. Spiele, deren Server einen Tipp bei Ankunft wertet (Seil,
  // Fass, Stoppuhr, Ampel …), zeigen ihren entscheidenden Moment zu dieser
  // Zeit — sonst muss, wer weiter weg sitzt, um eine Rundreise früher tippen,
  // als er es sieht. Der Server traut dabei keiner Zeitangabe des Geräts.
  // Im Finale steht die Uhr: dann gilt die gewöhnliche Zeit.
  arrivalNow() {
    const net = this.net;
    net.used = true;
    const minigame = this.update || this.minigame;
    if (minigame?.finaleAt) return this.now();
    const seen = net.lagOffset === null ? this.now() : Date.now() + net.lagOffset;
    return seen + (net.roundTrip ?? 0);
  }

  // Wer die Ankunftszeit nutzt, braucht die Rundreise auch, wenn gerade
  // nichts getippt wird — schon im Countdown: dann misst ein Ping, höchstens
  // jede Sekunde.
  pingNetIfIdle(minigame) {
    const net = this.net;
    if (!net.used || !minigame || minigame.finaleAt) return;
    if (performance.now() - net.lastSentAt < 1000) return;
    this.sendInput({ action: "ping" })?.catch?.(() => {});
  }

  destroy() {
    this.feedback?.buttons?.reset();
    cancelAnimationFrame(this.frame);
    this.frame = null;
    this.listeners.forEach(({ target, type, fn, options }) => target.removeEventListener(type, fn, options));
    this.listeners = [];
    this.unbind?.();
    this.hudObserver?.disconnect();
    this.controls.inert = false;
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
    if (type === "pointerdown") {
      const handler = fn;
      fn = event => {
        if (event.button > 0 || event.target?.closest?.("button:disabled, [inert]")) return;
        const game = this.update || this.minigame;
        if (!game || game.finaleAt || this.now() < game.startedAt) return;
        handler(event);
      };
    }
    target.addEventListener(type, fn, options);
    this.listeners.push({ target, type, fn, options });
  }

  // setPointerCapture wirft, wenn der Zeiger beim Aufruf schon nicht mehr
  // aktiv ist (Finger in derselben Millisekunde gehoben, synthetische
  // Ereignisse). Der Wurf brach dann den Rest des Handlers ab — Farbflucht
  // merkte sich die Geste nicht mehr, die Zielgerade startete keinen Sprint.
  // Ohne Capture läuft die Geste über die window-Listener trotzdem weiter.
  capturePointer(element, pointerId) {
    try {
      element?.setPointerCapture?.(pointerId);
    } catch {
      // Zeiger schon weg: nichts festzuhalten.
    }
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

    this.pingNetIfIdle(minigame);
    if (finale && !this.finaleStarted) {
      this.finaleStarted = true;
      this.onFinale?.(f);
    }
    this.tick(f);
    if (finale && places && this.autoFinale !== false) this.finaleMoods(f);

    this.animators.forEach((animator) => animator.update(now));
    // Nach der Pose, vor dem Bild: hier können Szenen einzelne Glieder an die
    // Welt anpassen — Hände an Griffe oder Seilenden legen.
    this.afterAnimate?.(f);
    this.shadows.forEach((shadow, id) => {
      const kin = this.kins.get(id);
      const animator = this.animators.get(id);
      if (!kin || !animator || shadow.userData.manual) return;
      shadow.visible = kin.visible;
      const ground = animator.groundY - 0.3;
      shadow.position.set(kin.position.x, ground + 0.012, kin.position.z);
      const lift = Math.max(0, kin.position.y - animator.groundY);
      shadow.scale.setScalar(Math.max(0.35, 1 - lift * 0.55));
      shadow.material.opacity = Math.max(0.06, 0.34 - lift * 0.15);
    });
    this.bursts.update(dt);
    this.floaters.update(dt, this.camera);
    this.drawHud?.(f);
    this.updateHudBasics(f);

    const own = this.kins.get(f.controlledId) || null;
    // Im Finale fährt die Kamera auf den Sieger zu. Hielte sie dabei weiter
    // alle im Bild, höbe die Sicherung das Heranfahren wieder auf.
    // Spiele, deren Figuren weit auseinander liegen (Bergsteiger), bleiben
    // mit `finaleFocus = false` bei der eigenen Figur.
    const winner = this.finaleFocus === false ? null : finaleWinner(minigame, this.kins);
    this.rig.update(dt, now, {
      minigame,
      keep: winner ? [winner] : (this.keepInView?.(f) ?? [...this.kins.values()]),
      own: winner || this.ownInView === false ? null : own,
      winner,
      ...(this.rigOptions?.(f) || {})
    });
    // Die eigene Figur trägt das gelbe Schild — auch wenn die Steuerung
    // wechselt (Dev-Modus: ein Gerät steuert nacheinander mehrere Figuren).
    if (this.ownLabelFor !== f.controlledId) {
      this.ownLabelFor = f.controlledId;
      this.labels.forEach((sprite, id) => setNameLabelOwn(sprite, id === f.controlledId));
    }
    if (this.labels.size > 1) entflechteSchilder([...this.labels.values()], this.camera, { grundY: this.labelY ?? 0.74, stufe: 0.26, naehe: 0.14 });
    // Runde Formen als Blöcke (siehe Blockform.js) — auch solche, die ein
    // Spiel erst während der Runde anlegt.
    verblocke(this.scene);
    this.renderer.render(this.scene, this.camera);
  }

  updateHudBasics(f) {
    if (!this.hud) return;
    this.hudTime ||= this.hud.querySelector("[data-kinetic-time]");
    if (this.hudTime) this.hudTime.textContent = f.finale ? "Ende" : `${f.remaining}s`;
    this.hud.classList.toggle("dev-mode", Boolean(f.state.devMode));
    this.controls.inert = f.finale;
    this.webglCanvas.style.pointerEvents = f.finale ? "none" : "";
    const score = this.hudScore;
    if (score) {
      const text = score.textContent;
      if (text !== this.hudScoreText) {
        score.setAttribute("aria-label", `${score.dataset.metric}: ${text}`);
        if (this.hudScoreText !== undefined && !f.finale && f.now - (this.metricPulseAt || 0) > 400) {
          this.metricPulseAt = f.now;
          score.classList.remove("metric-change");
          // Zwei aufeinanderfolgende Änderungen brauchen keinen Layout-Flush.
          score.classList.add("metric-change");
        }
        this.hudScoreText = text;
      }
      if (f.now - (this.metricPulseAt || 0) > 220) score.classList.remove("metric-change");
    }
  }

  prepareHud() {
    this.hudScore = this.hud.querySelector("[data-kinetic-score]");
    if (this.hudScore) this.hudScore.dataset.metric = MINIGAME_METRICS[this.minigame.type] || "Punkte";
    const time = this.hud.querySelector("[data-kinetic-time]");
    if (time) time.dataset.metric = "Zeit";
    // Was neben der Punkteleiste steht, richtet sich nach ihrer echten
    // Breite: Mit Wertungsbeschriftung („Gesichert“, „Fangwert“) ist sie
    // breiter als die festen 132px, an denen 14 Anzeigen sassen — Tiefenrausch
    // und Angelduell lagen 9px darunter.
    const scorebar = this.hud.querySelector(".kinetic-scorebar");
    const chips = this.hud.querySelector(".hud-chips");
    if (!scorebar && !chips) return;
    const refresh = () => {
      const top = this.hud.getBoundingClientRect();
      if (scorebar) {
        const right = scorebar.getBoundingClientRect().right - top.left;
        if (right > 0) this.hud.style.setProperty("--hud-beside", `${Math.ceil(right + 8)}px`);
      }
      if (chips) this.hud.style.setProperty("--hud-chips-bottom", `${Math.ceil(chips.getBoundingClientRect().bottom - top.top)}px`);
    };
    refresh();
    this.hudObserver = new ResizeObserver(refresh);
    [scorebar, chips].forEach((el) => el && this.hudObserver.observe(el));
  }

  // Dynamische Objekte verschwinden auch aus dem GPU-Vorrat. Ressourcen,
  // die ein anderes Objekt der Szene noch benutzt, bleiben erhalten.
  removeObject(object) {
    object.removeFromParent();
    disposeScene(object, { retain: this.scene });
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
      const sprite = createNameLabel(String(player.name || "?").slice(0, 8), player.color, { own: player.id === this.getControlledPlayerId() });
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
