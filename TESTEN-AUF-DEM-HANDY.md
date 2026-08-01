# Auf dem Handy testen

Zwei Dinge vorab, die sonst Zeit kosten:

- **`localhost` auf dem Handy zeigt auf das Handy selbst.** Dort läuft kein
  Server. Es braucht immer eine Maschine, die das Spiel ausliefert.
- **Die GitHub-App kann keine Codespaces starten.** Das geht nur im Browser
  (Safari/Chrome auf github.com), nicht in der App.

## A) Dauerhafte Adresse per Render — kein Terminal nötig

Der bequemste Weg vom Handy. Ergebnis ist eine feste HTTPS-Adresse, die du auch
Freunden schicken kannst.

**Als Web Service anlegen, nicht als Blueprint.** Render verschiebt den
Blueprint-Punkt immer wieder in der Oberfläche, und man braucht ihn nicht: der
Dienst kommt mit zwei ausgefüllten Feldern aus. Die Angaben unten wurden unter
Produktionsbedingungen geprüft — der Server bindet auf `0.0.0.0`, braucht nur
die Variable `PORT` (die Render selbst setzt), und das Entwickler-Werkzeug ist
ohne weiteres Zutun aus.

1. Im **Handy-Browser** öffnen: <https://render.com> → **Get Started** →
   mit GitHub anmelden.
2. **New** → **Web Service**.
3. Das Repository `tumblekin` verbinden und auswählen.
4. Diese Felder setzen — der Rest bleibt, wie er ist:

   | Feld | Wert |
   | --- | --- |
   | Branch | `main` |
   | Language / Runtime | `Node` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | `Free` |

5. **Create Web Service**. Nach zwei bis drei Minuten steht oben eine Adresse
   der Form `https://tumblekin-xxxx.onrender.com`. Die im Browser öffnen und
   spielen.

Alle 30 Minispiele liegen auf `main`, du musst am Branch also nichts drehen.

Zum Gratis-Tarif: der Dienst schläft bei Inaktivität ein und braucht beim
nächsten Aufruf etwa eine Minute zum Aufwachen. Beim ersten Laden also Geduld.

`render.yaml` liegt weiterhin im Repository. Wer den Blueprint-Punkt in der
Oberfläche findet, kann ihn benutzen — nötig ist er nicht.

## B) GitHub Codespaces — im Browser, nicht in der App

Im Handy-Browser öffnen, nicht in der GitHub-App:

<https://github.com/codespaces/new>

1. Dort das Repository `tumblekin` und als Branch `main` auswählen, dann
   **Create codespace** antippen.
2. Beim ersten Mal ein bis zwei Minuten warten. `npm install` und `npm start`
   laufen dank `.devcontainer/devcontainer.json` automatisch — du musst nichts
   tippen.
3. Es erscheint eine Meldung zu Port 3000 → **Open in Browser**. Alternativ im
   Reiter **Ports** die Adresse zu Port 3000 antippen.
4. Sollen weitere Geräte mitspielen: im Reiter **Ports** die Sichtbarkeit von
   Port 3000 auf **Public** stellen, sonst kommen fremde Geräte nicht drauf.

Codespaces stoppen nach etwa 30 Minuten Leerlauf. Für längeres Testen ist
Weg A angenehmer.

## C) Rechner im gleichen WLAN

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

## Allein spielen, ohne zweites Gerät

In der Lobby **Mit Bots auffüllen** antippen: die Bots würfeln selbst und
spielen alle Challenges mit. Damit lässt sich eine komplette Partie allein
durchspielen.

## Zum Homescreen hinzufügen

Das Spiel ist eine PWA. Über „Zum Home-Bildschirm" (iOS: Teilen-Menü, Android:
Browser-Menü) startet es im Vollbild ohne Browserleiste — auf dem Handy die
deutlich bessere Spielerfahrung.

## Wenn etwas nicht klappt

- Roter Balken „Server nicht erreichbar": die Seite wurde geladen, aber die
  Spielverbindung steht nicht. Bei Weg B die Port-Sichtbarkeit prüfen, bei
  Weg C die Firewall.
- Ton kommt erst nach der ersten Berührung — Browser erlauben Audio nicht ohne
  Nutzergeste.
- Vibration gibt es nur auf Android; iOS unterstützt `navigator.vibrate` nicht.
