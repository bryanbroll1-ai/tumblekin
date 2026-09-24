// Spielmodi: wie aus einzelnen Minispielen eine Partie wird.
//
// Bewusst ohne Sockets, Timer und Räume-Verwaltung — nur Regeln über Zahlen.
// Der Server ruft diese Funktionen an genau drei Stellen: beim Start einer
// Partie (Spielliste ziehen), nach jedem Minispiel (Punkte, Leben, Ende?) und
// beim Serialisieren (was zeigt die Oberfläche). Dadurch lässt sich jede Regel
// hier ohne laufenden Server prüfen.

const MODE_IDS = ["marathon", "hunt", "knockout", "single"];

const MODE_INFO = {
  marathon: {
    name: "Marathon",
    short: "Feste Anzahl Minispiele, die meisten Punkte gewinnen."
  },
  hunt: {
    name: "Punktejagd",
    short: "Wer zuerst die Zielpunktzahl erreicht, gewinnt."
  },
  knockout: {
    name: "K.O.",
    short: "Jede Runde verliert der Letzte ein Leben. Wer übrig bleibt, gewinnt."
  },
  single: {
    name: "Einzelspiel",
    short: "Ein Minispiel, danach zurück in die Lobby."
  }
};

const MARATHON_LENGTHS = [5, 10, 15];
const KNOCKOUT_LIVES = [2, 3, 5];
// Notbremsen. Eine Punktejagd mit dauerndem Gleichstand an der Spitze oder
// ein K.O., in dem alle ewig gleich abschneiden, darf nicht endlos laufen.
const HUNT_MAX_ROUNDS = 30;
const KNOCKOUT_MAX_ROUNDS = 40;

function defaultSettings() {
  return { length: 5, lives: 3, pool: null, single: null };
}

// Nimmt nur, was gültig ist, und lässt den Rest wie er war. Ein Client kann
// hier alles schicken; nichts davon darf den Raum in einen Zustand bringen,
// aus dem keine Partie mehr startet.
function mergeSettings(current, raw, knownTypes) {
  const next = { ...defaultSettings(), ...(current || {}) };
  if (!raw || typeof raw !== "object") return next;
  const known = new Set(knownTypes);

  if (raw.length !== undefined && MARATHON_LENGTHS.includes(Number(raw.length))) {
    next.length = Number(raw.length);
  }
  if (raw.lives !== undefined && KNOCKOUT_LIVES.includes(Number(raw.lives))) {
    next.lives = Number(raw.lives);
  }
  if (raw.pool !== undefined) {
    if (raw.pool === null) {
      next.pool = null;
    } else if (Array.isArray(raw.pool)) {
      const pool = [...new Set(raw.pool.map(String))].filter((type) => known.has(type));
      // Weniger als zwei Spiele ist keine Auswahl, sondern eine Wiederholung
      // in Schleife — und alle abgewählt hiesse: nichts zu spielen.
      next.pool = pool.length >= 2 && pool.length < known.size ? pool : null;
    }
  }
  if (raw.single !== undefined) {
    next.single = raw.single === null ? null : (known.has(String(raw.single)) ? String(raw.single) : next.single);
  }
  return next;
}

// Platzierungspunkte: der Letzte bekommt 0, jeder Platz darüber einen mehr.
// Bei vier Spielern 3/2/1/0, bei zweien 1/0. Gleichstand teilt den besseren
// Platz — wer gleichauf mit dem Ersten ist, IST Erster.
function placementPoints(place, playerCount) {
  return Math.max(0, playerCount - place);
}

function huntTarget(playerCount) {
  return Math.max(4, 4 * (Math.max(2, playerCount) - 1));
}

// Plätze aus Punktzahlen, Gleichstand teilt sich den Platz (1, 1, 3, 4).
function placesFromScores(entries) {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const places = new Map();
  sorted.forEach((entry, index) => {
    const tie = index > 0 && sorted[index - 1].score === entry.score;
    places.set(entry.playerId, tie ? places.get(sorted[index - 1].playerId) : index + 1);
  });
  return places;
}

