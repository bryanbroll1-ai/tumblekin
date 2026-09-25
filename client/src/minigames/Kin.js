import * as THREE from "/vendor/three/three.module.js";
import { prefersReducedMotion } from "./Quality.js?v=tumblekin200";

// Die Tumblekin: Figur und Bewegung.
//
// Vorher war eine Figur ein einziger Klotz mit angeklebten Füssen, und jede
// Szene hatte nur acht Zustände zur Hand — laufen, springen, jubeln, trauern,
// stolpern, fallen, getroffen, stehen. Pumpen, Werfen, Klettern, Graben:
// alles wurde mit "springen" vorgetäuscht oder gar nicht gezeigt. Und jeder
// Wechsel war ein harter Schnitt von einem Bild aufs nächste.
//
// Jetzt hat die Figur ein Gerüst — Hüfte, Rumpf, Kopf, zwei Arme, zwei Beine —
// und ein Gesicht, das etwas ausdrücken kann: Pupillen, die hinschauen, Lider,
// Brauen, sieben Münder. Die Bewegung ist in Posen beschrieben, zwischen denen
// überblendet wird. Arme können eine eigene Handlung spielen, während die Beine
// weiterlaufen. Das Gesicht und der Blick lassen sich unabhängig vom Körper
// setzen.
//
// Die Schnittstelle nach aussen ist dieselbe geblieben: set, trigger, update,
// groundY, rate. Jede Szene, die mit der alten Figur lief, läuft mit dieser.

// Der Nullpunkt der Figur liegt in ihrer KÖRPERMITTE, nicht unter den Füssen:
// die Fusssohle liegt KIN_SOLE darunter. Wer eine Figur auf einen Boden stellt,
// nimmt standOn(bodenHöhe) — und dieselbe Zahl gehört an animator.groundY.
export const KIN_SOLE = 0.3;
export function standOn(groundY) {
  return groundY + KIN_SOLE;
}

// --- Masse (im Gerüst, Ursprung an der Sohle, Blick nach +z) ---------------
const HIP = 0.13;
const TORSO = { w: 0.34, h: 0.2, d: 0.28 };
// Die Schultern sitzen knapp ausserhalb der Kopfkante: senkrecht erhobene Arme
// verschwanden sonst hinter dem Kopf — und Jubeln, Klettern, Tragen sieht man
// nur an den Armen.
const SHOULDER = { x: 0.225, y: 0.17 };
const NECK = 0.19;
const HEAD = { w: 0.44, h: 0.34, d: 0.38, cy: 0.16 };
const FACE_Z = HEAD.d / 2;
const EYE = { x: 0.1, y: 0.19 };
const MOUTH_Y = 0.085;

// Der Spielerfarbe werden zwei Nachbartöne abgeleitet: dunkler für die Beine,
// heller für Bauch und Hände. So bleibt die Figur einfarbig lesbar und hat
// trotzdem Form.
const FACE_DARK = "#1b2230";
const SHOE = "#2b3140";
const CHEEK = "#ff8f7c";
const TONGUE = "#ff6b7d";
const GOLD = "#ffd24a";
const LEAF = "#57c86a";

// --- Geometrie ------------------------------------------------------------
// Alle starren Teile eines Gelenks werden zu EINEM Mesh verschmolzen, die
// Farben wandern dafür in die Eckpunkte. Eine Figur kommt so mit rund elf
// Zeichenaufrufen aus; die alte brauchte fünfzehn für weniger Form.
//
// Jede Fläche wird dabei leicht nach ihrer Lage schattiert — oben heller, unten
// dunkler. Das ist eingebackenes Umgebungslicht: die Figur bleibt auch in einer
// flach ausgeleuchteten Szene plastisch.
const _color = new THREE.Color();

function part(w, h, d, x, y, z, color, rot = null) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (rot) {
    if (rot[0]) geometry.rotateX(rot[0]);
    if (rot[1]) geometry.rotateY(rot[1]);
    if (rot[2]) geometry.rotateZ(rot[2]);
  }
  geometry.translate(x, y, z);
  return { geometry, color };
}

