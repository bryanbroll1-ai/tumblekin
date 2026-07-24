# Tumblekin

Tumblekin ist ein mobile-first Partyspiel für bis zu vier Spieler im gleichen WLAN. Vier eigenständige Tumblekin erkunden drei lebendige 3D-Spielwelten und treten in 15 touch-optimierten Challenges gegeneinander an.

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

1. Rechner und Smartphones mit demselben WLAN verbinden.
2. Auf einem Gerät eine Party starten.
3. Den QR-Code scannen oder die WLAN-Adresse plus Raumcode verwenden.
4. Sobald alle Spieler bereit sind, startet der Host die Runde.

Eine Runde braucht mindestens zwei Teilnehmer. Wer allein ist, füllt die Lobby mit **Mit Bots auffüllen** auf — die Bots würfeln selbst und spielen alle Challenges mit.

Bei einem kurzen WLAN-Hänger oder Reload stellt der Client die laufende Sitzung automatisch wieder her. Es gibt bewusst keine Host-Migration: Bleibt der Host offline, werden Host-Aktionen gesperrt und alle Spieler sehen eine Fehlermeldung.

## Die Spielwelten

- **Runa, die Wurzelwanderin:** Wurzelpfade auf dem Rücken einer lebenden Waldhüterin mit Herzbaum und Pilzmarkt.
- **Kesselwinds Wolkenküche:** Eine ansteigende Dampfspirale zwischen Kochinseln, einem lebendigen Kessel und hüpfenden Wolkenköchen.
- **Gezeitenwerk Nautilus:** Ein Rundweg über Zahnräder, Turbine, Leuchtturm und eine winzige Wartungscrew.
- Jedes Brett besitzt 32 Felder, vier Themenzonen, vier Abzweigungen und eine eigene kostenpflichtige Abkürzung.
- Eine Kamera-State-Machine inszeniert Übersicht, Zugbeginn, Würfel, Laufweg, Landung, Ereignis und Rückkehr.
- Jeder Feldtyp hat eine eigene Pastellfarbe und ein eingelassenes Symbol; die genaue Wirkung erscheint bei der Landung.
- Münzen sind die einzige Brettwährung. Jedes passierte Bandtor zahlt fünf Bonusmünzen aus.
- Münz-, Haken-, Rückenwind-, Stupser- und Challenge-Felder haben jeweils eine eindeutige Wirkung.
- Stupser bremsen vor dem Würfeln automatisch den in der Gesamtwertung führenden Rivalen.
- Nach fünf Runden gewinnen die meisten Münzen.

## 15 Challenges

Alle Challenges sind auf einen Blick verständlich, dauern nur wenige Sekunden und setzen auf Physik plus weiches Audio-Feedback (ASMR-Pops, Plinks und Klacks über Web Audio). Jede läuft als eigene Three.js-Szene mit den gemeinsamen Voxel-Figuren.

`client/src/minigames/catalog.js` ist die maßgebliche Liste — Titel, Geste und Kurzhilfe stammen von dort.

### Stick

- **Bumper Bloom:** Drängen, rammen, auf der Platte bleiben.

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

### Halten

- **Lichtwächter:** Laufen, solange der Knopf gehalten wird — sofort stoppen, wenn der Wächter sich umdreht.
- **Fassrolle:** Gegen das immer schnellere Riesenfass anlaufen, ohne abzurutschen.

Die Spiellogik und Wertung sind serverautoritativ. Sounds entstehen ohne Audiodateien über Web Audio; unterstützte Smartphones erhalten zusätzlich begrenztes Feedback über `navigator.vibrate`.

## Sandbox

`http://localhost:3000/sandbox.html` öffnet den Party-Baukasten: sechs Umgebungssets (Wiese, Strand, Stadt, Spielzimmer, Himmel, Fabrik), neun spawnbare Hindernisse (Kiste, Baumstamm, Pylone, Plattform, Tür, Rampe, Feder, Bumper, Drehstange), 1–4 KI-Testfiguren mit allen Animationen (Laufen, Springen, Stolpern, Jubeln, Traurig, Getroffen, Hinfallen) sowie Viewport-Presets für Hoch-/Querformat und Tablet. Tippen in die Welt schickt Spieler 1 dorthin. Die Bausteine (`src/sandbox/EnvironmentKit.js`, `src/minigames/VoxelKit.js` mit `KinAnimator`) sind die gemeinsame Grundlage aller 3D-Minispiele.

Jedes Minispiel startet mit einer einheitlichen Intro-Karte (Name, Ziel, Touch-Geste) und dem 3-2-1-LOS-Countdown; die Ergebnisse werden von Platz 4 bis Platz 1 aufgedeckt, Gleichstände bekommen ein eigenes Badge.

## Dev-Testmodus

Der Dev-Testmodus ist im normalen Spiel ausgeblendet. Mit `http://localhost:3000/?dev=1` erscheint in der Lobby der Button `Dev-Test: 4 lokal`: Er erzeugt vier lokale Spieler auf einem Gerät. Auf dem Board kann jede der 15 Challenges direkt aus dem Katalog gestartet und zwischen allen vier Spielern gewechselt werden.

## Lokal testen

Regeln und Spiellogik auf dem Server:

```bash
npm test
```

Rauchtest im echten Browser — startet den Server auf einem freien Port, öffnet jedes Minispiel, spielt ein paar Sekunden und meldet Render- und Konsolenfehler:

```bash
npm run smoke                # alle 15 Minispiele
npm run smoke -- turmbau     # nur ausgewählte
npm run smoke -- --head      # sichtbares Browserfenster zum Zuschauen
```

Der Rauchtest braucht einmalig einen Browser:

```bash
npm install --no-save playwright
npx playwright install chromium
```

Ein bereits installiertes Chrome/Chromium lässt sich stattdessen über `CHROMIUM_PATH=/pfad/zu/chrome` verwenden. Der Server wird automatisch gestartet und wieder beendet; der Exit-Code ist 0 nur, wenn alle geprüften Minispiele sauber rendern.

## Architektur

- Express liefert PWA, Three.js und Clientmodule aus.
- Socket.io synchronisiert Raum, Board, Challenge-Inputs, Resultate und Reconnects.
- Three.js rendert die drei datengetriebenen Spielwelten, vier animierte Figuren und alle 15 Challenges.
- Service Worker, Manifest und App-Icon erlauben die Installation auf dem Homescreen.

Gemeinsame Bausteine der Minispiele:

- `minigames/catalog.js` — maßgebliche Liste aller Challenges samt Geste und Hilfetext.
- `minigames/VoxelKit.js` — Voxel-Figuren, `KinAnimator`, Partikel (`CubeBurst`) und Pop-up-Texte (`FloatingText`).
- `minigames/SceneKit.js` — Renderer, Kamera, Licht, Resize und Teardown; jedes Minispiel baut nur noch seine eigene Welt.
- `minigames/Quality.js` — Bewegungspräferenz (`prefers-reduced-motion`) und Gerätestufe; steuert Kamera-Shake, Partikelmenge, Schattenauflösung und Pixelratio.

Alle Namen, Figuren, Regeln und visuellen Motive sind eigenständige Entwürfe für Tumblekin.
