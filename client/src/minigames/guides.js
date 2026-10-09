// Kurze Startkarten; die ausführlichen Regeln stehen weiterhin im Katalog.
export const GAME_CATEGORIES = [
  { id: "reaction", title: "Reaktion", icon: "⚡" },
  { id: "skill", title: "Geschick", icon: "🎯" },
  { id: "thinking", title: "Denken", icon: "🧠" },
  { id: "together", title: "Miteinander", icon: "🤝" }
];

const guide = (category, goal, tip) => ({ category, goal, tip });

// Stichentscheide stehen ausdrücklich in den Regeln. Auf der Ergebnistafel
// werden sie nur erläutert, wenn dieselbe Hauptzahl verschiedene Plätze ergibt.
export const MINIGAME_TIEBREAKERS = {
  bounceArena: "Wer länger oben bleibt, liegt vorn; danach zählen Rauswürfe, dann die Zeit auf der Insel.",
  colorEscape: "Bei gleichen überstandenen Runden gewinnt, wer insgesamt schneller auf der sicheren Farbe stand.",
  ballonPump: "Bei gleicher Zahl an Pumpstößen gewinnt, wer diese Zahl zuerst erreicht hat.",
  fassmut: "Bei gleichen Punkten entscheidet der dichteste einzelne Stopp.",
  seilspringen: "Bei gleicher Überlebensleistung entscheiden die genauer getimten Sprünge.",
  kanonenflug: "Bei gleichen Punkten entscheidet die kleinere gesamte Abweichung vom Ziel.",
  blobklopfe: "Bei gleichen Punkten entscheiden mehr Treffer.",
  messerwurf: "Bei gleichen Punkten gewinnt, wer nicht rausgeflogen ist.",
  turmbau: "Bei gleicher Turmhöhe entscheiden mehr perfekte Stapel.",
  ballonfahrt: "Bei gleichen Punkten entscheidet die kleinere gesamte Abweichung von den Zielmitten.",
  trampolin: "Bei gleicher angezeigter Höhe entscheidet die längste Trefferfolge.",
  sortierband: "Bei gleichen Punkten entscheidet, wer die Teile im Mittel früher einsortiert hat.",
  leuchtfolge: "Bei gleich vielen richtigen Folgen entscheiden weniger Fehler, danach das schnellere Nachtippen.",
  blitzreflex: "Bei gleicher Bestzeit entscheidet die gesamte Reaktionszeit aller Versuche.",
  nagelbrett: "Bei gleichen Punkten entscheiden mehr erfolgreiche Kugeln.",
  eisstock: "Bei gleichen gerundeten Punkten entscheidet die genauere Lage der Steine.",
  spuersinn: "Bei gleichen Punkten entscheiden weniger Suchversuche.",
  augenmass: "Bei gleichen Punkten entscheidet die kleinere gesamte Schätzabweichung.",
  grimassen: "Bei gleichen Punkten entscheidet die kleinere gesamte Abweichung vom Vorbild.",
  flaggenhoch: "Bei gleich vielen richtigen Befehlen entscheidet, wer noch dabei ist, danach die schnellere Reaktion.",
  honigwabe: "Es zählen die Äpfel daheim; bei Gleichstand das meiste Gold, dann die wenigsten Stiche.",
  schneeball: "Wer gleich lange oben war, den ordnen die Rauswürfe.",
  buecherwurm: "Bei gleich vielen Seiten entscheidet, wer noch dabei ist, dann das schnellere Erreichen sicherer Löcher.",
  schnappschuss: "Bei gleichen Punkten entscheiden mehr Titelbilder, danach mehr Fotos im Bildausschnitt.",
  kippboot: "Bei gleichen Punkten entscheiden weniger gekenterte Boote.",
  rohrsalat: "Bei gleichen Punkten entscheiden mehr richtige Ventile."
};

