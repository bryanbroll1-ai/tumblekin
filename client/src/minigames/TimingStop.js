import { countdownText, drawCountdownOverlay, drawProgress, fillGradient, gameViewport, setupCanvas } from "./canvasTools.js?v=tumblekin36";

export class TimingStop {
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
    this.localStopped = new Set();
    this.lockPulse = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.localStopped.clear();
    this.controls.innerHTML = `<button class="primary-btn stop-button" type="button">PULS VERRIEGELN</button>`;
    this.controls.querySelector("button").addEventListener("pointerdown", () => {
      const controlledId = this.getControlledPlayerId();
      if (this.update?.stopped?.[controlledId] || this.localStopped.has(controlledId)) return;
      this.localStopped.add(controlledId);
      this.lockPulse = 1;
      this.updateButtonState();
      this.feedback?.sound("lock");
      this.feedback?.vibrate([20, 24, 55]);
      this.sendInput({ action: "stop" }).catch(() => {});
    });
    this.loop();
  }

  handleUpdate(update) {
    this.update = update;
    this.updateButtonState();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    if (!minigame || !state) return;
    this.updateButtonState();

    const { ctx, width, height } = setupCanvas(this.canvas);
    const now = this.now();
    const controlledId = this.getControlledPlayerId();
    const controlledStopped = Boolean(minigame.stopped[controlledId] || this.localStopped.has(controlledId));
    const viewport = gameViewport(height, this.controls, state, 84);
    fillGradient(ctx, width, height, "#f9efc7", "#d9f3ff");
    drawCircuitLines(ctx, width, height);

    ctx.fillStyle = "#171821";
    ctx.font = "950 26px system-ui, sans-serif";
    ctx.fillText(countdownText(minigame, now), 18, viewport.top + 28);
    drawProgress(ctx, minigame, now, 18, viewport.top + 40, width - 36, 10, "#43e38c");

    const centerX = width / 2;
    const dialTop = viewport.top + 58;
    const dialBottom = viewport.bottom - 78;
    const centerY = (dialTop + dialBottom) / 2;
    const radius = Math.min(width * 0.31, Math.max(74, (dialBottom - dialTop) * 0.42));
    this.drawDial(ctx, minigame, now, centerX, centerY, radius, controlledStopped);
    this.drawRank(ctx, state.players, minigame, width, viewport.bottom, controlledId);

    this.lockPulse *= 0.84;
    if (this.lockPulse > 0.02) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * (0.55 + this.lockPulse * 0.85), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(67,227,140,${this.lockPulse * 0.75})`;
      ctx.lineWidth = 8 * this.lockPulse;
      ctx.stroke();
    }
    drawCountdownOverlay(ctx, minigame, now, width, height);
  }

  drawDial(ctx, minigame, now, centerX, centerY, radius, locked) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX + 4, centerY + 12, radius * 1.06, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(23,24,33,0.16)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#171821";
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.86, -Math.PI * 0.62, -Math.PI * 0.38);
    ctx.strokeStyle = "#43e38c";
    ctx.lineWidth = radius * 0.18;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.lineCap = "butt";

    for (let tick = 0; tick < 24; tick += 1) {
      const angle = (tick / 24) * Math.PI * 2;
      const inner = radius * (tick % 6 === 0 ? 0.68 : 0.74);
      ctx.beginPath();
      ctx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
      ctx.lineTo(centerX + Math.cos(angle) * radius * 0.82, centerY + Math.sin(angle) * radius * 0.82);
      ctx.strokeStyle = tick % 6 === 0 ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.26)";
      ctx.lineWidth = tick % 6 === 0 ? 3 : 1.5;
      ctx.stroke();
    }

    const position = markerPosition(minigame, now);
    const angle = (position - 0.5) * Math.PI * 2 - Math.PI / 2;
    const markerX = centerX + Math.cos(angle) * radius * 0.78;
    const markerY = centerY + Math.sin(angle) * radius * 0.78;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(markerX, markerY);
    ctx.strokeStyle = locked ? "#43e38c" : "#36c5ff";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(markerX, markerY, radius * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = locked ? "#43e38c" : "#36c5ff";
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = "#ffe25c";
    ctx.fill();
    ctx.fillStyle = "#171821";
    ctx.font = `950 ${Math.max(15, radius * 0.14)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(locked ? "LOCK" : "LIVE", centerX, centerY + 1);
    ctx.restore();
  }

  drawRank(ctx, players, minigame, width, height, controlledId) {
    const startY = height - 72;
    const chipWidth = (width - 30) / 2;
    players.forEach((player, index) => {
      const x = 10 + (index % 2) * (chipWidth + 10);
      const y = startY + Math.floor(index / 2) * 31;
      ctx.fillStyle = player.id === controlledId ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.56)";
      roundRect(ctx, x, y, chipWidth, 26, 5);
      ctx.fill();
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(x + 12, y + 13, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#171821";
      ctx.font = "950 11px system-ui, sans-serif";
      ctx.fillText(player.name, x + 24, y + 17);
      ctx.textAlign = "right";
      ctx.fillText(minigame.stopped[player.id] ? String(minigame.scores[player.id] || 0) : "LIVE", x + chipWidth - 8, y + 17);
      ctx.textAlign = "left";
    });
  }

  updateButtonState() {
    const minigame = this.update || this.minigame;
    const button = this.controls.querySelector("button");
    if (!button || !minigame) return;
    const controlledId = this.getControlledPlayerId();
    const stopped = Boolean(minigame.stopped?.[controlledId] || this.localStopped.has(controlledId));
    button.disabled = stopped;
    button.textContent = stopped ? `VERRIEGELT · ${minigame.scores?.[controlledId] || "..."}` : "PULS VERRIEGELN";
  }
}

function markerPosition(minigame, now) {
  const period = 1450;
  const elapsed = Math.max(0, now - minigame.startedAt);
  const phase = (elapsed % period) / period;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

function drawCircuitLines(ctx, width, height) {
  ctx.strokeStyle = "rgba(23,24,33,0.05)";
  ctx.lineWidth = 2;
  for (let offset = -height; offset < width + height; offset += 54) {
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset + height, height);
    ctx.stroke();
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
