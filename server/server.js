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

const ITEM_DEFINITIONS = [
  {
    id: "doubleDice",
    name: "Doppelwürfel",
    icon: "🎲",
    help: "Würfelt zweimal und addiert — die beste Chance, den Stern zu erreichen."
  },
  {
    id: "goldDice",
    name: "Goldwürfel",
    icon: "✨",
    help: "Garantiert eine hohe Zahl (7–9)."
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
const PLATE_DURATION_MS = 34000;
const FISH_DURATION_MS = 34000;
const PAINT_DURATION_MS = 32000;

// Only the fully 3D challenges remain; the flat 2D minigames were retired.
const MINIGAMES = [
  { type: "bounceArena", title: "Bumper Bloom", duration: 18000 },
  { type: "finishRush", title: "Zielgerade", duration: 42000, arcadeFamily: "runner" },
  { type: "colorEscape", title: "Farbflucht", duration: 38000, arcadeFamily: "colorgrid" },
  { type: "nervenprobe", title: "Nervenprobe", duration: 14000, arcadeFamily: "stopclock" },
  { type: "lichtwaechter", title: "Lichtwächter", duration: 32000, arcadeFamily: "redlight" },
  { type: "ballonPump", title: "Pump-Panik", duration: 12000, arcadeFamily: "pump" },
  { type: "fassrolle", title: "Fassrolle", duration: 32000, arcadeFamily: "barrel" },
  { type: "zuendstoff", title: "Zündstoff", duration: 45000, arcadeFamily: "bomb" },
  { type: "muenzregen", title: "Münzregen", duration: 30000, arcadeFamily: "catchfall" },
  { type: "blobklopfe", title: "Blob-Klopfe", duration: 25000, arcadeFamily: "whack" },
  { type: "seilspringen", title: "Seilspringen", duration: 35000, arcadeFamily: "wave" },
  { type: "kanonenflug", title: "Kanonenflug", duration: 16000, arcadeFamily: "cannon" },
  { type: "messerwurf", title: "Messerwurf", duration: 46000, arcadeFamily: "knife" },
  { type: "turmbau", title: "Turmbau", duration: 30000, arcadeFamily: "stack" },
  { type: "bergsteiger", title: "Bergsteiger", duration: 26000, arcadeFamily: "climb" },
  { type: "schleuderschuss", title: "Schleuderschuss", duration: 28000, arcadeFamily: "sling" },
  { type: "sumoschubs", title: "Sumo-Schubs", duration: 40000, arcadeFamily: "sumo" },
  { type: "trampolin", title: "Trampolin", duration: 30000, arcadeFamily: "bounce" },
  { type: "falschsignal", title: "Falschsignal", duration: FEINT_DURATION_MS, arcadeFamily: "feint" },
  { type: "spurmaler", title: "Spurmaler", duration: 30000, arcadeFamily: "trace" },
  { type: "tellerdreher", title: "Tellerdreher", duration: PLATE_DURATION_MS, arcadeFamily: "plates" },
  { type: "angelduell", title: "Angelduell", duration: FISH_DURATION_MS, arcadeFamily: "fish" },
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
  schleuderschuss: { family: "sling", seed: 467 },
  sumoschubs: { family: "sumo", seed: 479 },
  trampolin: { family: "bounce", seed: 487 },
  falschsignal: { family: "feint", seed: 491 },
  spurmaler: { family: "trace", seed: 499 },
  tellerdreher: { family: "plates", seed: 503 },
  angelduell: { family: "fish", seed: 509 },
  farbenjagd: { family: "paint", seed: 521 }
};

// Schleuderschuss: Zurückziehen lädt Kraft, Winkel bestimmt die Flugbahn.
// Ringe zählen nach Nähe zur Mitte; jeder Schuss zieht das Ziel weiter weg,
// damit spätere Treffer mehr wert sind und Kraftdosierung wirklich zählt.
const SLING_SHOTS = 5;
const SLING_RING_SCORES = [100, 60, 30, 10];   // Bulls-eye nach außen
// Toleranzen in Metern Abweichung von der Zieldistanz. Bewusst grosszügig:
// mit Daumensteuerung sind 1 % Kraftunterschied ~1,6 px — enge Ringe (erster
// Versuch: 0,12 m) machten das Spiel zu reinem Raten. Zusammen mit der
// Landevorschau im Client bleibt es trotzdem Können statt Zufall.
const SLING_RING_RADII = [0.35, 0.85, 1.6, 2.6];
const SLING_BASE_DISTANCE = 9;
const SLING_DISTANCE_STEP = 1.6;
const SLING_GRAVITY = 9.81;
const SLING_MAX_SPEED = 15;

// Sumo-Schubs: alle laden gleichzeitig auf und stossen den Stein von sich weg.
// Wer zu lange lädt, rutscht aus und stösst gar nicht — das ist der Reiz, nicht
// das Timing eines fremden Zeigers.
const SUMO_RING_RADIUS = 1.0;          // normiert: Stein ausserhalb = Treffer
const SUMO_CHARGE_MS = 1200;           // volle Kraft nach dieser Haltezeit
const SUMO_OVERCHARGE_MS = 1650;       // ab hier rutscht man aus
const SUMO_MIN_CHARGE_MS = 120;        // darunter zählt es als Antippen
const SUMO_MAX_IMPULSE = 1.5;          // Geschwindigkeitsänderung bei Vollkraft
const SUMO_FRICTION = 1.5;             // pro Sekunde
// Einen Stein, der auf einen zurollt, stösst man wuchtiger zurück als einen, der
// ohnehin schon wegrollt. Ohne diesen Zuschlag war „immer sofort mit voller
// Kraft stossen" die beste Strategie, egal wo der Stein lag — Stellung und
// Timing waren wertlos.
// Eine reine Reichweitengrenze (Stoss wird schwächer, je weiter der Stein weg
// ist) war der falsche Weg und steht hier als Warnung: sie STABILISIERT den
// Ring, weil immer genau die Person am kräftigsten schieben kann, auf die der
// Stein zuläuft. Gemessen kam der Stein danach nie über die Hälfte des Radius
// hinaus und in 20 Partien fiel kein einziger Treffer.
const SUMO_MEET_MIN = 0.6;             // Stein rollt weg — halbherziger Stoss
const SUMO_MEET_MAX = 1.6;             // Stein kommt entgegen — voller Konter
const SUMO_HITS_OUT = 3;               // so viele Treffer und man ist raus
const SUMO_SLIP_MS = 900;              // Erholung nach dem Ausrutschen

// Trampolin: ein Takt schlägt gleichmässig, Tippen IM Takt federt höher.
// Aufeinanderfolgende Treffer bauen Resonanz auf — daneben tippen bricht sie.
// Der Takt wird schneller, also muss man sich neu einhören.
const BOUNCE_BEAT_START_MS = 900;
// Der schnellste Takt muss WEITER auseinander liegen als das Trefferfenster
// breit ist: bei 340 ms lag jeder Tipper höchstens 170 ms neben dem nächsten
// Schlag — also immer innerhalb der 220 ms für einen Teiltreffer. Danebentippen
// wäre am Ende der Runde schlicht unmöglich gewesen.
const BOUNCE_BEAT_MIN_MS = 520;
const BOUNCE_BEAT_RAMP = 0.965;        // Faktor je Schlag
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
const BOUNCE_MAX_HEIGHT = 32;

// Falschsignal: nur das ECHTE Signal darf angetippt werden. Die Fälschungen
// sehen absichtlich ähnlich aus, und ein Antäuscher blitzt zu kurz auf, um echt
// zu sein. Wer auf eine Fälschung tippt, verliert Punkte — Abwarten kostet
// nichts, bringt aber auch nichts.
const FEINT_LEAD_IN_MS = 1400;         // Ruhe vor dem ersten Signal
const FEINT_GAP_MIN_MS = 900;          // Abstand zwischen Signalen
const FEINT_GAP_MAX_MS = 2200;
const FEINT_GO_WINDOW_MS = 900;        // so lange gilt ein echtes Signal
const FEINT_FAKE_WINDOW_MS = 700;
const FEINT_FLICKER_MS = 130;          // Antäuscher: zu kurz für echt
const FEINT_MIN_POINTS = 60;           // am Ende des Fensters
const FEINT_MAX_POINTS = 500;          // bei sofortiger Reaktion
// Der Abzug ist bewusst höher als der halbe Treffer: bei einem echten Signal
// pro Dreierblock muss blindes Dauertippen unterm Strich Punkte KOSTEN. Ein
// einzelner Fehlgriff bleibt trotzdem aufholbar, weil ein guter Treffer mehr
// bringt als ein Fehlgriff nimmt.
const FEINT_FALSE_START = 300;         // Abzug für einen Fehlgriff
const FEINT_LOCK_MS = 650;             // Sperre nach einem Fehlgriff
const FEINT_DOUBLE_TAP_MS = 260;       // Nachzittern nach einem Treffer ignorieren
const FEINT_FAKE_KINDS = ["colour", "shape", "flicker"];
const FEINT_BLOCK = 3;                 // je Dreierblock genau ein echtes Signal

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

// Tellerdreher: mehrere Teller drehen sich langsam aus. Ein Antippen gibt einem
// Teller Schwung zurück — aber man hat nur EINE Hand.
//
// Diese Hand ist der Kern des Spiels und der Grund, warum Dauertippen nichts
// bringt: jedes Antippen kostet aus einem Vorrat, der sich mit fester Rate
// füllt, und ein fast voller Teller verschluckt den Rest. Wer wild auf alles
// tippt, verschwendet die Hand an Teller, die sie nicht brauchen, und die
// vernachlässigten fallen. Das Können liegt im Verteilen, nicht im Tempo.
const PLATE_START = 2;                 // Teller am Anfang
const PLATE_MAX = 6;
const PLATE_ADD_MS = 5000;             // alle 5 s kommt einer dazu
const PLATE_SPIN_GAIN = 0.34;          // Schwung je Antippen
const PLATE_HAND_RATE = 1.5;           // Handvorrat pro Sekunde
const PLATE_HAND_MAX = 0.68;           // höchstens zwei Antipper im Vorrat
// Am gespielten Ergebnis geeicht, nicht geschätzt. Mit 0.13/0.26 hielt selbst
// gemächliches Spiel alle sechs Teller: 96% der möglichen Tellerzeit, kein
// einziger Verlust — es gab nichts zu entscheiden. Jetzt gilt: bei einem
// Handvorrat von 1.5 pro Sekunde sind sustainable = 1.5/Verlust Teller. Am
// Anfang (0.20) sind das 7.5 — die ersten Teller laufen also mühelos. Am Ende
// (0.40) nur noch 3.75, sechs sind dann nicht zu halten. Genau das ist die
// Dramaturgie: entspannter Start, überfordertes Finale, und das Können liegt
// darin, WELCHE Teller man aufgibt.
const PLATE_DECAY_START = 0.20;        // Schwungverlust pro Sekunde je Teller
const PLATE_DECAY_END = 0.40;          // am Ende der Runde
const PLATE_TOUCH_MS = 140;            // derselbe Teller nicht im Dauerfeuer
const PLATE_RESPAWN_MS = 1800;         // ein gefallener Teller kommt zurück
const PLATE_RESPAWN_SPIN = 0.5;
const PLATE_DROP_COST = 60;
const PLATE_POINTS_PER_SECOND = 10;    // je drehender Teller
const PLATE_WOBBLE_AT = 0.34;          // ab hier wackelt der Teller sichtbar

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
const FISH_SNAP_COST = 80;
const FISH_LANDED_POINTS = 300;
const FISH_CALM_MIN_MS = 1400;         // Länge der ruhigen Phase
const FISH_CALM_MAX_MS = 2600;
const FISH_SURGE_MIN_MS = 900;         // Länge eines Schubs
const FISH_SURGE_MAX_MS = 1600;
const FISH_LEAD_IN_MS = 900;           // Ruhe, bevor der erste Schub kommt
const FISH_MAX_CATCH = 20;             // Sicherheitsnetz

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
const PAINT_ACCEL = 14;                // wie schnell die Richtung greift
const PAINT_DAMPING = 0.86;
const PAINT_BUMP_RADIUS = 0.78;        // ab hier schubsen sich zwei Kins
const PAINT_BUMP_FORCE = 5.2;
const PAINT_BUMP_COOLDOWN_MS = 500;    // ein Rempler, nicht einer pro Tick
const PAINT_TILE_SECOND_POINTS = 4;    // Punkte je gehaltenem Feld und Sekunde
const PAINT_BOOST_MS = 5000;           // Dauer der breiten Rolle
const PAINT_PICKUP_EVERY_MS = 4200;
const PAINT_PICKUP_MAX = 2;

const STOPCLOCK_TARGETS = [5000, 6500, 7500];
const RUNNER_LENGTH = 150;
const RUNNER_BASE_SPEED = 5.8;
const RUNNER_STUMBLE_MS = 1150;
const RUNNER_BOOST_MS = 1300;
const COLORGRID_SIZE = 6;
const COLORGRID_ROUNDS = 6;
const COLORGRID_ROUND_MS = 6000;
const COLORGRID_ANNOUNCE_MS = 2600;
const COLORGRID_DROP_END_MS = 4800;
const COLORGRID_LEAD_MS = 3000;       // calm lead-in before the first drop
// Die Runden ziehen an. Vorher war jede Runde gleich lang und gleich leicht: bei
// 2,6 s Vorwarnung und im Schnitt neun sicheren Feldern war das nächste Ziel
// meist einen Schritt entfernt, und gemessen überlebten ALLE drei Bot-Stufen
// gleich viele Runden. Ohne Steigerung entscheidet nur das Pech.
const COLORGRID_ANNOUNCE_MIN_MS = 900;
const COLORGRID_ANNOUNCE_STEP_MS = 340;   // je Runde weniger Vorwarnung
const COLORGRID_DROP_MS = 2200;           // Fallphase, unabhängig von der Vorwarnung
const COLORGRID_SAFE_START = 10;          // sichere Felder in Runde 1
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
const BARREL_LIMIT = 1.35;            // slide distance before falling off
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
const KNIFE_ROUNDS = 3;
// Ein Treffer auf ein anderes Messer kostet den Wurf und die Runde, aber nicht
// gleich die ganze Partie: mit sofortigem Aus schieden gemessen 9 von 10
// schwächeren Mitspielenden nach dem ersten oder zweiten Wurf aus und sahen den
// Rest nur noch zu. Das zweite Mal ist das Aus.
const KNIFE_LIVES = 2;
const KNIFE_TURN_START_MS = 3000;     // Wurffenster in der ersten Runde
const KNIFE_TURN_MIN_MS = 1500;
const KNIFE_TURN_STEP = 0.84;         // je Runde wird es enger

// Turmbau — drop the sliding block onto your tower; misalignment trims it.
const STACK_BLOCKS = 14;
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
const CLIMB_HEIGHT = 30;

// Blob-Klopfe — whack the blobs that pop out of the 3x3 holes.
const WHACK_CELLS = 9;

// Kanonenflug — tap once for power, once for the launch angle (45° is best).
const CANNON_PERIOD_MS = 1300;        // full swing of the power gauge
const CANNON_ANGLE_PERIOD_MS = 1500;  // full sweep of the angle gauge (5°-85°)

// Blitzfang — wait for green, tap first; a false start costs dearly.
const REACT_ROUNDS = 3;
const REACT_WINDOW_MS = 2200;
const REACT_PENALTY_MS = 900;

const PLINKO_SLOTS = [1, 4, 7, 12, 7, 4, 1];
const PLINKO_GRAVITY = 1.35;
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
  socket.on("createRoom", (payload, reply) => {
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
      bonusStars: [],
      currentTurnIndex: 0,
      minigameCounter: 0,
      devMode: false,
      currentMinigame: null,
      lastMinigameResult: null,
      resultEndsAt: null,
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

  socket.on("joinRoom", (payload, reply) => {
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

  socket.on("resumeRoom", (payload, reply) => {
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

  socket.on("leaveRoom", (_payload, reply) => {
    leaveCurrentRoom(socket, true, true);
    reply?.({ ok: true });
  });

  socket.on("addTestPlayers", (payload, reply) => {
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

  socket.on("enableDevMode", (payload, reply) => {
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

  socket.on("selectBoard", (payload, reply) => {
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

  socket.on("selectMode", (payload, reply) => {
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

  socket.on("selectSingleGame", (payload, reply) => {
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

  socket.on("startGame", (payload, reply) => {
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

  socket.on("startDevMinigame", (payload, reply) => {
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


  socket.on("rollDice", (payload, reply) => {
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

  socket.on("minigameInput", (payload, reply) => {
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

  socket.on("useItem", (payload, reply) => {
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

  socket.on("restartGame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann neu starten.");
    resetToLobby(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
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
    baseDice = 7 + Math.floor(Math.random() * 3);
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
  const from = player.position;
  const pathSteps = buildBoardPath(board, from, dice);
  const to = pathSteps[pathSteps.length - 1];
  player.diceValue = dice;

  const fieldType = board.fieldTypes[to];
  const movementDurationMs = Math.max(BOARD_STEP_MS, pathSteps.length * BOARD_STEP_MS);
  const move = {
    boardId: board.id,
    playerId: player.id,
    from,
    to,
    path: pathSteps,
    dice,
    fieldType,
    diceDelayMs: DICE_REVEAL_MS,
    stepDurationMs: BOARD_STEP_MS,
    movementDurationMs,
    durationMs: DICE_REVEAL_MS + movementDurationMs,
    diceNote,
    message: `${player.name} würfelt ${formatDiceRoll(baseDice, boost, penalty, dice)}${diceNote ? ` (${diceNote})` : ""}.`
  };
  room.lastMove = move;
  room.lastMessage = `${player.name} zieht ${dice} Felder.`;

  io.to(room.code).emit("boardMove", move);
  emitRoom(room);

  const timer = setTrackedTimeout(room, () => {
    if (room.status !== "board" || room.phase !== "moving") return;
    player.position = to;
    const gateEffects = resolveGateRewards(player, pathSteps, board);
    // Passing the lit star pad buys the star before the landing field resolves.
    const starPass = resolveStarPurchase(player, pathSteps, room);
    const fieldEffect = applyFieldEffect(player, fieldType, room);
    const messages = [
      ...gateEffects.map((effect) => effect.message),
      starPass?.message,
      fieldEffect.message
    ].filter(Boolean);
    const landing = {
      ...move,
      fieldEffect,
      gateEffects,
      starPass,
      message: messages.join(" ")
    };
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
  }, move.durationMs);

  return { ok: true, dice, timer };
}

// One simple loop forward — no shortcut branches.
function buildBoardPath(board, from, steps) {
  const path = [];
  let cursor = from;
  for (let step = 1; step <= steps; step += 1) {
    const next = board.routes[cursor]?.[0] ?? (cursor + 1) % board.fieldTypes.length;
    path.push(next);
    cursor = next;
  }
  return path;
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
  if (player.coins < STAR_PRICE) {
    return {
      type: "starPass",
      fieldIndex: lit,
      coins: 0,
      affordable: false,
      message: `Am Stern vorbei — ${STAR_PRICE} Münzen nötig, du hast ${player.coins}.`
    };
  }
  player.coins -= STAR_PRICE;
  player.stars += 1;
  const movedTo = moveStarPad(room, { avoid: lit });
  return {
    type: "starPass",
    fieldIndex: lit,
    coins: -STAR_PRICE,
    affordable: true,
    starGained: true,
    starMovedTo: movedTo,
    message: `⭐ Im Vorbeigehen einen Stern geschnappt! (-${STAR_PRICE} Münzen)`
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
    if (player.coins < STAR_PRICE) {
      return {
        type: fieldType,
        coins: 0,
        starLit: true,
        starAffordable: false,
        message: `Ein Stern kostet ${STAR_PRICE} Münzen — dir fehlen ${STAR_PRICE - player.coins}.`
      };
    }
    player.coins -= STAR_PRICE;
    player.stars += 1;
    const from = player.position;
    const to = room ? moveStarPad(room, { avoid: from }) : null;
    return {
      type: fieldType,
      coins: -STAR_PRICE,
      starLit: true,
      starAffordable: true,
      starGained: true,
      starMovedTo: to,
      message: `⭐ Stern gekauft! (-${STAR_PRICE} Münzen) Der Stern zieht weiter.`
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

function handleMinigameInput(room, player, input) {
  const minigame = room.currentMinigame;
  if (room.status !== "minigame" || !minigame) {
    return { ok: false, error: "Gerade läuft kein Minispiel." };
  }
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
      // trace ist eine Zugbewegung, plates ein Wechseln zwischen sechs Zielen —
      // beide brauchen Handrate, nicht Entscheidungsrate. Bei ~300 ms käme ein
      // Bot hier nur auf 1.0 Schwung pro Sekunde, gebraucht werden bis zu 1.56.
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
      const fastHand = ["trace", "plates", "fish", "paint", "stack", "bounce", "knife", "colorgrid", "sumo", "bomb", "stopclock", "cannon"].includes(minigame.arcade.family);
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
function beginMinigameFinale(room, minigame) {
  if (!minigame || minigame.finaleAt || minigame.finishing) return;
  minigame.finaleAt = Date.now() + MINIGAME_FINALE_MS;
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
  if (arcade.family === "plinko" || arcade.family === "curling") {
    return Math.max(0, score * 1000 + successes);
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
  if (arcade.family === "knife") {
    // Survivors rank above the eliminated; more knives stuck breaks ties, and
    // among equals the cleaner hand (fewer Fehlwürfe) ranks higher.
    return Math.max(0, (arcadePlayer.eliminated ? 0 : 5000000)
      + (arcadePlayer.stuck || 0) * 1000
      + (arcadePlayer.nerve || 0)
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
    return { kind: "coins", value: arcadePlayer.successes || 0, mistakes: arcadePlayer.mistakes || 0, label: "Münzen" };
  }
  if (arcade.mode === "course" || arcade.mode === "avoid") {
    return { kind: "hits", value: arcadePlayer.mistakes || 0, label: "Treffer" };
  }
  if (arcade.mode === "catch") {
    return { kind: "catches", value: arcadePlayer.successes || 0, mistakes: arcadePlayer.mistakes || 0, label: "Lichter" };
  }
  if (arcade.mode === "balance" || arcade.mode === "chase" || arcade.mode === "stay") {
    return { kind: "zoneTime", value: Math.round(arcadePlayer.activeMs || 0), label: "Im Ziel" };
  }
  if (arcade.family === "choice") {
    return { kind: "correct", value: arcadePlayer.successes || 0, mistakes: arcadePlayer.mistakes || 0, label: "Richtig" };
  }
  if (arcade.family === "timing") {
    return { kind: "precision", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Präzision" };
  }
  if (arcade.family === "target") {
    return { kind: "targets", value: arcadePlayer.successes || 0, mistakes: arcadePlayer.mistakes || 0, label: "Treffer" };
  }
  if (arcade.family === "plinko") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "curling") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Ring-Punkte" };
  }
  if (arcade.family === "stopclock") {
    return { kind: "deviationMs", value: arcadePlayer.deviationMs };
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
    return { kind: "zoneTime", value: Math.round(arcadePlayer.fallenAt ? (arcadePlayer.survivedMs || 0) : (arcadePlayer.score || 0)), label: "Auf dem Fass" };
  }
  if (arcade.family === "bomb") {
    return { kind: "points", value: arcadePlayer.passes || 0, label: "Weitergaben" };
  }
  if (arcade.family === "catchfall") {
    return { kind: "coins", value: arcadePlayer.catches || 0, mistakes: arcadePlayer.bombs || 0, label: "Münzen" };
  }
  if (arcade.family === "whack") {
    return { kind: "targets", value: arcadePlayer.hits || 0, mistakes: arcadePlayer.badHits || 0, label: "Treffer" };
  }
  if (arcade.family === "cannon") {
    return { kind: "points", value: arcadePlayer.distance || 0, label: "Meter" };
  }
  if (arcade.family === "simon") {
    return { kind: "correct", value: arcadePlayer.survived || 0, mistakes: arcadePlayer.mistakes || 0, label: "Runden" };
  }
  if (arcade.family === "react") {
    const played = arcadePlayer.times || [];
    const total = played.reduce((sum, value) => sum + value, 0) + (REACT_ROUNDS - played.length) * REACT_WINDOW_MS;
    return { kind: "deviationMs", value: total };
  }
  if (arcade.family === "knife") {
    return { kind: "points", value: arcadePlayer.stuck || 0, label: "Treffer" };
  }
  if (arcade.family === "stack") {
    return { kind: "points", value: arcadePlayer.height || 0, label: "Etagen" };
  }
  if (arcade.family === "bounce") {
    return { kind: "points", value: Math.round((arcadePlayer.best || 0) * 10) / 10, label: "Höhe" };
  }
  if (arcade.family === "feint") {
    return {
      kind: "reaction",
      value: Math.max(0, Math.round(arcadePlayer.score || 0)),
      bestMs: arcadePlayer.bestMs,
      mistakes: arcadePlayer.falseStarts || 0,
      label: "Punkte"
    };
  }
  if (arcade.family === "paint") {
    // Eigene Art, nicht das vorhandene "territory": dort gibt es kein Feld für
    // die übermalten Felder, und die sind hier die halbe Geschichte.
    return {
      kind: "paintTiles",
      value: Math.max(0, Math.round(arcadePlayer.score || 0)),
      owned: arcadePlayer.owned || 0,
      claimed: arcadePlayer.claimed || 0,
      label: "Punkte"
    };
  }
  if (arcade.family === "fish") {
    return {
      kind: "catch",
      value: Math.max(0, Math.round(arcadePlayer.score || 0)),
      landed: arcadePlayer.landed || 0,
      progress: Math.round((1 - clamp(arcadePlayer.distance ?? 1, 0, 1)) * 100),
      mistakes: arcadePlayer.snaps || 0,
      label: "Punkte"
    };
  }
  if (arcade.family === "plates") {
    return {
      kind: "plateTime",
      value: Math.max(0, Math.round(arcadePlayer.score || 0)),
      seconds: Math.round(arcadePlayer.upTime || 0),
      mistakes: arcadePlayer.drops || 0,
      label: "Punkte"
    };
  }
  if (arcade.family === "trace") {
    return {
      kind: "laps",
      value: Math.max(0, Math.round(arcadePlayer.score || 0)),
      laps: arcadePlayer.lapsDone || 0,
      progress: Math.round((arcadePlayer.progress || 0) * 100),
      mistakes: arcadePlayer.slips || 0,
      label: "Punkte"
    };
  }
  if (arcade.family === "sumo") {
    return arcadePlayer.eliminated
      ? { kind: "hits", value: arcadePlayer.hits || 0, label: "Treffer" }
      : { kind: "points", value: arcadePlayer.score || 0, label: "Standfest" };
  }
  if (arcade.family === "sling") {
    return { kind: "points", value: arcadePlayer.score || 0, label: "Ringpunkte" };
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

function handleArenaInput(room, player, input) {
  const minigame = room.currentMinigame;
  const arenaPlayer = minigame?.arena?.players?.[player.id];
  if (!arenaPlayer) return { ok: false, error: "Arena nicht bereit." };
  if (!arenaPlayer.inPlay) return { ok: true }; // still respawning — ignore, don't error

  const now = Date.now();
  const action = input.action;

  // Analog stick: a direction vector in [-1, 1]. Stored as a steering
  // intent and applied continuously by the physics step for a short window.
  if (action === "thrust") {
    let dx = Number(input.x) || 0;
    let dy = Number(input.y) || 0;
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
  const profile = bot.arenaProfile || (bot.arenaProfile = (() => {
    const roll = Math.random();
    return roll < 0.33 ? { edge: 0.78, aggro: 0.72 } : roll < 0.75 ? { edge: 0.86, aggro: 0.9 } : { edge: 0.92, aggro: 1 };
  })());

  // Too close to the rim yourself: retreat toward the middle.
  let targetX = -bot.x;
  let targetY = -bot.y;

  if (distanceFromCenter < ARENA_RADIUS * profile.edge) {
    const opponents = Object.entries(arena.players)
      .filter(([id, candidate]) => id !== playerId && candidate.inPlay && now >= candidate.invulnUntil)
      .map(([_id, candidate]) => candidate)
      .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y));
    const prey = opponents[0];
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
    players.forEach((player, index) => {
      arcade.players[player.id].aimX = 0.2 + index * 0.2;
      arcade.players[player.id].plinks = 0;
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
    arcade.round = 0;
    arcade.rounds = KNIFE_ROUNDS;
    arcade.turnMs = knifeTurnMs(0);
    arcade.turnEndsAt = startedAt + arcade.turnMs;
    arcade.spinSpeed = 1.1;
    arcade.logAngle = 0;
    arcade.knives = [];                  // { angleDeg, playerId }
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.stuck = 0;
      entry.clashes = 0;                 // Fehlwürfe auf ein anderes Messer
      entry.nerve = 0;                   // Zugabe für enge Lücken
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
    arcade.goWindowMs = FEINT_GO_WINDOW_MS;
    arcade.maxPoints = FEINT_MAX_POINTS;
    arcade.falseStartCost = FEINT_FALSE_START;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.hits = 0;
      entry.falseStarts = 0;
      entry.missed = 0;
      entry.bestMs = null;
      entry.handled = {};              // Signalindex -> true (einmal pro Signal)
      entry.lockUntil = 0;             // Sperre nach einem Fehlgriff
      entry.lastReact = null;          // { kind, points, reactionMs, at }
    });
  }
  if (config.family === "trace") {
    arcade.tolerance = TRACE_TOLERANCE;
    arcade.lapPoints = TRACE_LAP_POINTS;
    arcade.slipCost = TRACE_SLIP_COST;
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
      entry.brushY = 0;
      entry.lastAdvanceAt = startedAt;
      entry.lastSlipAt = 0;
      entry.lastLapAt = 0;
    });
  }
  if (config.family === "plates") {
    arcade.plateMax = PLATE_MAX;
    arcade.spinGain = PLATE_SPIN_GAIN;
    arcade.handMax = PLATE_HAND_MAX;
    arcade.wobbleAt = PLATE_WOBBLE_AT;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.hand = PLATE_HAND_MAX;
      entry.drops = 0;
      entry.upTime = 0;              // Tellersekunden, die eigentliche Wertung
      entry.wasted = 0;              // Antipper, die nichts gebracht haben
      entry.plateCount = PLATE_START;
      entry.plates = Array.from({ length: PLATE_MAX }, (_, index) => ({
        index,
        spin: index < PLATE_START ? 1 : 0,
        active: index < PLATE_START,
        fallenAt: 0,
        lastTouchAt: 0
      }));
      entry.lastDropAt = 0;
      entry.lastSpinAt = 0;
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
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.catchIndex = 0;
      entry.phases = buildFishPhases(config.seed, 0, FISH_DURATION_MS);
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
    arcade.overchargeMs = SUMO_OVERCHARGE_MS;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      // Gleichmässig im Kreis; der Winkel ist auch die Stossrichtung.
      const angle = (index / Math.max(1, players.length)) * Math.PI * 2 - Math.PI / 2;
      entry.angle = angle;
      entry.spotX = Math.cos(angle);
      entry.spotY = Math.sin(angle);
      entry.chargeStart = null;        // Zeitpunkt des Drückens
      entry.lastShove = null;          // { power, at, slipped }
      entry.shoves = 0;
      entry.slips = 0;
      entry.slipUntil = 0;
      entry.hits = 0;
      entry.eliminated = false;
    });
  }
  if (config.family === "sling") {
    arcade.shots = SLING_SHOTS;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      entry.shotsUsed = 0;
      entry.rings = [];                  // getroffener Ring je Schuss (null = daneben)
      entry.bullseyes = 0;
      entry.distance = SLING_BASE_DISTANCE;
      entry.lastShot = null;             // { power, angleDeg, ring, offset, at }
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
    const ramp = Math.min(1, index * 0.08);
    const magnitude = 0.5 + ramp * 1.35 + arcadeNoise(seed + index * 19) * 0.28;
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
function buildSimonRounds(seed) {
  const rounds = [];
  let at = 1500;
  for (let r = 0; r < 8; r += 1) {
    const seqLen = 2 + r;
    const sequence = Array.from({ length: seqLen }, (_v, i) => Math.floor(arcadeNoise(seed + r * 97 + i * 13) * 4));
    const showMs = seqLen * 650 + 700;
    const inputMs = seqLen * 950 + 900;
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
  while (position < RUNNER_LENGTH - 10) {
    const roll = arcadeNoise(seed + index * 17);
    if (roll < 0.1) {
      // Occasional breather with a boost pad.
      rows.push({ position, kind: "boost", lane: Math.floor(arcadeNoise(seed + index * 23) * 3) });
    } else if (roll < 0.38) {
      // Pickup orb: grab it to throw a straight tumble-shot down your lane.
      rows.push({ position, kind: "item", lane: Math.floor(arcadeNoise(seed + index * 47) * 3) });
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

function handleArcadeInput(room, player, input) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  const arcadePlayer = arcade?.players?.[player.id];
  if (!arcade || !arcadePlayer) return { ok: false, error: "Arcade-Spiel nicht bereit." };

  const now = Date.now();
  const cooldowns = { steer: 55, kinetic: 55, direct: 42, plinko: 180, curling: 180, runner: 130, colorgrid: 150, stopclock: 60, redlight: 60, wave: 200, pump: 40, barrel: 60, bomb: 150, catchfall: 110, whack: 110, cannon: 200, simon: 160, react: 200, knife: 90, stack: 90, climb: 40, sling: 400, sumo: 0, bounce: 0, feint: 0, trace: 45, plates: 0, fish: 60, paint: 55 };
  // sumo bewusst ohne Cooldown: Aufladen und Stossen sind ein Paar aus zwei
  // dicht aufeinanderfolgenden Ereignissen. Ein Cooldown blockte das `shove`
  // und liess den Ladezeitstempel hängen, wodurch der nächste, saubere Halt als
  // Überladen galt. Die Mechanik begrenzt sich selbst — man muss halten.
  // bounce und feint ebenso ohne Cooldown: dort IST der Tippzeitpunkt die
  // Wertung, ein Cooldown würde sie verschieben. Beide begrenzen sich selbst —
  // ein Versuch pro Schlag bzw. Sperre nach einem Fehlgriff.
  // plates ohne Cooldown, weil jede Eingabe einen ANDEREN Teller meint: ein
  // globaler Cooldown würde beim schnellen Wechseln echte Griffe verschlucken.
  // Begrenzt wird stattdessen pro Teller und über den Handvorrat.
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
    const cell = clamp(Math.round(Number(input.cell) || 0), 0, WHACK_CELLS - 1);
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
    const picked = clamp(Math.round(Number(input.index) || 0), 0, 3);
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
      // Nerven: je enger die Lücke war, in die das Messer ging, desto mehr zählt
      // der Wurf. Ohne das endeten 42 % der Partien unentschieden, weil bei drei
      // Runden fast jeder starke Spieler auf dieselben drei Treffer kommt.
      let gap = 180;
      arcade.knives.forEach((knife) => {
        const diff = Math.abs(((knife.angleDeg - normalized + 540) % 360) - 180);
        if (diff < gap) gap = diff;
      });
      arcadePlayer.nerve = (arcadePlayer.nerve || 0) + Math.round(Math.max(0, 90 - gap));
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

    if (signal && signal.kind === "go") {
      if (arcadePlayer.handled[signal.index]) return { ok: true };
      arcadePlayer.handled[signal.index] = true;
      const reactionMs = Math.round(elapsed - signal.at);
      const points = feintPoints(reactionMs, signal.windowMs);
      arcadePlayer.hits += 1;
      arcadePlayer.score += points;
      arcadePlayer.bestMs = arcadePlayer.bestMs === null ? reactionMs : Math.min(arcadePlayer.bestMs, reactionMs);
      arcadePlayer.lastReact = { kind: "go", points, reactionMs, at: now };
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
      syncArcadeScore(room.currentMinigame, player, arcadePlayer);
      return { ok: true };
    }

    // Fehlgriff: entweder auf eine Fälschung getippt oder ins Leere. Beides
    // kostet Punkte und sperrt kurz. Der Abzug darf den Punktestand unter Null
    // drücken — syncArcadeScore blendet das für die Wertung bei 0 ab, aber ein
    // Dauertipper gräbt sich so tief ein, dass er sich nicht mehr erholt.
    const fake = signal ? signal.kind : "early";
    if (signal) arcadePlayer.handled[signal.index] = true;
    arcadePlayer.falseStarts += 1;
    arcadePlayer.score -= FEINT_FALSE_START;
    arcadePlayer.lockUntil = now + FEINT_LOCK_MS;
    arcadePlayer.lastReact = { kind: fake, points: -FEINT_FALSE_START, reactionMs: null, at: now };
    arcadePlayer.flash = "bad";
    arcadePlayer.lastHitAt = now;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "paint") {
    if (input.action !== "steer") return { ok: false, error: "Lenke mit dem Stick." };
    const dx = Number(input.x);
    const dy = Number(input.y);
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

  if (arcade.family === "plates") {
    if (input.action !== "spin") return { ok: false, error: "Tippe einen Teller an." };
    const index = Math.floor(Number(input.plate));
    if (!Number.isInteger(index) || index < 0 || index >= PLATE_MAX) return { ok: false, error: "Diesen Teller gibt es nicht." };
    const plate = arcadePlayer.plates[index];
    if (!plate || !plate.active) return { ok: true };
    if (now - plate.lastTouchAt < PLATE_TOUCH_MS) return { ok: true };
    arcadePlayer.hasMoved = true;
    plate.lastTouchAt = now;

    // Leere Hand: der Griff geht ins Nichts. Sichtbar, aber ohne Abzug — die
    // Strafe ist, dass die Zeit für den Teller verloren ist, der sie gebraucht
    // hätte.
    if (arcadePlayer.hand < PLATE_SPIN_GAIN) {
      arcadePlayer.wasted += 1;
      arcadePlayer.lastSpinAt = now;
      arcadePlayer.flash = "bad";
      return { ok: true };
    }

    // Der Griff kostet IMMER voll, auch wenn der Teller schon fast rund läuft.
    // Genau daran hängt das Spiel: nur zu bezahlen, was ankommt, würde blindes
    // Dauertippen zur besten Strategie machen.
    arcadePlayer.hand -= PLATE_SPIN_GAIN;
    const before = plate.spin;
    plate.spin = Math.min(1, plate.spin + PLATE_SPIN_GAIN);
    if (plate.spin - before < PLATE_SPIN_GAIN * 0.5) arcadePlayer.wasted += 1;
    arcadePlayer.lastSpinAt = now;
    arcadePlayer.lastSpinPlate = index;
    arcadePlayer.flash = "good";
    arcadePlayer.lastHitAt = now;
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

    const x = clamp(Number(input.x), 0, 1);
    const y = clamp(Number(input.y), 0, 1);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Ungültige Position." };
    arcadePlayer.hasMoved = true;
    arcadePlayer.brushX = x;
    arcadePlayer.brushY = y;

    const offset = traceOffset(arcade.seed, arcadePlayer.lap, x, y);
    const onPath = offset <= TRACE_TOLERANCE;

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

    if (arcadePlayer.progress >= 0.995 && arcadePlayer.lap < TRACE_MAX_LAPS) {
      // Runde geschafft: neue Kurve, Finger muss unten neu ansetzen.
      arcadePlayer.lapsDone += 1;
      if (arcadePlayer.lapSlips === 0) arcadePlayer.cleanLaps += 1;
      arcadePlayer.lapSlips = 0;
      arcadePlayer.lap += 1;
      arcadePlayer.progress = 0;
      arcadePlayer.brushDown = false;
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
    if (now < arcadePlayer.slipUntil) return { ok: true };   // liegt noch am Boden

    if (input.action === "charge") {
      // Ein laufender Ladevorgang wird nicht zurückgesetzt, damit ein doppeltes
      // Drücken den Balken nicht zurückwirft. Ein VERALTETER Ladevorgang schon:
      // bei einem kurzen Antippen können `shove` und `charge` in vertauschter
      // Reihenfolge eintreffen, wodurch ein Zeitstempel hängen blieb und der
      // nächste Halt mit Sekunden Vorlauf sofort als Überladen galt.
      const stale = arcadePlayer.chargeStart !== null
        && now - arcadePlayer.chargeStart > SUMO_OVERCHARGE_MS;
      if (arcadePlayer.chargeStart === null || stale) arcadePlayer.chargeStart = now;
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }
    if (input.action !== "shove") return { ok: false, error: "Halten zum Aufladen, loslassen zum Stossen." };
    if (arcadePlayer.chargeStart === null) return { ok: true };

    const held = now - arcadePlayer.chargeStart;
    arcadePlayer.chargeStart = null;
    if (held < SUMO_MIN_CHARGE_MS) return { ok: true };       // nur angetippt

    if (held > SUMO_OVERCHARGE_MS) {
      // Überladen: der Kin rutscht aus, kein Stoss, kurze Auszeit.
      arcadePlayer.slips += 1;
      arcadePlayer.slipUntil = now + SUMO_SLIP_MS;
      arcadePlayer.lastShove = { power: 0, at: now, slipped: true };
      arcadePlayer.flash = "bad";
      arcadePlayer.lastHitAt = now;
      return { ok: true };
    }

    const power = Math.min(1, held / SUMO_CHARGE_MS);
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
    // Gewertet wird die geleistete Schubarbeit, nicht die Zahl der Knopfdrücke.
    arcadePlayer.pushWork = (arcadePlayer.pushWork || 0) + power * meet;
    arcadePlayer.lastShove = { power, meet, at: now, slipped: false };
    arcadePlayer.flash = power * meet > 1.1 ? "good" : null;
    arcadePlayer.lastHitAt = now;
    arcadePlayer.hasMoved = true;
    return { ok: true };
  }

  if (arcade.family === "sling") {
    if (input.action !== "shoot") return { ok: false, error: "Ziehen und loslassen, um zu schiessen." };
    if (arcadePlayer.shotsUsed >= arcade.shots) return { ok: true };

    // Der Client schickt Zugkraft (0..1) und Winkel in Grad. Beides wird hier
    // geklemmt — der Server rechnet die Flugbahn, nicht der Client.
    const power = clamp(Number(input.power) || 0, 0, 1);
    const angleDeg = clamp(Number(input.angle) || 0, 5, 85);
    const speed = power * SLING_MAX_SPEED;
    const angle = (angleDeg * Math.PI) / 180;

    // Schiefer Wurf auf gleicher Höhe: Reichweite = v² · sin(2θ) / g.
    const range = (speed * speed * Math.sin(2 * angle)) / SLING_GRAVITY;
    const offset = range - arcadePlayer.distance;      // + = zu weit, - = zu kurz
    const miss = Math.abs(offset);

    let ring = null;
    for (let index = 0; index < SLING_RING_RADII.length; index += 1) {
      if (miss <= SLING_RING_RADII[index]) { ring = index; break; }
    }

    arcadePlayer.shotsUsed += 1;
    arcadePlayer.rings.push(ring);
    if (ring === 0) arcadePlayer.bullseyes += 1;
    arcadePlayer.lastShot = { power, angleDeg, range, offset, ring, at: now };
    arcadePlayer.flash = ring === 0 ? "good" : (ring === null ? "bad" : null);
    arcadePlayer.lastHitAt = now;

    // Das Ziel weicht nach jedem Schuss zurück: gleiche Kraft trifft nicht
    // zweimal, jeder Treffer muss neu dosiert werden.
    arcadePlayer.distance += SLING_DISTANCE_STEP;

    arcadePlayer.score = arcadePlayer.rings.reduce(
      (sum, hit) => sum + (hit === null ? 0 : SLING_RING_SCORES[hit]),
      0
    );
    arcadePlayer.hasMoved = true;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
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
    if (input.action !== "drop") return { ok: false, error: "Tippe, um eine Kugel fallen zu lassen." };
    const inFlight = arcade.balls.some((ball) => ball.playerId === player.id);
    if (inFlight) return { ok: true };
    const x = clamp(Number(input.x) || 0.5, 0.06, 0.94);
    arcadePlayer.aimX = x;
    arcadePlayer.hasMoved = true;
    arcade.balls.push({
      id: arcade.nextBallId++,
      playerId: player.id,
      x,
      y: 0.05,
      vx: (arcadeNoise(arcade.seed + arcade.nextBallId * 13) - 0.5) * 0.06,
      vy: 0.05,
      plinks: 0
    });
    return { ok: true };
  }

  if (arcade.family === "curling") {
    if (input.action !== "flick") return { ok: false, error: "Wische, um einen Stein zu schieben." };
    if ((arcadePlayer.stonesLeft || 0) <= 0) return { ok: false, error: "Keine Steine mehr." };
    const dx = clamp(Number(input.dx) || 0, -1, 1);
    const dy = clamp(Number(input.dy) || 0, -1, 0.1);
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
    const x = clamp(Number(input.x) || 0, 0.06, 0.94);
    arcadePlayer.hasMoved = true;
    arcadePlayer.desiredX = x;
    if (arcade.mode === "catch") arcadePlayer.x = x;
    return { ok: true };
  }

  if (arcade.family === "target") {
    if (input.action !== "target") return { ok: false, error: "Tippe ein Ziel an." };
    const x = clamp(Number(input.x) || 0, 0, 1);
    const y = clamp(Number(input.y) || 0, 0, 1);
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

      if (entry.holding) {
        entry.distance = Math.max(0, entry.distance - FISH_REEL_SPEED * dt);
        entry.tension += (entry.surging ? FISH_TENSION_SURGE : FISH_TENSION_CALM) * dt;
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
        entry.tension = 0;
        entry.distance = 1;
        entry.bestDistance = 1;
        entry.pauseUntil = now + FISH_SNAP_PAUSE_MS;
        entry.catchIndex += 1;
        entry.hookedAt = now + FISH_SNAP_PAUSE_MS;
        entry.phases = buildFishPhases(arcade.seed, entry.catchIndex, minigame.duration);
        entry.flash = "bad";
        entry.lastHitAt = now;
      } else if (entry.distance <= 0 && entry.landed < FISH_MAX_CATCH) {
        // Gelandet: der nächste Fisch hängt sofort, mit eigenem Kampfplan.
        entry.landed += 1;
        entry.lastLandedAt = now;
        entry.tension = 0;
        entry.distance = 1;
        entry.bestDistance = 1;
        entry.catchIndex += 1;
        entry.hookedAt = now;
        entry.phases = buildFishPhases(arcade.seed, entry.catchIndex, minigame.duration);
        entry.flash = "good";
        entry.lastHitAt = now;
      }

      entry.score = fishScore(entry);
      syncArcadeScore(minigame, player, entry);
    });
    return;
  }

  if (arcade.family === "plates") {
    const dt = Math.min(0.2, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const decay = plateDecayAt(elapsed, minigame.duration);
    const wanted = plateCountAt(elapsed);
    arcade.decay = decay;
    arcade.plateCount = wanted;
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      entry.plateCount = wanted;
      // Die Hand füllt sich nach, aber man kann sie nicht horten.
      entry.hand = Math.min(PLATE_HAND_MAX, entry.hand + PLATE_HAND_RATE * dt);

      let spinning = 0;
      entry.plates.forEach((plate) => {
        if (!plate.active) {
          // Neuer Teller: kommt mit halbem Schwung dazu, sobald er ansteht.
          if (plate.index < wanted && (plate.fallenAt === 0 || now - plate.fallenAt >= PLATE_RESPAWN_MS)) {
            plate.active = true;
            plate.spin = plate.fallenAt === 0 ? 1 : PLATE_RESPAWN_SPIN;
            plate.fallenAt = 0;
          }
          return;
        }
        plate.spin = Math.max(0, plate.spin - decay * dt);
        if (plate.spin <= 0) {
          plate.active = false;
          plate.fallenAt = now;
          entry.drops += 1;
          entry.lastDropAt = now;
          entry.flash = "bad";
          entry.lastHitAt = now;
          return;
        }
        spinning += 1;
      });

      // Die Wertung sind Tellersekunden: fünf Teller oben sind fünfmal so viel
      // wert wie einer. Damit lohnt es, alle zu halten, statt einen zu pflegen.
      entry.upTime += spinning * dt;
      entry.spinning = spinning;
      entry.score = plateScore(entry);
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
        if (signal.kind !== "go") return;
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
      for (let step = 0; step < arcade.order.length; step += 1) {
        const candidate = arcade.order[step];
        if (alive(candidate)) { next = candidate; arcade.turnIndex = step; break; }
      }
    }
  }
  if (next) {
    arcade.activeId = next;
    arcade.turnEndsAt = now + arcade.turnMs;
    arcade.spinSpeed = Math.min(2.4, arcade.spinSpeed + 0.18);
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
    // Counter-running always beats the barrel by a fixed margin, so slow
    // phases stay just as controllable as fast ones (no overshoot slingshot).
    const runVel = holding ? entry.runDir * (Math.abs(phase.vel) + 0.55) : 0;
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
    entry.score = Math.round(elapsed);
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
    const speed = RUNNER_BASE_SPEED * (stumbling ? 0.35 : 1) * (boosted ? 1.55 : 1);
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
    shot.headProgress = shot.fromProgress + travelled;
    const thrower = arcade.players[shot.fromId];
    let hit = null;
    room.players.forEach((candidate) => {
      const entry = arcade.players[candidate.id];
      if (!entry || candidate.id === shot.fromId || entry.finishedAt) return;
      if (entry.lane !== shot.lane) return;
      if (entry.progress > shot.fromProgress && entry.progress <= shot.headProgress) {
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
  } else if (arcade.family === "sling") {
    done = room.players.every((player) => (arcade.players[player.id]?.shotsUsed || 0) >= arcade.shots);
  } else if (arcade.family === "sumo") {
    const alive = room.players.filter((player) => !arcade.players[player.id]?.eliminated);
    done = room.players.length > 1 && alive.length <= 1;
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
        ball.vx += (arcadeNoise(arcade.seed + ball.id * 7 + ball.plinks * 3) - 0.5) * 0.09;
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
    arcade.stones.forEach((stone) => {
      if (stone.playerId !== player.id) return;
      const distance = Math.hypot(stone.x - arcade.house.x, stone.y - arcade.house.y);
      const ring = arcade.rings.find((candidate) => distance <= candidate.radius);
      if (ring) points += ring.points;
    });
    entry.score = points;
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

// Signalplan für Falschsignal. Aus dem Seed erzeugt, damit alle Clients
// dieselbe Folge sehen und der Server sie autoritativ auswerten kann.
function buildFeintSignals(seed, durationMs) {
  const signals = [];
  let at = FEINT_LEAD_IN_MS;
  let index = 0;
  while (at < durationMs - FEINT_GO_WINDOW_MS) {
    const roll = arcadeNoise(seed + index * 13);
    // Blockweise geplant: in jedem Dreierblock ist GENAU ein Signal echt. Ein
    // freier Würfel pro Signal traf beides — mit einem Seed war die Hälfte echt
    // (blindes Tippen zahlte sich aus), mit dem nächsten kamen fünf Fälschungen
    // in Folge und die Runde fühlte sich kaputt an. Die Position im Block bleibt
    // zufällig, die Mischung nicht.
    const block = Math.floor(index / FEINT_BLOCK);
    const goSlot = Math.min(FEINT_BLOCK - 1, Math.floor(arcadeNoise(seed + block * 29) * FEINT_BLOCK));
    const slot = index % FEINT_BLOCK;
    const isGo = slot === goSlot;
    // Die Fälschungen rotieren, statt frei gewürfelt zu werden. Gewürfelt kam
    // dreimal dieselbe Fälschung in Folge — das lehrt "diese Farbe ist immer
    // falsch" — und der Antäuscher tauchte kaum auf. So sind die beiden
    // Fälschungen eines Blocks immer verschieden und alle drei Arten kommen dran.
    const fakeSlot = slot > goSlot ? slot - 1 : slot;
    const rotation = Math.floor(arcadeNoise(seed + block * 41) * FEINT_FAKE_KINDS.length);
    const kind = isGo
      ? "go"
      : FEINT_FAKE_KINDS[(block + fakeSlot + rotation) % FEINT_FAKE_KINDS.length];
    const windowMs = kind === "go"
      ? FEINT_GO_WINDOW_MS
      : (kind === "flicker" ? FEINT_FLICKER_MS : FEINT_FAKE_WINDOW_MS);
    signals.push({ index, at, kind, windowMs });
    at += windowMs + FEINT_GAP_MIN_MS + roll * (FEINT_GAP_MAX_MS - FEINT_GAP_MIN_MS);
    index += 1;
  }
  return signals;
}

// Das Signal, das zum Zeitpunkt `elapsed` gerade leuchtet — oder null.
function activeFeintSignal(signals, elapsed) {
  for (const signal of signals) {
    if (elapsed >= signal.at && elapsed <= signal.at + signal.windowMs) return signal;
    if (signal.at > elapsed) break;      // Plan ist zeitlich sortiert
  }
  return null;
}

// Punkte für eine Reaktion. Sofort = volle Punktzahl, am Ende des Fensters
// bleibt ein Rest, damit auch ein spätes Erkennen besser ist als Nichtstun.
function feintPoints(reactionMs, windowMs = FEINT_GO_WINDOW_MS) {
  const share = clamp(1 - Math.max(0, reactionMs) / windowMs, 0, 1);
  return Math.round(FEINT_MIN_POINTS + (FEINT_MAX_POINTS - FEINT_MIN_POINTS) * share);
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
    arcade.charge[at] -= step;
    if (arcade.charge[at] > 0) return "eroding";
    arcade.grid[at] = null;
    arcade.charge[at] = 0;
    return "neutralised";
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
function buildFishPhases(seed, catchIndex, durationMs) {
  const phases = [];
  let at = FISH_LEAD_IN_MS;
  let index = 0;
  const base = seed + catchIndex * 131;
  while (at < durationMs) {
    const calm = FISH_CALM_MIN_MS + arcadeNoise(base + index * 17) * (FISH_CALM_MAX_MS - FISH_CALM_MIN_MS);
    const surge = FISH_SURGE_MIN_MS + arcadeNoise(base + index * 29) * (FISH_SURGE_MAX_MS - FISH_SURGE_MIN_MS);
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

// Wertung: gelandete Fische, der angefangene Weg und ein Abzug je Riss.
function fishScore(entry) {
  const landed = (entry.landed || 0) * FISH_LANDED_POINTS;
  const progress = Math.round((1 - clamp(entry.distance ?? 1, 0, 1)) * FISH_LANDED_POINTS);
  return landed + progress - (entry.snaps || 0) * FISH_SNAP_COST;
}

// Wie viele Teller zu diesem Zeitpunkt in der Runde stehen. Sie kommen einzeln
// dazu, damit sich die Aufmerksamkeit immer weiter aufteilen muss.
function plateCountAt(elapsed) {
  return Math.min(PLATE_MAX, PLATE_START + Math.floor(Math.max(0, elapsed) / PLATE_ADD_MS));
}

// Schwungverlust pro Sekunde. Steigt über die Runde, damit es zum Schluss auch
// mit sauberer Verteilung eng wird.
function plateDecayAt(elapsed, durationMs = PLATE_DURATION_MS) {
  const share = clamp(elapsed / Math.max(1, durationMs), 0, 1);
  return PLATE_DECAY_START + (PLATE_DECAY_END - PLATE_DECAY_START) * share;
}

// Wertung: Punkte je drehender Teller und Sekunde, minus die gefallenen.
function plateScore(entry) {
  return Math.round((entry.upTime || 0) * PLATE_POINTS_PER_SECOND - (entry.drops || 0) * PLATE_DROP_COST);
}

// Wertung: geschaffte Runden plus der angefangene Rest, ein Bonus für ganz
// saubere Runden und ein Abzug je Abrutscher. Der Bonus ist der Grund, warum
// sich Genauigkeit lohnt und nicht nur Tempo.
function traceScore(entry) {
  const laps = (entry.lapsDone || 0) * TRACE_LAP_POINTS;
  const partial = Math.round((entry.progress || 0) * TRACE_LAP_POINTS);
  const clean = (entry.cleanLaps || 0) * TRACE_CLEAN_BONUS;
  return laps + partial + clean - (entry.slips || 0) * TRACE_SLIP_COST;
}

// Zeitpunkt des n-ten Taktschlags, relativ zum Spielstart. Die Schläge werden
// geometrisch schneller, bis BOUNCE_BEAT_MIN_MS erreicht ist. Client und Server
// leiten die Taktzeiten aus derselben Funktion ab.
function bounceBeatTime(index) {
  let time = 0;
  let interval = BOUNCE_BEAT_START_MS;
  for (let i = 0; i < index; i += 1) {
    time += interval;
    interval = Math.max(BOUNCE_BEAT_MIN_MS, interval * BOUNCE_BEAT_RAMP);
  }
  return time;
}

// Der Schlag, der `elapsed` am nächsten liegt, samt Abweichung in ms.
function bounceNearestBeat(elapsed) {
  // Vorwärts zählen ist bei höchstens ~60 Schlägen pro Runde billig und exakt.
  let index = 0;
  let time = 0;
  let interval = BOUNCE_BEAT_START_MS;
  let bestIndex = 0;
  let bestDelta = Math.abs(elapsed);
  while (time <= elapsed + BOUNCE_BEAT_START_MS) {
    const delta = Math.abs(elapsed - time);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
    time += interval;
    interval = Math.max(BOUNCE_BEAT_MIN_MS, interval * BOUNCE_BEAT_RAMP);
    index += 1;
  }
  return { index: bestIndex, offsetMs: elapsed - bounceBeatTime(bestIndex) };
}

// Steinphysik für Sumo-Schubs: Reibung, Rand-Check, Treffer und Ausscheiden.
// Bewusst schlicht gehalten (ein Körper, keine Kollisionen), damit die Wertung
// serverautoritativ bleibt, ohne den 90-ms-Tick zu belasten.
function updateSumoStone(room, minigame, arcade, dt, now) {
  const stone = arcade.stone;
  if (!stone) return;

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
      }
    }

    // Stein zurück in die Mitte, kurze Ruhe für den nächsten Schlagabtausch.
    stone.x = 0;
    stone.y = 0;
    stone.vx = 0;
    stone.vy = 0;
    arcade.resetAt = now;
  }

  // Punkte: Standfestigkeit zählt, Stösse sind das Mittel dazu.
  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return;
    const survived = entry.eliminated ? 0 : 1000;
    entry.score = survived + Math.max(0, (arcade.hitsOut - entry.hits)) * 100
      + Math.round((entry.pushWork || 0) * 40);
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
    const inFlight = arcade.balls.some((ball) => ball.playerId === bot.id);
    if (!inFlight && Math.random() > 0.35) {
      handleArcadeInput(room, bot, { action: "drop", x: 0.32 + Math.random() * 0.36 });
    }
    return;
  }
  if (arcade.family === "curling") {
    if ((player.stonesLeft || 0) <= 0 || Math.random() < 0.82) return;
    const startX = player.startX || 0.5;
    const dx = clamp((arcade.house.x - startX) * 0.75 + (Math.random() - 0.5) * 0.1, -1, 1);
    const dy = clamp(-0.5 + (Math.random() - 0.5) * 0.12, -1, -0.3);
    handleArcadeInput(room, bot, { action: "flick", dx, dy });
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
      player.botJumpAt = Math.random() < profile.mistake
        ? next.hitAt + arcade.jumpMs * 0.8
        : next.hitAt - arcade.jumpMs * 0.45 + (Math.random() - 0.5) * profile.spreadMs * 0.5;
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
    // Counter-run against the drift once it becomes noticeable.
    const drift = player.offset + arcade.barrelVel * 0.25;
    if (Math.abs(drift) > 0.12 && Math.random() > profile.mistake * 0.4) {
      handleArcadeInput(room, bot, { action: "run", dir: drift > 0 ? -1 : 1 });
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
    const angleDeg = (((arcade.logAngle * 180) / Math.PI) % 360 + 360) % 360;
    // Abstand zum nächstliegenden Messer. Ohne Messer ist die Scheibe frei.
    let gap = 180;
    arcade.knives.forEach((knife) => {
      const diff = Math.abs(((knife.angleDeg - angleDeg + 540) % 360) - 180);
      if (diff < gap) gap = diff;
    });
    // Der Bot MISST die Lücke nicht, er SCHÄTZT sie — und der Fehler geht in
    // beide Richtungen. Vorher wurde nur mit einem festen Aufschlag geprüft; da
    // der Wurf denselben Winkel benutzt, den der Bot gerade gelesen hat, konnte
    // dabei nie ein Zusammenstoss entstehen. Gemessen ging es 40 von 40 Partien
    // unentschieden aus.
    const err = profile.level === "hard" ? 4 : profile.level === "normal" ? 10 : 24;
    const perceived = gap + (Math.random() * 2 - 1) * err;
    // Wer zu lange zögert, verliert das Fenster und scheidet aus. Kurz vor
    // Schluss wird also geworfen, ob die Lücke passt oder nicht.
    const nerve = profile.level === "hard" ? 280 : profile.level === "normal" ? 400 : 560;
    const panic = arcade.turnEndsAt - now <= nerve;
    if (perceived >= KNIFE_MIN_GAP_DEG || panic) {
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
      // Gewertet werden Feld-SEKUNDEN. Ein fremdes Feld muss erst weggewischt und
      // dann beansprucht werden, kostet also doppelt so lange wie ein freies —
      // für den eigenen Punktestand ist es damit die schlechtere Wahl, solange
      // es noch freie Felder gibt. Vorher belohnte die Bewertung genau umgekehrt
      // den Angriff, und gemessen gewann deshalb der SCHWACHE Bot die Hälfte
      // aller Runden: er malte brav leere Flächen voll.
      const STEAL_WORTH = 0.55;
      // Das Können steckt jetzt darin, wie sauber der Bot bewertet: wie stark er
      // sich verschätzt, wie oft er neu schaut und ob ihm eine Rolle auffällt.
      // Der Fehler muss je Bot GEWÜRFELT werden. arcadeNoise hängt nur an Feld,
      // Startwert und Zeit — alle drei Bots bekamen damit denselben Ausschlag und
      // verschätzten sich synchron, was gar kein Unterschied ist.
      const noise = profile.level === "hard" ? 0.05 : profile.level === "normal" ? 0.25 : 0.6;
      const pickupWorth = profile.level === "hard" ? 7 : profile.level === "normal" ? 5 : 2.5;
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
    const ceiling = profile.level === "hard" ? 0.84 : profile.level === "normal" ? 0.80 : 0.74;
    const resume = ceiling * 0.42;
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
  if (arcade.family === "plates") {
    const now = Date.now();
    const profile = botProfile(player);
    // Kein Vorrat, kein Griff — der Bot wartet, statt ins Leere zu greifen.
    if (player.hand < PLATE_SPIN_GAIN) return;
    const active = player.plates.filter((plate) => plate.active && now - plate.lastTouchAt >= PLATE_TOUCH_MS);
    if (active.length === 0) return;

    // Das Können steckt in der AUSWAHL, nicht im Tempo — genau da liegt auch
    // das Können des Spielers. Ein starker Bot greift zuverlässig zum
    // langsamsten Teller, ein schwacher greift oft daneben und verschwendet
    // seine Hand an einen, der noch rund läuft.
    const wrongPick = profile.level === "hard" ? 0.10 : profile.level === "normal" ? 0.30 : 0.55;
    let target;
    if (Math.random() < wrongPick) {
      // Ein Fehlgriff heisst NICHT "irgendeinen nehmen": bei sechs Tellern wäre
      // jeder sechste Zufallsgriff versehentlich der richtige, und gemessen
      // spielten dadurch alle drei Stufen praktisch gleich (920/930/949).
      // Unaufmerksam heisst: den nehmen, der gerade am besten läuft — also den,
      // der die Hand am meisten verschwendet.
      target = active.reduce((best, plate) => (plate.spin > best.spin ? plate : best), active[0]);
    } else {
      target = active.reduce((worst, plate) => (plate.spin < worst.spin ? plate : worst), active[0]);
    }
    // Nicht bei jedem Tick greifen: sonst wäre die Hand die einzige Grenze und
    // alle Stufen spielten gleich.
    const reach = profile.level === "hard" ? 0.95 : profile.level === "normal" ? 0.8 : 0.6;
    if (Math.random() > reach) return;
    handleArcadeInput(room, bot, { action: "spin", plate: target.index });
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
    const wander = Math.sin(now / player.driftPeriod + player.driftPhase) * drift;
    const slipNow = Math.random() < slipChance ? (TRACE_TOLERANCE + 0.05) * (Math.random() < 0.5 ? -1 : 1) : 0;
    const y = clamp(player.progress + step, 0, 1);
    const x = clamp(tracePathX(arcade.seed, player.lap, y) + wander + slipNow, 0, 1);
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

    if (signal.kind === "go") {
      // Der Bot-Tick läuft nur alle ~300 ms, deshalb ist die Zielzeit die
      // untere Grenze: der Bot tippt beim ersten Tick danach.
      const target = profile.reactionMs * 0.55 + Math.random() * profile.spreadMs * 0.4;
      if (since >= target) handleArcadeInput(room, bot, { action: "react" });
      return;
    }

    // Fälschungen: pro Signal EINMAL entscheiden, ob der Bot hereinfällt —
    // sonst würde die Wahrscheinlichkeit über die Ticks aufaddieren und jeder
    // Bot in jede Falle tappen. Der Antäuscher blitzt so kurz auf, dass ihn
    // selbst ein unaufmerksamer Bot meist verpasst.
    if (!player.botBait) player.botBait = {};
    if (player.botBait[signal.index] === undefined) {
      // Die Fehlerquote der Bot-Profile ist an Spielen geeicht, in denen ein
      // Fehler Bruchteile eines Treffers kostet. Hier kostet ein Fehlgriff mehr
      // als ein Bot-Treffer einbringt — ungedämpft landeten zwei von drei Bots
      // im Minus und damit in der Wertung auf 0. Gemessen: mit 0.4 punkten alle
      // Bots, bleiben aber hinter sauberem Spiel.
      const bait = profile.mistake * (signal.kind === "flicker" ? 0.15 : 0.4);
      player.botBait[signal.index] = Math.random() < bait;
    }
    if (player.botBait[signal.index]) handleArcadeInput(room, bot, { action: "react" });
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
    if (now < player.slipUntil) return;
    const profile = botProfile(player);
    const stone = arcade.stone;
    // Das Aufladen dauert 1,2 Sekunden, in denen die Hand gebunden ist. Erst
    // ABZUWARTEN und dann auf Gefahr zu reagieren kann deshalb gar nicht
    // aufgehen — der Stoss käme über eine Sekunde zu spät. Gemessen verlor ein
    // Bot, der auf den Stein wartete, gegen einen, der einfach durchlud.
    // Das eigentliche Fenster liegt zwischen voller Kraft (1200 ms) und dem
    // Überladen (1650 ms): 450 ms, in denen man den Stein herankommen lassen
    // kann, ohne Kraft zu verlieren. Genau das ist hier das Können.
    if (player.chargeStart === null) {
      // Sofort wieder aufladen — wer die Hand hängen lässt, verliert Stösse.
      const regrip = profile.level === "hard" ? 40 : profile.level === "normal" ? 170 : 400;
      if (now - (player.lastShove?.at || 0) >= regrip) {
        handleArcadeInput(room, bot, { action: "charge" });
      }
      return;
    }
    const held = now - player.chargeStart;
    if (held < SUMO_CHARGE_MS) return;            // noch nicht auf voller Kraft

    // Auf den Konter warten: kommt der Stein entgegen, ist der Stoss am meisten
    // wert. Der starke Bot hält dafür bis kurz vor die Grenze durch, der schwache
    // gibt früher auf — und zielt die Grenze so knapp an, dass er ausrutscht.
    const speed = stone ? Math.hypot(stone.vx, stone.vy) : 0;
    const closing = !stone || speed < 1e-4
      ? 0
      : (stone.vx * player.spotX + stone.vy * player.spotY) / speed;
    // Der starke Bot schöpft das Fenster fast aus (hält bis 1560 ms von 1650) und
    // wartet dabei auf den Konter. Der schwache zielt an der Grenze vorbei und
    // rutscht deshalb aus. Umgekehrt gesetzt — grösster Sicherheitsabstand beim
    // starken Bot — nutzte ausgerechnet er das Fenster am wenigsten.
    const guard = profile.level === "hard" ? 90 : profile.level === "normal" ? 200 : -150;
    const wanted = profile.level === "hard" ? 0.3 : profile.level === "normal" ? 0 : -0.4;
    if (closing >= wanted || held >= SUMO_OVERCHARGE_MS - guard) {
      handleArcadeInput(room, bot, { action: "shove" });
    }
    return;
  }
  if (arcade.family === "sling") {
    if ((player.shotsUsed || 0) >= arcade.shots) return;
    const profile = botProfile(player);
    // Bots pick a plausible angle, then solve for the power that would land the
    // shot dead centre — and miss it by an amount their skill level allows.
    const angleDeg = 35 + Math.random() * 20;
    const angle = (angleDeg * Math.PI) / 180;
    const perfectSpeed = Math.sqrt((player.distance * SLING_GRAVITY) / Math.sin(2 * angle));
    const spread = profile.level === "hard" ? 0.035 : profile.level === "normal" ? 0.075 : 0.14;
    const power = clamp(
      perfectSpeed / SLING_MAX_SPEED + (Math.random() - 0.5) * 2 * spread,
      0.05,
      1
    );
    handleArcadeInput(room, bot, { action: "shoot", power, angle: angleDeg });
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
    if (player.hasItem && Math.random() < 0.12) {
      handleArcadeInput(room, bot, { action: "throw" });
    }
    const nextRow = arcade.rows[player.nextRow];
    if (!nextRow || nextRow.position - player.progress > 6) return;
    const pickupRow = nextRow.kind === "boost" || nextRow.kind === "item";
    const blocked = pickupRow ? [] : runnerBlockedLanes(nextRow, now);
    const lanes = [0, 1, 2];
    let wanted = player.lane;
    if (pickupRow && Math.random() > profile.mistake) {
      wanted = nextRow.lane;
    } else if (blocked.includes(player.lane) && Math.random() > profile.mistake) {
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
    lastMove: room.lastMove,
    lastMessage: room.lastMessage,
    winnerIds: room.winnerIds,
    starIndex: room.starIndex ?? null,
    starPrice: STAR_PRICE,
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
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
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
    STACK_BLOCKS,
    CLIMB_HEIGHT,
    resolveGateRewards,
    resolveStarPurchase,
    roomCreateBlockedReason,
    MAX_ROOMS_PER_ADDRESS,
    SLING_SHOTS,
    SLING_RING_SCORES,
    SLING_RING_RADII,
    SLING_BASE_DISTANCE,
    SLING_DISTANCE_STEP,
    SLING_MAX_SPEED,
    SLING_GRAVITY,
    SUMO_RING_RADIUS,
    SUMO_CHARGE_MS,
    SUMO_OVERCHARGE_MS,
    SUMO_MIN_CHARGE_MS,
    SUMO_MAX_IMPULSE,
    SUMO_HITS_OUT,
    SUMO_SLIP_MS,
    updateSumoStone,
    BOUNCE_BEAT_START_MS,
    BOUNCE_BEAT_MIN_MS,
    BOUNCE_PERFECT_MS,
    BOUNCE_GOOD_MS,
    BOUNCE_MISS_PENALTY,
    BOUNCE_MAX_HEIGHT,
    bounceBeatTime,
    bounceNearestBeat,
    FEINT_DURATION_MS,
    FEINT_GO_WINDOW_MS,
    FEINT_FLICKER_MS,
    FEINT_MAX_POINTS,
    FEINT_MIN_POINTS,
    FEINT_FALSE_START,
    FEINT_LOCK_MS,
    FEINT_DOUBLE_TAP_MS,
    buildFeintSignals,
    activeFeintSignal,
    feintPoints,
    TRACE_TOLERANCE,
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
    PLATE_START,
    PLATE_MAX,
    PLATE_ADD_MS,
    PLATE_SPIN_GAIN,
    PLATE_HAND_RATE,
    PLATE_HAND_MAX,
    PLATE_DECAY_START,
    PLATE_DECAY_END,
    PLATE_TOUCH_MS,
    PLATE_RESPAWN_MS,
    PLATE_DROP_COST,
    PLATE_POINTS_PER_SECOND,
    PLATE_DURATION_MS,
    plateCountAt,
    plateDecayAt,
    plateScore,
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