export const MINIGAME_GUIDES = {
  bounceArena: guide("together", "Ramm die anderen von der Insel. Wer reinfällt, ist raus.", "Nur der Stick: Kurven bauen Schwung auf, Anlauf rammt stärker, Loslassen bremst. Am Ende schrumpft die Insel."),
  finishRush: guide("skill", "120 Meter gegen die anderen auf vier Spuren: ← → Spur wechseln, ↑ springen, ↓ sliden.", "Auf dem Spielfeld halten sprintet; Loslassen lädt Ausdauer. Kisten umfahren, orange überspringen, unter Blau sliden."),
  colorEscape: guide("reaction", "Wisch auf die angesagte Farbe, bevor die anderen Felder wegbrechen.", "Farbe und Form gehören zusammen: ● Pink, ▲ Blau, ■ Gelb, ✚ Grün. Ein Sturz beendet dein Spiel."),
  nervenprobe: guide("thinking", "Stoppe deine unsichtbare Uhr möglichst genau bei der Zielzeit.", "Nach zwei Sekunden verschwindet die Uhr. Zähl im Kopf weiter."),
  lichtwaechter: guide("reaction", "Halte zum Laufen. Erreiche das Tor vor den anderen.", "Bei Gelb loslassen: Bewegung bei Rot wirft dich zurück."),
  ballonPump: guide("reaction", "Tippe möglichst schnell. Der größte Ballon gewinnt.", "Du kannst mit zwei Fingern abwechselnd tippen."),
  fassmut: guide("reaction", "Stoppe das fallende Fass mit einem Tipp möglichst dicht über deinem Kopf.", "Schweres Fass rutscht weiter nach! Der Schatten zeigt sich nur am Anfang."),
  fassrolle: guide("together", "Halte links oder rechts und bleib oben im grünen Streifen des Fasses.", "Lauf gegen Drehung und Wellen. Im Wildwasser ist ein Sturz endgültig."),
  zuendstoff: guide("together", "Merk dir die Zündzeit und tippe, um die Bombe rechtzeitig weiterzugeben.", "Gefangen hast du immer kurz Zeit. ÜBERZEIT heißt: sofort weiter! Wer sie beim Knall hält, ist raus."),
  muenzregen: guide("skill", "Wechsle per Wisch die Spur: fang Münzen und vermeide Bomben.", "Fänge in Folge vervielfachen Punkte. Achte am Ende auf die Schatzspur."),
  blobklopfe: guide("reaction", "Tippe die auftauchenden Blobs. Schnelle Treffer bringen mehr Punkte.", "Gold bringt fünf Punkte. Die dunkelroten Stachelblobs kosten Punkte."),
  seilspringen: guide("reaction", "Tippe zum Springen, wenn das Seil unter dir durchgeht.", "Bei DOPPELT kommen zwei Sprünge kurz nacheinander. Ein Fehler und du bist raus."),
  kanonenflug: guide("skill", "Tipp 1 stoppt die Kraft, Tipp 2 den Winkel. Triff mit drei Schüssen die Flagge.", "Der Ring zeigt die Landung ohne Wind. Schau auf den Windsack."),
  messerwurf: guide("reaction", "Wirf per Tipp alle Messer in den drehenden Stamm.", "Triff kein steckendes Messer — ein Klirren und du bist raus."),
  turmbau: guide("skill", "Tippe, um den gleitenden Block auf deinem Turm zu stapeln.", "Überstände fallen ab. Ganz daneben beendet deinen Bauversuch; die Etagen bleiben gewertet."),
  bergsteiger: guide("reaction", "Tippe auf die Bildhälfte mit dem leuchtenden Griff. Erreiche den Gipfel zuerst.", "Die falsche Seite kostet den Griff. Schau auf die nächste Hand."),
  ballonfahrt: guide("skill", "Halte zum Steigen, lass zum Sinken los. Wirf Sandsäcke auf die Ziele.", "Der Sack fliegt beim Fallen weiter. Aus großer Höhe musst du früher werfen."),
  trampolin: guide("reaction", "Tippe im Takt und springe möglichst hoch.", "Jeder Schlag zählt: Auslassen bricht die Serie. Deine beste Höhe bleibt gespeichert."),
  falschsignal: guide("reaction", "Tippe bei echten Ringen möglichst früh und sammle Punkte.", "Nur Ringe bis zur Randmarke sind echt. Frühe Tipps sind riskanter."),
  spurmaler: guide("skill", "Schau zu, wie der Stift die Figur zeichnet, und fahr sie dann mit dem Finger nach.", "Triff möglichst die ganze Figur und mal nicht daneben — bis 100 Punkte je Figur."),
  sortierband: guide("reaction", "Wisch jedes Teil in die passende Rutsche: links, unten oder rechts.", "Die Schilder wechseln Plätze. Richtige Serien bringen Zusatzpunkte."),
  angelduell: guide("skill", "Halte, um Fische einzuholen. Lass los, wenn die Schnur zu stark gespannt ist.", "Bei einem Schub zieht der Fisch kräftiger. Eine gerissene Schnur kostet Fang."),
  leuchtfolge: guide("thinking", "Merk dir die leuchtenden Pilze und tippe die Folge nach.", "Tippe auf die Pilze oder die Farbknöpfe. Erst nach der Vorführung zählen deine Tipps."),
  blitzreflex: guide("reaction", "Tippe erst bei Grün. Deine schnellste Reaktion aus drei Versuchen zählt.", "Ein Tipp vor Grün ist ein Fehlstart und macht den Versuch ungültig."),
  nagelbrett: guide("skill", "Lass fünf Kugeln per Tipp fallen und sammle Punkte in den Töpfen.", "Jede fallende Kugel hat einen Stups: links oder rechts tippen. Gold bringt +15."),
  eisstock: guide("skill", "Wisch drei Steine möglichst nahe an den Knopf in der Mitte.", "Ein längerer Wisch gibt mehr Kraft. Deine Steine können fremde wegschieben."),
  tiefenrausch: guide("skill", "Tauch mit dem Stick nach Gold und bring es zur Oberfläche.", "Die weiße Luftmarke zeigt den Rückweg. Ohne Luft verlierst du getragenes Gold."),
  farbenjagd: guide("together", "Steuere deine Walze mit dem Stick. Die größte Farbfläche gewinnt.", "Übermal die anderen! Auf eigener Farbe fährst du schneller."),
  spuersinn: guide("thinking", "Tippe Felder an und finde mit den Entfernungszahlen das Versteck.", "Gezählt werden Schritte nach oben, unten, links und rechts. Weniger Tipps geben mehr Punkte."),
  augenmass: guide("thinking", "Schau, wie viele Tiere herumschwirren, und zieh den Regler auf deine Schätzung.", "Die Tiere sind nur ein paar Sekunden zu sehen. Je näher deine Zahl, desto mehr Punkte."),
  tauziehen: guide("together", "Zieh mit deinem Team am Seil — das schnellere Team gewinnt.", "Tippen, tippen, tippen: jeder Tipp zieht gleich stark. Eine Runde, fünfzehn Sekunden."),
  grimassen: guide("thinking", "Zieh die sechs gelben Punkte, bis dein Blockkopf dasselbe Gefühl zeigt wie das Vorbild.", "Nach zehneinhalb Sekunden wird verglichen. Drei Gesichter bringen Punkte."),
  flaggenhoch: guide("reaction", "Tippe die gezeigten Flaggen nach, wenn der Käpt'n es befiehlt.", "Nur bei „Käpt'n sagt:“ reagieren! Ohne diese Worte stillhalten."),
  honigwabe: guide("thinking", "Alle wählen gleichzeitig: weiter pflücken oder mit dem Korb heim.", "Das zweite Nest einer Sorte sticht alle am Baum. Wer allein heimgeht, bekommt den Restkorb und das Gold."),
  schneeball: guide("together", "Roll deine Schneekugel gross und stoss die anderen vom Gipfel.", "Grosse Kugel = harter Stoss. SCHWUNG für den Antritt. Achtung, der Rand bröckelt!"),
  luftpuck: guide("together", "Zieh deinen Schläger mit dem Finger gegen den Puck. Schieß fünf Tore mit deinem Team.", "Dein eigenes Tor hat deine Teamfarbe. Bleib in deiner leuchtenden Zone."),
  buecherwurm: guide("skill", "Stell dich mit dem Stick in ein Loch, bevor die Buchseite herunterfällt.", "Jede Seite hat andere Lochformen; der Schatten zeigt sie. Einmal platt, und du bist raus."),
  schnappschuss: guide("together", "Steh beim Blitz im Bildausschnitt. In der Mitte gibt es Extrapunkte.", "Mit SCHUBS kannst du andere aus dem Foto drängen."),
  kippboot: guide("skill", "Tippe in deinem Zug, um den Passagier ins Boot fallen zu lassen.", "Außen gibt es mehr Punkte. Grün ist sicher; Kentern kostet 30 Punkte."),
  rohrsalat: guide("thinking", "Finde das Ventil, dessen Rohr zur Schatztruhe führt, und tippe es an.", "Bieg an jedem Querrohr ab. Folge dem Weg von der Truhe nach oben.")
};
