import * as THREE from "/vendor/three/three.module.js";
import { reachArm } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, zaun, wimpel, heuballen, scheune, sonnenblumen, wolken, himmel, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Tauziehen auf dem Dorffest: zwei Teams am Seil, dazwischen die Schlammgrube.
// Die Seilmitte trägt ein rotes Band; wird es über die Kante der Grube auf
// eine Seite gezogen, landet das andere Team im Schlamm.
//
// Die Figuren hängen am Seil, nicht daneben: ihre Hände liegen jedes Bild auf
// dem Seil (afterAnimate), und das ganze Team rutscht mit, wenn das Seil
// rutscht. Wer vorn steht und verliert, steht plötzlich bis zu den Knien im
// Schlamm.
const LINE = 1.1;            // halbe Breite der Grube = Siegeslinie
const FRONT_GAP = 1.45;      // Band bis zur vordersten Figur
const SPACING = 0.82;        // Abstand im Team
const ROPE_Y = 0.5;
const MUD_TOP = 0.012;
const MUD_SINK = -0.2;

export class TugOfWar extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.pos = 0;
    this.lastServerAt = performance.now();
    this.jerk = new Map();
    this.seenTaps = new Map();
    this.seenSlips = new Map();
    this.seenSync = new Map();
    this.inMud = new Map();
    this.mudUntil = new Map();
    this.seenResults = 0;
    this.labelY = 0.8;
    this.bubbles = [];
  }

  stage() {
    return {
      label: "3D Tauziehen",
      background: "#8fd3f5",
      fog: ["#c9ecff", 22, 52],
      lights: { sunPosition: [-5, 11, 7], shadow: { left: -7, right: 7, top: 5, bottom: -4 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0 : 0</strong></div>
      <div class="tug-teams" data-tug-teams></div>
      <div class="color-banner" data-tug-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    himmel(scene, { oben: "#5fb8f5", unten: "#d4efff" });
    const arcade = this.minigame?.arcade;
    this.buildGround(scene);
    this.buildFair(scene);

    // Das Seil: ein gerades Mittelstück zwischen den Händen und zwei Enden,
    // die hinter dem letzten im Team auf den Boden fallen.
    const ropeMat = lambert("#d8b27a");
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8), ropeMat);
    this.rope.rotation.z = Math.PI / 2;
    this.rope.castShadow = true;
    scene.add(this.rope);
    this.tails = [0, 1].map(() => {
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 8), ropeMat);
      tail.castShadow = true;
      scene.add(tail);
      return tail;
    });
    // Rotes Band in der Seilmitte — das, worauf alle schauen.
    this.ribbon = new THREE.Group();
    kiste(this.ribbon, 0.12, 0.12, 0.12, "#ffffff", [0, 0, 0]);
    const band = kiste(this.ribbon, 0.2, 0.5, 0.03, "#ff3b52", [0, -0.3, 0], { schatten: false });
    band.material = new THREE.MeshLambertMaterial({ color: "#ff3b52", emissive: "#ff3b52", emissiveIntensity: 0.25 });
    this.ribbonBand = band;
    scene.add(this.ribbon);

    // Allein zieht ein Sandsack dagegen.
    const players = this.getState()?.players || [];
    this.sides = new Map();
    const teams = [[], []];
    players.forEach((player, index) => {
      const entry = arcade?.players?.[player.id];
      const side = entry?.side ?? index % 2;
      this.sides.set(player.id, { side, slot: teams[side].length });
      teams[side].push(player);
    });
    this.teams = teams;
    if (!teams[1].length) {
      this.sack = new THREE.Group();
      const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), lambert("#c7a26b"));
      body.scale.set(1, 1.2, 0.9);
      body.position.y = 0.36;
      body.castShadow = true;
      this.sack.add(body);
      kiste(this.sack, 0.16, 0.12, 0.16, "#8a6238", [0, 0.8, 0]);
      scene.add(this.sack);
    }
    players.forEach((player, index) => {
      const { side } = this.sides.get(player.id);
      const facing = side === 0 ? Math.PI / 2 - 0.32 : -(Math.PI / 2 - 0.32);
      this.addKin(player, index, { x: 0, ground: 0, z: 0, facing });
    });
  }

  buildGround(scene) {
    // Wiese links und rechts, dazwischen die Grube. Die Grube ist ein Kasten,
    // dessen Oberfläche knapp über der Wiese liegt: wer darin steht, wird um
    // MUD_SINK tiefer gestellt und steckt dann sichtbar bis zu den Knien drin.
    kiste(scene, 60, 0.5, 50, "#7fb06c", [0, -0.25, 0], { schatten: false });
    const mud = new THREE.Mesh(
      new THREE.BoxGeometry(LINE * 2, 0.5, 2.6),
      new THREE.MeshStandardMaterial({ color: "#6e4526", roughness: 0.35, metalness: 0.05 })
    );
    mud.position.set(0, MUD_TOP - 0.25, 0);
    mud.receiveShadow = true;
    scene.add(mud);
    // Glanzflecken auf dem Schlamm.
    const zufall = streuer(5);
    const flecken = [];
    for (let i = 0; i < 9; i += 1) {
      flecken.push({ p: [(zufall() - 0.5) * 1.8, MUD_TOP + 0.003, (zufall() - 0.5) * 2.2], r: [-Math.PI / 2, 0, zufall() * 3], s: [0.2 + zufall() * 0.35, 0.12 + zufall() * 0.2, 1] });
    }
    viele(scene, new THREE.CircleGeometry(1, 10), new THREE.MeshBasicMaterial({ color: "#8b5a34" }), flecken);
    // Bretter an den Kanten, weiss gestrichen: das ist die Linie.
    [-1, 1].forEach((seite) => {
      kiste(scene, 0.14, 0.14, 2.8, "#ffffff", [seite * (LINE + 0.07), 0.05, 0]);
      kiste(scene, 0.07, 0.02, 2.6, "#f4f4f4", [seite * (LINE + 0.3), 0.012, 0], { schatten: false });
    });
    [-1, 1].forEach((seite) => kiste(scene, LINE * 2 + 0.28, 0.12, 0.14, "#8a6238", [0, 0.04, seite * 1.34]));
    // Blasen im Schlamm — steigen auf und platzen.
    for (let i = 0; i < 6; i += 1) {
      const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: "#8a5a35", roughness: 0.2 }));
      bubble.position.set((zufall() - 0.5) * 1.7, MUD_TOP, (zufall() - 0.5) * 2);
      bubble.userData.phase = zufall() * 3;
      bubble.userData.rate = 0.5 + zufall() * 0.6;
      scene.add(bubble);
      this.bubbles.push(bubble);
    }
  }

  buildFair(scene) {
    dressMeadow(scene, {
      seed: 21,
      keepOut: { x: 5.8, z: 2.2 },
      spread: { x: 18, z: 15 },
      trees: 24,
      treeRing: { x: 16, z: 13 },
      grassColor: "#5fae4f",
      patchColors: ["#74a965", "#88b87a"],
      crownShape: "blob",
      crownColor: "#4a9c4e",
      crownColor2: "#79c05a",
      flowerColors: ["#ffd15c", "#ff8fb1", "#ffffff"]
    });
    // Hinten: Zaun, Heuballen, Scheune, Wimpelkette über der Grube.
    zaun(scene, [-9, -3.4], [9, -3.4]);
    heuballen(scene, [[-4.6, -2.5, 0.2], [-3.9, -2.8, -0.1], [-4.25, -2.65, 0.05, 1], [4.4, -2.6, 0.3], [5.1, -2.4, -0.2]]);
    scheune(scene, [-7.2, -7.5], { dreh: 0.35, groesse: 1.2 });
    [[-4.4, -1.9], [4.4, -1.9]].forEach(([x, z]) => kiste(scene, 0.1, 2.9, 0.1, "#8a6238", [x, 1.45, z]));
    wimpel(scene, [-4.4, 2.8, -1.9], [4.4, 2.8, -1.9], { anzahl: 22, durchhang: 0.5 });
    wimpel(scene, [-4.4, 2.8, -1.9], [-8, 2.2, -4], { anzahl: 8, durchhang: 0.25 });
    wimpel(scene, [4.4, 2.8, -1.9], [8, 2.2, -4], { anzahl: 8, durchhang: 0.25 });
    sonnenblumen(scene, [[6.2, -3.9, 1.3], [6.8, -3.7, 1.1], [7.4, -4, 1.4], [8, -3.8, 1.2], [-8.3, -3.9, 1.2]]);
    // Schiedsrichterschirm hinter der Grube.
    kiste(scene, 0.06, 1.9, 0.06, "#dddddd", [0, 0.95, -2.3]);
    const schirm = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.45, 8), lambert("#ff5d73"));
    schirm.position.set(0, 2.05, -2.3);
    scene.add(schirm);
    const schirm2 = new THREE.Mesh(new THREE.ConeGeometry(0.91, 0.45, 8, 1, true, 0, Math.PI / 4), lambert("#ffffff", { side: THREE.DoubleSide }));
    [0, 1, 2, 3].forEach((i) => {
      const s = schirm2.clone();
      s.position.set(0, 2.051, -2.3);
      s.rotation.y = (i * Math.PI) / 2;
      scene.add(s);
    });
    // Vorn: ein Eimer (zum Abwaschen) und eine Picknickdecke — niedrig, damit
    // nichts vor die Figuren gerät.
    const decke = kiste(scene, 1.6, 0.02, 1.1, "#ff7d8f", [-3.6, 0.01, 2.6], { schatten: false });
    decke.rotation.y = 0.25;
    kiste(scene, 1.62, 0.021, 0.14, "#ffffff", [-3.6, 0.012, 2.6], { schatten: false }).rotation.y = 0.25;
    kiste(scene, 0.4, 0.26, 0.3, "#b98a55", [-3.3, 0.14, 2.5]);
    const eimer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 10), lambert("#6d8fa8"));
    eimer.position.set(3.4, 0.17, 2.3);
    eimer.castShadow = true;
    scene.add(eimer);
    const wasser = new THREE.Mesh(new THREE.CircleGeometry(0.18, 10), lambert("#6cc6ff"));
    wasser.rotation.x = -Math.PI / 2;
    wasser.position.set(3.4, 0.3, 2.3);
    scene.add(wasser);
    wolken(scene, [[-7, 6.5, -12, 1.4], [5, 7.4, -14, 1.7], [11, 5.8, -10, 1.1], [-12, 7, -15, 1.3]]);

    // Vordergrund: auf dem hochkanten Handy liegt unter dem Seil viel Wiese
    // im Bild. Dort stehen jetzt ein Kürbisbeet, Hühner und ein Schild —
    // alles flach genug, dass es vor keiner Figur steht.
    const kuerbis = [[1.9, 3.3, 0.9], [2.4, 3.7, 1.1], [2.9, 3.2, 0.8], [2.2, 4.3, 1], [3.1, 4.0, 0.7]];
    viele(scene, new THREE.SphereGeometry(0.22, 10, 8), lambert("#ff9f2e"), kuerbis.map(([x, z, s]) => ({ p: [x, 0.16 * s, z], s: [s, s * 0.75, s] })), { schatten: true });
    viele(scene, new THREE.BoxGeometry(0.05, 0.12, 0.05), lambert("#5d8a3a"), kuerbis.map(([x, z, s]) => ({ p: [x, 0.33 * s, z] })));
    viele(scene, new THREE.BoxGeometry(0.3, 0.02, 0.22), lambert("#5aa04a"), kuerbis.map(([x, z], i) => ({ p: [x + 0.2, 0.012, z + 0.15], r: [0, i, 0] })));
    const schild = new THREE.Group();
    kiste(schild, 0.08, 0.7, 0.08, "#8a6238", [-0.35, 0.35, 0]);
    kiste(schild, 0.08, 0.7, 0.08, "#8a6238", [0.35, 0.35, 0]);
    const tafel = kiste(schild, 1.1, 0.42, 0.06, "#f2e4c4", [0, 0.62, 0.02]);
    tafel.material = new THREE.MeshLambertMaterial({ map: schildTextur("TAUZIEHEN") });
    schild.position.set(-1.7, 0, 3.7);
    schild.rotation.y = 0.3;
    scene.add(schild);
    this.chickens = [[-1.2, 4.2, 0.4], [-0.6, 4.7, 2.2], [0.5, 4.1, -0.8]].map(([x, z, dreh], i) => {
      const huhn = new THREE.Group();
      kiste(huhn, 0.24, 0.2, 0.3, "#ffffff", [0, 0.16, 0]);
      kiste(huhn, 0.08, 0.14, 0.1, "#ffffff", [0, 0.2, -0.17]);
      const kopf = new THREE.Group();
      kopf.position.set(0, 0.3, 0.14);
      kiste(kopf, 0.14, 0.14, 0.14, "#ffffff", [0, 0.06, 0.02]);
      kiste(kopf, 0.04, 0.08, 0.08, "#ff3b3b", [0, 0.16, 0.02], { schatten: false });
      kiste(kopf, 0.06, 0.04, 0.07, "#ffb020", [0, 0.05, 0.12], { schatten: false });
      huhn.add(kopf);
      kiste(huhn, 0.03, 0.08, 0.03, "#ffb020", [-0.06, 0.03, 0], { schatten: false });
      kiste(huhn, 0.03, 0.08, 0.03, "#ffb020", [0.06, 0.03, 0], { schatten: false });
      huhn.position.set(x, 0, z);
      huhn.rotation.y = dreh;
      huhn.userData = { kopf, phase: i * 1.7, x, z, dreh };
      scene.add(huhn);
      return huhn;
    });
  }

  shot() {
    return {
      look: [0, 0.55, 0.1],
      // Etwas Luft an den Seiten: wird ein Team weggezogen, rutscht der
      // Hinterste mit dem Seil nach aussen — bei 7.3 bis an den Bildrand.
      frame: { w: 7.9, h: 3.0 },
      yaw: 0.32,
      pitch: 0.42,
      fov: 36,
      intro: { yaw: 0.6, pitch: 0.25, zoom: 1.4 },
      finale: { pull: 0.7, zoom: 0.7, lift: 0.35, orbit: 0.12 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="tug-button" data-tug-pull>
        <span class="tug-label">ZIEH!</span>
        <span class="tug-grip" aria-hidden="true"><i data-tug-grip></i></span>
      </button>`;
    this.pullButton = this.controls.querySelector("[data-tug-pull]");
    this.gripBar = this.controls.querySelector("[data-tug-grip]");
    const press = (event) => {
      event.preventDefault();
      const minigame = this.update || this.minigame;
      if (!minigame || minigame.finaleAt) return;
      this.feedback?.vibrate(8);
      this.sendInput({ action: "pull" }).catch(() => {});
    };
    this.on(this.pullButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  onUpdate() {
    this.lastServerAt = performance.now();
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, minigame } = f;
    const state = arcade?.tug;
    if (!state) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const age = Math.min(0.15, (performance.now() - this.lastServerAt) / 1000);
    const pulling = state.phase === "pull" && elapsed >= state.leadMs;
    const target = pulling ? Math.max(-1, Math.min(1, state.pos + state.vel * age)) : state.pos;
    // Zwischen den Durchgängen läuft das Seil gemächlich zurück zur Mitte —
    // die Teams gehen zurück an ihre Plätze, statt zu springen.
    const catchUp = Math.abs(target - this.pos) > 0.5 ? 0.06 : 0.3;
    this.pos += (target - this.pos) * frameLerp(catchUp, dt);
    const flagX = this.pos * LINE;

    // Neue Rundenentscheidung: Banner, Konfetti, Wackeln.
    if ((state.results?.length || 0) > this.seenResults) {
      this.seenResults = state.results.length;
      const winner = state.lastWinner;
      const own = arcade.players[controlledId];
      if (winner !== null && winner !== undefined) {
        const at = new THREE.Vector3(winner === 0 ? -2.4 : 2.4, 1.8, 0);
        this.burst(at, ["#ffd15c", "#ffffff", "#ff5d73", "#28c7d9"], { count: 26, speed: 2.4, up: 2.6, size: 0.08, life: 1.2 });
        this.rig.shake(0.35);
        if (own) {
          const won = own.side === winner;
          this.feedback?.sound(won ? "win" : "fall");
          this.feedback?.vibrate(won ? [20, 30, 40] : 30);
        }
      }
    }

    // Seil und Band.
    const wobble = pulling ? Math.sin(now / 38) * 0.012 : 0;
    const reach = [0, 1].map((side) => FRONT_GAP + Math.max(0, this.teams[side].length - 1) * SPACING + 0.35);
    const left = flagX - reach[0];
    const right = flagX + (this.teams[1].length ? reach[1] : FRONT_GAP + 0.1);
    this.rope.position.set((left + right) / 2, ROPE_Y + wobble, 0);
    this.rope.scale.y = right - left;
    this.ribbon.position.set(flagX, ROPE_Y + wobble, 0);
    this.ribbonBand.rotation.z = Math.sin(now / 160) * 0.12 - (state.vel || 0) * 0.6;
    this.tails[0].position.set(left - 0.35, (ROPE_Y + 0.02) / 2, 0.05);
    this.tails[0].scale.y = Math.hypot(0.7, ROPE_Y);
    this.tails[0].rotation.z = -Math.atan2(0.7, ROPE_Y);
    this.tails[1].visible = this.teams[1].length > 0;
    this.tails[1].position.set(right + 0.35, (ROPE_Y + 0.02) / 2, 0.05);
    this.tails[1].scale.y = Math.hypot(0.7, ROPE_Y);
    this.tails[1].rotation.z = Math.atan2(0.7, ROPE_Y);
    if (this.sack) {
      const x = flagX + FRONT_GAP;
      this.sack.position.set(x, Math.abs(x) < LINE - 0.05 ? MUD_SINK : 0, 0);
      this.sack.rotation.z = -0.25 - (state.vel || 0) * 0.5;
    }

    // Hühner picken und trippeln ein wenig.
    this.chickens?.forEach((huhn) => {
      const u = now / 1000 + huhn.userData.phase;
      const pick = Math.max(0, Math.sin(u * 3.1)) ** 6;
      huhn.userData.kopf.rotation.x = pick * 1.1;
      huhn.rotation.y = huhn.userData.dreh + Math.sin(u * 0.4) * 0.8;
      huhn.position.x = huhn.userData.x + Math.sin(u * 0.23) * 0.4;
    });

    // Schlammblasen.
    this.bubbles.forEach((bubble) => {
      const u = ((now / 1000) * bubble.userData.rate + bubble.userData.phase) % 1.6;
      const grow = Math.min(1, u / 1.2);
      bubble.visible = u < 1.25;
      bubble.scale.setScalar(0.3 + grow * 0.9);
      bubble.position.y = MUD_TOP - 0.03 + grow * 0.04;
    });

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      const seat = this.sides.get(player.id);
      if (!entry || !kin || !animator || !seat) return;
      const dir = seat.side === 0 ? -1 : 1;
      const isOwn = player.id === controlledId;

      // Jeder Zug reisst die Figur kurz nach hinten.
      const taps = entry.taps || 0;
      if (taps > (this.seenTaps.get(player.id) ?? taps)) this.jerk.set(player.id, 0.13);
      this.seenTaps.set(player.id, taps);
      const jerk = (this.jerk.get(player.id) || 0) * Math.exp(-dt * 11);
      this.jerk.set(player.id, jerk);

      const x = flagX + dir * (FRONT_GAP + seat.slot * SPACING) + dir * jerk;
      const z = seat.slot % 2 ? -0.1 : 0.1;
      const mud = Math.abs(x) < LINE - 0.08;
      const wasMud = this.inMud.get(player.id) || false;
      if (mud && !wasMud) {
        this.burst(new THREE.Vector3(x, 0.2, z), ["#6e4526", "#8b5a34", "#4f3019"], { count: 18, speed: 1.8, up: 2.2, size: 0.08, life: 0.8 });
        animator.trigger("fall");
        animator.expression("scared", 1200);
        if (isOwn) {
          this.feedback?.sound("fall");
          this.feedback?.vibrate(40);
        }
      }
      this.inMud.set(player.id, mud);
      // Der Sturz beim Hineinrutschen läuft noch, wenn die Figur schon wieder
      // draussen ist — so lange liegt sie tiefer als der Boden. Das Merkmal
      // für den Szenenprüfer hält darum anderthalb Sekunden nach.
      if (mud) this.mudUntil.set(player.id, now + 1500);
      kin.userData.sunk = mud || now < (this.mudUntil.get(player.id) || 0);
      this.setGround(player.id, mud ? MUD_SINK : 0);
      kin.position.x = x;
      kin.position.z = z;

      // Abgerutscht.
      if ((entry.slips || 0) > (this.seenSlips.get(player.id) ?? entry.slips ?? 0)) {
        animator.trigger("stumble");
        animator.expression("surprised", 800);
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "Abgerutscht!", { color: "#ffb3bd", size: 0.3 });
        if (isOwn) {
          this.feedback?.sound("error");
          this.feedback?.vibrate([30, 30, 30]);
          this.rig.shake(0.25);
        }
      }
      this.seenSlips.set(player.id, entry.slips || 0);
      // Hau-Ruck: einmal je gemeinsamem Zug, über der Teammitte.
      const syncAt = entry.lastSyncAt || 0;
      // Höchstens alle 1,2 s je Team — sonst stapeln sich die Schriftzüge.
      if (syncAt > (this.seenSync.get(`side${seat.side}`) || 0) + 1200) {
        this.seenSync.set(`side${seat.side}`, syncAt);
        this.pop(new THREE.Vector3(flagX + dir * (FRONT_GAP + 0.4), 1.55, 0), "HAU-RUCK!", { color: "#ffe36b", size: 0.36 });
        if (arcade.players[controlledId]?.side === seat.side) this.feedback?.sound("combo");
      }

      if (f.finale) return;
      const slipping = now < (entry.slipUntil || 0);
      if (state.phase === "show" || state.phase === "over") {
        const won = state.lastWinner === seat.side;
        if (state.lastWinner === null || state.lastWinner === undefined) animator.set("shrug");
        else if (won) animator.set("cheer");
        else animator.set(mud ? "dizzy" : "sad");
      } else if (!pulling) {
        animator.set("ready");
      } else if (!slipping) {
        animator.set("pull");
        if (mud) animator.expression("scared", 300);
      }
    });
  }

  // Hände aufs Seil.
  afterAnimate(f) {
    const state = f.arcade?.tug;
    if (!state) return;
    this.kins.forEach((kin, id) => {
      const seat = this.sides.get(id);
      const animator = this.animators.get(id);
      if (!seat || !animator) return;
      const holding = ["pull", "ready", "stumble"].includes(animator.state) || animator.state === "idle";
      if (!holding || f.finale) return;
      const dir = seat.side === 0 ? -1 : 1;
      const toward = -dir;
      const x = kin.position.x;
      const y = ROPE_Y + (state.phase === "pull" ? Math.sin(f.now / 38) * 0.012 : 0);
      // Die Hand auf der Seilseite etwas weiter vorn als die andere.
      reachArm(kin, 0, new THREE.Vector3(x + toward * 0.3, y, 0), 0.95);
      reachArm(kin, 1, new THREE.Vector3(x + toward * 0.16, y, 0), 0.95);
    });
  }

  finaleOverride(player, place) {
    const animator = this.animators.get(player.id);
    if (!animator || !this.inMud.get(player.id)) return false;
    animator.set(place === 1 ? "cheer" : "dizzy");
    return true;
  }

  drawHud(f) {
    const { arcade, state: room, controlledId, minigame, now } = f;
    const state = arcade?.tug;
    if (!state) return;
    const own = arcade.players[controlledId];
    const ownSide = own?.side ?? 0;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    const wins = state.wins || [0, 0];
    const text = `${wins[ownSide]} : ${wins[1 - ownSide]}`;
    if (this.scoreNode.textContent !== text) this.scoreNode.textContent = text;

    const teamsNode = this.hud.querySelector("[data-tug-teams]");
    if (teamsNode) {
      const html = [0, 1].map((side) => {
        const members = room.players.filter((player) => arcade.players[player.id]?.side === side);
        const names = members.length
          ? members.map((player) => `<b style="--chip:${player.color}">${escapeName(player.name)}</b>`).join("")
          : "<b style=\"--chip:#c7a26b\">Sandsack</b>";
        const pips = [0, 1].map((i) => `<i class="${i < wins[side] ? "is-won" : ""}"></i>`).join("");
        return `<div class="tug-team${side === ownSide ? " is-own" : ""}">${names}<span class="tug-pips">${pips}</span></div>`;
      }).join("<span class=\"tug-vs\">vs</span>");
      if (html !== this.teamsHtml) {
        this.teamsHtml = html;
        teamsNode.innerHTML = html;
      }
    }

    const banner = this.hud.querySelector("[data-tug-banner]");
    const elapsed = now - minigame.startedAt;
    let message = null;
    let tone = "#12aaff";
    if (elapsed < state.leadMs) {
      message = "Seil packen …";
    } else if (state.phase === "pull" && elapsed - state.roundStartAt < 900) {
      message = `Runde ${state.round + 1} — ZIEHT!`;
      tone = "#1fbf5b";
    } else if (state.phase === "show" || state.phase === "over") {
      const winner = state.lastWinner;
      if (winner === null || winner === undefined) {
        message = "Unentschieden!";
      } else {
        const won = winner === ownSide;
        message = won ? "Runde gewonnen! 🎉" : "Ab in den Schlamm! 💩";
        tone = won ? "#ffc400" : "#8b5a34";
      }
    } else if (own && now < (own.slipUntil || 0)) {
      message = "Abgerutscht! Kurz durchatmen …";
      tone = "#ff5d73";
    }
    if (banner) {
      banner.hidden = !message;
      if (message && banner.textContent !== message) banner.textContent = message;
      banner.style.background = tone;
      banner.style.color = tone === "#ffc400" ? "#5c4508" : "#ffffff";
    }

    if (this.pullButton) {
      const grip = Math.max(0, Math.min(1, own?.grip ?? 1));
      this.gripBar.style.width = `${Math.round(grip * 100)}%`;
      this.pullButton.dataset.grip = grip < 0.25 ? "low" : grip < 0.55 ? "mid" : "high";
      this.pullButton.classList.toggle("is-slipping", Boolean(own && now < (own.slipUntil || 0)));
      this.pullButton.disabled = Boolean(minigame.finaleAt);
    }
  }
}

// Holzschild mit Aufschrift, als Canvas-Textur.
function schildTextur(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f2e4c4";
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = "#8a6238";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 88);
  ctx.fillStyle = "#c8413b";
  ctx.font = "900 40px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}

