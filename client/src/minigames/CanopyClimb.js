import { countdownText, drawCountdownOverlay, drawProgress, fillGradient, gameViewport, setupCanvas } from "./canvasTools.js?v=tumblekin36";
import { drawBlobAvatar } from "../game/BlobAvatar.js?v=tumblekin36";

export class CanopyClimb {
  constructor({ canvas, controls, sendInput, now, getState, getControlledPlayerId, feedback }) {
    this.canvas = canvas;
    this.controls = controls;
    this.sendInput = sendInput;
    this.now = now;
    this.getState = getState;
    this.getControlledPlayerId = getControlledPlayerId;
    this.feedback = feedback;
    this.minigame = null;
    this.update = null;
    this.frame = null;
    this.lastMotionId = null;
    this.controlSignature = "";
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    this.controls.innerHTML = `
      <div class="canopy-choice-controls">
        <button type="button" data-canopy-action="left" aria-label="Linke Plattform">←</button>
        <button type="button" data-canopy-action="right" aria-label="Rechte Plattform">→</button>
      </div>
    `;
    this.controls.querySelectorAll("[data-canopy-action]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.classList.add("pressed");
        window.setTimeout(() => button.classList.remove("pressed"), 130);
        this.feedback?.sound("move");
        this.feedback?.vibrate(10);
        this.sendInput({ action: button.dataset.canopyAction }).catch(() => {});
      });
    });
    this.loop();
  }

  handleUpdate(update) {
    const controlled = update.canopy?.players?.[this.getControlledPlayerId()];
    const motion = controlled?.motion;
    if (motion?.id && motion.id !== this.lastMotionId) {
      this.lastMotionId = motion.id;
      if (motion.type === "fall") {
        this.feedback?.sound("fall");
        this.feedback?.vibrate([35, 28, 55]);
      } else {
        this.feedback?.sound("coin");
        this.feedback?.vibrate([8, 12, 18]);
      }
    }
    this.update = update;
    this.renderControlState();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  renderControlState() {
    const minigame = this.update || this.minigame;
    const player = minigame?.canopy?.players?.[this.getControlledPlayerId()];
    const locked = !player || this.now() < minigame.startedAt || Boolean(player.finishedAt);
    const signature = `${this.getControlledPlayerId()}:${locked}`;
    if (signature === this.controlSignature) return;
    this.controlSignature = signature;
    this.controls.querySelectorAll("[data-canopy-action]").forEach((button) => {
      button.disabled = locked;
    });
  }

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    const canopy = minigame?.canopy;
    if (!minigame || !state || !canopy) return;
    this.renderControlState();

    const { ctx, width, height } = setupCanvas(this.canvas);
    const now = this.now();
    const viewport = gameViewport(height, this.controls, state, 84);
    const controlledId = this.getControlledPlayerId();
    const controlled = canopy.players[controlledId];
    const controlledHeight = visualHeight(controlled, now);
    const cameraLevel = Math.max(0, controlledHeight - 2.15);
    const spacing = Math.min(76, Math.max(54, viewport.height / 6.4));
    const groundY = viewport.bottom - 24;

    fillGradient(ctx, width, height, "#7fc4ee", "#a8e8c4");
    drawSky(ctx, width, height, now, cameraLevel);

    ctx.fillStyle = "#ffffff";
    ctx.font = "950 24px system-ui, sans-serif";
    ctx.fillText(countdownText(minigame, now), 16, viewport.top + 27);
    drawProgress(ctx, minigame, now, 16, viewport.top + 39, width - 32, 9, "#d7ff74");

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "900 13px system-ui, sans-serif";
    ctx.fillText(
      controlled?.finishedAt ? `ZIEL ${formatRaceTime(controlled.finishMs)}` : `${Math.round(controlledHeight)} / ${canopy.goal}`,
      width - 16,
      viewport.top + 27
    );
    ctx.textAlign = "left";

    drawVine(ctx, width, viewport.top + 54, viewport.bottom, cameraLevel, spacing, now);

    const firstLevel = Math.max(0, Math.floor(cameraLevel) - 1);
    const lastLevel = Math.min(canopy.goal, Math.ceil(cameraLevel + viewport.height / spacing + 2));
    for (let level = firstLevel; level <= lastLevel; level += 1) {
      const leaf = canopy.leaves[level];
      const y = groundY - (level - cameraLevel) * spacing;
      const x = leafX(leaf, width, level);
      const isNext = level === Math.min(canopy.goal, (controlled?.level || 0) + 1);
      drawLeaf(ctx, x, y, leaf?.side || "center", isNext, now, level);
      if (level === canopy.goal) drawCrown(ctx, x, y - 27, now);
    }

    state.players.forEach((player, index) => {
      const climber = canopy.players[player.id];
      if (!climber) return;
      drawClimber(ctx, player, climber, canopy, width, groundY, cameraLevel, spacing, now, index, player.id === controlledId);
    });

    const mistake = canopy.lastMistake;
    if (mistake?.playerId === controlledId && now - mistake.at < 420) {
      const alpha = 1 - (now - mistake.at) / 420;
      ctx.fillStyle = `rgba(255,70,104,${Math.max(0, alpha) * 0.24})`;
      ctx.fillRect(0, 0, width, height);
    }
    drawCountdownOverlay(ctx, minigame, now, width, height);
  }
}

