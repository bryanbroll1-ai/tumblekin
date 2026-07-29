# Store-Release: Stand und offene Punkte

Dieses Dokument sagt, was für eine Veröffentlichung erledigt ist, was noch
fehlt, und warum der aktuelle Aufbau so nicht in einen Store kann.

## Der eigentliche Blocker: die Architektur

Tumblekin ist heute ein **LAN-Spiel mit selbst gehostetem Server**. Jemand
startet `npm start` auf einem Rechner, die Mitspieler öffnen
`http://192.168.x.x:3000` im Browser. Eine Store-App hat keinen solchen Server
und kein Gerät im Store startet Node.

Es gibt drei Wege. Sie unterscheiden sich stark in Aufwand und Folgekosten:

### A) Gehostetes Backend + native Hülle (empfohlen)

Der Server läuft in der Cloud, die App verbindet sich dorthin. Raumcodes
funktionieren dann weltweit, nicht nur im gleichen WLAN.

- Server deployen, HTTPS/WSS verpflichtend (App Store und Play verlangen
  verschlüsselte Verbindungen; unsere aktuelle HTTP-Verbindung würde abgelehnt).
- Native Hülle mit Capacitor um den Client.
- Laufende Serverkosten und eine Verfügbarkeitszusage — das Spiel ist ohne
  Server unbrauchbar, was Apple bei „App funktioniert nicht" bemängelt.
- Nötig: Reconnect-Verhalten bei Mobilfunkwechsel sowie Regionen/Latenz. Der
  Grundschutz gegen Raum-Flooding ist eingebaut, für den öffentlichen Betrieb
  käme eine Begrenzung pro echter IP hinter dem Reverse Proxy dazu.

### B) Peer-to-peer statt Server

Der Host wird selbst zum Server, über WebRTC-Datenkanäle zwischen den Geräten.

- Kein Backend, keine laufenden Kosten, das „gleiches WLAN"-Gefühl bleibt.
- Aber: die gesamte serverautoritative Spiellogik müsste auf das Host-Gerät
  wandern, plus Signalisierung (ein kleiner Dienst bleibt nötig) und
  Host-Migration, wenn der Host das Spiel verlässt.
- Der grösste Umbau der drei Wege, langfristig aber der günstigste.

### C) Nur Play Store als PWA (schnellster Weg)

Google akzeptiert PWAs als Trusted Web Activity.

- Braucht eine gehostete HTTPS-Domain und einen Digital-Asset-Links-Nachweis.
- Deckt **nur Android** ab. Apple lehnt reine Web-View-Hüllen nach Richtlinie
  4.2 regelmässig ab.
- Server-Frage bleibt trotzdem offen (siehe A).

**Empfehlung:** Weg A für ein erstes Release, weil er die vorhandene
serverautoritative Logik unverändert weiternutzt. Weg B lohnt, wenn keine
laufenden Kosten entstehen sollen.

## Erledigt

| Bereich | Stand |
| --- | --- |
| Lizenzen | `LICENSE` (MIT) und `THIRD-PARTY-NOTICES.md` mit allen vier Abhängigkeiten — bei Distribution rechtlich verpflichtend |
| Datenschutz | `PRIVACY.md`, belegt durch Audit: keine Analytics, keine externen Aufrufe, Server speichert nichts auf Platte |
| Icons | 144/180/192/384/512/1024 plus Maskable-Variante, reproduzierbar über `npm run icons` |
| Manifest | `id`, `scope`, `orientation`, `categories`, `display_override`, vollständige Icon-Liste |
| Dev-Werkzeug | hinter `TUMBLEKIN_DEV_TOOLS=1`; ohne die Variable lehnt der Server es ab, ein URL-Parameter allein reicht nicht mehr |
| Version im UI | im Spielmenü sichtbar, für Supportanfragen |
| Absturzschutz | Fehler im Gameloop beenden den Prozess nicht mehr; per Gegenprobe belegt |
| Barrierefreiheit | Fokusringe für Tastatur/Switch, `prefers-reduced-motion` wirkt auch auf die 3D-Szenen |
| Gerätestufen | schwache Hardware bekommt weniger Pixel, kleinere Schattenmaps, kein Antialiasing |
| Missbrauchsschutz | Raum-Flooding begrenzt (Cooldown, Gerätelimit, Gesamtobergrenze). Vorher legten 60 Verbindungen 60 Räume an, jetzt 1 von 40 im Burst — regulärer Beitritt unbeeinträchtigt |
| Tests | 179 Regeltests, Browser-Rauchtest über alle Minispiele, Board-Simulator fürs Balancing |
| Bot-Stärken | belegt: in allen 22 Minispiel-Familien gewinnt die starke Stufe häufiger als die schwache (200 Partien je Spiel, Startplätze rotiert) |

## Offen vor einem Release

**Blockierend**

- Distributionsweg entscheiden und umsetzen (Abschnitt oben).
- HTTPS/WSS erzwingen; aktuell läuft alles unverschlüsselt über HTTP.
- Kontaktadresse und Impressum in `PRIVACY.md` und den Store-Angaben eintragen.
- Altersfreigabe beantragen (IARC). Inhalte sind harmlos, aber die Einstufung
  ist Pflicht.
