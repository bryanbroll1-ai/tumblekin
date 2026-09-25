import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createNameLabel } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin200";

// Ballonfahrt: Halten zündet den Brenner und lässt steigen, Loslassen sinken.
// Durch die Tore fliegen, möglichst mittig; wer aneckt, verliert kurz den
// Brenner.
//
// Vorher stand im Korb eine Figur in einem Fünftel ihrer Grösse, kaum zu
// sehen. Jetzt steht sie gross im Korb, reisst beim Halten an der
// Brennerleine, sieht nach dem Anecken Sterne und reckt die Faust, wenn sie
// ein Tor genau in der Mitte trifft. Die Tore stehen dichter, damit man im
// Hochformat sieht, was kommt.
const SHAFT_HEIGHT = 7.2;      // Weltmass fuer Hoehenanteil 0..1
const SHAFT_BOTTOM = 0.4;
// Enger als früher (5.4): im Hochformat sieht man so zwei Tore voraus.
const GATE_SPACING_X = 3.4;
// Die Bahnen liegen in der TIEFE, nicht seitlich — sie müssen es: der Kurs
// läuft in x, alle vier sind am selben Punkt des Kurses. Von vorn deckt der
// vorderste Ballon die drei anderen dadurch fast vollständig ab.
//
// Ein seitlich versetzter Blick fächert sie auf — probiert, und verworfen:
// aus dem Winkel wird aus jedem Tor, das über alle Bahnen reichen muss, eine
// mannshohe Platte quer im Bild. Die Tiefe des Tores ist nur deshalb gratis,
// weil man genau von vorn draufschaut. Also bleibt der Blick frontal, und die
// fremden Ballons werden durchscheinend: man sieht sie hintereinander stehen,
// ohne dass der eigene verdeckt wird.
const LANE_Z = [-1.35, -0.45, 0.45, 1.35];
const GATE_LOOKAHEAD = 4;      // so viele Tore stehen gleichzeitig im Bild

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shaftY(share) {
  return SHAFT_BOTTOM + clamp(share, 0, 1) * SHAFT_HEIGHT;
}

