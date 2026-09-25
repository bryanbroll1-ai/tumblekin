import * as THREE from "/vendor/three/three.module.js";
import { createCloud, setKinOpacity } from "./VoxelKit.js?v=tumblekin200";
import { dressMeadow } from "./SceneKit.js?v=tumblekin200";
import { MinigameScene } from "./MinigameScene.js?v=tumblekin200";
import { frameLerp } from "./Quality.js?v=tumblekin200";

// Messerwurf: der Stamm dreht sich, wer dran ist, wirft ein Messer hinein.
// Trifft es ein anderes, gibt es einen zweiten Versuch — danach ist man raus.
//
// Vorher standen alle gleich weit vorn und reglos, das Messer flog aus dem
// Nichts. Jetzt tritt, wer dran ist, in die Mitte, hält das Messer in der
// Hand und wirft es mit dem Arm; die anderen stehen seitlich, schauen auf den
// Stamm, zucken bei einem Klirren zusammen, und wer raus ist, setzt sich.
const LOG_R = 1.02;
const KNIFE_R = LOG_R + 0.02;
const KNIFE_BITE = 0.14;
const LOG_Y = 3.1;
const LOG_Z = -0.3;
const THROW_Z = 1.7;
const SIDE_Z = 2.3;

function buildKnife(color) {
  const knife = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.72, 0.035),
    new THREE.MeshLambertMaterial({ color: "#d8dee8" })
  );
  blade.position.y = 0.36;
  knife.add(blade);
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.055, 0.075),
    new THREE.MeshLambertMaterial({ color: "#ffd15c" })
  );
  guard.position.y = 0.02;
  knife.add(guard);
  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.3, 0.07),
    new THREE.MeshLambertMaterial({ color: color || "#8a5a2c" })
  );
  handle.position.y = -0.16;
  knife.add(handle);
  return knife;
}

