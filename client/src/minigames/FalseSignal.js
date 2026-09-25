import * as THREE from "/vendor/three/three.module.js";
import { createCloud, flashKin } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Falschsignal: ein Ring wächst in der Signaltafel. Schafft er die Marke,
// muss man drücken — bleibt er vorher stehen, war es eine Finte.
//
// Vorher füllte die Tafel das halbe Bild, und die Figuren standen klein und
// reglos darunter. Jetzt ist es eine Spielshow: jeder steht an seinem Pult mit
// einem grossen Buzzer, alle schauen gebannt auf den Ring, hauen auf den
// Knopf, jubeln bei einem Treffer und fassen sich an den Kopf, wenn sie auf
// die Finte hereingefallen sind.
const LAMP_Y = 3.15;
const LAMP_Z = -1.9;
const LAMP_R = 1.0;
const LANE_GAP = 1.05;
const KIN_Z = 1.25;
const PANEL_W = 3.0;
const PANEL_H = 2.35;

const RING_COLOR = "#4dff7a";     // wachsender Ring
const RING_DEAD = "#ff6b7f";      // ein Ring, der stehengeblieben ist
const MARK_COLOR = "#ffe36b";     // die Marke am Rand

const REACT_LABELS = {
  fake: "STEHENGEBLIEBEN!",
  early: "ZU FRÜH!"
};

