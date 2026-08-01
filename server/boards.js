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
//
// ABZWEIGUNGEN. Vorher war jedes Brett ein Ring: routes[i] = [(i+1) % 32], eine
// einzige Bahn ohne jede Entscheidung. Der Würfel bestimmte alles, man selbst
// nichts — und alle drei Bretter unterschieden sich nur in der Reihenfolge der
// Feldtypen. Jedes Brett bekommt jetzt zwei Kreuzungen: an ihnen führt ein
// kurzer, aber teurer Weg an mehreren Ringfeldern vorbei. Wer ihn nimmt, spart
// Schritte Richtung Stern und zahlt dafür mit Fallen statt Münzen.
//
//   from   Ringfeld mit der Wahl (bekommt eine zweite Route)
//   to     Ringfeld, auf dem der Zweig wieder mündet
//   fields Feldtypen des Zweigs, in Laufrichtung
//   label  was auf dem Knopf steht
//
// Die Zweigfelder bekommen Indizes ab BOARD_SIZE. Ihre Position auf dem Brett
// leitet der Client aus den beiden Ringenden ab (Sehne zur Brettmitte gezogen),
// damit die handgesetzten Ringpunkte unangetastet bleiben.
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
    // Wurzelwanderin: der Wald schneidet quer durchs Dickicht. Beide Zweige
    // kosten eine Falle und sparen dafür Schritte (wie viele, rechnet
    // createBoard aus).
    branches: [
      { from: 3, to: 9, fields: ["trap", "coin"], label: "Dickicht", hint: "Falle, dann Münzen" },
      { from: 19, to: 25, fields: ["trap", "item"], label: "Wurzelgang", hint: "Falle, dann ein Gegenstand" }
    ],
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
    // Kometenhafen: Windschleifen über die Leere. Kürzer als im Wald, aber die
    // Sprungschneise hat gleich zwei Fallen — hier ist die Abkürzung teurer.
    branches: [
      { from: 2, to: 9, fields: ["trap", "trap", "coin"], label: "Sprungschneise", hint: "zwei Fallen, dann Münzen" },
      { from: 17, to: 23, fields: ["trap", "luck"], label: "Sternwind", hint: "Falle, dann Glücksspiel" }
    ],
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
    // Leuchtriff: die Flutrinne ist der längste Zweig und der einzige, auf dem
    // sich ein Stern kaufen lässt — dafür führt der Weg an zwei Fallen vorbei.
    branches: [
      { from: 5, to: 13, fields: ["trap", "star", "trap"], label: "Flutrinne", hint: "Sternplatz zwischen zwei Fallen" },
      { from: 21, to: 27, fields: ["trap", "coin"], label: "Glassteg", hint: "Falle, dann Münzen" }
    ],
    swatches: ["#176b78", "#69f0dc", "#f3c85d"]
  })
];

function createBoard(config) {
  if (config.fieldTypes.length !== BOARD_SIZE) {
    throw new Error(`${config.id} must define exactly ${BOARD_SIZE} fields.`);
  }

  // Der Ring bleibt, wie er war. Die Zweigfelder werden hinten angehängt, damit
  // alle Ringindizes (und damit die handgesetzten Positionen im Client) gleich
  // bleiben.
  const fieldTypes = [...config.fieldTypes];
  const routes = Array.from({ length: BOARD_SIZE }, (_, index) => [(index + 1) % BOARD_SIZE]);
  const branches = (config.branches || []).map((branch) => {
    if (branch.from < 0 || branch.from >= BOARD_SIZE || branch.to < 0 || branch.to >= BOARD_SIZE) {
      throw new Error(`${config.id}: Zweig muss zwischen zwei Ringfeldern liegen.`);
    }
    if (!branch.fields.length) {
      throw new Error(`${config.id}: ein Zweig ohne Felder wäre nur eine Abkürzung ohne Inhalt.`);
    }
    // Die Abkürzung muss auch wirklich kürzer sein als der Ring — sonst ist die
    // Wahl an der Kreuzung keine.
    const ringSteps = (branch.to - branch.from + BOARD_SIZE) % BOARD_SIZE;
    const branchSteps = branch.fields.length + 1;
    if (branchSteps >= ringSteps) {
      throw new Error(`${config.id}: Zweig ${branch.label} ist mit ${branchSteps} Schritten nicht kürzer als der Ring mit ${ringSteps}.`);
    }
    const indices = branch.fields.map((type) => {
      fieldTypes.push(type);
      return fieldTypes.length - 1;
    });
    // Vom Kreuzungsfeld führt jetzt eine ZWEITE Route in den Zweig; innerhalb
    // des Zweigs geht es geradeaus weiter und am Ende zurück auf den Ring.
    routes[branch.from] = [routes[branch.from][0], indices[0]];
    indices.forEach((fieldIndex, position) => {
      routes[fieldIndex] = [position + 1 < indices.length ? indices[position + 1] : branch.to];
    });
    return {
      from: branch.from,
      to: branch.to,
      label: branch.label,
      hint: branch.hint || "",
      fields: indices,
      steps: branchSteps,
      ringSteps,
      // Wie viele Felder der Zweig spart. Ausgerechnet statt hingeschrieben — ein
      // Text daneben wäre beim nächsten Umbau still falsch geworden.
      saves: ringSteps - branchSteps
    };
  });

  const starPads = fieldTypes.reduce((pads, type, index) => {
    if (type === "star") pads.push(index);
    return pads;
  }, []);
  if (starPads.length < 2) {
    throw new Error(`${config.id} needs at least two star pads for the star to travel between.`);
  }
  return { ...config, fieldTypes, starPads, branches, routes, ringSize: BOARD_SIZE };
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
    branches: board.branches,
    ringSize: board.ringSize,
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
