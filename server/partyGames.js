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
// Zwei Teams am Seil über einer Schlammgrube. Tippen zieht — aber jeder Zug
// kostet Griffkraft, und die kommt nur langsam wieder. Wer wild hämmert,
// rutscht ab und schenkt dem anderen Team einen Ruck. Wer im Takt bleibt
// (knapp fünf Züge pro Sekunde), zieht am längsten mit voller Kraft.
//
// Ziehen zwei aus demselben Team fast gleichzeitig, gibt es ein „Hau-Ruck":
// der Zug zählt anderthalbfach. Das ist der Teil, bei dem man sich am Tisch
// anschreit.
//
// Drei Durchgänge, wer zwei gewinnt, hat gewonnen. Ein Durchgang ist vorbei,
// sobald die Seilmitte über die Linie eines Teams gezogen ist — oder nach
// elf Sekunden; dann gewinnt, auf wessen Seite das Seil gerade steht.
const TUG_LEAD_MS = 1600;
const TUG_ROUND_MS = 11000;
const TUG_SHOW_MS = 2600;
const TUG_ROUNDS = 3;
const TUG_WINS = 2;
const TUG_DURATION_MS = TUG_LEAD_MS + TUG_ROUNDS * (TUG_ROUND_MS + TUG_SHOW_MS) + 500;
const TUG_IMPULSE = 0.12;              // Seiltempo je Zug bei voller Kraft
const TUG_DAMP = 2.2;                  // so schnell kommt das Seil zur Ruhe (1/s)
const TUG_GRIP_COST = 0.085;           // Griffkraft je Zug
const TUG_GRIP_REGEN = 0.42;           // je Sekunde zurück — knapp fünf Züge/s halten
const TUG_SLIP_MS = 900;
const TUG_SLIP_JOLT = 0.16;            // Ruck zum Gegner beim Abrutschen
const TUG_SYNC_MS = 140;               // so knapp hintereinander gilt als gemeinsam
const TUG_SYNC_BONUS = 1.35;
const TUG_MIN_TAP_MS = 60;             // schneller tippt kein Daumen
const TUG_DUMMY = [0.26, 0.32, 0.38];  // Zug des Sandsacks, wenn man allein spielt

