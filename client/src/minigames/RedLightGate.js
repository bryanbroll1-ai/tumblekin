import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createKin, KinAnimator, KIN_SOLE } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Lichtwächter — "Ochs am Berg": halten heisst laufen. Solange der Riese am
// Ende der Wiese wegschaut und summt, ist Grün. Bevor er sich umdreht, sieht
// man es: er dreht sich langsam herum (gelbe Lampe) — in dieser Zeit darf man
// noch laufen, muss aber bis zum Ende losgelassen haben. Steht er einem
// zugewandt, ist Rot, und wer dann noch hält, fliegt ein Stück zurück und ist
// kurz benommen. Manchmal dreht er nur an und wieder weg.
//
// Vorher sprang das Licht ohne Warnung um, und nach dem Umspringen blieben
// rechnerisch 80 ms zum Loslassen. Die Drehung ist jetzt die Warnung, und die
// Szene zeigt sie genau so, wie der Server sie rechnet: aus demselben
// Phasenplan.
const LANE_GAP = 1.28;
const START_Z = 5.2;
const TRACK_LEN = 22;
const LAWN_TOP_Y = 0;
const GUARD_SCALE = 3.4;
const TRACK_TOP_Y = 0.05;
const RUN_PING_MS = 90;
const KNOCK_MS = 450;
const FLOWER_COLORS = ["#ff6f91", "#ffd15c", "#ffffff", "#b57bff", "#ff9f43"];

const _flower = new THREE.Object3D();
const _color = new THREE.Color();

