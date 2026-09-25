import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createKin, KinAnimator, KIN_SOLE } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Lichtwächter: Halten heisst Laufen — aber nur bei Grün. Wer sich bei Rot
// bewegt, wird erwischt und muss ein Stück zurück.
//
// Vorher liefen die Figuren im Leerlauf-Schritt, standen bei Rot einfach da,
// und der Wächter drehte sich nur. Jetzt sprinten sie bei Grün, erstarren bei
// Rot mitten in der Bewegung und zittern, wer erwischt wird, fliegt zurück
// und ist benommen. Der Riese dreht sich bei Rot mit finsterem Blick um und
// schaut bei Grün demonstrativ weg.
const LANE_GAP = 1.28;
const START_Z = 5.2;
const TRACK_LEN = 19;
const LAWN_TOP_Y = 0;
const GUARD_SCALE = 3.4;
const TRACK_TOP_Y = 0.05;
const RUN_PING_MS = 90;

export class RedLightGate extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lastCaught = new Map();
    this.lastFinished = new Map();
    this.smoothProgress = new Map();
    this.caughtAt = new Map();
    this.holdTimer = null;
    this.holding = false;
    this.lastPhaseKind = null;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Lichtwächter",
      background: "#a8e2f4",
      fog: ["#a8e2f4", 22, 50],
      lights: { sunPosition: [-5, 12, 6], shadow: { left: -12, right: 12, top: 16, bottom: -16 }, sunIntensity: 2.9, skyColor: 0xe6f6ff, groundColor: 0x76b8a8 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0m</strong></div>
      <div class="color-banner" data-light-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const lawn = new THREE.Mesh(
      new THREE.BoxGeometry(16, 0.5, TRACK_LEN + 14),
      new THREE.MeshLambertMaterial({ color: "#57cd63" })
    );
    lawn.position.set(0, -0.25, START_Z - (TRACK_LEN + 2) / 2);
    lawn.receiveShadow = true;
    scene.add(lawn);
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 0.54, TRACK_LEN + 4),
      new THREE.MeshLambertMaterial({ color: "#f7e3a8" })
    );
    track.position.set(0, -0.22, START_Z - TRACK_LEN / 2);
    track.receiveShadow = true;
    scene.add(track);

    // Distance stripes so movement reads clearly.
    for (let i = 0; i <= 6; i += 1) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(7.4, 0.06, 0.16),
        new THREE.MeshLambertMaterial({ color: "#e6c96f" })
      );
      stripe.position.set(0, 0.08, START_Z - (i / 6) * TRACK_LEN);
      scene.add(stripe);
    }
    [[-4.6, "#3fae4e"], [4.6, "#3fae4e"]].forEach(([x, color]) => {
      for (let i = 0; i < 6; i += 1) {
        const hedge = new THREE.Mesh(
          new THREE.BoxGeometry(0.9, 0.9 + (i % 2) * 0.3, 1.6),
          new THREE.MeshLambertMaterial({ color })
        );
        hedge.position.set(x, 0.45, START_Z - 1.5 - i * 3.4);
        hedge.castShadow = true;
        scene.add(hedge);
      }
    });

    // The finish gate + giant guard.
    const gateZ = START_Z - TRACK_LEN - 1.2;
    const gateMat = new THREE.MeshLambertMaterial({ color: "#ffb400" });
    [[-3.4, 0], [3.4, 0]].forEach(([x]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), gateMat);
      post.position.set(x, 1.7, gateZ);
      post.castShadow = true;
      scene.add(post);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 0.5), gateMat);
    beam.position.set(0, 3.4, gateZ);
    scene.add(beam);

    // Der Riese stand einen ganzen Meter über der Wiese. Der Sohlenabstand
    // skaliert mit der Figur mit — bei Faktor 3.4 sind das gut ein Meter, und
    // genau um den lag er daneben.
    this.guard = createKin("#7a4ddb", 3);
    this.guard.scale.setScalar(GUARD_SCALE);
    const guardY = LAWN_TOP_Y + KIN_SOLE * GUARD_SCALE;
    this.guard.position.set(0, guardY, gateZ - 2.2);
    scene.add(this.guard);
    this.guardAnimator = new KinAnimator(this.guard);
    this.guardAnimator.groundY = guardY;

    // The big signal lamp above the guard.
    this.lampMat = new THREE.MeshLambertMaterial({ color: "#2ee86a", emissive: new THREE.Color("#2ee86a"), emissiveIntensity: 0.9 });
    const lampBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), this.lampMat);
    lampBox.position.set(0, 5, gateZ - 2.2);
    scene.add(lampBox);
    const lampPole = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 1.4, 0.24),
      new THREE.MeshLambertMaterial({ color: "#40506a" })
    );
    lampPole.position.set(0, 4.1, gateZ - 2.2);
    scene.add(lampPole);

    [[-7, 6, -6, 5], [7, 7, -12, 6], [-6, 7, -16, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    this.gateZ = gateZ;
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      this.addKin(player, index, { x: this.laneX(index), ground: TRACK_TOP_Y, z: START_Z, facing: Math.PI });
    });
  }

  laneX(index) {
    return (index - 1.5) * LANE_GAP;
  }

  progressZ(progress, goal) {
    return START_Z - (Math.max(0, progress) / Math.max(1, goal)) * TRACK_LEN;
  }

  shot() {
    return {
      look: [0, 1.1, START_Z - 2.5],
      frame: { w: 5.6, h: 3.6 },
      yaw: 0.14,
      pitch: 0.3,
      fov: 40,
      intro: { yaw: 0.3, pitch: 0.2, zoom: 1.4 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="hold-button" data-hold-run>
        <span class="hold-button-face">HALTEN = LAUFEN</span>
      </button>`;
    this.holdButton = this.controls.querySelector("[data-hold-run]");
    this.on(this.holdButton, "pointerdown", (event) => {
      event.preventDefault();
      this.holdButton.setPointerCapture?.(event.pointerId);
      this.setHolding(true);
    });
    const up = () => this.setHolding(false);
    this.on(this.holdButton, "pointerup", up);
    this.on(this.holdButton, "pointercancel", up);
    this.on(this.holdButton, "lostpointercapture", up);
  }

  unbind() {
    clearInterval(this.holdTimer);
    this.holdTimer = null;
  }

  setHolding(active) {
    if (this.holding === active) return;
    this.holding = active;
    this.holdButton?.classList.toggle("is-holding", active);
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    if (active) {
      this.feedback?.vibrate(8);
      this.sendRun();
      this.holdTimer = setInterval(() => this.sendRun(), RUN_PING_MS);
    }
  }

  sendRun() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.finishedAt) {
      this.setHolding(false);
      return;
    }
    // Schritte. Laufen war lautlos, obwohl es die einzige Handlung des Spiels
    // ist — und gerade hier zählt das Gefühl, weil man beim Halten und Loslassen
    // nichts sieht ausser der eigenen Figur.
    const jetzt = performance.now();
    if (jetzt - (this.letzterSchritt || 0) > 150) {
      this.letzterSchritt = jetzt;
      this.feedback?.sound("step");
    }
    this.sendInput({ action: "run" }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    const phaseKind = arcade.phaseKind || "green";
    const isGreen = phaseKind === "green";
    if (phaseKind !== this.lastPhaseKind) {
      if (this.lastPhaseKind !== null) {
        this.feedback?.sound(isGreen ? "pop" : "impact");
        this.feedback?.vibrate(isGreen ? 10 : [26, 18, 26]);
        if (!isGreen) this.rig.shake(0.45);
      }
      this.lastPhaseKind = phaseKind;
    }
    const lampColor = isGreen ? "#2ee86a" : "#ff2038";
    this.lampMat.color.set(lampColor);
    this.lampMat.emissive.set(lampColor);
    this.lampMat.emissiveIntensity = 0.7 + Math.abs(Math.sin(now / 160)) * 0.5;
    // Der Wächter: bei Grün abgewandt, bei Rot zu den Läufern, finster.
    const guardTarget = isGreen ? Math.PI : 0;
    this.guard.rotation.y += (guardTarget - this.guard.rotation.y) * frameLerp(0.3, dt);
    if (isGreen) {
      this.guardAnimator.set("think");
    } else {
      this.guardAnimator.set("focus");
      this.guardAnimator.expression("angry", 200);
    }
    this.guardAnimator.update(now);

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const finished = Boolean(entry.finishedAt);
      const shown = THREE.MathUtils.lerp(this.smoothProgress.get(player.id) ?? 0, entry.progress || 0, Math.min(1, dt * 7));
      this.smoothProgress.set(player.id, shown);
      const moving = (entry.progress || 0) - shown > 0.05;
      kin.position.x = this.laneX(index);
      kin.position.z = finished ? THREE.MathUtils.lerp(kin.position.z, this.gateZ - 0.6, frameLerp(0.08, dt)) : this.progressZ(shown, arcade.goal);

      if ((entry.caught || 0) > (this.lastCaught.get(player.id) || 0)) {
        this.lastCaught.set(player.id, entry.caught);
        this.caughtAt.set(player.id, now);
        animator.trigger("knockback");
        animator.expression("dizzy", 1400);
        this.guardAnimator.trigger("punch");
        this.guardAnimator.expression("smug", 900);
        this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.4, 0)), ["#ff2038", "#ffffff"], { count: 12, speed: 2.1, up: 1.6, size: 0.08, life: 0.6, drag: 1.6 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "ERWISCHT!", { color: "#ff6b7f", size: 0.4, life: 0.9 });
        if (isOwn) {
          this.rig.shake(0.8);
          this.feedback?.sound("error");
          this.feedback?.vibrate([20, 16, 30]);
        }
      }
      if (finished && !this.lastFinished.get(player.id)) {
        this.lastFinished.set(player.id, true);
        animator.trigger("celebrate");
        this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.5, 0)), [player.color, "#ffc400", "#ffffff"], { count: 20, speed: 2.6, up: 2.6, size: 0.09, life: 0.85, drag: 1.2 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "GESCHAFFT! 🏁", { color: "#ffe36b", size: 0.44, life: 1.2, rise: 1 });
        if (isOwn) {
          this.feedback?.sound("win");
          this.feedback?.vibrate([24, 24, 48]);
          this.setHolding(false);
        }
      }
      if (finale) return;
      if (finished) {
        kin.rotation.y += Math.atan2(Math.sin(0.3 - kin.rotation.y), Math.cos(0.3 - kin.rotation.y)) * frameLerp(0.1, dt);
        animator.set("happy");
        return;
      }
      kin.rotation.y = Math.PI;
      animator.lookAt(isGreen ? null : this.guard.position.clone().setY(3));
      if (now - (this.caughtAt.get(player.id) || -1e9) < 1400) animator.set("dizzy");
      else if (moving) {
        animator.set("sprint");
        animator.rate = 0.8;
      } else if (!isGreen) {
        // Erstarrt — und zittert.
        animator.set("freeze");
        animator.expression("scared", 200);
      } else {
        animator.set("ready");
      }
    });
  }

  // Die Kamera folgt der eigenen Figur von hinten; wer weit vorn oder hinten
  // ist, darf aus dem Bild.
  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    if (!own) return [...this.kins.values()];
    return [...this.kins.values()].filter((kin) => Math.abs(kin.position.z - own.position.z) < 2.5);
  }

  rigOptions(f) {
    const own = this.kins.get(f.controlledId);
    if (!own || f.finale) return {};
    return { look: [own.position.x * 0.3, 1.1, own.position.z - 2.5] };
  }

  drawHud(f) {
    const { arcade, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const isGreen = (arcade.phaseKind || "green") === "green";
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = `${Math.round(own?.progress || 0)}m`;
    const banner = this.hud.querySelector("[data-light-banner]");
    if (banner) {
      banner.hidden = false;
      if (own?.finishedAt) {
        banner.textContent = "Im Ziel!";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if (isGreen) {
        banner.textContent = "GRÜN – LAUF!";
        banner.style.background = "#2ee86a";
        banner.style.color = "#0c3a1c";
      } else {
        banner.textContent = "ROT – STOPP!";
        banner.style.background = "#ff2038";
        banner.style.color = "#ffffff";
      }
    }
    if (this.holdButton) this.holdButton.disabled = Boolean(own?.finishedAt);
  }
}
