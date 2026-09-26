import * as THREE from "/vendor/three/three.module.js";
import { createShadowBlob } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Sortierband: Dinge laufen auf dem Band heran — Obst, Müll, Spielzeug —,
// wischen oder tippen wirft das vorderste in eine Rutsche. Jede Rutsche trägt
// ein Schild mit ihrer Kategorie, und ab und zu tauschen die Schilder.
//
// Die Kisten auf dem Band sind neutral: nur das Symbol darauf sagt, wohin sie
// gehören. Mit farbigen Paketen war das reine Farberkennung; jetzt muss man
// kurz hinschauen und überlegen — besonders bei den Verwechslern (Orange oder
// Basketball?).
//
// Vorher stand die Figur daneben und schaute zu, während die Pakete von
// allein flogen. Jetzt greift sie nach dem Paket, das in Reichweite kommt,
// wirft es mit Schwung in die Rutsche, dreht sich dabei zur Rutsche, und bei
// einem Fehlwurf fasst sie sich an den Kopf.
const BELT_FAR_Z_RAW = -9.4;
const BELT_NEAR_Z_RAW = 3.0;
const BELT_LENGTH = BELT_NEAR_Z_RAW - BELT_FAR_Z_RAW;
const BELT_WIDTH = 2.4;
const BELT_FAR_Z = BELT_FAR_Z_RAW;   // wo ein Paket auf das Band kommt (Bandanteil 0)
const BELT_NEAR_Z = BELT_NEAR_Z_RAW; // Kante, an der es runterfällt (Bandanteil 1)
// Seitlicher Abstand der äusseren Rutschen. 2.35 war zu breit: im Hochformat
// ist der sichtbare Ausschnitt schmal, und die beiden äusseren Trichter lagen
// ausserhalb. Man sah nur den mittleren — bei einem Spiel, in dem man die FARBE
// der drei Rutschen vergleichen muss, ist das kein Schönheitsfehler.
const CHUTE_X = 1.45;
// Die drei Höhen, an denen sich in dieser Szene alles ausrichtet. Sie standen
// vorher verstreut als nackte Zahlen im Code, und genau deshalb passte nichts
// zusammen: die Trichteröffnung lag bei 1.30, die Bandoberfläche bei 0.32 —
// die Kübel schwebten also einen Meter ÜBER dem Band, und ein Paket hätte
// bergauf fliegen müssen, um hineinzufallen. Stattdessen flog es durch.
const GROUND_Y = -0.5;         // Oberkante des Bodens
const BELT_TOP_Y = 0.32;       // Oberkante des Bandes
const CHUTE_MOUTH_Y = 0.30;    // Trichterrand, knapp UNTER der Bandkante
// Je Kategorie eine Farbe für Rutsche und Schild (Obst, Müll, Spielzeug).
const COLOURS = ["#ff5d73", "#8a9aab", "#ffd15c"];
const COLOUR_DARK = ["#8e2233", "#3d4a58", "#8a6410"];
const CATEGORIES = [
  { name: "OBST", icon: "🍎" },
  { name: "MÜLL", icon: "🗑️" },
  { name: "SPIELZEUG", icon: "🧸" }
];
const CRATE_COLOUR = "#c9a26f";
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function beltZ(progress) {
  return BELT_FAR_Z + clamp(progress, 0, 1.2) * (BELT_NEAR_Z - BELT_FAR_Z);
}

const WORKER_X = -2.45;
const WORKER_Z = BELT_NEAR_Z - 1.0;
const CRATE_H = 0.36;

