const express = require("express");
const http = require("http");
const os = require("os");
const path = require("path");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const modes = require("./modes");

const PORT = Number(process.env.PORT || 3000);
// Developer tooling (four local players, launching any challenge on demand) is
// off unless explicitly enabled. A URL parameter alone must not unlock it, so
// production builds cannot be talked into dev mode by a crafted client.
const DEV_TOOLS_ENABLED = process.env.TUMBLEKIN_DEV_TOOLS === "1";
const APP_VERSION = require("../package.json").version;
const MAX_PLAYERS = 4;
// Die Ergebnistafel zeigt erst die Runde, dann den Gesamtstand. Wer tippt,
// meldet sich bereit; sind alle bereit, geht es sofort weiter.
const RESULT_HOLD_MS = 9000;
// When a round is decided early (last one standing, everyone finished), the
// scene keeps playing for this long — winners celebrate on camera — before
// the scoreboard appears. No more abrupt cuts.
const MINIGAME_FINALE_MS = 2600;

const COLORS = ["#ff5d73", "#28c7d9", "#ffd15c", "#71d97b"];
const BOT_NAMES = ["Nova", "Pix", "Sol", "Mo", "Kiki", "Rumo", "Flint", "Bea"];

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
// 2200 statt 1500: anderthalb Sekunden reichen für einen Eindruck nur, wenn
// die Menge klein ist. Bei den grossen Durchgängen war der Schwarm weg, bevor
// das Auge ihn erfasst hatte — dann rät man, und Raten macht keinen Spass.
const ESTIMATE_SHOW_MS = 2200;         // so lange ist der Schwarm zu sehen
const ESTIMATE_GUESS_MS = 4800;        // so lange darf geschätzt werden
const ESTIMATE_REVEAL_MS = 1900;       // Auflösung, gemeinsam
const ESTIMATE_LEAD_IN_MS = 900;
const ESTIMATE_DURATION_MS = ESTIMATE_LEAD_IN_MS
  + ESTIMATE_ROUNDS * (ESTIMATE_SHOW_MS + ESTIMATE_GUESS_MS + ESTIMATE_REVEAL_MS) + 500;
const GLIDE_DURATION_MS = 34000;
const SIMON_DURATION_MS = 36000;
const DIVE_DURATION_MS = 36000;
const FISH_DURATION_MS = 34000;
const PAINT_DURATION_MS = 32000;
// Fassmut — über jedem hängt ein Fass am Seil. Es wird losgelassen und fällt;
// EIN Tipp spannt das Seil und fängt es ab. Wer es am dichtesten über dem
// eigenen Kopf zum Stehen bringt, gewinnt — wer zu spät zieht, bekommt es ab.
// Ein einziger Versuch: vorher waren es drei Durchgänge, und der dritte war
// nur noch eine Wiederholung des ersten. Wann losgelassen wird, ist jede
// Runde anders (aber für alle gleich), damit man nicht vom Countdown aus
// mitzählen kann.
const DARE_ROUNDS = 1;
const DARE_LEAD_IN_MS = 1400;          // mindestens so lange hängt das Fass still
const DARE_LEAD_SPREAD_MS = 1300;      // plus bis zu so viel, zufällig
const DARE_ROLL_MS = 4200;             // so lange fällt eines höchstens
const DARE_SHOW_MS = 2600;             // Auflösung: Abstand wird eingeblendet
const DARE_DURATION_MS = DARE_LEAD_IN_MS + DARE_LEAD_SPREAD_MS + DARE_ROUNDS * (DARE_ROLL_MS + DARE_SHOW_MS) + 600;

