# Tumblekin

Tumblekin ist ein mobile-first Partyspiel für bis zu vier Spieler im gleichen WLAN — nur Minispiele, kein Brett. Gespielt wird in 40 touch-optimierten Challenges, jede zwischen 12 und 46 Sekunden lang: als Marathon, Punktejagd, K.O.-Runde oder einzeln.

## Start

```bash
npm install
npm start
```

Alternativ:

```bash
pnpm install
pnpm start
```

Danach `http://localhost:3000` öffnen. Der Server zeigt zusätzlich die passende WLAN-Adresse für Smartphones an.

## Auf Smartphones spielen

Schritt für Schritt inklusive des Wegs ohne Rechner (GitHub Codespaces):
**[TESTEN-AUF-DEM-HANDY.md](TESTEN-AUF-DEM-HANDY.md)**

1. Rechner und Smartphones mit demselben WLAN verbinden.
2. Auf einem Gerät eine Party starten.
3. Den QR-Code scannen oder die WLAN-Adresse plus Raumcode verwenden.
4. Der Host wählt einen Modus und tippt auf **Los geht's**.
5. Vor jedem Spiel zeigt die Startkarte Bild, Steuerung und Ziel. **Tipp & Regeln** klappt Tipp und ausführliche Hilfe auf; ab dem zweiten Spiel steht dort auch der eigene Punktestand. Erst wenn alle verbundenen Menschen **Bereit!** tippen, beginnt der gemeinsame Countdown; Bots blockieren die Lesepause nicht. Wer das Handy weglegt, hält trotzdem niemanden fest: nach 60 Sekunden beginnt die Runde mit allen, die letzten 30 Sekunden zählt die Karte sichtbar herunter.

Die Spielauswahl lässt sich nach **Reaktion**, **Geschick**, **Denken** und **Miteinander** filtern und nach Namen durchsuchen. Bei einer eigenen Auswahl fügt **Sichtbare wählen** die gefilterten Spiele hinzu, ohne die übrige Auswahl zu löschen.

Alle 40 Spiele zeigen ihre tatsächliche Spielansicht in der Auswahl und auf der Startkarte. In jedem der 40 Spiele lässt sich vor **Bereit!** mit **Steuerung ausprobieren** ein eigener Versuch starten. **Neu** setzt ihn zurück, **Fertig** oder Escape kehrt zur Startkarte zurück. Die Übung verwendet dieselben Regeln und Szenen wie die Partie; Punkte und Bereitstatus der Partie bleiben unverändert. Ihre Zeit läuft erst nach dem Szenenaufbau und einem kurzen Countdown.

Eine Partie braucht mindestens zwei Teilnehmer. Wer allein ist, holt sich mit **+ Bot** Mitspieler dazu — die Bots spielen jedes Minispiel mit, in drei Stärken. In der Lobby steht vorn nur die Einstellung, die den Modus ausmacht (Anzahl, Ziel oder Leben); Spielauswahl und Bot-Stärke liegen unter **⚙ Mehr**, mit einer Zeile, die sagt, was gerade gilt. Dort stellt der Host unter **Bots** auf einem farbigen Regler ein, wie stark sie spielen: *Einfach* (grün), *Mittel* (gelb), *Schwer* (rot) oder *Zufall* (jeder Bot würfelt je Minispiel neu); darüber steht, was die Stufe bedeutet. Tippen, Ziehen und die Pfeiltasten stellen ihn um. Dass die stärkere Stufe in jedem Minispiel tatsächlich häufiger gewinnt, misst `npm run bot-sim` nach.

Bei einem kurzen WLAN-Hänger oder Reload stellt der Client die laufende Sitzung automatisch wieder her. Es gibt bewusst keine Host-Migration: Bleibt der Host offline, werden Host-Aktionen gesperrt und alle Spieler sehen eine Fehlermeldung.

## Die Modi

Nach jedem Minispiel gibt es Punkte nach Platz: der Letzte bekommt 0, jeder Platz darüber einen mehr — bei vier Spielern 3/2/1/0. Wer gleichauf liegt, teilt sich den besseren Platz. Wo zwei oft auf dieselbe Zahl kommen (überstandene Runden, Seiten, Wellen), entscheidet darunter eine Feinwertung — wer schneller in Sicherheit war, genauer gesprungen ist oder flinker nachgetippt hat. Sie steht klein hinter der Zahl auf der Ergebnistafel, damit man sieht, warum zwei gleiche Zahlen auf verschiedenen Plätzen landen.

- **🏃 Marathon:** 5, 10 oder 15 Minispiele. Die meisten Punkte gewinnen, bei Gleichstand die meisten Siege.
- **🎯 Punktejagd:** Wer als Erster allein die Zielpunktzahl erreicht, gewinnt — 4 Punkte je Gegner, bei vier Spielern also 12. Springen zwei gleichzeitig darüber, geht es weiter bis einer vorn liegt.
- **💥 K.O.:** Jeder startet mit 2, 3 oder 5 Leben. Nach jedem Spiel verliert, wer unter den Verbliebenen Letzter wurde, eines; liegen alle gleichauf, niemand. Ausgeschiedene spielen weiter mit, zählen aber nicht mehr — niemand sitzt am Handy und schaut nur zu.
- **🎮 Ein Spiel:** Ein Minispiel, ausgewählt oder zufällig, danach zurück in die Lobby.

Für Marathon, Punktejagd und K.O. lässt sich der Spielvorrat einschränken (mindestens zwei Spiele). Innerhalb eines Durchgangs durch den Vorrat kommt kein Spiel doppelt, und nie dasselbe zweimal hintereinander. Punktejagd und K.O. haben Notbremsen nach 30 bzw. 40 Spielen; dass sie praktisch nie greifen, misst `npm run match-sim` nach.

