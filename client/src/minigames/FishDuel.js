import * as THREE from "/vendor/three/three.module.js";
import {
  applyFinaleMood,
  CubeBurst,
  FloatingText,
  KinAnimator,
  createCloud,
  createNameLabel,
  createVoxelKin,
  standOn
} from "./VoxelKit.js?v=tumblekin118";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage,
  dressWater
} from "./SceneKit.js?v=tumblekin118";
import { frameDecay, shakeScale } from "./Quality.js?v=tumblekin118";

// Angelduell — der Fisch hängt, jetzt geht es um die Schnur. Halten holt ein und
// baut Spannung auf, Loslassen lässt sie sinken, kostet aber Weg. In seinen
// Schüben wehrt sich der Fisch: dann steigt die Spannung viermal so schnell.
// Weiter einholen bringt mehr, reisst aber leicht — das ist die Entscheidung,
// und sie stellt sich alle paar Sekunden neu.
//
// Am Bild gerechnet: die Kamera steht hoch und schaut flach über das Wasser,
// damit die ENTFERNUNG des Fisches auf die Bildhöhe abgebildet wird. Flacher
// gestellt legte der Fisch nur 0.48 NDC zurück und man sah kaum, dass er
// näher kam; so sind es 0.85 — knapp die halbe Bildhöhe.
// Am Bild gerechnet und zweimal nachgemessen: der Angler muss ganz ueber der
// Knopfleiste stehen. Bei z=0.1 lag er bei y=859 px und damit vollstaendig
// hinter Banner und Knopf; bei z=-0.6 schaute nur noch der Scheitel heraus, weil
// die Figur knapp 1.0 hoch ist und nicht 1.5, wie ich zuerst gerechnet hatte.
// Bei z=-1.5 stehen die Fuesse auf ~700 px, also klar ueber dem Banner (ab
// ~790). Der Fisch kommt entsprechend weiter hinten an.
// Die Kampfstrecke ist ZUSAMMENGERÜCKT. Vorher lag der Fisch am Anfang neunzehn
// Einheiten draussen, also gut dreiundzwanzig von der Kamera: von einem Fisch
// der Länge 1.15 blieben ein paar Pixel, und dazwischen lagen vierhundert Pixel
// leeres Wasser mit einer Schnur darin. Der Gegner des Spiels war unsichtbar.
//
// Die Regel rechnet ohnehin mit einem Anteil zwischen 0 und 1 — wie viele
// Welteinheiten das sind, ist ihr gleich. Also so viele, dass man den Fisch die
// ganze Zeit sieht. Das Wasser dahinter bleibt als Kulisse stehen.
const FISH_FAR_Z = -11;
const FISH_NEAR_Z = -3.4;
const ANGLER_Z = -1.5;
const PIER_TOP_Y = 0.33;              // Oberkante des Stegs (0.16 + 0.34/2)

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class FishDuel {
  constructor({ canvas, controls, sendInput, now, getState, getControlledPlayerId, myPlayerId, feedback }) {
    this.canvas = canvas;
    this.controls = controls;
    this.sendInput = sendInput;
    this.now = now;
    this.getState = getState;
    this.getControlledPlayerId = getControlledPlayerId || (() => myPlayerId);
    this.feedback = feedback;
    this.minigame = null;
    this.update = null;
    this.frame = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.webglCanvas = null;
    this.hud = null;
    this.holding = false;
    this.lastPingAt = 0;
    this.lastSnapAt = 0;
    this.lastLandedAt = 0;
    this.wasSurging = false;
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.thrash = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Angelduell", background: "#8ecdf0", fog: ["#a9dcf2", 22, 60], fov: 60, far: 120 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="fish-gauge" data-fish-gauge>
        <span class="fish-gauge-label">Schnur</span>
        <span class="fish-gauge-track"><i data-fish-tension></i></span>
      </div>
      <div class="fish-chips" data-fish-chips></div>
      <div class="color-banner fish-banner" data-fish-banner hidden></div>
    `);
    this.createScene();

    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-fish-reel>
        <span class="nerve-button-face">EINHOLEN</span>
      </button>
    `;
    this.button = this.controls.querySelector("[data-fish-reel]");
    this.onDown = (event) => {
      event.preventDefault();
      this.holding = true;
      this.feedback?.sound("tap");
    };
    this.onUp = () => {
      this.holding = false;
    };
    this.button.addEventListener("pointerdown", this.onDown);
    this.webglCanvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    this.loop();
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.controls.innerHTML = "";
    this.button?.removeEventListener("pointerdown", this.onDown);
    this.webglCanvas?.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    teardownStage(this);
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-6, 14, 6],
      shadow: { left: -6, right: 6, top: 6, bottom: -8 },
      groundColor: 0x4e9ec9
    });

    const water = new THREE.Mesh(
      new THREE.BoxGeometry(30, 0.4, 44),
      new THREE.MeshLambertMaterial({ color: "#2f9fd0" })
    );
    water.position.set(0, -0.2, -14);
    water.receiveShadow = true;
    this.scene.add(water);

    // Ufer, Schilf, Seerosen und Tiefenbänder. Vorher lagen hier sieben weisse
    // Streifen bei 8 % Deckkraft — gemeint als Tiefenanzeige, im Bild praktisch
    // unsichtbar. Man schaute auf eine leere blaue Fläche und konnte nicht
    // sehen, wie weit der Fisch draussen war, obwohl genau das die Regel ist.
    dressWater(this.scene, {
      seed: 27,
      waterY: 0,
      farZ: FISH_FAR_Z - 5,
      nearZ: 1,
      width: 30,
      laneHalf: 2.6
    });

    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.34, 2.8),
      new THREE.MeshLambertMaterial({ color: "#a5794f" })
    );
    pier.position.set(0, PIER_TOP_Y - 0.17, -0.7);
    pier.receiveShadow = true;
    pier.castShadow = true;
    this.scene.add(pier);

    [[-1.3, 0.4], [1.3, 0.4], [-1.3, -1.8], [1.3, -1.8]].forEach(([x, z]) => {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6),
        new THREE.MeshLambertMaterial({ color: "#7d5a38" })
      );
      post.position.set(x, -0.2, z);
      this.scene.add(post);
    });

    [[-6.5, 5.4, -18, 4], [6.2, 6.1, -20, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      this.scene.add(cloud);
    });

    this.buildAngler();
    this.buildFish();
    this.buildLine();

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.resizeRenderer();
    this.camera.position.set(0, 4.3, 3.2);
    this.camera.lookAt(0, 0.4, -4.6);
  }

  buildAngler() {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId()) || state?.players?.[0];
    this.ownColor = me?.color || "#ff5d73";
    const kin = createVoxelKin(this.ownColor, 0);
    const label = createNameLabel("du", this.ownColor);
    label.position.y = 0.7;
    kin.add(label);
    kin.position.set(0, standOn(PIER_TOP_Y), ANGLER_Z);
    this.scene.add(kin);
    this.angler = kin;
    this.anglerAnimator = new KinAnimator(kin);
    this.anglerAnimator.groundY = standOn(PIER_TOP_Y);
    this.anglerZ = ANGLER_Z;

    // Die Rute sitzt am Kin, damit sie seine Bewegung mitmacht.
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.045, 2.3, 6),
      new THREE.MeshLambertMaterial({ color: "#4d3b26" })
    );
    rod.position.set(0.3, 0.55, -0.35);
    rod.rotation.set(-0.62, 0, -0.22);
    kin.add(rod);
    this.rod = rod;
  }

  buildFish() {
    const fish = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.3, 1.15),
      new THREE.MeshLambertMaterial({ color: "#2b4a63" })
    );
    body.castShadow = true;
    fish.add(body);
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.24, 0.34),
      new THREE.MeshLambertMaterial({ color: "#223d52" })
    );
    tail.position.z = 0.72;
    fish.add(tail);
    // Die Rückenflosse ist HELL und schneidet durch die Oberfläche. Sie ist das
    // Einzige, was man von einem Fisch im Wasser auf zwanzig Einheiten
    // Entfernung überhaupt sieht — vorher war sie so dunkel wie das Wasser, und
    // damit war der Gegner des ganzen Spiels unsichtbar.
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.4, 0.44),
      new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#c98f1e", emissiveIntensity: 0.35 })
    );
    fin.position.y = 0.3;
    fish.add(fin);
    // Ein Auge. Ohne war der Fisch ein Klotz und man sah nicht, wo vorne ist.
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.06),
      new THREE.MeshBasicMaterial({ color: "#ffffff" })
    );
    eye.position.set(0.27, 0.08, -0.42);
    fish.add(eye);
    fish.position.set(0, 0.12, FISH_FAR_Z);
    this.scene.add(fish);
    this.fish = fish;
    this.tail = tail;
    this.fishParts = { body, tail, fin, eye };
    this.shownSpecies = null;

    // Kielwasser: zeigt, dass der Fisch zieht, auch wenn er weit weg klein ist.
    // Kräftigeres Kielwasser: bei 0.3 Deckkraft und 0.85 Radius war es auf
    // zwanzig Einheiten ein Pünktchen. Es ist die Fahne des Fisches — daran
    // liest man ab, wo er ist und dass er zieht.
    const wake = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 1.35, 22),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, depthWrite: false })
    );
    wake.rotation.x = -Math.PI / 2;
    wake.position.y = 0.05;
    this.scene.add(wake);
    this.wake = wake;
  }

  buildLine() {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0.1, FISH_FAR_Z)]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.85 }));
    this.scene.add(line);
    this.line = line;
  }

  loop = () => {
    this.draw();
    this.frame = requestAnimationFrame(this.loop);
  };

  draw() {
    const minigame = this.update || this.minigame;
    const state = this.getState();
    const arcade = minigame?.arcade;
    if (!minigame || !state || !arcade || !this.renderer) return;
    this.resizeRenderer();

    const now = this.now();
    const frameNow = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (frameNow - this.lastFrameAt) / 1000));
    this.lastFrameAt = frameNow;
    const own = arcade.players[this.getControlledPlayerId()];

    // Halten meldet sich als Ping. Der Server rechnet die Spannung über die
    // Zeit — die Ping-Rate darf das Ergebnis also nicht beeinflussen.
    if (this.holding && !minigame.finaleAt && frameNow - this.lastPingAt > 70) {
      this.lastPingAt = frameNow;
      this.sendInput({ action: "reel" }).catch(() => {});
    }

    if (own) {
      this.syncFish(own, dt, now);
      this.reactToEvents(own, now);
    }

    this.bursts.update(dt);
    this.floaters.update(dt, this.camera);

    this.shake *= frameDecay(0.9, dt);
    const shakeX = Math.sin(now / 12) * this.shake * 0.2 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * 0.4;
    this.camera.position.y = this.baseCamY || 4.3;
    this.camera.position.z = this.baseCamZ || 3.2;
    this.camera.lookAt(0, 0.4, -4.6);

    this.updateHud(minigame, arcade, state, now, own);
    this.renderer.render(this.scene, this.camera);
  }

  // Die Art am Haken sieht man an Farbe und Grösse. Ohne das war jeder Fisch
  // derselbe Klotz, und dass gerade ein Wels dranhängt — fünfmal so viel wert
  // und dreimal so bissig — merkte man erst, wenn die Schnur riss.
  applySpecies(kind) {
    if (!kind || !this.fishParts) return;
    if (this.shownSpecies === kind.id) return;
    this.shownSpecies = kind.id;
    const base = new THREE.Color(kind.colour);
    this.fishParts.body.material.color.copy(base);
    this.fishParts.tail.material.color.copy(base).multiplyScalar(0.78);
    this.fishParts.fin.material.color.copy(base).multiplyScalar(0.62);
    this.speciesScale = kind.size;
  }

  syncFish(own, dt, now) {
    this.applySpecies(own.species);
    const distance = clamp(own.distance ?? 1, 0, 1);
    const targetZ = FISH_NEAR_Z + (FISH_FAR_Z - FISH_NEAR_Z) * distance;
    this.fish.position.z += (targetZ - this.fish.position.z) * 0.16;

    // Im Schub schlägt der Fisch quer aus — die auffälligste Warnung, dass jetzt
    // losgelassen werden muss.
    this.thrash += dt * (own.surging ? 13 : 3.4);
    const sway = own.surging ? 0.62 : 0.12;
    this.fish.position.x = Math.sin(this.thrash) * sway;
    this.fish.rotation.y = Math.sin(this.thrash) * (own.surging ? 0.5 : 0.14);
    this.fish.rotation.z = Math.sin(this.thrash * 1.7) * (own.surging ? 0.32 : 0.05);
    this.tail.rotation.y = Math.sin(this.thrash * 2.2) * 0.5;
    // Weit weg wirkt der Fisch sonst winzig; leichte Überhöhung hält ihn lesbar.
    const near = 1 - distance;
    this.fish.scale.setScalar((0.85 + near * 0.5) * (this.speciesScale || 1));

    this.wake.position.set(this.fish.position.x, 0.05, this.fish.position.z + 0.3);
    this.wake.scale.setScalar(0.7 + near * 0.5 + (own.surging ? 0.35 : 0));
    this.wake.material.opacity = own.surging ? 0.5 : 0.22;

    // Die Schnur färbt sich mit der Spannung und wird bei Zug schnurgerade.
    const tension = clamp(own.tension || 0, 0, 1);
    const points = this.line.geometry.attributes.position;
    // Anfang der Schnur aus der Rute holen statt fest zu setzen: so folgt sie
    // dem Ausschlag der Rute, wenn der Angler in den Zug geht.
    this.rod.updateWorldMatrix(true, false);
    const tip = this.rod.localToWorld(new THREE.Vector3(0, 1.15, 0));
    points.setXYZ(0, tip.x, tip.y, tip.z);
    points.setXYZ(1, this.fish.position.x, 0.16, this.fish.position.z - 0.55);
    points.needsUpdate = true;
    this.line.material.color.setRGB(1, 1 - tension * 0.75, 1 - tension * 0.85);
    this.line.material.opacity = 0.55 + tension * 0.45;

    // Der Angler lehnt sich in den Zug: Haltung zeigt an, ob gerade gehalten wird.
    const pull = own.holding ? 1 : 0;
    this.rod.rotation.x += ((-0.62 + pull * 0.34 - tension * 0.3) - this.rod.rotation.x) * 0.18;
    this.angler.rotation.z += ((own.holding ? -0.14 - tension * 0.16 : 0) - this.angler.rotation.z) * 0.16;
    const minigame = this.update || this.minigame;
    if (minigame.finaleAt) {
      const arcade = minigame.arcade;
      const total = this.getState()?.players?.length || 4;
      applyFinaleMood(this.anglerAnimator, arcade?.places?.[this.getControlledPlayerId()], total);
    }
    else if (own.surging && own.holding) this.anglerAnimator.set("hit", { base: true });
    else this.anglerAnimator.set("idle", { base: true });
    this.anglerAnimator.update(now);
  }

  reactToEvents(own, now) {
    if (own.lastSnapAt && own.lastSnapAt !== this.lastSnapAt) {
      this.lastSnapAt = own.lastSnapAt;
      const at = new THREE.Vector3(0, 1.6, -3.2);
      this.bursts.spawn(at, ["#ffffff", "#ff6b7f"], { count: 16, speed: 2.0, up: 1.6, size: 0.07, life: 0.6, drag: 2.0 });
      this.floaters.pop(at, "SCHNUR GERISSEN!", { color: "#ff9aa8", size: 0.42, life: 1.0 });
      this.feedback?.sound("error");
      this.feedback?.vibrate([30, 40, 30]);
      this.shake = Math.max(this.shake, 0.55);
    }
    if (own.lastLandedAt && own.lastLandedAt !== this.lastLandedAt) {
      this.lastLandedAt = own.lastLandedAt;
      const at = new THREE.Vector3(0, 1.8, -2.4);
      this.bursts.spawn(at, [this.ownColor, "#ffe36b", "#ffffff"], { count: 22, speed: 2.4, up: 2.6, size: 0.08, life: 0.8, drag: 1.6 });
      this.floaters.pop(at, `FISCH ${own.landed}!`, { color: "#ffe36b", size: 0.46, life: 1.0 });
      this.feedback?.sound("perfect");
      this.feedback?.vibrate([10, 14, 20]);
    }
    // Ein Schub kündigt sich hörbar an, damit man nicht nur starren muss.
    if (own.surging && !this.wasSurging) this.feedback?.sound("plink");
    this.wasSurging = Boolean(own.surging);
  }

  updateHud(minigame, arcade, state, now, own) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.max(0, Math.round(own?.score || 0)));

    const tension = clamp(own?.tension || 0, 0, 1);
    const bar = this.hud.querySelector("[data-fish-tension]");
    if (bar) {
      bar.style.transform = `scaleX(${tension.toFixed(3)})`;
      bar.style.background = tension > 0.82 ? "#ff4f68" : tension > 0.6 ? "#ffb24f" : "#7fe06f";
    }

    const chips = this.hud.querySelector("[data-fish-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="fish-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.max(0, Math.round(entry?.score || 0))}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-fish-banner]");
    if (!banner) return;
    if ((own?.pauseUntil || 0) > now) {
      banner.hidden = false;
      banner.textContent = "Neu auswerfen …";
      banner.style.background = "#8fa4b4";
      banner.style.color = "#12222c";
    } else if (own?.surging) {
      banner.hidden = false;
      banner.textContent = "ER ZIEHT — LOSLASSEN!";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (tension > 0.82) {
      banner.hidden = false;
      banner.textContent = "Schnur am Limit!";
      banner.style.background = "#ffb24f";
      banner.style.color = "#4a3400";
    } else if (own?.species) {
      // Welche Art dranhängt, muss man WÄHREND des Kampfes wissen — davon hängt
      // ab, wie hart man ziehen darf und ob sich das Risiko lohnt.
      banner.hidden = false;
      banner.textContent = `${own.species.name} · ${own.species.points} Punkte`;
      banner.style.background = own.species.colour;
      banner.style.color = "#14252e";
    } else {
      banner.hidden = true;
    }
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Hohe Kamera, flacher Blick: so wird die Entfernung des Fisches auf die
      // Bildhöhe abgebildet (0.32 → -0.53 NDC statt 0.10 → -0.38).
      // Tiefer und näher, damit die zusammengerückte Strecke das Bild füllt.
      this.baseCamY = portrait ? 4.3 : 5.0;
      this.baseCamZ = portrait ? 3.2 : 4.6;
      camera.fov = portrait ? 60 : 46;
    });
  }
}
