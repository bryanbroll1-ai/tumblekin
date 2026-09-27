import * as THREE from "/vendor/three/three.module.js";
import { createCloud, reachArm } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp, prefersReducedMotion } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Pump-Panik — ein reiner Klicker: jeder Tipp pumpt den eigenen Ballon
// grösser. Wer am Ende am meisten gepumpt hat, bringt seinen zum Platzen.
//
// Der Ballon IST die Anzeige. Damit man im Augenwinkel sieht, wer vorn liegt,
// wächst er über die ganze Runde gut lesbar (siehe balloonRadius), und die
// vier Ballons stehen in zwei Reihen gestaffelt wie ein Strauss: vorne die
// Stationen 1 und 3, hinten und höher 2 und 4. Wenn sie gross werden, drücken
// sie sich an ihren Schnüren gegenseitig zur Seite, statt ineinander zu
// stecken.
//
// Jeder Tipp ist eine kleine Kette: der Griff geht runter, die Figur geht mit,
// ein Luftstoss läuft durch den Schlauch, und wenn er ankommt, zuckt der
// Ballon und wird dicker. Im Finale reisst der dickste Ballon seinen Kin in
// die Luft und platzt; die anderen rutschen vom Ventil und sausen pfeifend
// davon.

// Figuren und Pumpen eine Nummer grösser als die Standardfigur: vier
// Stationen nebeneinander auf einem hochkanten Handy liessen die Figuren
// sonst zu Punkten schrumpfen.
const S = 1.3;
const STATION_GAP = 1.1;
const DECK_Y = 0.3;
const KIN_Z = 0.28;
// Der Griff liegt da, wo die kurzen Arme hinreichen: oben knapp unter den
// Schultern, unten auf Kniehöhe.
const GRIP_Z = KIN_Z + 0.2 * S;
const GRIP_UP = 0.26 * S;
const GRIP_DOWN = 0.14 * S;
const GRIP_HALF = 0.2 * S;
// Das Ventil auf seinem Pfosten hinter der Figur, über ihrem Kopf.
const NOZZLE_Y = DECK_Y + 1.28 * S;
// Ballongrösse aus der Zahl der Pumps: klein am Anfang, dann gut sichtbar
// wachsend, und erst weit jenseits dessen, was eine Hand in zwölf Sekunden
// schafft, am Anschlag. 50 / 75 / 100 Pumps ergeben 0,57 / 0,69 / 0,77 —
// vorher klebten ab 60 Pumps alle am Deckel.
const R0 = 0.2;
const R_MAX = 1.0;
const R_GROW = 80;
// Tropfenform: die Hülle ist um diesen Faktor höher als breit.
const TALL = 1.12;
// Endspurt: die letzten Sekunden bekommen ein eigenes Bild und eigenen Ton.
const RUSH_MS = 3000;

