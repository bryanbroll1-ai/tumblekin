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
  trace: { icon: "↔️〰️", label: "Wischen zum Lenken" },
  belt: { icon: "👆↔️", label: "Ins Fach wischen" },
  memory: { icon: "👆🧠", label: "Folge nachtippen" },
  aim: { icon: "👆🎯", label: "Tippen und stupsen" },
  slide: { icon: "👆➡️", label: "Nach vorne wischen" },
  deduce: { icon: "👆🧭", label: "Felder antippen und schliessen" },
  estimate: { icon: "👆📏", label: "Regler auf die Schätzung ziehen" },
  fish: { icon: "👆🎣", label: "Halten und im Schub loslassen" },
  sculpt: { icon: "👆🙂", label: "Gesicht zurechtziehen" }
};

export const MINIGAME_CATALOG = [
  { type: "bounceArena", title: "Bumper Pool", gesture: "joystick", help: "Lenk deinen Schwimmring mit dem Stick und ramm die anderen von der Badeinsel ins Becken. Jeder hat drei Leben: wer reinfällt, springt nach kurzer Pause zurück, beim dritten Mal ist er raus. In den letzten 15 Sekunden schrumpft die Insel. Gewertet werden übrige Leben, dann Rauswürfe." },
  { type: "finishRush", title: "Zielgerade", family: "runner", gesture: "swipeAny", help: "Wisch nach links oder rechts in die schnelle Bahn: grüne Felder mit Pfeilen sind Boost, Matsch bremst. Tippen springt über Hürden — in der Luft bist du etwas langsamer, also nur, wenn es nötig ist. Lauf durch eine gelbe Kiste, dann hast du eine Wasserbombe: sie zielt von selbst auf den Nächsten vor dir, der Knopf wirft sie. Zielt jemand auf dich, warnt dich die Anzeige — abspringen oder die Bahn wechseln, dann platzt sie neben dir." },
  { type: "colorEscape", title: "Farbflucht", family: "colorgrid", gesture: "swipeAny", help: "Eine Farbe wird angesagt — wisch dich Feld für Feld auf ein Feld dieser Farbe, bevor der Rest wegbricht. Jede Runde gibt es weniger Zeit und weniger sichere Felder; wer fällt, ist raus." },
  { type: "nervenprobe", title: "Nervenprobe", family: "stopclock", gesture: "tap", help: "Die Zielzeit liegt zwischen 4 und 8 Sekunden. Nach 2 Sekunden verschwindet jede Uhr — zähl im Kopf weiter und drück so nah wie möglich an der Zielzeit." },
  { type: "lichtwaechter", title: "Lichtwächter", family: "redlight", gesture: "hold", help: "Halte den Knopf, um zu laufen. Wenn die Lampe gelb blinkt, dreht sich der Wächter um — lass bis dahin los. Wer bei Rot noch läuft, fliegt fünf Meter zurück und ist kurz benommen. Manchmal täuscht er nur an. Wer zuerst am Tor ist, gewinnt." },
  { type: "ballonPump", title: "Pump-Panik", family: "pump", gesture: "tap", help: "Tipp auf PUMPEN, so schnell du kannst — jeder Tipp pumpt deinen Ballon ein Stück dicker. Wer am Ende am meisten gepumpt hat, bringt seinen Ballon zum Platzen und gewinnt." },
  { type: "fassmut", title: "Fassmut", family: "daredevil", gesture: "tap", help: "Über dir hängt ein Fass am Seil. Irgendwann wird es losgelassen und fällt — EIN Tipp spannt das Seil, doch das Fass rutscht noch ein Stück nach. Der Schatten zeigt, wo es stehen bliebe: zieh, wenn er im Grünen dicht über deinem Kopf ist. Wer es am dichtesten über dem Kopf stoppt, gewinnt — zu spät gezogen gibt eine Beule." },
  { type: "fassrolle", title: "Fassrolle", family: "barrel", gesture: "hold", help: "Alle stehen auf einem Riesenfass über dem Fluss. Halte ◀ oder ▶ und lauf gegen die Drehung an — aber wer läuft, dreht das Fass auch unter den anderen. Wellen kündigen sich an: lauf ihnen entgegen. Wer fällt, schwimmt zurück — doch in den letzten 12 Sekunden kommt das Wildwasser, und wer dann fällt, ist raus. Unter den Übrigen zählt die Zeit im grünen Streifen oben." },
  { type: "zuendstoff", title: "Zündstoff", family: "bomb", gesture: "tap", help: "Die Zündzeit blinkt kurz auf – merk sie dir und gib die Bombe rechtzeitig weiter! Wer sie beim Knall hält, ist raus." },
  { type: "muenzregen", title: "Münzregen", family: "catchfall", gesture: "swipeSide", help: "Wisch nach links oder rechts, um die Spur zu wechseln. Fang Münzen und weich den Bomben aus — fünf Fänge in Folge verdoppeln jede Münze, zehn verdreifachen sie. Am Ende kommt der Goldrausch, und eine Schatztruhe fällt in die angesagte Spur." },
  { type: "blobklopfe", title: "Blob-Klopfe", family: "whack", gesture: "tap", help: "Blobs poppen aus den Löchern — tipp drauf, bevor sie abtauchen. Je schneller, desto mehr: 3, 2 oder 1 Punkt, der goldene bringt 5. Finger weg von den dunkelroten mit Stachelkrone: zwei Punkte weg und kurz benommen." },
  { type: "seilspringen", title: "Seilspringen", family: "wave", gesture: "tap", help: "Die zwei Dreher schwingen das Riesenseil, und es wird immer schneller. Tipp, wenn es unter dir durchgeht — du bist nur kurz in der Luft. Achtung bei DOPPELT: dann kommt es zweimal kurz hintereinander. Einmal hängen geblieben und du bist raus." },
  { type: "kanonenflug", title: "Kanonenflug", family: "cannon", gesture: "taps", help: "Tipp 1 stoppt die Kraft, Tipp 2 den Winkel. Triff die Zielflagge — sie steht jede Runde woanders, und der Windsack zeigt, ob Wind dich weiter trägt oder bremst. Beim Winkel zeigt ein Ring, wo du ohne Wind landen würdest." },
  { type: "messerwurf", title: "Messerwurf", family: "knife", gesture: "tap", help: "Dein Stamm dreht sich — jeder Tipp wirft ein Messer hinein. Triff kein steckendes Messer! Sind alle Messer drin, zerbricht der Stamm und der nächste kommt, jeder dreht sich anders. Äpfel bringen Extrapunkte, ein Klirren kostet den Stamm." },
  { type: "turmbau", title: "Turmbau", family: "stack", gesture: "tap", help: "Tippe im richtigen Moment, um den gleitenden Block zu stapeln. Der höchste Turm gewinnt!" },
  { type: "bergsteiger", title: "Bergsteiger", family: "climb", gesture: "taps", help: "Tippe auf die Bildhälfte, auf der der nächste Griff leuchtet — jede Seite ist eine Hand, die falsche kostet den Griff. Der Gipfel liegt auf 70: wer am schnellsten oben ist, gewinnt. Wer nicht ankommt, zählt nach Höhe." },
  { type: "ballonfahrt", title: "Ballonfahrt", family: "glide", gesture: "hold", help: "Halte den Finger auf dem Bild, dann heizt der Brenner und du steigst — loslassen lässt sinken. Mit ABWURF fällt ein Sandsack: er fliegt mit, während er fällt, also je höher, desto früher werfen. Triff die Zielscheiben auf den Feldern und sammle unterwegs Sterne." },
  { type: "trampolin", title: "Trampolin", family: "bounce", gesture: "rhythm", help: "Tippe genau im Takt, dann federst du höher. Treffer in Folge bauen Resonanz auf — und der Takt wird immer schneller!" },
  { type: "falschsignal", title: "Falschsignal", family: "feint", gesture: "react", help: "Aus der Linse wächst ein Ring nach aussen. Nur wer die Marke am Rand erreicht, ist echt — die anderen bleiben unterwegs stehen. Je kleiner der Ring beim Tippen, desto mehr Punkte: früh tippen ist geraten, spät tippen ist sicher und billig." },
  { type: "spurmaler", title: "Spurmaler", family: "trace", gesture: "trace", help: "Dein Farbroller fährt von selbst die Spur hinauf — du lenkst ihn, indem du irgendwo auf dem Bildschirm nach links oder rechts wischst. Jeder Abschnitt zählt: genau in der Mitte ist perfekt, im Band gut, daneben nichts. Bleib auf der Linie, dann steigt deine Serie auf ×2 und ×3. Die Kristalle am Bandrand bringen Extrapunkte, aber wer zu weit ausschert, verliert die Serie. Jede Runde wird etwas schneller." },
  { type: "sortierband", title: "Sortierband", family: "belt", gesture: "belt", help: "Obst, Müll oder Spielzeug? Wisch jedes Teil vom Band in die passende Rutsche — links, unten oder rechts. Die Schilder tauschen zwischendurch die Plätze, also hinschauen statt auswendig lernen, und Vorsicht bei Verwechslern wie Orange und Basketball. Anfangs läuft das Band gemächlich, dann immer schneller. Eine Serie ohne Fehler bringt Zusatzpunkte." },
  { type: "angelduell", title: "Angelduell", family: "fish", gesture: "fish", help: "Halten holt den Fisch ein und spannt die Schnur. Wenn er zieht, steigt die Spannung viel schneller — dann loslassen, sonst reisst sie: der Fisch ist weg, und ein Viertel seines Wertes geht obendrein vom Fang ab. Vier Arten beissen: die Sprotte kommt leicht und bringt wenig, der Wels bringt fünfmal so viel und zieht so hart, dass ein Moment Unachtsamkeit die Schnur kostet." },
  { type: "leuchtfolge", title: "Leuchtfolge", family: "simon", gesture: "memory", help: "Vier Pilze stehen bereit. Eine Folge leuchtet auf — tippe sie danach in derselben Reihenfolge nach. Sie fängt bei zwei an und wird jede Runde einen länger. Ein Fehler beendet nur die laufende Runde, die nächste zählt wieder." },
  { type: "blitzreflex", title: "Blitzreflex", family: "react", gesture: "react", help: "Drei Versuche an der Startampel. Tippe irgendwo auf den Bildschirm, sobald sie auf Grün springt — aber nicht vorher: ein Fehlstart macht den Versuch ungültig. Gewertet wird deine BESTE Reaktion: die schnellste Einzelzeit gewinnt." },
  { type: "nagelbrett", title: "Nagelbrett", family: "plinko", gesture: "aim", help: "Du hast fünf Kugeln. Tippe oben, wo eine fallen soll — unten zählt der Topf. Der goldene Jackpot-Topf wandert hin und her und bringt +15: denk voraus, wo er steht, wenn deine Kugel ankommt. Während sie fällt, hast du GENAU einen Stups: tippe links oder rechts, um sie noch einmal zu lenken." },
  { type: "eisstock", title: "Eisstock", family: "curling", gesture: "slide", help: "Wisch nach vorne, um einen Stein zu schieben: die Richtung deines Wischs ist die Richtung auf dem Eis, und je länger der Wisch, desto weiter gleitet er — Pfeil und Balken zeigen es schon beim Ziehen. Drei Steine, aber immer nur einer unterwegs: der nächste geht erst, wenn deiner liegt. Gezählt wird der Abstand zum Knopf, stufenlos — jeder Zentimeter näher ist mehr wert. Steine prallen nicht ab, sie schieben sich: du kannst jemanden vom Knopf drängen, aber niemand wird quer durchs Haus geschossen." },
  { type: "tiefenrausch", title: "Tiefenrausch", family: "dive", gesture: "joystick", help: "Tauch mit dem Stick nach Gold — je tiefer, desto wertvoller, ganz unten wartet eine Truhe. Die Luft wird knapp, und zwar unten schneller: Tauch rechtzeitig auf, dann füllt sie sich wieder und dein Gold ist sicher eingezahlt. Quallen kosten Luft und etwas Gold. Geht dir die Luft aus, ist alles weg, was du trägst." },
  { type: "farbenjagd", title: "Farbenjagd", family: "paint", gesture: "joystick", help: "Schieb deine Farbwalze mit dem Stick über die Leinwand — was sie überrollt, hat sofort deine Farbe, auch fremde. Auf deiner eigenen Farbe fährst du schneller, auf fremder langsamer — bau dir Bahnen und übermal die anderen. Goldene Walze = breiter malen, Farbbombe = großer Klecks. Wer am Ende die meiste Fläche hat, gewinnt." },
  { type: "spuersinn", title: "Spürsinn", family: "seek", gesture: "deduce", help: "Irgendwo im Feld liegt ein Fundstück. Tippe ein Feld an, und die Zahl darauf sagt, wie viele Schritte es von dort bis zum Versteck sind — hoch, runter, links, rechts gezählt. Zwei Zahlen zusammengenommen grenzen es schon stark ein. Je weniger Tipps ein Fund kostet, desto mehr ist er wert." },
  { type: "augenmass", title: "Augenmaß", family: "estimate", gesture: "estimate", help: "Ein Schwarm Glühkäfer blitzt anderthalb Sekunden auf — dann sind sie weg und du schätzt, wie viele es waren. Zieh den Regler auf deine Zahl. Vier Durchgänge, und der Schwarm wird jedes Mal grösser: zählen klappt am Anfang noch, später nicht mehr. Je näher an der echten Zahl, desto mehr Punkte." },
  { type: "tauziehen", title: "Tauziehen", family: "tug", gesture: "taps", help: "Zwei Teams, ein Seil, dazwischen die Schlammgrube. Jeder Tipp zieht — aber jeder Zug kostet Griffkraft (der Balken im Knopf). Wer wild hämmert, rutscht ab und schenkt den anderen einen Ruck; im ruhigen Takt zieht man am längsten mit voller Kraft. Zieht ihr fast gleichzeitig, gibt es ein HAU-RUCK. Wer zuerst zwei Runden holt, gewinnt — die anderen landen im Schlamm." },
  { type: "grimassen", title: "Grimassen", family: "face", gesture: "sculpt", help: "Oben hängt ein verzogenes Gesicht, vor dir eine Gummimaske. Zieh die sechs gelben Punkte — Brauen, Nase, Mundwinkel, Kinn —, bis deine Maske genauso aussieht. Nach neun Sekunden wird verglichen: je näher jeder Punkt am Vorbild liegt, desto mehr Punkte. Drei Gesichter, jedes schiefer als das vorige." }
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
