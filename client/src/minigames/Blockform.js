import * as THREE from "/vendor/three/three.module.js";

// Runde Formen im Polygon-Look.
//
// Tumblekin ist aus Klötzen und Flächen gebaut: Figuren, Kisten, Bühnen.
// Glatte Kugeln, Zylinder und Ringe wirkten daneben wie aus einem anderen
// Spiel. Statt jede der gut vierhundert runden Formen in über vierzig Dateien
// einzeln neu zu bauen, ersetzt dieser Umwandler sie beim ersten Zeichnen.
//
// Früher durch gestufte Voxel-Treppen — nach Rückmeldung aus dem Spieltest
// wirkten die zu grob, Ränder und Ringe sahen ausgefranst aus. Jetzt durch
// facettierte Low-Poly-Körper: wenige Ecken je Umfang (sechs bei Winzigem,
// bis zu 48 bei grossen Spielflächen, damit der sichtbare Rand zu der Kante
// passt, an der man herunterfällt), jede Fläche mit eigener Normale, sodass
// das Licht in klaren Flächen liegt. Die Masse bleiben dieselben.
//
// Teilstücke (die Streifen eines Heissluftballons, Tortenstücke, die Bögen
// eines gestreiften Schwimmrings) bekommen ihren Anteil der Ecken und passen
// lückenlos zusammen — die Streifen bleiben.
//
// Bleibt, wie es ist:
//   - Himmelskuppeln (von innen gezeichnet, mit Farbverlauf in den Ecken)
//   - Schattenflecken
//   - Formen mit mehreren Materialien
//   - alles, was geometry.userData.rund oder mesh.userData.rund trägt
//   - Kanten- und Vielflächner (Pyramiden, Dreieckswimpel, Baumkronen aus
//     Zwölfflächnern) und absichtliche Vielecke (ein Ring mit vier Ecken ist
//     ein Quadrat, eine Scheibe mit fünf ein Stern) — sie sind schon eckig.

const TAU = Math.PI * 2;
const cache = new Map();
const CACHE_BYTES = 8 * 1024 * 1024;
const CACHE_ENTRIES = 256;
let cachedBytes = 0;
const geprueft = new WeakSet();

export function blockformCacheInfo() {
  return { entries: cache.size, bytes: cachedBytes, maxBytes: CACHE_BYTES, maxEntries: CACHE_ENTRIES };
}

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
  if (cache.has(key)) {
    const entry = cache.get(key);
    cache.delete(key);
    cache.set(key, entry);
    return entry.geometry;
  }
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
  if (block) {
    const bytes = Object.values(block.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
      + (block.index?.array.byteLength || 0);
    if (bytes <= CACHE_BYTES) {
      while (cache.size >= CACHE_ENTRIES || cachedBytes + bytes > CACHE_BYTES) {
        const oldest = cache.keys().next().value;
        cachedBytes -= cache.get(oldest).bytes;
        // Nur den Vorratsverweis entfernen. Eine aktive Szene kann dieselbe
        // Geometrie noch zeichnen und räumt ihre GPU-Ressourcen selbst auf.
        cache.delete(oldest);
      }
      cache.set(key, { geometry: block, bytes });
      cachedBytes += bytes;
    }
  }
  return block;
}

// Ecken je vollem Umfang, nach Grösse: Kleines sechs- bis achteckig, Grosses
// feiner — Spielflächen so fein, dass der sichtbare Rand zu der Kante passt,
// an der man herunterfällt.
function ecken(radius) {
  if (radius < 0.12) return 6;
  if (radius < 0.5) return 8;
  if (radius < 1.2) return 10;
  if (radius < 2) return 14;
  return Math.min(48, Math.max(16, Math.round(radius * 9)));
}

