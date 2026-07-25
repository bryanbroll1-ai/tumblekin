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
  react: { icon: "👆⚡", label: "Blitzschnell tippen" }
};

export const MINIGAME_CATALOG = [
  { type: "bounceArena", title: "Bumper Bloom", gesture: "joystick", help: "Drängen, rammen, auf der Platte bleiben." },
  { type: "finishRush", title: "Zielgerade", family: "runner", gesture: "swipeSide", help: "Weiche Hürden aus, sammle Boosts und wirf Stachelkugeln auf die Läufer vor dir." },
  { type: "colorEscape", title: "Farbflucht", family: "colorgrid", gesture: "swipeAny", help: "Steh auf der angesagten Farbe, bevor der Boden wegbricht." },
  { type: "nervenprobe", title: "Nervenprobe", family: "stopclock", gesture: "tap", help: "Die Uhr versteckt sich nach 2 Sekunden. Drück den Knopf so nah wie möglich an der Zielzeit." },
  { type: "lichtwaechter", title: "Lichtwächter", family: "redlight", gesture: "hold", help: "Halte den Knopf, um zu laufen – aber stopp sofort, wenn der Wächter sich umdreht!" },
  { type: "ballonPump", title: "Pump-Panik", family: "pump", gesture: "taps", help: "Tippe so schnell du kannst! Jeder Tap pumpt deinen Ballon größer – der dickste Ballon gewinnt." },
  { type: "fassrolle", title: "Fassrolle", family: "barrel", gesture: "hold", help: "Das Riesenfass rollt immer schneller. Halte ◀ oder ▶ und lauf dagegen an – wer abrutscht, platscht ins Wasser." },
  { type: "zuendstoff", title: "Zündstoff", family: "bomb", gesture: "tap", help: "Die Zündzeit blinkt kurz auf – merk sie dir und gib die Bombe rechtzeitig weiter! Wer sie beim Knall hält, ist raus." },
  { type: "muenzregen", title: "Münzregen", family: "catchfall", gesture: "swipeSide", help: "Wechsle die Spur und fang die goldenen Münzen – aber weich den schwarzen Bomben aus!" },
  { type: "blobklopfe", title: "Blob-Klopfe", family: "whack", gesture: "tap", help: "Blobs poppen aus den Löchern – tipp ihr Feld, bevor sie abtauchen. Finger weg von den stacheligen!" },
  { type: "seilspringen", title: "Seilspringen", family: "wave", gesture: "tap", help: "Das Riesenseil wird immer schneller. Spring im richtigen Moment – einmal gestolpert und du bist raus." },
  { type: "kanonenflug", title: "Kanonenflug", family: "cannon", gesture: "taps", help: "Tipp 1 stoppt die Kraft, Tipp 2 den Abschusswinkel. Volle Power bei 45° fliegt am weitesten!" },
  { type: "messerwurf", title: "Messerwurf", family: "knife", gesture: "tap", help: "Wirf dein Messer in den drehenden Baumstamm – aber triff kein Messer der anderen, sonst bist du raus!" },
  { type: "turmbau", title: "Turmbau", family: "stack", gesture: "tap", help: "Tippe im richtigen Moment, um den gleitenden Block zu stapeln. Der höchste Turm gewinnt!" },
  { type: "bergsteiger", title: "Bergsteiger", family: "climb", gesture: "taps", help: "Tippe abwechselnd links und rechts, um die Wand hochzuklettern. Wer zuerst oben ist, gewinnt!" },
  { type: "schleuderschuss", title: "Schleuderschuss", family: "sling", gesture: "pull", help: "Zieh die Schleuder zurück und lass los. Länge = Kraft, Richtung = Winkel — und die Scheibe weicht nach jedem Schuss zurück!" },
  { type: "sumoschubs", title: "Sumo-Schubs", family: "sumo", gesture: "charge", help: "Halten lädt deinen Stoss auf, loslassen schubst den Stein weg. Aber lade nicht zu lange — dann rutschst du aus!" },
  { type: "trampolin", title: "Trampolin", family: "bounce", gesture: "rhythm", help: "Tippe genau im Takt, dann federst du höher. Treffer in Folge bauen Resonanz auf — und der Takt wird immer schneller!" },
  { type: "falschsignal", title: "Falschsignal", family: "feint", gesture: "react", help: "Nur der runde grüne Kreis, der BLEIBT, ist echt. Falsche Farbe, falsche Form und kurzes Aufblitzen kosten Punkte — schnell tippen bringt mehr, zu schnell bringt Minus." }
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
