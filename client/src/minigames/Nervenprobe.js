import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin212";
import { frameLerp } from "./Quality.js?v=tumblekin212";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin212";

// Nervenprobe: die Uhr läuft sichtbar an, dann verschwindet sie — man zählt im
// Kopf weiter und drückt, wenn man glaubt, das Ziel sei erreicht.
//
// Vorher standen die Figuren hinter ihren Pulten, und die Zeitanzeige hing
// genau vor ihren Köpfen. Jetzt steht jeder vor seinem Pult mit Buzzer, die
// Anzeige hängt darüber, man nickt beim Zählen im Sekundentakt, haut auf den
// Knopf und schaut dann gebannt auf die eigene Anzeige, bis aufgelöst wird.
const PODIUM_GAP = 1.12;
const STAGE_Y = 0.26;
const KIN_Z = 0.95;
// Die grosse Stoppuhr über der Bühne: eine Umdrehung sind zehn Sekunden.
const DIAL_MS = 10000;
const DIAL_R = 0.9;
const DIAL_POS = [0, 3.25, -2.25];

// Das Zifferblatt: weiss, zehn Sekundenmarken, und die Zielzeit als goldener
// Keil. Man sieht so, WO der Zeiger hin muss, und zählt nicht nur im Kopf.
function paintDial(canvas, targetMs) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fffaf0";
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();
  const at = (ms) => (ms / DIAL_MS) * Math.PI * 2 - Math.PI / 2;
  // Zielkeil: ±0,25 s um die Zielzeit.
  ctx.fillStyle = "rgba(255, 196, 0, 0.9)";
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.arc(c, c, c - 8, at(targetMs - 250), at(targetMs + 250));
  ctx.closePath();
  ctx.fill();
  for (let s = 0; s < 10; s += 1) {
    const a = at(s * 1000);
    ctx.strokeStyle = "#28313f";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * (c - 12), c + Math.sin(a) * (c - 12));
    ctx.lineTo(c + Math.cos(a) * (c - 40), c + Math.sin(a) * (c - 40));
    ctx.stroke();
    ctx.fillStyle = "#28313f";
    ctx.font = "900 38px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(s), c + Math.cos(a) * (c - 68), c + Math.sin(a) * (c - 68));
  }
  for (let s = 0; s < 50; s += 1) {
    if (s % 5 === 0) continue;
    const a = at(s * 200);
    ctx.strokeStyle = "#7a8494";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * (c - 12), c + Math.sin(a) * (c - 12));
    ctx.lineTo(c + Math.cos(a) * (c - 26), c + Math.sin(a) * (c - 26));
    ctx.stroke();
  }
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

// Abweichung mit Vorzeichen: "+0.23" zu spät, "−0.10" zu früh.
function formatDeviation(stoppedMs, targetMs) {
  const d = (stoppedMs - targetMs) / 1000;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
}

// Wie gut: golden bis 0,15 s, grün bis 0,4 s, dann gelb, ab einer Sekunde rot.
function accentFor(deviation) {
  if (deviation === null || deviation === undefined) return "#ff6b7f";
  if (deviation < 150) return "#ffd76a";
  if (deviation < 400) return "#7df0a0";
  if (deviation < 1000) return "#ffd166";
  return "#ff8a6b";
}

// Die Auflösung im Takt: erst nach einer kurzen Pause die erste Anzeige, dann
// alle 380 ms die nächste, zuletzt die beste — und dann der Jubel.
const REVEAL_FIRST_MS = 300;
const REVEAL_STEP_MS = 380;
const REVEAL_SWEEP_MS = 450;

