import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  standOn
} from "./VoxelKit.js?v=tumblekin125";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin125";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin125";

// Fassmut — ein Fass rollt den Hang herunter auf dich zu und wird dabei immer
// schneller. EIN Tap bremst es. Wer es am dichtesten vor der roten Linie zum
// Stehen bringt, gewinnt den Durchgang; wer zu spät bremst, wird überrollt.
//
// Die Szene hat genau eine Aufgabe: den ABSTAND lesbar machen. Alles andere
// ist Beiwerk. Deshalb
//
//  * blickt die Kamera SEITLICH auf die Bahn statt von hinten. Von hinten
//    sieht man ein Fass grösser werden und muss aus der Grösse auf den
//    Abstand schliessen — von der Seite sieht man die Lücke direkt.
//  * liegen auf der Bahn Meterstriche. Ohne Massstab ist "dicht dran" ein
//    Gefühl; mit ihm ist es eine Zahl, die man beim nächsten Fass anpeilt.
//  * ist die rote Linie kein Strich, sondern eine Schwelle mit Pfosten. Sie
//    muss auch dann zu sehen sein, wenn das Fass davorsteht.
// Am Bild gerechnet, nicht geschätzt. Vier Bahnen müssen im Hochformat AN DER
// LINIE nebeneinander passen — dort steht die Entscheidung, dort schaut man
// hin. Bei Kameraabstand 11 und 54° zeigt das Hochformat an der Linie
// 11 · tan(27°) · 0.461 = 2.58 Einheiten nach jeder Seite. Vier Bahnen mit
// 1.35 Abstand brauchen 1.5 · 1.35 + halbes Fass = 2.4. Passt mit Rand.
//
// Der erste Versuch hatte 2.6 Abstand: da lagen nur zweieinhalb Bahnen im
// Bild, die äusseren beiden Spieler waren schlicht nicht zu sehen.
const LANE_GAP = 1.35;              // seitlicher Abstand zweier Bahnen
const METER = 0.42;                 // Weltmass je Spielmeter
const KIN_Z = 0;                    // die Figur steht auf der Linie
const BARREL_R = 0.38;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class BarrelDare {
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
    this.lanes = new Map();
    this.lastRound = -1;
    this.lastResults = new Map();
    this.lastHitAt = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.finaleDone = false;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, {
      label: "3D Fassmut",
      background: "#8fc9e8",
      fog: ["#a5d8ef", 26, 60],
      fov: 50
    });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-dare-round>Fass 1/3</div>
      <div class="dare-distance" data-dare-distance></div>
      <div class="color-banner" data-dare-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="dare-button" data-dare-brake>
        <span class="dare-button-face">BREMSEN</span>
      </button>
    `;
    this.brakeButton = this.controls.querySelector("[data-dare-brake]");
    this.onBrake = (event) => {
      event.preventDefault();
      this.pressBrake();
    };
    this.brakeButton.addEventListener("pointerdown", this.onBrake);
    // Der ganze Bildschirm bremst mit. Bei einem Spiel, in dem es auf
    // Hundertstel ankommt, ist jeder Weg zum Knopf verlorene Zeit.
    this.webglCanvas.addEventListener("pointerdown", this.onBrake);
    this.loop();
  }

  pressBrake() {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!minigame || minigame.finaleAt || !arcade) return;
    const own = arcade.players?.[this.getControlledPlayerId()];
    if (!own || own.brakeAt !== null || own.hit) {
      this.feedback?.sound("clack");
      return;
    }
    if (arcade.phase !== "roll") {
      this.feedback?.sound("clack");
      return;
    }
    this.feedback?.sound("impact");
    this.feedback?.vibrate([14, 10, 20]);
    this.sendInput({ action: "brake" }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    if (this.onBrake) this.webglCanvas.removeEventListener("pointerdown", this.onBrake);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
    this.lanes.clear();
  }

  createScene() {
    // Später Nachmittag über einer Kiesgrube: warmes Streiflicht von hinten
    // links, damit das Fass eine lange Schattenkante wirft. Genau die sagt
    // dem Auge, wie weit es noch weg ist.
    addStageLights(this.scene, {
      sunPosition: [-7, 9, 5],
      hemiIntensity: 2.1,
      sunIntensity: 3.1,
      skyColor: 0xdfeeff,
      groundColor: 0x9a7a52,
      sunColor: 0xfff0cf
    });

    const state = this.getState();
    const players = state?.players || [];
    const count = Math.max(1, players.length);
    const startM = this.minigame?.arcade?.startM || 14.5;
    const bahnLang = (startM + 6) * METER;

    // Der Grund, auf dem alles steht — bis unter die Kamera und weit hinter
    // den Start, damit nirgends Himmel unter der Bahn durchläuft.
    const grund = new THREE.Mesh(
      new THREE.BoxGeometry(count * LANE_GAP + 16, 0.5, bahnLang + 30),
      new THREE.MeshLambertMaterial({ color: "#c3a173" })
    );
    grund.position.set(0, -0.26, -bahnLang / 2 + 4);
    grund.receiveShadow = true;
    this.scene.add(grund);

    players.forEach((player, index) => this.buildLane(player, index, count, startM, bahnLang));

    // Kiesgruben-Wände links und rechts als Kulisse.
    [-1, 1].forEach((seite) => {
      for (let i = 0; i < 7; i += 1) {
        const hoehe = 2.4 + ((i * 7) % 4) * 1.1;
        const wand = new THREE.Mesh(
          new THREE.BoxGeometry(3.2, hoehe, 4.2),
          new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? "#a8875e" : "#96774f" })
        );
        wand.position.set(
          seite * (count * LANE_GAP / 2 + 4.2 + ((i * 5) % 3) * 0.6),
          hoehe / 2 - 0.4,
          2 - i * (bahnLang / 6)
        );
        this.scene.add(wand);
      }
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.resizeRenderer();
    this.camera.position.set(0, 4.6, 11);
    this.camera.lookAt(0, 1.1, -bahnLang * 0.42);
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  buildLane(player, index, count, startM, bahnLang) {
    const x = this.laneX(index, count);
    const group = new THREE.Group();
    group.position.x = x;
    this.scene.add(group);

    // Die Rollbahn.
    const bahn = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP - 0.18, 0.16, bahnLang),
      new THREE.MeshLambertMaterial({ color: "#d8bd90" })
    );
    bahn.position.set(0, 0.02, -bahnLang / 2 + 2);
    bahn.receiveShadow = true;
    group.add(bahn);

    // Meterstriche: der Massstab, ohne den "dicht dran" nur ein Gefühl ist.
    const strichGeo = new THREE.BoxGeometry(LANE_GAP - 0.34, 0.02, 0.06);
    const striche = new THREE.InstancedMesh(
      strichGeo,
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.3, depthWrite: false }),
      Math.floor(startM / 2)
    );
    const platz = new THREE.Object3D();
    for (let i = 0; i < Math.floor(startM / 2); i += 1) {
      platz.position.set(0, 0.11, -(i + 1) * 2 * METER);
      platz.updateMatrix();
      striche.setMatrixAt(i, platz.matrix);
    }
    striche.instanceMatrix.needsUpdate = true;
    group.add(striche);

    // DIE ROTE LINIE. Kein Strich, sondern eine Schwelle mit zwei Pfosten:
    // steht das Fass direkt davor, muss sie trotzdem zu sehen sein.
    const linie = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP - 0.18, 0.05, 0.22),
      new THREE.MeshLambertMaterial({ color: "#e0334f", emissive: "#e0334f", emissiveIntensity: 0.45 })
    );
    linie.position.set(0, 0.13, 0);
    group.add(linie);
    [-1, 1].forEach((seite) => {
      const pfosten = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 1.1, 0.14),
        new THREE.MeshLambertMaterial({ color: "#e0334f" })
      );
      pfosten.position.set(seite * (LANE_GAP - 0.18) / 2, 0.62, 0);
      pfosten.castShadow = true;
      group.add(pfosten);
    });

    // Das Fass.
    const fass = new THREE.Group();
    const koerper = new THREE.Mesh(
      new THREE.CylinderGeometry(BARREL_R, BARREL_R, LANE_GAP - 0.36, 12),
      new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
    );
    koerper.rotation.z = Math.PI / 2;
    koerper.castShadow = true;
    fass.add(koerper);
    [-0.24, 0.24].forEach((versatz) => {
      const reifen = new THREE.Mesh(
        new THREE.CylinderGeometry(BARREL_R + 0.03, BARREL_R + 0.03, 0.12, 12),
        new THREE.MeshLambertMaterial({ color: "#5a5f6b" })
      );
      reifen.rotation.z = Math.PI / 2;
      reifen.position.x = versatz * (LANE_GAP - 0.36);
      fass.add(reifen);
    });
    // Dauben als Aufdruck: ohne sie sieht man dem Fass die Drehung nicht an,
    // und die Drehung IST die Geschwindigkeitsanzeige.
    for (let i = 0; i < 5; i += 1) {
      const winkel = (i / 5) * Math.PI * 2;
      const daube = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_GAP - 0.42, 0.06, 0.14),
        new THREE.MeshLambertMaterial({ color: "#6e4622" })
      );
      daube.position.set(0, Math.sin(winkel) * BARREL_R, Math.cos(winkel) * BARREL_R);
      daube.rotation.x = -winkel;
      fass.add(daube);
    }
    fass.position.set(0, BARREL_R, -startM * METER);
    group.add(fass);

    const fassSchatten = createShadowBlob(BARREL_R * 1.4);
    fassSchatten.position.set(0, 0.12, -startM * METER);
    group.add(fassSchatten);

    // Die Figur steht hinter der Linie und schaut den Hang hinauf.
    const kin = createVoxelKin(player.color, index);
    kin.scale.setScalar(0.7);
    kin.position.set(0, standOn(0.1) * 0.7, KIN_Z + 0.85);
    kin.rotation.y = Math.PI;
    group.add(kin);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.72;
    kin.add(label);
    const schatten = createShadowBlob(0.34);
    schatten.position.set(0, 0.12, KIN_Z + 0.85);
    group.add(schatten);

    const animator = new KinAnimator(kin);
    animator.groundY = kin.position.y;
    animator.set("idle", { base: true });
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);
    this.lanes.set(player.id, { group, fass, fassSchatten, kin, label, schatten, x });
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
    const startM = arcade.startM || 14.5;

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const lane = this.lanes.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !lane) return;

      // Der Abstand kommt vom Server. In der Auswertungsphase steht dort der
      // Endabstand, in der Rollphase der laufende — beides ist genau das, was
      // gezeichnet werden soll.
      const abstand = entry.hit ? 0 : (entry.distance ?? startM);
      const z = -abstand * METER;
      lane.fass.position.z = THREE.MathUtils.lerp(lane.fass.position.z, z, frameLerp(0.5, dt));
      lane.fassSchatten.position.z = lane.fass.position.z;
      lane.fassSchatten.material.opacity = 0.3;
      // Die Drehung folgt dem WEG, nicht der Zeit: ein stehendes Fass dreht
      // sich nicht, ein schnelles dreht sich schnell. Das ist die ehrlichste
      // Tempoanzeige, die es gibt.
      lane.fass.rotation.x = -lane.fass.position.z / BARREL_R;

      // Gebremst: Staub unter dem Fass, solange es noch rollt.
      if (entry.brakeAt !== null && (entry.barrelSpeed || 0) > 0.3 && Math.random() < 0.5) {
        this.bursts.spawn(
          new THREE.Vector3(lane.x, 0.12, lane.fass.position.z + BARREL_R),
          ["#e8d3ae", "#ffffff"],
          { count: 2, speed: 1.2, up: 0.9, size: 0.07, life: 0.45, drag: 2 }
        );
      }

      // Überrollt: einmal feiern (beziehungsweise betrauern).
      if (entry.hitAt && entry.hitAt !== this.lastHitAt.get(player.id)) {
        this.lastHitAt.set(player.id, entry.hitAt);
        animator.trigger("stumble");
        this.bursts.spawn(
          lane.kin.getWorldPosition(new THREE.Vector3()),
          [player.color, "#e8d3ae", "#ffffff"],
          { count: 18, speed: 2.8, up: 2.4, size: 0.09, life: 0.8, drag: 1.3 }
        );
        this.floaters.pop(
          lane.kin.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.3, 0)),
          "ÜBERROLLT!", { color: "#ff6b7f", size: 0.38, life: 1.1 }
        );
        if (player.id === controlledId) {
          this.shake = 1;
          this.feedback?.sound("impact");
          this.feedback?.vibrate([34, 22, 44]);
        }
      }

      // Ergebnis eines Durchgangs: die Zahl schwebt über der Figur auf.
      const ergebnisse = entry.results || [];
      if (ergebnisse.length !== (this.lastResults.get(player.id) || 0)) {
        this.lastResults.set(player.id, ergebnisse.length);
        const letztes = ergebnisse[ergebnisse.length - 1];
        if (letztes && !letztes.hit) {
          const at = lane.kin.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.3, 0));
          this.floaters.pop(at, `${(letztes.distance).toFixed(2)} m`, {
            color: letztes.points > 180 ? "#7fe0a8" : "#ffe36b",
            size: 0.4,
            life: 1.4,
            rise: 1
          });
          if (player.id === controlledId) {
            this.feedback?.sound(letztes.points > 180 ? "perfect" : "coin");
          }
          animator.trigger(letztes.points > 180 ? "cheer" : "jump");
        }
      }

      // Haltung: wer noch nicht gebremst hat, ist angespannt; wer gebremst
      // hat, entspannt sich sichtbar. Das ist die einzige Rückmeldung, die
      // man auch bei den Mitspielern sieht.
      if (!minigame.finaleAt) {
        if (entry.hit) animator.set("sad", { base: true });
        else if (entry.brakeAt !== null) animator.set("idle", { base: true });
        else animator.set(arcade.phase === "roll" ? "run" : "idle", { base: true });
      } else {
        applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
      }
      // Im Anrollen zittert die Figur mit — je näher das Fass, desto mehr.
      const naehe = clamp(1 - abstand / startM, 0, 1);
      lane.kin.position.x = Math.sin(now / 55) * 0.03 * naehe * (entry.brakeAt === null ? 1 : 0.2);
      animator.update(now);
      lane.schatten.position.x = lane.kin.position.x;
      lane.label.material.opacity = player.id === controlledId ? 1 : 0.82;
    });

    if (minigame.finaleAt && !this.finaleDone) {
      this.finaleDone = true;
      this.feedback?.sound("win");
    }

    this.bursts.update(dt);
    this.floaters.update(dt, this.camera);

    // Die Kamera rückt zur eigenen Bahn, ohne die anderen zu verlieren.
    this.shake *= frameDecay(0.88, dt);
    const eigene = this.lanes.get(controlledId);
    const zielX = (eigene?.x || 0) * 0.35 + Math.sin(now / 16) * this.shake * 0.2 * shakeScale();
    const desired = new THREE.Vector3(zielX, (this.baseCamY || 4.6) + Math.cos(now / 13) * this.shake * 0.14, this.baseCamZ || 11);
    this.camera.position.lerp(desired, frameLerp(0.1, dt));
    this.camera.lookAt((eigene?.x || 0) * 0.2, 1.1, -(startM + 6) * METER * 0.42);

    this.updateHud(minigame, arcade, state, now);
    syncOwnMarker(this, this.kins?.get(controlledId), now, 0.45, 0.5);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.round(own?.points || 0));

    const runde = this.hud.querySelector("[data-dare-round]");
    if (runde) {
      const nummer = Math.max(1, Math.min(arcade.rounds || 3, (arcade.round ?? 0) + 1));
      runde.textContent = `Fass ${nummer}/${arcade.rounds || 3}`;
    }

    // Die laufende Zahl. Sie ist der Grund, warum man beim zweiten Fass
    // besser ist als beim ersten: man hat beim ersten gesehen, bei welchem
    // Abstand man getippt hat.
    const anzeige = this.hud.querySelector("[data-dare-distance]");
    if (anzeige) {
      const abstand = own?.hit ? null : own?.distance;
      if (own?.hit) {
        anzeige.textContent = "— — —";
        anzeige.className = "dare-distance ueberrollt";
      } else if (abstand === null || abstand === undefined) {
        anzeige.textContent = "";
        anzeige.className = "dare-distance";
      } else {
        anzeige.textContent = `${abstand.toFixed(2)} m`;
        anzeige.className = own?.brakeAt !== null ? "dare-distance steht" : "dare-distance";
      }
    }

    const banner = this.hud.querySelector("[data-dare-banner]");
    if (banner) {
      if (arcade.phase === "lead") {
        banner.hidden = false;
        banner.textContent = "Gleich rollt es …";
        banner.style.background = "#ffd15c";
        banner.style.color = "#3a2a05";
      } else if (arcade.phase === "roll" && own && own.brakeAt === null && !own.hit) {
        banner.hidden = false;
        banner.textContent = "BREMSEN!";
        banner.style.background = "#e0334f";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }

    if (this.brakeButton) {
      const bereit = arcade.phase === "roll" && own && own.brakeAt === null && !own.hit;
      this.brakeButton.disabled = !bereit || Boolean(minigame.finaleAt);
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Im Hochformat weiter weg und höher: die Bahn ist lang, und der
      // Abstand zwischen Fass und Linie muss auch dann lesbar sein, wenn das
      // Fass noch am oberen Ende steht.
      this.baseCamY = portrait ? 4.6 : 3.9;
      this.baseCamZ = portrait ? 11 : 9.2;
      camera.fov = portrait ? 54 : 46;
    });
  }
}