export class RedLightGate extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lastCaught = new Map();
    this.lastFinished = new Map();
    this.smoothProgress = new Map();
    this.knock = new Map();
    this.holdTimer = null;
    this.holding = false;
    this.lastPhaseKey = null;
    this.labelY = 0.74;
    this.noteAt = 0;
  }

  stage() {
    return {
      label: "3D Lichtwächter",
      background: "#a8e2f4",
      fog: ["#a8e2f4", 28, 80],
      lights: { sunPosition: [-5, 12, 6], shadow: { left: -12, right: 12, top: 18, bottom: -18 }, sunIntensity: 2.9, skyColor: 0xe6f6ff, groundColor: 0x76b8a8 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0m</strong></div>
      <div class="redlight-race" data-redlight-race></div>
      <div class="color-banner" data-light-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const lawn = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.5, TRACK_LEN + 18),
      new THREE.MeshLambertMaterial({ color: "#5fcf68" })
    );
    lawn.position.set(0, -0.25, START_Z - (TRACK_LEN + 4) / 2);
    lawn.receiveShadow = true;
    scene.add(lawn);

    // Die Laufbahn: ein heller Kiesweg mit weissen Bahnlinien.
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(5.8, 0.54, TRACK_LEN + 4),
      new THREE.MeshLambertMaterial({ color: "#f3dfa6" })
    );
    track.position.set(0, -0.22, START_Z - TRACK_LEN / 2);
    track.receiveShadow = true;
    scene.add(track);
    const lineMat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    [-2, -1, 0, 1, 2].forEach((k) => {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, TRACK_LEN + 1), lineMat);
      line.position.set(k * LANE_GAP, 0.06, START_Z - TRACK_LEN / 2);
      scene.add(line);
    });
    // Start- und Ziellinie.
    const start = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.03, 0.22), lineMat);
    start.position.set(0, 0.065, START_Z + 0.45);
    scene.add(start);
    this.buildRibbon();

    // Meterschilder links, alle zehn Meter.
    const goal = this.minigame?.arcade?.goal || 52;
    for (let m = 10; m < goal; m += 10) {
      const sign = this.makeSign(`${m} m`);
      sign.position.set(-3.55, 0, this.progressZ(m, goal));
      scene.add(sign);
    }

    // Blumenbeete am Rand, in einem Aufruf.
    const flowers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: "#ffffff" }), 120);
    for (let i = 0; i < 120; i += 1) {
      const side = i % 2 ? 1 : -1;
      const x = side * (3.25 + ((i * 7) % 5) * 0.28);
      const z = START_Z + 1 - ((i * 37) % 100) / 100 * (TRACK_LEN + 3);
      _flower.position.set(x, 0.12 + ((i * 3) % 4) * 0.03, z);
      _flower.rotation.set(0, i * 0.7, 0);
      _flower.scale.setScalar(0.8 + ((i * 5) % 3) * 0.2);
      _flower.updateMatrix();
      flowers.setMatrixAt(i, _flower.matrix);
      flowers.setColorAt(i, _color.set(FLOWER_COLORS[i % FLOWER_COLORS.length]));
    }
    flowers.instanceMatrix.needsUpdate = true;
    flowers.instanceColor.needsUpdate = true;
    scene.add(flowers);

    [[-5.2, "#3fae4e"], [5.2, "#3fae4e"]].forEach(([x, color]) => {
      for (let i = 0; i < 7; i += 1) {
        const hedge = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.9 + (i % 2) * 0.3, 1.6),
          new THREE.MeshLambertMaterial({ color })
        );
        hedge.position.set(x, 0.45, START_Z - 1.5 - i * 3.6);
        hedge.castShadow = true;
        scene.add(hedge);
      }
    });

    // Das Tor, dahinter der Wächter unter seiner Lampe.
    const gateZ = START_Z - TRACK_LEN - 1.2;
    const gateMat = new THREE.MeshLambertMaterial({ color: "#ffb400" });
    [-3.2, 3.2].forEach((x) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), gateMat);
      post.position.set(x, 1.7, gateZ);
      post.castShadow = true;
      scene.add(post);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 0.5), gateMat);
    beam.position.set(0, 3.4, gateZ);
    scene.add(beam);

    // Der Riese stand einen ganzen Meter über der Wiese. Der Sohlenabstand
    // skaliert mit der Figur mit — bei Faktor 3.4 sind das gut ein Meter.
    this.guard = createKin("#7a4ddb", 3);
    this.guard.scale.setScalar(GUARD_SCALE);
    const guardY = LAWN_TOP_Y + KIN_SOLE * GUARD_SCALE;
    this.guard.position.set(0, guardY, gateZ - 2.2);
    this.guard.rotation.y = Math.PI;
    scene.add(this.guard);
    this.guardAnimator = new KinAnimator(this.guard);
    this.guardAnimator.groundY = guardY;

    this.lampMat = new THREE.MeshLambertMaterial({ color: "#2ee86a", emissive: new THREE.Color("#2ee86a"), emissiveIntensity: 0.9 });
    const lampBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), this.lampMat);
    lampBox.position.set(0, 5.2, gateZ - 2.2);
    scene.add(lampBox);
    const lampPole = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.4, 0.24), new THREE.MeshLambertMaterial({ color: "#40506a" }));
    lampPole.position.set(0, 4.3, gateZ - 2.2);
    scene.add(lampPole);

    // Ein grosser Baum hinter dem Wächter gibt dem Ziel eine Silhouette —
    // seitlich neben dem Tor, nicht dahinter. In der Linie des linken
    // Torpfostens verschmolz seine Krone im Finale mit dem Torbalken, und der
    // Stamm stand mitten hinter dem Sieger.
    const TREE_X = -6.2;
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 0.8), new THREE.MeshLambertMaterial({ color: "#8a5f3c" }));
    trunk.position.set(TREE_X, 2, gateZ - 6.5);
    scene.add(trunk);
    [[0, 4.6, 0, 2.6], [1.1, 5.4, 0.4, 1.8], [-1, 5.2, -0.4, 1.9]].forEach(([dx, y, dz, size]) => {
      const crown = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshLambertMaterial({ color: "#3f9e4d" }));
      crown.position.set(TREE_X + dx, y, gateZ - 6.5 + dz);
      crown.castShadow = true;
      scene.add(crown);
    });

    [[-7, 6, -6, 5], [7, 7, -12, 6], [-6, 7, -18, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    this.gateZ = gateZ;
    this.buildPalaceGarden(scene, gateZ);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      this.addKin(player, index, { x: this.laneX(index), ground: TRACK_TOP_Y, z: START_Z, facing: Math.PI });
    });
  }

  // Ein Schlossgarten: hinten das Schloss mit Säulenportal und Kuppel, entlang
  // der Bahn Formschnitt-Kegel und -Kugeln in Kübeln, zwei steinerne Statuen
  // am Tor, rechts ein plätschernder Brunnen und Gartenlaternen.
  buildPalaceGarden(scene, gateZ) {
    const zufall = streuer(57);
    const schloss = new THREE.Group();
    schloss.position.set(0, 0, gateZ - 13);
    scene.add(schloss);
    const putz = lambert("#f1e6cf");
    kiste(schloss, 22, 6, 3, "", [0, 3, 0], { material: putz, schatten: false });
    const dach = kiste(schloss, 22.4, 1.6, 2.2, "#5f6f8a", [0, 6.6, -0.2], { schatten: false });
    dach.scale.set(1, 1, 1);
    kiste(schloss, 6, 8, 3.6, "", [0, 4, 0.3], { material: putz, schatten: false });
    const giebel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 3.4, 1.6, 3, 1), putz);
    giebel.rotation.set(Math.PI / 2, 0, 0);
    giebel.scale.set(1, 0.3, 1);
    giebel.position.set(0, 8.3, 2.05);
    schloss.add(giebel);
    const kuppel = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), lambert("#6fae9a"));
    kuppel.position.set(0, 8, 0);
    schloss.add(kuppel);
    kiste(schloss, 0.08, 1.4, 0.08, "#2c2f38", [0, 10.4, 0], { schatten: false });
    this.palaceFlag = kiste(schloss, 0.9, 0.5, 0.03, "#c8313b", [0.47, 10.8, 0], { schatten: false });
    viele(schloss, new THREE.CylinderGeometry(0.22, 0.24, 5.6, 10), lambert("#ffffff"), [-2.2, -1.1, 0, 1.1, 2.2].map((x) => ({ p: [x, 2.8, 2.25] })));
    const fenster = [];
    [-1, 1].forEach((seite) => {
      for (let i = 0; i < 6; i += 1) {
        [1.7, 4.2].forEach((y) => fenster.push({ p: [seite * (4 + i * 1.2), y, 1.52], s: [0.6, 1.3, 1] }));
      }
    });
    viele(schloss, new THREE.PlaneGeometry(1, 1), lambert("#6f8fb0"), fenster);
    viele(schloss, new THREE.PlaneGeometry(1, 1), lambert("#ffffff"), fenster.map((f) => ({ p: [f.p[0], f.p[1], 1.515], s: [0.76, 1.46, 1] })));

    // Formschnitt in Kübeln an beiden Seiten.
    const kuebel = [];
    const kegel = [];
    const kugeln = [];
    for (let i = 0; i < 5; i += 1) {
      const z = START_Z - 2.2 - i * 4.4;
      [[-4.35, i % 2], [3.65, (i + 1) % 2]].forEach(([x, form]) => {
        kuebel.push({ p: [x, 0.25, z] });
        if (form) kegel.push({ p: [x, 1.25, z], s: [0.55, 1.5, 0.55] });
        else kugeln.push({ p: [x, 1.05, z], s: 0.55 });
      });
    }
    viele(scene, new THREE.CylinderGeometry(0.34, 0.26, 0.5, 10), lambert("#c2653e"), kuebel, { schatten: true });
    viele(scene, new THREE.ConeGeometry(1, 1, 8), lambert("#2f7f45"), kegel, { schatten: true });
    viele(scene, new THREE.SphereGeometry(1, 12, 10), lambert("#3f9b52"), kugeln, { schatten: true });

    // Statuen am Tor.
    [-4.4, 4.4].forEach((x, i) => {
      kiste(scene, 1.0, 1.2, 1.0, "#d8d2c4", [x, 0.6, gateZ + 0.4]);
      const statue = createKin("#e8e4dc", i ? 2 : 6);
      statue.scale.setScalar(1.15);
      statue.position.set(x, 1.2 + KIN_SOLE * 1.15, gateZ + 0.4);
      statue.rotation.y = x < 0 ? 0.4 : -0.4;
      statue.traverse((teil) => {
        if (teil.material) teil.material = lambert("#e8e4dc");
      });
      scene.add(statue);
    });

    // Brunnen rechts.
    const brunnen = new THREE.Group();
    brunnen.position.set(6.4, 0, gateZ + 4);
    scene.add(brunnen);
    const becken = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.5, 20), lambert("#d8d2c4"));
    becken.position.y = 0.25;
    brunnen.add(becken);
    const wasser = new THREE.Mesh(new THREE.CircleGeometry(1.35, 20), lambert("#5ec8ec", { emissive: "#1f7fa8", emissiveIntensity: 0.25 }));
    wasser.rotation.x = -Math.PI / 2;
    wasser.position.y = 0.46;
    brunnen.add(wasser);
    const saeule = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.4, 10), lambert("#d8d2c4"));
    saeule.position.y = 1.0;
    brunnen.add(saeule);
    const schale = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.3, 0.2, 14), lambert("#d8d2c4"));
    schale.position.y = 1.75;
    brunnen.add(schale);
    this.fountainDrops = [];
    const tropfenMat = new THREE.MeshBasicMaterial({ color: "#c9f0ff", transparent: true, opacity: 0.85 });
    for (let i = 0; i < 14; i += 1) {
      const tropfen = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), tropfenMat);
      tropfen.userData = { isFx: true, winkel: (i / 14) * Math.PI * 2, phase: zufall() };
      brunnen.add(tropfen);
      this.fountainDrops.push(tropfen);
    }

    // Gartenlaternen rechts der Bahn.
    const laternen = [];
    for (let i = 0; i < 4; i += 1) laternen.push({ p: [3.15, 0.8, START_Z - 4.4 - i * 4.4] });
    viele(scene, new THREE.BoxGeometry(0.08, 1.6, 0.08), lambert("#2c2f38"), laternen);
    viele(scene, new THREE.BoxGeometry(0.24, 0.3, 0.24), new THREE.MeshBasicMaterial({ color: "#fff1b8" }), laternen.map((l) => ({ p: [l.p[0], 1.72, l.p[2]] })));
    viele(scene, new THREE.ConeGeometry(0.22, 0.16, 4), lambert("#2c2f38"), laternen.map((l) => ({ p: [l.p[0], 1.95, l.p[2]], r: [0, Math.PI / 4, 0] })));
  }

  // Zielband in Rot-Weiss quer über die Bahn.
  buildRibbon() {
    const z = START_Z - TRACK_LEN;
    const red = new THREE.MeshLambertMaterial({ color: "#ff3b55" });
    const white = new THREE.MeshLambertMaterial({ color: "#ffffff" });
    for (let i = 0; i < 12; i += 1) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(5.8 / 12, 0.025, 0.4), i % 2 ? white : red);
      tile.position.set(-2.9 + (i + 0.5) * (5.8 / 12), 0.066, z);
      this.scene.add(tile);
    }
  }

  makeSign(text) {
    const group = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), new THREE.MeshLambertMaterial({ color: "#6b5238" }));
    post.position.y = 0.4;
    group.add(post);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const pen = canvas.getContext("2d");
    pen.fillStyle = "#ffffff";
    pen.fillRect(0, 0, 128, 64);
    pen.fillStyle = "#28313f";
    pen.font = "900 36px ui-rounded, system-ui, sans-serif";
    pen.textAlign = "center";
    pen.textBaseline = "middle";
    pen.fillText(text, 64, 35);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), new THREE.MeshLambertMaterial({ map: texture }));
    board.position.set(0, 0.85, 0.06);
    group.add(board);
    group.rotation.y = 0.5;
    return group;
  }

  laneX(index) {
    return (index - 1.5) * LANE_GAP;
  }

  progressZ(progress, goal) {
    return START_Z - (Math.max(0, progress) / Math.max(1, goal)) * TRACK_LEN;
  }

  // Dieselbe Phase wie auf dem Server, aus dem mitgeschickten Plan — mit dem
  // Anteil, wie weit sie schon ist. Den braucht die Drehung.
  phaseAt(arcade, minigame, now) {
    const elapsed = now - minigame.startedAt;
    const phases = arcade.phases || [];
    if (elapsed < 0 || !phases.length) return { kind: "green", index: -1, t: 0 };
    for (let index = 0; index < phases.length; index += 1) {
      const phase = phases[index];
      if (elapsed < phase.until) return { kind: phase.kind, index, t: (elapsed - phase.from) / Math.max(1, phase.until - phase.from) };
    }
    return { kind: "red", index: phases.length, t: 1 };
  }

  shot() {
    return {
      look: [0, 1.1, START_Z - 2.5],
      frame: { w: 6.0, h: 3.6 },
      yaw: 0.14,
      pitch: 0.3,
      fov: 40,
      intro: { yaw: 0.3, pitch: 0.2, zoom: 1.4 },
      // Nicht ganz so dicht an den Sieger: Tor, Wächter und die anderen im
      // Ziel gehören mit ins Schlussbild.
      finale: { pull: 0.55, zoom: 0.9, lift: 0.5, orbit: 0.08 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="hold-button" data-hold-run>
        <span class="hold-button-face">HALTEN = LAUFEN</span>
      </button>`;
    this.holdButton = this.controls.querySelector("[data-hold-run]");
    this.on(this.holdButton, "pointerdown", (event) => {
      event.preventDefault();
      this.holdButton.setPointerCapture?.(event.pointerId);
      this.setHolding(true);
    });
    const up = () => this.setHolding(false);
    this.on(this.holdButton, "pointerup", up);
    this.on(this.holdButton, "pointercancel", up);
    this.on(this.holdButton, "lostpointercapture", up);
  }

  unbind() {
    clearInterval(this.holdTimer);
    this.holdTimer = null;
  }

  // Drücken und Loslassen gehen als eigene Meldung an den Server; dazwischen
  // halten Pings den Zustand wach, falls eine Meldung verloren geht.
  setHolding(active) {
    if (this.holding === active) return;
    this.holding = active;
    this.holdButton?.classList.toggle("is-holding", active);
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    if (active) {
      this.feedback?.vibrate(8);
      this.sendRun();
      this.holdTimer = setInterval(() => this.sendRun(), RUN_PING_MS);
    } else {
      this.sendInput({ action: "run", hold: false }).catch(() => {});
    }
  }

  sendRun() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt) {
      this.setHolding(false);
      return;
    }
    const jetzt = performance.now();
    if (own?.running && jetzt - (this.letzterSchritt || 0) > 150) {
      this.letzterSchritt = jetzt;
      this.feedback?.sound("step");
    }
    this.sendInput({ action: "run", hold: true }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, minigame, players, controlledId, finale } = f;
    this.fountainDrops?.forEach((tropfen) => {
      const d = tropfen.userData;
      const t = (now / 900 + d.phase) % 1;
      const r = 0.15 + t * 0.9;
      tropfen.position.set(Math.cos(d.winkel) * r, 1.9 + t * 0.9 - t * t * 1.5, Math.sin(d.winkel) * r);
    });
    if (this.palaceFlag) this.palaceFlag.rotation.y = Math.sin(now / 400) * 0.3;
    if (!arcade) return;
    const phase = this.phaseAt(arcade, minigame, now);
    const kind = finale ? "green" : phase.kind;
    const key = `${phase.index}:${kind}`;
    if (key !== this.lastPhaseKey) {
      if (this.lastPhaseKey !== null && !finale) {
        if (kind === "green") this.feedback?.sound("pop");
        if (kind === "turn" || kind === "feint") this.feedback?.sound("countdown");
        if (kind === "red") {
          this.feedback?.sound("impact");
          this.feedback?.vibrate([26, 18, 26]);
          this.rig.shake(0.45);
        }
      }
      this.lastPhaseKey = key;
    }

    // Lampe: Grün, blinkend Gelb in der Drehung, Rot.
    const warn = kind === "turn" || kind === "feint";
    const lampColor = kind === "red" ? "#ff2038" : warn ? "#ffc400" : "#2ee86a";
    this.lampMat.color.set(lampColor);
    this.lampMat.emissive.set(lampColor);
    this.lampMat.emissiveIntensity = warn ? (Math.sin(now / 55) > 0 ? 1.4 : 0.3) : 0.7 + Math.abs(Math.sin(now / 160)) * 0.5;

    // Der Wächter: abgewandt bei Grün, dreht sich in der Drehphase herum,
    // steht bei Rot zugewandt. Die Finte dreht halb an und wieder zurück.
    let facing = Math.PI;
    if (kind === "turn") facing = Math.PI * (1 - smooth(phase.t));
    else if (kind === "feint") facing = Math.PI * (1 - 0.5 * Math.sin(phase.t * Math.PI));
    else if (kind === "red") facing = 0;
    this.guard.rotation.y += (facing - this.guard.rotation.y) * frameLerp(kind === "turn" || kind === "feint" ? 0.55 : 0.3, dt);
    if (kind === "red") {
      this.guardAnimator.set("focus");
      this.guardAnimator.expression("angry", 200);
    } else if (warn) {
      this.guardAnimator.set("ready");
    } else {
      // Er summt vor sich hin — Noten steigen auf.
      this.guardAnimator.set("think");
      if (!finale && now - this.noteAt > 520) {
        this.noteAt = now;
        const head = this.guard.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 3.2, 0));
        this.pop(head, Math.random() < 0.5 ? "♪" : "♫", { color: "#ffffff", size: 0.34, life: 1.2, rise: 1.2 });
      }
    }
    this.guardAnimator.update(now);

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const finished = Boolean(entry.finishedAt);
      const knock = this.knock.get(player.id);
      const follow = knock && now - knock < KNOCK_MS ? 12 : 7;
      const shown = THREE.MathUtils.lerp(this.smoothProgress.get(player.id) ?? 0, entry.progress || 0, Math.min(1, dt * follow));
      this.smoothProgress.set(player.id, shown);
      kin.position.x = this.laneX(index);
      kin.position.z = finished ? THREE.MathUtils.lerp(kin.position.z, this.gateZ - 0.6, frameLerp(0.08, dt)) : this.progressZ(shown, arcade.goal);
      // Zurückgeworfen: ein Bogen rückwärts.
      const knockU = knock ? (now - knock) / KNOCK_MS : 1;
      animator.groundY = TRACK_TOP_Y + KIN_SOLE + (knockU < 1 ? Math.sin(knockU * Math.PI) * 0.7 : 0);

      if ((entry.caught || 0) > (this.lastCaught.get(player.id) || 0)) {
        this.lastCaught.set(player.id, entry.caught);
        this.knock.set(player.id, now);
        animator.trigger("knockback");
        animator.expression("dizzy", 1400);
        this.guardAnimator.trigger("punch");
        this.guardAnimator.expression("smug", 900);
        this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.4, 0)), ["#ff2038", "#ffffff"], { count: 12, speed: 2.1, up: 1.6, size: 0.08, life: 0.6, drag: 1.6 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "ERWISCHT! −5 m", { color: "#ff6b7f", size: 0.36, life: 1 });
        if (isOwn) {
          this.rig.shake(0.8);
          this.feedback?.sound("error");
          this.feedback?.vibrate([20, 16, 30]);
        }
      }
      if (finished && !this.lastFinished.get(player.id)) {
        this.lastFinished.set(player.id, true);
        animator.trigger("celebrate");
        this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.5, 0)), [player.color, "#ffc400", "#ffffff"], { count: 20, speed: 2.6, up: 2.6, size: 0.09, life: 0.85, drag: 1.2 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "GESCHAFFT! 🏁", { color: "#ffe36b", size: 0.44, life: 1.2, rise: 1 });
        if (isOwn) {
          this.feedback?.sound("win");
          this.feedback?.vibrate([24, 24, 48]);
          this.setHolding(false);
        }
      }
      if (finale) return;
      if (finished) {
        kin.rotation.y += Math.atan2(Math.sin(0.3 - kin.rotation.y), Math.cos(0.3 - kin.rotation.y)) * frameLerp(0.1, dt);
        animator.set("happy");
        return;
      }
      kin.rotation.y = Math.PI;
      animator.lookAt(kind === "green" ? null : this.guard.position.clone().setY(3));
      const stunned = now < (entry.stunUntil || 0);
      if (stunned) {
        animator.set("dizzy");
      } else if (entry.running) {
        animator.set("sprint");
        animator.rate = 0.85;
        if (Math.random() < frameChance(0.4, dt)) {
          this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.05, 0.2)), ["#e8d59a"], { count: 1, speed: 0.4, up: 0.6, size: 0.06, life: 0.35, gravity: 3 });
        }
      } else if (kind === "red") {
        // Erstarrt — und zittert.
        animator.set("freeze");
        animator.expression("scared", 200);
      } else {
        animator.set("ready");
      }
    });
  }

  // Die Kamera folgt der eigenen Figur von hinten; wer weit vorn oder hinten
  // ist, darf aus dem Bild — den Stand aller zeigt die Leiste oben.
  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    if (!own) return [...this.kins.values()];
    return [...this.kins.values()].filter((kin) => Math.abs(kin.position.z - own.position.z) < 2.5);
  }

  rigOptions(f) {
    const own = this.kins.get(f.controlledId);
    if (!own || f.finale) return {};
    return { look: [own.position.x * 0.3, 1.1, own.position.z - 2.5] };
  }

  drawHud(f) {
    const { arcade, controlledId, minigame, now, state } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const kind = this.phaseAt(arcade, minigame, now).kind;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = `${Math.round(own?.progress || 0)}m`;

    const race = this.hud.querySelector("[data-redlight-race]");
    if (race) {
      const goal = arcade.goal || 1;
      race.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const left = Math.max(0, Math.min(100, ((entry?.progress || 0) / goal) * 100));
        const own = player.id === controlledId ? " is-own" : "";
        return `<i class="redlight-dot${own}" style="--chip:${player.color};left:${left}%"></i>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-light-banner]");
    if (banner) {
      banner.hidden = Boolean(f.finale);
      if (own?.finishedAt) {
        banner.textContent = "Im Ziel!";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if (now < (own?.stunUntil || 0)) {
        banner.textContent = "Erwischt – kurz benommen!";
        banner.style.background = "#ff6b7f";
        banner.style.color = "#42101a";
      } else if (kind === "turn" || kind === "feint") {
        banner.textContent = "ACHTUNG – er dreht sich!";
        banner.style.background = "#ffc400";
        banner.style.color = "#4a3400";
      } else if (kind === "red") {
        banner.textContent = "ROT – STOPP!";
        banner.style.background = "#ff2038";
        banner.style.color = "#ffffff";
      } else {
        banner.textContent = "GRÜN – LAUF!";
        banner.style.background = "#2ee86a";
        banner.style.color = "#0c3a1c";
      }
    }
    if (this.holdButton) this.holdButton.disabled = Boolean(own?.finishedAt);
  }
}

function smooth(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}
