import * as THREE from "/vendor/three/three.module.js";
import { createCloud } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";
import { kiste, lambert, viele, streuer } from "./Kulisse.js?v=tumblekin200";

// Turmbau: wie bei den Stapelspielen gleitet der nächste Block direkt auf der
// nächsten Ebene über den Turm hin und her, ein Tipp setzt ihn ab. Was
// übersteht, wird abgeschnitten — wer am höchsten baut, gewinnt.
//
// Den gleitenden Block sieht jeder nur für den EIGENEN Turm. Vorher pendelten
// alle vier halb durchsichtig an Seilen über den Türmen und schnitten sich
// gegenseitig durchs Bild — man verlor den eigenen aus den Augen. Der eigene
// Turm steht dazu eine Reihe weiter vorn.
//
// Vorher gab es gar keine Figuren, nur Türme und Namensschilder. Jetzt steht
// vor jedem Turm sein Baumeister, schaut dem pendelnden Block nach, reisst
// die Arme hoch bei einem perfekten Treffer und winkt, wenn der Turm fertig
// ist. (Oben auf dem Turm fiel ihm der nächste Block durch den Kopf.)
const COL_GAP = 1.5;
const BLOCK_H = 0.46;
// Oberkante des Sockels: Holzklotz bis 0.2, darauf der Farbstreifen bis
// 0.25. Die Blöcke wurden früher von 0.17 an gestapelt — der erste steckte
// acht Zentimeter im Sockel und sah aus, als wäre er im Boden versunken.
const STACK_Y = 0.25;
function blockCenterY(level) {
  return STACK_Y + (level + 0.5) * BLOCK_H;
}
const WORLD_W = 1.35;
const SLIDE_W = 1.15;
const OWN_Z = 0.7;              // der eigene Turm eine Reihe weiter vorn
const OTHER_Z = -1.0;
const DROP_MS = 200;

