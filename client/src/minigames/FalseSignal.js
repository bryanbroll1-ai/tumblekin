import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin75";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin75";
import { shakeScale } from "./Quality.js?v=tumblekin75";

// Falschsignal — alle starren auf EINEN Signalmast. Nur ein Signal ist echt,
// und die Fälschungen sind absichtlich nah dran:
//
//   go      runder grüner Kreis, der stehen bleibt   → tippen
//   colour  runder Kreis, aber giftgelb-grün         → falsche Farbe
//   shape   richtiges Grün, aber eckig               → falsche Form
//   flicker richtig rund UND grün, aber nur 130 ms   → Antäuscher
//
// Der Antäuscher ist der Kern des Spiels: er sieht bis zur Millisekunde echt
// aus. Wer sofort drückt, tappt hinein; wer kurz abwartet, erkennt ihn — und
// zahlt dafür mit Punkten, weil schnelle Reaktionen mehr wert sind. Genau diese
// Zange macht das Spiel spannend.
// Alle Maße sind am ECHTEN Canvas gerechnet, nicht geschätzt: auf einem heutigen
// Handy ist das Spielfeld bildschirmfüllend, also 430×932 → Seitenverhältnis
// 0.46. Ein erster Aufbau mit naher Kamera schnitt den äussersten Kin ab, weil
// ich mit 0.75 gerechnet hatte. Bei dieser Kamera liegen die äusseren Kins bei
// x≈±0.73 NDC (bis herunter zu 0.42 noch im Bild) und die Lampe füllt
// y≈0.15…0.56 — sie ist gross genug, um sie im Augenwinkel zu erkennen.
const LAMP_Y = 4.4;
const LAMP_Z = -2.0;
const LAMP_R = 1.35;
const LANE_GAP = 0.95;
const KIN_Z = 2.4;
// Die Tafel ist BREITER als hoch. Mit einer runden Scheibe auf einem Stamm sah
// der Mast im ersten Wurf wie ein Baum aus — die querliegende Tafel plus die
// Warnstreifen am Mast machen daraus auf einen Blick ein Signal.
const PANEL_W = 4.0;
const PANEL_H = 3.1;

const LAMP_COLORS = {
  idle: "#28313f",
  go: "#4dff7a",
  colour: "#d8ff3a",        // fast Grün — auf einen Blick verwechselbar
  shape: "#4dff7a",         // richtiges Grün, falsche Form
  flicker: "#4dff7a"        // richtig, nur zu kurz
};

const REACT_LABELS = {
  colour: "FALSCHE FARBE",
  shape: "FALSCHE FORM",
  flicker: "ANGETÄUSCHT!",
  early: "ZU FRÜH!"
};