function merge(parts) {
  let vertices = 0;
  let indices = 0;
  parts.forEach(({ geometry }) => {
    vertices += geometry.attributes.position.count;
    indices += geometry.index.count;
  });
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const index = new Uint16Array(indices);
  let vo = 0;
  let io = 0;
  parts.forEach(({ geometry, color: hex }) => {
    const count = geometry.attributes.position.count;
    position.set(geometry.attributes.position.array, vo * 3);
    normal.set(geometry.attributes.normal.array, vo * 3);
    _color.set(hex);
    const normals = geometry.attributes.normal.array;
    for (let i = 0; i < count; i += 1) {
      const ny = normals[i * 3 + 1];
      const shade = 1 + ny * 0.1 - (1 - Math.abs(ny)) * 0.03;
      color[(vo + i) * 3] = Math.min(1, _color.r * shade);
      color[(vo + i) * 3 + 1] = Math.min(1, _color.g * shade);
      color[(vo + i) * 3 + 2] = Math.min(1, _color.b * shade);
    }
    const source = geometry.index.array;
    for (let i = 0; i < source.length; i += 1) index[io + i] = source[i] + vo;
    vo += count;
    io += source.length;
    geometry.dispose();
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  merged.setAttribute("color", new THREE.BufferAttribute(color, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  merged.computeBoundingSphere();
  return merged;
}

function shiftColor(hex, amount) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * (amount < 0 ? 1.05 : 0.92)), Math.max(0, Math.min(1, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

// Die Münder. Aus wenigen Klötzen gebaut, immer nur einer sichtbar.
function buildMouths(material) {
  const d = 0.03;
  const z = FACE_Z + 0.004;
  const shapes = {
    smile: [
      part(0.07, 0.024, d, 0, MOUTH_Y - 0.012, z, FACE_DARK),
      part(0.024, 0.03, d, -0.044, MOUTH_Y + 0.004, z, FACE_DARK),
      part(0.024, 0.03, d, 0.044, MOUTH_Y + 0.004, z, FACE_DARK)
    ],
    grin: [
      part(0.13, 0.052, d, 0, MOUTH_Y - 0.008, z, FACE_DARK),
      part(0.07, 0.018, d + 0.004, 0, MOUTH_Y - 0.024, z, TONGUE),
      part(0.026, 0.026, d, -0.072, MOUTH_Y + 0.016, z, FACE_DARK),
      part(0.026, 0.026, d, 0.072, MOUTH_Y + 0.016, z, FACE_DARK)
    ],
    open: [
      part(0.075, 0.075, d, 0, MOUTH_Y - 0.01, z, FACE_DARK),
      part(0.05, 0.022, d + 0.004, 0, MOUTH_Y - 0.035, z, TONGUE)
    ],
    o: [
      part(0.045, 0.05, d, 0, MOUTH_Y - 0.006, z, FACE_DARK)
    ],
    frown: [
      part(0.07, 0.024, d, 0, MOUTH_Y + 0.004, z, FACE_DARK),
      part(0.024, 0.03, d, -0.044, MOUTH_Y - 0.012, z, FACE_DARK),
      part(0.024, 0.03, d, 0.044, MOUTH_Y - 0.012, z, FACE_DARK)
    ],
    flat: [
      part(0.09, 0.022, d, 0, MOUTH_Y, z, FACE_DARK)
    ],
    wavy: [
      part(0.028, 0.022, d, -0.042, MOUTH_Y + 0.006, z, FACE_DARK),
      part(0.028, 0.022, d, -0.014, MOUTH_Y - 0.006, z, FACE_DARK),
      part(0.028, 0.022, d, 0.014, MOUTH_Y + 0.006, z, FACE_DARK),
      part(0.028, 0.022, d, 0.042, MOUTH_Y - 0.006, z, FACE_DARK)
    ]
  };
  const meshes = {};
  Object.entries(shapes).forEach(([name, parts]) => {
    const mesh = new THREE.Mesh(merge(parts), material);
    mesh.visible = name === "smile";
    meshes[name] = mesh;
  });
  return meshes;
}

// Augen in vier Lesarten: offen (mit Pupille, die blicken kann), fröhlich
// zugekniffen (^ ^), ausgeknockt (x x) und — über die Lider — geschlossen.
function buildEyes(material) {
  const z = FACE_Z + 0.02;
  const pupils = new THREE.Mesh(merge([
    part(0.052, 0.078, 0.02, -EYE.x, 0, 0, FACE_DARK),
    part(0.052, 0.078, 0.02, EYE.x, 0, 0, FACE_DARK),
    part(0.02, 0.022, 0.024, -EYE.x + 0.012, 0.018, 0.002, "#ffffff"),
    part(0.02, 0.022, 0.024, EYE.x + 0.012, 0.018, 0.002, "#ffffff")
  ]), material);
  pupils.position.set(0, EYE.y - 0.004, z);

  const arc = (side) => [
    part(0.04, 0.022, 0.02, side * EYE.x - 0.028, -0.012, 0, FACE_DARK, [0, 0, 0.6]),
    part(0.04, 0.022, 0.02, side * EYE.x + 0.028, -0.012, 0, FACE_DARK, [0, 0, -0.6]),
    part(0.026, 0.022, 0.02, side * EYE.x, 0.004, 0, FACE_DARK)
  ];
  const happy = new THREE.Mesh(merge([...arc(-1), ...arc(1)]), material);
  happy.position.set(0, EYE.y, z);
  happy.visible = false;

  const cross = (side) => [
    part(0.1, 0.022, 0.02, side * EYE.x, 0, 0, FACE_DARK, [0, 0, 0.75]),
    part(0.1, 0.022, 0.02, side * EYE.x, 0, 0, FACE_DARK, [0, 0, -0.75])
  ];
  const knocked = new THREE.Mesh(merge([...cross(-1), ...cross(1)]), material);
  knocked.position.set(0, EYE.y, z);
  knocked.visible = false;

  return { pupils, happy, knocked };
}

function buildAccessory(variant, material, color) {
  const style = ((variant % 4) + 4) % 4;
  const parts = [];
  if (style === 0) {
    // Ein Spross: Stiel und zwei Blätter. Er federt bei jeder Bewegung nach.
    parts.push(part(0.03, 0.1, 0.03, 0, 0.05, 0, "#3f9a4f"));
    parts.push(part(0.13, 0.022, 0.07, 0.055, 0.1, 0, LEAF, [0, 0, 0.45]));
    parts.push(part(0.09, 0.02, 0.055, -0.04, 0.085, 0, LEAF, [0, 0, -0.55]));
  } else if (style === 1) {
    // Ein Heiligenschein aus vier Stäben, schwebend.
    const r = 0.13;
    parts.push(part(r * 2, 0.024, 0.04, 0, 0.11, r, GOLD));
    parts.push(part(r * 2, 0.024, 0.04, 0, 0.11, -r, GOLD));
    parts.push(part(0.04, 0.024, r * 2, r, 0.11, 0, GOLD));
    parts.push(part(0.04, 0.024, r * 2, -r, 0.11, 0, GOLD));
  } else if (style === 2) {
    // Zwei Fühler mit Kugeln.
    [-1, 1].forEach((side) => {
      parts.push(part(0.025, 0.11, 0.025, side * 0.1, 0.055, 0, shiftColor(color, -0.12), [0, 0, side * -0.25]));
      parts.push(part(0.07, 0.07, 0.07, side * 0.125, 0.12, 0, GOLD));
    });
  } else {
    // Eine Krone mit drei Zacken.
    parts.push(part(0.26, 0.05, 0.22, 0, 0.025, 0, GOLD));
    [-1, 0, 1].forEach((position) => {
      parts.push(part(0.06, position === 0 ? 0.11 : 0.08, 0.06, position * 0.095, position === 0 ? 0.1 : 0.085, 0, GOLD));
    });
    parts.push(part(0.04, 0.04, 0.03, 0, 0.03, 0.115, "#ff5d8f"));
  }
  const mesh = new THREE.Mesh(merge(parts), material);
  mesh.castShadow = true;
  return { mesh, style };
}

// Baut eine Figur. Rückgabe ist die Gruppe, die Szenen positionieren und
// drehen; alles darunter bewegt der KinAnimator.
export function createKin(color, variant = 0) {
  const root = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const legColor = shiftColor(color, -0.14);
  const lightColor = shiftColor(color, 0.09);

  // Gerüst: liegt mit der Sohle auf -KIN_SOLE, damit der Ursprung wie früher
  // in der Körpermitte bleibt.
  const rig = new THREE.Group();
  rig.position.y = -KIN_SOLE;
  rig.rotation.order = "YXZ";
  root.add(rig);

  const legs = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.085, HIP, 0);
    const mesh = new THREE.Mesh(merge([
      part(0.11, 0.1, 0.12, 0, -0.05, -0.005, legColor),
      part(0.13, 0.055, 0.18, 0, -HIP + 0.0275, 0.025, SHOE)
    ]), material);
    mesh.castShadow = true;
    pivot.add(mesh);
    pivot.userData.side = side;
    rig.add(pivot);
    return pivot;
  });

  const torso = new THREE.Group();
  torso.position.y = HIP;
  torso.rotation.order = "YXZ";
  rig.add(torso);
  const torsoMesh = new THREE.Mesh(merge([
    part(TORSO.w, TORSO.h, TORSO.d, 0, TORSO.h / 2, 0, color),
    part(0.22, 0.11, 0.02, 0, 0.085, TORSO.d / 2 + 0.008, lightColor)
  ]), material);
  torsoMesh.castShadow = true;
  torso.add(torsoMesh);

  const arms = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * SHOULDER.x, SHOULDER.y, 0);
    const mesh = new THREE.Mesh(merge([
      part(0.08, 0.14, 0.09, 0, -0.06, 0, color),
      part(0.1, 0.085, 0.1, 0, -0.15, 0.004, lightColor)
    ]), material);
    mesh.castShadow = true;
    pivot.add(mesh);
    pivot.userData.side = side;
    torso.add(pivot);
    return pivot;
  });

  const head = new THREE.Group();
  head.position.y = NECK;
  head.rotation.order = "YXZ";
  torso.add(head);
  const headMesh = new THREE.Mesh(merge([
    part(HEAD.w, HEAD.h, HEAD.d, 0, HEAD.cy, 0, color),
    // Ein hellerer Streifen auf der Stirn fängt das Licht wie ein Scheitel.
    part(HEAD.w * 0.62, 0.02, HEAD.d * 0.5, 0, HEAD.cy + HEAD.h / 2 + 0.006, 0.02, lightColor),
    part(0.11, 0.13, 0.02, -EYE.x, EYE.y, FACE_Z + 0.004, "#ffffff"),
    part(0.11, 0.13, 0.02, EYE.x, EYE.y, FACE_Z + 0.004, "#ffffff"),
    part(0.065, 0.036, 0.02, -0.165, 0.1, FACE_Z + 0.002, CHEEK),
    part(0.065, 0.036, 0.02, 0.165, 0.1, FACE_Z + 0.002, CHEEK)
  ]), material);
  headMesh.castShadow = true;
  head.add(headMesh);

  const eyes = buildEyes(material);
  head.add(eyes.pupils, eyes.happy, eyes.knocked);

  // Lider in der Kopffarbe: sie fallen von oben über das Auge. Geschlossen
  // heisst hier wirklich zu — ein Blinzeln über skalierte Pupillen liess das
  // Weisse stehen und sah aus wie ein Wackelkontakt.
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, EYE.y + 0.068, FACE_Z + 0.03);
  const lids = new THREE.Mesh(merge([
    part(0.124, 0.14, 0.02, -EYE.x, -0.07, 0, color),
    part(0.124, 0.14, 0.02, EYE.x, -0.07, 0, color)
  ]), material);
  lids.scale.y = 0.001;
  lids.visible = false;
  lidPivot.add(lids);
  head.add(lidPivot);

  const brows = [1, -1].map((side) => {
    const brow = new THREE.Mesh(merge([part(0.09, 0.022, 0.02, 0, 0, 0, FACE_DARK)]), material);
    brow.position.set(side * EYE.x, EYE.y + 0.1, FACE_Z + 0.014);
    brow.userData.side = side;
    head.add(brow);
    return brow;
  });

  const mouths = buildMouths(material);
  Object.values(mouths).forEach((mesh) => head.add(mesh));

  const accessoryPivot = new THREE.Group();
  accessoryPivot.position.set(0, HEAD.cy + HEAD.h / 2, 0);
  const accessory = buildAccessory(variant, material, color);
  accessoryPivot.add(accessory.mesh);
  head.add(accessoryPivot);

  root.userData = {
    isKin: true,
    rig,
    torso,
    head,
    legs,
    arms,
    eyes,
    lids,
    brows,
    mouths,
    accessory: accessoryPivot,
    accessoryStyle: accessory.style,
    material,
    materials: [material],
    color,
    variant,
    phase: Math.random() * Math.PI * 2,
    // Für ältere Szenen: `body` war das bewegte Innenleben der alten Figur.
    body: rig
  };
  return root;
}

// Name der alten Fabrik, damit keine Szene umgeschrieben werden muss.
export const createVoxelKin = createKin;

// Deckkraft der ganzen Figur. Durchsichtig wird das Material nur, solange es
// nötig ist — ein dauerhaft "transparentes" Material wird sortiert und kostet,
// auch wenn es voll deckt.
export function setKinOpacity(kin, opacity) {
  const value = Math.max(0, Math.min(1, opacity));
  (kin.userData.materials || []).forEach((material) => {
    const transparent = value < 0.999;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.depthWrite = !transparent;
      material.needsUpdate = true;
    }
    material.opacity = value;
  });
}

// Kurzes Aufleuchten, etwa bei einem Treffer. Stärke 0 schaltet es ab.
export function flashKin(kin, color = "#ffffff", strength = 0.6) {
  const material = kin.userData.material;
  if (!material) return;
  material.emissive.set(color);
  material.emissiveIntensity = strength;
}

