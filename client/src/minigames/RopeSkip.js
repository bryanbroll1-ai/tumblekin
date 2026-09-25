import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createKin, KinAnimator, setKinOpacity, standOn } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Seilspringen: zwei drehen das Seil, alle anderen springen. Wer hängen
// bleibt, ist raus.
//
// Vorher standen die beiden Dreher reglos an den Enden, als drehe sich das
// Seil von allein, und die Springer warteten steif. Jetzt kurbeln die Dreher
// mit beiden Armen im Takt des Seils, die Springer wippen, schauen aufs Seil,
// erschrecken kurz bevor es kommt, und wer stolpert, setzt sich an den Rand.
const PIT_TOP = 0.07;
const KIN_Y = standOn(PIT_TOP);
const ROPE_R = 3.1;
const SPOTS = [-1.45, -0.48, 0.48, 1.45];
const TURNER_X = 2.45;
const JUMP_HEIGHT = 1.2;

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
    const meadow = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 18), new THREE.MeshLambertMaterial({ color: "#9dc45a" }));
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    dressMeadow(scene, { seed: 11, keepOut: { x: 4.8, z: 3.0 }, spread: { x: 17, z: 15 }, grassColor: "#9dc45a", patchColors: ["#a8cc63", "#c2da7e"], crownColor: "#6f9e3c", crownColor2: "#8ab34e", trunkColor: "#8a6a45", crownShape: "blob" });
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
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.07), new THREE.MeshLambertMaterial({ color: i % 5 === 0 ? "#ffffff" : "#e0334f" }));
      this.rope.add(seg);
      this.ropeSegments.push(seg);
    }
    this.rope.position.y = PIT_TOP + 0.62;
    scene.add(this.rope);

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

  shot() {
    return {
      look: [0, 0.85, 0],
      frame: { w: 4.9, h: 2.8 },
      yaw: 0.5,
      pitch: 0.2,
      fov: 36,
      intro: { yaw: 0.4, pitch: 0.2, zoom: 1.35 }
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
        // Reverse the swing direction on every third pass.
        const dir = Math.floor(i / 3) % 2 === 0 ? 1 : -1;
        this.ropeReversed = dir < 0;
        return t * Math.PI * 2 * dir;
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
    const swingRadius = this.rope.position.y - groundClear;
    const span = TURNER_X * 2 - 0.5;
    this.ropeSegments.forEach((seg, i) => {
      const t = i / (this.ropeSegments.length - 1);
      const x = -span / 2 + t * span;
      const sag = Math.sin(t * Math.PI);
      let localY = -swing * sag * swingRadius;
      if (this.rope.position.y + localY < groundClear) localY = groundClear - this.rope.position.y;
      seg.position.set(x, localY, depth * sag * ROPE_R * 0.38);
      seg.rotation.x = Math.atan2(depth, -swing);
    });
    // Die Dreher kurbeln im Takt des Seils.
    this.turners.forEach((animator, i) => {
      animator.set("crank", { params: { angle: angle * (i === 0 ? 1 : -1) } });
      animator.update(now);
    });

    let nextHitIn = null;
    (arcade.waves || []).forEach((wave) => {
      const untilHit = wave.hitAt - elapsed;
      if (untilHit > 0 && (nextHitIn === null || untilHit < nextHitIn)) nextHitIn = untilHit;
    });
    const ropeMid = new THREE.Vector3(0, this.rope.position.y - swing * swingRadius, depth * ROPE_R * 0.38);

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
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1, 0)), `${entry.survived}`, { color: "#ffe36b", size: 0.3, life: 0.6, rise: 0.6 });
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
    let nextHitIn = null;
    (arcade.waves || []).forEach((wave) => {
      const untilHit = wave.hitAt - elapsed;
      if (untilHit > 0 && (nextHitIn === null || untilHit < nextHitIn)) nextHitIn = untilHit;
    });
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.survived || 0);
    const banner = this.hud.querySelector("[data-rope-banner]");
    if (banner) {
      if (own?.eliminated) {
        banner.hidden = false;
        banner.textContent = "Gestolpert!";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      } else if (nextHitIn !== null && nextHitIn < 900) {
        banner.hidden = false;
        banner.textContent = "JETZT!";
        banner.style.background = "#e0334f";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.jumpButton) this.jumpButton.disabled = Boolean(own?.eliminated);
  }
}
