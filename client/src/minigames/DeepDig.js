import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { VirtualJoystick } from "./VirtualJoystick.js?v=tumblekin200";
import { frameChance, frameLerp, fxScale } from "./Quality.js?v=tumblekin200";

// Tiefenrausch: tauchen mit dem Stick. Gold liegt im ganzen Schacht, je tiefer
// desto wertvoller, ganz unten eine Truhe. Die Luft sinkt — unten schneller —,
// an der Oberfläche füllt sie sich und das getragene Gold ist eingezahlt.
// Quallen kosten Luft und etwas Gold; wem die Luft ausgeht, der wird
// ohnmächtig, verliert, was er trägt, und treibt nach oben.
//
// Die alte Fassung war ein Würfelspiel mit Spaten: Tippen grub, eine
// Zufallszahl entschied über den Einsturz. Jetzt steuert man selbst, sieht die
// Gefahr kommen und entscheidet mit Blick auf die Luftanzeige, wie gierig man
// ist. Alle tauchen im selben Schacht, man sieht die anderen um dieselbe
// Truhe schwimmen.
const S = 0.36;                  // Welteinheiten je Meter
const WALL = 1.2;                // Dicke der Felswände (Welt)
const SURFACE_COLOR = new THREE.Color("#63c7ec");
const DEEP_COLOR = new THREE.Color("#0c2748");
const _c = new THREE.Color();

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Muss der Serverfunktion diveJellyAt entsprechen.
function jellyAt(jelly, width, elapsedMs) {
  const t = elapsedMs / 1000;
  return {
    x: width / 2 + Math.sin(t * jelly.speed + jelly.phase) * jelly.span,
    y: jelly.y + Math.sin(t * 1.7 + jelly.phase * 2) * 0.6
  };
}

