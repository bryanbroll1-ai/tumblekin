import { countdownText, drawCountdownOverlay, drawProgress, fillGradient, gameViewport, setupCanvas } from "./canvasTools.js?v=tumblekin36";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin36";
import { drawBlobAvatar } from "../game/BlobAvatar.js?v=tumblekin36";

export class FluxFloor {
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
    this.previousGrid = [];
    this.changedCells = new Map();
    this.lastActionId = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.previousGrid = cloneGrid(minigame.flux?.grid);
    this.lastActionId = minigame.flux?.lastAction?.id || 0;
    this.controls.innerHTML = `
      <div class="mobile-stick-controls">
        <div class="joystick-slot"></div>
        <button class="stick-action-button flux-burst" data-flux-action="burst" type="button"><span>PULSE</span><small>bereit</small></button>
      </div>
    `;

    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Glow Grid bewegen",
      intervalMs: 104,
      feedback: this.feedback,
      onDirection: (action) => this.sendInput({ action }).catch(() => {})
    });
    this.controls.querySelector("[data-flux-action='burst']").addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.feedback?.sound("impact");
      this.feedback?.vibrate([18, 20, 42]);
      this.sendInput({ action: "burst" }).catch(() => {});
    });
    this.loop();
  }

  handleUpdate(update) {
    const nextGrid = update.flux?.grid || [];
    const stamp = performance.now();
    nextGrid.forEach((row, y) => row.forEach((ownerId, x) => {
      if (this.previousGrid[y]?.[x] !== ownerId) this.changedCells.set(`${x},${y}`, stamp);
    }));
    this.previousGrid = cloneGrid(nextGrid);

    const action = update.flux?.lastAction;
    if (action?.id && action.id !== this.lastActionId) {
      this.lastActionId = action.id;
      if (action.playerId === this.getControlledPlayerId()) {
        this.feedback?.sound(action.action === "burst" ? "impact" : "paint");
      }
    }
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.joystick?.destroy();
    this.joystick = null;
    this.controls.innerHTML = "";
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    const flux = minigame?.flux;
    if (!minigame || !state || !flux?.grid) return;

    const { ctx, width, height } = setupCanvas(this.canvas);
    const now = this.now();
    const controlledId = this.getControlledPlayerId();
    const viewport = gameViewport(height, this.controls, state, 84);
    fillGradient(ctx, width, height, "#332a5e", "#1a1440");
    drawBackdrop(ctx, width, height);

    ctx.fillStyle = "#ffffff";
    ctx.font = "950 25px system-ui, sans-serif";
    ctx.fillText(countdownText(minigame, now), 17, viewport.top + 28);
    drawProgress(ctx, minigame, now, 17, viewport.top + 39, width - 34, 10, "#ffe25c");

    const layout = createGridLayout(width, viewport.top + 52, viewport.bottom - 46, flux.size);
    this.drawBoard(ctx, state, flux, layout, controlledId, now);
    this.drawScoreRail(ctx, state.players, minigame, flux, width, viewport.bottom - 39, controlledId);
    this.updateBurstButton(flux, controlledId, now);
    drawCountdownOverlay(ctx, minigame, now, width, height);
  }

  drawBoard(ctx, state, flux, layout, controlledId, now) {
    const colors = new Map(state.players.map((player) => [player.id, player.color]));
    const blocked = new Set((flux.blocked || []).map(([x, y]) => `${x},${y}`));

    const corners = [
      cellQuad(layout, 0, 0)[0],
      cellQuad(layout, flux.size - 1, 0)[1],
      cellQuad(layout, flux.size - 1, flux.size - 1)[2],
      cellQuad(layout, 0, flux.size - 1)[3]
    ];
    drawPolygon(ctx, corners.map((point) => ({ x: point.x, y: point.y + 12 })), "rgba(0,0,0,0.48)");

    for (let y = 0; y < flux.size; y += 1) {
      for (let x = 0; x < flux.size; x += 1) {
        const quad = insetQuad(cellQuad(layout, x, y), 1.2);
        const ownerId = flux.grid[y][x];
        const key = `${x},${y}`;
        const isBlocked = blocked.has(key);
        const baseColor = isBlocked ? "#08090d" : (colors.get(ownerId) || "#292b38");
        drawPolygon(ctx, quad, baseColor);

        if (!isBlocked) {
          ctx.save();
          ctx.globalAlpha = ownerId ? 0.28 : 0.12;
          drawPolygon(ctx, [quad[0], quad[1], midpoint(quad[1], quad[2], 0.33), midpoint(quad[0], quad[3], 0.33)], "#ffffff");
          ctx.restore();
        } else {
          const center = quadCenter(quad);
          ctx.strokeStyle = "rgba(255,255,255,0.2)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(center.x - 6, center.y - 4);
          ctx.lineTo(center.x + 6, center.y + 4);
          ctx.moveTo(center.x + 6, center.y - 4);
          ctx.lineTo(center.x - 6, center.y + 4);
          ctx.stroke();
        }

        const changedAt = this.changedCells.get(key);
        if (changedAt) {
          const pulse = 1 - Math.min(1, (performance.now() - changedAt) / 520);
          if (pulse <= 0) this.changedCells.delete(key);
          else {
            ctx.save();
            ctx.globalAlpha = pulse * 0.7;
            drawPolygon(ctx, insetQuad(quad, -pulse * 2), "#ffffff");
            ctx.restore();
          }
        }
      }
    }

    const action = flux.lastAction;
    if (action?.action === "burst") {
      const age = now - action.at;
      if (age >= 0 && age < 650) {
        const center = quadCenter(cellQuad(layout, action.x, action.y));
        const progress = age / 650;
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, 18 + progress * 72, 10 + progress * 38, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,226,92,${1 - progress})`;
        ctx.lineWidth = 6 - progress * 4;
        ctx.stroke();
      }
    }

    [...state.players]
      .sort((a, b) => (flux.players[a.id]?.y || 0) - (flux.players[b.id]?.y || 0))
      .forEach((player) => {
        const fluxPlayer = flux.players[player.id];
        if (!fluxPlayer) return;
        const center = quadCenter(cellQuad(layout, fluxPlayer.x, fluxPlayer.y));
        drawRunner(ctx, center.x, center.y - 4, player, player.id === controlledId, now, state.players.indexOf(player));
      });
  }

  drawScoreRail(ctx, players, minigame, flux, width, railY, controlledId) {
    const gap = 5;
    const x = 12;
    const y = railY;
    const chipWidth = (width - 24 - gap * 3) / 4;
    players.forEach((player, index) => {
      const chipX = x + index * (chipWidth + gap);
      ctx.fillStyle = player.id === controlledId ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.14)";
      roundRect(ctx, chipX, y, chipWidth, 35, 5);
      ctx.fill();
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(chipX + 11, y + 12, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = player.id === controlledId ? "#171821" : "#ffffff";
      ctx.font = "950 10px system-ui, sans-serif";
      ctx.fillText(player.name.slice(0, 5), chipX + 21, y + 15);
      ctx.font = "900 9px system-ui, sans-serif";
      ctx.fillText(`${flux.players[player.id]?.territory || 0} Felder`, chipX + 8, y + 29);
    });
  }

  updateBurstButton(flux, controlledId, now) {
    const button = this.controls.querySelector("[data-flux-action='burst']");
    const fluxPlayer = flux.players?.[controlledId];
    if (!button || !fluxPlayer) return;
    const remaining = Math.max(0, fluxPlayer.nextBurstAt - now);
    button.disabled = remaining > 0;
    button.classList.toggle("cooldown", remaining > 0);
    const label = button.querySelector("small");
    if (label) label.textContent = remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : "bereit";
  }
}

function createGridLayout(width, top, bottom, size) {
  const availableHeight = Math.max(150, bottom - top);
  const gridHeight = Math.min(availableHeight, width * 0.78);
  const bottomWidth = Math.min(width - 20, gridHeight * 1.28);
  return {
    size,
    centerX: width / 2,
    top: top + Math.max(0, (availableHeight - gridHeight) / 2),
    height: gridHeight,
    topWidth: bottomWidth * 0.72,
    bottomWidth
  };
}

function cellQuad(layout, x, y) {
  const y0 = layout.top + (layout.height * y) / layout.size;
  const y1 = layout.top + (layout.height * (y + 1)) / layout.size;
  const ratio0 = y / layout.size;
  const ratio1 = (y + 1) / layout.size;
  const width0 = layout.topWidth + (layout.bottomWidth - layout.topWidth) * ratio0;
  const width1 = layout.topWidth + (layout.bottomWidth - layout.topWidth) * ratio1;
  const left0 = layout.centerX - width0 / 2;
  const left1 = layout.centerX - width1 / 2;
  return [
    { x: left0 + (width0 * x) / layout.size, y: y0 },
    { x: left0 + (width0 * (x + 1)) / layout.size, y: y0 },
    { x: left1 + (width1 * (x + 1)) / layout.size, y: y1 },
    { x: left1 + (width1 * x) / layout.size, y: y1 }
  ];
}

function drawRunner(ctx, x, y, player, active, now, variant) {
  drawBlobAvatar(ctx, x, y, player, { radius: active ? 13 : 10, active, now, variant });
}

function drawBackdrop(ctx, width, height) {
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let x = -height; x < width + height; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + height, height);
    ctx.stroke();
  }
}

function drawPolygon(ctx, points, color) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function insetQuad(quad, amount) {
  const center = quadCenter(quad);
  return quad.map((point) => {
    const dx = center.x - point.x;
    const dy = center.y - point.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    return { x: point.x + (dx / distance) * amount, y: point.y + (dy / distance) * amount };
  });
}

function quadCenter(quad) {
  return quad.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
}

function midpoint(a, b, amount) {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount };
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

function cloneGrid(grid = []) {
  return grid.map((row) => [...row]);
}
