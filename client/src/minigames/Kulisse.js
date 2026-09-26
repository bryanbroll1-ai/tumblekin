import * as THREE from "/vendor/three/three.module.js";

// Bausteine für Kulissen.
//
// Jede Szene soll ein eigener Ort sein — ein Dorffest, ein Gipfel, eine
// Spielhalle —, und dafür braucht es Dinge, die dort herumstehen: Zäune,
// Wimpelketten, Heuballen, Laternen, Regale. Einzeln gebaut kostet jedes
// davon einen Zeichenaufruf; zwanzig Zaunpfosten wären zwanzig. Darum setzt
// alles hier auf InstancedMesh: gleiche Teile in einem Aufruf, egal wie viele.
//
// Alle Helfer nehmen die Szene (oder eine Gruppe) als erstes Argument und
// geben das Erzeugte zurück. Zufall kommt aus einem Seed, damit dieselbe
// Szene bei jedem Start gleich aussieht — sonst wäre kein Bildvergleich
// möglich.

const _o = new THREE.Object3D();

export function streuer(seed = 1) {
  let zustand = (seed * 1103515245 + 12345) >>> 0;
  return () => {
    zustand = (zustand * 1664525 + 1013904223) >>> 0;
    return zustand / 4294967296;
  };
}

const materialCache = new Map();
export function lambert(color, extra = {}) {
  const key = `${color}|${JSON.stringify(extra)}`;
  if (!materialCache.has(key) || materialCache.get(key).userData.disposed) {
    const material = new THREE.MeshLambertMaterial({ color, ...extra });
    // Beim Abbau einer Szene werden alle Materialien entsorgt. Ein Cache über
    // Szenen hinweg würde dann entsorgte Materialien weiterreichen — darum
    // merkt sich das Material, dass es weg ist.
    const dispose = material.dispose.bind(material);
    material.dispose = () => { material.userData.disposed = true; dispose(); };
    materialCache.set(key, material);
  }
  return materialCache.get(key);
}

// Viele gleiche Teile in einem Zeichenaufruf. `teile` ist eine Liste von
// { p: [x, y, z], r: [x, y, z], s: Zahl | [x, y, z] }.
export function viele(parent, geometry, material, teile, { schatten = false, empfangen = false } = {}) {
  if (!teile.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, teile.length);
  teile.forEach((teil, i) => {
    _o.position.set(teil.p[0], teil.p[1], teil.p[2]);
    const r = teil.r || [0, 0, 0];
    _o.rotation.set(r[0], r[1], r[2]);
    const s = teil.s ?? 1;
    if (Array.isArray(s)) _o.scale.set(s[0], s[1], s[2]);
    else _o.scale.setScalar(s);
    _o.updateMatrix();
    mesh.setMatrixAt(i, _o.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = schatten;
  mesh.receiveShadow = empfangen;
  // Instanzen liegen weit verteilt; die Hülle der Grundform sagt über ihre
  // Sichtbarkeit nichts.
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}

export function kiste(parent, w, h, d, color, [x, y, z] = [0, 0, 0], { schatten = true, empfangen = true, material = null } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material || lambert(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = schatten;
  mesh.receiveShadow = empfangen;
  parent.add(mesh);
  return mesh;
}

// Flacher Boden als grosse Platte.
export function boden(parent, { w = 60, d = 50, y = 0, color = "#7fb06c", dicke = 0.5 } = {}) {
  const mesh = kiste(parent, w, dicke, d, color, [0, y - dicke / 2, 0], { schatten: false, empfangen: true });
  return mesh;
}

// Zaun aus Pfosten und zwei Latten von a nach b (jeweils [x, z]).
export function zaun(parent, a, b, { y = 0, hoehe = 0.62, abstand = 0.9, color = "#b98a55", pfostenColor = "#8a6238" } = {}) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const laenge = Math.hypot(dx, dz);
  const winkel = Math.atan2(-dz, dx);
  const n = Math.max(2, Math.round(laenge / abstand) + 1);
  const pfosten = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    pfosten.push({ p: [a[0] + dx * t, y + hoehe / 2, a[1] + dz * t], r: [0, winkel, 0] });
  }
  viele(parent, new THREE.BoxGeometry(0.1, hoehe, 0.1), lambert(pfostenColor), pfosten, { schatten: true });
  const latten = [0.32, 0.72].map((h) => ({
    p: [a[0] + dx / 2, y + hoehe * h, a[1] + dz / 2],
    r: [0, winkel, 0],
    s: [laenge, 1, 1]
  }));
  viele(parent, new THREE.BoxGeometry(1, 0.08, 0.05), lambert(color), latten, { schatten: true });
}

// Wimpelkette zwischen zwei Punkten, mit Durchhang.
export function wimpel(parent, a, b, { colors = ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#ffffff"], anzahl = 14, durchhang = 0.45, groesse = 0.22 } = {}) {
  const punkte = [];
  const at = (t) => new THREE.Vector3(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * durchhang,
    a[2] + (b[2] - a[2]) * t
  );
  for (let i = 0; i <= 24; i += 1) punkte.push(at(i / 24));
  const schnur = new THREE.Line(new THREE.BufferGeometry().setFromPoints(punkte), new THREE.LineBasicMaterial({ color: "#5d4a3a" }));
  parent.add(schnur);
  const dreieck = new THREE.BufferGeometry();
  dreieck.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1.1, 0], 3));
  dreieck.computeVertexNormals();
  const richtung = Math.atan2(-(b[2] - a[2]), b[0] - a[0]);
  colors.forEach((farbe, fi) => {
    const teile = [];
    for (let i = fi; i < anzahl; i += colors.length) {
      const p = at((i + 0.5) / anzahl);
      teile.push({ p: [p.x, p.y, p.z], r: [0, richtung, 0], s: groesse });
    }
    viele(parent, dreieck, lambert(farbe, { side: THREE.DoubleSide }), teile);
  });
  return schnur;
}

