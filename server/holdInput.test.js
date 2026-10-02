const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("Halten: eigener Finger, mehrere Finger, Abbruch und Tabwechsel", async () => {
  const oldWindow = global.window;
  const oldDocument = global.document;
  global.window = new EventTarget();
  global.document = Object.assign(new EventTarget(), { hidden: false });
  const listeners = [];
  const scene = { on(target, name, handler) { target.addEventListener(name, handler); listeners.push([target, name, handler]); } };
  const target = new EventTarget();
  const changes = [];
  const pointer = (where, type, id) => where.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: id }));
  try {
    const { bindHoldInput } = await import(pathToFileURL(path.join(__dirname, "../client/src/minigames/HoldInput.js")).href);
    bindHoldInput(scene, [target], (active) => changes.push(active));
    pointer(target, "pointerdown", 1);
    pointer(window, "pointerup", 2); // zweiter Finger am Aktionsknopf
    assert.deepEqual(changes, [true]);
    pointer(target, "pointerdown", 3);
    pointer(window, "pointercancel", 1);
    assert.deepEqual(changes, [true]);
    pointer(window, "pointerup", 3);
    assert.deepEqual(changes, [true, false]);
    pointer(target, "pointerdown", 4);
    window.dispatchEvent(new Event("blur"));
    pointer(window, "pointerup", 4); // verspätetes Loslassen ist wirkungslos
    assert.deepEqual(changes, [true, false, true, false]);
    pointer(target, "pointerdown", 5);
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(changes.at(-1), true);
    document.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(changes.at(-1), false);
    pointer(target, "pointerdown", 6);
    pointer(target, "lostpointercapture", 6);
    assert.equal(changes.at(-1), false);
  } finally {
    listeners.forEach(([target, name, handler]) => target.removeEventListener(name, handler));
    if (oldWindow === undefined) delete global.window; else global.window = oldWindow;
    if (oldDocument === undefined) delete global.document; else global.document = oldDocument;
  }
});