// --- Posen ------------------------------------------------------------------
// Eine Pose ist ein Satz Gelenkwerte. Jeder Zustand ist eine Funktion, die zu
// einem Zeitpunkt eine Pose beschreibt; der Animator blendet zwischen ihnen.
//
//   y       Hub der ganzen Figur (Welt-Einheiten)
//   sq      Stauchen/Strecken (1 = normal), volumenerhaltend
//   lean    Vorlage aus der Sohle heraus (+ = nach vorn)
//   tilt    Seitenneigung        yaw     Drehung der ganzen Figur
//   crouch  wie tief die Hüfte sinkt (Welt-Einheiten)
//   tX tY tZ  Rumpf: beugen, verdrehen, zur Seite
//   hX hY hZ  Kopf: nicken (+ = runter), drehen, neigen
//   aLr aLs   linker Arm: heben (seitlich), schwingen (nach vorn)
//   aRr aRs   rechter Arm, ebenso
//   lL lR     Beine nach vorn     lLs lRs  Beine gespreizt
//   eyeX eyeY Blick (-1..1)       blink    Lider (0 offen, 1 zu)
//   brow      + = böse/konzentriert, - = traurig   browY  hochgezogen
//   mouth     smile grin open o frown flat wavy
//   eyes      open happy x spiral
const CHANNELS = [
  "y", "sq", "lean", "tilt", "yaw", "crouch",
  "tX", "tY", "tZ", "hX", "hY", "hZ",
  "aLr", "aLs", "aRr", "aRs", "lL", "lR", "lLs", "lRs",
  "eyeX", "eyeY", "blink", "brow", "browY"
];
const UPPER = ["tX", "tY", "tZ", "hX", "hY", "hZ", "aLr", "aLs", "aRr", "aRs", "eyeX", "eyeY", "brow", "browY"];

function neutral(p) {
  p.y = 0; p.sq = 1; p.lean = 0; p.tilt = 0; p.yaw = 0; p.crouch = 0;
  p.tX = 0; p.tY = 0; p.tZ = 0; p.hX = 0; p.hY = 0; p.hZ = 0;
  p.aLr = 0.2; p.aLs = 0; p.aRr = 0.2; p.aRs = 0;
  p.lL = 0; p.lR = 0; p.lLs = 0; p.lRs = 0;
  p.eyeX = 0; p.eyeY = 0; p.blink = 0; p.brow = 0; p.browY = 0;
  p.mouth = "smile"; p.eyes = "open";
  return p;
}

function newPose() {
  return neutral({});
}

function copyPose(into, from) {
  for (let i = 0; i < CHANNELS.length; i += 1) into[CHANNELS[i]] = from[CHANNELS[i]];
  into.mouth = from.mouth;
  into.eyes = from.eyes;
  return into;
}

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;
const abs = Math.abs;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const x = clamp01(v); return x * x * (3 - 2 * x); };
const easeOut = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const easeIn = (v) => Math.pow(clamp01(v), 2);
// Ein weicher Puls: 0 → 1 → 0 über das Intervall [a, b] von u.
const bump = (u, a, b) => (u <= a || u >= b ? 0 : sin(((u - a) / (b - a)) * Math.PI));

// Gesichter, die Zustände und Szenen benutzen.
const FACES = {
  neutral: { mouth: "smile", eyes: "open", brow: 0, browY: 0, blink: 0 },
  happy: { mouth: "grin", eyes: "open", brow: -0.1, browY: 0.2, blink: 0 },
  joy: { mouth: "grin", eyes: "happy", brow: -0.1, browY: 0.3, blink: 0 },
  sad: { mouth: "frown", eyes: "open", brow: -0.7, browY: 0.1, blink: 0.3 },
  focus: { mouth: "flat", eyes: "open", brow: 0.55, browY: 0, blink: 0.12 },
  effort: { mouth: "flat", eyes: "open", brow: 0.8, browY: 0, blink: 0.35 },
  angry: { mouth: "frown", eyes: "open", brow: 0.9, browY: 0, blink: 0.15 },
  surprised: { mouth: "o", eyes: "open", brow: -0.2, browY: 0.9, blink: 0 },
  scared: { mouth: "open", eyes: "open", brow: -0.6, browY: 0.7, blink: 0 },
  dizzy: { mouth: "wavy", eyes: "spiral", brow: -0.3, browY: 0.2, blink: 0 },
  ko: { mouth: "o", eyes: "x", brow: 0, browY: 0.3, blink: 0 },
  sleepy: { mouth: "flat", eyes: "open", brow: -0.2, browY: 0, blink: 0.7 },
  smug: { mouth: "smile", eyes: "open", brow: 0.35, browY: 0.1, blink: 0.3 }
};

function face(p, name) {
  const f = FACES[name] || FACES.neutral;
  p.mouth = f.mouth; p.eyes = f.eyes; p.brow = f.brow; p.browY = f.browY; p.blink = f.blink;
}

// Beinarbeit beim Gehen/Laufen: `c` ist die Phase in Radiant.
function stride(p, c, legAmp, armAmp) {
  const s = sin(c);
  p.lL = s * legAmp;
  p.lR = -s * legAmp;
  p.aLs = -s * armAmp;
  p.aRs = s * armAmp;
}

