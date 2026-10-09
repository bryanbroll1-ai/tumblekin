import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin213";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin213";
import { frameLerp } from "./Quality.js?v=tumblekin213";
import { createNameLabel } from "./VoxelKit.js?v=tumblekin213";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin213";
import { forecastHockey, hockeyRules, limits } from "./Puckbahn.js?v=tumblekin213";

// Luftpuck — ein riesiger Airhockey-Tisch in einer Neon-Spielhalle. Jeder
// Spieler IST ein Airhockey-Schläger: runder Fuss in der eigenen Farbe, ein
// Neonring in der Teamfarbe, Griff mit Knauf obendrauf, darüber das
// Namensschild. Vorher standen Figuren auf Schwebescheiben — sie verdeckten
// den Puck, und es sah nicht nach Airhockey aus. Das eigene Tor liegt für
// Team 0 vorn, für Team 1 hinten; die Banden leuchten in der Farbe des
// Teams, das sie verteidigt.
//
// Drumherum: Spielautomaten mit flimmernden Bildschirmen, ein Greifautomat,
// Neonschriften, eine Discokugel, die Lichtpunkte über den Boden wirft, und
// ein Punktestand über dem Tisch.
const TABLE_Y = 0.5;
const RAIL_H = 0.22;
const TEAM_COLORS = ["#ff3b8d", "#2fd6ff"];
const STICK_GAP_MS = 40;         // Stick höchstens so oft schicken
const TICK_LEAD_MS = 45;         // halber Servertakt (90 ms), siehe stickAt

