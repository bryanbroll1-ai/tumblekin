// Steht jede Figur über die GANZE Runde auf dem Boden — nicht nur in einem
// Moment?
//
//   npm run boden-check [spiel …]
//
// scene-check misst jedes Spiel in einem Fenster von gut einer Sekunde. Was
// später passiert — ein Stolpern am Rand, eine Figur, die nach einem Rempler
// an einer Kante landet, der Jubel im Finale —, sieht er nicht. Gemeldet wurde
// aber genau das: "manchmal hängen Figuren im Boden".
//
// Hier läuft jedes Spiel vom Countdown bis zur Ergebnistafel mit Autopilot,
// und in kurzen Abständen wird jede Figur geprüft: ein Strahl von knapp über
// der Sohle senkrecht nach unten, und verglichen, wo die Sohle ist und wo die
// Oberfläche darunter. Dazu die Fehler, die man "buggen" nennt: eine Position,
// die keine Zahl mehr ist, eine Figur, die durch den Boden gefallen ist, und
// eine, die sich von einem Bild aufs nächste über das halbe Feld versetzt.
import { launchBrowser, openRoom, pickGames, startServer, startSingle, backToLobby, watchErrors, request } from "./lib/harness.mjs";

const liste = pickGames(process.argv.slice(2).filter((a) => !a.startsWith("--")));

// Wie in scene-check: Szenen, in denen Figuren ABSICHTLICH nicht auf einer
// Fläche stehen. Die Zahl-, Fall- und Sprungprüfung gilt dort trotzdem.
const OHNE_BODEN = {
  tiefenrausch: "taucht frei im Wasser",
  ballonfahrt: "steht im Korb eines fliegenden Ballons",
  kanonenflug: "fliegt aus der Kanone",
  bounceArena: "sitzt im Schwimmring, nicht auf der Platte",
  augenmass: "sitzt auf dem Baumstamm, die Füsse hängen",
  fassrolle: "steht schräg auf einem runden Stamm"
};

const { base, stop: stopServer } = await startServer();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const errors = watchErrors(page);
await openRoom(page, base, { name: "Boden" });
await request(page, "devAutopilot", { on: true });

