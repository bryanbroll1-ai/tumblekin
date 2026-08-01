// Steht jede Figur sauber auf dem Boden — und ist sie überhaupt im Bild?
//
//   npm run scene-check
//
// Der Fehler ist über 30 Szenen von Hand nicht zuverlässig zu finden: jede
// Szene setzt ihre Figuren auf eine eigene Höhe, und ob die zum Boden DARUNTER
// passt, sieht man erst im Bild — und auch dort nur, wenn man genau hinschaut.
//
// Gemessen wird darum direkt in der laufenden Szene: von jeder Figur aus ein
// Strahl senkrecht nach unten, und dann verglichen, wo ihre Füsse sind und wo
// die Oberfläche darunter liegt. Liegt die Oberfläche höher, steckt sie drin.
//
// Dieselbe Fahrt prüft gleich mit, ob die Figuren im BILD sind. Auf einem
// hochkanten Handy ist der sichtbare Ausschnitt schmal, und eine Figur am Rand
// verschwindet leicht. Wenn schon nicht alle hineinpassen, muss wenigstens die
// EIGENE sichtbar sein — sonst spielt man blind.
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const GAMES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ALL = ["bounceArena","finishRush","colorEscape","nervenprobe","lichtwaechter","ballonPump",
  "fassrolle","zuendstoff","muenzregen","blobklopfe","seilspringen","kanonenflug","messerwurf",
  "turmbau","bergsteiger","ballonfahrt","sumoschubs","trampolin","falschsignal","spurmaler",
  "sortierband","leuchtfolge","blitzreflex","nagelbrett","eisstock","tiefenrausch","angelduell",
  "farbenjagd","spuersinn","augenmass"];
const liste = GAMES.length ? GAMES : ALL;

// Szenen, in denen die Figur ABSICHTLICH nicht auf dem Boden steht. Ohne diese
// Liste meldet der Prüfer dort dauerhaft Fehler — und ein Werkzeug, das bei
// korrekten Szenen Alarm schlägt, wird nach dem dritten Mal nicht mehr gelesen.
// Die Sichtbarkeitsprüfung gilt trotzdem, die ist überall sinnvoll.
const FLIEGT = {
  tiefenrausch: "gräbt sich in den Schacht — unter der Erde zu sein IST das Spiel",
  ballonfahrt: "hängt am Ballon",
  trampolin: "springt",
  kanonenflug: "fliegt aus der Kanone",
  seilspringen: "springt über das Seil",
  bounceArena: "schwebt über der Platte"
};
// Szenen, in denen ABSICHTLICH nur die eigene Figur im Bild ist. Nicht überall
// lassen sich alle vier zeigen: beim Bergsteiger liegen nach zehn Sekunden
// zwanzig Welteinheiten zwischen dem Ersten und dem Letzten, und die Kamera so
// weit zurückzuziehen hiesse, die eigene Figur auf ein paar Pixel zu schrumpfen.
// Dort steht der Stand der anderen stattdessen in der Höhenleiste am Bildrand.
// Die Prüfung auf die EIGENE Figur gilt weiterhin — das ist die harte Grenze.
const NUR_EIGENE = {
  bergsteiger: "Mitspieler stehen in der Höhenleiste, nicht im Bild"
};
// Szenen, in denen EINZELNE Figuren mitten in der Runde den Boden verlassen —
// beim Sumo fliegt, wer hinausgeschubst wird. Die ganze Szene deshalb von der
// Bodenprüfung auszunehmen wäre zu grob: die drei, die noch im Ring stehen,
// sollen weiter geprüft werden. Ignoriert wird nur, wer WEIT weg ist; ein
// falsch gesetzter Fuss liegt um Zehntel daneben, ein Flug um Meter.
const FLIEGT_EINZELN = {
  sumoschubs: "wer rausgeschubst wird, fliegt"
};
const FLUG_AB = 1.0;
const exe = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome","/usr/bin/chromium"].find(existsSync);

const srv = spawn(process.execPath, ["server/server.js"], { cwd: "/home/user/tumblekin",
  env: { ...process.env, PORT: "3122", TUMBLEKIN_DEV_TOOLS: "1" }, stdio: "ignore" });