export class AirHockey extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.mallets = new Map();      // playerId → { group, body, side, r, hit, hop }
    this.roundTrip = 0;
    this.stickLog = [];            // { at, x, y }: was das Gerät wann geschickt hat (Geräteuhr)
    this.stickWanted = null;
    this.stickSent = { x: 0, y: 0, clock: 0 };
    this.lastPingAt = 0;
    this.view = null;              // Vorausrechnung zur Ankunftszeit (forecastHockey)
    this.ownTouchAt = 0;           // wann das Gerät den eigenen Stoss schon gezeigt hat
    this.seenGoals = 0;
    this.labelY = 0.78;
    this.screens = [];
    this.spots = null;
    this.lastTouch = null;
  }

  stage() {
    return {
      label: "3D Luftpuck",
      background: "#12081f",
      fog: ["#12081f", 18, 44],
      lights: { sunPosition: [2, 12, 6], sunColor: 0xfff0ff, sunIntensity: 2.2, hemiIntensity: 1.5, skyColor: 0xb8a8ff, groundColor: 0x3a1a5a, fillColor: 0x6a4aff, fillIntensity: 0.9, shadow: { left: -4, right: 4, top: 5, bottom: -5 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0 : 0</strong></div>
      <div class="tug-teams" data-hockey-teams></div>
      <div class="color-banner" data-hockey-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame?.arcade;
    const state = arcade?.hockey;
    this.w = state?.w ?? 4.4;
    this.l = state?.l ?? 7.4;
    this.goalW = state?.goalW ?? 2.2;
    this.puckR = state?.puckR ?? 0.22;
    this.buildHall(scene);
    this.buildTable(scene);

    // Puck: flache Scheibe mit leuchtendem Rand.
    this.puck = new THREE.Group();
    const scheibe = new THREE.Mesh(new THREE.CylinderGeometry(this.puckR, this.puckR, 0.09, 24), lambert("#1c1c28"));
    scheibe.castShadow = true;
    this.puck.add(scheibe);
    const rand = new THREE.Mesh(new THREE.TorusGeometry(this.puckR, 0.025, 6, 24), new THREE.MeshBasicMaterial({ color: "#ffe25c" }));
    rand.rotation.x = Math.PI / 2;
    rand.position.y = 0.045;
    this.puck.add(rand);
    this.puck.position.set(0, TABLE_Y + 0.05, 0);
    scene.add(this.puck);
    this.trail = [];
    for (let i = 0; i < 8; i += 1) {
      const t = new THREE.Mesh(new THREE.CircleGeometry(this.puckR * (1 - i * 0.09), 16), new THREE.MeshBasicMaterial({ color: "#ffe25c", transparent: true, opacity: 0.25 * (1 - i / 8), depthWrite: false }));
      t.rotation.x = -Math.PI / 2;
      t.userData.isFx = true;
      scene.add(t);
      this.trail.push(t);
    }
    this.trailPoints = [];

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      const r = entry?.r ?? 0.36;
      const side = entry?.side ?? index % 2;
      const mallet = buildMallet(player.color, TEAM_COLORS[side], r);
      mallet.group.position.set(entry?.x ?? 0, TABLE_Y, entry?.z ?? 0);
      const label = createNameLabel(String(player.name || "?").slice(0, 8), player.color, { own: player.id === this.getControlledPlayerId() });
      label.position.y = this.labelY;
      mallet.group.add(label);
      this.labels.set(player.id, label);
      scene.add(mallet.group);
      this.mallets.set(player.id, { ...mallet, side, r, hit: 0, hop: 0 });
      // Im Zweierteam hat jeder eine Zone — die eigene leuchtet schwach auf
      // dem Tisch, damit klar ist, warum die Scheibe dort stehen bleibt.
      if (player.id === this.getControlledPlayerId() && entry?.lane) {
        const lim = limits(hockeyRules(arcade), side, 0, entry.lane);
        const w = lim.xMax - lim.xMin;
        const d = lim.zMax - lim.zMin;
        const zone = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[side], transparent: true, opacity: 0.1, depthWrite: false }));
        zone.rotation.x = -Math.PI / 2;
        zone.position.set(0, TABLE_Y + 0.004, (lim.zMin + lim.zMax) / 2);
        zone.userData.isFx = true;
        scene.add(zone);
        const kante = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.035), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[side], transparent: true, opacity: 0.55, depthWrite: false }));
        kante.rotation.x = -Math.PI / 2;
        // Die Kante, an der die Zone mitten im Feld endet.
        const edge = entry.lane === "sturm" ? (side === 0 ? lim.zMax : lim.zMin) : (side === 0 ? lim.zMin : lim.zMax);
        kante.position.set(0, TABLE_Y + 0.005, edge);
        kante.userData.isFx = true;
        scene.add(kante);
      }
    });
    if (state?.robot) {
      // Allein spielt man gegen einen Automaten-Schläger: grau, rotes Licht.
      const robo = buildMallet("#9aa6b8", "#ff3b3b", state.robot.r);
      robo.group.position.set(state.robot.x, TABLE_Y, state.robot.z);
      scene.add(robo.group);
      this.robot = robo.group;
    }
  }

  buildHall(scene) {
    // Boden: dunkle Kacheln, einige leuchten.
    kiste(scene, 40, 0.2, 40, "#1d1330", [0, -0.1, 0], { schatten: false });
    const zufall = streuer(71);
    const kacheln = [];
    const leuchten = [];
    for (let x = -9; x <= 9; x += 1) {
      for (let z = -9; z <= 9; z += 1) {
        if (Math.abs(x) < 3 && Math.abs(z) < 5) continue;
        (zufall() < 0.07 ? leuchten : kacheln).push({ p: [x, 0.005, z], r: [-Math.PI / 2, 0, 0], s: 0.9 });
      }
    }
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#2a1d45"), kacheln);
    this.glowTiles = viele(scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: "#ffffff" }), leuchten);
    this.glowCount = leuchten.length;
    this.tileColor = new THREE.Color();
    // Rückwand mit Spielautomaten.
    kiste(scene, 24, 6, 0.3, "#241640", [0, 3, -7.2], { schatten: false });
    const automatenFarben = ["#ff3b8d", "#2fd6ff", "#ffd15c", "#71d97b", "#b57bff", "#ff9f43"];
    for (let i = 0; i < 9; i += 1) {
      const x = -6.4 + i * 1.6;
      const a = new THREE.Group();
      kiste(a, 1.1, 1.9, 0.9, "#2c2f45", [0, 0.95, 0]);
      kiste(a, 1.12, 0.3, 0.92, automatenFarben[i % automatenFarben.length], [0, 2.0, 0]);
      const bildschirm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshBasicMaterial({ color: automatenFarben[(i + 2) % automatenFarben.length] }));
      bildschirm.position.set(0, 1.35, 0.46);
      bildschirm.rotation.x = -0.15;
      a.add(bildschirm);
      this.screens.push({ mesh: bildschirm, phase: i * 1.3, base: new THREE.Color(automatenFarben[(i + 2) % automatenFarben.length]) });
      kiste(a, 0.9, 0.12, 0.35, "#3b3f5a", [0, 0.9, 0.55]);
      kiste(a, 0.08, 0.14, 0.08, "#ff3b3b", [-0.2, 1.02, 0.58], { schatten: false });
      kiste(a, 0.08, 0.08, 0.08, "#ffe25c", [0.15, 1.0, 0.6], { schatten: false });
      kiste(a, 0.08, 0.08, 0.08, "#2fd6ff", [0.3, 1.0, 0.6], { schatten: false });
      a.position.set(x, 0, -6.4);
      scene.add(a);
    }
    // Seitlich: Greifautomat und Snackautomat.
    const greifer = new THREE.Group();
    kiste(greifer, 1.3, 0.9, 1.3, "#ff3b8d", [0, 0.45, 0]);
    const glas = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.3, 1.2), new THREE.MeshLambertMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.25 }));
    glas.position.y = 1.55;
    greifer.add(glas);
    kiste(greifer, 1.3, 0.2, 1.3, "#ff3b8d", [0, 2.3, 0]);
    viele(greifer, new THREE.SphereGeometry(0.14, 8, 6), lambert("#ffd15c"), [[-0.3, 1.0, -0.2], [0.2, 1.0, 0.1], [0, 1.1, -0.3], [0.35, 1.0, -0.3], [-0.2, 1.05, 0.3]].map((p) => ({ p })));
    viele(greifer, new THREE.SphereGeometry(0.12, 8, 6), lambert("#71d97b"), [[0.1, 1.2, 0.3], [-0.35, 1.2, 0.1]].map((p) => ({ p })));
    kiste(greifer, 0.05, 0.4, 0.05, "#c0c8d8", [0.1, 2.0, 0]);
    greifer.position.set(-5.2, 0, -2.5);
    greifer.rotation.y = 0.5;
    scene.add(greifer);
    const snack = new THREE.Group();
    kiste(snack, 1.1, 2.2, 0.9, "#2fd6ff", [0, 1.1, 0]);
    const fenster = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.4), new THREE.MeshBasicMaterial({ color: "#d9f6ff" }));
    fenster.position.set(-0.1, 1.3, 0.46);
    snack.add(fenster);
    for (let r = 0; r < 4; r += 1) viele(snack, new THREE.BoxGeometry(0.12, 0.18, 0.05), lambert(automatenFarben[r]), [0, 1, 2].map((c) => ({ p: [-0.32 + c * 0.22, 0.8 + r * 0.33, 0.48] })));
    snack.position.set(5.3, 0, -2.2);
    snack.rotation.y = -0.5;
    scene.add(snack);
    // Neonschrift über den Automaten.
    const schrift = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.1), new THREE.MeshBasicMaterial({ map: neonTextur("LUFTPUCK"), transparent: true }));
    schrift.position.set(0, 4.7, -7.0);
    scene.add(schrift);
    this.neon = schrift;
    // Neonröhren an den Wänden.
    [["#ff3b8d", -8], ["#2fd6ff", 8]].forEach(([farbe, x]) => {
      const roehre = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 10), new THREE.MeshBasicMaterial({ color: farbe }));
      roehre.position.set(x, 3.2, -2);
      scene.add(roehre);
    });
    kiste(scene, 0.3, 6, 16, "#241640", [-8.3, 3, -1], { schatten: false });
    kiste(scene, 0.3, 6, 16, "#241640", [8.3, 3, -1], { schatten: false });
    // Discokugel und ihre Lichtpunkte.
    const kugel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshLambertMaterial({ color: "#dfe6f2", flatShading: true, emissive: "#555566" }));
    kugel.position.set(0, 5.6, -1);
    scene.add(kugel);
    this.discoBall = kugel;
    const punkte = [];
    for (let i = 0; i < 26; i += 1) punkte.push({ p: [0, 0.012, 0], r: [-Math.PI / 2, 0, 0], s: 0.2 + zufall() * 0.15 });
    // Farbiges Licht, das sich addiert — weisse halbdurchsichtige Flecken
    // sahen auf dem dunklen Boden aus wie graue Schlieren.
    this.spots = viele(scene, new THREE.CircleGeometry(1, 10), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }), punkte);
    const neon = ["#ff3b8d", "#2fd6ff", "#b57bff", "#ffe25c"].map((c) => new THREE.Color(c));
    punkte.forEach((_, i) => this.spots.setColorAt(i, neon[i % neon.length]));
    if (this.spots.instanceColor) this.spots.instanceColor.needsUpdate = true;
    this.spots.userData.isFx = true;
    this.spotSeeds = punkte.map(() => ({ a: zufall() * Math.PI * 2, r: 3 + zufall() * 6, s: 0.1 + zufall() * 0.2 }));
    // Anzeigetafel über dem Tisch.
    const tafel = new THREE.Group();
    kiste(tafel, 2.6, 0.9, 0.2, "#101018", [0, 0, 0]);
    this.boardCanvas = document.createElement("canvas");
    this.boardCanvas.width = 256;
    this.boardCanvas.height = 96;
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTexture.colorSpace = THREE.SRGBColorSpace;
    const anzeige = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.8), new THREE.MeshBasicMaterial({ map: this.boardTexture }));
    anzeige.position.z = 0.11;
    tafel.add(anzeige);
    tafel.position.set(0, 3.6, -5.2);
    scene.add(tafel);
    this.drawBoard([0, 0]);
  }

  buildTable(scene) {
    const w = this.w;
    const l = this.l;
    // Tischkörper und Beine.
    kiste(scene, w + 0.6, TABLE_Y - 0.05, l + 0.6, "#2c2f45", [0, (TABLE_Y - 0.05) / 2, 0]);
    // Spielfläche mit Luftlöchern.
    const flaeche = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, l), new THREE.MeshLambertMaterial({ map: flaechenTextur(w, l) }));
    flaeche.position.y = TABLE_Y - 0.02;
    flaeche.receiveShadow = true;
    scene.add(flaeche);
    // Banden: an den Längsseiten weiss, an den Stirnseiten in Teamfarbe mit
    // offenem Tor in der Mitte.
    [-1, 1].forEach((seite) => {
      kiste(scene, 0.22, RAIL_H, l + 0.44, "#e8ecf6", [seite * (w / 2 + 0.11), TABLE_Y + RAIL_H / 2 - 0.02, 0]);
      const leiste = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, l + 0.3), new THREE.MeshBasicMaterial({ color: "#b57bff" }));
      leiste.position.set(seite * (w / 2 + 0.11), TABLE_Y + RAIL_H + 0.01, 0);
      scene.add(leiste);
    });
    [[1, 0], [-1, 1]].forEach(([seite, team]) => {
      const z = seite * (l / 2 + 0.11);
      const stueck = (w - this.goalW) / 2;
      [-1, 1].forEach((s) => {
        kiste(scene, stueck + 0.22, RAIL_H, 0.22, "#e8ecf6", [s * (this.goalW / 2 + stueck / 2 + 0.11), TABLE_Y + RAIL_H / 2 - 0.02, z]);
        const leiste = new THREE.Mesh(new THREE.BoxGeometry(stueck + 0.2, 0.05, 0.06), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
        leiste.position.set(s * (this.goalW / 2 + stueck / 2 + 0.11), TABLE_Y + RAIL_H + 0.01, z);
        scene.add(leiste);
      });
      // Torschlitz: dunkler Kasten mit leuchtender Kante.
      kiste(scene, this.goalW, 0.3, 0.5, "#0c0814", [0, TABLE_Y - 0.2, z + seite * 0.2], { schatten: false });
      const torlicht = new THREE.Mesh(new THREE.BoxGeometry(this.goalW, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team] }));
      torlicht.position.set(0, TABLE_Y + 0.01, z);
      scene.add(torlicht);
      if (team === 0) this.goalLight0 = torlicht;
      else this.goalLight1 = torlicht;
    });
    // Beine.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => kiste(scene, 0.3, TABLE_Y, 0.3, "#1c1f30", [sx * (w / 2), TABLE_Y / 2 - 0.3, sz * (l / 2 - 0.4)]));
  }

  drawBoard(score) {
    const ctx = this.boardCanvas.getContext("2d");
    ctx.fillStyle = "#101018";
    ctx.fillRect(0, 0, 256, 96);
    ctx.font = "900 64px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = TEAM_COLORS[1];
    ctx.fillText(String(score[1]), 64, 52);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(":", 128, 48);
    ctx.fillStyle = TEAM_COLORS[0];
    ctx.fillText(String(score[0]), 192, 52);
    this.boardTexture.needsUpdate = true;
  }

  shot() {
    return {
      look: [0, TABLE_Y, 0.25],
      frame: { w: this.w + 1.4, h: this.l * Math.sin(0.9) + 1.6 },
      pitch: 0.9,
      fov: 36,
      fill: 0.96,
      intro: { yaw: 0.6, pitch: 0.35, zoom: 1.4 },
      finale: { pull: 0.85, zoom: 0.62, lift: 0.3, orbit: 0.12 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Luftpuck: Schläger steuern",
      intervalMs: 60,
      feedback: this.feedback,
      surface: this.webglCanvas,
      globalKeys: true,
      onVector: (x, y) => this.queueStick(x, y),
      onEngage: () => this.feedback?.vibrate(8)
    });
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
  }

  // Der Stick meldet sich alle 60 ms und bei jedem Richtungswechsel — dazu
  // liest das Bild ihn in jedem Frame. Geschickt wird, was sich geändert hat,
  // höchstens alle 40 ms; jede Meldung kommt ins Log, damit die Vorausrechnung
  // weiss, ab wann der Server sie hat (wie in Farbenjagd).
  queueStick(x, y) {
    this.stickWanted = { x, y };
    this.flushStick();
  }

  flushStick() {
    const want = this.stickWanted;
    const minigame = this.update || this.minigame;
    if (!want || !minigame || minigame.finaleAt) return;
    const clock = performance.now();
    const same = Math.abs(want.x - this.stickSent.x) < 0.02 && Math.abs(want.y - this.stickSent.y) < 0.02;
    if (same && clock - this.stickSent.clock < 400) return;
    if (clock - this.stickSent.clock < STICK_GAP_MS) return;
    this.stickSent = { x: want.x, y: want.y, clock };
    const at = this.now();
    this.stickLog.push({ at, x: want.x, y: want.y });
    while (this.stickLog.length > 2 && this.stickLog[1].at < at - 3000) this.stickLog.shift();
    this.sendInput({ action: "steer", x: want.x, y: want.y })
      .then(() => this.noteRoundTrip(performance.now() - clock))
      .catch(() => {});
  }

  // Ohne Stick keine Antworten, also keine Laufzeit: dann misst ein Ping.
  pingIfIdle(minigame) {
    if (minigame.finaleAt || this.now() < minigame.startedAt) return;
    const clock = performance.now();
    if (clock - this.stickSent.clock < 1000 || clock - this.lastPingAt < 1000) return;
    this.lastPingAt = clock;
    this.sendInput({ action: "ping" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
  }

  // Rundreise zum Server, geglättet und wie überall auf 250 ms gedeckelt.
  noteRoundTrip(ms) {
    if (!Number.isFinite(ms)) return;
    const clamped = Math.max(0, Math.min(250, ms));
    this.roundTrip = this.roundTrip ? this.roundTrip * 0.8 + clamped * 0.2 : clamped;
  }

  // Welchen Stick der Server für den Schritt ab Serverzeit `at` hat: was dieses
  // Gerät eine Rundreise vorher geschickt hat, abzüglich eines halben Takts
  // (der Server liest den Stick einmal je Takt). Kam die Meldung vor dem
  // Serverstand an, steht sie schon in ihm.
  stickAt(at, from, entry) {
    const lands = (sent) => sent.at + this.roundTrip - TICK_LEAD_MS;
    let pick = null;
    for (const sent of this.stickLog) {
      if (lands(sent) <= at) pick = sent;
      else break;
    }
    if (!pick || lands(pick) <= from) return { x: entry.dirX || 0, y: entry.dirZ || 0 };
    return pick;
  }

  // Der Tisch zu der Serverzeit, zu der ein jetzt geschickter Stick ankommt.
  forecast(f) {
    const { arcade, minigame, players, controlledId } = f;
    const from = arcade.hockeyClock || minigame.sentAt || f.now;
    const endAt = (minigame.startedAt || 0) + (minigame.duration || 0);
    const to = minigame.finaleAt ? from : Math.min(Math.max(from, f.now + this.roundTrip), Math.max(from, endAt));
    const present = new Set(players.map((player) => player.id));
    const ids = (arcade.order || players.map((player) => player.id)).filter((id) => present.has(id) && arcade.players[id]);
    this.view = forecastHockey(arcade, {
      from,
      to,
      ids,
      inputAt: (id, at) => {
        const entry = arcade.players[id];
        return id === controlledId ? this.stickAt(at, from, entry) : { x: entry.dirX || 0, y: entry.dirZ || 0 };
      }
    });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId } = f;
    const state = arcade?.hockey;
    if (!state) return;
    if (this.joystick && this.joystick.pointerId !== null) this.queueStick(this.joystick.vecX, this.joystick.vecY);
    else this.flushStick();
    this.pingIfIdle(f.minigame);
    this.forecast(f);
    const view = this.view;

    // Der Puck, wie er beim Eintreffen des eigenen Sticks liegt. Springt er
    // weit (Anstoss nach einem Tor), springt auch das Bild.
    const p = view.state.puck;
    const jump = Math.hypot(p.x - this.puck.position.x, p.z - this.puck.position.z) > 1.2;
    this.puck.position.x = jump ? p.x : this.puck.position.x + (p.x - this.puck.position.x) * frameLerp(0.7, dt);
    this.puck.position.z = jump ? p.z : this.puck.position.z + (p.z - this.puck.position.z) * frameLerp(0.7, dt);
    this.puck.rotation.y += Math.hypot(p.vx, p.vz) * dt * 2;
    this.trailPoints.unshift(this.puck.position.clone());
    this.trailPoints.length = Math.min(this.trailPoints.length, this.trail.length * 2);
    const fast = Math.hypot(p.vx, p.vz) > 3;
    this.trail.forEach((t, i) => {
      const at = this.trailPoints[i * 2];
      t.visible = Boolean(at) && fast;
      if (at) t.position.set(at.x, TABLE_Y + 0.005, at.z);
    });

    // Der eigene Stoss: sofort, wenn die Vorausrechnung ihn sieht.
    if (!f.finale) {
      view.events.forEach((event) => {
        if (event.kind !== "touch" || event.id !== controlledId || event.at <= this.ownTouchAt) return;
        this.ownTouchAt = event.at;
        this.ownTouchShownAt = performance.now();
        const own = this.mallets.get(controlledId);
        if (own) own.hit = 1;
        this.burst(new THREE.Vector3(event.x, TABLE_Y + 0.1, event.z), [TEAM_COLORS[arcade.players[controlledId]?.side ?? 0], "#ffffff"], { count: 6, speed: 1.3, up: 0.8, size: 0.05, life: 0.35 });
        this.feedback?.sound("clack");
        this.feedback?.vibrate(10);
      });
    }

    // Die Schläger.
    const sieger = f.finale ? ((state.score?.[0] || 0) > (state.score?.[1] || 0) ? 0 : (state.score?.[1] || 0) > (state.score?.[0] || 0) ? 1 : -1) : -1;
    players.forEach((player) => {
      const entry = view.mallets.get(player.id) || arcade.players[player.id];
      const served = arcade.players[player.id];
      const m = this.mallets.get(player.id);
      if (!entry || !m) return;
      const isOwn = player.id === controlledId;
      // Der eigene Schläger folgt der Vorausrechnung fast ohne Verzug — er
      // IST schon die Antwort auf den Stick.
      const follow = isOwn ? 0.75 : 0.5;
      const g = m.group;
      const px = g.position.x;
      const pz = g.position.z;
      g.position.x += (entry.x - g.position.x) * frameLerp(follow, dt);
      g.position.z += (entry.z - g.position.z) * frameLerp(follow, dt);
      // Neigt sich leicht in die Bewegung, wie unter einer Hand.
      const vx = dt > 0 ? (g.position.x - px) / dt : 0;
      const vz = dt > 0 ? (g.position.z - pz) / dt : 0;
      m.body.rotation.z += (Math.max(-0.22, Math.min(0.22, -vx * 0.035)) - m.body.rotation.z) * frameLerp(0.3, dt);
      m.body.rotation.x += (Math.max(-0.22, Math.min(0.22, vz * 0.035)) - m.body.rotation.x) * frameLerp(0.3, dt);
      // Stoss: kurz breiter und flacher; Tor: ein Hüpfer; am Ende hüpft das
      // Siegerteam.
      m.hit = Math.max(0, m.hit - dt * 5);
      m.hop = Math.max(0, m.hop - dt * 1.6);
      const cheer = sieger === m.side ? Math.max(0, Math.sin(now / 140 + m.r * 7)) * 0.18 : 0;
      g.position.y = TABLE_Y + Math.sin(m.hop * Math.PI * 2) * 0.12 * m.hop + cheer;
      m.body.scale.set(1 + m.hit * 0.14, 1 - m.hit * 0.18, 1 + m.hit * 0.14);
      if (f.finale) return;
      // Stösse der anderen (und eigene, die die Vorausrechnung nicht sah)
      // kommen vom Server.
      if ((served?.touches || 0) > (m.touches ?? served?.touches ?? 0)) {
        const shown = isOwn && performance.now() - (this.ownTouchShownAt || 0) < 500;
        if (!shown) {
          m.hit = 1;
          this.burst(this.puck.position.clone().setY(TABLE_Y + 0.1), [TEAM_COLORS[m.side], "#ffffff"], { count: 6, speed: 1.3, up: 0.8, size: 0.05, life: 0.35 });
          if (isOwn) {
            this.feedback?.sound("clack");
            this.feedback?.vibrate(10);
          }
        }
      }
      m.touches = served?.touches || 0;
    });
    const robot = view.state.robot || state.robot;
    if (this.robot && robot) {
      this.robot.position.x += (robot.x - this.robot.position.x) * frameLerp(0.5, dt);
      this.robot.position.z += (robot.z - this.robot.position.z) * frameLerp(0.5, dt);
    }

    // Tore.
    if ((state.goals?.length || 0) > this.seenGoals) {
      const goal = state.goals[state.goals.length - 1];
      this.seenGoals = state.goals.length;
      const z = goal.side === 1 ? this.l / 2 : -this.l / 2;
      const at = new THREE.Vector3(goal.x || 0, TABLE_Y + 0.4, z);
      this.burst(at, [TEAM_COLORS[goal.side], "#ffffff", "#ffe25c"], { count: 30, speed: 3, up: 3, size: 0.09, life: 1.2 });
      this.bursts.ring(at.clone().setY(TABLE_Y + 0.05), TEAM_COLORS[goal.side], { radius: 1.6, life: 0.6, opacity: 0.8 });
      this.drawBoard(state.score);
      const shooter = goal.by ? players.find((pl) => pl.id === goal.by) : null;
      this.pop(at.clone().add(new THREE.Vector3(0, 0.8, 0)), goal.own ? "EIGENTOR!" : "TOR!", { color: "#ffe36b", size: 0.6, life: 1.4 });
      const torschuetze = shooter && this.mallets.get(shooter.id);
      if (torschuetze && !goal.own) torschuetze.hop = 1;
      const own = arcade.players[controlledId];
      this.rig.shake(0.45);
      if (own) {
        const ours = own.side === goal.side;
        this.feedback?.sound(ours ? "win" : "error");
        this.feedback?.vibrate(ours ? [20, 30, 50] : 40);
      }
      // Das Tor, in dem der Puck liegt, blinkt.
      const hitLight = goal.side === 1 ? this.goalLight0 : this.goalLight1;
      if (hitLight) hitLight.userData.flashUntil = performance.now() + 1200;
    }
    [this.goalLight0, this.goalLight1].forEach((licht, team) => {
      if (!licht) return;
      const flash = performance.now() < (licht.userData.flashUntil || 0);
      licht.material.color.set(flash && Math.floor(now / 90) % 2 ? "#ffffff" : TEAM_COLORS[team]);
    });

    // Halle: Bildschirme flimmern, Kacheln pulsieren, Discokugel dreht.
    this.screens.forEach((s) => {
      const k = 0.65 + 0.35 * Math.sin(now / 240 + s.phase * 3) * Math.sin(now / 90 + s.phase);
      s.mesh.material.color.copy(s.base).multiplyScalar(k);
    });
    if (this.glowTiles) {
      const colors = ["#ff3b8d", "#2fd6ff", "#b57bff", "#ffd15c"];
      const beat = Math.floor(now / 460);
      for (let i = 0; i < this.glowCount; i += 1) this.glowTiles.setColorAt(i, this.tileColor.set(colors[(i + beat) % colors.length]).multiplyScalar(0.32));
      this.glowTiles.instanceColor.needsUpdate = true;
    }
    if (this.discoBall) this.discoBall.rotation.y += dt * 0.8;
    if (this.spots) {
      const o = new THREE.Object3D();
      this.spotSeeds.forEach((sp, i) => {
        const a = sp.a + now / 1000 * 0.35;
        o.position.set(Math.cos(a) * sp.r, 0.015, -1 + Math.sin(a) * sp.r);
        o.rotation.set(-Math.PI / 2, 0, 0);
        o.scale.setScalar(sp.s);
        o.updateMatrix();
        this.spots.setMatrixAt(i, o.matrix);
      });
      this.spots.instanceMatrix.needsUpdate = true;
    }
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.hockey;
    if (!state) return;
    const own = arcade.players[controlledId];
    const ownSide = own?.side ?? 0;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = `${state.score[ownSide]} : ${state.score[1 - ownSide]}`;
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const teams = this.hud.querySelector("[data-hockey-teams]");
    if (teams) {
      const html = [ownSide, 1 - ownSide].map((side) => {
        const members = room.players.filter((player) => arcade.players[player.id]?.side === side);
        const names = members.length
          ? members.map((player) => `<b style="--chip:${player.color}">${escapeName(player.name)}</b>`).join("")
          : "<b style=\"--chip:#9aa6b8\">Roboter</b>";
        return `<div class="tug-team${side === ownSide ? " is-own" : ""}" style="box-shadow: inset 0 0 0 2px ${TEAM_COLORS[side]}">${names}<span class="hockey-goals">${state.score[side]}</span></div>`;
      }).join("<span class=\"tug-vs\">vs</span>");
      if (html !== this.teamsHtml) {
        this.teamsHtml = html;
        teams.innerHTML = html;
      }
    }
    const banner = this.hud.querySelector("[data-hockey-banner]");
    const serving = now < state.serveAt;
    let message = null;
    let tone = "#b57bff";
    const last = state.goals?.[state.goals.length - 1];
    if (now < minigame.startedAt + 1500) message = ownSide === 0 ? "Dein Tor ist unten!" : "Dein Tor ist oben!";
    else if (serving && last && now - last.at < 1300) {
      const ours = last.side === ownSide;
      message = ours ? "TOR! 🎉" : "Gegentor …";
      tone = ours ? "#ffc400" : "#ff3b8d";
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
      banner.style.color = tone === "#ffc400" ? "#5c4508" : "#ffffff";
    }
  }
}

