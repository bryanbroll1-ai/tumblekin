# Einzelprüfung und Verfeinerung – 1. Oktober 2026

Basis bleibt Claudes Branch `claude/modest-archimedes-pwhcvy` vom 30. September. Der zweite Durchgang umfasst Quellcode, Eingaben, Regelrunden, Figurenbewegung und die Anzeige jedes der 40 Spiele. Vor der Änderung wurden 120 Ansichten aufgenommen: 390 × 844, 844 × 390 und 320 × 568. Die bestehenden Spielideen und Kulissen bleiben erhalten; die Änderungen beheben konkrete Bedienungs- und Darstellungsprobleme.

## Gemeinsame Änderungen

- **Die Zahl erklärt sich:** Die Wertungsanzeige benennt die tatsächliche Größe, etwa Leben, Höhe, Fangwert oder Bestzeit. Änderungen geben einen kurzen, gedrosselten Impuls. Nervenprobe behält ihre eigene Zielzeit und versteckte Uhr; ein zusätzlicher Countdown würde ihre Spielidee verraten.
- **Mehr Platz für Hinweise:** Umgebrochene Spielerleisten bestimmen die Position der darunterliegenden Hinweise. Reaktionsversuche, Malrunden, Flaggenbefehle und Suchhinweise überdecken die Wertung nicht mehr. Im Querformat liegen die verbleibenden Messer nebeneinander.
- **Eindeutiges Ende:** Während der Siegeranimation stehen die normale Zeitanzeige auf „Ende“ und die Bedienelemente werden gesperrt und gedimmt. Die schon vorhandene Serversperre schützt weiterhin die abgeschlossene Wertung.
- **Verlässliche Gesten:** Ein begonnener Wisch oder Zug gehört seinem Finger. Ein zweiter Finger kann ihn weder übernehmen noch durch Loslassen beenden. Fenster- und Tabwechsel räumen offene Gesten auf.
- **Gleichmäßige Effekte:** Partikelflug mit Gravitation und Luftwiderstand wird unabhängig von der Bildrate integriert. Blobs und Schneekugeln erzeugen Funken beziehungsweise Staub mit angepasster Wahrscheinlichkeit. Luftblasen, Ballonflamme, Bombenfunken, Schweiß und Seilrauch verwenden Ereignisraten pro Sekunde statt ungültiger Wahrscheinlichkeiten von mehr als eins pro Bild.
- **Ruhigere reduzierte Bewegung:** Punktetexte steigen nur wenig und überschwingen nicht; Partikel rotieren nicht. Die vorhandene Reduzierung von Kamerawackeln und Partikelzahl bleibt wirksam.
- **Aufräumen:** Entfernte Blobs und Schneekugeln geben unbenutzte Grafikressourcen frei. Noch verwendete gemeinsame Materialien und Geometrien bleiben erhalten. Der gemeinsame Blockform-Cache hat ein Budget von 8 MiB Geometriepuffern und höchstens 256 Einträgen. Das begrenzt diesen CPU-Vorrat, nicht den gesamten Speicher einer laufenden Szene.

## Jedes Spiel einzeln

Alle Zeilen enthalten die gemeinsame Anzeige- und Finale-Verfeinerung. Zusätzliche Änderungen sind ausdrücklich genannt. Die Prüfung umfasst außerdem pro Spiel 27 vollständige Regelsimulationen mit 2/3/4 Spielern, unterschiedlichen Zeitschritten, Seeds und ungültigen Eingaben.

