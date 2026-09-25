import * as THREE from "/vendor/three/three.module.js";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin200";

// Augenmaß: ein Schwarm Glühwürmchen leuchtet kurz auf — wie viele waren es?
// Geschätzt wird mit dem Schieber.
//
// Vorher stand eine kleine Figur allein unter einem grossen Nachthimmel.
// Jetzt sitzen alle zusammen auf einem Baumstamm vor dem Schwarm, folgen ihm
// mit den Augen, grübeln beim Schätzen und drehen sich bei der Auflösung um:
// wer richtig lag, springt auf, wer daneben lag, schlägt die Hände vors
// Gesicht.
// Die grösste Spanne des Servers endet bei 44 Käfern (ESTIMATE_BANDS).
const MAX_SWARM = 48;
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

const LOG_Z = 2.5;
const LOG_TOP = 0.42;

// Wie hoch der Schwarm steht. Auf einem hochkant gehaltenen Handy bestimmt die
// BREITE den Bildausschnitt: darüber blieb viel Himmel leer, während sich 44
// Käfer auf einem Streifen von einem Viertel der Bildhöhe drängten und sich
// gegenseitig verdeckten — gezählt wurde dann ein Klumpen, nicht die Käfer.
// Hochkant bekommt der Schwarm deshalb eineinhalbmal so viel Höhe, und die
// Kamera schaut entsprechend höher. Quer bleibt es beim flachen Schwarm, sonst
// schrumpfte dort alles.
function swarmShape() {
  const portrait = typeof window !== "undefined" && window.innerHeight > window.innerWidth * 1.15;
  return portrait
    ? { base: 1.3, height: 5.0, look: 3.0, frameH: 6.6 }
    : { base: 1.0, height: 3.3, look: 2.0, frameH: 4.6 };
}