Zwischen den Spielen zeigt die Ergebnistafel die Plätze von hinten nach vorn und wechselt danach von selbst zum Zwischenstand (beide über **Dieses Spiel** / **Gesamtstand** umschaltbar), dazu das nächste Spiel; auf der Bühne dahinter stehen die Figuren auf dem Podest. Am Ende gibt es eine Siegerehrung mit Revanche auf Knopfdruck.

## Die Figuren und die Kamera

Die Tumblekin haben ein Gerüst — Hüfte, Rumpf, Kopf, zwei Arme, zwei Beine — und ein Gesicht mit Blick, Lidern, Brauen und sieben Mündern. Bewegung ist in Posen beschrieben, zwischen denen überblendet wird; die Arme können eine eigene Handlung spielen, während die Beine weiterlaufen. In jedem Minispiel tun die Figuren, was der Spieler tut: pumpen, kurbeln, klettern, graben, werfen, angeln, schieben — statt daneben zu hüpfen.

Alle 40 Spiele teilen sich ein Kamera-Rig. Es bekommt keine Koordinaten, sondern eine Beschreibung — worauf geschaut wird, wie gross das Motiv ist, aus welchem Winkel — und rahmt in das Band, das Punkteleiste und Knöpfe frei lassen, im Hoch- wie im Querformat. Dazu kommen einheitlich ein Anflug im Countdown, eine Sicherung, die weglaufende Figuren ins Bild zurückholt, Schütteln mit Abklingen und eine Fahrt auf den Sieger in den letzten Sekunden.

## 40 Orte

Jedes Spiel hat seinen eigenen Ort — keiner kommt zweimal vor, und in jeder Kulisse bewegt sich etwas: Fahnen wehen, Rauch steigt, Lichterketten laufen, Enten treiben vorbei.

- Bumper Pool — gekachelte Badeinsel, Kurvenmarkierungen, Palmen und Liegen
- Zielgerade — Laufbahn im Stadion mit Tribünen
- Farbflucht — Farbfest mit Pulverwolken
- Nervenprobe — Fernsehstudio mit Publikum und Kamera
- Lichtwächter — Schlossgarten mit Formschnitt, Statuen und Springbrunnen
- Pump-Panik — Geburtstagsfeier im Garten mit Torte und Geschenken
- Fassmut — Holzhof vor dem Fasslager
- Fassrolle — Wildbach mit Wasserfall, Felsen und Enten
- Zündstoff — Zeltlager am Lagerfeuer
- Münzregen — Goldmine mit Stollen, Lore und Dynamit
- Blob-Klopfe — Gemüsegarten mit Vogelscheuche
- Seilspringen — Schulhof mit Hüpfkästchen und Basketballkorb
- Kanonenflug — Burghof mit Türmen und Ritterzelten
- Messerwurf — Holzfällerlager mit Blockhütte
- Turmbau — Baustelle mit schwenkendem Kran
- Bergsteiger — verschneite Felswand mit Eiszapfen und Adler
- Ballonfahrt — Bauernland mit Dörfern, Kühen und Bergkette
- Trampolin — Zirkuswiese mit Manege und Zirkuszelt
- Falschsignal — Weltraumbahnhof in der Dämmerung
- Spurmaler — Maleratelier
- Sortierband — Lagerhalle mit Hochregalen und Gabelstapler
- Angelduell — See mit Steg und Schilf
- Leuchtfolge — Zauberwald mit Pilzring und Glühlichtern
- Blitzreflex — Rennstrecke an der Startampel
- Nagelbrett — Pachinko-Stand auf einem japanischen Sommerfest
- Eisstock — Weihnachtsmarkt mit Buden und Schneefall
- Tiefenrausch — Tauchschacht mit Quallen
- Farbenjagd — Graffiti-Hinterhof
- Spürsinn — Grabungsstätte bei Laternenlicht
- Augenmaß — Sommernacht mit Glühwürmchen
- Tauziehen — Dorffest mit Schlammgrube
- Grimassen — Jahrmarktbude
- Flaggen hoch — Segelschiff auf See
- Honigwabe — Bienengarten unter einem Apfelbaum
- Schneeballhang — Gipfel mit Hütte und Tannen
- Luftpuck — Neon-Spielhalle mit Discokugel
- Bücherwurm — Riesenbuch auf dem Schreibtisch
- Schnappschuss — Premiere auf dem roten Teppich
- Kippboot — Südsee-Lagune mit Kranbrücke
- Rohrsalat — Heizungskeller mit Dampfkessel

## 40 Challenges

Alle Challenges sind auf einen Blick verständlich, dauern höchstens eine
Dreiviertelminute und setzen auf Physik plus weiches Audio-Feedback (ASMR-Pops, Plinks
und Klacks über Web Audio). Jede läuft als eigene Three.js-Szene mit den
gemeinsamen Figuren.

Diese Liste stammt Wort für Wort aus `client/src/minigames/catalog.js` — dieselbe
Kurzhilfe, die im Spiel auf der Startkarte steht. Sie von Hand nachzuführen ging
dreimal schief: erst standen hier zwei längst gelöschte Minispiele und drei neue
fehlten, danach blieben bei drei Spielen die Hilfetexte und bei zweien die
Gestengruppe auf einem alten Stand stehen. Ein Test vergleicht den Abschnitt
darum Zeichen für Zeichen mit dem Katalog — Gruppen, Reihenfolge und Texte.

### 🕹️ Stick ziehen

