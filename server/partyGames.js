// Die zehn Partyklassiker, die nach den ersten dreissig Spielen dazukamen.
//
// server.js ist mit über achttausend Zeilen an der Grenze dessen, was man
// noch überblickt. Jede neue Familie dort hätte sich an acht Stellen
// dazwischengeschoben — Anlegen, Eingabe, Zeitschritt, Bot, Wertung, Anzeige,
// frühes Ende, Geheimnisse. Hier steht jede Familie an EINER Stelle, und
// server.js ruft sie über eine schmale Schnittstelle:
//
//   create(arcade, players)             Zustand anlegen
//   input(ctx, player, entry, input)    eine Eingabe, liefert { ok, error? }
//   update(ctx)                         je Servertakt
//   bot(ctx, player, entry)             ein Bot-Zug
//   rank(arcade, entry)                 Wertungszahl, grösser ist besser
//   detail(arcade, entry)               die Zahl auf der Ergebnistafel
//   done(ctx)                           ist die Runde vorzeitig entschieden?
//
// `ctx` = { room, minigame, arcade, now, elapsed }. Die Regeln lesen die Zeit
// nur aus `ctx.now`, damit Tests und Simulationen die Uhr verschieben können.

// Zahlen aus Spielereingaben. `Number(x)` wirft bei Objekten ohne brauchbares
// valueOf/toString ({ toString: null }, Object.create(null)) — mitten im Tick
// nähme das die ganze Partie mit. Wie `inputNumber` im Server: nur echte
// Zahlen und Zahlen-Zeichenketten, alles andere wird NaN.
function inputNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

// Sekunden für die Ergebniszeile, deutsch: 0,8 s.
function sekunden(ms) {
  return `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1).replace(".", ",")} s`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const Sketch = require("../client/src/minigames/SketchFigures.js");

// Dieselbe Rauschfunktion wie in server.js: aus einem Seed eine Zahl in [0, 1).
function noise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function level(entry) {
  return entry.botProfile?.level || "normal";
}

function byLevel(entry, easy, normal, hard) {
  const l = level(entry);
  return l === "easy" ? easy : l === "hard" ? hard : normal;
}

// --- Tauziehen -------------------------------------------------------------
//
// Zwei Teams am Seil über einer Schlammgrube — eine einzige Runde. Jeder Tipp
// zieht gleich stark: welches Team schneller tippt, gewinnt. Ist die
// Seilmitte über der Linie eines Teams, ist es vorbei, sonst nach fünfzehn
// Sekunden zugunsten dessen, der vorn liegt — und der zieht die anderen dann
// trotzdem in den Schlamm.
//
// Früher gab es Griffkraft, Abrutschen, Hau-Ruck und drei Durchgänge. Das
// lenkte vom Kern ab: am Tisch will man hämmern, nicht haushalten.
const TUG_LEAD_MS = 1600;
const TUG_ROUND_MS = 15000;
// Nach der Entscheidung nur noch der Ruck in den Schlamm, dann gleich das
// Finale. Drei Sekunden Stehen danach fühlten sich an, als hinge das Spiel.
const TUG_SHOW_MS = 1200;
const TUG_DURATION_MS = TUG_LEAD_MS + TUG_ROUND_MS + TUG_SHOW_MS + 500;
// Seiltempo je Zug und Dämpfung: Das Seil wandert mit dem Unterschied der
// Teamtakte. Tippt einer im Team gar nicht (gut sechs Züge je Sekunde
// weniger), ist es nach etwa sechs Sekunden vorbei; ein Zug je Sekunde
// Unterschied reicht nicht über die Linie, dann entscheidet die Zeit.
const TUG_IMPULSE = 0.06;
const TUG_DAMP = 2.4;
const TUG_MIN_TAP_MS = 60;             // schneller tippt kein Daumen
const TUG_DUMMY_RATE = 6;              // Züge je Sekunde des Sandsacks, wenn man allein spielt

function tugPhaseAt(arcade, elapsed) {
  if (elapsed < TUG_LEAD_MS) return { phase: "lead" };
  return { phase: arcade.tug.phase };
}

function tugTeamSize(arcade, side) {
  return Object.values(arcade.players).filter((entry) => entry.side === side).length;
}

const tug = {
  cooldown: 0,
  fastHand: true,
  create(arcade, players) {
    // Abwechselnd verteilt: bei vier zwei gegen zwei, bei drei einer gegen
    // zwei. Der Einzelne zieht dafür doppelt.
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      entry.side = players.length === 1 ? 0 : index % 2;
      entry.taps = 0;
      entry.work = 0;
      entry.lastTapAt = 0;
      entry.score = 0;
    });
    const sizes = [0, 1].map((side) => tugTeamSize(arcade, side));
    const larger = Math.max(1, ...sizes);
    arcade.tug = {
      pos: 0,                          // -1 = Team links hat gewonnen, +1 = rechts
      vel: 0,
      phase: "lead",
      winner: null,                    // 0, 1 oder null (unentschieden)
      winAt: 0,
      decidedBy: null,
      solo: players.length === 1,
      factor: sizes.map((size) => (size ? larger / size : 0)),
      leadMs: TUG_LEAD_MS,
      roundMs: TUG_ROUND_MS,
      showMs: TUG_SHOW_MS,
      roundStartAt: TUG_LEAD_MS
    };
  },
  input(ctx, player, entry, input) {
    if (input.action !== "pull") return { ok: false, error: "Tippe, um zu ziehen." };
    const { arcade, now, elapsed } = ctx;
    const state = arcade.tug;
    if (tugPhaseAt(arcade, elapsed).phase !== "pull") return { ok: true };
    if (now - entry.lastTapAt < TUG_MIN_TAP_MS) return { ok: true };
    entry.lastTapAt = now;
    entry.taps += 1;
    const impulse = TUG_IMPULSE * (state.factor[entry.side] || 1);
    state.vel += (entry.side === 0 ? -1 : 1) * impulse;
    entry.work += impulse;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, now, elapsed } = ctx;
    const state = arcade.tug;
    const dt = Math.min(0.12, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    if (elapsed < TUG_LEAD_MS) return;
    if (state.phase === "lead") state.phase = "pull";
    if (state.phase === "pull") {
      if (state.solo) state.vel += TUG_DUMMY_RATE * TUG_IMPULSE * dt;
      state.vel *= Math.exp(-TUG_DAMP * dt);
      state.pos += state.vel * dt;
      const over = Math.abs(state.pos) >= 1;
      const timeUp = elapsed - TUG_LEAD_MS >= TUG_ROUND_MS;
      if (over || timeUp) {
        state.pos = clamp(state.pos, -1, 1);
        const winner = Math.abs(state.pos) < 0.02 ? null : state.pos < 0 ? 0 : 1;
        state.winner = winner;
        state.winAt = elapsed;
        state.decidedBy = over ? "line" : "time";
        if (winner !== null) state.pos = winner === 0 ? -1 : 1;
        state.phase = "show";
        state.vel = 0;
      }
      return;
    }
    if (state.phase === "show" && elapsed >= state.winAt + TUG_SHOW_MS) state.phase = "over";
  },
  bot(ctx, player, entry) {
    const { arcade, now, elapsed } = ctx;
    if (tugPhaseAt(arcade, elapsed).phase !== "pull") {
      entry.botNextAt = 0;
      return null;
    }
    // Takt je Stufe, wie ein Mensch am Handy: gut fünf, gut sechs, knapp acht
    // Züge pro Sekunde — mit Schwankung, nie gleichmässig wie eine Maschine.
    if (!entry.botNextAt) entry.botNextAt = now + 120 + Math.random() * 260;
    if (now < entry.botNextAt) return null;
    const base = byLevel(entry, 190, 155, 128);
    // Vom geplanten Zeitpunkt aus weiterzählen, nicht von jetzt: der Bot wird
    // nur alle 120 bis 180 ms gefragt, und von jetzt an gezählt fiele jeder
    // Zug um einen halben Takt zu spät.
    const planned = Math.max(entry.botNextAt, now - 150);
    entry.botNextAt = planned + base * (0.8 + Math.random() * 0.4);
    return { action: "pull" };
  },
  rank(arcade, entry) {
    // Der Teamsieg gehört beiden: eigener Einsatz trennt keine Plätze.
    return arcade.tug?.winner === entry.side ? 1 : 0;
  },
  detail(arcade, entry) {
    return { kind: "points", value: arcade.tug?.winner === entry.side ? 1 : 0, label: "Siege" };
  },
  done(ctx) {
    return ctx.arcade.tug?.phase === "over";
  }
};


// --- Grimassen -------------------------------------------------------------
//
// Oben an der Wand hängt ein verzogenes Gesicht. Vor einem steht eine
// Gummimaske — noch ganz neutral —, und man zieht sie mit dem Finger an sechs
// Punkten zurecht: beide Brauen, Nase, beide Mundwinkel, Kinn. Nach Ablauf
// der Zeit wird verglichen; je näher jeder Punkt am Vorbild liegt, desto mehr
// Punkte.
//
// Ein Punkt ist ein Versatz in [-1, 1] je Achse — das ist alles, was der Server
// kennt. Wie weit sich die Maske dabei verzieht, rechnet der Client; beide
// benutzen dieselben Zahlen, darum stimmt der Vergleich mit dem Bild überein.
const FACE_HANDLES = ["browL", "browR", "nose", "mouthL", "mouthR", "chin"];
const FACE_ROUNDS = 3;
const FACE_LEAD_MS = 900;
const FACE_SHOW_MS = 1600;             // Vorbild zeigen, Maske gesperrt
const FACE_SHAPE_MS = 10500;           // formen (vorher 9 s: knapp für sechs Punkte)
const FACE_REVEAL_MS = 2400;           // Auflösung
const FACE_CYCLE_MS = FACE_SHOW_MS + FACE_SHAPE_MS + FACE_REVEAL_MS;
const FACE_DURATION_MS = FACE_LEAD_MS + FACE_ROUNDS * FACE_CYCLE_MS + 400;
const FACE_MAX_POINTS = 100;
const FACE_MIN_NEUTRAL = 0.3;         // so weit liegt ein Vorbild mindestens von neutral
const FACE_MIN_INPUT_MS = 40;
// Schonfrist nach dem Formen. Das Gerät sperrt die Maske, sobald ein Zug
// nicht mehr rechtzeitig ankäme (Laufzeit mitgerechnet), und schickt dann
// den letzten Stand; die Frist fängt ab, dass die Laufzeitmessung schwankt.
// Gewertet wird erst danach. Vorher zählte, was in der letzten Rundreise
// gezogen oder losgelassen wurde, nicht mehr.
const FACE_GRACE_MS = 150;

// Das Vorbild eines Durchgangs: in Runde 1 sind drei Punkte verzogen, in
// Runde 2 vier, in Runde 3 alle sechs. Nicht verzogene Punkte bleiben nahe 0 —
// dort liegt die Maske am Anfang ohnehin.
function faceTarget(seed, round) {
  const moved = Math.min(FACE_HANDLES.length, 3 + round + (round >= 2 ? 1 : 0));
  const order = FACE_HANDLES.map((_, i) => ({ i, k: noise(seed + round * 131 + i * 17) }))
    .sort((a, b) => a.k - b.k)
    .map((item) => item.i);
  const target = new Array(FACE_HANDLES.length * 2).fill(0);
  order.slice(0, moved).forEach((handle, n) => {
    // Kräftig verzogen, damit es etwas zu sehen gibt: mindestens 0.45 weit.
    const angle = noise(seed + round * 57 + handle * 29 + n) * Math.PI * 2;
    const reach = 0.45 + noise(seed + round * 91 + handle * 13) * 0.55;
    target[handle * 2] = Math.round(Math.cos(angle) * reach * 100) / 100;
    target[handle * 2 + 1] = Math.round(Math.sin(angle) * reach * 100) / 100;
  });
  return target;
}

function faceError(shape, target) {
  let sum = 0;
  for (let i = 0; i < FACE_HANDLES.length; i += 1) {
    sum += Math.hypot((shape[i * 2] || 0) - target[i * 2], (shape[i * 2 + 1] || 0) - target[i * 2 + 1]);
  }
  return sum / FACE_HANDLES.length;
}

// Gemessen wird gegen die neutrale Maske: wer nichts tut, bekommt nichts,
// wer das Vorbild genau trifft, alles. Ein fester Nullpunkt hätte in der
// ersten Runde, in der nur drei Punkte verzogen sind, fürs Nichtstun schon
// zwei Drittel der Punkte verschenkt.
//
// Quadratisch statt fast linear (Exponent 1,15): nachgerechnet holte grobes
// Ziehen in die richtige Richtung (Streuung 0,25) schon 250 von 300 Punkten,
// sorgfältiges (0,12) nur 26 mehr, und jeden Punkt einfach halb zum Ziel zu
// ziehen brachte 135. Jetzt sind es 218, 259 und 75 — Genauigkeit zählt.
function facePoints(error, target) {
  const neutral = Math.max(FACE_MIN_NEUTRAL, faceError(new Array(FACE_HANDLES.length * 2).fill(0), target));
  const share = clamp(1 - error / neutral, 0, 1);
  return Math.round(FACE_MAX_POINTS * share * share);
}

function facePhase(elapsed) {
  const t = elapsed - FACE_LEAD_MS;
  if (t < 0) return { phase: "lead", round: 0, since: t + FACE_LEAD_MS };
  const round = Math.floor(t / FACE_CYCLE_MS);
  if (round >= FACE_ROUNDS) return { phase: "over", round: FACE_ROUNDS - 1, since: t - FACE_ROUNDS * FACE_CYCLE_MS };
  const inner = t - round * FACE_CYCLE_MS;
  if (inner < FACE_SHOW_MS) return { phase: "show", round, since: inner };
  if (inner < FACE_SHOW_MS + FACE_SHAPE_MS) return { phase: "shape", round, since: inner - FACE_SHOW_MS };
  return { phase: "reveal", round, since: inner - FACE_SHOW_MS - FACE_SHAPE_MS };
}

const face = {
  cooldown: 0,
  fastHand: false,
  create(arcade) {
    arcade.face = {
      handles: FACE_HANDLES,
      rounds: FACE_ROUNDS,
      leadMs: FACE_LEAD_MS,
      showMs: FACE_SHOW_MS,
      shapeMs: FACE_SHAPE_MS,
      revealMs: FACE_REVEAL_MS,
      graceMs: FACE_GRACE_MS,
      targets: Array.from({ length: FACE_ROUNDS }, (_, round) => faceTarget(arcade.seed, round)),
      scored: -1                        // bis zu welcher Runde gewertet ist
    };
    Object.values(arcade.players).forEach((entry) => {
      entry.shape = new Array(FACE_HANDLES.length * 2).fill(0);
      entry.results = [];              // je Runde { points, error, shape }
      entry.score = 0;
      entry.lastShapeAt = 0;
      entry.moves = 0;
    });
  },
  input(ctx, player, entry, input) {
    if (input.action !== "shape") return { ok: false, error: "Zieh die Maske zurecht." };
    // Zählt, solange die Runde noch nicht gewertet ist — also auch in der
    // Schonfrist direkt nach dem Formen.
    const { phase, round } = facePhase(ctx.elapsed - FACE_GRACE_MS);
    const now = facePhase(ctx.elapsed);
    if (now.phase !== "shape" && !(phase === "shape" && now.round === round)) return { ok: true };
    if (!input.final && ctx.now - entry.lastShapeAt < FACE_MIN_INPUT_MS) return { ok: true };
    const h = Array.isArray(input.h) ? input.h : null;
    if (!h || h.length !== FACE_HANDLES.length * 2) return { ok: false, error: "Ungültige Form." };
    const next = h.map((value) => (Number.isFinite(inputNumber(value)) ? clamp(Math.round(inputNumber(value) * 100) / 100, -1, 1) : 0));
    entry.shape = next;
    entry.lastShapeAt = ctx.now;
    entry.moves += 1;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, elapsed } = ctx;
    const state = arcade.face;
    const { phase, round } = facePhase(elapsed);
    // Gewertet wird nach der Schonfrist hinter dem Formen — für alle
    // gleichzeitig.
    const graced = facePhase(elapsed - FACE_GRACE_MS);
    const due = graced.phase === "reveal" || graced.phase === "over" ? graced.round : graced.round - 1;
    while (state.scored < due) {
      state.scored += 1;
      const target = state.targets[state.scored];
      Object.values(arcade.players).forEach((entry) => {
        const error = faceError(entry.shape, target);
        const points = facePoints(error, target);
        entry.results[state.scored] = { points, error: Math.round(error * 100) / 100, shape: [...entry.shape] };
        entry.score += points;
      });
    }
    // Neue Runde: die Maske springt zurück auf neutral.
    if (phase === "show" && state.resetRound !== round) {
      state.resetRound = round;
      Object.values(arcade.players).forEach((entry) => { entry.shape = new Array(FACE_HANDLES.length * 2).fill(0); });
    }
  },
  bot(ctx, player, entry) {
    const { arcade, now, elapsed } = ctx;
    const { phase, round, since } = facePhase(elapsed);
    if (phase !== "shape") return null;
    const profile = entry.botProfile || { level: "normal" };
    if (entry.botRound !== round) {
      entry.botRound = round;
      // Wie genau der Bot hinschaut: je Punkt ein fester Fehler für die Runde.
      // Punkte, die im Vorbild neutral bleiben, lässt er liegen — wie ein
      // Mensch. Vorher verzog er auch die, und damit schlug ihn schon grobes
      // menschliches Ziehen; nur der schwache stösst ab und zu einen an.
      const miss = byLevel(entry, 0.36, 0.24, 0.13);
      const target = arcade.face.targets[round];
      entry.botAim = target.map((value, i) => {
        const handle = Math.floor(i / 2);
        const moved = target[handle * 2] || target[handle * 2 + 1];
        if (!moved) return level(entry) === "easy" && Math.random() < 0.3 ? (Math.random() * 2 - 1) * 0.2 : 0;
        return clamp(value + (Math.random() * 2 - 1) * miss, -1, 1);
      });
      entry.botStartAt = byLevel(entry, 1600, 1000, 600) + Math.random() * 600;
      entry.botNextAt = 0;
    }
    if (since < entry.botStartAt || now < (entry.botNextAt || 0)) return null;
    entry.botNextAt = now + byLevel(entry, 520, 380, 300);
    void profile;
    // Einen Punkt ein Stück in Richtung Ziel ziehen — so sieht es aus, als
    // würde jemand an der Maske arbeiten, statt dass sie umspringt.
    const shape = [...entry.shape];
    let worst = -1;
    let worstGap = 0.04;
    for (let i = 0; i < FACE_HANDLES.length; i += 1) {
      const gap = Math.hypot(entry.botAim[i * 2] - shape[i * 2], entry.botAim[i * 2 + 1] - shape[i * 2 + 1]);
      if (gap > worstGap) { worstGap = gap; worst = i; }
    }
    if (worst < 0) return null;
    const step = Math.min(1, 0.55 + Math.random() * 0.3);
    shape[worst * 2] += (entry.botAim[worst * 2] - shape[worst * 2]) * step;
    shape[worst * 2 + 1] += (entry.botAim[worst * 2 + 1] - shape[worst * 2 + 1]) * step;
    return { action: "shape", h: shape, final: true };
  },
  rank(arcade, entry) {
    // Punkte zuerst; bei Gleichstand der kleinere Gesamtfehler.
    const error = (entry.results || []).reduce((sum, r) => sum + (r?.error || 0), 0);
    return Math.max(0, Math.round(entry.score || 0)) * 1000 + Math.max(0, 999 - Math.round(error * 100));
  },
  detail(arcade, entry) {
    return { kind: "points", value: Math.max(0, Math.round(entry.score || 0)), label: "Punkte" };
  },
  done(ctx) {
    return facePhase(ctx.elapsed).phase === "over";
  }
};


// --- Flaggen hoch ----------------------------------------------------------
//
// Der Fahnenmeister hebt Rot, Blau oder beide Fahnen — alle machen es nach,
// so schnell sie können — aber nur, wenn er „Käpt'n sagt:" ruft. Ruft er bloss
// die Farbe, ist es eine Falle: wer dann drückt, ist reingefallen. Die
// Kommandos kommen immer schneller, das Antwortfenster wird enger. Drei
// Fehler, und man ist raus.
//
// Gewertet werden die richtigen Antworten; wer ausscheidet, sammelt eben
// nicht weiter. Bei Gleichstand zählt die schnellere Hand.
//
// Der Fahrplan (wann, welche Farbe, Falle oder nicht) liegt in
// arcade.secret. Die Geräte sehen nur die Zeiten; die Art eines Kommandos
// erfahren sie FLAG_PUBLISH_LEAD_MS vor seinem Start — genug, damit ein Gerät
// es um seine Rundreise früher zeigen kann (siehe FlagCaller.js), aber kein
// Blick auf die ganze Runde im Voraus.
const FLAG_LEAD_MS = 1800;
const FLAG_GAP_START = 1900;
const FLAG_GAP_END = 950;
const FLAG_WINDOW_START = 1500;
const FLAG_WINDOW_END = 620;
const FLAG_DURATION_MS = 36000;
// Ein Fehler, und man sitzt an Deck — wie beim Vorbild. Mit drei Leben
// zog sich die Runde, und die Herzen lenkten vom Käpt'n ab.
const FLAG_LIVES = 1;
const FLAG_FAKE_SHARE = 0.2;
const FLAG_BOTH_SHARE = 0.16;
// Entprellt wird je Flagge: bei BEIDE! drücken zwei Daumen oft innerhalb
// weniger Millisekunden, und der zweite darf nicht verloren gehen.
const FLAG_MIN_PRESS_MS = 35;
// Was kurz nach dem Fenster ankommt, gilt noch: das Gerät schliesst das
// Fenster zur geschätzten Ankunftszeit, und die Schätzung zittert.
const FLAG_GRACE_MS = 120;
// Rundreise (bis 250 ms, wie das Gerät sie deckelt) plus ein Servertakt (90 ms).
const FLAG_PUBLISH_LEAD_MS = 350;

