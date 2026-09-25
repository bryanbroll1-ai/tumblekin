import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp, fxScale } from "./Quality.js?v=tumblekin200";

// Tiefenrausch: Tippen gräbt eine Stufe tiefer, jede Stufe bringt mehr Gold
// und mehr Einsturzgefahr. Nach oben wischen zieht einen hoch und zahlt ein.
//
// Vorher sah man nur die eigene Figur in einem Loch unter einem grossen
// leeren Himmel; die anderen standen als Zahlen in der Anzeige. Jetzt ist es
// ein Querschnitt durch den Boden, alle Schächte nebeneinander: über jedem
// eine Winde mit Seil, die Erde in Schichten mit eingeschlossenen Steinen, die
// beim Graben aufbrechen. Man sieht, wie tief die anderen sich trauen, wer
// verschüttet wird und wer sich mit vollen Taschen hochziehen lässt.
const COL_W = 1.12;
const LEVEL_H = 0.62;
const MAX_LEVELS = 12;
const SURFACE_Y = 0;
const LAYER_COLORS = ["#8a6242", "#7d573a", "#704d33", "#62432c", "#553a27", "#4a3222"];
const GEM_COLORS = ["#ffd15c", "#ffd15c", "#7fe0ff", "#ffd15c", "#ff7fb0", "#b58cff"];