- **Bumper Pool:** Nur der Stick: Lenken, Anlauf nehmen und rammen. Loslassen bremst. Fahr eine gleichmäßige Kurve, um Schwung aufzubauen: Du wirst schneller und rammst kräftiger. Schnelles Hin-und-her-Wackeln lädt ihn nicht. Schubs die anderen von der Badeinsel ins Becken. Der Rand hält niemanden — wer selbst darüber fährt, fällt auch. Wer reinfällt, ist raus und schaut den anderen zu. In den letzten 15 Sekunden schrumpft die Insel. Wer am längsten oben bleibt, gewinnt; danach zählen die Rauswürfe.
- **Tiefenrausch:** Tauch mit dem Stick nach Gold — je tiefer, desto wertvoller, ganz unten wartet eine Truhe. Die Luft wird knapp, und zwar unten schneller: Die weisse Marke im Luftbalken zeigt, was der Weg nach oben kostet — kommt die Luft ihr nahe, tauch auf. Oben füllt sie sich wieder, und dein Gold ist sicher eingezahlt. Quallen kosten Luft und etwas Gold. Geht dir die Luft aus, ist alles weg, was du trägst.
- **Farbenjagd:** Leg den Finger irgendwo aufs Spielfeld und zieh: so lenkst du deine Farbwalze über die Leinwand — was sie überrollt, hat sofort deine Farbe, auch fremde. Auf deiner eigenen Farbe fährst du schneller, auf fremder langsamer — bau dir Bahnen und übermal die anderen. Goldene Walze = breiter malen, Farbbombe = riesiger Klecks vor dir. Jede Farbe trägt ihr Zeichen auf den Kacheln — deins steht oben im Balken. Wer am Ende die meiste Fläche hat, gewinnt.
- **Luftpuck:** Airhockey in der Neonhalle, zwei gegen zwei. Du stehst auf einer Schwebescheibe und bleibst in deiner Hälfte — im Zweierteam in deiner Zone: Sturm vorn, Abwehr hinten (sie leuchtet auf dem Tisch). Lenk die Scheibe mit dem Stick gegen den Puck. Von hinten angelaufen schiesst du am härtesten. Dein Tor ist das in deiner Teamfarbe. Wer zuerst fünf Tore hat, gewinnt — sonst zählt der Stand am Ende.
- **Bücherwurm:** Ihr steht auf der Seite eines Riesenbuchs. Hinten klappt die nächste Seite hoch und fällt nach vorn — in ihr sind Löcher. Ihr Schatten zeigt, wo sie landen: stell dich rechtzeitig in ein Loch, sonst wirst du platt gedrückt und bist raus. Die Löcher werden weniger und kleiner, und man darf sich gegenseitig hinausschubsen. Gezählt werden die überstandenen Seiten.

### 👆 Wischen · halten sprintet

- **Zielgerade:** 100 Meter gegen die anderen auf drei gemeinsamen Spuren. Wische links/rechts zum Spurwechsel, hoch zum Springen und runter zum Sliden; runter in der Luft zieht dich schnell zum Boden. Hohe Kisten umfahren, orange Hürden überspringen, blaue Tore unterrutschen. Halte auf dem Spielfeld für Sprint: Die Ausdauer geht leer; erst Loslassen lädt sie am Boden wieder auf. Treffer kosten Tempo, du bleibst im Rennen. Alle haben dieselben Hindernisse. Die schnellste Zielzeit gewinnt; gleiche Hundertstel teilen den Platz.

### 👆✳️ In jede Richtung wischen

- **Farbflucht:** Eine Farbe samt Form wird angesagt: Pink ●, Blau ▲, Gelb ■, Grün ✚. Wisch dich Feld für Feld auf ein Feld dieser Farbe, bevor der Rest wegbricht. Jede Runde gibt es weniger Zeit und weniger sichere Felder; wer fällt, ist raus.

### 👆 Tippen

- **Nervenprobe:** Die Zielzeit liegt zwischen 4 und 8 Sekunden. Nach 2 Sekunden verschwindet jede Uhr — zähl im Kopf weiter und drück so nah wie möglich an der Zielzeit.
- **Fassmut:** Über dir hängt ein Fass am Seil. Irgendwann wird es losgelassen und fällt — EIN Tipp spannt das Seil, doch das Fass rutscht noch ein Stück nach. Wie weit, hängt vom Fass ab: das leichte Holzfass bremst schnell, das schwere Eisenfass rutscht weit. Der Schatten zeigt den Haltepunkt nur am Anfang, dann musst du schätzen. Wer es am dichtesten über dem Kopf stoppt, gewinnt — zu spät gezogen gibt eine Beule.
- **Zündstoff:** Die Zündzeit blinkt kurz auf – merk sie dir und gib die Bombe rechtzeitig weiter! Wer sie fängt, hat immer eine kurze Schonfrist; ist die Zündschnur dann schon runter, heißt es ÜBERZEIT: sofort weiter damit. Wer sie beim Knall hält, ist raus – zu zweit erst beim zweiten Treffer.
- **Blob-Klopfe:** Blobs poppen aus den Löchern — tipp drauf, bevor sie abtauchen. Je schneller, desto mehr: 3, 2 oder 1 Punkt, der goldene bringt 5. Finger weg von den dunkelroten mit Stachelkrone: zwei Punkte weg und kurz benommen.
- **Seilspringen:** Die zwei Dreher schwingen das Riesenseil, und es wird immer schneller. Tipp, wenn es unter dir durchgeht — du bist nur kurz in der Luft. Achtung bei DOPPELT: dann kommt es zweimal kurz hintereinander. Einmal hängen geblieben und du bist raus.
- **Kanonenflug:** Tipp 1 stoppt die Kraft, Tipp 2 den Winkel. Drei Schuss: triff die Zielflagge — sie steht jeden Schuss woanders, und der Windsack zeigt, ob Wind dich weiter trägt oder bremst. Beim Winkel zeigt ein Ring, wo du ohne Wind landen würdest. Die Punkte aller drei zählen zusammen.
- **Messerwurf:** Dein Stamm dreht sich — jeder Tipp wirft ein Messer hinein. Triff kein steckendes Messer, sonst bist du raus (deine Punkte bleiben)! Sind alle Messer drin, zerbricht der Stamm und der nächste kommt — jeder dreht sich anders, manche ruckartig mit Stopps und Umkehr, der fünfte ist ein Boss. Äpfel bringen Extrapunkte.
- **Turmbau:** Tippe, um den gleitenden Block auf deinem Turm zu stapeln. Ein perfekter Treffer rastet ein; Überstände werden abgeschnitten und fallen herunter. Verfehlst du den Turm ganz, endet dein Bauversuch — die geschafften Etagen zählen weiter. Der höchste Turm gewinnt!
- **Kippboot:** Über dem Ruderboot fährt ein Kran hin und her, am Haken hängt ein Passagier. Bist du dran, tippst du, und er plumpst dorthin, wo er gerade hängt. Weiter aussen gibt es mehr Punkte (bis dreifach), aber das Boot neigt sich stärker: der Streifen an der Bordwand zeigt, wo er sicher landet (grün) und wo das Boot kentern würde (rot). Wer es zum Kentern bringt, verliert 30 Punkte. Gespielt wird in Runden — jeder ist einmal dran, alle mit demselben Tier, vom Küken bis zum Schwein. Ist das Boot voll, legt es ab, und alle, die mitgeladen haben, bekommen etwas dazu.

