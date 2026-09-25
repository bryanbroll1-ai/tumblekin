import * as THREE from "/vendor/three/three.module.js";
import { createCloud, KIN_SOLE, setKinOpacity } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";

// Fassrolle — alle stehen auf einem Riesenfass über dem Fluss. Die Strömung
// dreht es mal so, mal so; mit ◀ oder ▶ läuft man dagegen an. Aber wer läuft,
// stösst das Fass mit den Füssen in die Gegenrichtung — und damit alle
// anderen. So rollt man sie ins Wasser, muss dann aber selbst mithalten.
// Gezählt wird die Zeit im grünen Streifen oben, wer abrutscht, platscht rein.
//
// Wer nicht läuft, balanciert mit ausgebreiteten Armen — je näher an der
// Kante, desto wackliger und ängstlicher. Laufen passt sich dem Tempo an.
const BARREL_R = 2.1;
const BARREL_CENTER_Y = 1.1;
const RUN_PING_MS = 90;
const WATER_Y = -1.15;
const TOP_Y = BARREL_CENTER_Y + BARREL_R;

export class BarrelRoll extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.smoothOffset = new Map();
    this.fell = new Map();
    this.lastServerAt = performance.now();
    this.holdDir = 0;
    this.holdTimer = null;
    this.localAngle = 0;
  }

  stage() {
    return {
      label: "3D Fassrolle",
      background: "#8fd8f2",
      fog: ["#9fdef5", 24, 60],
      lights: { sunPosition: [-5, 11, 7], hemiIntensity: 2.4, sunIntensity: 2.9, skyColor: 0xe6f6ff, groundColor: 0x5aa8c8 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0s</strong></div>
      <div class="simon-round barrel-spin" data-barrel-spin></div>
      <div class="color-banner" data-barrel-banner hidden></div>`;
  }

  build() {
    const water = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 30), new THREE.MeshLambertMaterial({ color: "#1f8fd6" }));
    water.position.y = WATER_Y - 0.25;
    water.receiveShadow = true;
    this.scene.add(water);
    this.waterMesh = water;
    // Hellere Strömungsstreifen auf dem Wasser.
    this.ripples = [];
    for (let i = 0; i < 9; i += 1) {
      const ripple = new THREE.Mesh(new THREE.BoxGeometry(1.6 + (i % 3), 0.02, 0.12), new THREE.MeshBasicMaterial({ color: "#8fd3ff", transparent: true, opacity: 0.5 }));
      ripple.position.set(-9 + i * 2.3, WATER_Y + 0.01, -6 + (i % 4) * 3.4);
      this.scene.add(ripple);
      this.ripples.push(ripple);
    }
    [-13, 13].forEach((x) => {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 90), new THREE.MeshLambertMaterial({ color: "#7fce6f" }));
      bank.position.set(x, WATER_Y + 0.3, 0);
      bank.receiveShadow = true;
      this.scene.add(bank);
    });
    dressMeadow(this.scene, {
      seed: 21, groundY: WATER_Y + 1.1, keepOut: { x: 6.4, z: 0 }, spread: { x: 19, z: 26 },
      treeRing: { x: 15, z: 22 }, frontCut: 7, trees: 26, patches: 22, tufts: 150, stones: 14,
      grassColor: "#67b95f", patchColors: ["#75c46b", "#8bd47f"], crownColor: "#4f9b4a", crownColor2: "#6cb45e", crownShape: "blob"
    });

    // Das Riesenfass mit Dauben, Deckeln und Ringen — die Streifen machen die
    // Drehung sichtbar.
    this.barrel = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: "#b07a3e" });
    const stripeMat = new THREE.MeshLambertMaterial({ color: "#8a5a2c" });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R, BARREL_R, 3.4, 16), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.barrel.add(body);
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 3.46), i % 2 === 0 ? stripeMat : bodyMat);
      plank.position.set(Math.sin(angle) * (BARREL_R + 0.02), Math.cos(angle) * (BARREL_R + 0.02), 0);
      plank.rotation.z = -angle;
      this.barrel.add(plank);
    }
    [-1.74, 1.74].forEach((z) => {
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R - 0.12, BARREL_R - 0.12, 0.1, 16), new THREE.MeshLambertMaterial({ color: "#6e4522" }));
      lid.rotation.x = Math.PI / 2;
      lid.position.z = z;
      this.barrel.add(lid);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.16), new THREE.MeshLambertMaterial({ color: "#546a86" }));
      hub.position.z = z;
      this.barrel.add(hub);
    });
    [-1.55, 1.55].forEach((z) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(BARREL_R + 0.05, 0.06, 6, 20), new THREE.MeshLambertMaterial({ color: "#546a86" }));
      ring.position.z = z;
      this.barrel.add(ring);
    });
    this.barrel.position.set(0, BARREL_CENTER_Y, 0);
    this.scene.add(this.barrel);

    // Die Punktezone hängt an der Welt, nicht am Fass: der Punktwert richtet
    // sich nach dem Abstand zum Scheitelpunkt, und der dreht nicht mit.
    const limit = this.minigame?.arcade?.limit || 1.7;
    const zoneAngle = (limit * 0.4) / BARREL_R;
    for (let i = -3; i <= 3; i += 1) {
      const angle = (i / 3) * zoneAngle;
      const near = 1 - Math.abs(i) / 3;
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.02, 3.3),
        new THREE.MeshBasicMaterial({ color: near > 0.6 ? "#c9ffdc" : "#5fe08a", transparent: true, opacity: 0.35 + near * 0.55, depthWrite: false, toneMapped: false })
      );
      // Flach auf den Dauben, nicht darüber schwebend: die Figuren liefen
      // sonst durch die Bänder hindurch.
      band.position.set(Math.sin(angle) * (BARREL_R + 0.08), BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.08), 0);
      band.rotation.z = -angle;
      this.scene.add(band);
    }
    // Rote Schienen genau am Absturzwinkel des Servers.
    const limitAngle = limit / BARREL_R;
    [-1, 1].forEach((sign) => {
      const angle = sign * limitAngle;
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 3.5),
        new THREE.MeshLambertMaterial({ color: "#ff2038", emissive: "#ff2038", emissiveIntensity: 0.9 })
      );
      rail.position.set(Math.sin(angle) * (BARREL_R + 0.12), BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.12), 0);
      rail.rotation.z = -angle;
      this.scene.add(rail);
    });
    this.limit = limit;

    [[-7, 6.4, -6, 5], [7, 7.2, -4, 6], [0, 7.8, -9, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    (this.getState()?.players || []).forEach((player, index) => {
      const kin = this.addKin(player, index, { x: 0, ground: TOP_Y, z: this.laneZ(index) });
      // Erst die Blickrichtung, dann die Neigung auf der Rundung — in der
      // Standardreihenfolge drehte die Kippachse mit, und wer seitwärts lief,
      // kippte nach vorn statt zur Seite.
      kin.rotation.order = "ZYX";
      this.shadows.get(player.id).userData.manual = true;
    });
  }

  shot() {
    // Dreiviertel von schräg oben: die Balance kippt in x und braucht Blick von
    // vorn, die Reihe steht in z und braucht Blick von der Seite.
    // Frontal und steil von oben. Frontal, weil ◀ und ▶ auf dem Bildschirm
    // links und rechts bedeuten müssen — die Laufrichtung auf dem Fass ist x.
    // Steil, weil die Reihe in z steht: von oben fächert sie sich im Bild
    // senkrecht auf, statt sich hintereinander zu verstecken.
    return {
      look: [0, TOP_Y - 0.1, 0.1],
      // Breit genug, dass auch am Rand der Rutschgrenze die ganze Figur im
      // Bild bleibt — dort entscheidet sich, ob man fällt.
      frame: { w: 4.5, h: 3.3 },
      yaw: 0.1,
      pitch: 1.02,
      fov: 38,
      intro: { yaw: -0.9, pitch: -0.45, zoom: 1.8 }
    };
  }

  laneZ(index) {
    return (index - 1.5) * 0.95;
  }

  // Rutschen alle zur selben Seite, zieht die Kamera ein Stück mit — sonst
  // hängen sie gerade dann am Bildrand, wenn es knapp wird.
  rigOptions(f) {
    const xs = f.players
      .map((player) => this.kins.get(player.id))
      .filter((kin) => kin && !kin.userData.outOfPlay)
      .map((kin) => kin.position.x);
    if (!xs.length || f.finale) return {};
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    return { look: [mid * 0.55, TOP_Y - 0.1, 0.1] };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="runner-lane-controls barrel-run-controls">
        <button type="button" data-barrel-run="-1" aria-label="Nach links laufen">◀</button>
        <button type="button" data-barrel-run="1" aria-label="Nach rechts laufen">▶</button>
      </div>`;
    this.controls.querySelectorAll("[data-barrel-run]").forEach((button) => {
      const dir = Number(button.dataset.barrelRun);
      this.on(button, "pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        this.setHold(dir);
        button.classList.add("is-holding");
      });
      const release = () => {
        button.classList.remove("is-holding");
        if (this.holdDir === dir) this.setHold(0);
      };
      this.on(button, "pointerup", release);
      this.on(button, "pointercancel", release);
      this.on(button, "lostpointercapture", release);
    });
  }

  unbind() {
    clearInterval(this.holdTimer);
    this.holdTimer = null;
  }

  setHold(dir) {
    this.holdDir = dir;
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    if (dir !== 0) {
      this.feedback?.vibrate(8);
      this.sendRun();
      this.holdTimer = setInterval(() => this.sendRun(), RUN_PING_MS);
    }
  }

  sendRun() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.fallenAt || this.holdDir === 0) {
      this.setHold(0);
      return;
    }
    const now = performance.now();
    if (now - (this.lastStep || 0) > 130) {
      this.lastStep = now;
      this.feedback?.sound("step", { pan: this.holdDir * 0.35 });
    }
    this.sendInput({ action: "run", dir: this.holdDir }).catch(() => {});
  }

  onUpdate() {
    this.lastServerAt = performance.now();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;

    // Die Serverdrehung mit dem aktuellen Tempo fortschreiben, damit das Fass
    // zwischen den Ticks gleichmässig rollt.
    const age = Math.min(0.25, (performance.now() - this.lastServerAt) / 1000);
    const targetAngle = (arcade.barrelAngle || 0) + (arcade.barrelVel || 0) * age;
    this.localAngle += (targetAngle - this.localAngle) * Math.min(1, dt * 10);
    this.barrel.rotation.z = -this.localAngle / BARREL_R;
    const speed = Math.abs(arcade.barrelVel || 0);

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const shadow = this.shadows.get(player.id);
      if (!entry || !kin || !animator) return;
      const fallen = Boolean(entry.fallenAt);
      const shown = (this.smoothOffset.get(player.id) ?? 0) + ((entry.offset || 0) - (this.smoothOffset.get(player.id) ?? 0)) * Math.min(1, dt * 9);
      this.smoothOffset.set(player.id, shown);
      const angle = shown / BARREL_R;

      if (fallen && !this.fell.has(player.id)) {
        this.fell.set(player.id, now);
        animator.trigger("tumble");
        const at = kin.position.clone();
        this.burst(at, ["#1f8fd6", "#bfe9ff", player.color], { count: 18, speed: 2.5, up: 2, size: 0.09, life: 0.8, drag: 1.5 });
        this.pop(at.clone().add(new THREE.Vector3(0, 1.1, 0)), "PLATSCH! 💦", { color: "#8fd8f2", size: 0.44, life: 1 });
        if (player.id === controlledId) {
          this.rig.shake(0.8);
          this.feedback?.sound("fall");
          this.feedback?.vibrate([28, 20, 36]);
          this.setHold(0);
        } else {
          this.feedback?.sound("land");
        }
      }

      kin.userData.outOfPlay = fallen;
      if (fallen) {
        // Die Rundung hinunter und in den Fluss.
        const since = (now - this.fell.get(player.id)) / 1000;
        const fallAngle = Math.sign(shown || 1) * Math.min(2.2, Math.abs(angle) + since * 2.4);
        kin.position.x = Math.sin(fallAngle) * (BARREL_R + 0.35);
        const ground = Math.max(WATER_Y - 1.2, BARREL_CENTER_Y + Math.cos(fallAngle) * BARREL_R - since * 2.2);
        this.setGround(player.id, ground);
        kin.rotation.z = -fallAngle * 0.6;
        const depth = Math.max(0, WATER_Y + 0.2 - ground);
        setKinOpacity(kin, Math.max(0, 1 - depth * 1.3));
        kin.visible = ground > WATER_Y - 1.1;
        if (kin.userData.label) kin.userData.label.visible = false;
        shadow.visible = false;
        if (!kin.visible && !this.fell.get(`${player.id}:splash`)) {
          this.fell.set(`${player.id}:splash`, true);
          this.bursts.ring(new THREE.Vector3(kin.position.x, WATER_Y + 0.05, kin.position.z), "#bfe9ff", { radius: 1.6, life: 0.6, y: WATER_Y + 0.05 });
        }
        return;
      }

      kin.visible = true;
      setKinOpacity(kin, 1);
      // Auf den Dauben (sie liegen 0.07 über dem Fasskörper), und zwar entlang
      // der Senkrechten des Stamms: die Figur neigt sich mit der Rundung, also
      // muss auch ihre Mitte dort sitzen, wohin die Neigung zeigt. Vorher
      // stand sie waagrecht versetzt — am Rand schwebte ein Fuss, der andere
      // steckte im Holz.
      const reach = BARREL_R + 0.07 + KIN_SOLE;
      kin.position.x = Math.sin(angle) * reach;
      kin.position.z = this.laneZ(index);
      this.setGround(player.id, BARREL_CENTER_Y + Math.cos(angle) * reach - KIN_SOLE);
      kin.rotation.z = -angle;
      shadow.visible = true;
      shadow.position.set(kin.position.x, BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.03), kin.position.z);
      shadow.rotation.z = -angle;

      if (finale) {
        kin.rotation.y += (0 - kin.rotation.y) * Math.min(1, dt * 6);
        return;
      }
      const holding = now - (entry.lastRunAt || 0) <= 260;
      const edge = Math.min(1, Math.abs(shown) / this.limit);
      if (holding) {
        animator.set("run");
        // Wo gelaufen wird, spritzt es hinter dem Fass: man sieht, wer schiebt.
        if (Math.random() < Math.min(1, dt * 9)) {
          const side = entry.runDir < 0 ? 1 : -1;
          this.burst(new THREE.Vector3(side * (BARREL_R + 0.3), WATER_Y + 0.15, kin.position.z), ["#bfe9ff", "#ffffff", player.color], { count: 2, speed: 1.4, up: 1.6, size: 0.07, life: 0.5, drag: 1.4 });
        }
        // Gegen ein schnelles Fass muss man schneller trippeln.
        animator.rate = 0.9 + speed * 0.35;
        const face = (entry.runDir < 0 ? -1 : 1) * Math.PI / 2;
        kin.rotation.y += (face - kin.rotation.y) * Math.min(1, dt * 12);
      } else {
        animator.set("balance", { params: { wobble: 0.6 + edge * 1.6 } });
        animator.rate = 1;
        kin.rotation.y += (0 - kin.rotation.y) * Math.min(1, dt * 8);
        if (edge > 0.7) animator.expression("scared", 200);
      }
    });

    this.waterMesh.position.y = WATER_Y - 0.25 + Math.sin(now / 900) * 0.05;
    this.ripples.forEach((ripple, i) => {
      ripple.position.x += dt * (0.4 + (i % 3) * 0.2);
      if (ripple.position.x > 12) ripple.position.x = -12;
    });
  }

  drawHud(f) {
    const own = f.arcade?.players?.[f.controlledId];
    const spin = this.hud.querySelector("[data-barrel-spin]");
    if (spin) {
      const vel = f.arcade?.barrelVel || 0;
      const count = Math.min(3, Math.round(Math.abs(vel) / 0.7));
      spin.textContent = count === 0 ? "Fass ruhig" : `Fass rollt ${vel < 0 ? "◀".repeat(count) : "▶".repeat(count)}`;
      spin.classList.toggle("hot", count >= 3);
    }
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    // Die Zahl, nach der gewertet wird: Zeit mittig auf dem Fass.
    this.scoreNode.textContent = `${(own?.balanceWork || 0).toFixed(1)}s`;
    const banner = this.hud.querySelector("[data-barrel-banner]");
    if (own?.fallenAt) {
      banner.hidden = false;
      banner.textContent = "Ins Wasser gerollt!";
      banner.style.background = "#1f8fd6";
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }
  }
}
