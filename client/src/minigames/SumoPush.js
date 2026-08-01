import * as THREE from "/vendor/three/three.module.js";
import {
  applyFinaleMood,
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  setKinOpacity
} from "./VoxelKit.js?v=tumblekin100";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  syncOwnMarker,
  teardownStage
} from "./SceneKit.js?v=tumblekin100";
import { frameDecay, frameLerp, shakeScale } from "./Quality.js?v=tumblekin100";

// Sumo-Schubs — alle stehen im Ring um einen schweren Stein. Halten lädt auf,
// Loslassen stösst. Zu lange gehalten heisst ausrutschen: kein Stoss und eine
// Auszeit. Rollt der Stein über deine Kante, kassierst du einen Treffer.
const RING_WORLD = 2.6;        // Weltradius des Rings (Server rechnet 0..1)
const KIN_Y = 0.62;
const STONE_R = 0.44;

export class SumoPush {
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
    this.meters = new Map();       // playerId -> Ladebalken über dem Kin
    this.lastShoveAt = new Map();
    this.lastHits = new Map();
    this.lastEliminated = new Map();
    this.lastFrameAt = performance.now();
    this.shake = 0;
    // Lokaler Ladezustand für die Anzeige; verbindlich ist der Server.
    this.holdStart = null;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Sumo-Schubs", fog: ["#a8e2f4", 16, 40], fov: 46, far: 80 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="sumo-charge" data-sumo-charge hidden>
        <div class="sumo-charge-track">
          <div class="sumo-charge-safe" data-sumo-safe></div>
          <div class="sumo-charge-fill" data-sumo-fill></div>
        </div>
        <span data-sumo-charge-label>Aufladen …</span>
      </div>
      <div class="color-banner" data-sumo-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="sumo-button" data-sumo-push>
        <span class="sumo-button-face">HALTEN &amp; STOSSEN</span>
      </button>
    `;
    this.button = this.controls.querySelector("[data-sumo-push]");

    // Halten = laden, Loslassen = stossen. Auch auf der Szene, damit der Daumen
    // nicht wandern muss.
    this.onHoldStart = (event) => this.beginHold(event);
    this.onHoldEnd = (event) => this.endHold(event);
    [this.button, this.webglCanvas].forEach((element) => {
      element.addEventListener("pointerdown", this.onHoldStart);
    });
    window.addEventListener("pointerup", this.onHoldEnd);
    window.addEventListener("pointercancel", this.onHoldEnd);
    this.loop();
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

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    [this.button, this.webglCanvas].forEach((element) => {
      element?.removeEventListener("pointerdown", this.onHoldStart);
    });
    window.removeEventListener("pointerup", this.onHoldEnd);
    window.removeEventListener("pointercancel", this.onHoldEnd);
    teardownStage(this);
    this.kins.clear();
    this.animators.clear();
    this.meters.clear();
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [3, 11, 5],
      shadow: { left: -6, right: 6, top: 6, bottom: -6 }
    });

    // Wasser weit unten — der Stein fällt sichtbar irgendwohin.
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.5, 30),
      new THREE.MeshLambertMaterial({ color: "#3cb0cf", transparent: true, opacity: 0.94 })
    );
    water.position.y = -2.4;
    this.scene.add(water);

    // Rundes Podest.
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_WORLD + 0.25, RING_WORLD + 0.45, 1.6, 24),
      new THREE.MeshLambertMaterial({ color: "#c9a06b" })
    );
    base.position.y = -0.85;
    base.castShadow = true;
    this.scene.add(base);
    const mat = new THREE.Mesh(
      new THREE.CylinderGeometry(RING_WORLD, RING_WORLD, 0.14, 24),
      new THREE.MeshLambertMaterial({ color: "#f0dcae" })
    );
    mat.position.y = 0.02;
    mat.receiveShadow = true;
    this.scene.add(mat);

    // Ringkante — die Linie, über die der Stein nicht darf.
    this.edge = new THREE.Mesh(
      new THREE.TorusGeometry(RING_WORLD, 0.075, 6, 40),
      new THREE.MeshLambertMaterial({ color: "#e0334f", emissive: "#e0334f", emissiveIntensity: 0.45 })
    );
    this.edge.rotation.x = Math.PI / 2;
    this.edge.position.y = 0.1;
    this.scene.add(this.edge);

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
    this.scene.add(this.stone);
    this.stoneShadow = createShadowBlob(0.6);
    this.scene.add(this.stoneShadow);

    [[-6, 4.4, -5, 5], [6, 5, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.getState()?.players?.forEach((player, index) => this.ensureKin(player, index));
    this.resizeRenderer();
    this.camera.position.set(0, 5.4, 6.2);
    this.camera.lookAt(0, 0.4, 0);
  }

  // Ladebalken über dem Kopf: grün im nutzbaren Bereich, rot ab dem Überladen.
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

  ensureKin(player, index = 0) {
    if (this.kins.has(player.id)) return this.kins.get(player.id);
    const kin = createVoxelKin(player.color, index);
    const label = createNameLabel(player.name.slice(0, 7), player.color);
    label.position.y = 0.62;
    kin.add(label);
    const shadow = createShadowBlob(0.5);
    this.scene.add(shadow);
    kin.userData.label = label;
    kin.userData.shadow = shadow;
    this.scene.add(kin);
    const animator = new KinAnimator(kin);
    animator.groundY = KIN_Y;
    this.kins.set(player.id, kin);
    this.animators.set(player.id, animator);

    const meter = this.buildMeter(player.color);
    kin.add(meter);
    meter.position.y = 0.92;
    this.meters.set(player.id, meter);
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

    // Ansicht so drehen, dass der eigene Platz immer vorne an der Kamera liegt.
    // Ohne das hing der eigene Kin je nach Spielerindex am oberen Bildrand,
    // während ein Gegner vorne stand — man sah nicht, ob der Stein auf die
    // EIGENE Kante zurollt, und genau das ist die entscheidende Information.
    const ownEntry = arcade.players[controlledId];
    const ownAngle = ownEntry ? Math.atan2(ownEntry.spotY, ownEntry.spotX) : -Math.PI / 2;
    const viewRot = Math.PI / 2 - ownAngle;
    const rotX = (x, y) => x * Math.cos(viewRot) - y * Math.sin(viewRot);
    const rotY = (x, y) => x * Math.sin(viewRot) + y * Math.cos(viewRot);

    // Stein: Serverkoordinaten (Einheitskreis) auf die Weltgrösse abbilden.
    const stone = arcade.stone || { x: 0, y: 0 };
    this.stone.position.x = rotX(stone.x, stone.y) * RING_WORLD;
    this.stone.position.z = rotY(stone.x, stone.y) * RING_WORLD;
    this.stone.position.y = STONE_R + 0.08;
    // Rollrichtung: der Stein dreht sich passend zur Bewegung.
    this.stoneRock.rotation.z -= (stone.vx || 0) * dt * 6;
    this.stoneRock.rotation.x += (stone.vy || 0) * dt * 6;
    this.stoneBand.rotation.z += Math.hypot(stone.vx || 0, stone.vy || 0) * dt * 3;
    this.stoneShadow.position.set(this.stone.position.x, 0.11, this.stone.position.z);
    // Kräftigerer Schatten: verankert den Stein sichtbar auf der Matte.
    this.stoneShadow.material.opacity = 0.4;

    // Die Ringkante glüht auf der Seite, zu der der Stein läuft.
    const drift = Math.hypot(stone.x, stone.y);
    this.edge.material.emissiveIntensity = 0.3 + Math.min(1, drift) * 0.7;

    state.players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const kin = this.ensureKin(player, index);
      const animator = this.animators.get(player.id);
      const meter = this.meters.get(player.id);
      const out = Boolean(entry.eliminated);

      // Platz am Ringrand (in Ansichtsdrehung), Blick zur Mitte.
      const viewX = rotX(entry.spotX, entry.spotY);
      const viewZ = rotY(entry.spotX, entry.spotY);
      const spotX = viewX * (RING_WORLD - 0.42);
      const spotZ = viewZ * (RING_WORLD - 0.42);
      // Ausgeschiedene treten einen Schritt zurück und werden blass.
      const push = out ? 1.5 : 1;
      kin.position.x = THREE.MathUtils.lerp(kin.position.x, spotX * push, frameLerp(0.12, dt));
      kin.position.z = THREE.MathUtils.lerp(kin.position.z, spotZ * push, frameLerp(0.12, dt));
      kin.rotation.y = Math.atan2(-viewX, -viewZ);
      setKinOpacity(kin, out ? 0.4 : 1);

      // Ladebalken: nur beim eigenen Laden sichtbar (Server kennt chargeStart).
      const charging = entry.chargeStart !== null && entry.chargeStart !== undefined && !out;
      if (meter) {
        meter.visible = charging;
        if (charging) {
          const held = Math.max(0, now - entry.chargeStart);
          const ratio = Math.min(1, held / arcade.chargeMs);
          meter.userData.fill.scale.x = Math.max(0.02, ratio);
          meter.userData.fill.position.x = -0.3 + (0.6 * ratio) / 2;
          // Grün, sobald voll — halten kostet nichts mehr, es IST die Deckung.
          meter.userData.fill.material.color.set(ratio >= 1 ? "#7fe06f" : "#ffe36b");
          meter.userData.limit.position.x = 0.3;
          meter.rotation.y = -kin.rotation.y;      // Balken bleibt zur Kamera
        }
      }

      // Stoss: Ausfallschritt zur Mitte.
      const shove = entry.lastShove;
      const seen = this.lastShoveAt.get(player.id);
      if (shove && shove.at !== seen) {
        this.lastShoveAt.set(player.id, shove.at);
        if (shove.whiffed) {
          animator?.trigger("stumble");
          this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "INS LEERE!", { color: "#ff9aa8", size: 0.36, life: 1 });
          if (player.id === controlledId) this.shake = Math.max(this.shake, 0.3);
        } else {
          animator?.trigger("jump");
          const at = new THREE.Vector3(viewX * (RING_WORLD - 0.9), 0.4, viewZ * (RING_WORLD - 0.9));
          // Die Wucht ist Kraft mal Konter — der Funkenschlag zeigt beides.
          const force = shove.power * (shove.meet ?? 1);
          this.bursts.spawn(at, ["#f0dcae", "#ffffff"], { count: 8 + Math.round(force * 8), speed: 1.6, up: 1.2, size: 0.06, life: 0.5, drag: 2.2 });
          // Den Konter ausdrücklich benennen: dass ein entgegenrollender Stein
          // härter zurückgeht, ist der Kniff, den man dem Spiel ansehen muss.
          if ((shove.meet ?? 1) > 1.25 && shove.power > 0.8) {
            this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "KONTER!", { color: "#7fe06f", size: 0.4, life: 1 });
          } else if (shove.power > 0.85) {
            this.floaters.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), "VOLLE KRAFT!", { color: "#ffe36b", size: 0.38, life: 0.9 });
          }
        }
      }

      // Treffer: der Stein ist über diese Kante gerollt.
      if ((entry.hits || 0) > (this.lastHits.get(player.id) || 0)) {
        this.lastHits.set(player.id, entry.hits);
        animator?.trigger("hit");
        const edgeAt = new THREE.Vector3(viewX * RING_WORLD, 0.2, viewZ * RING_WORLD);
        this.bursts.spawn(edgeAt, ["#e0334f", "#ffffff", player.color], { count: 16, speed: 2.2, up: 1.8, size: 0.08, life: 0.7, drag: 1.5 });
        this.bursts.ring(edgeAt.clone().setY(0.12), "#e0334f", { radius: 1.6, life: 0.55, y: 0.12 });
        const left = Math.max(0, arcade.hitsOut - entry.hits);
        this.floaters.pop(
          kin.position.clone().add(new THREE.Vector3(0, 1.3, 0)),
          left > 0 ? `TREFFER! ${left} übrig` : "RAUS!",
          { color: "#ff6b7f", size: 0.4, life: 1.1 }
        );
        if (player.id === controlledId) {
          this.shake = Math.max(this.shake, 0.9);
          this.feedback?.sound("collision");
          this.feedback?.vibrate([28, 20, 34]);
        }
      }

      if (out && !this.lastEliminated.get(player.id)) {
        this.lastEliminated.set(player.id, true);
        animator?.trigger("fall");
      }

      if (minigame.finaleAt) applyFinaleMood(animator, arcade.places?.[player.id], state.players.length);
      else animator?.set(out ? "sad" : "idle", { base: true });
      animator?.update(now);

      kin.userData.shadow.position.set(kin.position.x, 0.11, kin.position.z);
      kin.userData.shadow.material.opacity = out ? 0.12 : 0.26;
      kin.userData.label.material.opacity = player.id === controlledId ? 1 : 0.8;
    });

    this.bursts.update(dt);
    this.floaters.update(dt);

    // Kamera schaut von oben in den Ring und folgt dem Stein ein Stück.
    this.shake *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 15) * this.shake * 0.24 * shakeScale();
    const desired = new THREE.Vector3(
      this.stone.position.x * 0.18 + shakeX,
      this.baseCamY || 5.4,
      (this.baseCamZ || 6.2) + this.stone.position.z * 0.14
    );
    this.camera.position.lerp(desired, frameLerp(0.1, dt));
    this.camera.lookAt(this.stone.position.x * 0.3, 0.35, this.stone.position.z * 0.3);

    this.updateHud(minigame, arcade, state, now);
    syncOwnMarker(this, this.kins?.get(controlledId), now);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(minigame, arcade, state, now) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const own = arcade.players[this.getControlledPlayerId()];
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    const left = own ? Math.max(0, arcade.hitsOut - (own.hits || 0)) : 0;
    this.hud.querySelector("[data-kinetic-score]").textContent = `♥ ${left}`;

    // Eigener Ladebalken im HUD — grösser und damit besser dosierbar als der
    // kleine Balken über dem Kopf.
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

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      this.baseCamY = portrait ? 6.0 : 5.4;
      this.baseCamZ = portrait ? 6.8 : 6.2;
      camera.fov = portrait ? 54 : 46;
    });
  }
}