function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Zieht `count` Spiele aus dem Pool. Innerhalb eines Durchgangs durch den Pool
// kommt keines doppelt; ist der Pool kürzer als die Liste, wird neu gemischt —
// aber nie so, dass dasselbe Spiel zweimal direkt hintereinander läuft.
function drawGames(pool, count, random = Math.random, last = null) {
  const out = [];
  let deck = [];
  let previous = last;
  while (out.length < count && pool.length > 0) {
    if (deck.length === 0) {
      deck = shuffle(pool, random);
      if (pool.length > 1 && deck[0] === previous) {
        [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
      }
    }
    const next = deck.shift();
    out.push(next);
    previous = next;
  }
  return out;
}

function poolFor(settings, allTypes) {
  const pool = settings?.pool && settings.pool.length >= 2 ? settings.pool : allTypes;
  return pool.filter((type) => allTypes.includes(type));
}

// Neue Partie: Spielerwerte zurück, Spielliste ziehen.
function createMatch(mode, settings, players, allTypes, random = Math.random) {
  players.forEach((player) => {
    player.points = 0;
    player.wins = 0;
    player.lives = mode === "knockout" ? settings.lives : 0;
    player.out = false;
    player.lastPlace = null;
    player.lastPoints = 0;
  });
  const pool = poolFor(settings, allTypes);
  let playlist;
  if (mode === "single") {
    playlist = [settings.single && allTypes.includes(settings.single) ? settings.single : drawGames(allTypes, 1, random)[0]];
  } else if (mode === "marathon") {
    playlist = drawGames(pool, settings.length, random);
  } else {
    // Punktejagd und K.O. haben keine feste Länge. Gezogen wird ein Vorrat;
    // reicht er nicht, legt nextGame nach.
    playlist = drawGames(pool, 12, random);
  }
  return {
    mode,
    round: 0,
    playlist,
    pool,
    target: mode === "hunt" ? huntTarget(players.length) : null,
    history: []
  };
}

// Punktejagd und K.O. haben keine feste Länge: geht der Vorrat zur Neige,
// wird nachgelegt. Vorher, nicht erst beim Start — sonst stünde zwischen zwei
// Spielen "Als Nächstes: —", genau dann, wenn es spannend wird.
function ensureUpcoming(match, random = Math.random) {
  if (!match || match.mode === "marathon" || match.mode === "single") return;
  if (match.round < match.playlist.length) return;
  const last = match.playlist[match.playlist.length - 1] || null;
  match.playlist.push(...drawGames(match.pool, 12, random, last));
}

function nextGame(match, random = Math.random) {
  ensureUpcoming(match, random);
  if (match.round >= match.playlist.length) return null;
  const type = match.playlist[match.round];
  match.round += 1;
  return type;
}

function upcomingGame(match) {
  if (!match) return null;
  if (match.round < match.playlist.length) return match.playlist[match.round];
  return null;
}

function totalRounds(match) {
  if (!match) return null;
  if (match.mode === "marathon" || match.mode === "single") return match.playlist.length;
  return null;
}

function roundLabel(match) {
  if (!match) return "";
  if (match.mode === "single") return "Einzelspiel";
  if (match.mode === "marathon") return `Spiel ${match.round} von ${match.playlist.length}`;
  if (match.mode === "hunt") return `Spiel ${match.round} · Ziel ${match.target} Punkte`;
  return `Spiel ${match.round} · K.O.`;
}

// Wertet ein fertiges Minispiel für die Partie aus.
//
// `results` ist die Rangliste des Minispiels: [{ playerId, score }] mit der
// Zahl, nach der das Spiel sortiert. Zurück kommt je Spieler, was diese Runde
// für die Partie bedeutet — Platz, Punkte, verlorenes Leben.
function scoreRound(match, players, results) {
  const count = players.length;
  const places = placesFromScores(results);
  const outcome = new Map();
  players.forEach((player) => {
    const place = places.get(player.id) || count;
    const points = placementPoints(place, count);
    outcome.set(player.id, { place, points, roundWin: place === 1, lifeLost: false });
  });

  // K.O.: Unter den noch Lebenden verliert, wer am schlechtesten war. Wer
  // schon raus ist, spielt weiter mit — niemand sitzt am Handy und schaut zu —,
  // zählt dabei aber nicht mehr.
  if (match.mode === "knockout") {
    const alive = players.filter((player) => !player.out);
    const alivePlaces = alive.map((player) => outcome.get(player.id).place);
    const worst = Math.max(...alivePlaces);
    const best = Math.min(...alivePlaces);
    // Alle gleichauf: niemand war schlechter, niemand verliert.
    if (alive.length > 1 && worst !== best) {
      alive.forEach((player) => {
        if (outcome.get(player.id).place === worst) outcome.get(player.id).lifeLost = true;
      });
    }
  }

  players.forEach((player) => {
    const result = outcome.get(player.id);
    player.points = (player.points || 0) + result.points;
    if (result.roundWin) player.wins = (player.wins || 0) + 1;
    if (result.lifeLost) {
      player.lives = Math.max(0, (player.lives || 0) - 1);
      if (player.lives === 0) player.out = true;
    }
    player.lastPlace = result.place;
    player.lastPoints = result.points;
    result.total = player.points;
    result.lives = player.lives || 0;
    result.out = Boolean(player.out);
  });

  match.history.push({
    round: match.round,
    winners: players.filter((player) => outcome.get(player.id).roundWin).map((player) => player.id)
  });
  return outcome;
}

// Gesamtstand: Punkte, bei Gleichstand die Rundensiege. Im K.O. zuerst die
// Leben — wer länger drin war, steht vor dem, der früher flog.
function compareStanding(mode) {
  return (a, b) => {
    if (mode === "knockout") {
      return ((b.lives || 0) - (a.lives || 0))
        || ((b.points || 0) - (a.points || 0))
        || ((b.wins || 0) - (a.wins || 0));
    }
    return ((b.points || 0) - (a.points || 0)) || ((b.wins || 0) - (a.wins || 0));
  };
}

function standings(mode, players) {
  const compare = compareStanding(mode);
  const sorted = [...players].sort(compare);
  let place = 0;
  return sorted.map((player, index) => {
    if (index === 0 || compare(sorted[index - 1], player) !== 0) place = index + 1;
    return { playerId: player.id, place };
  });
}

// Ist die Partie vorbei? Und wenn ja: wer hat gewonnen?
function matchOutcome(match, players) {
  if (!match) return { over: true, winnerIds: [] };
  const leaders = () => {
    const table = standings(match.mode, players);
    return table.filter((row) => row.place === 1).map((row) => row.playerId);
  };

  if (match.mode === "single") {
    return { over: true, winnerIds: leaders() };
  }
  if (match.mode === "marathon") {
    return match.round >= match.playlist.length
      ? { over: true, winnerIds: leaders() }
      : { over: false, winnerIds: [] };
  }
  if (match.mode === "hunt") {
    const top = Math.max(...players.map((player) => player.points || 0));
    const atTop = players.filter((player) => (player.points || 0) === top);
    // Erst wenn EINER allein vorn liegt und das Ziel erreicht hat. Zwei, die
    // gleichzeitig darüber springen, spielen weiter — Matchball.
    if (top >= match.target && atTop.length === 1) return { over: true, winnerIds: [atTop[0].id] };
    if (match.round >= HUNT_MAX_ROUNDS) return { over: true, winnerIds: leaders() };
    return { over: false, winnerIds: [] };
  }
  // knockout
  const alive = players.filter((player) => !player.out);
  if (alive.length <= 1) {
    return { over: true, winnerIds: alive.length === 1 ? [alive[0].id] : leaders() };
  }
  if (match.round >= KNOCKOUT_MAX_ROUNDS) return { over: true, winnerIds: leaders() };
  return { over: false, winnerIds: [] };
}

// Wer steht gerade auf Matchball? Für die Anzeige zwischen den Spielen: das
// ist der Moment, in dem eine Punktejagd spannend wird.
function matchPoint(match, players) {
  if (!match) return [];
  if (match.mode === "hunt") {
    const count = players.length;
    return players
      .filter((player) => (player.points || 0) + placementPoints(1, count) >= match.target)
      .map((player) => player.id);
  }
  if (match.mode === "marathon") {
    return match.round === match.playlist.length - 1 ? players.map((player) => player.id) : [];
  }
  if (match.mode === "knockout") {
    return players.filter((player) => !player.out && player.lives === 1).map((player) => player.id);
  }
  return [];
}

module.exports = {
  MODE_IDS,
  MODE_INFO,
  MARATHON_LENGTHS,
  KNOCKOUT_LIVES,
  HUNT_MAX_ROUNDS,
  KNOCKOUT_MAX_ROUNDS,
  defaultSettings,
  mergeSettings,
  placementPoints,
  huntTarget,
  placesFromScores,
  drawGames,
  poolFor,
  createMatch,
  ensureUpcoming,
  nextGame,
  upcomingGame,
  totalRounds,
  roundLabel,
  scoreRound,
  compareStanding,
  standings,
  matchOutcome,
  matchPoint
};
