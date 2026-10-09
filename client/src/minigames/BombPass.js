import * as THREE from "/vendor/three/three.module.js";
import { setKinOpacity, flashKin } from "./VoxelKit.js?v=tumblekin212";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin212";
import { eventChance, frameLerp } from "./Quality.js?v=tumblekin212";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin212";
import { ringband } from "./Blockform.js?v=tumblekin212";

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
// Pause nach dem Knall (Server: BOMB_BREAK_MS): erst die Explosion, dann
// steigt die neue Bombe aus dem Feuer und fliegt im Bogen zum Träger.
const RISE_MS = 580;
const FLY_MS = 520;
const FIRE_AT = new THREE.Vector3(0, 0.55, 0.6);

export class BombPass extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.spots = new Map();
    this.out = new Map();
    this.lastHolderId = null;
    this.lastExplosions = 0;
    this.flight = null;
    this.hits = new Map();
    this.caughtSince = null;
    this.inBreak = false;
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

    this.buildCamp(scene);
    this.buildBomb();

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const spot = this.spotFor(index, players.length);
      this.spots.set(player.id, spot);
      this.addKin(player, index, { x: spot.x, ground: 0.3, z: spot.z, facing: spot.facing });
    });
  }

  // Ein Zeltlager am Abend: zwei Zelte hinter dem Platz, dunkle Tannen als
  // Silhouetten, vorn ein Rucksack, eine Laterne, eine Gitarre, Stöcke mit
  // Marshmallows und ein Schlafsack — und Funken, die aus dem Feuer steigen.
  buildCamp(scene) {
    const zufall = streuer(29);
    // Zwei Zelte: dreieckige Prismen, die Öffnung zum Feuer.
    const prisma = new THREE.CylinderGeometry(0.8, 0.8, 1.7, 3);
    prisma.rotateX(-Math.PI / 2);
    prisma.translate(0, 0.4, 0);
    const tuer = new THREE.CircleGeometry(0.42, 3);
    tuer.rotateZ(Math.PI / 2);
    [[-3.3, -7.4, 0.5, "#e0703b"], [3.4, -7.8, -0.45, "#3f8fc8"]].forEach(([x, z, dreh, farbe]) => {
      const zelt = new THREE.Group();
      zelt.position.set(x, 0, z);
      zelt.rotation.y = dreh;
      scene.add(zelt);
      const huelle = new THREE.Mesh(prisma, lambert(farbe));
      huelle.castShadow = true;
      zelt.add(huelle);
      const eingang = new THREE.Mesh(tuer, lambert("#2c2436"));
      eingang.position.set(0, 0.22, 0.86);
      zelt.add(eingang);
      kiste(zelt, 0.04, 0.06, 1.9, "#8a8a8a", [0, 1.21, 0], { schatten: false });
    });
    // Tannen als Silhouetten.
    const tannen = [];
    for (let i = 0; i < 16; i += 1) {
      const x = -13 + i * 1.8 + (zufall() - 0.5) * 1.2;
      if (Math.abs(x) < 1.4) continue;
      const h = 2.6 + zufall() * 2.2;
      tannen.push({ p: [x, h / 2, -10 - zufall() * 5], s: [h * 0.32, h, h * 0.32] });
    }
    viele(scene, new THREE.ConeGeometry(1, 1, 6), new THREE.MeshLambertMaterial({ color: "#1d2a2e" }), tannen);

    // Vorn: Rucksack, Laterne, Gitarre, Marshmallows, Schlafsack.
    const rucksack = new THREE.Group();
    rucksack.position.set(-1.35, 0.3, 4.2);
    rucksack.rotation.y = 0.5;
    rucksack.scale.setScalar(0.8);
    scene.add(rucksack);
    kiste(rucksack, 0.5, 0.6, 0.32, "#2f8f5a", [0, 0.3, 0]);
    kiste(rucksack, 0.36, 0.24, 0.1, "#27774a", [0, 0.22, 0.2]);
    kiste(rucksack, 0.52, 0.14, 0.34, "#c8413b", [0, 0.64, 0]);
    const laterne = new THREE.Group();
    laterne.position.set(1.35, 0.3, 4.0);
    scene.add(laterne);
    kiste(laterne, 0.26, 0.05, 0.26, "#2c2f38", [0, 0.03, 0]);
    this.campLantern = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.2), new THREE.MeshBasicMaterial({ color: "#ffd88a" }));
    this.campLantern.position.y = 0.2;
    laterne.add(this.campLantern);
    kiste(laterne, 0.26, 0.05, 0.26, "#2c2f38", [0, 0.37, 0]);
    const buegel = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.015, 4, 10, Math.PI), lambert("#2c2f38"));
    buegel.position.y = 0.4;
    laterne.add(buegel);
    const gitarre = new THREE.Group();
    gitarre.position.set(0.55, 0.32, 4.8);
    gitarre.rotation.set(-Math.PI / 2, 0, 0.9);
    scene.add(gitarre);
    [[0.2, 0, "#c98d4e"], [0.15, 0.28, "#c98d4e"]].forEach(([r, y, farbe]) => {
      const bauch = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.1, 14), lambert(farbe));
      bauch.rotation.x = Math.PI / 2;
      bauch.position.y = y;
      gitarre.add(bauch);
    });
    const loch = new THREE.Mesh(new THREE.CircleGeometry(0.06, 10), lambert("#2c1e14"));
    loch.position.set(0, 0.12, 0.051);
    gitarre.add(loch);
    kiste(gitarre, 0.07, 0.6, 0.05, "#6b4a2e", [0, 0.68, 0]);
    kiste(gitarre, 0.1, 0.14, 0.05, "#4a3222", [0, 1.02, 0]);
    // Marshmallow-Stöcke, an die Steine gelehnt.
    [[-0.7, 1.55, -0.5], [0.75, 1.5, 0.45]].forEach(([x, z, dreh]) => {
      const stock = new THREE.Group();
      stock.position.set(x, 0.3, z);
      stock.rotation.set(0.9, dreh, 0);
      scene.add(stock);
      kiste(stock, 0.025, 0.9, 0.025, "#8a6238", [0, 0.45, 0], { schatten: false });
      kiste(stock, 0.08, 0.09, 0.08, "#fff4e6", [0, 0.9, 0], { schatten: false });
    });
    const schlafsack = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 12), lambert("#5c6296"));
    schlafsack.rotation.z = Math.PI / 2;
    schlafsack.position.set(-0.5, 0.48, 5.0);
    scene.add(schlafsack);
    viele(scene, new THREE.CylinderGeometry(0.185, 0.185, 0.05, 12), lambert("#3f4470"), [-0.2, 0, 0.2].map((dx) => ({ p: [-0.5 + dx, 0.48, 5.0], r: [0, 0, Math.PI / 2] })));

    // Funken, die aus dem Feuer aufsteigen. (Glühwürmchen gehören dem
    // Augenmaß — dort sind sie das, was gezählt wird.)
    this.embers = [];
    const glut = new THREE.MeshBasicMaterial({ color: "#ffb04a" });
    for (let i = 0; i < 12; i += 1) {
      const funke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), glut);
      funke.userData = { isFx: true, phase: zufall(), dx: (zufall() - 0.5) * 0.5, dz: (zufall() - 0.5) * 0.5, speed: 0.35 + zufall() * 0.3 };
      scene.add(funke);
      this.embers.push(funke);
    }
  }

  buildBomb() {
    this.bomb = new THREE.Group();
    const body = new THREE.MeshLambertMaterial({ color: "#31405a", emissive: "#ff2a1a", emissiveIntensity: 0 });
    this.bombBody = body;
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), body);
    core.castShadow = true;
    this.bomb.add(core);
    [[0.26, 0, 0], [-0.26, 0, 0], [0, 0, 0.26], [0, 0, -0.26], [0, -0.26, 0]].forEach(([x, y, z]) => {
      const bulge = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.24), body);
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
    this.timerSprite.renderOrder = 998;
    // Nicht an der Bombe: im Flug überschlägt sie sich, und das Schild wäre
    // mitgekreist — zeitweise hing die Zahl UNTER der Bombe.
    this.scene.add(this.timerSprite);
    this.timerLast = null;

    // Die Bombe ist dunkel, die Nacht auch: ein warmer Schein hinter ihr hebt
    // sie vom Wald ab, und ein roter Ring am Boden zeigt auf einen Blick, wer
    // sie hält — auch wenn Schild oder Funken sie gerade verdecken.
    const glow = document.createElement("canvas");
    glow.width = 64;
    glow.height = 64;
    const g = glow.getContext("2d");
    const verlauf = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    verlauf.addColorStop(0, "rgba(255,190,110,0.95)");
    verlauf.addColorStop(0.45, "rgba(255,110,50,0.45)");
    verlauf.addColorStop(1, "rgba(255,60,30,0)");
    g.fillStyle = verlauf;
    g.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(glow);
    glowTex.colorSpace = THREE.SRGBColorSpace;
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.halo.scale.setScalar(1.5);
    this.halo.userData.isFx = true;
    this.bomb.add(this.halo);
    this.scene.add(this.bomb);

    // Als Band aus Keilen wie der Rand im Bumper Pool — gerastert wurde der
    // kleine Ring zu einem Quadrat.
    this.holderRing = new THREE.Mesh(
      ringband({ innen: 0.5, aussen: 0.66, unten: 0, oben: 0.02 }),
      new THREE.MeshBasicMaterial({ color: "#ff3b30", transparent: true, opacity: 0.7, depthWrite: false })
    );
    this.holderRing.visible = false;
    this.scene.add(this.holderRing);
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
        <span class="bomb-button-arm" data-bomb-arm></span>
        <span class="bomb-button-face">WEITERGEBEN</span>
      </button>`;
    this.armNode = this.controls.querySelector("[data-bomb-arm]");
    this.passButton = this.controls.querySelector("[data-bomb-pass]");
    const press = (event) => {
      event.preventDefault();
      this.pressPass();
    };
    this.on(this.passButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  // Wer die Bombe gerade bekommen hat, muss sie einen Moment halten (der
  // Server sperrt das Weitergeben kurz). Vorher warf die Figur trotzdem, die
  // Bombe blieb aber liegen — der Tipp verpuffte, und es fühlte sich an, als
  // hätte das Spiel nicht reagiert. Jetzt zeigt der Knopf die Sperre als
  // Füllbalken, und ein Tipp währenddessen wird gemerkt und genau dann
  // ausgeführt, wenn die Sperre endet.
  pressPass() {
    const arcade = (this.update || this.minigame)?.arcade;
    const id = this.getControlledPlayerId();
    const own = arcade?.players?.[id];
    if (!own || own.outAt || arcade.holderId !== id) return;
    // Die Sperre endet zur Ankunftszeit: Der Wurf, der jetzt losgeht, kommt
    // beim Server an, wenn sie dort vorbei ist — auf der verzögerten Uhr hielt
    // jeder die Bombe die Netzlaufzeit hin und zurück länger als nötig.
    const wait = (arcade.canPassAt || 0) + 30 - this.arrivalNow();
    if (wait > 0) {
      // Nur die kurze Sperre nach dem Fangen puffern — ein Tipp im Vorlauf
      // vor dem Start ist ein Versehen und soll nicht beim Start zünden.
      if (wait > 600) return;
      this.queuedPass = arcade.holderSince || true;
      this.feedback?.vibrate(6);
      return;
    }
    this.firePass(id);
  }

  firePass(id) {
    this.queuedPass = null;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(12);
    this.animators.get(id)?.trigger("throw");
    this.sendInput({ action: "pass" }).catch(() => {});
  }

  // Der Knall beim Träger. Raus ist er, wenn er keine Leben mehr hat; zu
  // zweit verliert er erst eines und spielt weiter.
  boom(arcade, now, controlledId) {
    const id = arcade.lastBoomId;
    const kin = this.kins.get(id);
    this.rig.shake(1);
    this.feedback?.sound("burst");
    this.feedback?.vibrate([34, 24, 40]);
    this.flight = null;
    const at = kin ? kin.position.clone().add(new THREE.Vector3(0, 0.9, 0)) : this.bomb.position.clone();
    this.burst(at, ["#ff8b2e", "#ffd15c", "#1b2530", "#ffffff"], { count: 30, speed: 3.4, up: 2.8, size: 0.1, life: 0.9, drag: 1.3 });
    this.burst(at, ["#3a3530", "#57504a"], { count: 10, speed: 0.9, up: 1.6, size: 0.16, life: 1.3, gravity: -0.6, drag: 2 });
    if (kin) this.bursts.ring(kin.position.clone().setY(0.34), "#ff8b2e", { radius: 2.4, life: 0.6, opacity: 0.6, y: 0.34 });
    const entry = arcade.players[id];
    const out = Boolean(entry?.outAt);
    this.pop(at.clone().add(new THREE.Vector3(0, 0.6, 0)), out ? "BUMM! 💥" : "−1 ❤", { color: out ? "#ff8b2e" : "#ff5d73", size: 0.5, life: 1 });
    if (!out && kin) {
      this.hits.set(id, now);
      this.animators.get(id)?.trigger("knockback");
    }
    if (id === controlledId) {
      this.feedback?.sound("error");
      this.feedback?.vibrate([30, 24, 40]);
    }
  }

  bombRest(kin) {
    // Über dem Kopf des Trägers.
    return new THREE.Vector3(kin.position.x, kin.position.y + 0.95, kin.position.z + 0.05);
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    this.embers?.forEach((funke) => {
      const d = funke.userData;
      const t = (now / 1000 * d.speed + d.phase) % 1;
      funke.position.set(d.dx * (1 + t * 2) + Math.sin(now / 300 + d.phase * 9) * 0.08, 0.7 + t * 2.4, 0.6 + d.dz * (1 + t));
      funke.scale.setScalar(1 - t * 0.8);
    });
    if (this.campLantern) this.campLantern.scale.setScalar(1 + Math.sin(now / 120) * 0.03);
    if (!arcade) return;

    // Knall: beim Träger, egal ob er raus ist oder (zu zweit) nur ein Leben
    // verliert. Die Bombe ist danach weg, bis die neue aus dem Feuer kommt.
    if ((arcade.explosions || 0) > this.lastExplosions) {
      this.lastExplosions = arcade.explosions;
      this.boom(arcade, now, controlledId);
    }

    // Nach dem Knall bis zur Ankunft der neuen Bombe: keiner hält sie.
    const breakLeft = (arcade.holderSince || 0) - now;
    const inBreak = breakLeft > 0 && !finale;
    if (inBreak) this.inBreak = true;

    // Wechsel des Trägers: der alte wirft, die Bombe fliegt im Bogen. Kommt
    // sie aus dem Feuer, ist sie schon da und wird nur gefangen.
    if (!inBreak && this.caughtSince !== arcade.holderSince) {
      const first = this.caughtSince === null;
      const fromFire = this.inBreak;
      this.caughtSince = arcade.holderSince;
      this.inBreak = false;
      const fromKin = !fromFire && this.lastHolderId !== arcade.holderId ? this.kins.get(this.lastHolderId) : null;
      if (fromKin && arcade.holderId) {
        this.flight = { from: this.bomb.position.clone(), to: arcade.holderId, start: now };
        if (this.lastHolderId !== controlledId) this.animators.get(this.lastHolderId)?.trigger("throw");
      }
      if ((fromFire || !first) && arcade.holderId === controlledId) {
        this.feedback?.sound("impact");
        this.feedback?.vibrate([16, 12, 20]);
      }
      this.animators.get(arcade.holderId)?.trigger("catch");
      this.lastHolderId = arcade.holderId;
    }

    // Anspannung nach HALTEZEIT, nicht nach Restzeit. Wann es knallt, weiss
    // keiner — aber wer die Bombe festhält, wird mit jeder Zehntelsekunde
    // nervöser, und alle anderen sehen es: die Bombe zittert und glüht, der
    // Träger schwitzt und tritt von einem Fuss auf den anderen, die Nachbarn
    // gehen in Deckung. Nach drei Sekunden ist man ganz oben.
    const holderKin = inBreak ? null : this.kins.get(arcade.holderId);
    const heldFor = Math.max(0, now - (arcade.holderSince || now)) / 1000;
    // Überzeit: die Zündschnur ist runter, nur die Schonfrist des Trägers
    // hält den Knall noch auf. Dann ist alles auf Anschlag, und über der
    // Bombe läuft die Frist als Ring ab — jeder sieht, wie knapp es ist.
    const overtime = Boolean(arcade.overtime) && Boolean(holderKin) && !finale;
    const graceSpan = Math.max(1, (arcade.graceUntil || 0) - (arcade.holderSince || 0));
    const graceLeft = overtime ? Math.max(0, Math.min(1, ((arcade.graceUntil || 0) - now) / graceSpan)) : 0;
    const tension = overtime ? 1 : holderKin ? Math.min(1, Math.max(0, (heldFor - 0.4) / 2.6)) : 0;
    this.bombBody.emissiveIntensity = tension * tension * (0.55 + Math.abs(Math.sin(now / (260 - tension * 190))) * 0.45);
    const nextKin = this.kins.get(arcade.holderId);
    if (inBreak && nextKin && breakLeft <= RISE_MS + FLY_MS) {
      // Die neue Bombe steigt aus der Glut, dann fliegt sie zum Träger.
      this.bomb.visible = true;
      this.flight = null;
      this.bomb.rotation.set(0, now / 700, 0);
      if (breakLeft > FLY_MS) {
        const u = 1 - (breakLeft - FLY_MS) / RISE_MS;
        this.bomb.position.copy(FIRE_AT).setY(FIRE_AT.y + u * 0.45);
        this.bomb.scale.setScalar(0.35 + u * 0.65);
      } else {
        const u = 1 - breakLeft / FLY_MS;
        this.bomb.position.lerpVectors(FIRE_AT.clone().setY(FIRE_AT.y + 0.45), this.bombRest(nextKin), u);
        this.bomb.position.y += Math.sin(u * Math.PI) * 1.3;
        this.bomb.rotation.x = u * Math.PI * 2;
        this.bomb.scale.setScalar(1);
      }
    } else if (holderKin && !finale) {
      this.bomb.visible = true;
      const rest = this.bombRest(holderKin);
      rest.x += Math.sin(now / (70 - tension * 42)) * (0.012 + tension * 0.085);
      rest.z += Math.cos(now / (83 - tension * 47)) * tension * 0.05;
      this.bomb.scale.setScalar(1 + Math.max(0, Math.sin(now / (240 - tension * 170))) * tension * 0.14);
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
    this.halo.material.opacity = 0.7 + tension * 0.3 + Math.sin(now / (200 - tension * 120)) * 0.1;
    this.halo.scale.setScalar(1.5 + tension * 0.5);
    // Der Ring am Boden: wer hält, steht im Roten.
    const ringOn = Boolean(holderKin) && !finale;
    this.holderRing.visible = ringOn;
    if (ringOn) {
      this.holderRing.position.set(holderKin.position.x, 0.305, holderKin.position.z);
      this.holderRing.scale.setScalar(1 + Math.sin(now / (180 - tension * 110)) * (0.05 + tension * 0.08));
      this.holderRing.material.opacity = 0.55 + tension * 0.4;
    }

    // Zündzeit: kurz die Sekunden, dann "?".
    // Die Zahl erscheint mit der Ankunft (im Anflug schon ein Stück vorher)
    // und zählt von der vollen Zündzeit herunter.
    // Der Server schickt nur die gezeigten ganzen Sekunden und den Zünd-
    // zeitpunkt, nicht den Knall (die Übung rechnet lokal und hat beides).
    // Gezählt wird ab der Zündung, über jedes Weitergeben hinweg.
    const revealing = arcade.revealUntil && now < arcade.revealUntil && breakLeft < 260;
    const shown = arcade.fuseSecs ?? Math.round((arcade.fuseMs || 0) / 1000);
    const litAt = arcade.litAt ?? (arcade.fuseAt || 0) - (arcade.fuseMs || 0);
    const secs = Math.max(0, Math.min(shown, Math.ceil(shown - (now - litAt) / 1000)));
    this.timerSprite.visible = this.bomb.visible && (!inBreak || breakLeft < 260);
    this.timerSprite.position.copy(this.bomb.position).y += 0.95 * this.bomb.scale.y;
    const text = overtime ? `!${Math.round(graceLeft * 48)}` : revealing ? `${secs}s` : "?";
    if (text !== this.timerLast) {
      this.timerLast = text;
      const c = this.timerCtx;
      c.clearRect(0, 0, 128, 128);
      c.fillStyle = overtime ? "rgba(255,32,56,0.96)" : revealing ? "rgba(255,32,56,0.92)" : "rgba(20,28,38,0.86)";
      c.beginPath();
      c.arc(64, 64, 56, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 6;
      c.strokeStyle = overtime ? "rgba(255,255,255,0.3)" : "#ffffff";
      c.stroke();
      if (overtime) {
        // Die Schonfrist als Ring, der im Uhrzeigersinn abläuft.
        c.lineWidth = 10;
        c.strokeStyle = "#ffffff";
        c.beginPath();
        c.arc(64, 64, 54, -Math.PI / 2, -Math.PI / 2 + graceLeft * Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = "#ffffff";
      c.font = `900 ${overtime ? 70 : revealing ? 46 : 62}px ui-rounded, system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(overtime ? "!" : text, 64, 70);
      this.timerTex.needsUpdate = true;
    }
    this.spark.material.emissiveIntensity = 0.7 + Math.abs(Math.sin(now / (150 - tension * 100))) * (0.8 + tension * 1.4);
    this.spark.scale.setScalar(1 + tension * 0.7);
    if (this.bomb.visible && !finale && Math.random() < eventChance(0.3 + tension * 2.2, dt)) {
      this.burst(this.bomb.position.clone().add(new THREE.Vector3(0, 0.55, 0)), ["#ffd15c", "#ff8b2e"], { count: 1 + Math.round(tension * 2), speed: 0.5 + tension, up: 0.6 + tension * 0.8, size: 0.04, life: 0.3 });
    }
    // Schweiss vom Träger, und der eigene Puls in der Hand.
    if (holderKin && !finale && tension > 0.25 && Math.random() < eventChance(tension * 5, dt)) {
      const brow = holderKin.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.72, 0.18));
      this.burst(brow, ["#bfe9ff", "#8fd4ff"], { count: 1, speed: 0.35, up: 0.5, size: 0.045, life: 0.45, gravity: 5 });
    }
    // Dazu ein leises Ticken, das mit der Haltezeit schneller und höher wird
    // — es verrät nichts über die Zündschnur, nur wie lange man schon zögert.
    if (arcade.holderId === controlledId && holderKin && tension > 0.2 && !finale) {
      const beatMs = overtime ? 110 : 820 - tension * 470;
      if (!this.nextPulse || now >= this.nextPulse) {
        this.nextPulse = now + beatMs;
        this.feedback?.vibrate(tension > 0.7 ? [10, 60, 14] : 8);
        this.feedback?.sound("clack", { pitch: 1.6 + tension * 1.2 });
      }
    } else {
      this.nextPulse = 0;
    }

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const spot = this.spots.get(player.id);
      if (!entry || !kin || !animator || !spot) return;
      const out = Boolean(entry.outAt);
      const isHolder = arcade.holderId === player.id && !inBreak;

      if (out && !this.out.has(player.id)) {
        this.out.set(player.id, now);
        animator.trigger("knockback");
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

      // Zu zweit: getroffen, aber noch im Spiel. Kurz verrußt und benommen,
      // dann schüttelt man es ab — rechtzeitig, bevor die neue Bombe kommt.
      const hitAt = this.hits.get(player.id);
      const sinceHit = hitAt ? (now - hitAt) / 1000 : Infinity;
      if (sinceHit < 1.5) {
        flashKin(kin, "#000000", 0);
        kin.userData.material.color.setScalar(0.45 + 0.55 * Math.min(1, sinceHit / 1.5));
        if (!finale && !isHolder) animator.set("dizzy");
      } else if (hitAt) {
        this.hits.delete(player.id);
        kin.userData.material.color.setScalar(1);
      }

      kin.position.x += (spot.x - kin.position.x) * frameLerp(0.15, dt);
      kin.rotation.y = spot.facing;
      // Alle schauen der Bombe hinterher.
      animator.lookAt(this.bomb.visible && !isHolder ? this.bomb.position : null);
      if (finale) {
        this.setGround(player.id, 0.3);
        return;
      }
      if (isHolder) {
        // Hält die Bombe über dem Kopf; erst ruhig, dann zitternd, zuletzt
        // trippelnd von einem Fuss auf den anderen.
        animator.set("carry");
        if (tension > 0.15) animator.expression(tension > 0.6 ? "surprised" : "scared", 200);
        kin.position.x = spot.x + Math.sin(now / (60 - tension * 25)) * 0.05 * tension;
        const trip = tension > 0.45 ? Math.abs(Math.sin(now / (170 - tension * 70))) * 0.07 * tension : 0;
        this.setGround(player.id, 0.3 + trip);
        kin.rotation.y = spot.facing + Math.sin(now / 130) * 0.12 * tension;
      } else if (sinceHit >= 1.5) {
        this.setGround(player.id, 0.3);
        // Je länger der Nachbar festhält, desto mehr geht man in Deckung.
        animator.set(tension > 0.65 ? "cower" : tension > 0.3 ? "brace" : "focus");
        if (tension > 0.5) animator.expression("scared", 200);
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
    const { arcade, minigame, controlledId, players, now } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    // Oben links steht, was zählt: zu zweit der Spielstand in Treffern
    // (eigene zuerst), sonst wie viele noch im Spiel sind. Die Zahl der
    // Weitergaben stand dort früher — und lud zum hektischen Weiterreichen
    // ein, das gemessen schlechter abschneidet als rechtzeitiges.
    const lives = arcade.lives || 1;
    const alive = players.filter((player) => !arcade.players[player.id]?.outAt).length;
    let score = `${alive}/${players.length}`;
    if (lives > 1 && players.length === 2) {
      const other = players.find((player) => player.id !== controlledId);
      const theirs = arcade.players[other?.id];
      if (own && theirs) score = `${lives - (theirs.lives ?? lives)}:${lives - (own.lives ?? lives)}`;
    }
    if (this.scoreNode.textContent !== score) this.scoreNode.textContent = score;
    const banner = this.hud.querySelector("[data-bomb-banner]");
    const inBreak = now < (arcade.holderSince || 0) && !minigame.finaleAt;
    const isHolder = arcade.holderId === controlledId && !own?.outAt && !inBreak;
    let text = null;
    let tone = "#40506a";
    const finale = Boolean(minigame.finaleAt);
    if (own?.outAt) {
      text = "BOOM – raus!";
    } else if ((inBreak || finale) && arcade.lastBoomId) {
      const hit = arcade.players[arcade.lastBoomId];
      const name = players.find((player) => player.id === arcade.lastBoomId)?.name || "?";
      if (arcade.lastBoomId === controlledId) text = `Getroffen! Noch ${hit?.lives ?? 0} ❤`;
      else text = hit?.outAt ? `💥 ${name} ist raus!` : `💥 Treffer bei ${name}!`;
      tone = "#8a3b1c";
    } else if (isHolder && !finale) {
      text = arcade.overtime ? "ÜBERZEIT – weg damit!" : "DU hast die Bombe!";
      tone = "#ff2038";
    } else if (arcade.overtime && !inBreak && !finale && !own?.outAt) {
      text = "ÜBERZEIT! Gleich knallt's";
      tone = "#c2410c";
    }
    banner.hidden = !text;
    if (text && banner.textContent !== text) banner.textContent = text;
    banner.style.background = tone;
    banner.style.color = "#ffffff";
    this.passButton.disabled = !isHolder || Boolean(minigame.finaleAt);
    this.passButton.classList.toggle("is-hot", isHolder && !minigame.finaleAt);
    this.passButton.classList.toggle("is-overtime", isHolder && Boolean(arcade.overtime) && !minigame.finaleAt);

    // Sperre nach dem Fangen: der Balken läuft voll, dann ist der Knopf scharf.
    const lockMs = Math.max(1, (arcade.canPassAt || 0) - (arcade.holderSince || 0));
    const left = (arcade.canPassAt || 0) + 30 - this.arrivalNow();
    const locked = isHolder && left > 0;
    const arm = locked ? 1 - Math.min(1, left / (lockMs + 30)) : 1;
    if (this.armNode) this.armNode.style.transform = `scaleX(${arm.toFixed(3)})`;
    this.passButton.classList.toggle("is-arming", locked);
    this.passButton.classList.toggle("is-queued", locked && Boolean(this.queuedPass));
    // Gemerkter Tipp: sobald die Sperre fällt, geht die Bombe weiter. Hat
    // man sie inzwischen nicht mehr (Knall), verfällt er.
    if (this.queuedPass && (!isHolder || this.queuedPass !== (arcade.holderSince || true))) this.queuedPass = null;
    if (this.queuedPass && !locked && isHolder && !minigame.finaleAt) this.firePass(controlledId);
  }
}
