# Tumblekin

Tumblekin ist ein mobile-first Partyspiel für bis zu vier Spieler im gleichen WLAN. Vier eigenständige Tumblekin erkunden drei lebendige 3D-Spielwelten und treten in 23 touch-optimierten Challenges gegeneinander an.

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
- Jedes Brett besitzt 32 Felder in vier Themenzonen und läuft als eine klare Schleife — keine Abzweigungen, damit der Weg auf dem Handy immer lesbar bleibt.
- Eine Kamera-State-Machine inszeniert Übersicht, Zugbeginn, Würfel, Laufweg, Landung, Ereignis und Rückkehr.
- Jeder Feldtyp hat eine eigene Pastellfarbe und ein eingelassenes Symbol; die genaue Wirkung erscheint bei der Landung.
- **Sterne gewinnen das Spiel, Münzen kaufen sie.** Ein Stern kostet 20 Münzen und steht immer auf genau einem von vier Sternenpodesten — landest oder läufst du darüber, ist er deiner, und er springt weiter.
- Der Stern leuchtet nur auf Podesten in Reichweite des hintersten Spielers, damit das Ziel die ganze Partie erreichbar bleibt.
- Feldsprache: Münzader (+6), Itemfeld, Glücksfeld (10 Münzen auf 50/50 für +25), Falle (-8), Sternenpodest, Challenge und Bandtor (+5 beim Passieren).
- **Items** werden vor dem Würfeln eingesetzt: Doppelwürfel, Goldwürfel, Tauschglocke, Klebefalle und Schutzschild. Maximal drei auf der Hand.
- Am Ende gibt es Bonus-Sterne für die meisten Münzen und die meisten Challenge-Siege — niemand ist vor dem letzten Wurf ausgeschieden.
- Nach fünf Runden gewinnen die meisten Sterne; Münzen entscheiden nur Gleichstände.

## 23 Challenges

Alle Challenges sind auf einen Blick verständlich, dauern nur wenige Sekunden und setzen auf Physik plus weiches Audio-Feedback (ASMR-Pops, Plinks und Klacks über Web Audio). Jede läuft als eigene Three.js-Szene mit den gemeinsamen Voxel-Figuren.

`client/src/minigames/catalog.js` ist die maßgebliche Liste — Titel, Geste und Kurzhilfe stammen von dort.

### Stick

- **Bumper Bloom:** Drängen, rammen, auf der Platte bleiben.
- **Farbenjagd:** Eine geteilte Fläche für alle. Färbe Felder in deiner Farbe — ein fremdes Feld musst du erst abtragen und dann beanspruchen, es kostet also doppelt. Gewertet wird die Fläche über die **Zeit**, nicht der Stand am Ende. Rempeln ist erlaubt, und die breite Rolle färbt fünf Felder auf einmal.

### Wischen

- **Zielgerade:** Hürden ausweichen, Boosts sammeln, Stachelkugeln nach vorn werfen.
- **Farbflucht:** Auf der angesagten Farbe stehen, bevor der Boden wegbricht.
- **Münzregen:** Spur wechseln, goldene Münzen fangen, schwarzen Bomben ausweichen.

### Tippen

- **Nervenprobe:** Die Uhr versteckt sich nach zwei Sekunden — so nah wie möglich an der Zielzeit stoppen.
- **Zündstoff:** Zündzeit merken und die Bombe rechtzeitig weitergeben.
- **Blob-Klopfe:** Blobs treffen, bevor sie abtauchen — die stacheligen auslassen.
- **Seilspringen:** Im richtigen Moment über das immer schnellere Riesenseil springen.
- **Messerwurf:** Ins drehende Scheibenholz treffen, ohne ein fremdes Messer zu erwischen.
- **Turmbau:** Den gleitenden Block im richtigen Moment stapeln.

### Schnell tippen

- **Pump-Panik:** Jeder Tap pumpt den Ballon größer — der dickste gewinnt.
- **Kanonenflug:** Erst die Kraft stoppen, dann den Winkel; volle Power bei 45° fliegt am weitesten.
- **Bergsteiger:** Abwechselnd links und rechts tippen und die Wand hochklettern.

### Ziehen und loslassen

- **Schleuderschuss:** Zug zurückziehen lädt Kraft, die Richtung bestimmt den Winkel. Eine Landevorschau zeigt live, wo der Stein aufkommt — und die Scheibe weicht nach jedem Schuss zurück.

### Im Takt

- **Trampolin:** Tippe genau im Takt, dann federst du höher. Treffer in Folge bauen Resonanz auf, ein Fehltritt bricht sie — und der Takt wird immer schneller.

### Blitzschnell tippen

- **Falschsignal:** Nur der runde grüne Kreis, der *bleibt*, ist echt. Falsche Farbe, falsche Form und der kurz aufblitzende Antäuscher kosten Punkte — schnell reagieren bringt mehr, zu schnell bringt Minus.

