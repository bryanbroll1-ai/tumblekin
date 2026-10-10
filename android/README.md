# Android-Test-App

Eine kleine Android-Hülle um die Browser-Fassung (`browser/dist`). Die App
bringt alles mit und läuft ohne Netz: Spielserver und Bots laufen wie in der
Browser-Fassung im Fenster selbst.

Die App ist zum Testen gedacht, nicht für den Play Store (siehe `RELEASE.md`).

## Was geht, was nicht

- **Geht:** alles allein gegen Bots — jede Spielart, alle Minispiele, Übung,
  Ton und Vibration. Im Vollbild, mit wachem Bildschirm und fest im
  Hochformat.
- **Geht nicht:** mit Freunden spielen. Beitreten per Code braucht in der
  Browser-Fassung die Raumfunktion von claude.ai, und die gibt es in der App
  nicht. Die Startkarte sagt das.
- **Zurück** beendet die App erst beim zweiten Druck innerhalb von zwei
  Sekunden, damit ein Wisch vom Rand keine Partie abbricht.

## Bauen

```bash
npm run apk          # = bash android/build-apk.sh
```

Ergebnis: `android/build/tumblekin-test.apk`. Das Skript baut vorher die
Browser-Fassung neu (mit `SKIP_WEB=1` nicht).

Es braucht kein Gradle und kein vollständiges Android-SDK, nur die
AOSP-Werkzeuge. Unter Debian/Ubuntu:

```bash
apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
```

Mit einem Android-SDK geht es genauso: `ANDROID_JAR` auf eine `android.jar`
zeigen lassen und `aapt`, `zipalign`, `apksigner` sowie `d8` (oder `dx`) in
den `PATH` legen.

Gebaut wird gegen API 23 (die `android.jar` aus Ubuntu), als Ziel steht
API 34, laufen tut die App ab Android 7.0 (API 24). Signiert wird nach
Schema v2 und v3.

### Versionsnummer

Der Name ist `<package.json-Version>-test.<Commit>`, mit `+lokal`, wenn es
ungespeicherte Änderungen gab. Die Nummer ist die Zahl der Commits — so steigt
sie mit jedem Stand, und Android installiert eine neuere Fassung als Update
über die alte.

### Schlüssel

Beim ersten Bauen legt das Skript einen Testschlüssel in
`android/.keystore/` an. Der gehört nicht ins Repository. Android installiert
ein Update nur, wenn es mit demselben Schlüssel signiert ist; wer auf einer
anderen Maschine baut, muss die alte App vorher deinstallieren — oder den
Schlüssel über `TUMBLEKIN_KEYSTORE` und `TUMBLEKIN_KEYSTORE_PASS` mitgeben.

## Prüfen

```bash
npm run apk-check    # = node android/web-check.mjs [minispiel]
```

Ohne Handy: Chromium bekommt die Seite genau so, wie die App sie ausliefert —
dieselbe Adresse, dieselben Pfadregeln, dieselben MIME-Typen (gelesen aus
`MainActivity.java`) und der User-Agent einer Android-WebView mit dem
Kennzeichen der App. Geprüft wird, dass die Seite ohne Fehler startet, keine
Datei fehlt, die Startkarte „Test-App“ sagt und eine Runde gegen Bots bis zum
Ergebnis läuft.

Auf dem Handy hilft `chrome://inspect` am Rechner (USB-Debugging an): die
Test-App gibt ihre Seite zum Untersuchen frei, Konsolenmeldungen landen
zusätzlich im Logcat unter `Tumblekin`.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `AndroidManifest.xml` | eine Activity, Berechtigungen INTERNET und VIBRATE |
| `src/app/tumblekin/test/MainActivity.java` | WebView, Auslieferung der Assets, Vollbild, Tastatur, Zurück |
| `res/` | Name, Farben, Thema, Symbol (adaptiv aus `client/assets/icon-512-maskable.png`) |
| `build-apk.sh` | Bauen: Ressourcen → Java → Dex → Paket → ausrichten → signieren |
| `web-check.mjs` | Prüfung der ausgelieferten Seite in Chromium |

Die Seite kommt aus `assets/www` und wird unter
`https://appassets.androidplatform.net/` ausgeliefert. Diese Adresse hat
Android für genau diesen Zweck reserviert, sie geht nie ins Netz. Über
`file://` liefe das Modul-Skript nicht, und `localStorage` hätte keinen festen
Ursprung. Die Seite erkennt die App am Zusatz `TumblekinApp/<Version>` im
User-Agent (`browser/boot.js`).
