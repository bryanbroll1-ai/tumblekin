import * as THREE from "/vendor/three/three.module.js";
import { createCloud, standOn } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameChance, frameLerp } from "./Quality.js?v=tumblekin200";

// Pump-Panik — EIN Knopf. Tippen pumpt den Ballon auf; wer kurz innehält,
// bindet ihn zu, er fliegt davon und seine Luft zählt. Jeder Ballon hat eine
// Platzgrenze: je näher man ihr kommt, desto röter wird er, zittert und
// quietscht — wer weiterpumpt, dem platzt er.
//
// Das Schönste daran ist, alle vier Ballons live wachsen zu sehen. Die Figur
// stampft dabei bei jedem Pumpen auf die Pumpe; eine Krone schwebt über dem
// Ballon, der gerade vorn liegt. Im Finale hebt der dickste Ballon seinen Kin
// ein Stück in die Luft — und platzt.
// Eng genug, dass vier Stationen auf ein hochkantes Handy passen, ohne dass
// die Figuren zu Punkten werden.
const STATION_GAP = 1.2;
// Grösser als vorher (1.6): der Ballon IST die Anzeige, und bei 35 Pumps sah
// man den Unterschied zwischen erstem und letztem Platz kaum.
const BALLOON_MIN = 0.42;
const BALLOON_STEP = 0.07;  // so viel grösser je Pumpstoss
const DECK_Y = 0.3;
const _red = new THREE.Color("#ff2a3a");

