# Datenschutzerklärung für Tumblekin

Stand: Juli 2026

Tumblekin ist ein lokales Partyspiel. Es gibt keine Benutzerkonten, keine
Analyse-SDKs und keine Werbung. Diese Erklärung beschreibt vollständig, welche
Daten das Spiel verarbeitet.

## Was auf dem Gerät gespeichert wird

Nur Einstellungen, damit du sie nicht bei jedem Start neu setzen musst:

| Schlüssel | Inhalt | Speicher |
| --- | --- | --- |
| `tumblekin-name` | der von dir eingegebene Spielername | localStorage |
| `tumblekin-sound` | Ton an/aus | localStorage |
| `tumblekin-vibration` | Vibration an/aus | localStorage |
| `tumblekin-session` | Raumcode und Spieler-ID der laufenden Partie | sessionStorage |

`sessionStorage` wird vom Browser geleert, sobald der Tab geschlossen wird; es
dient nur dazu, nach einem WLAN-Aussetzer oder Reload in die laufende Partie
zurückzukehren. Die localStorage-Einträge lassen sich jederzeit über die
Website-Daten des Browsers löschen.

## Was an den Server übertragen wird

Während einer Partie überträgt das Spiel ausschließlich Spieldaten an den
Server, der die Runde hostet:

- den eingegebenen Spielernamen (frei wählbar, kein echter Name nötig),
- Raumcode und eine zufällig erzeugte Spieler-ID,
- Spielzüge: Würfelwürfe, Item-Einsätze und Minispiel-Eingaben.

Der Server hält diese Daten **nur im Arbeitsspeicher**, solange der Raum
existiert. Es gibt keine Datenbank und keine Protokolldateien mit Spielerdaten;
mit dem Beenden des Servers sind sie weg.

## Was NICHT passiert

- Keine Analyse-, Tracking- oder Werbedienste.
- Keine Weitergabe an Dritte.
- Keine Standortdaten, keine Kontakte, keine Kamera, kein Mikrofon.
- Keine Verbindung zu fremden Servern: das Spiel spricht ausschließlich mit dem
  Server, von dem es geladen wurde.
- Keine Registrierung, keine E-Mail-Adresse, kein Passwort.

## Berechtigungen

Das Spiel nutzt `navigator.vibrate` für Rüttel-Feedback, sofern das Gerät es
unterstützt. Dafür ist keine Berechtigung nötig, und es lässt sich im Menü
abschalten. Weitere Geräteberechtigungen werden nicht angefragt.

## Kinder

Tumblekin richtet sich an alle Altersgruppen. Da keine personenbezogenen Daten
erhoben und keine Inhalte von Dritten geladen werden, sind keine
altersabhängigen Einschränkungen erforderlich. Der Spielername ist frei
wählbar; wir empfehlen, keinen echten Namen einzugeben.

## Netzwerk

Im WLAN-Betrieb läuft die Verbindung unverschlüsselt über HTTP innerhalb des
lokalen Netzes. Wer das Spiel über das Internet erreichbar macht, sollte HTTPS
davorschalten — für eine Store-Veröffentlichung ist eine verschlüsselte
Verbindung zum gehosteten Server verpflichtend.

## Kontakt

Verantwortlich ist der Betreiber des jeweiligen Tumblekin-Servers. Für die
Store-Veröffentlichung ist hier eine erreichbare Kontaktadresse einzutragen —
Apple und Google verlangen sie in den Store-Angaben.