export class SortBelt extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.chutes = [];
    this.parcels = [];
    this.flying = [];
    this.lastVerdictAt = 0;
    this.lastSwapAt = 0;
    this.beltScroll = 0;
    this.swapPulse = 0;
    this.workerTurn = Math.PI / 2;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Sortierband",
      background: "#c9b48d",
      fog: ["#d9c8a8", 22, 56],
      lights: { sunPosition: [-5, 13, 7], shadow: { left: -7, right: 7, top: 10, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-belt-score>0</strong></div>
      <div class="belt-streak" data-belt-streak hidden></div>
      <div class="belt-chips" data-belt-chips></div>
      <div class="color-banner belt-banner" data-belt-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.5, 26),
      new THREE.MeshLambertMaterial({ color: "#b0865f" })
    );
    floor.position.set(0, -0.75, -3);
    floor.receiveShadow = true;
    scene.add(floor);

    this.buildBelt();
    this.buildChutes();

    this.buildHall(scene);

    const wandMat = new THREE.MeshLambertMaterial({ color: "#c9b48d" });
    // 13 hoch statt 7: mit dem höheren Blickpunkt blieb über der Wand ein
    // Streifen Himmel stehen — mitten in einer Halle.
    const rueckwand = new THREE.Mesh(new THREE.BoxGeometry(26, 13, 0.6), wandMat);
    rueckwand.position.set(0, GROUND_Y + 6.5, BELT_FAR_Z - 2.4);
    rueckwand.receiveShadow = true;
    scene.add(rueckwand);
    // Der Schacht, aus dem die Pakete kommen.
    const schacht = new THREE.Mesh(
      new THREE.BoxGeometry(BELT_WIDTH + 0.9, 1.5, 1.2),
      new THREE.MeshLambertMaterial({ color: "#8d99a8" })
    );
    schacht.position.set(0, GROUND_Y + 1.7, BELT_FAR_Z - 1.5);
    schacht.castShadow = true;
    scene.add(schacht);
    // Bodenmarkierungen: sie geben dem Hallenboden Struktur und zeigen beim
    // Wischen, dass man sich seitlich bewegt.
    const markeMat = new THREE.MeshLambertMaterial({ color: "#d8c49b" });
    for (let i = 0; i < 9; i += 1) {
      const marke = new THREE.Mesh(new THREE.BoxGeometry(22, 0.02, 0.3), markeMat);
      marke.position.set(0, GROUND_Y + 0.01, BELT_NEAR_Z + 1.6 - i * 1.9);
      scene.add(marke);
    }
    [-1, 1].forEach((seite) => {
      const streifen = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 16), markeMat);
      streifen.position.set(seite * 4.6, GROUND_Y + 0.012, BELT_NEAR_Z - 6);
      scene.add(streifen);
    });

    // Der eigene Arbeiter am Ende des Bandes; die anderen sortieren an
    // ihren eigenen Bändern.
    const state = this.getState();
    const players = state?.players || [];
    const index = Math.max(0, players.findIndex((player) => player.id === this.getControlledPlayerId()));
    const me = players[index];
    // Auf einer Kiste, damit die vordere Rutsche ihn nicht verdeckt.
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.8, CRATE_H, 0.8), new THREE.MeshLambertMaterial({ color: "#a8784a" }));
    crate.position.set(WORKER_X, GROUND_Y + CRATE_H / 2, WORKER_Z);
    crate.castShadow = true;
    crate.receiveShadow = true;
    scene.add(crate);
    if (me) this.addKin(me, index, { x: WORKER_X, ground: GROUND_Y + CRATE_H, z: WORKER_Z, facing: Math.PI / 2 });
    this.buildParcels();
  }

  buildBelt() {
    const midZ = (BELT_FAR_Z + BELT_NEAR_Z) / 2;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(BELT_WIDTH, 0.32, BELT_LENGTH),
      new THREE.MeshLambertMaterial({ color: "#4a5566" })
    );
    deck.position.set(0, 0.16, midZ);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Querlatten, die mitlaufen. Ohne sie sieht ein laufendes Band genauso aus
    // wie ein stehendes — und genau daran liest man hier das Tempo ab.
    this.slats = [];
    const slatGeo = new THREE.BoxGeometry(BELT_WIDTH * 0.96, 0.08, 0.22);
    const slatMat = new THREE.MeshLambertMaterial({ color: "#6b7a8d" });
    for (let i = 0; i < 22; i += 1) {
      const slat = new THREE.Mesh(slatGeo, slatMat);
      slat.position.set(0, 0.34, 0);
      this.scene.add(slat);
      this.slats.push(slat);
    }

    [-1, 1].forEach((side) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.36, BELT_LENGTH),
        new THREE.MeshLambertMaterial({ color: "#8894a5" })
      );
      rail.position.set(side * (BELT_WIDTH / 2 + 0.08), 0.42, midZ);
      rail.castShadow = true;
      this.scene.add(rail);
    });

    // Die Greifkante: ab hier ist das vorderste Paket in Reichweite. Sie sitzt
    // im Bild und nicht nur in den Regeln — sonst wirkt ein zu früher Wisch wie
    // ein verschluckter Befehl.
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(BELT_WIDTH + 0.4, 0.05, 0.12),
      new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false })
    );
    line.position.set(0, 0.35, beltZ(0.34));
    this.scene.add(line);
    this.reachLine = line;
  }

  buildChutes() {
    // Drei Trichter am vorderen Ende, nebeneinander. Sie stehen leicht schräg
    // nach aussen, damit man auch die äusseren als getrennte Ziele liest.
    const spots = [-CHUTE_X, 0, CHUTE_X];
    spots.forEach((x, index) => {
      const group = new THREE.Group();
      group.position.set(x, 0, BELT_NEAR_Z + 1.15);
      this.scene.add(group);

      // Der Trichter steht auf dem Boden und endet knapp unter der Bandkante —
      // das Paket kippt also über den Rand hinein, statt hinaufgeworfen zu
      // werden.
      const chuteHeight = CHUTE_MOUTH_Y - GROUND_Y;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.36, chuteHeight, 6, 1, true),
        new THREE.MeshLambertMaterial({ color: COLOURS[index], side: THREE.DoubleSide })
      );
      body.position.y = GROUND_Y + chuteHeight / 2;
      body.castShadow = true;
      group.add(body);

      const lip = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.07, 6, 18),
        new THREE.MeshLambertMaterial({ color: "#ffffff" })
      );
      lip.rotation.x = Math.PI / 2;
      lip.position.y = CHUTE_MOUTH_Y;
      group.add(lip);

      // Ein Leuchtring, der beim Treffer aufblitzt und beim angekündigten
      // Farbtausch pulsiert.
      const glow = new THREE.Mesh(
        new THREE.TorusGeometry(0.78, 0.06, 6, 22),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
      );
      glow.rotation.x = Math.PI / 2;
      glow.position.y = CHUTE_MOUTH_Y;
      group.add(glow);

      const shadow = createShadowBlob(0.58);
      shadow.position.set(x, GROUND_Y + 0.02, BELT_NEAR_Z + 1.15);
      this.scene.add(shadow);

      // Das Schild über der Rutsche: Symbol und Name der Kategorie. Es sitzt
      // in der Gruppe und dreht sich beim Tausch mit.
      const sign = makeCanvasSprite(256, 96);
      sign.scale.set(1.3, 0.49, 1);
      sign.position.set(0, CHUTE_MOUTH_Y + 0.62, 0.05);
      group.add(sign);

      this.chutes.push({
        index, group, body, lip, glow, sign,
        colour: index,
        shownColour: index,
        flash: 0,
        swapSpin: 0,
        base: new THREE.Color(COLOURS[index])
      });
    });
  }

  // Die Paketkörper werden EINMAL gebaut und weiterverwendet. Neue Meshes je
  // Paket wären auf dem Handy der teuerste Teil der Szene — und es sind über
  // die Runde leicht sechzig Stück.
  buildParcels() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 5; i += 1) {
      const group = new THREE.Group();
      const box = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: CRATE_COLOUR }));
      box.castShadow = true;
      group.add(box);
      // Zwei helle Bänder über das Paket: sie zeigen die Drehung und machen die
      // Farbe auch dann noch lesbar, wenn das Paket klein am Horizont steht.
      const tapeMat = new THREE.MeshLambertMaterial({ color: "#fff4dc" });
      const tapeA = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 0.22), tapeMat);
      tapeA.position.y = 0.02;
      group.add(tapeA);
      const tapeB = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 1.04), tapeMat);
      tapeB.position.y = 0.02;
      group.add(tapeB);
      // Das Ding in der Kiste: ein grosses Symbol auf weissem Teller, das
      // immer zur Kamera zeigt.
      const item = makeCanvasSprite(128, 128);
      item.position.y = 1.25;
      item.scale.set(1.8, 1.8, 1);
      group.add(item);
      this.scene.add(group);

      const shadow = createShadowBlob(0.42);
      this.scene.add(shadow);

      this.parcels.push({ group, box, item, shadow, wobble: Math.random() * 6.28, shownId: null });
    }
  }

  // Die Halle: Hochregale mit Kisten links und rechts, Paletten, ein Stapler,
  // Warnstreifen am Band, Hallenfenster, eine Uhr und ein Schild an der
  // Rückwand, Rohre und Lampen unter der Decke. Vorher stand das Band in einer
  // leeren Halle unter freiem Himmel.
  buildHall(scene) {
    const zufall = streuer(57);
    // Hochregale.
    [-1, 1].forEach((seite) => {
      const x = seite * 4.1;
      for (let z = -9; z <= -1.5; z += 2.6) {
        [[-1.1, 0], [1.1, 0]].forEach(([dz]) => kiste(scene, 0.12, 4.2, 0.12, "#2f6fb0", [x - seite * 0.55, GROUND_Y + 2.1, z + dz]));
        [[-1.1, 0], [1.1, 0]].forEach(([dz]) => kiste(scene, 0.12, 4.2, 0.12, "#2f6fb0", [x + seite * 0.55, GROUND_Y + 2.1, z + dz]));
        [0.9, 2.1, 3.3].forEach((y) => {
          kiste(scene, 1.3, 0.08, 2.4, "#ff8f2e", [x, GROUND_Y + y, z], { schatten: false });
          const kisten = [];
          for (let k = 0; k < 3; k += 1) if (zufall() < 0.8) kisten.push({ p: [x + (zufall() - 0.5) * 0.3, GROUND_Y + y + 0.3, z - 0.75 + k * 0.75], s: [0.9, 0.5 + zufall() * 0.2, 0.62], r: [0, (zufall() - 0.5) * 0.2, 0] });
          viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert(zufall() < 0.5 ? "#c9a26f" : "#b88e5a"), kisten, { schatten: true });
        });
      }
    });
    // Paletten mit Kistenstapeln vorn an den Seiten.
    [[-3.5, 3.6], [3.4, 3.4]].forEach(([x, z]) => {
      kiste(scene, 1.2, 0.16, 1.0, "#a07a4a", [x, GROUND_Y + 0.08, z]);
      viele(scene, new THREE.BoxGeometry(0.55, 0.45, 0.45), lambert("#c9a26f"), [[-0.28, 0, -0.22], [0.28, 0, -0.22], [-0.28, 0, 0.24], [0.28, 0, 0.24], [0, 0.45, 0]].map(([dx, dy, dz]) => ({ p: [x + dx, GROUND_Y + 0.4 + dy, z + dz], r: [0, zufall() * 0.2, 0] })), { schatten: true });
    });
    // Gabelstapler.
    const stapler = new THREE.Group();
    kiste(stapler, 0.9, 0.6, 1.3, "#ffc400", [0, 0.5, 0]);
    kiste(stapler, 0.8, 0.08, 0.8, "#2c2f38", [0, 1.25, -0.1]);
    [[-0.38, -0.35], [0.38, -0.35], [-0.38, 0.35], [0.38, 0.35]].forEach(([x, z]) => kiste(stapler, 0.06, 0.8, 0.06, "#2c2f38", [x, 0.85, z * 0.6 - 0.1], { schatten: false }));
    kiste(stapler, 0.1, 1.6, 0.1, "#3b3f4a", [-0.3, 0.8, 0.7]);
    kiste(stapler, 0.1, 1.6, 0.1, "#3b3f4a", [0.3, 0.8, 0.7]);
    kiste(stapler, 0.12, 0.06, 0.7, "#3b3f4a", [-0.25, 0.1, 1.05]);
    kiste(stapler, 0.12, 0.06, 0.7, "#3b3f4a", [0.25, 0.1, 1.05]);
    [[-0.5, -0.4], [0.5, -0.4], [-0.5, 0.45], [0.5, 0.45]].forEach(([x, z]) => {
      const rad = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12), lambert("#1c1c22"));
      rad.rotation.z = Math.PI / 2;
      rad.position.set(x, 0.22, z);
      stapler.add(rad);
    });
    stapler.position.set(3.0, GROUND_Y, 0.6);
    stapler.rotation.y = -0.9;
    scene.add(stapler);
    // Warnstreifen links und rechts am Band.
    const streifen = [];
    for (let z = BELT_FAR_Z; z < BELT_NEAR_Z; z += 0.6) {
      [-1, 1].forEach((seite) => streifen.push({ p: [seite * (BELT_WIDTH / 2 + 0.55), GROUND_Y + 0.012, z], r: [-Math.PI / 2, 0, 0.7] }));
    }
    viele(scene, new THREE.PlaneGeometry(0.14, 0.4), lambert("#ffd15c"), streifen);
    // Fenster, Uhr und Schild an der Rückwand.
    const wandZ = BELT_FAR_Z - 2.05;
    for (let i = -4; i <= 4; i += 1) {
      if (Math.abs(i) < 1) continue;
      const fenster = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.4), new THREE.MeshBasicMaterial({ color: "#bfe6ff" }));
      fenster.position.set(i * 2.5, GROUND_Y + 6.8, wandZ);
      scene.add(fenster);
      kiste(scene, 1.9, 0.08, 0.1, "#6b7280", [i * 2.5, GROUND_Y + 6.8, wandZ + 0.02], { schatten: false });
      kiste(scene, 0.08, 1.5, 0.1, "#6b7280", [i * 2.5, GROUND_Y + 6.8, wandZ + 0.02], { schatten: false });
    }
    const uhr = new THREE.Group();
    const blatt = new THREE.Mesh(new THREE.CircleGeometry(0.7, 24), lambert("#ffffff"));
    uhr.add(blatt);
    const rand = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.07, 6, 24), lambert("#2c2f38"));
    uhr.add(rand);
    this.clockHands = [0.5, 0.35].map((l, i) => {
      const zeiger = kiste(uhr, 0.05, l, 0.02, "#1c1c22", [0, 0, 0.03], { schatten: false });
      zeiger.geometry.translate(0, l / 2, 0);
      zeiger.userData.speed = i ? 0.02 : 0.25;
      return zeiger;
    });
    uhr.position.set(-4.2, GROUND_Y + 4.6, wandZ + 0.05);
    scene.add(uhr);
    const schild = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), new THREE.MeshBasicMaterial({ map: schildTextur("SORTIERBAND 3") }));
    schild.position.set(3.6, GROUND_Y + 4.6, wandZ + 0.05);
    scene.add(schild);
    // Rohre und Lampen unter der Decke.
    [-2.8, 2.8].forEach((x) => {
      const rohr = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 16, 10), lambert("#9aa2b0"));
      rohr.rotation.x = Math.PI / 2;
      rohr.position.set(x, GROUND_Y + 6.2, -4);
      scene.add(rohr);
    });
    [[-1.6, -2], [1.6, -5], [-1.6, -8]].forEach(([x, z]) => {
      kiste(scene, 0.04, 1.2, 0.04, "#2c2f38", [x, GROUND_Y + 5.8, z], { schatten: false });
      const schirm = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.35, 12, 1, true), lambert("#2f6b4a", { side: THREE.DoubleSide }));
      schirm.position.set(x, GROUND_Y + 5.1, z);
      scene.add(schirm);
      const birne = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: "#fff2c0" }));
      birne.position.set(x, GROUND_Y + 4.95, z);
      scene.add(birne);
    });
  }

  shot() {
    return {
      look: [-0.25, 0.55, BELT_NEAR_Z - 0.6],
      frame: { w: 5.2, h: 3.8 },
      pitch: 0.5,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.25, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Wisch jedes Teil in die passende Rutsche</p>`;
    this.controls.style.pointerEvents = "none";
    this.bindGestures();
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.chutes.length = 0;
    this.parcels.length = 0;
    this.flying.length = 0;
  }

  bindGestures() {
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let tracking = false;

    this.onDown = (event) => {
      event.preventDefault();
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
      startAt = performance.now();
    };
    this.onUp = (event) => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const dist = Math.hypot(dx, dy);
      const held = performance.now() - startAt;
      // Kurzer Kontakt ohne Weg ist ein Tipp — dann entscheidet die getippte
      // Bildhälfte. Alles darüber ist ein Wisch, und dann entscheidet die
      // Richtung. Beides landet in derselben Rutschennummer.
      if (dist < 26 && held < 400) {
        this.sortTo(this.chuteAtPoint(event.clientX));
        return;
      }
      if (dist < 26) return;
      if (dy > Math.abs(dx) * 0.9) {
        this.sortTo(1);           // nach unten = Mitte
        return;
      }
      this.sortTo(dx < 0 ? 0 : 2);
    };
    this.onCancel = () => { tracking = false; };

    this.on(this.webglCanvas, "pointerdown", this.onDown);
    this.on(this.webglCanvas, "pointerup", this.onUp);
    this.on(this.webglCanvas, "pointercancel", this.onCancel);
  }

  // Ein Tipp trifft die Rutsche, über der er liegt. Die Trennlinien liegen bei
  // Dritteln der Bildbreite — die Rutschen stehen im Bild ohnehin so.
  chuteAtPoint(clientX) {
    const rect = this.webglCanvas.getBoundingClientRect();
    const share = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 0.999);
    return Math.floor(share * 3);
  }

  sortTo(chute) {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    const own = minigame.arcade?.players?.[this.getControlledPlayerId()];
    if (!own) return;
    // Vor der Reichweite passiert nichts — dann aber auch kein Klick-Geräusch,
    // sonst klingt es, als hätte man etwas ausgelöst.
    if (!own.reachable) {
      this.feedback?.sound("clack");
      return;
    }
    this.feedback?.sound("tap");
    this.sendInput({ action: "sort", chute }).catch(() => {});
  }

  syncBelt(arcade, dt) {
    const speed = arcade.speed || 0.3;
    this.beltScroll = (this.beltScroll + speed * dt * (BELT_NEAR_Z - BELT_FAR_Z)) % 0.62;
    this.slats.forEach((slat, i) => {
      slat.position.z = BELT_FAR_Z + ((i * 0.62 + this.beltScroll) % BELT_LENGTH);
    });
  }

  syncChutes(arcade, dt, now) {
    const wanted = arcade.chutes || [0, 1, 2];
    const warn = arcade.nextChutes || null;
    const swapped = arcade.lastSwapAt && arcade.lastSwapAt !== this.lastSwapAt;
    if (swapped) {
      this.lastSwapAt = arcade.lastSwapAt;
      this.swapPulse = 1;
      this.feedback?.sound("portal");
      this.feedback?.vibrate(14);
      this.pop(new THREE.Vector3(0, 2.9, BELT_NEAR_Z - 0.4), "TAUSCH!", { color: "#ffe9a8", size: 0.4, life: 0.85 });
    }
    this.swapPulse = Math.max(0, this.swapPulse - dt * 1.6);

    const categories = arcade.categories || CATEGORIES;
    this.chutes.forEach((chute) => {
      const colour = wanted[chute.index] ?? chute.index;
      if (colour !== chute.shownColour || !chute.signPainted) {
        // Der Wechsel dreht den Trichter einmal um sich selbst. Ein Schild, das
        // ohne Bewegung umspringt, übersieht man im Augenwinkel.
        if (chute.signPainted) chute.swapSpin = Math.PI * 2;
        chute.shownColour = colour;
        chute.signPainted = true;
        chute.base.set(COLOURS[colour]);
        paintSign(chute.sign, categories[colour] || CATEGORIES[colour], COLOURS[colour], colour === 2 ? "#4a3405" : "#ffffff");
      }
      chute.swapSpin = Math.max(0, chute.swapSpin - dt * 9);
      chute.group.rotation.y = chute.swapSpin;
      chute.group.position.y = Math.sin((Math.PI * 2 - chute.swapSpin) * 0.5) * 0.18;

      chute.body.material.color.copy(chute.base);
      chute.flash = Math.max(0, chute.flash - dt * 2.6);

      // Vorwarnung: der Trichter, der gleich eine ANDERE Farbe bekommt,
      // pulsiert weiss. So kann man den Tausch einplanen, statt überrascht zu
      // werden — überrascht werden wäre Zufall, einplanen ist Können.
      const willChange = warn && warn[chute.index] !== colour;
      const pulse = willChange ? (0.35 + Math.sin(now / 90) * 0.3) : 0;
      chute.glow.material.opacity = Math.max(chute.flash, pulse);
      chute.glow.material.color.set(chute.flash > pulse ? "#ffffff" : "#ffe9a8");
      chute.glow.scale.setScalar(1 + chute.flash * 0.22 + pulse * 0.08);
      chute.lip.material.color.set(willChange ? "#ffe9a8" : "#ffffff");
    });
  }

  syncParcels(own, arcade, dt, now) {
    const queue = own.queue || [];
    const head = own.beltPos || 0;
    this.parcels.forEach((visual, slot) => {
      const parcel = queue[slot];
      if (!parcel) {
        visual.group.visible = false;
        visual.shadow.visible = false;
        return;
      }
      const progressCheck = head - slot * (arcade.parcelGap || 0.34);
      if (progressCheck < -0.02) {
        // Noch nicht auf dem Band. Sichtbar waere es ein Stapel am hinteren
        // Ende — man wuerde Pakete sehen, die es noch gar nicht gibt.
        visual.group.visible = false;
        visual.shadow.visible = false;
        return;
      }
      visual.group.visible = true;
      visual.shadow.visible = true;

      // Alle Pakete hängen an EINER Zahl: wie weit das vorderste gelaufen ist.
      // Die dahinter stehen in festem Abstand — deshalb rückt beim Sortieren
      // die ganze Reihe sichtbar nach, statt dass ein Paket aus dem Nichts
      // auftaucht.
      const progress = head - slot * (arcade.parcelGap || 0.34);
      const z = beltZ(progress);
      const scale = 0.62 * (parcel.size || 1);
      visual.group.position.set(0, 0.32 + scale / 2, z);
      visual.group.scale.setScalar(scale);
      visual.shadow.position.set(0, 0.34, z);
      visual.shadow.scale.setScalar(scale * 1.5);

      // Ein leichtes Rütteln: das Band ist eine Maschine, keine Rutschbahn.
      visual.wobble += dt * (5 + (arcade.speed || 0.3) * 7);
      visual.group.rotation.z = Math.sin(visual.wobble) * 0.035;
      visual.group.rotation.y = Math.sin(visual.wobble * 0.4) * 0.05;

      if (visual.shownId !== parcel.id) {
        visual.shownId = parcel.id;
        paintIcon(visual.item, parcel.icon || CATEGORIES[parcel.colour]?.icon || "📦");
      }
      // Das Symbol bleibt gleich gross, egal wie gross die Kiste ist.
      visual.item.scale.setScalar(1.8 / Math.max(0.5, parcel.size || 1));

      // Das vorderste Paket hebt sich ab, sobald es greifbar ist: es wippt
      // stärker und steht einen Hauch höher.
      if (slot === 0 && own.reachable) {
        const lift = 0.06 + Math.sin(now / 140) * 0.04;
        visual.group.position.y += lift;
      }
    });

    if (this.reachLine) {
      this.reachLine.material.opacity = own.reachable ? 0.25 : 0.75;
    }
  }

  // Sortierte Pakete fliegen sichtbar in ihre Rutsche. Sie einfach verschwinden
  // zu lassen liest sich wie ein Aussetzer des Spiels — man will sehen, wohin
  // die eigene Entscheidung geführt hat.
  spawnFlight(icon, chuteIndex, good) {
    const proxy = makeCanvasSprite(128, 128);
    paintIcon(proxy, icon || "📦");
    proxy.scale.setScalar(0.85);
    proxy.userData.base = 0.85;
    proxy.position.set(0, BELT_TOP_Y + 0.6, beltZ(0.55));
    this.scene.add(proxy);
    const target = this.chutes[chuteIndex]?.group.position || new THREE.Vector3(0, 0, BELT_NEAR_Z);
    this.flying.push({
      mesh: proxy,
      from: proxy.position.clone(),
      to: new THREE.Vector3(target.x, good ? CHUTE_MOUTH_Y - 0.3 : BELT_TOP_Y + 0.25, target.z),
      // Ein Fehlgriff prallt ab statt hineinzufallen: der Unterschied muss auch
      // ohne Text erkennbar sein.
      good,
      t: 0,
      spin: (Math.random() - 0.5) * 8
    });
  }

  updateFlying(dt) {
    for (let i = this.flying.length - 1; i >= 0; i -= 1) {
      const fly = this.flying[i];
      fly.t += dt * (fly.good ? 3.1 : 2.3);
      const t = Math.min(1, fly.t);
      const ease = fly.good ? t * t : t;
      fly.mesh.position.lerpVectors(fly.from, fly.to, ease);
      fly.mesh.position.y += Math.sin(t * Math.PI) * (fly.good ? 0.9 : 1.5);
      fly.mesh.material.rotation += fly.spin * dt * 0.5;
      fly.mesh.scale.setScalar((fly.mesh.userData.base || 1) * (fly.good ? 1 - t * 0.7 : 1 - t * 0.3));
      if (t >= 1) {
        this.scene.remove(fly.mesh);
        fly.mesh.material.map?.dispose();
        fly.mesh.material.dispose();
        this.flying.splice(i, 1);
      }
    }
  }

  reactToVerdict(own, arcade) {
    const verdict = own.lastVerdict;
    if (!verdict || verdict.at === this.lastVerdictAt) return;
    this.lastVerdictAt = verdict.at;

    const categories = arcade.categories || CATEGORIES;
    if (verdict.kind === "good") {
      this.spawnFlight(verdict.icon, verdict.chute, true);
      const chute = this.chutes[verdict.chute];
      if (chute) chute.flash = 1;
      const at = new THREE.Vector3(chute?.group.position.x || 0, 1.7, BELT_NEAR_Z);
      this.burst(at, [COLOURS[verdict.colour], "#ffffff"], { count: 12, speed: 2.0, up: 1.4, size: 0.07, life: 0.5, drag: 2.2 });
      if (verdict.bonus > 0) {
        this.pop(at, `+${100 + verdict.bonus}`, { color: "#c6ffb0", size: 0.34, life: 0.7 });
      }
      this.feedback?.sound("coin");
      this.feedback?.vibrate(10);
      this.workerAct("good", verdict.chute);
    } else if (verdict.kind === "wrong") {
      this.spawnFlight(verdict.icon, verdict.chute, false);
      // Sagen, wohin es gehört hätte — beim Verwechsler lernt man daraus.
      const right = categories[verdict.colour]?.name || "";
      this.pop(new THREE.Vector3(0, 2.4, BELT_NEAR_Z - 1), "FALSCH", { color: "#ff9aa8", size: 0.38, life: 0.9 });
      if (verdict.name && right) this.pop(new THREE.Vector3(0, 1.95, BELT_NEAR_Z - 1), `${verdict.name} → ${right}`, { color: "#ffffff", size: 0.26, life: 1.3, rise: 0.3 });
      this.feedback?.sound("error");
      this.feedback?.vibrate(26);
      this.rig.shake(0.45);
      this.workerAct("wrong", verdict.chute);
    } else {
      // Durchgerutscht: das Paket kippt vorne über die Kante.
      const at = new THREE.Vector3(0, 0.5, BELT_NEAR_Z + 0.2);
      this.burst(at, [COLOURS[verdict.colour] || "#888", "#6b7a8d"], { count: 10, speed: 1.4, up: 0.4, size: 0.07, life: 0.7, drag: 1.6 });
      this.pop(new THREE.Vector3(0, 2.2, BELT_NEAR_Z - 1), "DURCH!", { color: "#ffc59a", size: 0.36, life: 0.8 });
      this.feedback?.sound("error");
      this.feedback?.vibrate(18);
      this.rig.shake(0.3);
      this.workerAct("missed", 1);
    }
  }

  // Der Arbeiter reagiert: Wurf zur Rutsche, Fehlwurf, durchgerutscht.
  workerAct(kind, chute) {
    const animator = this.animators.get(this.getControlledPlayerId());
    if (!animator) return;
    const target = this.chutes[chute]?.group.position;
    if (target) this.workerTurn = Math.atan2(target.x - WORKER_X, target.z - WORKER_Z);
    this.workerTurnUntil = this.now() + 500;
    if (kind === "good") {
      animator.trigger("throw");
      animator.expression("happy", 400);
    } else if (kind === "wrong") {
      animator.trigger("throw");
      animator.trigger("facepalm");
      animator.expression("sad", 800);
    } else {
      animator.trigger("headshake");
      animator.expression("surprised", 700);
    }
  }

  tick(f) {
    this.clockHands?.forEach((zeiger) => { zeiger.rotation.z = -(f.now / 1000) * zeiger.userData.speed; });
    const { now, dt, arcade, controlledId, finale } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    this.syncChutes(arcade, dt, now);
    this.syncBelt(arcade, dt);
    if (own) {
      this.syncParcels(own, arcade, dt, now);
      this.reactToVerdict(own, arcade);
    }
    this.updateFlying(dt);
    const kin = this.kins.get(controlledId);
    const animator = this.animators.get(controlledId);
    if (!kin || !animator || finale) return;
    const turning = now < (this.workerTurnUntil || 0);
    const face = turning ? this.workerTurn : Math.PI / 2;
    kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(0.3, dt);
    const head = this.parcels[0]?.group;
    animator.lookAt(head?.visible ? head.position : null);
    if (own?.reachable) {
      animator.set("ready");
      animator.set("reach", { params: { side: 1 } });
    } else {
      animator.set("focus");
    }
  }

  keepInView() {
    return [...this.kins.values()];
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-belt-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
    const streak = this.hud.querySelector("[data-belt-streak]");
    if (streak) {
      const run = own?.streak || 0;
      streak.hidden = run < 2;
      streak.textContent = `${run}× in Folge`;
      streak.style.opacity = String(clamp(0.55 + run / 12, 0, 1));
    }

    const chips = this.hud.querySelector("[data-belt-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="belt-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.max(0, Math.round(entry?.score || 0))}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-belt-banner]");
    if (!banner) return;
    const soon = arcade.nextChutes;
    if (soon) {
      banner.hidden = false;
      banner.textContent = "Schilder tauschen gleich!";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
    } else if (own && !own.reachable) {
      const parcel = own.queue?.[0];
      banner.hidden = false;
      banner.textContent = parcel ? `Gleich: ${parcel.icon || ""} ${parcel.name || ""}` : "Band läuft an";
      banner.style.background = "#2b3a45";
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }
  }
}

// Ein Sprite mit eigener Leinwand, die sich neu bemalen lässt.
function makeCanvasSprite(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, toneMapped: false }));
  sprite.userData.canvas = canvas;
  return sprite;
}

// Symbol auf weissem Teller — auf dem Band und im Flug gut lesbar, auch
// klein am Horizont.
function paintIcon(sprite, icon) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  ctx.clearRect(0, 0, w, w);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.beginPath();
  ctx.arc(w / 2, w / 2, w * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = w * 0.04;
  ctx.strokeStyle = "rgba(43, 58, 69, 0.35)";
  ctx.stroke();
  ctx.font = `${Math.floor(w * 0.6)}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(icon, w / 2, w / 2 + w * 0.04);
  sprite.material.map.needsUpdate = true;
}

// Rutschenschild: farbige Pille mit Symbol und Namen.
function paintSign(sprite, category, background, color) {
  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const r = h / 2 - 4;
  const pill = (x, y, width, height, radius) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  };
  ctx.fillStyle = "#ffffff";
  pill(2, 2, w - 4, h - 4, r);
  ctx.fill();
  ctx.fillStyle = background;
  pill(8, 8, w - 16, h - 16, r - 6);
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `${Math.floor(h * 0.5)}px ${EMOJI_FONT}`;
  ctx.fillText(category.icon, 20, h / 2 + 3);
  let size = Math.floor(h * 0.4);
  ctx.font = `900 ${size}px ui-rounded, system-ui, sans-serif`;
  while (size > 18 && ctx.measureText(category.name).width > w - 100) {
    size -= 2;
    ctx.font = `900 ${size}px ui-rounded, system-ui, sans-serif`;
  }
  ctx.fillStyle = color;
  ctx.fillText(category.name, 78, h / 2 + 2);
  sprite.material.map.needsUpdate = true;
}

function schildTextur(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2f6fb0";
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 58px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
