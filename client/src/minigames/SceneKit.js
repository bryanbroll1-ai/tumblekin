import * as THREE from "/vendor/three/three.module.js";
import { createOwnMarker, updateOwnMarker, disposeScene } from "./VoxelKit.js?v=tumblekin124";
import { qualityTier } from "./Quality.js?v=tumblekin124";

// Shared stage plumbing for the 3D minigames. Every minigame used to carry a
// byte-identical copy of the renderer setup, the resize handler, the own-marker
// block and the teardown sequence; these helpers hold the single copy.
//
// Each helper takes the minigame instance as `host` and reads/writes the same
// fields the games already used (canvas, webglCanvas, renderer, scene, camera,
// hud, ownMarker), so they stay drop-in and the games keep their own structure.

const MAX_PIXEL_RATIO = 2;

// Creates the WebGL canvas next to the 2D fallback canvas, plus renderer,
// scene and camera. Returns the stage so callers can destructure if they like.
export function mountStage(host, {
  label,
  background = "#9adcf2",
  fog = ["#a8e2f4", 18, 42],
  fov = 48,
  near = 0.1,
  far = 80,
  canvasClass = "kinetic-webgl"
} = {}) {
  host.canvas.hidden = true;

  const webglCanvas = document.createElement("canvas");
  webglCanvas.className = `${host.canvas.className} ${canvasClass}`;
  if (label) webglCanvas.setAttribute("aria-label", label);
  host.canvas.insertAdjacentElement("afterend", webglCanvas);
  host.webglCanvas = webglCanvas;

  const low = qualityTier() === "low";
  const renderer = new THREE.WebGLRenderer({
    canvas: webglCanvas,
    antialias: !low,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.5 : MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  // PCFSoft is noticeably pricier; basic PCF keeps shadows without the cost.
  renderer.shadowMap.type = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  host.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  if (fog) scene.fog = new THREE.Fog(fog[0], fog[1], fog[2]);
  host.scene = scene;

  host.camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  // Griff für den Rauchtest, damit er die Bildlast messen kann statt sie zu
  // schätzen. Kostet nichts und ist im Spiel nicht sichtbar.
  window.__tumblekinScene = host;
  return { webglCanvas, renderer, scene, camera: host.camera };
}

// Inserts the HUD overlay right after the WebGL canvas.
export function mountHud(host, innerHTML, className = "kinetic-hud") {
  const hud = document.createElement("div");
  hud.className = className;
  hud.innerHTML = innerHTML;
  host.webglCanvas.insertAdjacentElement("afterend", hud);
  host.hud = hud;
  return hud;
}

// The shared sun + hemisphere rig. Shadow bounds differ per game, so they are
// parameters rather than baked in.
export function addStageLights(scene, {
  sunPosition = [-4, 11, 6],
  shadow = {},
  hemiIntensity = 2.3,
  sunIntensity = 3.0,
  shadowMapSize = 1536,
  skyColor = 0xe8f6ff,
  groundColor = 0x7ab890,
  sunColor = 0xfff2cf,
  fillColor = 0xbcd8ff,
  fillIntensity = 0.85
} = {}) {
  scene.add(new THREE.HemisphereLight(skyColor, groundColor, hemiIntensity));
  const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
  sun.position.set(sunPosition[0], sunPosition[1], sunPosition[2]);
  sun.castShadow = true;
  // Halved on low-tier devices: a 512 map is the single biggest cheap saving.
  const mapSize = qualityTier() === "low" ? Math.max(256, shadowMapSize / 2) : shadowMapSize;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.camera.left = shadow.left ?? -8;
  sun.shadow.camera.right = shadow.right ?? 8;
  sun.shadow.camera.top = shadow.top ?? 8;
  sun.shadow.camera.bottom = shadow.bottom ?? -8;
  scene.add(sun);

  // Aufhelllicht von der Gegenseite, schwach und kühl. Mit nur einer Sonne
  // plus Himmelslicht kippt jede abgewandte Fläche ins Flache — bei
  // Voxelfiguren heisst das, dass zwei von drei sichtbaren Würfelseiten
  // dieselbe Farbe haben und die Form verschwindet. Das Gegenlicht trennt sie
  // wieder, ohne die Schattenrichtung anzutasten.
  //
  // Bewusst OHNE Schattenwurf: ein zweiter Schattendurchlauf ist auf dem Handy
  // das Teuerste, was man für so wenig Wirkung kaufen kann.
  const fill = new THREE.DirectionalLight(fillColor, fillIntensity);
  fill.position.set(-sunPosition[0], Math.max(2, sunPosition[1] * 0.45), -sunPosition[2]);
  scene.add(fill);

  return sun;
}

// Resizes the renderer to the CSS box when it actually changed. `tune` receives
// (portrait, camera) so each game can set its own camera framing — that is the
// only part that ever differed between the games. Returns true on a real resize.
export function resizeStage(host, tune, { minWidth = 320, minHeight = 240 } = {}) {
  const canvas = host.webglCanvas;
  if (!canvas || !host.renderer || !host.camera) return false;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(minWidth, Math.floor(rect.width));
  const height = Math.max(minHeight, Math.floor(rect.height));
  // Must match the ratio mountStage gave the renderer, or the size check below
  // never settles and every frame triggers a needless resize.
  const ratio = Math.min(window.devicePixelRatio || 1, qualityTier() === "low" ? 1.5 : MAX_PIXEL_RATIO);
  if (canvas.width === Math.floor(width * ratio) && canvas.height === Math.floor(height * ratio)) return false;
  host.renderer.setSize(width, height, false);
  host.camera.aspect = width / height;
  tune?.(height > width, host.camera);
  host.camera.updateProjectionMatrix();
  return true;
}

// Schiebt die Kamera so weit zurück, dass alle Figuren ins Bild passen.
//
// Auf einem hochkanten Handy ist der sichtbare Ausschnitt schmal — das
// Sichtfeld in three.js wird SENKRECHT gemessen, waagerecht bleibt davon nur
// das Seitenverhältnis übrig, bei 430×700 also gut die Hälfte. Gemessen standen
// deshalb in sieben Szenen Figuren ausserhalb des Bildes, in allen sieben auch
// die EIGENE. Wer sich selbst nicht sieht, spielt blind.
//
// Von Hand ist das nicht zu treffen: bei Sortierband hat es vier Anläufe
// gebraucht, und beim nächsten Layoutwechsel stimmt die geratene Zahl wieder
// nicht. Darum gerechnet.
//
// Die Rechnung ist exakt, wenn man NUR entlang der Blickachse zurückgeht: der
// seitliche Abstand eines Punktes im Kameraraum bleibt dabei gleich, nur die
// Tiefe wächst. Für jeden Punkt ergibt sich die nötige Tiefe direkt aus
// |x| ≤ Tiefe · tan(halbes waagerechtes Sichtfeld), analog für y.
export function fitKinsInView(host, { margin = 1.1, maxPush = 6 } = {}) {
  const camera = host?.camera;
  const scene = host?.scene;
  if (!camera || !scene) return 0;

  const punkte = [];
  scene.traverse((object) => {
    if (object.userData?.isKin && object.visible) punkte.push(object.getWorldPosition(new THREE.Vector3()));
  });
  if (punkte.length === 0) return 0;

  camera.updateMatrixWorld();
  const halbSenkrecht = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const halbWaagerecht = halbSenkrecht * camera.aspect;
  const blick = camera.getWorldDirection(new THREE.Vector3());

  let schub = 0;
  punkte.forEach((punkt) => {
    const relativ = punkt.clone().sub(camera.position);
    const tiefe = relativ.dot(blick);
    // Seitlicher und senkrechter Abstand zur Blickachse.
    const laengs = blick.clone().multiplyScalar(tiefe);
    const quer = relativ.clone().sub(laengs);
    const rechts = new THREE.Vector3().crossVectors(blick, camera.up).normalize();
    const hoch = new THREE.Vector3().crossVectors(rechts, blick).normalize();
    const x = Math.abs(quer.dot(rechts));
    const y = Math.abs(quer.dot(hoch));
    // Nötige Tiefe, damit der Punkt mit Rand hineinpasst.
    const noetig = Math.max(x * margin / halbWaagerecht, y * margin / halbSenkrecht);
    schub = Math.max(schub, noetig - tiefe);
  });

  schub = Math.min(Math.max(0, schub), maxPush);
  if (schub > 0.01) camera.position.addScaledVector(blick, -schub);
  return schub;
}

// Staffelt Namensschilder, die im Bild übereinander liegen.
//
// In den Bahnspielen — Zielgerade, Münzregen — stehen zu Rundenbeginn drei von
// vier Figuren fast auf demselben Punkt. Ihre Schilder liegen dann exakt
// übereinander und ergeben Buchstabensalat: man sieht vier Namen und kann
// keinen lesen. Wer waagerecht dicht beim Vordermann steht, bekommt sein
// Schild eine Stufe höher.
//
// Die Höhe wird jedes Bild neu von `grundY` aus gesetzt, damit sich das
// Anheben nicht über die Runde aufsummiert.
const _schildOrt = new THREE.Vector3();
export function entflechteSchilder(schilder, camera, { grundY = 0.62, stufe = 0.3, naehe = 0.15 } = {}) {
  if (!camera || !schilder || schilder.length < 2) return;
  const liste = [];
  schilder.forEach((sprite) => {
    if (!sprite) return;
    sprite.position.y = grundY;
    if (sprite.visible === false) return;
    liste.push(sprite);
  });
  if (liste.length < 2) return;
  camera.updateMatrixWorld();
  const punkte = liste.map((sprite) => ({
    sprite,
    x: sprite.getWorldPosition(_schildOrt).project(camera).x
  })).sort((a, b) => a.x - b.x);
  let stapel = 0;
  for (let i = 1; i < punkte.length; i += 1) {
    stapel = Math.abs(punkte[i].x - punkte[i - 1].x) < naehe ? stapel + 1 : 0;
    punkte[i].sprite.position.y = grundY + stapel * stufe;
  }
}

// Keeps the downward "you" arrow pinned over the controlled player's kin so you
// never lose yourself in the crowd. Pass the kin (or null to hide it).
export function syncOwnMarker(host, target, now, offset = 0.35, lift = 0.9) {
  if (!host.scene) return;
  if (!target) {
    if (host.ownMarker) host.ownMarker.visible = false;
    return;
  }
  if (!host.ownMarker) {
    host.ownMarker = createOwnMarker();
    host.scene.add(host.ownMarker);
  }
  host.ownMarker.visible = target.visible !== false;
  host.ownMarker.position.set(target.position.x, 0, target.position.z);
  updateOwnMarker(host.ownMarker, now, target.position.y + offset, lift);
}

// Frees GPU resources and removes the DOM the stage owns. Safe to call twice.
export function teardownStage(host) {
  if (window.__tumblekinScene === host) window.__tumblekinScene = null;
  host.bursts?.dispose();
  host.floaters?.dispose();
  if (host.scene) disposeScene(host.scene);
  host.renderer?.dispose();
  host.renderer?.forceContextLoss?.();
  host.webglCanvas?.remove();
  host.hud?.remove();
  host.webglCanvas = null;
  host.hud = null;
  host.scene = null;
  host.renderer = null;
  host.ownMarker = null;
  if (host.canvas) host.canvas.hidden = false;
}

// --- Kulisse: eine Wiese anziehen ---------------------------------------
//
// Zehn Szenen stehen auf derselben Fläche in derselben Farbe, und in fast allen
// war die untere Bildhälfte ein leerer grüner Wisch. Das ist kein Kamerafehler
// — die Handlung ist nun einmal ein waagrechter Streifen, und ein hochkantes
// Handy hat darüber und darunter Platz übrig. Was fehlt, ist Kulisse.
//
// Sie muss allerdings fast nichts kosten. Darum InstancedMesh: alle Grasbüschel
// zusammen sind EIN Zeichenaufruf, alle Blumen einer, alle Steine einer, der
// ganze Baumkranz zwei. Fünf Aufrufe für eine ganze Landschaft — zum Vergleich
// liegt eine Szene sonst bei zwanzig bis hundertfünfzig.
//
// Gestreut wird deterministisch aus dem Seed: dieselbe Szene sieht bei jedem
// Start gleich aus, sonst wäre kein Bildvergleich möglich.
function streuer(seed) {
  let zustand = (seed * 1103515245 + 12345) >>> 0;
  return () => {
    zustand = (zustand * 1664525 + 1013904223) >>> 0;
    return zustand / 4294967296;
  };
}

export function dressMeadow(scene, {
  groundY = 0,
  seed = 7,
  // Freizuhaltendes Rechteck um die Bildmitte — dort wird gespielt.
  keepOut = { x: 4.5, z: 3.2 },
  // Bis hierhin wird gestreut.
  spread = { x: 17, z: 15 },
  // Flecken im Boden. Sie sind das Wirksamste an der ganzen Kulisse: eine
  // gleichmässig grüne Fläche bleibt ein Wisch, egal wie viele Büschel man
  // darauf stellt — verstreute Einzelteile bräuchten Tausende, um als Textur
  // zu lesen. Ein Dutzend grosse, flache Flecken in benachbarten Grüntönen
  // erledigt dasselbe mit zwei Zeichenaufrufen. Derselbe Griff, der die
  // Kletterwand von einer Platte in geschichteten Fels verwandelt hat.
  patches = 26,
  patchColors = ["#74c465", "#8ad97a"],
  tufts = 240,
  flowers = 46,
  stones = 22,
  trees = 30,
  treeRing = { x: 15.5, z: 13.5 },
  // Vor dieser Tiefe stehen KEINE Bäume. Die Kamera schaut aus dem positiven z
  // heran; ein Baum, der neben ihr landet, füllt als dunkler Keil das halbe
  // Bild. Büschel und Steine dürfen dort bleiben, die sind klein genug.
  frontCut = 5,
  grassColor = "#6cb95c",
  flowerColors = ["#ffd15c", "#ff8fb1", "#ffffff", "#b98cff"],
  trunkColor = "#7a5330",
  crownColor = "#3f8f45",
  // Baumform. Ein gemeinsamer Kulissenhelfer macht Szenen konsistent — und
  // wenn man nicht aufpasst, austauschbar. Acht Spiele mit demselben Grün und
  // denselben Nadelbäumen sind acht Bilder derselben Wiese. Form und Palette
  // sind darum je Szene wählbar: derselbe Aufbau, ein anderer Ort.
  crownShape = "cone",
  // Ein zweiter Kronenton macht den Baumkranz lebendiger als eine Fläche in
  // einem einzigen Grün.
  crownColor2 = null
} = {}) {
  const zufall = streuer(seed);
  const hilfs = new THREE.Object3D();
  const gestreut = [];

  // Einen Punkt ausserhalb des Spielfelds finden. Nach zwanzig Fehlversuchen
  // wird der letzte genommen — lieber ein Büschel zu nah als eine Endlosschleife.
  const punkt = () => {
    for (let versuch = 0; versuch < 20; versuch += 1) {
      const x = (zufall() * 2 - 1) * spread.x;
      // Nach VORN gewichtet. Gleichmässig gestreut landet der grösste Teil
      // hinten in der Tiefe, wo perspektivisch ohnehin alles zusammenrückt —
      // und der leere Fleck, um den es geht, liegt vorn unten im Bild.
      const z = -spread.z + 2 * spread.z * Math.pow(zufall(), 0.6);
      if (Math.abs(x) > keepOut.x || Math.abs(z) > keepOut.z) return { x, z };
    }
    return { x: spread.x, z: spread.z };
  };

  const setzen = (geometry, material, anzahl, aufbau) => {
    if (anzahl <= 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, anzahl);
    for (let i = 0; i < anzahl; i += 1) {
      aufbau(hilfs, i);
      hilfs.updateMatrix();
      mesh.setMatrixAt(i, hilfs.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    gestreut.push(mesh);
    return mesh;
  };

  // Erst die Flecken, damit alles andere darüber liegt.
  patchColors.forEach((farbe, fi) => {
    setzen(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: farbe }),
      Math.ceil(patches / patchColors.length),
      (o) => {
        const x = (zufall() * 2 - 1) * spread.x;
        const z = -spread.z + 2 * spread.z * Math.pow(zufall(), 0.6);
        const breite = 2.5 + zufall() * 6.5;
        o.position.set(x, groundY + 0.008 + fi * 0.004, z);
        o.scale.set(breite, breite * (0.5 + zufall() * 0.7), 1);
        o.rotation.set(-Math.PI / 2, 0, zufall() * Math.PI);
      }
    );
  });

  // Grasbüschel — klein und zahlreich. In der ersten Fassung waren sie 0.36
  // hoch und bis 1.6 skaliert; neben einem Klotz von 0.46 sah das nicht nach
  // Gras aus, sondern nach einem Wald von Nadelbäumchen auf dem Rasen.
  setzen(
    new THREE.ConeGeometry(0.07, 0.2, 4),
    new THREE.MeshLambertMaterial({ color: grassColor }),
    tufts,
    (o) => {
      const p = punkt();
      const s = 0.6 + zufall() * 0.6;
      o.position.set(p.x, groundY + 0.1 * s, p.z);
      o.scale.set(s, s, s);
      o.rotation.set(0, zufall() * Math.PI, (zufall() - 0.5) * 0.2);
    }
  );

  // Blumen: vier Farben in einem Zeichenaufruf gehen nicht, also bekommt jede
  // Farbe ihren eigenen — vier winzige Aufrufe für den Farbtupfer, der eine
  // Wiese erst nach Wiese aussehen lässt.
  flowerColors.forEach((farbe, fi) => {
    setzen(
      new THREE.BoxGeometry(0.11, 0.11, 0.11),
      new THREE.MeshLambertMaterial({ color: farbe }),
      Math.ceil(flowers / flowerColors.length),
      (o) => {
        const p = punkt();
        o.position.set(p.x, groundY + 0.16 + (fi % 2) * 0.03, p.z);
        o.scale.setScalar(0.8 + zufall() * 0.5);
        o.rotation.set(0, zufall() * Math.PI, 0);
      }
    );
  });

  // Steine geben dem Grün etwas, woran sich das Auge festhält.
  setzen(
    new THREE.BoxGeometry(0.18, 0.12, 0.16),
    new THREE.MeshLambertMaterial({ color: "#9aa79b" }),
    stones,
    (o) => {
      const p = punkt();
      const s = 0.5 + zufall() * 0.7;
      o.position.set(p.x, groundY + 0.05 * s, p.z);
      o.scale.set(s, s * 0.8, s);
      o.rotation.set(0, zufall() * Math.PI, 0);
    }
  );

  // Baumreihe am Rand. Sie ist das Wichtigste an der ganzen Kulisse: ohne sie
  // stösst die Wiese als harte Kante gegen den Himmel, mit ihr hat das Bild
  // einen Horizont.
  const baumPunkt = (i) => {
    const winkel = (i / trees) * Math.PI * 2 + zufall() * 0.12;
    const streu = 0.85 + zufall() * 0.4;
    const x = Math.cos(winkel) * treeRing.x * streu;
    let z = Math.sin(winkel) * treeRing.z * streu;
    // Alles, was vor der Grenze landen würde, wird nach hinten gespiegelt —
    // so bleibt der Kranz gleich dicht, ohne dass ein Baum in die Kamera wächst.
    if (z > frontCut) z = frontCut - (z - frontCut) - 2;
    return { x, z };
  };
  const baumHoehe = [];
  // Kleiner als in der ersten Fassung: bei 1.5 bis 3.1 zogen die Bäume den
  // Blick vom Spiel weg, statt es zu rahmen.
  for (let i = 0; i < trees; i += 1) baumHoehe.push(1.1 + zufall() * 1.0);
  const baumOrt = [];
  for (let i = 0; i < trees; i += 1) baumOrt.push(baumPunkt(i));

  setzen(
    new THREE.BoxGeometry(0.26, 1, 0.26),
    new THREE.MeshLambertMaterial({ color: trunkColor }),
    trees,
    (o, i) => {
      o.position.set(baumOrt[i].x, groundY + baumHoehe[i] * 0.3, baumOrt[i].z);
      o.scale.set(1, baumHoehe[i] * 0.6, 1);
      o.rotation.set(0, 0, 0);
    }
  );
  const kroneGeo = () => (crownShape === "blob"
    ? new THREE.DodecahedronGeometry(1.05, 0)
    : crownShape === "palm"
      ? new THREE.ConeGeometry(1.25, 0.7, 5)
      : new THREE.ConeGeometry(0.95, 1.9, 6));
  const kronenToene = crownColor2 ? [crownColor, crownColor2] : [crownColor];
  kronenToene.forEach((ton, ti) => {
    setzen(
      kroneGeo(),
      new THREE.MeshLambertMaterial({ color: ton }),
      Math.ceil(trees / kronenToene.length),
      (o, i) => {
        const index = i * kronenToene.length + ti;
        if (index >= trees) { o.position.set(0, -999, 0); o.scale.setScalar(0.001); return; }
        const h = baumHoehe[index];
        const hoch = crownShape === "cone" ? h * 0.42 : h * 0.34;
        o.position.set(baumOrt[index].x, groundY + h * 0.6 + hoch, baumOrt[index].z);
        o.scale.setScalar(h * (crownShape === "cone" ? 0.62 : 0.5));
        o.rotation.set(0, index * 0.7, 0);
      }
    );
  });

  return gestreut;
}

// Dasselbe für Wasser. Beim Angelduell schaut man auf eine Fläche, auf der
// ausser einer Schnur nichts ist: kein Ufer, kein Horizont, nichts, woran sich
// die Entfernung des Fisches ablesen liesse. Eine Wasserfläche ohne Bezug ist
// noch leerer als eine Wiese ohne Bezug, weil sie nicht einmal Halme hat.
//
// Gebaut wird deshalb ein Ufer im Hintergrund, Schilf am Rand, Seerosen auf der
// Fläche und Tiefenbänder — dasselbe Mittel wie bei der Kletterwand: grosse
// flache Flächen in benachbarten Tönen, die aus einem Wisch eine Fläche mit
// Struktur machen.
export function dressWater(scene, {
  waterY = 0,
  seed = 3,
  // Wie weit reicht das Wasser nach hinten — dort liegt das Ufer.
  farZ = -34,
  nearZ = 2,
  width = 30,
  // Freizuhaltender Streifen in der Mitte: dort schwimmt der Fisch.
  laneHalf = 3.2,
  bands = 7,
  bandColors = ["#2f9bc9", "#37a4d1"],
  pads = 26,
  reeds = 60,
  shoreColor = "#7fc46a",
  shoreSand = "#e8d9a8",
  trees = 26
} = {}) {
  const zufall = (() => {
    let zustand = (seed * 1103515245 + 12345) >>> 0;
    return () => {
      zustand = (zustand * 1664525 + 1013904223) >>> 0;
      return zustand / 4294967296;
    };
  })();
  const hilfs = new THREE.Object3D();
  const teile = [];
  const setzen = (geometry, material, anzahl, aufbau) => {
    if (anzahl <= 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, anzahl);
    for (let i = 0; i < anzahl; i += 1) {
      aufbau(hilfs, i);
      hilfs.updateMatrix();
      mesh.setMatrixAt(i, hilfs.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    teile.push(mesh);
  };

  // Tiefenbänder quer zur Blickrichtung. Sie sind der einzige Anhaltspunkt
  // dafür, WIE WEIT der Fisch draussen ist — vorher lagen sie bei 8 % Deckkraft
  // und waren praktisch unsichtbar.
  bandColors.forEach((farbe, fi) => {
    setzen(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: farbe }),
      Math.ceil(bands / bandColors.length),
      (o, i) => {
        // Unregelmässig gesetzt und nur eine Nuance vom Wasser entfernt. Gleich
        // breit und gleich weit auseinander sahen die Bänder aus wie Streifen
        // auf einer Flagge, nicht wie Tiefe.
        const t = (i * bandColors.length + fi + zufall() * 0.7) / bands;
        const z = nearZ + (farZ - nearZ) * Math.min(1, t);
        o.position.set(0, waterY + 0.01 + fi * 0.004, z);
        o.scale.set(width, 1.2 + zufall() * 3.4, 1);
        o.rotation.set(-Math.PI / 2, 0, 0);
      }
    );
  });

  // Ufer hinten: erst Sand, dann Wiese, dann Bäume. Ohne das trifft das Wasser
  // als harte Kante auf den Himmel.
  const sand = new THREE.Mesh(
    new THREE.BoxGeometry(width + 18, 0.3, 3),
    new THREE.MeshLambertMaterial({ color: shoreSand })
  );
  sand.position.set(0, waterY - 0.02, farZ - 1);
  scene.add(sand);
  teile.push(sand);
  const wiese = new THREE.Mesh(
    new THREE.BoxGeometry(width + 26, 0.5, 22),
    new THREE.MeshLambertMaterial({ color: shoreColor })
  );
  wiese.position.set(0, waterY + 0.02, farZ - 13);
  wiese.receiveShadow = true;
  scene.add(wiese);
  teile.push(wiese);

  const baumHoehe = [];
  const baumOrt = [];
  for (let i = 0; i < trees; i += 1) {
    baumHoehe.push(1.4 + zufall() * 1.5);
    baumOrt.push({
      x: (zufall() * 2 - 1) * (width * 0.5 + 11),
      z: farZ - 3 - zufall() * 16
    });
  }
  setzen(
    new THREE.BoxGeometry(0.26, 1, 0.26),
    new THREE.MeshLambertMaterial({ color: "#7a5330" }),
    trees,
    (o, i) => {
      o.position.set(baumOrt[i].x, waterY + 0.25 + baumHoehe[i] * 0.3, baumOrt[i].z);
      o.scale.set(1, baumHoehe[i] * 0.6, 1);
      o.rotation.set(0, 0, 0);
    }
  );
  setzen(
    new THREE.ConeGeometry(0.95, 1.9, 6),
    new THREE.MeshLambertMaterial({ color: "#3f8f45" }),
    trees,
    (o, i) => {
      const h = baumHoehe[i];
      o.position.set(baumOrt[i].x, waterY + 0.25 + h * 0.6 + h * 0.42, baumOrt[i].z);
      o.scale.setScalar(h * 0.62);
      o.rotation.set(0, i * 0.7, 0);
    }
  );

  // Schilf an den Seiten — es rahmt die Bahn, ohne sie zuzustellen.
  setzen(
    new THREE.BoxGeometry(0.06, 0.9, 0.06),
    new THREE.MeshLambertMaterial({ color: "#4f9b4a" }),
    reeds,
    (o) => {
      const seite = zufall() < 0.5 ? -1 : 1;
      const x = seite * (laneHalf + 0.6 + zufall() * (width * 0.5 - laneHalf - 1));
      const z = nearZ + (farZ - nearZ) * zufall();
      const h = 0.7 + zufall() * 0.9;
      o.position.set(x, waterY + h * 0.45, z);
      o.scale.set(1, h, 1);
      o.rotation.set((zufall() - 0.5) * 0.25, zufall() * Math.PI, (zufall() - 0.5) * 0.25);
    }
  );

  // Seerosen: flache Scheiben, die die Fläche gliedern und Grösse zeigen.
  setzen(
    new THREE.CircleGeometry(0.42, 10),
    new THREE.MeshLambertMaterial({ color: "#4aa356" }),
    pads,
    (o) => {
      const seite = zufall() < 0.5 ? -1 : 1;
      const x = seite * (laneHalf + 0.3 + zufall() * (width * 0.5 - laneHalf));
      const z = nearZ + (farZ - nearZ) * zufall();
      o.position.set(x, waterY + 0.03, z);
      o.scale.setScalar(0.7 + zufall() * 0.8);
      o.rotation.set(-Math.PI / 2, 0, zufall() * Math.PI);
    }
  );

  return teile;
}
