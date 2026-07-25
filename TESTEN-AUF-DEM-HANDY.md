# Auf dem Handy testen

Drei Wege, sortiert nach Aufwand. Wichtig vorab: **`localhost` auf dem Handy
zeigt auf das Handy selbst** — dort läuft kein Server. Es braucht immer eine
Maschine, die das Spiel ausliefert.

## A) Nur ein Handy da: GitHub Codespaces

Läuft komplett im Handy-Browser, kein Rechner nötig. GitHub-Konto genügt, das
kostenlose Kontingent reicht dafür locker.

1. Repository auf github.com im Handy-Browser öffnen.
2. Grüner Button **Code** → Reiter **Codespaces** → **Create codespace on
   <branch>**. Beim ersten Mal dauert es ein bis zwei Minuten; `npm install`
   läuft dank `.devcontainer/devcontainer.json` automatisch mit.
3. Im Terminal unten eingeben:

   ```bash
   npm start
   ```

4. Es erscheint eine Meldung über Port 3000. Auf **Open in Browser** tippen —
   oder im Reiter **Ports** die Adresse zu `3000` antippen. Das ist eine
   öffentliche HTTPS-Adresse; genau die kannst du auch an Freunde schicken.
5. Zum Mitspielen mit anderen: im Reiter **Ports** bei Port 3000 die
   Sichtbarkeit auf **Public** stellen, sonst kommen fremde Geräte nicht drauf.

Vorteil gegenüber dem WLAN-Weg: die Adresse läuft über HTTPS. Das ist die
Voraussetzung dafür, dass später Gerätesensoren (Neigungssteuerung) überhaupt
nutzbar sind.

## B) Rechner im gleichen WLAN

Der schnellste Weg, wenn ein Rechner in Reichweite ist.

1. Auf dem Rechner:

   ```bash
   npm install
   npm start
   ```

2. Der Server schreibt beim Start beide Adressen:

   ```
   Tumblekin server running at http://localhost:3000
   WLAN URL: http://192.168.x.y:3000
   ```

3. Die **WLAN URL** (nicht localhost) im Handy-Browser öffnen. Handy und
   Rechner müssen im selben WLAN sein.
4. Auf dem Handy **Party starten**. Weitere Handys scannen den QR-Code aus der
   Lobby oder geben den Raumcode ein.

Klappt es nicht, blockt fast immer die Firewall des Rechners Port 3000 — bei
Windows in der Abfrage „privates Netzwerk" erlauben.

## C) Allein spielen ohne zweites Gerät

In der Lobby **Mit Bots auffüllen** antippen: die Bots würfeln selbst und
spielen alle Challenges mit. Damit lässt sich eine komplette Partie allein
durchspielen.

## Zum Homescreen hinzufügen

Das Spiel ist eine PWA. Über „Zum Home-Bildschirm" (iOS: Teilen-Menü, Android:
Browser-Menü) startet es im Vollbild ohne Browserleiste — die deutlich bessere
Spielerfahrung auf dem Handy.

## Wenn keine Verbindung zustande kommt

- Der rote Balken „Server nicht erreichbar" heißt: die Seite wurde geladen,
  aber die Spielverbindung steht nicht. Bei Weg A die Port-Sichtbarkeit prüfen,
  bei Weg B die Firewall.
- Ton kommt erst nach der ersten Berührung — Browser erlauben Audio nicht ohne
  Nutzergeste.
- Vibration gibt es nur auf Android; iOS unterstützt `navigator.vibrate` nicht.
