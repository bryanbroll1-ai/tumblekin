import * as THREE from "/vendor/three/three.module.js";
import { createNameLabel } from "./VoxelKit.js?v=tumblekin212";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin212";
import { frameLerp } from "./Quality.js?v=tumblekin212";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin212";

// Grimassen: oben hängt ein verzogenes Gesicht im Goldrahmen, davor steht die
// eigene Blockkopf-Maske — erst neutral —, und man zieht sie an sechs Punkten
// zurecht. Wer nach Ablauf der Zeit am nächsten dran ist, bekommt die meisten
// Punkte.
//
// Die Maske ist ein Blockkopf wie die Figuren: Kastenkopf mit Haarschopf,
// Block-Augen, und an den sechs Griffen hängen Brauen, Nase, Mundwinkel und
// Kinn. Vorher war es eine gemalte, weich verzogene Fläche — die Gesichter
// verschmierten zu einem Brei, in dem man kaum erkannte, was wo saß. Jetzt
// steht jedes Teil genau dort, wo sein Griff ist, und der Vergleich mit dem
// Vorbild ist ein Blick. Der Server kennt nur die sechs Versätze.
const HANDLES = [
  // Grundpunkt (Maskenmass, Maske ist 2 x 2), Reichweite, Einflussradius
  { x: -0.34, y: 0.42, range: 0.3, sigma: 0.26 },   // Braue links
  { x: 0.34, y: 0.42, range: 0.3, sigma: 0.26 },    // Braue rechts
  { x: 0, y: -0.04, range: 0.3, sigma: 0.22 },      // Nase
  { x: -0.3, y: -0.38, range: 0.3, sigma: 0.22 },   // Mundwinkel links
  { x: 0.3, y: -0.38, range: 0.3, sigma: 0.22 },    // Mundwinkel rechts
  { x: 0, y: -0.78, range: 0.32, sigma: 0.34 }      // Kinn
];
const FACE_Z = 0.3;              // Vorderseite des Kopfes im Maskenmass
const SKIN = "#f6c08a";
const SKIN_DARK = "#e3a46c";
const HAIR = "#6b3fd6";
const BROW = "#3b2414";
const NOSE = "#ef9050";
const LIPS = "#8a1f33";
const MOUTH_BITS = 9;
const OWN_SCALE = 1.0;
const OWN_POS = new THREE.Vector3(0, 1.95, 0);   // Kinn auf der Staffelei, Haar unter dem Rahmen
const TARGET_SCALE = 0.5;
// Der Blockkopf reicht vom Kinn (-0,88) bis zum Haarschopf (1,31): seine
// Mitte liegt so weit über dem Maskenursprung. Im Rahmen wird er darum um
// diesen Anteil gesenkt, sonst ragte das Haar über die Goldleiste.
const HEAD_CENTRE = 0.215;
const TARGET_POS = new THREE.Vector3(0, 3.92, -0.12);
const MINI_SCALE = 0.3;
const SEND_EVERY_MS = 70;

