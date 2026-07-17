import { countdownText, drawCountdownOverlay, drawProgress, fillGradient, gameViewport, setupCanvas } from "./canvasTools.js?v=tumblekin36";
import { drawBlobAvatar } from "../game/BlobAvatar.js?v=tumblekin36";

export class DodgeBlocks {
  constructor({ canvas, controls, sendInput, now, getState, getControlledPlayerId, myPlayerId, feedback }) {
    this.canvas = canvas;
    this.controls = controls;
    this.sendInput = sendInput;
    this.now = now;
    this.getState = getState;
    this.getControlledPlayerId = getControlledPlayerId || (() => myPlayerId);
    this.myPlayerId = myPlayerId;
    this.feedback = feedback;
    this.minigame = null;
    this.update = null;
    this.frame = null;
    this.lastHitCount = 0;
    this.hitFlash = 0;
    this.swipeStart = null;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.controls.innerHTML = `
      <div class="swipe-controls">
        <button class="arrow-button" data-move="left" type="button" aria-label="Links">←</button>
        <div class="swipe-pad" aria-hidden="true"><span>↔</span></div>
        <button class="arrow-button" data-move="right" type="button" aria-label="Rechts">→</button>
      </div>
    `;
    this.controls.querySelectorAll("[data-move]").forEach((button) => {
      button.addEventListener("pointerdown", () => {
        this.feedback?.sound("tap");
        this.feedback?.vibrate(12);
        this.sendInput({ action: button.dataset.move }).catch(() => {});
      });
    });
    this.onSwipeStart = (event) => {
      this.swipeStart = { x: event.clientX, y: event.clientY, at: performance.now(), pointerId: event.pointerId };
      this.canvas.setPointerCapture?.(event.pointerId);
    };
    this.onSwipeMove = (event) => {
      if (!this.swipeStart || event.pointerId !== this.swipeStart.pointerId) return;
      const deltaX = event.clientX - this.swipeStart.x;
      if (Math.abs(deltaX) < 34) return;
      this.sendMove(deltaX < 0 ? "left" : "right");
      this.swipeStart.x = event.clientX;
      this.swipeStart.at = performance.now();
    };
    this.onSwipeEnd = (event) => {
      if (!this.swipeStart || event.pointerId !== this.swipeStart.pointerId) return;
      const deltaX = event.clientX - this.swipeStart.x;
      if (Math.abs(deltaX) > 22) this.sendMove(deltaX < 0 ? "left" : "right");
      this.swipeStart = null;
    };
    this.canvas.addEventListener("pointerdown", this.onSwipeStart);
    this.canvas.addEventListener("pointermove", this.onSwipeMove);
    this.canvas.addEventListener("pointerup", this.onSwipeEnd);
    this.canvas.addEventListener("pointercancel", this.onSwipeEnd);
    this.loop();
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("pointerdown", this.onSwipeStart);
    this.canvas.removeEventListener("pointermove", this.onSwipeMove);
    this.canvas.removeEventListener("pointerup", this.onSwipeEnd);
    this.canvas.removeEventListener("pointercancel", this.onSwipeEnd);
    this.controls.innerHTML = "";
  }

