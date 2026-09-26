import * as THREE from "/vendor/three/three.module.js";
import { KIN_SOLE } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Bücherwurm — alle stehen auf der aufgeschlagenen Seite eines Riesenbuchs,
// das auf einem Schreibtisch liegt. Hinten richtet sich die nächste Seite
// auf und klappt nach vorn; in ihr sind Löcher ausgeschnitten. Wer beim
// Aufschlagen unter keinem Loch steht, wird platt wie ein Lesezeichen.
//
// Während die Seite heranklappt, liegt ihr Schatten auf dem Buch — mit
// hellen Aussparungen genau dort, wo die Löcher landen werden.
//
// Der Schreibtisch drumherum: Stifte, Radiergummi, Kaffeetasse mit Dampf,
// Brille, Tintenfass mit Feder, Globus, Schreibtischlampe, dahinter ein
// Bücherregal und ein Fenster mit Mond.
const PAGE_Y = 0.02;
const RETURN_MS = 520;
const HOLD_MS = 650;

export class BookSquirm extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lastServerAt = performance.now();
    this.pages = new Map();         // Seitennummer → { pivot, shadow }
    this.flat = new Map();
    this.seenSlam = -1;
    this.labelY = 0.78;
    this.steam = [];
  }

  stage() {
    return {
      label: "3D Bücherwurm",
      background: "#2a2240",
      fog: ["#2a2240", 18, 42],
      lights: { sunPosition: [-5, 11, 5], sunColor: 0xffe2b0, sunIntensity: 2.9, hemiIntensity: 1.7, skyColor: 0xfff0d8, groundColor: 0x5a3a28, shadow: { left: -5, right: 5, top: 6, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips" data-book-chips></div>
      <div class="color-banner" data-book-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const state = this.minigame?.arcade?.book;
    this.W = state?.w ?? 6;
    this.D = state?.d ?? 7.6;
    this.buildDesk(scene);
    this.buildBook(scene);
    const players = this.getState()?.players || [];
    const arcade = this.minigame?.arcade;
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      this.addKin(player, index, { x: entry?.x ?? 0, ground: PAGE_Y, z: entry?.z ?? 0, facing: 0 });
    });
    this.pageTexture = seitenTextur(0);
  }

  buildDesk(scene) {
    // Schreibtischplatte mit Maserung.
    const platte = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 26), new THREE.MeshLambertMaterial({ map: holzTextur() }));
    platte.position.set(0, -0.36, -2);
    platte.receiveShadow = true;
    scene.add(platte);
    // Rückwand mit Bücherregal und Fenster.
    kiste(scene, 30, 14, 0.4, "#4a3350", [0, 6.5, -13], { schatten: false });
    const zufall = streuer(29);
    const farben = ["#c8413b", "#2f6fb0", "#3f8f45", "#e0a82e", "#7a4ddb", "#d9774a", "#2a8f8f"];
    const buecher = farben.map(() => []);
    for (let reihe = 0; reihe < 4; reihe += 1) {
      let x = -13;
      while (x < -2.5) {
        const w = 0.25 + zufall() * 0.25;
        const h = 1.0 + zufall() * 0.5;
        buecher[Math.floor(zufall() * farben.length)].push({ p: [x + w / 2, 1.5 + reihe * 2.3 + h / 2, -12.4], s: [w, h, 0.8] });
        x += w + 0.03;
      }
    }
    farben.forEach((farbe, i) => viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert(farbe), buecher[i]));
    for (let reihe = 0; reihe < 5; reihe += 1) kiste(scene, 10.8, 0.15, 1, "#6b4a2e", [-7.6, 1.45 + reihe * 2.3, -12.4], { schatten: false });
    // Fenster rechts mit Nachthimmel und Mond.
    const fenster = new THREE.Mesh(new THREE.PlaneGeometry(6, 5), new THREE.MeshBasicMaterial({ color: "#1b2a5a" }));
    fenster.position.set(6.5, 6.5, -12.75);
    scene.add(fenster);
    const mond = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshBasicMaterial({ color: "#fff4c8" }));
    mond.position.set(7.8, 7.6, -12.7);
    scene.add(mond);
    const sterne = [];
    for (let i = 0; i < 26; i += 1) sterne.push({ p: [4 + zufall() * 5, 4.5 + zufall() * 4, -12.7], s: 0.03 + zufall() * 0.05 });
    viele(scene, new THREE.CircleGeometry(1, 5), new THREE.MeshBasicMaterial({ color: "#ffffff" }), sterne);
    [[6.5, 9.05, 6.2, 0.2], [6.5, 3.95, 6.2, 0.2], [3.45, 6.5, 0.2, 5.3], [9.55, 6.5, 0.2, 5.3], [6.5, 6.5, 0.12, 5], [6.5, 6.5, 6, 0.12]].forEach(([x, y, w, h]) => kiste(scene, w, h, 0.15, "#e8dcc8", [x, y, -12.6], { schatten: false }));

    // Riesige Stifte links, schräg.
    [["#ffd15c", -5.2, 0.8, 0.35], ["#ff5d73", -5.8, -1.4, -0.2], ["#28c7d9", 5.4, 2.4, 0.5]].forEach(([farbe, x, z, dreh]) => {
      const stift = new THREE.Group();
      const koerper = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5, 6), lambert(farbe));
      koerper.rotation.z = Math.PI / 2;
      koerper.castShadow = true;
      stift.add(koerper);
      const holz = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 6), lambert("#f1d3a0"));
      holz.rotation.z = -Math.PI / 2;
      holz.position.x = 2.9;
      stift.add(holz);
      const mine = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 6), lambert("#2a2230"));
      mine.rotation.z = -Math.PI / 2;
      mine.position.x = 3.35;
      stift.add(mine);
      const zwinge = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.35, 8), lambert("#c0c8d0"));
      zwinge.rotation.z = Math.PI / 2;
      zwinge.position.x = -2.6;
      stift.add(zwinge);
      const gummi = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.4, 8), lambert("#ff8fb1"));
      gummi.rotation.z = Math.PI / 2;
      gummi.position.x = -2.95;
      stift.add(gummi);
      stift.position.set(x, 0.28, z);
      stift.rotation.y = dreh + Math.PI / 2;
      scene.add(stift);
    });
    // Radiergummi, Büroklammern.
    kiste(scene, 1.4, 0.5, 0.8, "#ff8fb1", [5.2, 0.25, -2.2]).rotation.y = 0.4;
    kiste(scene, 0.7, 0.51, 0.81, "#5aa9ff", [5.5, 0.25, -2.35]).rotation.y = 0.4;
    // Kaffeetasse mit Dampf.
    const tasse = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 1.6, 20), lambert("#ffffff"));
    tasse.position.set(5.3, 0.8, -5.6);
    tasse.castShadow = true;
    scene.add(tasse);
    const kaffee = new THREE.Mesh(new THREE.CircleGeometry(0.82, 20), lambert("#6b3a1e"));
    kaffee.rotation.x = -Math.PI / 2;
    kaffee.position.set(5.3, 1.5, -5.6);
    scene.add(kaffee);
    const henkel = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.12, 8, 16), lambert("#ffffff"));
    henkel.position.set(6.2, 0.85, -5.6);
    scene.add(henkel);
    this.steamBase = new THREE.Vector3(5.3, 1.6, -5.6);
    for (let i = 0; i < 5; i += 1) {
      const dampf = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.4 }));
      dampf.userData.phase = i / 5;
      scene.add(dampf);
      this.steam.push(dampf);
    }
    // Tintenfass mit Feder.
    const fass = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.8, 8), lambert("#1b2a5a"));
    fass.position.set(-5.4, 0.4, -5.2);
    fass.castShadow = true;
    scene.add(fass);
    const feder = kiste(scene, 0.12, 2.6, 0.5, "#ffffff", [-5.2, 1.5, -5.2]);
    feder.rotation.z = -0.35;
    // Globus.
    const globus = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), lambert("#3f8fd0"));
    globus.position.set(-6.5, 2.2, -8.5);
    scene.add(globus);
    viele(scene, new THREE.SphereGeometry(0.4, 6, 5), lambert("#71b35a"), [[-6.2, 2.6, -7.5], [-6.9, 1.9, -7.6], [-6.0, 1.7, -7.8]].map((p) => ({ p, s: [1, 0.6, 0.5] })));
    kiste(scene, 0.12, 1.2, 0.12, "#c89b3c", [-6.5, 0.6, -8.5]);
    kiste(scene, 1.2, 0.12, 1.2, "#c89b3c", [-6.5, 0.06, -8.5]);
    this.globe = globus;
    // Schreibtischlampe hinten rechts.
    const lampe = new THREE.Group();
    kiste(lampe, 1.2, 0.15, 1.2, "#2c2f38", [0, 0.08, 0]);
    const arm1 = kiste(lampe, 0.12, 2.6, 0.12, "#2c2f38", [0.3, 1.3, 0]);
    arm1.rotation.z = -0.25;
    const arm2 = kiste(lampe, 0.12, 2.0, 0.12, "#2c2f38", [-0.2, 3.1, 0]);
    arm2.rotation.z = 0.9;
    const schirm = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.0, 12, 1, true), lambert("#2c7a4a", { side: THREE.DoubleSide }));
    schirm.position.set(-1.1, 3.5, 0);
    schirm.rotation.z = 0.7;
    lampe.add(schirm);
    const birne = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: "#fff2c0" }));
    birne.position.set(-1.25, 3.25, 0);
    lampe.add(birne);
    lampe.position.set(6.2, 0, -8.6);
    lampe.rotation.y = -0.6;
    scene.add(lampe);
    const warm = new THREE.PointLight(0xffd9a0, 12, 16, 1.6);
    warm.position.set(4.8, 3.2, -7.2);
    scene.add(warm);
  }

  buildBook(scene) {
    const W = this.W;
    const D = this.D;
    // Einband: dunkelroter Deckel, etwas grösser als die Seiten, unter
    // beiden Hälften.
    kiste(scene, W + 0.7, 0.14, D * 2 + 0.6, "#7a1f2c", [0, -0.1, -D / 2], { schatten: false });
    // Seitenstapel: vorn und hinten sieht man die Kanten vieler Seiten.
    kiste(scene, W + 0.2, 0.16, D, "#efe6d0", [0, -0.07, 0], { schatten: false });
    kiste(scene, W + 0.2, 0.16, D, "#efe6d0", [0, -0.07, -D], { schatten: false });
    const kanten = [];
    for (let i = 0; i < 5; i += 1) kanten.push({ p: [0, -0.13 + i * 0.03, D / 2 + 0.01], s: [W + 0.18, 0.006, 0.01] });
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#cbbf9f"), kanten);
    // Die Seite, auf der alle stehen, und die hintere Seite.
    const vorn = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: seitenTextur(1) }));
    vorn.rotation.x = -Math.PI / 2;
    vorn.position.set(0, 0.012, 0);
    vorn.receiveShadow = true;
    scene.add(vorn);
    const hinten = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: seitenTextur(2) }));
    hinten.rotation.x = -Math.PI / 2;
    hinten.position.set(0, 0.012, -D);
    hinten.receiveShadow = true;
    scene.add(hinten);
    // Falz in der Mitte und ein Lesebändchen.
    kiste(scene, W + 0.2, 0.05, 0.12, "#d9ceb2", [0, 0.02, -D / 2], { schatten: false });
    const band = kiste(scene, 0.3, 0.02, 1.2, "#c8413b", [W / 2 - 0.5, -0.02, D / 2 + 0.45], { schatten: false });
    band.rotation.y = 0.1;
  }

  // Eine Seite mit ausgeschnittenen Löchern. Ihr Drehpunkt liegt am Falz; bei
  // Winkel 0 liegt sie hinten flach, bei π vorn auf allen drauf.
  makePage(page) {
    const W = this.W;
    const D = this.D;
    const form = new THREE.Shape();
    form.moveTo(-W / 2, 0);
    form.lineTo(W / 2, 0);
    form.lineTo(W / 2, D);
    form.lineTo(-W / 2, D);
    form.closePath();
    // Die Seite liegt hinten flach und klappt um die x-Achse nach vorn: ihre
    // Koordinate y (Abstand vom Falz) landet vorn bei z = -D/2 + y.
    page.holes.forEach((h) => {
      const loch = new THREE.Path();
      const y = h.z + D / 2;
      loch.moveTo(h.x - h.w / 2, y - h.d / 2);
      loch.lineTo(h.x - h.w / 2, y + h.d / 2);
      loch.lineTo(h.x + h.w / 2, y + h.d / 2);
      loch.lineTo(h.x + h.w / 2, y - h.d / 2);
      loch.closePath();
      form.holes.push(loch);
    });
    const geometry = new THREE.ShapeGeometry(form);
    const texture = this.pageTexture.clone();
    texture.needsUpdate = true;
    texture.repeat.set(1 / W, 1 / D);
    texture.offset.set(0.5, 0);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture, side: THREE.FrontSide }));
    mesh.rotation.x = -Math.PI / 2;           // Formebene → liegt hinten flach
    mesh.castShadow = true;
    // Die Rückseite hat eigenen Text — mit derselben Textur sähe man ihn
    // gespiegelt, sobald die Seite vorn liegt.
    const rueckTextur = seitenTextur(page.index + 5);
    // Gespiegelt und gedreht, damit sie vorn liegend lesbar ist.
    rueckTextur.repeat.set(-1 / W, -1 / D);
    rueckTextur.offset.set(0.5, 1);
    const rueck = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: rueckTextur, side: THREE.BackSide }));
    mesh.add(rueck);
    // Die Lochkanten rot umrandet, damit man sie im Flug erkennt.
    const kanten = page.holes.map((h) => {
      const y = h.z + D / 2;
      const pts = [[-1, -1], [-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => new THREE.Vector3(h.x + (sx * h.w) / 2, y + (sy * h.d) / 2, 0.005));
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: "#ff3b52" }));
    });
    kanten.forEach((k) => mesh.add(k));
    const pivot = new THREE.Group();
    pivot.position.set(0, PAGE_Y + 0.02, -D / 2);
    pivot.add(mesh);
    this.scene.add(pivot);
    // Schatten mit hellen Aussparungen, flach auf der Seite.
    const schatten = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#1a1030", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    schatten.rotation.x = Math.PI / 2;
    schatten.position.set(0, PAGE_Y + 0.004, -D / 2);
    schatten.userData.isFx = true;
    this.scene.add(schatten);
    // Leuchtende Rahmen um die Löcher auf dem Boden.
    const rahmen = page.holes.map((h) => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.88, 1.0, 4, 1), new THREE.MeshBasicMaterial({ color: "#6dff9a", transparent: true, opacity: 0.9, depthWrite: false }));
      r.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      r.scale.set(h.w / Math.SQRT2, h.d / Math.SQRT2, 1);
      r.position.set(h.x, PAGE_Y + 0.01, h.z);
      r.userData.isFx = true;
      this.scene.add(r);
      return r;
    });
    return { pivot, mesh, schatten, rahmen, texture };
  }

  removePage(entry) {
    this.scene.remove(entry.pivot);
    this.scene.remove(entry.schatten);
    entry.rahmen.forEach((r) => this.scene.remove(r));
    entry.mesh.geometry.dispose();
    entry.texture.dispose();
    entry.mesh.children.forEach((child) => child.material?.map?.dispose?.());
  }

  shot() {
    return {
      look: [0, 0, 0.35],
      frame: { w: this.W + 1.2, h: this.D * Math.sin(0.92) + 1.2 },
      pitch: 0.92,
      fov: 36,
      fill: 0.96,
      intro: { yaw: 0.5, pitch: 0.35, zoom: 1.4 },
      finale: { pull: 0.85, zoom: 0.6, lift: 0.3, orbit: 0.12 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Bücherwurm: laufen",
      intervalMs: 60,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "steer", x, y }).catch(() => {}),
      onEngage: () => this.feedback?.vibrate(8)
    });
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
    this.pages.forEach((entry) => this.removePage(entry));
    this.pages.clear();
  }

  onUpdate() {
    this.lastServerAt = performance.now();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.book;
    if (!state) return;
    const elapsed = now - minigame.startedAt;
    const age = Math.min(0.12, (performance.now() - this.lastServerAt) / 1000);

    // Seiten: anlegen, wenn sie beginnen; heranklappen; liegen lassen;
    // zurückblättern und entfernen.
    state.pages.forEach((page) => {
      const started = elapsed >= page.at - 200;
      const over = elapsed > page.slamAt + HOLD_MS + RETURN_MS + 100;
      let entry = this.pages.get(page.index);
      if (started && !over && !entry) {
        entry = this.makePage(page);
        this.pages.set(page.index, entry);
        if (arcade.players[controlledId] && !arcade.players[controlledId].outAt) this.feedback?.sound("whoosh");
      }
      if (!entry) return;
      if (over) {
        this.removePage(entry);
        this.pages.delete(page.index);
        return;
      }
      let angle;
      if (elapsed < page.at) angle = 0;
      else if (elapsed < page.slamAt) {
        const u = (elapsed - page.at) / page.flip;
        // Erst langsam aufrichten, dann schneller fallen — wie eine Seite.
        angle = Math.PI * (u < 0.5 ? 0.5 * Math.pow(u * 2, 0.8) : 0.5 + 0.5 * Math.pow((u - 0.5) * 2, 1.8));
      } else if (elapsed < page.slamAt + HOLD_MS) angle = Math.PI;
      else angle = Math.PI * (1 - Math.min(1, (elapsed - page.slamAt - HOLD_MS) / RETURN_MS));
      entry.pivot.rotation.x = angle;
      const coming = elapsed < page.slamAt ? Math.max(0, (elapsed - page.at) / page.flip) : 0;
      entry.schatten.material.opacity = elapsed < page.slamAt ? 0.1 + coming * 0.45 : 0;
      entry.rahmen.forEach((r) => {
        r.visible = elapsed < page.slamAt + 150;
        r.material.opacity = 0.55 + 0.45 * Math.sin(now / (coming > 0.6 ? 70 : 140));
      });
    });

    // Aufschlag.
    if (state.slammed > this.seenSlam) {
      this.seenSlam = state.slammed;
      const page = state.pages[state.slammed];
      this.rig.shake(0.55);
      this.feedback?.sound("impact");
      this.burst(new THREE.Vector3(0, 0.3, 0), ["#efe6d0", "#ffffff", "#d9ceb2"], { count: 24, speed: 3.2, up: 1.2, size: 0.1, life: 0.9 });
      const own = arcade.players[controlledId];
      if (own && page?.hits?.includes(controlledId)) {
        this.feedback?.vibrate([60, 40, 60]);
      } else if (own && !own.outAt) {
        this.feedback?.sound("coin");
        this.feedback?.vibrate(12);
      }
    }

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const tx = entry.x + (entry.vx || 0) * age;
      const tz = entry.z + (entry.vz || 0) * age;
      const before = kin.position.clone();
      kin.position.x += (tx - kin.position.x) * frameLerp(0.4, dt);
      kin.position.z += (tz - kin.position.z) * frameLerp(0.4, dt);
      const mx = kin.position.x - before.x;
      const mz = kin.position.z - before.z;
      const moving = Math.hypot(mx, mz) > 0.004;
      if (moving) {
        const face = Math.atan2(mx, mz);
        kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(0.3, dt);
      }
      // Platt gedrückt: flach wie Papier, dann ploppt man wieder auf.
      const flat = entry.outAt || now < (entry.flatUntil || 0);
      const was = this.flat.get(player.id) || false;
      if (flat && !was) {
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 0.7, 0)), "PLATT!", { color: "#ffb3bd", size: 0.42 });
        animator.expression("ko", 1600);
        if (player.id === controlledId) this.rig.shake(0.7);
      }
      if (!flat && was) {
        animator.trigger("spawn");
        this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.4, 0)), [player.color, "#ffffff"], { count: 8, speed: 1.4, up: 1.6, size: 0.06, life: 0.5 });
      }
      this.flat.set(player.id, Boolean(flat));
      const squash = flat ? 0.14 : 1;
      kin.scale.y += (squash - kin.scale.y) * frameLerp(flat ? 0.6 : 0.25, dt);
      kin.scale.x = kin.scale.z = 1 + (1 - kin.scale.y) * 0.35;
      // Der Nullpunkt der Figur liegt in der Körpermitte; flachgedrückt muss
      // sie mit ihm absinken, sonst schwebte der Pfannkuchen über der Seite.
      animator.groundY = PAGE_Y + KIN_SOLE * kin.scale.y;
      if (entry.outAt) this.fade(player.id, 0.5);
      if (f.finale) return;
      if (flat) animator.set("dizzy");
      else if (moving) animator.set("run");
      else {
        const coming = state.pages.find((p) => p.index > state.slammed && elapsed >= p.at);
        animator.set(coming ? "cower" : "idle");
        animator.lookAt(coming ? new THREE.Vector3(kin.position.x, 3, -this.D / 2) : null);
      }
    });

    // Dampf über der Tasse, der Globus dreht sich.
    this.steam.forEach((puff) => {
      const u = ((now / 2600) + puff.userData.phase) % 1;
      puff.position.set(this.steamBase.x + Math.sin(u * 6 + puff.userData.phase * 9) * 0.2, this.steamBase.y + u * 2.2, this.steamBase.z);
      puff.scale.setScalar(0.6 + u * 1.3);
      puff.material.opacity = 0.4 * (1 - u);
    });
    if (this.globe) this.globe.rotation.y += dt * 0.2;
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.book;
    if (!state) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(own?.survived || 0);
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const chips = this.hud.querySelector("[data-book-chips]");
    if (chips) {
      const html = room.players.map((player) => {
        const entry = arcade.players[player.id];
        const hearts = "❤".repeat(Math.max(0, entry?.lives || 0)) + "·".repeat(Math.max(0, state.lives - (entry?.lives || 0)));
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}${entry?.outAt ? " is-out" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${hearts}</span>`;
      }).join("");
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }
    const elapsed = now - minigame.startedAt;
    const coming = state.pages.find((p) => p.index > state.slammed && elapsed >= p.at);
    const banner = this.hud.querySelector("[data-book-banner]");
    let message = null;
    let tone = "#12aaff";
    if (own?.outAt) { message = "Platt wie ein Lesezeichen …"; tone = "#8a6238"; }
    else if (own && now < (own.flatUntil || 0)) { message = "PLATT! Gleich geht's weiter"; tone = "#ff5d73"; }
    else if (coming) { message = coming.holes.length === 1 ? "Nur EIN Loch! 😱" : "Seite kommt — ab ins Loch!"; tone = "#1fbf5b"; }
    else if (elapsed < 2000) message = "Achtung, gleich wird geblättert …";
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
    }
  }
}

// Eine Buchseite: Rand, Seitenzahl, Überschrift, Textzeilen, ein Bildchen.
function seitenTextur(nummer) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 486;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fbf5e6";
  ctx.fillRect(0, 0, 384, 486);
  const zufall = streuer(nummer + 3);
  ctx.fillStyle = "#3b2f2a";
  ctx.font = "900 26px Georgia, serif";
  ctx.fillText(["Kapitel 7", "Der Bücherwurm", "Die Riesenseite"][nummer % 3], 34, 60);
  ctx.fillStyle = "rgba(59, 47, 42, 0.55)";
  for (let y = 90; y < 440; y += 16) {
    if (y > 190 && y < 300 && nummer % 2 === 0) continue;
    const w = 250 + zufall() * 70;
    ctx.fillRect(34, y, w, 5);
  }
  if (nummer % 2 === 0) {
    ctx.strokeStyle = "#7a4ddb";
    ctx.lineWidth = 4;
    ctx.strokeRect(60, 196, 180, 96);
    ctx.fillStyle = "#71d97b";
    ctx.beginPath(); ctx.arc(110, 250, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#28c7d9";
    ctx.fillRect(160, 226, 60, 50);
  }
  ctx.fillStyle = "#3b2f2a";
  ctx.font = "700 18px Georgia, serif";
  ctx.fillText(String(40 + nummer * 2), 180, 470);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function holzTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8a5a36";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i += 1) {
    ctx.strokeStyle = i % 3 ? "rgba(60, 35, 20, 0.25)" : "rgba(180, 120, 70, 0.25)";
    ctx.lineWidth = 1 + (i % 4);
    ctx.beginPath();
    const y = i * 6.4;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(80, y + 6, 160, y - 6, 256, y + 3);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
