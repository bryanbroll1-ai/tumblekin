# Zielgerade: Wischen, Slide und Sprung

Zielgerade ist ein 100-Meter-Rennen gegen die anderen auf drei gemeinsamen Spuren. Jede Person sieht dieselben zwölf Hindernisreihen. Die Rennen verwenden neu gemischte, lösbare Muster: hohe Kisten umfahren, orange Hürden überspringen und unter blauen Toren sliden. Figuren blockieren einander nicht; die schnellste Zielzeit gewinnt. Gleiche angezeigte Hundertstel teilen den Platz.

## Eine Fläche als Steuerung

Es gibt keine Spielknöpfe. Links/rechts wischen wechselt um eine Spur; hoch startet einen Sprung; runter startet den Slide. Runter während des Sprungs führt über einen kurzen, kontinuierlichen Abstieg zum Boden. Ein Finger, der länger als 170 ms auf dem Spielfeld bleibt, sprintet. Während des Haltens sind Wischaktionen mit demselben Finger möglich. Ein zweiter Finger übernimmt den aktiven Finger nicht und beendet seinen Sprint nicht.

Sprint verbraucht Ausdauer. Bei leerer Ausdauer wird gejoggt, bis der Finger losgelassen und mindestens 30 Prozent Ausdauer am Boden nachgeladen wurden. Halten bei leerer Anzeige lädt nichts nach. Wischen, Springen und Sliden kosten keine Sprint-Ausdauer. Absprungtempo bleibt zunächst erhalten; mit leerer Sprint-Ausdauer wird auch in der Luft abgebremst, damit Dauerspringen keinen kostenlosen Dauersprint erzeugt.

Blur, versteckter Tab, Größenänderung, Fingerabbruch und Finale lösen Sprint und ausstehende Halte-Timer. Ohne frischen Kontakt endet der serverseitige Haltezustand nach 420 ms. Tastatur: Pfeile/WASD für die Wischaktionen, Leertaste/Shift halten zum Sprinten.

## Sichtbare und tatsächliche Bewegung

Die gemeinsame Regelschicht `client/src/minigames/SprintPhysics.js` wird auf Server, im Übungs-Worker und zur Darstellung genutzt. Spurwechsel dauern 200 ms und besitzen eine kontinuierliche seitliche Position: mitten zwischen zwei Spuren können beide Hindernisse berührt werden. Auch während des Stolperns kann noch seitlich gelenkt werden. Sprünge folgen einer gemeinsamen Parabel; die sichtbaren Sohlen liegen auf derselben Höhe. Der Slide tritt ein und aus, und die sichtbare Kopfhöhe passt unter das blaue Tor. Die Sohlen werden auch beim Ducken am Boden gehalten.

Kontakte werden am tatsächlichen Überqueren einer Hindernisreihe geprüft. Die Simulation integriert danach den übrigen Zeitschritt mit dem neuen Zustand weiter. Ein spät eintreffender Wisch oder Sprung kann einen bereits erfolgten Treffer nicht nachträglich verhindern. Ein Treffer kostet Tempo und unterbricht den Sprung; die Person bleibt im Rennen. Hindernisse bleiben für nachfolgende Rivalen erhalten.

Die Kamera zeigt alle drei Spuren und folgt nach vorne der eigenen Figur. Die eigene Bodenmarkierung und farbige Namensanzeige unterscheiden sie von den anderen. Kompakte Rennstände und Ausdauer bleiben auf kleinen und quer gehaltenen Geräten lesbar. Die unteren Hinweise empfangen keine Zeigereingaben und lassen die Spielfläche bedienbar.

## Übung und Prüfung

Die Übung besitzt einen wiederholbaren Einstieg. Der beim Aufbau erzeugte Kurs bleibt beim Countdown derselbe; sichtbare Hindernisse und Regeln wechseln nicht gegeneinander. Neu setzt alle Werte zurück. Partiepunkte und Bereitstatus bleiben unverändert. Die übrigen Übungen wurden auf diese Kurs-Erhaltung ebenfalls geprüft.

442 Regeltests bestehen, darunter je 25 Sprint- und Bumper-Prüfungen. Für beide Spiele bestehen 54 vollständige Simulationen bei 2/3/4 Personen und unterschiedlichen Takten. Der echte Chromium-Touchtest prüft seitliches Wischen, Sprung, Abstieg/Slide, Halten, zweiten Finger, Kopf-/Sohlenhöhe, Loslassen, Tastatur, Blur, Orientierung, Wiederholen und die anschließende Partie. 390 × 844, 844 × 390 und 320 × 568 sind auf HUD-Überlappung, abgeschnittene Steuerung und Finale-Sperre geprüft. Je 120 Renn-Botrunden bei 2/3/4 Personen belohnen die stärkere Spielweise.

Der Handytest sollte vor allem zeigen, wie sich der Übergang zwischen kurzem Wischen und gehaltenem Sprint anfühlt und ob die Spur-, Sprung- und Slide-Hindernisse schnell genug lesbar sind.
