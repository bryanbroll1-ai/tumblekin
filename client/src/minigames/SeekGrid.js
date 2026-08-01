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
} from "./VoxelKit.js?v=tumblekin101";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin101";
import { frameDecay, frameLerp, fxScale, shakeScale } from "./Quality.js?v=tumblekin101";

// Spürsinn — im Feld liegt ein Fundstück versteckt. Jeder Tipp auf ein Feld
// verrät, wie viele Schritte es bis dorthin sind. Wer die Angaben kombiniert,
// hat es in zwei bis drei Tipps.
//
// Das einzige Minispiel, das nachdenken verlangt statt zu reagieren — und die
// Darstellung muss dem dienen. Zwei Entscheidungen folgen daraus:
//
//  * Die Zahl steht auf dem Feld, nicht am Rand. Beim Kombinieren schaut man
//    zwischen den Feldern hin und her; eine Liste am Bildrand wäre ein zweiter
//    Ort für den Blick, und genau dort reisst der Gedanke ab.
//  * Zusätzlich die Farbe: heiss (nah) bis kalt (weit). Die Zahl ist die
//    Wahrheit, die Farbe der erste Eindruck — man sieht die Richtung schon,
//    bevor man gelesen hat.
const SIZE = 6;
const TILE = 0.82;                       // Kantenlänge eines Feldes
const GAP = 0.06;
const STEP = TILE + GAP;

// Heiss nach kalt. Der Index ist die Schrittzahl; alles darüber bleibt beim
// letzten Ton, sonst bräuchte man bei 6x6 zehn Abstufungen, die niemand
// auseinanderhält.
const HEAT = ["#ffe9a8", "#ff5d73", "#ff8a4c", "#ffbe3d", "#c9d94a", "#6fd28a", "#3fc5e8", "#4f8fe0", "#5a63c9"];

function heatColour(steps) {
  return HEAT[Math.min(HEAT.length - 1, Math.max(0, steps))];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Ziffernschilder werden EINMAL gebaut und geteilt. Ein Feld kann bis zu zehn
// Schritte weit weg sein, und in einer langen Runde werden hunderte Felder
// aufgedeckt — für jedes eine eigene Textur anzulegen hiesse, im Laufe eines
// Abends hunderte Texturen auf der Grafikkarte liegen zu lassen.
function buildDigitMaterials() {
  const materials = [];
  for (let value = 0; value <= 12; value += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 96, 96);
    ctx.fillStyle = "rgba(23, 32, 38, 0.86)";
    ctx.font = "900 74px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(value), 48, 52);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    materials.push(new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, toneMapped: false
    }));
  }
  return materials;
}

export class SeekGrid {
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
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tiles = [];
    this.hitTargets = [];
    this.digitMaterials = [];
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.shownRound = -1;
    this.shownFindAt = 0;
    this.lastProbeCount = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Spürsinn", background: "#2b3a4f", fog: ["#3d5068", 22, 54], fov: 56, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-seek-round>Tipps: 0</div>
      <div class="simon-chips" data-seek-chips></div>
      <div class="color-banner" data-seek-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `<p class="trace-hint">Tippe ein Feld — die Zahl sagt, wie viele Schritte bis zum Fund</p>`;
    this.controls.style.pointerEvents = "none";