// Jeder Zustand: pose(p, t, a) mit t = Sekunden seit Beginn, a = Animator.
// `a.now` ist die Uhr in Sekunden, `a.cycle` die mit `rate` laufende Uhr.
// dur: Dauer eines einmaligen Zustands (danach zurück zur Grundhaltung).
// upper: nur Oberkörper — wird über die laufende Grundhaltung gelegt.
// blend: Überblendzeit in Sekunden.
const STATES = {
  idle: {
    blend: 0.22,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const breath = sin(n * 2.4);
      p.sq = 1 + breath * 0.016;
      p.y = breath * 0.004;
      p.tilt = sin(n * 0.53) * 0.03;
      // Umschauen: der Blick geht voraus, der Kopf folgt.
      const look = sin(n * 0.33) * 0.8 + sin(n * 0.9 + 1.3) * 0.3;
      p.eyeX = Math.max(-1, Math.min(1, look));
      p.hY = look * 0.22;
      p.hX = sin(n * 0.43) * 0.05;
      p.hZ = sin(n * 0.61 + 0.7) * 0.05;
      p.aLr = 0.2 + sin(n * 2.4) * 0.04;
      p.aRr = 0.2 + sin(n * 2.4 + 1.5) * 0.04;
      // Gewicht verlagern, alle paar Sekunden.
      const shift = sin(n * 0.37);
      p.tilt += shift * 0.035;
      p.lLs = Math.max(0, shift) * 0.08;
      p.lRs = Math.max(0, -shift) * 0.08;
      // Und hin und wieder ein kleiner Hopser, damit niemand eingefroren wirkt.
      const cycle = (n * 0.22) % 1;
      const hop = bump(cycle, 0, 0.09);
      p.y += hop * 0.08;
      p.sq *= 1 + hop * 0.06 - bump(cycle, 0.09, 0.13) * 0.05;
      p.lL = hop * 0.3;
      p.lR = -hop * 0.3;
    }
  },
  walk: {
    blend: 0.18,
    pose(p, t, a) {
      const c = a.cycle * TAU * 1.9 + a.phase;
      stride(p, c, 0.55, 0.42);
      p.y = abs(sin(c)) * 0.025;
      p.lean = 0.08;
      p.tilt = sin(c) * 0.04;
      p.tY = sin(c) * 0.09;
      p.hY = -sin(c) * 0.06;
      p.aLr = 0.16;
      p.aRr = 0.16;
    }
  },
  run: {
    blend: 0.16,
    pose(p, t, a) {
      const c = a.cycle * TAU * 3.1 + a.phase;
      stride(p, c, 1.0, 0.95);
      const up = abs(sin(c));
      p.y = up * 0.07;
      p.sq = 0.97 + up * 0.07;
      p.lean = 0.24;
      p.tilt = sin(c) * 0.06;
      p.tY = sin(c) * 0.15;
      p.hX = -0.14;
      p.hY = -sin(c) * 0.08;
      p.aLr = 0.26;
      p.aRr = 0.26;
      face(p, "happy");
      p.brow = 0.2;
    }
  },
  sprint: {
    blend: 0.14,
    pose(p, t, a) {
      const c = a.cycle * TAU * 3.8 + a.phase;
      stride(p, c, 1.2, 1.25);
      const up = abs(sin(c));
      p.y = up * 0.08;
      p.sq = 0.96 + up * 0.09;
      p.lean = 0.38;
      p.tilt = sin(c) * 0.05;
      p.tY = sin(c) * 0.2;
      p.hX = -0.26;
      p.aLr = 0.3;
      p.aRr = 0.3;
      face(p, "effort");
      p.mouth = "open";
    }
  },
  jump: {
    dur: 0.72,
    blend: 0.06,
    pose(p, t, a) {
      const u = t / 0.72;
      const height = a.params.height ?? 0.6;
      if (u < 0.14) {
        const c = u / 0.14;
        p.crouch = 0.05 * c;
        p.sq = 1 - 0.14 * c;
        p.aLs = -0.7 * c;
        p.aRs = -0.7 * c;
        p.lean = 0.15 * c;
        face(p, "focus");
      } else if (u < 0.86) {
        const air = (u - 0.14) / 0.72;
        const lift = sin(air * Math.PI);
        p.y = height * lift;
        p.sq = 1 + 0.16 * (1 - air) * (air < 0.5 ? 1 : 0.3);
        p.aLr = 2.3 - air * 0.8;
        p.aRr = 2.3 - air * 0.8;
        p.lL = 0.55 * lift;
        p.lR = 0.35 * lift;
        p.lean = -0.05;
        face(p, "happy");
        p.browY = 0.4;
      } else {
        const l = (u - 0.86) / 0.14;
        const squash = sin(l * Math.PI);
        p.sq = 1 - 0.18 * squash;
        p.crouch = 0.04 * squash;
        p.aLr = 0.9 - l * 0.6;
        p.aRr = 0.9 - l * 0.6;
        face(p, "happy");
      }
    }
  },
  hop: {
    dur: 0.42,
    blend: 0.05,
    pose(p, t, a) {
      const u = t / 0.42;
      const lift = bump(u, 0.12, 0.85);
      p.y = lift * (a.params.height ?? 0.24);
      const squash = bump(u, 0, 0.14) + bump(u, 0.85, 1);
      p.sq = 1 - squash * 0.13 + lift * 0.08;
      p.crouch = squash * 0.03;
      p.aLr = 0.3 + lift * 0.9;
      p.aRr = 0.3 + lift * 0.9;
      p.lL = lift * 0.3;
      p.lR = lift * 0.2;
      face(p, "happy");
    }
  },
  land: {
    dur: 0.3,
    blend: 0.03,
    pose(p, t) {
      const squash = sin(clamp01(t / 0.3) * Math.PI);
      p.sq = 1 - squash * 0.2;
      p.crouch = squash * 0.05;
      p.aLr = 0.2 + squash * 0.9;
      p.aRr = 0.2 + squash * 0.9;
      face(p, "surprised");
    }
  },
  stumble: {
    dur: 0.9,
    blend: 0.05,
    pose(p, t, a) {
      const u = clamp01(t / 0.9);
      const wob = sin(u * Math.PI * 3) * (1 - u);
      p.lean = 0.5 * (1 - u) + wob * 0.15;
      p.tilt = wob * 0.3;
      p.aLr = 1.2 + sin(u * 22) * 0.8 * (1 - u);
      p.aRr = 1.2 + cos(u * 22) * 0.8 * (1 - u);
      p.aLs = sin(u * 17) * 0.8;
      p.aRs = -sin(u * 17) * 0.8;
      p.lL = wob * 0.6;
      p.lR = -wob * 0.4;
      p.y = -sin(u * Math.PI) * 0.03;
      face(p, "surprised");
      p.mouth = "open";
    }
  },
  hit: {
    dur: 0.55,
    blend: 0.03,
    pose(p, t) {
      const u = clamp01(t / 0.55);
      const shock = 1 - u;
      p.lean = -0.45 * shock;
      p.sq = 1 - 0.14 * shock;
      p.tilt = sin(u * 30) * 0.12 * shock;
      p.aLr = 0.2 + 1.5 * shock;
      p.aRr = 0.2 + 1.5 * shock;
      p.aLs = -0.4 * shock;
      p.aRs = -0.4 * shock;
      p.hX = -0.3 * shock;
      face(p, u < 0.65 ? "ko" : "sad");
    }
  },
  fall: {
    dur: 1.6,
    blend: 0.05,
    pose(p, t) {
      const u = clamp01(t / 1.6);
      let lie;
      if (u < 0.22) lie = easeIn(u / 0.22);
      else if (u < 0.7) lie = 1;
      else lie = 1 - smooth((u - 0.7) / 0.3);
      p.lean = lie * (Math.PI / 2 - 0.1);
      p.aLr = 0.2 + lie * 1.3;
      p.aRr = 0.2 + lie * 1.3;
      p.lL = -lie * 0.25;
      p.lR = -lie * 0.35;
      if (u >= 0.7) {
        const up = (u - 0.7) / 0.3;
        p.y = sin(up * Math.PI) * 0.1;
        p.hY = sin(up * 18) * 0.3 * (1 - up);
      }
      if (u > 0.2 && u < 0.72) p.sq = 1 - bump(u, 0.2, 0.3) * 0.15;
      face(p, u < 0.75 ? "ko" : "dizzy");
    }
  },
  knockback: {
    dur: 1.1,
    blend: 0.03,
    pose(p, t) {
      const u = clamp01(t / 1.1);
      const roll = easeOut(u / 0.7);
      p.lean = -roll * TAU;
      p.y = sin(clamp01(u / 0.7) * Math.PI) * 0.45;
      p.aLr = 1.6;
      p.aRr = 1.6;
      p.lL = 0.6;
      p.lR = 0.6;
      if (u > 0.7) p.sq = 1 - bump(u, 0.7, 0.9) * 0.2;
      face(p, u < 0.8 ? "ko" : "dizzy");
    }
  },
  tumble: {
    dur: 1.25,
    blend: 0.04,
    pose(p, t) {
      const u = clamp01(t / 1.25);
      p.yaw = easeOut(u) * TAU * 2;
      p.tilt = sin(u * Math.PI * 4) * 0.35 * (1 - u);
      p.lean = sin(u * Math.PI * 3) * 0.3 * (1 - u);
      p.y = bump(u, 0, 0.5) * 0.3;
      p.aLr = 1.8;
      p.aRr = 1.8;
      face(p, "dizzy");
    }
  },
  spin: {
    dur: 0.62,
    blend: 0.05,
    pose(p, t) {
      const u = clamp01(t / 0.62);
      p.yaw = easeOut(u) * TAU;
      p.y = bump(u, 0, 1) * 0.16;
      p.aLr = 1.4;
      p.aRr = 1.4;
      face(p, "joy");
    }
  },
  spawn: {
    dur: 0.85,
    blend: 0.01,
    pose(p, t) {
      const u = clamp01(t / 0.85);
      if (u < 0.42) {
        const f = u / 0.42;
        p.y = (1 - easeIn(f)) * 2.4;
        p.aLr = 2.35;
        p.aRr = 2.35;
        p.lL = 0.4;
        p.lR = -0.2;
        face(p, "surprised");
      } else {
        const l = (u - 0.42) / 0.58;
        const squash = bump(l, 0, 0.35);
        const rebound = bump(l, 0.3, 0.75);
        p.sq = 1 - squash * 0.32 + rebound * 0.1;
        p.crouch = squash * 0.06;
        p.y = rebound * 0.18;
        p.aLr = 0.3 + rebound * 1.8;
        p.aRr = 0.3 + rebound * 1.8;
        face(p, l < 0.3 ? "ko" : "joy");
      }
    }
  },
  taunt: {
    dur: 1.2,
    blend: 0.08,
    pose(p, t) {
      const u = clamp01(t / 1.2);
      const turn = smooth(u / 0.2) - smooth((u - 0.8) / 0.2);
      p.yaw = turn * Math.PI;
      p.tilt = sin(u * 30) * 0.18 * bump(u, 0.2, 0.8);
      p.lean = 0.25 * turn;
      p.aLr = 0.6;
      p.aRr = 0.6;
      face(p, "smug");
      p.mouth = "grin";
    }
  },

  // --- Ergebnis: jeder Platz reagiert eigen ------------------------------
  cheer: {
    blend: 0.12,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const hop = abs(sin(n * 6.6));
      p.y = hop * 0.32;
      p.sq = 1 - (1 - hop) * 0.06 + hop * 0.12;
      p.aLr = 2.35 + sin(n * 13) * 0.3;
      p.aRr = 2.35 + sin(n * 13 + 1.6) * 0.3;
      p.lL = hop * 0.45;
      p.lR = -hop * 0.35;
      p.yaw = sin(n * 3.3) * 0.4;
      p.tilt = sin(n * 4.4) * 0.1;
      p.hX = -0.2;
      face(p, "joy");
      if (sin(n * 1.1) > 0.4) p.eyes = "open";
    }
  },
  victory: {
    blend: 0.12,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const cycle = (n / 1.7) % 1;
      const pump = abs(sin(n * 7));
      // Faust nach oben, im Takt.
      p.aRr = 2.2 + pump * 0.6;
      p.aRs = 0.3;
      p.aLr = 0.6 + pump * 0.3;
      p.aLs = 0.9;
      p.y = pump * 0.1;
      p.hX = -0.18;
      p.tZ = sin(n * 3.5) * 0.08;
      // Jeder zweite Takt ein Luftsprung mit Drehung.
      const jump = bump(cycle, 0.55, 0.95);
      p.y += jump * 0.5;
      p.yaw = smooth((cycle - 0.55) / 0.4) * TAU * (cycle > 0.55 ? 1 : 0);
      if (jump > 0) {
        p.aLr = 2.35;
        p.aRr = 2.35;
        p.lL = jump * 0.5;
        p.lR = jump * 0.5;
      }
      face(p, "joy");
      if (cycle < 0.5) p.eyes = "open";
    }
  },
  happy: {
    blend: 0.15,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const beat = abs(sin(n * 4.4));
      p.y = beat * 0.12;
      p.sq = 1 + beat * 0.05;
      // Klatschen: beide Hände vorn, im Takt zusammen.
      const clap = (sin(n * 8.8) + 1) / 2;
      p.aLs = 1.25;
      p.aRs = 1.25;
      p.aLr = 0.15 + clap * 0.45;
      p.aRr = 0.15 + clap * 0.45;
      p.tilt = sin(n * 2.2) * 0.07;
      p.hZ = sin(n * 2.2) * 0.1;
      face(p, "happy");
    }
  },
  shrug: {
    blend: 0.2,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const cycle = (n / 2.6) % 1;
      const up = bump(cycle, 0.05, 0.45);
      p.aLr = 0.35 + up * 0.75;
      p.aRr = 0.35 + up * 0.75;
      p.aLs = 0.4 + up * 0.4;
      p.aRs = 0.4 + up * 0.4;
      p.y = up * 0.03;
      p.hZ = 0.2 * up + sin(n * 0.7) * 0.05;
      p.hY = sin(n * 0.5) * 0.25;
      p.eyeX = sin(n * 0.5) * 0.8;
      face(p, "neutral");
      p.mouth = up > 0.3 ? "flat" : "smile";
      p.brow = -0.3 * up;
      p.browY = 0.4 * up;
    }
  },
  sad: {
    blend: 0.3,
    pose(p, t, a) {
      const n = a.now + a.phase;
      // Kopf hängt, aber nicht so tief, dass die Kamera nur noch den Scheitel
      // sieht — die meisten Szenen schauen von schräg oben.
      p.lean = 0.16;
      p.hX = 0.24;
      p.crouch = 0.025;
      p.sq = 0.97;
      p.aLr = 0.06;
      p.aRr = 0.06;
      p.tilt = sin(n * 0.8) * 0.04;
      p.hZ = sin(n * 0.8) * 0.06;
      // Ein Seufzer alle paar Sekunden.
      const sigh = bump((n * 0.3) % 1, 0, 0.12);
      p.sq -= sigh * 0.05;
      p.y -= sigh * 0.01;
      face(p, "sad");
    }
  },
  defeat: {
    blend: 0.35,
    pose(p, t, a) {
      const n = a.now + a.phase;
      // Zusammengesackt auf dem Hosenboden, Beine nach vorn. Knien las sich aus
      // der üblichen Kamerahöhe wie "im Boden versunken": der Kopf lag auf dem
      // Rasen, der Rumpf dahinter war weg.
      p.crouch = 0.13;
      p.lL = 1.4;
      p.lR = 1.3;
      p.lLs = 0.12;
      p.lRs = 0.12;
      p.lean = 0.14;
      p.hX = 0.26;
      p.aLr = 0.35;
      p.aRr = 0.35;
      p.aLs = 0.15;
      p.aRs = 0.15;
      p.sq = 0.96;
      const sob = sin(n * 11) * bump((n * 0.35) % 1, 0, 0.3);
      p.y = sob * 0.012;
      p.hZ = sin(n * 0.6) * 0.08;
      face(p, "sad");
      p.blink = 0.55;
    }
  },
  dance: {
    blend: 0.15,
    pose(p, t, a) {
      const n = (a.now + a.phase) * (a.params.tempo ?? 1);
      const beat = n * 4.2;
      const bounce = abs(sin(beat));
      p.y = bounce * 0.1;
      p.sq = 0.97 + bounce * 0.07;
      const side = sin(beat / 2);
      p.tilt = side * 0.15;
      p.yaw = sin(beat / 4) * 0.35;
      p.aLr = side > 0 ? 2.4 : 0.5;
      p.aRr = side > 0 ? 0.5 : 2.4;
      p.aLs = sin(beat) * 0.3;
      p.aRs = -sin(beat) * 0.3;
      p.lLs = Math.max(0, side) * 0.25;
      p.lRs = Math.max(0, -side) * 0.25;
      p.hZ = side * 0.2;
      p.hX = -bounce * 0.12;
      face(p, "joy");
      if (sin(beat / 2) < -0.3) p.eyes = "open";
    }
  },
  wave: {
    blend: 0.15,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.aLr = 2.35 + sin(n * 12) * 0.32;
      p.aLs = 0.2;
      p.hZ = -0.15;
      p.tilt = -0.05;
      p.y = abs(sin(n * 3)) * 0.02;
      face(p, "happy");
    }
  },
  clap: {
    blend: 0.12,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const clap = (sin(n * 10) + 1) / 2;
      p.aLs = 1.3;
      p.aRs = 1.3;
      p.aLr = 0.1 + clap * 0.5;
      p.aRr = 0.1 + clap * 0.5;
      p.y = abs(sin(n * 5)) * 0.03;
      face(p, "happy");
    }
  },

  // --- Haltungen während des Spiels ---------------------------------------
  ready: {
    blend: 0.18,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const bounce = abs(sin(n * 5));
      p.y = bounce * 0.025;
      p.crouch = 0.04;
      p.lean = 0.14;
      p.aLs = 0.55;
      p.aRs = 0.55;
      p.aLr = 0.3;
      p.aRr = 0.3;
      p.lLs = 0.1;
      p.lRs = 0.1;
      face(p, "focus");
      p.mouth = "grin";
    }
  },
  focus: {
    blend: 0.2,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.crouch = 0.025;
      p.lean = 0.1;
      p.aLs = 0.35;
      p.aRs = 0.35;
      p.aLr = 0.22;
      p.aRr = 0.22;
      p.hX = -0.05;
      p.tilt = sin(n * 0.9) * 0.015;
      face(p, "focus");
    }
  },
  think: {
    blend: 0.22,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.aRs = 1.9;
      p.aRr = 0.55;
      p.aLs = 0.5;
      p.aLr = 0.45;
      p.hZ = 0.18;
      p.hX = -0.15;
      p.eyeY = 0.8;
      p.eyeX = 0.5 + sin(n * 0.8) * 0.3;
      p.tilt = sin(n * 0.7) * 0.03;
      face(p, "focus");
      p.brow = 0.1;
      p.browY = 0.3;
    }
  },
  balance: {
    blend: 0.18,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const wob = sin(n * 5.6) * 0.6 + sin(n * 8.9 + 1) * 0.4;
      p.tilt = wob * 0.12 * (a.params.wobble ?? 1);
      p.aLr = 1.5 - wob * 0.35;
      p.aRr = 1.5 + wob * 0.35;
      p.lLs = 0.14;
      p.lRs = 0.14;
      p.crouch = 0.02;
      p.hZ = -wob * 0.1;
      face(p, "focus");
      p.mouth = abs(wob) > 0.7 ? "o" : "flat";
    }
  },
  float: {
    blend: 0.25,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.y = sin(n * 2.2) * 0.05;
      p.aLr = 1.1 + sin(n * 3.3) * 0.22;
      p.aRr = 1.1 + sin(n * 3.3 + 0.5) * 0.22;
      p.lL = 0.25 + sin(n * 2.4) * 0.2;
      p.lR = 0.25 - sin(n * 2.4) * 0.2;
      p.lean = 0.05;
      p.hZ = sin(n * 1.3) * 0.08;
      face(p, "happy");
    }
  },
  fly: {
    blend: 0.2,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.lean = 1.2;
      p.aLr = 0.5;
      p.aRr = 0.5;
      p.aLs = 2.8;
      p.aRs = 2.8;
      p.lL = -0.25 + sin(n * 9) * 0.08;
      p.lR = -0.25 - sin(n * 9) * 0.08;
      p.tilt = sin(n * 2.1) * 0.1;
      p.hX = -0.9;
      face(p, "joy");
      p.eyes = "open";
    }
  },
  sit: {
    blend: 0.25,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.crouch = 0.13;
      p.lL = 1.45;
      p.lR = 1.45;
      p.lean = -0.06;
      p.aLr = 0.35;
      p.aRr = 0.35;
      p.aLs = 0.35;
      p.aRs = 0.35;
      p.tilt = sin(n * 0.8) * 0.03;
      p.hY = sin(n * 0.4) * 0.2;
      face(p, "neutral");
    }
  },
  ride: {
    blend: 0.2,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.crouch = 0.05;
      p.lean = 0.18;
      p.aLs = 1.0;
      p.aRs = 1.0;
      p.aLr = 0.35;
      p.aRr = 0.35;
      p.lL = 0.35;
      p.lR = 0.35;
      p.tilt = sin(n * 3) * 0.04;
      face(p, "happy");
    }
  },
  climb: {
    blend: 0.12,
    pose(p, t, a) {
      const c = a.cycle * TAU * 1.6 + a.phase;
      const s = sin(c);
      p.aLr = 2.25 + s * 0.45;
      p.aRr = 2.25 - s * 0.45;
      p.aLs = 0.45;
      p.aRs = 0.45;
      p.lL = Math.max(0, s) * 0.7;
      p.lR = Math.max(0, -s) * 0.7;
      p.y = abs(s) * 0.02;
      p.hX = -0.35;
      face(p, "effort");
    }
  },
  // Schieben im Gehen: Hände vorn am Griff, Beine im Schritt — Farbroller,
  // Schubkarre, Rasenmäher. Das Tempo kommt wie beim Laufen über `rate`.
  shove: {
    blend: 0.12,
    pose(p, t, a) {
      const c = a.cycle * TAU * 1.9 + a.phase;
      stride(p, c, 0.75, 0);
      p.aLs = 1.2;
      p.aRs = 1.2;
      p.aLr = 0.12;
      p.aRr = 0.12;
      p.lean = 0.28;
      p.y = abs(sin(c)) * 0.03;
      face(p, "effort");
      p.mouth = "grin";
    }
  },
  // Klettern Griff für Griff: `params.up` sagt, welcher Arm gerade oben
  // greift (-1 links, 1 rechts, im Gerüst gesehen), `params.grab` läuft nach
  // jedem Griff von 1 auf 0 — der Körper zieht sich dabei ein Stück hoch.
  clamber: {
    blend: 0.09,
    pose(p, t, a) {
      const up = a.params.up ?? 1;
      const g = a.params.grab ?? 0;
      const n = a.now + a.phase;
      const leftUp = up < 0;
      p.aLr = leftUp ? 2.75 : 1.7 + g * 0.25;
      p.aRr = leftUp ? 1.7 + g * 0.25 : 2.75;
      p.aLs = leftUp ? 0.2 : 0.5;
      p.aRs = leftUp ? 0.5 : 0.2;
      p.lL = leftUp ? 0.1 : 0.9 - g * 0.3;
      p.lR = leftUp ? 0.9 - g * 0.3 : 0.1;
      p.tilt = up * 0.07 * (0.5 + g);
      p.y = g * 0.06 + sin(n * 2.1) * 0.012;
      p.hX = -0.32;
      face(p, "effort");
    }
  },
  hang: {
    blend: 0.15,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.aLr = 2.35;
      p.aRr = 2.35;
      p.lL = 0.2 + sin(n * 2.2) * 0.15;
      p.lR = 0.1 - sin(n * 2.2) * 0.15;
      p.tilt = sin(n * 1.7) * 0.05;
      p.hX = -0.3;
      face(p, "effort");
    }
  },
  pull: {
    blend: 0.15,
    pose(p, t, a) {
      const c = a.cycle * TAU * 1.8 + a.phase;
      const s = sin(c);
      p.lean = -0.28;
      p.crouch = 0.04;
      p.aLs = 1.15 + s * 0.3;
      p.aRs = 1.15 - s * 0.3;
      p.aLr = 0.3;
      p.aRr = 0.3;
      p.lL = 0.35;
      p.lR = -0.1;
      p.tY = s * 0.1;
      face(p, "effort");
    }
  },
  brace: {
    blend: 0.15,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.crouch = 0.075;
      p.lLs = 0.28;
      p.lRs = 0.28;
      p.lean = 0.22;
      p.aLs = 0.95;
      p.aRs = 0.95;
      p.aLr = 0.5;
      p.aRr = 0.5;
      p.tilt = sin(n * 1.4) * 0.03;
      face(p, "focus");
    }
  },
  charge: {
    blend: 0.12,
    pose(p, t, a) {
      const n = a.now;
      const power = clamp01(a.params.power ?? 1);
      p.crouch = 0.06 + power * 0.04;
      p.lLs = 0.25;
      p.lRs = 0.25;
      p.lean = 0.18 + power * 0.1;
      p.aLs = -0.4 - power * 0.5;
      p.aRs = -0.4 - power * 0.5;
      p.aLr = 0.5;
      p.aRr = 0.5;
      p.sq = 1 - power * 0.06;
      p.tilt = sin(n * 48) * 0.02 * (0.3 + power);
      face(p, "effort");
      p.brow = 0.5 + power * 0.4;
    }
  },
  slide: {
    blend: 0.15,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.crouch = 0.08;
      p.lean = 0.35;
      p.aLs = -0.8;
      p.aRs = -0.8;
      p.aLr = 0.45;
      p.aRr = 0.45;
      p.lL = 0.5;
      p.lR = -0.4;
      p.tilt = sin(n * 2) * 0.04;
      face(p, "happy");
    }
  },
  aim: {
    blend: 0.15,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.aRs = 1.45;
      p.aRr = 0.12;
      p.aLs = -0.35;
      p.aLr = 0.35;
      p.tY = -0.25;
      p.hY = 0.2;
      p.lL = 0.25;
      p.lR = -0.15;
      p.tilt = sin(n * 1.2) * 0.02;
      face(p, "focus");
      p.blink = 0.3;
    }
  },
  sneak: {
    blend: 0.15,
    pose(p, t, a) {
      const c = a.cycle * TAU * 1.5 + a.phase;
      stride(p, c, 0.4, 0.1);
      p.crouch = 0.06;
      p.lean = 0.3;
      p.aLs = 0.65;
      p.aRs = 0.65;
      p.aLr = 0.55;
      p.aRr = 0.55;
      p.y = abs(sin(c)) * 0.012;
      p.eyeX = sin(c * 0.25) * 0.9;
      face(p, "focus");
      p.mouth = "o";
    }
  },
  freeze: {
    blend: 0.06,
    pose(p, t, a) {
      const n = a.now;
      p.lL = 0.45;
      p.lR = -0.3;
      p.aLs = -0.55;
      p.aRs = 0.6;
      p.aLr = 0.35;
      p.aRr = 0.35;
      p.lean = 0.1;
      p.tilt = sin(n * 40) * 0.006;
      face(p, "scared");
      p.mouth = "flat";
    }
  },
  cower: {
    blend: 0.1,
    pose(p, t, a) {
      const n = a.now;
      p.crouch = 0.08;
      p.lean = 0.32;
      p.aLr = 2.3;
      p.aRr = 2.3;
      p.aLs = 0.7;
      p.aRs = 0.7;
      p.hX = 0.3;
      p.tilt = sin(n * 38) * 0.03;
      face(p, "scared");
      p.blink = 0.75;
    }
  },
  panic: {
    blend: 0.1,
    pose(p, t, a) {
      const n = a.now + a.phase;
      const c = n * TAU * 4.5;
      p.lL = sin(c) * 0.8;
      p.lR = -sin(c) * 0.8;
      p.y = abs(sin(c)) * 0.05;
      p.aLr = 2.3 + sin(n * 17) * 0.5;
      p.aRr = 2.3 + cos(n * 19) * 0.5;
      p.aLs = sin(n * 13) * 0.6;
      p.aRs = cos(n * 11) * 0.6;
      p.tilt = sin(n * 9) * 0.1;
      p.hY = sin(n * 7) * 0.35;
      face(p, "scared");
    }
  },
  dizzy: {
    blend: 0.2,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.tilt = sin(n * 4) * 0.18;
      p.lean = cos(n * 4) * 0.12;
      p.hZ = sin(n * 4 + 0.6) * 0.2;
      p.aLr = 0.5 + sin(n * 4) * 0.4;
      p.aRr = 0.5 - sin(n * 4) * 0.4;
      p.lLs = 0.12;
      p.lRs = 0.12;
      face(p, "dizzy");
    }
  },
  carry: {
    blend: 0.15,
    pose(p, t, a) {
      const n = a.now + a.phase;
      p.aLr = 2.35;
      p.aRr = 2.35;
      p.aLs = 0.25;
      p.aRs = 0.25;
      p.crouch = 0.02;
      p.sq = 0.98 + sin(n * 3) * 0.01;
      face(p, "effort");
    }
  },
  pump: {
    dur: 0.3,
    blend: 0.03,
    pose(p, t) {
      const u = clamp01(t / 0.3);
      const down = bump(u, 0, 0.55);
      const up = bump(u, 0.45, 1);
      p.crouch = down * 0.08;
      p.sq = 1 - down * 0.14 + up * 0.06;
      p.aLs = 0.9 + down * 0.3;
      p.aRs = 0.9 + down * 0.3;
      p.aLr = 0.2;
      p.aRr = 0.2;
      p.lean = 0.2 * down;
      p.y = up * 0.05;
      face(p, "effort");
      p.mouth = down > 0.5 ? "open" : "grin";
    }
  },
  dig: {
    dur: 0.5,
    blend: 0.04,
    pose(p, t) {
      const u = clamp01(t / 0.5);
      const raise = u < 0.4 ? smooth(u / 0.4) : 1 - smooth((u - 0.4) / 0.2);
      p.aLs = 0.2 + raise * 2.3;
      p.aRs = 0.2 + raise * 2.3;
      p.aLr = 0.25;
      p.aRr = 0.25;
      const impact = bump(u, 0.55, 0.85);
      p.crouch = impact * 0.07;
      p.lean = 0.2 + impact * 0.25;
      p.sq = 1 - impact * 0.1;
      p.hX = impact * 0.25;
      face(p, "effort");
    }
  },
  push: {
    dur: 0.4,
    blend: 0.03,
    pose(p, t) {
      const u = clamp01(t / 0.4);
      const thrust = u < 0.3 ? easeOut(u / 0.3) : 1 - smooth((u - 0.3) / 0.7);
      p.aLs = 1.5 * thrust;
      p.aRs = 1.5 * thrust;
      p.aLr = 0.1;
      p.aRr = 0.1;
      p.lean = 0.35 * thrust;
      p.lL = 0.45 * thrust;
      p.lR = -0.2 * thrust;
      face(p, "effort");
      p.mouth = "open";
    }
  },
  celebrate: {
    dur: 0.9,
    blend: 0.05,
    pose(p, t) {
      const u = clamp01(t / 0.9);
      const lift = bump(u, 0.05, 0.6);
      p.y = lift * 0.4;
      p.aLr = 2.35;
      p.aRr = 2.35;
      p.yaw = easeOut(u / 0.7) * TAU;
      p.lL = lift * 0.4;
      p.lR = lift * 0.4;
      p.sq = 1 - bump(u, 0.6, 0.8) * 0.16;
      face(p, "joy");
    }
  },

  // --- Oberkörper: wird über die laufende Haltung gelegt --------------------
  throw: {
    dur: 0.46,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 0.46);
      if (u < 0.36) {
        const w = smooth(u / 0.36);
        p.aRs = -2.2 * w;
        p.aRr = 0.4 + w * 0.3;
        p.tY = -0.45 * w;
        p.aLs = 0.8 * w;
      } else {
        const r = easeOut((u - 0.36) / 0.3);
        p.aRs = -2.2 + r * 4.0;
        p.aRr = 0.7 - r * 0.4;
        p.tY = -0.45 + r * 0.85;
        p.aLs = 0.8 - r * 1.1;
      }
      face(p, "effort");
      p.mouth = "grin";
    }
  },
  tap: {
    dur: 0.2,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 0.2);
      const poke = bump(u, 0, 1);
      p.aRs = 0.3 + poke * 1.1;
      p.aRr = 0.15;
      p.tY = -0.08 * poke;
      face(p, "focus");
    }
  },
  reach: {
    dur: 0.34,
    upper: true,
    pose(p, t, a) {
      const u = clamp01(t / 0.34);
      const r = u < 0.4 ? easeOut(u / 0.4) : 1 - smooth((u - 0.4) / 0.6) * 0.5;
      if ((a.params.side ?? 1) > 0) {
        p.aLr = 0.2 + r * 2.7;
        p.aRr = 0.3;
      } else {
        p.aRr = 0.2 + r * 2.7;
        p.aLr = 0.3;
      }
      p.hX = -0.3;
      face(p, "effort");
    }
  },
  catch: {
    dur: 0.38,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 0.38);
      const up = bump(u, 0, 1);
      p.aLr = 0.3 + up * 1.9;
      p.aRr = 0.3 + up * 1.9;
      p.aLs = up * 0.6;
      p.aRs = up * 0.6;
      p.hX = -0.25 * up;
      face(p, u < 0.4 ? "surprised" : "happy");
    }
  },
  punch: {
    dur: 0.3,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 0.3);
      const jab = u < 0.35 ? easeOut(u / 0.35) : 1 - smooth((u - 0.35) / 0.65);
      p.aRs = 1.6 * jab;
      p.aRr = 0.1;
      p.tY = 0.35 * jab;
      p.aLs = 0.6;
      face(p, "effort");
    }
  },
  fistpump: {
    dur: 0.55,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 0.55);
      const pumpUp = bump(u, 0, 0.5) + bump(u, 0.45, 0.95) * 0.8;
      p.aRr = 1.6 + pumpUp * 1.1;
      p.aRs = 0.3;
      p.hX = -0.15;
      face(p, "joy");
    }
  },
  nod: {
    dur: 0.5,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 0.5);
      p.hX = sin(u * TAU * 2) * 0.25 * (1 - u);
      face(p, "happy");
    }
  },
  headshake: {
    dur: 0.6,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 0.6);
      p.hY = sin(u * TAU * 2.5) * 0.45 * (1 - u * 0.6);
      face(p, "sad");
    }
  },
  facepalm: {
    dur: 1.0,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 1.0);
      const w = smooth(u / 0.25) * (1 - smooth((u - 0.75) / 0.25));
      p.aRs = 2.2 * w;
      p.aRr = 0.5 * w + 0.2;
      p.hX = 0.3 * w;
      face(p, "sad");
      p.blink = 0.8 * w;
    }
  },
  flinch: {
    dur: 0.32,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 0.32);
      const f = bump(u, 0, 1);
      p.aLr = 0.2 + f * 1.4;
      p.aRr = 0.2 + f * 1.4;
      p.aLs = f * 0.7;
      p.aRs = f * 0.7;
      p.hX = 0.2 * f;
      face(p, "scared");
    }
  },
  wavehi: {
    dur: 1.1,
    upper: true,
    pose(p, t) {
      const u = clamp01(t / 1.1);
      const w = smooth(u / 0.15) * (1 - smooth((u - 0.85) / 0.15));
      p.aLr = 0.2 + w * (2.4 + sin(u * 38) * 0.3);
      p.aLs = 0.2 * w;
      p.hZ = -0.15 * w;
      face(p, "happy");
    }
  }
};

