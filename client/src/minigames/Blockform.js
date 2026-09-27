import * as THREE from "/vendor/three/three.module.js";

// Runde Formen in Blöcken.
//
// Tumblekin ist aus Klötzen gebaut: Figuren, Kisten, Bühnen. Glatte Kugeln,
// Zylinder und Ringe wirkten daneben wie aus einem anderen Spiel. Statt jede
// der gut vierhundert runden Formen in über vierzig Dateien einzeln neu zu
// bauen, ersetzt dieser Umwandler sie beim ersten Zeichnen durch gestufte
// Blockformen — so, wie der Luftballon in Pump-Panik gebaut ist: ein Kern mit
// Wölbungen, oben und unten schmaler.
//
// Verfahren: die Form wird in waagrechte Schichten geschnitten; jede Schicht
// ist eine "Pixelscheibe" auf einem festen Raster, deren Zellen zu Reihen
// zusammengefasst werden. Kleine Dinge bekommen drei Zellen über den
// Durchmesser (Kreuzform wie der Ballon), grosse Spielflächen feinere Stufen —
// dort muss der sichtbare Rand zu der Kante passen, an der man herunterfällt.
// Die Teile überlappen nicht; auch durchsichtige Formen bleiben sauber.
//
// Bleibt rund:
//   - Himmelskuppeln (von innen gezeichnet, mit Farbverlauf in den Ecken)
//   - Schattenflecken
//   - Formen mit mehreren Materialien
// Teilstücke (die Streifen eines Heissluftballons, Tortenstücke) werden in
// Blöcken gebaut, deren Zellen genau dem Winkelbereich des Stücks gehören —
// die Stücke setzen sich so lückenlos wieder zusammen, die Streifen bleiben.
//   - alles, was geometry.userData.rund oder mesh.userData.rund trägt
// Kanten- und Vielflächner (Pyramiden, Dreieckswimpel, Baumkronen aus
// Zwölfflächnern) und absichtliche Vielecke (ein Ring mit vier Ecken ist ein
// Quadrat, eine Scheibe mit fünf ein Stern) sind schon eckig und bleiben.

const TAU = Math.PI * 2;
const cache = new Map();
const geprueft = new WeakSet();

// Einmal je Bild vor dem Zeichnen: neue runde Formen umbauen. Bereits
// geprüfte Geometrien werden übersprungen, der Durchlauf kostet fast nichts.
export function verblocke(root) {
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    if (!geometry || geprueft.has(geometry)) return;
    geprueft.add(geometry);
    if (geometry.userData?.rund || geometry.userData?.block || mesh.userData?.rund || mesh.userData?.isShadow) return;
    if (Array.isArray(mesh.material)) return;
    if (mesh.material?.side === THREE.BackSide) return;
    if (geometry.getAttribute("color")) return;
    const block = blockform(geometry);
    if (block) {
      geprueft.add(block);
      mesh.geometry = block;
    }
  });
}

// Die Blockform zu einer Geometrie, oder null, wenn sie bleibt, wie sie ist.
export function blockform(geometry) {
  const type = geometry.type;
  if (!BAU[type]) return null;
  const key = `${type}|${JSON.stringify(geometry.parameters)}`;
  if (cache.has(key)) return cache.get(key);
  let block = null;
  try {
    block = BAU[type](geometry.parameters || {});
  } catch {
    block = null;
  }
  if (block) {
    block.userData.block = true;
    block.computeBoundingBox();
    block.computeBoundingSphere();
  }
  cache.set(key, block);
  return block;
}

// Zellen über den Durchmesser: klein und mittel wie der Ballon (3), grössere
// Dinge 5 und 7, Spielflächen feiner, damit der Rand stimmt.
function zellenFuer(radius) {
  if (radius < 0.9) return 3;
  if (radius < 1.8) return 5;
  if (radius < 3) return 7;
  let n = Math.round((radius * 2) / 0.45);
  if (n % 2 === 0) n += 1;
  return Math.min(25, n);
}

const voll = (length) => length === undefined || length >= TAU - 1e-3;

