# Gameplay-Prüfung – 1. Oktober 2026

Geprüfte Basis ist Claudes neuester Branch `claude/modest-archimedes-pwhcvy`, Commit `3b6330c` vom 30. September 2026. Der ältere `main`-Stand vom August wurde nicht als Spielbasis verwendet. Korrekturen liegen im PR #2 auf `codex/improve-party-onboarding`.

## Behobene Fehler

- **Wertung während der Siegeranimation:** Nach Beginn des Finales nahmen die Eingabehandler weiterhin Aktionen an. Zum Beispiel konnte Pump-Panik nach Festlegung der Plätze noch Pumpstöße zählen. Zentrale Eingaben, Arcade-Regeln und Arena-Regeln lehnen solche Aktionen jetzt ab. Tests prüfen für alle 40 Spiele, dass Siegerpose und Ergebnistafel dieselben Plätze behalten.
- **Mehrfinger-Steuerung:** Ein zweiter Finger konnte beim Loslassen den gehaltenen Brenner der Ballonfahrt oder die Angel stoppen. Nur Finger auf der jeweiligen Haltefläche zählen jetzt. Bei Fassrolle gewinnt die zuletzt gehaltene Richtung; lässt man sie los, gilt wieder der weiterhin gedrückte andere Knopf.
- **Unterbrochene Eingaben:** Tabwechsel und Fensterwechsel lösen gehaltene Knöpfe und Joysticks. Spurmaler verwirft außerdem Tastaturbewegung und Zeichnen, Eisstock einen begonnenen Wurf und Zielgerade einen gehaltenen Sprint. So läuft keine alte Bewegung unbeabsichtigt weiter.
- **Fußkontakt in Zielgerade:** Laufposen dürfen die Schuhe nicht unter die Laufbahn kippen. Die Szene hebt die Figur nach der Pose um genau die Überschneidung an. Figuren in der Luft folgen jetzt mit den Sohlen genau der gemeinsamen ballistischen Sprungformel. Der Bodenprüfer nutzt die tatsächliche Laufbahn statt umfallender Hürden als Standfläche.
- **Entwickleransicht:** Der Verweis auf die aktive Szene wird beim Beenden gelöscht. Der Langzeittest prüft per schwachen Referenzen, dass alte Spielszenen nach dem Wechsel in die Lobby nicht mehr erreichbar sind.

Bereits im selben PR: gemeinsame Bereit-Phase und kurze Regeln für alle Spiele, gefilterte Spielauswahl, Steuerung im Querformat, kräftigere Landungen, Ballon-Landering und Sacklandung, Vorwarnung beim Schrumpfen der Bumper-Insel sowie der NaN-Fix bei vorauslaufender Serverzeit im Sprungbogen.

## Umfang und Ergebnisse

| Prüfung | Ergebnis |
| --- | --- |
| Server- und Eingaberegressionen | 396 Tests bestanden; zweiter Durchgang siehe Einzelbericht |
| Ganze Regelrunden | 1080 bestanden: jedes Spiel mit 2/3/4 Spielern, drei Zeitschritten und drei Seeds; fehlerhafte Eingaben eingeschlossen |
| Browser-Rauchtest | Alle 40 Spiele einschließlich Finale ohne Render- oder Konsolenfehler |
| Szenenprüfung | Alle 40; eigene Figur sichtbar, zulässige Standflächen geprüft |
| Physik über ganze Runden | Alle 40 abgedeckt; ursprünglicher Befund in Zielgerade nach Korrektur im vollständigen Wiederholungslauf behoben |
| Animationen | 64 Zustände, insgesamt 384 Varianten bei 30/60/120 Hz mit und ohne reduzierte Bewegung; keine ungültigen Transformationen |
| Mehrfinger und Unterbrechungen | Ballonfahrt, Angelduell, Lichtwächter, Fassrolle und Bumper-Joystick im Browser bestanden |
| Anzeige gegen Rangfolge | Alle 40: angezeigte Wertung entscheidet auch die Plätze |
| Leerlauf am Ende | 39 Arcade-Spiele ohne gemeldete lange Leerphase; Arena hat einen separaten Ablauf |
| Langzeitprüfung | 60 Auf-/Abbauwechsel bestanden; keine alten Spielszenen erreichbar, kein Canvas-/Listener-Zuwachs; JS-Heap 8 → 15 MB, Puffer nach dem ersten Durchlauf 17 MB |
| Partiemodi | Simulation mit 10.000 Partien je geprüfter Einstellung; Terminierung und Spielreihenfolge geprüft |
| Bot-Balance | 39 Arcade-Spiele mit 2/3/4 Spielern; bei zwei Spielern überall Vorteil für die starke gegenüber der schwachen Stufe |