function buildFlagCommands(seed, durationMs = FLAG_DURATION_MS) {
  // Erst die Zeiten, dann die Arten. Gewürfelt je Kommando kam mal eine
  // einzige Täuschung in einer Runde, mal fünf; aus einem gemischten Stapel
  // mit festen Anteilen ist jede Runde gleich gemein.
  const slots = [];
  let at = FLAG_LEAD_MS;
  while (true) {
    const progress = clamp(at / durationMs, 0, 1);
    const window = Math.round(FLAG_WINDOW_START + (FLAG_WINDOW_END - FLAG_WINDOW_START) * progress);
    if (at + window > durationMs - 400) break;
    slots.push({ at, window });
    const gap = FLAG_GAP_START + (FLAG_GAP_END - FLAG_GAP_START) * progress;
    at += Math.round(Math.max(window + 250, gap + (noise(seed + slots.length * 19) - 0.5) * 260));
  }
  const rest = Math.max(0, slots.length - 3);
  const fakes = Math.round(rest * FLAG_FAKE_SHARE);
  const boths = Math.round(rest * FLAG_BOTH_SHARE);
  const deck = [];
  for (let i = 0; i < rest; i += 1) {
    deck.push(i < fakes ? "fake" : i < fakes + boths ? "both" : (i % 2 ? "red" : "blue"));
  }
  // Mischen (deterministisch aus dem Seed) …
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(noise(seed + i * 71) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // … und nie zwei Täuschungen hintereinander — sonst lernt man, nie zu drücken.
  for (let i = 1; i < deck.length; i += 1) {
    if (deck[i] !== "fake" || deck[i - 1] !== "fake") continue;
    const swap = deck.findIndex((kind, k) => kind !== "fake" && (k === 0 || deck[k - 1] !== "fake") && (k + 1 >= deck.length || deck[k + 1] !== "fake") && Math.abs(k - i) > 1);
    if (swap >= 0) [deck[i], deck[swap]] = [deck[swap], deck[i]];
  }
  return slots.map((slot, index) => {
    const kind = index < 3 ? (noise(seed + index * 53 + 7) < 0.5 ? "red" : "blue") : deck[index - 3];
    // Bei einer Täuschung zuckt die Fahne auf einer Seite.
    const side = kind === "fake" ? (noise(seed + index * 11) < 0.5 ? "red" : "blue") : null;
    return { index, at: slot.at, window: slot.window, kind, side };
  });
}

function activeFlagCommand(commands, elapsed, grace = 0) {
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const c = commands[i];
    if (elapsed >= c.at) return elapsed <= c.at + c.window + grace ? c : null;
  }
  return null;
}

// Was die Geräte vom Fahrplan sehen: Zeiten immer, die Art erst kurz vorher.
function publishFlagCommands(arcade, elapsed) {
  const full = arcade.secret.flagCommands;
  arcade.flags.commands.forEach((shown, i) => {
    if (shown.kind || elapsed < shown.at - FLAG_PUBLISH_LEAD_MS) return;
    shown.kind = full[i].kind;
    shown.side = full[i].side;
  });
}

// Ein Mensch am Knopf: die Farbe erkennt er nach `rt`, ob „Käpt'n sagt:"
// dasteht, weiss er erst nach `check`. Wer nicht abwartet, drückt bei einer
// Falle meistens mit. So spielen auch die Bots — schneller oder langsamer,
// aber mit denselben Grenzen.
const FLAG_BOT_HAND = {
  easy: { rt: 610, spread: 110, check: 665, rush: 0.2 },
  normal: { rt: 530, spread: 90, check: 585, rush: 0.1 },
  hard: { rt: 455, spread: 75, check: 505, rush: 0.05 }
};
const FLAG_BOT_TICK_MS = 75;       // halber Bot-Takt: so viel später drückt er im Mittel

function flagGauss() {
  let sum = 0;
  for (let i = 0; i < 6; i += 1) sum += Math.random();
  return (sum - 3) / Math.sqrt(0.5);
}

function flagMistake(entry, command, elapsed, why) {
  entry.answers[command.index] = { result: why, at: elapsed };
  entry.lives = Math.max(0, entry.lives - 1);
  entry.mistakes += 1;
  entry.lastMistakeAt = elapsed;
  if (entry.lives <= 0 && !entry.outAt) {
    entry.outAt = elapsed;
    entry.outMs = elapsed;
  }
}

function flagCorrect(entry, command, elapsed) {
  const reaction = command.kind === "fake" ? 0 : Math.max(0, elapsed - command.at);
  entry.answers[command.index] = { result: "ok", at: elapsed, reaction };
  entry.correct += 1;
  entry.reactionSum += reaction;
  entry.score = entry.correct;
}

const flags = {
  cooldown: 0,
  fastHand: true,
  create(arcade) {
    const commands = buildFlagCommands(arcade.seed);
    arcade.secret = { ...(arcade.secret || {}), flagCommands: commands };
    arcade.flags = {
      commands: commands.map(({ index, at, window }) => ({ index, at, window, kind: null, side: null })),
      lives: FLAG_LIVES,
      graceMs: FLAG_GRACE_MS
    };
    publishFlagCommands(arcade, 0);
    Object.values(arcade.players).forEach((entry) => {
      entry.lives = FLAG_LIVES;
      entry.correct = 0;
      entry.mistakes = 0;
      entry.reactionSum = 0;
      entry.answers = {};              // Kommandonummer → { result, at, reaction }
      entry.pressed = {};              // Kommandonummer → { red, blue }
      entry.outAt = null;
      entry.lastPressAt = { red: 0, blue: 0 };
      entry.lastMistakeAt = -1;
      entry.raised = null;             // zuletzt gehobene Fahne, fürs Bild
      entry.score = 0;
    });
  },
  input(ctx, player, entry, input) {
    if (input.action !== "flag" || !["red", "blue"].includes(input.flag)) return { ok: false, error: "Rot oder Blau?" };
    if (entry.outAt) return { ok: true };
    if (ctx.now - (entry.lastPressAt[input.flag] || 0) < FLAG_MIN_PRESS_MS) return { ok: true };
    entry.lastPressAt[input.flag] = ctx.now;
    entry.raised = { flag: input.flag, at: ctx.elapsed };
    const command = activeFlagCommand(ctx.arcade.secret.flagCommands, ctx.elapsed, FLAG_GRACE_MS);
    // Ausserhalb eines Fensters passiert nichts — Fahne hoch ist erlaubt,
    // es zählt nur eben nicht.
    if (!command || entry.answers[command.index]) return { ok: true };
    if (command.kind === "fake") {
      flagMistake(entry, command, ctx.elapsed, "fooled");
      return { ok: true };
    }
    if (command.kind === "both") {
      const pressed = entry.pressed[command.index] || (entry.pressed[command.index] = { red: false, blue: false });
      pressed[input.flag] = true;
      if (pressed.red && pressed.blue) flagCorrect(entry, command, ctx.elapsed);
      return { ok: true };
    }
    if (input.flag === command.kind) flagCorrect(entry, command, ctx.elapsed);
    else flagMistake(entry, command, ctx.elapsed, "wrong");
    return { ok: true };
  },
  update(ctx) {
    const { arcade, elapsed } = ctx;
    publishFlagCommands(arcade, elapsed);
    // Abgelaufene Fenster abrechnen (nach der Nachfrist): echte Kommandos ohne
    // Antwort sind zu spät, Täuschungen ohne Druck sind richtig.
    arcade.secret.flagCommands.forEach((command) => {
      if (elapsed <= command.at + command.window + FLAG_GRACE_MS) return;
      Object.values(arcade.players).forEach((entry) => {
        if (entry.answers[command.index]) return;
        if (entry.outAt && entry.outAt <= command.at + command.window) {
          entry.answers[command.index] = { result: "out", at: command.at + command.window };
          return;
        }
        if (command.kind === "fake") flagCorrect(entry, command, command.at + command.window);
        else flagMistake(entry, command, command.at + command.window, "late");
      });
    });
  },
  bot(ctx, player, entry) {
    const { arcade, elapsed } = ctx;
    if (entry.outAt) return null;
    // Dieselbe Annahmezeit wie für Menschen, Nachfrist eingeschlossen.
    const command = activeFlagCommand(arcade.secret.flagCommands, elapsed, FLAG_GRACE_MS);
    if (!command || entry.answers[command.index]) return null;
    if (entry.botCommand !== command.index) {
      entry.botCommand = command.index;
      const hand = FLAG_BOT_HAND[level(entry)] || FLAG_BOT_HAND.normal;
      const rt = Math.max(230, hand.rt + flagGauss() * hand.spread);
      const check = Math.max(260, hand.check + flagGauss() * 80);
      const press = Math.random() < hand.rush ? rt : Math.max(rt, check + 40);
      const checked = check <= press;
      entry.botReactAt = command.at + Math.max(150, press - FLAG_BOT_TICK_MS);
      const wrong = Math.random() < (press < hand.rt ? 0.07 : 0.02);
      const fooled = Math.random() < (checked ? 0.03 : 0.85);
      entry.botPlan = command.kind === "fake"
        ? (fooled ? [command.side] : [])
        : command.kind === "both"
          ? (Math.random() < 0.5 ? ["red", "blue"] : ["blue", "red"])
          : [wrong ? (command.kind === "red" ? "blue" : "red") : command.kind];
    }
    if (elapsed < entry.botReactAt || !entry.botPlan.length) return null;
    return { action: "flag", flag: entry.botPlan.shift() };
  },
  rank(arcade, entry) {
    // Richtige zuerst, dann wer länger im Spiel war, dann die schnellere Hand.
    const avg = entry.correct ? entry.reactionSum / entry.correct : 2000;
    return (entry.correct || 0) * 100000 + (entry.lives || 0) * 10000 + Math.max(0, 9999 - Math.round(avg * 4));
  },
  detail(arcade, entry) {
    // Die schnellere Hand entscheidet bei Gleichstand — dann soll man sie sehen.
    const extra = entry.correct ? `Ø ${Math.round(entry.reactionSum / entry.correct)} ms` : null;
    return { kind: "points", value: entry.correct || 0, label: "richtig", extra };
  },
  done(ctx) {
    const { room, arcade, elapsed } = ctx;
    const commands = arcade.secret.flagCommands;
    const last = commands[commands.length - 1];
    if (last && elapsed > last.at + last.window + FLAG_GRACE_MS + 600) return true;
    const entries = room.players.map((player) => arcade.players[player.id]).filter(Boolean);
    const alive = entries.filter((entry) => !entry.outAt);
    if (alive.length === 0) return true;
    // Steht nur noch einer und hat schon mehr richtige als alle anderen, ist
    // es entschieden — die übrigen Kommandos würde er allein abarbeiten.
    if (entries.length > 1 && alive.length === 1) {
      const best = Math.max(...entries.filter((entry) => entry !== alive[0]).map((entry) => entry.correct || 0));
      return (alive[0].correct || 0) > best;
    }
    return false;
  }
};


// --- Honigwabe -------------------------------------------------------------
//
// Am Ast hängt eine Ranke voller Früchte, dazwischen Honigwaben. Reihum
// pflückt jeder von unten eine oder zwei. Wer eine Wabe erwischt, wird
// gestochen — und lässt vor Schreck die Hälfte seiner Früchte fallen. Alles
// ist sichtbar: wer abzählt, schiebt die Wabe dem Nächsten zu und greift nach
// den goldenen Früchten (drei Punkte), wenn sie sicher zu haben sind.
//
// Zuerst war ein Stich das Aus, wie im Vorbild. Zu viert entschied dann fast
// nur die Sitzordnung: wer hinter einem guten Spieler sitzt, bekam die Wabe
// zugeschoben, und zum Ausgleichen blieb keine Gelegenheit. Gemessen gewann
// der starke Bot nicht häufiger als der schwache. Jetzt bleibt jeder bis zum
// Schluss dabei, und wer besser zählt, sammelt mehr.
//
// Danach kostete ein Stich die HÄLFTE des Korbs, dann vier Früchte. Beides
// fühlte sich nicht nach dem Vorbild an: ein Stich muss wehtun. Jetzt ist
// ein Stich wieder das Aus — aber gegen die Sitzordnung von damals helfen
// zwei Dinge: die Reihenfolge wird mit jeder Ranke neu gemischt, und jeder
// darf einmal seinen Zug weiterschieben. Wer zuletzt übrig ist, gewinnt;
// unter Gleichen zählen die Früchte.
const HONEY_LEAD_MS = 1500;
// Etwas flotter als zuerst: mit 4,2 s Bedenkzeit und 0,7 s Pause kam jeder in
// 46 Sekunden nur auf vier Züge — zu wenige Entscheidungen, als dass gutes
// Zählen sich gegen einen einzigen unglücklichen Stich durchsetzen konnte.
const HONEY_TURN_MS = 3600;            // so lange hat man Zeit, dann wird eine gepflückt
const HONEY_TURN_MIN_MS = 2400;
const HONEY_GAP_MS = 500;              // nach dem Pflücken, bis der Nächste dran ist
const HONEY_STING_MS = 1500;           // nach einem Stich
const HONEY_DURATION_MS = 46000;
const HONEY_VINE = 14;
const HONEY_GOLD = 3;
const HONEY_STING_COST = 0;            // ein Stich ist das Aus, die Früchte bleiben im Korb
const HONEY_PASSES = 1;                // so oft darf jeder seinen Zug weiterschieben
// Das Gerät zeigt die Bedenkzeit nach der Ankunftszeit beim Server (siehe
// HoneyVine.js). Was trotzdem knapp danach ankommt, zählt noch: erst nach
// dieser Frist pflückt der Server von selbst.
const HONEY_GRACE_MS = 150;

function buildHoneyVine(seed, number) {
  const items = [];
  let nextComb = 2 + Math.floor(noise(seed + number * 97) * 3);      // erste Wabe an Stelle 2 bis 4
  for (let i = 0; i < HONEY_VINE; i += 1) {
    if (i === nextComb) {
      items.push("comb");
      nextComb = i + 3 + Math.floor(noise(seed + number * 97 + i * 13) * 3);
    } else {
      items.push(noise(seed + number * 31 + i * 7) < 0.18 ? "gold" : "fruit");
    }
  }
  return items;
}

// Die Reihenfolge wird mit jeder neuen Ranke neu gemischt. Bei fester
// Sitzordnung bekam immer derselbe die Wabe zugeschoben — wer direkt hinter
// einem Unsicheren sass, gewann gemessen deutlich öfter, egal wie er spielte.
function honeyOrder(arcade, room) {
  const ids = room.players.map((player) => player.id).filter((id) => arcade.players[id]);
  const state = arcade.honey;
  if (!(state.orderFor === state.vineNumber && state.order?.length === ids.length && ids.every((id) => state.order.includes(id)))) {
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(noise(arcade.seed + state.vineNumber * 131 + i * 17) * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    state.order = order;
    state.orderFor = state.vineNumber;
  }
  return state.order;
}

function honeyAlive(arcade, id) {
  return Boolean(arcade.players[id] && !arcade.players[id].outAt);
}

function honeyNextTurn(ctx, afterId, delay, fresh = false) {
  const { arcade, room, elapsed } = ctx;
  const state = arcade.honey;
  const order = honeyOrder(arcade, room);
  const alive = order.filter((id) => honeyAlive(arcade, id));
  if (!alive.length) { state.turn = null; return; }
  // Mit einer neuen Ranke beginnt die neue Reihenfolge vorn — ausser der
  // Erste wäre der, der gerade gepflückt hat; dann der Zweite. Sonst ist der
  // nächste Noch-Dabei nach dem, der eben dran war (auch wenn der gerade
  // ausgeschieden ist).
  let nextId;
  if (fresh) {
    nextId = alive[0] === afterId && alive.length > 1 ? alive[1] : alive[0];
  } else {
    const at = order.indexOf(afterId);
    nextId = alive[0];
    for (let step = 1; step <= order.length; step += 1) {
      const candidate = order[(at + step) % order.length];
      if (honeyAlive(arcade, candidate)) { nextId = candidate; break; }
    }
  }
  const turnMs = Math.max(HONEY_TURN_MIN_MS, HONEY_TURN_MS - state.turns * 50);
  const from = elapsed + delay;
  // Kein Zug mehr, der nicht mehr zu Ende gespielt werden kann.
  if (from + 900 > HONEY_DURATION_MS) {
    state.turn = null;
    return;
  }
  state.turn = { playerId: nextId, from, until: Math.min(HONEY_DURATION_MS - 200, from + turnMs), number: state.turns };
  state.turns += 1;
}

function honeyTake(ctx, player, entry, count) {
  const { arcade, elapsed } = ctx;
  const state = arcade.honey;
  const taken = state.vine.splice(0, Math.min(count, state.vine.length));
  const stung = taken.includes("comb");
  const fruits = taken.filter((item) => item !== "comb").reduce((sum, item) => sum + (item === "gold" ? HONEY_GOLD : 1), 0);
  const dropped = 0;
  if (stung) {
    // Gestochen: raus. Die Früchte bleiben im Korb — sie trennen nur noch
    // die, die gleich lange dabei waren.
    entry.stings += 1;
    entry.stungAt = elapsed;
    entry.outAt = elapsed;
  } else {
    entry.fruits += fruits;
    entry.golds += taken.filter((item) => item === "gold").length;
  }
  entry.score = entry.fruits;
  entry.picks += 1;
  state.last = { playerId: player.id, taken, stung, dropped, out: stung, gained: stung ? 0 : fruits, at: elapsed, auto: false, number: state.picks };
  state.picks += 1;
  // Ranke leer: eine neue wächst nach.
  let fresh = false;
  if (state.vine.length === 0) {
    state.vineNumber += 1;
    state.vine = buildHoneyVine(arcade.seed, state.vineNumber);
    state.vineAt = elapsed;
    fresh = true;
  }
  honeyNextTurn(ctx, player.id, stung ? HONEY_STING_MS : HONEY_GAP_MS, fresh);
  return state.last;
}

// Einmal im Spiel darf jeder seinen Zug weiterschieben, ohne zu pflücken. Die
// Ranke bleibt, wie sie ist — der Nächste steht vor genau derselben Lage.
//
// Ohne den Joker war Honigwabe ein Nim-Spiel, das die Sitzordnung entschied:
// wer im falschen Abstand zur Wabe dran war, konnte nichts mehr tun. Jetzt
// ist genau dort eine Entscheidung zu treffen — und wer den Joker für eine
// harmlose Lage verschwendet, hat ihn nicht mehr, wenn es darauf ankommt.
function honeyPass(ctx, player, entry) {
  const { arcade, elapsed } = ctx;
  const state = arcade.honey;
  entry.passes -= 1;
  state.last = { playerId: player.id, taken: [], stung: false, dropped: 0, gained: 0, at: elapsed, auto: false, passed: true, number: state.picks };
  state.picks += 1;
  honeyNextTurn(ctx, player.id, HONEY_GAP_MS);
  return state.last;
}

// Wie weit ist die nächste Wabe von unten weg? 0 = ganz unten.
function honeyCombAt(vine) {
  const index = vine.indexOf("comb");
  return index < 0 ? Infinity : index;
}

// Wie wahrscheinlich trifft die nächste Wabe MICH, wenn ich jetzt `take`
// nehme? Die anderen spielen dabei so, wie man es am Tisch erwartet: eine
// Wabe direkt vor sich lassen sie liegen (bei 1 nehmen sie eine, bei 2 zwei),
// sonst greifen sie zufällig. Ich selbst wähle später wieder das Beste.
function honeyRisk(distance, take, players) {
  if (take > distance) return 1;                     // ich griffe selbst in die Wabe
  if (!Number.isFinite(distance)) return 0;          // keine Wabe mehr an der Ranke
  const memo = new Map();
  const f = (d, turn) => {
    if (d === 0) return turn === 0 ? 1 : 0;
    const key = d * 8 + turn;
    if (memo.has(key)) return memo.get(key);
    const next = (turn + 1) % players;
    let value;
    if (turn === 0) value = Math.min(...[1, 2].filter((c) => c <= d).map((c) => f(d - c, next)));
    else if (d <= 2) value = f(0, next);
    else value = 0.5 * f(d - 1, next) + 0.5 * f(d - 2, next);
    memo.set(key, value);
    return value;
  };
  return f(distance - take, 1 % players);
}

function honeyGain(vine, take) {
  return vine.slice(0, take).reduce((sum, item) => sum + (item === "gold" ? HONEY_GOLD : item === "fruit" ? 1 : 0), 0);
}

const honey = {
  cooldown: 120,
  fastHand: false,
  create(arcade, players) {
    arcade.honey = {
      vine: buildHoneyVine(arcade.seed, 0),
      vineNumber: 0,
      vineAt: 0,
      turns: 0,
      picks: 0,
      turn: null,
      last: null,
      leadMs: HONEY_LEAD_MS,
      gold: HONEY_GOLD,
      turnMs: HONEY_TURN_MS,
      graceMs: HONEY_GRACE_MS,
      stingCost: HONEY_STING_COST
    };
    Object.values(arcade.players).forEach((entry) => {
      entry.fruits = 0;
      entry.golds = 0;
      entry.picks = 0;
      entry.stings = 0;
      entry.stungAt = null;
      entry.passes = HONEY_PASSES;
      entry.score = 0;
    });
  },
  input(ctx, player, entry, input) {
    const currentTurn = ctx.arcade.honey.turn;
    if (currentTurn && ctx.elapsed >= currentTurn.until + HONEY_GRACE_MS) {
      honey.update(ctx);
      return { ok: true };
    }
    if (input.action === "pass") {
      const turn = ctx.arcade.honey.turn;
      if (!turn || turn.playerId !== player.id) return { ok: false, error: "Du bist nicht dran." };
      if ((entry.passes || 0) <= 0) return { ok: false, error: "Du hast schon geschoben." };
      if (ctx.elapsed < turn.from) return { ok: true };
      honeyPass(ctx, player, entry);
      return { ok: true };
    }
    if (input.action !== "take" || ![1, 2].includes(inputNumber(input.count))) return { ok: false, error: "Eine oder zwei nehmen." };
    const turn = ctx.arcade.honey.turn;
    if (!turn || turn.playerId !== player.id) return { ok: false, error: "Du bist nicht dran." };
    if (ctx.elapsed < turn.from) return { ok: true };
    honeyTake(ctx, player, entry, inputNumber(input.count));
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, elapsed } = ctx;
    const state = arcade.honey;
    if (!state.turn && state.turns === 0 && elapsed >= HONEY_LEAD_MS) {
      honeyNextTurn(ctx, null, 0, true);
    }
    const turn = state.turn;
    if (turn && elapsed >= turn.until + HONEY_GRACE_MS) {
      // Zeit um: eine wird gepflückt, ob man will oder nicht.
      const player = room.players.find((p) => p.id === turn.playerId);
      const entry = player && arcade.players[player.id];
      if (entry) {
        honeyTake(ctx, player, entry, 1);
        state.last.auto = true;
      } else {
        honeyNextTurn(ctx, turn.playerId, 0);
      }
    }
  },
  bot(ctx, player, entry) {
    const { arcade, room, elapsed } = ctx;
    const state = arcade.honey;
    const turn = state.turn;
    if (!turn || turn.playerId !== player.id || elapsed < turn.from) return null;
    if (entry.botTurn !== turn.number) {
      entry.botTurn = turn.number;
      entry.botAt = turn.from + byLevel(entry, 1300, 950, 700) + Math.random() * 600;
      const k = honeyCombAt(state.vine);
      const players = Math.max(1, room.players.length);
      entry.botPass = false;
      if ((entry.passes || 0) > 0 && players > 1) {
        // Der Joker: der starke hebt ihn für die Wabe direkt vor sich auf, spät
        // im Spiel auch für die verlorene Lage drei davor. Der mittlere
        // erkennt nur die Wabe direkt vor sich, und nicht immer; der schwache
        // schiebt irgendwann, wenn ihm gerade danach ist.
        const late = elapsed > HONEY_DURATION_MS * 0.55;
        if (level(entry) === "hard") entry.botPass = k === 0 || (late && k === 3);
        else if (level(entry) === "normal") entry.botPass = k === 0 && Math.random() < 0.7;
        else entry.botPass = Math.random() < 0.18;
      }
      let count;
      if (k === 0) count = 1;                                   // verloren, so oder so
      else if (level(entry) === "hard") {
        // Gewinn gegen Risiko: ein Stich ist das Aus — dagegen wiegen ein
        // paar Früchte nichts.
        const loss = 40;
        const value = (c) => (c > k ? -Infinity : honeyGain(state.vine, c) - honeyRisk(k, c, players) * loss);
        const one = value(1);
        const two = value(2);
        count = Math.abs(one - two) < 0.05 ? 1 + Math.floor(Math.random() * 2) : one > two ? 1 : 2;
      } else if (k === 1) count = 1;                            // die Wabe dem Nächsten lassen
      else if (k === 2) count = 2;
      else if (level(entry) === "normal" && state.vine[1] === "gold") count = 2;
      else count = 1 + Math.floor(Math.random() * 2);
      // Der schwache greift manchmal daneben, der mittlere selten.
      if (k === 1 && Math.random() < byLevel(entry, 0.3, 0.08, 0)) count = 2;
      if (k === 2 && Math.random() < byLevel(entry, 0.35, 0.15, 0)) count = 1;
      entry.botCount = count;
    }
    if (elapsed < entry.botAt) return null;
    if (entry.botPass && (entry.passes || 0) > 0) return { action: "pass" };
    return { action: "take", count: entry.botCount };
  },
  rank(arcade, entry) {
    // Wer länger dabei ist, liegt vorn; unter Gleichen zählen die Früchte.
    const stayed = entry.outAt == null ? HONEY_DURATION_MS + 1000 : entry.outAt;
    return Math.round(stayed) * 1000 + Math.min(999, entry.fruits || 0);
  },
  detail(arcade, entry) {
    return entry.outAt != null
      ? { kind: "out", value: entry.fruits || 0, label: "Früchte" }
      : { kind: "points", value: entry.fruits || 0, label: "Früchte" };
  },
  done(ctx) {
    // Zuletzt einer übrig: entschieden. Allein spielt man bis zum Stich.
    const entries = Object.values(ctx.arcade.players);
    const alive = entries.filter((entry) => !entry.outAt).length;
    return entries.length > 1 ? alive <= 1 : alive === 0;
  }
};


