# Tumblekin

Tumblekin ist ein mobile-first Partyspiel für bis zu vier Spieler im gleichen WLAN. Vier eigenständige Tumblekin erkunden drei lebendige 3D-Spielwelten und treten in 30 touch-optimierten Challenges gegeneinander an.

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
4. Sobald alle Spieler bereit sind, startet der Host die Runde.

Eine Runde braucht mindestens zwei Teilnehmer. Wer allein ist, füllt die Lobby mit **Mit Bots auffüllen** auf — die Bots würfeln selbst und spielen alle Challenges mit. Sie treten in drei Stärken an; dass die stärkere in jedem Minispiel tatsächlich häufiger gewinnt, ist über je 200 Testpartien nachgemessen.

Bei einem kurzen WLAN-Hänger oder Reload stellt der Client die laufende Sitzung automatisch wieder her. Es gibt bewusst keine Host-Migration: Bleibt der Host offline, werden Host-Aktionen gesperrt und alle Spieler sehen eine Fehlermeldung.

## Die Spielwelten

- **Runa, die Wurzelwanderin:** Wurzelpfade auf dem Rücken einer lebenden Waldhüterin mit Herzbaum und Pilzmarkt.
- **Kesselwinds Wolkenküche:** Eine ansteigende Dampfspirale zwischen Kochinseln, einem lebendigen Kessel und hüpfenden Wolkenköchen.
- **Gezeitenwerk Nautilus:** Ein Rundweg über Zahnräder, Turbine, Leuchtturm und eine winzige Wartungscrew.
- Jedes Brett besitzt 32 Felder in vier Themenzonen und läuft als eine klare Schleife. Zwei Stellen je Brett bieten eine echte Wahl: dort fragt das Spiel, ob du den Hauptweg nimmst oder die Abkürzung — sonst bestimmte der Würfel alles und du nichts.
- Eine Kamera-State-Machine inszeniert Übersicht, Zugbeginn, Würfel, Laufweg, Landung, Ereignis und Rückkehr.
- Jeder Feldtyp hat eine eigene Pastellfarbe und ein eingelassenes Symbol; die genaue Wirkung erscheint bei der Landung.
- **Sterne gewinnen das Spiel, Münzen kaufen sie.** Ein Stern kostet 20 Münzen und steht immer auf genau einem von vier Sternenpodesten — landest oder läufst du darüber, ist er deiner, und er springt weiter.
- Der Stern leuchtet nur auf Podesten in Reichweite des hintersten Spielers, damit das Ziel die ganze Partie erreichbar bleibt.
- Feldsprache: Münzader (+6), Itemfeld, Glücksfeld (10 Münzen auf 50/50 für +25), Falle (-8), Sternenpodest, Challenge und Bandtor (+5 beim Passieren).
- **Items** werden vor dem Würfeln eingesetzt: Doppelwürfel, Goldwürfel, Tauschglocke, Klebefalle und Schutzschild. Maximal drei auf der Hand.
- Am Ende gibt es Bonus-Sterne für die meisten Münzen und die meisten Challenge-Siege — niemand ist vor dem letzten Wurf ausgeschieden.
- Nach fünf Runden gewinnen die meisten Sterne; Münzen entscheiden nur Gleichstände.

## 30 Challenges

Alle Challenges sind auf einen Blick verständlich, dauern nur wenige Sekunden und
setzen auf Physik plus weiches Audio-Feedback (ASMR-Pops, Plinks und Klacks über
Web Audio). Jede läuft als eigene Three.js-Szene mit den gemeinsamen Voxel-Figuren.

Diese Liste stammt Wort für Wort aus `client/src/minigames/catalog.js` — dieselbe
Kurzhilfe, die im Spiel auf der Startkarte steht. Sie von Hand nachzuführen ging
zweimal schief: hier standen zuletzt zwei längst gelöschte Minispiele, und drei
neue fehlten. Ein Test hält jetzt fest, dass jeder Katalogeintrag auch hier auftaucht.