const befunde = [];
for (const game of liste) {
  errors.length = 0;
  try {
    await startSingle(page, game);
    const ergebnis = await page.evaluate(async (ohneBoden) => {
      const THREE = await import("/vendor/three/three.module.js");
      const raycaster = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const drin = new Map();       // Figur → tiefster Fund
      const fehler = [];
      const letzte = new Map();
      let proben = 0;
      let zuletzt = 0;
      const sohle = (kin) => {
        let s = Infinity;
        (kin.userData.legs || kin.userData.feet || []).forEach((foot) => {
          const fb = new THREE.Box3().setFromObject(foot);
          if (Number.isFinite(fb.min.y)) s = Math.min(s, fb.min.y);
        });
        return s;
      };
      // Was wurde getroffen? Der Name des nächsten benannten Vorfahren hilft
      // mehr als "BoxGeometry".
      const bodenName = (o) => {
        let p = o;
        while (p && !p.name) p = p.parent;
        const farbe = o.material?.color ? `#${o.material.color.getHexString()}` : "";
        // Ohne Namen helfen Mass und Lage beim Wiederfinden.
        const g = o.geometry?.parameters;
        const mass = g && g.width !== undefined ? ` ${g.width}×${g.height}×${g.depth}` : "";
        const lage = o.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join("/");
        return `${p?.name || o.geometry?.type || "?"}${mass}${farbe ? " " + farbe : ""} @${lage}`;
      };
      const imSpiel = () => {
        const state = window.__tumblekin.state();
        return state?.status === "minigame";
      };
      while (imSpiel()) {
        await new Promise((r) => requestAnimationFrame(r));
        const host = window.__tumblekinScene;
        if (!host?.scene || !host.kins) continue;
        const jetzt = performance.now();
        if (jetzt - zuletzt < 110) continue;
        zuletzt = jetzt;
        proben += 1;
        const m = host.update || host.minigame;
        const t = Math.round(host.now() - (m?.startedAt || 0));

        // Was als Boden zählt, einmal je Probe sammeln.
        const kandidaten = [];
        host.scene.traverse((o) => {
          if (!o.isMesh || !o.visible || o.userData?.isShadow || o.userData?.isFx || o.material?.visible === false) return;
          let p = o;
          while (p) {
            if (p.userData?.isKin || p.userData?.isShadow || p.userData?.isFx) return;
            p = p.parent;
          }
          kandidaten.push(o);
        });

        host.kins.forEach((kin, id) => {
          const pos = kin.position;
          if (![pos.x, pos.y, pos.z].every(Number.isFinite)) {
            fehler.push({ t, id, art: "Position ist keine Zahl" });
            return;
          }
          // Versetzt sich eine Figur zwischen zwei Proben weiter, als sie
          // laufen kann, springt sie sichtbar. Gemessen in Figurengrössen.
          const vorher = letzte.get(id);
          const welt = kin.getWorldPosition(new THREE.Vector3());
          // Absichtliche Sprünge (neue Runde, Rückkehr an den Start) markiert
          // die Szene mit userData.versetzt.
          const gewollt = jetzt - (kin.userData.versetzt || -1e9) < 600;
          if (vorher && kin.visible && vorher.sichtbar && !gewollt) {
            // Waagrecht gemessen: senkrecht bewegen sich Figuren absichtlich
            // schnell (Trampolin, Kanone), waagrecht springt nur, was hakt.
            const weg = Math.hypot(welt.x - vorher.p.x, welt.z - vorher.p.z) / Math.max(0.5, kin.scale.y || 1);
            const dauer = (jetzt - vorher.at) / 1000;
            if (weg > 3 + dauer * 12) fehler.push({ t, id, art: `springt ${weg.toFixed(1)} weit` });
          }
          letzte.set(id, { p: welt, at: jetzt, sichtbar: kin.visible });

          if (ohneBoden || !kin.visible || kin.userData.outOfPlay || kin.userData.sunk) return;
          const s = sohle(kin);
          if (!Number.isFinite(s)) return;
          raycaster.set(new THREE.Vector3(welt.x, s + 0.45, welt.z), down);
          const boden = raycaster.intersectObjects(kandidaten, false)[0];
          if (!boden) return;
          const tief = boden.point.y - s;
          const toleranz = 0.12 * Math.max(1, kin.scale.y || 1);
          if (tief > toleranz) {
            const an = host.animators?.get(id);
            const bisher = drin.get(id);
            const eintrag = {
              t,
              tief: Number(tief.toFixed(3)),
              pose: an?.state || "?",
              geste: an?.gesture?.name || an?.gesture?.type || "-",
              boden: bodenName(boden.object),
              wo: `${welt.x.toFixed(2)}/${welt.z.toFixed(2)}`,
              finale: Boolean(m?.finaleAt),
              mal: (bisher?.mal || 0) + 1
            };
            drin.set(id, bisher && bisher.tief >= eintrag.tief ? { ...bisher, mal: eintrag.mal } : eintrag);
          }
        });
      }
      return { proben, drin: [...drin.entries()].map(([id, e]) => ({ id, ...e })), fehler: fehler.slice(0, 6) };
    }, Boolean(OHNE_BODEN[game]));

    const namen = await page.evaluate(() => Object.fromEntries((window.__tumblekin.state()?.players || []).map((p) => [p.id, p.name])));
    const teile = [];
    ergebnis.drin.forEach((d) => teile.push(`${namen[d.id] || d.id} ${d.mal}× im Boden, bis ${d.tief} (${d.pose}/${d.geste} bei ${(d.t / 1000).toFixed(1)} s${d.finale ? ", Finale" : ""}, an ${d.wo} auf ${d.boden})`));
    ergebnis.fehler.forEach((f) => teile.push(`${namen[f.id] || f.id}: ${f.art} bei ${(f.t / 1000).toFixed(1)} s`));
    errors.forEach((e) => teile.push(`Konsole: ${e}`));
    const hinweis = OHNE_BODEN[game] ? ` (Boden nicht geprüft: ${OHNE_BODEN[game]})` : "";
    if (teile.length) {
      befunde.push(game);
      console.log(`✗ ${game.padEnd(15)} ${ergebnis.proben} Proben · ${teile.join(" · ")}`);
    } else {
      console.log(`✓ ${game.padEnd(15)} ${ergebnis.proben} Proben sauber${hinweis}`);
    }
    await page.waitForSelector("#screen-result.active, #screen-lobby.active", { timeout: 30000 }).catch(() => {});
    await backToLobby(page);
  } catch (e) {
    befunde.push(game);
    console.log(`? ${game.padEnd(15)} abgebrochen: ${e.message.split("\n")[0].slice(0, 90)}`);
    await backToLobby(page).catch(() => {});
  }
}

console.log(`\n${befunde.length} Spiel(e) mit Befund.`);
await browser.close();
await stopServer();
process.exit(befunde.length ? 1 : 0);