// Ein Teilstück bekommt seinen Anteil der Ecken, damit Stücke eines Ganzen
// (Ballonstreifen, Tortenstücke, Bögen eines Schwimmrings) an denselben
// Stellen geknickt sind und lückenlos zusammenpassen.
function anteil(n, laenge = TAU) {
  return Math.max(1, Math.round(n * Math.min(TAU, laenge) / TAU));
}

// Die Ecken, die eine Form mit `n` Ecken auf `laenge` auf dem vollen Kreis
// hätte — damit ein Teilstück nicht feiner wird als sein Ganzes.
function vollerKreis(n, laenge = TAU) {
  return n * TAU / Math.max(1e-3, Math.min(TAU, laenge));
}

// Facetten: jede Dreiecksfläche bekommt ihre eigene Normale, so liegt das
// Licht in Flächen statt weich verlaufend — der „Polygon-Look“ der Figuren.
function facettiert(geometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.computeVertexNormals();
  return flat;
}

const BAU = {
  SphereGeometry({ radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = TAU, thetaStart = 0, thetaLength = Math.PI }) {
    if (radius > 20 || widthSegments <= 4) return null;
    const rund = Math.min(vollerKreis(widthSegments, phiLength), ecken(radius));
    const hoch = Math.max(3, Math.min(heightSegments, Math.round(rund * 0.6)));
    return facettiert(new THREE.SphereGeometry(radius, anteil(rund, phiLength), Math.max(1, Math.round(hoch * thetaLength / Math.PI)), phiStart, phiLength, thetaStart, thetaLength));
  },

  CylinderGeometry({ radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, openEnded = false, thetaStart = 0, thetaLength = TAU }) {
    if (radialSegments <= 4) return null;
    const rund = Math.min(vollerKreis(radialSegments, thetaLength), ecken(Math.max(radiusTop, radiusBottom)));
    return facettiert(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, anteil(rund, thetaLength), 1, openEnded, thetaStart, thetaLength));
  },

  ConeGeometry({ radius = 1, height = 1, radialSegments = 32, openEnded = false, thetaStart = 0, thetaLength = TAU }) {
    if (radialSegments <= 4) return null;
    const rund = Math.min(vollerKreis(radialSegments, thetaLength), ecken(radius));
    return facettiert(new THREE.ConeGeometry(radius, height, anteil(rund, thetaLength), 1, openEnded, thetaStart, thetaLength));
  },

  CapsuleGeometry({ radius = 1, length = 1 }) {
    return facettiert(new THREE.CapsuleGeometry(radius, length, 2, ecken(radius)));
  },

  LatheGeometry({ points = [], segments = 12, phiStart = 0, phiLength = TAU }) {
    if (points.length < 2) return null;
    const r = Math.max(...points.map((p) => Math.abs(p.x)));
    const rund = Math.min(vollerKreis(segments, phiLength), ecken(r));
    return facettiert(new THREE.LatheGeometry(points, anteil(rund, phiLength), phiStart, phiLength));
  },

  TorusGeometry({ radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48, arc = TAU }) {
    // Ein Schlauch mit sechseckigem Querschnitt, in geraden Stücken um den
    // Ring — wie ein aufgeblasener Schwimmring aus Flächen.
    const quer = Math.min(radialSegments, 6);
    const rund = Math.min(vollerKreis(tubularSegments, arc), Math.max(8, Math.round(ecken(radius) * 1.6)));
    return facettiert(new THREE.TorusGeometry(radius, tube, Math.max(3, quer), anteil(rund, arc), arc));
  },

  CircleGeometry({ radius = 1, segments = 32, thetaStart = 0, thetaLength = TAU }) {
    if (segments <= 6) return null;
    return facettiert(new THREE.CircleGeometry(radius, anteil(Math.min(vollerKreis(segments, thetaLength), ecken(radius)), thetaLength), thetaStart, thetaLength));
  },

  RingGeometry({ innerRadius = 0.5, outerRadius = 1, thetaSegments = 32, thetaStart = 0, thetaLength = TAU }) {
    if (thetaSegments <= 6) return null;
    return facettiert(new THREE.RingGeometry(innerRadius, outerRadius, anteil(Math.min(vollerKreis(thetaSegments, thetaLength), ecken(outerRadius)), thetaLength), 1, thetaStart, thetaLength));
  }
};

