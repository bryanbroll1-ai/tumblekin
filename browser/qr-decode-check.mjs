// Prüft den QR-Leser (qr-decode.mjs) ohne Kamera:
//   node browser/qr-decode-check.mjs
// 1. Reed-Solomon gegen den Encoder der QR-Bibliothek: bis zur Hälfte der
//    Fehlerkorrektur-Bytes kaputt, alles muss zurückkommen.
// 2. Echte QR-Codes der Bibliothek, gerendert wie von einer Kamera: gedreht,
//    schräg (Perspektive), verrauscht, unscharf, flau. Jeder muss gelesen
//    werden — und ein Bild ohne Code darf nichts liefern.
import QRCode from "qrcode";
import RSEncoder from "qrcode/lib/core/reed-solomon-encoder.js";
import { decodeQr, decodeQrDebug, rsCorrect } from "./qr-decode.mjs";

let seed = 7;
const random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const failures = [];
const check = (ok, what) => { console.log((ok ? "ok    " : "FEHLER") + "  " + what); if (!ok) failures.push(what); };

// --- 1. Reed-Solomon -------------------------------------------------------
{
  let fixed = 0;
  let trials = 0;
  let rejected = 0;
  for (const [dataLength, ec] of [[16, 10], [19, 7], [43, 26], [98, 24]]) {
    const encoder = new RSEncoder(ec);
    for (let t = 0; t < 40; t += 1) {
      const data = Uint8Array.from({ length: dataLength }, () => Math.floor(random() * 256));
      const word = Uint8Array.from([...data, ...encoder.encode(data)]);
      const broken = word.slice();
      const errors = Math.floor(random() * (Math.floor(ec / 2) + 1));
      const spots = new Set();
      while (spots.size < errors) spots.add(Math.floor(random() * broken.length));
      for (const s of spots) broken[s] ^= 1 + Math.floor(random() * 255);
      trials += 1;
      if (rsCorrect(broken, ec) && broken.every((b, i) => b === word[i])) fixed += 1;
      // Zu viele Fehler: darf nicht als "korrigiert" durchgehen, ohne zu stimmen.
      const ruined = word.slice();
      for (let i = 0; i < ec + 2; i += 1) ruined[i] ^= 0x5a;
      if (!rsCorrect(ruined, ec) || ruined.every((b, i) => b === word[i])) rejected += 1;
    }
  }
  check(fixed === trials, `Reed-Solomon: ${fixed}/${trials} Codewörter mit bis zu ec/2 Fehlern repariert`);
  check(rejected === trials, `Reed-Solomon: ${rejected}/${trials} hoffnungslose Codewörter abgelehnt`);
}

// --- 2. Bilder -------------------------------------------------------------
function solve(a, b) {
  const n = b.length;
  for (let col = 0; col < n; col += 1) {
    let p = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[p][col])) p = r;
    [a[col], a[p]] = [a[p], a[col]];
    [b[col], b[p]] = [b[p], b[col]];
    for (let r = col + 1; r < n; r += 1) {
      const f = a[r][col] / a[col][col];
      for (let k = col; k < n; k += 1) a[r][k] -= f * a[col][k];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = b[r];
    for (let k = r + 1; k < n; k += 1) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}
function homography(src, dst) {
  const a = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const [u, v] = src[i];
    const [x, y] = dst[i];
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  return solve(a, b);
}
const project = (m, u, v) => { const d = m[6] * u + m[7] * v + 1; return [(m[0] * u + m[1] * v + m[2]) / d, (m[3] * u + m[4] * v + m[5]) / d]; };

// Ein Kamerabild: der Code (mit 4 Modulen Rand) auf vier Ecken im Bild.
function render(text, { width = 480, height = 640, corners, dark = 30, light = 225, noise = 0, blur = false, level = "M", gradient = 0 }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: level });
  const size = qr.modules.size;
  const quiet = 4;
  const full = size + 2 * quiet;
  const toModule = homography(corners, [[0, 0], [full, 0], [full, full], [0, full]]);
  const gray = new Float32Array(width * height);
  const sub = [0.25, 0.75];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (const sy of sub) for (const sx of sub) {
        const [u, v] = project(toModule, x + sx, y + sy);
        const c = Math.floor(u) - quiet;
        const r = Math.floor(v) - quiet;
        const isDark = r >= 0 && c >= 0 && r < size && c < size && qr.modules.get(r, c);
        sum += isDark ? dark : light;
      }
      gray[y * width + x] = sum / 4 + gradient * (x / width - 0.5);
    }
  }
  let img = gray;
  if (blur) {
    img = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) s += gray[(y + dy) * width + x + dx];
      img[y * width + x] = s / 9;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const v = img[i] + (noise ? (random() + random() + random() - 1.5) * noise : 0);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height, version: qr.version };
}

