import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  setKinOpacity
} from "./VoxelKit.js?v=tumblekin122";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin122";
import { frameChance, frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin122";

// Zündstoff — hot-potato with a blocky bomb. The fuse length is secret:
// tap to pass the bomb on before it blows. Whoever holds it when it pops
// is out; the last Kin standing wins.
const RING_R = 2.3;
const KIN_Y = 0.62;

export class BombPass {
  constructor({ canvas, controls, sendInput, now, getState, getControlledPlayerId, myPlayerId, feedback }) {
    this.canvas = canvas;
    this.controls = controls;
    this.sendInput = sendInput;
    this.now = now;
    this.getState = getState;
    this.getControlledPlayerId = getControlledPlayerId || (() => myPlayerId);
    this.feedback = feedback;
    this.minigame = null;
    this.update = null;
    this.frame = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.webglCanvas = null;
    this.hud = null;
    this.kins = new Map();
    this.animators = new Map();
    this.lastOut = new Map();
    this.lastHolderId = null;
    this.lastExplosions = 0;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.finaleDone = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Zündstoff", background: "#241f3d", fog: ["#3a2f4e", 26, 62] });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-bomb-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="bomb-button" data-bomb-pass>
        <span class="bomb-button-face">WEITERGEBEN</span>
      </button>
    `;
    this.passButton = this.controls.querySelector("[data-bomb-pass]");
    this.onPassDown = (event) => {
      event.preventDefault();
      this.pressPass();
    };
    this.passButton.addEventListener("pointerdown", this.onPassDown);
    this.loop();
  }

  pressPass() {
    const arcade = (this.update || this.minigame)?.arcade;
    const controlledId = this.getControlledPlayerId();
    const own = arcade?.players?.[controlledId];
    if (!own || own.outAt || arcade.holderId !== controlledId) return;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(12);
    this.sendInput({ action: "pass" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
  }

  createScene() {
    // Nachtlager statt Mittagswüste. Die Szene stand vorher in prallem
    // Orange: heller Sandboden, oranger Himmel, orange Tafelberge — auf dem
    // Bild war kein Horizont zu erkennen, und der nächste Tafelberg stand so
    // gross im Bild, dass er wie ein schwebender Klotz wirkte. Ein Spiel, in
    // dem eine brennende Lunte herumgereicht wird, gehört ohnehin in die
    // Nacht: dunkler Himmel gegen warmes Feuer trennt jede Silhouette, und
    // die Lunte ist endlich das hellste Ding im Bild.
    addStageLights(this.scene, {
      sunPosition: [-6, 12, -3],
      hemiIntensity: 1.5,
      sunIntensity: 1.5,
      skyColor: 0x8089c8,
      groundColor: 0x4a3730,
      sunColor: 0xc3cdff,
      fillColor: 0x9a8ede,
      fillIntensity: 0.5
    });

    // Das Lagerfeuer ist die eigentliche Lichtquelle: warm, mittig, flackernd.
    this.fireLight = new THREE.PointLight(0xff8a3a, 6, 16, 2);
    this.fireLight.position.set(0, 0.9, 0);
    this.scene.add(this.fireLight);

    // Wüstenboden bei Nacht — dunkel genug, dass das Feuer darauf arbeitet.
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.5, 34),
      new THREE.MeshLambertMaterial({ color: "#6d5038" })
    );
    ground.position.set(0, -0.25, -6);
    ground.receiveShadow = true;
    this.scene.add(ground);
    const plateau = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.9, 0.5, 8),
      new THREE.MeshLambertMaterial({ color: "#8a6644" })
    );
    plateau.position.y = 0.05;
    plateau.receiveShadow = true;
    this.scene.add(plateau);
    // Stone markers around the circle.
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const stone = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.3 + (i % 3) * 0.12, 0.4),
        new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? "#584435" : "#6b5340" })
      );
      stone.position.set(Math.cos(angle) * 3.3, 0.35, Math.sin(angle) * 3.3);
      stone.rotation.y = angle;
      stone.castShadow = true;
      this.scene.add(stone);
    }

    // Feuerstelle in der Kreismitte: Steinring, gekreuzte Scheite, Flamme.
    this.fire = new THREE.Group();
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * Math.PI * 2;
      const kiesel = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.18, 0.24),
        new THREE.MeshLambertMaterial({ color: "#4c3b30" })
      );
      kiesel.position.set(Math.cos(angle) * 0.55, 0.09, Math.sin(angle) * 0.55);
      kiesel.rotation.y = angle;
      this.fire.add(kiesel);
    }
    [-0.5, 0.5].forEach((drehung) => {
      const scheit = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.16, 0.16),
        new THREE.MeshLambertMaterial({ color: "#43312a" })
      );
      scheit.position.y = 0.14;
      scheit.rotation.y = drehung;
      this.fire.add(scheit);
    });
    this.flammen = [0, 1, 2].map((i) => {
      const flamme = new THREE.Mesh(
        new THREE.BoxGeometry(0.26 - i * 0.06, 0.3 - i * 0.06, 0.26 - i * 0.06),
        new THREE.MeshBasicMaterial({ color: i === 0 ? "#ff7a24" : i === 1 ? "#ffb03a" : "#ffe58a" })
      );
      flamme.position.y = 0.32 + i * 0.2;
      this.fire.add(flamme);
      return flamme;
    });
    this.scene.add(this.fire);

    // Abendhimmel als Verlauf hinter allem. Ohne ihn war der erste Versuch
    // gleichmässig dunkel: die Felswand verschwand im Himmel, weil beide fast
    // dieselbe Farbe hatten. Der warme Rest der Sonne unten am Horizont gibt
    // der Wand etwas, wovor sie schwarz stehen kann.
    const himmelBild = document.createElement("canvas");
    himmelBild.width = 4;
    himmelBild.height = 256;
    const stift = himmelBild.getContext("2d");
    // Der Verlauf ist auf den schmalen Streifen gerechnet, der im Hochformat
    // über dem Bodenrand überhaupt sichtbar ist: das sind nur rund neun
    // Welteinheiten Höhe. Liegt das Abendrot höher, sieht man im Bild nur
    // Nachtblau — genau das war der erste Versuch.
    const verlauf = stift.createLinearGradient(0, 0, 0, 256);
    verlauf.addColorStop(0, "#171430");
    verlauf.addColorStop(0.3, "#1d1a38");
    verlauf.addColorStop(0.43, "#3a2551");
    verlauf.addColorStop(0.53, "#9c4450");
    verlauf.addColorStop(0.61, "#e0803c");
    verlauf.addColorStop(0.7, "#ffb268");
    verlauf.addColorStop(1, "#ffd8a4");
    stift.fillStyle = verlauf;
    stift.fillRect(0, 0, 4, 256);
    const himmelTex = new THREE.CanvasTexture(himmelBild);
    himmelTex.colorSpace = THREE.SRGBColorSpace;
    const himmel = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 44),
      new THREE.MeshBasicMaterial({ map: himmelTex, fog: false, depthWrite: false })
    );
    himmel.position.set(0, 8, -34);
    this.scene.add(himmel);

    // Sterne im oberen, dunklen Teil des Verlaufs.
    const sterne = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial({ color: "#ffeed2", fog: false }),
      40
    );
    const platz = new THREE.Object3D();
    for (let i = 0; i < 40; i += 1) {
      // Fester Streuer: das Sternbild soll bei jedem Start dasselbe sein.
      platz.position.set(((i * 97) % 53) - 26, 4.6 + ((i * 53) % 11) * 0.5, -30);
      platz.scale.setScalar(0.6 + ((i * 17) % 5) * 0.4);
      platz.updateMatrix();
      sterne.setMatrixAt(i, platz.matrix);
    }
    sterne.instanceMatrix.needsUpdate = true;
    this.scene.add(sterne);

    // Canyonwand als Silhouette weit hinten. Weit genug weg, dass sie Kulisse
    // bleibt: vorher stand der nächste Klotz bei z = -6 mitten im Bild. Und
    // flach genug, dass über ihr noch Himmel steht.
    const wand = new THREE.Group();
    for (let i = 0; i < 18; i += 1) {
      const hoehe = 1.6 + ((i * 7) % 5) * 0.7;
      const zacke = new THREE.Mesh(
        new THREE.BoxGeometry(3.4, hoehe, 3),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? "#241c33" : "#1c162a", fog: false })
      );
      zacke.position.set(-27 + i * 3.2, hoehe / 2 - 0.6, -24 - ((i * 5) % 3));
      wand.add(zacke);
    }
    this.scene.add(wand);

    // The bomb: black voxel ball, fuse stub, spark.
    this.bomb = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      // Nicht mehr fast schwarz: in der Nachtszene wäre die Bombe sonst ein
      // Loch im Bild statt der Hauptfigur.
      new THREE.MeshLambertMaterial({ color: "#31405a" })
    );
    core.castShadow = true;
    this.bomb.add(core);
    [[0.28, 0, 0], [-0.28, 0, 0], [0, 0, 0.28], [0, 0, -0.28], [0, -0.28, 0]].forEach(([x, y, z]) => {
      const bulge = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.32, 0.26),
        new THREE.MeshLambertMaterial({ color: "#3d4e6b" })
      );
      bulge.position.set(x, y, z);
      this.bomb.add(bulge);
    });
    const fuse = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.3, 0.08),
      new THREE.MeshLambertMaterial({ color: "#c9a86a" })
    );
    fuse.position.y = 0.42;
    this.bomb.add(fuse);
    this.spark = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.16),
      new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#ff8b2e", emissiveIntensity: 1.2 })
    );
    this.spark.position.y = 0.62;
    this.bomb.add(this.spark);
    // Die Lunte leuchtet den Träger an. In der Nacht ist das nicht nur hübsch:
    // man sieht auf einen Blick, wer die Bombe hat, ohne den Namen zu lesen.
    this.sparkLight = new THREE.PointLight(0xffb04a, 3.2, 4.5, 2);
    this.sparkLight.position.y = 0.7;
    this.bomb.add(this.sparkLight);

    // A floating timer plate above the bomb: shows the fuse seconds for a
    // moment after each pass, then hides behind a "?" so you must remember it.
    this.timerCanvas = document.createElement("canvas");
    this.timerCanvas.width = 128;
    this.timerCanvas.height = 128;
    this.timerCtx = this.timerCanvas.getContext("2d");
    this.timerTex = new THREE.CanvasTexture(this.timerCanvas);
    this.timerTex.colorSpace = THREE.SRGBColorSpace;
    this.timerSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.timerTex, transparent: true, depthTest: false }));
    this.timerSprite.scale.set(0.9, 0.9, 0.9);
    this.timerSprite.position.y = 0.95;
    this.timerLast = null;
    this.bomb.add(this.timerSprite);
    this.scene.add(this.bomb);

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    this.camera.position.set(0, 4.6, 7.8);
    this.camera.lookAt(0, 0.8, 0);
  }

  spotFor(index, count) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2 + Math.PI / 4;
    return { x: Math.cos(angle) * RING_R, z: Math.sin(angle) * RING_R };
  }

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const count = this.getState()?.players?.length || 4;
    const spot = this.spotFor(index, count);
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    kin.userData.spot = spot;
    kin.position.set(spot.x, KIN_Y, spot.z);
    // Face the middle of the circle.
    kin.rotation.y = Math.atan2(-spot.x, -spot.z);
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_Y;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);
    return kin;
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    const arcade = minigame?.arcade;
    if (!minigame || !state || !arcade || !this.renderer) return;
    this.resizeRenderer();

    const now = this.now();
    const frameNow = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (frameNow - this.lastFrameAt) / 1000));
    this.lastFrameAt = frameNow;
    const controlledId = this.getControlledPlayerId();

    // Explosion moment: the previous holder just went out.
    if ((arcade.explosions || 0) > this.lastExplosions) {
      this.lastExplosions = arcade.explosions;
      this.shake = 1;
      this.feedback?.sound("impact");
      this.feedback?.vibrate([34, 24, 40]);
    }

    // Bomb hovers over the current holder and gets twitchier over time.
    const holderKin = this.kins.get(arcade.holderId);
    const heldFor = Math.max(0, now - (arcade.holderSince || now)) / 1000;
    const nervous = Math.min(1, heldFor / 6);
    if (holderKin) {
      const targetPos = new THREE.Vector3(
        holderKin.position.x + Math.sin(now / (90 - nervous * 40)) * nervous * 0.08,
        holderKin.position.y + 1.35 + Math.sin(now / 260) * 0.06,
        holderKin.position.z + Math.cos(now / (110 - nervous * 40)) * nervous * 0.08
      );
      this.bomb.position.lerp(targetPos, Math.min(1, dt * 9));
      this.bomb.rotation.y = now / 700;
      this.bomb.visible = true;
    } else {
      this.bomb.visible = false;
    }
    // Timer plate: reveal the whole-second fuse briefly, then a "?".
    const revealing = arcade.revealUntil && now < arcade.revealUntil;
    const secsLeft = Math.max(0, Math.ceil((arcade.fuseAt - now) / 1000));
    const text = revealing ? `${secsLeft}s` : "?";
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
      c.font = `bold ${revealing ? 44 : 60}px 'Trebuchet MS', sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(text, 64, 70);
      this.timerTex.needsUpdate = true;
    }
    // Only reveal-phase counting needs a per-frame refresh.
    if (revealing) this.timerLast = null;

    // Spark flickers faster the longer the bomb is held.
    this.spark.material.emissiveIntensity = 0.7 + Math.abs(Math.sin(now / (150 - nervous * 90))) * (0.8 + nervous);
    if (Math.random() < frameChance(0.25, dt)) {
      this.bursts.spawn(this.bomb.position.clone().add(new THREE.Vector3(0, 0.35, 0)), ["#ffd15c", "#ff8b2e"], { count: 1, speed: 0.5, up: 0.5, size: 0.04, life: 0.3 });
    }

    if (this.lastHolderId !== arcade.holderId) {
      if (this.lastHolderId !== null && arcade.holderId === controlledId) {
        this.feedback?.sound("impact");
        this.feedback?.vibrate([16, 12, 20]);
      }
      this.lastHolderId = arcade.holderId;
    }

    let survivorKin = null;
    let survivorPlayer = null;
    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const out = Boolean(entry.outAt);
      const isHolder = arcade.holderId === player.id;

      if (out && !this.lastOut.get(player.id)) {
        this.lastOut.set(player.id, true);
        animator.trigger("fall");
        this.bursts.spawn(kin.position.clone().add(new THREE.Vector3(0, 0.6, 0)), ["#ff8b2e", "#ffd15c", "#1b2530", "#ffffff"], { count: 28, speed: 3.2, up: 2.6, size: 0.1, life: 0.9, drag: 1.3 });
        this.bursts.ring(kin.position.clone().setY(0.08), "#ff8b2e", { radius: 2.2, life: 0.6, opacity: 0.6 });
        this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "BUMM! 💥", { color: "#ff8b2e", size: 0.46, life: 1 });
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 1);
          this.feedback?.sound("error");
          this.feedback?.vibrate([30, 24, 40]);
        }
      }

      if (out) {
        // Scorched and sitting out at the edge of the circle.
        setKinOpacity(kin, 0.35);
        const spot = kin.userData.spot;
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, spot.x * 1.45, frameLerp(0.05, dt));
        kin.position.z = THREE.MathUtils.lerp(kin.position.z, spot.z * 1.45, frameLerp(0.05, dt));
        animator.set("sad", { base: true });
        animator.update(now);
        kin.userData.label.material.opacity = 0.3;
        kin.userData.shadow.material.opacity = 0.1;
        return;
      }

      setKinOpacity(kin, 1);
      if (minigame.finaleAt) {
        const pose = applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
        if (pose.cheer) {
          survivorKin = kin;
          survivorPlayer = player;
        }
      } else if (isHolder) {
        // Panicky shuffle while holding the ticking bomb.
        animator.set("run", { base: true });
        kin.position.x = kin.userData.spot.x + Math.sin(now / 120) * 0.05 * (0.5 + nervous);
      } else {
        animator.set("idle", { base: true });
        kin.position.x = THREE.MathUtils.lerp(kin.position.x, kin.userData.spot.x, frameLerp(0.15, dt));
      }
      animator.update(now);
      kin.userData.shadow.position.set(kin.position.x, 0.32, kin.position.z);
      kin.userData.shadow.material.opacity = 0.26;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    if (minigame.finaleAt && survivorKin && !this.finaleDone) {
      this.finaleDone = true;
      this.bursts.spawn(survivorKin.position.clone(), [survivorPlayer.color, "#ffd15c", "#ffffff"], { count: 26, speed: 2.8, up: 3, size: 0.1, life: 1, drag: 1.2 });
      this.bursts.ring(survivorKin.position.clone().setY(0.08), "#ffd15c", { radius: 2.2, life: 0.7, opacity: 0.6 });
      this.floaters.pop(survivorKin.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "🏆", { size: 0.6, life: 1.3, rise: 1.1 });
      if (survivorPlayer.id === controlledId) this.feedback?.sound("win");
    }

    this.bursts.update(dt);

    // Feuerflackern: zwei ungleiche Sinus, damit kein Takt hörbar wird.
    if (this.fireLight) {
      const flackern = Math.sin(now / 190) * 0.5 + Math.sin(now / 77) * 0.3;
      this.fireLight.intensity = 6 + flackern * 1.4;
      if (this.sparkLight) this.sparkLight.intensity = 3.2 + Math.sin(now / 55) * 0.9;
      this.flammen?.forEach((flamme, i) => {
        flamme.scale.setScalar(1 + Math.sin(now / (150 + i * 40)) * 0.16);
        flamme.rotation.y = now / (900 + i * 300);
      });
    }

    this.floaters.update(dt, this.camera);

    this.shake *= frameDecay(0.88, dt);
    const shakeX = Math.sin(now / 15) * this.shake * 0.3 * shakeScale();
    const shakeY = Math.cos(now / 12) * this.shake * 0.22;
    const desired = new THREE.Vector3(shakeX, (this.baseCamY || 4.6) + shakeY, this.baseCamZ || 7.8);
    this.camera.position.lerp(desired, frameLerp(0.1, dt));
    this.camera.lookAt(0, 0.8, 0);

    this.updateHud(minigame, arcade, state, now);
    // A downward arrow marks your own kin so you never lose yourself.
    syncOwnMarker(this, this.kins?.get(this.getControlledPlayerId()), now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const controlledId = this.getControlledPlayerId();
    const own = arcade.players[controlledId];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(own?.passes || 0);

    const banner = this.hud.querySelector("[data-bomb-banner]");
    const isHolder = arcade.holderId === controlledId && !own?.outAt;
    if (banner) {
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
    }
    if (this.passButton) this.passButton.disabled = !isHolder || Boolean(minigame.finaleAt);
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 5.4 : 4.6;
      this.baseCamZ = portrait ? 9.6 : 7.8;
      camera.fov = portrait ? 54 : 48;
    });
  }
}
