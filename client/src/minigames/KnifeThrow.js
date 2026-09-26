import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Messerwurf — wie die bekannten Handyspiele: vor dir dreht sich DEIN Stamm,
// jeder Tipp wirft ein Messer von unten hinein. Sind alle Messer drin,
// zerbricht er, und der nächste kommt — mit schon steckenden Messern, Äpfeln
// und einem anderen Drehmuster. Triffst du ein Messer, klirrt es, der Stamm
// ist verloren, und nach einer kurzen Pause geht es mit dem nächsten weiter.
// Die Stämme der anderen drehen sich klein oben auf dem Podest mit.
//
// Die Drehung rechnet der Client mit derselben Formel wie der Server
// (knifeLogAngle dort) aus Muster und Startzeit der Stufe — der Stamm dreht
// sich damit flüssig und genau so, wie der Server es wertet.
const LOG_R = 0.92;
const LOG_Y = 2.55;
const OWN_KIN_Z = 0.55;
const MINI_SCALE = 0.42;
const MINI_Y = 4.55;
const MINI_Z = -2.2;
const PODIUM_Y = 3.65;
const FLIGHT_MS = 110;

function logAngleDeg(spin, ms) {
  if (!spin) return 0;
  const t = ms / 1000;
  let rad;
  if (spin.kind === "wobble") {
    rad = spin.speed * t - (spin.amp / spin.rate) * (Math.cos(spin.rate * t) - 1) * Math.sign(spin.speed || 1);
  } else if (spin.kind === "swing") {
    rad = (spin.speed / spin.rate) * Math.sin(spin.rate * t);
  } else {
    rad = spin.speed * t;
  }
  return (rad * 180) / Math.PI;
}

function buildKnife(color) {
  const knife = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.035), new THREE.MeshLambertMaterial({ color: "#dfe5ee" }));
  blade.position.y = 0.21;
  knife.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 4), blade.material);
  tip.position.y = 0.47;
  tip.rotation.y = Math.PI / 4;
  knife.add(tip);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.07), new THREE.MeshLambertMaterial({ color: "#ffd15c" }));
  knife.add(guard);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.26, 0.07), new THREE.MeshLambertMaterial({ color: color || "#8a5a2c" }));
  handle.position.y = -0.14;
  knife.add(handle);
  return knife;
}

function buildLog() {
  const log = new THREE.Group();
  const bark = new THREE.Mesh(new THREE.CylinderGeometry(LOG_R, LOG_R, 0.5, 28), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
  bark.rotation.x = Math.PI / 2;
  bark.castShadow = true;
  log.add(bark);
  const face = new THREE.Mesh(new THREE.CircleGeometry(LOG_R - 0.06, 28), new THREE.MeshLambertMaterial({ color: "#d7a46a" }));
  face.position.z = 0.253;
  log.add(face);
  [0.25, 0.48, 0.7].forEach((r) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.02, r + 0.02, 28), new THREE.MeshLambertMaterial({ color: "#b98349" }));
    ring.position.z = 0.256;
    log.add(ring);
  });
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), new THREE.MeshLambertMaterial({ color: "#9b6a38" }));
  core.position.z = 0.258;
  log.add(core);
  // Ein Astloch, damit man die Drehung auch ohne Messer sieht.
  const knot = new THREE.Mesh(new THREE.CircleGeometry(0.1, 10), new THREE.MeshLambertMaterial({ color: "#7a4b25" }));
  knot.position.set(0.42, 0.3, 0.258);
  log.add(knot);
  const holder = new THREE.Group();
  log.add(holder);
  log.userData.holder = holder;
  return log;
}

function buildApple() {
  const apple = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshLambertMaterial({ color: "#e8323f" }));
  apple.add(body);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.08, 0.025), new THREE.MeshLambertMaterial({ color: "#6b4424" }));
  stem.position.y = 0.14;
  apple.add(stem);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.05), new THREE.MeshLambertMaterial({ color: "#57c86a" }));
  leaf.position.set(0.05, 0.15, 0);
  apple.add(leaf);
  return apple;
}

