import * as THREE from "/vendor/three/three.module.js";
import { reachArm, standOn } from "./VoxelKit.js?v=tumblekin214";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin214";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin214";
import { frameLerp, frameChance } from "./Quality.js?v=tumblekin214";
import { kiste, lambert, viele, streuer, berge, himmel } from "./Kulisse.js?v=tumblekin214";
import { forecastSnow, snowRules, canDash, ballRadius } from "./Schneeball.js?v=tumblekin214";

// Schneeballhang — Gipfelschubsen. Ein rundes Plateau aus Eis und Schnee auf
// der Bergspitze, ringsum fällt der Hang steil ab. Jeder rollt eine Kugel
// vor sich her, die beim Rollen wächst; wer damit in jemanden hineinfährt,
// stösst ihn übers Eis. SCHWUNG gibt einen Antritt. Wer über den Rand
// rutscht, saust den Hang hinunter und ist raus. Ab knapp der Hälfte bröckelt
// der Rand.
//
// Drumherum: verschneite Tannen am Hang, Bergpanorama, ein Gipfelkreuz auf
// einem Felsen etwas tiefer, und es schneit.
const BODY_R = 0.3;
const STICK_GAP_MS = 40;         // Stick höchstens so oft schicken
const TICK_LEAD_MS = 45;         // halber Servertakt (90 ms), siehe lands
const LEDGE = 0.45;              // so tief liegt, was vom Rand schon abgebrochen ist
const SLOPE = 0.9;               // Gefälle des Hangs
const GONE_MS = 1700;            // so lange sieht man einen Absturz