// Heuballen: runde Rollen, liegend.
export function heuballen(parent, spots, { color = "#e8c15a", ende = "#d4a843" } = {}) {
  const rollen = spots.map(([x, z, dreh = 0, lage = 0]) => ({ p: [x, 0.36 + lage * 0.62, z], r: [Math.PI / 2, 0, dreh], s: 1 }));
  viele(parent, new THREE.CylinderGeometry(0.36, 0.36, 0.62, 12), lambert(color), rollen, { schatten: true, empfangen: true });
  const kappen = [];
  spots.forEach(([x, z, dreh = 0, lage = 0]) => {
    [-1, 1].forEach((seite) => {
      kappen.push({ p: [x + Math.sin(dreh) * 0.315 * seite, 0.36 + lage * 0.62, z + Math.cos(dreh) * 0.315 * seite], r: [Math.PI / 2, 0, dreh], s: [1, 0.02, 1] });
    });
  });
  viele(parent, new THREE.CylinderGeometry(0.3, 0.3, 1, 12), lambert(ende), kappen);
}

// Scheune: roter Körper, Satteldach, weisse Kanten, Tor.
export function scheune(parent, [x, z], { dreh = 0, groesse = 1, color = "#c8413b", dach = "#6b3a2e" } = {}) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = dreh;
  g.scale.setScalar(groesse);
  kiste(g, 3, 2, 2.4, color, [0, 1, 0]);
  const giebel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1.75, 1.2, 4, 1), lambert(color));
  giebel.rotation.y = Math.PI / 4;
  giebel.scale.set(1.2, 1, 0.97);
  giebel.position.set(0, 2.6, 0);
  g.add(giebel);
  const dachL = kiste(g, 1.95, 0.1, 2.6, dach, [-0.78, 2.62, 0]);
  dachL.rotation.z = 0.66;
  const dachR = kiste(g, 1.95, 0.1, 2.6, dach, [0.78, 2.62, 0]);
  dachR.rotation.z = -0.66;
  kiste(g, 1.1, 1.3, 0.05, "#8c2c28", [0, 0.65, 1.22]);
  kiste(g, 1.2, 0.08, 0.06, "#ffffff", [0, 0.65, 1.25]).rotation.z = 0.86;
  kiste(g, 1.2, 0.08, 0.06, "#ffffff", [0, 0.65, 1.25]).rotation.z = -0.86;
  kiste(g, 1.24, 0.08, 0.06, "#ffffff", [0, 1.32, 1.25]);
  kiste(g, 0.5, 0.4, 0.05, "#ffffff", [0, 2.35, 1.22]);
  parent.add(g);
  return g;
}

