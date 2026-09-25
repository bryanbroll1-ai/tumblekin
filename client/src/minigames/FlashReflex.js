import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin200";

// Blitzreflex: zwei rote Lampen, dann Grün — wer am schnellsten tippt, hat
// die beste Reaktionszeit. Drei Durchgänge.
//
// Vorher standen die Figuren reglos an einer Linie, und der einzige Hinweis
// auf die Spannung war, dass sie ein wenig gestaucht wurden. Jetzt ist es ein
// Sprintstart: bei Rot gehen alle in die Hocke, bei Grün schiessen sie los,
// wer zu früh tippt, fällt der Länge nach hin. Die Kamera steht seitlich an
// der Bahn, damit man Gesichter und Startampel zugleich sieht.
const LAMP_Y = 3.1;
const LAMP_Z = -4.2;
const LANE_GAP = 0.78;
const KIN_Z = 1.6;
const DASH = 1.15;
const DASH_MS = 650;

export class FlashReflex extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.lastCount = new Map();
    this.dash = new Map();
    this.greenSeen = -1;
    this.lampPulse = 0;
    this.labelY = 0.74;
  }

  stage() {
    return {
      label: "3D Blitzreflex",
      background: "#9fd9f0",
      fog: ["#c3e6f6", 16, 44],
      lights: { sunPosition: [-4, 11, 7], shadow: { left: -5, right: 5, top: 8, bottom: -3 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>—</strong></div>
      <div class="react-rounds" data-react-rounds></div>
      <div class="color-banner react-banner" data-react-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.5, 50),
      new THREE.MeshLambertMaterial({ color: "#5aa87f" })
    );
    ground.position.set(0, -0.25, -8);
    ground.receiveShadow = true;
    scene.add(ground);

    const track = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP * 4.6, 0.04, 30),
      new THREE.MeshLambertMaterial({ color: "#4b4f56" })
    );
    track.position.set(0, 0.01, -9);
    track.receiveShadow = true;
    scene.add(track);

    // Rot-weisse Randsteine links und rechts der Bahn. Als Instanzen: 96
    // einzelne Klötzchen wären 96 Zeichenaufrufe für reine Kulisse, und die
    // Bildrate auf dem Handy ist hier das eigentliche Spielgefühl.
    const bahnHalb = (LANE_GAP * 4.6) / 2;
    const steinGeo = new THREE.BoxGeometry(0.5, 0.06, 1.2);
    [["#e8384f", 0], ["#f2f2f2", 1]].forEach(([farbe, versatz]) => {
      const reihe = new THREE.InstancedMesh(
        steinGeo, new THREE.MeshLambertMaterial({ color: farbe }), 24
      );
      const platz = new THREE.Object3D();
      for (let i = 0; i < 24; i += 1) {
        const seite = i % 2 === 0 ? -1 : 1;
        platz.position.set(seite * (bahnHalb + 0.25), 0.03, 5 - (Math.floor(i / 2) * 2 + versatz) * 1.25);
        platz.updateMatrix();
        reihe.setMatrixAt(i, platz.matrix);
      }
      reihe.instanceMatrix.needsUpdate = true;
      scene.add(reihe);
    });

    // Startboxen auf dem Asphalt: weisse Kästen, einer je Bahn.
    for (let lane = 0; lane < 4; lane += 1) {
      const kasten = new THREE.Mesh(
        new THREE.BoxGeometry(LANE_GAP * 0.82, 0.02, 1.5),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.32, depthWrite: false })
      );
      kasten.position.set((lane - 1.5) * LANE_GAP, 0.045, KIN_Z - 0.1);
      scene.add(kasten);
    }

    // Streckenbegrenzung und Tribüne dahinter — die Kulisse, die dem Bild
    // seinen Ort gibt.
    // Tribüne nur auf der linken Seite: die Kamera steht rechts an der Bahn,
    // eine Tribüne dort stünde zwischen ihr und den Läufern.
    [-1].forEach((seite) => {
      const bande = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.9, 26),
        new THREE.MeshLambertMaterial({ color: "#e9edf2" })
      );
      bande.position.set(seite * (bahnHalb + 1.25), 0.45, -8);
      scene.add(bande);
      // Bandenwerbung: eine Instanz je Farbe statt neun Einzelmeshes.
      const tafelGeo = new THREE.BoxGeometry(0.34, 0.5, 2.4);
      ["#ff5d73", "#3fc5e8", "#ffd15c", "#71d97b"].forEach((farbe, f) => {
        const anzahl = Math.ceil((9 - f) / 4);
        const tafeln = new THREE.InstancedMesh(
          tafelGeo, new THREE.MeshLambertMaterial({ color: farbe }), anzahl
        );
        const platz = new THREE.Object3D();
        for (let k = 0; k < anzahl; k += 1) {
          platz.position.set(seite * (bahnHalb + 1.25), 0.52, 3 - (f + k * 4) * 2.8);
          platz.updateMatrix();
          tafeln.setMatrixAt(k, platz.matrix);
        }
        tafeln.instanceMatrix.needsUpdate = true;
        scene.add(tafeln);
      });
      // Tribüne: zwei Instanzen für vier Stufen.
      const rangGeo = new THREE.BoxGeometry(1.1, 0.5, 20);
      ["#8d97a8", "#7c869a"].forEach((farbe, f) => {
        const raenge = new THREE.InstancedMesh(rangGeo, new THREE.MeshLambertMaterial({ color: farbe }), 2);
        const platz = new THREE.Object3D();
        for (let k = 0; k < 2; k += 1) {
          const stufe = f + k * 2;
          platz.position.set(seite * (bahnHalb + 2.3 + stufe * 0.95), 0.25 + stufe * 0.5, -7);
          platz.updateMatrix();
          raenge.setMatrixAt(k, platz.matrix);
        }
        raenge.instanceMatrix.needsUpdate = true;
        scene.add(raenge);
      });
      const publikum = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.34, 0.42, 0.34),
        new THREE.MeshLambertMaterial({ color: "#ffffff" }),
        40
      );
      const kopf = new THREE.Object3D();
      for (let i = 0; i < 40; i += 1) {
        const stufe = i % 4;
        kopf.position.set(
          seite * (bahnHalb + 2.3 + stufe * 0.95),
          0.71 + stufe * 0.5,
          2 - Math.floor(i / 4) * 1.9
        );
        kopf.updateMatrix();
        publikum.setMatrixAt(i, kopf.matrix);
        // Bunte Zuschauer statt dunkler Klötze.
        publikum.setColorAt(i, new THREE.Color(["#ff8fa3", "#7fd6ea", "#ffe07a", "#9be38e", "#c7a6ff", "#ffb877"][(i * 7) % 6]));
      }
      publikum.instanceMatrix.needsUpdate = true;
      scene.add(publikum);
    });

    const line = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_GAP * 4.6, 0.02, 0.16),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false })
    );
    line.position.set(0, 0.04, KIN_Z + 0.5);
    scene.add(line);

    this.buildLamp();
    [[-6.2, 6.4, -7, 4], [6.0, 7.1, -6, 9]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * LANE_GAP;
      const kin = this.addKin(player, index, { x, ground: 0, z: KIN_Z, facing: Math.PI });
      kin.userData.laneX = x;
    });
  }

  buildLamp() {
    const steel = new THREE.MeshLambertMaterial({ color: "#37445a" });
    const dark = new THREE.MeshLambertMaterial({ color: "#1b232f" });

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, LAMP_Y - 0.9, 10), steel);
    mast.position.set(0, (LAMP_Y - 0.9) / 2, LAMP_Z);
    mast.castShadow = true;
    this.scene.add(mast);

    const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 0.4), dark);
    box.position.set(0, LAMP_Y, LAMP_Z - 0.1);
    box.castShadow = true;
    this.scene.add(box);

    this.lamps = [];
    for (let i = 0; i < 3; i += 1) {
      const lamp = new THREE.Mesh(
        new THREE.CircleGeometry(0.36, 22),
        new THREE.MeshBasicMaterial({ color: "#2a3340", toneMapped: false })
      );
      lamp.position.set(0, LAMP_Y + 0.85 - i * 0.85, LAMP_Z + 0.11);
      this.scene.add(lamp);
      this.lamps.push(lamp);
    }

    this.glow = new THREE.PointLight("#4dff7a", 0, 14);
    this.glow.position.set(0, LAMP_Y, LAMP_Z + 1.4);
    this.scene.add(this.glow);

    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.72, 26),
      new THREE.MeshBasicMaterial({ color: "#4dff7a", transparent: true, opacity: 0, depthWrite: false, toneMapped: false })
    );
    this.halo.position.set(0, LAMP_Y - 0.85, LAMP_Z + 0.12);
    this.scene.add(this.halo);
  }

  shot() {
    return {
      look: [0, 1.25, -0.4],
      frame: { w: 4.2, h: 3.9 },
      yaw: 0.62,
      pitch: 0.2,
      fov: 38,
      intro: { yaw: 0.4, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Tippe irgendwo, sobald es GRÜN wird</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      const minigame = this.update || this.minigame;
      if (!minigame || minigame.finaleAt) return;
      this.feedback?.sound("tap");
      this.sendInput({ action: "tap" }).catch(() => {});
    });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    const own = arcade.players[controlledId];
    const ownRound = own ? Math.min((own.times || []).length, arcade.rounds.length - 1) : 0;
    this.paintLamp(arcade.rounds[ownRound], elapsed, dt, own);

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const times = entry.times || [];
      const done = times.length >= arcade.rounds.length;
      const round = arcade.rounds[Math.min(times.length, arcade.rounds.length - 1)];
      const isOwn = player.id === controlledId;

      if (times.length > (this.lastCount.get(player.id) || 0)) {
        this.lastCount.set(player.id, times.length);
        const last = times[times.length - 1];
        const at = kin.position.clone().add(new THREE.Vector3(0, 1.1, 0));
        if (last >= 900) {
          // Fehlstart: der Länge nach hin.
          animator.trigger("fall");
          animator.expression("angry", 1200);
          this.burst(at, ["#ff6b7f", "#ffffff"], { count: 8 * fxScale(), speed: 1.4, up: 1.0, size: 0.06, life: 0.5, drag: 2.2 });
          if (isOwn) {
            this.pop(at, "FEHLSTART!", { color: "#ff9aa8", size: 0.38, life: 0.9 });
            this.feedback?.sound("error");
            this.feedback?.vibrate(26);
            this.rig.shake(0.4);
          }
        } else {
          this.dash.set(player.id, now);
          animator.expression(last < 260 ? "joy" : "happy", 900);
          this.burst(kin.position.clone().add(new THREE.Vector3(0, 0.1, 0.2)), ["#c9b79a", "#ffffff"], { count: 8, speed: 1.2, up: 0.6, size: 0.06, life: 0.4 });
          if (isOwn) {
            this.pop(at, `${last} ms`, { color: last < 260 ? "#ffe36b" : "#c6ffb0", size: last < 260 ? 0.42 : 0.34, life: 0.8 });
            this.feedback?.sound(last < 260 ? "perfect" : "pop");
            this.feedback?.vibrate([8, 10, 14]);
          }
        }
      }

      // Jeder Durchgang ein Stück weiter vorn; dazwischen ein Antritt.
      const dashAt = this.dash.get(player.id);
      const dashing = dashAt !== undefined && now - dashAt < DASH_MS;
      const goalZ = KIN_Z - times.length * DASH;
      kin.position.z += (goalZ - kin.position.z) * frameLerp(dashing ? 0.12 : 0.2, dt);
      kin.position.x = kin.userData.laneX;
      if (finale) {
        kin.rotation.y += Math.atan2(Math.sin(0.6 - kin.rotation.y), Math.cos(0.6 - kin.rotation.y)) * frameLerp(0.08, dt);
        return;
      }
      kin.rotation.y = Math.PI;
      const armed = round && !done && elapsed >= round.armFrom && elapsed < round.greenAt;
      if (dashing) animator.set("sprint");
      else if (done) animator.set(times.every((t) => t < 900) ? "happy" : "idle");
      else if (armed) {
        animator.set("charge", { params: { power: Math.min(1, (elapsed - round.armFrom) / 900) } });
      } else animator.set("ready");
    });
  }

  paintLamp(round, elapsed, dt, own) {
    if (!this.lamps) return;
    const done = own ? (own.times || []).length >= (this.update || this.minigame).arcade.rounds.length : false;
    const armed = Boolean(round) && elapsed >= round.armFrom && elapsed < round.greenAt;
    const green = Boolean(round) && elapsed >= round.greenAt && !done;

    // Die beiden oberen Lampen zeigen an, dass der Lauf scharf ist. Sie gehen
    // NACHEINANDER an — daran sieht man, dass gleich etwas passiert, ohne zu
    // wissen wann.
    const since = round ? elapsed - round.armFrom : -1;
    this.lamps[0].material.color.set(armed && since > 0 ? "#ff4f68" : "#2a3340");
    this.lamps[1].material.color.set(armed && since > 420 ? "#ff4f68" : "#2a3340");
    this.lamps[2].material.color.set(green ? "#4dff7a" : "#2a3340");

    if (green && round.index !== this.greenSeen) {
      this.greenSeen = round.index;
      this.lampPulse = 1;
      this.feedback?.sound("countdown");
    }
    this.lampPulse = Math.max(0, this.lampPulse - dt * 3);
    this.lamps[2].scale.setScalar(1 + this.lampPulse * 0.3);

    this.glow.intensity += ((green ? 13 : 0) - this.glow.intensity) * 0.45;
    this.halo.material.opacity += ((green ? 0.6 : 0) - this.halo.material.opacity) * 0.35;
    this.halo.scale.setScalar(1 + this.lampPulse * 0.4);
  }

  drawHud(f) {
    const { arcade, minigame, now, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    const elapsed = Math.max(0, now - minigame.startedAt);
    const times = own?.times || [];
    const round = arcade.rounds[Math.min(times.length, arcade.rounds.length - 1)];
    const best = times.length > 0 ? Math.min(...times) : null;
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = best === null ? "—" : `${best} ms`;
    const rounds = this.hud.querySelector("[data-react-rounds]");
    if (rounds) {
      rounds.innerHTML = arcade.rounds.map((_r, i) => {
        const value = times[i];
        const state2 = value === undefined ? "open" : (value >= 900 ? "bad" : "good");
        const text = value === undefined ? "–" : `${value}`;
        return `<span class="react-slot is-${state2}">${text}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-react-banner]");
    if (!banner) return;
    const done = times.length >= arcade.rounds.length;
    if (done) {
      banner.hidden = false;
      const total = times.reduce((sum, value) => sum + value, 0);
      banner.textContent = `Alle drei durch · ${total} ms gesamt`;
      banner.style.background = "#7fe06f";
      banner.style.color = "#14361a";
    } else if (round && elapsed >= round.greenAt) {
      banner.hidden = false;
      banner.textContent = "JETZT!";
      banner.style.background = "#4dff7a";
      banner.style.color = "#0d3218";
    } else if (round && elapsed >= round.armFrom) {
      banner.hidden = false;
      banner.textContent = "Achtung — noch nicht!";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else {
      banner.hidden = true;
    }
  }
}
