const BOARD_SIZE = 32;

// Field language. Every board carries the same mix so players learn one set of
// rules, but the positions differ so each board plays with its own rhythm:
//
//   start     – the loop's origin, a safe +2
//   normal    – a calm +2 breather
//   coin      – a fat +6 payday
//   item      – draws one item into your hand (the pre-roll decisions)
//   luck      – gamble: stake coins on a coin flip
//   trap      – costs coins unless you hold a shield
//   star      – a star pad; only ONE is lit at a time and sells the star
//   challenge – starts a minigame
//   gate      – passing it pays a bonus
//
// Four star pads per board: the lit one is the target everybody races for, and
// it jumps to another pad after each sale, so the goal keeps moving.
const MOSSBACK_FIELDS = [
  "start", "coin", "item", "normal", "challenge", "star", "normal", "gate",
  "luck", "normal", "item", "coin", "challenge", "star", "trap", "gate",
  "normal", "item", "coin", "luck", "challenge", "star", "normal", "gate",
  "trap", "coin", "item", "normal", "challenge", "star", "luck", "gate"
];

const CLOUDPANTRY_FIELDS = [
  "start", "item", "coin", "challenge", "normal", "luck", "star", "gate",
  "coin", "challenge", "item", "normal", "trap", "star", "coin", "gate",
  "item", "normal", "challenge", "luck", "star", "coin", "normal", "gate",
  "trap", "item", "normal", "coin", "challenge", "star", "luck", "gate"
];

const TIDEWORKS_FIELDS = [
  "start", "normal", "coin", "item", "star", "luck", "challenge", "gate",
  "challenge", "item", "coin", "star", "normal", "trap", "coin", "gate",
  "item", "luck", "normal", "challenge", "star", "coin", "normal", "gate",
  "coin", "item", "trap", "normal", "star", "challenge", "luck", "gate"
];

const BOARD_DEFINITIONS = [
  createBoard({
    id: "mossback",
    name: "Runa, die Wurzelwanderin",
    shortName: "Wurzelwanderin",
    subtitle: "Ein lebender Wald mit Kronenweg und Herzbaum",
    badge: "Lebender Wald",
    feature: "Kronenweg, Pilzmarkt und Herzbaum",
    zones: ["Schweifhain", "Pilzmarkt", "Kronenpfad", "Herzwurzel"],
    fieldTypes: MOSSBACK_FIELDS,
    swatches: ["#315b3f", "#b9f06f", "#f29a67"]
  }),
  createBoard({
    id: "cloudpantry",
    name: "Miraris Kometenhafen",
    shortName: "Kometenhafen",
    subtitle: "Schwebende Inseln, Luftschiffe und Sternenwind",
    badge: "Windschleifen",
    feature: "Schwebende Inseln und Sternenwind",
    zones: ["Ankerwolke", "Sternensteg", "Ballonbucht", "Kometenkai"],
    fieldTypes: CLOUDPANTRY_FIELDS,
    swatches: ["#44517a", "#ffd06a", "#f58c8c"]
  }),
  createBoard({
    id: "tideworks",
    name: "Pelagos Leuchtriff",
    shortName: "Leuchtriff",
    subtitle: "Korallenstadt zwischen Fluträdern und Glasstegen",
    badge: "Leuchtriff",
    feature: "Korallenstadt zwischen Fluträdern",
    zones: ["Korallentor", "Flutmarkt", "Glasgarten", "Leuchtkranz"],
    fieldTypes: TIDEWORKS_FIELDS,
    swatches: ["#176b78", "#69f0dc", "#f3c85d"]
  })
];

function createBoard(config) {
  if (config.fieldTypes.length !== BOARD_SIZE) {
    throw new Error(`${config.id} must define exactly ${BOARD_SIZE} fields.`);
  }
  const starPads = config.fieldTypes.reduce((pads, type, index) => {
    if (type === "star") pads.push(index);
    return pads;
  }, []);
  if (starPads.length < 2) {
    throw new Error(`${config.id} needs at least two star pads for the star to travel between.`);
  }
  return {
    ...config,
    starPads,
    // Simple, mobile-friendly loop: one path forward, no shortcut branches.
    routes: Array.from({ length: BOARD_SIZE }, (_, index) => [(index + 1) % BOARD_SIZE])
  };
}

function getBoard(boardId) {
  return BOARD_DEFINITIONS.find((board) => board.id === boardId) || BOARD_DEFINITIONS[0];
}

function publicBoard(board) {
  return {
    id: board.id,
    name: board.name,
    shortName: board.shortName,
    subtitle: board.subtitle,
    zones: board.zones,
    fieldTypes: board.fieldTypes,
    starPads: board.starPads,
    routes: board.routes,
    badge: board.badge,
    feature: board.feature,
    swatches: board.swatches
  };
}

module.exports = {
  BOARD_DEFINITIONS,
  BOARD_SIZE,
  getBoard,
  publicBoard
};
