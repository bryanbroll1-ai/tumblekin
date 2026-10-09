import * as THREE from "/vendor/three/three.module.js";

// Sortierband: die Dinge auf dem Band als echte kleine Modelle statt einer
// Kiste mit Symbolblase darüber. Jedes ist aus wenigen Grundformen gebaut,
// im selben Blocklook wie der Rest, steht mit der Unterseite auf y = 0 und
// ist etwa eine Einheit gross — die Szene skaliert es auf das Band.
//
// Die Verwechsler sind absichtlich ähnlich: die Orange ist rund und orange
// wie der Basketball, die Zitrone gelb wie der Tennisball, die Kirschen rot
// und an Fäden wie das Jo-Jo. Man muss hinschauen.
//
// Gebaut wird jedes Modell einmal; danach gibt es nur noch Klone, die sich
// Geometrie und Materialien teilen.

const mats = new Map();
function mat(color, extra = {}) {
  const key = `${color}|${extra.emissive || ""}|${extra.opacity ?? 1}`;
  if (!mats.has(key)) {
    mats.set(key, new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      ...(extra.opacity !== undefined ? { transparent: true, opacity: extra.opacity } : {}),
      ...(extra.emissive ? { emissive: extra.emissive, emissiveIntensity: extra.intensity ?? 0.3 } : {})
    }));
  }
  return mats.get(key);
}

// Grundformen; jede liefert ein Mesh, das der Bauplan danach setzt.
const shapes = {
  box: ([w, h, d]) => new THREE.BoxGeometry(w, h, d),
  sph: ([r, sx = 1, sy = 1, sz = 1]) => new THREE.IcosahedronGeometry(r, 1).scale(sx, sy, sz),
  ball: ([r]) => new THREE.IcosahedronGeometry(r, 0),
  cyl: ([rt, rb, h, seg = 10]) => new THREE.CylinderGeometry(rt, rb, h, seg),
  cone: ([r, h, seg = 8]) => new THREE.ConeGeometry(r, h, seg),
  tor: ([R, r, seg = 12]) => new THREE.TorusGeometry(R, r, 6, seg)
};

