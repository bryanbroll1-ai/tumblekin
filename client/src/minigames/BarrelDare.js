import * as THREE from "/vendor/three/three.module.js";
import { reachArm } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Fassmut — über jedem hängt ein Fass am Seil, das Seil läuft über eine Rolle
// am Galgen und hinunter in die eigenen Hände. Das Fass wird losgelassen und
// fällt, das Seil saust durch die Hände. EIN Tipp: die Figur packt zu, das
// Seil spannt sich und fängt das Fass ab. Wer es am dichtesten über dem
// eigenen Kopf zum Stehen bringt, gewinnt — wer zu spät zieht, bekommt es ab.
//
// Vorher rollte das Fass einen Hang hinunter, drei Mal hintereinander. Jetzt
// fällt es, einmal, und wann es losgelassen wird, weiss vorher keiner.
//
// Die Fallkurve rechnet der Client mit denselben Zahlen wie der Server nach
// (dareBarrelAt dort). Zwischen zwei Servertakten würde das Fass sonst in
// Sprüngen fallen — und genau auf das Fallen schaut man hier.
const LANE_GAP = 1.4;
const METER = 0.3;                    // Weltmass je Meter Fallhöhe
const HEAD_TOP = 0.86;                // Oberkante des Kopfes
const BARREL_R = 0.3;
const BARREL_H = 0.62;
const KIN_Z = 0.3;
const SPEED0 = 1.8;                   // wie DARE_SPEED0 auf dem Server
const ACCEL = 1.0;                    // wie DARE_ACCEL
const BRAKE = 3.33;                   // wie DARE_BRAKE
const FALLOFF_M = 9;                  // ab hier gibt es keine Punkte mehr

function barrelAt(t, brakeAt, startM) {
  const rollTime = brakeAt === null || brakeAt === undefined ? t : Math.min(t, brakeAt);
  const speed = SPEED0 + ACCEL * rollTime;
  let travelled = SPEED0 * rollTime + 0.5 * ACCEL * rollTime * rollTime;
  let v = speed;
  if (brakeAt !== null && brakeAt !== undefined && t > brakeAt) {
    const braking = Math.min(t - brakeAt, speed / BRAKE);
    travelled += speed * braking - 0.5 * BRAKE * braking * braking;
    v = Math.max(0, speed - BRAKE * braking);
  }
  return { distance: Math.max(0, startM - travelled), speed: v };
}