export class KnifeThrow extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.knifeMeshes = [];
    this.flyingKnives = [];
    this.lastStuck = new Map();
    this.lastClashes = new Map();
    this.lastEliminated = new Map();
    this.lastServerAt = performance.now();
    this.localAngle = 0;
    this.handKnives = new Map();
    this.labelY = 0.74;
  }

  stage() {
    return { label: "3D Messerwurf", background: "#a8dcf0", fog: ["#b9e3f2", 18, 44] };
  }

  hudHtml() {
    return `
      <div class="kinetic-scorebar"><span data-kinetic-time>0s</span><strong data-kinetic-score>0</strong></div>
      <div class="color-banner" data-knife-banner hidden></div>`;
  }

  build() {
    const scene = this.scene;
    const meadow = new THREE.Mesh(
      new THREE.BoxGeometry(24, 0.5, 16),
      new THREE.MeshLambertMaterial({ color: "#7fce6f" })
    );
    meadow.position.y = -0.25;
    meadow.receiveShadow = true;
    scene.add(meadow);
    // Kulisse: Bodenflecken, Büschel, Blumen, Steine und ein Baumkranz als
    // Horizont. Ohne sie stösst die Wiese als harte Kante gegen den Himmel.
    dressMeadow(this.scene, { seed: 13, keepOut: { x: 4.2, z: 4.6 }, spread: { x: 17, z: 15 }, grassColor: "#4f9e57", patchColors: ["#5aab5f", "#6dbb6f"], crownColor: "#26663a", crownColor2: "#37804a" });
    // Two tall support posts holding the disc up above the throwers.
    [-2.1, 2.1].forEach((x) => {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, LOG_Y + 1.2, 0.34),
        new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
      );
      post.position.set(x, (LOG_Y + 1.2) / 2 - 0.25, LOG_Z - 0.3);
      post.castShadow = true;
      scene.add(post);
    });
    const crossbeam = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 0.3, 0.3),
      new THREE.MeshLambertMaterial({ color: "#6e4522" })
    );
    crossbeam.position.set(0, LOG_Y + 1.1, LOG_Z - 0.3);
    scene.add(crossbeam);

    // The spinning log: a cylinder face-on to the camera.
    this.log = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(LOG_R, LOG_R, 0.7, 20),
      new THREE.MeshLambertMaterial({ color: "#b07a3e" })
    );
    trunk.rotation.x = Math.PI / 2;
    trunk.castShadow = true;
    this.log.add(trunk);
    // Bark rings + a face with tree-ring circles so the spin is readable.
    for (let r = 0.55; r < LOG_R; r += 0.55) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(r, 0.035, 6, 24),
        new THREE.MeshLambertMaterial({ color: "#8a5a2c" })
      );
      ring.position.z = 0.36;
      this.log.add(ring);
    }
    // A bright wedge marker so the rotation is obvious.
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, LOG_R * 0.9, 0.06),
      new THREE.MeshLambertMaterial({ color: "#ff5c8a" })
    );
    marker.position.set(0, LOG_R * 0.45, 0.37);
    this.log.add(marker);
    this.log.position.set(0, LOG_Y, LOG_Z);
    scene.add(this.log);

    this.knifeGroup = new THREE.Group();
    this.log.add(this.knifeGroup);
    // Pool for knives flying up from a thrower into the disc.
    this.flyingKnives = [];

    [[-6, 5.2, -5, 5], [6, 6, -3, 6]].forEach(([x, y, z, seed]) => {
      const cloud = createCloud(seed);
      cloud.position.set(x, y, z);
      scene.add(cloud);
    });

    const players = this.getState()?.players || [];
    players.forEach((player, index) => {
      const x = this.spotForPlayer(player.id, index);
      const kin = this.addKin(player, index, { x, ground: 0, z: SIDE_Z, facing: Math.PI });
      // Ein Messer in der rechten Hand; sichtbar, solange man dran ist.
      const held = buildKnife(player.color);
      held.scale.setScalar(0.7);
      held.position.set(0, -0.2, 0.06);
      held.rotation.x = Math.PI / 2;
      kin.userData.arms?.[1]?.add(held);
      held.visible = false;
      this.handKnives.set(player.id, held);
    });
  }

  shot() {
    return {
      look: [0, 1.95, 0.6],
      frame: { w: 4.3, h: 4.5 },
      pitch: 0.12,
      fov: 38,
      intro: { yaw: 0.5, pitch: 0.2, zoom: 1.35 }
    };
  }

  bind() {
    this.controls.innerHTML = `
      <button type="button" class="nerve-button" data-knife-throw>
        <span class="nerve-button-face">WERFEN!</span>
      </button>`;
    this.throwButton = this.controls.querySelector("[data-knife-throw]");
    const press = (event) => {
      event.preventDefault();
      this.pressThrow();
    };
    this.on(this.throwButton, "pointerdown", press);
    this.on(this.webglCanvas, "pointerdown", press);
  }

  unbind() {
    this.knifeMeshes = [];
    this.flyingKnives = [];
  }

  onUpdate() {
    this.lastServerAt = performance.now();
  }

  pressThrow() {
    const arcade = (this.update || this.minigame)?.arcade;
    const id = this.getControlledPlayerId();
    const own = arcade?.players?.[id];
    if (!own || own.eliminated || own.turnDone) return;
    if (arcade.activeId !== id) return;
    this.feedback?.sound("whoosh");
    this.feedback?.vibrate(12);
    this.sendInput({ action: "throw" }).catch(() => {});
  }

  // Wer dran ist, steht in der Mitte; die anderen verteilen sich seitlich.
  spotForPlayer(playerId, index) {
    const arcade = (this.update || this.minigame)?.arcade;
    const centreId = arcade?.activeId || this.getControlledPlayerId();
    if (playerId === centreId) return 0;
    const players = this.getState()?.players || [];
    const others = players.filter((p) => p.id !== centreId).map((p) => p.id);
    const flanks = [-1.25, 1.25, -2.05, 2.05];
    const slot = others.indexOf(playerId);
    return flanks[(slot >= 0 ? slot : index) % flanks.length];
  }

  syncKnives(arcade) {
    const knives = arcade.knives || [];
    while (this.knifeMeshes.length < knives.length) {
      const data = knives[this.knifeMeshes.length];
      const owner = this.getState()?.players?.find((player) => player.id === data.playerId);
      const holder = new THREE.Group();
      holder.rotation.z = -(data.angleDeg * Math.PI) / 180;
      const knife = buildKnife(owner?.color);
      knife.position.set(0, -(KNIFE_R + 0.36 - KNIFE_BITE), 0.42);
      holder.add(knife);
      holder.visible = false;
      this.knifeGroup.add(holder);
      this.knifeMeshes.push(holder);
      // Aus der Hand des Werfers zum Stamm.
      const fromKin = this.kins.get(data.playerId);
      this.animators.get(data.playerId)?.trigger("throw");
      const flyer = buildKnife(owner?.color);
      const from = fromKin ? fromKin.position.clone().add(new THREE.Vector3(0, 0.75, -0.15)) : new THREE.Vector3(0, 1, THROW_Z);
      flyer.position.copy(from);
      this.scene.add(flyer);
      this.flyingKnives.push({ mesh: flyer, holder, from, startedAt: this.now() });
    }
  }

  updateFlyingKnives(now) {
    const life = 260;
    this.flyingKnives = this.flyingKnives.filter((fk) => {
      const t = (now - fk.startedAt) / life;
      if (t >= 1) {
        this.scene.remove(fk.mesh);
        fk.holder.visible = true;
        this.burst(new THREE.Vector3(0, LOG_Y - LOG_R, LOG_Z + 0.4), ["#d8dee8", "#b07a3e"], { count: 6, speed: 1.4, up: 1, size: 0.05, life: 0.4 });
        return false;
      }
      const to = new THREE.Vector3(0, LOG_Y - LOG_R, LOG_Z + 0.4);
      fk.mesh.position.lerpVectors(fk.from, to, t);
      fk.mesh.position.y += Math.sin(t * Math.PI) * 0.25;
      fk.mesh.rotation.x = -t * Math.PI * 4;
      return true;
    });
  }

  tick(f) {
    const { now, dt, arcade, players, controlledId, finale } = f;
    if (!arcade) return;
    const frameNow = performance.now();
    const dir = (arcade.round || 0) % 2 === 0 ? 1 : -1;
    const snapshotAge = Math.min(0.25, (frameNow - this.lastServerAt) / 1000);
    const target = (arcade.logAngle || 0) + (arcade.spinSpeed || 1) * dir * snapshotAge;
    this.localAngle += (target - this.localAngle) * Math.min(1, dt * 12);
    this.log.rotation.z = this.localAngle;
    this.syncKnives(arcade);
    this.updateFlyingKnives(now);
    const logCentre = new THREE.Vector3(0, LOG_Y, LOG_Z);

    players.forEach((player, index) => {
      const entry = arcade.players[player.id];
      const kin = this.kins.get(player.id);
      const animator = this.animators.get(player.id);
      if (!entry || !kin || !animator) return;
      const out = Boolean(entry.eliminated);
      const isActive = arcade.activeId === player.id && !out;
      const isOwn = player.id === controlledId;
      const spotX = this.spotForPlayer(player.id, index);
      kin.position.x += (spotX - kin.position.x) * frameLerp(0.12, dt);
      kin.position.z += ((isActive ? THROW_Z : SIDE_Z + (out ? 0.5 : 0)) - kin.position.z) * frameLerp(0.1, dt);
      const moving = Math.abs(spotX - kin.position.x) > 0.08;
      const held = this.handKnives.get(player.id);
      if (held) held.visible = isActive && !entry.turnDone && !finale;

      if ((entry.stuck || 0) > (this.lastStuck.get(player.id) || 0)) {
        this.lastStuck.set(player.id, entry.stuck);
        animator.trigger("fistpump");
        animator.expression("joy", 600);
        const hitPos = new THREE.Vector3(0, LOG_Y - LOG_R, LOG_Z + 0.4);
        this.bursts.ring(hitPos, "#ffe36b", { radius: 1, life: 0.4, opacity: 0.5, tilt: null });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "TREFFER!", { color: "#ffe36b", size: 0.36, life: 0.85 });
        if (isOwn) {
          this.feedback?.sound("pop");
          this.feedback?.vibrate(10);
        }
      }
      // Klirren: Messer auf Messer.
      if ((entry.clashes || 0) > (this.lastClashes.get(player.id) || 0)) {
        this.lastClashes.set(player.id, entry.clashes);
        animator.trigger("flinch");
        animator.expression("scared", 900);
        this.rig.shake(0.4);
        this.burst(new THREE.Vector3(0, LOG_Y - LOG_R, LOG_Z + 0.5), ["#ffffff", "#ffe36b", "#d8dee8"], { count: 12, speed: 2.6, up: 1.6, size: 0.05, life: 0.4 });
        this.animators.forEach((other, id) => {
          if (id !== player.id) other.expression("surprised", 500);
        });
      }
      if (out && !this.lastEliminated.get(player.id)) {
        this.lastEliminated.set(player.id, true);
        animator.trigger("stumble");
        animator.expression("sad", 1600);
        this.rig.shake(0.7);
        const outPos = kin.position.clone().add(new THREE.Vector3(0, 0.5, 0));
        this.burst(outPos, ["#ff2038", player.color, "#ffffff"], { count: 14, speed: 2.4, up: 2, size: 0.09, life: 0.75, drag: 1.4 });
        this.pop(kin.position.clone().add(new THREE.Vector3(0, 1.1, 0)), "RAUS!", { color: "#ff6b7f", size: 0.44, life: 0.95 });
        if (isOwn) {
          this.feedback?.sound("error");
          this.feedback?.vibrate([26, 20, 34]);
        }
      }
      setKinOpacity(kin, out ? 0.75 : 1);
      if (finale) {
        kin.rotation.y += Math.atan2(Math.sin(-kin.rotation.y), Math.cos(-kin.rotation.y)) * frameLerp(0.08, dt);
        return;
      }
      // Zum Stamm gedreht, beim Umsetzen in Laufrichtung.
      const face = moving ? (spotX > kin.position.x ? Math.PI / 2 : -Math.PI / 2) : Math.PI + Math.atan2(kin.position.x, kin.position.z - LOG_Z) * 0.5;
      kin.rotation.y += Math.atan2(Math.sin(face - kin.rotation.y), Math.cos(face - kin.rotation.y)) * frameLerp(0.2, dt);
      animator.lookAt(logCentre);
      if (out) animator.set("sit");
      else if (moving) animator.set("walk");
      else if (isActive) animator.set("aim");
      else animator.set("focus");
    });
  }

  keepInView(f) {
    return f.players.map((player) => this.kins.get(player.id)).filter(Boolean);
  }

  drawHud(f) {
    const { arcade, state, now, minigame } = f;
    if (!arcade) return;
    const own = arcade.players[f.controlledId];
    this.scoreNode ||= this.hud.querySelector("[data-kinetic-score]");
    this.scoreNode.textContent = String(own?.stuck || 0);
    const id = this.getControlledPlayerId();
    const myTurn = arcade.activeId === id && !own?.eliminated && !own?.turnDone;
    const turnLeft = arcade.turnEndsAt ? Math.max(0, Math.ceil((arcade.turnEndsAt - now) / 1000)) : 0;
    const activePlayer = state.players.find((p) => p.id === arcade.activeId);
    const banner = this.hud.querySelector("[data-knife-banner]");
    // Runde und Leben gehören sichtbar dazu: es wird mehrfach geworfen, und ein
    // Fehlwurf ist nicht sofort das Aus. Ohne die Anzeige wäre beides Rätselraten.
    // Keine Rundenzahl mehr — gespielt wird, bis nur noch einer steht. Was
    // zählt, ist also, wie viele noch dabei sind.
    const übrig = Object.values(arcade.players || {}).filter((entry) => !entry.eliminated).length;
    const roundLabel = übrig > 1 ? ` · noch ${übrig} dabei` : "";
    if (banner) {
      banner.hidden = false;
      if (own?.eliminated) {
        banner.textContent = "Zweimal daneben – raus!";
        banner.style.background = "#40506a";
        banner.style.color = "#ffffff";
      } else if ((own?.clashes || 0) > 0 && myTurn) {
        banner.textContent = `Letzter Versuch! ${turnLeft}s${roundLabel}`;
        banner.style.background = "#e0334f";
        banner.style.color = "#ffffff";
      } else if (myTurn) {
        banner.textContent = `Du bist dran! ${turnLeft}s${roundLabel}`;
        banner.style.background = "#ffc400";
        banner.style.color = "#5c4508";
      } else if (arcade.activeId) {
        banner.textContent = `${(activePlayer?.name || "Gegner").slice(0, 8)} wirft … ${turnLeft}s${roundLabel}`;
        banner.style.background = "#12aaff";
        banner.style.color = "#ffffff";
      } else {
        banner.hidden = true;
      }
    }
    if (this.throwButton) this.throwButton.disabled = !myTurn || Boolean(minigame.finaleAt);
  }
}