function part(group, type, dims, color, pos = [0, 0, 0], rot = [0, 0, 0], extra) {
  const mesh = new THREE.Mesh(shapes[type](dims), mat(color, extra));
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

const BUILDERS = {
  // --- Obst -----------------------------------------------------------------
  Banane(g) {
    for (let i = 0; i < 5; i += 1) {
      const a = (i - 2) * 0.32;
      part(g, "box", [0.2, 0.22, 0.24], "#ffd84a", [Math.sin(a) * 0.62, 0.42 - Math.cos(a) * 0.3, 0], [0, 0, a]);
    }
    part(g, "box", [0.08, 0.12, 0.1], "#6b4a20", [-0.6, 0.62, 0], [0, 0, -0.6]);
    part(g, "box", [0.07, 0.07, 0.08], "#3a2a12", [0.6, 0.62, 0], [0, 0, 0.6]);
  },
  Birne(g) {
    part(g, "sph", [0.36, 1, 0.95, 1], "#b9d84a", [0, 0.34, 0]);
    part(g, "sph", [0.22, 1, 1.2, 1], "#c8df5a", [0, 0.72, 0]);
    part(g, "box", [0.05, 0.16, 0.05], "#6b4a20", [0, 1.0, 0]);
  },
  Trauben(g) {
    const rows = [[0.62, 4, 0.2], [0.44, 3, 0.16], [0.28, 2, 0.11], [0.14, 1, 0]];
    rows.forEach(([y, n, spread]) => {
      for (let i = 0; i < n; i += 1) {
        const x = n === 1 ? 0 : -spread + (i / (n - 1)) * spread * 2;
        part(g, "ball", [0.13], i % 2 ? "#7b3fb0" : "#8d4fc4", [x, y, (i % 2) * 0.08]);
      }
    });
    part(g, "box", [0.05, 0.18, 0.05], "#4f7a2a", [0, 0.82, 0]);
    part(g, "box", [0.2, 0.04, 0.14], "#5fae4f", [0.1, 0.84, 0], [0, 0, -0.3]);
  },
  Erdbeere(g) {
    part(g, "cone", [0.34, 0.62, 8], "#e8323f", [0, 0.31, 0], [Math.PI, 0, 0]);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      part(g, "box", [0.04, 0.04, 0.04], "#ffe47a", [Math.cos(a) * 0.2, 0.42, Math.sin(a) * 0.2]);
    }
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      part(g, "box", [0.22, 0.04, 0.08], "#3f9a3f", [Math.cos(a) * 0.12, 0.64, Math.sin(a) * 0.12], [0, -a, 0]);
    }
  },
  Melone(g) {
    part(g, "sph", [0.48, 1.1, 0.85, 0.95], "#3e9a45", [0, 0.42, 0]);
    for (let i = -2; i <= 2; i += 1) part(g, "box", [0.06, 0.66, 1.0], "#2a6e32", [i * 0.2, 0.42, 0]);
  },
  Ananas(g) {
    part(g, "cyl", [0.26, 0.3, 0.62, 8], "#d8a23a", [0, 0.31, 0]);
    for (let i = 0; i < 4; i += 1) part(g, "box", [0.62, 0.04, 0.62], "#9a6a1e", [0, 0.1 + i * 0.14, 0], [0, i * 0.4, 0]);
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      part(g, "cone", [0.07, 0.4, 4], "#3f9a3f", [Math.cos(a) * 0.08, 0.82, Math.sin(a) * 0.08], [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4]);
    }
  },
  Apfel(g) {
    part(g, "sph", [0.4, 1, 0.9, 1], "#e8323f", [0, 0.38, 0]);
    part(g, "box", [0.05, 0.16, 0.05], "#6b4a20", [0, 0.78, 0]);
    part(g, "box", [0.16, 0.04, 0.1], "#57c86a", [0.1, 0.8, 0], [0, 0, -0.3]);
  },
  Pfirsich(g) {
    part(g, "sph", [0.38, 1, 0.95, 1], "#ffab7a", [0, 0.37, 0]);
    part(g, "box", [0.04, 0.5, 0.02], "#f08a5a", [0, 0.42, 0.37]);
    part(g, "box", [0.18, 0.04, 0.1], "#57c86a", [0.08, 0.76, 0], [0, 0, -0.4]);
  },
  // --- Müll -----------------------------------------------------------------
  Dose(g) {
    part(g, "cyl", [0.26, 0.26, 0.66, 10], "#b9c2cc", [0, 0.33, 0]);
    part(g, "cyl", [0.265, 0.265, 0.34, 10], "#d83a3a", [0, 0.34, 0]);
    part(g, "cyl", [0.22, 0.22, 0.03, 10], "#8a949e", [0, 0.67, 0]);
    // Eingedellt: ein Knick in der Seite.
    part(g, "box", [0.12, 0.2, 0.06], "#9aa3ad", [0.2, 0.18, 0.12], [0, 0.6, 0]);
  },
  Becher(g) {
    part(g, "cyl", [0.27, 0.2, 0.64, 10], "#ffffff", [0, 0.32, 0]);
    part(g, "cyl", [0.28, 0.28, 0.05, 10], "#e8eef4", [0, 0.66, 0]);
    part(g, "box", [0.05, 0.4, 0.05], "#ff5d73", [0.08, 0.86, 0], [0, 0, -0.2]);
    part(g, "cyl", [0.275, 0.24, 0.16, 10], "#28c7d9", [0, 0.36, 0]);
  },
  Zeitung(g) {
    part(g, "box", [0.86, 0.12, 0.6], "#e6e2d6", [0, 0.06, 0], [0, 0.2, 0]);
    part(g, "box", [0.8, 0.12, 0.56], "#d8d4c6", [0.03, 0.18, 0.02], [0, 0.3, 0.06]);
    for (let i = 0; i < 4; i += 1) part(g, "box", [0.5, 0.01, 0.04], "#3d4a58", [0.0, 0.245, -0.18 + i * 0.12], [0, 0.3, 0.06]);
  },
  "leere Batterie"(g) {
    part(g, "cyl", [0.17, 0.17, 0.72, 10], "#2b2f36", [0, 0.36, 0], [0, 0, 0]);
    part(g, "cyl", [0.175, 0.175, 0.22, 10], "#c48a3a", [0, 0.6, 0]);
    part(g, "cyl", [0.07, 0.07, 0.06, 8], "#b9c2cc", [0, 0.75, 0]);
    part(g, "box", [0.08, 0.12, 0.02], "#ff3b3b", [0, 0.3, 0.17]);
  },
  Schachtel(g) {
    part(g, "cyl", [0.42, 0.3, 0.5, 4], "#ffffff", [0, 0.25, 0], [0, Math.PI / 4, 0]);
    part(g, "box", [0.04, 0.3, 0.04], "#d83a3a", [-0.2, 0.62, 0]);
    part(g, "box", [0.04, 0.3, 0.04], "#d83a3a", [0.2, 0.62, 0]);
    part(g, "box", [0.44, 0.04, 0.04], "#d83a3a", [0, 0.77, 0]);
    part(g, "box", [0.2, 0.2, 0.01], "#d83a3a", [0, 0.27, 0.27]);
  },
  Knochen(g) {
    part(g, "cyl", [0.09, 0.09, 0.8, 8], "#f4efe2", [0, 0.2, 0], [0, 0, Math.PI / 2]);
    [[-0.42, 0.12], [-0.42, -0.12], [0.42, 0.12], [0.42, -0.12]].forEach(([x, z]) => part(g, "ball", [0.13], "#f4efe2", [x, 0.2, z]));
  },
  "Socke mit Loch"(g) {
    part(g, "box", [0.3, 0.6, 0.22], "#ffffff", [0, 0.42, 0]);
    part(g, "box", [0.5, 0.24, 0.22], "#ffffff", [0.1, 0.12, 0]);
    part(g, "box", [0.32, 0.08, 0.23], "#ff5d73", [0, 0.62, 0]);
    part(g, "box", [0.32, 0.08, 0.23], "#28c7d9", [0, 0.46, 0]);
    part(g, "box", [0.14, 0.12, 0.02], "#2b2f36", [0.24, 0.12, 0.115]);
  },
  "leere Flasche"(g) {
    part(g, "cyl", [0.22, 0.22, 0.56, 10], "#3fae6a", [0, 0.28, 0], [0, 0, 0], { opacity: 0.85 });
    part(g, "cyl", [0.09, 0.2, 0.18, 10], "#3fae6a", [0, 0.65, 0], [0, 0, 0], { opacity: 0.85 });
    part(g, "cyl", [0.08, 0.08, 0.2, 8], "#3fae6a", [0, 0.84, 0], [0, 0, 0], { opacity: 0.85 });
    part(g, "box", [0.3, 0.2, 0.02], "#f4efe2", [0, 0.3, 0.22]);
  },
  // --- Spielzeug ---------------------------------------------------------------
  Teddy(g) {
    part(g, "sph", [0.3, 1, 1.1, 0.9], "#b9814a", [0, 0.32, 0]);
    part(g, "ball", [0.24], "#c48a52", [0, 0.78, 0]);
    part(g, "ball", [0.09], "#b9814a", [-0.18, 0.98, 0]);
    part(g, "ball", [0.09], "#b9814a", [0.18, 0.98, 0]);
    part(g, "ball", [0.08], "#e8c49a", [0, 0.72, 0.2]);
    part(g, "box", [0.05, 0.05, 0.02], "#1b2530", [-0.08, 0.84, 0.22]);
    part(g, "box", [0.05, 0.05, 0.02], "#1b2530", [0.08, 0.84, 0.22]);
    part(g, "ball", [0.1], "#b9814a", [-0.3, 0.42, 0.06]);
    part(g, "ball", [0.1], "#b9814a", [0.3, 0.42, 0.06]);
    part(g, "box", [0.3, 0.06, 0.04], "#ff5d73", [0, 0.58, 0.18]);
  },
  Drachen(g) {
    // Steht schräg auf seiner Spitze, darunter der Schwanz mit drei Schleifen.
    part(g, "box", [0.56, 0.56, 0.04], "#ff5d73", [0, 0.66, 0], [0, 0, Math.PI / 4]);
    part(g, "box", [0.38, 0.38, 0.045], "#ffd15c", [0, 0.66, 0.002], [0, 0, Math.PI / 4]);
    part(g, "box", [0.03, 0.78, 0.05], "#8a5a2c", [0, 0.66, 0.03]);
    part(g, "box", [0.78, 0.03, 0.05], "#8a5a2c", [0, 0.66, 0.03]);
    ["#28c7d9", "#71d97b", "#9b83d9"].forEach((color, i) => {
      part(g, "box", [0.14, 0.06, 0.04], color, [(i % 2 ? 0.08 : -0.06), 0.2 - i * 0.07, 0.02], [0, 0, i % 2 ? -0.5 : 0.5]);
    });
  },
  Würfel(g) {
    part(g, "box", [0.62, 0.62, 0.62], "#ffffff", [0, 0.31, 0]);
    const dot = (x, y, z) => part(g, "box", [0.1, 0.1, 0.1], "#1b2530", [x, y, z]);
    dot(0, 0.31, 0.27);
    dot(-0.15, 0.46, 0.27); dot(0.15, 0.16, 0.27);
    dot(0.27, 0.31, 0); dot(0.27, 0.46, 0.15); dot(0.27, 0.16, -0.15);
    dot(0, 0.58, 0); dot(-0.15, 0.58, -0.15); dot(0.15, 0.58, 0.15); dot(-0.15, 0.58, 0.15); dot(0.15, 0.58, -0.15);
  },
  Puzzle(g) {
    part(g, "box", [0.62, 0.14, 0.62], "#5c9dff", [0, 0.07, 0]);
    part(g, "cyl", [0.13, 0.13, 0.14, 10], "#5c9dff", [0.38, 0.07, 0]);
    part(g, "cyl", [0.13, 0.13, 0.14, 10], "#5c9dff", [0, 0.07, -0.38]);
    part(g, "cyl", [0.12, 0.12, 0.16, 10], "#2b2f36", [-0.31, 0.08, 0]);
  },
  Ballon(g) {
    part(g, "sph", [0.34, 1, 1.15, 1], "#ff3b55", [0, 0.72, 0], [0, 0, 0], { emissive: "#ff3b55", intensity: 0.15 });
    part(g, "cone", [0.06, 0.08, 6], "#c41f3c", [0, 0.31, 0], [Math.PI, 0, 0]);
    part(g, "box", [0.02, 0.3, 0.02], "#f4efe2", [0, 0.12, 0]);
    part(g, "box", [0.08, 0.12, 0.02], "#ffffff", [-0.12, 0.88, 0.3], [0, 0, 0.4], { opacity: 0.7 });
  },
  Fussball(g) {
    part(g, "sph", [0.4], "#ffffff", [0, 0.4, 0]);
    [[0, 0.8, 0.0], [0, 0.4, 0.4], [0.38, 0.52, 0.1], [-0.38, 0.52, 0.1], [0.24, 0.22, 0.3], [-0.24, 0.22, 0.3]].forEach(([x, y, z]) => {
      const m = part(g, "cyl", [0.11, 0.11, 0.03, 5], "#1b2530", [x, y, z]);
      m.lookAt(new THREE.Vector3(x, y, z).multiplyScalar(2).add(new THREE.Vector3(0, -0.4, 0)));
      m.rotateX(Math.PI / 2);
    });
  },
  Spielzeugzug(g) {
    part(g, "box", [0.7, 0.3, 0.36], "#e8323f", [0, 0.3, 0]);
    part(g, "box", [0.3, 0.28, 0.36], "#2f6fd6", [-0.2, 0.59, 0]);
    part(g, "cyl", [0.08, 0.1, 0.26, 8], "#2b2f36", [0.24, 0.58, 0]);
    part(g, "box", [0.36, 0.06, 0.4], "#ffd15c", [-0.2, 0.76, 0]);
    [[-0.22, 0.2], [0.22, 0.2], [-0.22, -0.2], [0.22, -0.2]].forEach(([x, z]) => part(g, "cyl", [0.12, 0.12, 0.06, 10], "#2b2f36", [x, 0.12, z], [Math.PI / 2, 0, 0]));
  },
  Puppe(g) {
    part(g, "sph", [0.32, 1, 1.05, 1], "#e8323f", [0, 0.34, 0]);
    part(g, "ball", [0.24], "#e8323f", [0, 0.8, 0]);
    part(g, "sph", [0.16, 1, 1, 0.5], "#f6d2b0", [0, 0.8, 0.13]);
    part(g, "box", [0.04, 0.04, 0.02], "#1b2530", [-0.06, 0.83, 0.21]);
    part(g, "box", [0.04, 0.04, 0.02], "#1b2530", [0.06, 0.83, 0.21]);
    part(g, "box", [0.3, 0.2, 0.02], "#ffd15c", [0, 0.36, 0.31]);
  },
  // --- Verwechsler -------------------------------------------------------------
  Orange(g) {
    part(g, "sph", [0.4], "#ff9a2e", [0, 0.4, 0]);
    part(g, "box", [0.05, 0.08, 0.05], "#6b4a20", [0, 0.81, 0]);
    part(g, "box", [0.18, 0.04, 0.1], "#57c86a", [0.1, 0.82, 0], [0, 0, -0.3]);
  },
  Basketball(g) {
    part(g, "sph", [0.4], "#e8762a", [0, 0.4, 0]);
    part(g, "tor", [0.405, 0.022, 18], "#1b2530", [0, 0.4, 0]);
    part(g, "tor", [0.405, 0.022, 18], "#1b2530", [0, 0.4, 0], [0, Math.PI / 2, 0]);
    part(g, "tor", [0.405, 0.022, 18], "#1b2530", [0, 0.4, 0], [Math.PI / 2, 0, 0]);
  },
  Zitrone(g) {
    part(g, "sph", [0.34, 1.35, 0.95, 0.95], "#ffe14a", [0, 0.33, 0]);
    part(g, "cone", [0.08, 0.14, 6], "#f2cf2a", [0.5, 0.33, 0], [0, 0, -Math.PI / 2]);
    part(g, "cone", [0.08, 0.14, 6], "#f2cf2a", [-0.5, 0.33, 0], [0, 0, Math.PI / 2]);
  },
  Tennisball(g) {
    part(g, "sph", [0.34], "#d8ef3a", [0, 0.34, 0]);
    part(g, "tor", [0.345, 0.025, 18], "#ffffff", [0, 0.34, 0], [0.5, 0, 0.3]);
  },
  Kirschen(g) {
    part(g, "ball", [0.2], "#c41f3c", [-0.2, 0.2, 0]);
    part(g, "ball", [0.2], "#d8344a", [0.2, 0.2, 0.04]);
    part(g, "box", [0.03, 0.6, 0.03], "#4f7a2a", [-0.1, 0.62, 0], [0, 0, -0.35]);
    part(g, "box", [0.03, 0.6, 0.03], "#4f7a2a", [0.1, 0.62, 0], [0, 0, 0.35]);
    part(g, "box", [0.22, 0.04, 0.1], "#57c86a", [0.08, 0.92, 0], [0, 0, -0.3]);
  },
  "Jo-Jo"(g) {
    part(g, "cyl", [0.3, 0.3, 0.12, 12], "#d8344a", [0, 0.32, 0.1], [Math.PI / 2, 0, 0]);
    part(g, "cyl", [0.3, 0.3, 0.12, 12], "#d8344a", [0, 0.32, -0.1], [Math.PI / 2, 0, 0]);
    part(g, "cyl", [0.08, 0.08, 0.1, 8], "#f4efe2", [0, 0.32, 0], [Math.PI / 2, 0, 0]);
    part(g, "box", [0.02, 0.5, 0.02], "#f4efe2", [0, 0.86, 0]);
    part(g, "tor", [0.06, 0.015, 8], "#f4efe2", [0, 1.12, 0]);
  }
};

const prototypes = new Map();

// Ein Modell für den Namen (wie der Server ihn schickt). Unbekanntes wird ein
// schlichtes Paket, damit nie etwas leer bleibt.
export function buildSortItem(name) {
  if (!prototypes.has(name)) {
    const group = new THREE.Group();
    const build = BUILDERS[name];
    if (build) build(group);
    else part(group, "box", [0.6, 0.5, 0.6], "#c9a26f", [0, 0.25, 0]);
    prototypes.set(name, group);
  }
  return prototypes.get(name).clone();
}

export const SORT_ITEM_NAMES = Object.keys(BUILDERS);