// --- Schneeballhang --------------------------------------------------------
//
// Auf einem verschneiten Gipfel schiebt jeder eine Schneekugel vor sich her.
// Beim Fahren wächst sie; ein Tipp schickt sie los. Wer getroffen wird, fällt
// kurz um und verliert seine Kugel — wer trifft, bekommt Punkte, und zwar umso
// mehr, je grösser die Kugel war. Zwei Kugeln, die sich treffen, zerplatzen
// beide: wer seine grosse Kugel vor sich hält, hat damit einen Schild.
//
// Gerechnet wird in Welteinheiten auf der Fläche (x quer, z zur Kamera hin).
// Hochkant wie das Handy: schmal und tief. Quer lag das Feld als Streifen
// oben im Bild, und darunter war nur Schnee.
// Etwas kleiner als zuerst (7 × 9): auf dem grossen Feld standen die Figuren
// als Punkte in einer weiten Schneefläche, und man lief lange, bis man jemanden
// traf. Enger trifft man sich öfter, und die Kamera kommt näher heran.
//
// Gerechnet wird in festen Schritten auf einer eigenen Uhr (snowClock), und
// das Anfahren ist exakt gelöst: so rechnet das Gerät genau dasselbe voraus
// (Schneeball.js), bis zu dem Moment, in dem ein jetzt geschickter Stick
// ankommt. Vorher hing jede Bewegung eine Rundreise hinter dem Daumen.
//
// Grosse Kugeln waren eine Falle: bis eine Kugel drei Punkte wert war, rollte
// man fast drei Sekunden, wurde dabei meist getroffen und verlor sie. Gemessen
// gewann, wer auf grosse Kugeln wartete, 6 % der Runden (Grundlinie 25 %),
// mit Schild 1 %. Jetzt wächst die Kugel schneller, bremst weniger, eine
// Riesenkugel ist vier Punkte wert und walzt nach einem Treffer weiter. Klein
// und oft, gross und selten, Schild und Nahkampf liegen damit alle zwischen
// 22 und 31 %.
const SNOW_W = 6.2;                    // Breite des Feldes
const SNOW_D = 8;                      // Tiefe
const SNOW_DURATION_MS = 42000;
const SNOW_SPEED = 3.3;                // Laufen ohne Kugel
const SNOW_BALL_DRAG = 0.25;           // so viel langsamer mit voller Kugel
const SNOW_ACCEL = 14;
const SNOW_TURN = 9;                   // rad/s
const SNOW_GROW = 0.3;                 // Kugelgrösse je Sekunde bei voller Fahrt
const SNOW_MIN_SIZE = 0.2;
const SNOW_THROW_MIN = 0.4;            // kleiner lässt sie sich nicht werfen
const SNOW_THROW_COOLDOWN_MS = 450;
const SNOW_BALL_SPEED = 6.2;
const SNOW_BALL_FRICTION = 2.1;        // Abbremsen (Einheiten/s²)
const SNOW_BALL_STOP = 0.9;            // darunter zerfällt sie
const SNOW_BODY_R = 0.3;
const SNOW_STUN_MS = 1200;
const SNOW_SAFE_MS = 900;              // nach dem Aufstehen kurz sicher
const SNOW_BUMP = 0.62;                // Figuren schieben sich auseinander
const SNOW_SUB = 0.12;                 // längstes Rollstück zwischen zwei Trefferprüfungen
const SNOW_SHIELD_MIN = 0.5;           // ab dieser Grösse hält die eigene Kugel
const SNOW_GIANT = 0.85;               // Riesenkugel: vier Punkte, walzt weiter
const SNOW_GIANT_KEEP = 0.7;           // so viel Tempo behält sie nach einem Treffer
const SNOW_STEP_MS = 30;               // Rechenschritt, wie STEP_MS in Schneeball.js
const SNOW_CATCHUP_MS = 250;           // hängt der Server, holt er höchstens so viel nach

// Die Regeln, wie das Gerät sie braucht (Schneeball.js liest arcade.snowRules).
const SNOW_RULES = {
  w: SNOW_W, d: SNOW_D, speed: SNOW_SPEED, drag: SNOW_BALL_DRAG, accel: SNOW_ACCEL, turn: SNOW_TURN,
  grow: SNOW_GROW, minSize: SNOW_MIN_SIZE, throwMin: SNOW_THROW_MIN, cooldownMs: SNOW_THROW_COOLDOWN_MS,
  ballSpeed: SNOW_BALL_SPEED, friction: SNOW_BALL_FRICTION, stop: SNOW_BALL_STOP, bodyR: SNOW_BODY_R,
  stunMs: SNOW_STUN_MS, safeMs: SNOW_SAFE_MS, bump: SNOW_BUMP, sub: SNOW_SUB, shieldMin: SNOW_SHIELD_MIN,
  giant: SNOW_GIANT, giantKeep: SNOW_GIANT_KEEP
};

function snowBallRadius(size) {
  return 0.12 + size * 0.26;
}

function snowValue(size) {
  return size >= SNOW_GIANT ? 4 : size >= 0.6 ? 2 : 1;
}

function snowSpawn(index, count) {
  const spots = [[-2.2, -3], [2.2, 3], [2.2, -3], [-2.2, 3]];
  const [x, z] = spots[index % spots.length];
  return { x, z, heading: Math.atan2(-x, -z) };
}

// Anfahren exakt gelöst: v nähert sich `target` mit der Rate `rate`. Gibt die
// neue Geschwindigkeit und den Weg in diesem Schritt — unabhängig davon, wie
// der Schritt zerlegt wird.
function snowEase(v, target, rate, dt) {
  const fade = Math.exp(-rate * dt);
  return { v: target + (v - target) * fade, d: target * dt + (v - target) * (1 - fade) / rate };
}

// Ein Wurf aus dem jetzigen Stand der Figur. Gleich in Schneeball.js.
function snowThrowBall(entry, id, owner, now) {
  const r = snowBallRadius(entry.size);
  const hx = Math.sin(entry.heading);
  const hz = Math.cos(entry.heading);
  return {
    id,
    owner,
    x: entry.x + hx * (SNOW_BODY_R + r + 0.05),
    z: entry.z + hz * (SNOW_BODY_R + r + 0.05),
    vx: hx * SNOW_BALL_SPEED + entry.vx * 0.3,
    vz: hz * SNOW_BALL_SPEED + entry.vz * 0.3,
    size: entry.size,
    r,
    value: snowValue(entry.size),
    bornAt: now,
    spin: 0
  };
}

// Ein Rechenschritt für Figuren und Kugeln. `entries`: [{ id, entry }] in der
// festen Reihenfolge arcade.order. Genau so in Schneeball.js (stepSnow) —
// ein Test hält beide gleich.
function snowStep(arcade, entries, dt, now) {
  const state = arcade.snow;
  const halfW = SNOW_W / 2 - SNOW_BODY_R;
  const halfD = SNOW_D / 2 - SNOW_BODY_R;
  entries.forEach(({ entry }) => {
    const stunned = now < entry.stunUntil;
    const want = stunned ? 0 : Math.min(1, Math.hypot(entry.dirX, entry.dirZ));
    const top = SNOW_SPEED * (1 - SNOW_BALL_DRAG * entry.size);
    const gx = snowEase(entry.vx, stunned ? 0 : entry.dirX * top, SNOW_ACCEL, dt);
    const gz = snowEase(entry.vz, stunned ? 0 : entry.dirZ * top, SNOW_ACCEL, dt);
    entry.vx = gx.v;
    entry.vz = gz.v;
    const x = entry.x + gx.d;
    const z = entry.z + gz.d;
    entry.x = clamp(x, -halfW, halfW);
    entry.z = clamp(z, -halfD, halfD);
    // Am Zaun steht man: wer dagegen drückt, rollt nicht — und seine Kugel
    // wächst nicht. Vorher behielt die Figur ihr Tempo und die Kugel wuchs
    // im Stehen.
    if (x !== entry.x) entry.vx = 0;
    if (z !== entry.z) entry.vz = 0;
    const speed = Math.hypot(entry.vx, entry.vz);
    if (!stunned && speed > 0.4) entry.size = Math.min(1, entry.size + SNOW_GROW * (speed / SNOW_SPEED) * dt);
    if (want > 0.15) {
      const target = Math.atan2(entry.dirX, entry.dirZ);
      const diff = Math.atan2(Math.sin(target - entry.heading), Math.cos(target - entry.heading));
      entry.heading += clamp(diff, -SNOW_TURN * dt, SNOW_TURN * dt);
    }
  });

  // Figuren schieben sich auseinander.
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a].entry;
      const two = entries[b].entry;
      const dx = two.x - one.x;
      const dz = two.z - one.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= SNOW_BUMP || dist < 1e-6) continue;
      const push = (SNOW_BUMP - dist) / 2;
      one.x = clamp(one.x - (dx / dist) * push, -halfW, halfW);
      one.z = clamp(one.z - (dz / dist) * push, -halfD, halfD);
      two.x = clamp(two.x + (dx / dist) * push, -halfW, halfW);
      two.z = clamp(two.z + (dz / dist) * push, -halfD, halfD);
    }
  }

  // Rollende Kugeln.
  const gone = new Set();
  // Treffer auf Figuren — nicht auf den Werfer, nicht auf Liegende.
  const snowHits = (ball) => {
    entries.forEach(({ id, entry }) => {
      if (gone.has(ball.id) || id === ball.owner) return;
      if (now < entry.stunUntil || now < entry.safeUntil) return;
      // Die eigene grosse Kugel vorn ist ein Schild.
      const hx = Math.sin(entry.heading);
      const hz = Math.cos(entry.heading);
      const shieldR = snowBallRadius(entry.size);
      const sx = entry.x + hx * (SNOW_BODY_R + shieldR);
      const sz = entry.z + hz * (SNOW_BODY_R + shieldR);
      if (entry.size >= SNOW_SHIELD_MIN && Math.hypot(ball.x - sx, ball.z - sz) < ball.r + shieldR) {
        gone.add(ball.id);
        entry.size = SNOW_MIN_SIZE;
        entry.blocks += 1;
        state.bursts.push({ x: (ball.x + sx) / 2, z: (ball.z + sz) / 2, size: Math.max(ball.size, shieldR), at: now, kind: "block", by: id });
        return;
      }
      if (Math.hypot(ball.x - entry.x, ball.z - entry.z) < ball.r + SNOW_BODY_R) {
        // Eine Riesenkugel walzt weiter und kann noch jemanden umwerfen.
        if (ball.size >= SNOW_GIANT) {
          ball.vx *= SNOW_GIANT_KEEP;
          ball.vz *= SNOW_GIANT_KEEP;
        } else {
          gone.add(ball.id);
        }
        entry.stunUntil = now + SNOW_STUN_MS;
        entry.safeUntil = now + SNOW_STUN_MS + SNOW_SAFE_MS;
        entry.size = SNOW_MIN_SIZE;
        entry.taken += 1;
        entry.lastHitAt = now;
        entry.lastHitBy = ball.owner;
        entry.vx = ball.vx * 0.25;
        entry.vz = ball.vz * 0.25;
        const thrower = arcade.players[ball.owner];
        if (thrower) {
          thrower.hits += 1;
          thrower.score += ball.value;
        }
        state.bursts.push({ x: entry.x, z: entry.z, size: ball.size, at: now, kind: "hit", victim: id, by: ball.owner, value: ball.value });
      }
    });
  };
  state.balls.forEach((ball) => {
    const speed = Math.hypot(ball.vx, ball.vz);
    const slower = Math.max(0, speed - SNOW_BALL_FRICTION * dt);
    if (speed > 0) {
      ball.vx *= slower / speed;
      ball.vz *= slower / speed;
    }
    ball.spin += (slower / Math.max(0.1, ball.r)) * dt;
    if (slower < SNOW_BALL_STOP) {
      gone.add(ball.id);
      state.bursts.push({ x: ball.x, z: ball.z, size: ball.size, at: now, kind: "fizzle" });
      return;
    }
    // In Teilstücken rollen und nach jedem auf Treffer prüfen: in einem
    // Stück rollte eine schnelle kleine Kugel durch jemanden hindurch.
    const teile = Math.max(1, Math.ceil((slower * dt) / SNOW_SUB));
    for (let teil = 0; teil < teile && !gone.has(ball.id); teil += 1) {
      ball.x += (ball.vx * dt) / teile;
      ball.z += (ball.vz * dt) / teile;
      // Am Zaun prallt sie ab und verliert Schwung.
      const limX = SNOW_W / 2 - ball.r;
      const limZ = SNOW_D / 2 - ball.r;
      if (Math.abs(ball.x) > limX) { ball.x = Math.sign(ball.x) * limX; ball.vx *= -0.55; ball.vz *= 0.8; }
      if (Math.abs(ball.z) > limZ) { ball.z = Math.sign(ball.z) * limZ; ball.vz *= -0.55; ball.vx *= 0.8; }
      snowHits(ball);
    }
  });
  // Zwei Kugeln prallen zusammen: beide zerplatzen.
  for (let a = 0; a < state.balls.length; a += 1) {
    for (let b = a + 1; b < state.balls.length; b += 1) {
      const one = state.balls[a];
      const two = state.balls[b];
      if (gone.has(one.id) || gone.has(two.id)) continue;
      if (Math.hypot(one.x - two.x, one.z - two.z) < one.r + two.r) {
        gone.add(one.id);
        gone.add(two.id);
        state.bursts.push({ x: (one.x + two.x) / 2, z: (one.z + two.z) / 2, size: Math.max(one.size, two.size), at: now, kind: "clash" });
      }
    }
  }
  if (gone.size) state.balls = state.balls.filter((ball) => !gone.has(ball.id));
}

const snow = {
  cooldown: 0,
  fastHand: true,
  create(arcade, players) {
    arcade.snow = {
      w: SNOW_W,
      d: SNOW_D,
      balls: [],
      nextBall: 1,
      bursts: [],                      // { x, z, size, at } — für den Schneestaub
      throwMin: SNOW_THROW_MIN
    };
    arcade.snowRules = { ...SNOW_RULES };
    arcade.order = players.map((player) => player.id);
    arcade.snowClock = arcade.startedAt || 0;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const spot = snowSpawn(index, players.length);
      entry.x = spot.x;
      entry.z = spot.z;
      entry.vx = 0;
      entry.vz = 0;
      entry.dirX = 0;
      entry.dirZ = 0;
      entry.heading = spot.heading;
      entry.size = SNOW_MIN_SIZE;
      entry.stunUntil = 0;
      entry.safeUntil = 0;
      entry.lastThrowAt = 0;
      entry.hits = 0;
      entry.taken = 0;
      entry.throws = 0;
      entry.blocks = 0;
      entry.lastHitAt = 0;
      entry.lastHitBy = null;
      entry.score = 0;
    });
  },
  input(ctx, player, entry, input) {
    const { arcade, now } = ctx;
    if (input.action === "steer") {
      const x = inputNumber(input.x);
      const y = inputNumber(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Ungültige Richtung." };
      const len = Math.hypot(x, y);
      const k = len > 1 ? 1 / len : 1;
      entry.dirX = x * k;
      entry.dirZ = y * k;
      return { ok: true };
    }
    if (input.action !== "throw") return { ok: false, error: "Lenken oder werfen." };
    if (now < entry.stunUntil || now - entry.lastThrowAt < SNOW_THROW_COOLDOWN_MS) return { ok: true };
    if (entry.size < SNOW_THROW_MIN) return { ok: true };
    // Geworfen wird aus dem Stand des letzten Rechenschritts; die Kugel rollt
    // ab dem nächsten mit.
    arcade.snow.balls.push(snowThrowBall(entry, arcade.snow.nextBall, player.id, now));
    arcade.snow.nextBall += 1;
    entry.size = SNOW_MIN_SIZE;
    entry.lastThrowAt = now;
    entry.throws += 1;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, now } = ctx;
    const state = arcade.snow;
    arcade.lastUpdateAt = now;
    state.bursts = state.bursts.filter((b) => now - b.at < 1500);
    if (!arcade.snowClock) arcade.snowClock = now;
    if (now - arcade.snowClock > SNOW_CATCHUP_MS) arcade.snowClock = now - SNOW_CATCHUP_MS;
    const present = new Set(room.players.map((player) => player.id));
    const entries = (arcade.order || room.players.map((player) => player.id))
      .filter((id) => present.has(id) && arcade.players[id])
      .map((id) => ({ id, entry: arcade.players[id] }));
    while (arcade.snowClock + SNOW_STEP_MS <= now) {
      arcade.snowClock += SNOW_STEP_MS;
      snowStep(arcade, entries, SNOW_STEP_MS / 1000, arcade.snowClock);
    }
  },
  bot(ctx, player, entry) {
    const input = snowBotPlan(ctx, player, entry);
    return input?.action === "steer" ? snowAvoidWalls(entry, input) : input;
  },
  rank(arcade, entry) {
    // Punkte zuerst, dann weniger eingesteckt.
    return (entry.score || 0) * 1000 + Math.max(0, 999 - (entry.taken || 0) * 10);
  },
  detail(arcade, entry) {
    return { kind: "points", value: Math.max(0, Math.round(entry.score || 0)), label: "Punkte" };
  },
  done() {
    return false;
  }
};

// Nicht stur gegen den Zaun lenken: dort steht man, und die Kugel wächst
// nicht. Beim Kreisen um einen Gegner drückten die Bots oft minutenlang in
// die Ecke — gemessen holte in jeder zwölften Runde kein einziger einen Punkt.
function snowAvoidWalls(entry, input) {
  const halfW = SNOW_W / 2 - SNOW_BODY_R;
  const halfD = SNOW_D / 2 - SNOW_BODY_R;
  const margin = 0.8;
  const push = (d) => (d < margin ? (margin - d) / margin : 0);
  const px = push(entry.x + halfW) - push(halfW - entry.x);     // > 0: weg von der linken Wand
  const pz = push(entry.z + halfD) - push(halfD - entry.z);
  let x = input.x;
  let y = input.y;
  // Nichts mehr in die Wand hinein …
  if ((px > 0 && x < 0) || (px < 0 && x > 0)) x = 0;
  if ((pz > 0 && y < 0) || (pz < 0 && y > 0)) y = 0;
  x += px * 1.3;
  y += pz * 1.3;
  // … und zeigte der Stick fast nur in sie hinein, an ihr entlang. Nur
  // abzuziehen hob sich mit dem Wegdrücken auf, und der Bot stand.
  if (Math.hypot(x, y) < 0.35 && Math.hypot(input.x, input.y) > 0.3) {
    const side = entry.botSide || 1;
    if (pz !== 0) x += side * 0.9;
    else if (px !== 0) y += side * 0.9;
  }
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { action: "steer", x, y };
}

