import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressWater } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Angelduell: Halten holt die Schnur ein, aber wenn der Fisch zieht, reisst
// sie bei zu viel Spannung. Wer die meisten Punkte an Land zieht, gewinnt.
//
// Vorher stand nur die eigene Figur auf einem kleinen Steg, die anderen waren
// Zahlen in der Anzeige. Jetzt stehen alle nebeneinander auf einem langen
// Steg, jeder mit Rute, Schnur und eigenem Fisch. Die Rute biegt sich mit der
// Spannung, man lehnt sich beim Einholen zurück, stemmt sich gegen einen
// ziehenden Fisch, fällt hin, wenn die Schnur reisst — und ein gefangener
// Fisch fliegt im Bogen auf die Planken.
const LANE_GAP = 1.35;
const PIER_Z = 0.4;
const PIER_TOP_Y = 0.34;
const FISH_NEAR_Z = -1.6;
const FISH_FAR_Z = -8.5;

export class FishDuel extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lanes = new Map();
    this.holding = false;
    this.lastPingAt = 0;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Angelduell",
      background: "#8ecdf0",
      fog: ["#a9dcf2", 22, 60],
      lights: { sunPosition: [-6, 14, 6], shadow: { left: -6, right: 6, top: 6, bottom: -8 }, groundColor: 0x4e9ec9 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="fish-gauge" data-fish-gauge>
        <span class="fish-gauge-label">Schnur</span>
        <span class="fish-gauge-track"><i data-fish-tension></i></span>
      </div>
      <div class="fish-chips" data-fish-chips></div>
      <div class="color-banner fish-banner" data-fish-banner hidden></div>`;
  }

  laneX(index, count) {
    return (index - (count - 1) / 2) * LANE_GAP;
  }

  build() {
    const scene = this.scene;
    const players = this.getState()?.players || [];
    const count = Math.max(1, players.length);
    const water = new THREE.Mesh(new THREE.BoxGeometry(34, 0.4, 44), new THREE.MeshLambertMaterial({ color: "#2f9fd0" }));
    water.position.set(0, -0.2, -14);
    water.receiveShadow = true;
    scene.add(water);
    dressWater(scene, { seed: 27, waterY: 0, farZ: FISH_FAR_Z - 6, nearZ: 2, width: 34, laneHalf: count * LANE_GAP / 2 + 0.6 });

    // Ein langer Steg quer, Planken und Pfähle.
    const pierW = count * LANE_GAP + 1.6;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(pierW, 0.2, 1.6), new THREE.MeshLambertMaterial({ color: "#a5794f" }));
    deck.position.set(0, PIER_TOP_Y - 0.1, PIER_Z);
    deck.receiveShadow = true;
    deck.castShadow = true;
    scene.add(deck);
    for (let i = 0; i < Math.round(pierW / 0.3); i += 1) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 1.6), new THREE.MeshLambertMaterial({ color: "#7d5a38" }));
      seam.position.set(-pierW / 2 + 0.3 * i, PIER_TOP_Y + 0.002, PIER_Z);
      scene.add(seam);
    }
    for (let i = 0; i <= count; i += 1) {
      [-0.7, 0.7].forEach((dz) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), new THREE.MeshLambertMaterial({ color: "#7d5a38" }));
        post.position.set(-pierW / 2 + 0.2 + i * ((pierW - 0.4) / count), -0.25, PIER_Z + dz);
        scene.add(post);
      });
    }
    // Ufer hinten mit Bäumen, damit die Wasserfläche ein Ende hat.
    const shore = new THREE.Mesh(new THREE.BoxGeometry(40, 0.6, 6), new THREE.MeshLambertMaterial({ color: "#78c46a" }));
    shore.position.set(0, 0.1, FISH_FAR_Z - 9);
    scene.add(shore);
    [[-6.5, 5.4, -18, 4], [6.2, 6.1, -20, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    players.forEach((player, index) => this.addLane(player, index, count));
  }

  addLane(player, index, count) {
    const x = this.laneX(index, count);
    const kin = this.addKin(player, index, { x, ground: PIER_TOP_Y, z: PIER_Z, facing: Math.PI });

    // Die Rute hängt an der Figur, vor dem Bauch in beiden Händen. Zwei
    // Stücke: das vordere biegt sich mit der Spannung.
    const rod = new THREE.Group();
    const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.9, 6), new THREE.MeshLambertMaterial({ color: "#4d3b26" }));
    butt.position.y = 0.45;
    rod.add(butt);
    const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10), new THREE.MeshLambertMaterial({ color: player.color }));
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0.06, 0.18, 0);
    rod.add(reel);
    const tipPivot = new THREE.Group();
    tipPivot.position.y = 0.9;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.028, 0.9, 6), new THREE.MeshLambertMaterial({ color: "#6b5238" }));
    tip.position.y = 0.45;
    tipPivot.add(tip);
    const tipEnd = new THREE.Object3D();
    tipEnd.position.y = 0.9;
    tipPivot.add(tipEnd);
    rod.add(tipPivot);
    rod.position.set(0, -0.08, 0.2);
    rod.rotation.x = 0.9;
    kin.add(rod);

    const fish = this.buildFish();
    fish.position.set(x, 0.1, FISH_FAR_Z);
    this.scene.add(fish);
    const wake = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.9, 20), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.3, depthWrite: false }));
    wake.rotation.x = -Math.PI / 2;
    wake.position.set(x, 0.03, FISH_FAR_Z);
    this.scene.add(wake);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 })
    );
    this.scene.add(line);

    this.lanes.set(player.id, {
      x, kin, rod, reel, tipPivot, tipEnd, fish, wake, line,
      thrash: Math.random() * 6,
      species: null,
      lastSnapAt: 0,
      lastLandedAt: 0,
      wasSurging: false,
      landing: null,
      snapped: 0
    });
  }

  buildFish() {
    const fish = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.78), new THREE.MeshLambertMaterial({ color: "#2b4a63" }));
    body.castShadow = true;
    fish.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.24), new THREE.MeshLambertMaterial({ color: "#223d52" }));
    tail.position.z = 0.5;
    fish.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.3), new THREE.MeshLambertMaterial({ color: "#ffd15c" }));
    fin.position.y = 0.2;
    fish.add(fin);
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
      eye.position.set(side * 0.18, 0.05, -0.28);
      fish.add(eye);
    });
    fish.userData = { body, tail, fin };
    return fish;
  }

  shot() {
    const count = Math.max(1, this.lanes.size);
    return {
      look: [0, 0.55, -1.7],
      frame: { w: count * LANE_GAP + 0.7, h: 3.8 },
      yaw: 0.18,
      pitch: 0.42,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.4 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-fish-reel>
        <span class="nerve-button-face">EINHOLEN</span>
      </button>`;
    const button = this.controls.querySelector("[data-fish-reel]");
    const down = (event) => {
      event.preventDefault();
      this.holding = true;
      this.feedback?.sound("tap");
    };
    const up = () => {
      this.holding = false;
    };
    this.on(button, "pointerdown", down);
    this.on(this.webglCanvas, "pointerdown", down);
    this.on(window, "pointerup", up);
    this.on(window, "pointercancel", up);
  }

  applySpecies(lane, kind) {
    if (!kind || lane.species === kind.id) return;
    lane.species = kind.id;
    const base = new THREE.Color(kind.colour);
    const parts = lane.fish.userData;
    parts.body.material.color.copy(base);
    parts.tail.material.color.copy(base).multiplyScalar(0.78);
    parts.fin.material.color.copy(base).multiplyScalar(0.62);
    lane.speciesScale = kind.size;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const frameNow = performance.now();
    const own = arcade.players[controlledId];
    if (this.holding && !minigame.finaleAt && frameNow - this.lastPingAt > 70) {
      this.lastPingAt = frameNow;
      this.sendInput({ action: "reel" }).catch(() => {});
    }
    if (this.holding && !minigame.finaleAt) {
      const takt = 190 - Math.min(1, Math.max(0, own?.tension ?? 0)) * 110;
      if (frameNow - (this.lastClack || 0) > takt) {
        this.lastClack = frameNow;
        this.feedback?.sound("clack");
      }
    }

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const lane = this.lanes.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !lane || !animator) return;
      const isOwn = player.id === controlledId;
      this.applySpecies(lane, entry.species);
      const tension = Math.min(1, Math.max(0, entry.tension || 0));
      const holding = isOwn ? this.holding || entry.holding : entry.holding;
      const paused = (entry.pauseUntil || 0) > now;

      // Fisch: näher mit sinkender Entfernung, zappelt beim Ziehen.
      const distance = Math.min(1, Math.max(0, entry.distance ?? 1));
      const targetZ = FISH_NEAR_Z + (FISH_FAR_Z - FISH_NEAR_Z) * distance;
      const fish = lane.fish;
      lane.thrash += dt * (entry.surging ? 13 : 3.4);
      if (!lane.landing) {
        fish.visible = !paused;
        fish.position.z += (targetZ - fish.position.z) * frameLerp(0.16, dt);
        fish.position.x = lane.x + Math.sin(lane.thrash) * (entry.surging ? 0.4 : 0.1);
        fish.position.y = 0.08 + (entry.surging ? Math.abs(Math.sin(lane.thrash * 1.3)) * 0.18 : 0);
        fish.rotation.set(0, Math.sin(lane.thrash) * (entry.surging ? 0.5 : 0.14), Math.sin(lane.thrash * 1.7) * (entry.surging ? 0.32 : 0.05));
        fish.userData.tail.rotation.y = Math.sin(lane.thrash * 2.2) * 0.5;
        fish.scale.setScalar((0.9 + (1 - distance) * 0.3) * (lane.speciesScale || 1));
        if (entry.surging && Math.random() < frameChance(0.2, dt)) this.burst(fish.position.clone(), ["#ffffff", "#bfe9ff"], { count: 1, speed: 1, up: 1.2, size: 0.05, life: 0.4 });
      }
      lane.wake.position.set(fish.position.x, 0.03, fish.position.z + 0.2);
      lane.wake.visible = fish.visible && !lane.landing;
      lane.wake.material.opacity = entry.surging ? 0.55 : 0.2;

      // Rute biegt sich, Rolle dreht beim Einholen.
      lane.tipPivot.rotation.x = tension * 0.9 + (entry.surging ? 0.25 : 0);
      if (holding && !paused) lane.reel.rotation.x += dt * 14;
      lane.rod.rotation.x += ((holding ? 0.62 : 0.9) - lane.rod.rotation.x) * frameLerp(0.18, dt);

      // Schnur von der Spitze zum Fisch.
      lane.kin.updateMatrixWorld(true);
      const tip = lane.tipEnd.getWorldPosition(new THREE.Vector3());
      const points = lane.line.geometry.attributes.position;
      points.setXYZ(0, tip.x, tip.y, tip.z);
      points.setXYZ(1, fish.position.x, fish.position.y + 0.08, fish.position.z - 0.3);
      points.needsUpdate = true;
      lane.line.visible = fish.visible && !lane.landing && !paused;
      lane.line.material.color.setRGB(1, 1 - tension * 0.75, 1 - tension * 0.85);

      this.reactToEvents(player, entry, lane, animator, now, isOwn);
      this.tickLanding(lane, now);

      if (finale) return;
      if (now - lane.snapped < 1200) return;
      if (paused) animator.set("idle");
      else if (entry.surging && holding) {
        animator.set("brace");
        animator.expression("effort", 150);
      } else if (holding) animator.set("pull");
      else if (entry.surging) {
        animator.set("focus");
        animator.expression("surprised", 150);
      } else animator.set("focus");
      if (tension > 0.82) animator.expression("scared", 150);
      animator.lookAt(fish.visible ? fish.position : null);
    });
  }

  reactToEvents(player, entry, lane, animator, now, isOwn) {
    if (entry.lastSnapAt && entry.lastSnapAt !== lane.lastSnapAt) {
      const first = lane.lastSnapAt === 0 && now - entry.lastSnapAt > 2000;
      lane.lastSnapAt = entry.lastSnapAt;
      if (!first) {
        lane.snapped = now;
        animator.trigger("knockback");
        animator.trigger("facepalm");
        animator.expression("angry", 1200);
        const at = lane.kin.position.clone().add(new THREE.Vector3(0, 1.2, -0.4));
        this.burst(at, ["#ffffff", "#ff6b7f"], { count: 12, speed: 1.8, up: 1.4, size: 0.06, life: 0.6, drag: 2.0 });
        // Nur die eigene Figur nennt den Abzug — vier Minuszahlen gleichzeitig
        // liest niemand, und fremde Verluste gehen einen nichts an.
        const cost = isOwn ? entry.lastSnapKind?.cost || 0 : 0;
        this.pop(at, cost > 0 ? `GERISSEN! −${cost}` : "GERISSEN!", { color: "#ff9aa8", size: isOwn ? 0.38 : 0.26, life: 1.0 });
        if (isOwn) {
          this.feedback?.sound("error");
          this.feedback?.vibrate([30, 40, 30]);
          this.rig.shake(0.55);
        }
      }
    }
    if (entry.lastLandedAt && entry.lastLandedAt !== lane.lastLandedAt) {
      const first = lane.lastLandedAt === 0 && now - entry.lastLandedAt > 2000;
      lane.lastLandedAt = entry.lastLandedAt;
      if (!first) {
        // Der Fisch fliegt im Bogen auf den Steg und zappelt dort kurz.
        lane.landing = { at: now, from: lane.fish.position.clone(), to: new THREE.Vector3(lane.x - 0.45, PIER_TOP_Y + 0.12, PIER_Z + 0.2) };
        animator.trigger("celebrate");
        animator.expression("joy", 1400);
        const at = lane.kin.position.clone().add(new THREE.Vector3(0, 1.3, 0));
        this.burst(at, [player.color, "#ffe36b", "#ffffff"], { count: 18, speed: 2.2, up: 2.4, size: 0.08, life: 0.8, drag: 1.6 });
        this.pop(at, `FISCH ${entry.landed}!`, { color: "#ffe36b", size: isOwn ? 0.42 : 0.28, life: 1.0 });
        if (isOwn) {
          this.feedback?.sound("perfect");
          this.feedback?.vibrate([10, 14, 20]);
        }
      }
    }
    if (isOwn && entry.surging && !lane.wasSurging) this.feedback?.sound("plink");
    lane.wasSurging = Boolean(entry.surging);
  }

  tickLanding(lane, now) {
    if (!lane.landing) return;
    const u = (now - lane.landing.at) / 700;
    const fish = lane.fish;
    if (u < 1) {
      fish.position.lerpVectors(lane.landing.from, lane.landing.to, u);
      fish.position.y += Math.sin(u * Math.PI) * 2.2;
      fish.rotation.x = u * Math.PI * 3;
      return;
    }
    // Auf den Planken zappeln, dann weg — der nächste beisst schon.
    fish.position.copy(lane.landing.to);
    fish.rotation.set(0, 0.6, Math.PI / 2 + Math.sin(now / 60) * 0.3);
    if (u > 2.6) {
      lane.landing = null;
      fish.visible = false;
    }
  }

  drawHud(f) {
    const { arcade, state, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
    const tension = Math.min(1, Math.max(0, own?.tension || 0));
    const bar = this.hud.querySelector("[data-fish-tension]");
    if (bar) {
      bar.style.transform = `scaleX(${tension.toFixed(3)})`;
      bar.style.background = tension > 0.82 ? "#ff4f68" : tension > 0.6 ? "#ffb24f" : "#7fe06f";
    }
    const chips = this.hud.querySelector("[data-fish-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === f.controlledId;
        return `<span class="fish-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.max(0, Math.round(entry?.score || 0))}</span>`;
      }).join("");
    }
    const banner = this.hud.querySelector("[data-fish-banner]");
    if (!banner) return;
    if ((own?.pauseUntil || 0) > now) {
      banner.hidden = false;
      banner.textContent = "Neu auswerfen …";
      banner.style.background = "#8fa4b4";
      banner.style.color = "#12222c";
    } else if (own?.surging) {
      banner.hidden = false;
      banner.textContent = "ER ZIEHT — LOSLASSEN!";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (tension > 0.82) {
      banner.hidden = false;
      banner.textContent = "Schnur am Limit!";
      banner.style.background = "#ffb24f";
      banner.style.color = "#4a3400";
    } else if (own?.species) {
      banner.hidden = false;
      banner.textContent = `${own.species.name} · ${own.species.points} Punkte`;
      banner.style.background = own.species.colour;
      banner.style.color = "#14252e";
    } else {
      banner.hidden = true;
    }
  }
}
