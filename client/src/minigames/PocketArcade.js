import { drawCountdownOverlay, drawProgress, fillGradient, gameViewport, setupCanvas } from "./canvasTools.js?v=tumblekin36";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin36";
import { drawBlobAvatar } from "../game/BlobAvatar.js?v=tumblekin36";

const VISUALS = {
  petalPanic: { family: "choice", top: "#8fe3a8", bottom: "#4fbf7a", accent: "#2e7d4f", warm: "#ff8aa0" },
  orbitDrop: { family: "timing", top: "#9fdcf2", bottom: "#5fb2e8", accent: "#1d6ea8", warm: "#ffd15c" },
  tideTap: { family: "timing", top: "#7fe0d8", bottom: "#3cb8c4", accent: "#0d6a78", warm: "#fff3c4" },
  fireflySweep: { family: "steer", top: "#b8ec9a", bottom: "#6fce62", accent: "#2f7d38", warm: "#ffd15c" },
  iceDrift: { family: "steer", top: "#c8ecfa", bottom: "#8fd0ee", accent: "#2a7ba8", warm: "#ff7188" },
  magnetMates: { family: "steer", top: "#e8c8f2", bottom: "#b48fd9", accent: "#6a3c8f", warm: "#ffd15c" },
  gravityGarden: { family: "steer", top: "#c4ecb0", bottom: "#84cf7a", accent: "#357d42", warm: "#ff9a6b" },
  sparkSort: { family: "target", top: "#ffe9b0", bottom: "#f7c463", accent: "#a86a12", warm: "#ff7188" },
  bubblePop: { family: "target", top: "#a8e6f7", bottom: "#5ec4e8", accent: "#1d6ea8", warm: "#ffd15c" },
  plinkoDrop: { family: "plinko", top: "#ffd9e8", bottom: "#f79ec4", accent: "#a83c6e", warm: "#ffd15c" },
  curlingSlide: { family: "curling", top: "#d8f2fa", bottom: "#a0d8ee", accent: "#2a7ba8", warm: "#ff8aa0" }
};

export class PocketArcade {
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
    this.joystick = null;
    this.playArea = null;
    this.lastCanvasSize = null;
    this.lastScore = 0;
    this.localPulse = 0;
    this.touchPulse = null;
    this.pops = [];
    this.swipe = null;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    const family = minigame.arcade?.family || VISUALS[minigame.type]?.family;