export class FalseSignal {
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
    this.lanes = new Map();
    this.lastReactAt = new Map();
    this.lastSignalIndex = -1;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.lampPulse = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Falschsignal", fog: ["#9fd9f0", 16, 44], fov: 60, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="signal-legend" data-signal-legend>
        <span class="signal-chip signal-chip-real"></span>
        <span>Nur der runde grüne Kreis, der <strong>bleibt</strong></span>
      </div>
      <div class="color-banner" data-signal-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-signal-react>
        <span class="nerve-button-face">JETZT!</span>
      </button>
    `;
    this.button = this.controls.querySelector("[data-signal-react]");
    this.onTap = (event) => {
      event.preventDefault();
      this.pressReact();
    };
    this.button.addEventListener("pointerdown", this.onTap);
    this.webglCanvas.addEventListener("pointerdown", this.onTap);
    this.loop();
  }

  pressReact() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    this.feedback?.sound("tap");
    this.sendInput({ action: "react" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.button?.removeEventListener("pointerdown", this.onTap);
    this.webglCanvas?.removeEventListener("pointerdown", this.onTap);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
    this.lanes.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-5, 13, 8],
      shadow: { left: -8, right: 8, top: 12, bottom: -4 }
    });

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.5, 20),
      new THREE.MeshLambertMaterial({ color: "#6fc4a0" })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Bahn zwischen Startlinie und Mast. Ohne sie lag zwischen den Kins und dem
    // Signal eine grosse leere Wiese; die Bahn füllt sie und gibt dem Bild Tiefe.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP * 4.6, 0.04, 6.2),
      new THREE.MeshLambertMaterial({ color: "#adbcb2" })
    );
    apron.position.set(0, 0.005, 0.1);
    apron.receiveShadow = true;
    this.scene.add(apron);

    // Bahntrenner laufen auf den Mast zu — die Fluchtlinien führen den Blick
    // von den Figuren nach oben zur Lampe.
    for (let i = 0; i <= 4; i += 1) {
      const divider = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.02, 5.6),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, depthWrite: false })
      );
      divider.position.set((i - 2) * LANE_GAP, 0.03, 0.1);
      this.scene.add(divider);
    }

    // Startlinie VOR den Figuren, nicht unter ihnen: auf Höhe der Füsse schnitt
    // sie mitten durch die Kins.
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP * 4.6, 0.02, 0.18),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85, depthWrite: false })
    );
    line.position.set(0, 0.04, KIN_Z + 0.55);
    this.scene.add(line);

    this.buildTower();

    [[-7.5, 6.8, -7, 4], [7.2, 7.6, -5, 9]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureKin(player, index, players.length));
    this.resizeRenderer();
    this.camera.position.set(0, 3.2, 9.2);
    this.camera.lookAt(0, 2.2, -0.5);
  }

  buildTower() {
    const steel = new THREE.MeshLambertMaterial({ color: "#37445a" });
    const dark = new THREE.MeshLambertMaterial({ color: "#212a37" });

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, LAMP_Y - 1.2, 10), steel);
    mast.position.set(0, (LAMP_Y - 1.2) / 2, LAMP_Z);
    mast.castShadow = true;
    this.scene.add(mast);

    // Warnstreifen am Mast: das eine Detail, das den Baum-Eindruck bricht.
    // Muss WEITER sein als der Mast an dieser Höhe (unten 0.19) — mit 0.16
    // steckten die Streifen im Mast und waren unsichtbar.
    [0.45, 0.8, 1.15].forEach((y) => {
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.23, 0.13, 10),
        new THREE.MeshLambertMaterial({ color: "#ffd15c" })
      );
      stripe.position.set(0, y, LAMP_Z);
      this.scene.add(stripe);
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.66, 0.2, 12), steel);
    base.position.set(0, 0.1, LAMP_Z);
    base.castShadow = true;
    this.scene.add(base);

    // Signaltafel: quer, dunkel, mit Rahmen. Der Rahmen macht aus der Scheibe
    // eine Linse statt einer Baumkrone.
    const panel = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W, PANEL_H, 0.34), dark);
    panel.position.set(0, LAMP_Y, LAMP_Z - 0.14);
    panel.castShadow = true;
    this.scene.add(panel);

    const bezel = new THREE.Mesh(
      new THREE.TorusGeometry(LAMP_R * 1.09, 0.13, 8, 32),
      new THREE.MeshLambertMaterial({ color: "#161d27" })
    );
    bezel.position.set(0, LAMP_Y, LAMP_Z + 0.06);
    this.scene.add(bezel);

    // Blende: ein schräges Dach über der Linse. Der erste Versuch war ein
    // offener Zylinderausschnitt — der stand als schwarzer Bogen frei im Bild.
    const hood = new THREE.Mesh(new THREE.BoxGeometry(PANEL_W * 0.92, 0.14, 0.7), dark);
    hood.position.set(0, LAMP_Y + PANEL_H / 2 - 0.14, LAMP_Z + 0.26);
    hood.rotation.x = -0.32;
    hood.castShadow = true;
    this.scene.add(hood);

    // Zwei dauerhaft dunkle Nebenlinsen füllen die Tafel und zeigen, dass die
    // Mitte die Anzeige ist, auf die es ankommt.
    [-1, 1].forEach((side) => {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.3, 18),
        new THREE.MeshBasicMaterial({ color: "#151c26", toneMapped: false })
      );
      dot.position.set(side * (PANEL_W / 2 - 0.42), LAMP_Y - PANEL_H / 2 + 0.42, LAMP_Z + 0.05);
      this.scene.add(dot);
    });

    // Rund UND eckig liegen übereinander; je Signal ist genau eine Form
    // sichtbar. So kann die Form täuschen, ohne dass die Lampe springt.
    // toneMapped: false ist hier entscheidend — mit ACES-Tonemapping wurde aus
    // dem Signalgrün ein blasses Mint, das man nicht als "LOS" gelesen hat.
    this.lampRound = new THREE.Mesh(
      new THREE.CircleGeometry(LAMP_R, 32),
      new THREE.MeshBasicMaterial({ color: LAMP_COLORS.idle, toneMapped: false })
    );
    this.lampRound.position.set(0, LAMP_Y, LAMP_Z + 0.08);
    this.scene.add(this.lampRound);

    this.lampSquare = new THREE.Mesh(
      new THREE.PlaneGeometry(LAMP_R * 1.62, LAMP_R * 1.62),
      new THREE.MeshBasicMaterial({ color: LAMP_COLORS.idle, toneMapped: false })
    );
    this.lampSquare.position.set(0, LAMP_Y, LAMP_Z + 0.08);
    this.lampSquare.visible = false;
    this.scene.add(this.lampSquare);

    // Der Schein wirft die Signalfarbe in die Szene — man sieht es auch im
    // Augenwinkel, statt nur die Lampe anzustarren.
    this.glow = new THREE.PointLight(LAMP_COLORS.go, 0, 16);
    this.glow.position.set(0, LAMP_Y, LAMP_Z + 1.6);
    this.scene.add(this.glow);

    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(LAMP_R * 1.05, LAMP_R * 1.55, 34),
      new THREE.MeshBasicMaterial({
        color: LAMP_COLORS.go, transparent: true, opacity: 0, depthWrite: false, toneMapped: false
      })
    );
    this.halo.position.set(0, LAMP_Y, LAMP_Z + 0.06);
    this.scene.add(this.halo);
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  ensureKin(player, index = 0, count = 4) {
    if (this.kins.has(player.id)) return this.lanes.get(player.id);
    const x = this.laneX(index, count);

    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.position.set(x, 0, KIN_Z);
    // Alle schauen zum Mast, nicht in die Kamera.
    kin.rotation.y = Math.PI;
    this.scene.add(kin);

    const animator = new KinAnimator(kin);
    animator.groundY = 0;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);

    const lane = { x, color: player.color };
    this.lanes.set(player.id, lane);
    return lane;
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  // Das Signal, das gerade leuchtet — dieselbe Regel wie auf dem Server.
  activeSignal(arcade, elapsed) {
    const signals = arcade.signals || [];
    for (const signal of signals) {
      if (elapsed >= signal.at && elapsed <= signal.at + signal.windowMs) return signal;
      if (signal.at > elapsed) break;
    }
    return null;
  }

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

    const signal = this.activeSignal(arcade, elapsed);
    this.paintLamp(signal, dt);

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const lane = this.ensureKin(player, index, state.players.length);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);

      // Rückmeldung zum letzten Griff — Treffer wie Fehlgriff.
      const react = entry.lastReact;
      const seen = this.lastReactAt.get(player.id);
      if (react && react.at !== seen) {
        this.lastReactAt.set(player.id, react.at);
        this.showReaction(player, lane, react, controlledId);
      }

      const locked = (entry.lockUntil || 0) > now;
      if (minigame.finaleAt) animator.set("cheer", { base: true });
      else if (locked) animator.set("sad", { base: true });
      else animator.set("idle", { base: true });
      animator.update(now);

      // Wer gesperrt ist, sinkt sichtbar zusammen — die Auszeit muss man sehen.
      const targetX = lane.x;
      kin.position.x += (targetX - kin.position.x) * 0.2;
      kin.userData.shadow.position.set(kin.position.x, 0.05, KIN_Z);
      kin.userData.shadow.material.opacity = locked ? 0.1 : 0.22;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.75;
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    // Bewusst KEINE Vorspannung zur eigenen Bahn: alle schauen auf dieselbe
    // Lampe, und ein seitlicher Versatz schob auf dem schmalen Handybild den
    // äussersten Kin aus dem Rand. Wer man selbst ist, zeigt die Marke über dem
    // Kopf. Nur der Ruckler nach einem Fehlgriff bewegt die Kamera.
    this.shake *= 0.9;
    const shakeX = Math.sin(now / 14) * this.shake * 0.22 * shakeScale();
    const desired = new THREE.Vector3(shakeX, this.baseCamY || 3.2, this.baseCamZ || 9.2);
    this.camera.position.lerp(desired, 0.1);
    this.camera.lookAt(0, 2.2, -0.5);

    this.updateHud(minigame, arcade, state, now);
    syncOwnMarker(this, this.kins?.get(controlledId), now);
    this.renderer.render(this.scene, this.camera);
  }

  paintLamp(signal, dt) {
    const kind = signal ? signal.kind : "idle";
    const color = LAMP_COLORS[kind] || LAMP_COLORS.idle;
    // Eckig nur bei der Formfälschung — sonst rund.
    this.lampSquare.visible = kind === "shape";
    this.lampRound.visible = kind !== "shape";
    const lamp = kind === "shape" ? this.lampSquare : this.lampRound;
    lamp.material.color.set(color);

    if (signal && signal.index !== this.lastSignalIndex) {
      this.lastSignalIndex = signal.index;
      this.lampPulse = 1;
      // Der Antäuscher darf sich nicht ankündigen: gleicher Klang wie ein
      // echtes Signal. Nur die Dauer verrät ihn.
      this.feedback?.sound(kind === "colour" || kind === "shape" ? "plink" : "pop");
    }
    this.lampPulse = Math.max(0, this.lampPulse - dt * 3.2);
    const lit = signal ? 1 : 0;
    const scale = 1 + this.lampPulse * 0.18;
    lamp.scale.setScalar(scale);

    this.glow.color.set(color);
    this.glow.intensity += ((lit ? 14 : 0) - this.glow.intensity) * 0.4;
    this.halo.material.color.set(color);
    this.halo.material.opacity += ((lit ? 0.5 : 0) - this.halo.material.opacity) * 0.3;
    this.halo.scale.setScalar(1 + this.lampPulse * 0.3);
  }

  showReaction(player, lane, react, controlledId) {
    const own = player.id === controlledId;
    const at = new THREE.Vector3(lane.x, 1.05, KIN_Z);
    const animator = this.animators.get(player.id);

    if (react.kind === "go") {
      animator?.set("jump");
      this.bursts.spawn(at, [lane.color, "#4dff7a", "#ffffff"], {
        count: 14, speed: 2.0, up: 2.2, size: 0.07, life: 0.6, drag: 1.8
      });
      const fast = react.reactionMs !== null && react.reactionMs < 260;
      this.floaters.pop(at, fast ? `BLITZ! +${react.points}` : `+${react.points}`, {
        color: "#4dff7a", size: fast ? 0.4 : 0.34, life: 0.8
      });
      if (own) {
        this.feedback?.sound(fast ? "perfect" : "pop");
        this.feedback?.vibrate([8, 10, 14]);
      }
      return;
    }

    animator?.set("stumble");
    this.bursts.spawn(at, ["#ff6b7f", "#ffffff"], {
      count: 10, speed: 1.5, up: 1.1, size: 0.06, life: 0.5, drag: 2.2
    });
    this.floaters.pop(at, REACT_LABELS[react.kind] || "FEHLGRIFF", {
      color: "#ff9aa8", size: 0.34, life: 0.9
    });
    if (own) {
      this.feedback?.sound("error");
      this.feedback?.vibrate(24);
      this.shake = Math.max(this.shake, 0.35);
    }
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.max(0, own?.score || 0));

    const banner = this.hud.querySelector("[data-signal-banner]");
    if (!banner) return;
    const locked = (own?.lockUntil || 0) > now;
    // Bewusst KEIN "JETZT!"-Banner beim echten Signal: der Banner sitzt mittig
    // und lag damit genau auf der Linse — er verdeckte das Signal, auf das man
    // reagieren soll. Die Lampe ist die Ansage, der Banner nur Beiwerk.
    if (locked) {
      banner.hidden = false;
      banner.textContent = `Fehlgriff — gesperrt (${Math.ceil((own.lockUntil - now) / 100) / 10}s)`;
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if ((own?.hits || 0) >= 3 && (own?.falseStarts || 0) === 0) {
      banner.hidden = false;
      banner.textContent = `${own.hits}× sauber — kein Fehlgriff!`;
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3400";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Am gemessenen Canvas gerechnet (430×932 → 0.46): äussere Kins bei
      // x≈±0.73, Lampe bei y≈0.15…0.56. Im Querformat sitzt die Lampe höher im
      // Bild, deshalb dort etwas näher und mit engerem Blickwinkel.
      this.baseCamY = portrait ? 3.2 : 3.0;
      this.baseCamZ = portrait ? 9.2 : 8.4;
      camera.fov = portrait ? 62 : 52;
    });
  }
}
