import * as THREE from "/vendor/three/three.module.js";
import {
  CubeBurst,
  FloatingText,
  KinAnimator,
  applyFinaleMood,
  createNameLabel,
  createShadowBlob,
  createVoxelKin,
  standOn
} from "./VoxelKit.js?v=tumblekin125";
import {
  mountStage,
  mountHud,
  addStageLights,
  resizeStage,
  teardownStage
} from "./SceneKit.js?v=tumblekin125";
import { frameDecay, frameLerp, fxScale, shakeScale } from "./Quality.js?v=tumblekin125";

// Augenmaß — ein Schwarm Glühkäfer blitzt anderthalb Sekunden auf, danach
// schätzt man, wie viele es waren.
//
// Das ganze Spiel hängt daran, dass man NICHT zählen kann. Drei Dinge sorgen
// dafür, und jedes ist Absicht:
//
//  * Die Käfer treiben. Ein stehendes Raster liesse sich in Reihen abzählen,
//    ein Gewimmel nicht — man nimmt die Menge als Fläche wahr, nicht als Folge.
//  * Sie stehen im Raum, nicht auf einer Ebene. Perspektive macht hintere Käfer
//    kleiner und enger, und genau das ist die Wahrnehmungsaufgabe.
//  * Anderthalb Sekunden. Lang genug für einen Eindruck, zu kurz zum Zählen —
//    ab etwa dreissig Stück verlässt sich auch ein geübtes Auge aufs Schätzen.
//
// Beim Auflösen werden sie einzeln hochgezählt. Das ist der Moment, auf den die
// Runde wartet, und er darf nicht als blosse Zahl vorbeigehen.
const MAX_SWARM = 95;
// Der Schwarm muss GANZ ins Bild — wer einen Teil nicht sieht, schätzt nicht,
// sondern rät. Bei 4.1 ragten die äusseren Käfer links und rechts aus dem Bild:
// das senkrecht gemessene Sichtfeld ergibt auf einem hochkanten Handy nur rund
// 6.3 Einheiten Breite, der Schwarm war 8.2 breit. Jetzt passt er mit Rand.
const SPAWN_RADIUS = 2.6;

