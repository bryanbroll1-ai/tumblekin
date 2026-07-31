export const GESTURES = {
  tap: { icon: "👆", label: "Tippen" },
  taps: { icon: "👆👆", label: "Schnell tippen" },
  joystick: { icon: "🕹️", label: "Stick ziehen" },
  drag: { icon: "👆↔️", label: "Horizontal ziehen" },
  swipeUp: { icon: "👆⬆️", label: "Nach oben wischen" },
  swipeSide: { icon: "👆↔️", label: "Links/Rechts wischen" },
  swipeAny: { icon: "👆✳️", label: "In jede Richtung wischen" },
  hold: { icon: "👆⏺️", label: "Knopf gedrückt halten" },
  pull: { icon: "👆🎯", label: "Ziehen und loslassen" },
  charge: { icon: "👆💪", label: "Halten und loslassen" },
  rhythm: { icon: "👆🎵", label: "Im Takt tippen" },
  react: { icon: "👆⚡", label: "Blitzschnell tippen" },
  trace: { icon: "👆〰️", label: "Finger auf der Spur führen" },
  belt: { icon: "👆↔️", label: "Ins Fach wischen" },
  memory: { icon: "👆🧠", label: "Folge nachtippen" },
  aim: { icon: "👆🎯", label: "Tippen und stupsen" },
  slide: { icon: "👆➡️", label: "Nach vorne wischen" },
  fish: { icon: "👆🎣", label: "Halten und im Schub loslassen" }
};

