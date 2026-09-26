import * as THREE from "/vendor/three/three.module.js";
import { fxScale } from "./Quality.js?v=tumblekin200";

// Shared voxel building blocks for the 3D minigame dioramas.
//
// Figur und Animation liegen in Kin.js. Sie werden hier weitergereicht, damit
// jede Szene sie wie gewohnt aus dem VoxelKit holen kann.
export {
  KIN_SOLE,
  standOn,
  createKin,
  createVoxelKin,
  KinAnimator,
  KIN_STATES,
  setKinOpacity,
  flashKin,
  finalePose,
  applyFinaleMood,
  reachArm
} from "./Kin.js?v=tumblekin200";

// Weicher Kontaktschatten: eine runde Scheibe mit Verlauf nach aussen. Der
// frühere Schatten war ein Quader mit harter Kante — unter jeder Figur lag ein
// dunkles Quadrat. Die Textur wird einmal gebaut und von allen geteilt.
let schattenTextur = null;
function weicherSchatten() {
  if (schattenTextur && !schattenTextur.userData.disposed) return schattenTextur;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const verlauf = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  verlauf.addColorStop(0, "rgba(255,255,255,1)");
  verlauf.addColorStop(0.45, "rgba(255,255,255,0.8)");
  verlauf.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = verlauf;
  ctx.fillRect(0, 0, 64, 64);
  schattenTextur = new THREE.CanvasTexture(canvas);
  const dispose = schattenTextur.dispose.bind(schattenTextur);
  schattenTextur.dispose = () => { schattenTextur.userData.disposed = true; dispose(); };
  return schattenTextur;
}

export function createShadowBlob(size = 0.55) {
  const geometry = new THREE.PlaneGeometry(size * 1.25, size * 1.25);
  // Flach in die XZ-Ebene gedreht, damit scale.set(x, 1, z) wie beim alten
  // Quader die Grundfläche streckt.
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: "#0a2430", map: weicherSchatten(), transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false })
  );
  mesh.renderOrder = 1;
  // Ein Schattenfleck ist ein Aufkleber, kein Boden. Ohne die Markierung hält
  // ihn der Bodenprüfer für die Fläche, auf der die Figur steht.
  mesh.userData.isShadow = true;
  return mesh;
}

// Eine Voxelwolke: ein breiter, flacher Sockel und zwei, drei Aufbauten
// darauf. Deckend und leicht selbstleuchtend — halbtransparent und nur vom
// Himmelslicht beleuchtet wurden die Unterseiten grau-grünlich, und die
// Wolken sahen aus wie schmutzige Platten statt wie Wolken.
let wolkenMaterial = null;
export function createCloud(seed = 0) {
  const group = new THREE.Group();
  if (!wolkenMaterial || wolkenMaterial.userData.disposed) {
    wolkenMaterial = new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#e8f1fa", emissiveIntensity: 0.45 });
    const dispose = wolkenMaterial.dispose.bind(wolkenMaterial);
    wolkenMaterial.dispose = () => { wolkenMaterial.userData.disposed = true; dispose(); };
  }
  const breite = 1.3 + noise(seed * 5 + 1) * 0.6;
  const sockel = new THREE.Mesh(new THREE.BoxGeometry(breite, 0.24, 0.62), wolkenMaterial);
  group.add(sockel);
  const aufbauten = 2 + (seed % 2);
  for (let index = 0; index < aufbauten; index += 1) {
    const size = 0.38 + noise(seed * 3 + index * 7) * 0.3;
    const chunk = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.72, size * 0.85), wolkenMaterial);
    const t = aufbauten === 1 ? 0.5 : index / (aufbauten - 1);
    chunk.position.set((t - 0.5) * (breite - size) * 0.9, 0.12 + size * 0.36, (noise(seed + index) - 0.5) * 0.15);
    group.add(chunk);
  }
  return group;
}

// A downward-pointing "you" arrow that bobs above the controlled player's
// kin so you can always find yourself among the crowd. Attach it to a kin and
// call updateOwnMarker() each frame.
export function createOwnMarker(color = "#ffe25c") {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.26, 0.12),
    new THREE.MeshBasicMaterial({ color })
  );
  shaft.position.y = 0.2;
  group.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.26, 4),
    new THREE.MeshBasicMaterial({ color })
  );
  tip.rotation.x = Math.PI;
  tip.rotation.y = Math.PI / 4;
  group.add(tip);
  // A white outline cone just behind for contrast against any background.
  const outline = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.32, 4),
    new THREE.MeshBasicMaterial({ color: "#ffffff" })
  );
  outline.rotation.x = Math.PI;
  outline.rotation.y = Math.PI / 4;
  outline.position.z = -0.02;
  outline.scale.setScalar(1);
  group.add(outline);
  group.renderOrder = 999;
  group.userData = { phase: Math.random() * Math.PI * 2 };
  return group;
}