### 🕹️ Stick ziehen

- **Bumper Bloom:** Drängen, rammen, auf der Platte bleiben.
- **Farbenjagd:** Färbe die Fläche in deiner Farbe — fremde Felder darfst du übermalen, das bringt dir eins und nimmt dem anderen eins. Rempeln erlaubt, und die breite Rolle färbt fünf Felder auf einmal.

### 👆↔️ Links/Rechts wischen

- **Zielgerade:** Wisch nach links oder rechts, um die Bahn zu wechseln. Weich den Hürden aus, sammle Boosts — und wenn du eine Stachelkugel hast, tippe, um sie auf die Läufer vor dir zu werfen.
- **Münzregen:** Wisch nach links oder rechts, um die Spur zu wechseln. Fang die goldenen Münzen und weich den schwarzen Bomben aus.

### 👆✳️ In jede Richtung wischen

- **Farbflucht:** Wisch in die Richtung, in der die angesagte Farbe liegt, und steh darauf, bevor der Boden wegbricht.

### 👆 Tippen

- **Nervenprobe:** Die Uhr versteckt sich nach 2 Sekunden. Drück den Knopf so nah wie möglich an der Zielzeit.
- **Zündstoff:** Die Zündzeit blinkt kurz auf – merk sie dir und gib die Bombe rechtzeitig weiter! Wer sie beim Knall hält, ist raus.
- **Blob-Klopfe:** Blobs poppen aus den Löchern – tipp ihr Feld, bevor sie abtauchen. Finger weg von den stacheligen!
- **Seilspringen:** Das Riesenseil wird immer schneller. Spring im richtigen Moment – einmal gestolpert und du bist raus.
- **Messerwurf:** Reihum je ein Wurf in den drehenden Stamm. Wirf dahin, wo am meisten Platz ist – wer knapp neben ein fremdes Messer setzt, hat Glück gehabt, nicht gut gezielt. Zweimal dagegen und du bist raus. Der Stamm wird jede Runde schneller.
- **Turmbau:** Tippe im richtigen Moment, um den gleitenden Block zu stapeln. Der höchste Turm gewinnt!

### 👆⏺️ Knopf gedrückt halten

- **Lichtwächter:** Halte den Knopf, um zu laufen – aber stopp sofort, wenn der Wächter sich umdreht!
- **Fassrolle:** Das Riesenfass rollt immer schneller. Halte ◀ oder ▶ und lauf dagegen an – wer abrutscht, platscht ins Wasser.
- **Ballonfahrt:** Halte den Finger auf dem Bild, dann steigt dein Ballon — loslassen lässt ihn sinken. Flieg durch die Tore, mittig durch bringt mehr, und Boden oder Decke schalten den Brenner kurz ab.

### 👆👆 Schnell tippen

- **Pump-Panik:** Tippe so schnell du kannst! Jeder Tap pumpt deinen Ballon größer – der dickste Ballon gewinnt.
- **Kanonenflug:** Tipp 1 stoppt die Kraft, Tipp 2 den Abschusswinkel. Volle Power bei 45° fliegt am weitesten!
- **Bergsteiger:** Tippe abwechselnd auf die linke und die rechte Bildhälfte — jede Seite ist eine Hand. Die falsche Seite kostet den Griff. Wer am höchsten kommt, gewinnt.

### 👆💪 Halten und loslassen

- **Sumo-Schubs:** Halten lädt deinen Schlag auf — halten kostet nichts, es ist deine Deckung. Loslassen schlägt den Stein aber NUR, wenn er schon in deinem Viertel ist; daneben holst du ins Leere aus und stehst kurz ungedeckt da. Am meisten Wucht hat ein Konter gegen den heranrollenden Stein.

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