function balloonRadius(pumps) {
  return R0 + (R_MAX - R0) * (1 - Math.exp(-Math.max(0, pumps) / R_GROW));
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color("#ffffff");

export class BalloonPump extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stations = new Map();
    this.order = [];
    this.localPumps = 0;
    this.leaderId = null;
    this.tokens = null;
    this.tokenAt = 0;
    this.tapTimes = [];
    this.reduced = prefersReducedMotion();
    this.rushShown = false;
    this.lastTick = null;
  }

  stage() {
    return { label: "3D Pump-Panik", background: "#8fd6f2", fog: ["#a9e1f5", 22, 48] };
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 20), new THREE.MeshLambertMaterial({ color: "#7fb06c" }));
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    dressMeadow(scene, {
      seed: 6, keepOut: { x: 4.8, z: 3.4 }, spread: { x: 17, z: 15 },
      grassColor: "#7aac66", patchColors: ["#86b477", "#96bd86"],
      crownColor: "#3fa05a", crownColor2: "#5cb96f", crownShape: "blob", trunkColor: "#94693c"
    });
    this.buildParty(scene);

    // Holzbühne mit Planken und einem Rand — eine Jahrmarktbühne, keine Platte.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7.2, DECK_Y, 3.2), new THREE.MeshLambertMaterial({ color: "#c98d4e" }));
    deck.position.set(0, DECK_Y / 2, -0.2);
    deck.receiveShadow = true;
    deck.castShadow = true;
    scene.add(deck);
    viele(scene, new THREE.BoxGeometry(0.03, 0.01, 3.1), lambert("#b67a3f"),
      Array.from({ length: 9 }, (_, i) => ({ p: [-3.2 + i * 0.8, DECK_Y + 0.005, -0.2] })));
    const trim = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 0.16), new THREE.MeshLambertMaterial({ color: "#ff5d73" }));
    trim.position.set(0, DECK_Y - 0.02, 1.42);
    scene.add(trim);

    // Wimpelleine hinter der Bühne.
    const flagColors = ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#b98cff"];
    this.flags = [];
    for (let i = 0; i < 17; i += 1) {
      const t = i / 16;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 3), lambert(flagColors[i % 5]));
      flag.rotation.x = Math.PI;
      flag.position.set(-4 + t * 8, 5.2 - Math.sin(t * Math.PI) * 0.5, -2.2);
      flag.userData.phase = i * 0.6;
      scene.add(flag);
      this.flags.push(flag);
    }
    [-4.1, 4.1].forEach((x) => {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5.5, 0.14), lambert("#f4efe4"));
      pole.position.set(x, 2.75, -2.2);
      pole.castShadow = true;
      scene.add(pole);
    });

    [[-7, 6.6, -6, 5], [7, 7.4, -4, 6], [0, 8, -9, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Die Krone über dem führenden Ballon.
    this.crown = buildCrown();
    this.crown.visible = false;
    scene.add(this.crown);

    this.balloonGeometry = balloonGeometry();
    this.puffGeometry = new THREE.SphereGeometry(0.045 * S, 8, 6);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureStation(player, index, players.length));
  }

  shot() {
    // Eigene Finalfahrt (rigOptions): die Standardfahrt zoomt auf die Figur,
    // und der platzende Ballon darüber lag ausserhalb des Bildes.
    return {
      look: [0, 2.8, 0],
      frame: { w: 4.4, h: 5.6 },
      pitch: 0.14,
      fov: 36,
      intro: { yaw: -0.5, pitch: 0.28, zoom: 1.5 },
      finale: false
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips pump-chips" data-pump-chips></div>
      <div class="pump-rush" data-pump-rush hidden>ENDSPURT!</div>`;
  }

  bind() {
    this.controls.innerHTML = `
      <div class="pump-single">
        <button type="button" class="pump-button" data-pump>
          <span class="pump-button-face">PUMPEN</span>
          <span class="pump-tempo" aria-hidden="true"><i data-pump-tempo></i></span>
        </button>
        <p class="pump-hint" data-pump-hint>So schnell tippen, wie du kannst!</p>
      </div>`;
    this.pumpButton = this.controls.querySelector("[data-pump]");
    this.tempoBar = this.controls.querySelector("[data-pump-tempo]");
    this.hintNode = this.controls.querySelector("[data-pump-hint]");
    // Jeder Finger zählt — auch zwei gleichzeitig. Getippt werden darf auf den
    // Knopf, die ganze Leiste darum und das Spielbild: wer wild hämmert,
    // trifft nicht immer genau.
    const press = (event) => {
      if (event.button !== undefined && event.button > 0) return;
      event.preventDefault();
      this.pressPump();
    };
    this.on(this.controls.querySelector(".pump-single"), "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
    // Am Rechner: Leertaste oder Enter. Nicht, wenn gerade ein Menü oder ein
    // Eingabefeld den Fokus hat.
    this.on(window, "keydown", (event) => {
      if (event.repeat || (event.code !== "Space" && event.code !== "Enter")) return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable], dialog, .overlay")) return;
      const menu = document.getElementById("game-menu");
      if (menu && !menu.hidden) return;
      event.preventDefault();
      this.pressPump();
    });
  }

  // Tippt man schneller als der Server zählt (Autoklicker-Grenze), zählt das
  // Gerät genauso wenig — sonst liefe die eigene Zahl dem Server davon.
  takeToken(now, arcade) {
    const rate = arcade?.pumpRate || 16;
    const burst = arcade?.pumpBurst || 8;
    if (this.tokens === null) this.tokens = burst;
    this.tokens = Math.min(burst, this.tokens + (Math.max(0, now - this.tokenAt) / 1000) * rate);
    this.tokenAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  pressPump() {
    const minigame = this.update || this.minigame;
    const now = this.now();
    if (!minigame || minigame.finaleAt || now < minigame.startedAt || now > minigame.startedAt + minigame.duration) return;
    // Wer nur zuschaut, hat keine Pumpe.
    const id = this.getControlledPlayerId();
    if (!minigame.arcade?.players?.[id]) return;
    if (!this.takeToken(now, minigame.arcade)) return;
    this.localPumps += 1;
    this.tapTimes.push(performance.now());
    if (this.tapTimes.length > 20) this.tapTimes.shift();
    const station = this.stations.get(id);
    // Die eigene Station reagiert sofort, nicht erst mit der Antwort des
    // Servers. Der Ton steigt mit dem Ballon — man hört ihn dicker werden.
    if (station) this.stroke(station, now, true);
    const fill = station ? (station.radius - R0) / (R_MAX - R0) : 0;
    this.feedback?.sound("pump", { pitch: 1 + fill * 0.7, pan: station ? station.x / 4 : 0 });
    this.feedback?.vibrate(7);
    this.pumpButton?.animate?.([{ transform: "translateY(5px) scale(0.975)" }, { transform: "none" }], { duration: 110, easing: "ease-out" });
    this.sendInput({ action: "pump" }).catch(() => {});
  }

  // Eigenes Tempo (Tipps je Sekunde) aus den letzten Tipps.
  ownRate() {
    const t = performance.now();
    let n = 0;
    for (let i = this.tapTimes.length - 1; i >= 0 && t - this.tapTimes[i] < 1000; i -= 1) n += 1;
    return n;
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * STATION_GAP;
  }

  ensureStation(player, index, count) {
    if (this.stations.has(player.id)) return this.stations.get(player.id);
    const x = this.stationX(index, count);
    const back = index % 2 === 1;
    // Die Ventile der äusseren Stationen rücken etwas nach innen, damit die
    // grossen Ballons am Rand nicht aus dem Bild ragen.
    const postX = x * 0.9;
    const postZ = back ? KIN_Z - 0.62 : KIN_Z - 0.3;
    const neck = back ? 1.25 : 0.3;

    const group = new THREE.Group();
    this.scene.add(group);

    // Standpumpe VOR der Figur, in der Spielerfarbe: Fussplatte, Zylinder,
    // Kolbenstange mit T-Griff. Die Figur drückt den Griff mit beiden Händen.
    const body = new THREE.MeshPhongMaterial({ color: player.color, shininess: 60, specular: "#444444" });
    const dark = lambert("#3b4658");
    const steel = new THREE.MeshPhongMaterial({ color: "#c9d2dc", shininess: 90, specular: "#ffffff" });
    const pump = new THREE.Group();
    pump.position.set(x, DECK_Y, GRIP_Z);
    group.add(pump);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34 * S, 0.035 * S, 0.2 * S), dark);
    foot.position.y = 0.0175 * S;
    foot.castShadow = true;
    pump.add(foot);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.075 * S, 0.085 * S, 0.12 * S, 14), body);
    barrel.position.y = 0.035 * S + 0.06 * S;
    barrel.castShadow = true;
    pump.add(barrel);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.082 * S, 0.082 * S, 0.02 * S, 14), dark);
    cap.position.y = 0.035 * S + 0.12 * S;
    pump.add(cap);
    const plunger = new THREE.Group();
    pump.add(plunger);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * S, 0.012 * S, 0.16 * S, 6), steel);
    rod.position.y = -0.08 * S;
    plunger.add(rod);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(GRIP_HALF * 2 + 0.06 * S, 0.04 * S, 0.05 * S), steel);
    plunger.add(handle);
    [-1, 1].forEach((side) => {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08 * S, 0.05 * S, 0.06 * S), body);
      grip.position.x = side * (GRIP_HALF - 0.01 * S);
      plunger.add(grip);
    });
    plunger.position.y = GRIP_UP;

    // Pfosten mit Ventil hinter der Figur, der Schlauch läuft über die Bühne
    // und am Pfosten hoch.
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05 * S, NOZZLE_Y - DECK_Y, 0.05 * S), lambert("#f4efe4"));
    post.position.set(postX, (NOZZLE_Y + DECK_Y) / 2, postZ);
    post.castShadow = true;
    group.add(post);
    const postFoot = new THREE.Mesh(new THREE.BoxGeometry(0.2 * S, 0.03 * S, 0.2 * S), dark);
    postFoot.position.set(postX, DECK_Y + 0.015 * S, postZ);
    group.add(postFoot);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * S, 0.045 * S, 0.08 * S, 10), body);
    nozzle.position.set(postX, NOZZLE_Y + 0.04 * S, postZ);
    group.add(nozzle);
    const nozzleTop = new THREE.Vector3(postX, NOZZLE_Y + 0.08 * S, postZ);

    const side = x >= 0 ? 1 : -1;
    const hosePath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x + 0.07 * S * side, DECK_Y + 0.05 * S, GRIP_Z),
      new THREE.Vector3(x + 0.2 * S * side, DECK_Y + 0.02 * S, GRIP_Z - 0.02),
      new THREE.Vector3(x + 0.32 * S * side, DECK_Y + 0.02 * S, KIN_Z - 0.05),
      new THREE.Vector3((x + postX) / 2 + 0.2 * side, DECK_Y + 0.02 * S, postZ + 0.08),
      new THREE.Vector3(postX + 0.04 * S * side, DECK_Y + 0.05 * S, postZ + 0.03),
      new THREE.Vector3(postX + 0.04 * S * side, NOZZLE_Y - 0.25, postZ + 0.03),
      new THREE.Vector3(postX + 0.01 * side, NOZZLE_Y, postZ + 0.01)
    ], false, "catmullrom", 0.3);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(hosePath, 48, 0.017 * S, 6, false), lambert("#4d5b72"));
    hose.castShadow = true;
    group.add(hose);
    // Luftstösse im Schlauch: ein kleiner Vorrat, der wiederverwendet wird.
    const puffMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(player.color).lerp(WHITE, 0.55) });
    const puffs = Array.from({ length: 5 }, () => {
      const mesh = new THREE.Mesh(this.puffGeometry, puffMat);
      mesh.visible = false;
      mesh.userData.isFx = true;
      this.scene.add(mesh);
      return { mesh, t: -1 };
    });

    // Der Ballon: glänzende Latexhülle, ein Glanzlicht, der Knoten.
    const baseColor = new THREE.Color(player.color);
    const skin = new THREE.MeshPhongMaterial({ color: baseColor.clone(), shininess: 70, specular: "#666666", emissive: "#000000" });
    const balloon = new THREE.Group();
    const hull = new THREE.Mesh(this.balloonGeometry, skin);
    hull.castShadow = true;
    balloon.add(hull);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, depthWrite: false }));
    shine.userData.isFx = true;
    balloon.add(shine);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.05 * S, 0.07 * S, 8), skin);
    knot.rotation.x = Math.PI;
    balloon.add(knot);
    this.scene.add(balloon);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.01 * S, 0.01 * S, 1, 5), lambert("#fff7ea"));
    this.scene.add(string);
    // Für die Kamera: ein Punkt am oberen Rand des Ballons.
    const top = new THREE.Object3D();
    this.scene.add(top);

    // Die Figur steht etwas höher, weil sie grösser ist (standOn rechnet mit
    // der Sohle der Standardfigur).
    this.addKin(player, index, { x, ground: this.kinGround(0), z: KIN_Z, scale: S });

    const radius = R0;
    const rest = new THREE.Vector3(postX, nozzleTop.y + neck + radius * TALL, postZ);
    const station = {
      id: player.id,
      color: player.color,
      index,
      x,
      group,
      plunger,
      nozzleTop,
      neck,
      hosePath,
      puffs,
      balloon,
      hull,
      shine,
      knot,
      skin,
      baseColor,
      string,
      top,
      radius,
      pos: rest.clone(),
      vel: new THREE.Vector3(),
      rest,
      tilt: new THREE.Quaternion(),
      swell: 0,
      depth: 0,
      strokeAt: -1e9,
      strokeFrom: 0,
      strokeDur: 0.22,
      pending: 0,
      nextStrokeAt: 0,
      lastPumps: 0,
      history: [],
      rate: 0,
      lift: 0,
      liftVel: 0,
      popped: false,
      landed: false,
      loose: null,
      gone: false
    };
    this.stations.set(player.id, station);
    this.order.push(station);
    return station;
  }

  kinGround(lift) {
    // standOn() setzt die Standardfigur mit der Sohle auf `ground`. Bei S-facher
    // Grösse liegt die Sohle S-mal so tief unter der Mitte.
    return DECK_Y + 0.3 * (S - 1) + lift;
  }

  // Ein Pumpstoss an einer Station: Griff runter, Luftstoss auf den Weg.
  stroke(station, now, mine = false) {
    const interval = station.rate > 0.5 ? 1000 / station.rate : 260;
    station.strokeFrom = station.depth;
    station.strokeAt = now;
    station.strokeDur = Math.max(80, Math.min(260, interval * (mine ? 0.9 : 0.95)));
    const puff = station.puffs.find((p) => p.t < 0);
    if (puff) {
      puff.t = 0;
      puff.mesh.visible = true;
    } else {
      // Alle unterwegs: der Ballon bekommt die Luft trotzdem.
      station.swell = Math.min(1, station.swell + 0.5);
    }
  }

  // Wie weit der Griff unten ist (0..1): schnell runter, weich wieder hoch.
  strokeDepth(station, now) {
    const u = (now - station.strokeAt) / station.strokeDur;
    if (u >= 1 || u < 0) return 0;
    if (u < 0.38) {
      const k = u / 0.38;
      return station.strokeFrom + (1 - station.strokeFrom) * (1 - (1 - k) * (1 - k));
    }
    const k = (u - 0.38) / 0.62;
    return 1 - k * k * (3 - 2 * k);
  }

  // Eine Geburtstagsfeier im Garten: vorn eine karierte Picknickdecke mit
  // Torte und Kerzen, ein Geschenkestapel, ein Ballonbündel und Konfetti im
  // Gras; hinten ein Partyzelt und das Haus.
  buildParty(scene) {
    const zufall = streuer(19);
    const decke = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.25), new THREE.MeshLambertMaterial({ map: karoTextur() }));
    decke.rotation.set(-Math.PI / 2, 0, 0.12);
    decke.position.set(-0.95, 0.02, 3.3);
    decke.receiveShadow = true;
    scene.add(decke);
    const torte = new THREE.Group();
    torte.position.set(-0.95, 0.02, 3.25);
    scene.add(torte);
    [[0.34, 0.22, 0.11, "#ffb3c8"], [0.24, 0.18, 0.31, "#fff4e0"]].forEach(([r, h, y, farbe]) => {
      const stufe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), lambert(farbe));
      stufe.position.y = y;
      stufe.castShadow = true;
      torte.add(stufe);
    });
    const kerzen = [0, 1, 2, 3, 4].map((i) => ({ p: [Math.cos(i * 1.26) * 0.14, 0.47, Math.sin(i * 1.26) * 0.14] }));
    viele(torte, new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), lambert("#7fd6ff"), kerzen);
    this.candleFlames = viele(torte, new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: "#ffb020" }), kerzen.map((k) => ({ p: [k.p[0], 0.57, k.p[2]] })));
    viele(scene, new THREE.CylinderGeometry(0.16, 0.16, 0.02, 12), lambert("#ffffff"), [[-1.55, 3.0], [-0.4, 3.7], [-1.45, 3.75]].map(([x, z]) => ({ p: [x, 0.03, z] })));
    viele(scene, new THREE.CylinderGeometry(0.06, 0.05, 0.14, 8), lambert("#28c7d9"), [[-1.3, 2.85], [-0.5, 3.0]].map(([x, z]) => ({ p: [x, 0.09, z] })));

    // Geschenke.
    [[1.05, 3.0, 0.42, "#b98cff", "#ffd15c"], [1.5, 3.25, 0.32, "#28c7d9", "#ff5d73"], [1.2, 3.02, 0.26, "#ff5d73", "#ffffff", 0.34]].forEach(([x, z, g, farbe, band, y = 0]) => {
      const paket = kiste(scene, g, g, g, farbe, [x, y + g / 2, z]);
      paket.rotation.y = x * 0.6;
      kiste(paket, g + 0.01, g + 0.01, 0.06, band, [0, 0, 0], { schatten: false });
      kiste(paket, 0.06, g + 0.01, g + 0.01, band, [0, 0, 0], { schatten: false });
      kiste(paket, 0.14, 0.06, 0.14, band, [0, g / 2 + 0.03, 0], { schatten: false }).rotation.y = 0.8;
    });

    // Ballonbündel an einem Gewicht.
    this.partyBalloons = [];
    this.partyStrings = [];
    this.partyAnchor = new THREE.Vector3(3.3, 0.1, 3.2);
    kiste(scene, 0.14, 0.1, 0.14, "#8a90a0", [3.3, 0.05, 3.2]);
    ["#ff5d73", "#ffd15c", "#28c7d9"].forEach((farbe, i) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshPhongMaterial({ color: farbe, shininess: 60, specular: "#555555" }));
      ball.scale.y = 1.2;
      ball.userData = { basis: new THREE.Vector3(3.3 + (i - 1) * 0.2, 1.25 + (i % 2) * 0.22, 3.2 + (i === 1 ? -0.12 : 0.05)), phase: i * 2 };
      scene.add(ball);
      this.partyBalloons.push(ball);
      const faden = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 4), lambert("#ffffff"));
      scene.add(faden);
      this.partyStrings.push(faden);
    });

    // Konfetti im Gras.
    const farben = ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#b98cff"];
    farben.forEach((farbe) => {
      const schnipsel = [];
      for (let i = 0; i < 6; i += 1) schnipsel.push({ p: [(zufall() - 0.5) * 4.4, 0.015, 1.9 + zufall() * 3.4], r: [-Math.PI / 2, 0, zufall() * 3], s: 0.06 });
      viele(scene, new THREE.PlaneGeometry(1, 1), lambert(farbe), schnipsel);
    });

    // Partyzelt rechts hinten und das Haus links.
    const zelt = new THREE.Group();
    zelt.position.set(2.8, 0, -6.5);
    scene.add(zelt);
    kiste(zelt, 3.2, 1.6, 2.4, "#fdfaf2", [0, 0.8, 0]);
    const dach = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.2, 4), lambert("#fdfaf2"));
    dach.rotation.y = Math.PI / 4;
    dach.scale.set(1, 1, 0.78);
    dach.position.y = 2.2;
    zelt.add(dach);
    const zacken = [];
    for (let i = 0; i < 8; i += 1) zacken.push({ p: [-1.4 + i * 0.4, 1.52, 1.22], r: [Math.PI, 0, 0] });
    viele(zelt, new THREE.ConeGeometry(0.2, 0.26, 3), lambert("#ff5d73"), zacken);
    kiste(zelt, 1.4, 1.2, 0.02, "#e8dfcc", [0, 0.6, 1.21], { schatten: false });

    const haus = new THREE.Group();
    haus.position.set(-3.4, 0, -9.5);
    haus.rotation.y = 0.2;
    scene.add(haus);
    kiste(haus, 4, 2.8, 3, "#f3d9b0", [0, 1.4, 0]);
    [-1, 1].forEach((seite) => kiste(haus, 4.4, 0.14, 2, "#c8513b", [0, 3.3, seite * 0.72]).rotation.x = seite * 0.72);
    kiste(haus, 0.8, 1.4, 0.05, "#6b4a2e", [0.6, 0.7, 1.52]);
    viele(haus, new THREE.PlaneGeometry(0.6, 0.6), lambert("#8fc6e8"), [[-1.1, 1.6], [-1.1, 0.6], [1.5, 1.8]].map(([x, y]) => ({ p: [x, y, 1.53] })));
  }

  tickParty(now) {
    if (this.candleFlames) this.candleFlames.scale.setScalar(1 + Math.sin(now / 70) * 0.15);
    this.partyBalloons?.forEach((ball, i) => {
      const b = ball.userData.basis;
      ball.position.set(b.x + Math.sin(now / 900 + ball.userData.phase) * 0.05, b.y + Math.sin(now / 700 + ball.userData.phase) * 0.04, b.z);
      _b.copy(ball.position);
      _b.y -= 0.2;
      placeLine(this.partyStrings[i], this.partyAnchor, _b);
    });
    this.flags.forEach((flag) => { flag.rotation.z = Math.sin(now / 320 + flag.userData.phase) * 0.18; });
  }

  // Wer liegt vorn? Mehr Pumps; bei Gleichstand, wer die Zahl zuerst hatte —
  // genau wie der Server wertet.
  leaderOf(arcade, players, controlledId) {
    let leader = null;
    let best = 0;
    let bestAt = Infinity;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const pumps = this.pumpsOf(player.id, entry, controlledId);
      const at = entry.reachedMs ?? Infinity;
      if (pumps > best || (pumps === best && pumps > 0 && at < bestAt)) {
        best = pumps;
        bestAt = at;
        leader = player.id;
      }
    });
    return leader;
  }

  pumpsOf(id, entry, controlledId) {
    const server = entry?.pumps || 0;
    const minigame = this.update || this.minigame;
    // Im Finale gilt nur noch, was der Server gezählt hat.
    if (id !== controlledId || minigame?.finaleAt) return server;
    return Math.max(server, this.localPumps);
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    this.tickParty(now);
    if (!arcade) return;
    const end = minigame.startedAt + minigame.duration;
    const left = end - now;
    const rush = f.started && left > 0 && left <= RUSH_MS;
    const leader = this.leaderOf(arcade, players, controlledId);

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const station = this.ensureStation(player, index, players.length);
      const mine = player.id === controlledId;
      const pumps = this.pumpsOf(player.id, entry, controlledId);

      // Tempo aus dem Verlauf der Zahl über die letzte Sekunde; für mich
      // zählen zusätzlich die eigenen Tipps, die sofort da sind.
      const history = station.history;
      if (!history.length || history[history.length - 1].pumps !== pumps) history.push({ at: now, pumps });
      while (history.length > 2 && now - history[0].at > 1100) history.shift();
      const first = history[0];
      let rate = history.length > 1 && now - first.at > 150 ? (pumps - first.pumps) / Math.max(0.4, (now - first.at) / 1000) : 0;
      if (now - history[history.length - 1].at > 700) rate = 0;
      station.rate = mine ? Math.max(rate, this.ownRate()) : rate;

      // Neue Pumps kommen im Servertakt gebündelt an. Als Stösse werden sie im
      // Tempo der Hand verteilt, nicht alle auf einmal. Meine eigenen Tipps
      // haben ihren Stoss schon beim Tippen bekommen — nur was der Server
      // darüber hinaus zählt (Wiedereinstieg, Autopilot), kommt hier dazu.
      if (pumps > station.lastPumps) {
        const tapped = mine ? this.localPumps - (station.localSeen || 0) : 0;
        station.pending = Math.min(6, station.pending + Math.max(0, pumps - station.lastPumps - tapped));
        this.milestones(station, player, station.lastPumps, pumps, mine);
        station.lastPumps = pumps;
      }
      if (mine) station.localSeen = this.localPumps;
      if (station.pending > 0 && now >= station.nextStrokeAt && !finale) {
        station.pending -= 1;
        this.stroke(station, now);
        const interval = station.rate > 0.5 ? 1000 / station.rate : 120;
        station.nextStrokeAt = now + Math.max(55, Math.min(260, interval));
      }

      // Griff, Figur und Luftstösse.
      const depth = finale ? 0 : this.strokeDepth(station, now);
      station.depth += (depth - station.depth) * frameLerp(0.7, dt);
      station.plunger.position.y = GRIP_UP - (GRIP_UP - GRIP_DOWN) * station.depth;
      this.advancePuffs(station, dt);

      // Der Ballon wächst mit der Zahl — weich, nicht in Stufen.
      const target = balloonRadius(pumps);
      if (!finale) station.radius += (target - station.radius) * frameLerp(0.18, dt);
      station.swell *= Math.pow(0.004, dt);

      this.animateKin(player, station, f, rush);
      if (finale) this.finaleStation(player, station, f);
      this.simulateBalloon(station, f, rush);
      this.drawBalloon(station, f, rush);
    });

    this.separateBalloons(dt);

    // Krone über dem führenden Ballon.
    const crownAt = leader && !finale ? this.stations.get(leader) : null;
    if (crownAt && !crownAt.loose) {
      this.crown.visible = true;
      _a.copy(crownAt.pos);
      _a.y += crownAt.radius * TALL * (1 + crownAt.swell * 0.12) + 0.22;
      // Wechselt die Führung, fliegt die Krone hinüber, statt zu springen.
      this.crown.position.lerp(_a, this.crownPlaced ? frameLerp(this.leaderId === leader ? 0.3 : 0.2, dt) : 1);
      this.crownPlaced = true;
      this.crown.rotation.y = now / 600;
      // Kopf an Kopf wechselt die Führung mehrmals je Sekunde — gefeiert wird
      // höchstens alle anderthalb Sekunden.
      if (this.leaderId !== leader && this.leaderId !== null && leader === controlledId && f.started && now - (this.cheeredAt || 0) > 1500) {
        this.cheeredAt = now;
        this.feedback?.sound("select");
        this.feedback?.vibrate(14);
        this.pop(_a.clone().add(new THREE.Vector3(0, 0.35, 0)), "Führung!", { color: "#ffe36b", size: 0.36, life: 0.8 });
      }
    } else {
      this.crown.visible = false;
    }
    this.leaderId = leader;

    // Endspurt: ein Banner, ein Ton, jede Sekunde ein Tick.
    if (rush && !this.rushShown) {
      this.rushShown = true;
      this.showRush();
      this.feedback?.sound("combo");
      this.feedback?.vibrate([18, 30, 18]);
    }
    const second = Math.ceil(left / 1000);
    if (rush && second !== this.lastTick && second >= 1 && second <= 3) {
      this.lastTick = second;
      if (second < 3) this.feedback?.sound("countdown");
    }
  }

  // Kleine Feiern unterwegs: alle 10 Pumps ein Funkeln am Ballon, für mich
  // alle 25 dazu die Zahl und ein Ton.
  milestones(station, player, before, after, mine) {
    // Ein grosser Sprung (Wiedereinstieg nach Verbindungsabbruch) ist kein
    // Anlass für eine Feuerwerkssalve.
    if (after - before > 12) return;
    for (let n = before + 1; n <= after; n += 1) {
      if (n % 10 === 0) {
        this.burst(_a.copy(station.pos).add(_b.set(0, station.radius * 0.6, 0.2)).clone(), [player.color, "#ffffff"], { count: mine ? 7 : 4, speed: 1.1, up: 0.9, size: 0.05, life: 0.45, gravity: 2 });
      }
      if (mine && n % 25 === 0) {
        this.feedback?.sound("combo");
        this.pop(_a.copy(station.pos).add(_b.set(0, station.radius * TALL + 0.3, 0)).clone(), String(n), { color: "#ffffff", size: 0.34, life: 0.7 });
      }
    }
  }

  advancePuffs(station, dt) {
    station.puffs.forEach((puff) => {
      if (puff.t < 0) return;
      // Etwa 0,15 s durch den ganzen Schlauch — spürbar, aber nicht träge.
      puff.t += dt / 0.15;
      if (puff.t >= 1) {
        puff.t = -1;
        puff.mesh.visible = false;
        station.swell = Math.min(1, station.swell + 0.6);
        station.vel.y += 0.25;
        return;
      }
      station.hosePath.getPointAt(puff.t, puff.mesh.position);
      puff.mesh.scale.setScalar(1 + Math.sin(puff.t * Math.PI) * 0.4);
    });
  }

  animateKin(player, station, f, rush) {
    const animator = this.animators.get(player.id);
    if (!animator || f.finale) return;
    const strain = Math.min(1, station.rate / 11) * 0.7 + (rush ? 0.3 : 0);
    animator.set("pumpen", { params: { stroke: station.depth, strain: f.started ? strain : 0 } });
    animator.look(null);
    // Schweisstropfen bei hohem Tempo.
    if (f.started && station.rate >= 8 && Math.random() < frameChance(0.05 + (station.rate - 8) * 0.02, f.dt)) {
      const kin = this.kins.get(player.id);
      _a.set(kin.position.x + (Math.random() - 0.5) * 0.3, kin.position.y + 0.55 * S, kin.position.z + 0.1);
      this.burst(_a.clone(), ["#8fdcff", "#ffffff"], { count: 2, speed: 0.9, up: 1.2, size: 0.04, life: 0.45, gravity: 5 });
    }
  }

  // Hände an den Griff — nach der Pose, damit Ducken und Neigen stimmen.
  afterAnimate(f) {
    this.stations.forEach((station) => {
      const kin = this.kins.get(station.id);
      if (!kin) return;
      if (f.finale) {
        if (station.lift > 0.05 && !station.popped) {
          // Der Sieger hält sich mit beiden Händen an der Schnur fest.
          _a.copy(kin.position);
          _a.y += 0.75 * S;
          reachArm(kin, 0, _a, 1);
          reachArm(kin, 1, _a, 1);
        }
        return;
      }
      station.plunger.updateWorldMatrix(true, false);
      reachArm(kin, 0, station.plunger.localToWorld(_a.set(GRIP_HALF - 0.01 * S, 0.01, 0)), 1);
      reachArm(kin, 1, station.plunger.localToWorld(_a.set(-GRIP_HALF + 0.01 * S, 0.01, 0)), 1);
    });
  }

  // Finale: Platz 1 bläst nach, wird hochgehoben und platzt; alle anderen
  // Ballons rutschen vom Ventil und sausen pfeifend davon.
  finaleStation(player, station, f) {
    const { now, dt } = f;
    const since = (now - (f.minigame.finaleAt - 2600)) / 1000;
    const winnerId = this.finaleWinnerId(f);
    const mine = player.id === f.controlledId;
    if (player.id === winnerId) {
      if (!station.popped) {
        const u = Math.min(1, since / 1.1);
        const grow = balloonRadius(station.lastPumps) * (1 + 0.55 * u * u);
        station.radius += (grow - station.radius) * frameLerp(0.25, dt);
        station.lift = Math.min(1.2, Math.max(0, since - 0.2) * 1.5);
        if (since > 1.3) this.popBalloon(player, station, mine);
      } else {
        // Fallen und landen.
        station.liftVel -= 11 * dt;
        station.lift = Math.max(0, station.lift + station.liftVel * dt);
        if (station.lift === 0 && !station.landed) {
          station.landed = true;
          this.animators.get(player.id)?.trigger("land");
          this.bursts.ring(this.kins.get(player.id).position, "#ffffff", { radius: 0.9, life: 0.35, opacity: 0.5, y: DECK_Y + 0.03 });
          this.feedback?.sound("land");
        }
      }
      this.setGround(player.id, this.kinGround(station.lift));
      if (station.lift > 0.05 && !station.popped) this.animators.get(player.id)?.set("hang");
      return;
    }
    if (winnerId === null && since < 0.2) return;
    // Nacheinander, nicht alle im selben Augenblick.
    const slipAt = 0.25 + station.index * 0.17;
    if (!station.loose && since >= slipAt) {
      station.loose = { at: now, turnAt: 0, ax: 0, ay: 0, az: 0, from: station.radius };
      this.feedback?.sound("deflate", { pan: station.x / 4, pitch: 0.8 + Math.random() * 0.5 });
      this.burst(station.nozzleTop.clone(), ["#ffffff"], { count: 4, speed: 0.8, up: 0.6, size: 0.04, life: 0.35 });
    }
  }

  finaleWinnerId(f) {
    if (this.winnerCache !== undefined && this.winnerFor === f.minigame.finaleAt) return this.winnerCache;
    const ids = Object.keys(f.places || {}).filter((id) => f.places[id] === 1);
    // Niemand hat getippt (alle gleichauf): kein Sieger-Ballon.
    this.winnerCache = ids.length === 1 && (f.arcade.players[ids[0]]?.pumps || 0) > 0 ? ids[0] : null;
    this.winnerFor = f.minigame.finaleAt;
    return this.winnerCache;
  }

  // Die Ballons hängen an Schnüren: Auftrieb zieht sie gerade nach oben, Wind
  // und Pumpstösse lassen sie schaukeln, die Schnur hält sie am Ventil.
  simulateBalloon(station, f, rush) {
    const { now, dt } = f;
    const pos = station.pos;
    const vel = station.vel;
    if (station.popped || station.gone) return;
    if (station.loose) {
      // Frei: die ausströmende Luft schiebt den Ballon wild herum, er
      // schrumpft und ist nach gut einer Sekunde weg.
      const loose = station.loose;
      const age = (now - loose.at) / 1000;
      if (now >= loose.turnAt) {
        loose.turnAt = now + 90 + Math.random() * 90;
        const a = Math.random() * Math.PI * 2;
        loose.ax = Math.cos(a) * 16;
        loose.az = Math.sin(a) * 5;
        loose.ay = 6 + Math.random() * 12;
      }
      vel.x += loose.ax * dt;
      vel.y += loose.ay * dt;
      vel.z += loose.az * dt;
      vel.multiplyScalar(Math.pow(0.12, dt));
      pos.addScaledVector(vel, dt);
      station.radius = loose.from * Math.max(0.1, 1 - age / 1.3);
      if (age > 1.3) {
        station.gone = true;
        station.balloon.visible = false;
        station.string.visible = false;
      }
      return;
    }
    // Ruhelage: gerade über dem Ventil — oder, beim Sieger, über seinen Händen.
    const lifted = station.lift > 0;
    const kin = this.kins.get(station.id);
    const anchor = lifted && kin ? _a.set(kin.position.x, kin.position.y + 0.75 * S, kin.position.z) : _a.copy(station.nozzleTop);
    // Beim Sieger wird die Schnur kurz: der Ballon zieht direkt über seinen
    // Händen, und Figur und Ballon passen zusammen ins Bild.
    const length = (lifted ? 0.35 : station.neck) + station.radius * TALL;
    station.rest.set(anchor.x, anchor.y + length, anchor.z);
    const steps = 2;
    const h = dt / steps;
    const wind = Math.sin(now / 1300 + station.index * 1.7) * 0.5 + Math.sin(now / 470 + station.index) * 0.2;
    const tremble = rush ? 1.4 : 0;
    for (let i = 0; i < steps; i += 1) {
      vel.x += (-(pos.x - station.rest.x) * 16 - vel.x * 3.4 + wind + (Math.random() - 0.5) * tremble * 6) * h;
      vel.y += (-(pos.y - station.rest.y) * 16 - vel.y * 3.4) * h;
      vel.z += (-(pos.z - station.rest.z) * 16 - vel.z * 3.4) * h;
      pos.addScaledVector(vel, h);
      // Die Schnur ist straff: weiter als ihre Länge kommt der Ballon nicht.
      _dir.subVectors(pos, anchor);
      const d = _dir.length();
      if (d > length && d > 1e-4) {
        _dir.divideScalar(d);
        pos.copy(anchor).addScaledVector(_dir, length);
        const out = vel.dot(_dir);
        if (out > 0) vel.addScaledVector(_dir, -out);
      }
    }
  }

  // Grosse Ballons schieben sich gegenseitig zur Seite.
  separateBalloons(dt) {
    const list = this.order;
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i];
      if (a.popped || a.gone || a.loose) continue;
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j];
        if (b.popped || b.gone || b.loose) continue;
        _dir.subVectors(a.pos, b.pos);
        _dir.z *= 0.6;
        const d = _dir.length();
        const min = (a.radius + b.radius) * 1.04;
        if (d >= min || d < 1e-4) continue;
        _dir.divideScalar(d);
        const push = (min - d) * 40 * dt;
        a.vel.addScaledVector(_dir, push);
        b.vel.addScaledVector(_dir, -push);
      }
    }
  }

  drawBalloon(station, f, rush) {
    const { now } = f;
    const balloon = station.balloon;
    if (station.popped || station.gone) return;
    const r = station.radius;
    const pulse = station.swell;
    // Beim Luftstoss kurz breiter als hoch, dann wieder rund.
    const wide = r * (1 + pulse * 0.1);
    const tall = r * (1 + pulse * 0.04);
    const shake = rush && !this.reduced ? Math.sin(now / 23 + station.index * 2) * 0.012 * r : 0;
    balloon.position.set(station.pos.x + shake, station.pos.y, station.pos.z);
    station.hull.scale.set(wide, tall, wide);
    // Latex wird beim Dehnen heller; ein Stoss leuchtet kurz auf.
    const fill = (r - R0) / (R_MAX - R0);
    station.skin.color.copy(station.baseColor).lerp(WHITE, Math.max(0, Math.min(0.2, fill * 0.12)));
    station.skin.emissive.copy(station.baseColor).multiplyScalar(pulse * 0.35);
    station.shine.scale.set(r * 0.2, r * 0.3, r * 0.08);
    station.shine.position.set(-r * 0.38, r * 0.42, r * 0.82);
    station.shine.rotation.z = 0.5;
    station.knot.position.y = -r * TALL - 0.02 * S;

    // Neigung entlang der Schnur.
    const kin = this.kins.get(station.id);
    const lifted = station.lift > 0 && !station.loose;
    const anchor = station.loose
      ? null
      : lifted && kin ? _a.set(kin.position.x, kin.position.y + 0.75 * S, kin.position.z) : _a.copy(station.nozzleTop);
    if (anchor) {
      _dir.subVectors(station.pos, anchor).normalize();
      _q.setFromUnitVectors(UP, _dir);
    } else {
      // Frei fliegend: der Knoten zeigt gegen die Flugrichtung.
      _dir.copy(station.vel);
      if (_dir.lengthSq() > 1e-4) _q.setFromUnitVectors(UP, _dir.normalize());
    }
    station.tilt.slerp(_q, 0.35);
    balloon.quaternion.copy(station.tilt);
    balloon.rotateY(Math.sin(now / 1500 + station.index) * 0.25);

    // Die Schnur vom Ventil (oder den Händen) zum Knoten.
    station.string.visible = Boolean(anchor);
    if (anchor) {
      balloon.updateMatrixWorld();
      station.knot.getWorldPosition(_b);
      placeLine(station.string, anchor, _b);
    }
    station.top.position.set(station.pos.x, station.pos.y + r * TALL, station.pos.z);
  }

  popBalloon(player, station, mine) {
    station.popped = true;
    station.liftVel = 0.6;
    station.balloon.visible = false;
    station.string.visible = false;
    const at = station.pos.clone();
    this.burst(at, [player.color, "#ffffff"], { count: 34, speed: 4.4, up: 2.8, size: 0.12, life: 1.1, drag: 1.1 });
    this.burst(at, ["#ffd15c", player.color, "#ffffff", "#71d97b", "#28c7d9"], { count: 26, speed: 2.6, up: 3.6, size: 0.09, life: 1.5, drag: 0.9, gravity: 3.2 });
    this.bursts.ring(at, "#ffffff", { radius: 3, life: 0.55, opacity: 0.7, tilt: null });
    this.pop(at.clone().add(new THREE.Vector3(0, 0.6, 0)), "PENG! 🎈", { color: "#ffe36b", size: 0.6, life: 1.2 });
    this.animators.get(player.id)?.expression("surprised", 500);
    this.rig.shake(0.6);
    this.feedback?.sound("burst");
    this.feedback?.vibrate([40, 26, 60]);
    if (mine) this.feedback?.sound("win");
  }

  // Der Sieger hängt am Ballon: dort keine Siegerpose, das Hängen IST sie.
  // Nach dem Platzen fällt er erst — gejubelt wird nach der Landung.
  finaleOverride(player, place) {
    const station = this.stations.get(player.id);
    if (!station || place !== 1 || this.winnerCache !== player.id) return false;
    return !station.landed;
  }

  // Die Kamera behält alle Figuren und die Ballonkuppen im Bild.
  keepInView() {
    const keep = [...this.kins.values()];
    this.stations.forEach((station) => {
      if (!station.popped && !station.gone && !station.loose) keep.push(station.top);
    });
    return keep;
  }

  // Finale: den Sieger MIT seinem Ballon rahmen, bis es knallt; danach nah auf
  // die Landung.
  rigOptions(f) {
    if (!f.finale) {
      // Querformat: das freie Band ist flach, die volle Höhe des Strausses
      // machte die Figuren winzig. Hier zählt die Breite; wird ein Ballon zu
      // gross, holt keepInView die Kamera ohnehin zurück.
      const size = this.rig.lastSize;
      const wide = size.w > size.h * 1.2;
      const base = this.rig.base.frame;
      let w = base.w;
      let h = wide ? 4.1 : base.h;
      const look = wide ? [0, 2.3, 0] : undefined;
      // Endspurt: die Kamera rückt ein Stück näher — man spürt, dass es
      // gleich vorbei ist.
      const left = f.minigame.startedAt + f.minigame.duration - f.now;
      if (f.started && left > 0 && left <= RUSH_MS && !this.reduced) {
        const k = 1 - 0.07 * Math.min(1, (RUSH_MS - left) / 1200);
        w *= k;
        h *= k;
      } else if (!wide) {
        return null;
      }
      return look ? { frame: { w, h }, look } : { frame: { w, h } };
    }
    const id = this.finaleWinnerId(f);
    const station = id && this.stations.get(id);
    const kin = id && this.kins.get(id);
    if (!station || !kin) return null;
    if (!station.popped) {
      const top = station.pos.y + station.radius * TALL;
      const bottom = kin.position.y - 0.35 * S;
      const h = Math.max(3, (top - bottom) * 1.3);
      return { look: [kin.position.x * 0.8, (top + bottom) / 2, 0], frame: { w: h * 0.9, h }, pitch: 0.12 };
    }
    return { look: [kin.position.x * 0.8, kin.position.y + 0.5, kin.position.z], frame: { w: 3.2, h: 3 }, pitch: 0.16 };
  }

  showRush() {
    const node = this.hud?.querySelector("[data-pump-rush]");
    if (!node) return;
    node.hidden = false;
    node.classList.remove("zeigen");
    void node.offsetWidth;
    node.classList.add("zeigen");
    clearTimeout(this.rushTimer);
    this.rushTimer = setTimeout(() => { node.hidden = true; }, 1500);
  }

  unbind() {
    clearTimeout(this.rushTimer);
  }

  drawHud(f) {
    const { arcade, players, controlledId, minigame, now } = f;
    const own = arcade?.players?.[controlledId];
    const shown = this.pumpsOf(controlledId, own, controlledId);
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(shown);
    if (this.scoreNode && this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const left = minigame.startedAt + minigame.duration - now;
    const over = Boolean(minigame.finaleAt) || left <= 0;
    this.scorebar ||= this.hud.querySelector(".kinetic-scorebar");
    this.scorebar?.classList.toggle("pump-hurry", f.started && !over && left <= RUSH_MS);

    // Stand aller: in der Reihenfolge der Stationen auf der Bühne, der
    // Führende mit Krone.
    const chips = this.chipsNode ||= this.hud.querySelector("[data-pump-chips]");
    if (chips && arcade) {
      const leader = this.leaderId;
      const html = players.map((player) => {
        const entry = arcade.players[player.id];
        const count = this.pumpsOf(player.id, entry, controlledId);
        const lead = player.id === leader && count > 0;
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}${lead ? " is-lead" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${count}</span>`;
      }).join("");
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }

    if (this.pumpButton) {
      if (this.pumpButton.disabled !== over) this.pumpButton.disabled = over;
    }
    const station = this.stations.get(controlledId);
    const rate = station ? station.rate : 0;
    const max = (arcade?.pumpRate || 16) - 1;
    if (this.tempoBar) {
      const share = Math.min(1, rate / 12);
      this.tempoBar.style.transform = `scaleX(${share.toFixed(3)})`;
      this.tempoBar.dataset.level = rate >= max ? "max" : rate >= 8 ? "hoch" : rate >= 4 ? "mittel" : "niedrig";
    }
    if (this.hintNode) {
      const hint = over
        ? "Zeit!"
        : !f.started
          ? "Gleich geht's los …"
          : left <= RUSH_MS
            ? "Endspurt — alles geben!"
            : rate >= max
              ? "Volle Pulle!"
              : "So schnell tippen, wie du kannst!";
      if (this.hintNode.textContent !== hint) this.hintNode.textContent = hint;
    }
  }
}