### 👆⏺️ Knopf gedrückt halten

- **Lichtwächter:** Halte den Knopf, um zu laufen. Wenn die Lampe gelb blinkt, dreht sich der Wächter um — lass bis dahin los. Wer bei Rot noch läuft, fliegt fünf Meter zurück und ist kurz benommen. Manchmal täuscht er nur an. Wer zuerst am Tor ist, gewinnt.
- **Fassrolle:** Alle stehen auf einem Riesenfass über dem Fluss. Halte ◀ oder ▶ und lauf gegen die Drehung an — aber wer läuft, dreht das Fass auch unter den anderen. Wellen kündigen sich an: lauf ihnen entgegen. Wer fällt, schwimmt zurück — doch in den letzten 12 Sekunden kommt das Wildwasser, und wer dann fällt, ist raus. Unter den Übrigen zählt die Zeit im grünen Streifen oben.

### 👆👆 Schnell tippen

- **Pump-Panik:** Tippe so schnell du kannst, gern mit zwei Fingern — jeder Tipp pumpt deinen Ballon dicker. Wer am Ende am meisten gepumpt hat, lässt seinen Ballon platzen und gewinnt.
- **Bergsteiger:** Tippe auf die Bildhälfte, auf der der nächste Griff leuchtet — jede Seite ist eine Hand, die falsche kostet den Griff. Der Gipfel liegt auf 70: wer am schnellsten oben ist, gewinnt. Wer nicht ankommt, zählt nach Höhe.
- **Tauziehen:** Zwei Teams, ein Seil, dazwischen die Schlammgrube. Tippe, so schnell du kannst — jeder Tipp zieht. Das Team, das schneller tippt, zieht die anderen über die Linie in den Schlamm. Eine Runde, fünfzehn Sekunden: wer dann vorn liegt, gewinnt.

### 👆↔️ Links/Rechts wischen

- **Münzregen:** Wisch nach links oder rechts, um die Spur zu wechseln. Aus der Mine fliegen Münzen und Bomben, der Kreis in der Spur zeigt, wo sie landen. Fang Münzen und weich den Bomben aus — fünf Fänge in Folge verdoppeln jede Münze, zehn verdreifachen sie. Am Ende kommt der Goldrausch, und eine Schatztruhe fällt in die angesagte Spur.

### 👆⏺️ Bild halten · Knopf abwerfen

- **Ballonfahrt:** Halte den Finger auf dem Bild, dann heizt der Brenner und du steigst — loslassen lässt sinken. Mit ABWURF fällt ein Sandsack: er fliegt mit, während er fällt, also je höher, desto früher werfen. Triff die Zielscheiben auf den Feldern und sammle unterwegs Sterne.

### 👆🎵 Im Takt tippen

- **Trampolin:** Tippe genau im Takt, dann federst du höher. Treffer in Folge bauen Resonanz auf — und der Takt wird immer schneller! Ein Fehlversuch oder ausgelassener Schlag bricht die Serie und kostet aktuelle Höhe; deine höchste erreichte Höhe bleibt als Ergebnis stehen.

### 👆⚡ Blitzschnell tippen

- **Falschsignal:** Aus der Linse wächst ein Ring nach aussen. Nur wer die Marke am Rand erreicht, ist echt — die anderen bleiben unterwegs stehen. Je kleiner der Ring beim Tippen, desto mehr Punkte: früh tippen ist geraten, spät tippen ist sicher und billig.
- **Blitzreflex:** Drei Versuche an der Startampel. Tippe irgendwo auf den Bildschirm, sobald sie auf Grün springt — aber nicht vorher: ein Fehlstart macht den Versuch ungültig. Gewertet wird deine BESTE Reaktion: die schnellste Einzelzeit gewinnt.

### ↔️〰️ Wischen zum Lenken

- **Spurmaler:** Ein großer Stift zeichnet eine Figur vor — eine Welle, ein Herz, einen Stern, einen Blitz oder das Haus vom Nikolaus. Dann fährst du sie auf deinem Brett mit dem Finger nach, so genau du kannst; die Vorlage bleibt blass zu sehen. Gewertet wird, wie viel der Figur du triffst und wie wenig du daneben malst — bis 100 Punkte je Figur. Drei Figuren, jede kniffliger.

### 👆↔️ Ins Fach wischen

