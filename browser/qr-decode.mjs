// QR-Codes lesen, ohne Bibliothek — für den Scanner (qr-scan.js). Wo das
// Gerät einen eigenen Leser hat (BarcodeDetector), nimmt der Scanner den;
// in der Android-WebView gibt es den nicht verlässlich.
//
// Das Verfahren ist das bewährte von ZXing, auf das Nötige gekürzt:
//   1. Graustufen, Schwelle je 8×8-Feld aus der Umgebung (wie der
//      HybridBinarizer) — robust gegen Schatten und Bildschirmglanz.
//   2. Suchmuster finden: Zeilen nach 1:1:3:1:1 absuchen, senkrecht und
//      waagrecht gegenprüfen, Treffer zusammenlegen.
//   3. Drei Muster, die ein rechtwinkliges Dreieck bilden; daraus Grösse und
//      Version. Ab Version 2 das Ausrichtungsmuster unten rechts suchen.
//   4. Perspektive aus vier Punkten, jedes Modul in der Mitte abtasten.
//   5. Formatinfo, Maske, Codewörter, Reed-Solomon-Korrektur, Segmente.
// Tabellen (Blöcke, Fehlerkorrektur, Lage der Ausrichtungsmuster) kommen aus
// der QR-Bibliothek, die die Codes auch erzeugt.
import ECCode from "qrcode/lib/core/error-correction-code.js";
import ECLevel from "qrcode/lib/core/error-correction-level.js";
import FormatInfo from "qrcode/lib/core/format-info.js";
import Alignment from "qrcode/lib/core/alignment-pattern.js";
import Utils from "qrcode/lib/core/utils.js";

// ------------------------------------------------------------ GF(256) ------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);
const pow = (a, n) => (n === 0 ? 1 : a ? EXP[(LOG[a] * n) % 255] : 0);

// p[i] ist der Faktor vor x^i.
function evalLow(p, x) {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i -= 1) y = mul(y, x) ^ p[i];
  return y;
}

function syndromes(r, ec) {
  const s = new Array(ec);
  let any = false;
  for (let j = 0; j < ec; j += 1) {
    let y = 0;
    const a = EXP[j];
    for (let k = 0; k < r.length; k += 1) y = mul(y, a) ^ r[k];
    s[j] = y;
    if (y) any = true;
  }
  return any ? s : null;
}

// Reed-Solomon wie im QR-Standard (Nullstellen α^0 … α^(ec-1)), r mit dem
// höchsten Grad zuerst. Berlekamp-Massey, Chien-Suche, Forney. Korrigiert an
// Ort und Stelle; false, wenn es zu viele Fehler sind.
export function rsCorrect(r, ec) {
  const s = syndromes(r, ec);
  if (!s) return true;
  let c = [1];
  let b = [1];
  let l = 0;
  let m = 1;
  let bd = 1;
  for (let k = 0; k < ec; k += 1) {
    let d = s[k];
    for (let i = 1; i <= l; i += 1) d ^= mul(c[i] || 0, s[k - i]);
    if (d === 0) { m += 1; continue; }
    const coef = div(d, bd);
    const before = c.slice();
    while (c.length < b.length + m) c.push(0);
    for (let i = 0; i < b.length; i += 1) c[i + m] ^= mul(coef, b[i]);
    if (2 * l <= k) {
      l = k + 1 - l;
      b = before;
      bd = d;
      m = 1;
    } else {
      m += 1;
    }
  }
  c = c.slice(0, l + 1);
  if (2 * l > ec) return false;
  const n = r.length;
  const found = [];
  for (let e = 0; e < n; e += 1) if (evalLow(c, EXP[(255 - (e % 255)) % 255]) === 0) found.push(e);
  if (found.length !== l) return false;
  const omega = new Array(ec).fill(0);
  for (let i = 0; i < ec; i += 1) {
    for (let j = 0; j <= Math.min(i, l); j += 1) omega[i] ^= mul(s[i - j], c[j]);
  }
  for (const e of found) {
    const xInv = EXP[(255 - (e % 255)) % 255];
    let derivative = 0;
    for (let i = 1; i < c.length; i += 2) derivative ^= mul(c[i], pow(xInv, i - 1));
    if (!derivative) return false;
    r[n - 1 - e] ^= mul(EXP[e % 255], div(evalLow(omega, xInv), derivative));
  }
  return !syndromes(r, ec);
}

// --------------------------------------------------------- Binarisieren ----

