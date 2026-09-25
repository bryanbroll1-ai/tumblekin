# Tumblekin

Tumblekin ist ein mobile-first Partyspiel für bis zu vier Spieler im gleichen WLAN — nur Minispiele, kein Brett. Gespielt wird in 30 touch-optimierten Challenges, jede zwischen 12 und 46 Sekunden lang: als Marathon, Punktejagd, K.O.-Runde oder einzeln.

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

Eine Partie braucht mindestens zwei Teilnehmer. Wer allein ist, holt sich mit **+ Bot** Mitspieler dazu — die Bots spielen jedes Minispiel mit, in drei Stärken; dass die stärkere in jedem Minispiel tatsächlich häufiger gewinnt, misst `npm run bot-sim` nach.

Bei einem kurzen WLAN-Hänger oder Reload stellt der Client die laufende Sitzung automatisch wieder her. Es gibt bewusst keine Host-Migration: Bleibt der Host offline, werden Host-Aktionen gesperrt und alle Spieler sehen eine Fehlermeldung.

## Die Modi

Nach jedem Minispiel gibt es Punkte nach Platz: der Letzte bekommt 0, jeder Platz darüber einen mehr — bei vier Spielern 3/2/1/0. Wer gleichauf liegt, teilt sich den besseren Platz.

- **🏃 Marathon:** 5, 10 oder 15 Minispiele. Die meisten Punkte gewinnen, bei Gleichstand die meisten Siege.
- **🎯 Punktejagd:** Wer als Erster allein die Zielpunktzahl erreicht, gewinnt — 4 Punkte je Gegner, bei vier Spielern also 12. Springen zwei gleichzeitig darüber, geht es weiter bis einer vorn liegt.
- **💥 K.O.:** Jeder startet mit 2, 3 oder 5 Leben. Nach jedem Spiel verliert, wer unter den Verbliebenen Letzter wurde, eines; liegen alle gleichauf, niemand. Ausgeschiedene spielen weiter mit, zählen aber nicht mehr — niemand sitzt am Handy und schaut nur zu.
- **🎮 Einzelspiel:** Ein Minispiel, ausgewählt oder zufällig, danach zurück in die Lobby.

Für Marathon, Punktejagd und K.O. lässt sich der Spielvorrat einschränken (mindestens zwei Spiele). Innerhalb eines Durchgangs durch den Vorrat kommt kein Spiel doppelt, und nie dasselbe zweimal hintereinander. Punktejagd und K.O. haben Notbremsen nach 30 bzw. 40 Spielen; dass sie praktisch nie greifen, misst `npm run match-sim` nach.

Zwischen den Spielen zeigt die Ergebnistafel die Plätze von hinten nach vorn, den Zwischenstand und das nächste Spiel; auf der Bühne dahinter stehen die Figuren auf dem Podest. Am Ende gibt es eine Siegerehrung mit Revanche auf Knopfdruck.

## Die Figuren und die Kamera

Die Tumblekin haben ein Gerüst — Hüfte, Rumpf, Kopf, zwei Arme, zwei Beine — und ein Gesicht mit Blick, Lidern, Brauen und sieben Mündern. Bewegung ist in Posen beschrieben, zwischen denen überblendet wird; die Arme können eine eigene Handlung spielen, während die Beine weiterlaufen. In jedem Minispiel tun die Figuren, was der Spieler tut: pumpen, kurbeln, klettern, graben, werfen, angeln, schieben — statt daneben zu hüpfen.

Alle 30 Spiele teilen sich ein Kamera-Rig. Es bekommt keine Koordinaten, sondern eine Beschreibung — worauf geschaut wird, wie gross das Motiv ist, aus welchem Winkel — und rahmt in das Band, das Punkteleiste und Knöpfe frei lassen, im Hoch- wie im Querformat. Dazu kommen einheitlich ein Anflug im Countdown, eine Sicherung, die weglaufende Figuren ins Bild zurückholt, Schütteln mit Abklingen und eine Fahrt auf den Sieger in den letzten Sekunden.

