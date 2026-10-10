# Einzelprüfung der 40 Spiele · 2. Oktober 2026

Grundlage ist der aktuelle Codex-Entwurf auf dem neuesten geprüften Claude-Stand. Für jedes Spiel wurden Ziel, Eingabe, sichtbare Folge, Risiko und Wertung gegenübergestellt. Die Tabelle beschreibt die Entscheidung dieses Durchgangs. Eine unveränderte Mechanik ist eine bewusste Entscheidung, kein pauschal behaupteter neuer Rework. Zielgerade und Bumper Pool behalten ihre zuletzt überarbeiteten Grundmechaniken.

Alle 40 Startkarten bieten jetzt **Üben**. Übungen verwenden die aktuellen Serverregeln in einem eigenen Worker; Scores und Bereitstatus der Partie bleiben unverändert. Kontakt-, Team- und Zugspiele haben drei Bot-Gegenüber; Bumper behält den stationären Trainingsring. Neustart verwirft den alten Versuch. Aufbauzeit wird nicht von der Spielzeit abgezogen; Seed und Spielfeld bleiben beim Start konsistent. Partie und Übung verwenden eine gemeinsame Szenenliste.

## Entscheidungen pro Spiel

| Spiel | Geprüfte Logik und Entscheidung | Umsetzung in diesem Durchgang |
| --- | --- | --- |
| Bumper Pool | Geschwindigkeit aus gefahrenen Kurven bestimmt Stoßwucht; Loslassen bremst. Joystick reicht. | Mechanik erhalten; feinere analoge Stickmeldungen, fokussierter Stick auch per Tastatur bedienbar. |
| Zielgerade | Drei gemeinsame Spuren, Kiste umfahren, Hürde springen, Tor sliden. Halten verbraucht Ausdauer. | Wisch-/Haltemechanik erhalten und erneut auf Eingaben geprüft. |
| Farbflucht | Farbe finden, Weg ablaufen, Besetzung beachten, vor dem Fall ankommen. | Alle Farben zusätzlich mit festen Formen markiert: ● Pink, ▲ Blau, ■ Gelb, ✚ Grün. Schnelle Wischschritte geordnet versendet; neue Runde vor dem Schritt aktualisiert. Drehung/Abbruch verwerfen alte Gesten. |
| Nervenprobe | Zeit im Kopf zählen; ein einziger Stopp. Eine zusätzliche Uhr würde die Aufgabe auflösen. | Stopp wird lokal sofort verriegelt und angezeigt, statt bis zur Serverantwort nochmals auslösbar zu bleiben. Getrennt je gesteuerter Figur. |
| Lichtwächter | Halten läuft, Loslassen stoppt; Gelb warnt, Rot bestraft. | Haltezustandsmeldungen haben keine Aktionssperrzeit mehr. Ein Loslassen direkt nach einem Ping geht sofort durch. |
| Pump-Panik | Tippzahl ist die Leistung, zwei Finger sind legitim. | Bestehende Pumpanimation, Tokenbegrenzung und Druckrückmeldung erhalten; isolierte Übung ergänzt. |
| Fassmut | Der Bremszeitpunkt bestimmt den tatsächlichen Nachlauf; Halteschatten erklärt ihn. | Geteilte Physik und Bremsvorschau erhalten; Übung mit konsistent vorbereitetem Seed. |
| Fassrolle | Gegen Drehung laufen beeinflusst das gemeinsame Fass; letzter gehaltener Finger entscheidet. | Explizite Loslassmeldung beendet den Serverlauf sofort. Die bisherige 220-ms-Frist bleibt nur zur Erkennung verlorener Haltepings. |
| Zündstoff | Nur Halter beim Knall verliert Leben; Weitergeben setzt die Zündzeit nicht zurück. | Ablauf der Zündschnur wird vor einer Weitergabe geprüft. Ein später Pass verschiebt keinen bereits fälligen Knall auf den nächsten Spieler. |
| Münzregen | Beim Fangzeitpunkt zählt die damalige Spur, nicht eine nachträgliche Bewegung. | Fällige Münzen/Bomben vor Spurwechsel gewertet. Schnelle Spurwechsel seriell versendet; Abbruch, Drehung und Schließen räumen die Warteschlange auf. |
| Blob-Klopfe | Direkter Treffer auf sichtbaren Blob; falsche Blobs sind das Risiko. | Sichtbare Trefferflächen, Leerloch-Staub und Trefferwertung erhalten; Übung ergänzt. Kein zusätzliches Neuner-Tastenfeld. |
| Seilspringen | Ein zeitlich begrenzter Sprung muss die Seilpassage überdecken. | Knopf erklärt „IN DER LUFT“ bzw. „GESTOLPERT“ und ist währenddessen gesperrt. Kein wirkungsloser weiterer Sprungdruck. |
| Kanonenflug | Zwei zeitliche Entscheidungen: Kraft, danach Winkel; Wind bleibt eine echte Korrektur. | Phasenknopf, Windsack und Landering erhalten. Übung prüft tatsächliches Stoppen der Kraft. |
| Messerwurf | Werfen ist diskret; Klirren und Stammwechsel haben echte Wartezeit. | „NEUER STAMM …“ statt scheinbar bereitem Wurfknopf während Sperre/Wechsel. Eigener Wurf fliegt weiterhin sofort. |
| Turmbau | Überlappung bestimmt verbleibende Breite; perfekte Treffer müssen tatsächlich einrasten. | Perfektes Zentrum bleibt unverändert. Jede gesetzte Ebene speichert eigene Maße, sodass nach verspäteten Bildern nicht mehrere identische falsche Blöcke erscheinen. Exakt abgeschnittene Überstände fallen als Stücke ab. Fehlstapel zeigt „DANEBEN“, Fehlerklang und verbleibende Etagen statt Erfolgsflagge. |
| Bergsteiger | Die sichtbare Griffolge bestimmt die Hand; die Folge ist nicht immer abwechselnd. | Irreführendes „abwechselnd“ im dauerhaften Hinweis durch „Bildhälfte mit dem leuchtenden Griff“ ersetzt. |
| Ballonfahrt | Brennerhaltung und gezielter Abwurf sind unabhängige Entscheidungen. Ein einzelner Knopf würde eine davon entfernen. | Bestehende Bildhaltung und Abwurfknopf erhalten; gemeinsames Druckfeedback pulsiert nicht zusätzlich bei Zustandsmeldungen. |
| Trampolin | Resonanz verlangt eine zusammenhängende Rhythmusserie. Auslassen darf kein kostenloses Halten der Serie sein. | Verpasste Schläge brechen die Serie und senken die aktuelle Höhe, einmal je Schlag und unabhängig vom Tick. Besthöhe bleibt gespeichert. Regeln und Starttipp angepasst. |
| Falschsignal | Früh tippen ist riskant; gesperrte Fehlversuche können nichts auslösen. | Gesperrter Knopf zeigt „ERHOLEN“ und wird tatsächlich deaktiviert. Täuschungen und frühes Risiko bleiben bestehen. |
| Spurmaler | Relatives Ziehen lenkt ohne Sprung beim Fingeraufsetzen; Qualität wird entlang der Spur gewertet. | Relative Steuerung und kontinuierliche Wertung erhalten; Übung ergänzt. |
| Sortierband | Drei Rutschen verlangen links, unten oder rechts. Oben ist keine vierte Rutsche. | Ein Wisch nach oben wird verworfen und quittiert, statt unbeabsichtigt rechts zu sortieren. Hinweis benennt alle drei Richtungen; Drehung bricht die Geste ab. |
| Angelduell | Halten holt ein, Loslassen entspannt; Zug des Fisches macht die Entscheidung. | Bestehende ausdrückliche Freigabe und Spannungsprognose erhalten. Haltepings erzeugen keine zusätzlichen Knopfpulse. |
| Leuchtfolge | Gedächtnisleistung soll entscheiden, nicht Präzision kleiner perspektivischer Trefferflächen. | Direkte Pilze und vier beschriftete Farbknöpfe erhalten; Sperren bei Vorführung, Fehler und Abschluss bleiben verbindlich. |
| Blitzreflex | Ein Fehlstart ist ein Fehlstart; beste von drei gültigen Reaktionen entscheidet. | Keine Vor-Grün-Pufferung eingeführt; reale Fehlstart-/Versuchslogik in der Übung geprüft. |
| Nagelbrett | Abwurfposition und ein Stups bestimmen die Bahn; fünf Kugeln sind ein echtes Budget. | Bei verbrauchtem Budget kein neuer scheinbarer Abwurf samt Serverfehlermeldung. Tipp wird kurz quittiert; Kugel-/Stupsphysik bleibt erhalten. |
| Eisstock | Wischrichtung und Länge bestimmen echten Steinflug; nur ein eigener Stein darf rollen. | Gemeinsame Landungs-/Kontaktregeln und Kraftvorschau erhalten; Übung prüft real verbrauchten Stein. |
| Tiefenrausch | Getragenes Gold ist erst an der Oberfläche gesichert; Luftreserve bestimmt Rückweg. | Physik, Abgabe und weiße Rückwegmarke erhalten. Stick reagiert feiner und ist per Tastatur erreichbar. |
| Farbenjagd | Eigene Bahnen geben Geschwindigkeit, Übermalen verändert Besitz. Joystick reicht. | Feinere Stickmeldungen; Übung gegen drei tatsächliche Gegner statt leerer Leinwand. |
| Spürsinn | Entfernungszahlen sind Gitterwege; bereits getippte Felder dürfen nicht nochmals kosten. | Geheimhaltung, Rundennummer und kostenlose Wiederholung erhalten; echte Feldprobe im Training. |
| Augenmaß | Erst schauen, dann schätzen; letzter Reglerstand muss gewertet werden. | Phasen und sofortige Freigabe des Reglerstands erhalten. Übungsdialog nimmt auch Regler in die Tastatur-Fokusfolge auf. |
| Tauziehen | Griffreserve und gemeinsame Züge bestimmen das Teamresultat. | Gemeinsame Teamplätze erhalten. Übung enthält zwei echte Zweierteams; Training zeigt somit Hau-Ruck und Gegenzug. |
| Grimassen | Direktes Ziehen der sechs Griffe bildet die Formaufgabe ohne zusätzliche Achsenknöpfe ab. | Bestehende CSS-Pixel-Trefferflächen, Endsendung und Rotation erhalten; gleiche Aufgabe in Übung. |
| Flaggen hoch | Rot/Blau/beide und Täuschung verlangen zwei unabhängige Flaggen. | Zweiflaggenbedienung und Fehler-/Lebenslogik erhalten. Keine automatisch richtig vorausgewählte Aktion. |
| Honigwabe | Alle wählen gleichzeitig Weiter/Heim; die Wahl bleibt bis zur Auflösung auf dem Server. | Haben alle gewählt, geht es sofort weiter; eine Wahl in der Schonfrist zählt noch, eine spätere nicht. Wer nichts drückt, pflückt weiter. Zeitbalken nach Ankunftszeit. Übung mit echten Gegnern. |
| Schneeballhang | Rollen wächst Kugel; bewusster Wurf ist eine zweite Entscheidung. | Bereitschaft „ROLLEN/ERHOLEN/LÄDT“, Wurf und Schildphysik erhalten; Stick verfeinert und Training mit Gegnern. |
| Luftpuck | Geschwindigkeit der Scheibe überträgt sich auf Puck; Teams gewinnen gemeinsam. | Begrenzte Rollen/Zonen und Teamwertung erhalten; feinere Stickbedienung und Training mit allen vier Rollen. |
| Bücherwurm | Der tatsächliche Lochschatten entscheidet sichere Position; freies Schieben gehört zum Spiel. | Gemeinsame Seiten-/Kontaktphysik erhalten; feinere Stickbedienung und Übung mit Gedränge. |
| Schnappschuss | Im Bild stehen und gezielt schubsen sind verschiedene Entscheidungen. | Freie Bewegung, Schubspause und gemeinsame Fotowertung erhalten; feinere Stickbedienung und Übungsgegner. |
| Kippboot | Abwurfzeit bestimmt Hakenposition und Kippmoment; Ablauf muss für alle gleich gelten. | Ein verspäteter menschlicher Abwurf wird als automatische Aktion am exakten Deadline-Ort abgeschlossen, statt am späteren Hakenort. Übung mit Zugwechseln. |
| Rohrsalat | Am Querrohr wechseln; gewählt wird genau ein Ventil, Lösung bleibt bis zur Auflösung verborgen. | Direkte Ventile, Phasen und verdeckte Wahl erhalten; Übung mit tatsächlicher Ventilwertung. |

