import * as THREE from "/vendor/three/three.module.js";
import { frameLerp, prefersReducedMotion, qualityTier } from "./Quality.js?v=tumblekin200";

// Die Kamera der Minispiele.
//
// Vorher stand in jedem der 31 Spiele eine eigene Kamera aus geschätzten
// Zahlen: eine Position fürs Hochformat, eine fürs Querformat, ein lookAt, und
// wenn das nicht reichte, schob fitKinsInView die Kamera hinterher zurück.
// Dass oben die Punkteleiste und unten die Knöpfe einen Teil des Bildes
// verdecken, wusste keine davon — gerahmt wurde auf den ganzen Bildschirm, und
// das Wichtigste lag oft genau unter einem Knopf.
//
// Das Rig bekommt statt Koordinaten eine Beschreibung: WORAUF geschaut wird,
// WIE GROSS das Motiv ist und AUS WELCHEM WINKEL. Den Abstand rechnet es
// selbst, passend zu dem Band, das HUD und Steuerung frei lassen — dieselbe
// Technik wie bei der Menübühne: das Bildzentrum wird in dieses Band verschoben,
// statt das Bild zu beschneiden. Hoch- und Querformat brauchen damit keine
// eigenen Zahlen mehr.
//
// Dazu kommen, einheitlich für alle Spiele:
//   Anflug     während des Countdowns schwenkt die Kamera aus der Totalen ein
//   Sicherung  Figuren, die aus dem Band laufen, holt die Kamera zurück ins Bild
//   Schütteln  mit Abklingen (Trauma), aus bei reduzierter Bewegung
//   Finale     in den letzten Sekunden eine Fahrt auf den Sieger

const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Wie weit ein Punkt vor der Kamera stehen muss, damit er mit Rand ins Band
// passt. `tanV`/`tanH` sind die halben Öffnungen des Bandes.
function neededDepth(relative, tanV, tanH, margin) {
  const x = Math.abs(relative.dot(_right));
  const y = relative.dot(_up);
  const z = relative.dot(_fwd);
  const byX = x / (tanH * margin);
  const byY = Math.abs(y) / (tanV * margin);
  return { z, need: Math.max(byX, byY) };
}

export class CameraRig {
  constructor(host, shot = {}) {
    this.host = host;
    this.reduced = prefersReducedMotion();
    this.base = normalizeShot(shot);
    this.current = normalizeShot(shot);
    this.lookNow = new THREE.Vector3().fromArray(this.base.look);
    this.distanceNow = null;
    this.trauma = 0;
    this.shakeSeed = Math.random() * 100;
    this.band = null;
    this.bandCheckedAt = 0;
    this.lastSize = { w: 0, h: 0 };
    this.push = 0;
    this.lateral = new THREE.Vector3();
    this.introMs = shot.introMs ?? 3600;
  }

  // Grundeinstellung ändern (z. B. wenn das Spiel in eine andere Phase geht).
  // Das Rig blendet weich hinüber.
  setShot(shot, { cut = false } = {}) {
    this.base = normalizeShot({ ...this.base, ...shot });
    if (cut) {
      this.current = normalizeShot(this.base);
      this.lookNow.fromArray(this.base.look);
      this.distanceNow = null;
    }
  }