export class SwarmCount extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.flies = [];
    this.shownRound = -1;
    this.shownPhase = "";
    this.countUpUntil = 0;
    this.lastSentGuess = null;
    this.sendTimer = 0;
    this.reacted = new Map();
    this.labelY = 0.74;
    this.swarmCentre = new THREE.Vector3(0, 2.6, -0.4);
  }

  stage() {
    return {
      label: "3D Augenmaß",
      background: "#101a2c",
      fog: ["#16233b", 16, 46],
      lights: { sunPosition: [-4, 10, 6], shadow: { left: -6, right: 6, top: 8, bottom: -4 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="simon-round" data-swarm-round>Durchgang 1/4</div>
      <div class="simon-chips" data-swarm-chips></div>
      <div class="color-banner" data-swarm-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.5, 60),
      new THREE.MeshLambertMaterial({ color: "#1c3324" })
    );
    meadow.position.set(0, -0.25, -12);
    meadow.receiveShadow = true;
    scene.add(meadow);

    // Die Szene war ein Nachthimmel ohne alles: flaches Marineblau über
    // flachem Dunkelgrün, dazwischen eine harte Kante. Ein Mond, ein
    // Baumsaum und Sterne geben dem Blau einen Ort — und dem Zählen einen
    // ruhigen Hintergrund, vor dem die Käfer wirklich leuchten.
    const mond = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 24),
      new THREE.MeshBasicMaterial({ color: "#f3f0d8", fog: false })
    );
    mond.position.set(-5.5, 8.2, -24);
    scene.add(mond);
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
    scene.add(hof);

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
    scene.add(sterne);

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
    scene.add(saum);

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
      scene.add(mesh);
      this.flies.push({ mesh, home: new THREE.Vector3(), drift: 0, speed: 1, lit: 0 });
    }

    // Ein Baumstamm, auf dem alle sitzen.
    const players = this.getState()?.players || [];
    const count = Math.max(1, players.length);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, count * 0.95 + 0.8, 10), new THREE.MeshLambertMaterial({ color: "#6b4a2c" }));
    log.rotation.z = Math.PI / 2;
    log.position.set(0, 0.24, LOG_Z);
    log.castShadow = true;
    scene.add(log);
    // Ein kleines Lagerfeuer-Licht, damit man die Figuren in der Nacht sieht.
    const glow = new THREE.PointLight(0xffc27a, 3.2, 7, 2);
    glow.position.set(0.4, 1.4, LOG_Z + 1.4);
    scene.add(glow);
    players.forEach((player, index) => {
      const x = (index - (count - 1) / 2) * 0.95;
      this.addKin(player, index, { x, ground: LOG_TOP - 0.13, z: LOG_Z, facing: Math.PI });
    });
  }

  layoutSwarm(round) {
    const random = seededRandom(round.index * 977 + round.count * 31 + 7);
    const shape = swarmShape();
    this.swarmCentre.set(0, shape.base + shape.height / 2, -0.4);
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
        shape.base + random() * shape.height,
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

  shot() {
    const shape = swarmShape();
    return {
      look: [0, shape.look, 0.6],
      frame: { w: SPAWN_RADIUS * 2 + 0.8, h: shape.frameH },
      yaw: 0.28,
      pitch: 0.06,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.3 }
    };
  }

  bind() {
    this.buildControls();
  }

  unbind() {
    this.flies.length = 0;
  }

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

    this.on(this.slider, "input", this.onSlide);
    this.on(this.slider, "change", this.onSlideEnd);
    this.on(this.slider, "pointerup", this.onSlideEnd);
  }

  pushGuess(value) {
    if (this.lastSentGuess === value) return;
    this.lastSentGuess = value;
    this.feedback?.sound("step");
    this.sendInput({ action: "guess", value }).catch(() => {});
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
      // Die Reaktion übernimmt tick() — für alle, nicht nur die eigene Figur.
    }
  }

  celebrate(result, round) {
    const at = this.swarmCentre.clone().setZ(0);
    if (result.error === 0) {
      this.burst(at, ["#ffe36b", "#ffffff"], { count: Math.round(20 * fxScale()), speed: 2.4, up: 2.0, size: 0.08, life: 0.8, drag: 1.6 });
      this.pop(at, "GENAU!", { color: "#ffe36b", size: 0.46, life: 1.0 });
      this.rig.shake(0.6);
      this.feedback?.sound("win");
    } else if (result.points > 0) {
      this.pop(at, `+${result.points}`, { color: "#c6ffb0", size: 0.38, life: 0.9 });
      this.feedback?.sound("coin");
    } else {
      this.pop(at, `${result.guess} statt ${round.count}`, { color: "#ff9aa8", size: 0.34, life: 0.9 });
      this.feedback?.sound("error");
    }
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

  tick(f) {
    const { now, dt, arcade, players, finale } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const active = this.activeRound();
    this.syncPhase(active, own, now);
    this.syncSwarm(active, dt, now);
    const swarmCentre = this.swarmCentre;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const revealing = active?.phase === "reveal";
      const key = active ? active.round.index : -1;
      if (revealing && this.reacted.get(player.id) !== key) {
        this.reacted.set(player.id, key);
        const mine = (entry.guesses || []).find((guess) => guess.round === active.round.index);
        if (mine?.error === 0) {
          animator.trigger("celebrate");
          animator.expression("joy", 1500);
        } else if (mine?.points > 0) {
          animator.trigger("clap");
          animator.expression("happy", 1200);
        } else {
          animator.trigger("facepalm");
          animator.expression("sad", 1400);
        }
        if (player.id === f.controlledId && mine) this.celebrate(mine, active.round);
      }
      if (finale) return;
      // Beim Auflösen zur Kamera gedreht, sonst zum Schwarm.
      const face = revealing ? 0.2 : Math.PI;
      kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(0.12, dt);
      animator.lookAt(revealing ? null : swarmCentre);
      animator.set("sit");
      if (active?.phase === "guess") animator.expression("focus", 150);
    });
  }

  keepInView(f) {
    return f.players.map((player) => this.kins.get(player.id)).filter(Boolean);
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    const active = this.activeRound();
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.round(own?.score || 0));
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
    // Der Regler zeigt bei der Auflösung die Zahl, die GEWERTET wurde. Wer im
    // letzten Moment noch zog, sah sonst eine andere Zahl als im Banner.
    if (mine && this.slider && this.valueLabel && this.valueLabel.textContent !== String(mine.guess)) {
      this.slider.value = String(mine.guess);
      this.valueLabel.textContent = String(mine.guess);
    }
    banner.hidden = false;
    banner.textContent = mine
      ? `Es waren ${active.round.count} — du: ${mine.guess} (+${mine.points})`
      : `Es waren ${active.round.count}`;
    banner.style.background = mine && mine.error === 0 ? "#ffe36b" : "#9fc7ff";
    banner.style.color = "#152436";
  }
}
