// Einzelne Aktionsknöpfe („SPRUNG", „WERFEN" …) sind auf Touch-Geräten
// doppelt: das ganze Spielbild nimmt denselben Tipp an, und dorthin schaut
// man ohnehin. Darum sind sie auf Touch-Geräten ausgeblendet. Wer sie sehen
// will, schaltet sie im Menü unter „Spielknöpfe" ein. Mit Maus bleiben sie
// sichtbar — dort ist der Knopf die naheliegende Klickfläche.
const KEY = "tumblekin-tap-buttons";

function stored() {
  try { return localStorage.getItem(KEY); } catch (_error) { return null; }
}

function touchFirst() {
  try { return window.matchMedia("(pointer: coarse)").matches; } catch (_error) { return false; }
}

export function tapButtonsVisible() {
  const choice = stored();
  if (choice === "on") return true;
  if (choice === "off") return false;
  return !touchFirst();
}

export function applyTapButtons() {
  if (typeof document === "undefined" || !document.body) return;
  const visible = tapButtonsVisible();
  document.body.classList.toggle("tap-buttons-on", visible);
  document.body.classList.toggle("tap-buttons-off", !visible);
}

export function setTapButtonsVisible(visible) {
  try { localStorage.setItem(KEY, visible ? "on" : "off"); } catch (_error) { /* privat */ }
  applyTapButtons();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  applyTapButtons();
  try { window.matchMedia("(pointer: coarse)").addEventListener("change", applyTapButtons); } catch (_error) { /* alt */ }
}