// Ein flaches Band um einen Kreis, etwa der Rand einer Spielfläche: gerade
// Stücke wie beim Schlauch, aber mit rechteckigem Querschnitt, damit die
// Oberkante bündig mit einer Fläche abschliessen kann. y zeigt nach oben;
// ein Teilbogen läuft von der +x-Achse aus. Die Geometrie ist schon eine
// Blockform und wird nicht noch einmal umgebaut.
export function ringband({ innen, aussen, unten, oben, bogen = TAU, stuecke }) {
  const anzahl = stuecke ?? Math.max(3, Math.round((Math.min(64, Math.max(16, (TAU * aussen) / 0.35)) * bogen) / TAU));
  const schritt = bogen / anzahl;
  const offen = bogen < TAU - 1e-6;
  const bau = new Bau();
  for (let i = 0; i < anzahl; i += 1) {
    const a1 = i === anzahl - 1 ? bogen : (i + 1) * schritt;
    bau.keil(innen, aussen, i * schritt, a1, unten, oben, { anfang: offen && i === 0, ende: offen && i === anzahl - 1 });
  }
  const g = bau.geometrie(planarUV(aussen));
  g.rotateX(-Math.PI / 2);
  g.userData.block = true;
  return g;
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

  // Ein Keil aus einem Ring in der xy-Ebene: Radius r0 bis r1, Winkel a0
  // bis a1, Höhe (z) z0 bis z1. Die Stirnflächen an a0 und a1 entstehen nur,
  // wo der Ring aufhört — zwischen zwei Keilen lägen sie im Inneren.
  keil(r0, r1, a0, a1, z0, z1, { anfang = true, ende = true } = {}) {
    const p = (r, a, z) => [r * Math.cos(a), r * Math.sin(a), z];
    const am = (a0 + a1) / 2;
    const flaechen = [
      [[Math.cos(am), Math.sin(am), 0], [p(r1, a0, z0), p(r1, a1, z0), p(r1, a1, z1), p(r1, a0, z1)]],
      [[-Math.cos(am), -Math.sin(am), 0], [p(r0, a0, z0), p(r0, a1, z0), p(r0, a1, z1), p(r0, a0, z1)]],
      [[0, 0, 1], [p(r0, a0, z1), p(r1, a0, z1), p(r1, a1, z1), p(r0, a1, z1)]],
      [[0, 0, -1], [p(r0, a0, z0), p(r1, a0, z0), p(r1, a1, z0), p(r0, a1, z0)]]
    ];
    if (anfang) flaechen.push([[Math.sin(a0), -Math.cos(a0), 0], [p(r0, a0, z0), p(r1, a0, z0), p(r1, a0, z1), p(r0, a0, z1)]]);
    if (ende) flaechen.push([[-Math.sin(a1), Math.cos(a1), 0], [p(r0, a1, z0), p(r1, a1, z0), p(r1, a1, z1), p(r0, a1, z1)]]);
    flaechen.forEach(([n, ecken]) => this.flaeche(n, ecken));
  }

  // Ein Viereck mit gegebener Normale; die Reihenfolge der Ecken wird so
  // gedreht, dass die Vorderseite nach aussen zeigt.
  flaeche(n, ecken) {
    const [a, b, c] = ecken;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const kreuz = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const reihe = kreuz[0] * n[0] + kreuz[1] * n[1] + kreuz[2] * n[2] < 0 ? [...ecken].reverse() : ecken;
    const i = this.pos.length / 3;
    reihe.forEach(([x, y, z]) => {
      this.pos.push(x, y, z);
      this.norm.push(n[0], n[1], n[2]);
      this.punkte.push(x, y, z);
    });
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
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
