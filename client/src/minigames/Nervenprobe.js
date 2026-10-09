import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin213";
import { frameLerp } from "./Quality.js?v=tumblekin213";
import { kiste, lambert } from "./Kulisse.js?v=tumblekin213";

// Nervenprobe: die Uhr läuft sichtbar an, dann verschwindet sie — man zählt im
// Kopf weiter und drückt, wenn man glaubt, das Ziel sei erreicht.
//
// Schlicht wie bei Wii Party: ein heller Raum ohne Publikum, Vorhang und
// Scheinwerfer, in der Mitte gross die Stoppuhr mit der Zielzeit darüber,
// davor die Spieler auf Podesten in ihrer Farbe, über jedem eine weisse
// Tafel. Mehr braucht es nicht — der Blick gehört der Uhr und den Tafeln.
const PODIUM_GAP = 1.3;
const STAGE_Y = 0.14;
const KIN_Z = 0.95;
const BOARD_Y = 1.66;
const BOARD_Z = 0.55;
// Die grosse Stoppuhr: eine Umdrehung sind zehn Sekunden.
const DIAL_MS = 10000;
const DIAL_R = 1.6;
const DIAL_POS = [0, 4.05, -1.6];
const INK = "#1f2a44";

// Das Zifferblatt: weiss, zehn Sekundenmarken, und die Zielzeit als goldener
// Keil. Man sieht so, WO der Zeiger hin muss, und zählt nicht nur im Kopf.
function paintDial(canvas, targetMs) {
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();
  const at = (ms) => (ms / DIAL_MS) * Math.PI * 2 - Math.PI / 2;
  // Zielkeil: ±0,25 s um die Zielzeit.
  ctx.fillStyle = "rgba(255, 190, 30, 0.95)";
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.arc(c, c, c - 10, at(targetMs - 250), at(targetMs + 250));
  ctx.closePath();
  ctx.fill();
  for (let s = 0; s < 10; s += 1) {
    const a = at(s * 1000);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * (c - 18), c + Math.sin(a) * (c - 18));
    ctx.lineTo(c + Math.cos(a) * (c - 46), c + Math.sin(a) * (c - 46));
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = "800 46px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(s), c + Math.cos(a) * (c - 84), c + Math.sin(a) * (c - 84));
  }
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2).replace(".", ",")} s`;
}

// Abweichung mit Vorzeichen: "+0.23" zu spät, "−0.10" zu früh.
function formatDeviation(stoppedMs, targetMs) {
  const d = (stoppedMs - targetMs) / 1000;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2).replace(".", ",")}`;
}

// Wie gut: golden bis 0,15 s, grün bis 0,4 s, dann gelb, ab einer Sekunde rot.
function accentFor(deviation) {
  if (deviation === null || deviation === undefined) return "#ff6b7f";
  if (deviation < 150) return "#ffd76a";
  if (deviation < 400) return "#7df0a0";
  if (deviation < 1000) return "#ffd166";
  return "#ff8a6b";
}

// Die Auflösung im Takt: erst nach einer kurzen Pause die erste Anzeige, dann
// alle 380 ms die nächste, zuletzt die beste — und dann der Jubel.
const REVEAL_FIRST_MS = 300;
const REVEAL_STEP_MS = 380;
const REVEAL_SWEEP_MS = 450;