// Zustandsnamen, die ältere Szenen benutzen, auf die neuen abbilden.
const ALIASES = { room: "idle", stand: "idle" };

export const KIN_STATES = Object.keys(STATES);

// --- Animator -----------------------------------------------------------------
// Überblendet zwischen Zuständen und legt Oberkörper-Handlungen, Gesicht und
// Blick darüber. Nimmt jede Uhr in Millisekunden — Szenen reichen die mit dem
// Server abgeglichene Zeit durch, und alle einmaligen Zustände messen an ihr.
export class KinAnimator {
  constructor(kin) {
    this.kin = kin;
    this.parts = kin.userData;
    this.state = "idle";
    this.baseState = "idle";
    this.stateStart = null;
    this.groundY = kin.position.y;
    this.rate = 1;
    this.phase = kin.userData.phase ?? Math.random() * TAU;
    this.params = {};
    this.now = 0;
    this.cycle = 0;
    this.last = null;

    this.from = newPose();
    this.target = newPose();
    this.out = newPose();
    this.gesturePose = newPose();
    this.blendDur = 0.2;
    this.blendT = 1;

    this.gesture = null;
    this.faceOverride = null;
    this.lookPoint = null;
    this.lookManual = null;
    this.nextBlinkAt = 1 + Math.random() * 3;
    this.blinkT = -1;
    this.reduced = prefersReducedMotion();

    // Nachfedern: Kopf und Accessoire folgen der Bewegung mit Verzögerung.
    this.lag = { tilt: 0, lean: 0, y: 0, vy: 0 };
    this.acc = { x: 0, z: 0, vx: 0, vz: 0 };
    this.prevY = 0;
    this.prevTilt = 0;
    this.prevLean = 0;
    this.yaw = 0;
  }