// `lift` ist der Abstand zwischen Figurenkopf und Pfeil. Die 0.9 stammen aus
// Szenen mit fast waagerechter Kamera; schaut die Kamera steil von oben, wird
// aus demselben Höhenversatz ein grosser Sprung im Bild — bei Farbenjagd
// schwebte der Pfeil rund 150 Pixel über seiner Figur, oben in der Anzeige.
// Solche Szenen geben einen kleineren Wert mit.
export function updateOwnMarker(marker, now, baseY, lift = 0.9) {
  if (!marker) return;
  marker.position.y = baseY + lift + Math.sin(now / 260 + marker.userData.phase) * 0.1;
  marker.rotation.y = Math.sin(now / 500) * 0.3;
}

export function createNameLabel(text, accent) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 88;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(21, 33, 38, 0.88)";
  roundRect(ctx, 10, 12, 236, 64, 30);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = accent;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 40px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 46);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.62, 0.21, 1);
  return sprite;
}

export class CubeBurst {
  constructor(scene) {
    this.scene = scene;
    this.pieces = [];
    this.rings = [];
  }

  // Confetti/spark burst. `drag` adds air resistance so shards decelerate for a
  // punchier pop; `fadePow` shapes the fade (>1 keeps pieces solid then snaps
  // out); `spin` scales the tumble speed. All optional and backward compatible.
  spawn(position, colors, { count = 10, speed = 1.9, up = 2.1, size = 0.075, gravity = 5.4, life = 0.7, drag = 0, fadePow = 1, spin = 12 } = {}) {
    const palette = Array.isArray(colors) ? colors : [colors];
    // Thinned for reduced-motion players and low-tier GPUs. Scaling here covers
    // every spawn call in every minigame; at least one shard always survives so
    // the event stays readable.
    const total = Math.max(1, Math.round(count * fxScale()));
    for (let index = 0; index < total; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size * (0.7 + Math.random() * 0.6), size, size),
        new THREE.MeshBasicMaterial({ color: palette[index % palette.length], transparent: true })
      );
      mesh.position.copy(position);
      // Effekt, keine Kulisse: Prüfskripte (Boden, Kollision) übergehen ihn.
      mesh.userData.isFx = true;
      const angle = Math.random() * Math.PI * 2;
      const radial = speed * (0.4 + Math.random() * 0.6);
      this.scene.add(mesh);
      this.pieces.push({
        mesh,
        vx: Math.cos(angle) * radial,
        vy: up * (0.5 + Math.random() * 0.6),
        vz: Math.sin(angle) * radial,
        spinX: (Math.random() - 0.5) * spin,
        spinY: (Math.random() - 0.5) * spin,
        age: 0,
        life: life * (0.85 + Math.random() * 0.3),
        gravity,
        drag,
        fadePow
      });
    }
  }

  // Flat, ground-hugging shockwave ring that scales out and fades — great for
  // impacts, perfect hits and eliminations.
  ring(position, color = "#ffffff", { life = 0.5, radius = 1.7, opacity = 0.55, y = 0.06, tilt = -Math.PI / 2 } = {}) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })
    );
    mesh.position.set(position.x, tilt === null ? position.y : y, position.z);
    if (tilt !== null) mesh.rotation.x = tilt;
    mesh.scale.setScalar(0.12);
    mesh.renderOrder = 2;
    mesh.userData.isFx = true;
    this.scene.add(mesh);
    this.rings.push({ mesh, age: 0, life, radius, opacity });
  }

  update(dt) {
    this.pieces = this.pieces.filter((piece) => {
      piece.age += dt;
      if (piece.age >= piece.life) {
        this.scene.remove(piece.mesh);
        piece.mesh.geometry.dispose();
        piece.mesh.material.dispose();
        return false;
      }
      piece.vy -= piece.gravity * dt;
      if (piece.drag) {
        const damp = Math.max(0, 1 - piece.drag * dt);
        piece.vx *= damp;
        piece.vy *= damp;
        piece.vz *= damp;
      }
      piece.mesh.position.x += piece.vx * dt;
      piece.mesh.position.y += piece.vy * dt;
      piece.mesh.position.z += piece.vz * dt;
      piece.mesh.rotation.x += piece.spinX * dt;
      piece.mesh.rotation.y += piece.spinY * dt;
      piece.mesh.material.opacity = Math.pow(Math.max(0, 1 - piece.age / piece.life), piece.fadePow);
      return true;
    });
    this.rings = this.rings.filter((ring) => {
      ring.age += dt;
      const progress = ring.age / ring.life;
      if (progress >= 1) {
        this.scene.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        ring.mesh.material.dispose();
        return false;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      ring.mesh.scale.setScalar(0.12 + eased * ring.radius);
      ring.mesh.material.opacity = ring.opacity * (1 - progress);
      return true;
    });
  }

  dispose() {
    this.pieces.forEach((piece) => {
      this.scene.remove(piece.mesh);
      piece.mesh.geometry.dispose();
      piece.mesh.material.dispose();
    });
    this.rings.forEach((ring) => {
      this.scene.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      ring.mesh.material.dispose();
    });
    this.pieces = [];
    this.rings = [];
  }
}

