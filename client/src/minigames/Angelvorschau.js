// Angelduell: wo Schnur und Fisch stehen werden, wenn eine JETZT geschickte
// Eingabe beim Server ankommt.
//
// Der Server rechnet Spannung und Weg und schickt sie etwa elfmal pro Sekunde.
// Das Bild auf dem Gerät ist damit um die einfache Laufzeit alt, und das
// Loslassen braucht noch einmal so lange hin. Im Schub eines Welses steigt die
// Spannung um 1,2 je Sekunde — bei 200 ms Rundreise sind das 0,24, die der
// Balken zu wenig zeigte. Wer nach dem Balken losliess, riss trotzdem.
//
// Hier wird vom letzten Serverbild aus weitergerechnet, mit denselben Regeln
// wie auf dem Server und dem, was das Gerät selbst gedrückt hat. Die Wertung
// bleibt beim Server; das Gerät zeigt nur, was er gleich sehen wird.

// Der Schub, in dem der Fisch gerade steckt — oder null. `elapsed` zählt ab dem
// Anbiss (wie activeFishPhase auf dem Server).
export function fishPhaseAt(phases, elapsed) {
  for (const phase of phases || []) {
    if (elapsed >= phase.at && elapsed < phase.until) return phase;
    if (phase.at > elapsed) break;
  }
  return null;
}

// entry:   der eigene Eintrag aus dem Serverbild (tension, distance, hookedAt,
//          pauseUntil, phases, species)
// rules:   { reelSpeed, slipSpeed, tensionCalm, tensionSurge, relax }
// from:    Serverzeit des Bildes (sentAt)
// to:      Serverzeit, zu der eine jetzt geschickte Eingabe ankommt
// holding: (serverzeit) => ob der Server zu dieser Zeit „halten“ sieht
export function forecastFish(entry, rules, from, to, holding, stepMs = 20) {
  let tension = Math.max(0, entry.tension || 0);
  let distance = Math.min(1, Math.max(0, entry.distance ?? 1));
  const kind = entry.species || { reel: 1, surge: 1, calm: 1 };
  const span = Math.max(0, Math.min(600, to - from));
  let snapped = false;
  let landed = false;
  for (let t = 0; t < span && !snapped && !landed; t += stepMs) {
    const at = from + t;
    const dt = Math.min(stepMs, span - t) / 1000;
    if (at < (entry.pauseUntil || 0)) {
      tension = Math.max(0, tension - rules.relax * dt);
      continue;
    }
    const surging = Boolean(fishPhaseAt(entry.phases, Math.max(0, at - (entry.hookedAt || 0))));
    if (holding(at)) {
      distance = Math.max(0, distance - rules.reelSpeed * kind.reel * dt);
      tension += (surging ? rules.tensionSurge * kind.surge : rules.tensionCalm * kind.calm) * dt;
    } else {
      tension = Math.max(0, tension - rules.relax * dt);
      distance = Math.min(1, distance + rules.slipSpeed * dt);
    }
    if (tension >= 1) snapped = true;
    else if (distance <= 0) landed = true;
  }
  const surging = Boolean(fishPhaseAt(entry.phases, Math.max(0, from + span - (entry.hookedAt || 0))));
  return { tension: Math.min(1, tension), distance, surging, snapped, landed };
}
