import * as THREE from "/vendor/three/three.module.js";
import { reachArm } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer, berge, himmel } from "./Kulisse.js?v=tumblekin200";

// Schneeballhang — ein Plateau auf dem Gipfel, rundherum ein Schneewall.
// Jeder schiebt eine Kugel vor sich her, die beim Rollen wächst; ein Tipp
// schickt sie los. Wer getroffen wird, fällt um. Wer seine grosse Kugel vor
// sich hält, hat einen Schild.
//
// Drumherum: verschneite Tannen, eine Hütte mit rauchendem Schornstein,
// Schneemänner, Skier am Zaun, das Gipfelkreuz auf dem Felsen und ein
// Bergpanorama. Es schneit.
const W = 7;
const D = 9;
const BODY_R = 0.3;

function ballRadius(size) {
  return 0.12 + size * 0.26;
}

const _v = new THREE.Vector3();

export class SnowSummit extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lastServerAt = performance.now();
    this.carried = new Map();      // playerId → Kugel vor der Figur
    this.rolling = new Map();      // Kugel-ID → Mesh
    this.seenBursts = new Set();
    this.stunned = new Map();
    this.labelY = 0.8;
    this.flakes = null;
  }

  stage() {
    return {
      label: "3D Schneeballhang",
      background: "#cfe6f7",
      fog: ["#e3f0fa", 20, 60],
      lights: { sunPosition: [-6, 12, 7], sunIntensity: 2.5, hemiIntensity: 2.0, skyColor: 0xe8f2ff, groundColor: 0xa8bcd4, shadow: { left: -6.5, right: 6.5, top: 5.5, bottom: -5.5 } }
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
      // Ein farbiger Ring um die eigene Kugel, damit man sie im Getümmel findet.
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.01, 0.05, 6, 24), new THREE.MeshLambertMaterial({ color: player.color }));
      kugel.add(band);
      scene.add(kugel);
      this.carried.set(player.id, { mesh: kugel, band, spin: 0, size: 0.2 });
    });
  }

  buildSummit(scene) {
    // Schneefläche mit bläulichen Schattenflecken.
    kiste(scene, 80, 0.5, 70, "#e4edf6", [0, -0.25, 0], { schatten: false });
    const zufall = streuer(17);
    const flecken = [];
    for (let i = 0; i < 26; i += 1) {
      const x = (zufall() - 0.5) * 34;
      const z = (zufall() - 0.5) * 30;
      if (Math.abs(x) < W / 2 + 0.6 && Math.abs(z) < D / 2 + 0.6) continue;
      flecken.push({ p: [x, 0.004, z], r: [-Math.PI / 2, 0, zufall() * 3], s: [1.5 + zufall() * 3, 0.8 + zufall() * 2, 1] });
    }
    viele(scene, new THREE.CircleGeometry(1, 12), lambert("#d2deec"), flecken);
    // Spielfeld: festgetretener Schnee, etwas grauer, mit Fussspuren.
    kiste(scene, W, 0.02, D, "#c6d4e4", [0, 0.005, 0], { schatten: false });
    // Spuren im Feld: flache, etwas hellere Streifen.
    const spuren = [];
    for (let i = 0; i < 16; i += 1) spuren.push({ p: [(zufall() - 0.5) * (W - 1), 0.017, (zufall() - 0.5) * (D - 1)], r: [-Math.PI / 2, 0, zufall() * 3], s: [0.25, 1 + zufall() * 1.6, 1] });
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#d6e1ee"), spuren);
    // Schneewall rund ums Feld.
    const wall = [];
    for (let x = -W / 2; x <= W / 2 + 0.01; x += 0.55) {
      wall.push({ p: [x, 0.14, -D / 2 - 0.3], s: [0.75 + zufall() * 0.3, 0.55 + zufall() * 0.3, 0.8] });
      wall.push({ p: [x, 0.14, D / 2 + 0.3], s: [0.75 + zufall() * 0.3, 0.45 + zufall() * 0.25, 0.8] });
    }
    for (let z = -D / 2; z <= D / 2 + 0.01; z += 0.55) {
      wall.push({ p: [-W / 2 - 0.3, 0.14, z], s: [0.8, 0.55 + zufall() * 0.3, 0.75 + zufall() * 0.3] });
      wall.push({ p: [W / 2 + 0.3, 0.14, z], s: [0.8, 0.55 + zufall() * 0.3, 0.75 + zufall() * 0.3] });
    }
    viele(scene, new THREE.SphereGeometry(0.42, 8, 6), lambert("#eef3fa"), wall, { schatten: true, empfangen: true });
    // Eckpfosten mit Fähnchen.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
      kiste(scene, 0.1, 1.3, 0.1, "#8a5a3a", [sx * (W / 2 + 0.35), 0.65, sz * (D / 2 + 0.35)]);
      kiste(scene, 0.3, 0.2, 0.02, ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"][i], [sx * (W / 2 + 0.35) + 0.16, 1.2, sz * (D / 2 + 0.35)], { schatten: false });
      kiste(scene, 0.16, 0.08, 0.16, "#ffffff", [sx * (W / 2 + 0.35), 1.32, sz * (D / 2 + 0.35)], { schatten: false });
    });

    // Verschneite Tannen im Kranz — mit Abstand zum Feld, sonst stehen sie
    // von oben gesehen mitten im Spiel. Vorn nur kleine, weiter weg.
    const tannen = [];
    for (let i = 0; i < 44; i += 1) {
      const a = (i / 44) * Math.PI * 2 + zufall() * 0.1;
      const r = 1 + zufall() * 0.35;
      const x = Math.cos(a) * (W / 2 + 3.2) * r * 1.25;
      let z = Math.sin(a) * (D / 2 + 3) * r;
      const vorn = z > D / 2;
      if (vorn) z = D / 2 + 3 + zufall() * 3;
      tannen.push([x, z, vorn ? 0.9 + zufall() * 0.5 : 1.4 + zufall() * 1.3]);
    }
    viele(scene, new THREE.BoxGeometry(0.22, 1, 0.22), lambert("#6b4a2e"), tannen.map(([x, z, h]) => ({ p: [x, h * 0.2, z], s: [1, h * 0.4, 1] })));
    viele(scene, new THREE.ConeGeometry(0.9, 1.6, 7), lambert("#2f6b4a"), tannen.map(([x, z, h]) => ({ p: [x, h * 0.35 + h * 0.4, z], s: h * 0.6, r: [0, x, 0] })), { schatten: true });
    viele(scene, new THREE.ConeGeometry(0.62, 1.1, 7), lambert("#3d7d57"), tannen.map(([x, z, h]) => ({ p: [x, h * 0.35 + h * 0.9, z], s: h * 0.6, r: [0, x + 1, 0] })), { schatten: true });
    viele(scene, new THREE.ConeGeometry(0.4, 0.55, 7), lambert("#ffffff"), tannen.map(([x, z, h]) => ({ p: [x, h * 0.35 + h * 1.28, z], s: h * 0.6, r: [0, x + 1, 0] })));
    viele(scene, new THREE.ConeGeometry(0.93, 0.3, 7, 1, true), lambert("#ffffff", { side: THREE.DoubleSide }), tannen.map(([x, z, h]) => ({ p: [x, h * 0.35 + h * 0.55, z], s: h * 0.6, r: [0, x, 0] })));

    // Bergpanorama.
    berge(scene, [[-24, -34, 14], [-8, -40, 18], [10, -38, 15], [26, -32, 12], [-36, -24, 10], [36, -26, 11]], { color: "#8ea6bf", schneeAnteil: 0.42 });
    // Gipfelkreuz auf einem Felsen hinten links.
    const fels = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 0), lambert("#8f9aa6"));
    fels.scale.set(1.2, 0.9, 1);
    fels.position.set(-6.5, 0.6, -6.2);
    fels.castShadow = true;
    scene.add(fels);
    kiste(scene, 1.5, 0.35, 1.2, "#ffffff", [-6.4, 1.62, -6.1], { schatten: false });
    kiste(scene, 0.2, 2.6, 0.2, "#7a5330", [-6.5, 2.9, -6.2]);
    kiste(scene, 1.2, 0.18, 0.2, "#7a5330", [-6.5, 3.55, -6.2]);
    const fahne = kiste(scene, 0.5, 0.3, 0.02, "#ff3b52", [-6.2, 4.05, -6.2], { schatten: false });
    this.flag = fahne;
    // Hütte hinten rechts mit rauchendem Schornstein.
    const huette = new THREE.Group();
    kiste(huette, 2.6, 1.6, 2, "#8a5a3a", [0, 0.8, 0]);
    const balken = [];
    for (let i = 0; i < 6; i += 1) balken.push({ p: [0, 0.14 + i * 0.27, 1.01], s: [1, 1, 1] });
    viele(huette, new THREE.BoxGeometry(2.62, 0.05, 0.03), lambert("#6b4a2e"), balken);
    [-1, 1].forEach((seite) => {
      const dach = kiste(huette, 1.7, 0.14, 2.4, "#ffffff", [seite * 0.68, 1.98, 0]);
      dach.rotation.z = -seite * 0.55;
    });
    kiste(huette, 0.5, 0.8, 0.1, "#4a3020", [0.5, 0.4, 1.02]);
    const fenster = kiste(huette, 0.5, 0.4, 0.05, "#ffe9a0", [-0.6, 0.95, 1.02], { schatten: false });
    fenster.material = new THREE.MeshBasicMaterial({ color: "#ffe39a" });
    kiste(huette, 0.35, 0.8, 0.35, "#8f9aa6", [0.75, 2.2, -0.4]);
    huette.position.set(7.4, 0, -6.4);
    huette.rotation.y = -0.4;
    scene.add(huette);
    this.chimney = new THREE.Vector3(7.4 + 0.55, 2.7, -6.4 - 0.65);
    this.smoke = [];
    for (let i = 0; i < 6; i += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshLambertMaterial({ color: "#e8edf2", transparent: true, opacity: 0.7 }));
      puff.userData.phase = i / 6;
      scene.add(puff);
      this.smoke.push(puff);
    }
    // Schneemänner und Skier.
    [[-6.2, 2.4, 0.4], [6.6, 1.2, -0.5]].forEach(([x, z, dreh]) => {
      const mann = new THREE.Group();
      [[0.42, 0.4], [0.3, 1.02], [0.22, 1.48]].forEach(([r, y]) => {
        const kugel = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), lambert("#ffffff"));
        kugel.position.y = y;
        kugel.castShadow = true;
        mann.add(kugel);
      });
      const nase = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.24, 6), lambert("#ff8a2e"));
      nase.rotation.x = Math.PI / 2;
      nase.position.set(0, 1.48, 0.3);
      mann.add(nase);
      kiste(mann, 0.05, 0.05, 0.02, "#1c1c28", [-0.08, 1.56, 0.2], { schatten: false });
      kiste(mann, 0.05, 0.05, 0.02, "#1c1c28", [0.08, 1.56, 0.2], { schatten: false });
      kiste(mann, 0.34, 0.28, 0.34, "#1c1c28", [0, 1.78, 0]);
      kiste(mann, 0.48, 0.04, 0.48, "#1c1c28", [0, 1.65, 0]);
      kiste(mann, 0.5, 0.06, 0.08, "#ff3b52", [0, 1.24, 0.12], { schatten: false });
      [-1, 1].forEach((seite) => {
        const arm = kiste(mann, 0.5, 0.04, 0.04, "#6b4a2e", [seite * 0.45, 1.1, 0], { schatten: false });
        arm.rotation.z = seite * 0.5;
      });
      mann.position.set(x, 0, z);
      mann.rotation.y = dreh;
      scene.add(mann);
    });
    [["#ff5d73", 5.8], ["#28c7d9", 6.05]].forEach(([farbe, x]) => {
      const ski = kiste(scene, 0.1, 1.7, 0.04, farbe, [x, 0.8, -4.6]);
      ski.rotation.x = -0.25;
    });
    [5.5, 6.35].forEach((x) => {
      const stock = kiste(scene, 0.03, 1.2, 0.03, "#3b3f4a", [x, 0.6, -4.55], { schatten: false });
      stock.rotation.z = x < 6 ? 0.1 : -0.1;
    });

    // Schneefall: ein Punktwolke, die langsam nach unten driftet.
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

  shot() {
    return {
      look: [0, 0, 0.3],
      frame: { w: W + 1.4, h: D * Math.sin(0.86) + 1.4 },
      pitch: 0.86,
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
        <button type="button" class="snow-throw" data-snow-throw>
          <span class="snow-meter"><i></i></span>
          <b>WERFEN</b>
        </button>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Schneeballhang: rollen",
      intervalMs: 70,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "steer", x, y }).catch(() => {}),
      onEngage: () => this.feedback?.vibrate(8)
    });
    this.throwButton = this.controls.querySelector("[data-snow-throw]");
    this.on(this.throwButton, "pointerdown", (event) => {
      event.preventDefault();
      const minigame = this.update || this.minigame;
      if (!minigame || minigame.finaleAt) return;
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(12);
      this.sendInput({ action: "throw" }).catch(() => {});
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
    const { now, dt, arcade, players, controlledId } = f;
    const state = arcade?.snow;
    if (!state) return;
    const age = Math.min(0.12, (performance.now() - this.lastServerAt) / 1000);

    // Schnee fällt, Rauch steigt, Fahne weht.
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
    this.smoke.forEach((puff) => {
      const u = ((now / 3000) + puff.userData.phase) % 1;
      puff.position.set(this.chimney.x + u * 0.8, this.chimney.y + u * 2.4, this.chimney.z - u * 0.3);
      puff.scale.setScalar(0.5 + u * 1.4);
      puff.material.opacity = 0.7 * (1 - u);
    });
    if (this.flag) this.flag.rotation.y = Math.sin(now / 260) * 0.35;

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const ball = this.carried.get(player.id);
      if (!entry || !kin || !animator || !ball) return;
      const isOwn = player.id === controlledId;
      const tx = entry.x + entry.vx * age;
      const tz = entry.z + entry.vz * age;
      const before = kin.position.clone();
      kin.position.x += (tx - kin.position.x) * frameLerp(0.35, dt);
      kin.position.z += (tz - kin.position.z) * frameLerp(0.35, dt);
      const moved = Math.hypot(kin.position.x - before.x, kin.position.z - before.z);
      const turn = entry.heading - kin.rotation.y;
      kin.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * frameLerp(0.3, dt);
      const stunned = now < (entry.stunUntil || 0);
      if (stunned && !this.stunned.get(player.id)) {
        animator.trigger("knockback");
        animator.expression("dizzy", entry.stunUntil - now);
      }
      this.stunned.set(player.id, stunned);

      // Die Kugel vor der Figur: so gross wie auf dem Server, rollt mit.
      ball.size += ((entry.size ?? 0.2) - ball.size) * frameLerp(0.3, dt);
      const r = ballRadius(ball.size);
      const hx = Math.sin(kin.rotation.y);
      const hz = Math.cos(kin.rotation.y);
      ball.mesh.visible = !stunned;
      ball.mesh.scale.setScalar(r);
      ball.mesh.position.set(kin.position.x + hx * (BODY_R + r), r, kin.position.z + hz * (BODY_R + r));
      ball.spin += (moved / Math.max(0.1, r));
      ball.mesh.rotation.set(ball.spin, kin.rotation.y, 0, "YXZ");
      ball.band.visible = true;
      if (isOwn && entry.size >= (state.throwMin ?? 0.4) && !this.readySeen) {
        this.readySeen = true;
        this.feedback?.sound("plink");
      }
      if (isOwn && entry.size < (state.throwMin ?? 0.4)) this.readySeen = false;

      if (f.finale) return;
      if (stunned) animator.set("dizzy");
      else if (moved > 0.004) animator.set("walk");
      else animator.set("idle");
    });

    // Rollende Kugeln.
    const alive = new Set();
    state.balls.forEach((ball) => {
      alive.add(ball.id);
      let mesh = this.rolling.get(ball.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), lambert("#ffffff"));
        mesh.castShadow = true;
        const owner = players.find((p) => p.id === ball.owner);
        const band = new THREE.Mesh(new THREE.TorusGeometry(1.01, 0.05, 6, 24), new THREE.MeshLambertMaterial({ color: owner?.color || "#ffffff" }));
        mesh.add(band);
        mesh.scale.setScalar(ball.r);
        mesh.position.set(ball.x, ball.r, ball.z);
        this.scene.add(mesh);
        this.rolling.set(ball.id, mesh);
      }
      const x = ball.x + ball.vx * age;
      const z = ball.z + ball.vz * age;
      mesh.position.x += (x - mesh.position.x) * frameLerp(0.6, dt);
      mesh.position.z += (z - mesh.position.z) * frameLerp(0.6, dt);
      mesh.position.y = ball.r;
      const dir = Math.atan2(ball.vx, ball.vz);
      mesh.rotation.set(ball.spin, dir, 0, "YXZ");
      // Pulverschnee hinter der Kugel.
      if (Math.random() < 0.35) {
        _v.set(mesh.position.x, 0.05, mesh.position.z);
        this.burst(_v, ["#ffffff", "#e3f0fa"], { count: 1, speed: 0.4, up: 0.5, size: 0.05, life: 0.4, gravity: 2 });
      }
    });
    this.rolling.forEach((mesh, id) => {
      if (alive.has(id)) return;
      this.scene.remove(mesh);
      this.rolling.delete(id);
    });

    // Treffer, Blocks, Zusammenstösse.
    (state.bursts || []).forEach((b) => {
      const key = `${b.at}:${b.x.toFixed(2)}:${b.z.toFixed(2)}`;
      if (this.seenBursts.has(key)) return;
      this.seenBursts.add(key);
      const at = new THREE.Vector3(b.x, 0.3 + b.size * 0.3, b.z);
      const big = b.kind === "hit" || b.kind === "clash" || b.kind === "block";
      this.burst(at, ["#ffffff", "#e3f0fa", "#cfe3f5"], { count: big ? 22 : 8, speed: big ? 2.4 : 1.1, up: big ? 2.2 : 1, size: 0.08, life: big ? 0.9 : 0.5 });
      if (b.kind === "hit") {
        const thrower = this.kins.get(b.by);
        if (thrower) this.pop(thrower.position.clone().add(new THREE.Vector3(0, 1.15, 0)), `+${b.value}`, { color: b.value >= 3 ? "#ffe36b" : "#ffffff", size: 0.4 + b.value * 0.05 });
        const victim = this.kins.get(b.victim);
        if (victim) this.pop(victim.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "PLATSCH!", { color: "#bfe6ff", size: 0.32 });
        this.animators.get(b.by)?.trigger("fistpump");
        if (b.victim === controlledId) {
          this.rig.shake(0.5);
          this.feedback?.sound("impact");
          this.feedback?.vibrate([30, 20, 50]);
        } else if (b.by === controlledId) {
          this.feedback?.sound(b.value >= 3 ? "perfect" : "coin");
          this.feedback?.vibrate(14);
        }
      } else if (b.kind === "block" || b.kind === "clash") {
        if (b.by === controlledId) this.pop(at.clone().add(new THREE.Vector3(0, 0.8, 0)), "Geblockt!", { color: "#b8ffb0", size: 0.34 });
        this.feedback?.sound("collision");
      }
    });
    if (this.seenBursts.size > 200) this.seenBursts = new Set([...this.seenBursts].slice(-80));
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
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const text = String(own?.score || 0);
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;
    const chips = this.hud.querySelector("[data-snow-chips]");
    if (chips) {
      const html = room.players.map((player) => {
        const entry = arcade.players[player.id];
        return `<span class="hud-chip${player.id === controlledId ? " is-own" : ""}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>❄${entry?.score || 0}</span>`;
      }).join("");
      if (html !== this.chipsHtml) {
        this.chipsHtml = html;
        chips.innerHTML = html;
      }
    }
    const banner = this.hud.querySelector("[data-snow-banner]");
    const stunned = own && now < (own.stunUntil || 0);
    let message = null;
    let tone = "#12aaff";
    if (now < minigame.startedAt + 1600) message = "Roll deine Kugel gross!";
    else if (stunned) { message = "Umgehauen! ⭐"; tone = "#ff5d73"; }
    if (banner) {
      banner.hidden = !message || Boolean(minigame.finaleAt);
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
    }
    if (this.throwButton) {
      const size = own?.size ?? 0;
      const ready = size >= (state.throwMin ?? 0.4) && !stunned;
      this.throwButton.classList.toggle("is-ready", ready);
      this.throwButton.dataset.value = size >= 0.85 ? "3" : size >= 0.6 ? "2" : "1";
      this.throwButton.querySelector(".snow-meter i").style.width = `${Math.round(Math.min(1, size) * 100)}%`;
      this.throwButton.disabled = Boolean(minigame.finaleAt);
    }
  }
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