for (let i = 0; i < 150; i += 1) {
  try { if ((await fetch("http://127.0.0.1:3122/")).ok) break; } catch { /* noch nicht da */ }
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({ headless: true, executablePath: exe,
  args: ["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist","--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
await page.goto("http://127.0.0.1:3122/?dev=1", { waitUntil: "networkidle" });
await page.fill("#player-name", "Boden");
await page.click("#create-room");
await page.waitForSelector("#screen-lobby.active");
await page.click("#enable-dev-mode");
await page.waitForTimeout(500);
await page.click("#start-game");

const treffer = [];
for (const game of liste) {
  try {
    await page.waitForSelector("[data-dev-game-select]", { timeout: 20000 });
    await page.selectOption("[data-dev-game-select]", game);
    await page.click("[data-dev-challenge]");
    await page.waitForSelector("canvas.kinetic-webgl, canvas.bounce-webgl", { timeout: 20000 });
    await page.waitForTimeout(4600);

    const befund = await page.evaluate(async () => {
      const host = window.__tumblekinScene;
      if (!host?.scene) return null;
      const THREE = await import("/vendor/three/three.module.js");
      const kins = [];
      host.scene.traverse((o) => { if (o.userData?.isKin) kins.push(o); });
      if (kins.length === 0) return { keine: true };

      // Über eine ganze Bewegungsschleife messen und den TIEFSTEN Stand nehmen.
      //
      // Ein Standbild reicht nicht: die Jubelanimation hüpft bis zu 0.34 hoch,
      // und wer im falschen Moment misst, hält jubelnde Zuschauer für falsch
      // gesetzt. Der tiefste Punkt einer Schleife ist dagegen genau der Moment,
      // in dem die Füsse aufsetzen — und der gehört auf den Boden, egal welche
      // Animation gerade läuft. Ein Hüpfer dauert knapp eine Sekunde; 1.3 s
      // decken auch die langsameren.
      const tiefsteSohle = new Map();
      const sohleJetzt = (kin) => {
        let s = Infinity;
        (kin.userData.feet || []).forEach((foot) => {
          const fb = new THREE.Box3().setFromObject(foot);
          if (Number.isFinite(fb.min.y)) s = Math.min(s, fb.min.y);
        });
        if (!Number.isFinite(s)) {
          const b = new THREE.Box3().setFromObject(kin);
          s = b.min.y;
        }
        return s;
      };
      const bis = performance.now() + 1300;
      while (performance.now() < bis) {
        await new Promise((r) => requestAnimationFrame(r));
        kins.forEach((kin, index) => {
          const s = sohleJetzt(kin);
          if (Number.isFinite(s)) tiefsteSohle.set(index, Math.min(tiefsteSohle.get(index) ?? Infinity, s));
        });
      }

      const raycaster = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const aus = [];
      kins.forEach((kin, index) => {
        const box = new THREE.Box3().setFromObject(kin);
        if (!Number.isFinite(box.min.y)) return;
        // Gemessen wird die SOHLE, also die Unterkante der Fussmeshes.
        //
        // Zwei falsche Messgrössen lagen schon hier:
        //  * die Unterkante der ganzen Hülle — die schliesst Mütze und
        //    ausgestreckte Arme ein und hängt an der Pose;
        //  * der Nullpunkt der Figur — der liegt in der Körpermitte, rund 0.3
        //    ÜBER der Sohle. Damit hiess "Nullpunkt genau auf dem Boden"
        //    sauber, obwohl die Figur bis zu den Knöcheln im Boden steckte,
        //    und "0.3 darüber" schwebend, obwohl sie richtig stand. Der Prüfer
        //    hatte damit genau die Szenen gelobt, über die sich der Bericht
        //    beschwerte.
        //
        // Die Sohle ist die einzige Grösse, die beides überlebt: sie ist der
        // Punkt, der den Boden berühren soll.
        const stand = new THREE.Vector3();
        kin.getWorldPosition(stand);
        const füsse = tiefsteSohle.get(index);
        if (!Number.isFinite(füsse)) return;
        // Der Strahl startet auf KNIEHÖHE, nicht über dem Kopf.
        //
        // Von oben findet er alles: den Trichterrand über dem Arbeiter, den
        // Torbogen über den Läufern, den Buzzer vor dem Kandidaten. Welche der
        // getroffenen Flächen der Boden ist, lässt sich aus der Höhe allein
        // nicht entscheiden — die Ergebnisse wackelten von Lauf zu Lauf, je
        // nachdem, wo eine bewegte Requisite gerade stand.
        //
        // Knapp über der Sohle steht dagegen nichts als der Boden. 0.45 reicht
        // nach unten für jedes Versacken, das man überhaupt sehen würde.
        const mitte = new THREE.Vector3(stand.x, füsse + 0.45, stand.z);
        raycaster.set(mitte, down);
        // Als Boden zählt nur, worauf man auch stehen kann: keine Figuren
        // (auch keine ANDEREN — bei Zielsprint stehen die vier Läufer beim
        // Start so dicht, dass der Strahl im Rumpf des Nachbarn landete) und
        // keine Schattenflecken, die als hauchdünne Platte knapp über dem
        // Boden liegen und ihn damit verdecken.
        const kandidaten = [];
        host.scene.traverse((o) => {
          if (!o.isMesh || !o.visible || o.userData?.isShadow) return;
          let p = o;
          while (p) {
            if (p === kin || p.userData?.isKin || p.userData?.isShadow) return;
            p = p.parent;
          }
          kandidaten.push(o);
        });
        const boden = raycaster.intersectObjects(kandidaten, false)[0];
        if (!boden) return;
        // Beide Richtungen zählen. Im Boden STECKEN sieht kaputt aus, darüber
        // SCHWEBEN aber genauso — und der zweite Fall ist der leisere: beim
        // Sortierband stand der Arbeiter einen halben Meter über dem Boden, und
        // in einem Standbild fällt das kaum auf.
        // Die Toleranz muss den Taumler überleben: der senkt die Figur
        // ABSICHTLICH 0.05 unter ihre Standhöhe und kippt sie dabei nach vorn,
        // zusammen rund 0.09. Da über die ganze Schleife der TIEFSTE Stand
        // zählt, schlägt der bei jeder Szene durch, in der jemand stolpert
        // (Fassrolle, Lichtwächter). 0.12 lässt ihn durch und fängt weiterhin
        // alles, worum es geht — die echten Fehler lagen zwischen 0.12 und 0.62.
        //
        // Und sie MUSS mit der Figur mitwachsen: der Riese beim Lichtwächter
        // ist 3.4-mal so gross, sein Taumler senkt ihn also auch 3.4-mal so
        // tief. Mit fester Toleranz stand er dauerhaft auf der Fehlerliste,
        // obwohl er richtig gesetzt war.
        const toleranz = 0.12 * Math.max(1, kin.scale.y || 1);
        const abstand = boden.point.y - füsse;
        if (abstand > toleranz) {
          aus.push({ index, art: "drin", mass: Number(abstand.toFixed(3)) });
        } else if (abstand < -toleranz) {
          aus.push({ index, art: "schwebt", mass: Number((-abstand).toFixed(3)) });
        }
      });
      // Und jetzt: wer ist im Bild? Jede Figur in den Bildschirmraum werfen und
      // schauen, ob sie im sichtbaren Rechteck landet. Ein kleiner Rand zählt
      // schon als draussen — halb angeschnitten reicht zum Spielen nicht.
      const cam = host.camera;
      const draussen = [];
      let eigeneDraussen = false;
      // Die eigene Figur beim NAMEN nehmen. Vorher galt schlicht die erste
      // gefundene als die eigene — und die Reihenfolge kommt aus dem Szenen-
      // baum, nicht aus der Spielerliste. Bei Zielsprint werden acht jubelnde
      // Zuschauer VOR den Läufern gebaut; der Prüfer meldete darum einen
      // Zuschauer am Streckenrand als "die eigene Figur ist nicht im Bild".
      const eigene = host.kins?.get?.(host.getControlledPlayerId?.()) || null;
      const spielerKins = host.kins instanceof Map ? new Set(host.kins.values()) : null;
      if (cam) {
        cam.updateMatrixWorld();
        kins.forEach((kin, index) => {
          const box = new THREE.Box3().setFromObject(kin);
          const mitte = box.getCenter(new THREE.Vector3());
          const p = mitte.clone().project(cam);
          const sichtbar = p.z < 1 && p.x > -0.94 && p.x < 0.94 && p.y > -0.94 && p.y < 0.94;
          // Nur SPIELERFIGUREN zählen. Die jubelnden Zuschauer bei Zielsprint
          // stehen über 127 Einheiten Strecke verteilt — dass die meisten
          // ausserhalb des Bildes sind, ist der Sinn der Sache und keine
          // Meldung wert.
          if (!sichtbar && (!spielerKins || spielerKins.has(kin))) {
            draussen.push({ index, x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) });
            // Ohne benannte eigene Figur bleibt die alte Faustregel: viele
            // Szenen stellen genau eine hin, dann ist das die eigene.
            if (eigene ? kin === eigene : (kins.length === 1 || index === 0)) eigeneDraussen = true;
          }
        });
      }
      return { kins: kins.length, drin: aus, draussen, eigeneDraussen };
    });

    // Fliegende Einzelfiguren aussortieren, bevor irgendetwas gezählt wird.
    if (befund?.drin?.length && FLIEGT_EINZELN[game]) {
      befund.drin = befund.drin.filter((d) => d.mass < FLUG_AB);
    }
    // In den Nur-eigene-Szenen zählt allein, ob die EIGENE Figur im Bild ist.
    const sichtFehler = Boolean(befund?.draussen?.length)
      && (!NUR_EIGENE[game] || befund.eigeneDraussen);
    const sicht = befund?.draussen?.length
      ? ` · ${befund.draussen.length} ausserhalb des Bildes${befund.eigeneDraussen ? " (DARUNTER DIE EIGENE)" : ""}`
        + (NUR_EIGENE[game] && !befund.eigeneDraussen ? ` — so gewollt: ${NUR_EIGENE[game]}` : "")
      : "";
    if (sichtFehler) treffer.push({ game, ...befund });
    if (befund?.drin?.length && !FLIEGT[game]) {
      if (!sichtFehler) treffer.push({ game, ...befund });
      const drin = befund.drin.filter((d) => d.art === "drin");
      const oben = befund.drin.filter((d) => d.art === "schwebt");
      const teile = [];
      if (drin.length) teile.push(`${drin.length} im Boden (bis ${Math.max(...drin.map((d) => d.mass))})`);
      if (oben.length) teile.push(`${oben.length} schwebend (bis ${Math.max(...oben.map((d) => d.mass))})`);
      console.log(`✗ ${game.padEnd(15)} von ${befund.kins}: ${teile.join(", ")}${sicht}`);
    } else if (befund?.keine) {
      console.log(`· ${game.padEnd(15)} keine Figuren in der Szene`);
    } else {
      const grund = FLIEGT[game] ? ` (Boden nicht geprüft: ${FLIEGT[game]})` : " stehen sauber auf";
      console.log(`${sichtFehler ? "✗" : "✓"} ${game.padEnd(15)} ${befund?.kins ?? "?"} Figuren${grund}${sicht}`);
    }

    await page.waitForSelector("#screen-result.active", { timeout: 90000 });
    const r = await page.$("#result-ready");
    if (r && await r.isVisible()) await r.click().catch(() => {});
    await page.waitForSelector("#screen-board.active", { timeout: 30000 });
    await page.waitForTimeout(300);
  } catch (e) {
    console.log(`? ${game.padEnd(15)} übersprungen: ${e.message.split("\n")[0].slice(0, 60)}`);
  }
}

await browser.close();
srv.kill();
const blind = treffer.filter((t) => t.eigeneDraussen);
console.log(`\n${treffer.length} Szene(n) mit Befund.` + (blind.length
  ? ` In ${blind.length} ist die EIGENE Figur nicht im Bild: ${blind.map((t) => t.game).join(", ")}`
  : ""));
process.exit(treffer.length ? 1 : 0);