## 30 Challenges

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

- **Bumper Pool:** Lenk deinen Schwimmring mit dem Stick und ramm die anderen von der Badeinsel ins Becken. Jeder hat drei Leben: wer reinfällt, springt nach kurzer Pause zurück, beim dritten Mal ist er raus. In den letzten 15 Sekunden schrumpft die Insel. Gewertet werden übrige Leben, dann Rauswürfe.
- **Farbenjagd:** Schieb deine Farbwalze mit dem Stick über die Leinwand — was sie überrollt, hat sofort deine Farbe, auch fremde. Fahr eine Schleife zurück in deine Farbe: alles, was du damit einkreist, wird auf einen Schlag deins. Goldene Walze = breiter malen, Farbbombe = großer Klecks. Wer am Ende die meiste Fläche hat, gewinnt.

### 👆✳️ In jede Richtung wischen

- **Zielgerade:** Wisch nach links oder rechts in die schnelle Bahn: grüne Felder mit Pfeilen sind Boost, Matsch bremst. Tippen springt über Hürden — in der Luft bist du etwas langsamer, also nur, wenn es nötig ist. Nach unten wischen wirft etwas auf den, der in DEINER Bahn dicht vor dir läuft — du hast drei Würfe. Zielt jemand auf dich, warnt dich die Anzeige: abspringen oder die Bahn wechseln, dann fliegt der Wurf ins Leere.
- **Farbflucht:** Eine Farbe wird angesagt — wisch dich Feld für Feld auf ein Feld dieser Farbe, bevor der Rest wegbricht. Jede Runde gibt es weniger Zeit und weniger sichere Felder; wer fällt, ist raus.

### 👆 Tippen

- **Nervenprobe:** Die Zielzeit liegt zwischen 4 und 8 Sekunden. Nach 2 Sekunden verschwindet jede Uhr — zähl im Kopf weiter und drück so nah wie möglich an der Zielzeit.
- **Fassmut:** Über dir hängt ein Fass am Seil. Irgendwann wird es losgelassen und fällt — EIN Tipp spannt das Seil und fängt es ab. Wer es am dichtesten über dem Kopf zum Stehen bringt, gewinnt. Zu spät gezogen gibt eine Beule.
- **Zündstoff:** Die Zündzeit blinkt kurz auf – merk sie dir und gib die Bombe rechtzeitig weiter! Wer sie beim Knall hält, ist raus.
- **Blob-Klopfe:** Blobs poppen aus den Löchern – tipp ihr Feld, bevor sie abtauchen. Finger weg von den stacheligen: wer einen erwischt, verliert einen Treffer und ist kurz benommen.
- **Seilspringen:** Die zwei Dreher schwingen das Riesenseil, und es wird immer schneller. Tipp, wenn es unter dir durchgeht — du bist nur kurz in der Luft. Achtung bei DOPPELT: dann kommt es zweimal kurz hintereinander. Einmal hängen geblieben und du bist raus.
- **Messerwurf:** Dein Stamm dreht sich — jeder Tipp wirft ein Messer hinein. Triff kein steckendes Messer! Sind alle Messer drin, zerbricht der Stamm und der nächste kommt, jeder dreht sich anders. Äpfel bringen Extrapunkte, ein Klirren kostet den Stamm.
- **Turmbau:** Tippe im richtigen Moment, um den gleitenden Block zu stapeln. Der höchste Turm gewinnt!

### 👆⏺️ Knopf gedrückt halten