// Schiebt eine Einblendung so weit zur Seite, dass sie ganz im Bild bleibt.
//
// Die Texte erscheinen über der Figur, der sie gelten — und Figuren stehen am
// Bildrand. "FEHLSTART!" über dem linken Läufer war damit halb abgeschnitten,
// "GESTOLPERT!" über zwei Springern gleichzeitig ergab Buchstabensalat. Ein
// Ausruf, den man nicht lesen kann, ist schlimmer als keiner: man sieht, dass
// etwas passiert ist, erfährt aber nicht was.
//
// Gerechnet wird im Bildraum: die halbe Textbreite in Bildkoordinaten ergibt
// sich aus der Weltbreite geteilt durch die sichtbare Breite in dieser Tiefe.
// Verschoben wird entlang der Kamera-Rechtsachse, damit der Text auf gleicher
// Höhe bleibt und nur seitlich einrückt.
const _rechts = new THREE.Vector3();
const _ndc = new THREE.Vector3();
function haltImBild(sprite, camera, weltBreite) {
  camera.updateMatrixWorld();
  _ndc.copy(sprite.position).project(camera);
  const tiefe = sprite.position.distanceTo(camera.position);
  const halbSichtbar = tiefe * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect;
  if (!(halbSichtbar > 0)) return;
  // Ist der Text breiter als das Bild, half Verschieben früher gar nichts: die
  // Funktion gab auf, und "TREFFER! 4 übrig" lief bei Sumoschubs rechts aus dem
  // Bild. Ein zu breiter Text wird jetzt so weit verkleinert, dass er passt —
  // kleiner und ganz lesbar schlägt gross und halb abgeschnitten. update()
  // setzt die Skalierung jedes Bild neu, das Schrumpfen summiert sich also nicht.
  const passtBreite = halbSichtbar * 2 * 0.94;
  if (weltBreite > passtBreite) {
    sprite.scale.multiplyScalar(passtBreite / weltBreite);
    weltBreite = passtBreite;
  }
  const halbText = (weltBreite / 2) / halbSichtbar;
  const grenze = 0.97 - halbText;
  if (grenze <= 0) return;
  const ueber = Math.abs(_ndc.x) - grenze;
  if (ueber <= 0) return;
  camera.matrixWorld.extractBasis(_rechts, new THREE.Vector3(), new THREE.Vector3());
  sprite.position.addScaledVector(_rechts, -Math.sign(_ndc.x) * ueber * halbSichtbar);
}

// Pop-up 3D score/emote text that springs in, floats up and fades. One manager
// per scene; call pop() on events and update(dt) each frame.
export class FloatingText {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  pop(position, text, { color = "#ffffff", size = 0.5, life = 0.95, rise = 0.9, stroke = "rgba(18,38,48,0.6)" } = {}) {
    const FONT_PX = 82;
    const PAD = 26;                 // room for the outline stroke on both sides
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const font = `900 ${FONT_PX}px ui-rounded, system-ui, sans-serif`;

    // Size the canvas to the text instead of clipping it: a fixed 256px canvas
    // cut off anything past ~5 characters ("PERFEKT!" rendered as "ERFEK").
    ctx.font = font;
    const width = Math.ceil(ctx.measureText(text).width) + PAD * 2;
    const height = FONT_PX + PAD * 2;
    canvas.width = width;
    canvas.height = height;

    // Resizing the canvas resets the 2D context, so restyle after sizing.
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 18;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, width / 2, height / 2 + 2);
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.position.copy(position);
    sprite.renderOrder = 1000;
    this.scene.add(sprite);
    // Keep the sprite's on-screen aspect equal to the canvas so wide labels
    // stay legible instead of being squeezed into a fixed 2:1 box.
    this.items.push({ sprite, age: 0, life, rise, baseY: position.y, size, aspect: width / height });
  }

  // `camera` ist freiwillig, aber ohne sie kann der Text nicht im Bild gehalten
  // werden. Alle Szenen reichen sie durch.
  update(dt, camera = null) {
    this.items = this.items.filter((item) => {
      item.age += dt;
      const progress = item.age / item.life;
      if (progress >= 1) {
        this.scene.remove(item.sprite);
        item.sprite.material.map?.dispose?.();
        item.sprite.material.dispose();
        return false;
      }
      item.sprite.position.y = item.baseY + item.rise * (1 - Math.pow(1 - progress, 2));
      // Springy pop-in (overshoot) then settle; fade out over the final third.
      const pop = progress < 0.22 ? Math.sin((progress / 0.22) * (Math.PI / 2)) * 1.15 : 1 + (0.15 * Math.max(0, 1 - (progress - 0.22) / 0.15));
      const scale = item.size * pop;
      item.sprite.scale.set(scale * (item.aspect || 2), scale, 1);
      item.sprite.material.opacity = progress < 0.66 ? 1 : 1 - (progress - 0.66) / 0.34;
      if (camera) haltImBild(item.sprite, camera, scale * (item.aspect || 2));
      return true;
    });
  }

  dispose() {
    this.items.forEach((item) => {
      this.scene.remove(item.sprite);
      item.sprite.material.map?.dispose?.();
      item.sprite.material.dispose();
    });
    this.items = [];
  }
}

export function disposeScene(scene) {
  scene.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      material.map?.dispose?.();
      material.dispose?.();
    });
  });
}

export function noise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
