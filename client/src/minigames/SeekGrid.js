import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin200";

// Spürsinn: irgendwo unter den Feldern liegt ein Schatz. Jedes angetippte
// Feld sagt, wie viele Schritte er entfernt ist. Wer mit wenigen Tipps findet,
// bekommt mehr.
//
// Vorher stand die eigene Figur untätig am Rand. Jetzt hüpft sie auf das
// angetippte Feld und gräbt dort, springt vor Freude, wenn der Schatz
// herauskommt, und die anderen stehen rund um das Feld und jubeln, wenn sie
// ihren eigenen gefunden haben — jeder sucht auf seinem eigenen Brett.
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

export class SeekGrid extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tiles = [];
    this.hitTargets = [];
    this.digitMaterials = [];
    this.shownRound = -1;
    this.shownFindAt = 0;
    this.lastProbeCount = 0;
    this.otherFinds = new Map();
    this.searchAt = null;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Spürsinn",
      background: "#161d2c",
      fog: ["#202a3d", 24, 58],
      lights: { sunPosition: [-5, 13, 7], shadow: { left: -6, right: 6, top: 8, bottom: -4 }, hemiIntensity: 1.9, sunIntensity: 2.1, skyColor: 0x7d8fc4, groundColor: 0x3d3226, sunColor: 0xc6d4ff, fillColor: 0x8f9bd8, fillIntensity: 0.5 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-seek-round>Tipps: 0</div>
      <div class="simon-chips" data-seek-chips></div>
      <div class="color-banner" data-seek-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(44, 0.5, 44),
      new THREE.MeshLambertMaterial({ color: "#57452f" })
    );
    floor.position.set(0, -0.25, 2);
    floor.receiveShadow = true;
    scene.add(floor);

    // Der Rahmen macht aus 36 losen Klötzen ein Suchfeld — ohne ihn schwebt das
    // Raster im Nichts und man verliert am Rand die Orientierung.
    const span = SIZE * STEP;
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(span + 0.5, 0.16, span + 0.5),
      new THREE.MeshLambertMaterial({ color: "#22303f" })
    );
    frame.position.y = 0.05;
    frame.receiveShadow = true;
    scene.add(frame);

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
    scene.add(this.gem);

    // Steinkante rund um das Suchfeld — die Grabungskante.
    const kanteMat = new THREE.MeshLambertMaterial({ color: "#4a5c70" });
    const kante = span / 2 + 0.62;
    [[0, kante, span + 1.7, 0.55], [0, -kante, span + 1.7, 0.55],
     [kante, 0, 0.55, span + 1.7], [-kante, 0, 0.55, span + 1.7]].forEach(([x, z, w, d]) => {
      const stein = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, d), kanteMat);
      stein.position.set(x, 0.21, z);
      stein.receiveShadow = true;
      scene.add(stein);
    });

    // Laternen an den vier Ecken: warme Punkte gegen das kalte Steinraster.
    // Sie sind die einzige warme Farbe im Bild und binden es zusammen.
    // Die Standorte sind fürs Hochformat ausgerechnet, nicht an die Feldecken
    // gesetzt: an den Ecken (±3.3) standen sie beim ersten Versuch genau am
    // Bildrand und waren praktisch unsichtbar. Die beiden vorderen stehen im
    // leeren Streifen zwischen Feld und Suchfigur — dort, wo vorher nichts war.
    // Hinten zwei Mastlaternen, vorne zwei Bodenlampen. Vorne standen erst
    // ebenfalls Masten — dicht vor der Kamera warfen sie zwei schwarze Keile
    // quer durch den ganzen Vordergrund, und ihr Licht sass so hoch, dass
    // unten nichts ankam. Flach auf dem Boden legen sie ihre Pfütze genau
    // dorthin, wo die Suchfigur steht.
    this.laternen = [];
    [[-2.9, -4.0, "mast"], [2.9, -4.0, "mast"], [-1.5, 4.6, "boden"], [1.5, 4.6, "boden"]]
      .forEach(([x, z, art], index) => {
      const hoch = art === "mast";
      const glasY = hoch ? 2.32 : 0.34;
      if (hoch) {
        const pfosten = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 1.9, 0.16),
          new THREE.MeshLambertMaterial({ color: "#2f2a26" })
        );
        pfosten.position.set(x, 1.35, z);
        scene.add(pfosten);
      }
      const glas = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, hoch ? 0.4 : 0.32, 0.34),
        new THREE.MeshBasicMaterial({ color: "#ffd489" })
      );
      glas.position.set(x, glasY, z);
      scene.add(glas);
      // Nur die Mastlaternen bekommen eine Haube. Auf den Bodenlampen sass sie
      // bei dieser Aufsicht genau über dem Glas — im Bild lag mitten in jeder
      // Lichtpfütze ein schwarzes Quadrat.
      if (hoch) {
        const haube = new THREE.Mesh(
          new THREE.BoxGeometry(0.44, 0.12, 0.44),
          new THREE.MeshLambertMaterial({ color: "#2f2a26" })
        );
        haube.position.set(x, glasY + 0.26, z);
        scene.add(haube);
      }
      const licht = new THREE.PointLight(0xffb75e, hoch ? 14 : 6, hoch ? 11 : 7, 2);
      licht.position.set(x, glasY, z);
      scene.add(licht);
      this.laternen.push({ licht, glas, phase: index * 1.7, grund: licht.intensity });
    });

    // Gerümpel am Rand: Kisten, Schutt, eine Schaufel im Erdhaufen.
    [[-3.5, -4.3, 0.6, 0.6, "#6d5538"], [3.4, -4.6, 0.7, 0.5, "#5c472e"]].forEach(([x, z, w, h, color]) => {
      const kiste = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, w),
        new THREE.MeshLambertMaterial({ color })
      );
      kiste.position.set(x, h / 2, z);
      kiste.rotation.y = x * 0.4;
      kiste.castShadow = true;
      scene.add(kiste);
    });
    const schutt = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.3, 0.22, 0.3),
      new THREE.MeshLambertMaterial({ color: "#6a563a" }),
      22
    );
    const brocken = new THREE.Object3D();
    for (let i = 0; i < 22; i += 1) {
      // Fester Streuer, damit der Schutt bei jedem Start gleich liegt.
      const winkel = (i * 2.399) % (Math.PI * 2);
      const radius = span / 2 + 1.1 + ((i * 13) % 7) * 0.28;
      brocken.position.set(Math.cos(winkel) * radius, 0.09, Math.sin(winkel) * radius);
      brocken.rotation.y = winkel;
      brocken.scale.setScalar(0.6 + ((i * 7) % 5) * 0.22);
      brocken.updateMatrix();
      schutt.setMatrixAt(i, brocken.matrix);
    }
    schutt.instanceMatrix.needsUpdate = true;
    scene.add(schutt);

    // Die eigene Figur auf dem Brett, die anderen rundherum am Rand.
    const players = this.getState()?.players || [];
    const own = this.getControlledPlayerId();
    const edge = (SIZE * STEP) / 2 + 1.0;
    let slot = 0;
    // Hinter dem Brett auf den Randsteinen, zur Kamera gedreht.
    const stone = span / 2 + 0.62;
    const rim = [[-1.6, -stone], [0, -stone], [1.6, -stone]];
    players.forEach((player, index) => {
      if (player.id === own) {
        // Auf einer Feldmitte — die Brettmitte selbst ist eine Fuge.
        this.addKin(player, index, { x: STEP / 2, ground: 0.47, z: STEP / 2, facing: 0 });
        return;
      }
      const [x, z] = rim[slot % rim.length];
      slot += 1;
      this.addKin(player, index, { x, ground: 0.42, z, facing: 0, scale: 0.9 });
      this.setGround(player.id, 0.42);
    });
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

  shot() {
    return {
      look: [0, 0.2, 0.35],
      frame: { w: SIZE * STEP + 1.1, h: SIZE * STEP * Math.sin(0.95) + 1.4 },
      fill: 0.95,
      pitch: 0.95,
      fov: 36,
      intro: { yaw: 0.5, pitch: 0.3, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Tippe ein Feld — die Zahl sagt, wie viele Schritte bis zum Fund</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      this.tapAt(event);
    });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.digitMaterials.forEach((material) => {
      material.map?.dispose();
      material.dispose();
    });
    this.digitMaterials.length = 0;
    this.tiles.length = 0;
    this.hitTargets.length = 0;
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
    this.burst(new THREE.Vector3(x, 0.8, z), ["#ffd15c", "#ffffff"], { count: Math.round((sharp ? 16 : 10) * fxScale()), speed: 2.1, up: 1.8, size: 0.07, life: 0.65, drag: 1.8 });
    this.pop(new THREE.Vector3(x, 1.6, z), `+${find.value}`, { color: sharp ? "#c6ffb0" : "#ffe9a8", size: sharp ? 0.42 : 0.34, life: 0.85 });
    this.rig.shake(sharp ? 0.7 : 0.4);
    this.feedback?.sound(sharp ? "win" : "coin");
    const animator = this.animators.get(this.getControlledPlayerId());
    animator?.trigger("celebrate");
    animator?.expression("joy", 1200);
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

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const before = own?.probes?.length || 0;
    const known = this.lastProbeCount;
    this.syncBoard(own, now);
    this.syncTiles(dt, now);
    this.syncGem(own, now, dt);
    this.laternen?.forEach(({ licht, glas, phase, grund }) => {
      const flicker = Math.sin(now / 320 + phase) * 0.5 + Math.sin(now / 137 + phase) * 0.3;
      licht.intensity = grund * (1 + flicker * 0.19);
      glas.scale.setScalar(1 + flicker * 0.05);
    });

    // Die eigene Figur: zum zuletzt angetippten Feld hüpfen und graben.
    const kin = this.kins.get(controlledId);
    const animator = this.animators.get(controlledId);
    if (kin && animator) {
      const probes = own?.probes || [];
      if (before > known && probes.length) {
        const newest = probes[probes.length - 1];
        const tile = this.tileAt(newest.x, newest.y);
        if (tile) {
          this.searchAt = { x: tile.x, z: tile.z, at: now, tile };
          animator.trigger("hop", { height: 0.3 });
        }
      }
      // Aufgedeckte Felder sinken ein Stück ab — die Figur mit.
      const under = this.searchAt?.tile;
      animator.groundY = 0.47 + (under ? under.group.position.y : 0) + 0.3;
      if (this.searchAt) {
        const gap = new THREE.Vector3(this.searchAt.x - kin.position.x, 0, this.searchAt.z - kin.position.z);
        kin.position.x += gap.x * frameLerp(0.25, dt);
        kin.position.z += gap.z * frameLerp(0.25, dt);
        if (gap.length() > 0.1) kin.rotation.y = Math.atan2(gap.x, gap.z);
        else if (now - this.searchAt.at > 250 && !this.searchAt.dug) {
          this.searchAt.dug = true;
          animator.trigger("dig");
          this.burst(new THREE.Vector3(kin.position.x, 0.5, kin.position.z + 0.2), ["#8fa4bb", "#6a563a"], { count: 6, speed: 1.2, up: 1, size: 0.05, life: 0.4 });
        }
      }
      if (!finale) {
        kin.rotation.y += Math.atan2(Math.sin(-kin.rotation.y), Math.cos(-kin.rotation.y)) * frameLerp(this.searchAt && now - this.searchAt.at > 700 ? 0.08 : 0, dt);
        animator.set("think");
      }
    }
    // Die anderen am Rand: jubeln bei jedem eigenen Fund.
    players.forEach((player) => {
      if (player.id === controlledId) return;
      const entry = arcade.players[player.id];
      const other = this.animators.get(player.id);
      if (!entry || !other) return;
      const find = entry.lastFind;
      if (find && find.at !== this.otherFinds.get(player.id)) {
        const first = !this.otherFinds.has(player.id) && now - find.at > 1500;
        this.otherFinds.set(player.id, find.at);
        if (!first) {
          other.trigger("fistpump");
          other.expression("joy", 900);
          this.pop(this.kins.get(player.id).position.clone().add(new THREE.Vector3(0, 1.1, 0)), `+${find.value}`, { color: player.color, size: 0.26, life: 0.8 });
        }
      }
      if (!finale) other.set("focus");
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

  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    return own ? [own] : [];
  }

  drawHud(f) {
    const { arcade, state, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.round(own?.score || 0));
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
}