function binarize(gray, w, h) {
  const out = new Uint8Array(w * h);
  const B = 8;
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const black = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      let sum = 0;
      let count = 0;
      let min = 255;
      let max = 0;
      for (let y = by * B; y < Math.min(h, by * B + B); y += 1) {
        for (let x = bx * B; x < Math.min(w, bx * B + B); x += 1) {
          const v = gray[y * w + x];
          sum += v;
          count += 1;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      let average = sum / count;
      // Ein Feld ohne Kontrast liegt ganz im Hellen oder ganz im Dunkeln:
      // dann zählt, was die Nachbarn sagen.
      if (max - min <= 24) {
        average = min / 2;
        if (by > 0 && bx > 0) {
          const near = (black[(by - 1) * bw + bx] + 2 * black[by * bw + bx - 1] + black[(by - 1) * bw + bx - 1]) / 4;
          if (min < near) average = near;
        }
      }
      black[by * bw + bx] = average;
    }
  }
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const yy = by + dy;
          const xx = bx + dx;
          if (yy < 0 || xx < 0 || yy >= bh || xx >= bw) continue;
          sum += black[yy * bw + xx];
          n += 1;
        }
      }
      const threshold = sum / n;
      for (let y = by * B; y < Math.min(h, by * B + B); y += 1) {
        for (let x = bx * B; x < Math.min(w, bx * B + B); x += 1) {
          out[y * w + x] = gray[y * w + x] <= threshold ? 1 : 0;
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------- Suchmuster --------

function patternCross(sc) {
  const total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
  if (total < 7) return false;
  const module = total / 7;
  const variance = module / 2;
  return Math.abs(module - sc[0]) < variance && Math.abs(module - sc[1]) < variance
    && Math.abs(3 * module - sc[2]) < 3 * variance
    && Math.abs(module - sc[3]) < variance && Math.abs(module - sc[4]) < variance;
}

const centerFromEnd = (sc, end) => end - sc[4] - sc[3] - sc[2] / 2;

function findFinders(bits, w, h) {
  const centers = [];
  const dark = (x, y) => bits[y * w + x] === 1;
  // Senkrecht (vertical = true) oder waagrecht durch einen Kandidaten.
  const cross = (cx, cy, maxCount, total, vertical) => {
    const limit = vertical ? h : w;
    const at = (t) => (vertical ? dark(cx, t) : dark(t, cy));
    const start = vertical ? cy : cx;
    const sc = [0, 0, 0, 0, 0];
    let t = start;
    while (t >= 0 && at(t)) { sc[2] += 1; t -= 1; }
    if (t < 0) return NaN;
    while (t >= 0 && !at(t) && sc[1] <= maxCount) { sc[1] += 1; t -= 1; }
    if (t < 0 || sc[1] > maxCount) return NaN;
    while (t >= 0 && at(t) && sc[0] <= maxCount) { sc[0] += 1; t -= 1; }
    if (sc[0] > maxCount) return NaN;
    t = start + 1;
    while (t < limit && at(t)) { sc[2] += 1; t += 1; }
    if (t === limit) return NaN;
    while (t < limit && !at(t) && sc[3] < maxCount) { sc[3] += 1; t += 1; }
    if (t === limit || sc[3] >= maxCount) return NaN;
    while (t < limit && at(t) && sc[4] < maxCount) { sc[4] += 1; t += 1; }
    if (sc[4] >= maxCount) return NaN;
    const sum = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
    if (5 * Math.abs(sum - total) >= 2 * total) return NaN;
    return patternCross(sc) ? centerFromEnd(sc, t) : NaN;
  };
  const handle = (sc, y, x) => {
    const total = sc[0] + sc[1] + sc[2] + sc[3] + sc[4];
    let cx = centerFromEnd(sc, x);
    const cy = cross(Math.floor(cx), y, sc[2], total, true);
    if (Number.isNaN(cy)) return false;
    cx = cross(Math.floor(cx), Math.floor(cy), sc[2], total, false);
    if (Number.isNaN(cx)) return false;
    const size = total / 7;
    for (const c of centers) {
      if (Math.abs(cy - c.y) <= size && Math.abs(cx - c.x) <= size && Math.abs(size - c.size) <= Math.max(1, c.size)) {
        const n = c.count + 1;
        c.x = (c.x * c.count + cx) / n;
        c.y = (c.y * c.count + cy) / n;
        c.size = (c.size * c.count + size) / n;
        c.count = n;
        return true;
      }
    }
    centers.push({ x: cx, y: cy, size, count: 1 });
    return true;
  };
  for (let y = 0; y < h; y += 1) {
    const sc = [0, 0, 0, 0, 0];
    let state = 0;
    for (let x = 0; x < w; x += 1) {
      if (dark(x, y)) {
        if (state & 1) state += 1;
        sc[state] += 1;
      } else if (!(state & 1)) {
        if (state === 0 && sc[0] === 0) continue;
        if (state === 4) {
          if (patternCross(sc) && handle(sc, y, x)) {
            sc.fill(0);
            state = 0;
          } else {
            sc[0] = sc[2]; sc[1] = sc[3]; sc[2] = sc[4]; sc[3] = 1; sc[4] = 0;
            state = 3;
          }
        } else {
          state += 1;
          sc[state] += 1;
        }
      } else {
        sc[state] += 1;
      }
    }
    if (state === 4 && patternCross(sc)) handle(sc, y, w);
  }
  return centers;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Unten links, oben links, oben rechts — im Bild (y nach unten).
function order(points) {
  const [p0, p1, p2] = points;
  const d01 = dist(p0, p1);
  const d12 = dist(p1, p2);
  const d02 = dist(p0, p2);
  let a;
  let b;
  let c;
  if (d12 >= d01 && d12 >= d02) { b = p0; a = p1; c = p2; }
  else if (d02 >= d12 && d02 >= d01) { b = p1; a = p0; c = p2; }
  else { b = p2; a = p0; c = p1; }
  if ((c.x - b.x) * (a.y - b.y) - (c.y - b.y) * (a.x - b.x) < 0) [a, c] = [c, a];
  return [a, b, c];
}

// Erst nur mehrfach bestätigte Muster; findet sich so kein Dreieck (im
// Rauschen bestätigt sich ein Muster manchmal nur einmal), alle. Unter zwei
// Pixeln je Modul ist ohnehin nichts zu lesen.
function triples(centers) {
  const usable = centers.filter((c) => c.size >= 2);
  const sure = usable.filter((c) => c.count >= 2);
  const found = sure.length >= 3 ? triplesFrom(sure, 12) : [];
  return found.length ? found : triplesFrom(usable, 16);
}

function triplesFrom(candidates, max) {
  const pool = candidates.slice().sort((p, q) => q.count - p.count || q.size - p.size).slice(0, max);
  const out = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      for (let k = j + 1; k < pool.length; k += 1) {
        const pts = [pool[i], pool[j], pool[k]];
        const sizes = pts.map((p) => p.size);
        const smallest = Math.min(...sizes);
        if (Math.max(...sizes) / smallest > 1.7) continue;
        const [p, q, r] = [dist(pts[0], pts[1]), dist(pts[1], pts[2]), dist(pts[0], pts[2])].sort((x, y) => x - y);
        if (p < 9 * smallest) continue;
        const right = Math.abs(r * r - (p * p + q * q)) / (r * r);
        const iso = Math.abs(p - q) / q;
        if (right < 0.35 && iso < 0.5) out.push({ score: right + iso, pts });
      }
    }
  }
  return out.sort((x, y) => x.score - y.score).slice(0, 4).map((t) => order(t.pts));
}

// --------------------------------------------------------- Perspektive -----

function solve(a, b) {
  const n = b.length;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let row = col + 1; row < n; row += 1) {
      const f = a[row][col] / a[col][col];
      for (let k = col; k < n; k += 1) a[row][k] -= f * a[col][k];
      b[row] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row];
    for (let k = row + 1; k < n; k += 1) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

// Abbildung Modulkoordinaten (u, v) → Bildpunkt, aus vier Paaren.
function homography(src, dst) {
  const a = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const [u, v] = src[i];
    const { x, y } = dst[i];
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  return solve(a, b);
}

const project = (m, u, v) => {
  const d = m[6] * u + m[7] * v + 1;
  return [(m[0] * u + m[1] * v + m[2]) / d, (m[3] * u + m[4] * v + m[5]) / d];
};

// Das Ausrichtungsmuster unten rechts: 5×5, dunkler Rand, heller Ring,
// dunkle Mitte. Gesucht wird rund um die Stelle, an der es ohne Perspektive
// läge; von allen Stellen mit der besten Übereinstimmung zählt die Mitte.
function findAlignment(bits, w, h, tl, tr, bl, dim, moduleSize) {
  const span = dim - 7;
  const u = { x: (tr.x - tl.x) / span, y: (tr.y - tl.y) / span };
  const v = { x: (bl.x - tl.x) / span, y: (bl.y - tl.y) / span };
  const m = dim - 10;
  const ex = tl.x + (u.x + v.x) * m;
  const ey = tl.y + (u.y + v.y) * m;
  // Schräg gehalten liegt es weiter weg als gedacht: erst nah, dann weiter.
  for (const reach of [4, 8, 12]) {
    const found = searchAlignment(bits, w, h, u, v, ex, ey, Math.max(3, Math.ceil(moduleSize * reach)));
    if (found) return found;
  }
  return null;
}

function searchAlignment(bits, w, h, u, v, ex, ey, radius) {
  const sample = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return -1;
    return bits[yi * w + xi];
  };
  let best = -1;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const cx = ex + dx;
      const cy = ey + dy;
      let score = 0;
      for (let j = -2; j <= 2; j += 1) {
        for (let i = -2; i <= 2; i += 1) {
          const want = Math.max(Math.abs(i), Math.abs(j)) === 1 ? 0 : 1;
          if (sample(cx + u.x * i + v.x * j, cy + u.y * i + v.y * j) === want) score += 1;
        }
      }
      if (score > best) { best = score; sx = cx; sy = cy; n = 1; }
      else if (score === best) { sx += cx; sy += cy; n += 1; }
    }
  }
  return best >= 23 ? { x: sx / n, y: sy / n } : null;
}