## Gemeinsame Eingabegrenzen

Pointeraktionen vor dem Countdownende und im Finale lösen auch lokal keine Spielszenenaktion aus. Gehaltene Zustandsmeldungen für Sprint, Laufen und Einholen erzeugen keine künstlichen Druckimpulse. Der virtuelle Stick meldet analoge Änderungen innerhalb einer Richtung direkt, statt bis zum nächsten 70–105-ms-Ping zu warten. Seine Tastatursteuerung gilt nur bei fokussiertem Stick; Loslassen, Blur und versteckter Tab setzen die Richtung zurück. Die sichtbare Bewegung wird weiterhin durch die echte Spielphysik begrenzt.

## Prüfung und Grenzen

Die reproduzierbaren Prüfungen sind `npm test`, `npm run gameplay-check`, `npm run anzeige-check`, `npm run all-practice-check`, `npm run press-check`, `npm run input-check`, `npm run sprint-check`, `npm run bumper-check` und `TUMBLEKIN_BROWSER_WORKERS=1 npm run refinement-check`. Die neuen Regeltests prüfen konkrete Zeitgrenzen und Invarianten: späte Spurwechsel, abgelaufene Bombe/Züge, sofortiges Loslassen, gespeicherte Turmgeometrie samt erhaltenem Gesamtmaterial sowie ausgelassene Rhythmusschläge.

