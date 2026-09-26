import * as THREE from "/vendor/three/three.module.js";
import { createNameLabel, createKin, KinAnimator, KIN_SOLE } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer, himmel } from "./Kulisse.js?v=tumblekin200";

// Schnappschuss — Premierenabend auf dem roten Teppich. Ein Fotograf vorn
// am Bühnenrand zeigt einen Bildausschnitt, zählt herunter und blitzt. Wer im Ausschnitt steht, ist auf dem Foto; wer der Mitte am
// nächsten ist, aufs Titelbild. Mit SCHUBS stösst man andere aus dem Bild.
//
// Drumherum: eine Fotowand mit Sternen, Samtkordeln an goldenen Pfosten,
// dahinter Paparazzi, deren Kameras blitzen, Scheinwerfer auf Stativen und
// Suchscheinwerfer, die über den Nachthimmel wandern.
const STAGE_Y = 0.25;
const TEPPICH_Y = STAGE_Y + 0.015;

export class PhotoShoot extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lastServerAt = performance.now();
    this.seenShot = -1;
    this.seenShoves = new Map();
    this.labelY = 0.8;
    this.flashes = [];
    this.beams = [];
    this.polaroidUntil = 0;
  }

  stage() {
    return {
      label: "3D Schnappschuss",
      background: "#0f1633",
      fog: ["#0f1633", 22, 55],
      lights: { sunPosition: [3, 11, 8], sunColor: 0xfff4e0, sunIntensity: 2.4, hemiIntensity: 1.5, skyColor: 0xc8d0ff, groundColor: 0x4a2030, fillColor: 0xffb0d0, fillIntensity: 0.9, shadow: { left: -5, right: 5, top: 5, bottom: -5 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips" data-photo-chips></div>
      <div class="color-banner" data-photo-banner hidden></div>
      <div class="photo-flash" data-photo-flash></div>
      <div class="photo-polaroid" data-photo-polaroid hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const state = this.minigame?.arcade?.photo;
    this.W = state?.w ?? 6.4;
    this.D = state?.d ?? 7.2;
    himmel(scene, { oben: "#060a24", unten: "#2a1d4a" });
    this.buildVenue(scene);

    // Der Bildausschnitt: Kreis, vier Sucherecken und eine Zahl darüber.
    this.zone = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    this.zone.add(ring);
    const flaeche = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: "#ffe25c", transparent: true, opacity: 0.16, depthWrite: false }));
    flaeche.rotation.x = -Math.PI / 2;
    flaeche.position.y = -0.002;
    this.zone.add(flaeche);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.07), new THREE.MeshBasicMaterial({ color: "#ffe25c" }));
      a.position.set(sx * 1.05, 0.01, sz * 1.25);
      this.zone.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.4), new THREE.MeshBasicMaterial({ color: "#ffe25c" }));
      b.position.set(sx * 1.22, 0.01, sz * 1.08);
      this.zone.add(b);
    });
    this.zone.position.y = STAGE_Y + 0.02;
    this.zone.visible = false;
    this.zone.traverse((o) => { o.userData.isFx = true; });
    scene.add(this.zone);
    this.zoneRing = ring;
    this.zoneFill = flaeche;
    this.countSprites = ["3", "2", "1"].map((text) => {
      const sprite = createNameLabel(text, "#ffe25c");
      sprite.scale.multiplyScalar(1.4);
      sprite.visible = false;
      scene.add(sprite);
      return sprite;
    });
    // Lichtkegel von oben auf den Ausschnitt.
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(1, 4.5, 32, 1, true), new THREE.MeshBasicMaterial({ color: "#fff4c0", transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
    this.cone.userData.isFx = true;
    this.cone.visible = false;
    scene.add(this.cone);

    // Der Fotograf: steht vorn auf dem Teppich, mit dem Rücken zu uns, und
    // wandert zum Ausschnitt mit. Eine Drohne über der Bühne hätte genau den
    // Ausschnitt verdeckt, auf den es ankommt — und ihren Schatten darauf
    // geworfen.
    this.fotograf = createKin("#3b3f4a", 1);
    this.fotograf.scale.setScalar(1.15);
    const fY = TEPPICH_Y + KIN_SOLE * 1.15;
    this.fotograf.position.set(0, fY, this.D / 2 + 0.9);
    this.fotograf.rotation.y = Math.PI;
    scene.add(this.fotograf);
    this.fotografAnimator = new KinAnimator(this.fotograf);
    this.fotografAnimator.groundY = fY;
    const kamera = new THREE.Group();
    kiste(kamera, 0.34, 0.24, 0.2, "#16171c", [0, 0, 0]);
    const objektiv = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 12), lambert("#0c0d10"));
    objektiv.rotation.x = Math.PI / 2;
    objektiv.position.z = 0.18;
    kamera.add(objektiv);
    this.cameraFlash = kiste(kamera, 0.18, 0.1, 0.08, "#7a7a70", [0, 0.2, 0.02], { schatten: false });
    this.cameraFlash.material = new THREE.MeshBasicMaterial({ color: "#7a7a70" });
    kamera.position.set(0, 0.3, 0.3);
    this.fotograf.userData.torso.add(kamera);
    // Mütze nach hinten.
    kiste(this.fotograf.userData.head, 0.46, 0.1, 0.44, "#ff5d73", [0, 0.36, 0]);
    kiste(this.fotograf.userData.head, 0.3, 0.04, 0.2, "#ff5d73", [0, 0.33, -0.3]);

    const players = this.getState()?.players || [];
    const arcade = this.minigame?.arcade;
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      this.addKin(player, index, { x: entry?.x ?? 0, ground: STAGE_Y, z: entry?.z ?? 0, facing: entry?.heading ?? 0 });
    });
  }

  buildVenue(scene) {
    const W = this.W;
    const D = this.D;
    // Boden draussen: dunkler Asphalt mit Reflexen.
    kiste(scene, 60, 0.2, 50, "#1c1f2e", [0, -0.1, -4], { schatten: false });
    // Bühne: schwarz mit Goldkante, roter Teppich in der Mitte.
    kiste(scene, W + 0.3, STAGE_Y, D + 0.3, "#15151c", [0, STAGE_Y / 2, 0]);
    kiste(scene, W + 0.34, 0.05, 0.08, "#e9b949", [0, STAGE_Y, D / 2 + 0.15], { schatten: false });
    kiste(scene, W + 0.34, 0.05, 0.08, "#e9b949", [0, STAGE_Y, -D / 2 - 0.15], { schatten: false });
    kiste(scene, 0.08, 0.05, D + 0.34, "#e9b949", [W / 2 + 0.15, STAGE_Y, 0], { schatten: false });
    kiste(scene, 0.08, 0.05, D + 0.34, "#e9b949", [-W / 2 - 0.15, STAGE_Y, 0], { schatten: false });
    // Der Teppich ist vor der Bühne ein Laufsteg bis zum Boden — als dünne
    // Platte auf Bühnenhöhe schwebte er dort, und der Fotograf stand mit den
    // Füssen darin.
    const teppich = kiste(scene, 2.4, TEPPICH_Y, D + 8, "#b8142e", [0, TEPPICH_Y / 2, 3.8], { schatten: false });
    teppich.receiveShadow = true;
    // Sterne im Bühnenboden.
    const zufall = streuer(41);
    const sterne = [];
    for (let i = 0; i < 12; i += 1) sterne.push({ p: [(zufall() - 0.5) * (W - 0.6), STAGE_Y + 0.004, (zufall() - 0.5) * (D - 0.6)], r: [-Math.PI / 2, 0, zufall() * 3], s: 0.14 + zufall() * 0.1 });
    viele(scene, new THREE.CircleGeometry(1, 5), new THREE.MeshBasicMaterial({ color: "#e9b949" }), sterne);
    // Fotowand hinten.
    const wand = new THREE.Mesh(new THREE.BoxGeometry(W + 2.4, 3.2, 0.2), [lambert("#15151c"), lambert("#15151c"), lambert("#15151c"), lambert("#15151c"), new THREE.MeshLambertMaterial({ map: fotowandTextur() }), lambert("#15151c")]);
    wand.position.set(0, STAGE_Y + 1.6, -D / 2 - 0.6);
    scene.add(wand);
    kiste(scene, W + 2.5, 0.2, 0.3, "#e9b949", [0, STAGE_Y + 3.25, -D / 2 - 0.6]);
    // Samtkordeln an goldenen Pfosten links und rechts.
    [-1, 1].forEach((seite) => {
      const pfosten = [];
      for (let z = -D / 2; z <= D / 2 + 3.01; z += 1.2) pfosten.push({ p: [seite * (W / 2 + 0.6), 0.45, z] });
      viele(scene, new THREE.CylinderGeometry(0.06, 0.09, 0.9, 8), lambert("#e9b949"), pfosten, { schatten: true });
      viele(scene, new THREE.SphereGeometry(0.1, 8, 6), lambert("#e9b949"), pfosten.map((p) => ({ p: [p.p[0], 0.92, p.p[2]] })));
      for (let i = 0; i < pfosten.length - 1; i += 1) {
        const a = new THREE.Vector3(pfosten[i].p[0], 0.8, pfosten[i].p[2]);
        const b = new THREE.Vector3(pfosten[i + 1].p[0], 0.8, pfosten[i + 1].p[2]);
        const kurve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(a.x, 0.55, (a.z + b.z) / 2), b);
        const kordel = new THREE.Mesh(new THREE.TubeGeometry(kurve, 8, 0.035, 5, false), lambert("#7a0f24"));
        scene.add(kordel);
      }
      // Paparazzi hinter der Kordel.
      const leute = [];
      const kameras = [];
      for (let i = 0; i < 9; i += 1) {
        const z = -D / 2 + 0.3 + i * ((D + 2.4) / 9);
        const x = seite * (W / 2 + 1.4 + zufall() * 0.9);
        leute.push({ x, z, farbe: ["#2f3a5a", "#5a2f3a", "#3a5a2f", "#4a4a4a"][i % 4] });
        kameras.push({ p: [x - seite * 0.32, 1.2, z], r: [0, 0, 0] });
      }
      ["#2f3a5a", "#5a2f3a", "#3a5a2f", "#4a4a4a"].forEach((farbe) => {
        viele(scene, new THREE.BoxGeometry(0.46, 0.8, 0.34), lambert(farbe), leute.filter((l) => l.farbe === farbe).map((l) => ({ p: [l.x, 0.6, l.z] })), { schatten: true });
      });
      viele(scene, new THREE.BoxGeometry(0.4, 0.34, 0.36), lambert("#f1c9a0"), leute.map((l) => ({ p: [l.x, 1.18, l.z] })));
      viele(scene, new THREE.BoxGeometry(0.1, 0.1, 0.32), lambert("#1c1c24"), leute.map((l) => ({ p: [l.x, 1.35, l.z] })));
      viele(scene, new THREE.BoxGeometry(0.26, 0.2, 0.3), lambert("#1c1c24"), kameras);
      kameras.forEach((k) => {
        const blitz = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }));
        blitz.position.set(k.p[0] - seite * 0.18, k.p[1] + 0.12, k.p[2]);
        blitz.userData = { isFx: true, next: zufall() * 3000, seite };
        scene.add(blitz);
        this.flashes.push(blitz);
      });
    });
    // Scheinwerfer auf Stativen an den Bühnenecken.
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
      const x = sx * (W / 2 + 0.25);
      const z = sz * (D / 2 + 0.25);
      kiste(scene, 0.06, 1.8, 0.06, "#2a2a32", [x, STAGE_Y + 0.9, z], { schatten: false });
      const kopf = kiste(scene, 0.4, 0.3, 0.4, "#2a2a32", [x, STAGE_Y + 1.9, z]);
      kopf.rotation.set(0.4 * -sz, 0, 0.4 * sx);
      const glas = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), new THREE.MeshBasicMaterial({ color: "#fff4d0" }));
      glas.position.set(x - sx * 0.12, STAGE_Y + 1.82, z - sz * 0.12);
      glas.lookAt(0, 0, 0);
      scene.add(glas);
    });
    // Suchscheinwerfer über der Stadt.
    for (let i = 0; i < 3; i += 1) {
      const strahl = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.2, 26, 16, 1, true), new THREE.MeshBasicMaterial({ color: "#c8d8ff", transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
      strahl.geometry.translate(0, 13, 0);
      strahl.position.set(-8 + i * 8, 0, -16);
      strahl.userData = { isFx: true, phase: i * 1.7 };
      scene.add(strahl);
      this.beams.push(strahl);
    }
    // Skyline.
    const haeuser = [];
    for (let i = 0; i < 20; i += 1) {
      const h = 3 + zufall() * 8;
      haeuser.push({ p: [-26 + i * 2.7, h / 2, -22 - zufall() * 4], s: [2.2, h, 2] });
    }
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#1a2040"), haeuser);
    const fenster = [];
    haeuser.forEach((haus) => {
      for (let k = 0; k < 6; k += 1) {
        if (zufall() < 0.45) continue;
        fenster.push({ p: [haus.p[0] + (zufall() - 0.5) * 1.6, 0.8 + zufall() * (haus.s[1] - 1.2), haus.p[2] + 1.01], s: 0.22 });
      }
    });
    viele(scene, new THREE.PlaneGeometry(1, 1.3), new THREE.MeshBasicMaterial({ color: "#ffd98a" }), fenster);
  }

  shot() {
    return {
      look: [0, STAGE_Y, 0.35],
      frame: { w: this.W + 1.4, h: this.D * Math.sin(0.88) + 1.4 },
      pitch: 0.88,
      fov: 36,
      fill: 0.96,
      intro: { yaw: 0.5, pitch: 0.35, zoom: 1.4 },
      finale: { pull: 0.85, zoom: 0.6, lift: 0.3, orbit: 0.12 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls snow-controls">
        <div class="joystick-slot"></div>
        <button type="button" class="snow-throw photo-shove" data-photo-shove>
          <span class="snow-meter"><i></i></span>
          <b>SCHUBS!</b>
        </button>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Schnappschuss: laufen",
      intervalMs: 60,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "steer", x, y }).catch(() => {}),
      onEngage: () => this.feedback?.vibrate(8)
    });
    this.shoveButton = this.controls.querySelector("[data-photo-shove]");
    this.on(this.shoveButton, "pointerdown", (event) => {
      event.preventDefault();
      const minigame = this.update || this.minigame;
      if (!minigame || minigame.finaleAt) return;
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(14);
      this.sendInput({ action: "shove" }).catch(() => {});
    });
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
  }

  onUpdate() {
    this.lastServerAt = performance.now();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.photo;
    if (!state) return;
    const elapsed = now - minigame.startedAt;
    const age = Math.min(0.12, (performance.now() - this.lastServerAt) / 1000);

    // Der aktuelle Ausschnitt.
    const shot = state.shots.find((s) => s.index > state.shot && elapsed >= s.at);
    this.zone.visible = Boolean(shot) && !f.finale;
    this.cone.visible = this.zone.visible;
    this.countSprites.forEach((sprite) => { sprite.visible = false; });
    if (shot) {
      const left = shot.shootAt - elapsed;
      const grow = Math.min(1, (elapsed - shot.at) / 250);
      this.zone.position.x = shot.x;
      this.zone.position.z = shot.z;
      this.zone.scale.setScalar(shot.r * (0.6 + 0.4 * grow));
      const hot = left < 900;
      this.zoneRing.material.color.set(hot && Math.floor(now / 120) % 2 ? "#ff5d73" : "#ffffff");
      this.zoneFill.material.opacity = hot ? 0.28 : 0.16;
      this.cone.position.set(shot.x, STAGE_Y + 2.25, shot.z);
      this.cone.scale.set(shot.r, 1, shot.r);
      const count = Math.ceil(left / Math.max(1, (shot.shootAt - shot.at) / 3));
      const sprite = this.countSprites[3 - Math.max(1, Math.min(3, count))];
      if (sprite && left > 0) {
        sprite.visible = true;
        sprite.position.set(shot.x, STAGE_Y + 1.9, shot.z);
      }
      if (count !== this.lastCount && left > 0) {
        this.lastCount = count;
        this.feedback?.sound("countdown");
      }
    }

    // Der Fotograf läuft vor den Ausschnitt und hebt die Kamera.
    const aim = shot || state.shots.find((s) => s.index > state.shot) || { x: 0, z: 0 };
    const fx = Math.max(-this.W / 2 + 0.4, Math.min(this.W / 2 - 0.4, aim.x));
    const walk = fx - this.fotograf.position.x;
    this.fotograf.position.x += walk * frameLerp(0.08, dt);
    const face = Math.atan2(aim.x - this.fotograf.position.x, aim.z - this.fotograf.position.z);
    this.fotograf.rotation.y += Math.atan2(Math.sin(face - this.fotograf.rotation.y), Math.cos(face - this.fotograf.rotation.y)) * frameLerp(0.15, dt);
    this.fotografAnimator.set(Math.abs(walk) > 0.15 ? "walk" : shot ? "aim" : "idle");
    this.fotografAnimator.update(now);

    // Blitz!
    if (state.shot > this.seenShot) {
      this.seenShot = state.shot;
      const result = state.results.find((r) => r.index === state.shot);
      const done = state.shots[state.shot];
      const flash = this.hud.querySelector("[data-photo-flash]");
      if (flash) {
        flash.classList.remove("is-on");
        void flash.offsetWidth;
        flash.classList.add("is-on");
      }
      this.cameraFlash.material.color.set("#ffffff");
      this.flashOff = performance.now() + 160;
      this.feedback?.sound("perfect");
      this.rig.shake(0.15);
      if (done) this.burst(new THREE.Vector3(done.x, STAGE_Y + 0.6, done.z), ["#ffffff", "#fff4c0"], { count: 16, speed: 2, up: 1.2, size: 0.06, life: 0.5 });
      (result?.in || []).forEach((item) => {
        const kin = this.kins.get(item.id);
        const animator = this.animators.get(item.id);
        if (kin) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), `+${item.points}`, { color: item.cover ? "#ffe36b" : "#ffffff", size: item.cover ? 0.5 : 0.38 });
        animator?.trigger(item.cover ? "victory" : "wavehi");
        if (item.id === controlledId) this.feedback?.vibrate(item.cover ? [20, 30, 40] : 16);
      });
      this.showPolaroid(result, players, controlledId);
    }
    if (this.flashOff && performance.now() > this.flashOff) {
      this.flashOff = 0;
      this.cameraFlash.material.color.set("#7a7a70");
    }

    // Paparazzi blitzen zufällig — und alle, wenn die Drohne blitzt.
    const nowP = performance.now();
    this.flashes.forEach((blitz) => {
      if (nowP > blitz.userData.next) {
        blitz.userData.at = nowP;
        blitz.userData.next = nowP + 900 + Math.random() * 2600;
      }
      const since = nowP - (blitz.userData.at || -9999);
      blitz.material.opacity = since < 120 ? 1 - since / 120 : 0;
      blitz.lookAt(this.camera.position);
    });
    this.beams.forEach((strahl) => {
      const t = now / 1000 * 0.4 + strahl.userData.phase;
      strahl.rotation.z = Math.sin(t) * 0.45;
      strahl.rotation.x = Math.cos(t * 0.7) * 0.2;
    });

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const tx = entry.x + (entry.vx || 0) * age;
      const tz = entry.z + (entry.vz || 0) * age;
      kin.position.x += (tx - kin.position.x) * frameLerp(0.45, dt);
      kin.position.z += (tz - kin.position.z) * frameLerp(0.45, dt);
      const turn = entry.heading - kin.rotation.y;
      kin.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * frameLerp(0.3, dt);
      const shoves = entry.shoves || 0;
      if (shoves > (this.seenShoves.get(player.id) ?? shoves)) {
        animator.trigger("shove");
        this.burst(kin.position.clone().add(new THREE.Vector3(Math.sin(entry.heading) * 0.5, 0.6, Math.cos(entry.heading) * 0.5)), ["#ffffff", player.color], { count: 6, speed: 1.4, up: 0.8, size: 0.05, life: 0.3 });
      }
      this.seenShoves.set(player.id, shoves);
      const stunned = now < (entry.stunUntil || 0);
      if (stunned && entry.lastShovedAt && now - entry.lastShovedAt < 120 && this.lastShovedPop !== `${player.id}${entry.lastShovedAt}`) {
        this.lastShovedPop = `${player.id}${entry.lastShovedAt}`;
        animator.trigger("knockback");
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "HUCH!", { color: "#ffb3bd", size: 0.3 });
        if (player.id === controlledId) {
          this.rig.shake(0.35);
          this.feedback?.sound("collision");
        }
      }
      if (f.finale) return;
      const moving = Math.hypot(entry.vx || 0, entry.vz || 0) > 0.5;
      const inShot = shot && Math.hypot(entry.x - shot.x, entry.z - shot.z) <= shot.r;
      if (stunned) animator.set("dizzy");
      else if (moving) animator.set("run");
      else if (inShot) {
        animator.set(shot.shootAt - elapsed < 900 ? "victory" : "happy");
        animator.lookAt(this.fotograf.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
      } else animator.set("idle");
    });
  }

  showPolaroid(result, players, controlledId) {
    const card = this.hud.querySelector("[data-photo-polaroid]");
    if (!card) return;
    const inside = result?.in || [];
    const names = inside.length
      ? inside.map((item) => {
        const player = players.find((p) => p.id === item.id);
        return `<span class="photo-face${item.id === controlledId ? " is-own" : ""}" style="--chip:${player?.color || "#fff"}">${item.cover ? "⭐" : ""}${escapeName(player?.name)}<small>+${item.points}</small></span>`;
      }).join("")
      : "<em>Niemand im Bild!</em>";
    card.innerHTML = `<div class="photo-picture">${names}</div><p>Schnappschuss ${Number(result?.index ?? 0) + 1}</p>`;
    card.hidden = false;
    this.polaroidUntil = performance.now() + 1600;
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.photo;
    if (!state) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(own?.score || 0);
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const chips = this.hud.querySelector("[data-photo-chips]");
    if (chips) {
      const html = room.players.map((player) => {
        const entry = arcade.players[player.id];
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>📸${entry?.score || 0}</span>`;
      }).join("");
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }
    const card = this.hud.querySelector("[data-photo-polaroid]");
    if (card && !card.hidden && performance.now() > this.polaroidUntil) card.hidden = true;
    const elapsed = now - minigame.startedAt;
    const shot = state.shots.find((s) => s.index > state.shot && elapsed >= s.at);
    const banner = this.hud.querySelector("[data-photo-banner]");
    let message = null;
    let tone = "#b57bff";
    if (elapsed < state.shots[0]?.at) message = "Gleich wird fotografiert …";
    else if (shot) {
      const inside = own && Math.hypot(own.x - shot.x, own.z - shot.z) <= shot.r;
      message = inside ? "Lächeln! 😁" : "Rein ins Bild!";
      tone = inside ? "#1fbf5b" : "#ff5d73";
    }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt) || (card && !card.hidden);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
    }
    if (this.shoveButton) {
      const ready = own ? Math.min(1, (now - (own.lastShoveAt || 0)) / 1300) : 1;
      this.shoveButton.classList.toggle("is-ready", ready >= 1);
      this.shoveButton.querySelector(".snow-meter i").style.width = `${Math.round(ready * 100)}%`;
      this.shoveButton.disabled = Boolean(minigame.finaleAt);
    }
  }
}

function fotowandTextur() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#16162a";
  ctx.fillRect(0, 0, 512, 256);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const x = col * 110 + (row % 2) * 55 + 20;
      const y = row * 64 + 36;
      ctx.fillStyle = (row + col) % 2 ? "#e9b949" : "#ff5d73";
      ctx.font = "900 26px system-ui, sans-serif";
      ctx.fillText("★", x, y);
      ctx.fillStyle = "#d8dcf0";
      ctx.font = "800 13px system-ui, sans-serif";
      ctx.fillText("TUMBLEKIN", x + 26, y - 4);
      ctx.fillText("PREMIERE", x + 26, y + 10);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