// ------------------------------------------------------------- Lesen -------

const FORMATS = [];
for (const [name, level] of [["L", ECLevel.L], ["M", ECLevel.M], ["Q", ECLevel.Q], ["H", ECLevel.H]]) {
  for (let mask = 0; mask < 8; mask += 1) FORMATS.push({ bits: FormatInfo.getEncodedBits(level, mask), level, name, mask });
}

function bitCount(x) {
  let n = 0;
  while (x) { n += x & 1; x >>>= 1; }
  return n;
}

function maskAt(mask, i, j) {
  switch (mask) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    default: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
  }
}

// Was nicht zu den Daten gehört: Suchmuster mit Rand, Takt, Ausrichtung,
// Format- und Versionsinfo.
function functionMask(version, dim) {
  const reserved = new Uint8Array(dim * dim);
  const mark = (r, c) => { if (r >= 0 && c >= 0 && r < dim && c < dim) reserved[r * dim + c] = 1; };
  for (const [r0, c0] of [[0, 0], [0, dim - 7], [dim - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) for (let c = -1; c <= 7; c += 1) mark(r0 + r, c0 + c);
  }
  for (let i = 0; i < dim; i += 1) { mark(6, i); mark(i, 6); }
  for (const [r, c] of Alignment.getPositions(version)) {
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) mark(r + dr, c + dc);
  }
  for (let i = 0; i <= 8; i += 1) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i += 1) { mark(8, dim - 1 - i); mark(dim - 1 - i, 8); }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const r = Math.floor(i / 3);
      const c = (i % 3) + dim - 11;
      mark(r, c);
      mark(c, r);
    }
  }
  return reserved;
}

