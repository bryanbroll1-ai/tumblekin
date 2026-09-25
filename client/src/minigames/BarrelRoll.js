import * as THREE from "/vendor/three/three.module.js";
import { createCloud, KIN_SOLE, setKinOpacity } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";

// Fassrolle — alle stehen auf einem Riesenfass über dem Fluss. Die Strömung
// dreht es mal so, mal so; mit ◀ oder ▶ läuft man dagegen an. Aber wer läuft,
// stösst das Fass mit den Füssen in die Gegenrichtung — und damit alle
// anderen. So rollt man sie ins Wasser, muss dann aber selbst mithalten.
// Gezählt wird die Zeit im grünen Streifen oben, wer abrutscht, platscht rein.
//
// Wer nicht läuft, balanciert mit ausgebreiteten Armen — je näher an der
// Kante, desto wackliger und ängstlicher. Laufen passt sich dem Tempo an.
//
// Wellen rollen von der Seite heran und stossen das Fass an. Man sieht sie
// kommen, ein Pfeil sagt, wohin man laufen muss. In den letzten zwölf
// Sekunden kommt das Wildwasser: angesagt mit Countdown, schnelleres Fass,
// dichtere Wellen — und wer jetzt fällt, ist raus und treibt im Schwimmring.
const BARREL_R = 2.1;
const BARREL_CENTER_Y = 1.1;
const RUN_PING_MS = 90;
const WATER_Y = -1.15;
const CLIMB_MS = 600;           // Sprung aus dem Wasser zurück auf den Stamm
const TOP_Y = BARREL_CENTER_Y + BARREL_R;
// Hier taucht eine Welle auf: am Bildrand, damit man sie die ganze Warnzeit
// über anrollen sieht. Sie läuft an der HINTEREN Hälfte des Fasses an — die
// Kamera schaut von vorn oben, und dort liegt das Wasser offen im Bild. Auf
// Höhe der Fassmitte verschwand sie hinter dem Deckel und war nur ein Strich.
const WAVE_START_X = 4.6;
const WAVE_Z = -1.5;
const WAVE_AFTER_MS = 700;      // so lange bricht sie nach dem Aufprall noch
const WATER_CALM = new THREE.Color("#1f8fd6");
const WATER_WILD = new THREE.Color("#155f9e");