  shake(amount = 0.4) {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  // Das freie Band: zwischen der Unterkante der oberen Anzeigen und der
  // Oberkante der Steuerung. Szenen mit eigener Aufteilung geben `insets` mit.
  measureBand(width, height) {
    const canvas = this.host.webglCanvas;
    const rect = canvas?.getBoundingClientRect() || { top: 0, left: 0, width, height };
    let top = 0;
    let bottom = height;
    const insets = this.base.insets;
    if (insets) {
      top = insets.top ?? 0;
      bottom = height - (insets.bottom ?? 0);
    } else {
      const bar = this.host.hud?.querySelector(".kinetic-scorebar");
      if (bar && bar.offsetParent !== null) {
        top = Math.max(top, bar.getBoundingClientRect().bottom - rect.top + 6);
      }
      const controls = this.host.controls;
      if (controls && controls.children.length) {
        let highest = Infinity;
        [...controls.children].forEach((child) => {
          if (child.offsetParent === null) return;
          const r = child.getBoundingClientRect();
          if (r.height > 8) highest = Math.min(highest, r.top - rect.top);
        });
        if (Number.isFinite(highest)) bottom = Math.min(bottom, highest - 8);
      }
    }
    // Nie weniger als die Hälfte des Bildes: lieber etwas unter einem Knopf
    // als eine Szene im Briefschlitz.
    if (bottom - top < height * 0.5) {
      const mid = (top + bottom) / 2;
      top = Math.max(0, mid - height * 0.25);
      bottom = Math.min(height, top + height * 0.5);
    }
    return { top, bottom, left: 0, right: width };
  }

  resize() {
    const host = this.host;
    const canvas = host.webglCanvas;
    if (!canvas || !host.renderer) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    if (width !== this.lastSize.w || height !== this.lastSize.h) {
      host.renderer.setSize(width, height, false);
      this.lastSize = { w: width, h: height };
      this.band = null;
    }
    const now = performance.now();
    if (!this.band || now - this.bandCheckedAt > 600) {
      this.band = this.measureBand(width, height);
      this.bandCheckedAt = now;
    }
    return { width, height };
  }

  // Einmal je Bild. `opts`:
  //   look      Blickpunkt überschreiben (Vector3 oder [x,y,z])
  //   frame     Motivgrösse überschreiben { w, h }
  //   keep      Figuren (Object3D), die im Bild bleiben sollen
  //   own       die eigene Figur — sie MUSS im Bild bleiben
  //   minigame  für Anflug und Finale (startedAt, finaleAt)
  //   winner    Object3D, auf das das Finale fährt
  update(dt, now, opts = {}) {
    const host = this.host;
    const camera = host.camera;
    if (!camera) return;
    const size = this.resize();
    if (!size) return;
    const { width, height } = size;
    const band = this.band;
    const bandH = Math.max(80, band.bottom - band.top);
    const bandW = Math.max(80, band.right - band.left);

    // Ziel dieser Einstellung.
    const target = this.current;
    const base = this.base;
    const k = frameLerp(base.ease, dt);
    const lookGoal = opts.look ? toVector(opts.look, _v).clone() : new THREE.Vector3().fromArray(base.look);
    let frameW = opts.frame?.w ?? base.frame.w;
    let frameH = opts.frame?.h ?? base.frame.h;
    let yaw = base.yaw;
    let pitch = base.pitch;

    // Anflug während des Countdowns: aus der Totalen, leicht gedreht.
    const minigame = opts.minigame;
    if (minigame?.startedAt && base.intro && !this.reduced) {
      const left = minigame.startedAt - now;
      if (left > 0) {
        const p = 1 - Math.min(1, left / this.introMs);
        const e = 1 - smoothstep(p);
        yaw += base.intro.yaw * e;
        pitch += base.intro.pitch * e;
        frameW *= 1 + (base.intro.zoom - 1) * e;
        frameH *= 1 + (base.intro.zoom - 1) * e;
      }
    }

    // Finale: auf den Sieger zufahren.
    if (minigame?.finaleAt && opts.winner && base.finale) {
      const winnerPos = opts.winner.getWorldPosition(new THREE.Vector3());
      winnerPos.y += base.finale.lift;
      lookGoal.lerp(winnerPos, base.finale.pull);
      frameW *= base.finale.zoom;
      frameH *= base.finale.zoom;
      if (!this.reduced) yaw += Math.sin(now / 2400) * base.finale.orbit;
    }

    target.yaw += (yaw - target.yaw) * k;
    target.pitch += (pitch - target.pitch) * k;
    target.frame.w += (frameW - target.frame.w) * k;
    target.frame.h += (frameH - target.frame.h) * k;
    this.lookNow.lerp(lookGoal, k);

    // Abstand aus der Motivgrösse und dem Band.
    const tanV = Math.tan(THREE.MathUtils.degToRad(base.fov) / 2);
    const tanH = tanV * (bandW / bandH);
    const fill = base.fill;
    let distance = Math.max(target.frame.h / (2 * tanV * fill), target.frame.w / (2 * tanH * fill), base.minDistance);
    distance = Math.min(distance, base.maxDistance);
    this.distanceNow = this.distanceNow === null ? distance : this.distanceNow + (distance - this.distanceNow) * k;

    // Kamera setzen.
    const cosP = Math.cos(target.pitch);
    const offset = new THREE.Vector3(Math.sin(target.yaw) * cosP, Math.sin(target.pitch), Math.cos(target.yaw) * cosP);
    camera.position.copy(this.lookNow).addScaledVector(offset, this.distanceNow);
    camera.lookAt(this.lookNow);
    camera.updateMatrixWorld();

    // Sicherung: Figuren, die aus dem Band laufen, holen die Kamera zurück.
    const keep = [...(opts.keep || [])];
    if (opts.own) keep.push(opts.own);
    let wantPush = 0;
    const lateral = new THREE.Vector3();
    if (keep.length) {
      camera.matrixWorld.extractBasis(_right, _up, _fwd);
      _fwd.negate();
      keep.forEach((object) => {
        if (!object || object.visible === false) return;
        const world = object.getWorldPosition(new THREE.Vector3());
        // Figurenmitte und Kopf mit Schild: beide sollen ins Bild.
        [0, 0.55].forEach((lift) => {
          const rel = world.clone().add(new THREE.Vector3(0, lift, 0)).sub(camera.position);
          const { z, need } = neededDepth(rel, tanV, tanH, base.keepMargin);
          wantPush = Math.max(wantPush, need - z);
        });
      });
      // Die eigene Figur: wenn sie weit draussen ist, auch seitlich nachführen.
      if (opts.own && opts.own.visible !== false) {
        const own = opts.own.getWorldPosition(new THREE.Vector3());
        const rel = own.clone().sub(camera.position);
        const x = rel.dot(_right);
        const z = Math.max(0.5, rel.dot(_fwd));
        const limit = tanH * z * base.keepMargin;
        if (Math.abs(x) > limit) lateral.copy(_right).multiplyScalar((Math.abs(x) - limit) * Math.sign(x) * 0.6);
      }
    }
    wantPush = Math.min(Math.max(0, wantPush), base.maxPush);
    this.push += (wantPush - this.push) * frameLerp(wantPush > this.push ? 0.25 : 0.05, dt);
    this.lateral.lerp(lateral, frameLerp(0.1, dt));
    if (this.push > 0.001 || this.lateral.lengthSq() > 1e-6) {
      camera.position.addScaledVector(offset, this.push).add(this.lateral);
      camera.lookAt(_v.copy(this.lookNow).add(this.lateral));
    }

    // Schütteln: Trauma zum Quadrat, weiches Rauschen, klingt ab.
    if (this.trauma > 0.001) {
      const t = now / 1000 + this.shakeSeed;
      const power = this.trauma * this.trauma * base.shakeScale;
      camera.position.x += (Math.sin(t * 37) + Math.sin(t * 23.1) * 0.5) * 0.16 * power;
      camera.position.y += (Math.sin(t * 31.7) + Math.sin(t * 17.3) * 0.5) * 0.12 * power;
      camera.rotateZ((Math.sin(t * 29.3)) * 0.035 * power);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }

    // Projektion aufs Band.
    const centerY = (band.top + band.bottom) / 2;
    const centerX = (band.left + band.right) / 2;
    const fullH = 2 * Math.max(centerY, height - centerY);
    const fullW = 2 * Math.max(centerX, width - centerX);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV * fullH / bandH));
    camera.aspect = fullW / fullH;
    camera.setViewOffset(fullW, fullH, fullW / 2 - centerX, fullH / 2 - centerY, width, height);
    camera.near = base.near;
    camera.far = base.far;
    camera.updateProjectionMatrix();
  }

  // Wo liegt ein Weltpunkt auf dem Bildschirm (CSS-Pixel)? Für HUD-Elemente,
  // die an einer Figur hängen sollen.
  toScreen(point) {
    const camera = this.host.camera;
    const { w, h } = this.lastSize;
    const p = toVector(point, new THREE.Vector3()).project(camera);
    return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h, behind: p.z > 1 };
  }
}

