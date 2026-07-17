export function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, Math.floor(rect.width * ratio));
  const height = Math.max(260, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return {
    ctx,
    width: width / ratio,
    height: height / ratio
  };
}

export function gameViewport(height, controls, state, top = 84) {
  const controlsHeight = controls?.getBoundingClientRect().height || 0;
  const safeTop = state?.devMode ? Math.max(top, 142) : top;
  const safeBottom = Math.max(safeTop + 140, height - controlsHeight - 20);
  return {
    top: safeTop,
    bottom: safeBottom,
    height: Math.max(140, safeBottom - safeTop)
  };
}

export function clearCanvas(ctx, width, height, fill = "#fff8e8") {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
}

export function fillGradient(ctx, width, height, top, bottom) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export function drawPill(ctx, x, y, width, height, color) {
  const radius = height / 2;
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
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawProgress(ctx, minigame, now, x, y, width, height, color = "#30d158") {
  const elapsed = Math.max(0, now - minigame.startedAt);
  const progress = 1 - Math.max(0, Math.min(1, elapsed / minigame.duration));
  drawPill(ctx, x, y, width, height, "rgba(40, 38, 49, 0.1)");
  if (progress > 0) drawPill(ctx, x, y, width * progress, height, progress < 0.2 ? "#ff4668" : color);
}

export function drawCountdownOverlay(ctx, minigame, now, width, height) {
  const untilStart = minigame.startedAt - now;
  const goTime = now - minigame.startedAt;
  if (untilStart <= 0 && goTime > 420) return;
  const value = untilStart > 0 ? Math.ceil(untilStart / 1000) : "GO!";
  const pulse = untilStart > 0 ? 1 + (1 - (untilStart % 1000) / 1000) * 0.12 : 1 + (1 - goTime / 420) * 0.18;
  ctx.save();
  ctx.fillStyle = "rgba(15, 16, 22, 0.76)";
  ctx.fillRect(0, 0, width, height);

  ctx.translate(width / 2, height / 2);
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  ctx.arc(0, 0, Math.min(width, height) * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = value === "GO!" ? "#43e38c" : "#ffe25c";
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `950 ${value === "GO!" ? 56 : 76}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value), 0, 1);
  if (value !== "GO!") {
    ctx.font = "950 15px system-ui, sans-serif";
    ctx.fillText("BEREIT", 0, Math.min(width, height) * 0.25);
  }
  ctx.restore();
}

export function drawSpark(ctx, x, y, radius, color, now, index = 0) {
  const pulse = 0.55 + Math.sin(now / 130 + index) * 0.25;
  ctx.beginPath();
  ctx.arc(x, y, radius * pulse, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function remainingSeconds(minigame, now) {
  const end = minigame.startedAt + minigame.duration;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

export function countdownText(minigame, now) {
  const untilStart = minigame.startedAt - now;
  if (untilStart > 0) return `Start in ${Math.ceil(untilStart / 1000)}`;
  return `${remainingSeconds(minigame, now)}s`;
}