// Ein eigener Zufallszahlengeber je Durchgang: alle Geräte zeigen denselben
// Schwarm, und die Auflösung zählt genau die Käfer hoch, die man gesehen hat.
function seededRandom(seed) {
  let state = (seed * 9301 + 49297) % 233280;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class SwarmCount {
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
    this.flies = [];
    this.lastFrameAt = performance.now();
    this.shake = 0;
    this.shownRound = -1;
    this.shownPhase = "";
    this.shownRevealAt = 0;
    this.countUpUntil = 0;
    this.lastSentGuess = null;
    this.sendTimer = 0;
  }

  start(minigame) {
    this.minigame = minigame;
    this.update = minigame;
    mountStage(this, { label: "3D Augenmaß", background: "#101a2c", fog: ["#16233b", 16, 46], fov: 58, far: 80 });

    mountHud(this, `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-swarm-round>Durchgang 1/4</div>
      <div class="simon-chips" data-swarm-chips></div>
      <div class="color-banner" data-swarm-banner hidden></div>
    `);
    this.createScene();
    this.buildControls();
    this.loop();
  }

  // Ein echter Schieberegler statt eines selbstgebauten Balkens: er lässt sich
  // mit dem Daumen greifen, ohne dass die Szene darunter mitscrollt, und
  // Bedienhilfen kennen ihn.
  buildControls() {
    this.controls.innerHTML = `
      <div class="estimate-pad">
        <div class="estimate-value"><strong data-estimate-value>?</strong><span>Stück</span></div>
        <input type="range" class="estimate-slider" data-estimate-slider
          min="0" max="10" step="1" value="5" aria-label="Deine Schätzung" disabled>
        <div class="estimate-scale"><span data-estimate-low>0</span><span data-estimate-high>10</span></div>
      </div>
    `;
    this.slider = this.controls.querySelector("[data-estimate-slider]");
    this.valueLabel = this.controls.querySelector("[data-estimate-value]");
    this.lowLabel = this.controls.querySelector("[data-estimate-low]");
    this.highLabel = this.controls.querySelector("[data-estimate-high]");

    this.onSlide = () => {
      const value = Number(this.slider.value);
      if (this.valueLabel) this.valueLabel.textContent = String(value);
      // Beim Ziehen fliegen sonst dutzende Pakete je Sekunde los. Gesendet wird
      // gedrosselt — und beim Loslassen in jedem Fall, damit der letzte Stand
      // ankommt.
      const now = this.now();
      if (now - this.sendTimer < 90) return;
      this.sendTimer = now;
      this.pushGuess(value);
    };
    this.onSlideEnd = () => this.pushGuess(Number(this.slider.value));

    this.slider.addEventListener("input", this.onSlide);
    this.slider.addEventListener("change", this.onSlideEnd);
    this.slider.addEventListener("pointerup", this.onSlideEnd);
  }

  pushGuess(value) {
    if (this.lastSentGuess === value) return;
    this.lastSentGuess = value;
    this.feedback?.sound("step");
    this.sendInput({ action: "guess", value }).catch(() => {});
  }

  handleUpdate(update) {
    this.update = update;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.slider?.removeEventListener("input", this.onSlide);
    this.slider?.removeEventListener("change", this.onSlideEnd);
    this.slider?.removeEventListener("pointerup", this.onSlideEnd);
    this.controls.innerHTML = "";
    teardownStage(this);
    this.flies.length = 0;
  }

  createScene() {
    addStageLights(this.scene, {
      sunPosition: [-4, 10, 6],
      shadow: { left: -6, right: 6, top: 8, bottom: -4 }
    });

    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.5, 60),
      new THREE.MeshLambertMaterial({ color: "#1c3324" })
    );
    meadow.position.set(0, -0.25, -12);
    meadow.receiveShadow = true;
    this.scene.add(meadow);

    // Die Szene war ein Nachthimmel ohne alles: flaches Marineblau über
    // flachem Dunkelgrün, dazwischen eine harte Kante. Ein Mond, ein
    // Baumsaum und Sterne geben dem Blau einen Ort — und dem Zählen einen
    // ruhigen Hintergrund, vor dem die Käfer wirklich leuchten.
    const mond = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 24),
      new THREE.MeshBasicMaterial({ color: "#f3f0d8", fog: false })
    );
    mond.position.set(-5.5, 8.2, -24);
    this.scene.add(mond);
    // Der Hof braucht einen weichen Rand. Als gleichmässig gefüllter Kreis mit
    // 14 % Deckkraft war er im Bild eine graue Scheibe mit sichtbarer Kante —
    // er sah aus wie ein zweiter Himmelskörper, nicht wie Mondschein.
    const hofBild = document.createElement("canvas");
    hofBild.width = 64;
    hofBild.height = 64;
    const hofStift = hofBild.getContext("2d");
    const hofVerlauf = hofStift.createRadialGradient(32, 32, 4, 32, 32, 32);
    hofVerlauf.addColorStop(0, "rgba(200,214,255,0.42)");
    hofVerlauf.addColorStop(0.45, "rgba(170,186,235,0.13)");
    hofVerlauf.addColorStop(1, "rgba(150,166,220,0)");
    hofStift.fillStyle = hofVerlauf;
    hofStift.fillRect(0, 0, 64, 64);
    const hofTex = new THREE.CanvasTexture(hofBild);
    hofTex.colorSpace = THREE.SRGBColorSpace;
    const hof = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: hofTex, transparent: true, fog: false, depthWrite: false })
    );
    hof.position.set(-5.5, 8.2, -24.1);
    this.scene.add(hof);

    const sterne = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.13, 0.13, 0.13),
      new THREE.MeshBasicMaterial({ color: "#dfe6ff", fog: false }),
      52
    );
    const punkt = new THREE.Object3D();
    for (let i = 0; i < 52; i += 1) {
      // Fester Streuer: dasselbe Sternbild bei jedem Start.
      punkt.position.set(((i * 89) % 47) - 23, 5 + ((i * 61) % 13) * 0.86, -23);
      punkt.scale.setScalar(0.5 + ((i * 23) % 5) * 0.35);
      punkt.updateMatrix();
      sterne.setMatrixAt(i, punkt.matrix);
    }
    sterne.instanceMatrix.needsUpdate = true;
    this.scene.add(sterne);

    // Baumsaum am Horizont, als Silhouette.
    const saum = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.15, 3.2, 5),
      new THREE.MeshBasicMaterial({ color: "#0d1a18", fog: false }),
      26
    );
    const baum = new THREE.Object3D();
    for (let i = 0; i < 26; i += 1) {
      baum.position.set(-25 + i * 2, 1.2 + ((i * 17) % 5) * 0.3, -19 - ((i * 11) % 4) * 0.8);
      baum.scale.set(1, 0.75 + ((i * 29) % 6) * 0.19, 1);
      baum.updateMatrix();
      saum.setMatrixAt(i, baum.matrix);
    }
    saum.instanceMatrix.needsUpdate = true;
    this.scene.add(saum);

    // Der Schwarm wird EINMAL angelegt und danach nur ein- und ausgeblendet.
    // 95 Käfer je Durchgang neu zu bauen hiesse, im Lauf eines Abends tausende
    // Geometrien anzulegen und wieder wegzuwerfen.
    const flyGeometry = new THREE.SphereGeometry(0.13, 8, 6);
    for (let index = 0; index < MAX_SWARM; index += 1) {
      const mesh = new THREE.Mesh(
        flyGeometry,
        // Additiv: vor dem Nachthimmel wird aus einer gelben Kugel ein
        // Leuchtpunkt. Die Käfer sind das, was gezählt werden muss — sie
        // müssen das Hellste im Bild sein.
        new THREE.MeshBasicMaterial({
          color: "#ffe36b", transparent: true, opacity: 0, toneMapped: false,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      mesh.visible = false;
      this.scene.add(mesh);
      this.flies.push({ mesh, home: new THREE.Vector3(), drift: 0, speed: 1, lit: 0 });
    }

    this.bursts = new CubeBurst(this.scene);
    this.floaters = new FloatingText(this.scene);
    this.buildWatcher();
    this.resizeRenderer();
    this.camera.position.set(0, 3.4, 8.4);
    this.camera.lookAt(0, 2.8, 0);
  }

  buildWatcher() {
    const state = this.getState();
    const me = state?.players?.find((player) => player.id === this.getControlledPlayerId()) || state?.players?.[0];
    const kin = createVoxelKin(me?.color || "#ff5d73", 0);
    kin.scale.setScalar(0.7);
    const label = createNameLabel("du", me?.color || "#ff5d73");
    label.position.y = 0.72;
    kin.add(label);
    kin.position.set(0, standOn(0), 2.2);
    this.scene.add(kin);
    const shadow = createShadowBlob(0.4);
    shadow.position.set(0, 0.06, 2.2);
    this.scene.add(shadow);
    this.watcher = kin;
    this.watcherAnimator = new KinAnimator(kin);
    this.watcherAnimator.groundY = standOn(0);
    this.watcherCheerUntil = 0;
  }

  // Die Käfer eines Durchgangs im Raum verteilen. Aus dem Durchgang gerechnet,
  // damit alle dasselbe Bild sehen.
  layoutSwarm(round) {
    const random = seededRandom(round.index * 977 + round.count * 31 + 7);
    for (let index = 0; index < MAX_SWARM; index += 1) {
      const fly = this.flies[index];
      const inUse = index < round.count;
      fly.mesh.visible = inUse;
      if (!inUse) { fly.lit = 0; continue; }
      // Gleichmässig in einer Kugelschale statt auf einer Scheibe: sonst
      // sammelt sich alles in der Mitte und die Menge liest sich zu leicht ab.
      const angle = random() * Math.PI * 2;
      const radius = SPAWN_RADIUS * Math.sqrt(random());
      fly.home.set(
        Math.cos(angle) * radius,
        1.0 + random() * 3.3,
        Math.sin(angle) * radius * 0.72 - 0.4
      );
      fly.drift = random() * Math.PI * 2;
      fly.speed = 0.6 + random() * 0.9;
      fly.lit = 0;
      fly.mesh.position.copy(fly.home);
    }
  }

  activeRound() {
    const minigame = this.update || this.minigame;
    const arcade = minigame?.arcade;
    if (!arcade?.rounds) return null;
    const elapsed = Math.max(0, this.now() - minigame.startedAt);
    const round = arcade.rounds.find((candidate) => elapsed >= candidate.showFrom && elapsed < candidate.until);
    if (!round) return null;
    const phase = elapsed < round.guessFrom ? "show"
      : elapsed < round.revealFrom ? "guess" : "reveal";
    return { round, phase, elapsed };
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
    const active = this.activeRound();

    this.syncPhase(active, own, now);
    this.syncSwarm(active, dt, now);
    this.syncWatcher(minigame, arcade, state, now);

    this.bursts.update(dt);
    this.floaters.update(dt, this.camera);

    this.shake *= frameDecay(0.87, dt);
    const shakeX = Math.sin(now / 11) * this.shake * 0.2 * shakeScale();
    this.camera.position.x += (shakeX - this.camera.position.x) * frameLerp(0.4, dt);
    this.camera.position.y = this.baseCamY || 3.4;
    this.camera.position.z = this.baseCamZ || 8.4;
    this.camera.lookAt(0, 2.8, 0);

    this.updateHud(minigame, arcade, state, now, own, active);
    this.renderer.render(this.scene, this.camera);
  }

  syncPhase(active, own, now) {
    if (!active) {
      if (this.slider && !this.slider.disabled) this.slider.disabled = true;
      return;
    }
    const { round, phase } = active;

    if (round.index !== this.shownRound) {
      this.shownRound = round.index;
      this.shownPhase = "";
      this.layoutSwarm(round);
      this.lastSentGuess = null;
    }
    if (phase === this.shownPhase) return;
    this.shownPhase = phase;

    if (phase === "show") {
      this.feedback?.sound("sparkle");
      // Die Spanne steht schon beim HINSEHEN da, der Regler bleibt aber
      // gesperrt. Zu wissen, dass zwischen 45 und 95 Käfer fliegen, gehört zur
      // Aufgabe — man schätzt anders, wenn man den Rahmen kennt. Erst danach
      // die Skala einzublenden hiesse, die Hälfte der Information zu spät zu
      // geben.
      if (this.slider) {
        const middle = Math.round((round.low + round.high) / 2);
        this.slider.min = String(round.low);
        this.slider.max = String(round.high);
        this.slider.value = String(middle);
        this.slider.disabled = true;
        if (this.valueLabel) this.valueLabel.textContent = "?";
        if (this.lowLabel) this.lowLabel.textContent = String(round.low);
        if (this.highLabel) this.highLabel.textContent = String(round.high);
      }
    }

    if (phase === "guess") {
      // Freigeben und die Mitte als Startwert zeigen — das ist auch der Wert,
      // mit dem der Server rechnet, wenn niemand den Regler anfasst. Was man
      // sieht, ist also genau das, was gewertet wird.
      if (this.slider) {
        this.slider.disabled = false;
        if (this.valueLabel) this.valueLabel.textContent = String(this.slider.value);
      }
      this.feedback?.sound("lock");
    }

    if (phase === "reveal") {
      if (this.slider) this.slider.disabled = true;
      // Beim Auflösen tauchen die Käfer wieder auf und werden hochgezählt.
      this.countUpUntil = now + 1100;
      const mine = (own?.guesses || []).find((entry) => entry.round === round.index);
      if (mine) this.celebrate(mine, round, now);
    }
  }

  celebrate(result, round, now) {
    const at = new THREE.Vector3(0, 3.2, 0);
    if (result.error === 0) {
      this.bursts.spawn(at, ["#ffe36b", "#ffffff"], { count: Math.round(20 * fxScale()), speed: 2.4, up: 2.0, size: 0.08, life: 0.8, drag: 1.6 });
      this.floaters.pop(at, "GENAU!", { color: "#ffe36b", size: 0.46, life: 1.0 });
      this.shake = Math.min(1, this.shake + 1);
      this.feedback?.sound("win");
    } else if (result.points > 0) {
      this.floaters.pop(at, `+${result.points}`, { color: "#c6ffb0", size: 0.38, life: 0.9 });
      this.feedback?.sound("coin");
    } else {
      this.floaters.pop(at, `${result.guess} statt ${round.count}`, { color: "#ff9aa8", size: 0.34, life: 0.9 });
      this.feedback?.sound("error");
    }
    this.watcherCheerUntil = result.points > 0 ? now + 900 : 0;
    this.watcherSadUntil = result.points > 0 ? 0 : now + 900;
  }

  syncSwarm(active, dt, now) {
    const showing = active && (active.phase === "show" || active.phase === "reveal");
    // Beim Auflösen leuchten die Käfer NACHEINANDER auf — das ist das Zählen,
    // das man selbst nicht geschafft hat, und der Grund, warum die Auflösung
    // eine eigene Phase bekommt statt nur eine Zahl einzublenden.
    const counting = active?.phase === "reveal";
    const progress = counting
      ? clamp(1 - (this.countUpUntil - now) / 1100, 0, 1)
      : 1;

    this.flies.forEach((fly, index) => {
      if (!fly.mesh.visible) return;
      const count = active?.round?.count || 0;
      const wanted = !showing ? 0
        : counting ? (index < progress * count ? 1 : 0)
          : 1;
      const before = fly.lit;
      fly.lit += (wanted - fly.lit) * frameLerp(counting ? 0.5 : 0.28, dt);
      if (counting && before < 0.5 && fly.lit >= 0.5) this.feedback?.sound("plink");

      fly.drift += dt * fly.speed;
      fly.mesh.position.set(
        fly.home.x + Math.sin(fly.drift) * 0.18,
        fly.home.y + Math.sin(fly.drift * 1.4 + 1) * 0.14,
        fly.home.z + Math.cos(fly.drift * 0.8) * 0.16
      );
      fly.mesh.material.opacity = fly.lit;
      fly.mesh.scale.setScalar(0.6 + fly.lit * 0.6);
    });
  }

  syncWatcher(minigame, arcade, state, now) {
    if (!this.watcherAnimator) return;
    if (minigame.finaleAt) {
      applyFinaleMood(this.watcherAnimator, this.finalePlace(arcade, state), state.players.length);
    } else if (this.watcherCheerUntil && now < this.watcherCheerUntil) {
      this.watcherAnimator.set("cheer");
    } else if (this.watcherSadUntil && now < this.watcherSadUntil) {
      this.watcherAnimator.set("sad");
    } else {
      this.watcherAnimator.set("idle", { base: true });
    }
    this.watcherAnimator.update(now);
  }

  finalePlace(arcade, state) {
    const scored = state.players
      .map((player) => ({ id: player.id, score: arcade.players[player.id]?.score || 0 }))
      .sort((a, b) => b.score - a.score);
    const index = scored.findIndex((entry) => entry.id === this.getControlledPlayerId());
    return index < 0 ? state.players.length : index + 1;
  }

  updateHud(minigame, arcade, state, now, own, active) {
    if (!this.hud) return;
    this.hud.classList.toggle("dev-mode", Boolean(state.devMode));
    const remaining = Math.max(0, Math.ceil((minigame.startedAt + minigame.duration - now) / 1000));
    this.hud.querySelector("[data-kinetic-time]").textContent = `${remaining}s`;
    this.hud.querySelector("[data-kinetic-score]").textContent = String(Math.round(own?.score || 0));

    const roundLabel = this.hud.querySelector("[data-swarm-round]");
    if (roundLabel) {
      const total = arcade.rounds?.length || 0;
      roundLabel.textContent = active
        ? `Durchgang ${active.round.index + 1}/${total}`
        : "Gleich geht's los";
    }

    const chips = this.hud.querySelector("[data-swarm-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="simon-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.round(entry?.score || 0)}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-swarm-banner]");
    if (!banner) return;
    if (!active) { banner.hidden = true; return; }
    if (active.phase === "show") {
      banner.hidden = false;
      banner.textContent = "HINSEHEN …";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
      return;
    }
    if (active.phase === "guess") {
      banner.hidden = false;
      banner.textContent = "Wie viele waren es?";
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
      return;
    }
    const mine = (own?.guesses || []).find((entry) => entry.round === active.round.index);
    banner.hidden = false;
    banner.textContent = mine
      ? `Es waren ${active.round.count} — du: ${mine.guess} (+${mine.points})`
      : `Es waren ${active.round.count}`;
    banner.style.background = mine && mine.error === 0 ? "#ffe36b" : "#9fc7ff";
    banner.style.color = "#152436";
  }

  resizeRenderer() {
    resizeStage(this, (portrait, camera) => {
      // Weit genug weg für den ganzen Schwarm, siehe SPAWN_RADIUS.
      this.baseCamY = portrait ? 3.0 : 2.8;
      this.baseCamZ = portrait ? 10.5 : 9.0;
      camera.fov = portrait ? 58 : 50;
    });
  }
}