    if (family === "choice") {
      this.controls.innerHTML = `
        <div class="arcade-choice-controls">
          <button type="button" data-arcade-choice="left" aria-label="Links">←</button>
          <button type="button" data-arcade-choice="right" aria-label="Rechts">→</button>
        </div>
      `;
      this.controls.querySelectorAll("[data-arcade-choice]").forEach((button) => {
        button.addEventListener("pointerdown", () => this.sendChoice(button.dataset.arcadeChoice));
      });
      this.onCanvasPointer = (event) => {
        const rect = this.canvas.getBoundingClientRect();
        this.sendChoice(event.clientX < rect.left + rect.width / 2 ? "left" : "right");
      };
      this.canvas.addEventListener("pointerdown", this.onCanvasPointer);
    } else if (family === "timing") {
      this.controls.innerHTML = `
        <button class="arcade-tap-button" type="button" aria-label="Jetzt auslösen"><span>●</span></button>
      `;
      this.controls.querySelector("button").addEventListener("pointerdown", () => {
        this.localPulse = 1;
        this.feedback?.sound("lock");
        this.feedback?.vibrate([14, 18, 28]);
        this.sendInput({ action: "tap" }).catch(() => {});
      });
    } else if (family === "steer") {
      this.controls.innerHTML = `<div class="mobile-stick-controls joystick-only"><div class="joystick-slot"></div></div>`;
      this.joystick = new VirtualJoystick({
        root: this.controls.querySelector(".joystick-slot"),
        label: "Figur bewegen",
        intervalMs: 86,
        feedback: this.feedback,
        onDirection: (action) => this.sendInput({ action }).catch(() => {})
      });
    } else if (family === "plinko") {
      this.controls.innerHTML = "";
      this.onCanvasPointer = (event) => this.sendDrop(event);
      this.canvas.addEventListener("pointerdown", this.onCanvasPointer);
    } else if (family === "curling") {
      this.controls.innerHTML = "";
      this.onCanvasPointer = (event) => {
        this.swipe = { startX: event.clientX, startY: event.clientY, startedAt: performance.now() };
      };
      this.onCanvasPointerUp = (event) => this.sendFlick(event);
      this.canvas.addEventListener("pointerdown", this.onCanvasPointer);
      this.canvas.addEventListener("pointerup", this.onCanvasPointerUp);
    } else {
      this.controls.innerHTML = "";
      this.onCanvasPointer = (event) => this.sendTarget(event);
      this.canvas.addEventListener("pointerdown", this.onCanvasPointer);
    }
    this.loop();
  }

  handleUpdate(update) {
    const controlledId = this.getControlledPlayerId();
    const previous = this.update?.arcade;
    const arcade = update.arcade;
    const controlled = arcade?.players?.[controlledId];
    const previousControlled = previous?.players?.[controlledId];
    const family = arcade?.family;
    const score = controlled?.score || 0;

    if ((arcade?.clacks || 0) > (previous?.clacks || 0)) {
      this.feedback?.sound("clack");
      this.feedback?.vibrate(14);
    }
    if ((controlled?.plinks || 0) > (previousControlled?.plinks || 0)) {
      this.feedback?.sound("plink");
      this.feedback?.vibrate(6);
    }

    if (score > this.lastScore) {
      this.localPulse = 1;
      const scoreGain = score - this.lastScore;
      if (family === "target") this.feedback?.sound(scoreGain >= 18 ? "perfect" : "pop");
      else if (family === "plinko") this.feedback?.sound(scoreGain >= 7 ? "perfect" : "coin");
      else this.feedback?.sound(scoreGain >= 2 ? "perfect" : "coin");
      this.feedback?.vibrate(scoreGain >= 2 ? [12, 16, 24] : 10);
    } else if (controlled?.flash === "bad" && controlled?.lastHitAt > (previousControlled?.lastHitAt || 0)) {
      this.feedback?.sound("error");
      this.feedback?.vibrate([18, 18, 18]);
    }
    this.lastScore = score;
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.joystick?.destroy();
    this.joystick = null;
    if (this.onCanvasPointer) this.canvas.removeEventListener("pointerdown", this.onCanvasPointer);
    if (this.onCanvasPointerUp) this.canvas.removeEventListener("pointerup", this.onCanvasPointerUp);
    this.onCanvasPointer = null;
    this.onCanvasPointerUp = null;
    this.controls.innerHTML = "";
  }

  sendChoice(action) {
    this.localPulse = 1;
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action }).catch(() => {});
  }

  sendTarget(event) {
    if (!this.playArea || !this.lastCanvasSize) return;
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = (event.clientX - rect.left) / rect.width * this.lastCanvasSize.width;
    const canvasY = (event.clientY - rect.top) / rect.height * this.lastCanvasSize.height;
    const x = clamp(canvasX / this.lastCanvasSize.width, 0, 1);
    const y = clamp((canvasY - this.playArea.top) / this.playArea.height, 0, 1);
    this.touchPulse = { x: canvasX, y: canvasY, at: performance.now() };
    this.feedback?.vibrate(8);
    this.sendInput({ action: "target", x, y }).catch(() => {});
  }

  sendDrop(event) {
    const rect = this.canvas.getBoundingClientRect();
    let x;
    if (this.field && this.lastCanvasSize) {
      const canvasX = (event.clientX - rect.left) / rect.width * this.lastCanvasSize.width;
      x = clamp((canvasX - this.field.x0) / this.field.scale, 0.06, 0.94);
    } else {
      x = clamp((event.clientX - rect.left) / rect.width, 0.06, 0.94);
    }
    this.localPulse = 1;
    this.feedback?.sound("drop");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "drop", x }).catch(() => {});
  }

  sendFlick(event) {
    if (!this.swipe) return;
    const rect = this.canvas.getBoundingClientRect();
    const dx = clamp((event.clientX - this.swipe.startX) / (rect.width * 0.55), -1, 1);
    const dy = clamp((event.clientY - this.swipe.startY) / (rect.height * 0.45), -1, 0.1);
    this.swipe = null;
    if (Math.hypot(dx, dy) < 0.08) return;
    this.localPulse = 1;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate([10, 12, 16]);
    this.sendInput({ action: "flick", dx, dy }).catch(() => {});
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    const arcade = minigame?.arcade;
    if (!minigame || !state || !arcade) return;

    const { ctx, width, height } = setupCanvas(this.canvas);
    const now = this.now();
    const visual = VISUALS[minigame.type] || VISUALS.petalPanic;
    const viewport = gameViewport(height, this.controls, state, 82);
    const playTop = viewport.top + 58;
    const playBottom = viewport.bottom - 8;
    this.playArea = { top: playTop, bottom: playBottom, height: Math.max(120, playBottom - playTop) };
    this.lastCanvasSize = { width, height };

    fillGradient(ctx, width, height, visual.top, visual.bottom);
    drawAmbientDots(ctx, width, height, visual, now);
    this.drawStatus(ctx, state.players, minigame, width, viewport.top, visual, now);

    if (arcade.family === "choice") this.drawChoice(ctx, minigame, arcade, width, this.playArea, visual, now);
    if (arcade.family === "timing") this.drawTiming(ctx, minigame, arcade, width, this.playArea, visual, now);
    if (arcade.family === "steer") this.drawSteer(ctx, state.players, arcade, width, this.playArea, visual, now);
    if (arcade.family === "target") this.drawTargets(ctx, arcade, width, this.playArea, visual, now);
    if (arcade.family === "plinko") this.drawPlinko(ctx, state.players, arcade, width, this.playArea, visual, now);
    if (arcade.family === "curling") this.drawCurling(ctx, state.players, arcade, width, this.playArea, visual, now);

    this.drawFeedback(ctx, arcade, width, height, visual, now);
    this.localPulse *= 0.86;
    drawCountdownOverlay(ctx, minigame, now, width, height);
  }

  drawStatus(ctx, players, minigame, width, top, visual, now) {
    const controlledId = this.getControlledPlayerId();
    const gap = 5;
    const railWidth = width - 28;
    const chipWidth = (railWidth - gap * 3) / 4;
    players.forEach((player, index) => {
      const x = 14 + index * (chipWidth + gap);
      const selected = player.id === controlledId;
      roundedPath(ctx, x, top + 2, chipWidth, 34, 10);
      ctx.fillStyle = selected ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.45)";
      ctx.fill();
      roundedPath(ctx, x + 5.5, top + 7.5, 11, 11, 3.5);
      ctx.fillStyle = player.color;
      ctx.fill();
      ctx.fillStyle = "#22322f";
      ctx.font = "800 10px ui-rounded, system-ui, sans-serif";
      ctx.fillText(player.name.slice(0, 6), x + 21, top + 16);
      ctx.font = "900 11px ui-rounded, system-ui, sans-serif";
      ctx.fillText(String(Math.round(minigame.scores[player.id] || 0)), x + 9, top + 30);
    });
    drawProgress(ctx, minigame, now, 14, top + 42, width - 28, 7, "#ffffff");
  }

  drawChoice(ctx, minigame, arcade, width, area, visual, now) {
    const centerX = width / 2;
    const centerY = area.top + area.height * 0.48;
    const cue = arcade.cue || "left";
    const cuePulse = 1 - clamp((now - arcade.cueAt) / arcade.beatMs, 0, 1);
    const radius = Math.min(width * 0.29, area.height * 0.28);

    drawStemScene(ctx, centerX, centerY, radius, cue, visual, cuePulse);

    const arrowX = centerX + (cue === "left" ? -1 : 1) * radius * 0.72;
    ctx.save();
    ctx.translate(arrowX, centerY);
    ctx.scale(1 + cuePulse * 0.16 + this.localPulse * 0.08, 1 + cuePulse * 0.16 + this.localPulse * 0.08);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 3;
    ctx.font = `900 ${Math.max(54, radius * 0.6)}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(cue === "left" ? "←" : "→", 0, 0);
    ctx.fillText(cue === "left" ? "←" : "→", 0, 0);
    ctx.restore();
  }

  drawTiming(ctx, minigame, arcade, width, area, visual, now) {
    const phase = ((now - minigame.startedAt) / arcade.periodMs) % 1;
    const centerX = width / 2;
    const centerY = area.top + area.height * 0.48;
    const radius = Math.min(width * 0.3, area.height * 0.34);
    if (minigame.type === "tideTap") drawTide(ctx, centerX, centerY, radius, phase, arcade.timingTarget, visual, now);
    else drawOrbit(ctx, centerX, centerY, radius, phase, arcade.timingTarget, visual);
  }

  drawSteer(ctx, players, arcade, width, area, visual, now) {
    // Square arena so server distances render undistorted on tall screens.
    const size = Math.min(width - 28, area.height - 8);
    const arena = { x: (width - size) / 2, y: area.top + (area.height - size) / 2, width: size, height: size };
    roundedPath(ctx, arena.x, arena.y, arena.width, arena.height, 16);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 3;
    ctx.stroke();

    const point = (position) => ({
      x: arena.x + position.x * arena.width,
      y: arena.y + position.y * arena.height
    });

    if (arcade.mode === "collect") drawCoinTarget(ctx, point(arcade.target), visual, now);
    if (arcade.mode === "chase") drawMagnet(ctx, point(arcade.target), visual, now);
    if (arcade.mode === "stay") drawGravityZone(ctx, point(arcade.target), Math.min(arena.width, arena.height) * 0.22, visual, now);
    if (arcade.mode === "avoid") arcade.hazards.forEach((hazard, index) => drawIceHazard(ctx, point(hazard), Math.min(arena.width, arena.height) * hazard.radius, visual, now, index));

    const controlledId = this.getControlledPlayerId();
    const kinRadius = size * 0.055;
    [...players]
      .sort((a, b) => (arcade.players[a.id]?.y || 0) - (arcade.players[b.id]?.y || 0))
      .forEach((player, index) => {
        const entry = arcade.players[player.id];
        if (!entry) return;
        drawArcadeKin(ctx, point(entry), player, player.id === controlledId, now, index, kinRadius);
      });
  }

  drawTargets(ctx, arcade, width, area, visual, now) {
    drawTargetArena(ctx, width, area, visual, now, arcade.mode);
    const controlled = arcade.players[this.getControlledPlayerId()];
    const active = arcade.targets.filter((target) => now >= target.spawnAt && now <= target.expiresAt && !controlled?.hitTargets?.[target.id]);
    active.forEach((target) => {
      const position = arcadeTargetPosition(arcade, target, now);
      const x = position.x * width;
      const y = area.top + position.y * area.height;
      if (position.y < -0.05 || position.y > 1.08) return;
      const radius = target.radius * Math.min(width, area.height) * 1.35;
      const age = clamp((now - target.spawnAt) / (target.expiresAt - target.spawnAt), 0, 1);
      if (arcade.mode === "sort") drawSortTarget(ctx, x, y, radius, target.kind, visual, age);
      else drawBubbleTarget(ctx, x, y, radius, target.kind, visual, now, target.id);
    });
  }

  drawPlinko(ctx, players, arcade, width, area, visual, now) {
    const colors = new Map(players.map((player) => [player.id, player.color]));
    const controlledId = this.getControlledPlayerId();
    const floorY = arcade.floorY || 1.3;
    // One uniform pixel scale for x and y so the drawn contacts match the
    // server physics exactly (no stretched "air bounces").
    const logicalHeight = floorY + 0.12;
    const scale = Math.min(width - 10, (area.height - 8) / logicalHeight);
    const x0 = (width - scale) / 2;
    const y0 = area.top + Math.max(0, (area.height - scale * logicalHeight) / 2);
    const toX = (x) => x0 + x * scale;
    const toY = (y) => y0 + y * scale;
    this.field = { x0, y0, scale };

    roundedPath(ctx, x0 - 4, y0 - 4, scale + 8, scale * logicalHeight + 8, 14);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.stroke();

    const slotCount = arcade.slots.length;
    const slotWidth = scale / slotCount;
    arcade.slots.forEach((points, index) => {
      const goldness = points >= 10 ? 1 : points >= 5 ? 0.55 : 0.22;
      roundedPath(ctx, x0 + index * slotWidth + 2, toY(floorY), slotWidth - 4, scale * 0.1, 8);
      ctx.fillStyle = `rgba(255, 209, 92, ${goldness})`;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#5c4508";
      ctx.font = "900 15px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(points), x0 + index * slotWidth + slotWidth / 2, toY(floorY) + scale * 0.065);
      ctx.textAlign = "left";
    });

    arcade.pegs.forEach((peg) => {
      const size = peg.r * scale * 2 * 0.72;
      ctx.save();
      ctx.translate(toX(peg.x), toY(peg.y));
      ctx.rotate(Math.PI / 4);
      roundedPath(ctx, -size / 2, -size / 2, size, size, size * 0.22);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "rgba(168,60,110,0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    });

    (arcade.balls || []).forEach((ball) => {
      const color = colors.get(ball.playerId) || "#ffffff";
      const size = 0.028 * scale * 2;
      ctx.save();
      ctx.translate(toX(ball.x), toY(ball.y));
      ctx.rotate((ball.plinks || 0) * 0.5);
      roundedPath(ctx, -size / 2, -size / 2, size, size, size * 0.3);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.stroke();
      roundedPath(ctx, -size * 0.32, -size * 0.32, size * 0.26, size * 0.2, size * 0.08);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fill();
      ctx.restore();
    });

    const own = arcade.players[controlledId];
    const inFlight = (arcade.balls || []).some((ball) => ball.playerId === controlledId);
    if (own && !inFlight) {
      const aimX = toX(own.aimX ?? 0.5);
      ctx.setLineDash([4, 8]);
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(aimX, toY(0.03));
      ctx.lineTo(aimX, toY(0.2));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "800 13px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Tippen zum Fallenlassen", width / 2, toY(0.12));
      ctx.textAlign = "left";
    }
  }

  drawCurling(ctx, players, arcade, width, area, visual, now) {
    const colors = new Map(players.map((player) => [player.id, player.color]));
    const controlledId = this.getControlledPlayerId();
    const sheetY = arcade.sheetY || 1.3;
    // Uniform scale on both axes: drawn stone contacts match server physics.
    const scale = Math.min(width - 14, (area.height - 8) / sheetY);
    const x0 = (width - scale) / 2;
    const y0 = area.top + Math.max(0, (area.height - scale * sheetY) / 2);
    const toX = (x) => x0 + x * scale;
    const toY = (y) => y0 + y * scale;
    this.field = { x0, y0, scale };

    roundedPath(ctx, x0 - 5, y0 - 5, scale + 10, scale * sheetY + 10, 18);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();

    [...arcade.rings].reverse().forEach((ring, index) => {
      ctx.beginPath();
      ctx.arc(toX(arcade.house.x), toY(arcade.house.y), ring.radius * scale, 0, Math.PI * 2);
      ctx.fillStyle = index === 0 ? "rgba(96,196,232,0.35)" : index === 1 ? "rgba(255,255,255,0.75)" : "rgba(255,113,136,0.5)";
      ctx.fill();
      ctx.strokeStyle = "rgba(42,123,168,0.4)";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(toX(arcade.house.x), toY(arcade.house.y), 5, 0, Math.PI * 2);
    ctx.fillStyle = "#2a7ba8";
    ctx.fill();

    (arcade.stones || []).forEach((stone) => {
      const color = colors.get(stone.playerId) || "#ffffff";
      const x = toX(stone.x);
      const y = toY(stone.y);
      const radius = 0.042 * scale;
      roundedPath(ctx, x - radius * 0.95, y + radius * 0.5, radius * 1.9, radius * 0.55, radius * 0.2);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fill();
      roundedPath(ctx, x - radius, y - radius, radius * 2, radius * 2, radius * 0.42);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3.5;
      ctx.stroke();
      roundedPath(ctx, x - radius * 0.45, y - radius * 0.45, radius * 0.9, radius * 0.9, radius * 0.22);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fill();
    });

    const own = arcade.players[controlledId];
    if (own) {
      const startX = toX(own.startX ?? 0.5);
      const startY = toY(sheetY - 0.14);
      for (let stone = 0; stone < (own.stonesLeft || 0); stone += 1) {
        roundedPath(ctx, startX + (stone - 1) * 16 - 5.5, startY + 20, 11, 11, 3.5);
        ctx.fillStyle = colors.get(controlledId) || "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if ((own.stonesLeft || 0) > 0) {
        ctx.fillStyle = "rgba(34,50,47,0.75)";
        ctx.font = "800 13px ui-rounded, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Nach oben wischen", width / 2, toY(sheetY) - 6);
        ctx.textAlign = "left";
      }
    }
  }

  drawFeedback(ctx, arcade, width, height, visual, now) {
    const controlled = arcade.players[this.getControlledPlayerId()];
    const age = now - (controlled?.lastHitAt || 0);
    if (age >= 0 && age < 300) {
      ctx.fillStyle = controlled.flash === "good"
        ? `rgba(255,255,255,${(1 - age / 300) * 0.22})`
        : `rgba(255,93,115,${(1 - age / 300) * 0.2})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (this.touchPulse) {
      const touchAge = performance.now() - this.touchPulse.at;
      if (touchAge < 420) {
        ctx.beginPath();
        ctx.arc(this.touchPulse.x, this.touchPulse.y, 12 + touchAge * 0.11, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${1 - touchAge / 420})`;
        ctx.lineWidth = 5;
        ctx.stroke();
      } else {
        this.touchPulse = null;
      }
    }
  }
}

function arcadeTargetPosition(arcade, target, now) {
  if (arcade.mode !== "bubble") return { x: target.x, y: target.y };
  const seconds = Math.max(0, now - target.spawnAt) / 1000;
  return {
    x: clamp(target.x + Math.sin(seconds * 2.2 + target.id) * 0.045, 0.05, 0.95),
    y: target.y - (target.rise || 0.2) * seconds
  };
}

function drawAmbientDots(ctx, width, height, visual, now) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#ffffff";
  const offset = (now / 90) % 38;
  for (let y = -38; y < height + 38; y += 38) {
    for (let x = -38; x < width + 38; x += 38) {
      ctx.beginPath();
      ctx.arc(x + ((y / 38) % 2) * 19, y + offset, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawStemScene(ctx, x, y, radius, cue, visual, pulse) {
  ctx.strokeStyle = "#2e7d4f";
  ctx.lineWidth = radius * 0.12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y + radius);
  ctx.quadraticCurveTo(x - radius * 0.2, y, x, y - radius);
  ctx.stroke();
  [-1, 1].forEach((side) => {
    const active = (side < 0 ? "left" : "right") === cue;
    ctx.save();
    ctx.translate(x + side * radius * 0.55, y - radius * 0.1);
    ctx.rotate(side * -0.42);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * (active ? 0.52 + pulse * 0.05 : 0.42), radius * 0.24, 0, 0, Math.PI * 2);
    ctx.fillStyle = active ? visual.warm : "rgba(255,255,255,0.5)";
    ctx.fill();
    ctx.restore();
  });
}

function drawOrbit(ctx, x, y, radius, phase, target, visual) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 13;
  ctx.stroke();
  drawTimingTargetArc(ctx, x, y, radius, target, visual.accent);
  const angle = phase * Math.PI * 2 - Math.PI / 2;
  drawGlowBall(ctx, x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, radius * 0.13, visual.warm);
  drawSocket(ctx, x + Math.cos(target * Math.PI * 2 - Math.PI / 2) * radius, y + Math.sin(target * Math.PI * 2 - Math.PI / 2) * radius, radius * 0.19, visual.accent);
}

function drawTide(ctx, x, y, radius, phase, target, visual, now) {
  const left = x - radius * 1.2;
  const width = radius * 2.4;
  for (let layer = 0; layer < 3; layer += 1) {
    ctx.beginPath();
    for (let step = 0; step <= 60; step += 1) {
      const t = step / 60;
      const px = left + t * width;
      const py = y + Math.sin(t * Math.PI * 2 + now / 430 + layer) * radius * (0.18 + layer * 0.05) + layer * 18;
      if (step === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = layer === 0 ? visual.accent : `rgba(255,255,255,${0.6 - layer * 0.14})`;
    ctx.lineWidth = 7 - layer;
    ctx.stroke();
  }
  const markerX = left + phase * width;
  const markerY = y + Math.sin(phase * Math.PI * 2 + now / 430) * radius * 0.18;
  drawGlowBall(ctx, markerX, markerY, radius * 0.12, visual.warm);
  const targetX = left + target * width;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(targetX - radius * 0.12, y - radius * 0.75, radius * 0.24, radius * 1.5);
}

function drawTimingTargetArc(ctx, x, y, radius, target, color) {
  const angle = target * Math.PI * 2 - Math.PI / 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, angle - 0.24, angle + 0.24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 18;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawSocket(ctx, x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.stroke();
}

function drawGlowBall(ctx, x, y, radius, color) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.5);
  glow.addColorStop(0, color);
  glow.addColorStop(0.4, color);
  glow.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

function drawCoinTarget(ctx, point, visual, now) {
  const pulse = 1 + Math.sin(now / 120) * 0.08;
  drawGlowBall(ctx, point.x, point.y, 12 * pulse, visual.warm);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, Math.PI * 2);
  ctx.fillStyle = "#ffd15c";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.strokeStyle = "#b77713";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawMagnet(ctx, point, visual, now) {
  const pulse = 1 + Math.sin(now / 160) * 0.08;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 32 * pulse, 0.2 * Math.PI, 0.8 * Math.PI, true);
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 32 * pulse, -0.2 * Math.PI, -0.8 * Math.PI, false);
  ctx.strokeStyle = visual.warm;
  ctx.lineWidth = 14;
  ctx.stroke();
}

function drawGravityZone(ctx, point, radius, visual, now) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius * (1 + Math.sin(now / 260) * 0.04), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = 5;
  ctx.setLineDash([8, 10]);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let petal = 0; petal < 6; petal += 1) {
    const angle = petal / 6 * Math.PI * 2 + now / 1800;
    ctx.beginPath();
    ctx.ellipse(point.x + Math.cos(angle) * radius * 0.58, point.y + Math.sin(angle) * radius * 0.58, 8, 4, angle, 0, Math.PI * 2);
    ctx.fillStyle = visual.warm;
    ctx.fill();
  }
}

function drawIceHazard(ctx, point, radius, visual, now, index) {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(now / 900 * (index % 2 ? -1 : 1));
  ctx.beginPath();
  for (let edge = 0; edge < 6; edge += 1) {
    const angle = edge / 6 * Math.PI * 2;
    const r = radius * (edge % 2 ? 0.7 : 1.15);
    if (edge === 0) ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r);
    else ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.88;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = visual.accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

function drawArcadeKin(ctx, point, player, active, now, index, radius = 14) {
  drawBlobAvatar(ctx, point.x, point.y, player, { radius, active, now, variant: index });
}

function drawTargetArena(ctx, width, area, visual, now, mode) {
  const x = 12;
  const y = area.top;
  const arenaWidth = width - 24;
  const arenaHeight = area.height - 4;
  roundedPath(ctx, x, y, arenaWidth, arenaHeight, 16);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineWidth = 3;
  ctx.stroke();

  if (mode === "bubble") {
    for (let ray = 0; ray < 5; ray += 1) {
      const rx = x + 20 + ray * (arenaWidth - 40) / 4;
      ctx.beginPath();
      ctx.moveTo(rx, y + 6);
      ctx.lineTo(rx + 14, y + arenaHeight - 6);
      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.lineWidth = 10;
      ctx.stroke();
    }
  }
}

function drawSortTarget(ctx, x, y, radius, kind, visual, age) {
  ctx.beginPath();
  ctx.arc(x, y, radius * (1 + Math.sin(age * Math.PI) * 0.1), 0, Math.PI * 2);
  ctx.fillStyle = kind === "bad" ? visual.warm : "#ffd15c";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.stroke();
  if (kind === "bad") {
    ctx.fillStyle = "#5c1f2c";
    ctx.font = `900 ${radius * 1.1}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("×", x, y + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  } else {
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = "#b77713";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawBubbleTarget(ctx, x, y, radius, kind, visual, now, id) {
  const wobble = 1 + Math.sin(now / 260 + id) * 0.05;
  const gold = kind === "gold";
  ctx.beginPath();
  ctx.ellipse(x, y, radius * wobble, radius * (2 - wobble), 0, 0, Math.PI * 2);
  ctx.fillStyle = gold ? "rgba(255,209,92,0.55)" : "rgba(255,255,255,0.35)";
  ctx.fill();
  ctx.strokeStyle = gold ? "#ffbe2e" : "rgba(255,255,255,0.9)";
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.32, y - radius * 0.36, radius * 0.22, radius * 0.14, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fill();
  if (gold) {
    ctx.fillStyle = "#a86a12";
    ctx.font = `900 ${Math.max(12, radius * 0.6)}px ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★", x, y + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
}

function roundedPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