| Spiel | Einzeln betrachtete Mechanik | Anzeige und zusätzliche Änderung |
| --- | --- | --- |
| Bumper Pool | Rempler, drei Leben, Rauswürfe, schrumpfende Insel | Leben; vorhandene Insel-Vorwarnung und Joystick-Unterbrechung erneut geprüft |
| Zielgerade | Spurwechsel, Sprung, Boost, Hindernisse, Zielplatz | Platz; Wisch gehört seinem Finger, fremdes Loslassen erzeugt keinen Sprung; Fußkontakt erneut geprüft |
| Farbflucht | Farbansage, Feldwechsel, Sturz und steigendes Tempo | Runden; Mehrfinger- und Unterbrechungsschutz für die Wischgeste |
| Nervenprobe | Sichtbare Startuhr, verdecktes Weiterzählen, Stoppabweichung | Eigene Zielzeit erhalten; keine verräterische zweite Uhr |
| Lichtwächter | Halten, Gelb-/Rotwechsel, Rückwurf und Zieleinlauf | Weg; Halteunterbrechung erneut geprüft |
| Pump-Panik | Pumpstöße, Mehrfinger-Tippen, Ballongröße und Rundenende | Hübe; Serversperre und sichtbare Finale-Sperre |
| Fassmut | Stoppzeit, Nachrutschen und Abstand zum Kopf | Punkte; leere Abstandsanzeige verdeckt die Vorwarnung nicht mehr; Seilrauchrate korrigiert |
| Fassrolle | Gegenlenken, Balance, Wellen und endgültiger Sturz | Balance; konkurrierende gehaltene Richtungen erneut geprüft |
| Zündstoff | Weiterreichen, Zündzeit, Ausscheiden und Zwei-Spieler-Regel | Dabei; Funken und Schweiß verwenden korrekte Ereignisraten und stoppen im Finale |
| Münzregen | Spuren, Bomben, Fangserie und Schatzspur | Punkte; eigener Wischfinger bleibt aktiv, Tabwechsel beendet die Geste |
| Blob-Klopfe | Trefferzeit, Goldbonus, Stachelstrafe und Auftauchen | Punkte; bildratenabhängige Funken korrigiert, entfernte Blobs entsorgt |
| Seilspringen | Sprungfenster, Doppelsprung und Ausscheiden | Sprünge; Sprung-/Landeposen und Finale geprüft |
| Kanonenflug | Kraft, Winkel, Wind und drei Landungen | Punkte; Flugbogen und Landungsrückmeldung geprüft |
| Messerwurf | Drehung, Treffer bestehender Messer und Stammfortschritt | Punkte; Messeranzeige passt auch in niedrige Querformatfenster |
| Turmbau | Überdeckung, Verschnitt und nächste Blockbreite | Blöcke; fallende Teile und Stapelstand geprüft |
| Bergsteiger | Griffseite, Fehlgriff und Gipfel | Griffe; Felskulisse hinter das Plateau versetzt, damit sie im Finale keine Schuhe durchschneidet |
| Ballonfahrt | Brenner, Auftrieb, Sandsackflug und Zieltreffer | Punkte; Brenner plus zweiter Abwurffinger erneut geprüft; Flammenpartikelrate korrigiert |
| Trampolin | Taktfenster, Serie und zunehmende Sprunghöhe | Höhe; Flug-/Landeposen und angezeigte Höhe geprüft |
| Falschsignal | Echte beziehungsweise falsche Ringe und frühes Risiko | Punkte; Signale und abgeschlossene Eingaben geprüft |
| Spurmaler | Spurabstand, Farbroller, Serie und Kristallrisiko | Punkte; Rundenleiste versetzt, Combo auf 320px getrennt; zweiter Finger übernimmt Ziehen nicht |
| Sortierband | Wischrichtung, wechselnde Rutschen und Serienbonus | Punkteanzeige an den gemeinsamen HUD-Ablauf angeschlossen; eigener Finger, Loslassen außerhalb der Fläche und Unterbrechung abgesichert |
| Angelduell | Einholen, Spannung, Schübe und gerissene Schnur | Fangwert; zweiter Finger und Tabwechsel erneut geprüft |
| Leuchtfolge | Vorführung, Eingabeserie und wachsende Folge | Folgen; Vorführungs-/Eingabephasen geprüft |
| Blitzreflex | Drei Versuche, Grünsignal, Fehlstart und schnellste Zeit | Bestzeit; Versuchskarten passen auf 320px unter die Wertung; redundantes „BEST“ entfernt |
| Nagelbrett | Fünf Kugeln, Seitenstups, Behälter und Goldbonus | Punkte; Kugelflug und Wertung geprüft |
| Eisstock | Wischkraft, Richtung, Reibung und Steinrempler | Punkte; fremdes Loslassen wirft nicht, fremde Bewegung verändert den Wurf nicht |
| Tiefenrausch | Tauchen, Luft, getragenes Gold und sichere Abgabe | Gesichert; Luftblasenrate korrigiert, im Finale keine neuen Luftblasen |
| Farbenjagd | Fläche, Übermalen und Tempo auf eigener Farbe | Fläche; Ansage unter die Wertung versetzt |
| Spürsinn | Gitterentfernung, Suche und Anzahl der Versuche | Punkte; Hinweis mit Abstand unter den Rundensymbolen |
| Augenmaß | Kurze Schwarmansicht, Regler und Schätzabweichung | Punkte; Hinweis mit Abstand unter den Rundensymbolen |
| Tauziehen | Teamtempo, gemeinsame Tipps und zwei Rundensiege | Runden; Teamwertung und Finale geprüft |
| Grimassen | Sechs Griffpunkte, Vorlage und zeitlich begrenzter Vergleich | Punkte; zweiter Finger übernimmt Griff nicht, Capture-Verlust und Unterbrechung räumen Ziehen auf |
| Flaggenhoch | Flaggenwahl, echte Befehle und Stillhalten bei Täuschung | Richtig; Befehl folgt der tatsächlichen Höhe der Lebensleiste |
| Honigwabe | Zugwechsel, ein/zwei Äpfel, Wabenstrafe und einmaliges Passen | Äpfel; Hinweis folgt umgebrochener Spielerleiste |
| Schneeballhang | Kugelwachstum, Wurf, Treffer und Schutz | Punkte; Staubrate angepasst, verschwundene Kugeln und ungenutzte Vorhersagen entsorgt |
| Luftpuck | Puckkontakt, Teamtor, Bewegungszone und fünf Tore | Tore; Puck-/Spielerbewegung und Teamwertung geprüft |
| Bücherwurm | Seitenfall, sichere Löcher, Bewegung und drei Leben | Seiten; Hinweis folgt umgebrochener Lebensleiste |
| Schnappschuss | Bildausschnitt, Blitzzeit, Mittebonus und Schubsen | Punkte; Fotofenster und Platzierung geprüft |
| Kippboot | Zugwechsel, Landepunkt, Kippen und Kenternstrafe | Punkte; Passagierlandung und Bootsneigung geprüft |
| Rohrsalat | Verbindungen, Querwege, Ventilwahl und Schatz | Punkte; Eingabe, Hinweis und Lösung geprüft |