function flaechenTextur(w, l) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = Math.round(256 * (l / w));
  const ctx = canvas.getContext("2d");
  const H = canvas.height;
  ctx.fillStyle = "#eaf4ff";
  ctx.fillRect(0, 0, 256, H);
  // Luftlöcher.
  ctx.fillStyle = "rgba(90, 120, 170, 0.35)";
  for (let y = 8; y < H; y += 14) for (let x = 8; x < 256; x += 14) ctx.fillRect(x, y, 2, 2);
  // Mittellinie, Mittelkreis, Torraum-Halbkreise.
  ctx.strokeStyle = "#b57bff";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(256, H / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(128, H / 2, 42, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = TEAM_COLORS[1];
  ctx.beginPath(); ctx.arc(128, 0, 62, 0, Math.PI); ctx.stroke();
  ctx.strokeStyle = TEAM_COLORS[0];
  ctx.beginPath(); ctx.arc(128, H, 62, Math.PI, Math.PI * 2); ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function neonTextur(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext("2d");
  ctx.font = "900 84px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#ff3b8d";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#ffd0ea";
  ctx.fillText(text, 256, 58);
  ctx.shadowBlur = 8;
  ctx.fillText(text, 256, 58);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}

// Ein Airhockey-Schläger: flacher Fuss, Neonring, kegeliger Aufbau, Griff
// mit Knauf. `body` neigt und staucht sich, `group` trägt die Position.
function buildMallet(color, ringColor, r) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const hell = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.18);
  const dunkel = new THREE.Color(color).lerp(new THREE.Color("#000000"), 0.25);
  const fuss = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, 0.08, 32), lambert(color));
  fuss.position.y = 0.04;
  fuss.castShadow = true;
  body.add(fuss);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.93, 0.035, 8, 32), new THREE.MeshBasicMaterial({ color: ringColor }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.085;
  body.add(ring);
  const aufbau = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.48, r * 0.8, 0.1, 28), lambert(color));
  aufbau.position.y = 0.13;
  aufbau.castShadow = true;
  body.add(aufbau);
  const griff = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.24, r * 0.3, 0.18, 20), new THREE.MeshLambertMaterial({ color: dunkel }));
  griff.position.y = 0.27;
  griff.castShadow = true;
  body.add(griff);
  const knauf = new THREE.Mesh(new THREE.SphereGeometry(r * 0.36, 20, 14), new THREE.MeshLambertMaterial({ color: hell }));
  knauf.scale.y = 0.8;
  knauf.position.y = 0.38;
  knauf.castShadow = true;
  body.add(knauf);
  // Ein Schein in der Ringfarbe unter dem Fuss.
  const schein = new THREE.Mesh(new THREE.CircleGeometry(r * 1.3, 24), new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: 0.22, depthWrite: false }));
  schein.rotation.x = -Math.PI / 2;
  schein.position.y = 0.006;
  schein.userData.isFx = true;
  group.add(schein);
  return { group, body };
}