  // Grundhaltung setzen. Wie früher: idle, run, sad und cheer (und jetzt alle
  // Dauerzustände) werden zur neuen Grundhaltung, zu der einmalige Zustände
  // zurückkehren.
  //
  // Ein Dauerzustand unterbricht keine laufende Einmal-Aktion mehr. Szenen
  // rufen set("idle") in jedem Bild — früher brach das einen eben ausgelösten
  // Sprung im selben Bild wieder ab. In Pump-Panik war das Hüpfen beim Pumpen
  // deshalb nie zu sehen. Jetzt wird "idle" nur zur Grundhaltung vorgemerkt,
  // und die Aktion spielt zu Ende.
  set(state, { base = false, params = null } = {}) {
    const name = STATES[ALIASES[state] || state] ? (ALIASES[state] || state) : "idle";
    const def = STATES[name];
    if (params) this.params = { ...params };
    if (def.upper) {
      if (this.gesture?.name !== name) this.gestureStart(name);
      return;
    }
    // Nur Dauerzustände taugen als Grundhaltung; `base` bleibt als Wort der
    // alten Schnittstelle erhalten.
    void base;
    if (!def.dur) this.baseState = name;
    if (this.state === name) return;
    const current = STATES[this.state];
    if (!def.dur && current?.dur) return;
    this.enter(name);
  }

