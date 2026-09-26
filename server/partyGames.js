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
    const next = h.map((value) => (Number.isFinite(Number(value)) ? clamp(Math.round(Number(value) * 100) / 100, -1, 1) : 0));
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
    return { kind: "points", value: entry.correct || 0, label: "richtig" };
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
const HONEY_LEAD_MS = 1500;
const HONEY_TURN_MS = 4200;            // so lange hat man Zeit, dann wird eine gepflückt
const HONEY_TURN_MIN_MS = 2800;
const HONEY_GAP_MS = 700;              // nach dem Pflücken, bis der Nächste dran ist
const HONEY_STING_MS = 1500;           // nach einem Stich
const HONEY_DURATION_MS = 46000;
const HONEY_VINE = 14;
const HONEY_GOLD = 3;
const HONEY_STING_LOSS = 0.5;          // so viel der Früchte fällt beim Stich herunter

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
    dropped = Math.floor(entry.fruits * HONEY_STING_LOSS);
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
      entry.score = 0;
    });
  },
  input(ctx, player, entry, input) {
    if (input.action !== "take" || ![1, 2].includes(Number(input.count))) return { ok: false, error: "Eine oder zwei nehmen." };
    const turn = ctx.arcade.honey.turn;
    if (!turn || turn.playerId !== player.id) return { ok: false, error: "Du bist nicht dran." };
    if (ctx.elapsed < turn.from) return { ok: true };
    honeyTake(ctx, player, entry, Number(input.count));
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
      entry.botAt = turn.from + byLevel(entry, 1500, 1100, 800) + Math.random() * 700;
      const k = honeyCombAt(state.vine);
      const players = Math.max(1, room.players.length);
      let count;
      if (k === 0) count = 1;                                   // verloren, so oder so
      else if (level(entry) === "hard") {
        // Gewinn gegen Risiko: ein Stich kostet die Hälfte des Korbs.
        const loss = entry.fruits * HONEY_STING_LOSS + 2;
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

// ---------------------------------------------------------------------------

const PARTY_FAMILIES = {
  tug,
  face,
  flags,
  honey
};

// Katalogeinträge: dieselbe Form wie MINIGAMES und ARCADE_CONFIGS in server.js.
const PARTY_GAMES = [
  { type: "tauziehen", title: "Tauziehen", duration: TUG_DURATION_MS, arcadeFamily: "tug", seed: 811 },
  { type: "grimassen", title: "Grimassen", duration: FACE_DURATION_MS, arcadeFamily: "face", seed: 823 },
  { type: "flaggenhoch", title: "Flaggen hoch", duration: FLAG_DURATION_MS, arcadeFamily: "flags", seed: 827 },
  { type: "honigwabe", title: "Honigwabe", duration: HONEY_DURATION_MS, arcadeFamily: "honey", seed: 829 }
];

module.exports = {
  PARTY_FAMILIES,
  PARTY_GAMES,
  constants: {
    TUG_LEAD_MS, TUG_ROUND_MS, TUG_SHOW_MS, TUG_ROUNDS, TUG_WINS, TUG_DURATION_MS,
    TUG_IMPULSE, TUG_GRIP_COST, TUG_GRIP_REGEN, TUG_SLIP_MS, TUG_SYNC_MS, TUG_SYNC_BONUS,
    FACE_HANDLES, FACE_ROUNDS, FACE_LEAD_MS, FACE_SHOW_MS, FACE_SHAPE_MS, FACE_REVEAL_MS, FACE_CYCLE_MS,
    FLAG_LEAD_MS, FLAG_LIVES, FLAG_DURATION_MS,
    HONEY_LEAD_MS, HONEY_TURN_MS, HONEY_GAP_MS, HONEY_STING_MS, HONEY_VINE, HONEY_GOLD, HONEY_STING_LOSS
  },
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