- **Angelduell:** Halten holt den Fisch ein und spannt die Schnur. Wenn er zieht, steigt die Spannung viel schneller — dann loslassen, sonst reisst sie. Vier Arten beissen: die Sprotte kommt leicht und bringt wenig, der Wels bringt fünfmal so viel und zieht so hart, dass ein Moment Unachtsamkeit die Schnur kostet.

### 👆🧠 Folge nachtippen

- **Leuchtfolge:** Vier Pilze stehen bereit. Eine Folge leuchtet auf — tippe sie danach in derselben Reihenfolge nach. Sie fängt bei zwei an und wird jede Runde einen länger. Ein Fehler beendet nur die laufende Runde, die nächste zählt wieder.

### 👆🎯 Tippen und stupsen

- **Nagelbrett:** Tippe oben, wo die Kugel fallen soll — die Mitte ist am meisten wert. Während sie fällt, hast du GENAU einen Stups: tippe links oder rechts, um sie noch einmal zu lenken.

### 👆➡️ Nach vorne wischen

- **Eisstock:** Wisch nach vorne, um einen Stein zu schieben — je länger der Wisch, desto weiter fliegt er. Drei Steine pro Person, und je näher an der Mitte, desto mehr – ganz am Knopf zählt mehr als am Ringrand. Rempeln ist erlaubt, nimmt aber meist beide Steine aus dem Haus: lohnt sich nur, wenn du sowieso hinten liegst.

### 👆⛏️ Graben oder aufhören

- **Tiefenrausch:** Tippen gräbt eine Stufe tiefer und bringt Gold — aber jeder Stollen kann einstürzen, und dann ist alles weg, was noch unten hängt. Das Risiko der nächsten Stufe steht genau im Bild. Wisch nach oben, um deine Beute sicher einzuzahlen.

### 👆🧭 Felder antippen und schliessen

- **Spürsinn:** Irgendwo im Feld liegt ein Fundstück. Tippe ein Feld an, und die Zahl darauf sagt, wie viele Schritte es von dort bis zum Versteck sind — hoch, runter, links, rechts gezählt. Zwei Zahlen zusammengenommen grenzen es schon stark ein. Je weniger Tipps ein Fund kostet, desto mehr ist er wert.

### 👆📏 Regler auf die Schätzung ziehen

- **Augenmaß:** Ein Schwarm Glühkäfer blitzt anderthalb Sekunden auf — dann sind sie weg und du schätzt, wie viele es waren. Zieh den Regler auf deine Zahl. Vier Durchgänge, und der Schwarm wird jedes Mal grösser: zählen klappt am Anfang noch, später nicht mehr. Je näher an der echten Zahl, desto mehr Punkte.

## Sandbox

`http://localhost:3000/sandbox.html` öffnet den Party-Baukasten: sechs Umgebungssets (Wiese, Strand, Stadt, Spielzimmer, Himmel, Fabrik), neun spawnbare Hindernisse (Kiste, Baumstamm, Pylone, Plattform, Tür, Rampe, Feder, Bumper, Drehstange), 1–4 KI-Testfiguren mit allen Animationen (Laufen, Springen, Stolpern, Jubeln, Traurig, Getroffen, Hinfallen) sowie Viewport-Presets für Hoch-/Querformat und Tablet. Tippen in die Welt schickt Spieler 1 dorthin. Die Bausteine (`src/sandbox/EnvironmentKit.js`, `src/minigames/VoxelKit.js` mit `KinAnimator`) sind die gemeinsame Grundlage aller 3D-Minispiele.

Jedes Minispiel startet mit einer einheitlichen Intro-Karte (Name, Ziel, Touch-Geste) und dem 3-2-1-LOS-Countdown; die Ergebnisse werden von Platz 4 bis Platz 1 aufgedeckt, Gleichstände bekommen ein eigenes Badge.

## Dev-Testmodus

