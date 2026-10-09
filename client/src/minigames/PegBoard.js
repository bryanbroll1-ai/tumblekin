import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin214";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin214";
import { himmel, kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin214";
import { Nachlauf } from "./Nachlauf.js?v=tumblekin214";
import { landingX } from "./Nagelbahn.js?v=tumblekin214";

// Eine Kugel-Form für alle Kugeln: vorher bekam jede Kugel eigene Geometrie,
// und beim Landen wurde sie nur aus der Szene genommen, nie freigegeben.
const KUGEL_FORM = new THREE.SphereGeometry(0.2, 12, 10);
const RING_FORM = new THREE.RingGeometry(0.26, 0.33, 18);

// Nagelbrett: oben tippen lässt die eigene Kugel dort fallen, ein Tipp links
// oder rechts gibt ihr einen einzigen Stups. Unten zählt das Fach — und der
// goldene Jackpot-Topf, der hin und her wandert, bringt +15. Fünf Kugeln.
//
// Vorher war das Brett ganz ohne Figuren. Jetzt stehen alle auf einer
// Laufleiste über dem Brett, laufen zur Abwurfstelle, halten die Kugel über
// den Kopf, lassen sie fallen, schauen ihr nach und freuen sich über ein
// gutes Fach — oder raufen sich die Haare.
const BOARD_W = 4.6;
const BOARD_H = 5.6;
const SLOT_COLORS = ["#5c6b7a", "#7d8fa0", "#43c9a0", "#ffd15c", "#43c9a0", "#7d8fa0", "#5c6b7a"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Wie auf dem Server (plinkoJackpotX): Dreieckswelle über die Topfmitten.
function jackpotX(elapsedMs, period, slotCount) {
  const phase = (((elapsedMs % period) + period) % period) / period;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const first = 0.5 / slotCount;
  return first + tri * (1 - 2 * first);
}

// Eine flache Zahlentafel (für die Topfwerte und den Jackpot).
function makeLabel(text, { color = "#ffffff", size = 0.36, stroke = "rgba(20, 28, 40, 0.55)" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.font = "900 84px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 14;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, 128, 68);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2, size),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
  );
  return mesh;
}

export class PegBoard extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.ownInView = false;
    this.ballMeshes = new Map();
    // Die Kugeln kommen im Servertakt; gezeichnet wird ihre weiche Bahn.
    this.nachlauf = new Nachlauf();
    this.ballMeta = new Map();
    this.pegMeshes = [];
    this.slotMeshes = [];
    this.droppers = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.12);
    // Schild über der hochgehaltenen Kugel.
    this.labelY = 1.12;
    this.roundTrip = 0;
    this.lastPingAt = 0;
  }

  worldX(x) { return (x - 0.5) * BOARD_W; }
  worldY(y, floorY) { return BOARD_H * (1 - y / floorY) - BOARD_H / 2 + 0.4; }

  get railY() {
    return BOARD_H / 2 + 0.4 + 0.3;
  }

  stage() {
    return {
      label: "3D Nagelbrett",
      background: "#f0a58a",
      fog: ["#f0b89a", 24, 60],
      lights: { sunPosition: [-3, 10, 9], sunColor: 0xffe2c4, skyColor: 0xffd8e8, shadow: { left: -5, right: 5, top: 6, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="peg-chips" data-peg-chips></div>
      <div class="color-banner peg-banner" data-peg-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame.arcade;
    const floorY = arcade.floorY || 1.3;

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.5, BOARD_H + 0.6, 0.3),
      new THREE.MeshLambertMaterial({ color: "#ffffff", map: wellenTextur() })
    );
    board.position.set(0, 0.4, -0.4);
    board.receiveShadow = true;
    scene.add(board);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.9, BOARD_H + 1.0, 0.24),
      new THREE.MeshLambertMaterial({ color: "#c8313b" })
    );
    frame.position.set(0, 0.4, -0.58);
    scene.add(frame);
    this.buildMatsuri(scene);

    // Die Nägel. Sie stehen exakt dort, wo der Server sie rechnet — sonst
    // prallt die Kugel im Bild woanders ab als in der Wertung.
    // Nägel mit rundem Kopf statt flacher Scheiben: sie fangen das Licht, und
    // dadurch sieht man auf dem Handybild überhaupt, dass sie aus dem Brett
    // herausstehen. Geometrien und Material werden geteilt — bei 40 Nägeln
    // wären eigene sonst reine Verschwendung.
    const pegGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.24, 8);
    const headGeo = new THREE.SphereGeometry(0.1, 10, 8);
    const pegMat = new THREE.MeshLambertMaterial({ color: "#f2e2b8", emissive: "#4a3a12" });
    (arcade.pegs || []).forEach((peg) => {
      const group = new THREE.Group();
      group.position.set(this.worldX(peg.x), this.worldY(peg.y, floorY), -0.15);
      const shaft = new THREE.Mesh(pegGeo, pegMat);
      shaft.rotation.x = Math.PI / 2;
      shaft.castShadow = true;
      group.add(shaft);
      const head = new THREE.Mesh(headGeo, pegMat);
      head.position.z = 0.12;
      head.scale.z = 0.55;
      group.add(head);
      scene.add(group);
      this.pegMeshes.push({ mesh: head, group, flash: 0, base: new THREE.Color("#f2e2b8") });
    });

    // Die Fächer: tiefe Taschen aus Lackholz, getrennt von Wänden, an denen
    // die Kugel abprallt (PLINKO_DIVIDER_H auf dem Server). Vorne eine farbige
    // Leiste mit dem Wert — je heller, desto mehr wert —, dahinter sammeln
    // sich die gelandeten Kugeln. Vorher waren es flache Kästchen, und die
    // Kugel zog knapp über dem Boden sichtbar durch die Wände.
    const slots = arcade.slots || [];
    const slotWidth = BOARD_W / Math.max(1, slots.length);
    const floor = this.worldY(floorY, floorY);
    const wallTop = floor + (arcade.dividerH ?? 0.14) * BOARD_H / floorY;
    const pocketBottom = floor - 0.5;
    this.pocketBottom = pocketBottom;
    this.wallTop = wallTop;
    this.settled = [];
    const wallMat = new THREE.MeshLambertMaterial({ color: "#f6e7c8" });
    for (let k = 0; k <= slots.length; k += 1) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.07, wallTop - pocketBottom, 0.5), wallMat);
      wall.position.set(-BOARD_W / 2 + slotWidth * k, (wallTop + pocketBottom) / 2, -0.02);
      wall.castShadow = true;
      scene.add(wall);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.54), lambert("#ffc400"));
      cap.position.set(wall.position.x, wallTop + 0.03, -0.02);
      scene.add(cap);
    }
    slots.forEach((points, index) => {
      const x = -BOARD_W / 2 + slotWidth * (index + 0.5);
      const colour = SLOT_COLORS[index % SLOT_COLORS.length];
      const back = new THREE.Mesh(new THREE.BoxGeometry(slotWidth - 0.07, wallTop - pocketBottom, 0.06), lambert(new THREE.Color(colour).multiplyScalar(0.55).getStyle()));
      back.position.set(x, (wallTop + pocketBottom) / 2, -0.24);
      back.receiveShadow = true;
      scene.add(back);
      const cup = new THREE.Mesh(new THREE.BoxGeometry(slotWidth - 0.07, 0.42, 0.1), new THREE.MeshLambertMaterial({ color: colour }));
      cup.position.set(x, pocketBottom + 0.21, 0.36);
      cup.receiveShadow = true;
      scene.add(cup);
      // Der Wert steht auf der Leiste — man soll nicht an der Farbe raten.
      const label = makeLabel(String(points), { size: 0.26 });
      label.position.set(x, pocketBottom + 0.22, 0.42);
      scene.add(label);
      this.slotMeshes.push({ cup, points, index, flash: 0, base: new THREE.Color(colour), x, balls: 0 });
    });

    // Der Jackpot: ein goldener Rahmen mit Stern und „+15“, der über die Töpfe
    // gleitet. Man sieht ihn wandern und kann vorausdenken.
    this.slotWidth = slotWidth;
    this.slotY = (wallTop + pocketBottom) / 2;
    const pocketH = wallTop - pocketBottom;
    const jackpot = new THREE.Group();
    const glowMat = new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.BoxGeometry(slotWidth * 0.9, pocketH, 0.3), glowMat);
    jackpot.add(glow);
    const frameMat = new THREE.MeshBasicMaterial({ color: "#ffd24a", toneMapped: false });
    [[-1, 0], [1, 0]].forEach(([side]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, pocketH + 0.08, 0.34), frameMat);
      bar.position.x = side * slotWidth * 0.46;
      jackpot.add(bar);
    });
    const top = new THREE.Mesh(new THREE.BoxGeometry(slotWidth * 0.98, 0.06, 0.34), frameMat);
    top.position.y = pocketH / 2 + 0.04;
    jackpot.add(top);
    const tag = makeLabel(`★+${arcade.jackpot || 15}`, { color: "#ffe36b", size: 0.3 });
    tag.position.set(0, pocketH / 2 + 0.3, 0.16);
    jackpot.add(tag);
    jackpot.position.set(0, this.slotY, -0.02);
    scene.add(jackpot);
    this.jackpot = jackpot;
    this.jackpotGlow = glow;

    // Stups-Vorschau: zwei Pfeile über den Töpfen zeigen, wo die eigene Kugel
    // landet, wenn man JETZT nach links bzw. rechts stupst (nudgePreview).
    // Vorher war der Stups geraten — wie weit er trägt, hängt davon ab, wie
    // viel Weg die Kugel noch hat, und das sah man nirgends.
    const ownColour = this.getState()?.players?.find((player) => player.id === this.getControlledPlayerId())?.color || "#ffffff";
    // Dazu ein heller Punkt: wo sie ohne Stups landet.
    this.previewMarks = [-1, 0, 1].map((dir) => {
      const mark = new THREE.Mesh(
        dir ? new THREE.ConeGeometry(0.14, 0.3, 4) : new THREE.SphereGeometry(0.09, 10, 8),
        new THREE.MeshBasicMaterial({ color: dir ? ownColour : "#ffffff", transparent: true, opacity: dir ? 0.9 : 0.7, depthWrite: false, toneMapped: false })
      );
      if (dir) mark.rotation.x = Math.PI;
      mark.visible = false;
      mark.userData.isFx = true;
      scene.add(mark);
      return { dir, mark };
    });



    // Laufleiste über dem Brett.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 1.2, 0.16, 0.7), new THREE.MeshLambertMaterial({ color: "#5a3522" }));
    rail.position.set(0, this.railY - 0.08, 0.1);
    rail.receiveShadow = true;
    scene.add(rail);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * 1.1;
      this.addKin(player, index, { x, ground: this.railY, z: 0.15, facing: 0, scale: 0.85 });
      const held = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshLambertMaterial({ color: player.color }));
      held.visible = false;
      scene.add(held);
      this.droppers.set(player.id, { homeX: x, x, ballId: null, lastSlotAt: 0, held, droppedAt: -1e9 });
    });
  }

  // Ein Pachinko-Stand auf einem Sommerfest in der Dämmerung: roter Lackrahmen
  // mit Goldecken, Wellenmuster auf dem Brett, Papierlaternen an den Seiten,
  // Kirschblütenzweige hinter den oberen Ecken und ein paar Blütenblätter,
  // die durchs Bild segeln. Hinten ein Torii und Laternenketten.
  buildMatsuri(scene) {
    const zufall = streuer(88);
    himmel(scene, { oben: "#5a4aa0", unten: "#ffb38a" });
    const hw = (BOARD_W + 0.9) / 2;
    const hh = (BOARD_H + 1.0) / 2;
    viele(scene, new THREE.BoxGeometry(0.34, 0.34, 0.3), lambert("#ffc400"), [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => ({ p: [sx * (hw - 0.12), 0.4 + sy * (hh - 0.12), -0.42] })));

    // Der Tresen unter dem Brett, vorn ein rot-weiss gestreiftes Tuch.
    const tresenY = 0.4 - hh - 0.5;
    kiste(scene, BOARD_W + 1.6, 1.0, 0.9, "#6b4a2e", [0, tresenY, 0.05]);
    kiste(scene, BOARD_W + 1.8, 0.1, 1.0, "#8a5a32", [0, tresenY + 0.52, 0.05]);
    const tuch = [];
    for (let i = 0; i < 14; i += 1) tuch.push({ p: [-(BOARD_W + 1.5) / 2 + (i + 0.5) * ((BOARD_W + 1.5) / 14), tresenY - 0.05, 0.51], s: [(BOARD_W + 1.5) / 14, 0.8, 1] });
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#e0453b"), tuch.filter((_, i) => i % 2 === 0));
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#fff1d6"), tuch.filter((_, i) => i % 2 === 1));

    // Papierlaternen an beiden Seiten.
    this.lanterns = [];
    [-1, 1].forEach((seite) => {
      [2.4, 0.7, -1.0].forEach((y, i) => {
        const laterne = new THREE.Group();
        laterne.position.set(seite * (hw - 0.05), y, 0.12);
        const koerper = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), new THREE.MeshLambertMaterial({ color: (i + (seite > 0 ? 1 : 0)) % 2 ? "#fff1d6" : "#e0453b", emissive: "#ff9a3c", emissiveIntensity: 0.45 }));
        koerper.scale.y = 1.3;
        laterne.add(koerper);
        [-0.24, 0.24].forEach((dy) => kiste(laterne, 0.2, 0.05, 0.2, "#2c2f38", [0, dy, 0], { schatten: false }));
        kiste(laterne, 0.02, 0.3, 0.02, "#2c2f38", [0, 0.4, 0], { schatten: false });
        scene.add(laterne);
        this.lanterns.push(laterne);
      });
    });

    // Kirschblütenzweige hinter den oberen Ecken.
    const aeste = [];
    const blueten = [];
    [-1, 1].forEach((seite) => {
      let x = seite * (hw - 0.3);
      let y = 0.4 + hh - 0.4;
      for (let k = 0; k < 5; k += 1) {
        const nx = x + seite * (0.35 + zufall() * 0.25);
        const ny = y + 0.3 + zufall() * 0.2;
        aeste.push({ p: [(x + nx) / 2, (y + ny) / 2, -0.8], r: [0, 0, Math.atan2(nx - x, ny - y) * -1], s: [1, Math.hypot(nx - x, ny - y), 1] });
        for (let b = 0; b < 3; b += 1) blueten.push({ p: [nx + (zufall() - 0.5) * 0.5, ny + (zufall() - 0.5) * 0.4, -0.75 + zufall() * 0.1], r: [zufall(), zufall(), 0], s: 0.14 + zufall() * 0.1 });
        x = nx;
        y = ny;
      }
    });
    viele(scene, new THREE.BoxGeometry(0.07, 1, 0.07), lambert("#5a3522"), aeste);
    viele(scene, new THREE.DodecahedronGeometry(1, 0), lambert("#ffc2d8"), blueten);

    // Torii und Laternenketten in der Ferne.
    const torii = new THREE.Group();
    torii.position.set(0, -3, -22);
    scene.add(torii);
    [-4, 4].forEach((x) => kiste(torii, 0.7, 12, 0.7, "#d0452f", [x, 6, 0], { schatten: false }));
    kiste(torii, 11.5, 0.6, 0.9, "#2c2f38", [0, 12.3, 0], { schatten: false });
    kiste(torii, 10, 0.5, 0.6, "#d0452f", [0, 11.6, 0], { schatten: false });
    kiste(torii, 9, 0.4, 0.5, "#d0452f", [0, 9.8, 0], { schatten: false });
    const ketten = [];
    for (let i = 0; i < 26; i += 1) {
      const x = -13 + i;
      ketten.push({ p: [x, 6.4 - Math.cos((x / 13) * Math.PI) * 0.7, -12] });
    }
    viele(scene, new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffcf7a" }), ketten);

    // Blütenblätter.
    const blatt = new THREE.PlaneGeometry(0.07, 0.05);
    const blattMat = new THREE.MeshBasicMaterial({ color: "#ffd0e0", transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    this.petals = [];
    for (let i = 0; i < 16; i += 1) {
      const p = new THREE.Mesh(blatt, blattMat);
      p.userData = { isFx: true, x: (zufall() - 0.5) * 6, phase: zufall() * 10, speed: 0.25 + zufall() * 0.2 };
      scene.add(p);
      this.petals.push(p);
    }
  }

  shot() {
    return {
      look: [0, 0.15, 0],
      frame: { w: BOARD_W + 0.5, h: BOARD_H + 0.9 },
      fill: 0.96,
      pitch: 0,
      fov: 36,
      intro: { yaw: 0.45, pitch: 0.15, zoom: 1.3 },
      finale: { pull: 0.6, zoom: 0.55, lift: 0.4, orbit: 0.1 }
    };
  }

  keepInView(f) {
    return f.finale ? [...this.kins.values()] : [];
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint" data-peg-hint>Tippe oben, wo die Kugel fallen soll</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      this.tapAt(event);
    });
  }

  onUpdate(update) {
    const balls = update?.arcade?.balls || [];
    balls.forEach((ball) => this.ballMeta.set(ball.id, ball));
    this.nachlauf.merke(update.sentAt, this.now(), balls, (ball) => ball);
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.ballMeshes.forEach((visual) => {
      visual.mesh.material.dispose();
      visual.ring.material.dispose();
    });
    this.ballMeshes.clear();
    this.pegMeshes.length = 0;
    this.slotMeshes.length = 0;
    (this.settled || []).forEach((ball) => ball.mesh.material.dispose());
    this.settled = [];
  }

  // Wo auf dem Brett wurde getippt? Über einen Strahl auf die Brettebene —
  // die Kamera zeigt das Brett nicht zwingend genau bildschirmbreit.
  boardShareAt(event) {
    const rect = this.webglCanvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, hit)) return clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    return clamp(hit.x / BOARD_W + 0.5, 0, 1);
  }

  tapAt(event) {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!minigame || minigame.finaleAt || !arcade || !this.camera) return;
    const mine = (arcade.balls || []).find((ball) => ball.playerId === this.getControlledPlayerId());
    const share = this.boardShareAt(event);
    if (mine) {
      if (mine.nudged) {
        this.feedback?.sound("clack");
        return;
      }
      // Links oder rechts von der Kugel, wie man sie SIEHT — gezeichnet wird
      // sie einen Hauch hinter dem Server.
      const ballShare = this.nachlauf.wo(mine.id, this.now())?.x ?? mine.x;
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(12);
      const sentAt = performance.now();
      this.sendInput({ action: "nudge", dir: share < ballShare ? -1 : 1 }).then(() => this.noteRoundTrip(performance.now() - sentAt)).catch(() => {});
      return;
    }
    if ((arcade.players[this.getControlledPlayerId()]?.ballsLeft || 0) <= 0) {
      this.feedback?.sound("clack");
      return;
    }
    this.feedback?.sound("tap");
    const sentAt = performance.now();
    this.sendInput({ action: "drop", x: clamp(share, 0.06, 0.94) }).then(() => this.noteRoundTrip(performance.now() - sentAt)).catch(() => {});
  }

  // Wie lange eine Eingabe zum Server und zurück braucht, geglättet. Der
  // Stups wirkt erst, wenn er ankommt — bis dahin ist die Kugel ein gutes
  // Stück weiter gefallen, und die Vorschau muss das mitrechnen.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.measured ? this.roundTrip * 0.7 + clamped * 0.3 : clamped;
    this.measured = true;
  }

  // Ohne eigene Kugel in der Luft ab und zu messen (`ping` ändert nichts).
  pingIfIdle(minigame, arcade) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.lastPingAt < 1500) return;
    if ((arcade.balls || []).some((ball) => ball.playerId === this.getControlledPlayerId())) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Wo landet die eigene Kugel, wenn JETZT gestupst wird — nach links, nach
  // rechts oder gar nicht? Gerechnet wie auf dem Server (Nagelbahn.js), ab dem
  // letzten Serverbild bis zur Ankunft des Stupses, dann mit dem Stups bis zum
  // Boden. Wo der Jackpot bis dahin steht, muss man weiterhin selbst
  // vorausdenken.
  nudgePreview(arcade, f) {
    const marks = this.previewMarks || [];
    const hide = () => marks.forEach(({ mark }) => { mark.visible = false; });
    const own = (arcade.balls || []).find((ball) => ball.playerId === f.controlledId);
    if (!own || own.nudged || f.finale || !arcade.pegs?.length) return hide();
    const floorY = arcade.floorY || 1.3;
    const rules = { seed: arcade.seed, pegs: arcade.pegs, gravity: arcade.gravity ?? 1.9, sideDrag: arcade.sideDrag ?? 1.4,
      slots: arcade.slots?.length ?? 7, floorY, dividerH: arcade.dividerH ?? 0.14 };
    const from = f.minigame?.sentAt || f.now;
    const leadS = Math.max(0, Math.min(0.6, (f.now + this.roundTrip - from) / 1000));
    const push = arcade.nudgePower ?? 0.85;
    const y = (this.wallTop ?? this.worldY(floorY, floorY) + 0.6) + 0.28;
    const count = arcade.slots?.length || 7;
    for (const { dir, mark } of marks) {
      const x = landingX(own, rules, { leadS, nudge: dir, push, floorY });
      // Kommt der Stups erst an, wenn sie schon unten ist, gibt es nichts zu zeigen.
      if (x === null) return hide();
      // Ruhig statt zappelig: die Marke steht über einem FACH, nicht über der
      // genauen Landestelle, und wechselt erst, wenn die neue Vorhersage
      // 160 ms hält. Vorher sprang sie bei jedem Nagelkontakt hin und her
      // und wippte dazu noch auf und ab.
      const slot = clamp(Math.floor(x * count), 0, count - 1);
      const st = mark.userData;
      if (st.slot === undefined || !mark.visible) {
        st.slot = slot;
        st.want = undefined;
      } else if (slot === st.slot) {
        st.want = undefined;
      } else if (st.want !== slot) {
        st.want = slot;
        st.since = f.now;
      } else if (f.now - st.since > 160) {
        st.slot = slot;
        st.want = undefined;
      }
      const targetX = -BOARD_W / 2 + this.slotWidth * (st.slot + 0.5) + dir * 0.17;
      st.x = mark.visible && st.x !== undefined ? st.x + (targetX - st.x) * frameLerp(0.35, f.dt || 0.016) : targetX;
      mark.visible = true;
      mark.position.set(st.x, y + (dir ? 0 : -0.08), 0.2);
    }
  }

  ensureBall(ball, colour) {
    if (this.ballMeshes.has(ball.id)) return this.ballMeshes.get(ball.id);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(KUGEL_FORM, new THREE.MeshLambertMaterial({ color: colour }));
    mesh.castShadow = true;
    group.add(mesh);
    // Ein heller Ring um die eigene Kugel, damit man sie unter vier Kugeln
    // wiederfindet, ohne die Farbe zu suchen.
    const ring = new THREE.Mesh(
      RING_FORM,
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    ring.position.z = 0.22;
    group.add(ring);
    this.scene.add(group);
    const visual = { group, mesh, ring, colour };
    this.ballMeshes.set(ball.id, visual);
    return visual;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, state, minigame } = f;
    this.lanterns?.forEach((laterne, i) => { laterne.rotation.z = Math.sin(now / 700 + i) * 0.08; });
    this.petals?.forEach((p) => {
      const d = p.userData;
      const t = ((now / 1000) * d.speed + d.phase) % 1;
      p.position.set(d.x + Math.sin(now / 800 + d.phase) * 0.4 + t * 1.2, 4.2 - t * 8, 0.45);
      p.rotation.set(now / 400 + d.phase, now / 530, 0);
    });
    if (!arcade) return;
    const floorY = arcade.floorY || 1.3;
    if (this.jackpot && arcade.jackpotPeriod) {
      const slots = (arcade.slots || []).length || 7;
      // Auf derselben Zeitleiste wie die Kugeln (Nachlauf), sonst stand der
      // Jackpot eine gute Zehntelsekunde weiter als die Kugel, die gerade
      // landet — sie fiel sichtbar hinein und bekam ihn nicht, oder umgekehrt.
      const x = jackpotX(Math.max(0, this.nachlauf.zeichenzeit(now) - minigame.startedAt), arcade.jackpotPeriod, slots);
      this.jackpot.position.x = this.worldX(x);
      this.jackpotGlow.material.opacity = 0.28 + Math.sin(now / 160) * 0.1;
      this.jackpot.visible = !finale;
    }
    this.pingIfIdle(minigame, arcade);
    this.nudgePreview(arcade, f);
    const colourOf = (id) => state.players.find((player) => player.id === id)?.color || "#ffffff";
    const alive = new Set();
    const ballOf = new Map();
    // Gezeichnet wird die weiche Bahn, nicht der letzte Serverpunkt — der kommt
    // nur elfmal pro Sekunde, und die Kugel sprang sichtbar in Stufen.
    const zeit = this.nachlauf.zeichenzeit(now);
    this.nachlauf.sichtbare(now).forEach((spur) => {
      const ball = this.ballMeta.get(spur.id);
      if (!ball) return;
      alive.add(ball.id);
      ballOf.set(ball.playerId, ball);
      const visual = this.ensureBall(ball, colourOf(ball.playerId));
      visual.group.position.set(this.worldX(spur.x), this.worldY(spur.y, floorY), 0.12);
      const isOwn = ball.playerId === controlledId;
      visual.ring.material.opacity = isOwn ? (ball.nudged ? 0.35 : 0.9) : 0;
      visual.ring.scale.setScalar(isOwn && !ball.nudged ? 1 + Math.sin(now / 160) * 0.12 : 1);
      visual.mesh.rotation.z -= dt * 6;
      // Das Klacken erst, wenn die gezeichnete Kugel auch dort ist.
      if (ball.bumpedAt && ball.bumpedAt !== visual.lastBump && ball.bumpedAt <= zeit) {
        visual.lastBump = ball.bumpedAt;
        this.burst(visual.group.position.clone(), [colourOf(ball.playerId), "#ffffff"], { count: Math.round(7 * fxScale()), speed: 1.5, up: 0.5, size: 0.05, life: 0.4, drag: 2.4 });
        if (isOwn) {
          this.rig.shake(0.3);
          this.feedback?.sound("clack");
          this.feedback?.vibrate(10);
        }
      }
    });
    this.ballMeshes.forEach((visual, id) => {
      if (alive.has(id)) return;
      this.scene.remove(visual.group);
      visual.mesh.material.dispose();
      visual.ring.material.dispose();
      this.ballMeshes.delete(id);
      this.ballMeta.delete(id);
    });
    this.syncFlashes(dt);
    this.stepSettled(now);

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const d = this.droppers.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !d || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const ball = ballOf.get(player.id);
      // Neue Kugel: hinlaufen, hochhalten, fallen lassen.
      if (ball && ball.id !== d.ballId) {
        d.ballId = ball.id;
        d.x = clamp(this.worldX(ball.x), -BOARD_W / 2 + 0.2, BOARD_W / 2 - 0.2);
        d.droppedAt = now;
        animator.trigger("throw");
      }
      const gap = d.x - kin.position.x;
      kin.position.x += gap * frameLerp(0.25, dt);
      const running = Math.abs(gap) > 0.08;
      kin.rotation.y += ((running ? Math.sign(gap) * Math.PI * 0.45 : 0) - kin.rotation.y) * frameLerp(0.3, dt);
      d.held.visible = !ball && !finale;
      d.held.position.copy(kin.position).add(new THREE.Vector3(0, 0.68, 0.05));

      // Gelandet: je nach Fach freuen oder ärgern.
      const landed = entry.lastSlot;
      if (landed && landed.at !== d.lastSlotAt && landed.at <= zeit) {
        const first = d.lastSlotAt === 0 && now - landed.at > 2000;
        d.lastSlotAt = landed.at;
        if (!first) {
          const big = landed.points >= 8;
          animator.trigger(big ? "fistpump" : landed.points <= 2 ? "facepalm" : "clap");
          animator.expression(big ? "joy" : landed.points <= 2 ? "sad" : "happy", 900);
          const slot = this.slotMeshes[landed.slot];
          if (slot) {
            slot.flash = 1;
            this.settleBall(slot, player.color, now);
          }
          if (isOwn) {
            const at = new THREE.Vector3(slot?.cup.position.x || 0, (slot?.cup.position.y || 0) + 0.9, 0.3);
            this.burst(at, [big ? "#ffd15c" : "#8fa4b4", "#ffffff"], { count: (big ? 16 : 8) * fxScale(), speed: 2.0, up: 1.8, size: 0.07, life: 0.6, drag: 1.8 });
            this.pop(at, landed.jackpot ? `JACKPOT! +${landed.points}` : `+${landed.points}`, { color: big ? "#ffe36b" : "#c3d3e2", size: landed.jackpot ? 0.5 : big ? 0.42 : 0.32, life: landed.jackpot ? 1.1 : 0.8 });
            if (landed.jackpot) this.burst(at, ["#ffe36b", "#ffffff", "#ffb020"], { count: Math.round(26 * fxScale()), speed: 3, up: 2.6, size: 0.09, life: 0.9, drag: 1.4 });
            this.feedback?.sound(landed.jackpot ? "win" : big ? "perfect" : "coin");
            this.feedback?.vibrate(landed.jackpot ? [14, 20, 30] : big ? [10, 8, 16] : 10);
            if (big) this.rig.shake(landed.jackpot ? 0.5 : 0.25);
          }
        }
      }
      if (isOwn && (entry.plinks || 0) > (d.plinks || 0)) this.feedback?.sound("plink");
      d.plinks = entry.plinks || 0;

      if (finale) return;
      const visual = ball ? this.ballMeshes.get(ball.id) : null;
      animator.lookAt(visual ? visual.group.position : null);
      if (running) animator.set("run");
      else if (ball) animator.set("focus");
      else animator.set("carry");
    });
  }

  // Gelandete Kugeln bleiben im Fach liegen, drei nebeneinander, dann die
  // nächste Lage — so sieht man am Ende, wer wohin getroffen hat.
  settleBall(slot, colour, now) {
    const n = slot.balls++;
    const mesh = new THREE.Mesh(KUGEL_FORM, new THREE.MeshLambertMaterial({ color: colour }));
    mesh.scale.setScalar(0.8);
    const to = (this.pocketBottom ?? -2.9) + 0.17 + Math.floor(n / 3) * 0.26;
    const from = this.wallTop ?? to + 0.5;
    mesh.position.set(slot.x + ((n % 3) - 1) * 0.18, from, 0.08);
    mesh.userData.isFx = true;
    this.scene.add(mesh);
    this.settled.push({ mesh, from, to, at: now });
  }

  stepSettled(now) {
    (this.settled || []).forEach((ball) => {
      const t = Math.min(1, (now - ball.at) / 320);
      // Fällt hinein und hüpft einmal kurz nach.
      const drop = t < 0.75 ? (t / 0.75) ** 2 : 1 - Math.sin((t - 0.75) / 0.25 * Math.PI) * 0.12;
      ball.mesh.position.y = ball.from + (ball.to - ball.from) * drop;
    });
  }

  syncFlashes(dt) {
    this.pegMeshes.forEach((peg) => {
      peg.flash = Math.max(0, peg.flash - dt * 3);
      // Über die GRÖSSE, nicht über die Farbe: alle Nägel teilen sich ein
      // Material (bei vierzig Stück ist das richtig so), und eine Farbe darauf
      // zu setzen hätte immer alle gleichzeitig aufleuchten lassen. Das Blinken
      // war deshalb noch nie zu sehen.
      const puls = 1 + peg.flash * 0.45;
      peg.group.scale.setScalar(puls);
    });
    this.slotMeshes.forEach((slot) => {
      slot.flash = Math.max(0, slot.flash - dt * 2);
      slot.cup.material.color.copy(slot.base).lerp(new THREE.Color("#ffffff"), slot.flash * 0.7);
      slot.cup.scale.y = 1 + slot.flash * 0.25;
    });
  }

  drawHud(f) {
    const { arcade, state, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
    const chips = this.hud.querySelector("[data-peg-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="peg-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.max(0, Math.round(entry?.score || 0))}</span>`;
      }).join("");
    }

    // Die Hinweiszeile sagt, was der nächste Tipp bewirkt. Ohne sie tippt man
    // in dem Glauben, eine neue Kugel zu werfen, und stupst stattdessen.
    const mine = (arcade.balls || []).find((ball) => ball.playerId === this.getControlledPlayerId());
    const hint = this.controls?.querySelector("[data-peg-hint]");
    const left = own?.ballsLeft ?? 0;
    const mode = !mine ? (left > 0 ? "drop" : "done") : (mine.nudged ? "wait" : "nudge");
    const dots = "●".repeat(Math.max(0, left)) + "○".repeat(Math.max(0, (arcade.ballsPerPlayer || 5) - left));
    const text = mode === "drop"
      ? `Tippe oben, wo die Kugel fallen soll · ${dots}`
      : mode === "done" ? "Alle Kugeln geworfen — zuschauen"
        : (mode === "nudge" ? "👉 Tippe links oder rechts für EINEN Stups" : `Stups verbraucht — zuschauen · ${dots}`);
    if (hint && text !== this.hintText) {
      this.hintText = text;
      hint.textContent = text;
    }

    const banner = this.hud.querySelector("[data-peg-banner]");
    if (!banner) return;
    if (mode === "nudge") {
      banner.hidden = false;
      banner.textContent = "Ein Stups ist bereit";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
    } else {
      banner.hidden = true;
    }
  }
}

// Seigaiha: Wellenmuster in zwei dunklen Blautönen — ruhig genug, dass Nägel
// und Kugeln davor klar bleiben.
function wellenTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2b3648";
  ctx.fillRect(0, 0, 512, 640);
  const r = 32;
  ctx.lineWidth = 3;
  for (let row = 0; row < 640 / (r / 2) + 2; row += 1) {
    const y = row * (r / 2);
    const off = row % 2 ? r : 0;
    for (let x = -r + off; x < 512 + r; x += r * 2) {
      for (let k = 3; k >= 1; k -= 1) {
        ctx.beginPath();
        ctx.arc(x, y, (r * k) / 3, Math.PI, 0);
        ctx.fillStyle = k % 2 ? "#2f3b50" : "#2b3648";
        ctx.fill();
        ctx.strokeStyle = "#374762";
        ctx.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