// Die Tafel über einem Spieler: weisse Karte, dicker Rand in der Farbe des
// Zustands, dunkle Ziffern. Keine Neonschrift, kein Glas.
function createTimerDisplay() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 136;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const back = new THREE.MeshLambertMaterial({ color: "#e9eef6" });
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.64, 0.06),
    [back, back, back, back, new THREE.MeshBasicMaterial({ map: texture, transparent: true }), back]
  );
  panel.userData = { canvas, ctx, texture, lastText: null, lastAccent: null };
  return panel;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paintDisplay(panel, text, accent = "#33cf4d", sub = "", ink = INK) {
  const { ctx, canvas, texture, lastText, lastAccent } = panel.userData;
  if (lastText === text + sub + ink && lastAccent === accent) return;
  panel.userData.lastText = text + sub + ink;
  panel.userData.lastAccent = accent;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  roundedRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 30);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, 13, 13, canvas.width - 26, canvas.height - 26, 20);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = `900 ${sub ? 50 : 62}px ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + (sub ? -14 : 3));
  if (sub) {
    ctx.font = "800 28px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = "#5a6478";
    ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 33);
  }
  texture.needsUpdate = true;
}

// Das Zielschild über der Uhr: eine weisse Pille mit der Zielzeit.
function paintSign(panel, targetMs, accent) {
  const text = `ZIEL  ${(targetMs / 1000).toFixed(1).replace(".", ",")} s`;
  const { ctx, canvas, texture } = panel.userData;
  if (panel.userData.lastText === text + accent) return;
  panel.userData.lastText = text + accent;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  roundedRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 56);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, 16, 16, canvas.width - 32, canvas.height - 32, 46);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = "900 72px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  texture.needsUpdate = true;
}

export class Nervenprobe extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stations = new Map();
    this.lastStopped = new Map();
    this.hidAt = false;
    this.labelY = 0.74;
    this.nextNod = new Map();
    this.finaleFocus = false;
    this.reveal = null;
  }

  stage() {
    return {
      label: "3D Nervenprobe",
      background: "#cfeaff",
      fog: ["#cfeaff", 24, 60],
      lights: { sunPosition: [-3, 10, 8], skyColor: 0xffffff, groundColor: 0xc9d6e8, sunColor: 0xfff8ec, sunIntensity: 2.4, hemiIntensity: 1.6 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><strong data-nerve-target></strong></div>
      <div class="color-banner" data-nerve-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    // Ein heller Boden, eine ruhige Wand, ein weisser Kreis hinter der Uhr.
    const boden = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.2, 48), lambert("#f3f6fb"));
    boden.position.set(0, -0.1, 0.5);
    boden.receiveShadow = true;
    scene.add(boden);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.1, 3.3, 48), new THREE.MeshBasicMaterial({ color: "#dbe6f4" }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.005, 0.6);
    scene.add(ring);
    kiste(scene, 24, 16, 0.3, "#8fcfff", [0, 7.8, -2.6], { schatten: false });
    kiste(scene, 24, 0.5, 0.4, "#6db8f2", [0, 0.25, -2.4], { schatten: false });
    const halo = new THREE.Mesh(new THREE.CircleGeometry(DIAL_R + 0.55, 48), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55 }));
    halo.position.set(DIAL_POS[0], DIAL_POS[1], -2.43);
    scene.add(halo);

    this.buildStopwatch();
    this.buildTargetSign();

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addStation(player, index, players.length));
  }

  buildStopwatch() {
    const arcade = this.minigame?.arcade;
    const group = new THREE.Group();
    group.position.set(...DIAL_POS);
    const rahmen = new THREE.MeshLambertMaterial({ color: "#ffb21e" });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(DIAL_R + 0.14, DIAL_R + 0.14, 0.26, 48), rahmen);
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.22), rahmen);
    crown.position.y = DIAL_R + 0.26;
    group.add(crown);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.26), lambert("#ff3b52"));
    cap.position.y = DIAL_R + 0.44;
    group.add(cap);

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    paintDial(canvas, arcade?.targetMs || 5000);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.CircleGeometry(DIAL_R, 48), new THREE.MeshBasicMaterial({ map: texture }));
    face.position.z = 0.135;
    group.add(face);

    // Der Zeiger dreht um die Mitte.
    this.hand = new THREE.Group();
    this.hand.position.z = 0.15;
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.07, DIAL_R * 0.84, 0.03), new THREE.MeshBasicMaterial({ color: "#ff3b52" }));
    needle.position.y = DIAL_R * 0.4;
    this.hand.add(needle);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), new THREE.MeshBasicMaterial({ color: INK }));
    hub.rotation.x = Math.PI / 2;
    this.hand.add(hub);
    group.add(this.hand);

    // Die Abdeckung: nach zwei Sekunden legt sie sich über das Blatt.
    const coverCanvas = document.createElement("canvas");
    coverCanvas.width = 256;
    coverCanvas.height = 256;
    const pen = coverCanvas.getContext("2d");
    pen.fillStyle = "#3b4a6b";
    pen.beginPath();
    pen.arc(128, 128, 126, 0, Math.PI * 2);
    pen.fill();
    pen.fillStyle = "#ffffff";
    pen.font = "900 150px ui-rounded, system-ui, sans-serif";
    pen.textAlign = "center";
    pen.textBaseline = "middle";
    pen.fillText("?", 128, 138);
    const coverTex = new THREE.CanvasTexture(coverCanvas);
    coverTex.colorSpace = THREE.SRGBColorSpace;
    this.cover = new THREE.Mesh(new THREE.CircleGeometry(DIAL_R + 0.02, 48), new THREE.MeshBasicMaterial({ map: coverTex, transparent: true, opacity: 0 }));
    this.cover.position.z = 0.17;
    group.add(this.cover);

    this.dialMarks = new Map();
    this.scene.add(group);
    this.dial = group;
  }

  // Das Zielschild schwebt direkt über der Uhr.
  buildTargetSign() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 136;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 0.9),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false })
    );
    sign.userData = { canvas, ctx: canvas.getContext("2d"), texture, lastText: null };
    sign.position.set(DIAL_POS[0], DIAL_POS[1] + DIAL_R + 1.1, DIAL_POS[2] + 0.1);
    this.scene.add(sign);
    paintSign(sign, this.minigame?.arcade?.targetMs || 5000, "#ffb21e");
    this.targetSign = sign;
  }

  // Bei der Auflösung steckt für jeden eine Marke in seiner Farbe am Rand —
  // dort, wo er gestoppt hat.
  markDial(player, ms) {
    if (this.dialMarks.has(player.id) || !this.dial) return;
    const angle = -(ms / DIAL_MS) * Math.PI * 2;
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.08), new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.4 }));
    mark.position.set(-Math.sin(angle) * (DIAL_R + 0.02), Math.cos(angle) * (DIAL_R + 0.02), 0.2);
    mark.rotation.z = angle;
    this.dial.add(mark);
    this.dialMarks.set(player.id, mark);
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * PODIUM_GAP;
  }

  addStation(player, index, count) {
    const x = this.stationX(index, count);
    // Ein rundes Podest in der Farbe des Spielers.
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, STAGE_Y, 28), lambert(player.color));
    pad.position.set(x, STAGE_Y / 2, KIN_Z);
    pad.receiveShadow = true;
    this.scene.add(pad);
    this.addKin(player, index, { x, ground: STAGE_Y, z: KIN_Z, facing: 0 });
    // Ein schlanker Buzzer rechts neben der Figur, auf Handhöhe.
    const px = x + 0.4;
    const saeule = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), lambert("#ffffff"));
    saeule.position.set(px, STAGE_Y + 0.25, KIN_Z + 0.12);
    saeule.castShadow = true;
    this.scene.add(saeule);
    const buzzer = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 16), new THREE.MeshLambertMaterial({ color: "#ff3b52", emissive: "#ff3b52", emissiveIntensity: 0.2 }));
    buzzer.position.set(px, STAGE_Y + 0.54, KIN_Z + 0.12);
    this.scene.add(buzzer);
    // Die Tafel schwebt über dem Kopf.
    const display = createTimerDisplay();
    display.position.set(x, BOARD_Y, BOARD_Z);
    this.scene.add(display);
    this.stations.set(player.id, { x, buzzer, display });
  }

  // Die Posen des Finales (Jubel, Enttäuschung) erst, wenn die Auflösung
  // durch ist — vorher jubelte der Sieger, bevor seine Zahl zu sehen war.
  finaleOverride() {
    return !this.jubelt;
  }

  shot() {
    const count = Math.max(1, this.stations.size);
    // Breit genug für die äusseren Tafeln, hoch genug für Uhr und Zielschild.
    return {
      look: [0, 3.25, 0.2],
      frame: { w: Math.max(4.2, count * PODIUM_GAP + 0.9), h: 7.2 },
      pitch: 0.12,
      fov: 36,
      intro: { yaw: 0.45, pitch: 0.18, zoom: 1.35 },
      // Die Auflösung IST das Finale: alle Tafeln und die Uhr bleiben im Bild.
      finale: { pull: 0.95, zoom: 1, lift: 0.1, orbit: 0.04 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-nerve-stop>
        <span class="nerve-button-face">STOPP</span>
      </button>`;
    this.stopButton = this.controls.querySelector("[data-nerve-stop]");
    this.on(this.stopButton, "pointerdown", (event) => {
      event.preventDefault();
      this.pressStop();
    });
  }

  pressStop() {
    const arcade = (this.update || this.minigame)?.arcade;
    const id = this.getControlledPlayerId();
    const own = arcade?.players?.[id];
    this.localStops ||= new Set();
    if (!own || own.stoppedMs !== null || this.localStops.has(id)) return;
    this.localStops.add(id);
    this.feedback?.sound("pop");
    this.feedback?.vibrate([14, 10, 22]);
    this.rig.shake(0.4);
    this.animators.get(id)?.trigger("punch");
    this.sendInput({ action: "stop" }).catch(() => { this.localStops.delete(id); });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    if (!arcade) return;
    // Die Uhr läuft auf Ankunftszeit: Wer im Kopf weiterzählt und beim
    // Zielwert tippt, dessen Tipp kommt beim Server auch bei diesem Wert an —
    // sonst zählte die Netzlaufzeit hin und zurück als eigener Fehler.
    const elapsed = Math.max(0, this.arrivalNow() - minigame.startedAt);
    const hidden = elapsed >= arcade.hideAfterMs;
    const revealAll = Boolean(minigame.finaleAt);
    if (hidden && !this.hidAt) {
      this.hidAt = true;
      this.feedback?.sound("move");
    }
    // Die Auflösung: vom Weitesten zum Nächsten, einer nach dem anderen.
    if (revealAll && !this.reveal) {
      const reihe = players
        .map((player) => ({ player, entry: arcade.players[player.id] }))
        .filter((r) => r.entry)
        .sort((a, b) => (b.entry.deviationMs ?? Infinity) - (a.entry.deviationMs ?? Infinity));
      const sieger = reihe.length && reihe[reihe.length - 1].entry.deviationMs !== null ? reihe[reihe.length - 1] : null;
      this.reveal = {
        at: now,
        order: reihe.map((r, i) => ({ id: r.player.id, due: now + REVEAL_FIRST_MS + i * REVEAL_STEP_MS, done: false })),
        winnerAt: now + REVEAL_FIRST_MS + Math.max(0, reihe.length - 1) * REVEAL_STEP_MS + 320,
        winner: sieger,
        cheered: false
      };
      this.feedback?.sound("countdown");
    }
    const aufgedeckt = (id) => Boolean(this.reveal?.order.find((o) => o.id === id && now >= o.due));
    const jubelt = Boolean(this.reveal && now >= this.reveal.winnerAt);
    this.jubelt = jubelt;

    // Die grosse Uhr: der Zeiger läuft, solange man ihn sehen darf; dann
    // deckt sie sich zu, und zur Auflösung öffnet sie sich und der Zeiger
    // fährt zur Zielzeit.
    if (this.hand) {
      let shownMs = hidden ? arcade.hideAfterMs : elapsed;
      if (this.reveal) {
        const u = Math.min(1, (now - this.reveal.at) / REVEAL_SWEEP_MS);
        const e = 1 - Math.pow(1 - u, 3);
        shownMs = arcade.hideAfterMs + (arcade.targetMs - arcade.hideAfterMs) * e;
      }
      this.hand.rotation.z = -(shownMs / DIAL_MS) * Math.PI * 2;
      const coverTarget = hidden && !revealAll ? 1 : 0;
      this.cover.material.opacity += (coverTarget - this.cover.material.opacity) * frameLerp(0.2, dt);
      this.cover.visible = this.cover.material.opacity > 0.01;
    }

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const station = this.stations.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !station || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const stoppedReally = entry.stoppedMs !== null && entry.stoppedMs !== undefined;
      // DASS jemand gestoppt hat, sieht man sofort — Anzeige "STOP", blaue
      // Lampe, gedrückter Buzzer. WELCHE Zeit er hat, erst in der Auflösung,
      // wenn alle gedrückt haben.
      const stopped = stoppedReally;
      const offen = revealAll && aufgedeckt(player.id);
      const deviation = entry.deviationMs ?? null;
      if (offen) {
        const siegerHier = jubelt && this.reveal.winner?.player.id === player.id;
        paintDisplay(
          station.display,
          stoppedReally ? formatSeconds(entry.stoppedMs) : "—",
          siegerHier ? (Math.floor(now / 160) % 2 === 0 ? "#ffb21e" : "#ffd76a") : accentFor(stoppedReally ? deviation : null),
          stoppedReally ? formatDeviation(entry.stoppedMs, arcade.targetMs) : "kein Stopp"
        );
      } else if (revealAll) {
        paintDisplay(station.display, "?", Math.floor(now / 140) % 2 === 0 ? "#ffb21e" : "#ffd76a");
      } else if (stopped) {
        paintDisplay(station.display, "✓", "#2f7bff", "", "#2f7bff");
      } else if (!hidden) {
        paintDisplay(station.display, formatSeconds(elapsed), "#33cf4d");
      } else {
        paintDisplay(station.display, "?", "#b8c3d6", "", "#8a96ad");
      }
      station.buzzer.position.y += ((stopped ? STAGE_Y + 0.5 : STAGE_Y + 0.54) - station.buzzer.position.y) * frameLerp(0.25, dt);
      station.buzzer.material.emissiveIntensity = stopped ? 1 : 0.2;

      if (stoppedReally && !this.lastStopped.get(player.id)) {
        this.lastStopped.set(player.id, true);
        if (!isOwn) {
          animator.trigger("punch");
          this.feedback?.sound("move");
        }
        this.burst(station.buzzer.position.clone().setY(STAGE_Y + 0.6), ["#ff2038", "#ffffff"], { count: 9, speed: 1.9, up: 1.6, size: 0.07, life: 0.5, drag: 2, fadePow: 1.4 });
      }

      // Aufdecken: Marke an der Uhr, Funken, die Abweichung als Zahl.
      const slot = this.reveal?.order.find((o) => o.id === player.id);
      if (slot && offen && !slot.done) {
        slot.done = true;
        if (stoppedReally) this.markDial(player, entry.stoppedMs);
        const farbe = accentFor(stoppedReally ? deviation : null);
        this.burst(station.display.position.clone().add(new THREE.Vector3(0, 0, 0.2)), [farbe, "#ffffff"], { count: 10, speed: 1.6, up: 1.2, size: 0.06, life: 0.5, drag: 2 });
        this.pop(new THREE.Vector3(station.x, BOARD_Y + 0.55, BOARD_Z + 0.1), stoppedReally ? `${(deviation / 1000).toFixed(2).replace(".", ",")} s` : "—", { color: farbe, size: isOwn ? 0.34 : 0.28, life: 0.9, rise: 0.4 });
        this.feedback?.sound("pop", { pan: station.x * 0.2 });
        if (isOwn) this.feedback?.vibrate(12);
        animator.trigger(stoppedReally && deviation < 400 ? "hop" : "flinch", { height: 0.2 });
      }

      if (revealAll) {
        if (!stoppedReally) animator.set("shrug");
        else if (!jubelt) {
          // Bangen, bis die eigene Zahl aufgeht.
          animator.set("focus");
          animator.lookAt(station.display.position);
        }
        return;
      }
      if (stopped) {
        // Gedrückt — und jetzt bangen: auf die eigene Anzeige schauen.
        animator.set("focus");
        animator.lookAt(station.display.position);
        animator.expression("scared", 150);
      } else if (hidden) {
        animator.set("think");
        animator.lookAt(null);
        // Nervöses Nicken, aber in keinem Takt: früher nickten alle genau im
        // Sekundentakt, und man konnte die Zeit einfach an den Figuren
        // abzählen. Jetzt hat jede ihren eigenen, unregelmässigen Abstand.
        const due = this.nextNod.get(player.id) ?? now + 900 + Math.random() * 1400;
        if (now >= due) {
          animator.trigger("nod");
          this.nextNod.set(player.id, now + 1300 + Math.random() * 1700);
        } else {
          this.nextNod.set(player.id, due);
        }
      } else {
        animator.set("focus");
        animator.lookAt(station.display.position);
      }
    });

    // Der Sieger: goldene Anzeige, Konfetti, das Publikum steht auf.
    if (jubelt && !this.reveal.cheered) {
      this.reveal.cheered = true;
      const sieger = this.reveal.winner;
      if (sieger) {
        const station = this.stations.get(sieger.player.id);
        if (station) {
          this.burst(station.display.position.clone().add(new THREE.Vector3(0, 0.3, 0.2)), [sieger.player.color, "#ffd76a", "#ffffff"], { count: 30, speed: 2.6, up: 2.4, size: 0.08, life: 1, drag: 1.4 });
          this.pop(new THREE.Vector3(station.x, BOARD_Y + 0.95, BOARD_Z + 0.1), sieger.entry.deviationMs < 100 ? "🎯 VOLLTREFFER!" : "AM NÄCHSTEN!", { color: "#ffb21e", size: 0.4, life: 1.2, rise: 0.5 });
        }
      }
      this.rig.shake(0.35);
      this.feedback?.vibrate([30, 30, 60]);
    }

    // Das Zielschild blinkt in der Auflösung.
    if (this.targetSign) {
      paintSign(this.targetSign, arcade.targetMs, revealAll && !this.jubelt && Math.floor(now / 200) % 2 === 0 ? "#ffd76a" : "#ffb21e");
    }
  }

  drawHud(f) {
    const { arcade, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, this.arrivalNow() - minigame.startedAt);
    const hidden = elapsed >= arcade.hideAfterMs;
    const revealAll = Boolean(minigame.finaleAt);
    // Oben links steht nur die Zielzeit. Eine mitlaufende Rundenuhr gibt es
    // hier nicht — sie verriete die Zeit, die man schätzen soll; die Uhr in
    // der Mitte und die Tafeln zeigen sie, solange man sie sehen darf.
    this.targetNode ||= this.hud.querySelector("[data-nerve-target]");
    const target = `Ziel ${(arcade.targetMs / 1000).toFixed(1).replace(".", ",")} s`;
    if (this.targetNode.textContent !== target) this.targetNode.textContent = target;
    const banner = this.hud.querySelector("[data-nerve-banner]");
    const own = arcade.players[this.getControlledPlayerId()];
    const stopped = this.localStops?.has(f.controlledId) || (own?.stoppedMs !== null && own?.stoppedMs !== undefined);
    if (revealAll) {
      banner.hidden = false;
      const sieger = this.jubelt ? this.reveal?.winner : null;
      const name = sieger ? (f.state?.players?.find((player) => player.id === sieger.player.id)?.name || "?") : null;
      banner.textContent = sieger
        ? `🏆 ${name} — ${(sieger.entry.deviationMs / 1000).toFixed(2).replace(".", ",")} s daneben`
        : "Auflösung …";
      banner.style.background = "#ffc400";
      banner.style.color = "#5c4508";
    } else if (stopped) {
      banner.hidden = false;
      banner.textContent = "Gestoppt ✓";
      banner.style.background = "#12aaff";
      banner.style.color = "#ffffff";
    } else if (hidden) {
      banner.hidden = false;
      banner.textContent = "Zähl im Kopf weiter!";
      banner.style.background = "#ff2e6a";
      banner.style.color = "#ffffff";
    } else {
      banner.hidden = true;
    }

    if (this.stopButton) this.stopButton.disabled = stopped || revealAll;
  }
}
