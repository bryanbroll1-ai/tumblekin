const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Quality.js liegt im Client, ist aber bewusst abhängigkeitsfrei und ohne
// Zugriff auf `window` beim Laden — deshalb lässt es sich hier direkt prüfen.
const QUALITY = pathToFileURL(
  path.join(__dirname, "..", "client", "src", "minigames", "Quality.js")
).href;

test("Bewegung: bei 60 Hz kommt genau der bisherige Wert heraus", async () => {
  const { frameLerp, frameDecay } = await import(QUALITY);
  // Die Umrechnung deutet die bisherigen festen Zahlen als „Anteil je Bild bei
  // 60 Hz". Auf 60 Hz darf sich deshalb nichts ändern — sonst wäre die
  // Umstellung eine verkappte Neuabstimmung aller Szenen.
  for (const value of [0.05, 0.08, 0.1, 0.12, 0.2, 0.24, 0.3, 0.4]) {
    assert.ok(
      Math.abs(frameLerp(value, 1 / 60) - value) < 1e-12,
      `frameLerp(${value}) muss bei 60 Hz ${value} ergeben`
    );
  }
  for (const value of [0.82, 0.85, 0.88, 0.9, 0.91]) {
    assert.ok(
      Math.abs(frameDecay(value, 1 / 60) - value) < 1e-12,
      `frameDecay(${value}) muss bei 60 Hz ${value} ergeben`
    );
  }
});

test("Bewegung: nach einer Sekunde ist das Ergebnis bildratenunabhängig", async () => {
  const { frameLerp, frameDecay } = await import(QUALITY);

  const chased = (hz) => {
    let value = 0;
    for (let frame = 0; frame < hz; frame += 1) value += (1 - value) * frameLerp(0.1, 1 / hz);
    return value;
  };
  const faded = (hz) => {
    let value = 1;
    for (let frame = 0; frame < hz; frame += 1) value *= frameDecay(0.9, 1 / hz);
    return value;
  };

  const reference = chased(60);
  const referenceFade = faded(60);
  for (const hz of [30, 45, 90, 120, 144]) {
    assert.ok(
      Math.abs(chased(hz) - reference) < 1e-6,
      `Nachziehen bei ${hz} Hz (${chased(hz)}) muss 60 Hz (${reference}) entsprechen`
    );
    assert.ok(
      Math.abs(faded(hz) - referenceFade) < 1e-6,
      `Abklingen bei ${hz} Hz (${faded(hz)}) muss 60 Hz (${referenceFade}) entsprechen`
    );
  }

  // Gegenprobe: ohne die Umrechnung liefen die Szenen auseinander. Genau das
  // war der Fehler — auf einem 120-Hz-Handy zog die Kamera doppelt so schnell
  // nach wie gedacht.
  const fixedStep = (hz) => {
    let value = 0;
    for (let frame = 0; frame < hz; frame += 1) value += (1 - value) * 0.1;
    return value;
  };
  assert.ok(
    Math.abs(fixedStep(30) - fixedStep(120)) > 0.04,
    "der alte, feste Schritt muss sich zwischen 30 und 120 Hz messbar unterscheiden"
  );
});

test("Bewegung: ein Aussetzer im Bildstrom reisst nichts kaputt", async () => {
  const { frameLerp, frameDecay } = await import(QUALITY);
  // Ein langer Frame (App im Hintergrund, Garbage Collection) darf nicht über
  // das Ziel hinausschiessen oder ein negatives Gewicht liefern.
  for (const dt of [0, 0.5, 5, 1000, NaN, undefined]) {
    const weight = frameLerp(0.1, dt);
    assert.ok(weight >= 0 && weight <= 1, `frameLerp bei dt=${dt} ergab ${weight}`);
    const keep = frameDecay(0.9, dt);
    assert.ok(keep >= 0 && keep <= 1, `frameDecay bei dt=${dt} ergab ${keep}`);
  }
  assert.equal(frameLerp(0.1, 0), 0, "ohne vergangene Zeit wird nicht nachgezogen");
  assert.equal(frameDecay(0.9, 0), 1, "ohne vergangene Zeit klingt nichts ab");
});

test("Bewegung: Funken und Staub entstehen zeitbezogen, nicht bildbezogen", async () => {
  const { frameChance } = await import(QUALITY);
  // Erwartete Anzahl Auslöser in einer Sekunde, bei verschiedenen Bildraten.
  const perSecond = (hz) => hz * frameChance(0.14, 1 / hz);
  const reference = perSecond(60);
  for (const hz of [30, 90, 120, 144]) {
    const ratio = perSecond(hz) / reference;
    assert.ok(
      ratio > 0.9 && ratio < 1.1,
      `bei ${hz} Hz entstünde das ${ratio.toFixed(2)}-fache an Partikeln`
    );
  }
  // Gegenprobe: die feste Wahrscheinlichkeit je Bild skaliert direkt mit der
  // Bildrate — auf 120 Hz doppelt so viel Staub wie auf 60.
  assert.ok((120 * 0.14) / (60 * 0.14) > 1.9, "der alte Weg musste mit der Bildrate mitwachsen");
});
