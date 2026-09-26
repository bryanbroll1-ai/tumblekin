import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createKin, KinAnimator, setKinOpacity, standOn } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { baeume, kiste, lambert, viele, streuer, schild } from "./Kulisse.js?v=tumblekin200";

// Seilspringen: zwei drehen das Seil, alle anderen springen. Wer hängen
// bleibt, ist raus.
//
// Vorher standen die beiden Dreher reglos an den Enden, als drehe sich das
// Seil von allein, und die Springer warteten steif. Jetzt kurbeln die Dreher
// mit beiden Armen im Takt des Seils, die Springer wippen, schauen aufs Seil,
// erschrecken kurz bevor es kommt, und wer stolpert, setzt sich an den Rand.
const PIT_TOP = 0.07;
const KIN_Y = standOn(PIT_TOP);
// So weit schwingt das Seil um die Achse zwischen den Händen: oben über die
// Köpfe, unten schleift es über den Sand.
//
// Vorher 0.82 mit einem Bogen sin(πt), der zu den Enden hin schnell flach
// wurde: an den äusseren Springern schwang das Seil nur noch mit ~0.48 und
// ging oben auf gut einem Meter genau durch die Köpfe. Jetzt ein breiter
// Bogen (Wurzel des Sinus), der über fast die ganze Länge voll ausschwingt.
const ROPE_SWING = 1.12;
const ROPE_PROFILE = 0.5;
const SPOTS = [-1.35, -0.45, 0.45, 1.35];
const TURNER_X = 2.6;
const JUMP_HEIGHT = 1.15;
const GHOSTS = [0.22, 0.44];    // Nachzieh-Schatten, so weit hinter dem Seil (rad)

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export class RopeSkip extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lastEliminated = new Map();
    this.lastSurvived = new Map();
    this.localJumpUntil = 0;
    this.labelY = 0.74;
  }

  stage() {
    return { label: "3D Seilspringen", background: "#a8e2f4", fog: ["#a8e2f4", 16, 40] };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-rope-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 18), new THREE.MeshLambertMaterial({ color: "#9aa0a8" }));
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    dressMeadow(scene, { seed: 11, keepOut: { x: 4.8, z: 3.0 }, spread: { x: 17, z: 15 }, patches: 18, tufts: 60, flowers: 10, stones: 12, grassColor: "#8ab34e", patchColors: ["#a3a9b1", "#8f959d"], crownColor: "#6f9e3c", crownColor2: "#8ab34e", trunkColor: "#8a6a45", crownShape: "blob" });
    this.buildSchoolyard(scene);
    const pit = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.34, 2.4), new THREE.MeshLambertMaterial({ color: "#ffe6a3" }));
    pit.position.set(0, PIT_TOP - 0.17, 0);
    pit.receiveShadow = true;
    scene.add(pit);

    // Die beiden Dreher an den Enden, einander zugewandt.
    this.turners = [[-TURNER_X, "#ff8b2e", 4], [TURNER_X, "#2ec4b6", 5]].map(([x, color, variant]) => {
      const turner = createKin(color, variant);
      turner.position.set(x, KIN_Y, 0);
      turner.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      scene.add(turner);
      const animator = new KinAnimator(turner);
      animator.groundY = KIN_Y;
      return animator;
    });

    this.rope = new THREE.Group();
    this.ropeSegments = [];
    for (let i = 0; i <= 30; i += 1) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.09), new THREE.MeshLambertMaterial({ color: i % 5 === 0 ? "#ffffff" : "#e0334f", emissive: "#e0334f", emissiveIntensity: 0.15 }));
      this.rope.add(seg);
      this.ropeSegments.push(seg);
    }
    scene.add(this.rope);
    // Nachzieh-Schatten: zeigen Bogen und Drehrichtung auf einen Blick.
    this.ghosts = GHOSTS.map((lag, g) => {
      const material = new THREE.MeshBasicMaterial({ color: "#ff8a9c", transparent: true, opacity: g === 0 ? 0.32 : 0.14, depthWrite: false });
      const segments = [];
      for (let i = 0; i <= 30; i += 1) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.07), material);
        scene.add(seg);
        segments.push(seg);
      }
      return { lag, segments };
    });
    // Der Schatten des Seils auf dem Sand: er wandert auf die Füsse zu und
    // wird dunkler, je tiefer das Seil kommt — JETZT springen.
    this.ropeShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(TURNER_X * 2 - 0.6, 0.16),
      new THREE.MeshBasicMaterial({ color: "#7a3a1a", transparent: true, opacity: 0.2, depthWrite: false })
    );
    this.ropeShadow.rotation.x = -Math.PI / 2;
    this.ropeShadow.position.y = PIT_TOP + 0.005;
    scene.add(this.ropeShadow);

    [[-6, 5.2, -4, 5], [6, 6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = SPOTS[index % SPOTS.length];
      const kin = this.addKin(player, index, { x, ground: PIT_TOP, z: 0, facing: 0.35 });
      kin.userData.spotX = x;
    });
  }

  // Ein Schulhof: Asphalt, dahinter das Schulhaus mit Fensterreihen, Uhr und
  // Schild, links ein Basketballkorb, rechts Bank und Fahrradständer, vorn
  // ein Hüpfkästchen und Kreidebilder, dazu ein liegengebliebener Ball.
  // Die Kamera schaut schräg (yaw 0.85) herein; `ort(u, v)` setzt Dinge
  // relativ zum Bild: u nach rechts, v in die Tiefe.
  buildSchoolyard(scene) {
    const zufall = streuer(38);
    const yaw = 0.85;
    const rechts = [Math.cos(yaw), -Math.sin(yaw)];
    const tiefe = [-Math.sin(yaw), -Math.cos(yaw)];
    const ort = (u, v) => [rechts[0] * u + tiefe[0] * v, rechts[1] * u + tiefe[1] * v];

    // Schulhaus.
    const schule = new THREE.Group();
    const [sx, sz] = ort(0.5, 10);
    schule.position.set(sx, 0, sz);
    schule.rotation.y = yaw;
    scene.add(schule);
    kiste(schule, 12, 5, 3, "#e9b872", [0, 2.5, 0]);
    kiste(schule, 12.4, 0.35, 3.4, "#b8573a", [0, 5.15, 0]);
    kiste(schule, 12, 0.18, 0.1, "#d9a35e", [0, 2.55, 1.52], { schatten: false });
    const fenster = [];
    const rahmen = [];
    for (let reihe = 0; reihe < 2; reihe += 1) {
      for (let i = -5; i <= 5; i += 1) {
        if (reihe === 0 && Math.abs(i) < 1) continue;
        fenster.push({ p: [i * 1.05, 1.35 + reihe * 2.3, 1.52], s: [0.72, 1.1, 1] });
        rahmen.push({ p: [i * 1.05, 1.35 + reihe * 2.3, 1.515], s: [0.86, 1.24, 1] });
      }
    }
    viele(schule, new THREE.PlaneGeometry(1, 1), lambert("#f6f3ec"), rahmen);
    viele(schule, new THREE.PlaneGeometry(1, 1), lambert("#8fc6e8"), fenster);
    kiste(schule, 1.5, 2.0, 0.1, "#2f6fb0", [0, 1.0, 1.52]);
    const uhr = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), lambert("#ffffff"));
    uhr.position.set(0, 3.7, 1.53);
    schule.add(uhr);
    const zeiger = [[0.04, 0.3, 0.12, 0], [0.04, 0.22, 0.08, 1.9]];
    zeiger.forEach(([w, h, dy, dreh]) => {
      const z = kiste(schule, w, h, 0.02, "#2c2f38", [Math.sin(dreh) * dy, 3.7 + Math.cos(dreh) * dy, 1.55], { schatten: false });
      z.rotation.z = -dreh;
    });
    const tafel = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.62), new THREE.MeshBasicMaterial({ map: schild("SCHULE", { grund: "#2f6fb0", groesse: 64 }) }));
    tafel.position.set(0, 4.55, 1.53);
    schule.add(tafel);

    // Basketballkorb links.
    const korb = new THREE.Group();
    const [kx, kz] = ort(-4.2, 3.2);
    korb.position.set(kx, 0, kz);
    korb.rotation.y = yaw + 0.7;
    scene.add(korb);
    kiste(korb, 0.12, 3.0, 0.12, "#555a63", [0, 1.5, 0]);
    kiste(korb, 1.2, 0.8, 0.06, "#f6f3ec", [0, 3.1, 0.2]);
    kiste(korb, 0.45, 0.35, 0.07, "#e0453b", [0, 2.95, 0.21], { schatten: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 16), lambert("#ff7a1a"));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 2.78, 0.48);
    korb.add(ring);

    // Bank und Fahrradständer rechts hinten.
    const bank = new THREE.Group();
    const [bx, bz] = ort(3.6, 3.4);
    bank.position.set(bx, 0, bz);
    bank.rotation.y = yaw;
    scene.add(bank);
    kiste(bank, 1.8, 0.08, 0.45, "#b07a3e", [0, 0.45, 0]);
    kiste(bank, 1.8, 0.35, 0.06, "#b07a3e", [0, 0.72, -0.22]);
    [-0.75, 0.75].forEach((x) => kiste(bank, 0.08, 0.45, 0.4, "#555a63", [x, 0.22, 0]));
    const staender = new THREE.Group();
    const [fx, fz] = ort(2.4, 6.4);
    staender.position.set(fx, 0, fz);
    staender.rotation.y = yaw;
    scene.add(staender);
    const buegel = [];
    for (let i = 0; i < 5; i += 1) buegel.push({ p: [(i - 2) * 0.5, 0.35, 0], r: [0, Math.PI / 2, 0] });
    viele(staender, new THREE.TorusGeometry(0.3, 0.03, 6, 12, Math.PI), lambert("#9aa3ad"), buegel);
    [[-0.5, "#e0453b"], [0.5, "#28c7d9"]].forEach(([x, farbe]) => {
      const rad = new THREE.TorusGeometry(0.26, 0.035, 6, 14);
      [-0.38, 0.38].forEach((dz) => {
        const r = new THREE.Mesh(rad, lambert("#2c2f38"));
        r.rotation.y = Math.PI / 2;
        r.position.set(x, 0.28, dz);
        staender.add(r);
      });
      kiste(staender, 0.05, 0.05, 0.8, farbe, [x, 0.5, 0], { schatten: false });
      kiste(staender, 0.05, 0.3, 0.05, farbe, [x, 0.62, -0.25], { schatten: false });
    });

    // Hüpfkästchen und Kreidebilder vorn.
    const kreide = lambert("#f6f3ec");
    const huepf = new THREE.Group();
    const [hx, hz] = ort(-0.9, -3.1);
    huepf.position.set(hx, 0.02, hz);
    huepf.rotation.y = yaw + Math.PI / 2;
    scene.add(huepf);
    const felder = [[0, 0], [0.62, 0], [1.24, -0.3], [1.24, 0.3], [1.86, 0], [2.48, -0.3], [2.48, 0.3], [3.1, 0]];
    viele(huepf, new THREE.PlaneGeometry(0.56, 0.56), kreide, felder.map(([x, z]) => ({ p: [x, 0, z], r: [-Math.PI / 2, 0, 0] })));
    viele(huepf, new THREE.PlaneGeometry(0.48, 0.48), lambert("#9aa0a8"), felder.map(([x, z]) => ({ p: [x, 0.002, z], r: [-Math.PI / 2, 0, 0] })));
    const sonne = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), lambert("#ffd15c"));
    sonne.rotation.x = -Math.PI / 2;
    const [ox, oz] = ort(1.5, -1.9);
    sonne.position.set(ox, 0.02, oz);
    scene.add(sonne);
    const strahlen = [];
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      strahlen.push({ p: [ox + Math.cos(a) * 0.5, 0.021, oz + Math.sin(a) * 0.5], r: [-Math.PI / 2, 0, a], s: [0.26, 0.05, 1] });
    }
    viele(scene, new THREE.PlaneGeometry(1, 1), lambert("#ffd15c"), strahlen);
    const kritzel = [];
    ["#ff8fb1", "#28c7d9", "#71d97b"].forEach((farbe) => {
      const punkte = [];
      for (let i = 0; i < 6; i += 1) {
        const [px, pz] = ort(-3.8 + zufall() * 7.5, -1.8 - zufall() * 2.4);
        punkte.push({ p: [px, 0.02, pz], r: [-Math.PI / 2, 0, zufall() * 3], s: [0.3 + zufall() * 0.3, 0.05, 1] });
      }
      kritzel.push(viele(scene, new THREE.PlaneGeometry(1, 1), lambert(farbe), punkte));
    });

    // Ein Ball.
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), lambert("#e0453b"));
    const [ballX, ballZ] = ort(-2.5, 1.0);
    ball.position.set(ballX, 0.2, ballZ);
    ball.castShadow = true;
    scene.add(ball);

    // Zwei Bäume am Schulhaus.
    baeume(scene, [ort(-5.5, 7.6), ort(6.2, 7.4)].map(([x, z]) => [x, z, 2.6]));
  }

  shot() {
    // Schräg von der Seite: so sieht man den Seilbogen als Bogen — wie er
    // oben über die Köpfe und vorn auf die Füsse zu kommt. Frontal war er eine
    // Linie, die auf- und abwippte, und die Szene hing klein oben im Bild.
    return {
      look: [0, 0.75, 0.1],
      frame: { w: 4.3, h: 3.0 },
      yaw: 0.85,
      pitch: 0.24,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="jump-button" data-rope-jump>
        <span class="jump-button-face">SPRUNG</span>
      </button>`;
    this.jumpButton = this.controls.querySelector("[data-rope-jump]");
    const press = (event) => {
      event.preventDefault();
      this.pressJump();
    };
    this.on(this.jumpButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  pressJump() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.eliminated) return;
    const nowT = this.now();
    if (nowT < Math.max(own.jumpUntil || 0, this.localJumpUntil)) return;
    this.localJumpUntil = nowT + (arcade?.jumpMs || 650);
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "jump" }).catch(() => {});
  }

  ropeAngle(arcade, elapsed) {
    const waves = arcade.waves || [];
    let previous = 0;
    for (let i = 0; i < waves.length; i += 1) {
      const wave = waves[i];
      if (elapsed < wave.hitAt) {
        const span = wave.hitAt - previous;
        const t = span > 0 ? (elapsed - previous) / span : 0;
        // Immer dieselbe Richtung: oben über die Köpfe, VORN herunter auf die
        // Füsse zu, hinten wieder hoch. Früher kehrte es alle drei Durchgänge
        // um und kam dann von hinten — genau da, wo weder Figur noch Spieler
        // hinschauen.
        return t * Math.PI * 2;
      }
      previous = wave.hitAt;
    }
    return 0;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const angle = this.ropeAngle(arcade, elapsed);
    const swing = Math.cos(angle);
    const depth = Math.sin(angle);
    const groundClear = PIT_TOP + 0.03;
    // Die Dreher kurbeln im Takt des Seils — und das Seil hängt an ihren
    // HÄNDEN. Vorher lagen die Seilenden fest auf Kopfhöhe neben den Drehern,
    // und es sah aus, als hielten sie es mit der Stirn.
    const ends = this.turners.map((animator, i) => {
      animator.set("crank", { params: { angle: angle * (i === 0 ? 1 : -1) } });
      animator.update(now);
      const turner = animator.kin;
      turner.updateMatrixWorld(true);
      const [a, b] = turner.userData.arms;
      const left = a.localToWorld(new THREE.Vector3(0, -0.17, 0));
      const right = b.localToWorld(new THREE.Vector3(0, -0.17, 0));
      return left.add(right).multiplyScalar(0.5);
    });
    const [endL, endR] = ends;
    const axisY = (endL.y + endR.y) / 2;
    const swingRadius = ROPE_SWING;
    const place = (segments, a) => {
      const sw = Math.cos(a);
      const dp = -Math.sin(a);   // vorn (zur Kamera) herunter
      segments.forEach((seg, i) => {
        const t = i / (segments.length - 1);
        const sag = Math.pow(Math.sin(t * Math.PI), ROPE_PROFILE);
        const x = THREE.MathUtils.lerp(endL.x, endR.x, t);
        let y = THREE.MathUtils.lerp(endL.y, endR.y, t) - sw * sag * swingRadius;
        const z = THREE.MathUtils.lerp(endL.z, endR.z, t) + dp * sag * swingRadius;
        // Unten schleift es über den Boden, statt hindurchzugehen.
        if (y < groundClear) y = groundClear;
        seg.position.set(x, y, z);
        seg.rotation.x = Math.atan2(dp, -sw);
      });
    };
    place(this.ropeSegments, angle);
    this.ghosts.forEach((ghost) => place(ghost.segments, angle - ghost.lag));
    // Schatten: liegt unter dem Seil, dunkler, je tiefer es hängt.
    const low = clamp01((swing + 0.2) / 1.2);
    this.ropeShadow.position.z = -depth * swingRadius;
    this.ropeShadow.material.opacity = 0.08 + low * low * 0.45;
    // Rhythmus: Wusch oben, Klack am Boden — man hört den Takt mit.
    const phase = (angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    if (this.lastPhase !== undefined) {
      if (this.lastPhase < Math.PI && phase >= Math.PI) this.feedback?.sound("swish");
      if (this.lastPhase > phase + 1) this.feedback?.sound("clack");
    }
    this.lastPhase = phase;
    let nextHitIn = null;
    (arcade.waves || []).forEach((wave) => {
      const untilHit = wave.hitAt - elapsed;
      if (untilHit > 0 && (nextHitIn === null || untilHit < nextHitIn)) nextHitIn = untilHit;
    });
    const ropeMid = new THREE.Vector3(0, Math.max(groundClear, axisY - swing * swingRadius), -depth * swingRadius);

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const out = Boolean(entry.eliminated);
      const jumpUntil = isOwn ? Math.max(entry.jumpUntil || 0, this.localJumpUntil) : (entry.jumpUntil || 0);
      const jumpStart = jumpUntil - arcade.jumpMs;
      const jumping = !out && now >= jumpStart && now < jumpUntil;
      let y = KIN_Y;
      if (jumping) {
        const t = (now - jumpStart) / arcade.jumpMs;
        y += Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) * JUMP_HEIGHT;
        if (!kin.userData.inAir) animator.trigger("jump");
      }
      kin.userData.inAir = jumping;

      if (out && !this.lastEliminated.get(player.id)) {
        this.lastEliminated.set(player.id, true);
        animator.trigger("fall");
        animator.expression("dizzy", 1500);
        this.burst(kin.position.clone(), ["#e0334f", player.color, "#ffffff"], { count: 14, speed: 2.4, up: 2, size: 0.09, life: 0.8, drag: 1.4 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1 + (index % 4) * 0.3, 0)), "RAUS!", { color: "#ff6b7f", size: 0.42 });
        if (isOwn) {
          this.rig.shake(0.9);
          this.feedback?.sound("error");
          this.feedback?.vibrate([26, 20, 34]);
        }
      }
      if (!out && (entry.survived || 0) > (this.lastSurvived.get(player.id) || 0)) {
        this.lastSurvived.set(player.id, entry.survived);
        // Die Wellenzahl nur über der eigenen Figur — vier Zahlen je Welle
        // waren ein Flackern, das niemand lesen konnte.
        if (isOwn) this.pop(kin.position.clone().add(new THREE.Vector3(0, 1, 0)), `${entry.survived}`, { color: "#ffe36b", size: 0.3, life: 0.6, rise: 0.6 });
        if (isOwn) {
          this.feedback?.sound("pop", { pan: kin.position.x * 0.18 });
          this.feedback?.vibrate(8);
        }
      }
      if (out) {
        // Hinter der Grube sitzen und zuschauen — vorn säße man zu dicht
        // vor der Kamera.
        setKinOpacity(kin, 0.8);
        kin.position.x += (kin.userData.spotX - kin.position.x) * frameLerp(0.2, dt);
        kin.position.z += (-1.55 - kin.position.z) * frameLerp(0.06, dt);
        animator.groundY = standOn(0);
        if (!finale) animator.set("sit");
        return;
      }
      setKinOpacity(kin, 1);
      kin.position.x += (kin.userData.spotX - kin.position.x) * frameLerp(0.2, dt);
      kin.position.z += (0 - kin.position.z) * frameLerp(0.2, dt);
      animator.groundY = y;
      if (finale) return;
      animator.lookAt(ropeMid);
      if (!jumping) {
        animator.set("ready");
        if (nextHitIn !== null && nextHitIn < 380) animator.expression("scared", 120);
      }
    });
  }

  keepInView(f) {
    return f.players.map((player) => this.kins.get(player.id)).filter(Boolean);
  }

  drawHud(f) {
    const { arcade, minigame, now, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const elapsed = Math.max(0, now - minigame.startedAt);
    // Nur ein Doppelschlag wird angesagt — der bricht den Takt. Das frühere
    // "JETZT!" vor JEDEM Durchgang hat den Sprung vorgesagt, und schneller als
    // eine Sekunde stand es dauernd da.
    const upcoming = (arcade.waves || []).find((wave) => wave.hitAt > elapsed);
    const doubleSoon = Boolean(upcoming?.double) && upcoming.hitAt - elapsed < 1400;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.survived || 0);
    const banner = this.hud.querySelector("[data-rope-banner]");
    if (banner) {
      if (own?.eliminated) {
        banner.hidden = false;
        banner.textContent = "Gestolpert!";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      } else if (doubleSoon) {
        banner.hidden = false;
        banner.textContent = "DOPPELT! ×2";
        banner.style.background = "#e0334f";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.jumpButton) this.jumpButton.disabled = Boolean(own?.eliminated);
  }
}