function readFormat(get, dim) {
  let vertical = 0;
  let horizontal = 0;
  for (let i = 0; i < 15; i += 1) {
    const r = i < 6 ? i : i < 8 ? i + 1 : dim - 15 + i;
    vertical |= get(r, 8) << i;
    const c = i < 8 ? dim - i - 1 : i < 9 ? 7 : 14 - i;
    horizontal |= get(8, c) << i;
  }
  let best = null;
  let bestDistance = 4;
  for (const f of FORMATS) {
    const d = Math.min(bitCount(f.bits ^ vertical), bitCount(f.bits ^ horizontal));
    if (d < bestDistance) { best = f; bestDistance = d; }
  }
  return best;
}

function deinterleave(bytes, version, level) {
  const total = Utils.getSymbolTotalCodewords(version);
  const dataTotal = total - ECCode.getTotalCodewordsCount(version, level);
  const blocks = ECCode.getBlocksCount(version, level);
  const group2 = total % blocks;
  const group1 = blocks - group2;
  const dataG1 = Math.floor(dataTotal / blocks);
  const ecCount = Math.floor(total / blocks) - dataG1;
  const sizes = Array.from({ length: blocks }, (_, b) => (b < group1 ? dataG1 : dataG1 + 1));
  const parts = sizes.map((s) => new Uint8Array(s + ecCount));
  let k = 0;
  const longest = Math.max(...sizes);
  for (let i = 0; i < longest; i += 1) for (let b = 0; b < blocks; b += 1) if (i < sizes[b]) parts[b][i] = bytes[k++];
  for (let i = 0; i < ecCount; i += 1) for (let b = 0; b < blocks; b += 1) parts[b][sizes[b] + i] = bytes[k++];
  const out = new Uint8Array(dataTotal);
  let at = 0;
  for (let b = 0; b < blocks; b += 1) {
    if (!rsCorrect(parts[b], ecCount)) return null;
    out.set(parts[b].subarray(0, sizes[b]), at);
    at += sizes[b];
  }
  return out;
}

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