- **Sortierband:** Obst, Müll oder Spielzeug? Wisch jedes Teil vom Band in die passende Rutsche — links, unten oder rechts. Die Schilder tauschen zwischendurch die Plätze, also hinschauen statt auswendig lernen, und Vorsicht bei Verwechslern wie Orange und Basketball. Anfangs läuft das Band gemächlich, dann immer schneller. Eine Serie ohne Fehler bringt Zusatzpunkte.

### 👆🎣 Halten und im Schub loslassen

- **Angelduell:** Halten holt den Fisch ein und spannt die Schnur. Wenn er zieht, steigt die Spannung viel schneller — dann loslassen, sonst reisst sie: der Fisch ist weg, und ein Viertel seines Wertes geht obendrein vom Fang ab. Vier Arten beissen: die Sprotte kommt leicht und bringt wenig, der Wels bringt fünfmal so viel und zieht so hart, dass ein Moment Unachtsamkeit die Schnur kostet.

### 👆🧠 Folge nachtippen

- **Leuchtfolge:** Vier Pilze stehen bereit. Eine Folge leuchtet auf — tippe sie danach in derselben Reihenfolge nach. Sie fängt bei zwei an und wird jede Runde einen länger. Ein Fehler beendet nur die laufende Runde, die nächste zählt wieder.

### 👆🎯 Tippen und stupsen

- **Nagelbrett:** Du hast fünf Kugeln. Tippe oben, wo eine fallen soll — unten zählt der Topf. Der goldene Jackpot-Topf wandert hin und her und bringt +15: denk voraus, wo er steht, wenn deine Kugel ankommt. Während sie fällt, hast du GENAU einen Stups: tippe links oder rechts, um sie noch einmal zu lenken.

### 👆➡️ Nach vorne wischen

- **Eisstock:** Wisch nach vorne, um einen Stein zu schieben: die Richtung deines Wischs ist die Richtung auf dem Eis, und je länger der Wisch, desto weiter gleitet er — Pfeil und Balken zeigen es schon beim Ziehen, die weisse Marke im Balken ist die Kraft bis zum Knopf. Drei Steine, aber immer nur einer unterwegs: der nächste geht erst, wenn deiner liegt. Gezählt wird der Abstand zum Knopf, stufenlos — jeder Zentimeter näher ist mehr wert, und der goldene Ring zeigt, wer gerade am nächsten liegt. Steine prallen nicht ab, sie schieben sich: du kannst jemanden vom Knopf drängen, aber niemand wird quer durchs Haus geschossen.

### 👆🧭 Felder antippen und schliessen

- **Spürsinn:** Irgendwo im Feld liegt ein Fundstück. Tippe ein Feld an, und die Zahl darauf sagt, wie viele Schritte es von dort bis zum Versteck sind — hoch, runter, links, rechts gezählt. Zwei Zahlen zusammengenommen grenzen es schon stark ein. Je weniger Tipps ein Fund kostet, desto mehr ist er wert.

### 👆📏 Regler auf die Schätzung ziehen

- **Augenmaß:** Auf der Wiese schwirren ein paar Sekunden lang Tiere herum — jeden Durchgang andere: Bienen, Schmetterlinge, Vögel oder Libellen. Dann sind sie weg und du schätzt, wie viele es waren. Zieh den Regler auf deine Zahl, solange der grüne Balken läuft. Vier Durchgänge, jedes Mal ein paar Tiere mehr: am Anfang klappt Zählen noch, am Ende kaum. Je näher an der echten Zahl, desto mehr Punkte.

### 👆🙂 Gesicht zurechtziehen

- **Grimassen:** Oben hängt ein verzogener Blockkopf, vor dir dein eigener — noch ganz neutral. Zieh die sechs gelben Punkte — Brauen, Nase, Mundwinkel, Kinn —, bis dein Kopf genauso aussieht. Nach zehneinhalb Sekunden wird verglichen: je näher jeder Punkt am Vorbild liegt, desto mehr Punkte. Drei Gesichter, jedes schiefer als das vorige.

### 👆🚩 Rot oder Blau tippen

- **Flaggen hoch:** Der Käpt'n hebt Rot, Blau oder beide Flaggen — mach es nach, so schnell du kannst. Aber nur, wenn er „Käpt'n sagt:“ ruft! Ruft er bloss „ROT!“, ist es eine Falle — wer dann stillhält, hat richtig. Die Kommandos kommen immer schneller; ein Fehler, und du sitzt an Deck und schaust den anderen zu. Es zählen die richtigen Antworten, bei Gleichstand die schnellere Hand.

### 👆🍎 Eins oder zwei pflücken

- **Honigwabe:** Vom Baum hängt eine Ranke voller Äpfel, dazwischen Honigwaben. Reihum pflückt jeder von unten einen oder zwei. Wer eine Wabe erwischt, wird gestochen und ist raus. Alles ist sichtbar — zähl ab und schieb die Wabe dem Nächsten zu. Einmal im Spiel darfst du deinen Zug ganz weiterschieben. Wer zuletzt übrig ist, gewinnt; unter Gleichen zählen die Früchte (goldene Äpfel drei).

### 🕹️👆 Stick steuern, Knopf werfen

- **Schneeballhang:** Oben auf dem Gipfel schiebt jeder eine Schneekugel vor sich her — beim Rollen wird sie grösser. WERFEN schickt sie los. Wer getroffen wird, fällt kurz um und verliert seine Kugel; der Werfer bekommt 1, 2 oder 4 Punkte, je grösser die Kugel war. Eine Riesenkugel walzt weiter und kann noch jemanden umwerfen. Trifft eine Kugel auf deine grosse Kugel vorn, zerplatzen beide: sie ist dein Schild.

### 🕹️💥 Stick laufen, Knopf schubsen

