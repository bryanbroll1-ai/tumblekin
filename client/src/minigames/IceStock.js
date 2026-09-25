import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Eisstock: nach vorn wischen schiebt den Stein los — länger heisst weiter.
// Wer seine Steine am nächsten ans Zentrum bringt, gewinnt.
//
// Vorher stand nur die eigene Figur am Abwurf. Jetzt stehen alle
// nebeneinander, gehen beim Ausholen in die Knie, stossen den Stein im
// Ausfallschritt an, schauen ihm hinterher und freuen sich, wenn er im Haus
// liegen bleibt — oder zucken mit den Schultern.
const SHEET_W = 4.2;
const SHEET_LEN = 9.5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class IceStock extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.stoneMeshes = new Map();
    this.throwers = new Map();
    this.drag = null;
    this.lastClacks = 0;
    this.ruhig = new Set();
    this.letzterGleitTon = 0;
    this.labelY = 0.74;
  }

  worldX(x) { return (x - 0.5) * SHEET_W; }
  worldZ(y, sheetY) { return -SHEET_LEN / 2 + (y / sheetY) * SHEET_LEN; }

  stage() {
    return {
      label: "3D Eisstock",
      background: "#bfe6f7",
      fog: ["#dff2fb", 20, 56],
      lights: { sunPosition: [-4, 12, 6], shadow: { left: -5, right: 5, top: 8, bottom: -8 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="stock-left" data-stock-left>3 Steine</div>
      <div class="stock-chips" data-stock-chips></div>
      <div class="color-banner stock-banner" data-stock-banner hidden></div>
      <div class="stock-power" data-stock-power hidden><span data-stock-power-fill></span><b data-stock-power-text>0%</b></div>`;
  }

  build() {
    const scene = this.scene;
    const arcade = this.minigame.arcade;
    const sheetY = arcade.sheetY || 1.3;

    const snow = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 22),
      new THREE.MeshLambertMaterial({ color: "#eaf6fd" })
    );
    snow.position.y = -0.25;
    snow.receiveShadow = true;
    scene.add(snow);

    const ice = new THREE.Mesh(
      new THREE.BoxGeometry(SHEET_W, 0.06, SHEET_LEN),
      new THREE.MeshLambertMaterial({ color: "#a4d6ef" })
    );
    ice.position.set(0, 0.02, 0);
    ice.receiveShadow = true;
    scene.add(ice);

    [-1, 1].forEach((side) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.22, SHEET_LEN),
        new THREE.MeshLambertMaterial({ color: "#8fb6cc" })
      );
      rail.position.set(side * (SHEET_W / 2 + 0.07), 0.11, 0);
      scene.add(rail);
    });

    // Das Haus: konzentrische Ringe. Die Farben sind die Punktwerte — von aussen
    // nach innen wird es heller, damit man den Wert sieht statt ihn zu lernen.
    const shades = ["#8fb6cc", "#4bb8ff", "#ffffff", "#ff5d73"];
    const rings = [...(arcade.rings || [])].sort((a, b) => b.radius - a.radius);
    rings.forEach((ring, index) => {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry((ring.radius / 1) * SHEET_W, 32),
        new THREE.MeshBasicMaterial({ color: shades[index % shades.length], toneMapped: false })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(this.worldX(arcade.house.x), 0.06 + index * 0.004, this.worldZ(arcade.house.y, sheetY));
      scene.add(disc);
    });

    // Der Knopf. Seit die Wertung stufenlos ist, entscheidet der genaue Mittel-
    // punkt und nicht mehr die Ringstufe — dann muss er auch zu sehen sein.
    const knopf = new THREE.Mesh(
      new THREE.CircleGeometry(0.022 * SHEET_W, 24),
      new THREE.MeshBasicMaterial({ color: "#ff5d73", toneMapped: false })
    );
    knopf.rotation.x = -Math.PI / 2;
    knopf.position.set(this.worldX(arcade.house.x), 0.06 + rings.length * 0.004, this.worldZ(arcade.house.y, sheetY));
    scene.add(knopf);

    // Abwurflinie: von hier starten alle Steine.
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(SHEET_W, 0.02, 0.1),
      new THREE.MeshBasicMaterial({ color: "#7b98ad", transparent: true, opacity: 0.9, depthWrite: false })
    );
    line.position.set(0, 0.07, this.worldZ(sheetY - 0.14, sheetY));
    scene.add(line);

    [[-7.4, 5.6, -9, 6], [7.0, 6.2, -11, 1]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    // Winterkulisse hinter der Bahn. Vorher waren Bahn, Schnee und Himmel drei
    // Abstufungen von Weissgrau — das Bild hatte weder Farbe noch Horizont.
    const tannenStamm = new THREE.MeshLambertMaterial({ color: "#6b4a2c" });
    const tannenGruen = new THREE.MeshLambertMaterial({ color: "#2f6f42" });
    const schneeMat = new THREE.MeshLambertMaterial({ color: "#f4f9ff" });
    for (let i = 0; i < 16; i += 1) {
      const seite = i % 2 === 0 ? -1 : 1;
      const bx = seite * (SHEET_W / 2 + 1.4 + ((i * 1.7) % 6));
      const bz = -SHEET_LEN / 2 - 1 - ((i * 2.3) % 12);
      const hoehe = 1.5 + ((i * 0.7) % 1.4);
      const stamm = new THREE.Mesh(new THREE.BoxGeometry(0.22, hoehe * 0.5, 0.22), tannenStamm);
      stamm.position.set(bx, hoehe * 0.25, bz);
      scene.add(stamm);
      const krone = new THREE.Mesh(new THREE.ConeGeometry(hoehe * 0.42, hoehe * 1.1, 6), tannenGruen);
      krone.position.set(bx, hoehe * 0.5 + hoehe * 0.5, bz);
      scene.add(krone);
      const haube = new THREE.Mesh(new THREE.ConeGeometry(hoehe * 0.26, hoehe * 0.4, 6), schneeMat);
      haube.position.set(bx, hoehe * 1.15, bz);
      scene.add(haube);
    }
    // Weiche Schneehügel als Horizont.
    for (let i = 0; i < 7; i += 1) {
      const huegel = new THREE.Mesh(new THREE.SphereGeometry(2.2 + (i % 3) * 1.3, 10, 6), schneeMat);
      huegel.position.set(-11 + i * 3.7, -1.4, -SHEET_LEN / 2 - 9 - (i % 2) * 3);
      huegel.scale.y = 0.5;
      scene.add(huegel);
    }


    // Alle Werfer am Abwurf nebeneinander.
    const players = this.getState()?.players || [];
    const baseZ = this.worldZ(sheetY, sheetY) + 0.45;
    players.forEach((player, index) => {
      const x = (index - (players.length - 1) / 2) * 0.95;
      this.addKin(player, index, { x, ground: 0.05, z: baseZ, facing: Math.PI, scale: 0.9 });
      this.throwers.set(player.id, { x, z: baseZ, left: arcade.players[player.id]?.stonesLeft ?? 3, threwAt: -1e9, stoneId: null, reacted: true });
    });
  }

  shot() {
    const sheetY = this.minigame.arcade.sheetY || 1.3;
    return {
      look: [0, 0.2, this.worldZ(sheetY * 0.52, sheetY)],
      frame: { w: SHEET_W + 0.4, h: 4.6 },
      yaw: 0.16,
      pitch: 0.5,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.25, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint">Nach vorne wischen — länger heisst weiter</p>`;
    this.controls.style.pointerEvents = "none";
    this.bindDrag();
  }

  unbind() {
    this.controls.style.pointerEvents = "";
    this.stoneMeshes.clear();
  }

  bindDrag() {
    this.onDown = (event) => {
      event.preventDefault();
      this.drag = { x: event.clientX, y: event.clientY };
    };
    this.onMove = (event) => {
      if (!this.drag) return;
      this.drag.cx = event.clientX;
      this.drag.cy = event.clientY;
      // Die Kraft steht schon WÄHREND des Ziehens da. Ohne sie wirft man blind
      // und lernt aus einem misslungenen Stein nichts — man weiss ja nicht, ob
      // er zu kurz war oder man zu zaghaft gewischt hat.
      this.showPower(event);
    };
    this.onUp = (event) => {
      if (!this.drag) return;
      const rect = this.webglCanvas.getBoundingClientRect();
      const dx = (event.clientX - this.drag.x) / Math.max(1, rect.width);
      // Nach OBEN wischen heisst nach vorne schieben — deshalb das Vorzeichen.
      // Die Höhe des Bildes ist der Massstab, nicht die Breite: der Wisch geht
      // im Wesentlichen längs.
      const dy = (event.clientY - this.drag.y) / Math.max(1, rect.height);
      this.drag = null;
      this.hidePower();
      const power = Math.hypot(dx, dy);
      if (power < 0.05) return;
      // Kraft aus der Wischlänge, gedeckelt. 55 % der Bildhöhe sind volle Kraft
      // — mehr schafft ein Daumen in einer Bewegung ohnehin nicht.
      const scale = Math.min(1, power / 0.55) / Math.max(1e-6, power);
      this.feedback?.sound("whoosh");
      this.feedback?.vibrate(12);
      this.sendInput({ action: "flick", dx: clamp(dx * scale * 2.2, -1, 1), dy: clamp(dy * scale * 2.2, -1, 0.1) }).catch(() => {});
    };
    this.onCancel = () => { this.drag = null; this.hidePower(); };

    this.on(this.webglCanvas, "pointerdown", this.onDown);
    this.on(this.webglCanvas, "pointermove", this.onMove);
    this.on(window, "pointerup", this.onUp);
    this.on(window, "pointercancel", this.onCancel);
  }

  ensureStone(stone, colour) {
    if (this.stoneMeshes.has(stone.id)) return this.stoneMeshes.get(stone.id);
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.24, 0.16, 16),
      new THREE.MeshLambertMaterial({ color: "#5e6b78" })
    );
    body.position.y = 0.08;
    body.castShadow = true;
    group.add(body);
    // Der Griff trägt die Spielerfarbe — der Stein selbst bleibt Granit, sonst
    // sieht das Haus aus wie ein Farbklecks.
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.035, 6, 14),
      new THREE.MeshLambertMaterial({ color: colour })
    );
    handle.position.y = 0.2;
    handle.rotation.x = Math.PI / 2;
    group.add(handle);
    this.scene.add(group);
    const visual = { group, body, handle };
    this.stoneMeshes.set(stone.id, visual);
    return visual;
  }

  // Wie stark der Wurf gerade würde — dieselbe Rechnung wie beim Loslassen,
  // damit die Anzeige nicht etwas anderes verspricht als der Stein tut.
  showPower(event) {
    const bar = this.hud?.querySelector("[data-stock-power]");
    if (!bar || !this.drag) return;
    const rect = this.webglCanvas.getBoundingClientRect();
    const dx = (event.clientX - this.drag.x) / Math.max(1, rect.width);
    const dy = (event.clientY - this.drag.y) / Math.max(1, rect.height);
    const anteil = Math.min(1, Math.hypot(dx, dy) / 0.55);
    bar.hidden = false;
    const fill = bar.querySelector("[data-stock-power-fill]");
    const text = bar.querySelector("[data-stock-power-text]");
    if (fill) fill.style.width = `${Math.round(anteil * 100)}%`;
    if (text) text.textContent = `${Math.round(anteil * 100)}%`;
  }

  hidePower() {
    const bar = this.hud?.querySelector("[data-stock-power]");
    if (bar) bar.hidden = true;
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, state } = f;
    if (!arcade) return;
    const sheetY = arcade.sheetY || 1.3;
    const colourOf = (id) => state.players.find((player) => player.id === id)?.color || "#ffffff";
    const alive = new Set();
    let schnellster = 0;
    const stonesById = new Map();
    (arcade.stones || []).forEach((stone) => {
      alive.add(stone.id);
      stonesById.set(stone.id, stone);
      const visual = this.ensureStone(stone, colourOf(stone.playerId));
      const wx = this.worldX(stone.x);
      visual.group.position.set(wx, 0, this.worldZ(stone.y, sheetY));
      const tempo = Math.hypot(stone.vx, stone.vy);
      visual.group.rotation.y += dt * tempo * 2.4;
      if (tempo > schnellster) {
        schnellster = tempo;
        this.gleitPan = wx / (SHEET_W / 2);
      }
      const stand = tempo < 0.02;
      if (stand && !this.ruhig.has(stone.id)) {
        this.ruhig.add(stone.id);
        if (stone.playerId === controlledId) {
          this.feedback?.sound("lock", { pan: wx / (SHEET_W / 2) * 0.5 });
          this.feedback?.vibrate(8);
        }
      } else if (!stand) {
        this.ruhig.delete(stone.id);
      }
      // Den eigenen, zuletzt geworfenen Stein merken, damit man ihm nachschaut.
      const thrower = this.throwers.get(stone.playerId);
      if (thrower && (thrower.stoneId === null || stone.id > thrower.stoneId) && !stand) thrower.stoneId = stone.id;
    });
    if (schnellster > 0.05 && now - this.letzterGleitTon > 70 + Math.max(0, 1 - schnellster / 1.6) * 150) {
      this.letzterGleitTon = now;
      this.feedback?.sound("step", { pan: (this.gleitPan || 0) * 0.5 });
    }
    this.stoneMeshes.forEach((visual, id) => {
      if (alive.has(id)) return;
      this.scene.remove(visual.group);
      this.stoneMeshes.delete(id);
    });
    if ((arcade.clacks || 0) > this.lastClacks) {
      this.lastClacks = arcade.clacks;
      this.feedback?.sound("clack");
      this.feedback?.vibrate(10);
      this.rig.shake(0.2);
      this.throwers.forEach((thrower, id) => this.animators.get(id)?.expression("surprised", 500));
    }

    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const thrower = this.throwers.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !thrower || !kin || !animator) return;
      const left = entry.stonesLeft ?? 0;
      if (left < thrower.left) {
        thrower.threwAt = now;
        thrower.reacted = false;
        thrower.stoneId = null;
        animator.trigger("push");
      }
      thrower.left = left;
      // Ausfallschritt nach vorn und zurück.
      const since = now - thrower.threwAt;
      const lunge = since < 700 ? Math.sin(Math.min(1, since / 700) * Math.PI) * 0.7 : 0;
      kin.position.z = thrower.z - lunge;
      kin.position.x = thrower.x;
      if (finale) {
        kin.rotation.y += Math.atan2(Math.sin(0.3 - kin.rotation.y), Math.cos(0.3 - kin.rotation.y)) * frameLerp(0.08, dt);
        return;
      }
      const stone = thrower.stoneId !== null ? stonesById.get(thrower.stoneId) : null;
      const moving = stone && Math.hypot(stone.vx, stone.vy) > 0.02;
      const visual = stone ? this.stoneMeshes.get(stone.id) : null;
      kin.rotation.y = Math.PI;
      animator.lookAt(visual ? visual.group.position : null);
      if (since < 700) return;
      if (moving) {
        animator.set("focus");
        animator.expression("effort", 150);
      } else if (stone && !thrower.reacted) {
        // Liegen geblieben: im Haus freuen, sonst Schultern hoch.
        thrower.reacted = true;
        const house = arcade.house;
        const d = Math.hypot(stone.x - house.x, stone.y - house.y);
        const outer = Math.max(...(arcade.rings || [{ radius: 0.2 }]).map((ring) => ring.radius));
        animator.trigger(d < outer ? "fistpump" : "headshake");
        animator.expression(d < outer ? "joy" : "sad", 900);
      } else if (player.id === controlledId && this.drag) {
        const rect = this.webglCanvas.getBoundingClientRect();
        const dx = ((this.drag.cx ?? this.drag.x) - this.drag.x) / Math.max(1, rect.width);
        const dy = ((this.drag.cy ?? this.drag.y) - this.drag.y) / Math.max(1, rect.height);
        animator.set("charge", { params: { power: Math.min(1, Math.hypot(dx, dy) / 0.55) } });
      } else {
        animator.set(left > 0 ? "ready" : "idle");
      }
    });
  }

  drawHud(f) {
    const { arcade, state, controlledId } = f;
    if (!arcade) return;
    const own = arcade.players[controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(Math.max(0, Math.round(own?.score || 0)));
    const left = this.hud.querySelector("[data-stock-left]");
    if (left) {
      const count = own?.stonesLeft ?? 0;
      left.textContent = count === 1 ? "1 Stein" : `${count} Steine`;
    }

    const chips = this.hud.querySelector("[data-stock-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === this.getControlledPlayerId();
        return `<span class="stock-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${Math.max(0, Math.round(entry?.score || 0))}</span>`;
      }).join("");
    }

    const banner = this.hud.querySelector("[data-stock-banner]");
    if (!banner) return;
    if ((own?.stonesLeft ?? 0) <= 0) {
      banner.hidden = false;
      banner.textContent = "Alle Steine draussen — jetzt zählt, was liegen bleibt";
      banner.style.background = "#4bb8ff";
      banner.style.color = "#0d2b3a";
    } else if ((own?.stonesLeft ?? 0) === 1) {
      banner.hidden = false;
      banner.textContent = "Letzter Stein!";
      banner.style.background = "#ffd15c";
      banner.style.color = "#4a3405";
    } else {
      banner.hidden = true;
    }
  }
}