- **Lichtwächter:** Halte den Knopf, um zu laufen. Wenn die Lampe gelb blinkt, dreht sich der Wächter um — lass bis dahin los. Wer bei Rot noch läuft, fliegt fünf Meter zurück und ist kurz benommen. Manchmal täuscht er nur an. Wer zuerst am Tor ist, gewinnt.
- **Fassrolle:** Alle stehen auf einem Riesenfass über dem Fluss. Halte ◀ oder ▶ und lauf gegen die Drehung an — aber wer läuft, dreht das Fass auch unter den anderen. So rollst du sie ins Wasser, musst dann aber selbst mithalten. Wer fällt, schwimmt zurück und verliert die Zeit im Wasser. Gezählt wird die Zeit im grünen Streifen oben.
- **Ballonfahrt:** Halte den Finger auf dem Bild, dann heizt der Brenner und du steigst — loslassen lässt sinken. Mit ABWURF fällt ein Sandsack: er fliegt mit, während er fällt, also je höher, desto früher werfen. Triff die Zielscheiben auf den Feldern und sammle unterwegs Sterne.

### 👈👉 Links/rechts im Wechsel

- **Pump-Panik:** Drück die beiden Pumpknöpfe abwechselnd — links, rechts, links … so schnell du kannst. Nur der Wechsel pumpt, zweimal dieselbe Seite bewegt den Kolben nicht. Der dickste Ballon gewinnt.

### 👆↔️ Links/Rechts wischen

- **Münzregen:** Wisch nach links oder rechts, um die Spur zu wechseln. Fang Münzen und weich den Bomben aus — fünf Fänge in Folge verdoppeln jede Münze, zehn verdreifachen sie. Am Ende kommt der Goldrausch, und eine Schatztruhe fällt in die angesagte Spur.

### 👆👆 Schnell tippen

- **Kanonenflug:** Tipp 1 stoppt die Kraft, Tipp 2 den Winkel. Triff die Zielflagge — sie steht jede Runde woanders, und der Windsack zeigt, ob Wind dich weiter trägt oder bremst. Beim Winkel zeigt ein Ring, wo du ohne Wind landen würdest.
- **Bergsteiger:** Tippe auf die Bildhälfte, auf der der nächste Griff leuchtet — jede Seite ist eine Hand, die falsche kostet den Griff. Der Gipfel liegt auf 70: wer am schnellsten oben ist, gewinnt. Wer nicht ankommt, zählt nach Höhe.

### 👆🎵 Im Takt tippen

- **Trampolin:** Tippe genau im Takt, dann federst du höher. Treffer in Folge bauen Resonanz auf — und der Takt wird immer schneller!

### 👆⚡ Blitzschnell tippen

- **Falschsignal:** Aus der Linse wächst ein Ring nach aussen. Nur wer die Marke am Rand erreicht, ist echt — die anderen bleiben unterwegs stehen. Je kleiner der Ring beim Tippen, desto mehr Punkte: früh tippen ist geraten, spät tippen ist sicher und billig.
- **Blitzreflex:** Drei Läufe an der Startampel. Tippe irgendwo auf den Bildschirm, sobald sie auf Grün springt — aber nicht vorher: ein Fehlstart kostet mehr als jede langsame Reaktion. Die kürzeste Gesamtzeit gewinnt.

### 👆〰️ Finger auf der Spur führen

- **Spurmaler:** Zieh den Finger auf der Spur nach oben und mal sie aus. Das Band wird zwischendurch eng — dort zählt jeder Millimeter. Die Kristalle liegen am Bandrand: wer sie mitnimmt, muss nicht nur drinbleiben, sondern zielen. Verlässt du das Band, reisst der Strich ab.

### 👆↔️ Ins Fach wischen

- **Sortierband:** Wisch jedes Paket in die Rutsche mit seiner Farbe — links, unten oder rechts. Die Rutschen tauschen zwischendurch die Farben, also nicht auswendig lernen, sondern hinschauen. Eine Serie ohne Fehler bringt Zusatzpunkte.

### 👆🎣 Halten und im Schub loslassen

