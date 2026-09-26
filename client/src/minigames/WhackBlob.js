import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Blob-Klopfe: aus zwölf Löchern (3 breit, 4 tief — hochkant wie das Handy)
// kommen Blobs. Wer schnell draufhaut, bekommt mehr (3/2/1 Punkte), der
// goldene bringt 5. Die dunkelroten mit Stachelkrone tun weh: zwei Punkte weg
// und kurz benommen.
//
// Getroffen wird, was man SIEHT: ein Tipp auf den Blob zählt für sein Loch.
// Vorher wurde auf eine Ebene in Bodenhöhe gezielt — der Blob ragt aber fast
// einen Meter heraus, und bei der schrägen Kamera landete ein Tipp auf seinen
// Kopf oft in der Reihe dahinter.
//
// Vorher gab es keine Figuren, nur einen Hammer, der aus dem Nichts
// erschien. Jetzt stehen alle mit ihrem Holzhammer an den Ecken des Hügels,
// springen zum Loch, in dem sie getroffen haben, holen über den Kopf aus und
// hauen drauf. Wer einen Stachelblob erwischt, fliegt zurück und sieht
// Sterne.
const CELL = 1.35;
const COLS = 3;
const ROWS = 4;
const HOME = 2.05;
const HOME_Z = (ROWS / 2) * CELL + 0.1;
const MOUND_TOP = 0.3;
// Nach dem Schlag bleibt die Figur so lange am Loch, dann springt sie zurück.
const STAY_MS = 650;
const LAND_GAP = 0.8;          // Landeabstand zur Lochmitte
const HOLE_CLEAR = 0.85;       // so weit bleibt die Figur von jedem anderen Loch weg

// Ein Sprung dauert mit der Weite etwas länger — der weiteste landet genau im
// Schlag der Hammer-Bewegung (dig schlägt nach knapp 300 ms zu).
function leapMs(from, to) {
  return 170 + Math.hypot(to.x - from.x, to.z - from.z) * 25;
}