export class SnowSummit extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.carried = new Map();      // playerId → Kugel vor der Figur
    this.seenBumps = new Set();
    this.seenFalls = new Set();
    this.localBumps = [];          // { key, x, z, clock } — schon gezeigter Staub
    this.labelY = 0.8;
    this.flakes = null;
    this.roundTrip = 0;
    this.stickLog = [];            // { at, x, y }: was das Gerät wann geschickt hat (Geräteuhr)
    this.dashLog = [];             // { at }: eigener Schwung (Geräteuhr)
    this.stickWanted = null;
    this.stickSent = { x: 0, y: 0, clock: 0 };
    this.lastPingAt = 0;
    this.view = null;              // Vorausrechnung zur Ankunftszeit (forecastSnow)
    this.shownRadius = null;
  }

  stage() {
    return {
      label: "3D Schneeballhang",
      background: "#cfe6f7",
      fog: ["#e3f0fa", 22, 70],
      lights: { sunPosition: [-6, 12, 7], sunIntensity: 2.5, hemiIntensity: 2.0, skyColor: 0xe8f2ff, groundColor: 0xa8bcd4, shadow: { left: -6, right: 6, top: 6, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips" data-snow-chips></div>
      <div class="color-banner" data-snow-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const rules = snowRules(this.minigame?.arcade);
    this.r0 = rules.r0;
    himmel(scene, { oben: "#7fb8ea", unten: "#f1f7fd" });
    this.buildSummit(scene);
    const players = this.getState()?.players || [];
    const arcade = this.minigame?.arcade;
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      this.addKin(player, index, { x: entry?.x ?? 0, ground: 0, z: entry?.z ?? 0, facing: entry?.heading ?? 0 });
      const kugel = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshLambertMaterial({ color: "#fbfdff" }));
      kugel.castShadow = true;
      kugel.receiveShadow = true;
      kugel.userData.isFx = true;       // wird geschoben, ist kein Boden
      // Ein farbiger Ring um die eigene Kugel, damit man sie im Getümmel findet.
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.01, 0.06, 6, 24), new THREE.MeshLambertMaterial({ color: player.color }));
      kugel.add(band);
      scene.add(kugel);
      this.carried.set(player.id, { mesh: kugel, band, spin: 0, size: entry?.size ?? 0.2 });
    });
  }

  buildSummit(scene) {
    const r0 = this.r0;
    const zufall = streuer(17);
    // Der Berg: ein Kegelstumpf, oben etwas breiter als das Plateau — dort
    // liegt, was vom Rand schon abgebrochen ist, eine Stufe tiefer.
    const top = r0 + 0.7;
    const hoehe = 16;
    const unten = top + hoehe / SLOPE;
    const berg = new THREE.Mesh(new THREE.CylinderGeometry(top, unten, hoehe, 40), lambert("#e6eef7"));
    berg.position.y = -LEDGE - hoehe / 2;
    berg.receiveShadow = true;
    scene.add(berg);
    this.mountainTop = top;
    // Das Plateau: Eis mit Schneerand. Es wird kleiner, wenn der Rand bröckelt.
    this.plateau = new THREE.Group();
    const eis = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, LEDGE, 56), lambert("#dbe9f6"));
    eis.position.y = -LEDGE / 2;
    eis.receiveShadow = true;
    this.plateau.add(eis);
    const glanz = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), new THREE.MeshLambertMaterial({ color: "#c9e1f5" }));
    glanz.rotation.x = -Math.PI / 2;
    glanz.position.y = 0.004;
    glanz.receiveShadow = true;
    this.plateau.add(glanz);
    this.plateau.scale.set(r0, 1, r0);
    scene.add(this.plateau);
    // Die Kante: ein Warnring, der blinkt, solange der Rand bröckelt.
    this.edge = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 64), new THREE.MeshBasicMaterial({ color: "#ff5d73", transparent: true, opacity: 0, depthWrite: false }));
    this.edge.rotation.x = -Math.PI / 2;
    this.edge.position.y = 0.012;
    this.edge.userData.isFx = true;
    scene.add(this.edge);
    // Verschneite Tannen am Hang, ringsum und tiefer.
    const tannen = [];
    for (let i = 0; i < 46; i += 1) {
      const a = (i / 46) * Math.PI * 2 + zufall() * 0.12;
      const d = top + 2 + zufall() * 9;
      const y = -LEDGE - (d - top) * SLOPE;
      tannen.push([Math.sin(a) * d, y, Math.cos(a) * d, 1.2 + zufall() * 1.4]);
    }
    viele(scene, new THREE.BoxGeometry(0.22, 1, 0.22), lambert("#6b4a2e"), tannen.map(([x, y, z, h]) => ({ p: [x, y + h * 0.2, z], s: [1, h * 0.4, 1] })));
    viele(scene, new THREE.ConeGeometry(0.9, 1.6, 7), lambert("#2f6b4a"), tannen.map(([x, y, z, h]) => ({ p: [x, y + h * 0.75, z], s: h * 0.6, r: [0, x, 0] })), { schatten: true });
    viele(scene, new THREE.ConeGeometry(0.62, 1.1, 7), lambert("#3d7d57"), tannen.map(([x, y, z, h]) => ({ p: [x, y + h * 1.25, z], s: h * 0.6, r: [0, x + 1, 0] })), { schatten: true });
    viele(scene, new THREE.ConeGeometry(0.4, 0.55, 7), lambert("#ffffff"), tannen.map(([x, y, z, h]) => ({ p: [x, y + h * 1.63, z], s: h * 0.6, r: [0, x + 1, 0] })));

    // Bergpanorama und ein Gipfelkreuz auf einem Felsen hinten, etwas tiefer.
    berge(scene, [[-24, -34, 14], [-8, -40, 18], [10, -38, 15], [26, -32, 12], [-36, -24, 10], [36, -26, 11]].map(([x, z, h]) => [x, z, h]), { color: "#8ea6bf", schneeAnteil: 0.42 });
    const kreuz = new THREE.Group();
    const fels = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1, 0), lambert("#8f9aa6"));
    fels.scale.set(1.2, 0.8, 1);
    kreuz.add(fels);
    kiste(kreuz, 0.16, 2.2, 0.16, "#7a5330", [0, 1.4, 0]);
    kiste(kreuz, 1, 0.14, 0.16, "#7a5330", [0, 1.95, 0]);
    this.flag = kiste(kreuz, 0.45, 0.28, 0.02, "#ff3b52", [0.3, 2.35, 0], { schatten: false });
    kreuz.position.set(-3.2, -LEDGE - 1.6, -(top + 1.8));
    scene.add(kreuz);

    // Schneefall: eine Punktwolke, die langsam nach unten driftet.
    const flocken = 520;
    const pos = new Float32Array(flocken * 3);
    for (let i = 0; i < flocken; i += 1) {
      pos[i * 3] = (zufall() - 0.5) * 24;
      pos[i * 3 + 1] = zufall() * 10;
      pos[i * 3 + 2] = (zufall() - 0.5) * 20;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.flakes = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#ffffff", size: 0.07, transparent: true, opacity: 0.85, depthWrite: false }));
    this.flakes.userData.isFx = true;
    scene.add(this.flakes);
  }

  // Bodenhöhe in Abstand `d` von der Mitte: Plateau, abgebrochene Stufe, Hang.
  groundAt(d, radius) {
    if (d <= radius) return 0;
    if (d <= this.mountainTop) return -LEDGE;
    return -LEDGE - (d - this.mountainTop) * SLOPE;
  }

  shot() {
    const r = this.r0 || 4;
    return {
      look: [0, 0, 0.3],
      frame: { w: 2 * r + 1, h: 2 * r * Math.sin(0.9) + 1.4 },
      pitch: 0.9,
      fov: 36,
      fill: 0.96,
      intro: { yaw: 0.5, pitch: 0.35, zoom: 1.4 },
      finale: { pull: 0.85, zoom: 0.6, lift: 0.3, orbit: 0.12 }
    };
  }

  // Abgestürzte sind weg — die Kamera hält nur, wer noch oben steht.
  keepInView(f) {
    const arcade = f?.arcade;
    return [...this.kins.entries()].filter(([id]) => (arcade?.players?.[id]?.outAt ?? null) === null).map(([, kin]) => kin);
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls snow-controls">
        <div class="joystick-slot"></div>
        <button type="button" class="snow-throw" data-snow-dash>
          <span class="snow-meter"><i></i></span>
          <b>SCHWUNG</b>
        </button>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Schneeballhang: rollen",
      intervalMs: 70,
      feedback: this.feedback,
      surface: this.webglCanvas,
      globalKeys: true,
      onVector: (x, y) => this.queueStick(x, y),
      onEngage: () => this.feedback?.vibrate(8)
    });
    this.dashButton = this.controls.querySelector("[data-snow-dash]");
    this.on(this.dashButton, "pointerdown", (event) => {
      event.preventDefault();
      this.dashNow();
    });
    this.on(window, "keydown", (event) => {
      if (event.code !== "Space" || event.repeat || event.target?.closest?.("input,textarea,select,button")) return;
      event.preventDefault();
      this.dashNow();
    });
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
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

  // Schwung: gilt die Vorausrechnung ihn, legt die Figur sofort los — nicht
  // eine Rundreise später.
  dashNow() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || this.dashButton?.disabled) return;
    const own = this.view?.entries.get(this.getControlledPlayerId());
    const clock = performance.now();
    if (own && canDash(own, this.view.at)) {
      this.dashLog.push({ at: this.now() });
      while (this.dashLog.length > 4) this.dashLog.shift();
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(14);
    } else {
      this.feedback?.sound("tap");
    }
    this.sendInput({ action: "dash" }).then(() => this.noteRoundTrip(performance.now() - clock)).catch(() => {});
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

  // Wann eine Meldung dieses Geräts beim Server wirkt: eine Rundreise nach dem
  // Senden, abzüglich eines halben Takts.
  lands(sent) {
    return sent.at + this.roundTrip - TICK_LEAD_MS;
  }

  stickAt(at, from, entry) {
    let pick = null;
    for (const sent of this.stickLog) {
      if (this.lands(sent) <= at) pick = sent;
      else break;
    }
    if (!pick || this.lands(pick) <= from) return { x: entry.dirX || 0, y: entry.dirZ || 0 };
    return pick;
  }

  // Das Plateau zu der Serverzeit, zu der ein jetzt geschickter Stick ankommt.
  forecast(f) {
    const { arcade, minigame, players, controlledId } = f;
    const from = arcade.snowClock || minigame.sentAt || f.now;
    const endAt = (minigame.startedAt || 0) + (minigame.duration || 0);
    const to = minigame.finaleAt ? from : Math.min(Math.max(from, f.now + this.roundTrip), Math.max(from, endAt));
    const present = new Set(players.map((player) => player.id));
    const ids = (arcade.order || players.map((player) => player.id)).filter((id) => present.has(id) && arcade.players[id]);
    this.view = forecastSnow(arcade, {
      from,
      to,
      ids,
      inputAt: (id, at) => {
        const entry = arcade.players[id];
        if (id !== controlledId) return { x: entry.dirX || 0, y: entry.dirZ || 0 };
        const stick = this.stickAt(at, from, entry);
        const dashed = this.dashLog.some((sent) => {
          const lands = this.lands(sent);
          return lands > from && lands > at - 30 && lands <= at;
        });
        return { x: stick.x, y: stick.y, dash: dashed };
      }
    });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.snow;
    if (!state) return;
    if (this.joystick && this.joystick.pointerId !== null) this.queueStick(this.joystick.vecX, this.joystick.vecY);
    else this.flushStick();
    this.pingIfIdle(minigame);
    this.forecast(f);
    const view = this.view;
    const rules = snowRules(arcade);

    // Das Plateau schrumpft mit dem Rand; bröckelt er, blinkt die Kante und
    // es fallen Brocken.
    const radius = minigame.finaleAt ? (state.radius ?? this.r0) : view.radius;
    const before = this.shownRadius ?? radius;
    this.shownRadius = radius;
    this.plateau.scale.set(radius, 1, radius);
    this.edge.scale.setScalar(radius);
    const crumbling = radius < this.r0 - 1e-3 && !minigame.finaleAt;
    this.edge.material.opacity = crumbling ? 0.35 + 0.35 * Math.sin(now / 140) : 0;
    if (before - radius > 0 && Math.random() < frameChance(2.5, dt)) {
      const a = Math.random() * Math.PI * 2;
      this.burst(new THREE.Vector3(Math.sin(a) * radius, 0.05, Math.cos(a) * radius), ["#ffffff", "#dbe9f6", "#bcd2e8"], { count: 4, speed: 0.8, up: 0.6, size: 0.1, life: 0.7, gravity: 6 });
    }

    // Schnee fällt, Fahne weht.
    if (this.flakes) {
      const p = this.flakes.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 1) {
        let y = p.getY(i) - dt * (0.6 + (i % 5) * 0.08);
        if (y < 0) y += 10;
        p.setY(i, y);
        p.setX(i, p.getX(i) + Math.sin(now / 900 + i) * dt * 0.15);
      }
      p.needsUpdate = true;
    }
    if (this.flag) this.flag.rotation.y = Math.sin(now / 260) * 0.35;

    players.forEach((player) => {
      const entry = view.entries.get(player.id) || arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const ball = this.carried.get(player.id);
      if (!entry || !kin || !animator || !ball) return;
      const isOwn = player.id === controlledId;
      const out = entry.outAt !== null && entry.outAt !== undefined;
      // Die eigene Figur folgt der Vorausrechnung fast ohne Verzug — sie IST
      // schon die Antwort auf den Stick.
      const follow = out ? 0.9 : isOwn ? 0.7 : 0.45;
      const px = kin.position.x;
      const pz = kin.position.z;
      kin.position.x += (entry.x - kin.position.x) * frameLerp(follow, dt);
      kin.position.z += (entry.z - kin.position.z) * frameLerp(follow, dt);
      const moved = Math.hypot(kin.position.x - px, kin.position.z - pz);
      const turn = entry.heading - kin.rotation.y;
      kin.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * frameLerp(isOwn ? 0.5 : 0.3, dt);
      const d = Math.hypot(kin.position.x, kin.position.z);
      const ground = out ? this.groundAt(d, radius) : 0;
      animator.groundY = standOn(ground);
      // Abgestürzt: rutscht den Hang hinunter, kugelt sich und ist dann weg.
      const sinceFall = out ? view.at - (entry.fellAt || view.at) : 0;
      kin.visible = !out || sinceFall < GONE_MS;
      kin.userData.sunk = out;
      kin.userData.outOfPlay = out;
      if (out) kin.rotation.x = Math.min(1.3, sinceFall / 300);
      else kin.rotation.x = 0;

      // Die Kugel vor der Figur: so gross wie in der Vorausrechnung, rollt mit.
      ball.size += ((entry.size ?? 0.2) - ball.size) * frameLerp(isOwn ? 0.6 : 0.3, dt);
      const r = ballRadius(ball.size);
      const hx = Math.sin(kin.rotation.y);
      const hz = Math.cos(kin.rotation.y);
      ball.mesh.visible = !out;
      ball.mesh.scale.setScalar(r);
      ball.mesh.position.set(kin.position.x + hx * (BODY_R + r), r, kin.position.z + hz * (BODY_R + r));
      ball.spin += moved / Math.max(0.1, r);
      ball.mesh.rotation.set(ball.spin, kin.rotation.y, 0, "YXZ");
      if (isOwn && !out) {
        // Ein Ton, wenn die Kugel richtig gross ist.
        const big = entry.size >= 0.7;
        if (big && !this.wasBig) this.feedback?.sound("sparkle");
        this.wasBig = big;
      }
      // Pulverschnee hinter dem Schwung.
      if (!out && view.at < (entry.dashUntil || 0) && Math.random() < frameChance(8, dt)) {
        this.burst(kin.position.clone().setY(0.1), ["#ffffff", "#e3f0fa"], { count: 2, speed: 0.6, up: 0.6, size: 0.06, life: 0.4, gravity: 2 });
      }

      if (f.finale) return;
      const sliding = view.at < (entry.slideUntil || 0);
      if (out) animator.set("dizzy");
      else if (sliding) animator.set("dizzy");
      else if (view.at < (entry.dashUntil || 0)) animator.set("sprint");
      else if (moved > 0.004) animator.set("walk");
      else animator.set("idle");
    });

    // Stösse, wie die Vorausrechnung sie sieht: gleich Staub und Ton.
    const clock = performance.now();
    this.localBumps = this.localBumps.filter((b) => clock - b.clock < 900);
    view.events.forEach((event) => {
      if (event.kind === "bump") {
        const key = `${event.ids.join("+")}:${Math.round(event.at / 90)}`;
        if (this.localBumps.some((b) => b.key === key)) return;
        this.localBumps.push({ key, x: event.x, z: event.z, clock });
        this.bumpFx(event, controlledId);
      }
    });
    // Und die vom Server, die die Vorausrechnung nicht hatte.
    (state.bumps || []).forEach((b) => {
      const key = `${b.at}:${b.x.toFixed(2)}:${b.z.toFixed(2)}`;
      if (this.seenBumps.has(key)) return;
      this.seenBumps.add(key);
      if (this.localBumps.some((l) => Math.hypot(l.x - b.x, l.z - b.z) < 0.9)) return;
      this.bumpFx(b, controlledId);
    });
    if (this.seenBumps.size > 200) this.seenBumps = new Set([...this.seenBumps].slice(-80));
    // Abstürze.
    const falls = [...(state.falls || []), ...view.events.filter((e) => e.kind === "fall")];
    falls.forEach((fall) => {
      if (this.seenFalls.has(fall.id)) return;
      this.seenFalls.add(fall.id);
      const kin = this.kins.get(fall.id);
      const at = new THREE.Vector3(fall.x, 0.2, fall.z);
      this.burst(at, ["#ffffff", "#dbe9f6"], { count: 18, speed: 2, up: 1.6, size: 0.09, life: 0.8 });
      if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "RUNTER!", { color: "#bfe6ff", size: 0.38 });
      if (fall.by) {
        const pusher = this.kins.get(fall.by);
        if (pusher) this.pop(pusher.position.clone().add(new THREE.Vector3(0, 1.25, 0)), "RAUS!", { color: "#ffe36b", size: 0.4 });
        this.animators.get(fall.by)?.trigger("fistpump");
      }
      if (fall.id === controlledId) {
        this.rig.shake(0.6);
        this.feedback?.sound("fall");
        this.feedback?.vibrate([40, 30, 60]);
      } else if (fall.by === controlledId) {
        this.feedback?.sound("perfect");
        this.feedback?.vibrate(16);
      } else {
        this.feedback?.sound("whoosh");
      }
    });
  }

  bumpFx(b, controlledId) {
    const power = b.power || 1;
    this.burst(new THREE.Vector3(b.x, 0.35, b.z), ["#ffffff", "#e3f0fa", "#cfe3f5"], { count: Math.round(8 + power * 4), speed: 1 + power * 0.4, up: 1.2, size: 0.08, life: 0.6 });
    const mine = (b.ids || []).includes(controlledId);
    this.feedback?.sound(power > 3 ? "impact" : "collision");
    if (mine) {
      this.rig.shake(Math.min(0.5, 0.15 + power * 0.08));
      this.feedback?.vibrate(Math.round(10 + power * 6));
    }
  }

  afterAnimate(f) {
    // Hände an die Kugel.
    this.kins.forEach((kin, id) => {
      const ball = this.carried.get(id);
      const animator = this.animators.get(id);
      if (!ball || !ball.mesh.visible || !animator || f.finale || animator.state === "dizzy") return;
      const r = ballRadius(ball.size);
      const c = ball.mesh.position;
      const side = new THREE.Vector3(Math.cos(kin.rotation.y), 0, -Math.sin(kin.rotation.y));
      reachArm(kin, 0, c.clone().addScaledVector(side, -r * 0.65).setY(Math.max(0.25, r * 1.2)), 0.9);
      reachArm(kin, 1, c.clone().addScaledVector(side, r * 0.65).setY(Math.max(0.25, r * 1.2)), 0.9);
    });
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.snow;
    if (!state) return;
    const view = this.view;
    const own = view?.entries.get(controlledId) || arcade.players[controlledId];
    const ownOut = own && own.outAt !== null && own.outAt !== undefined;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const alive = room.players.filter((p) => (arcade.players[p.id]?.outAt ?? null) === null).length;
    const text = ownOut ? "raus" : `${alive} oben`;
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const chips = this.hud.querySelector("[data-snow-chips]");
    if (chips) {
      const html = room.players.map((player) => {
        const entry = view?.entries.get(player.id) || arcade.players[player.id];
        const out = entry && entry.outAt !== null && entry.outAt !== undefined;
        const k = entry?.knockouts || 0;
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}${out ? " is-out" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${out ? "raus" : "oben"}${k ? ` 💥${k}` : ""}</span>`;
      }).join("");
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }
    const banner = this.hud.querySelector("[data-snow-banner]");
    const rules = snowRules(arcade);
    const elapsed = now - minigame.startedAt;
    const shrinkAt = rules.duration * rules.shrinkFrom;
    let message = null;
    let tone = "#12aaff";
    if (ownOut) { message = "Abgestürzt! Schau zu, wer oben bleibt"; tone = "#8a6fb0"; }
    else if (elapsed < 2200) message = "Roll deine Kugel gross — und schubs die anderen runter!";
    else if (elapsed > shrinkAt - 1500 && elapsed < shrinkAt + 2200) { message = "Der Rand bröckelt!"; tone = "#ff5d73"; }
    else if (own && (view?.at ?? now) < (own.slideUntil || 0)) { message = "Rutsch! Gegenlenken!"; tone = "#ff8a2e"; }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
    }
    if (this.dashButton) {
      // Der Knopf zeigt den Schwung, wie er beim Server ankommt.
      const at = view?.at ?? now;
      const ready = Boolean(own && canDash(own, at));
      const left = own ? Math.max(0, (own.dashReadyAt || 0) - at) : 0;
      this.dashButton.classList.toggle("is-ready", ready);
      this.dashButton.querySelector(".snow-meter i").style.width = `${Math.round((1 - Math.min(1, left / rules.dashCooldownMs)) * 100)}%`;
      this.dashButton.disabled = !ready || Boolean(minigame.finaleAt) || ownOut;
      this.dashButton.querySelector("b").textContent = ownOut ? "RAUS" : ready ? "SCHWUNG" : at < (own?.slideUntil || 0) ? "RUTSCHT …" : "LÄDT …";
    }
  }
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