// Ecken: zentriert, Seitenlänge `side`, gedreht um `angle`, oben/unten
// verschieden breit (Perspektive `tilt`).
function corners({ width = 480, height = 640, side, angle = 0, tilt = 0, dx = 0, dy = 0 }) {
  const cx = width / 2 + dx;
  const cy = height / 2 + dy;
  const half = side / 2;
  const pts = [[-half * (1 - tilt), -half], [half * (1 - tilt), -half], [half * (1 + tilt), half], [-half * (1 + tilt), half]];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return pts.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
}

const texts = {
  code: "TK1|I|ABCD|k3j9qa|o|Xy7Q|4bQ1Lm9zK2vR8sT0pW3eYh6n|qZ3kP9xN0aB7cD2eF5gH8iJ1kL4mN6oP9qR2sT5uV8w|h192.168.178.23:52344,s84.152.33.201:52344",
  answer: "TK1|A|k3j9qa|a|Pq2R|9fG4hJ6kL8zX1cV3bN5mQ7wE|aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hI6kL9nO2qR|hc2b1f8e0-1a2b-4c3d-9e8f-0a1b2c3d4e5f.local:61234,s84.152.33.202:61234",
  url: "https://example.org/tumblekin/?room=WXYZ&b=1"
};
const cases = [];
for (const [name, text] of Object.entries(texts)) {
  cases.push([`${name}: gerade, scharf`, text, { side: 360 }]);
  cases.push([`${name}: 20° gedreht`, text, { side: 340, angle: 0.35 }]);
  cases.push([`${name}: 90° gedreht`, text, { side: 340, angle: Math.PI / 2 }]);
  cases.push([`${name}: auf dem Kopf`, text, { side: 340, angle: Math.PI }]);
  cases.push([`${name}: schräg (Perspektive)`, text, { side: 360, tilt: 0.12, angle: 0.1 }]);
  cases.push([`${name}: klein und versetzt`, text, { side: 250, dx: 60, dy: -90 }], [`${name}: verrauscht, unscharf, flau`, text, { side: 360, angle: -0.2, noise: 40, blur: true, dark: 70, light: 190, gradient: 60 }]);
}
for (const [what, text, opts] of cases) {
  const image = render(text, { corners: corners(opts), ...opts });
  const started = performance.now();
  const got = decodeQr(image);
  const ms = Math.round(performance.now() - started);
  check(got === text, `${what} (Version ${image.version}, ${ms} ms)${got === text ? "" : " → " + JSON.stringify(got)?.slice(0, 60)}`);
  if (got !== text && process.env.QRDEBUG) console.log(JSON.stringify(decodeQrDebug(image)));
}
// Zufällige Kamerabilder: Winkel, Schräglage, Grösse, Lage, Rauschen gemischt.
{
  let read = 0;
  let spent = 0;
  const total = 120;
  for (let i = 0; i < total; i += 1) {
    const text = i % 2 ? texts.answer : texts.code;
    const opts = {
      side: 230 + random() * 170,
      angle: (random() - 0.5) * Math.PI * 2,
      tilt: (random() - 0.5) * 0.24,
      dx: (random() - 0.5) * 60,
      dy: (random() - 0.5) * 120,
      noise: random() * 35,
      blur: random() < 0.5,
      dark: 20 + random() * 50,
      light: 180 + random() * 60,
      gradient: random() * 80
    };
    // Der ganze Code (samt Rand) muss im Bild liegen — halb abgeschnitten
    // liest ihn auch keine Kamera.
    const reach = (opts.side / 2) * (Math.abs(Math.cos(opts.angle)) + Math.abs(Math.sin(opts.angle))) * (1 + Math.abs(opts.tilt));
    opts.side *= Math.min(1, (240 - 12 - Math.abs(opts.dx)) / reach, (320 - 12 - Math.abs(opts.dy)) / reach);
    const image = render(text, { corners: corners(opts), ...opts });
    const started = performance.now();
    const got = decodeQr(image);
    spent += performance.now() - started;
    if (got === text) read += 1;
    else if (process.env.QRDEBUG) {
      const d = decodeQrDebug(image);
      console.log("  verfehlt:", JSON.stringify({ side: Math.round(opts.side), angle: +opts.angle.toFixed(2), tilt: +opts.tilt.toFixed(2), noise: Math.round(opts.noise), blur: opts.blur, dark: Math.round(opts.dark), light: Math.round(opts.light), grad: Math.round(opts.gradient) }), "Muster:", d.centers.filter((c) => c.size >= 2).length, JSON.stringify(d.tries.map((t) => t.dims)).slice(0, 300));
    }
  }
  // Der Scanner probiert mehrere Bilder je Sekunde; 95 % je Bild reichen.
  check(read >= Math.ceil(total * 0.95), `Zufällige Kamerabilder: ${read}/${total} gelesen, im Schnitt ${Math.round(spent / total)} ms je Bild`);
}
{
  const empty = { width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4).map((_, i) => (i % 4 === 3 ? 255 : 128 + ((i * 7919) % 50))) };
  check(decodeQr(empty) === null, "Bild ohne Code: kein Ergebnis");
}
console.log(failures.length ? `\n${failures.length} Fehler` : "\nAlles gelesen.");
process.exit(failures.length ? 1 : 0);