- **Angelduell:** Halten holt den Fisch ein und spannt die Schnur. Wenn er zieht, steigt die Spannung viel schneller — dann loslassen, sonst reisst sie: der Fisch ist weg, und ein Viertel seines Wertes geht obendrein vom Fang ab. Vier Arten beissen: die Sprotte kommt leicht und bringt wenig, der Wels bringt fünfmal so viel und zieht so hart, dass ein Moment Unachtsamkeit die Schnur kostet.

### 👆🧠 Folge nachtippen

- **Leuchtfolge:** Vier Pilze stehen bereit. Eine Folge leuchtet auf — tippe sie danach in derselben Reihenfolge nach. Sie fängt bei zwei an und wird jede Runde einen länger. Ein Fehler beendet nur die laufende Runde, die nächste zählt wieder.

### 👆🎯 Tippen und stupsen

- **Nagelbrett:** Tippe oben, wo die Kugel fallen soll — die Mitte ist am meisten wert. Während sie fällt, hast du GENAU einen Stups: tippe links oder rechts, um sie noch einmal zu lenken.

### 👆➡️ Nach vorne wischen

- **Eisstock:** Wisch nach vorne, um einen Stein zu schieben — je länger der Wisch, desto weiter fliegt er. Drei Steine, aber immer nur einer unterwegs: der nächste geht erst, wenn deiner liegt. Gezählt wird der Abstand zum Knopf, stufenlos — jeder Zentimeter näher ist mehr wert. Steine prallen nicht ab, sie schieben sich: du kannst jemanden vom Knopf drängen, aber niemand wird quer durchs Haus geschossen.

### 👆⛏️ Graben oder aufhören

- **Tiefenrausch:** Tippen gräbt eine Stufe tiefer und bringt Gold — aber jeder Stollen kann einstürzen, und dann ist alles weg, was noch unten hängt. Das Risiko der nächsten Stufe steht genau im Bild. Wisch nach oben, um deine Beute sicher einzuzahlen — was bei Rundenende noch unten hängt, verfällt.

### 👆🧭 Felder antippen und schliessen

- **Spürsinn:** Irgendwo im Feld liegt ein Fundstück. Tippe ein Feld an, und die Zahl darauf sagt, wie viele Schritte es von dort bis zum Versteck sind — hoch, runter, links, rechts gezählt. Zwei Zahlen zusammengenommen grenzen es schon stark ein. Je weniger Tipps ein Fund kostet, desto mehr ist er wert.

### 👆📏 Regler auf die Schätzung ziehen

- **Augenmaß:** Ein Schwarm Glühkäfer blitzt anderthalb Sekunden auf — dann sind sie weg und du schätzt, wie viele es waren. Zieh den Regler auf deine Zahl. Vier Durchgänge, und der Schwarm wird jedes Mal grösser: zählen klappt am Anfang noch, später nicht mehr. Je näher an der echten Zahl, desto mehr Punkte.

## Sandbox

`http://localhost:3000/sandbox.html` öffnet den Party-Baukasten: sechs Umgebungssets (Wiese, Strand, Stadt, Spielzimmer, Himmel, Fabrik), neun spawnbare Hindernisse (Kiste, Baumstamm, Pylone, Plattform, Tür, Rampe, Feder, Bumper, Drehstange), 1–4 KI-Testfiguren mit den Grundbewegungen (Laufen, Springen, Stolpern, Jubeln, Traurig, Getroffen, Hinfallen) sowie Viewport-Presets für Hoch-/Querformat und Tablet. Tippen in die Welt schickt Spieler 1 dorthin.

`http://localhost:3000/kin-lab.html` ist das Figurenlabor: alle Zustände der Figur nebeneinander, zum Anschauen und für Bildvergleiche. `?states=a,b,c` zeigt nur diese, `?t=1500` friert die Uhr auf diese Millisekunde seit Zustandsbeginn ein.

