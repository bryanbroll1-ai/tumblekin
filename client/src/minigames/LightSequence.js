import * as THREE from "/vendor/three/three.module.js";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer, himmel } from "./Kulisse.js?v=tumblekin200";

// Leuchtfolge: die Pilze leuchten in einer Folge auf, danach tippt man sie in
// derselben Reihenfolge nach. Jede Runde wird die Folge länger.
//
// Vorher stand nur die eigene Figur vor den Pilzen. Jetzt stehen alle hinter
// dem Pilzkreis wie ein kleiner Chor: sie schauen gebannt auf den Pilz, der
// gerade leuchtet, hüpfen bei jedem richtigen Tipp, fassen sich bei einem
// Fehler an den Kopf und jubeln, wenn die Folge geschafft ist.
const COLOURS = ["#ff5d73", "#3fc5e8", "#ffd15c", "#71d97b"];
const COLOURS_DARK = ["#c9455a", "#2e93b0", "#cca43f", "#4fa85c"];
const SPOTS = [
  { x: -1.15, z: -0.35 },
  { x: 1.15, z: -0.35 },
  { x: -1.15, z: 1.35 },
  { x: 1.15, z: 1.35 }
];
const CHOIR_Z = -1.75;

export class LightSequence extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pads = [];
    this.hitTargets = [];
    this.shownStep = -1;
    this.shownRound = -1;
    this.watch = new Map();
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Leuchtfolge",
      background: "#6a5ab0",
      fog: ["#8a6ab0", 20, 50],
      lights: { sunPosition: [-4, 12, 8], sunColor: 0xffd8e8, sunIntensity: 2.2, hemiIntensity: 1.8, skyColor: 0xd8c8ff, groundColor: 0x3a5a3a, shadow: { left: -5, right: 5, top: 8, bottom: -3 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-simon-round>Runde 1</div>
      <div class="simon-chips" data-simon-chips></div>
      <div class="color-banner simon-banner" data-simon-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const glade = new THREE.Mesh(
      new THREE.BoxGeometry(44, 0.5, 44),
      new THREE.MeshLambertMaterial({ color: "#5c9c4a" })
    );
    glade.position.set(0, -0.25, -4);
    glade.receiveShadow = true;
    scene.add(glade);

    // Pilzlichtung: bis hierher war das eine nackte grüne Platte mit vier
    // Pilzen darauf und einer harten Kante gegen den Himmel. Eigene Palette,
    // eigene Baumform — die Wiese soll nicht die von acht anderen Spielen sein.
    dressMeadow(this.scene, {
      seed: 23,
      // Enger freigehalten als üblich: die Kamera steht dicht, der sichtbare
      // Boden liegt fast ganz innerhalb der Sperrzone — bei 4.2/4.6 war rund
      // um die Pilze wieder blankes Grün.
      keepOut: { x: 2.6, z: 2.8 },
      spread: { x: 15, z: 14 },
      patches: 30,
      patchColors: ["#4f8f40", "#6bb055"],
      tufts: 200,
      flowers: 34,
      stones: 26,
      trees: 40,
      // Der Baumkranz ist auf DIESE Kamera gerechnet: sie steht bei z = 5.6
      // und sieht nur einen kleinen Fleck Boden. Bei frontCut 5.5 landete ein
      // Baum zehn Zentimeter vor der Linse und füllte ein Bildviertel; bei
      // treeRing 23 standen sie so weit hinten, dass nur noch einer im Bild
      // war. 13/12 mit frontCut 0 legt sie als Saum an den Horizont.
      treeRing: { x: 13, z: 12 },
      frontCut: 0,
      grassColor: "#528f42",
      flowerColors: ["#ff6f61", "#ffe27a", "#ffffff", "#e08cff"],
      trunkColor: "#6b4a2c",
      crownColor: "#2f6f3a",
      crownColor2: "#3f8a44",
      crownShape: "blob"
    });

    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 0.06, 28),
      new THREE.MeshLambertMaterial({ color: "#5f9c47" })
    );
    ring.position.set(0, 0.03, 0.5);
    ring.receiveShadow = true;
    scene.add(ring);

    SPOTS.forEach((spot, index) => this.buildPad(spot, index));

    this.buildEnchanted(scene);

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * 1.0;
      this.addKin(player, index, { x, ground: 0, z: CHOIR_Z - Math.abs(x) * 0.25, facing: 0 });
      this.watch.set(player.id, { progress: 0, failed: false, round: -1 });
    });
  }

  // Die Lichtung liegt in einem Zauberwald in der Dämmerung: kleine
  // Leuchtpilze im Kreis um die Spielpilze, Farnwedel, ein Baumstumpf mit
  // Tür und erleuchtetem Fenster, eine Lichterkette zwischen den Bäumen und
  // Glühwürmchen, die über allem schweben.
  buildEnchanted(scene) {
    himmel(scene, { oben: "#4a3f8f", unten: "#f2a6c4" });
    const zufall = streuer(71);
    // Leuchtpilze im Kreis.
    const huete = [[], [], []];
    const stiele = [];
    for (let i = 0; i < 30; i += 1) {
      const a = (i / 30) * Math.PI * 2 + zufall() * 0.15;
      const r = 3.55 + zufall() * 0.5;
      const x = Math.cos(a) * r;
      const z = 0.5 + Math.sin(a) * r;
      const h = 0.12 + zufall() * 0.14;
      stiele.push({ p: [x, h / 2, z], s: [1, h / 0.2, 1] });
      huete[i % 3].push({ p: [x, h, z], s: 0.7 + zufall() * 0.6 });
    }
    viele(scene, new THREE.CylinderGeometry(0.03, 0.04, 0.2, 6), lambert("#efe6d6"), stiele);
    ["#7fffe0", "#c9a0ff", "#ffe07f"].forEach((farbe, i) => viele(scene, new THREE.SphereGeometry(0.1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: farbe }), huete[i]));
    // Farne.
    const farn = [];
    for (let i = 0; i < 18; i += 1) {
      const a = zufall() * Math.PI * 2;
      const r = 4.4 + zufall() * 2;
      const x = Math.cos(a) * r;
      const z = 0.5 + Math.sin(a) * r;
      if (z > 3) continue;
      for (let k = 0; k < 5; k += 1) farn.push({ p: [x, 0.05, z], r: [-0.6, (k / 5) * Math.PI * 2 + a, 0], s: [0.12, 1, 0.45] });
    }
    const wedel = new THREE.BoxGeometry(1, 0.03, 1);
    wedel.translate(0, 0, 0.5);
    viele(scene, wedel, lambert("#3f8f45"), farn);
    // Baumstumpf-Haus hinten links.
    const stumpf = new THREE.Group();
    const koerper = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.8, 12), lambert("#7a5330"));
    koerper.position.y = 0.9;
    koerper.castShadow = true;
    stumpf.add(koerper);
    const dach = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.1, 12), lambert("#c8413b"));
    dach.position.y = 2.3;
    stumpf.add(dach);
    viele(stumpf, new THREE.SphereGeometry(0.1, 8, 6), lambert("#ffffff"), [[0.5, 2.1, 0.6], [-0.4, 2.3, 0.5], [0.1, 2.6, 0.4], [-0.6, 2.0, -0.1]].map((p) => ({ p })));
    const tuer = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16, 0, Math.PI), lambert("#4a3020"));
    tuer.position.set(0, 0.4, 1.0);
    stumpf.add(tuer);
    kiste(stumpf, 0.64, 0.4, 0.02, "#4a3020", [0, 0.2, 1.0], { schatten: false });
    const fenster = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), new THREE.MeshBasicMaterial({ color: "#ffd98a" }));
    fenster.position.set(0.45, 1.2, 0.86);
    fenster.rotation.y = 0.4;
    stumpf.add(fenster);
    stumpf.position.set(-3.6, 0, -3.6);
    stumpf.rotation.y = 0.5;
    scene.add(stumpf);
    // Lichterkette zwischen zwei Stangen hinten.
    const a = new THREE.Vector3(-3.2, 2.4, -4.4);
    const b = new THREE.Vector3(3.6, 2.2, -4.0);
    [a, b].forEach((p) => kiste(scene, 0.08, p.y, 0.08, "#6b4a2e", [p.x, p.y / 2, p.z]));
    const lichter = [];
    const kurve = [];
    for (let i = 0; i <= 20; i += 1) {
      const t = i / 20;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * 0.5;
      kurve.push(p);
      if (i % 2 === 1) lichter.push({ p: [p.x, p.y - 0.08, p.z] });
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(kurve), new THREE.LineBasicMaterial({ color: "#3b2a20" })));
    this.fairyLights = viele(scene, new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: "#ffffff" }), lichter);
    this.fairyCount = lichter.length;
    this.fairyColor = new THREE.Color();
    // Glühwürmchen.
    const n = 60;
    const pos = new Float32Array(n * 3);
    this.fireflySeeds = [];
    for (let i = 0; i < n; i += 1) {
      this.fireflySeeds.push({ x: (zufall() - 0.5) * 12, y: 0.4 + zufall() * 2.4, z: -5 + zufall() * 8, p: zufall() * 6 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.fireflies = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#fff27a", size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }));
    this.fireflies.userData.isFx = true;
    this.fireflies.frustumCulled = false;
    scene.add(this.fireflies);
  }

  buildPad(spot, index) {
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    this.scene.add(group);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 0.5, 10),
      new THREE.MeshLambertMaterial({ color: "#f2ece0" })
    );
    stem.position.y = 0.25;
    stem.castShadow = true;
    group.add(stem);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.58, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: COLOURS_DARK[index] })
    );
    cap.position.y = 0.5;
    cap.scale.y = 0.72;
    cap.castShadow = true;
    group.add(cap);

    // Weisse Tupfen auf dem Hut — sie zeigen die Drehung und machen aus der
    // Halbkugel einen Pilz statt einer Schüssel.
    for (let i = 0; i < 4; i += 1) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshLambertMaterial({ color: "#fff4dc" })
      );
      const angle = (i / 4) * Math.PI * 2;
      dot.position.set(Math.cos(angle) * 0.34, 0.68, Math.sin(angle) * 0.34);
      group.add(dot);
    }

    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.86, 22),
      new THREE.MeshBasicMaterial({ color: COLOURS[index], transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    group.add(glow);


    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(spot.x, 0.5, spot.z);
    hit.userData.padIndex = index;
    this.scene.add(hit);
    this.hitTargets.push(hit);

    this.pads.push({
      index, group, cap, glow,
      base: new THREE.Color(COLOURS_DARK[index]),
      lit: new THREE.Color(COLOURS[index]),
      light: 0,
      press: 0,
      bob: Math.random() * 6.28
    });
  }

  shot() {
    return {
      look: [0, 0.45, 0.05],
      frame: { w: 4.3, h: 3.9 },
      pitch: 0.7,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Erst zuschauen, dann in derselben Reihenfolge tippen</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      this.tapAt(event);
    });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.pads.length = 0;
    this.hitTargets.length = 0;
  }

  tapAt(event) {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || !this.camera) return;
    // Während die Folge gezeigt wird, ist Tippen wirkungslos — der Server sagt
    // dasselbe, aber ohne Rückmeldung hier fühlt es sich wie ein Aussetzer an.
    if (!this.acceptingInput()) {
      this.feedback?.sound("clack");
      return;
    }
    const rect = this.webglCanvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitTargets, false);
    if (hits.length === 0) return;
    const index = hits[0].object.userData.padIndex;
    this.pads[index].press = 1;
    this.feedback?.sound("tap");
    this.sendInput({ action: "color", index }).catch(() => {});
  }

  activeRound() {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!arcade?.rounds) return null;
    const elapsed = Math.max(0, this.now() - minigame.startedAt);
    for (const round of arcade.rounds) {
      if (elapsed >= round.showFrom && elapsed <= round.until) return { round, elapsed };
      if (round.showFrom > elapsed) break;
    }
    return null;
  }

  acceptingInput() {
    const active = this.activeRound();
    return Boolean(active && active.elapsed >= active.round.inputFrom);
  }

  playSequence(active, now) {
    if (!active) { this.shownStep = -1; return; }
    const { round, elapsed } = active;
    if (elapsed >= round.inputFrom) { this.shownStep = -1; return; }

    const perStep = (round.inputFrom - round.showFrom) / (round.sequence.length + 1);
    const step = Math.floor((elapsed - round.showFrom) / perStep);
    if (step < 0 || step >= round.sequence.length) { this.shownStep = -1; return; }
    // Innerhalb eines Schritts leuchtet der Pilz nur die erste Hälfte — sonst
    // liefen zwei gleiche Farben hintereinander zu einem langen Leuchten
    // zusammen und man zählte sie als eine.
    const withinStep = (elapsed - round.showFrom) - step * perStep;
    if (withinStep > perStep * 0.62) { this.shownStep = -1; return; }

    const pad = round.sequence[step];
    if (step !== this.shownStep || round.index !== this.shownRound) {
      this.shownStep = step;
      this.shownRound = round.index;
      this.pads[pad].light = 1;
      this.feedback?.sound("plink");
    }
  }

  syncPads(dt, now) {
    this.pads.forEach((pad) => {
      pad.light = Math.max(0, pad.light - dt * 3.4);
      pad.press = Math.max(0, pad.press - dt * 4.5);
      const heat = Math.max(pad.light, pad.press);
      pad.cap.material.color.copy(pad.base).lerp(pad.lit, heat);
      pad.cap.scale.setScalar(1 + heat * 0.22);
      pad.glow.material.opacity = heat * 0.85;
      pad.glow.scale.setScalar(1 + heat * 0.35);
      pad.bob += dt * 1.6;
      pad.group.position.y = Math.sin(pad.bob) * 0.03 + heat * 0.12;
    });
  }

  tick(f) {
    const zeit = f.now / 1000;
    if (this.fireflies) {
      const p = this.fireflies.geometry.attributes.position;
      this.fireflySeeds.forEach((ff, i) => {
        p.setXYZ(i, ff.x + Math.sin(zeit * 0.6 + ff.p) * 0.6, ff.y + Math.sin(zeit * 1.3 + ff.p * 2) * 0.25, ff.z + Math.cos(zeit * 0.5 + ff.p) * 0.6);
      });
      p.needsUpdate = true;
      this.fireflies.material.opacity = 0.6 + Math.sin(zeit * 3) * 0.3;
    }
    if (this.fairyLights) {
      const farben = ["#ff8fb1", "#ffe27a", "#7fffe0", "#c9a0ff"];
      for (let i = 0; i < this.fairyCount; i += 1) this.fairyLights.setColorAt(i, this.fairyColor.set(farben[(i + Math.floor(zeit * 2)) % farben.length]));
      this.fairyLights.instanceColor.needsUpdate = true;
    }
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    const active = this.activeRound();
    this.playSequence(active, now);
    this.syncPads(dt, now);
    const watching = active && active.elapsed < active.round.inputFrom;
    // Der Pilz, der gerade leuchtet — dorthin schauen alle.
    const lit = this.pads.reduce((best, pad) => (pad.light > (best?.light || 0.05) ? pad : best), null);

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const w = this.watch.get(player.id);
      if (!entry || !kin || !animator || !w) return;
      const isOwn = player.id === controlledId;
      const inRound = active && entry.currentRound === active.round.index;
      const progress = inRound ? entry.roundProgress || 0 : 0;
      if (inRound && progress > w.progress) {
        animator.trigger("hop", { height: 0.16 });
        animator.trigger("tap");
        if (isOwn) this.feedback?.vibrate(8);
        if (progress >= active.round.sequence.length) {
          animator.trigger("fistpump");
          animator.expression("joy", 900);
          const at = kin.position.clone().add(new THREE.Vector3(0, 1.1, 0));
          this.burst(at, ["#ffe36b", "#ffffff", player.color], { count: 12 * fxScale(), speed: 2.0, up: 1.6, size: 0.07, life: 0.6, drag: 1.8 });
          if (isOwn) {
            this.pop(new THREE.Vector3(0, 1.6, 0.4), "FOLGE GESCHAFFT!", { color: "#ffe36b", size: 0.4, life: 0.9 });
            this.feedback?.sound("perfect");
          }
        }
      }
      const failed = Boolean(inRound && entry.roundFailed);
      if (failed && !w.failed) {
        animator.trigger("facepalm");
        animator.expression("sad", 1400);
        if (isOwn) {
          this.pop(new THREE.Vector3(0, 1.6, 0.4), "FALSCH!", { color: "#ff9aa8", size: 0.38, life: 0.9 });
          this.feedback?.sound("error");
          this.feedback?.vibrate(24);
          this.rig.shake(0.45);
        }
      }
      w.failed = failed;
      w.progress = progress;
      if (finale) return;
      animator.lookAt(lit ? lit.group.position.clone().setY(0.6) : null);
      if (failed) animator.set("sad");
      else if (watching) animator.set("focus");
      else if (inRound && progress >= (active?.round.sequence.length || 99)) animator.set("happy");
      else animator.set("think");
    });
  }

  keepInView(f) {
    return f.players.map((player) => this.kins.get(player.id)).filter(Boolean).concat(this.pads.map((pad) => pad.group));
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const active = this.activeRound();
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.survived || 0);
    const roundLabel = this.hud.querySelector("[data-simon-round]");
    if (roundLabel) {
      const total = arcade.rounds?.length || 0;
      roundLabel.textContent = active ? `Runde ${active.round.index + 1}/${total} · ${active.round.sequence.length} Farben` : "Gleich geht's los";
    }

    const chips = this.hud.querySelector("[data-simon-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="simon-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${entry?.survived || 0}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-simon-banner]");
    if (!banner) return;
    if (!active) {
      banner.hidden = true;
      return;
    }
    const watching = active.elapsed < active.round.inputFrom;
    if (own?.roundFailed && own.currentRound === active.round.index) {
      banner.hidden = false;
      banner.textContent = "Daneben — warte auf die nächste Folge";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (watching) {
      banner.hidden = false;
      banner.textContent = "MERKEN …";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
    } else {
      banner.hidden = false;
      const done = own?.currentRound === active.round.index ? (own.roundProgress || 0) : 0;
      banner.textContent = `Nachtippen: ${done}/${active.round.sequence.length}`;
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
    }
  }
}
