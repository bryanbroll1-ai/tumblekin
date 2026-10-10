#!/usr/bin/env bash
# Baut die Android-Test-App: eine WebView um die Browser-Fassung.
#
#   bash android/build-apk.sh          → android/build/tumblekin-test.apk
#
# Braucht kein Gradle und kein vollständiges Android-SDK, nur die Werkzeuge
# aus AOSP. Unter Debian/Ubuntu:
#
#   apt-get install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23
#
# Mit einem Android-SDK geht es auch: ANDROID_JAR auf eine android.jar zeigen
# lassen und aapt, zipalign, apksigner und dx (oder d8) in den PATH legen.
#
# Umgebung:
#   SKIP_WEB=1               browser/dist nicht neu bauen
#   ESBUILD_PATH=…           wird an browser/build.mjs durchgereicht
#   TUMBLEKIN_KEYSTORE=…     Schlüssel zum Signieren (sonst android/.keystore/,
#   TUMBLEKIN_KEYSTORE_PASS=…  wird beim ersten Bauen angelegt)
#
# Eine neue App-Fassung lässt sich nur über die alte installieren, wenn beide
# mit demselben Schlüssel signiert sind. Der Schlüssel bleibt darum liegen —
# er ist nur für Testgeräte gedacht und gehört nicht ins Repository.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
OUT="$BUILD/tumblekin-test.apk"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Fehlt: $1 — siehe Kopf von android/build-apk.sh" >&2; exit 1; }; }

need aapt; need zipalign; need apksigner; need javac; need keytool; need node
if command -v d8 >/dev/null 2>&1; then DEXER=d8
elif command -v dalvik-exchange >/dev/null 2>&1; then DEXER=dalvik-exchange
elif command -v dx >/dev/null 2>&1; then DEXER=dx
else echo "Fehlt: d8, dx oder dalvik-exchange" >&2; exit 1; fi

ANDROID_JAR="${ANDROID_JAR:-}"
if [ -z "$ANDROID_JAR" ]; then
  for candidate in "${ANDROID_HOME:-/nonexistent}"/platforms/android-*/android.jar /usr/lib/android-sdk/platforms/android-*/android.jar; do
    [ -f "$candidate" ] && ANDROID_JAR="$candidate"
  done
fi
[ -f "$ANDROID_JAR" ] || { echo "Keine android.jar gefunden (ANDROID_JAR setzen)" >&2; exit 1; }

# Version: Name aus package.json und Commit, Nummer aus der Zahl der Commits —
# so steigt sie mit jedem Stand, und Android nimmt die neue Fassung als Update.
BASE_VERSION="$(node -p "require('$ROOT/package.json').version")"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unbekannt)"
VERSION_CODE="$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)"
VERSION_NAME="$BASE_VERSION-test.$COMMIT"
git -C "$ROOT" diff --quiet HEAD -- 2>/dev/null || VERSION_NAME="$VERSION_NAME+lokal"

if [ "${SKIP_WEB:-}" != "1" ]; then
  say "Browser-Fassung bauen"
  node "$ROOT/browser/build.mjs"
fi
[ -f "$ROOT/browser/dist/index.html" ] || { echo "browser/dist fehlt" >&2; exit 1; }

rm -rf "$BUILD"
mkdir -p "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$BUILD/assets"
cp -R "$ROOT/browser/dist" "$BUILD/assets/www"

say "Ressourcen ($ANDROID_JAR)"
aapt package -f -m -J "$BUILD/gen" -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -I "$ANDROID_JAR"

say "Java übersetzen"
find "$HERE/src" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
  -d "$BUILD/classes" @"$BUILD/sources.txt"

say "Dex ($DEXER)"
if [ "$DEXER" = d8 ]; then
  d8 --min-api 24 --lib "$ANDROID_JAR" --output "$BUILD/dex" $(find "$BUILD/classes" -name '*.class')
else
  "$DEXER" --dex --min-sdk-version=24 --output="$BUILD/dex/classes.dex" "$BUILD/classes"
fi

say "Paket $VERSION_NAME ($VERSION_CODE)"
aapt package -f -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -A "$BUILD/assets" -I "$ANDROID_JAR" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" -0 arsc \
  -F "$BUILD/unaligned.apk"
(cd "$BUILD/dex" && aapt add "$BUILD/unaligned.apk" classes.dex >/dev/null)
zipalign -f -p 4 "$BUILD/unaligned.apk" "$BUILD/aligned.apk"

KEYSTORE="${TUMBLEKIN_KEYSTORE:-$HERE/.keystore/tumblekin-test.jks}"
PASS="${TUMBLEKIN_KEYSTORE_PASS:-tumblekin-test}"
if [ ! -f "$KEYSTORE" ]; then
  say "Neuer Testschlüssel: $KEYSTORE"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$PASS" -keypass "$PASS" \
    -alias tumblekin -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Tumblekin Test"
fi

say "Signieren"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$PASS" --ks-key-alias tumblekin --key-pass "pass:$PASS" \
  --out "$OUT" "$BUILD/aligned.apk"
apksigner verify "$OUT"
rm -f "$OUT.idsig"

say "Fertig: $OUT ($(du -h "$OUT" | cut -f1), $VERSION_NAME)"
