import * as THREE from '/vendor/three/three.module.js';
import { MinigameScene } from './MinigameScene.js?v=tumblekin208';
import { standOn, createCloud } from './VoxelKit.js?v=tumblekin208';
import { VirtualJoystick } from './VirtualJoystick.js?v=tumblekin208';
import { frameLerp, prefersReducedMotion } from './Quality.js?v=tumblekin208';
import { arenaShrinkCue } from './FeedbackCues.js?v=tumblekin208';
import { kiste, viele, lambert } from './Kulisse.js?v=tumblekin208';
import './BumperPhysics.js?v=tumblekin208';
const P = globalThis.TumblekinBumperPhysics;
const SCALE = 3.4, DECK = .25, WATER = -.12;
const RING = P.C.BALL_RADIUS * SCALE;
const reduced = () => prefersReducedMotion();

export class BounceArena extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.blooms = new Map(); this.state = new Map(); this.cards = new Map();
    this.ownInView = false; this.finaleFocus = false;
    this.lastEvent = 0; this.vector = { x: 0, y: 0 }; this.keys = new Set();
    this.keyTimer = null; this.freezeUntil = 0;
    this.lastImpactSound = -1000; this.warningPhase = 'none';
    this.labelY = .95;
  }
  stage() {
    return { label: '3D Bumper Pool – Schwimmring-Rammduell', background: '#b5e4ef',
      fog: ['#b5e4ef', 20, 52], lights: { sunPosition: [-5, 10, 7], sunIntensity: 2.4,
        skyColor: 0xeafaff, groundColor: 0x729bb0 } };
  }
  hudHtml() {
    return `<div class="kinetic-scorebar"><span data-kinetic-time>45s</span><strong data-kinetic-score>3</strong><span data-bumper-kos>0 raus</span></div>
      <div class="bumper-players" aria-label="Leben aller Spieler"></div>
      <div class="arena-shrink" data-arena-shrink role="status" hidden></div>
      <div class="bumper-status" data-arena-banner role="status" hidden></div>`;
  }
  build() {
    kiste(this.scene, 15, .35, 13, '#73cbd9', [0, WATER - .18, 0]);
    const tiles = [];
    for (const side of [-1, 1]) for (let i = 0; i < 17; i++) {
      tiles.push({ p: [side * 7.8, -.06, -6.4 + i * .8] });
      tiles.push({ p: [-6.4 + i * .8, -.06, side * 6.8] });
    }
    viele(this.scene, new THREE.BoxGeometry(.74, .2, .74), lambert('#faf1d9'), tiles);
    this.island = new THREE.Group(); this.scene.add(this.island);
    const geo = new THREE.CylinderGeometry(SCALE, SCALE, .28, 64); geo.userData.block = true;
    const disk = new THREE.Mesh(geo, lambert('#d6ede5')); disk.position.y = DECK - .14;
    disk.receiveShadow = true; this.island.add(disk);
    const rimGeo = new THREE.RingGeometry(SCALE - .06, SCALE, 64); rimGeo.userData.block = true;
    this.rim = new THREE.Mesh(rimGeo, new THREE.MeshLambertMaterial({ color: '#f7b675', emissive: '#ff794d', emissiveIntensity: .12, side: THREE.DoubleSide }));
    this.rim.rotation.x = -Math.PI / 2; this.rim.position.y = DECK + .009; this.island.add(this.rim);
    const centerGeo = new THREE.RingGeometry(.24, .29, 32); centerGeo.userData.block = true;
    const center = new THREE.Mesh(centerGeo, new THREE.MeshBasicMaterial({ color: '#a4c9c1', side: THREE.DoubleSide }));
    center.rotation.x = -Math.PI / 2; center.position.y = DECK + .01; this.island.add(center);
    // A few quiet pool details; the surface and ring contact remain prominent.
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const x = side * 6, z = -3 + i * 2.2;
      kiste(this.scene, .65, .18, 1.35, i % 2 ? '#ffe1a0' : '#fcf5e1', [x, .1, z]);
      kiste(this.scene, .65, .65, .14, '#6ca9bd', [x, .35, z - .65]);
    }
    for (let i = 0; i < 3; i++) {
      const cloud = createCloud(i + 4); cloud.position.set((i - 1) * 7, 5 + i * .2, -13);
      this.scene.add(cloud);
    }
    const players = this.getState().players;
    players.forEach((player, index) => {
      const p = this.minigame.arena.players[player.id];
      const ring = new THREE.Group();
      // Visible outside radius equals the collision radius, including tube.
      const colors = [player.color, '#fff7e6'];
      const parts = [[], []];
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        parts[i % 2].push({ p: [Math.sin(angle) * (Math.sqrt(RING * RING - .0725 * .0725) - .0775), .17, Math.cos(angle) * (Math.sqrt(RING * RING - .0725 * .0725) - .0775)], r: [0, angle, 0] });
      }
      parts.forEach((list, i) => viele(ring, new THREE.BoxGeometry(.145, .19, .155), lambert(colors[i]), list, { schatten: true }));
      ring.position.set(p.x * SCALE, DECK, p.y * SCALE); this.scene.add(ring); this.blooms.set(player.id, ring);
      const kin = this.addKin(player, index, { x: p.x * SCALE, z: p.y * SCALE, ground: DECK + .015, scale: .86 });
      const shadow = this.shadows.get(player.id); shadow.userData.manual = true;
      const shieldGeo = new THREE.RingGeometry(RING + .04, RING + .065, 40); shieldGeo.userData.block = true;
      const shield = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .7, side: THREE.DoubleSide }));
      shield.rotation.x = -Math.PI / 2; shield.position.y = .015; ring.add(shield);
      this.state.set(player.id, { inPlay: p.inPlay, fallAt: 0, hit: null, facing: 0, shield, splash: false, index });
      kin.userData.bumperRing = ring;
      const card = document.createElement('div'); card.className = 'bumper-player'; card.style.setProperty('--chip', player.color);
      const name = document.createElement('span'); name.textContent = player.name;
      const lives = document.createElement('strong'); lives.textContent = '♥ ♥ ♥'; card.append(name, lives);
      this.hud.querySelector('.bumper-players').append(card); this.cards.set(player.id, { card, lives });
    });
    this.aim = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: '#ffd45c' });
    kiste(this.aim, .035, .012, .22, '#ffd45c', [0, .018, RING + .22], { material, schatten: false });
    for (const side of [-1, 1]) {
      const tip = kiste(this.aim, .035, .012, .14, '#ffd45c', [side * .045, .018, RING + .32], { material, schatten: false });
      tip.rotation.y = side * -.65;
    }
    this.scene.add(this.aim);
    this.kosNode = this.hud.querySelector('[data-bumper-kos]');
    this.status = this.hud.querySelector('[data-arena-banner]');
    this.warning = this.hud.querySelector('[data-arena-shrink]');
    this.lastEvent = this.minigame.arena.eventId || 0;
  }
  shot() { return { look: [0, .2, 0], frame: { w: 7.8, h: 6.5 }, pitch: .95, yaw: 0, fov: 40, ease: .12 }; }
  keepInView() { return []; }
  rigOptions(f) {
    const rect = this.webglCanvas.getBoundingClientRect();
    const landscape = rect.width > rect.height && rect.height <= 520;
    const cards = this.hud.querySelector('.bumper-players').getBoundingClientRect();
    const bar = this.hud.querySelector('.kinetic-scorebar').getBoundingClientRect();
    const note = this.controls.querySelector('.bumper-control-note').getBoundingClientRect();
    const controls = this.controls.getBoundingClientRect();
    const top = Math.max(cards.bottom, bar.bottom, this.warning.hidden ? 0 : this.warning.getBoundingClientRect().bottom) - rect.top + 8;
    this.rig.base.insets = { top, bottom: rect.bottom - (landscape ? note.top : controls.top) + 8,
      left: landscape ? 146 : 0, right: 0 };
    const radius = f.minigame.arena?.radius || 1;
    // Fixed centre and complete edge: hits never yank the camera away from aim.
    return { frame: { w: Math.max(5.4, 7.8 * radius), h: Math.max(4.6, (landscape ? 5.9 : 6.5) * radius) }, look: [0, .2, 0] };
  }
  bind() {
    this.controls.innerHTML = `<div class="mobile-stick-controls joystick-only bumper-controls"><div class="joystick-slot"></div><p class="bumper-control-note">Lenken · Anlauf nehmen · Rammen<br>Loslassen bremst</p></div>`;
    this.joystick = new VirtualJoystick({ root: this.controls.querySelector('.joystick-slot'), label: 'Schwimmring lenken und zielen', intervalMs: 70,
      feedback: this.feedback, onVector: (x, y) => this.steer(x, y) });
    this.on(window, 'keydown', event => {
      if (event.target?.closest('input,textarea,select') || this.controls.inert || !this.ownEntry()?.inPlay) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
        event.preventDefault(); this.keys.add(event.code); this.keyboardSteer();
        if (!this.keyTimer) this.keyTimer = setInterval(() => this.keyboardSteer(), 70);
      }
    });
    this.on(window, 'keyup', event => { if (this.keys.delete(event.code)) { event.preventDefault(); this.keyboardSteer(); if (!this.keys.size) { clearInterval(this.keyTimer); this.keyTimer = null; } } });
    const release = () => this.releaseInput();
    this.on(window, 'blur', release); this.on(window, 'resize', release);
    this.on(document, 'visibilitychange', () => { if (document.hidden) release(); });
  }
  ownEntry() { return (this.update || this.minigame)?.arena?.players[this.getControlledPlayerId()]; }
  steer(x, y) {
    const p = this.ownEntry();
    if (!p?.inPlay || this.controls.inert) { this.vector = { x: 0, y: 0 }; return; }
    this.vector = { x, y }; this.sendInput({ action: 'thrust', x, y }).catch(() => {});
  }
  keyboardSteer() {
    const has = (...keys) => keys.some(key => this.keys.has(key));
    this.steer(Number(has('ArrowRight', 'KeyD')) - Number(has('ArrowLeft', 'KeyA')), Number(has('ArrowDown', 'KeyS')) - Number(has('ArrowUp', 'KeyW')));
  }
  releaseInput() {
    clearInterval(this.keyTimer); this.keyTimer = null; this.keys.clear();
    this.joystick?.reset(); this.steer(0, 0);
  }
  unbind() { clearInterval(this.keyTimer); this.keyTimer = null; this.joystick?.destroy(); this.joystick = null; }
  onFinale() { this.releaseInput(); }
  processEvents(f) {
    const events = (f.minigame.arena.events || []).filter(e => e.id > this.lastEvent);
    let strongest = null;
    for (const e of events) {
      this.lastEvent = e.id;
      if (f.now - e.at > 700) continue;
      if (e.kind === 'hit' || e.kind === 'shield') {
        for (const id of [e.a, e.b]) {
          const s = this.state.get(id); if (s) s.hit = e;
          this.animators.get(id)?.trigger('flinch');
        }
        if (!strongest || e.strength > strongest.strength) strongest = e;
        const pos = new THREE.Vector3(e.x * SCALE, DECK + .13, e.y * SCALE);
        this.bursts.ring(pos, e.kind === 'shield' ? '#b9f2ff' : '#fff8d3', { radius: .45 + e.strength * .4, life: .26, opacity: .75, y: DECK + .015 });
        if (e.strength > .5 && !reduced()) this.burst(pos, ['#fff8df'], { count: 4, speed: 1.1, up: .9, size: .04, life: .22 });
      }
      else if (e.kind === 'fall' && e.attacker === f.controlledId) { this.feedback?.sound('combo', { pan: e.x * .5 }); this.feedback?.vibrate([12, 25, 8]); }
    }
    if (strongest && performance.now() - this.lastImpactSound > 90) {
      this.lastImpactSound = performance.now();
      this.feedback?.sound(strongest.kind === 'shield' ? 'bumperTap' : strongest.strength > .25 ? 'bumperHit' : 'bumperTap',
        { pan: Math.max(-.65, Math.min(.65, strongest.x * .65)), strength: .45 + strongest.strength * .65, pitch: 1.06 - strongest.strength * .16 });
      const own = [strongest.a, strongest.b].includes(f.controlledId);
      if (own) {
        this.feedback?.vibrate(Math.round(8 + strongest.strength * 16));
        this.rig.shake(reduced() ? 0 : .08 + strongest.strength * .16);
      }
      if (own && strongest.strength > .35 && !reduced()) this.freezeUntil = performance.now() + 32;
    }
  }
  tick(f) {
    const arena = f.minigame.arena; if (!arena?.players) return;
    this.processEvents(f);
    const own = arena.players[f.controlledId];
    // Predict the whole contact system, not independent rings that could
    // visually pass through one another between authoritative updates.
    let predicted = arena;
    if (f.started && !f.finale && f.now > arena.lastUpdateAt) {
      predicted = { ...arena, events: [], contacts: { ...arena.contacts },
        players: Object.fromEntries(Object.entries(arena.players).map(([id, p]) => [id, { ...p }])) };
      P.advance(predicted, Math.min(f.now, arena.lastUpdateAt + 70));
    }
    f.players.forEach(player => {
      const p = arena.players[player.id], s = this.state.get(player.id), ring = this.blooms.get(player.id), kin = this.kins.get(player.id), animator = this.animators.get(player.id);
      if (!p || !s || !ring || !kin) return;
      if (s.inPlay && !p.inPlay) {
        s.inPlay = false; s.fallAt = p.knockedAt; s.splash = false;
        const fall = p.fall || { x: p.x, y: p.y, vx: p.x, vy: p.y };
        const len = Math.hypot(fall.vx, fall.vy) || Math.hypot(fall.x, fall.y) || 1;
        const moving = Math.hypot(fall.vx, fall.vy) > 1e-6;
        const dx = moving ? fall.vx : fall.x, dy = moving ? fall.vy : fall.y, n = Math.hypot(dx, dy) || 1;
        s.from = new THREE.Vector3(fall.x * SCALE, DECK, fall.y * SCALE);
        s.to = s.from.clone().add(new THREE.Vector3(dx / n, 0, dy / n).multiplyScalar(1.1 + Math.min(.55, len * .2))); s.to.y = WATER;
        animator.trigger('tumble'); animator.expression('surprised', 650); kin.userData.outOfPlay = true;
        if (player.id === f.controlledId) this.releaseInput();
      }
      if (!s.inPlay && p.inPlay) {
        s.inPlay = true; s.returnAt = p.spawnedAt; s.returnFrom = ring.position.clone();
        kin.userData.outOfPlay = false; kin.rotation.set(0, s.facing, 0); animator.set('ride');
      }
      if (!p.inPlay) {
        const age = Math.max(0, f.now - s.fallAt), u = Math.min(1, age / 550);
        if (s.from && s.to) {
          ring.position.lerpVectors(s.from, s.to, u);
          ring.position.y += Math.sin(u * Math.PI) * .65;
          ring.rotation.x = reduced() ? 0 : Math.sin(u * Math.PI) * .6;
          if (u === 1 && !s.splash) {
            s.splash = true;
            this.bursts.ring(ring.position.clone(), '#e4fbff', { radius: 1.1, life: .55, opacity: .8, y: WATER + .015 });
            this.burst(ring.position.clone(), ['#dcf7ff', '#8cdcec'], { count: reduced() ? 4 : 10, speed: 1.4, up: 1.5, size: .045, life: .4 });
            this.feedback?.sound('bumperSplash', { pan: Math.max(-.6, Math.min(.6, ring.position.x / 5)), strength: player.id === f.controlledId ? 1 : .65 });
          }
          if (u === 1) { ring.position.y = WATER + (reduced() ? 0 : Math.sin(f.now / 380 + s.index) * .025); animator.set('float'); kin.rotation.set(0, Math.atan2(-ring.position.x, -ring.position.z), 0); }
        }
        animator.groundY = standOn(ring.position.y + .015);
        kin.position.x = ring.position.x; kin.position.z = ring.position.z;
        this.shadows.get(player.id).visible = false; s.shield.visible = false;
        return;
      }
      const prediction = predicted.players[player.id];
      if (performance.now() >= this.freezeUntil) {
        const k = frameLerp(.55, f.dt);
        ring.position.x += (prediction.x * SCALE - ring.position.x) * k;
        ring.position.z += (prediction.y * SCALE - ring.position.z) * k;
      }
      ring.position.y = DECK;
      if (s.returnAt && f.now < s.returnAt + 350) {
        const u = Math.min(1, (f.now - s.returnAt) / 350);
        ring.position.lerpVectors(s.returnFrom, new THREE.Vector3(p.x * SCALE, DECK, p.y * SCALE), u);
        ring.position.y += Math.sin(u * Math.PI) * .65;
      }
      const age = s.hit ? Math.max(0, f.now - s.hit.at) : 10000;
      const squash = reduced() ? 0 : (s.hit?.strength || 0) * Math.exp(-age / 105) * Math.cos(age / 45);
      if (s.hit) ring.rotation.y = Math.atan2(s.hit.nx, s.hit.ny);
      ring.scale.set(1 + squash * .13, 1 - squash * .18, 1 - squash * .19);
      ring.rotation.x = 0;
      const speed = Math.hypot(p.vx, p.vy);
      const facing = f.finale ? 0 : speed > .08 ? Math.atan2(p.vx, p.vy) : s.facing;
      s.facing += Math.atan2(Math.sin(facing - s.facing), Math.cos(facing - s.facing)) * frameLerp(.2, f.dt);
      kin.position.x = ring.position.x; kin.position.z = ring.position.z;
      kin.rotation.set(Math.cos(s.facing) * Math.min(.16, speed * .045), s.facing, -Math.sin(s.facing) * Math.min(.16, speed * .045));
      animator.groundY = standOn(ring.position.y + .015);
      if (!f.finale) animator.set(speed > .1 ? 'ride' : 'ready');
      s.shield.visible = f.now < p.invulnUntil;
      const shadow = this.shadows.get(player.id); shadow.visible = true; shadow.position.set(ring.position.x, DECK + .012, ring.position.z); shadow.material.opacity = .22;
    });
    this.island.scale.set(arena.radius, 1, arena.radius);
    const cue = f.finale ? { phase: 'none' } : arenaShrinkCue(arena, f.now);
    this.rim.material.emissiveIntensity = cue.phase === 'active' ? .55 + (reduced() ? 0 : Math.sin(f.now / 650) * .1) : cue.phase === 'soon' ? .32 : .12;
    if (own?.inPlay) {
      const ring = this.blooms.get(f.controlledId);
      this.aim.visible = !f.finale;
      const aim = this.vector.x || this.vector.y ? this.vector : { x: own.aimX, y: own.aimY };
      this.aim.position.set(ring.position.x, DECK + .01, ring.position.z); this.aim.rotation.y = Math.atan2(aim.x, aim.y);

    } else { this.aim.visible = false; }
  }
  finaleOverride(player) { if (!this.state.get(player.id)?.inPlay) { this.animators.get(player.id)?.set('float'); return true; } return false; }
  drawHud(f) {
    const arena = f.minigame.arena, own = arena?.players[f.controlledId]; if (!own) return;
    this.hudScore.textContent = own.lives;
    this.kosNode.textContent = `${own.knockouts} raus`;
    f.players.forEach(p => {
      const entry = arena.players[p.id], card = this.cards.get(p.id);
      card.lives.textContent = entry.lives ? '♥ '.repeat(entry.lives).trim() : 'RAUS';
      card.card.classList.toggle('is-own', p.id === f.controlledId); card.card.classList.toggle('is-out', !entry.lives);
    });
    const cue = f.finale ? { phase: 'none' } : arenaShrinkCue(arena, f.now);
    this.warning.hidden = cue.phase === 'none'; this.warning.dataset.phase = cue.phase;
    this.warning.textContent = cue.phase === 'soon' ? `Rand schrumpft in ${cue.seconds} s` : 'Rand schrumpft — zur Mitte!';
    if (cue.phase !== this.warningPhase && cue.phase !== 'none') { this.feedback?.sound('countdown'); this.feedback?.vibrate(10); }
    this.warningPhase = cue.phase;
    this.controls.classList.toggle("bumper-disabled", !own.inPlay);
    this.status.hidden = own.inPlay || f.finale;
    this.status.textContent = own.lives ? `${own.lives} Leben · zurück in ${Math.max(0, (own.outUntil - f.now) / 1000).toFixed(1).replace('.', ',')} s` : 'Raus — schau dem Finale zu';
  }
}