export class WhackBlob extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.blobs = new Map();
    this.hitsSeen = new Map();
    this.lastBad = new Map();
    this.swings = new Map();
    this.raycaster = new THREE.Raycaster();
    this.labelY = 0.74;
  }

  stage() {
    return { label: "3D Blob-Klopfe", background: "#a8e2f4", fog: ["#a8e2f4", 16, 40], lights: { shadow: { left: -6, right: 6, top: 6, bottom: -6 } } };
  }

  // Wo die Figur neben dem Loch landet: in Richtung ihrer Ecke, aber nie auf
  // dem Erdwall eines ANDEREN Lochs. Stur in Richtung Ecke landete sie bei
  // Löchern in einer Reihe genau auf dem Rand des Nachbarlochs — poppte dort
  // ein Blob hoch, steckte er ihr in den Füssen.
  landingSpot(pos, home) {
    const base = Math.atan2(home.x - pos.x, home.z - pos.z);
    const holes = Array.from({ length: COLS * ROWS }, (_, cell) => this.cellPos(cell));
    // Sechzehn Richtungen, die zur eigenen Ecke zuerst.
    const turns = Array.from({ length: 16 }, (_, i) => ((i + 1) >> 1) * (i % 2 ? 1 : -1) * (Math.PI / 8));
    for (const turn of turns) {
      const angle = base + turn;
      const spot = new THREE.Vector3(pos.x + Math.sin(angle) * LAND_GAP, 0, pos.z + Math.cos(angle) * LAND_GAP);
      const clear = holes.every((hole) => (hole.x === pos.x && hole.z === pos.z)
        || Math.hypot(hole.x - spot.x, hole.z - spot.z) >= HOLE_CLEAR);
      if (clear) return spot;
    }
    return new THREE.Vector3(pos.x + Math.sin(base) * LAND_GAP, 0, pos.z + Math.cos(base) * LAND_GAP);
  }

  cellPos(cell) {
    const gx = cell % COLS;
    const gy = Math.floor(cell / COLS);
    return { x: (gx - (COLS - 1) / 2) * CELL, z: (gy - (ROWS - 1) / 2) * CELL };
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    // Kulisse: Bodenflecken, Büschel, Blumen, Steine und ein Baumkranz als
    // Horizont. Ohne sie stösst die Wiese als harte Kante gegen den Himmel.
    dressMeadow(this.scene, { seed: 10, keepOut: { x: 4.4, z: 5.2 }, spread: { x: 16, z: 15 }, grassColor: "#57ab52", patchColors: ["#69bd5f", "#87d276"], crownColor: "#2f7f45", crownColor2: "#4a9c58", crownShape: "blob", trees: 20, flowers: 80 });
    this.buildGarden(scene);
    const mound = new THREE.Mesh(
      new THREE.BoxGeometry(CELL * COLS + 0.9, 0.4, CELL * ROWS + 0.9),
      new THREE.MeshLambertMaterial({ color: "#8ad07f" })
    );
    mound.position.y = 0.1;
    mound.receiveShadow = true;
    scene.add(mound);
    // Invisible pick plane spanning the 3x3 field for direct hole taps.
    this.cellPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * COLS + 0.6, CELL * ROWS + 0.6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.cellPlane.rotation.x = -Math.PI / 2;
    this.cellPlane.position.y = 0.34;
    scene.add(this.cellPlane);
    // Echte Erdlöcher statt schwarzer Quadrate.
    //
    // Vorher lag über jeder Zelle eine dunkle Platte — und zwar OBERHALB der
    // Grasnarbe. Damit sah das Feld aus wie neun aufgemalte Kacheln, aus denen
    // dann unvermittelt ein Blob wuchs. Ein Loch braucht drei Dinge: einen
    // Rand, der herausschaut, eine Wand, die nach innen führt, und einen
    // Grund, der dunkel genug ist, dass man nicht hineinsieht.
    const GRAS_Y = 0.3;                  // Oberkante des Hügels
    const schachtMat = new THREE.MeshLambertMaterial({ color: "#4a3826" });
    const grundMat = new THREE.MeshLambertMaterial({ color: "#241a10" });
    const randMat = new THREE.MeshLambertMaterial({ color: "#8a6a45" });
    for (let cell = 0; cell < COLS * ROWS; cell += 1) {
      const pos = this.cellPos(cell);
      // Aufgeworfene Erde rundherum — der Teil, den man von oben zuerst sieht.
      const rand = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.08, 6, 16), randMat);
      rand.rotation.x = Math.PI / 2;
      rand.position.set(pos.x, GRAS_Y + 0.03, pos.z);
      rand.receiveShadow = true;
      scene.add(rand);
      // Der dunkle Grund liegt ÜBER der Grasnarbe, nicht darunter.
      //
      // Naheliegend wäre ein echter Schacht: Wand nach unten, Boden tief drin.
      // Nur ist der Hügel ein massiver Quader — seine Deckfläche verdeckt alles
      // darunter, und im Bild blieben neun Ringe mit Gras darin. Ein Loch von
      // schräg oben ist ohnehin fast nur seine Öffnung: eine dunkle Scheibe
      // knapp über dem Gras, gefasst von aufgeworfener Erde, liest sich als
      // Loch — und der Blob steigt weiterhin von unten durch den Hügel herauf
      // und erscheint genau dort.
      const grund = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), grundMat);
      grund.rotation.x = -Math.PI / 2;
      grund.position.set(pos.x, GRAS_Y + 0.02, pos.z);
      scene.add(grund);
      // Ein zweiter, kleinerer Ring gibt der Öffnung Tiefe, ohne dass ein
      // einziges Dreieck mehr im Boden verschwindet.
      const tiefe = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), schachtMat);
      tiefe.rotation.x = -Math.PI / 2;
      tiefe.position.set(pos.x, GRAS_Y + 0.025, pos.z - 0.06);
      scene.add(tiefe);
    }

    // A picket fence and flowers frame the field so it doesn't float in
    // empty green.
    const fenceMat = new THREE.MeshLambertMaterial({ color: "#e8d8b0" });
    for (let i = -4; i <= 4; i += 1) {
      [-4.1, 4.1].forEach((z) => {
        const picket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.12), fenceMat);
        picket.position.set(i * 0.85, 0.28, z);
        scene.add(picket);
      });
      const rail = i < 4 ? null : new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.1, 0.08), fenceMat);
      if (rail) {
        [-4.1, 4.1].forEach((z) => {
          const bar = rail.clone();
          bar.position.set(0, 0.44, z);
          scene.add(bar);
        });
      }
    }
    const flowerColors = ["#ff8aa0", "#ffd15c", "#8f6ae0", "#5c9dff"];
    [[-3.4, -2.2], [3.5, -1.4], [-3.6, 1.8], [3.3, 2.4], [-2.6, 3.1], [2.4, -3.1]].forEach(([x, z], index) => {
      const stem = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.07), new THREE.MeshLambertMaterial({ color: "#4f9b4a" }));
      stem.position.set(x, 0.15, z);
      scene.add(stem);
      const bloom = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshLambertMaterial({ color: flowerColors[index % flowerColors.length] })
      );
      bloom.position.set(x, 0.36, z);
      scene.add(bloom);
    });

    [[-6, 5, -4, 5], [6, 5.6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // A cartoon mallet that swings down on the blob you bonk.
    const homes = [[-HOME, HOME_Z], [HOME, HOME_Z], [-HOME, -HOME_Z], [HOME, -HOME_Z]];
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const [x, z] = homes[index % homes.length];
      const kin = this.addKin(player, index, { x, ground: MOUND_TOP, z, facing: Math.atan2(-x, -z) });
      // Holzhammer in der rechten Hand, Kopf in der Spielerfarbe.
      const mallet = new THREE.Group();
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.46), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
      handle.position.z = 0.2;
      mallet.add(handle);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: player.color }));
      head.position.z = 0.44;
      mallet.add(head);
      mallet.position.set(0, -0.18, 0.02);
      kin.userData.arms?.[1]?.add(mallet);
      this.swings.set(player.id, { home: new THREE.Vector3(x, 0, z), target: null, at: -1e9 });
    });
  }

  // Blobs mit Charakter: gerundeter Körper aus drei Lagen, grosse Augen mit
  // Pupillen, Mund, rote Bäckchen. Stachelblobs sind dunkelrot, mit
  // Stachelkrone, bösen Brauen und Zähnen — von weitem an der Form zu
  // erkennen, nicht nur an der Farbe. Der goldene glänzt und funkelt.
  buildBlob(kind) {
    const blob = new THREE.Group();
    const palette = kind === "bad"
      ? { body: "#b3122a", belly: "#d8344a", dark: "#5a0612" }
      : kind === "gold"
        ? { body: "#ffc52e", belly: "#ffe07a", dark: "#a8741a" }
        : { body: "#8f6ae0", belly: "#b39af0", dark: "#4a2f9a" };
    const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
    const bodyMat = mat(palette.body, kind === "gold" ? { emissive: "#c48a1a", emissiveIntensity: 0.35 } : {});
    const body = new THREE.Group();
    [[0.7, 0.26, 0.7, 0.13], [0.62, 0.22, 0.62, 0.37], [0.46, 0.14, 0.46, 0.55]].forEach(([w, h, d, y]) => {
      const layer = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
      layer.position.y = y;
      layer.castShadow = true;
      body.add(layer);
    });
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.04), mat(palette.belly));
    belly.position.set(0, 0.2, 0.36);
    body.add(belly);
    blob.add(body);
    // Augen: weiss mit Pupille, schauen zur Kamera.
    [[-0.14], [0.14]].forEach(([x]) => {
      const white = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.04), mat("#ffffff"));
      white.position.set(x, 0.42, 0.315);
      blob.add(white);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.03), mat("#1b2530"));
      pupil.position.set(x, 0.41, 0.34);
      blob.add(pupil);
    });
    if (kind === "bad") {
      // Böse Brauen, Zähne und eine Krone aus Stacheln.
      [[-0.14, 0.2], [0.14, -0.2]].forEach(([x, tilt]) => {
        const brow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.04), mat(palette.dark));
        brow.position.set(x, 0.53, 0.33);
        brow.rotation.z = tilt;
        blob.add(brow);
      });
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.04), mat("#2a0508"));
      mouth.position.set(0, 0.26, 0.37);
      blob.add(mouth);
      [-0.08, 0.08].forEach((x) => {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), mat("#ffffff"));
        tooth.position.set(x, 0.29, 0.39);
        blob.add(tooth);
      });
      const spikeMat = mat("#ffe1e1", { emissive: "#ff4d5e", emissiveIntensity: 0.25 });
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 5), spikeMat);
        spike.position.set(Math.cos(angle) * 0.2, 0.7, Math.sin(angle) * 0.2);
        spike.rotation.set(Math.sin(angle) * 0.5, 0, -Math.cos(angle) * 0.5);
        blob.add(spike);
      }
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), spikeMat);
      top.position.y = 0.76;
      blob.add(top);
    } else {
      const smile = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.04), mat("#3a1f4a"));
      smile.position.set(0, 0.27, 0.37);
      blob.add(smile);
      [-0.24, 0.24].forEach((x) => {
        const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03), mat("#ff9ac0"));
        cheek.position.set(x, 0.31, 0.35);
        blob.add(cheek);
      });
      // Ein kleiner Schopf — der gute Blob ist rund und freundlich.
      const tuft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), bodyMat);
      tuft.position.set(0.04, 0.68, 0);
      tuft.rotation.z = -0.3;
      blob.add(tuft);
      if (kind === "gold") {
        const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), mat("#ffffff", { emissive: "#ffe36b", emissiveIntensity: 0.9 }));
        crown.position.y = 0.82;
        blob.add(crown);
        blob.userData.sparkle = crown;
      }
    }
    // Trefferfläche: etwas grösser als der Körper, damit ein Tipp auf den
    // Rand nicht danebengeht. Unsichtbar.
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.1, 0.95), new THREE.MeshBasicMaterial({ visible: false }));
    hitbox.position.y = 0.4;
    blob.add(hitbox);
    blob.userData.hitbox = hitbox;
    blob.userData.body = body;
    // Die Kamera schaut steil von oben — damit man das Gesicht sieht, lehnt
    // sich der Blob zurück und schaut zu ihr hoch.
    blob.rotation.order = "YXZ";
    blob.rotation.x = -0.42;
    blob.userData.baseScale = 1.18;
    return blob;
  }

  // Ein Gemüsegarten: Holzrahmen ums Beet, dahinter Gemüsereihen mit
  // Kohl, Salat und Möhren, eine Vogelscheuche, ein Gartenhäuschen, an den
  // Seiten Möhrenreihen, vorn Kürbisse und eine Giesskanne; zwei
  // Schmetterlinge flattern übers Feld.
  buildGarden(scene) {
    const zufall = streuer(27);
    const breite = CELL * COLS + 0.9;
    const tiefe = CELL * ROWS + 0.9;
    const rahmen = lambert("#a8743f");
    [[0, -tiefe / 2, breite + 0.24, 0.12], [0, tiefe / 2, breite + 0.24, 0.12], [-breite / 2, 0, 0.12, tiefe], [breite / 2, 0, 0.12, tiefe]].forEach(([x, z, w, d]) => {
      kiste(scene, w, 0.5, d, "", [x, 0.15, z], { material: rahmen });
    });

    // Gemüsereihen hinter dem Zaun.
    const erde = lambert("#6b4a2e");
    const reihen = [-5, -5.9, -6.8];
    reihen.forEach((z) => kiste(scene, 7.4, 0.12, 0.6, "", [0.2, 0.06, z], { material: erde }));
    const kohl = [];
    const salat = [];
    const kraut = [];
    const moehren = [];
    for (let x = -3.3; x <= 3.7; x += 0.62) {
      kohl.push({ p: [x + (zufall() - 0.5) * 0.1, 0.24, reihen[0]], r: [zufall(), zufall() * 3, 0], s: 0.24 + zufall() * 0.05 });
      salat.push({ p: [x + 0.3, 0.2, reihen[1]], r: [0, zufall() * 3, 0], s: [0.22, 0.14, 0.22] });
      moehren.push({ p: [x, 0.12, reihen[2]], r: [Math.PI, 0, 0] });
      kraut.push({ p: [x, 0.3, reihen[2]], r: [0, zufall() * 3, 0], s: [1, 1 + zufall() * 0.4, 1] });
    }
    // Seitliche Möhrenreihen.
    [-3.55, 3.55].forEach((x) => {
      kiste(scene, 0.55, 0.1, 6.4, "", [x, 0.05, 0], { material: erde });
      for (let z = -2.8; z <= 2.9; z += 0.55) {
        moehren.push({ p: [x + (zufall() - 0.5) * 0.12, 0.1, z], r: [Math.PI, 0, 0] });
        kraut.push({ p: [x, 0.28, z], r: [0, zufall() * 3, 0], s: [1, 0.9 + zufall() * 0.5, 1] });
      }
    });
    viele(scene, new THREE.IcosahedronGeometry(1, 0), lambert("#4f9e4a"), kohl, { schatten: true });
    viele(scene, new THREE.SphereGeometry(1, 10, 6), lambert("#9fd66b"), salat, { schatten: true });
    viele(scene, new THREE.ConeGeometry(0.07, 0.22, 8), lambert("#ff8a2a"), moehren);
    viele(scene, new THREE.ConeGeometry(0.1, 0.26, 5), lambert("#3f9b4a"), kraut);

    // Vogelscheuche.
    const scheuche = new THREE.Group();
    scheuche.position.set(2.5, 0, -6.3);
    scene.add(scheuche);
    kiste(scheuche, 0.1, 1.9, 0.1, "#7a5330", [0, 0.95, 0]);
    kiste(scheuche, 1.3, 0.08, 0.08, "#7a5330", [0, 1.35, 0]);
    kiste(scheuche, 0.55, 0.6, 0.3, "#c8413b", [0, 1.2, 0]);
    kiste(scheuche, 0.56, 0.08, 0.31, "#3a5a8a", [0, 1.05, 0]);
    const kopf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lambert("#e0c48a"));
    kopf.position.y = 1.78;
    scheuche.add(kopf);
    const hut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.26, 10), lambert("#6b4a2e"));
    hut.position.y = 2.02;
    scheuche.add(hut);
    const krempe = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.03, 12), lambert("#6b4a2e"));
    krempe.position.y = 1.91;
    scheuche.add(krempe);
    [-0.68, 0.68].forEach((x) => kiste(scheuche, 0.14, 0.18, 0.04, "#e8c15a", [x, 1.3, 0]));
    this.scarecrow = scheuche;

    // Gartenhäuschen hinten links.
    const haus = new THREE.Group();
    haus.position.set(-3.6, 0, -6.6);
    haus.rotation.y = 0.35;
    scene.add(haus);
    kiste(haus, 1.8, 1.4, 1.4, "#5f9fb8", [0, 0.7, 0]);
    kiste(haus, 0.5, 0.95, 0.04, "#f6f3ec", [0.3, 0.48, 0.71]);
    kiste(haus, 0.4, 0.35, 0.04, "#fff4c0", [-0.45, 0.85, 0.71], { schatten: false });
    [-1, 1].forEach((seite) => kiste(haus, 2.1, 0.08, 1.0, "#c8413b", [0, 1.62, seite * 0.4]).rotation.x = seite * 0.6);

    // Vorn: Kürbisse, Giesskanne, Eimer.
    const kuerbisse = [[-2.1, 4.9, 0.3], [-1.5, 5.4, 0.24], [2.1, 5.1, 0.28], [2.6, 4.7, 0.2]].map(([x, z, r]) => ({ p: [x, r * 0.7, z], s: [r, r * 0.75, r] }));
    viele(scene, new THREE.SphereGeometry(1, 12, 8), lambert("#ff8a1e"), kuerbisse, { schatten: true });
    viele(scene, new THREE.CylinderGeometry(0.03, 0.04, 0.12, 6), lambert("#4f7a2c"), kuerbisse.map((k) => ({ p: [k.p[0], k.p[1] + k.s[1], k.p[2]] })));
    const kanne = new THREE.Group();
    const bauch = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.34, 12), lambert("#2fa36b"));
    bauch.position.y = 0.17;
    kanne.add(bauch);
    const tuelle = kiste(kanne, 0.05, 0.05, 0.4, "#2fa36b", [0, 0.3, 0.3]);
    tuelle.rotation.x = -0.7;
    const griff = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 12, Math.PI), lambert("#2fa36b"));
    griff.position.y = 0.34;
    kanne.add(griff);
    kanne.position.set(0.3, 0, 5.2);
    kanne.rotation.y = -0.8;
    scene.add(kanne);

    // Schmetterlinge.
    this.butterflies = [0, 1].map((i) => {
      const falter = new THREE.Group();
      const farbe = i ? "#ffd15c" : "#b98cff";
      const fluegel = [-1, 1].map((seite) => {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), lambert(farbe, { side: THREE.DoubleSide }));
        f.geometry.translate(0.08, 0, 0);
        const gelenk = new THREE.Group();
        gelenk.scale.x = seite;
        gelenk.add(f);
        falter.add(gelenk);
        return gelenk;
      });
      falter.userData.fluegel = fluegel;
      falter.userData.isFx = true;
      scene.add(falter);
      return falter;
    });
  }

  shot() {
    return {
      look: [0, 0.35, 0.3],
      // Die Klopfer stehen an den Ecken; mit 1.2 Zugabe lag der äussere
      // Hammerarm knapp am Bildrand.
      frame: { w: HOME * 2 + 1.5, h: HOME_Z * 2 * Math.sin(0.82) + 1.6 },
      finale: { pull: 0.6, zoom: 0.85, lift: 0.4, orbit: 0.1 },
      pitch: 0.82,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.25, zoom: 1.35 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner whack-stun" data-whack-stun hidden>Aua! Kurz benommen …</div>`;
  }

  bind() {
    this.controls.innerHTML = "";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      const cell = this.cellFromPointer(event);
      const own = (this.update || this.minigame)?.arcade?.players?.[this.getControlledPlayerId()];
      if (this.now() < (own?.stunUntil || 0)) {
        this.feedback?.vibrate(4);
        return;
      }
      if (cell >= 0) {
        this.feedback?.vibrate(8);
        this.sendInput({ action: "whack", cell }).catch(() => {});
      }
    });
  }

  unbind() {
    this.blobs.clear();
  }

  cellFromPointer(event) {
    if (!this.camera || !this.cellPlane) return -1;
    const rect = this.webglCanvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // Zuerst die Blobs selbst: getroffen wird, was man sieht.
    const boxes = [];
    this.blobs.forEach((blob) => {
      if (blob.userData.up && !blob.userData.whacked) boxes.push(blob.userData.hitbox);
    });
    const onBlob = this.raycaster.intersectObjects(boxes, false)[0];
    if (onBlob) return onBlob.object.parent.userData.cell;
    const hit = this.raycaster.intersectObject(this.cellPlane)[0];
    if (!hit) return -1;
    const gx = Math.round(hit.point.x / CELL + (COLS - 1) / 2);
    const gy = Math.round(hit.point.z / CELL + (ROWS - 1) / 2);
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return -1;
    return gy * COLS + gx;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (this.scarecrow) this.scarecrow.rotation.z = Math.sin(now / 900) * 0.04;
    this.butterflies?.forEach((falter, i) => {
      const t = now / 1000 + i * 3;
      falter.position.set(Math.sin(t * 0.4 + i) * 3.8, 1.2 + Math.sin(t * 1.3) * 0.3, -1 + Math.cos(t * 0.3 + i * 2) * 4.2);
      falter.rotation.y = t * 0.4 + i;
      const schlag = Math.sin(now / 55 + i) * 0.9;
      falter.userData.fluegel.forEach((f) => { f.rotation.z = schlag; });
    });
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const active = new Set();
    const popById = new Map();
    (arcade.pops || []).forEach((pop) => {
      popById.set(pop.id, pop);
      if (elapsed < pop.from - 100 || elapsed > pop.until + 150) return;
      active.add(pop.id);
      let blob = this.blobs.get(pop.id);
      if (!blob) {
        blob = this.buildBlob(pop.kind);
        const pos = this.cellPos(pop.cell);
        blob.position.set(pos.x, -0.3, pos.z);
        Object.assign(blob.userData, { whacked: false, cell: pop.cell, kind: pop.kind, whackedAt: 0 });
        this.scene.add(blob);
        this.blobs.set(pop.id, blob);
      }
      // Heraus mit Schwung (überschiessen, zurückfedern), oben wippen, dann
      // wieder hinab. Getroffen: plattgedrückt.
      const since = elapsed - pop.from;
      const upTime = Math.min(1, Math.max(0, since / 180));
      const overshoot = upTime < 1 ? upTime * (1 + Math.sin(upTime * Math.PI) * 0.25) : 1;
      const downTime = Math.min(1, Math.max(0, (elapsed - (pop.until - 180)) / 180));
      const height = Math.max(0, overshoot - downTime);
      blob.userData.up = height > 0.4;
      if (blob.userData.whacked) {
        const t = Math.min(1, (now - blob.userData.whackedAt) / 220);
        const k = blob.userData.baseScale || 1;
        blob.scale.set(k * (1 + t * 0.35), k * Math.max(0.25, 1 - t * 0.75), k * (1 + t * 0.35));
        blob.position.y = -0.1 + (1 - t) * 0.5;
      } else {
        blob.position.y = -0.35 + height * 0.7;
        const wobble = Math.sin(now / 120 + pop.id) * 0.05;
        const k = blob.userData.baseScale || 1;
        blob.scale.set(k * (1 - wobble * 0.5), k * (1 + wobble), k * (1 - wobble * 0.5));
        // Stachelblobs drohen: sie zittern. Gute schauen neugierig herum.
        blob.rotation.y = pop.kind === "bad" ? Math.sin(now / 35) * 0.08 : Math.sin(now / 400 + pop.id * 2) * 0.35;
      }
      if (blob.userData.sparkle) {
        blob.userData.sparkle.rotation.y = now / 200;
        if (Math.random() < 0.08) this.burst(blob.position.clone().add(new THREE.Vector3(0, 0.9, 0)), ["#ffe36b", "#ffffff"], { count: 1, speed: 0.6, up: 0.6, size: 0.05, life: 0.4 });
      }
    });
    this.blobs.forEach((blob, id) => {
      if (active.has(id)) return;
      this.scene.remove(blob);
      this.blobs.delete(id);
    });

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const swing = this.swings.get(player.id);
      if (!entry || !kin || !animator || !swing) return;
      const isOwn = player.id === controlledId;
      // Neue Treffer: zum Loch springen und draufhauen.
      const seen = this.hitsSeen.get(player.id) || new Set();
      Object.keys(entry.hitPopIds || {}).forEach((key) => {
        if (seen.has(key)) return;
        seen.add(key);
        const pop = popById.get(Number(key)) || popById.get(key);
        if (!pop) return;
        const pos = this.cellPos(pop.cell);
        const bad = pop.kind === "bad";
        swing.target = this.landingSpot(pos, swing.home);
        swing.from = new THREE.Vector3(kin.position.x, 0, kin.position.z);
        swing.leap = leapMs(swing.from, swing.target);
        swing.at = now;
        swing.hopped = false;
        swing.face = Math.atan2(pos.x - swing.target.x, pos.z - swing.target.z);
        animator.trigger("dig");
        const blob = this.blobs.get(pop.id);
        if (blob && !blob.userData.whacked) {
          blob.userData.whacked = true;
          blob.userData.whackedAt = now;
        }
        const gold = pop.kind === "gold";
        const points = entry.lastWhack?.popId === pop.id ? entry.lastWhack.points : (bad ? -2 : 1);
        const label = bad ? `AUA! ${points}` : gold ? `GOLD +${points}` : points >= 3 ? `+3 BLITZ!` : `+${points}`;
        this.burst(new THREE.Vector3(pos.x, 0.9, pos.z), bad ? ["#ff2038", "#8a0f1e"] : gold ? ["#ffe36b", "#ffffff", "#ffc52e"] : ["#8f6ae0", "#ffd15c", player.color], { count: gold ? 22 : 12, speed: 2.1, up: 2, size: 0.08, life: 0.6, drag: 2, fadePow: 1.4 });
        this.bursts.ring(new THREE.Vector3(pos.x, 0.42, pos.z), bad ? "#ff2038" : "#ffd15c", { radius: bad ? 1.3 : 1, life: 0.45, opacity: 0.5, tilt: null });
        // Nur die eigenen Zahlen gross; fremde Treffer sieht man am Sprung.
        if (isOwn || bad) this.pop(new THREE.Vector3(pos.x, 1.3, pos.z), label, { color: bad ? "#ff6b7f" : gold ? "#ffe36b" : player.color, size: isOwn ? (bad ? 0.38 : 0.34) : 0.26, life: bad ? 0.8 : 0.65, rise: 0.7 });
        if (bad) {
          animator.trigger("knockback");
          animator.expression("dizzy", 1300);
        } else {
          animator.expression("joy", 500);
        }
        if (isOwn) {
          this.feedback?.sound(bad ? "error" : gold ? "win" : points >= 3 ? "combo" : "pop");
          this.feedback?.vibrate(bad ? [22, 16, 28] : 10);
          this.rig.shake(bad ? 0.7 : 0.35);
        }
      });
      this.hitsSeen.set(player.id, seen);

      // Zum Loch und zurück wird GESPRUNGEN, nicht gelaufen. Der Weg von der
      // Ecke zum fernen Loch führt über das mittlere, und wer dort durchlief,
      // hatte den Blob im Bauch. Der Bogen trägt über jeden Blob hinweg, und
      // der Hammer ist oben, während man fliegt — die Landung ist der Schlag.
      const since = now - swing.at;
      let from = swing.home;
      let to = swing.home;
      let t = 1;
      let leap = 0;
      if (swing.target) {
        const back = leapMs(swing.target, swing.home);
        if (since < swing.leap) {
          from = swing.from;
          to = swing.target;
          t = since / swing.leap;
          leap = swing.leap;
        } else if (since < STAY_MS) {
          from = to = swing.target;
        } else if (since < STAY_MS + back) {
          from = swing.target;
          t = (since - STAY_MS) / back;
          leap = back;
          if (!swing.hopped) {
            swing.hopped = true;
            animator.trigger("hop", { height: 0 });
          }
        }
      }
      const dist = Math.hypot(to.x - from.x, to.z - from.z);
      kin.position.x = from.x + (to.x - from.x) * t;
      kin.position.z = from.z + (to.z - from.z) * t;
      const arc = leap ? 4 * t * (1 - t) * Math.min(1.25, 0.3 + dist * 0.3) : 0;
      this.setGround(player.id, MOUND_TOP + arc);
      if (finale) return;
      const face = since < STAY_MS ? swing.face : leap ? Math.atan2(to.x - from.x, to.z - from.z) : Math.atan2(-swing.home.x, -swing.home.z * 0.3 - 1.2);
      kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(leap ? 0.6 : 0.35, dt);
      animator.set(now < (entry.stunUntil || 0) ? "dizzy" : "ready");
    });
  }

  keepInView() {
    return [...this.kins.values()];
  }

  drawHud(f) {
    const own = f.arcade?.players?.[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.points || 0);
    this.stunNode ||= this.hud.querySelector("[data-whack-stun]");
    const stunned = f.now < (own?.stunUntil || 0);
    this.stunNode.hidden = !stunned;
    if (stunned) {
      // Wie lange noch — in Zehnteln, damit man den Moment zum Weiterhauen sieht.
      const text = `Aua! Benommen · ${((own.stunUntil - f.now) / 1000).toFixed(1)} s`;
      if (this.stunNode.textContent !== text) this.stunNode.textContent = text;
    }
    this.webglCanvas?.classList.toggle("is-stunned", stunned);
  }
}
