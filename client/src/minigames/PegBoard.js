import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  createCloud
} from "./VoxelKit.js?v=tumblekin101";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin101";
import { frameDecay, frameLerp, fxScale, shakeScale } from "./Quality.js?v=tumblekin101";

// Nagelbrett — tippe oben, wo die Kugel starten soll; sie fällt durch die Nägel
// in eines von sieben Fächern. Die Mitte ist am meisten wert.
//
// Der Stups ist der Grund, warum das ein Spiel ist und kein Glücksrad: EINMAL
// je Kugel darf man sie im Flug seitlich anschubsen. Man sieht sie schief
// laufen, man sieht das Fach kommen — und man hat genau einen Eingriff.
//
// Das Brett liegt flach zur Kamera. Perspektive hilft hier nichts: es geht um
// exakte Positionen, und schräg gesehen liest man die schlechter.
const BOARD_W = 4.6;
const BOARD_H = 5.6;
const SLOT_COLORS = ["#5c6b7a", "#7d8fa0", "#43c9a0", "#ffd15c", "#43c9a0", "#7d8fa0", "#5c6b7a"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class PegBoard {
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
    this.ballMeshes = new Map();
    this.pegMeshes = [];
    this.slotMeshes = [];
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.lastSlotAt = 0;
    this.lastPlinks = 0;
  }

  // Logikraum (x 0…1, y 0…floorY) auf Weltkoordinaten. Eine einzige Umrechnung
  // für alles, damit die gezeichnete Kugel exakt dort liegt, wo der Server sie
  // rechnet — bei einem Spiel um Fachbreiten fällt jeder Versatz sofort auf.
  worldX(x) { return (x - 0.5) * BOARD_W; }
  worldY(y, floorY) { return BOARD_H * (1 - y / floorY) - BOARD_H / 2 + 0.4; }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Nagelbrett", background: "#8fd3ef", fog: ["#b3e4f6", 24, 60], fov: 52, far: 90 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="peg-chips" data-peg-chips></div>
      <div class="color-banner peg-banner" data-peg-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `<p class="trace-hint" data-peg-hint>Tippe oben, wo die Kugel fallen soll</p>`;
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
    const arcade = minigame?.arcade;
    if (!minigame || minigame.finaleAt || !arcade) return;
    const mine = (arcade.balls || []).find((ball) => ball.playerId === this.getControlledPlayerId());
    const rect = this.webglCanvas.getBoundingClientRect();
    const share = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);

    if (mine) {
      // Kugel unterwegs: der Tipp ist ein Stups. Die getippte Bildhälfte gibt
      // die Richtung — man zeigt also dorthin, wohin die Kugel soll.
      if (mine.nudged) {
        this.feedback?.sound("clack");
        return;
      }
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(12);
      this.sendInput({ action: "nudge", dir: share < 0.5 ? -1 : 1 }).catch(() => {});
      return;
    }
    this.feedback?.sound("tap");
    this.sendInput({ action: "drop", x: clamp(share, 0.06, 0.94) }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.controls.style.pointerEvents = "";
    this.webglCanvas?.removeEventListener("pointerdown", this.onTap);
    teardownStage(this);
    this.ballMeshes.clear();
    this.pegMeshes.length = 0;
    this.slotMeshes.length = 0;
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-3, 10, 9],
      shadow: { left: -5, right: 5, top: 6, bottom: -6 }
    });

    const arcade = this.minigame.arcade;
    const floorY = arcade.floorY || 1.3;

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.5, BOARD_H + 0.6, 0.3),
      new THREE.MeshLambertMaterial({ color: "#2b3648" })
    );
    board.position.set(0, 0.4, -0.4);
    board.receiveShadow = true;
    this.scene.add(board);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.9, BOARD_H + 1.0, 0.24),
      new THREE.MeshLambertMaterial({ color: "#9a7748" })
    );
    frame.position.set(0, 0.4, -0.58);
    this.scene.add(frame);

    // Die Nägel. Sie stehen exakt dort, wo der Server sie rechnet — sonst
    // prallt die Kugel im Bild woanders ab als in der Wertung.
    // Nägel mit rundem Kopf statt flacher Scheiben: sie fangen das Licht, und
    // dadurch sieht man auf dem Handybild überhaupt, dass sie aus dem Brett
    // herausstehen. Geometrien und Material werden geteilt — bei 40 Nägeln
    // wären eigene sonst reine Verschwendung.
    const pegGeo = new THREE.CylinderGeometry(0.075, 0.085, 0.24, 8);
    const headGeo = new THREE.SphereGeometry(0.1, 10, 8);
    const pegMat = new THREE.MeshLambertMaterial({ color: "#f2e2b8", emissive: "#4a3a12" });
    (arcade.pegs || []).forEach((peg) => {
      const group = new THREE.Group();
      group.position.set(this.worldX(peg.x), this.worldY(peg.y, floorY), -0.15);
      const shaft = new THREE.Mesh(pegGeo, pegMat);
      shaft.rotation.x = Math.PI / 2;
      shaft.castShadow = true;
      group.add(shaft);
      const head = new THREE.Mesh(headGeo, pegMat);
      head.position.z = 0.12;
      head.scale.z = 0.55;
      group.add(head);
      this.scene.add(group);
      this.pegMeshes.push({ mesh: head, group, flash: 0, base: new THREE.Color("#f2e2b8") });
    });

    // Die Fächer. Ihre Farbe sagt den Wert — je heller, desto mehr wert.
    const slots = arcade.slots || [];
    const slotWidth = BOARD_W / Math.max(1, slots.length);
    slots.forEach((points, index) => {
      const x = -BOARD_W / 2 + slotWidth * (index + 0.5);
      const y = this.worldY(floorY, floorY) - 0.25;
      const cup = new THREE.Mesh(
        new THREE.BoxGeometry(slotWidth * 0.9, 0.5, 0.4),
        new THREE.MeshLambertMaterial({ color: SLOT_COLORS[index % SLOT_COLORS.length] })
      );
      cup.position.set(x, y, -0.1);
      cup.receiveShadow = true;
      this.scene.add(cup);

      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.75, 0.4),
        new THREE.MeshLambertMaterial({ color: "#e6edf5" })
      );
      wall.position.set(x - slotWidth / 2, y + 0.3, -0.1);
      this.scene.add(wall);

      // Ein Leuchtstreifen auf dem wertvollsten Fach. Die Farbabstufung allein
      // beantwortet die Frage "wo will ich hin?" auf einem kleinen Bild zu
      // langsam — und genau diese Frage stellt das Spiel in jeder Sekunde.
      const bestPoints = Math.max(...slots);
      if (points === bestPoints) {
        const glow = new THREE.Mesh(
          new THREE.BoxGeometry(slotWidth * 0.9, 0.06, 0.42),
          new THREE.MeshBasicMaterial({ color: "#fff3b0", transparent: true, opacity: 0.9, toneMapped: false })
        );
        glow.position.set(x, y + 0.28, -0.08);
        this.scene.add(glow);
      }

      this.slotMeshes.push({ cup, points, index, flash: 0, base: new THREE.Color(SLOT_COLORS[index % SLOT_COLORS.length]) });
    });

    [[-6.4, 4.6, -9, 3], [6.2, 5.2, -10, 8]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.resizeRenderer();
    this.camera.position.set(0, 0.4, 9.2);
    this.camera.lookAt(0, 0.4, 0);
  }

  ensureBall(ball, colour) {
    if (this.ballMeshes.has(ball.id)) return this.ballMeshes.get(ball.id);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 12, 10),
      new THREE.MeshLambertMaterial({ color: colour })
    );
    mesh.castShadow = true;
    group.add(mesh);
    // Ein heller Ring um die eigene Kugel, damit man sie unter vier Kugeln
    // wiederfindet, ohne die Farbe zu suchen.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.33, 18),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    ring.position.z = 0.22;
    group.add(ring);
    this.scene.add(group);
    const visual = { group, mesh, ring, colour };
    this.ballMeshes.set(ball.id, visual);
    return visual;
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
    const own = arcade.players[controlledId];
    const floorY = arcade.floorY || 1.3;
    const colourOf = (id) => state.players.find((player) => player.id === id)?.color || "#ffffff";

    const alive = new Set();
    (arcade.balls || []).forEach((ball) => {
      alive.add(ball.id);
      const visual = this.ensureBall(ball, colourOf(ball.playerId));
      visual.group.position.set(this.worldX(ball.x), this.worldY(ball.y, floorY), 0.12);
      const isOwn = ball.playerId === controlledId;
      visual.ring.material.opacity = isOwn ? (ball.nudged ? 0.35 : 0.9) : 0;
      visual.ring.scale.setScalar(isOwn && !ball.nudged ? 1 + Math.sin(now / 160) * 0.12 : 1);
      visual.mesh.rotation.z -= dt * 6;

      // Kugeln stossen sich jetzt gegenseitig weg. Ohne Rückmeldung sieht das
      // aus wie ein Ruckler; mit Funken und Klack ist es der Moment, in dem man
      // merkt, dass da noch drei andere mitspielen.
      if (ball.bumpedAt && ball.bumpedAt !== visual.lastBump) {
        visual.lastBump = ball.bumpedAt;
        this.bursts.spawn(visual.group.position.clone(), [colourOf(ball.playerId), "#ffffff"], {
          count: Math.round(7 * fxScale()), speed: 1.5, up: 0.5, size: 0.05, life: 0.4, drag: 2.4
        });
        this.shake = Math.min(1, this.shake + (isOwn ? 0.5 : 0.22));
        if (isOwn) { this.feedback?.sound("clack"); this.feedback?.vibrate(10); }
      }
    });
    this.ballMeshes.forEach((visual, id) => {
      if (alive.has(id)) return;
      this.scene.remove(visual.group);
      this.ballMeshes.delete(id);
    });

    this.syncFlashes(dt);
    this.reactToOwn(own, arcade, state, now);

    this.bursts.update(dt);
    this.floaters.update(dt);

    this.shake *= frameDecay(0.88, dt);
    const shakeX = Math.sin(now / 12) * this.shake * 0.16 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * frameLerp(0.4, dt);
    this.camera.position.y = 0.4;
    this.camera.position.z = this.baseCamZ || 9.2;
    this.camera.lookAt(0, 0.4, 0);

    this.updateHud(minigame, arcade, state, now, own);
    this.renderer.render(this.scene, this.camera);
  }

  syncFlashes(dt) {
    this.pegMeshes.forEach((peg) => {
      peg.flash = Math.max(0, peg.flash - dt * 3);
      // Über die GRÖSSE, nicht über die Farbe: alle Nägel teilen sich ein
      // Material (bei vierzig Stück ist das richtig so), und eine Farbe darauf
      // zu setzen hätte immer alle gleichzeitig aufleuchten lassen. Das Blinken
      // war deshalb noch nie zu sehen.
      const puls = 1 + peg.flash * 0.45;
      peg.group.scale.setScalar(puls);
    });
    this.slotMeshes.forEach((slot) => {
      slot.flash = Math.max(0, slot.flash - dt * 2);
      slot.cup.material.color.copy(slot.base).lerp(new THREE.Color("#ffffff"), slot.flash * 0.7);
      slot.cup.scale.y = 1 + slot.flash * 0.25;
    });
  }

  reactToOwn(own, arcade, state, now) {
    if (!own) return;
    const landed = own.lastSlot;
    if (landed && landed.at !== this.lastSlotAt) {
      this.lastSlotAt = landed.at;
      const slot = this.slotMeshes[landed.slot];
      if (slot) slot.flash = 1;
      const at = new THREE.Vector3(slot?.cup.position.x || 0, (slot?.cup.position.y || 0) + 0.9, 0.3);
      const big = landed.points >= 7;
      this.bursts.spawn(at, [big ? "#ffd15c" : "#8fa4b4", "#ffffff"],
        { count: (big ? 16 : 8) * fxScale(), speed: 2.0, up: 1.8, size: 0.07, life: 0.6, drag: 1.8 });
      this.floaters.pop(at, `+${landed.points}`, { color: big ? "#ffe36b" : "#c3d3e2", size: big ? 0.42 : 0.32, life: 0.8 });
      this.feedback?.sound(big ? "perfect" : "coin");
      this.feedback?.vibrate(big ? [10, 8, 16] : 10);
      if (big) this.shake = Math.max(this.shake, 0.25);
    }

    // Jeder Nagelkontakt klackt. Ohne den Ton wirkt die Kugel, als schwebe sie.
    const plinks = own.plinks || 0;
    if (plinks > this.lastPlinks) {
      this.lastPlinks = plinks;
      this.feedback?.sound("plink");
    }
  }

  updateHud(minigame, arcade, state, now, own) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.max(0, Math.round(own?.score || 0)));

    const chips = this.hud.querySelector("[data-peg-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="peg-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.max(0, Math.round(entry?.score || 0))}</span>`;
      }).join("");
    }

    // Die Hinweiszeile sagt, was der nächste Tipp bewirkt. Ohne sie tippt man
    // in dem Glauben, eine neue Kugel zu werfen, und stupst stattdessen.
    const mine = (arcade.balls || []).find((ball) => ball.playerId === this.getControlledPlayerId());
    const hint = this.controls?.querySelector("[data-peg-hint]");
    const mode = !mine ? "drop" : (mine.nudged ? "wait" : "nudge");
    if (hint && mode !== this.hintMode) {
      this.hintMode = mode;
      hint.textContent = mode === "drop"
        ? "Tippe oben, wo die Kugel fallen soll"
        : (mode === "nudge" ? "👉 Tippe links oder rechts für EINEN Stups" : "Stups verbraucht — zuschauen");
    }

    const banner = this.hud.querySelector("[data-peg-banner]");
    if (!banner) return;
    if (mode === "nudge") {
      banner.hidden = false;
      banner.textContent = "Ein Stups ist bereit";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Das Brett ist hoch — im Hochformat passt es näher ins Bild, im
      // Querformat muss die Kamera zurück, sonst ragen Fächer und Trichter raus.
      this.baseCamZ = portrait ? 9.2 : 12.0;
      camera.fov = portrait ? 52 : 42;
    });
  }
}