// Zellfilter für ein Teilstück: `winkel(x, z)` liefert den Winkel so, wie die
// jeweilige three.js-Form ihn zählt. Ein halboffenes Intervall, damit jede
// Zelle genau einem Stück gehört; Längen, die knapp über einem glatten Teil
// einer Runde liegen (Stücke überlappen um ein Tausendstel), werden gerundet.
function stueck(start = 0, laenge = TAU, winkel) {
  if (voll(laenge)) return null;
  const teile = TAU / laenge;
  const l = Math.abs(teile - Math.round(teile)) < 0.02 ? TAU / Math.round(teile) : laenge;
  return (x, z) => {
    let a = winkel(x, z) - start;
    a = ((a % TAU) + TAU) % TAU;
    if (a > TAU - 1e-9) a = 0;
    return a < l;
  };
}

const BAU = {
  SphereGeometry({ radius = 1, widthSegments = 32, phiStart = 0, phiLength, thetaStart = 0, thetaLength = Math.PI }) {
    if (radius > 20 || widthSegments <= 4) return null;
    const oben = radius * Math.cos(thetaStart);
    const unten = radius * Math.cos(Math.min(Math.PI, thetaStart + thetaLength));
    const filter = stueck(phiStart, phiLength, (x, z) => Math.atan2(z, -x));
    return drehkoerper((y) => Math.sqrt(Math.max(0, radius * radius - y * y)), unten, oben, radius, { uv: kugelUV(radius), filter });
  },

  CylinderGeometry({ radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, openEnded = false, thetaStart = 0, thetaLength }) {
    if (radialSegments <= 4) return null;
    const r = Math.max(radiusTop, radiusBottom);
    const profil = (y) => radiusBottom + (radiusTop - radiusBottom) * ((y + height / 2) / height);
    const filter = stueck(thetaStart, thetaLength, (x, z) => Math.atan2(x, z));
    if (openEnded) return hohlkoerper(profil, -height / 2, height / 2, r, filter);
    return drehkoerper(profil, -height / 2, height / 2, r, { konstant: Math.abs(radiusTop - radiusBottom) < 1e-6, filter });
  },

  ConeGeometry({ radius = 1, height = 1, radialSegments = 32, openEnded = false, thetaStart = 0, thetaLength }) {
    if (radialSegments <= 4) return null;
    const profil = (y) => radius * (1 - (y + height / 2) / height);
    const filter = stueck(thetaStart, thetaLength, (x, z) => Math.atan2(x, z));
    if (openEnded) return hohlkoerper(profil, -height / 2, height / 2, radius, filter);
    return drehkoerper(profil, -height / 2, height / 2, radius, { minSchichten: 3, filter });
  },

  CapsuleGeometry({ radius = 1, length = 1 }) {
    const half = length / 2;
    const profil = (y) => {
      const aussen = Math.abs(y) - half;
      return aussen <= 0 ? radius : Math.sqrt(Math.max(0, radius * radius - aussen * aussen));
    };
    return drehkoerper(profil, -half - radius, half + radius, radius);
  },

  LatheGeometry({ points = [], phiStart = 0, phiLength }) {
    if (points.length < 2) return null;
    const filter = stueck(phiStart, phiLength, (x, z) => Math.atan2(x, z));
    const pts = points.map((p) => ({ x: Math.abs(p.x), y: p.y })).sort((a, b) => a.y - b.y);
    const profil = (y) => {
      for (let i = 1; i < pts.length; i += 1) {
        if (y <= pts[i].y) {
          const a = pts[i - 1];
          const b = pts[i];
          const u = b.y - a.y > 1e-6 ? (y - a.y) / (b.y - a.y) : 0;
          return a.x + (b.x - a.x) * u;
        }
      }
      return pts[pts.length - 1].x;
    };
    const r = Math.max(...pts.map((p) => p.x));
    return drehkoerper(profil, pts[0].y, pts[pts.length - 1].y, r, { filter });
  },

  TorusGeometry({ radius = 1, tube = 0.4, arc = TAU }) {
    // Ein Ring aus Blöcken in der xy-Ebene, so dick wie das Rohr.
    const aussen = radius + tube;
    const zelle = rasterFuerRing(aussen, tube * 2);
    const flaeche = scheibe(zelle, aussen, (x, y) => {
      const d = Math.hypot(x, y);
      return Math.abs(d - radius) <= Math.max(tube, zelle * 0.5) && imBogen(x, y, 0, arc);
    });
    const tiefe = tube * 1.7;
    const bau = new Bau();
    flaeche.forEach(({ x0, x1, y0, y1 }) => bau.kiste(x0, x1, y0, y1, -tiefe / 2, tiefe / 2));
    return bau.geometrie(planarUV(aussen));
  },

  CircleGeometry({ radius = 1, segments = 32, thetaStart = 0, thetaLength = TAU }) {
    if (segments <= 6) return null;
    const zelle = (radius * 2) / zellenFuer(radius);
    const flaeche = scheibe(zelle, radius, (x, y) => (Math.hypot(x, y) <= radius * 0.93 || (x === 0 && y === 0)) && imBogen(x, y, thetaStart, thetaLength));
    return flach(flaeche, radius);
  },

  RingGeometry({ innerRadius = 0.5, outerRadius = 1, thetaSegments = 32, thetaStart = 0, thetaLength = TAU }) {
    if (thetaSegments <= 6) return null;
    const breite = outerRadius - innerRadius;
    const mitte = (outerRadius + innerRadius) / 2;
    const zelle = rasterFuerRing(outerRadius, breite);
    const flaeche = scheibe(zelle, outerRadius, (x, y) =>
      Math.abs(Math.hypot(x, y) - mitte) <= Math.max(breite / 2, zelle * 0.5) && imBogen(x, y, thetaStart, thetaLength));
    return flach(flaeche, outerRadius);
  }
};