// Sonnenblumen: Stängel, Blatt, Blüte mit dunkler Mitte.
export function sonnenblumen(parent, spots) {
  viele(parent, new THREE.BoxGeometry(0.05, 1, 0.05), lambert("#4f9b4a"), spots.map(([x, z, h = 1]) => ({ p: [x, h * 0.5, z], s: [1, h, 1] })));
  viele(parent, new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10), lambert("#ffc62e"), spots.map(([x, z, h = 1]) => ({ p: [x, h + 0.05, z + 0.03], r: [Math.PI / 2 - 0.3, 0, 0] })));
  viele(parent, new THREE.CylinderGeometry(0.09, 0.09, 0.07, 8), lambert("#6b4423"), spots.map(([x, z, h = 1]) => ({ p: [x, h + 0.06, z + 0.06], r: [Math.PI / 2 - 0.3, 0, 0] })));
}

// Laubbäume (runde Kronen) an festen Stellen.
export function baeume(parent, spots, { stamm = "#7a5330", krone = "#4a9c4e", krone2 = "#6ab857", form = "blob" } = {}) {
  viele(parent, new THREE.BoxGeometry(0.26, 1, 0.26), lambert(stamm), spots.map(([x, z, h = 1.4]) => ({ p: [x, h * 0.35, z], s: [1, h * 0.7, 1] })), { schatten: true });
  const geo = form === "cone" ? new THREE.ConeGeometry(0.8, 1.7, 6) : new THREE.DodecahedronGeometry(0.85, 0);
  [krone, krone2].forEach((farbe, fi) => {
    viele(parent, geo, lambert(farbe), spots.filter((_, i) => i % 2 === fi).map(([x, z, h = 1.4]) => ({
      p: [x, h * 0.7 + (form === "cone" ? h * 0.55 : h * 0.4), z],
      r: [0, x * 0.7, 0],
      s: h * 0.72
    })), { schatten: true });
  });
}

// Berge als Horizont: flache Kegel mit Schneekappe.
export function berge(parent, spots, { color = "#8aa3b8", schnee = "#f4f8ff", schneeAnteil = 0.34 } = {}) {
  viele(parent, new THREE.ConeGeometry(1, 1, 5), lambert(color), spots.map(([x, z, h, b = h * 0.9]) => ({ p: [x, h / 2 - 0.2, z], r: [0, x * 0.3, 0], s: [b, h, b] })));
  viele(parent, new THREE.ConeGeometry(1, 1, 5), lambert(schnee), spots.map(([x, z, h, b = h * 0.9]) => ({
    p: [x, h - 0.2 - (h * schneeAnteil) / 2 + 0.02, z],
    r: [0, x * 0.3, 0],
    s: [b * schneeAnteil * 1.02, h * schneeAnteil, b * schneeAnteil * 1.02]
  })));
}

// Laternenmast mit leuchtendem Kopf.
export function laternen(parent, spots, { licht = "#fff1b8" } = {}) {
  viele(parent, new THREE.BoxGeometry(0.08, 1, 0.08), lambert("#3b3f4a"), spots.map(([x, z, h = 2]) => ({ p: [x, h / 2, z], s: [1, h, 1] })));
  viele(parent, new THREE.BoxGeometry(0.22, 0.26, 0.22), new THREE.MeshBasicMaterial({ color: licht }), spots.map(([x, z, h = 2]) => ({ p: [x, h + 0.12, z] })));
}

