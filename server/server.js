const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const { BOARD_DEFINITIONS, BOARD_SIZE, getBoard, publicBoard } = require("./boards");

const PORT = Number(process.env.PORT || 3000);
// Developer tooling (four local players, launching any challenge on demand) is
// off unless explicitly enabled. A URL parameter alone must not unlock it, so
// production builds cannot be talked into dev mode by a crafted client.
const DEV_TOOLS_ENABLED = process.env.TUMBLEKIN_DEV_TOOLS === "1";
const APP_VERSION = require("../package.json").version;
const MAX_PLAYERS = 4;
const MAX_ROUNDS = 5;
const ARCADE_MARATHON_ROUNDS = 5;
const STARTING_COINS = 10;
const GATE_COIN_BONUS = 5;

// --- Board economy ---------------------------------------------------------
// Coins are no longer the goal, they are the means: the goal is stars, and the
// star only ever sits on ONE of the board's star pads. That gives every roll a
// target ("can I reach it?") and every coin a purpose ("can I afford it?").
const STAR_PRICE = 20;
// Der Preis steigt mit jedem verkauften Stern. Bei festem Preis war das
// Spätspiel flach: wer vorne lag, kaufte einfach weiter, und für alle anderen
// war die Partie entschieden, lange bevor sie zu Ende war. Jetzt ist der erste
// Stern billig und jeder weitere teurer — Vorsprung kostet, und ein Rückstand
// bleibt aufholbar.
const STAR_PRICE_STEP = 6;
const STAR_PRICE_MAX = 44;

function starPrice(room) {
  const sold = room?.starsSold || 0;
  return Math.min(STAR_PRICE_MAX, STAR_PRICE + sold * STAR_PRICE_STEP);
}
const COIN_FIELD_REWARD = 6;
const NORMAL_FIELD_REWARD = 2;
const TRAP_FIELD_COST = 8;
const LUCK_FIELD_STAKE = 10;
const LUCK_FIELD_WIN = 25;
const MAX_ITEMS = 3;
// Final-round bonus stars keep last place playing: nobody is mathematically
// out until the very end.
const BONUS_STAR_COINS = 1;
const BONUS_STAR_WINS = 1;

const GOLD_DICE_MIN = 6;
const GOLD_DICE_SPAN = 3;              // 6, 7 oder 8

const ITEM_DEFINITIONS = [
  {
    id: "doubleDice",
    name: "Doppelwürfel",
    icon: "🎲",
    help: "Zwei Würfel addiert: 2 bis 12. Die einzige Chance auf mehr als acht — dafür kann es auch danebengehen."
  },
  {
    id: "goldDice",
    name: "Goldwürfel",
    icon: "✨",
    help: "Sicher 6, 7 oder 8. Nie mehr, aber auch nie weniger."
  },
  {
    id: "swapBell",
    name: "Tauschglocke",
    icon: "🔔",
    help: "Tauscht deine Position mit dem Spieler, der dem Stern am nächsten ist."
  },
  {
    id: "stickyTrap",
    name: "Klebefalle",
    icon: "🍯",
    help: "Halbiert den nächsten Wurf des Führenden."
  },
  {
    id: "shield",
    name: "Schutzschild",
    icon: "🛡️",
    help: "Blockt die nächste Falle oder fremde Item-Wirkung."
  }
];

function itemDefinition(id) {
  return ITEM_DEFINITIONS.find((item) => item.id === id) || null;
}

function randomItemId() {
  return ITEM_DEFINITIONS[Math.floor(Math.random() * ITEM_DEFINITIONS.length)].id;
}
const RESULT_HOLD_MS = 6500;
// When a round is decided early (last one standing, everyone finished), the
// scene keeps playing for this long — winners celebrate on camera — before
// the scoreboard appears. No more abrupt cuts.
const MINIGAME_FINALE_MS = 2600;
const DICE_REVEAL_MS = 700;
const BOARD_STEP_MS = 250;

const COLORS = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"];
const FIELD_TYPES = BOARD_DEFINITIONS[0].fieldTypes;

// Der Signalplan von Falschsignal muss genau so lang sein wie die Runde, sonst
// endet das Spiel mitten in einem Signal oder läuft am Ende leer weiter. Steht
// darum hier oben, wo der Katalog die Länge schon braucht.
const FEINT_DURATION_MS = 32000;
const BELT_DURATION_MS = 34000;
// Spürsinn braucht Zeit zum DENKEN, nicht zum Reagieren — das ist im ganzen
// Katalog das einzige Spiel, das nachrechnet statt zuckt. 42 s reichen bei
// gutem Spiel für vier bis fünf Fundstücke und bei Rateglück für zwei.
const SEEK_DURATION_MS = 42000;
// Augenmass — ein Schwarm blitzt kurz auf, danach schätzt man, wie viele es
// waren. Vier Durchgänge; die Zeiten stehen fest, damit alle denselben Blick
// haben und die Anzeige nie gegen den Server läuft.
const ESTIMATE_ROUNDS = 4;
const ESTIMATE_SHOW_MS = 1500;         // so lange ist der Schwarm zu sehen
const ESTIMATE_GUESS_MS = 4500;        // so lange darf geschätzt werden
const ESTIMATE_REVEAL_MS = 1900;       // Auflösung, gemeinsam
const ESTIMATE_LEAD_IN_MS = 900;
const ESTIMATE_DURATION_MS = ESTIMATE_LEAD_IN_MS
  + ESTIMATE_ROUNDS * (ESTIMATE_SHOW_MS + ESTIMATE_GUESS_MS + ESTIMATE_REVEAL_MS) + 500;
const GLIDE_DURATION_MS = 34000;
const SIMON_DURATION_MS = 36000;
const DIVE_DURATION_MS = 36000;
const FISH_DURATION_MS = 34000;
const PAINT_DURATION_MS = 32000;

// Only the fully 3D challenges remain; the flat 2D minigames were retired.
const MINIGAMES = [
  { type: "bounceArena", title: "Bumper Bloom", duration: 18000 },
  { type: "finishRush", title: "Zielgerade", duration: 42000, arcadeFamily: "runner" },
  { type: "colorEscape", title: "Farbflucht", duration: 46000, arcadeFamily: "colorgrid" },
  { type: "nervenprobe", title: "Nervenprobe", duration: 14000, arcadeFamily: "stopclock" },
  { type: "lichtwaechter", title: "Lichtwächter", duration: 32000, arcadeFamily: "redlight" },
  { type: "ballonPump", title: "Pump-Panik", duration: 12000, arcadeFamily: "pump" },
  { type: "fassrolle", title: "Fassrolle", duration: 32000, arcadeFamily: "barrel" },
  { type: "zuendstoff", title: "Zündstoff", duration: 45000, arcadeFamily: "bomb" },
  { type: "muenzregen", title: "Münzregen", duration: 30000, arcadeFamily: "catchfall" },
  { type: "blobklopfe", title: "Blob-Klopfe", duration: 25000, arcadeFamily: "whack" },
  { type: "seilspringen", title: "Seilspringen", duration: 35000, arcadeFamily: "wave" },
  { type: "kanonenflug", title: "Kanonenflug", duration: 16000, arcadeFamily: "cannon" },
  { type: "messerwurf", title: "Messerwurf", duration: 60000, arcadeFamily: "knife" },
  { type: "turmbau", title: "Turmbau", duration: 30000, arcadeFamily: "stack" },
  { type: "bergsteiger", title: "Bergsteiger", duration: 26000, arcadeFamily: "climb" },
  { type: "ballonfahrt", title: "Ballonfahrt", duration: GLIDE_DURATION_MS, arcadeFamily: "glide" },
  { type: "sumoschubs", title: "Sumo-Schubs", duration: 40000, arcadeFamily: "sumo" },
  { type: "trampolin", title: "Trampolin", duration: 30000, arcadeFamily: "bounce" },
  { type: "falschsignal", title: "Falschsignal", duration: FEINT_DURATION_MS, arcadeFamily: "feint" },
  { type: "spurmaler", title: "Spurmaler", duration: 30000, arcadeFamily: "trace" },
  { type: "sortierband", title: "Sortierband", duration: BELT_DURATION_MS, arcadeFamily: "belt" },
  { type: "leuchtfolge", title: "Leuchtfolge", duration: SIMON_DURATION_MS, arcadeFamily: "simon" },
  { type: "blitzreflex", title: "Blitzreflex", duration: 19000, arcadeFamily: "react" },
  { type: "nagelbrett", title: "Nagelbrett", duration: 28000, arcadeFamily: "plinko" },
  { type: "eisstock", title: "Eisstock", duration: 34000, arcadeFamily: "curling" },
  { type: "tiefenrausch", title: "Tiefenrausch", duration: DIVE_DURATION_MS, arcadeFamily: "dive" },
  { type: "angelduell", title: "Angelduell", duration: FISH_DURATION_MS, arcadeFamily: "fish" },
  { type: "spuersinn", title: "Spürsinn", duration: SEEK_DURATION_MS, arcadeFamily: "seek" },
  { type: "augenmass", title: "Augenmaß", duration: ESTIMATE_DURATION_MS, arcadeFamily: "estimate" },
  { type: "farbenjagd", title: "Farbenjagd", duration: PAINT_DURATION_MS, arcadeFamily: "paint" }
];

const ARCADE_CONFIGS = {
  finishRush: { family: "runner", seed: 367 },
  colorEscape: { family: "colorgrid", seed: 379 },
  nervenprobe: { family: "stopclock", seed: 353 },
  lichtwaechter: { family: "redlight", seed: 389 },
  ballonPump: { family: "pump", seed: 401 },
  fassrolle: { family: "barrel", seed: 409 },
  zuendstoff: { family: "bomb", seed: 419 },
  muenzregen: { family: "catchfall", seed: 421 },
  blobklopfe: { family: "whack", seed: 431 },
  seilspringen: { family: "wave", seed: 433 },
  kanonenflug: { family: "cannon", seed: 439 },
  messerwurf: { family: "knife", seed: 457 },
  turmbau: { family: "stack", seed: 461 },
  bergsteiger: { family: "climb", seed: 463 },
  ballonfahrt: { family: "glide", seed: 467 },
  sumoschubs: { family: "sumo", seed: 479 },
  trampolin: { family: "bounce", seed: 487 },
  falschsignal: { family: "feint", seed: 491 },
  spurmaler: { family: "trace", seed: 499 },
  sortierband: { family: "belt", seed: 503 },
  leuchtfolge: { family: "simon", seed: 521 },
  blitzreflex: { family: "react", seed: 541 },
  nagelbrett: { family: "plinko", seed: 563 },
  eisstock: { family: "curling", seed: 577 },
  tiefenrausch: { family: "dive", seed: 599 },
  angelduell: { family: "fish", seed: 509 },
  farbenjagd: { family: "paint", seed: 521 },
  spuersinn: { family: "seek", seed: 619 },
  augenmass: { family: "estimate", seed: 733 }
};

// Ballonfahrt — halten steigt, loslassen sinkt, und der Kurs kommt in Toren
// auf einen zu. Ersetzt den Schleuderschuss.
//
// Der Schleuderschuss hatte einen Grundfehler, den man nicht wegtunen kann:
// zwischen Zug und Einschlag passiert NICHTS. Man stellt zwei Zahlen ein und
// schaut dann zu. Hier hängt jede Millisekunde an der Hand, alle vier fliegen
// gleichzeitig durch denselben Kurs, und man sieht die ganze Zeit, wer vorn
// liegt.
const GLIDE_GRAVITY = 0.95;            // Höhenanteile pro Sekunde²
const GLIDE_LIFT = 1.9;                // beim Halten, also netto +0.95 nach oben
const GLIDE_VY_MAX = 0.72;             // Höhenanteile pro Sekunde
const GLIDE_GATE_FIRST_MS = 2600;      // das erste Tor kommt mit Vorlauf
const GLIDE_GATE_EVERY_MS = 1500;
const GLIDE_GATE_GAP_START = 0.30;     // lichte Weite als Höhenanteil
const GLIDE_GATE_GAP_END = 0.15;
// Wieviel ein Tor gegenüber dem vorherigen springen darf. Aus der Physik
// gerechnet und nicht geraten: mit GLIDE_VY_MAX schafft man in 1500 ms rund
// 1.08 Höhenanteile, aber Beschleunigen und Abbremsen kosten davon gut die
// Hälfte. Grössere Sprünge wären nicht schwer, sondern unmöglich.
const GLIDE_GATE_MAX_STEP = 0.52;
const GLIDE_GATE_POINTS = 100;
const GLIDE_CENTRE_BONUS = 50;         // volle Zugabe für die Tormitte
const GLIDE_STALL_MS = 420;            // nach Boden- oder Deckenberührung

// Sumo-Schubs — ein Stein rollt im Ring umher und ist immer auf jemanden
// gerichtet. Wer ihn nicht rechtzeitig zurückschlägt, kassiert einen Treffer.
//
// Das Spiel hatte drei Fehler im Aufbau, die sich nicht wegtunen liessen, und
// alle drei sind hier repariert:
//
//  1. Jeder Stoss schob den Stein vom eigenen Platz weg — er war damit Angriff
//     UND Verteidigung in einem, ohne Zielkonflikt. Die beste Strategie war
//     schlicht Dauerdrücken, und gemessen kassierte genau der Bot, der am
//     wenigsten überlegte, die wenigsten Treffer. Jetzt greift ein Stoss nur im
//     eigenen Viertel; daneben ist er ein Fehlgriff und kostet die Ausholzeit.
//  2. Bei festen Plätzen zeigt die Summe der Stossrichtungen von drei Leuten
//     zwangsläufig auf den vierten. Ohne Absicht wirkte das wie Absicht — „die
//     Bots zielen auf mich" stimmte sogar. Der Ring läuft jetzt um, jede Person
//     unterschiedlich schnell, damit es diese eine Senke nicht gibt.
//  3. Jeder Austritt kostete zwangsläufig jemanden einen Treffer. Treffer waren
//     damit eine Erhaltungsgrösse: bei vier Leuten und drei Treffern bis zum Aus
//     flogen ALLE VIER jede Runde raus, egal wie gut sie spielten. Jetzt kann
//     man jeden Angriff abwehren — wenn man rechtzeitig geladen hat.
const SUMO_RING_RADIUS = 1.0;          // normiert: Stein ausserhalb = Treffer
const SUMO_CHARGE_MS = 900;           // volle Kraft nach dieser Haltezeit
const SUMO_MIN_CHARGE_MS = 120;        // darunter zählt es als Antippen
const SUMO_MAX_IMPULSE = 1.35;          // Geschwindigkeitsänderung bei Vollkraft
const SUMO_FRICTION = 0.25;             // pro Sekunde
const SUMO_SERVE_SPEED = 0.5;         // Tempo, mit dem der Stein neu anrollt
// Ein Stoss greift NUR, wenn der Stein im eigenen Viertel schon weit genug
// draussen ist. Das Fenster von hier bis zum Rand ist die eigentliche Aufgabe:
// bei mittlerem Steintempo sind das gut vier Zehntelsekunden.
const SUMO_ZONE = 0.30;                // ab diesem Anteil des Radius erreichbar
// Nach einem Fehlgriff holt man aus und kann so lange nicht laden. Ohne diese
// Pause wäre Dauerdrücken wieder kostenlos.
const SUMO_RECOVER_MS = 600;
// Einen Stein, der auf einen zurollt, schlägt man wuchtiger zurück als einen,
// der ohnehin schon wegrollt.
//
// Eine reine Reichweitengrenze (Stoss wird schwächer, je weiter der Stein weg
// ist) war der falsche Weg und steht hier als Warnung: sie STABILISIERT den
// Ring, weil immer genau die Person am kräftigsten schieben kann, auf die der
// Stein zuläuft. Gemessen kam der Stein danach nie über die Hälfte des Radius
// hinaus und in 20 Partien fiel kein einziger Treffer.
const SUMO_MEET_MIN = 0.5;             // Stein rollt weg — halbherziger Stoss
const SUMO_MEET_MAX = 2.2;             // Stein kommt entgegen — voller Konter
const SUMO_HITS_OUT = 5;               // so viele Treffer und man ist raus
// Alle laufen langsam um den Ring, und zwar jede Person unterschiedlich schnell
// — siehe Punkt 2 oben.
const SUMO_ORBIT_BASE = 0.26;          // Bogenmass pro Sekunde
const SUMO_ORBIT_SPREAD = 0.075;       // Unterschied je Platz

// Trampolin: ein Takt schlägt gleichmässig, Tippen IM Takt federt höher.
// Aufeinanderfolgende Treffer bauen Resonanz auf — daneben tippen bricht sie.
// Der Takt wird schneller, also muss man sich neu einhören.
// Der Takt läuft in TAKTEN zu acht Schlägen, und innerhalb eines Taktes bleibt
// er gleich. Vorher wurde jeder einzelne Schlag um 3.5 % schneller als der
// vorige — damit hatte kein Schlag denselben Abstand wie sein Vorgänger, und man
// konnte sich nie einhören. Genau das ist der Kern eines Rhythmusspiels: erst
// einen Takt finden, dann darin sicher werden, und der Wechsel kommt hörbar an
// einer Taktgrenze statt schleichend.
const BOUNCE_BAR_BEATS = 8;            // so viele Schläge, dann wird es schneller
// Der schnellste Takt muss WEITER auseinander liegen als das Trefferfenster
// breit ist: bei 340 ms lag jeder Tipper höchstens 170 ms neben dem nächsten
// Schlag — also immer innerhalb der 220 ms für einen Teiltreffer. Danebentippen
// wäre am Ende der Runde schlicht unmöglich gewesen.
const BOUNCE_TEMPOS = [900, 800, 720, 650, 590, 540];
const BOUNCE_BEAT_START_MS = BOUNCE_TEMPOS[0];
const BOUNCE_BEAT_MIN_MS = BOUNCE_TEMPOS[BOUNCE_TEMPOS.length - 1];
const BOUNCE_PERFECT_MS = 110;         // Fenster für einen Volltreffer
const BOUNCE_GOOD_MS = 220;            // Fenster für einen Teiltreffer
// Der Zugewinn je Treffer ist bewusst klein: der Takt liefert über eine Runde
// rund 45 Schläge, und bei 1.0 je Volltreffer war die Höchsthöhe nach wenigen
// Sekunden für JEDE Bot-Stufe erreicht. Die Marke soll ein Ziel sein, keine
// Selbstverständlichkeit.
const BOUNCE_GAIN_PERFECT = 0.4;
const BOUNCE_GAIN_GOOD = 0.15;
const BOUNCE_MISS_PENALTY = 1.2;       // Höhenverlust bei Fehltritt
// Je höher man ist, desto teurer wird ein Fehltritt. Ohne das kostete ein
// Fehler immer gleich viel, und gemessen erreichten ALLE drei Bot-Stufen die
// Höchsthöhe — auch die schwache mit acht Fehltritten. Höhe muss oben riskant
// werden, sonst ist der Deckel nach ein paar Sekunden für jeden erreicht.
const BOUNCE_MISS_SCALE = 0.12;        // zusätzlicher Verlust je Höhenmeter
// Kein Deckel nach oben: wer den Takt hält, steigt weiter. Vorher war bei 32
// Schluss und die letzten Sekunden liefen ins Leere. Der Wert bleibt als
// Sicherheitsnetz stehen, damit die Kamera nicht ins Nichts fährt.
const BOUNCE_MAX_HEIGHT = 400;

// Falschsignal — aus einem Leuchtpunkt wächst ein Ring nach aussen. Nur ein
// Ring, der die MARKE erreicht, ist echt; die anderen bleiben unterwegs stehen
// und verlöschen. Wer tippt, wettet darauf, dass dieser Ring durchkommt.
//
// Vorher war es ein Nachschlagespiel: grüner Kreis = echt, andere Farbe oder
// andere Form = falsch. Man erkannte es oder eben nicht, und dazwischen lag
// nichts. Jetzt sammelt sich die Information ÜBER DIE ZEIT an: echt und falsch
// starten mit exakt derselben Geschwindigkeit und laufen erst nach und nach
// auseinander, weil der falsche Ring langsamer wird. Früh tippen bringt viel
// und ist geraten, spät tippen ist sicher und bringt wenig. Das ist die
// Entscheidung, die das Spiel jede einzelne Runde stellt.
const FEINT_LEAD_IN_MS = 1400;         // Ruhe vor dem ersten Ring
const FEINT_GAP_MIN_MS = 800;          // Abstand zwischen den Ringen
const FEINT_GAP_MAX_MS = 1900;
const FEINT_GROW_MS = 950;             // so lange braucht ein echter Ring bis zur Marke
const FEINT_HOLD_MS = 480;             // danach steht er noch und zählt minimal
const FEINT_FADE_MS = 420;             // ein falscher Ring verlischt so lange
const FEINT_MIN_POINTS = 80;           // wer bis zur Marke wartet
const FEINT_MAX_POINTS = 500;          // wer sofort tippt
// Der Abzug ist bewusst höher als der halbe Treffer: bei einem echten Ring pro
// Dreierblock muss blindes Dauertippen unterm Strich Punkte KOSTEN. Ein
// einzelner Fehlgriff bleibt trotzdem aufholbar, weil ein guter Treffer mehr
// bringt als ein Fehlgriff nimmt.
const FEINT_FALSE_START = 300;         // Abzug für einen Fehlgriff
const FEINT_LOCK_MS = 650;             // Sperre nach einem Fehlgriff
const FEINT_DOUBLE_TAP_MS = 260;       // Nachzittern nach einem Treffer ignorieren
// Wie weit ein falscher Ring kommt, bevor er stehenbleibt. Die drei Werte
// rotieren, statt frei gewürfelt zu werden: gewürfelt kamen drei fast gleiche
// Fälschungen in Folge, und die schwerste tauchte manchmal eine ganze Runde
// nicht auf.
const FEINT_FAKE_LIMITS = [0.56, 0.72, 0.88];
const FEINT_BLOCK = 3;                 // je Dreierblock genau ein echter Ring

// Spurmaler: eine geschwungene Spur läuft von unten nach oben; der Finger muss
// im Toleranzband bleiben. Der Fortschritt hängt direkt daran, wie weit oben der
// Finger auf der Spur steht — schnell ziehen bringt mehr, aber ausserhalb des
// Bandes reisst der Strich ab. Jede geschaffte Runde bringt eine neue Kurve.
const TRACE_TOLERANCE = 0.085;         // erlaubter Abstand zur Spur (Breite = 1)
const TRACE_STEP_LIMIT = 0.05;         // maximaler Sprung pro Eingabe
// Deckel gegen Tipp-Stepping: ohne ihn liesse sich die Spur in Sprüngen
// abklopfen, statt sie zu ziehen — gemessen deutlich schneller als jeder Finger.
// Eine saubere Runde braucht 2.5–4 s, also 0.25–0.4 pro Sekunde; 0.6 lässt jedem
// echten Zug Luft und nimmt dem Abklopfen jeden Vorteil.
const TRACE_MAX_SPEED = 0.6;           // Fortschritt pro Sekunde
const TRACE_REENTRY_WINDOW = 0.05;     // Wiedereinstieg nur an der Bruchstelle
const TRACE_SLIP_LOCK_MS = 350;        // Pause, nachdem der Strich abgerissen ist
const TRACE_LAP_POINTS = 200;          // eine ganze Runde
const TRACE_SLIP_COST = 25;            // Abzug je Abrutscher
const TRACE_CLEAN_BONUS = 40;          // Zugabe für eine Runde ohne Abrutscher
const TRACE_MAX_LAPS = 40;             // Sicherheitsnetz gegen endlose Runden
// Die Spur ist nicht überall gleich breit, und auf ihr liegen Kristalle.
//
// Vorher war jede Runde derselbe gleichmässige Zug: die Kurve wechselte, die
// Aufgabe nie. Man zog den Finger im Band nach oben, und ob man dabei mittig
// oder am Rand lief, war völlig egal. Zwei Zutaten machen daraus ein Spiel mit
// Verlauf: Engstellen geben der Runde einen Rhythmus aus leicht und eng, und
// die Kristalle liegen ABSEITS der Mittellinie — man muss also nicht nur im
// Band bleiben, sondern sich darin bewusst positionieren.
const TRACE_NARROW_MIN = 0.42;         // engste Stelle als Anteil der Toleranz
const TRACE_GEMS_PER_LAP = 4;
const TRACE_GEM_POINTS = 55;
// Die Reichweite muss KLEINER sein als der seitliche Versatz, sonst fällt einem
// der Kristall schon auf der Mittellinie zu — dann wäre er kein Ziel, sondern
// nur Deko, und der Griff nach ihm brächte nichts.
const TRACE_GEM_REACH = 0.032;         // so nah muss der Finger am Kristall sein
const TRACE_GEM_SIDE = 0.72;           // wie weit aussen im Band er liegt

// Sortierband — Pakete laufen auf einen zu, drei Rutschen tragen Farben, und
// jedes Paket muss in die passende. Ersetzt den Tellerdreher: der Archetyp
// „Aufmerksamkeit teilen" bleibt, aber statt sechs Tellern immer wieder
// dieselbe Bewegung zu geben, trifft man laufend echte Entscheidungen — und die
// Rutschen tauschen zwischendurch die Farben, sodass Auswendiglernen nicht
// reicht.
const BELT_COLOURS = 3;                // Farben — genau so viele wie Rutschen,
                                       // damit jedes Paket IMMER ein Ziel hat
const BELT_CHUTES = 3;                 // so viele Rutschen stehen zur Wahl
const BELT_QUEUE = 3;                  // so weit sieht man voraus
const BELT_GAP = 0.34;                 // Abstand der Pakete auf dem Band
const BELT_SPEED_START = 0.30;         // Bandanteil pro Sekunde
const BELT_SPEED_END = 0.86;           // am Ende der Runde
const BELT_REACH_AT = 0.34;            // ab hier ist das vorderste Paket greifbar
const BELT_SWAP_FIRST_MS = 7000;       // erster Farbtausch der Rutschen
const BELT_SWAP_EVERY_MS = 6500;
const BELT_SWAP_WARN_MS = 1200;        // so lange vorher wird der Tausch angekündigt
const BELT_POINTS = 100;               // richtig einsortiert
const BELT_STREAK_BONUS = 12;          // je Paket in Folge, gedeckelt
const BELT_STREAK_MAX = 8;
const BELT_WRONG_COST = 60;            // falsche Rutsche
const BELT_MISS_COST = 40;             // Paket durchgelassen

// Angelduell: der Fisch hängt, jetzt geht es um die Schnur. Halten holt ein und
// baut Spannung auf, Loslassen lässt sie sinken. Der Fisch wehrt sich in
// Schüben — wer dann weiter einholt, kommt schneller voran, riskiert aber den
// Riss. Das ist die ganze Entscheidung, und sie stellt sich alle paar Sekunden neu.
// Gespielt geeicht, nicht geschätzt. Mit den ersten Werten riss NIE eine
// Schnur und alle vier landeten exakt drei Fische — 5% Abstand über das ganze
// Feld. Der Grund: Loslassen kostete fast nichts (0.055/s) und der Schub riss
// fast sicher (0.95/s), also war "im Schub loslassen" ohne Abwägung richtig.
// Jetzt kostet Loslassen echten Weg, und ein kurzer Schub lässt sich mit
// niedriger Spannung durchhalten — genau dort liegt die Entscheidung. Ein
// langer Schub bestraft dieselbe Gier.
const FISH_REEL_SPEED = 0.30;          // Weg pro Sekunde beim Einholen
const FISH_SLIP_SPEED = 0.13;          // der Fisch entfernt sich, wenn man löst
const FISH_TENSION_CALM = 0.26;        // Spannungsaufbau beim ruhigen Einholen
const FISH_TENSION_SURGE = 0.62;       // im Schub — hier wird es eng
const FISH_RELAX = 0.45;               // Spannungsabbau beim Loslassen
const FISH_HOLD_GRACE_MS = 190;        // so lange gilt ein Halte-Ping
const FISH_SNAP_PAUSE_MS = 1400;       // Pause nach einem Riss
const FISH_SNAP_COST = 80;             // Grundabzug, wenn keine Art bekannt ist
const FISH_SNAP_SHARE = 0.75;          // Anteil des Fischwertes, den ein Riss kostet
const FISH_LANDED_POINTS = 300;
const FISH_CALM_MIN_MS = 1400;         // Länge der ruhigen Phase
const FISH_CALM_MAX_MS = 2600;
const FISH_SURGE_MIN_MS = 900;         // Länge eines Schubs
const FISH_SURGE_MAX_MS = 1600;
const FISH_LEAD_IN_MS = 900;           // Ruhe, bevor der erste Schub kommt
const FISH_MAX_CATCH = 20;             // Sicherheitsnetz
// Vier Fischarten statt eines Einheitsfisches. Sie unterscheiden sich in dem,
// was man beim Spielen tatsächlich spürt: wie schnell sie näher kommen, wie hart
// sie im Schub ziehen — und was sie am Ende wert sind.
//
// Das ist auch eine echte Entscheidung, nicht nur Deko: ein Wels bringt fünfmal
// so viel wie eine Sprotte, zieht aber so hart, dass ein unaufmerksamer Moment
// die Schnur kostet. Wer nur Sprotten sicher landet, kommt nicht an jemanden
// heran, der einen Wels durchgebracht hat.
// Die Werte sind gerechnet, nicht geraten. Beim ersten Versuch war der Wels mit
// reel 0.62 und surge 1.75 schlicht NICHT landbar: netto rund 0.028 Strecke pro
// Sekunde, also 36 Sekunden für einen Fisch in einer 34-Sekunden-Runde.
// Gemessen landete in 160 Bot-Runden kein einziger. Der Wert eines Fisches darf
// aus dem RISIKO kommen, nicht aus Unmöglichkeit.
const FISH_SPECIES = [
  { id: "sprotte", name: "Sprotte", points: 130, reel: 1.35, surge: 0.70, calm: 0.85, colour: "#9fd8f2", size: 0.65, weight: 34 },
  { id: "barsch", name: "Barsch", points: 240, reel: 1.15, surge: 1.05, calm: 1.00, colour: "#71d97b", size: 1.00, weight: 32 },
  { id: "hecht", name: "Hecht", points: 400, reel: 1.00, surge: 1.45, calm: 1.05, colour: "#ffd15c", size: 1.35, weight: 22 },
  { id: "wels", name: "Wels", points: 680, reel: 0.88, surge: 1.95, calm: 1.10, colour: "#ff5d73", size: 1.75, weight: 12 }
];

// Farbenjagd: EINE geteilte Fläche für alle. Jeder Kin färbt das Feld, auf dem
// er steht, in seine Farbe — auch wenn dort schon eine fremde liegt. Das ist der
// Unterschied zu allen bisherigen Spielen: hier nimmt man sich gegenseitig
// Boden ab, statt nebeneinander zu punkten. Gewonnen hat, wer am Ende die
// meisten Felder hält, und ein fremdes Feld zu übermalen zählt doppelt: es
// bringt dir eines und nimmt dem anderen eines.
// 5 x 11 statt 7 x 9: das Seitenverhaeltnis des Feldes (0.45) muss zu dem des
// Handybildes (0.46) passen. Mit 7 x 9 lagen die vorderen Ecken bei 1.83 NDC —
// weit ausserhalb des Bildes. Am Bild gerechnet passt 5 x 11 bei 0.5 Weltmass
// pro Feld genau: 78 px pro Feld und die Kamera darf 29 Grad geneigt bleiben,
// sodass die Figuren noch Volumen haben.
const PAINT_COLS = 5;
const PAINT_ROWS = 11;
// Gemessen und daraufhin umgebaut: mit sofortigem Umfärben war das Feld nach
// vier Sekunden voll, danach flippten die Felder mehrere Male pro Sekunde
// (gemessen 144 bis 309 Übermalungen je Spieler) und gewonnen hatte, wer im
// letzten Tick zufällig auf den meisten stand. Ein Münzwurf, kein Spiel.
//
// Zwei Änderungen machen daraus Flächenkontrolle:
//  * Ein Feld wird nicht getroffen, sondern BEANSPRUCHT. Fremder Anspruch muss
//    erst abgetragen werden, dann der eigene aufgebaut — ein fremdes Feld
//    kostet also doppelt so lange wie ein freies und verlangt, dass man dort
//    bleibt statt durchzufahren.
//  * Gewertet wird die Fläche über die ZEIT (Feldsekunden), nicht der Stand am
//    Ende. Wer lange viel hält, gewinnt; ein Ausfall im letzten Moment
//    entscheidet nichts mehr.
const PAINT_SPEED = 2.2;               // Felder pro Sekunde
const PAINT_CLAIM_RATE = 3.5;          // Anspruch pro Sekunde
// Ein fremdes Feld zu übermalen dauert etwas länger als ein freies zu nehmen —
// aber nur etwas. Es muss sich lohnen, dem Gegner etwas wegzunehmen, ohne dass
// Angriff immer die beste Antwort ist.
const PAINT_STEAL_RATE = 0.75;
const PAINT_ACCEL = 14;                // wie schnell die Richtung greift
const PAINT_DAMPING = 0.86;
const PAINT_BUMP_RADIUS = 0.78;        // ab hier schubsen sich zwei Kins
const PAINT_BUMP_FORCE = 5.2;
const PAINT_BUMP_COOLDOWN_MS = 500;    // ein Rempler, nicht einer pro Tick
const PAINT_TILE_SECOND_POINTS = 4;    // Punkte je gehaltenem Feld und Sekunde
const PAINT_BOOST_MS = 5000;           // Dauer der breiten Rolle
const PAINT_PICKUP_EVERY_MS = 4200;
const PAINT_PICKUP_MAX = 2;

// Spürsinn — im ganzen Katalog das einzige Spiel, das NACHDENKEN verlangt statt
// zu reagieren. 28 Minispiele messen Reflex, Timing, Steuerung, Rhythmus und
// Gedächtnis; keines fragt "was folgt daraus?".
//
// Ein Fundstück liegt versteckt im Feld. Jeder Tipp auf ein Feld verrät, wie
// viele Schritte es bis dorthin sind (hoch/runter/links/rechts gezählt, nicht
// über Eck). Wer die Angaben kombiniert, hat es in drei bis vier Tipps; wer
// blind sucht, braucht im Schnitt dreizehn. Genau darin liegt das Können.
//
// Warum Manhattan und nicht Luftlinie über Eck: die Zahlen sind so von 0 bis 8
// gestreut statt nur 0 bis 4, jeder Tipp trennt also doppelt so scharf. Und
// "Schritte" versteht am Tisch jeder sofort, "Abstand" nicht.
const SEEK_SIZE = 6;                   // 6x6 = 36 Felder
const SEEK_BASE_POINTS = 150;          // ein Fund mit null Tipps wäre so viel wert
const SEEK_PROBE_COST = 18;            // jeder Tipp zieht ab …
const SEEK_MIN_POINTS = 20;            // … aber ein Fund zählt immer etwas
// Ein Tipp pro 260 ms reicht für zügiges Suchen und verhindert, dass jemand mit
// einem Wischen über das Raster einfach alle 25 Felder aufdeckt.
const SEEK_COOLDOWN_MS = 260;
// Wie lange ein Bot je Tipp braucht. Der entscheidende Punkt des ganzen Spiels
// steckt in diesen drei Zahlen: NACHDENKEN KOSTET ZEIT.
//
// Zuerst tippten alle Stufen gleich schnell, damit nur die Denkleistung den
// Unterschied macht. Gemessen kam dabei ein Bot heraus, der 35 Fundstücke in
// 42 Sekunden hebt und 4152 Punkte macht, wo blindes Suchen auf 199 kommt — das
// Zwanzigfache. Bots füllen im echten Spiel freie Plätze, und gegen so einen
// hätte kein Mensch je eine Chance gehabt.
//
// Der Fehler war nicht die Denkleistung, sondern dass sie umsonst war. Wer alle
// Angaben im Kopf zusammenrechnet, braucht dafür einen Moment; wer blind tippt,
// tippt eben schnell. Damit wird aus dem Spiel eine echte Frage — denken oder
// draufhalten? — statt einer Rechenaufgabe, die der Schnellste gewinnt.
const SEEK_BOT_INTERVAL = { easy: 400, normal: 700, hard: 1150 };

// Augenmass — ein Schwarm blitzt auf, dann schätzt man die Anzahl.
//
// Der Katalog misst Reflex, Timing, Steuerung, Rhythmus, Gedächtnis und seit
// Spürsinn auch Schlussfolgern. Was fehlt, ist WAHRNEHMUNG: die Fähigkeit, eine
// Menge auf einen Blick einzuschätzen, ohne zu zählen. Darin sind Menschen sehr
// unterschiedlich gut, und man merkt am Tisch sofort, wer ein Auge dafür hat.
//
// Die Spannen wachsen von Durchgang zu Durchgang. Bei acht bis zwanzig zählt
// man notfalls noch mit; bei fünfundvierzig bis fünfundneunzig geht das in
// anderthalb Sekunden nicht mehr, und genau dort trennt sich das Feld.
const ESTIMATE_BANDS = [[8, 20], [16, 36], [28, 58], [45, 95]];
const ESTIMATE_POINTS = 200;           // volle Punkte für einen genauen Treffer
const ESTIMATE_BULLSEYE = 60;          // Zugabe, wenn die Zahl exakt stimmt
// Wie schnell die Punkte mit dem Fehler fallen, gemessen an der Breite der
// Spanne. Bei einem Drittel daneben ist nichts mehr zu holen — geraten in der
// Mitte bringt gerade noch ein Viertel der Punkte, und das soll es auch.
const ESTIMATE_FALLOFF = 3;

function estimateBand(round) {
  return ESTIMATE_BANDS[Math.min(ESTIMATE_BANDS.length - 1, Math.max(0, round))];
}

// Der Plan steht beim Start fest: Anzahl und Zeiten je Durchgang. Kein Zufall
// pro Tick — sonst sähen zwei Geräte verschiedene Schwärme.
function buildEstimateRounds(seed) {
  const rounds = [];
  let at = ESTIMATE_LEAD_IN_MS;
  for (let index = 0; index < ESTIMATE_ROUNDS; index += 1) {
    const [low, high] = estimateBand(index);
    const count = low + Math.floor(arcadeNoise(seed + index * 6151) * (high - low + 1));
    rounds.push({
      index,
      count: Math.min(high, count),
      low,
      high,
      showFrom: at,
      guessFrom: at + ESTIMATE_SHOW_MS,
      revealFrom: at + ESTIMATE_SHOW_MS + ESTIMATE_GUESS_MS,
      until: at + ESTIMATE_SHOW_MS + ESTIMATE_GUESS_MS + ESTIMATE_REVEAL_MS
    });
    at += ESTIMATE_SHOW_MS + ESTIMATE_GUESS_MS + ESTIMATE_REVEAL_MS;
  }
  return rounds;
}

function estimateRoundAt(arcade, elapsed) {
  return (arcade.rounds || []).find((round) => elapsed >= round.showFrom && elapsed < round.until) || null;
}

// Was eine Schätzung wert ist. Der Fehler zählt relativ zur Spanne, sonst wäre
// der letzte Durchgang (45 bis 95) fünfmal härter als der erste (8 bis 20) —
// dabei ist er ohnehin schon der schwerste.
function estimateValue(guess, round) {
  const spread = Math.max(1, round.high - round.low);
  const error = Math.abs(guess - round.count);
  const points = Math.max(0, Math.round(ESTIMATE_POINTS * (1 - (error / spread) * ESTIMATE_FALLOFF)));
  return { error, points: points + (error === 0 ? ESTIMATE_BULLSEYE : 0) };
}

// Aus der Spieler-Id eine eigene Zahl, damit nicht alle dasselbe Versteck haben.
function hashSeekSeed(playerId) {
  let hash = 0;
  for (let index = 0; index < playerId.length; index += 1) {
    hash = (hash * 31 + playerId.charCodeAt(index)) % 100003;
  }
  return hash;
}

// Das Versteck der Runde. Aus dem Startwert gerechnet und nicht gewürfelt: so
// liegt es fest, sobald die Runde beginnt, und ein verlorenes Paket kann es
// nicht verschieben.
function seekGemFor(seed, round) {
  const cell = Math.floor(arcadeNoise(seed + round * 7919) * SEEK_SIZE * SEEK_SIZE);
  const safe = Math.min(SEEK_SIZE * SEEK_SIZE - 1, Math.max(0, cell));
  return { x: safe % SEEK_SIZE, y: Math.floor(safe / SEEK_SIZE) };
}

// Schritte im Raster, nicht Luftlinie: hoch/runter/links/rechts.
function seekSteps(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

// Was ein Fund noch wert ist. Fällt mit jedem Tipp, aber nie unter den
// Mindestwert — sonst würde sich Aufgeben lohnen, sobald man einmal danebenlag.
function seekFindValue(probes) {
  return Math.max(SEEK_MIN_POINTS, SEEK_BASE_POINTS - probes * SEEK_PROBE_COST);
}

const STOPCLOCK_TARGETS = [5000, 6500, 7500];
const RUNNER_LENGTH = 150;
const RUNNER_BASE_SPEED = 5.8;
// Ein Stolperer muss das Rennen kosten können. Bei 1150 ms und 0.35-Tempo lag
// der Verlust bei rund 0.75 s auf 26 s Renndauer — knapp drei Prozent, zu wenig,
// als dass sich saubere Bahnwahl auszahlt.
const RUNNER_STUMBLE_MS = 1500;
const RUNNER_BOOST_MS = 1300;
const COLORGRID_SIZE = 6;
const COLORGRID_ROUNDS = 6;
const COLORGRID_ROUND_MS = 7000;
const COLORGRID_ANNOUNCE_MS = 2300;
const COLORGRID_DROP_END_MS = 4800;
// Vorlauf, bevor der Boden zum ersten Mal fällt. Vorher 3000 ms — zusammen mit
// 2600 ms Vorwarnung standen am Anfang 5,6 Sekunden zur Verfügung, um auf eines
// von zehn sicheren Feldern zu treten. Die erste Farbe konnte niemanden
// erwischen und fühlte sich folgerichtig an, als passiere nichts.
const COLORGRID_LEAD_MS = 1400;
// Die Runden ziehen an. Vorher war jede Runde gleich lang und gleich leicht: bei
// 2,6 s Vorwarnung und im Schnitt neun sicheren Feldern war das nächste Ziel
// meist einen Schritt entfernt, und gemessen überlebten ALLE drei Bot-Stufen
// gleich viele Runden. Ohne Steigerung entscheidet nur das Pech.
const COLORGRID_ANNOUNCE_MIN_MS = 1300;
const COLORGRID_ANNOUNCE_STEP_MS = 200;   // je Runde weniger Vorwarnung, aber sanft
const COLORGRID_DROP_MS = 2200;           // Fallphase, unabhängig von der Vorwarnung
const COLORGRID_SAFE_START = 8;           // sichere Felder in Runde 1
const COLORGRID_SAFE_MIN = 4;

// Lichtwächter — red light, green light: hold to run, freeze on red.
const REDLIGHT_GOAL = 30;             // metres to the guard's gate
const REDLIGHT_SPEED = 4.6;           // run speed while holding on green
const REDLIGHT_PENALTY = 7;           // metres lost when caught moving on red
const REDLIGHT_GRACE_MS = 300;        // reaction grace after the light flips red
const REDLIGHT_HOLD_FRESH_MS = 220;   // "holding" = a run ping this recent

// Seilspringen — jump the swinging rope; mistime one and you trip out.
const WAVE_JUMP_MS = 650;             // airtime of a jump
const WAVE_FIRST_AT = 3200;           // first pass after the start
const WAVE_MIN_GAP = 1150;            // passes accelerate down to this gap

// Fassrolle — everyone balances on one giant rolling barrel; run against the
// spin or slide off. Last Kin on the barrel wins.
// Fassrolle: das Fass dreht sich in Schueben, man laeuft dagegen an.
//
// Das Gegenlaufen hatte eine feste Zugabe auf die Fassgeschwindigkeit — wer in
// die richtige Richtung hielt, konnte damit gar nicht herunterfallen, und
// gemessen ueberlebten 115 von 120 Bots die volle Runde. Ein Spiel, in dem
// niemand ausscheidet, hat keinen Einsatz. Jetzt ist die Laufgeschwindigkeit
// FEST: in ruhigen Schueben rennt man muehelos zurueck, in schnellen haelt man
// sich gerade eben, und wer eine Richtungsaenderung verschlaeft, ist weg.
const BARREL_LIMIT = 1.7;             // slide distance before falling off
const BARREL_RUN_SPEED = 2.1;         // counter-run speed while holding
const BARREL_HOLD_FRESH_MS = 220;     // "holding" = a run ping this recent

// Zündstoff — hot-potato bomb: the fuse time is shown for the first moments,
// then hidden, so a good passer can time the boom.
const BOMB_PASS_LOCK_MS = 380;        // minimum hold time before passing on
const BOMB_MIN_FUSE_MS = 4000;
const BOMB_MAX_FUSE_MS = 8000;
const BOMB_REVEAL_MS = 2000;          // fuse time is visible this long after a pass

// Münzregen — coins, gems and bombs rain into three lanes; switch to catch.
const CATCH_FALL_MS = 1150;           // visual fall time from sky to lane

// Messerwurf — throw a knife into the spinning log without hitting another.
const KNIFE_MIN_GAP_DEG = 22;         // knives closer than this collide
// Mehrere Runden statt eines einzigen Wurfs. Mit einem Wurf pro Person lagen bei
// vier Mitspielenden vier Messer auf einer Scheibe, auf die rund 16 passen — ein
// Zusammenstoss war praktisch unmöglich und die Partie endete gemessen IMMER
// unentschieden. Über vier Runden füllt sich die Scheibe bis an ihre Grenze, und
// genau dann fängt das Spiel an, eines zu sein.
// So viele Runden, dass die Scheibe wirklich eng wird. Das Ende kommt in der
// Praxis früher: entweder ist nur noch eine Person übrig, oder die Minute ist um
// (duration). Ein festes kleines Rundenlimit liess das Spiel vorher aufhören,
// obwohl noch alle standen.
// Wie viele Messer die Scheibe ÜBERHAUPT fassen kann, bevor jeder weitere Wurf
// zwangsläufig kollidiert: bei 360 Grad und 22 Grad Mindestabstand sind das
// rechnerisch 16, in der Praxis eher zwölf, weil sie nie gleichmässig liegen.
//
// Mit acht festen Runden landeten bei drei Personen 24 Messer auf der Scheibe
// und bei vier sogar 32. Das Spiel war also mathematisch nicht zu überleben —
// gemessen flogen in jeder einzelnen Partie ALLE raus, und gewonnen hatte, wer
// zufällig zuletzt ausschied. Die Rundenzahl richtet sich deshalb nach der
// Tischgrösse.
const KNIFE_DISC_CAPACITY = 13;
function knifeRoundsFor(playerCount) {
  return clamp(Math.round(KNIFE_DISC_CAPACITY / Math.max(1, playerCount)), 3, 7);
}
// Ein Treffer auf ein anderes Messer kostet den Wurf und die Runde, aber nicht
// gleich die ganze Partie: mit sofortigem Aus schieden gemessen 9 von 10
// schwächeren Mitspielenden nach dem ersten oder zweiten Wurf aus und sahen den
// Rest nur noch zu. Das zweite Mal ist das Aus.
const KNIFE_LIVES = 2;
// Die Scheibe dreht immer schneller. Das ist nicht nur Dramaturgie: ein
// Zeitfehler ist hier direkt ein Winkelfehler, und nur wenn die Scheibe schnell
// genug wird, entscheidet das Timing überhaupt etwas. Bei 2.4 rad/s lagen selbst
// 150 ms Wackeln noch unter der Kollisionsschwelle — gemessen war zwischen
// "normal" und "hard" kein Unterschied mehr.
// 3.4 rad/s sind 195 Grad/s: 100 ms menschliches Zittern ergeben 19.5 Grad und
// bleiben damit knapp unter den 22 Grad Mindestabstand. Eng, aber machbar.
const KNIFE_SPIN_START = 1.1;
const KNIFE_SPIN_STEP = 0.22;
const KNIFE_SPIN_MAX = 3.4;
const KNIFE_TURN_START_MS = 3000;     // Wurffenster in der ersten Runde
const KNIFE_TURN_MIN_MS = 1500;
const KNIFE_TURN_STEP = 0.84;         // je Runde wird es enger

// Turmbau — drop the sliding block onto your tower; misalignment trims it.
// Kein festes Ziel mehr: gebaut wird, so hoch man kommt, bis die Zeit um ist
// oder der Turm einstürzt. Vorher war bei 14 Etagen Schluss, und ein starker
// Bot stand die letzten Sekunden nur herum. Die Zahl bleibt als Sicherheitsnetz
// gegen einen Turm, der ins Unendliche wächst.
const STACK_BLOCKS = 99;
// Blickabstand des Bots. Muss zum schnellen Bot-Takt (120–180 ms) passen: der
// Bot vergleicht damit den vorigen und den nächsten Blick, um den dichtesten
// Moment zu erkennen. Zu gross, und er hält einen Ausschlag für eine Annäherung.
const STACK_BOT_LOOKAHEAD_MS = 150;
// Ein Bot handelt nur, wenn sein Takt gerade läuft — er kommt also IMMER etwas
// zu spät, im Schnitt eine halbe Taktlänge. Bei reinen Zeitspielen war dieser
// einseitige Verzug grösser als der Unterschied zwischen den Könnensstufen (der
// starke Bot streut nur ±160 ms) und überdeckte ihn vollständig. Wie ein Mensch
// die eigene Reaktionszeit einrechnet, zielt der Bot deshalb etwas früher.
const BOT_TICK_LEAD_MS = 75;

// Bergsteiger — alternate left/right taps to climb; wrong side slips you.
// Auch hier kein Gipfel mehr, an dem alles endet: geklettert wird auf Zeit, und
// gewertet wird, wie weit man kommt. Bleibt als Obergrenze stehen, damit die
// Wand nicht endlos gebaut werden muss.
const CLIMB_HEIGHT = 400;

// Blob-Klopfe — whack the blobs that pop out of the 3x3 holes.
const WHACK_CELLS = 9;

// Kanonenflug — tap once for power, once for the launch angle (45° is best).
const CANNON_PERIOD_MS = 1300;        // full swing of the power gauge
const CANNON_ANGLE_PERIOD_MS = 1500;  // full sweep of the angle gauge (5°-85°)

// Blitzfang — wait for green, tap first; a false start costs dearly.
// Tiefenrausch — tiefer graben bringt mehr, aber jeder Stollen kann einstürzen.
// Der einzige Archetyp, der der Sammlung noch fehlte: eine Entscheidung, die
// nur aus Gier und Nerven besteht. Alle anderen Spiele fragen nach Hand oder
// Auge, dieses nach dem Mut, rechtzeitig aufzuhören.
//
// Die Zahlen sind gerechnet, nicht geraten. Beute bis Tiefe n ist
// 10n + 3n(n+1), der Gewinn der nächsten Stufe 10 + 6(n+1), und das Risiko
// 0.06 + 0.055n. Damit liegt der Erwartungswert bei Tiefe 4 zuletzt positiv
// (+6) und bei 5 klar negativ (−7): es GIBT eine richtige Antwort, sie ist
// lernbar, und sie liegt nicht am Rand.
const DIVE_STEP_MS = 620;              // eine Stufe tiefer
const DIVE_SURFACE_MS = 1300;          // Auftauchen samt Einzahlen
const DIVE_STUN_MS = 1500;             // nach einem Einsturz
const DIVE_BASE_GAIN = 10;             // Grundwert einer Stufe
const DIVE_STEP_GAIN = 6;              // Zuschlag je Tiefe
const DIVE_RISK_BASE = 0.06;
const DIVE_RISK_STEP = 0.055;
const DIVE_RISK_MAX = 0.62;
const DIVE_MAX_DEPTH = 12;             // Sicherheitsnetz gegen endlose Schächte

const SIMON_ROUNDS = 5;
const REACT_ROUNDS = 3;
const REACT_WINDOW_MS = 2200;
const REACT_PENALTY_MS = 900;

const PLINKO_SLOTS = [1, 4, 7, 12, 7, 4, 1];
const PLINKO_GRAVITY = 1.35;
// Ein Stups je Kugel. Ohne ihn war Nagelbrett reines Glück: man tippte eine
// Startposition an und schaute zu. Gemessen lagen alle drei Bot-Stufen gleich
// auf (und der schwache sogar vorne), weil das Abprallen jede Absicht
// überdeckte. Der Stups macht daraus ein Spiel: die Kugel läuft schief, man
// sieht es kommen, und man hat GENAU einen Eingriff.
const PLINKO_NUDGE = 0.85;            // seitlicher Schub beim Stups
const PLINKO_FLOOR_Y = 1.3;
const CURLING_SHEET_Y = 1.3;
const CURLING_RINGS = [
  { radius: 0.075, points: 15 },
  { radius: 0.15, points: 8 },
  { radius: 0.24, points: 4 }
];
const CURLING_STONES_PER_PLAYER = 3;
const CURLING_STONE_RADIUS = 0.045;   // stone radius in the logical sheet
const CURLING_FRICTION = 1.15;        // ice glide damping -> stones coast, then settle
const CURLING_WALL_REST = 0.55;       // side-cushion bounce ("Rempler erlaubt")
const CURLING_RESTITUTION = 0.92;     // stone-on-stone bounce
const CURLING_SUBSTEPS = 5;           // sub-stepped so fast stones never tunnel through

// Bumper Bloom — a sumo bumper arena on a round plate.
// Physics live in a unit disk (radius 1). One analog gesture: steer with the
// stick, ramming is pure momentum. The rim ALWAYS bounces you back — unless a
// bumper hit was hard enough to "launch" you (a short window), so you can never
// drive yourself off but a solid ram sends a rival flying over the edge.
// Falling is a timed respawn, never elimination, so every player is in for the
// whole round and the score is survival time + knockouts.
const ARENA_RADIUS = 1.0;             // plate disk radius (logical units)
const ARENA_BALL_RADIUS = 0.15;       // kin collision radius
const ARENA_ACCEL = 3.8;              // stick thrust acceleration (snappy, responsive)
const ARENA_DRAG = 1.75;              // velocity damping (quick stops, still carries momentum)
const ARENA_RESTITUTION = 1.4;        // >1: bouncy bumpers, so rams carry punch
const ARENA_RIM_RESTITUTION = 0.62;   // bounce back onto the plate when not launched
const ARENA_LAUNCH_IMPULSE = 0.95;    // min hit strength (normal Δv) that launches a rival
const ARENA_LAUNCH_MS = 1150;         // launched window during which the rim lets you fly off
const ARENA_SUBSTEPS = 4;             // sub-stepped integration prevents tunneling
const ARENA_RESPAWN_MS = 2200;        // time out of play after a knock-off
const ARENA_INVULN_MS = 1300;         // spawn grace: no collisions, can't be launched
const ARENA_SURVIVE_RATE = 10;        // score per second in play
const ARENA_KNOCKOUT_BONUS = 60;      // score for launching a rival
const ARENA_CREDIT_MS = 1600;         // a hit only credits a knock-off this recent

const FLUX_SIZE = 9;
const FLUX_MOVE_COOLDOWN = 92;
const FLUX_BURST_COOLDOWN = 2900;
const FLUX_BLOCKED = [[0, 0], [8, 0], [0, 8], [8, 8], [4, 4]];

const rooms = new Map();

// --- Abuse limits ----------------------------------------------------------
// Harmless on a home WLAN, but a hosted server must not let one client fill
// memory with empty rooms. Measured before adding this: 60 connections created
// 60 rooms with nothing refused.
const MAX_ROOMS_TOTAL = 400;
// Deliberately generous: mobile carriers, schools and offices put many players
// behind ONE egress address, and a reverse proxy can make every client look
// identical. A tight per-address cap would lock out legitimate players — the
// short burst cooldown below is what actually stops flooding.
const MAX_ROOMS_PER_ADDRESS = 30;
const ROOM_CREATE_COOLDOWN_MS = 1500;
const lastRoomCreateAt = new Map();   // address -> timestamp

function clientAddress(socket) {
  // Behind a reverse proxy the socket address is the proxy; the forwarded
  // header carries the real client. Take the left-most entry, which is the
  // originating client.
  const forwarded = socket.handshake?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return socket.handshake?.address || socket.id;
}

// Counts only rooms that still have a connected player. A room whose players
// all dropped is waiting for its cleanup timer (so a reconnect can rejoin) and
// must not be held against whoever opened it — otherwise a player who plays
// several short matches gets locked out of their own game.
function roomsForAddress(address) {
  let count = 0;
  rooms.forEach((room) => {
    if (room.createdBy !== address) return;
    if (room.players.some((player) => player.connected !== false)) count += 1;
  });
  return count;
}

// Returns null when creating a room is allowed, otherwise a player-facing reason.
function roomCreateBlockedReason(socket) {
  if (rooms.size >= MAX_ROOMS_TOTAL) {
    return "Der Server ist voll. Bitte später erneut versuchen.";
  }
  const address = clientAddress(socket);
  const last = lastRoomCreateAt.get(address) || 0;
  if (Date.now() - last < ROOM_CREATE_COOLDOWN_MS) {
    return "Kurz warten, bevor du den nächsten Raum öffnest.";
  }
  if (roomsForAddress(address) >= MAX_ROOMS_PER_ADDRESS) {
    return "Zu viele offene Räume von diesem Gerät.";
  }
  return null;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "../client")));
app.use("/vendor/three", express.static(path.join(__dirname, "../node_modules/three/build")));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get("/config", (_req, res) => {
  res.json({
    lanUrls: getLocalAddresses().map((address) => `http://${address}:${PORT}`),
    version: APP_VERSION,
    devTools: DEV_TOOLS_ENABLED
  });
});
app.get("/qr.svg", async (req, res) => {
  const text = String(req.query.text || "").slice(0, 500);
  if (!text) {
    res.status(400).send("Missing text");
    return;
  }
  try {
    const svg = await QRCode.toString(text, {
      type: "svg",
      margin: 1,
      width: 168,
      color: {
        dark: "#282631",
        light: "#ffffff"
      }
    });
    res.type("image/svg+xml").send(svg);
  } catch (_error) {
    res.status(500).send("QR generation failed");
  }
});

io.on("connection", (socket) => {
  // Jeder Handler bekommt eine Sicherung. Wirft einer, bevor er geantwortet
  // hat, wartet der Client sonst ewig auf seinen Rückruf: der Knopf im Spiel
  // reagiert einfach nicht mehr, ohne Fehlermeldung, ohne Hinweis. Ein
  // abgelehntes Paket ist in Ordnung, ein stummes nicht.
  const on = (event, handler) => {
    socket.on(event, (payload, reply) => {
      try {
        handler(payload, reply);
      } catch (error) {
        console.error(`[tumblekin] ${event} ist gescheitert:`, error);
        replyError(reply, "Das hat der Server nicht verstanden.");
      }
    });
  };

  on("createRoom", (payload, reply) => {
    const blocked = roomCreateBlockedReason(socket);
    if (blocked) return replyError(reply, blocked);
    leaveCurrentRoom(socket, false, true);

    const code = makeRoomCode();
    const player = createPlayer({
      id: socket.id,
      name: payload?.name,
      color: COLORS[0],
      isHost: true,
      controllerId: socket.id
    });
    const room = {
      code,
      hostId: player.id,
      boardId: BOARD_DEFINITIONS[0].id,
      mode: "board",
      arcadePlan: [],
      arcadeRoundIndex: 0,
      singleType: null,
      status: "lobby",
      phase: "lobby",
      players: [player],
      round: 1,
      maxRounds: MAX_ROUNDS,
      starIndex: null,
      starsSold: 0,
      pendingJunction: null,
      bonusStars: [],
      currentTurnIndex: 0,
      minigameCounter: 0,
      devMode: false,
      currentMinigame: null,
      lastMinigameResult: null,
      resultEndsAt: null,
      readyForNext: [],
      lastMessage: "Raum erstellt.",
      lastMove: null,
      winnerIds: [],
      timers: new Set(),
      botTurnTimer: null,
      minigameTick: null,
      skipTurnTimer: null,
      cleanupTimer: null
    };

    room.createdBy = clientAddress(socket);
    lastRoomCreateAt.set(room.createdBy, Date.now());
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    replyOk(reply, room, player.id);
    emitRoom(room);
  });

  on("joinRoom", (payload, reply) => {
    leaveCurrentRoom(socket, false, true);

    const code = normalizeCode(payload?.code);
    const room = rooms.get(code);
    if (!room) return replyError(reply, "Diesen Raum gibt es nicht.");
    if (room.status !== "lobby") return replyError(reply, "Das Spiel läuft bereits.");
    if (room.players.length >= MAX_PLAYERS) return replyError(reply, "Der Raum ist voll.");

    const player = createPlayer({
      id: socket.id,
      name: payload?.name,
      color: COLORS[room.players.length % COLORS.length],
      isHost: false,
      controllerId: socket.id
    });

    room.players.push(player);
    room.lastMessage = `${player.name} ist beigetreten.`;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;

    replyOk(reply, room, player.id);
    emitRoom(room);
  });

  on("resumeRoom", (payload, reply) => {
    const code = normalizeCode(payload?.code);
    const room = rooms.get(code);
    if (!room) return replyError(reply, "Die vorherige Sitzung existiert nicht mehr.");
    const player = room.players.find((candidate) => candidate.id === payload?.playerId);
    if (!player) return replyError(reply, "Der Spieler gehört nicht mehr zu diesem Raum.");
    const controllerStillConnected = player.controllerId && io.sockets.sockets.has(player.controllerId);
    if (player.connected && controllerStillConnected && player.controllerId !== socket.id) {
      return replyError(reply, "Dieser Spieler ist bereits auf einem anderen Gerät verbunden.");
    }

    leaveCurrentRoom(socket, false, true);
    const controlledPlayers = room.devMode && player.id === room.hostId
      ? room.players.filter((candidate) => candidate.isLocalDev)
      : [player];
    controlledPlayers.forEach((candidate) => {
      candidate.controllerId = socket.id;
      candidate.connected = true;
    });

    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    room.lastMessage = `${player.name} ist wieder verbunden.`;
    replyOk(reply, room, player.id);
    emitRoom(room);
  });

  on("leaveRoom", (_payload, reply) => {
    leaveCurrentRoom(socket, true, true);
    reply?.({ ok: true });
  });

  on("addTestPlayers", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann Bots hinzufügen.");
    if (room.status !== "lobby") return replyError(reply, "Bots können nur in der Lobby hinzugefügt werden.");

    const sampleNames = ["Nova", "Pix", "Sol", "Mo"];
    while (room.players.length < MAX_PLAYERS) {
      const index = room.players.length;
      room.players.push(createPlayer({
        id: `bot_${room.code}_${index}_${Date.now()}`,
        name: sampleNames[index] || `Bot ${index + 1}`,
        color: COLORS[index % COLORS.length],
        isHost: false,
        isBot: true,
        controllerId: null
      }));
    }

    room.lastMessage = "Bots sind der Runde beigetreten.";
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("enableDevMode", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!DEV_TOOLS_ENABLED) return replyError(reply, "Dev-Testmodus ist in dieser Version deaktiviert.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann den Dev-Testmodus starten.");
    if (room.status !== "lobby") return replyError(reply, "Dev-Testmodus geht nur in der Lobby.");
    if (room.players.some((player) => player.id !== room.hostId && !player.isBot)) {
      return replyError(reply, "Dev-Testmodus geht nur, wenn du allein im Raum bist.");
    }

    const host = room.players.find((player) => player.id === room.hostId);
    room.players = [];
    const names = [host?.name || "Du", "Dev 2", "Dev 3", "Dev 4"];
    for (let index = 0; index < MAX_PLAYERS; index += 1) {
      room.players.push(createPlayer({
        id: index === 0 ? socket.data.playerId : `local_${room.code}_${index}_${Date.now()}`,
        name: names[index],
        color: COLORS[index % COLORS.length],
        isHost: index === 0,
        isBot: false,
        isLocalDev: true,
        controllerId: socket.id
      }));
    }

    room.devMode = true;
    room.lastMessage = "Dev-Testmodus aktiv: 4 lokale Spieler auf diesem Gerät.";
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("selectBoard", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host wählt das Brett.");
    if (room.status !== "lobby") return replyError(reply, "Das Brett kann nur in der Lobby gewechselt werden.");
    const board = BOARD_DEFINITIONS.find((candidate) => candidate.id === payload?.boardId);
    if (!board) return replyError(reply, "Dieses Brett existiert nicht.");
    room.boardId = board.id;
    room.lastMessage = `${board.name} wurde gewählt.`;
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("selectMode", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host wählt den Modus.");
    if (room.status !== "lobby") return replyError(reply, "Der Modus kann nur in der Lobby gewechselt werden.");
    const mode = payload?.mode === "arcade" ? "arcade" : (payload?.mode === "single" ? "single" : "board");
    room.mode = mode;
    room.lastMessage = mode === "arcade"
      ? "Minispiel-Marathon gewählt: 5 Runden, die meisten Siege gewinnen."
      : mode === "single"
        ? "Einzelspiel gewählt: Sucht euch ein Minispiel aus."
        : "Brettspiel-Modus gewählt.";
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("selectSingleGame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host wählt das Minispiel.");
    if (room.status !== "lobby") return replyError(reply, "Das Minispiel kann nur in der Lobby gewechselt werden.");
    const template = MINIGAMES.find((candidate) => candidate.type === payload?.type);
    if (!template) return replyError(reply, "Dieses Minispiel existiert nicht.");
    room.singleType = template.type;
    room.lastMessage = `${template.title} ausgewählt.`;
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("startGame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann starten.");
    if (!room.devMode && room.players.length < 2) {
      return replyError(reply, "Es braucht mindestens zwei Spieler. Lade jemanden ein oder fülle mit Bots auf.");
    }

    startGame(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("startDevMinigame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!DEV_TOOLS_ENABLED) return replyError(reply, "Dev-Challenge ist in dieser Version deaktiviert.");
    if (!isHost(socket, room) || !room.devMode) return replyError(reply, "Diese Aktion gehört zum lokalen Dev-Testmodus.");
    if (room.status !== "board" || room.phase !== "waitingRoll") {
      return replyError(reply, "Die nächste Challenge kann erst auf dem ruhenden Board starten.");
    }
    startMinigame(room, "Dev-Challenge", "returnBoard", payload?.type);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });


  on("rollDice", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    const current = getCurrentPlayer(room);
    if (!current) return replyError(reply, "Kein aktueller Spieler.");
    if (payload?.playerId && payload.playerId !== current.id) {
      return replyError(reply, `${current.name} ist am Zug. Wähle diesen Spieler im Dev-Controller.`);
    }
    if (!canControl(socket, current)) return replyError(reply, "Du bist gerade nicht am Zug.");

    const result = performRoll(room, current);
    if (!result.ok) return replyError(reply, result.error || "Würfeln ist gerade nicht möglich.");
    reply?.({ ok: true, dice: result.dice });
  });

  on("chooseRoute", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    const pending = room.pendingJunction;
    if (!pending) return replyError(reply, "Gerade steht keine Wegwahl an.");
    const player = room.players.find((candidate) => candidate.id === pending.playerId);
    if (!player) return replyError(reply, "Spieler nicht gefunden.");
    if (!canControl(socket, player)) return replyError(reply, "Diese Wahl gehört jemand anderem.");

    const result = chooseJunctionRoute(room, player, payload?.route);
    if (!result.ok) return replyError(reply, result.error || "Diese Wahl geht gerade nicht.");
    reply?.({ ok: true });
  });

  on("minigameInput", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    const player = room.players.find((candidate) => candidate.id === payload?.playerId)
      || room.players.find((candidate) => candidate.id === socket.data.playerId);
    if (!player) return replyError(reply, "Spieler nicht gefunden.");
    if (!canControl(socket, player)) return replyError(reply, "Du steuerst diesen Spieler nicht.");
    if (player.connected === false) return replyError(reply, "Dieser Spieler ist offline.");

    const result = handleMinigameInput(room, player, payload?.input || {});
    if (!result.ok) return replyError(reply, result.error || "Input wurde nicht angenommen.");
    reply?.({ ok: true });
  });

  on("useItem", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    const player = room.players.find((candidate) => candidate.id === payload?.playerId)
      || room.players.find((candidate) => candidate.id === socket.data.playerId);
    if (!player) return replyError(reply, "Spieler nicht gefunden.");
    if (!canControl(socket, player)) return replyError(reply, "Du steuerst diesen Spieler nicht.");
    // Items are a pre-roll decision: only on your own turn, before you move.
    if (room.status !== "board" || room.phase !== "waitingRoll") {
      return replyError(reply, "Items gehen nur vor dem Würfeln.");
    }
    if (getCurrentPlayer(room)?.id !== player.id) {
      return replyError(reply, "Du bist nicht am Zug.");
    }
    if (player.pendingItem) return replyError(reply, "Ein Würfel-Item ist schon aktiv.");

    const result = consumeItem(room, player, String(payload?.itemId || ""));
    if (!result.ok) return replyError(reply, result.error || "Item konnte nicht benutzt werden.");

    room.lastMessage = result.message;
    io.to(room.code).emit("itemUsed", {
      playerId: player.id,
      name: player.name,
      item: result.item,
      targetId: result.targetId || null,
      blockedBy: result.blockedBy || null,
      message: result.message
    });
    emitRoom(room);
    reply?.({ ok: true });
  });

  on("restartGame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann neu starten.");
    resetToLobby(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  // Weiter, wenn alle es eilig haben. Die Ergebnistafel steht 6.5 Sekunden, die
  // Auflösung selbst dauert bei vier Personen aber nur 2.5 — danach schaut die
  // Runde vier Sekunden lang auf ein Bild, in dem nichts mehr passiert. Wer
  // tippt, meldet sich bereit; sind alle bereit, geht es sofort weiter. Ein
  // einzelner Ungeduldiger kann damit niemanden überfahren.
  on("readyForNext", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (room.status !== "result") return replyError(reply, "Gerade läuft keine Ergebnistafel.");

    const controlled = room.players.filter((candidate) =>
      candidate.controllerId === socket.id || candidate.id === socket.data.playerId);
    if (controlled.length === 0) return replyError(reply, "Du gehörst nicht zu diesem Raum.");

    room.readyForNext = room.readyForNext || [];
    controlled.forEach((candidate) => {
      if (!candidate.isBot && !room.readyForNext.includes(candidate.id)) {
        room.readyForNext.push(candidate.id);
      }
    });

    const humans = humansInRoom(room);
    const allReady = humans.length > 0 && humans.every((candidate) => room.readyForNext.includes(candidate.id));
    reply?.({ ok: true, ready: room.readyForNext.length, needed: humans.length });
    emitRoom(room);
    if (allReady) continueAfterResult(room);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket, true, false);
  });
});

function createPlayer({ id, name, color, isHost = false, isBot = false, isLocalDev = false, controllerId = null }) {
  return {
    id,
    name: cleanName(name, isBot ? "Bot" : "Spieler"),
    color,
    isHost,
    isBot,
    isLocalDev,
    controllerId,
    connected: true,
    coins: STARTING_COINS,
    stars: 0,
    items: [],
    shielded: false,
    // Halves the next roll (Klebefalle). Kept separate from nextRollPenalty so
    // a flat penalty and a halving can never silently overwrite each other.
    nextRollHalved: false,
    pendingItem: null,
    wins: 0,
    position: 0,
    diceValue: null,
    nextRollBoost: 0,
    nextRollPenalty: 0,
    minigameScore: 0
  };
}

// Resets everything the board economy tracks. Used on game start and restart so
// a rematch never inherits stars, items or pending item effects.
function resetBoardProgress(player) {
  player.coins = STARTING_COINS;
  player.stars = 0;
  player.items = [];
  player.shielded = false;
  player.nextRollHalved = false;
  player.pendingItem = null;
  player.nextRollBoost = 0;
  player.nextRollPenalty = 0;
  player.position = 0;
  player.diceValue = null;
}

// How far ahead of the pack a freshly lit star pad may sit. A player rolls
// about 3.5 per turn, so this window is roughly "two to four turns away":
// close enough to race for, far enough that it is not free.
const STAR_REACH_MIN = 2;
const STAR_REACH_MAX = 14;

// The lit star pad. Two rules matter here, and both were learned from watching
// a full match play out:
//   1. It must MOVE after a sale, or the board has a static target.
//   2. It must be REACHABLE. Picking uniformly at random left the star sitting
//      on a pad the pack could never reach within the round limit, which made
//      the whole star economy dead weight for an entire game.
function moveStarPad(room, { avoid = null } = {}) {
  const board = getBoard(room.boardId);
  const pads = board.starPads || [];
  if (!pads.length) {
    room.starIndex = null;
    return null;
  }
  const size = board.fieldTypes.length;
  const candidates = pads.filter((pad) => pad !== avoid);
  const pool = candidates.length ? candidates : pads;

  // Measure from the player who is furthest back, so a trailing player always
  // has a shot at the star too.
  const positions = (room.players || []).map((player) => player.position || 0);
  const anchor = positions.length ? Math.min(...positions) : 0;
  const reachable = pool.filter((pad) => {
    const distance = (pad - anchor + size) % size;
    return distance >= STAR_REACH_MIN && distance <= STAR_REACH_MAX;
  });

  const finalPool = reachable.length ? reachable : pool;
  room.starIndex = finalPool[Math.floor(Math.random() * finalPool.length)];
  return room.starIndex;
}

function startGame(room) {
  clearRoomTimers(room);
  room.round = 1;
  room.currentTurnIndex = 0;
  room.lastMinigameResult = null;
  room.lastMove = null;
  room.winnerIds = [];
  room.resultEndsAt = null;
  room.players.forEach((player, index) => {
    player.isHost = player.id === room.hostId;
    resetBoardProgress(player);
    // Single mode keeps the lobby tally running across games.
    if (room.mode === "single") {
      player.coins = STARTING_COINS;
    } else {
      player.wins = 0;
    }
    player.minigameScore = 0;
    player.color = COLORS[index % COLORS.length];
  });

  if (room.mode === "arcade") {
    // Minigame marathon: a shuffled plan of rounds, most round wins take it.
    room.arcadePlan = buildArcadePlan(ARCADE_MARATHON_ROUNDS);
    room.arcadeRoundIndex = 0;
    startMinigame(room, `Runde 1 von ${room.arcadePlan.length}`, "nextArcadeRound", room.arcadePlan[0]);
    return;
  }

  if (room.mode === "single") {
    // One chosen minigame, then back to the lobby — wins keep adding up.
    const type = room.singleType || buildArcadePlan(1)[0];
    startMinigame(room, "Einzelspiel", "returnLobby", type);
    return;
  }

  room.status = "board";
  room.phase = "waitingRoll";
  room.bonusStars = [];
  // Light the first star pad — the board needs a visible target from turn one.
  moveStarPad(room);
  room.lastMessage = `${getBoard(room.boardId).name} erwacht. Der Stern leuchtet!`;
}

// A shuffled selection of distinct minigames for the marathon mode.
function buildArcadePlan(rounds) {
  const pool = MINIGAMES.map((game) => game.type);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(rounds, pool.length));
}

function resetToLobby(room) {
  clearRoomTimers(room);
  room.status = "lobby";
  room.phase = "lobby";
  room.round = 1;
  room.currentTurnIndex = 0;
  room.currentMinigame = null;
  room.lastMinigameResult = null;
  room.lastMove = null;
  room.winnerIds = [];
  room.resultEndsAt = null;
  room.lastMessage = "Zurück in der Lobby.";
  room.arcadePlan = [];
  room.arcadeRoundIndex = 0;
  room.players.forEach((player, index) => {
    resetBoardProgress(player);
    player.wins = 0;
    player.minigameScore = 0;
    player.color = COLORS[index % COLORS.length];
  });
}

function performRoll(room, player) {
  if (room.status !== "board" || room.phase !== "waitingRoll") {
    return { ok: false, error: "Das Board ist gerade beschäftigt." };
  }
  if (player.connected === false) {
    return { ok: false, error: "Dieser Spieler ist offline." };
  }
  if (getCurrentPlayer(room)?.id !== player.id) {
    return { ok: false, error: "Dieser Spieler ist nicht am Zug." };
  }

  room.phase = "moving";
  // Item effects resolve here so the roll itself stays the single source of
  // truth for how far a player moves.
  const pending = player.pendingItem;
  player.pendingItem = null;
  let baseDice;
  let diceNote = null;
  if (pending === "doubleDice") {
    baseDice = (1 + Math.floor(Math.random() * 6)) + (1 + Math.floor(Math.random() * 6));
    diceNote = "Doppelwürfel";
  } else if (pending === "goldDice") {
    // 6–8, nicht 7–9. Mit 7–9 war der Goldwürfel dem Doppelwürfel bei JEDER
    // Sternentfernung überlegen, die einer von beiden überhaupt schafft: höherer
    // Schnitt (8 statt 7), höherer Boden (7 statt 2) und selbst bei neun Feldern
    // noch die bessere Chance (33 % gegen 28 %). Eines von fünf Items war damit
    // Ausschuss.
    //
    // Bei 6–8 haben beide den Schnitt 7 und tauschen bei acht Feldern die
    // Rollen: bis sieben ist der Goldwürfel sicherer, ab acht ist der
    // Doppelwürfel die einzige Chance. Das ist eine echte Wahl.
    baseDice = GOLD_DICE_MIN + Math.floor(Math.random() * GOLD_DICE_SPAN);
    diceNote = "Goldwürfel";
  } else {
    baseDice = 1 + Math.floor(Math.random() * 6);
  }
  const boost = player.nextRollBoost || 0;
  const penalty = player.nextRollPenalty || 0;
  player.nextRollBoost = 0;
  player.nextRollPenalty = 0;
  let dice = clamp(baseDice + boost - penalty, 1, 12);
  if (player.nextRollHalved) {
    player.nextRollHalved = false;
    dice = Math.max(1, Math.floor(dice / 2));
    diceNote = diceNote ? `${diceNote}, halbiert` : "halbiert";
  }
  const board = getBoard(room.boardId);
  player.diceValue = dice;
  room.lastMessage = `${player.name} zieht ${dice} Felder.`;

  const timer = walkLeg(room, player, board, {
    from: player.position,
    steps: dice,
    route: 0,
    walked: [],
    diceNote,
    diceDelayMs: DICE_REVEAL_MS,
    headline: `${player.name} würfelt ${formatDiceRoll(baseDice, boost, penalty, dice)}${diceNote ? ` (${diceNote})` : ""}.`,
    dice
  });

  return { ok: true, dice, timer };
}

// Eine Etappe: laufen, bis die Schritte alle sind ODER eine Kreuzung kommt.
// Ein Zug kann so aus mehreren Etappen bestehen — deshalb trägt `walked` alle
// bisher gelaufenen Felder mit, denn Tore und der Sternplatz zählen über den
// GANZEN Zug, nicht je Etappe.
function walkLeg(room, player, board, leg) {
  const { path, pendingAt, remaining } = buildBoardPath(board, leg.from, leg.steps, leg.route);
  const to = path[path.length - 1];
  const walked = [...leg.walked, ...path];
  const movementDurationMs = Math.max(BOARD_STEP_MS, path.length * BOARD_STEP_MS);
  const move = {
    boardId: board.id,
    playerId: player.id,
    from: leg.from,
    to,
    path,
    dice: leg.dice,
    fieldType: board.fieldTypes[to],
    diceDelayMs: leg.diceDelayMs,
    stepDurationMs: BOARD_STEP_MS,
    movementDurationMs,
    durationMs: leg.diceDelayMs + movementDurationMs,
    diceNote: leg.diceNote,
    atJunction: pendingAt !== null,
    message: leg.headline
  };
  room.lastMove = move;
  io.to(room.code).emit("boardMove", move);
  emitRoom(room);

  return setTrackedTimeout(room, () => {
    if (room.status !== "board" || room.phase !== "moving") return;
    player.position = to;

    if (pendingAt !== null) {
      // Die Wahl gehört der Person, nicht dem Würfel: hier wird angehalten.
      const options = junctionOptions(board, pendingAt);
      room.phase = "junction";
      room.pendingJunction = {
        playerId: player.id, at: pendingAt, remaining, options,
        walked, dice: leg.dice, diceNote: leg.diceNote
      };
      room.lastMessage = `${player.name} steht an der Kreuzung — welcher Weg?`;
      io.to(room.code).emit("boardJunction", { ...room.pendingJunction, playerName: player.name });
      emitRoom(room);
      if (player.isBot) {
        setTrackedTimeout(room, () => chooseJunctionRoute(room, player, botJunctionChoice(room, player, board)), 900);
      }
      return;
    }

    finishMove(room, player, board, move, walked);
  }, move.durationMs);
}

// Ankommen: Tore, Stern im Vorbeigehen, Feldwirkung — alles über den ganzen Zug.
function finishMove(room, player, board, move, walked) {
  const fieldType = board.fieldTypes[move.to];
  const gateEffects = resolveGateRewards(player, walked, board);
  const starPass = resolveStarPurchase(player, walked, room);
  const fieldEffect = applyFieldEffect(player, fieldType, room);
  const messages = [
    ...gateEffects.map((effect) => effect.message),
    starPass?.message,
    fieldEffect.message
  ].filter(Boolean);
  const landing = { ...move, path: walked, fieldEffect, gateEffects, starPass, message: messages.join(" ") };
  room.lastMove = landing;
  room.phase = "fieldResult";
  room.lastMessage = landing.message;
  io.to(room.code).emit("boardLanded", landing);
  emitRoom(room);
  setTrackedTimeout(room, () => {
    if (room.status !== "board" || room.phase !== "fieldResult") return;
    if (fieldType === "challenge") {
      startMinigame(room, "Challenge-Feld", "advanceTurn");
      emitRoom(room);
      return;
    }
    advanceTurn(room);
  }, 950);
}

// Die getroffene Wahl ausführen und die restlichen Schritte gehen.
function chooseJunctionRoute(room, player, route) {
  const pending = room.pendingJunction;
  if (!pending || room.phase !== "junction") return { ok: false, error: "Gerade steht keine Wegwahl an." };
  if (pending.playerId !== player.id) return { ok: false, error: "Diese Wahl gehört jemand anderem." };
  const board = getBoard(room.boardId);
  const picked = clamp(Math.round(Number(route) || 0), 0, (pending.options.length || 1) - 1);
  const choice = pending.options[picked];
  room.pendingJunction = null;
  room.phase = "moving";
  room.lastMessage = `${player.name} nimmt ${choice.label}.`;
  io.to(room.code).emit("boardRouteChosen", { playerId: player.id, ...choice });
  walkLeg(room, player, board, {
    from: pending.at,
    steps: pending.remaining,
    route: picked,
    walked: pending.walked,
    diceNote: pending.diceNote,
    // Der Würfel wurde schon gezeigt; die zweite Etappe läuft ohne neue Pause an.
    diceDelayMs: 0,
    headline: `${player.name} nimmt ${choice.label}.`,
    dice: pending.dice
  });
  return { ok: true };
}

// Bots entscheiden nach dem, was zählt: Wer den Stern bezahlen kann, nimmt den
// kürzeren Weg dorthin. Wer ihn nicht bezahlen kann, meidet die Fallen und
// sammelt lieber auf dem Ring.
function botJunctionChoice(room, player, board) {
  const options = room.pendingJunction?.options || [];
  if (options.length < 2) return 0;
  const lit = room.starIndex;
  const size = board.fieldTypes.length;
  const canAffordStar = player.coins >= starPrice(room);
  let best = 0;
  let bestValue = -Infinity;
  options.forEach((option, index) => {
    const traps = option.fields.filter((type) => type === "trap").length;
    const coins = option.fields.filter((type) => type === "coin").length;
    // Näher am Stern zu sein ist nur etwas wert, wenn man ihn auch zahlen kann.
    const distance = lit === null || lit === undefined
      ? 0
      : (lit - option.next + size) % size;
    const value = (canAffordStar ? option.saves * 2.2 - distance * 0.12 : 0)
      + coins * 1.1 - traps * (canAffordStar ? 0.7 : 1.6);
    if (value > bestValue) { bestValue = value; best = index; }
  });
  return best;
}

// One simple loop forward — no shortcut branches.
// Läuft `steps` Felder weiter und HÄLT AN, sobald das Feld unter dem Kin mehr
// als einen Weg anbietet und noch Schritte übrig sind. Vorher nahm die Funktion
// stumm `routes[cursor][0]` — mit dem Ring von damals war das dasselbe, mit
// Abzweigungen wäre die zweite Route für immer unerreichbar geblieben.
//
// `pendingAt` ist die Kreuzung, `remaining` die Schritte, die nach der Wahl noch
// zu gehen sind. Ohne Kreuzung ist beides null und das Ergebnis genau wie früher.
function buildBoardPath(board, from, steps, preferredRoute = 0) {
  const path = [];
  let cursor = from;
  let route = preferredRoute;
  for (let step = 1; step <= steps; step += 1) {
    const options = board.routes[cursor];
    const next = options?.[Math.min(route, (options.length || 1) - 1)]
      ?? (cursor + 1) % board.fieldTypes.length;
    route = 0;                                  // die Vorwahl gilt nur für den ersten Schritt
    path.push(next);
    cursor = next;
    const ahead = board.routes[cursor];
    if (ahead && ahead.length > 1 && step < steps) {
      return { path, pendingAt: cursor, remaining: steps - step };
    }
  }
  return { path, pendingAt: null, remaining: 0 };
}

// Die Kreuzung als Angebot: was liegt auf jedem Weg, und was spart er?
function junctionOptions(board, fieldIndex) {
  const options = board.routes[fieldIndex] || [];
  return options.map((next, routeIndex) => {
    const branch = board.branches?.find((entry) => entry.from === fieldIndex && entry.fields[0] === next);
    // Auch für den Hauptweg zeigen, was kommt — sonst stünden dort Platzhalter,
    // und die Wahl wäre einseitig belegt: nur eine Seite verriete ihren Inhalt.
    const preview = [];
    if (branch) {
      branch.fields.forEach((index) => preview.push(board.fieldTypes[index]));
    } else {
      let cursor = next;
      for (let step = 0; step < 3; step += 1) {
        preview.push(board.fieldTypes[cursor]);
        cursor = board.routes[cursor]?.[0] ?? cursor;
      }
    }
    return {
      route: routeIndex,
      next,
      label: branch ? branch.label : "Hauptweg",
      hint: branch ? branch.hint : "ruhig, aber der lange Bogen",
      saves: branch ? branch.saves : 0,
      fields: preview
    };
  });
}

// Buying the star by LANDING exactly on the lit pad turned out to be nearly
// unreachable: five rolls per player cover ~17 of 32 fields, so a whole match
// could pass without a single star changing hands. Passing over the lit pad
// buys it too, which makes the star a real target and gives the dice-boosting
// items an obvious purpose.
function resolveStarPurchase(player, pathSteps, room) {
  if (!room) return null;
  const lit = room.starIndex;
  if (lit === null || lit === undefined) return null;
  // The landing field is handled by applyFieldEffect, so only look at the
  // fields genuinely passed through.
  const passed = pathSteps.slice(0, -1);
  if (!passed.includes(lit)) return null;
  const price = starPrice(room);
  if (player.coins < price) {
    return {
      type: "starPass",
      fieldIndex: lit,
      coins: 0,
      affordable: false,
      price,
      message: `Am Stern vorbei — ${price} Münzen nötig, du hast ${player.coins}.`
    };
  }
  player.coins -= price;
  player.stars += 1;
  room.starsSold = (room.starsSold || 0) + 1;
  const movedTo = moveStarPad(room, { avoid: lit });
  return {
    type: "starPass",
    fieldIndex: lit,
    coins: -price,
    affordable: true,
    price,
    starGained: true,
    starMovedTo: movedTo,
    nextPrice: starPrice(room),
    message: `⭐ Im Vorbeigehen einen Stern geschnappt! (-${price} Münzen) Der nächste kostet ${starPrice(room)}.`
  };
}

function resolveGateRewards(player, pathSteps, board = BOARD_DEFINITIONS[0]) {
  return pathSteps
    .filter((fieldIndex) => board.fieldTypes[fieldIndex] === "gate")
    .map((fieldIndex) => {
      const bandName = board.zones[Math.floor(fieldIndex / 8)] || "Band";
      player.coins += GATE_COIN_BONUS;
      return {
        type: "gate",
        fieldIndex,
        coins: GATE_COIN_BONUS,
        message: `${bandName}-Tor: +${GATE_COIN_BONUS} Münzen.`
      };
    });
}

// Resolves what landing on a field does. `room` is optional so the pure coin
// fields stay unit-testable without a room; star fields need it for the pad.
function applyFieldEffect(player, fieldType, room = null) {
  if (fieldType === "normal" || fieldType === "start") {
    player.coins += NORMAL_FIELD_REWARD;
    return { type: fieldType, coins: NORMAL_FIELD_REWARD, message: `+${NORMAL_FIELD_REWARD} Münzen.` };
  }

  if (fieldType === "coin") {
    player.coins += COIN_FIELD_REWARD;
    return { type: fieldType, coins: COIN_FIELD_REWARD, message: `Münzader: +${COIN_FIELD_REWARD} Münzen!` };
  }

  if (fieldType === "item") {
    if (player.items.length >= MAX_ITEMS) {
      player.coins += NORMAL_FIELD_REWARD;
      return {
        type: fieldType,
        coins: NORMAL_FIELD_REWARD,
        message: `Hände voll — dafür +${NORMAL_FIELD_REWARD} Münzen.`
      };
    }
    const id = randomItemId();
    player.items.push(id);
    const item = itemDefinition(id);
    return { type: fieldType, coins: 0, item: id, message: `${item.icon} ${item.name} erhalten!` };
  }

  if (fieldType === "trap") {
    if (player.shielded) {
      player.shielded = false;
      return { type: fieldType, coins: 0, blocked: true, message: "🛡️ Schild hält die Falle ab!" };
    }
    const lost = Math.min(TRAP_FIELD_COST, player.coins);
    player.coins -= lost;
    return { type: fieldType, coins: -lost, message: lost ? `Falle! -${lost} Münzen.` : "Falle – aber die Taschen sind leer." };
  }

  if (fieldType === "luck") {
    // Risk/reward: you only gamble what you can cover, and losing still leaves
    // you on the board — the swing should sting, not eliminate.
    if (player.coins < LUCK_FIELD_STAKE) {
      player.coins += NORMAL_FIELD_REWARD;
      return {
        type: fieldType,
        coins: NORMAL_FIELD_REWARD,
        message: `Zu wenig Einsatz — dafür +${NORMAL_FIELD_REWARD} Münzen.`
      };
    }
    const won = Math.random() < 0.5;
    if (won) {
      player.coins += LUCK_FIELD_WIN;
      return { type: fieldType, coins: LUCK_FIELD_WIN, gamble: "win", message: `Glückstreffer! +${LUCK_FIELD_WIN} Münzen!` };
    }
    player.coins -= LUCK_FIELD_STAKE;
    return { type: fieldType, coins: -LUCK_FIELD_STAKE, gamble: "loss", message: `Danebengesetzt: -${LUCK_FIELD_STAKE} Münzen.` };
  }

  if (fieldType === "star") {
    const lit = room ? room.starIndex === player.position : false;
    if (!lit) {
      player.coins += NORMAL_FIELD_REWARD;
      return {
        type: fieldType,
        coins: NORMAL_FIELD_REWARD,
        starLit: false,
        message: `Sternenpodest ist dunkel — +${NORMAL_FIELD_REWARD} Münzen.`
      };
    }
    const price = starPrice(room);
    if (player.coins < price) {
      return {
        type: fieldType,
        coins: 0,
        starLit: true,
        starAffordable: false,
        price,
        message: `Ein Stern kostet ${price} Münzen — dir fehlen ${price - player.coins}.`
      };
    }
    player.coins -= price;
    player.stars += 1;
    if (room) room.starsSold = (room.starsSold || 0) + 1;
    const from = player.position;
    const to = room ? moveStarPad(room, { avoid: from }) : null;
    return {
      type: fieldType,
      coins: -price,
      starLit: true,
      starAffordable: true,
      starGained: true,
      starMovedTo: to,
      price,
      nextPrice: starPrice(room),
      message: `⭐ Stern gekauft! (-${price} Münzen) Der nächste kostet ${starPrice(room)}.`
    };
  }

  if (fieldType === "gate") {
    return { type: fieldType, coins: 0, message: "" };
  }
  return { type: "challenge", coins: 0, message: "Challenge-Feld: Ein Minispiel startet." };
}

// --- Items -----------------------------------------------------------------
// Items are spent BEFORE rolling, which is where the board's only real
// decisions live: hoard for the star run, or spend now to block a rival?
function consumeItem(room, player, itemId) {
  const slot = player.items.indexOf(itemId);
  if (slot === -1) return { ok: false, error: "Dieses Item hast du nicht." };
  const definition = itemDefinition(itemId);
  if (!definition) return { ok: false, error: "Unbekanntes Item." };

  const rivals = room.players.filter((candidate) => candidate.id !== player.id);

  if (itemId === "doubleDice") {
    player.pendingItem = "doubleDice";
  } else if (itemId === "goldDice") {
    player.pendingItem = "goldDice";
  } else if (itemId === "shield") {
    player.shielded = true;
  } else if (itemId === "swapBell") {
    // Swap with whoever is closest to the lit star — the aggressive play.
    const target = nearestToStar(room, rivals);
    if (!target) return { ok: false, error: "Kein Gegner zum Tauschen." };
    if (target.shielded) {
      target.shielded = false;
      player.items.splice(slot, 1);
      return {
        ok: true,
        item: itemId,
        blockedBy: target.id,
        message: `${definition.icon} ${target.name} blockt den Tausch mit dem Schild!`
      };
    }
    const mine = player.position;
    player.position = target.position;
    target.position = mine;
    player.items.splice(slot, 1);
    return {
      ok: true,
      item: itemId,
      targetId: target.id,
      message: `${definition.icon} Platztausch mit ${target.name}!`
    };
  } else if (itemId === "stickyTrap") {
    const target = standingsLeader(rivals);
    if (!target) return { ok: false, error: "Kein Gegner zum Bremsen." };
    if (target.shielded) {
      target.shielded = false;
      player.items.splice(slot, 1);
      return {
        ok: true,
        item: itemId,
        blockedBy: target.id,
        message: `${definition.icon} ${target.name} blockt die Klebefalle!`
      };
    }
    target.nextRollHalved = true;
    player.items.splice(slot, 1);
    return {
      ok: true,
      item: itemId,
      targetId: target.id,
      message: `${definition.icon} ${target.name} klebt fest — nächster Wurf halbiert.`
    };
  }

  player.items.splice(slot, 1);
  return { ok: true, item: itemId, message: `${definition.icon} ${definition.name} aktiviert.` };
}

// Closest rival to the lit star, measured forward along the loop.
function nearestToStar(room, candidates) {
  if (room.starIndex === null || room.starIndex === undefined) return standingsLeader(candidates);
  const size = getBoard(room.boardId).fieldTypes.length;
  let best = null;
  let bestDistance = Infinity;
  candidates.forEach((candidate) => {
    const distance = (room.starIndex - candidate.position + size) % size;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  });
  return best;
}

// The player currently ahead on the overall standing (stars, then coins).
function standingsLeader(candidates) {
  return [...candidates].sort(compareStanding)[0] || null;
}

function formatDiceRoll(baseDice, boost, penalty, result) {
  if (!boost && !penalty) return `eine ${result}`;
  const boostPart = boost ? `+${boost}` : "";
  const penaltyPart = penalty ? `-${penalty}` : "";
  return `${baseDice}${boostPart}${penaltyPart} = ${result}`;
}

function advanceTurn(room) {
  if (room.status !== "board") return;

  room.phase = "waitingRoll";
  const lastIndex = room.players.length - 1;
  if (room.currentTurnIndex >= lastIndex) {
    startMinigame(room, "Runden-Minispiel", "completeRound");
    emitRoom(room);
    return;
  }

  room.currentTurnIndex += 1;
  room.lastMessage = `${getCurrentPlayer(room)?.name || "Nächster Spieler"} ist am Zug.`;
  emitRoom(room);
}

function startMinigame(room, reason, afterAction, forcedType = null) {
  clearRoomTimers(room);

  const template = MINIGAMES.find((minigame) => minigame.type === forcedType)
    || MINIGAMES[room.minigameCounter % MINIGAMES.length];
  room.minigameCounter += 1;
  room.status = "minigame";
  room.phase = "playingMinigame";
  room.lastMove = null;
  room.lastMinigameResult = null;
  room.afterMinigameAction = afterAction;

  const now = Date.now();
  const countdownMs = template.countdownMs || 4200;
  const minigame = {
    id: `${room.code}_${room.minigameCounter}_${now}`,
    type: template.type,
    title: template.title,
    reason,
    startedAt: now + countdownMs,
    duration: template.duration,
    scores: {},
    stopped: {},
    lanes: {},
    hits: {},
    arena: {},
    flux: {},
    canopy: {},
    arcade: null,
    blocks: [],
    resolvedBlocks: {},
    lastInputAt: {}
  };

  room.players.forEach((player) => {
    minigame.scores[player.id] = 0;
    minigame.stopped[player.id] = false;
    minigame.lanes[player.id] = 2;
    minigame.hits[player.id] = 0;
    player.minigameScore = 0;
  });

  if (template.type === "dodgeBlocks") {
    minigame.blocks = createDodgeBlocks(template.duration);
  }
  if (template.type === "bounceArena") {
    minigame.arena = createArenaState(room.players, minigame.startedAt);
  }
  if (template.type === "fluxFloor") {
    minigame.flux = createFluxState(room.players, minigame.startedAt);
    refreshFluxScores(room);
  }
  if (template.type === "canopyClimb") {
    minigame.canopy = createCanopyState(room.players, minigame.startedAt);
  }
  if (template.arcadeFamily) {
    minigame.arcade = createArcadeState(template.type, room.players, minigame.startedAt);
  }

  room.currentMinigame = minigame;
  room.lastMessage = `${template.title} startet.`;

  scheduleBotMinigameInputs(room);
  room.minigameTick = setInterval(() => {
    updateDodgeMinigame(room);
    updateBounceArena(room);
    updateFluxFloor(room);
    updateCanopyClimb(room);
    updateArcade(room);
    // Finale window elapsed → now actually finish and show the scoreboard.
    const current = room.currentMinigame;
    if (current?.finaleAt && Date.now() >= current.finaleAt && room.status === "minigame") {
      finishMinigame(room);
      return;
    }
    emitMinigameUpdate(room);
  }, 90);

  // Natural end also runs through the finale window (celebration/reveal)
  // before the scoreboard — the tick loop finishes once finaleAt elapses.
  setTrackedTimeout(room, () => beginMinigameFinale(room, room.currentMinigame), countdownMs + template.duration + 350);
  setTrackedTimeout(room, () => finishMinigame(room), countdownMs + template.duration + 350 + MINIGAME_FINALE_MS + 500);
}

function handleMinigameInput(room, player, rawInput) {
  const minigame = room.currentMinigame;
  if (room.status !== "minigame" || !minigame) {
    return { ok: false, error: "Gerade läuft kein Minispiel." };
  }
  // Ab hier lesen alle Familien Felder aus `input`. Ein Nicht-Objekt darf hier
  // nicht durchrutschen — der Wurf käme mitten im Tick und nähme die Partie mit.
  const input = (rawInput && typeof rawInput === "object") ? rawInput : {};
  const now = Date.now();
  if (now < minigame.startedAt) {
    return { ok: false, error: "Das Minispiel startet gleich." };
  }
  if (now > minigame.startedAt + minigame.duration) {
    return { ok: false, error: "Das Minispiel ist vorbei." };
  }

  if (minigame.type === "timingStop") {
    if (input.action !== "stop") return { ok: false, error: "Ungültiger Timing-Input." };
    if (minigame.stopped[player.id]) return { ok: true };
    const score = computeTimingScore(minigame, now);
    minigame.scores[player.id] = score;
    minigame.stopped[player.id] = true;
    player.minigameScore = score;
    emitMinigameUpdate(room);
    if (room.players.every((candidate) => minigame.stopped[candidate.id])) {
      finishMinigame(room);
    }
    return { ok: true };
  }

  if (minigame.type === "dodgeBlocks") {
    if (input.action !== "left" && input.action !== "right") {
      return { ok: false, error: "Ungültiger Dodge-Input." };
    }
    const last = minigame.lastInputAt[player.id] || 0;
    if (now - last < 90) return { ok: true };
    minigame.lastInputAt[player.id] = now;
    const lane = minigame.lanes[player.id] ?? 2;
    minigame.lanes[player.id] = clamp(lane + (input.action === "left" ? -1 : 1), 0, 4);
    emitMinigameUpdate(room);
    return { ok: true };
  }

  if (minigame.type === "bounceArena") {
    const result = handleArenaInput(room, player, input);
    if (!result.ok) return result;
    emitMinigameUpdate(room);
    return { ok: true };
  }

  if (minigame.type === "fluxFloor") {
    const result = handleFluxInput(room, player, input);
    if (!result.ok) return result;
    refreshFluxScores(room);
    emitMinigameUpdate(room);
    return { ok: true };
  }

  if (minigame.type === "canopyClimb") {
    const result = handleCanopyInput(room, player, input);
    if (!result.ok) return result;
    updateCanopyClimb(room);
    if (maybeFinishCanopy(room)) return { ok: true };
    emitMinigameUpdate(room);
    return { ok: true };
  }

  if (minigame.arcade) {
    const result = handleArcadeInput(room, player, input);
    if (!result.ok) return result;
    emitMinigameUpdate(room);
    return { ok: true };
  }

  return { ok: false, error: "Unbekanntes Minispiel." };
}

function scheduleBotMinigameInputs(room) {
  const minigame = room.currentMinigame;
  if (!minigame) return;

  room.players.filter((player) => player.isBot).forEach((bot) => {
    if (minigame.type === "timingStop") {
      const stopDelay = 1600 + Math.floor(Math.random() * (minigame.duration - 1800));
      setTrackedTimeout(room, () => {
        if (room.currentMinigame?.id !== minigame.id || minigame.stopped[bot.id]) return;
        const score = computeTimingScore(minigame, Date.now());
        minigame.scores[bot.id] = Math.max(score, 20 + Math.floor(Math.random() * 45));
        minigame.stopped[bot.id] = true;
        bot.minigameScore = minigame.scores[bot.id];
        emitMinigameUpdate(room);
      }, stopDelay);
    }

    if (minigame.type === "dodgeBlocks") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id) return;
        const elapsed = Date.now() - minigame.startedAt;
        const nextBlock = minigame.blocks.find((block) => block.impactAt > elapsed + 350);
        if (!nextBlock) return;
        const currentLane = minigame.lanes[bot.id] ?? 2;
        if (currentLane === nextBlock.lane) {
          minigame.lanes[bot.id] = currentLane <= 2 ? currentLane + 1 : currentLane - 1;
        } else if (Math.random() > 0.72) {
          minigame.lanes[bot.id] = clamp(currentLane + pick([-1, 1]), 0, 4);
        }
      }, 420 + Math.floor(Math.random() * 180));
      return timer;
    }

    if (minigame.type === "bounceArena") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt) return;
        arenaBotStep(minigame.arena, bot.id);
      }, 180 + Math.floor(Math.random() * 110));
      return timer;
    }

    if (minigame.type === "fluxFloor") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt) return;
        fluxBotStep(room, bot);
      }, 165 + Math.floor(Math.random() * 80));
      return timer;
    }

    if (minigame.type === "canopyClimb") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt) return;
        canopyBotStep(room, bot);
      }, 190 + Math.floor(Math.random() * 100));
      return timer;
    }

    if (minigame.arcade) {
      // Spurmaler ist kein Entscheidungsspiel, sondern eine Zugbewegung: ein
      // Finger liefert laufend Positionen. Mit dem normalen Entscheidungstakt
      // (~300 ms) käme ein Bot wegen der Sprungweite nie über 0.17 Fortschritt
      // pro Sekunde und damit nie in die Nähe einer Hand.
      // trace ist eine Zugbewegung, belt ein Treffen enger Bandpositionen —
      // beide brauchen Handrate, nicht Entscheidungsrate. Bei ~300 ms wandert
      // ein Paket am Rundenende um 0.26 Bandanteil weiter, das Greiffenster des
      // starken Bots ist nur 0.22 breit: er verpasst es strukturell.
      // fish braucht ebenfalls einen dichten Takt: Halten wird als Ping gemeldet,
      // und bei ~300 ms Abstand würde ein Ping-Fenster von 190 ms Lücken lassen.
      // paint ebenso: die Richtung wird laufend gehalten wie an einem Stick.
      // stack ebenso: der Block wandert bis zu 0.2 je 150 ms, das Trefferfenster
      // ist 0.05 breit. Bei ~300 ms Takt übersieht ein Bot den passenden Moment
      // strukturell — gemessen baute der starke Bot dadurch niedriger als der
      // schwache.
      // bounce genauso: das Volltrefferfenster ist ±110 ms breit. Bei 320 ms Takt
      // wäre der Bot-eigene Fehler allein durch den Takt schon ±160 ms, das
      // Können könnte sich gar nicht zeigen.
      // glide ebenso: der Brenner ist eine gehaltene Hand, keine Entscheidung. Bei
      // ~300 ms Takt kaeme der Ballon zwischen zwei Bot-Ticks um 0.2 Hoehenanteile
      // vom Kurs ab — mehr als die lichte Weite eines spaeten Tores.
      const fastHand = ["trace", "belt", "glide", "fish", "paint", "stack", "bounce", "knife", "colorgrid", "sumo", "bomb", "stopclock", "cannon", "wave", "barrel"].includes(minigame.arcade.family);
      const every = fastHand
        ? 120 + Math.floor(Math.random() * 60)
        : 260 + Math.floor(Math.random() * 150);
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt) return;
        arcadeBotStep(room, bot);
      }, every);
      return timer;
    }

    return null;
  });
}

function updateDodgeMinigame(room) {
  const minigame = room.currentMinigame;
  if (!minigame || minigame.type !== "dodgeBlocks") return;
  const elapsed = Date.now() - minigame.startedAt;
  minigame.blocks.forEach((block) => {
    if (minigame.resolvedBlocks[block.id] || elapsed < block.impactAt) return;
    minigame.resolvedBlocks[block.id] = true;
    room.players.forEach((player) => {
      if ((minigame.lanes[player.id] ?? 2) === block.lane) {
        minigame.hits[player.id] = (minigame.hits[player.id] || 0) + 1;
      }
    });
  });
}

function updateBounceArena(room) {
  const minigame = room.currentMinigame;
  if (!minigame || minigame.type !== "bounceArena") return;
  const arena = minigame.arena;
  const now = Date.now();
  if (now < minigame.startedAt) {
    arena.lastUpdateAt = now;
    return;
  }

  const frameDt = Math.min(0.12, Math.max(0.016, (now - (arena.lastUpdateAt || now)) / 1000));
  arena.lastUpdateAt = now;
  arena.tick = (arena.tick || 0) + 1;

  const players = Object.values(arena.players);

  const sub = ARENA_SUBSTEPS;
  const dt = frameDt / sub;
  const limit = ARENA_RADIUS - ARENA_BALL_RADIUS;

  for (let step = 0; step < sub; step += 1) {
    // Integrate: thrust while the stick intent is fresh, then damping, then move.
    players.forEach((ap) => {
      if (!ap.inPlay) return;
      const steering = now - ap.lastThrustAt < 200 ? 1 : 0;
      if (steering) {
        ap.vx += ap.thrustX * ARENA_ACCEL * dt;
        ap.vy += ap.thrustY * ARENA_ACCEL * dt;
      }
      const damp = Math.exp(-ARENA_DRAG * dt);
      ap.vx *= damp;
      ap.vy *= damp;
      ap.x += ap.vx * dt;
      ap.y += ap.vy * dt;
      ap.playMs += dt * 1000;
      ap.score += dt * ARENA_SURVIVE_RATE;
    });

    // Ball-ball collisions (skip invulnerable spawns so nobody is spawn-camped).
    const entries = Object.entries(arena.players);
    for (let a = 0; a < entries.length; a += 1) {
      for (let b = a + 1; b < entries.length; b += 1) {
        resolveArenaCollision(entries[a], entries[b], now);
      }
    }

    // Rim: reflect gentle contact, let a hard outward push fly over and fall.
    players.forEach((ap) => {
      if (!ap.inPlay) return;
      const dist = Math.hypot(ap.x, ap.y);
      if (dist <= limit) return;
      const nx = ap.x / (dist || 1);
      const ny = ap.y / (dist || 1);
      const launched = now < ap.launchedUntil;
      const invulnerable = now < ap.invulnUntil;
      if (!ap.ejecting && (!launched || invulnerable)) {
        // Not launched (or protected): bounce back onto the plate.
        ap.x = nx * limit;
        ap.y = ny * limit;
        const vn = ap.vx * nx + ap.vy * ny;
        ap.vx -= (1 + ARENA_RIM_RESTITUTION) * vn * nx;
        ap.vy -= (1 + ARENA_RIM_RESTITUTION) * vn * ny;
      } else {
        ap.ejecting = true;
      }
      if (ap.ejecting && dist > ARENA_RADIUS + ARENA_BALL_RADIUS) {
        knockArenaPlayerOff(arena, ap, now);
      }
    });
  }

  let aliveCount = 0;
  room.players.forEach((player) => {
    const ap = arena.players[player.id];
    if (!ap) return;
    if (ap.inPlay) aliveCount += 1;
    minigame.scores[player.id] = Math.max(0, Math.round(ap.score));
    player.minigameScore = minigame.scores[player.id];
  });

  // Single elimination: once only one (or none) is left on the plate, play a
  // short finale (survivor celebrates on camera), then the scoreboard.
  const elapsed = now - minigame.startedAt;
  if (aliveCount <= 1 && elapsed > 2000 && room.players.length > 1) {
    beginMinigameFinale(room, minigame);
  }
}

// Falling off is permanent — one knock-off and you are out for the round.
function knockArenaPlayerOff(arena, ap, now) {
  if (!ap.inPlay) return;
  ap.inPlay = false;
  ap.ejecting = false;
  ap.outAt = now;
  ap.knockedAt = now;
  ap.falls += 1;
  ap.vx = 0;
  ap.vy = 0;
  // Credit a recent hitter with the knockout.
  const hitter = ap.lastHitBy && arena.players[ap.lastHitBy];
  if (hitter && now - ap.lastHitAt < ARENA_CREDIT_MS) {
    hitter.knockouts += 1;
    hitter.score += ARENA_KNOCKOUT_BONUS;
  }
  ap.lastHitBy = null;
}

// Schedule the wind-down: gameplay keeps rendering for a short finale so
// everyone sees who is still standing, then the scoreboard follows.
// Platzierung aus einer Wertungsfunktion. Gleichstand teilt sich den Platz —
// sonst wäre einer von zwei exakt gleich guten Läufen grundlos der traurigere.
function rankPlaces(players, scoreOf) {
  const ranked = players
    .map((player) => ({ id: player.id, rank: scoreOf(player) }))
    .sort((one, two) => two.rank - one.rank);
  const places = {};
  ranked.forEach((entry, index) => {
    const tie = index > 0 && ranked[index - 1].rank === entry.rank;
    places[entry.id] = tie ? places[ranked[index - 1].id] : index + 1;
  });
  return places;
}

function beginMinigameFinale(room, minigame) {
  if (!minigame || minigame.finaleAt || minigame.finishing) return;
  minigame.finaleAt = Date.now() + MINIGAME_FINALE_MS;
  // Die Platzierung steht mit dem Finale fest — sie wird hier EINMAL berechnet
  // und mitgeschickt, damit alle Geräte dieselbe Reaktion zeigen. Vorher kannte
  // jede Szene nur „Sieger ja/nein" und jubelte oder trauerte binär; jetzt
  // reagiert jeder Platz eigen (siehe finaleMood im Client).
  if (minigame.arcade) {
    minigame.arcade.places = rankPlaces(room.players, (player) =>
      arcadeRankingScore(minigame.arcade, minigame.arcade.players[player.id]));
  }
  // Rempelkugel läuft nicht über die Arcade-Familien, braucht die Plätze aber
  // genauso — sonst reagierte dort weiter jeder gleich.
  //
  // Auf `minigame.arena.players` prüfen, NICHT nur auf `minigame.arena`: das
  // Feld wird für jedes Minispiel als leeres Objekt angelegt, und ein leeres
  // Objekt ist wahr. Dadurch flog hier bei JEDEM Arcade-Spiel eine Ausnahme,
  // bevor emitMinigameUpdate lief — die eben berechneten Plätze wurden also nie
  // verschickt, und die Schlussreaktion (Platz 1 jubelt, Platz 4 knickt ein)
  // kam im echten Spiel nie an. Gefunden hat das der Brett-Simulator, der sechs
  // Serverfehler je Partie meldete.
  if (minigame.arena?.players) {
    minigame.arena.places = rankPlaces(room.players, (player) =>
      bounceResultScore(minigame.arena.players[player.id]));
  }
  emitMinigameUpdate(room);
}

function finishMinigame(room) {
  const minigame = room.currentMinigame;
  if (!minigame || room.status !== "minigame") return;
  minigame.finishing = true;

  updateDodgeMinigame(room);
  updateFluxFloor(room);
  updateCanopyClimb(room);
  updateArcade(room);
  clearRoomTimers(room);
  const finishedAt = Date.now();

  room.players.forEach((player) => {
    if (minigame.type === "dodgeBlocks") {
      const hits = minigame.hits[player.id] || 0;
      minigame.scores[player.id] = Math.max(0, 100 - hits * 25);
    }
    if (minigame.type === "bounceArena") {
      const arenaPlayer = minigame.arena.players[player.id];
      minigame.scores[player.id] = bounceResultScore(arenaPlayer);
    }
    if (minigame.type === "timingStop" && !minigame.stopped[player.id]) {
      minigame.scores[player.id] = 0;
    }
    if (minigame.arcade) {
      minigame.scores[player.id] = arcadeRankingScore(minigame.arcade, minigame.arcade.players[player.id]);
    }
    player.minigameScore = minigame.scores[player.id] || 0;
  });

  const ranking = room.players
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      color: player.color,
      score: minigame.scores[player.id] || 0,
      hits: minigame.hits[player.id] || 0,
      detail: minigameResultDetail(minigame, player.id, finishedAt),
      award: 0
    }))
    .sort((a, b) => b.score - a.score);

  const awards = [10, 6, 3, 1];
  let rankIndex = 0;
  while (rankIndex < ranking.length) {
    let tieEnd = rankIndex + 1;
    while (tieEnd < ranking.length && ranking[tieEnd].score === ranking[rankIndex].score) tieEnd += 1;
    const occupiedAwards = awards.slice(rankIndex, tieEnd);
    const sharedAward = Math.round(occupiedAwards.reduce((sum, award) => sum + award, 0) / occupiedAwards.length);
    ranking.slice(rankIndex, tieEnd).forEach((entry) => {
      const player = room.players.find((candidate) => candidate.id === entry.playerId);
      entry.award = sharedAward;
      if (player) player.coins += sharedAward;
    });
    rankIndex = tieEnd;
  }

  // Marathon/single mode: every round winner banks a win (ties share it).
  if ((room.mode === "arcade" || room.mode === "single") && ranking.length > 0) {
    const topScore = ranking[0].score;
    ranking.forEach((entry) => {
      if (entry.score !== topScore) return;
      entry.roundWin = true;
      const player = room.players.find((candidate) => candidate.id === entry.playerId);
      if (player) player.wins = (player.wins || 0) + 1;
    });
  }

  room.status = "result";
  room.phase = "minigameResult";
  room.lastMinigameResult = {
    id: minigame.id,
    type: minigame.type,
    title: minigame.title,
    reason: minigame.reason,
    ranking
  };
  room.resultEndsAt = Date.now() + RESULT_HOLD_MS;
  room.readyForNext = [];
  room.currentMinigame = null;
  room.lastMessage = `${minigame.title}: ${ranking[0]?.name || "Niemand"} gewinnt.`;
  emitRoom(room);

  setTrackedTimeout(room, () => continueAfterResult(room), RESULT_HOLD_MS);
}

function bounceResultScore(arenaPlayer) {
  if (!arenaPlayer) return 0;
  // Survival time and knockouts are already folded into the live score; a
  // last-one-standing survivor gets a decisive bonus on top.
  const base = Math.max(0, Math.round(arenaPlayer.score || 0));
  return base + (arenaPlayer.inPlay ? 100000 : 0);
}

function arcadeRankingScore(arcade, arcadePlayer) {
  if (!arcadePlayer) return 0;
  const score = Math.max(0, Math.round(arcadePlayer.score || 0));
  const successes = arcadePlayer.successes || 0;
  const mistakes = arcadePlayer.mistakes || 0;
  if (arcade.mode === "sweep" || arcade.mode === "collect") {
    return Math.max(0, 50000 + successes * 100000 - mistakes * 1000 + score);
  }
  if (arcade.mode === "course" || arcade.mode === "avoid") {
    return Math.max(0, 10000000 - mistakes * 100000 + Math.round(arcadePlayer.activeMs || 0));
  }
  if (arcade.mode === "catch") {
    return Math.max(0, 50000 + successes * 100000 - mistakes * 1000 + score);
  }
  if (arcade.mode === "balance" || arcade.mode === "chase" || arcade.mode === "stay") {
    return Math.max(0, Math.round(arcadePlayer.activeMs || 0));
  }
  if (arcade.family === "choice" || arcade.family === "target") {
    return Math.max(0, 50000 + successes * 100000 - mistakes * 100 + score);
  }
  if (arcade.family === "plinko") {
    return Math.max(0, score * 1000 + successes);
  }
  if (arcade.family === "curling") {
    // Die Ringe sind grob: ein Stein 1 mm neben dem Knopf zählt genauso viel
    // wie einer am Innenrand. Damit war das Spiel oben gedeckelt — "normal" und
    // "hard" lagen gemessen gleichauf, weil Präzision ab einem gewissen Punkt
    // gar nicht mehr belohnt wurde.
    //
    // Die Ringpunkte bleiben die Schlagzeile (die sieht der Spieler), darunter
    // entscheidet die Nähe zum Knopf. Der Feinwert bleibt unter 1000 und kann
    // deshalb keinen Ringunterschied kippen.
    return Math.max(0, score * 1000 + (arcadePlayer.precision || 0));
  }
  if (arcade.family === "stopclock") {
    // Closest guess wins: a smaller deviation ranks higher.
    if (arcadePlayer.stoppedMs === null || arcadePlayer.stoppedMs === undefined) return 0;
    return Math.max(1, 100000 - Math.round(arcadePlayer.deviationMs || 0));
  }
  if (arcade.family === "runner") {
    // Finishers rank above everyone still running, fastest first.
    return arcadePlayer.finishedAt
      ? 10000000 - Math.round(arcadePlayer.finishMs || 0)
      : Math.round(arcadePlayer.progress || 0);
  }
  if (arcade.family === "colorgrid") {
    // More survived rounds wins; fewer falls breaks ties.
    return Math.max(0, (arcadePlayer.survived || 0) * 1000 - (arcadePlayer.stumbles || 0));
  }
  if (arcade.family === "redlight") {
    // Finishers rank above runners, fastest first; getting caught costs progress anyway.
    return arcadePlayer.finishedAt
      ? 10000000 - Math.round(arcadePlayer.finishMs || 0)
      : Math.round((arcadePlayer.progress || 0) * 100);
  }
  if (arcade.family === "wave") {
    // Survive more waves to win; later elimination breaks ties.
    return (arcadePlayer.eliminated ? 0 : 5000000) + (arcadePlayer.survived || 0) * 1000;
  }
  if (arcade.family === "pump") {
    return arcadePlayer.pumps || 0;
  }
  if (arcade.family === "dive") {
    return Math.max(0, arcadePlayer.banked || 0);
  }
  if (arcade.family === "sumo") {
    // Ausgeschiedene ganz unten, dort zählt der spätere Abgang. Oben entscheidet
    // erst die Zahl der Treffer, dann die Abwehr — beides ist genau das, was das
    // Spiel übt.
    if (arcadePlayer.eliminated) return Math.max(1, Math.round(arcadePlayer.eliminatedMs || 1));
    // Gewertet wird, was man abgewehrt hat — genau die Zahl, die auch angezeigt
    // wird. Die Treffer entscheiden nur, ob man überhaupt noch dabei ist.
    return 100000000 + (arcadePlayer.blocks || 0) * 1000
      + Math.max(0, arcade.hitsOut - (arcadePlayer.hits || 0)) * 50;
  }
  if (arcade.family === "barrel") {
    // Whoever stays on longest wins; survivors rank above everyone who fell.
    return arcadePlayer.fallenAt
      ? Math.round(arcadePlayer.survivedMs || 0)
      : 10000000 + Math.round(arcadePlayer.score || 0);
  }
  if (arcade.family === "bomb") {
    // Survivors on top; among the blown-up, a later boom ranks higher.
    return arcadePlayer.outAt
      ? Math.max(1, Math.round(arcadePlayer.outAt))
      : 100000000000000 + (arcadePlayer.passes || 0);
  }
  if (arcade.family === "catchfall") {
    return Math.max(0, 50000 + (arcadePlayer.catches || 0) * 1000 - (arcadePlayer.bombs || 0) * 600);
  }
  if (arcade.family === "whack") {
    return Math.max(0, 50000 + (arcadePlayer.hits || 0) * 1000 - (arcadePlayer.badHits || 0) * 400);
  }
  if (arcade.family === "cannon") {
    return arcadePlayer.launchedAt ? (arcadePlayer.distance || 0) : 0;
  }
  if (arcade.family === "simon") {
    return Math.max(0, (arcadePlayer.survived || 0) * 1000 - (arcadePlayer.mistakes || 0));
  }
  if (arcade.family === "react") {
    const played = arcadePlayer.times || [];
    const total = played.reduce((sum, value) => sum + value, 0) + (REACT_ROUNDS - played.length) * REACT_WINDOW_MS;
    return Math.max(1, 1000000 - total);
  }
  if (arcade.family === "estimate") {
    // Der Punktestand steckt alles: jede Schätzung ist umso mehr wert, je näher
    // sie lag. Bei Gleichstand rangiert höher, wer insgesamt weniger danebenlag.
    return Math.max(0, Math.round(arcadePlayer.score || 0) * 1000
      + Math.max(0, 900 - Math.round(arcadePlayer.totalError || 0)));
  }
  if (arcade.family === "seek") {
    // Der Punktestand steckt schon alles: jeder Fund ist umso mehr wert, je
    // weniger Tipps er gekostet hat. Bei Gleichstand entscheidet die sparsamere
    // Hand — wer mit weniger Tipps auf dieselbe Zahl kommt, hat besser gedacht.
    return Math.max(0, Math.round(arcadePlayer.score || 0) * 1000
      + Math.max(0, 500 - (arcadePlayer.totalProbes || 0)));
  }
  if (arcade.family === "knife") {
    // Survivors rank above the eliminated; more knives stuck breaks ties, and
    // among equals der sauberere Wurf (näher am bestmöglichen) rangiert höher.
    // Die Feinwertung ist auf 0..500 normiert und bleibt damit immer unter
    // einem einzigen Treffer (1000) — sie ordnet Gleichstände, sie kippt nichts.
    const precision = Math.round(
      ((arcadePlayer.precision || 0) / Math.max(1, arcade.rounds || 1)) * 500);
    return Math.max(0, (arcadePlayer.eliminated ? 0 : 5000000)
      + (arcadePlayer.stuck || 0) * 1000
      + precision
      - (arcadePlayer.clashes || 0) * 100);
  }
  if (arcade.family === "stack") {
    // Tallest tower wins; perfect stacks are the tie-breaker.
    return (arcadePlayer.height || 0) * 1000 + (arcadePlayer.perfects || 0);
  }
  if (arcade.family === "climb") {
    // Reaching the top ranks by speed; otherwise by how high you got.
    return arcadePlayer.finishedAt
      ? 10000000 - Math.round(arcadePlayer.finishMs || 0)
      : (arcadePlayer.rung || 0) * 100;
  }
  return score;
}

function minigameResultDetail(minigame, playerId, finishedAt) {
  if (minigame.type === "canopyClimb") {
    const climber = minigame.canopy.players[playerId];
    return climber?.finishedAt
      ? { kind: "time", value: climber.finishMs, label: "Zielzeit" }
      : { kind: "progress", value: climber?.level || 0, total: minigame.canopy.goal, label: "Blätter" };
  }
  if (minigame.type === "fluxFloor") {
    return { kind: "territory", value: minigame.flux.players[playerId]?.territory || 0, label: "Felder" };
  }
  if (minigame.type === "bounceArena") {
    const arenaPlayer = minigame.arena.players[playerId];
    return {
      kind: "knockouts",
      value: arenaPlayer?.knockouts || 0,
      survivedMs: Math.round(arenaPlayer?.playMs || 0),
      falls: arenaPlayer?.falls || 0,
      label: "Rauswürfe"
    };
  }
  if (minigame.type === "dodgeBlocks") {
    return { kind: "hits", value: minigame.hits[playerId] || 0, label: "Treffer" };
  }
  if (minigame.arcade) return arcadeResultDetail(minigame.arcade, minigame.arcade.players[playerId]);
  return null;
}

function arcadeResultDetail(arcade, arcadePlayer) {
  if (!arcadePlayer) return null;
  if (arcade.mode === "sweep" || arcade.mode === "collect") {
    return { kind: "coins", value: arcadePlayer.successes || 0, label: "Münzen" };
  }
  if (arcade.mode === "course" || arcade.mode === "avoid") {
    return { kind: "hits", value: arcadePlayer.mistakes || 0, label: "Treffer" };
  }
  if (arcade.mode === "catch") {
    return { kind: "catches", value: arcadePlayer.successes || 0, label: "Lichter" };
  }
  if (arcade.mode === "balance" || arcade.mode === "chase" || arcade.mode === "stay") {
    return { kind: "zoneTime", value: Math.round(arcadePlayer.activeMs || 0), label: "Im Ziel" };
  }
  if (arcade.family === "choice") {
    return { kind: "correct", value: arcadePlayer.successes || 0, label: "Richtig" };
  }
  if (arcade.family === "timing") {
    return { kind: "precision", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Präzision" };
  }
  if (arcade.family === "target") {
    return { kind: "targets", value: arcadePlayer.successes || 0, label: "Treffer" };
  }
  if (arcade.family === "plinko") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "curling") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Ring-Punkte" };
  }
  if (arcade.family === "stopclock") {
    // Eine Zahl, und zwar die, nach der auch sortiert wird: wie weit die
    // Schätzung danebenlag. `deviationMs` als Art kannte die Oberfläche gar
    // nicht — angezeigt wurde deshalb der rohe Punktestand (eine Zahl um
    // 99 900), die mit dem Spiel nichts zu tun hatte.
    return {
      kind: "deviation",
      value: arcadePlayer.deviationMs === null || arcadePlayer.deviationMs === undefined
        ? null
        : Math.round(arcadePlayer.deviationMs),
      label: "daneben"
    };
  }
  if (arcade.family === "runner") {
    return arcadePlayer.finishedAt
      ? { kind: "time", value: arcadePlayer.finishMs, label: "Zielzeit" }
      : { kind: "progress", value: Math.round(arcadePlayer.progress || 0), total: RUNNER_LENGTH, label: "Meter" };
  }
  if (arcade.family === "colorgrid") {
    return { kind: "points", value: arcadePlayer.survived || 0, label: "Runden" };
  }
  if (arcade.family === "redlight") {
    return arcadePlayer.finishedAt
      ? { kind: "time", value: arcadePlayer.finishMs, label: "Zielzeit" }
      : { kind: "progress", value: Math.round(arcadePlayer.progress || 0), total: REDLIGHT_GOAL, label: "Meter" };
  }
  if (arcade.family === "wave") {
    return { kind: "points", value: arcadePlayer.survived || 0, label: "Wellen" };
  }
  if (arcade.family === "pump") {
    return { kind: "points", value: arcadePlayer.pumps || 0, label: "Pumps" };
  }
  if (arcade.family === "barrel") {
    // Reine Zeit. Der Punktestand mischt Zeit und Balancearbeit — als Dauer
    // formatiert ergab das eine Zahl, die niemand einordnen kann.
    return {
      kind: "standing",
      survived: !arcadePlayer.fallenAt,
      value: Math.round(arcadePlayer.survivedMs || 0),
      label: "Auf dem Fass"
    };
  }
  if (arcade.family === "bomb") {
    // Gewertet wird, wer die Bombe NICHT in der Hand hatte, als sie hochging.
    // Die Zahl der Weitergaben sagte darüber nichts — wer viel weitergab, konnte
    // trotzdem als Erster fliegen.
    return {
      kind: "standing",
      survived: !arcadePlayer.outAt,
      value: arcadePlayer.outAt ? Math.max(0, arcadePlayer.outAt - (arcade.startedAt || arcadePlayer.outAt)) : 0,
      label: "Ausgang"
    };
  }
  if (arcade.family === "catchfall") {
    return { kind: "coins", value: arcadePlayer.catches || 0, label: "Münzen" };
  }
  if (arcade.family === "whack") {
    return { kind: "targets", value: arcadePlayer.hits || 0, label: "Treffer" };
  }
  if (arcade.family === "cannon") {
    return { kind: "points", value: arcadePlayer.distance || 0, label: "Meter" };
  }
  if (arcade.family === "simon") {
    return { kind: "correct", value: arcadePlayer.survived || 0, label: "Runden" };
  }
  if (arcade.family === "react") {
    const played = arcadePlayer.times || [];
    const total = played.reduce((sum, value) => sum + value, 0) + (REACT_ROUNDS - played.length) * REACT_WINDOW_MS;
    return { kind: "sumTime", value: Math.round(total), label: "gesamt" };
  }
  if (arcade.family === "estimate") {
    // Eine Zahl, und zwar die, nach der auch sortiert wird. Der Gesamtfehler
    // wäre die naheliegende Anzeige, widerspräche aber der Rangfolge, sobald
    // jemand einen Volltreffer mit seiner Zugabe dabei hat.
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "seek") {
    // Eine Zahl, und zwar die, nach der auch sortiert wird. Die Zahl der Funde
    // allein würde lügen: vier zufällig erstolperte Funde sind weniger wert als
    // drei erdachte.
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "knife") {
    // Zuerst entscheidet, ob man noch dabei ist — also steht das auch da.
    // Ein Ausgeschiedener mit fünf Treffern liegt hinter einem Überlebenden mit
    // zwei, und eine reine Trefferzahl behauptete das Gegenteil.
    return arcadePlayer.eliminated
      ? { kind: "knifeOut", survived: false, value: arcadePlayer.stuck || 0, label: "Treffer" }
      : { kind: "points", value: arcadePlayer.stuck || 0, label: "Treffer" };
  }
  if (arcade.family === "stack") {
    return { kind: "points", value: arcadePlayer.height || 0, label: "Etagen" };
  }
  if (arcade.family === "bounce") {
    return { kind: "points", value: Math.round((arcadePlayer.best || 0) * 10) / 10, label: "Höhe" };
  }
  if (arcade.family === "feint") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "paint") {
    // Eigene Art, nicht das vorhandene "territory": dort gibt es kein Feld für
    // die übermalten Felder, und die sind hier die halbe Geschichte.
    return {
      kind: "points",
      value: Math.max(0, Math.round(arcadePlayer.score || 0)),
      label: "Punkte"
    };
  }
  if (arcade.family === "fish") {
    // Eine Zahl, und zwar die, nach der auch sortiert wird. Die Oberfläche
    // zeigte bisher die STÜCKZAHL — seit die Arten unterschiedlich viel wert
    // sind, konnte damit jemand mit weniger Fischen vorne stehen und die
    // Anzeige behauptete das Gegenteil.
    return {
      kind: "points",
      value: Math.max(0, Math.round(arcadePlayer.score || 0)),
      label: "Punkte"
    };
  }
  if (arcade.family === "belt") {
    // Eine Zahl, und zwar genau die, nach der auch sortiert wird. Pakete,
    // Fehlgriffe und Serie stecken alle schon im Punktestand.
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "trace") {
    // Eine Zahl, und zwar die, nach der auch sortiert wird. Die Oberfläche
    // zeigte die RUNDEN — mit Kristallen und Sauber-Bonus kann aber jemand mit
    // weniger Runden vorne liegen.
    return {
      kind: "points",
      value: Math.max(0, Math.round(arcadePlayer.score || 0)),
      label: "Punkte"
    };
  }
  if (arcade.family === "sumo") {
    // Eine Zahl, und zwar die, nach der auch sortiert wird: wie oft man den
    // Stein zurückgeschlagen hat. Die Treffer entscheiden nur über das Aus.
    return { kind: "points", value: arcadePlayer.blocks || 0, label: "Abgewehrt" };
  }
  if (arcade.family === "dive") {
    // Eine Zahl: das eingezahlte Gold. Was noch im Schacht hängt, zählt bewusst
    // NICHT — sonst wäre am Rundenende einfach tief zu stehen die beste
    // Strategie, und das ganze Spiel bestünde daraus, nie einzuzahlen.
    return { kind: "points", value: arcadePlayer.banked || 0, label: "Gold" };
  }
  if (arcade.family === "glide") {
    // Eine Zahl. Die Tore stecken schon drin, samt Zugabe für die Mitte.
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "climb") {
    return arcadePlayer.finishedAt
      ? { kind: "time", value: arcadePlayer.finishMs, label: "Gipfelzeit" }
      : { kind: "points", value: arcadePlayer.rung || 0, label: "Sprossen" };
  }
  return null;
}

// Bots get a believable skill profile: reaction delay, error rate and
// timing spread instead of perfect play.
function botProfile(arcadePlayer, seedHint = 0) {
  if (!arcadePlayer.botProfile) {
    const roll = Math.random() + seedHint * 0;
    arcadePlayer.botProfile = roll < 0.33
      ? { level: "easy", reactionMs: 900, mistake: 0.3, spreadMs: 650 }
      : roll < 0.75
        ? { level: "normal", reactionMs: 550, mistake: 0.16, spreadMs: 340 }
        : { level: "hard", reactionMs: 300, mistake: 0.07, spreadMs: 160 };
  }
  return arcadePlayer.botProfile;
}

// Alle verbundenen Menschen im Raum. Bots und getrennte Geräte zählen nicht —
// sonst könnte eine Runde nie weitergehen, weil jemand das Handy weggelegt hat.
function humansInRoom(room) {
  return room.players.filter((player) => !player.isBot && player.connected !== false);
}

function continueAfterResult(room) {
  if (room.status !== "result") return;

  if (room.afterMinigameAction === "returnLobby") {
    room.status = "lobby";
    room.phase = "lobby";
    room.afterMinigameAction = null;
    room.currentMinigame = null;
    room.lastMessage = "Zurück in der Lobby — sucht euch das nächste Minispiel aus.";
    emitRoom(room);
    return;
  }

  if (room.afterMinigameAction === "nextArcadeRound") {
    room.arcadeRoundIndex += 1;
    if (room.arcadeRoundIndex >= room.arcadePlan.length) {
      finishGame(room);
      emitRoom(room);
      return;
    }
    const nextType = room.arcadePlan[room.arcadeRoundIndex];
    startMinigame(room, `Runde ${room.arcadeRoundIndex + 1} von ${room.arcadePlan.length}`, "nextArcadeRound", nextType);
    emitRoom(room);
    return;
  }

  if (room.afterMinigameAction === "returnBoard") {
    room.status = "board";
    room.phase = "waitingRoll";
    room.afterMinigameAction = null;
    room.lastMessage = `${getCurrentPlayer(room)?.name || "Nächster Spieler"} ist am Zug.`;
    emitRoom(room);
    return;
  }

  if (room.afterMinigameAction === "completeRound") {
    if (room.round >= room.maxRounds) {
      finishGame(room);
      emitRoom(room);
      return;
    }
    room.round += 1;
    room.currentTurnIndex = 0;
    room.status = "board";
    room.phase = "waitingRoll";
    room.lastMessage = `Runde ${room.round} startet.`;
    emitRoom(room);
    return;
  }

  room.status = "board";
  room.phase = "waitingRoll";
  room.afterMinigameAction = null;
  advanceTurn(room);
}

function finishGame(room) {
  room.status = "end";
  room.phase = "finished";
  if (room.mode === "arcade") {
    const standings = [...room.players].sort((a, b) => (b.wins - a.wins) || (b.coins - a.coins));
    const leader = standings[0];
    room.winnerIds = room.players
      .filter((player) => player.wins === leader?.wins)
      .map((player) => player.id);
    room.lastMessage = "Die meisten Siege gewinnen den Marathon.";
    return;
  }
  awardBonusStars(room);
  const standings = [...room.players].sort(compareStanding);
  const leader = standings[0];
  room.winnerIds = room.players
    .filter((player) => player.stars === leader?.stars && player.coins === leader?.coins)
    .map((player) => player.id);
  room.lastMessage = "Die meisten Sterne gewinnen.";
}

// Stars decide the game; coins only break ties. This is what turns coins from
// a score into a currency you spend.
function compareStanding(a, b) {
  return (b.stars - a.stars) || (b.coins - a.coins);
}

// End-of-game bonus stars. Two categories so a player who never reached a star
// pad still has something to play for right to the last roll — and so a runaway
// leader can still be caught on the final reveal.
function awardBonusStars(room) {
  const bonuses = [];
  const award = (player, stars, label) => {
    if (!player || stars <= 0) return;
    player.stars += stars;
    bonuses.push({ playerId: player.id, name: player.name, stars, label });
  };

  const richest = Math.max(...room.players.map((player) => player.coins));
  if (richest > 0) {
    room.players
      .filter((player) => player.coins === richest)
      .forEach((player) => award(player, BONUS_STAR_COINS, "Meiste Münzen"));
  }

  const mostWins = Math.max(...room.players.map((player) => player.wins || 0));
  if (mostWins > 0) {
    room.players
      .filter((player) => (player.wins || 0) === mostWins)
      .forEach((player) => award(player, BONUS_STAR_WINS, "Meiste Challenge-Siege"));
  }

  room.bonusStars = bonuses;
  return bonuses;
}

function createCanopyState(players, startedAt) {
  const leaves = [{ level: 0, side: "center", bend: 0 }];
  let previousSide = Math.random() > 0.5 ? "left" : "right";
  let runLength = 0;
  for (let level = 1; level <= 18; level += 1) {
    let side = Math.random() > 0.5 ? "left" : "right";
    if (side === previousSide) runLength += 1;
    else runLength = 1;
    if (runLength > 2) {
      side = previousSide === "left" ? "right" : "left";
      runLength = 1;
    }
    leaves.push({
      level,
      side,
      bend: Number((Math.random() * 0.34 - 0.17).toFixed(3))
    });
    previousSide = side;
  }

  const canopy = {
    goal: leaves.length - 1,
    leaves,
    players: {},
    actionCounter: 0,
    lastMistake: null
  };
  players.forEach((player) => {
    canopy.players[player.id] = {
      level: 0,
      maxLevel: 0,
      correct: 0,
      mistakes: 0,
      score: 0,
      motion: null,
      finishedAt: null,
      finishMs: null
    };
  });
  return canopy;
}

function handleCanopyInput(room, player, input) {
  const minigame = room.currentMinigame;
  const canopy = minigame?.canopy;
  const climber = canopy?.players?.[player.id];
  if (!canopy || !climber) return { ok: false, error: "Vine-Vault-Zustand fehlt." };
  if (input.action !== "left" && input.action !== "right") {
    return { ok: false, error: "Wähle links oder rechts." };
  }
  const now = Date.now();
  if (climber.finishedAt) return { ok: true };
  const lastInput = minigame.lastInputAt[player.id] || 0;
  if (now - lastInput < 45) return { ok: true };
  minigame.lastInputAt[player.id] = now;
  const nextLevel = Math.min(canopy.goal, climber.level + 1);
  const expectedSide = canopy.leaves[nextLevel]?.side;
  canopy.actionCounter += 1;

  if (input.action === expectedSide) {
    const from = climber.level;
    climber.level = nextLevel;
    climber.maxLevel = Math.max(climber.maxLevel, nextLevel);
    climber.correct += 1;
    if (nextLevel >= canopy.goal) {
      climber.finishedAt = now;
      climber.finishMs = Math.max(0, now - minigame.startedAt);
    }
    climber.motion = {
      id: canopy.actionCounter,
      type: "jump",
      from,
      to: nextLevel,
      side: input.action,
      startedAt: now,
      duration: 170
    };
    return { ok: true, correct: true };
  }

  const from = climber.level;
  const fallback = nearestLowerCanopyLeaf(canopy, from, input.action);
  const distance = Math.max(1, from - fallback);
  const duration = Math.min(430, 170 + distance * 48);
  climber.level = fallback;
  climber.motion = {
    id: canopy.actionCounter,
    type: "fall",
    from,
    to: fallback,
    side: input.action,
    startedAt: now,
    duration
  };
  climber.mistakes += 1;
  canopy.lastMistake = { playerId: player.id, side: input.action, at: now, id: canopy.actionCounter };
  return { ok: true, correct: false };
}

function nearestLowerCanopyLeaf(canopy, fromLevel, side) {
  for (let level = Math.max(0, fromLevel - 1); level > 0; level -= 1) {
    if (canopy.leaves[level]?.side === side) return level;
  }
  return 0;
}

function updateCanopyClimb(room) {
  const minigame = room.currentMinigame;
  const canopy = minigame?.canopy;
  if (!canopy || minigame.type !== "canopyClimb") return;
  const now = Date.now();

  room.players.forEach((player) => {
    const climber = canopy.players[player.id];
    if (!climber) return;
    if (climber.motion && now >= climber.motion.startedAt + climber.motion.duration) {
      climber.motion = null;
    }
    climber.score = canopyRaceScore(climber);
    minigame.scores[player.id] = climber.score;
    player.minigameScore = climber.score;
  });
}

function canopyRaceScore(climber) {
  if (climber.finishedAt) return 100000 - Math.min(99999, climber.finishMs || 0);
  return Math.max(0, climber.level * 1000 + climber.maxLevel * 10 - climber.mistakes);
}

function maybeFinishCanopy(room) {
  const canopy = room.currentMinigame?.canopy;
  if (!canopy || room.currentMinigame?.type !== "canopyClimb") return false;
  if (!room.players.length || !room.players.every((player) => canopy.players[player.id]?.finishedAt)) return false;
  finishMinigame(room);
  return true;
}

function canopyBotStep(room, bot) {
  const canopy = room.currentMinigame?.canopy;
  const climber = canopy?.players?.[bot.id];
  if (!canopy || !climber || climber.finishedAt) return;
  const expected = canopy.leaves[Math.min(canopy.goal, climber.level + 1)]?.side || "left";
  const action = Math.random() > 0.12 ? expected : (expected === "left" ? "right" : "left");
  handleCanopyInput(room, bot, { action });
  updateCanopyClimb(room);
  maybeFinishCanopy(room);
}

function createFluxState(players, startedAt) {
  const starts = [[1, 1], [7, 7], [7, 1], [1, 7]];
  const flux = {
    size: FLUX_SIZE,
    blocked: FLUX_BLOCKED.map((cell) => [...cell]),
    grid: Array.from({ length: FLUX_SIZE }, () => Array(FLUX_SIZE).fill(null)),
    players: {},
    actionCounter: 0,
    lastAction: null
  };

  players.forEach((player, index) => {
    const [x, y] = starts[index % starts.length];
    flux.players[player.id] = {
      x,
      y,
      territory: 0,
      bumps: 0,
      bursts: 0,
      nextBurstAt: startedAt + 650,
      lastMoveAt: startedAt
    };
    paintFluxCell(flux, player.id, x, y);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      paintFluxCell(flux, player.id, x + dx, y + dy);
    });
  });
  return flux;
}

function handleFluxInput(room, player, input) {
  const minigame = room.currentMinigame;
  const flux = minigame?.flux;
  const fluxPlayer = flux?.players?.[player.id];
  if (!flux || !fluxPlayer) return { ok: false, error: "Flux-Spieler nicht gefunden." };

  const action = input.action;
  const directions = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
  };
  const now = Date.now();

  if (action === "burst") {
    if (now < fluxPlayer.nextBurstAt) return { ok: true };
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        paintFluxCell(flux, player.id, fluxPlayer.x + dx, fluxPlayer.y + dy);
      }
    }

    Object.entries(flux.players).forEach(([otherId, other]) => {
      if (otherId === player.id) return;
      const deltaX = other.x - fluxPlayer.x;
      const deltaY = other.y - fluxPlayer.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 1) return;
      const pushX = other.x + Math.sign(deltaX || (Math.random() > 0.5 ? 1 : -1));
      const pushY = other.y + Math.sign(deltaY);
      if (!isFluxBlocked(flux, pushX, pushY) && !fluxPlayerAt(flux, pushX, pushY, otherId)) {
        other.x = pushX;
        other.y = pushY;
        paintFluxCell(flux, otherId, pushX, pushY);
      }
      fluxPlayer.bumps += 1;
    });

    fluxPlayer.bursts += 1;
    fluxPlayer.nextBurstAt = now + FLUX_BURST_COOLDOWN;
    markFluxAction(flux, player.id, action, fluxPlayer.x, fluxPlayer.y, now);
    return { ok: true };
  }

  const direction = directions[action];
  if (!direction) return { ok: false, error: "Ungültiger Flux-Floor-Input." };
  if (now - fluxPlayer.lastMoveAt < FLUX_MOVE_COOLDOWN) return { ok: true };
  fluxPlayer.lastMoveAt = now;

  const [dx, dy] = direction;
  const targetX = fluxPlayer.x + dx;
  const targetY = fluxPlayer.y + dy;
  if (isFluxBlocked(flux, targetX, targetY)) return { ok: true };

  const occupantEntry = Object.entries(flux.players)
    .find(([otherId, other]) => otherId !== player.id && other.x === targetX && other.y === targetY);
  if (occupantEntry) {
    const [otherId, other] = occupantEntry;
    const pushX = targetX + dx;
    const pushY = targetY + dy;
    if (!isFluxBlocked(flux, pushX, pushY) && !fluxPlayerAt(flux, pushX, pushY, otherId)) {
      other.x = pushX;
      other.y = pushY;
    } else {
      other.x = fluxPlayer.x;
      other.y = fluxPlayer.y;
    }
    paintFluxCell(flux, otherId, other.x, other.y);
    fluxPlayer.bumps += 1;
  }

  fluxPlayer.x = targetX;
  fluxPlayer.y = targetY;
  paintFluxCell(flux, player.id, targetX, targetY);
  markFluxAction(flux, player.id, action, targetX, targetY, now);
  return { ok: true };
}

function updateFluxFloor(room) {
  const minigame = room.currentMinigame;
  if (!minigame || minigame.type !== "fluxFloor") return;
  refreshFluxScores(room);
}

function refreshFluxScores(room) {
  const minigame = room.currentMinigame;
  const flux = minigame?.flux;
  if (!flux || minigame.type !== "fluxFloor") return;

  const territory = {};
  flux.grid.forEach((row) => row.forEach((ownerId) => {
    if (ownerId) territory[ownerId] = (territory[ownerId] || 0) + 1;
  }));

  room.players.forEach((player) => {
    const fluxPlayer = flux.players[player.id];
    if (!fluxPlayer) return;
    fluxPlayer.territory = territory[player.id] || 0;
    minigame.scores[player.id] = fluxPlayer.territory;
    player.minigameScore = minigame.scores[player.id];
  });
}

function fluxBotStep(room, bot) {
  const minigame = room.currentMinigame;
  const flux = minigame?.flux;
  const fluxPlayer = flux?.players?.[bot.id];
  if (!fluxPlayer) return;

  const now = Date.now();
  const nearbyRival = Object.entries(flux.players).some(([id, other]) => (
    id !== bot.id && Math.max(Math.abs(other.x - fluxPlayer.x), Math.abs(other.y - fluxPlayer.y)) <= 1
  ));
  if (now >= fluxPlayer.nextBurstAt && (nearbyRival || Math.random() > 0.72)) {
    handleFluxInput(room, bot, { action: "burst" });
    refreshFluxScores(room);
    return;
  }

  let target = null;
  let bestDistance = Infinity;
  flux.grid.forEach((row, y) => row.forEach((ownerId, x) => {
    if (ownerId === bot.id || isFluxBlocked(flux, x, y)) return;
    const distance = Math.abs(x - fluxPlayer.x) + Math.abs(y - fluxPlayer.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      target = { x, y };
    }
  }));

  let action = pick(["up", "down", "left", "right"]);
  if (target && Math.random() > 0.18) {
    const dx = target.x - fluxPlayer.x;
    const dy = target.y - fluxPlayer.y;
    if (Math.abs(dx) > Math.abs(dy)) action = dx < 0 ? "left" : "right";
    else if (dy !== 0) action = dy < 0 ? "up" : "down";
  }
  handleFluxInput(room, bot, { action });
  refreshFluxScores(room);
}

function paintFluxCell(flux, playerId, x, y) {
  if (isFluxBlocked(flux, x, y)) return false;
  const previousOwner = flux.grid[y][x];
  if (previousOwner === playerId) return false;
  flux.grid[y][x] = playerId;
  return true;
}

function fluxPlayerAt(flux, x, y, ignoredId = null) {
  return Object.entries(flux.players)
    .some(([playerId, player]) => playerId !== ignoredId && player.x === x && player.y === y);
}

function isFluxBlocked(flux, x, y) {
  if (x < 0 || x >= flux.size || y < 0 || y >= flux.size) return true;
  return flux.blocked.some(([blockedX, blockedY]) => blockedX === x && blockedY === y);
}

function markFluxAction(flux, playerId, action, x, y, at) {
  flux.actionCounter += 1;
  flux.lastAction = { id: flux.actionCounter, playerId, action, x, y, at };
}

function createArenaState(players, startedAt) {
  const arena = {
    radius: ARENA_RADIUS,
    ballRadius: ARENA_BALL_RADIUS,
    lastUpdateAt: startedAt,
    tick: 0,
    players: {}
  };
  players.forEach((player, index) => {
    const angle = (index / Math.max(1, players.length)) * Math.PI * 2 - Math.PI / 2;
    arena.players[player.id] = {
      x: Math.cos(angle) * 0.5,
      y: Math.sin(angle) * 0.5,
      vx: 0,
      vy: 0,
      thrustX: 0,
      thrustY: 0,
      lastThrustAt: 0,
      inPlay: true,          // on the plate and collidable
      ejecting: false,       // cleared the rim, tumbling off
      launchedUntil: 0,      // recently rammed hard -> rim lets you fly off
      outUntil: 0,           // respawns when now passes this
      invulnUntil: startedAt + ARENA_INVULN_MS,
      score: 0,
      playMs: 0,             // accumulated time in play (for the result card)
      knockouts: 0,
      falls: 0,
      lastHitBy: null,
      lastHitAt: 0,
      collisionCount: 0,
      lastCollisionAt: 0,
      knockedAt: 0,          // bumps the client into a tumble animation
      spawnedAt: startedAt,
      outAt: null
    };
  });
  return arena;
}

function handleArenaInput(room, player, rawInput) {
  const minigame = room.currentMinigame;
  const arenaPlayer = minigame?.arena?.players?.[player.id];
  if (!arenaPlayer) return { ok: false, error: "Arena nicht bereit." };
  if (!arenaPlayer.inPlay) return { ok: true }; // still respawning — ignore, don't error

  // Wie in handleArcadeInput: die Regelschicht darf sich nicht auf das `|| {}`
  // der Socket-Schicht verlassen, sie wird auch direkt gerufen.
  const input = (rawInput && typeof rawInput === "object") ? rawInput : {};
  const now = Date.now();
  const action = input.action;

  // Analog stick: a direction vector in [-1, 1]. Stored as a steering
  // intent and applied continuously by the physics step for a short window.
  if (action === "thrust") {
    let dx = inputNumber(input.x) || 0;
    let dy = inputNumber(input.y) || 0;
    const length = Math.hypot(dx, dy);
    if (length > 1) { dx /= length; dy /= length; }
    arenaPlayer.thrustX = dx;
    arenaPlayer.thrustY = dy;
    arenaPlayer.lastThrustAt = now;
    return { ok: true };
  }

  // Backward-compatible 4-way fallback (bots / old clients).
  if (action === "up" || action === "down" || action === "left" || action === "right") {
    arenaPlayer.thrustX = action === "left" ? -1 : action === "right" ? 1 : 0;
    arenaPlayer.thrustY = action === "up" ? -1 : action === "down" ? 1 : 0;
    arenaPlayer.lastThrustAt = now;
    return { ok: true };
  }

  return { ok: false, error: "Ungültiger Bounce-Arena-Input." };
}

function resolveArenaCollision(entryA, entryB, now = Date.now()) {
  const [idA, a] = entryA;
  const [idB, b] = entryB;
  if (!a.inPlay || !b.inPlay) return;
  // Spawn grace: invulnerable balls pass through so nobody gets spawn-camped.
  if (now < a.invulnUntil || now < b.invulnUntil) return;

  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  const minDistance = ARENA_BALL_RADIUS * 2;
  if (distance >= minDistance) return;

  if (distance < 0.0001) {
    dx = 0.01;
    dy = 0;
    distance = 0.01;
  }

  const nx = dx / distance;
  const ny = dy / distance;

  // Separate the overlap so balls stay solid (no clipping / sinking through).
  const overlap = (minDistance - distance) / 2;
  a.x -= nx * overlap;
  a.y -= ny * overlap;
  b.x += nx * overlap;
  b.y += ny * overlap;

  // Equal-mass collision along the contact normal with a bouncy restitution.
  const relVel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (relVel < 0) {
    const jn = -(1 + ARENA_RESTITUTION) * relVel / 2;
    a.vx -= jn * nx;
    a.vy -= jn * ny;
    b.vx += jn * nx;
    b.vy += jn * ny;
    // A solid hit "launches" both balls: for a short window the rim will let
    // them fly off. Gentle nudges stay below the threshold and just bounce.
    if (jn >= ARENA_LAUNCH_IMPULSE) {
      a.launchedUntil = now + ARENA_LAUNCH_MS;
      b.launchedUntil = now + ARENA_LAUNCH_MS;
    }
  }

  a.lastHitBy = idB;
  b.lastHitBy = idA;
  a.lastHitAt = now;
  b.lastHitAt = now;
  if (now - a.lastCollisionAt > 120) a.collisionCount += 1;
  if (now - b.lastCollisionAt > 120) b.collisionCount += 1;
  a.lastCollisionAt = now;
  b.lastCollisionAt = now;
}

function arenaBotStep(arena, playerId) {
  const bot = arena?.players?.[playerId];
  if (!bot?.inPlay) return;

  const now = Date.now();
  const distanceFromCenter = Math.hypot(bot.x, bot.y);
  // Im Ergebnis zählt Überleben (+100000) weit mehr als Abschüsse. Wer bis kurz
  // vor den Rand jagt, verliert damit — gemessen gewann die „aggressivste"
  // Einstellung nur 9 % der Partien, die vorsichtigste 49 %. Die Rollen standen
  // also genau verkehrt herum. Können heisst hier: angreifen, wenn es günstig
  // steht, und sonst in der Mitte bleiben.
  const profile = bot.arenaProfile || (bot.arenaProfile = (() => {
    const roll = Math.random();
    return roll < 0.33 ? { edge: 0.9, aggro: 0.72, picks: false }
      : roll < 0.75 ? { edge: 0.8, aggro: 0.9, picks: true }
        : { edge: 0.68, aggro: 1, picks: true };
  })());

  // Too close to the rim yourself: retreat toward the middle.
  let targetX = -bot.x;
  let targetY = -bot.y;

  if (distanceFromCenter < ARENA_RADIUS * profile.edge) {
    const opponents = Object.entries(arena.players)
      .filter(([id, candidate]) => id !== playerId && candidate.inPlay && now >= candidate.invulnUntil)
      .map(([_id, candidate]) => candidate);
    let prey = null;
    if (profile.picks) {
      // Wer selbst schon nah am Rand steht, ist mit einem Stoss draussen. Nähe
      // zählt weiter mit, aber weniger als die Lage des Gegners — sonst rennt man
      // dem nächstbesten hinterher, der sicher in der Mitte sitzt.
      let best = -Infinity;
      opponents.forEach((candidate) => {
        const rim = Math.hypot(candidate.x, candidate.y);
        const reach = Math.hypot(candidate.x - bot.x, candidate.y - bot.y);
        const value = rim - reach * 0.55;
        if (value > best) {
          best = value;
          prey = candidate;
        }
      });
    } else {
      opponents.sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y));
      prey = opponents[0];
    }
    if (prey) {
      // Aim past the rival, along the line from the arena centre outward, so
      // the ram shoves them toward the nearest rim rather than across the plate.
      const outLen = Math.max(0.05, Math.hypot(prey.x, prey.y));
      const aimX = prey.x + (prey.x / outLen) * 0.45;
      const aimY = prey.y + (prey.y / outLen) * 0.45;
      targetX = aimX - bot.x;
      targetY = aimY - bot.y;
    }
  }

  const length = Math.max(0.01, Math.hypot(targetX, targetY));
  bot.thrustX = (targetX / length) * profile.aggro;
  bot.thrustY = (targetY / length) * profile.aggro;
  bot.lastThrustAt = now;
}

function createArcadeState(type, players, startedAt) {
  const config = ARCADE_CONFIGS[type];
  const arcade = {
    type,
    family: config.family,
    // Startzeitpunkt am Zustand: einige Ergebnisse rechnen in Sekunden ab
    // Rundenbeginn, und die kennen das Minispiel-Objekt nicht.
    startedAt,
    mode: config.steerMode || config.targetMode || config.kineticMode || config.directMode || null,
    seed: config.seed,
    beatMs: config.beatMs || null,
    choiceDelay: config.choiceDelay || 0,
    periodMs: config.periodMs || null,
    timingTarget: config.target ?? null,
    timingWindow: config.timingWindow || null,
    dynamicTiming: Boolean(config.dynamicTiming),
    spawnMs: config.spawnMs || null,
    cueIndex: -1,
    cue: "left",
    cueAt: startedAt,
    target: { x: 0.5, y: 0.46, index: 0, changedAt: startedAt },
    targets: [],
    hazards: [],
    drops: [],
    sweepAngle: 0,
    zoneWidth: 0.16,
    nextTargetId: 1,
    lastSpawnAt: startedAt - (config.spawnMs || 0),
    lastUpdateAt: startedAt,
    players: {}
  };

  players.forEach((player, index) => {
    const angle = (index / Math.max(1, players.length)) * Math.PI * 2 - Math.PI / 2;
    arcade.players[player.id] = {
      x: 0.5 + Math.cos(angle) * 0.22,
      y: 0.5 + Math.sin(angle) * 0.2,
      desiredX: 0.5,
      vx: 0,
      vy: 0,
      score: 0,
      streak: 0,
      successes: 0,
      mistakes: 0,
      activeMs: 0,
      lastCueIndex: -1,
      lastTimingCycle: -1,
      lastInputAt: 0,
      lastHitAt: 0,
      hasMoved: false,
      flash: null,
      hitTargets: {},
      inside: false,
      collisionUntil: 0
    };
  });

  if (config.steerMode === "collect") relocateArcadeTarget(arcade);
  if (config.steerMode === "avoid") {
    arcade.hazards = Array.from({ length: 4 }, (_, index) => ({
      id: index,
      x: 0.2 + arcadeNoise(config.seed + index * 7) * 0.6,
      y: 0.18 + arcadeNoise(config.seed + index * 11 + 3) * 0.58,
      vx: (arcadeNoise(config.seed + index * 13 + 5) - 0.5) * 0.34,
      vy: (arcadeNoise(config.seed + index * 17 + 9) - 0.5) * 0.34,
      radius: 0.055 + (index % 2) * 0.012
    }));
  }
  if (config.kineticMode === "sweep") {
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const angle = index / Math.max(1, players.length) * Math.PI * 2 - Math.PI / 2;
      entry.x = 0.5 + Math.cos(angle) * 0.23;
      entry.y = 0.5 + Math.sin(angle) * 0.23;
    });
    relocateArcadeTarget(arcade);
  }
  if (config.kineticMode === "course") {
    arcade.hazards = Array.from({ length: 7 }, (_, index) => ({
      id: index,
      x: 0.12 + arcadeNoise(config.seed + index * 19) * 0.76,
      y: -0.08 + index * 0.17,
      speed: 0.15 + arcadeNoise(config.seed + index * 31 + 7) * 0.12,
      radius: 0.055 + (index % 3) * 0.009,
      wraps: 0
    }));
  }
  if (config.directMode) {
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.x = 0.5;
      entry.y = 0.78;
      entry.desiredX = 0.5;
    });
  }
  if (config.family === "plinko") {
    // Logical space is 1 wide and PLINKO_FLOOR_Y tall so client pixels can
    // use one uniform scale on both axes (collisions look exact on screen).
    arcade.pegs = [];
    for (let row = 0; row < 5; row += 1) {
      const count = row % 2 === 0 ? 6 : 5;
      for (let index = 0; index < count; index += 1) {
        arcade.pegs.push({
          x: (index + (row % 2 === 0 ? 0.5 : 1)) / 6,
          y: 0.32 + row * 0.19,
          r: 0.024
        });
      }
    }
    arcade.floorY = PLINKO_FLOOR_Y;
    arcade.slots = [...PLINKO_SLOTS];
    arcade.balls = [];
    arcade.nextBallId = 1;
    arcade.nudgePower = PLINKO_NUDGE;
    players.forEach((player, index) => {
      arcade.players[player.id].aimX = 0.2 + index * 0.2;
      arcade.players[player.id].plinks = 0;
      arcade.players[player.id].nudges = 0;
    });
  }
  if (config.family === "curling") {
    // Logical sheet is 1 wide and CURLING_SHEET_Y tall (uniform scale, see plinko).
    arcade.house = { x: 0.5, y: 0.3 };
    arcade.sheetY = CURLING_SHEET_Y;
    arcade.rings = CURLING_RINGS.map((ring) => ({ ...ring }));
    arcade.stones = [];
    arcade.nextStoneId = 1;
    arcade.clacks = 0;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      entry.stonesLeft = CURLING_STONES_PER_PLAYER;
      entry.startX = 0.2 + index * 0.2;
    });
  }
  if (config.family === "stopclock") {
    // A fresh random target every game, from 4s up to a 12s maximum.
    arcade.targetMs = Math.round(4000 + arcadeNoise(config.seed + Date.now() % 997) * 8000);
    arcade.hideAfterMs = 2000;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.stoppedMs = null;
      entry.deviationMs = null;
    });
  }
  if (config.family === "runner") {
    arcade.trackLength = RUNNER_LENGTH;
    arcade.rows = createRunnerCourse(config.seed);
    arcade.shots = [];
    arcade.nextShotId = 1;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.lane = 1;
      entry.progress = 0;
      entry.nextRow = 0;
      entry.stumbleUntil = 0;
      entry.boostUntil = 0;
      entry.finishedAt = null;
      entry.finishMs = null;
      entry.stumbles = 0;
      entry.hasItem = false;
      entry.throwsHit = 0;
    });
  }
  if (config.family === "colorgrid") {
    arcade.gridSize = COLORGRID_SIZE;
    arcade.roundMs = COLORGRID_ROUND_MS;
    arcade.announceMs = COLORGRID_ANNOUNCE_MS;
    arcade.dropEndMs = COLORGRID_DROP_END_MS;
    arcade.leadMs = COLORGRID_LEAD_MS;
    arcade.roundCount = COLORGRID_ROUNDS;
    arcade.round = -1;
    arcade.phase = "announce";
    arcade.targetColor = 0;
    arcade.grid = [];
    const starts = [[1, 1], [4, 1], [1, 4], [4, 4]];
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const [gx, gy] = starts[index % starts.length];
      entry.gx = gx;
      entry.gy = gy;
      entry.fallenRound = -1;
      entry.eliminated = false;
      entry.survived = 0;
    });
    advanceColorRound(arcade, 0, startedAt);
  }
  if (config.family === "redlight") {
    arcade.goal = REDLIGHT_GOAL;
    arcade.phases = buildRedlightPhases(config.seed, 60000);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.progress = 0;
      entry.lastRunAt = 0;
      entry.caught = 0;
      entry.penalizedPhase = -1;
      entry.finishedAt = null;
      entry.finishMs = null;
    });
  }
  if (config.family === "wave") {
    arcade.jumpMs = WAVE_JUMP_MS;
    arcade.waves = buildWaveSchedule(config.seed, 60000);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.jumpUntil = 0;
      entry.eliminated = false;
      entry.survived = 0;
    });
  }
  if (config.family === "pump") {
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.pumps = 0;
    });
  }
  if (config.family === "barrel") {
    arcade.limit = BARREL_LIMIT;
    arcade.phases = buildBarrelPhases(config.seed, 60000);
    arcade.barrelAngle = 0;
    arcade.barrelVel = 0;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.offset = 0;
      entry.lastRunAt = 0;
      entry.runDir = 0;
      entry.fallenAt = null;
      entry.survivedMs = 0;
    });
  }
  if (config.family === "catchfall") {
    arcade.fallMs = CATCH_FALL_MS;
    arcade.drops = buildCatchDrops(config.seed, 60000);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.lane = 1;
      entry.catches = 0;
      entry.bombs = 0;
    });
  }
  if (config.family === "whack") {
    // Salt the fixed per-game seed with time so the blobs pop in a fresh random
    // pattern every round instead of the identical fixed sequence.
    arcade.pops = buildWhackPops(config.seed + (Date.now() % 9973), 60000);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.hits = 0;
      entry.badHits = 0;
      entry.hitPopIds = {};
    });
  }
  if (config.family === "cannon") {
    arcade.periodMs = CANNON_PERIOD_MS;
    arcade.anglePeriodMs = CANNON_ANGLE_PERIOD_MS;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.launchedAt = null;
      entry.power = 0;
      entry.powerAt = null;
      entry.angle = null;
      entry.distance = 0;
    });
  }
  if (config.family === "simon") {
    arcade.rounds = buildSimonRounds(config.seed);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.currentRound = -1;
      entry.roundProgress = 0;
      entry.roundFailed = false;
      entry.survived = 0;
      entry.mistakes = 0;
    });
  }
  if (config.family === "react") {
    arcade.rounds = buildReactRounds(config.seed);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.times = [];
    });
  }
  if (config.family === "bomb") {
    arcade.order = players.map((player) => player.id);
    arcade.holderId = arcade.order[Math.floor(arcadeNoise(config.seed) * arcade.order.length)] || null;
    arcade.holderSince = startedAt;
    arcade.canPassAt = startedAt;
    arcade.fuseMs = bombFuseMs(config.seed, 0);
    arcade.fuseAt = startedAt + arcade.fuseMs;
    // The fuse length is shown for a moment after each pass, then hidden.
    arcade.revealUntil = startedAt + BOMB_REVEAL_MS;
    arcade.explosions = 0;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.outAt = null;
      entry.passes = 0;
    });
  }
  if (config.family === "knife") {
    // Turn-based like the mobile knife game: one player is active at a time
    // with a 10s window to stick knives into the shared spinning disc.
    arcade.order = players.map((player) => player.id);
    arcade.turnIndex = 0;
    arcade.activeId = arcade.order[0] || null;
    arcade.turnPos = 1;                  // der Erste steht schon auf Position 0
    arcade.round = 0;
    arcade.rounds = knifeRoundsFor(players.length);
    arcade.turnMs = knifeTurnMs(0);
    arcade.turnEndsAt = startedAt + arcade.turnMs;
    arcade.spinSpeed = KNIFE_SPIN_START;
    arcade.logAngle = 0;
    arcade.knives = [];                  // { angleDeg, playerId }
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.stuck = 0;
      entry.clashes = 0;                 // Fehlwürfe auf ein anderes Messer
      entry.precision = 0;               // Summe: Wurf gemessen am bestmöglichen
      entry.posSum = 0;                  // bisherige Plätze in der Wurfreihenfolge
      entry.eliminated = false;          // beim zweiten Fehlwurf → raus
      entry.turnDone = false;            // has had their throwing window
    });
  }
  if (config.family === "stack") {
    arcade.total = STACK_BLOCKS;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      entry.height = 0;
      entry.width = 1;                   // current top-block width (0..1)
      entry.offset = 0;                  // logical x-centre of the tower
      entry.dir = index % 2 === 0 ? 1 : -1;
      entry.phase = arcadeNoise(config.seed + index * 7);
      entry.toppled = false;
      entry.perfects = 0;
    });
  }
  if (config.family === "feint") {
    arcade.signals = buildFeintSignals(config.seed, FEINT_DURATION_MS);
    arcade.growMs = FEINT_GROW_MS;
    arcade.holdMs = FEINT_HOLD_MS;
    arcade.maxPoints = FEINT_MAX_POINTS;
    arcade.falseStartCost = FEINT_FALSE_START;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.hits = 0;
      entry.falseStarts = 0;
      entry.missed = 0;
      entry.bestMs = null;
      entry.boldest = 1;          // kleinster Radius, bei dem ein Treffer sass
      entry.handled = {};              // Signalindex -> true (einmal pro Signal)
      entry.lockUntil = 0;             // Sperre nach einem Fehlgriff
      entry.lastReact = null;          // { kind, points, reactionMs, at }
    });
  }
  if (config.family === "trace") {
    arcade.tolerance = TRACE_TOLERANCE;
    arcade.lapPoints = TRACE_LAP_POINTS;
    arcade.slipCost = TRACE_SLIP_COST;
    arcade.gemPoints = TRACE_GEM_POINTS;
    arcade.gemReach = TRACE_GEM_REACH;
    arcade.narrowMin = TRACE_NARROW_MIN;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.lap = 0;
      entry.progress = 0;              // 0 unten … 1 oben auf der aktuellen Spur
      entry.brushDown = false;         // liegt der Finger auf der Spur?
      entry.slips = 0;
      entry.lapsDone = 0;
      entry.cleanLaps = 0;             // Runden ohne einen einzigen Abrutscher
      entry.lapSlips = 0;
      entry.lockUntil = 0;
      entry.brushX = tracePathX(config.seed, 0, 0);
      entry.gems = buildTraceGems(config.seed, 0);
      entry.gemsTaken = {};            // Index -> true, EINMAL je Kristall
      entry.gemsTotal = 0;
      entry.lastGemAt = 0;
      entry.brushY = 0;
      entry.lastAdvanceAt = startedAt;
      entry.lastSlipAt = 0;
      entry.lastLapAt = 0;
    });
  }
  if (config.family === "belt") {
    arcade.chuteCount = BELT_CHUTES;
    arcade.colourCount = BELT_COLOURS;
    arcade.queueLength = BELT_QUEUE;
    arcade.parcelGap = BELT_GAP;
    // Der Farbplan der Rutschen gilt für ALLE gleich und steht von Anfang an
    // fest: derselbe Ablauf für jeden, und der Client kann den nächsten Tausch
    // ankündigen, ohne raten zu müssen.
    arcade.chutePlan = buildBeltChutePlan(config.seed, BELT_DURATION_MS);
    arcade.chutes = arcade.chutePlan[0].chutes;
    arcade.swapIndex = 0;
    arcade.speed = BELT_SPEED_START;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.sorted = 0;
      entry.wrong = 0;
      entry.missed = 0;
      entry.streak = 0;
      entry.bestStreak = 0;
      entry.beltPos = 0;             // wie weit das vorderste Paket gelaufen ist
      entry.nextParcel = 0;
      entry.reachable = false;
      // Jede Person bekommt ihre EIGENE Paketfolge aus demselben Startwert —
      // gleiche Schwierigkeit, aber man kann nicht beim Nachbarn ablesen.
      entry.parcelSeed = config.seed + hashBeltSeed(player.id);
      entry.queue = Array.from({ length: BELT_QUEUE }, () =>
        makeBeltParcel(arcade, entry.parcelSeed, entry.nextParcel++));
      entry.lastSortAt = 0;
      entry.lastVerdict = null;
    });
  }
  if (config.family === "estimate") {
    arcade.rounds = buildEstimateRounds(config.seed);
    arcade.resolvedRound = -1;
    arcade.lastReveal = null;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.guess = null;              // Schätzung des laufenden Durchgangs
      entry.guesses = [];              // { round, guess, count, error, points }
      entry.bullseyes = 0;
      entry.totalError = 0;
    });
  }
  if (config.family === "seek") {
    arcade.size = SEEK_SIZE;
    arcade.basePoints = SEEK_BASE_POINTS;
    arcade.probeCost = SEEK_PROBE_COST;
    arcade.minPoints = SEEK_MIN_POINTS;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      // Jede Person sucht auf ihrem EIGENEN Feld. Ein gemeinsames Feld wäre ein
      // Rennen, in dem der erste Fund die Arbeit für alle erledigt — und wer
      // gerade langsamer tippt, bekäme das Ergebnis geschenkt. Gleiche Aufgabe,
      // getrennte Bretter: dann zählt wirklich, wer besser kombiniert.
      entry.seekSeed = config.seed + hashSeekSeed(player.id);
      entry.round = 0;
      entry.found = 0;
      entry.probes = [];               // { x, y, steps }
      entry.totalProbes = 0;
      entry.bestProbes = null;         // wenigste Tipps für einen Fund
      entry.lastFind = null;
      entry.gem = seekGemFor(entry.seekSeed, 0);
    });
  }
  if (config.family === "paint") {
    arcade.cols = PAINT_COLS;
    arcade.rows = PAINT_ROWS;
    arcade.grid = new Array(PAINT_COLS * PAINT_ROWS).fill(null);
    arcade.charge = new Array(PAINT_COLS * PAINT_ROWS).fill(0);
    arcade.pickups = [];
    arcade.nextPickupAt = startedAt + PAINT_PICKUP_EVERY_MS;
    arcade.nextPickupId = 1;
    arcade.tileSecondPoints = PAINT_TILE_SECOND_POINTS;
    // Startplätze in den vier Ecken: niemand hat einen Anfangsvorteil, und jeder
    // sieht sofort, wo er steht.
    const corners = [
      [1, 1],
      [PAINT_COLS - 2, 1],
      [1, PAINT_ROWS - 2],
      [PAINT_COLS - 2, PAINT_ROWS - 2]
    ];
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const [col, row] = corners[index % corners.length];
      entry.px = col + 0.5;
      entry.py = row + 0.5;
      entry.vx = 0;
      entry.vy = 0;
      entry.dirX = 0;
      entry.dirY = 0;
      entry.wide = false;
      entry.boostUntil = 0;
      entry.claimed = 0;
      entry.owned = 0;
      entry.tileSeconds = 0;        // die eigentliche Wertung
      entry.bumps = 0;
      entry.lastBumpAt = 0;
      entry.lastPickupAt = 0;
      arcade.grid[paintIndex(col, row)] = player.id;
      arcade.charge[paintIndex(col, row)] = 1;
    });
  }
  if (config.family === "fish") {
    arcade.tensionCalm = FISH_TENSION_CALM;
    arcade.tensionSurge = FISH_TENSION_SURGE;
    arcade.reelSpeed = FISH_REEL_SPEED;
    arcade.species = FISH_SPECIES;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.catchIndex = 0;
      entry.species = fishSpeciesFor(config.seed, 0);
      entry.phases = buildFishPhases(config.seed, 0, FISH_DURATION_MS, entry.species);
      entry.caught = [];               // Arten-IDs der gelandeten Fische
      entry.snapLoss = 0;
      entry.hookedAt = startedAt;      // Beginn des aktuellen Fisches
      entry.distance = 1;              // 1 = weit weg, 0 = gelandet
      entry.tension = 0;
      entry.holding = false;
      entry.surging = false;
      entry.lastReelAt = 0;
      entry.landed = 0;
      entry.snaps = 0;
      entry.pauseUntil = 0;
      entry.lastSnapAt = 0;
      entry.lastLandedAt = 0;
      entry.bestDistance = 1;
    });
  }
  if (config.family === "bounce") {
    arcade.beatStartMs = BOUNCE_BEAT_START_MS;
    arcade.barBeats = BOUNCE_BAR_BEATS;
    arcade.tempos = BOUNCE_TEMPOS.slice();
    arcade.perfectMs = BOUNCE_PERFECT_MS;
    arcade.goodMs = BOUNCE_GOOD_MS;
    arcade.maxHeight = BOUNCE_MAX_HEIGHT;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.height = 0;
      entry.best = 0;
      entry.streak = 0;
      entry.bestStreak = 0;
      entry.perfects = 0;
      entry.misses = 0;
      entry.lastBeatIndex = -1;        // je Schlag nur ein Versuch
      entry.lastTap = null;            // { beat, offsetMs, grade, at }
    });
  }
  if (config.family === "sumo") {
    arcade.stone = { x: 0, y: 0, vx: 0, vy: 0 };
    arcade.ringRadius = SUMO_RING_RADIUS;
    arcade.hitsOut = SUMO_HITS_OUT;
    arcade.chargeMs = SUMO_CHARGE_MS;
    arcade.zone = SUMO_ZONE;
    arcade.recoverMs = SUMO_RECOVER_MS;
    // Der Stein steht nie still. Lag er in der Mitte, hatte niemand ihn im
    // Viertel, also stiess niemand, also blieb er liegen — gemessen kam eine
    // ganze Runde ohne einen einzigen Stoss zustande.
    serveSumoStone(arcade, config.seed);
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      // Gleichmässig im Kreis; der Winkel ist auch die Stossrichtung.
      const angle = (index / Math.max(1, players.length)) * Math.PI * 2 - Math.PI / 2;
      entry.angle = angle;
      // Jede Person läuft ein bisschen anders schnell um den Ring. Liefen alle
      // gleich schnell, drehte sich nur die ganze Welt und die Abstände blieben
      // gleich — dann bliebe auch die Senke, wo sie war.
      entry.orbit = SUMO_ORBIT_BASE + index * SUMO_ORBIT_SPREAD;
      entry.spotX = Math.cos(angle);
      entry.spotY = Math.sin(angle);
      entry.chargeStart = null;        // Zeitpunkt des Drückens
      entry.lastShove = null;          // { power, at, slipped }
      entry.shoves = 0;
      entry.recoverUntil = 0;
      entry.whiffs = 0;
      entry.eliminatedMs = 0;
      entry.hits = 0;
      entry.blocks = 0;
      entry.lastBlockAt = 0;
      entry.eliminated = false;
    });
  }
  if (config.family === "dive") {
    arcade.baseGain = DIVE_BASE_GAIN;
    arcade.stepGain = DIVE_STEP_GAIN;
    arcade.maxDepth = DIVE_MAX_DEPTH;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.depth = 0;                 // 0 = an der Oberfläche
      entry.carried = 0;               // Beute, die noch im Schacht hängt
      entry.banked = 0;                // eingezahlt und sicher
      entry.dives = 0;
      entry.collapses = 0;
      entry.deepest = 0;
      entry.busyUntil = 0;             // gräbt, taucht auf oder liegt benommen
      entry.busyKind = null;
      entry.lastDive = null;
      entry.nextRisk = diveRiskAt(config.seed, 0, 1);
      entry.nextGain = diveGain(1);
    });
  }
  if (config.family === "glide") {
    // Der Kurs steht von Anfang an fest und gilt für ALLE gleich. Zwei Gründe:
    // niemand bekommt ein leichteres Feld, und der Client kann die nächsten
    // Tore schon zeichnen, statt sie erst beim Auftauchen zu erfahren.
    arcade.gates = buildGlideGates(config.seed, GLIDE_DURATION_MS);
    arcade.gateCount = arcade.gates.length;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      entry.y = 0.5;                   // Höhenanteil, 0 = Boden, 1 = Decke
      entry.vy = 0;
      entry.holding = false;
      entry.stallUntil = 0;
      entry.gatesPassed = 0;
      entry.gatesMissed = 0;
      entry.perfect = 0;               // durch die Mitte
      entry.nextGate = 0;
      entry.bumps = 0;
      entry.lastGate = null;
      entry.lane = index;
    });
  }
  if (config.family === "climb") {
    arcade.height = CLIMB_HEIGHT;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.rung = 0;                    // rungs climbed
      entry.nextSide = arcadeNoise(config.seed + 1) > 0.5 ? 1 : -1;
      entry.slips = 0;
      entry.finishedAt = null;
      entry.finishMs = null;
    });
  }
  return arcade;
}

// The barrel keeps switching direction and rolls faster over time.
function buildBarrelPhases(seed, totalMs) {
  const phases = [];
  let at = 2000;
  let index = 0;
  let sign = arcadeNoise(seed) > 0.5 ? 1 : -1;
  phases.push({ from: 0, until: at, vel: 0 });
  while (at < totalMs) {
    const length = 1250 + arcadeNoise(seed + index * 13) * 1150;
    // A short calm start, then a livelier ramp so it stays exciting.
    const ramp = Math.min(1, index * 0.07);
    // Die spaeten Schuebe sind SCHNELLER als man laufen kann. Genau daran haengt
    // das ganze Spiel: in einem schnellen Schub kann man den Rutsch nur
    // verlangsamen, nicht umkehren — man muss vorher Platz gesammelt haben.
    // Blieben alle Schuebe unter der Laufgeschwindigkeit, koennte man jede Lage
    // jederzeit retten, und gemessen ueberlebten dann 120 von 120 Bots die
    // volle Runde: ein Spiel ganz ohne Einsatz.
    const magnitude = 0.5 + ramp * 1.9 + arcadeNoise(seed + index * 19) * 0.25;
    // Mostly alternate, sometimes double up in the same direction for surprise.
    if (arcadeNoise(seed + index * 29) > 0.28) sign = -sign;
    phases.push({ from: at, until: at + length, vel: sign * magnitude });
    at += length;
    index += 1;
  }
  return phases;
}

function barrelPhaseAt(arcade, elapsed) {
  for (let index = 0; index < arcade.phases.length; index += 1) {
    const phase = arcade.phases[index];
    if (elapsed < phase.until) return phase;
  }
  return arcade.phases[arcade.phases.length - 1];
}

// The fuse is always a whole number of seconds, picked fresh each round from
// a small pool so the reveal shows a clean "10s" rather than "9.7s".
function bombFuseMs(seed, round) {
  const minSecs = Math.round(BOMB_MIN_FUSE_MS / 1000);
  const maxSecs = Math.round(BOMB_MAX_FUSE_MS / 1000);
  const span = maxSecs - minSecs + 1;
  const secs = minSecs + Math.floor(arcadeNoise(seed + round * 31 + Date.now() % 131) * span);
  return secs * 1000;
}

// Coins, gems and bombs rain thick and fast into three lanes; sometimes two
// drops land at once so you have to read the board and pick the better lane.
function buildCatchDrops(seed, totalMs) {
  const drops = [];
  let at = 2200;
  let index = 0;
  let id = 1;
  while (at < totalMs) {
    const roll = arcadeNoise(seed + index * 29);
    const kind = roll < 0.2 ? "bomb" : (roll > 0.86 ? "gem" : "coin");
    const lane = Math.floor(arcadeNoise(seed + index * 13) * 3);
    drops.push({ id: id++, catchAt: Math.round(at), lane, kind, processed: false });
    // Every so often a second drop in a different lane on the same beat.
    if (index > 4 && arcadeNoise(seed + index * 53) > 0.62) {
      const otherLane = (lane + 1 + Math.floor(arcadeNoise(seed + index * 61) * 2)) % 3;
      const otherRoll = arcadeNoise(seed + index * 67);
      drops.push({
        id: id++,
        catchAt: Math.round(at),
        lane: otherLane,
        kind: otherRoll < 0.35 ? "bomb" : "coin",
        processed: false
      });
    }
    at += Math.max(360, 720 - index * 14) + arcadeNoise(seed + index * 41) * 200;
    index += 1;
  }
  return drops;
}

// Blobs pop out of the 3x3 holes — some are spiky troublemakers.
function buildWhackPops(seed, totalMs) {
  const pops = [];
  let at = 2500;
  let index = 0;
  let lastCell = -1;
  while (at < totalMs) {
    let cell = Math.floor(arcadeNoise(seed + index * 17) * WHACK_CELLS);
    if (cell === lastCell) cell = (cell + 1 + Math.floor(arcadeNoise(seed + index * 23) * (WHACK_CELLS - 1))) % WHACK_CELLS;
    lastCell = cell;
    // A calmer pace than before: blobs stay up longer and spawn less often.
    const upMs = 1150 - Math.min(280, index * 7);
    pops.push({
      id: index + 1,
      from: Math.round(at),
      until: Math.round(at + upMs),
      cell,
      kind: arcadeNoise(seed + index * 37) < 0.18 ? "bad" : "good"
    });
    at += Math.max(560, 920 - index * 8) + arcadeNoise(seed + index * 43) * 220;
    index += 1;
  }
  return pops;
}

// Farbfolge rounds: watch the growing colour sequence, then repeat it.
// Fünf Runden, nicht acht, und straffer getaktet. Acht Runden nach der alten
// Formel brauchten 87 Sekunden — für ein Partyspiel ist das eine halbe Ewigkeit,
// in der drei Leute zuschauen. Fünf Runden von zwei auf sechs Farben passen in
// 36 Sekunden und reichen völlig: ab sechs merkt sich das ohnehin kaum jemand.
function buildSimonRounds(seed) {
  const rounds = [];
  let at = 1000;
  for (let r = 0; r < SIMON_ROUNDS; r += 1) {
    const seqLen = 2 + r;
    const sequence = Array.from({ length: seqLen }, (_v, i) => Math.floor(arcadeNoise(seed + r * 97 + i * 13) * 4));
    const showMs = seqLen * 520 + 500;
    const inputMs = seqLen * 760 + 700;
    rounds.push({ index: r, sequence, showFrom: at, inputFrom: at + showMs, until: at + showMs + inputMs });
    at += showMs + inputMs + 400;
  }
  return rounds;
}

function simonRoundAt(arcade, elapsed) {
  return arcade.rounds.find((round) => elapsed >= round.showFrom && elapsed < round.until) || null;
}

// Blitzfang rounds: the lamp turns green at a secret moment.
function buildReactRounds(seed) {
  return Array.from({ length: REACT_ROUNDS }, (_v, i) => ({
    index: i,
    armFrom: 2000 + i * 4600,
    greenAt: Math.round(2000 + i * 4600 + 1200 + arcadeNoise(seed + i * 53) * 2200)
  }));
}

// Alternating green/red windows, deterministic per seed. Index 0 is green.
function buildRedlightPhases(seed, totalMs) {
  const phases = [];
  let at = 0;
  let index = 0;
  while (at < totalMs) {
    const green = 1500 + arcadeNoise(seed + index * 13) * 1300;
    const red = 1000 + arcadeNoise(seed + index * 19) * 900;
    phases.push({ kind: "green", from: at, until: at + green });
    phases.push({ kind: "red", from: at + green, until: at + green + red });
    at += green + red;
    index += 1;
  }
  return phases;
}

function redlightPhaseAt(arcade, elapsed) {
  for (let index = 0; index < arcade.phases.length; index += 1) {
    const phase = arcade.phases[index];
    if (elapsed < phase.until) return { ...phase, index };
  }
  return { ...arcade.phases[arcade.phases.length - 1], index: arcade.phases.length - 1 };
}

// Waves roll in faster and faster, deterministic per seed.
function buildWaveSchedule(seed, totalMs) {
  const waves = [];
  let at = WAVE_FIRST_AT;
  let index = 0;
  while (at < totalMs) {
    // Direction flips every few passes, but always with a full swing before
    // the hit so the timing is identical and fair.
    const dir = Math.floor(index / 3) % 2 === 0 ? 1 : -1;
    waves.push({ hitAt: Math.round(at), dir, processed: false });
    // A gentler, steadier ramp so the speed-up feels moderate.
    const gap = Math.max(WAVE_MIN_GAP, 2900 - index * 110) + arcadeNoise(seed + index * 23) * 500;
    at += gap;
    index += 1;
  }
  return waves;
}

// Same course for every player: at each row at least one lane stays free,
// so the track is always beatable and fair.
function createRunnerCourse(seed) {
  const rows = [];
  let position = 14;
  let index = 0;
  // Kisten und Booster REIHUM auf die Bahnen verteilen statt zufällig. Bei
  // zufälliger Wahl konnte eine Bahn über eine ganze Strecke deutlich mehr
  // abbekommen — wer dort lief, hatte ohne eigenes Zutun mehr Würfe.
  let laneCursor = Math.floor(arcadeNoise(seed + 5) * 3);
  const giveLane = () => {
    laneCursor = (laneCursor + 1) % 3;
    return laneCursor;
  };
  while (position < RUNNER_LENGTH - 10) {
    const roll = arcadeNoise(seed + index * 17);
    if (roll < 0.1) {
      // Occasional breather with a boost pad.
      rows.push({ position, kind: "boost", lane: giveLane() });
    } else if (roll < 0.38) {
      // Pickup orb: grab it to throw a straight tumble-shot down your lane.
      rows.push({ position, kind: "item", lane: giveLane() });
    } else if (roll < 0.56) {
      // Log blocks two adjacent lanes.
      const freeLane = Math.floor(arcadeNoise(seed + index * 29) * 3);
      rows.push({ position, kind: "log", freeLane });
    } else if (roll < 0.66) {
      // Slider oscillates between two lanes; the third lane is always safe.
      const baseLane = Math.floor(arcadeNoise(seed + index * 31) * 2);
      rows.push({ position, kind: "slider", baseLane, phase: arcadeNoise(seed + index * 37) * Math.PI * 2 });
    } else {
      rows.push({ position, kind: "cone", lane: Math.floor(arcadeNoise(seed + index * 41) * 3) });
    }
    // Denser spacing than before so there is more to dodge.
    position += 3.8 + arcadeNoise(seed + index * 43) * 2.2;
    index += 1;
  }
  return rows;
}

function runnerBlockedLanes(row, now) {
  if (row.kind === "cone") return [row.lane];
  if (row.kind === "log") return [0, 1, 2].filter((lane) => lane !== row.freeLane);
  if (row.kind === "slider") {
    return [row.baseLane + (Math.sin(now / 650 + row.phase) > 0 ? 1 : 0)];
  }
  return [];
}

// Vorwarnzeit und Zahl der sicheren Felder je Runde. Beides schrumpft, damit aus
// „hinlaufen" gegen Ende „sofort loslaufen und den kürzesten Weg finden" wird.
function colorGridAnnounceMs(round) {
  return Math.max(COLORGRID_ANNOUNCE_MIN_MS, COLORGRID_ANNOUNCE_MS - round * COLORGRID_ANNOUNCE_STEP_MS);
}

function colorGridSafeTiles(round) {
  return Math.max(COLORGRID_SAFE_MIN, COLORGRID_SAFE_START - round * 2);
}

function advanceColorRound(arcade, round, now) {
  arcade.round = round;
  arcade.phase = "announce";
  arcade.roundStartedAt = now;
  arcade.announceMs = colorGridAnnounceMs(round);
  arcade.dropEndMs = arcade.announceMs + COLORGRID_DROP_MS;
  arcade.targetColor = Math.floor(arcadeNoise(arcade.seed + round * 53) * 4);
  // Erst alles mit anderen Farben füllen — so ist die Zahl der sicheren Felder
  // gesetzt und nicht dem Zufall überlassen.
  arcade.grid = Array.from({ length: COLORGRID_SIZE * COLORGRID_SIZE }, (_cell, index) => {
    const roll = Math.floor(arcadeNoise(arcade.seed + round * 61 + index * 7) * 3);
    return (arcade.targetColor + 1 + roll) % 4;
  });
  const safe = colorGridSafeTiles(round);
  let placed = 0;
  for (let probe = 0; placed < safe && probe < arcade.grid.length * 6; probe += 1) {
    const slot = Math.floor(arcadeNoise(arcade.seed + round * 67 + probe * 11) * arcade.grid.length);
    if (arcade.grid[slot] === arcade.targetColor) continue;
    arcade.grid[slot] = arcade.targetColor;
    placed += 1;
  }
}

function handleArcadeInput(room, player, rawInput) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  const arcadePlayer = arcade?.players?.[player.id];
  if (!arcade || !arcadePlayer) return { ok: false, error: "Arcade-Spiel nicht bereit." };

  // 28 Familien lesen hier Felder aus `input`. Die Socket-Schicht schiebt schon
  // ein `|| {}` davor, aber die Regelschicht darf sich darauf nicht verlassen:
  // sie wird auch von den Bots und den Tests direkt gerufen, und ein Wurf hier
  // fliegt mitten im Tick — der nimmt die ganze Partie mit, nicht nur den
  // Spieler, der den Unsinn geschickt hat.
  const input = (rawInput && typeof rawInput === "object") ? rawInput : {};


  const now = Date.now();
  const cooldowns = { dive: 90, steer: 55, kinetic: 55, direct: 42, plinko: 180, curling: 180, runner: 130, colorgrid: 150, stopclock: 60, redlight: 60, wave: 200, pump: 40, barrel: 60, bomb: 150, catchfall: 110, whack: 110, cannon: 200, simon: 160, react: 200, knife: 90, stack: 90, climb: 40, seek: 260, estimate: 40, glide: 0, sumo: 0, bounce: 0, feint: 0, trace: 45, belt: 90, fish: 60, paint: 55 };
  // sumo bewusst ohne Cooldown: Aufladen und Stossen sind ein Paar aus zwei
  // dicht aufeinanderfolgenden Ereignissen. Ein Cooldown blockte das `shove`
  // und liess den Ladezeitstempel hängen, wodurch der nächste, saubere Halt als
  // Überladen galt. Die Mechanik begrenzt sich selbst — man muss halten.
  // bounce und feint ebenso ohne Cooldown: dort IST der Tippzeitpunkt die
  // Wertung, ein Cooldown würde sie verschieben. Beide begrenzen sich selbst —
  // ein Versuch pro Schlag bzw. Sperre nach einem Fehlgriff.
  // belt mit kurzem Cooldown: ein Wisch darf nur EIN Paket einsortieren. Ohne
  // Sperre würde ein zittriger Wisch zwei Ereignisse liefern und das zweite
  // Paket blind mitreissen.
  // `lift` (Finger vom Bildschirm) ist keine Spielaktion, sondern eine Meldung,
  // und sie folgt der letzten Zugposition im Abstand von Millisekunden. Vom
  // Cooldown geschluckt hielte der Server den Strich für weiterhin unten — der
  // nächste Fingeraufsatz gälte dann als Abrutscher statt als Wiedereinstieg.
  const exempt = input.action === "lift";
  const cooldown = exempt ? 0 : (cooldowns[arcade.family] ?? 100);
  if (now - arcadePlayer.lastInputAt < cooldown) return { ok: true };
  if (!exempt) arcadePlayer.lastInputAt = now;

  if (arcade.family === "stopclock") {
    if (input.action !== "stop") return { ok: false, error: "Tippe, um die Uhr zu stoppen." };
    if (arcadePlayer.stoppedMs !== null) return { ok: true };
    const minigameStart = room.currentMinigame.startedAt;
    arcadePlayer.stoppedMs = Math.max(0, now - minigameStart);
    arcadePlayer.deviationMs = Math.abs(arcadePlayer.stoppedMs - arcade.targetMs);
    arcadePlayer.score = Math.max(0, 8000 - arcadePlayer.deviationMs);
    arcadePlayer.successes = 1;
    arcadePlayer.flash = arcadePlayer.deviationMs < 250 ? "good" : "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "redlight") {
    if (input.action !== "run") return { ok: false, error: "Halte den Knopf, um zu laufen." };
    if (arcadePlayer.finishedAt) return { ok: true };
    // Holding = a run ping this recent; the tick does the movement.
    arcadePlayer.lastRunAt = now;
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "wave") {
    if (input.action !== "jump") return { ok: false, error: "Tippe, um zu springen." };
    if (arcadePlayer.eliminated) return { ok: true };
    if (now < arcadePlayer.jumpUntil) return { ok: true };
    arcadePlayer.jumpUntil = now + WAVE_JUMP_MS;
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "pump") {
    if (input.action !== "pump") return { ok: false, error: "Tippe so schnell du kannst." };
    arcadePlayer.pumps += 1;
    arcadePlayer.score = arcadePlayer.pumps;
    arcadePlayer.hasMoved = true;
    if (arcadePlayer.pumps % 10 === 0) {
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
    }
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "barrel") {
    if (input.action !== "run") return { ok: false, error: "Halte links oder rechts, um zu laufen." };
    if (arcadePlayer.fallenAt) return { ok: true };
    arcadePlayer.lastRunAt = now;
    arcadePlayer.runDir = input.dir === -1 || input.dir === "-1" ? -1 : 1;
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "catchfall") {
    if (input.action !== "lane") return { ok: false, error: "Wechsle die Spur mit links/rechts." };
    const dir = input.dir === -1 || input.dir === "-1" ? -1 : 1;
    arcadePlayer.lane = clamp(arcadePlayer.lane + dir, 0, 2);
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "whack") {
    if (input.action !== "whack") return { ok: false, error: "Tippe auf das Feld mit dem Blob." };
    const cell = clamp(Math.round(inputNumber(input.cell) || 0), 0, WHACK_CELLS - 1);
    const elapsed = now - room.currentMinigame.startedAt;
    const pop = arcade.pops.find((candidate) =>
      candidate.cell === cell && elapsed >= candidate.from && elapsed <= candidate.until && !arcadePlayer.hitPopIds[candidate.id]);
    if (!pop) return { ok: true };
    arcadePlayer.hitPopIds[pop.id] = true;
    arcadePlayer.hasMoved = true;
    if (pop.kind === "bad") {
      arcadePlayer.badHits += 1;
      arcadePlayer.flash = "bad";
    } else {
      arcadePlayer.hits += 1;
      arcadePlayer.flash = "good";
    }
    arcadePlayer.lastHitAt = now;
    arcadePlayer.score = Math.max(0, arcadePlayer.hits * 10 - arcadePlayer.badHits * 4);
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "cannon") {
    if (input.action !== "launch") return { ok: false, error: "Tippe im richtigen Moment zum Abschuss." };
    if (arcadePlayer.launchedAt) return { ok: true };
    const elapsed = Math.max(0, now - room.currentMinigame.startedAt);

    // First tap locks the power, then the angle gauge starts sweeping.
    if (!arcadePlayer.powerAt) {
      const power = Math.abs(Math.sin((elapsed / arcade.periodMs) * Math.PI));
      arcadePlayer.power = Number(power.toFixed(3));
      arcadePlayer.powerAt = now;
      arcadePlayer.flash = power > 0.88 ? "good" : "bad";
      arcadePlayer.lastHitAt = now;
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }

    // Second tap locks the angle — real ballistics, 45° flies farthest.
    const angleT = Math.abs(Math.sin(((now - arcadePlayer.powerAt) / arcade.anglePeriodMs) * Math.PI));
    const angleDeg = Math.round(5 + angleT * 80);
    const angleRad = (angleDeg * Math.PI) / 180;
    arcadePlayer.angle = angleDeg;
    arcadePlayer.launchedAt = now;
    arcadePlayer.distance = Math.round(6 + arcadePlayer.power * arcadePlayer.power * Math.sin(2 * angleRad) * 94);
    arcadePlayer.score = arcadePlayer.distance;
    arcadePlayer.flash = Math.abs(angleDeg - 45) < 8 ? "good" : "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "simon") {
    if (input.action !== "color") return { ok: false, error: "Tippe die Farben in der gezeigten Reihenfolge." };
    const elapsed = now - room.currentMinigame.startedAt;
    const round = simonRoundAt(arcade, elapsed);
    if (!round || elapsed < round.inputFrom) return { ok: true };
    if (arcadePlayer.currentRound !== round.index) {
      arcadePlayer.currentRound = round.index;
      arcadePlayer.roundProgress = 0;
      arcadePlayer.roundFailed = false;
    }
    if (arcadePlayer.roundFailed || arcadePlayer.roundProgress >= round.sequence.length) return { ok: true };
    const picked = clamp(Math.round(inputNumber(input.index) || 0), 0, 3);
    if (picked === round.sequence[arcadePlayer.roundProgress]) {
      arcadePlayer.roundProgress += 1;
      arcadePlayer.hasMoved = true;
      if (arcadePlayer.roundProgress >= round.sequence.length) {
        arcadePlayer.survived += 1;
        arcadePlayer.flash = "good";
        arcadePlayer.lastHitAt = now;
      }
    } else {
      arcadePlayer.roundFailed = true;
      arcadePlayer.mistakes += 1;
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
    }
    arcadePlayer.score = arcadePlayer.survived * 1000 - arcadePlayer.mistakes;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "react") {
    if (input.action !== "tap") return { ok: false, error: "Tippe, sobald es grün wird." };
    const roundIndex = arcadePlayer.times.length;
    if (roundIndex >= arcade.rounds.length) return { ok: true };
    const round = arcade.rounds[roundIndex];
    const elapsed = now - room.currentMinigame.startedAt;
    if (elapsed < round.armFrom) return { ok: true };
    if (elapsed < round.greenAt) {
      // False start: a painful fixed penalty for this round.
      arcadePlayer.times.push(REACT_PENALTY_MS);
      arcadePlayer.flash = "bad";
    } else {
      arcadePlayer.times.push(Math.min(REACT_WINDOW_MS, Math.round(elapsed - round.greenAt)));
      arcadePlayer.flash = "good";
    }
    arcadePlayer.lastHitAt = now;
    arcadePlayer.hasMoved = true;
    arcadePlayer.score = arcadePlayer.times.reduce((sum, value) => sum + value, 0);
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "bomb") {
    if (input.action !== "pass") return { ok: false, error: "Tippe, um die Bombe weiterzugeben." };
    if (arcadePlayer.outAt) return { ok: true };
    if (arcade.holderId !== player.id) return { ok: true };
    if (now < arcade.canPassAt) return { ok: true };
    const alive = arcade.order.filter((id) => !arcade.players[id]?.outAt);
    if (alive.length <= 1) return { ok: true };
    const myIndex = alive.indexOf(player.id);
    arcade.holderId = alive[(myIndex + 1) % alive.length];
    arcade.holderSince = now;
    arcade.canPassAt = now + BOMB_PASS_LOCK_MS;
    // The fuse keeps ticking — passing moves the bomb but never resets the
    // timer. Only an explosion lights a fresh fuse.
    arcadePlayer.passes += 1;
    arcadePlayer.hasMoved = true;
    arcadePlayer.flash = "good";
    arcadePlayer.lastHitAt = now;
    return { ok: true };
  }

  if (arcade.family === "knife") {
    if (input.action !== "throw") return { ok: false, error: "Tippe, um das Messer zu werfen." };
    // Only the active thrower may throw, only during their own window.
    if (arcade.activeId !== player.id || arcadePlayer.eliminated || arcadePlayer.turnDone) return { ok: true };
    const angleDeg = ((arcade.logAngle * 180) / Math.PI) % 360;
    const normalized = (angleDeg + 360) % 360;
    // Collision if another knife already sits within the safety gap.
    const clash = arcade.knives.some((knife) => {
      const diff = Math.abs(((knife.angleDeg - normalized + 540) % 360) - 180);
      return diff < KNIFE_MIN_GAP_DEG;
    });
    if (clash) {
      // Das Messer prallt ab: die Runde ist vorbei, beim zweiten Mal die Partie.
      arcadePlayer.clashes = (arcadePlayer.clashes || 0) + 1;
      if (arcadePlayer.clashes >= KNIFE_LIVES) {
        arcadePlayer.eliminated = true;
        arcadePlayer.eliminatedAt = now;
      }
      arcadePlayer.turnDone = true;
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
      advanceKnifeTurn(room, room.currentMinigame, arcade, now);
    } else {
      // One knife per turn: a clean throw lands and immediately hands the
      // spinning log to the next player.
      // Feinwertung, damit nicht jede Partie unentschieden endet: bei drei
      // Runden kommt fast jeder starke Spieler auf dieselben drei Treffer.
      //
      // Vorher zählte hier die ENGE der Lücke ("Nerven"). Das war genau
      // verkehrt herum: das Spiel verlangt, in freien Raum zu werfen, die
      // Zugabe belohnte das Gegenteil. Wer sauber zielte, bekam WENIGER — die
      // beiden Regler zeigten in entgegengesetzte Richtungen und hoben sich
      // auf. Gemessen lagen "normal" und "hard" exakt gleichauf.
      //
      // Die blosse Lückengrösse taugt aber auch nicht: die Scheibe füllt sich,
      // also hat der erste Werfer jeder Runde strukturell mehr Platz. Gemessen
      // wird darum, wie nah der Wurf am BESTMÖGLICHEN dieses Augenblicks lag —
      // das ist Ausführung statt Gelegenheit und damit reihenfolgeneutral.
      let gap = 180;
      arcade.knives.forEach((knife) => {
        const diff = Math.abs(((knife.angleDeg - normalized + 540) % 360) - 180);
        if (diff < gap) gap = diff;
      });
      arcadePlayer.precision = (arcadePlayer.precision || 0)
        + clamp(gap / Math.max(1, knifeBestGap(arcade.knives)), 0, 1);
      arcade.knives.push({ angleDeg: normalized, playerId: player.id });
      arcadePlayer.stuck += 1;
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
      arcadePlayer.turnDone = true;
      advanceKnifeTurn(room, room.currentMinigame, arcade, now);
    }
    arcadePlayer.hasMoved = true;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "stack") {
    if (input.action !== "drop") return { ok: false, error: "Tippe, um den Block zu setzen." };
    if (arcadePlayer.toppled || arcadePlayer.height >= arcade.total) return { ok: true };
    // The sliding block's current x-centre (mirrors the client oscillation).
    const elapsed = now - room.currentMinigame.startedAt;
    const speed = 1.1 + arcadePlayer.height * 0.06;
    const swing = Math.sin(elapsed / 1000 * speed + arcadePlayer.phase * Math.PI * 2);
    const blockCentre = swing * (0.85 - arcadePlayer.height * 0.01);
    const overlapLeft = Math.max(arcadePlayer.offset - arcadePlayer.width / 2, blockCentre - arcadePlayer.width / 2);
    const overlapRight = Math.min(arcadePlayer.offset + arcadePlayer.width / 2, blockCentre + arcadePlayer.width / 2);
    const overlap = overlapRight - overlapLeft;
    if (overlap <= 0.02) {
      arcadePlayer.toppled = true;
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
    } else {
      const perfect = Math.abs(blockCentre - arcadePlayer.offset) < 0.05;
      arcadePlayer.width = perfect ? arcadePlayer.width : overlap;
      arcadePlayer.offset = (overlapLeft + overlapRight) / 2;
      arcadePlayer.height += 1;
      if (perfect) arcadePlayer.perfects += 1;
      arcadePlayer.score = arcadePlayer.height * 100 + arcadePlayer.perfects * 20;
      arcadePlayer.flash = perfect ? "good" : null;
      arcadePlayer.lastHitAt = now;
    }
    arcadePlayer.hasMoved = true;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "bounce") {
    if (input.action !== "jump") return { ok: false, error: "Tippe im Takt." };
    const elapsed = Math.max(0, now - room.currentMinigame.startedAt);
    const beat = bounceNearestBeat(elapsed);
    // Pro Schlag zählt nur der erste Versuch — sonst würde Dauerfeuer treffen.
    if (beat.index === arcadePlayer.lastBeatIndex) return { ok: true };
    arcadePlayer.lastBeatIndex = beat.index;

    const off = Math.abs(beat.offsetMs);
    let grade = "miss";
    if (off <= BOUNCE_PERFECT_MS) grade = "perfect";
    else if (off <= BOUNCE_GOOD_MS) grade = "good";

    if (grade === "miss") {
      arcadePlayer.streak = 0;
      arcadePlayer.misses += 1;
      const drop = BOUNCE_MISS_PENALTY + arcadePlayer.height * BOUNCE_MISS_SCALE;
      arcadePlayer.height = Math.max(0, arcadePlayer.height - drop);
      arcadePlayer.flash = "bad";
    } else {
      // Resonanz: jeder weitere Treffer in Folge zahlt mehr aus.
      arcadePlayer.streak += 1;
      arcadePlayer.bestStreak = Math.max(arcadePlayer.bestStreak, arcadePlayer.streak);
      if (grade === "perfect") arcadePlayer.perfects += 1;
      const base = grade === "perfect" ? BOUNCE_GAIN_PERFECT : BOUNCE_GAIN_GOOD;
      const resonance = 1 + Math.min(1.2, arcadePlayer.streak * 0.06);
      arcadePlayer.height = Math.min(BOUNCE_MAX_HEIGHT, arcadePlayer.height + base * resonance);
      arcadePlayer.flash = grade === "perfect" ? "good" : null;
    }
    arcadePlayer.best = Math.max(arcadePlayer.best, arcadePlayer.height);
    arcadePlayer.lastTap = { beat: beat.index, offsetMs: beat.offsetMs, grade, at: now };
    arcadePlayer.lastHitAt = now;
    arcadePlayer.score = Math.round(arcadePlayer.best * 100) + arcadePlayer.bestStreak * 25;
    arcadePlayer.hasMoved = true;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "feint") {
    if (input.action !== "react") return { ok: false, error: "Tippe nur beim echten Signal." };
    if (now < arcadePlayer.lockUntil) return { ok: true };     // noch gesperrt
    // Nach einem Treffer zittert der Daumen gern nach. Dieses Nachtippen darf
    // nicht als Fehlgriff zählen, sonst kostet jeder Treffer Punkte.
    const last = arcadePlayer.lastReact;
    if (last && last.kind === "go" && now - last.at < FEINT_DOUBLE_TAP_MS) return { ok: true };

    const elapsed = Math.max(0, now - room.currentMinigame.startedAt);
    const signal = activeFeintSignal(arcade.signals, elapsed);
    arcadePlayer.hasMoved = true;

    if (signal && signal.real) {
      if (arcadePlayer.handled[signal.index]) return { ok: true };
      arcadePlayer.handled[signal.index] = true;
      const reactionMs = Math.round(elapsed - signal.at);
      const radius = feintRadius(signal, reactionMs);
      const points = feintPoints(radius);
      arcadePlayer.hits += 1;
      arcadePlayer.score += points;
      arcadePlayer.bestMs = arcadePlayer.bestMs === null ? reactionMs : Math.min(arcadePlayer.bestMs, reactionMs);
      arcadePlayer.boldest = Math.min(arcadePlayer.boldest ?? 1, radius);
      arcadePlayer.lastReact = { kind: "go", points, reactionMs, radius, at: now };
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
      syncArcadeScore(room.currentMinigame, player, arcadePlayer);
      return { ok: true };
    }

    // Fehlgriff: entweder auf eine Fälschung getippt oder ins Leere. Beides
    // kostet Punkte und sperrt kurz. Der Abzug darf den Punktestand unter Null
    // drücken — syncArcadeScore blendet das für die Wertung bei 0 ab, aber ein
    // Dauertipper gräbt sich so tief ein, dass er sich nicht mehr erholt.
    const fake = signal ? "fake" : "early";
    if (signal) arcadePlayer.handled[signal.index] = true;
    arcadePlayer.falseStarts += 1;
    arcadePlayer.score -= FEINT_FALSE_START;
    arcadePlayer.lockUntil = now + FEINT_LOCK_MS;
    arcadePlayer.lastReact = {
      kind: fake,
      points: -FEINT_FALSE_START,
      reactionMs: null,
      radius: signal ? feintRadius(signal, elapsed - signal.at) : 0,
      at: now
    };
    arcadePlayer.flash = "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "estimate") {
    if (input.action !== "guess") return { ok: false, error: "Stell den Regler auf deine Schätzung." };
    const elapsed = Math.max(0, now - room.currentMinigame.startedAt);
    const round = estimateRoundAt(arcade, elapsed);
    if (!round) return { ok: true };
    if (elapsed < round.guessFrom) return { ok: false, error: "Erst schauen, dann schätzen." };
    if (elapsed >= round.revealFrom) return { ok: true };   // schon aufgelöst
    const value = Math.round(inputNumber(input.value));
    if (!Number.isFinite(value)) return { ok: false, error: "Das ist keine Zahl." };
    arcadePlayer.guess = clamp(value, round.low, round.high);
    arcadePlayer.hasMoved = true;
    arcadePlayer.lastHitAt = now;
    return { ok: true };
  }

  if (arcade.family === "seek") {
    if (input.action !== "probe") return { ok: false, error: "Tippe ein Feld an." };
    const x = Math.floor(inputNumber(input.x));
    const y = Math.floor(inputNumber(input.y));
    if (!Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= SEEK_SIZE || y >= SEEK_SIZE) {
      return { ok: false, error: "Dieses Feld gibt es nicht." };
    }
    // Ein zweites Mal auf dasselbe Feld ist kein Fehler, sondern ein Verrutscher
    // — es kostet nichts und verrät auch nichts Neues.
    if (arcadePlayer.probes.some((probe) => probe.x === x && probe.y === y)) return { ok: true };

    arcadePlayer.hasMoved = true;
    const steps = seekSteps(x, y, arcadePlayer.gem.x, arcadePlayer.gem.y);
    arcadePlayer.totalProbes += 1;

    if (steps === 0) {
      // Gefunden. Gewertet wird, wie WENIGE Tipps es gebraucht hat — die
      // Fundzahl allein würde blindes Abklappern genauso belohnen wie Denken.
      const used = arcadePlayer.probes.length + 1;
      const value = seekFindValue(arcadePlayer.probes.length);
      arcadePlayer.score += value;
      arcadePlayer.found += 1;
      arcadePlayer.successes += 1;
      if (arcadePlayer.bestProbes === null || used < arcadePlayer.bestProbes) {
        arcadePlayer.bestProbes = used;
      }
      arcadePlayer.lastFind = { x, y, probes: used, value, at: now };
      arcadePlayer.round += 1;
      arcadePlayer.probes = [];
      arcadePlayer.gem = seekGemFor(arcadePlayer.seekSeed, arcadePlayer.round);
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
      syncArcadeScore(room.currentMinigame, player, arcadePlayer);
      return { ok: true };
    }

    arcadePlayer.probes.push({ x, y, steps });
    arcadePlayer.flash = steps <= 2 ? "good" : null;
    arcadePlayer.lastHitAt = now;
    return { ok: true };
  }

  if (arcade.family === "paint") {
    if (input.action !== "steer") return { ok: false, error: "Lenke mit dem Stick." };
    const dx = inputNumber(input.x);
    const dy = inputNumber(input.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ok: false, error: "Ungültige Richtung." };
    // Nur die RICHTUNG wird übernommen, nicht die Länge über 1: sonst wäre ein
    // manipulierter Stick schneller als ein echter Daumen.
    const length = Math.hypot(dx, dy);
    const scale = length > 1 ? 1 / length : 1;
    arcadePlayer.dirX = dx * scale;
    arcadePlayer.dirY = dy * scale;
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "fish") {
    if (input.action !== "reel") return { ok: false, error: "Halte den Knopf, um einzuholen." };
    if (now < arcadePlayer.pauseUntil) return { ok: true };
    // Halten heisst: es kam gerade ein Ping. Der Tick macht die Arbeit — so
    // hängt die Spannung an der Zeit und nicht an der Ping-Rate des Geräts.
    arcadePlayer.lastReelAt = now;
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "belt") {
    if (input.action !== "sort") return { ok: false, error: "Wisch das Paket in eine Rutsche." };
    const chute = Math.floor(inputNumber(input.chute));
    if (!Number.isInteger(chute) || chute < 0 || chute >= BELT_CHUTES) return { ok: false, error: "Diese Rutsche gibt es nicht." };
    const parcel = arcadePlayer.queue[0];
    if (!parcel) return { ok: true };
    // Ganz am Anfang des Bandes greift man ins Leere: das Paket muss erst in die
    // Reichweite fahren. Ohne diese Sperre koennte man blind vorsortieren.
    if (arcadePlayer.beltPos < BELT_REACH_AT) return { ok: true };

    arcadePlayer.hasMoved = true;
    const wanted = arcade.chutes[chute];
    if (wanted === parcel.colour) {
      arcadePlayer.streak += 1;
      if (arcadePlayer.streak > arcadePlayer.bestStreak) arcadePlayer.bestStreak = arcadePlayer.streak;
      const bonus = Math.min(arcadePlayer.streak, BELT_STREAK_MAX) * BELT_STREAK_BONUS;
      arcadePlayer.score += BELT_POINTS + bonus;
      arcadePlayer.sorted += 1;
      arcadePlayer.lastVerdict = { kind: "good", chute, colour: parcel.colour, at: now, bonus };
    } else {
      arcadePlayer.streak = 0;
      arcadePlayer.score = Math.max(0, arcadePlayer.score - BELT_WRONG_COST);
      arcadePlayer.wrong += 1;
      arcadePlayer.lastVerdict = { kind: "wrong", chute, colour: parcel.colour, at: now, bonus: 0 };
    }
    arcadePlayer.lastSortAt = now;
    advanceBeltQueue(arcade, arcadePlayer);
    return { ok: true };
  }


  if (arcade.family === "trace") {
    // Finger hoch: der Strich reisst ab, aber ohne Abzug. Der Fortschritt bleibt
    // stehen, und der Wiedereinstieg muss an der Bruchstelle passieren.
    if (input.action === "lift") {
      arcadePlayer.brushDown = false;
      return { ok: true };
    }
    if (input.action !== "trace") return { ok: false, error: "Zieh den Finger über die Spur." };
    if (now < arcadePlayer.lockUntil) return { ok: true };

    const x = clamp(inputNumber(input.x), 0, 1);
    const y = clamp(inputNumber(input.y), 0, 1);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Ungültige Position." };
    arcadePlayer.hasMoved = true;
    arcadePlayer.brushX = x;
    arcadePlayer.brushY = y;

    const offset = traceOffset(arcade.seed, arcadePlayer.lap, x, y);
    // Die Toleranz hängt jetzt von der STELLE ab: an den Engstellen wird es
    // schmal. Das gibt der Runde einen Rhythmus, statt überall gleich schwer zu
    // sein.
    const tolerance = traceToleranceAt(arcade.seed, arcadePlayer.lap, y);
    const onPath = offset <= tolerance;

    // Wiedereinstieg nach einem Abriss: nur dort, wo der Strich endete. Sonst
    // liesse sich die Spur überspringen, statt sie zu ziehen.
    if (!arcadePlayer.brushDown) {
      if (!onPath || Math.abs(y - arcadePlayer.progress) > TRACE_REENTRY_WINDOW) return { ok: true };
      arcadePlayer.brushDown = true;
      arcadePlayer.lastAdvanceAt = now;
      return { ok: true };
    }

    if (!onPath) {
      arcadePlayer.brushDown = false;
      arcadePlayer.slips += 1;
      arcadePlayer.lapSlips += 1;
      arcadePlayer.lockUntil = now + TRACE_SLIP_LOCK_MS;
      arcadePlayer.lastSlipAt = now;
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
      arcadePlayer.score = traceScore(arcadePlayer);
      syncArcadeScore(room.currentMinigame, player, arcadePlayer);
      return { ok: true };
    }

    const elapsedMs = Math.max(1, now - arcadePlayer.lastAdvanceAt);
    const speedRoom = (elapsedMs / 1000) * TRACE_MAX_SPEED;

    // Der Finger darf dem Strich nicht davonlaufen. Ohne diese Regel liess sich
    // die Spur überspringen: Finger auf den obersten Punkt der Kurve setzen und
    // halten — der Abstand wird ja auf DESSEN Höhe gemessen, also war man "auf
    // der Spur", und der Strich kroch mit Höchsttempo hinterher. Eine ganze
    // Runde in 1.7 Sekunden, ohne die Kurve je nachgefahren zu haben.
    // Der Spielraum wächst mit der Zeit seit der letzten Eingabe, damit ein
    // verschluckter Zwischenwert keinen Abriss auslöst; Tempo gewinnt das nicht,
    // denn das Vorrücken bleibt unabhängig davon gedeckelt.
    const leadLimit = TRACE_STEP_LIMIT + speedRoom;
    if (y > arcadePlayer.progress + leadLimit) {
      arcadePlayer.brushDown = false;
      arcadePlayer.slips += 1;
      arcadePlayer.lapSlips += 1;
      arcadePlayer.lockUntil = now + TRACE_SLIP_LOCK_MS;
      arcadePlayer.lastSlipAt = now;
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
      arcadePlayer.score = traceScore(arcadePlayer);
      syncArcadeScore(room.currentMinigame, player, arcadePlayer);
      return { ok: true };
    }

    // Rückwärts oder auf der Stelle ist erlaubt und ändert nichts — nur nach
    // vorne zählt, und das begrenzt durch Sprungweite UND Tempo.
    const allowed = Math.min(TRACE_STEP_LIMIT, speedRoom);
    if (y > arcadePlayer.progress) {
      arcadePlayer.progress = Math.min(arcadePlayer.progress + allowed, y);
      arcadePlayer.lastAdvanceAt = now;
    }

    // Kristalle: einmal je Kristall, entschieden am Abstand des Fingers. Nicht
    // pro Tick gewürfelt und nicht mehrfach zählbar.
    arcadePlayer.gems.forEach((gem) => {
      if (arcadePlayer.gemsTaken[gem.index]) return;
      if (Math.abs(y - gem.t) > TRACE_GEM_REACH) return;
      // Seitlicher Abstand zur MITTELLINIE vergleichen, nicht rohe x-Werte.
      const lateral = x - tracePathX(arcade.seed, arcadePlayer.lap, y);
      if (Math.abs(lateral - gem.offset) > TRACE_GEM_REACH) return;
      arcadePlayer.gemsTaken[gem.index] = true;
      arcadePlayer.gemsTotal += 1;
      arcadePlayer.lastGem = { index: gem.index, x: gem.x, t: gem.t, at: now };
      arcadePlayer.lastGemAt = now;
    });

    if (arcadePlayer.progress >= 0.995 && arcadePlayer.lap < TRACE_MAX_LAPS) {
      // Runde geschafft: neue Kurve, Finger muss unten neu ansetzen.
      arcadePlayer.lapsDone += 1;
      if (arcadePlayer.lapSlips === 0) arcadePlayer.cleanLaps += 1;
      arcadePlayer.lapSlips = 0;
      arcadePlayer.lap += 1;
      arcadePlayer.progress = 0;
      arcadePlayer.brushDown = false;
      arcadePlayer.gems = buildTraceGems(arcade.seed, arcadePlayer.lap);
      arcadePlayer.gemsTaken = {};
      arcadePlayer.lastLapAt = now;
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
    }

    arcadePlayer.score = traceScore(arcadePlayer);
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "sumo") {
    if (arcadePlayer.eliminated) return { ok: true };
    if (input.action === "charge") {
      // Solange man noch ausholt, lässt sich nicht laden. Das ist der Preis für
      // den letzten Stoss und der Grund, warum Dauerdrücken hier nicht mehr die
      // beste Antwort auf alles ist.
      if (now < arcadePlayer.recoverUntil) return { ok: true };
      // Ein laufender Ladevorgang wird nicht zurückgesetzt, damit ein doppeltes
      // Drücken den Balken nicht zurückwirft. Ein VERALTETER Ladevorgang schon:
      // bei einem kurzen Antippen können `shove` und `charge` in vertauschter
      // Reihenfolge eintreffen, wodurch ein Zeitstempel hängen blieb und der
      // nächste Halt mit Sekunden Vorlauf sofort als Überladen galt.
      if (arcadePlayer.chargeStart === null) arcadePlayer.chargeStart = now;
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }
    if (input.action !== "shove") return { ok: false, error: "Halten zum Aufladen, loslassen zum Stossen." };
    if (arcadePlayer.chargeStart === null) return { ok: true };

    const held = now - arcadePlayer.chargeStart;
    arcadePlayer.chargeStart = null;
    if (held < SUMO_MIN_CHARGE_MS) return { ok: true };       // nur angetippt

    // Kein Überladen mehr. Halten IST die Verteidigung: wer geladen dasteht, kann
    // im richtigen Moment zurückschlagen. Eine Strafe fürs Halten machte
    // Abwarten unmöglich und zwang alle in einen Dauertakt aus Laden und
    // Danebenstossen.

    const power = Math.min(1, held / SUMO_CHARGE_MS);

    // Reichweite: der Stein muss in der eigenen Richtung schon weit genug
    // draussen sein. Ins Leere gestossen kostet es Ladung und Ausholzeit.
    const reach = (arcade.stone.x * arcadePlayer.spotX + arcade.stone.y * arcadePlayer.spotY)
      / Math.max(1e-6, arcade.ringRadius);
    if (reach < SUMO_ZONE) {
      arcadePlayer.whiffs = (arcadePlayer.whiffs || 0) + 1;
      arcadePlayer.recoverUntil = now + SUMO_RECOVER_MS;
      arcadePlayer.lastShove = { power, meet: 0, at: now, slipped: false, whiffed: true };
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }

    // Konter: läuft der Stein gerade auf meinen Platz zu, trifft der Stoss ihn
    // frontal und trägt weiter.
    const speed = Math.hypot(arcade.stone.vx, arcade.stone.vy);
    const closing = speed < 1e-4
      ? 0
      : (arcade.stone.vx * arcadePlayer.spotX + arcade.stone.vy * arcadePlayer.spotY) / speed;
    const meet = SUMO_MEET_MIN + (SUMO_MEET_MAX - SUMO_MEET_MIN) * (closing + 1) / 2;
    // Stoss zeigt vom eigenen Platz zur Mitte und weiter — der Stein fliegt
    // also vom Stossenden weg.
    const impulse = power * meet * SUMO_MAX_IMPULSE;
    arcade.stone.vx += -arcadePlayer.spotX * impulse;
    arcade.stone.vy += -arcadePlayer.spotY * impulse;
    arcadePlayer.shoves += 1;
    // Ein Schlag, der den Stein wirklich erwischt hat. Das ist die Zahl, die das
    // Können misst: Fehlgriffe kosten, also kann man sie nicht hochdrücken.
    arcadePlayer.blocks = (arcadePlayer.blocks || 0) + 1;
    arcadePlayer.lastBlockAt = now;
    // Gewertet wird die geleistete Schubarbeit, nicht die Zahl der Knopfdrücke.
    arcadePlayer.pushWork = (arcadePlayer.pushWork || 0) + power * meet;
    arcadePlayer.recoverUntil = now + SUMO_RECOVER_MS;
    arcadePlayer.lastShove = { power, meet, at: now, slipped: false };
    arcadePlayer.flash = power * meet > 1.1 ? "good" : null;
    arcadePlayer.lastHitAt = now;
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "dive") {
    if (now < arcadePlayer.busyUntil) return { ok: true };   // noch unterwegs

    if (input.action === "bank") {
      // Nichts dabei? Dann gibt es auch nichts einzuzahlen — und vor allem
      // keinen Weg, die Auftauchzeit als Pause zu missbrauchen.
      if (arcadePlayer.depth <= 0) return { ok: true };
      arcadePlayer.banked += arcadePlayer.carried;
      arcadePlayer.score = arcadePlayer.banked;
      arcadePlayer.lastDive = { kind: "banked", gold: arcadePlayer.carried, depth: arcadePlayer.depth, at: now };
      arcadePlayer.carried = 0;
      arcadePlayer.depth = 0;
      arcadePlayer.dives += 1;
      arcadePlayer.busyUntil = now + DIVE_SURFACE_MS;
      arcadePlayer.busyKind = "surfacing";
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
      arcadePlayer.hasMoved = true;
      syncArcadeScore(room.currentMinigame, player, arcadePlayer);
      return { ok: true };
    }
    if (input.action !== "dig") return { ok: false, error: "Tippe zum Graben, wisch hoch zum Einzahlen." };
    if (arcadePlayer.depth >= DIVE_MAX_DEPTH) return { ok: true };

    // Der Einsturz wird GENAU EINMAL je Stufe gewürfelt, im Moment des Grabens.
    // Pro Tick gewürfelt liefe dieselbe Wahrscheinlichkeit über die Grabzeit
    // gegen Gewissheit — dieselbe Falle wie anderswo schon mehrfach.
    const next = arcadePlayer.depth + 1;
    arcadePlayer.hasMoved = true;
    if (Math.random() < diveRiskAt(arcade.seed, arcadePlayer.dives, next)) {
      arcadePlayer.collapses += 1;
      arcadePlayer.lastDive = { kind: "collapsed", gold: arcadePlayer.carried, depth: arcadePlayer.depth, at: now };
      arcadePlayer.carried = 0;
      arcadePlayer.depth = 0;
      arcadePlayer.dives += 1;
      arcadePlayer.busyUntil = now + DIVE_STUN_MS;
      arcadePlayer.busyKind = "collapsed";
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
      syncArcadeScore(room.currentMinigame, player, arcadePlayer);
      return { ok: true };
    }

    arcadePlayer.depth = next;
    arcadePlayer.deepest = Math.max(arcadePlayer.deepest, next);
    arcadePlayer.carried += diveGain(next);
    arcadePlayer.busyUntil = now + DIVE_STEP_MS;
    arcadePlayer.busyKind = "digging";
    arcadePlayer.lastDive = { kind: "dug", gold: diveGain(next), depth: next, at: now };
    arcadePlayer.flash = null;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "glide") {
    if (input.action !== "lift") return { ok: false, error: "Halte den Finger auf dem Bild, um zu steigen." };
    // Der Client meldet nur, OB gerade gehalten wird. Gerechnet wird im Tick —
    // sonst hinge die Steighöhe an der Ping-Rate des Geräts statt an der Hand.
    arcadePlayer.holding = input.down === true || input.down === 1 || input.down === "1";
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "climb") {
    if (input.action !== "grab") return { ok: false, error: "Tippe abwechselnd links und rechts." };
    if (arcadePlayer.finishedAt) return { ok: true };
    const side = input.side === -1 || input.side === "-1" ? -1 : 1;
    if (side === arcadePlayer.nextSide) {
      arcadePlayer.rung += 1;
      arcadePlayer.nextSide = -arcadePlayer.nextSide;
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
      if (arcadePlayer.rung >= arcade.height) {
        arcadePlayer.finishedAt = now;
        arcadePlayer.finishMs = Math.max(0, now - room.currentMinigame.startedAt);
      }
      arcadePlayer.score = arcadePlayer.rung;
    } else {
      // Wrong hand — a small slip, but never below the ground.
      arcadePlayer.rung = Math.max(0, arcadePlayer.rung - 1);
      arcadePlayer.slips += 1;
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
    }
    arcadePlayer.hasMoved = true;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "runner") {
    if (input.action === "throw") {
      if (arcadePlayer.finishedAt || !arcadePlayer.hasItem) return { ok: true };
      // The shot flies straight forward down the thrower's own lane and hits
      // the nearest runner ahead in that same lane.
      arcadePlayer.hasItem = false;
      arcadePlayer.hasMoved = true;
      arcade.shots.push({
        id: arcade.nextShotId++,
        fromId: player.id,
        lane: arcadePlayer.lane,
        fromProgress: arcadePlayer.progress,
        firedAt: now,
        speed: 60,              // metres/sec the shot travels
        resolved: false
      });
      return { ok: true };
    }
    if (input.action !== "lane") return { ok: false, error: "Wische nach links oder rechts." };
    if (arcadePlayer.finishedAt) return { ok: true };
    const dir = input.dir === -1 || input.dir === "-1" ? -1 : 1;
    arcadePlayer.lane = clamp(arcadePlayer.lane + dir, 0, 2);
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "colorgrid") {
    if (input.action !== "step") return { ok: false, error: "Wische in eine Richtung." };
    if (arcadePlayer.eliminated) return { ok: true };
    // You may move freely while the floor is whole (the calm lead-in and the
    // announce phase). Movement locks only while the wrong tiles are dropping
    // away and rising back, and frees again once everything is back — so this
    // must use the same lead-aware round clock as updateColorGrid.
    const elapsed = now - room.currentMinigame.startedAt;
    const shifted = elapsed - (arcade.leadMs || 0);
    const roundElapsed = shifted < 0 ? 0 : shifted - arcade.round * arcade.roundMs;
    if (roundElapsed >= arcade.announceMs) return { ok: true };
    const directions = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const direction = directions[input.dir];
    if (!direction) return { ok: false, error: "Unbekannte Richtung." };
    const targetGx = clamp(arcadePlayer.gx + direction[0], 0, COLORGRID_SIZE - 1);
    const targetGy = clamp(arcadePlayer.gy + direction[1], 0, COLORGRID_SIZE - 1);
    // One kin per tile: a step onto an occupied tile simply bounces off.
    const occupied = Object.entries(arcade.players).some(([otherId, other]) => (
      otherId !== player.id && !other.eliminated && other.gx === targetGx && other.gy === targetGy
    ));
    if (occupied) return { ok: true };
    arcadePlayer.gx = targetGx;
    arcadePlayer.gy = targetGy;
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "plinko") {
    // Stups: EINMAL je Kugel, und nur solange sie fällt. Das ist der einzige
    // Eingriff nach dem Loslassen — und der Grund, warum das Spiel nicht nur
    // Glück ist.
    if (input.action === "nudge") {
      const mine = arcade.balls.find((ball) => ball.playerId === player.id && !ball.nudged);
      if (!mine) return { ok: true };
      const dir = input.dir === -1 || input.dir === "-1" ? -1 : 1;
      mine.nudged = true;
      // Setzen statt addieren: ein Stups soll ENTSCHEIDEN, wohin die Kugel
      // läuft. Addiert und danach an jedem Nagel um 45 % gedämpft brachte er
      // gemessen weniger als eine halbe Slotbreite — man sah ihn kaum.
      mine.vx = dir * PLINKO_NUDGE;
      arcadePlayer.nudges = (arcadePlayer.nudges || 0) + 1;
      arcadePlayer.lastNudge = { dir, at: now };
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }
    if (input.action !== "drop") return { ok: false, error: "Tippe, um eine Kugel fallen zu lassen." };
    const inFlight = arcade.balls.some((ball) => ball.playerId === player.id);
    if (inFlight) return { ok: true };
    const x = clamp(inputNumber(input.x) || 0.5, 0.06, 0.94);
    arcadePlayer.aimX = x;
    arcadePlayer.hasMoved = true;
    arcade.balls.push({
      id: arcade.nextBallId++,
      playerId: player.id,
      x,
      y: 0.05,
      vx: (arcadeNoise(arcade.seed + arcade.nextBallId * 13) - 0.5) * 0.06,
      vy: 0.05,
      plinks: 0,
      nudged: false
    });
    return { ok: true };
  }

  if (arcade.family === "curling") {
    if (input.action !== "flick") return { ok: false, error: "Wische, um einen Stein zu schieben." };
    if ((arcadePlayer.stonesLeft || 0) <= 0) return { ok: false, error: "Keine Steine mehr." };
    const dx = clamp(inputNumber(input.dx) || 0, -1, 1);
    const dy = clamp(inputNumber(input.dy) || 0, -1, 0.1);
    const power = Math.min(1, Math.hypot(dx, dy));
    if (power < 0.08) return { ok: true };
    arcadePlayer.stonesLeft -= 1;
    arcadePlayer.successes += 1;
    arcadePlayer.hasMoved = true;
    arcade.stones.push({
      id: arcade.nextStoneId++,
      playerId: player.id,
      x: arcadePlayer.startX || 0.5,
      y: CURLING_SHEET_Y - 0.14,
      vx: dx * 1.35,
      vy: dy * 1.7,
      lastCollisionAt: 0
    });
    arcadePlayer.flash = "good";
    arcadePlayer.lastHitAt = now;
    return { ok: true };
  }

  if (arcade.family === "choice") {
    if (input.action !== "left" && input.action !== "right") {
      return { ok: false, error: "Wähle links oder rechts." };
    }
    const cueIndex = Math.max(0, Math.floor((now - minigame.startedAt) / arcade.beatMs));
    const answerIndex = cueIndex - (arcade.choiceDelay || 0);
    if (answerIndex < 0) return { ok: true };
    const expected = arcadeChoice(arcade, answerIndex);
    if (arcadePlayer.lastCueIndex === cueIndex) return { ok: true };
    arcadePlayer.lastCueIndex = cueIndex;
    const correct = input.action === expected;
    if (correct) arcadePlayer.successes += 1;
    else arcadePlayer.mistakes += 1;
    arcadePlayer.streak = correct ? arcadePlayer.streak + 1 : 0;
    arcadePlayer.score = Math.max(0, arcadePlayer.score + (correct ? 8 + Math.min(8, arcadePlayer.streak) : -4));
    arcadePlayer.flash = correct ? "good" : "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(minigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "timing") {
    if (input.action !== "tap") return { ok: false, error: "Tippe im richtigen Moment." };
    const cycle = Math.max(0, Math.floor((now - minigame.startedAt) / arcade.periodMs));
    if (arcadePlayer.lastTimingCycle === cycle) return { ok: true };
    arcadePlayer.lastTimingCycle = cycle;
    if (arcade.dynamicTiming) arcade.timingTarget = arcadeDynamicTimingTarget(arcade, cycle);
    const phase = arcadeTimingPhase(arcade, minigame.startedAt, now);
    const distance = circularDistance(phase, arcade.timingTarget);
    const timingWindow = arcade.timingWindow || 0.27;
    const points = Math.round(Math.max(0, 24 * (1 - distance / timingWindow)));
    if (points > 0) arcadePlayer.successes += 1;
    else arcadePlayer.mistakes += 1;
    arcadePlayer.score = Math.max(0, arcadePlayer.score + (points > 0 ? points : -4));
    arcadePlayer.streak = points >= 12 ? arcadePlayer.streak + 1 : 0;
    arcadePlayer.flash = points >= 12 ? "good" : "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(minigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "steer" || arcade.family === "kinetic") {
    const directions = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const direction = directions[input.action];
    if (!direction) return { ok: false, error: "Ungültige Richtung." };
    const impulse = arcade.family === "kinetic" ? (arcade.mode === "sweep" ? 0.38 : 0.31) : (arcade.mode === "avoid" ? 0.28 : 0.34);
    arcadePlayer.hasMoved = true;
    arcadePlayer.vx = clamp(arcadePlayer.vx + direction[0] * impulse, -0.9, 0.9);
    arcadePlayer.vy = clamp(arcadePlayer.vy + direction[1] * impulse, -0.9, 0.9);
    return { ok: true };
  }

  if (arcade.family === "direct") {
    if (input.action !== "move") return { ok: false, error: "Ziehe horizontal über das Spielfeld." };
    const x = clamp(inputNumber(input.x) || 0, 0.06, 0.94);
    arcadePlayer.hasMoved = true;
    arcadePlayer.desiredX = x;
    if (arcade.mode === "catch") arcadePlayer.x = x;
    return { ok: true };
  }

  if (arcade.family === "target") {
    if (input.action !== "target") return { ok: false, error: "Tippe ein Ziel an." };
    const x = clamp(inputNumber(input.x) || 0, 0, 1);
    const y = clamp(inputNumber(input.y) || 0, 0, 1);
    const active = arcade.targets
      .filter((target) => now >= target.spawnAt && now <= target.expiresAt && !arcadePlayer.hitTargets[target.id])
      .map((target) => ({ target, position: arcadeTargetPosition(arcade, target, now) }))
      .sort((a, b) => Math.hypot(a.position.x - x, a.position.y - y) - Math.hypot(b.position.x - x, b.position.y - y));
    const nearest = active[0];
    if (!nearest || Math.hypot(nearest.position.x - x, nearest.position.y - y) > nearest.target.radius * 1.35) {
      arcadePlayer.mistakes += 1;
      arcadePlayer.score = Math.max(0, arcadePlayer.score - 2);
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
      syncArcadeScore(minigame, player, arcadePlayer);
      return { ok: true };
    }

    const target = nearest.target;
    const correct = target.kind !== "bad";
    arcadePlayer.hitTargets[target.id] = true;
    const base = target.kind === "gold" ? 22 : 12;
    if (correct) arcadePlayer.successes += 1;
    else arcadePlayer.mistakes += 1;
    arcadePlayer.streak = correct ? arcadePlayer.streak + 1 : 0;
    arcadePlayer.score = Math.max(0, arcadePlayer.score + (correct ? base + Math.min(5, arcadePlayer.streak) : -9));
    arcadePlayer.flash = correct ? "good" : "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(minigame, player, arcadePlayer);
    return { ok: true };
  }

  return { ok: false, error: "Unbekannte Arcade-Steuerung." };
}

function updateArcade(room) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  if (!arcade) return;
  const now = Date.now();
  if (now < minigame.startedAt) {
    arcade.lastUpdateAt = now;
    return;
  }

  if (arcade.family === "choice") {
    arcade.cueIndex = Math.max(0, Math.floor((now - minigame.startedAt) / arcade.beatMs));
    arcade.cue = arcadeChoice(arcade, arcade.cueIndex);
    const echoIndex = arcade.cueIndex - (arcade.choiceDelay || 0);
    arcade.echoCue = echoIndex >= 0 ? arcadeChoice(arcade, echoIndex) : null;
    arcade.cueAt = minigame.startedAt + arcade.cueIndex * arcade.beatMs;
  }
  if (arcade.family === "timing" && arcade.dynamicTiming) {
    const cycle = Math.max(0, Math.floor((now - minigame.startedAt) / arcade.periodMs));
    arcade.timingTarget = arcadeDynamicTimingTarget(arcade, cycle);
  }
  if (arcade.family === "target") updateArcadeTargets(arcade, now);

  if (arcade.family === "sumo") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updateSumoStone(room, minigame, arcade, dt, now);
    return;
  }

  if (arcade.family === "paint") {
    const dt = Math.min(0.12, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const active = room.players.filter((player) => arcade.players[player.id]);

    // Neue Rolle aufs Feld legen, aber nie mehr als zwei gleichzeitig — sonst
    // wird das Spiel ein Wettlauf um Boni statt um Fläche.
    if (now >= arcade.nextPickupAt && arcade.pickups.length < PAINT_PICKUP_MAX) {
      arcade.nextPickupAt = now + PAINT_PICKUP_EVERY_MS;
      const roll = arcadeNoise(arcade.seed + arcade.nextPickupId * 37);
      const col = Math.min(PAINT_COLS - 1, Math.floor(roll * PAINT_COLS));
      const row = Math.min(PAINT_ROWS - 1, Math.floor(arcadeNoise(arcade.seed + arcade.nextPickupId * 53) * PAINT_ROWS));
      arcade.pickups.push({ id: arcade.nextPickupId, col, row });
      arcade.nextPickupId += 1;
    }

    active.forEach((player) => {
      const entry = arcade.players[player.id];
      if (entry.boostUntil && now >= entry.boostUntil) {
        entry.wide = false;
        entry.boostUntil = 0;
      }

      // Beschleunigen in die gehaltene Richtung, mit Dämpfung. Direkte
      // Positionsübernahme fühlte sich in BounceArena rutschig an; hier gilt
      // dasselbe Vorgehen.
      entry.vx += (entry.dirX * PAINT_SPEED - entry.vx) * Math.min(1, PAINT_ACCEL * dt);
      entry.vy += (entry.dirY * PAINT_SPEED - entry.vy) * Math.min(1, PAINT_ACCEL * dt);
      entry.vx *= Math.pow(PAINT_DAMPING, dt * 10);
      entry.vy *= Math.pow(PAINT_DAMPING, dt * 10);
      entry.px = clamp(entry.px + entry.vx * dt, 0.1, PAINT_COLS - 0.1);
      entry.py = clamp(entry.py + entry.vy * dt, 0.1, PAINT_ROWS - 0.1);
    });

    // Anrempeln: zwei Kins schieben sich auseinander. Das ist die einzige
    // direkte Einmischung — man kann jemanden aus seinem Revier drängen.
    for (let a = 0; a < active.length; a += 1) {
      for (let b = a + 1; b < active.length; b += 1) {
        const one = arcade.players[active[a].id];
        const two = arcade.players[active[b].id];
        const dx = two.px - one.px;
        const dy = two.py - one.py;
        const dist = Math.hypot(dx, dy);
        if (dist >= PAINT_BUMP_RADIUS || dist < 1e-6) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const push = (PAINT_BUMP_RADIUS - dist) * PAINT_BUMP_FORCE;
        one.vx -= nx * push;
        one.vy -= ny * push;
        two.vx += nx * push;
        two.vy += ny * push;
        // Nur ein Rempler pro Begegnung: je Tick zu zählen ergab gemessen über
        // 200 "Rempler" in einer Runde, was nichts mehr aussagt.
        if (now - one.lastBumpAt > PAINT_BUMP_COOLDOWN_MS) {
          one.bumps += 1;
          one.lastBumpAt = now;
        }
        if (now - two.lastBumpAt > PAINT_BUMP_COOLDOWN_MS) {
          two.bumps += 1;
          two.lastBumpAt = now;
        }
      }
    }

    active.forEach((player) => {
      const entry = arcade.players[player.id];
      const col = Math.floor(entry.px);
      const row = Math.floor(entry.py);

      paintBrushTiles(col, row, entry.wide).forEach(([c, r]) => {
        paintClaim(arcade, entry, c, r, player.id, dt);
      });

      // Rolle einsammeln: aufs Feld laufen genügt.
      const taken = arcade.pickups.findIndex((pickup) => pickup.col === col && pickup.row === row);
      if (taken >= 0) {
        arcade.pickups.splice(taken, 1);
        entry.wide = true;
        entry.pickups = (entry.pickups || 0) + 1;
        entry.boostUntil = now + PAINT_BOOST_MS;
        entry.lastPickupAt = now;
        entry.flash = "good";
        entry.lastHitAt = now;
      }

      entry.owned = paintOwnedCount(arcade, player.id);
      entry.tileSeconds += entry.owned * dt;
      entry.score = Math.round(entry.tileSeconds * PAINT_TILE_SECOND_POINTS);
      entry.hasMoved = entry.hasMoved || Math.abs(entry.dirX) + Math.abs(entry.dirY) > 0.05;
      syncArcadeScore(minigame, player, entry);
    });
    return;
  }

  if (arcade.family === "fish") {
    const dt = Math.min(0.2, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;

      const sinceHook = Math.max(0, now - entry.hookedAt);
      entry.surging = fishSurging(entry.phases, sinceHook);
      // Nach einem Riss braucht der neue Fisch einen Moment, bis er anbeisst.
      if (now < entry.pauseUntil) {
        entry.holding = false;
        entry.tension = Math.max(0, entry.tension - FISH_RELAX * dt);
        return;
      }
      entry.holding = now - entry.lastReelAt < FISH_HOLD_GRACE_MS;

      const kind = entry.species || FISH_SPECIES[1];
      if (entry.holding) {
        entry.distance = Math.max(0, entry.distance - FISH_REEL_SPEED * kind.reel * dt);
        entry.tension += (entry.surging
          ? FISH_TENSION_SURGE * kind.surge
          : FISH_TENSION_CALM * kind.calm) * dt;
      } else {
        // Loslassen entspannt die Schnur, kostet aber Weg: der Fisch zieht ab.
        entry.tension = Math.max(0, entry.tension - FISH_RELAX * dt);
        entry.distance = Math.min(1, entry.distance + FISH_SLIP_SPEED * dt);
      }
      entry.bestDistance = Math.min(entry.bestDistance, entry.distance);

      if (entry.tension >= 1) {
        // Schnur gerissen: der Fisch ist weg, ein neuer beisst gleich an.
        entry.snaps += 1;
        entry.lastSnapAt = now;
        // Ein Riss kostet, was der Fisch WERT war — nicht einen festen Betrag.
        // Mit 80 Punkten pauschal war Zocken die beste Strategie: gemessen riss
        // der unaufmerksamste Bot 2.45-mal pro Runde, landete dafür zwei Fische
        // mehr und gewann damit klar. Wer einen Wels verliert, muss das merken.
        entry.snapLoss = (entry.snapLoss || 0) + Math.round(kind.points * FISH_SNAP_SHARE);
        entry.lastSnapKind = { id: kind.id, name: kind.name, at: now };
        entry.tension = 0;
        entry.distance = 1;
        entry.bestDistance = 1;
        entry.pauseUntil = now + FISH_SNAP_PAUSE_MS;
        entry.catchIndex += 1;
        entry.hookedAt = now + FISH_SNAP_PAUSE_MS;
        entry.species = fishSpeciesFor(arcade.seed, entry.catchIndex);
        entry.phases = buildFishPhases(arcade.seed, entry.catchIndex, minigame.duration, entry.species);
        entry.flash = "bad";
        entry.lastHitAt = now;
      } else if (entry.distance <= 0 && entry.landed < FISH_MAX_CATCH) {
        // Gelandet: der nächste Fisch hängt sofort, mit eigenem Kampfplan.
        entry.landed += 1;
        entry.lastLandedAt = now;
        entry.lastCatch = { id: kind.id, name: kind.name, points: kind.points, at: now };
        entry.caught.push(kind.id);
        entry.haul = (entry.haul || 0) + kind.points;
        entry.tension = 0;
        entry.distance = 1;
        entry.bestDistance = 1;
        entry.catchIndex += 1;
        entry.hookedAt = now;
        entry.species = fishSpeciesFor(arcade.seed, entry.catchIndex);
        entry.phases = buildFishPhases(arcade.seed, entry.catchIndex, minigame.duration, entry.species);
        entry.flash = "good";
        entry.lastHitAt = now;
      }

      entry.score = fishScore(entry);
      syncArcadeScore(minigame, player, entry);
    });
    return;
  }

  if (arcade.family === "belt") {
    const dt = Math.min(0.2, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const elapsed = Math.max(0, now - minigame.startedAt);

    // Der Farbplan liegt fest; hier wird nur nachgeschaut, welcher Eintrag
    // gerade gilt. Kein Zufall pro Tick — sonst wuerde derselbe Tausch bei
    // unterschiedlichen Tickraten unterschiedlich oft passieren.
    while (arcade.swapIndex + 1 < arcade.chutePlan.length
      && elapsed >= arcade.chutePlan[arcade.swapIndex + 1].at) {
      arcade.swapIndex += 1;
      arcade.chutes = arcade.chutePlan[arcade.swapIndex].chutes;
      arcade.lastSwapAt = now;
    }
    const nextSwap = arcade.chutePlan[arcade.swapIndex + 1] || null;
    arcade.nextSwapIn = nextSwap ? Math.max(0, nextSwap.at - elapsed) : null;
    arcade.nextChutes = nextSwap && arcade.nextSwapIn <= BELT_SWAP_WARN_MS ? nextSwap.chutes : null;

    arcade.speed = beltSpeed(elapsed, minigame.duration);

    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      entry.beltPos += arcade.speed * dt;
      // Durchgerutscht: das Paket faellt hinten runter. Kostet Punkte und die
      // Serie — Nichtstun ist damit teurer als ein Fehlgriff pro Paket.
      if (entry.beltPos >= 1) {
        entry.missed += 1;
        entry.streak = 0;
        entry.score = Math.max(0, entry.score - BELT_MISS_COST);
        entry.lastVerdict = { kind: "missed", chute: -1, colour: entry.queue[0] ? entry.queue[0].colour : 0, at: now, bonus: 0 };
        advanceBeltQueue(arcade, entry, true);
      }
      entry.reachable = entry.beltPos >= BELT_REACH_AT;
      syncArcadeScore(minigame, player, entry);
    });
    return;
  }

  if (arcade.family === "dive") {
    // Der Schacht selbst hat keine Physik — hier wird nur die Anzeige für den
    // nächsten Spatenstich nachgeführt, damit Bild, Bot und Wertung dieselbe
    // Zahl sehen.
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const next = Math.min(DIVE_MAX_DEPTH, entry.depth + 1);
      entry.nextRisk = diveRiskAt(arcade.seed, entry.dives, next);
      entry.nextGain = diveGain(next);
      entry.busy = now < entry.busyUntil;
      syncArcadeScore(minigame, player, entry);
    });
    return;
  }

  if (arcade.family === "glide") {
    const dt = Math.min(0.2, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const elapsed = Math.max(0, now - minigame.startedAt);
    arcade.elapsed = elapsed;

    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;

      // Nach einer Boden- oder Deckenberührung trägt der Ballon kurz nicht.
      // Das ist die eigentliche Strafe fürs Anecken: nicht ein Abzug, sondern
      // ein Moment, in dem die Hand nichts bewirkt.
      const stalled = now < entry.stallUntil;
      const lift = entry.holding && !stalled ? GLIDE_LIFT : 0;
      entry.vy = clamp(entry.vy + (lift - GLIDE_GRAVITY) * dt, -GLIDE_VY_MAX, GLIDE_VY_MAX);
      entry.y += entry.vy * dt;

      if (entry.y <= 0) {
        entry.y = 0;
        if (entry.vy < -0.15) { entry.bumps += 1; entry.stallUntil = now + GLIDE_STALL_MS; }
        entry.vy = 0;
      } else if (entry.y >= 1) {
        entry.y = 1;
        if (entry.vy > 0.15) { entry.bumps += 1; entry.stallUntil = now + GLIDE_STALL_MS; }
        entry.vy = 0;
      }
      entry.stalled = stalled;

      // Tore werden EINMAL abgerechnet, wenn sie den Ballon erreichen — nicht
      // pro Tick. Eine Prüfung, die pro Tick läuft, hängt sonst an der Tickrate.
      while (entry.nextGate < arcade.gates.length && elapsed >= arcade.gates[entry.nextGate].at) {
        const gate = arcade.gates[entry.nextGate];
        const miss = Math.abs(entry.y - gate.y);
        const half = gate.gap / 2;
        if (miss <= half) {
          entry.gatesPassed += 1;
          // Zugabe für die Mitte: durchkommen ist gut, mittig durchkommen ist
          // besser. Sonst wäre der Rand genauso viel wert und das Spiel endete
          // reihenweise unentschieden.
          const centre = Math.round(GLIDE_CENTRE_BONUS * (1 - miss / half));
          if (miss <= half * 0.25) entry.perfect += 1;
          entry.score += GLIDE_GATE_POINTS + centre;
          entry.lastGate = { index: entry.nextGate, hit: true, centre, at: now };
        } else {
          entry.gatesMissed += 1;
          entry.lastGate = { index: entry.nextGate, hit: false, centre: 0, at: now };
        }
        entry.nextGate += 1;
      }

      syncArcadeScore(minigame, player, entry);
    });
    return;
  }


  if (arcade.family === "feint") {
    // Verpasste echte Signale werden hier abgeschlossen: der Client zeigt sie
    // als verpasst an, und ein abgelaufenes Fenster kann nicht mehr nachträglich
    // gewertet werden. Kosten tut ein verpasstes Signal nichts — Abwarten ist
    // erlaubt, es bringt nur eben keine Punkte.
    const elapsed = Math.max(0, now - minigame.startedAt);
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      arcade.signals.forEach((signal) => {
        if (!signal.real) return;
        if (elapsed <= signal.at + signal.windowMs) return;
        if (entry.handled[signal.index]) return;
        entry.handled[signal.index] = true;
        entry.missed += 1;
      });
      syncArcadeScore(minigame, player, entry);
    });
    return;
  }

  if (arcade.family === "steer") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    const elapsed = Math.max(0, now - minigame.startedAt);
    arcade.lastUpdateAt = now;
    updateArcadeWorld(arcade, elapsed, dt, now);
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      entry.vx *= Math.pow(0.82, dt * 10);
      entry.vy *= Math.pow(0.82, dt * 10);
      entry.x += entry.vx * dt;
      entry.y += entry.vy * dt;
      bounceArcadePlayer(entry);
      scoreArcadeSteerPlayer(arcade, entry, dt, now);
      syncArcadeScore(minigame, player, entry);
    });
  }

  if (arcade.family === "kinetic") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    const elapsed = Math.max(0, now - minigame.startedAt);
    arcade.lastUpdateAt = now;
    updateKineticWorld(arcade, elapsed, dt, now);
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      entry.vx *= Math.pow(0.8, dt * 10);
      entry.vy *= Math.pow(0.8, dt * 10);
      entry.x += entry.vx * dt;
      entry.y += entry.vy * dt;
      if (arcade.mode === "sweep") containKineticPlayer(entry);
      else bounceArcadePlayer(entry);
      scoreKineticPlayer(arcade, entry, dt, now);
      syncArcadeScore(minigame, player, entry);
    });
  }

  if (arcade.family === "direct") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    const elapsed = Math.max(0, now - minigame.startedAt);
    arcade.lastUpdateAt = now;
    updateDirectWorld(room, minigame, arcade, elapsed, dt, now);
  }

  if (arcade.family === "plinko") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updatePlinko(room, minigame, arcade, dt, now);
  }

  if (arcade.family === "estimate") {
    updateEstimate(room, minigame, arcade, now);
  }

  if (arcade.family === "curling") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updateCurling(room, minigame, arcade, dt, now);
  }

  if (arcade.family === "runner") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updateRunner(room, minigame, arcade, dt, now);
  }

  if (arcade.family === "colorgrid") {
    updateColorGrid(room, minigame, arcade, now);
  }

  if (arcade.family === "redlight") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updateRedlight(room, minigame, arcade, dt, now);
  }

  if (arcade.family === "wave") {
    updateWave(room, minigame, arcade, now);
  }

  if (arcade.family === "barrel") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updateBarrel(room, minigame, arcade, dt, now);
  }

  if (arcade.family === "bomb") {
    updateBomb(room, minigame, arcade, now);
  }

  if (arcade.family === "catchfall") {
    updateCatchfall(room, minigame, arcade, now);
  }

  if (arcade.family === "knife") {
    const dt = Math.min(0.12, Math.max(0.016, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    updateKnife(room, minigame, arcade, dt, now);
  }

  maybeFinishArcadeEarly(room, minigame, arcade, now);
}

function updateCatchfall(room, minigame, arcade, now) {
  const elapsed = Math.max(0, now - minigame.startedAt);
  arcade.drops.forEach((drop) => {
    if (drop.processed || elapsed < drop.catchAt) return;
    drop.processed = true;
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry || entry.lane !== drop.lane) return;
      if (drop.kind === "coin") {
        entry.catches += 1;
        entry.streak = (entry.streak || 0) + 1;
        entry.flash = "good";
      } else if (drop.kind === "gem") {
        entry.catches += 3;
        entry.streak = (entry.streak || 0) + 1;
        entry.flash = "good";
      } else {
        entry.bombs += 1;
        entry.streak = 0;
        entry.flash = "bad";
      }
      entry.lastHitAt = now;
      entry.score = Math.max(0, entry.catches * 10 - entry.bombs * 8);
      syncArcadeScore(minigame, player, entry);
    });
  });
}

// Messerwurf: the shared log spins ever faster; once every alive player has
// thrown this round (or the round times out) it advances to the next.
// Move to the next player who has not yet had a turn. Spin gets a touch
// faster each turn so later throwers face a trickier disc.
// Das Wurffenster je Runde. Es wird enger, damit späte Runden — wenn die Scheibe
// schon voll ist — auch unter Zeitdruck stehen.
// Der beste Wurf, der in diesem Augenblick überhaupt möglich wäre: die Mitte
// des grössten freien Bogens. Von dort aus ist der Abstand zum nächsten Messer
// genau der halbe Bogen.
function knifeBestGap(knives) {
  if (!knives || knives.length === 0) return 180;
  const angles = knives.map((knife) => ((knife.angleDeg % 360) + 360) % 360).sort((a, b) => a - b);
  let widest = angles[0] + 360 - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i += 1) {
    widest = Math.max(widest, angles[i] - angles[i - 1]);
  }
  return Math.max(1, widest / 2);
}

function knifeTurnMs(round) {
  return Math.max(KNIFE_TURN_MIN_MS, Math.round(KNIFE_TURN_START_MS * Math.pow(KNIFE_TURN_STEP, round)));
}

function advanceKnifeTurn(room, minigame, arcade, now) {
  const current = arcade.players[arcade.activeId];
  if (current) current.turnDone = true;
  const alive = (id) => {
    const entry = arcade.players[id];
    return entry && !entry.eliminated;
  };
  let next = null;
  for (let step = 1; step <= arcade.order.length; step += 1) {
    const index = (arcade.turnIndex + step) % arcade.order.length;
    const candidate = arcade.order[index];
    if (alive(candidate) && !arcade.players[candidate].turnDone) {
      next = candidate;
      arcade.turnIndex = index;
      break;
    }
  }
  if (!next) {
    // Runde vorbei: alle, die noch dabei sind, dürfen erneut werfen.
    arcade.round += 1;
    if (arcade.round < arcade.rounds) {
      arcade.order.forEach((id) => {
        if (alive(id)) arcade.players[id].turnDone = false;
      });
      arcade.turnMs = knifeTurnMs(arcade.round);
      // Wer anfängt, wirft in die leerste Scheibe — das ist der grösste Vorteil
      // im ganzen Spiel. Bei fester Reihenfolge hatte Spieler 1 in JEDER Runde
      // im Schnitt 100 Grad Platz und Spieler 3 nur 66; das entschied die Partie
      // deutlicher als alles, was die Spieler taten.
      //
      // Einfaches Durchrotieren reicht nicht: geht die Rundenzahl nicht durch
      // die Spielerzahl auf (drei Spieler, vier Runden), bleibt ein fester Rest
      // übrig — gemessen genau bei drei Spielern. Nur den Anfänger zu tauschen
      // reicht auch nicht, denn der Rest der Runde bleibt dann in alter Ordnung.
      //
      // Darum wird die ganze Runde neu sortiert: wer bisher die schlechtesten
      // Plätze hatte, wirft zuerst. Gleichstände werden gewürfelt — sonst
      // bevorzugt der Rest über viele Partien hinweg immer denselben Sitz.
      arcade.turnPos = 0;
      arcade.order = arcade.order
        .map((id) => ({ id, sum: arcade.players[id]?.posSum || 0, jitter: Math.random() }))
        .sort((a, b) => (b.sum - a.sum) || (a.jitter - b.jitter))
        .map((entry) => entry.id);
      for (let step = 0; step < arcade.order.length; step += 1) {
        const candidate = arcade.order[step];
        if (alive(candidate)) { next = candidate; arcade.turnIndex = step; break; }
      }
    }
  }
  if (next) {
    arcade.activeId = next;
    const entry = arcade.players[next];
    if (entry) entry.posSum = (entry.posSum || 0) + (arcade.turnPos || 0);
    arcade.turnPos = (arcade.turnPos || 0) + 1;
    arcade.turnEndsAt = now + arcade.turnMs;
    arcade.spinSpeed = Math.min(KNIFE_SPIN_MAX, arcade.spinSpeed + KNIFE_SPIN_STEP);
  } else {
    arcade.activeId = null;   // alle Runden geworfen oder niemand mehr übrig
  }
}

function updateKnife(room, minigame, arcade, dt, now) {
  // The disc always spins; direction alternates by turn to keep it honest.
  const dir = arcade.turnIndex % 2 === 0 ? 1 : -1;
  arcade.logAngle += arcade.spinSpeed * dir * dt;

  if (arcade.activeId && now >= arcade.turnEndsAt) {
    // Knife Hit rule: miss your throwing window and you are out.
    const current = arcade.players[arcade.activeId];
    const currentPlayer = room.players.find((p) => p.id === arcade.activeId);
    if (current && currentPlayer && !current.turnDone && !current.eliminated) {
      // Ein verpasstes Wurffenster zählt wie ein Fehlwurf — auch hier gibt es
      // einen zweiten Versuch, sonst wäre kurzes Zögern härter bestraft als ein
      // Messer in ein anderes zu werfen.
      current.clashes = (current.clashes || 0) + 1;
      if (current.clashes >= KNIFE_LIVES) {
        current.eliminated = true;
        current.eliminatedAt = now;
      }
      current.flash = "bad";
      current.lastHitAt = now;
      syncArcadeScore(minigame, currentPlayer, current);
    }
    advanceKnifeTurn(room, minigame, arcade, now);
  }
}

function updateBarrel(room, minigame, arcade, dt, now) {
  const elapsed = Math.max(0, now - minigame.startedAt);
  const phase = barrelPhaseAt(arcade, elapsed);
  arcade.barrelVel = phase.vel;
  arcade.barrelAngle += phase.vel * dt;

  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry || entry.fallenAt) return;
    const holding = now - (entry.lastRunAt || 0) <= BARREL_HOLD_FRESH_MS;
    // Feste Laufgeschwindigkeit, NICHT relativ zum Fass. Relativ gerechnet
    // gewann Gegenhalten immer, und niemand fiel je herunter. Fest gerechnet
    // heisst: der schnellste Schub (1.9) laesst sich mit 2.1 gerade noch
    // zurueckdrehen, und in die falsche Richtung zu halten kostet 4.0 pro
    // Sekunde — von der Mitte bis zum Rand also gut vier Zehntel.
    const runVel = holding ? entry.runDir * BARREL_RUN_SPEED : 0;
    // The spinning barrel carries you along; counter-run to stay on top.
    entry.offset += (phase.vel + runVel) * dt;
    if (Math.abs(entry.offset) >= arcade.limit) {
      entry.fallenAt = now;
      entry.survivedMs = elapsed;
      entry.flash = "bad";
      entry.lastHitAt = now;
      syncArcadeScore(minigame, player, entry);
      return;
    }
    // Wer oben bleibt, wird nach Ruhe in der Balance getrennt: Zeit dicht an der
    // Mitte zählt. Ohne das bekamen ALLE Überlebenden exakt dieselbe Punktzahl
    // (die verstrichene Zeit) und die Partie endete unentschieden.
    entry.balanceWork = (entry.balanceWork || 0) + (1 - Math.abs(entry.offset) / arcade.limit) * dt;
    entry.score = Math.round(elapsed + entry.balanceWork * 120);
    syncArcadeScore(minigame, player, entry);
  });
}

function updateBomb(room, minigame, arcade, now) {
  if (now < arcade.fuseAt) return;
  const holder = arcade.players[arcade.holderId];
  if (holder && !holder.outAt) {
    holder.outAt = now;
    holder.flash = "bad";
    holder.lastHitAt = now;
    const holderPlayer = room.players.find((player) => player.id === arcade.holderId);
    if (holderPlayer) syncArcadeScore(minigame, holderPlayer, holder);
  }
  arcade.explosions += 1;
  const alive = arcade.order.filter((id) => !arcade.players[id]?.outAt);
  if (alive.length === 0) return;
  // Hand the next bomb to a random survivor and light a fresh fuse — its time
  // is shown for a moment so a sharp player can plan the next pass.
  arcade.holderId = alive[Math.floor(arcadeNoise(arcade.seed + arcade.explosions * 41) * alive.length)] || alive[0];
  arcade.holderSince = now;
  arcade.canPassAt = now + BOMB_PASS_LOCK_MS;
  arcade.fuseMs = bombFuseMs(arcade.seed, arcade.explosions);
  arcade.fuseAt = now + arcade.fuseMs;
  arcade.revealUntil = now + BOMB_REVEAL_MS;
}

function updateRedlight(room, minigame, arcade, dt, now) {
  const elapsed = Math.max(0, now - minigame.startedAt);
  const phase = redlightPhaseAt(arcade, elapsed);
  arcade.phaseIndex = phase.index;
  arcade.phaseKind = phase.kind;
  arcade.phaseUntil = minigame.startedAt + phase.until;

  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry || entry.finishedAt) return;
    const holding = now - (entry.lastRunAt || 0) <= REDLIGHT_HOLD_FRESH_MS;

    if (holding && phase.kind === "green") {
      entry.progress = Math.min(arcade.goal, entry.progress + REDLIGHT_SPEED * dt);
      if (entry.progress >= arcade.goal) {
        entry.finishedAt = now;
        entry.finishMs = elapsed;
        entry.score = Math.max(1000, 200000 - elapsed);
        syncArcadeScore(minigame, player, entry);
      }
      return;
    }

    // Caught sprinting during red — a short grace right after the switch is forgiven.
    if (holding && phase.kind === "red" && entry.penalizedPhase !== phase.index) {
      const intoRed = elapsed - phase.from;
      if (intoRed > REDLIGHT_GRACE_MS) {
        entry.penalizedPhase = phase.index;
        entry.caught += 1;
        entry.progress = Math.max(0, entry.progress - REDLIGHT_PENALTY);
        entry.flash = "bad";
        entry.lastHitAt = now;
      }
    }
  });
}

function updateWave(room, minigame, arcade, now) {
  const elapsed = Math.max(0, now - minigame.startedAt);
  arcade.waves.forEach((wave, index) => {
    if (wave.processed || elapsed < wave.hitAt) return;
    wave.processed = true;
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry || entry.eliminated) return;
      const jumpStartedAt = entry.jumpUntil - arcade.jumpMs - minigame.startedAt;
      const airborne = entry.jumpUntil - minigame.startedAt >= wave.hitAt && jumpStartedAt <= wave.hitAt;
      if (airborne) {
        entry.survived = index + 1;
        entry.score = entry.survived * 1000;
        entry.flash = "good";
        syncArcadeScore(minigame, player, entry);
      } else {
        entry.eliminated = true;
        entry.eliminatedAt = now;
        entry.flash = "bad";
        entry.lastHitAt = now;
        syncArcadeScore(minigame, player, entry);
      }
    });
  });
}

function updateRunner(room, minigame, arcade, dt, now) {
  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry || entry.finishedAt) return;
    const stumbling = now < entry.stumbleUntil;
    const boosted = now < entry.boostUntil;
    const speed = RUNNER_BASE_SPEED * (stumbling ? 0.25 : 1) * (boosted ? 1.55 : 1);
    entry.progress = Math.min(arcade.trackLength, entry.progress + speed * dt);

    while (entry.nextRow < arcade.rows.length && entry.progress >= arcade.rows[entry.nextRow].position) {
      const row = arcade.rows[entry.nextRow];
      entry.nextRow += 1;
      if (row.kind === "boost") {
        if (row.lane === entry.lane) {
          entry.boostUntil = now + RUNNER_BOOST_MS;
          entry.flash = "good";
          entry.lastHitAt = now;
        }
      } else if (row.kind === "item") {
        if (row.lane === entry.lane && !entry.hasItem) {
          entry.hasItem = true;
          // Aufgesammelte Kisten merken, damit der Client sie verschwinden
          // lassen kann. Vorher blieb die Kiste stehen, obwohl man sie schon
          // hatte — man sah nicht, ob der Griff gesessen hatte.
          entry.takenRows = entry.takenRows || [];
          entry.takenRows.push(entry.nextRow - 1);
          entry.flash = "good";
          entry.lastHitAt = now;
        }
      } else if (runnerBlockedLanes(row, now).includes(entry.lane)) {
        entry.stumbleUntil = now + RUNNER_STUMBLE_MS;
        entry.stumbles += 1;
        entry.flash = "bad";
        entry.lastHitAt = now;
      }
    }

    if (entry.progress >= arcade.trackLength) {
      entry.finishedAt = now;
      entry.finishMs = Math.max(0, now - minigame.startedAt);
      entry.flash = "good";
      entry.lastHitAt = now;
    }

    entry.score = entry.finishedAt
      ? 10000000 - entry.finishMs
      : Math.round(entry.progress * 1000);
    syncArcadeScore(minigame, player, entry);
  });

  // Shots travel straight forward down their lane; the first runner ahead in
  // the same lane that they overtake gets tumbled.
  arcade.shots.forEach((shot) => {
    if (shot.resolved) return;
    const travelled = ((now - shot.firedAt) / 1000) * shot.speed;
    // Der Schuss ist ein FLIEGENDES Geschoss, kein wachsendes Band. Vorher lief
    // die Trefferprüfung über die ganze Strecke vom Abschusspunkt bis zur
    // Spitze — wer von hinten über den Abschusspunkt lief, während der Schuss
    // noch unterwegs war, wurde dadurch nachträglich getroffen, obwohl das
    // Geschoss längst vorbei war. Geprüft wird jetzt nur das Stück, das in
    // DIESEM Tick überstrichen wurde.
    const tail = shot.headProgress ?? shot.fromProgress;
    shot.headProgress = shot.fromProgress + travelled;
    const thrower = arcade.players[shot.fromId];
    let hit = null;
    room.players.forEach((candidate) => {
      const entry = arcade.players[candidate.id];
      if (!entry || candidate.id === shot.fromId || entry.finishedAt) return;
      if (entry.lane !== shot.lane) return;
      if (entry.progress > tail && entry.progress <= shot.headProgress) {
        if (!hit || entry.progress < arcade.players[hit].progress) hit = candidate.id;
      }
    });
    if (hit) {
      const target = arcade.players[hit];
      target.stumbleUntil = now + Math.round(RUNNER_STUMBLE_MS * 1.25);
      target.stumbles += 1;
      target.flash = "bad";
      target.lastHitAt = now;
      if (thrower) thrower.throwsHit = (thrower.throwsHit || 0) + 1;
      shot.resolved = true;
      shot.resolvedAt = now;
      shot.hitId = hit;
    } else if (travelled > RUNNER_LENGTH) {
      shot.resolved = true;
      shot.resolvedAt = now;
    }
  });
  // Keep spent shots briefly so clients can play the impact, then drop.
  arcade.shots = arcade.shots.filter((shot) => !shot.resolved || now < (shot.resolvedAt || now) + 700);
}

function updateColorGrid(room, minigame, arcade, now) {
  if (now < minigame.startedAt) return;
  const elapsed = now - minigame.startedAt;
  // A calm lead-in: the first target is shown but the floor never drops until
  // the lead time has passed, so the round no longer starts abruptly.
  const shifted = elapsed - (arcade.leadMs || 0);
  const round = shifted < 0 ? 0 : Math.min(arcade.roundCount - 1, Math.floor(shifted / arcade.roundMs));
  if (round !== arcade.round) advanceColorRound(arcade, round, now);

  const roundElapsed = shifted < 0 ? 0 : shifted - round * arcade.roundMs;
  const phase = roundElapsed < arcade.announceMs ? "announce" : (roundElapsed < arcade.dropEndMs ? "drop" : "rest");

  if (phase === "drop" && arcade.phase === "announce") {
    // The floor drops: anyone on a wrong tile falls and is OUT for good.
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry || entry.eliminated) return;
      const tileColor = arcade.grid[entry.gy * COLORGRID_SIZE + entry.gx];
      if (tileColor === arcade.targetColor) {
        entry.survived += 1;
        entry.score = entry.survived;
        entry.flash = "good";
      } else {
        entry.eliminated = true;
        entry.fallenRound = round;
        entry.flash = "bad";
      }
      entry.lastHitAt = now;
      syncArcadeScore(minigame, player, entry);
    });
  }
  arcade.phase = phase;

  // Single elimination: once at most one player is still standing, play a
  // short finale so the survivor is seen, then the scoreboard.
  const alive = room.players.reduce((count, player) => (
    count + (arcade.players[player.id] && !arcade.players[player.id].eliminated ? 1 : 0)
  ), 0);
  if (room.players.length > 1 && alive <= 1 && elapsed > arcade.announceMs) {
    beginMinigameFinale(room, minigame);
  }
}

function maybeFinishArcadeEarly(room, minigame, arcade, now) {
  if (minigame.finishing || now < minigame.startedAt + 1500) return;
  let done = false;
  if (arcade.family === "stopclock") {
    done = room.players.every((player) => arcade.players[player.id]?.stoppedMs !== null);
  } else if (arcade.family === "runner") {
    done = room.players.every((player) => arcade.players[player.id]?.finishedAt);
  } else if (arcade.family === "redlight") {
    done = room.players.every((player) => arcade.players[player.id]?.finishedAt);
  } else if (arcade.family === "wave") {
    const alive = room.players.filter((player) => !arcade.players[player.id]?.eliminated);
    done = alive.length <= 1 && now > minigame.startedAt + WAVE_FIRST_AT;
  } else if (arcade.family === "barrel") {
    const alive = room.players.filter((player) => !arcade.players[player.id]?.fallenAt);
    done = room.players.length > 1 && alive.length <= 1;
  } else if (arcade.family === "bomb") {
    const alive = room.players.filter((player) => !arcade.players[player.id]?.outAt);
    done = room.players.length > 1 && alive.length <= 1;
  } else if (arcade.family === "cannon") {
    done = room.players.every((player) => arcade.players[player.id]?.launchedAt);
  } else if (arcade.family === "react") {
    done = room.players.every((player) => (arcade.players[player.id]?.times?.length || 0) >= REACT_ROUNDS);
  } else if (arcade.family === "knife") {
    // Alle Runden geworfen — oder es ist niemand mehr übrig.
    done = arcade.activeId === null;
  } else if (arcade.family === "stack") {
    done = room.players.every((player) => {
      const entry = arcade.players[player.id];
      return entry?.toppled || (entry?.height || 0) >= arcade.total;
    });
  } else if (arcade.family === "climb") {
    done = room.players.every((player) => arcade.players[player.id]?.finishedAt);
  } else if (arcade.family === "sumo") {
    const alive = room.players.filter((player) => !arcade.players[player.id]?.eliminated);
    done = room.players.length > 1 && alive.length <= 1;
  }
  // Allgemeine Regel über ALLE Familien: kann niemand mehr etwas tun, ist die
  // Runde vorbei. Vorher lief die Uhr in manchen Spielen weiter, obwohl längst
  // alle draussen oder im Ziel waren — man sass vor einem Bild, in dem nichts
  // mehr passieren konnte, und wartete auf den Ablauf der Zeit.
  if (!done && room.players.length > 0) {
    done = room.players.every((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return true;
      return Boolean(entry.eliminated || entry.finishedAt || entry.outAt
        || entry.toppled || entry.fallenAt);
    });
  }

  if (done) {
    beginMinigameFinale(room, minigame);
  }
}

function updatePlinko(room, minigame, arcade, dt, now) {
  arcade.balls.forEach((ball) => {
    ball.vy += PLINKO_GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < 0.035) {
      ball.x = 0.035;
      ball.vx = Math.abs(ball.vx) * 0.6;
    } else if (ball.x > 0.965) {
      ball.x = 0.965;
      ball.vx = -Math.abs(ball.vx) * 0.6;
    }

    arcade.pegs.forEach((peg) => {
      const dx = ball.x - peg.x;
      const dy = ball.y - peg.y;
      const distance = Math.hypot(dx, dy);
      const minDistance = peg.r + 0.028;
      if (distance >= minDistance || distance === 0) return;
      const nx = dx / distance;
      const ny = dy / distance;
      ball.x = peg.x + nx * minDistance;
      ball.y = peg.y + ny * minDistance;
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx -= 2 * dot * nx;
        ball.vy -= 2 * dot * ny;
        ball.vx *= 0.55;
        ball.vy *= 0.55;
        // Weniger Streuung als früher (0.09): sonst überdeckt der Zufall am Nagel
        // die Absicht beim Zielen und beim Stups.
        ball.vx += (arcadeNoise(arcade.seed + ball.id * 7 + ball.plinks * 3) - 0.5) * 0.05;
        ball.plinks += 1;
        const owner = arcade.players[ball.playerId];
        if (owner) owner.plinks = (owner.plinks || 0) + 1;
      }
    });
  });

  const landed = arcade.balls.filter((ball) => ball.y >= arcade.floorY - 0.03);
  landed.forEach((ball) => {
    const slot = clamp(Math.floor(ball.x * arcade.slots.length), 0, arcade.slots.length - 1);
    const points = arcade.slots[slot];
    const owner = arcade.players[ball.playerId];
    if (owner) {
      owner.score += points;
      owner.successes += 1;
      owner.streak = points >= 7 ? owner.streak + 1 : 0;
      owner.flash = points >= 7 ? "good" : "bad";
      owner.lastHitAt = now;
      owner.lastSlot = { slot, points, at: now };
    }
  });
  arcade.balls = arcade.balls.filter((ball) => ball.y < arcade.floorY - 0.03);

  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (entry) syncArcadeScore(minigame, player, entry);
  });
}

function updateEstimate(room, minigame, arcade, now) {
  const elapsed = Math.max(0, now - minigame.startedAt);
  const round = estimateRoundAt(arcade, elapsed);
  arcade.round = round ? round.index : null;
  arcade.phase = !round ? "over"
    : elapsed < round.guessFrom ? "show"
      : elapsed < round.revealFrom ? "guess" : "reveal";
  if (!round) return;

  // Genau EINMAL je Durchgang werten, beim Übergang in die Auflösung. Ohne die
  // Merkzahl liefe die Wertung mit jedem Tick erneut.
  if (arcade.phase !== "reveal" || arcade.resolvedRound >= round.index) return;
  arcade.resolvedRound = round.index;

  const reveal = { round: round.index, count: round.count, at: now, guesses: {} };
  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return;
    // Wer den Regler nicht angefasst hat, wird mit der Mitte gewertet. Ein
    // Nuller wäre härter, als das Spiel sein will: ein Aussetzer im Funknetz
    // oder ein Blick zur Seite darf keinen Durchgang verschlucken — und die
    // Mitte ist ohnehin nur ein Viertel der Punkte wert.
    const guess = entry.guess === null || entry.guess === undefined
      ? Math.round((round.low + round.high) / 2)
      : entry.guess;
    const { error, points } = estimateValue(guess, round);
    entry.score += points;
    entry.totalError += error;
    if (error === 0) {
      entry.bullseyes += 1;
      entry.successes += 1;
    }
    entry.guesses.push({ round: round.index, guess, count: round.count, error, points });
    entry.guess = null;
    entry.flash = error === 0 ? "good" : (points > 0 ? null : "bad");
    entry.lastHitAt = now;
    reveal.guesses[player.id] = { guess, error, points };
    syncArcadeScore(minigame, player, entry);
  });
  arcade.lastReveal = reveal;
}

function updateCurling(room, minigame, arcade, dt, now) {
  const stoneRadius = CURLING_STONE_RADIUS;
  const sub = CURLING_SUBSTEPS;
  const h = dt / sub;

  for (let step = 0; step < sub; step += 1) {
    // Glide + wall cushions. Walls are inset by the radius so a stone's edge
    // kisses the boundary and never sinks through it.
    arcade.stones.forEach((stone) => {
      const speed = Math.hypot(stone.vx, stone.vy);
      if (speed < 0.02) {
        stone.vx = 0;
        stone.vy = 0;
        return;
      }
      const damping = Math.exp(-CURLING_FRICTION * h);
      stone.vx *= damping;
      stone.vy *= damping;
      stone.x += stone.vx * h;
      stone.y += stone.vy * h;
      if (stone.x < stoneRadius) { stone.x = stoneRadius; stone.vx = Math.abs(stone.vx) * CURLING_WALL_REST; }
      if (stone.x > 1 - stoneRadius) { stone.x = 1 - stoneRadius; stone.vx = -Math.abs(stone.vx) * CURLING_WALL_REST; }
      if (stone.y < stoneRadius) { stone.y = stoneRadius; stone.vy = Math.abs(stone.vy) * CURLING_WALL_REST; }
      if (stone.y > CURLING_SHEET_Y - stoneRadius) { stone.y = CURLING_SHEET_Y - stoneRadius; stone.vy = -Math.abs(stone.vy) * CURLING_WALL_REST; }
    });

    // Solid stone-on-stone collisions (equal mass, bouncy restitution).
    for (let a = 0; a < arcade.stones.length; a += 1) {
      for (let b = a + 1; b < arcade.stones.length; b += 1) {
        const first = arcade.stones[a];
        const second = arcade.stones[b];
        let dx = second.x - first.x;
        let dy = second.y - first.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= stoneRadius * 2) continue;
        if (distance < 0.0001) { dx = 0.01; dy = 0; distance = 0.01; }
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = (stoneRadius * 2 - distance) / 2;
        first.x -= nx * overlap;
        first.y -= ny * overlap;
        second.x += nx * overlap;
        second.y += ny * overlap;
        const relative = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
        if (relative < 0) {
          const jn = -(1 + CURLING_RESTITUTION) * relative / 2;
          first.vx -= jn * nx;
          first.vy -= jn * ny;
          second.vx += jn * nx;
          second.vy += jn * ny;
          if (now - Math.max(first.lastCollisionAt, second.lastCollisionAt) > 140) {
            arcade.clacks = (arcade.clacks || 0) + 1;
          }
          first.lastCollisionAt = now;
          second.lastCollisionAt = now;
        }
      }
    }
  }

  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return;
    let points = 0;
    let closeness = 0;
    const outer = arcade.rings[arcade.rings.length - 1].radius;
    arcade.stones.forEach((stone) => {
      if (stone.playerId !== player.id) return;
      const distance = Math.hypot(stone.x - arcade.house.x, stone.y - arcade.house.y);
      const ring = arcade.rings.find((candidate) => distance <= candidate.radius);
      if (ring) {
        points += ring.points;
        // Feinwertung innerhalb des Rings: ganz am Knopf zählt mehr als am
        // Innenrand. Ohne das war das Spiel oben gedeckelt.
        closeness += 1 - distance / outer;
      }
    });
    entry.score = points;
    entry.precision = Math.round(
      (closeness / Math.max(1, CURLING_STONES_PER_PLAYER)) * 900);
    syncArcadeScore(minigame, player, entry);
  });
}

function arcadeTargetPosition(arcade, target, now) {
  if (arcade.mode !== "bubble") return { x: target.x, y: target.y };
  const seconds = Math.max(0, now - target.spawnAt) / 1000;
  return {
    x: clamp(target.x + Math.sin(seconds * 2.2 + target.id) * 0.045, 0.05, 0.95),
    y: target.y - (target.rise || 0.2) * seconds
  };
}

function updateKineticWorld(arcade, elapsed, dt, now) {
  if (arcade.mode === "sweep") {
    arcade.sweepAngle = (elapsed / 940) % (Math.PI * 2);
    if (now - arcade.target.changedAt > 4300) relocateArcadeTarget(arcade);
    return;
  }

  if (arcade.mode === "course") {
    arcade.hazards.forEach((hazard) => {
      hazard.y += hazard.speed * dt;
      if (hazard.y <= 1.08) return;
      hazard.wraps += 1;
      hazard.y = -0.08;
      hazard.x = 0.1 + arcadeNoise(arcade.seed + hazard.id * 37 + hazard.wraps * 53) * 0.8;
      hazard.speed = 0.16 + arcadeNoise(arcade.seed + hazard.id * 17 + hazard.wraps * 29) * 0.13;
    });
  }
}

function containKineticPlayer(player) {
  const dx = player.x - 0.5;
  const dy = player.y - 0.5;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0.43) return;
  const nx = dx / Math.max(0.001, distance);
  const ny = dy / Math.max(0.001, distance);
  player.x = 0.5 + nx * 0.43;
  player.y = 0.5 + ny * 0.43;
  const outward = player.vx * nx + player.vy * ny;
  if (outward > 0) {
    player.vx -= nx * outward * 1.72;
    player.vy -= ny * outward * 1.72;
  }
}

function scoreKineticPlayer(arcade, player, dt, now) {
  player.activeMs += dt * 1000;
  player.score += dt * 5;

  if (arcade.mode === "sweep") {
    const targetDistance = Math.hypot(player.x - arcade.target.x, player.y - arcade.target.y);
    if (targetDistance < 0.095 && now - arcade.target.changedAt > 330) {
      player.successes += 1;
      player.score += 18 + Math.min(6, player.streak);
      player.streak += 1;
      player.flash = "good";
      player.lastHitAt = now;
      relocateArcadeTarget(arcade);
    }

    if (now < player.collisionUntil) return;
    const dx = player.x - 0.5;
    const dy = player.y - 0.5;
    const cos = Math.cos(arcade.sweepAngle);
    const sin = Math.sin(arcade.sweepAngle);
    const along = Math.abs(dx * cos + dy * sin);
    const signedAcross = dx * -sin + dy * cos;
    if (along < 0.42 && Math.abs(signedAcross) < 0.055) {
      const side = Math.sign(signedAcross) || 1;
      player.vx += -sin * side * 0.78;
      player.vy += cos * side * 0.78;
      player.mistakes += 1;
      player.score = Math.max(0, player.score - 8);
      player.streak = 0;
      player.flash = "bad";
      player.lastHitAt = now;
      player.collisionUntil = now + 720;
    }
    return;
  }

  if (arcade.mode === "course" && now >= player.collisionUntil) {
    const hazard = arcade.hazards.find((candidate) => Math.hypot(player.x - candidate.x, player.y - candidate.y) < candidate.radius + 0.06);
    if (!hazard) return;
    const dx = player.x - hazard.x || 0.01;
    const dy = player.y - hazard.y || -0.01;
    const distance = Math.max(0.01, Math.hypot(dx, dy));
    player.vx += dx / distance * 0.72;
    player.vy += dy / distance * 0.72;
    player.mistakes += 1;
    player.score = Math.max(0, player.score - 10);
    player.streak = 0;
    player.flash = "bad";
    player.lastHitAt = now;
    player.collisionUntil = now + 620;
  }
}

function updateDirectWorld(room, minigame, arcade, elapsed, dt, now) {
  if (arcade.mode === "catch") {
    while (now - arcade.lastSpawnAt >= arcade.spawnMs && arcade.drops.length < 12) {
      arcade.lastSpawnAt += arcade.spawnMs;
      const id = arcade.nextTargetId;
      arcade.nextTargetId += 1;
      const spawnAt = Math.max(minigame.startedAt, arcade.lastSpawnAt);
      arcade.drops.push({
        id,
        x: 0.1 + arcadeNoise(arcade.seed + id * 41) * 0.8,
        kind: arcadeNoise(arcade.seed + id * 67 + 9) < 0.22 ? "storm" : "glow",
        tone: id % 4,
        spawnAt,
        impactAt: spawnAt + 1800,
        expiresAt: spawnAt + 2250
      });
    }
    arcade.drops = arcade.drops.filter((drop) => now < drop.expiresAt + 500);
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      arcade.drops.forEach((drop) => {
        if (now < drop.impactAt || entry.hitTargets[drop.id]) return;
        entry.hitTargets[drop.id] = true;
        const caught = Math.abs(entry.x - drop.x) < 0.135;
        if (caught && drop.kind === "glow") {
          entry.successes += 1;
          entry.streak += 1;
          entry.score += 11 + Math.min(6, entry.streak);
          entry.flash = "good";
          entry.lastHitAt = now;
        } else if (caught) {
          entry.mistakes += 1;
          entry.streak = 0;
          entry.score = Math.max(0, entry.score - 10);
          entry.flash = "bad";
          entry.lastHitAt = now;
        } else if (drop.kind === "glow") {
          entry.streak = 0;
        }
      });
      syncArcadeScore(minigame, player, entry);
    });
    return;
  }

  if (arcade.mode === "balance") {
    arcade.target.x = clamp(0.5 + Math.sin(elapsed / 710) * 0.25 + Math.sin(elapsed / 260 + 1.4) * 0.055, 0.15, 0.85);
    arcade.wind = Math.sin(elapsed / 840 + arcade.seed) * 0.5 + Math.sin(elapsed / 310) * 0.5;
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const response = Math.min(1, dt * 8.5);
      entry.x += (entry.desiredX - entry.x) * response;
      entry.x = clamp(entry.x + arcade.wind * dt * 0.018, 0.06, 0.94);
      const wasInside = entry.inside;
      entry.inside = Math.abs(entry.x - arcade.target.x) <= arcade.zoneWidth;
      if (entry.hasMoved) {
        if (entry.inside) entry.activeMs += dt * 1000;
        entry.score = Math.max(0, entry.score + (entry.inside ? dt * 14 : -dt * 2));
        if (entry.inside !== wasInside) {
          entry.flash = entry.inside ? "good" : "bad";
          entry.lastHitAt = now;
        }
      }
      syncArcadeScore(minigame, player, entry);
    });
  }
}

// Ringplan für Falschsignal. Aus dem Seed erzeugt, damit alle Clients dieselbe
// Folge sehen und der Server sie autoritativ auswerten kann.
function buildFeintSignals(seed, durationMs) {
  const signals = [];
  let at = FEINT_LEAD_IN_MS;
  let index = 0;
  while (at < durationMs - FEINT_GROW_MS - FEINT_HOLD_MS) {
    const roll = arcadeNoise(seed + index * 13);
    // Blockweise geplant: in jedem Dreierblock ist GENAU ein Ring echt. Ein
    // freier Würfel pro Ring traf beides — mit einem Seed war die Hälfte echt
    // (blindes Tippen zahlte sich aus), mit dem nächsten kamen fünf Fälschungen
    // in Folge und die Runde fühlte sich kaputt an. Die Position im Block bleibt
    // zufällig, die Mischung nicht.
    const block = Math.floor(index / FEINT_BLOCK);
    const goSlot = Math.min(FEINT_BLOCK - 1, Math.floor(arcadeNoise(seed + block * 29) * FEINT_BLOCK));
    const slot = index % FEINT_BLOCK;
    const real = slot === goSlot;
    // Die Fälschungen rotieren, statt frei gewürfelt zu werden: gewürfelt kamen
    // drei fast gleiche in Folge, und die schwerste tauchte manchmal eine ganze
    // Runde nicht auf.
    const fakeSlot = slot > goSlot ? slot - 1 : slot;
    const rotation = Math.floor(arcadeNoise(seed + block * 41) * FEINT_FAKE_LIMITS.length);
    const limit = real ? 1 : FEINT_FAKE_LIMITS[(block + fakeSlot + rotation) % FEINT_FAKE_LIMITS.length];
    // Wie lange der Ring überhaupt zu sehen ist. Ein echter wächst bis zur Marke
    // und steht dann noch kurz; ein falscher bleibt stehen und verlischt.
    const windowMs = real
      ? FEINT_GROW_MS + FEINT_HOLD_MS
      : Math.round(FEINT_GROW_MS * limit * 1.25 + FEINT_FADE_MS);
    signals.push({ index, at, real, limit, kind: real ? "go" : "fake", windowMs });
    at += windowMs + FEINT_GAP_MIN_MS + roll * (FEINT_GAP_MAX_MS - FEINT_GAP_MIN_MS);
    index += 1;
  }
  return signals;
}

// Der Ring, der zum Zeitpunkt `elapsed` gerade zu sehen ist — oder null.
function activeFeintSignal(signals, elapsed) {
  for (const signal of signals) {
    if (elapsed >= signal.at && elapsed <= signal.at + signal.windowMs) return signal;
    if (signal.at > elapsed) break;      // Plan ist zeitlich sortiert
  }
  return null;
}

// Radius eines Rings, `since` Millisekunden nach seinem Erscheinen.
//
// Das ist der Kern des ganzen Spiels. Echt und falsch starten mit EXAKT
// derselben Geschwindigkeit und laufen erst nach und nach auseinander: der
// echte Ring wächst gleichmässig bis zur Marke, der falsche wird langsamer und
// bleibt vor ihr stehen. Deshalb sammelt sich die Information über die Zeit an,
// statt sofort da zu sein — früh tippen ist geraten, spät tippen ist sicher.
//
// Für kleine Zeiten gilt tanh(x) ≈ x, und limit·tanh(t/(T·limit)) ist damit am
// Anfang genau t/T — also dasselbe wie beim echten Ring. Genau darauf kommt es
// an: wäre der Unterschied von Anfang an sichtbar, gäbe es nichts zu wetten.
function feintRadius(signal, since) {
  const t = Math.max(0, since);
  if (signal.real) return clamp(t / FEINT_GROW_MS, 0, 1);
  const limit = signal.limit;
  return limit * Math.tanh(t / (FEINT_GROW_MS * limit));
}

// Punkte für einen Treffer, nach dem Radius im Moment des Tippens. Wer bei 0.3
// tippt, hat kaum Information und bekommt fast die volle Punktzahl; wer bis zur
// Marke wartet, ist sicher und bekommt den Rest.
function feintPoints(radiusAtTap) {
  const share = clamp(1 - clamp(radiusAtTap, 0, 1), 0, 1);
  return Math.round(FEINT_MIN_POINTS + (FEINT_MAX_POINTS - FEINT_MIN_POINTS) * Math.pow(share, 1.25));
}

// Die Spur von Spurmaler: für den Fortschritt t (0 unten … 1 oben) die
// Querposition. Der Weg läuft immer nach oben und kehrt nie um — so gibt es
// keine Kreuzungen, an denen unklar wäre, wohin der Finger als nächstes soll.
// Client und Server leiten die Kurve aus derselben Funktion ab.
function tracePathX(seed, lap, t) {
  const s = seed + lap * 97;
  // Amplituden zusammen höchstens 0.34, damit die Spur samt Band im Bild bleibt
  // (0.16 … 0.84 plus 0.085 Toleranz).
  const swing = 0.18 + arcadeNoise(s) * 0.08;
  const detail = 0.04 + arcadeNoise(s + 11) * 0.04;
  const phase = arcadeNoise(s + 23) * Math.PI * 2;
  const bows = 1 + Math.floor(arcadeNoise(s + 37) * 2.999);
  const raw = Math.sin(t * Math.PI * bows + phase) * swing
    + Math.sin(t * Math.PI * (bows * 2 + 1) + phase * 1.7) * detail;
  return clamp(0.5 + raw, 0.5 - (swing + detail), 0.5 + (swing + detail));
}

// Wie weit der Finger von der Spur weg ist, an der Höhe, auf der er steht.
// Wie breit das Toleranzband an dieser Stelle ist, als Anteil von
// TRACE_TOLERANCE. Zwei bis drei Engstellen je Runde, an fester Stelle aus dem
// Startwert — nicht zufällig pro Tick, sonst wäre dieselbe Stelle mal eng und
// mal weit und ein Abriss wirkte willkürlich.
function traceWidthAt(seed, lap, t) {
  const s = seed + lap * 97;
  const knots = 2 + Math.floor(arcadeNoise(s + 61) * 2);   // 2 oder 3
  const phase = arcadeNoise(s + 71) * Math.PI * 2;
  // Eine Schwingung, deren Wellentäler die Engstellen sind. Sie läuft an den
  // Rändern der Runde weit aus, damit Ansetzen und Abschluss nie am Nadelöhr
  // liegen — dort hat man den Finger noch nicht auf der Kurve.
  const wave = (Math.cos(t * Math.PI * 2 * knots + phase) + 1) / 2;
  const edge = Math.min(1, Math.min(t, 1 - t) / 0.12);
  const narrow = TRACE_NARROW_MIN + (1 - TRACE_NARROW_MIN) * wave;
  return narrow + (1 - narrow) * (1 - edge);
}

// Erlaubter Abstand zur Spur an dieser Stelle.
function traceToleranceAt(seed, lap, t) {
  return TRACE_TOLERANCE * traceWidthAt(seed, lap, t);
}

// Die Kristalle einer Runde. Sie liegen ABSEITS der Mittellinie, abwechselnd
// links und rechts — genau das macht aus "im Band bleiben" ein Steuern.
function buildTraceGems(seed, lap) {
  const s = seed + lap * 97;
  // Erst die weiten Abschnitte suchen, DANN die Kristalle darauf verteilen.
  //
  // Andersherum — feste Abstände und bei einer Engstelle ausweichen — ging
  // zweimal schief: das Ausweichen schob einen Kristall über den nächsten
  // hinweg, und wenn oberhalb nichts Weites mehr kam, landete er doch auf einer
  // Engstelle. Ein Kristall am Bandrand PLUS eine Engstelle heisst aber, dass
  // die eine Aufgabe die andere unmöglich macht.
  const wide = [];
  for (let t = 0.10; t <= 0.90; t += 0.01) {
    if (traceWidthAt(seed, lap, t) >= 0.8) wide.push(t);
  }
  if (wide.length === 0) return [];

  const gems = [];
  for (let i = 0; i < TRACE_GEMS_PER_LAP; i += 1) {
    // Gleichmässig über die verfügbaren Abschnitte verteilt, mit etwas Streuung.
    const share = (i + 0.5) / TRACE_GEMS_PER_LAP;
    const jitter = (arcadeNoise(s + i * 53) - 0.5) * 0.6 / TRACE_GEMS_PER_LAP;
    const pick = wide[clamp(Math.round((share + jitter) * (wide.length - 1)), 0, wide.length - 1)];
    // Zu dicht beieinander wären zwei Kristalle einer zu viel.
    if (gems.length > 0 && pick <= gems[gems.length - 1].t + 0.05) continue;
    const t = Math.round(pick * 1000) / 1000;
    const side = arcadeNoise(s + i * 53 + 7) < 0.5 ? -1 : 1;
    // `offset` ist der seitliche Versatz zur Mittellinie und die Zahl, an der
    // gemessen wird. `x` ist nur fürs Zeichnen da: die Kurve wandert, und ein
    // Vergleich roher x-Werte fiel deshalb manchmal von selbst richtig aus —
    // gemessen fiel ein Kristall zu, während der Finger sauber auf der
    // Mittellinie lag, nur weil die Kurve gerade an ihm vorbeischwang.
    const offset = side * traceToleranceAt(seed, lap, t) * TRACE_GEM_SIDE;
    const x = clamp(tracePathX(seed, lap, t) + offset, 0.04, 0.96);
    gems.push({ index: gems.length, t, side, offset, x });
  }
  return gems;
}

function traceOffset(seed, lap, x, y) {
  return Math.abs(x - tracePathX(seed, lap, clamp(y, 0, 1)));
}

function paintIndex(col, row) {
  return row * PAINT_COLS + col;
}

function paintInside(col, row) {
  return col >= 0 && col < PAINT_COLS && row >= 0 && row < PAINT_ROWS;
}

// Ein Feld beanspruchen. Kein Treffer, sondern Arbeit über Zeit: fremder
// Anspruch muss erst abgetragen werden, dann der eigene aufgebaut. Meldet, was
// in diesem Schritt passiert ist.
function paintClaim(arcade, entry, col, row, playerId, dt) {
  if (!paintInside(col, row)) return "outside";
  const at = paintIndex(col, row);
  const owner = arcade.grid[at];
  const step = PAINT_CLAIM_RATE * dt;

  if (owner === playerId) {
    // Eigenes Feld: der Anspruch wird nur aufgefrischt, es gibt nichts zu holen.
    arcade.charge[at] = 1;
    return "mine";
  }
  if (owner) {
    // Fremdes Feld: einmal drüber genügt. Vorher wurde es beim Nulldurchgang
    // nur NEUTRAL — man musste ein zweites Mal darüberfahren, um es wirklich zu
    // bekommen. Das fühlte sich an, als würde das Malen nicht wirken.
    arcade.charge[at] -= step * PAINT_STEAL_RATE;
    if (arcade.charge[at] > 0) return "eroding";
    arcade.grid[at] = playerId;
    arcade.charge[at] = 0;      // frisch übernommen, noch nicht gefestigt
    entry.claimed += 1;
    return "claimed";
  }
  arcade.charge[at] += step;
  if (arcade.charge[at] < 1) return "claiming";
  arcade.grid[at] = playerId;
  arcade.charge[at] = 1;
  entry.claimed += 1;
  return "claimed";
}

// Alle Felder, die ein Pinselstrich trifft. Die breite Rolle nimmt die vier
// Nachbarn mit — genug, um einen Vorsprung zu machen, aber kein Freifahrtschein.
function paintBrushTiles(col, row, wide) {
  const tiles = [[col, row]];
  if (wide) tiles.push([col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]);
  return tiles;
}

function paintOwnedCount(arcade, playerId) {
  let owned = 0;
  for (const owner of arcade.grid) if (owner === playerId) owned += 1;
  return owned;
}

// Der Kampfplan eines Fisches: abwechselnd Ruhe und Schub, aus dem Seed
// erzeugt. Client und Server leiten ihn aus derselben Funktion ab, damit die
// Anzeige exakt das zeigt, was gewertet wird.
// Welche Art am Haken hängt. Hängt nur an Startwert und laufender Nummer, nie
// an der Uhr — sonst zöge dieselbe Runde bei jedem anders.
function fishSpeciesFor(seed, catchIndex) {
  const total = FISH_SPECIES.reduce((sum, kind) => sum + kind.weight, 0);
  let roll = arcadeNoise(seed * 3 + catchIndex * 271) * total;
  for (const kind of FISH_SPECIES) {
    roll -= kind.weight;
    if (roll <= 0) return kind;
  }
  return FISH_SPECIES[0];
}

function buildFishPhases(seed, catchIndex, durationMs, species = null) {
  const phases = [];
  let at = FISH_LEAD_IN_MS;
  let index = 0;
  const base = seed + catchIndex * 131;
  // Grosse Fische schieben länger und ruhen kürzer. Das ist der Unterschied,
  // den man ohne hinzusehen im Daumen merkt.
  const heft = species ? species.surge : 1;
  while (at < durationMs) {
    const calm = (FISH_CALM_MIN_MS + arcadeNoise(base + index * 17) * (FISH_CALM_MAX_MS - FISH_CALM_MIN_MS)) / heft;
    const surge = (FISH_SURGE_MIN_MS + arcadeNoise(base + index * 29) * (FISH_SURGE_MAX_MS - FISH_SURGE_MIN_MS)) * Math.min(1.5, heft);
    phases.push({ index, at: at + calm, until: at + calm + surge });
    at += calm + surge;
    index += 1;
  }
  return phases;
}

// Der Schub, in dem der Fisch gerade steckt — oder null. `elapsed` zählt ab dem
// Anbiss, nicht ab Rundenbeginn: jeder neue Fisch fängt mit seinem eigenen Plan an.
function activeFishPhase(phases, elapsed) {
  for (const phase of phases) {
    if (elapsed >= phase.at && elapsed < phase.until) return phase;
    if (phase.at > elapsed) break;
  }
  return null;
}

function fishSurging(phases, elapsed) {
  return activeFishPhase(phases, elapsed) !== null;
}

// Wertung: der Wert der gelandeten Fische, der angefangene Weg am aktuellen und
// ein Abzug je Riss.
//
// Vorher zählte jeder Fisch gleich viel. Damit war die beste Strategie, so viele
// wie möglich zu landen, und welcher Fisch am Haken hing war gleichgültig — das
// ist der Grund, warum sich das Spiel immer gleich anfühlte.
function fishScore(entry) {
  const haul = entry.haul || 0;
  const kind = entry.species || FISH_SPECIES[1];
  const progress = Math.round((1 - clamp(entry.distance ?? 1, 0, 1)) * kind.points);
  const lost = entry.snapLoss ?? (entry.snaps || 0) * FISH_SNAP_COST;
  return haul + progress - lost;
}

// Wert der Stufe `depth`. Wächst linear, damit die Beute quadratisch wächst und
// damit auch das, was ein Einsturz kostet — genau daraus entsteht die Spannung.
function diveGain(depth) {
  return DIVE_BASE_GAIN + DIVE_STEP_GAIN * Math.max(1, depth);
}

// Beute, die bis zu dieser Tiefe im Schacht hängt.
function diveCarried(depth) {
  let sum = 0;
  for (let i = 1; i <= depth; i += 1) sum += diveGain(i);
  return sum;
}

// Einsturzrisiko beim Graben AUF diese Stufe — der Mittelwert der Kurve.
function diveRisk(depth) {
  return Math.min(DIVE_RISK_MAX, DIVE_RISK_BASE + DIVE_RISK_STEP * Math.max(0, depth - 1));
}

// Das TATSÄCHLICHE Risiko dieses einen Spatenstichs. Es schwankt um die Kurve
// herum, steht von Anfang an fest und wird dem Spieler auf den Prozentpunkt
// genau angezeigt.
//
// Ohne diese Schwankung war das Spiel eine einzige Rechenaufgabe, die man
// einmal löst und danach stur abspult: gemessen lagen alle drei Bot-Stufen
// innerhalb von 0.3 Plätzen, weil es je Runde nur eine einzige richtige Tiefe
// gab und die zu treffen keine Leistung ist. Jetzt ist jeder Stich eine eigene
// Frage — mal ist die vierte Stufe billig, mal ist schon die zweite eine Falle.
function diveRiskAt(seed, diveIndex, depth) {
  const base = diveRisk(depth);
  const roll = arcadeNoise(seed + diveIndex * 613 + depth * 71);
  const swing = 0.5 + roll;            // 0.5 … 1.5
  return clamp(base * swing, 0.02, 0.88);
}

// Der Erwartungswert des nächsten Spatenstichs: Gewinn mal Gegenwahrscheinlichkeit
// minus alles, was man dabei verlieren kann. Er wird auch dem Spieler angezeigt
// (als Risiko in Prozent) — geraten wird hier nichts, entschieden schon.
function diveStepValue(depth) {
  const risk = diveRisk(depth + 1);
  return (1 - risk) * diveGain(depth + 1) - risk * diveCarried(depth);
}

// Die Tiefe, die über die RUNDE das meiste Gold bringt.
//
// Der Grenznutzen allein ist die falsche Frage: nach ihm lohnte sich der
// nächste Stich bis Tiefe 5, aber tief graben kostet auch Zeit, und in derselben
// Zeit schafft man zwei flache Tauchgänge. Gemessen verlor der Bot, der bis 5
// ging, gegen den, der bei 3 einzahlte. Gerechnet wird darum Gold pro Sekunde,
// samt Auftauch- und Benommenheitszeit — und das ist auch die Antwort, zu der
// ein Mensch nach ein paar Runden von selbst kommt.
function diveBestDepth() {
  let best = 1;
  let bestRate = -Infinity;
  for (let depth = 1; depth <= DIVE_MAX_DEPTH; depth += 1) {
    let survival = 1;
    for (let k = 1; k <= depth; k += 1) survival *= (1 - diveRisk(k));
    const gold = survival * diveCarried(depth);
    const seconds = (depth * DIVE_STEP_MS + survival * DIVE_SURFACE_MS + (1 - survival) * DIVE_STUN_MS) / 1000;
    const rate = gold / seconds;
    if (rate > bestRate) { bestRate = rate; best = depth; }
  }
  return best;
}

// Lichte Weite eines Tores. Wird über die Runde enger — der Anfang ist zum
// Lernen da, das Ende zum Schwitzen.
function glideGateGap(elapsed, durationMs = GLIDE_DURATION_MS) {
  const share = clamp(elapsed / Math.max(1, durationMs), 0, 1);
  return GLIDE_GATE_GAP_START + (GLIDE_GATE_GAP_END - GLIDE_GATE_GAP_START) * share;
}

// Der ganze Kurs, im Voraus und aus dem Startwert. Zwei Gründe: alle vier
// fliegen denselben Kurs, und der Client kann weit vorausschauen, statt Tore
// aus dem Nichts auftauchen zu lassen.
//
// Der Sprung zum nächsten Tor ist begrenzt (GLIDE_GATE_MAX_STEP). Ohne die
// Grenze käme irgendwann ein Tor, das aus der aktuellen Höhe in der Zeit
// physikalisch nicht erreichbar ist — das wäre nicht schwer, sondern unfair,
// und man merkt den Unterschied im Spiel sofort.
function buildGlideGates(seed, durationMs = GLIDE_DURATION_MS) {
  const gates = [];
  let at = GLIDE_GATE_FIRST_MS;
  let y = 0.5;
  let index = 0;
  while (at < durationMs - 600) {
    const gap = glideGateGap(at, durationMs);
    // Der Sprung darf nicht beliebig klein sein, sonst steht der Kurs still.
    // Ein Mindestabstand von einer halben lichten Weite heisst: jedes Tor
    // verlangt eine Bewegung, aber keine hektische.
    const roll = arcadeNoise(seed + index * 421);
    const dir = arcadeNoise(seed + index * 421 + 11) < 0.5 ? -1 : 1;
    const step = (gap * 0.5 + roll * (GLIDE_GATE_MAX_STEP - gap * 0.5)) * dir;
    // Am Rand die RICHTUNG drehen statt zu klemmen oder zu spiegeln. Klemmen
    // klebte mehrere Tore in Folge an der Decke — man flöge oben entlang, ohne
    // etwas zu tun. Spiegeln behielt zwar den Abstand zum Rand, verkürzte aber
    // den Sprung, und dann kamen Tore, die praktisch stillstanden. Umdrehen
    // erhält die Sprungweite exakt, und die ist hier die eigentliche Aufgabe.
    const margin = gap / 2 + 0.06;
    let next = y + step;
    if (next < margin || next > 1 - margin) next = y - step;
    y = clamp(next, margin, 1 - margin);
    gates.push({ index, at, y: Math.round(y * 1000) / 1000, gap: Math.round(gap * 1000) / 1000 });
    at += GLIDE_GATE_EVERY_MS;
    index += 1;
  }
  return gates;
}

// Bandgeschwindigkeit. Waechst linear ueber die Runde — der Anfang ist zum
// Lernen da, das Ende zum Schwitzen.
function beltSpeed(elapsed, durationMs = BELT_DURATION_MS) {
  const share = clamp(elapsed / Math.max(1, durationMs), 0, 1);
  return BELT_SPEED_START + (BELT_SPEED_END - BELT_SPEED_START) * share;
}

// Stabiler Startwert je Spieler-ID, damit jede Person ihre eigene Paketfolge
// bekommt und trotzdem alles vorhersagbar bleibt.
function hashBeltSeed(id) {
  let h = 2166136261;
  const text = String(id);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 100000);
}

// Der komplette Farbplan der Rutschen, im Voraus. Zwei Gruende: der Client kann
// den naechsten Tausch ankuendigen, ohne zu raten, und der Ablauf haengt nicht
// an der Tickrate. Jede Anordnung unterscheidet sich von der vorherigen an
// MINDESTENS zwei Stellen — sonst faellt ein Tausch nicht auf.
function buildBeltChutePlan(seed, durationMs = BELT_DURATION_MS) {
  const base = [];
  for (let i = 0; i < BELT_CHUTES; i += 1) base.push(i % BELT_COLOURS);
  const plan = [{ at: 0, chutes: base.slice() }];
  let at = BELT_SWAP_FIRST_MS;
  let step = 0;
  while (at < durationMs) {
    const previous = plan[plan.length - 1].chutes;
    let next = previous.slice();
    let guard = 0;
    do {
      next = previous.slice();
      // Fisher-Yates mit festem Startwert: gleiche Runde, gleicher Ablauf.
      for (let i = next.length - 1; i > 0; i -= 1) {
        const r = arcadeNoise(seed + step * 977 + i * 31);
        const j = Math.floor(r * (i + 1));
        const tmp = next[i];
        next[i] = next[j];
        next[j] = tmp;
      }
      step += 1;
      guard += 1;
    } while (guard < 12 && next.filter((colour, i) => colour !== previous[i]).length < 2);
    plan.push({ at, chutes: next });
    at += BELT_SWAP_EVERY_MS;
  }
  return plan;
}

// Ein Paket. Die Farbe haengt nur an Startwert und laufender Nummer, nie am
// Zeitpunkt — sonst laege dieselbe Runde bei jedem anders.
function makeBeltParcel(arcade, seed, index) {
  const r = arcadeNoise(seed + index * 613);
  return {
    id: index,
    colour: Math.floor(r * BELT_COLOURS) % BELT_COLOURS,
    // Groesse ist reine Optik, aber sie macht das Band lebendig statt gleichfoermig.
    size: 0.8 + arcadeNoise(seed + index * 613 + 7) * 0.45
  };
}

// Naechstes Paket nachruecken. Das Band springt NICHT auf 0 zurueck: die Pakete
// stehen in festem Abstand, also ruecken sie beim Sortieren um genau diesen
// Abstand vor. Wer frueh greift, gewinnt dadurch echte Zeit beim naechsten.
//
// Ein DURCHGERUTSCHTES Paket ist die Ausnahme: dort stuende das naechste sonst
// schon fast an der Kante, und ein einziger Aussetzer wuerde sich durch die
// halbe Runde durchreissen. Das waere kein Koennen mehr, sondern eine Strafe,
// die sich selbst verstaerkt — die Strafe sind die Punkte und die Serie.
function advanceBeltQueue(arcade, entry, missed = false) {
  entry.queue.shift();
  entry.queue.push(makeBeltParcel(arcade, entry.parcelSeed, entry.nextParcel));
  entry.nextParcel += 1;
  entry.beltPos = missed ? 0 : Math.max(0, entry.beltPos - BELT_GAP);
}

// Wertung: geschaffte Runden plus der angefangene Rest, ein Bonus für ganz
// saubere Runden und ein Abzug je Abrutscher. Der Bonus ist der Grund, warum
// sich Genauigkeit lohnt und nicht nur Tempo.
function traceScore(entry) {
  const laps = (entry.lapsDone || 0) * TRACE_LAP_POINTS;
  const partial = Math.round((entry.progress || 0) * TRACE_LAP_POINTS);
  const clean = (entry.cleanLaps || 0) * TRACE_CLEAN_BONUS;
  const gems = (entry.gemsTotal || 0) * TRACE_GEM_POINTS;
  return laps + partial + clean + gems - (entry.slips || 0) * TRACE_SLIP_COST;
}

// Der Abstand VOR dem Schlag mit dieser Nummer. Innerhalb eines Taktes von acht
// Schlägen bleibt er gleich; an der Taktgrenze fällt er auf die nächste Stufe.
function bounceInterval(index) {
  const bar = Math.floor(Math.max(0, index - 1) / BOUNCE_BAR_BEATS);
  return BOUNCE_TEMPOS[Math.min(bar, BOUNCE_TEMPOS.length - 1)];
}

// Nummer des Taktes, in dem dieser Schlag liegt — der Client kündigt damit den
// Tempowechsel an, statt ihn überraschend kommen zu lassen.
function bounceBar(index) {
  return Math.floor(Math.max(0, index) / BOUNCE_BAR_BEATS);
}

// Zeitpunkt des n-ten Taktschlags, relativ zum Spielstart. Client und Server
// leiten die Taktzeiten aus derselben Funktion ab.
function bounceBeatTime(index) {
  let time = 0;
  for (let i = 1; i <= index; i += 1) time += bounceInterval(i);
  return time;
}

// Der Schlag, der `elapsed` am nächsten liegt, samt Abweichung in ms.
function bounceNearestBeat(elapsed) {
  // Vorwärts zählen ist bei höchstens ~60 Schlägen pro Runde billig und exakt.
  let index = 0;
  let time = 0;
  let bestIndex = 0;
  let bestDelta = Math.abs(elapsed);
  while (time <= elapsed + BOUNCE_BEAT_START_MS) {
    const delta = Math.abs(elapsed - time);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
    index += 1;
    time += bounceInterval(index);
  }
  return { index: bestIndex, offsetMs: elapsed - bounceBeatTime(bestIndex) };
}

// Neuer Anrollwinkel für den Stein. Der Stein steht nie still: läge er in der
// Mitte, hätte ihn niemand im eigenen Viertel, also stiesse niemand, also bliebe
// er liegen — gemessen kam so eine ganze Runde ohne einen einzigen Stoss
// zustande. Er startet leicht aus der Mitte versetzt, damit sofort sichtbar ist,
// auf wen er zuläuft.
function serveSumoStone(arcade, seed) {
  const angle = arcadeNoise(seed * 7 + 13) * Math.PI * 2;
  arcade.stone.x = Math.cos(angle) * arcade.ringRadius * 0.14;
  arcade.stone.y = Math.sin(angle) * arcade.ringRadius * 0.14;
  arcade.stone.vx = Math.cos(angle) * SUMO_SERVE_SPEED;
  arcade.stone.vy = Math.sin(angle) * SUMO_SERVE_SPEED;
}

// Steinphysik für Sumo-Schubs: Reibung, Rand-Check, Treffer und Ausscheiden.
// Bewusst schlicht gehalten (ein Körper, keine Kollisionen), damit die Wertung
// serverautoritativ bleibt, ohne den 90-ms-Tick zu belasten.
function updateSumoStone(room, minigame, arcade, dt, now) {
  const stone = arcade.stone;
  if (!stone) return;

  // Erst laufen alle ein Stück weiter um den Ring, dann wird gestossen. Wer
  // ausgeschieden ist, bleibt stehen — sonst liefe ein leerer Platz mit und
  // verschöbe die Wertung des Austritts.
  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry || entry.eliminated) return;
    entry.angle += (entry.orbit || SUMO_ORBIT_BASE) * dt;
    if (entry.angle > Math.PI) entry.angle -= Math.PI * 2;
    entry.spotX = Math.cos(entry.angle);
    entry.spotY = Math.sin(entry.angle);
  });

  // Reibung bremst den Stein, sonst kreist er endlos.
  const damp = Math.max(0, 1 - SUMO_FRICTION * dt);
  stone.vx *= damp;
  stone.vy *= damp;
  stone.x += stone.vx * dt;
  stone.y += stone.vy * dt;

  const distance = Math.hypot(stone.x, stone.y);
  if (distance > arcade.ringRadius) {
    // Der Stein hat den Ring verlassen: der Spieler, dessen Platz am nächsten
    // an der Austrittsrichtung liegt, kassiert den Treffer.
    let victim = null;
    let best = -Infinity;
    const nx = stone.x / (distance || 1);
    const ny = stone.y / (distance || 1);
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry || entry.eliminated) return;
      // Skalarprodukt: grösster Wert = Platz liegt in Austrittsrichtung.
      const alignment = entry.spotX * nx + entry.spotY * ny;
      if (alignment > best) {
        best = alignment;
        victim = { player, entry };
      }
    });

    if (victim) {
      victim.entry.hits += 1;
      victim.entry.flash = "bad";
      victim.entry.lastHitAt = now;
      victim.entry.lastHitFrom = { x: stone.x, y: stone.y, at: now };
      if (victim.entry.hits >= arcade.hitsOut) {
        victim.entry.eliminated = true;
        victim.entry.eliminatedAt = now;
        // Für die Rangfolge zählt die Zeit IN der Runde, nicht der Zeitstempel
        // der Uhr: ein Epochenwert (1.7e12) überholt jede Punktzahl.
        victim.entry.eliminatedMs = Math.max(1, now - minigame.startedAt);
      }
    }

    // Der Stein rollt sofort wieder los, auf jemand anderen zu. Blieb er in der
    // Mitte liegen, hatte ihn niemand im Viertel und das Spiel stand still.
    serveSumoStone(arcade, Math.round(now));
    arcade.resetAt = now;
  }

  // Punkte: was man NICHT abbekommen hat, plus die Abwehr.
  //
  // Hier stand die geleistete Schubarbeit (Kraft mal Konterbonus, aufsummiert).
  // Das war eine Belohnung fürs Drücken: gemessen stiess der schwächste Bot am
  // häufigsten und gewann dadurch die Runde, obwohl er am wenigsten konnte.
  // Gewertet wird jetzt das, worum das Spiel geht — nicht getroffen werden und
  // im richtigen Moment geladen dastehen.
  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return;
    const survived = entry.eliminated ? 0 : 1000;
    entry.score = survived
      + Math.max(0, arcade.hitsOut - entry.hits) * 120
      + (entry.blocks || 0) * 45;
    syncArcadeScore(minigame, player, entry);
  });
}

function updateArcadeWorld(arcade, elapsed, dt, now) {
  if (arcade.mode === "chase") {
    arcade.target.x = 0.5 + Math.sin(elapsed / 880) * 0.3;
    arcade.target.y = 0.48 + Math.cos(elapsed / 1160) * 0.27;
  } else if (arcade.mode === "stay") {
    arcade.target.x = 0.5 + Math.sin(elapsed / 1320) * 0.24;
    arcade.target.y = 0.48 + Math.sin(elapsed / 920 + 1.3) * 0.22;
  } else if (arcade.mode === "avoid") {
    arcade.hazards.forEach((hazard) => {
      hazard.x += hazard.vx * dt;
      hazard.y += hazard.vy * dt;
      if (hazard.x < 0.08 || hazard.x > 0.92) hazard.vx *= -1;
      if (hazard.y < 0.1 || hazard.y > 0.9) hazard.vy *= -1;
      hazard.x = clamp(hazard.x, 0.08, 0.92);
      hazard.y = clamp(hazard.y, 0.1, 0.9);
    });
  }
  if (arcade.mode === "collect" && now - arcade.target.changedAt > 3300) relocateArcadeTarget(arcade);
}

function scoreArcadeSteerPlayer(arcade, player, dt, now) {
  if (!player.hasMoved && arcade.mode !== "avoid") return;
  const distance = Math.hypot(player.x - arcade.target.x, player.y - arcade.target.y);
  if (arcade.mode === "collect" && now - arcade.target.changedAt > 450 && distance < 0.105) {
    player.successes += 1;
    player.score += 14;
    player.streak += 1;
    player.flash = "good";
    player.lastHitAt = now;
    relocateArcadeTarget(arcade);
  } else if (arcade.mode === "chase") {
    if (distance < 0.16) {
      player.activeMs += dt * 1000;
      player.score += dt * 12;
    }
  } else if (arcade.mode === "stay") {
    if (distance < 0.22) {
      player.activeMs += dt * 1000;
      player.score += dt * 10;
    }
    else if (distance > 0.38) player.score = Math.max(0, player.score - dt * 2);
  } else if (arcade.mode === "avoid") {
    player.activeMs += dt * 1000;
    player.score += dt * 5;
    if (now >= player.collisionUntil) {
      const hazard = arcade.hazards.find((candidate) => Math.hypot(player.x - candidate.x, player.y - candidate.y) < candidate.radius + 0.06);
      if (hazard) {
        const dx = player.x - hazard.x || 0.01;
        const dy = player.y - hazard.y || 0.01;
        const distanceToHazard = Math.max(0.01, Math.hypot(dx, dy));
        player.vx += dx / distanceToHazard * 0.7;
        player.vy += dy / distanceToHazard * 0.7;
        player.mistakes += 1;
        player.score = Math.max(0, player.score - 10);
        player.flash = "bad";
        player.lastHitAt = now;
        player.collisionUntil = now + 650;
      }
    }
  }
}

function updateArcadeTargets(arcade, now) {
  arcade.targets = arcade.targets.filter((target) => now < target.expiresAt + 900);
  if (now - arcade.lastSpawnAt < arcade.spawnMs) return;
  arcade.lastSpawnAt = now;
  const id = arcade.nextTargetId;
  arcade.nextTargetId += 1;

  if (arcade.mode === "bubble") {
    const rise = 0.17 + arcadeNoise(arcade.seed + id * 23) * 0.09;
    arcade.targets.push({
      id,
      x: 0.14 + arcadeNoise(arcade.seed + id * 13) * 0.72,
      y: 1.04,
      rise,
      radius: 0.06 + arcadeNoise(id * 5) * 0.03,
      kind: arcadeNoise(arcade.seed + id * 29) < 0.24 ? "gold" : "good",
      order: id,
      spawnAt: now,
      expiresAt: now + Math.round((1.16 / rise) * 1000)
    });
    return;
  }

  const badChance = arcade.mode === "sort" ? 0.32 : 0;
  arcade.targets.push({
    id,
    x: 0.12 + arcadeNoise(arcade.seed + id * 13) * 0.76,
    y: 0.19 + arcadeNoise(arcade.seed + id * 19 + 7) * 0.62,
    radius: 0.065 + arcadeNoise(id * 5) * 0.025,
    kind: arcadeNoise(arcade.seed + id * 29) < badChance ? "bad" : "good",
    order: id,
    spawnAt: now,
    expiresAt: now + 1900
  });
}

function arcadeBotStep(room, bot) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  const player = arcade?.players?.[bot.id];
  if (!arcade || !player) return;
  if (arcade.family === "choice") {
    const cueIndex = Math.max(0, Math.floor((Date.now() - minigame.startedAt) / arcade.beatMs));
    const answerIndex = cueIndex - (arcade.choiceDelay || 0);
    if (answerIndex < 0) return;
    const expected = arcadeChoice(arcade, answerIndex);
    handleArcadeInput(room, bot, { action: Math.random() > 0.18 ? expected : (expected === "left" ? "right" : "left") });
    return;
  }
  if (arcade.family === "timing") {
    if (Math.random() > 0.44) handleArcadeInput(room, bot, { action: "tap" });
    return;
  }
  if (arcade.family === "kinetic") {
    let target = arcade.target;
    if (arcade.mode === "course") {
      const nearest = [...arcade.hazards]
        .sort((a, b) => Math.hypot(player.x - a.x, player.y - a.y) - Math.hypot(player.x - b.x, player.y - b.y))[0];
      target = nearest && Math.hypot(player.x - nearest.x, player.y - nearest.y) < 0.3
        ? { x: nearest.x < 0.5 ? 0.82 : 0.18, y: clamp(player.y - 0.08, 0.18, 0.82) }
        : { x: 0.5, y: 0.52 };
    }
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const action = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    handleArcadeInput(room, bot, { action });
    return;
  }
  if (arcade.family === "direct") {
    let targetX = arcade.target.x;
    if (arcade.mode === "catch") {
      const now = Date.now();
      const nextGlow = arcade.drops
        .filter((drop) => drop.kind === "glow" && !player.hitTargets[drop.id] && drop.impactAt >= now)
        .sort((a, b) => a.impactAt - b.impactAt)[0];
      const nextStorm = arcade.drops
        .filter((drop) => drop.kind === "storm" && !player.hitTargets[drop.id] && Math.abs(drop.x - player.x) < 0.16)
        .sort((a, b) => a.impactAt - b.impactAt)[0];
      targetX = nextGlow?.x ?? (nextStorm ? (nextStorm.x < 0.5 ? 0.82 : 0.18) : 0.5);
    }
    const wobble = (Math.random() - 0.5) * 0.08;
    handleArcadeInput(room, bot, { action: "move", x: clamp(targetX + wobble, 0.08, 0.92) });
    return;
  }
  if (arcade.family === "steer") {
    let target = arcade.target;
    if (arcade.mode === "avoid") {
      const nearest = [...arcade.hazards].sort((a, b) => Math.hypot(player.x - a.x, player.y - a.y) - Math.hypot(player.x - b.x, player.y - b.y))[0];
      target = { x: clamp(player.x + (player.x - nearest.x), 0.1, 0.9), y: clamp(player.y + (player.y - nearest.y), 0.1, 0.9) };
    }
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const action = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    handleArcadeInput(room, bot, { action });
    return;
  }
  if (arcade.family === "target") {
    const now = Date.now();
    const active = arcade.targets
      .filter((target) => target.kind !== "bad" && !player.hitTargets[target.id] && now <= target.expiresAt)
      .sort((a, b) => a.order - b.order)[0];
    if (active && Math.random() > 0.24) {
      const position = arcadeTargetPosition(arcade, active, now);
      handleArcadeInput(room, bot, { action: "target", x: position.x, y: position.y });
    }
    return;
  }
  if (arcade.family === "plinko") {
    const profile = botProfile(player);
    const mine = arcade.balls.find((ball) => ball.playerId === bot.id);
    if (!mine) {
      // Zielen: die Mitte ist am meisten wert. Wie genau gezielt wird, ist das
      // erste Können — vorher warfen alle drei Stufen blind irgendwo zwischen
      // 0.32 und 0.68, und gemessen lag der schwache Bot damit sogar vorne.
      if (Math.random() > 0.35) {
        const spread = profile.level === "hard" ? 0.05 : profile.level === "normal" ? 0.13 : 0.26;
        handleArcadeInput(room, bot, { action: "drop", x: clamp(0.5 + (Math.random() - 0.5) * 2 * spread, 0.08, 0.92) });
      }
      return;
    }
    if (mine.nudged) return;

    // EINMAL je Kugel entscheiden, wo gestupst wird und ob richtig. Pro Tick
    // gewürfelt liefe die Wahrscheinlichkeit über die Flugzeit gegen Gewissheit.
    if (player.botBallId !== mine.id) {
      player.botBallId = mine.id;
      const reads = profile.level === "hard" ? 0.9 : profile.level === "normal" ? 0.65 : 0.35;
      player.botNudgeRight = Math.random() < reads;
      // Wann gestupst wird: zu früh weiss man noch nicht, wohin die Kugel
      // läuft, zu spät wirkt der Stups nicht mehr.
      player.botNudgeAt = profile.level === "hard" ? 0.62 : profile.level === "normal" ? 0.5 : 0.34;
    }
    const share = mine.y / Math.max(0.001, arcade.floorY);
    if (share < player.botNudgeAt) return;
    const wanted = mine.x < 0.5 ? 1 : -1;
    handleArcadeInput(room, bot, { action: "nudge", dir: player.botNudgeRight ? wanted : -wanted });
    return;
  }
  if (arcade.family === "seek") {
    // Wer mehr denkt, tippt langsamer — siehe SEEK_BOT_INTERVAL. Das sind nicht
    // zwei Regler, die sich aufheben, sondern die beiden Seiten derselben
    // Entscheidung: Zeit gegen Sicherheit.
    const now = Date.now();
    const profile = botProfile(player);
    const interval = SEEK_BOT_INTERVAL[profile.level] || SEEK_BOT_INTERVAL.normal;
    if (now - (player.botProbeAt || 0) < interval) return;
    player.botProbeAt = now;

    const size = arcade.size;
    const probed = new Set((player.probes || []).map((probe) => `${probe.x},${probe.y}`));

    // Alle Felder, die zu den mitgegebenen Angaben passen. Ein schon getipptes
    // Feld kann das Versteck nicht sein — sonst wäre die Runde vorbei.
    const consistentWith = (clues) => {
      const out = [];
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (probed.has(`${x},${y}`)) continue;
          if (clues.every((clue) => seekSteps(clue.x, clue.y, x, y) === clue.steps)) out.push({ x, y });
        }
      }
      return out;
    };

    let pick = null;
    if (profile.level === "hard") {
      // Behält ALLE Angaben und kombiniert sie.
      const candidates = consistentWith(player.probes || []);
      if (candidates.length <= 2) {
        pick = candidates[0] || null;
      } else {
        // Den Tipp suchen, der die übrigen Kandidaten am gleichmässigsten
        // aufteilt — dann ist der schlechteste Fall am kleinsten. Das ist
        // dieselbe Überlegung wie beim Zahlenraten: immer in die Mitte.
        let bestWorst = Infinity;
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            if (probed.has(`${x},${y}`)) continue;
            const buckets = new Map();
            candidates.forEach((candidate) => {
              const steps = seekSteps(x, y, candidate.x, candidate.y);
              buckets.set(steps, (buckets.get(steps) || 0) + 1);
            });
            const worst = Math.max(...buckets.values());
            if (worst < bestWorst) { bestWorst = worst; pick = { x, y }; }
          }
        }
      }
    } else if (profile.level === "normal") {
      // Behält nur die LETZTE Angabe im Kopf — genau das tut, wer mitdenkt,
      // aber nicht mitschreibt.
      const clues = player.probes || [];
      const last = clues[clues.length - 1];
      const candidates = consistentWith(last ? [last] : []);
      pick = candidates[Math.floor(Math.random() * candidates.length)] || null;
    }

    if (!pick) {
      // "easy" und jeder Rest: irgendein noch freies Feld.
      const free = [];
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          if (!probed.has(`${x},${y}`)) free.push({ x, y });
        }
      }
      pick = free[Math.floor(Math.random() * free.length)] || null;
    }
    if (pick) handleArcadeInput(room, bot, { action: "probe", x: pick.x, y: pick.y });
    return;
  }

  if (arcade.family === "estimate") {
    if (arcade.phase !== "guess") return;
    const round = (arcade.rounds || [])[arcade.round];
    if (!round) return;
    // Einmal je Durchgang schätzen, und nicht sofort: ein Mensch schaut erst
    // hin, dann schiebt er den Regler.
    if (player.botRound !== round.index) {
      player.botRound = round.index;
      player.botGuessAt = Date.now() + 500 + Math.random() * (ESTIMATE_GUESS_MS - 1400);
      player.botGuessDone = false;

      // Das Können steckt in EINER Zahl: wie weit die Schätzung streut,
      // gemessen an der Breite der Spanne. Ein Mensch, der ein Auge dafür hat,
      // liegt bei grossen Mengen um wenige Prozent daneben; wer nur rät,
      // verschätzt sich um ein Viertel der Spanne.
      const profile = botProfile(player);
      const spread = Math.max(1, round.high - round.low);
      const relative = profile.level === "hard" ? 0.05
        : profile.level === "normal" ? 0.13 : 0.27;
      // Gauss-artig statt gleichverteilt: kleine Fehler sind viel häufiger als
      // grosse. Gleichverteilt sähe die Streuung aus wie Würfeln.
      const noise = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      player.botGuess = clamp(
        Math.round(round.count + noise * spread * relative),
        round.low, round.high
      );
    }
    if (player.botGuessDone || Date.now() < player.botGuessAt) return;
    player.botGuessDone = true;
    handleArcadeInput(room, bot, { action: "guess", value: player.botGuess });
    return;
  }

  if (arcade.family === "curling") {
    if ((player.stonesLeft || 0) <= 0 || Math.random() < 0.82) return;
    const profile = botProfile(player);
    const startX = player.startX || 0.5;

    // Vorher warfen alle drei Stufen mit derselben Streuung — die Rangfolge kam
    // rein aus dem Zufall des Eises. Jetzt steckt das Können in zwei Zahlen:
    // wie genau gezielt wird und wie gut die Kraft dosiert ist.
    const aimErr = profile.level === "hard" ? 0.035 : profile.level === "normal" ? 0.09 : 0.19;
    const powerErr = profile.level === "hard" ? 0.05 : profile.level === "normal" ? 0.12 : 0.24;

    // Die Kraft, die den Stein genau ins Haus trägt, aus der Reibung gerechnet:
    // Weg = v/Reibung · (1 − e^(−Reibung·t)), im Grenzfall also v/Reibung.
    const distance = Math.max(0.05, (arcade.sheetY - 0.14) - arcade.house.y);
    const wantedSpeed = distance * CURLING_FRICTION;
    const power = clamp((wantedSpeed / 1.7) * (1 + (Math.random() - 0.5) * 2 * powerErr), 0.25, 1);

    // Kein Rempeln mehr. Der starke Bot zielte früher auf einen fremden Stein,
    // der schon gut lag — das klingt nach Curling, ist hier aber ein Verlust:
    // die Steine sind gleich schwer und prallen mit 0.92 ab, ein Rempler nimmt
    // also fast immer BEIDE aus dem Haus. Wer ohnehin genau trifft, tauscht
    // damit einen sicheren eigenen Treffer gegen einen fremden. Gemessen lag
    // "hard" dadurch zu dritt hinter "normal".
    const spread = (arcade.house.x - startX) + (Math.random() - 0.5) * 2 * aimErr;
    handleArcadeInput(room, bot, {
      action: "flick",
      dx: clamp(spread * 0.9, -1, 1),
      dy: clamp(-power, -1, -0.2)
    });
    return;
  }
  if (arcade.family === "stopclock") {
    if (player.stoppedMs !== null) return;
    const profile = botProfile(player);
    if (player.botStopAt === undefined) {
      player.botStopAt = arcade.targetMs - BOT_TICK_LEAD_MS
        + (Math.random() - 0.5) * 2 * profile.spreadMs;
    }
    if (Date.now() - minigame.startedAt >= player.botStopAt) {
      handleArcadeInput(room, bot, { action: "stop" });
    }
    return;
  }
  if (arcade.family === "redlight") {
    if (player.finishedAt) return;
    const now = Date.now();
    const profile = botProfile(player);
    const elapsed = now - minigame.startedAt;
    const phase = redlightPhaseAt(arcade, elapsed);
    const intoPhase = elapsed - phase.from;
    if (phase.kind === "green") {
      // Bots react late to green and occasionally hesitate.
      if (intoPhase >= profile.reactionMs && Math.random() > 0.08) {
        handleArcadeInput(room, bot, { action: "run" });
      }
      return;
    }
    // Red: sloppy bots keep running a moment too long.
    if (intoPhase < profile.reactionMs * 0.6 || Math.random() < profile.mistake * 0.25) {
      handleArcadeInput(room, bot, { action: "run" });
    }
    return;
  }
  if (arcade.family === "wave") {
    if (player.eliminated) return;
    const now = Date.now();
    const profile = botProfile(player);
    const elapsed = now - minigame.startedAt;
    const next = arcade.waves.find((wave) => !wave.processed && wave.hitAt > elapsed);
    if (!next) return;
    if (player.botJumpWave !== next.hitAt) {
      player.botJumpWave = next.hitAt;
      // Aim to be mid-air at impact; bad bots mistime or skip the jump.
      // Der Absprung muss in das Fenster [hitAt − jumpMs, hitAt] fallen. Ohne den
      // Vorhalt kam der Bot durch seinen eigenen Takt regelmässig zu spät und
      // schied an der Technik statt am Können aus — gemessen waren nach drei
      // Wellen 95 bis 100 Prozent des Feldes draussen, auf jeder Stufe.
      player.botJumpAt = Math.random() < profile.mistake
        ? next.hitAt + arcade.jumpMs * 0.8
        : next.hitAt - arcade.jumpMs * 0.45 - BOT_TICK_LEAD_MS
          + (Math.random() - 0.5) * profile.spreadMs * 0.5;
    }
    if (elapsed >= player.botJumpAt && now >= player.jumpUntil) {
      handleArcadeInput(room, bot, { action: "jump" });
    }
    return;
  }
  if (arcade.family === "pump") {
    const profile = botProfile(player);
    // Tap rate scales with skill; the input cooldown caps the maximum.
    const chance = profile.level === "hard" ? 0.9 : profile.level === "normal" ? 0.7 : 0.5;
    if (Math.random() < chance) handleArcadeInput(room, bot, { action: "pump" });
    return;
  }
  if (arcade.family === "barrel") {
    if (player.fallenAt) return;
    const profile = botProfile(player);
    const now = Date.now();
    // Gegenhalten schlägt das Fass immer um denselben Betrag — wer in die
    // richtige Richtung hält, kann also gar nicht herunterfallen. Alles hängt
    // deshalb daran, WANN man den Richtungswechsel bemerkt: bis dahin hält man
    // in die falsche Richtung und wird mit doppeltem Tempo an den Rand getragen.
    // Genau das wird hier abgebildet. Vorher wurde je Tick gewürfelt, OB
    // überhaupt gegengehalten wird — über die vielen Ticks lief das auf „immer"
    // hinaus, und alle drei Stufen hielten sich exakt gleich gut.
    if (player.botPendingVel !== arcade.barrelVel) {
      player.botPendingVel = arcade.barrelVel;
      player.botVelSeenAt = now;
    }
    if (now - player.botVelSeenAt >= profile.reactionMs * 0.6) {
      player.botSeenVel = arcade.barrelVel;
    }
    const seenVel = player.botSeenVel ?? arcade.barrelVel;
    // Der Bot stellt sich gegen die Drehrichtung ins Fass, und zwar umso weiter,
    // je schneller es dreht: in einem schnellen Schub kann er den Rutsch nur
    // verlangsamen, also braucht er den Platz VORHER. Genau das ist auch der
    // Trick, den ein Mensch hier lernt.
    const bank = Math.min(arcade.limit * 0.75, 0.3 + Math.abs(seenVel) * 0.35);
    const target = -Math.sign(seenVel || 1) * bank;
    if (Math.abs(player.offset - target) > 0.05) {
      handleArcadeInput(room, bot, { action: "run", dir: player.offset > target ? -1 : 1 });
    }
    return;
  }
  if (arcade.family === "bomb") {
    if (player.outAt || arcade.holderId !== bot.id) return;
    const now = Date.now();
    const profile = botProfile(player);
    // Die Haltezeit wird EINMAL je Übernahme gewürfelt. Als Wurf je Tick gewann
    // über die vielen Ticks immer der kleinste Wert, und alle Stufen gaben
    // dadurch gleich schnell ab.
    if (player.botHoldSince !== arcade.holderSince) {
      player.botHoldSince = arcade.holderSince;
      player.botPassAt = arcade.holderSince + BOMB_PASS_LOCK_MS
        + profile.reactionMs * 0.8 + Math.random() * 500;
    }
    // Nach jedem Weitergeben ist die Zündschnur kurz zu sehen. Wer hinschaut,
    // gibt sofort ab, wenn sie knapp wird — vorher las kein Bot sie überhaupt,
    // und das eigentliche Können des Spiels blieb ungenutzt.
    const fuseLeft = (arcade.fuseAt || 0) - now;
    // Der beste Wert liegt KNAPP UNTER der Mindesthaltezeit des Empfängers (380 ms):
    // dann kann er sie nicht mehr loswerden. Zu früh abgegeben kreist die Bombe
    // einmal herum und kommt zurück — mit 900 ms verlor der starke Bot gemessen
    // gegen den mittleren.
    const watch = profile.level === "hard" ? 370 : profile.level === "normal" ? 700 : 0;
    if ((fuseLeft <= watch && now >= arcade.canPassAt) || now >= player.botPassAt) {
      handleArcadeInput(room, bot, { action: "pass" });
    }
    return;
  }
  if (arcade.family === "catchfall") {
    const now = Date.now();
    const profile = botProfile(player);
    const elapsed = now - minigame.startedAt;
    const next = arcade.drops.find((drop) => !drop.processed && drop.catchAt > elapsed + profile.reactionMs * 0.4);
    if (!next || next.catchAt - elapsed > 1100) return;
    let wanted = player.lane;
    if (next.kind === "coin" && Math.random() > profile.mistake) wanted = next.lane;
    if (next.kind === "bomb" && next.lane === player.lane && Math.random() > profile.mistake) {
      wanted = next.lane === 0 ? 1 : next.lane - 1;
    }
    if (wanted !== player.lane) {
      handleArcadeInput(room, bot, { action: "lane", dir: wanted > player.lane ? 1 : -1 });
    }
    return;
  }
  if (arcade.family === "whack") {
    const now = Date.now();
    const profile = botProfile(player);
    const elapsed = now - minigame.startedAt;
    // Auch Stachelblobs kommen in Frage — ein Bot, der nur die guten überhaupt
    // ansieht, kann sich nie vergreifen, und gemessen hatte KEINE Stufe je einen
    // Fehlschlag.
    const active = arcade.pops.find((pop) =>
      !player.hitPopIds[pop.id]
      && elapsed >= pop.from + profile.reactionMs * 0.7 && elapsed <= pop.until);
    if (!active) return;
    // Je Blob wird EINMAL entschieden. Als Wurf je Tick summierte sich die Chance
    // über das rund sekundenlange Fenster auf: selbst der schwache Bot traf damit
    // fast jeden Blob, und die drei Stufen lagen praktisch gleichauf.
    if (player.botPopId !== active.id) {
      player.botPopId = active.id;
      player.botPopSwing = active.kind === "bad"
        ? Math.random() < profile.mistake * 0.9   // Stachel übersehen
        : Math.random() > profile.mistake;        // guten Blob erwischen
    }
    if (player.botPopSwing) {
      handleArcadeInput(room, bot, { action: "whack", cell: active.cell });
    }
    return;
  }
  if (arcade.family === "cannon") {
    if (player.launchedAt) return;
    const now = Date.now();
    const profile = botProfile(player);
    if (!player.powerAt) {
      if (player.botLaunchAt === undefined) {
        // Aim for a gauge peak, offset by skill-based error.
        const target = arcade.periodMs / 2 + (Math.random() - 0.5) * profile.spreadMs * 0.6;
        const cycle = 2 + Math.floor(Math.random() * 5);
        player.botLaunchAt = cycle * arcade.periodMs + Math.max(120, target) - BOT_TICK_LEAD_MS;
      }
      if (now - minigame.startedAt >= player.botLaunchAt) {
        handleArcadeInput(room, bot, { action: "launch" });
      }
      return;
    }
    // Second tap: aim for the 45° sweet spot (angleT = 0.5 → period/6).
    if (player.botAngleAt === undefined) {
      // 45° entspricht angleT = 0.5, also 1/6 und 5/6 der Sweep-Periode. Die
      // erste Gelegenheit liegt bei 250 ms — so dicht hinter dem ersten Tipper,
      // dass der Eingabe-Cooldown sie schluckte. Der Bot zielte deshalb ins
      // Leere und schoss gemessen mit 70° statt 45°. Er nimmt jetzt die zweite,
      // sicher erreichbare Gelegenheit.
      const earliest = 260;
      const first = arcade.anglePeriodMs / 6;
      const aim = first >= earliest ? first : (arcade.anglePeriodMs * 5) / 6;
      player.botAngleAt = player.powerAt + aim - BOT_TICK_LEAD_MS
        + (Math.random() - 0.5) * profile.spreadMs * 0.7;
    }
    if (now >= player.botAngleAt) {
      handleArcadeInput(room, bot, { action: "launch" });
    }
    return;
  }
  if (arcade.family === "simon") {
    const now = Date.now();
    const profile = botProfile(player);
    const elapsed = now - minigame.startedAt;
    const round = simonRoundAt(arcade, elapsed);
    if (!round || elapsed < round.inputFrom + profile.reactionMs) return;
    if (player.currentRound === round.index && (player.roundFailed || player.roundProgress >= round.sequence.length)) return;
    const progress = player.currentRound === round.index ? player.roundProgress : 0;
    const correct = round.sequence[progress];
    const pick = Math.random() < profile.mistake * 0.45 ? (correct + 1) % 4 : correct;
    handleArcadeInput(room, bot, { action: "color", index: pick });
    return;
  }
  if (arcade.family === "react") {
    const now = Date.now();
    const profile = botProfile(player);
    const roundIndex = player.times.length;
    if (roundIndex >= arcade.rounds.length) return;
    const round = arcade.rounds[roundIndex];
    const elapsed = now - minigame.startedAt;
    // Rare false start, otherwise react with profile delay.
    if (Math.random() < profile.mistake * 0.02 && elapsed > round.armFrom + 400 && elapsed < round.greenAt) {
      handleArcadeInput(room, bot, { action: "tap" });
      return;
    }
    if (elapsed >= round.greenAt + profile.reactionMs * 0.55) {
      handleArcadeInput(room, bot, { action: "tap" });
    }
    return;
  }
  if (arcade.family === "knife") {
    // Only act on the bot's own turn.
    if (arcade.activeId !== bot.id || player.eliminated || player.turnDone) return;
    const now = Date.now();
    const profile = botProfile(player);

    // Der Bot spielt das, was auch ein Mensch hier spielt: er SCHAUT der Scheibe
    // zu und lässt im richtigen Moment los.
    //
    // Vorher war der Fehler auf die geschätzte LÜCKE modelliert, und das ging
    // zweimal schief. Ein fester Anspruch liess den genauen Bot bei enger
    // Scheibe zwangsläufig bis zum Panikwurf warten — und der fällt immer auf
    // denselben Augenblick, also denselben Drehwinkel; der schlampige streute
    // über das Fenster und erwischte zufällig gute Momente. Ein fallender
    // Anspruch machte es schlimmer, weil dann der Zufall noch früher greifen
    // durfte. Gemessen stand die Rangfolge beide Male auf dem Kopf.
    //
    // Der Fehler gehört auf die ZEIT, nicht auf die Lücke: die Scheibe dreht
    // sich, also ist ein Zeitfehler direkt ein Winkelfehler, und wer genauer
    // trifft, wirft in grössere Lücken. Genau das ist das Können des Spiels.
    if (player.botTurnKey !== `${arcade.round}:${arcade.turnIndex}`) {
      player.botTurnKey = `${arcade.round}:${arcade.turnIndex}`;
      const spread = profile.level === "hard" ? 55 : profile.level === "normal" ? 150 : 320;
      player.botAimError = (Math.random() * 2 - 1) * spread;
      player.botThrowAt = null;
    }

    // Den besten Augenblick im verbleibenden Fenster suchen: die Scheibe dreht
    // gleichmässig, ihre Lage lässt sich also vorausrechnen.
    if (player.botThrowAt === null || player.botThrowAt === undefined) {
      const dir = arcade.turnIndex % 2 === 0 ? 1 : -1;
      const perMs = (arcade.spinSpeed * dir * 180) / Math.PI / 1000;
      const nowAngle = (((arcade.logAngle * 180) / Math.PI) % 360 + 360) % 360;
      const nerve = 420;                 // grösser als der Bot-Takt (120-180 ms)
      const horizon = Math.max(0, arcade.turnEndsAt - now - nerve);
      let bestAt = now;
      let bestGap = -1;
      for (let ahead = 0; ahead <= horizon; ahead += 40) {
        const angle = (nowAngle + perMs * ahead % 360 + 360) % 360;
        let gap = 180;
        arcade.knives.forEach((knife) => {
          const diff = Math.abs(((knife.angleDeg - angle + 540) % 360) - 180);
          if (diff < gap) gap = diff;
        });
        if (gap > bestGap) { bestGap = gap; bestAt = now + ahead; }
      }
      player.botThrowAt = bestAt + player.botAimError;
    }

    if (now >= player.botThrowAt || arcade.turnEndsAt - now <= 200) {
      handleArcadeInput(room, bot, { action: "throw" });
    }
    return;
  }
  if (arcade.family === "stack") {
    if (player.toppled || player.height >= arcade.total) return;
    const now = Date.now();
    const profile = botProfile(player);
    const elapsed = now - minigame.startedAt;
    const speed = 1.1 + player.height * 0.06;
    const amp = 0.85 - player.height * 0.01;
    const centreAt = (ms) => Math.sin(((elapsed + ms) / 1000) * speed + player.phase * Math.PI * 2) * amp;

    // Den dichtesten Blick ERKENNEN statt auf eine feste Toleranz zu warten.
    // Vorher liess der Bot fallen, wenn der Block zufällig nah an der Turmmitte
    // stand — und das Fenster war beim starken Bot ENGER (0.07) als beim
    // schwachen (0.11). Gemessen kam genau das Verkehrte heraus: der schwache Bot
    // baute 10 von 14 Etagen, der starke nur 5. Zwischen zwei Blicken wandert der
    // Block nämlich weiter, als das Fenster breit ist; der starke Bot sprang über
    // den richtigen Moment einfach hinweg.
    const prev = Math.abs(centreAt(-STACK_BOT_LOOKAHEAD_MS) - player.offset);
    const here = Math.abs(centreAt(0) - player.offset);
    const next = Math.abs(centreAt(STACK_BOT_LOOKAHEAD_MS) - player.offset);
    // Dieser Blick ist dichter an der Turmmitte als der davor und der danach —
    // näher kommt der Bot in seinem Takt nicht heran.
    const closest = here <= prev && here <= next;

    if (closest) {
      // Eine Entscheidung je Annäherung, nicht je Tick: sonst summiert sich die
      // Wahrscheinlichkeit über die Ticks auf und jede Stufe träfe immer.
      const takes = profile.level === "hard" ? 0.95 : profile.level === "normal" ? 0.7 : 0.4;
      if (Math.random() < takes) handleArcadeInput(room, bot, { action: "drop" });
      return;
    }

    // Ungeduld: schwächere Bots lassen auch daneben fallen. Der Block muss den
    // Turm noch deutlich überlappen, sonst wäre es ein sofortiger Einsturz statt
    // eines schmaler werdenden Turms.
    if (here < player.width * 0.9 && Math.random() < profile.mistake * 0.1) {
      handleArcadeInput(room, bot, { action: "drop" });
    }
    return;
  }
  if (arcade.family === "paint") {
    const now = Date.now();
    const profile = botProfile(player);
    // Der Bot sucht sich ein Ziel und hält die Richtung, bis er dort ist. Jeden
    // Tick neu zu wählen liess ihn zittern, statt zu laufen.
    if (player.botTargetUntil === undefined) player.botTargetUntil = 0;
    const reached = player.botTarget
      && Math.hypot(player.botTarget.col + 0.5 - player.px, player.botTarget.row + 0.5 - player.py) < 0.45;
    if (!player.botTarget || reached || now >= player.botTargetUntil) {
      // Gewertet werden Feld-SEKUNDEN. Ein fremdes Feld kostet etwas mehr Zeit
      // als ein freies (PAINT_STEAL_RATE), bringt aber doppelt: eins mehr für
      // mich, eins weniger für den anderen. Für den eigenen Punktestand bleibt
      // das freie Feld knapp die bessere Wahl, solange es noch welche gibt.
      const STEAL_WORTH = 0.8;
      // Das Können steckt jetzt darin, wie sauber der Bot bewertet: wie stark er
      // sich verschätzt, wie oft er neu schaut und ob ihm eine Rolle auffällt.
      // Der Fehler muss je Bot GEWÜRFELT werden. arcadeNoise hängt nur an Feld,
      // Startwert und Zeit — alle drei Bots bekamen damit denselben Ausschlag und
      // verschätzten sich synchron, was gar kein Unterschied ist.
      const noise = profile.level === "hard" ? 0.05 : profile.level === "normal" ? 0.25 : 0.6;
      // Eine Rolle ist viel wert, aber der Weg dorthin kostet Fläche. Mit 7 lief
      // der starke Bot ihr bis zu elf Felder weit hinterher: gemessen sammelte er
      // mehr Rollen (2.9 gegen 2.5) und hatte am Ende trotzdem WENIGER Felder
      // (17.3 gegen 18.6). Wer sie richtig einschätzt, holt sie im Vorbeigehen.
      const pickupWorth = profile.level === "hard" ? 4 : profile.level === "normal" ? 5 : 2.5;
      // Anmerkung zum Nachfolger: die Stufen „mittel" und „stark" liegen hier
      // gemessen gleichauf (je rund 42 % Siege über 200 Partien), und das hält
      // stand. Versucht und jeweils ohne Wirkung: Zugabe für Felder mitten in
      // freier Fläche, ein zeitabhängiger Entfernungs-Exponent (früh nah, später
      // weite Bahnen) und weniger Streuung beim starken Bot. „Nimm das nächste
      // Feld, das mir noch nicht gehört" ist für dieses Spiel offenbar schon
      // nahe am Optimum — mehr Vorausschau bringt nichts mehr ein. Der
      // Unterschied zur schwachen Stufe (16 %) ist deutlich und echt.
      let best = null;
      let bestScore = -Infinity;
      for (let row = 0; row < PAINT_ROWS; row += 1) {
        for (let col = 0; col < PAINT_COLS; col += 1) {
          const owner = arcade.grid[paintIndex(col, row)];
          if (owner === bot.id) continue;
          const pickup = arcade.pickups.some((item) => item.col === col && item.row === row);
          const worth = pickup ? pickupWorth : (owner ? STEAL_WORTH : 1);
          const dist = Math.hypot(col + 0.5 - player.px, row + 0.5 - player.py) + 0.6;
          const score = worth / dist + Math.random() * noise;
          if (score > bestScore) {
            bestScore = score;
            best = { col, row };
          }
        }
      }
      player.botTarget = best;
      // Neu entscheiden darf er auch unterwegs, sonst rennt er an einer gerade
      // erschienenen Rolle vorbei. Ein schwacher Bot schaut seltener.
      player.botTargetUntil = now + (profile.level === "hard" ? 700 : profile.level === "normal" ? 950 : 1150);
    }
    if (!player.botTarget) return;
    const dx = player.botTarget.col + 0.5 - player.px;
    const dy = player.botTarget.row + 0.5 - player.py;
    const length = Math.hypot(dx, dy) || 1;
    // Etwas Zittern in der Richtung: sonst laufen Bots wie auf Schienen.
    const wobble = profile.level === "hard" ? 0.05 : profile.level === "normal" ? 0.13 : 0.2;
    handleArcadeInput(room, bot, {
      action: "steer",
      x: dx / length + (Math.random() - 0.5) * wobble,
      y: dy / length + (Math.random() - 0.5) * wobble
    });
    return;
  }
  if (arcade.family === "fish") {
    const now = Date.now();
    if (now < player.pauseUntil) return;
    const profile = botProfile(player);
    // Der Bot spielt die Spannung, nicht die Uhr: er hält, bis sie seine
    // persönliche Schmerzgrenze erreicht, und lässt dann los. Ein starker Bot
    // geht näher ans Limit und erkennt den Schub zuverlässiger.
    // Schmerzgrenze und Blickabstand müssen ZUSAMMEN passen. Mit 0.58/0.70/0.82
    // und den Blickabständen unten landete der schlimmste Fall bei 0.90 bis 0.94
    // — kein Bot konnte je reissen, egal wie unaufmerksam er war. Jetzt liegt
    // ceiling + Schubaufbau·Blickabstand beim schwachen Bot über 1.0 (er zieht
    // also gelegentlich über), beim mittleren knapp darüber und beim starken
    // darunter. Höhere Grenzen heissen auch: er holt mehr ein — Gier und Risiko
    // hängen zusammen, wie beim Spieler.
    const baseCeiling = profile.level === "hard" ? 0.84 : profile.level === "normal" ? 0.80 : 0.74;
    // Die Schmerzgrenze muss zur ART passen. Ein Wels baut Spannung fast
    // dreimal so schnell auf wie eine Sprotte; mit einer festen Grenze riss dem
    // starken Bot ausgerechnet an den wertvollen Fischen die Schnur, und
    // gemessen fiel er damit hinter den schwachen zurück. Ein guter Angler geht
    // beim grossen Fisch früher vom Zug — genau das ist auch das Können, das
    // ein Mensch hier lernt.
    const kind = player.species || FISH_SPECIES[1];
    const ceiling = clamp(baseCeiling - (kind.surge - 1) * 0.09, 0.5, 0.92);
    // Frueher wieder anfassen als vorher (0.42): zu langes Warten kostet Strecke,
    // und gemessen landete der vorsichtigste Bot dadurch die wenigsten Fische.
    const resume = ceiling * 0.55;
    // Ob er den Schub überhaupt bemerkt, entscheidet sein Können — genau das
    // unterscheidet ihn vom Spieler, der ihn sieht.
    const notices = profile.level === "hard" ? 0.92 : profile.level === "normal" ? 0.72 : 0.45;
    if (player.botLetGo === undefined) player.botLetGo = false;

    // EINMAL pro Schub entscheiden, ob der Bot ihn bemerkt. Je Tick neu gewürfelt
    // addiert sich die Wahrscheinlichkeit auf: bei sieben Ticks pro Sekunde
    // bemerkte selbst der schwächste Bot mit 0.45 jeden Schub zu 99% — gemessen
    // riss in vier Runden keine einzige Schnur, und der ganze Reiz des Spiels
    // fiel damit aus.
    const phase = activeFishPhase(player.phases, Math.max(0, now - player.hookedAt));
    const key = phase ? `${player.catchIndex}:${phase.index}` : null;
    if (key && player.botSurgeSeen !== key) {
      player.botSurgeSeen = key;
      player.botNoticed = Math.random() < notices;
    }
    const seesSurge = Boolean(phase) && player.botNoticed;

    // Der Bot schaut nicht in jedem Tick auf die Schnur. Tat er das, konnte er
    // strukturell NIE reissen: bei 0.62 Spannung pro Sekunde und einem Blick
    // alle 150 ms liess er immer rechtzeitig los, und in vier gespielten Runden
    // riss keine einzige Schnur. Wer seltener hinschaut, überzieht — und genau
    // das trennt hier Können von Glück.
    const checkMs = profile.level === "hard" ? 200 : profile.level === "normal" ? 340 : 560;
    if (player.botCheckAt === undefined) player.botCheckAt = 0;
    if (now >= player.botCheckAt) {
      player.botCheckAt = now + checkMs;
      if (player.botLetGo) {
        if (player.tension <= resume && !seesSurge) player.botLetGo = false;
      } else if (player.tension >= ceiling || seesSurge) {
        player.botLetGo = true;
      }
    }
    if (player.botLetGo) return;    // hält nicht, also kein Ping
    handleArcadeInput(room, bot, { action: "reel" });
    return;
  }
  if (arcade.family === "belt") {
    const parcel = player.queue[0];
    if (!parcel) return;
    const profile = botProfile(player);

    // EINMAL pro Paket entscheiden, nicht pro Tick. Eine Wahrscheinlichkeit, die
    // bei jedem Tick neu gewuerfelt wird, laeuft ueber viele Ticks gegen
    // Gewissheit — derselbe Fehler, der hier schon mehrfach steckte.
    if (player.botParcelId !== parcel.id) {
      player.botParcelId = parcel.id;
      const rightChance = profile.level === "hard" ? 0.95 : profile.level === "normal" ? 0.78 : 0.55;
      player.botRight = Math.random() < rightChance;
      // Wo auf dem Band gegriffen wird. Der schwache Bot laesst sich Zeit, und
      // sein Band reicht ueber 1 hinaus — dann rutscht das Paket durch.
      const band = profile.level === "hard" ? [0.40, 0.62]
        : profile.level === "normal" ? [0.48, 0.86]
        : [0.58, 1.14];
      player.botActPos = band[0] + Math.random() * (band[1] - band[0]);
    }
    if (player.beltPos < Math.max(BELT_REACH_AT, player.botActPos)) return;

    // Erst JETZT wird die Rutsche gesucht: die Farben tauschen waehrend das
    // Paket faehrt, und wer sich auf die alte Position verlaesst, greift daneben.
    // Genau das ist auch die Aufgabe des Menschen.
    let chute = arcade.chutes.indexOf(parcel.colour);
    if (chute < 0) chute = 0;
    if (!player.botRight) {
      const wrong = [];
      for (let i = 0; i < BELT_CHUTES; i += 1) if (i !== chute) wrong.push(i);
      chute = wrong[Math.floor(Math.random() * wrong.length)];
    }
    handleArcadeInput(room, bot, { action: "sort", chute });
    return;
  }
  if (arcade.family === "trace") {
    const now = Date.now();
    if (now < player.lockUntil) return;
    const profile = botProfile(player);
    // Der Bot zieht seinen Finger die Spur hinauf. Sein Können steckt in zwei
    // Zahlen: wie weit er pro Tick vorrückt und wie weit seine Hand wandert.
    //
    // Aussehen und Fehlerquote sind absichtlich GETRENNT. Beides an eine Zahl zu
    // hängen ging zweimal schief: Streuung unter der Toleranz heisst nie ein
    // Abrutscher (gemessen neun makellose Runden — unschlagbar und
    // unglaubwürdig), Streuung darüber heisst Dauerabrutscher (gemessen 30 in
    // einer Runde, Punktestand am Boden). Eine Schwingung verbringt viel Zeit an
    // ihren Extremen, deshalb liegt sie hier ganz im Band und sorgt nur für ein
    // lebendiges Wandern; die Abrutscher kommen aus einer eigenen, direkt
    // eingestellten Wahrscheinlichkeit.
    const step = profile.level === "hard" ? 0.040 : profile.level === "normal" ? 0.030 : 0.020;
    const drift = profile.level === "hard" ? 0.04 : profile.level === "normal" ? 0.055 : 0.07;
    // Bei ~200 Ticks pro Runde ergibt das etwa 1 / 2.5 / 5 Abrutscher.
    const slipChance = profile.level === "hard" ? 0.004 : profile.level === "normal" ? 0.012 : 0.025;
    if (player.driftPhase === undefined) {
      player.driftPhase = Math.random() * Math.PI * 2;
      player.driftPeriod = 900 + Math.random() * 900;
    }
    // Die Handunruhe skaliert mit der ÖRTLICHEN Bandbreite: an einer Engstelle
    // zieht man sich zusammen. Ohne das rutschte jeder Bot an jeder Engstelle
    // ab, egal wie gut er war.
    const width = traceWidthAt(arcade.seed, player.lap, clamp(player.progress + step, 0, 1));
    const wander = Math.sin(now / player.driftPeriod + player.driftPhase) * drift * width;
    const slipNow = Math.random() < slipChance ? (TRACE_TOLERANCE + 0.05) * (Math.random() < 0.5 ? -1 : 1) : 0;
    const y = clamp(player.progress + step, 0, 1);

    // Kristalle liegen abseits der Mittellinie. Ein guter Bot greift danach,
    // ein schwacher zieht stur die Mitte — das ist das zweite Können in diesem
    // Spiel, neben dem sauberen Zug.
    const reach = profile.level === "hard" ? 0.85 : profile.level === "normal" ? 0.55 : 0.15;
    const centre = tracePathX(arcade.seed, player.lap, y);
    let aim = centre;
    const gem = (player.gems || []).find((candidate) => !player.gemsTaken[candidate.index]
      && Math.abs(candidate.t - y) <= TRACE_GEM_REACH * 2.2);
    if (gem) aim += (gem.x - aim) * reach;

    // Der Bot hält sich im Band — wie ein Mensch, der weiss, wo der Rand ist.
    // Ohne diese Klemme addierten sich Griff nach dem Kristall und Handunruhe:
    // gemessen rutschten die starken Bots 45-mal pro Runde ab und schafften
    // keine einzige Runde, während der schwache, der die Kristalle ignorierte,
    // gewann. Die Abrutscher sollen aus `slipChance` kommen, nicht aus einer
    // Summe zweier Absichten.
    const limit = traceToleranceAt(arcade.seed, player.lap, y) * 0.8;
    const drifted = clamp(aim + wander, centre - limit, centre + limit);
    const x = clamp(drifted + slipNow, 0, 1);
    if (!player.brushDown) {
      // Nach einem Abriss erst wieder an der Bruchstelle ansetzen.
      handleArcadeInput(room, bot, { action: "trace", x: tracePathX(arcade.seed, player.lap, player.progress), y: player.progress });
      return;
    }
    handleArcadeInput(room, bot, { action: "trace", x, y });
    return;
  }
  if (arcade.family === "feint") {
    const now = Date.now();
    if (now < player.lockUntil) return;
    const profile = botProfile(player);
    const elapsed = Math.max(0, now - minigame.startedAt);
    const signal = activeFeintSignal(arcade.signals, elapsed);
    if (!signal || player.handled[signal.index]) return;
    const since = elapsed - signal.at;
    const radius = feintRadius(signal, since);

    // EINMAL pro Ring entscheiden, bei welchem Radius dieser Bot zuschlägt und
    // wie gut er die Verzögerung liest. Pro Tick neu gewürfelt liefe jede
    // Wahrscheinlichkeit über die vielen Ticks eines Rings gegen Gewissheit —
    // dieselbe Falle wie anderswo schon mehrfach.
    if (player.botRingId !== signal.index) {
      player.botRingId = signal.index;
      // Wie mutig: der starke Bot geht früher ins Risiko, weil er die
      // Verzögerung früher sieht. Der schwache wartet und bekommt dafür wenig.
      const band = profile.level === "hard" ? [0.34, 0.52]
        : profile.level === "normal" ? [0.46, 0.68]
        : [0.62, 0.94];
      player.botCommitAt = band[0] + Math.random() * (band[1] - band[0]);
      // Ob er den Unterschied überhaupt liest. Das ist das eigentliche Können
      // hier: ein falscher Ring bleibt hinter dem echten zurück, aber am Anfang
      // fast unmerklich.
      const reads = profile.level === "hard" ? 0.93 : profile.level === "normal" ? 0.76 : 0.52;
      player.botReadsIt = Math.random() < reads;
    }

    if (radius < player.botCommitAt) return;

    // An seinem Punkt angekommen: erkennt er, dass der Ring zurückbleibt? Der
    // Vergleich ist genau der, den auch ein Mensch anstellt — wo müsste ein
    // echter Ring jetzt sein, und wo ist dieser wirklich.
    const wouldBeReal = clamp(since / arcade.growMs, 0, 1);
    const behind = wouldBeReal - radius;
    // Je weiter der Ring zurückliegt, desto offensichtlicher ist die Fälschung.
    // Unter der Schwelle sieht selbst ein starker Bot nichts und tippt.
    const noticeAt = profile.level === "hard" ? 0.045 : profile.level === "normal" ? 0.085 : 0.16;
    const spotsFake = player.botReadsIt && behind >= noticeAt;
    if (spotsFake) return;               // wartet ab, richtig erkannt
    handleArcadeInput(room, bot, { action: "react" });
    return;
  }
  if (arcade.family === "bounce") {
    const profile = botProfile(player);
    const elapsed = Math.max(0, Date.now() - minigame.startedAt);
    // Den NÄCHSTEN Schlag PLANEN, statt auf einen Zufallstreffer zu warten.
    // Vorher tippte der Bot nur, wenn ein Tick zufällig nah am Schlag lag — beim
    // starken Bot war dieses Fenster ±70 ms, sein Takt aber 320 ms. Gemessen
    // gewann dadurch der MITTLERE Bot 100 % der Runden: mit ±150 ms traf er fast
    // jeden Schlag, während der starke die meisten übersprang.
    // Ein Plan bleibt stehen, bis er ausgeführt ist. Ihn beim Überschreiten des
    // Schlags neu zu setzen hätte jeden ZU SPÄTEN Tipper verworfen — und weil
    // enge Streuung dann seltener zu einem Tipper führt als weite, tippte
    // ausgerechnet der starke Bot am wenigsten (gemessen 6.7 gegen 13 Schläge).
    if (player.botBeat === undefined || player.botBeatFired) {
      const near = bounceNearestBeat(elapsed);
      const next = near.offsetMs > 0 ? near.index + 1 : near.index;
      const target = player.botBeat === undefined ? next : Math.max(next, player.botBeat + 1);
      player.botBeat = target;
      player.botBeatFired = false;
      // Der eigene Fehler wird einmal je Schlag gewürfelt. Genau darin steckt
      // das Können — nicht darin, ob ein Tick zufällig passt.
      const jitter = profile.level === "hard" ? 95 : profile.level === "normal" ? 165 : 330;
      player.botBeatAt = bounceBeatTime(target) + (Math.random() * 2 - 1) * jitter;
    }
    if (!player.botBeatFired && elapsed >= player.botBeatAt) {
      player.botBeatFired = true;
      handleArcadeInput(room, bot, { action: "jump" });
    }
    return;
  }
  if (arcade.family === "sumo") {
    if (player.eliminated) return;
    const now = Date.now();
    const profile = botProfile(player);
    const stone = arcade.stone;

    // Immer nachladen, sobald die Ausholzeit vorbei ist: eine leere Hand kann
    // weder stossen noch abwehren. Der Server weist ein zu frühes Laden ohnehin
    // ab, das kostet hier nichts.
    if (player.chargeStart === null) {
      handleArcadeInput(room, bot, { action: "charge" });
      return;
    }
    const held = now - player.chargeStart;
    if (held < SUMO_CHARGE_MS) return;            // noch nicht auf voller Kraft

    // Wie weit der Stein in der eigenen Richtung schon draussen ist. Unter
    // SUMO_ZONE geht der Stoss ins Leere und kostet Ladung wie Ausholzeit — für
    // Bot wie Mensch ist das der teuerste Fehler im Spiel.
    const reach = stone
      ? (stone.x * player.spotX + stone.y * player.spotY) / Math.max(1e-6, arcade.ringRadius)
      : -1;
    const speed = stone ? Math.hypot(stone.vx, stone.vy) : 0;
    const closing = !stone || speed < 1e-4
      ? 0
      : (stone.vx * player.spotX + stone.vy * player.spotY) / speed;

    // Das Können steckt darin, den Schlag ÜBERHAUPT zu treffen, nicht darin, ihn
    // besonders spät zu setzen. Spät zu schlagen bringt zwar mehr Wucht, aber
    // Wucht verhindert keinen Treffer — nur der Schlag selbst tut das. Umgekehrt
    // gesetzt (starker Bot wartet am längsten) verpasste ausgerechnet er das
    // Fenster am häufigsten und kassierte die meisten Treffer.
    //
    // `zone` ist deshalb beim starken Bot FRÜH: er schlägt zu, sobald der Stein
    // erreichbar ist. Der schwache wartet zu lange und lässt ihn durch.
    const zone = profile.level === "hard" ? arcade.zone + 0.03
      : profile.level === "normal" ? arcade.zone + 0.14
      : arcade.zone + 0.34;
    const wanted = profile.level === "hard" ? -0.1 : profile.level === "normal" ? 0.1 : 0.35;

    // Ob dieser Anflug überhaupt bemerkt wird, entscheidet sich EINMAL je Anflug.
    // Pro Tick gewürfelt liefe jede Wahrscheinlichkeit über die vielen Ticks
    // eines Anflugs gegen Gewissheit — dieselbe Falle wie anderswo schon
    // mehrfach.
    const approach = arcade.resetAt || 0;
    if (player.botApproach !== approach) {
      player.botApproach = approach;
      const notices = profile.level === "hard" ? 0.97 : profile.level === "normal" ? 0.82 : 0.55;
      player.botAwake = Math.random() < notices;
    }
    if (!player.botAwake) return;

    // Halten kostet nichts, also wird NICHT auf Verdacht gestossen. Ein
    // Fehlgriff ist der teuerste Fehler im Spiel: er kostet die Ladung und
    // dreiviertel Sekunde Ausholzeit, und in der Zeit ist man wehrlos.
    if (reach >= zone && reach <= 0.99 && closing >= wanted) {
      handleArcadeInput(room, bot, { action: "shove" });
    }
    return;
  }
  if (arcade.family === "dive") {
    const now = Date.now();
    if (now < player.busyUntil) return;
    const profile = botProfile(player);

    // Der Bot liest dieselbe Zahl, die auch im Bild steht: das Risiko des
    // NÄCHSTEN Stichs. Sein Können ist, wie genau er es liest — nicht, ob er
    // eine auswendig gelernte Tiefe trifft.
    const risk = player.nextRisk ?? diveRisk(player.depth + 1);
    const gain = player.nextGain ?? diveGain(player.depth + 1);

    // EINMAL je Stufe würfeln, wie schief er die Zahl sieht. Pro Tick gewürfelt
    // liefe der Fehler über die Wartezeit gegen null und alle Stufen spielten
    // gleich.
    const key = `${player.dives}:${player.depth}`;
    if (player.botStepKey !== key) {
      player.botStepKey = key;
      const blur = profile.level === "hard" ? 0.05 : profile.level === "normal" ? 0.12 : 0.24;
      player.botSeenRisk = clamp(risk + (Math.random() - 0.5) * 2 * blur, 0.01, 0.99);
    }
    const seen = player.botSeenRisk ?? risk;

    // Gier. Das ist das eigentliche Können in diesem Spiel, und es ist genau
    // das, was ein schwacher Mensch falsch macht: „noch eine Stufe". Eine reine
    // Unschärfe auf dem Risiko reichte nicht — gemessen lagen alle drei Stufen
    // innerhalb von 30 Gold, weil die Entscheidung fast immer weit von der
    // Kippstelle entfernt liegt und ein bisschen Rauschen sie nie umdreht.
    const greed = profile.level === "hard" ? 0 : profile.level === "normal" ? 22 : 55;

    // Weitergraben, solange sich der Stich unterm Strich lohnt. Die Zeit steckt
    // mit drin: tief graben kostet Sekunden, in denen zwei flache Tauchgänge
    // durchgingen.
    const value = (1 - seen) * gain - seen * player.carried;
    const timeBias = player.depth >= diveBestDepth() ? 0.55 : 1;
    if (player.depth > 0 && value * timeBias + greed <= 0) {
      handleArcadeInput(room, bot, { action: "bank" });
      return;
    }
    if (player.depth >= DIVE_MAX_DEPTH) {
      handleArcadeInput(room, bot, { action: "bank" });
      return;
    }
    handleArcadeInput(room, bot, { action: "dig" });
    return;
  }

  if (arcade.family === "glide") {
    const profile = botProfile(player);
    const elapsed = arcade.elapsed || 0;
    const gate = arcade.gates[player.nextGate];
    if (!gate) return;

    // EINMAL pro Tor entscheiden, wie genau dieser Bot es nimmt. Pro Tick neu
    // gewürfelt liefe jede Streuung über viele Ticks gegen null aus — der Bot
    // flöge dann durch die Mitte jedes Tores, egal welche Stufe.
    if (player.botGateId !== player.nextGate) {
      player.botGateId = player.nextGate;
      const slop = profile.level === "hard" ? 0.035 : profile.level === "normal" ? 0.10 : 0.19;
      player.botAim = clamp(gate.y + (Math.random() - 0.5) * 2 * slop, 0.05, 0.95);
    }

    // Wie früh der Bot anfängt, auf das nächste Tor zuzusteuern. Das ist das
    // eigentliche Können hier: wer zu spät anfängt, kommt mit zu viel Schwung
    // an und schiesst durch, egal wie genau er zielt.
    const lookahead = profile.level === "hard" ? 1500 : profile.level === "normal" ? 1000 : 620;
    const aim = gate.at - elapsed <= lookahead ? player.botAim : 0.5;

    // Halten, wenn man unter dem Ziel liegt — mit Blick auf die eigene
    // Steiggeschwindigkeit, sonst pendelt der Ballon um das Ziel herum.
    const predicted = player.y + player.vy * 0.42;
    handleArcadeInput(room, bot, { action: "lift", down: predicted < aim });
    return;
  }
  if (arcade.family === "climb") {
    if (player.finishedAt) return;
    const profile = botProfile(player);
    const chance = profile.level === "hard" ? 0.85 : profile.level === "normal" ? 0.62 : 0.42;
    if (Math.random() < chance) {
      // Bots almost always alternate correctly; rare fumble on the wrong side.
      const side = Math.random() < profile.mistake * 0.25 ? -player.nextSide : player.nextSide;
      handleArcadeInput(room, bot, { action: "grab", side });
    }
    return;
  }
  if (arcade.family === "runner") {
    if (player.finishedAt) return;
    const now = Date.now();
    const profile = botProfile(player);
    if (player.hasItem) {
      // Der Schuss läuft geradeaus die eigene Bahn hinunter. Ihn abzufeuern,
      // wenn dort niemand voraus ist, ist verschenkt — vorher warf jeder Bot
      // einfach drauflos, und die ganze Mechanik trug nichts zum Können bei.
      const target = room.players.some((other) => {
        const entry = arcade.players[other.id];
        return entry && other.id !== bot.id && !entry.finishedAt
          && entry.lane === player.lane
          && entry.progress > player.progress
          && entry.progress - player.progress < 40;
      });
      const fire = profile.level === "hard"
        ? target
        : profile.level === "normal" ? (target || Math.random() < 0.04) : Math.random() < 0.12;
      if (fire) handleArcadeInput(room, bot, { action: "throw" });
    }
    const nextRow = arcade.rows[player.nextRow];
    if (!nextRow || nextRow.position - player.progress > 6) return;
    // Je Reihe wird EINMAL entschieden, ob der Bot sie sauber liest. Als Wurf je
    // Tick standen ihm auf den letzten sechs Metern mehrere Versuche zu, und die
    // Wahrscheinlichkeit summierte sich auf: gemessen stolperten alle drei Stufen
    // gleich oft (3.35 gegen 2.75 auf 150 Meter).
    if (player.botRowIndex !== player.nextRow) {
      player.botRowIndex = player.nextRow;
      player.botRowRead = Math.random() > profile.mistake;
    }
    const pickupRow = nextRow.kind === "boost" || nextRow.kind === "item";
    const blocked = pickupRow ? [] : runnerBlockedLanes(nextRow, now);
    const lanes = [0, 1, 2];
    let wanted = player.lane;
    if (!player.botRowRead) {
      wanted = player.lane;
    } else if (pickupRow) {
      wanted = nextRow.lane;
    } else if (blocked.includes(player.lane)) {
      const free = lanes.filter((lane) => !blocked.includes(lane));
      wanted = free.sort((a, b) => Math.abs(a - player.lane) - Math.abs(b - player.lane))[0] ?? player.lane;
    }
    if (wanted !== player.lane) {
      handleArcadeInput(room, bot, { action: "lane", dir: wanted > player.lane ? 1 : -1 });
    }
    return;
  }
  if (arcade.family === "colorgrid") {
    if (arcade.phase !== "announce" || player.eliminated) return;
    const now = Date.now();
    const profile = botProfile(player);
    // Die Vorlaufzeit muss abgezogen werden — genau wie im Eingabe-Handler.
    // Ohne sie war roundElapsed dauerhaft 3000 ms zu gross, die Reaktionszeit
    // griff nie, und alle drei Stufen liefen gleich schnell los.
    const roundElapsed = (now - minigame.startedAt) - (arcade.leadMs || 0) - arcade.round * arcade.roundMs;
    if (roundElapsed < profile.reactionMs) return;
    const onTarget = arcade.grid[player.gy * COLORGRID_SIZE + player.gx] === arcade.targetColor;
    if (onTarget) return;
    // Zögern wird EINMAL je Runde entschieden. Als Wurf je Tick summierte es sich
    // über die vielen Ticks einer Runde weg und war praktisch wirkungslos.
    if (player.botDitherRound !== arcade.round) {
      player.botDitherRound = arcade.round;
      player.botDithers = Math.random() < profile.mistake;
    }
    if (player.botDithers && roundElapsed < profile.reactionMs + 700) return;
    // Walk one step towards the nearest safe tile.
    let best = null;
    arcade.grid.forEach((color, index) => {
      if (color !== arcade.targetColor) return;
      const gx = index % COLORGRID_SIZE;
      const gy = Math.floor(index / COLORGRID_SIZE);
      const dist = Math.abs(gx - player.gx) + Math.abs(gy - player.gy);
      if (!best || dist < best.dist) best = { gx, gy, dist };
    });
    if (!best) return;
    const dx = best.gx - player.gx;
    const dy = best.gy - player.gy;
    const dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
    handleArcadeInput(room, bot, { action: "step", dir });
  }
}

function arcadeChoice(arcade, cueIndex) {
  return arcadeNoise(arcade.seed + cueIndex * 17) > 0.5 ? "right" : "left";
}

function arcadeTimingPhase(arcade, startedAt, now) {
  return ((now - startedAt) / arcade.periodMs) % 1;
}

function arcadeDynamicTimingTarget(arcade, cycle) {
  return arcadeNoise(arcade.seed + cycle * 43) > 0.5 ? 0.25 : 0.75;
}

function circularDistance(a, b) {
  const distance = Math.abs(a - b);
  return Math.min(distance, 1 - distance);
}

function relocateArcadeTarget(arcade) {
  arcade.target.index += 1;
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    x: 0.14 + arcadeNoise(arcade.seed + arcade.target.index * 31 + index * 17) * 0.72,
    y: 0.2 + arcadeNoise(arcade.seed + arcade.target.index * 37 + index * 23 + 4) * 0.58
  }));
  const playerPositions = Object.values(arcade.players || {});
  let destination = candidates
    .map((candidate) => ({
      ...candidate,
      clearance: Math.min(...playerPositions.map((player) => Math.hypot(player.x - candidate.x, player.y - candidate.y)))
    }))
    .sort((a, b) => b.clearance - a.clearance)[0] || candidates[0];
  if (arcade.mode === "sweep") {
    const dx = destination.x - 0.5;
    const dy = destination.y - 0.5;
    const distance = Math.hypot(dx, dy);
    if (distance > 0.34) {
      destination = {
        ...destination,
        x: 0.5 + dx / distance * 0.34,
        y: 0.5 + dy / distance * 0.34
      };
    }
  }
  arcade.target.x = destination.x;
  arcade.target.y = destination.y;
  arcade.target.changedAt = Date.now();
}

function bounceArcadePlayer(player) {
  if (player.x < 0.06 || player.x > 0.94) player.vx *= -0.72;
  if (player.y < 0.08 || player.y > 0.92) player.vy *= -0.72;
  player.x = clamp(player.x, 0.06, 0.94);
  player.y = clamp(player.y, 0.08, 0.92);
}

function syncArcadeScore(minigame, player, arcadePlayer) {
  const score = Math.max(0, Math.round(arcadePlayer.score));
  minigame.scores[player.id] = score;
  player.minigameScore = score;
}

function arcadeNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function createDodgeBlocks(duration) {
  const blocks = [];
  let time = 350;
  let id = 0;
  while (time < duration - 850) {
    const lane = Math.floor(Math.random() * 5);
    blocks.push({
      id: `block_${id}`,
      lane,
      spawnAt: time,
      impactAt: time + 980
    });
    id += 1;
    time += Math.max(430, 800 - id * 18);
  }
  return blocks;
}

function computeTimingScore(minigame, now) {
  const period = 1450;
  const elapsed = Math.max(0, now - minigame.startedAt);
  const phase = (elapsed % period) / period;
  const position = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const distance = Math.abs(position - 0.5) * 2;
  return Math.max(0, Math.round((1 - distance) * 100));
}

function emitMinigameUpdate(room) {
  if (!room.currentMinigame) return;
  io.to(room.code).emit("minigameUpdate", serializeMinigame(room.currentMinigame));
}

function emitRoom(room) {
  io.to(room.code).emit("state", serializeRoom(room));
  scheduleBotTurn(room);
  scheduleDisconnectedTurnSkip(room);
}

function scheduleBotTurn(room) {
  if (room.status !== "board" || room.phase !== "waitingRoll") return;
  if (room.botTurnTimer) return;
  const current = getCurrentPlayer(room);
  if (!current?.isBot) return;

  room.botTurnTimer = setTimeout(() => {
    room.botTurnTimer = null;
    if (room.status !== "board" || getCurrentPlayer(room)?.id !== current.id) return;
    performRoll(room, current);
  }, 900 + Math.floor(Math.random() * 900));
}

function scheduleDisconnectedTurnSkip(room) {
  if (room.status !== "board" || room.phase !== "waitingRoll") return;
  if (room.skipTurnTimer) return;
  const current = getCurrentPlayer(room);
  if (!current || current.connected !== false || current.isBot) return;

  room.skipTurnTimer = setTimeout(() => {
    room.skipTurnTimer = null;
    if (room.status !== "board" || room.phase !== "waitingRoll") return;
    const stillCurrent = getCurrentPlayer(room);
    if (!stillCurrent || stillCurrent.id !== current.id || stillCurrent.connected !== false) return;
    room.lastMessage = `${stillCurrent.name} ist offline. Zug übersprungen.`;
    io.to(room.code).emit("roomNotice", { severity: "warning", message: room.lastMessage });
    advanceTurn(room);
  }, 1400);
}

function serializeRoom(room) {
  const board = getBoard(room.boardId);
  return {
    code: room.code,
    hostId: room.hostId,
    boardId: board.id,
    board: publicBoard(board),
    availableBoards: BOARD_DEFINITIONS.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      shortName: candidate.shortName,
      subtitle: candidate.subtitle,
      badge: candidate.badge,
      feature: candidate.feature,
      swatches: candidate.swatches
    })),
    status: room.status,
    phase: room.phase,
    boardSize: board.fieldTypes.length,
    fieldTypes: board.fieldTypes,
    round: room.round,
    maxRounds: room.maxRounds,
    mode: room.mode || "board",
    arcadeRound: room.mode === "arcade" ? Math.min(room.arcadeRoundIndex + 1, room.arcadePlan.length || 1) : null,
    arcadeTotalRounds: room.mode === "arcade" ? (room.arcadePlan.length || ARCADE_MARATHON_ROUNDS) : null,
    singleType: room.singleType,
    minigameTitles: MINIGAMES.map((game) => ({ type: game.type, title: game.title })),
    devMode: room.devMode,
    hostConnected: room.players.some((player) => player.id === room.hostId && player.connected),
    currentTurnIndex: room.currentTurnIndex,
    currentPlayerId: getCurrentPlayer(room)?.id || null,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      isHost: player.isHost,
      isBot: player.isBot,
      isLocalDev: player.isLocalDev,
      connected: player.connected,
      coins: player.coins,
      stars: player.stars || 0,
      items: [...(player.items || [])],
      shielded: Boolean(player.shielded),
      pendingItem: player.pendingItem || null,
      nextRollHalved: Boolean(player.nextRollHalved),
      wins: player.wins || 0,
      position: player.position,
      diceValue: player.diceValue,
      nextRollBoost: player.nextRollBoost || 0,
      nextRollPenalty: player.nextRollPenalty || 0,
      minigameScore: player.minigameScore
    })),
    currentMinigame: room.currentMinigame ? serializeMinigame(room.currentMinigame) : null,
    lastMinigameResult: room.lastMinigameResult,
    resultEndsAt: room.resultEndsAt,
    readyForNext: room.readyForNext || [],
    readyNeeded: humansInRoom(room).length,
    lastMove: room.lastMove,
    lastMessage: room.lastMessage,
    winnerIds: room.winnerIds,
    starIndex: room.starIndex ?? null,
    starPrice: starPrice(room),
    starsSold: room.starsSold || 0,
    pendingJunction: room.pendingJunction || null,
    bonusStars: room.bonusStars || [],
    itemCatalog: ITEM_DEFINITIONS,
    serverTime: Date.now()
  };
}

function serializeMinigame(minigame) {
  return {
    id: minigame.id,
    type: minigame.type,
    title: minigame.title,
    reason: minigame.reason,
    startedAt: minigame.startedAt,
    duration: minigame.duration,
    finaleAt: minigame.finaleAt || null,
    scores: minigame.scores,
    stopped: minigame.stopped,
    lanes: minigame.lanes,
    hits: minigame.hits,
    arena: minigame.arena,
    flux: minigame.flux,
    canopy: minigame.canopy,
    arcade: minigame.arcade,
    blocks: minigame.blocks
  };
}

function leaveCurrentRoom(socket, notify, intentional = false) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;

  const player = room.players.find((candidate) => candidate.id === socket.data.playerId);
  const controlledPlayers = room.players.filter((candidate) => candidate.controllerId === socket.id || candidate.id === socket.data.playerId);
  if (controlledPlayers.length > 0) {
    if (room.status === "lobby") {
      const controlsHost = controlledPlayers.some((candidate) => candidate.id === room.hostId);
      if (controlsHost && intentional) {
        io.to(code).emit("roomClosed", { message: "Der Host hat die Lobby verlassen. Erstelle einen neuen Raum." });
        clearRoomTimers(room);
        rooms.delete(code);
        socket.leave(code);
        socket.data.roomCode = null;
        socket.data.playerId = null;
        return;
      }
      if (intentional) {
        const controlledIds = new Set(controlledPlayers.map((candidate) => candidate.id));
        room.players = room.players.filter((candidate) => !controlledIds.has(candidate.id));
      } else {
        controlledPlayers.forEach((candidate) => {
          if (!candidate.isBot) candidate.connected = false;
        });
      }
    } else {
      controlledPlayers.forEach((candidate) => {
        if (!candidate.isBot) candidate.connected = false;
      });
    }
  }

  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.playerId = null;

  if (room.players.length === 0 || !room.players.some((candidate) => !candidate.isBot && candidate.connected)) {
    if (!room.cleanupTimer) {
      room.cleanupTimer = setTimeout(() => {
        clearRoomTimers(room);
        rooms.delete(code);
      }, room.status === "lobby" ? 30000 : 120000);
    }
  } else {
    if (notify) {
      const hostLeft = controlledPlayers.some((candidate) => candidate.id === room.hostId);
      room.lastMessage = hostLeft
        ? "Host-Verbindung verloren. Das Spiel bleibt sichtbar, aber Host-Aktionen sind gesperrt."
        : `${player?.name || "Ein Spieler"} hat die Verbindung verloren.`;
      io.to(room.code).emit("roomNotice", {
        severity: hostLeft ? "error" : "warning",
        message: room.lastMessage
      });
      emitRoom(room);
      scheduleDisconnectedTurnSkip(room);
    }
  }
}

function findRoomForSocket(socket, code) {
  const normalized = normalizeCode(code || socket.data.roomCode);
  const room = rooms.get(normalized);
  if (!room) return null;
  return room;
}

function getCurrentPlayer(room) {
  return room.players[room.currentTurnIndex] || null;
}

function canControl(socket, player) {
  return player.id === socket.data.playerId || player.controllerId === socket.id;
}

function isHost(socket, room) {
  return socket.data.playerId === room.hostId;
}

function replyOk(reply, room, playerId) {
  reply?.({ ok: true, playerId, room: serializeRoom(room) });
}

function replyError(reply, message) {
  reply?.({ ok: false, error: message });
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(name, fallback) {
  const cleaned = String(name || fallback)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>&"']/g, "")
    .slice(0, 18);
  return cleaned || fallback;
}

function normalizeCode(code) {
  // Nur echte Zeichenketten und Zahlen werden umgewandelt. String(x) wirft bei
  // Objekten ohne brauchbares toString ({ toString: null }, Object.create(null)),
  // und dieser Wurf lag VOR jeder Antwort an den Client — der Rückruf kam dann
  // nie, und ein Tipp im Spiel hing für immer still. Gemessen im Härtetest.
  if (typeof code === "string") return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (typeof code === "number" && Number.isFinite(code)) return String(code).slice(0, 6);
  return "";
}

function setTrackedTimeout(room, callback, ms) {
  const timer = setTimeout(() => {
    room.timers.delete(timer);
    callback();
  }, ms);
  room.timers.add(timer);
  return timer;
}

function setTrackedInterval(room, callback, ms) {
  const timer = setInterval(callback, ms);
  room.timers.add(timer);
  return timer;
}

function clearMinigameTimers(room) {
  if (room.minigameTick) {
    clearInterval(room.minigameTick);
    room.minigameTick = null;
  }
}

function clearRoomTimers(room) {
  if (room.botTurnTimer) {
    clearTimeout(room.botTurnTimer);
    room.botTurnTimer = null;
  }
  if (room.skipTurnTimer) {
    clearTimeout(room.skipTurnTimer);
    room.skipTurnTimer = null;
  }
  clearMinigameTimers(room);
  room.timers.forEach((timer) => {
    clearTimeout(timer);
    clearInterval(timer);
  });
  room.timers.clear();
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Zahlenfelder aus Spielereingaben immer hierüber lesen, nie mit blossem
// Number(). Number(x) ruft ToPrimitive und WIRFT bei Objekten ohne brauchbares
// toString ({ toString: null }, Object.create(null)) — und das an 15 Stellen
// quer durch alle Eingabe-Familien, jede davon mitten im Tick. Ein Wurf dort
// nimmt die ganze Partie mit, nicht nur den, der den Unsinn geschickt hat.
// Gemessen im Härtetest an der Farbenjagd.
function inputNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  return NaN;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getLocalAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

if (require.main === module) {
  // Last-resort net. Adversarial payloads are already handled defensively in
  // the handlers, but a logic bug in the 90 ms minigame tick would otherwise
  // take the process down and end every party on this server at once. Staying
  // up with one broken room beats dropping all of them.
  process.on("uncaughtException", (error) => {
    console.error("[tumblekin] Unerwarteter Fehler — Server läuft weiter:", error);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[tumblekin] Unbehandelte Promise-Ablehnung:", reason);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Tumblekin server running at http://localhost:${PORT}`);
    getLocalAddresses().forEach((address) => {
      console.log(`WLAN URL: http://${address}:${PORT}`);
    });
  });

  // Container und Ctrl-C sollen die offenen Sockets sauber schließen.
  const shutdown = (signal) => () => {
    console.log(`[tumblekin] ${signal} empfangen — fahre herunter.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", shutdown("SIGTERM"));
  process.on("SIGINT", shutdown("SIGINT"));
}

module.exports = {
  testRules: {
    BOARD_DEFINITIONS,
    FIELD_TYPES,
    GATE_COIN_BONUS,
    MINIGAMES,
    SEEK_SIZE,
    ESTIMATE_ROUNDS,
    ESTIMATE_BANDS,
    buildEstimateRounds,
    estimateRoundAt,
    estimateValue,
    seekSteps,
    seekGemFor,
    seekFindValue,
    ITEM_DEFINITIONS,
    GOLD_DICE_MIN,
    GOLD_DICE_SPAN,
    applyFieldEffect,
    STAR_PRICE,
    COIN_FIELD_REWARD,
    NORMAL_FIELD_REWARD,
    TRAP_FIELD_COST,
    LUCK_FIELD_STAKE,
    LUCK_FIELD_WIN,
    MAX_ITEMS,
    ITEM_DEFINITIONS,
    itemDefinition,
    consumeItem,
    moveStarPad,
    awardBonusStars,
    resetBoardProgress,
    nearestToStar,
    standingsLeader,

    arcadeRankingScore,
    beginMinigameFinale,
    humansInRoom,
    rankPlaces,
    bounceResultScore,
    buildBoardPath,
    canopyRaceScore,
    compareStanding,
    createArcadeState,
    createCanopyState,
    getBoard,
    handleArcadeInput,
    handleCanopyInput,
    arcadeTargetPosition,
    arcadeResultDetail,
    createArenaState,
    handleArenaInput,
    updateBounceArena,
    arenaBotStep,
    arcadeBotStep,
    ARENA_RADIUS,
    ARENA_BALL_RADIUS,
    ARENA_RESPAWN_MS,
    createRunnerCourse,
    runnerBlockedLanes,
    advanceColorRound,
    nearestLowerCanopyLeaf,
    refreshFluxScores,
    updateArcade,
    updateRedlight,
    updateWave,
    buildRedlightPhases,
    redlightPhaseAt,
    buildWaveSchedule,
    REDLIGHT_GOAL,
    REDLIGHT_SPEED,
    REDLIGHT_PENALTY,
    WAVE_JUMP_MS,
    updateBarrel,
    updateBomb,
    updateKnife,
    buildBarrelPhases,
    barrelPhaseAt,
    bombFuseMs,
    buildArcadePlan,
    BARREL_LIMIT,
    BOMB_PASS_LOCK_MS,
    KNIFE_MIN_GAP_DEG,
    KNIFE_DISC_CAPACITY,
    knifeRoundsFor,
    STACK_BLOCKS,
    CLIMB_HEIGHT,
    resolveGateRewards,
    resolveStarPurchase,
    roomCreateBlockedReason,
    MAX_ROOMS_PER_ADDRESS,
    GLIDE_DURATION_MS,
    DIVE_DURATION_MS,
    DIVE_STEP_MS,
    DIVE_SURFACE_MS,
    DIVE_STUN_MS,
    DIVE_MAX_DEPTH,
    DIVE_RISK_MAX,
    diveGain,
    diveCarried,
    diveRisk,
    diveRiskAt,
    diveStepValue,
    diveBestDepth,
    GLIDE_GRAVITY,
    GLIDE_LIFT,
    GLIDE_VY_MAX,
    GLIDE_GATE_FIRST_MS,
    GLIDE_GATE_EVERY_MS,
    GLIDE_GATE_GAP_START,
    GLIDE_GATE_GAP_END,
    GLIDE_GATE_MAX_STEP,
    GLIDE_GATE_POINTS,
    GLIDE_CENTRE_BONUS,
    GLIDE_STALL_MS,
    buildGlideGates,
    glideGateGap,
    SUMO_RING_RADIUS,
    SUMO_CHARGE_MS,
    SUMO_ZONE,
    SUMO_RECOVER_MS,
    SUMO_MIN_CHARGE_MS,
    SUMO_MAX_IMPULSE,
    SUMO_HITS_OUT,
    updateSumoStone,
    BOUNCE_BEAT_START_MS,
    BOUNCE_BEAT_MIN_MS,
    BOUNCE_BAR_BEATS,
    BOUNCE_TEMPOS,
    bounceInterval,
    bounceBar,
    BOUNCE_PERFECT_MS,
    BOUNCE_GOOD_MS,
    BOUNCE_MISS_PENALTY,
    BOUNCE_MAX_HEIGHT,
    bounceBeatTime,
    bounceNearestBeat,
    FEINT_DURATION_MS,
    FEINT_GROW_MS,
    FEINT_HOLD_MS,
    FEINT_FAKE_LIMITS,
    feintRadius,
    FEINT_MAX_POINTS,
    FEINT_MIN_POINTS,
    FEINT_FALSE_START,
    FEINT_LOCK_MS,
    FEINT_DOUBLE_TAP_MS,
    buildFeintSignals,
    activeFeintSignal,
    feintPoints,
    TRACE_TOLERANCE,
    TRACE_NARROW_MIN,
    TRACE_GEMS_PER_LAP,
    TRACE_GEM_POINTS,
    TRACE_GEM_REACH,
    traceWidthAt,
    traceToleranceAt,
    buildTraceGems,
    TRACE_STEP_LIMIT,
    TRACE_MAX_SPEED,
    TRACE_REENTRY_WINDOW,
    TRACE_SLIP_LOCK_MS,
    TRACE_LAP_POINTS,
    TRACE_SLIP_COST,
    TRACE_CLEAN_BONUS,
    tracePathX,
    traceOffset,
    traceScore,
    BELT_COLOURS,
    BELT_CHUTES,
    BELT_QUEUE,
    BELT_SPEED_START,
    BELT_SPEED_END,
    BELT_REACH_AT,
    BELT_SWAP_FIRST_MS,
    BELT_SWAP_EVERY_MS,
    BELT_SWAP_WARN_MS,
    BELT_POINTS,
    BELT_STREAK_BONUS,
    BELT_STREAK_MAX,
    BELT_WRONG_COST,
    BELT_MISS_COST,
    BELT_DURATION_MS,
    SIMON_ROUNDS,
    SIMON_DURATION_MS,
    REACT_ROUNDS,
    buildSimonRounds,
    buildReactRounds,
    beltSpeed,
    buildBeltChutePlan,
    makeBeltParcel,
    advanceBeltQueue,
    FISH_DURATION_MS,
    FISH_REEL_SPEED,
    FISH_SLIP_SPEED,
    FISH_TENSION_CALM,
    FISH_TENSION_SURGE,
    FISH_RELAX,
    FISH_HOLD_GRACE_MS,
    FISH_SNAP_PAUSE_MS,
    FISH_SNAP_COST,
    FISH_LANDED_POINTS,
    FISH_SNAP_SHARE,
    FISH_SPECIES,
    fishSpeciesFor,
    FISH_LEAD_IN_MS,
    buildFishPhases,
    activeFishPhase,
    fishSurging,
    fishScore,
    PAINT_COLS,
    PAINT_ROWS,
    PAINT_SPEED,
    PAINT_BUMP_RADIUS,
    PAINT_CLAIM_RATE,
    PAINT_STEAL_RATE,
    PAINT_TILE_SECOND_POINTS,
    PAINT_BUMP_COOLDOWN_MS,
    PAINT_BOOST_MS,
    PAINT_PICKUP_MAX,
    PAINT_DURATION_MS,
    paintIndex,
    paintInside,
    paintClaim,
    paintBrushTiles,
    paintOwnedCount
  }
};