Jedes Minispiel startet mit einer einheitlichen Intro-Karte (Name, Ziel, Touch-Geste) und dem 3-2-1-LOS-Countdown; die Ergebnisse werden von Platz 4 bis Platz 1 aufgedeckt, Gleichstände bekommen ein eigenes Badge.

## Dev-Testmodus

Der Dev-Testmodus ist im normalen Spiel ausgeblendet und muss beim Serverstart freigegeben werden (`TUMBLEKIN_DEV_TOOLS=1 npm start`). Erst dann zeigt `http://localhost:3000/?dev=1` in der Lobby den Button `Dev-Test: 4 lokal`: Er erzeugt vier lokale Spieler auf einem Gerät, zwischen denen man im Minispiel umschaltet. Jedes der 30 Minispiele lässt sich über **🎮 Einzel** direkt auswählen.

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
```

`fuzz` braucht einmalig `npm install --no-save socket.io-client`.

Im echten Browser — alle starten den Server selbst auf einem freien Port und beenden ihn wieder:

```bash
npm run smoke                # jedes Minispiel ein paar Sekunden: Render- und Konsolenfehler
npm run smoke -- turmbau     # nur ausgewählte
npm run smoke -- --head      # sichtbares Browserfenster zum Zuschauen
npm run match-check          # ganze Partien: Marathon, K.O., Punktejagd bis zur Siegerehrung
npm run scene-check          # Figuren im Bild, auf dem Boden, nicht in Kulissen
npm run session-sim          # viele Spiele hintereinander: wächst etwas, das nicht wachsen darf?
npm run gallery              # Bilder aller Minispiele nach galerie/
```

Die Browserprüfungen brauchen einmalig einen Browser:

```bash
npm install --no-save playwright
npx playwright install chromium
```

Ein bereits installiertes Chrome/Chromium lässt sich stattdessen über `CHROMIUM_PATH=/pfad/zu/chrome` verwenden. Der Exit-Code ist 0 nur, wenn alles sauber durchläuft.

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

## Architektur

- Express liefert PWA, Three.js und Clientmodule aus.
- Socket.io synchronisiert Raum, Modus, Minispiel-Eingaben, Ergebnisse und Reconnects. Der Server ist massgeblich: er wertet jedes Minispiel, die Clients zeigen nur an.
- `server/modes.js` enthält die Regeln der Modi — Spielliste, Punkte, Leben, Ende — ohne Sockets und Timer, damit jede Regel ohne laufenden Server prüfbar ist.
- Three.js rendert die Menübühne (Lobby, Podest, Siegerehrung) und alle 30 Minispiele mit denselben Figuren.
- Service Worker, Manifest und App-Icon erlauben die Installation auf dem Homescreen.

Gemeinsame Bausteine der Minispiele:

- `minigames/catalog.js` — maßgebliche Liste aller Challenges samt Geste und Hilfetext.
- `minigames/Kin.js` — Figur, Posen, Gesicht und `KinAnimator`.
- `minigames/MinigameScene.js` — Grundgerüst jedes Spiels: Bühne, HUD, Figuren samt Schild und Schatten, eigener Pfeil, Partikel, Kamera, Finale, Abbau. Ein Spiel baut nur noch seine Welt und seine Handlung.
- `minigames/CameraRig.js` — die Kamera aller Spiele (siehe oben).
- `minigames/VoxelKit.js` — Voxel-Bausteine, Partikel (`CubeBurst`) und Pop-up-Texte (`FloatingText`); reicht die Figur aus `Kin.js` weiter.
- `minigames/SceneKit.js` — Renderer, Licht, HUD und Teardown.
- `minigames/Quality.js` — Bewegungspräferenz (`prefers-reduced-motion`) und Gerätestufe; steuert Kamera-Shake, Partikelmenge, Schattenauflösung und Pixelratio.
- `ui/MenuStage.js` — die Bühne hinter den Menüs.

Alle Namen, Figuren, Regeln und visuellen Motive sind eigenständige Entwürfe für Tumblekin.
