# Bumper Pool: nur der Stick

Bumper Pool wird vollständig mit einem analogen Joystick gespielt. Lenken baut Tempo auf; gleichmäßige Kurven während der Fahrt sammeln Schwung und erhöhen die tatsächliche Beschleunigung. Ein Anlauf überträgt beim Kontakt einen gerichteten Stoß. Loslassen bremst. Es gibt keinen Rammknopf, Dash oder automatisch ausgelöste Fähigkeit. WASD/Pfeiltasten geben am Desktop denselben Lenkvektor ab.

## Kurven-Schwung

Der Winkel zwischen tatsächlicher Fahrt und Lenkrichtung muss eine fortgesetzte Kurve ergeben. Erst nach 250 ms mit derselben Drehrichtung lädt der Schwung; kurze Links-rechts-Wackler zählen nicht. Die Beschleunigung steigt bis maximal 65 Prozent. Geradeausfahren erhält den Schwung kurz, Loslassen baut ihn rasch ab. Ein Kontakt verbraucht ihn; der stärkere Stoß kommt von der tatsächlich aufgebauten Geschwindigkeit. Stillstand, Sturz und Wiedereinstieg liefern keinen gespeicherten Bonus. Eine farbige Ringspur und die Schwunganzeige am Stick machen den Aufbau sichtbar.

## Bewegung und Kontakt

`client/src/minigames/BumperPhysics.js` enthält die gemeinsamen Regeln für Server, Übung und Darstellung. Kleine Zeitschritte von höchstens 8 ms verarbeiten auch verzögerte Updates vollständig. Analytische Beschleunigung und Dämpfung vermeiden Unterschiede beim Bremsen zwischen Bildraten. Diagonalen werden normalisiert; nicht erneuerte Eingaben enden nach 350 ms.

Der sichtbare äußere Ringradius entspricht dem Kollisionsradius. Kontakte trennen überlappende Ringe, übertragen normalen Impuls und einen begrenzten elastischen Zusatzstoß. Die Geschwindigkeit wird direkt nach dem Kontakt begrenzt. Nur ein tatsächliches Aufeinanderzubewegen erzeugt einen Treffer: auseinanderfahrende oder ruhende Ringe vergeben keine Rauswurf-Credits. Ein kurzer Kontrollverlust erhält die Stoßrichtung, bevor die Lenkung wieder greift. Treffer werden je Ringpaar dedupliziert, sodass verschiedene Kontakte eines Kettenstoßes sichtbar bleiben.

Drei Leben bleiben die leicht verständliche Rundenregel. Wer den tatsächlichen Inselrand überfährt, fällt mit seiner tatsächlichen Bewegungsrichtung ins Wasser. Nach 1,7 Sekunden folgt ein sicherer Wiedereinstieg und 0,9 Sekunden Schutz vor Treffern. Der Schutz bleibt physisch sichtbar und solide; er verhindert kein selbst verursachtes Überfahren der Kante. Nach dem letzten Leben bleibt die Figur im Wasser. In den letzten 15 Sekunden schrumpft die reale Spielfläche auf 62 Prozent. Übrige Leben, Rauswürfe und Inselzeit entscheiden in dieser Reihenfolge.

## Gefühl und Ansicht

Die Badeinsel besitzt warme Kachelfarben, Kurvenmarkierungen und einen klaren Rand. Palmen, Liegen und eine gestreifte Überdachung rahmen das Freibad ein. Die Markierungen haben keine unsichtbaren Hindernisse; Insel und Kollisionsrand bleiben identisch.

Kurze gerichtete Ringverformung, Reaktion der Figur und ein Kontaktimpuls begleiten echte Treffer. Starke eigene Treffer erhalten einen kurzen visuellen Halt von 32 ms; die serverseitige Bewegung läuft weiter. Ruhende Kontakte erzeugen keine Tonserie. Pro Bild und mindestens 90 ms Abstand wird höchstens der stärkste neue Kontakt vertont. Eigene und fremde Spritzer werden unterschiedlich laut abgespielt; die räumliche Position bestimmt die Stereo-Richtung. Die neuen WebAudio-Klänge kombinieren einen dumpfen Gummiston, kurzen Pop und gefiltertes Wasserrauschen. Soundabschaltung und reduzierte Bewegung bleiben berücksichtigt.

Die kurze clientseitige Vorhersage simuliert alle Ringe gemeinsam mit denselben Kontaktregeln, ohne vorweggenommene Treffer oder Klänge auszulösen. Die Kamera hält die gesamte Insel im Bild und folgt keinem Rempler. Namen und Leben stehen über dem Pool, der große Stick darunter beziehungsweise im Querformat links. Menü, Lebensanzeige und Schrumpfwarnung haben getrennten Platz. Beim Sturz, bei Blur, verstecktem Tab, Größenänderung und Finale wird die Lenkung gelöst. Eine isolierte Übung mit einem stehenden Trainingsring verwendet dieselben Regeln; Partiepunkte und Bereitstatus bleiben unverändert.

## Prüfung

- 442 bestandene Regeltests, darunter 25 Bumper-Prüfungen für tatsächliche Rauswürfe, Bremsweg, Diagonalen, Eingabeverfall, Kontakte, Kettenstöße, Schutz, Wiedereinstieg, Credit-Verfall, Rundenende und echten Kurven-Schwung.
- 27 vollständige Regelsimulationen mit 2/3/4 Personen, 30/90/180-ms-Takten und fehlerhaften Eingaben.
- Echter Chromium-Touchtest: einzelner Stick, zweiter Finger, Anlauf und Abschuss, benannte Treffer-/Wasserklänge, Zeiger-/Tastatur-Blur, Neustart und isolierter Übungsabschluss; ein echter Joystick-Bogen baut messbaren Schwung und höhere Geschwindigkeit auf.
- Ansichten 390 × 844, 844 × 390 und 320 × 568: keine Überlappungen oder abgeschnittenen HUD-/Steuerelemente; Finale sperrt Eingaben. Schrumpfhinweise und reduzierte Bewegung separat geprüft.
- Die Bot-Simulation wurde um den eigenständigen Arena-Spieltyp ergänzt. Die Stabilitätsprüfung umfasst alle Tischgrößen. Menschliche Kurven-Anläufe und ihre Spielbalance müssen zusätzlich auf dem Handy beurteilt werden.

Der Browser bestätigt Funktion und Ereignisse; ob Lautstärke, Gummiston und Stoßstärke sich auf dem eigenen Handy gut anfühlen, muss der Spieltest zeigen.