function snowBotPlan(ctx, player, entry) {
    const { arcade, room, now } = ctx;
    const state = arcade.snow;
    if (now < entry.stunUntil) return { action: "steer", x: 0, y: 0 };
    // Ziele sind nur, wer stehen UND getroffen werden kann. Der starke Bot sieht
    // auch den kurzen Schutz nach dem Aufstehen — wer darauf wirft, verschenkt
    // seine Kugel. Vorher warfen alle Stufen gleich blind darauf, und der starke
    // gewann gemessen nicht öfter als der mittlere.
    const others = room.players.filter((p) => p.id !== player.id).map((p) => arcade.players[p.id])
      .filter((e) => e && now >= e.stunUntil && (level(entry) !== "hard" || now >= e.safeUntil - 250));
    // Ausweichen: kommt eine fremde Kugel direkt auf einen zu, zur Seite.
    const dodge = byLevel(entry, 0.15, 0.3, 0.85);
    if (entry.botDodgeUntil && now < entry.botDodgeUntil) return { action: "steer", x: entry.botDodgeX, y: entry.botDodgeZ };
    for (const ball of state.balls) {
      if (ball.owner === player.id) continue;
      const rx = entry.x - ball.x;
      const rz = entry.z - ball.z;
      const speed = Math.hypot(ball.vx, ball.vz);
      const along = (rx * ball.vx + rz * ball.vz) / Math.max(0.01, speed);
      if (along < 0 || along > 3.2) continue;
      const miss = Math.abs(rx * ball.vz - rz * ball.vx) / Math.max(0.01, speed);
      if (miss > ball.r + SNOW_BODY_R + 0.15) continue;
      if (entry.botDodgedBall === ball.id) continue;
      entry.botDodgedBall = ball.id;
      if (Math.random() > dodge) continue;
      // Quer zur Flugbahn, weg von der Mitte der Bahn.
      const side = (rx * ball.vz - rz * ball.vx) >= 0 ? 1 : -1;
      entry.botDodgeX = (ball.vz / speed) * side;
      entry.botDodgeZ = (-ball.vx / speed) * side;
      entry.botDodgeUntil = now + 420;
      return { action: "steer", x: entry.botDodgeX, y: entry.botDodgeZ };
    }
    if (!others.length) {
      // Allein: im Kreis rollen und werfen.
      const a = now / 900;
      if (entry.size > 0.7 && now - entry.lastThrowAt > 900) return { action: "throw" };
      return { action: "steer", x: Math.cos(a), y: Math.sin(a) };
    }
    // Der starke Bot meidet Ziele, die ihre grosse Kugel als Schild zu ihm
    // halten — ein Wurf darauf zerplatzt nur. Die anderen nehmen den Nächsten.
    const cost = (e) => {
      const dist = Math.hypot(e.x - entry.x, e.z - entry.z);
      if (level(entry) !== "hard" || e.size < 0.5) return dist;
      const facing = (Math.sin(e.heading) * (entry.x - e.x) + Math.cos(e.heading) * (entry.z - e.z)) / Math.max(0.01, dist);
      return dist + (facing > 0.5 ? 3 : 0);
    };
    const target = others.reduce((best, e) => (cost(e) < cost(best) ? e : best));
    // Vorhalten: wohin läuft das Ziel, bis die Kugel dort ist? Der starke
    // rechnet das voll, der mittlere halb, der schwache wirft aufs Jetzt.
    const lead = byLevel(entry, 0, 0.3, 1);
    const flight = Math.hypot(target.x - entry.x, target.z - entry.z) / SNOW_BALL_SPEED;
    const px = target.x + target.vx * flight * lead;
    const pz = target.z + target.vz * flight * lead;
    const dx = px - entry.x;
    const dz = pz - entry.z;
    const dist = Math.hypot(dx, dz);
    const aimError = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - entry.heading), Math.cos(Math.atan2(dx, dz) - entry.heading)));
    const wantSize = byLevel(entry, 0.42, 0.6, 0.6);
    const tolerance = byLevel(entry, 0.45, 0.38, 0.24);
    // Der starke wirft aus der Nähe: gemessen die wirksamste Einzelsache.
    const reach = byLevel(entry, 4.8, 4.4, 3.4);
    if (entry.size >= wantSize && dist < reach && aimError < tolerance && now - entry.lastThrowAt > SNOW_THROW_COOLDOWN_MS) {
      return { action: "throw" };
    }
    // Die Kugel wachsen lassen: auf Abstand um den Gegner kreisen, bis sie
    // gross genug ist — dann auf ihn zu drehen.
    if (entry.size < wantSize) {
      const around = Math.atan2(dx, dz) + Math.PI / 2 * (entry.botSide || (entry.botSide = Math.random() < 0.5 ? 1 : -1));
      const keep = dist < 2.2 ? -0.6 : dist > 3.6 ? 0.6 : 0;
      return { action: "steer", x: Math.sin(around) + (dx / Math.max(0.01, dist)) * keep, y: Math.cos(around) + (dz / Math.max(0.01, dist)) * keep };
    }
    const wobble = byLevel(entry, 0.35, 0.15, 0.04) * (Math.random() * 2 - 1);
    const aim = Math.atan2(dx, dz) + wobble;
    return { action: "steer", x: Math.sin(aim) * 0.6, y: Math.cos(aim) * 0.6 };
}


// --- Luftpuck --------------------------------------------------------------
//
// Airhockey, zwei gegen zwei. Jeder steht auf einer Schwebescheibe und bleibt
// in seiner Hälfte; der Puck gleitet fast ohne Reibung und prallt von den
// Banden ab. Das eigene Tor liegt für Team 0 vorn (zur Kamera), für Team 1
// hinten. Wer zuerst fünf Tore hat, gewinnt — sonst nach Ablauf der Zeit.
//
// Ein Einzelner gegen zwei bekommt eine grössere Scheibe; wer allein spielt,
// hat einen Torwart-Roboter gegen sich.
//
// Im Zweierteam hat jeder seine Zone: der Sturm vorn an der Mittellinie, die
// Abwehr hinten vor dem Tor, dazwischen ein Stück, das beide erreichen.
// Ohne Zonen stellten sich gemessen beide vor das eigene Tor — das schlug zwei
// starke Bots in zwei von drei Spielen, und es fiel kaum ein Tor.
//
// Gerechnet wird in festen Schritten auf einer eigenen Uhr (hockeyClock);
// Anstoss und Freiblasen kommen aus dem Seed statt aus dem Zufall. So rechnet
// das Gerät genau dasselbe voraus (Puckbahn.js) — die eigene Scheibe folgt dem
// Daumen, nicht eine Rundreise später.
const HOCKEY_W = 4.4;                  // Tischbreite
const HOCKEY_L = 7.4;                  // Tischlänge
const HOCKEY_GOAL = 2.2;               // Torbreite
// Zwei gegen zwei stehen vier Scheiben auf dem Tisch, zwei davon vor jedem
// Tor — die decken 2.2 Breite fast ganz ab. Gemessen fielen in 46 Sekunden
// oft nur ein oder zwei Tore, viele davon Eigentore. Mit vollen Teams ist das
// Tor deshalb breiter.
const HOCKEY_GOAL_TEAMS = 2.9;
const HOCKEY_DURATION_MS = 46000;
const HOCKEY_WIN = 5;
const HOCKEY_MALLET_R = 0.36;
const HOCKEY_SOLO_R = 0.48;
const HOCKEY_PUCK_R = 0.22;
const HOCKEY_SPEED = 4.3;
const HOCKEY_ACCEL = 16;
const HOCKEY_PUCK_DAMP = 0.18;         // der Puck gleitet fast frei
const HOCKEY_PUCK_MAX = 9.5;
const HOCKEY_WALL_REST = 0.9;
const HOCKEY_HIT_REST = 0.85;
const HOCKEY_PUSH = 0.35;              // so viel vom Schwung der Scheibe geht in den Puck
const HOCKEY_SERVE_MS = 1300;          // Pause nach einem Tor
const HOCKEY_STEP_MS = 30;             // Rechenschritt, wie STEP_MS in Puckbahn.js
const HOCKEY_SUBSTEPS = 5;             // Teilschritte je Rechenschritt (6 ms)
const HOCKEY_CATCHUP_MS = 250;         // hängt der Server, holt er höchstens so viel nach
const HOCKEY_STUCK_MS = 1500;          // so lange darf der Puck festhängen
const HOCKEY_LANE_STURM = 2.4;         // so weit hinter die Mittellinie darf der Sturm
const HOCKEY_LANE_ABWEHR = 1.4;        // so nah an die Mittellinie darf die Abwehr
const HOCKEY_ROBOT = "robot";

// Die Regeln, wie das Gerät sie braucht (Puckbahn.js liest arcade.hockeyRules).
const HOCKEY_RULES = {
  w: HOCKEY_W, l: HOCKEY_L, puckR: HOCKEY_PUCK_R, malletR: HOCKEY_MALLET_R, speed: HOCKEY_SPEED,
  accel: HOCKEY_ACCEL, damp: HOCKEY_PUCK_DAMP, max: HOCKEY_PUCK_MAX, wallRest: HOCKEY_WALL_REST,
  hitRest: HOCKEY_HIT_REST, push: HOCKEY_PUSH, serveMs: HOCKEY_SERVE_MS, stepMs: HOCKEY_STEP_MS,
  substeps: HOCKEY_SUBSTEPS, stuckMs: HOCKEY_STUCK_MS, laneSturm: HOCKEY_LANE_STURM, laneAbwehr: HOCKEY_LANE_ABWEHR
};

function hockeyLimits(side, r, lane = null) {
  // Team 0 unten (z > 0), Team 1 oben (z < 0); die Mittellinie ist die Grenze.
  let zMin = side === 0 ? 0.12 + r : -HOCKEY_L / 2 + r;
  let zMax = side === 0 ? HOCKEY_L / 2 - r : -0.12 - r;
  if (lane === "sturm") {
    if (side === 0) zMax = Math.min(zMax, HOCKEY_LANE_STURM);
    else zMin = Math.max(zMin, -HOCKEY_LANE_STURM);
  } else if (lane === "abwehr") {
    if (side === 0) zMin = Math.max(zMin, HOCKEY_LANE_ABWEHR);
    else zMax = Math.min(zMax, -HOCKEY_LANE_ABWEHR);
  }
  return { xMin: -HOCKEY_W / 2 + r, xMax: HOCKEY_W / 2 - r, zMin, zMax };
}

function hockeyServe(state, towardSide, now) {
  state.puck = { x: 0, z: 0, vx: 0, vz: 0 };
  state.serveAt = now + HOCKEY_SERVE_MS;
  state.serveToward = towardSide;
  state.served = false;
  state.lastTouch = null;
  state.lastInbound = false;
  state.lastBy = [null, null];
  state.stuck = null;
}

// Die Scheiben in fester Reihenfolge (arcade.order), der Roboter zuletzt.
function hockeyMallets(arcade, room) {
  const present = new Set(room.players.map((player) => player.id));
  const mallets = (arcade.order || room.players.map((player) => player.id))
    .filter((id) => present.has(id) && arcade.players[id])
    .map((id) => ({ id, e: arcade.players[id], robot: false }));
  if (arcade.hockey.robot) mallets.push({ id: HOCKEY_ROBOT, e: arcade.hockey.robot, robot: true });
  return mallets;
}

// Ein Rechenschritt (30 ms in fünf Teilschritten). `now` ist die Zeit am Ende
// des Schritts. Genau so in Puckbahn.js (stepHockey) — ein Test hält beide
// gleich.
function hockeyStep(state, mallets, now, seed) {
  const dt = HOCKEY_STEP_MS / 1000 / HOCKEY_SUBSTEPS;
  const serving = now < state.serveAt;
  if (!serving && !state.served) {
    // Anstoss: der Puck rutscht langsam zu dem Team, das das Tor kassiert hat.
    state.served = true;
    state.puck.vz = (state.serveToward === 0 ? 1 : -1) * 1.1;
    state.puck.vx = (noise(seed + state.goals.length * 7 + 3) - 0.5) * 0.6;
  }
  // Der Roboter hält die Mitte seines Tores und schiebt, was kommt, zurück.
  if (state.robot) {
    const p = state.puck;
    const tx = clamp(p.x * 0.7, -state.goalW / 2, state.goalW / 2);
    const tz = p.z < -0.6 && p.vz < 0.5 ? p.z - 0.2 : -HOCKEY_L / 2 + 0.9;
    const dx = tx - state.robot.x;
    const dz = tz - state.robot.z;
    const d = Math.hypot(dx, dz);
    state.robot.dirX = d > 0.05 ? (dx / d) * Math.min(1, d * 2) * 0.55 : 0;
    state.robot.dirZ = d > 0.05 ? (dz / d) * Math.min(1, d * 2) * 0.55 : 0;
  }
  const limitsOf = (m) => hockeyLimits(m.robot ? 1 : m.e.side, m.e.r, m.robot ? null : m.e.lane);
  for (let sub = 0; sub < HOCKEY_SUBSTEPS; sub += 1) {
    mallets.forEach((m) => {
      const e = m.e;
      const speed = HOCKEY_SPEED * (e.r > HOCKEY_MALLET_R ? 1.08 : 1);
      const k = Math.min(1, HOCKEY_ACCEL * dt);
      e.vx += ((e.dirX || 0) * speed - e.vx) * k;
      e.vz += ((e.dirZ || 0) * speed - e.vz) * k;
      const lim = limitsOf(m);
      const nx = clamp(e.x + e.vx * dt, lim.xMin, lim.xMax);
      const nz = clamp(e.z + e.vz * dt, lim.zMin, lim.zMax);
      // Tatsächliche Geschwindigkeit (nach der Bande) — die gibt den Stoss.
      e.mvx = (nx - e.x) / dt;
      e.mvz = (nz - e.z) / dt;
      e.x = nx;
      e.z = nz;
    });
    // Scheiben schieben sich auseinander — und bleiben dabei in ihrer Zone.
    for (let a = 0; a < mallets.length; a += 1) {
      for (let b = a + 1; b < mallets.length; b += 1) {
        const one = mallets[a].e;
        const two = mallets[b].e;
        const dx = two.x - one.x;
        const dz = two.z - one.z;
        const dist = Math.hypot(dx, dz);
        const min = one.r + two.r;
        if (dist >= min || dist < 1e-6) continue;
        const push = (min - dist) / 2;
        const la = limitsOf(mallets[a]);
        const lb = limitsOf(mallets[b]);
        one.x = clamp(one.x - (dx / dist) * push, la.xMin, la.xMax);
        one.z = clamp(one.z - (dz / dist) * push, la.zMin, la.zMax);
        two.x = clamp(two.x + (dx / dist) * push, lb.xMin, lb.xMax);
        two.z = clamp(two.z + (dz / dist) * push, lb.zMin, lb.zMax);
      }
    }
    if (serving) continue;
    const p = state.puck;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    // Puck gegen Scheiben.
    mallets.forEach(({ id, e }) => {
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const dist = Math.hypot(dx, dz);
      const min = e.r + HOCKEY_PUCK_R;
      if (dist >= min || dist < 1e-6) return;
      const nx = dx / dist;
      const nz = dz / dist;
      // Kam der Puck gerade aufs eigene Tor dieser Scheibe zu? Dann ist die
      // Berührung ein Abfälschen — siehe unten beim Tor.
      const inbound = id !== HOCKEY_ROBOT && p.vz * (e.side === 0 ? 1 : -1) > 0.5;
      p.x = e.x + nx * min;
      p.z = e.z + nz * min;
      const rvx = p.vx - (e.mvx || 0);
      const rvz = p.vz - (e.mvz || 0);
      const vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        p.vx -= (1 + HOCKEY_HIT_REST) * vn * nx;
        p.vz -= (1 + HOCKEY_HIT_REST) * vn * nz;
      }
      // Wer die Scheibe in den Puck schiebt, gibt Schwung mit — aber nur in
      // Stossrichtung. Vorher bekam der Puck den Schwung der Scheibe auch, wenn
      // sie gerade zurückwich: ein Verteidiger, der zum Tor zurückfuhr, schob
      // den Puck selbst hinein. Gemessen war jedes zweite Tor ein Eigentor.
      const into = (e.mvx || 0) * nx + (e.mvz || 0) * nz;
      if (into > 0) {
        p.vx += nx * into * HOCKEY_PUSH;
        p.vz += nz * into * HOCKEY_PUSH;
      }
      if (id !== HOCKEY_ROBOT && now - (e.lastTouchAt || 0) > 150) {
        e.touches = (e.touches || 0) + 1;
        e.lastTouchAt = now;
        state.touches += 1;
      }
      state.lastTouch = id;
      state.lastInbound = inbound;
      if (id !== HOCKEY_ROBOT) {
        state.lastBy ||= [null, null];
        state.lastBy[e.side] = { id, at: now };
      }
    });
    const speed = Math.hypot(p.vx, p.vz);
    if (speed > HOCKEY_PUCK_MAX) {
      p.vx *= HOCKEY_PUCK_MAX / speed;
      p.vz *= HOCKEY_PUCK_MAX / speed;
    }
    // Banden. An den Stirnseiten ist in der Mitte das Tor offen.
    const halfW = HOCKEY_W / 2 - HOCKEY_PUCK_R;
    const halfL = HOCKEY_L / 2 - HOCKEY_PUCK_R;
    if (Math.abs(p.x) > halfW) { p.x = Math.sign(p.x) * halfW; p.vx = -p.vx * HOCKEY_WALL_REST; }
    const inMouth = Math.abs(p.x) < state.goalW / 2 - HOCKEY_PUCK_R * 0.4;
    if (Math.abs(p.z) > halfL && !inMouth) { p.z = Math.sign(p.z) * halfL; p.vz = -p.vz * HOCKEY_WALL_REST; }
    // Hat die Bande den Puck zurück in eine Scheibe geschoben (in der Ecke
    // eingekeilt), weicht die Scheibe — der Puck kann nicht in die Wand.
    mallets.forEach((m) => {
      const e = m.e;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const dist = Math.hypot(dx, dz);
      const min = e.r + HOCKEY_PUCK_R;
      if (dist >= min) return;
      const nx = dist < 1e-6 ? -Math.sign(p.x || 1) : dx / dist;
      const nz = dist < 1e-6 ? -Math.sign(p.z || 1) : dz / dist;
      const lim = limitsOf(m);
      e.x = clamp(p.x + nx * min, lim.xMin, lim.xMax);
      e.z = clamp(p.z + nz * min, lim.zMin, lim.zMax);
    });
    if (Math.abs(p.z) > HOCKEY_L / 2 + HOCKEY_PUCK_R) {
      // Tor! Vorn (z > 0) ist das Tor von Team 0 — getroffen hat Team 1.
      const scoringSide = p.z > 0 ? 1 : 0;
      state.score[scoringSide] += 1;
      const touched = mallets.find((m) => m.id === state.lastTouch && !m.robot);
      let shooter = touched ? touched.e : null;
      let by = shooter ? state.lastTouch : null;
      // Abgefälscht: kam der Puck schon aufs Tor zu und hatte ihn kurz vorher
      // ein Gegner gespielt, ist es dessen Tor, kein Eigentor. Gemessen war
      // das häufigste „Eigentor" ein Schuss, der den stehenden Verteidiger nur
      // streifte.
      const attacker = state.lastBy?.[scoringSide];
      if (shooter && shooter.side !== scoringSide && state.lastInbound && attacker && now - attacker.at < 2000) {
        const found = mallets.find((m) => m.id === attacker.id);
        if (found) {
          shooter = found.e;
          by = attacker.id;
        }
      }
      if (shooter) {
        if (shooter.side === scoringSide) shooter.goals = (shooter.goals || 0) + 1;
        else shooter.ownGoals = (shooter.ownGoals || 0) + 1;
      }
      const own = Boolean(shooter && shooter.side !== scoringSide);
      state.goals.push({ side: scoringSide, by: own ? null : by, at: now, x: p.x, own });
      hockeyServe(state, 1 - scoringSide, now);
      break;
    }
  }
  // Festgeklemmt? Kommt der Puck anderthalb Sekunden lang nicht vom Fleck —
  // in einer Ecke eingekeilt oder still liegend —, bläst der Tisch ihn zur
  // Mitte. In der ersten Fassung lag er dort zwanzig Sekunden lang, während
  // eine Scheibe ihn gegen die Bande drückte.
  const p = state.puck;
  if (now < state.serveAt) {
    state.stuck = null;
  } else if (!state.stuck || Math.hypot(p.x - state.stuck.x, p.z - state.stuck.z) > 0.45) {
    state.stuck = { x: p.x, z: p.z, at: now };
  } else if (now - state.stuck.at > HOCKEY_STUCK_MS) {
    state.nudges = (state.nudges || 0) + 1;
    p.vx = -Math.sign(p.x || 0.01) * 2.2 + (noise(seed + state.nudges * 13) - 0.5) * 0.6;
    p.vz = -Math.sign(p.z || 0.01) * 2.8;
    state.nudgeAt = now;
    state.stuck = { x: p.x, z: p.z, at: now };
  }
  const exp = Math.exp(-HOCKEY_PUCK_DAMP * (HOCKEY_STEP_MS / 1000));
  p.vx *= exp;
  p.vz *= exp;
}