  // Einmalig abspielen, danach zurück zur Grundhaltung. Oberkörper-Handlungen
  // legen sich über die laufende Haltung — ein Läufer kann werfen, ohne
  // stehenzubleiben.
  trigger(state, params = null) {
    const name = ALIASES[state] || state;
    const def = STATES[name];
    if (!def) return;
    if (params) this.params = { ...this.params, ...params };
    if (def.upper) {
      this.gestureStart(name);
      return;
    }
    this.enter(name, true);
  }

  // Ein Gesichtsausdruck für eine Weile (ms), unabhängig vom Körper.
  expression(name, ms = 900) {
    if (!FACES[name]) return;
    this.faceOverride = { name, until: null, ms };
  }

  // Blick auf einen Punkt in der Welt (THREE.Vector3) oder null. Kopf und
  // Pupillen folgen, im Rahmen dessen, was ein Hals hergibt.
  lookAt(point) {
    this.lookPoint = point || null;
    if (point) this.lookManual = null;
  }

  // Blickrichtung direkt, -1..1 je Achse, oder null.
  look(x, y = 0) {
    this.lookManual = x === null ? null : { x, y };
    if (x !== null) this.lookPoint = null;
  }

  enter(name, force = false) {
    if (!force && this.state === name) return;
    copyPose(this.from, this.out);
    // Nach einer Pirouette steht yaw bei 2π, nach einem Salto lean bei -2π.
    // Ungekürzt würde die Überblendung die ganze Runde zurückdrehen.
    this.from.yaw = Math.atan2(sin(this.from.yaw), cos(this.from.yaw));
    this.from.lean = Math.atan2(sin(this.from.lean), cos(this.from.lean));
    this.state = name;
    this.stateStart = null;
    this.blendT = 0;
    this.blendDur = this.reduced ? 0.08 : (STATES[name]?.blend ?? 0.15);
  }

  gestureStart(name) {
    this.gesture = { name, start: null };
  }