function segments(data, version) {
  let pos = 0;
  const limit = data.length * 8;
  const read = (n) => {
    if (pos + n > limit) throw new Error("kurz");
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      v = (v << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1);
      pos += 1;
    }
    return v;
  };
  const range = version < 10 ? 0 : version < 27 ? 1 : 2;
  const decoder = new TextDecoder();
  let text = "";
  let bytes = [];
  const flush = () => { if (bytes.length) { text += decoder.decode(Uint8Array.from(bytes)); bytes = []; } };
  try {
    while (pos + 4 <= limit) {
      const mode = read(4);
      if (mode === 0) break;
      if (mode === 1) {
        flush();
        let count = read([10, 12, 14][range]);
        while (count >= 3) { text += String(read(10)).padStart(3, "0"); count -= 3; }
        if (count === 2) text += String(read(7)).padStart(2, "0");
        else if (count === 1) text += String(read(4));
      } else if (mode === 2) {
        flush();
        let count = read([9, 11, 13][range]);
        while (count >= 2) { const v = read(11); text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; count -= 2; }
        if (count === 1) text += ALNUM[read(6)];
      } else if (mode === 4) {
        const count = read([8, 16, 16][range]);
        for (let i = 0; i < count; i += 1) bytes.push(read(8));
      } else if (mode === 7) {
        read(8);
      } else {
        return null;
      }
    }
  } catch {
    return null;
  }
  flush();
  return text;
}

function readGrid(grid, dim) {
  const get = (r, c) => grid[r * dim + c];
  const format = readFormat(get, dim);
  if (!format) return null;
  const version = (dim - 17) / 4;
  const reserved = functionMask(version, dim);
  const total = Utils.getSymbolTotalCodewords(version);
  const bytes = new Uint8Array(total);
  let index = 0;
  let bit = 7;
  let row = dim - 1;
  let inc = -1;
  for (let col = dim - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c += 1) {
        const cc = col - c;
        if (reserved[row * dim + cc]) continue;
        let value = get(row, cc);
        if (maskAt(format.mask, row, cc)) value ^= 1;
        if (index < total && value) bytes[index] |= 1 << bit;
        bit -= 1;
        if (bit < 0) { index += 1; bit = 7; }
      }
      row += inc;
      if (row < 0 || row >= dim) { row -= inc; inc = -inc; break; }
    }
  }
  const data = deinterleave(bytes, version, format.level);
  return data ? segments(data, version) : null;
}

function sampleGrid(bits, w, h, tl, tr, bl, dim, moduleSize) {
  const version = (dim - 17) / 4;
  let corner = { x: tr.x - tl.x + bl.x, y: tr.y - tl.y + bl.y };
  let at = dim - 3.5;
  if (version >= 2) {
    const ap = findAlignment(bits, w, h, tl, tr, bl, dim, moduleSize);
    at = dim - 6.5;
    if (ap) corner = ap;
    else {
      const k = (dim - 10) / (dim - 7);
      corner = { x: tl.x + (tr.x - tl.x + bl.x - tl.x) * k, y: tl.y + (tr.y - tl.y + bl.y - tl.y) * k };
    }
  }
  const m = homography([[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5], [at, at]], [tl, tr, bl, corner]);
  if (!m) return null;
  const grid = new Uint8Array(dim * dim);
  for (let r = 0; r < dim; r += 1) {
    for (let c = 0; c < dim; c += 1) {
      const [x, y] = project(m, c + 0.5, r + 0.5);
      const xi = Math.min(w - 1, Math.max(0, Math.floor(x)));
      const yi = Math.min(h - 1, Math.max(0, Math.floor(y)));
      if (x < -1 || y < -1 || x > w + 1 || y > h + 1) return null;
      grid[r * dim + c] = bits[yi * w + xi];
    }
  }
  return grid;
}

