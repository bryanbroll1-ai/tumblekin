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

// ---------------------------------------------------------------------------

const PARTY_FAMILIES = {
  tug
};

// Katalogeinträge: dieselbe Form wie MINIGAMES und ARCADE_CONFIGS in server.js.
const PARTY_GAMES = [
  { type: "tauziehen", title: "Tauziehen", duration: TUG_DURATION_MS, arcadeFamily: "tug", seed: 811 }
];

module.exports = {
  PARTY_FAMILIES,
  PARTY_GAMES,
  constants: {
    TUG_LEAD_MS, TUG_ROUND_MS, TUG_SHOW_MS, TUG_ROUNDS, TUG_WINS, TUG_DURATION_MS,
    TUG_IMPULSE, TUG_GRIP_COST, TUG_GRIP_REGEN, TUG_SLIP_MS, TUG_SYNC_MS, TUG_SYNC_BONUS
  }
};