export class KnifeThrow extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stations = new Map();
    this.flying = [];
    this.debris = [];
    // Kein wippender Pfeil über der eigenen Figur und das Namensschild unter
    // die Füsse: beide hingen genau in der Flugbahn der Messer, zwischen Hand
    // und Stamm — dort, wo man beim Zielen hinschaut. Die eigene Figur ist
    // ohnehin die einzige grosse im Bild.
    this.labelY = -0.5;
    this.ownMarker = false;
  }

  stage() {
    return { label: "3D Messerwurf", background: "#a8dcf0", fog: ["#b9e3f2", 18, 44] };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-knife-stage>Stamm 1</div>
      <div class="knife-ammo" data-knife-ammo></div>
      <div class="color-banner" data-knife-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 16), new THREE.MeshLambertMaterial({ color: "#7fb06c" }));
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    dressMeadow(scene, { seed: 13, keepOut: { x: 4.2, z: 4.6 }, spread: { x: 17, z: 15 }, grassColor: "#4f9e57", patchColors: ["#5aab5f", "#6dbb6f"], crownColor: "#26663a", crownColor2: "#37804a" });
    [[-6, 6.2, -5, 5], [6, 7, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });
    this.buildCamp(scene);

    // Der Ständer für den eigenen Stamm.
    const wood = new THREE.MeshLambertMaterial({ color: "#6e4522" });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, LOG_Y, 0.3), wood);
    post.position.set(0, LOG_Y / 2, -0.45);
    post.castShadow = true;
    scene.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.8), wood);
    foot.position.set(0, 0.08, -0.45);
    scene.add(foot);

    // Das Podest hinten oben für die Stämme der anderen.
    const podium = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.24, 1.1), new THREE.MeshLambertMaterial({ color: "#b07a3e" }));
    podium.position.set(0, PODIUM_Y, MINI_Z);
    podium.receiveShadow = true;
    scene.add(podium);
    [-2.3, 2.3].forEach((x) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, PODIUM_Y, 0.22), wood);
      leg.position.set(x, PODIUM_Y / 2, MINI_Z);
      scene.add(leg);
    });

    const players = this.getState()?.players || [];
    const own = this.getControlledPlayerId();
    const others = players.filter((player) => player.id !== own);
    players.forEach((player, index) => {
      const isOwn = player.id === own;
      const slot = isOwn ? -1 : others.indexOf(player);
      const x = isOwn ? 0 : (slot - (others.length - 1) / 2) * 1.55;
      const log = buildLog();
      if (isOwn) {
        log.position.set(0, LOG_Y, 0);
      } else {
        log.scale.setScalar(MINI_SCALE);
        log.position.set(x, MINI_Y, MINI_Z);
      }
      scene.add(log);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(LOG_R + 0.04, 0.05, 6, 32), new THREE.MeshLambertMaterial({ color: player.color }));
      log.add(ring);
      const kin = isOwn
        ? this.addKin(player, index, { x: 0, ground: 0, z: OWN_KIN_Z, facing: Math.PI })
        : this.addKin(player, index, { x: x + 0.55, ground: PODIUM_Y + 0.12, z: MINI_Z + 0.2, facing: 0, scale: 0.6 });
      const hand = buildKnife(player.color);
      hand.scale.setScalar(0.9);
      kin.userData.arms?.[1]?.add(hand);
      hand.position.set(0, -0.18, 0.05);
      hand.rotation.x = Math.PI;
      this.stations.set(player.id, {
        log, isOwn, x, kin, hand, stage: -1, stuckKey: "", throwsSeen: 0, breakAt: null, popAt: 0,
        center: log.position.clone(), scale: isOwn ? 1 : MINI_SCALE
      });
    });
  }

  // Ein Holzfällerlager: Sägemehlplatz um den Ständer, Hackklotz mit Axt,
  // Brennholzstapel, Baumstümpfe, ein Sägebock, hinten eine Blockhütte mit
  // rauchendem Schornstein und ein Stapel gefällter Stämme.
  buildCamp(scene) {
    const zufall = streuer(71);
    const holz = lambert("#8a5a32");
    const schnitt = lambert("#e2c08a");
    const platz = new THREE.Mesh(new THREE.CircleGeometry(2.3, 28), lambert("#d9bb88"));
    platz.rotation.x = -Math.PI / 2;
    platz.position.set(0, 0.012, 0.4);
    platz.receiveShadow = true;
    scene.add(platz);
    const spaene = [];
    for (let i = 0; i < 60; i += 1) {
      const a = zufall() * Math.PI * 2;
      const r = 0.4 + zufall() * 2.6;
      spaene.push({ p: [Math.cos(a) * r, 0.03, 0.6 + Math.sin(a) * r * 0.9], r: [0, zufall() * 3, 0], s: [0.12 + zufall() * 0.1, 0.03, 0.05] });
    }
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#c99a5c"), spaene);

    // Hackklotz mit Axt, rechts vor der Figur.
    const klotz = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.5, 12), holz);
    klotz.position.set(1.4, 0.25, 1.7);
    klotz.castShadow = true;
    scene.add(klotz);
    const klotzTop = new THREE.Mesh(new THREE.CircleGeometry(0.33, 12), schnitt);
    klotzTop.rotation.x = -Math.PI / 2;
    klotzTop.position.set(1.4, 0.505, 1.7);
    scene.add(klotzTop);
    const axt = new THREE.Group();
    kiste(axt, 0.06, 0.75, 0.06, "#b07a3e", [0, 0.36, 0]);
    kiste(axt, 0.05, 0.16, 0.26, "#8d97a6", [0, 0.02, 0.08]);
    kiste(axt, 0.05, 0.05, 0.1, "#c8413b", [0, 0.7, 0], { schatten: false });
    axt.position.set(1.38, 0.52, 1.66);
    axt.rotation.set(0.5, 0.4, -0.25);
    scene.add(axt);

    // Brennholzstapel links, Stirnseiten zur Kamera.
    const scheite = [];
    [[3, 0], [2, 1], [1, 2]].forEach(([n, reihe]) => {
      for (let i = 0; i < n; i += 1) {
        scheite.push({ p: [-1.5 + (i - (n - 1) / 2) * 0.27, 0.13 + reihe * 0.23, 1.8], r: [Math.PI / 2, 0, zufall() * 3] });
      }
    });
    viele(scene, new THREE.CylinderGeometry(0.13, 0.13, 0.8, 8), holz, scheite, { schatten: true });
    viele(scene, new THREE.CircleGeometry(0.11, 8), schnitt, scheite.map((s) => ({ p: [s.p[0], s.p[1], 2.205] })));

    // Baumstümpfe im Mittelgrund: hier wurde schon gefällt.
    const stuempfe = [[-1.9, -3.4], [2.1, -4.2], [-2.8, -6.3], [1.7, -7.4], [3.4, -6], [-0.9, -8.6]].map(([x, z]) => ({ p: [x, 0.18, z], s: [1, 0.8 + zufall() * 0.6, 1] }));
    viele(scene, new THREE.CylinderGeometry(0.3, 0.38, 0.36, 10), holz, stuempfe, { schatten: true });
    viele(scene, new THREE.CylinderGeometry(0.29, 0.29, 0.02, 10), schnitt, stuempfe.map((s) => ({ p: [s.p[0], 0.18 + 0.18 * s.s[1] + 0.01, s.p[2]] })));

    // Sägebock mit Stamm und Säge, rechts hinter dem Ständer.
    const bock = new THREE.Group();
    [-0.5, 0.5].forEach((x) => {
      [0.35, -0.35].forEach((neigung) => kiste(bock, 0.08, 0.9, 0.08, "#6e4522", [x, 0.4, 0], { material: holz }).rotation.set(neigung, 0, 0));
    });
    const stamm = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.7, 10), holz);
    stamm.rotation.z = Math.PI / 2;
    stamm.position.y = 0.95;
    stamm.castShadow = true;
    bock.add(stamm);
    kiste(bock, 0.7, 0.18, 0.02, "#c9d1dc", [0.1, 1.2, 0.03]);
    kiste(bock, 0.1, 0.22, 0.05, "#c8413b", [0.5, 1.28, 0.03]);
    bock.position.set(1.9, 0, -4);
    bock.rotation.y = -0.3;
    scene.add(bock);

    // Blockhütte hinten links, mit Rauch.
    const huette = new THREE.Group();
    const balken = [];
    for (let i = 0; i < 7; i += 1) balken.push({ p: [0, 0.16 + i * 0.3, 0], r: [0, 0, Math.PI / 2] });
    viele(huette, new THREE.CylinderGeometry(0.16, 0.16, 3.4, 8), lambert("#9a6438"), balken, { schatten: true });
    kiste(huette, 3.1, 2.1, 1.9, "#7a4b28", [0, 1.05, -1]);
    [-1, 1].forEach((seite) => {
      kiste(huette, 3.6, 0.12, 1.45, "#5a3522", [0, 2.45, -1 + seite * 0.55]).rotation.x = seite * 0.62;
    });
    kiste(huette, 0.7, 0.8, 0.05, "#3f2a1a", [0.6, 0.55, 0.18]);
    kiste(huette, 0.6, 0.5, 0.05, "#ffd37a", [-0.8, 1.2, 0.18], { schatten: false });
    kiste(huette, 0.4, 1.4, 0.4, "#8a8a8a", [-1, 3, -1.3]);
    huette.position.set(-3.1, 0, -10.5);
    huette.rotation.y = 0.25;
    scene.add(huette);
    this.campSmoke = [];
    for (let i = 0; i < 4; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshLambertMaterial({ color: "#e6e6e6", transparent: true, opacity: 0.7, depthWrite: false }));
      puff.userData.isFx = true;
      scene.add(puff);
      this.campSmoke.push(puff);
    }
    huette.updateMatrixWorld();
    this.campSmokeBase = new THREE.Vector3(-1, 3.8, -1.3).applyMatrix4(huette.matrixWorld);

    // Gefällte Stämme hinten rechts.
    const langholz = [[0.3, 0], [0.3, 0.62], [0.3, 1.24], [0.83, 0.31], [0.83, 0.93]].map(([y, z]) => ({ p: [0, y, z], r: [0, 0, Math.PI / 2] }));
    const stapel = new THREE.Group();
    viele(stapel, new THREE.CylinderGeometry(0.3, 0.3, 3.2, 10), holz, langholz, { schatten: true });
    viele(stapel, new THREE.CircleGeometry(0.27, 10), schnitt, langholz.map((l) => ({ p: [1.61, l.p[1], l.p[2]], r: [0, Math.PI / 2, 0] })));
    stapel.position.set(2.2, 0, -9.5);
    stapel.rotation.y = -0.5;
    scene.add(stapel);
  }

  shot() {
    return {
      // Etwas tiefer geschaut, damit Stamm und Werfer höher im Bild stehen:
      // vorher klebte die Figur fast am Wurfknopf, und unter ihr lag nur Gras.
      look: [0, 1.95, 0],
      frame: { w: 3.5, h: 5.6 },
      pitch: 0.06,
      fov: 38,
      intro: { yaw: 0.4, pitch: 0.2, zoom: 1.4 },
      finale: false
    };
  }

  keepInView() {
    return [...this.kins.values()];
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-knife-throw>
        <span class="nerve-button-face">WERFEN</span>
      </button>`;
    this.throwButton = this.controls.querySelector("[data-knife-throw]");
    const press = (event) => {
      event.preventDefault();
      this.pressThrow();
    };
    this.on(this.throwButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  pressThrow() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    const now = this.now();
    if (!own || now < (own.stunUntil || 0) || own.nextStageAt || own.knivesLeft <= 0) return;
    if (now - (this.lastLocalThrow || 0) < 160) return;
    this.lastLocalThrow = now;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(8);
    this.animators.get(this.getControlledPlayerId())?.trigger("throw");
    this.sendInput({ action: "throw" }).catch(() => {});
  }

  // Ein Messer steckt im Stamm: radial, die Spitze zur Mitte.
  placeKnife(knife, angleDeg) {
    const rad = THREE.MathUtils.degToRad(angleDeg);
    const r = LOG_R + 0.12;
    knife.position.set(Math.cos(rad) * r, Math.sin(rad) * r, 0.05);
    knife.rotation.set(0, 0, rad + Math.PI / 2);
  }

  syncStuck(st, entry, player) {
    const key = `${entry.stage}:${(entry.stuckAngles || []).length}:${(entry.apples || []).filter((a) => a.hit).length}`;
    if (key === st.stuckKey) return;
    const fresh = entry.stage !== st.stage;
    st.stuckKey = key;
    st.stage = entry.stage;
    const holder = st.log.userData.holder;
    holder.clear();
    (entry.stuckAngles || []).forEach((knife) => {
      const mesh = buildKnife(knife.preset ? "#5b6472" : player.color);
      this.placeKnife(mesh, knife.angle);
      holder.add(mesh);
    });
    (entry.apples || []).forEach((apple) => {
      if (apple.hit) return;
      const mesh = buildApple();
      const rad = THREE.MathUtils.degToRad(apple.angle);
      mesh.position.set(Math.cos(rad) * (LOG_R + 0.13), Math.sin(rad) * (LOG_R + 0.13), 0.05);
      holder.add(mesh);
    });
    if (fresh) st.popAt = this.now();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    this.campSmoke?.forEach((puff, i) => {
      const t = ((now / 2600 + i / this.campSmoke.length) % 1);
      puff.position.set(this.campSmokeBase.x + Math.sin(t * 5 + i) * 0.25 + t * 0.6, this.campSmokeBase.y + t * 2.4, this.campSmokeBase.z);
      puff.scale.setScalar(0.6 + t * 1.3);
      puff.material.opacity = 0.7 * (1 - t);
    });
    if (!arcade) return;

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const st = this.stations.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !st || !animator) return;
      const mine = player.id === controlledId;

      // Neuer Stamm: kurz aufploppen.
      this.syncStuck(st, entry, player);
      const pop = Math.min(1, (now - st.popAt) / 260);
      const breaking = entry.nextStageAt && now < entry.nextStageAt;
      const cleared = breaking && entry.lastThrow?.result === "cleared";
      let scale = st.scale * (pop < 1 ? 0.4 + 0.6 * (1 - Math.pow(1 - pop, 3)) : 1);
      if (cleared) scale *= Math.max(0.01, 1 - (now - entry.lastThrow.at) / 300);
      st.log.scale.setScalar(scale);
      st.log.visible = scale > 0.02;

      // Drehen nach dem Muster der Stufe.
      const deg = logAngleDeg(entry.spin, now - (entry.stageStartedAt || now));
      const clash = entry.lastThrow?.result === "clash" && now - entry.lastThrow.at < 450;
      st.log.rotation.z = THREE.MathUtils.degToRad(deg) + (clash ? Math.sin(now / 25) * 0.05 : 0);
      st.log.position.x = st.center.x + (clash ? Math.sin(now / 21) * 0.05 * st.scale : 0);

      // Ein neuer Wurf: das Messer fliegt aus der Hand nach oben.
      if ((entry.throws || 0) > st.throwsSeen) {
        st.throwsSeen = entry.throws;
        if (!mine) animator.trigger("throw");
        const from = st.hand.getWorldPosition(new THREE.Vector3());
        const to = st.center.clone().add(new THREE.Vector3(0, -(LOG_R + 0.12) * st.scale, 0.05));
        const knife = buildKnife(player.color);
        knife.scale.setScalar(st.scale);
        this.scene.add(knife);
        this.flying.push({ knife, from, to, start: now, result: entry.lastThrow?.result, scale: st.scale });
        const result = entry.lastThrow?.result;
        if (result === "clash") {
          // Mit dem Stamm fallen auch seine Punkte — das soll man sehen.
          const lost = entry.lastThrow?.lost || 0;
          this.pop(to.clone().add(new THREE.Vector3(0, -0.3 * st.scale, 0.4)), lost > 0 ? `KLIRR! −${lost}` : "KLIRR!", { color: "#ff6b7f", size: 0.38 * Math.max(0.6, st.scale), life: 1.1 });
          animator.trigger("flinch");
          animator.expression("scared", 900);
          if (mine) {
            this.rig.shake(0.6);
            this.feedback?.sound("error");
            this.feedback?.vibrate([22, 18, 30]);
          }
        } else if (result === "apple") {
          this.burst(to.clone(), ["#e8323f", "#fff4e0", "#57c86a"], { count: 12 * st.scale + 4, speed: 2 * st.scale + 0.5, up: 1.6, size: 0.08 * st.scale + 0.02, life: 0.6 });
          if (mine) {
            this.pop(to.clone().add(new THREE.Vector3(0.4, 0.2, 0.4)), "+3 🍎", { color: "#ffe36b", size: 0.36, life: 0.8 });
            this.feedback?.sound("coin");
          }
        } else if (result === "cleared") {
          if (mine) {
            this.feedback?.sound("perfect");
            this.feedback?.vibrate([12, 20, 24]);
            this.pop(st.center.clone().add(new THREE.Vector3(0, 0.2, 0.6)), "GESCHAFFT! +5", { color: "#7fe0a8", size: 0.46, life: 1.1 });
          }
          animator.trigger("fistpump");
          // Der Stamm zerbricht in Holzstücke.
          for (let i = 0; i < 10; i += 1) {
            const chunk = new THREE.Mesh(new THREE.BoxGeometry(0.22 * st.scale, 0.22 * st.scale, 0.2 * st.scale), new THREE.MeshLambertMaterial({ color: i % 2 ? "#d7a46a" : "#8a5a2c" }));
            chunk.position.copy(st.center);
            this.scene.add(chunk);
            const a = (i / 10) * Math.PI * 2;
            this.debris.push({ mesh: chunk, vx: Math.cos(a) * 2.4 * st.scale, vy: Math.sin(a) * 2.4 * st.scale + 1.4, vz: 0.6, life: 0.9 });
          }
        } else if (mine) {
          this.feedback?.sound("pop");
        }
      }

      if (finale) return;
      const kin = st.kin;
      kin.rotation.y = st.isOwn ? Math.PI : 0;
      const stunned = now < (entry.stunUntil || 0);
      st.hand.visible = !stunned && !breaking && entry.knivesLeft > 0;
      animator.lookAt(st.center);
      if (stunned) animator.set("dizzy");
      else animator.set("ready");
    });

    // Fliegende Messer: kurz nach oben, dann stecken oder abprallen.
    this.flying = this.flying.filter((fly) => {
      const u = (now - fly.start) / FLIGHT_MS;
      if (fly.result === "clash" && u >= 1) {
        const v = (now - fly.start - FLIGHT_MS) / 1000;
        fly.knife.position.set(fly.to.x + v * 1.6 * fly.scale, fly.to.y + v * 2.2 * fly.scale - 9 * v * v * fly.scale, fly.to.z + 0.3);
        fly.knife.rotation.z += dt * 16;
        if (v > 0.8) {
          this.scene.remove(fly.knife);
          return false;
        }
        return true;
      }
      if (u >= 1) {
        this.scene.remove(fly.knife);
        return false;
      }
      fly.knife.position.lerpVectors(fly.from, fly.to, u);
      fly.knife.rotation.set(0, 0, 0);
      return true;
    });
    this.debris = this.debris.filter((piece) => {
      piece.life -= dt;
      piece.vy -= 9 * dt;
      piece.mesh.position.x += piece.vx * dt;
      piece.mesh.position.y += piece.vy * dt;
      piece.mesh.position.z += piece.vz * dt;
      piece.mesh.rotation.x += dt * 8;
      piece.mesh.rotation.z += dt * 6;
      if (piece.life <= 0) {
        this.scene.remove(piece.mesh);
        return false;
      }
      return true;
    });
  }

  drawHud(f) {
    const { arcade, controlledId, now } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.points || 0);
    const stage = this.hud.querySelector("[data-knife-stage]");
    if (stage && own) stage.textContent = `Stamm ${own.stage + 1} · ${own.cleared || 0} geschafft`;
    const ammo = this.hud.querySelector("[data-knife-ammo]");
    if (ammo && own) {
      const key = `${own.stage}:${own.knivesLeft}:${own.knivesTotal}`;
      if (key !== this.ammoKey) {
        this.ammoKey = key;
        ammo.innerHTML = Array.from({ length: own.knivesTotal || 0 }, (_, i) =>
          `<i class="${i < own.knivesLeft ? "" : "used"}"></i>`).join("");
      }
    }
    const banner = this.hud.querySelector("[data-knife-banner]");
    if (banner) {
      const stunned = own && now < (own.stunUntil || 0);
      banner.hidden = !stunned;
      if (stunned) {
        banner.textContent = "Klirr! Nächster Stamm …";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      }
    }
    if (this.throwButton) this.throwButton.disabled = !own || now < (own.stunUntil || 0) || Boolean(own.nextStageAt);
  }
}
