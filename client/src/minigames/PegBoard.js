import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin200";

// Nagelbrett: oben tippen lässt die eigene Kugel dort fallen, ein Tipp links
// oder rechts gibt ihr einen einzigen Stups. Unten zählt das Fach — und der
// goldene Jackpot-Topf, der hin und her wandert, bringt +15. Fünf Kugeln.
//
// Vorher war das Brett ganz ohne Figuren. Jetzt stehen alle auf einer
// Laufleiste über dem Brett, laufen zur Abwurfstelle, halten die Kugel über
// den Kopf, lassen sie fallen, schauen ihr nach und freuen sich über ein
// gutes Fach — oder raufen sich die Haare.
const BOARD_W = 4.6;
const BOARD_H = 5.6;
const SLOT_COLORS = ["#5c6b7a", "#7d8fa0", "#43c9a0", "#ffd15c", "#43c9a0", "#7d8fa0", "#5c6b7a"];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Wie auf dem Server (plinkoJackpotX): Dreieckswelle über die Topfmitten.
function jackpotX(elapsedMs, period, slotCount) {
  const phase = (((elapsedMs % period) + period) % period) / period;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const first = 0.5 / slotCount;
  return first + tri * (1 - 2 * first);
}

// Eine flache Zahlentafel (für die Topfwerte und den Jackpot).
function makeLabel(text, { color = "#ffffff", size = 0.36, stroke = "rgba(20, 28, 40, 0.55)" } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.font = "900 84px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 14;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, 128, 68);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2, size),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
  );
  return mesh;
}