export const MINIGAME_CATALOG = [
  { type: "bounceArena", title: "Bumper Bloom", gesture: "joystick", help: "Drängen, rammen, auf der Platte bleiben." },
  { type: "finishRush", title: "Zielgerade", family: "runner", gesture: "swipeSide", help: "Wisch nach links oder rechts, um die Bahn zu wechseln. Weich den Hürden aus, sammle Boosts — und wenn du eine Stachelkugel hast, tippe, um sie auf die Läufer vor dir zu werfen." },
  { type: "colorEscape", title: "Farbflucht", family: "colorgrid", gesture: "swipeAny", help: "Wisch in die Richtung, in der die angesagte Farbe liegt, und steh darauf, bevor der Boden wegbricht." },
  { type: "nervenprobe", title: "Nervenprobe", family: "stopclock", gesture: "tap", help: "Die Uhr versteckt sich nach 2 Sekunden. Drück den Knopf so nah wie möglich an der Zielzeit." },
  { type: "lichtwaechter", title: "Lichtwächter", family: "redlight", gesture: "hold", help: "Halte den Knopf, um zu laufen – aber stopp sofort, wenn der Wächter sich umdreht!" },
  { type: "ballonPump", title: "Pump-Panik", family: "pump", gesture: "taps", help: "Tippe so schnell du kannst! Jeder Tap pumpt deinen Ballon größer – der dickste Ballon gewinnt." },
  { type: "fassrolle", title: "Fassrolle", family: "barrel", gesture: "hold", help: "Das Riesenfass rollt immer schneller. Halte ◀ oder ▶ und lauf dagegen an – wer abrutscht, platscht ins Wasser." },
  { type: "zuendstoff", title: "Zündstoff", family: "bomb", gesture: "tap", help: "Die Zündzeit blinkt kurz auf – merk sie dir und gib die Bombe rechtzeitig weiter! Wer sie beim Knall hält, ist raus." },
  { type: "muenzregen", title: "Münzregen", family: "catchfall", gesture: "swipeSide", help: "Wisch nach links oder rechts, um die Spur zu wechseln. Fang die goldenen Münzen und weich den schwarzen Bomben aus." },
  { type: "blobklopfe", title: "Blob-Klopfe", family: "whack", gesture: "tap", help: "Blobs poppen aus den Löchern – tipp ihr Feld, bevor sie abtauchen. Finger weg von den stacheligen!" },
  { type: "seilspringen", title: "Seilspringen", family: "wave", gesture: "tap", help: "Das Riesenseil wird immer schneller. Spring im richtigen Moment – einmal gestolpert und du bist raus." },
  { type: "kanonenflug", title: "Kanonenflug", family: "cannon", gesture: "taps", help: "Tipp 1 stoppt die Kraft, Tipp 2 den Abschusswinkel. Volle Power bei 45° fliegt am weitesten!" },
  { type: "messerwurf", title: "Messerwurf", family: "knife", gesture: "tap", help: "Drei Runden, je ein Wurf in den drehenden Baumstamm. Je enger die Lücke, desto mehr zählt der Treffer – aber zweimal auf ein fremdes Messer und du bist raus!" },
  { type: "turmbau", title: "Turmbau", family: "stack", gesture: "tap", help: "Tippe im richtigen Moment, um den gleitenden Block zu stapeln. Der höchste Turm gewinnt!" },
  { type: "bergsteiger", title: "Bergsteiger", family: "climb", gesture: "taps", help: "Tippe abwechselnd auf die linke und die rechte Bildhälfte — jede Seite ist eine Hand. Die falsche Seite kostet den Griff. Wer am höchsten kommt, gewinnt." },
  { type: "ballonfahrt", title: "Ballonfahrt", family: "glide", gesture: "hold", help: "Halte den Finger auf dem Bild, dann steigt dein Ballon — loslassen lässt ihn sinken. Flieg durch die Tore, mittig durch bringt mehr, und Boden oder Decke schalten den Brenner kurz ab." },
  { type: "sumoschubs", title: "Sumo-Schubs", family: "sumo", gesture: "charge", help: "Halten lädt deinen Schlag auf — halten kostet nichts, es ist deine Deckung. Loslassen schlägt den Stein aber NUR, wenn er schon in deinem Viertel ist; daneben holst du ins Leere aus und stehst kurz ungedeckt da. Am meisten Wucht hat ein Konter gegen den heranrollenden Stein." },
  { type: "trampolin", title: "Trampolin", family: "bounce", gesture: "rhythm", help: "Tippe genau im Takt, dann federst du höher. Treffer in Folge bauen Resonanz auf — und der Takt wird immer schneller!" },
  { type: "falschsignal", title: "Falschsignal", family: "feint", gesture: "react", help: "Aus der Linse wächst ein Ring nach aussen. Nur wer die Marke am Rand erreicht, ist echt — die anderen bleiben unterwegs stehen. Je kleiner der Ring beim Tippen, desto mehr Punkte: früh tippen ist geraten, spät tippen ist sicher und billig." },
  { type: "spurmaler", title: "Spurmaler", family: "trace", gesture: "trace", help: "Zieh den Finger auf der Spur nach oben und mal sie aus. Das Band wird zwischendurch eng — dort zählt jeder Millimeter. Die Kristalle liegen am Bandrand: wer sie mitnimmt, muss nicht nur drinbleiben, sondern zielen. Verlässt du das Band, reisst der Strich ab." },
  { type: "sortierband", title: "Sortierband", family: "belt", gesture: "belt", help: "Wisch jedes Paket in die Rutsche mit seiner Farbe — links, unten oder rechts. Die Rutschen tauschen zwischendurch die Farben, also nicht auswendig lernen, sondern hinschauen. Eine Serie ohne Fehler bringt Zusatzpunkte." },
  { type: "angelduell", title: "Angelduell", family: "fish", gesture: "fish", help: "Halten holt den Fisch ein und spannt die Schnur. Wenn er zieht, steigt die Spannung viel schneller — dann loslassen, sonst reisst sie. Vier Arten beissen: die Sprotte kommt leicht und bringt wenig, der Wels bringt fünfmal so viel und zieht so hart, dass ein Moment Unachtsamkeit die Schnur kostet." },
  { type: "leuchtfolge", title: "Leuchtfolge", family: "simon", gesture: "memory", help: "Vier Pilze leuchten der Reihe nach auf — tippe sie danach in derselben Reihenfolge an. Jede Runde kommt ein Pilz dazu. Ein Fehler beendet nur die laufende Runde, die nächste zählt wieder." },
  { type: "blitzreflex", title: "Blitzreflex", family: "react", gesture: "react", help: "Drei Läufe an der Startampel. Tippe irgendwo auf den Bildschirm, sobald sie auf Grün springt — aber nicht vorher: ein Fehlstart kostet mehr als jede langsame Reaktion. Die kürzeste Gesamtzeit gewinnt." },
  { type: "nagelbrett", title: "Nagelbrett", family: "plinko", gesture: "aim", help: "Tippe oben, wo die Kugel fallen soll — die Mitte ist am meisten wert. Während sie fällt, hast du GENAU einen Stups: tippe links oder rechts, um sie noch einmal zu lenken." },
  { type: "eisstock", title: "Eisstock", family: "curling", gesture: "slide", help: "Wisch nach vorne, um einen Stein zu schieben — je länger der Wisch, desto weiter fliegt er. Drei Steine pro Person, je näher an der Mitte, desto mehr Punkte. Fremde Steine wegrempeln ist erlaubt." },
  { type: "farbenjagd", title: "Farbenjagd", family: "paint", gesture: "joystick", help: "Färbe die Fläche in deiner Farbe — fremde Felder darfst du übermalen, das bringt dir eins und nimmt dem anderen eins. Rempeln erlaubt, und die breite Rolle färbt fünf Felder auf einmal." }
];

export const ARCADE_TYPES = new Set(
  MINIGAME_CATALOG.filter((game) => game.family).map((game) => game.type)
);

export function minigameMeta(type) {
  return MINIGAME_CATALOG.find((game) => game.type === type) || null;
}

export function gestureMeta(type) {
  const meta = minigameMeta(type);
  return GESTURES[meta?.gesture] || GESTURES.tap;
}