export class TowerStack extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.towers = new Map();
    this.lastHeight = new Map();
    this.lastToppled = new Map();
    this.labelY = 0.74;
    this.smoothTop = 0;
    // Im Finale NICHT auf den Sieger zufahren: der eigene Turm steht eine
    // Reihe weiter vorn, und stand der Sieger dahinter, füllte der eigene
    // Turm das ganze Bild. Gezeigt werden stattdessen alle Türme.
    this.finaleFocus = false;
  }

  stage() {
    return {
      label: "3D Turmbau",
      background: "#a8e2f4",
      fog: ["#a8e2f4", 20, 46],
      lights: { sunPosition: [-4, 12, 6], shadow: { top: 12, bottom: -6 } }
    };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="hud-chips" data-stack-heights></div>
      <div class="color-banner" data-stack-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(44, 0.5, 40),
      new THREE.MeshLambertMaterial({ color: "#c9a877" })
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    scene.add(ground);

    // Eine Baustelle: Kiesboden mit ein paar Grasresten, am Rand Bäume.
    // Freigehalten wird der Streifen mit den vier Türmen.
    dressMeadow(this.scene, { seed: 14, keepOut: { x: 4.2, z: 2.6 }, spread: { x: 16, z: 14 }, patches: 30, patchColors: ["#b8956a", "#d8bc8e", "#a9a39a"], tufts: 90, flowers: 8, stones: 50, trees: 22, grassColor: "#7fa556", crownColor: "#4a9c4e", crownColor2: "#6ab857", crownShape: "blob" });
    this.buildSite(scene);

    [[-7, 5.4, -4, 5], [7, 6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    const players = this.getState()?.players || [];
    const own = this.getControlledPlayerId();
    const others = players.filter((player) => player.id !== own);
    players.forEach((player, index) => {
      // Der eigene Turm vorn in der Mitte, die anderen dahinter verteilt.
      const slot = others.indexOf(player);
      const spots = others.length === 1 ? [[1.5, OTHER_Z]] : others.length === 2 ? [[-1.9, OTHER_Z], [1.9, OTHER_Z]] : [[-1.95, OTHER_Z], [0, OTHER_Z - 1.5], [1.95, OTHER_Z]];
      const [x, z] = player.id === own ? [0, OWN_Z] : spots[slot % spots.length];
      this.addTower(player, index, x, z);
      // Die Namen der anderen stünden sonst mitten auf dem eigenen Turm.
      const label = this.kins.get(player.id)?.userData.label;
      if (label && player.id !== own) label.visible = false;
    });
  }

  // Kran mit drehendem Ausleger, ein Rohbau mit Gerüst, Baucontainer, vorn
  // Absperrbaken mit Blinklichtern, Sandhaufen, Ziegelpalette, Schubkarre und
  // Pylonen.
  buildSite(scene) {
    const zufall = streuer(52);
    const gelb = lambert("#f2b705");

    // Turmkran hinten rechts.
    const kran = new THREE.Group();
    kran.position.set(4.2, 0, -8.5);
    scene.add(kran);
    kiste(kran, 1.4, 0.5, 1.4, "#7d7f86", [0, 0.25, 0]);
    const mast = [];
    for (let y = 0.5; y < 9; y += 0.9) {
      [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].forEach(([x, z]) => mast.push({ p: [x, y + 0.45, z], s: [1, 1, 1] }));
      mast.push({ p: [0, y + 0.45, 0.3], r: [0, 0, 0.8], s: [1, 1.5, 1] });
      mast.push({ p: [0.3, y + 0.45, 0], r: [0.8, 0, 0], s: [1, 1.5, 1] });
    }
    viele(kran, new THREE.BoxGeometry(0.08, 0.9, 0.08), gelb, mast, { schatten: true });
    kiste(kran, 0.9, 0.7, 0.9, "#f2b705", [0, 9.35, 0]);
    kiste(kran, 0.5, 0.45, 0.5, "#dfe7ef", [0.45, 9.1, 0.45]);
    this.craneJib = new THREE.Group();
    this.craneJib.position.set(0, 9.8, 0);
    kran.add(this.craneJib);
    kiste(this.craneJib, 9, 0.35, 0.35, "#f2b705", [-2.6, 0, 0]);
    kiste(this.craneJib, 2, 0.6, 0.7, "#7d7f86", [2.4, -0.15, 0]);
    kiste(this.craneJib, 0.2, 1.4, 0.2, "#f2b705", [0, 0.85, 0]);
    const seil = kiste(this.craneJib, 0.03, 3.2, 0.03, "#2c2f38", [-5.4, -1.6, 0], { schatten: false });
    seil.userData.isFx = false;
    kiste(this.craneJib, 0.3, 0.2, 0.3, "#c8413b", [-5.4, -3.25, 0]);
    // Am Haken ein Bündel Balken.
    const last = new THREE.Group();
    last.position.set(-5.4, -3.6, 0);
    [-0.12, 0.12].forEach((z) => kiste(last, 1.6, 0.18, 0.18, "#b07a3e", [0, 0, z]));
    this.craneJib.add(last);

    // Rohbau mit Gerüst hinten links.
    const bau = new THREE.Group();
    bau.position.set(-4.6, 0, -9.5);
    bau.rotation.y = 0.25;
    scene.add(bau);
    const beton = lambert("#b9b6ae");
    [0, 2, 4].forEach((y) => kiste(bau, 4.2, 0.25, 3, "#b9b6ae", [0, y + 0.12, 0], { material: beton }));
    const stuetzen = [];
    [0, 2].forEach((y) => [[-1.9, -1.3], [1.9, -1.3], [-1.9, 1.3], [1.9, 1.3], [0, -1.3]].forEach(([x, z]) => stuetzen.push({ p: [x, y + 1.12, z] })));
    viele(bau, new THREE.BoxGeometry(0.28, 1.75, 0.28), beton, stuetzen, { schatten: true });
    const ziegelwand = [];
    for (let i = 0; i < 9; i += 1) ziegelwand.push({ p: [-1.8 + i * 0.4, 0.4 + (i % 3) * 0.25, -1.3], s: [0.38, 0.22 + (i % 3) * 0.2, 0.25] });
    viele(bau, new THREE.BoxGeometry(1, 1, 1), lambert("#c2653e"), ziegelwand);
    const geruest = [];
    for (let x = -2; x <= 2.01; x += 1) geruest.push({ p: [x, 2.6, 1.85], s: [1, 1, 1] });
    viele(bau, new THREE.BoxGeometry(0.06, 5.2, 0.06), lambert("#9aa3ad"), geruest);
    const boeden = [0.9, 2.9, 4.6].map((y) => ({ p: [0, y, 1.85], s: [4.2, 0.08, 0.6] }));
    viele(bau, new THREE.BoxGeometry(1, 1, 1), lambert("#c99a5c"), boeden);
    const netz = new THREE.Mesh(new THREE.PlaneGeometry(2, 2.6), lambert("#3fa46a", { transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    netz.position.set(1.05, 3.4, 2.15);
    bau.add(netz);

    // Baucontainer links vorn im Mittelgrund.
    kiste(scene, 2.4, 1.1, 1.1, "#2f6fb0", [-5.2, 0.55, -4.2]).rotation.y = 0.4;
    kiste(scene, 2.2, 1.1, 1.1, "#2f6fb0", [-5.2, 1.66, -4.2]).rotation.y = 0.4;
    kiste(scene, 0.5, 0.35, 0.02, "#dff2ff", [-4.75, 1.8, -3.62], { schatten: false }).rotation.y = 0.4;

    // Absperrbaken mit Blinklicht links und rechts vorn.
    const streifenRot = lambert("#e0453b");
    const streifenWeiss = lambert("#f6f3ec");
    this.siteLamps = [];
    [[-2.7, 2.6, 0.25], [2.7, 2.6, -0.25]].forEach(([x, z, dreh], i) => {
      const bake = new THREE.Group();
      bake.position.set(x, 0, z);
      bake.rotation.y = dreh;
      scene.add(bake);
      [-0.75, 0.75].forEach((bx) => kiste(bake, 0.08, 0.7, 0.4, "#555a63", [bx, 0.35, 0]));
      for (let k = 0; k < 6; k += 1) kiste(bake, 0.3, 0.22, 0.05, "", [-0.75 + k * 0.3, 0.55, 0], { material: k % 2 ? streifenWeiss : streifenRot });
      const lampe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshLambertMaterial({ color: "#ffb020", emissive: "#ff9a00", emissiveIntensity: 0 }));
      lampe.position.set(i ? 0.7 : -0.7, 0.8, 0);
      bake.add(lampe);
      this.siteLamps.push(lampe);
    });

    // Sandhaufen mit Schaufel.
    const sand = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lambert("#e0c48a"));
    sand.scale.set(0.8, 0.42, 0.65);
    sand.position.set(-2.1, 0, 3.9);
    sand.receiveShadow = true;
    scene.add(sand);
    const schaufel = new THREE.Group();
    kiste(schaufel, 0.05, 1.1, 0.05, "#b07a3e", [0, 0.55, 0]);
    kiste(schaufel, 0.24, 0.3, 0.03, "#7d7f86", [0, 1.2, 0]);
    schaufel.position.set(-1.9, 0.15, 3.9);
    schaufel.rotation.set(0.2, 0.3, 2.7);
    scene.add(schaufel);

    // Ziegelpalette rechts.
    kiste(scene, 1.2, 0.14, 0.9, "#a0784a", [2.1, 0.07, 3.9]);
    const ziegel = [];
    for (let lage = 0; lage < 4; lage += 1) {
      for (let i = 0; i < 4; i += 1) ziegel.push({ p: [2.1 + (i - 1.5) * 0.28, 0.24 + lage * 0.16, 3.9 + (lage % 2 ? 0.12 : -0.12)], s: [0.26, 0.14, 0.5] });
    }
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#c2653e"), ziegel, { schatten: true });

    // Schubkarre.
    const karre = new THREE.Group();
    kiste(karre, 0.7, 0.3, 0.5, "#2fa36b", [0, 0.45, 0]);
    const rad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12), lambert("#2c2f38"));
    rad.rotation.z = Math.PI / 2;
    rad.position.set(0, 0.16, 0.42);
    karre.add(rad);
    [-0.2, 0.2].forEach((x) => kiste(karre, 0.04, 0.04, 0.9, "#555a63", [x, 0.42, -0.35]));
    karre.scale.setScalar(0.8);
    karre.position.set(-3.3, 0, 1.2);
    karre.rotation.y = -0.6;
    scene.add(karre);

    // Pylonen.
    const pylonen = [[-1.2, 3.3], [1.2, 3.1], [3.3, 1.4], [-0.6, 4.4]].map(([x, z]) => ({ p: [x, 0.22, z] }));
    viele(scene, new THREE.ConeGeometry(0.16, 0.44, 10), lambert("#ff7a1a"), pylonen, { schatten: true });
    viele(scene, new THREE.CylinderGeometry(0.1, 0.12, 0.07, 10), streifenWeiss, pylonen.map((p) => ({ p: [p.p[0], 0.24, p.p[2]] })));
    viele(scene, new THREE.BoxGeometry(0.4, 0.04, 0.4), lambert("#2c2f38"), pylonen.map((p) => ({ p: [p.p[0], 0.02, p.p[2]] })));

    // Verstreute Bretter und Rohre.
    const bretter = [];
    for (let i = 0; i < 6; i += 1) bretter.push({ p: [(zufall() - 0.5) * 7, 0.03, 2.6 + zufall() * 2.5], r: [0, zufall() * Math.PI, 0], s: [0.8, 0.04, 0.14] });
    viele(scene, new THREE.BoxGeometry(1, 1, 1), lambert("#c99a5c"), bretter);
  }

  columnX(index, count) {
    return (index - (count - 1) / 2) * COL_GAP;
  }

  levelTop(level) {
    return STACK_Y + level * BLOCK_H;
  }

  addTower(player, index, x, z) {
    const isOwn = player.id === this.getControlledPlayerId();
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    this.scene.add(group);
    const base = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W, 0.4, 1.1), new THREE.MeshLambertMaterial({ color: "#8a5a2c" }));
    base.receiveShadow = true;
    base.castShadow = true;
    group.add(base);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W + 0.06, 0.1, 1.16), new THREE.MeshLambertMaterial({ color: player.color }));
    stripe.position.y = 0.2;
    group.add(stripe);
    // Der gleitende nächste Block — nur beim eigenen Turm zu sehen.
    const hook = new THREE.Group();
    const slider = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD_W, BLOCK_H, 1),
      new THREE.MeshLambertMaterial({ color: player.color, emissive: player.color, emissiveIntensity: 0.18, transparent: true, opacity: 0.88 })
    );
    slider.castShadow = true;
    hook.add(slider);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(WORLD_W, BLOCK_H, 1)),
      new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8 })
    );
    hook.add(edges);
    hook.visible = false;
    group.add(hook);
    // Der Baumeister vor dem Turm.
    this.addKin(player, index, { x, ground: 0, z: group.position.z + 0.95, facing: 0, scale: 0.9 });
    this.towers.set(player.id, { group, blocks: [], hook, slider, edges, x, isOwn, color: player.color, dropping: null, flagged: false });
  }

  shot() {
    const count = Math.max(1, this.towers.size);
    return {
      look: [0, 1.4, 0],
      frame: { w: count * COL_GAP + 1.2, h: 3.4 },
      pitch: 0.16,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.35 },
      finale: false
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-stack-drop>
        <span class="nerve-button-face">SETZEN!</span>
      </button>`;
    this.dropButton = this.controls.querySelector("[data-stack-drop]");
    const press = (event) => {
      event.preventDefault();
      this.pressDrop();
    };
    this.on(this.dropButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  unbind() {
    this.towers.clear();
  }

  pressDrop() {
    const arcade = (this.update || this.minigame)?.arcade;
    const own = arcade?.players?.[this.getControlledPlayerId()];
    if (!own || own.toppled || own.height >= arcade.total) return;
    this.feedback?.sound("move");
    this.feedback?.vibrate(10);
    this.sendInput({ action: "drop" }).catch(() => {});
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale, minigame } = f;
    if (this.craneJib) this.craneJib.rotation.y = 0.5 + Math.sin(now / 5200) * 0.45;
    this.siteLamps?.forEach((lampe, i) => { lampe.material.emissiveIntensity = Math.floor(now / 450 + i) % 2 ? 1.4 : 0.1; });
    if (!arcade) return;
    const elapsed = Math.max(0, now - minigame.startedAt);
    let topHeight = 0;
    players.forEach((player) => {
      const entry = arcade.players[player.id];
      const tower = this.towers.get(player.id);
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !tower || !kin || !animator) return;
      const isOwn = player.id === controlledId;
      // Neue Blöcke fallen vom Haken, die Figur springt hinauf.
      while (tower.blocks.length < (entry.height || 0)) {
        const level = tower.blocks.length;
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.1, entry.width * WORLD_W), BLOCK_H, 1),
          new THREE.MeshLambertMaterial({ color: tower.color, emissive: tower.color, emissiveIntensity: level % 2 ? 0.1 : 0.03 })
        );
        const restY = blockCenterY(level);
        block.position.set(entry.offset * WORLD_W, restY, 0);
        block.castShadow = true;
        block.receiveShadow = true;
        tower.group.add(block);
        tower.blocks.push(block);
        tower.dropping = { block, from: restY + 0.1, to: restY, at: now };
        animator.trigger("hop", { height: 0.2 });
      }
      if (tower.dropping) {
        const u = Math.min(1, (now - tower.dropping.at) / DROP_MS);
        tower.dropping.block.position.y = THREE.MathUtils.lerp(tower.dropping.from, tower.dropping.to, u * u);
        if (u >= 1) tower.dropping = null;
      }
      const height = tower.blocks.length;
      topHeight = Math.max(topHeight, height);
      if (height > (this.lastHeight.get(player.id) || 0)) {
        this.lastHeight.set(player.id, height);
        const top = tower.blocks[height - 1];
        const topPos = top.getWorldPosition(new THREE.Vector3());
        topPos.y = blockCenterY(height - 1);
        const perfect = entry.flash === "good";
        this.burst(topPos, [tower.color, "#ffffff"], { count: perfect ? 10 : 5, speed: perfect ? 1.7 : 1.2, up: perfect ? 1.6 : 1.2, size: 0.06, life: 0.45, drag: 2.2, fadePow: 1.6 });
        if (perfect) {
          animator.trigger("fistpump");
          animator.expression("joy", 700);
          this.bursts.ring(topPos, "#fff2b0", { radius: 1.2, life: 0.5, opacity: 0.6, tilt: null });
          this.pop(topPos.clone().add(new THREE.Vector3(0, 1.1, 0)), "PERFEKT!", { color: "#ffe36b", size: 0.4 });
        } else {
          animator.expression("effort", 500);
        }
        if (isOwn) {
          this.feedback?.sound(perfect ? "perfect" : "pop", { pan: tower.x * 0.25 });
          this.feedback?.vibrate(perfect ? [8, 20, 12] : 8);
        }
      }
      const top = tower.blocks[height - 1];
      const standY = height ? blockCenterY(height - 1) + BLOCK_H / 2 : STACK_Y;

      const capped = entry.toppled || height >= arcade.total;
      if (capped && !this.lastToppled.get(player.id)) {
        this.lastToppled.set(player.id, true);
        const complete = !entry.toppled || height >= arcade.total;
        if (top) {
          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), new THREE.MeshLambertMaterial({ color: "#5a4a3a" }));
          pole.position.set(top.position.x + 0.42, top.position.y + BLOCK_H / 2 + 0.4, -0.2);
          tower.group.add(pole);
          const flag = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.05), new THREE.MeshLambertMaterial({ color: tower.color, emissive: tower.color, emissiveIntensity: 0.2 }));
          flag.position.set(top.position.x + 0.66, top.position.y + BLOCK_H / 2 + 0.66, -0.2);
          tower.group.add(flag);
          this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.2, 0)), complete ? "🏆" : "🚩", { size: complete ? 0.6 : 0.42, life: 1.1, rise: 1.1 });
        }
        animator.trigger(complete ? "celebrate" : "wave");
        if (isOwn) {
          this.rig.shake(0.5);
          this.feedback?.sound(entry.toppled && height < arcade.total ? "pop" : "win");
          this.feedback?.vibrate(entry.toppled && height < arcade.total ? 12 : [20, 20, 40]);
        }
      }
      // Der nächste Block gleitet auf der nächsten Ebene hin und her — nur
      // der eigene ist zu sehen.
      const active = !capped && !finale;
      tower.hook.visible = active && isOwn;
      if (active) {
        const speed = 1.1 + height * 0.06;
        const swing = Math.sin((elapsed / 1000) * speed + (entry.phase || 0) * Math.PI * 2);
        const blockCentre = swing * (0.85 - height * 0.01);
        const width = Math.max(0.1, entry.width * WORLD_W);
        if (tower.sliderWidth !== width) {
          tower.sliderWidth = width;
          tower.slider.scale.x = width / WORLD_W;
          tower.edges.scale.x = width / WORLD_W;
        }
        tower.hook.position.set(blockCentre * (SLIDE_W / 0.85), blockCenterY(height), 0);
      }
      if (finale) return;
      animator.lookAt(active ? tower.group.localToWorld(tower.hook.position.clone()) : null);
      animator.set(capped ? "happy" : "ready");
    });
    this.smoothTop += (topHeight - this.smoothTop) * frameLerp(0.08, dt);
  }

  // Die Kamera steigt mit der Spitze des EIGENEN Turms — wie beim Handyspiel
  // Stack. Vorher rahmte sie den ganzen Turm vom Boden bis oben: bei zwanzig
  // Etagen waren die Blöcke winzig, und gegen Ende lag die Spitze mit dem
  // gleitenden Block, auf den es ankommt, oben ausserhalb des Bildes. Wie hoch
  // die anderen sind, steht oben in der Leiste.
  rigOptions(f) {
    if (f.finale) {
      // Alle Türme nebeneinander, vom Boden bis zur höchsten Spitze.
      let highest = 0;
      this.towers.forEach((tower) => { highest = Math.max(highest, tower.blocks.length); });
      const topY = STACK_Y + highest * BLOCK_H;
      return {
        look: [0, topY * 0.5 + 0.3, -0.2],
        frame: { w: Math.max(1, this.towers.size) * COL_GAP + 1.4, h: topY + 1.6 }
      };
    }
    const topY = STACK_Y + this.smoothTop * BLOCK_H;
    return {
      look: [0, Math.max(1.4, topY + 0.2), OWN_Z * 0.4],
      frame: { w: 4.6, h: 4.4 }
    };
  }

  keepInView(f) {
    if (f.finale) return [...this.kins.values()];
    const own = this.kins.get(f.controlledId);
    return own ? [own] : [];
  }

  drawHud(f) {
    const { arcade, state, minigame } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.height || 0);
    const heights = this.hud.querySelector("[data-stack-heights]");
    if (heights) {
      const html = state.players.map((player) => {
        const entry = arcade.players[player.id];
        const cls = `hud-chip${player.id === f.controlledId ? " is-own" : ""}${entry?.toppled ? " is-out" : ""}`;
        return `<span class="${cls}" style="--chip:${player.color}"><b>${escapeName(player.name)}</b>${entry?.height || 0}</span>`;
      }).join("");
      if (html !== this.heightsHtml) {
        this.heightsHtml = html;
        heights.innerHTML = html;
      }
    }
    const banner = this.hud.querySelector("[data-stack-banner]");
    if (banner) {
      if ((own?.height || 0) >= arcade.total) {
        banner.hidden = false;
        banner.textContent = "Turm komplett! 🏆";
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if (own?.toppled) {
        banner.hidden = false;
        banner.textContent = "Turm gesetzt 🚩";
        banner.style.background = "#12aaff";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.dropButton) this.dropButton.disabled = Boolean(own?.toppled || (own?.height || 0) >= arcade.total || minigame.finaleAt);
  }
}

function escapeName(name) {
  return String(name || "?").slice(0, 6).replace(/[&<>"']/g, "");
}