const hockey = {
  cooldown: 0,
  fastHand: true,
  create(arcade, players) {
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      entry.side = players.length === 1 ? 0 : index % 2;
    });
    const sizes = [0, 1].map((side) => Object.values(arcade.players).filter((e) => e.side === side).length);
    const robot = players.length === 1;
    arcade.hockey = {
      w: HOCKEY_W,
      l: HOCKEY_L,
      goalW: Math.min(...sizes) >= 2 ? HOCKEY_GOAL_TEAMS : HOCKEY_GOAL,
      puckR: HOCKEY_PUCK_R,
      score: [0, 0],
      win: HOCKEY_WIN,
      goals: [],                       // { side, by, at }
      puck: { x: 0, z: 0, vx: 0, vz: 0 },
      serveAt: 0,
      serveToward: 0,
      served: false,
      lastTouch: null,
      touches: 0,
      nudges: 0,
      stuck: null,
      robot: robot ? { x: 0, z: -HOCKEY_L / 2 + 0.9, vx: 0, vz: 0, r: HOCKEY_MALLET_R } : null
    };
    arcade.hockeyRules = { ...HOCKEY_RULES };
    arcade.order = players.map((player) => player.id);
    arcade.hockeyClock = arcade.startedAt || 0;
    const team = [[], []];
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const r = sizes[entry.side] < Math.max(...sizes) ? HOCKEY_SOLO_R : HOCKEY_MALLET_R;
      const slot = team[entry.side].length;
      team[entry.side].push(player.id);
      const count = sizes[entry.side];
      const x = count > 1 ? (slot === 0 ? -0.9 : 0.9) : 0;
      const z = (entry.side === 0 ? 1 : -1) * (count > 1 && slot === 1 ? 2.6 : 1.8);
      const role = slot === 0 ? "sturm" : "abwehr";
      Object.assign(entry, { x, z, vx: 0, vz: 0, dirX: 0, dirZ: 0, r, role, lane: count > 1 ? role : null, goals: 0, ownGoals: 0, touches: 0, lastTouchAt: 0, score: 0 });
    });
    hockeyServe(arcade.hockey, 0, arcade.startedAt);
  },
  input(ctx, player, entry, input) {
    if (input.action !== "steer") return { ok: false, error: "Lenke mit dem Stick." };
    const x = inputNumber(input.x);
    const y = inputNumber(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Ungültige Richtung." };
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    entry.dirX = x * k;
    entry.dirZ = y * k;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, now } = ctx;
    const state = arcade.hockey;
    arcade.lastUpdateAt = now;
    if (!arcade.hockeyClock) arcade.hockeyClock = now;
    if (now - arcade.hockeyClock > HOCKEY_CATCHUP_MS) arcade.hockeyClock = now - HOCKEY_CATCHUP_MS;
    const mallets = hockeyMallets(arcade, room);
    while (arcade.hockeyClock + HOCKEY_STEP_MS <= now) {
      arcade.hockeyClock += HOCKEY_STEP_MS;
      hockeyStep(state, mallets, arcade.hockeyClock, arcade.seed || 0);
    }
    // Was die Bots „gesehen" haben: der Puck von vor ein paar Zehnteln. Ohne
    // diese Verzögerung stand der Torwart-Bot immer schon dort, wo der Schuss
    // hinging, und es fiel kaum ein Tor.
    const p = state.puck;
    state.history ||= [];
    state.history.push({ t: now, x: p.x, z: p.z, vx: p.vx, vz: p.vz });
    while (state.history.length > 12) state.history.shift();
    mallets.forEach(({ e, robot }) => { if (!robot) e.score = state.score[e.side]; });
  },
  bot(ctx, player, entry) {
    const { arcade, room, now } = ctx;
    const state = arcade.hockey;
    const p = state.puck;
    const side = entry.side;
    const ownGoalZ = side === 0 ? HOCKEY_L / 2 : -HOCKEY_L / 2;
    const attackDir = side === 0 ? -1 : 1;           // Richtung zum gegnerischen Tor
    const inOwnHalf = side === 0 ? p.z > 0 : p.z < 0;
    const mates = room.players.filter((pl) => pl.id !== player.id && arcade.players[pl.id]?.side === side);
    const defender = mates.length > 0 && entry.role === "abwehr";
    // Wie gut der Bot den Puck vorausberechnet und wie schnell er reagiert.
    // Der starke schaute früher 0.3 s voraus und zielte knapp an den Pfosten:
    // er traf seltener als der mittlere und schoss die meisten Abpraller ins
    // eigene Tor — sein Team verlor sogar gegen zwei mittlere. Sein Vorsprung
    // liegt jetzt in Reaktion und Genauigkeit, nicht in Wagemut.
    // Blick und Verzögerung zusammen sollen beim Puck von JETZT landen: der
    // starke sieht ihn frischer (130 statt 240 ms), also schaut er weniger weit
    // voraus. Mit 0.2 s zielte er ein Zehntel zu weit und verlor gegen zwei
    // mittlere 26 zu 55.
    const look = byLevel(entry, 0.05, 0.18, 0.1);
    const sloppy = byLevel(entry, 0.35, 0.16, 0.05);
    const lag = byLevel(entry, 380, 240, 130);
    const seen = (state.history || []).find((h) => h.t >= now - lag) || p;
    // Vorausberechnet MIT Bande: geradeaus gerechnet lag der Punkt nach einem
    // Abpraller jenseits der Wand, und gerade der starke Bot mit dem weitesten
    // Blick stand dann am falschsten Fleck.
    const halfW = HOCKEY_W / 2 - HOCKEY_PUCK_R;
    let px = seen.x + seen.vx * look;
    if (Math.abs(px) > halfW) px = Math.sign(px) * (2 * halfW - Math.abs(px) * HOCKEY_WALL_REST);
    px = clamp(px, -halfW, halfW);
    const pz = clamp(seen.z + seen.vz * look, -HOCKEY_L / 2, HOCKEY_L / 2);
    let tx;
    let tz;
    const lim = hockeyLimits(side, entry.r, entry.lane);
    const oppGoalZ = -ownGoalZ;
    const nearOwnGoal = Math.abs(pz - ownGoalZ) < 2.2;
    // Im Zweierteam schlägt, wer den Puck in seiner Zone hat (knapp daneben
    // reicht, die Scheibe hat Reichweite); allein schlägt man überall.
    const reach = entry.r + HOCKEY_PUCK_R + 0.15;
    const reachable = pz >= lim.zMin - reach && pz <= lim.zMax + reach;
    const strike = entry.lane ? reachable : (!defender || nearOwnGoal);
    if (inOwnHalf && strike) {
      // Schlagen: sich HINTER den Puck stellen — hinter heisst: auf der Linie
      // vom Zielpunkt im gegnerischen Tor durch den Puck — und durchziehen.
      // Der starke zielt in die Hälfte, die der gegnerische Torwart gerade
      // nicht deckt; der schwache schiesst geradeaus. Wer auf der falschen Seite
      // steht, geht aussen herum, statt den Puck ins eigene Tor zu schieben.
      const keepers = room.players.map((pl) => arcade.players[pl.id]).filter((e) => e && e.side !== side);
      if (state.robot) keepers.push(state.robot);
      const keeperX = keepers.length ? keepers.reduce((a, b) => (Math.abs(b.z - oppGoalZ) < Math.abs(a.z - oppGoalZ) ? b : a)).x : 0;
      const gx = byLevel(entry, 0, 0.45, 0.5) * (state.goalW / 2) * (keeperX > 0 ? -1 : 1);
      let ax = gx - px;
      let az = oppGoalZ - pz;
      const al = Math.hypot(ax, az) || 1;
      ax /= al;
      az /= al;
      const reachBack = entry.r + HOCKEY_PUCK_R + 0.12;
      const bx = px - ax * reachBack;
      const bz = pz - az * reachBack;
      const toB = Math.hypot(entry.x - bx, entry.z - bz);
      const ahead = (entry.x - px) * ax + (entry.z - pz) * az;
      if (toB < 0.3) {
        tx = px + ax * 0.6;
        tz = pz + az * 0.6;
      } else if (ahead > -0.05) {
        // Auf der falschen Seite: erst seitlich weg, dann zurück — nie schräg
        // rückwärts am Puck vorbei. Schräg erwischte der Bot den Puck von vorn
        // und schob ihn ins eigene Tor; der schnell reagierende starke Bot
        // traf gemessen zwanzigmal öfter das eigene Tor als das gegnerische.
        const clear = reachBack + 0.3;
        let sideX = entry.x >= px ? 1 : -1;
        if (Math.abs(px + sideX * clear) > HOCKEY_W / 2 - entry.r) sideX = -sideX;
        tx = px + sideX * clear;
        tz = Math.abs(entry.x - px) < clear - 0.08 ? entry.z : clamp(bz, lim.zMin, lim.zMax);
      } else {
        tx = bx;
        tz = bz;
      }
    } else {
      // Decken: zwischen Puck und eigenem Tor, näher am Tor — im Zweierteam
      // jeder in seiner Zone.
      const share = entry.lane === "sturm" ? 0.6 : defender ? 0.28 : 0.45;
      tx = clamp(px * 0.8, -state.goalW / 2 - 0.2, state.goalW / 2 + 0.2);
      tz = ownGoalZ + (pz - ownGoalZ) * share;
    }
    tx = clamp(tx + (Math.random() - 0.5) * sloppy, lim.xMin, lim.xMax);
    tz = clamp(tz + (Math.random() - 0.5) * sloppy, lim.zMin, lim.zMax);
    const dx = tx - entry.x;
    const dz = tz - entry.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return { action: "steer", x: 0, y: 0 };
    const gain = Math.min(1, d * byLevel(entry, 1.4, 2.2, 3.2));
    return { action: "steer", x: (dx / d) * gain, y: (dz / d) * gain };
  },
  rank(arcade, entry) {
    const score = arcade.hockey?.score || [0, 0];
    const own = score[entry.side] || 0;
    // Tore und Kontakte sind Beiträge zum selben Teamsieg, keine Einzelplätze.
    return own;
  },
  detail(arcade, entry) {
    return { kind: "points", value: arcade.hockey?.score?.[entry.side] || 0, label: "Tore" };
  },
  done(ctx) {
    const score = ctx.arcade.hockey.score;
    return score[0] >= HOCKEY_WIN || score[1] >= HOCKEY_WIN;
  }
};


// --- Bücherwurm ------------------------------------------------------------
//
// Alle stehen auf der aufgeschlagenen Seite eines Riesenbuchs. Hinten richtet
// sich die nächste Seite auf und klappt nach vorn — in ihr sind Löcher
// ausgeschnitten: Rechtecke, Kreise, Rauten, Dreiecke, Plus, Sterne,
// Sechsecke. Die Seite bleibt liegen, und hinten wartet schon die nächste.
// Wer beim Aufschlagen unter keinem Loch steht, wird platt gedrückt und ist
// raus. Die Löcher werden weniger und kleiner, die Seiten kommen schneller;
// gewertet werden die überstandenen Seiten.
//
// Gerechnet wird in festen Schritten auf einer eigenen Uhr (bookClock), und
// das Anlaufen ist exakt gelöst: so rechnet das Gerät genau dasselbe voraus
// (Buchseite.js) und zeigt Figur und Seite zu der Zeit, zu der ein jetzt
// geschickter Stick ankommt — was man im Moment des Aufschlags sieht, ist
// das, was der Server wertet. Die Löcher einer Seite kennt das Gerät erst
// kurz vorher (arcade.secret), nicht die ganze Runde im Voraus.
const BOOK_W = 6;
const BOOK_D = 7.6;
const BOOK_DURATION_MS = 42000;
const BOOK_FIRST_MS = 2200;
const BOOK_GAP_START = 3700;
const BOOK_GAP_END = 2500;
const BOOK_FLIP_START = 1900;          // so lange klappt die Seite heran
const BOOK_FLIP_END = 1150;
const BOOK_LIVES = 1;                  // einmal platt, und man ist raus
const BOOK_FLAT_MS = 1500;
const BOOK_SPEED = 3.4;
const BOOK_ACCEL = 14;
const BOOK_BODY = 0.3;
const BOOK_BUMP = 0.64;
const BOOK_INSIDE = 0.1;               // so weit muss die Mitte im Loch liegen
const BOOK_STEP_MS = 30;               // Rechenschritt, wie STEP_MS in Buchseite.js
const BOOK_CATCHUP_MS = 250;           // hängt der Server, holt er höchstens so viel nach
// Rundreise (bis 250 ms, wie das Gerät sie deckelt) plus ein Servertakt.
const BOOK_PUBLISH_LEAD_MS = 350;

// Die Regeln, wie das Gerät sie braucht (Buchseite.js liest arcade.bookRules).
const BOOK_RULES = {
  w: BOOK_W, d: BOOK_D, speed: BOOK_SPEED, accel: BOOK_ACCEL, body: BOOK_BODY, bump: BOOK_BUMP,
  inside: BOOK_INSIDE, flatMs: BOOK_FLAT_MS, stepMs: BOOK_STEP_MS
};

// Lochformen. `grow`: um so viel ist der Rahmen grösser als beim Rechteck,
// damit in jede Form ungefähr gleich viel Platz zum Stehen bleibt. `round`:
// gleich breit wie tief. `area`: Anteil am Rahmen (für die Bots).
const BOOK_SHAPES = {
  rect: { grow: 1, round: false, area: 1 },
  circle: { grow: 1.12, round: true, area: 0.78 },
  hexagon: { grow: 1.12, round: true, area: 0.75 },
  diamond: { grow: 1.32, round: false, area: 0.5 },
  triangle: { grow: 1.4, round: false, area: 0.5 },
  plus: { grow: 1.28, round: true, area: 0.56 },
  star: { grow: 1.5, round: true, area: 0.38 }
};
const BOOK_SHAPES_EARLY = ["rect", "circle", "rect", "hexagon"];
const BOOK_SHAPES_ALL = Object.keys(BOOK_SHAPES);
// Wo nur noch ein Loch bleibt, keine Zacken: der Stern liesse dann kaum Platz.
const BOOK_SHAPES_LAST = ["rect", "circle", "hexagon", "plus", "diamond"];

// Die Eckpunkte einer Lochform um (x, z) im Rahmen w × d, auf Zentimeter
// gerundet. Die Mitte des Rahmens liegt bei jeder Form tief im Loch.
function bookHolePoints(shape, x, z, w, d, flip = 1) {
  const hw = w / 2;
  const hd = d / 2;
  let unit;
  if (shape === "circle") unit = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)]);
  else if (shape === "hexagon") unit = Array.from({ length: 6 }, (_, i) => [Math.cos((i / 6) * Math.PI * 2), Math.sin((i / 6) * Math.PI * 2)]);
  else if (shape === "diamond") unit = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  else if (shape === "triangle") unit = [[0, -flip], [1, flip], [-1, flip]];
  else if (shape === "plus") {
    const a = 0.36;
    unit = [[-a, -1], [a, -1], [a, -a], [1, -a], [1, a], [a, a], [a, 1], [-a, 1], [-a, a], [-1, a], [-1, -a], [-a, -a]];
  } else if (shape === "star") {
    unit = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 0.5 : 1;
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      return [Math.cos(a) * r, Math.sin(a) * r * flip];
    });
  } else unit = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return unit.map(([u, v]) => [Math.round((x + u * hw) * 100) / 100, Math.round((z + v * hd) * 100) / 100]);
}

function buildBookPages(seed, durationMs = BOOK_DURATION_MS) {
  const pages = [];
  let at = BOOK_FIRST_MS;
  let index = 0;
  while (true) {
    const progress = clamp(at / durationMs, 0, 1);
    const flip = Math.round(BOOK_FLIP_START + (BOOK_FLIP_END - BOOK_FLIP_START) * progress);
    if (at + flip > durationMs - 700) break;
    const count = index < 2 ? 4 : index < 5 ? 3 : index < 8 ? 2 : 1;
    const holes = [];
    const size = 1 - progress * 0.4;
    const pool = index === 0 ? BOOK_SHAPES_EARLY : count === 1 ? BOOK_SHAPES_LAST : BOOK_SHAPES_ALL;
    for (let h = 0; h < count; h += 1) {
      const shape = pool[Math.floor(noise(seed + index * 37 + h * 11 + 1) * pool.length) % pool.length];
      const look = BOOK_SHAPES[shape];
      for (let tries = 0; tries < 30; tries += 1) {
        const k = seed + index * 101 + h * 13 + tries * 7;
        let w = Math.round(((1.15 + noise(k) * 0.55) * size * look.grow + 0.2) * 100) / 100;
        let d = Math.round(((1.15 + noise(k + 3) * 0.55) * size * look.grow + 0.2) * 100) / 100;
        if (look.round) w = d = Math.round(((w + d) / 2) * 100) / 100;
        const x = Math.round(((noise(k + 5) - 0.5) * (BOOK_W - w - 0.6)) * 100) / 100;
        const z = Math.round(((noise(k + 9) - 0.5) * (BOOK_D - d - 0.8)) * 100) / 100;
        const clash = holes.some((o) => Math.abs(o.x - x) < (o.w + w) / 2 + 0.4 && Math.abs(o.z - z) < (o.d + d) / 2 + 0.4);
        if (!clash) {
          const turn = noise(k + 17) < 0.5 ? 1 : -1;
          holes.push({ x, z, w, d, shape, pts: bookHolePoints(shape, x, z, w, d, turn) });
          break;
        }
      }
    }
    pages.push({ index, at, slamAt: at + flip, flip, holes });
    const gap = BOOK_GAP_START + (BOOK_GAP_END - BOOK_GAP_START) * progress;
    at += Math.round(Math.max(flip + 700, gap));
    index += 1;
  }
  return pages;
}

// Steht die Mitte einer Figur in diesem Loch — und zwar mindestens
// BOOK_INSIDE weit von jeder Kante? Für Rechtecke ist das genau die alte
// Regel |dx| ≤ w/2 − innen, |dz| ≤ d/2 − innen. Genau so in Buchseite.js.
function bookInShape(hole, x, z) {
  const pts = hole.pts;
  if (!pts || pts.length < 3) return Math.abs(x - hole.x) <= hole.w / 2 - BOOK_INSIDE && Math.abs(z - hole.z) <= hole.d / 2 - BOOK_INSIDE;
  let inside = false;
  let near = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [ax, az] = pts[j];
    const [bx, bz] = pts[i];
    if ((bz > z) !== (az > z) && x < ((ax - bx) * (z - bz)) / (az - bz) + bx) inside = !inside;
    const ex = bx - ax;
    const ez = bz - az;
    const t = clamp(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1), 0, 1);
    near = Math.min(near, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return inside && near >= BOOK_INSIDE - 1e-9;
}

function bookInHole(page, x, z) {
  return (page.holes || []).some((h) => bookInShape(h, x, z));
}

function bookSpawn(index) {
  return [[-1.4, 1.6], [1.4, 1.6], [-1.4, -1.2], [1.4, -1.2]][index % 4];
}

// Was die Geräte vom Blätterplan sehen: Zeiten immer, die Löcher erst kurz
// bevor die Seite sich aufrichtet.
function bookPublish(arcade, elapsed) {
  const full = arcade.secret.bookPages;
  arcade.book.pages.forEach((shown, i) => {
    if (shown.holes || elapsed < shown.at - BOOK_PUBLISH_LEAD_MS) return;
    shown.holes = full[i].holes.map((hole) => ({ ...hole, pts: hole.pts?.map((p) => [...p]) }));
  });
}

// Anlaufen exakt gelöst (wie snowEase): unabhängig davon, wie der Schritt
// zerlegt wird.
function bookEase(v, target, rate, dt) {
  const fade = Math.exp(-rate * dt);
  return { v: target + (v - target) * fade, d: target * dt + (v - target) * (1 - fade) / rate };
}

// Ein Rechenschritt. `pages`: der ganze Blätterplan (mit Löchern), `entries`:
// [{ id, entry }] in der Reihenfolge arcade.order, `now` die Serverzeit am Ende
// des Schritts. Genau so in Buchseite.js (stepBook) — ein Test hält beide
// gleich.
function bookStep(state, pages, entries, dt, now, startedAt) {
  const halfW = BOOK_W / 2 - BOOK_BODY;
  const halfD = BOOK_D / 2 - BOOK_BODY;
  const elapsed = now - startedAt;
  entries.forEach(({ entry }) => {
    const stuck = entry.outAt || now < entry.flatUntil;
    const gx = bookEase(entry.vx, stuck ? 0 : entry.dirX * BOOK_SPEED, BOOK_ACCEL, dt);
    const gz = bookEase(entry.vz, stuck ? 0 : entry.dirZ * BOOK_SPEED, BOOK_ACCEL, dt);
    entry.vx = gx.v;
    entry.vz = gz.v;
    const x = entry.x + gx.d;
    const z = entry.z + gz.d;
    entry.x = clamp(x, -halfW, halfW);
    entry.z = clamp(z, -halfD, halfD);
    if (x !== entry.x) entry.vx = 0;
    if (z !== entry.z) entry.vz = 0;
  });
  // Rempeln: wer im Loch steht, kann hinausgeschoben werden.
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a].entry;
      const two = entries[b].entry;
      if (one.outAt || two.outAt) continue;
      const dx = two.x - one.x;
      const dz = two.z - one.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= BOOK_BUMP || dist < 1e-6) continue;
      const push = (BOOK_BUMP - dist) / 2;
      one.x = clamp(one.x - (dx / dist) * push, -halfW, halfW);
      one.z = clamp(one.z - (dz / dist) * push, -halfD, halfD);
      two.x = clamp(two.x + (dx / dist) * push, -halfW, halfW);
      two.z = clamp(two.z + (dz / dist) * push, -halfD, halfD);
    }
  }
  // Seit wann steht man im Loch der Seite, die gerade herankommt? Das ist
  // die Feinwertung: wer gleich viele Seiten übersteht, den ordnet, wer
  // schneller in Deckung war. Vorher teilten sich in vier von zehn Runden
  // zwei den Sieg.
  const coming = pages.find((page) => page.index > state.slammed);
  if (coming && elapsed >= coming.at) {
    entries.forEach(({ entry }) => {
      if (entry.outAt) return;
      if (bookInHole(coming, entry.x, entry.z)) {
        if (entry.safeSince === null || entry.safeSince === undefined) entry.safeSince = elapsed;
      } else {
        entry.safeSince = null;
      }
    });
  }
  // Seiten schlagen auf.
  pages.forEach((page) => {
    if (page.index <= state.slammed || elapsed < page.slamAt) return;
    state.slammed = page.index;
    const hits = [];
    entries.forEach(({ id, entry }) => {
      if (entry.outAt) return;
      if (bookInHole(page, entry.x, entry.z)) {
        const since = entry.safeSince ?? page.slamAt;
        entry.safeMs = (entry.safeMs || 0) + clamp(since - page.at, 0, page.flip);
        entry.survived += 1;
      } else {
        entry.lives -= 1;
        entry.squashed += 1;
        entry.flatUntil = now + BOOK_FLAT_MS;
        hits.push(id);
        if (entry.lives <= 0) {
          entry.outAt = elapsed;
          entry.outMs = elapsed;
        }
      }
      entry.lastPage = page.index;
      entry.safeSince = null;
      entry.score = entry.survived;
    });
    state.lastHits = { page: page.index, ids: hits };
  });
}