export class BalloonPump extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stations = new Map();
    this.localAir = 0;         // eigene Stösse, bevor der Server sie bestätigt
    this.localIndex = 0;
    this.localLastPump = 0;
    this.leaderId = null;
    this.flyers = [];
  }

  stage() {
    return { label: "3D Pump-Panik", background: "#8fd6f2", fog: ["#a9e1f5", 22, 48] };
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 20), new THREE.MeshLambertMaterial({ color: "#7fce6f" }));
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    dressMeadow(scene, {
      seed: 6, keepOut: { x: 4.8, z: 3.4 }, spread: { x: 17, z: 15 },
      grassColor: "#7ec96a", patchColors: ["#8ed477", "#a7e08c"],
      crownColor: "#3fa05a", crownColor2: "#5cb96f", crownShape: "palm", trunkColor: "#94693c"
    });

    // Holzbühne mit Planken und einem Rand — eine Jahrmarktbühne, keine Platte.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7.2, DECK_Y, 3.2), new THREE.MeshLambertMaterial({ color: "#c98d4e" }));
    deck.position.y = DECK_Y / 2;
    deck.receiveShadow = true;
    deck.castShadow = true;
    scene.add(deck);
    const plank = new THREE.MeshLambertMaterial({ color: "#b67a3f" });
    for (let i = 0; i < 9; i += 1) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 3.1), plank);
      line.position.set(-3.2 + i * 0.8, DECK_Y + 0.005, 0);
      scene.add(line);
    }
    const trim = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.12, 0.16), new THREE.MeshLambertMaterial({ color: "#ff5d73" }));
    trim.position.set(0, DECK_Y - 0.02, 1.62);
    scene.add(trim);

    // Wimpelleine hinter der Bühne.
    const flagColors = ["#ff5d73", "#ffd15c", "#28c7d9", "#71d97b", "#b98cff"];
    this.flags = [];
    for (let i = 0; i < 17; i += 1) {
      const t = i / 16;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.32, 3), new THREE.MeshLambertMaterial({ color: flagColors[i % 5] }));
      flag.rotation.x = Math.PI;
      flag.position.set(-4 + t * 8, 4.1 - Math.sin(t * Math.PI) * 0.5, -1.8);
      flag.userData.phase = i * 0.6;
      scene.add(flag);
      this.flags.push(flag);
    }
    [-4.1, 4.1].forEach((x) => {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.4, 0.14), new THREE.MeshLambertMaterial({ color: "#f4efe4" }));
      pole.position.set(x, 2.2, -1.8);
      pole.castShadow = true;
      scene.add(pole);
    });

    [[-7, 5.6, -6, 5], [7, 6.4, -4, 6], [0, 7, -9, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Die Krone über dem führenden Ballon.
    this.crown = buildCrown();
    this.crown.visible = false;
    scene.add(this.crown);

    const players = this.getState()?.players || [];
    players.forEach((player, index) => this.ensureStation(player, index, players.length));
  }

  shot() {
    return { look: [0, 2.2, 0], frame: { w: 5.2, h: 4.6 }, pitch: 0.16, fov: 36, intro: { yaw: -0.6, pitch: 0.3, zoom: 1.6 } };
  }

  hudHtml() {
    return `<div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>`;
  }

  bind() {
    this.controls.innerHTML = `
      <div class="pump-single">
        <button type="button" class="pump-button" data-pump>
          <span class="pump-tie" data-pump-tie></span>
          <span class="pump-button-face">PUMPEN</span>
        </button>
        <p class="pump-hint">Tippen = pumpen · kurz warten = zubinden</p>
      </div>`;
    this.pumpButton = this.controls.querySelector("[data-pump]");
    this.tieRing = this.controls.querySelector("[data-pump-tie]");
    this.hintNode = this.controls.querySelector(".pump-hint");
    this.on(this.pumpButton, "pointerdown", (event) => {
      event.preventDefault();
      this.pressPump();
    });
  }

  pressPump() {
    const minigame = this.update || this.minigame;
    if (!minigame || minigame.finaleAt || this.now() < minigame.startedAt) return;
    const own = minigame.arcade?.players?.[this.getControlledPlayerId()];
    if (own && this.now() < (own.readyAt || 0)) return;   // der neue Ballon hängt noch nicht
    if (own && own.balloonIndex !== this.localIndex) {
      this.localIndex = own.balloonIndex;
      this.localAir = 0;
    }
    this.localAir += 1;
    this.localLastPump = this.now();
    const share = own ? this.localAir / Math.max(1, this.limitFor(minigame.arcade, own.balloonIndex)) : 0;
    // Je enger es wird, desto höher und gequetschter der Ton.
    this.feedback?.sound(share >= 0.65 ? "plink" : "pop");
    this.feedback?.vibrate(share >= 0.85 ? 14 : 6);
    // Die eigene Figur reagiert sofort, nicht erst mit der Antwort des Servers.
    this.stationPumped(this.getControlledPlayerId());
    this.sendInput({ action: "pump" }).catch(() => {});
  }

  limitFor(arcade, index) {
    const limits = arcade?.limits || [];
    return limits.length ? limits[index % limits.length] : 20;
  }

  stationX(index, count) {
    return (index - (count - 1) / 2) * STATION_GAP;
  }

  ensureStation(player, index, count) {
    if (this.stations.has(player.id)) return this.stations.get(player.id);
    const x = this.stationX(index, count);
    const kinZ = 0.35;

    // Kolbenpumpe VOR der Figur: sie drückt den T-Griff mit beiden Händen
    // herunter — genau die Bewegung der Pump-Pose.
    const red = new THREE.MeshLambertMaterial({ color: "#e04a58" });
    const dark = new THREE.MeshLambertMaterial({ color: "#40506a" });
    const pump = new THREE.Group();
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.26), dark);
    foot.position.y = 0.03;
    pump.add(foot);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.13), red);
    barrel.position.y = 0.16;
    barrel.castShadow = true;
    pump.add(barrel);
    const plunger = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), dark);
    rod.position.y = -0.08;
    plunger.add(rod);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.06), dark);
    plunger.add(handle);
    plunger.position.y = 0.34;
    pump.add(plunger);
    pump.position.set(x, DECK_Y, kinZ + 0.42);
    this.scene.add(pump);

    // Schlauch um die Figur herum zum Ballonpflock dahinter.
    const peg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), dark);
    peg.position.set(x + 0.32, DECK_Y + 0.2, -0.28);
    this.scene.add(peg);
    const hoseMat = new THREE.MeshLambertMaterial({ color: "#6b7b94" });
    const hoseA = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.7), hoseMat);
    hoseA.position.set(x + 0.3, DECK_Y + 0.03, kinZ + 0.03);
    this.scene.add(hoseA);

    const balloon = buildBalloon(player.color);
    const balloonMat = balloon.userData.material;
    // Abwechselnd höher und weiter hinten: grosse Ballons stehen wie ein
    // Strauss gestaffelt, statt sich gegenseitig zu verdecken.
    const back = index % 2 === 1;
    balloon.userData.baseY = back ? 2.9 : 2.1;
    balloon.userData.baseZ = back ? -0.9 : -0.3;
    balloon.position.set(x, balloon.userData.baseY, balloon.userData.baseZ);
    balloon.scale.setScalar(0.42);
    this.scene.add(balloon);
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1, 0.025), new THREE.MeshLambertMaterial({ color: "#5a4a3a" }));
    this.scene.add(string);

    this.addKin(player, index, { x, ground: DECK_Y, z: kinZ });
    const station = {
      pump, plunger, balloon, string, peg, x, pulse: 0, lastPumps: 0, lift: 0,
      mat: balloonMat, baseColor: new THREE.Color(player.color), tint: new THREE.Color(player.color)
    };
    this.stations.set(player.id, station);
    return station;
  }

  stationPumped(playerId) {
    const station = this.stations.get(playerId);
    const animator = this.animators.get(playerId);
    if (!station || !animator) return;
    station.pulse = 1;
    station.plunger.position.y = 0.2;
    animator.trigger("pump");
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;

    let best = -1;
    let leader = null;
    players.forEach((player) => {
      const banked = arcade.players[player.id]?.banked || 0;
      if (banked > best) { best = banked; leader = player.id; }
      else if (banked === best) leader = null;
    });

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      if (!entry) return;
      const station = this.ensureStation(player, index, players.length);
      const animator = this.animators.get(player.id);
      const kin = this.kins.get(player.id);
      const mine = player.id === controlledId;
      const pumps = entry.pumps || 0;
      if (pumps > station.lastPumps) {
        if (!mine) this.stationPumped(player.id);
        station.lastPumps = pumps;
      }
      // Die Luft im aktuellen Ballon; die eigene sofort, nicht erst nach der
      // Antwort des Servers.
      if (mine && entry.balloonIndex !== this.localIndex) {
        this.localIndex = entry.balloonIndex;
        this.localAir = 0;
      }
      const air = mine ? Math.max(entry.balloon || 0, this.localAir) : (entry.balloon || 0);
      const limit = this.limitFor(arcade, entry.balloonIndex || 0);
      const share = air / Math.max(1, limit);
      this.reactToBalloon(player, entry, station, mine, now);
      station.pulse *= Math.pow(0.001, dt);
      station.plunger.position.y += (0.34 - station.plunger.position.y) * frameLerp(0.22, dt);

      // Grösse nach Luft; ab zwei Dritteln der Grenze wird es rot, zittert und
      // spannt — man SIEHT die Gefahr kommen, ohne die Zahl zu kennen.
      const size = BALLOON_MIN + air * BALLOON_STEP;
      const danger = Math.max(0, (share - 0.65) / 0.35);
      station.tint.copy(station.baseColor).lerp(_red, Math.min(1, danger) * 0.85);
      station.mat.color.copy(station.tint);
      station.mat.emissive?.copy(station.tint).multiplyScalar(danger * 0.25);
      const shake = danger > 0 ? Math.sin(now / (danger > 0.55 ? 22 : 45)) * 0.05 * danger : 0;
      const wobble = 1 + station.pulse * 0.14 + Math.sin(now / 300 + index) * 0.012 + shake;
      station.balloon.visible = !station.swapping || now > station.swapUntil;
      let balloonScale = size;
      station.balloon.position.x = station.x + shake * 0.6;
      if (finale && !station.popped) {
        const place = f.places?.[player.id];
        const since = Math.max(0, now - (f.minigame.finaleAt - 2600));
        if (place === 1) {
          // Überblasen, hochheben — und PENG.
          // Der Sieger bekommt einen grossen Ballon, auch wenn sein letzter
          // gerade zugebunden davongeflogen ist.
          balloonScale = Math.max(size, 1.4) * (1 + Math.min(0.9, since / 1100)) + Math.sin(now / 55) * 0.03;
          station.lift = Math.min(1.1, since / 900);
          if (since > 1250) this.popBalloon(player, station, mine);
          station.balloon.position.x = station.x;
        } else {
          station.deflate = station.deflate ?? size;
          balloonScale = Math.max(0.12, station.deflate * Math.max(0.12, 1 - since / 1500));
          station.balloon.position.x = station.x + Math.sin(now / 80 + index) * Math.min(0.35, since / 1300);
          if (since < 1500 && Math.random() < frameChance(0.3, dt)) {
            this.burst(station.balloon.position.clone(), ["#ffffff"], { count: 1, speed: 0.8, up: 0.3, size: 0.04, life: 0.3 });
          }
        }
      }
      station.balloon.scale.set(balloonScale * wobble, balloonScale * (1 + station.pulse * 0.2), balloonScale * wobble);
      const floatY = station.balloon.userData.baseY + balloonScale * 0.42 + Math.sin(now / 700 + index * 1.7) * 0.06 + station.lift * 1.2;
      station.balloon.position.z = station.balloon.userData.baseZ;
      station.balloon.position.y = floatY;
      station.balloon.rotation.z = Math.sin(now / 900 + index) * 0.06;

      // Der Sieger hängt am Ballon und wird mit hochgezogen.
      const kinGround = DECK_Y + (station.popped ? 0 : station.lift * 1.2);
      this.setGround(player.id, kinGround);
      if (station.lift > 0 && !station.popped) animator.set("hang");
      else if (!finale) animator.set(pumps > 0 && now - (station.lastAt || 0) < 400 ? "focus" : "idle");
      if (!finale && danger > 0.5) animator.expression("scared", 150);
      if (pumps !== station.seen) { station.seen = pumps; station.lastAt = now; }

      const balloonBottom = station.balloon.position.y - balloonScale * 0.45;
      const lifted = station.lift > 0 && !station.popped;
      const anchorY = lifted ? kin.position.y + 0.3 : DECK_Y + 0.4;
      const anchorX = lifted ? kin.position.x : station.x + 0.32;
      const anchorZ = lifted ? kin.position.z : -0.28;
      station.string.visible = station.balloon.visible;
      station.string.scale.y = Math.max(0.2, balloonBottom - anchorY);
      station.string.position.set((station.balloon.position.x + anchorX) / 2, (balloonBottom + anchorY) / 2, (station.balloon.position.z + anchorZ) / 2);
      station.string.rotation.z = Math.atan2(anchorX - station.balloon.position.x, balloonBottom - anchorY) * 0.9;

      // Der Ballon hängt hinter der Figur. Beim Pumpen geht nur der Blick nach
      // oben — das Gesicht bleibt zur Kamera, sonst sähe man nur Hinterköpfe.
      animator.look(finale ? null : (now - (station.lastAt || 0) < 400 ? 0 : null), 0.7);
    });

    // Krone über dem Führenden (nur wenn einer allein vorn liegt).
    if (leader && !finale && best > 0) {
      const station = this.stations.get(leader);
      this.crown.visible = true;
      const target = station.balloon.position.clone();
      target.y += station.balloon.scale.y * 0.62 + 0.25;
      this.crown.position.lerp(target, this.leaderId === leader ? frameLerp(0.3, dt) : 1);
      this.crown.rotation.y = now / 600;
      if (this.leaderId !== leader && this.leaderId !== null && leader === controlledId) this.feedback?.sound("select");
    } else {
      this.crown.visible = false;
    }
    this.leaderId = leader;

    this.flags.forEach((flag) => { flag.rotation.z = Math.sin(now / 320 + flag.userData.phase) * 0.18; });
    this.updateFlyers(now, dt);
  }

  // Zugebunden oder geplatzt: der Server sagt es, das Bild zeigt es.
  reactToBalloon(player, entry, station, mine, now) {
    if (entry.lastTie && entry.lastTie.at !== station.tieAt) {
      const first = station.tieAt === undefined && now - entry.lastTie.at > 1500;
      station.tieAt = entry.lastTie.at;
      if (!first) {
        // Ein Abbild steigt davon, der Pflock bekommt einen neuen Ballon.
        const flyer = station.balloon.clone();
        flyer.traverse((part) => { if (part.isMesh) part.material = part.material.clone(); });
        this.scene.add(flyer);
        this.flyers.push({ mesh: flyer, at: now, vx: (Math.random() - 0.5) * 0.6 });
        station.swapping = true;
        station.swapUntil = now + 350;
        const at = station.balloon.position.clone().add(new THREE.Vector3(0, 0.6, 0));
        const bonus = entry.lastTie.bonus ? ` · MUT +${entry.lastTie.bonus}` : "";
        this.pop(at, `+${entry.lastTie.air}${bonus}`, { color: entry.lastTie.bonus ? "#ffe36b" : player.color, size: mine ? 0.42 : 0.28, life: 0.9 });
        this.burst(at, [player.color, "#ffffff", "#ffe36b"], { count: entry.lastTie.bonus ? 18 : 8, speed: 1.4, up: 1.2, size: 0.07, life: 0.6 });
        if (mine) {
          this.feedback?.sound(entry.lastTie.bonus ? "perfect" : "coin");
          this.feedback?.vibrate(entry.lastTie.bonus ? [10, 14, 18] : 10);
        }
      }
    }
    if (entry.lastBurst && entry.lastBurst.at !== station.burstAt) {
      const first = station.burstAt === undefined && now - entry.lastBurst.at > 1500;
      station.burstAt = entry.lastBurst.at;
      if (!first) {
        const at = station.balloon.position.clone();
        this.burst(at, [player.color, "#ff2a3a", "#ffffff"], { count: 26, speed: 3.6, up: 2.2, size: 0.1, life: 0.8, drag: 1.2 });
        this.bursts.ring(at, "#ffffff", { radius: 1.8, life: 0.4, opacity: 0.6, tilt: null });
        this.pop(at.clone().add(new THREE.Vector3(0, 0.4, 0)), mine ? `PENG! −${entry.lastBurst.air}` : "PENG!", { color: "#ff6b7f", size: mine ? 0.5 : 0.32, life: 0.9 });
        this.animators.get(player.id)?.trigger("flinch");
        this.animators.get(player.id)?.expression("surprised", 900);
        station.swapping = true;
        station.swapUntil = now + 350;
        if (mine) {
          this.rig.shake(0.7);
          this.feedback?.sound("impact");
          this.feedback?.vibrate([30, 20, 40]);
        }
      }
    }
  }

  updateFlyers(now, dt) {
    this.flyers = this.flyers.filter((flyer) => {
      const age = (now - flyer.at) / 1000;
      flyer.mesh.position.y += dt * (1.6 + age * 1.5);
      flyer.mesh.position.x += flyer.vx * dt;
      flyer.mesh.rotation.z = Math.sin(age * 4) * 0.2;
      if (age > 2.2) {
        this.scene.remove(flyer.mesh);
        flyer.mesh.traverse((part) => { if (part.isMesh) part.material.dispose(); });
        return false;
      }
      return true;
    });
  }

  popBalloon(player, station, mine) {
    station.popped = true;
    station.balloon.visible = false;
    station.string.visible = false;
    const at = station.balloon.position.clone();
    this.burst(at, [player.color, "#ffffff"], { count: 30, speed: 4.2, up: 2.6, size: 0.12, life: 1.1, drag: 1.1 });
    this.burst(at, ["#ffd15c", player.color, "#ffffff"], { count: 20, speed: 2.5, up: 3.4, size: 0.09, life: 1.3, drag: 0.9 });
    this.bursts.ring(at, "#ffffff", { radius: 2.6, life: 0.55, opacity: 0.65, tilt: null });
    this.pop(at.clone().add(new THREE.Vector3(0, 0.5, 0)), "PENG! 🎈", { color: "#ffe36b", size: 0.55, life: 1.1 });
    this.animators.get(player.id)?.trigger("land");
    this.rig.shake(0.55);
    this.feedback?.sound("impact");
    this.feedback?.vibrate([40, 26, 50]);
    if (mine) this.feedback?.sound("win");
  }

  // Der Sieger hängt am Ballon: dort keine Siegerpose, das Hängen IST sie.
  finaleOverride(player, place) {
    const station = this.stations.get(player.id);
    return place === 1 && station && !station.popped && station.lift > 0;
  }

  drawHud(f) {
    const own = f.arcade?.players?.[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    if (this.scoreNode) this.scoreNode.textContent = String(own?.banked || 0);
    if (this.pumpButton) this.pumpButton.disabled = Boolean(f.minigame.finaleAt);
    // Was bei Schluss noch nicht zugebunden ist, zählt nicht — das muss man
    // vorher wissen, nicht auf der Ergebnistafel lernen.
    if (this.hintNode) {
      const hint = f.started && f.remaining <= 3 && !f.minigame.finaleAt
        ? "Letzte Sekunden — jetzt zubinden!"
        : "Tippen = pumpen · kurz warten = zubinden";
      if (this.hintNode.textContent !== hint) this.hintNode.textContent = hint;
      this.hintNode.classList.toggle("is-urgent", hint.startsWith("Letzte"));
    }
    // Der Zubinde-Ring läuft nach dem letzten Stoss voll: so sieht man, dass
    // Warten den Ballon sichert — und wie lange noch.
    if (this.tieRing && own) {
      const air = Math.max(own.balloon || 0, own.balloonIndex === this.localIndex ? this.localAir : 0);
      const last = Math.max(own.lastPumpAt || 0, this.localLastPump || 0);
      const tieMs = f.arcade.tieMs || 850;
      const t = air > 0 ? Math.min(1, (f.now - last) / tieMs) : 0;
      this.tieRing.style.setProperty("--tie", `${Math.round(t * 100)}%`);
      this.tieRing.hidden = !(air > 0 && t < 1);
    }
  }
}

