// Spurmaler: die Figuren und die Wertung — eine Rechnung für Server und Gerät.
// Ein schlichtes Skriptmodul wie SprintPhysics: unter Node `module.exports`,
// im Browser `globalThis.TumblekinSketchFigures`.
//
// Koordinaten: das Zeichenbrett ist 1 × 1, x nach rechts, y nach UNTEN (wie
// auf einer Leinwand). Jede Figur ist ein einziger Strich, so wie der grosse
// Stift sie vorzeichnet.
(function (root) {
  const STEP = 0.012;            // Abstand der Punkte einer Figur
  const SCORE_STEP = 0.02;       // Abstand der Prüfpunkte bei der Wertung

  const NAMES = Object.freeze({
    wave: "Welle",
    heart: "Herz",
    infinity: "Unendlich",
    star: "Stern",
    bolt: "Blitz",
    spiral: "Schnecke",
    house: "Haus vom Nikolaus"
  });

  // Je Durchgang eine Auswahl, von leicht nach schwer.
  const TIERS = [
    ["wave", "heart", "infinity"],
    ["star", "bolt", "infinity", "heart"],
    ["spiral", "house", "star"]
  ];

  const ring = (n, fn) => Array.from({ length: n + 1 }, (_, i) => fn((i / n) * Math.PI * 2));

  // Die Eckpunkte bzw. die grobe Bahn jeder Figur; densify macht daraus
  // gleichmässig verteilte Punkte.
  const RAW = {
    wave: () => Array.from({ length: 61 }, (_, i) => {
      const t = i / 60;
      return [0.12 + 0.76 * t, 0.5 - 0.2 * Math.sin(t * Math.PI * 3)];
    }),
    heart: () => ring(96, (t) => {
      const x = 16 * Math.sin(t) ** 3;
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      return [0.5 + x * 0.021, 0.47 - y * 0.021];
    }),
    infinity: () => ring(96, (t) => {
      const d = 1 + Math.sin(t) ** 2;
      return [0.5 + 0.37 * Math.cos(t) / d, 0.5 + 0.37 * Math.sin(t) * Math.cos(t) / d];
    }),
    star: () => Array.from({ length: 11 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 0.16 : 0.38;
      return [0.5 + r * Math.cos(a), 0.53 + r * Math.sin(a)];
    }),
    bolt: () => [[0.6, 0.1], [0.34, 0.5], [0.52, 0.5], [0.4, 0.9], [0.7, 0.44], [0.52, 0.44], [0.66, 0.1], [0.6, 0.1]],
    spiral: () => Array.from({ length: 121 }, (_, i) => {
      const t = i / 120;
      const a = t * Math.PI * 2 * 2.5;
      const r = 0.035 + 0.33 * t;
      return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)];
    }),
    // Das Haus vom Nikolaus — in einem Zug, wie man es als Kind lernt.
    house: () => [[0.25, 0.86], [0.25, 0.46], [0.75, 0.86], [0.75, 0.46], [0.25, 0.46], [0.5, 0.16], [0.75, 0.46], [0.25, 0.86], [0.75, 0.86]]
  };

  function length(points) {
    let sum = 0;
    for (let i = 1; i < points.length; i += 1) sum += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    return sum;
  }

  // Punkte im festen Abstand `step` entlang der Linie.
  function resample(points, step = STEP) {
    if (!points.length) return [];
    if (points.length === 1) return [points[0].slice()];
    const out = [points[0].slice()];
    let carry = 0;
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const seg = Math.hypot(bx - ax, by - ay);
      let at = step - carry;
      while (at <= seg) {
        const t = at / seg;
        out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        at += step;
      }
      carry = seg - (at - step);
    }
    const last = points[points.length - 1];
    const tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last.slice());
    return out;
  }

  function figurePath(name) {
    const raw = (RAW[name] || RAW.wave)();
    return resample(raw).map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
  }

  function noise(seed) {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  }

  // Drei verschiedene Figuren, je Durchgang aus seiner Stufe.
  function pickFigures(seed, rounds = 3) {
    const picked = [];
    for (let r = 0; r < rounds; r += 1) {
      const tier = TIERS[Math.min(r, TIERS.length - 1)].filter((name) => !picked.includes(name));
      picked.push(tier[Math.floor(noise(seed + r * 211) * tier.length)] || "wave");
    }
    return picked;
  }

  function segDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }

  // Kürzester Abstand eines Punktes zu einer Menge von Strichen.
  function distanceTo(px, py, strokes) {
    let best = Infinity;
    for (const stroke of strokes) {
      if (stroke.length === 1) {
        best = Math.min(best, Math.hypot(px - stroke[0][0], py - stroke[0][1]));
        continue;
      }
      for (let i = 1; i < stroke.length; i += 1) {
        const d = segDistance(px, py, stroke[i - 1][0], stroke[i - 1][1], stroke[i][0], stroke[i][1]);
        if (d < best) best = d;
      }
    }
    return best;
  }

  // Bis zur Toleranz voll, bis zum Doppelten abnehmend, danach nichts.
  function soft(d, tolerance) {
    if (d <= tolerance) return 1;
    if (d >= tolerance * 2) return 0;
    return 1 - (d - tolerance) / tolerance;
  }

  // Wie gut deckt der Strich die Figur? Zwei Seiten:
  //   Abdeckung — wie viel der Figur liegt nahe am Strich (nichts auslassen)
  //   Genauigkeit — wie viel des Strichs liegt nahe an der Figur (nicht
  //                 kritzeln: wer das ganze Brett vollmalt, deckt zwar alles
  //                 ab, liegt aber fast überall daneben)
  // Punkte = 100 × Abdeckung × Genauigkeit.
  function scoreStroke(target, strokes, tolerance) {
    const lines = (strokes || []).filter((stroke) => stroke && stroke.length);
    if (!lines.length || !target?.length) return { coverage: 0, precision: 0, points: 0 };
    const probes = resample(target, SCORE_STEP);
    let covered = 0;
    for (const [x, y] of probes) covered += soft(distanceTo(x, y, lines), tolerance);
    const coverage = covered / probes.length;
    let near = 0;
    let count = 0;
    const figure = [target];
    for (const stroke of lines) {
      for (const [x, y] of resample(stroke, SCORE_STEP)) {
        near += soft(distanceTo(x, y, figure), tolerance);
        count += 1;
      }
    }
    const precision = count ? near / count : 0;
    const points = Math.round(100 * coverage * precision);
    return { coverage: Math.round(coverage * 1000) / 1000, precision: Math.round(precision * 1000) / 1000, points };
  }

  // Striche kompakt fürs Netz: je Punkt zwei Zeichen (x und y auf 64 Stufen),
  // Striche durch „|“ getrennt.
  const DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function packStrokes(strokes, maxPoints = 90) {
    const total = (strokes || []).reduce((sum, stroke) => sum + stroke.length, 0);
    const every = Math.max(1, Math.ceil(total / maxPoints));
    return (strokes || []).map((stroke) => {
      let text = "";
      stroke.forEach((point, i) => {
        if (i % every && i !== stroke.length - 1) return;
        text += DIGITS[Math.round(Math.max(0, Math.min(1, point[0])) * 63)] + DIGITS[Math.round(Math.max(0, Math.min(1, point[1])) * 63)];
      });
      return text;
    }).join("|");
  }

  function unpackStrokes(text) {
    if (!text) return [];
    return String(text).split("|").map((part) => {
      const stroke = [];
      for (let i = 0; i + 1 < part.length; i += 2) stroke.push([DIGITS.indexOf(part[i]) / 63, DIGITS.indexOf(part[i + 1]) / 63]);
      return stroke;
    }).filter((stroke) => stroke.length);
  }

  const api = Object.freeze({ NAMES, TIERS, figurePath, pickFigures, resample, length, scoreStroke, distanceTo, packStrokes, unpackStrokes });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TumblekinSketchFigures = api;
})(globalThis);