const book = {
  cooldown: 0,
  fastHand: true,
  create(arcade, players) {
    const pages = buildBookPages(arcade.seed);
    arcade.secret = { ...(arcade.secret || {}), bookPages: pages };
    arcade.book = {
      w: BOOK_W,
      d: BOOK_D,
      pages: pages.map(({ index, at, slamAt, flip }) => ({ index, at, slamAt, flip, holes: null })),
      slammed: -1,                     // letzte ausgewertete Seite
      lastHits: null,                  // { page, ids } — wer bei ihr platt wurde
      lives: BOOK_LIVES,
      flatMs: BOOK_FLAT_MS
    };
    arcade.bookRules = { ...BOOK_RULES };
    arcade.order = players.map((player) => player.id);
    arcade.bookClock = arcade.startedAt || 0;
    bookPublish(arcade, 0);
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const [x, z] = bookSpawn(index);
      Object.assign(entry, { x, z, vx: 0, vz: 0, dirX: 0, dirZ: 0, lives: BOOK_LIVES, flatUntil: 0, survived: 0, squashed: 0, outAt: null, lastPage: -1, score: 0, safeSince: null, safeMs: 0 });
    });
  },
  input(ctx, player, entry, input) {
    if (input.action !== "steer") return { ok: false, error: "Lenke mit dem Stick." };
    const x = inputNumber(input.x);
    const y = inputNumber(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Ungültige Richtung." };
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    entry.dirX = x * k;
    entry.dirZ = y * k;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, now, minigame } = ctx;
    const state = arcade.book;
    const startedAt = minigame?.startedAt ?? arcade.startedAt ?? 0;
    arcade.lastUpdateAt = now;
    if (!arcade.bookClock) arcade.bookClock = now;
    if (now - arcade.bookClock > BOOK_CATCHUP_MS) arcade.bookClock = now - BOOK_CATCHUP_MS;
    const present = new Set(room.players.map((player) => player.id));
    const entries = (arcade.order || room.players.map((player) => player.id))
      .filter((id) => present.has(id) && arcade.players[id])
      .map((id) => ({ id, entry: arcade.players[id] }));
    while (arcade.bookClock + BOOK_STEP_MS <= now) {
      arcade.bookClock += BOOK_STEP_MS;
      bookStep(state, arcade.secret.bookPages, entries, BOOK_STEP_MS / 1000, arcade.bookClock, startedAt);
    }
    bookPublish(arcade, now - startedAt);
  },
  bot(ctx, player, entry) {
    const { arcade, room, now, elapsed } = ctx;
    if (entry.outAt || now < entry.flatUntil) return { action: "steer", x: 0, y: 0 };
    const state = arcade.book;
    const page = arcade.secret.bookPages.find((p) => p.index > state.slammed);
    const go = (tx, tz) => {
      const dx = tx - entry.x;
      const dz = tz - entry.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) return { action: "steer", x: 0, y: 0 };
      const gain = Math.min(1, d * 2.5);
      return { action: "steer", x: (dx / d) * gain, y: (dz / d) * gain };
    };
    // Zwischen den Seiten: der starke wartet in der Buchmitte — von dort ist
    // jedes Loch am schnellsten zu erreichen —, der mittlere oft, der
    // schwache selten.
    if (!page) return { action: "steer", x: 0, y: 0 };
    if (entry.botWaitPage !== page.index) {
      entry.botWaitPage = page.index;
      entry.botCenter = Math.random() < byLevel(entry, 0.25, 0.6, 1);
    }
    // Menschliche Reaktion: vorher reagierte der starke nach 180 ms und
    // gewann gemessen drei von vier Runden gegen jeden Menschen; der schwache
    // brauchte 750 ms und war in neun von zehn Runden raus.
    const react = byLevel(entry, 560, 470, 410);
    if (elapsed < page.at + react) {
      if (entry.botCenter) {
        const spot = byLevel(entry, 0, 0.35, 0.25);
        return go((Math.random() - 0.5) * spot, 0.2 + (Math.random() - 0.5) * spot);
      }
      return { action: "steer", x: 0, y: 0 };
    }
    if (entry.botPage !== page.index) {
      entry.botPage = page.index;
      // Welches Loch? Der schwache nimmt das nächste, der starke das beste:
      // nah genug und nicht schon besetzt.
      const others = room.players.filter((p) => p.id !== player.id).map((p) => arcade.players[p.id]).filter((e) => e && !e.outAt);
      const scored = page.holes.map((h, i) => {
        const dist = Math.hypot(h.x - entry.x, h.z - entry.z);
        const crowd = others.filter((o) => Math.hypot(o.x - h.x, o.z - h.z) < dist).length;
        const room2 = Math.max(0, Math.floor(Math.floor((h.w - 0.2) / 0.62) * Math.floor((h.d - 0.2) / 0.62) * (BOOK_SHAPES[h.shape]?.area ?? 1)));
        return { i, cost: dist + (level(entry) === "hard" ? Math.max(0, crowd - room2 + 1) * 2.5 : level(entry) === "normal" ? crowd * 0.8 : 0) };
      }).sort((a, b) => a.cost - b.cost);
      entry.botHole = scored[0]?.i ?? 0;
      entry.botJitter = { x: (Math.random() - 0.5) * byLevel(entry, 0.6, 0.35, 0.1), z: (Math.random() - 0.5) * byLevel(entry, 0.6, 0.35, 0.1) };
    }
    const hole = page.holes[entry.botHole] || page.holes[0];
    if (!hole) return { action: "steer", x: 0, y: 0 };
    // In schmalen Formen (Stern, Dreieck) zielt man genauer — sonst stünde
    // auch der starke Bot neben der Zacke.
    const tight = BOOK_SHAPES[hole.shape]?.area ?? 1;
    return go(hole.x + entry.botJitter.x * hole.w * tight, hole.z + entry.botJitter.z * hole.d * tight);
  },
  rank(arcade, entry) {
    const bis = entry.outAt ? Math.min(99, Math.round((entry.outMs || 0) / 1000)) : 99;
    const tempo = Math.max(0, 9999 - Math.round((entry.safeMs || 0) / 10));
    return (entry.survived || 0) * 1e7 + (entry.lives || 0) * 1e6 + bis * 1e4 + tempo;
  },
  detail(arcade, entry) {
    const survived = entry.survived || 0;
    return { kind: "points", value: survived, label: "Seiten", extra: survived ? `Ø ${sekunden((entry.safeMs || 0) / survived)}` : null };
  },
  done(ctx) {
    const { room, arcade, elapsed } = ctx;
    const state = arcade.book;
    const last = state.pages[state.pages.length - 1];
    if (last && state.slammed >= last.index && elapsed > last.slamAt + 900) return true;
    const alive = room.players.filter((p) => arcade.players[p.id] && !arcade.players[p.id].outAt);
    if (alive.length === 0) return elapsed > (state.pages[state.slammed]?.slamAt || 0) + 1200;
    return room.players.length > 1 && alive.length === 1 && elapsed > (state.pages[state.slammed]?.slamAt || 0) + 1200;
  }
};


// --- Schnappschuss ---------------------------------------------------------
//
// Roter Teppich, ein Fotograf. Er zeigt einen Bildausschnitt auf der Bühne,
// zählt herunter und drückt ab: wer dann im Ausschnitt steht, ist auf dem
// Foto (10 Punkte), wer der Mitte am nächsten ist, aufs Titelbild (+10), und
// wer ganz allein drauf ist, bekommt noch 5. Wer im Weg steht, wird
// geschubst — ein Tipp auf SCHUBS lässt einen nach vorn schnellen, und wen
// man dabei rammt, der fliegt aus dem Bild.
//
// Gerechnet wird in festen Schritten auf einer eigenen Uhr (photoClock), in
// der festen Reihenfolge arcade.order — genau so wie auf dem Gerät
// (Fotobuehne.js), das damit die eigene Figur bis zur Ankunftszeit des
// eigenen Sticks vorausrechnet. Ein Test hält beide Rechnungen gleich.
//
// Gemessen am alten Stand: Liefen alle zur Mitte, bekam der vierte Platz in
// 12,8 von 13 Fotos das Titelbild — das Gedränge wurde Paar für Paar
// aufgelöst, und wer zuletzt dran war, blieb stehen. Jetzt wird es für alle
// zugleich aufgelöst, und wer hineinläuft, weicht, wer schon steht, bleibt:
// die Mitte hält, wer zuerst da ist, und herausholen kann ihn nur ein Schubs.
const PHOTO_W = 6.4;
const PHOTO_D = 7.2;
const PHOTO_DURATION_MS = 42000;
const PHOTO_FIRST_MS = 1800;
const PHOTO_LEAD_START = 2500;         // so lange steht der Ausschnitt vor dem Blitz
const PHOTO_LEAD_END = 1600;
const PHOTO_AFTER_MS = 900;            // Pause nach dem Blitz
const PHOTO_R_START = 1.45;
const PHOTO_R_END = 0.9;
const PHOTO_IN = 10;
const PHOTO_COVER = 10;
const PHOTO_SOLO = 5;
const PHOTO_SPEED = 3.3;
const PHOTO_ACCEL = 14;
const PHOTO_TURN = 10;                 // rad/s: so schnell dreht man sich zum Stick
const PHOTO_BODY = 0.3;
const PHOTO_BUMP = 0.62;
const PHOTO_HOLD = 0.2;                // wer steht, weicht im Gedränge so wenig
const PHOTO_DASH_MS = 190;
const PHOTO_DASH_SPEED = 7;
const PHOTO_HIT_R = 0.75;              // so nah muss man beim Vorschnellen herankommen
const PHOTO_HIT_CONE = 0.35;           // und ungefähr in Blickrichtung
const PHOTO_SHOVE_KICK = 5.5;
const PHOTO_SHOVE_STUN_MS = 450;
const PHOTO_STUN_DRAG = 4;
const PHOTO_SHOVE_COOLDOWN_MS = 1300;
const PHOTO_STEP_MS = 30;              // Rechenschritt, wie STEP_MS in Fotobuehne.js
const PHOTO_CATCHUP_MS = 250;          // hängt der Server, holt er höchstens so viel nach
// Wo der nächste Ausschnitt liegt, sieht das Gerät erst so kurz vorher:
// Rundreise (bis 250 ms, wie das Gerät sie deckelt) plus ein Servertakt.
// Vorher stand der ganze Plan von Anfang an im Netzverkehr.
const PHOTO_PUBLISH_LEAD_MS = 350;

// Die Regeln, wie das Gerät sie braucht (Fotobuehne.js liest arcade.photoRules).
const PHOTO_RULES = {
  w: PHOTO_W, d: PHOTO_D, speed: PHOTO_SPEED, accel: PHOTO_ACCEL, turn: PHOTO_TURN, body: PHOTO_BODY,
  bump: PHOTO_BUMP, hold: PHOTO_HOLD, dashMs: PHOTO_DASH_MS, dashSpeed: PHOTO_DASH_SPEED, hitR: PHOTO_HIT_R,
  hitCone: PHOTO_HIT_CONE, kick: PHOTO_SHOVE_KICK, stunMs: PHOTO_SHOVE_STUN_MS, stunDrag: PHOTO_STUN_DRAG,
  cooldownMs: PHOTO_SHOVE_COOLDOWN_MS, inPts: PHOTO_IN, coverPts: PHOTO_COVER, soloPts: PHOTO_SOLO, stepMs: PHOTO_STEP_MS
};

function buildPhotoShots(seed, durationMs = PHOTO_DURATION_MS) {
  const shots = [];
  let at = PHOTO_FIRST_MS;
  let index = 0;
  let px = 0;
  let pz = 0;
  while (true) {
    const progress = clamp(at / durationMs, 0, 1);
    const lead = Math.round(PHOTO_LEAD_START + (PHOTO_LEAD_END - PHOTO_LEAD_START) * progress);
    if (at + lead > durationMs - 500) break;
    const r = Math.round((PHOTO_R_START + (PHOTO_R_END - PHOTO_R_START) * progress) * 100) / 100;
    // Nicht zweimal an dieselbe Stelle: der nächste Ausschnitt liegt ein
    // Stück entfernt, damit man jedes Mal laufen muss.
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 20; tries += 1) {
      x = Math.round(((noise(seed + index * 17 + tries) - 0.5) * (PHOTO_W - 2 * r - 0.4)) * 100) / 100;
      z = Math.round(((noise(seed + index * 23 + tries + 7) - 0.5) * (PHOTO_D - 2 * r - 0.4)) * 100) / 100;
      if (Math.hypot(x - px, z - pz) > 2.2 || tries === 19) break;
    }
    px = x;
    pz = z;
    shots.push({ index, at, shootAt: at + lead, x, z, r });
    at += lead + PHOTO_AFTER_MS;
    index += 1;
  }
  return shots;
}

// Was die Geräte vom Fotoplan sehen: Zeiten immer, den Ausschnitt erst kurz
// bevor er auf der Bühne erscheint.
function photoPublish(arcade, elapsed) {
  const full = arcade.secret.photoShots;
  arcade.photo.shots.forEach((shown, i) => {
    if (shown.x !== null || elapsed < shown.at - PHOTO_PUBLISH_LEAD_MS) return;
    shown.x = full[i].x;
    shown.z = full[i].z;
    shown.r = full[i].r;
  });
}

// Anlaufen exakt gelöst (wie snowEase): unabhängig davon, wie der Schritt
// zerlegt wird.
function photoEase(v, target, rate, dt) {
  const fade = Math.exp(-rate * dt);
  return { v: target + (v - target) * fade, d: target * dt + (v - target) * (1 - fade) / rate };
}

// Ein SCHUBS setzt an: vorschnellen in Blickrichtung. Gerammt wird im
// Schritt, bei Berührung — vorher flog, wer 1,6 Einheiten vor einem stand,
// schon beim Drücken weg, lange bevor man ihn erreicht hatte.
function photoStartShove(entry, start) {
  if (start < entry.stunUntil || start - entry.lastShoveAt < PHOTO_SHOVE_COOLDOWN_MS) return false;
  entry.lastShoveAt = start;
  entry.dashUntil = start + PHOTO_DASH_MS;
  entry.shoves += 1;
  return true;
}

// Ein Rechenschritt. `shots`: der ganze Fotoplan (mit Ausschnitten),
// `entries`: [{ id, entry }] in der Reihenfolge arcade.order, `now` die
// Serverzeit am Ende des Schritts. Genau so in Fotobuehne.js (stepPhoto) —
// ein Test hält beide gleich.
function photoStep(state, shots, entries, stepMs, now, startedAt) {
  const dt = stepMs / 1000;
  const start = now - stepMs;
  const halfW = PHOTO_W / 2 - PHOTO_BODY;
  const halfD = PHOTO_D / 2 - PHOTO_BODY;
  entries.forEach(({ entry }) => {
    if (entry.shoveQueued) {
      entry.shoveQueued = false;
      photoStartShove(entry, start);
    }
    const dashing = start < entry.dashUntil;
    const stunned = start < entry.stunUntil;
    let dx;
    let dz;
    if (dashing) {
      entry.vx = Math.sin(entry.heading) * PHOTO_DASH_SPEED;
      entry.vz = Math.cos(entry.heading) * PHOTO_DASH_SPEED;
      dx = entry.vx * dt;
      dz = entry.vz * dt;
    } else {
      const rate = stunned ? PHOTO_STUN_DRAG : PHOTO_ACCEL;
      const gx = photoEase(entry.vx, stunned ? 0 : entry.dirX * PHOTO_SPEED, rate, dt);
      const gz = photoEase(entry.vz, stunned ? 0 : entry.dirZ * PHOTO_SPEED, rate, dt);
      entry.vx = gx.v;
      entry.vz = gz.v;
      dx = gx.d;
      dz = gz.d;
      if (!stunned && Math.hypot(entry.dirX, entry.dirZ) > 0.15) {
        const want = Math.atan2(entry.dirX, entry.dirZ);
        const diff = Math.atan2(Math.sin(want - entry.heading), Math.cos(want - entry.heading));
        entry.heading += clamp(diff, -PHOTO_TURN * dt, PHOTO_TURN * dt);
      }
    }
    const x = entry.x + dx;
    const z = entry.z + dz;
    entry.x = clamp(x, -halfW, halfW);
    entry.z = clamp(z, -halfD, halfD);
    if (x !== entry.x) entry.vx = 0;
    if (z !== entry.z) entry.vz = 0;
  });
  // Rammen: erst alle Treffer sammeln, dann austeilen — rennen zwei
  // ineinander, fliegen beide, egal wer zuerst gerechnet wird.
  const hits = [];
  entries.forEach(({ id, entry }) => {
    if (!(start < entry.dashUntil)) return;
    const hx = Math.sin(entry.heading);
    const hz = Math.cos(entry.heading);
    entries.forEach(({ id: otherId, entry: other }) => {
      if (other === entry || start < other.stunUntil) return;
      const ox = other.x - entry.x;
      const oz = other.z - entry.z;
      const dist = Math.hypot(ox, oz);
      if (dist > PHOTO_HIT_R || dist < 1e-6) return;
      if ((ox * hx + oz * hz) / dist < PHOTO_HIT_CONE) return;
      hits.push({ by: id, shover: entry, victim: other, victimId: otherId, nx: ox / dist, nz: oz / dist });
    });
  });
  hits.forEach(({ by, shover, victim, nx, nz }) => {
    victim.vx = nx * PHOTO_SHOVE_KICK;
    victim.vz = nz * PHOTO_SHOVE_KICK;
    victim.stunUntil = now + PHOTO_SHOVE_STUN_MS;
    victim.dashUntil = 0;
    victim.shoved += 1;
    victim.lastShovedBy = by;
    victim.lastShovedAt = now;
    // Wer trifft, bleibt stehen, statt durch das Bild zu schiessen.
    if (shover.dashUntil > now) shover.dashUntil = now;
    shover.vx *= 0.3;
    shover.vz *= 0.3;
    shover.hits = (shover.hits || 0) + 1;
  });
  // Gedränge: alle Paare aus demselben Stand, dann zugleich verschieben. Wer
  // auf den anderen zuläuft, weicht; wer steht, bleibt fast stehen.
  const moves = entries.map(() => ({ x: 0, z: 0 }));
  for (let a = 0; a < entries.length; a += 1) {
    for (let b = a + 1; b < entries.length; b += 1) {
      const one = entries[a].entry;
      const two = entries[b].entry;
      const dx = two.x - one.x;
      const dz = two.z - one.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= PHOTO_BUMP || dist < 1e-6) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = PHOTO_BUMP - dist;
      const inOne = Math.max(0, one.vx * nx + one.vz * nz);
      const inTwo = Math.max(0, -(two.vx * nx + two.vz * nz));
      const share = (inOne + PHOTO_HOLD) / (inOne + inTwo + 2 * PHOTO_HOLD);
      moves[a].x -= nx * overlap * share;
      moves[a].z -= nz * overlap * share;
      moves[b].x += nx * overlap * (1 - share);
      moves[b].z += nz * overlap * (1 - share);
    }
  }
  entries.forEach(({ entry }, i) => {
    entry.x = clamp(entry.x + moves[i].x, -halfW, halfW);
    entry.z = clamp(entry.z + moves[i].z, -halfD, halfD);
  });
  // Blitz!
  const elapsed = now - startedAt;
  shots.forEach((shot) => {
    if (shot.index <= state.shot || elapsed < shot.shootAt) return;
    state.shot = shot.index;
    const inside = entries
      .map(({ id, entry }) => ({ id, entry, d: Math.hypot(entry.x - shot.x, entry.z - shot.z) }))
      .filter((item) => item.d <= shot.r);
    const nearest = inside.reduce((best, item) => (!best || item.d < best.d ? item : best), null);
    const result = { index: shot.index, at: now, in: [] };
    inside.forEach((item) => {
      const cover = item === nearest;
      const solo = inside.length === 1;
      const points = PHOTO_IN + (cover ? PHOTO_COVER : 0) + (solo ? PHOTO_SOLO : 0);
      item.entry.score += points;
      item.entry.photos += 1;
      if (cover) item.entry.covers += 1;
      result.in.push({ id: item.id, points, cover, solo });
    });
    state.results.push(result);
    if (state.results.length > 6) state.results.shift();
  });
}

function photoSpawn(index) {
  return [[-1.6, 2], [1.6, 2], [-1.6, -1.6], [1.6, -1.6]][index % 4];
}

function photoGauss() {
  let sum = 0;
  for (let i = 0; i < 6; i += 1) sum += Math.random();
  return (sum - 3) / Math.sqrt(0.5);
}

const photo = {
  cooldown: 0,
  fastHand: true,
  create(arcade, players) {
    const shots = buildPhotoShots(arcade.seed);
    arcade.secret = { ...(arcade.secret || {}), photoShots: shots };
    arcade.photo = {
      w: PHOTO_W,
      d: PHOTO_D,
      shots: shots.map(({ index, at, shootAt }) => ({ index, at, shootAt, x: null, z: null, r: null })),
      shot: -1,                        // letzter ausgelöster Schnappschuss
      results: []                      // je Schnappschuss: { index, in: [{ id, points, cover, solo }] }
    };
    arcade.photoRules = { ...PHOTO_RULES };
    arcade.order = players.map((player) => player.id);
    arcade.photoClock = arcade.startedAt || 0;
    photoPublish(arcade, 0);
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const [x, z] = photoSpawn(index);
      Object.assign(entry, {
        x, z, vx: 0, vz: 0, dirX: 0, dirZ: 0, heading: Math.atan2(-x, -z), dashUntil: 0, lastShoveAt: -1e9, shoveQueued: false,
        stunUntil: 0, shoves: 0, shoved: 0, hits: 0, photos: 0, covers: 0, score: 0
      });
    });
  },
  input(ctx, player, entry, input) {
    if (input.action === "steer") {
      const x = inputNumber(input.x);
      const y = inputNumber(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Ungültige Richtung." };
      const len = Math.hypot(x, y);
      const k = len > 1 ? 1 / len : 1;
      entry.dirX = x * k;
      entry.dirZ = y * k;
      return { ok: true };
    }
    if (input.action !== "shove") return { ok: false, error: "Laufen oder schubsen." };
    // Angesetzt wird im nächsten Rechenschritt — dort prüft er auch Pause und
    // Taumeln, genau wie die Vorausrechnung auf dem Gerät.
    entry.shoveQueued = true;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, now, minigame } = ctx;
    const state = arcade.photo;
    const startedAt = minigame?.startedAt ?? arcade.startedAt ?? 0;
    arcade.lastUpdateAt = now;
    if (!arcade.photoClock) arcade.photoClock = now;
    if (now - arcade.photoClock > PHOTO_CATCHUP_MS) arcade.photoClock = now - PHOTO_CATCHUP_MS;
    const present = new Set(room.players.map((player) => player.id));
    const entries = (arcade.order || room.players.map((player) => player.id))
      .filter((id) => present.has(id) && arcade.players[id])
      .map((id) => ({ id, entry: arcade.players[id] }));
    while (arcade.photoClock + PHOTO_STEP_MS <= now) {
      arcade.photoClock += PHOTO_STEP_MS;
      photoStep(state, arcade.secret.photoShots, entries, PHOTO_STEP_MS, arcade.photoClock, startedAt);
    }
    photoPublish(arcade, now - startedAt);
  },
  bot(ctx, player, entry) {
    const { arcade, room, now, elapsed } = ctx;
    const state = arcade.photo;
    if (now < entry.stunUntil) return { action: "steer", x: 0, y: 0 };
    const shot = arcade.secret.photoShots.find((s) => s.index > state.shot);
    if (!shot) return { action: "steer", x: 0, y: 0 };
    const go = (tx, tz) => {
      const dx = tx - entry.x;
      const dz = tz - entry.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) return { action: "steer", x: 0, y: 0 };
      const gain = Math.min(1, d * 2.4);
      return { action: "steer", x: (dx / d) * gain, y: (dz / d) * gain };
    };
    // Menschliche Reaktion: vorher lief der starke nach 180 ms los — schneller,
    // als ein Mensch den Ausschnitt überhaupt sieht.
    if (entry.botShot !== shot.index) {
      entry.botShot = shot.index;
      entry.botReact = Math.max(300, byLevel(entry, 560, 460, 420) + photoGauss() * 60);
      entry.botCenter = Math.random() < byLevel(entry, 0.2, 0.5, 0.85);
      const spread = byLevel(entry, 0.45, 0.25, 0.06) * shot.r;
      const a = Math.random() * Math.PI * 2;
      entry.botOffX = Math.cos(a) * spread;
      entry.botOffZ = Math.sin(a) * spread;
      // Der starke schubst kurz vor dem Blitz, der mittlere irgendwann, der
      // schwache kaum.
      entry.botShoveWhen = byLevel(entry, 0.1, 0.45, 0.8);
    }
    // Zwischen den Bildern: der starke wartet mitten auf der Bühne — von dort
    // ist jeder Ausschnitt am schnellsten erreicht.
    if (elapsed < shot.at + entry.botReact) {
      return entry.botCenter ? go(0, 0.2) : { action: "steer", x: 0, y: 0 };
    }
    const left = shot.shootAt - elapsed;
    const rivals = room.players.map((p) => arcade.players[p.id]).filter((o) => o && o !== entry && now >= o.stunUntil);
    const nearestRival = rivals.reduce((b, o) => (!b || Math.hypot(o.x - shot.x, o.z - shot.z) < Math.hypot(b.x - shot.x, b.z - shot.z) ? o : b), null);
    const mine = Math.hypot(entry.x - shot.x, entry.z - shot.z);
    if (now - entry.lastShoveAt > PHOTO_SHOVE_COOLDOWN_MS && now >= entry.dashUntil) {
      const hx = Math.sin(entry.heading);
      const hz = Math.cos(entry.heading);
      const inLine = (o) => {
        const dx = o.x - entry.x;
        const dz = o.z - entry.z;
        const dist = Math.hypot(dx, dz);
        return dist < 1.3 && dist > 0 && (dx * hx + dz * hz) / dist > 0.8;
      };
      // Der starke wartet bis kurz vor dem Blitz — wer dann fliegt, kommt
      // nicht mehr zurück ins Bild.
      const late = left < byLevel(entry, 1200, 750, 600);
      if (late && Math.random() < entry.botShoveWhen && rivals.some((o) => inLine(o) && Math.hypot(o.x - shot.x, o.z - shot.z) < shot.r + 0.3)) {
        return { action: "shove" };
      }
    }
    // Steht einer in der Mitte, läuft der starke genau auf ihn zu (dann schaut
    // er ihn an und kann rammen), die anderen irgendwo in den Ausschnitt.
    if (level(entry) === "hard" && nearestRival && Math.hypot(nearestRival.x - shot.x, nearestRival.z - shot.z) < mine && mine < shot.r + 0.6) {
      return go(nearestRival.x, nearestRival.z);
    }
    return go(shot.x + entry.botOffX, shot.z + entry.botOffZ);
  },
  rank(arcade, entry) {
    return (entry.score || 0) * 100 + Math.min(99, (entry.covers || 0) * 10 + (entry.photos || 0));
  },
  detail(arcade, entry) {
    const covers = entry.covers || 0;
    return { kind: "points", value: Math.max(0, Math.round(entry.score || 0)), label: "Punkte", extra: covers ? `${covers}× Titelbild` : null };
  },
  done(ctx) {
    const { arcade, elapsed } = ctx;
    const shots = arcade.photo.shots;
    const last = shots[shots.length - 1];
    return Boolean(last) && arcade.photo.shot >= last.index && elapsed > last.shootAt + 1400;
  }
};