Der Dev-Testmodus ist im normalen Spiel ausgeblendet und muss beim Serverstart freigegeben werden (`TUMBLEKIN_DEV_TOOLS=1 npm start`). Erst dann zeigt `http://localhost:3000/?dev=1` in der Lobby den Button `Dev-Test: 4 lokal`: Er erzeugt vier lokale Spieler auf einem Gerät. Auf dem Board kann jede der 30 Challenges direkt aus dem Katalog gestartet und zwischen allen vier Spielern gewechselt werden.

## Lokal testen

Regeln und Spiellogik auf dem Server:

```bash
npm test
```

Rauchtest im echten Browser — startet den Server auf einem freien Port, öffnet jedes Minispiel, spielt ein paar Sekunden und meldet Render- und Konsolenfehler:

```bash
npm run smoke                # alle 30 Minispiele
npm run smoke -- turmbau     # nur ausgewählte
npm run smoke -- --head      # sichtbares Browserfenster zum Zuschauen
```

Der Rauchtest braucht einmalig einen Browser:

```bash
npm install --no-save playwright
npx playwright install chromium
```

Ein bereits installiertes Chrome/Chromium lässt sich stattdessen über `CHROMIUM_PATH=/pfad/zu/chrome` verwenden. Der Server wird automatisch gestartet und wieder beendet; der Exit-Code ist 0 nur, wenn alle geprüften Minispiele sauber rendern.

Balance des Bretts prüfen — spielt komplette Partien gegen den echten Server und berichtet, ob der Stern wandert, gekauft wird und alle Feldtypen feuern:

```bash
npm run board-sim            # eine Partie
npm run board-sim -- 3       # drei Partien mit Sammelbilanz
```

Braucht einmalig `npm install --no-save socket.io-client`. Wird in keiner Partie ein Stern gekauft, endet der Lauf mit Exit-Code 1 — genau dieser Fall hat aufgedeckt, dass ein zufällig platzierter Stern eine ganze Runde unerreichbar bleiben kann.

## Veröffentlichung

`RELEASE.md` beschreibt den Stand für ein Store-Release: was erledigt ist, was
noch fehlt, und warum der heutige LAN-Aufbau mit selbst gehostetem Server so
nicht in einen Store kann. Dort steht auch der Fahrplan von 15 auf 30
Minispiele.

Entwickler-Werkzeug (vier lokale Spieler, Challenges direkt starten) ist in
Produktion aus und wird über eine Umgebungsvariable eingeschaltet:

```bash
TUMBLEKIN_DEV_TOOLS=1 npm start
```

Rechtliches: `LICENSE` (MIT), `THIRD-PARTY-NOTICES.md` für die eingebundenen
Bibliotheken und `PRIVACY.md` als Datenschutzerklärung. Icons lassen sich mit
`npm run icons` neu erzeugen.

## Architektur

- Express liefert PWA, Three.js und Clientmodule aus.
- Socket.io synchronisiert Raum, Board, Challenge-Inputs, Resultate und Reconnects.
- Three.js rendert die drei datengetriebenen Spielwelten, vier animierte Figuren und alle 30 Challenges.
- Service Worker, Manifest und App-Icon erlauben die Installation auf dem Homescreen.

Gemeinsame Bausteine der Minispiele:

- `minigames/catalog.js` — maßgebliche Liste aller Challenges samt Geste und Hilfetext.
- `minigames/VoxelKit.js` — Voxel-Figuren, `KinAnimator`, Partikel (`CubeBurst`) und Pop-up-Texte (`FloatingText`).
- `minigames/SceneKit.js` — Renderer, Kamera, Licht, Resize und Teardown; jedes Minispiel baut nur noch seine eigene Welt.
- `minigames/Quality.js` — Bewegungspräferenz (`prefers-reduced-motion`) und Gerätestufe; steuert Kamera-Shake, Partikelmenge, Schattenauflösung und Pixelratio.

Alle Namen, Figuren, Regeln und visuellen Motive sind eigenständige Entwürfe für Tumblekin.