export class BalloonGlide extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.balloons = new Map();
    this.gateVisuals = [];
    this.holding = false;
    this.labelY = 0.74;
    this.ownY = shaftY(0.5);
    this.ownMarker = false;
  }

  stage() {
    return {
      label: "3D Ballonfahrt",
      background: "#9fd8f2",
      fog: ["#cbe9f8", 26, 64],
      lights: { sunPosition: [-6, 14, 9], shadow: { left: -9, right: 9, top: 11, bottom: -3 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-glide-score>0</strong></div>
      <div class="glide-gates" data-glide-gates>0 Tore</div>
      <div class="glide-chips" data-glide-chips></div>
      <div class="color-banner glide-banner" data-glide-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    this.floor = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.6, 34),
      new THREE.MeshLambertMaterial({ color: "#7bbf5e" })
    );
    this.floor.position.set(0, SHAFT_BOTTOM - 0.3, -3);
    this.floor.receiveShadow = true;
    scene.add(this.floor);

    this.ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.5, 7),
      new THREE.MeshLambertMaterial({ color: "#8d9bb5" })
    );
    this.ceiling.position.set(0, SHAFT_BOTTOM + SHAFT_HEIGHT + 0.25, 0);
    scene.add(this.ceiling);

    // Zacken an Boden und Decke: sie sagen ohne Worte, dass Anecken wehtut.
    const spikeGeo = new THREE.ConeGeometry(0.26, 0.5, 4);
    const spikeMat = new THREE.MeshLambertMaterial({ color: "#c9d3e4" });
    for (let i = 0; i < 44; i += 1) {
      const x = -28 + i * 1.3;
      const down = new THREE.Mesh(spikeGeo, spikeMat);
      down.position.set(x, SHAFT_BOTTOM + SHAFT_HEIGHT - 0.25, 0);
      down.rotation.x = Math.PI;
      scene.add(down);
      const up = new THREE.Mesh(spikeGeo, new THREE.MeshLambertMaterial({ color: "#5f9c47" }));
      up.position.set(x, SHAFT_BOTTOM + 0.25, 0);
      scene.add(up);
    }

    for (let i = 0; i < 6; i += 1) {
      const cloud = createCloud(i * 3);
      cloud.position.set(-20 + i * 9, 2 + (i % 3) * 2.4, -7 - (i % 2) * 4);
      cloud.scale.setScalar(1.3);
      scene.add(cloud);
      if (!this.clouds) this.clouds = [];
      this.clouds.push(cloud);
    }

    this.buildGates();
    this.buildBalloons();
  }

  buildGates() {
    for (let i = 0; i < GATE_LOOKAHEAD + 1; i += 1) {
      const group = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: "#ffd15c" });
      // 3.2 tief, damit das Tor über alle vier Bahnen (±1.35) reicht. Die
      // Tiefe kostet im Bild nichts, weil die Kamera frontal draufschaut.
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1, 3.2), mat);
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1, 3.2), mat);
      top.castShadow = true;
      bottom.castShadow = true;
      group.add(top, bottom);

      // Ein leuchtender Balken in der Torluecke: er zeigt die Mitte, und genau
      // die ist mehr wert als der Rand.
      const centre = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 3.1),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false })
      );
      group.add(centre);
      this.scene.add(group);
      this.gateVisuals.push({ group, top, bottom, centre, mat, index: -1, flash: 0 });
    }
  }

  buildBalloons() {
    const state = this.getState();
    const eigeneId = this.getControlledPlayerId();
    (state?.players || []).forEach((player, index) => {
      // Fremde Ballons durchscheinend: sie stehen in derselben Bildspalte
      // hintereinander, und der vorderste hat vorher die drei dahinter
      // komplett verdeckt. Durchscheinend sieht man alle vier Höhen auf
      // einmal — und der eigene bleibt der einzige volldeckende.
      const fremd = player.id !== eigeneId;
      const huelle = (farbe) => new THREE.MeshLambertMaterial(
        fremd
          ? { color: farbe, transparent: true, opacity: 0.5, depthWrite: false }
          : { color: farbe }
      );
      const group = new THREE.Group();

      const points = [];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const y = t * 2.4; 
        let x = 0;
        if (y < 0.6) {
          x = 0.3 + (y / 0.6) * 0.4;
        } else {
          const dy = y - 1.5;
          const r2 = 0.9 * 0.9 - dy * dy;
          x = r2 > 0 ? Math.sqrt(r2) + 0.2 : 0.2;
        }
        points.push(new THREE.Vector2(x, y));
      }
      const envGeo = new THREE.LatheGeometry(points, 24);
      const envelope = new THREE.Mesh(envGeo, huelle(player.color));
      envelope.position.y = 0.8;
      envelope.castShadow = true;
      group.add(envelope);

      // Stripes (we create a slightly larger Lathe, but only some segments)
      const stripeGeo = new THREE.LatheGeometry(points, 24, 0, Math.PI * 0.3);
      const stripe = new THREE.Mesh(stripeGeo, huelle("#ffffff"));
      stripe.scale.setScalar(1.02);
      stripe.position.y = 0.8;
      group.add(stripe);
      
      const stripe2 = new THREE.Mesh(stripeGeo, huelle("#ffffff"));
      stripe2.scale.setScalar(1.02);
      stripe2.position.y = 0.8;
      stripe2.rotation.y = Math.PI;
      group.add(stripe2);

      const basket = new THREE.Mesh(
        new THREE.BoxGeometry(0.74, 0.36, 0.74),
        huelle("#a9763f")
      );
      basket.position.y = 0.15;
      basket.castShadow = true;
      group.add(basket);

      [[-0.22, 0.22], [0.22, 0.22], [-0.22, -0.22], [0.22, -0.22]].forEach(([x, z]) => {
        const rope = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.015, 0.6),
          new THREE.MeshLambertMaterial({ color: "#4a331c" })
        );
        rope.position.set(x, 0.55, z);
        rope.rotation.x = z > 0 ? -0.15 : 0.15;
        rope.rotation.z = x > 0 ? 0.15 : -0.15;
        group.add(rope);
      });

      const flameGeo = new THREE.SphereGeometry(0.25, 8, 8);
      const flameMat = new THREE.MeshBasicMaterial({ color: "#ffaa00", transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.scale.set(1, 1.8, 1);
      flame.position.y = 0.8;
      group.add(flame);

      const label = createNameLabel(player.name, player.color);
      label.position.y = 3.5;
      group.add(label);

      group.position.set(0, shaftY(0.5), LANE_Z[index % LANE_Z.length]);
      this.scene.add(group);

      // Die Figur steht im Korb; addKin legt sie in die Szene, sie wird dem
      // Ballon nachgeführt (siehe tick).
      const kin = this.addKin(player, index, { x: 0, ground: 0, z: group.position.z, facing: 0.3, label: false, scale: 0.82 });
      this.shadows.get(player.id).visible = false;
      this.shadows.get(player.id).userData.manual = true;
      if (fremd) this.fade(player.id, 0.55);
      this.balloons.set(player.id, {
        group, envelope, basket, flame, kin, label,
        bob: Math.random() * 6.28,
        lastBumps: 0,
        lastGateIndex: -1
      });
    });
  }

  shot() {
    return {
      look: [0.9, shaftY(0.5), 0],
      frame: { w: 5.0, h: SHAFT_HEIGHT + 0.6 },
      pitch: 0.04,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.15, zoom: 1.2 },
      finale: { pull: 0.6, zoom: 0.6, lift: 1.2, orbit: 0.12 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Halten = steigen · Loslassen = sinken</p>`;
    this.controls.style.pointerEvents = "none";
    const set = (down) => {
      if (down === this.holding) return;
      this.holding = down;
      if (down) this.feedback?.sound("whoosh");
      this.sendInput({ action: "lift", down }).catch(() => {});
    };
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      set(true);
    });
    this.on(window, "pointerup", () => set(false));
    this.on(window, "pointercancel", () => set(false));
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.balloons.clear();
    this.gateVisuals.length = 0;
  }

  syncGates(arcade, elapsed, dt, own) {
    const gates = arcade.gates || [];
    const spacingMs = gates.length > 1 ? gates[1].at - gates[0].at : 1500;
    const perMs = GATE_SPACING_X / Math.max(1, spacingMs);

    this.gateVisuals.forEach((visual, slot) => {
      // Der erste sichtbare Torindex ergibt sich aus der Zeit; die Koerper
      // werden reihum weiterverwendet.
      const first = Math.max(0, Math.floor((elapsed - (gates[0]?.at ?? 0)) / spacingMs));
      const index = first + slot;
      const gate = gates[index];
      if (!gate) { visual.group.visible = false; return; }
      visual.group.visible = true;

      const x = (gate.at - elapsed) * perMs;
      const half = (gate.gap / 2) * SHAFT_HEIGHT;
      const centreY = shaftY(gate.y);
      const topLen = Math.max(0.2, SHAFT_BOTTOM + SHAFT_HEIGHT - (centreY + half));
      const bottomLen = Math.max(0.2, (centreY - half) - SHAFT_BOTTOM);

      visual.group.position.x = x;
      visual.top.scale.y = topLen;
      visual.top.position.y = centreY + half + topLen / 2;
      visual.bottom.scale.y = bottomLen;
      visual.bottom.position.y = SHAFT_BOTTOM + bottomLen / 2;
      visual.centre.position.y = centreY;

      // Das naechste Tor faerbt sich ein, sobald es das aktuelle ist. Ohne die
      // Markierung sucht man bei vier sichtbaren Toren immer wieder neu.
      const isNext = own ? index === (own.nextGate || 0) : slot === 0;
      visual.flash = Math.max(0, visual.flash - dt * 2.4);
      if (visual.index !== index) { visual.index = index; visual.flash = 0; }
      visual.mat.color.set(isNext ? "#ffd15c" : "#c8bda6");
      visual.centre.material.opacity = isNext ? 0.5 + Math.sin(elapsed / 120) * 0.2 : 0.12;
    });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const own = arcade.players[controlledId];
    this.syncGates(arcade, elapsed, dt, own);
    players.forEach((player) => {
      const visual = this.balloons.get(player.id);
      const entry = arcade.players[player.id];
      const animator = this.animators.get(player.id);
      if (!visual || !entry || !animator) return;
      const isOwn = player.id === controlledId;
      const y = shaftY(entry.y ?? 0.5);
      visual.group.position.y += (y - visual.group.position.y) * frameLerp(0.55, dt);
      const vy = entry.vy || 0;
      visual.group.rotation.z += ((-vy * 0.35) - visual.group.rotation.z) * frameLerp(0.2, dt);
      visual.bob += dt * (2.2 + Math.abs(vy) * 2);
      visual.group.position.x = Math.sin(visual.bob) * 0.07;
      const burning = entry.holding && !entry.stalled;
      const target = burning ? 0.85 + Math.sin(now / 45) * 0.15 : 0;
      visual.flame.material.opacity += (target - visual.flame.material.opacity) * frameLerp(0.3, dt);
      visual.flame.scale.y = 0.7 + visual.flame.material.opacity * 0.8;
      visual.envelope.material.color.set(entry.stalled ? "#8d9bb5" : player.color);
      if (isOwn) this.ownY = visual.group.position.y;
      // Die Figur fährt im Korb mit.
      visual.kin.position.x = visual.group.position.x;
      visual.kin.position.z = visual.group.position.z + 0.02;
      visual.kin.rotation.z = visual.group.rotation.z;
      animator.groundY = visual.group.position.y + 0.02 + 0.3 * 0.82;

      if ((entry.bumps || 0) > visual.lastBumps) {
        visual.lastBumps = entry.bumps;
        animator.trigger("flinch");
        animator.expression("dizzy", 1200);
        if (isOwn) {
          this.rig.shake(0.5);
          this.feedback?.sound("impact");
          this.feedback?.vibrate(24);
        }
        this.burst(visual.group.position.clone().setY(y + 0.4), ["#c9d3e4", player.color], { count: 8 * fxScale(), speed: 1.6, up: 0.6, size: 0.07, life: 0.5, drag: 2.2 });
      }
      const gate = entry.lastGate;
      if (gate && gate.index !== visual.lastGateIndex) {
        visual.lastGateIndex = gate.index;
        const at = visual.group.position.clone().setY(y + 1.1);
        if (gate.hit) {
          if (gate.centre >= 38) animator.trigger("fistpump");
          animator.expression(gate.centre >= 38 ? "joy" : "happy", 600);
          this.burst(at, ["#ffd15c", "#ffffff"], { count: 12 * fxScale(), speed: 2.0, up: 1.2, size: 0.07, life: 0.5, drag: 2.0 });
          if (isOwn) {
            this.feedback?.sound(gate.centre >= 38 ? "perfect" : "coin");
            this.feedback?.vibrate(gate.centre >= 38 ? 16 : 10);
            this.pop(at, gate.centre >= 38 ? "MITTE!" : `+${100 + gate.centre}`, { color: gate.centre >= 38 ? "#ffe9a8" : "#c6ffb0", size: 0.34, life: 0.7 });
          }
        } else {
          animator.trigger("headshake");
          animator.expression("sad", 700);
          if (isOwn) {
            this.feedback?.sound("error");
            this.pop(at, "VORBEI", { color: "#ff9aa8", size: 0.34, life: 0.7 });
          }
        }
      }
      if (finale) return;
      animator.lookAt(new THREE.Vector3(visual.group.position.x + 3, y + 0.5, 0));
      if (entry.stalled) animator.set("dizzy");
      else if (burning) {
        // An der Brennerleine ziehen.
        animator.set("reach", { params: { side: 1 } });
        animator.set("focus");
        animator.expression("effort", 150);
      } else animator.set("idle");
    });
    if (this.clouds) {
      this.clouds.forEach((cloud) => {
        cloud.position.x -= dt * 1.1;
        if (cloud.position.x < -26) cloud.position.x += 52;
      });
    }
  }

  // Die ganze Höhe bleibt im Bild; die Kamera folgt der eigenen Höhe nur
  // ein wenig.
  keepInView() {
    return [];
  }

  rigOptions() {
    return { look: [0.9, shaftY(0.5) + (this.ownY - shaftY(0.5)) * 0.2, 0] };
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-glide-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
    const gates = this.hud.querySelector("[data-glide-gates]");
    if (gates) gates.textContent = `${own?.gatesPassed || 0}/${arcade.gateCount || 0} Tore`;

    const chips = this.hud.querySelector("[data-glide-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="glide-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${entry?.gatesPassed || 0}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-glide-banner]");
    if (!banner) return;
    if (own?.stalled) {
      banner.hidden = false;
      banner.textContent = "Angeeckt — Brenner aus!";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else {
      banner.hidden = true;
    }
  }
}
