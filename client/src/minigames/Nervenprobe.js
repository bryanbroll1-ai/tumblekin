import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Nervenprobe: die Uhr läuft sichtbar an, dann verschwindet sie — man zählt im
// Kopf weiter und drückt, wenn man glaubt, das Ziel sei erreicht.
//
// Vorher standen die Figuren hinter ihren Pulten, und die Zeitanzeige hing
// genau vor ihren Köpfen. Jetzt steht jeder vor seinem Pult mit Buzzer, die
// Anzeige hängt darüber, man nickt beim Zählen im Sekundentakt, haut auf den
// Knopf und schaut dann gebannt auf die eigene Anzeige, bis aufgelöst wird.
const PODIUM_GAP = 1.12;
const STAGE_Y = 0.26;
const KIN_Z = 0.95;

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

// A blocky game-show clock driven by a canvas texture: dark glass screen,
// glowing digits, rounded accent bezel.
function createTimerDisplay() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const dark = new THREE.MeshLambertMaterial({ color: "#1a2230" });
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 0.6, 0.12),
    [dark, dark, dark, dark, new THREE.MeshBasicMaterial({ map: texture }), dark]
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

function paintDisplay(panel, text, accent = "#7df0a0") {
  const { ctx, canvas, texture, lastText, lastAccent } = panel.userData;
  if (lastText === text && lastAccent === accent) return;
  panel.userData.lastText = text;
  panel.userData.lastAccent = accent;
  // Screen glass with a soft top sheen.
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, "#182031");
  bg.addColorStop(0.45, "#0b1220");
  bg.addColorStop(1, "#060a12");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(0, 0, canvas.width, 34);
  // Accent bezel with glow.
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 7;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 14;
  roundedRect(ctx, 8, 8, canvas.width - 16, canvas.height - 16, 18);
  ctx.stroke();
  ctx.restore();
  // Corner rivets for the blocky look.
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  [[20, 20], [canvas.width - 20, 20], [20, canvas.height - 20], [canvas.width - 20, canvas.height - 20]].forEach(([x, y]) => {
    ctx.fillRect(x - 3, y - 3, 6, 6);
  });
  // Glowing digits.
  ctx.save();
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 16;
  ctx.font = "bold 58px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  ctx.restore();
  texture.needsUpdate = true;
}