  update(now = performance.now()) {
    const nowS = now / 1000;
    if (this.last === null) this.last = nowS;
    const dt = Math.max(0, Math.min(0.05, nowS - this.last));
    this.last = nowS;
    this.now = nowS;
    this.cycle += dt * (this.rate || 1);
    if (this.stateStart === null) this.stateStart = nowS;

    const def = STATES[this.state] || STATES.idle;
    const t = nowS - this.stateStart;

    neutral(this.target);
    def.pose(this.target, t, this);
    if (def.dur && t >= def.dur) {
      this.enter(this.baseState, true);
    }

    // Überblenden.
    this.blendT += dt;
    const w = this.blendDur > 0 ? smooth(this.blendT / this.blendDur) : 1;
    const out = this.out;
    for (let i = 0; i < CHANNELS.length; i += 1) {
      const ch = CHANNELS[i];
      out[ch] = this.from[ch] + (this.target[ch] - this.from[ch]) * w;
    }
    // Drehungen um mehr als eine halbe Runde nicht rückwärts überblenden.
    out.mouth = w < 0.5 ? this.from.mouth : this.target.mouth;
    out.eyes = w < 0.5 ? this.from.eyes : this.target.eyes;

    this.applyGesture(nowS, out);
    this.applyFace(nowS, dt, out);
    this.applyLook(out);
    this.applyBlink(nowS, dt, out);
    this.apply(out, dt, nowS);
  }

  applyGesture(nowS, out) {
    const g = this.gesture;
    if (!g) return;
    const def = STATES[g.name];
    if (!def) {
      this.gesture = null;
      return;
    }
    if (g.start === null) g.start = nowS;
    const t = nowS - g.start;
    if (t >= def.dur) {
      this.gesture = null;
      return;
    }
    const p = copyPose(this.gesturePose, out);
    def.pose(p, t, this);
    const weight = Math.min(1, t / 0.06) * Math.min(1, (def.dur - t) / 0.1);
    for (let i = 0; i < UPPER.length; i += 1) {
      const ch = UPPER[i];
      out[ch] += (p[ch] - out[ch]) * weight;
    }
    if (weight > 0.5) {
      out.mouth = p.mouth;
      out.eyes = p.eyes;
      out.blink = Math.max(out.blink, p.blink * weight);
    }
  }

  applyFace(nowS, dt, out) {
    const f = this.faceOverride;
    if (!f) return;
    if (f.until === null) f.until = nowS + f.ms / 1000;
    if (nowS >= f.until) {
      this.faceOverride = null;
      return;
    }
    const expr = FACES[f.name];
    out.mouth = expr.mouth;
    out.eyes = expr.eyes;
    out.brow = expr.brow;
    out.browY = expr.browY;
    out.blink = Math.max(out.blink, expr.blink);
  }

  applyLook(out) {
    let lx = null;
    let ly = 0;
    if (this.lookManual) {
      lx = this.lookManual.x;
      ly = this.lookManual.y;
    } else if (this.lookPoint) {
      const local = this.kin.worldToLocal(_look.copy(this.lookPoint));
      const len = Math.hypot(local.x, local.y, local.z) || 1;
      // Hinter dem Kopf: nur so weit drehen, wie ein Hals es erlaubt.
      lx = Math.max(-1, Math.min(1, Math.atan2(local.x, Math.max(0.05, local.z)) / 0.9));
      ly = Math.max(-1, Math.min(1, (local.y - 0.2) / len * 1.6));
    }
    if (lx === null) return;
    out.eyeX = out.eyeX * 0.3 + lx * 0.9;
    out.eyeY = out.eyeY * 0.3 + ly * 0.8;
    out.hY = out.hY * 0.4 + lx * 0.55;
    out.hX = out.hX * 0.6 - ly * 0.25;
  }

  applyBlink(nowS, dt, out) {
    if (out.eyes !== "open") return;
    if (this.blinkT < 0 && nowS >= this.nextBlinkAt) {
      this.blinkT = 0;
      this.nextBlinkAt = nowS + 2.2 + Math.random() * 3.8;
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const b = bump(this.blinkT / 0.14, 0, 1);
      out.blink = Math.max(out.blink, b);
      if (this.blinkT >= 0.14) this.blinkT = -1;
    }
  }

  apply(p, dt, nowS) {
    const d = this.parts;
    const kin = this.kin;

    // Nachfedern: der Kopf hängt der Neigung des Körpers etwas hinterher, und
    // das Accessoire schwingt bei Sprüngen und Landungen nach.
    const k = this.reduced ? 1 : Math.min(1, dt * 11);
    this.lag.tilt += (p.tilt - this.lag.tilt) * k;
    this.lag.lean += (p.lean - this.lag.lean) * k;
    const vy = dt > 0 ? (p.y - this.prevY) / dt : 0;
    const dTilt = dt > 0 ? (p.tilt - this.prevTilt) / dt : 0;
    const dLean = dt > 0 ? (p.lean - this.prevLean) / dt : 0;
    this.prevY = p.y;
    this.prevTilt = p.tilt;
    this.prevLean = p.lean;
    if (!this.reduced && dt > 0) {
      const acc = this.acc;
      const stiffness = 90;
      const damping = 9;
      acc.vx += (-stiffness * acc.x - damping * acc.vx - (vy - this.lag.vy) * 3.2 - dLean * 0.6) * dt;
      acc.vz += (-stiffness * acc.z - damping * acc.vz - dTilt * 0.9) * dt;
      acc.x = Math.max(-0.7, Math.min(0.7, acc.x + acc.vx * dt));
      acc.z = Math.max(-0.7, Math.min(0.7, acc.z + acc.vz * dt));
      this.lag.vy = vy;
    }

    kin.position.y = this.groundY + p.y;
    d.rig.rotation.set(p.lean, p.yaw, p.tilt);
    const sq = Math.max(0.5, p.sq);
    const side = 1 / Math.sqrt(sq);
    d.rig.scale.set(side, sq, side);

    const crouch = Math.max(0, Math.min(HIP * 0.9, p.crouch));
    d.torso.position.y = HIP - crouch;
    d.torso.rotation.set(p.tX, p.tY, p.tZ);
    const legScale = (HIP - crouch) / HIP;
    d.legs[0].position.y = HIP - crouch;
    d.legs[1].position.y = HIP - crouch;
    d.legs[0].scale.y = legScale;
    d.legs[1].scale.y = legScale;
    d.legs[0].rotation.set(-p.lL, 0, p.lLs);
    d.legs[1].rotation.set(-p.lR, 0, -p.lRs);

    d.arms[0].rotation.set(-p.aLs, 0, p.aLr);
    d.arms[1].rotation.set(-p.aRs, 0, -p.aRr);

    const headLagZ = (this.lag.tilt - p.tilt) * 0.8;
    const headLagX = (this.lag.lean - p.lean) * 0.5;
    d.head.rotation.set(p.hX + headLagX, p.hY, p.hZ + headLagZ);

    // Gesicht.
    const eyes = d.eyes;
    const mode = p.eyes;
    eyes.pupils.visible = mode === "open" || mode === "spiral";
    eyes.happy.visible = mode === "happy";
    eyes.knocked.visible = mode === "x";
    let ex = p.eyeX;
    let ey = p.eyeY;
    if (mode === "spiral") {
      ex = sin(nowS * 9) * 0.9;
      ey = cos(nowS * 9) * 0.9;
    }
    eyes.pupils.position.x = Math.max(-1, Math.min(1, ex)) * 0.024;
    eyes.pupils.position.y = EYE.y - 0.004 + Math.max(-1, Math.min(1, ey)) * 0.02;

    const blink = mode === "open" || mode === "spiral" ? clamp01(p.blink) : 0;
    d.lids.visible = blink > 0.03;
    d.lids.scale.y = Math.max(0.001, blink);

    d.brows[0].rotation.z = p.brow * 0.45;
    d.brows[1].rotation.z = -p.brow * 0.45;
    const browY = EYE.y + 0.1 + p.browY * 0.025 - Math.max(0, p.brow) * 0.008;
    d.brows[0].position.y = browY;
    d.brows[1].position.y = browY;

    const mouths = d.mouths;
    const wanted = mouths[p.mouth] ? p.mouth : "smile";
    if (this.currentMouth !== wanted) {
      Object.entries(mouths).forEach(([name, mesh]) => { mesh.visible = name === wanted; });
      this.currentMouth = wanted;
    }

    // Accessoire: federt; der Heiligenschein schwebt und kreist zusätzlich.
    const accessory = d.accessory;
    accessory.rotation.x = this.acc.x;
    accessory.rotation.z = this.acc.z;
    if (d.accessoryStyle === 1) {
      accessory.position.y = HEAD.cy + HEAD.h / 2 + sin(nowS * 2.3 + this.phase) * 0.015;
      accessory.rotation.y = nowS * 0.8;
    }
  }
}

const _look = new THREE.Vector3();

// --- Reaktion auf die Platzierung -------------------------------------------
// Jeder Platz reagiert eigen:
//   1. Platz  Siegerpose
//   2. Platz  freut sich, klatscht
//   3. Platz  zuckt mit den Schultern
//   4. Platz  auf den Knien
// Im Zweikampf ist Platz 2 der letzte und darf knicken.
export function finalePose(place, total = 4) {
  if (!place) return { state: "idle", cheer: false, hop: 0 };
  if (place === 1) return { state: "victory", cheer: true, hop: 1 };
  if (place >= total) return { state: total <= 2 ? "sad" : "defeat", cheer: false, hop: 0 };
  if (place === 2) return { state: "happy", cheer: true, hop: 0.45 };
  return { state: "shrug", cheer: false, hop: 0 };
}

export function applyFinaleMood(animator, place, total = 4) {
  const pose = finalePose(place, total);
  animator?.set(pose.state, { base: true });
  return pose;
}
