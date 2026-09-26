import * as THREE from "/vendor/three/three.module.js";
import { flashKin } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer, himmel, zaun } from "./Kulisse.js?v=tumblekin200";

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
      background: "#c9a0a8",
      fog: ["#e0b8a8", 18, 50],
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
      new THREE.BoxGeometry(40, 0.5, 34),
      new THREE.MeshLambertMaterial({ color: "#d6ae78" })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    scene.add(ground);

    // Bahn zwischen Startlinie und Mast. Ohne sie lag zwischen den Kins und dem
    // Signal eine grosse leere Wiese; die Bahn füllt sie und gibt dem Bild Tiefe.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP * 4.6, 0.04, 6.2),
      new THREE.MeshLambertMaterial({ color: "#b8bcc4" })
    );
    apron.position.set(0, 0.005, 0.1);
    apron.receiveShadow = true;
    scene.add(apron);

    // Bahntrenner laufen auf den Mast zu — die Fluchtlinien führen den Blick
    // von den Figuren nach oben zur Lampe.
    this.buildTower();
    this.buildSpaceport(scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addLane(player, index, players.length));
  }

  // Der Signalmast steht auf einem Weltraumbahnhof in der Abenddämmerung:
  // hinten die Rakete am Startturm, Radarschüsseln, die sich drehen, ein
  // Leitbunker mit Blinklichtern, Treibstofftanks, Flutlichtmasten und ein
  // Zaun. Vorher stand der Mast auf einer leeren Wiese.
  buildSpaceport(scene) {
    himmel(scene, { oben: "#3b5aa6", unten: "#ffb892" });
    const zufall = streuer(19);
    // Warnstreifen an der Startlinie.
    const streifen = [];
    for (let i = 0; i < 12; i += 1) streifen.push({ p: [-2.3 + i * 0.42, 0.03, 2.05], r: [-Math.PI / 2, 0, 0.6] });
    viele(scene, new THREE.PlaneGeometry(0.18, 0.5), lambert("#ffd15c"), streifen);
    // Rakete mit Startrampe und Turm.
    const rakete = new THREE.Group();
    kiste(rakete, 3.2, 0.5, 3.2, "#7c8290", [0, 0.25, 0]);
    const rumpf = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 5.2, 16), lambert("#f4f6fa"));
    rumpf.position.y = 3.2;
    rumpf.castShadow = true;
    rakete.add(rumpf);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.61, 0.61, 0.5, 16), lambert("#e0344a"));
    band.position.y = 4.4;
    rakete.add(band);
    const spitze = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.5, 16), lambert("#e0344a"));
    spitze.position.y = 6.55;
    rakete.add(spitze);
    [0, 1, 2, 3].forEach((i) => {
      const flosse = kiste(rakete, 0.08, 1.1, 0.8, "#e0344a", [0, 1.2, 0]);
      flosse.geometry.translate(0, 0, 0.75);
      flosse.rotation.y = (i * Math.PI) / 2;
    });
    [3.6, 5.2].forEach((y) => {
      const fenster = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), lambert("#6cc6ff"));
      fenster.position.set(0, y, 0.605);
      rakete.add(fenster);
    });
    const turm = new THREE.Group();
    [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].forEach(([x, z]) => kiste(turm, 0.12, 7, 0.12, "#c8413b", [x, 3.5, z]));
    for (let y = 0.8; y < 7; y += 0.9) {
      kiste(turm, 0.9, 0.08, 0.08, "#c8413b", [0, y, -0.4], { schatten: false });
      kiste(turm, 0.9, 0.08, 0.08, "#c8413b", [0, y, 0.4], { schatten: false });
      kiste(turm, 0.08, 0.08, 0.9, "#c8413b", [-0.4, y, 0], { schatten: false });
    }
    kiste(turm, 1.2, 0.1, 0.1, "#c8413b", [-0.9, 5.4, 0]);
    turm.position.set(1.4, 0, 0);
    rakete.add(turm);
    rakete.position.set(-4.8, 0, -8.5);
    scene.add(rakete);
    this.steam = [];
    for (let i = 0; i < 6; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshLambertMaterial({ color: "#f2f2f2", transparent: true, opacity: 0.55, depthWrite: false }));
      puff.userData = { phase: i / 6, isFx: true };
      scene.add(puff);
      this.steam.push(puff);
    }
    // Radarschüsseln.
    this.radars = [[4.6, -6.2], [6.6, -3.2]].map(([x, z], i) => {
      const g = new THREE.Group();
      kiste(g, 0.5, 1.6, 0.5, "#9aa2b0", [0, 0.8, 0]);
      const kopf = new THREE.Group();
      const schale = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), lambert("#eef1f5", { side: THREE.DoubleSide }));
      schale.rotation.x = -Math.PI / 2 + 0.5;
      kopf.add(schale);
      const antenne = kiste(kopf, 0.05, 0.05, 0.9, "#6b7280", [0, 0.2, 0.45], { schatten: false });
      antenne.rotation.x = 0.5;
      kopf.position.y = 1.75;
      g.add(kopf);
      g.position.set(x, 0, z);
      g.scale.setScalar(i ? 0.8 : 1);
      scene.add(g);
      return kopf;
    });
    // Leitbunker mit Blinklichtern.
    const bunker = new THREE.Group();
    kiste(bunker, 3.4, 1.4, 2.2, "#9aa2b0", [0, 0.7, 0]);
    kiste(bunker, 3.6, 0.2, 2.4, "#7c8290", [0, 1.5, 0]);
    kiste(bunker, 2.4, 0.4, 0.05, "#1d2a4a", [0, 0.95, 1.11], { schatten: false });
    this.blinkers = [];
    for (let i = 0; i < 5; i += 1) {
      const licht = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: "#ff3b3b" }));
      licht.position.set(-0.8 + i * 0.4, 0.95, 1.14);
      bunker.add(licht);
      this.blinkers.push(licht);
    }
    kiste(bunker, 0.1, 1.2, 0.1, "#6b7280", [1.2, 2.1, 0.6]);
    bunker.position.set(1.6, 0, -9.5);
    scene.add(bunker);
    // Treibstofftanks auf Stelzen.
    [[-8.4, -3.2], [-8.4, -5.0]].forEach(([x, z]) => {
      const tank = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), lambert("#f4f6fa"));
      tank.position.set(x, 1.6, z);
      tank.castShadow = true;
      scene.add(tank);
      [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(([dx, dz]) => kiste(scene, 0.08, 1.2, 0.08, "#7c8290", [x + dx, 0.6, z + dz], { schatten: false }));
    });
    // Flutlichtmasten.
    [[-6.2, -1.5], [6.4, 0.2]].forEach(([x, z]) => {
      kiste(scene, 0.14, 5, 0.14, "#5a6270", [x, 2.5, z]);
      const kopf = kiste(scene, 1.1, 0.5, 0.3, "#2c2f38", [x, 5.1, z]);
      kopf.rotation.y = Math.atan2(-x, -z);
      const glas = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.35), new THREE.MeshBasicMaterial({ color: "#fff4c8" }));
      glas.position.set(x, 5.1, z);
      glas.lookAt(0, 0, 0);
      glas.position.addScaledVector(glas.getWorldDirection(new THREE.Vector3()), 0.16);
      scene.add(glas);
    });
    // Zaun hinten, Kakteen und Kisten.
    zaun(scene, [-12, -12], [12, -12], { color: "#9aa2b0", pfostenColor: "#6b7280", hoehe: 1.1 });
    viele(scene, new THREE.BoxGeometry(0.6, 0.6, 0.6), lambert("#b98a55"), [[6.2, 0.3, 2.4], [6.8, 0.3, 2.9], [6.5, 0.9, 2.6]].map((p) => ({ p, r: [0, zufall(), 0] })), { schatten: true });
    [[-6.5, 3.0], [5.2, -1.8], [-3.2, -5.2]].forEach(([x, z]) => {
      kiste(scene, 0.3, 1.2, 0.3, "#4f9b4a", [x, 0.6, z]);
      kiste(scene, 0.22, 0.5, 0.22, "#4f9b4a", [x + 0.28, 0.8, z]);
      kiste(scene, 0.2, 0.2, 0.2, "#4f9b4a", [x + 0.18, 0.6, z]);
    });
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
      frame: { w: 4.5, h: 3.8 },
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
    const tt = f.now / 1000;
    this.radars?.forEach((kopf, i) => { kopf.rotation.y = tt * (0.4 + i * 0.25); });
    this.blinkers?.forEach((licht, i) => { licht.material.color.set(Math.floor(tt * 3 + i) % 3 === 0 ? "#ff3b3b" : "#5a1414"); });
    this.steam?.forEach((puff) => {
      const u = (tt / 3 + puff.userData.phase) % 1;
      puff.position.set(-4.8 + (puff.userData.phase - 0.5) * 3 + u * 1.2, 0.5 + u * 1.4, -8.5 + 1.8);
      puff.scale.setScalar(0.6 + u * 1.6);
      puff.material.opacity = 0.55 * (1 - u);
    });
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