// Zellgrösse für Ringe: fein genug, dass die Ringbreite mindestens eine Zelle
// ist — aber nie mehr als 25 Zellen über den Durchmesser.
function rasterFuerRing(aussen, breite) {
  const grob = (aussen * 2) / zellenFuer(aussen);
  return Math.max(Math.min(grob, breite), (aussen * 2) / 25);
}

function imBogen(x, y, start, laenge) {
  if (voll(laenge)) return true;
  let a = Math.atan2(y, x) - start;
  a = ((a % TAU) + TAU) % TAU;
  return a <= laenge;
}

// Eine Pixelscheibe: Zellen auf einem Raster um den Mittelpunkt, deren Mitte
// `drin` erfüllt, zu Reihen zusammengefasst. Ergebnis: Rechtecke in (x, y).
function scheibe(zelle, radius, drin) {
  const n = Math.max(1, Math.ceil(radius / zelle - 0.5));
  const out = [];
  for (let j = -n; j <= n; j += 1) {
    const y = j * zelle;
    let start = null;
    for (let i = -n; i <= n + 1; i += 1) {
      const x = i * zelle;
      const inne = i <= n && drin(x, y);
      if (inne && start === null) start = i;
      if (!inne && start !== null) {
        out.push({ x0: (start - 0.5) * zelle, x1: (i - 0.5) * zelle, y0: y - zelle / 2, y1: y + zelle / 2 });
        start = null;
      }
    }
  }
  return out;
}

// Ein Drehkörper um die y-Achse aus Schichten von Pixelscheiben.
// `profil(y)` ist der Radius in der Höhe y.
function drehkoerper(profil, unten, oben, rMax, { konstant = false, minSchichten = 1, uv = null, filter = null } = {}) {
  const spanne = oben - unten;
  if (!(spanne > 0) || !(rMax > 0)) return null;
  // Streifen brauchen etwas mehr Auflösung, sonst sind sie nicht zu sehen.
  const zellen = filter ? Math.max(7, zellenFuer(rMax)) : zellenFuer(rMax);
  const zelle = (rMax * 2) / zellen;
  // Gleicher Radius über die ganze Höhe: eine einzige Schicht genügt.
  let schichten = konstant ? 1 : Math.max(minSchichten, Math.round(spanne / zelle));
  schichten = Math.max(1, Math.min(25, schichten));
  const dicke = spanne / schichten;
  const bau = new Bau();
  for (let k = 0; k < schichten; k += 1) {
    const y0 = unten + k * dicke;
    const y1 = y0 + dicke;
    const r = profil((y0 + y1) / 2);
    if (r < zelle * 0.3) {
      // Spitze: ein einzelner Würfel, damit Kegel nicht abgeschnitten wirken.
      if (r > 1e-4 && k === schichten - 1 && (!filter || filter(0, 0))) bau.kiste(-zelle / 2, zelle / 2, y0, y1, -zelle / 2, zelle / 2, "y");
      continue;
    }
    const flaeche = scheibe(zelle, r, (x, z) => (Math.hypot(x, z) <= r * 0.93 || (x === 0 && z === 0)) && (!filter || filter(x, z)));
    flaeche.forEach(({ x0, x1, y0: z0, y1: z1 }) => bau.kiste(x0, x1, y0, y1, z0, z1, "y"));
  }
  return bau.geometrie(uv || zylinderUV(rMax, unten, oben));
}