function normalizeShot(shot) {
  return {
    look: toArray(shot.look ?? [0, 1, 0]),
    yaw: shot.yaw ?? 0,
    pitch: shot.pitch ?? 0.32,
    frame: { w: shot.frame?.w ?? 6, h: shot.frame?.h ?? 3.2 },
    fov: shot.fov ?? 34,
    fill: shot.fill ?? 0.9,
    minDistance: shot.minDistance ?? 2.5,
    maxDistance: shot.maxDistance ?? 60,
    maxPush: shot.maxPush ?? 6,
    keepMargin: shot.keepMargin ?? 0.9,
    ease: shot.ease ?? 0.09,
    near: shot.near ?? 0.1,
    far: shot.far ?? 140,
    insets: shot.insets ?? null,
    shakeScale: qualityTier() === "low" ? 0.8 : 1,
    intro: shot.intro === false ? null : { yaw: 0.55, pitch: 0.22, zoom: 1.5, ...(shot.intro || {}) },
    finale: shot.finale === false ? null : { pull: 0.55, zoom: 0.62, lift: 0.4, orbit: 0.18, ...(shot.finale || {}) }
  };
}

function toArray(value) {
  if (Array.isArray(value)) return [...value];
  return [value.x, value.y, value.z];
}

function toVector(value, into) {
  if (value?.isVector3) return into.copy(value);
  return into.set(value[0], value[1], value[2]);
}

function smoothstep(x) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

// Den Sieger eines Minispiels finden: Platz 1 laut Server, sonst nichts.
export function finaleWinner(minigame, kins) {
  const places = minigame?.arcade?.places || minigame?.arena?.places;
  if (!places || !minigame.finaleAt) return null;
  const ids = Object.keys(places).filter((id) => places[id] === 1);
  if (ids.length !== 1) return null;
  return kins.get(ids[0]) || null;
}