Bestanden: 453 Regel-/Komponententests, 1.080 vollständige Runden über alle 40 Spiele und der Vergleich aller Wertungsanzeigen mit der Rangfolge. Alle 40 Übungen wurden über echte Touch-/Tastatureingaben ausgelöst, einschließlich Nachweis unveränderter Partiestände. Alle 120 Ansichten (390×844, 844×390, 320×568) sind nach Korrektur des Honigwabe-Zeitbalkens frei von gemessenen HUD-Überlagerungen, abgeschnittenen Bedienelementen und zu kleinen aktiven Knöpfen. Die Zusatzprüfungen für Drücken, Loslassen, Zielgerade und Bumper sind bestanden; Bumper baut in der echten Stickübung 45 % Schwung und 1,84 Geschwindigkeit auf.

Browserprüfungen decken die Eingabe und Wirkung jedes Spiels sowie drei Ansichten ab. Sie ersetzen keinen menschlichen Komfort-/Spaßtest auf einem echten Telefon. Netzbedingte Timing-Unterschiede, Drei-Spieler-Teambalance und die Stärkeverteilung der Bumper-Bots bleiben praktische Testfragen. Die veröffentlichte Browserfassung spielt lokal gegen Bots; sie belegt kein Mehrgeräte-Netzspiel.

