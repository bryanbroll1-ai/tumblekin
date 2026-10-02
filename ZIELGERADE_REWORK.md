# Zielgerade: 100-Meter-Hürdensprint

Die bisherige Mischung aus wechselnden Belägen, Bahnwechseln, Heuballen und Hürden wurde ersetzt. Vier Personen hatten nur drei Bahnen; die Trefferprüfung akzeptierte jeden laufenden Sprung, während die Szene Figuren vor Hürden zusätzlich anhob. Damit erklärten sichtbare Bewegung und tatsächliches Ergebnis einander nicht zuverlässig.

## Neuer Ablauf

- Jede Person erhält eine eigene, farblich markierte Bahn. Alle laufen denselben 100-Meter-Kurs mit sieben Hürden; kleine Abstandsvariationen gelten für alle gleich.
- Ohne Eingabe wird gejoggt. SPRINT halten beschleunigt und verbraucht Ausdauer; Loslassen regeneriert am Boden. Ganz leere Ausdauer schaltet den Sprint bis 30 % Erholung ab.
- SPRUNG tippen startet eine ballistische Flugbahn. Absprunggeschwindigkeit bleibt während des Sprungs erhalten. Sprünge kosten Ausdauer, bleiben aber auch bei leerer Ausdauer möglich.
- Der grüne Hinweis sagt, wann ein jetzt gestarteter Sprung die nächste Hürde überqueren würde. Früh oder spät kann die Latte getroffen werden. Ein Treffer klappt nur die eigene Hürde um und kostet Tempo; niemand scheidet aus.
- Die schnellste Zielzeit gewinnt. Angezeigte und gewertete Zeit verwenden dieselben Hundertstelsekunden; gleiche Zeiten teilen sich den Platz. Noch laufende Personen werden nach präzisem Fortschritt gewertet. Ein untätiger Spieler kann den Kurs innerhalb der 32 Sekunden absolvieren.

## Darstellung und Bedienung

Die Kamera folgt der eigenen Bahn und reserviert Platz für Ausdaueranzeige und Steuerung. Im Querformat blickt sie weniger weit voraus, damit die eigene Figur sichtbar bleibt. Kompakte Fortschrittsleisten zeigen den gesamten Rennstand, auch wenn andere Figuren außerhalb des Bildes laufen.

Zwei große Knöpfe geben sichtbaren Druckzustand, Ton und kurze Vibration. Der Finger auf SPRUNG kann losgelassen werden, während der andere SPRINT weiter hält. Tastaturbedienung funktioniert auch im optionalen Übungsversuch. Tabwechsel, Fingerabbruch und Größenänderung lösen gehaltenes Sprinten; zusätzlich läuft der serverseitige Haltezustand ohne frischen Kontakt aus.

Laufen, Sprinten, Hürdensprung, Stolpern und Zieljubel besitzen unterscheidbare Posen. Die sichtbaren Sohlen im Sprung folgen derselben Formel wie die Trefferprüfung. Es gibt keine künstliche Anhebung an einer Hürde. Stadionplätze und Zuschauer verwenden Instanzen statt vieler einzelner Figuren.

## Regeln und Prüfung

`client/src/minigames/SprintPhysics.js` ist die gemeinsame, abhängigkeitenfreie Regelschicht für Server, Browserdarstellung und Übungs-Worker. Die Simulation integriert bis zum tatsächlichen Hürden- oder Zielkontakt und anschließend mit dem neuen Bewegungszustand weiter. Eine spät eingetroffene Sprungeingabe kann eine bereits überquerte Hürde nicht nachträglich retten.

Gezielte Tests prüfen eigene Bahnen, gleiche lösbare Kurse, Countdown, Sprint/Erholung, Abbruch eines gehaltenen Knopfs, Ausdauererschöpfung, Sprungbogen, Absprungtempo, frühe/späte Sprünge, doppelte Tipps, genau einen Treffer pro Hürde, Zielzeiten und identische Ergebnisse bei verschiedenen Tickraten. Echte Epoch-Zeitstempel sind zusätzlich geprüft, damit Rundungsgrenzen keinen Zeitschritt blockieren.

Browserprüfungen erfassen zwei Finger, Tastatur, Blur, Größenänderung, sichtbare Sprunghöhe, Kamerarahmen, Übung, Wiederholung und unveränderte Partiepunkte. Mobile Layouts werden bei 390 × 844, 844 × 390 und 320 × 568 geprüft. Bot-Simulationen vergleichen die tatsächlichen Platzierungen verschiedener Spielstärken.

Der nächste menschliche Spieltest sollte vor allem klären, wie gut der grüne Absprunghinweis mit dem Daumengefühl zusammenpasst und ob Ausdauerwechsel auf einem echten Handy schnell genug lesbar sind.