// Ein Ballon aus Klötzen: dicker Kern, Wölbungen, Knoten.
function buildBalloon(color) {
  const balloon = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, emissive: "#000000" });
  balloon.userData.material = mat;
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.62), mat);
  core.castShadow = true;
  balloon.add(core);
  [[0.3, 0, 0], [-0.3, 0, 0], [0, 0, 0.3], [0, 0, -0.3]].forEach(([x, y, z]) => {
    const bulge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.34), mat);
    bulge.position.set(x, y + 0.03, z);
    balloon.add(bulge);
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), mat);
  top.position.y = 0.42;
  balloon.add(top);
  const shine = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.6 }));
  shine.position.set(-0.16, 0.22, 0.32);
  balloon.add(shine);
  const knot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), mat);
  knot.position.y = -0.44;
  balloon.add(knot);
  return balloon;
}

function buildCrown() {
  const crown = new THREE.Group();
  const gold = new THREE.MeshLambertMaterial({ color: "#ffd24a", emissive: "#a27511", emissiveIntensity: 0.35 });
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.36), gold);
  crown.add(band);
  [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]].forEach(([x, z]) => {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.08), gold);
    tip.position.set(x, 0.12, z);
    crown.add(tip);
  });
  const gem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: "#ff5d8f" }));
  gem.position.set(0, 0.02, 0.19);
  crown.add(gem);
  return crown;
}

export { standOn };