export class FaceLift extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.ownInView = false;
    this.masks = new Map();       // playerId → Maske (klein oder gross)
    this.peerDecor = [];
    this.shapes = new Map();      // geglättete Anzeige je Spieler
    this.drag = null;
    this.localShape = null;
    this.localRound = -1;
    this.lastSentAt = 0;
    this.seenScored = -1;
    this.roundTrip = 0;
    this.sentKey = "";           // was zuletzt geschickt wurde
    this.openRound = -1;         // Runde, deren Formfenster (nach Ankunftszeit) offen ist
    this.labelY = 0.74;
    this.bulbs = null;
  }

  stage() {
    return {
      label: "3D Grimassen",
      background: "#2b1d3f",
      fog: ["#2b1d3f", 16, 40],
      lights: { sunPosition: [2, 9, 8], sunIntensity: 2.4, hemiIntensity: 2.0, skyColor: 0xfff0e0, groundColor: 0x6b4a8a, shadow: { left: -4, right: 4, top: 6, bottom: -2 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner face-banner" data-face-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    this.buildBooth(scene);
    const players = this.getState()?.players || [];
    const own = this.getControlledPlayerId();
    this.own = own;

    // Das Vorbild im Goldrahmen.
    this.target = this.makeMask(TARGET_SCALE, TARGET_POS.clone().add(new THREE.Vector3(0, -HEAD_CENTRE * TARGET_SCALE, 0)));
    const rahmen = new THREE.Group();
    this.targetFrame = rahmen;
    rahmen.position.copy(TARGET_POS).add(new THREE.Vector3(0, 0, -0.08));
    const gold = lambert("#e9b949");
    [[0, 0.63, 1.34, 0.12], [0, -0.63, 1.34, 0.12], [-0.63, 0, 0.12, 1.34], [0.63, 0, 0.12, 1.34]].forEach(([x, y, w, h]) => {
      const leiste = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), gold);
      leiste.position.set(x, y, 0);
      rahmen.add(leiste);
    });
    const leinwand = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), lambert("#fff4dc"));
    leinwand.position.z = -0.03;
    rahmen.add(leinwand);
    scene.add(rahmen);
    const schild = createNameLabel("VORBILD", "#e9b949");
    this.targetLabel = schild;
    schild.position.copy(TARGET_POS).add(new THREE.Vector3(0, 0.82, 0.05));
    schild.scale.multiplyScalar(0.8);
    scene.add(schild);

    // Die eigene Maske gross in der Mitte, die der anderen klein an der Wand.
    const others = players.filter((player) => player.id !== own);
    const miniSpots = [[-1.38, 3.95], [1.38, 3.95], [-1.38, 3.2]];
    players.forEach((player) => {
      if (player.id === own) {
        const mask = this.makeMask(OWN_SCALE, OWN_POS);
        this.masks.set(player.id, mask);
        return;
      }
      const [x, y] = miniSpots[others.indexOf(player) % miniSpots.length];
      const mask = this.makeMask(MINI_SCALE, new THREE.Vector3(x, y, -0.1));
      this.masks.set(player.id, mask);
      const tag = createNameLabel(String(player.name || "?").slice(0, 8), player.color);
      tag.position.set(x, y - 0.42, 0.02);
      tag.scale.multiplyScalar(0.7);
      scene.add(tag);
      this.peerDecor.push(tag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.37, 24), new THREE.MeshBasicMaterial({ color: player.color }));
      ring.position.set(x, y, -0.14);
      scene.add(ring);
      this.peerDecor.push(ring);
    });
    // Geister-Vorbild für die Auflösung: legt sich halb durchsichtig über die
    // eigene Maske, damit man sieht, wo es gehapert hat.
    this.ghost = this.makeMask(OWN_SCALE, OWN_POS.clone().add(new THREE.Vector3(0, 0, 0.04)), { ghost: true });
    this.ghost.mesh.visible = false;

    // Griffpunkte auf der eigenen Maske.
    this.knobs = HANDLES.map(() => {
      // Halb durchsichtig: der Griff sitzt genau auf Braue, Nase oder
      // Mundwinkel, und die sollen darunter zu sehen bleiben.
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), new THREE.MeshBasicMaterial({ color: "#ffe25c", transparent: true, opacity: 0.6, depthTest: false }));
      knob.renderOrder = 5;
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 20), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, depthTest: false }));
      halo.renderOrder = 5;
      knob.add(halo);
      scene.add(knob);
      return knob;
    });

    // Figuren in einer Reihe unter der Maske — das Publikum der eigenen Bude.
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * 0.78;
      this.addKin(player, index, { x, ground: 0, z: 1.05, facing: 0, scale: 0.72, label: false });
      if (player.id === own) {
        const spot = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.34, 28), new THREE.MeshBasicMaterial({ color: "#ffe25c", transparent: true, opacity: 0.9 }));
        spot.rotation.x = -Math.PI / 2;
        spot.position.set(x, 0.015, 1.05);
        scene.add(spot);
        this.ownSpot = spot;
      }
    });
  }

  // Die Bude: gestreifte Zeltwand, Glühbirnen-Bogen, Vorhänge, Holzboden.
  buildBooth(scene) {
    const holz = ["#b07a45", "#a06c3b"];
    holz.forEach((farbe, i) => {
      viele(scene, new THREE.BoxGeometry(0.5, 0.1, 6), lambert(farbe), Array.from({ length: 9 }, (_, k) => k).filter((k) => k % 2 === i).map((k) => ({ p: [-2 + k * 0.5, -0.05, 1] })), { empfangen: true });
    });
    kiste(scene, 20, 0.1, 20, "#3a2a50", [0, -0.12, 0], { schatten: false });
    // Zeltwand in Streifen.
    const streifen = [];
    const weiss = [];
    for (let i = -8; i <= 8; i += 1) (i % 2 ? streifen : weiss).push({ p: [i * 0.42, 2.6, -0.6] });
    viele(scene, new THREE.BoxGeometry(0.42, 5.4, 0.05), lambert("#d8344a"), streifen, { empfangen: true });
    viele(scene, new THREE.BoxGeometry(0.42, 5.4, 0.05), lambert("#fff3e6"), weiss, { empfangen: true });
    // Dach-Zacken oben.
    const zacken = [];
    for (let i = -7; i <= 7; i += 1) zacken.push({ p: [i * 0.5, 5.2, -0.45], r: [0, 0, Math.PI], s: [1, 1, 0.3] });
    viele(scene, new THREE.ConeGeometry(0.28, 0.45, 4), lambert("#ffd15c"), zacken.filter((_, i) => i % 2 === 0));
    viele(scene, new THREE.ConeGeometry(0.28, 0.45, 4), lambert("#28c7d9"), zacken.filter((_, i) => i % 2 === 1));
    kiste(scene, 7.4, 0.25, 0.3, "#8a2233", [0, 5.45, -0.45]);
    // Vorhänge links und rechts mit Falten.
    [-1, 1].forEach((seite) => {
      const falten = [];
      for (let i = 0; i < 5; i += 1) falten.push({ p: [seite * (2.05 + i * 0.16), 2.6, 0.15 - i * 0.05], s: [1, 1, 1] });
      viele(scene, new THREE.CylinderGeometry(0.1, 0.14, 5.4, 8), lambert("#7a1830"), falten, { schatten: true });
      kiste(scene, 0.12, 0.12, 0.5, "#e9b949", [seite * 2.05, 2.1, 0.3]);
    });
    // Glühbirnen-Bogen um die Maske — sie laufen wie auf dem Rummel.
    const birnen = [];
    for (let i = 0; i <= 26; i += 1) {
      const a = Math.PI * (i / 26);
      birnen.push({ p: [Math.cos(a) * 1.75, 2.2 + Math.sin(a) * 1.55, -0.45] });
    }
    for (let i = 0; i < 6; i += 1) {
      birnen.push({ p: [-1.75, 0.35 + i * 0.33, -0.45] });
      birnen.push({ p: [1.75, 0.35 + i * 0.33, -0.45] });
    }
    this.bulbs = viele(scene, new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }), birnen);
    this.bulbCount = birnen.length;
    this.bulbColor = new THREE.Color();
    for (let i = 0; i < birnen.length; i += 1) this.bulbs.setColorAt(i, this.bulbColor.set("#ffe9a0"));
    // Staffelei unter der Maske.
    const beinMat = lambert("#7a5330");
    [[-0.55, 0.2], [0.55, -0.2]].forEach(([x, dreh]) => {
      const bein = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.25, 0.09), beinMat);
      bein.position.set(x, 0.6, -0.12);
      bein.rotation.z = dreh;
      bein.castShadow = true;
      scene.add(bein);
    });
    kiste(scene, 1.5, 0.08, 0.16, "#8a6238", [0, 1.12, -0.08]);
    // Farbtöpfe und Pinsel am Rand.
    const zufall = streuer(12);
    const toepfe = [[-1.55, 0.6], [-1.3, 0.35], [1.4, 0.45], [1.6, 0.75]];
    ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"].forEach((farbe, i) => {
      const [x, z] = toepfe[i];
      const topf = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.2, 10), lambert("#d9dde2"));
      topf.position.set(x, 0.1, z);
      topf.castShadow = true;
      scene.add(topf);
      const farbeOben = new THREE.Mesh(new THREE.CircleGeometry(0.115, 10), lambert(farbe));
      farbeOben.rotation.x = -Math.PI / 2;
      farbeOben.position.set(x, 0.201, z);
      scene.add(farbeOben);
      const pinsel = kiste(scene, 0.03, 0.32, 0.03, "#8a6238", [x + 0.04, 0.3, z], { schatten: false });
      pinsel.rotation.z = -0.4 + zufall() * 0.3;
    });
  }

  makeMask(scale, position, { ghost = false } = {}) {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    group.position.copy(position);
    // Der Geist zeigt in der Auflösung nur die Teile des Vorbilds, leuchtend
    // über der eigenen Maske — dort sieht man, was daneben lag.
    if (ghost && !this.ghostMat) this.ghostMat = new THREE.MeshBasicMaterial({ color: "#5ff0ff", transparent: true, opacity: 0, depthWrite: false });
    const box = (w, h, d, color, [x, y, z]) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), ghost ? this.ghostMat : lambert(color));
      mesh.position.set(x, y, z);
      mesh.castShadow = !ghost;
      group.add(mesh);
      return mesh;
    };
    const parts = {};
    if (!ghost) {
      box(1.64, 1.38, 0.56, SKIN, [0, 0.19, 0]);
      box(1.76, 0.3, 0.64, HAIR, [0, 0.93, -0.02]);
      [[-0.52, 1.12], [0, 1.18], [0.52, 1.12]].forEach(([x, y]) => box(0.44, 0.26, 0.5, HAIR, [x, y, -0.05]));
      [-1, 1].forEach((side) => {
        box(0.16, 0.34, 0.26, SKIN_DARK, [side * 0.9, 0.1, 0]);
        box(0.3, 0.3, 0.06, "#ffffff", [side * 0.34, 0.12, FACE_Z]);
        box(0.14, 0.17, 0.04, "#1c1c28", [side * 0.34, 0.1, FACE_Z + 0.045]);
        box(0.05, 0.05, 0.02, "#ffffff", [side * 0.34 + 0.035, 0.16, FACE_Z + 0.07]);
        box(0.22, 0.1, 0.02, "#ff9fb0", [side * 0.58, -0.18, FACE_Z + 0.005]);
      });
      parts.jaw = box(1, 1, 0.5, SKIN, [0, -0.6, 0]);
    }
    const lift = ghost ? 0.06 : 0;
    parts.brows = [0, 1].map(() => box(0.42, 0.1, 0.08, BROW, [0, 0, FACE_Z + 0.06 + lift]));
    parts.nose = box(0.2, 0.24, 0.2, NOSE, [0, 0, FACE_Z + 0.1 + lift]);
    parts.mouth = Array.from({ length: MOUTH_BITS }, () => box(1, 0.1, 0.07, LIPS, [0, 0, FACE_Z + 0.04 + lift]));
    if (ghost) parts.chin = box(0.56, 0.07, 0.06, BROW, [0, 0, FACE_Z + lift]);
    this.scene.add(group);
    const mask = { mesh: group, parts, scale, ghost, shape: new Array(12).fill(0) };
    this.deform(mask, mask.shape);
    return mask;
  }

  // Wo Griff `h` bei Form `shape` sitzt (Maskenmass).
  handleAt(h, shape) {
    const handle = HANDLES[h];
    return [handle.x + (shape[h * 2] || 0) * handle.range, handle.y + (shape[h * 2 + 1] || 0) * handle.range];
  }

  // Die Teile an ihre Griffe setzen. Der Mund ist eine Kette kleiner Blöcke
  // auf einem Bogen von Mundwinkel zu Mundwinkel, der Kiefer reicht bis
  // zum Kinngriff.
  deform(mask, shape) {
    const { parts } = mask;
    parts.brows.forEach((brow, i) => {
      const [x, y] = this.handleAt(i, shape);
      brow.position.x = x;
      brow.position.y = y;
      brow.rotation.z = (i ? -1 : 1) * (shape[i * 2 + 1] || 0) * 0.35;
    });
    const [nx, ny] = this.handleAt(2, shape);
    parts.nose.position.x = nx;
    parts.nose.position.y = ny;
    const [lx, ly] = this.handleAt(3, shape);
    const [rx, ry] = this.handleAt(4, shape);
    const cx = (lx + rx) / 2;
    const cy = (ly + ry) / 2 - 0.13;
    const point = (t) => [
      (1 - t) * (1 - t) * lx + 2 * (1 - t) * t * cx + t * t * rx,
      (1 - t) * (1 - t) * ly + 2 * (1 - t) * t * cy + t * t * ry
    ];
    parts.mouth.forEach((bit, i) => {
      const [ax, ay] = point(i / MOUTH_BITS);
      const [bx, by] = point((i + 1) / MOUTH_BITS);
      bit.position.x = (ax + bx) / 2;
      bit.position.y = (ay + by) / 2;
      bit.rotation.z = Math.atan2(by - ay, bx - ax);
      bit.scale.x = Math.max(0.06, Math.hypot(bx - ax, by - ay) * 1.25);
    });
    const [kx, ky] = this.handleAt(5, shape);
    if (parts.jaw) {
      const top = -0.3;
      const bottom = Math.min(top - 0.2, ky - 0.1);
      parts.jaw.scale.set(1.3, top - bottom, 1);
      parts.jaw.position.set(kx * 0.6, (top + bottom) / 2, 0);
    }
    if (parts.chin) parts.chin.position.set(kx, ky - 0.1, parts.chin.position.z);
    mask.shape = shape.slice();
  }

  handleWorld(mask, index, shape, into = new THREE.Vector3()) {
    const [x, y] = this.handleAt(index, shape);
    into.set(x, y, FACE_Z + 0.22);
    return mask.mesh.localToWorld(into);
  }

  shot() {
    return {
      look: [0, 2.85, 0],
      frame: { w: 3.5, h: 3.95 },
      fill: 0.96,
      pitch: 0,
      fov: 38,
      intro: { yaw: 0.35, pitch: 0.12, zoom: 1.3 },
      finale: { pull: 0.9, zoom: 0.85, lift: 0.1, orbit: 0.08 }
    };
  }

  rigOptions() {
    const r = this.webglCanvas.getBoundingClientRect();
    const wide = r.width > r.height;
    // Beim Drehen waehrend eines Zugs bleibt die Maske am Finger verankert:
    // erst nach dem Loslassen neu anordnen.
    if (!this.drag && this.wideLayout !== wide) {
      this.wideLayout = wide;
      this.peerDecor.forEach(object => { object.visible = !wide; });
      this.masks.forEach((mask, id) => { if (id !== this.own) mask.mesh.visible = !wide; });
      const own = this.masks.get(this.own);
      const ownPos = wide ? new THREE.Vector3(1.15, 2.85, 0) : OWN_POS;
      own.mesh.position.copy(ownPos);
      this.ghost.mesh.position.copy(ownPos).z += 0.04;
      const pos = wide ? new THREE.Vector3(-1.4, 2.85, -0.12) : TARGET_POS;
      const targetScale = wide ? 0.8 : TARGET_SCALE;
      this.target.mesh.position.copy(pos).y -= HEAD_CENTRE * targetScale;
      this.target.mesh.scale.setScalar(targetScale);
      this.targetFrame.position.copy(pos).z -= 0.08;
      this.targetFrame.scale.setScalar(wide ? 0.88 / 0.56 : 1);
      this.targetLabel.position.copy(pos).add(new THREE.Vector3(0, wide ? -1.2 : 0.82, 0.05));
    }
    return this.wideLayout
      ? { look: [0, 2.9, 0], frame: { w: 5.35, h: 2.9 } }
      : { look: [0, 2.85, 0], frame: { w: 3.5, h: 3.95 } };
  }

  keepInView() {
    // Die Maske ist das Bild; die Figuren stehen darunter und sind immer drin.
    return [];
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Zieh die gelben Punkte, bis die Maske aussieht wie das Vorbild</p>`;
    this.controls.style.pointerEvents = "none";
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(OWN_POS.z + 0.2));
    const hitAt = (event) => {
      const rect = this.webglCanvas.getBoundingClientRect();
      this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = new THREE.Vector3();
      return this.raycaster.ray.intersectPlane(this.plane, hit) ? hit : null;
    };
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      if (this.drag || !this.canShape()) return;
      const hit = hitAt(event);
      const mask = this.masks.get(this.own);
      if (!hit || !mask) return;
      let best = -1;
      let bestDist = 24; // Trefferradius in CSS-Pixeln, auch bei kleiner Maske.
      const at = new THREE.Vector3();
      HANDLES.forEach((_, i) => {
        this.handleWorld(mask, i, this.localShape, at);
        const screen = this.rig.toScreen(at);
        const d = Math.hypot(screen.x - event.clientX, screen.y - event.clientY);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (best < 0) return;
      const grabbed = new THREE.Vector3();
      this.handleWorld(mask, best, this.localShape, grabbed);
      this.drag = { index: best, pointerId: event.pointerId, offX: grabbed.x - hit.x, offY: grabbed.y - hit.y };
      this.touchedRound = this.localRound;
      this.capturePointer(this.webglCanvas, event.pointerId);
      this.feedback?.sound("select");
      this.feedback?.vibrate(8);
    });
    this.on(this.webglCanvas, "pointermove", (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      if (!this.canShape()) { this.drag = null; return; }
      const hit = hitAt(event);
      if (!hit) return;
      const handle = HANDLES[this.drag.index];
      const local = new THREE.Vector3(hit.x + this.drag.offX, hit.y + this.drag.offY, OWN_POS.z);
      const mask = this.masks.get(this.own);
      mask.mesh.worldToLocal(local);
      const ox = Math.max(-1, Math.min(1, (local.x - handle.x) / handle.range));
      const oy = Math.max(-1, Math.min(1, (local.y - handle.y) / handle.range));
      this.localShape[this.drag.index * 2] = Math.round(ox * 100) / 100;
      this.localShape[this.drag.index * 2 + 1] = Math.round(oy * 100) / 100;
      const nowP = performance.now();
      if (nowP - this.lastSentAt > SEND_EVERY_MS) this.sendShape(false);
    });
    const release = (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      if (this.canShape()) this.sendShape(true);
    };
    this.on(this.webglCanvas, "pointerup", release);
    this.on(this.webglCanvas, "pointercancel", release);
    this.on(this.webglCanvas, "lostpointercapture", release);
    const interrupt = () => { if (this.drag) release({ pointerId: this.drag.pointerId }); };
    this.on(window, "blur", interrupt);
    this.on(window, "resize", interrupt);
    this.on(document, "visibilitychange", () => { if (document.hidden) interrupt(); });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
  }

  sendShape(final) {
    const clock = performance.now();
    this.lastSentAt = clock;
    this.sentKey = this.localShape.join(",");
    const input = { action: "shape", h: [...this.localShape] };
    if (final) input.final = true;
    this.sendInput(input).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Rundreise zum Server, geglättet und wie überall auf 250 ms gedeckelt.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.roundTrip ? this.roundTrip * 0.8 + clamped * 0.2 : clamped;
  }

  // Wer gerade nicht zieht, schickt nichts — dann misst ein Ping die Laufzeit.
  pingIfIdle(minigame) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.lastSentAt < 1000 || clock - (this.lastPingAt || 0) < 1000) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Die Phase zu dem Moment, in dem ein JETZT geschickter Zug ankommt.
  // Danach richtet sich, ob die Maske noch zu formen ist: vorher blieb sie
  // bis zum Ende nach Geräteuhr offen, und was man in der letzten Rundreise
  // zog oder losliess, kam zu spät und zählte nicht.
  arrivalPhase(f) {
    const now = (f?.now ?? this.now()) + this.roundTrip;
    return this.phaseOf({ ...(f || {}), now });
  }

  phaseOf(f) {
    const face = f?.arcade?.face || (this.update || this.minigame)?.arcade?.face;
    if (!face) return { phase: "lead", round: 0, since: 0 };
    const minigame = f?.minigame || this.update || this.minigame;
    const elapsed = (f?.now ?? this.now()) - minigame.startedAt;
    const cycle = face.showMs + face.shapeMs + face.revealMs;
    const t = elapsed - face.leadMs;
    if (t < 0) return { phase: "lead", round: 0, since: elapsed };
    const round = Math.floor(t / cycle);
    if (round >= face.rounds) return { phase: "over", round: face.rounds - 1, since: t - face.rounds * cycle };
    const inner = t - round * cycle;
    if (inner < face.showMs) return { phase: "show", round, since: inner };
    if (inner < face.showMs + face.shapeMs) return { phase: "shape", round, since: inner - face.showMs, left: face.showMs + face.shapeMs - inner };
    return { phase: "reveal", round, since: inner - face.showMs - face.shapeMs };
  }

  canShape() {
    const minigame = this.update || this.minigame;
    return Boolean(minigame && !minigame.finaleAt && this.arrivalPhase().phase === "shape" && this.localShape);
  }

  // Schliesst das Formfenster (nach Ankunftszeit), geht der letzte Stand noch
  // hinaus — auch mitten im Ziehen. Er kommt zum Ende an, in der Schonfrist
  // des Servers.
  syncWindow(f) {
    const arrival = this.arrivalPhase(f);
    const open = arrival.phase === "shape" && !f.finale;
    if (open) {
      this.openRound = arrival.round;
      return;
    }
    if (this.openRound < 0) return;
    const round = this.openRound;
    this.openRound = -1;
    this.drag = null;
    // Nur wer in diesem Durchgang selbst gezogen hat — sonst überschriebe
    // eine unberührte Maske, was ein anderes Gerät für diese Figur geformt hat.
    if (this.touchedRound === round && this.localShape && this.localShape.join(",") !== this.sentKey) this.sendShape(true);
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId } = f;
    const face = arcade?.face;
    if (!face) return;
    this.syncWindow(f);
    this.pingIfIdle(f.minigame);
    const { phase, round, since } = this.phaseOf(f);

    // Neue Runde: eigene Maske zurück auf neutral.
    if (this.localRound !== round && (phase === "show" || phase === "shape")) {
      this.localRound = round;
      this.localShape = new Array(12).fill(0);
      this.drag = null;
    }
    if (!this.localShape) this.localShape = new Array(12).fill(0);

    // Vorbild: in der Vorlaufphase leer (neutral), danach das Ziel der Runde.
    const target = phase === "lead" ? new Array(12).fill(0) : face.targets[round];
    const tShape = this.target.shape.map((value, i) => value + (target[i] - value) * frameLerp(0.18, dt));
    this.deform(this.target, tShape);

    players.forEach((player) => {
      const mask = this.masks.get(player.id);
      const entry = arcade.players[player.id];
      if (!mask || !entry) return;
      let want;
      if (player.id === controlledId && (phase === "shape")) want = this.localShape;
      else if (phase === "reveal" || phase === "over") want = entry.results?.[round]?.shape || entry.shape;
      else want = entry.shape;
      const eased = mask.shape.map((value, i) => value + ((want[i] || 0) - value) * frameLerp(player.id === controlledId ? 0.6 : 0.2, dt));
      this.deform(mask, eased);
    });

    // Griffpunkte nur beim Formen.
    const ownMask = this.masks.get(controlledId);
    const shaping = phase === "shape" && !f.finale;
    this.knobs.forEach((knob, i) => {
      knob.visible = shaping && Boolean(ownMask);
      if (!knob.visible) return;
      this.handleWorld(ownMask, i, ownMask.shape, knob.position);
      const active = this.drag?.index === i;
      const pulse = 1 + Math.sin(now / 180 + i) * 0.12;
      const p = this.rig.toScreen(knob.position);
      const edge = this.rig.toScreen(knob.position.clone().add(new THREE.Vector3(0.075, 0, 0)));
      const size = Math.max(1, 7 / Math.max(1, Math.abs(edge.x - p.x)));
      knob.scale.setScalar(size * (active ? 1.5 : pulse));
      knob.material.color.set(active ? "#ffffff" : "#ffe25c");
      knob.children[0].lookAt(this.camera.position);
    });

    // Geist des Vorbilds über der eigenen Maske in der Auflösung.
    const reveal = phase === "reveal" || phase === "over";
    this.ghost.mesh.visible = reveal;
    if (reveal) {
      this.deform(this.ghost, face.targets[round]);
      this.ghostMat.opacity = Math.min(0.6, since / 900 * 0.6);
    }

    // Glühbirnen laufen.
    if (this.bulbs) {
      const step = Math.floor(now / 140);
      for (let i = 0; i < this.bulbCount; i += 1) {
        const on = (i + step) % 3 === 0;
        this.bulbs.setColorAt(i, this.bulbColor.set(on ? "#fff6c8" : "#b8792e"));
      }
      this.bulbs.instanceColor.needsUpdate = true;
    }
    if (this.ownSpot) this.ownSpot.material.opacity = 0.6 + Math.sin(now / 250) * 0.3;

    // Gewertet: Punkte über den Masken, Figuren reagieren.
    if (face.scored > this.seenScored && face.scored >= 0) {
      this.seenScored = face.scored;
      const results = players.map((player) => ({ player, points: arcade.players[player.id]?.results?.[face.scored]?.points ?? 0 }));
      const best = Math.max(...results.map((r) => r.points));
      results.forEach(({ player, points }) => {
        const mask = this.masks.get(player.id);
        const animator = this.animators.get(player.id);
        const isOwn = player.id === controlledId;
        if (mask) {
          const at = mask.mesh.position.clone().add(new THREE.Vector3(0, isOwn ? 0.55 : 0.1, isOwn ? 0.7 : 0.4));
          this.pop(at, `+${points}`, { color: points >= 70 ? "#ffe36b" : points >= 40 ? "#ffffff" : "#ffb3bd", size: isOwn ? 0.6 : 0.32, life: 1.6, rise: 0.5 });
        }
        if (animator) {
          if (points === best && best > 0) { animator.trigger("fistpump"); animator.expression("joy", 1500); }
          else if (points < 35) { animator.trigger("facepalm"); animator.expression("sad", 1400); }
          else { animator.trigger("clap"); animator.expression("happy", 1000); }
        }
        if (isOwn) {
          this.feedback?.sound(points >= 70 ? "perfect" : points >= 40 ? "coin" : "error");
          this.feedback?.vibrate(points >= 70 ? [10, 30, 10] : 12);
          if (points >= 70) this.burst(this.masks.get(controlledId).mesh.position.clone().add(new THREE.Vector3(0, 0.4, 0.6)), ["#ffe25c", "#ff5d73", "#28c7d9", "#ffffff"], { count: 24, speed: 2.2, up: 1.8, size: 0.07, life: 1 });
        }
      });
    }

    if (f.finale) return;
    players.forEach((player) => {
      const animator = this.animators.get(player.id);
      if (!animator) return;
      if (phase === "shape") {
        animator.set(player.id === controlledId && this.drag ? "reach" : "think");
        animator.lookAt(this.masks.get(player.id)?.mesh.position || null);
      } else if (phase === "show") {
        animator.set("focus");
        animator.lookAt(TARGET_POS);
      } else {
        animator.set("idle");
        animator.lookAt(null);
      }
    });
  }

  drawHud(f) {
    const { arcade, controlledId, minigame } = f;
    const face = arcade?.face;
    if (!face) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(Math.round(own?.score || 0));
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const banner = this.hud.querySelector("[data-face-banner]");
    const { phase, round, since } = this.phaseOf(f);
    // Wie lange ein Zug noch zählt — gerechnet bis zu seiner Ankunft.
    const arrival = this.arrivalPhase(f);
    const left = arrival.phase === "shape" ? arrival.left : 0;
    let message = null;
    let tone = "#12aaff";
    if (phase === "lead") message = "Gleich hängt das Vorbild …";
    else if (phase === "show") { message = `Gesicht ${round + 1}/${face.rounds}: Schau genau hin!`; tone = "#b57bff"; }
    else if (phase === "shape") {
      const secs = Math.ceil((left || 0) / 1000);
      message = since < 1400 ? "Zieh die Maske zurecht!" : secs <= 0 ? "Stopp!" : secs <= 3 ? `Noch ${secs} …` : null;
      tone = secs <= 3 ? "#ff5d73" : "#1fbf5b";
    } else if (phase === "reveal") {
      const points = own?.results?.[round]?.points;
      if (points !== undefined) {
        message = points >= 85 ? `Spiegelbild! +${points}` : points >= 60 ? `Gut getroffen! +${points}` : points >= 35 ? `Na ja … +${points}` : `Wer ist das? +${points}`;
        tone = points >= 60 ? "#ffc400" : points >= 35 ? "#12aaff" : "#ff5d73";
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
