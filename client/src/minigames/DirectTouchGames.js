import { drawCountdownOverlay, drawPill, drawProgress, fillGradient, gameViewport, setupCanvas } from "./canvasTools.js?v=tumblekin36";

const PALETTES = {
  catch: { top: "#2d3f77", bottom: "#141d3a", accent: "#62dcff", warm: "#ffd15c", bad: "#ef6673" },
  balance: { top: "#2f6b5c", bottom: "#14332c", accent: "#69e0c0", warm: "#ffd15c", bad: "#ef6673" }
};

export class DirectTouchGames {
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
    this.pointerId = null;
    this.localX = null;
    this.lastSentAt = 0;
    this.lastScore = 0;
    this.lastHitAt = 0;
    this.flash = 0;
    this.touchRipple = null;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.canvas.hidden = false;
    this.controls.innerHTML = "";
    this.bindPointer();
    this.loop();
  }

  handleUpdate(update) {
    const current = update.arcade?.players?.[this.getControlledPlayerId()];
    const score = current?.score || 0;
    if (score > this.lastScore + 2) {
      this.flash = 1;
      this.feedback?.sound("perfect");
      this.feedback?.vibrate([10, 12, 22]);
    }
    if ((current?.lastHitAt || 0) > this.lastHitAt && current?.flash === "bad") {
      this.flash = -1;
      this.feedback?.sound("error");
      this.feedback?.vibrate([18, 16, 24]);
    }
    this.lastScore = score;
    this.lastHitAt = current?.lastHitAt || this.lastHitAt;
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerEnd);
    this.canvas.removeEventListener("pointercancel", this.onPointerEnd);
    this.controls.innerHTML = "";
  }

  bindPointer() {
    this.onPointerDown = (event) => {
      event.preventDefault();
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.canvas.setPointerCapture?.(event.pointerId);
      this.feedback?.sound("move");
      this.feedback?.vibrate(8);
      this.sendPointer(event, true);
    };
    this.onPointerMove = (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this.sendPointer(event, false);
    };
    this.onPointerEnd = (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this.sendPointer(event, true);
      this.pointerId = null;
      this.localX = null;
    };
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerEnd);
    this.canvas.addEventListener("pointercancel", this.onPointerEnd);
  }

  sendPointer(event, force) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0.06, 0.94);
    this.localX = x;
    this.touchRipple = { x: event.clientX - rect.left, y: event.clientY - rect.top, at: performance.now() };
    const now = performance.now();
    if (!force && now - this.lastSentAt < 42) return;
    this.lastSentAt = now;
    this.sendInput({ action: "move", x }).catch(() => {});
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
    const palette = PALETTES[arcade.mode] || PALETTES.catch;
    const viewport = gameViewport(height, this.controls, state, 82);
    fillGradient(ctx, width, height, palette.top, palette.bottom);
    drawAmbient(ctx, width, height, arcade.mode, palette, now);
    this.drawStatus(ctx, state.players, minigame, width, viewport.top, palette, now);

    if (arcade.mode === "catch") this.drawCatch(ctx, minigame, arcade, width, viewport, palette, now);
    else this.drawBalance(ctx, arcade, width, viewport, palette, now);

    this.drawFeedback(ctx, width, height, palette);
    this.drawTouchRipple(ctx, palette);
    drawCountdownOverlay(ctx, minigame, now, width, height);
  }

  drawStatus(ctx, players, minigame, width, top, palette, now) {
    const controlledId = this.getControlledPlayerId();
    const gap = 5;
    const railX = 12;
    const railWidth = width - 24;
    const chipWidth = (railWidth - gap * Math.max(0, players.length - 1)) / Math.max(1, players.length);
    players.forEach((player, index) => {
      const x = railX + index * (chipWidth + gap);
      const active = player.id === controlledId;
      drawPill(ctx, x, top, chipWidth, 30, active ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.16)");
      ctx.beginPath();
      ctx.arc(x + 13, top + 15, 6, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();
      ctx.fillStyle = active ? "#172126" : "#ffffff";
      ctx.font = "950 12px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(String(Math.round(minigame.arcade.players[player.id]?.score || 0)), x + chipWidth - 9, top + 19);
    });
    ctx.textAlign = "left";
    drawProgress(ctx, minigame, now, railX, top + 38, railWidth, 7, palette.accent);
  }

  drawCatch(ctx, minigame, arcade, width, viewport, palette, now) {
    const playTop = viewport.top + 58;
    const catchY = viewport.bottom - 70;
    const controlled = arcade.players[this.getControlledPlayerId()];
    const trayX = (this.localX ?? controlled?.x ?? 0.5) * width;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 10]);
    ctx.beginPath();
    ctx.moveTo(12, catchY + 34);
    ctx.lineTo(width - 12, catchY + 34);
    ctx.stroke();
    ctx.setLineDash([]);

    arcade.drops.forEach((drop) => {
      const progress = (now - drop.spawnAt) / Math.max(1, drop.impactAt - drop.spawnAt);
      if (progress < -0.08 || progress > 1.2) return;
      const eased = 1 - Math.pow(1 - clamp(progress, 0, 1), 2);
      const sway = Math.sin(progress * Math.PI * 3 + drop.id) * 12;
      const x = drop.x * width + sway;
      const y = playTop + eased * (catchY - playTop);
      const fade = progress > 1 ? 1 - (progress - 1) / 0.2 : 1;
      drawLantern(ctx, x, y, drop.kind, drop.tone, palette, now, drop.id, fade);
    });

    drawCatchTray(ctx, trayX, catchY + 12, palette, now, this.pointerId !== null);
    ctx.restore();
  }

  drawBalance(ctx, arcade, width, viewport, palette, now) {
    const controlled = arcade.players[this.getControlledPlayerId()];
    const marker = this.localX ?? controlled?.x ?? 0.5;
    const centerY = viewport.top + 58 + (viewport.height - 88) * 0.54;
    const bowlWidth = Math.min(width - 32, 560);
    const bowlX = (width - bowlWidth) / 2;
    const bowlHeight = Math.min(250, viewport.height * 0.48);
    const targetX = arcade.target.x * width;
    const zoneWidth = arcade.zoneWidth * width * 2;

    ctx.save();
    const shadow = ctx.createRadialGradient(width / 2, centerY + bowlHeight * 0.42, 10, width / 2, centerY + bowlHeight * 0.42, bowlWidth * 0.54);
    shadow.addColorStop(0, "rgba(0,0,0,0.38)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.fillRect(0, centerY, width, bowlHeight);

    drawBowl(ctx, bowlX, centerY - bowlHeight * 0.34, bowlWidth, bowlHeight, palette, arcade.wind || 0, now);

    const trackY = centerY - bowlHeight * 0.18;
    drawPill(ctx, 18, trackY - 17, width - 36, 34, "rgba(7,18,18,0.58)");
    const zoneGradient = ctx.createLinearGradient(targetX - zoneWidth / 2, 0, targetX + zoneWidth / 2, 0);
    zoneGradient.addColorStop(0, "rgba(105,224,192,0.08)");
    zoneGradient.addColorStop(0.5, "rgba(105,224,192,0.74)");
    zoneGradient.addColorStop(1, "rgba(105,224,192,0.08)");
    drawPill(ctx, targetX - zoneWidth / 2, trackY - 13, zoneWidth, 26, zoneGradient);

    const markerX = marker * width;
    ctx.beginPath();
    ctx.arc(markerX, trackY, 25, 0, Math.PI * 2);
    ctx.fillStyle = controlled?.inside ? palette.warm : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = controlled?.inside ? palette.accent : palette.bad;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(markerX - 7, trackY - 7, 5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fill();

    const pulse = 1 + Math.sin(now / 150) * 0.08;
    ctx.beginPath();
    ctx.arc(targetX, trackY, 35 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(105,224,192,0.34)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  drawFeedback(ctx, width, height, palette) {
    if (Math.abs(this.flash) < 0.02) return;
    ctx.fillStyle = this.flash > 0
      ? `rgba(105,224,192,${this.flash * 0.18})`
      : `rgba(239,102,115,${Math.abs(this.flash) * 0.24})`;
    ctx.fillRect(0, 0, width, height);
    this.flash *= 0.82;
  }

  drawTouchRipple(ctx, palette) {
    if (!this.touchRipple) return;
    const age = performance.now() - this.touchRipple.at;
    if (age > 360) {
      this.touchRipple = null;
      return;
    }
    ctx.beginPath();
    ctx.arc(this.touchRipple.x, this.touchRipple.y, 10 + age * 0.12, 0, Math.PI * 2);
    ctx.strokeStyle = alphaColor(palette.accent, 1 - age / 360);
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function drawAmbient(ctx, width, height, mode, palette, now) {
  ctx.save();
  if (mode === "catch") {
    for (let star = 0; star < 34; star += 1) {
      const x = (star * 83) % width;
      const y = 92 + (star * 47) % Math.max(120, height * 0.58);
      const pulse = 0.2 + (Math.sin(now / 260 + star) + 1) * 0.14;
      ctx.beginPath();
      ctx.arc(x, y, 1 + (star % 3), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${pulse})`;
      ctx.fill();
    }
  } else {
    ctx.strokeStyle = "rgba(105,224,192,0.1)";
    ctx.lineWidth = 3;
    for (let ribbon = 0; ribbon < 6; ribbon += 1) {
      ctx.beginPath();
      const y = 130 + ribbon * 74;
      for (let step = 0; step <= 24; step += 1) {
        const x = step / 24 * width;
        const waveY = y + Math.sin(step * 0.7 + now / 760 + ribbon) * 14;
        if (step === 0) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.stroke();
    }
  }
  const glow = ctx.createRadialGradient(width / 2, height * 0.55, 10, width / 2, height * 0.55, width * 0.72);
  glow.addColorStop(0, alphaColor(palette.accent, 0.1));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawLantern(ctx, x, y, kind, tone, palette, now, id, opacity) {
  const color = kind === "storm" ? palette.bad : ["#ffd15c", "#69e0c0", "#62dcff", "#ff9db1"][tone % 4];
  const radius = kind === "storm" ? 22 : 19;
  ctx.save();
  ctx.globalAlpha = clamp(opacity, 0, 1);
  const glow = ctx.createRadialGradient(x, y, 2, x, y, radius * 2.7);
  glow.addColorStop(0, alphaColor(color, 0.7));
  glow.addColorStop(1, alphaColor(color, 0));
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.7, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.translate(x, y);
  ctx.rotate(Math.sin(now / 210 + id) * 0.12);
  roundedPath(ctx, -radius, -radius * 0.78, radius * 2, radius * 1.56, 8);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.76)";
  ctx.stroke();
  ctx.fillStyle = "rgba(16,24,38,0.82)";
  ctx.fillRect(-radius * 0.72, -radius, radius * 1.44, 4);
  ctx.fillRect(-radius * 0.72, radius * 0.8, radius * 1.44, 4);
  if (kind === "storm") {
    ctx.strokeStyle = "#172126";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-8, -7);
    ctx.lineTo(2, 0);
    ctx.lineTo(-3, 9);
    ctx.lineTo(10, 16);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(-6, -5, 5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.64)";
    ctx.fill();
  }
  ctx.restore();
}

function drawCatchTray(ctx, x, y, palette, now, active) {
  const pulse = active ? 1 + Math.sin(now / 110) * 0.035 : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pulse, 2 - pulse);
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.beginPath();
  ctx.ellipse(0, 30, 54, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-48, -20);
  ctx.lineTo(48, -20);
  ctx.lineTo(34, 26);
  ctx.quadraticCurveTo(0, 39, -34, 26);
  ctx.closePath();
  ctx.fillStyle = "#f2b963";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = palette.accent;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-33, 4);
  ctx.quadraticCurveTo(0, 18, 33, 4);
  ctx.strokeStyle = "rgba(91,57,43,0.62)";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

function drawBowl(ctx, x, y, width, height, palette, wind, now) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + width * 0.04, y + height * 0.16);
  ctx.quadraticCurveTo(x + width * 0.12, y + height * 0.92, x + width * 0.5, y + height * 0.96);
  ctx.quadraticCurveTo(x + width * 0.88, y + height * 0.92, x + width * 0.96, y + height * 0.16);
  ctx.closePath();
  const bowl = ctx.createLinearGradient(x, y, x + width, y + height);
  bowl.addColorStop(0, "rgba(255,255,255,0.74)");
  bowl.addColorStop(0.4, "rgba(90,184,171,0.38)");
  bowl.addColorStop(1, "rgba(14,47,45,0.82)");
  ctx.fillStyle = bowl;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.72)";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x + width / 2, y + height * 0.17, width * 0.46, height * 0.13, wind * 0.035, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(105,224,192,0.72)";
  ctx.fill();
  ctx.strokeStyle = palette.warm;
  ctx.lineWidth = 4;
  ctx.stroke();
  for (let bubble = 0; bubble < 9; bubble += 1) {
    const bx = x + width * (0.18 + ((bubble * 17) % 65) / 100);
    const by = y + height * (0.25 + ((bubble * 23) % 48) / 100) + Math.sin(now / 260 + bubble) * 5;
    ctx.beginPath();
    ctx.arc(bx, by, 4 + bubble % 4, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
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

function alphaColor(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