function visualHeight(player, now) {
  if (!player) return 0;
  const motion = player.motion;
  if (!motion) return player.level || 0;
  const t = clamp01((now - motion.startedAt) / Math.max(1, motion.duration));
  const eased = motion.type === "jump" ? easeInOut(t) : t * t;
  return lerp(motion.from, motion.to, eased);
}

function drawClimber(ctx, player, climber, canopy, width, groundY, cameraLevel, spacing, now, index, active) {
  const motion = climber.motion;
  const height = visualHeight(climber, now);
  let leaf = canopy.leaves[Math.max(0, Math.round(height))] || canopy.leaves[0];
  let x = leafX(leaf, width, Math.round(height));
  let y = groundY - (height - cameraLevel) * spacing - 18;

  if (motion) {
    const t = clamp01((now - motion.startedAt) / Math.max(1, motion.duration));
    const fromLeaf = canopy.leaves[motion.from] || canopy.leaves[0];
    const toLeaf = canopy.leaves[motion.to] || canopy.leaves[0];
    x = lerp(leafX(fromLeaf, width, motion.from), leafX(toLeaf, width, motion.to), easeInOut(t));
    if (motion.type === "jump") y -= Math.sin(t * Math.PI) * spacing * 0.7;
    else y += Math.sin(t * Math.PI) * spacing * 0.55;
  }

  x += (index - 1.5) * 7;
  const radius = active ? 16 : 12;
  const squash = motion ? Math.sin(clamp01((now - motion.startedAt) / motion.duration) * Math.PI) * 0.1 : 0;
  drawBlobAvatar(ctx, x, y, player, { radius, active, now, variant: index, squash, bob: !motion });
  if (active) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 11px system-ui, sans-serif";
    ctx.fillText(player.name.slice(0, 8), x, y - radius - 9);
    ctx.textAlign = "left";
  }
}

function drawLeaf(ctx, x, y, side, active, now, level) {
  const width = side === "center" ? 96 : 78;
  const tilt = side === "left" ? -0.16 : side === "right" ? 0.16 : 0;
  const pulse = active ? 1 + Math.sin(now / 110) * 0.06 : 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(pulse, pulse);
  if (active) {
    ctx.shadowColor = "#d7ff74";
    ctx.shadowBlur = 22;
  }
  ctx.beginPath();
  ctx.moveTo(-width / 2, 0);
  ctx.quadraticCurveTo(-width * 0.2, -24, width / 2, -3);
  ctx.quadraticCurveTo(width * 0.18, 25, -width / 2, 0);
  ctx.fillStyle = active ? "#d7ff74" : (level % 3 === 0 ? "#68d39a" : "#4fb87b");
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.moveTo(-width * 0.38, 0);
  ctx.lineTo(width * 0.34, -2);
  ctx.strokeStyle = "rgba(20,77,57,0.58)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawVine(ctx, width, top, bottom, cameraLevel, spacing, now) {
  ctx.beginPath();
  for (let y = bottom + spacing; y >= top - spacing; y -= 18) {
    const world = cameraLevel + (bottom - y) / spacing;
    const x = width / 2 + Math.sin(world * 0.9 + now / 1900) * width * 0.045;
    if (y === bottom + spacing) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#255c42";
  ctx.lineWidth = 20;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.strokeStyle = "#79d48e";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawSky(ctx, width, height, now, cameraLevel) {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#d7ffef";
  for (let index = 0; index < 10; index += 1) {
    const x = ((index * 97 + now / 95) % (width + 140)) - 70;
    const y = 100 + ((index * 83 + cameraLevel * 19) % Math.max(180, height - 180));
    ctx.beginPath();
    ctx.ellipse(x, y, 54 + (index % 3) * 14, 12, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCrown(ctx, x, y, now) {
  ctx.save();
  ctx.translate(x, y + Math.sin(now / 180) * 3);
  ctx.fillStyle = "#ffd95f";
  ctx.beginPath();
  ctx.moveTo(-25, 12);
  ctx.lineTo(-20, -14);
  ctx.lineTo(-5, -2);
  ctx.lineTo(0, -21);
  ctx.lineTo(8, -2);
  ctx.lineTo(24, -15);
  ctx.lineTo(23, 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function leafX(leaf, width, level) {
  if (!leaf || leaf.side === "center") return width / 2;
  const side = leaf.side === "left" ? -1 : 1;
  return width / 2 + side * width * (0.24 + (leaf.bend || 0) * 0.18) + Math.sin(level * 1.7) * 8;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function formatRaceTime(value) {
  return `${(Math.max(0, Number(value) || 0) / 1000).toFixed(2).replace(".", ",")}s`;
}