// --- Kippboot --------------------------------------------------------------
//
// In einer Lagune liegt ein Ruderboot. Reihum schwenkt ein Kran einen
// Passagier über das Boot — Küken, Pinguin, Schaf, Schwein, je schwerer,
// desto mehr Punkte. Ein Tipp setzt ihn ab, dort wo er gerade hängt. Weiter
// aussen gibt es mehr Punkte (bis zum Dreifachen) — aber das Boot neigt sich
// dann auch stärker. Liegt zu viel Gewicht auf einer Seite, kentert das Boot:
// wer es gekippt hat, verliert Punkte, alle Passagiere gehen baden, ein neues
// Boot kommt. Ist das Boot voll, legt es ab, und alle, die etwas daraufgesetzt
// haben, bekommen eine Zugabe.
//
// Gerechnet wird mit dem Drehmoment: Summe aus Gewicht mal Abstand zur
// Mitte. Das Boot neigt sich sichtbar dazu, und wer hinschaut, setzt den
// nächsten Passagier auf die Gegenseite.
//
// Gespielt wird in Runden: in jeder ist jeder genau einmal dran, und alle
// bekommen dasselbe Tier, von Runde zu Runde schwerer und schneller. Vorher
// mischte jedes neue Boot die Reihenfolge neu, und die Tiere kamen nach dem
// Zufall — gemessen hatte einer drei Züge, ein anderer sechs, und unter
// gleich guten Spielern gewann in vier von fünf Partien, wer die schwersten
// Tiere erwischt hatte.
const BOAT_LEAD_MS = 1500;
// Obergrenze. Das Spiel endet nach der letzten Runde, meist nach gut 40 s.
const BOAT_DURATION_MS = 60000;
const BOAT_TURN_MS = 4200;             // so lange hängt ein Passagier höchstens am Haken
const BOAT_TURN_MIN_MS = 1500;         // kürzer nie — so viel bleibt jedem Zug sicher
const BOAT_GAP_MS = 800;               // nach dem Absetzen
const BOAT_SPLASH_MS = 1800;           // nach dem Kentern
const BOAT_DEPART_MS = 1700;           // ein volles Boot legt ab
const BOAT_END_MS = 1800;              // nach dem letzten Zug bis zum Schluss
const BOAT_REACH = 1.75;               // so weit schwingt der Haken
const BOAT_TORQUE_MAX = 4.2;           // darüber kentert es
const BOAT_CAPACITY = 7;
const BOAT_POINT_BASE = 10;            // je Gewicht in der Mitte; am Rand dreifach
const BOAT_CAPSIZE_COST = 30;
const BOAT_DEPART_BONUS = 5;
const BOAT_OMEGA_START = 1.8;          // rad/s: so schnell schwingt der Haken in der ersten Runde
const BOAT_OMEGA_END = 3.4;            // und so schnell in der letzten
const BOAT_KINDS = [
  { kind: "kueken", w: 1 },
  { kind: "pinguin", w: 2 },
  { kind: "schaf", w: 2 },
  { kind: "schwein", w: 3 }
];

function boatSwingX(turn, elapsed) {
  const t = Math.max(0, elapsed - turn.from) / 1000;
  return BOAT_REACH * Math.sin(turn.omega * t + turn.phase);
}

// Aussen gibt es mehr: in der Mitte einfach, am Rand dreifach. Ohne das wäre
// immer die Mitte richtig gewesen — dort bewegt sich das Boot nicht, und das
// Spiel hätte keine Entscheidung gehabt. Fein gestuft (Küken 10–30, Schwein
// 30–90): mit 1–3 Punkten traf fast jeder das Maximum, und jede dritte
// Partie endete unentschieden — genau absetzen zählte nicht.
function boatPoints(w, x) {
  return Math.round(w * (BOAT_POINT_BASE + 2 * BOAT_POINT_BASE * Math.min(1, Math.abs(x) / BOAT_REACH)));
}

function boatTorque(passengers) {
  return passengers.reduce((sum, p) => sum + p.w * p.x, 0);
}

// Wie viele Runden? Jeder soll etwa gleich oft dran sein, egal wie viele
// mitspielen — zu zweit kämen sonst nur acht Züge zusammen.
function boatRounds(players) {
  return players <= 2 ? 7 : players === 3 ? 5 : 4;
}

// Das Tier einer Runde: vom Küken zum Schwein.
function boatRoundKind(round, rounds) {
  return BOAT_KINDS[Math.min(BOAT_KINDS.length - 1, Math.floor((round * BOAT_KINDS.length) / Math.max(1, rounds)))];
}

function boatNextTurn(ctx, delay) {
  const { arcade, room, elapsed } = ctx;
  const state = arcade.boat;
  const present = room.players.map((player) => player.id).filter((id) => arcade.players[id]);
  if (!present.length) {
    state.turn = null;
    return;
  }
  // Der Nächste dieser Runde (wer gegangen ist, wird übersprungen) — oder eine
  // neue Runde mit neu gemischter Reihenfolge.
  let next = null;
  while (state.roundOrder && state.roundPos < state.roundOrder.length) {
    const id = state.roundOrder[state.roundPos];
    state.roundPos += 1;
    if (present.includes(id)) {
      next = id;
      break;
    }
  }
  if (!next) {
    if (state.round + 1 >= state.rounds) {
      state.turn = null;
      if (state.finishedAt === null) state.finishedAt = elapsed;
      return;
    }
    state.round += 1;
    const order = [...present];
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(noise(arcade.seed + state.round * 131 + i * 17) * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // Nie zweimal hintereinander derselbe, auch nicht über die Rundengrenze.
    if (order.length > 1 && order[0] === state.lastPlayer) [order[0], order[1]] = [order[1], order[0]];
    state.roundOrder = order;
    state.roundPos = 1;
    next = order[0];
  }
  const from = elapsed + delay;
  // Bedenkzeit: so lang wie möglich, aber so, dass alle übrigen Züge sicher
  // noch in die Zeit passen — auch wenn jeder bis zur letzten Sekunde wartet
  // und jedes Boot kentert.
  const leftThisRound = state.roundOrder.slice(state.roundPos).filter((id) => present.includes(id)).length;
  const later = leftThisRound + (state.rounds - state.round - 1) * present.length;
  const budget = BOAT_DURATION_MS - BOAT_END_MS - from - later * (BOAT_TURN_MIN_MS + BOAT_SPLASH_MS);
  const turnMs = clamp(budget, BOAT_TURN_MIN_MS, BOAT_TURN_MS);
  const n = state.turns;
  const pick = boatRoundKind(state.round, state.rounds);
  // Der Haken schwingt mit jeder Runde schneller — für alle in derselben
  // Runde gleich schnell.
  const progress = state.rounds > 1 ? state.round / (state.rounds - 1) : 0;
  const omega = Math.round((BOAT_OMEGA_START + (BOAT_OMEGA_END - BOAT_OMEGA_START) * progress) * 100) / 100;
  const phase = Math.round(noise(arcade.seed + n * 53) * Math.PI * 2 * 100) / 100;
  state.turn = { playerId: next, from, until: from + turnMs, number: n, round: state.round, kind: pick.kind, w: pick.w, omega, phase };
  state.lastPlayer = next;
  state.turns += 1;
}

// Absetzen, wo der Haken zur Zeit `at` hängt (für Menschen: wenn der Tipp
// beim Server ankommt).
function boatDrop(ctx, player, entry, auto = false, at = ctx.elapsed) {
  const { arcade } = ctx;
  const elapsed = at;
  const state = arcade.boat;
  const turn = state.turn;
  const x = Math.round(boatSwingX(turn, elapsed) * 100) / 100;
  const passenger = { kind: turn.kind, w: turn.w, x, by: player.id, slot: state.passengers.length };
  state.passengers.push(passenger);
  const torque = boatTorque(state.passengers);
  state.torque = Math.round(torque * 100) / 100;
  entry.drops += 1;
  if (Math.abs(torque) > BOAT_TORQUE_MAX) {
    // Gekentert.
    entry.score -= BOAT_CAPSIZE_COST;
    entry.capsizes += 1;
    state.last = { kind: "capsize", playerId: player.id, x, w: turn.w, animal: turn.kind, at: elapsed, turn: turn.number, side: Math.sign(torque), passengers: state.passengers.slice(), auto, number: state.events };
    state.events += 1;
    state.passengers = [];
    state.torque = 0;
    state.boatNumber += 1;
    boatNextTurn(ctx, BOAT_SPLASH_MS);
    return;
  }
  const points = boatPoints(turn.w, x);
  entry.score += points;
  entry.placed += 1;
  state.last = { kind: "place", playerId: player.id, x, w: turn.w, points, animal: turn.kind, at: elapsed, turn: turn.number, auto, number: state.events };
  state.events += 1;
  if (state.passengers.length >= BOAT_CAPACITY) {
    // Voll: das Boot legt ab, und alle, die mitgeladen haben, bekommen etwas.
    const loaders = new Set(state.passengers.map((p) => p.by));
    loaders.forEach((id) => {
      const loader = arcade.players[id];
      if (loader) {
        loader.score += BOAT_DEPART_BONUS;
        loader.departs += 1;
      }
    });
    state.last = { kind: "depart", playerId: player.id, x, w: turn.w, points, animal: turn.kind, at: elapsed, turn: turn.number, passengers: state.passengers.slice(), loaders: [...loaders], auto, number: state.events };
    state.events += 1;
    state.passengers = [];
    state.torque = 0;
    state.boatNumber += 1;
    boatNextTurn(ctx, BOAT_DEPART_MS);
    return;
  }
  boatNextTurn(ctx, BOAT_GAP_MS);
}

// Wohin setzt man am besten? Die Stelle mit den meisten Punkten, an der das
// Boot mit Abstand `safe` (Anteil der Kippgrenze) noch liegt.
function boatBestAim(torque, w, safe) {
  let best = clamp(-torque / w, -BOAT_REACH * 0.95, BOAT_REACH * 0.95);
  let bestPoints = -1;
  for (let x = -BOAT_REACH * 0.95; x <= BOAT_REACH * 0.95 + 1e-9; x += 0.05) {
    if (Math.abs(torque + w * x) > BOAT_TORQUE_MAX * safe) continue;
    const pts = boatPoints(w, x);
    if (pts > bestPoints || (pts === bestPoints && Math.abs(torque + w * x) < Math.abs(torque + w * best))) {
      bestPoints = pts;
      best = x;
    }
  }
  return best;
}

function boatGauss() {
  let sum = 0;
  for (let i = 0; i < 6; i += 1) sum += Math.random();
  return (sum - 3) / Math.sqrt(0.5);
}

const boat = {
  cooldown: 150,
  fastHand: true,
  create(arcade, players) {
    const count = (players || Object.keys(arcade.players)).length;
    arcade.boat = {
      passengers: [],
      torque: 0,
      turn: null,
      turns: 0,
      events: 0,
      boatNumber: 0,
      last: null,
      round: -1,
      rounds: boatRounds(count),
      roundOrder: null,
      roundPos: 0,
      lastPlayer: null,
      finishedAt: null,
      reach: BOAT_REACH,
      torqueMax: BOAT_TORQUE_MAX,
      capacity: BOAT_CAPACITY,
      leadMs: BOAT_LEAD_MS
    };
    Object.values(arcade.players).forEach((entry) => {
      Object.assign(entry, { drops: 0, placed: 0, capsizes: 0, departs: 0, score: 0 });
    });
  },
  input(ctx, player, entry, input) {
    if (input.action !== "drop") return { ok: false, error: "Tippe, um abzusetzen." };
    const turn = ctx.arcade.boat.turn;
    if (!turn || turn.playerId !== player.id) return { ok: false, error: "Du bist nicht dran." };
    if (ctx.elapsed < turn.from) return { ok: true };
    if (ctx.elapsed >= turn.until && !(player.isBot && Number.isFinite(input.botAt) && input.botAt < turn.until)) {
      boatDrop(ctx, player, entry, true, turn.until);
      return { ok: true };
    }
    // Bots planen ihren Tipp wie ein Mensch auf die Millisekunde; ihr Takt ist
    // aber grob (alle 120–180 ms), darum zählt der geplante Augenblick. Nur für
    // Bots — ein Gerät kann keine Zeit mitschicken.
    const at = player.isBot && Number.isFinite(input.botAt) ? clamp(input.botAt, turn.from, ctx.elapsed) : ctx.elapsed;
    boatDrop(ctx, player, entry, false, at);
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, elapsed } = ctx;
    const state = arcade.boat;
    if (!state.turn && state.turns === 0 && elapsed >= BOAT_LEAD_MS) boatNextTurn(ctx, 0);
    const turn = state.turn;
    if (turn && elapsed >= turn.until) {
      const player = room.players.find((p) => p.id === turn.playerId);
      const entry = player && arcade.players[player.id];
      if (entry) boatDrop(ctx, player, entry, true, turn.until);
      else boatNextTurn(ctx, 0);
    }
  },
  bot(ctx, player, entry) {
    const { arcade, elapsed } = ctx;
    const state = arcade.boat;
    const turn = state.turn;
    if (!turn || turn.playerId !== player.id || elapsed < turn.from) return null;
    if (entry.botTurn !== turn.number) {
      entry.botTurn = turn.number;
      // Wohin? Der starke sucht die meisten Punkte mit wenig Abstand zur
      // Kippgrenze, der mittlere mit mehr. Der schwache greift oft nach dem
      // Rand, ohne auf die Neigung zu achten.
      let aim;
      if (level(entry) === "easy" && Math.random() < 0.45) aim = (Math.random() < 0.5 ? -1 : 1) * BOAT_REACH * (0.5 + Math.random() * 0.45);
      else aim = boatBestAim(state.torque, turn.w, byLevel(entry, 0.65, 0.8, 0.88));
      // Wann kreuzt der Haken das Ziel? Nach der Bedenkzeit, beim nächsten
      // Vorbeikommen — gedrückt wird mit menschlicher Streuung.
      const think = turn.from + Math.max(250, byLevel(entry, 750, 600, 480) + boatGauss() * 90);
      const last = turn.until - 250;
      let hit = null;
      let prev = boatSwingX(turn, think) - aim;
      for (let t = think; t <= last; t += 5) {
        const d = boatSwingX(turn, t) - aim;
        if (Math.sign(d) !== Math.sign(prev) || Math.abs(d) < 0.01) {
          hit = t;
          break;
        }
        prev = d;
      }
      if (hit === null) hit = last;
      entry.botPressAt = clamp(hit + boatGauss() * byLevel(entry, 120, 80, 32), turn.from, last);
    }
    if (elapsed < entry.botPressAt) return null;
    return { action: "drop", botAt: entry.botPressAt };
  },
  rank(arcade, entry) {
    return Math.round((entry.score || 0) + 1000) * 100 + Math.max(0, 99 - (entry.capsizes || 0) * 10);
  },
  detail(arcade, entry) {
    const caps = entry.capsizes || 0;
    return { kind: "points", value: Math.round(entry.score || 0), label: "Punkte", extra: caps ? `${caps}× gekentert` : null };
  },
  done(ctx) {
    const state = ctx.arcade.boat;
    return state.finishedAt !== null && ctx.elapsed >= state.finishedAt + BOAT_END_MS;
  }
};


// --- Rohrsalat -------------------------------------------------------------
//
// An der Wand des Kesselhauses hängt ein Gewirr aus Rohren: oben Ventile,
// unten Ausgänge, dazwischen Querrohre. Nur ein Ausgang führt in die
// Schatztruhe. Welches Ventil muss man aufdrehen? Man folgt mit den Augen
// einem Rohr nach unten und biegt bei jedem Querrohr ab — wie bei einer
// Leiterlotterie. Wer richtig liegt, bekommt Punkte, und zwar umso mehr, je
// schneller er war. Wer falsch liegt, bekommt eine Ladung Russ.
//
// Vorher stand die Lösung jeder Runde von Anfang an im Netzverkehr, ebenso
// die Rohre aller späteren Runden und die Wahl der anderen — man konnte beim
// schnellsten abschreiben. Jetzt sieht ein Gerät das Gewirr erst kurz vor der
// Runde, die Lösung und die Wahl der anderen erst bei der Auflösung.
//
// Die Antwortzeit wächst mit dem Gewirr (vorher schrumpfte sie: wer gründlich
// folgte, kam in der letzten Runde oft gar nicht mehr zum Tippen). Haben alle
// gewählt, beginnt die Auflösung sofort.
const PIPE_ROUNDS = 5;
const PIPE_LEAD_MS = 1200;
const PIPE_ANSWER_MS = [9000, 9500, 10000, 10500, 11000];
const PIPE_REVEAL_MS = 2600;
const PIPE_ALL_IN_MS = 500;            // haben alle gewählt: so lange noch, dann Auflösung
const PIPE_GRACE_MS = 150;             // was knapp nach Ablauf ankommt, zählt noch
// Das Gewirr einer Runde sieht das Gerät erst so kurz vorher: Rundreise (bis
// 250 ms, wie das Gerät sie deckelt) plus ein Servertakt.
const PIPE_PUBLISH_LEAD_MS = 350;
const PIPE_LEVELS = 12;
const PIPE_POINTS = 100;
const PIPE_SPEED_BONUS = 60;
const PIPE_COLS = [4, 5, 5, 6, 6];
const PIPE_RUNGS = [7, 9, 11, 13, 15];

function buildPipeRound(seed, round) {
  const cols = PIPE_COLS[round];
  const wanted = PIPE_RUNGS[round];
  const rungs = [];
  const taken = new Set();
  let tries = 0;
  while (rungs.length < wanted && tries < 400) {
    tries += 1;
    const level = Math.floor(noise(seed + round * 997 + tries * 13) * PIPE_LEVELS);
    const col = Math.floor(noise(seed + round * 991 + tries * 7) * (cols - 1));
    // Zwei Querrohre auf derselben Höhe dürfen sich kein Rohr teilen.
    if (taken.has(`${level}:${col}`) || taken.has(`${level}:${col - 1}`) || taken.has(`${level}:${col + 1}`)) continue;
    taken.add(`${level}:${col}`);
    rungs.push({ level, col });
  }
  rungs.sort((a, b) => a.level - b.level || a.col - b.col);
  const target = Math.floor(noise(seed + round * 983 + 5) * cols);
  const answer = [...Array(cols).keys()].find((valve) => pipeTrace(rungs, valve) === target);
  return { round, cols, rungs, target, answer };
}

// Einem Rohr von oben folgen: bei jedem Querrohr auf der Höhe biegt man ab.
function pipeTrace(rungs, start) {
  let col = start;
  for (let level = 0; level < PIPE_LEVELS; level += 1) {
    if (rungs.some((r) => r.level === level && r.col === col)) col += 1;
    else if (rungs.some((r) => r.level === level && r.col === col - 1)) col -= 1;
  }
  return col;
}

// Der Zeitplan: jede Runde hat startAt und endAt (Spielzeit). Endet eine
// Runde früher, rücken alle späteren nach.
function pipeSchedule(rounds, from = 0) {
  for (let r = Math.max(1, from); r < rounds.length; r += 1) {
    rounds[r].startAt = rounds[r - 1].endAt + PIPE_REVEAL_MS;
    rounds[r].endAt = rounds[r].startAt + PIPE_ANSWER_MS[r];
  }
}