export class FalseSignal extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lanes = new Map();
    this.lastReactAt = new Map();
    this.lastSignalIndex = -1;
    this.lampPulse = 0;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Falschsignal",
      background: "#9fd9f0",
      fog: ["#9fd9f0", 16, 44],
      lights: { sunPosition: [-5, 13, 8], shadow: { left: -8, right: 8, top: 12, bottom: -4 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="signal-legend" data-signal-legend>
        <span class="signal-chip signal-chip-real"></span>
        <span>Tippe, wenn der Ring die Marke <strong>schafft</strong></span>
      </div>
      <div class="color-banner" data-signal-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(28, 0.5, 20),
      new THREE.MeshLambertMaterial({ color: "#6fc4a0" })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    scene.add(ground);

    // Bahn zwischen Startlinie und Mast. Ohne sie lag zwischen den Kins und dem
    // Signal eine grosse leere Wiese; die Bahn füllt sie und gibt dem Bild Tiefe.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP * 4.6, 0.04, 6.2),
      new THREE.MeshLambertMaterial({ color: "#adbcb2" })
    );
    apron.position.set(0, 0.005, 0.1);
    apron.receiveShadow = true;
    scene.add(apron);

    // Bahntrenner laufen auf den Mast zu — die Fluchtlinien führen den Blick
    // von den Figuren nach oben zur Lampe.
    this.buildTower();
    [[-7.5, 6.8, -7, 4], [7.2, 7.6, -5, 9]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addLane(player, index, players.length));
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

    // Die dunkle Linse, in der der Ring wächst.
    // toneMapped: false ist hier entscheidend — mit ACES-Tonemapping wurde aus
    // dem Signalgrün ein blasses Mint, das man nicht als "LOS" gelesen hat.
    this.lens = new THREE.Mesh(
      new THREE.CircleGeometry(LAMP_R, 36),
      new THREE.MeshBasicMaterial({ color: "#141b25", toneMapped: false })
    );
    this.lens.position.set(0, LAMP_Y, LAMP_Z + 0.08);
    this.scene.add(this.lens);

    // DIE MARKE. Erreicht der Ring sie, war er echt. Sie steht immer da, damit
    // man beim Wachsen die ganze Zeit sieht, wie weit es noch ist — ohne sie
    // wüsste man nie, ob ein Ring gerade langsamer wird oder gleich ankommt.
    this.mark = new THREE.Mesh(
      new THREE.RingGeometry(LAMP_R * 0.93, LAMP_R * 0.99, 40),
      new THREE.MeshBasicMaterial({ color: MARK_COLOR, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false })
    );
    this.mark.position.set(0, LAMP_Y, LAMP_Z + 0.10);
    this.scene.add(this.mark);

    // Der wachsende Ring selbst. Ein Ring statt einer Scheibe, damit die Marke
    // dahinter sichtbar bleibt und der Abstand zu ihr ablesbar ist.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1, 40),
      new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    this.ring.position.set(0, LAMP_Y, LAMP_Z + 0.12);
    this.scene.add(this.ring);

    // Ein Kern in der Mitte, der mit dem Ring heller wird — die Linse soll
    // leuchten, nicht nur einen Strich zeigen.
    this.core = new THREE.Mesh(
      new THREE.CircleGeometry(LAMP_R * 0.2, 20),
      new THREE.MeshBasicMaterial({ color: RING_COLOR, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    this.core.position.set(0, LAMP_Y, LAMP_Z + 0.11);
    this.scene.add(this.core);

    // Der Schein wirft die Signalfarbe in die Szene — man sieht es auch im
    // Augenwinkel, statt nur die Lampe anzustarren.
    this.glow = new THREE.PointLight(RING_COLOR, 0, 16);
    this.glow.position.set(0, LAMP_Y, LAMP_Z + 1.6);
    this.scene.add(this.glow);

    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(LAMP_R * 1.05, LAMP_R * 1.55, 34),
      new THREE.MeshBasicMaterial({
        color: RING_COLOR, transparent: true, opacity: 0, depthWrite: false, toneMapped: false
      })
    );
    this.halo.position.set(0, LAMP_Y, LAMP_Z + 0.06);
    this.scene.add(this.halo);
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  // Figur hinter ihrem Pult; der Buzzer liegt zwischen ihr und der Tafel.
  addLane(player, index, count) {
    const x = this.laneX(index, count);
    const facing = Math.PI + Math.atan2(x, KIN_Z - LAMP_Z) * 0.6;
    this.addKin(player, index, { x, ground: 0, z: KIN_Z, facing });
    const podium = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.52, 0.38), new THREE.MeshLambertMaterial({ color: "#2f3a4e" }));
    body.position.y = 0.26;
    body.castShadow = true;
    podium.add(body);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.4), new THREE.MeshLambertMaterial({ color: player.color }));
    front.position.y = 0.48;
    podium.add(front);
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.1, 14), new THREE.MeshLambertMaterial({ color: "#ff3b4f", emissive: "#ff3b4f", emissiveIntensity: 0.2 }));
    dome.position.y = 0.59;
    podium.add(dome);
    podium.position.set(x + Math.sin(facing) * 0.44, 0, KIN_Z + Math.cos(facing) * 0.44);
    podium.rotation.y = facing;
    this.scene.add(podium);
    this.lanes.set(player.id, { x, color: player.color, facing, dome, pressedAt: -1e9, glow: null });
  }

  shot() {
    return {
      look: [0, 1.4, 0.1],
      frame: { w: 4.1, h: 3.8 },
      yaw: 0.3,
      pitch: 0.2,
      fov: 36,
      intro: { yaw: 0.45, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-signal-react>
        <span class="nerve-button-face">JETZT!</span>
      </button>`;
    this.button = this.controls.querySelector("[data-signal-react]");
    const tap = (event) => {
      event.preventDefault();
      this.pressReact();
    };
    this.on(this.button, "pointerdown", tap);
    this.on(this.webglCanvas, "pointerdown", tap);
  }

  pressReact() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    this.feedback?.sound("tap");
    // Sofort zuschlagen, nicht erst auf die Antwort warten.
    const id = this.getControlledPlayerId();
    this.animators.get(id)?.trigger("punch");
    const lane = this.lanes.get(id);
    if (lane) lane.pressedAt = this.now();
    this.sendInput({ action: "react" }).catch(() => {});
  }

  activeSignal(arcade, elapsed) {
    const signals = arcade.signals || [];
    for (const signal of signals) {
      if (elapsed >= signal.at && elapsed <= signal.at + signal.windowMs) return signal;
      if (signal.at > elapsed) break;
    }
    return null;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const signal = this.activeSignal(arcade, elapsed);
    this.paintLamp(signal, dt, elapsed, arcade);
    const growing = signal ? this.ringRadius(signal, elapsed - signal.at, arcade.growMs || 950) : 0;

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const lane = this.lanes.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !lane || !kin || !animator) return;

      const react = entry.lastReact;
      if (react && react.at !== this.lastReactAt.get(player.id)) {
        this.lastReactAt.set(player.id, react.at);
        if (player.id !== controlledId) {
          animator.trigger("punch");
          lane.pressedAt = now;
        }
        this.showReaction(player, lane, react, controlledId);
      }

      // Buzzer: gedrückt, leuchtend nach einem Treffer oder rot nach einem Fehler.
      const press = Math.max(0, 1 - (now - lane.pressedAt) / 220);
      lane.dome.position.y = 0.59 - press * 0.05;
      const glowLeft = lane.glow ? Math.max(0, 1 - (now - lane.glow.at) / 900) : 0;
      lane.dome.material.emissive.set(lane.glow?.good ? "#4dff7a" : "#ff3b4f");
      lane.dome.material.color.set(lane.glow?.good && glowLeft > 0 ? "#4dff7a" : "#ff3b4f");
      lane.dome.material.emissiveIntensity = 0.2 + glowLeft * 1.2;

      const locked = (entry.lockUntil || 0) > now;
      flashKin(kin, "#ff6b7f", locked ? 0.25 : 0);
      if (finale) {
        kin.rotation.y += Math.atan2(Math.sin(0.4 - kin.rotation.y), Math.cos(0.4 - kin.rotation.y)) * frameLerp(0.08, dt);
        return;
      }
      kin.rotation.y = lane.facing;
      animator.lookAt(new THREE.Vector3(0, LAMP_Y, LAMP_Z));
      if (locked) {
        animator.set("sad");
      } else if (signal && growing > 0.55) {
        animator.set("ready");
        animator.expression("focus", 150);
      } else {
        animator.set("focus");
      }
    });
  }

  ringRadius(signal, since, growMs) {
    const t = Math.max(0, since);
    if (signal.real) return Math.min(1, t / growMs);
    return signal.limit * Math.tanh(t / (growMs * signal.limit));
  }

  paintLamp(signal, dt, elapsed, arcade) {
    const growMs = arcade?.growMs || 950;
    const since = signal ? elapsed - signal.at : 0;
    const radius = signal ? this.ringRadius(signal, since, growMs) : 0;
    // Ein Ring, der stehengeblieben ist, färbt sich rot — aber erst, wenn er
    // wirklich steht. Vorher darf nichts verraten, was er ist.
    const stalled = Boolean(signal) && !signal.real && since > growMs * signal.limit * 1.2;
    const done = Boolean(signal) && signal.real && radius >= 1;

    if (signal && signal.index !== this.lastSignalIndex) {
      this.lastSignalIndex = signal.index;
      this.lampPulse = 1;
      // Der Startklang ist für echt und falsch derselbe. Alles andere wäre ein
      // Verrat, und dann gäbe es nichts mehr zu entscheiden.
      this.feedback?.sound("pop");
      this.stallSeen = false;
    }
    if (stalled && !this.stallSeen) {
      this.stallSeen = true;
      this.feedback?.sound("clack");
    }
    this.lampPulse = Math.max(0, this.lampPulse - dt * 3.2);

    const color = stalled ? RING_DEAD : RING_COLOR;
    const scale = Math.max(0.02, radius * LAMP_R);
    this.ring.visible = Boolean(signal);
    this.ring.scale.setScalar(scale);
    this.ring.material.color.set(color);
    // Ausblenden, wenn ein falscher Ring verlischt — genau daran erkennt man
    // im Nachhinein, dass man richtig gewartet hat.
    const fade = stalled
      ? Math.max(0, 1 - (since - growMs * signal.limit * 1.2) / 420)
      : 1;
    this.ring.material.opacity = signal ? 0.95 * fade : 0;

    this.core.visible = Boolean(signal);
    this.core.material.color.set(color);
    this.core.material.opacity = signal ? (0.25 + radius * 0.5) * fade : 0;
    this.core.scale.setScalar(1 + this.lampPulse * 0.4);

    // Die Marke pulsiert, sobald ein Ring sie erreicht hat.
    this.mark.material.opacity = done ? 0.9 : 0.5;
    this.mark.material.color.set(done ? RING_COLOR : MARK_COLOR);
    this.mark.scale.setScalar(done ? 1 + Math.sin(elapsed / 70) * 0.04 : 1);

    this.glow.color.set(color);
    const wanted = signal ? (4 + radius * 12) * fade : 0;
    this.glow.intensity += (wanted - this.glow.intensity) * 0.4;
    this.halo.material.color.set(color);
    this.halo.material.opacity += ((done ? 0.6 : 0) - this.halo.material.opacity) * 0.3;
    this.halo.scale.setScalar(1 + this.lampPulse * 0.3);
  }

  showReaction(player, lane, react, controlledId) {
    const own = player.id === controlledId;
    const at = new THREE.Vector3(lane.x, 1.1, KIN_Z);
    const animator = this.animators.get(player.id);
    const now = this.now();
    if (react.kind === "go") {
      lane.glow = { at: now, good: true };
      animator?.trigger("hop", { height: 0.22 });
      animator?.trigger("fistpump");
      animator?.expression("joy", 700);
      this.burst(at, [lane.color, "#4dff7a", "#ffffff"], { count: 14, speed: 2.0, up: 2.2, size: 0.07, life: 0.6, drag: 1.8 });
      const bold = (react.radius ?? 1) < 0.45;
      this.pop(at, bold ? `MUTIG! +${react.points}` : `+${react.points}`, { color: "#4dff7a", size: bold ? 0.4 : 0.34, life: 0.8 });
      if (own) {
        this.feedback?.sound(bold ? "perfect" : "pop");
        this.feedback?.vibrate([8, 10, 14]);
      }
      return;
    }
    lane.glow = { at: now, good: false };
    animator?.trigger("stumble");
    animator?.trigger("facepalm");
    animator?.expression("angry", 900);
    this.burst(at, ["#ff6b7f", "#ffffff"], { count: 10, speed: 1.5, up: 1.1, size: 0.06, life: 0.5, drag: 2.2 });
    this.pop(at, REACT_LABELS[react.kind] || "FEHLGRIFF", { color: "#ff9aa8", size: 0.34, life: 0.9 });
    if (own) {
      this.feedback?.sound("error");
      this.feedback?.vibrate(24);
      this.rig.shake(0.35);
    }
  }

  drawHud(f) {
    const { arcade, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, own?.score || 0));
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
      // Der Mut ist die eigentliche Leistung — der kleinste Ring, bei dem ein
      // Treffer sass. Deshalb steht er hier und nicht die Zahl der Treffer.
      const bold = Math.round((own.boldest ?? 1) * 100);
      banner.textContent = `${own.hits}× sauber · mutigster Griff bei ${bold}%`;
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3400";
    } else {
      banner.hidden = true;
    }
  }
}
