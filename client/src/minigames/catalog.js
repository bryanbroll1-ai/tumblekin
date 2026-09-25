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
  { type: "bounceArena", title: "Bumper Pool", gesture: "joystick", help: "Lenk deinen Schwimmring mit dem Stick und ramm die anderen von der Badeinsel ins Becken. Wer reinfällt, paddelt zurück — oben bleiben bringt Punkte, rausschubsen noch mehr." },
  { type: "finishRush", title: "Zielgerade", family: "runner", gesture: "swipeAny", help: "Wisch nach links oder rechts in die schnelle Bahn: grüne Felder mit Pfeilen sind Boost, Matsch bremst. Tippen springt über Hürden. Nach unten wischen wirft etwas auf den, der in DEINER Bahn dicht vor dir läuft — du hast drei Würfe." },
  { type: "colorEscape", title: "Farbflucht", family: "colorgrid", gesture: "swipeAny", help: "Eine Farbe wird angesagt — wisch dich Feld für Feld auf ein Feld dieser Farbe, bevor der Rest wegbricht. Jede Runde gibt es weniger Zeit und weniger sichere Felder; wer fällt, ist raus." },
  { type: "nervenprobe", title: "Nervenprobe", family: "stopclock", gesture: "tap", help: "Die Zielzeit liegt zwischen 4 und 8 Sekunden. Nach 2 Sekunden verschwindet jede Uhr — zähl im Kopf weiter und drück so nah wie möglich an der Zielzeit." },
  { type: "lichtwaechter", title: "Lichtwächter", family: "redlight", gesture: "hold", help: "Halte den Knopf, um zu laufen – aber stopp sofort, wenn der Wächter sich umdreht!" },
  { type: "ballonPump", title: "Pump-Panik", family: "pump", gesture: "taps", help: "Tippe so schnell du kannst! Jeder Tap pumpt deinen Ballon größer – der dickste Ballon gewinnt." },
  { type: "fassmut", title: "Fassmut", family: "daredevil", gesture: "tap", help: "Über dir hängt ein Fass am Seil. Irgendwann wird es losgelassen und fällt — EIN Tipp spannt das Seil und fängt es ab. Wer es am dichtesten über dem Kopf zum Stehen bringt, gewinnt. Zu spät gezogen gibt eine Beule." },
  { type: "fassrolle", title: "Fassrolle", family: "barrel", gesture: "hold", help: "Alle stehen auf einem Riesenfass über dem Fluss. Halte ◀ oder ▶ und lauf gegen die Drehung an — aber wer läuft, dreht das Fass auch unter den anderen. So rollst du sie ins Wasser, musst dann aber selbst mithalten. Gezählt wird die Zeit im grünen Streifen oben." },
  { type: "zuendstoff", title: "Zündstoff", family: "bomb", gesture: "tap", help: "Die Zündzeit blinkt kurz auf – merk sie dir und gib die Bombe rechtzeitig weiter! Wer sie beim Knall hält, ist raus." },
  { type: "muenzregen", title: "Münzregen", family: "catchfall", gesture: "swipeSide", help: "Wisch nach links oder rechts, um die Spur zu wechseln. Fang Münzen und weich den Bomben aus — fünf Fänge in Folge verdoppeln jede Münze, zehn verdreifachen sie. Am Ende kommt der Goldrausch, und eine Schatztruhe fällt in die angesagte Spur." },
  { type: "blobklopfe", title: "Blob-Klopfe", family: "whack", gesture: "tap", help: "Blobs poppen aus den Löchern – tipp ihr Feld, bevor sie abtauchen. Finger weg von den stacheligen: wer einen erwischt, verliert einen Treffer und ist kurz benommen." },
  { type: "seilspringen", title: "Seilspringen", family: "wave", gesture: "tap", help: "Die zwei Dreher schwingen das Riesenseil, und es wird immer schneller. Tipp, wenn es unter dir durchgeht — du bist nur kurz in der Luft. Achtung bei DOPPELT: dann kommt es zweimal kurz hintereinander. Einmal hängen geblieben und du bist raus." },
  { type: "kanonenflug", title: "Kanonenflug", family: "cannon", gesture: "taps", help: "Tipp 1 stoppt die Kraft, Tipp 2 den Winkel. Triff die Zielflagge — sie steht jede Runde woanders, und der Windsack zeigt, ob Wind dich weiter trägt oder bremst. Beim Winkel zeigt ein Ring, wo du ohne Wind landen würdest." },
  { type: "messerwurf", title: "Messerwurf", family: "knife", gesture: "tap", help: "Dein Stamm dreht sich — jeder Tipp wirft ein Messer hinein. Triff kein steckendes Messer! Sind alle Messer drin, zerbricht der Stamm und der nächste kommt, jeder dreht sich anders. Äpfel bringen Extrapunkte, ein Klirren kostet den Stamm." },
  { type: "turmbau", title: "Turmbau", family: "stack", gesture: "tap", help: "Tippe im richtigen Moment, um den gleitenden Block zu stapeln. Der höchste Turm gewinnt!" },
  { type: "bergsteiger", title: "Bergsteiger", family: "climb", gesture: "taps", help: "Tippe auf die Bildhälfte, auf der der nächste Griff leuchtet — jede Seite ist eine Hand, die falsche kostet den Griff. Der Gipfel liegt auf 70: wer am schnellsten oben ist, gewinnt. Wer nicht ankommt, zählt nach Höhe." },
  { type: "ballonfahrt", title: "Ballonfahrt", family: "glide", gesture: "hold", help: "Halte den Finger auf dem Bild, dann heizt der Brenner und du steigst — loslassen lässt sinken. Mit ABWURF fällt ein Sandsack: er fliegt mit, während er fällt, also je höher, desto früher werfen. Triff die Zielscheiben auf den Feldern und sammle unterwegs Sterne." },
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