## Nachtrag 7. Oktober 2026: Verzögerung, Startkarte, Farbzeichen

**Verzögerung.** Die offene Frage „netzbedingte Timing-Unterschiede“ ist jetzt gemessen und behoben. Zeitkritische Spiele zeigen nicht mehr den Stand der letzten Servermeldung, sondern den Moment, in dem ein jetzt getippter Befehl beim Server ankommt (`arrivalNow()`: Serveruhr aus `sentAt` plus gemessene Rundreise; ohne Messwert bleibt alles wie bisher). Wo das eigene Bild vorausläuft, gelten unbestätigte Eingaben schon im Bild und verschwinden mit der nächsten Servermeldung. Der Server traut weiterhin keinem Zeitstempel eines Geräts. Gemessen mit 100 ms Verzögerung je Richtung, gleiche Eingabe im Bild, vorher → nachher:

| Spiel | Ohne Ausgleich | Mit Ausgleich |
| --- | --- | --- |
| Nervenprobe (Stopp bei der Zielzeit) | +227 ms daneben | −19 ms |
| Lichtwächter (bei Grün loslassen) | 4× erwischt | 0× erwischt |
| Fassmut (bei 2,0 s bremsen) | 2,223 s | 2,002 s |
| Kanonenflug (bei 0,7 Kraft / 45° auslösen) | 0,93 · 56,5° | 0,69 · 44,5° |
| Turmbau (Block bündig ablegen) | Breite 0,81 | Breite 1,00 |
| Seilspringen (im Bild springen) | raus in Welle 1 | übersteht |
| Münzregen (Spurwechsel vor der Münze) | 0 von 3 | 4 von 4 |
| Farbflucht (rettender Schritt kurz vor Schluss) | gefallen | gerettet |
| Zielgerade (Hürden im Bild springen) | 0 von 2 | 4 von 4 |