function tugPhaseAt(arcade, elapsed) {
  const tug = arcade.tug;
  if (elapsed < TUG_LEAD_MS) return { phase: "lead", round: 0 };
  return { phase: tug.phase, round: tug.round };
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
      entry.grip = 1;
      entry.slipUntil = 0;
      entry.taps = 0;
      entry.work = 0;
      entry.syncs = 0;
      entry.slips = 0;
      entry.lastTapAt = 0;
      entry.lastSyncAt = 0;
      entry.teamWins = 0;
      entry.score = 0;
    });
    const sizes = [0, 1].map((side) => tugTeamSize(arcade, side));
    const larger = Math.max(1, ...sizes);
    arcade.tug = {
      pos: 0,                          // -1 = Team links hat gewonnen, +1 = rechts
      vel: 0,
      round: 0,
      phase: "lead",
      roundStartAt: TUG_LEAD_MS,       // Rundenzeit ab Spielbeginn
      showUntil: 0,
      results: [],                     // je Durchgang: 0, 1 oder null (unentschieden)
      wins: [0, 0],
      solo: players.length === 1,
      // Kraft je Zug nach Teamgrösse: der Einzelne gegen zwei zieht doppelt,
      // dazu ein Aufschlag, weil ihm das Hau-Ruck fehlt.
      factor: sizes.map((size) => (size ? (larger / size) * (size < larger ? 1.25 : 1) : 0)),
      lastWinner: null,
      winAt: 0,
      rounds: TUG_ROUNDS,
      roundMs: TUG_ROUND_MS,
      showMs: TUG_SHOW_MS,
      leadMs: TUG_LEAD_MS
    };
  },
  input(ctx, player, entry, input) {
    if (input.action !== "pull") return { ok: false, error: "Tippe, um zu ziehen." };
    const { arcade, now, elapsed } = ctx;
    const state = arcade.tug;
    if (tugPhaseAt(arcade, elapsed).phase !== "pull") return { ok: true };
    if (now - entry.lastTapAt < TUG_MIN_TAP_MS) return { ok: true };
    if (now < entry.slipUntil) return { ok: true };
    entry.lastTapAt = now;
    entry.taps += 1;
    if (entry.grip < TUG_GRIP_COST) {
      // Abgerutscht: der Zug geht ins Leere, und das Seil ruckt zum Gegner.
      entry.slipUntil = now + TUG_SLIP_MS;
      entry.slips += 1;
      entry.grip = 0.3;
      state.vel += (entry.side === 0 ? 1 : -1) * TUG_SLIP_JOLT;
      return { ok: true };
    }
    const force = 0.45 + 0.55 * entry.grip;
    entry.grip = Math.max(0, entry.grip - TUG_GRIP_COST);
    let multiplier = state.factor[entry.side] || 1;
    const mate = Object.values(arcade.players).find((other) => other !== entry
      && other.side === entry.side && now - other.lastTapAt <= TUG_SYNC_MS && other.lastTapAt > 0);
    if (mate) {
      multiplier *= TUG_SYNC_BONUS;
      entry.syncs += 1;
      entry.lastSyncAt = now;
      mate.lastSyncAt = now;
    }
    const impulse = TUG_IMPULSE * force * multiplier;
    state.vel += (entry.side === 0 ? -1 : 1) * impulse;
    entry.work += impulse;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, now, elapsed } = ctx;
    const state = arcade.tug;
    const dt = Math.min(0.12, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const entries = Object.values(arcade.players);
    entries.forEach((entry) => {
      if (now >= entry.slipUntil) entry.grip = Math.min(1, entry.grip + TUG_GRIP_REGEN * dt);
    });
    if (elapsed < TUG_LEAD_MS) return;
    if (state.phase === "lead") {
      state.phase = "pull";
      state.round = 0;
      state.roundStartAt = TUG_LEAD_MS;
    }
    if (state.phase === "pull") {
      if (state.solo) {
        // Allein zieht ein Sandsack dagegen, jeden Durchgang etwas kräftiger.
        state.vel += TUG_DUMMY[Math.min(TUG_DUMMY.length - 1, state.round)] * TUG_IMPULSE * 8 * dt;
      }
      state.vel *= Math.exp(-TUG_DAMP * dt);
      state.pos += state.vel * dt;
      const over = Math.abs(state.pos) >= 1;
      const timeUp = elapsed - state.roundStartAt >= TUG_ROUND_MS;
      if (over || timeUp) {
        state.pos = clamp(state.pos, -1, 1);
        const winner = Math.abs(state.pos) < 0.02 ? null : state.pos < 0 ? 0 : 1;
        state.results.push(winner);
        if (winner !== null) state.wins[winner] += 1;
        state.lastWinner = winner;
        state.winAt = elapsed;
        state.decidedBy = over ? "line" : "time";
        // Nach Ablauf der Zeit gibt es den letzten Ruck trotzdem: wer vorn
        // liegt, zieht das andere Team in den Schlamm. Sonst endete die Hälfte
        // der Durchgänge ohne das, worauf alle warten.
        if (winner !== null) state.pos = winner === 0 ? -1 : 1;
        state.phase = "show";
        state.showUntil = elapsed + TUG_SHOW_MS;
        state.vel = 0;
        entries.forEach((entry) => { entry.teamWins = state.wins[entry.side]; });
      }
      return;
    }
    if (state.phase === "show" && elapsed >= state.showUntil) {
      const decided = state.wins.some((wins) => wins >= TUG_WINS) || state.results.length >= TUG_ROUNDS;
      if (decided) {
        state.phase = "over";
        return;
      }
      state.phase = "pull";
      state.round += 1;
      state.roundStartAt = elapsed;
      state.pos = 0;
      state.vel = 0;
      entries.forEach((entry) => {
        entry.grip = 1;
        entry.slipUntil = 0;
      });
    }
  },
  bot(ctx, player, entry) {
    const { arcade, now, elapsed } = ctx;
    if (tugPhaseAt(arcade, elapsed).phase !== "pull") {
      entry.botNextAt = 0;
      return null;
    }
    if (now < entry.slipUntil) return null;
    if (!entry.botNextAt) entry.botNextAt = now + byLevel(entry, 500, 320, 200) * Math.random();
    // Der starke Bot hängt sich an den Zug seines Mitspielers (Hau-Ruck).
    const mateJustPulled = level(entry) !== "easy" && Object.values(arcade.players).some((other) => other !== entry
      && other.side === entry.side && now - other.lastTapAt < 90);
    if (now < entry.botNextAt && !(mateJustPulled && now > entry.botNextAt - 90)) return null;
    // Takt und Übermut je Stufe: der starke hält knapp unter der Grenze und
    // wartet, wenn die Kraft knapp wird; der schwache hämmert gern drauflos.
    const rest = byLevel(entry, 0, 0.18, 0.22);
    if (entry.grip < rest) {
      entry.botNextAt = now + 180;
      return null;
    }
    const mash = Math.random() < byLevel(entry, 0.5, 0.2, 0.04);
    const base = mash ? 110 : byLevel(entry, 300, 235, 206);
    // Vom geplanten Zeitpunkt aus weiterzählen, nicht von jetzt: der Bot wird
    // nur alle 120 bis 180 ms gefragt, und von jetzt an gezählt fiele jeder
    // Zug um einen halben Takt zu spät — der ruhige Takt des starken Bots
    // wäre dann langsamer als das Hämmern des schwachen.
    const planned = Math.max(entry.botNextAt, now - 150);
    entry.botNextAt = planned + base * (0.9 + Math.random() * 0.2);
    return { action: "pull" };
  },
  rank(arcade, entry) {
    const wins = arcade.tug?.wins?.[entry.side] || 0;
    return wins * 1000000 + Math.round((entry.work || 0) * 100);
  },
  detail(arcade, entry) {
    return { kind: "points", value: arcade.tug?.wins?.[entry.side] || 0, label: "Runden" };
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
const FACE_SHAPE_MS = 9000;            // formen
const FACE_REVEAL_MS = 2800;           // Auflösung
const FACE_CYCLE_MS = FACE_SHOW_MS + FACE_SHAPE_MS + FACE_REVEAL_MS;
const FACE_DURATION_MS = FACE_LEAD_MS + FACE_ROUNDS * FACE_CYCLE_MS + 400;
const FACE_MAX_POINTS = 100;
const FACE_MIN_NEUTRAL = 0.3;         // so weit liegt ein Vorbild mindestens von neutral
const FACE_MIN_INPUT_MS = 40;

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
function facePoints(error, target) {
  const neutral = Math.max(FACE_MIN_NEUTRAL, faceError(new Array(FACE_HANDLES.length * 2).fill(0), target));
  const share = clamp(1 - error / neutral, 0, 1);
  return Math.round(FACE_MAX_POINTS * Math.pow(share, 1.15));
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
    const { phase } = facePhase(ctx.elapsed);
    if (phase !== "shape") return { ok: true };
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
    // Gewertet wird genau beim Übergang ins Auflösen — für alle gleichzeitig.
    const due = phase === "reveal" || phase === "over" ? round : round - 1;
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
      const miss = byLevel(entry, 0.42, 0.24, 0.1);
      entry.botAim = arcade.face.targets[round].map((value) => clamp(value + (Math.random() * 2 - 1) * miss, -1, 1));
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
// so schnell sie können. Manchmal zuckt er nur an und lässt die Fahne wieder
// sinken: wer dann drückt, ist reingefallen. Die Kommandos kommen immer
// schneller, das Antwortfenster wird enger. Drei Fehler, und man ist raus.
//
// Gewertet werden die richtigen Antworten; wer ausscheidet, sammelt eben
// nicht weiter. Bei Gleichstand zählt die schnellere Hand.
const FLAG_LEAD_MS = 1800;
const FLAG_GAP_START = 1900;
const FLAG_GAP_END = 950;
const FLAG_WINDOW_START = 1500;
const FLAG_WINDOW_END = 700;
const FLAG_DURATION_MS = 36000;
const FLAG_LIVES = 3;
const FLAG_FAKE_SHARE = 0.2;
const FLAG_BOTH_SHARE = 0.16;
const FLAG_MIN_PRESS_MS = 35;

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

function activeFlagCommand(commands, elapsed) {
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const c = commands[i];
    if (elapsed >= c.at) return elapsed <= c.at + c.window ? c : null;
  }
  return null;
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
    arcade.flags = {
      commands: buildFlagCommands(arcade.seed),
      lives: FLAG_LIVES
    };
    Object.values(arcade.players).forEach((entry) => {
      entry.lives = FLAG_LIVES;
      entry.correct = 0;
      entry.mistakes = 0;
      entry.reactionSum = 0;
      entry.answers = {};              // Kommandonummer → { result, at, reaction }
      entry.pressed = {};              // Kommandonummer → { red, blue }
      entry.outAt = null;
      entry.lastPressAt = 0;
      entry.lastMistakeAt = -1;
      entry.raised = null;             // zuletzt gehobene Fahne, fürs Bild
      entry.score = 0;
    });
  },
  input(ctx, player, entry, input) {
    if (input.action !== "flag" || !["red", "blue"].includes(input.flag)) return { ok: false, error: "Rot oder Blau?" };
    if (entry.outAt) return { ok: true };
    if (ctx.now - entry.lastPressAt < FLAG_MIN_PRESS_MS) return { ok: true };
    entry.lastPressAt = ctx.now;
    entry.raised = { flag: input.flag, at: ctx.elapsed };
    const command = activeFlagCommand(ctx.arcade.flags.commands, ctx.elapsed);
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
    // Abgelaufene Fenster abrechnen: echte Kommandos ohne Antwort sind zu spät,
    // Täuschungen ohne Druck sind richtig.
    arcade.flags.commands.forEach((command) => {
      if (elapsed <= command.at + command.window) return;
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
    const command = activeFlagCommand(arcade.flags.commands, elapsed);
    if (!command || entry.answers[command.index]) return null;
    if (entry.botCommand !== command.index) {
      entry.botCommand = command.index;
      const profile = entry.botProfile || { level: "normal", reactionMs: 550, spreadMs: 340, mistake: 0.16 };
      entry.botReactAt = command.at + Math.max(180, (profile.reactionMs || 550) * 0.8 + (Math.random() - 0.3) * (profile.spreadMs || 300));
      const r = Math.random();
      const fooled = byLevel(entry, 0.5, 0.25, 0.08);
      const wrong = byLevel(entry, 0.12, 0.05, 0.015);
      entry.botPlan = command.kind === "fake"
        ? (r < fooled ? [command.side] : [])
        : command.kind === "both"
          ? ["red", "blue"]
          : [r < wrong ? (command.kind === "red" ? "blue" : "red") : command.kind];
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
    const commands = arcade.flags.commands;
    const last = commands[commands.length - 1];
    if (last && elapsed > last.at + last.window + 600) return true;
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
// Danach kostete ein Stich die HÄLFTE des Korbs. Damit entschied fast nur,
// wann der letzte Stich kam: früh gestochen kostete nichts, spät gestochen
// alles — egal, wie gut man vorher gezählt hatte. Gemessen lag der starke Bot
// im Schnitt sogar hinter dem schwachen. Ein Stich kostet jetzt immer gleich
// viel, und jeder vermiedene Stich zählt gleich.
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
const HONEY_STING_COST = 4;            // so viele Früchte fallen beim Stich herunter
const HONEY_PASSES = 1;                // so oft darf jeder seinen Zug weiterschieben

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
  if (state.orderFor === state.vineNumber && state.order?.length === ids.length && ids.every((id) => state.order.includes(id))) return state.order;
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(noise(arcade.seed + state.vineNumber * 131 + i * 17) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  state.order = order;
  state.orderFor = state.vineNumber;
  return order;
}

function honeyNextTurn(ctx, afterId, delay, fresh = false) {
  const { arcade, room, elapsed } = ctx;
  const state = arcade.honey;
  const order = honeyOrder(arcade, room);
  if (!order.length) return;
  // Mit einer neuen Ranke beginnt die neue Reihenfolge vorn — ausser der
  // Erste wäre der, der gerade gepflückt hat; dann der Zweite.
  const index = fresh
    ? (order[0] === afterId && order.length > 1 ? 1 : 0)
    : (order.indexOf(afterId) + 1) % order.length;
  const turnMs = Math.max(HONEY_TURN_MIN_MS, HONEY_TURN_MS - state.turns * 50);
  const from = elapsed + delay;
  // Kein Zug mehr, der nicht mehr zu Ende gespielt werden kann.
  if (from + 900 > HONEY_DURATION_MS) {
    state.turn = null;
    return;
  }
  state.turn = { playerId: order[index], from, until: Math.min(HONEY_DURATION_MS - 200, from + turnMs), number: state.turns };
  state.turns += 1;
}

function honeyTake(ctx, player, entry, count) {
  const { arcade, elapsed } = ctx;
  const state = arcade.honey;
  const taken = state.vine.splice(0, Math.min(count, state.vine.length));
  const stung = taken.includes("comb");
  const fruits = taken.filter((item) => item !== "comb").reduce((sum, item) => sum + (item === "gold" ? HONEY_GOLD : 1), 0);
  let dropped = 0;
  if (stung) {
    dropped = Math.min(entry.fruits, HONEY_STING_COST);
    entry.fruits -= dropped;
    entry.stings += 1;
    entry.stungAt = elapsed;
  } else {
    entry.fruits += fruits;
    entry.golds += taken.filter((item) => item === "gold").length;
  }
  entry.score = entry.fruits;
  entry.picks += 1;
  state.last = { playerId: player.id, taken, stung, dropped, gained: stung ? 0 : fruits, at: elapsed, auto: false, number: state.picks };
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
      turnMs: HONEY_TURN_MS
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
    if (turn && elapsed >= turn.until) {
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
        if (level(entry) === "hard") entry.botPass = k === 0 || (late && k === 3 && entry.fruits >= HONEY_STING_COST);
        else if (level(entry) === "normal") entry.botPass = k === 0 && Math.random() < 0.7;
        else entry.botPass = Math.random() < 0.18;
      }
      let count;
      if (k === 0) count = 1;                                   // verloren, so oder so
      else if (level(entry) === "hard") {
        // Gewinn gegen Risiko: ein Stich kostet einen festen Teil des Korbs,
        // dazu die Pause danach.
        const loss = Math.min(entry.fruits, HONEY_STING_COST) + 1.5;
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
    // Früchte zuerst; bei Gleichstand, wer seltener gestochen wurde.
    return (entry.fruits || 0) * 100 + Math.max(0, 99 - (entry.stings || 0));
  },
  detail(arcade, entry) {
    return { kind: "points", value: entry.fruits || 0, label: "Früchte" };
  },
  done() {
    return false;
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
const SNOW_W = 7;                      // Breite des Feldes
const SNOW_D = 9;                      // Tiefe
const SNOW_DURATION_MS = 42000;
const SNOW_SPEED = 3.3;                // Laufen ohne Kugel
const SNOW_BALL_DRAG = 0.38;           // so viel langsamer mit voller Kugel
const SNOW_ACCEL = 14;
const SNOW_TURN = 9;                   // rad/s
const SNOW_GROW = 0.24;                // Kugelgrösse je Sekunde bei voller Fahrt
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

function snowBallRadius(size) {
  return 0.12 + size * 0.26;
}

function snowValue(size) {
  return size >= 0.85 ? 3 : size >= 0.6 ? 2 : 1;
}

function snowSpawn(index, count) {
  const spots = [[-2.2, -3], [2.2, 3], [2.2, -3], [-2.2, 3]];
  const [x, z] = spots[index % spots.length];
  return { x, z, heading: Math.atan2(-x, -z) };
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
    const r = snowBallRadius(entry.size);
    const hx = Math.sin(entry.heading);
    const hz = Math.cos(entry.heading);
    arcade.snow.balls.push({
      id: arcade.snow.nextBall,
      owner: player.id,
      x: entry.x + hx * (SNOW_BODY_R + r + 0.05),
      z: entry.z + hz * (SNOW_BODY_R + r + 0.05),
      vx: hx * SNOW_BALL_SPEED + entry.vx * 0.3,
      vz: hz * SNOW_BALL_SPEED + entry.vz * 0.3,
      size: entry.size,
      r,
      value: snowValue(entry.size),
      bornAt: now,
      spin: 0
    });
    arcade.snow.nextBall += 1;
    entry.size = SNOW_MIN_SIZE;
    entry.lastThrowAt = now;
    entry.throws += 1;
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, now } = ctx;
    const state = arcade.snow;
    const dt = Math.min(0.12, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const halfW = SNOW_W / 2 - SNOW_BODY_R;
    const halfD = SNOW_D / 2 - SNOW_BODY_R;
    const entries = room.players.map((player) => ({ id: player.id, entry: arcade.players[player.id] })).filter((e) => e.entry);
    state.bursts = state.bursts.filter((b) => now - b.at < 1500);

    entries.forEach(({ entry }) => {
      const stunned = now < entry.stunUntil;
      const want = stunned ? 0 : Math.min(1, Math.hypot(entry.dirX, entry.dirZ));
      const top = SNOW_SPEED * (1 - SNOW_BALL_DRAG * entry.size);
      const dx = stunned ? 0 : entry.dirX;
      const dz = stunned ? 0 : entry.dirZ;
      entry.vx += (dx * top - entry.vx) * Math.min(1, SNOW_ACCEL * dt);
      entry.vz += (dz * top - entry.vz) * Math.min(1, SNOW_ACCEL * dt);
      entry.x = clamp(entry.x + entry.vx * dt, -halfW, halfW);
      entry.z = clamp(entry.z + entry.vz * dt, -halfD, halfD);
      const speed = Math.hypot(entry.vx, entry.vz);
      // Die Kugel wächst nur, wenn man sie wirklich rollt.
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
    state.balls.forEach((ball) => {
      const speed = Math.hypot(ball.vx, ball.vz);
      const slower = Math.max(0, speed - SNOW_BALL_FRICTION * dt);
      if (speed > 0) {
        ball.vx *= slower / speed;
        ball.vz *= slower / speed;
      }
      ball.x += ball.vx * dt;
      ball.z += ball.vz * dt;
      ball.spin += (slower / Math.max(0.1, ball.r)) * dt;
      // Am Zaun prallt sie ab und verliert Schwung.
      const limX = SNOW_W / 2 - ball.r;
      const limZ = SNOW_D / 2 - ball.r;
      if (Math.abs(ball.x) > limX) { ball.x = Math.sign(ball.x) * limX; ball.vx *= -0.55; ball.vz *= 0.8; }
      if (Math.abs(ball.z) > limZ) { ball.z = Math.sign(ball.z) * limZ; ball.vz *= -0.55; ball.vx *= 0.8; }
      if (slower < SNOW_BALL_STOP) {
        gone.add(ball.id);
        state.bursts.push({ x: ball.x, z: ball.z, size: ball.size, at: now, kind: "fizzle" });
        return;
      }
      // Treffer auf Figuren — nicht auf den Werfer, nicht auf Liegende.
      entries.forEach(({ id, entry }) => {
        if (gone.has(ball.id) || id === ball.owner) return;
        if (now < entry.stunUntil || now < entry.safeUntil) return;
        // Die eigene grosse Kugel vorn ist ein Schild.
        const hx = Math.sin(entry.heading);
        const hz = Math.cos(entry.heading);
        const shieldR = snowBallRadius(entry.size);
        const sx = entry.x + hx * (SNOW_BODY_R + shieldR);
        const sz = entry.z + hz * (SNOW_BODY_R + shieldR);
        if (entry.size >= 0.5 && Math.hypot(ball.x - sx, ball.z - sz) < ball.r + shieldR) {
          gone.add(ball.id);
          entry.size = SNOW_MIN_SIZE;
          entry.blocks += 1;
          state.bursts.push({ x: (ball.x + sx) / 2, z: (ball.z + sz) / 2, size: Math.max(ball.size, shieldR), at: now, kind: "block", by: id });
          return;
        }
        if (Math.hypot(ball.x - entry.x, ball.z - entry.z) < ball.r + SNOW_BODY_R) {
          gone.add(ball.id);
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
  },
  bot(ctx, player, entry) {
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
    const dodge = byLevel(entry, 0.15, 0.5, 0.85);
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
    const tolerance = byLevel(entry, 0.45, 0.3, 0.24);
    const reach = byLevel(entry, 4.8, 4.4, 4.6);
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


// --- Luftpuck --------------------------------------------------------------
//
// Airhockey, zwei gegen zwei. Jeder steht auf einer Schwebescheibe und bleibt
// in seiner Hälfte; der Puck gleitet fast ohne Reibung und prallt von den
// Banden ab. Das eigene Tor liegt für Team 0 vorn (zur Kamera), für Team 1
// hinten. Wer zuerst fünf Tore hat, gewinnt — sonst nach Ablauf der Zeit.
//
// Ein Einzelner gegen zwei bekommt eine grössere Scheibe; wer allein spielt,
// hat einen Torwart-Roboter gegen sich.
const HOCKEY_W = 4.4;                  // Tischbreite
const HOCKEY_L = 7.4;                  // Tischlänge
const HOCKEY_GOAL = 2.2;               // Torbreite
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
const HOCKEY_SERVE_MS = 1300;          // Pause nach einem Tor
const HOCKEY_SUBSTEPS = 5;
const HOCKEY_ROBOT = "robot";

function hockeyLimits(side, r) {
  // Team 0 unten (z > 0), Team 1 oben (z < 0); die Mittellinie ist die Grenze.
  const zMin = side === 0 ? 0.12 + r : -HOCKEY_L / 2 + r;
  const zMax = side === 0 ? HOCKEY_L / 2 - r : -0.12 - r;
  return { xMin: -HOCKEY_W / 2 + r, xMax: HOCKEY_W / 2 - r, zMin, zMax };
}

function hockeyServe(state, towardSide, now) {
  state.puck = { x: 0, z: 0, vx: 0, vz: 0 };
  state.serveAt = now + HOCKEY_SERVE_MS;
  state.serveToward = towardSide;
  state.lastTouch = null;
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
      goalW: HOCKEY_GOAL,
      puckR: HOCKEY_PUCK_R,
      score: [0, 0],
      win: HOCKEY_WIN,
      goals: [],                       // { side, by, at }
      puck: { x: 0, z: 0, vx: 0, vz: 0 },
      serveAt: 0,
      serveToward: 0,
      lastTouch: null,
      touches: 0,
      robot: robot ? { x: 0, z: -HOCKEY_L / 2 + 0.9, vx: 0, vz: 0, r: HOCKEY_MALLET_R } : null
    };
    const team = [[], []];
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const r = sizes[entry.side] < Math.max(...sizes) ? HOCKEY_SOLO_R : HOCKEY_MALLET_R;
      const slot = team[entry.side].length;
      team[entry.side].push(player.id);
      const count = sizes[entry.side];
      const x = count > 1 ? (slot === 0 ? -0.9 : 0.9) : 0;
      const z = (entry.side === 0 ? 1 : -1) * (count > 1 && slot === 1 ? 2.6 : 1.8);
      Object.assign(entry, { x, z, vx: 0, vz: 0, dirX: 0, dirZ: 0, r, role: slot === 0 ? "sturm" : "abwehr", goals: 0, ownGoals: 0, touches: 0, lastTouchAt: 0, score: 0 });
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
    const frame = Math.min(0.12, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const mallets = room.players.map((player) => ({ id: player.id, e: arcade.players[player.id] })).filter((m) => m.e);
    if (state.robot) mallets.push({ id: HOCKEY_ROBOT, e: state.robot, robot: true });
    const dt = frame / HOCKEY_SUBSTEPS;
    const serving = now < state.serveAt;
    if (!serving && state.serveAt && !state.served) {
      // Anstoss: der Puck rutscht langsam zu dem Team, das das Tor kassiert hat.
      state.served = true;
      state.puck.vz = (state.serveToward === 0 ? 1 : -1) * 1.1;
      state.puck.vx = (Math.random() - 0.5) * 0.6;
    }
    // Der Roboter hält die Mitte seines Tores und schiebt, was kommt, zurück.
    if (state.robot) {
      const p = state.puck;
      const tx = clamp(p.x * 0.7, -HOCKEY_GOAL / 2, HOCKEY_GOAL / 2);
      const tz = p.z < -0.6 && p.vz < 0.5 ? p.z - 0.2 : -HOCKEY_L / 2 + 0.9;
      const dx = tx - state.robot.x;
      const dz = tz - state.robot.z;
      const d = Math.hypot(dx, dz);
      state.robot.dirX = d > 0.05 ? (dx / d) * Math.min(1, d * 2) * 0.55 : 0;
      state.robot.dirZ = d > 0.05 ? (dz / d) * Math.min(1, d * 2) * 0.55 : 0;
    }
    for (let step = 0; step < HOCKEY_SUBSTEPS; step += 1) {
      mallets.forEach(({ e, robot }) => {
        const side = robot ? 1 : e.side;
        const speed = HOCKEY_SPEED * (e.r > HOCKEY_MALLET_R ? 1.08 : 1);
        e.vx += ((e.dirX || 0) * speed - e.vx) * Math.min(1, HOCKEY_ACCEL * dt);
        e.vz += ((e.dirZ || 0) * speed - e.vz) * Math.min(1, HOCKEY_ACCEL * dt);
        const lim = hockeyLimits(side, e.r);
        const nx = clamp(e.x + e.vx * dt, lim.xMin, lim.xMax);
        const nz = clamp(e.z + e.vz * dt, lim.zMin, lim.zMax);
        // Tatsächliche Geschwindigkeit (nach der Bande) — die gibt den Stoss.
        e.mvx = (nx - e.x) / dt;
        e.mvz = (nz - e.z) / dt;
        e.x = nx;
        e.z = nz;
      });
      // Scheiben untereinander (im selben Team) schieben sich auseinander.
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
          one.x -= (dx / dist) * push;
          one.z -= (dz / dist) * push;
          two.x += (dx / dist) * push;
          two.z += (dz / dist) * push;
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
        p.x = e.x + nx * min;
        p.z = e.z + nz * min;
        const rvx = p.vx - (e.mvx || 0);
        const rvz = p.vz - (e.mvz || 0);
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          p.vx -= (1 + HOCKEY_HIT_REST) * vn * nx;
          p.vz -= (1 + HOCKEY_HIT_REST) * vn * nz;
        }
        // Wer die Scheibe dagegen schiebt, gibt Schwung mit.
        p.vx += (e.mvx || 0) * 0.35;
        p.vz += (e.mvz || 0) * 0.35;
        if (id !== HOCKEY_ROBOT && now - (e.lastTouchAt || 0) > 150) {
          e.touches += 1;
          e.lastTouchAt = now;
          state.touches += 1;
        }
        state.lastTouch = id;
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
      const inMouth = Math.abs(p.x) < HOCKEY_GOAL / 2 - HOCKEY_PUCK_R * 0.4;
      if (Math.abs(p.z) > halfL && !inMouth) { p.z = Math.sign(p.z) * halfL; p.vz = -p.vz * HOCKEY_WALL_REST; }
      // Hat die Bande den Puck zurück in eine Scheibe geschoben (in der Ecke
      // eingekeilt), weicht die Scheibe — der Puck kann nicht in die Wand.
      mallets.forEach(({ e, robot }) => {
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const dist = Math.hypot(dx, dz);
        const min = e.r + HOCKEY_PUCK_R;
        if (dist >= min) return;
        const nx = dist < 1e-6 ? -Math.sign(p.x || 1) : dx / dist;
        const nz = dist < 1e-6 ? -Math.sign(p.z || 1) : dz / dist;
        const lim = hockeyLimits(robot ? 1 : e.side, e.r);
        e.x = clamp(p.x + nx * min, lim.xMin, lim.xMax);
        e.z = clamp(p.z + nz * min, lim.zMin, lim.zMax);
      });
      if (Math.abs(p.z) > HOCKEY_L / 2 + HOCKEY_PUCK_R) {
        // Tor! Vorn (z > 0) ist das Tor von Team 0 — getroffen hat Team 1.
        const scoringSide = p.z > 0 ? 1 : 0;
        state.score[scoringSide] += 1;
        const shooter = state.lastTouch && state.lastTouch !== HOCKEY_ROBOT ? arcade.players[state.lastTouch] : null;
        let by = null;
        if (shooter) {
          if (shooter.side === scoringSide) { shooter.goals += 1; by = state.lastTouch; }
          else shooter.ownGoals += 1;
        }
        state.goals.push({ side: scoringSide, by, at: now, x: p.x, own: Boolean(shooter && shooter.side !== scoringSide) });
        hockeyServe(state, 1 - scoringSide, now);
        state.served = false;
        break;
      }
    }
    // Festgeklemmt? Kommt der Puck anderthalb Sekunden lang nicht vom Fleck —
    // in einer Ecke eingekeilt oder still liegend —, bläst der Tisch ihn zur
    // Mitte. In der ersten Fassung lag er dort zwanzig Sekunden lang, während
    // eine Scheibe ihn gegen die Bande drückte.
    const p = state.puck;
    if (serving) {
      state.stuck = null;
    } else if (!state.stuck || Math.hypot(p.x - state.stuck.x, p.z - state.stuck.z) > 0.45) {
      state.stuck = { x: p.x, z: p.z, at: now };
    } else if (now - state.stuck.at > 1500) {
      p.vx = -Math.sign(p.x || 0.01) * 2.2 + (Math.random() - 0.5) * 0.6;
      p.vz = -Math.sign(p.z || 0.01) * 2.8;
      state.nudgeAt = now;
      state.nudges = (state.nudges || 0) + 1;
      state.stuck = { x: p.x, z: p.z, at: now };
    }
    const exp = Math.exp(-HOCKEY_PUCK_DAMP * frame);
    p.vx *= exp;
    p.vz *= exp;
    // Was die Bots „gesehen" haben: der Puck von vor ein paar Zehnteln. Ohne
    // diese Verzögerung stand der Torwart-Bot immer schon dort, wo der Schuss
    // hinging, und es fiel kaum ein Tor.
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
    const look = byLevel(entry, 0.05, 0.18, 0.2);
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
    const lim = hockeyLimits(side, entry.r);
    const oppGoalZ = -ownGoalZ;
    const nearOwnGoal = Math.abs(pz - ownGoalZ) < 2.2;
    if (inOwnHalf && (!defender || nearOwnGoal)) {
      // Schlagen: sich HINTER den Puck stellen — hinter heisst: auf der Linie
      // vom Zielpunkt im gegnerischen Tor durch den Puck — und durchziehen.
      // Der starke zielt in die Hälfte, die der gegnerische Torwart gerade
      // nicht deckt; der schwache schiesst geradeaus. Wer auf der falschen Seite
      // steht, geht aussen herum, statt den Puck ins eigene Tor zu schieben.
      const keepers = room.players.map((pl) => arcade.players[pl.id]).filter((e) => e && e.side !== side);
      if (state.robot) keepers.push(state.robot);
      const keeperX = keepers.length ? keepers.reduce((a, b) => (Math.abs(b.z - oppGoalZ) < Math.abs(a.z - oppGoalZ) ? b : a)).x : 0;
      const gx = byLevel(entry, 0, 0.45, 0.5) * (HOCKEY_GOAL / 2) * (keeperX > 0 ? -1 : 1);
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
        const sideX = entry.x >= px ? 1 : -1;
        tx = px + sideX * (reachBack + 0.25);
        tz = clamp(bz, lim.zMin, lim.zMax);
      } else {
        tx = bx;
        tz = bz;
      }
    } else {
      // Decken: zwischen Puck und eigenem Tor, näher am Tor.
      const share = defender ? 0.28 : 0.45;
      tx = clamp(px * 0.8, -HOCKEY_GOAL / 2 - 0.2, HOCKEY_GOAL / 2 + 0.2);
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
    const other = score[1 - entry.side] || 0;
    // Tore des Teams, dann Tordifferenz, dann eigene Tore, dann Ballkontakte.
    return own * 1000000 + Math.max(0, 50 + own - other) * 10000 + (entry.goals || 0) * 100 + Math.min(99, entry.touches || 0);
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
// ausgeschnitten. Wer beim Aufschlagen unter keinem Loch steht, wird platt
// gedrückt und verliert ein Leben. Die Löcher werden weniger und kleiner, die
// Seiten kommen schneller. Drei Leben; gewertet werden die überstandenen
// Seiten.
const BOOK_W = 6;
const BOOK_D = 7.6;
const BOOK_DURATION_MS = 42000;
const BOOK_FIRST_MS = 2200;
const BOOK_GAP_START = 3700;
const BOOK_GAP_END = 2500;
const BOOK_FLIP_START = 1900;          // so lange klappt die Seite heran
const BOOK_FLIP_END = 1150;
const BOOK_LIVES = 3;
const BOOK_FLAT_MS = 1500;
const BOOK_SPEED = 3.4;
const BOOK_ACCEL = 14;
const BOOK_BODY = 0.3;
const BOOK_BUMP = 0.64;
const BOOK_INSIDE = 0.1;               // so weit muss die Mitte im Loch liegen

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
    for (let h = 0; h < count; h += 1) {
      for (let tries = 0; tries < 30; tries += 1) {
        const k = seed + index * 101 + h * 13 + tries * 7;
        const w = Math.round((1.15 + noise(k) * 0.55) * size * 100) / 100 + 0.2;
        const d = Math.round((1.15 + noise(k + 3) * 0.55) * size * 100) / 100 + 0.2;
        const x = Math.round(((noise(k + 5) - 0.5) * (BOOK_W - w - 0.6)) * 100) / 100;
        const z = Math.round(((noise(k + 9) - 0.5) * (BOOK_D - d - 0.8)) * 100) / 100;
        const clash = holes.some((o) => Math.abs(o.x - x) < (o.w + w) / 2 + 0.4 && Math.abs(o.z - z) < (o.d + d) / 2 + 0.4);
        if (!clash) {
          holes.push({ x, z, w, d });
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

function bookInHole(page, x, z) {
  return page.holes.some((h) => Math.abs(x - h.x) <= h.w / 2 - BOOK_INSIDE && Math.abs(z - h.z) <= h.d / 2 - BOOK_INSIDE);
}

function bookSpawn(index) {
  return [[-1.4, 1.6], [1.4, 1.6], [-1.4, -1.2], [1.4, -1.2]][index % 4];
}

const book = {
  cooldown: 0,
  fastHand: true,
  create(arcade, players) {
    arcade.book = {
      w: BOOK_W,
      d: BOOK_D,
      pages: buildBookPages(arcade.seed),
      slammed: -1,                     // letzte ausgewertete Seite
      lives: BOOK_LIVES,
      flatMs: BOOK_FLAT_MS
    };
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
    const { arcade, room, now, elapsed } = ctx;
    const state = arcade.book;
    const dt = Math.min(0.12, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const entries = room.players.map((player) => arcade.players[player.id]).filter(Boolean);
    const halfW = BOOK_W / 2 - BOOK_BODY;
    const halfD = BOOK_D / 2 - BOOK_BODY;
    entries.forEach((entry) => {
      const stuck = entry.outAt || now < entry.flatUntil;
      const dx = stuck ? 0 : entry.dirX;
      const dz = stuck ? 0 : entry.dirZ;
      entry.vx += (dx * BOOK_SPEED - entry.vx) * Math.min(1, BOOK_ACCEL * dt);
      entry.vz += (dz * BOOK_SPEED - entry.vz) * Math.min(1, BOOK_ACCEL * dt);
      entry.x = clamp(entry.x + entry.vx * dt, -halfW, halfW);
      entry.z = clamp(entry.z + entry.vz * dt, -halfD, halfD);
    });
    // Rempeln: wer im Loch steht, kann hinausgeschoben werden.
    for (let a = 0; a < entries.length; a += 1) {
      for (let b = a + 1; b < entries.length; b += 1) {
        const one = entries[a];
        const two = entries[b];
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
    const coming = state.pages.find((page) => page.index > state.slammed);
    if (coming && elapsed >= coming.at) {
      entries.forEach((entry) => {
        if (entry.outAt) return;
        if (bookInHole(coming, entry.x, entry.z)) {
          if (entry.safeSince === null || entry.safeSince === undefined) entry.safeSince = elapsed;
        } else {
          entry.safeSince = null;
        }
      });
    }
    // Seiten schlagen auf.
    state.pages.forEach((page) => {
      if (page.index <= state.slammed || elapsed < page.slamAt) return;
      state.slammed = page.index;
      page.hits = [];
      entries.forEach((entry) => {
        if (entry.outAt) return;
        if (bookInHole(page, entry.x, entry.z)) {
          const since = entry.safeSince ?? page.slamAt;
          entry.safeMs = (entry.safeMs || 0) + clamp(since - page.at, 0, page.flip);
          entry.survived += 1;
        } else {
          entry.lives -= 1;
          entry.squashed += 1;
          entry.flatUntil = now + BOOK_FLAT_MS;
          if (entry.lives <= 0) {
            entry.outAt = elapsed;
            entry.outMs = elapsed;
          }
        }
        entry.lastPage = page.index;
        entry.safeSince = null;
        entry.score = entry.survived;
      });
      room.players.forEach((player) => {
        const entry = arcade.players[player.id];
        if (entry && entry.lastPage === page.index && entry.flatUntil > now) page.hits.push(player.id);
      });
    });
  },
  bot(ctx, player, entry) {
    const { arcade, room, now, elapsed } = ctx;
    if (entry.outAt || now < entry.flatUntil) return { action: "steer", x: 0, y: 0 };
    const state = arcade.book;
    const page = state.pages.find((p) => p.index > state.slammed);
    if (!page || elapsed < page.at) return { action: "steer", x: 0, y: 0 };
    const react = byLevel(entry, 750, 420, 180);
    if (elapsed < page.at + react) return { action: "steer", x: 0, y: 0 };
    if (entry.botPage !== page.index) {
      entry.botPage = page.index;
      // Welches Loch? Der schwache nimmt das nächste, der starke das beste:
      // nah genug und nicht schon besetzt.
      const others = room.players.filter((p) => p.id !== player.id).map((p) => arcade.players[p.id]).filter((e) => e && !e.outAt);
      const scored = page.holes.map((h, i) => {
        const dist = Math.hypot(h.x - entry.x, h.z - entry.z);
        const crowd = others.filter((o) => Math.hypot(o.x - h.x, o.z - h.z) < dist).length;
        const room2 = Math.max(0, Math.floor((h.w - 0.2) / 0.62) * Math.floor((h.d - 0.2) / 0.62));
        return { i, cost: dist + (level(entry) === "hard" ? Math.max(0, crowd - room2 + 1) * 2.5 : level(entry) === "normal" ? crowd * 0.8 : 0) };
      }).sort((a, b) => a.cost - b.cost);
      entry.botHole = scored[0]?.i ?? 0;
      entry.botJitter = { x: (Math.random() - 0.5) * byLevel(entry, 0.7, 0.35, 0.1), z: (Math.random() - 0.5) * byLevel(entry, 0.7, 0.35, 0.1) };
    }
    const hole = page.holes[entry.botHole] || page.holes[0];
    if (!hole) return { action: "steer", x: 0, y: 0 };
    const tx = hole.x + entry.botJitter.x * hole.w;
    const tz = hole.z + entry.botJitter.z * hole.d;
    const dx = tx - entry.x;
    const dz = tz - entry.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return { action: "steer", x: 0, y: 0 };
    const gain = Math.min(1, d * 2.5);
    return { action: "steer", x: (dx / d) * gain, y: (dz / d) * gain };
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
// geschubst — ein Tipp auf SCHUBS lässt einen nach vorn schnellen und stösst
// alle vor einem weg.
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
const PHOTO_BODY = 0.3;
const PHOTO_BUMP = 0.62;
const PHOTO_DASH_MS = 190;
const PHOTO_DASH_SPEED = 7;
const PHOTO_SHOVE_REACH = 0.95;
const PHOTO_SHOVE_KICK = 5.5;
const PHOTO_SHOVE_STUN_MS = 450;
const PHOTO_SHOVE_COOLDOWN_MS = 1300;

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

const photo = {
  cooldown: 0,
  fastHand: true,
  create(arcade, players) {
    arcade.photo = {
      w: PHOTO_W,
      d: PHOTO_D,
      shots: buildPhotoShots(arcade.seed),
      shot: -1,                        // letzter ausgelöster Schnappschuss
      results: []                      // je Schnappschuss: { index, in: [{ id, points, cover, solo }] }
    };
    const spots = [[-1.6, 2], [1.6, 2], [-1.6, -1.6], [1.6, -1.6]];
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const [x, z] = spots[index % spots.length];
      Object.assign(entry, { x, z, vx: 0, vz: 0, dirX: 0, dirZ: 0, heading: Math.atan2(-x, -z), dashUntil: 0, lastShoveAt: 0, stunUntil: 0, shoves: 0, shoved: 0, photos: 0, covers: 0, score: 0 });
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
    if (input.action !== "shove") return { ok: false, error: "Laufen oder schubsen." };
    if (now < entry.stunUntil || now - entry.lastShoveAt < PHOTO_SHOVE_COOLDOWN_MS) return { ok: true };
    entry.lastShoveAt = now;
    entry.dashUntil = now + PHOTO_DASH_MS;
    entry.shoves += 1;
    // Wer vor einem steht, fliegt zur Seite.
    const hx = Math.sin(entry.heading);
    const hz = Math.cos(entry.heading);
    Object.entries(arcade.players).forEach(([id, other]) => {
      if (other === entry || now < other.stunUntil) return;
      const dx = other.x - entry.x;
      const dz = other.z - entry.z;
      const dist = Math.hypot(dx, dz);
      if (dist > PHOTO_SHOVE_REACH + PHOTO_DASH_SPEED * PHOTO_DASH_MS / 1000 * 0.5 || dist < 1e-6) return;
      if ((dx * hx + dz * hz) / dist < 0.35) return;
      other.vx = (dx / dist) * PHOTO_SHOVE_KICK;
      other.vz = (dz / dist) * PHOTO_SHOVE_KICK;
      other.stunUntil = now + PHOTO_SHOVE_STUN_MS;
      other.shoved += 1;
      other.lastShovedBy = player.id;
      other.lastShovedAt = now;
      void id;
    });
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, now, elapsed } = ctx;
    const state = arcade.photo;
    const dt = Math.min(0.12, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const entries = room.players.map((player) => ({ id: player.id, e: arcade.players[player.id] })).filter((x) => x.e);
    const halfW = PHOTO_W / 2 - PHOTO_BODY;
    const halfD = PHOTO_D / 2 - PHOTO_BODY;
    entries.forEach(({ e }) => {
      const stunned = now < e.stunUntil;
      const dashing = now < e.dashUntil;
      if (dashing) {
        e.vx = Math.sin(e.heading) * PHOTO_DASH_SPEED;
        e.vz = Math.cos(e.heading) * PHOTO_DASH_SPEED;
      } else if (stunned) {
        e.vx *= Math.exp(-4 * dt);
        e.vz *= Math.exp(-4 * dt);
      } else {
        e.vx += (e.dirX * PHOTO_SPEED - e.vx) * Math.min(1, PHOTO_ACCEL * dt);
        e.vz += (e.dirZ * PHOTO_SPEED - e.vz) * Math.min(1, PHOTO_ACCEL * dt);
        if (Math.hypot(e.dirX, e.dirZ) > 0.15) {
          const want = Math.atan2(e.dirX, e.dirZ);
          const diff = Math.atan2(Math.sin(want - e.heading), Math.cos(want - e.heading));
          e.heading += clamp(diff, -10 * dt, 10 * dt);
        }
      }
      e.x = clamp(e.x + e.vx * dt, -halfW, halfW);
      e.z = clamp(e.z + e.vz * dt, -halfD, halfD);
    });
    for (let a = 0; a < entries.length; a += 1) {
      for (let b = a + 1; b < entries.length; b += 1) {
        const one = entries[a].e;
        const two = entries[b].e;
        const dx = two.x - one.x;
        const dz = two.z - one.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= PHOTO_BUMP || dist < 1e-6) continue;
        const push = (PHOTO_BUMP - dist) / 2;
        one.x = clamp(one.x - (dx / dist) * push, -halfW, halfW);
        one.z = clamp(one.z - (dz / dist) * push, -halfD, halfD);
        two.x = clamp(two.x + (dx / dist) * push, -halfW, halfW);
        two.z = clamp(two.z + (dz / dist) * push, -halfD, halfD);
      }
    }
    // Blitz!
    state.shots.forEach((shot) => {
      if (shot.index <= state.shot || elapsed < shot.shootAt) return;
      state.shot = shot.index;
      const inside = entries
        .map(({ id, e }) => ({ id, e, d: Math.hypot(e.x - shot.x, e.z - shot.z) }))
        .filter((item) => item.d <= shot.r);
      const nearest = inside.reduce((best, item) => (!best || item.d < best.d ? item : best), null);
      const result = { index: shot.index, at: now, in: [] };
      inside.forEach((item) => {
        const cover = item === nearest;
        const solo = inside.length === 1;
        const points = PHOTO_IN + (cover ? PHOTO_COVER : 0) + (solo ? PHOTO_SOLO : 0);
        item.e.score += points;
        item.e.photos += 1;
        if (cover) item.e.covers += 1;
        result.in.push({ id: item.id, points, cover, solo });
      });
      state.results.push(result);
      if (state.results.length > 6) state.results.shift();
    });
  },
  bot(ctx, player, entry) {
    const { arcade, room, now, elapsed } = ctx;
    const state = arcade.photo;
    if (now < entry.stunUntil) return null;
    const shot = state.shots.find((s) => s.index > state.shot);
    if (!shot || elapsed < shot.at + byLevel(entry, 650, 380, 180)) {
      return { action: "steer", x: 0, y: 0 };
    }
    // Schubsen: steht jemand zwischen mir und der Mitte (oder in der Mitte),
    // und ich schaue ungefähr hin — der starke tut es gezielt.
    const eager = byLevel(entry, 0.05, 0.25, 0.55);
    if (now - entry.lastShoveAt > PHOTO_SHOVE_COOLDOWN_MS && Math.random() < eager) {
      const hx = Math.sin(entry.heading);
      const hz = Math.cos(entry.heading);
      const rivals = room.players.map((p) => arcade.players[p.id]).filter((o) => o && o !== entry);
      // Der starke schubst nur den, der der Mitte am nächsten ist — also den,
      // der ihm das Titelbild wegnimmt.
      const best = rivals.reduce((b, o) => (!b || Math.hypot(o.x - shot.x, o.z - shot.z) < Math.hypot(b.x - shot.x, b.z - shot.z) ? o : b), null);
      const target = rivals.find((o) => {
        if (level(entry) === "hard" && o !== best) return false;
        const dx = o.x - entry.x;
        const dz = o.z - entry.z;
        const dist = Math.hypot(dx, dz);
        return dist < PHOTO_SHOVE_REACH && dist > 0 && (dx * hx + dz * hz) / dist > 0.6 && Math.hypot(o.x - shot.x, o.z - shot.z) < shot.r + 0.4;
      });
      if (target) return { action: "shove" };
    }
    // Wohin genau: der starke in die Mitte (Titelbild), die anderen irgendwo
    // in den Ausschnitt.
    if (entry.botShot !== shot.index) {
      entry.botShot = shot.index;
      const spread = byLevel(entry, 0.65, 0.35, 0.02) * shot.r;
      const a = Math.random() * Math.PI * 2;
      entry.botOffX = Math.cos(a) * spread;
      entry.botOffZ = Math.sin(a) * spread;
    }
    const dx = shot.x + entry.botOffX - entry.x;
    const dz = shot.z + entry.botOffZ - entry.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return { action: "steer", x: 0, y: 0 };
    const gain = Math.min(1, d * 2.4);
    return { action: "steer", x: (dx / d) * gain, y: (dz / d) * gain };
  },
  rank(arcade, entry) {
    return (entry.score || 0) * 100 + Math.min(99, (entry.covers || 0) * 10 + (entry.photos || 0));
  },
  detail(arcade, entry) {
    return { kind: "points", value: Math.max(0, Math.round(entry.score || 0)), label: "Punkte" };
  },
  done() {
    return false;
  }
};


// --- Kippboot --------------------------------------------------------------
//
// In einer Lagune liegt ein Ruderboot. Reihum schwenkt ein Kran einen
// Passagier über das Boot — Küken, Pinguin, Schaf, Schwein, je schwerer,
// desto mehr Punkte. Ein Tipp setzt ihn ab, dort wo er gerade hängt. Weiter
// aussen gibt es mehr Punkte (bis zum Dreifachen) — aber das Boot neigt sich
// dann auch stärker. Liegt
// zu viel Gewicht auf einer Seite, kentert das Boot: wer es gekippt hat,
// verliert Punkte, alle Passagiere gehen baden, ein neues Boot kommt. Ist das
// Boot voll, legt es ab, und alle, die etwas daraufgesetzt haben, bekommen
// eine Zugabe.
//
// Gerechnet wird mit dem Drehmoment: Summe aus Gewicht mal Abstand zur
// Mitte. Das Boot neigt sich sichtbar dazu, und wer hinschaut, setzt den
// nächsten Passagier auf die Gegenseite.
const BOAT_LEAD_MS = 1500;
const BOAT_DURATION_MS = 45000;
const BOAT_TURN_MS = 4200;
const BOAT_TURN_MIN_MS = 3200;
const BOAT_GAP_MS = 800;               // nach dem Absetzen
const BOAT_SPLASH_MS = 1800;           // nach dem Kentern
const BOAT_DEPART_MS = 1700;           // ein volles Boot legt ab
const BOAT_REACH = 1.75;               // so weit schwingt der Haken
const BOAT_TORQUE_MAX = 4.2;           // darüber kentert es
const BOAT_CAPACITY = 7;
const BOAT_CAPSIZE_COST = 10;
const BOAT_DEPART_BONUS = 2;
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
// Spiel hätte keine Entscheidung gehabt.
function boatPoints(w, x) {
  return Math.round(w * (1 + 2 * Math.min(1, Math.abs(x) / BOAT_REACH)));
}

function boatTorque(passengers) {
  return passengers.reduce((sum, p) => sum + p.w * p.x, 0);
}

function boatNextTurn(ctx, afterId, delay) {
  const { arcade, room, elapsed } = ctx;
  const state = arcade.boat;
  // Mit jedem neuen Boot eine neu gemischte Reihenfolge — sonst sitzt immer
  // derselbe hinter dem, der das Boot schief belädt, und muss es ausbaden.
  const ids = room.players.map((player) => player.id).filter((id) => arcade.players[id]);
  if (!ids.length) return;
  if (state.orderFor !== state.boatNumber || state.order?.length !== ids.length) {
    const order = [...ids];
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(noise(arcade.seed + state.boatNumber * 131 + i * 17) * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    state.order = order;
    state.orderFor = state.boatNumber;
    state.orderFresh = true;
  }
  const order = state.order;
  let index;
  if (afterId === null || state.orderFresh) {
    index = order[0] === afterId && order.length > 1 ? 1 : 0;
    state.orderFresh = false;
  } else {
    index = (order.indexOf(afterId) + 1) % order.length;
  }
  const from = elapsed + delay;
  if (from + 1000 > BOAT_DURATION_MS) {
    state.turn = null;
    return;
  }
  const n = state.turns;
  const pick = BOAT_KINDS[Math.floor(noise(arcade.seed + n * 37) * BOAT_KINDS.length)];
  // Der Haken schwingt mit jeder Runde etwas schneller.
  const omega = Math.round((1.7 + Math.min(1.9, n * 0.09) + noise(arcade.seed + n * 11) * 0.3) * 100) / 100;
  const phase = Math.round(noise(arcade.seed + n * 53) * Math.PI * 2 * 100) / 100;
  const turnMs = Math.max(BOAT_TURN_MIN_MS, BOAT_TURN_MS - n * 40);
  state.turn = { playerId: order[index], from, until: Math.min(BOAT_DURATION_MS - 200, from + turnMs), number: n, kind: pick.kind, w: pick.w, omega, phase };
  state.turns += 1;
}

function boatDrop(ctx, player, entry, auto = false) {
  const { arcade, elapsed } = ctx;
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
    state.last = { kind: "capsize", playerId: player.id, x, w: turn.w, animal: turn.kind, at: elapsed, side: Math.sign(torque), passengers: state.passengers.slice(), auto, number: state.events };
    state.events += 1;
    state.passengers = [];
    state.torque = 0;
    state.boatNumber += 1;
    boatNextTurn(ctx, player.id, BOAT_SPLASH_MS);
    return;
  }
  const points = boatPoints(turn.w, x);
  entry.score += points;
  entry.placed += 1;
  state.last = { kind: "place", playerId: player.id, x, w: turn.w, points, animal: turn.kind, at: elapsed, auto, number: state.events };
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
    state.last = { kind: "depart", playerId: player.id, x, w: turn.w, animal: turn.kind, at: elapsed, passengers: state.passengers.slice(), loaders: [...loaders], auto, number: state.events };
    state.events += 1;
    state.passengers = [];
    state.torque = 0;
    state.boatNumber += 1;
    boatNextTurn(ctx, player.id, BOAT_DEPART_MS);
    return;
  }
  boatNextTurn(ctx, player.id, BOAT_GAP_MS);
}

const boat = {
  cooldown: 150,
  fastHand: true,
  create(arcade) {
    arcade.boat = {
      passengers: [],
      torque: 0,
      turn: null,
      turns: 0,
      events: 0,
      boatNumber: 0,
      last: null,
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
    boatDrop(ctx, player, entry);
    return { ok: true };
  },
  update(ctx) {
    const { arcade, room, elapsed } = ctx;
    const state = arcade.boat;
    if (!state.turn && state.turns === 0 && elapsed >= BOAT_LEAD_MS) boatNextTurn(ctx, null, 0);
    const turn = state.turn;
    if (turn && elapsed >= turn.until) {
      const player = room.players.find((p) => p.id === turn.playerId);
      const entry = player && arcade.players[player.id];
      if (entry) boatDrop(ctx, player, entry, true);
      else boatNextTurn(ctx, turn.playerId, 0);
    }
  },
  bot(ctx, player, entry) {
    const { arcade, elapsed } = ctx;
    const state = arcade.boat;
    const turn = state.turn;
    if (!turn || turn.playerId !== player.id || elapsed < turn.from) return null;
    if (entry.botTurn !== turn.number) {
      entry.botTurn = turn.number;
      // Wohin? Der starke sucht die Stelle mit den meisten Punkten, an der
      // das Boot noch sicher liegt. Der mittlere gleicht nur aus. Der schwache
      // greift nach dem Rand, ohne auf die Neigung zu achten.
      const safe = BOAT_TORQUE_MAX * byLevel(entry, 1, 0.7, 0.62);
      let aim = clamp(-state.torque / turn.w, -BOAT_REACH * 0.95, BOAT_REACH * 0.95);
      // Der mittlere sucht inzwischen meist auch nach Punkten, nur mit mehr
      // Sicherheitsabstand — nur auszugleichen brachte ihm so wenig, dass der
      // schwache, der wild zum Rand greift, gemessen gleichauf lag.
      if (level(entry) === "hard" || (level(entry) === "normal" && Math.random() < 0.6)) {
        let best = aim;
        let bestPoints = -1;
        for (let x = -BOAT_REACH * 0.95; x <= BOAT_REACH * 0.95; x += 0.05) {
          if (Math.abs(state.torque + turn.w * x) > safe) continue;
          const pts = boatPoints(turn.w, x);
          if (pts > bestPoints || (pts === bestPoints && Math.abs(state.torque + turn.w * x) < Math.abs(state.torque + turn.w * best))) {
            bestPoints = pts;
            best = x;
          }
        }
        aim = best;
      } else if (level(entry) === "easy") {
        aim = (Math.random() < 0.5 ? -1 : 1) * BOAT_REACH * (0.4 + Math.random() * 0.5);
      }
      entry.botAim = clamp(aim, -BOAT_REACH * 0.95, BOAT_REACH * 0.95);
      entry.botTol = byLevel(entry, 0.45, 0.25, 0.1);
      entry.botWait = turn.from + byLevel(entry, 700, 450, 300);
    }
    if (elapsed < entry.botWait) return null;
    // Wo ist der Haken beim nächsten Blick? Der Bot drückt, wenn er nahe
    // genug am Ziel ist — so wie ein Mensch den richtigen Moment abpasst.
    const x = boatSwingX(turn, elapsed);
    const soon = elapsed > turn.until - 400;
    if (Math.abs(x - entry.botAim) < entry.botTol || soon) return { action: "drop" };
    return null;
  },
  rank(arcade, entry) {
    return Math.round((entry.score || 0) + 1000) * 100 + Math.max(0, 99 - (entry.capsizes || 0) * 10);
  },
  detail(arcade, entry) {
    return { kind: "points", value: Math.round(entry.score || 0), label: "Punkte" };
  },
  done() {
    return false;
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
const PIPE_ROUNDS = 4;
const PIPE_LEAD_MS = 1200;
const PIPE_ANSWER_MS = [8500, 8000, 7500, 7000];
const PIPE_REVEAL_MS = 2600;
const PIPE_LEVELS = 12;
const PIPE_POINTS = 100;
const PIPE_SPEED_BONUS = 60;
const PIPE_COLS = [4, 5, 5, 6];
const PIPE_RUNGS = [7, 10, 12, 15];

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

function pipePhase(elapsed) {
  let t = elapsed - PIPE_LEAD_MS;
  if (t < 0) return { phase: "lead", round: 0, since: elapsed };
  for (let round = 0; round < PIPE_ROUNDS; round += 1) {
    const answer = PIPE_ANSWER_MS[round];
    if (t < answer) return { phase: "answer", round, since: t, left: answer - t };
    t -= answer;
    if (t < PIPE_REVEAL_MS) return { phase: "reveal", round, since: t };
    t -= PIPE_REVEAL_MS;
  }
  return { phase: "over", round: PIPE_ROUNDS - 1, since: t };
}

const PIPE_DURATION_MS = PIPE_LEAD_MS + PIPE_ANSWER_MS.reduce((a, b) => a + b, 0) + PIPE_ROUNDS * PIPE_REVEAL_MS + 400;

const pipes = {
  cooldown: 150,
  fastHand: false,
  create(arcade) {
    arcade.pipes = {
      rounds: Array.from({ length: PIPE_ROUNDS }, (_, round) => buildPipeRound(arcade.seed, round)),
      levels: PIPE_LEVELS,
      leadMs: PIPE_LEAD_MS,
      answerMs: PIPE_ANSWER_MS,
      revealMs: PIPE_REVEAL_MS,
      scored: -1
    };
    Object.values(arcade.players).forEach((entry) => {
      entry.picks = [];                // je Runde { valve, ms }
      entry.results = [];              // je Runde { correct, points }
      entry.correct = 0;
      entry.score = 0;
    });
  },
  input(ctx, player, entry, input) {
    if (input.action !== "pick") return { ok: false, error: "Tippe ein Ventil an." };
    const { phase, round, since } = pipePhase(ctx.elapsed);
    if (phase !== "answer") return { ok: true };
    if (entry.picks[round]) return { ok: true };
    const maze = ctx.arcade.pipes.rounds[round];
    const valve = inputNumber(input.valve);
    if (!Number.isInteger(valve) || valve < 0 || valve >= maze.cols) return { ok: false, error: "Dieses Ventil gibt es nicht." };
    entry.picks[round] = { valve, ms: Math.round(since) };
    return { ok: true };
  },
  update(ctx) {
    const { arcade, elapsed } = ctx;
    const state = arcade.pipes;
    const { phase, round } = pipePhase(elapsed);
    const due = phase === "reveal" || phase === "over" ? round : round - 1;
    while (state.scored < due) {
      state.scored += 1;
      const maze = state.rounds[state.scored];
      const answerMs = PIPE_ANSWER_MS[state.scored];
      Object.values(arcade.players).forEach((entry) => {
        const pick = entry.picks[state.scored];
        const correct = Boolean(pick && pick.valve === maze.answer);
        const points = correct ? PIPE_POINTS + Math.round(PIPE_SPEED_BONUS * Math.max(0, 1 - pick.ms / answerMs)) : 0;
        entry.results[state.scored] = { correct, points, valve: pick ? pick.valve : null };
        if (correct) entry.correct += 1;
        entry.score += points;
      });
    }
  },
  bot(ctx, player, entry) {
    const { arcade, elapsed } = ctx;
    const { phase, round, since } = pipePhase(elapsed);
    if (phase !== "answer" || entry.picks[round]) return null;
    const maze = arcade.pipes.rounds[round];
    if (entry.botRound !== round) {
      entry.botRound = round;
      // Wie lange der Bot „mit den Augen folgt" und wie oft er sich verzählt.
      const think = byLevel(entry, 5200, 3800, 2500) + maze.rungs.length * byLevel(entry, 60, 40, 25);
      entry.botAt = Math.min(PIPE_ANSWER_MS[round] - 300, think * (0.8 + Math.random() * 0.4));
      const right = byLevel(entry, 0.4, 0.68, 0.9) - maze.rungs.length * 0.008;
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
    return { kind: "points", value: Math.max(0, Math.round(entry.score || 0)), label: "Punkte" };
  },
  done(ctx) {
    return pipePhase(ctx.elapsed).phase === "over";
  }
};

// ---------------------------------------------------------------------------

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
  pipes
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
  { type: "rohrsalat", title: "Rohrsalat", duration: PIPE_DURATION_MS, arcadeFamily: "pipes", seed: 877 }
];

module.exports = {
  PARTY_FAMILIES,
  PARTY_GAMES,
  constants: {
    TUG_LEAD_MS, TUG_ROUND_MS, TUG_SHOW_MS, TUG_ROUNDS, TUG_WINS, TUG_DURATION_MS,
    TUG_IMPULSE, TUG_GRIP_COST, TUG_GRIP_REGEN, TUG_SLIP_MS, TUG_SYNC_MS, TUG_SYNC_BONUS,
    FACE_HANDLES, FACE_ROUNDS, FACE_LEAD_MS, FACE_SHOW_MS, FACE_SHAPE_MS, FACE_REVEAL_MS, FACE_CYCLE_MS,
    FLAG_LEAD_MS, FLAG_LIVES, FLAG_DURATION_MS,
    HONEY_LEAD_MS, HONEY_TURN_MS, HONEY_GAP_MS, HONEY_STING_MS, HONEY_VINE, HONEY_GOLD, HONEY_STING_COST,
    SNOW_W, SNOW_D, SNOW_THROW_MIN, SNOW_MIN_SIZE, SNOW_STUN_MS, SNOW_BODY_R,
    HOCKEY_W, HOCKEY_L, HOCKEY_GOAL, HOCKEY_WIN, HOCKEY_PUCK_R, HOCKEY_MALLET_R, HOCKEY_SERVE_MS,
    BOOK_W, BOOK_D, BOOK_LIVES, BOOK_FLAT_MS,
    PHOTO_W, PHOTO_D, PHOTO_IN, PHOTO_COVER, PHOTO_SOLO, PHOTO_SHOVE_COOLDOWN_MS,
    BOAT_LEAD_MS, BOAT_REACH, BOAT_TORQUE_MAX, BOAT_CAPACITY, BOAT_CAPSIZE_COST, BOAT_DEPART_BONUS,
    PIPE_ROUNDS, PIPE_LEAD_MS, PIPE_ANSWER_MS, PIPE_REVEAL_MS, PIPE_LEVELS, PIPE_POINTS, PIPE_SPEED_BONUS
  },
  buildPipeRound,
  pipeTrace,
  pipePhase,
  boatSwingX,
  boatTorque,
  boatPoints,
  buildPhotoShots,
  buildBookPages,
  bookInHole,
  snowBallRadius,
  snowValue,
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
