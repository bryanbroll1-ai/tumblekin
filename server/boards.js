const BOARD_SIZE = 32;

const MOSSBACK_FIELDS = [
  "start", "normal", "normal", "normal", "challenge", "normal", "normal", "gate",
  "normal", "normal", "normal", "normal", "challenge", "normal", "normal", "gate",
  "normal", "normal", "normal", "normal", "challenge", "normal", "normal", "gate",
  "normal", "normal", "normal", "normal", "challenge", "normal", "normal", "gate"
];

const CLOUDPANTRY_FIELDS = [
  "start", "normal", "normal", "challenge", "normal", "normal", "normal", "gate",
  "normal", "challenge", "normal", "normal", "normal", "normal", "normal", "gate",
  "normal", "normal", "challenge", "normal", "normal", "normal", "normal", "gate",
  "normal", "normal", "normal", "normal", "challenge", "normal", "normal", "gate"
];

const TIDEWORKS_FIELDS = [
  "start", "normal", "normal", "normal", "normal", "normal", "challenge", "gate",
  "challenge", "normal", "normal", "normal", "normal", "normal", "normal", "gate",
  "normal", "normal", "normal", "challenge", "normal", "normal", "normal", "gate",
  "normal", "normal", "normal", "normal", "normal", "challenge", "normal", "gate"
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
  return {
    ...config,
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