export class BarrelRoll extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.smoothOffset = new Map();
    this.fell = new Map();
    this.climb = new Map();
    this.lastServerAt = performance.now();
    this.holdDir = 0;
    this.holdTimer = null;
    this.localAngle = 0;
    this.waveMeshes = new Map();
    this.wavesHit = new Set();
    this.wavesWarned = new Set();
    this.rings = new Map();
    this.wildShown = false;
    this.countShown = null;
  }

  stage() {
    return {
      label: "3D Fassrolle",
      background: "#8fd8f2",
      fog: ["#9fdef5", 24, 60],
      lights: { sunPosition: [-5, 11, 7], hemiIntensity: 2.4, sunIntensity: 2.9, skyColor: 0xe6f6ff, groundColor: 0x5aa8c8 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0s</strong></div>
      <div class="simon-round barrel-spin" data-barrel-spin></div>
      <div class="barrel-wave" data-barrel-wave hidden></div>
      <div class="color-banner" data-barrel-banner hidden></div>`;
  }

  build() {
    const water = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 30), new THREE.MeshLambertMaterial({ color: "#1f8fd6" }));
    water.position.y = WATER_Y - 0.25;
    water.receiveShadow = true;
    this.scene.add(water);
    this.waterMesh = water;
    // Hellere Strömungsstreifen auf dem Wasser.
    this.ripples = [];
    for (let i = 0; i < 9; i += 1) {
      const ripple = new THREE.Mesh(new THREE.BoxGeometry(1.6 + (i % 3), 0.02, 0.12), new THREE.MeshBasicMaterial({ color: "#8fd3ff", transparent: true, opacity: 0.5 }));
      ripple.position.set(-9 + i * 2.3, WATER_Y + 0.01, -6 + (i % 4) * 3.4);
      this.scene.add(ripple);
      this.ripples.push(ripple);
    }
    [-13, 13].forEach((x) => {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 90), new THREE.MeshLambertMaterial({ color: "#7fce6f" }));
      bank.position.set(x, WATER_Y + 0.3, 0);
      bank.receiveShadow = true;
      this.scene.add(bank);
    });
    dressMeadow(this.scene, {
      seed: 21, groundY: WATER_Y + 1.1, keepOut: { x: 6.4, z: 0 }, spread: { x: 19, z: 26 },
      treeRing: { x: 15, z: 22 }, frontCut: 7, trees: 26, patches: 22, tufts: 150, stones: 14,
      grassColor: "#67b95f", patchColors: ["#75c46b", "#8bd47f"], crownColor: "#4f9b4a", crownColor2: "#6cb45e", crownShape: "blob"
    });

    // Das Riesenfass mit Dauben, Deckeln und Ringen — die Streifen machen die
    // Drehung sichtbar.
    this.barrel = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: "#b07a3e" });
    const stripeMat = new THREE.MeshLambertMaterial({ color: "#8a5a2c" });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R, BARREL_R, 3.4, 16), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.barrel.add(body);
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2;
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 3.46), i % 2 === 0 ? stripeMat : bodyMat);
      plank.position.set(Math.sin(angle) * (BARREL_R + 0.02), Math.cos(angle) * (BARREL_R + 0.02), 0);
      plank.rotation.z = -angle;
      this.barrel.add(plank);
    }
    [-1.74, 1.74].forEach((z) => {
      const lid = new THREE.Mesh(new THREE.CylinderGeometry(BARREL_R - 0.12, BARREL_R - 0.12, 0.1, 16), new THREE.MeshLambertMaterial({ color: "#6e4522" }));
      lid.rotation.x = Math.PI / 2;
      lid.position.z = z;
      this.barrel.add(lid);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.16), new THREE.MeshLambertMaterial({ color: "#546a86" }));
      hub.position.z = z;
      this.barrel.add(hub);
      // Jahresringe und zwei weisse Speichen auf der Stirn: von vorn sieht man
      // daran sofort, wie schnell und in welche Richtung der Stamm rollt.
      [0.55, 1.05, 1.5].forEach((r) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 4, 28), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
        ring.position.z = z + Math.sign(z) * 0.06;
        this.barrel.add(ring);
      });
      [0, Math.PI / 2].forEach((angle) => {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, (BARREL_R - 0.2) * 2, 0.04), new THREE.MeshLambertMaterial({ color: "#fff3dc" }));
        spoke.position.z = z + Math.sign(z) * 0.07;
        spoke.rotation.z = angle;
        this.barrel.add(spoke);
      });
    });
    [-1.55, 1.55].forEach((z) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(BARREL_R + 0.05, 0.06, 6, 20), new THREE.MeshLambertMaterial({ color: "#546a86" }));
      ring.position.z = z;
      this.barrel.add(ring);
    });
    this.barrel.position.set(0, BARREL_CENTER_Y, 0);
    this.scene.add(this.barrel);

    // Die Punktezone hängt an der Welt, nicht am Fass: der Punktwert richtet
    // sich nach dem Abstand zum Scheitelpunkt, und der dreht nicht mit.
    const limit = this.minigame?.arcade?.limit || 1.7;
    const zoneAngle = (limit * 0.4) / BARREL_R;
    for (let i = -3; i <= 3; i += 1) {
      const angle = (i / 3) * zoneAngle;
      const near = 1 - Math.abs(i) / 3;
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.02, 3.3),
        new THREE.MeshBasicMaterial({ color: near > 0.6 ? "#c9ffdc" : "#5fe08a", transparent: true, opacity: 0.35 + near * 0.55, depthWrite: false, toneMapped: false })
      );
      // Flach auf den Dauben, nicht darüber schwebend: die Figuren liefen
      // sonst durch die Bänder hindurch.
      band.position.set(Math.sin(angle) * (BARREL_R + 0.08), BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.08), 0);
      band.rotation.z = -angle;
      this.scene.add(band);
    }
    // Rote Schienen genau am Absturzwinkel des Servers.
    const limitAngle = limit / BARREL_R;
    [-1, 1].forEach((sign) => {
      const angle = sign * limitAngle;
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 3.5),
        new THREE.MeshLambertMaterial({ color: "#ff2038", emissive: "#ff2038", emissiveIntensity: 0.9 })
      );
      rail.position.set(Math.sin(angle) * (BARREL_R + 0.12), BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.12), 0);
      rail.rotation.z = -angle;
      this.scene.add(rail);
      this.rails ||= [];
      this.rails.push(rail);
    });
    this.limit = limit;

    [[-7, 6.4, -6, 5], [7, 7.2, -4, 6], [0, 7.8, -9, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    (this.getState()?.players || []).forEach((player, index) => {
      const kin = this.addKin(player, index, { x: 0, ground: TOP_Y, z: this.laneZ(index) });
      // Erst die Blickrichtung, dann die Neigung auf der Rundung — in der
      // Standardreihenfolge drehte die Kippachse mit, und wer seitwärts lief,
      // kippte nach vorn statt zur Seite.
      kin.rotation.order = "ZYX";
      this.shadows.get(player.id).userData.manual = true;
    });
  }

  shot() {
    // Schräg von vorn oben auf die Stirnseite des Stamms: die Stirn zeigt als
    // Rad mit Speichen, WIE der Stamm rollt, und die vier Figuren stehen
    // hintereinander auf der Oberseite, nach hinten gestaffelt. Vorher schaute
    // die Kamera fast senkrecht von oben — der Stamm sah aus wie ein stehender
    // Turm, und dass er rollt, las man nur an der Anzeige.
    return {
      look: [0, TOP_Y - 0.15, 0.2],
      frame: { w: 4.6, h: 3.3 },
      yaw: 0.12,
      pitch: 0.62,
      fov: 38,
      intro: { yaw: -0.9, pitch: -0.25, zoom: 1.8 }
    };
  }

  laneZ(index) {
    return (index - 1.5) * 0.95;
  }

  // Eine Welle: blauer Wasserberg mit weisser Schaumkrone, so lang wie das
  // Fass. Sie rollt quer zum Fass heran; die Krone zeigt in Laufrichtung.
  //
  // Die Kamera schaut längs des Fasses, also sieht man die Welle im Profil:
  // ein Keil, der zur Laufrichtung hin ansteigt und vorn überkippt. Sie ist
  // bewusst hoch — flach am Wasser lag sie unter den Tasten und war nur ein
  // weisser Strich.
  makeWave(dir) {
    const group = new THREE.Group();
    // Kräftiger als das Flusswasser: in der Sonne wurde ein helles Blau fast
    // weiss, und die Welle las sich als Mauer statt als Wasser.
    const water = new THREE.MeshLambertMaterial({ color: "#1f7fd0" });
    const deep = new THREE.MeshLambertMaterial({ color: "#1766ad" });
    const foam = new THREE.MeshLambertMaterial({ color: "#f4fbff" });
    const LEN = 3.4;
    [[-0.55, 0.5, 0.5, deep], [-0.1, 0.95, 0.55, water], [0.32, 1.3, 0.45, water]].forEach(([x, h, w, mat]) => {
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, h, LEN), mat);
      step.position.set(dir * x, h / 2, 0);
      group.add(step);
    });
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, LEN + 0.1), foam);
    lip.position.set(dir * 0.62, 1.34, 0);
    group.add(lip);
    const curl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, LEN + 0.1), foam);
    curl.position.set(dir * 0.84, 1.12, 0);
    group.add(curl);
    for (let i = 0; i < 5; i += 1) {
      const fleck = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.4), foam);
      fleck.position.set(dir * (-0.3 + (i % 2) * 0.4), 0.96 + (i % 3) * 0.12, -1.4 + i * 0.7);
      group.add(fleck);
    }
    group.traverse((part) => { if (part.isMesh) part.castShadow = true; });
    this.scene.add(group);
    return group;
  }

  // Wellen heranrollen lassen, beim Aufprall spritzen, danach brechen.
  syncWaves(arcade, elapsed, controlledId, now) {
    const active = new Set();
    let warn = null;
    (arcade.waves || []).forEach((wave) => {
      if (elapsed < wave.warnAt || elapsed > wave.at + WAVE_AFTER_MS) return;
      active.add(wave.id);
      let mesh = this.waveMeshes.get(wave.id);
      if (!mesh) {
        mesh = this.makeWave(wave.dir);
        this.waveMeshes.set(wave.id, mesh);
      }
      const hitX = -wave.dir * (BARREL_R + 0.45);
      if (elapsed < wave.at) {
        const u = (elapsed - wave.warnAt) / Math.max(1, wave.at - wave.warnAt);
        // Erst gemächlich, dann schneller — wie eine Welle, die aufläuft.
        const eased = u * u * (1.6 - 0.6 * u);
        // Sie steigt beim Anrollen aus dem Wasser und türmt sich auf.
        mesh.position.set(-wave.dir * THREE.MathUtils.lerp(WAVE_START_X, BARREL_R + 0.45, eased), WATER_Y - 0.5 + Math.min(1, u * 2.5) * 0.4, WAVE_Z);
        mesh.scale.set(1, 0.55 + u * 0.75, 1);
        if (!warn || wave.at < warn.at) warn = wave;
        if (!this.wavesWarned.has(wave.id)) {
          this.wavesWarned.add(wave.id);
          this.feedback?.sound("whoosh", { pan: -wave.dir * 0.6 });
        }
      } else {
        const u = (elapsed - wave.at) / WAVE_AFTER_MS;
        mesh.position.set(hitX + wave.dir * u * 0.6, WATER_Y - 0.1 - u * 0.6, WAVE_Z);
        mesh.scale.set(1 + u * 0.5, Math.max(0.05, 1.3 * (1 - u)), 1);
        if (!this.wavesHit.has(wave.id)) {
          this.wavesHit.add(wave.id);
          const at = new THREE.Vector3(hitX, BARREL_CENTER_Y - 0.2, 0);
          [-1.2, 0, 1.2].forEach((z) => {
            this.burst(at.clone().setZ(z), ["#bfe9ff", "#ffffff", "#3aa9ef"], { count: 10, speed: 2.6, up: 3, size: 0.1, life: 0.8, drag: 1.3 });
          });
          this.bursts.ring(new THREE.Vector3(hitX, WATER_Y + 0.05, 0), "#e8f7ff", { radius: 2.4, life: 0.7, y: WATER_Y + 0.05 });
          this.rig.shake(wave.wild ? 0.45 : 0.3);
          this.feedback?.sound("impact");
          const own = arcade.players?.[controlledId];
          if (own && !own.fallenAt) this.feedback?.vibrate(18);
        }
      }
    });
    this.waveMeshes.forEach((mesh, id) => {
      if (active.has(id)) return;
      this.scene.remove(mesh);
      this.waveMeshes.delete(id);
    });

    // Warnung: von welcher Seite, und welche Taste jetzt hilft. Gegen die
    // Welle laufen, also der Seite entgegen, von der sie kommt.
    const node = this.hud.querySelector("[data-barrel-wave]");
    const own = arcade.players?.[controlledId];
    const show = warn && own && !own.fallenAt;
    if (node) {
      node.hidden = !show;
      if (show) {
        const fromLeft = warn.dir > 0;
        const key = `${warn.id}`;
        if (node.dataset.wave !== key) {
          node.dataset.wave = key;
          node.dataset.side = fromLeft ? "left" : "right";
          node.textContent = fromLeft ? "🌊 WELLE! Halte ◀" : "Halte ▶ WELLE! 🌊";
        }
        node.classList.toggle("is-close", warn.at - elapsed < 450);
      }
    }
    const needed = show ? (warn.dir > 0 ? "-1" : "1") : null;
    this.controls?.querySelectorAll("[data-barrel-run]").forEach((button) => {
      button.classList.toggle("is-hint", button.dataset.barrelRun === needed);
    });
  }

  // Countdown zum Wildwasser, dann die Ansage und das dunklere, schnellere
  // Wasser. Liefert den Bannertext, solange einer zu zeigen ist.
  syncWild(arcade, elapsed, now) {
    const wildAt = arcade.wildAt ?? Infinity;
    const wild = elapsed >= wildAt;
    const mix = wild ? Math.min(1, (elapsed - wildAt) / 1200) : 0;
    this.waterMesh.material.color.copy(WATER_CALM).lerp(WATER_WILD, mix);
    this.rails?.forEach((rail) => {
      rail.material.emissiveIntensity = wild ? 0.9 + Math.sin(now / 140) * 0.6 : 0.9;
    });
    if (!wild && elapsed >= wildAt - (arcade.wildWarnMs || 3000)) {
      const left = Math.ceil((wildAt - elapsed) / 1000);
      if (this.countShown !== left) {
        this.countShown = left;
        this.feedback?.sound("countdown");
      }
      return { text: `WILDWASSER in ${left}…`, background: "#0f5f96", color: "#ffffff" };
    }
    if (wild && !this.wildShown) {
      this.wildShown = now;
      this.feedback?.sound("combo");
      this.feedback?.vibrate([30, 30, 30]);
      this.rig.shake(0.6);
    }
    if (wild && now - this.wildShown < 2600) {
      return { text: "🌊 WILDWASSER!\nWer jetzt fällt, ist raus", background: "#ff5c6e", color: "#ffffff" };
    }
    return null;
  }

  // Ein Schwimmring für alle, die im Wildwasser gekentert sind.
  ringFor(playerId) {
    let ring = this.rings.get(playerId);
    if (!ring) {
      ring = new THREE.Group();
      const orange = new THREE.MeshLambertMaterial({ color: "#ff7a3d" });
      const white = new THREE.MeshLambertMaterial({ color: "#ffffff" });
      for (let i = 0; i < 8; i += 1) {
        const seg = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.1, 6, 3, Math.PI / 4 + 0.02), i % 2 ? white : orange);
        seg.rotation.z = (i / 8) * Math.PI * 2;
        ring.add(seg);
      }
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
      this.rings.set(playerId, ring);
    }
    return ring;
  }

  // Wer im Wasser treibt, zieht die Kamera nicht hinter sich her.
  keepInView() {
    const up = [...this.kins.values()].filter((kin) => !kin.userData.outOfPlay);
    return up.length ? up : [];
  }

  // Rutschen alle zur selben Seite, zieht die Kamera ein Stück mit — sonst
  // hängen sie gerade dann am Bildrand, wenn es knapp wird.
  rigOptions(f) {
    const xs = f.players
      .map((player) => this.kins.get(player.id))
      .filter((kin) => kin && !kin.userData.outOfPlay)
      .map((kin) => kin.position.x);
    if (!xs.length || f.finale) return {};
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    return { look: [mid * 0.55, TOP_Y - 0.1, 0.1] };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="runner-lane-controls barrel-run-controls">
        <button type="button" data-barrel-run="-1" aria-label="Nach links laufen">◀</button>
        <button type="button" data-barrel-run="1" aria-label="Nach rechts laufen">▶</button>
      </div>`;
    this.controls.querySelectorAll("[data-barrel-run]").forEach((button) => {
      const dir = Number(button.dataset.barrelRun);
      this.on(button, "pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        this.setHold(dir);
        button.classList.add("is-holding");
      });
      const release = () => {
        button.classList.remove("is-holding");
        if (this.holdDir === dir) this.setHold(0);
      };
      this.on(button, "pointerup", release);
      this.on(button, "pointercancel", release);
      this.on(button, "lostpointercapture", release);
    });
  }

  unbind() {
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    this.waveMeshes.clear();
    this.rings.clear();
  }

  // Wer im Schwimmring treibt, macht keine Podiumspose im Wasser.
  finaleOverride(player, place, f) {
    return Boolean(f.arcade?.players?.[player.id]?.outAt);
  }

  setHold(dir) {
    this.holdDir = dir;
    clearInterval(this.holdTimer);
    this.holdTimer = null;
    if (dir !== 0) {
      this.feedback?.vibrate(8);
      this.sendRun();
      this.holdTimer = setInterval(() => this.sendRun(), RUN_PING_MS);
    }
  }

  sendRun() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (own?.fallenAt || this.holdDir === 0) {
      this.setHold(0);
      return;
    }
    const now = performance.now();
    if (now - (this.lastStep || 0) > 130) {
      this.lastStep = now;
      this.feedback?.sound("step", { pan: this.holdDir * 0.35 });
    }
    this.sendInput({ action: "run", dir: this.holdDir }).catch(() => {});
  }

  onUpdate() {
    this.lastServerAt = performance.now();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;

    // Die Serverdrehung mit dem aktuellen Tempo fortschreiben, damit das Fass
    // zwischen den Ticks gleichmässig rollt.
    const age = Math.min(0.25, (performance.now() - this.lastServerAt) / 1000);
    const targetAngle = (arcade.barrelAngle || 0) + (arcade.barrelVel || 0) * age;
    this.localAngle += (targetAngle - this.localAngle) * Math.min(1, dt * 10);
    this.barrel.rotation.z = -this.localAngle / BARREL_R;
    const speed = Math.abs(arcade.barrelVel || 0);
    const elapsed = now - f.minigame.startedAt;
    this.syncWaves(arcade, elapsed, controlledId, now);
    this.wildBanner = this.syncWild(arcade, elapsed, now);

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const shadow = this.shadows.get(player.id);
      if (!entry || !kin || !animator) return;
      const fallen = Boolean(entry.fallenAt);
      // Zurück aus dem Wasser: der Sturz ist vorbei, die Figur springt oben in
      // die Mitte des Stamms.
      if (!fallen && this.fell.has(player.id)) {
        const from = kin.position.clone();
        this.fell.delete(player.id);
        this.fell.delete(`${player.id}:splash`);
        this.smoothOffset.set(player.id, 0);
        this.climb.set(player.id, { at: now, from });
        animator.trigger("jump");
        animator.expression("effort", 500);
        this.burst(new THREE.Vector3(from.x, WATER_Y + 0.1, from.z), ["#bfe9ff", "#ffffff"], { count: 12, speed: 1.8, up: 2.4, size: 0.08, life: 0.6 });
        if (player.id === controlledId) this.feedback?.sound("whoosh");
      }
      const shown = (this.smoothOffset.get(player.id) ?? 0) + ((entry.offset || 0) - (this.smoothOffset.get(player.id) ?? 0)) * Math.min(1, dt * 9);
      this.smoothOffset.set(player.id, shown);
      const angle = shown / BARREL_R;

      if (fallen && !this.fell.has(player.id)) {
        this.fell.set(player.id, now);
        animator.trigger("tumble");
        const at = kin.position.clone();
        this.burst(at, ["#1f8fd6", "#bfe9ff", player.color], { count: 18, speed: 2.5, up: 2, size: 0.09, life: 0.8, drag: 1.5 });
        this.pop(at.clone().add(new THREE.Vector3(0, 1.1, 0)), entry.outAt ? "RAUS! 🛟" : "PLATSCH! 💦", { color: entry.outAt ? "#ffb37a" : "#8fd8f2", size: 0.44, life: 1 });
        if (player.id === controlledId) {
          this.rig.shake(0.8);
          this.feedback?.sound("fall");
          this.feedback?.vibrate([28, 20, 36]);
          this.setHold(0);
        } else {
          this.feedback?.sound("land");
        }
      }

      kin.userData.outOfPlay = fallen;
      const ring = this.rings.get(player.id);
      if (ring) ring.visible = false;
      if (fallen && entry.outAt && now - this.fell.get(player.id) > 900) {
        // Im Wildwasser gekentert: treibt im Schwimmring vor dem Fass und
        // schaut beim Rest zu, statt einfach zu verschwinden.
        const side = entry.fallSide || 1;
        const bob = Math.sin(now / 380 + index * 1.7) * 0.06;
        kin.visible = true;
        setKinOpacity(kin, 1);
        // Seitlich neben dem Fass, auf Höhe der eigenen Bahn: dort liegt das
        // Wasser mitten im Bild. Vor dem Fass trieb man unter den Tasten.
        kin.position.x = side * (BARREL_R + 0.8);
        kin.position.z = this.laneZ(index);
        this.setGround(player.id, WATER_Y - 0.42 + bob);
        kin.rotation.z = Math.sin(now / 520 + index) * 0.08;
        kin.rotation.y += (0 - kin.rotation.y) * Math.min(1, dt * 4);
        animator.set("balance", { params: { wobble: 0.35 } });
        animator.rate = 0.6;
        animator.expression("sad", 300);
        if (kin.userData.label) kin.userData.label.visible = true;
        shadow.visible = false;
        const float = this.ringFor(player.id);
        float.visible = true;
        float.position.set(kin.position.x, WATER_Y + 0.02 + bob, kin.position.z);
        return;
      }
      if (fallen) {
        // Die Rundung hinunter und in den Fluss.
        const since = (now - this.fell.get(player.id)) / 1000;
        const fallAngle = Math.sign(shown || 1) * Math.min(2.2, Math.abs(angle) + since * 2.4);
        kin.position.x = Math.sin(fallAngle) * (BARREL_R + 0.35);
        const ground = Math.max(WATER_Y - 1.2, BARREL_CENTER_Y + Math.cos(fallAngle) * BARREL_R - since * 2.2);
        this.setGround(player.id, ground);
        kin.rotation.z = -fallAngle * 0.6;
        const depth = Math.max(0, WATER_Y + 0.2 - ground);
        setKinOpacity(kin, Math.max(0, 1 - depth * 1.3));
        kin.visible = ground > WATER_Y - 1.1;
        if (kin.userData.label) kin.userData.label.visible = false;
        shadow.visible = false;
        if (!kin.visible && !this.fell.get(`${player.id}:splash`)) {
          this.fell.set(`${player.id}:splash`, true);
          this.bursts.ring(new THREE.Vector3(kin.position.x, WATER_Y + 0.05, kin.position.z), "#bfe9ff", { radius: 1.6, life: 0.6, y: WATER_Y + 0.05 });
        }
        return;
      }

      kin.visible = true;
      setKinOpacity(kin, 1);
      if (kin.userData.label) kin.userData.label.visible = true;
      const climb = this.climb.get(player.id);
      if (climb) {
        // Ein Sprung aus dem Wasser im Bogen nach oben.
        const u = Math.min(1, (now - climb.at) / CLIMB_MS);
        const top = BARREL_CENTER_Y + BARREL_R + 0.07;
        kin.position.x = THREE.MathUtils.lerp(climb.from.x, 0, u);
        kin.position.z = this.laneZ(index);
        this.setGround(player.id, THREE.MathUtils.lerp(WATER_Y, top, u) + Math.sin(u * Math.PI) * 1.2);
        kin.rotation.z = 0;
        shadow.visible = false;
        if (u >= 1) this.climb.delete(player.id);
        return;
      }
      // Auf den Dauben (sie liegen 0.07 über dem Fasskörper), und zwar entlang
      // der Senkrechten des Stamms: die Figur neigt sich mit der Rundung, also
      // muss auch ihre Mitte dort sitzen, wohin die Neigung zeigt. Vorher
      // stand sie waagrecht versetzt — am Rand schwebte ein Fuss, der andere
      // steckte im Holz.
      const reach = BARREL_R + 0.07 + KIN_SOLE;
      kin.position.x = Math.sin(angle) * reach;
      kin.position.z = this.laneZ(index);
      this.setGround(player.id, BARREL_CENTER_Y + Math.cos(angle) * reach - KIN_SOLE);
      kin.rotation.z = -angle;
      shadow.visible = true;
      shadow.position.set(kin.position.x, BARREL_CENTER_Y + Math.cos(angle) * (BARREL_R + 0.03), kin.position.z);
      shadow.rotation.z = -angle;

      if (finale) {
        kin.rotation.y += (0 - kin.rotation.y) * Math.min(1, dt * 6);
        return;
      }
      const holding = now - (entry.lastRunAt || 0) <= 260;
      const edge = Math.min(1, Math.abs(shown) / this.limit);
      if (holding) {
        animator.set("run");
        // Wo gelaufen wird, spritzt es hinter dem Fass: man sieht, wer schiebt.
        if (Math.random() < Math.min(1, dt * 9)) {
          const side = entry.runDir < 0 ? 1 : -1;
          this.burst(new THREE.Vector3(side * (BARREL_R + 0.3), WATER_Y + 0.15, kin.position.z), ["#bfe9ff", "#ffffff", player.color], { count: 2, speed: 1.4, up: 1.6, size: 0.07, life: 0.5, drag: 1.4 });
        }
        // Gegen ein schnelles Fass muss man schneller trippeln.
        animator.rate = 0.9 + speed * 0.35;
        const face = (entry.runDir < 0 ? -1 : 1) * Math.PI / 2;
        kin.rotation.y += (face - kin.rotation.y) * Math.min(1, dt * 12);
      } else {
        animator.set("balance", { params: { wobble: 0.6 + edge * 1.6 } });
        animator.rate = 1;
        kin.rotation.y += (0 - kin.rotation.y) * Math.min(1, dt * 8);
        if (edge > 0.7) animator.expression("scared", 200);
      }
    });

    this.waterMesh.position.y = WATER_Y - 0.25 + Math.sin(now / (arcade.wild ? 420 : 900)) * (arcade.wild ? 0.08 : 0.05);
    const flow = arcade.wild ? 2.6 : 1;
    this.ripples.forEach((ripple, i) => {
      ripple.position.x += dt * (0.4 + (i % 3) * 0.2) * flow;
      if (ripple.position.x > 12) ripple.position.x = -12;
    });
  }

  drawHud(f) {
    const own = f.arcade?.players?.[f.controlledId];
    const spin = this.hud.querySelector("[data-barrel-spin]");
    if (spin) {
      const vel = f.arcade?.barrelVel || 0;
      const count = Math.min(3, Math.round(Math.abs(vel) / 0.7));
      const text = count === 0 ? "Fass ruhig" : `Fass rollt ${vel < 0 ? "◀".repeat(count) : "▶".repeat(count)}`;
      spin.textContent = f.arcade?.wild ? `🌊 ${text}` : text;
      spin.classList.toggle("hot", count >= 3);
    }
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    // Die Zahl, nach der gewertet wird: Zeit mittig auf dem Fass.
    this.scoreNode.textContent = `${(own?.balanceWork || 0).toFixed(1)}s`;
    const banner = this.hud.querySelector("[data-barrel-banner]");
    banner.style.whiteSpace = "pre-line";
    if (own?.outAt) {
      banner.hidden = false;
      banner.textContent = "Gekentert — raus! 🛟";
      banner.style.background = "#0f5f96";
      banner.style.color = "#ffffff";
    } else if (own?.fallenAt) {
      banner.hidden = false;
      const back = Math.max(0, Math.ceil(((own.backAt || 0) - f.now) / 1000));
      banner.textContent = back > 0 ? `Ins Wasser gerollt! Zurück in ${back}…` : "Ins Wasser gerollt!";
      banner.style.background = "#1f8fd6";
      banner.style.color = "#ffffff";
    } else if (this.wildBanner && !f.finale) {
      banner.hidden = false;
      banner.textContent = this.wildBanner.text;
      banner.style.background = this.wildBanner.background;
      banner.style.color = this.wildBanner.color;
    } else {
      banner.hidden = true;
    }
  }
}