## Verifikation

| Prüfung | Ergebnis im zweiten Durchgang |
| --- | --- |
| Server- und Eingaberegressionen | 396 bestanden |
| Vollständige Regelsimulationen | 1080 bestanden, 27 je Spiel |
| Renderer einschließlich Finale | Alle 40 bestanden; vier zuletzt geänderte Spiele zusätzlich erneut geprüft |
| Physik ganzer Browserrunden | 40 abgedeckt; 39 zunächst sauber, Felsüberschneidung bei Bergsteiger behoben und dessen ganze Runde erneut sauber |
| HUD und Bedienelemente | Alle 40 in 120 Ansichten geprüft; nach Sortierband-Korrektur dessen drei Ansichten erneut sauber; keine gemessenen Überlappungen, abgeschnittenen Elemente oder aktiven Knöpfe unter 44px |
| Finale-Steuerung | Sperre von Bedienelementen und Canvas für alle 40 geprüft |
| Animationen | 64 Zustände, 384 Varianten bei 30/60/120 Hz und mit/ohne reduzierte Bewegung |
| Gesten und Halten | Sieben neue Gestenprüfungen und fünf bestehende Mehrfinger-/Unterbrechungsprüfungen bestanden |
| Effekte und Ressourcen | Partikelflug bei drei Bildraten, geteilte Ressourcen, Cachebudget und reduzierte Bewegung bestanden |
| Start und Orientierung | Zwei Geräte, gemeinsame Bereit-Phase, Spielauswahl und kleine Querformatansicht bestanden |
| Landungs- und Warnrückmeldung | Inselrand, Sandsack, Figur und reduzierte Bewegung bestanden |
| Szenenwechsel | 60 Auf-/Abbauwechsel; keine erreichbaren alten Szenen, keine Konsolenfehler, Canvas-Zahl 3 → 3, JS-Heap 9 → 15 MB |

Die HUD-Nachprüfung nutzt die vorhandene mobile Qualitätsstufe. Vorherige Aufnahmen und der Render-/Physikdurchlauf verwendeten auch die höhere Stufe. Die schnelle Langzeitprüfung misst Aufbau/Abbau; sie spielt nicht 60 vollständige Runden. Separat gemessene Geometrie-/Texturpuffer lagen in diesem Lauf zwischen 4 und 12 MB. Die Testskripte behandeln außerdem das natürliche Ende kurzer Runden und beobachten die kurze Sandsacklandung direkt im Renderframe, damit Wartezeiten der Automatisierung keine falschen Spielbefunde erzeugen.

Automatische Prüfungen belegen Regel-, Eingabe- und Darstellungsstabilität. Die Bildschirmprüfung misst konkrete frühe Spielzustände und ersetzt keine Aussage über jede denkbare Punktzahl oder jede spätere Spielsituation. Spaß, Timing auf echten Handys und Fairness unter Netzlatenz brauchen zusätzlich menschliche Spielrunden. Sinnvolle nächste Spieltests: ein Übungswurf für Eisstock, eine Sandsackprobe für Ballonfahrt und Teamrotation für Tauziehen/Luftpuck. Dafür wurden keine unbewiesenen Schwierigkeitseinstellungen geändert.

Reproduzierbar über die Befehle im README; Vorher-/Nachher-Bilder und Messwerte entstanden im Arbeitsverzeichnis `scratch/tumblekin-refine`.

