// Kippboot: Boot und Passagiere als echte Körper — eine Rechnung für Server
// und Gerät. Ein schlichtes Skriptmodul wie SketchFigures: unter Node
// `module.exports`, im Browser `globalThis.TumblekinBootsphysik`.
//
// Vorher war das Boot eine Rechenaufgabe (Gewicht mal Abstand), und die Tiere
// wurden nur hingestellt: zwei an derselben Stelle steckten ineinander, eins
// auf einem anderen schwebte, nichts kippte oder rutschte. Jetzt ist jedes
// Tier ein Klotz mit Masse, der fällt, aufschlägt, auf anderen liegen bleibt,
// rutscht, umkippt und über Bord gehen kann. Das Boot ist ein drehbarer
// Körper: der Auftrieb richtet es auf, das Wasser dämpft, und das Gewicht der
// Tiere drückt es über die Kontakte zur Seite. Liegt es zu schief, kentert es.
//
// Gerechnet wird in der Seitenansicht (x längs des Boots, y nach oben), in
// festen Schritten zu 20 ms mit je zehn Teilschritten. Das Verfahren ist
// positionsbasiert (XPBD, nach Müller et al. 2020): erst bewegen, dann
// Durchdringungen auflösen, dann die Geschwindigkeit aus der Bewegung ablesen.
// Es braucht keine Erinnerung an frühere Schritte — darum rechnet das Gerät
// aus jedem Serverstand genau dasselbe voraus.
(function (root) {
  const G = 9.81;
  const STEP_MS = 20;
  const SUBSTEPS = 10;
  const PIVOT_Y = 0.12;          // Drehpunkt des Boots (Weltkoordinaten)
  const DECK_TOP = 0.25;         // Oberkante des Decks über dem Drehpunkt
  const DECK_HALF = 1.9;         // halbe Decklänge
  const LIP_TOP = 0.43;          // Bug und Heck stehen etwas über das Deck
  const DROP_Y = 1.6;            // Unterkante eines Passagiers am Haken
  const CAP_ANGLE = 0.45;        // so schief, und das Boot kentert
  const BOAT_INERTIA = 20;      // ein schwerer Rumpf: ein Aufprall schubst ihn, wirft ihn nicht um
  const BOAT_SPRING = 120;       // Auftrieb: Rückstellmoment je Radiant
  const BOAT_DAMPING = 60;       // das Wasser bremst das Schaukeln
  const FRICTION_STATIC = 0.75;
  const FRICTION_DYNAMIC = 0.55;
  const RESTITUTION = 0.12;
  const MAX_SPEED = 9;
  const MAX_SPIN = 18;
  const MAX_SPAN_MS = 800;       // weiter rechnet ein Gerät nie voraus
  // Statische Kippgrenze in Gewicht × Abstand: so viel Drehmoment hält das
  // Boot gerade noch, wenn alles still liegt.
  const STATIC_LIMIT = (BOAT_SPRING * CAP_ANGLE) / G;

  // Die Tiere als Klötze in der Seitenansicht: halbe Breite, halbe Höhe,
  // Masse. Gross und schwer kippt anders als klein und leicht; der Pinguin
  // ist schmal und hoch und fällt am ehesten um.
  const KINDS = Object.freeze({
    kueken: Object.freeze({ w: 1, hw: 0.15, hh: 0.23 }),
    pinguin: Object.freeze({ w: 2, hw: 0.18, hh: 0.37 }),
    schaf: Object.freeze({ w: 2, hw: 0.29, hh: 0.29 }),
    schwein: Object.freeze({ w: 3, hw: 0.3, hh: 0.27 })
  });

  // Das Boot: Deck und an Bug und Heck je eine niedrige Kante, im
  // Bootsrahmen (Ursprung im Drehpunkt).
  const BOAT_SHAPES = Object.freeze([
    { x: 0, y: DECK_TOP - 0.1, hw: DECK_HALF, hh: 0.1 },
    { x: -(DECK_HALF + 0.075), y: (DECK_TOP + LIP_TOP) / 2 - 0.05, hw: 0.075, hh: (LIP_TOP - DECK_TOP) / 2 + 0.05 },
    { x: DECK_HALF + 0.075, y: (DECK_TOP + LIP_TOP) / 2 - 0.05, hw: 0.075, hh: (LIP_TOP - DECK_TOP) / 2 + 0.05 }
  ]);

  function kind(name) {
    return KINDS[name] || KINDS.kueken;
  }

  function createWorld(t = 0) {
    return { t, boat: { a: 0, va: 0 }, bodies: [], nextId: 1, capsized: false };
  }

  function copyWorld(world) {
    return {
      t: world.t,
      boat: { a: world.boat.a, va: world.boat.va },
      bodies: world.bodies.map((b) => ({ ...b })),
      nextId: world.nextId,
      capsized: Boolean(world.capsized)
    };
  }

  // Ein Passagier, der jetzt losgelassen wird: in Ruhe, aufrecht, mit der
  // Unterkante auf Hakenhöhe.
  function spawn(world, item) {
    const k = kind(item.kind);
    world.bodies.push({
      id: item.id,
      kind: item.kind,
      turn: item.turn ?? null,
      x: item.x,
      y: (item.y ?? DROP_Y) + k.hh,
      a: 0,
      vx: 0,
      vy: 0,
      va: 0
    });
  }

  // Lage eines Körpers im Bootsrahmen.
  function toBoat(world, x, y) {
    const c = Math.cos(world.boat.a);
    const s = Math.sin(world.boat.a);
    const dy = y - PIVOT_Y;
    return { x: x * c + dy * s, y: -x * s + dy * c };
  }

  // Drehmoment der Tiere um den Drehpunkt, als Gewicht × Abstand im
  // Bootsrahmen — dieselbe Grösse wie STATIC_LIMIT.
  function torque(world) {
    let sum = 0;
    world.bodies.forEach((b) => { sum += kind(b.kind).w * toBoat(world, b.x, b.y).x; });
    return sum;
  }

  function settled(world) {
    if (Math.abs(world.boat.va) > 0.06) return false;
    return world.bodies.every((b) => Math.hypot(b.vx, b.vy) < 0.08 && Math.abs(b.va) < 0.3);
  }

  // --- Kollision ---------------------------------------------------------------
  // Zwei gedrehte Rechtecke: Trennachse mit der geringsten Überdeckung, dann
  // die Kante des anderen an der Bezugsfläche zuschneiden (wie Box2D). Liefert
  // bis zu zwei Kontaktpunkte.

  // Ein gedrehtes Rechteck als Polygon: Ecken und Kantennormalen (gegen den
  // Uhrzeigersinn: unten, rechts, oben, links). Die Felder werden je
  // Teilschritt neu beschrieben, nicht neu angelegt.
  function makePolygon(solver) {
    return { vx: new Float64Array(4), vy: new Float64Array(4), nx: new Float64Array(4), ny: new Float64Array(4), r: 0, cx: 0, cy: 0, solver };
  }

  function placePolygon(p, cx, cy, a, hw, hh) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const ex = c * hw;
    const ey = s * hw;
    const fx = -s * hh;
    const fy = c * hh;
    p.vx[0] = cx - ex - fx; p.vy[0] = cy - ey - fy;
    p.vx[1] = cx + ex - fx; p.vy[1] = cy + ey - fy;
    p.vx[2] = cx + ex + fx; p.vy[2] = cy + ey + fy;
    p.vx[3] = cx - ex + fx; p.vy[3] = cy - ey + fy;
    p.nx[0] = s; p.ny[0] = -c;
    p.nx[1] = c; p.ny[1] = s;
    p.nx[2] = -s; p.ny[2] = c;
    p.nx[3] = -c; p.ny[3] = -s;
    p.r = Math.hypot(hw, hh);
    p.cx = cx;
    p.cy = cy;
  }

  // Grösste Trennung von q entlang der Kantennormalen von p.
  let sepEdge = 0;
  function maxSeparation(p, q) {
    let best = -Infinity;
    sepEdge = 0;
    for (let i = 0; i < 4; i += 1) {
      const nx = p.nx[i];
      const ny = p.ny[i];
      const ox = p.vx[i];
      const oy = p.vy[i];
      let least = Infinity;
      for (let j = 0; j < 4; j += 1) {
        const d = nx * (q.vx[j] - ox) + ny * (q.vy[j] - oy);
        if (d < least) least = d;
      }
      if (least > best) {
        best = least;
        sepEdge = i;
      }
    }
    return best;
  }

  function collide(pa, pb, out) {
    const dx = pb.cx - pa.cx;
    const dy = pb.cy - pa.cy;
    const reach = pa.r + pb.r;
    if (dx * dx + dy * dy > reach * reach) return;
    const sa = maxSeparation(pa, pb);
    if (sa > 0) return;
    const ea = sepEdge;
    const sb = maxSeparation(pb, pa);
    if (sb > 0) return;
    let ref = pa;
    let inc = pb;
    let edge = ea;
    if (sb > sa + 0.0005) {
      ref = pb;
      inc = pa;
      edge = sepEdge;
    }
    const nx = ref.nx[edge];
    const ny = ref.ny[edge];
    // Die Kante des anderen, die am meisten gegen die Bezugsfläche zeigt.
    let ie = 0;
    let least = Infinity;
    for (let i = 0; i < 4; i += 1) {
      const d = nx * inc.nx[i] + ny * inc.ny[i];
      if (d < least) {
        least = d;
        ie = i;
      }
    }
    let ax = inc.vx[ie];
    let ay = inc.vy[ie];
    let bx = inc.vx[(ie + 1) % 4];
    let by = inc.vy[(ie + 1) % 4];
    const v1x = ref.vx[edge];
    const v1y = ref.vy[edge];
    const v2x = ref.vx[(edge + 1) % 4];
    const v2y = ref.vy[(edge + 1) % 4];
    let tx = v2x - v1x;
    let ty = v2y - v1y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // An beiden Seiten der Bezugskante zuschneiden (die Strecke a–b).
    let d0 = -(tx * ax + ty * ay) + (tx * v1x + ty * v1y);
    let d1 = -(tx * bx + ty * by) + (tx * v1x + ty * v1y);
    if (d0 > 0 && d1 > 0) return;
    if (d0 > 0) { const u = d0 / (d0 - d1); ax += u * (bx - ax); ay += u * (by - ay); }
    else if (d1 > 0) { const u = d0 / (d0 - d1); bx = ax + u * (bx - ax); by = ay + u * (by - ay); }
    d0 = tx * ax + ty * ay - (tx * v2x + ty * v2y);
    d1 = tx * bx + ty * by - (tx * v2x + ty * v2y);
    if (d0 > 0 && d1 > 0) return;
    if (d0 > 0) { const u = d0 / (d0 - d1); ax += u * (bx - ax); ay += u * (by - ay); }
    else if (d1 > 0) { const u = d0 / (d0 - d1); bx = ax + u * (bx - ax); by = ay + u * (by - ay); }
    addContact(out, ref, inc, nx, ny, ax, ay, v1x, v1y);
    addContact(out, ref, inc, nx, ny, bx, by, v1x, v1y);
  }

  function addContact(out, ref, inc, nx, ny, px, py, v1x, v1y) {
    const sep = nx * (px - v1x) + ny * (py - v1y);
    if (sep > 0) return;
    // Der Punkt auf der Bezugsfläche und der eingedrungene Punkt, je im
    // Rahmen ihres Körpers festgehalten.
    const s1 = ref.solver;
    const s2 = inc.solver;
    const p1x = px - nx * sep;
    const p1y = py - ny * sep;
    const c1 = Math.cos(s1.a);
    const n1 = Math.sin(s1.a);
    const c2 = Math.cos(s2.a);
    const n2 = Math.sin(s2.a);
    const r1x = p1x - s1.x;
    const r1y = p1y - s1.y;
    const r2x = px - s2.x;
    const r2y = py - s2.y;
    // Annäherung vor der Korrektur — für den Rückprall.
    const w1x = s1.vx - s1.va * r1y;
    const w1y = s1.vy + s1.va * r1x;
    const w2x = s2.vx - s2.va * r2y;
    const w2y = s2.vy + s2.va * r2x;
    out.push({
      s1,
      s2,
      nx,
      ny,
      l1x: r1x * c1 + r1y * n1,
      l1y: -r1x * n1 + r1y * c1,
      l2x: r2x * c2 + r2y * n2,
      l2y: -r2x * n2 + r2y * c2,
      lambda: 0,
      vnPre: (w1x - w2x) * nx + (w1y - w2y) * ny
    });
  }

  // --- Löser ----------------------------------------------------------------

  function cross(rx, ry, nx, ny) {
    return rx * ny - ry * nx;
  }

  // Verschiebt die beiden Körper so, dass sich (p1 − p2)·u um `amount`
  // verringert — aufgeteilt nach Masse und Hebel.
  function shift(s1, s2, r1x, r1y, r2x, r2y, ux, uy, amount) {
    const c1 = cross(r1x, r1y, ux, uy);
    const c2 = cross(r2x, r2y, ux, uy);
    const w = s1.invM + s1.invI * c1 * c1 + s2.invM + s2.invI * c2 * c2;
    if (w <= 0) return 0;
    const l = amount / w;
    s1.x -= ux * l * s1.invM;
    s1.y -= uy * l * s1.invM;
    s1.a -= c1 * l * s1.invI;
    s2.x += ux * l * s2.invM;
    s2.y += uy * l * s2.invM;
    s2.a += c2 * l * s2.invI;
    return l;
  }

  // Ändert die Geschwindigkeiten so, dass sich (v1 − v2)·u um `amount` erhöht.
  function push(s1, s2, r1x, r1y, r2x, r2y, ux, uy, amount) {
    const c1 = cross(r1x, r1y, ux, uy);
    const c2 = cross(r2x, r2y, ux, uy);
    const w = s1.invM + s1.invI * c1 * c1 + s2.invM + s2.invI * c2 * c2;
    if (w <= 0) return;
    const l = amount / w;
    s1.vx += ux * l * s1.invM;
    s1.vy += uy * l * s1.invM;
    s1.va += c1 * l * s1.invI;
    s2.vx -= ux * l * s2.invM;
    s2.vy -= uy * l * s2.invM;
    s2.va -= c2 * l * s2.invI;
  }

  // Durchdringung auflösen, dann Haftreibung: was sich an der Kontaktstelle
  // seitlich verschoben hat, wird zurückgenommen, solange die Reibung reicht.
  function solvePosition(k) {
    const s1 = k.s1;
    const s2 = k.s2;
    let c1 = Math.cos(s1.a);
    let n1 = Math.sin(s1.a);
    let c2 = Math.cos(s2.a);
    let n2 = Math.sin(s2.a);
    let r1x = k.l1x * c1 - k.l1y * n1;
    let r1y = k.l1x * n1 + k.l1y * c1;
    let r2x = k.l2x * c2 - k.l2y * n2;
    let r2y = k.l2x * n2 + k.l2y * c2;
    const depth = (s1.x + r1x - s2.x - r2x) * k.nx + (s1.y + r1y - s2.y - r2y) * k.ny;
    if (depth <= 0) return;
    k.lambda += shift(s1, s2, r1x, r1y, r2x, r2y, k.nx, k.ny, depth);
    c1 = Math.cos(s1.a);
    n1 = Math.sin(s1.a);
    c2 = Math.cos(s2.a);
    n2 = Math.sin(s2.a);
    r1x = k.l1x * c1 - k.l1y * n1;
    r1y = k.l1x * n1 + k.l1y * c1;
    r2x = k.l2x * c2 - k.l2y * n2;
    r2y = k.l2x * n2 + k.l2y * c2;
    const pc1 = Math.cos(s1.pa);
    const pn1 = Math.sin(s1.pa);
    const pc2 = Math.cos(s2.pa);
    const pn2 = Math.sin(s2.pa);
    const o1x = s1.px + k.l1x * pc1 - k.l1y * pn1;
    const o1y = s1.py + k.l1x * pn1 + k.l1y * pc1;
    const o2x = s2.px + k.l2x * pc2 - k.l2y * pn2;
    const o2y = s2.py + k.l2x * pn2 + k.l2y * pc2;
    const dx = s1.x + r1x - o1x - (s2.x + r2x - o2x);
    const dy = s1.y + r1y - o1y - (s2.y + r2y - o2y);
    const dn = dx * k.nx + dy * k.ny;
    const tx = dx - dn * k.nx;
    const ty = dy - dn * k.ny;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-9) return;
    const ux = tx / tl;
    const uy = ty / tl;
    const q1 = cross(r1x, r1y, ux, uy);
    const q2 = cross(r2x, r2y, ux, uy);
    const w = s1.invM + s1.invI * q1 * q1 + s2.invM + s2.invI * q2 * q2;
    if (w > 0 && tl / w < FRICTION_STATIC * k.lambda) shift(s1, s2, r1x, r1y, r2x, r2y, ux, uy, tl);
  }

  // Gleitreibung und ein kleiner Rückprall.
  function solveVelocity(k, h) {
    if (k.lambda <= 0) return;
    const s1 = k.s1;
    const s2 = k.s2;
    const c1 = Math.cos(s1.a);
    const n1 = Math.sin(s1.a);
    const c2 = Math.cos(s2.a);
    const n2 = Math.sin(s2.a);
    const r1x = k.l1x * c1 - k.l1y * n1;
    const r1y = k.l1x * n1 + k.l1y * c1;
    const r2x = k.l2x * c2 - k.l2y * n2;
    const r2y = k.l2x * n2 + k.l2y * c2;
    const rx = s1.vx - s1.va * r1y - (s2.vx - s2.va * r2y);
    const ry = s1.vy + s1.va * r1x - (s2.vy + s2.va * r2x);
    const vn = rx * k.nx + ry * k.ny;
    const tx = rx - vn * k.nx;
    const ty = ry - vn * k.ny;
    const vt = Math.hypot(tx, ty);
    let dx = 0;
    let dy = 0;
    if (vt > 1e-9) {
      const cut = Math.min((FRICTION_DYNAMIC * k.lambda) / h, vt);
      dx -= (tx / vt) * cut;
      dy -= (ty / vt) * cut;
    }
    const e = Math.abs(k.vnPre) <= 2 * G * h ? 0 : RESTITUTION;
    const target = -e * Math.max(k.vnPre, 0);
    if (vn > target) {
      dx += k.nx * (target - vn);
      dy += k.ny * (target - vn);
    }
    const dl = Math.hypot(dx, dy);
    if (dl > 1e-12) push(s1, s2, r1x, r1y, r2x, r2y, dx / dl, dy / dl, dl);
  }

  // Ein Rechenschritt (20 ms). Über Bord gegangene Tiere werden entfernt und
  // als Ereignis gemeldet; liegt das Boot zu schief, ist world.capsized gesetzt.
  // `substeps`: nur zum Planen gröber (ein Bot, der vorausdenkt) — Server und
  // Gerät rechnen immer mit SUBSTEPS.
  function step(world, events, substeps = SUBSTEPS) {
    const h = STEP_MS / 1000 / substeps;
    const boat = { x: 0, y: PIVOT_Y, a: world.boat.a, vx: 0, vy: 0, va: world.boat.va, px: 0, py: PIVOT_Y, pa: world.boat.a, invM: 0, invI: 1 / BOAT_INERTIA };
    const bodies = world.bodies.map((b) => {
      const k = kind(b.kind);
      const m = k.w;
      const inertia = (m * ((2 * k.hw) ** 2 + (2 * k.hh) ** 2)) / 12;
      return { ref: b, hw: k.hw, hh: k.hh, x: b.x, y: b.y, a: b.a, vx: b.vx, vy: b.vy, va: b.va, px: b.x, py: b.y, pa: b.a, invM: 1 / m, invI: 1 / inertia };
    });
    const polys = bodies.map((s) => makePolygon(s));
    const hull = BOAT_SHAPES.map(() => makePolygon(boat));
    for (let sub = 0; sub < substeps; sub += 1) {
      // Bewegen: Schwerkraft für die Tiere, Auftrieb und Wasser fürs Boot.
      for (let i = 0; i < bodies.length; i += 1) {
        const s = bodies[i];
        s.vy -= G * h;
        const speed = Math.hypot(s.vx, s.vy);
        if (speed > MAX_SPEED) {
          s.vx *= MAX_SPEED / speed;
          s.vy *= MAX_SPEED / speed;
        }
        s.va = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, s.va));
        s.px = s.x;
        s.py = s.y;
        s.pa = s.a;
        s.x += s.vx * h;
        s.y += s.vy * h;
        s.a += s.va * h;
        placePolygon(polys[i], s.x, s.y, s.a, s.hw, s.hh);
      }
      boat.va += h * (-BOAT_SPRING * boat.a - BOAT_DAMPING * boat.va) * boat.invI;
      boat.pa = boat.a;
      boat.a += boat.va * h;
      const c = Math.cos(boat.a);
      const n = Math.sin(boat.a);
      BOAT_SHAPES.forEach((shape, i) => placePolygon(hull[i], shape.x * c - shape.y * n, PIVOT_Y + shape.x * n + shape.y * c, boat.a, shape.hw, shape.hh));
      // Berührungen suchen.
      const contacts = [];
      for (let i = 0; i < polys.length; i += 1) {
        for (let j = 0; j < hull.length; j += 1) collide(hull[j], polys[i], contacts);
        for (let j = i + 1; j < polys.length; j += 1) collide(polys[i], polys[j], contacts);
      }
      for (let i = 0; i < contacts.length; i += 1) solvePosition(contacts[i]);
      // Geschwindigkeit aus der Bewegung.
      for (let i = 0; i < bodies.length; i += 1) {
        const s = bodies[i];
        s.vx = (s.x - s.px) / h;
        s.vy = (s.y - s.py) / h;
        s.va = (s.a - s.pa) / h;
      }
      boat.va = (boat.a - boat.pa) / h;
      for (let i = 0; i < contacts.length; i += 1) solveVelocity(contacts[i], h);
    }
    world.boat.a = boat.a;
    world.boat.va = boat.va;
    world.t += STEP_MS;
    const kept = [];
    bodies.forEach((s) => {
      const b = s.ref;
      b.x = s.x;
      b.y = s.y;
      b.a = s.a;
      b.vx = s.vx;
      b.vy = s.vy;
      b.va = s.va;
      // Über Bord: hinter Bug oder Heck unter Deckhöhe, oder ganz unten.
      const local = toBoat(world, b.x, b.y);
      const off = (Math.abs(local.x) > DECK_HALF + 0.1 && local.y < DECK_TOP - 0.05) || b.y < -0.8 || Math.abs(b.x) > 5;
      if (off) events?.push({ kind: "overboard", at: world.t, body: { ...b } });
      else kept.push(b);
    });
    world.bodies = kept;
    if (!world.capsized && Math.abs(world.boat.a) > CAP_ANGLE) {
      world.capsized = true;
      events?.push({ kind: "capsize", at: world.t, side: world.boat.a < 0 ? 1 : -1 });
    }
  }

  // Rechnet bis zur Zeit `to`. Wartende Passagiere (`queue`, je { at, id,
  // kind, x, turn }) werden losgelassen, sobald ihr Augenblick dran ist —
  // immer am Anfang eines Schritts, auf Server und Gerät gleich. Nach dem
  // Kentern hält die Rechnung an.
  function advance(world, queue, to, events, substeps = SUBSTEPS) {
    while (world.t + STEP_MS <= to && !world.capsized) {
      for (let i = 0; i < queue.length;) {
        if (queue[i].at <= world.t) {
          spawn(world, queue[i]);
          queue.splice(i, 1);
        } else i += 1;
      }
      step(world, events, substeps);
    }
    return world;
  }

  const api = Object.freeze({
    G, STEP_MS, SUBSTEPS, PIVOT_Y, DECK_TOP, DECK_HALF, LIP_TOP, DROP_Y, CAP_ANGLE, STATIC_LIMIT, MAX_SPAN_MS,
    KINDS, BOAT_SHAPES,
    kind, createWorld, copyWorld, spawn, step, advance, torque, settled, toBoat
  });
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TumblekinBootsphysik = api;
})(globalThis);