// Ein dünner Zylinder zwischen zwei Punkten — für Seile.
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
function stretch(mesh, a, b) {
  _dir.subVectors(b, a);
  const length = Math.max(0.001, _dir.length());
  mesh.position.copy(a).addScaledVector(_dir, 0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(_up, _dir.divideScalar(length));
}

export class BarrelDare extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lanes = new Map();
    this.lastResults = new Map();
    this.lastHitAt = new Map();
    this.lastBrake = new Map();
    this.localBrake = null;
    this.labelY = 0.95;
  }

  stage() {
    return {
      label: "3D Fassmut",
      background: "#9fd3ef",
      fog: ["#b5def2", 24, 60],
      lights: {
        sunPosition: [-5, 11, 7], hemiIntensity: 2.1, sunIntensity: 3.0,
        skyColor: 0xdfeeff, groundColor: 0x9a7a52, sunColor: 0xfff0cf,
        shadow: { left: -7, right: 7, top: 9, bottom: -3 }
      }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="dare-distance" data-dare-distance></div>
      <div class="color-banner" data-dare-banner hidden></div>`;
  }

  build() {
    const players = this.getState()?.players || [];
    const count = Math.max(1, players.length);
    this.count = count;
    this.startM = this.minigame?.arcade?.startM || 14.5;
    this.beamY = HEAD_TOP + this.startM * METER + BARREL_H + 0.62;
    const width = count * LANE_GAP;

    // Ein Holzhof: Dielen, dahinter eine Lagerhalle mit gestapelten Fässern.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(width + 18, 0.3, 14), new THREE.MeshLambertMaterial({ color: "#c9a26f" }));
    deck.position.set(0, -0.15, -2);
    deck.receiveShadow = true;
    this.scene.add(deck);
    const plankMat = new THREE.MeshLambertMaterial({ color: "#b58c5a" });
    for (let i = 0; i < 12; i += 1) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(width + 18, 0.01, 0.04), plankMat);
      seam.position.set(0, 0.006, 4 - i * 1.1);
      this.scene.add(seam);
    }
    const hall = new THREE.Mesh(new THREE.BoxGeometry(width + 16, this.beamY + 2.6, 0.5), new THREE.MeshLambertMaterial({ color: "#d86b52" }));
    hall.position.set(0, (this.beamY + 2.6) / 2, -3.2);
    hall.receiveShadow = true;
    this.scene.add(hall);
    const trim = new THREE.MeshLambertMaterial({ color: "#f3e6cf" });
    for (let i = 0; i < 4; i += 1) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(width + 16, 0.12, 0.08), trim);
      band.position.set(0, 1.4 + i * 1.8, -2.93);
      this.scene.add(band);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 0.1), new THREE.MeshLambertMaterial({ color: "#7a4b2a" }));
    door.position.set(-width / 2 - 2.8, 1.4, -2.9);
    this.scene.add(door);
    // Fassstapel links und rechts.
    [[-1, 0], [1, 0.6]].forEach(([side, shift]) => {
      for (let row = 0; row < 3; row += 1) {
        for (let k = 0; k < 3 - row; k += 1) {
          const stacked = buildBarrel();
          stacked.rotation.z = Math.PI / 2;
          stacked.position.set(side * (width / 2 + 1.8 + shift) + (k - (2 - row) / 2) * 0.66 * side, BARREL_R + row * 0.56, -2.3);
          this.scene.add(stacked);
        }
      }
    });

    // Der Galgen: ein Balken über alle Bahnen, zwei Pfosten, Streben.
    const wood = new THREE.MeshLambertMaterial({ color: "#8b5a32" });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 0.26, 0.34), wood);
    beam.position.set(0, this.beamY, 0.1);
    beam.castShadow = true;
    this.scene.add(beam);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.26, this.beamY + 0.2, 0.26), wood);
      post.position.set(side * (width / 2 + 0.45), (this.beamY + 0.2) / 2 - 0.1, 0.1);
      post.castShadow = true;
      this.scene.add(post);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), wood);
      strut.position.set(side * (width / 2 + 0.05), this.beamY - 0.45, 0.1);
      strut.rotation.z = side * 0.7;
      this.scene.add(strut);
    });
    const sign = makeSign("FASSMUT");
    sign.position.set(0, this.beamY + 0.42, 0.3);
    this.scene.add(sign);

    players.forEach((player, index) => this.buildLane(player, index, count));
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  buildLane(player, index, count) {
    const x = this.laneX(index, count);
    const pulleyY = this.beamY - 0.3;

    // Rolle am Balken.
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.09, 14), new THREE.MeshLambertMaterial({ color: "#5a5f6b" }));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, pulleyY, 0.13);
    this.scene.add(wheel);
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), new THREE.MeshLambertMaterial({ color: "#3d424c" }));
    hanger.position.set(x, pulleyY + 0.15, 0.13);
    this.scene.add(hanger);

    // Messlatte neben der Bahn: grün dicht über dem Kopf, gelb dahinter, grau
    // wo es nichts mehr gibt. Dazu die rote Kopflinie quer über die Bahn.
    const ruler = new THREE.Group();
    const bands = [[0, 1, "#57d27a"], [1, 3, "#ffd15c"], [3, FALLOFF_M, "#fff4dd"], [FALLOFF_M, this.startM, "#b9b3a8"]];
    bands.forEach(([from, to, color]) => {
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.1, (to - from) * METER, 0.06), new THREE.MeshLambertMaterial({ color }));
      part.position.set(0, HEAD_TOP + ((from + to) / 2) * METER, 0);
      ruler.add(part);
    });
    for (let m = 1; m < this.startM; m += 1) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(m % 5 === 0 ? 0.22 : 0.15, 0.02, 0.07), new THREE.MeshBasicMaterial({ color: "#3a2a1a" }));
      tick.position.set(0.02, HEAD_TOP + m * METER, 0.01);
      ruler.add(tick);
    }
    ruler.position.set(x + 0.56, 0, -0.05);
    this.scene.add(ruler);
    const headLine = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP - 0.2, 0.03, 0.03),
      new THREE.MeshBasicMaterial({ color: "#ff3b55", transparent: true, opacity: 0.8 })
    );
    headLine.position.set(x, HEAD_TOP, 0.02);
    this.scene.add(headLine);

    const barrel = buildBarrel();
    this.scene.add(barrel);

    const ropeMat = new THREE.MeshLambertMaterial({ color: "#e2c48a" });
    const ropeGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6);
    const ropeTop = new THREE.Mesh(ropeGeo, ropeMat);
    const ropeHand = new THREE.Mesh(ropeGeo, ropeMat);
    const ropeTail = new THREE.Mesh(ropeGeo, ropeMat);
    [ropeTop, ropeHand, ropeTail].forEach((rope) => this.scene.add(rope));
    // Knoten, die am Seil entlanglaufen: so sieht man, dass es durch die
    // Hände saust — und dass es steht, sobald man zupackt.
    const knots = [0, 1, 2, 3].map(() => {
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.06), new THREE.MeshLambertMaterial({ color: "#9c7a44" }));
      this.scene.add(knot);
      return knot;
    });
    // Die Seilrolle am Boden, die kleiner wird, je mehr Seil ausläuft.
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 16), ropeMat);
    coil.rotation.x = Math.PI / 2;
    coil.position.set(x + 0.28, 0.04, KIN_Z + 0.32);
    this.scene.add(coil);

    this.addKin(player, index, { x, ground: 0, z: KIN_Z, facing: 0 });
    this.lanes.set(player.id, {
      x, barrel, ropeTop, ropeHand, ropeTail, knots, coil, pulleyY,
      shown: this.startM, settledAt: null, squashAt: null, fell: null
    });
  }

  shot() {
    return {
      look: [0, this.beamY * 0.5, 0.2],
      frame: { w: 2.9, h: this.beamY + 0.9 },
      pitch: 0.12,
      fov: 38,
      intro: { yaw: 0.45, pitch: 0.2, zoom: 1.4 },
      finale: { pull: 0.6, zoom: 0.6, lift: 0.2 }
    };
  }

  // Beim Fallen die eigene Bahn formatfüllend, in der Auflösung alle.
  rigOptions(f) {
    const arcade = f.arcade;
    const own = this.lanes.get(f.controlledId);
    const all = !arcade || arcade.phase === "show" || f.finale;
    if (all || !own) {
      return { look: [0, this.beamY * 0.45, 0.2], frame: { w: this.count * LANE_GAP + 0.6, h: this.beamY + 0.9 } };
    }
    return { look: [own.x * 0.9, this.beamY * 0.5, 0.2], frame: { w: 2.9, h: this.beamY + 0.9 } };
  }

  keepInView(f) {
    const arcade = f.arcade;
    if (arcade && arcade.phase !== "show" && !f.finale) {
      const own = this.kins.get(f.controlledId);
      return own ? [own] : [];
    }
    return [...this.kins.values()];
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="dare-button" data-dare-brake>
        <span class="dare-button-face">SEIL ZIEHEN</span>
      </button>`;
    this.brakeButton = this.controls.querySelector("[data-dare-brake]");
    const brake = (event) => {
      event.preventDefault();
      this.pressBrake();
    };
    this.on(this.brakeButton, "pointerdown", brake);
    // Der ganze Bildschirm zieht mit: es geht um Hundertstel.
    this.on(this.webglCanvas, "pointerdown", brake);
  }

  // Sekunden seit dem Loslassen, aus der eigenen Uhr.
  fallTime(arcade, minigame, now) {
    return (now - minigame.startedAt - (arcade.leadIn || 0)) / 1000;
  }

  pressBrake() {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!minigame || minigame.finaleAt || !arcade) return;
    const own = arcade.players?.[this.getControlledPlayerId()];
    const t = this.fallTime(arcade, minigame, this.now());
    const rolling = t >= 0 && t * 1000 < (arcade.rollMs || 4200);
    if (!own || own.brakeAt !== null || own.hit || this.localBrake !== null || !rolling) {
      this.feedback?.sound("clack");
      return;
    }
    // Sofort selbst abfangen, nicht erst, wenn der Server es bestätigt.
    this.localBrake = t;
    this.feedback?.sound("impact");
    this.feedback?.vibrate([14, 10, 20]);
    this.animators.get(this.getControlledPlayerId())?.trigger("pull");
    this.sendInput({ action: "brake" }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, minigame, players, controlledId, finale } = f;
    if (!arcade) return;
    const startM = arcade.startM || this.startM;
    const t = this.fallTime(arcade, minigame, now);
    const rollMs = arcade.rollMs || 4200;
    const falling = t >= 0 && t * 1000 < rollMs;

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const lane = this.lanes.get(player.id);
      const animator = this.animators.get(player.id);
      const kin = this.kins.get(player.id);
      if (!entry || !lane || !animator || !kin) return;
      const mine = player.id === controlledId;

      // Wo das Fass steht: vor dem Loslassen oben, danach nach der Fallkurve.
      let brakeAt = entry.brakeAt;
      if (mine && this.localBrake !== null && (brakeAt === null || brakeAt === undefined)) brakeAt = this.localBrake;
      const settled = entry.results?.length > 0;
      let distance;
      let speed = 0;
      if (t < 0) {
        distance = startM;
      } else if (settled) {
        const last = entry.results[entry.results.length - 1];
        distance = last.hit ? 0 : last.distance;
      } else {
        const stand = barrelAt(Math.min(t, rollMs / 1000), brakeAt, startM);
        distance = entry.hit ? 0 : stand.distance;
        speed = stand.speed;
      }
      const hit = entry.hit || (settled && entry.results[entry.results.length - 1].hit)
        || (falling && distance <= 0.001 && (brakeAt === null || brakeAt === undefined));

      // Nach dem Abfangen federt das Seil kurz nach: das Fass wird ein Stück
      // hochgezogen und pendelt aus.
      const caught = brakeAt !== null && brakeAt !== undefined && !hit && speed < 0.02 && t >= 0;
      if (caught && lane.settledAt === null) {
        lane.settledAt = now;
        if (mine) this.feedback?.sound("pop");
      }
      const since = lane.settledAt === null ? 0 : (now - lane.settledAt) / 1000;
      const lift = caught ? Math.sin(Math.min(1, since / 0.35) * Math.PI) * 0.35 * Math.exp(-since * 1.5) + Math.min(0.12, since * 0.4) : 0;
      lane.shown = distance + lift;

      const bottom = HEAD_TOP + Math.max(0, lane.shown) * METER;
      const swing = t < 0 ? Math.sin(now / 520 + lane.x) * 0.05 : caught ? Math.sin(since * 9) * 0.08 * Math.exp(-since * 2) : 0;

      if (hit) {
        // Voll auf den Kopf: die Figur wird gestaucht, das Fass kippt zur Seite.
        if (lane.squashAt === null) lane.squashAt = now;
        const s = (now - lane.squashAt) / 1000;
        const tip = Math.min(1, Math.max(0, (s - 0.45) / 0.5));
        lane.barrel.position.set(lane.x + tip * 0.62, HEAD_TOP - 0.28 * Math.min(1, s / 0.12) * (1 - tip) + tip * (BARREL_R - HEAD_TOP + 0.02), 0);
        lane.barrel.rotation.set(0, 0, -tip * Math.PI / 2);
        const squash = s < 0.12 ? 1 - (s / 0.12) * 0.55 : s < 0.8 ? 0.45 : Math.min(1, 0.45 + (s - 0.8) * 2.5);
        kin.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);
      } else {
        lane.barrel.position.set(lane.x, bottom, 0);
        lane.barrel.rotation.set(0, 0, swing);
        kin.scale.set(1, 1, 1);
      }

      // Seile: oben von der Rolle zum Fass, vorn von der Rolle in die Hände,
      // und ein Rest bis zur Rolle am Boden.
      const top = new THREE.Vector3(lane.x, lane.pulleyY, 0.0);
      const barrelTop = lane.barrel.localToWorld(new THREE.Vector3(0, BARREL_H + 0.06, 0));
      if (hit && lane.squashAt !== null && now - lane.squashAt > 450) barrelTop.set(lane.x + 0.3, HEAD_TOP, 0);
      stretch(lane.ropeTop, top, barrelTop);
      const front = new THREE.Vector3(lane.x, lane.pulleyY, 0.26);
      const hands = new THREE.Vector3(lane.x + Math.sin(now / 90) * (falling && !caught && !hit ? 0.01 : 0), kin.position.y + 0.1, KIN_Z + 0.16);
      stretch(lane.ropeHand, front, hands);
      const coilAt = lane.coil.position;
      stretch(lane.ropeTail, hands, coilAt);
      const paid = (startM - Math.max(0, distance)) / startM;
      lane.coil.scale.setScalar(Math.max(0.35, 1 - paid * 0.65));
      lane.knots.forEach((knot, i) => {
        const along = ((i / lane.knots.length) + (startM - Math.max(0, distance)) * 0.12) % 1;
        knot.position.lerpVectors(hands, front, along);
      });
      lane.hands = hands;

      if (entry.brakeAt !== null && entry.brakeAt !== undefined && entry.brakeAt !== this.lastBrake.get(player.id)) {
        this.lastBrake.set(player.id, entry.brakeAt);
        if (!mine) animator.trigger("pull");
      }
      // Solange das Seil durch die Hände saust, qualmt es ein bisschen.
      if (falling && !caught && !hit && Math.random() < frameChance(0.6 + (1 - distance / startM) * 2, dt)) {
        this.burst(hands.clone(), ["#fff4dd", "#e2c48a"], { count: 1, speed: 0.4, up: 0.6, size: 0.04, life: 0.4, gravity: -0.5 });
      }

      // Getroffen.
      if (hit && !this.lastHitAt.get(player.id)) {
        this.lastHitAt.set(player.id, now);
        animator.trigger("knockback");
        animator.expression("dizzy", 2600);
        const at = kin.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0));
        this.burst(at, [player.color, "#c9a26f", "#ffffff"], { count: 18, speed: 2.6, up: 2.2, size: 0.09, life: 0.8, drag: 1.3 });
        this.pop(at.clone().add(new THREE.Vector3(0, 0.5, 0)), "BONK!", { color: "#ff6b7f", size: 0.46, life: 1.2 });
        if (mine) {
          this.rig.shake(0.9);
          this.feedback?.sound("impact");
          this.feedback?.vibrate([34, 22, 44]);
        }
      }

      // Ergebnis: Zahl über dem Fass.
      const results = entry.results || [];
      if (results.length !== (this.lastResults.get(player.id) || 0)) {
        this.lastResults.set(player.id, results.length);
        const last = results[results.length - 1];
        if (last && !last.hit) {
          const at = lane.barrel.position.clone().add(new THREE.Vector3(0, BARREL_H + 0.45, 0.3));
          const great = last.distance < 1;
          this.pop(at, `${last.distance.toFixed(2)} m`, { color: great ? "#7fe0a8" : "#ffe36b", size: 0.44, life: 1.8, rise: 0.6 });
          if (mine) this.feedback?.sound(great ? "perfect" : "coin");
          animator.trigger(great ? "celebrate" : "hop");
        }
      }

      animator.lookAt(hit ? null : lane.barrel.position);
      if (finale) return;
      if (hit) animator.set("dizzy");
      else if (caught) animator.set("pull");
      else if (t >= 0 && falling) animator.set("brace");
      else animator.set("ready");
      // Je näher das Fass, desto mehr zittert, wer noch nicht gezogen hat.
      const near = Math.max(0, Math.min(1, 1 - distance / startM));
      const tremble = falling && !caught && !hit && (brakeAt === null || brakeAt === undefined) ? near : 0;
      kin.position.x = lane.x + Math.sin(now / 45) * 0.03 * tremble;
      if (tremble > 0.5) animator.expression("scared", 200);
    });
  }

  // Die Hände ans Seil, solange niemand gestaucht am Boden liegt.
  afterAnimate(f) {
    f.players.forEach((player) => {
      const lane = this.lanes.get(player.id);
      const kin = this.kins.get(player.id);
      const entry = f.arcade?.players?.[player.id];
      if (!lane?.hands || !kin || !entry || lane.squashAt !== null || f.finale) return;
      reachArm(kin, 0, lane.hands.clone().add(new THREE.Vector3(0.05, 0.05, 0)), 1);
      reachArm(kin, 1, lane.hands.clone().add(new THREE.Vector3(-0.05, -0.04, 0)), 1);
    });
  }

  drawHud(f) {
    const { arcade, minigame, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const lane = this.lanes.get(f.controlledId);
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.round(own?.points || 0));

    const t = this.fallTime(arcade, minigame, now);
    const falling = t >= 0 && t * 1000 < (arcade.rollMs || 4200);
    const braked = (own?.brakeAt !== null && own?.brakeAt !== undefined) || this.localBrake !== null;
    const readout = this.hud.querySelector("[data-dare-distance]");
    const last = own?.results?.[own.results.length - 1];
    if (own?.hit || last?.hit || this.lastHitAt.get(f.controlledId)) {
      readout.textContent = "BONK";
      readout.className = "dare-distance ueberrollt";
    } else if (t < 0 || !lane) {
      readout.textContent = "";
      readout.className = "dare-distance";
    } else {
      readout.textContent = `${Math.max(0, last ? last.distance : lane.shown).toFixed(2)} m`;
      readout.className = braked ? "dare-distance steht" : "dare-distance";
    }

    const banner = this.hud.querySelector("[data-dare-banner]");
    if (t < 0) {
      banner.hidden = false;
      banner.textContent = "Gleich lässt es los …";
      banner.style.background = "#ffd15c";
      banner.style.color = "#3a2a05";
    } else if (falling && own && !braked && !own.hit) {
      banner.hidden = false;
      banner.textContent = "ZIEHEN!";
      banner.style.background = "#e0334f";
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }
    this.brakeButton.disabled = !(falling && own && !braked && !own.hit) || Boolean(minigame.finaleAt);
  }
}

