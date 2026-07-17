export function drawBlobAvatar(ctx, x, y, player, options = {}) {
  const radius = options.radius || 14;
  const active = Boolean(options.active);
  const now = options.now || 0;
  const variant = Number.isInteger(options.variant) ? options.variant % 4 : avatarVariant(player);
  const motion = options.motion || 0;
  const bob = options.bob === false ? 0 : Math.sin(now / 210 + variant * 1.7) * Math.min(2.4, radius * 0.12);
  const squash = Math.min(0.2, Math.max(-0.12, options.squash || 0));
  const bodyY = y + bob;

  ctx.save();
  ctx.globalAlpha = options.alpha ?? 1;

  ctx.fillStyle = "rgba(8,14,18,0.25)";
  roundedRect(ctx, x - radius * 0.85, y + radius * 0.78, radius * 1.7, radius * 0.42, radius * 0.2);
  ctx.fill();

  const footSwing = Math.sin(now / 95 + motion * Math.PI * 2) * radius * 0.1;
  ctx.fillStyle = "#172126";
  [-1, 1].forEach((side) => {
    roundedRect(
      ctx,
      x + side * radius * 0.38 - radius * 0.26,
      bodyY + radius * 0.6 + side * footSwing,
      radius * 0.52,
      radius * 0.34,
      radius * 0.1
    );
    ctx.fill();
  });

  ctx.save();
  ctx.translate(x, bodyY);
  ctx.scale(1 + squash, 1 - squash);
  ctx.fillStyle = player?.color || "#51b7e8";
  roundedRect(ctx, -radius * 0.92, -radius * 0.96, radius * 1.84, radius * 1.84, radius * 0.3);
  ctx.fill();
  ctx.lineWidth = active ? Math.max(3, radius * 0.22) : Math.max(1.5, radius * 0.11);
  ctx.strokeStyle = active ? "#ffffff" : "rgba(255,255,255,0.58)";
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.4)";
  roundedRect(ctx, -radius * 0.68, -radius * 0.72, radius * 0.5, radius * 0.34, radius * 0.12);
  ctx.fill();

  const blink = Math.sin(now / 830 + variant * 1.9) > 0.985 ? 0.18 : 1;
  ctx.fillStyle = "#172126";
  [-1, 1].forEach((side) => {
    ctx.save();
    ctx.translate(side * radius * 0.32, -radius * 0.08);
    ctx.scale(1, blink);
    roundedRect(ctx, -radius * 0.1, -radius * 0.16, radius * 0.2, radius * 0.32, radius * 0.06);
    ctx.fill();
    ctx.restore();
  });

  ctx.strokeStyle = "#172126";
  ctx.lineWidth = Math.max(1.4, radius * 0.09);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-radius * 0.2, radius * 0.32);
  ctx.lineTo(radius * 0.2, radius * 0.32);
  ctx.stroke();
  ctx.restore();

  drawTopper(ctx, x, bodyY - radius * 1.05, radius, variant);
  ctx.restore();
}

function drawTopper(ctx, x, y, radius, variant) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#ffe36b";
  if (variant === 0) {
    ctx.rotate(0.6);
    roundedRect(ctx, -radius * 0.14, -radius * 0.14, radius * 0.28, radius * 0.28, radius * 0.05);
    ctx.fill();
  } else if (variant === 1) {
    roundedRect(ctx, -radius * 0.32, -radius * 0.16, radius * 0.64, radius * 0.14, radius * 0.05);
    ctx.fill();
  } else if (variant === 2) {
    [-1, 1].forEach((side) => {
      roundedRect(ctx, side * radius * 0.2 - radius * 0.11, -radius * 0.24, radius * 0.22, radius * 0.22, radius * 0.05);
      ctx.fill();
    });
  } else {
    [-1, 0, 1].forEach((position, index) => {
      const height = index === 1 ? radius * 0.36 : radius * 0.24;
      roundedRect(ctx, position * radius * 0.24 - radius * 0.08, -height, radius * 0.16, height, radius * 0.04);
      ctx.fill();
    });
  }
  ctx.restore();
}

function roundedRect(ctx, x, y, width, height, radius) {
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

function avatarVariant(player) {
  const source = String(player?.id || player?.name || "blob");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  return hash % 4;
}