## Umsetzung der ersten Designprioritäten, 2. Oktober 2026

Die erste Runde aus `GAME_DESIGN_REVIEW.md` macht die eigentliche Aufgabe größer und die Einführung konkreter:

- **Rohrsalat:** engerer, gerader Blick auf das Rohrbrett. Im Querformat stehen Knöpfe und Ansage rechts daneben; die Spielerchips werden dort zugunsten der Aufgabe ausgeblendet. Im Hochformat reserviert die Kamera auch den Platz für die Ansage. Buchstaben stehen auf eigenen, größeren Schildern. Fünf und sechs Wahlknöpfe werden auf kleinen Bildschirmen in zwei Reihen dargestellt. Alte Rohrbretter und Wasserpfade werden beim Rundenwechsel freigegeben; Materialien der weiter sichtbaren Kulisse bleiben erhalten.
- **Grimassen:** größere eigene Maske; im Querformat stehen Vorbild und eigene Maske nebeneinander. Andere Masken werden dort ausgeblendet. Jeder Griff hat einen Trefferradius von 24 CSS-Pixeln und eine sichtbare Mindestgröße. Drehen beendet einen laufenden Zug kontrolliert. „Schau genau hin“ entspricht dem Vergleichsspiel, dessen Vorbild auch beim Formen sichtbar bleibt.
- **Nagelbrett:** gerader Blick und weniger leerer Rand; die Figuren unter dem Brett bestimmen den Kameraabstand erst im Finale.
- **Kanonenflug:** vor dem eigenen Schuss bleibt die eigene Kanone im Fokus. Nach dem Kraftstopp erscheint die voraussichtliche Weite ohne Wind; nach dem Abschuss die Weite und Zielabweichung. Wind bleibt ein eigener Einfluss auf den Schuss.
- **Turmbau:** engerer Blick auf die Spitze des eigenen Turms, mit Rand für den gesamten Schwenkbereich. Der eigene Baumeister steht hinter dem Sockel, damit er die Schnittkante nicht verdeckt. Das Finale behält die Übersicht über alle Türme.
- **Auswahl und Startkarte:** echte Vorschaubilder aller 40 Spiele; „Ein Spiel“ als Modusbezeichnung. Bereit und Üben bleiben beim Lesen der Startkarte sichtbar, ebenso der Weiterknopf beim Scrollen der Ergebnistafel.
- **Vier freiwillige Übungen:** Eisstock, Ballonfahrt, Kanonenflug und Fassmut verwenden die echten Szenen und gebündelten Serverregeln in einem separaten Worker. Kein Partieresultat und keine Bereitmeldung werden dabei verändert. Neustart trennt alte Antworten vom neuen Versuch; Schließen entfernt Szene, Worker und Eingabeereignisse. Die Übungszeit beginnt nach dem ersten Szenenaufbau mit einem kurzen Countdown, damit das Laden einen kurzen Physiklauf nicht aufbraucht.

Neue Prüfung: 403 Regeltests bestanden; die fünf Kameraspiele bestanden 15 Layouts (390 × 844, 844 × 390, 320 × 568), ohne HUD-Überlappungen, abgeschnittene Anzeigen oder zu kleine Aktionsknöpfe. Die vier Übungen wurden mit echten Browser-Eingaben gespielt: zwei Kanonendrucke, Eisstock-Wisch, Brenner und Sandsack mit zwei Fingern sowie Seilziehen. Zwei Geräte bestätigten dabei unveränderte Partiedaten und Bereitmeldungen, frischen Zustand nach Neustart, Aufräumen durch Fertig/Escape und anschließend den normalen Partiestart.

Die Ansichtsexporte in `scripts/game-previews.mjs` warten auf die tatsächlich aufgebaute Aufgabe; besonders bei Rohrsalat liefert der Vorlauf noch ein leeres Brett. Die frühe Layoutprüfung allein belegt deshalb nicht die Lesbarkeit jeder späteren Spielsituation. Spaß und Zielschwierigkeit bleiben Gegenstand menschlicher Testpartien.

Ergänzend bestanden alle sieben Druckprüfungen, die sieben Gestenspiele und die Einführung auf zwei Geräten. Grimassen wurde aus 18 Pixeln Abstand zum Griff gezogen; die Formänderung erreichte den Server, und Drehen beendete den Zug vor der neuen Anordnung. Rohrsalat durchlief fünf echte Runden: auch sechs Ventile passen auf 320 Pixel Breite und in zwei Querformate, die vollständigen Buchstabenschilder bleiben frei von der Ansage, und beim Wechsel wird die alte Schildtextur freigegeben. Alle 40 Vorschauen wurden aus laufenden Szenen erzeugt und auf Größe sowie leere Renderflächen geprüft.
