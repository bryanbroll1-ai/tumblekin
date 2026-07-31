import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createNameLabel,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin90";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin90";
import { frameDecay, frameLerp, fxScale, shakeScale } from "./Quality.js?v=tumblekin90";

// Tiefenrausch — tippen gräbt eine Stufe tiefer, hochwischen zahlt die Beute
// ein. Tiefer bringt mehr, aber jeder Stollen kann einstürzen, und dann ist
// alles weg, was noch unten hängt.
//
// Das Risiko des NÄCHSTEN Stichs steht auf den Prozentpunkt genau im Bild.
// Ohne diese Zahl wäre das Spiel Glücksspiel; mit ihr ist es eine Entscheidung,
// und die einzige Frage lautet, ob man sie gegen die eigene Gier durchsetzt.
const SHAFT_W = 2.6;
const LEVEL_H = 0.85;
const VISIBLE_LEVELS = 7;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class DeepDig {
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
    this.layers = [];
    this.gems = [];
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.lastEventAt = 0;
    this.shownDepth = 0;
    this.drag = null;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Tiefenrausch", background: "#3c2a1e", fog: ["#2a1c13", 8, 26], fov: 56, far: 60 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="dig-risk" data-dig-risk>Risiko –</div>
      <div class="dig-chips" data-dig-chips></div>
      <div class="color-banner dig-banner" data-dig-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `<p class="trace-hint" data-dig-hint>Tippen gräbt · nach oben wischen zahlt ein</p>`;
    this.controls.style.pointerEvents = "none";
    this.bindGestures();
    this.loop();
  }

  bindGestures() {
    this.onDown = (event) => {
      event.preventDefault();
      this.drag = { x: event.clientX, y: event.clientY, at: performance.now() };
    };
    this.onUp = (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      const held = performance.now() - this.drag.at;
      this.drag = null;
      const minigame = this.update || this.minigame;
      if (!minigame || minigame.finaleAt) return;
      // Ein Wisch NACH OBEN ist der Weg nach oben — dieselbe Richtung, in die
      // der Kin klettert. Alles andere ist ein Tipp und gräbt.
      if (dy < -36 && Math.abs(dy) > Math.abs(dx)) {
        this.feedback?.sound("whoosh");
        this.feedback?.vibrate(14);
        this.sendInput({ action: "bank" }).catch(() => {});
        return;
      }
      if (Math.hypot(dx, dy) < 26 && held < 500) {
        this.feedback?.sound("clack");
        this.sendInput({ action: "dig" }).catch(() => {});
      }
    };
    this.onCancel = () => { this.drag = null; };
    this.webglCanvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    this.webglCanvas?.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    teardownStage(this);
    this.layers.length = 0;
    this.gems.length = 0;
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-2, 8, 6],
      sunIntensity: 1.6,
      groundColor: 0x2a1c13
    });

    // Die Grasnarbe oben: sie ist der Bezugspunkt, an dem man sieht, wie tief
    // man schon ist. Ohne sie sähe jede Tiefe aus wie jede andere.
    const surface = new THREE.Mesh(
      new THREE.BoxGeometry(SHAFT_W + 3.4, 0.4, 3),
      new THREE.MeshLambertMaterial({ color: "#7bbf5e" })
    );
    surface.position.set(0, 0.2, -0.6);
    this.scene.add(surface);

    const cart = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.5, 0.7),
      new THREE.MeshLambertMaterial({ color: "#a9763f" })
    );
    cart.position.set(SHAFT_W / 2 + 1.0, 0.65, -0.4);
    this.scene.add(cart);
    this.cart = cart;

    // Erdschichten. Sie werden EINMAL gebaut und beim Graben nach oben
    // durchgereicht, damit der Schacht endlos wirkt, ohne endlos zu sein.
    for (let i = 0; i < VISIBLE_LEVELS + 1; i += 1) {
      const group = new THREE.Group();
      const wallMat = new THREE.MeshLambertMaterial({ color: "#5e422c" });
      [-1, 1].forEach((side) => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, LEVEL_H, 1.2), wallMat);
        wall.position.set(side * (SHAFT_W / 2 + 0.7), 0, -0.3);
        group.add(wall);
      });
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(SHAFT_W, LEVEL_H, 0.4),
        new THREE.MeshLambertMaterial({ color: "#4a331f" })
      );
      back.position.z = -0.85;
      group.add(back);
      // Ein Stützbalken je Stufe: er zählt die Tiefe, ohne eine Zahl zu zeigen.
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(SHAFT_W + 1.4, 0.12, 0.5),
        new THREE.MeshLambertMaterial({ color: "#8a6a45" })
      );
      beam.position.set(0, LEVEL_H / 2, -0.3);
      group.add(beam);

      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.16),
        new THREE.MeshBasicMaterial({ color: "#ffd15c", toneMapped: false })
      );
      gem.position.set(0, 0, -0.3);
      gem.visible = false;
      group.add(gem);

      this.scene.add(group);
      this.layers.push({ group, gem, level: i });
    }

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildDigger();
    this.resizeRenderer();
    this.camera.position.set(0, -0.6, 5.2);
    this.camera.lookAt(0, -0.6, 0);
  }

  buildDigger() {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId()) || state?.players?.[0];
    const kin = createVoxelKin(me?.color || "#ff5d73", 0);
    kin.scale.setScalar(0.8);
    const label = createNameLabel("du", me?.color || "#ff5d73");
    label.position.y = 0.72;
    kin.add(label);
    this.scene.add(kin);

    // Eine Grubenlampe am Kin: sie ist die einzige Lichtquelle da unten und
    // zeigt beim Graben nach unten, beim Auftauchen nach oben.
    const lamp = new THREE.PointLight("#ffd8a0", 2.4, 6);
    lamp.position.set(0, 0.5, 0.6);
    kin.add(lamp);

    this.digger = kin;
    this.diggerAnimator = new KinAnimator(kin);
    this.diggerAnimator.groundY = 0;
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
    const own = arcade.players[this.getControlledPlayerId()];

    if (own) {
      // Die gezeigte Tiefe folgt der echten gedämpft — der Kin FÄHRT nach unten,
      // statt zu springen, und genau daran sieht man, dass Graben Zeit kostet.
      this.shownDepth += ((own.depth || 0) - this.shownDepth) * frameLerp(0.16, dt);
      const y = -this.shownDepth * LEVEL_H - 0.4;
      this.digger.position.set(0, y, 0.2);

      // Schichten so verschieben, dass immer welche um den Kin herum stehen.
      const first = Math.floor(this.shownDepth) - 1;
      this.layers.forEach((layer, i) => {
        const level = first + i;
        layer.group.visible = level >= 0;
        layer.group.position.y = -level * LEVEL_H - 0.4;
        // Ein Edelstein auf jeder Stufe, die man schon aufgemacht hat.
        const dug = level > 0 && level <= (own.depth || 0);
        layer.gem.visible = dug;
        layer.gem.rotation.y = now / 400 + i;
        layer.gem.position.x = Math.sin(now / 700 + i) * 0.5;
      });

      this.syncEvents(own, now, y);
      this.syncDigger(minigame, arcade, state, own, now);
      this.cart.scale.setScalar(1 + Math.min(0.5, (own.banked || 0) / 900));
    }

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.86, dt);
    const jolt = Math.sin(now / 11) * this.shake * 0.24 * shakeScale();
    this.camera.position.set(jolt, this.digger.position.y + 0.4, this.baseCamZ || 5.2);
    this.camera.lookAt(0, this.digger.position.y + 0.2, 0);

    this.updateHud(minigame, arcade, state, now, own);
    this.renderer.render(this.scene, this.camera);
  }

  syncEvents(own, now, y) {
    const event = own.lastDive;
    if (!event || event.at === this.lastEventAt) return;
    this.lastEventAt = event.at;
    const at = new THREE.Vector3(0, y + 0.7, 0.5);

    if (event.kind === "dug") {
      this.bursts.spawn(at, ["#ffd15c", "#a9763f"], { count: 6 * fxScale(), speed: 1.2, up: 0.9, size: 0.05, life: 0.4, drag: 2.4 });
      this.floaters.pop(at, `+${event.gold}`, { color: "#ffe36b", size: 0.28, life: 0.5 });
      this.feedback?.vibrate(6);
    } else if (event.kind === "banked") {
      this.bursts.spawn(at, ["#ffd15c", "#ffffff"], { count: 18 * fxScale(), speed: 2.2, up: 2.4, size: 0.08, life: 0.8, drag: 1.5 });
      this.floaters.pop(at, `${event.gold} GOLD SICHER!`, { color: "#ffe36b", size: 0.42, life: 1 });
      this.feedback?.sound("win");
      this.feedback?.vibrate([12, 10, 20]);
    } else {
      // Einsturz: das ist der Moment, für den das ganze Spiel gebaut ist.
      this.bursts.spawn(at, ["#5e422c", "#3c2a1e", "#8a6a45"], { count: 24 * fxScale(), speed: 2.6, up: 1.2, size: 0.1, life: 0.9, gravity: 4, drag: 1.4 });
      this.floaters.pop(at, `EINSTURZ! −${event.gold}`, { color: "#ff9aa8", size: 0.46, life: 1.2 });
      this.feedback?.sound("impact");
      this.feedback?.vibrate([26, 18, 30]);
      this.shake = Math.max(this.shake, 0.9);
    }
  }

  syncDigger(minigame, arcade, state, own, now) {
    if (minigame.finaleAt) {
      applyFinaleMood(this.diggerAnimator, this.finalePlace(arcade, state), state.players.length);
    } else if (own.busyKind === "collapsed" && now < own.busyUntil) {
      this.diggerAnimator.set("fall", { base: true });
    } else if (own.busyKind === "digging" && now < own.busyUntil) {
      this.diggerAnimator.set("hit");
    } else if (own.busyKind === "surfacing" && now < own.busyUntil) {
      this.diggerAnimator.set("cheer", { base: true });
    } else {
      this.diggerAnimator.set("idle", { base: true });
    }
    this.diggerAnimator.update(now);
  }

  finalePlace(arcade, state) {
    const scored = state.players
      .map((player) => ({ id: player.id, banked: arcade.players[player.id]?.banked || 0 }))
      .sort((a, b) => b.banked - a.banked);
    const index = scored.findIndex((entry) => entry.id === this.getControlledPlayerId());
    return index < 0 ? state.players.length : index + 1;
  }

  updateHud(minigame, arcade, state, now, own) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.banked || 0);

    // DIE Zahl des Spiels. Sie muss gross und genau dastehen — ohne sie wäre
    // jeder Spatenstich geraten statt entschieden.
    const risk = this.hud.querySelector("[data-dig-risk]");
    if (risk && own) {
      const percent = Math.round((own.nextRisk || 0) * 100);
      risk.textContent = `Nächste Stufe: ${percent}% Einsturz · +${own.nextGain || 0}`;
      risk.style.color = percent >= 40 ? "#ff9aa8" : percent >= 22 ? "#ffd15c" : "#c6ffb0";
    }

    const chips = this.hud.querySelector("[data-dig-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="dig-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${entry?.banked || 0}</span>`;
      }).join("");
    }

    const hint = this.controls?.querySelector("[data-dig-hint]");
    const mode = !own ? "idle" : (own.depth > 0 ? "deep" : "top");
    if (hint && mode !== this.hintMode) {
      this.hintMode = mode;
      hint.textContent = mode === "deep"
        ? "Tippen gräbt weiter · ⬆️ hochwischen zahlt ein"
        : "Tippen gräbt · nach oben wischen zahlt ein";
    }

    const banner = this.hud.querySelector("[data-dig-banner]");
    if (!banner || !own) return;
    if (now < own.busyUntil && own.busyKind === "collapsed") {
      banner.hidden = false;
      banner.textContent = "Verschüttet — alles verloren";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (own.depth > 0) {
      banner.hidden = false;
      banner.textContent = `${own.carried} Gold hängen unten`;
      banner.style.background = own.carried >= 100 ? "#ffd15c" : "#3c2a1e";
      banner.style.color = own.carried >= 100 ? "#4a3405" : "#ffe9c8";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Der Schacht ist schmal und hoch — im Hochformat passt er näher heran.
      this.baseCamZ = portrait ? 5.2 : 6.4;
      camera.fov = portrait ? 56 : 46;
    });
  }
}