Ebenso rechnen Blob-Klopfe, Zündstoff und Nervenprobe ihre Anzeigen zur Ankunftszeit. Der Knall-Zeitpunkt von Zündstoff geht nicht mehr an die Geräte, nur die gezeigten Sekunden — vorher ließ er sich aus den Daten ablesen.

**Startkarte.** Ein Mensch, der das Handy weglegt, hielt die Runde bisher unbegrenzt fest. Jetzt beginnt sie nach 60 Sekunden mit allen; die letzten 30 Sekunden zählt die Karte (und eine laufende Übung) sichtbar herunter. Eine kürzere Restfrist nach dem ersten Bereit wurde verworfen: sie hätte Übende mitten im Versuch aus der Übung gerissen.

**Farbzeichen.** Farbenjagd zeigt jetzt dieselben vier Zeichen wie die Farbflucht (● ▲ ■ ✚) auf jeder bemalten Kachel und im Anteilbalken. Pink, Gelb und Grün sind bei Rot-Grün-Schwäche kaum zu trennen; helle Farben bekommen ein dunkleres, dunkle ein helleres Zeichen. Das Feld bleibt ein Zeichenaufruf.

**Weitere Korrekturen.** Figuren sanken nach einem Rempler in Münzregen kurz in den Boden (Ende eines zeitlich begrenzten Zustands ohne Überblendung) — behoben. Gesten-Zeiger, die der Browser schon freigegeben hatte, lösten beim Festhalten einen Fehler aus und blockierten den ersten Wisch — behoben. HUD-Elemente richten sich nach der tatsächlichen Breite der Punkteanzeige statt nach festen 132 px; der Angelduell-Balken und das Schnappschuss-Polaroid überlappen auf kleinen Geräten nicht mehr. Am Ende jeder Zielgerade erschien „Das Minispiel ist vorbei.“ mit Fehlerton, auch ohne Berührung (das Finale ließ einen Sprint los, den es nicht gab) — behoben; diese Ablehnung zeigt keine Szene mehr an. Der Uhrabgleich des Geräts übernimmt den ersten Messwert sofort, statt sich von 0 aus anzunähern: Bei nachgehender Handyuhr galt sonst das erste Tippen nach „LOS!“ als zu früh.

## Nachtrag 9. Oktober 2026: Feedback-Runde aus dem Spieltest

Umgesetzt nach einer ausführlichen Rückmeldung zu einzelnen Spielen:

| Bereich | Rückmeldung | Änderung |
| --- | --- | --- |
| Alle K.-o.-Spiele | Leben machen Runden zäh; Ausgeschiedene sollen weiter zuschauen. | Flaggen hoch, Bücherwurm, Bumper Pool und Honigwabe: ein Fehler ist das Aus, wer raus ist, schaut zu (Zündstoff-Duell bleibt bei zwei Leben). |
| Tauziehen | Einfach: welches Team schneller tippt, keine Ausdauer, eine Runde. | Klicker-Duell 2 gegen 2 in einer 15-s-Runde, jeder Tipp zieht gleich stark. |
| Honigwabe | Wer die Wabe nimmt, ist raus. | Stich = raus; gewertet wird, wer am längsten übrig bleibt. |
| Zielgerade | Sprung und Slide schwer zu unterscheiden. | Sprung = niedrige orange Wand mit ▲, Slide = hohes blaues Banner mit ▼, offen darunter; Vorwarnstreifen. |
| Farbenjagd | Eimer flackern am Rand, Bewegen klappt manchmal nicht, Bombe zu schwach. | Eimer hinter die Leinwand; der Stick setzt dort an, wo der Finger die Bühne berührt (auch in fünf weiteren Stick-Spielen); Bombe 3,6 statt 2,4 Felder, vor der Figur. |
| Münzregen | Münzen sollen aus der Mine kommen, sind zu gross. | Würfe fliegen im Bogen aus dem Stollen, mit Zielkreis in der Spur; ein Drittel kleiner. Timing unverändert. |
| Nagelbrett | Pfeile springen herum, Fächer zu flach. | Trennwände in Server- und Geräte-Physik, tiefe Taschen, gelandete Kugeln bleiben liegen; Stups-Vorschau rastet auf Fächer und wechselt erst nach 160 ms. |
| Grimassen | Gesichter verbacken. | Blockköpfe im Stil der Figuren, jedes Teil sitzt an seinem Griff; Formzeit 10,5 s. |
| Augenmaß | 40 Tiere in 2 s nicht machbar; Figuren sitzen im Stamm. | 4–20 Tiere, 2,8–4,0 s, jede Runde andere 3D-Tiere; Figuren sitzen auf dem Stamm. |
| Kippboot | Kippen wirkt nicht physikalisch, Zoom ergibt keinen Sinn. | Feder-Schaukeln, Kentern als beschleunigte Rolle mit abrutschenden Passagieren; fester Bildausschnitt statt Zoom bei jedem Zug. |
| Spurmaler | Neu: vorgezeichnete Figur nachfahren. | Riesenstift zeichnet vor, Wertung Abdeckung × Genauigkeit auf dem Server (SketchFigures.js, gemeinsam mit dem Gerät). |
| Bots | Schwierigkeitsgrad wählbar. | Lobby-Einstellung leicht / mittel / schwer / gemischt, gilt in allen 40 Spielen. |
| Optik | Runde Formen schöner, Podestzahlen im Polygon-Look, Schwimmringe ändern. | Runde Formen facettiert statt in Voxel-Treppen, Schwimmringe als gestreifte Polygon-Donuts, Podestzahlen als Blockziffern. |

