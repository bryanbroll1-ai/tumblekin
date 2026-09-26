// Nachlauf (client/src/minigames/Nachlauf.js): aus Serverbildern im 11-Hz-Takt
// eine glatte Bahn machen. Vorher setzten Nagelbrett und Eisstock die Kugel
// bzw. den Stein direkt auf den letzten Serverpunkt — sie sprangen sichtbar in
// Stufen, und jedes Netz-Zittern kam als Ruck dazu.
const test = require("node:test");
const assert = require("node:assert/strict");

async function load() {
  return import("../client/src/minigames/Nachlauf.js");
}

// Ein Kanal wie im Spiel: der Server rechnet alle 90 ms ein Bild, das Netz
// braucht 40 bis 100 ms, und die Geräteuhr geht um `versatz` falsch.
function feed(nachlauf, bahn, { bis = 3000, versatz = 0, zittern = 60, ids = ["k"] } = {}) {
  const pakete = [];
  for (let t = 0; t <= bis; t += 90) {
    const ankunft = t + 40 + ((t * 7919) % zittern);
    pakete.push({ t, ankunft });
  }
  pakete.sort((a, b) => a.ankunft - b.ankunft);
  return (uhr) => {
    while (pakete.length && pakete[0].ankunft <= uhr - versatz) {
      const { t } = pakete.shift();
      nachlauf.merke(t, uhr, ids.map((id) => ({ id, ...bahn(t, id) })), (o) => o);
    }
  };
}

test("Nachlauf: gleichmässige Fahrt bleibt gleichmässig, trotz Takt und Netz-Zittern", async () => {
  const { Nachlauf } = await load();
  const n = new Nachlauf();
  const tempo = 0.8;                         // Einheiten je Sekunde
  const pump = feed(n, (t) => ({ x: (t / 1000) * tempo, y: 0, vx: tempo, vy: 0 }));
  const schritte = [];
  let vorher = null;
  for (let uhr = 0; uhr <= 2800; uhr += 16) {
    pump(uhr);
    const p = n.wo("k", uhr);
    if (uhr < 600 || !p) continue;          // anlaufen lassen
    if (vorher) schritte.push(p.x - vorher.x);
    vorher = p;
  }
  const soll = tempo * 0.016;
  assert.ok(schritte.length > 100);
  assert.ok(schritte.every((d) => d > 0), "kein Bild ohne Bewegung (keine Stufen)");
  const max = Math.max(...schritte);
  const min = Math.min(...schritte);
  assert.ok(max < soll * 1.6 && min > soll * 0.4, `Schritte ${min.toFixed(4)}…${max.toFixed(4)}, soll ${soll.toFixed(4)}`);
});

test("Nachlauf: die Bahn läuft genau durch jeden Serverpunkt — auch durch einen Abprall", async () => {
  const { Nachlauf } = await load();
  const n = new Nachlauf();
  // Bis t = 450 nach rechts, dann Abprall zurück.
  const bahn = (t) => (t <= 450 ? { x: t / 1000, vx: 1 } : { x: 0.45 - (t - 450) / 1000, vx: -1 });
  const pump = feed(n, (t) => ({ ...bahn(t), y: 0, vy: 0 }), { zittern: 1 });
  let weitesterPunkt = 0;
  for (let uhr = 0; uhr <= 1500; uhr += 5) {
    pump(uhr);
    const p = n.wo("k", uhr);
    if (p) weitesterPunkt = Math.max(weitesterPunkt, p.x);
  }
  // Das Serverbild bei 450 ms liegt genau am Umkehrpunkt; weiter hinaus darf
  // die gezeichnete Kugel nicht schiessen (sonst stäke sie im Nagel).
  assert.ok(Math.abs(weitesterPunkt - 0.45) < 0.002, `Umkehrpunkt ${weitesterPunkt}`);
});

test("Nachlauf: Neues erscheint erst an seinem Startpunkt, Verschwundenes geht nach dem letzten Punkt", async () => {
  const { Nachlauf } = await load();
  const n = new Nachlauf();
  // Kugel "b" gibt es von 270 bis 900 ms.
  let uhr = 0;
  const bilder = [];
  for (let t = 0; t <= 1800; t += 90) bilder.push(t);
  let sahB = false;
  let bNachEnde = false;
  for (uhr = 0; uhr <= 2200; uhr += 10) {
    while (bilder.length && bilder[0] + 50 <= uhr) {
      const t = bilder.shift();
      const liste = [{ id: "a", x: 0, y: 0, vx: 0, vy: 0 }];
      if (t >= 270 && t <= 900) liste.push({ id: "b", x: (t - 270) / 1000, y: 0, vx: 1, vy: 0 });
      n.merke(t, uhr, liste, (o) => o);
    }
    const b = n.wo("b", uhr);
    const zeit = n.zeichenzeit(uhr);
    if (b) {
      sahB = true;
      assert.ok(zeit >= 265, `b erscheint erst mit seinem ersten Bild (Zeichenzeit ${zeit})`);
      if (zeit > 900 + 60) bNachEnde = true;
    }
  }
  assert.ok(sahB, "b wurde gezeichnet");
  assert.equal(bNachEnde, false, "b verschwindet kurz nach seinem letzten Bild");
});

test("Nachlauf: eine falsch gestellte Geräteuhr stört nicht", async () => {
  const { Nachlauf } = await load();
  const n = new Nachlauf();
  const versatz = 4000;                      // die Uhr des Geräts geht vier Sekunden vor
  const pump = feed(n, (t) => ({ x: t / 1000, y: 0, vx: 1, vy: 0 }), { versatz });
  let gesehen = 0;
  let still = 0;
  let vorher = null;
  for (let uhr = versatz; uhr <= versatz + 2800; uhr += 16) {
    pump(uhr);
    const p = n.wo("k", uhr);
    if (!p || uhr < versatz + 600) continue;
    gesehen += 1;
    if (vorher !== null && p.x === vorher) still += 1;
    vorher = p.x;
  }
  assert.ok(gesehen > 100);
  assert.equal(still, 0, "die Bahn läuft durch, statt am letzten Punkt zu kleben");
});
