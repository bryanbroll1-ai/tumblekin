import * as THREE from "/vendor/three/three.module.js";
import { createCloud, standOn } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Pump-Panik — ein reiner Klicker: jeder Tipp pumpt den eigenen Ballon
// grösser. Wer am Ende am meisten gepumpt hat, bringt seinen zum Platzen.
//
// Das Schönste daran ist, alle vier Ballons live wachsen zu sehen. Die Figur
// stampft dabei bei jedem Pumpen auf die Pumpe; eine Krone schwebt über dem
// Ballon, der gerade vorn liegt. Im Finale hebt der dickste Ballon seinen Kin
// ein Stück in die Luft — und platzt.
// Eng genug, dass vier Stationen auf ein hochkantes Handy passen, ohne dass
// die Figuren zu Punkten werden.
const STATION_GAP = 1.2;
// Grösser als vorher (1.6): der Ballon IST die Anzeige, und bei 35 Pumps sah
// man den Unterschied zwischen erstem und letztem Platz kaum.
const BALLOON_MAX = 2.4;
const BALLOON_GROW = 45;   // Pumps bis gut zwei Drittel der Endgrösse
const DECK_Y = 0.3;

export class BalloonPump extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stations = new Map();
    this.localPumps = 0;
    this.leaderId = null;
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
    deck.position.y = DECK_Y / 2;
    deck.receiveShadow = true;
    deck.castShadow = true;
    scene.add(deck);
    const plank = new THREE.MeshLambertMaterial({ color: "#b67a3f" });
    for (let i = 0; i < 9; i += 1) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 3.1), plank);
      line.position.set(-3.2 + i * 0.8, DECK_Y + 0.005, 0);
      scene.add(line);
    }
    const trim = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 0.16), new THREE.MeshLambertMaterial({ color: "#ff5d73" }));
    trim.position.set(0, DECK_Y - 0.02, 1.62);
    scene.add(trim);

    // Wimpelleine hinter der Bühne.
    const flagColors = ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#b98cff"];
    this.flags = [];
    for (let i = 0; i < 17; i += 1) {
      const t = i / 16;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 3), new THREE.MeshLambertMaterial({ color: flagColors[i % 5] }));
      flag.rotation.x = Math.PI;
      flag.position.set(-4 + t * 8, 4.1 - Math.sin(t * Math.PI) * 0.5, -1.8);
      flag.userData.phase = i * 0.6;
      scene.add(flag);
      this.flags.push(flag);
    }
    [-4.1, 4.1].forEach((x) => {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.4, 0.14), new THREE.MeshLambertMaterial({ color: "#f4efe4" }));
      pole.position.set(x, 2.2, -1.8);
      pole.castShadow = true;
      scene.add(pole);
    });

    [[-7, 5.6, -6, 5], [7, 6.4, -4, 6], [0, 7, -9, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Die Krone über dem führenden Ballon.
    this.crown = buildCrown();
    this.crown.visible = false;
    scene.add(this.crown);

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureStation(player, index, players.length));
  }

  shot() {
    return { look: [0, 2.2, 0], frame: { w: 5.2, h: 4.6 }, pitch: 0.16, fov: 36, intro: { yaw: -0.6, pitch: 0.3, zoom: 1.6 } };
  }

  hudHtml() {
    return `<div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>`;
  }

  bind() {
    this.controls.innerHTML = `
      <div class="pump-single">
        <button type="button" class="pump-button" data-pump><span class="pump-button-face">PUMPEN</span></button>
        <p class="pump-hint">Tippen, so schnell du kannst!</p>
      </div>`;
    this.pumpButton = this.controls.querySelector("[data-pump]");
    // Jeder Finger zählt — auch zwei gleichzeitig. Keine Sperre zwischen den
    // Tipps.
    this.on(this.pumpButton, "pointerdown", (event) => {
      event.preventDefault();
      this.pressPump();
    });
  }

  pressPump() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || this.now() < minigame.startedAt) return;
    this.localPumps += 1;
    this.feedback?.sound("pop");
    this.feedback?.vibrate(6);
    // Die eigene Figur reagiert sofort, nicht erst mit der Antwort des Servers.
    this.stationPumped(this.getControlledPlayerId());
    this.sendInput({ action: "pump" }).catch(() => {});
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * STATION_GAP;
  }

  ensureStation(player, index, count) {
    if (this.stations.has(player.id)) return this.stations.get(player.id);
    const x = this.stationX(index, count);
    const kinZ = 0.35;

    // Kolbenpumpe VOR der Figur: sie drückt den T-Griff mit beiden Händen
    // herunter — genau die Bewegung der Pump-Pose.
    const red = new THREE.MeshLambertMaterial({ color: "#e04a58" });
    const dark = new THREE.MeshLambertMaterial({ color: "#40506a" });
    const pump = new THREE.Group();
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.26), dark);
    foot.position.y = 0.03;
    pump.add(foot);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.13), red);
    barrel.position.y = 0.16;
    barrel.castShadow = true;
    pump.add(barrel);
    const plunger = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), dark);
    rod.position.y = -0.08;
    plunger.add(rod);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.06), dark);
    plunger.add(handle);
    plunger.position.y = 0.34;
    pump.add(plunger);
    pump.position.set(x, DECK_Y, kinZ + 0.42);
    this.scene.add(pump);

    // Schlauch um die Figur herum zum Ballonpflock dahinter.
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), dark);
    peg.position.set(x + 0.32, DECK_Y + 0.2, -0.28);
    this.scene.add(peg);
    const hoseMat = new THREE.MeshLambertMaterial({ color: "#6b7b94" });
    const hoseA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.7), hoseMat);
    hoseA.position.set(x + 0.3, DECK_Y + 0.03, kinZ + 0.03);
    this.scene.add(hoseA);

    const balloon = buildBalloon(player.color);
    // Abwechselnd höher und weiter hinten: grosse Ballons stehen wie ein
    // Strauss gestaffelt, statt sich gegenseitig zu verdecken.
    const back = index % 2 === 1;
    balloon.userData.baseY = back ? 2.9 : 2.1;
    balloon.userData.baseZ = back ? -0.9 : -0.3;
    balloon.position.set(x, balloon.userData.baseY, balloon.userData.baseZ);
    balloon.scale.setScalar(0.42);
    this.scene.add(balloon);
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1, 0.025), new THREE.MeshLambertMaterial({ color: "#5a4a3a" }));
    this.scene.add(string);

    this.addKin(player, index, { x, ground: DECK_Y, z: kinZ });
    const station = { pump, plunger, balloon, string, peg, x, pulse: 0, lastPumps: 0, lift: 0 };
    this.stations.set(player.id, station);
    return station;
  }

  stationPumped(playerId) {
    const station = this.stations.get(playerId);
    const animator = this.animators.get(playerId);
    if (!station || !animator) return;
    station.pulse = 1;
    station.plunger.position.y = 0.2;
    animator.trigger("pump");
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
    kiste(scene, 0.14, 0.1, 0.14, "#8a90a0", [1.85, 0.05, 3.9]);
    ["#ff5d73", "#ffd15c", "#28c7d9"].forEach((farbe, i) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), lambert(farbe));
      ball.scale.y = 1.2;
      ball.userData = { basis: new THREE.Vector3(1.85 + (i - 1) * 0.2, 1.25 + (i % 2) * 0.22, 3.9 + (i === 1 ? -0.12 : 0.05)), phase: i * 2 };
      scene.add(ball);
      this.partyBalloons.push(ball);
    });
    const faeden = this.partyBalloons.map((b) => {
      const faden = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 4), lambert("#ffffff"));
      scene.add(faden);
      return faden;
    });
    this.partyStrings = faeden;

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

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (this.candleFlames) this.candleFlames.scale.setScalar(1 + Math.sin(now / 70) * 0.15);
    this.partyBalloons?.forEach((ball, i) => {
      const b = ball.userData.basis;
      ball.position.set(b.x + Math.sin(now / 900 + ball.userData.phase) * 0.05, b.y + Math.sin(now / 700 + ball.userData.phase) * 0.04, b.z);
      const faden = this.partyStrings[i];
      const unten = new THREE.Vector3(1.85, 0.1, 3.9);
      const oben = ball.position.clone().add(new THREE.Vector3(0, -0.2, 0));
      faden.position.copy(unten).lerp(oben, 0.5);
      faden.scale.y = unten.distanceTo(oben);
      faden.lookAt(oben);
      faden.rotateX(Math.PI / 2);
    });
    if (!arcade) return;

    let best = -1;
    let leader = null;
    players.forEach((player) => {
      const pumps = arcade.players[player.id]?.pumps || 0;
      if (pumps > best) { best = pumps; leader = player.id; }
      else if (pumps === best) leader = null;
    });

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const station = this.ensureStation(player, index, players.length);
      const animator = this.animators.get(player.id);
      const kin = this.kins.get(player.id);
      const mine = player.id === controlledId;
      const pumps = mine ? Math.max(entry.pumps || 0, this.localPumps) : (entry.pumps || 0);

      if (pumps > station.lastPumps) {
        if (!mine) this.stationPumped(player.id);
        station.lastPumps = pumps;
        // Alle zehn Pumps ein kleiner Knall — man hört, wer gut dabei ist.
        if (pumps % 10 === 0 && pumps > 0) {
          const at = station.balloon.position.clone();
          this.burst(at, [player.color, "#ffffff"], { count: 6, speed: 1.2, up: 1, size: 0.06, life: 0.5 });
          if (mine) this.feedback?.sound("sparkle");
        }
      }
      station.pulse *= Math.pow(0.001, dt);
      station.plunger.position.y += (0.34 - station.plunger.position.y) * frameLerp(0.22, dt);

      // Wächst schnell an und flacht dann ab: auch bei sehr schnellen Daumen
      // bleibt ein Unterschied sichtbar, statt dass alle am Deckel kleben.
      const size = 0.42 + (BALLOON_MAX - 0.42) * (1 - Math.exp(-pumps / BALLOON_GROW));
      const wobble = 1 + station.pulse * 0.14 + Math.sin(now / 300 + index) * 0.012;
      let balloonScale = size;
      if (finale && !station.popped) {
        const place = f.places?.[player.id];
        const since = Math.max(0, now - (f.minigame.finaleAt - 2600));
        if (place === 1) {
          // Überblasen, hochheben — und PENG.
          balloonScale = size * (1 + Math.min(0.9, since / 1100)) + Math.sin(now / 55) * 0.03;
          station.lift = Math.min(1.1, since / 900);
          if (since > 1250) this.popBalloon(player, station, mine);
          station.balloon.position.x = station.x;
        } else {
          station.deflate = station.deflate ?? size;
          balloonScale = Math.max(0.12, station.deflate * Math.max(0.12, 1 - since / 1500));
          station.balloon.position.x = station.x + Math.sin(now / 80 + index) * Math.min(0.35, since / 1300);
          if (since < 1500 && Math.random() < frameChance(0.3, dt)) {
            this.burst(station.balloon.position.clone(), ["#ffffff"], { count: 1, speed: 0.8, up: 0.3, size: 0.04, life: 0.3 });
          }
        }
      }
      station.balloon.scale.set(balloonScale * wobble, balloonScale * (1 + station.pulse * 0.2), balloonScale * wobble);
      const floatY = station.balloon.userData.baseY + balloonScale * 0.42 + Math.sin(now / 700 + index * 1.7) * 0.06 + station.lift * 1.2;
      station.balloon.position.z = station.balloon.userData.baseZ;
      station.balloon.position.y = floatY;
      station.balloon.rotation.z = Math.sin(now / 900 + index) * 0.06;

      // Der Sieger hängt am Ballon und wird mit hochgezogen.
      const kinGround = DECK_Y + (station.popped ? 0 : station.lift * 1.2);
      this.setGround(player.id, kinGround);
      if (station.lift > 0 && !station.popped) animator.set("hang");
      else if (!finale) animator.set(pumps > 0 && now - (station.lastAt || 0) < 400 ? "focus" : "idle");
      if (pumps !== station.seen) { station.seen = pumps; station.lastAt = now; }

      const balloonBottom = station.balloon.position.y - balloonScale * 0.45;
      const lifted = station.lift > 0 && !station.popped;
      const anchorY = lifted ? kin.position.y + 0.3 : DECK_Y + 0.4;
      const anchorX = lifted ? kin.position.x : station.x + 0.32;
      const anchorZ = lifted ? kin.position.z : -0.28;
      station.string.visible = station.balloon.visible;
      station.string.scale.y = Math.max(0.2, balloonBottom - anchorY);
      station.string.position.set((station.balloon.position.x + anchorX) / 2, (balloonBottom + anchorY) / 2, (station.balloon.position.z + anchorZ) / 2);
      station.string.rotation.z = Math.atan2(anchorX - station.balloon.position.x, balloonBottom - anchorY) * 0.9;

      // Der Ballon hängt hinter der Figur. Beim Pumpen geht nur der Blick nach
      // oben — das Gesicht bleibt zur Kamera, sonst sähe man nur Hinterköpfe.
      animator.look(finale ? null : (now - (station.lastAt || 0) < 400 ? 0 : null), 0.7);
    });

    // Krone über dem Führenden (nur wenn einer allein vorn liegt).
    if (leader && !finale && best > 0) {
      const station = this.stations.get(leader);
      this.crown.visible = true;
      const target = station.balloon.position.clone();
      target.y += station.balloon.scale.y * 0.62 + 0.25;
      this.crown.position.lerp(target, this.leaderId === leader ? frameLerp(0.3, dt) : 1);
      this.crown.rotation.y = now / 600;
      if (this.leaderId !== leader && this.leaderId !== null && leader === controlledId) this.feedback?.sound("select");
    } else {
      this.crown.visible = false;
    }
    this.leaderId = leader;

    this.flags.forEach((flag) => { flag.rotation.z = Math.sin(now / 320 + flag.userData.phase) * 0.18; });
  }

  popBalloon(player, station, mine) {
    station.popped = true;
    station.balloon.visible = false;
    station.string.visible = false;
    const at = station.balloon.position.clone();
    this.burst(at, [player.color, "#ffffff"], { count: 30, speed: 4.2, up: 2.6, size: 0.12, life: 1.1, drag: 1.1 });
    this.burst(at, ["#ffd15c", player.color, "#ffffff"], { count: 20, speed: 2.5, up: 3.4, size: 0.09, life: 1.3, drag: 0.9 });
    this.bursts.ring(at, "#ffffff", { radius: 2.6, life: 0.55, opacity: 0.65, tilt: null });
    this.pop(at.clone().add(new THREE.Vector3(0, 0.5, 0)), "PENG! 🎈", { color: "#ffe36b", size: 0.55, life: 1.1 });
    this.animators.get(player.id)?.trigger("land");
    this.rig.shake(0.55);
    this.feedback?.sound("impact");
    this.feedback?.vibrate([40, 26, 50]);
    if (mine) this.feedback?.sound("win");
  }

  // Der Sieger hängt am Ballon: dort keine Siegerpose, das Hängen IST sie.
  finaleOverride(player, place) {
    const station = this.stations.get(player.id);
    return place === 1 && station && !station.popped && station.lift > 0;
  }

  drawHud(f) {
    const own = f.arcade?.players?.[f.controlledId];
    const shown = Math.max(own?.pumps || 0, this.localPumps);
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    if (this.scoreNode) this.scoreNode.textContent = String(shown);
    if (this.pumpButton) this.pumpButton.disabled = Boolean(f.minigame.finaleAt);
  }
}

// Ein Ballon aus Klötzen: dicker Kern, Wölbungen, Knoten.
function buildBalloon(color) {
  const balloon = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.62), mat);
  core.castShadow = true;
  balloon.add(core);
  [[0.3, 0, 0], [-0.3, 0, 0], [0, 0, 0.3], [0, 0, -0.3]].forEach(([x, y, z]) => {
    const bulge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.34), mat);
    bulge.position.set(x, y + 0.03, z);
    balloon.add(bulge);
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), mat);
  top.position.y = 0.42;
  balloon.add(top);
  const shine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.6 }));
  shine.position.set(-0.16, 0.22, 0.32);
  balloon.add(shine);
  const knot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat);
  knot.position.y = -0.44;
  balloon.add(knot);
  return balloon;
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
  return crown;
}

export { standOn };

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
