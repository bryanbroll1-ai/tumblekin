import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin
} from "./VoxelKit.js?v=tumblekin102";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin102";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin102";

// Sortierband — Pakete fahren auf einen zu, drei Rutschen tragen Farben, und
// jedes Paket muss in die passende. Die Rutschen tauschen zwischendurch die
// Farben: die Aufgabe ist damit nicht Auswendiglernen, sondern jedes Mal neu
// hinschauen.
//
// Das Band läuft von hinten nach vorne auf die Kamera zu. Auf dem hohen
// Handybild ist das die einzige Richtung, in der man weit vorausschauen kann,
// ohne dass die Pakete winzig werden: die Tiefe ist gratis, die Breite nicht.
const BELT_LENGTH = 13.0;      // Weltlänge des Bandes
const BELT_WIDTH = 2.4;
const BELT_FAR_Z = -9.4;       // wo ein Paket auf das Band kommt (Bandanteil 0)
const BELT_NEAR_Z = 3.0;       // Kante, an der es runterfällt (Bandanteil 1)
const CHUTE_X = 2.35;          // seitlicher Abstand der äusseren Rutschen
// Die drei Höhen, an denen sich in dieser Szene alles ausrichtet. Sie standen
// vorher verstreut als nackte Zahlen im Code, und genau deshalb passte nichts
// zusammen: die Trichteröffnung lag bei 1.30, die Bandoberfläche bei 0.32 —
// die Kübel schwebten also einen Meter ÜBER dem Band, und ein Paket hätte
// bergauf fliegen müssen, um hineinzufallen. Stattdessen flog es durch.
const GROUND_Y = -0.5;         // Oberkante des Bodens
const BELT_TOP_Y = 0.32;       // Oberkante des Bandes
const CHUTE_MOUTH_Y = 0.30;    // Trichterrand, knapp UNTER der Bandkante
const COLOURS = ["#ff5d73", "#3fc5e8", "#ffd15c"];
const COLOUR_DARK = ["#8e2233", "#12586b", "#8a6410"];
const COLOUR_NAMES = ["Rot", "Blau", "Gelb"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function beltZ(progress) {
  return BELT_FAR_Z + clamp(progress, 0, 1.2) * (BELT_NEAR_Z - BELT_FAR_Z);
}

export class SortBelt {
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
    this.chutes = [];
    this.parcels = [];
    this.flying = [];
    this.lastSortAt = 0;
    this.lastVerdictAt = 0;
    this.lastSwapAt = 0;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.beltScroll = 0;
    this.swapPulse = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Sortierband", background: "#8fd3ef", fog: ["#aee0f4", 22, 56], fov: 58, far: 100 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-belt-time>0s</span><strong data-belt-score>0</strong></div>
      <div class="belt-streak" data-belt-streak hidden></div>
      <div class="belt-chips" data-belt-chips></div>
      <div class="color-banner belt-banner" data-belt-banner hidden></div>
    `);
    this.createScene();

    // Keine Knöpfe: Wischen nach links/unten/rechts ODER Antippen einer Rutsche.
    // Beides meint dasselbe, und beides zeigt direkt auf das, was man treffen
    // will — ein Knopfstreifen wäre hier nur ein Umweg über den Daumen.
    this.controls.innerHTML = `<p class="trace-hint">Wisch das Paket in die Rutsche mit seiner Farbe</p>`;
    this.controls.style.pointerEvents = "none";

    this.bindGestures();
    this.loop();
  }

  bindGestures() {
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let tracking = false;

    this.onDown = (event) => {
      event.preventDefault();
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
      startAt = performance.now();
    };
    this.onUp = (event) => {
      if (!tracking) return;
      tracking = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const dist = Math.hypot(dx, dy);
      const held = performance.now() - startAt;
      // Kurzer Kontakt ohne Weg ist ein Tipp — dann entscheidet die getippte
      // Bildhälfte. Alles darüber ist ein Wisch, und dann entscheidet die
      // Richtung. Beides landet in derselben Rutschennummer.
      if (dist < 26 && held < 400) {
        this.sortTo(this.chuteAtPoint(event.clientX));
        return;
      }
      if (dist < 26) return;
      if (dy > Math.abs(dx) * 0.9) {
        this.sortTo(1);           // nach unten = Mitte
        return;
      }
      this.sortTo(dx < 0 ? 0 : 2);
    };
    this.onCancel = () => { tracking = false; };

    this.webglCanvas.addEventListener("pointerdown", this.onDown);
    this.webglCanvas.addEventListener("pointerup", this.onUp);
    this.webglCanvas.addEventListener("pointercancel", this.onCancel);
  }

  // Ein Tipp trifft die Rutsche, über der er liegt. Die Trennlinien liegen bei
  // Dritteln der Bildbreite — die Rutschen stehen im Bild ohnehin so.
  chuteAtPoint(clientX) {
    const rect = this.webglCanvas.getBoundingClientRect();
    const share = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 0.999);
    return Math.floor(share * 3);
  }

  sortTo(chute) {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt) return;
    const own = minigame.arcade?.players?.[this.getControlledPlayerId()];
    if (!own) return;
    // Vor der Reichweite passiert nichts — dann aber auch kein Klick-Geräusch,
    // sonst klingt es, als hätte man etwas ausgelöst.
    if (!own.reachable) {
      this.feedback?.sound("clack");
      return;
    }
    this.feedback?.sound("tap");
    this.sendInput({ action: "sort", chute }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    this.webglCanvas?.removeEventListener("pointerdown", this.onDown);
    this.webglCanvas?.removeEventListener("pointerup", this.onUp);
    this.webglCanvas?.removeEventListener("pointercancel", this.onCancel);
    teardownStage(this);
    this.chutes.length = 0;
    this.parcels.length = 0;
    this.flying.length = 0;
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-5, 13, 7],
      shadow: { left: -7, right: 7, top: 10, bottom: -6 }
    });

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.5, 26),
      new THREE.MeshLambertMaterial({ color: "#b0865f" })
    );
    floor.position.set(0, -0.75, -3);
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.buildBelt();
    this.buildChutes();

    [[-6.2, 7.4, -14, 3], [6.0, 8.1, -16, 8]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildWorker();
    this.buildParcels();
    this.resizeRenderer();
    this.camera.position.set(0, 4.3, 8.4);
    this.camera.lookAt(0, 0.9, -1.6);
  }

  buildBelt() {
    const midZ = (BELT_FAR_Z + BELT_NEAR_Z) / 2;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(BELT_WIDTH, 0.32, BELT_LENGTH),
      new THREE.MeshLambertMaterial({ color: "#4a5566" })
    );
    deck.position.set(0, 0.16, midZ);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Querlatten, die mitlaufen. Ohne sie sieht ein laufendes Band genauso aus
    // wie ein stehendes — und genau daran liest man hier das Tempo ab.
    this.slats = [];
    const slatGeo = new THREE.BoxGeometry(BELT_WIDTH * 0.96, 0.08, 0.22);
    const slatMat = new THREE.MeshLambertMaterial({ color: "#6b7a8d" });
    for (let i = 0; i < 22; i += 1) {
      const slat = new THREE.Mesh(slatGeo, slatMat);
      slat.position.set(0, 0.34, 0);
      this.scene.add(slat);
      this.slats.push(slat);
    }

    [-1, 1].forEach((side) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.36, BELT_LENGTH),
        new THREE.MeshLambertMaterial({ color: "#8894a5" })
      );
      rail.position.set(side * (BELT_WIDTH / 2 + 0.08), 0.42, midZ);
      rail.castShadow = true;
      this.scene.add(rail);
    });

    // Die Greifkante: ab hier ist das vorderste Paket in Reichweite. Sie sitzt
    // im Bild und nicht nur in den Regeln — sonst wirkt ein zu früher Wisch wie
    // ein verschluckter Befehl.
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(BELT_WIDTH + 0.4, 0.05, 0.12),
      new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false })
    );
    line.position.set(0, 0.35, beltZ(0.34));
    this.scene.add(line);
    this.reachLine = line;
  }

  buildChutes() {
    // Drei Trichter am vorderen Ende, nebeneinander. Sie stehen leicht schräg
    // nach aussen, damit man auch die äusseren als getrennte Ziele liest.
    const spots = [-CHUTE_X, 0, CHUTE_X];
    spots.forEach((x, index) => {
      const group = new THREE.Group();
      group.position.set(x, 0, BELT_NEAR_Z + 0.5);
      this.scene.add(group);

      // Der Trichter steht auf dem Boden und endet knapp unter der Bandkante —
      // das Paket kippt also über den Rand hinein, statt hinaufgeworfen zu
      // werden.
      const chuteHeight = CHUTE_MOUTH_Y - GROUND_Y;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.92, 0.52, chuteHeight, 6, 1, true),
        new THREE.MeshLambertMaterial({ color: COLOURS[index], side: THREE.DoubleSide })
      );
      body.position.y = GROUND_Y + chuteHeight / 2;
      body.castShadow = true;
      group.add(body);

      const lip = new THREE.Mesh(
        new THREE.TorusGeometry(0.92, 0.09, 6, 18),
        new THREE.MeshLambertMaterial({ color: "#ffffff" })
      );
      lip.rotation.x = Math.PI / 2;
      lip.position.y = CHUTE_MOUTH_Y;
      group.add(lip);

      // Ein Leuchtring, der beim Treffer aufblitzt und beim angekündigten
      // Farbtausch pulsiert.
      const glow = new THREE.Mesh(
        new THREE.TorusGeometry(1.14, 0.07, 6, 22),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
      );
      glow.rotation.x = Math.PI / 2;
      glow.position.y = CHUTE_MOUTH_Y;
      group.add(glow);

      const shadow = createShadowBlob(0.8);
      shadow.position.set(x, GROUND_Y + 0.02, BELT_NEAR_Z + 0.5);
      this.scene.add(shadow);

      this.chutes.push({
        index, group, body, lip, glow,
        colour: index,
        shownColour: index,
        flash: 0,
        swapSpin: 0,
        base: new THREE.Color(COLOURS[index])
      });
    });
  }

  // Die Paketkörper werden EINMAL gebaut und weiterverwendet. Neue Meshes je
  // Paket wären auf dem Handy der teuerste Teil der Szene — und es sind über
  // die Runde leicht sechzig Stück.
  buildParcels() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 5; i += 1) {
      const group = new THREE.Group();
      const box = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COLOURS[0] }));
      box.castShadow = true;
      group.add(box);
      // Zwei helle Bänder über das Paket: sie zeigen die Drehung und machen die
      // Farbe auch dann noch lesbar, wenn das Paket klein am Horizont steht.
      const tapeMat = new THREE.MeshLambertMaterial({ color: "#fff4dc" });
      const tapeA = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 0.22), tapeMat);
      tapeA.position.y = 0.02;
      group.add(tapeA);
      const tapeB = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 1.04), tapeMat);
      tapeB.position.y = 0.02;
      group.add(tapeB);
      this.scene.add(group);

      const shadow = createShadowBlob(0.42);
      this.scene.add(shadow);

      this.parcels.push({ group, box, shadow, wobble: Math.random() * 6.28 });
    }
  }

  buildWorker() {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId()) || state?.players?.[0];
    const kin = createVoxelKin(me?.color || "#ff5d73", 0);
    kin.scale.setScalar(0.9);
    const label = createNameLabel("du", me?.color || "#ff5d73");
    label.position.y = 0.72;
    kin.add(label);
    // Seitlich neben dem Bandende: er greift sichtbar nach dem vordersten
    // Paket, verdeckt aber nichts, worauf man schauen muss.
    kin.position.set(-2.9, GROUND_Y, BELT_NEAR_Z - 1.5);
    kin.rotation.y = 0.5;
    this.scene.add(kin);
    const shadow = createShadowBlob(0.5);
    shadow.position.set(-2.9, GROUND_Y + 0.02, BELT_NEAR_Z - 1.5);
    this.scene.add(shadow);
    this.worker = kin;
    this.workerAnimator = new KinAnimator(kin);
    this.workerAnimator.groundY = GROUND_Y;
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
    const own = arcade.players[this.getControlledPlayerId()];

    this.syncChutes(arcade, dt, now);
    this.syncBelt(arcade, dt);
    if (own) {
      this.syncParcels(own, arcade, dt, now);
      this.reactToVerdict(own, arcade);
    }
    this.updateFlying(dt);

    this.syncWorker(minigame, arcade, state, own, now, dt);

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.88, dt);
    const shakeX = Math.sin(now / 12) * this.shake * 0.2 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * frameLerp(0.4, dt);
    this.camera.position.y = this.baseCamY || 4.3;
    this.camera.position.z = this.baseCamZ || 8.4;
    this.camera.lookAt(0, 0.9, -1.6);

    this.updateHud(minigame, arcade, state, now, own);
    this.renderer.render(this.scene, this.camera);
  }

  // Die Latten laufen mit dem tatsächlichen Bandtempo. Sie sind das einzige,
  // woran man sieht, dass das Band später schneller wird.
  syncBelt(arcade, dt) {
    const speed = arcade.speed || 0.3;
    this.beltScroll = (this.beltScroll + speed * dt * (BELT_NEAR_Z - BELT_FAR_Z)) % 0.62;
    this.slats.forEach((slat, i) => {
      slat.position.z = BELT_FAR_Z + ((i * 0.62 + this.beltScroll) % BELT_LENGTH);
    });
  }

  syncChutes(arcade, dt, now) {
    const wanted = arcade.chutes || [0, 1, 2];
    const warn = arcade.nextChutes || null;
    const swapped = arcade.lastSwapAt && arcade.lastSwapAt !== this.lastSwapAt;
    if (swapped) {
      this.lastSwapAt = arcade.lastSwapAt;
      this.swapPulse = 1;
      this.feedback?.sound("portal");
      this.feedback?.vibrate(14);
      this.floaters.pop(new THREE.Vector3(0, 2.9, BELT_NEAR_Z - 0.4), "TAUSCH!", { color: "#ffe9a8", size: 0.4, life: 0.85 });
    }
    this.swapPulse = Math.max(0, this.swapPulse - dt * 1.6);

    this.chutes.forEach((chute) => {
      const colour = wanted[chute.index] ?? chute.index;
      if (colour !== chute.shownColour) {
        // Der Wechsel dreht den Trichter einmal um sich selbst. Eine Farbe, die
        // ohne Bewegung umspringt, übersieht man im Augenwinkel.
        chute.shownColour = colour;
        chute.swapSpin = Math.PI * 2;
        chute.base.set(COLOURS[colour]);
      }
      chute.swapSpin = Math.max(0, chute.swapSpin - dt * 9);
      chute.group.rotation.y = chute.swapSpin;
      chute.group.position.y = Math.sin((Math.PI * 2 - chute.swapSpin) * 0.5) * 0.18;

      chute.body.material.color.copy(chute.base);
      chute.flash = Math.max(0, chute.flash - dt * 2.6);

      // Vorwarnung: der Trichter, der gleich eine ANDERE Farbe bekommt,
      // pulsiert weiss. So kann man den Tausch einplanen, statt überrascht zu
      // werden — überrascht werden wäre Zufall, einplanen ist Können.
      const willChange = warn && warn[chute.index] !== colour;
      const pulse = willChange ? (0.35 + Math.sin(now / 90) * 0.3) : 0;
      chute.glow.material.opacity = Math.max(chute.flash, pulse);
      chute.glow.material.color.set(chute.flash > pulse ? "#ffffff" : "#ffe9a8");
      chute.glow.scale.setScalar(1 + chute.flash * 0.22 + pulse * 0.08);
      chute.lip.material.color.set(willChange ? "#ffe9a8" : "#ffffff");
    });
  }

  syncParcels(own, arcade, dt, now) {
    const queue = own.queue || [];
    const head = own.beltPos || 0;
    this.parcels.forEach((visual, slot) => {
      const parcel = queue[slot];
      if (!parcel) {
        visual.group.visible = false;
        visual.shadow.visible = false;
        return;
      }
      const progressCheck = head - slot * (arcade.parcelGap || 0.34);
      if (progressCheck < -0.02) {
        // Noch nicht auf dem Band. Sichtbar waere es ein Stapel am hinteren
        // Ende — man wuerde Pakete sehen, die es noch gar nicht gibt.
        visual.group.visible = false;
        visual.shadow.visible = false;
        return;
      }
      visual.group.visible = true;
      visual.shadow.visible = true;

      // Alle Pakete hängen an EINER Zahl: wie weit das vorderste gelaufen ist.
      // Die dahinter stehen in festem Abstand — deshalb rückt beim Sortieren
      // die ganze Reihe sichtbar nach, statt dass ein Paket aus dem Nichts
      // auftaucht.
      const progress = head - slot * (arcade.parcelGap || 0.34);
      const z = beltZ(progress);
      const scale = 0.62 * (parcel.size || 1);
      visual.group.position.set(0, 0.32 + scale / 2, z);
      visual.group.scale.setScalar(scale);
      visual.shadow.position.set(0, 0.34, z);
      visual.shadow.scale.setScalar(scale * 1.5);

      // Ein leichtes Rütteln: das Band ist eine Maschine, keine Rutschbahn.
      visual.wobble += dt * (5 + (arcade.speed || 0.3) * 7);
      visual.group.rotation.z = Math.sin(visual.wobble) * 0.035;
      visual.group.rotation.y = Math.sin(visual.wobble * 0.4) * 0.05;

      visual.box.material.color.set(COLOURS[parcel.colour] || COLOURS[0]);

      // Das vorderste Paket hebt sich ab, sobald es greifbar ist: es wippt
      // stärker und steht einen Hauch höher.
      if (slot === 0 && own.reachable) {
        const lift = 0.06 + Math.sin(now / 140) * 0.04;
        visual.group.position.y += lift;
      }
    });

    if (this.reachLine) {
      this.reachLine.material.opacity = own.reachable ? 0.25 : 0.75;
    }
  }

  // Sortierte Pakete fliegen sichtbar in ihre Rutsche. Sie einfach verschwinden
  // zu lassen liest sich wie ein Aussetzer des Spiels — man will sehen, wohin
  // die eigene Entscheidung geführt hat.
  spawnFlight(colour, chuteIndex, good) {
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.62, 0.62),
      new THREE.MeshLambertMaterial({ color: COLOURS[colour] || COLOURS[0] })
    );
    proxy.position.set(0, BELT_TOP_Y + 0.31, beltZ(0.55));
    this.scene.add(proxy);
    const target = this.chutes[chuteIndex]?.group.position || new THREE.Vector3(0, 0, BELT_NEAR_Z);
    this.flying.push({
      mesh: proxy,
      from: proxy.position.clone(),
      to: new THREE.Vector3(target.x, good ? CHUTE_MOUTH_Y - 0.3 : BELT_TOP_Y + 0.25, target.z),
      // Ein Fehlgriff prallt ab statt hineinzufallen: der Unterschied muss auch
      // ohne Text erkennbar sein.
      good,
      t: 0,
      spin: (Math.random() - 0.5) * 8
    });
  }

  updateFlying(dt) {
    for (let i = this.flying.length - 1; i >= 0; i -= 1) {
      const fly = this.flying[i];
      fly.t += dt * (fly.good ? 3.1 : 2.3);
      const t = Math.min(1, fly.t);
      const ease = fly.good ? t * t : t;
      fly.mesh.position.lerpVectors(fly.from, fly.to, ease);
      fly.mesh.position.y += Math.sin(t * Math.PI) * (fly.good ? 0.9 : 1.5);
      fly.mesh.rotation.x += fly.spin * dt;
      fly.mesh.rotation.z += fly.spin * dt * 0.6;
      fly.mesh.scale.setScalar(fly.good ? 1 - t * 0.7 : 1 - t * 0.3);
      if (t >= 1) {
        this.scene.remove(fly.mesh);
        fly.mesh.geometry.dispose();
        fly.mesh.material.dispose();
        this.flying.splice(i, 1);
      }
    }
  }

  reactToVerdict(own, arcade) {
    const verdict = own.lastVerdict;
    if (!verdict || verdict.at === this.lastVerdictAt) return;
    this.lastVerdictAt = verdict.at;

    if (verdict.kind === "good") {
      this.spawnFlight(verdict.colour, verdict.chute, true);
      const chute = this.chutes[verdict.chute];
      if (chute) chute.flash = 1;
      const at = new THREE.Vector3(chute?.group.position.x || 0, 1.7, BELT_NEAR_Z);
      this.bursts.spawn(at, [COLOURS[verdict.colour], "#ffffff"], { count: 12, speed: 2.0, up: 1.4, size: 0.07, life: 0.5, drag: 2.2 });
      if (verdict.bonus > 0) {
        this.floaters.pop(at, `+${100 + verdict.bonus}`, { color: "#c6ffb0", size: 0.34, life: 0.7 });
      }
      this.feedback?.sound("coin");
      this.feedback?.vibrate(10);
      this.workerCheerUntil = this.now() + 420;
    } else if (verdict.kind === "wrong") {
      this.spawnFlight(verdict.colour, verdict.chute, false);
      this.floaters.pop(new THREE.Vector3(0, 2.4, BELT_NEAR_Z - 1), "FALSCH", { color: "#ff9aa8", size: 0.38, life: 0.8 });
      this.feedback?.sound("error");
      this.feedback?.vibrate(26);
      this.shake = Math.max(this.shake, 0.45);
      this.workerSadUntil = this.now() + 520;
    } else {
      // Durchgerutscht: das Paket kippt vorne über die Kante.
      const at = new THREE.Vector3(0, 0.5, BELT_NEAR_Z + 0.2);
      this.bursts.spawn(at, [COLOURS[verdict.colour] || "#888", "#6b7a8d"], { count: 10, speed: 1.4, up: 0.4, size: 0.07, life: 0.7, drag: 1.6 });
      this.floaters.pop(new THREE.Vector3(0, 2.2, BELT_NEAR_Z - 1), "DURCH!", { color: "#ffc59a", size: 0.36, life: 0.8 });
      this.feedback?.sound("error");
      this.feedback?.vibrate(18);
      this.shake = Math.max(this.shake, 0.3);
      this.workerSadUntil = this.now() + 520;
    }
  }

  syncWorker(minigame, arcade, state, own, now, dt) {
    if (minigame.finaleAt) {
      // Am Ende freut sich Platz 1 sehr, Platz 4 gar nicht — dieselbe Sprache
      // wie in allen anderen Minispielen.
      const place = this.finalePlace(minigame, arcade, state);
      applyFinaleMood(this.workerAnimator, place, state.players.length);
    } else if (this.workerCheerUntil && now < this.workerCheerUntil) {
      this.workerAnimator.set("cheer");
    } else if (this.workerSadUntil && now < this.workerSadUntil) {
      this.workerAnimator.set("sad");
    } else if (own?.reachable) {
      this.workerAnimator.set("idle", { base: true });
    } else {
      this.workerAnimator.set("idle", { base: true });
    }
    this.workerAnimator.update(now);
  }

  finalePlace(minigame, arcade, state) {
    const scored = state.players
      .map((player) => ({ id: player.id, score: arcade.players[player.id]?.score || 0 }))
      .sort((a, b) => b.score - a.score);
    const index = scored.findIndex((entry) => entry.id === this.getControlledPlayerId());
    return index < 0 ? state.players.length : index + 1;
  }

  updateHud(minigame, arcade, state, now, own) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-belt-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-belt-score]").textContent = String(Math.max(0, Math.round(own?.score || 0)));

    const streak = this.hud.querySelector("[data-belt-streak]");
    if (streak) {
      const run = own?.streak || 0;
      streak.hidden = run < 2;
      streak.textContent = `${run}× in Folge`;
      streak.style.opacity = String(clamp(0.55 + run / 12, 0, 1));
    }

    const chips = this.hud.querySelector("[data-belt-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="belt-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.max(0, Math.round(entry?.score || 0))}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-belt-banner]");
    if (!banner) return;
    const soon = arcade.nextChutes;
    if (soon) {
      banner.hidden = false;
      banner.textContent = "Rutschen tauschen gleich!";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
    } else if (own && !own.reachable) {
      const parcel = own.queue?.[0];
      banner.hidden = false;
      banner.textContent = parcel ? `Nächstes: ${COLOUR_NAMES[parcel.colour] || "?"}` : "Band läuft an";
      banner.style.background = COLOUR_DARK[own.queue?.[0]?.colour ?? 0];
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Im Hochformat höher und näher: dann liegen die drei Rutschen im unteren
      // Drittel des Bildes, genau dort, wo der Daumen ohnehin ist, und das Band
      // füllt die Höhe darüber.
      this.baseCamY = portrait ? 4.3 : 3.8;
      this.baseCamZ = portrait ? 8.4 : 9.6;
      camera.fov = portrait ? 58 : 46;
    });
  }
}