- Store-Screenshots in den vorgeschriebenen Formaten.

**Wichtig, nicht blockierend**

- Inhaltsumfang: 23 von 30 geplanten Minispielen (Plan unten).
- Nur eine Sprache (Deutsch). Store-Reichweite verlangt praktisch Englisch.
- Kein Onboarding-Tutorial für die erste Partie.
- Keine Fehlerberichterstattung; ein Absturz beim Spieler bleibt unsichtbar.
- Test auf echten Geräten und in Safari/Firefox steht aus — bisher nur
  headless Chromium.

## Fahrplan auf 30 Minispiele

Die ursprünglichen 15 deckten nur fünf Mechanik-Archetypen ab, und **Tippen war
mit sechs Spielen überrepräsentiert**. Die 15 neuen sind deshalb nach fehlenden
Archetypen ausgewählt, nicht nach Thema — so unterscheiden sie sich wirklich,
statt nur anders auszusehen.

Vorhandene Verteilung: Präzisionstiming (4), Mashing (3), Steuern (4),
Halten/Loslassen (2), Gedächtnis (1). Dazu neu: Zielen mit Zugkraft,
Aufladen/Stossen, Rhythmus, Reaktion gegen Täuschung, Pfadverfolgung,
Aufmerksamkeit teilen, Widerstand ausspielen und Flächenkontrolle.

| # | Titel | Archetyp (neu) | Geste | Physik/Animation |
| --- | --- | --- | --- | --- |
| ~~16~~ | ~~Schleuderschuss~~ | Zielen mit Zugkraft | ziehen + loslassen | **fertig** — Ballistik serverseitig, Landevorschau im Client |
| 17 | Wackelturm | Konstruktion mit echtem Einsturz | ziehen | Starrkörper-Stapel, Kollaps |
| 18 | Seifenkiste | Neigungssteuerung | Gerät kippen | Rampen, Federung, Drift |
| 19 | Eierlauf | Balance halten (inverses Pendel) | Mikro-Kippen | Pendelphysik am Löffel |
| ~~20~~ | ~~Tellerdreher~~ | Mehrere Objekte gleichzeitig halten | tippen (statt wischen) | **fertig** — Handvorrat serverseitig; Tippen statt Wischen, weil sechs Ziele auf dem Handy gezielt getroffen werden müssen |
| ~~21~~ | ~~Angelduell~~ | Widerstand ausspielen | halten + im Schub loslassen | **fertig** — Schnurspannung und Kampfplan serverseitig, Gier gegen Riss |
| ~~22~~ | ~~Sumo-Schubs~~ | Aufladen und stossen | halten + loslassen | **fertig** — Steinphysik serverseitig, Überladen rutscht aus |
| ~~23~~ | ~~Trampolin~~ | Rhythmus-Timing | Takt-Tippen | **fertig** — Taktplan serverseitig, Resonanz und Taktanzeige |
| 24 | Kranstapler | Trägheit zähmen | tippen + ziehen | Pendelnde Last am Seil |
| 25 | Dominofall | Planen, dann Kettenreaktion | tippen-platzieren | Dominoketten-Physik |
| ~~26~~ | ~~Farbenjagd~~ | Flächenkontrolle | Stick | **fertig** — geteilte Fläche, Anspruch statt Treffer, gewertet über die Zeit |
| ~~27~~ | ~~Spurmaler~~ | Pfad nachfahren | Finger führen | **fertig** — Kurve und Toleranzband serverseitig, Eingabe per Strahl auf die Tafel |
| 28 | Doppelgriff | Zwei Finger koordinieren | Multitouch | Zwei gekoppelte Körper |
| ~~29~~ | ~~Falschsignal~~ | Reaktion gegen Täuschung | tippen | **fertig** — Signalplan serverseitig, drei Fälschungsarten plus Antäuscher |
| 30 | Kartenbluff | Verdeckte Information | tippen | Reaktionen der Figuren aufs Bluffen |

Zwei Punkte, die beim Umsetzen Arbeit bedeuten:

- **Neigungssteuerung (18, 19)** braucht `DeviceOrientationEvent`. Auf iOS ist
  dafür eine ausdrückliche Nutzerfreigabe nötig, und im Browser ohne HTTPS gibt
  es die Sensoren gar nicht. Diese beiden Spiele setzen also Weg A oder C voraus
  und brauchen einen Ersatzpfad (Wischen) für Geräte ohne Sensor.
- **Einstürzende Stapel und Kettenreaktionen (17, 24, 25)** laufen über ein
  vereinfachtes Servermodell plus überzeugende Client-Animation, nicht über eine
  Physik-Bibliothek. Turmbau macht es heute schon so: gescriptet statt
  simuliert, und die visuelle Wirkung kommt aus der Animation. Das erspart eine
  neue Abhängigkeit und hält den 90-ms-Tick auch auf einem Gratis-Server
  bezahlbar.

`client/src/minigames/SceneKit.js`, `VoxelKit.js` und `Quality.js` tragen die
gemeinsame Grundlage; ein neues Minispiel baut nur noch seine eigene Welt und
seine Regeln. Serverseitig kommt je Spiel ein Zustandsobjekt und ein
Eingabe-Handler dazu, plus Einträge in `MINIGAMES` und `catalog.js`.
