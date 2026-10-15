// Grosse Bildschirme bekommen eine grössere Oberfläche (style.css: --ui).
// Das geht nur mit dem standardisierten CSS-Zoom (Chromium 128+): Er liefert
// Klick- und Messkoordinaten in Bildschirmpixeln, wie Kamera, Steuerung und
// Treffertests sie erwarten. Ältere Browser behalten Massstab 1.
//
// Dieses Modul wird als erstes geladen, damit die Seite gleich im richtigen
// Massstab erscheint.
if (typeof document !== "undefined" && typeof Element !== "undefined" && "currentCSSZoom" in Element.prototype) {
  document.documentElement.classList.add("css-zoom");
}

// Wie stark ist ein Element insgesamt vergrössert? Wer Pixel aus
// Bildschirmmassen (getBoundingClientRect, clientX) in style-Angaben
// schreibt, teilt durch diesen Wert — sonst wächst die Strecke doppelt.
export function cssZoom(element) {
  const zoom = element?.currentCSSZoom;
  return typeof zoom === "number" && zoom > 0 ? zoom : 1;
}