function buildBarrel() {
  const barrel = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R, BARREL_R * 0.94, BARREL_H, 14), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
  body.position.y = BARREL_H / 2;
  body.castShadow = true;
  barrel.add(body);
  const bulge = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R + 0.03, BARREL_R + 0.03, BARREL_H * 0.5, 14), new THREE.MeshLambertMaterial({ color: "#9a6835" }));
  bulge.position.y = BARREL_H / 2;
  barrel.add(bulge);
  [0.08, BARREL_H - 0.08].forEach((y) => {
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R + 0.035, BARREL_R + 0.035, 0.06, 14), new THREE.MeshLambertMaterial({ color: "#5a5f6b" }));
    hoop.position.y = y;
    barrel.add(hoop);
  });
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R * 0.85, BARREL_R * 0.85, 0.02, 14), new THREE.MeshLambertMaterial({ color: "#6e4622" }));
  lid.position.y = BARREL_H + 0.01;
  barrel.add(lid);
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 10), new THREE.MeshLambertMaterial({ color: "#5a5f6b" }));
  eye.position.y = BARREL_H + 0.06;
  barrel.add(eye);
  return barrel;
}

function makeSign(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3e2b8";
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = "#6b4424";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 56);
  ctx.fillStyle = "#6b4424";
  ctx.font = "900 38px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.05), [
    new THREE.MeshLambertMaterial({ color: "#6b4424" }),
    new THREE.MeshLambertMaterial({ color: "#6b4424" }),
    new THREE.MeshLambertMaterial({ color: "#6b4424" }),
    new THREE.MeshLambertMaterial({ color: "#6b4424" }),
    new THREE.MeshLambertMaterial({ map: texture }),
    new THREE.MeshLambertMaterial({ color: "#6b4424" })
  ]);
  return sign;
}
