import * as THREE from "/vendor/three/three.module.js";
import { createNameLabel } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Rohrsalat — im Kesselhaus hängt ein Gewirr aus Kupferrohren an der
// Ziegelwand. Oben die Ventile, unten die Ausgänge; nur einer führt in die
// Schatztruhe. Man folgt einem Rohr nach unten und biegt an jedem Querrohr
// ab. Wer das richtige Ventil antippt, bekommt Punkte — je schneller, desto
// mehr. In der Auflösung fliesst Wasser durch jedes gewählte Rohr; wer daneben
// lag, bekommt eine Ladung Russ ins Gesicht.
//
// Drumherum: ein Dampfkessel mit glühender Feuertür, Manometer mit
// zitternden Zeigern, Dampfwölkchen aus den Muffen, Käfiglampen, Kohle und
// Kisten.
const TOP_Y = 5.6;
const BOTTOM_Y = 2.05;
const SPACING = 1.15;
const SHELF_Y = 1.45;
const WALL_Z = -0.45;
const VALVE_COLORS = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b", "#b57bff", "#ff9f43"];
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const FLOW_MS = 1700;

export class PipeMaze extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.mazeRound = -1;
    this.mazeGroup = null;
    this.seenScored = -1;
    this.flows = [];
    this.labelY = 0.74;
    this.gauges = [];
    this.steam = [];
    this.ownMarker = false;
  }

  stage() {
    return {
      label: "3D Rohrsalat",
      background: "#2a1e1a",
      fog: ["#2a1e1a", 16, 36],
      lights: { sunPosition: [3, 10, 8], sunColor: 0xffe2c0, sunIntensity: 2.6, hemiIntensity: 1.7, skyColor: 0xffe8d0, groundColor: 0x4a3020, shadow: { left: -5, right: 5, top: 7, bottom: -1 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips" data-pipe-chips></div>
      <div class="color-banner" data-pipe-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    this.buildRoom(scene);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * 0.95;
      this.addKin(player, index, { x, ground: 0, z: 1.25, facing: 0, scale: 0.82 });
    });
  }

  buildRoom(scene) {
    // Boden: Fliesen im Schachbrett.
    const zufall = streuer(88);
    const hell = [];
    const dunkel = [];
    for (let x = -8; x <= 8; x += 1) {
      for (let z = -1; z <= 8; z += 1) ((x + z) % 2 ? hell : dunkel).push({ p: [x * 0.8, 0, z * 0.8 - 0.4] });
    }
    viele(scene, new THREE.BoxGeometry(0.79, 0.1, 0.79), lambert("#6b5a4a"), hell, { empfangen: true });
    viele(scene, new THREE.BoxGeometry(0.79, 0.1, 0.79), lambert("#4a3d32"), dunkel, { empfangen: true });
    // Ziegelwand: versetzte Reihen in zwei Tönen.
    const ziegel = [[], [], []];
    for (let reihe = 0; reihe < 26; reihe += 1) {
      for (let s = -8; s <= 8; s += 1) {
        const x = s * 0.62 + (reihe % 2) * 0.31;
        ziegel[Math.floor(zufall() * 3)].push({ p: [x, 0.13 + reihe * 0.27, WALL_Z - 0.1] });
      }
    }
    ["#9a4a36", "#a8573f", "#8a3f2e"].forEach((farbe, i) => viele(scene, new THREE.BoxGeometry(0.58, 0.23, 0.2), lambert(farbe), ziegel[i], { empfangen: true }));
    kiste(scene, 11, 7.2, 0.1, "#d8c8b0", [0, 3.5, WALL_Z - 0.24], { schatten: false });
    // Rohr unter der Decke, quer.
    const deckenrohr = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 11, 12), new THREE.MeshStandardMaterial({ color: "#8a8f98", metalness: 0.6, roughness: 0.4 }));
    deckenrohr.rotation.z = Math.PI / 2;
    deckenrohr.position.set(0, 6.3, WALL_Z + 0.1);
    scene.add(deckenrohr);
    // Dampfkessel links.
    const kessel = new THREE.Group();
    const bauch = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.6, 18), new THREE.MeshStandardMaterial({ color: "#5a6270", metalness: 0.5, roughness: 0.5 }));
    bauch.position.y = 1.3;
    bauch.castShadow = true;
    kessel.add(bauch);
    const nieten = [];
    for (let i = 0; i < 18; i += 1) [0.4, 2.2].forEach((y) => nieten.push({ p: [Math.cos((i / 18) * Math.PI * 2) * 1.01, y, Math.sin((i / 18) * Math.PI * 2) * 1.01] }));
    viele(kessel, new THREE.SphereGeometry(0.04, 6, 4), lambert("#c0c8d0"), nieten);
    const tuer = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), new THREE.MeshBasicMaterial({ color: "#ff7a1a" }));
    tuer.position.set(0, 0.8, 1.01);
    kessel.add(tuer);
    this.fire = tuer;
    kiste(kessel, 0.3, 1.8, 0.3, "#5a6270", [0.4, 3.4, 0]);
    kessel.position.set(-3.6, 0.05, 0.4);
    kessel.rotation.y = 0.35;
    scene.add(kessel);
    this.fireLight = new THREE.PointLight(0xff8a2a, 6, 5, 1.8);
    this.fireLight.position.set(-3.2, 0.9, 1.4);
    scene.add(this.fireLight);
    // Kohlehaufen und Schaufel.
    viele(scene, new THREE.DodecahedronGeometry(0.16, 0), lambert("#1c1c22"), Array.from({ length: 22 }, () => ({ p: [-2.6 + (zufall() - 0.5) * 0.9, 0.08 + zufall() * 0.25, 1.9 + (zufall() - 0.5) * 0.7], r: [zufall(), zufall(), zufall()] })));
    // Kisten rechts.
    kiste(scene, 0.9, 0.9, 0.9, "#a0703e", [3.6, 0.5, 0.6]);
    kiste(scene, 0.7, 0.7, 0.7, "#b88048", [3.4, 1.3, 0.5]).rotation.y = 0.3;
    kiste(scene, 0.8, 0.8, 0.8, "#a0703e", [4.3, 0.45, 1.5]).rotation.y = -0.2;
    // Manometer an der Wand.
    [[-2.6, 4.4], [2.7, 4.8], [2.6, 2.3]].forEach(([x, y], i) => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 20), new THREE.MeshStandardMaterial({ color: "#c9a14a", metalness: 0.7, roughness: 0.3 }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const blatt = new THREE.Mesh(new THREE.CircleGeometry(0.29, 20), lambert("#fbf6ea"));
      blatt.position.z = 0.051;
      g.add(blatt);
      const rot = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.27, 16, 1, -0.4, 1.0), new THREE.MeshBasicMaterial({ color: "#ff5d73" }));
      rot.position.z = 0.053;
      g.add(rot);
      const zeiger = kiste(g, 0.03, 0.24, 0.01, "#1c1c28", [0, 0.1, 0.06], { schatten: false });
      zeiger.geometry.translate(0, 0.02, 0);
      g.position.set(x, y, WALL_Z + 0.08);
      scene.add(g);
      this.gauges.push({ zeiger, phase: i * 1.7 });
    });
    // Käfiglampen.
    [[-1.8, 6.0], [1.8, 6.0]].forEach(([x, y]) => {
      const birne = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffe39a" }));
      birne.position.set(x, y, WALL_Z + 0.4);
      scene.add(birne);
      const kaefig = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial({ color: "#3b3f4a", wireframe: true }));
      kaefig.position.copy(birne.position);
      scene.add(kaefig);
    });
    const lampenlicht = new THREE.PointLight(0xffd9a0, 5, 9, 1.6);
    lampenlicht.position.set(0, 5.6, 1.2);
    scene.add(lampenlicht);
    // Warnschild.
    const schild = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), new THREE.MeshBasicMaterial({ map: schildTextur("⚠ DAMPF!") }));
    schild.position.set(3.2, 3.6, WALL_Z + 0.02);
    scene.add(schild);
    // Dampfwölkchen, die aus den Muffen puffen.
    for (let i = 0; i < 6; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshLambertMaterial({ color: "#f2f2f2", transparent: true, opacity: 0.5, depthWrite: false }));
      puff.userData = { phase: i / 6, x: -2.2 + (i % 3) * 2.2, y: 5.9 + (i % 2) * 0.2, isFx: true };
      scene.add(puff);
      this.steam.push(puff);
    }
  }

  // Das Rohrnetz einer Runde: senkrechte Rohre, Querrohre, Muffen, oben
  // Ventilräder, unten die Ausgänge mit Truhe und Russtöpfen.
  buildMaze(maze, levels) {
    if (this.mazeGroup) this.scene.remove(this.mazeGroup);
    const g = new THREE.Group();
    this.mazeGroup = g;
    this.maze = maze;
    this.levels = levels;
    const kupfer = new THREE.MeshStandardMaterial({ color: "#e0904a", metalness: 0.45, roughness: 0.35, emissive: "#3a1a08" });
    const messing = new THREE.MeshStandardMaterial({ color: "#d9a64a", metalness: 0.6, roughness: 0.3 });
    const colX = (c) => (c - (maze.cols - 1) / 2) * SPACING;
    this.colX = colX;
    // Dunkle Schalttafel hinter den Rohren: Kupfer auf Ziegelrot war kaum
    // auseinanderzuhalten, und genau darauf kommt es an.
    const breite = maze.cols * SPACING + 0.7;
    kiste(g, breite, TOP_Y - BOTTOM_Y + 1.5, 0.08, "#3f4a47", [0, (TOP_Y + BOTTOM_Y) / 2 + 0.35, WALL_Z + 0.06], { schatten: false });
    kiste(g, breite + 0.16, 0.1, 0.12, "#6b5a4a", [0, TOP_Y + 1.12, WALL_Z + 0.08], { schatten: false });
    kiste(g, breite + 0.16, 0.1, 0.12, "#6b5a4a", [0, BOTTOM_Y - 0.4, WALL_Z + 0.08], { schatten: false });
    const bolzen = [];
    [-1, 1].forEach((sx) => [-1, 1].forEach((sy) => bolzen.push({ p: [sx * (breite / 2 - 0.15), (TOP_Y + BOTTOM_Y) / 2 + 0.35 + sy * ((TOP_Y - BOTTOM_Y + 1.5) / 2 - 0.15), WALL_Z + 0.12] })));
    viele(g, new THREE.SphereGeometry(0.06, 8, 6), lambert("#c0c8d0"), bolzen);
    // Regalbrett für die Ausgänge.
    kiste(g, breite, 0.1, 0.7, "#8a6238", [0, SHELF_Y, 0.05]);
    [-1, 1].forEach((sx) => {
      const stuetze = kiste(g, 0.08, 0.5, 0.08, "#3b3f4a", [sx * (breite / 2 - 0.3), SHELF_Y - 0.25, -0.15], { schatten: false });
      stuetze.rotation.x = 0.6;
    });
    for (let c = 0; c < maze.cols; c += 1) {
      const rohr = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, TOP_Y - BOTTOM_Y, 10), kupfer);
      rohr.position.set(colX(c), (TOP_Y + BOTTOM_Y) / 2, 0);
      rohr.castShadow = true;
      g.add(rohr);
      // Halterungen an der Wand.
      [TOP_Y - 0.4, BOTTOM_Y + 0.4].forEach((y) => kiste(g, 0.2, 0.06, 0.5, "#3b3f4a", [colX(c), y, -0.22], { schatten: false }));
      // Ventilrad oben.
      const rad = new THREE.Group();
      const kranz = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.045, 8, 20), lambert(VALVE_COLORS[c]));
      rad.add(kranz);
      [0, 1, 2].forEach((k) => {
        const speiche = kiste(rad, 0.46, 0.04, 0.04, VALVE_COLORS[c], [0, 0, 0], { schatten: false });
        speiche.rotation.z = (k * Math.PI) / 3;
      });
      rad.position.set(colX(c), TOP_Y + 0.28, 0.12);
      g.add(rad);
      kiste(g, 0.12, 0.25, 0.12, "#3b3f4a", [colX(c), TOP_Y + 0.1, 0.05], { schatten: false });
      const tag = createNameLabel(LETTERS[c], VALVE_COLORS[c]);
      tag.position.set(colX(c), TOP_Y + 0.72, 0.15);
      tag.scale.multiplyScalar(0.75);
      g.add(tag);
      rad.userData.column = c;
      (this.wheels ||= [])[c] = rad;
      // Ausgang unten: Truhe oder Russtopf.
      if (c === maze.target) {
        const truhe = new THREE.Group();
        kiste(truhe, 0.62, 0.36, 0.42, "#8a5a2a", [0, 0.18, 0]);
        const deckel = new THREE.Group();
        kiste(deckel, 0.64, 0.14, 0.44, "#9a6a34", [0, 0.07, 0.22]);
        deckel.position.set(0, 0.36, -0.22);
        truhe.add(deckel);
        kiste(truhe, 0.66, 0.06, 0.46, "#e9b949", [0, 0.18, 0], { schatten: false });
        kiste(truhe, 0.1, 0.12, 0.05, "#e9b949", [0, 0.3, 0.23], { schatten: false });
        viele(truhe, new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10), lambert("#ffd15c"), [[-0.15, 0.37, 0], [0.1, 0.38, 0.05], [0, 0.39, -0.06]].map((p) => ({ p })));
        truhe.position.set(colX(c), SHELF_Y + 0.05, 0.05);
        g.add(truhe);
        this.chest = { truhe, deckel };
      } else {
        const topf = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.36, 12), lambert("#2c2c32"));
        topf.position.set(colX(c), SHELF_Y + 0.23, 0.05);
        g.add(topf);
        const russ = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), lambert("#111114"));
        russ.rotation.x = -Math.PI / 2;
        russ.position.set(colX(c), SHELF_Y + 0.415, 0.05);
        g.add(russ);
      }
      const stutzen = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 10), messing);
      stutzen.position.set(colX(c), BOTTOM_Y - 0.1, 0);
      g.add(stutzen);
    }
    // Querrohre mit Muffen.
    maze.rungs.forEach((r) => {
      const y = this.levelY(r.level);
      const quer = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, SPACING, 10), kupfer);
      quer.rotation.z = Math.PI / 2;
      quer.position.set((colX(r.col) + colX(r.col + 1)) / 2, y, 0);
      quer.castShadow = true;
      g.add(quer);
      [r.col, r.col + 1].forEach((c) => {
        const muffe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), messing);
        muffe.position.set(colX(c), y, 0);
        g.add(muffe);
      });
    });
    g.scale.setScalar(1);
    this.scene.add(g);
    this.chestOpen = 0;
  }

  levelY(level) {
    return TOP_Y - ((level + 1) * (TOP_Y - BOTTOM_Y)) / (this.levels + 1);
  }

  // Der Weg des Wassers von einem Ventil nach unten, als Punktfolge.
  pathFor(valve) {
    const points = [new THREE.Vector3(this.colX(valve), TOP_Y + 0.1, 0.12)];
    let col = valve;
    for (let level = 0; level < this.levels; level += 1) {
      const right = this.maze.rungs.some((r) => r.level === level && r.col === col);
      const left = this.maze.rungs.some((r) => r.level === level && r.col === col - 1);
      if (!right && !left) continue;
      const y = this.levelY(level);
      points.push(new THREE.Vector3(this.colX(col), y, 0.12));
      col += right ? 1 : -1;
      points.push(new THREE.Vector3(this.colX(col), y, 0.12));
    }
    points.push(new THREE.Vector3(this.colX(col), BOTTOM_Y - 0.1, 0.12));
    return points;
  }

  rigOptions() {
    const cols = this.maze?.cols || 5;
    return { frame: { w: cols * SPACING + 1.2, h: 6.2 } };
  }

  shot() {
    return {
      look: [0, 3.35, 0],
      frame: { w: 6.6, h: 6.2 },
      pitch: 0.08,
      fov: 38,
      intro: { yaw: 0.4, pitch: 0.2, zoom: 1.35 },
      finale: { pull: 0.85, zoom: 0.8, lift: 0.2, orbit: 0.1 }
    };
  }

  keepInView() {
    return [];
  }

  bind() {
    this.controls.innerHTML = `<div class="pipe-controls" data-pipe-buttons></div>`;
    this.buttonRow = this.controls.querySelector("[data-pipe-buttons]");
    this.on(this.buttonRow, "pointerdown", (event) => {
      const button = event.target.closest("[data-valve]");
      if (!button || button.disabled) return;
      event.preventDefault();
      this.feedback?.sound("select");
      this.feedback?.vibrate(12);
      this.picked = Number(button.dataset.valve);
      this.sendInput({ action: "pick", valve: this.picked }).catch(() => {});
    });
  }

  phaseOf(f) {
    const pipes = f.arcade.pipes;
    let t = f.now - f.minigame.startedAt - pipes.leadMs;
    if (t < 0) return { phase: "lead", round: 0, since: t };
    for (let round = 0; round < pipes.rounds.length; round += 1) {
      const answer = pipes.answerMs[round];
      if (t < answer) return { phase: "answer", round, since: t, left: answer - t };
      t -= answer;
      if (t < pipes.revealMs) return { phase: "reveal", round, since: t };
      t -= pipes.revealMs;
    }
    return { phase: "over", round: pipes.rounds.length - 1, since: t };
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId } = f;
    const pipes = arcade?.pipes;
    if (!pipes) return;
    const { phase, round, since } = this.phaseOf(f);
    if (round !== this.mazeRound) {
      this.mazeRound = round;
      this.wheels = [];
      this.buildMaze(pipes.rounds[round], pipes.levels);
      this.picked = null;
      this.flows.forEach((flow) => {
        this.scene.remove(flow.dot);
        this.scene.remove(flow.line);
      });
      this.flows = [];
      this.buttonsFor = -1;
    }

    // Eigenes Ventil dreht sich, sobald gewählt.
    const own = arcade.players[controlledId];
    const ownPick = own?.picks?.[round]?.valve ?? this.picked;
    (this.wheels || []).forEach((rad, c) => {
      if (!rad) return;
      const turning = ownPick === c;
      rad.rotation.z += dt * (turning ? 6 : 0);
      rad.scale.setScalar(turning ? 1.15 : 1);
    });

    // Auflösung: Wasser fliesst durch alle gewählten Rohre.
    if (pipes.scored >= round && phase !== "answer" && this.flows.length === 0 && pipes.scored === round) {
      const chosen = new Map();
      players.forEach((player) => {
        const pick = arcade.players[player.id]?.results?.[round];
        if (pick && pick.valve !== null && pick.valve !== undefined) chosen.set(pick.valve, [...(chosen.get(pick.valve) || []), player]);
      });
      if (!chosen.has(this.maze.answer)) chosen.set(this.maze.answer, []);
      chosen.forEach((who, valve) => {
        const path = this.pathFor(valve);
        const correct = valve === this.maze.answer;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(correct ? 0.13 : 0.1, 12, 8), new THREE.MeshBasicMaterial({ color: correct ? "#ffe25c" : "#6cc6ff" }));
        dot.userData.isFx = true;
        this.scene.add(dot);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineBasicMaterial({ color: correct ? "#ffe25c" : "#6cc6ff", transparent: true, opacity: 0.9 }));
        line.geometry.setDrawRange(0, 0);
        this.scene.add(line);
        this.flows.push({ dot, line, path, correct, who, at: performance.now(), done: false });
      });
    }
    const nowP = performance.now();
    this.flows.forEach((flow) => {
      const u = Math.min(1, (nowP - flow.at) / FLOW_MS);
      const at = pointAlong(flow.path, u);
      flow.dot.position.copy(at);
      flow.line.geometry.setDrawRange(0, Math.max(2, Math.ceil(u * flow.path.length) + 1));
      if (Math.random() < frameLerp(0.3, dt)) this.burst(at, [flow.correct ? "#ffe25c" : "#bfe6ff"], { count: 1, speed: 0.3, up: 0.3, size: 0.05, life: 0.3, gravity: 1 });
      if (u >= 1 && !flow.done) {
        flow.done = true;
        const end = flow.path[flow.path.length - 1];
        if (flow.correct) {
          this.chestOpen = 1;
          this.burst(end.clone().setY(SHELF_Y + 0.4), ["#ffd15c", "#ffe25c", "#ffffff"], { count: 30, speed: 2.4, up: 3, size: 0.08, life: 1.2 });
        } else {
          this.burst(end.clone().setY(SHELF_Y + 0.4), ["#1c1c22", "#3b3b44"], { count: 14, speed: 1.6, up: 2, size: 0.09, life: 0.9 });
        }
        flow.who.forEach((player) => {
          const kin = this.kins.get(player.id);
          const animator = this.animators.get(player.id);
          const result = arcade.players[player.id]?.results?.[round];
          if (!kin || !animator || !result) return;
          if (result.correct) {
            animator.trigger("celebrate");
            this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), `+${result.points}`, { color: "#ffe36b", size: 0.42 });
            if (player.id === controlledId) {
              this.feedback?.sound("coin");
              this.feedback?.vibrate([10, 30, 10]);
            }
          } else {
            animator.trigger("flinch");
            animator.expression("dizzy", 1500);
            // Russ: die ganze Figur wird für ein paar Sekunden dunkel.
            kin.userData.material?.color.setScalar(0.32);
            kin.userData.sootUntil = performance.now() + 2600;
            this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.7, 0.1)), ["#1c1c22", "#3b3b44"], { count: 12, speed: 1.4, up: 1.4, size: 0.08, life: 0.8 });
            this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "RUSS!", { color: "#c0c8d0", size: 0.36 });
            if (player.id === controlledId) {
              this.feedback?.sound("error");
              this.feedback?.vibrate(30);
            }
          }
        });
      }
    });
    this.kins.forEach((kin) => {
      if (kin.userData.sootUntil && nowP > kin.userData.sootUntil) {
        kin.userData.sootUntil = 0;
        kin.userData.material?.color.setScalar(1);
      }
    });
    if (this.chest) {
      this.chest.deckel.rotation.x += ((this.chestOpen ? -1.2 : 0) - this.chest.deckel.rotation.x) * frameLerp(0.15, dt);
    }

    // Kulisse: Manometer zittern, Feuer flackert, Dampf pufft.
    this.gauges.forEach((gauge) => { gauge.zeiger.rotation.z = -0.8 + Math.sin(now / 300 + gauge.phase) * 0.15 + Math.sin(now / 47 + gauge.phase) * 0.04; });
    const flicker = 0.8 + Math.sin(now / 70) * 0.1 + Math.sin(now / 130) * 0.1;
    this.fire.material.color.setRGB(1, 0.45 * flicker, 0.1);
    this.fireLight.intensity = 5 * flicker;
    this.steam.forEach((puff) => {
      const u = ((now / 2200) + puff.userData.phase) % 1;
      puff.position.set(puff.userData.x + u * 0.3, puff.userData.y + u * 0.9, WALL_Z + 0.35);
      puff.scale.setScalar(0.6 + u * 2);
      puff.material.opacity = 0.5 * (1 - u);
    });

    if (f.finale) return;
    players.forEach((player) => {
      const animator = this.animators.get(player.id);
      const entry = arcade.players[player.id];
      if (!animator || !entry) return;
      if (phase === "answer") {
        animator.set(entry.picks?.[round] ? "ready" : "think");
        animator.lookAt(new THREE.Vector3(0, 3 + Math.sin(now / 600 + since / 900) * 1.2, 0));
      } else {
        animator.set("idle");
        animator.lookAt(this.chest?.truhe ? this.chest.truhe.getWorldPosition(new THREE.Vector3()) : null);
      }
    });
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame } = f;
    const pipes = arcade?.pipes;
    if (!pipes) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(Math.round(own?.score || 0));
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const { phase, round, left } = this.phaseOf(f);
    const chips = this.hud.querySelector("[data-pipe-chips]");
    if (chips) {
      const html = room.players.map((player) => {
        const entry = arcade.players[player.id];
        const done = Boolean(entry?.picks?.[round]) && phase === "answer";
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${done ? "✓ " : ""}${Math.round(entry?.score || 0)}</span>`;
      }).join("");
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }
    // Knöpfe: so viele wie Ventile, in deren Farben.
    const maze = pipes.rounds[round];
    if (this.buttonRow && this.buttonsFor !== round) {
      this.buttonsFor = round;
      this.buttonRow.innerHTML = [...Array(maze.cols).keys()].map((c) => `<button type="button" data-valve="${c}" style="--valve:${VALVE_COLORS[c]}">${LETTERS[c]}</button>`).join("");
    }
    const pick = own?.picks?.[round]?.valve ?? this.picked;
    this.buttonRow?.querySelectorAll("[data-valve]").forEach((button) => {
      const c = Number(button.dataset.valve);
      button.disabled = phase !== "answer" || pick !== null && pick !== undefined || Boolean(minigame.finaleAt);
      button.classList.toggle("is-picked", pick === c);
    });
    const banner = this.hud.querySelector("[data-pipe-banner]");
    let message = null;
    let tone = "#c8783a";
    if (phase === "lead") message = "Welches Ventil führt zur Truhe?";
    else if (phase === "answer") {
      const secs = Math.ceil((left || 0) / 1000);
      message = pick !== null && pick !== undefined ? `Ventil ${LETTERS[pick]} — mal sehen …` : `Rohr ${round + 1}/${pipes.rounds.length}: Folge den Rohren! ${secs}s`;
      tone = secs <= 2 && (pick === null || pick === undefined) ? "#ff5d73" : "#c8783a";
    } else if (phase === "reveal") {
      const result = own?.results?.[round];
      if (result) {
        message = result.correct ? `Volltreffer! +${result.points}` : result.valve === null ? "Zu spät!" : "Russ im Gesicht …";
        tone = result.correct ? "#ffc400" : "#4a4a52";
      }
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
      banner.style.color = tone === "#ffc400" ? "#5c4508" : "#ffffff";
    }
  }
}

function pointAlong(path, u) {
  let total = 0;
  const lengths = [];
  for (let i = 1; i < path.length; i += 1) {
    const d = path[i].distanceTo(path[i - 1]);
    lengths.push(d);
    total += d;
  }
  let want = u * total;
  for (let i = 1; i < path.length; i += 1) {
    if (want <= lengths[i - 1]) return path[i - 1].clone().lerp(path[i], lengths[i - 1] ? want / lengths[i - 1] : 1);
    want -= lengths[i - 1];
  }
  return path[path.length - 1].clone();
}

function schildTextur(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffd15c";
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = "#1c1c22";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 88);
  ctx.fillStyle = "#1c1c22";
  ctx.font = "900 42px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