Bewusst fliegende, tauchende oder sitzende Figuren werden nicht als bodenstehende Figuren bewertet. Prüfungen auf ungültige Koordinaten und auffällige Positionssprünge bleiben dabei aktiv. Die Animationsprüfung ist eine Stabilitätsprüfung und bewertet keinen ästhetischen Geschmack.

### Speicherbefund

Der erste 42-Runden-Test meldete bei `performance.memory` einen Anstieg von etwa 13 auf 39 MB. Die Detailprüfung trennte JS-Objekte und Geometriepuffer: nach einmaligem Aufbau aller Spiele blieb der gemeinsame Blockform-Vorrat über weitere Wiederholungen bei 469 Einträgen und 13,12 MB. Vergleichbare wiederholte Spiele schwankten nach Garbage Collection nur gering; es blieb jeweils die zuletzt gestartete Szene über die Entwickleransicht erreichbar. Dieser Verweis wird jetzt beim Beenden ebenfalls gelöscht.

Der Langzeittest misst deshalb JS-Heap und Puffer separat, erzwingt Garbage Collection und prüft zusätzlich alte Szenen. Der schnelle Lauf prüft Aufbau und Abbau, nicht den vollständigen Spielverlauf. Der ursprüngliche längere Lauf spielte 42 Runden auf derselben Seite ohne Browserfehler; Canvas-, Textur- und Listenerzahlen blieben im erwarteten Bereich. Im zweiten Durchgang wurde dieser Geometriecache auf 8 MiB und 256 Einträge begrenzt und seine Verdrängung geprüft. Das Budget gilt für die dort gehaltenen CPU-Geometriepuffer; aktive Szenen und GPU-Speicher sind davon getrennt. Weitere Änderungen und Einzelbefunde zu allen Spielen stehen in [GAME_REFINEMENT.md](GAME_REFINEMENT.md).

## Nächste Verbesserungen nach Priorität

1. **Kurzer optionaler Übungsversuch für komplexe Gesten.** Eisstock, Ballonfahrt und Rohrsalat verlangen mehr als bloßes Tippen. Eine ungewertete Probe vor der ersten Begegnung könnte Fehlversuche reduzieren. Die gemeinsame Bereit-Phase liefert bereits den passenden Einstieg; eine Probe müsste für alle Geräte denselben Ablauf bieten.
2. **Schwierigkeit mit menschlichen Spielern abstimmen.** Die Bot-Waage zeigt bei vier Spielern noch unsichere Abstände zwischen benachbarten Stufen in Lichtwächter, Zündstoff, Münzregen, Tauziehen, Honigwabe, Luftpuck und Kippboot. Besonders Teamspiele brauchen zusätzlich einen Vergleich mit gleichen Teams und wechselnden Sitzpositionen. Aus diesen Stichproben lässt sich kein belastbarer Parameter-Fix ableiten.
3. **Treffer- und Fehlerrückmeldung auf kleinen Geräten vergleichen.** Bei Zielgerade, Bumper Pool und Fassrolle sollte ein kurzer Handytest prüfen, ob Richtung und Ursache eines Remplers sofort erkennbar sind. Kurze gerichtete Effekte und ein eindeutiger Ton helfen mehr als zusätzliche dauerhafte HUD-Texte. Reduzierte Bewegung muss erhalten bleiben.
4. **Latenz und echte Handys getrennt prüfen.** Die Serverregeln und Browserprüfung decken viele Fehler ab. Spielgefühl, Berührungsflächen, thermisches Drosseln und Fairness bei unterschiedlichen Verbindungen brauchen ergänzend zwei echte Mobilgeräte und kontrollierte Verzögerungen. Automatische Bot-Ergebnisse ersetzen diesen Vergleich nicht.

## Reproduzieren

```bash
npm test
npm run gameplay-check
npm run input-check
npm run animation-check
npm run smoke
npm run scene-check
npm run boden-check
npm run anzeige-check
npm run leerlauf-check
npm run bot-sim
npm run session-sim -- 60 --quick
```

Die Browserprüfungen starten und beenden eigene lokale Server. Einrichtung siehe README. Die zeitweilige öffentliche Vorschau läuft ohne freigegebene Entwicklerwerkzeuge und unterstützt Socket.io-Polling; sie ist kein dauerhaftes Hosting.
