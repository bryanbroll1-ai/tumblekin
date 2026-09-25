import * as THREE from "/vendor/three/three.module.js";
import { createCloud, createShadowBlob, setKinOpacity, standOn } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Sumo-Schubs: in der Mitte liegt ein Stein. Halten lädt auf, loslassen
// stösst ihn weg — wer ihn abbekommt, verliert ein Herz, ohne Herzen ist man
// raus. Man selbst steht immer unten im Bild.
//
// Vorher standen kleine Figuren reglos am Ring, und nur Schriftzüge sagten,
// was passiert. Jetzt sind es stämmige Ringer: sie gehen beim Aufladen in die
// Knie und zittern vor Kraft, stossen mit beiden Armen, werden vom Stein
// zurückgeworfen und fallen, wenn sie raus sind, vom Ring ins Wasser.
const RING_WORLD = 2.35;
const MAT_TOP_Y = 0.09;
const KIN_Y = standOn(MAT_TOP_Y);
const STONE_R = 0.44;
const KIN_SCALE = 1.18;

export class SumoPush extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.meters = new Map();
    this.lastShoveAt = new Map();
    this.lastHits = new Map();
    this.lastEliminated = new Map();
    this.fallAt = new Map();
    this.holdStart = null;
    this.labelY = 0.8;
    this.markerOffset = 0.9;
  }

  stage() {
    return {
      label: "3D Sumo-Schubs",
      background: "#a8e2f4",
      fog: ["#a8e2f4", 16, 40],
      lights: { sunPosition: [3, 11, 5], shadow: { left: -6, right: 6, top: 6, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="sumo-charge" data-sumo-charge hidden>
        <div class="sumo-charge-track">
          <div class="sumo-charge-safe" data-sumo-safe></div>
          <div class="sumo-charge-fill" data-sumo-fill></div>
        </div>
        <span data-sumo-charge-label>Aufladen …</span>
      </div>
      <div class="color-banner" data-sumo-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.5, 30),
      new THREE.MeshLambertMaterial({ color: "#3cb0cf", transparent: true, opacity: 0.94 })
    );
    water.position.y = -2.4;
    scene.add(water);

    // Rundes Podest.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_WORLD + 0.25, RING_WORLD + 0.45, 1.6, 24),
      new THREE.MeshLambertMaterial({ color: "#c9a06b" })
    );
    base.position.y = -0.85;
    base.castShadow = true;
    scene.add(base);
    const mat = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_WORLD, RING_WORLD, 0.14, 24),
      new THREE.MeshLambertMaterial({ color: "#f0dcae" })
    );
    mat.position.y = 0.02;
    mat.receiveShadow = true;
    scene.add(mat);

    // Ringkante — die Linie, über die der Stein nicht darf.
    this.edge = new THREE.Mesh(
      new THREE.TorusGeometry(RING_WORLD, 0.075, 6, 40),
      new THREE.MeshLambertMaterial({ color: "#e0334f", emissive: "#e0334f", emissiveIntensity: 0.45 })
    );
    this.edge.rotation.x = Math.PI / 2;
    this.edge.position.y = 0.1;
    scene.add(this.edge);

    // Der Stein — das wichtigste Objekt der Szene und deshalb bewusst
    // kontraststark: dunkler Kern mit leuchtendem Band. Ein graues Modell auf
    // der beigen Matte war auf einen Blick kaum zu finden.
    this.stone = new THREE.Group();
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(STONE_R, 0),
      new THREE.MeshLambertMaterial({ color: "#3b4654" })
    );
    rock.castShadow = true;
    this.stone.add(rock);
    // Leuchtband, damit die Drehrichtung und die Lage sofort lesbar sind.
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(STONE_R * 0.86, STONE_R * 0.16, 6, 12),
      new THREE.MeshLambertMaterial({ color: "#ffe36b", emissive: "#ffb400", emissiveIntensity: 0.55 })
    );
    band.rotation.x = Math.PI / 2;
    this.stone.add(band);
    this.stoneBand = band;
    this.stoneRock = rock;
    this.stone.position.y = STONE_R + 0.08;
    scene.add(this.stone);
    this.stoneShadow = createShadowBlob(0.6);
    scene.add(this.stoneShadow);

    // Vier Quastenpfosten an den Ringecken. Der Ring stand bisher als nackte
    // Scheibe in einer leeren Fläche Cyan — hier sagen sie auf einen Blick,
    // dass das ein Ring ist und kein Teller. Sie stehen auf den Diagonalen:
    // seitlich wäre bei diesem Hochformat kein Platz, der sichtbare Halbraum
    // ist in Ringtiefe nur gut zwei Einheiten breit.
    [[0.7854, "#e0334f"], [2.3562, "#3fc5e8"], [3.9270, "#ffd15c"], [5.4978, "#71d97b"]]
      .forEach(([winkel, farbe]) => {
      const px = Math.cos(winkel) * (RING_WORLD + 0.34);
      const pz = Math.sin(winkel) * (RING_WORLD + 0.34);
      const pfosten = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.5, 0.12),
        new THREE.MeshLambertMaterial({ color: "#7a4a2c" })
      );
      pfosten.position.set(px, 0.75, pz);
      pfosten.castShadow = true;
      scene.add(pfosten);
      const quaste = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.44, 0.26),
        new THREE.MeshLambertMaterial({ color: farbe })
      );
      quaste.position.set(px, 1.32, pz);
      scene.add(quaste);
    });

    // Schaumkämme auf dem Wasser — eine Instanz statt vieler Meshes.
    const wellen = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.5, 0.06, 0.22),
      new THREE.MeshLambertMaterial({ color: "#bfeaf5" }),
      26
    );
    const kamm = new THREE.Object3D();
    for (let i = 0; i < 26; i += 1) {
      // Fester Streuer, damit das Meer bei jedem Start gleich aussieht.
      const winkel = (i * 2.399) % (Math.PI * 2);
      const radius = 4.2 + ((i * 13) % 9) * 1.1;
      kamm.position.set(Math.cos(winkel) * radius, -2.12, Math.sin(winkel) * radius);
      kamm.rotation.y = winkel + 1.2;
      kamm.scale.setScalar(0.7 + ((i * 7) % 5) * 0.28);
      kamm.updateMatrix();
      wellen.setMatrixAt(i, kamm.matrix);
    }
    wellen.instanceMatrix.needsUpdate = true;
    scene.add(wellen);

    // Inseln am Horizont: sie geben dem Wasser eine Kante.
    [[-9, -13, 1.6, 3.4], [8, -15, 2.1, 4.6], [-2.5, -18, 1.2, 5.2]].forEach(([x, z, h, w]) => {
      const insel = new THREE.Mesh(
        new THREE.CylinderGeometry(w * 0.55, w * 0.8, h, 7),
        new THREE.MeshLambertMaterial({ color: "#5f9c6f" })
      );
      insel.position.set(x, -2.3 + h / 2, z);
      scene.add(insel);
    });

    [[-6, 4.4, -5, 5], [6, 5, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const kin = this.addKin(player, index, { x: 0, ground: MAT_TOP_Y, z: RING_WORLD - 0.5, facing: Math.PI, scale: KIN_SCALE });
      const meter = this.buildMeter(player.color);
      kin.add(meter);
      meter.position.y = 0.95;
      this.meters.set(player.id, meter);
    });
  }

  buildMeter(color) {
    const group = new THREE.Group();
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.09, 0.03),
      new THREE.MeshBasicMaterial({ color: "#16222a", transparent: true, opacity: 0.75, depthWrite: false })
    );
    group.add(back);
    const fill = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.07, 0.04),
      new THREE.MeshBasicMaterial({ color, depthWrite: false })
    );
    fill.position.z = 0.01;
    group.add(fill);
    // Markierung, wo das Überladen beginnt.
    const limit = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.13, 0.05),
      new THREE.MeshBasicMaterial({ color: "#ffffff", depthWrite: false })
    );
    limit.position.z = 0.02;
    group.add(limit);
    group.userData = { fill, limit };
    group.visible = false;
    group.renderOrder = 900;
    return group;
  }

  shot() {
    return {
      look: [0, 0.3, 0.35],
      frame: { w: RING_WORLD * 2 + 0.9, h: 3.8 },
      pitch: 0.72,
      fov: 38,
      intro: { yaw: 0.6, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="sumo-button" data-sumo-push>
        <span class="sumo-button-face">HALTEN &amp; STOSSEN</span>
      </button>`;
    this.button = this.controls.querySelector("[data-sumo-push]");
    const start = (event) => this.beginHold(event);
    const end = (event) => this.endHold(event);
    this.on(this.button, "pointerdown", start);
    this.on(this.webglCanvas, "pointerdown", start);
    this.on(window, "pointerup", end);
    this.on(window, "pointercancel", end);
  }

  ownEntry() {
    const arcade = (this.update || this.minigame)?.arcade;
    return arcade?.players?.[this.getControlledPlayerId()] || null;
  }

  canAct() {
    const own = this.ownEntry();
    if (!own || own.eliminated) return false;
    if ((this.update || this.minigame)?.finaleAt) return false;
    // Solange man aushol̈t, kann man nicht laden — der Knopf muss das zeigen,
    // sonst wirkt ein verschluckter Druck wie ein Aussetzer des Spiels.
    return this.now() >= (own.recoverUntil || 0);
  }

  // Wie weit der Stein in der eigenen Richtung schon draussen ist. Genau diese
  // Zahl entscheidet serverseitig, ob ein Schlag greift — sie muss deshalb auch
  // im Bild stehen, sonst fühlt sich ein Fehlgriff wie Willkür an.
  stoneReach() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = this.ownEntry();
    if (!arcade?.stone || !own) return -1;
    return (arcade.stone.x * own.spotX + arcade.stone.y * own.spotY)
      / Math.max(1e-6, arcade.ringRadius || 1);
  }

  stoneInReach() {
    const arcade = (this.update || this.minigame)?.arcade;
    return this.stoneReach() >= (arcade?.zone ?? 0.35);
  }

  beginHold(event) {
    if (!this.canAct()) return;
    event.preventDefault();
    if (this.holdStart !== null) return;
    this.holdStart = this.now();
    this.feedback?.sound("tap");
    this.sendInput({ action: "charge" }).catch(() => {});
  }

  endHold(event) {
    if (this.holdStart === null) return;
    if (event) event.preventDefault();
    const held = this.now() - this.holdStart;
    this.holdStart = null;
    const arcade = (this.update || this.minigame)?.arcade;
    // Vorwarnung fürs Gefühl; die Entscheidung fällt serverseitig. Zu kurz
    // gehalten zählt gar nicht, und ein Schlag ausserhalb der eigenen
    // Reichweite geht ins Leere.
    if (arcade && held < arcade.chargeMs * 0.14) {
      this.feedback?.sound("clack");
    } else if (!this.stoneInReach()) {
      this.feedback?.sound("swish");
      this.feedback?.vibrate([22, 14, 8]);
    } else {
      this.feedback?.sound("impact");
      this.feedback?.vibrate([14, 8, 20]);
    }
    this.sendInput({ action: "shove" }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    // Das Bild dreht sich so, dass die eigene Figur unten steht.
    const ownEntry = arcade.players[controlledId];
    const ownAngle = ownEntry ? Math.atan2(ownEntry.spotY, ownEntry.spotX) : -Math.PI / 2;
    const viewRot = Math.PI / 2 - ownAngle;
    const rotX = (x, y) => x * Math.cos(viewRot) - y * Math.sin(viewRot);
    const rotY = (x, y) => x * Math.sin(viewRot) + y * Math.cos(viewRot);
    const stone = arcade.stone || { x: 0, y: 0 };
    this.stone.position.x = rotX(stone.x, stone.y) * RING_WORLD;
    this.stone.position.z = rotY(stone.x, stone.y) * RING_WORLD;
    this.stone.position.y = STONE_R + 0.08;
    this.stoneRock.rotation.z -= (stone.vx || 0) * dt * 6;
    this.stoneRock.rotation.x += (stone.vy || 0) * dt * 6;
    this.stoneBand.rotation.z += Math.hypot(stone.vx || 0, stone.vy || 0) * dt * 3;
    this.stoneShadow.position.set(this.stone.position.x, 0.11, this.stone.position.z);
    this.stoneShadow.material.opacity = 0.4;
    this.edge.material.emissiveIntensity = 0.3 + Math.min(1, Math.hypot(stone.x, stone.y)) * 0.7;

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const meter = this.meters.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const out = Boolean(entry.eliminated);
      const viewX = rotX(entry.spotX, entry.spotY);
      const viewZ = rotY(entry.spotX, entry.spotY);
      const spotX = viewX * (RING_WORLD - 0.5);
      const spotZ = viewZ * (RING_WORLD - 0.5);

      if (out && !this.lastEliminated.get(player.id)) {
        this.lastEliminated.set(player.id, true);
        this.fallAt.set(player.id, now);
        animator.trigger("tumble");
        animator.expression("scared", 1200);
      }
      if (out) {
        // Vom Ring ins Wasser, dann treiben.
        const since = (now - (this.fallAt.get(player.id) || now)) / 1000;
        const outX = viewX * (RING_WORLD + 1.1);
        const outZ = viewZ * (RING_WORLD + 1.1);
        kin.position.x += (outX - kin.position.x) * frameLerp(0.1, dt);
        kin.position.z += (outZ - kin.position.z) * frameLerp(0.1, dt);
        animator.groundY = Math.max(-2.1, KIN_Y - since * since * 5);
        setKinOpacity(kin, 0.85);
        if (meter) meter.visible = false;
        if (!finale && since > 0.6) animator.set("float");
        return;
      }
      kin.position.x += (spotX - kin.position.x) * frameLerp(0.12, dt);
      kin.position.z += (spotZ - kin.position.z) * frameLerp(0.12, dt);
      animator.groundY = KIN_Y;
      setKinOpacity(kin, 1);

      const charging = entry.chargeStart !== null && entry.chargeStart !== undefined;
      const ratio = charging ? Math.min(1, Math.max(0, now - entry.chargeStart) / arcade.chargeMs) : 0;
      if (meter) {
        meter.visible = charging;
        if (charging) {
          meter.userData.fill.scale.x = Math.max(0.02, ratio);
          meter.userData.fill.position.x = -0.3 + (0.6 * ratio) / 2;
          meter.userData.fill.material.color.set(ratio >= 1 ? "#7fe06f" : "#ffe36b");
          meter.userData.limit.position.x = 0.3;
          meter.rotation.y = -kin.rotation.y;
        }
      }

      const shove = entry.lastShove;
      if (shove && shove.at !== this.lastShoveAt.get(player.id)) {
        this.lastShoveAt.set(player.id, shove.at);
        if (shove.whiffed) {
          animator.trigger("push");
          animator.trigger("stumble");
          animator.expression("surprised", 700);
          this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "INS LEERE!", { color: "#ff9aa8", size: 0.36, life: 1 });
          if (isOwn) this.rig.shake(0.3);
        } else {
          animator.trigger("push");
          animator.expression("angry", 500);
          const at = new THREE.Vector3(viewX * (RING_WORLD - 1.0), 0.4, viewZ * (RING_WORLD - 1.0));
          const force = shove.power * (shove.meet ?? 1);
          this.burst(at, ["#f0dcae", "#ffffff"], { count: 8 + Math.round(force * 8), speed: 1.6, up: 1.2, size: 0.06, life: 0.5, drag: 2.2 });
          if ((shove.meet ?? 1) > 1.25 && shove.power > 0.8) {
            this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "KONTER!", { color: "#7fe06f", size: 0.4, life: 1 });
          } else if (shove.power > 0.85) {
            this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.3, 0)), "VOLLE KRAFT!", { color: "#ffe36b", size: 0.38, life: 0.9 });
          }
        }
      }
      if ((entry.hits || 0) > (this.lastHits.get(player.id) || 0)) {
        this.lastHits.set(player.id, entry.hits);
        animator.trigger("knockback");
        animator.expression("dizzy", 900);
        const edgeAt = new THREE.Vector3(viewX * RING_WORLD, 0.2, viewZ * RING_WORLD);
        this.burst(edgeAt, ["#e0334f", "#ffffff", player.color], { count: 16, speed: 2.2, up: 1.8, size: 0.08, life: 0.7, drag: 1.5 });
        this.bursts.ring(edgeAt.clone().setY(0.12), "#e0334f", { radius: 1.6, life: 0.55, y: 0.12 });
        const left = Math.max(0, arcade.hitsOut - entry.hits);
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.4, 0)), left > 0 ? `TREFFER! ${left} übrig` : "RAUS!", { color: "#ff6b7f", size: 0.4, life: 1.1 });
        if (isOwn) {
          this.rig.shake(0.9);
          this.feedback?.sound("collision");
          this.feedback?.vibrate([28, 20, 34]);
        }
      }

      if (finale) return;
      // Zur Ringmitte gedreht, den Stein im Blick.
      kin.rotation.y = Math.atan2(-viewX, -viewZ);
      animator.lookAt(this.stone.position);
      const reach = (stone.x * entry.spotX + stone.y * entry.spotY) / Math.max(1e-6, arcade.ringRadius || 1);
      if (charging) animator.set("charge", { params: { power: ratio } });
      else if (now < (entry.recoverUntil || 0)) animator.set("idle");
      else if (reach >= (arcade.zone ?? 0.35)) {
        animator.set("brace");
        animator.expression("scared", 150);
      } else animator.set("ready");
    });
  }

  keepInView(f) {
    return f.players.filter((player) => !f.arcade?.players?.[player.id]?.eliminated).map((player) => this.kins.get(player.id)).filter(Boolean);
  }

  drawHud(f) {
    const { arcade, state, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const left = own ? Math.max(0, arcade.hitsOut - (own.hits || 0)) : 0;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = `♥ ${left}`;
    const charge = this.hud.querySelector("[data-sumo-charge]");
    if (charge) {
      const charging = this.holdStart !== null;
      charge.hidden = !charging;
      if (charging) {
        const held = now - this.holdStart;
        const ratio = Math.min(1, held / arcade.chargeMs);
        const ready = ratio >= 1;
        const inReach = this.stoneInReach();
        const fill = this.hud.querySelector("[data-sumo-fill]");
        const safe = this.hud.querySelector("[data-sumo-safe]");
        const label = this.hud.querySelector("[data-sumo-charge-label]");
        if (fill) {
          fill.style.width = `${ratio * 100}%`;
          fill.style.background = ready ? (inReach ? "#7fe06f" : "#ffe36b") : "#ffb347";
        }
        if (safe) safe.style.width = "100%";
        // Der Text sagt genau das, was über Treffer oder Fehlgriff entscheidet:
        // ist der Stein in Reichweite? Ohne diese Ansage wirkt ein Schlag ins
        // Leere wie ein verschluckter Befehl.
        if (label) {
          label.textContent = !ready
            ? `Lädt ${Math.round(ratio * 100)}%`
            : (inReach ? "JETZT! Stein in Reichweite" : "Warten — noch zu weit weg");
        }
      }
    }

    const banner = this.hud.querySelector("[data-sumo-banner]");
    if (banner) {
      const alive = state.players.filter((p) => !arcade.players[p.id]?.eliminated).length;
      if (own?.eliminated) {
        banner.hidden = false;
        banner.textContent = "Rausgeschubst!";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      } else if (now < (own?.recoverUntil || 0)) {
        banner.hidden = false;
        banner.textContent = "Ausgeholt — kurz ungedeckt!";
        banner.style.background = "#e0334f";
        banner.style.color = "#ffffff";
      } else if (this.stoneReach() >= (arcade.zone ?? 0.35)) {
        banner.hidden = false;
        banner.textContent = "Der Stein kommt auf dich zu!";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if (alive <= 2 && state.players.length > 2) {
        banner.hidden = false;
        banner.textContent = "Nur noch zwei im Ring!";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else {
        banner.hidden = true;
      }
    }
    if (this.button) this.button.disabled = !this.canAct();
  }
}
