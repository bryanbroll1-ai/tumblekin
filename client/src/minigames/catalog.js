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
  greed: { icon: "👆⛏️", label: "Graben oder aufhören" },
  deduce: { icon: "👆🧭", label: "Felder antippen und schliessen" },
  estimate: { icon: "👆📏", label: "Regler auf die Schätzung ziehen" },
  fish: { icon: "👆🎣", label: "Halten und im Schub loslassen" }
};

export const MINIGAME_CATALOG = [
  { type: "bounceArena", title: "Bumper Bloom", gesture: "joystick", help: "Drängen, rammen, auf der Platte bleiben." },
  { type: "finishRush", title: "Zielgerade", family: "runner", gesture: "swipeAny", help: "Weiche Hürden aus (Hoch wischen zum Springen) und wechsle die Bahn (Links/Rechts wischen). Tippe oder wische nach unten, um Spieler vor dir mit einem Angriff stolpern zu lassen!" },
  { type: "colorEscape", title: "Farbflucht", family: "colorgrid", gesture: "swipeAny", help: "Wisch in die Richtung, in der die angesagte Farbe liegt, und steh darauf, bevor der Boden wegbricht." },
  { type: "nervenprobe", title: "Nervenprobe", family: "stopclock", gesture: "tap", help: "Die Uhr versteckt sich nach 2 Sekunden. Drück den Knopf so nah wie möglich an der Zielzeit." },
  { type: "lichtwaechter", title: "Lichtwächter", family: "redlight", gesture: "hold", help: "Halte den Knopf, um zu laufen – aber stopp sofort, wenn der Wächter sich umdreht!" },
  { type: "ballonPump", title: "Pump-Panik", family: "pump", gesture: "taps", help: "Tippe so schnell du kannst! Jeder Tap pumpt deinen Ballon größer – der dickste Ballon gewinnt." },
  { type: "fassmut", title: "Fassmut", family: "daredevil", gesture: "taps", help: "Ein Fass rollt auf dich zu und wird dabei immer schneller. EIN Tap bremst es. Wer es am dichtesten vor der roten Linie zum Stehen bringt, gewinnt — wer zu spät bremst, wird überrollt." },
  { type: "fassrolle", title: "Fassrolle", family: "barrel", gesture: "hold", help: "Das Riesenfass rollt immer schneller. Halte ◀ oder ▶ und lauf dagegen an. Gezählt wird die Zeit im grünen Streifen OBEN — am Rand bist du sicher, verdienst aber nichts. Wer abrutscht, platscht ins Wasser." },
  { type: "zuendstoff", title: "Zündstoff", family: "bomb", gesture: "tap", help: "Die Zündzeit blinkt kurz auf – merk sie dir und gib die Bombe rechtzeitig weiter! Wer sie beim Knall hält, ist raus." },
  { type: "muenzregen", title: "Münzregen", family: "catchfall", gesture: "swipeSide", help: "Wisch nach links oder rechts, um die Spur zu wechseln. Fang die goldenen Münzen und weich den schwarzen Bomben aus." },
  { type: "blobklopfe", title: "Blob-Klopfe", family: "whack", gesture: "tap", help: "Blobs poppen aus den Löchern – tipp ihr Feld, bevor sie abtauchen. Finger weg von den stacheligen!" },
  { type: "seilspringen", title: "Seilspringen", family: "wave", gesture: "tap", help: "Das Riesenseil wird immer schneller. Spring im richtigen Moment – einmal gestolpert und du bist raus." },
  { type: "kanonenflug", title: "Kanonenflug", family: "cannon", gesture: "taps", help: "Tipp 1 stoppt die Kraft, Tipp 2 den Abschusswinkel. Volle Power bei 45° fliegt am weitesten!" },
  { type: "messerwurf", title: "Messerwurf", family: "knife", gesture: "tap", help: "Reihum je ein Wurf in den drehenden Stamm. Wirf dahin, wo am meisten Platz ist – wer knapp neben ein fremdes Messer setzt, hat Glück gehabt, nicht gut gezielt. Zweimal dagegen und du bist raus. Der Stamm wird jede Runde schneller." },
  { type: "turmbau", title: "Turmbau", family: "stack", gesture: "tap", help: "Tippe im richtigen Moment, um den gleitenden Block zu stapeln. Der höchste Turm gewinnt!" },
  { type: "bergsteiger", title: "Bergsteiger", family: "climb", gesture: "taps", help: "Tippe abwechselnd auf die linke und die rechte Bildhälfte — jede Seite ist eine Hand. Die falsche Seite kostet den Griff. Wer am höchsten kommt, gewinnt." },
  { type: "ballonfahrt", title: "Ballonfahrt", family: "glide", gesture: "hold", help: "Halte den Finger auf dem Bild, dann steigt dein Ballon — loslassen lässt ihn sinken. Flieg durch die Tore, mittig durch bringt mehr, und Boden oder Decke schalten den Brenner kurz ab." },
  { type: "sumoschubs", title: "Sumo-Schubs", family: "sumo", gesture: "charge", help: "Halten lädt deinen Schlag auf — halten kostet nichts, es ist deine Deckung. Loslassen schlägt den Stein aber NUR, wenn er schon in deinem Viertel ist; daneben holst du ins Leere aus und stehst kurz ungedeckt da. Am meisten Wucht hat ein Konter gegen den heranrollenden Stein." },
  { type: "trampolin", title: "Trampolin", family: "bounce", gesture: "rhythm", help: "Tippe genau im Takt, dann federst du höher. Treffer in Folge bauen Resonanz auf — und der Takt wird immer schneller!" },
  { type: "falschsignal", title: "Falschsignal", family: "feint", gesture: "react", help: "Aus der Linse wächst ein Ring nach aussen. Nur wer die Marke am Rand erreicht, ist echt — die anderen bleiben unterwegs stehen. Je kleiner der Ring beim Tippen, desto mehr Punkte: früh tippen ist geraten, spät tippen ist sicher und billig." },
  { type: "spurmaler", title: "Spurmaler", family: "trace", gesture: "trace", help: "Zieh den Finger auf der Spur nach oben und mal sie aus. Das Band wird zwischendurch eng — dort zählt jeder Millimeter. Die Kristalle liegen am Bandrand: wer sie mitnimmt, muss nicht nur drinbleiben, sondern zielen. Verlässt du das Band, reisst der Strich ab." },
  { type: "sortierband", title: "Sortierband", family: "belt", gesture: "belt", help: "Wisch jedes Paket in die Rutsche mit seiner Farbe — links, unten oder rechts. Die Rutschen tauschen zwischendurch die Farben, also nicht auswendig lernen, sondern hinschauen. Eine Serie ohne Fehler bringt Zusatzpunkte." },
  { type: "angelduell", title: "Angelduell", family: "fish", gesture: "fish", help: "Halten holt den Fisch ein und spannt die Schnur. Wenn er zieht, steigt die Spannung viel schneller — dann loslassen, sonst reisst sie. Vier Arten beissen: die Sprotte kommt leicht und bringt wenig, der Wels bringt fünfmal so viel und zieht so hart, dass ein Moment Unachtsamkeit die Schnur kostet." },
  { type: "leuchtfolge", title: "Leuchtfolge", family: "simon", gesture: "memory", help: "Vier Pilze stehen bereit. Eine Folge leuchtet auf — tippe sie danach in derselben Reihenfolge nach. Sie fängt bei zwei an und wird jede Runde einen länger. Ein Fehler beendet nur die laufende Runde, die nächste zählt wieder." },
  { type: "blitzreflex", title: "Blitzreflex", family: "react", gesture: "react", help: "Drei Läufe an der Startampel. Tippe irgendwo auf den Bildschirm, sobald sie auf Grün springt — aber nicht vorher: ein Fehlstart kostet mehr als jede langsame Reaktion. Die kürzeste Gesamtzeit gewinnt." },
  { type: "nagelbrett", title: "Nagelbrett", family: "plinko", gesture: "aim", help: "Tippe oben, wo die Kugel fallen soll — die Mitte ist am meisten wert. Während sie fällt, hast du GENAU einen Stups: tippe links oder rechts, um sie noch einmal zu lenken." },
  { type: "eisstock", title: "Eisstock", family: "curling", gesture: "slide", help: "Wisch nach vorne, um einen Stein zu schieben — je länger der Wisch, desto weiter fliegt er. Drei Steine, aber immer nur einer unterwegs: der nächste geht erst, wenn deiner liegt. Gezählt wird der Abstand zum Knopf, stufenlos — jeder Zentimeter näher ist mehr wert. Steine prallen nicht ab, sie schieben sich: du kannst jemanden vom Knopf drängen, aber niemand wird quer durchs Haus geschossen." },
  { type: "tiefenrausch", title: "Tiefenrausch", family: "dive", gesture: "greed", help: "Tippen gräbt eine Stufe tiefer und bringt Gold — aber jeder Stollen kann einstürzen, und dann ist alles weg, was noch unten hängt. Das Risiko der nächsten Stufe steht genau im Bild. Wisch nach oben, um deine Beute sicher einzuzahlen." },
  { type: "farbenjagd", title: "Farbenjagd", family: "paint", gesture: "joystick", help: "Färbe die Fläche in deiner Farbe — fremde Felder darfst du übermalen, das bringt dir eins und nimmt dem anderen eins. Rempeln erlaubt, und die breite Rolle färbt fünf Felder auf einmal." },
  { type: "spuersinn", title: "Spürsinn", family: "seek", gesture: "deduce", help: "Irgendwo im Feld liegt ein Fundstück. Tippe ein Feld an, und die Zahl darauf sagt, wie viele Schritte es von dort bis zum Versteck sind — hoch, runter, links, rechts gezählt. Zwei Zahlen zusammengenommen grenzen es schon stark ein. Je weniger Tipps ein Fund kostet, desto mehr ist er wert." },
  { type: "augenmass", title: "Augenmaß", family: "estimate", gesture: "estimate", help: "Ein Schwarm Glühkäfer blitzt anderthalb Sekunden auf — dann sind sie weg und du schätzt, wie viele es waren. Zieh den Regler auf deine Zahl. Vier Durchgänge, und der Schwarm wird jedes Mal grösser: zählen klappt am Anfang noch, später nicht mehr. Je näher an der echten Zahl, desto mehr Punkte." }
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
