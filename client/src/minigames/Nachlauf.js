// Weiche Bahnen aus einem groben Servertakt.
//
// Der Server rechnet die Physik und schickt etwa elfmal pro Sekunde, wo alles
// steht. Wer diese Punkte direkt setzt, zeigt elf Bilder pro Sekunde — die
// Kugel im Nagelbrett und der Stein auf dem Eis sprangen sichtbar in Stufen,
// egal wie schnell das Gerät zeichnet, und jedes Netz-Zittern kam als Ruck
// dazu. Hier wird ein kleines Stück in der Vergangenheit gezeichnet, zwischen
// den beiden Serverbildern, die diesen Moment einschliessen. Die Bahn wird
// flüssig und läuft trotzdem genau durch jeden Punkt, den der Server gerechnet
// hat — auch durch jeden Abpraller.
//
// Gerechnet wird in SERVERZEIT (jedes Update trägt `sentAt`). Wie weit die
// Uhr des Geräts davon abliegt, misst der Nachlauf selbst: aus dem kleinsten
// Abstand zwischen Ankunft und Absendezeit der letzten Pakete. So stört weder
// eine ungenau gestellte Uhr noch ein einzelnes verspätetes Paket.

const FENSTER = 24;              // so viele Ankünfte gehen in die Uhrenschätzung ein
const HALTEN = 10;               // so viele Serverbilder je Objekt
const VORAUS_MAX = 100;          // höchstens so weit (ms) über das letzte Bild hinaus
const WEG_NACH = 45;             // so lange nach dem letzten Bild bleibt Verschwundenes sichtbar

export class Nachlauf {
  // verzug: wie weit hinter dem neuesten Serverbild gezeichnet wird (ms). Etwas
  // mehr als ein Servertakt, damit fast immer schon das nächste Bild da ist.
  constructor({ verzug = 125 } = {}) {
    this.verzug = verzug;
    this.bahnen = new Map();
    this.abstaende = [];
    this.abstand = null;
    this.letztesPaket = -Infinity;
  }

  // Ein neues Serverbild. `liste` sind alle Objekte, die es gerade gibt; wer
  // fehlt, ist verschwunden (gelandet, eingesammelt) und wird noch bis zu
  // seinem letzten Punkt zu Ende gezeichnet.
  merke(sentAtRoh, uhr, liste, lies) {
    // Ohne Absendezeit (ein älterer Server) gilt die Ankunft — ruckeliger als
    // nötig, aber nie leer.
    const sentAt = Number.isFinite(sentAtRoh) ? sentAtRoh : uhr;
    if (sentAt <= this.letztesPaket) return;
    this.letztesPaket = sentAt;
    this.abstaende.push(uhr - sentAt);
    if (this.abstaende.length > FENSTER) this.abstaende.shift();
    this.abstand = Math.min(...this.abstaende);

    const da = new Set();
    liste.forEach((item) => {
      const punkt = lies(item);
      if (!punkt) return;
      da.add(punkt.id);
      let bahn = this.bahnen.get(punkt.id);
      if (!bahn) {
        bahn = { punkte: [], weg: null };
        this.bahnen.set(punkt.id, bahn);
      }
      bahn.weg = null;
      bahn.punkte.push({ t: sentAt, x: punkt.x, y: punkt.y, vx: punkt.vx || 0, vy: punkt.vy || 0 });
      if (bahn.punkte.length > HALTEN) bahn.punkte.shift();
    });
    this.bahnen.forEach((bahn, id) => {
      if (!da.has(id) && bahn.weg === null) bahn.weg = sentAt;
      // Lange Verschwundenes vergessen.
      if (bahn.weg !== null && sentAt - bahn.weg > 3000) this.bahnen.delete(id);
    });
  }

  // Die Zeit, zu der gerade gezeichnet wird (Serverzeit).
  zeichenzeit(uhr) {
    if (this.abstand === null) return uhr - this.verzug;
    return uhr - this.abstand - this.verzug;
  }

  // Wo steht Objekt `id` jetzt im Bild? null, solange es noch nicht erschienen
  // oder schon zu Ende gezeichnet ist.
  wo(id, uhr) {
    const bahn = this.bahnen.get(id);
    if (!bahn || bahn.punkte.length === 0) return null;
    const t = this.zeichenzeit(uhr);
    const p = bahn.punkte;
    const erster = p[0];
    const letzter = p[p.length - 1];
    // Noch nicht da: erst zeigen, wenn die Zeichenzeit das erste Bild erreicht
    // — sonst stünde eine neue Kugel schon an ihrem Startpunkt, während die
    // Figur sie noch in der Hand hält.
    if (t < erster.t - 5) return null;
    if (t <= erster.t) return { x: erster.x, y: erster.y, vx: erster.vx, vy: erster.vy, zuEnde: false };
    if (t >= letzter.t) {
      if (bahn.weg !== null && t >= letzter.t + WEG_NACH) return null;
      // Über das letzte Bild hinaus: kurz mit dem letzten Tempo weiter, dann
      // stehen bleiben. Ein ausbleibendes Paket friert die Bahn so nicht sofort
      // ein, und sie schiesst auch nicht davon.
      const s = Math.min(t - letzter.t, VORAUS_MAX) / 1000;
      return { x: letzter.x + letzter.vx * s, y: letzter.y + letzter.vy * s, vx: letzter.vx, vy: letzter.vy, zuEnde: bahn.weg !== null };
    }
    for (let i = p.length - 1; i > 0; i -= 1) {
      const a = p[i - 1];
      const b = p[i];
      if (t < a.t) continue;
      // Gerade zwischen zwei Serverbildern. Eine Kurve durch die Tempi sähe
      // weicher aus, schösse aber an jedem Abprall über den Nagel hinaus —
      // gerade Stücke von einem Neuntel Sekunde sieht niemand.
      const u = (t - a.t) / Math.max(1, b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        vx: a.vx + (b.vx - a.vx) * u,
        vy: a.vy + (b.vy - a.vy) * u,
        zuEnde: false
      };
    }
    return { x: letzter.x, y: letzter.y, vx: letzter.vx, vy: letzter.vy, zuEnde: false };
  }

  // Alle Objekte, die gerade gezeichnet werden sollen.
  sichtbare(uhr) {
    const out = [];
    this.bahnen.forEach((_bahn, id) => {
      const punkt = this.wo(id, uhr);
      if (punkt) out.push({ id, ...punkt });
    });
    return out;
  }
}