- **Schnappschuss:** Premiere auf dem roten Teppich! Der Fotograf zeigt einen Bildausschnitt auf der Bühne, zählt herunter und blitzt. Wer im Ausschnitt steht, ist auf dem Foto (10 Punkte), wer der Mitte am nächsten ist, aufs Titelbild (+10 — der Stern zeigt, wer es gerade wäre), und wer ganz allein drauf ist, bekommt noch 5. Wer zuerst in der Mitte steht, hält sie im Gedränge. Herausholen kann ihn nur SCHUBS: du schnellst nach vorn, und wen du rammst, der fliegt aus dem Bild.

### 👀👆 Mit den Augen folgen, dann tippen

- **Rohrsalat:** Im Kesselhaus hängt ein Gewirr aus Kupferrohren: oben Ventile, unten Ausgänge, nur einer führt in die Schatztruhe. Folge einem Rohr mit den Augen nach unten und bieg an jedem Querrohr ab — dann tipp das richtige Ventil an. Tipp: von der Truhe aus nach oben geht es schneller. Richtig bringt 100 Punkte plus bis zu 60 fürs Tempo, falsch eine Ladung Russ. Fünf Runden, jedes Mal mehr Rohre und etwas mehr Zeit — haben alle gewählt, wird gleich aufgelöst.

## Sandbox

`http://localhost:3000/sandbox.html` öffnet den Party-Baukasten: sechs Umgebungssets (Wiese, Strand, Stadt, Spielzimmer, Himmel, Fabrik), neun spawnbare Hindernisse (Kiste, Baumstamm, Pylone, Plattform, Tür, Rampe, Feder, Bumper, Drehstange), 1–4 KI-Testfiguren mit den Grundbewegungen (Laufen, Springen, Stolpern, Jubeln, Traurig, Getroffen, Hinfallen) sowie Viewport-Presets für Hoch-/Querformat und Tablet. Tippen in die Welt schickt Spieler 1 dorthin.

`http://localhost:3000/kin-lab.html` ist das Figurenlabor: alle Zustände der Figur nebeneinander, zum Anschauen und für Bildvergleiche. `?states=a,b,c` zeigt nur diese, `?t=1500` friert die Uhr auf diese Millisekunde seit Zustandsbeginn ein.

Jedes Minispiel startet mit einer einheitlichen Intro-Karte (Name, Ziel, Touch-Geste) und dem 3-2-1-LOS-Countdown; die Ergebnisse werden von Platz 4 bis Platz 1 aufgedeckt, Gleichstände bekommen ein eigenes Badge.

Landungen federn schnell ein und danach leicht nach. Bei Ballonfahrt zeigt ein kontrastreicher Ring die Sacklandung; seine Größe wächst weiterhin mit der Flughöhe. Bumper Pool kündigt den schrumpfenden Rand fünf Sekunden vorher an. Bei reduzierter Bewegung bleibt der Rand ruhig und die Landung verzichtet auf das Nachfedern.

Im Zielsprint bleibt der Sprungbogen auch dann gültig, wenn ein Server-Update der abgeglichenen Client-Uhr kurz vorausläuft.

## Dev-Testmodus

Der Dev-Testmodus ist im normalen Spiel ausgeblendet und muss beim Serverstart freigegeben werden (`TUMBLEKIN_DEV_TOOLS=1 npm start`). Erst dann zeigt `http://localhost:3000/?dev=1` in der Lobby den Button `Dev-Test: 4 lokal`: Er erzeugt vier lokale Spieler auf einem Gerät, zwischen denen man im Minispiel umschaltet. Jedes der 40 Minispiele lässt sich über **🎮 Einzel** direkt auswählen.

Mit `?dev=1` legt der Client ausserdem `window.__tumblekin` offen — `state()` und `request(ereignis, daten)` —, über den die Prüfskripte Räume öffnen, Modi wählen und Spiele starten, ohne sich durch die Oberfläche zu klicken. Das Ereignis `devSkipMinigame` wertet ein laufendes Minispiel sofort; es gibt es nur mit freigegebenen Dev-Werkzeugen und nur für den Host.

## Lokal testen

Regeln und Spiellogik auf dem Server:

```bash
npm test
```

Die Modi statistisch — tausende Partien je Modus und Spielerzahl, nur mit den Regeln, in unter einer Sekunde. Meldet, ob jede Partie endet, wie oft die Notbremse greift, wie oft Siege geteilt werden, ob ein etwas Besserer sich durchsetzt und ob je ein Spiel zweimal hintereinander kommt:

```bash
npm run match-sim            # 2000 Partien je Einstellung
npm run match-sim -- 10000
```

Bot-Waage, Anzeige und Leerlauf der Minispiele (ebenfalls ohne Browser):

```bash
npm run bot-sim              # zahlt sich Können in jedem Spiel aus?
npm run anzeige-check        # entscheidet die angezeigte Zahl auch die Rangfolge?
npm run leerlauf-check       # steht ein Spiel am Ende zu lange still?
npm run fuzz                 # Unsinn an alle Ereignisse des Servers
npm run gameplay-check       # alle 40 Regeln: 1080 Runden, 2/3/4 Spieler, verschiedene Takte und Seeds
```

`fuzz` braucht einmalig `npm install --no-save socket.io-client`.

Im echten Browser — alle starten den Server selbst auf einem freien Port und beenden ihn wieder:

```bash
npm run smoke                # jedes Minispiel ein paar Sekunden: Render- und Konsolenfehler
npm run smoke -- turmbau     # nur ausgewählte
npm run smoke -- --head      # sichtbares Browserfenster zum Zuschauen
npm run match-check          # ganze Partien: Marathon, K.O., Punktejagd bis zur Siegerehrung
npm run onboarding-check     # zwei Geräte: Startkarten, Bereit, Spielauswahl und Querformat
npm run practice-check       # vier gezielte Übungen samt Isolation von zwei Geräten
npm run all-practice-check   # echte Eingabe, Regelwirkung und Aufräumen für alle 40 Übungen
npm run bumper-check         # nur Stick: echter Touch, Rammen, Klang, Übung und Fokusverlust
npm run sprint-check         # Wischen/Halten, Slide/Sprung, Ausdauer, Kamera und isolierte Übung
npm run pipe-check           # fünf echte Rohrsalat-Runden, sechs Ventile, kleine Bildschirme und Texturfreigabe
npm run feedback-check       # Landungen, Landering, Insel-Vorwarnung und reduzierte Bewegung
npm run input-check          # Mehrfinger-Eingaben, Tabwechsel und Joystick-Unterbrechung
npm run gesture-check        # sieben Wisch-/Ziehspiele: zweiter Finger, Loslassen und Unterbrechung
npm run effects-check        # Partikelflug bei 30/60/120 Hz, Ressourcen, Cachebudget und reduzierte Bewegung
npm run refinement-check     # alle 40 Spiele: Hoch-/Querformat, 320px, HUD und Finale-Steuerung
npm run press-check          # Knopfdruck, Tastatur, assistive Aktivierung, Halten und echte Aktionsfehler
npm run session-sim -- 12 --quick ballonPump leuchtfolge kanonenflug  # wiederholte gleiche Szenen für den Speichervergleich
npm run animation-check      # 64 Posen bei 30/60/120 Hz, reduzierte Bewegung und Fußkontakt im Zielsprint
npm run scene-check          # Figuren im Bild, auf dem Boden, nicht in Kulissen
npm run boden-check          # dasselbe über die GANZE Runde bis zur Ergebnistafel, dazu Sprünge und NaN
npm run session-sim          # viele Spiele hintereinander: wächst etwas, das nicht wachsen darf?
npm run session-sim -- 60 --quick # nur Aufbau/Abbau: alle Spiele plus Wiederholungen, alte Szenen und Speicher
npm run gallery              # Bilder aller Minispiele nach galerie/
npm run game-previews        # echte Szenen als Auswahlbilder unter client/assets/games/
```

Die Browserprüfungen brauchen einmalig einen Browser:

```bash
npx playwright install chromium
```

Nach Änderungen an den Serverregeln oder am Übungs-Worker erzeugt `npm run build:practice` das eingecheckte Browser-Bündel neu. Es ersetzt Netzwerk und HTTP durch lokale Stubs; Übungseingaben gelangen ausschließlich in den eigenen Worker. `TUMBLEKIN_BROWSER_WORKERS=1 npm run refinement-check` prüft die Ansichten nacheinander, wenn paralleles Software-Rendering kurze Spielrunden aufbraucht.

Ein bereits installiertes Chrome/Chromium lässt sich stattdessen über `CHROMIUM_PATH=/pfad/zu/chrome` verwenden. Der Exit-Code ist 0 nur, wenn alles sauber durchläuft.

Die Ergebnisse und priorisierten nächsten Schritte stehen in [GAMEPLAY_AUDIT.md](GAMEPLAY_AUDIT.md).
Der zweite Durchgang mit Einzelbefunden zu allen 40 Spielen steht in [GAME_REFINEMENT.md](GAME_REFINEMENT.md).
Die kritische Prüfung von Spielidee, alternativer Bedienung und offenen Designfragen je Spiel steht in [GAME_DESIGN_REVIEW.md](GAME_DESIGN_REVIEW.md). Sie dokumentiert außerdem den neuen Tastendruck, gemeinsame Teamplätze und verständliche Aktionszustände.
`refinement-check` speichert Bilder und `observations.json` unter `/tmp/tumblekin-refinement`;
mit `TUMBLEKIN_SCREENSHOTS=/pfad` lässt sich der Ausgabeordner ändern. Spielnamen
begrenzen den Lauf, etwa `npm run refinement-check -- messerwurf spurmaler`.

## Veröffentlichung

`RELEASE.md` beschreibt den Stand für ein Store-Release: was erledigt ist, was
noch fehlt, und warum der heutige LAN-Aufbau mit selbst gehostetem Server so
nicht in einen Store kann.

Entwickler-Werkzeug (vier lokale Spieler, Spiele sofort werten) ist in
Produktion aus und wird über eine Umgebungsvariable eingeschaltet:

```bash
TUMBLEKIN_DEV_TOOLS=1 npm start
```

Rechtliches: `LICENSE` (MIT), `THIRD-PARTY-NOTICES.md` für die eingebundenen
Bibliotheken und `PRIVACY.md` als Datenschutzerklärung. Icons lassen sich mit
`npm run icons` neu erzeugen.

## Browser-Fassung (claude.ai)

`npm run build:browser` baut nach `browser/dist` eine Fassung ohne Node-Server: Spielserver und Oberfläche laufen in einer Seite, Übungen ebenfalls. Sie wird als claude.ai-Artifact veröffentlicht (`ARTIFACT_URL` legt den Link in QR-Code und Teilen-Text fest).

Mitspielen geht dort ohne Server: **Wer die Party startet, ist der Server.** Gäste öffnen dasselbe Artifact, tippen den Raumcode ein oder wählen die Party aus der Liste „Offene Partys“. Die Verbindung vermittelt die Raumfunktion von claude.ai (`browser/net.js`):

- Zuerst direkt per WebRTC — Angebot und Antwort laufen über den Raum, danach geht jedes Ereignis von Gerät zu Gerät.
- Bis das steht, oder wenn es nie zustande kommt, über den Raum selbst: Der Host bündelt alle 80 ms, behält vom Raumzustand und Minispielstand nur den neuesten, packt das Bündel und schickt es in Stücken unter 4 KiB; höchstens 28 Raumereignisse pro Sekunde. Gäste melden Eingaben über ihre Präsenz, die jeder setzen darf. Antworten gehen dreimal raus, der Raumzustand alle zwei Sekunden erneut — beides kann unterwegs verloren gehen.
- Wer acht Sekunden weg ist, gilt als gegangen; kürzere Aussetzer überbrückt die Verbindung. Schliesst der Host sein Fenster, landen die Gäste wieder auf dem Startbildschirm.