### Finger auf der Spur führen

- **Spurmaler:** Zieh den Finger auf der geschwungenen Spur nach oben und mal sie aus. Verlässt du das Toleranzband, reisst der Strich ab und du setzt an der Bruchstelle neu an. Jede geschaffte Runde bringt eine neue Kurve — saubere Runden zählen extra.

### Teller antippen

- **Tellerdreher:** Halte immer mehr Teller gleichzeitig am Drehen. Du hast nur **eine Hand**: jeder Griff kostet Vorrat, und ein Teller, der schon rund läuft, verschluckt ihn. Dauertippen bringt darum nichts — es geht ums Verteilen. Wer rot wackelt, braucht dich zuerst.

### Halten und im Schub loslassen

- **Angelduell:** Halten holt den Fisch ein und spannt die Schnur. Wenn er zieht, steigt die Spannung mehr als doppelt so schnell — dann loslassen, sonst reisst sie und der Fisch ist weg. Loslassen kostet aber Weg, also lohnt es, kurze Schübe auszureizen.

### Halten und loslassen

- **Sumo-Schubs:** Halten lädt den Stoss auf, Loslassen schubst den Stein weg — aber zu lange geladen heisst ausrutschen. Rollt der Stein über deine Kante, kassierst du einen Treffer; drei Treffer und du bist raus.

### Halten

- **Lichtwächter:** Laufen, solange der Knopf gehalten wird — sofort stoppen, wenn der Wächter sich umdreht.
- **Fassrolle:** Gegen das immer schnellere Riesenfass anlaufen, ohne abzurutschen.

Die Spiellogik und Wertung sind serverautoritativ. Sounds entstehen ohne Audiodateien über Web Audio; unterstützte Smartphones erhalten zusätzlich begrenztes Feedback über `navigator.vibrate`.

## Sandbox

`http://localhost:3000/sandbox.html` öffnet den Party-Baukasten: sechs Umgebungssets (Wiese, Strand, Stadt, Spielzimmer, Himmel, Fabrik), neun spawnbare Hindernisse (Kiste, Baumstamm, Pylone, Plattform, Tür, Rampe, Feder, Bumper, Drehstange), 1–4 KI-Testfiguren mit allen Animationen (Laufen, Springen, Stolpern, Jubeln, Traurig, Getroffen, Hinfallen) sowie Viewport-Presets für Hoch-/Querformat und Tablet. Tippen in die Welt schickt Spieler 1 dorthin. Die Bausteine (`src/sandbox/EnvironmentKit.js`, `src/minigames/VoxelKit.js` mit `KinAnimator`) sind die gemeinsame Grundlage aller 3D-Minispiele.

Jedes Minispiel startet mit einer einheitlichen Intro-Karte (Name, Ziel, Touch-Geste) und dem 3-2-1-LOS-Countdown; die Ergebnisse werden von Platz 4 bis Platz 1 aufgedeckt, Gleichstände bekommen ein eigenes Badge.

## Dev-Testmodus

Der Dev-Testmodus ist im normalen Spiel ausgeblendet und muss beim Serverstart freigegeben werden (`TUMBLEKIN_DEV_TOOLS=1 npm start`). Erst dann zeigt `http://localhost:3000/?dev=1` in der Lobby den Button `Dev-Test: 4 lokal`: Er erzeugt vier lokale Spieler auf einem Gerät. Auf dem Board kann jede der 23 Challenges direkt aus dem Katalog gestartet und zwischen allen vier Spielern gewechselt werden.

## Lokal testen

Regeln und Spiellogik auf dem Server:

```bash
npm test
```

Rauchtest im echten Browser — startet den Server auf einem freien Port, öffnet jedes Minispiel, spielt ein paar Sekunden und meldet Render- und Konsolenfehler:

```bash
npm run smoke                # alle 23 Minispiele
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
- Three.js rendert die drei datengetriebenen Spielwelten, vier animierte Figuren und alle 23 Challenges.
- Service Worker, Manifest und App-Icon erlauben die Installation auf dem Homescreen.

Gemeinsame Bausteine der Minispiele:

- `minigames/catalog.js` — maßgebliche Liste aller Challenges samt Geste und Hilfetext.
- `minigames/VoxelKit.js` — Voxel-Figuren, `KinAnimator`, Partikel (`CubeBurst`) und Pop-up-Texte (`FloatingText`).
- `minigames/SceneKit.js` — Renderer, Kamera, Licht, Resize und Teardown; jedes Minispiel baut nur noch seine eigene Welt.
- `minigames/Quality.js` — Bewegungspräferenz (`prefers-reduced-motion`) und Gerätestufe; steuert Kamera-Shake, Partikelmenge, Schattenauflösung und Pixelratio.

Alle Namen, Figuren, Regeln und visuellen Motive sind eigenständige Entwürfe für Tumblekin.
