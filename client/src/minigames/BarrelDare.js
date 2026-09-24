import * as THREE from "/vendor/three/three.module.js";
import { createShadowBlob } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Fassmut — ein Fass rollt den Hang herunter auf dich zu und wird dabei immer
// schneller. EIN Tap bremst es. Wer es am dichtesten vor der roten Linie zum
// Stehen bringt, gewinnt den Durchgang; wer zu spät bremst, wird überrollt.
//
// Die Szene hat eine Aufgabe: den ABSTAND lesbar machen. Deshalb Meterstriche
// auf der Bahn und eine rote Schwelle mit Pfosten statt eines Strichs.
//
// Während das Fass rollt, stehen die Figuren angespannt und schauen bergauf.
// Nach jedem Fass drehen sie sich zur Kamera um und zeigen, wie es lief — vorher
// sah man die ganze Runde nur Hinterköpfe.
const LANE_GAP = 1.35;
const METER = 0.42;
const BARREL_R = 0.38;
const KIN_Z = 0.8;

export class BarrelDare extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lanes = new Map();
    this.lastResults = new Map();
    this.lastHitAt = new Map();
    this.lastBrake = new Map();
  }

  stage() {
    return {
      label: "3D Fassmut",
      background: "#8fc9e8",
      fog: ["#a5d8ef", 30, 70],
      lights: {
        sunPosition: [-7, 9, 5], hemiIntensity: 2.1, sunIntensity: 3.1,
        skyColor: 0xdfeeff, groundColor: 0x9a7a52, sunColor: 0xfff0cf,
        shadow: { left: -8, right: 8, top: 10, bottom: -10 }
      }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-dare-round>Fass 1/3</div>
      <div class="dare-distance" data-dare-distance></div>
      <div class="color-banner" data-dare-banner hidden></div>`;
  }

  build() {
    const players = this.getState()?.players || [];
    const count = Math.max(1, players.length);
    this.startM = this.minigame?.arcade?.startM || 14.5;
    const length = (this.startM + 6) * METER;

    // Ein Hang aus Wiese, in den die Bahnen eingelassen sind.
    const grass = new THREE.Mesh(
      new THREE.BoxGeometry(count * LANE_GAP + 24, 0.5, length + 34),
      new THREE.MeshLambertMaterial({ color: "#86c96f" })
    );
    grass.position.set(0, -0.26, -length / 2 + 6);
    grass.receiveShadow = true;
    this.scene.add(grass);
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(count * LANE_GAP + 0.6, 0.08, length + 1),
      new THREE.MeshLambertMaterial({ color: "#b99366" })
    );
    bed.position.set(0, -0.02, -length / 2 + 2);
    bed.receiveShadow = true;
    this.scene.add(bed);

    players.forEach((player, index) => this.buildLane(player, index, count, length));

    // Am oberen Ende ein Fasslager — von dort kommen sie.
    const shed = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: "#9b6a3a" });
    const roof = new THREE.MeshLambertMaterial({ color: "#d9534f" });
    const back = new THREE.Mesh(new THREE.BoxGeometry(count * LANE_GAP + 1.2, 2.2, 0.3), wood);
    back.position.set(0, 1.1, -this.startM * METER - 1.1);
    shed.add(back);
    const top = new THREE.Mesh(new THREE.BoxGeometry(count * LANE_GAP + 1.6, 0.25, 1.4), roof);
    top.position.set(0, 2.3, -this.startM * METER - 0.6);
    shed.add(top);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.2), wood);
      post.position.set(side * (count * LANE_GAP / 2 + 0.55), 1.1, -this.startM * METER);
      shed.add(post);
    });
    this.scene.add(shed);

    // Bäume und Heuballen am Rand.
    const trunk = new THREE.MeshLambertMaterial({ color: "#7a5330" });
    const leaves = [new THREE.MeshLambertMaterial({ color: "#4f9f55" }), new THREE.MeshLambertMaterial({ color: "#63b267" })];
    for (let i = 0; i < 10; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (count * LANE_GAP / 2 + 2 + (i % 3) * 1.4);
      const z = 3 - i * 1.6;
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1, 0.25), trunk);
      t.position.set(x, 0.5, z);
      this.scene.add(t);
      const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 0), leaves[i % 2]);
      crown.position.set(x, 1.45, z);
      crown.castShadow = true;
      this.scene.add(crown);
    }
    const hay = new THREE.MeshLambertMaterial({ color: "#e8c867" });
    [[-1, 1.6], [1, 0.4], [-1, -2.5], [1, -3.4]].forEach(([side, z]) => {
      const bale = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.6), hay);
      bale.position.set(side * (count * LANE_GAP / 2 + 0.9), 0.25, z);
      bale.castShadow = true;
      this.scene.add(bale);
    });
  }

  shot() {
    // Von hinten und oben über die Figuren den Hang hinauf: die Lücke zwischen
    // Fass und Linie ist die Hauptsache, sie liegt in der Bildmitte.
    const count = Math.max(1, this.getState()?.players?.length || 4);
    return {
      look: [0, 0.4, -1.9],
      frame: { w: count * LANE_GAP + 0.6, h: 4.2 },
      pitch: 0.5,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.3, zoom: 1.5 },
      finale: { pull: 0.5, zoom: 0.55, lift: 0.3 }
    };
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  buildLane(player, index, count, length) {
    const x = this.laneX(index, count);
    const track = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP - 0.18, 0.12, length),
      new THREE.MeshLambertMaterial({ color: index % 2 ? "#e2c89c" : "#d8bd90" })
    );
    track.position.set(x, 0.04, -length / 2 + 2);
    track.receiveShadow = true;
    this.scene.add(track);

    // Meterstriche, jeder zweite Meter.
    const marks = Math.floor(this.startM / 2);
    const stripes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(LANE_GAP - 0.34, 0.02, 0.06),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.4, depthWrite: false }),
      marks
    );
    const helper = new THREE.Object3D();
    for (let i = 0; i < marks; i += 1) {
      helper.position.set(x, 0.11, -(i + 1) * 2 * METER);
      helper.updateMatrix();
      stripes.setMatrixAt(i, helper.matrix);
    }
    stripes.instanceMatrix.needsUpdate = true;
    this.scene.add(stripes);

    // Die rote Schwelle mit Pfosten: auch hinter dem Fass noch sichtbar.
    const red = new THREE.MeshLambertMaterial({ color: "#e0334f", emissive: "#e0334f", emissiveIntensity: 0.4 });
    const line = new THREE.Mesh(new THREE.BoxGeometry(LANE_GAP - 0.18, 0.05, 0.2), red);
    line.position.set(x, 0.12, 0);
    this.scene.add(line);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), red);
      post.position.set(x + side * (LANE_GAP - 0.2) / 2, 0.5, 0);
      post.castShadow = true;
      this.scene.add(post);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), new THREE.MeshLambertMaterial({ color: "#ffffff" }));
      cap.position.set(x + side * (LANE_GAP - 0.2) / 2, 1.0, 0);
      this.scene.add(cap);
    });

    const barrel = buildBarrel();
    barrel.position.set(x, BARREL_R + 0.08, -this.startM * METER);
    this.scene.add(barrel);
    const barrelShadow = createShadowBlob(BARREL_R * 1.5);
    barrelShadow.position.set(x, 0.11, -this.startM * METER);
    this.scene.add(barrelShadow);

    this.addKin(player, index, { x, ground: 0.1, z: KIN_Z, facing: Math.PI });
    this.lanes.set(player.id, { barrel, barrelShadow, x, facing: Math.PI, turnAt: 0 });
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="dare-button" data-dare-brake>
        <span class="dare-button-face">BREMSEN</span>
      </button>`;
    this.brakeButton = this.controls.querySelector("[data-dare-brake]");
    const brake = (event) => {
      event.preventDefault();
      this.pressBrake();
    };
    this.on(this.brakeButton, "pointerdown", brake);
    // Der ganze Bildschirm bremst mit: es geht um Hundertstel.
    this.on(this.webglCanvas, "pointerdown", brake);
  }

  pressBrake() {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!minigame || minigame.finaleAt || !arcade) return;
    const own = arcade.players?.[this.getControlledPlayerId()];
    if (!own || own.brakeAt !== null || own.hit || arcade.phase !== "roll") {
      this.feedback?.sound("clack");
      return;
    }
    this.feedback?.sound("impact");
    this.feedback?.vibrate([14, 10, 20]);
    this.animators.get(this.getControlledPlayerId())?.trigger("push");
    this.sendInput({ action: "brake" }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    const startM = arcade.startM || this.startM;

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const lane = this.lanes.get(player.id);
      const animator = this.animators.get(player.id);
      const kin = this.kins.get(player.id);
      if (!entry || !lane || !animator) return;
      const mine = player.id === controlledId;

      const distance = entry.hit ? -1.2 : (entry.distance ?? startM);
      const z = -distance * METER;
      lane.barrel.position.z += (z - lane.barrel.position.z) * frameLerp(0.5, dt);
      lane.barrelShadow.position.z = lane.barrel.position.z;
      // Die Drehung folgt dem WEG: die ehrlichste Tempoanzeige, die es gibt.
      lane.barrel.rotation.x = -lane.barrel.position.z / BARREL_R;

      if (entry.brakeAt !== null && entry.brakeAt !== this.lastBrake.get(player.id)) {
        this.lastBrake.set(player.id, entry.brakeAt);
        if (!mine) animator.trigger("push");
      }
      if (entry.brakeAt !== null && (entry.barrelSpeed || 0) > 0.3 && Math.random() < frameChance(0.5, dt)) {
        this.burst(new THREE.Vector3(lane.x, 0.14, lane.barrel.position.z + BARREL_R), ["#e8d3ae", "#ffffff"],
          { count: 2, speed: 1.2, up: 0.9, size: 0.07, life: 0.45, drag: 2 });
      }

      // Überrollt: Rückwärtssalto, danach benommen.
      if (entry.hitAt && entry.hitAt !== this.lastHitAt.get(player.id)) {
        this.lastHitAt.set(player.id, entry.hitAt);
        animator.trigger("knockback");
        const at = kin.getWorldPosition(new THREE.Vector3());
        this.burst(at, [player.color, "#e8d3ae", "#ffffff"], { count: 18, speed: 2.8, up: 2.4, size: 0.09, life: 0.8, drag: 1.3 });
        this.pop(at.clone().add(new THREE.Vector3(0, 1.3, 0)), "ÜBERROLLT!", { color: "#ff6b7f", size: 0.4, life: 1.1 });
        if (mine) {
          this.rig.shake(0.8);
          this.feedback?.sound("impact");
          this.feedback?.vibrate([34, 22, 44]);
        }
      }

      // Ergebnis eines Durchgangs: Zahl über der Figur, und sie dreht sich um.
      const results = entry.results || [];
      if (results.length !== (this.lastResults.get(player.id) || 0)) {
        this.lastResults.set(player.id, results.length);
        const last = results[results.length - 1];
        lane.turnAt = now;
        if (last && !last.hit) {
          const at = kin.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.25, 0));
          const great = last.points > 180;
          this.pop(at, `${last.distance.toFixed(2)} m`, { color: great ? "#7fe0a8" : "#ffe36b", size: 0.42, life: 1.4, rise: 1 });
          if (mine) this.feedback?.sound(great ? "perfect" : "coin");
          animator.trigger(great ? "celebrate" : "hop");
        }
      }

      // Blickrichtung: im Rollen bergauf, in der Auflösung zur Kamera.
      const showing = arcade.phase !== "roll" || entry.hit || finale;
      lane.facing += ((showing ? 0 : Math.PI) - lane.facing) * frameLerp(0.14, dt);
      kin.rotation.y = lane.facing;

      if (!finale) {
        if (entry.hit) animator.set("dizzy");
        else if (arcade.phase === "roll") animator.set(entry.brakeAt !== null ? "focus" : "brace");
        else if (arcade.phase === "lead") animator.set("ready");
        else animator.set("idle");
      }
      // Je näher das Fass, desto mehr zittert, wer noch nicht gebremst hat.
      const near = Math.max(0, Math.min(1, 1 - distance / startM));
      const tremble = arcade.phase === "roll" && entry.brakeAt === null && !entry.hit ? near : 0;
      kin.position.x = lane.x + Math.sin(now / 45) * 0.03 * tremble;
    });
  }

  drawHud(f) {
    const { arcade, minigame } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.round(own?.points || 0));
    const round = this.hud.querySelector("[data-dare-round]");
    const number = Math.max(1, Math.min(arcade.rounds || 3, (arcade.round ?? 0) + 1));
    round.textContent = `Fass ${number}/${arcade.rounds || 3}`;

    // Die laufende Zahl: beim zweiten Fass ist man besser, weil man beim ersten
    // gesehen hat, bei welchem Abstand man getippt hat.
    const readout = this.hud.querySelector("[data-dare-distance]");
    if (own?.hit) {
      readout.textContent = "— — —";
      readout.className = "dare-distance ueberrollt";
    } else if (own?.distance === null || own?.distance === undefined) {
      readout.textContent = "";
      readout.className = "dare-distance";
    } else {
      readout.textContent = `${own.distance.toFixed(2)} m`;
      readout.className = own.brakeAt !== null ? "dare-distance steht" : "dare-distance";
    }

    const banner = this.hud.querySelector("[data-dare-banner]");
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
    const ready = arcade.phase === "roll" && own && own.brakeAt === null && !own.hit;
    this.brakeButton.disabled = !ready || Boolean(minigame.finaleAt);
  }
}

function buildBarrel() {
  const barrel = new THREE.Group();
  const width = LANE_GAP - 0.4;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R, BARREL_R, width, 12), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  barrel.add(body);
  [-0.26, 0.26].forEach((offset) => {
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R + 0.03, BARREL_R + 0.03, 0.1, 12), new THREE.MeshLambertMaterial({ color: "#5a5f6b" }));
    hoop.rotation.z = Math.PI / 2;
    hoop.position.x = offset * width;
    barrel.add(hoop);
  });
  // Dauben: ohne sie sieht man dem Fass die Drehung nicht an.
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    const stave = new THREE.Mesh(new THREE.BoxGeometry(width - 0.06, 0.06, 0.14), new THREE.MeshLambertMaterial({ color: "#6e4622" }));
    stave.position.set(0, Math.sin(angle) * BARREL_R, Math.cos(angle) * BARREL_R);
    stave.rotation.x = -angle;
    barrel.add(stave);
  }
  return barrel;
}