Voraussetzungen: Gäste müssen bei claude.ai angemeldet sein, und das Artifact muss mit ihnen geteilt sein (ein öffentlicher Link reicht nicht). Eine Party leiten kann, wer das Artifact bearbeiten oder mitwirken darf; mitspielen darf auch, wer es nur ansehen kann. Das Handy des Hosts sollte offen bleiben — solange Gäste da sind, hält es den Bildschirm wach, wo der Browser das erlaubt.

`npm run browser-join-check` spielt das mit drei Seiten durch (eine Nachbildung der Raumfunktion über BroadcastChannel, `browser/mock-room.js`, mit Verzögerung und Verlust): Beitritt per Code und per Liste, ein Gast über den Raum, einer über WebRTC, ein gemeinsames Spiel, Gehen, Party beenden, Host-Fenster schliessen. `npm run browser-solo-check` prüft Startkarte, Übung und eine Runde gegen Bots.

## Architektur

- Express liefert PWA, Three.js und Clientmodule aus.
- Socket.io synchronisiert Raum, Modus, Minispiel-Eingaben, Ergebnisse und Reconnects. Der Server ist massgeblich: er wertet jedes Minispiel, die Clients zeigen nur an.
- Zeitkritische Spiele zeigen den Moment, in dem ein JETZT getippter Befehl beim Server ankommt (`MinigameScene.arrivalNow()`): Serveruhr plus gemessene Rundreise. Damit trifft, wer im Bild trifft — auch mit 100 ms WLAN-Verzögerung. Wo das Bild vorausläuft (eigene Spur im Münzregen, eigenes Feld in der Farbflucht, eigener Läufer auf der Zielgeraden), gelten noch nicht bestätigte Eingaben schon im Bild; der Server bleibt trotzdem allein massgeblich und traut keinem Zeitstempel eines Geräts.
- `server/modes.js` enthält die Regeln der Modi — Spielliste, Punkte, Leben, Ende — ohne Sockets und Timer, damit jede Regel ohne laufenden Server prüfbar ist.
- Three.js rendert die Menübühne (Lobby, Podest, Siegerehrung) und alle 40 Minispiele mit denselben Figuren.
- Service Worker, Manifest und App-Icon erlauben die Installation auf dem Homescreen.

Gemeinsame Bausteine der Minispiele:

- `minigames/catalog.js` — maßgebliche Liste aller Challenges samt Geste und Hilfetext.
- `minigames/Kin.js` — Figur, Posen, Gesicht und `KinAnimator`.
- `minigames/MinigameScene.js` — Grundgerüst jedes Spiels: Bühne, HUD, Figuren samt Schild und Schatten, eigener Pfeil, Partikel, Kamera, Finale, Abbau. Ein Spiel baut nur noch seine Welt und seine Handlung.
- `minigames/CameraRig.js` — die Kamera aller Spiele (siehe oben).
- `minigames/Kulisse.js` — Bausteine für Kulissen: Zäune, Wimpel, Heuballen, Bäume, Berge, Laternen, Tribünen, Himmel und Schilder. Gleiche Teile laufen als InstancedMesh in einem Zeichenaufruf, Zufall kommt aus einem Seed, damit jede Szene bei jedem Start gleich aussieht.
- `minigames/VoxelKit.js` — Voxel-Bausteine, Partikel (`CubeBurst`) und Pop-up-Texte (`FloatingText`); reicht die Figur aus `Kin.js` weiter.
- `minigames/SceneKit.js` — Renderer, Licht, HUD und Teardown.
- `minigames/Blockform.js` — baut runde Formen (Kugeln, Zylinder, Kegel, Ringe, Scheiben, Tori, Drehkörper) vor dem ersten Bild in facettierte Low-Poly-Körper um (Polygon-Look): wenige Ecken je Umfang, jede Fläche mit eigener Normale; Tori (Schwimmringe, Reifen) werden zu Schläuchen mit sechseckigem Querschnitt. Grosse Spielflächen bekommen mehr Ecken, damit der sichtbare Rand zur Spielkante passt; Teilstücke (Ballonstreifen, Schwimmringbögen) knicken an denselben Stellen und schliessen lückenlos. Himmelskuppeln, Schatten und absichtlich eckige Vielecke bleiben unverändert; `userData.rund` nimmt eine Form ausdrücklich aus. `ringband` baut flache Ränder aus denselben Keilen, deren Oberkante bündig mit einer Fläche liegt.
- `minigames/Quality.js` — Bewegungspräferenz (`prefers-reduced-motion`) und Gerätestufe; steuert Kamera-Shake, Partikelmenge, Schattenauflösung und Pixelratio.
- `minigames/SketchFigures.js` — Spurmaler: die Figuren (Welle, Herz, Stern, Haus vom Nikolaus …) und ihre Wertung (Abdeckung × Genauigkeit); dieselbe Rechnung auf Server und Gerät, wie `SprintPhysics.js` und `BumperPhysics.js`.
- `ui/MenuStage.js` — die Bühne hinter den Menüs. Die Podest-Zahlen sind Blockziffern aus einer 3×5-Pixelschrift.

Alle Namen, Figuren, Regeln und visuellen Motive sind eigenständige Entwürfe für Tumblekin.

Die Einzelentscheidungen und Korrekturen zu allen 40 Spielen stehen in [GAMEPLAY_AUDIT.md](GAMEPLAY_AUDIT.md). Jede Startkarte bietet einen getrennten Übungsversuch; Kontakt-, Team- und Zugspiele enthalten passende Bot-Gegenüber.