// Tribüne: Stufen mit bunten Zuschauer-Klötzchen.
export function tribuene(parent, [x, z], { breite = 6, stufen = 3, dreh = 0, color = "#9aa6b2", zuschauer = 0.7, seed = 3 } = {}) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = dreh;
  for (let i = 0; i < stufen; i += 1) {
    kiste(g, breite, 0.3 * (i + 1), 0.6, i % 2 ? color : "#b4bec8", [0, 0.15 * (i + 1), -i * 0.6]);
  }
  const zufall = streuer(seed);
  const farben = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b", "#b57bff", "#ff9f43", "#ffffff"];
  const koerper = farben.map(() => []);
  const koepfe = [];
  for (let i = 0; i < stufen; i += 1) {
    for (let s = -breite / 2 + 0.35; s < breite / 2 - 0.2; s += 0.5) {
      if (zufall() > zuschauer) continue;
      const fi = Math.floor(zufall() * farben.length);
      const hy = 0.3 * (i + 1);
      koerper[fi].push({ p: [s + (zufall() - 0.5) * 0.1, hy + 0.17, -i * 0.6], s: 1 });
      koepfe.push({ p: [s, hy + 0.43, -i * 0.6] });
    }
  }
  farben.forEach((farbe, fi) => viele(g, new THREE.BoxGeometry(0.3, 0.34, 0.24), lambert(farbe), koerper[fi]));
  viele(g, new THREE.BoxGeometry(0.2, 0.2, 0.2), lambert("#ffd9b8"), koepfe);
  parent.add(g);
  return g;
}

// Wolken aus ein paar Kugeln, flach gedrückt.
export function wolken(parent, spots, { color = "#ffffff", opacity = 0.95 } = {}) {
  const teile = [];
  spots.forEach(([x, y, z, s = 1]) => {
    [[0, 0, 0, 1], [0.8, -0.1, 0.1, 0.75], [-0.8, -0.12, 0, 0.7], [0.3, 0.3, -0.1, 0.7]].forEach(([dx, dy, dz, ds]) => {
      teile.push({ p: [x + dx * s, y + dy * s, z + dz * s], s: [ds * s, ds * s * 0.7, ds * s * 0.8] });
    });
  });
  return viele(parent, new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }), teile);
}

// Himmelsverlauf als grosse Kugel von innen. Ein einfarbiger Hintergrund wirkt
// wie ein Studio; ein Verlauf vom Horizont nach oben wie Himmel.
export function himmel(scene, { oben = "#6fc3ff", unten = "#d8f1ff", radius = 70 } = {}) {
  const geometry = new THREE.SphereGeometry(radius, 24, 12);
  const farben = [];
  const a = new THREE.Color(unten);
  const b = new THREE.Color(oben);
  const pos = geometry.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const t = Math.max(0, Math.min(1, pos.getY(i) / radius * 1.6 + 0.1));
    c.copy(a).lerp(b, t);
    farben.push(c.r, c.g, c.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(farben, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.renderOrder = -10;
  scene.add(mesh);
  return mesh;
}

// Beschriftetes Schild als Textur: Grund, Rahmen, Schrift. Mit `glow` leuchtet
// die Schrift wie Neon (für dunkle Wände).
export function schild(text, { breite = 512, hoehe = 128, grund = "#2f6fb0", schrift = "#ffffff", rahmen = "#ffffff", groesse = 58, glow = null } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = breite;
  canvas.height = hoehe;
  const ctx = canvas.getContext("2d");
  if (grund) {
    ctx.fillStyle = grund;
    ctx.fillRect(0, 0, breite, hoehe);
  }
  if (rahmen) {
    ctx.strokeStyle = rahmen;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, breite - 12, hoehe - 12);
  }
  ctx.font = `900 ${groesse}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
  }
  ctx.fillStyle = schrift;
  ctx.fillText(text, breite / 2, hoehe / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