    this.onTap = (event) => {
      event.preventDefault();
      this.tapAt(event);
    };
    this.webglCanvas.addEventListener("pointerdown", this.onTap);
    this.loop();
  }

  tapAt(event) {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || !this.camera) return;
    const rect = this.webglCanvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitTargets, false);
    if (hits.length === 0) return;
    const { gx, gy } = hits[0].object.userData;
    const tile = this.tileAt(gx, gy);
    // Ein schon aufgedecktes Feld noch einmal zu tippen ist ein Verrutscher.
    // Der Server nimmt es stillschweigend hin; hier wackelt das Feld kurz,
    // damit man merkt, dass der Tipp nichts gekostet hat.
    if (tile?.revealed) {
      tile.nudge = 1;
      this.feedback?.sound("clack");
      return;
    }
    if (tile) tile.press = 1;
    this.feedback?.sound("tap");
    this.sendInput({ action: "probe", x: gx, y: gy }).catch(() => {});
  }

  tileAt(gx, gy) {
    return this.tiles[gy * SIZE + gx] || null;
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    this.webglCanvas?.removeEventListener("pointerdown", this.onTap);
    // Die geteilten Ziffernschilder gehören dieser Szene, nicht dem Baum — der
    // allgemeine Aufräumer sieht sie nicht, weil ungenutzte Schilder gar nicht
    // in der Szene hängen.
    this.digitMaterials.forEach((material) => {
      material.map?.dispose();
      material.dispose();
    });
    this.digitMaterials.length = 0;
    teardownStage(this);
    this.tiles.length = 0;
    this.hitTargets.length = 0;
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-5, 13, 7],
      shadow: { left: -6, right: 6, top: 8, bottom: -4 }
    });

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(16, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#3a4a5e" })
    );
    floor.position.y = -0.25;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Der Rahmen macht aus 36 losen Klötzen ein Suchfeld — ohne ihn schwebt das
    // Raster im Nichts und man verliert am Rand die Orientierung.
    const span = SIZE * STEP;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(span + 0.5, 0.16, span + 0.5),
      new THREE.MeshLambertMaterial({ color: "#22303f" })
    );
    frame.position.y = 0.05;
    frame.receiveShadow = true;
    this.scene.add(frame);

    this.digitMaterials = buildDigitMaterials();

    const digitGeometry = new THREE.PlaneGeometry(TILE * 0.72, TILE * 0.72);
    for (let gy = 0; gy < SIZE; gy += 1) {
      for (let gx = 0; gx < SIZE; gx += 1) {
        this.buildTile(gx, gy, digitGeometry);
      }
    }

    // Das Fundstück selbst. Es liegt immer bereit und taucht nur auf, wenn es
    // gefunden wurde — ein Modell statt eines pro Fund neu gebauten.
    this.gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3, 0),
      new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#7a5a00" })
    );
    this.gem.castShadow = true;
    this.gem.visible = false;
    this.scene.add(this.gem);

    [[-6.2, 6.4, -9, 3], [5.8, 7.1, -10, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildSearcher();
    this.resizeRenderer();
    this.camera.position.set(0, 7.4, 5.4);
    this.camera.lookAt(0, 0, 0);
  }

  buildTile(gx, gy, digitGeometry) {
    const span = SIZE * STEP;
    const x = gx * STEP - span / 2 + STEP / 2;
    const z = gy * STEP - span / 2 + STEP / 2;

    const group = new THREE.Group();
    group.position.set(x, 0, z);
    this.scene.add(group);

    const block = new THREE.Mesh(
      new THREE.BoxGeometry(TILE, 0.34, TILE),
      new THREE.MeshLambertMaterial({ color: "#8fa4bb" })
    );
    block.position.y = 0.3;
    block.castShadow = true;
    block.receiveShadow = true;
    group.add(block);

    // Das Ziffernschild liegt flach auf dem Klotz und ist unsichtbar, solange
    // das Feld zu ist.
    const digit = new THREE.Mesh(digitGeometry, this.digitMaterials[0]);
    digit.rotation.x = -Math.PI / 2;
    digit.position.y = 0.48;
    digit.visible = false;
    group.add(digit);

    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(TILE, 0.7, TILE),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(x, 0.35, z);
    hit.userData.gx = gx;
    hit.userData.gy = gy;
    this.scene.add(hit);
    this.hitTargets.push(hit);

    this.tiles.push({
      gx, gy, group, block, digit,
      x, z,
      revealed: false,
      steps: -1,
      press: 0,
      nudge: 0,
      lift: 0,
      closed: new THREE.Color("#8fa4bb"),
      target: new THREE.Color("#8fa4bb")
    });
  }

  buildSearcher() {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId()) || state?.players?.[0];
    const kin = createVoxelKin(me?.color || "#ff5d73", 0);
    kin.scale.setScalar(0.74);
    const label = createNameLabel("du", me?.color || "#ff5d73");
    label.position.y = 0.72;
    kin.add(label);
    const edge = (SIZE * STEP) / 2 + 1.0;
    kin.position.set(0, 0, edge);
    this.scene.add(kin);
    const shadow = createShadowBlob(0.42);
    shadow.position.set(0, 0.06, edge);
    this.scene.add(shadow);
    this.searcher = kin;
    this.searcherCheerUntil = 0;
    this.searcherAnimator = new KinAnimator(kin);
    this.searcherAnimator.groundY = 0;
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

    this.syncBoard(own, now);
    this.syncTiles(dt, now);
    this.syncGem(own, now, dt);
    this.syncSearcher(minigame, arcade, state, own, now);

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.87, dt);
    const shakeX = Math.sin(now / 11) * this.shake * 0.16 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * frameLerp(0.4, dt);
    this.camera.position.y = this.baseCamY || 7.4;
    this.camera.position.z = this.baseCamZ || 5.4;
    this.camera.lookAt(0, 0, 0);

    this.updateHud(minigame, arcade, state, now, own);
    this.renderer.render(this.scene, this.camera);
  }

  // Das Brett aus dem Serverzustand nachziehen. Der Server schickt die Tipps
  // der laufenden Runde; alles andere ist wieder zu.
  syncBoard(own, now) {
    if (!own) return;

    // Neue Runde: alles schliesst sich wieder. Erkennbar an der Rundennummer,
    // nicht daran, dass die Tippliste leer ist — leer ist sie auch im ersten
    // Augenblick des Spiels.
    if (own.round !== this.shownRound) {
      this.shownRound = own.round;
      this.tiles.forEach((tile) => {
        tile.revealed = false;
        tile.steps = -1;
        tile.digit.visible = false;
        tile.target.set("#8fa4bb");
      });
      this.lastProbeCount = 0;
    }

    const probes = own.probes || [];
    probes.forEach((probe) => {
      const tile = this.tileAt(probe.x, probe.y);
      if (!tile || tile.revealed) return;
      tile.revealed = true;
      tile.steps = probe.steps;
      tile.target.set(heatColour(probe.steps));
      const material = this.digitMaterials[Math.min(this.digitMaterials.length - 1, probe.steps)];
      if (material) {
        tile.digit.material = material;
        tile.digit.visible = true;
      }
      tile.press = 1;
    });

    if (probes.length > this.lastProbeCount) {
      this.lastProbeCount = probes.length;
      const newest = probes[probes.length - 1];
      // Näher heisst höher: der Ton verrät die Richtung, bevor man die Zahl
      // gelesen hat.
      this.feedback?.sound(newest.steps <= 2 ? "perfect" : "plink");
    }

    // Ein Fund. lastFind trägt den Zeitstempel, also feuert die Feier genau
    // einmal — auch wenn dasselbe Bild mehrfach durchläuft.
    const find = own.lastFind;
    if (find && find.at !== this.shownFindAt) {
      this.shownFindAt = find.at;
      this.celebrate(find, now);
    }
  }

  celebrate(find, now) {
    const tile = this.tileAt(find.x, find.y);
    const x = tile ? tile.x : 0;
    const z = tile ? tile.z : 0;
    const sharp = find.probes <= 3;
    this.gemAt = { x, z, until: now + 900 };
    this.bursts.spawn(new THREE.Vector3(x, 0.8, z), ["#ffd15c", "#ffffff"], {
      count: Math.round((sharp ? 16 : 10) * fxScale()), speed: 2.1, up: 1.8, size: 0.07, life: 0.65, drag: 1.8
    });
    this.floaters.pop(new THREE.Vector3(x, 1.6, z), `+${find.value}`, {
      color: sharp ? "#c6ffb0" : "#ffe9a8", size: sharp ? 0.42 : 0.34, life: 0.85
    });
    this.shake = Math.min(1, this.shake + (sharp ? 0.9 : 0.5));
    this.feedback?.sound(sharp ? "win" : "coin");
    this.searcherCheerUntil = now + 900;
  }

  syncTiles(dt, now) {
    this.tiles.forEach((tile) => {
      tile.press = Math.max(0, tile.press - dt * 4.0);
      tile.nudge = Math.max(0, tile.nudge - dt * 5.0);

      // Aufgedeckte Felder sinken ein Stück ein: der Blick soll über die
      // geschlossenen wandern, das sind die, die noch etwas verbergen können.
      const wantLift = tile.revealed ? -0.13 : 0;
      tile.lift += (wantLift - tile.lift) * frameLerp(0.22, dt);
      const wobble = Math.sin(now / 90 + tile.gx * 1.7 + tile.gy * 2.3) * (tile.revealed ? 0 : 0.012);
      tile.group.position.y = tile.lift + wobble + tile.press * 0.09 + tile.nudge * 0.05;
      tile.group.rotation.z = tile.nudge * Math.sin(now / 24) * 0.09;

      tile.block.material.color.lerp(tile.target, frameLerp(0.2, dt));
      const glow = Math.max(tile.press, tile.revealed && tile.steps <= 2 ? 0.25 : 0);
      tile.block.material.emissive?.setScalar?.(glow * 0.22);
    });
  }

  syncGem(own, now, dt) {
    if (!this.gem) return;
    const showing = this.gemAt && now < this.gemAt.until;
    this.gem.visible = Boolean(showing);
    if (!showing) return;
    const remaining = (this.gemAt.until - now) / 900;
    this.gem.position.set(this.gemAt.x, 0.6 + (1 - remaining) * 1.5, this.gemAt.z);
    this.gem.rotation.y += dt * 5.2;
    this.gem.rotation.x += dt * 2.1;
    this.gem.scale.setScalar(clamp(remaining * 1.4, 0.2, 1.2));
  }

  syncSearcher(minigame, arcade, state, own, now) {
    if (!this.searcherAnimator) return;
    if (minigame.finaleAt) {
      // Am Ende freut sich Platz 1 sehr, der letzte gar nicht — dieselbe
      // Sprache wie in allen anderen Minispielen.
      applyFinaleMood(this.searcherAnimator, this.finalePlace(arcade, state), state.players.length);
    } else if (this.searcherCheerUntil && now < this.searcherCheerUntil) {
      this.searcherAnimator.set("cheer");
    } else {
      this.searcherAnimator.set("idle", { base: true });
    }
    this.searcherAnimator.update(now);
  }

  finalePlace(arcade, state) {
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
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.round(own?.score || 0));

    const roundLabel = this.hud.querySelector("[data-seek-round]");
    if (roundLabel) {
      const used = (own?.probes || []).length;
      // Was der nächste Fund NOCH wert ist — das ist die Zahl, an der die
      // Entscheidung hängt: noch ein Tipp zur Sicherheit oder jetzt raten?
      const worth = Math.max(
        arcade.minPoints || 20,
        (arcade.basePoints || 150) - used * (arcade.probeCost || 18)
      );
      roundLabel.textContent = `${used} Tipps · Fund noch ${worth} wert`;
    }

    const chips = this.hud.querySelector("[data-seek-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="simon-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.round(entry?.score || 0)}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-seek-banner]");
    if (!banner) return;
    const find = own?.lastFind;
    if (find && now - find.at < 1400) {
      banner.hidden = false;
      banner.textContent = find.probes <= 3
        ? `Gefunden in ${find.probes} Tipps!`
        : `Gefunden — ${find.probes} Tipps gebraucht`;
      banner.style.background = find.probes <= 3 ? "#7fe06f" : "#ffd15c";
      banner.style.color = find.probes <= 3 ? "#14361a" : "#4a3405";
      return;
    }
    banner.hidden = true;
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Fast von oben, und WEIT genug weg. Das Sichtfeld in three.js ist
      // senkrecht gemessen; auf einem hochkanten Handy (Seitenverhältnis ~0.6)
      // schrumpft das waagerechte Feld damit auf gut ein Drittel. Bei y=7.6,
      // z=5.2 passten von den sechs Spalten nur vier ins Bild, die vorderste
      // Reihe füllte den halben Schirm — das Raster war als Raster nicht mehr
      // zu erkennen.
      //
      // Gerechnet statt geraten: bei 5.3 Einheiten Rasterbreite und 18 Grad
      // halbem waagerechtem Sichtfeld braucht es mindestens 5.3/2/tan(18°) ≈ 8.2
      // Einheiten Abstand zur VORDEREN Kante. Mit Rand darum herum: y=12, z=7.
      // Diese Zahlen sind ERPROBT, nicht gerechnet: der erste Versuch (7.6/5.2)
      // schnitt die äusseren Spalten ab, ein zweiter (9.6/5.8) ebenso. Wer sie
      // ändert, muss sich das Bild ansehen — die Rechnung übers Sichtfeld führt
      // hier in die Irre, weil die Leinwand nicht die ganze Bildschirmhöhe hat.
      this.baseCamY = portrait ? 12 : 10.5;
      this.baseCamZ = portrait ? 7 : 8.5;
      camera.fov = portrait ? 52 : 46;
    });
  }
}
