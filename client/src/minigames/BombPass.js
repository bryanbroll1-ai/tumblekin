import * as THREE from "/vendor/three/three.module.js";
import { setKinOpacity, flashKin } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Zündstoff — heisse Kartoffel mit einer Bombe. Die Zündzeit blinkt kurz auf,
// dann heisst es: merken und rechtzeitig weitergeben. Wer sie beim Knall hält,
// ist raus; wer übrig bleibt, gewinnt.
//
// Die Runde steht im Halbkreis hinter dem Lagerfeuer, alle Gesichter zur
// Kamera — im vollen Kreis zeigten die vorderen beiden nur den Rücken. Alle
// schauen der Bombe hinterher; der Träger hält sie über dem Kopf und wird mit
// jeder Sekunde panischer. Weitergeben ist ein Wurf im Bogen.
const ARC_R = 2.15;
const PASS_MS = 380;

export class BombPass extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.spots = new Map();
    this.out = new Map();
    this.lastHolderId = null;
    this.lastExplosions = 0;
    this.flight = null;
  }

  stage() {
    // Nacht, aber mondhell: die Spielerfarben müssen erkennbar bleiben. Im
    // ersten Anlauf färbte das Licht Rot zu Marineblau und Gelb zu Orange.
    return {
      label: "3D Zündstoff",
      background: "#241f3d",
      fog: ["#3a2f4e", 26, 62],
      lights: {
        sunPosition: [-4, 12, 6], hemiIntensity: 2.2, sunIntensity: 1.9,
        skyColor: 0xc8cff5, groundColor: 0x7a6252, sunColor: 0xdfe4ff, fillColor: 0xb3a8ec, fillIntensity: 0.6,
        shadow: { left: -6, right: 6, top: 6, bottom: -6 }
      }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-bomb-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    this.fireLight = new THREE.PointLight(0xff8a3a, 5, 14, 2);
    this.fireLight.position.set(0, 0.9, 0.6);
    scene.add(this.fireLight);

    const ground = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 34), new THREE.MeshLambertMaterial({ color: "#6d5038" }));
    ground.position.set(0, -0.25, -6);
    ground.receiveShadow = true;
    scene.add(ground);
    const plateau = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 0.5, 10), new THREE.MeshLambertMaterial({ color: "#8a6644" }));
    plateau.position.y = 0.05;
    plateau.receiveShadow = true;
    scene.add(plateau);
    // Sitzsteine und Holzklötze um den Platz.
    // Nur hinten und an den Seiten — vorn stünden sie groß vor der Linse.
    for (let i = 0; i < 7; i += 1) {
      const angle = Math.PI * 0.92 + (i / 6) * Math.PI * 1.16;
      const stone = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.28 + (i % 3) * 0.1, 0.42),
        new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? "#6a5242" : "#7c6048" })
      );
      stone.position.set(Math.cos(angle) * 3.35, 0.35, Math.sin(angle) * 3.35);
      stone.rotation.y = angle;
      stone.castShadow = true;
      scene.add(stone);
    }

    // Feuerstelle vorn in der Mitte.
    this.fire = new THREE.Group();
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const pebble = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), new THREE.MeshLambertMaterial({ color: "#4c3b30" }));
      pebble.position.set(Math.cos(angle) * 0.5, 0.36, Math.sin(angle) * 0.5);
      pebble.rotation.y = angle;
      this.fire.add(pebble);
    }
    [-0.5, 0.5].forEach((turn) => {
      const log = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.14), new THREE.MeshLambertMaterial({ color: "#43312a" }));
      log.position.y = 0.38;
      log.rotation.y = turn;
      this.fire.add(log);
    });
    this.flames = [0, 1, 2].map((i) => {
      const flame = new THREE.Mesh(
        new THREE.BoxGeometry(0.26 - i * 0.06, 0.3 - i * 0.06, 0.26 - i * 0.06),
        new THREE.MeshBasicMaterial({ color: i === 0 ? "#ff7a24" : i === 1 ? "#ffb03a" : "#ffe58a" })
      );
      flame.position.y = 0.56 + i * 0.2;
      this.fire.add(flame);
      return flame;
    });
    this.fire.position.set(0, 0, 0.6);
    scene.add(this.fire);

    // Abendhimmel mit Rest der Sonne am Horizont und Sternen oben.
    const sky = document.createElement("canvas");
    sky.width = 4;
    sky.height = 256;
    const pen = sky.getContext("2d");
    const gradient = pen.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#171430");
    gradient.addColorStop(0.35, "#221c40");
    gradient.addColorStop(0.5, "#46295a");
    gradient.addColorStop(0.6, "#a8475a");
    gradient.addColorStop(0.7, "#e98a45");
    gradient.addColorStop(1, "#ffd8a4");
    pen.fillStyle = gradient;
    pen.fillRect(0, 0, 4, 256);
    const texture = new THREE.CanvasTexture(sky);
    texture.colorSpace = THREE.SRGBColorSpace;
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(120, 44), new THREE.MeshBasicMaterial({ map: texture, fog: false, depthWrite: false }));
    backdrop.position.set(0, 8, -34);
    scene.add(backdrop);
    const stars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: "#ffeed2", fog: false }), 44);
    const helper = new THREE.Object3D();
    for (let i = 0; i < 44; i += 1) {
      helper.position.set(((i * 97) % 57) - 28, 5 + ((i * 53) % 11) * 0.55, -30);
      helper.scale.setScalar(0.6 + ((i * 17) % 5) * 0.4);
      helper.updateMatrix();
      stars.setMatrixAt(i, helper.matrix);
    }
    stars.instanceMatrix.needsUpdate = true;
    scene.add(stars);
    for (let i = 0; i < 18; i += 1) {
      const height = 1.6 + ((i * 7) % 5) * 0.7;
      const crag = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, height, 3),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? "#241c33" : "#1c162a", fog: false })
      );
      crag.position.set(-27 + i * 3.2, height / 2 - 0.6, -24 - ((i * 5) % 3));
      scene.add(crag);
    }

    this.buildBomb();

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const spot = this.spotFor(index, players.length);
      this.spots.set(player.id, spot);
      this.addKin(player, index, { x: spot.x, ground: 0.3, z: spot.z, facing: spot.facing });
    });
  }

  buildBomb() {
    this.bomb = new THREE.Group();
    const body = new THREE.MeshLambertMaterial({ color: "#31405a" });
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), body);
    core.castShadow = true;
    this.bomb.add(core);
    [[0.26, 0, 0], [-0.26, 0, 0], [0, 0, 0.26], [0, 0, -0.26], [0, -0.26, 0]].forEach(([x, y, z]) => {
      const bulge = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.24), new THREE.MeshLambertMaterial({ color: "#3d4e6b" }));
      bulge.position.set(x, y, z);
      this.bomb.add(bulge);
    });
    const fuse = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.07), new THREE.MeshLambertMaterial({ color: "#c9a86a" }));
    fuse.position.y = 0.38;
    this.bomb.add(fuse);
    this.spark = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ff8b2e", emissiveIntensity: 1.2 }));
    this.spark.position.y = 0.56;
    this.bomb.add(this.spark);
    this.sparkLight = new THREE.PointLight(0xffb04a, 2.8, 4, 2);
    this.sparkLight.position.y = 0.6;
    this.bomb.add(this.sparkLight);

    // Die Zündzeit über der Bombe: kurz sichtbar, dann ein "?".
    this.timerCanvas = document.createElement("canvas");
    this.timerCanvas.width = 128;
    this.timerCanvas.height = 128;
    this.timerCtx = this.timerCanvas.getContext("2d");
    this.timerTex = new THREE.CanvasTexture(this.timerCanvas);
    this.timerTex.colorSpace = THREE.SRGBColorSpace;
    this.timerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.timerTex, transparent: true, depthTest: false }));
    this.timerSprite.scale.set(0.72, 0.72, 0.72);
    this.timerSprite.position.y = 0.95;
    this.timerSprite.renderOrder = 998;
    this.bomb.add(this.timerSprite);
    this.timerLast = null;
    this.scene.add(this.bomb);
  }

  // Halbkreis hinter dem Feuer, alle zur Kamera gedreht, leicht zur Mitte.
  spotFor(index, count) {
    const spread = count <= 2 ? 0.9 : 1.9;
    const t = count <= 1 ? 0.5 : index / (count - 1);
    const angle = -Math.PI / 2 + (t - 0.5) * spread * 1.2;
    const x = Math.cos(angle) * ARC_R;
    const z = Math.sin(angle) * ARC_R * 0.7 + 0.1;
    return { x, z, facing: Math.atan2(-x * 0.35, 1) };
  }

  shot() {
    return {
      look: [0, 0.95, -0.35],
      frame: { w: 4.7, h: 2.7 },
      pitch: 0.36,
      fov: 36,
      intro: { yaw: 0.7, pitch: 0.35, zoom: 1.6 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="bomb-button" data-bomb-pass>
        <span class="bomb-button-face">WEITERGEBEN</span>
      </button>`;
    this.passButton = this.controls.querySelector("[data-bomb-pass]");
    const press = (event) => {
      event.preventDefault();
      this.pressPass();
    };
    this.on(this.passButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  pressPass() {
    const arcade = (this.update || this.minigame)?.arcade;
    const id = this.getControlledPlayerId();
    const own = arcade?.players?.[id];
    if (!own || own.outAt || arcade.holderId !== id) return;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(12);
    this.animators.get(id)?.trigger("throw");
    this.sendInput({ action: "pass" }).catch(() => {});
  }

  bombRest(kin) {
    // Über dem Kopf des Trägers.
    return new THREE.Vector3(kin.position.x, kin.position.y + 0.95, kin.position.z + 0.05);
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;

    if ((arcade.explosions || 0) > this.lastExplosions) {
      this.lastExplosions = arcade.explosions;
      this.rig.shake(1);
      this.feedback?.sound("impact");
      this.feedback?.vibrate([34, 24, 40]);
    }

    // Wechsel des Trägers: der alte wirft, die Bombe fliegt im Bogen.
    if (this.lastHolderId !== arcade.holderId) {
      const fromKin = this.kins.get(this.lastHolderId);
      if (fromKin && arcade.holderId) {
        this.flight = { from: this.bomb.position.clone(), to: arcade.holderId, start: now };
        if (this.lastHolderId !== controlledId) this.animators.get(this.lastHolderId)?.trigger("throw");
      }
      if (this.lastHolderId !== null && arcade.holderId === controlledId) {
        this.feedback?.sound("impact");
        this.feedback?.vibrate([16, 12, 20]);
      }
      this.animators.get(arcade.holderId)?.trigger("catch");
      this.lastHolderId = arcade.holderId;
    }

    const holderKin = this.kins.get(arcade.holderId);
    const heldFor = Math.max(0, now - (arcade.holderSince || now)) / 1000;
    const nervous = Math.min(1, heldFor / 6);
    if (holderKin && !finale) {
      this.bomb.visible = true;
      const rest = this.bombRest(holderKin);
      rest.x += Math.sin(now / (90 - nervous * 40)) * nervous * 0.06;
      if (this.flight && this.flight.to === arcade.holderId && now - this.flight.start < PASS_MS) {
        const u = (now - this.flight.start) / PASS_MS;
        this.bomb.position.lerpVectors(this.flight.from, rest, u);
        this.bomb.position.y += Math.sin(u * Math.PI) * 1.1;
        this.bomb.rotation.x = u * Math.PI * 2;
      } else {
        this.flight = null;
        this.bomb.position.lerp(rest, frameLerp(0.5, dt));
        this.bomb.rotation.x = 0;
      }
      this.bomb.rotation.y = now / 700;
    } else {
      this.bomb.visible = false;
    }

    // Zündzeit: kurz die Sekunden, dann "?".
    const revealing = arcade.revealUntil && now < arcade.revealUntil;
    const secs = Math.max(0, Math.ceil((arcade.fuseAt - now) / 1000));
    const text = revealing ? `${secs}s` : "?";
    if (text !== this.timerLast) {
      this.timerLast = text;
      const c = this.timerCtx;
      c.clearRect(0, 0, 128, 128);
      c.fillStyle = revealing ? "rgba(255,32,56,0.92)" : "rgba(20,28,38,0.86)";
      c.beginPath();
      c.arc(64, 64, 56, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 6;
      c.strokeStyle = "#ffffff";
      c.stroke();
      c.fillStyle = "#ffffff";
      c.font = `900 ${revealing ? 46 : 62}px ui-rounded, system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(text, 64, 70);
      this.timerTex.needsUpdate = true;
    }
    this.spark.material.emissiveIntensity = 0.7 + Math.abs(Math.sin(now / (150 - nervous * 90))) * (0.8 + nervous);
    if (this.bomb.visible && Math.random() < frameChance(0.3, dt)) {
      this.burst(this.bomb.position.clone().add(new THREE.Vector3(0, 0.55, 0)), ["#ffd15c", "#ff8b2e"], { count: 1, speed: 0.5, up: 0.6, size: 0.04, life: 0.3 });
    }

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const spot = this.spots.get(player.id);
      if (!entry || !kin || !animator || !spot) return;
      const out = Boolean(entry.outAt);
      const isHolder = arcade.holderId === player.id;

      if (out && !this.out.has(player.id)) {
        this.out.set(player.id, now);
        animator.trigger("knockback");
        const at = kin.position.clone().add(new THREE.Vector3(0, 0.6, 0));
        this.burst(at, ["#ff8b2e", "#ffd15c", "#1b2530", "#ffffff"], { count: 30, speed: 3.4, up: 2.8, size: 0.1, life: 0.9, drag: 1.3 });
        this.bursts.ring(kin.position.clone().setY(0.34), "#ff8b2e", { radius: 2.4, life: 0.6, opacity: 0.6, y: 0.34 });
        this.pop(at.clone().add(new THREE.Vector3(0, 0.8, 0)), "BUMM! 💥", { color: "#ff8b2e", size: 0.5, life: 1 });
        if (player.id === controlledId) {
          this.feedback?.sound("error");
          this.feedback?.vibrate([30, 24, 40]);
        }
      }

      if (out) {
        // Verrußt nach hinten geschleudert, dort sitzt man benommen weiter
        // im Bild und schaut zu.
        const since = (now - this.out.get(player.id)) / 1000;
        flashKin(kin, "#000000", 0);
        kin.userData.material.color.setScalar(Math.max(0.5, 1 - since * 0.8));
        setKinOpacity(kin, 0.7);
        kin.position.x += (spot.x * 0.92 - kin.position.x) * frameLerp(0.06, dt);
        kin.position.z += (spot.z - 1.15 - kin.position.z) * frameLerp(0.06, dt);
        kin.rotation.y = spot.facing;
        if (!finale) {
          animator.set(since < 1.4 ? "dizzy" : "sit");
          if (since > 1.4) animator.expression("dizzy", 300);
        }
        animator.lookAt(this.bomb.visible && since > 1.4 ? this.bomb.position : null);
        return;
      }

      kin.position.x += (spot.x - kin.position.x) * frameLerp(0.15, dt);
      kin.rotation.y = spot.facing;
      // Alle schauen der Bombe hinterher.
      animator.lookAt(this.bomb.visible && !isHolder ? this.bomb.position : null);
      if (finale) return;
      if (isHolder) {
        animator.set(nervous > 0.55 ? "panic" : "carry");
        if (nervous > 0.3) animator.expression("scared", 200);
        kin.position.x = spot.x + Math.sin(now / 90) * 0.04 * nervous;
      } else {
        animator.set("focus");
      }
    });

    const flicker = Math.sin(now / 190) * 0.5 + Math.sin(now / 77) * 0.3;
    this.fireLight.intensity = 5 + flicker * 1.2;
    this.sparkLight.intensity = 2.8 + Math.sin(now / 55) * 0.8;
    this.flames.forEach((flame, i) => {
      flame.scale.setScalar(1 + Math.sin(now / (150 + i * 40)) * 0.16);
      flame.rotation.y = now / (900 + i * 300);
    });
  }

  drawHud(f) {
    const { arcade, minigame, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.passes || 0);
    const banner = this.hud.querySelector("[data-bomb-banner]");
    const isHolder = arcade.holderId === controlledId && !own?.outAt;
    if (own?.outAt) {
      banner.hidden = false;
      banner.textContent = "BOOM – raus!";
      banner.style.background = "#40506a";
      banner.style.color = "#ffffff";
    } else if (isHolder) {
      banner.hidden = false;
      banner.textContent = "DU hast die Bombe!";
      banner.style.background = "#ff2038";
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }
    this.passButton.disabled = !isHolder || Boolean(minigame.finaleAt);
  }
}