export class DeepDig extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.coinMeshes = new Map();
    this.jellyMeshes = [];
    this.seen = new Map();       // je Spieler: zuletzt gesehene Ereignisse
    this.labelY = 0.72;
  }

  stage() {
    return {
      label: "3D Tiefenrausch",
      background: "#63c7ec",
      fog: ["#63c7ec", 10, 30],
      lights: { sunPosition: [-3, 12, 8], sunIntensity: 2.0, hemiIntensity: 2.2 }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="dive-panel">
        <div class="dive-air" data-dive-air><span class="dive-air-label">LUFT</span><span class="dive-air-bar"><i data-dive-air-fill></i></span></div>
        <div class="dive-info"><span data-dive-depth>0 m</span><span data-dive-carried>🪙 0 dabei</span></div>
      </div>
      <div class="dig-chips" data-dig-chips></div>
      <div class="color-banner dig-banner" data-dig-banner hidden></div>`;
  }

  // Meter → Welt.
  wx(x) {
    return (x - this.width / 2) * S;
  }

  wy(depth) {
    return -depth * S;
  }

  build(f) {
    const scene = this.scene;
    const arcade = (this.update || this.minigame)?.arcade || {};
    this.width = arcade.width || 12;
    this.depth = arcade.depth || 48;
    const halfW = (this.width / 2) * S;
    const bottom = this.wy(this.depth);
    void f;

    // Rückwand: dunkelt nach unten ab, damit man die Tiefe sieht.
    const back = new THREE.PlaneGeometry(halfW * 2 + WALL * 2, -bottom + 2, 1, 24);
    const colors = [];
    const pos = back.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      const u = clamp((-(y + (bottom - 2) / 2)) / (-bottom), 0, 1);
      _c.copy(SURFACE_COLOR).lerp(DEEP_COLOR, u).multiplyScalar(0.8);
      colors.push(_c.r, _c.g, _c.b);
    }
    back.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const backMesh = new THREE.Mesh(back, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
    backMesh.position.set(0, (bottom - 2) / 2 + 1, -1.6);
    scene.add(backMesh);

    // Felswände links und rechts, gestuft wie Voxel, nach unten dunkler.
    const rockMat = (u) => new THREE.MeshLambertMaterial({ color: _c.set("#8a7a6a").lerp(new THREE.Color("#3b3430"), u).getHex() });
    for (let d = 0; d < this.depth + 2; d += 3) {
      const u = d / this.depth;
      [-1, 1].forEach((side) => {
        const bulge = 0.15 + ((d * 7 + (side > 0 ? 3 : 0)) % 5) * 0.08;
        const rock = new THREE.Mesh(new THREE.BoxGeometry(WALL + bulge, 3 * S + 0.02, 2.4), rockMat(u));
        rock.position.set(side * (halfW + WALL / 2 - bulge / 2 + 0.02), this.wy(d + 1.5), -0.4);
        scene.add(rock);
      });
    }
    // Grund: Sand, Steine, Seegras.
    const sand = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + WALL * 2, 0.5, 2.4), new THREE.MeshLambertMaterial({ color: "#c9a46a" }));
    sand.position.set(0, bottom - 0.25, -0.4);
    scene.add(sand);
    this.weeds = [];
    for (let i = 0; i < 9; i += 1) {
      const x = -halfW + 0.3 + (i / 8) * (halfW * 2 - 0.6);
      const weed = new THREE.Group();
      for (let k = 0; k < 4; k += 1) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.06), new THREE.MeshLambertMaterial({ color: k % 2 ? "#3fae62" : "#57c77a" }));
        leaf.position.y = 0.14 + k * 0.26;
        weed.add(leaf);
      }
      weed.position.set(x, bottom, -0.9 + (i % 3) * 0.2);
      weed.userData.phase = i * 1.3;
      scene.add(weed);
      this.weeds.push(weed);
    }

    // Wasseroberfläche von der Seite: ein heller Streifen, darüber Himmel und
    // ein Steg — dort landet das Gold.
    const surface = new THREE.Mesh(
      new THREE.BoxGeometry(halfW * 2 + WALL * 2 + 4, 0.08, 2.6),
      new THREE.MeshBasicMaterial({ color: "#bff0ff", transparent: true, opacity: 0.7, toneMapped: false, depthWrite: false })
    );
    surface.position.set(0, 0.02, -0.4);
    scene.add(surface);
    this.surface = surface;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshBasicMaterial({ color: "#9adcf2", toneMapped: false }));
    sky.position.set(0, 6.05, -1.7);
    scene.add(sky);
    const dock = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + WALL * 2 + 0.6, 0.16, 0.9), new THREE.MeshLambertMaterial({ color: "#a47449" }));
    dock.position.set(0, 0.34, -1.05);
    scene.add(dock);
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 0.14), new THREE.MeshLambertMaterial({ color: "#7d5536" }));
      post.position.set(side * (halfW + 0.5), -0.2, -1.05);
      scene.add(post);
    });
    // Die Schatzkiste auf dem Steg: hier klimpert es beim Einzahlen.
    const bank = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.36, 0.42), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
    box.position.y = 0.18;
    bank.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 0.46), new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#a8741a", emissiveIntensity: 0.3 }));
    lid.position.y = 0.42;
    bank.add(lid);
    bank.position.set(0, 0.42, -1.05);
    scene.add(bank);
    this.bank = bank;
    [[-4, 3.2, -6, 2], [3.6, 4.2, -7, 5]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Lichtstrahlen von oben — zart, nur in den oberen Metern.
    this.rays = [];
    for (let i = 0; i < 4; i += 1) {
      const ray = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5 + i * 0.12, 7),
        new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
      );
      ray.position.set(-halfW + 0.6 + i * (halfW * 0.6), -3.2, -1.2);
      ray.rotation.z = 0.18;
      scene.add(ray);
      this.rays.push(ray);
    }

    // Münzen und Truhe.
    const coinGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.06, 14);
    (arcade.coins || []).forEach((coin) => {
      let mesh;
      if (coin.chest) {
        mesh = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.42), new THREE.MeshLambertMaterial({ color: "#7a4c24" }));
        body.position.y = 0.2;
        mesh.add(body);
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.46), new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#c48a1a", emissiveIntensity: 0.5 }));
        top.position.y = 0.46;
        mesh.add(top);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
        glow.position.y = 0.3;
        mesh.add(glow);
      } else {
        // Tiefer = wertvoller = grösser und wärmer in der Farbe.
        const u = clamp(coin.y / this.depth, 0, 1);
        const color = u > 0.66 ? "#ff9d4d" : u > 0.33 ? "#ffc64a" : "#ffe36b";
        mesh = new THREE.Mesh(coinGeo, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
        mesh.rotation.x = Math.PI / 2;
        mesh.scale.setScalar(0.9 + u * 0.7);
      }
      mesh.position.set(this.wx(coin.x), this.wy(coin.y), 0);
      mesh.userData = { coin, base: mesh.position.y };
      scene.add(mesh);
      this.coinMeshes.set(coin.id, mesh);
    });

    // Quallen: halbe Kuppel, darunter wabernde Fäden.
    (arcade.jellies || []).forEach(() => {
      const jelly = new THREE.Group();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshLambertMaterial({ color: "#ff8fd0", emissive: "#e0409a", emissiveIntensity: 0.45, transparent: true, opacity: 0.82 })
      );
      jelly.add(dome);
      const tentacles = [];
      for (let k = 0; k < 5; k += 1) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.04), new THREE.MeshBasicMaterial({ color: "#ffc2e6", transparent: true, opacity: 0.8 }));
        t.position.set(-0.2 + k * 0.1, -0.22, 0);
        jelly.add(t);
        tentacles.push(t);
      }
      jelly.userData.tentacles = tentacles;
      jelly.userData.dome = dome;
      scene.add(jelly);
      this.jellyMeshes.push(jelly);
    });

    // Taucher: die Figuren mit Taucherglocke.
    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const entry = arcade.players?.[player.id];
      const kin = this.addKin(player, index, { x: this.wx(entry?.x ?? this.width / 2), ground: 0, z: 0.15, facing: 0, scale: 0.74 });
      const helmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 16, 12),
        new THREE.MeshLambertMaterial({ color: "#dff6ff", transparent: true, opacity: 0.28, depthWrite: false })
      );
      helmet.position.y = 0.66;
      kin.add(helmet);
    });
  }

  shot() {
    return {
      look: [0, -1.5, 0],
      frame: { w: (this.width || 12) * S + 1.4, h: 5.2 },
      yaw: 0,
      pitch: 0.05,
      fov: 38,
      intro: { yaw: 0.35, pitch: 0.15, zoom: 1.25 },
      finale: { pull: 0.9, zoom: 0.7, lift: 0.2, orbit: 0.08 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <div class="mobile-stick-controls joystick-only">
        <div class="joystick-slot"></div>
      </div>`;
    this.joystick = new VirtualJoystick({
      root: this.controls.querySelector(".joystick-slot"),
      label: "Tiefenrausch: tauchen",
      intervalMs: 70,
      feedback: this.feedback,
      onVector: (x, y) => this.sendInput({ action: "steer", x, y }).catch(() => {}),
      onEngage: () => this.feedback?.vibrate(8)
    });
  }

  unbind() {
    this.joystick?.destroy?.();
    this.joystick = null;
    this.coinMeshes.clear();
    this.jellyMeshes.length = 0;
  }

  // Die Kamera folgt der eigenen Figur in die Tiefe.
  rigOptions(f) {
    const own = f.arcade?.players?.[f.controlledId];
    if (!own) return {};
    const y = clamp(this.wy(own.y) - 0.6, this.wy(this.depth) + 2.2, -1.4);
    return { look: [0, y, 0] };
  }

  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    return own ? [own] : [];
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (!arcade?.coins) return;
    const elapsed = Math.max(0, now - (minigame?.startedAt || now));

    // Farbe des Wassers nach der Tiefe der Kamera.
    const own = arcade.players[controlledId];
    const camDepth = clamp((own?.y || 0) / this.depth, 0, 1);
    _c.copy(SURFACE_COLOR).lerp(DEEP_COLOR, camDepth);
    if (this.scene.background?.isColor) this.scene.background.copy(_c);
    if (this.scene.fog) this.scene.fog.color.copy(_c);
    this.rays.forEach((ray, i) => {
      ray.material.opacity = 0.07 + Math.sin(now / 900 + i * 1.7) * 0.03;
    });
    this.weeds?.forEach((weed) => { weed.rotation.z = Math.sin(now / 700 + weed.userData.phase) * 0.18; });
    this.surface.position.y = 0.02 + Math.sin(now / 500) * 0.02;

    // Münzen: drehen, wippen, verschwinden, wenn geholt.
    const serverNow = now;
    (arcade.coins || []).forEach((coin) => {
      const mesh = this.coinMeshes.get(coin.id);
      if (!mesh) return;
      const taken = coin.takenUntil && serverNow < coin.takenUntil;
      mesh.visible = !taken;
      if (taken) return;
      mesh.position.y = mesh.userData.base + Math.sin(now / 400 + coin.id) * 0.05;
      if (coin.chest) mesh.rotation.y = Math.sin(now / 800) * 0.3;
      else mesh.rotation.z = now / 300 + coin.id;
    });

    // Quallen: dieselbe Bahn wie auf dem Server.
    (arcade.jellies || []).forEach((jelly, i) => {
      const mesh = this.jellyMeshes[i];
      if (!mesh) return;
      const at = jellyAt(jelly, this.width, elapsed);
      mesh.position.set(this.wx(at.x), this.wy(at.y), 0.1);
      const pulse = Math.sin(now / 260 + i);
      mesh.userData.dome.scale.set(1 + pulse * 0.08, 1 - pulse * 0.1, 1 + pulse * 0.08);
      mesh.userData.tentacles.forEach((t, k) => { t.rotation.z = Math.sin(now / 200 + k + i) * 0.35; });
    });

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      const tx = this.wx(entry.x);
      const ty = this.wy(entry.y) - 0.3;
      kin.position.x += (tx - kin.position.x) * frameLerp(0.35, dt);
      kin.position.z = 0.15;
      animator.groundY = kin.position.y + (ty - kin.position.y) * frameLerp(0.35, dt);

      // Kopf voran in Schwimmrichtung; ohne Tempo aufrecht.
      const speed = Math.hypot(entry.vx || 0, entry.vy || 0);
      let wantZ = 0;
      if (entry.fainted) wantZ = Math.PI * 0.5;
      else if (speed > 1.2) wantZ = -Math.atan2(entry.vx || 0, -(entry.vy || 0));
      const diff = Math.atan2(Math.sin(wantZ - kin.rotation.z), Math.cos(wantZ - kin.rotation.z));
      if (!finale) kin.rotation.z += diff * frameLerp(0.15, dt);
      if (!finale) {
        if (entry.fainted) {
          animator.set("float");
          animator.expression("ko", 150);
        } else if (speed > 1.2) {
          animator.set("swim");
          animator.rate = 0.7 + speed / 7;
        } else {
          animator.set("float");
        }
        if (!entry.fainted && entry.o2 < 25 && entry.y > 1.5) animator.expression("scared", 150);
      }
      // Unverwundbar nach einem Stich: kurz blinken.
      kin.visible = !(now < (entry.safeUntil || 0) && !entry.fainted && Math.floor(now / 110) % 2 === 0);
      // Luftblasen, mehr wenn man hektisch ist.
      if (entry.y > 1.3 && Math.random() < frameChance(speed > 1.2 ? 2.2 : 0.9, dt)) {
        this.burst(new THREE.Vector3(kin.position.x, kin.position.y + 0.55, 0.3), ["#dff6ff", "#ffffff"], { count: 1, speed: 0.2, up: 1.2, size: 0.05, life: 0.9, gravity: -1.2, drag: 1.0 });
      }
      this.react(player, entry, kin, animator, isOwn, now);
    });
  }

  react(player, entry, kin, animator, isOwn, now) {
    const seen = this.seen.get(player.id) || {};
    const at = () => kin.position.clone().add(new THREE.Vector3(0, 0.9, 0.3));
    if (entry.lastPick && entry.lastPick.at !== seen.pick) {
      seen.pick = entry.lastPick.at;
      if (isOwn) {
        const mesh = this.coinMeshes.get(entry.lastPick.id);
        const p = mesh ? mesh.position.clone() : at();
        this.burst(p, ["#ffe36b", "#ffffff"], { count: Math.round((entry.lastPick.chest ? 30 : 10) * fxScale()), speed: 1.6, up: 1.2, size: 0.06, life: 0.5, gravity: 0 });
        this.pop(p.add(new THREE.Vector3(0, 0.4, 0)), entry.lastPick.chest ? `TRUHE! +${entry.lastPick.value}` : `+${entry.lastPick.value}`, { color: "#ffe36b", size: entry.lastPick.chest ? 0.42 : 0.28, life: 0.7 });
        this.feedback?.sound(entry.lastPick.chest ? "win" : "coin");
        this.feedback?.vibrate(entry.lastPick.chest ? [12, 20, 12] : 6);
      }
    }
    if (entry.lastSting && entry.lastSting.at !== seen.sting) {
      seen.sting = entry.lastSting.at;
      animator.trigger("flinch");
      animator.expression("surprised", 800);
      this.burst(at(), ["#ff8fd0", "#ffffff"], { count: 14, speed: 2.0, up: 0.6, size: 0.06, life: 0.5, gravity: 0 });
      const text = entry.lastSting.gold > 0 ? `AUA! −${entry.lastSting.o2} % Luft · −${entry.lastSting.gold} 🪙` : `AUA! −${entry.lastSting.o2} % Luft`;
      this.pop(at(), isOwn ? text : "AUA!", { color: "#ff9ad0", size: isOwn ? 0.3 : 0.24, life: 0.9 });
      if (isOwn) {
        this.rig.shake(0.6);
        this.feedback?.sound("error");
        this.feedback?.vibrate([30, 30, 30]);
      }
    }
    if (entry.lastBank && entry.lastBank.at !== seen.bank) {
      seen.bank = entry.lastBank.at;
      animator.trigger("celebrate");
      animator.expression("joy", 900);
      const p = this.bank.position.clone().add(new THREE.Vector3(0, 0.5, 0.4));
      this.burst(p, ["#ffe36b", player.color, "#ffffff"], { count: Math.round(18 * fxScale()), speed: 1.8, up: 2.2, size: 0.07, life: 0.7 });
      if (isOwn) {
        this.pop(p.add(new THREE.Vector3(0, 0.3, 0)), `+${entry.lastBank.gold} 🪙 sicher!`, { color: "#ffe36b", size: 0.38, life: 1.0 });
        this.feedback?.sound("perfect");
        this.feedback?.vibrate([10, 14, 18]);
      }
    }
    if (entry.lastFaintAt && entry.lastFaintAt !== seen.faint) {
      seen.faint = entry.lastFaintAt;
      animator.trigger("hit");
      this.pop(at(), isOwn ? `OHNMÄCHTIG! −${entry.lastFaint?.gold || 0} 🪙` : "OHNMÄCHTIG!", { color: "#ff9aa8", size: isOwn ? 0.34 : 0.24, life: 1.1 });
      if (isOwn) {
        this.rig.shake(0.8);
        this.feedback?.sound("fall");
        this.feedback?.vibrate([40, 40, 60]);
      }
    }
    this.seen.set(player.id, seen);
    void now;
  }

  drawHud(f) {
    const { arcade, state } = f;
    if (!arcade?.coins) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.banked || 0);
    const fill = this.hud.querySelector("[data-dive-air-fill]");
    const air = this.hud.querySelector("[data-dive-air]");
    if (fill && own) {
      const o2 = clamp(own.o2 ?? 100, 0, 100);
      fill.style.width = `${o2}%`;
      const level = o2 < 25 ? "low" : o2 < 50 ? "mid" : "ok";
      if (air.dataset.level !== level) air.dataset.level = level;
    }
    const depth = this.hud.querySelector("[data-dive-depth]");
    if (depth && own) depth.textContent = `${Math.max(0, Math.round(own.y || 0))} m`;
    const carried = this.hud.querySelector("[data-dive-carried]");
    if (carried && own) carried.textContent = `🪙 ${own.carried || 0} dabei`;

    const chips = this.hud.querySelector("[data-dig-chips]");
    if (chips) {
      const html = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === f.controlledId;
        return `<span class="dig-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${entry?.banked || 0}</span>`;
      }).join("");
      if (chips.innerHTML !== html) chips.innerHTML = html;
    }

    const banner = this.hud.querySelector("[data-dig-banner]");
    if (!banner || !own) return;
    // Wie viel Luft der direkte Weg nach oben kostet — so warnt die Anzeige,
    // BEVOR es zu spät ist, nicht erst bei null.
    const rate = (arcade.o2Base || 2.6) + (arcade.o2Depth || 8.4) * clamp((own.y || 0) / 2 / this.depth, 0, 1);
    const need = ((own.y || 0) / 6.2 + 0.5) * rate;
    let text = "";
    let bg = "";
    let fg = "#ffffff";
    if (own.fainted) {
      text = "Ohnmächtig — du treibst nach oben";
      bg = "#ff6b7f";
    } else if ((own.y || 0) > 1.5 && own.o2 < need * 1.25) {
      text = "LUFT KNAPP — AUFTAUCHEN!";
      bg = "#ff4d5e";
    } else if ((own.y || 0) <= 1.3 && (own.o2 ?? 100) < 99) {
      text = "Luft holen …";
      bg = "#7fd8ff";
      fg = "#08304a";
    } else if (f.remaining <= 4 && (own.carried || 0) > 0 && f.started) {
      text = `Noch ${f.remaining} s — hoch, sonst ist dein Gold weg!`;
      bg = "#ffd15c";
      fg = "#4a3405";
    }
    banner.hidden = !text;
    if (text && banner.textContent !== text) banner.textContent = text;
    if (text) {
      banner.style.background = bg;
      banner.style.color = fg;
    }
  }
}