// Ein offener Zylinder (Korb, Eimer): nur die Wand, als Ring aus Blöcken.
function hohlkoerper(profil, unten, oben, rMax, filter = null) {
  const spanne = oben - unten;
  const zellen = zellenFuer(rMax);
  const zelle = Math.max((rMax * 2) / Math.max(zellen, 7), 0.02);
  const schichten = Math.max(1, Math.min(12, Math.round(spanne / zelle)));
  const dicke = spanne / schichten;
  const bau = new Bau();
  for (let k = 0; k < schichten; k += 1) {
    const y0 = unten + k * dicke;
    const r = profil(y0 + dicke / 2);
    const flaeche = scheibe(zelle, r, (x, z) => Math.abs(Math.hypot(x, z) - (r - zelle * 0.5)) <= zelle * 0.5 && (!filter || filter(x, z)));
    flaeche.forEach(({ x0, x1, y0: z0, y1: z1 }) => bau.kiste(x0, x1, y0, y0 + dicke, z0, z1, "y"));
  }
  return bau.geometrie(zylinderUV(rMax, unten, oben));
}

// Flache Scheiben und Ringe (xy-Ebene, Blick nach +z) aus Rechtecken.
function flach(flaeche, radius) {
  if (!flaeche.length) return null;
  const pos = [];
  const norm = [];
  const uv = [];
  const idx = [];
  flaeche.forEach(({ x0, x1, y0, y1 }) => {
    const i = pos.length / 3;
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y]) => {
      pos.push(x, y, 0);
      norm.push(0, 0, 1);
      uv.push(x / (radius * 2) + 0.5, y / (radius * 2) + 0.5);
    });
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// UV-Abbildungen, damit Texturen ungefähr dort bleiben, wo sie waren.
function kugelUV(radius) {
  return (x, y, z) => [0.5 + Math.atan2(z, -x) / TAU, 1 - Math.acos(Math.max(-1, Math.min(1, y / radius))) / Math.PI];
}
function zylinderUV(radius, unten, oben) {
  return (x, y, z) => [0.5 + Math.atan2(x, z) / TAU, (y - unten) / Math.max(1e-6, oben - unten)];
}
function planarUV(radius) {
  return (x, y) => [x / (radius * 2) + 0.5, y / (radius * 2) + 0.5];
}

// Sammelt Quader zu einer einzigen Geometrie: ein Zeichenaufruf je Form.
class Bau {
  constructor() {
    this.pos = [];
    this.norm = [];
    this.punkte = [];
    this.idx = [];
  }

  // Quader von (x0, y0, z0) bis (x1, y1, z1). Mit achse = "y" sind die
  // Argumente (x0, x1, y0, y1, z0, z1); sonst (x0, x1, y0, y1, z0, z1) in der
  // xy-Ebene — beides dieselbe Reihenfolge, nur zur Lesbarkeit.
  kiste(x0, x1, y0, y1, z0, z1) {
    const flaechen = [
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]]
    ];
    flaechen.forEach(([n, ecken]) => {
      const i = this.pos.length / 3;
      ecken.forEach(([x, y, z]) => {
        this.pos.push(x, y, z);
        this.norm.push(n[0], n[1], n[2]);
        this.punkte.push(x, y, z);
      });
      this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    });
  }

  geometrie(uvVon) {
    if (!this.pos.length) return null;
    const uv = [];
    for (let i = 0; i < this.punkte.length; i += 3) {
      const [u, v] = uvVon(this.punkte[i], this.punkte[i + 1], this.punkte[i + 2]);
      uv.push(u, v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}