  sendMove(action) {
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action }).catch(() => {});
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    if (!minigame || !state) return;

    const { ctx, width, height } = setupCanvas(this.canvas);
    const now = this.now();
    const viewport = gameViewport(height, this.controls, state, 84);
    const elapsed = now - minigame.startedAt;
    const controlledId = this.getControlledPlayerId();
    const controlledHits = minigame.hits[controlledId] || 0;
    if (controlledHits > this.lastHitCount) {
      this.hitFlash = 1;
      this.feedback?.sound("error");
      this.feedback?.vibrate([25, 25, 25]);
    }
    this.lastHitCount = controlledHits;
    fillGradient(ctx, width, height, "#dff6ff", "#f4fbff");

    ctx.fillStyle = "#282631";
    ctx.font = "950 27px system-ui, sans-serif";
    ctx.fillText(countdownText(minigame, now), 18, viewport.top + 28);
    drawProgress(ctx, minigame, now, 18, viewport.top + 41, width - 36, 12, "#1eb8ff");

    const laneWidth = width / 5;
    const roadTop = viewport.top + 58;
    const roadBottom = viewport.bottom - 30;
    const topWidth = width * 0.52;
    const bottomWidth = width - 26;
    const topX = (width - topWidth) / 2;
    const bottomX = (width - bottomWidth) / 2;
    ctx.fillStyle = "rgba(40,38,49,0.08)";
    roundedBlock(ctx, 13, roadTop - 8, width - 26, roadBottom - roadTop + 20, 14);
    ctx.fill();
    for (let lane = 0; lane < 5; lane += 1) {
      const topLeft = topX + (topWidth * lane) / 5;
      const topRight = topX + (topWidth * (lane + 1)) / 5;
      const bottomLeft = bottomX + (bottomWidth * lane) / 5;
      const bottomRight = bottomX + (bottomWidth * (lane + 1)) / 5;
      ctx.beginPath();
      ctx.moveTo(topLeft, roadTop);
      ctx.lineTo(topRight, roadTop);
      ctx.lineTo(bottomRight, roadBottom);
      ctx.lineTo(bottomLeft, roadBottom);
      ctx.closePath();
      ctx.fillStyle = lane % 2 === 0 ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.38)";
      ctx.fill();
      ctx.strokeStyle = "rgba(40,38,49,0.1)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    minigame.blocks.forEach((block) => {
      const fallProgress = (elapsed - block.spawnAt) / Math.max(1, block.impactAt - block.spawnAt);
      if (fallProgress < -0.15 || fallProgress > 1.18) return;
      const t = Math.max(0, Math.min(1, fallProgress));
      const lane = laneAt(block.lane, t, width);
      const blockWidth = Math.max(28, (lane.right - lane.left) * (0.62 + t * 0.12));
      const blockHeight = 24 + t * 28;
      const x = (lane.left + lane.right - blockWidth) / 2;
      const y = roadTop + fallProgress * (roadBottom - roadTop - 20);
      if (fallProgress < 0.1) {
        ctx.fillStyle = "rgba(255, 107, 74, 0.18)";
        const warning = laneAt(block.lane, 0.76, width);
        roundedBlock(ctx, warning.left + 5, roadBottom - 58, warning.right - warning.left - 10, 52, 8);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(40,38,49,0.16)";
      ctx.fillRect(x + 5, y + 9, blockWidth, blockHeight);
      ctx.fillStyle = "#ff6b4a";
      roundedBlock(ctx, x, y, blockWidth, blockHeight, 7);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(x + 5, y + 6, blockWidth - 10, 6);
    });

    const baseY = roadBottom - 4;
    state.players.forEach((player, index) => {
      const lane = minigame.lanes[player.id] ?? 2;
      const bottomLane = laneAt(lane, 1, width);
      const x = (bottomLane.left + bottomLane.right) / 2 + (index - 1.5) * 8;
      const active = player.id === controlledId;
      const radius = active ? 18 : 12;
      drawBlobAvatar(ctx, x, baseY, player, { radius, active, now, variant: index });
    });

    ctx.fillStyle = "#282631";
    ctx.font = "900 13px system-ui, sans-serif";
    const hits = state.players
      .map((player) => `${player.name}: ${minigame.hits[player.id] || 0}`)
      .join("   ");
    ctx.fillText(hits, 18, viewport.bottom - 8);
    if (this.hitFlash > 0.02) {
      ctx.fillStyle = `rgba(255, 107, 74, ${this.hitFlash * 0.28})`;
      ctx.fillRect(0, 0, width, height);
      this.hitFlash *= 0.82;
    }
    drawCountdownOverlay(ctx, minigame, now, width, height);
  }
}

function laneAt(lane, t, width) {
  const topWidth = width * 0.52;
  const bottomWidth = width - 26;
  const topX = (width - topWidth) / 2;
  const bottomX = (width - bottomWidth) / 2;
  const roadWidth = topWidth + (bottomWidth - topWidth) * t;
  const roadX = topX + (bottomX - topX) * t;
  return {
    left: roadX + (roadWidth * lane) / 5,
    right: roadX + (roadWidth * (lane + 1)) / 5
  };
}

function roundedBlock(ctx, x, y, width, height, radius) {
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