// Only the fully 3D challenges remain; the flat 2D minigames were retired.
const MINIGAMES = [
  { type: "bounceArena", title: "Bumper Pool", duration: 45000 },
  { type: "finishRush", title: "Zielgerade", duration: 42000, arcadeFamily: "runner" },
  { type: "colorEscape", title: "Farbflucht", duration: 31000, arcadeFamily: "colorgrid" },
  { type: "nervenprobe", title: "Nervenprobe", duration: 14000, arcadeFamily: "stopclock" },
  { type: "lichtwaechter", title: "Lichtwächter", duration: 32000, arcadeFamily: "redlight" },
  { type: "ballonPump", title: "Pump-Panik", duration: 12000, arcadeFamily: "pump" },
  { type: "fassrolle", title: "Fassrolle", duration: 32000, arcadeFamily: "barrel" },
  { type: "fassmut", title: "Fassmut", duration: DARE_DURATION_MS, arcadeFamily: "daredevil" },
  { type: "zuendstoff", title: "Zündstoff", duration: 45000, arcadeFamily: "bomb" },
  { type: "muenzregen", title: "Münzregen", duration: 30500, arcadeFamily: "catchfall" },
  { type: "blobklopfe", title: "Blob-Klopfe", duration: 25000, arcadeFamily: "whack" },
  { type: "seilspringen", title: "Seilspringen", duration: 35000, arcadeFamily: "wave" },
  { type: "kanonenflug", title: "Kanonenflug", duration: 16000, arcadeFamily: "cannon" },
  { type: "messerwurf", title: "Messerwurf", duration: 40000, arcadeFamily: "knife" },
  { type: "turmbau", title: "Turmbau", duration: 30000, arcadeFamily: "stack" },
  { type: "bergsteiger", title: "Bergsteiger", duration: 26000, arcadeFamily: "climb" },
  { type: "ballonfahrt", title: "Ballonfahrt", duration: GLIDE_DURATION_MS, arcadeFamily: "glide" },
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
  fassmut: { family: "daredevil", seed: 617 },
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
// Ballonfahrt — Zielabwurf. Man steuert nur die Höhe (halten = Brenner,
// loslassen = sinken) und wirft Sandsäcke auf Zielscheiben am Boden. Der Sack
// fliegt mit dem Ballon weiter, während er fällt: je höher man ist, desto
// früher muss man ihn loslassen. Unterwegs hängen Sterne in der Luft, die man
// in der richtigen Höhe mitnimmt.
//
// Vorher war es ein Hindernisparcours aus Toren: halten, loslassen, durch —
// es passierte nichts, was man hätte feiern können. Jetzt landet jeder Wurf
// mit einem Rums im Ziel, und man sieht sofort, wie gut er war.
const GLIDE_GRAVITY = 1.15;            // Höhenanteile je s² ohne Brenner
const GLIDE_LIFT = 2.3;                // mit Brenner (netto +1.15)
const GLIDE_VY_MAX = 0.55;             // Höhenanteile je Sekunde
const GLIDE_SPEED = 2.2;               // Fahrt über Grund, Welteinheiten je Sekunde
const GLIDE_HEIGHT = 6;                // Welthöhe bei Höhenanteil 1
const GLIDE_BASKET = 0.4;              // Abwurfhöhe über dem Höhenanteil
const GLIDE_FALL_G = 9;                // Fallbeschleunigung eines Sacks
const GLIDE_TARGET_FIRST_MS = 5200;
const GLIDE_TARGET_EVERY_MS = 3300;
const GLIDE_RINGS = [[0.35, 100], [0.8, 60], [1.4, 30]];   // Weltabstand → Punkte
const GLIDE_BAG_COOLDOWN_MS = 650;
const GLIDE_STAR_POINTS = 15;
const GLIDE_STAR_REACH = 0.08;         // so nah muss man in der Höhe sein
const GLIDE_STALL_MS = 420;            // nach Boden- oder Deckenberührung

// Fallzeit eines Sacks aus dem Korb bei Höhenanteil y, in Millisekunden.
function glideFallMs(y) {
  const h = Math.max(0.05, y * GLIDE_HEIGHT + GLIDE_BASKET);
  return Math.sqrt((2 * h) / GLIDE_FALL_G) * 1000;
}

// Zielscheiben und Sterne — für alle gleich, im Voraus bekannt.
function buildGlideCourse(seed, durationMs = GLIDE_DURATION_MS) {
  const targets = [];
  for (let at = GLIDE_TARGET_FIRST_MS, i = 0; at < durationMs - 1400; at += GLIDE_TARGET_EVERY_MS, i += 1) {
    const jitter = Math.round((arcadeNoise(seed + i * 17) - 0.5) * 500);
    const time = at + jitter;
    targets.push({ index: i, at: time, x: Math.round((GLIDE_SPEED * time) / 10) / 100 });
  }
  const stars = [];
  for (let at = 3200, i = 0; at < durationMs - 800; at += 1650, i += 1) {
    const y = 0.22 + arcadeNoise(seed + 300 + i * 23) * 0.66;
    stars.push({ index: i, at, y: Math.round(y * 1000) / 1000 });
  }
  return { targets, stars };
}

function glideGroundX(ms) {
  return (GLIDE_SPEED * ms) / 1000;
}

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

// Farbenjagd — von Grund auf neu. EINE geteilte Fläche für alle; jeder rollt
// seine Farbe darüber, fremde Farbe wird einfach übermalt. Wer am Ende die
// meiste Fläche hält, gewinnt.
//
// Die alte Fassung malte nicht verlässlich, und das lag an zwei Dingen:
//  * Ein Feld musste erst eine Weile BEANSPRUCHT werden. Wer diagonal oder am
//    Rand durchfuhr, blieb zu kurz darauf — das Feld blieb, wie es war, obwohl
//    man sichtbar darübergerollt war.
//  * Gemalt wurde unter dem BAUCH der Figur, die Walze rollte aber eine halbe
//    Kachel davor. Man sah sie über Felder fahren, die sich nicht färbten.
// Jetzt färbt die Walze sofort, und zwar genau dort, wo sie rollt: vor der
// Figur, in Fahrtrichtung, auf der ganzen Strecke seit dem letzten Tick —
// auch bei hoher Fahrt bleibt keine Lücke.
//
// Damit das Feld nicht nach ein paar Sekunden voll ist und nur noch flackert
// (so war es vor der Anspruchs-Fassung), sind die Kacheln klein und es gibt
// einen zweiten, grösseren Weg an Fläche: EINKREISEN. Schneidet die eigene
// Farbe ein Stück vom Rest des Feldes ab, wird es auf einen Schlag eingefärbt —
// auch fremde Farbe darin. Der Feldrand zählt dabei als Wand, eine Ecke
// abzuschneiden reicht also. Das ist der Moment, auf den man hinspielt, und
// die Antwort darauf ist, dem anderen die Schleife zu zerschneiden.
//
// 12 x 26 hat dasselbe Seitenverhältnis (0.46) wie das Handybild hochkant; das
// Feld bleibt so gross wie vorher, nur fünfmal feiner aufgeteilt.
const PAINT_COLS = 12;
const PAINT_ROWS = 26;
const PAINT_SPEED = 4.8;               // Felder pro Sekunde
const PAINT_ACCEL = 16;                // wie schnell die Richtung greift
const PAINT_TURN_RATE = 11;            // rad/s — die Walze schwenkt, sie springt nicht
const PAINT_ROLLER_AHEAD = 0.9;        // so weit rollt die Walze vor der Figur
const PAINT_BRUSH = 1.05;              // Radius der Walze in Feldern
const PAINT_BRUSH_WIDE = 2.05;         // mit der goldenen Walze: fast doppelt so breit
const PAINT_BOMB_RADIUS = 3.2;         // Farbbombe: Klecks um die Figur
const PAINT_START_RADIUS = 1.6;        // Startfleck in der eigenen Ecke
// Grössere Taschen bleiben, wie sie sind: sonst teilte ein Strich quer übers
// Feld die Welt in zwei Hälften und nähme sich die kleinere.
const PAINT_ENCLOSE_MAX = 72;
const PAINT_BUMP_RADIUS = 1.7;         // ab hier schubsen sich zwei Kins
const PAINT_BUMP_FORCE = 4.5;          // Stoss in Feldern pro Sekunde je Feld Überlappung
const PAINT_KNOCK_DECAY = 5;           // wie schnell ein Stoss ausläuft (1/s)
const PAINT_BUMP_COOLDOWN_MS = 500;    // ein Rempler, nicht einer pro Tick
const PAINT_BOOST_MS = 5000;           // Dauer der breiten Rolle
const PAINT_PICKUP_EVERY_MS = 3800;
const PAINT_PICKUP_MAX = 2;
const PAINT_PICKUP_REACH = 1.2;        // so nah muss man an ein Extra heran
const PAINT_EMPTY = ".";

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
// Die Spannen wachsen von Durchgang zu Durchgang, aber flacher als vorher.
// Mit [8,20] → [16,36] → [28,58] → [45,95] verdoppelte sich die Menge in jedem
// Durchgang: der erste war zum Mitzählen, der letzte purer Zufall. Ein Spiel,
// das nach zwei Durchgängen in blindes Raten kippt, ist kein Schätzspiel mehr.
//
// Jetzt wächst die Obergrenze um rund die Hälfte je Durchgang und endet bei
// 44. Das ist die Gegend, in der ein geübtes Auge in zwei Sekunden noch eine
// begründete Zahl nennt — und ein ungeübtes nicht hoffnungslos danebenliegt.
// Die Spannen sind ausserdem schmaler, der Schieberegler zeigt sie an: man
// wählt aus 15 Zahlen statt aus 51.
const ESTIMATE_BANDS = [[6, 14], [10, 22], [16, 32], [23, 44]];
// Volle Punkte für einen genauen Treffer. Vorher 200 plus 60 Zugabe, macht über
// vier Durchgänge bis zu 1040 — gemessen an einer halben Minute Spielzeit war
// das deutlich zu viel und liess die Runde wichtiger wirken, als sie ist.
const ESTIMATE_POINTS = 60;
const ESTIMATE_BULLSEYE = 20;          // Zugabe, wenn die Zahl exakt stimmt
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
// Zielgerade — ein Lauf über drei Bahnen, 150 Meter.
//
// Die alte Fassung war ein Selbstläufer: alle rannten gleich schnell, und man
// wischte hin und wieder um ein Hindernis herum. Jetzt entscheidet drei Dinge,
// wer vorn ist, und alle drei sieht man kommen:
//
//  * DIE BAHN hat Tempo. Jeder Abschnitt gibt den drei Bahnen einen Belag —
//    Tempo, normal, Sand —, und die Tempobahn wandert. Man liest voraus und
//    plant eine Linie.
//  * HÜRDEN stehen nie im Sand, dafür oft in der schnellen Bahn: überspringen
//    (tippen) oder ausweichen, sonst stolpert man gut eine Sekunde.
//  * DREI WÜRFE nach vorn in die eigene Bahn: wer dicht hinter jemandem läuft,
//    kann ihn zum Stolpern bringen — wer springt, wird verfehlt.
const RUNNER_LENGTH = 150;
const RUNNER_BASE_SPEED = 5.2;
const RUNNER_SEG_LEN = 7.5;            // Länge eines Bahnabschnitts in Metern
// Belagfaktoren. Der Abstand zwischen Sand und Tempo ist bewusst gross: eine
// Bahn muss sich beim Hinschauen lohnen, sonst schaut niemand hin.
const RUNNER_SURFACE = { sand: 0.70, normal: 1.0, tempo: 1.34 };
const RUNNER_SPRINT_FACTOR = 1.45;
const RUNNER_SPRINT_DRAIN = 1 / 2.6;   // Schwung je Sekunde beim Sprint
const RUNNER_SPRINT_REFILL = 1 / 4.4;  // und beim lockeren Laufen zurück
// Ein Stolperer muss das Rennen kosten können. Bei 1150 ms und 0.35-Tempo lag
// der Verlust bei rund 0.75 s auf 26 s Renndauer — knapp drei Prozent, zu wenig,
// als dass sich saubere Bahnwahl auszahlt.
const RUNNER_STUMBLE_MS = 1200;
// Der Angriff ist eine ENTSCHEIDUNG, kein Dauerfeuer. Gemessen: ohne Angriffe
// trennen sich die Spielstaerken um eine halbe Sekunde Zielzeit, mit
// Dauerangriffen (alle drei Sekunden, sieben Stueck je Rennen) kamen vier
// Sekunden Stolper-Rauschen dazu — das Achtfache des Signals, und die Rangfolge
// war weg. Drei Stueck je Rennen, dazwischen fuenf Sekunden Pause: dann kostet
// ein verschenkter Angriff etwas, und der richtige Moment ist etwas wert.
const RUNNER_ATTACK_RANGE = 9;         // nur wer dicht genug auffaehrt, trifft
const RUNNER_ATTACK_COOLDOWN_MS = 5000;
const RUNNER_ATTACK_STUMBLE_MS = 600;
const RUNNER_ATTACKS_PER_RACE = 3;
// Farbflucht — eine Farbe wird angesagt, alle anderen Felder fallen weg.
//
// Die alte Fassung war im Ablauf kaputt: die Zielfarbe stand im Banner erst
// nach gut der Hälfte der Ansage fest (die Felder leuchteten aber schon), nur
// in dieser Ansage durfte man laufen, danach war man zweieinhalb Sekunden
// gesperrt, und beim Übergang aus dem Vorlauf begann das Rätsel noch einmal.
// Real blieben so oft unter 0,6 s zum Laufen. Server und Client rechneten
// dazu je eigene Phasen aus Werten, die sich von Runde zu Runde änderten.
//
// Jetzt gibt es EINEN Zeitplan, den der Server beim Start festlegt und
// mitschickt: je Runde Ansage und Fall. Die Farbe steht vom ersten Moment der
// Ansage fest, laufen darf man während der ganzen Ansage, und direkt nach dem
// Fall kommt die nächste. Die Ansagen werden kürzer, die sicheren Felder
// weniger — am Ende sogar weniger als Mitspieler, damit es eine Entscheidung
// gibt.
// Hochkant wie das Handy: 5 breit, 8 tief. Das quadratische 6 x 6 füllte im
// Hochformat nur die Bildmitte, darüber und darunter lag leere Wiese.
const COLORGRID_COLS = 5;
const COLORGRID_ROWS = 8;
const COLORGRID_ANNOUNCE_MS = [3400, 3000, 2700, 2450, 2200, 2000, 1800, 1650];
const COLORGRID_SAFE = [9, 7, 6, 5, 4, 3, 3, 2];
const COLORGRID_ROUNDS = COLORGRID_ANNOUNCE_MS.length;
const COLORGRID_DROP_MS = 1300;           // Felder weg, wer falsch steht, fällt

// Lichtwächter — red light, green light: hold to run, freeze on red.
// Lichtwächter — "Ochs am Berg". Vorher sprang das Licht ohne Vorwarnung auf
// Rot, und "Halten" hiess "ein Lauf-Ping in den letzten 220 ms". Zusammen mit
// 300 ms Gnade blieben nach dem Umspringen gerade 80 ms zum Loslassen —
// weniger, als ein Mensch zum Sehen braucht. Gemessen standen am Ende drei von
// vier Läufern auf 0 m, und wer vorn lag, hatte Glück gehabt.
//
// Jetzt dreht sich der Wächter SICHTBAR um: eine Drehphase kündigt jedes Rot
// an, man darf in ihr noch laufen und muss bis zu ihrem Ende losgelassen
// haben. Die Drehung wird im Lauf der Runde kürzer, und manchmal täuscht er
// nur an und dreht sich wieder weg — wer dann stehen bleibt, verliert Zeit,
// nicht Boden. Halten ist ein echter Zustand (Drücken/Loslassen), kein Ping.
// Erwischt heisst: ein Stück zurück und kurz benommen, nicht zurück auf Null.
const REDLIGHT_GOAL = 52;             // metres to the guard's gate
const REDLIGHT_SPEED = 3.8;           // run speed while holding
const REDLIGHT_PENALTY = 5;           // metres lost when caught moving on red
const REDLIGHT_STUN_MS = 1200;        // so lange steht man nach dem Erwischen
const REDLIGHT_GRACE_MS = 160;        // Netz und Finger — mehr braucht es nach der Drehphase nicht
const REDLIGHT_HOLD_FRESH_MS = 450;   // ohne Loslass-Meldung gilt man so lange noch als haltend
const REDLIGHT_TURN_FIRST_MS = 700;   // die erste Drehung ist langsam
const REDLIGHT_TURN_LAST_MS = 360;    // gegen Ende dreht er sich schnell um

// Seilspringen — spring über das Seil; wer es einmal nicht schafft, ist raus.
//
// Es war zu leicht: 650 ms in der Luft hiess, jeder Sprung irgendwo in einer
// Zweidrittelsekunde vor dem Seil reichte, und schneller als alle 1,15 s kam
// es nie. Jetzt ist man kürzer in der Luft, das Seil zieht bis auf gut eine
// Dreiviertelsekunde an, der Abstand schwankt, und ab dem sechsten Durchgang
// kommen Doppelschläge — zwei Durchgänge kurz hintereinander.
const WAVE_JUMP_MS = 470;             // so lange ist man in der Luft
const WAVE_FIRST_AT = 3200;           // erster Durchgang nach dem Start
const WAVE_START_GAP = 2300;          // Abstand am Anfang
const WAVE_GAP_STEP = 130;            // je Durchgang so viel schneller
const WAVE_MIN_GAP = 760;             // schneller wird es nicht
const WAVE_DOUBLE_GAP = 560;          // Doppelschlag: der zweite kommt so schnell

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
// Fassmut — ein Fass rollt auf einen zu, ein Tap bremst es.
//
// Wer es am dichtesten vor der roten Linie zum Stehen bringt, gewinnt den
// Durchgang. Wer zu spät bremst, wird überrollt und bekommt für den Durchgang
// gar nichts.
//
// Das Können steckt in einer einzigen Grösse: DER BREMSWEG WÄCHST MIT DEM
// QUADRAT DES TEMPOS. Das Fass beschleunigt, während es rollt — früh bremsen
// ist sicher, aber weit weg; spät bremsen bringt einen dicht heran, kostet
// aber überproportional viel Bremsweg. Genau dieser Zusammenhang ist das
// Spiel, und er ist echte Physik: Weg = v² / (2a). Man muss ihn nicht kennen,
// aber man MUSS ihn fühlen lernen, und das geht nach zwei Fässern.
// Die Zahlen sind am Spielgefühl gerechnet, nicht geschätzt. Mit dem ersten
// Satz (Start 26 m, Beschleunigung 3.9, Bremse 5.2) lag das Punktefenster bei
// 250 ms und das "gut"-Fenster bei 50 — davor waren zwei Sekunden Rollen ohne
// jeden Wert. Ein Spiel, in dem die ersten drei Viertel egal sind, ist kein
// Spiel, sondern ein Wartezimmer mit Reaktionstest am Ende.
//
// Jetzt: sanftere Beschleunigung, stärkere Bremse, kürzere Strecke. Das
// Punktefenster ist rund 800 ms breit, die letzten 100 ms davon sind die
// Mutprobe. Frei rollend erreicht das Fass die Linie nach 2.9 Sekunden — wer
// gar nichts tut, wird also sicher überrollt.
// Am Spielgefühl gerechnet, nicht geraten. Entscheidend ist nicht das Fenster,
// sondern die STEILHEIT: um wie viele Meter sich der Ruhepunkt verschiebt, wenn
// man einen Sekundenbruchteil zu spät tippt. Mit den ersten Zahlen waren das
// 13.3 m/s — ein Tap 90 ms zu spät kostete 1.2 m und damit mehr, als zwischen
// „perfekt" und „gut" überhaupt liegt. Das Spiel belohnte damit nicht Timing,
// sondern Glück, und die Bot-Waage zeigte es sauber an: der schlechteste Bot
// gewann, weil er früh und weit weg bremste und nie überrollt wurde.
// Jetzt sind es 6.5 m/s: 90 ms kosten 0.58 m, das ist sichtbar, aber nicht
// tödlich. Das Fenster wächst dabei von 0.76 s auf 1.67 s.
const DARE_START_M = 14.5;             // Abstand des Fasses beim Loslassen
const DARE_SPEED0 = 1.8;               // Anfangstempo in Metern je Sekunde
const DARE_ACCEL = 1.0;                // Beschleunigung, solange es frei rollt
const DARE_BRAKE = 3.33;               // Verzögerung nach dem Tap
const DARE_HIT_M = 0.0;                // ab hier ist man überrollt
// Punkte je Durchgang. Ein Volltreffer auf der Linie gibt DARE_POINTS, und
// der Wert fällt mit dem Abstand — nicht linear, sondern steil: zwischen 10
// und 50 Zentimetern muss ein spürbarer Unterschied liegen, sonst lohnt sich
// das Risiko nicht.
const DARE_POINTS = 300;
const DARE_FALLOFF_M = 9;              // ab hier gibt es nichts mehr

// Wo das Fass zum Zeitpunkt `t` steht, wenn bei `brakeAt` getippt wurde.
// Eine reine Funktion: Server und Client rechnen dasselbe, und der Client
// kann zwischen zwei Ticks sauber weiterzeichnen statt zu ruckeln.
function dareBarrelAt(t, brakeAt = null) {
  const rollTime = brakeAt === null ? t : Math.min(t, brakeAt);
  const speed = DARE_SPEED0 + DARE_ACCEL * rollTime;
  let travelled = DARE_SPEED0 * rollTime + 0.5 * DARE_ACCEL * rollTime * rollTime;
  let v = speed;
  if (brakeAt !== null && t > brakeAt) {
    const braking = Math.min(t - brakeAt, speed / DARE_BRAKE);
    travelled += speed * braking - 0.5 * DARE_BRAKE * braking * braking;
    v = Math.max(0, speed - DARE_BRAKE * braking);
  }
  return { distance: Math.max(DARE_HIT_M, DARE_START_M - travelled), speed: v };
}

// Der Abstand, an dem das Fass endgültig stehenbleibt, wenn bei `brakeAt`
// getippt wird. Das ist die Zahl, die gewertet wird.
function dareRestingDistance(brakeAt) {
  const speed = DARE_SPEED0 + DARE_ACCEL * brakeAt;
  const rolled = DARE_SPEED0 * brakeAt + 0.5 * DARE_ACCEL * brakeAt * brakeAt;
  const brakePath = (speed * speed) / (2 * DARE_BRAKE);
  return DARE_START_M - rolled - brakePath;
}

function darePoints(distance) {
  if (distance <= 0) return 0;
  const anteil = Math.max(0, 1 - distance / DARE_FALLOFF_M);
  return Math.round(DARE_POINTS * anteil * anteil);
}

const BARREL_LIMIT = 1.7;             // slide distance before falling off
const BARREL_RUN_SPEED = 2.4;         // counter-run speed while holding
const BARREL_HOLD_FRESH_MS = 220;     // "holding" = a run ping this recent
const BARREL_TURN_MS = 700;           // so lange braucht das Fass fuer einen Richtungswechsel
// Baumstammrollen: wer läuft, stösst den Stamm mit den Füssen in die
// Gegenrichtung — und damit ALLE, die darauf stehen. Vorher drehte das Fass
// nach einem festen Plan, und die anderen waren nur Kulisse. Jetzt kann man
// die anderen herunterrollen, muss dann aber selbst mithalten: der Stamm
// dreht auch unter einem selbst schneller.
const BARREL_CURRENT_SHARE = 0.6;     // so viel bleibt von der Strömung
const BARREL_PUSH = 1.5;              // Schub je laufender Figur und Sekunde
const BARREL_PUSH_DAMP = 1.6;         // der Stamm beruhigt sich so schnell wieder
// Gemessen war das eine Todesspirale: laufen alle gegen dieselbe Strömung an,
// addiert sich ihr Schub, der Stamm dreht schneller, als irgendwer laufen
// kann — alle vier lagen nach anderthalb Sekunden im Wasser. Jetzt spürt man
// den eigenen Schub nur halb, und was die anderen einem aufzwingen, ist
// gedeckelt: im schnellsten Schub reicht es gerade, den Rutsch zu bremsen.
const BARREL_OWN_SHARE = 0.5;
const BARREL_OTHERS_MAX = 0.8;
// Wer fällt, schwimmt zurück und steht nach dieser Zeit wieder oben — die
// Zeit im Wasser zählt nicht. Vorher war ein Sturz das Aus für die Runde.
const BARREL_RESPAWN_MS = 2600;

// Zündstoff — hot-potato bomb: the fuse time is shown for the first moments,
// then hidden, so a good passer can time the boom.
const BOMB_PASS_LOCK_MS = 380;        // minimum hold time before passing on
const BOMB_MIN_FUSE_MS = 4000;
const BOMB_MAX_FUSE_MS = 8000;
const BOMB_REVEAL_MS = 2000;          // fuse time is visible this long after a pass

// Münzregen — Münzen, Edelsteine und Bomben regnen in drei Spuren.
//
// Es war zu gleichförmig: dieselbe Mischung im selben Takt von vorn bis
// hinten, und am Ende hörte es einfach auf. Jetzt baut es sich auf: der
// Regen wird dichter, eine Serie ohne Bombe hebt den Wert jeder Münze (×2 ab
// fünf, ×3 ab zehn), in den letzten Sekunden kommt der GOLDRAUSCH mit
// Goldmünzen, und zum Schluss fällt eine angekündigte Schatztruhe in eine
// Spur — wer dort steht, bekommt zehn.
const CATCH_FALL_MS = 1150;           // Fallzeit von der Maschine bis zur Spur
const CATCH_GOLD_FROM = 21500;        // ab hier Goldrausch
const CATCH_JACKPOT_AT = 28400;       // die Truhe landet
const CATCH_JACKPOT_WARN_MS = 2600;   // so lange vorher wird ihre Spur angesagt
const CATCH_JACKPOT_VALUE = 10;
const CATCH_STREAK_STEP = 5;          // je fünf Fänge in Folge ein Faktor mehr
const CATCH_STREAK_MAX = 3;

function catchMultiplier(streak) {
  return Math.min(CATCH_STREAK_MAX, 1 + Math.floor((streak || 0) / CATCH_STREAK_STEP));
}

// Messerwurf — wie die bekannten Handyspiele: jeder hat SEINEN Stamm, alle
// werfen gleichzeitig. Ein Stamm ist eine Stufe mit einer festen Zahl Messer;
// sind alle drin, zerbricht er und der nächste kommt. Manche Stämme tragen
// schon Messer, auf manchen sitzt ein Apfel, und jeder dreht sich anders —
// gleichmässig, schneller, stockend, mit Richtungswechseln. Die Stämme sind
// für alle dieselben. Wer ein steckendes Messer trifft, verliert den Rest
// dieses Stamms und macht nach einer kurzen Pause mit dem nächsten weiter.
//
// Vorher warf man reihum auf EINEN gemeinsamen Stamm, je ein Messer, und die
// meiste Zeit sah man anderen beim Werfen zu.
const KNIFE_MIN_GAP_DEG = 13;         // so dicht darf kein Messer an ein anderes
const KNIFE_APPLE_GAP_DEG = 12;       // so nah muss man an einen Apfel
const KNIFE_FLIGHT_MS = 110;          // Flugzeit bis in den Stamm
const KNIFE_COOLDOWN_MS = 160;        // frühestens so schnell das nächste Messer
const KNIFE_CLASH_MS = 1300;          // Pause nach einem Treffer auf ein Messer
const KNIFE_BREAK_MS = 650;           // der volle Stamm zerbricht, dann der nächste
const KNIFE_STAGE_BONUS = 5;          // für einen geschafften Stamm
const KNIFE_APPLE_POINTS = 3;
// Die Stämme: Messer zu werfen, schon steckende Messer, Äpfel, Drehmuster.
// Ab dem letzten wiederholt sich der letzte mit steigendem Tempo.
const KNIFE_STAGES = [
  { knives: 5, preset: 0, apples: 1, spin: { kind: "steady", speed: 1.6 } },
  { knives: 6, preset: 1, apples: 1, spin: { kind: "steady", speed: -2.3 } },
  { knives: 7, preset: 2, apples: 1, spin: { kind: "wobble", speed: 2.2, amp: 1.6, rate: 1.6 } },
  { knives: 7, preset: 2, apples: 2, spin: { kind: "swing", speed: 2.8, rate: 1.15 } },
  { knives: 8, preset: 3, apples: 1, spin: { kind: "wobble", speed: -2.6, amp: 2.4, rate: 2.1 } },
  { knives: 8, preset: 3, apples: 2, spin: { kind: "swing", speed: 3.4, rate: 1.5 } }
];

// Winkel des Stamms (Grad) nach `ms` seit Beginn der Stufe. Geschlossen
// integriert, damit Server, Bots und Client ohne Aufsummieren dasselbe
// ausrechnen.
//   steady  gleichmässig
//   wobble  Grundtempo plus Schwankung — stockt, zieht an, kehrt kurz um
//   swing   pendelt hin und her, wechselt also dauernd die Richtung
function knifeLogAngle(spin, ms) {
  const t = ms / 1000;
  let rad;
  if (spin.kind === "wobble") {
    rad = spin.speed * t - (spin.amp / spin.rate) * (Math.cos(spin.rate * t) - 1) * Math.sign(spin.speed || 1);
  } else if (spin.kind === "swing") {
    rad = (spin.speed / spin.rate) * Math.sin(spin.rate * t);
  } else {
    rad = spin.speed * t;
  }
  const deg = (rad * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function knifeStageConfig(index) {
  const last = KNIFE_STAGES.length - 1;
  const base = KNIFE_STAGES[Math.min(index, last)];
  if (index <= last) return base;
  const extra = index - last;
  return {
    ...base,
    knives: base.knives + Math.min(3, extra),
    spin: { ...base.spin, speed: base.spin.speed * (1 + extra * 0.12) }
  };
}

function knifeAngleGap(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

// Ein Stamm frisch aufsetzen: vorgesteckte Messer und Äpfel liegen je Stufe
// fest (aus dem Seed), also für alle gleich.
function setupKnifeStage(arcade, entry, index, now) {
  const stage = knifeStageConfig(index);
  entry.stage = index;
  entry.stageStartedAt = now;
  entry.knivesLeft = stage.knives;
  entry.knivesTotal = stage.knives;
  entry.spin = stage.spin;
  entry.stuckAngles = [];
  entry.apples = [];
  entry.nextStageAt = null;
  const seed = arcade.seed + index * 97;
  for (let i = 0; i < stage.preset; i += 1) {
    const angle = Math.round((i / Math.max(1, stage.preset)) * 360 + arcadeNoise(seed + i * 13) * 40) % 360;
    entry.stuckAngles.push({ angle, preset: true });
  }
  for (let i = 0; i < stage.apples; i += 1) {
    let angle = Math.round(arcadeNoise(seed + 71 + i * 29) * 360);
    // Äpfel nie auf ein steckendes Messer legen.
    for (let guard = 0; guard < 12 && entry.stuckAngles.some((knife) => knifeAngleGap(knife.angle, angle) < 30); guard += 1) {
      angle = (angle + 37) % 360;
    }
    entry.apples.push({ angle, hit: false });
  }
}

// Wo ein Messer im Stamm landet, das jetzt geworfen wird: es trifft unten
// (270°) auf den Stamm, der sich bis dahin weitergedreht hat.
function knifeImpactAngle(entry, now) {
  const logAngle = knifeLogAngle(entry.spin, now + KNIFE_FLIGHT_MS - entry.stageStartedAt);
  return ((270 - logAngle) % 360 + 360) % 360;
}

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

// Bergsteiger — die Griffe zeigen, welche Hand dran ist; die falsche rutscht ab.
// Der Gipfel liegt bei 70 Sprossen. Wer oben ist, ist fertig, und unter denen,
// die es schaffen, zählt die Zeit: wer schneller oben war, gewinnt. Wer nicht
// ankommt, steht nach Höhe dahinter. Vorher war die Wand praktisch endlos
// (400), gewertet wurde nur die Höhe beim Schlusspfiff — es gab keinen Moment,
// auf den man hinklettert.
const CLIMB_HEIGHT = 70;
// So viele Sprossen hat die Griffolge, bevor sie sich wiederholt. Genau so viele
// Griffe hängen im Client je Bahn an der Wand und wandern beim Steigen oben
// wieder an — die Zahl muss darum auf beiden Seiten dieselbe sein, sonst zeigt
// die Wand eine andere Folge, als der Server verlangt.
const CLIMB_PATTERN_LEN = 40;
// Abstand zwischen zwei Doppelsprossen, in normalen Sprossen.
const CLIMB_REPEAT_MIN = 3;
const CLIMB_REPEAT_SPAN = 3;           // also 3 bis 5

// Stures Hand-über-Hand kann man blind trommeln: nach dem ersten Griff steht
// jeder weitere fest, und das Spiel war nur noch ein Tippgeschwindigkeitstest.
// Alle paar Sprossen liegt der nächste Griff darum auf DERSELBEN Seite. Die
// Folge ist für alle gleich (sie kommt aus dem Seed) und hängt sichtbar an der
// Wand — wer hinschaut, klettert schneller als wer hämmert.
//
// Die Doppelsprossen werden ABGEZÄHLT, nicht gewürfelt. arcadeNoise ist für
// fortlaufende Seeds keine Zufallsfolge, sondern eine gleichmässige Drehung:
// gewürfelt kam erst zwanzigmal sauberes Wechseln und dann ein Klumpen aus
// Doppelsprossen. Ein Zähler verteilt sie gleichmässig und garantiert
// nebenbei, dass nie DREI Griffe auf derselben Seite liegen — das ist auf der
// Wand nicht mehr lesbar.
function buildClimbSides(seed) {
  const sides = [];
  let side = arcadeNoise(seed + 1) > 0.5 ? 1 : -1;
  let until = 1 + Math.floor(arcadeNoise(seed + 3) * CLIMB_REPEAT_SPAN);
  for (let index = 0; index < CLIMB_PATTERN_LEN; index += 1) {
    sides.push(side);
    if (until > 0) {
      side = -side;
      until -= 1;
    } else {
      until = CLIMB_REPEAT_MIN + Math.floor(arcadeNoise(seed + 11 + index * 7) * CLIMB_REPEAT_SPAN);
    }
  }
  return sides;
}

// Welche Hand von dieser Sprosse aus greifen muss.
function climbSideFor(arcade, rung) {
  const sides = arcade.sides;
  if (!Array.isArray(sides) || sides.length === 0) return 1;
  return sides[((rung % sides.length) + sides.length) % sides.length];
}

// Blob-Klopfe — Blobs kommen aus 3 x 4 Löchern. Hochkant wie das Handy: das
// quadratische 3 x 3 füllte nur die Bildmitte, darunter lag leere Wiese.
const WHACK_COLS = 3;
const WHACK_CELLS = 12;
// Wer auf einen Stachelblob haut, ist kurz benommen und kann nicht klopfen.
// Ein Punkt Abzug allein machte Draufhauen auf alles billig: wer blind jedes
// Loch trifft, verliert einen Punkt und hat drei gewonnen.
const WHACK_STUN_MS = 1400;

// Kanonenflug — erster Tipp Kraft, zweiter Winkel, dann fliegt man. Getroffen
// werden soll die ZIELFLAGGE, nicht die grösste Weite.
//
// Vorher war das Optimum immer dasselbe und leicht zu treffen: beide Anzeigen
// liefen als Sinus und verweilten genau oben, wo es am meisten gab, und bei
// 45° ist die Weite so flach, dass 40° bis 50° praktisch gleich weit flogen.
// Jetzt steht die Flagge jede Runde woanders, Wind schiebt oder bremst, beide
// Anzeigen laufen gleichmässig durch, und Punkte gibt es für die Nähe zur
// Flagge. Beim Winkel zeigt eine Landevorschau (ohne Wind), wo man aufkäme —
// den Wind muss man selbst einrechnen.
const CANNON_PERIOD_MS = 1150;        // Kraft: 0 → 1 → 0, gleichmässig
const CANNON_ANGLE_PERIOD_MS = 1300;  // Winkel: 10° → 80° → 10°, gleichmässig
const CANNON_ANGLE_MIN = 10;
const CANNON_ANGLE_MAX = 80;
const CANNON_TARGET_MIN = 42;
const CANNON_TARGET_MAX = 90;
const CANNON_WIND_M = 11;             // so viele Meter bringt voller Wind höchstens

// Dreieck statt Sinus: 0 → 1 → 0 mit gleichem Tempo überall.
function cannonTri(x) {
  const frac = x - Math.floor(x);
  return 1 - Math.abs(frac * 2 - 1);
}

// Weite eines Schusses: Wurfparabel plus Wind, der bei steilen Schüssen
// länger wirkt.
function cannonDistance(power, angleDeg, wind = 0) {
  const rad = (angleDeg * Math.PI) / 180;
  return 6 + power * power * Math.sin(2 * rad) * 94 + wind * CANNON_WIND_M * power * Math.sin(rad);
}

// Punkte nach Abstand zur Flagge; ein Volltreffer (bis 2 m) gibt Zugabe.
function cannonPoints(distance, target) {
  const off = Math.abs(distance - target);
  return Math.round(Math.max(0, 100 - off * 3.5) + (off <= 2 ? 25 : 0));
}

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
const SIMON_SETTLE_MS = 450;          // Nachklang, bevor die naechste Folge laeuft
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
const PLINKO_BALL_R = 0.028;          // Kugelradius im Brettmass (wie am Nagel)
const PLINKO_PEG_R = 0.024;
// Wo die äussersten Nägel stehen. Sie standen bei 0.083 bzw. 0.917 — und
// zwischen Nagel und Wand blieben damit 0.024 Platz für eine Kugel, die 0.028
// braucht. Sie passte also NICHT hindurch: wer aussen ansetzte, dessen Kugel
// verkeilte sich zwischen Wandbegrenzung und Nagel, wurde von beiden
// abwechselnd zurückgeschoben und hing dort. Gemessen 243 Nagelstösse und neun
// Sekunden ohne einen Millimeter Fortschritt — die Kugel kam nie unten an und
// brachte null Punkte, bei 28 Sekunden Rundenzeit.
//
// Jetzt bleibt aussen wie innen eine ganze Kugelbreite Luft.
const PLINKO_PEG_LEFT = 0.11;
const PLINKO_PEG_RIGHT = 0.89;
// Hängt eine Kugel trotzdem fest, bekommt sie nach dieser Zeit einen Schubs
// nach unten. Physik gegen Physik lässt sich nie ganz ausschliessen, und eine
// Kugel, die nicht ankommt, ist eine verlorene Runde.
const PLINKO_STALL_MS = 700;          // Zeitfenster, in dem Fortschritt zählt
// So weit muss die Kugel in diesem Fenster fallen. Eine normale Kugel schafft
// 0.17 — der Wert liegt deutlich darunter und deutlich über dem Kriechen einer
// verkeilten.
const PLINKO_STALL_MIN = 0.09;
const PLINKO_STALL_KICK = 0.7;
// Harte Notbremse. Eine Kugel, die sechzig Nägel angeschlagen hat, hüpft nicht
// mehr — sie klemmt. Auf dem Handy hört man dabei jeden Anschlag als Klicken.
const PLINKO_MAX_PLINKS = 60;
const PLINKO_BALL_REST = 0.86;        // wie sehr zwei Kugeln voneinander abprallen
const PLINKO_FLOOR_Y = 1.3;
const CURLING_SHEET_Y = 1.3;
// Gerechnet, nicht geschaetzt: in einen Ring vom Radius r passen rund
// (r/Steinradius)^2 * 0.8 Steine. Mit 0.075 und Steinen von 0.045 waren das
// ZWEI — bei zwoelf geworfenen Steinen. Wer am Knopf lag, entschied damit nicht
// der Wurf, sondern das Geschiebe: alle zielen auf denselben Punkt, und die
// Ueberlappungsaufloesung schob die Ueberzaehligen gleichmaessig nach aussen.
// Genau daran verschwand das Koennen (gemessen 2.90 / 2.47 / 2.17).
// Jetzt passen sechs in den Innenring — die vier besten Wuerfe eines Tisches
// duerfen also alle dort liegen, und dann entscheidet wieder die Genauigkeit.
const CURLING_RINGS = [
  { radius: 0.09, points: 15 },
  { radius: 0.16, points: 8 },
  { radius: 0.25, points: 4 }
];
const CURLING_STONES_PER_PLAYER = 3;
const CURLING_STONE_RADIUS = 0.032;   // stone radius in the logical sheet
const CURLING_FRICTION = 1.15;        // ice glide damping -> stones coast, then settle
const CURLING_WALL_REST = 0.55;       // side-cushion bounce ("Rempler erlaubt")
const CURLING_RESTITUTION = 0;      // Steine schieben sich, sie prallen nicht ab
const CURLING_BUTTON_FACTOR = 1.6;    // Wert am Knopf, gemessen am inneren Ring
const CURLING_SUBSTEPS = 5;           // sub-stepped so fast stones never tunnel through

// Bumper Pool — Schwimmringe rempeln sich auf einer Badeinsel.
// Physics live in a unit disk (radius 1). One analog gesture: steer with the
// stick, ramming is pure momentum. The rim ALWAYS bounces you back — unless a
// bumper hit was hard enough to "launch" you (a short window), so you can never
// drive yourself off but a solid ram sends a rival flying over the edge.
//
// Drei Leben. Wer ins Becken fliegt, verliert eines und springt nach kurzer
// Pause zurück auf die Insel; erst mit dem letzten ist man raus. Vorher war
// schon der erste Sturz das Aus: die Runde war nach rund neun Sekunden vorbei,
// und wer im ersten Gedränge stand, hatte das Spiel nie gespielt. Der Hilfetext
// versprach dabei längst das Zurückpaddeln.
//
// Damit es trotzdem ein Ende findet, schrumpft die Insel in den letzten
// fünfzehn Sekunden — der Platz wird eng, und jeder Stoss sitzt.
const ARENA_LIVES = 3;
const ARENA_SHRINK_MS = 15000;        // so lange vor Schluss beginnt die Insel zu schrumpfen
const ARENA_SHRINK_TO = 0.62;         // auf diesen Anteil ihres Radius
const ARENA_RADIUS = 1.0;             // plate disk radius (logical units)
const ARENA_BALL_RADIUS = 0.11;       // kin collision radius
const ARENA_ACCEL = 3.8;              // stick thrust acceleration (snappy, responsive)
const ARENA_DRAG = 1.75;              // velocity damping (quick stops, still carries momentum)
const ARENA_RESTITUTION = 2.4;        // >1: bouncy bumpers, so rams carry punch
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

// Mitschrift für die Fehlersuche: TUMBLEKIN_VERBOSE=1 protokolliert jede
// Anfrage und jede Socket-Verbindung. Standardmässig aus, weil im Betrieb
// niemand ein volles Zugriffsprotokoll auf der Konsole braucht — beim Suchen
// ist es aber der Unterschied zwischen "kommt das Gerät überhaupt an?" und
// Raten.
const VERBOSE = process.env.TUMBLEKIN_VERBOSE === "1";
if (VERBOSE) {
  app.use((req, _res, next) => {
    console.log(`[http] ${req.method} ${req.url}  ua=${(req.headers["user-agent"] || "?").slice(0, 40)}`);
    next();
  });
}

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
  if (VERBOSE) {
    console.log(`[socket] verbunden ${socket.id} über ${socket.conn.transport.name}`);
    socket.conn.on("upgrade", (t) => console.log(`[socket] ${socket.id} aufgewertet auf ${t.name}`));
    socket.on("disconnect", (reason) => console.log(`[socket] getrennt ${socket.id}: ${reason}`));
    socket.onAny((event, payload) => {
      console.log(`[socket] ${socket.id} → ${event} ${JSON.stringify(payload)?.slice(0, 120)}`);
    });
  }

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
      mode: "marathon",
      settings: modes.defaultSettings(),
      match: null,
      status: "lobby",
      phase: "lobby",
      players: [player],
      minigameCounter: 0,
      devMode: false,
      currentMinigame: null,
      lastMinigameResult: null,
      resultEndsAt: null,
      readyForNext: [],
      lastMessage: "Raum erstellt.",
      winnerIds: [],
      timers: new Set(),
      minigameTick: null,
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
    if (room.status !== "lobby") return replyError(reply, "Die Partie läuft bereits.");
    if (room.players.length >= MAX_PLAYERS) return replyError(reply, "Der Raum ist voll.");

    const player = createPlayer({
      id: socket.id,
      name: payload?.name,
      color: freeColor(room),
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

  // Einen Bot dazu. Die Lobby bekommt so genau die Runde, die man will — vorher
  // gab es nur "auffüllen bis vier", und wer zu zweit gegen EINEN Bot spielen
  // wollte, konnte das nicht.
  on("addBot", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann Bots hinzufügen.");
    if (room.status !== "lobby") return replyError(reply, "Bots gehen nur in der Lobby.");
    if (room.players.length >= MAX_PLAYERS) return replyError(reply, "Der Raum ist voll.");
    addBotTo(room);
    room.lastMessage = "Ein Bot ist dazugekommen.";
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  // Auffüllen bis vier — für die Prüfskripte und für alle, die sofort spielen wollen.
  on("addTestPlayers", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann Bots hinzufügen.");
    if (room.status !== "lobby") return replyError(reply, "Bots können nur in der Lobby hinzugefügt werden.");
    while (room.players.length < MAX_PLAYERS) addBotTo(room);
    room.lastMessage = "Bots sind der Runde beigetreten.";
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("removeBot", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann Bots entfernen.");
    if (room.status !== "lobby") return replyError(reply, "Bots gehen nur in der Lobby.");
    const bot = room.players.find((candidate) => candidate.id === payload?.playerId && candidate.isBot);
    if (!bot) return replyError(reply, "Diesen Bot gibt es nicht.");
    room.players = room.players.filter((candidate) => candidate.id !== bot.id);
    room.lastMessage = `${bot.name} ist gegangen.`;
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

  on("selectMode", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host wählt den Modus.");
    if (room.status !== "lobby") return replyError(reply, "Der Modus kann nur in der Lobby gewechselt werden.");
    if (!modes.MODE_IDS.includes(payload?.mode)) return replyError(reply, "Diesen Modus gibt es nicht.");
    room.mode = payload.mode;
    room.lastMessage = `${modes.MODE_INFO[room.mode].name}: ${modes.MODE_INFO[room.mode].short}`;
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("updateSettings", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host ändert die Einstellungen.");
    if (room.status !== "lobby") return replyError(reply, "Einstellungen gehen nur in der Lobby.");
    room.settings = modes.mergeSettings(room.settings, payload?.settings, MINIGAMES.map((game) => game.type));
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  on("startGame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann starten.");
    if (room.status !== "lobby" && room.status !== "end") return replyError(reply, "Die Partie läuft schon.");
    if (!room.devMode && room.players.length < 2) {
      return replyError(reply, "Es braucht mindestens zwei Spieler. Lade jemanden ein oder hol dir einen Bot dazu.");
    }

    startGame(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
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

  // Nur für die Prüfskripte: das laufende Minispiel sofort werten. Eine ganze
  // Partie im Browser dauert sonst Minuten, und geprüft werden soll der Ablauf
  // (Zwischenstand, nächstes Spiel, Ende), nicht jedes Spiel in voller Länge.
  on("devSkipMinigame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!DEV_TOOLS_ENABLED) return replyError(reply, "Dev-Werkzeuge sind in dieser Version deaktiviert.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann das.");
    if (room.status !== "minigame") return replyError(reply, "Gerade läuft kein Minispiel.");
    finishMinigame(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  // Nur für die Prüfskripte: auch die Menschen im Raum spielen wie Bots.
  on("devAutopilot", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!DEV_TOOLS_ENABLED) return replyError(reply, "Dev-Werkzeuge sind in dieser Version deaktiviert.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann das.");
    room.autopilot = payload?.on !== false;
    replyOk(reply, room, socket.data.playerId);
  });

  // Zurück in die Lobby: Modus und Auswahl bleiben, der Spielstand nicht.
  on("restartGame", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host kann neu starten.");
    resetToLobby(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  // Revanche: dieselbe Partie noch einmal, ohne den Umweg über die Lobby.
  on("rematch", (payload, reply) => {
    const room = findRoomForSocket(socket, payload?.code);
    if (!room) return replyError(reply, "Kein Raum gefunden.");
    if (!isHost(socket, room)) return replyError(reply, "Nur der Host startet die Revanche.");
    if (room.status !== "end") return replyError(reply, "Revanche gibt es erst nach dem Ende.");
    if (!room.devMode && room.players.length < 2) return replyError(reply, "Es braucht mindestens zwei Spieler.");
    startGame(room);
    replyOk(reply, room, socket.data.playerId);
    emitRoom(room);
  });

  // Weiter, wenn alle es eilig haben. Wer tippt, meldet sich bereit; sind alle
  // bereit, geht es sofort weiter. Ein einzelner Ungeduldiger kann damit
  // niemanden überfahren.
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
    // Partie
    points: 0,
    wins: 0,
    lives: 0,
    out: false,
    lastPlace: null,
    lastPoints: 0,
    // Über Partien hinweg: gewonnene Partien in dieser Sitzung.
    sessionWins: 0,
    minigameScore: 0
  };
}

// Die erste Farbe, die noch niemand trägt. Nach dem Index vergeben bekamen
// zwei Leute dieselbe, sobald jemand aus der Mitte gegangen war.
function freeColor(room) {
  const used = new Set(room.players.map((player) => player.color));
  return COLORS.find((color) => !used.has(color)) || COLORS[room.players.length % COLORS.length];
}

function addBotTo(room) {
  const used = new Set(room.players.map((player) => player.name));
  const name = BOT_NAMES.find((candidate) => !used.has(candidate)) || `Bot ${room.players.length + 1}`;
  const bot = createPlayer({
    id: `bot_${room.code}_${room.players.length}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name,
    color: freeColor(room),
    isHost: false,
    isBot: true,
    controllerId: null
  });
  room.players.push(bot);
  return bot;
}

function startGame(room) {
  clearRoomTimers(room);
  room.lastMinigameResult = null;
  room.winnerIds = [];
  room.resultEndsAt = null;
  room.readyForNext = [];
  room.players.forEach((player) => {
    player.isHost = player.id === room.hostId;
    player.minigameScore = 0;
  });
  room.match = modes.createMatch(room.mode, room.settings, room.players, MINIGAMES.map((game) => game.type));
  startNextRound(room);
}

function startNextRound(room) {
  const type = modes.nextGame(room.match);
  if (!type) {
    finishGame(room, modes.matchOutcome(room.match, room.players).winnerIds);
    return;
  }
  startMinigame(room, modes.roundLabel(room.match), type);
}

function resetToLobby(room) {
  clearRoomTimers(room);
  room.status = "lobby";
  room.phase = "lobby";
  room.currentMinigame = null;
  room.lastMinigameResult = null;
  room.winnerIds = [];
  room.resultEndsAt = null;
  room.readyForNext = [];
  room.match = null;
  room.lastMessage = "Zurück in der Lobby.";
  room.players.forEach((player) => {
    player.points = 0;
    player.wins = 0;
    player.lives = 0;
    player.out = false;
    player.lastPlace = null;
    player.lastPoints = 0;
    player.minigameScore = 0;
  });
}

function startMinigame(room, reason, forcedType = null) {
  clearRoomTimers(room);

  const template = MINIGAMES.find((minigame) => minigame.type === forcedType)
    || MINIGAMES[room.minigameCounter % MINIGAMES.length];
  room.minigameCounter += 1;
  room.status = "minigame";
  room.phase = "playingMinigame";
  room.lastMinigameResult = null;
  room.readyForNext = [];

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
    arena: {},
    arcade: null,
    lastInputAt: {}
  };

  room.players.forEach((player) => {
    minigame.scores[player.id] = 0;
    player.minigameScore = 0;
  });

  if (template.type === "bounceArena") {
    minigame.arena = createArenaState(room.players, minigame.startedAt, template.duration);
  }
  if (template.arcadeFamily) {
    minigame.arcade = createArcadeState(template.type, room.players, minigame.startedAt);
  }

  room.currentMinigame = minigame;
  room.lastMessage = `${template.title} startet.`;

  scheduleBotMinigameInputs(room);
  room.minigameTick = setInterval(() => {
    updateBounceArena(room);
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

  if (minigame.type === "bounceArena") {
    const result = handleArenaInput(room, player, input);
    if (!result.ok) return result;
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

  // Mit dem Dev-Autopiloten spielen auch die Menschen im Raum wie Bots —
  // für Bildreihen und Durchläufe, in denen die eigene Figur etwas tun soll.
  room.players.filter((player) => player.isBot || (DEV_TOOLS_ENABLED && room.autopilot)).forEach((bot) => {
    if (minigame.type === "bounceArena") {
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt || minigameFrozen(minigame, Date.now())) return;
        arenaBotStep(minigame.arena, bot.id);
      }, 180 + Math.floor(Math.random() * 110));
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
      // pump ebenso: ein Mensch schafft im Wechsel sechs bis zehn Stösse pro
      // Sekunde, ein Bot im langsamen Takt kam nie über drei.
      const fastHand = ["trace", "belt", "glide", "fish", "paint", "stack", "bounce", "knife", "colorgrid", "bomb", "stopclock", "cannon", "wave", "barrel", "pump"].includes(minigame.arcade.family);
      const every = fastHand
        ? 120 + Math.floor(Math.random() * 60)
        : 260 + Math.floor(Math.random() * 150);
      const timer = setTrackedInterval(room, () => {
        if (room.currentMinigame?.id !== minigame.id || Date.now() < minigame.startedAt || minigameFrozen(minigame, Date.now())) return;
        arcadeBotStep(room, bot);
      }, every);
      return timer;
    }

    return null;
  });
}

function updateBounceArena(room) {
  const minigame = room.currentMinigame;
  if (!minigame || minigame.type !== "bounceArena") return;
  const arena = minigame.arena;
  const now = Date.now();
  if (now < minigame.startedAt || minigameFrozen(minigame, now)) {
    arena.lastUpdateAt = now;
    return;
  }

  const frameDt = Math.min(0.12, Math.max(0.016, (now - (arena.lastUpdateAt || now)) / 1000));
  arena.lastUpdateAt = now;
  arena.tick = (arena.tick || 0) + 1;

  const players = Object.values(arena.players);

  // Die Insel schrumpft zum Schluss — gleichmässig, damit man es kommen sieht.
  const shrink = clamp((now - arena.shrinkFrom) / Math.max(1, arena.shrinkUntil - arena.shrinkFrom), 0, 1);
  arena.radius = ARENA_RADIUS * (1 - (1 - arena.shrinkTo) * shrink);
  arena.shrinking = shrink > 0;

  // Zurück auf die Insel, wer noch Leben hat und lange genug im Wasser war.
  players.forEach((ap) => {
    if (ap.inPlay || ap.lives <= 0 || now < ap.outUntil) return;
    const spot = arenaSpawnPoint(arena, ap);
    ap.x = spot.x;
    ap.y = spot.y;
    ap.vx = 0;
    ap.vy = 0;
    ap.inPlay = true;
    ap.ejecting = false;
    ap.launchedUntil = 0;
    ap.invulnUntil = now + ARENA_INVULN_MS;
    ap.spawnedAt = now;
  });

  const sub = ARENA_SUBSTEPS;
  const dt = frameDt / sub;
  const limit = arena.radius - ARENA_BALL_RADIUS;

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
      if (ap.ejecting && dist > arena.radius + ARENA_BALL_RADIUS) {
        knockArenaPlayerOff(arena, ap, now);
      }
    });
  }

  let aliveCount = 0;
  room.players.forEach((player) => {
    const ap = arena.players[player.id];
    if (!ap) return;
    // Im Spiel ist, wer auf der Insel steht ODER noch zurückspringen darf.
    if (ap.inPlay || ap.lives > 0) aliveCount += 1;
    minigame.scores[player.id] = Math.max(0, Math.round(ap.score));
    player.minigameScore = minigame.scores[player.id];
  });

  // Ist nur noch einer (oder keiner) übrig, der Leben hat: kurzes Finale, dann
  // die Tafel.
  const elapsed = now - minigame.startedAt;
  if (aliveCount <= 1 && elapsed > 2000 && room.players.length > 1) {
    beginMinigameFinale(room, minigame);
  }
}

// Ins Becken: ein Leben weniger. Mit Leben übrig geht es nach
// ARENA_RESPAWN_MS zurück auf die Insel, ohne ist man raus.
function knockArenaPlayerOff(arena, ap, now) {
  if (!ap.inPlay) return;
  ap.inPlay = false;
  ap.ejecting = false;
  ap.knockedAt = now;
  ap.falls += 1;
  ap.lives = Math.max(0, (ap.lives ?? 1) - 1);
  if (ap.lives > 0) ap.outUntil = now + ARENA_RESPAWN_MS;
  else ap.outAt = now;
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

  updateArcade(room);
  clearRoomTimers(room);
  const finishedAt = Date.now();

  room.players.forEach((player) => {
    if (minigame.type === "bounceArena") {
      minigame.scores[player.id] = bounceResultScore(minigame.arena.players[player.id]);
    }
    if (minigame.arcade) {
      minigame.scores[player.id] = arcadeRankingScore(minigame.arcade, minigame.arcade.players[player.id]);
    }
    player.minigameScore = minigame.scores[player.id] || 0;
  });

  // Eine Partie gibt es immer — ein Minispiel ohne Partie ist nur im Test
  // denkbar, und auch dort soll die Wertung laufen statt zu werfen.
  if (!room.match) {
    room.match = { mode: "single", round: 1, playlist: [minigame.type], pool: [], target: null, history: [] };
  }
  const outcome = modes.scoreRound(room.match, room.players, room.players.map((player) => ({
    playerId: player.id,
    score: minigame.scores[player.id] || 0
  })));

  const ranking = room.players
    .map((player) => {
      const result = outcome.get(player.id);
      return {
        playerId: player.id,
        name: player.name,
        color: player.color,
        score: minigame.scores[player.id] || 0,
        detail: minigameResultDetail(minigame, player.id, finishedAt),
        place: result.place,
        points: result.points,
        total: result.total,
        roundWin: result.roundWin,
        lifeLost: result.lifeLost,
        lives: result.lives,
        out: result.out
      };
    })
    .sort((a, b) => (a.place - b.place) || (b.score - a.score));

  const verdict = modes.matchOutcome(room.match, room.players);
  if (!verdict.over) modes.ensureUpcoming(room.match);
  room.status = "result";
  room.phase = "minigameResult";
  room.lastMinigameResult = {
    id: minigame.id,
    type: minigame.type,
    title: minigame.title,
    reason: minigame.reason,
    ranking,
    matchOver: verdict.over,
    next: verdict.over ? null : modes.upcomingGame(room.match)
  };
  room.resultEndsAt = Date.now() + RESULT_HOLD_MS;
  room.readyForNext = [];
  room.currentMinigame = null;
  const winners = ranking.filter((entry) => entry.place === 1).map((entry) => entry.name);
  room.lastMessage = `${minigame.title}: ${winners.join(" & ") || "Niemand"} gewinnt.`;
  emitRoom(room);

  setTrackedTimeout(room, () => continueAfterResult(room), RESULT_HOLD_MS);
}

function bounceResultScore(arenaPlayer) {
  if (!arenaPlayer) return 0;
  // Übrige Leben zuerst, dann die Rauswürfe, dann die Zeit auf der Insel —
  // genau das steht auch auf der Ergebniskarte ("2 Leben · 1 Rauswurf").
  //
  // Vorher war die Schlagzeile `score`, in dem Ueberlebenszeit und Rauswuerfe
  // vermischt waren, waehrend das Ergebnisbild NUR die Rauswuerfe zeigte. Ein
  // Ueberlebender mit null Rauswuerfen stand damit vor einem Rausgeworfenen mit
  // zwei — und auf der Karte stand "0" ueber "2".
  const lives = arenaPlayer.lives ?? (arenaPlayer.inPlay ? 1 : 0);
  return lives * 1000000000
    + (arenaPlayer.knockouts || 0) * 1000000
    + Math.min(999999, Math.round(arenaPlayer.playMs || 0));
}

// Wo man nach einem Sturz wieder auf die Insel kommt: innen, und dort, wo
// gerade niemand steht — sonst landete man direkt vor dem, der einen eben
// hinausgestossen hat.
function arenaSpawnPoint(arena, self) {
  let best = { x: 0, y: 0 };
  let bestGap = -1;
  const r = 0.38 * (arena.radius || ARENA_RADIUS);
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const gap = Object.values(arena.players)
      .filter((other) => other !== self && other.inPlay)
      .reduce((near, other) => Math.min(near, Math.hypot(other.x - x, other.y - y)), 9);
    if (gap > bestGap) {
      bestGap = gap;
      best = { x, y };
    }
  }
  return best;
}

function arcadeRankingScore(arcade, arcadePlayer) {
  if (!arcadePlayer) return 0;
  const score = Math.max(0, Math.round(arcadePlayer.score || 0));
  const successes = arcadePlayer.successes || 0;
  const mistakes = arcadePlayer.mistakes || 0;
  if (arcade.family === "plinko") {
    return Math.max(0, score * 1000 + successes);
  }
  if (arcade.family === "curling") {
    // Der Punktestand ist seit curlingStonePoints stufenlos und steckt die Nähe
    // schon vollständig. Der Feinwert darunter ordnet nur noch, was auf denselben
    // gerundeten Punkt fällt.
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
  if (arcade.family === "daredevil") {
    // Punkte entscheiden; bei Gleichstand der dichteste einzelne Treffer.
    const nah = arcadePlayer.best === null || arcadePlayer.best === undefined
      ? 0
      : Math.max(0, Math.round((DARE_FALLOFF_M - arcadePlayer.best) * 100));
    return Math.round((arcadePlayer.points || 0) * 1000) + nah;
  }
  if (arcade.family === "pump") {
    return arcadePlayer.pumps || 0;
  }
  if (arcade.family === "dive") {
    return Math.max(0, arcadePlayer.banked || 0);
  }
  if (arcade.family === "barrel") {
    // Oben geblieben zaehlt zuerst — darunter entscheidet, wer wie lange MITTIG
    // oben war. Vorher rangierten die Ueberlebenden nach `score`, und da steckte
    // die verstrichene Zeit mit drin: die ist fuer alle Ueberlebenden gleich, also
    // entschied sie nichts und die Balancearbeit verschwand dahinter.
    const mitte = Math.round((arcadePlayer.balanceWork || 0) * 1000);
    return arcadePlayer.fallenAt ? mitte : 10000000 + mitte;
  }
  if (arcade.family === "bomb") {
    // Survivors on top; among the blown-up, a later boom ranks higher.
    return arcadePlayer.outAt
      ? Math.max(1, Math.round(arcadePlayer.outAt))
      : 100000000000000 + (arcadePlayer.passes || 0);
  }
  if (arcade.family === "catchfall") {
    // Der Bombenabzug steckt seit updateCatchfall schon in `catches` — genau der
    // Zahl, die auch angezeigt wird. Ihn hier noch einmal abzuziehen hiesse, ihn
    // doppelt zu zaehlen.
    return Math.max(0, 50000 + (arcadePlayer.catches || 0) * 1000);
  }
  if (arcade.family === "whack") {
    // Der Abzug steckt seit dem Eingabe-Handler schon in `hits`.
    return Math.max(0, 50000 + (arcadePlayer.hits || 0) * 1000);
  }
  if (arcade.family === "cannon") {
    if (!arcadePlayer.launchedAt) return 0;
    const off = Math.abs((arcadePlayer.distance || 0) - (arcade.target || 0));
    return (arcadePlayer.points || 0) * 10000 + Math.max(1, Math.round(5000 - off * 50));
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
    // Punkte zuerst; bei Gleichstand weniger Fehlwürfe.
    return Math.max(0, (arcadePlayer.points || 0) * 100 - (arcadePlayer.clashes || 0));
  }
  if (arcade.family === "bounce") {
    // Gewertet wird die Hoehe — genau die Zahl, die auch angezeigt wird, und in
    // derselben Rundung. Vorher stand im Rang zusaetzlich die beste Serie, und
    // die steckt ueber die Resonanz laengst in der Hoehe: sie wurde also doppelt
    // gezaehlt und konnte einen sichtbaren Hoehenunterschied kippen. Gemessen
    // rangierte 2.0 vor 2.1, und auf dem Ergebnisbild stand genau das Gegenteil.
    // Die Serie ordnet jetzt nur noch, was auf dieselbe angezeigte Hoehe faellt.
    return Math.round((arcadePlayer.best || 0) * 10) * 1000 + (arcadePlayer.bestStreak || 0);
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

function minigameResultDetail(minigame, playerId, _finishedAt) {
  if (minigame.type === "bounceArena") {
    const arenaPlayer = minigame.arena.players[playerId];
    // Zuerst die Leben, dann die Rauswürfe — genau so wird auch gewertet.
    const lives = arenaPlayer?.lives ?? (arenaPlayer?.inPlay ? 1 : 0);
    return lives > 0
      ? { kind: "lives", value: lives, knockouts: arenaPlayer?.knockouts || 0, label: "Leben" }
      : { kind: "out", survived: false, value: arenaPlayer?.knockouts || 0, label: "Rauswürfe" };
  }
  if (minigame.arcade) return arcadeResultDetail(minigame.arcade, minigame.arcade.players[playerId]);
  return null;
}

function arcadeResultDetail(arcade, arcadePlayer) {
  if (!arcadePlayer) return null;
  if (arcade.family === "plinko") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
  }
  if (arcade.family === "curling") {
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.score || 0)), label: "Punkte" };
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
  if (arcade.family === "daredevil") {
    return { kind: "points", value: Math.round(arcadePlayer.points || 0), label: "Punkte" };
  }
  if (arcade.family === "pump") {
    return { kind: "points", value: arcadePlayer.pumps || 0, label: "Pumps" };
  }
  if (arcade.family === "barrel") {
    // Die Zahl, nach der auch sortiert wird: wie lange man MITTIG oben stand.
    // Die reine Standzeit sagte darueber nichts — wer sich an den Rand stellte,
    // stand am laengsten und hatte am wenigsten getan.
    // Als Zeit IN einer Zone, nicht als "standing": dort las die Tafel den
    // Wert als Sturzzeit und schrieb "Raus nach 1,66 s", obwohl 1,66 s die
    // Zeit in der Mitte war.
    return {
      kind: "zoneTime",
      value: Math.round((arcadePlayer.balanceWork || 0) * 1000),
      label: "in der Mitte"
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
    return { kind: "points", value: arcadePlayer.points || 0, label: "Punkte" };
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
    return { kind: "points", value: arcadePlayer.points || 0, label: "Punkte" };
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
    // Gewertet wird die Fläche am Ende — genau die Zahl im Balken oben.
    return { kind: "points", value: Math.max(0, Math.round(arcadePlayer.owned || 0)), label: "Felder" };
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
      : { kind: "points", value: arcadePlayer.rung || 0, label: "Griffe" };
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
  const verdict = modes.matchOutcome(room.match, room.players);

  if (verdict.over && room.match?.mode === "single") {
    // Einzelspiel: kein Endbildschirm — die Ergebnistafel hat den Sieger
    // schon gezeigt. Zurück in die Lobby, der Sitzungszähler läuft weiter.
    creditSessionWins(room, verdict.winnerIds);
    room.status = "lobby";
    room.phase = "lobby";
    room.currentMinigame = null;
    room.match = null;
    room.lastMessage = "Zurück in der Lobby — sucht euch das nächste Minispiel aus.";
    emitRoom(room);
    return;
  }

  if (verdict.over) {
    finishGame(room, verdict.winnerIds);
    emitRoom(room);
    return;
  }

  startNextRound(room);
  emitRoom(room);
}

function creditSessionWins(room, winnerIds) {
  room.players
    .filter((player) => winnerIds.includes(player.id))
    .forEach((player) => { player.sessionWins = (player.sessionWins || 0) + 1; });
}

function finishGame(room, winnerIds) {
  clearRoomTimers(room);
  room.status = "end";
  room.phase = "finished";
  room.currentMinigame = null;
  room.winnerIds = winnerIds || [];
  creditSessionWins(room, room.winnerIds);
  const names = room.players.filter((player) => room.winnerIds.includes(player.id)).map((player) => player.name);
  room.lastMessage = names.length ? `${names.join(" & ")} ${names.length > 1 ? "gewinnen" : "gewinnt"} die Partie!` : "Partie beendet.";
}

function createArenaState(players, startedAt, duration = 45000) {
  const arena = {
    radius: ARENA_RADIUS,
    ballRadius: ARENA_BALL_RADIUS,
    lives: ARENA_LIVES,
    shrinkFrom: startedAt + Math.max(0, duration - ARENA_SHRINK_MS),
    shrinkUntil: startedAt + duration,
    shrinkTo: ARENA_SHRINK_TO,
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
      lives: ARENA_LIVES,    // bei null ist man raus
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
  const distanceFromCenter = Math.hypot(bot.x, bot.y) / (arena.radius || ARENA_RADIUS);
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

  if (distanceFromCenter < profile.edge) {
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

// Der Startwert jeder Runde ist neu gewürfelt. Vorher stand er je Spieltyp
// fest: Farbflucht sagte in jeder Partie dieselben Farben in derselben
// Reihenfolge an, der Lichtwächter drehte sich immer im selben Takt, und der
// Rennkurs war immer derselbe — beim dritten Mal spielte man auswendig. Die
// Tests können ihn über `options.seed` festhalten.
function roundSeed(base) {
  return base * 1000 + Math.floor(Math.random() * 997);
}

function createArcadeState(type, players, startedAt, options = {}) {
  const config = ARCADE_CONFIGS[type];
  const arcade = {
    type,
    family: config.family,
    // Startzeitpunkt am Zustand: einige Ergebnisse rechnen in Sekunden ab
    // Rundenbeginn, und die kennen das Minispiel-Objekt nicht.
    startedAt,
    seed: Number.isFinite(options.seed) ? options.seed : roundSeed(config.seed),
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

  if (config.family === "plinko") {
    // Logical space is 1 wide and PLINKO_FLOOR_Y tall so client pixels can
    // use one uniform scale on both axes (collisions look exact on screen).
    arcade.pegs = [];
    const span = PLINKO_PEG_RIGHT - PLINKO_PEG_LEFT;
    for (let row = 0; row < 5; row += 1) {
      const gerade = row % 2 === 0;
      const count = gerade ? 6 : 5;
      for (let index = 0; index < count; index += 1) {
        // Gerade Reihen sitzen auf den Rasterpunkten, ungerade genau dazwischen.
        const t = gerade ? index / 5 : (index + 0.5) / 5;
        arcade.pegs.push({
          x: PLINKO_PEG_LEFT + t * span,
          y: 0.32 + row * 0.19,
          r: PLINKO_PEG_R
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
    // Jedes Mal eine neue Zielzeit zwischen 4 und 8 Sekunden. Bis 12 war zu
    // lang: nach acht Sekunden im Kopf zählen ist es Glück, nicht Gefühl.
    arcade.targetMs = Math.round(4000 + arcadeNoise(arcade.seed + Date.now() % 997) * 4000);
    arcade.hideAfterMs = 2000;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.stoppedMs = null;
      entry.deviationMs = null;
    });
  }
  if (config.family === "runner") {
    arcade.trackLength = RUNNER_LENGTH;
    arcade.segments = createRunnerCourse(arcade.seed);
    arcade.segLen = RUNNER_SEG_LEN;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.lane = 1;
      entry.progress = 0;
      entry.nextHurdle = 0;        // Index des nächsten noch offenen Abschnitts
      entry.stumbleUntil = 0;
      entry.sprinting = false;
      entry.schwung = 1;           // volle Reserve am Start
      entry.attacksLeft = RUNNER_ATTACKS_PER_RACE;
      entry.sprintMs = 0;          // wie lange insgesamt gesprintet wurde
      entry.finishedAt = null;
      entry.finishMs = null;
      entry.stumbles = 0;
    });
  }
  if (config.family === "colorgrid") {
    arcade.gridCols = COLORGRID_COLS;
    arcade.gridRows = COLORGRID_ROWS;
    arcade.schedule = buildColorSchedule();
    arcade.roundCount = COLORGRID_ROUNDS;
    arcade.round = -1;
    arcade.phase = "announce";
    arcade.targetColor = 0;
    arcade.grid = [];
    const starts = [[1, 2], [3, 2], [1, 5], [3, 5]];
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
    arcade.phases = buildRedlightPhases(arcade.seed, 60000);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.progress = 0;
      entry.lastRunAt = 0;
      entry.holding = false;
      entry.running = false;
      entry.stunUntil = 0;
      entry.caughtAt = 0;
      entry.caught = 0;
      entry.penalizedPhase = -1;
      entry.finishedAt = null;
      entry.finishMs = null;
    });
  }
  if (config.family === "wave") {
    arcade.jumpMs = WAVE_JUMP_MS;
    arcade.waves = buildWaveSchedule(arcade.seed, 60000);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.jumpUntil = 0;
      entry.eliminated = false;
      entry.survived = 0;
    });
  }
  if (config.family === "daredevil") {
    arcade.rounds = DARE_ROUNDS;
    arcade.leadIn = DARE_LEAD_IN_MS + Math.round(arcadeNoise(arcade.seed + (Date.now() % 7919)) * DARE_LEAD_SPREAD_MS);
    arcade.rollMs = DARE_ROLL_MS;
    arcade.showMs = DARE_SHOW_MS;
    arcade.startM = DARE_START_M;
    arcade.round = -1;
    arcade.settled = 0;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.roundIndex = -1;     // in welchem Durchgang dieser Zustand gilt
      entry.brakeAt = null;      // Sekunden seit Rollbeginn, null = noch nicht getippt
      entry.distance = null;     // Endabstand des laufenden Fasses
      entry.hit = false;         // überrollt?
      entry.results = [];        // je Durchgang { distance, points, hit }
      entry.points = 0;
      entry.best = null;         // bester Abstand über alle Durchgänge
    });
  }
  if (config.family === "pump") {
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.pumps = 0;
      entry.lastSide = null;
      entry.slips = 0;
    });
  }
  if (config.family === "barrel") {
    arcade.limit = BARREL_LIMIT;
    arcade.phases = buildBarrelPhases(arcade.seed, 60000);
    arcade.barrelAngle = 0;
    arcade.barrelVel = 0;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.offset = 0;
      entry.lastRunAt = 0;
      entry.runDir = 0;
      entry.fallenAt = null;
      entry.backAt = 0;
      entry.falls = 0;
      entry.spinShare = 0;
      entry.survivedMs = 0;
    });
  }
  if (config.family === "catchfall") {
    arcade.fallMs = CATCH_FALL_MS;
    arcade.goldFrom = CATCH_GOLD_FROM;
    arcade.jackpotAt = CATCH_JACKPOT_AT;
    arcade.jackpotWarnMs = CATCH_JACKPOT_WARN_MS;
    arcade.drops = buildCatchDrops(arcade.seed + (Date.now() % 7717), 60000);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.lane = 1;
      entry.catches = 0;
      entry.bombs = 0;
      entry.streak = 0;
      entry.multiplier = 1;
      entry.lastGain = 0;
    });
  }
  if (config.family === "whack") {
    // Salt the fixed per-game seed with time so the blobs pop in a fresh random
    // pattern every round instead of the identical fixed sequence.
    arcade.pops = buildWhackPops(arcade.seed + (Date.now() % 9973), 60000);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.hits = 0;
      entry.badHits = 0;
      entry.hitPopIds = {};
      entry.stunUntil = 0;
    });
  }
  if (config.family === "cannon") {
    arcade.periodMs = CANNON_PERIOD_MS;
    arcade.anglePeriodMs = CANNON_ANGLE_PERIOD_MS;
    arcade.angleMin = CANNON_ANGLE_MIN;
    arcade.angleMax = CANNON_ANGLE_MAX;
    const salt = arcade.seed + (Date.now() % 7907);
    arcade.target = Math.round(CANNON_TARGET_MIN + arcadeNoise(salt) * (CANNON_TARGET_MAX - CANNON_TARGET_MIN));
    // Wind in Zehnteln: positiv schiebt Richtung Flagge, negativ bremst.
    arcade.wind = Math.round((arcadeNoise(salt + 17) * 2 - 1) * 10) / 10;
    arcade.windM = CANNON_WIND_M;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.launchedAt = null;
      entry.power = 0;
      entry.powerAt = null;
      entry.angle = null;
      entry.distance = 0;
      entry.points = 0;
    });
  }
  if (config.family === "simon") {
    arcade.rounds = buildSimonRounds(arcade.seed);
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
    arcade.rounds = buildReactRounds(arcade.seed);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.times = [];
    });
  }
  if (config.family === "bomb") {
    arcade.order = players.map((player) => player.id);
    arcade.holderId = arcade.order[Math.floor(arcadeNoise(arcade.seed) * arcade.order.length)] || null;
    arcade.holderSince = startedAt;
    arcade.canPassAt = startedAt;
    arcade.fuseMs = bombFuseMs(arcade.seed, 0);
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
    arcade.stages = KNIFE_STAGES.length;
    arcade.flightMs = KNIFE_FLIGHT_MS;
    arcade.minGapDeg = KNIFE_MIN_GAP_DEG;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.points = 0;
      entry.stuck = 0;                   // Messer, die gesteckt haben
      entry.applesHit = 0;
      entry.cleared = 0;                 // geschaffte Stämme
      entry.clashes = 0;                 // Treffer auf ein Messer
      entry.throws = 0;
      entry.lastThrowAt = 0;
      entry.lastThrow = null;            // { at, angle, result }
      entry.stunUntil = 0;
      setupKnifeStage(arcade, entry, 0, startedAt);
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
      entry.phase = arcadeNoise(arcade.seed + index * 7);
      entry.toppled = false;
      entry.perfects = 0;
    });
  }
  if (config.family === "feint") {
    arcade.signals = buildFeintSignals(arcade.seed, FEINT_DURATION_MS);
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
      entry.brushX = tracePathX(arcade.seed, 0, 0);
      entry.gems = buildTraceGems(arcade.seed, 0);
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
    arcade.chutePlan = buildBeltChutePlan(arcade.seed, BELT_DURATION_MS);
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
      entry.parcelSeed = arcade.seed + hashBeltSeed(player.id);
      entry.queue = Array.from({ length: BELT_QUEUE }, () =>
        makeBeltParcel(arcade, entry.parcelSeed, entry.nextParcel++));
      entry.lastSortAt = 0;
      entry.lastVerdict = null;
    });
  }
  if (config.family === "estimate") {
    arcade.rounds = buildEstimateRounds(arcade.seed);
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
    arcade.secret = { gems: {} };
    arcade.basePoints = SEEK_BASE_POINTS;
    arcade.probeCost = SEEK_PROBE_COST;
    arcade.minPoints = SEEK_MIN_POINTS;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      // Jede Person sucht auf ihrem EIGENEN Feld. Ein gemeinsames Feld wäre ein
      // Rennen, in dem der erste Fund die Arbeit für alle erledigt — und wer
      // gerade langsamer tippt, bekäme das Ergebnis geschenkt. Gleiche Aufgabe,
      // getrennte Bretter: dann zählt wirklich, wer besser kombiniert.
      entry.seekSeed = arcade.seed + hashSeekSeed(player.id);
      entry.round = 0;
      entry.found = 0;
      entry.probes = [];               // { x, y, steps }
      entry.totalProbes = 0;
      entry.bestProbes = null;         // wenigste Tipps für einen Fund
      entry.lastFind = null;
      // Das Versteck liegt unter arcade.secret und wird NICHT mitgeschickt —
      // sonst stünde die Antwort im Netzpaket und ein Blick in die
      // Entwicklerkonsole ersetzte das ganze Spiel.
      arcade.secret.gems[player.id] = seekGemFor(entry.seekSeed, 0);
    });
  }
  if (config.family === "paint") {
    arcade.cols = PAINT_COLS;
    arcade.rows = PAINT_ROWS;
    // Das Feld geht als kurze Zeichenkette an die Geräte (arcade.paint: "."
    // frei, "0" bis "3" der Platz in arcade.order), nicht als Liste aus 312
    // Spieler-IDs — das wären sonst elfmal pro Sekunde einige Kilobyte.
    arcade.order = players.map((player) => player.id);
    arcade.cells = new Array(PAINT_COLS * PAINT_ROWS).fill(-1);
    // Die Szene zeichnet die Walze genau dort, wo hier gemalt wird.
    arcade.rollerAhead = PAINT_ROLLER_AHEAD;
    arcade.brush = PAINT_BRUSH;
    arcade.brushWide = PAINT_BRUSH_WIDE;
    arcade.pickups = [];
    arcade.nextPickupAt = startedAt + PAINT_PICKUP_EVERY_MS;
    arcade.nextPickupId = 1;
    // Die letzten Einkreisungen: von dort aus läuft auf dem Bildschirm die
    // Farbwelle über die eingeschlossene Fläche.
    arcade.fills = [];
    arcade.nextFillId = 1;
    // Startplätze in den Ecken; zu zweit über Kreuz, damit keiner dem anderen
    // gleich zu Beginn vor der Walze steht.
    const corners = [
      [2, 2.5],
      [PAINT_COLS - 2, PAINT_ROWS - 2.5],
      [PAINT_COLS - 2, 2.5],
      [2, PAINT_ROWS - 2.5]
    ];
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const [px, py] = corners[index % corners.length];
      entry.slot = index;
      entry.px = px;
      entry.py = py;
      entry.vx = 0;
      entry.vy = 0;
      entry.kx = 0;               // Stoss aus einem Rempler, läuft für sich aus
      entry.ky = 0;
      entry.dirX = 0;
      entry.dirY = 0;
      // Blick zur Feldmitte; die Walze liegt von Anfang an vor der Figur.
      entry.heading = Math.atan2(PAINT_COLS / 2 - px, PAINT_ROWS / 2 - py);
      entry.rx = px + Math.sin(entry.heading) * PAINT_ROLLER_AHEAD;
      entry.ry = py + Math.cos(entry.heading) * PAINT_ROLLER_AHEAD;
      entry.wide = false;
      entry.boostUntil = 0;
      entry.painted = 0;
      entry.enclosed = 0;
      entry.stolen = 0;
      entry.biggestFill = 0;
      entry.owned = 0;
      entry.score = 0;
      entry.bumps = 0;
      entry.lastBumpAt = 0;
      entry.pickups = 0;
      entry.lastPickupAt = 0;
      entry.lastPickupKind = null;
      entry.lastFillAt = 0;
      entry.lastFillCount = 0;
      paintCells(arcade, index, paintSweep(px, py, px, py, PAINT_START_RADIUS));
    });
    // Der Startfleck zählt nicht als gemalt — sonst stünde schon vor dem
    // ersten Schritt etwas in der Statistik.
    players.forEach((player) => { arcade.players[player.id].painted = 0; });
    paintRefresh(arcade);
  }
  if (config.family === "fish") {
    arcade.tensionCalm = FISH_TENSION_CALM;
    arcade.tensionSurge = FISH_TENSION_SURGE;
    arcade.reelSpeed = FISH_REEL_SPEED;
    arcade.species = FISH_SPECIES;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.catchIndex = 0;
      entry.species = fishSpeciesFor(arcade.seed, 0);
      entry.phases = buildFishPhases(arcade.seed, 0, FISH_DURATION_MS, entry.species);
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
      entry.nextRisk = diveRiskAt(arcade.seed, 0, 1);
      entry.nextGain = diveGain(1);
    });
  }
  if (config.family === "glide") {
    // Der Kurs steht von Anfang an fest und gilt für ALLE gleich.
    const course = buildGlideCourse(arcade.seed + (Date.now() % 6007), GLIDE_DURATION_MS);
    arcade.targets = course.targets;
    arcade.stars = course.stars;
    arcade.speed = GLIDE_SPEED;
    arcade.height = GLIDE_HEIGHT;
    arcade.basket = GLIDE_BASKET;
    arcade.fallG = GLIDE_FALL_G;
    arcade.rings = GLIDE_RINGS;
    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      entry.y = 0.45;                  // Höhenanteil, 0 = Boden, 1 = Decke
      entry.vy = 0;
      entry.holding = false;
      entry.stallUntil = 0;
      entry.bags = [];                 // { id, at, fromY, landAt, landX, target, points }
      entry.bagsLeft = arcade.targets.length + 3;
      entry.lastBagAt = 0;
      entry.hits = 0;
      entry.bulls = 0;
      entry.starsCaught = 0;
      entry.nextStar = 0;
      entry.scoredTargets = {};
      entry.bumps = 0;
      entry.lane = index;
      entry.score = 0;
    });
  }

  if (config.family === "climb") {
    arcade.height = CLIMB_HEIGHT;
    arcade.sides = buildClimbSides(arcade.seed);
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      entry.rung = 0;                    // rungs climbed
      entry.nextSide = climbSideFor(arcade, 0);
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
    const ramp = Math.min(1, index * 0.11);
    // Die spaeten Schuebe sind SCHNELLER als man laufen kann. Genau daran haengt
    // das ganze Spiel: in einem schnellen Schub kann man den Rutsch nur
    // verlangsamen, nicht umkehren — man muss vorher Platz gesammelt haben.
    // Blieben alle Schuebe unter der Laufgeschwindigkeit, koennte man jede Lage
    // jederzeit retten, und gemessen ueberlebten dann 120 von 120 Bots die
    // volle Runde: ein Spiel ganz ohne Einsatz.
    const magnitude = 0.5 + ramp * 1.6 + arcadeNoise(seed + index * 19) * 0.25;
    // Mostly alternate, sometimes double up in the same direction for surprise.
    if (arcadeNoise(seed + index * 29) > 0.28) sign = -sign;
    phases.push({ from: at, until: at + length, vel: sign * magnitude });
    at += length;
    index += 1;
  }
  return phases;
}

// Wie schnell das Fass gerade WIRKLICH dreht. Ein Riesenfass springt nicht in
// einem Tick von voller Linksdrehung auf volle Rechtsdrehung — und genau das tat
// es vorher. Die Folge war messbar und ziemlich vernichtend: sobald ein Schub
// schneller war als man laufen kann, fiel man bei jedem Wechsel herunter, egal
// wie schnell man reagierte. 0 von 80 Bots ueberlebten eine Runde, alle fielen
// in den letzten vier Sekunden, und "hard" lag mit 28.2 s gleichauf mit "easy".
// Die ersten 25 Sekunden entschieden nichts.
//
// Jetzt dreht das Fass ueber BARREL_TURN_MS in die neue Richtung. Damit ist der
// Wechsel zu SEHEN, bevor er weh tut — und Hinschauen und frueh Gegenhalten
// zahlen sich aus. Das ist das Koennen, das dieses Spiel behauptet zu messen.
function barrelVelAt(arcade, elapsed) {
  for (let index = 0; index < arcade.phases.length; index += 1) {
    const phase = arcade.phases[index];
    if (elapsed >= phase.until) continue;
    const vorher = index > 0 ? arcade.phases[index - 1].vel : 0;
    const t = clamp((elapsed - phase.from) / BARREL_TURN_MS, 0, 1);
    // Weiche Kurve statt Geraden: der Umschwung faengt sanft an und laeuft sanft
    // aus, so wie ein schweres Fass eben dreht.
    const w = t * t * (3 - 2 * t);
    return vorher + (phase.vel - vorher) * w;
  }
  const letzte = arcade.phases[arcade.phases.length - 1];
  return letzte ? letzte.vel : 0;
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
  const end = Math.min(totalMs, CATCH_JACKPOT_AT - 700);
  while (at < end) {
    const gold = at >= CATCH_GOLD_FROM;
    const roll = arcadeNoise(seed + index * 29);
    const bombShare = at < 10000 ? 0.18 : 0.24;
    const kind = roll < bombShare ? "bomb" : roll > 0.88 ? "gem" : gold ? "gold" : "coin";
    const lane = Math.floor(arcadeNoise(seed + index * 13) * 3);
    drops.push({ id: id++, catchAt: Math.round(at), lane, kind, processed: false });
    // Ab und zu ein zweites auf demselben Schlag in einer anderen Spur — im
    // Goldrausch fast immer.
    const doubleChance = gold ? 0.7 : at < 10000 ? 0.25 : 0.42;
    if (index > 4 && arcadeNoise(seed + index * 53) < doubleChance) {
      const otherLane = (lane + 1 + Math.floor(arcadeNoise(seed + index * 61) * 2)) % 3;
      const otherRoll = arcadeNoise(seed + index * 67);
      drops.push({
        id: id++,
        catchAt: Math.round(at),
        lane: otherLane,
        kind: otherRoll < 0.35 ? "bomb" : gold ? "gold" : "coin",
        processed: false
      });
    }
    // Der Regen wird dichter: erst gemächlich, dann schneller, im Goldrausch
    // ein Prasseln.
    const gap = gold ? 300 : Math.max(380, 740 - index * 13);
    at += gap + arcadeNoise(seed + index * 41) * (gold ? 90 : 180);
    index += 1;
  }
  // Zum Schluss die Schatztruhe.
  drops.push({ id: id++, catchAt: CATCH_JACKPOT_AT, lane: Math.floor(arcadeNoise(seed + 997) * 3), kind: "jackpot", processed: false });
  return drops;
}

// Blobs pop out of the holes — some are spiky troublemakers.
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

// Leuchtfolge: die Runde weiterziehen, sobald ALLE fertig sind.
//
// Der Rundenplan steht in festen Zeiten, und das Eingabefenster ist so bemessen,
// dass auch ein langsamer Daumen sechs Farben schafft. Wer nach drei Sekunden
// fertig war, sass danach noch zwei Sekunden vor einem Bild, auf dem nichts
// passiert — gemessen summierte sich das am Rundenende auf 5.1 Sekunden Stille,
// und dazwischen kam es in jeder Runde noch einmal.
//
// Der Plan wird deshalb zusammengeschoben statt abgewartet. Der Client liest
// dieselben Zeiten aus dem Zustand, er zieht also einfach mit.
function updateSimon(room, minigame, arcade, now) {
  const elapsed = Math.max(0, now - minigame.startedAt);
  const round = simonRoundAt(arcade, elapsed);
  if (!round || elapsed < round.inputFrom) return;
  const alleFertig = room.players.every((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return true;
    return entry.currentRound === round.index
      && (entry.roundFailed || entry.roundProgress >= round.sequence.length);
  });
  if (!alleFertig) return;
  // Ein kurzer Moment bleibt stehen, damit der letzte Tipper sein eigenes
  // Aufleuchten noch sieht.
  const kuerzung = (round.until - elapsed) - SIMON_SETTLE_MS;
  if (kuerzung <= 0) return;
  // Die laufende Runde wird nur vorne abgeschnitten — ihr `inputFrom` liegt
  // schon in der Vergangenheit. Alles Spaetere rueckt komplett nach vorn.
  round.until -= kuerzung;
  arcade.rounds.forEach((r) => {
    if (r.index <= round.index) return;
    r.showFrom -= kuerzung;
    r.inputFrom -= kuerzung;
    r.until -= kuerzung;
  });
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

// Grün, Drehung, Rot — und ab und zu eine Finte: er dreht an und wieder weg.
// Deterministisch je Startwert, für alle gleich. Index 0 ist Grün.
function buildRedlightPhases(seed, totalMs) {
  const phases = [];
  let at = 0;
  let index = 0;
  const push = (kind, length) => {
    phases.push({ kind, from: at, until: at + length });
    at += length;
  };
  while (at < totalMs) {
    const late = Math.min(1, at / 30000);
    const turn = Math.round(REDLIGHT_TURN_FIRST_MS - (REDLIGHT_TURN_FIRST_MS - REDLIGHT_TURN_LAST_MS) * late);
    push("green", Math.round(1400 + arcadeNoise(seed + index * 13) * 1800));
    // Ab der dritten Runde gelegentlich eine Finte vor der echten Drehung.
    if (index >= 2 && arcadeNoise(seed + index * 29) < 0.3) {
      push("feint", Math.round(turn * 0.7));
      push("green", Math.round(700 + arcadeNoise(seed + index * 37) * 900));
    }
    push("turn", turn);
    push("red", Math.round(1100 + arcadeNoise(seed + index * 19) * 1000));
    index += 1;
  }
  return phases;
}

// Darf man in dieser Phase laufen? Alles ausser Rot.
function redlightMayRun(kind) {
  return kind !== "red";
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
    const base = Math.max(WAVE_MIN_GAP, WAVE_START_GAP - index * WAVE_GAP_STEP);
    // Doppelschlag ab dem sechsten Durchgang, etwa jeder vierte.
    const double = index >= 5 && arcadeNoise(seed + index * 31) < 0.27 && waves[waves.length - 2]?.double !== true;
    const gap = double ? WAVE_DOUBLE_GAP : base + arcadeNoise(seed + index * 23) * Math.min(420, base * 0.3);
    if (double) waves[waves.length - 1].double = true;
    at += gap;
    index += 1;
  }
  return waves;
}

// Same course for every player: at each row at least one lane stays free,
// so the track is always beatable and fair.
// Der Kurs besteht aus Abschnitten. Jeder verteilt die drei Beläge auf die
// drei Bahnen, und in manchen steht zusätzlich eine Hürde in einer Bahn.
//
// Zwei Regeln halten ihn fair und lesbar:
//  * Die Tempobahn wandert. Zwei Abschnitte hintereinander dieselbe schnelle
//    Bahn wären eine Einladung, einmal zu wechseln und dann wegzuschauen.
//  * Die Hürde steht NIE in der Sandbahn. Sonst wäre die Entscheidung geschenkt
//    — der Sand ist schon Strafe genug, eine Hürde obendrauf trifft niemanden.
function createRunnerCourse(seed) {
  const segments = [];
  const count = Math.ceil(RUNNER_LENGTH / RUNNER_SEG_LEN);
  let tempo = Math.floor(arcadeNoise(seed + 5) * 3);
  let sand = (tempo + 1 + Math.floor(arcadeNoise(seed + 11) * 2)) % 3;
  for (let index = 0; index < count; index += 1) {
    const at = index * RUNNER_SEG_LEN;
    // Die ersten beiden Abschnitte sind flach: man soll die Bahnen sehen,
    // bevor sie etwas kosten.
    const ruhig = index < 2;
    const lanes = [0, 1, 2].map((lane) => {
      if (ruhig) return "normal";
      if (lane === tempo) return "tempo";
      if (lane === sand) return "sand";
      return "normal";
    });
    // Ab dem vierten Abschnitt stehen Hürden, und nur in gut jedem dritten.
    let hurdle = null;
    if (index >= 3 && arcadeNoise(seed + index * 23) < 0.38) {
      const kandidaten = [0, 1, 2].filter((lane) => lanes[lane] !== "sand");
      hurdle = kandidaten[Math.floor(arcadeNoise(seed + index * 29) * kandidaten.length)];
    }
    segments.push({ index, at, lanes, hurdle, hurdleAt: at + RUNNER_SEG_LEN * 0.62 });
    // Nächster Abschnitt: Tempo wandert um eine Bahn, Sand setzt sich woanders hin.
    tempo = (tempo + (arcadeNoise(seed + index * 31) < 0.5 ? 1 : 2)) % 3;
    sand = (tempo + 1 + Math.floor(arcadeNoise(seed + index * 37) * 2)) % 3;
  }
  return segments;
}

// Der Abschnitt, in dem eine Position liegt.
function runnerSegmentAt(arcade, position) {
  const segments = arcade.segments || [];
  if (segments.length === 0) return null;
  const index = Math.min(segments.length - 1, Math.max(0, Math.floor(position / RUNNER_SEG_LEN)));
  return segments[index];
}

// Der Belagfaktor einer Bahn an einer Position.
function runnerLaneFactor(arcade, position, lane) {
  const segment = runnerSegmentAt(arcade, position);
  if (!segment) return 1;
  return RUNNER_SURFACE[segment.lanes[lane]] ?? 1;
}


// Der Zeitplan: je Runde Beginn (ab Spielstart), Ende der Ansage und Ende des
// Falls. Server, Bots und Client lesen alle dieselben Zahlen.
function buildColorSchedule() {
  const rounds = [];
  let at = 0;
  COLORGRID_ANNOUNCE_MS.forEach((announceMs) => {
    rounds.push({ start: at, dropAt: at + announceMs, end: at + announceMs + COLORGRID_DROP_MS });
    at += announceMs + COLORGRID_DROP_MS;
  });
  return rounds;
}

// Welche Runde und welche Phase zu einer Zeit ab Spielstart. Nach der letzten
// Runde "over".
function colorGridPhaseAt(arcade, elapsed) {
  const schedule = arcade.schedule || [];
  let round = 0;
  for (let index = 0; index < schedule.length; index += 1) {
    if (elapsed >= schedule[index].start) round = index;
  }
  const slot = schedule[round];
  if (!slot) return { round: 0, name: "announce" };
  if (elapsed < slot.dropAt) return { round, name: "announce", slot };
  if (elapsed < slot.end || round < schedule.length - 1) return { round, name: "drop", slot };
  return { round, name: "over", slot };
}

function advanceColorRound(arcade, round, now) {
  arcade.round = round;
  arcade.phase = "announce";
  arcade.roundStartedAt = now;
  const slot = arcade.schedule?.[round];
  // Für ältere Leser: dieselben Zahlen wie im Zeitplan, relativ zur Runde.
  arcade.announceMs = slot ? slot.dropAt - slot.start : COLORGRID_ANNOUNCE_MS[0];
  arcade.dropEndMs = arcade.announceMs + COLORGRID_DROP_MS;
  arcade.targetColor = Math.floor(arcadeNoise(arcade.seed + round * 53) * 4);
  // Erst alles mit anderen Farben füllen — so ist die Zahl der sicheren Felder
  // gesetzt und nicht dem Zufall überlassen.
  arcade.grid = Array.from({ length: COLORGRID_COLS * COLORGRID_ROWS }, (_cell, index) => {
    const roll = Math.floor(arcadeNoise(arcade.seed + round * 61 + index * 7) * 3);
    return (arcade.targetColor + 1 + roll) % 4;
  });
  const safe = COLORGRID_SAFE[Math.min(round, COLORGRID_SAFE.length - 1)];
  let placed = 0;
  for (let probe = 0; placed < safe && probe < arcade.grid.length * 6; probe += 1) {
    const slot2 = Math.floor(arcadeNoise(arcade.seed + round * 67 + probe * 11) * arcade.grid.length);
    if (arcade.grid[slot2] === arcade.targetColor) continue;
    arcade.grid[slot2] = arcade.targetColor;
    placed += 1;
  }
}

function handleArcadeInput(room, player, rawInput) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  const arcadePlayer = arcade?.players?.[player.id];
  if (!arcade || !arcadePlayer) return { ok: false, error: "Arcade-Spiel nicht bereit." };

  // Fast alle Familien lesen hier Felder aus `input`. Die Socket-Schicht schiebt schon
  // ein `|| {}` davor, aber die Regelschicht darf sich darauf nicht verlassen:
  // sie wird auch von den Bots und den Tests direkt gerufen, und ein Wurf hier
  // fliegt mitten im Tick — der nimmt die ganze Partie mit, nicht nur den
  // Spieler, der den Unsinn geschickt hat.
  const input = (rawInput && typeof rawInput === "object") ? rawInput : {};


  const now = Date.now();
  const cooldowns = { daredevil: 200, dive: 90, plinko: 180, curling: 180, runner: 130, colorgrid: 110, stopclock: 60, redlight: 60, wave: 200, pump: 40, barrel: 60, bomb: 150, catchfall: 110, whack: 110, cannon: 200, simon: 160, react: 200, knife: 90, stack: 90, climb: 40, seek: 260, estimate: 40, glide: 0, bounce: 0, feint: 0, trace: 45, belt: 90, fish: 60, paint: 55 };
  // bounce und feint ohne Cooldown: dort IST der Tippzeitpunkt die
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
    // Drücken und Loslassen kommen als eigene Meldung; dazwischen hält der
    // Client mit Pings wach. Ohne `hold` (alte Clients, Bots) ist es ein Ping.
    if (input.hold === false) {
      arcadePlayer.holding = false;
      return { ok: true };
    }
    arcadePlayer.holding = true;
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

  if (arcade.family === "daredevil") {
    if (input.action !== "brake") return { ok: false, error: "Tippe, um das Fass zu bremsen." };
    // Die Runde wird HIER aus der Zeit gerechnet, nicht aus arcade.round. Ein
    // Tap kann zwischen zwei Ticks ankommen, und dann hinkt arcade.round um
    // bis zu einen Tick hinterher — der erste Tap eines Durchgangs ginge
    // verloren, und das ist genau der, auf den es ankommt.
    const elapsed = Math.max(0, now - room.currentMinigame.startedAt);
    const seit = elapsed - (arcade.leadIn ?? DARE_LEAD_IN_MS);
    if (seit < 0) return { ok: true };                          // noch im Vorlauf
    const zyklus = DARE_ROLL_MS + DARE_SHOW_MS;
    const runde = Math.floor(seit / zyklus);
    if (runde >= DARE_ROUNDS) return { ok: true };              // vorbei
    const jetzt = (seit - runde * zyklus) / 1000;
    if (jetzt > DARE_ROLL_MS / 1000) return { ok: true };       // Auswertungsphase
    // Ein Bot darf seinen GEPLANTEN Bremszeitpunkt mitschicken, ein Client nie.
    // Der Grund ist keine Bequemlichkeit: der Bot sieht das Fass nur alle 90 bis
    // 180 ms, ein Mensch sieht es dauernd. Ohne das hier misst das Spiel beim
    // Bot die Tickrate statt das Zielen — gemessen wurde der beste Bot dadurch
    // regelmässig überrollt und der schlechteste gewann. Was den Bot unterscheiden
    // SOLL, ist sein Zielabstand und dessen Streuung, nicht sein Taktgeber.
    const t = (player.isBot || (DEV_TOOLS_ENABLED && room.autopilot)) && typeof input.at === "number" && Number.isFinite(input.at)
      ? clamp(input.at, 0, jetzt)
      : jetzt;
    // Frisches Fass, falls dieser Tap der erste Kontakt mit der Runde ist.
    // Den Reset am Tick aufzuhängen ginge schief: ein Tap, der zwischen zwei
    // Ticks ankommt, würde vom nächsten Tick wieder gelöscht — und das ist
    // ausgerechnet der schnellste Tap.
    if (arcadePlayer.roundIndex !== runde) {
      arcadePlayer.roundIndex = runde;
      arcadePlayer.brakeAt = null;
      arcadePlayer.brakeSpeed = 0;
      arcadePlayer.distance = null;
      arcadePlayer.barrelSpeed = 0;
      arcadePlayer.hit = false;
    }
    if (arcadePlayer.brakeAt !== null || arcadePlayer.hit) return { ok: true };
    arcadePlayer.brakeAt = t;
    arcadePlayer.brakeSpeed = DARE_SPEED0 + DARE_ACCEL * t;
    arcadePlayer.hasMoved = true;
    arcadePlayer.flash = "good";
    arcadePlayer.lastHitAt = now;
    return { ok: true };
  }

  if (arcade.family === "pump") {
    if (input.action !== "pump") return { ok: false, error: "Tippe so schnell du kannst." };
    // Pumpen heisst hoch UND runter: links und rechts im Wechsel. Zweimal
    // dieselbe Seite bewegt den Kolben nicht. Vorher zählte jeder Tipp —
    // ein zitternder Finger auf einem Knopf schlug zwei ehrliche Daumen.
    const side = input.side === "left" || input.side === "right" ? input.side : null;
    if (side && side === arcadePlayer.lastSide) {
      arcadePlayer.slips = (arcadePlayer.slips || 0) + 1;
      return { ok: true };
    }
    if (side) arcadePlayer.lastSide = side;
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
    if (now < (arcadePlayer.stunUntil || 0)) return { ok: true };   // noch benommen
    const elapsed = now - room.currentMinigame.startedAt;
    const pop = arcade.pops.find((candidate) =>
      candidate.cell === cell && elapsed >= candidate.from && elapsed <= candidate.until && !arcadePlayer.hitPopIds[candidate.id]);
    if (!pop) return { ok: true };
    arcadePlayer.hitPopIds[pop.id] = true;
    arcadePlayer.hasMoved = true;
    if (pop.kind === "bad") {
      // Ein Stachelblob kostet einen Treffer — derselbe Grund wie beim
      // Muenzregen: angezeigt wurden die Treffer, gewertet Treffer minus
      // Fehlgriffe. Zwei Zahlen fuer dieselbe Sache widersprechen sich
      // frueher oder spaeter.
      arcadePlayer.badHits += 1;
      arcadePlayer.hits = Math.max(0, arcadePlayer.hits - 1);
      arcadePlayer.flash = "bad";
      arcadePlayer.stunUntil = now + WHACK_STUN_MS;
    } else {
      arcadePlayer.hits += 1;
      arcadePlayer.flash = "good";
    }
    arcadePlayer.lastHitAt = now;
    arcadePlayer.score = arcadePlayer.hits * 10;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "cannon") {
    if (input.action !== "launch") return { ok: false, error: "Tippe im richtigen Moment zum Abschuss." };
    if (arcadePlayer.launchedAt) return { ok: true };
    const elapsed = Math.max(0, now - room.currentMinigame.startedAt);

    // Erster Tipp legt die Kraft fest, dann läuft der Winkel.
    if (!arcadePlayer.powerAt) {
      const power = cannonTri(elapsed / arcade.periodMs);
      arcadePlayer.power = Number(power.toFixed(3));
      arcadePlayer.powerAt = now;
      arcadePlayer.flash = "good";
      arcadePlayer.lastHitAt = now;
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }

    // Zweiter Tipp legt den Winkel fest — und los.
    const angleT = cannonTri((now - arcadePlayer.powerAt) / arcade.anglePeriodMs);
    const angleDeg = Math.round((CANNON_ANGLE_MIN + angleT * (CANNON_ANGLE_MAX - CANNON_ANGLE_MIN)) * 10) / 10;
    arcadePlayer.angle = angleDeg;
    arcadePlayer.launchedAt = now;
    const distance = cannonDistance(arcadePlayer.power, angleDeg, arcade.wind || 0);
    arcadePlayer.distance = Math.round(distance * 10) / 10;
    arcadePlayer.points = cannonPoints(arcadePlayer.distance, arcade.target);
    arcadePlayer.score = arcadePlayer.points;
    arcadePlayer.flash = arcadePlayer.points >= 70 ? "good" : "bad";
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
    if (now < room.currentMinigame.startedAt) return { ok: true };
    if (now < (arcadePlayer.stunUntil || 0) || arcadePlayer.nextStageAt) return { ok: true };
    if (now - (arcadePlayer.lastThrowAt || 0) < KNIFE_COOLDOWN_MS || arcadePlayer.knivesLeft <= 0) return { ok: true };
    arcadePlayer.lastThrowAt = now;
    arcadePlayer.throws += 1;
    arcadePlayer.hasMoved = true;
    const angle = knifeImpactAngle(arcadePlayer, now);
    const clash = arcadePlayer.stuckAngles.some((knife) => knifeAngleGap(knife.angle, angle) < KNIFE_MIN_GAP_DEG);
    if (clash) {
      // Klirr — das Messer prallt ab, der Stamm ist verloren. Nach der Pause
      // kommt der nächste.
      arcadePlayer.clashes += 1;
      arcadePlayer.knivesLeft = 0;
      arcadePlayer.stunUntil = now + KNIFE_CLASH_MS;
      arcadePlayer.nextStageAt = now + KNIFE_CLASH_MS;
      arcadePlayer.lastThrow = { at: now, angle, result: "clash" };
      arcadePlayer.flash = "bad";
    } else {
      arcadePlayer.stuckAngles.push({ angle, preset: false });
      arcadePlayer.stuck += 1;
      arcadePlayer.knivesLeft -= 1;
      arcadePlayer.points += 1;
      let result = "stuck";
      const apple = arcadePlayer.apples.find((candidate) => !candidate.hit && knifeAngleGap(candidate.angle, angle) < KNIFE_APPLE_GAP_DEG);
      if (apple) {
        apple.hit = true;
        arcadePlayer.applesHit += 1;
        arcadePlayer.points += KNIFE_APPLE_POINTS;
        result = "apple";
      }
      if (arcadePlayer.knivesLeft <= 0) {
        arcadePlayer.cleared += 1;
        arcadePlayer.points += KNIFE_STAGE_BONUS;
        arcadePlayer.nextStageAt = now + KNIFE_BREAK_MS;
        result = "cleared";
      }
      arcadePlayer.lastThrow = { at: now, angle, result };
      arcadePlayer.flash = "good";
    }
    arcadePlayer.lastHitAt = now;
    arcadePlayer.score = arcadePlayer.points;
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
    const gem = arcade.secret?.gems?.[player.id];
    if (!gem) return { ok: true };
    const steps = seekSteps(x, y, gem.x, gem.y);
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
      arcade.secret.gems[player.id] = seekGemFor(arcadePlayer.seekSeed, arcadePlayer.round);
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
    if (input.action === "drop") {
      const elapsed = now - room.currentMinigame.startedAt;
      if (elapsed < 0 || arcadePlayer.bagsLeft <= 0 || now - (arcadePlayer.lastBagAt || 0) < GLIDE_BAG_COOLDOWN_MS) return { ok: true };
      arcadePlayer.lastBagAt = now;
      arcadePlayer.bagsLeft -= 1;
      const fall = glideFallMs(arcadePlayer.y);
      const bag = {
        id: arcadePlayer.bags.length + 1,
        at: elapsed,
        fromY: arcadePlayer.y,
        landAt: Math.round(elapsed + fall),
        landX: Math.round(glideGroundX(elapsed + fall) * 1000) / 1000,
        target: null,
        points: null
      };
      arcadePlayer.bags.push(bag);
      // Ballast ab: der Ballon macht einen kleinen Satz nach oben.
      arcadePlayer.vy = Math.min(GLIDE_VY_MAX, arcadePlayer.vy + 0.14);
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }
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
    // Die verlangte Hand kommt IMMER aus der Griffolge, nie aus dem blossen
    // Umdrehen der letzten. Sonst zeigte die Wand eine Seite und der Server
    // erwartete die andere, sobald einmal abgerutscht wurde.
    arcadePlayer.nextSide = climbSideFor(arcade, arcadePlayer.rung);
    arcadePlayer.hasMoved = true;
    syncArcadeScore(room.currentMinigame, player, arcadePlayer);
    return { ok: true };
  }

  if (arcade.family === "runner") {
    if (arcadePlayer.finishedAt) return { ok: true };
    if (input.action === "lane") {
      const dir = input.dir === -1 || input.dir === "-1" ? -1 : 1;
      arcadePlayer.lane = clamp(arcadePlayer.lane + dir, 0, 2);
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }
    if (input.action === "jump") {
      arcadePlayer.jumpUntil = Date.now() + 650;
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }
    if (input.action === "attack") {
      if ((arcadePlayer.attacksLeft ?? RUNNER_ATTACKS_PER_RACE) <= 0) {
        return { ok: false, error: "Keine Angriffe mehr." };
      }
      if (now < (arcadePlayer.lastAttackAt || 0) + RUNNER_ATTACK_COOLDOWN_MS) {
        return { ok: false, error: "Angriff lädt auf!" };
      }
      arcadePlayer.lastAttackAt = now;
      arcadePlayer.attacksLeft = (arcadePlayer.attacksLeft ?? RUNNER_ATTACKS_PER_RACE) - 1;

      // Der Angriff geht nach VORNE IN DIE EIGENE BAHN, hat eine Reichweite, und
      // wer springt, wird verfehlt.
      //
      // Ohne das traf er immer den Fuehrenden, egal wo der lief — und weil alle
      // gleich oft angreifen, war das eine reine Fuehrungsstrafe ohne Gegenwehr.
      // Gemessen stellte das die Rangfolge auf den Kopf: der schwaechste Bot lag
      // im Schnitt auf Platz 2.23, der staerkste auf 2.80. Ein Spiel, in dem
      // Vorne-Liegen bestraft wird und man nichts dagegen tun kann, belohnt kein
      // Koennen.
      //
      // Reichweite allein half nicht: das Feld laeuft dicht beisammen, da ist
      // immer jemand in neun Metern. Erst die Bahn macht daraus ein Spiel — der
      // Angreifer muss sich hinter sein Opfer setzen, und das Opfer kann
      // ausweichen oder abspringen. Beides ist sichtbar und beides ist Koennen.
      const ahead = room.players
        .map((p) => arcade.players[p.id])
        .filter((p) => p && p !== arcadePlayer && !p.finishedAt
          && p.lane === arcadePlayer.lane
          && p.progress > arcadePlayer.progress
          && p.progress - arcadePlayer.progress <= RUNNER_ATTACK_RANGE)
        .sort((a, b) => a.progress - b.progress)[0];

      if (ahead && now >= (ahead.jumpUntil || 0)) {
        ahead.stumbleUntil = now + RUNNER_ATTACK_STUMBLE_MS;
        ahead.stumbles = (ahead.stumbles || 0) + 1;
        ahead.flash = "bad";
        ahead.lastHitAt = now;
        arcadePlayer.attacksLanded = (arcadePlayer.attacksLanded || 0) + 1;
      }
      arcadePlayer.hasMoved = true;
      return { ok: true };
    }
    return { ok: false, error: "Wische zum Spurwechsel, hoch zum Springen, tippen für Angriff." };
  }

  if (arcade.family === "colorgrid") {
    if (input.action !== "step") return { ok: false, error: "Wische in eine Richtung." };
    if (arcadePlayer.eliminated) return { ok: true };
    // Laufen darf man während der ganzen Ansage, gesperrt ist nur der Fall.
    const phase = colorGridPhaseAt(arcade, now - room.currentMinigame.startedAt);
    if (phase.name !== "announce") return { ok: true };
    const directions = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const direction = directions[input.dir];
    if (!direction) return { ok: false, error: "Unbekannte Richtung." };
    const targetGx = clamp(arcadePlayer.gx + direction[0], 0, COLORGRID_COLS - 1);
    const targetGy = clamp(arcadePlayer.gy + direction[1], 0, COLORGRID_ROWS - 1);
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
    // Erst schauen, dann werfen: der nächste Stein geht erst, wenn der eigene
    // vorige liegt. Ohne das lagen alle zwölf Steine gleichzeitig in der Luft —
    // der Eingabe-Cooldown erlaubte drei Würfe in einer halben Sekunde — und
    // dann entscheidet nicht mehr das Zielen, sondern wer wen unterwegs
    // anschiesst. Gemessen hat genau das die Spielstärken eingeebnet.
    const eigenerRollt = arcade.stones.some((stone) =>
      stone.playerId === player.id && (stone.vx !== 0 || stone.vy !== 0));
    if (eigenerRollt) return { ok: true };
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

  return { ok: false, error: "Unbekannte Arcade-Steuerung." };
}

// Nach Ablauf der Spielzeit — oder sobald das Finale läuft — steht alles
// still. Vorher liefen Bots und gehaltene Knöpfe im Finale weiter, während
// Menschen schon abgewiesen wurden: beim Lichtwächter kam ein Bot 2,5 s nach
// Schluss noch ins Ziel und wurde genau so gewertet.
function minigameFrozen(minigame, now) {
  if (!minigame) return true;
  if (minigame.finaleAt) return true;
  return Number.isFinite(minigame.duration) && now > minigame.startedAt + minigame.duration;
}

function updateArcade(room) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  if (!arcade) return;
  const now = Date.now();
  if (now < minigame.startedAt || minigameFrozen(minigame, now)) {
    arcade.lastUpdateAt = now;
    return;
  }


  if (arcade.family === "paint") {
    const dt = Math.min(0.12, Math.max(0.001, (now - (arcade.lastUpdateAt || now)) / 1000));
    arcade.lastUpdateAt = now;
    const active = room.players.filter((player) => arcade.players[player.id]);
    const entries = active.map((player) => arcade.players[player.id]);

    // Extras, nie mehr als zwei gleichzeitig — sonst wird es ein Wettlauf um
    // Boni statt um Fläche. Sie erscheinen dort, wo gerade niemand steht.
    if (now >= arcade.nextPickupAt && arcade.pickups.length < PAINT_PICKUP_MAX) {
      arcade.nextPickupAt = now + PAINT_PICKUP_EVERY_MS;
      const id = arcade.nextPickupId;
      arcade.nextPickupId += 1;
      const spot = paintPickupSpot(arcade, entries, id);
      const kind = arcadeNoise(arcade.seed + id * 71) < 0.55 ? "wide" : "bomb";
      arcade.pickups.push({ id, kind, x: spot.x, y: spot.y });
    }

    entries.forEach((entry) => {
      if (entry.boostUntil && now >= entry.boostUntil) {
        entry.wide = false;
        entry.boostUntil = 0;
      }
      // Die Fahrt folgt dem Stick zügig, ohne zusätzliche Bremse: wer den
      // Daumen hält, fährt volle Geschwindigkeit, wer loslässt, steht sofort.
      entry.vx += (entry.dirX * PAINT_SPEED - entry.vx) * Math.min(1, PAINT_ACCEL * dt);
      entry.vy += (entry.dirY * PAINT_SPEED - entry.vy) * Math.min(1, PAINT_ACCEL * dt);
      // Ein Rempler wirkt getrennt davon: sonst frässe die Lenkung ihn im
      // nächsten Tick wieder auf, und niemand würde je weggeschoben.
      entry.px = clamp(entry.px + (entry.vx + entry.kx) * dt, 0.3, PAINT_COLS - 0.3);
      entry.py = clamp(entry.py + (entry.vy + entry.ky) * dt, 0.3, PAINT_ROWS - 0.3);
      const fade = Math.exp(-PAINT_KNOCK_DECAY * dt);
      entry.kx *= fade;
      entry.ky *= fade;
      // Die Blickrichtung kommt aus dem Stick, nicht aus der Fahrt: ein
      // Rempler dreht niemanden um. Sie schwenkt mit Höchstrate, damit die
      // Walze bei einer Kehrtwende einen Bogen fährt statt durch die Figur zu
      // springen — genau so, wie es auf dem Bildschirm aussieht.
      if (Math.hypot(entry.dirX, entry.dirY) > 0.15) {
        const want = Math.atan2(entry.dirX, entry.dirY);
        const diff = Math.atan2(Math.sin(want - entry.heading), Math.cos(want - entry.heading));
        const turn = PAINT_TURN_RATE * dt;
        entry.heading += clamp(diff, -turn, turn);
      }
    });

    // Anrempeln: zwei Kins schieben sich auseinander. Man kann jemanden von
    // seiner Schleife abdrängen, bevor er sie schliesst.
    for (let a = 0; a < entries.length; a += 1) {
      for (let b = a + 1; b < entries.length; b += 1) {
        const one = entries[a];
        const two = entries[b];
        const dx = two.px - one.px;
        const dy = two.py - one.py;
        const dist = Math.hypot(dx, dy);
        if (dist >= PAINT_BUMP_RADIUS || dist < 1e-6) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = PAINT_BUMP_RADIUS - dist;
        const push = overlap * PAINT_BUMP_FORCE;
        one.kx -= nx * push;
        one.ky -= ny * push;
        two.kx += nx * push;
        two.ky += ny * push;
        // Und gleich ein Stück auseinander, damit niemand durch den anderen fährt.
        one.px = clamp(one.px - nx * overlap * 0.25, 0.3, PAINT_COLS - 0.3);
        one.py = clamp(one.py - ny * overlap * 0.25, 0.3, PAINT_ROWS - 0.3);
        two.px = clamp(two.px + nx * overlap * 0.25, 0.3, PAINT_COLS - 0.3);
        two.py = clamp(two.py + ny * overlap * 0.25, 0.3, PAINT_ROWS - 0.3);
        [one, two].forEach((entry) => {
          if (now - entry.lastBumpAt <= PAINT_BUMP_COOLDOWN_MS) return;
          entry.bumps += 1;
          entry.lastBumpAt = now;
        });
      }
    }

    entries.forEach((entry) => {
      // Die Walze malt ihren ganzen Weg seit dem letzten Tick.
      const rx = clamp(entry.px + Math.sin(entry.heading) * PAINT_ROLLER_AHEAD, 0, PAINT_COLS);
      const ry = clamp(entry.py + Math.cos(entry.heading) * PAINT_ROLLER_AHEAD, 0, PAINT_ROWS);
      const radius = entry.wide ? PAINT_BRUSH_WIDE : PAINT_BRUSH;
      let gained = paintCells(arcade, entry.slot, paintSweep(entry.rx, entry.ry, rx, ry, radius), entry);
      entry.rx = rx;
      entry.ry = ry;

      // Extras: hinlaufen genügt.
      const taken = arcade.pickups.findIndex((pickup) => Math.hypot(pickup.x - entry.px, pickup.y - entry.py) < PAINT_PICKUP_REACH);
      if (taken >= 0) {
        const [pickup] = arcade.pickups.splice(taken, 1);
        entry.pickups += 1;
        entry.lastPickupAt = now;
        entry.lastPickupKind = pickup.kind;
        entry.flash = "good";
        entry.lastHitAt = now;
        if (pickup.kind === "wide") {
          entry.wide = true;
          entry.boostUntil = now + PAINT_BOOST_MS;
        } else {
          gained += paintCells(arcade, entry.slot, paintSweep(entry.px, entry.py, entry.px, entry.py, PAINT_BOMB_RADIUS), entry);
        }
      }

      // Nur wer gerade Farbe dazubekommen hat, kann etwas eingeschlossen haben.
      if (gained > 0) {
        const pocket = paintPockets(arcade.cells, entry.slot);
        if (pocket.length) {
          const filled = paintCells(arcade, entry.slot, pocket, entry, "enclosed");
          entry.biggestFill = Math.max(entry.biggestFill, filled);
          entry.lastFillAt = now;
          entry.lastFillCount = filled;
          arcade.fills.push({ id: arcade.nextFillId, slot: entry.slot, x: entry.px, y: entry.py, count: filled, at: now });
          arcade.nextFillId += 1;
          if (arcade.fills.length > 4) arcade.fills.shift();
        }
      }
      entry.hasMoved = entry.hasMoved || Math.abs(entry.dirX) + Math.abs(entry.dirY) > 0.05;
    });

    paintRefresh(arcade);
    active.forEach((player) => syncArcadeScore(minigame, player, arcade.players[player.id]));
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

      // Sterne: EINMAL abgerechnet, wenn sie den Ballon erreichen.
      while (entry.nextStar < arcade.stars.length && elapsed >= arcade.stars[entry.nextStar].at) {
        const star = arcade.stars[entry.nextStar];
        if (Math.abs(entry.y - star.y) <= GLIDE_STAR_REACH) {
          entry.starsCaught += 1;
          entry.score += GLIDE_STAR_POINTS;
          entry.lastStar = { index: star.index, at: now };
        }
        entry.nextStar += 1;
      }

      // Gelandete Säcke werten: die nächste Scheibe, je Scheibe nur der erste
      // Treffer.
      entry.bags.forEach((bag) => {
        if (bag.points !== null || elapsed < bag.landAt) return;
        let best = null;
        arcade.targets.forEach((target) => {
          const off = Math.abs(bag.landX - target.x);
          if (!best || off < best.off) best = { target, off };
        });
        bag.points = 0;
        if (best && !entry.scoredTargets[best.target.index]) {
          const ring = GLIDE_RINGS.find(([reach]) => best.off <= reach);
          if (ring) {
            bag.points = ring[1];
            bag.target = best.target.index;
            bag.off = Math.round(best.off * 100) / 100;
            entry.scoredTargets[best.target.index] = true;
            entry.hits += 1;
            if (ring[1] >= 100) entry.bulls += 1;
            entry.score += ring[1];
          }
        }
        entry.lastBag = { id: bag.id, points: bag.points, at: now };
      });

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

  if (arcade.family === "daredevil") {
    updateDaredevil(room, minigame, arcade, now);
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

  if (arcade.family === "simon") {
    updateSimon(room, minigame, arcade, now);
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
      if (drop.kind !== "bomb") {
        // Der Faktor gilt schon für diesen Fang, wenn er ihn erreicht.
        entry.streak = (entry.streak || 0) + 1;
        entry.multiplier = catchMultiplier(entry.streak);
        const base = drop.kind === "jackpot" ? CATCH_JACKPOT_VALUE : drop.kind === "gem" ? 3 : drop.kind === "gold" ? 2 : 1;
        const gain = drop.kind === "jackpot" ? base : base * entry.multiplier;
        entry.catches += gain;
        entry.lastGain = gain;
        entry.flash = "good";
      } else {
        // Eine Bombe kostet eine Muenze. Vorher lief der Abzug an der Zaehlung
        // vorbei: angezeigt wurden die gefangenen Muenzen, gewertet wurde
        // Muenzen minus Bomben, und `score` rechnete nochmal anders. Drei Zahlen
        // fuer ein Spiel — gemessen rangierte 31 vor 32, und auf dem Ergebnisbild
        // stand das Gegenteil. Jetzt sagt die Muenzzahl die Wahrheit, und man
        // SIEHT sie fallen, wenn man eine Bombe frisst.
        entry.bombs += 1;
        entry.catches = Math.max(0, entry.catches - 1);
        entry.streak = 0;
        entry.multiplier = 1;
        entry.lastGain = -1;
        entry.flash = "bad";
      }
      entry.lastHitAt = now;
      entry.score = entry.catches * 10;
      syncArcadeScore(minigame, player, entry);
    });
  });
}




function updateKnife(room, minigame, arcade, dt, now) {
  // Nach einem vollen oder verlorenen Stamm kommt der nächste.
  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry || !entry.nextStageAt || now < entry.nextStageAt) return;
    setupKnifeStage(arcade, entry, entry.stage + 1, now);
  });
}

function updateBarrel(room, minigame, arcade, dt, now) {
  const elapsed = Math.max(0, now - minigame.startedAt);
  // Wer läuft, schiebt den Stamm unter sich in die Gegenrichtung. Jeder trägt
  // seinen eigenen Anteil, damit man ihn beim Einzelnen herausrechnen kann.
  let spin = 0;
  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return;
    const running = !entry.fallenAt && now - (entry.lastRunAt || 0) <= BARREL_HOLD_FRESH_MS;
    const push = running ? -(entry.runDir || 0) : 0;
    entry.spinShare = (entry.spinShare || 0) + (push * BARREL_PUSH - (entry.spinShare || 0) * BARREL_PUSH_DAMP) * dt;
    spin += entry.spinShare;
  });
  arcade.spin = spin;
  const current = barrelVelAt(arcade, elapsed) * BARREL_CURRENT_SHARE;
  const vel = current + spin;
  arcade.barrelVel = vel;
  arcade.barrelAngle += vel * dt;

  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return;
    if (entry.fallenAt) {
      // Zurück auf den Stamm, oben in die Mitte.
      if (now < (entry.backAt || 0)) return;
      entry.fallenAt = null;
      entry.offset = 0;
      entry.spinShare = 0;
      entry.returnedAt = now;
      return;
    }
    const holding = now - (entry.lastRunAt || 0) <= BARREL_HOLD_FRESH_MS;
    // Feste Laufgeschwindigkeit, NICHT relativ zum Fass. Relativ gerechnet
    // gewann Gegenhalten immer, und niemand fiel je herunter. Fest gerechnet
    // heisst: der schnellste Schub (1.9) laesst sich mit 2.1 gerade noch
    // zurueckdrehen, und in die falsche Richtung zu halten kostet 4.0 pro
    // Sekunde — von der Mitte bis zum Rand also gut vier Zehntel.
    const runVel = holding ? entry.runDir * BARREL_RUN_SPEED : 0;
    const others = clamp(spin - entry.spinShare, -BARREL_OTHERS_MAX, BARREL_OTHERS_MAX);
    const felt = current + entry.spinShare * BARREL_OWN_SHARE + others;
    // The spinning barrel carries you along; counter-run to stay on top.
    entry.offset += (felt + runVel) * dt;
    if (Math.abs(entry.offset) >= arcade.limit) {
      entry.fallenAt = now;
      entry.fallSide = Math.sign(entry.offset) || 1;
      entry.falls = (entry.falls || 0) + 1;
      entry.backAt = now + BARREL_RESPAWN_MS;
      entry.survivedMs = elapsed;
      entry.flash = "bad";
      entry.lastHitAt = now;
      syncArcadeScore(minigame, player, entry);
      return;
    }
    // DAS Ziel des Spiels: oben auf dem Fass BLEIBEN, also mittig. Am Rand zu
    // stehen war vorher gratis — sogar besser, denn wer sich gegen die Drehung
    // an den Rand stellt, hat den ganzen Weg als Reserve und kann praktisch nicht
    // mehr herunterfallen. Gemessen war das kein Randfall: mit einer Spitze von
    // 2.35 ueberlebten 80 von 80 Bots die volle Runde, mit 2.65 keiner. Zwischen
    // "unfallbar" und "chancenlos" lag nichts, weil das Spiel gar nicht mass, wo
    // man steht — nur, ob man noch oben ist.
    //
    // Quadratisch statt linear: am Rand bringt eine Sekunde fast nichts, in der
    // Mitte fast alles. Damit ist Randstehen weiter erlaubt und weiter sicher —
    // es gewinnt nur nichts mehr. Genau das macht aus dem Spiel eine Entscheidung.
    const naehe = 1 - Math.abs(entry.offset) / arcade.limit;
    entry.balanceWork = (entry.balanceWork || 0) + naehe * naehe * dt;
    entry.centreMs = Math.round(entry.balanceWork * 1000);
    entry.score = Math.round(entry.balanceWork * 100);
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
    const holding = entry.holding !== false && now - (entry.lastRunAt || 0) <= REDLIGHT_HOLD_FRESH_MS;
    entry.running = holding && redlightMayRun(phase.kind) && now >= (entry.stunUntil || 0);

    if (entry.running) {
      entry.progress = Math.min(arcade.goal, entry.progress + REDLIGHT_SPEED * dt);
      if (entry.progress >= arcade.goal) {
        entry.finishedAt = now;
        entry.finishMs = elapsed;
        entry.score = Math.max(1000, 200000 - elapsed);
        syncArcadeScore(minigame, player, entry);
      }
      return;
    }

    // Bei Rot noch gehalten — nach der Drehphase und einer kurzen Gnade.
    if (holding && phase.kind === "red" && entry.penalizedPhase !== phase.index) {
      const intoRed = elapsed - phase.from;
      if (intoRed > REDLIGHT_GRACE_MS) {
        entry.penalizedPhase = phase.index;
        entry.caught += 1;
        entry.progress = Math.max(0, entry.progress - REDLIGHT_PENALTY);
        entry.stunUntil = now + REDLIGHT_STUN_MS;
        entry.caughtAt = now;
        entry.flash = "bad";
        entry.lastHitAt = now;
      }
    }
  });
}

function updateDaredevil(room, minigame, arcade, now) {
  const elapsed = Math.max(0, now - minigame.startedAt);
  const zyklus = DARE_ROLL_MS + DARE_SHOW_MS;
  const seit = elapsed - (arcade.leadIn ?? DARE_LEAD_IN_MS);
  const roh = seit < 0 ? -1 : Math.floor(seit / zyklus);
  const runde = Math.min(DARE_ROUNDS - 1, roh);
  const imZyklus = seit < 0 ? 0 : seit - runde * zyklus;
  // Nach dem letzten Durchgang läuft nichts mehr, auch wenn die Spielzeit
  // noch nicht ganz um ist.
  const rollend = runde >= 0 && roh < DARE_ROUNDS && imZyklus < DARE_ROLL_MS;

  // Neuer Durchgang: ein frisches Fass für jeden, der noch in der alten
  // Runde steht. Der Reset hängt am SPIELER, nicht am Tick — wer schon
  // gebremst hat, hat damit auch schon seine Runde gesetzt und wird hier
  // nicht mehr angefasst.
  if (runde >= 0) {
    arcade.round = runde;
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry || entry.roundIndex === runde) return;
      entry.roundIndex = runde;
      entry.brakeAt = null;
      entry.brakeSpeed = 0;
      entry.distance = null;
      entry.barrelSpeed = 0;
      entry.hit = false;
    });
  }

  arcade.rolling = rollend;
  arcade.phase = runde < 0 ? "lead" : (rollend ? "roll" : "show");
  arcade.rollT = rollend ? imZyklus / 1000 : DARE_ROLL_MS / 1000;

  if (rollend) {
    const t = imZyklus / 1000;
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry || entry.hit) return;
      const stand = dareBarrelAt(t, entry.brakeAt);
      entry.distance = stand.distance;
      entry.barrelSpeed = stand.speed;
      // Überrollt: das Fass hat die Linie erreicht, bevor es stand.
      if (stand.distance <= DARE_HIT_M + 1e-6 && stand.speed > 0.05) {
        entry.hit = true;
        entry.flash = "bad";
        entry.lastHitAt = now;
        entry.hitAt = now;
      }
    });
    return;
  }

  // Rollphase vorbei: EINMAL abrechnen. Beim Wechsel abzurechnen hätte den
  // letzten Durchgang nie erfasst — nach ihm kommt kein Wechsel mehr.
  if (runde >= 0 && (arcade.settled || 0) === runde) {
    arcade.settled = runde + 1;
    closeDaredevilRound(room, minigame, arcade, now);
  }
}

// Ein Durchgang wird EINMAL abgerechnet, sobald sein Fass ausgerollt ist.
function closeDaredevilRound(room, minigame, arcade, now) {
  room.players.forEach((player) => {
    const entry = arcade.players[player.id];
    if (!entry) return;
    // Wer nie getippt hat, wird überrollt — Nichtstun ist keine sichere Wahl.
    // Überrollt ist, wer nie getippt hat, wen das Fass schon erreicht hat —
    // ODER wer so spät gebremst hat, dass der Bremsweg über die Linie reicht.
    // Der dritte Fall braucht die Rechnung: der Tick sieht ihn nur, wenn das
    // Fass die Linie innerhalb der Rollzeit auch wirklich erreicht.
    const ruhe = entry.brakeAt === null ? -1 : dareRestingDistance(entry.brakeAt);
    const hit = entry.hit || entry.brakeAt === null || ruhe <= 0;
    const distance = hit ? null : ruhe;
    const points = hit ? 0 : darePoints(distance);
    entry.results.push({ distance, points, hit });
    entry.points += points;
    entry.distance = distance;
    entry.hit = hit;
    if (!hit && (entry.best === null || entry.best === undefined || distance < entry.best)) {
      entry.best = distance;
    }
    entry.score = entry.points;
    syncArcadeScore(minigame, player, entry);
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
    const jumping = now < entry.jumpUntil;

    // Constantly run forward like Subway Surfers
    const surface = runnerLaneFactor(arcade, entry.progress, entry.lane);
    const speed = RUNNER_BASE_SPEED
      * surface
      * (stumbling ? 0.32 : 1.25);
    
    entry.speed = speed;
    entry.surface = runnerSegmentAt(arcade, entry.progress)?.lanes[entry.lane] || "normal";
    entry.progress = Math.min(arcade.trackLength, entry.progress + speed * dt);

    const segments = arcade.segments || [];
    while (entry.nextHurdle < segments.length && entry.progress >= segments[entry.nextHurdle].hurdleAt) {
      const segment = segments[entry.nextHurdle];
      entry.nextHurdle += 1;
      if (segment.hurdle === null || segment.hurdle !== entry.lane) continue;
      
      if (!jumping) {
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
}

function updateColorGrid(room, minigame, arcade, now) {
  if (now < minigame.startedAt) return;
  const elapsed = now - minigame.startedAt;
  const phase = colorGridPhaseAt(arcade, elapsed);
  if (phase.round !== arcade.round) advanceColorRound(arcade, phase.round, now);

  if (phase.name !== "announce" && arcade.phase === "announce") {
    // Der Boden fällt: wer auf einer falschen Farbe steht, fällt und ist raus.
    room.players.forEach((player) => {
      const entry = arcade.players[player.id];
      if (!entry || entry.eliminated) return;
      const tileColor = arcade.grid[entry.gy * COLORGRID_COLS + entry.gx];
      if (tileColor === arcade.targetColor) {
        entry.survived += 1;
        entry.score = entry.survived;
        entry.flash = "good";
      } else {
        entry.eliminated = true;
        entry.fallenRound = phase.round;
        entry.flash = "bad";
      }
      entry.lastHitAt = now;
      syncArcadeScore(minigame, player, entry);
    });
  }
  arcade.phase = phase.name;

  // Steht höchstens noch einer — oder ist die letzte Runde gefallen —, kurzes
  // Finale, damit man sieht, wer übrig ist.
  const alive = room.players.reduce((count, player) => (
    count + (arcade.players[player.id] && !arcade.players[player.id].eliminated ? 1 : 0)
  ), 0);
  const firstDrop = arcade.schedule?.[0]?.dropAt ?? 0;
  if ((room.players.length > 1 && alive <= 1 && elapsed > firstDrop) || phase.name === "over") {
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
  } else if (arcade.family === "bomb") {
    const alive = room.players.filter((player) => !arcade.players[player.id]?.outAt);
    done = room.players.length > 1 && alive.length <= 1;
  } else if (arcade.family === "cannon") {
    done = room.players.every((player) => arcade.players[player.id]?.launchedAt);
  } else if (arcade.family === "react") {
    done = room.players.every((player) => (arcade.players[player.id]?.times?.length || 0) >= REACT_ROUNDS);
  } else if (arcade.family === "curling") {
    // Alle Steine geworfen UND alles liegt still. Vorher lief die Uhr danach
    // noch weiter, und die Runde stand oft zehn Sekunden lang auf einem Bild,
    // in dem sich nichts mehr bewegt — das ist die längste Wartezeit im ganzen
    // Spiel gewesen, und sie hat nichts entschieden.
    const alleGeworfen = room.players.every((player) => (arcade.players[player.id]?.stonesLeft || 0) <= 0);
    const allesLiegt = (arcade.stones || []).every((stone) =>
      Math.hypot(stone.vx || 0, stone.vy || 0) < 0.02);
    done = alleGeworfen && allesLiegt;
  } else if (arcade.family === "stack") {
    done = room.players.every((player) => {
      const entry = arcade.players[player.id];
      return entry?.toppled || (entry?.height || 0) >= arcade.total;
    });
  } else if (arcade.family === "simon") {
    const letzte = arcade.rounds[arcade.rounds.length - 1];
    done = Boolean(letzte) && now - minigame.startedAt >= letzte.until;
  } else if (arcade.family === "climb") {
    done = room.players.every((player) => arcade.players[player.id]?.finishedAt);
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
      // Notbremse: eine Kugel mit sechzig Anschlägen klemmt, sie hüpft nicht.
      // Ab hier fällt sie geradeaus durch, statt weiter zu klackern.
      if (ball.plinks > PLINKO_MAX_PLINKS) {
        ball.vx = 0;
        ball.vy = Math.max(ball.vy, PLINKO_STALL_KICK);
        return;
      }
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

  // Kugel gegen Kugel. Alle vier fallen gleichzeitig, und ohne das durchdringen
  // sie sich lautlos — was auf dem Bild aussieht wie ein Fehler und die einzige
  // Stelle verschenkt, an der die Mitspieler einander überhaupt begegnen.
  // Gleiche Masse, also tauschen beide einfach den Anteil ihrer Geschwindigkeit
  // entlang der Verbindungslinie.
  for (let a = 0; a < arcade.balls.length; a += 1) {
    for (let b = a + 1; b < arcade.balls.length; b += 1) {
      const one = arcade.balls[a];
      const two = arcade.balls[b];
      const dx = two.x - one.x;
      const dy = two.y - one.y;
      const distance = Math.hypot(dx, dy);
      const minDistance = PLINKO_BALL_R * 2;
      if (distance >= minDistance || distance === 0) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      // Erst auseinanderschieben, damit sie nicht ineinander kleben.
      const overlap = (minDistance - distance) / 2;
      one.x -= nx * overlap;
      one.y -= ny * overlap;
      two.x += nx * overlap;
      two.y += ny * overlap;

      const relative = (two.vx - one.vx) * nx + (two.vy - one.vy) * ny;
      if (relative >= 0) continue;              // fliegen schon auseinander
      const impulse = -(1 + PLINKO_BALL_REST) * relative / 2;
      one.vx -= impulse * nx;
      one.vy -= impulse * ny;
      two.vx += impulse * nx;
      two.vy += impulse * ny;

      one.bumpedAt = now;
      two.bumpedAt = now;
      arcade.clacks = (arcade.clacks || 0) + 1;
    }
  }

  // Eine Kugel MUSS unten ankommen. Verkeilt sie sich trotz des Abstands
  // zwischen Nagel und Wand irgendwo, bekommt sie nach kurzer Zeit einen
  // Schubs. Ohne das kostet ein einziger unglücklicher Winkel die ganze Runde,
  // und niemand sieht, warum.
  arcade.balls.forEach((ball) => {
    if (ball.markeAt === undefined) {
      ball.markeY = ball.y;
      ball.markeAt = now;
      return;
    }
    if (now - ball.markeAt < PLINKO_STALL_MS) return;
    // Gemessen wird der FORTSCHRITT über ein Zeitfenster, nicht "hat sich seit
    // dem letzten Tiefpunkt etwas getan". Die verkeilte Kugel kroch pro Sekunde
    // ein paar Tausendstel nach unten — genug, um jede Schwelle immer wieder
    // zurückzusetzen, und trotzdem stand sie neun Sekunden lang praktisch.
    if (ball.y - ball.markeY < PLINKO_STALL_MIN) {
      ball.vy = Math.max(ball.vy, PLINKO_STALL_KICK);
      ball.vx *= 0.3;
    }
    ball.markeY = ball.y;
    ball.markeAt = now;
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

// Was ein Stein wert ist. Die Ringe waren ein Quantisierer, und zwar ein
// groeberer als das Koennen, das er messen sollte: gemessen landete der starke
// Bot im Mittel 0.107 vom Knopf entfernt, der mittlere 0.133 — BEIDE im selben
// Ring. Damit warf die Wertung genau die Information weg, die das Spiel erzeugt,
// und die Bot-Waage sah nur noch Rauschen (2.90 / 2.47 / 2.17).
//
// Jetzt zaehlt der Abstand selbst, stueckweise linear durch die Ringwerte. Am
// AUSSENRAND jedes Rings kommt genau die Zahl heraus, die seine Farbe schon
// immer versprochen hat — die Farbe sagt also weiter „mindestens so viel" —,
// und nach innen waechst es stetig weiter bis 24 am Knopf.
function curlingStonePoints(arcade, distance) {
  const ringe = [...arcade.rings].sort((a, b) => a.radius - b.radius);
  const aussen = ringe[ringe.length - 1];
  if (distance > aussen.radius) return 0;
  let innenR = 0;
  let innenP = ringe[0].points * CURLING_BUTTON_FACTOR;
  for (const ring of ringe) {
    if (distance <= ring.radius) {
      const t = (distance - innenR) / Math.max(1e-6, ring.radius - innenR);
      return innenP + (ring.points - innenP) * t;
    }
    innenR = ring.radius;
    innenP = ring.points;
  }
  return 0;
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

        // Steine PRALLEN NICHT AB, sie schieben sich.
        //
        // Das war der teuerste Fehler in diesem Spiel, und er stand als Zahl im
        // Messprotokoll: mit Rueckprall 0.92 landete der erste Stein, wo gezielt
        // war (0.031 gewollt, 0.040 erreicht), der zweite prallte auf 0.101 weg,
        // der dritte auf 0.166 — regelmaessig ganz aus dem Haus. Ein perfekter
        // Wurf wurde also bestraft, weil er genau dorthin ging, wo schon der
        // eigene Stein lag. Ueber drei Steine summiert war vom Zielen nichts mehr
        // uebrig (Verschiebung Ø 0.115 gegen einen Zielfehler von 0.034).
        //
        // Ein schwerer Eisstock, der gegen einen anderen laeuft, springt auch in
        // Wirklichkeit nicht zurueck: beide gleiten zusammen weiter. Genau das
        // ist eine vollstaendig unelastische Stossantwort — beide teilen sich die
        // Wucht laengs der Beruehrung. Damit bleibt Anschieben moeglich (man kann
        // jemanden vom Knopf draengen, das ist Koennen), ohne dass irgendwer
        // quer durchs Haus geschossen wird. Gemessen faellt die Verschiebung
        // damit auf 0.073.
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
      const wert = curlingStonePoints(arcade, distance);
      if (wert > 0) {
        points += wert;
        closeness += 1 - distance / outer;
      }
    });
    entry.score = Math.round(points);
    entry.precision = Math.round(
      (closeness / Math.max(1, CURLING_STONES_PER_PLAYER)) * 900);
    syncArcadeScore(minigame, player, entry);
  });
}

// Ringplan für Falschsignal. Aus dem Seed erzeugt, damit alle Clients dieselbe
// Folge sehen und der Server sie autoritativ auswerten kann.
function buildFeintSignals(seed, durationMs) {
  // BLOCKWEISE gebaut, nicht Ring fuer Ring.
  //
  // Die Regel des Spiels ist "je Dreierblock genau ein echter Ring" — sie haelt
  // das Mischungsverhaeltnis stabil, und daran haengt, dass blindes Haemmern
  // sich unterm Strich nicht lohnt (echte Ringe bringen 500, ein Fehlgriff
  // kostet 300, also muss auf jeden echten Ring rund das Doppelte an
  // Faelschungen kommen).
  //
  // Ring fuer Ring gebaut endete der Plan auf einem HALBEN Block, und wenn darin
  // kein echter Ring lag, hoerte die Runde mit bis zu zwoelf Sekunden auf, in
  // denen man nur noch verlieren konnte. Den Rest wegzuwerfen ging nicht: zwei
  // Faelschungen weniger sind 600 Punkte mehr fuers Haemmern, und bei einem
  // Startwert kippte damit das Vorzeichen. Ein ganzer Block passt oder er passt
  // nicht — so bleibt das Verhaeltnis exakt und der letzte Block hat immer
  // seinen echten Ring.
  const signals = [];
  let at = FEINT_LEAD_IN_MS;
  let index = 0;
  for (let block = 0; ; block += 1) {
    // Die Position im Block bleibt zufaellig, die Mischung nicht. Ein freier
    // Wuerfel pro Ring traf beides — mit einem Startwert war die Haelfte echt
    // (blindes Tippen zahlte sich aus), mit dem naechsten kamen fuenf
    // Faelschungen in Folge und die Runde fuehlte sich kaputt an.
    const goSlot = Math.min(FEINT_BLOCK - 1, Math.floor(arcadeNoise(seed + block * 29) * FEINT_BLOCK));
    const rotation = Math.floor(arcadeNoise(seed + block * 41) * FEINT_FAKE_LIMITS.length);
    const gebaut = [];
    let zeit = at;
    for (let slot = 0; slot < FEINT_BLOCK; slot += 1) {
      const roll = arcadeNoise(seed + (index + slot) * 13);
      const real = slot === goSlot;
      // Die Faelschungen rotieren, statt frei gewuerfelt zu werden: gewuerfelt
      // kamen drei fast gleiche in Folge, und die schwerste tauchte manchmal
      // eine ganze Runde nicht auf.
      const fakeSlot = slot > goSlot ? slot - 1 : slot;
      const limit = real ? 1 : FEINT_FAKE_LIMITS[(block + fakeSlot + rotation) % FEINT_FAKE_LIMITS.length];
      // Wie lange der Ring ueberhaupt zu sehen ist. Ein echter waechst bis zur
      // Marke und steht dann noch kurz; ein falscher bleibt stehen und verlischt.
      const windowMs = real
        ? FEINT_GROW_MS + FEINT_HOLD_MS
        : Math.round(FEINT_GROW_MS * limit * 1.25 + FEINT_FADE_MS);
      const gapAfter = FEINT_GAP_MIN_MS + roll * (FEINT_GAP_MAX_MS - FEINT_GAP_MIN_MS);
      gebaut.push({ at: zeit, real, limit, kind: real ? "go" : "fake", windowMs, gapAfter });
      zeit += windowMs + gapAfter;
    }
    // Passt der ganze Block noch in die Runde?
    const letzter = gebaut[gebaut.length - 1];
    if (letzter.at + letzter.windowMs > durationMs) break;

    // Im LETZTEN Block, der noch passt, kommt der echte Ring zum Schluss. Das
    // steht hier und nicht hinterher, weil sich mit der Reihenfolge auch die
    // Zeiten verschieben: die Abstaende gehoeren zur Stelle, nicht zum Ring.
    gebaut.forEach((sig) => { signals.push(sig); });
    index += FEINT_BLOCK;
    at = zeit;
  }

  // Der echte Ring des letzten Blocks ans Ende. Eine Runde, die mit "jetzt bloss
  // nichts tun" aufhoert, hat kein Finale.
  const ersterDesLetzten = signals.length - FEINT_BLOCK;
  if (ersterDesLetzten >= 0) {
    const block = signals.slice(ersterDesLetzten);
    const echt = block.map((sig) => sig.real).lastIndexOf(true);
    if (echt >= 0 && echt < block.length - 1) {
      const umsortiert = block.slice();
      umsortiert.splice(echt, 1);
      umsortiert.push(block[echt]);
      const abstaende = block.map((sig) => sig.gapAfter);
      let zeit = block[0].at;
      umsortiert.forEach((sig, i) => {
        sig.at = zeit;
        zeit += sig.windowMs + abstaende[i];
      });
      signals.splice(ersterDesLetzten, block.length, ...umsortiert);
    }
  }
  signals.forEach((sig, i) => { sig.index = i; });
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

// Alle Felder, deren Mitte die Walze auf dem Weg von a nach b überstreicht:
// eine Kapsel mit dem Walzenradius, keine Stichproben. Auch bei einem langen
// Tick oder voller Fahrt bleibt so keine Lücke in der Spur.
function paintSweep(ax, ay, bx, by, radius) {
  const out = [];
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const col0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
  const col1 = Math.min(PAINT_COLS - 1, Math.floor(Math.max(ax, bx) + radius));
  const row0 = Math.max(0, Math.floor(Math.min(ay, by) - radius));
  const row1 = Math.min(PAINT_ROWS - 1, Math.floor(Math.max(ay, by) + radius));
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      const cx = col + 0.5;
      const cy = row + 0.5;
      const t = length2 > 0 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / length2, 0, 1) : 0;
      if (Math.hypot(cx - ax - dx * t, cy - ay - dy * t) <= radius) out.push(paintIndex(col, row));
    }
  }
  return out;
}

// Färbt Felder in die Farbe von Platz `slot`. Zählt, was neu dazukam, und wie
// viel davon vorher jemand anderem gehörte.
function paintCells(arcade, slot, cells, entry = null, stat = "painted") {
  let gained = 0;
  cells.forEach((at) => {
    const before = arcade.cells[at];
    if (before === slot) return;
    arcade.cells[at] = slot;
    gained += 1;
    if (entry && before >= 0) entry.stolen += 1;
  });
  if (entry) entry[stat] = (entry[stat] || 0) + gained;
  return gained;
}

// Einkreisen: welche Felder die Farbe `slot` vom Rest des Feldes abschneidet.
// Gesucht wird über alle Felder, die NICHT in dieser Farbe sind, verbunden nur
// über Kanten — eine schräge Treppe aus eigener Farbe hält also dicht, und der
// Feldrand ist eine Wand. Die grösste solche Fläche ist "draussen" und bleibt;
// jede andere bis PAINT_ENCLOSE_MAX Felder ist eingeschlossen.
function paintPockets(cells, slot) {
  const total = cells.length;
  const seen = new Uint8Array(total);
  const regions = [];
  for (let start = 0; start < total; start += 1) {
    if (seen[start] || cells[start] === slot) continue;
    const region = [start];
    seen[start] = 1;
    const visit = (at) => {
      if (seen[at] || cells[at] === slot) return;
      seen[at] = 1;
      region.push(at);
    };
    for (let i = 0; i < region.length; i += 1) {
      const at = region[i];
      const col = at % PAINT_COLS;
      const row = (at - col) / PAINT_COLS;
      if (col > 0) visit(at - 1);
      if (col < PAINT_COLS - 1) visit(at + 1);
      if (row > 0) visit(at - PAINT_COLS);
      if (row < PAINT_ROWS - 1) visit(at + PAINT_COLS);
    }
    regions.push(region);
  }
  if (regions.length < 2) return [];
  let outside = 0;
  regions.forEach((region, index) => {
    if (region.length > regions[outside].length) outside = index;
  });
  return regions.flatMap((region, index) => (index === outside || region.length > PAINT_ENCLOSE_MAX ? [] : region));
}

// Zählt die Felder je Platz neu und schreibt das Feld als Zeichenkette für die
// Geräte. Der Punktestand IST die Fläche.
function paintRefresh(arcade) {
  const counts = arcade.order.map(() => 0);
  let text = "";
  for (const slot of arcade.cells) {
    if (slot >= 0) {
      counts[slot] += 1;
      text += String(slot);
    } else {
      text += PAINT_EMPTY;
    }
  }
  arcade.paint = text;
  arcade.order.forEach((playerId, slot) => {
    const entry = arcade.players[playerId];
    if (!entry) return;
    entry.owned = counts[slot];
    entry.score = counts[slot];
  });
}

function paintOwnedCount(arcade, playerId) {
  const slot = arcade.order.indexOf(playerId);
  let owned = 0;
  for (const cell of arcade.cells) if (cell === slot) owned += 1;
  return owned;
}

// Wo ein Extra erscheint: auf einem Feld, auf dem gerade niemand steht, damit
// es ein Weg ist und kein Geschenk. Aus dem Startwert gewürfelt, nicht aus der
// Uhr.
function paintPickupSpot(arcade, entries, id) {
  let best = null;
  let bestGap = -1;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const x = 1.5 + Math.floor(arcadeNoise(arcade.seed + id * 37 + attempt * 11) * (PAINT_COLS - 2));
    const y = 2.5 + Math.floor(arcadeNoise(arcade.seed + id * 53 + attempt * 13) * (PAINT_ROWS - 4));
    const gap = entries.reduce((near, entry) => Math.min(near, Math.hypot(entry.px - x, entry.py - y)), 99);
    if (gap > bestGap) {
      best = { x, y };
      bestGap = gap;
    }
    if (gap >= 4) break;
  }
  return best;
}

// Der Bot fährt Schleifen: ein Stück hinaus, ein Stück quer, zurück in die
// eigene Farbe — genau das, was ein Mensch nach der ersten Einkreisung auch
// tut. Er probiert ein paar Schleifen im Kopf aus (malt sie auf einer Kopie
// des Feldes und rechnet das Einkreisen nach) und nimmt die, die je Weglänge
// am meisten bringt. Das Können steckt darin, wie viele Varianten er
// durchdenkt, ob ihm ein Extra auffällt und wie sauber er fährt.
function paintBotPlan(arcade, entry, profile, now) {
  const tries = profile.level === "hard" ? 9 : profile.level === "normal" ? 4 : 1;
  const radius = entry.wide ? PAINT_BRUSH_WIDE : PAINT_BRUSH;
  const home = (x, y) => {
    let best = null;
    let bestDist = Infinity;
    arcade.cells.forEach((cell, at) => {
      if (cell !== entry.slot) return;
      const col = at % PAINT_COLS;
      const row = (at - col) / PAINT_COLS;
      const dist = Math.hypot(col + 0.5 - x, row + 0.5 - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: col + 0.5, y: row + 0.5 };
      }
    });
    return best;
  };
  const inside = (x, y) => ({ x: clamp(x, 0.6, PAINT_COLS - 0.6), y: clamp(y, 0.6, PAINT_ROWS - 0.6) });
  const judge = (points) => {
    const cells = arcade.cells.slice();
    let gain = 0;
    let length = 0;
    let from = { x: entry.px, y: entry.py };
    points.forEach((point) => {
      paintSweep(from.x, from.y, point.x, point.y, radius).forEach((at) => {
        if (cells[at] === entry.slot) return;
        // Fremde Farbe zählt mehr: eins für mich, eins weniger beim anderen.
        gain += cells[at] >= 0 ? 1.4 : 1;
        cells[at] = entry.slot;
      });
      length += Math.hypot(point.x - from.x, point.y - from.y);
      from = point;
    });
    paintPockets(cells, entry.slot).forEach((at) => {
      gain += arcade.cells[at] >= 0 && arcade.cells[at] !== entry.slot ? 1.4 : 1;
    });
    return gain / (length + 1.5);
  };

  let best = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const out = 2.5 + Math.random() * 5;
    const side = (2 + Math.random() * 4.5) * (Math.random() < 0.5 ? -1 : 1);
    const first = inside(entry.px + Math.sin(angle) * out, entry.py + Math.cos(angle) * out);
    const second = inside(first.x + Math.cos(angle) * side, first.y - Math.sin(angle) * side);
    const back = home(second.x, second.y);
    const points = back ? [first, second, back] : [first, second];
    const value = judge(points);
    if (!best || value > best.value) best = { points, value };
  }
  // Ein Extra in der Nähe lohnt den Umweg — der schwache Bot sieht es selten.
  const notices = profile.level === "hard" ? 1 : profile.level === "normal" ? 0.6 : 0.2;
  arcade.pickups.forEach((pickup) => {
    if (Math.random() > notices) return;
    const dist = Math.hypot(pickup.x - entry.px, pickup.y - entry.py);
    const value = (pickup.kind === "bomb" ? 10 : 8) / (dist + 1.5);
    if (!best || value > best.value) best = { points: [{ x: pickup.x, y: pickup.y }], value };
  });
  if (!best) return null;
  const length = best.points.reduce((sum, point, index, list) => {
    const from = index === 0 ? { x: entry.px, y: entry.py } : list[index - 1];
    return sum + Math.hypot(point.x - from.x, point.y - from.y);
  }, 0);
  return { points: best.points, step: 0, until: now + (length / PAINT_SPEED) * 1600 + 700 };
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



function arcadeBotStep(room, bot) {
  const minigame = room.currentMinigame;
  const arcade = minigame?.arcade;
  const player = arcade?.players?.[bot.id];
  if (!arcade || !player) return;
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
    const release = () => {
      if (player.holding) handleArcadeInput(room, bot, { action: "run", hold: false });
    };
    if (phase.kind === "green") {
      // Nach einer Drehung reagiert der Bot verzögert wieder auf Grün.
      if (intoPhase >= profile.reactionMs * 0.6 && Math.random() > 0.05) {
        handleArcadeInput(room, bot, { action: "run" });
      }
      return;
    }
    if (phase.kind === "turn" || phase.kind === "feint") {
      // Er sieht die Drehung und lässt nach seiner Reaktionszeit los. Bei
      // einer Finte lässt er genauso los — er weiss es ja nicht besser; der
      // Unterschied ist nur, dass es ihn dann bloss Zeit kostet.
      if (player.botTurnPhase !== phase.index) {
        player.botTurnPhase = phase.index;
        player.botReleaseAfter = profile.reactionMs * (0.7 + Math.random() * 0.6);
        // Gierige Fehler: hin und wieder läuft er einfach weiter.
        player.botGreedy = Math.random() < profile.mistake * 0.6;
      }
      if (intoPhase >= player.botReleaseAfter && !player.botGreedy) release();
      else handleArcadeInput(room, bot, { action: "run" });
      return;
    }
    // Rot: wer gierig war, hält noch einen Moment zu lang.
    if (player.botGreedy && intoPhase < 400) handleArcadeInput(room, bot, { action: "run" });
    else release();
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
      // Ein Patzer je Welle mit dem vollen Fehlerwert war zu viel: der starke
      // Bot schied im Mittel nach acht Wellen aus, die Runde war oft nach acht
      // Sekunden vorbei. Mit einem Drittel davon hält er gut dreissig Wellen,
      // der schwache um die zehn.
      // Und erst mit dem Tempo steigt die Gefahr: in den ersten Wellen patzt
      // kaum einer, wenn das Seil rast, deutlich öfter.
      const waveIndex = arcade.waves.indexOf(next);
      const pressure = 0.3 + 0.7 * Math.min(1, waveIndex / 12) + (next.double ? 0.5 : 0);
      player.botJumpAt = Math.random() < profile.mistake * 0.35 * pressure
        ? next.hitAt + arcade.jumpMs * 0.8
        : next.hitAt - arcade.jumpMs * 0.45 - BOT_TICK_LEAD_MS
          + (Math.random() - 0.5) * profile.spreadMs * 0.5;
    }
    if (elapsed >= player.botJumpAt && now >= player.jumpUntil) {
      handleArcadeInput(room, bot, { action: "jump" });
    }
    return;
  }
  if (arcade.family === "daredevil") {
    if (!arcade.rolling || player.brakeAt !== null || player.hit) return;
    const profile = botProfile(player);
    // Der Bot zielt auf einen Abstand und rechnet zurück, wann er dafür
    // tippen muss. Die Stufe steckt im Zielabstand UND in der Streuung:
    // ein Bot, der immer 0.0 trifft, wäre unschlagbar.
    if (player.botAimDist === undefined || player.botAimRound !== arcade.round) {
      player.botAimRound = arcade.round;
      const ziel = profile.level === "hard" ? 0.5 : profile.level === "normal" ? 1.5 : 3.2;
      player.botAimDist = Math.max(0.05, ziel + (Math.random() - 0.5) * 2 * (ziel * 0.55));
    }
    // Bremszeitpunkt aus dem Zielabstand: dareRestingDistance ist streng
    // fallend in brakeAt, also reicht eine kurze Suche.
    let lo = 0;
    let hi = DARE_ROLL_MS / 1000;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (dareRestingDistance(mid) > player.botAimDist) lo = mid; else hi = mid;
    }
    // Sobald der Zeitpunkt durch ist, wird gebremst — und zwar auf `lo`, nicht
    // auf „jetzt". Siehe handleArcadeInput: sonst misst der Lauf die Tickrate
    // des Bots statt sein Zielvermögen.
    if ((arcade.rollT || 0) >= lo) handleArcadeInput(room, bot, { action: "brake", at: lo });
    return;
  }

  if (arcade.family === "pump") {
    const profile = botProfile(player);
    // Tap rate scales with skill; the input cooldown caps the maximum. Wer
    // schwächer ist, erwischt öfter zweimal dieselbe Seite.
    const chance = profile.level === "hard" ? 0.9 : profile.level === "normal" ? 0.7 : 0.5;
    if (Math.random() < chance) {
      const next = player.lastSide === "left" ? "right" : "left";
      const side = Math.random() < profile.mistake * 0.5 ? (player.lastSide || "left") : next;
      handleArcadeInput(room, bot, { action: "pump", side });
    }
    return;
  }
  if (arcade.family === "barrel") {
    if (player.fallenAt) return;
    const profile = botProfile(player);
    const now = Date.now();
    // Alles haengt daran, WANN man den Richtungswechsel bemerkt: bis dahin haelt
    // man in die falsche Richtung und wird mit doppeltem Tempo an den Rand
    // getragen. Genau das wird hier abgebildet — der Bot sieht das Fass mit
    // seiner Reaktionszeit Verspaetung.
    //
    // Die Verzoegerung braucht ein Gedaechtnis, keinen Vergleich: seit das Fass
    // stufenlos dreht (barrelVelAt), aendert sich barrelVel in JEDEM Tick, und
    // ein "hat sich der Wert geaendert?"-Test haette den Bot nie etwas sehen
    // lassen. Er fuehrt darum ein kurzes Protokoll und liest daraus den Wert von
    // vor reactionMs.
    const verzug = profile.reactionMs * 0.6;
    if (!player.botVelLog) player.botVelLog = [];
    player.botVelLog.push({ t: now, v: arcade.barrelVel });
    while (player.botVelLog.length > 1 && now - player.botVelLog[0].t > 1600) player.botVelLog.shift();
    let seenVel = player.botVelLog[0].v;
    for (const eintrag of player.botVelLog) {
      if (now - eintrag.t < verzug) break;
      seenVel = eintrag.v;
    }
    // Der Bot stellt sich gegen die Drehrichtung ins Fass, und zwar umso weiter,
    // je schneller es dreht: in einem schnellen Schub kann er den Rutsch nur
    // verlangsamen, also braucht er den Platz VORHER. Genau das ist auch der
    // Trick, den ein Mensch hier lernt.
    // Wie weit sich der Bot aus der Mitte traut. Das ist seit der Wertung nach
    // Mittelzeit die eigentliche Entscheidung des Spiels: Rand ist sicher und
    // bringt nichts, Mitte bringt Punkte und kann den Sturz kosten. Ein starker
    // Spieler bleibt dichter dran, weil er den Wechsel frueher sieht.
    const mut = profile.level === "hard" ? 0.5 : profile.level === "normal" ? 0.72 : 1;
    const bank = Math.min(arcade.limit * 0.75, (0.3 + Math.abs(seenVel) * 0.35) * mut);
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
    if (!next || next.catchAt - elapsed > (next.kind === "jackpot" ? 2400 : 1100)) return;
    let wanted = player.lane;
    if (next.kind !== "bomb" && Math.random() > profile.mistake) wanted = next.lane;
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
    if (now < (player.stunUntil || 0)) return;
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
    const accuracy = profile.level === "hard" ? 1 : profile.level === "normal" ? 0.6 : 0.2;
    if (!player.powerAt) {
      if (player.botLaunchAt === undefined) {
        // Eine Kraft wählen und den Moment treffen, in dem die Anzeige dort
        // steht (steigend), mit Streuung nach Können.
        player.botPower = 0.78 + Math.random() * 0.2;
        const at = (player.botPower / 2) * arcade.periodMs + (Math.random() - 0.5) * profile.spreadMs * 0.5;
        const cycle = 1 + Math.floor(Math.random() * 3);
        player.botLaunchAt = cycle * arcade.periodMs + Math.max(60, at) - BOT_TICK_LEAD_MS;
      }
      if (now - minigame.startedAt >= player.botLaunchAt) {
        handleArcadeInput(room, bot, { action: "launch" });
      }
      return;
    }
    if (player.botAngleAt === undefined) {
      // Den Winkel suchen, der mit der festgelegten Kraft die Flagge trifft —
      // den Wind rechnet ein guter Bot ganz ein, ein schwacher kaum.
      const wind = (arcade.wind || 0) * accuracy;
      let best = CANNON_ANGLE_MIN;
      let bestOff = Infinity;
      for (let deg = CANNON_ANGLE_MIN; deg <= 45; deg += 0.5) {
        const off = Math.abs(cannonDistance(player.power, deg, wind) - arcade.target);
        if (off < bestOff) { bestOff = off; best = deg; }
      }
      const share = (best - CANNON_ANGLE_MIN) / (CANNON_ANGLE_MAX - CANNON_ANGLE_MIN);
      const first = (share / 2) * arcade.anglePeriodMs;
      const aim = first >= 260 ? first : arcade.anglePeriodMs - first;
      player.botAngleAt = player.powerAt + aim - BOT_TICK_LEAD_MS + (Math.random() - 0.5) * profile.spreadMs * 0.7;
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
    const now = Date.now();
    if (now < minigame.startedAt || now < (player.stunUntil || 0) || player.nextStageAt || player.knivesLeft <= 0) return;
    if (now - (player.lastThrowAt || 0) < KNIFE_COOLDOWN_MS) return;
    const profile = botProfile(player);
    // Der Bot schaut, wo sein Messer jetzt landen würde, und wirft, wenn dort
    // genug Platz ist. Seine Stufe ist, wie sehr er sich dabei verschätzt.
    //
    // Vorher verlangte der starke Bot 24° Platz nach beiden Seiten. Auf einem
    // vollen Stamm (acht Messer und drei vorgesteckte) gibt es so eine Lücke
    // gar nicht mehr — er wartete, bis die Zeit um war, und landete gemessen
    // auf dem LETZTEN Platz (Ø 3.57). Jetzt verlangt er nie mehr, als der Stamm
    // hergibt: höchstens die halbe grösste Lücke.
    const misjudge = (Math.random() * 2 - 1) * (profile.level === "hard" ? 2.5 : profile.level === "normal" ? 7 : 14);
    const buffer = profile.level === "hard" ? 2 : profile.level === "normal" ? 3.5 : 1;
    const angles = player.stuckAngles.map((knife) => knife.angle).sort((a, b) => a - b);
    let roomy = 180;
    if (angles.length > 1) {
      roomy = 0;
      angles.forEach((angle, index) => {
        const next = index + 1 < angles.length ? angles[index + 1] : angles[0] + 360;
        roomy = Math.max(roomy, (next - angle) / 2);
      });
    }
    const need = Math.min(KNIFE_MIN_GAP_DEG + buffer, roomy - 0.5);
    const angle = knifeImpactAngle(player, now + BOT_TICK_LEAD_MS * 0.5) + misjudge;
    const clearance = player.stuckAngles.reduce((least, knife) => Math.min(least, knifeAngleGap(knife.angle, angle)), 180);
    const hurry = Math.random() < profile.mistake * 0.25;
    if (clearance >= need || hurry) handleArcadeInput(room, bot, { action: "throw" });
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
    const plan = player.botPlan;
    if (!plan || plan.step >= plan.points.length || now >= plan.until) {
      player.botPlan = paintBotPlan(arcade, player, profile, now);
    }
    const current = player.botPlan;
    if (!current) return;
    let target = current.points[current.step];
    if (Math.hypot(target.x - player.px, target.y - player.py) < 0.6) {
      current.step += 1;
      if (current.step >= current.points.length) return;
      target = current.points[current.step];
    }
    const dx = target.x - player.px;
    const dy = target.y - player.py;
    const length = Math.hypot(dx, dy) || 1;
    // Etwas Zittern in der Richtung: sonst laufen Bots wie auf Schienen, und
    // der schwache verfehlt so auch mal die eigene Farbe beim Heimweg.
    const wobble = profile.level === "hard" ? 0.06 : profile.level === "normal" ? 0.16 : 0.34;
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
    const target = arcade.targets.find((candidate) => !player.scoredTargets[candidate.index] && glideGroundX(candidate.at) > glideGroundX(elapsed) - 0.5);
    // Höhe: ein guter Bot geht tief (kurzer Fall, genauer Wurf), ein schwacher
    // bleibt, wo er gerade ist. Zwischen den Scheiben holen sich alle Sterne.
    const star = arcade.stars[player.nextStar];
    let aim = profile.level === "hard" ? 0.22 : profile.level === "normal" ? 0.35 : 0.55;
    if (star && (!target || target.at - elapsed > 2200) && star.at - elapsed < 1600) aim = star.y;
    const predicted = player.y + player.vy * 0.45;
    handleArcadeInput(room, bot, { action: "lift", down: predicted < aim });
    if (!target || player.bagsLeft <= 0) return;
    // Abwurf: wenn der Sack ungefähr auf der Scheibe landen würde.
    if (player.botTargetId !== target.index) {
      player.botTargetId = target.index;
      const slop = profile.level === "hard" ? 90 : profile.level === "normal" ? 200 : 380;
      player.botDropError = (Math.random() - 0.5) * 2 * slop;
    }
    const landAt = elapsed + glideFallMs(player.y) + BOT_TICK_LEAD_MS * 0.5;
    if (Math.abs(landAt - (target.at + player.botDropError)) < 70) {
      handleArcadeInput(room, bot, { action: "drop" });
    }
    return;
  }
  if (arcade.family === "climb") {
    if (player.finishedAt) return;
    const profile = botProfile(player);
    const chance = profile.level === "hard" ? 0.85 : profile.level === "normal" ? 0.62 : 0.42;
    // Doppelsprossen kosten auch den Bot. Sie sind der Grund, warum ein Mensch
    // hinschauen muss statt zu trommeln — hätte der Bot sie umsonst, wäre die
    // Regel eine Bremse, die nur für Spieler gilt.
    const doubled = player.rung >= 1
      && climbSideFor(arcade, player.rung) === climbSideFor(arcade, player.rung - 1);
    if (Math.random() < (doubled ? chance * 0.55 : chance)) {
      // Bots almost always follow the wall; the doubled holds are where they
      // fumble, exactly like a player who tapped ahead out of habit.
      const fumble = profile.mistake * (doubled ? 0.9 : 0.25);
      const side = Math.random() < fumble ? -player.nextSide : player.nextSide;
      handleArcadeInput(room, bot, { action: "grab", side });
    }
    return;
  }
  if (arcade.family === "runner") {
    if (player.finishedAt) return;
    const now = Date.now();
    const profile = botProfile(player);
    const segments = arcade.segments || [];
    const hier = runnerSegmentAt(arcade, player.progress);
    if (!hier) return;
    const naechster = segments[Math.min(segments.length - 1, hier.index + 1)];

    if (player.botSegIndex !== hier.index) {
      player.botSegIndex = hier.index;
      player.botRead = Math.random() > profile.mistake;
    }

    // Springen, wenn die Huerde direkt vor einem steht.
    if (player.botRead && hier.hurdle === player.lane && (hier.hurdleAt - player.progress) < 3.0) {
      handleArcadeInput(room, bot, { action: "jump" });
      return;
    }

    // Angreifen, wenn wirklich jemand in Reichweite ist. Blind alle drei
    // Sekunden zu druecken war das Gegenteil von Koennen: der Angriff traf so
    // oder so den Fuehrenden, also griffen alle gleich gut an, und weil das
    // ausgerechnet den Besten traf, stand die Rangfolge auf dem Kopf. Jetzt
    // muss der Bot erkennen, dass jemand in Reichweite ist — und wie
    // zuverlaessig er das erkennt, ist seine Spielstaerke.
    const opfer = room.players
      .map((p) => arcade.players[p.id])
      .filter((p) => p && p !== player && !p.finishedAt
        && p.lane === player.lane
        && p.progress > player.progress
        && p.progress - player.progress <= RUNNER_ATTACK_RANGE)
      .sort((a, b) => a.progress - b.progress)[0];
    if (opfer && (player.attacksLeft ?? 0) > 0 && Math.random() > profile.mistake) {
      handleArcadeInput(room, bot, { action: "attack" });
    }

    // Die Bahn bewerten — und zwar BEIDE Abschnitte, den laufenden anteilig und
    // den naechsten ganz.
    //
    // Vorher zaehlte nur der naechste. Der Bot wechselte also fuer eine Bahn, die
    // erst gleich gut wird, und bezahlte dafuer den Rest des laufenden
    // Abschnitts — oft auf Sand. Gemessen kam dabei fuer ALLE drei Stufen ein
    // mittlerer Belag von 0.97 heraus, also schlechter als stur geradeaus
    // (1.00): die Tempobahn, um die sich das halbe Spiel dreht, nutzte niemand.
    // Ohne Angriffe liefen alle drei Stufen exakt gleich schnell ins Ziel, das
    // Spiel mass gar nichts mehr.
    //
    // Huerden wiegen nur noch leicht, seit man springen kann: sie kosten einen
    // Sprung, nicht den Abschnitt. Sie ganz auszuschliessen hat den Bot von
    // guten Tempobahnen ferngehalten.
    let wanted = player.lane;
    if (player.botRead) {
      const rest = clamp(((hier.at + RUNNER_SEG_LEN) - player.progress) / RUNNER_SEG_LEN, 0, 1);
      let best = -Infinity;
      [0, 1, 2].forEach((lane) => {
        if (Math.abs(lane - player.lane) > 1) return;
        const jetzt = RUNNER_SURFACE[hier.lanes[lane]] ?? 1;
        const dann = RUNNER_SURFACE[naechster.lanes[lane]] ?? 1;
        let wert = jetzt * rest + dann;
        if (hier.hurdle === lane && player.progress < hier.hurdleAt) wert -= 0.25;
        if (naechster.hurdle === lane) wert -= 0.25;
        wert -= Math.abs(lane - player.lane) * 0.04;
        if (wert > best) { best = wert; wanted = lane; }
      });
    }

    if (wanted !== player.lane) {
      handleArcadeInput(room, bot, { action: "lane", dir: wanted > player.lane ? 1 : -1 });
    }
    return;
  }
  if (arcade.family === "colorgrid") {
    if (player.eliminated) return;
    const now = Date.now();
    const profile = botProfile(player);
    const phase = colorGridPhaseAt(arcade, now - minigame.startedAt);
    if (phase.name !== "announce" || phase.round !== arcade.round) return;
    const roundElapsed = (now - minigame.startedAt) - phase.slot.start;
    if (roundElapsed < profile.reactionMs) return;
    const onTarget = arcade.grid[player.gy * COLORGRID_COLS + player.gx] === arcade.targetColor;
    if (onTarget) return;
    // Zögern wird EINMAL je Runde entschieden. Als Wurf je Tick summierte es sich
    // über die vielen Ticks einer Runde weg und war praktisch wirkungslos.
    if (player.botDitherRound !== arcade.round) {
      player.botDitherRound = arcade.round;
      player.botDithers = Math.random() < profile.mistake;
    }
    if (player.botDithers && roundElapsed < profile.reactionMs + 700) return;
    // Zum nächsten FREIEN sicheren Feld. Auf ein besetztes zuzulaufen hiess
    // vorher, davor stehen zu bleiben, bis der Boden fiel.
    const taken = new Set(Object.values(arcade.players)
      .filter((other) => other !== player && !other.eliminated)
      .map((other) => other.gy * COLORGRID_COLS + other.gx));
    let best = null;
    arcade.grid.forEach((color, index) => {
      if (color !== arcade.targetColor || taken.has(index)) return;
      const gx = index % COLORGRID_COLS;
      const gy = Math.floor(index / COLORGRID_COLS);
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

function syncArcadeScore(minigame, player, arcadePlayer) {
  const score = Math.max(0, Math.round(arcadePlayer.score));
  minigame.scores[player.id] = score;
  player.minigameScore = score;
}

function arcadeNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function emitMinigameUpdate(room) {
  if (!room.currentMinigame) return;
  io.to(room.code).emit("minigameUpdate", serializeMinigame(room.currentMinigame));
}

function emitRoom(room) {
  io.to(room.code).emit("state", serializeRoom(room));
}

function serializeRoom(room) {
  const match = room.match;
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    phase: room.phase,
    mode: room.mode,
    settings: room.settings,
    match: match ? {
      mode: match.mode,
      round: match.round,
      total: modes.totalRounds(match),
      target: match.target,
      upcoming: room.status === "minigame" ? null : modes.upcomingGame(match),
      matchPoint: modes.matchPoint(match, room.players),
      history: match.history
    } : null,
    standings: match ? modes.standings(match.mode, room.players) : [],
    minigameTitles: MINIGAMES.map((game) => ({ type: game.type, title: game.title })),
    devMode: room.devMode,
    hostConnected: room.players.some((player) => player.id === room.hostId && player.connected),
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      isHost: player.isHost,
      isBot: player.isBot,
      isLocalDev: player.isLocalDev,
      connected: player.connected,
      points: player.points || 0,
      wins: player.wins || 0,
      lives: player.lives || 0,
      out: Boolean(player.out),
      lastPlace: player.lastPlace,
      lastPoints: player.lastPoints || 0,
      sessionWins: player.sessionWins || 0,
      minigameScore: player.minigameScore
    })),
    currentMinigame: room.currentMinigame ? serializeMinigame(room.currentMinigame) : null,
    lastMinigameResult: room.lastMinigameResult,
    resultEndsAt: room.resultEndsAt,
    readyForNext: room.readyForNext || [],
    readyNeeded: humansInRoom(room).length,
    lastMessage: room.lastMessage,
    winnerIds: room.winnerIds,
    serverTime: Date.now()
  };
}

// Alles unter arcade.secret bleibt auf dem Server. Der ganze Arcade-Zustand
// geht sonst unverändert an jedes Gerät im Raum — für 28 der 30 Minispiele ist
// das richtig so, denn dort IST der Zustand das, was man ohnehin sieht.
//
// Spürsinn ist der erste Fall mit echtem Geheimnis: läge das Versteck im Paket,
// wäre das Spiel mit einem Blick in die Entwicklerkonsole erledigt.
//
// Augenmaß lässt sich so NICHT schützen, und das ist keine Nachlässigkeit: der
// Browser muss die Anzahl kennen, um den Schwarm überhaupt zu zeichnen. Wer die
// Zahl im Paket abliest statt zu schätzen, betrügt bei einem Spiel, das im
// selben Raum am selben Tisch gespielt wird — dagegen hilft kein Code.
function publicArcade(arcade) {
  if (!arcade) return arcade;
  // Farbenjagd: die Arbeitsliste des Feldes bleibt hier, die Geräte bekommen
  // es als Zeichenkette (arcade.paint).
  if (arcade.family === "paint") {
    const { cells, ...rest } = arcade;
    return rest;
  }
  if (!arcade.secret) return arcade;
  const { secret, ...rest } = arcade;
  return rest;
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
    arena: minigame.arena,
    arcade: publicArcade(minigame.arcade)
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
    }
  }
}

function findRoomForSocket(socket, code) {
  const normalized = normalizeCode(code || socket.data.roomCode);
  const room = rooms.get(normalized);
  if (!room) return null;
  return room;
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
    catchMultiplier,
    CATCH_JACKPOT_AT,
    cannonDistance,
    cannonPoints,
    cannonTri,
    WHACK_STUN_MS,
    startGame,
    finishMinigame,
    continueAfterResult,
    resetToLobby,
    clearRoomTimers,
    createPlayer,
    addBotTo,
    serializeRoom,
    updateCurling,
    CURLING_SHEET_Y,
    CURLING_STONE_RADIUS,
    updatePlinko,
    PLINKO_BALL_R,
    PLINKO_MAX_PLINKS,
    MINIGAMES,
    SEEK_SIZE,
    publicArcade,
    ESTIMATE_ROUNDS,
    ESTIMATE_BANDS,
    buildEstimateRounds,
    estimateRoundAt,
    estimateValue,
    seekSteps,
    seekGemFor,
    seekFindValue,
    arcadeRankingScore,
    beginMinigameFinale,
    humansInRoom,
    rankPlaces,
    bounceResultScore,
    minigameResultDetail,
    RUNNER_ATTACK_RANGE,
    RUNNER_ATTACKS_PER_RACE,
    createArcadeState,
    ARCADE_CONFIGS,
    handleArcadeInput,
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
    dareBarrelAt,
    dareRestingDistance,
    darePoints,
    DARE_START_M,
    DARE_ROUNDS,
    DARE_ROLL_MS,
    DARE_LEAD_IN_MS,
    DARE_SHOW_MS,
    runnerSegmentAt,
    runnerLaneFactor,
    advanceColorRound,
    colorGridPhaseAt,
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
    BARREL_LIMIT,
    BOMB_PASS_LOCK_MS,
    KNIFE_MIN_GAP_DEG,
    knifeLogAngle,
    knifeImpactAngle,
    setupKnifeStage,
    KNIFE_STAGES,
    KNIFE_CLASH_MS,
    STACK_BLOCKS,
    CLIMB_HEIGHT,
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
    GLIDE_STALL_MS,
    GLIDE_RINGS,
    GLIDE_SPEED,
    glideFallMs,
    buildGlideCourse,
    glideGroundX,
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
    PAINT_BRUSH,
    PAINT_BRUSH_WIDE,
    PAINT_BOMB_RADIUS,
    PAINT_ENCLOSE_MAX,
    PAINT_ROLLER_AHEAD,
    PAINT_TURN_RATE,
    PAINT_BUMP_COOLDOWN_MS,
    PAINT_BOOST_MS,
    PAINT_PICKUP_MAX,
    PAINT_DURATION_MS,
    paintIndex,
    paintInside,
    paintSweep,
    paintCells,
    paintPockets,
    paintOwnedCount
  }
};