// A blocky game-show clock driven by a canvas texture: dark glass screen,
// glowing digits, rounded accent bezel.
function createTimerDisplay() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const dark = new THREE.MeshLambertMaterial({ color: "#1a2230" });
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 0.6, 0.12),
    [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: texture }), dark]
  );
  panel.userData = { canvas, ctx, texture, lastText: null, lastAccent: null };
  return panel;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintDisplay(panel, text, accent = "#7df0a0", sub = "") {
  const { ctx, canvas, texture, lastText, lastAccent } = panel.userData;
  if (lastText === text + sub && lastAccent === accent) return;
  panel.userData.lastText = text + sub;
  panel.userData.lastAccent = accent;
  // Screen glass with a soft top sheen.
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#182031");
  bg.addColorStop(0.45, "#0b1220");
  bg.addColorStop(1, "#060a12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(0, 0, canvas.width, 34);
  // Accent bezel with glow.
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 7;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 14;
  roundedRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 18);
  ctx.stroke();
  ctx.restore();
  // Corner rivets for the blocky look.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  [[20, 20], [canvas.width - 20, 20], [20, canvas.height - 20], [canvas.width - 20, canvas.height - 20]].forEach(([x, y]) => {
    ctx.fillRect(x - 3, y - 3, 6, 6);
  });
  // Glowing digits.
  ctx.save();
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  ctx.font = `bold ${sub ? 50 : 58}px 'Courier New', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + (sub ? -12 : 4));
  if (sub) {
    ctx.font = "bold 28px 'Courier New', monospace";
    ctx.shadowBlur = 8;
    ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 32);
  }
  ctx.restore();
  texture.needsUpdate = true;
}

// Das Zielschild über der Uhr: gross, golden, damit die gesuchte Zahl dort
// steht, wo man ohnehin hinschaut — nicht nur klein oben links in der Ecke.
function paintSign(panel, targetMs, accent) {
  const text = `ZIEL  ${(targetMs / 1000).toFixed(1).replace(".", ",")} s`;
  const { ctx, canvas, texture } = panel.userData;
  if (panel.userData.lastText === text + accent) return;
  panel.userData.lastText = text + accent;
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#241838");
  bg.addColorStop(1, "#0d0818");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  roundedRect(ctx, 10, 10, canvas.width - 20, canvas.height - 20, 22);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.font = "900 78px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  ctx.restore();
  texture.needsUpdate = true;
}

export class Nervenprobe extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stations = new Map();
    this.lastStopped = new Map();
    this.hidAt = false;
    this.labelY = 0.74;
    this.nextNod = new Map();
    this.finaleFocus = false;
    this.reveal = null;
  }

  stage() {
    return {
      label: "3D Nervenprobe",
      background: "#170e28",
      fog: ["#241539", 22, 50],
      lights: { sunPosition: [-4, 10, 7], skyColor: 0xb49ae8, groundColor: 0x6a4a3a, sunColor: 0xfff0d2, fillColor: 0xff9ecb, fillIntensity: 0.7 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-nerve-clock>0.00s</span><strong data-nerve-target></strong></div>
      <div class="color-banner" data-nerve-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.5, 34),
      new THREE.MeshLambertMaterial({ color: "#e8a94f" })
    );
    floor.position.set(0, -0.25, 8);
    floor.receiveShadow = true;
    scene.add(floor);
    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(9.6, 0.4, 4.8),
      new THREE.MeshLambertMaterial({ color: "#b8478a" })
    );
    stage.position.set(0, 0.06, -0.4);
    stage.receiveShadow = true;
    scene.add(stage);
    const carpet = new THREE.Mesh(
      new THREE.BoxGeometry(7.8, 0.06, 1.15),
      new THREE.MeshLambertMaterial({ color: "#e0334f" })
    );
    carpet.position.set(0, 0.3, 1.55);
    carpet.receiveShadow = true;
    scene.add(carpet);

    // Die Vorbühne. Der goldene Boden reicht jetzt bis unter die Kamera und
    // füllte damit das untere Bilddrittel mit einer einzigen hellen Fläche —
    // schlimmer als das Loch, das er stopfen sollte. Vor der Bühne liegt
    // deshalb dunkler Studioboden, und das Gold bleibt der Bühne.
    const vorbuehne = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.12, 22),
      new THREE.MeshLambertMaterial({ color: "#2e2242" })
    );
    vorbuehne.position.set(0, 0.02, 14);
    vorbuehne.receiveShadow = true;
    scene.add(vorbuehne);
    // Zwei warme Lichtpfützen darauf, damit die Fläche nicht tot ist.
    [[-3.4, 6.4], [3.4, 8.2]].forEach(([x, z]) => {
      const pfuetze = new THREE.Mesh(
        new THREE.CircleGeometry(2.6, 20),
        new THREE.MeshBasicMaterial({ color: "#ffb35c", transparent: true, opacity: 0.12, depthWrite: false })
      );
      pfuetze.rotation.x = -Math.PI / 2;
      pfuetze.position.set(x, 0.1, z);
      scene.add(pfuetze);
    });
    this.buildAudience(scene);
    // Der Vorhang hinter der Bühne.
    for (let i = 0; i < 12; i += 1) {
      const pleat = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 4.6, 0.4 + (i % 2) * 0.18),
        new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? "#7a4ddb" : "#6a3fc4" })
      );
      pleat.position.set((i - 5.5) * 0.95, 2.1, -3.6);
      scene.add(pleat);
    }
    const valance = new THREE.Mesh(
      new THREE.BoxGeometry(11.6, 0.55, 0.7),
      new THREE.MeshLambertMaterial({ color: "#ffb400" })
    );
    valance.position.set(0, 4.55, -3.5);
    scene.add(valance);

    [[-4.9, "#ffc400"], [4.9, "#ffc400"]].forEach(([x, color]) => {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 4.6, 0.6),
        new THREE.MeshLambertMaterial({ color })
      );
      pillar.position.set(x, 2.05, -3.1);
      scene.add(pillar);
      const knob = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.35, 0.8),
        new THREE.MeshLambertMaterial({ color: "#ff5c8a" })
      );
      knob.position.set(x, 4.5, -3.1);
      scene.add(knob);
    });

    // Bunting: candy flags strung between the pillars.
    const flagColors = ["#ff2e6a", "#12aaff", "#ffc400", "#33cf4d", "#ff8b2e"];
    for (let i = 0; i < 11; i += 1) {
      const t = i / 10;
      const sag = Math.sin(t * Math.PI) * 0.55;
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.3, 0.06),
        new THREE.MeshLambertMaterial({ color: flagColors[i % flagColors.length] })
      );
      flag.position.set(-4.9 + t * 9.8, 4.32 - sag, -2.95);
      flag.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.12;
      scene.add(flag);
    }

    // Gold star sparkles on the curtain.
    this.stars = [];
    [[-3.4, 3.3], [-1.2, 2.6], [1.6, 3.5], [3.6, 2.8], [0.2, 1.7], [-2.4, 1.4], [2.6, 1.6]].forEach(([x, y], index) => {
      const star = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.1),
        new THREE.MeshLambertMaterial({ color: "#ffd76a", emissive: "#ffd76a", emissiveIntensity: 0.6 })
      );
      star.position.set(x, y, -3.28);
      star.rotation.z = Math.PI / 4;
      star.userData = { phase: index * 0.9 };
      scene.add(star);
      this.stars.push(star);
    });

    // Traverse mit Scheinwerfern über der Bühne — das, was in einem Studio
    // über dem Vorhang hängt. Hier standen vorher zwei Wolken.
    const traverse = new THREE.Mesh(
      new THREE.BoxGeometry(13, 0.28, 0.28),
      new THREE.MeshLambertMaterial({ color: "#3d4658" })
    );
    traverse.position.set(0, 6.4, -2.6);
    scene.add(traverse);
    for (let i = 0; i < 5; i += 1) {
      const x = (i - 2) * 2.4;
      const buegel = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.5, 0.1),
        new THREE.MeshLambertMaterial({ color: "#3d4658" })
      );
      buegel.position.set(x, 6.05, -2.6);
      scene.add(buegel);
      const lampe = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.44, 0.6),
        new THREE.MeshLambertMaterial({ color: "#2b3242" })
      );
      lampe.position.set(x, 5.68, -2.6);
      lampe.rotation.x = 0.45;
      scene.add(lampe);
      const linse = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.34, 0.06),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? "#fff0b8" : "#ffc9e4" })
      );
      linse.position.set(x, 5.55, -2.35);
      linse.rotation.x = 0.45;
      scene.add(linse);
    }

    this.buildStopwatch();
    this.buildTargetSign();

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addStation(player, index, players.length));
  }

  // Studiopublikum vor der Bühne: drei Reihen Sitze mit Zuschauern, die man
  // von hinten sieht, und rechts eine Fernsehkamera mit roter Lampe. Alles
  // bleibt niedrig — die Köpfe liegen im Bild unter den Podesten.
  buildAudience(scene) {
    const zufall = streuer(17);
    const plaetze = [];
    [5.9, 7.0, 8.1].forEach((z, reihe) => {
      for (let i = 0; i < 8; i += 1) {
        const x = (i - 3.5) * 0.8 + (reihe % 2) * 0.25;
        if (x > 2.0 && reihe === 0) continue;
        plaetze.push({ x, z, farbe: ["#9a4a5a", "#9a8a4a", "#3a7a86", "#4a8a5a", "#6a5a9a", "#9a6a4a"][Math.floor(zufall() * 6)], haar: ["#2c2f38", "#6b4a2e", "#e8c15a", "#c8413b"][Math.floor(zufall() * 4)], phase: zufall() * 6 });
      }
    });
    viele(scene, new THREE.BoxGeometry(0.62, 0.42, 0.1), lambert("#7a1f3a"), plaetze.map((p) => ({ p: [p.x, 0.38, p.z + 0.28] })));
    viele(scene, new THREE.BoxGeometry(0.62, 0.08, 0.42), lambert("#5a1a2e"), plaetze.map((p) => ({ p: [p.x, 0.26, p.z + 0.06] })));
    const koerper = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.38, 0.26), new THREE.MeshLambertMaterial({ color: "#ffffff" }), plaetze.length);
    const koepfe = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.26, 0.26), new THREE.MeshLambertMaterial({ color: "#ffffff" }), plaetze.length);
    plaetze.forEach((p, i) => {
      koerper.setColorAt(i, new THREE.Color(p.farbe));
      koepfe.setColorAt(i, new THREE.Color(p.haar));
    });
    [koerper, koepfe].forEach((m) => { m.frustumCulled = false; scene.add(m); });
    this.audience = { plaetze, koerper, koepfe, jubel: 0 };
    this.placeAudience(0);

    // Fernsehkamera rechts.
    const kamera = new THREE.Group();
    kamera.position.set(2.9, 0, 5.6);
    kamera.rotation.y = 0.35;
    scene.add(kamera);
    [0, 2.1, 4.2].forEach((a) => {
      const bein = kiste(kamera, 0.05, 1.2, 0.05, "#2b3242", [Math.sin(a) * 0.25, 0.55, Math.cos(a) * 0.25], { schatten: false });
      bein.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
    });
    kiste(kamera, 0.4, 0.4, 0.7, "#2b3242", [0, 1.3, 0]);
    const objektiv = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.35, 12), lambert("#1a1e28"));
    objektiv.rotation.x = Math.PI / 2;
    objektiv.position.set(0, 1.3, -0.5);
    kamera.add(objektiv);
    this.tally = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: "#ff3040" }));
    this.tally.position.set(0.14, 1.55, -0.2);
    kamera.add(this.tally);
    kiste(kamera, 0.03, 0.03, 0.6, "#8a90a0", [0, 1.1, 0.5], { schatten: false }).rotation.x = 0.4;
  }

  placeAudience(now) {
    const a = this.audience;
    if (!a) return;
    const o = new THREE.Object3D();
    a.plaetze.forEach((p, i) => {
      const hopser = a.jubel > 0 ? Math.max(0, Math.sin(now / 110 + p.phase)) * 0.18 * a.jubel : Math.sin(now / 900 + p.phase) * 0.015;
      o.position.set(p.x, 0.5 + hopser, p.z);
      o.rotation.set(0, 0, Math.sin(now / 1300 + p.phase) * 0.04);
      o.updateMatrix();
      a.koerper.setMatrixAt(i, o.matrix);
      o.position.set(p.x, 0.83 + hopser, p.z);
      o.updateMatrix();
      a.koepfe.setMatrixAt(i, o.matrix);
    });
    a.koerper.instanceMatrix.needsUpdate = true;
    a.koepfe.instanceMatrix.needsUpdate = true;
  }

  buildStopwatch() {
    const arcade = this.minigame?.arcade;
    const group = new THREE.Group();
    group.position.set(...DIAL_POS);
    const gold = new THREE.MeshLambertMaterial({ color: "#ffc400" });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(DIAL_R + 0.12, DIAL_R + 0.12, 0.24, 40), gold);
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.2), gold);
    crown.position.y = DIAL_R + 0.22;
    group.add(crown);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.24), new THREE.MeshLambertMaterial({ color: "#ff2038" }));
    cap.position.y = DIAL_R + 0.38;
    group.add(cap);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    paintDial(canvas, arcade?.targetMs || 5000);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(DIAL_R, 48), new THREE.MeshBasicMaterial({ map: texture }));
    face.position.z = 0.125;
    group.add(face);

    // Der Zeiger dreht um die Mitte.
    this.hand = new THREE.Group();
    this.hand.position.z = 0.14;
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.05, DIAL_R * 0.86, 0.03), new THREE.MeshBasicMaterial({ color: "#ff2038" }));
    needle.position.y = DIAL_R * 0.4;
    this.hand.add(needle);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 16), new THREE.MeshBasicMaterial({ color: "#28313f" }));
    hub.rotation.x = Math.PI / 2;
    this.hand.add(hub);
    group.add(this.hand);

    // Die Abdeckung: nach zwei Sekunden schiebt sie sich über das Blatt.
    const coverCanvas = document.createElement("canvas");
    coverCanvas.width = 256;
    coverCanvas.height = 256;
    const pen = coverCanvas.getContext("2d");
    pen.fillStyle = "#2a1d45";
    pen.beginPath();
    pen.arc(128, 128, 126, 0, Math.PI * 2);
    pen.fill();
    pen.fillStyle = "#ff5c8a";
    pen.font = "900 150px ui-rounded, system-ui, sans-serif";
    pen.textAlign = "center";
    pen.textBaseline = "middle";
    pen.fillText("?", 128, 138);
    const coverTex = new THREE.CanvasTexture(coverCanvas);
    coverTex.colorSpace = THREE.SRGBColorSpace;
    this.cover = new THREE.Mesh(new THREE.CircleGeometry(DIAL_R + 0.02, 48), new THREE.MeshBasicMaterial({ map: coverTex, transparent: true, opacity: 0 }));
    this.cover.position.z = 0.16;
    group.add(this.cover);

    this.dialMarks = new Map();
    this.scene.add(group);
    this.dial = group;
  }

  // Das Schild hängt an zwei Seilen von der Traverse, direkt über der Uhr.
  buildTargetSign() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const dark = new THREE.MeshLambertMaterial({ color: "#1a1228" });
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.85, 0.1),
      [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }), dark]
    );
    sign.userData = { canvas, ctx: canvas.getContext("2d"), texture, lastText: null };
    sign.position.set(DIAL_POS[0], DIAL_POS[1] + 1.78, DIAL_POS[2] - 0.05);
    this.scene.add(sign);
    [-1, 1].forEach((side) => {
      const seil = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.2, 0.03), new THREE.MeshLambertMaterial({ color: "#8a90a0" }));
      seil.position.set(side * 1.4, sign.position.y + 1, sign.position.z);
      this.scene.add(seil);
    });
    paintSign(sign, this.minigame?.arcade?.targetMs || 5000, "#ffd76a");
    this.targetSign = sign;
  }

  // Bei der Auflösung steckt für jeden eine Marke in seiner Farbe am Rand —
  // dort, wo er gestoppt hat.
  markDial(player, ms) {
    if (this.dialMarks.has(player.id) || !this.dial) return;
    const angle = -(ms / DIAL_MS) * Math.PI * 2;
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.08), new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.4 }));
    mark.position.set(-Math.sin(angle) * (DIAL_R + 0.02), Math.cos(angle) * (DIAL_R + 0.02), 0.2);
    mark.rotation.z = angle;
    this.dial.add(mark);
    this.dialMarks.set(player.id, mark);
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * PODIUM_GAP;
  }

  addStation(player, index, count) {
    const x = this.stationX(index, count);
    this.addKin(player, index, { x, ground: STAGE_Y, z: KIN_Z, facing: 0 });
    // Schmales Pult rechts neben der Figur, der Buzzer auf Handhöhe — davor
    // stehend verdeckte es die halbe Figur.
    const px = x + 0.36;
    const podium = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), new THREE.MeshLambertMaterial({ color: "#fdf5e6" }));
    podium.position.set(px, STAGE_Y + 0.21, KIN_Z + 0.12);
    podium.castShadow = true;
    this.scene.add(podium);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), new THREE.MeshLambertMaterial({ color: player.color }));
    trim.position.set(px, STAGE_Y + 0.4, KIN_Z + 0.12);
    this.scene.add(trim);
    const buzzer = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.09, 14), new THREE.MeshLambertMaterial({ color: "#ff2038", emissive: "#ff2038", emissiveIntensity: 0.25 }));
    buzzer.position.set(px, STAGE_Y + 0.49, KIN_Z + 0.12);
    this.scene.add(buzzer);
    // Anzeige über und hinter der Figur, mit Lampe und Namen.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.58, 0.1), new THREE.MeshLambertMaterial({ color: player.color }));
    frame.position.set(x, 1.75, 0.05);
    this.scene.add(frame);
    const display = createTimerDisplay();
    display.scale.setScalar(0.82);
    display.position.set(x, 1.75, 0.11);
    this.scene.add(display);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), new THREE.MeshLambertMaterial({ color: "#c0c9d4" }));
    post.position.set(x, 0.8, -0.02);
    this.scene.add(post);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshLambertMaterial({ color: "#2ee86a", emissive: new THREE.Color("#2ee86a"), emissiveIntensity: 0.8 }));
    bulb.position.set(x + 0.45, 2.12, 0.08);
    this.scene.add(bulb);
    this.stations.set(player.id, { x, buzzer, display, bulb });
  }

  // Die Posen des Finales (Jubel, Enttäuschung) erst, wenn die Auflösung
  // durch ist — vorher jubelte der Sieger, bevor seine Zahl zu sehen war.
  finaleOverride() {
    return !this.jubelt;
  }

  shot() {
    const count = Math.max(1, this.stations.size);
    // Breit genug für die äusseren Anzeigen, hoch genug für die Stoppuhr über
    // der Bühne. Vorher schnitt die Auflösung die linke Anzeige an, und das
    // halbe Bild darunter war leerer Studioboden.
    // Hoch genug für Uhr UND Zielschild darüber. Bei vier Spielern gibt die
    // Breite den Abstand vor und die Höhe kommt von selbst mit; im Eins gegen
    // Eins zoomte die Kamera auf die zwei Pulte, und Uhr und Schild lagen
    // oberhalb des Bildes.
    return {
      look: [0.15, 2.75, 0.4],
      frame: { w: count * PODIUM_GAP + 1.1, h: 6.2 },
      pitch: 0.14,
      fov: 36,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.4 },
      // Die Auflösung IST das Finale: alle Anzeigen und die Uhr bleiben im Bild.
      finale: { pull: 0.95, zoom: 1, lift: 0.1, orbit: 0.04 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-nerve-stop>
        <span class="nerve-button-face">STOPP</span>
      </button>`;
    this.stopButton = this.controls.querySelector("[data-nerve-stop]");
    this.on(this.stopButton, "pointerdown", (event) => {
      event.preventDefault();
      this.pressStop();
    });
  }

  pressStop() {
    const arcade = (this.update || this.minigame)?.arcade;
    const id = this.getControlledPlayerId();
    const own = arcade?.players?.[id];
    this.localStops ||= new Set();
    if (!own || own.stoppedMs !== null || this.localStops.has(id)) return;
    this.localStops.add(id);
    this.feedback?.sound("pop");
    this.feedback?.vibrate([14, 10, 22]);
    this.rig.shake(0.4);
    this.animators.get(id)?.trigger("punch");
    this.sendInput({ action: "stop" }).catch(() => { this.localStops.delete(id); });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    if (this.audience) {
      this.audience.jubel += ((this.jubelt ? 1 : 0) - this.audience.jubel) * Math.min(1, dt * 3);
      this.placeAudience(now);
    }
    if (this.tally) this.tally.visible = Math.floor(now / 700) % 2 === 0;
    if (!arcade) return;
    // Die Uhr läuft auf Ankunftszeit: Wer im Kopf weiterzählt und beim
    // Zielwert tippt, dessen Tipp kommt beim Server auch bei diesem Wert an —
    // sonst zählte die Netzlaufzeit hin und zurück als eigener Fehler.
    const elapsed = Math.max(0, this.arrivalNow() - minigame.startedAt);
    const hidden = elapsed >= arcade.hideAfterMs;
    const revealAll = Boolean(minigame.finaleAt);
    if (hidden && !this.hidAt) {
      this.hidAt = true;
      this.feedback?.sound("move");
    }
    // Die Auflösung: vom Weitesten zum Nächsten, einer nach dem anderen.
    if (revealAll && !this.reveal) {
      const reihe = players
        .map((player) => ({ player, entry: arcade.players[player.id] }))
        .filter((r) => r.entry)
        .sort((a, b) => (b.entry.deviationMs ?? Infinity) - (a.entry.deviationMs ?? Infinity));
      const sieger = reihe.length && reihe[reihe.length - 1].entry.deviationMs !== null ? reihe[reihe.length - 1] : null;
      this.reveal = {
        at: now,
        order: reihe.map((r, i) => ({ id: r.player.id, due: now + REVEAL_FIRST_MS + i * REVEAL_STEP_MS, done: false })),
        winnerAt: now + REVEAL_FIRST_MS + Math.max(0, reihe.length - 1) * REVEAL_STEP_MS + 320,
        winner: sieger,
        cheered: false
      };
      this.feedback?.sound("countdown");
    }
    const aufgedeckt = (id) => Boolean(this.reveal?.order.find((o) => o.id === id && now >= o.due));
    const jubelt = Boolean(this.reveal && now >= this.reveal.winnerAt);
    this.jubelt = jubelt;

    // Die grosse Uhr: der Zeiger läuft, solange man ihn sehen darf; dann
    // deckt sie sich zu, und zur Auflösung öffnet sie sich und der Zeiger
    // fährt zur Zielzeit.
    if (this.hand) {
      let shownMs = hidden ? arcade.hideAfterMs : elapsed;
      if (this.reveal) {
        const u = Math.min(1, (now - this.reveal.at) / REVEAL_SWEEP_MS);
        const e = 1 - Math.pow(1 - u, 3);
        shownMs = arcade.hideAfterMs + (arcade.targetMs - arcade.hideAfterMs) * e;
      }
      this.hand.rotation.z = -(shownMs / DIAL_MS) * Math.PI * 2;
      const coverTarget = hidden && !revealAll ? 1 : 0;
      this.cover.material.opacity += (coverTarget - this.cover.material.opacity) * frameLerp(0.2, dt);
      this.cover.visible = this.cover.material.opacity > 0.01;
    }

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const station = this.stations.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !station || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const stoppedReally = entry.stoppedMs !== null && entry.stoppedMs !== undefined;
      // DASS jemand gestoppt hat, sieht man sofort — Anzeige "STOP", blaue
      // Lampe, gedrückter Buzzer. WELCHE Zeit er hat, erst in der Auflösung,
      // wenn alle gedrückt haben.
      const stopped = stoppedReally;
      const offen = revealAll && aufgedeckt(player.id);
      const deviation = entry.deviationMs ?? null;
      if (offen) {
        const siegerHier = jubelt && this.reveal.winner?.player.id === player.id;
        paintDisplay(
          station.display,
          stoppedReally ? formatSeconds(entry.stoppedMs) : "—",
          siegerHier ? (Math.floor(now / 160) % 2 === 0 ? "#ffd76a" : "#fff3c4") : accentFor(stoppedReally ? deviation : null),
          stoppedReally ? formatDeviation(entry.stoppedMs, arcade.targetMs) : "kein Stopp"
        );
      } else if (revealAll) {
        paintDisplay(station.display, "? ? ?", Math.floor(now / 140) % 2 === 0 ? "#ffd76a" : "#c8a24a");
      } else if (stopped) {
        paintDisplay(station.display, "STOP", "#8fd4ff");
      } else if (!hidden) {
        paintDisplay(station.display, formatSeconds(elapsed), "#7df0a0");
      } else {
        paintDisplay(station.display, "? ? ?", "#ff5c8a");
      }
      station.buzzer.position.y += ((stopped ? STAGE_Y + 0.45 : STAGE_Y + 0.49) - station.buzzer.position.y) * frameLerp(0.25, dt);
      station.buzzer.material.emissiveIntensity = stopped ? 1 : 0.25;
      const bulbColor = offen ? accentFor(stoppedReally ? deviation : null) : revealAll ? "#ffd76a" : stopped ? "#12aaff" : hidden ? "#ff2038" : "#2ee86a";
      station.bulb.material.color.set(bulbColor);
      station.bulb.material.emissive.set(bulbColor);
      station.bulb.material.emissiveIntensity = 0.8;

      if (stoppedReally && !this.lastStopped.get(player.id)) {
        this.lastStopped.set(player.id, true);
        if (!isOwn) {
          animator.trigger("punch");
          this.feedback?.sound("move");
        }
        this.burst(station.buzzer.position.clone().setY(STAGE_Y + 0.6), ["#ff2038", "#ffffff"], { count: 9, speed: 1.9, up: 1.6, size: 0.07, life: 0.5, drag: 2, fadePow: 1.4 });
        this.pop(new THREE.Vector3(station.x, 1.4, KIN_Z + 0.4), "STOPP!", { color: "#ffffff", size: 0.3, life: 0.7, rise: 0.6 });
      }

      // Aufdecken: Marke an der Uhr, Funken, die Abweichung als Zahl.
      const slot = this.reveal?.order.find((o) => o.id === player.id);
      if (slot && offen && !slot.done) {
        slot.done = true;
        if (stoppedReally) this.markDial(player, entry.stoppedMs);
        const farbe = accentFor(stoppedReally ? deviation : null);
        this.burst(station.display.position.clone().add(new THREE.Vector3(0, 0, 0.2)), [farbe, "#ffffff"], { count: 10, speed: 1.6, up: 1.2, size: 0.06, life: 0.5, drag: 2 });
        this.pop(new THREE.Vector3(station.x, 2.3, 0.4), stoppedReally ? `${(deviation / 1000).toFixed(2)} s` : "—", { color: farbe, size: isOwn ? 0.34 : 0.28, life: 0.9, rise: 0.4 });
        this.feedback?.sound("pop", { pan: station.x * 0.2 });
        if (isOwn) this.feedback?.vibrate(12);
        animator.trigger(stoppedReally && deviation < 400 ? "hop" : "flinch", { height: 0.2 });
      }

      if (revealAll) {
        if (!stoppedReally) animator.set("shrug");
        else if (!jubelt) {
          // Bangen, bis die eigene Zahl aufgeht.
          animator.set("focus");
          animator.lookAt(station.display.position);
        }
        return;
      }
      if (stopped) {
        // Gedrückt — und jetzt bangen: auf die eigene Anzeige schauen.
        animator.set("focus");
        animator.lookAt(station.display.position);
        animator.expression("scared", 150);
      } else if (hidden) {
        animator.set("think");
        animator.lookAt(null);
        // Nervöses Nicken, aber in keinem Takt: früher nickten alle genau im
        // Sekundentakt, und man konnte die Zeit einfach an den Figuren
        // abzählen. Jetzt hat jede ihren eigenen, unregelmässigen Abstand.
        const due = this.nextNod.get(player.id) ?? now + 900 + Math.random() * 1400;
        if (now >= due) {
          animator.trigger("nod");
          this.nextNod.set(player.id, now + 1300 + Math.random() * 1700);
        } else {
          this.nextNod.set(player.id, due);
        }
      } else {
        animator.set("focus");
        animator.lookAt(station.display.position);
      }
    });

    // Der Sieger: goldene Anzeige, Konfetti, das Publikum steht auf.
    if (jubelt && !this.reveal.cheered) {
      this.reveal.cheered = true;
      const sieger = this.reveal.winner;
      if (sieger) {
        const station = this.stations.get(sieger.player.id);
        if (station) {
          this.burst(station.display.position.clone().add(new THREE.Vector3(0, 0.3, 0.2)), [sieger.player.color, "#ffd76a", "#ffffff"], { count: 30, speed: 2.6, up: 2.4, size: 0.08, life: 1, drag: 1.4 });
          this.pop(new THREE.Vector3(station.x, 2.75, 0.4), sieger.entry.deviationMs < 100 ? "🎯 VOLLTREFFER!" : "AM NÄCHSTEN!", { color: "#ffd76a", size: 0.4, life: 1.2, rise: 0.5 });
        }
      }
      this.rig.shake(0.35);
      this.feedback?.vibrate([30, 30, 60]);
    }

    // Die Sterne am Vorhang glimmen nur noch leise. Vorher blinkten sie
    // hektisch, und zwei Lichtkegel schwenkten über die Bühne — beides zog
    // den Blick genau von dem weg, worauf es ankommt: die eigene Zählung.
    this.stars?.forEach((star) => {
      star.material.emissiveIntensity = 0.45 + Math.sin(now / 1800 + star.userData.phase) * 0.1;
    });
    // Das Zielschild leuchtet in der Auflösung auf.
    if (this.targetSign) {
      const glow = this.jubelt ? "#fff3c4" : "#ffd76a";
      paintSign(this.targetSign, arcade.targetMs, revealAll && Math.floor(now / 200) % 2 === 0 ? "#fff3c4" : glow);
    }
  }

  drawHud(f) {
    const { arcade, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, this.arrivalNow() - minigame.startedAt);
    const hidden = elapsed >= arcade.hideAfterMs;
    const revealAll = Boolean(minigame.finaleAt);
    // Die Rundenuhr oben links zählt hier NICHT mit — sie verriete die Zeit,
    // die man schätzen soll. Sie zeigt dasselbe wie die Anzeigen: bis zum
    // Verstecken die Stoppuhr, danach nichts.
    this.clockNode ||= this.hud.querySelector("[data-nerve-clock]");
    this.clockNode.textContent = revealAll || !hidden ? `${(Math.min(elapsed, arcade.hideAfterMs) / 1000).toFixed(2)}s` : "?.??s";
    this.targetNode ||= this.hud.querySelector("[data-nerve-target]");
    this.targetNode.textContent = `Ziel: ${(arcade.targetMs / 1000).toFixed(1)}s`;
    const banner = this.hud.querySelector("[data-nerve-banner]");
    const own = arcade.players[this.getControlledPlayerId()];
    const stopped = this.localStops?.has(f.controlledId) || (own?.stoppedMs !== null && own?.stoppedMs !== undefined);
    if (revealAll) {
      banner.hidden = false;
      const sieger = this.jubelt ? this.reveal?.winner : null;
      const name = sieger ? (f.state?.players?.find((player) => player.id === sieger.player.id)?.name || "?") : null;
      banner.textContent = sieger
        ? `🏆 ${name} — ${(sieger.entry.deviationMs / 1000).toFixed(2).replace(".", ",")} s daneben`
        : "Auflösung …";
      banner.style.background = "#ffc400";
      banner.style.color = "#5c4508";
    } else if (stopped) {
      banner.hidden = false;
      banner.textContent = "Gestoppt ✓";
      banner.style.background = "#12aaff";
      banner.style.color = "#ffffff";
    } else if (hidden) {
      banner.hidden = false;
      banner.textContent = "Zähl im Kopf weiter!";
      banner.style.background = "#ff2e6a";
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }

    if (this.stopButton) this.stopButton.disabled = stopped || revealAll;
  }
}
