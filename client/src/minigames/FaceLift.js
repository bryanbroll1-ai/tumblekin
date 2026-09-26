import * as THREE from "/vendor/three/three.module.js";
import { createNameLabel } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Grimassen: oben hängt ein verzogenes Gesicht im Goldrahmen, davor steht die
// eigene Gummimaske — erst neutral —, und man zieht sie an sechs Punkten
// zurecht. Wer nach Ablauf der Zeit am nächsten dran ist, bekommt die meisten
// Punkte.
//
// Die Maske ist eine gewölbte Fläche mit gemaltem Gesicht, die sich um jeden
// Griffpunkt weich mitverzieht — wie Gummi. Der Server kennt davon nur die
// sechs Versätze; die Verformung rechnet jedes Gerät gleich, darum sieht das
// Vorbild überall gleich aus und der Vergleich stimmt mit dem Bild.
const HANDLES = [
  // Grundpunkt (Maskenmass, Maske ist 2 x 2), Reichweite, Einflussradius
  { x: -0.34, y: 0.42, range: 0.3, sigma: 0.26 },   // Braue links
  { x: 0.34, y: 0.42, range: 0.3, sigma: 0.26 },    // Braue rechts
  { x: 0, y: -0.04, range: 0.3, sigma: 0.22 },      // Nase
  { x: -0.3, y: -0.38, range: 0.3, sigma: 0.22 },   // Mundwinkel links
  { x: 0.3, y: -0.38, range: 0.3, sigma: 0.22 },    // Mundwinkel rechts
  { x: 0, y: -0.78, range: 0.32, sigma: 0.34 }      // Kinn
];
const MASK_SEG = 30;
const OWN_SCALE = 1.1;
const OWN_POS = new THREE.Vector3(0, 2.2, 0);
const TARGET_SCALE = 0.56;
const TARGET_POS = new THREE.Vector3(0, 3.92, -0.12);
const MINI_SCALE = 0.3;
const PICK_RADIUS = 0.42;
const SEND_EVERY_MS = 70;

let faceTexture = null;

