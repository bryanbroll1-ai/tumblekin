# Tumblekin

Tumblekin ist ein mobile-first Partyspiel für bis zu vier Spieler im gleichen WLAN. Vier eigenständige Tumblekin erkunden drei lebendige 3D-Spielwelten und treten in 22 touch-optimierten Challenges gegeneinander an.

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

## 21 Challenges

Alle Challenges sind auf einen Blick verständlich, dauern nur wenige Sekunden und setzen auf Physik plus weiches Audio-Feedback (ASMR-Pops, Plinks und Klacks über Web Audio).

### Physik

- **Bumper Bloom:** Elastische 3D-Kugelkollisionen auf einer klar begrenzten Platte.
- **Plinko Falls:** Kugeln in die Peg-Kaskade fallen lassen — die Mitte zahlt am meisten.
- **Slide Stones:** Steine mit einem Wisch ins Ringziel schlittern lassen, Rempler erlaubt.
- **Bubble Bay:** Aufsteigende, wabbelnde Blasen im richtigen Moment zerplatzen.
- **Vine Vault:** Links/Rechts-Sprünge über tragende Blätter.
- **Glow Grid:** Gemeinsame Arena färben und Rivalen verdrängen.
- **Cloudbreak:** Warnsignale lesen und ausweichen.
- **Pulse Pin:** Einen Energiepuls im Zielsektor stoppen.

### Ein Tap

- **Orbit Drop** und **Tide Tap** erlauben genau einen Versuch pro Umlauf. Bei Tide Tap wechselt der Zielkamm.

### Ein Joystick

- **Coin Sweep**, **Ice Drift**, **Magnet Mates**, **Gravity Garden** und **Drift Docks** verwenden nur den mittigen Stick.

### Direktes Berühren

- **Coin Sort** und **Bubble Bay** werden direkt im Vollbild-Spielfeld angetippt, **Lantern Lift** und **Balance Brew** per horizontalem Ziehen gesteuert.

### Vertical-Slice-Neuzugänge

- **Sekundenjäger:** Zeit merken, dann die verhüllte Uhr blind im richtigen Moment stoppen — die kleinste Abweichung gewinnt.
- **Zielgerade:** Ein 3D-Sprint über drei Spuren; per Wisch die Spur wechseln, Hürden ausweichen, Boostfelder mitnehmen, als Erster ins Ziel.
- **Farbflucht:** Ein 3D-Farbfeld-Duell; auf der angesagten Farbe stehen, bevor der Boden wegbricht — die meisten überlebten Runden gewinnen.

Die Spiellogik und Wertung sind serverautoritativ. Sounds entstehen ohne Audiodateien über Web Audio; unterstützte Smartphones erhalten zusätzlich begrenztes Feedback über `navigator.vibrate`.

## Sandbox

`http://localhost:3000/sandbox.html` öffnet den Party-Baukasten: sechs Umgebungssets (Wiese, Strand, Stadt, Spielzimmer, Himmel, Fabrik), neun spawnbare Hindernisse (Kiste, Baumstamm, Pylone, Plattform, Tür, Rampe, Feder, Bumper, Drehstange), 1–4 KI-Testfiguren mit allen Animationen (Laufen, Springen, Stolpern, Jubeln, Traurig, Getroffen, Hinfallen) sowie Viewport-Presets für Hoch-/Querformat und Tablet. Tippen in die Welt schickt Spieler 1 dorthin. Die Bausteine (`src/sandbox/EnvironmentKit.js`, `src/minigames/VoxelKit.js` mit `KinAnimator`) sind die gemeinsame Grundlage aller 3D-Minispiele.

Jedes Minispiel startet mit einer einheitlichen Intro-Karte (Name, Ziel, Touch-Geste) und dem 3-2-1-LOS-Countdown; die Ergebnisse werden von Platz 4 bis Platz 1 aufgedeckt, Gleichstände bekommen ein eigenes Badge.

## Dev-Testmodus

Der Dev-Testmodus ist im normalen Spiel ausgeblendet. Mit `http://localhost:3000/?dev=1` erscheint in der Lobby der Button `Dev-Test: 4 lokal`: Er erzeugt vier lokale Spieler auf einem Gerät. Auf dem Board kann jede der 21 Challenges direkt aus dem Katalog gestartet und zwischen allen vier Spielern gewechselt werden.

## Architektur

- Express liefert PWA, Three.js und Clientmodule aus.
- Socket.io synchronisiert Raum, Board, Challenge-Inputs, Resultate und Reconnects.
- Three.js rendert die drei datengetriebenen Spielwelten, vier animierte Figuren und Bumper Bloom.
- Responsive Canvas-Renderer zeichnen die restlichen Challenges im Vollbild.
- `PocketArcade.js` stellt gemeinsame Eingabe- und Renderpfade für 12 kompakte Spiele bereit.
- Service Worker, Manifest und App-Icon erlauben die Installation auf dem Homescreen.

Alle Namen, Figuren, Regeln und visuellen Motive sind eigenständige Entwürfe für Tumblekin.