// Vom Mittelpunkt eines Suchmusters in eine Richtung: dunkle Mitte, heller
// Ring, dunkler Ring — bis zum Hellen dahinter sind es 3,5 Module.
function runToEdge(bits, w, h, x0, y0, dx, dy) {
  let state = 0;
  for (let t = 0; t < 2000; t += 0.5) {
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    if (x < 0 || y < 0 || x >= w || y >= h) return NaN;
    const dark = bits[y * w + x] === 1;
    if (state === 0 && !dark) state = 1;
    else if (state === 1 && dark) state = 2;
    else if (state === 2 && !dark) return t;
  }
  return NaN;
}

// Modulgrösse entlang der Linie zwischen zwei Suchmustern (wie bei ZXing).
// Aus Bildzeilen gemessen war sie bei 45° Drehung gut 40 % zu gross — die
// Zeile schneidet das Muster dann schräg.
function moduleAlong(bits, w, h, p, q) {
  const length = dist(p, q);
  const dx = (q.x - p.x) / length;
  const dy = (q.y - p.y) / length;
  const across = [
    runToEdge(bits, w, h, p.x, p.y, dx, dy) + runToEdge(bits, w, h, p.x, p.y, -dx, -dy),
    runToEdge(bits, w, h, q.x, q.y, dx, dy) + runToEdge(bits, w, h, q.x, q.y, -dx, -dy)
  ].filter(Number.isFinite);
  return across.length ? across.reduce((a, b) => a + b, 0) / across.length / 7 : NaN;
}

function decodeTriple(bits, w, h, [bl, tl, tr]) {
  const sizes = [moduleAlong(bits, w, h, tl, tr), moduleAlong(bits, w, h, tl, bl)].filter(Number.isFinite);
  const moduleSize = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : (tl.size + tr.size + bl.size) / 3;
  const base = Math.round((dist(tl, tr) / moduleSize + dist(tl, bl) / moduleSize) / 2) + 7;
  const dims = [];
  if ((base & 3) === 1) dims.push(base);
  else if ((base & 3) === 0) dims.push(base + 1, base - 3);
  else if ((base & 3) === 2) dims.push(base - 1, base + 3);
  else dims.push(base - 2, base + 2);
  dims.push(dims[0] + 4, dims[0] - 4);
  for (const dim of dims) {
    if (dim < 21 || dim > 177) continue;
    const grid = sampleGrid(bits, w, h, tl, tr, bl, dim, moduleSize);
    if (!grid) continue;
    const text = readGrid(grid, dim);
    if (text !== null) return text;
  }
  return null;
}

// Ein Bild (RGBA wie ImageData) → Text, oder null.
export function decodeQr({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  const bits = binarize(gray, width, height);
  for (const triple of triples(findFinders(bits, width, height))) {
    const text = decodeTriple(bits, width, height, triple);
    if (text !== null) return text;
  }
  return null;
}

// Nur für die Prüfung: was der Leser unterwegs gefunden hat.
export function decodeQrDebug({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  const bits = binarize(gray, width, height);
  const centers = findFinders(bits, width, height);
  const out = { centers: centers.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), size: +c.size.toFixed(2), count: c.count })), tries: [] };
  for (const [bl, tl, tr] of triples(centers)) {
    const moduleSize = (tl.size + tr.size + bl.size) / 3;
    const base = Math.round((dist(tl, tr) / moduleSize + dist(tl, bl) / moduleSize) / 2) + 7;
    const info = { base, moduleSize: +moduleSize.toFixed(2), dims: [] };
    for (const dim of [base - 4, base - 2, base - 1, base, base + 1, base + 2, base + 4]) {
      if ((dim & 3) !== 1 || dim < 21) continue;
      const ap = (dim - 17) / 4 >= 2 ? findAlignment(bits, width, height, tl, tr, bl, dim, moduleSize) : null;
      const grid = sampleGrid(bits, width, height, tl, tr, bl, dim, moduleSize);
      const fmt = grid ? readFormat((r, c) => grid[r * dim + c], dim) : null;
      info.dims.push({ dim, ap: ap ? [Math.round(ap.x), Math.round(ap.y)] : null, format: fmt ? fmt.name + fmt.mask : null, text: grid ? readGrid(grid, dim) !== null : false });
    }
    out.tries.push(info);
  }
  return out;
}