// In welcher Phase ist das Spiel zur Spielzeit `elapsed`? `rounds` mit
// startAt/endAt — die öffentlichen oder die geheimen, beide tragen die Zeiten.
function pipePhase(rounds, elapsed) {
  if (elapsed < rounds[0].startAt) return { phase: "lead", round: 0, since: elapsed };
  for (let round = 0; round < rounds.length; round += 1) {
    const { startAt, endAt } = rounds[round];
    if (elapsed < endAt) return { phase: "answer", round, since: elapsed - startAt, left: endAt - elapsed };
    if (elapsed < endAt + PIPE_REVEAL_MS) return { phase: "reveal", round, since: elapsed - endAt };
  }
  const last = rounds[rounds.length - 1];
  return { phase: "over", round: rounds.length - 1, since: elapsed - last.endAt - PIPE_REVEAL_MS };
}

// So lange dauert es höchstens: jede Runde bis zum Ablauf.
const PIPE_DURATION_MS = PIPE_LEAD_MS + PIPE_ANSWER_MS.reduce((a, b) => a + b, 0) + PIPE_ROUNDS * PIPE_REVEAL_MS + 400;

// Was die Geräte sehen: Zeiten immer, das Gewirr kurz vor der Runde, die
// Lösung erst, wenn die Runde gewertet ist.
function pipePublish(arcade, elapsed) {
  const full = arcade.secret.pipeRounds;
  arcade.pipes.rounds.forEach((shown, r) => {
    shown.startAt = full[r].startAt;
    shown.endAt = full[r].endAt;
    if (!shown.rungs && elapsed >= full[r].startAt - PIPE_PUBLISH_LEAD_MS) {
      shown.rungs = full[r].rungs.map((rung) => ({ ...rung }));
      shown.target = full[r].target;
    }
    if (shown.answer === null && arcade.pipes.scored >= r) shown.answer = full[r].answer;
  });
}

function pipeGauss() {
  let sum = 0;
  for (let i = 0; i < 6; i += 1) sum += Math.random();
  return (sum - 3) / Math.sqrt(0.5);
}

const pipes = {
  cooldown: 150,
  fastHand: false,
  create(arcade) {
    const rounds = Array.from({ length: PIPE_ROUNDS }, (_, round) => buildPipeRound(arcade.seed, round));
    rounds[0].startAt = PIPE_LEAD_MS;
    rounds[0].endAt = PIPE_LEAD_MS + PIPE_ANSWER_MS[0];
    pipeSchedule(rounds, 1);
    arcade.secret = { ...(arcade.secret || {}), pipeRounds: rounds, pipePicks: {} };
    arcade.pipes = {
      rounds: rounds.map(({ round, cols, startAt, endAt }) => ({ round, cols, startAt, endAt, rungs: null, target: null, answer: null })),
      levels: PIPE_LEVELS,
      leadMs: PIPE_LEAD_MS,
      answerMs: PIPE_ANSWER_MS,
      revealMs: PIPE_REVEAL_MS,
      points: PIPE_POINTS,
      speedBonus: PIPE_SPEED_BONUS,
      scored: -1
    };
    Object.entries(arcade.players).forEach(([id, entry]) => {
      arcade.secret.pipePicks[id] = [];   // je Runde { valve, ms } — geheim bis zur Auflösung
      entry.picked = [];               // je Runde: hat gewählt (ohne welches Ventil)
      entry.results = [];              // je Runde { correct, points, valve }
      entry.correct = 0;
      entry.score = 0;
    });
    pipePublish(arcade, 0);
  },
  input(ctx, player, entry, input) {
    if (input.action !== "pick") return { ok: false, error: "Tippe ein Ventil an." };
    const { arcade, elapsed } = ctx;
    const rounds = arcade.secret.pipeRounds;
    // Welche Runde ist offen? Knapp nach Ablauf zählt der Tipp noch.
    const round = rounds.findIndex((r) => elapsed >= r.startAt && elapsed < r.endAt + PIPE_GRACE_MS);
    if (round < 0 || round <= arcade.pipes.scored) return { ok: true };
    const picks = arcade.secret.pipePicks[player.id] || (arcade.secret.pipePicks[player.id] = []);
    if (picks[round]) return { ok: true };
    const maze = rounds[round];
    const valve = inputNumber(input.valve);
    if (!Number.isInteger(valve) || valve < 0 || valve >= maze.cols) return { ok: false, error: "Dieses Ventil gibt es nicht." };
    picks[round] = { valve, ms: Math.round(clamp(elapsed - maze.startAt, 0, PIPE_ANSWER_MS[round])) };
    entry.picked[round] = true;
    // Haben alle gewählt? Dann gleich zur Auflösung.
    const ids = ctx.room.players.map((p) => p.id).filter((id) => arcade.players[id]);
    if (elapsed < maze.endAt && ids.every((id) => arcade.secret.pipePicks[id]?.[round])) {
      maze.endAt = Math.max(elapsed, Math.min(maze.endAt, elapsed + PIPE_ALL_IN_MS));
      pipeSchedule(rounds, round + 1);
      pipePublish(arcade, elapsed);
    }
    return { ok: true };
  },
  update(ctx) {
    const { arcade, elapsed } = ctx;
    const state = arcade.pipes;
    const rounds = arcade.secret.pipeRounds;
    while (state.scored + 1 < rounds.length && elapsed >= rounds[state.scored + 1].endAt + PIPE_GRACE_MS) {
      state.scored += 1;
      const maze = rounds[state.scored];
      const answerMs = PIPE_ANSWER_MS[state.scored];
      Object.entries(arcade.players).forEach(([id, entry]) => {
        const pick = arcade.secret.pipePicks[id]?.[state.scored];
        const correct = Boolean(pick && pick.valve === maze.answer);
        const points = correct ? PIPE_POINTS + Math.round(PIPE_SPEED_BONUS * Math.max(0, 1 - pick.ms / answerMs)) : 0;
        entry.results[state.scored] = { correct, points, valve: pick ? pick.valve : null, ms: pick ? pick.ms : null };
        if (correct) entry.correct += 1;
        entry.score += points;
      });
    }
    pipePublish(arcade, elapsed);
  },
  bot(ctx, player, entry) {
    const { arcade, elapsed } = ctx;
    const rounds = arcade.secret.pipeRounds;
    const { phase, round, since } = pipePhase(rounds, elapsed);
    if (phase !== "answer" || arcade.secret.pipePicks[player.id]?.[round]) return null;
    const maze = rounds[round];
    if (entry.botRound !== round) {
      entry.botRound = round;
      // Wie lange der Bot „mit den Augen folgt“ und wie oft er sich verzählt
      // — wie ein Mensch: gemessen an Spielern, die den Rohren folgen.
      const n = maze.rungs.length;
      const think = (byLevel(entry, 3800, 2700, 1800) + n * byLevel(entry, 180, 150, 100)) * (0.8 + Math.random() * 0.4);
      entry.botAt = Math.min(PIPE_ANSWER_MS[round] - 400, think + pipeGauss() * 150);
      const right = byLevel(entry, 0.8, 0.92, 0.96) - n * byLevel(entry, 0.018, 0.013, 0.008);
      entry.botValve = Math.random() < right
        ? maze.answer
        : (maze.answer + 1 + Math.floor(Math.random() * (maze.cols - 1))) % maze.cols;
    }
    if (since < entry.botAt) return null;
    return { action: "pick", valve: entry.botValve };
  },
  rank(arcade, entry) {
    return Math.max(0, Math.round(entry.score || 0)) * 10 + (entry.correct || 0);
  },
  detail(arcade, entry) {
    const correct = entry.correct || 0;
    return { kind: "points", value: Math.max(0, Math.round(entry.score || 0)), label: "Punkte", extra: `${correct}/${PIPE_ROUNDS} richtig` };
  },
  done(ctx) {
    return pipePhase(ctx.arcade.secret.pipeRounds, ctx.elapsed).phase === "over";
  }
};

// ---------------------------------------------------------------------------

// --- Spurmaler -------------------------------------------------------------
//
// Ein grosser Stift zeichnet auf der Staffelei eine Figur vor — eine Welle,
// ein Herz, einen Stern, das Haus vom Nikolaus … Danach fährt jeder sie auf
// seinem eigenen Brett mit dem Finger nach, so genau er kann. Die Vorlage
// bleibt blass sichtbar. Nach Ablauf der Zeit wird verglichen (SketchFigures:
// Abdeckung mal Genauigkeit, bis 100 Punkte), drei Figuren, jede kniffliger.
//
// Vorher lenkte man einen Farbroller, der von selbst eine Spur hinauffuhr —
// mit links-rechts-Wischen. Das war eher ein Lenkspiel als Malen.
//
// Die Striche kommen in Stücken vom Gerät (höchstens SKETCH_CHUNK Punkte je
// Nachricht, SKETCH_MAX_POINTS je Durchgang), gezählt nur im Nachfahrfenster
// nach Serverzeit samt kurzer Schonfrist.
const SKETCH_ROUNDS = 3;
const SKETCH_LEAD_MS = 900;
const SKETCH_DRAW_MS = 2600;           // der grosse Stift zeichnet vor
const SKETCH_TRACE_MS = 6500;          // nachfahren
const SKETCH_SCORE_MS = 2400;          // vergleichen
const SKETCH_CYCLE_MS = SKETCH_DRAW_MS + SKETCH_TRACE_MS + SKETCH_SCORE_MS;
const SKETCH_DURATION_MS = SKETCH_LEAD_MS + SKETCH_ROUNDS * SKETCH_CYCLE_MS + 400;
const SKETCH_TOLERANCE = 0.024;        // Brettbreite = 1; bis hierher voll, bis zum Doppelten weniger
const SKETCH_CHUNK = 48;
const SKETCH_MAX_POINTS = 600;
const SKETCH_GRACE_MS = 150;
const SKETCH_PACKED_POINTS = 90;       // so viele Punkte je Spieler gehen ans Gerät

function sketchPhase(elapsed) {
  const t = elapsed - SKETCH_LEAD_MS;
  if (t < 0) return { phase: "lead", round: 0, since: elapsed };
  const round = Math.floor(t / SKETCH_CYCLE_MS);
  if (round >= SKETCH_ROUNDS) return { phase: "over", round: SKETCH_ROUNDS - 1, since: t - SKETCH_ROUNDS * SKETCH_CYCLE_MS };
  const inner = t - round * SKETCH_CYCLE_MS;
  if (inner < SKETCH_DRAW_MS) return { phase: "draw", round, since: inner };
  if (inner < SKETCH_DRAW_MS + SKETCH_TRACE_MS) return { phase: "trace", round, since: inner - SKETCH_DRAW_MS };
  return { phase: "score", round, since: inner - SKETCH_DRAW_MS - SKETCH_TRACE_MS };
}

function sketchRound3(value) {
  return Math.round(value * 1000) / 1000;
}

const sketch = {
  cooldown: 0,
  fastHand: true,
  create(arcade) {
    const figures = Sketch.pickFigures(arcade.seed, SKETCH_ROUNDS);
    arcade.sketch = {
      figures,
      rounds: SKETCH_ROUNDS,
      leadMs: SKETCH_LEAD_MS,
      drawMs: SKETCH_DRAW_MS,
      traceMs: SKETCH_TRACE_MS,
      scoreMs: SKETCH_SCORE_MS,
      tolerance: SKETCH_TOLERANCE,
      scored: -1
    };
    arcade.sketchPaths = figures.map((name) => Sketch.figurePath(name));
    Object.values(arcade.players).forEach((entry) => {
      entry.strokes = [];
      entry.strokeLen = 0;
      entry.strokeRound = -1;
      entry.results = [];              // je Durchgang { points, coverage, precision }
      entry.score = 0;
      entry.lastStrokeAt = 0;
    });
  },
  input(ctx, player, entry, input) {
    if (input.action !== "stroke") return { ok: false, error: "Fahr die Figur mit dem Finger nach." };
    const { phase, round } = sketchPhase(ctx.elapsed - SKETCH_GRACE_MS);
    const now = sketchPhase(ctx.elapsed);
    if (now.phase !== "trace" && !(phase === "trace" && now.round === round)) return { ok: true };
    const current = now.phase === "trace" ? now.round : round;
    if (ctx.arcade.sketch.scored >= current) return { ok: true };
    if (entry.strokeRound !== current) {
      entry.strokeRound = current;
      entry.strokes = [];
      entry.strokeLen = 0;
    }
    const raw = Array.isArray(input.pts) ? input.pts.slice(0, SKETCH_CHUNK) : [];
    const points = [];
    raw.forEach((point) => {
      if (!Array.isArray(point)) return;
      const x = inputNumber(point[0]);
      const y = inputNumber(point[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push([sketchRound3(clamp(x, 0, 1)), sketchRound3(clamp(y, 0, 1))]);
    });
    if (!points.length) return { ok: true };
    const room = SKETCH_MAX_POINTS - entry.strokeLen;
    if (room <= 0) return { ok: true };
    if (input.start || !entry.strokes.length) entry.strokes.push([]);
    const add = points.slice(0, room);
    entry.strokes[entry.strokes.length - 1].push(...add);
    entry.strokeLen += add.length;
    entry.lastStrokeAt = ctx.now;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, elapsed } = ctx;
    const state = arcade.sketch;
    // Gewertet wird nach der Schonfrist hinter dem Nachfahren, für alle
    // gleichzeitig.
    const graced = sketchPhase(elapsed - SKETCH_GRACE_MS);
    const due = graced.phase === "score" || graced.phase === "over" ? graced.round : graced.round - 1;
    while (state.scored < due) {
      state.scored += 1;
      const path = arcade.sketchPaths[state.scored];
      Object.values(arcade.players).forEach((entry) => {
        const strokes = entry.strokeRound === state.scored ? entry.strokes : [];
        const result = Sketch.scoreStroke(path, strokes, SKETCH_TOLERANCE);
        entry.results[state.scored] = result;
        entry.score += result.points;
      });
    }
  },
  bot(ctx, player, entry) {
    const { arcade, now, elapsed } = ctx;
    const { phase, round, since } = sketchPhase(elapsed);
    if (phase !== "trace") return null;
    if (entry.botRound !== round) {
      entry.botRound = round;
      // Der Bot fährt die Figur mit einer weichen, festen Abweichung nach —
      // wie eine leicht zitternde Hand —, und der schwache lässt am Ende
      // etwas aus.
      const path = arcade.sketchPaths[round];
      const wobble = byLevel(entry, 0.034, 0.022, 0.012);
      const reach = byLevel(entry, 0.8, 0.93, 1);
      const phaseA = Math.random() * 6;
      const phaseB = Math.random() * 6;
      const stop = Math.max(2, Math.floor(path.length * reach));
      entry.botPlan = path.slice(0, stop).map(([x, y], i) => [
        clamp(x + Math.sin(i * 0.11 + phaseA) * wobble, 0, 1),
        clamp(y + Math.cos(i * 0.13 + phaseB) * wobble, 0, 1)
      ]);
      entry.botSent = 0;
      entry.botStartMs = byLevel(entry, 700, 450, 300) + Math.random() * 300;
      entry.botSpanMs = SKETCH_TRACE_MS * byLevel(entry, 0.8, 0.7, 0.6);
    }
    if (since < entry.botStartMs || now - (entry.botLastAt || 0) < 90) return null;
    const share = clamp((since - entry.botStartMs) / entry.botSpanMs, 0, 1);
    const want = Math.floor(share * entry.botPlan.length);
    if (want <= entry.botSent) return null;
    const chunk = entry.botPlan.slice(entry.botSent, Math.min(want, entry.botSent + SKETCH_CHUNK));
    const start = entry.botSent === 0;
    entry.botSent += chunk.length;
    entry.botLastAt = now;
    return { action: "stroke", pts: chunk, start };
  },
  rank(arcade, entry) {
    // Punkte zuerst; bei Gleichstand die bessere Abdeckung.
    const coverage = (entry.results || []).reduce((sum, r) => sum + (r?.coverage || 0), 0);
    return Math.max(0, Math.round(entry.score || 0)) * 1000 + Math.min(999, Math.round(coverage * 333));
  },
  detail(arcade, entry) {
    return { kind: "points", value: Math.max(0, Math.round(entry.score || 0)), label: "Punkte" };
  },
  done(ctx) {
    return sketchPhase(ctx.elapsed).phase === "over";
  },
  // Die Striche gehen gepackt ans Gerät (zwei Zeichen je Punkt, höchstens
  // SKETCH_PACKED_POINTS je Spieler), die Figuren als Namen — die Bahn
  // rechnet jedes Gerät selbst aus SketchFigures.
  publicView(arcade) {
    const { sketchPaths, players, ...rest } = arcade;
    const view = {};
    Object.entries(players || {}).forEach(([id, entry]) => {
      const { strokes, ...shown } = entry;
      view[id] = { ...shown, trail: Sketch.packStrokes(strokes || [], SKETCH_PACKED_POINTS) };
    });
    return { ...rest, players: view };
  }
};

const PARTY_FAMILIES = {
  tug,
  face,
  flags,
  honey,
  snow,
  hockey,
  book,
  photo,
  boat,
  pipes,
  sketch
};

// Katalogeinträge: dieselbe Form wie MINIGAMES und ARCADE_CONFIGS in server.js.
const PARTY_GAMES = [
  { type: "tauziehen", title: "Tauziehen", duration: TUG_DURATION_MS, arcadeFamily: "tug", seed: 811 },
  { type: "grimassen", title: "Grimassen", duration: FACE_DURATION_MS, arcadeFamily: "face", seed: 823 },
  { type: "flaggenhoch", title: "Flaggen hoch", duration: FLAG_DURATION_MS, arcadeFamily: "flags", seed: 827 },
  { type: "honigwabe", title: "Honigwabe", duration: HONEY_DURATION_MS, arcadeFamily: "honey", seed: 829 },
  { type: "schneeball", title: "Schneeballhang", duration: SNOW_DURATION_MS, arcadeFamily: "snow", seed: 839 },
  { type: "luftpuck", title: "Luftpuck", duration: HOCKEY_DURATION_MS, arcadeFamily: "hockey", seed: 853 },
  { type: "buecherwurm", title: "Bücherwurm", duration: BOOK_DURATION_MS, arcadeFamily: "book", seed: 857 },
  { type: "schnappschuss", title: "Schnappschuss", duration: PHOTO_DURATION_MS, arcadeFamily: "photo", seed: 859 },
  { type: "kippboot", title: "Kippboot", duration: BOAT_DURATION_MS, arcadeFamily: "boat", seed: 863 },
  { type: "rohrsalat", title: "Rohrsalat", duration: PIPE_DURATION_MS, arcadeFamily: "pipes", seed: 877 },
  { type: "spurmaler", title: "Spurmaler", duration: SKETCH_DURATION_MS, arcadeFamily: "sketch", seed: 499 }
];

module.exports = {
  PARTY_FAMILIES,
  PARTY_GAMES,
  constants: {
    TUG_LEAD_MS, TUG_ROUND_MS, TUG_SHOW_MS, TUG_DURATION_MS,
    TUG_IMPULSE, TUG_MIN_TAP_MS,
    FACE_HANDLES, FACE_ROUNDS, FACE_LEAD_MS, FACE_SHOW_MS, FACE_SHAPE_MS, FACE_REVEAL_MS, FACE_CYCLE_MS, FACE_GRACE_MS,
    FLAG_LEAD_MS, FLAG_LIVES, FLAG_DURATION_MS, FLAG_GRACE_MS, FLAG_PUBLISH_LEAD_MS, FLAG_MIN_PRESS_MS,
    HONEY_LEAD_MS, HONEY_TURN_MS, HONEY_GAP_MS, HONEY_STING_MS, HONEY_VINE, HONEY_GOLD, HONEY_STING_COST, HONEY_GRACE_MS,
    SNOW_W, SNOW_D, SNOW_THROW_MIN, SNOW_MIN_SIZE, SNOW_STUN_MS, SNOW_BODY_R, SNOW_STEP_MS, SNOW_GIANT, SNOW_GROW,
    HOCKEY_W, HOCKEY_L, HOCKEY_GOAL, HOCKEY_WIN, HOCKEY_PUCK_R, HOCKEY_MALLET_R, HOCKEY_SERVE_MS, HOCKEY_STEP_MS, HOCKEY_LANE_STURM, HOCKEY_LANE_ABWEHR,
    BOOK_W, BOOK_D, BOOK_LIVES, BOOK_FLAT_MS, BOOK_STEP_MS, BOOK_PUBLISH_LEAD_MS, BOOK_INSIDE,
    PHOTO_W, PHOTO_D, PHOTO_IN, PHOTO_COVER, PHOTO_SOLO, PHOTO_SHOVE_COOLDOWN_MS, PHOTO_STEP_MS, PHOTO_PUBLISH_LEAD_MS,
    PHOTO_SHOVE_STUN_MS, PHOTO_DASH_MS,
    BOAT_LEAD_MS, BOAT_REACH, BOAT_TORQUE_MAX, BOAT_CAPACITY, BOAT_CAPSIZE_COST, BOAT_DEPART_BONUS, BOAT_DURATION_MS, BOAT_END_MS,
    BOAT_TURN_MS, BOAT_TURN_MIN_MS, BOAT_SPLASH_MS,
    PIPE_ROUNDS, PIPE_LEAD_MS, PIPE_ANSWER_MS, PIPE_REVEAL_MS, PIPE_LEVELS, PIPE_POINTS, PIPE_SPEED_BONUS,
    PIPE_GRACE_MS, PIPE_ALL_IN_MS, PIPE_PUBLISH_LEAD_MS, PIPE_DURATION_MS,
    SKETCH_ROUNDS, SKETCH_LEAD_MS, SKETCH_DRAW_MS, SKETCH_TRACE_MS, SKETCH_SCORE_MS, SKETCH_CYCLE_MS,
    SKETCH_DURATION_MS, SKETCH_TOLERANCE, SKETCH_CHUNK, SKETCH_MAX_POINTS, SKETCH_GRACE_MS
  },
  sketchPhase,
  buildPipeRound,
  pipeTrace,
  pipePhase,
  boatSwingX,
  boatTorque,
  boatPoints,
  boatRounds,
  boatRoundKind,
  boatBestAim,
  buildPhotoShots,
  buildBookPages,
  bookInHole,
  bookHolePoints,
  BOOK_SHAPES,
  snowBallRadius,
  snowValue,
  snowStep,
  snowThrowBall,
  hockeyStep,
  hockeyMallets,
  hockeyLimits,
  bookStep,
  photoStep,
  buildHoneyVine,
  honeyCombAt,
  honeyRisk,
  buildFlagCommands,
  activeFlagCommand,
  faceTarget,
  faceError,
  facePoints,
  facePhase
};