export class DeepDig extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.columns = new Map();
    this.lastEventAt = new Map();
    this.shown = new Map();
    this.drag = null;
    this.labelY = 0.72;
  }

  stage() {
    return {
      label: "3D Tiefenrausch",
      background: "#9adcf2",
      fog: ["#9adcf2", 20, 44],
      lights: { sunPosition: [-3, 9, 7], sunIntensity: 2.2, groundColor: 0x5a3f2a }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="dig-risk" data-dig-risk>Risiko –</div>
      <div class="dig-chips" data-dig-chips></div>
      <div class="color-banner dig-banner" data-dig-banner hidden></div>`;
  }

  colX(index, count) {
    return (index - (count - 1) / 2) * COL_W;
  }

  levelY(level) {
    return SURFACE_Y - level * LEVEL_H;
  }

  build() {
    const scene = this.scene;
    const players = this.getState()?.players || [];
    const count = Math.max(1, players.length);
    const width = count * COL_W + 6;

    // Wiese oben, Erdreich darunter als Rückwand des Querschnitts.
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(width + 20, 0.3, 8), new THREE.MeshLambertMaterial({ color: "#7bbf5e" }));
    lawn.position.set(0, SURFACE_Y - 0.15, -3.4);
    lawn.receiveShadow = true;
    scene.add(lawn);
    const back = new THREE.Mesh(new THREE.BoxGeometry(width + 20, MAX_LEVELS * LEVEL_H + 8, 0.4), new THREE.MeshLambertMaterial({ color: "#3a281b" }));
    back.position.set(0, SURFACE_Y - (MAX_LEVELS * LEVEL_H + 8) / 2, -0.7);
    scene.add(back);
    // Die Erde neben den Schächten, in Schichten.
    for (let level = 0; level < MAX_LEVELS + 4; level += 1) {
      const color = LAYER_COLORS[Math.min(LAYER_COLORS.length - 1, Math.floor(level / 2.5))];
      [-1, 1].forEach((side) => {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(10, LEVEL_H, 1.1), new THREE.MeshLambertMaterial({ color }));
        slab.position.set(side * (count * COL_W / 2 + 5), this.levelY(level) - LEVEL_H / 2, 0);
        scene.add(slab);
      });
    }
    [-1, 1].forEach((side) => {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(10, 0.14, 1.2), new THREE.MeshLambertMaterial({ color: "#6fb455" }));
      lip.position.set(side * (count * COL_W / 2 + 5), SURFACE_Y + 0.02, 0);
      scene.add(lip);
    });

    [[-4.2, 3.2, -6, 4], [3.8, 3.8, -7, 7]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    players.forEach((player, index) => this.addColumn(player, index, count));
  }

  addColumn(player, index, count) {
    const x = this.colX(index, count);
    const scene = this.scene;
    // Erdblöcke, einer je Stufe. Gegrabene werden unsichtbar.
    const blocks = [];
    for (let level = 1; level <= MAX_LEVELS; level += 1) {
      const color = LAYER_COLORS[Math.min(LAYER_COLORS.length - 1, Math.floor(level / 2.5))];
      const block = new THREE.Group();
      const dirt = new THREE.Mesh(new THREE.BoxGeometry(COL_W - 0.06, LEVEL_H - 0.03, 1.1), new THREE.MeshLambertMaterial({ color }));
      block.add(dirt);
      // Eingeschlossene Steine auf der Schnittfläche.
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1 + level * 0.006), new THREE.MeshLambertMaterial({ color: GEM_COLORS[level % GEM_COLORS.length], emissive: GEM_COLORS[level % GEM_COLORS.length], emissiveIntensity: 0.35 }));
      gem.position.set(((level * 37) % 7) / 7 * 0.5 - 0.25, ((level * 13) % 5) / 5 * 0.2 - 0.1, 0.56);
      block.add(gem);
      const pebble = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.04), new THREE.MeshLambertMaterial({ color: "#8f8a80" }));
      pebble.position.set(-gem.position.x * 0.8, -gem.position.y - 0.05, 0.56);
      block.add(pebble);
      block.position.set(x, this.levelY(level - 1) - LEVEL_H / 2, 0);
      scene.add(block);
      blocks.push(block);
    }
    // Stützbalken im gegrabenen Schacht, damit er nach Stollen aussieht.
    const beams = [];
    for (let level = 1; level <= MAX_LEVELS; level += 1) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(COL_W, 0.08, 0.14), new THREE.MeshLambertMaterial({ color: "#8a6a45" }));
      beam.position.set(x, this.levelY(level - 1) - 0.04, -0.35);
      beam.visible = false;
      scene.add(beam);
      beams.push(beam);
    }

    // Die Winde über dem Schacht, mit Seil nach unten.
    const frame = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: "#8a5a3a" });
    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.35, 0.08), wood);
      post.position.set(side * (COL_W / 2 - 0.1), 0.66, -0.25);
      post.rotation.z = side * 0.12;
      frame.add(post);
    });
    const top = new THREE.Mesh(new THREE.BoxGeometry(COL_W - 0.05, 0.1, 0.12), wood);
    top.position.set(0, 1.32, -0.25);
    frame.add(top);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 10), new THREE.MeshLambertMaterial({ color: player.color }));
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, 1.2, -0.2);
    frame.add(drum);
    frame.position.set(x, SURFACE_Y, 0);
    scene.add(frame);
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1, 0.03), new THREE.MeshLambertMaterial({ color: "#d9c79a" }));
    scene.add(rope);

    // Schatzkiste hinter dem Schacht, wächst mit dem eingezahlten Gold.
    const chest = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.3), new THREE.MeshLambertMaterial({ color: "#9a6a3a" }));
    box.position.y = 0.14;
    chest.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.32), new THREE.MeshLambertMaterial({ color: player.color }));
    band.position.y = 0.2;
    chest.add(band);
    const gold = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.22), new THREE.MeshLambertMaterial({ color: "#ffd15c", emissive: "#c98f1e", emissiveIntensity: 0.3 }));
    gold.position.y = 0.3;
    gold.scale.y = 0.01;
    chest.add(gold);
    chest.position.set(x + 0.28, SURFACE_Y, -1.1);
    scene.add(chest);

    // Die Figur mit Spitzhacke in der rechten Hand.
    const kin = this.addKin(player, index, { x, ground: SURFACE_Y, z: 0.05, facing: 0, scale: 0.92 });
    const pick = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.42), new THREE.MeshLambertMaterial({ color: "#7a5330" }));
    handle.position.z = 0.16;
    pick.add(handle);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.06), new THREE.MeshLambertMaterial({ color: "#9aa3b0" }));
    head.position.set(0, 0.02, 0.36);
    head.rotation.x = 0.3;
    pick.add(head);
    pick.position.set(0, -0.17, 0.02);
    kin.userData.arms?.[1]?.add(pick);
    const lamp = new THREE.PointLight("#ffd8a0", 1.6, 3.2);
    lamp.position.set(0, 0.6, 0.5);
    kin.add(lamp);

    this.columns.set(player.id, { x, blocks, beams, frame, rope, chest, gold, drum, kin, pick, liftFrom: null });
  }

  shot() {
    const count = Math.max(1, this.columns.size);
    return {
      look: [0, SURFACE_Y - 0.6, 0],
      frame: { w: Math.min(count * COL_W + 0.5, 3.4), h: 3.6 },
      pitch: 0.06,
      fov: 38,
      ease: 0.1,
      intro: { yaw: 0.4, pitch: 0.25, zoom: 1.3 }
    };
  }

  bind() {
    this.controls.innerHTML = `<p class="trace-hint" data-dig-hint>Tippen gräbt · nach oben wischen zahlt ein</p>`;
    this.controls.style.pointerEvents = "none";
    this.on(this.webglCanvas, "pointerdown", (event) => {
      event.preventDefault();
      this.drag = { x: event.clientX, y: event.clientY, at: performance.now() };
    });
    this.on(window, "pointerup", (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      const held = performance.now() - this.drag.at;
      this.drag = null;
      const minigame = this.update || this.minigame;
      if (!minigame || minigame.finaleAt) return;
      if (dy < -36 && Math.abs(dy) > Math.abs(dx)) {
        this.feedback?.sound("whoosh");
        this.feedback?.vibrate(14);
        this.sendInput({ action: "bank" }).catch(() => {});
        return;
      }
      if (Math.hypot(dx, dy) < 26 && held < 500) {
        this.feedback?.sound("clack");
        this.sendInput({ action: "dig" }).catch(() => {});
      }
    });
    this.on(window, "pointercancel", () => {
      this.drag = null;
    });
  }

  unbind() {
    this.controls.style.pointerEvents = "";
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const col = this.columns.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !col || !animator) return;
      const { kin } = col;
      const depth = entry.depth || 0;
      const busy = now < (entry.busyUntil || 0) ? entry.busyKind : null;

      this.syncEvent(player, entry, col, animator, now, controlledId);

      // Gegrabene Stufen öffnen, sonst Erde. Nach dem Einzahlen oder einem
      // Einsturz schüttet sich der Schacht wieder zu.
      col.blocks.forEach((block, i) => {
        block.visible = i + 1 > depth;
      });
      col.beams.forEach((beam, i) => {
        beam.visible = i + 1 <= depth;
      });

      // Wie tief steht die Figur gerade? Beim Hochziehen fährt sie am Seil.
      let shown = this.shown.get(player.id) ?? 0;
      if (busy === "surfacing" || busy === "collapsed") {
        const total = busy === "surfacing" ? 1300 : 1500;
        const u = Math.min(1, 1 - (entry.busyUntil - now) / total);
        const from = col.liftFrom ?? shown;
        shown = busy === "collapsed" && u < 0.45 ? from : from * (1 - Math.min(1, (u - (busy === "collapsed" ? 0.45 : 0)) / 0.55));
      } else {
        col.liftFrom = null;
        shown += (depth - shown) * frameLerp(0.14, dt);
      }
      this.shown.set(player.id, shown);
      const floorY = this.levelY(shown);
      animator.groundY = floorY + 0.3 * 0.92;
      kin.position.x = col.x;

      // Seil von der Winde bis zur Figur.
      const ropeTop = SURFACE_Y + 1.2;
      const ropeBottom = floorY + 0.75;
      const len = Math.max(0.05, ropeTop - ropeBottom);
      col.rope.scale.y = len;
      col.rope.position.set(col.x, ropeBottom + len / 2, -0.12);
      col.drum.rotation.x = -shown * 2.4;

      // Kiste füllt sich.
      const banked = entry.banked || 0;
      col.gold.scale.y = Math.max(0.01, Math.min(2.6, banked / 120));
      col.gold.position.y = 0.26 + col.gold.scale.y * 0.05;

      if (finale) {
        col.pick.visible = false;
        return;
      }
      col.pick.visible = busy !== "surfacing";
      if (busy === "surfacing") {
        animator.set("hang");
        animator.expression("joy", 200);
      } else if (busy === "collapsed") {
        animator.set("sit");
        animator.expression("ko", 200);
      } else if (depth > 0) {
        // Unten und unentschlossen: je riskanter, desto ängstlicher.
        animator.set("focus");
        animator.look(0, 1);
        if ((entry.nextRisk || 0) > 0.35) animator.expression("scared", 200);
        else if ((entry.nextRisk || 0) > 0.2) animator.expression("effort", 200);
      } else {
        animator.set("ready");
        animator.look(0, -1);
      }
    });
  }

  syncEvent(player, entry, col, animator, now, controlledId) {
    const event = entry.lastDive;
    if (!event || event.at === this.lastEventAt.get(player.id)) return;
    this.lastEventAt.set(player.id, event.at);
    const own = player.id === controlledId;
    const at = new THREE.Vector3(col.x, this.levelY(event.depth || 0) + 0.2, 0.6);
    if (event.kind === "dug") {
      animator.trigger("dig");
      this.burst(at, ["#8a6242", "#5e422c", GEM_COLORS[(event.depth || 0) % GEM_COLORS.length]], { count: 10 * fxScale(), speed: 1.6, up: 1.2, size: 0.07, life: 0.5, drag: 2 });
      this.pop(at.clone().add(new THREE.Vector3(0, 0.7, 0)), `+${event.gold}`, { color: "#ffe36b", size: own ? 0.3 : 0.22, life: 0.6 });
      if (own) {
        this.feedback?.sound("drop");
        this.feedback?.vibrate(6);
      }
    } else if (event.kind === "banked") {
      col.liftFrom = this.shown.get(player.id) ?? event.depth ?? 0;
      animator.trigger("fistpump");
      const top = new THREE.Vector3(col.x, SURFACE_Y + 0.9, 0.3);
      this.burst(top, ["#ffd15c", "#ffffff"], { count: 16 * fxScale(), speed: 2, up: 2.2, size: 0.08, life: 0.8, drag: 1.5 });
      this.pop(top.clone().add(new THREE.Vector3(0, 0.5, 0)), `${event.gold} SICHER!`, { color: "#ffe36b", size: own ? 0.36 : 0.26, life: 1 });
      if (own) {
        this.feedback?.sound("win");
        this.feedback?.vibrate([12, 10, 20]);
      }
    } else {
      // Einsturz: Brocken fallen von oben auf die Figur.
      col.liftFrom = this.shown.get(player.id) ?? event.depth ?? 0;
      animator.trigger("knockback");
      animator.expression("ko", 1500);
      const top = new THREE.Vector3(col.x, this.levelY(Math.max(0, (event.depth || 0) - 2)), 0.3);
      this.burst(top, ["#5e422c", "#3c2a1e", "#8a6a45", "#8f8a80"], { count: 26 * fxScale(), speed: 1.4, up: 0.2, size: 0.13, life: 1.1, gravity: 6, drag: 0.6 });
      this.pop(at.clone().add(new THREE.Vector3(0, 0.9, 0)), `EINSTURZ! −${event.gold}`, { color: "#ff9aa8", size: own ? 0.4 : 0.26, life: 1.2 });
      if (own) {
        this.rig.shake(0.9);
        this.feedback?.sound("impact");
        this.feedback?.vibrate([26, 18, 30]);
      }
    }
  }

  // Die Kamera folgt der eigenen Tiefe; wer weiter oben oder unten ist, darf
  // aus dem Bild — die Anzeige nennt alle Stände.
  keepInView(f) {
    const own = this.kins.get(f.controlledId);
    return own ? [own] : [];
  }

  rigOptions(f) {
    const col = this.columns.get(f.controlledId);
    const shown = this.shown.get(f.controlledId) ?? 0;
    const y = Math.min(SURFACE_Y - 0.4, this.levelY(shown) + 0.9);
    return { look: [(col?.x || 0) * 0.6, y, 0] };
  }

  drawHud(f) {
    const { arcade, state, now } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.banked || 0);

    const risk = this.hud.querySelector("[data-dig-risk]");
    if (risk && own) {
      const percent = Math.round((own.nextRisk || 0) * 100);
      risk.textContent = `Nächste Stufe: ${percent}% Einsturz · +${own.nextGain || 0}`;
      risk.style.color = percent >= 40 ? "#ff9aa8" : percent >= 22 ? "#ffd15c" : "#c6ffb0";
    }
    const chips = this.hud.querySelector("[data-dig-chips]");
    if (chips) {
      chips.innerHTML = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const isOwn = player.id === f.controlledId;
        return `<span class="dig-chip${isOwn ? " is-own" : ""}" style="--chip:${player.color}">${entry?.banked || 0}</span>`;
      }).join("");
    }
    const hint = this.controls?.querySelector("[data-dig-hint]");
    const mode = !own ? "idle" : (own.depth > 0 ? "deep" : "top");
    if (hint && mode !== this.hintMode) {
      this.hintMode = mode;
      hint.textContent = mode === "deep" ? "Tippen gräbt weiter · ⬆️ hochwischen zahlt ein" : "Tippen gräbt · nach oben wischen zahlt ein";
    }
    const banner = this.hud.querySelector("[data-dig-banner]");
    if (!banner || !own) return;
    if (now < own.busyUntil && own.busyKind === "collapsed") {
      banner.hidden = false;
      banner.textContent = "Verschüttet — alles verloren";
      banner.style.background = "#ff6b7f";
      banner.style.color = "#42101a";
    } else if (own.depth > 0) {
      banner.hidden = false;
      banner.textContent = `${own.carried} Gold hängen unten`;
      banner.style.background = own.carried >= 100 ? "#ffd15c" : "#3c2a1e";
      banner.style.color = own.carried >= 100 ? "#4a3405" : "#ffe9c8";
    } else {
      banner.hidden = true;
    }
  }
}
