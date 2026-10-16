import * as THREE from "/vendor/three/three.module.js";

// Blockschrift: Buchstaben aus Würfeln, wie die Platzzahlen am Podest.
//
// Texte in der Spielwelt — Pop-Texte („+250“, „RAUS!“), Namensschilder,
// gemalte Schilder — waren gewöhnliche Schrift auf einer Fläche. Neben den
// Klötzchenfiguren wirkten sie flach und eingedrückt, wie Aufkleber. Hier
// steht jeder Buchstabe aus Würfeln einer 5×7-Pixelschrift: helle Stirnseite
// mit Glanzkante, eine dunkle Seite nach rechts unten als Tiefe und ein
// dunkler Rand, der sie auf jedem Grund lesbar macht.
//
// Zeichen ohne Würfelform (Emoji wie ⭐ oder 🍎) werden in normaler Schrift
// dazwischengesetzt, so gross wie ein Buchstabe.

const G = (rows) => rows.map((row) => row.replace(/\./g, " "));

const GLYPHS = {
  A: G([".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]),
  B: G(["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."]),
  C: G([".####", "#....", "#....", "#....", "#....", "#....", ".####"]),
  D: G(["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."]),
  E: G(["#####", "#....", "#....", "####.", "#....", "#....", "#####"]),
  F: G(["#####", "#....", "#....", "####.", "#....", "#....", "#...."]),
  G: G([".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."]),
  H: G(["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]),
  I: G(["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"]),
  J: G(["..###", "....#", "....#", "....#", "#...#", "#...#", ".###."]),
  K: G(["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"]),
  L: G(["#....", "#....", "#....", "#....", "#....", "#....", "#####"]),
  M: G(["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"]),
  N: G(["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"]),
  O: G([".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]),
  P: G(["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."]),
  Q: G([".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"]),
  R: G(["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"]),
  S: G([".####", "#....", "#....", ".###.", "....#", "....#", "####."]),
  T: G(["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."]),
  U: G(["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."]),
  V: G(["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."]),
  W: G(["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"]),
  X: G(["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"]),
  Y: G(["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."]),
  Z: G(["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"]),
  Ä: G([".#.#.", ".....", ".###.", "#...#", "#####", "#...#", "#...#"]),
  Ö: G([".#.#.", ".....", ".###.", "#...#", "#...#", "#...#", ".###."]),
  Ü: G([".#.#.", ".....", "#...#", "#...#", "#...#", "#...#", ".###."]),
  0: G([".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."]),
  1: G(["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."]),
  2: G([".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"]),
  3: G(["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."]),
  4: G(["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."]),
  5: G(["#####", "#....", "####.", "....#", "....#", "#...#", ".###."]),
  6: G(["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."]),
  7: G(["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."]),
  8: G([".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."]),
  9: G([".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."]),
  " ": G(["...", "...", "...", "...", "...", "...", "..."]),
  ".": G([".", ".", ".", ".", ".", ".", "#"]),
  ",": G(["..", "..", "..", "..", "..", ".#", "#."]),
  "!": G(["#", "#", "#", "#", "#", ".", "#"]),
  "?": G([".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."]),
  ":": G([".", ".", "#", ".", ".", "#", "."]),
  ";": G(["..", "..", ".#", "..", "..", ".#", "#."]),
  "-": G(["...", "...", "...", "###", "...", "...", "..."]),
  "−": G([".....", ".....", ".....", "#####", ".....", ".....", "....."]),
  "–": G(["....", "....", "....", "####", "....", "....", "...."]),
  "—": G([".....", ".....", ".....", "#####", ".....", ".....", "....."]),
  "+": G([".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."]),
  "=": G([".....", ".....", "#####", ".....", "#####", ".....", "....."]),
  "%": G(["##..#", "##..#", "...#.", "..#..", ".#...", "#..##", "#..##"]),
  "/": G(["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."]),
  "'": G(["#", "#", ".", ".", ".", ".", "."]),
  "\"": G(["#.#", "#.#", "...", "...", "...", "...", "..."]),
  "„": G(["...", "...", "...", "...", "...", "#.#", "#.#"]),
  "“": G(["#.#", "#.#", "...", "...", "...", "...", "..."]),
  "”": G(["#.#", "#.#", "...", "...", "...", "...", "..."]),
  "(": G(["..#", ".#.", "#..", "#..", "#..", ".#.", "..#"]),
  ")": G(["#..", ".#.", "..#", "..#", "..#", ".#.", "#.."]),
  "×": G([".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."]),
  "·": G([".", ".", ".", "#", ".", ".", "."]),
  "°": G([".#.", "#.#", ".#.", "...", "...", "...", "..."]),
  "#": G([".#.#.", "#####", ".#.#.", ".#.#.", "#####", ".#.#.", "....."]),
  "…": G([".....", ".....", ".....", ".....", ".....", ".....", "#.#.#"]),
  "→": G([".....", "...#.", "....#", "#####", "....#", "...#.", "....."]),
  "←": G([".....", ".#...", "#....", "#####", "#....", ".#...", "....."]),
  "✓": G([".....", "....#", "...#.", "#.#..", ".#...", ".....", "....."]),
  "✗": G([".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "....."]),
  "★": G(["..#..", "..#..", "#####", ".###.", ".#.#.", "#...#", "....."]),
  "<": G(["...#", "..#.", ".#..", "#...", ".#..", "..#.", "...#"]),
  ">": G(["#...", ".#..", "..#.", "...#", "..#.", ".#..", "#..."]),
  "_": G([".....", ".....", ".....", ".....", ".....", ".....", "#####"])
};

const ROWS = 7;
const GAP = 1;            // eine Würfelbreite zwischen zwei Zeichen

// Kleinbuchstaben gibt es nicht — die Blockschrift ist eine Plakatschrift.
function normalize(text) {
  return String(text ?? "").replace(/ß/g, "SS").toLocaleUpperCase("de");
}

// Zerlegt einen Text in Zeichen (auch Emoji aus mehreren Codepunkten).
function chars(text) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return [...new Intl.Segmenter("de", { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
  }
  return [...text];
}

function glyphOf(ch) {
  return GLYPHS[ch] || null;
}

// Breite eines Zeichens in Würfeln (Emoji: quadratisch, so hoch wie die Zeile).
function charCols(ch) {
  const glyph = glyphOf(ch);
  return glyph ? glyph[0].length : ROWS;
}

export function blockTextCols(text) {
  const list = chars(normalize(text));
  if (!list.length) return 0;
  return list.reduce((sum, ch) => sum + charCols(ch), 0) + GAP * (list.length - 1);
}

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

// Hellere bzw. dunklere Fassung einer Farbe (für Glanzkante und Tiefe).
function shade(color, amount) {
  const c = new THREE.Color();
  try { c.set(color); } catch (_error) { c.set("#ffffff"); }
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  const r = clampColor(c.r * 255 + (target - c.r * 255) * k);
  const g = clampColor(c.g * 255 + (target - c.g * 255) * k);
  const b = clampColor(c.b * 255 + (target - c.b * 255) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

// Zeichnet Blockschrift in einen 2D-Kontext. (x, y) ist die linke obere Ecke
// der Buchstabenzeilen; `cell` die Würfelgrösse in Pixeln.
export function drawBlockText(ctx, text, x, y, { cell = 10, color = "#ffffff", outline = "rgba(18, 38, 48, 0.9)", depth = 0.32, highlight = true, rim = 0.22 } = {}) {
  const list = chars(normalize(text));
  const face = typeof color === "string" ? color : "#ffffff";
  const side = shade(face, -0.5);
  const shine = shade(face, 0.45);
  const d = cell * depth;
  const o = cell * rim;
  const cells = [];
  const emoji = [];
  let col = 0;
  list.forEach((ch, i) => {
    const glyph = glyphOf(ch);
    if (glyph) {
      glyph.forEach((row, r) => {
        [...row].forEach((on, c) => { if (on === "#") cells.push([x + (col + c) * cell, y + r * cell]); });
      });
    } else {
      emoji.push([ch, x + col * cell, y]);
    }
    col += charCols(ch) + (i < list.length - 1 ? GAP : 0);
  });
  ctx.save();
  if (outline) {
    ctx.fillStyle = outline;
    cells.forEach(([cx, cy]) => ctx.fillRect(cx - o, cy - o, cell + 2 * o + d, cell + 2 * o + d));
  }
  ctx.fillStyle = side;
  cells.forEach(([cx, cy]) => ctx.fillRect(cx + d, cy + d, cell, cell));
  ctx.fillStyle = face;
  const inset = Math.max(0.5, cell * 0.04);
  cells.forEach(([cx, cy]) => ctx.fillRect(cx + inset, cy + inset, cell - inset * 2, cell - inset * 2));
  if (highlight && cell >= 3) {
    ctx.fillStyle = shine;
    cells.forEach(([cx, cy]) => ctx.fillRect(cx + inset, cy + inset, cell - inset * 2, Math.max(1, cell * 0.2)));
  }
  if (emoji.length) {
    ctx.font = `${Math.round(ROWS * cell * 0.92)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = face;
    emoji.forEach(([ch, ex, ey]) => ctx.fillText(ch, ex + (ROWS * cell) / 2, ey + (ROWS * cell) / 2 + cell * 0.3));
  }
  ctx.restore();
  return { width: blockTextCols(text) * cell + d, height: ROWS * cell + d };
}

// Ersatz für ctx.fillText: liest Schriftgrösse, Ausrichtung und Farbe aus dem
// Kontext. Die Buchstabenhöhe entspricht etwa der Versalhöhe der alten Schrift.
export function fillBlockText(ctx, text, x, y, maxWidth = Infinity, options = {}) {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font || "")?.[1]) || 24;
  let cell = (size * 0.74) / ROWS;
  const cols = blockTextCols(text);
  if (!cols) return;
  const depth = options.depth ?? 0.32;
  if (Number.isFinite(maxWidth) && cols * cell > maxWidth) cell = maxWidth / (cols + depth);
  const width = cols * cell;
  const height = ROWS * cell;
  const align = ctx.textAlign;
  const left = align === "center" ? x - width / 2 : align === "right" || align === "end" ? x - width : x;
  const base = ctx.textBaseline;
  const top = base === "middle" ? y - height / 2 : base === "top" || base === "hanging" ? y : base === "bottom" ? y - height : y - height;
  drawBlockText(ctx, text, left, top, { cell, color: options.color ?? ctx.fillStyle, outline: options.outline ?? "rgba(18, 38, 48, 0.85)", depth });
}

// Eine Leinwand, genau so gross wie der Blocktext (für Sprites).
export function blockTextCanvas(text, { cell = 12, color = "#ffffff", outline = "rgba(18, 38, 48, 0.9)", pad = null, depth = 0.32, rim = 0.22 } = {}) {
  const margin = pad ?? Math.ceil(cell * Math.max(0.6, rim + 0.2));
  const cols = Math.max(1, blockTextCols(text));
  const deep = cell * depth;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(cols * cell + deep + margin * 2);
  canvas.height = Math.ceil(ROWS * cell + deep + margin * 2);
  const ctx = canvas.getContext("2d");
  drawBlockText(ctx, text, margin, margin, { cell, color, outline, depth, rim });
  return { canvas, glyphHeight: ROWS * cell, margin };
}

// Blockschrift als echte Würfel in der Szene (wie die Platzzahlen am
// Podest): eine Gruppe, eine Einheit hoch, mittig. Zwei Instanzgitter —
// Würfel und dunkle Rückplatten — je ein Zeichenaufruf.
const cube = new THREE.BoxGeometry(1, 1, 1);
cube.userData.block = true;
export function blockText3D(text, { color = "#ffffff", back = "#2c3440", emissive = "#3a3a3a" } = {}) {
  const group = new THREE.Group();
  const list = chars(normalize(text));
  const cell = 1 / ROWS;
  const cols = blockTextCols(text);
  const spots = [];
  let col = 0;
  list.forEach((ch, i) => {
    const glyph = glyphOf(ch);
    if (glyph) {
      glyph.forEach((row, r) => {
        [...row].forEach((on, c) => {
          if (on !== "#") return;
          spots.push([(col + c - (cols - 1) / 2) * cell, (ROWS / 2 - 0.5 - r) * cell]);
        });
      });
    }
    col += charCols(ch) + (i < list.length - 1 ? GAP : 0);
  });
  if (!spots.length) return group;
  const face = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial({ color, emissive }), spots.length);
  const edge = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial({ color: back }), spots.length);
  const o = new THREE.Object3D();
  spots.forEach(([x, y], i) => {
    o.position.set(x, y, 0.05);
    o.scale.set(cell * 0.96, cell * 0.96, cell * 0.7);
    o.updateMatrix();
    face.setMatrixAt(i, o.matrix);
    o.position.set(x, y - cell * 0.08, 0.0);
    o.scale.set(cell * 1.3, cell * 1.3, cell * 0.25);
    o.updateMatrix();
    edge.setMatrixAt(i, o.matrix);
  });
  face.castShadow = true;
  group.add(edge, face);
  group.userData.blockWidth = cols * cell;
  return group;
}
