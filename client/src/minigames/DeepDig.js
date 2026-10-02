import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin209";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin209";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin209";
import { eventChance, frameLerp, fxScale } from "./Quality.js?v=tumblekin209";
import { airToSurface, forecastDiver, jellyAt, timeToSurface } from "./Tauchgang.js?v=tumblekin209";

// Tiefenrausch: tauchen mit dem Stick. Gold liegt im ganzen Schacht, je tiefer
// desto wertvoller, ganz unten eine Truhe. Die Luft sinkt — unten schneller —,
// an der Oberfläche füllt sie sich und das getragene Gold ist eingezahlt.
// Quallen kosten Luft und etwas Gold; wem die Luft ausgeht, der wird
// ohnmächtig, verliert, was er trägt, und treibt nach oben.
//
// Die alte Fassung war ein Würfelspiel mit Spaten: Tippen grub, eine
// Zufallszahl entschied über den Einsturz. Jetzt steuert man selbst, sieht die
// Gefahr kommen und entscheidet mit Blick auf die Luftanzeige, wie gierig man
// ist. Alle tauchen im selben Schacht, man sieht die anderen um dieselbe
// Truhe schwimmen.
//
// Gezeigt wird der Schacht so, wie er beim Server steht, wenn eine JETZT
// geschickte Stickbewegung dort ankommt: die eigene Figur vorausgerechnet
// (Tauchgang.js), die Quallen zur selben Zeit. Vorher hing die Figur dem Stick
// eine Rundreise hinterher, und die Quallen eine halbe — bei 200 ms wich man
// sichtbar aus und wurde doch gestochen.
const S = 0.36;                  // Welteinheiten je Meter
const STICK_GAP_MS = 40;         // so dicht folgen Stickmeldungen höchstens
const PICK_GRACE_MS = 700;       // so lange wartet eine Münze auf den Server
const TICK_LEAD_MS = 45;         // halber Servertick (90 ms)
const WALL = 1.2;                // Dicke der Felswände (Welt)
const SURFACE_COLOR = new THREE.Color("#63c7ec");
const DEEP_COLOR = new THREE.Color("#0c2748");
const _c = new THREE.Color();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class DeepDig extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.coinMeshes = new Map();
    this.jellyMeshes = [];
    this.seen = new Map();       // je Spieler: zuletzt gesehene Ereignisse
    this.labelY = 0.72;
    this.roundTrip = 0;
    this.stickLog = [];          // { at, x, y }: was das Gerät wann geschickt hat (Geräteuhr)
    this.stickWanted = null;
    this.stickSent = { x: 0, y: 0, clock: -1e9 };
    this.views = new Map();      // je Spieler: der vorausgerechnete Taucher
    this.viewAt = 0;             // Serverzeit, für die das Bild gilt
    this.shown = [];             // eigene Ereignisse, die das Gerät schon gezeigt hat
  }

  stage() {
    return {
      label: "3D Tiefenrausch",
      background: "#63c7ec",
      fog: ["#63c7ec", 10, 30],
      lights: { sunPosition: [-3, 12, 8], sunIntensity: 2.0, hemiIntensity: 2.2 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="dive-panel">
        <div class="dive-air" data-dive-air><span class="dive-air-label">LUFT</span><span class="dive-air-bar"><i data-dive-air-fill></i><b data-dive-air-mark hidden></b></span></div>
        <div class="dive-info"><span data-dive-depth>0 m</span><span data-dive-carried>🪙 0 dabei</span></div>
      </div>
      <div class="dig-chips" data-dig-chips></div>
      <div class="color-banner dig-banner" data-dig-banner hidden></div>`;
  }

  // Meter → Welt.
  wx(x) {
    return (x - this.width / 2) * S;
  }

  wy(depth) {
    return -depth * S;
  }

  build(f) {
    const scene = this.scene;
    const arcade = (this.update || this.minigame)?.arcade || {};
    this.width = arcade.width || 12;
    this.depth = arcade.depth || 48;
    const halfW = (this.width / 2) * S;
    const bottom = this.wy(this.depth);
    void f;

    // Rückwand: dunkelt nach unten ab, damit man die Tiefe sieht.
    const back = new THREE.PlaneGeometry(halfW * 2 + WALL * 2, -bottom + 2, 1, 24);
    const colors = [];
    const pos = back.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      const u = clamp((-(y + (bottom - 2) / 2)) / (-bottom), 0, 1);
      _c.copy(SURFACE_COLOR).lerp(DEEP_COLOR, u).multiplyScalar(0.8);
      colors.push(_c.r, _c.g, _c.b);
    }
    back.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const backMesh = new THREE.Mesh(back, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    backMesh.position.set(0, (bottom - 2) / 2 + 1, -1.6);
    scene.add(backMesh);

    // Felswände links und rechts, gestuft wie Voxel, nach unten dunkler.
    const rockMat = (u) => new THREE.MeshLambertMaterial({ color: _c.set("#8a7a6a").lerp(new THREE.Color("#3b3430"), u).getHex() });
    for (let d = 0; d < this.depth + 2; d += 3) {
      const u = d / this.depth;
      [-1, 1].forEach((side) => {
        // Die Felsnasen bleiben schmaler als der Rand, den der Server den
        // Tauchern lässt (0,6 m), und die Felsen enden knapp vor der Ebene der
        // Figuren. Vorher ragten sie 0,8 weit nach vorn und bis zu 0,47 in den
        // Schacht — Münzen und Quallen am Rand steckten halb im Stein.
        const bulge = 0.06 + ((d * 7 + (side > 0 ? 3 : 0)) % 5) * 0.035;
        const rock = new THREE.Mesh(new THREE.BoxGeometry(WALL + bulge, 3 * S + 0.02, 1.7), rockMat(u));
        rock.position.set(side * (halfW + WALL / 2 - bulge / 2 + 0.02), this.wy(d + 1.5), -0.75);
        scene.add(rock);
      });
    }
    // Grund: Sand, Steine, Seegras.
    const sand = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + WALL * 2, 0.5, 2.4), new THREE.MeshLambertMaterial({ color: "#c9a46a" }));
    sand.position.set(0, bottom - 0.25, -0.4);
    scene.add(sand);
    // Darunter Fels. Am Grund schaut die Kamera tiefer, damit die Truhe über
    // dem Stick liegt — unter dem Sand war dort sonst leerer Himmel zu sehen.
    const bedrock = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + WALL * 2 + 3, 8, 2.4), new THREE.MeshLambertMaterial({ color: "#3b3430" }));
    bedrock.position.set(0, bottom - 0.5 - 4, -0.4);
    scene.add(bedrock);
    this.weeds = [];
    for (let i = 0; i < 9; i += 1) {
      const x = -halfW + 0.3 + (i / 8) * (halfW * 2 - 0.6);
      const weed = new THREE.Group();
      for (let k = 0; k < 4; k += 1) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.06), new THREE.MeshLambertMaterial({ color: k % 2 ? "#3fae62" : "#57c77a" }));
        leaf.position.y = 0.14 + k * 0.26;
        weed.add(leaf);
      }
      weed.position.set(x, bottom, -0.9 + (i % 3) * 0.2);
      weed.userData.phase = i * 1.3;
      scene.add(weed);
      this.weeds.push(weed);
    }

    // Wasseroberfläche von der Seite: ein heller Streifen, darüber Himmel und
    // ein Steg — dort landet das Gold.
    const surface = new THREE.Mesh(
      new THREE.BoxGeometry(halfW * 2 + WALL * 2 + 4, 0.08, 2.6),
      new THREE.MeshBasicMaterial({ color: "#bff0ff", transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false })
    );
    surface.position.set(0, 0.02, -0.4);
    scene.add(surface);
    this.surface = surface;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshBasicMaterial({ color: "#9adcf2", toneMapped: false }));
    sky.position.set(0, 6.05, -1.7);
    scene.add(sky);
    const dock = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + WALL * 2 + 0.6, 0.16, 0.9), new THREE.MeshLambertMaterial({ color: "#a47449" }));
    dock.position.set(0, 0.34, -1.05);
    scene.add(dock);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 0.14), new THREE.MeshLambertMaterial({ color: "#7d5536" }));
      post.position.set(side * (halfW + 0.5), -0.2, -1.05);
      scene.add(post);
    });
    // Die Schatzkiste auf dem Steg: hier klimpert es beim Einzahlen.
    const bank = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.42), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
    box.position.y = 0.18;
    bank.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 0.46), new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#a8741a", emissiveIntensity: 0.3 }));
    lid.position.y = 0.42;
    bank.add(lid);
    bank.position.set(0, 0.42, -1.05);
    scene.add(bank);
    this.bank = bank;
    [[-4, 3.2, -6, 2], [3.6, 4.2, -7, 5]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Lichtstrahlen von oben — zart, nur in den oberen Metern.
    this.rays = [];
    for (let i = 0; i < 4; i += 1) {
      const ray = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5 + i * 0.12, 7),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
      );
      ray.position.set(-halfW + 0.6 + i * (halfW * 0.6), -3.2, -1.2);
      ray.rotation.z = 0.18;
      scene.add(ray);
      this.rays.push(ray);
    }

    // Münzen und Truhe.
    const coinGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.06, 14);
    (arcade.coins || []).forEach((coin) => {
      let mesh;
      if (coin.chest) {
        mesh = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.42), new THREE.MeshLambertMaterial({ color: "#7a4c24" }));
        body.position.y = 0.2;
        mesh.add(body);
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.46), new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#c48a1a", emissiveIntensity: 0.5 }));
        top.position.y = 0.46;
        mesh.add(top);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
        glow.position.y = 0.3;
        mesh.add(glow);
      } else {
        // Tiefer = wertvoller = grösser und wärmer in der Farbe.
        const u = clamp(coin.y / this.depth, 0, 1);
        const color = u > 0.66 ? "#ff9d4d" : u > 0.33 ? "#ffc64a" : "#ffe36b";
        mesh = new THREE.Mesh(coinGeo, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
        mesh.rotation.x = Math.PI / 2;
        mesh.scale.setScalar(0.9 + u * 0.7);
      }
      mesh.position.set(this.wx(coin.x), this.wy(coin.y), 0);
      mesh.userData = { coin, base: mesh.position.y };
      scene.add(mesh);
      this.coinMeshes.set(coin.id, mesh);
    });

    // Quallen: halbe Kuppel, darunter wabernde Fäden.
    (arcade.jellies || []).forEach(() => {
      const jelly = new THREE.Group();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: "#ff8fd0", emissive: "#e0409a", emissiveIntensity: 0.45, transparent: true, opacity: 0.82 })
      );
      jelly.add(dome);
      const tentacles = [];
      for (let k = 0; k < 5; k += 1) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), new THREE.MeshBasicMaterial({ color: "#ffc2e6", transparent: true, opacity: 0.8 }));
        t.position.set(-0.2 + k * 0.1, -0.22, 0);
        jelly.add(t);
        tentacles.push(t);
      }
      jelly.userData.tentacles = tentacles;
      jelly.userData.dome = dome;
      scene.add(jelly);
      this.jellyMeshes.push(jelly);
    });

    // Taucher: die Figuren mit Taucherglocke.
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const entry = arcade.players?.[player.id];
      const kin = this.addKin(player, index, { x: this.wx(entry?.x ?? this.width / 2), ground: 0, z: 0.15, facing: 0, scale: 0.74 });
      const helmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 16, 12),
        new THREE.MeshLambertMaterial({ color: "#dff6ff", transparent: true, opacity: 0.28, depthWrite: false })
      );
      helmet.position.y = 0.66;
      kin.add(helmet);
    });
  }

  shot() {
    return {
      look: [0, -1.5, 0],
      frame: { w: (this.width || 12) * S + 1.4, h: 5.2 },
      yaw: 0,
      pitch: 0.05,
      fov: 38,
      intro: { yaw: 0.35, pitch: 0.15, zoom: 1.25 },
      finale: { pull: 0.9, zoom: 0.7, lift: 0.2, orbit: 0.08 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Tiefenrausch: tauchen",
      intervalMs: 70,
      feedback: this.feedback,
      onVector: (x, y) => this.queueStick(x, y),
      onEngage: () => this.feedback?.vibrate(8)
    });
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
    this.coinMeshes.clear();
    this.jellyMeshes.length = 0;
  }

  // Der Stick meldet sich alle 70 ms und bei jedem Richtungswechsel — dazu
  // liest das Bild ihn in jedem Frame. Geschickt wird, was sich geändert hat,
  // höchstens alle 40 ms; jede Meldung kommt ins Log, damit die Vorausrechnung
  // weiss, ab wann der Server sie hat.
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
    // Unverändert nur ab und zu — als Lebenszeichen und zum Messen der Laufzeit.
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
    if (clock - this.stickSent.clock < 1000 || clock - (this.lastPingAt || 0) < 1000) return;
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
  // Gerät eine Rundreise vorher geschickt hat (Geräteuhr = Serverzeit minus
  // einfache Laufzeit, dazu die Laufzeit hin). Kam die Meldung schon vor dem
  // Serverstand an, steht sie in ihm — dann gilt der.
  //
  // Der Server liest den Stick einmal je Tick und rechnet damit alle Schritte
  // seit dem letzten Tick — eine Meldung wirkt dort also im Schnitt einen
  // halben Tick VOR ihrer Ankunft. So rechnet es hier auch.
  stickAt(at, from, entry) {
    const lands = (sent) => sent.at + this.roundTrip - TICK_LEAD_MS;
    let pick = null;
    for (const sent of this.stickLog) {
      if (lands(sent) <= at) pick = sent;
      else break;
    }
    if (!pick || lands(pick) <= from) return { x: entry.inX || 0, y: entry.inY || 0 };
    return pick;
  }

  // Alle Taucher zu der Serverzeit, zu der eine jetzt geschickte Eingabe
  // ankommt. Die eigene Figur mit dem eigenen Stick, die anderen mit dem, den
  // der Server gerade von ihnen hat.
  forecast(f) {
    const { arcade, minigame, players } = f;
    const startedAt = minigame.startedAt || 0;
    const from = arcade.diveClock || minigame.sentAt || f.now;
    const endAt = startedAt + (minigame.duration || 0);
    const to = minigame.finaleAt ? from : clamp(f.now + this.roundTrip, from, Math.max(from, endAt));
    this.views.clear();
    this.pickedAhead = new Set();
    // Erst die anderen: wer von ihnen eine Münze früher erreicht, dem gehört
    // sie auch in der eigenen Rechnung. Sonst zeigte das Gerät „+32“ für eine
    // Münze, die ein Bot eine Zehntelsekunde vorher schnappt — und gleich
    // darauf „weg!“.
    const claims = new Map();
    const order = [...players].sort((a, b) => (a.id === f.controlledId) - (b.id === f.controlledId));
    order.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const own = player.id === f.controlledId;
      const view = forecastDiver(entry, arcade, {
        from,
        to,
        startedAt,
        claims: own ? claims : null,
        inputAt: own ? (at) => this.stickAt(at, from, entry) : () => ({ x: entry.inX || 0, y: entry.inY || 0 })
      });
      if (!own) view.pickedAt.forEach((at, id) => claims.set(id, Math.min(at, claims.get(id) ?? Infinity)));
      view.picked.forEach((id) => this.pickedAhead.add(id));
      this.views.set(player.id, view);
    });
    this.viewAt = this.views.values().next().value?.at ?? from;
  }

  // Die Kamera folgt der eigenen Figur in die Tiefe — und hält sie über dem
  // Stick: der deckt das untere Viertel ab, und genau dorthin schaut man beim
  // Abtauchen. Wer nach unten schwimmt, sieht mehr unter sich, wer aufsteigt,
  // mehr über sich.
  rigOptions(f) {
    const own = this.views.get(f.controlledId) || f.arcade?.players?.[f.controlledId];
    if (!own) return {};
    const heading = clamp((own.vy || 0) / 6.8, -1, 1);
    this.camLead = (this.camLead ?? 1.2) + ((1.2 + heading * 0.9) - (this.camLead ?? 1.2)) * frameLerp(0.04, f.dt);
    const y = clamp(this.wy(own.y) - this.camLead, this.wy(this.depth) + 3.4, -1.4);
    return { look: [0, y, 0] };
  }

  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    return own ? [own] : [];
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade?.coins) return;
    if (this.joystick && this.joystick.pointerId !== null) this.queueStick(this.joystick.vecX, this.joystick.vecY);
    else this.flushStick();
    this.pingIfIdle(minigame);
    this.forecast(f);
    const viewAt = this.viewAt;
    const elapsed = Math.max(0, viewAt - (minigame?.startedAt || viewAt));

    // Farbe des Wassers nach der Tiefe der Kamera.
    const ownView = this.views.get(controlledId);
    const camDepth = clamp((ownView?.y || 0) / this.depth, 0, 1);
    _c.copy(SURFACE_COLOR).lerp(DEEP_COLOR, camDepth);
    if (this.scene.background?.isColor) this.scene.background.copy(_c);
    if (this.scene.fog) this.scene.fog.color.copy(_c);
    this.rays.forEach((ray, i) => {
      ray.material.opacity = 0.07 + Math.sin(now / 900 + i * 1.7) * 0.03;
    });
    this.weeds?.forEach((weed) => { weed.rotation.z = Math.sin(now / 700 + weed.userData.phase) * 0.18; });
    this.surface.position.y = 0.02 + Math.sin(now / 500) * 0.02;

    // Münzen: drehen und wippen. Eine geholte bleibt als blasser Schemen
    // stehen und wächst wieder heran — so sieht man, wann sie zurückkommt,
    // statt an eine leere Stelle zu schwimmen.
    (arcade.coins || []).forEach((coin) => {
      const mesh = this.coinMeshes.get(coin.id);
      if (!mesh) return;
      const serverGone = Boolean(coin.takenUntil && viewAt < coin.takenUntil);
      const gone = serverGone || this.pickedAhead?.has(coin.id);
      const wait = coin.chest ? (arcade.chestRespawnMs || 9000) : (arcade.respawnMs || 6500);
      const back = serverGone ? clamp(1 - (coin.takenUntil - viewAt) / wait, 0, 1) : 0;
      this.ghostCoin(mesh, gone ? back : null);
      mesh.position.y = mesh.userData.base + (gone ? 0 : Math.sin(now / 400 + coin.id) * 0.05);
      if (coin.chest) mesh.rotation.y = Math.sin(now / 800) * 0.3;
      else if (!gone) mesh.rotation.z = now / 300 + coin.id;
    });

    // Quallen: dieselbe Bahn wie auf dem Server, zur selben Zeit wie die Figur.
    (arcade.jellies || []).forEach((jelly, i) => {
      const mesh = this.jellyMeshes[i];
      if (!mesh) return;
      const at = jellyAt(jelly, this.width, elapsed);
      mesh.position.set(this.wx(at.x), this.wy(at.y), 0.1);
      const pulse = Math.sin(now / 260 + i);
      mesh.userData.dome.scale.set(1 + pulse * 0.08, 1 - pulse * 0.1, 1 + pulse * 0.08);
      mesh.userData.tentacles.forEach((t, k) => { t.rotation.z = Math.sin(now / 200 + k + i) * 0.35; });
    });

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const view = this.views.get(player.id) || entry;
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const tx = this.wx(view.x);
      const ty = this.wy(view.y) - 0.3;
      // Die eigene Figur folgt der Vorausrechnung fast ohne Verzug — sie IST
      // schon die Antwort auf den Stick. Die anderen dürfen weicher gleiten.
      const follow = frameLerp(isOwn ? 0.6 : 0.35, dt);
      kin.position.x += (tx - kin.position.x) * follow;
      kin.position.z = 0.15;
      animator.groundY = kin.position.y + (ty - kin.position.y) * follow;

      // Kopf voran in Schwimmrichtung; ohne Tempo aufrecht.
      const speed = Math.hypot(view.vx || 0, view.vy || 0);
      let wantZ = 0;
      if (view.fainted) wantZ = Math.PI * 0.5;
      else if (speed > 1.2) wantZ = -Math.atan2(view.vx || 0, -(view.vy || 0));
      const diff = Math.atan2(Math.sin(wantZ - kin.rotation.z), Math.cos(wantZ - kin.rotation.z));
      if (!finale) kin.rotation.z += diff * frameLerp(0.15, dt);
      if (!finale) {
        if (view.fainted) {
          animator.set("float");
          animator.expression("ko", 150);
        } else if (speed > 1.2) {
          animator.set("swim");
          animator.rate = 0.7 + speed / 7;
        } else {
          animator.set("float");
        }
        if (!view.fainted && view.y > 1.5 && view.o2 < airToSurface(arcade, view.y) * 1.25 + 4) animator.expression("scared", 150);
      }
      // Unverwundbar nach einem Stich: kurz blinken.
      kin.visible = !(viewAt < (view.safeUntil || 0) && !view.fainted && Math.floor(now / 110) % 2 === 0);
      // Luftblasen, mehr wenn man hektisch ist.
      if (!finale && view.y > 1.3 && Math.random() < eventChance(speed > 1.2 ? 2.2 : 0.9, dt)) {
        this.burst(new THREE.Vector3(kin.position.x, kin.position.y + 0.55, 0.3), ["#dff6ff", "#ffffff"], { count: 1, speed: 0.2, up: 1.2, size: 0.05, life: 0.9, gravity: -1.2, drag: 1.0 });
      }
      if (isOwn && !finale) (view.events || []).forEach((event) => this.showOwn(event, player, kin, animator));
      this.react(player, entry, kin, animator, isOwn);
    });
    this.checkLapsed();
  }

  // Blass und klein, solange die Münze fehlt; `back` 0…1 ist, wie weit sie
  // schon wieder da ist. null = ganz da.
  ghostCoin(mesh, back) {
    const ghost = back !== null;
    const scale = mesh.userData.scale ?? (mesh.userData.scale = mesh.scale.x);
    mesh.scale.setScalar(ghost ? scale * (0.35 + back * 0.35) : scale);
    if (!ghost && !mesh.userData.ghost) return;
    mesh.userData.ghost = ghost;
    mesh.traverse((part) => {
      const material = part.material;
      if (!material) return;
      const base = material.userData.base ?? (material.userData.base = { transparent: material.transparent, opacity: material.opacity });
      const transparent = ghost || base.transparent;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = ghost ? Math.min(base.opacity, 0.16 + back * 0.2) : base.opacity;
    });
  }

  // Ein Ereignis der eigenen Figur, sobald die Vorausrechnung es hat — also in
  // dem Moment, in dem man die Münze berührt, nicht eine Rundreise später.
  showOwn(event, player, kin, animator) {
    const window = event.kind === "pick" ? 1500 : 450;
    if (this.shown.some((done) => done.kind === event.kind && (event.kind !== "pick" || done.id === event.id) && Math.abs(done.at - event.at) <= window)) return;
    this.shown.push({ ...event, clock: performance.now(), confirmed: false });
    if (this.shown.length > 24) this.shown.splice(0, this.shown.length - 24);
    this.showEvent(event, player, kin, animator, true);
  }

  // Die Serverantwort zu einem eigenen Ereignis, das schon gezeigt wurde?
  confirmOwn(event) {
    const window = event.kind === "pick" ? 1500 : 600;
    const done = this.shown.find((candidate) => candidate.kind === event.kind && (event.kind !== "pick" || candidate.id === event.id) && Math.abs(candidate.at - event.at) <= window);
    if (!done) return false;
    done.confirmed = true;
    return true;
  }

  // Eine Münze, die das Gerät schon gezählt hat, die der Server aber jemand
  // anderem gab: das wird gesagt, statt dass der Betrag stumm verschwindet.
  checkLapsed() {
    const clock = performance.now();
    this.shown.forEach((done) => {
      if (done.kind !== "pick" || done.confirmed || done.lapsed) return;
      if (clock - done.clock < this.roundTrip + PICK_GRACE_MS) return;
      done.lapsed = true;
      const mesh = this.coinMeshes.get(done.id);
      if (mesh) this.pop(mesh.position.clone().add(new THREE.Vector3(0, 0.4, 0)), "weg!", { color: "#c9d6df", size: 0.26, life: 0.8 });
    });
  }

  showEvent(event, player, kin, animator, isOwn) {
    const at = () => kin.position.clone().add(new THREE.Vector3(0, 0.9, 0.3));
    if (event.kind === "pick") {
      if (!isOwn) return;
      const mesh = this.coinMeshes.get(event.id);
      const p = mesh ? mesh.position.clone() : at();
      this.burst(p, ["#ffe36b", "#ffffff"], { count: Math.round((event.chest ? 30 : 10) * fxScale()), speed: 1.6, up: 1.2, size: 0.06, life: 0.5, gravity: 0 });
      this.pop(p.add(new THREE.Vector3(0, 0.4, 0)), event.chest ? `TRUHE! +${event.value}` : `+${event.value}`, { color: "#ffe36b", size: event.chest ? 0.42 : 0.28, life: 0.7 });
      this.feedback?.sound(event.chest ? "win" : "coin");
      this.feedback?.vibrate(event.chest ? [12, 20, 12] : 6);
    } else if (event.kind === "sting") {
      animator.trigger("flinch");
      animator.expression("surprised", 800);
      this.burst(at(), ["#ff8fd0", "#ffffff"], { count: 14, speed: 2.0, up: 0.6, size: 0.06, life: 0.5, gravity: 0 });
      const text = event.gold > 0 ? `AUA! −${event.o2} % Luft · −${event.gold} 🪙` : `AUA! −${event.o2} % Luft`;
      this.pop(at(), isOwn ? text : "AUA!", { color: "#ff9ad0", size: isOwn ? 0.3 : 0.24, life: 0.9 });
      if (isOwn) {
        this.rig.shake(0.6);
        this.feedback?.sound("error");
        this.feedback?.vibrate([30, 30, 30]);
      }
    } else if (event.kind === "bank") {
      animator.trigger("celebrate");
      animator.expression("joy", 900);
      const p = this.bank.position.clone().add(new THREE.Vector3(0, 0.5, 0.4));
      this.burst(p, ["#ffe36b", player.color, "#ffffff"], { count: Math.round(18 * fxScale()), speed: 1.8, up: 2.2, size: 0.07, life: 0.7 });
      if (isOwn) {
        this.pop(p.add(new THREE.Vector3(0, 0.3, 0)), `+${event.gold} 🪙 sicher!`, { color: "#ffe36b", size: 0.38, life: 1.0 });
        this.feedback?.sound("perfect");
        this.feedback?.vibrate([10, 14, 18]);
      }
    } else if (event.kind === "faint") {
      animator.trigger("hit");
      this.pop(at(), isOwn ? `OHNMÄCHTIG! −${event.gold || 0} 🪙` : "OHNMÄCHTIG!", { color: "#ff9aa8", size: isOwn ? 0.34 : 0.24, life: 1.1 });
      if (isOwn) {
        this.rig.shake(0.8);
        this.feedback?.sound("fall");
        this.feedback?.vibrate([40, 40, 60]);
      }
    }
  }

  // Was der Server meldet. Für die eigene Figur meist schon gezeigt — dann nur
  // abhaken; die anderen sieht man, wie der Server sie meldet.
  react(player, entry, kin, animator, isOwn) {
    const seen = this.seen.get(player.id) || {};
    const events = [];
    // Münzen zeigt ohnehin nur die eigene Figur; abgehakt wird jede aus der
    // Liste der letzten Funde, nicht nur die jüngste.
    if (isOwn) {
      (entry.recentPicks || (entry.lastPick ? [entry.lastPick] : [])).forEach((pick) => {
        if (pick.at <= (seen.pick || 0)) return;
        seen.pick = pick.at;
        events.push({ kind: "pick", ...pick });
      });
    }
    if (entry.lastSting && entry.lastSting.at !== seen.sting) {
      seen.sting = entry.lastSting.at;
      events.push({ kind: "sting", ...entry.lastSting });
    }
    if (entry.lastBank && entry.lastBank.at !== seen.bank) {
      seen.bank = entry.lastBank.at;
      events.push({ kind: "bank", ...entry.lastBank });
    }
    if (entry.lastFaintAt && entry.lastFaintAt !== seen.faint) {
      seen.faint = entry.lastFaintAt;
      events.push({ kind: "faint", gold: entry.lastFaint?.gold || 0, at: entry.lastFaintAt });
    }
    this.seen.set(player.id, seen);
    events.forEach((event) => {
      if (isOwn && this.confirmOwn(event)) return;
      if (isOwn) this.shown.push({ ...event, clock: performance.now(), confirmed: true });
      this.showEvent(event, player, kin, animator, isOwn);
    });
  }

  drawHud(f) {
    const { arcade, state, minigame } = f;
    if (!arcade?.coins) return;
    const entry = arcade.players[f.controlledId];
    const own = this.views.get(f.controlledId) || entry;
    // Eingezahlt ist, was der Server hat, plus was die Vorausrechnung gerade
    // an der Oberfläche abliefert — sonst stünde der Jubel eine Rundreise vor
    // der Zahl.
    const banked = (id) => (arcade.players[id]?.banked || 0)
      + (this.views.get(id)?.events || []).reduce((sum, event) => sum + (event.kind === "bank" ? event.gold : 0), 0);
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(entry ? banked(f.controlledId) : 0);
    const surface = arcade.surfaceY ?? 1.2;
    const y = own?.y || 0;
    const o2 = clamp(own?.o2 ?? 100, 0, 100);
    // Die Marke: so viel Luft kostet der direkte Weg nach oben. Liegt die
    // Füllung links davon, reicht es nicht mehr.
    const need = y > surface ? airToSurface(arcade, y) : 0;
    const fill = this.hud.querySelector("[data-dive-air-fill]");
    const air = this.hud.querySelector("[data-dive-air]");
    const mark = this.hud.querySelector("[data-dive-air-mark]");
    if (fill && own) {
      fill.style.width = `${o2}%`;
      const level = y <= surface ? (o2 < 60 ? "mid" : "ok")
        : o2 < need * 1.25 + 4 ? "low" : o2 < need * 1.7 + 12 ? "mid" : "ok";
      if (air.dataset.level !== level) air.dataset.level = level;
    }
    if (mark) {
      mark.hidden = !own || need < 0.5;
      if (!mark.hidden) mark.style.left = `${Math.min(100, need)}%`;
    }
    const depth = this.hud.querySelector("[data-dive-depth]");
    if (depth && own) depth.textContent = `${Math.max(0, Math.round(y))} m`;
    const carried = this.hud.querySelector("[data-dive-carried]");
    if (carried && own) carried.textContent = `🪙 ${own.carried || 0} dabei`;

    const chips = this.hud.querySelector("[data-dig-chips]");
    if (chips) {
      const html = state.players.map((player) => {
        const isOwn = player.id === f.controlledId;
        return `<span class="dig-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${banked(player.id)}</span>`;
      }).join("");
      if (chips.innerHTML !== html) chips.innerHTML = html;
    }

    const banner = this.hud.querySelector("[data-dig-banner]");
    if (!banner || !own) return;
    const endAt = (minigame.startedAt || 0) + (minigame.duration || 0);
    const leftMs = endAt - (this.viewAt || f.now);
    const upMs = timeToSurface(arcade, y) * 1000;
    let text = "";
    let bg = "";
    let fg = "#ffffff";
    if (f.finale) {
      text = "";
    } else if (own.fainted) {
      text = "Ohnmächtig — du treibst nach oben";
      bg = "#ff6b7f";
    } else if (y > surface + 0.3 && o2 < need * 1.25 + 4) {
      text = "LUFT KNAPP — AUFTAUCHEN!";
      bg = "#ff4d5e";
    } else if ((own.carried || 0) > 0 && f.started && leftMs < upMs + 2500) {
      text = `Noch ${Math.max(0, Math.ceil(leftMs / 1000))} s — hoch, sonst ist dein Gold weg!`;
      bg = "#ffd15c";
      fg = "#4a3405";
    } else if (y <= surface + 0.1 && o2 < 99 && f.started) {
      text = "Luft holen …";
      bg = "#7fd8ff";
      fg = "#08304a";
    }
    banner.hidden = !text;
    if (text && banner.textContent !== text) banner.textContent = text;
    if (text) {
      banner.style.background = bg;
      banner.style.color = fg;
    }
  }
}