export class FaceLift extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.masks = new Map();       // playerId → Maske (klein oder gross)
    this.shapes = new Map();      // geglättete Anzeige je Spieler
    this.drag = null;
    this.localShape = null;
    this.localRound = -1;
    this.lastSentAt = 0;
    this.seenScored = -1;
    this.ownMarker = false;
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
    this.target = this.makeMask(TARGET_SCALE, TARGET_POS);
    const rahmen = new THREE.Group();
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
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.37, 24), new THREE.MeshBasicMaterial({ color: player.color }));
      ring.position.set(x, y, -0.14);
      scene.add(ring);
    });
    // Geister-Vorbild für die Auflösung: legt sich halb durchsichtig über die
    // eigene Maske, damit man sieht, wo es gehapert hat.
    this.ghost = this.makeMask(OWN_SCALE, OWN_POS.clone().add(new THREE.Vector3(0, 0, 0.04)), { ghost: true });
    this.ghost.mesh.visible = false;

    // Griffpunkte auf der eigenen Maske.
    this.knobs = HANDLES.map(() => {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), new THREE.MeshBasicMaterial({ color: "#ffe25c", transparent: true, opacity: 0.95, depthTest: false }));
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
    faceTexture ||= drawFace();
    const geometry = new THREE.PlaneGeometry(2, 2, MASK_SEG, MASK_SEG);
    const base = geometry.attributes.position.array.slice();
    const material = ghost
      ? new THREE.MeshBasicMaterial({ map: faceTexture, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ map: faceTexture, transparent: true, alphaTest: 0.45, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(scale);
    mesh.position.copy(position);
    mesh.castShadow = !ghost;
    this.scene.add(mesh);
    const mask = { mesh, base, scale, shape: new Array(12).fill(0) };
    this.deform(mask, mask.shape);
    return mask;
  }

  // Die Maske verziehen: jeder Griffpunkt nimmt die Fläche um sich herum mit,
  // weich abfallend. Dazu eine leichte Wölbung, damit Licht darauf liegt.
  deform(mask, shape) {
    const pos = mask.mesh.geometry.attributes.position;
    const arr = pos.array;
    const base = mask.base;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = base[i];
      const by = base[i + 1];
      let dx = 0;
      let dy = 0;
      for (let h = 0; h < HANDLES.length; h += 1) {
        const handle = HANDLES[h];
        const ox = shape[h * 2] || 0;
        const oy = shape[h * 2 + 1] || 0;
        if (!ox && !oy) continue;
        const rx = bx - handle.x;
        const ry = by - handle.y;
        const w = Math.exp(-(rx * rx + ry * ry) / (handle.sigma * handle.sigma));
        dx += w * ox * handle.range;
        dy += w * oy * handle.range;
      }
      arr[i] = bx + dx;
      arr[i + 1] = by + dy;
      const r2 = (bx * bx + by * by) / 1.1;
      arr[i + 2] = 0.28 * Math.sqrt(Math.max(0, 1 - r2));
    }
    pos.needsUpdate = true;
    mask.mesh.geometry.computeVertexNormals();
    mask.shape = shape.slice();
  }

  handleWorld(mask, index, shape, into = new THREE.Vector3()) {
    const handle = HANDLES[index];
    const x = handle.x + (shape[index * 2] || 0) * handle.range;
    const y = handle.y + (shape[index * 2 + 1] || 0) * handle.range;
    const r2 = (handle.x * handle.x + handle.y * handle.y) / 1.1;
    into.set(x, y, 0.28 * Math.sqrt(Math.max(0, 1 - r2)) + 0.04);
    return mask.mesh.localToWorld(into);
  }

  shot() {
    return {
      look: [0, 2.35, 0],
      frame: { w: 3.5, h: 4.9 },
      pitch: 0.06,
      fov: 38,
      intro: { yaw: 0.35, pitch: 0.12, zoom: 1.3 },
      finale: { pull: 0.9, zoom: 0.85, lift: 0.1, orbit: 0.08 }
    };
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
      if (!this.canShape()) return;
      const hit = hitAt(event);
      const mask = this.masks.get(this.own);
      if (!hit || !mask) return;
      let best = -1;
      let bestDist = PICK_RADIUS;
      const at = new THREE.Vector3();
      HANDLES.forEach((_, i) => {
        this.handleWorld(mask, i, this.localShape, at);
        const d = Math.hypot(at.x - hit.x, at.y - hit.y);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (best < 0) return;
      const grabbed = new THREE.Vector3();
      this.handleWorld(mask, best, this.localShape, grabbed);
      this.drag = { index: best, pointerId: event.pointerId, offX: grabbed.x - hit.x, offY: grabbed.y - hit.y };
      this.webglCanvas.setPointerCapture?.(event.pointerId);
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
      if (nowP - this.lastSentAt > SEND_EVERY_MS) {
        this.lastSentAt = nowP;
        this.sendInput({ action: "shape", h: this.localShape }).catch(() => {});
      }
    });
    const release = (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      if (this.canShape()) this.sendInput({ action: "shape", h: this.localShape, final: true }).catch(() => {});
    };
    this.on(this.webglCanvas, "pointerup", release);
    this.on(this.webglCanvas, "pointercancel", release);
  }

  unbind() {
    this.controls.style.pointerEvents = "";
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
    return Boolean(minigame && !minigame.finaleAt && this.phaseOf().phase === "shape" && this.localShape);
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId } = f;
    const face = arcade?.face;
    if (!face) return;
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
      knob.scale.setScalar(active ? 1.5 : pulse);
      knob.material.color.set(active ? "#ffffff" : "#ffe25c");
      knob.children[0].lookAt(this.camera.position);
    });

    // Geist des Vorbilds über der eigenen Maske in der Auflösung.
    const reveal = phase === "reveal" || phase === "over";
    this.ghost.mesh.visible = reveal;
    if (reveal) {
      this.deform(this.ghost, face.targets[round]);
      this.ghost.mesh.material.opacity = Math.min(0.42, since / 900 * 0.42);
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
          if (points >= 70) this.burst(OWN_POS.clone().add(new THREE.Vector3(0, 0.4, 0.6)), ["#ffe25c", "#ff5d73", "#28c7d9", "#ffffff"], { count: 24, speed: 2.2, up: 1.8, size: 0.07, life: 1 });
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
    const { phase, round, since, left } = this.phaseOf(f);
    let message = null;
    let tone = "#12aaff";
    if (phase === "lead") message = "Gleich hängt das Vorbild …";
    else if (phase === "show") { message = `Gesicht ${round + 1}/${face.rounds}: Merk es dir!`; tone = "#b57bff"; }
    else if (phase === "shape") {
      const secs = Math.ceil((left || 0) / 1000);
      message = since < 1400 ? "Zieh die Maske zurecht!" : secs <= 3 ? `Noch ${secs} …` : null;
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

// Das Gesicht der Maske, einmal gemalt und von allen Masken geteilt.
function drawFace() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const u = (v) => v * size;
  // Ohren
  ctx.fillStyle = "#f7b877";
  [[0.08, 0.5], [0.92, 0.5]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(u(x), u(y), u(0.075), 0, Math.PI * 2); ctx.fill(); });
  // Kopf mit weichem Verlauf
  const grad = ctx.createRadialGradient(u(0.44), u(0.4), u(0.05), u(0.5), u(0.52), u(0.46));
  grad.addColorStop(0, "#ffe2b3");
  grad.addColorStop(1, "#f6b26f");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(u(0.5), u(0.53), u(0.43), u(0.45), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = u(0.012);
  ctx.strokeStyle = "#8a4f22";
  ctx.stroke();
  // Haarschopf
  ctx.fillStyle = "#6b3fd6";
  [[0.36, 0.13, 0.12], [0.5, 0.09, 0.14], [0.64, 0.13, 0.12]].forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.moveTo(u(x - r), u(y + 0.1));
    ctx.quadraticCurveTo(u(x), u(y - 0.06), u(x + r), u(y + 0.1));
    ctx.closePath();
    ctx.fill();
  });
  // Wangen
  ctx.fillStyle = "rgba(255, 110, 130, 0.35)";
  [[0.26, 0.62], [0.74, 0.62]].forEach(([x, y]) => { ctx.beginPath(); ctx.ellipse(u(x), u(y), u(0.07), u(0.045), 0, 0, Math.PI * 2); ctx.fill(); });
  // Augen
  [[0.33, 0.4], [0.67, 0.4]].forEach(([x, y]) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.ellipse(u(x), u(y), u(0.075), u(0.085), 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#5a3417"; ctx.lineWidth = u(0.008); ctx.stroke();
    ctx.fillStyle = "#1c1c28";
    ctx.beginPath(); ctx.arc(u(x), u(y + 0.01), u(0.04), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(u(x + 0.014), u(y - 0.006), u(0.013), 0, Math.PI * 2); ctx.fill();
  });
  // Brauen
  ctx.fillStyle = "#3b2414";
  [[0.33, 0.29], [0.67, 0.29]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.ellipse(u(x), u(y), u(0.095), u(0.024), 0, 0, Math.PI * 2);
    ctx.fill();
  });
  // Nase
  ctx.fillStyle = "#ec9a57";
  ctx.beginPath(); ctx.ellipse(u(0.5), u(0.52), u(0.055), u(0.06), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.arc(u(0.485), u(0.5), u(0.016), 0, Math.PI * 2); ctx.fill();
  // Mund: offen, mit Zähnen und Zunge — beim Verziehen sieht man, was er tut.
  ctx.fillStyle = "#7a1c2c";
  ctx.beginPath();
  ctx.moveTo(u(0.34), u(0.69));
  ctx.quadraticCurveTo(u(0.5), u(0.66), u(0.66), u(0.69));
  ctx.quadraticCurveTo(u(0.5), u(0.8), u(0.34), u(0.69));
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(u(0.42), u(0.68), u(0.16), u(0.025));
  ctx.fillStyle = "#ff7b93";
  ctx.beginPath(); ctx.ellipse(u(0.5), u(0.745), u(0.06), u(0.022), 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#5a1020"; ctx.lineWidth = u(0.008);
  ctx.beginPath();
  ctx.moveTo(u(0.34), u(0.69));
  ctx.quadraticCurveTo(u(0.5), u(0.66), u(0.66), u(0.69));
  ctx.quadraticCurveTo(u(0.5), u(0.8), u(0.34), u(0.69));
  ctx.stroke();
  // Kinngrübchen
  ctx.strokeStyle = "rgba(138, 79, 34, 0.5)";
  ctx.lineWidth = u(0.008);
  ctx.beginPath(); ctx.arc(u(0.5), u(0.86), u(0.03), 0.2, Math.PI - 0.2); ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Die Textur wird von allen Masken geteilt und beim Abbau der Szene mit
  // entsorgt; danach muss sie neu gemalt werden.
  const dispose = texture.dispose.bind(texture);
  texture.dispose = () => { faceTexture = null; dispose(); };
  return texture;
}
