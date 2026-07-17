export function drawDiceFace(value = 1, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const radius = size * 0.13;
  const dot = size * 0.075;
  const positions = {
    tl: [size * 0.28, size * 0.28],
    tm: [size * 0.5, size * 0.28],
    tr: [size * 0.72, size * 0.28],
    ml: [size * 0.28, size * 0.5],
    mm: [size * 0.5, size * 0.5],
    mr: [size * 0.72, size * 0.5],
    bl: [size * 0.28, size * 0.72],
    bm: [size * 0.5, size * 0.72],
    br: [size * 0.72, size * 0.72]
  };
  const dots = {
    1: ["mm"],
    2: ["tl", "br"],
    3: ["tl", "mm", "br"],
    4: ["tl", "tr", "bl", "br"],
    5: ["tl", "tr", "mm", "bl", "br"],
    6: ["tl", "tr", "ml", "mr", "bl", "br"],
    7: ["tl", "tr", "ml", "mm", "mr", "bl", "br"],
    8: ["tl", "tm", "tr", "ml", "mr", "bl", "bm", "br"],
    9: ["tl", "tm", "tr", "ml", "mm", "mr", "bl", "bm", "br"]
  };

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 0, 0, size, size, radius);
  ctx.fill();
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = value > 6 ? "#ff4668" : "rgba(23, 24, 33, 0.2)";
  ctx.stroke();

  ctx.fillStyle = value > 6 ? "#ff4668" : "#171821";
  (dots[value] || dots[1]).forEach((key) => {
    const [x, y] = positions[key];
    ctx.beginPath();
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    ctx.fill();
  });

  return canvas;
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
