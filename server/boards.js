const BOARD_SIZE = 32;
const ROUTE_COST = 2;

const MOSSBACK_FIELDS = [
  "start", "spark", "boost", "snag", "challenge", "spark", "jinx", "gate",
  "spark", "snag", "boost", "spark", "challenge", "spark", "jinx", "gate",
  "spark", "boost", "snag", "spark", "challenge", "jinx", "spark", "gate",
  "spark", "snag", "boost", "spark", "challenge", "spark", "jinx", "gate"
];

const CLOUDPANTRY_FIELDS = [
  "start", "boost", "spark", "challenge", "snag", "spark", "jinx", "gate",
  "spark", "challenge", "spark", "boost", "snag", "spark", "jinx", "gate",
  "spark", "snag", "challenge", "spark", "boost", "spark", "jinx", "gate",
  "spark", "boost", "spark", "snag", "challenge", "spark", "jinx", "gate"
];

const TIDEWORKS_FIELDS = [
  "start", "spark", "jinx", "boost", "spark", "snag", "challenge", "gate",
  "challenge", "spark", "boost", "spark", "snag", "jinx", "spark", "gate",
  "spark", "boost", "snag", "challenge", "spark", "spark", "jinx", "gate",
  "spark", "snag", "jinx", "spark", "boost", "challenge", "spark", "gate"
];

const BOARD_DEFINITIONS = [
  createBoard({
    id: "mossback",
    name: "Runa, die Wurzelwanderin",
    shortName: "Wurzelwanderin",
    subtitle: "Ein lebender Wald mit Kronenweg und Herzbaum",
    badge: "Lebender Wald",
    feature: "Kurze Sprungwurzeln · 1 Münze",
    zones: ["Schweifhain", "Pilzmarkt", "Kronenpfad", "Herzwurzel"],
    fieldTypes: MOSSBACK_FIELDS,
    branches: { 4: 7, 12: 15, 20: 23, 28: 31 },
    routeCost: 1,
    shortcutName: "Sprungwurzel",
    swatches: ["#315b3f", "#b9f06f", "#f29a67"]
  }),
  createBoard({
    id: "cloudpantry",
    name: "Miraris Kometenhafen",
    shortName: "Kometenhafen",
    subtitle: "Schwebende Inseln, Luftschiffe und Sternenwind",
    badge: "Windschleifen",
    feature: "Windfähren überspringen 4 Felder · 2 Münzen",
    zones: ["Ankerwolke", "Sternensteg", "Ballonbucht", "Kometenkai"],
    fieldTypes: CLOUDPANTRY_FIELDS,
    branches: { 2: 7, 10: 15, 18: 23, 26: 31 },
    routeCost: 2,
    shortcutName: "Windfähre",
    swatches: ["#44517a", "#ffd06a", "#f58c8c"]
  }),
  createBoard({
    id: "tideworks",
    name: "Pelagos Leuchtriff",
    shortName: "Leuchtriff",
    subtitle: "Korallenstadt zwischen Fluträdern und Glasstegen",
    badge: "Risikoroute",
    feature: "Turbinenstege überspringen 5 Felder · 3 Münzen",
    zones: ["Korallentor", "Flutmarkt", "Glasgarten", "Leuchtkranz"],
    fieldTypes: TIDEWORKS_FIELDS,
    branches: { 1: 7, 9: 15, 17: 23, 25: 31 },
    routeCost: 3,
    shortcutName: "Turbinensteg",
    swatches: ["#176b78", "#69f0dc", "#f3c85d"]
  })
];

function createBoard(config) {
  if (config.fieldTypes.length !== BOARD_SIZE) {
    throw new Error(`${config.id} must define exactly ${BOARD_SIZE} fields.`);
  }
  return {
    ...config,
    routeCost: config.routeCost || ROUTE_COST,
    routes: Array.from({ length: BOARD_SIZE }, (_, index) => {
      const main = (index + 1) % BOARD_SIZE;
      const shortcut = config.branches[index];
      return shortcut === undefined ? [main] : [main, shortcut];
    })
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
    routeCost: board.routeCost,
    shortcutName: board.shortcutName,
    badge: board.badge,
    feature: board.feature,
    swatches: board.swatches
  };
}

module.exports = {
  BOARD_DEFINITIONS,
  BOARD_SIZE,
  ROUTE_COST,
  getBoard,
  publicBoard
};