Ein zufällig fehlschlagender Test (Blob-Klopfe: Stachelblob nach Rundenende) hing an der Uhrzeit und ist behoben; die Ursache wurde über alle 9973 möglichen Würfe nachgerechnet.

## Nachtrag 10. Oktober 2026: Gesamtdurchgang aller Spiele und der Oberfläche

Grundlage war eine Bildreihe aller 40 Spiele (früh, Mitte, spät, Finale, Ergebnistafel, mit Autopilot) und der Oberfläche (Start, Lobby, „Mehr“, Spielauswahl, Einladung, Startkarte, Menü, Ergebnis, Siegerehrung).

| Bereich | Befund | Änderung |
| --- | --- | --- |
| Ergebnistafel | Eine lange Wertung drückte den Namen weg (Bumper Pool: Platz 1 und 2 ohne Namen, Kanonenflug „S…“). | Der Name hat Mindestbreite, die Wertung bricht um. |
| Beschriftungen | Anzeige und Tafel nannten dasselbe verschieden (Hübe/Pumps, Blöcke/Etagen, Sprünge/Wellen), „1 Seiten“, „1 oben geblieben“, „27.1 Höhe“. | Einheitliche Begriffe, richtige Einzahl, „Bis zuletzt drin“/„Oben geblieben“, „27,1 m hoch“. |
| Zahlen | Kommazahlen mit Punkt in acht Spielen (Fassmut, Fassrolle, Nervenprobe, Kanonenflug, Bergsteiger, Farbflucht, Trampolin, Blob-Klopfe). | Überall Komma. |
| Luftpuck | Die 3D-Anzeigetafel zeigte die Teams umgekehrt zur Leiste oben und stand dahinter; die Discokugel hing in der Leiste. | Tafel entfernt, Kugel unter die Decke. |
| Rohrsalat | Bei sechs Rohren waren A und F halb abgeschnitten. | Bildausschnitt breiter. |
| Angelduell | Vierstellige Fangwerte liefen in den Chips ineinander. | Chips mit Innenabstand. |
| Bumper Pool (quer) | Stand- und Spielerleiste überlappten. | Spielerleiste weiter rechts. |
| Schneeballhang | Bots schoben eine noch stehende Figur nach 0,7 s vom Plateau. | Die ersten 2–3 s rollen die Bots nur und halten Abstand. |
| Bumper Pool (Bots) | Bot-Waage umgekehrt: der starke Bot lag hinter dem mittleren (fuhr für ferne Opfer selbst an den Rand). | Greift den Nächsten an, zielt genauer; mittel/schwach lenken ungenauer — 1,82 / 2,35 / 3,33. |
| Podest | Der Vierte stand halb in der dritten Stufe. | Neben der Stufe, auf ihrer Tiefe. |
| Lobby | „Mehr“ klappte unter dem Startknopf auf. | Die Karte scrollt mit. |
| Spielauswahl | Die drei Schalter standen je in einer eigenen Zeile. | Kompakt in einer Zeile. |
| Startkarte | Vor dem Bereit-Melden graue Fläche. | Himmel der Lobby. |

## Nachtrag 10. Oktober 2026: Luftpuck lebendiger, Schläger relativ