// Eine Schnur (Zylinder der Höhe 1) von a nach b legen.
function placeLine(mesh, a, b) {
  _dir.subVectors(b, a);
  const length = _dir.length();
  mesh.position.copy(a).addScaledVector(_dir, 0.5);
  mesh.scale.set(1, Math.max(0.001, length), 1);
  if (length > 1e-5) mesh.quaternion.setFromUnitVectors(UP, _dir.divideScalar(length));
}

// Ein Ballon: oben voll und rund, unten zum Knoten hin spitz. Radius 1, die
// Szene skaliert ihn auf die aktuelle Grösse.
function balloonGeometry() {
  const geometry = new THREE.SphereGeometry(1, 24, 18);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = y < 0 ? 1 - 0.3 * Math.pow(-y, 1.8) : 1 + 0.03 * (1 - y * y);
    pos.setXYZ(i, x * k, y * TALL, z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildCrown() {
  const crown = new THREE.Group();
  const gold = new THREE.MeshLambertMaterial({ color: "#ffd24a", emissive: "#a27511", emissiveIntensity: 0.35 });
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.36), gold);
  crown.add(band);
  [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]].forEach(([x, z]) => {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), gold);
    tip.position.set(x, 0.12, z);
    crown.add(tip);
  });
  const gem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: "#ff5d8f" }));
  gem.position.set(0, 0.02, 0.19);
  crown.add(gem);
  crown.traverse((o) => { o.userData.isFx = true; });
  return crown;
}

function escapeName(name) {
  return String(name || "?").slice(0, 8).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Rot-weiss karierte Picknickdecke.
function karoTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff8ee";
  ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = "rgba(224, 69, 59, 0.55)";
  for (let i = 0; i < 8; i += 2) {
    ctx.fillRect(i * 16, 0, 16, 96);
    ctx.fillRect(0, i * 16, 128, 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}
