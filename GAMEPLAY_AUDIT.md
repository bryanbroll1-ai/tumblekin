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
| Honigwabe | Einer oder zwei, einmal passen; Zugdeadline bestimmt automatische Pflückaktion. | Abgelaufener Zug wird zuerst automatisch abgeschlossen. Ein verspäteter Doppelpflücker kann die automatische Einzelaktion nicht ersetzen. Zeitbalken sitzt unter der tatsächlichen Ansage statt sie auf kleinen Displays zu überlagern. Übung mit echten Zuggegnern. |
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