| Bereich | Befund | Änderung |
| --- | --- | --- |
| Steuerung | Der Schläger sprang unter den Finger; der Finger verdeckte genau die Stelle, an der der Puck ankam. | Relativ: Finger irgendwo aufsetzen (gern unter dem Tisch), der Schläger macht die Bewegung mit (×1,25). Kein Sprung beim Aufsetzen; am Zonenrand wird der Anker nachgezogen, die Gegenrichtung greift sofort. Ein Ring zeigt den Finger. |
| Optik | Heller Tisch in leerer Halle, ausser dem Puck bewegte sich kaum etwas. | Dunkler Glow-Hockey-Tisch mit leuchtenden Linien; Puck in der Farbe des letzten Schützen mit Schein und Leuchtspur; Lauflicht um den Tisch; zwei Scheinwerfer; Luftteilchen über den Düsen. |
| Treffer | Ein paar Würfel beim Stoss. | Funken in Stossrichtung, Schockwelle, Lichtfleck, Schläger blitzt; harte Schüsse rütteln das Bild. Banden blitzen an der Aufprallstelle und klicken. |
| Tore | Pop und Würfel. | Puck versinkt im Schlitz, Konfetti aus beiden Ecken, Feuerwerk, Lauflicht und Scheinwerfer in Teamfarbe, Torhupe und Jubel, Bildschirmblitz, springende Zahl, Banner mit Torschütze; „Matchball“ und „Letzte 10 Sekunden“. |
| Publikum | Keins. | Tribünen links (Team vorn) und rechts (Team hinten), gemischte Reihen hinter dem Tor: Köpfe folgen dem Puck, Fans springen bei Toren ihres Teams auf, die anderen lassen die Köpfe hängen. |

Kosten: 145 statt 117 Zeichenaufrufe (Publikum, Funken und Konfetti je eine InstancedMesh), Bildzeit im Mittel 4,3 statt 3,3 ms — gleichauf mit Kippboot.

## Nachtrag 10. Oktober 2026: Kippboot mit echter Physik

| Bereich | Befund | Änderung |
| --- | --- | --- |
| Tiere | Wurden an ausgerechnete Plätze gestellt: zwei an derselben Stelle steckten ineinander, eins auf einem anderen schwebte, nichts kippte oder rutschte. | Jedes Tier ist ein Klotz mit Masse (Bootsphysik.js, 2D-Starrkörper nach XPBD): es fällt, landet auf dem Deck oder auf einem anderen Tier, rutscht, kippt um und kann über Bord gehen — dann sind seine Punkte weg. |
| Boot | Neigung war eine Summe aus Gewicht × Abstand; gekentert wurde im Augenblick des Absetzens. | Das Boot ist ein drehbarer Körper mit Auftrieb und Wasserdämpfung; die Tiere drücken es über die Kontakte zur Seite, ein Aufprall schaukelt es nach. Kentern bei 26° Neigung — ein Schwein darf aufs leere Boot bis 1,37 vom Mittelpunkt fallen (vorher 1,4). |
| Modell | Rumpf und Reling waren massive Kisten bis 16 cm über dem Deck: die Tiere standen sichtbar im Boot. | Hohler Rumpf: Planken auf Deckhöhe der Physik, Bordwände aussen, Bug und Heck als niedrige Kante (auch in der Physik). Ein Halstuch zeigt, wem ein Tier gehört. |
| Gerät | — | Rechnet vom Serverstand mit derselben Physik bis zur Ankunftszeit des eigenen Tipps voraus: der eigene Passagier fällt sofort; ein Test hält Server und Gerät gleich (JSON-Stand → identisches Ergebnis). |
| Ablauf | — | Ein volles Boot legt ab, sobald alles liegt; kentert ein Boot, bekommt der Wartende einen frischen Zug. Die Bedenkzeit hält Zeit für Fall, Kentern und Ablegen frei (Obergrenze 85 s, normal endet eine Partie nach gut 40 s). |
| Bots | Mit der Physik kenterte der starke Bot öfter als der mittlere. | Der starke rechnet die besten Stellen voraus (gröbere Teilschritte, festes Schrittbudget, Median 20 ms je Zug), der mittlere schätzt. 300 Partien: Siege 129 / 108 / 66, Punkte 194 / 187 / 174. |

Kosten: ein Rechenschritt (20 ms Spielzeit) braucht mit sieben Tieren 0,1 ms; eine ganze Partie mit drei Bots rechnet der Server in rund 0,3 s.
