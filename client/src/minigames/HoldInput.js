// Nur die Finger auf der Haltefläche zählen. Ein Aktionsknopf neben der
// Fläche darf beim Loslassen nicht den weiterhin gehaltenen Finger lösen.
export function bindHoldInput(scene, targets, onChange) {
  const pointers = new Set();
  let active = false;
  const sync = () => {
    const next = pointers.size > 0;
    if (next === active) return;
    active = next;
    onChange(active);
  };
  const release = () => { pointers.clear(); sync(); };
  const up = (event) => {
    if (!pointers.delete(event.pointerId)) return;
    sync();
  };
  targets.forEach((target) => {
    scene.on(target, "pointerdown", (event) => {
      event.preventDefault();
      pointers.add(event.pointerId);
      sync();
    });
    scene.on(target, "lostpointercapture", up);
  });
  scene.on(window, "pointerup", up);
  scene.on(window, "pointercancel", up);
  scene.on(window, "blur", release);
  scene.on(document, "visibilitychange", () => { if (document.hidden) release(); });
  return { release };
}