export class Nervenprobe extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stations = new Map();
    this.lastStopped = new Map();
    this.revealed = false;
    this.hidAt = false;
    this.labelY = 0.74;
    this.nextNod = new Map();
  }

  stage() {
    return {
      label: "3D Nervenprobe",
      background: "#170e28",
      fog: ["#241539", 22, 50],
      lights: { sunPosition: [-4, 10, 7], skyColor: 0xb49ae8, groundColor: 0x6a4a3a, sunColor: 0xfff0d2, fillColor: 0xff9ecb, fillIntensity: 0.7 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-nerve-clock>0.00s</span><strong data-nerve-target></strong></div>
      <div class="color-banner" data-nerve-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.5, 34),
      new THREE.MeshLambertMaterial({ color: "#e8a94f" })
    );
    floor.position.set(0, -0.25, 8);
    floor.receiveShadow = true;
    scene.add(floor);
    const stage = new THREE.Mesh(
      new THREE.BoxGeometry(9.6, 0.4, 4.8),
      new THREE.MeshLambertMaterial({ color: "#b8478a" })
    );
    stage.position.set(0, 0.06, -0.4);
    stage.receiveShadow = true;
    scene.add(stage);
    const carpet = new THREE.Mesh(
      new THREE.BoxGeometry(7.8, 0.06, 1.15),
      new THREE.MeshLambertMaterial({ color: "#e0334f" })
    );
    carpet.position.set(0, 0.3, 1.55);
    carpet.receiveShadow = true;
    scene.add(carpet);

    // Die Vorbühne. Der goldene Boden reicht jetzt bis unter die Kamera und
    // füllte damit das untere Bilddrittel mit einer einzigen hellen Fläche —
    // schlimmer als das Loch, das er stopfen sollte. Vor der Bühne liegt
    // deshalb dunkler Studioboden, und das Gold bleibt der Bühne.
    const vorbuehne = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.12, 22),
      new THREE.MeshLambertMaterial({ color: "#2e2242" })
    );
    vorbuehne.position.set(0, 0.02, 14);
    vorbuehne.receiveShadow = true;
    scene.add(vorbuehne);
    // Zwei warme Lichtpfützen darauf, damit die Fläche nicht tot ist.
    [[-3.4, 6.4], [3.4, 8.2]].forEach(([x, z]) => {
      const pfuetze = new THREE.Mesh(
        new THREE.CircleGeometry(2.6, 20),
        new THREE.MeshBasicMaterial({ color: "#ffb35c", transparent: true, opacity: 0.12, depthWrite: false })
      );
      pfuetze.rotation.x = -Math.PI / 2;
      pfuetze.position.set(x, 0.1, z);
      scene.add(pfuetze);
    });
    // Publikumsränder im Vordergrund: dunkle Köpfe am unteren Bildrand. Im
    // Hochformat ist das Sichtfeld dicht vor der Kamera nur gut einen Meter
    // breit — mehr als drei, vier Köpfe passen dort ohnehin nicht ins Bild.
    // Als Instanzen: 28 Einzelmeshes wären 28 Zeichenaufrufe für eine
    // Silhouette, die sich nie bewegt.
    for (let i = 0; i < 12; i += 1) {
      const pleat = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 4.6, 0.4 + (i % 2) * 0.18),
        new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? "#7a4ddb" : "#6a3fc4" })
      );
      pleat.position.set((i - 5.5) * 0.95, 2.1, -3.6);
      scene.add(pleat);
    }
    const valance = new THREE.Mesh(
      new THREE.BoxGeometry(11.6, 0.55, 0.7),
      new THREE.MeshLambertMaterial({ color: "#ffb400" })
    );
    valance.position.set(0, 4.55, -3.5);
    scene.add(valance);

    [[-4.9, "#ffc400"], [4.9, "#ffc400"]].forEach(([x, color]) => {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 4.6, 0.6),
        new THREE.MeshLambertMaterial({ color })
      );
      pillar.position.set(x, 2.05, -3.1);
      scene.add(pillar);
      const knob = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.35, 0.8),
        new THREE.MeshLambertMaterial({ color: "#ff5c8a" })
      );
      knob.position.set(x, 4.5, -3.1);
      scene.add(knob);
    });

    // Bunting: candy flags strung between the pillars.
    const flagColors = ["#ff2e6a", "#12aaff", "#ffc400", "#33cf4d", "#ff8b2e"];
    for (let i = 0; i < 11; i += 1) {
      const t = i / 10;
      const sag = Math.sin(t * Math.PI) * 0.55;
      const flag = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.3, 0.06),
        new THREE.MeshLambertMaterial({ color: flagColors[i % flagColors.length] })
      );
      flag.position.set(-4.9 + t * 9.8, 4.32 - sag, -2.95);
      flag.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.12;
      scene.add(flag);
    }

    // Two soft spotlight cones sweeping over the stage.
    this.spotCones = [];
    [[-2.6, "#fff3c4"], [2.6, "#ffe1f0"]].forEach(([x, color], index) => {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, 5.2, 8, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
      );
      cone.position.set(x, 3.2, -1);
      cone.rotation.x = 0.3;
      cone.userData = { phase: index * Math.PI };
      scene.add(cone);
      this.spotCones.push(cone);
    });

    // Gold star sparkles on the curtain.
    this.stars = [];
    [[-3.4, 3.3], [-1.2, 2.6], [1.6, 3.5], [3.6, 2.8], [0.2, 1.7], [-2.4, 1.4], [2.6, 1.6]].forEach(([x, y], index) => {
      const star = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.1),
        new THREE.MeshLambertMaterial({ color: "#ffd76a", emissive: "#ffd76a", emissiveIntensity: 0.6 })
      );
      star.position.set(x, y, -3.28);
      star.rotation.z = Math.PI / 4;
      star.userData = { phase: index * 0.9 };
      scene.add(star);
      this.stars.push(star);
    });

    // Traverse mit Scheinwerfern über der Bühne — das, was in einem Studio
    // über dem Vorhang hängt. Hier standen vorher zwei Wolken.
    const traverse = new THREE.Mesh(
      new THREE.BoxGeometry(13, 0.28, 0.28),
      new THREE.MeshLambertMaterial({ color: "#3d4658" })
    );
    traverse.position.set(0, 6.4, -2.6);
    scene.add(traverse);
    for (let i = 0; i < 5; i += 1) {
      const x = (i - 2) * 2.4;
      const buegel = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.5, 0.1),
        new THREE.MeshLambertMaterial({ color: "#3d4658" })
      );
      buegel.position.set(x, 6.05, -2.6);
      scene.add(buegel);
      const lampe = new THREE.Mesh(
        new THREE.BoxGeometry(0.44, 0.44, 0.6),
        new THREE.MeshLambertMaterial({ color: "#2b3242" })
      );
      lampe.position.set(x, 5.68, -2.6);
      lampe.rotation.x = 0.45;
      scene.add(lampe);
      const linse = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.34, 0.06),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? "#fff0b8" : "#ffc9e4" })
      );
      linse.position.set(x, 5.55, -2.35);
      linse.rotation.x = 0.45;
      scene.add(linse);
    }

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.addStation(player, index, players.length));
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * PODIUM_GAP;
  }

  addStation(player, index, count) {
    const x = this.stationX(index, count);
    this.addKin(player, index, { x, ground: STAGE_Y, z: KIN_Z, facing: 0 });
    // Schmales Pult rechts neben der Figur, der Buzzer auf Handhöhe — davor
    // stehend verdeckte es die halbe Figur.
    const px = x + 0.36;
    const podium = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), new THREE.MeshLambertMaterial({ color: "#fdf5e6" }));
    podium.position.set(px, STAGE_Y + 0.21, KIN_Z + 0.12);
    podium.castShadow = true;
    this.scene.add(podium);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.32), new THREE.MeshLambertMaterial({ color: player.color }));
    trim.position.set(px, STAGE_Y + 0.4, KIN_Z + 0.12);
    this.scene.add(trim);
    const buzzer = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.09, 14), new THREE.MeshLambertMaterial({ color: "#ff2038", emissive: "#ff2038", emissiveIntensity: 0.25 }));
    buzzer.position.set(px, STAGE_Y + 0.49, KIN_Z + 0.12);
    this.scene.add(buzzer);
    // Anzeige über und hinter der Figur, mit Lampe und Namen.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.58, 0.1), new THREE.MeshLambertMaterial({ color: player.color }));
    frame.position.set(x, 1.75, 0.05);
    this.scene.add(frame);
    const display = createTimerDisplay();
    display.scale.setScalar(0.82);
    display.position.set(x, 1.75, 0.11);
    this.scene.add(display);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), new THREE.MeshLambertMaterial({ color: "#c0c9d4" }));
    post.position.set(x, 0.8, -0.02);
    this.scene.add(post);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), new THREE.MeshLambertMaterial({ color: "#2ee86a", emissive: new THREE.Color("#2ee86a"), emissiveIntensity: 0.8 }));
    bulb.position.set(x + 0.45, 2.12, 0.08);
    this.scene.add(bulb);
    this.stations.set(player.id, { x, buzzer, display, bulb });
  }

  shot() {
    const count = Math.max(1, this.stations.size);
    return {
      look: [0.15, 1.1, 0.8],
      frame: { w: count * PODIUM_GAP + 0.5, h: 2.4 },
      pitch: 0.14,
      fov: 36,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.4 },
      finale: { pull: 0.6, zoom: 0.7, lift: 0.6, orbit: 0.12 }
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
    if (!own || own.stoppedMs !== null) return;
    this.feedback?.sound("pop");
    this.feedback?.vibrate([14, 10, 22]);
    this.rig.shake(0.4);
    this.animators.get(id)?.trigger("punch");
    this.sendInput({ action: "stop" }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const hidden = elapsed >= arcade.hideAfterMs;
    const revealAll = Boolean(minigame.finaleAt);
    if (hidden && !this.hidAt) {
      this.hidAt = true;
      this.feedback?.sound("move");
    }
    if (revealAll && !this.revealed) {
      this.revealed = true;
      this.feedback?.sound("win");
      this.feedback?.vibrate([30, 30, 60]);
    }

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const station = this.stations.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !station || !kin || !animator) return;
      const stopped = entry.stoppedMs !== null && entry.stoppedMs !== undefined;
      if (revealAll) {
        const deviation = entry.deviationMs ?? null;
        paintDisplay(station.display, stopped ? formatSeconds(entry.stoppedMs) : "—", deviation !== null && deviation < 400 ? "#7df0a0" : "#ffd166");
      } else if (stopped) {
        paintDisplay(station.display, "STOP", "#8fd4ff");
      } else if (!hidden) {
        paintDisplay(station.display, formatSeconds(elapsed), "#7df0a0");
      } else {
        paintDisplay(station.display, "? ? ?", Math.floor(now / 400) % 2 === 0 ? "#ff5c8a" : "#c86a92");
      }
      station.buzzer.position.y += ((stopped ? STAGE_Y + 0.45 : STAGE_Y + 0.49) - station.buzzer.position.y) * frameLerp(0.25, dt);
      station.buzzer.material.emissiveIntensity = stopped ? 1 : 0.25;
      const bulbColor = revealAll ? "#ffd76a" : stopped ? "#12aaff" : hidden ? "#ff2038" : "#2ee86a";
      station.bulb.material.color.set(bulbColor);
      station.bulb.material.emissive.set(bulbColor);
      station.bulb.material.emissiveIntensity = hidden && !stopped && !revealAll ? (Math.floor(now / 320) % 2 === 0 ? 1.1 : 0.15) : 0.8;

      if (stopped && !this.lastStopped.get(player.id)) {
        this.lastStopped.set(player.id, true);
        if (player.id !== controlledId) {
          animator.trigger("punch");
          this.feedback?.sound("move");
        }
        this.burst(station.buzzer.position.clone().setY(STAGE_Y + 0.6), ["#ff2038", "#ffffff"], { count: 9, speed: 1.9, up: 1.6, size: 0.07, life: 0.5, drag: 2, fadePow: 1.4 });
        this.pop(new THREE.Vector3(station.x, 1.4, KIN_Z + 0.4), "STOPP!", { color: "#ffffff", size: 0.3, life: 0.7, rise: 0.6 });
      }
      if (revealAll) {
        if (!stopped) animator.set("shrug");
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

    this.spotCones?.forEach((cone) => {
      cone.rotation.z = Math.sin(now / 1600 + cone.userData.phase) * 0.35;
      cone.material.opacity = 0.1 + Math.abs(Math.sin(now / 900 + cone.userData.phase)) * 0.08;
    });
    this.stars?.forEach((star) => {
      star.material.emissiveIntensity = 0.35 + Math.abs(Math.sin(now / 500 + star.userData.phase)) * 0.65;
    });
  }

  drawHud(f) {
    const { arcade, minigame, now } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const hidden = elapsed >= arcade.hideAfterMs;
    const revealAll = Boolean(minigame.finaleAt);
    // Die Rundenuhr oben links zählt hier NICHT mit — sie verriete die Zeit,
    // die man schätzen soll. Sie zeigt dasselbe wie die Anzeigen: bis zum
    // Verstecken die Stoppuhr, danach nichts.
    this.clockNode ||= this.hud.querySelector("[data-nerve-clock]");
    this.clockNode.textContent = revealAll || !hidden ? `${(Math.min(elapsed, arcade.hideAfterMs) / 1000).toFixed(2)}s` : "?.??s";
    this.targetNode ||= this.hud.querySelector("[data-nerve-target]");
    this.targetNode.textContent = `Ziel: ${(arcade.targetMs / 1000).toFixed(1)}s`;
    const banner = this.hud.querySelector("[data-nerve-banner]");
    const own = arcade.players[this.getControlledPlayerId()];
    const stopped = own?.stoppedMs !== null && own?.stoppedMs !== undefined;
    if (revealAll) {
      banner.hidden = false;
      banner.textContent = "Auflösung!";
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