export class PegBoard extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.ballMeshes = new Map();
    this.pegMeshes = [];
    this.slotMeshes = [];
    this.droppers = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.12);
    // Schild über der hochgehaltenen Kugel.
    this.labelY = 1.12;
    this.markerOffset = 1.0;
  }

  worldX(x) { return (x - 0.5) * BOARD_W; }
  worldY(y, floorY) { return BOARD_H * (1 - y / floorY) - BOARD_H / 2 + 0.4; }

  get railY() {
    return BOARD_H / 2 + 0.4 + 0.3;
  }

  stage() {
    return {
      label: "3D Nagelbrett",
      background: "#8fd3ef",
      fog: ["#b3e4f6", 24, 60],
      lights: { sunPosition: [-3, 10, 9], shadow: { left: -5, right: 5, top: 6, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="peg-chips" data-peg-chips></div>
      <div class="color-banner peg-banner" data-peg-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame.arcade;
    const floorY = arcade.floorY || 1.3;

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.5, BOARD_H + 0.6, 0.3),
      new THREE.MeshLambertMaterial({ color: "#2b3648" })
    );
    board.position.set(0, 0.4, -0.4);
    board.receiveShadow = true;
    scene.add(board);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.9, BOARD_H + 1.0, 0.24),
      new THREE.MeshLambertMaterial({ color: "#9a7748" })
    );
    frame.position.set(0, 0.4, -0.58);
    scene.add(frame);

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
      scene.add(group);
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
      scene.add(cup);

      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.75, 0.4),
        new THREE.MeshLambertMaterial({ color: "#e6edf5" })
      );
      wall.position.set(x - slotWidth / 2, y + 0.3, -0.1);
      scene.add(wall);

      // Der Wert steht auf dem Topf — man soll nicht an der Farbe raten.
      const label = makeLabel(String(points), { size: 0.26 });
      label.position.set(x, y + 0.02, 0.13);
      scene.add(label);

      this.slotMeshes.push({ cup, points, index, flash: 0, base: new THREE.Color(SLOT_COLORS[index % SLOT_COLORS.length]) });
    });

    // Der Jackpot: ein goldener Rahmen mit Stern und „+15“, der über die Töpfe
    // gleitet. Man sieht ihn wandern und kann vorausdenken.
    this.slotWidth = slotWidth;
    this.slotY = this.worldY(floorY, floorY) - 0.25;
    const jackpot = new THREE.Group();
    const glowMat = new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.BoxGeometry(slotWidth * 0.96, 0.62, 0.3), glowMat);
    jackpot.add(glow);
    const frameMat = new THREE.MeshBasicMaterial({ color: "#ffd24a", toneMapped: false });
    [[-1, 0], [1, 0]].forEach(([side]) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.34), frameMat);
      bar.position.x = side * slotWidth * 0.48;
      jackpot.add(bar);
    });
    const top = new THREE.Mesh(new THREE.BoxGeometry(slotWidth * 0.98, 0.06, 0.34), frameMat);
    top.position.y = 0.35;
    jackpot.add(top);
    const tag = makeLabel(`★+${arcade.jackpot || 15}`, { color: "#ffe36b", size: 0.3 });
    tag.position.set(0, 0.62, 0.16);
    jackpot.add(tag);
    jackpot.position.set(0, this.slotY, -0.02);
    scene.add(jackpot);
    this.jackpot = jackpot;
    this.jackpotGlow = glow;

    [[-6.4, 4.6, -9, 3], [6.2, 5.2, -10, 8]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });


    // Laufleiste über dem Brett.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 1.2, 0.16, 0.7), new THREE.MeshLambertMaterial({ color: "#9a7748" }));
    rail.position.set(0, this.railY - 0.08, 0.1);
    rail.receiveShadow = true;
    scene.add(rail);
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * 1.1;
      this.addKin(player, index, { x, ground: this.railY, z: 0.15, facing: 0, scale: 0.85 });
      const held = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshLambertMaterial({ color: player.color }));
      held.visible = false;
      scene.add(held);
      this.droppers.set(player.id, { homeX: x, x, ballId: null, lastSlotAt: 0, held, droppedAt: -1e9 });
    });
  }

  shot() {
    return {
      look: [0, 0.75, 0],
      frame: { w: BOARD_W + 0.8, h: BOARD_H + 2.2 },
      fill: 0.96,
      pitch: 0.04,
      fov: 36,
      intro: { yaw: 0.45, pitch: 0.15, zoom: 1.3 },
      finale: { pull: 0.6, zoom: 0.55, lift: 0.4, orbit: 0.1 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint" data-peg-hint>Tippe oben, wo die Kugel fallen soll</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      this.tapAt(event);
    });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.ballMeshes.clear();
    this.pegMeshes.length = 0;
    this.slotMeshes.length = 0;
  }

  // Wo auf dem Brett wurde getippt? Über einen Strahl auf die Brettebene —
  // die Kamera zeigt das Brett nicht zwingend genau bildschirmbreit.
  boardShareAt(event) {
    const rect = this.webglCanvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, hit)) return clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    return clamp(hit.x / BOARD_W + 0.5, 0, 1);
  }

  tapAt(event) {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!minigame || minigame.finaleAt || !arcade || !this.camera) return;
    const mine = (arcade.balls || []).find((ball) => ball.playerId === this.getControlledPlayerId());
    const share = this.boardShareAt(event);
    if (mine) {
      if (mine.nudged) {
        this.feedback?.sound("clack");
        return;
      }
      const ballShare = mine.x;
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(12);
      this.sendInput({ action: "nudge", dir: share < ballShare ? -1 : 1 }).catch(() => {});
      return;
    }
    this.feedback?.sound("tap");
    this.sendInput({ action: "drop", x: clamp(share, 0.06, 0.94) }).catch(() => {});
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

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, state, minigame } = f;
    if (!arcade) return;
    const floorY = arcade.floorY || 1.3;
    if (this.jackpot && arcade.jackpotPeriod) {
      const slots = (arcade.slots || []).length || 7;
      const x = jackpotX(Math.max(0, now - minigame.startedAt), arcade.jackpotPeriod, slots);
      this.jackpot.position.x = this.worldX(x);
      this.jackpotGlow.material.opacity = 0.28 + Math.sin(now / 160) * 0.1;
      this.jackpot.visible = !finale;
    }
    const colourOf = (id) => state.players.find((player) => player.id === id)?.color || "#ffffff";
    const alive = new Set();
    const ballOf = new Map();
    (arcade.balls || []).forEach((ball) => {
      alive.add(ball.id);
      ballOf.set(ball.playerId, ball);
      const visual = this.ensureBall(ball, colourOf(ball.playerId));
      visual.group.position.set(this.worldX(ball.x), this.worldY(ball.y, floorY), 0.12);
      const isOwn = ball.playerId === controlledId;
      visual.ring.material.opacity = isOwn ? (ball.nudged ? 0.35 : 0.9) : 0;
      visual.ring.scale.setScalar(isOwn && !ball.nudged ? 1 + Math.sin(now / 160) * 0.12 : 1);
      visual.mesh.rotation.z -= dt * 6;
      if (ball.bumpedAt && ball.bumpedAt !== visual.lastBump) {
        visual.lastBump = ball.bumpedAt;
        this.burst(visual.group.position.clone(), [colourOf(ball.playerId), "#ffffff"], { count: Math.round(7 * fxScale()), speed: 1.5, up: 0.5, size: 0.05, life: 0.4, drag: 2.4 });
        if (isOwn) {
          this.rig.shake(0.3);
          this.feedback?.sound("clack");
          this.feedback?.vibrate(10);
        }
      }
    });
    this.ballMeshes.forEach((visual, id) => {
      if (alive.has(id)) return;
      this.scene.remove(visual.group);
      this.ballMeshes.delete(id);
    });
    this.syncFlashes(dt);

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const d = this.droppers.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !d || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const ball = ballOf.get(player.id);
      // Neue Kugel: hinlaufen, hochhalten, fallen lassen.
      if (ball && ball.id !== d.ballId) {
        d.ballId = ball.id;
        d.x = clamp(this.worldX(ball.x), -BOARD_W / 2 + 0.2, BOARD_W / 2 - 0.2);
        d.droppedAt = now;
        animator.trigger("throw");
      }
      const gap = d.x - kin.position.x;
      kin.position.x += gap * frameLerp(0.25, dt);
      const running = Math.abs(gap) > 0.08;
      kin.rotation.y += ((running ? Math.sign(gap) * Math.PI * 0.45 : 0) - kin.rotation.y) * frameLerp(0.3, dt);
      d.held.visible = !ball && !finale;
      d.held.position.copy(kin.position).add(new THREE.Vector3(0, 0.68, 0.05));

      // Gelandet: je nach Fach freuen oder ärgern.
      const landed = entry.lastSlot;
      if (landed && landed.at !== d.lastSlotAt) {
        const first = d.lastSlotAt === 0 && now - landed.at > 2000;
        d.lastSlotAt = landed.at;
        if (!first) {
          const big = landed.points >= 8;
          animator.trigger(big ? "fistpump" : landed.points <= 2 ? "facepalm" : "clap");
          animator.expression(big ? "joy" : landed.points <= 2 ? "sad" : "happy", 900);
          const slot = this.slotMeshes[landed.slot];
          if (slot) slot.flash = 1;
          if (isOwn) {
            const at = new THREE.Vector3(slot?.cup.position.x || 0, (slot?.cup.position.y || 0) + 0.9, 0.3);
            this.burst(at, [big ? "#ffd15c" : "#8fa4b4", "#ffffff"], { count: (big ? 16 : 8) * fxScale(), speed: 2.0, up: 1.8, size: 0.07, life: 0.6, drag: 1.8 });
            this.pop(at, landed.jackpot ? `JACKPOT! +${landed.points}` : `+${landed.points}`, { color: big ? "#ffe36b" : "#c3d3e2", size: landed.jackpot ? 0.5 : big ? 0.42 : 0.32, life: landed.jackpot ? 1.1 : 0.8 });
            if (landed.jackpot) this.burst(at, ["#ffe36b", "#ffffff", "#ffb020"], { count: Math.round(26 * fxScale()), speed: 3, up: 2.6, size: 0.09, life: 0.9, drag: 1.4 });
            this.feedback?.sound(landed.jackpot ? "win" : big ? "perfect" : "coin");
            this.feedback?.vibrate(landed.jackpot ? [14, 20, 30] : big ? [10, 8, 16] : 10);
            if (big) this.rig.shake(landed.jackpot ? 0.5 : 0.25);
          }
        }
      }
      if (isOwn && (entry.plinks || 0) > (d.plinks || 0)) this.feedback?.sound("plink");
      d.plinks = entry.plinks || 0;

      if (finale) return;
      const visual = ball ? this.ballMeshes.get(ball.id) : null;
      animator.lookAt(visual ? visual.group.position : null);
      if (running) animator.set("run");
      else if (ball) animator.set("focus");
      else animator.set("carry");
    });
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

  drawHud(f) {
    const { arcade, state, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
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
    const left = own?.ballsLeft ?? 0;
    const mode = !mine ? (left > 0 ? "drop" : "done") : (mine.nudged ? "wait" : "nudge");
    const dots = "●".repeat(Math.max(0, left)) + "○".repeat(Math.max(0, (arcade.ballsPerPlayer || 5) - left));
    const text = mode === "drop"
      ? `Tippe oben, wo die Kugel fallen soll · ${dots}`
      : mode === "done" ? "Alle Kugeln geworfen — zuschauen"
        : (mode === "nudge" ? "👉 Tippe links oder rechts für EINEN Stups" : `Stups verbraucht — zuschauen · ${dots}`);
    if (hint && text !== this.hintText) {
      this.hintText = text;
      hint.textContent = text;
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
}
