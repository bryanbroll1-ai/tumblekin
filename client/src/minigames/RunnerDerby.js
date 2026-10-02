import * as THREE from '/vendor/three/three.module.js';
import { MinigameScene } from './MinigameScene.js?v=tumblekin207';
import { standOn } from './VoxelKit.js?v=tumblekin207';
import { bindHoldInput } from './HoldInput.js?v=tumblekin207';
import { kiste, lambert, viele } from './Kulisse.js?v=tumblekin207';
import { frameLerp } from './Quality.js?v=tumblekin207';
import './SprintPhysics.js?v=tumblekin207';

const P = globalThis.TumblekinSprintPhysics;
const METRE = 0.62;
const LANE = 1.55;
const footBounds = new THREE.Box3();
const timeText = ms => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

// A personal 100 m hurdles race: the course is equal, the timing is yours.
export class RunnerDerby extends MinigameScene {
  constructor(ctx) {
    super(ctx);
    this.ownInView = true;
    this.finaleFocus = false;
    this.autoFinale = false;
    this.holding = false;
    this.holdTimer = null;
    this.hurdles = new Map();
    this.rivals = new Map();
    this.verdicts = new Map();
    this.localJump = null;
    this.labelY = 0.9;
  }

  stage() {
    return { label: '3D Zielgerade – 100-Meter-Hürdensprint', background: '#b9e4ef',
      fog: ['#b9e4ef', 24, 78], lights: { sunPosition: [-8, 14, 8],
        skyColor: 0xe8f7ff, groundColor: 0x729579, sunIntensity: 2.5 } };
  }

  hudHtml() {
    return `<div class="kinetic-scorebar"><span data-kinetic-time>32s</span><strong data-kinetic-score>1.</strong><span data-sprint-distance>100 m</span></div>
      <div class="sprint-vitals"><div><strong data-sprint-state>Bereit am Start</strong><span data-sprint-energy>100 %</span></div><div class="sprint-energy-track" role="meter" aria-label="Ausdauer" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i data-sprint-fill></i></div></div>
      <div class="sprint-rivals" aria-label="Rennstand"></div>`;
  }

  laneX(lane) { return (lane - (this.getState().players.length - 1) / 2) * LANE; }
  groundHeightAt() { return 0; }

  build() {
    const players = this.getState().players;
    const width = players.length * LANE;
    const length = P.C.LENGTH * METRE;
    kiste(this.scene, width + 16, 0.4, length + 22, '#83b079', [0, -0.23, -length / 2]);
    kiste(this.scene, width + 0.2, 0.3, length + 8, '#b85b50', [0, -0.15, -length / 2]);
    const stripes = Array.from({ length: players.length + 1 }, (_, i) => ({ p: [(i - players.length / 2) * LANE, 0.006, -length / 2] }));
    viele(this.scene, new THREE.BoxGeometry(0.035, 0.012, length + 7), lambert('#fff3d6'), stripes);
    const marks = [];
    for (let m = 10; m < 100; m += 10) marks.push({ p: [0, 0.009, -m * METRE] });
    viele(this.scene, new THREE.BoxGeometry(width, 0.014, 0.045), lambert('#e8bcaa'), marks);
    kiste(this.scene, width, 0.018, 0.1, '#fff8e2', [0, 0.009, 0.45]);
    const checks = [[], []];
    for (let i = 0; i < players.length * 6; i++) for (let j = 0; j < 2; j++) {
      checks[(i + j) % 2].push({ p: [-width / 2 + (i + 0.5) * LANE / 6, 0.015, -length + (j - 0.5) * 0.26] });
    }
    checks.forEach((parts, i) => viele(this.scene, new THREE.BoxGeometry(LANE / 6, 0.025, 0.26), lambert(i ? '#fffaf0' : '#263641'), parts));
    // The arch is beyond the finish: neither posts nor ribbon hide a hurdle.
    [-1, 1].forEach(side => kiste(this.scene, 0.2, 2.8, 0.2, '#fffaf0', [side * (width / 2 + 0.25), 1.4, -length - 1.4]));
    kiste(this.scene, width + 0.7, 0.38, 0.22, '#ffc95e', [0, 2.8, -length - 1.4]);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffc95e'; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#253743'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('100 m · ZIEL', 256, 68);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.5, 0.34), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sign.position.set(0, 2.8, -length - 1.27); this.scene.add(sign);

    // Seat blocks and spectators are instanced, keeping the stadium inexpensive.
    ['#5178a1', '#efb55d', '#599b9b'].forEach((color, row) => {
      const seats = [], heads = [];
      for (const side of [-1, 1]) for (let i = 0; i < 22; i++) {
        const x = side * (width / 2 + 2 + row * 0.7), z = 1 - i * 2.8;
        seats.push({ p: [x, row * 0.28 + 0.25, z] });
        heads.push({ p: [x, row * 0.28 + 0.74, z] });
      }
      viele(this.scene, new THREE.BoxGeometry(0.58, 0.4, 0.7), lambert(color), seats);
      viele(this.scene, new THREE.BoxGeometry(0.23, 0.25, 0.23), lambert('#f0d5b1'), heads);
    });
    const course = this.minigame.arcade.hurdles;
    this.courseKey = course.map(h => h.at).join(',');
    players.forEach((player, index) => {
      const entry = this.minigame.arcade.players[player.id];
      const x = this.laneX(entry.lane);
      this.addKin(player, index, { x, facing: Math.PI });
      this.shadows.get(player.id).userData.manual = true;
      kiste(this.scene, 1.3, 0.016, 1.4, player.color, [x, 0.012, 0.9]);
      for (const hurdle of course) {
        const group = new THREE.Group(); group.position.set(x, 0, -hurdle.at * METRE);
        for (const side of [-1, 1]) {
          kiste(group, 0.06, P.C.HURDLE_HEIGHT, 0.06, '#fdf1d8', [side * 0.57, P.C.HURDLE_HEIGHT / 2, 0]);
          kiste(group, 0.13, 0.05, 0.42, '#e8d4b9', [side * 0.57, 0.025, 0.1]);
        }
        kiste(group, 1.25, 0.08, 0.08, player.color, [0, P.C.HURDLE_HEIGHT - 0.04, 0]);
        this.scene.add(group); this.hurdles.set(`${player.id}:${hurdle.index}`, group);
      }
      const row = document.createElement('div'); row.className = 'sprint-rival';
      const name = document.createElement('span'); name.textContent = player.name;
      const value = document.createElement('b'); value.textContent = '0 m';
      const track = document.createElement('div'), fill = document.createElement('i'); fill.style.background = player.color;
      track.appendChild(fill); row.append(name, value, track);
      this.hud.querySelector('.sprint-rivals').appendChild(row);
      this.rivals.set(player.id, { row, value, fill });
    });
    this.energyFill = this.hud.querySelector('[data-sprint-fill]');
    this.energyText = this.hud.querySelector('[data-sprint-energy]');
    this.energyMeter = this.hud.querySelector('[role=meter]');
    this.status = this.hud.querySelector('[data-sprint-state]');
    this.distance = this.hud.querySelector('[data-sprint-distance]');
  }

  onUpdate(update) {
    const course = update.arcade?.hurdles;
    if (!course) return;
    const key = course.map(h => h.at).join(',');
    if (key === this.courseKey) return;
    this.courseKey = key;
    for (const player of this.getState().players) for (const hurdle of course) {
      const group = this.hurdles.get(`${player.id}:${hurdle.index}`);
      if (group) { group.position.z = -hurdle.at * METRE; group.rotation.x = 0; delete group.userData.fellAt; }
    }
    this.verdicts.clear();
  }

  shot() {
    return { look: [0, 0.3, -3.8], frame: { w: 4.2, h: 5.6 }, yaw: 0,
      pitch: 0.55, fov: 44, ease: 0.25 };
  }
  keepInView() { return []; }
  rigOptions(f) {
    const own = this.kins.get(f.controlledId);
    const landscape = this.webglCanvas.clientWidth > this.webglCanvas.clientHeight;
    const rect = this.webglCanvas.getBoundingClientRect();
    const vitals = this.hud.querySelector('.sprint-vitals').getBoundingClientRect();
    const controls = this.controls.getBoundingClientRect();
    this.rig.base.insets = { top: vitals.bottom - rect.top + 8,
      bottom: rect.bottom - controls.top + 8, left: 0, right: 0 };
    return { look: [own?.position.x || 0, 0.35, (own?.position.z || 0) - (landscape ? 1.6 : 3.6)],
      frame: { w: landscape ? Math.max(4.2, f.players.length * LANE + 1) : 4.2, h: landscape ? 3.4 : 5.6 } };
  }

  bind() {
    this.controls.innerHTML = `<div class="sprint-controls"><p class="sprint-cue" data-sprint-cue>100 m · sieben Hürden</p><div class="sprint-buttons"><button type="button" class="hold-button" data-sprint-hold aria-label="Sprint – gedrückt halten"><strong>SPRINT</strong><small>HALTEN · AUSDAUER</small></button><button type="button" class="nerve-button" data-sprint-jump aria-label="Sprung – einmal tippen"><strong>SPRUNG</strong><small>TIPPEN</small></button></div></div>`;
    this.sprintButton = this.controls.querySelector('[data-sprint-hold]');
    this.jumpButton = this.controls.querySelector('[data-sprint-jump]');
    this.cue = this.controls.querySelector('[data-sprint-cue]');
    this.holdInput = bindHoldInput(this, [this.sprintButton], active => this.setHolding(active));
    this.on(this.jumpButton, 'pointerdown', event => { event.preventDefault(); this.springen(); });
    this.on(window, 'resize', () => this.holdInput.release());
  }
  ownEntry() { return (this.update || this.minigame)?.arcade?.players[this.getControlledPlayerId()]; }
  setHolding(active) {
    if (active && (this.ownEntry()?.finishedAt !== null || this.update?.finaleAt)) return;
    this.holding = active;
    this.sprintButton?.classList.toggle('is-holding', active);
    clearInterval(this.holdTimer); this.holdTimer = null;
    this.sendInput({ action: 'sprint', hold: active }).catch(() => {});
    if (active) {
      this.feedback?.sound('press'); this.feedback?.vibrate(6);
      this.holdTimer = setInterval(() => this.sendInput({ action: 'sprint', hold: true }).catch(() => {}), 120);
    }
  }
  springen() {
    const entry = this.ownEntry(), now = this.now();
    if (!entry || entry.finishedAt !== null || now < (this.update || this.minigame).startedAt || now < entry.jumpReadyAt || now < entry.stumbleUntil || this.localJump) return;
    this.localJump = { jumpAt: now, jumpUntil: now + P.AIR_MS, fromJump: entry.jumpAt, until: now + 300 };
    this.feedback?.sound('pop'); this.feedback?.vibrate(8);
    this.sendInput({ action: 'jump' }).catch(() => { this.localJump = null; });
  }
  unbind() { clearInterval(this.holdTimer); this.holdTimer = null; this.holding = false; }

  tick(f) {
    if (!f.arcade) return;
    const own = f.arcade.players[f.controlledId];
    if (this.holding && (f.finale || own?.finishedAt !== null)) this.holdInput.release();
    if (this.localJump && (own?.jumpAt !== this.localJump.fromJump || f.now > this.localJump.until)) this.localJump = null;
    f.players.forEach(player => {
      const entry = f.arcade.players[player.id]; if (!entry) return;
      const kin = this.kins.get(player.id), animator = this.animators.get(player.id);
      if (!kin) return;
      const predicted = Math.min(P.C.LENGTH, entry.progress + (f.started && entry.finishedAt === null ? entry.speed * Math.max(0, Math.min(0.1, (f.now - entry.updatedAt) / 1000)) : 0));
      kin.position.x = this.laneX(entry.lane);
      kin.rotation.y += ((entry.finishedAt !== null ? 0 : Math.PI) - kin.rotation.y) * frameLerp(0.16, f.dt);
      if (entry.finishedAt !== null && !this.celebrated.has(player.id)) {
        this.celebrated.add(player.id);
        if (player.id === f.controlledId) { this.feedback?.sound('win'); this.feedback?.vibrate([12, 30, 12]); }
      }
      kin.position.z += (-predicted * METRE - kin.position.z) * frameLerp(0.45, f.dt);
      const jump = player.id === f.controlledId && this.localJump ? this.localJump : entry;
      const lift = P.height(jump, f.now);
      const wasAir = kin.userData.sprintAir;
      kin.userData.sprintHeight = lift;
      kin.userData.sprintAir = lift > 0.01;
      animator.groundY = standOn(lift);
      animator.rate = Math.max(0.5, entry.speed / 5.8);
      animator.set(entry.finishedAt !== null ? 'cheer' : f.now < entry.stumbleUntil ? 'stumble' : lift > 0.01 ? 'ready' : !f.started ? 'ready' : entry.sprinting ? 'sprint' : 'run');
      if (wasAir && !kin.userData.sprintAir && f.now >= entry.stumbleUntil && entry.finishedAt === null) {
        animator.trigger('land');
        if (player.id === f.controlledId) this.feedback?.sound('land');
      }
      const shadow = this.shadows.get(player.id);
      shadow.position.set(kin.position.x, 0.02, kin.position.z);
      shadow.scale.setScalar(Math.max(0.5, 1 - lift * 0.35));
      shadow.material.opacity = Math.max(0.12, 0.34 - lift * 0.16);
      const verdict = entry.lastVerdict;
      if (verdict && this.verdicts.get(player.id) !== verdict.index) {
        this.verdicts.set(player.id, verdict.index);
        if (verdict.kind === 'hit') {
          const hurdle = this.hurdles.get(`${player.id}:${verdict.index}`); if (hurdle) hurdle.userData.fellAt = verdict.at;
        }
        if (player.id === f.controlledId && f.now - verdict.at < 600) {
          this.feedback?.sound(verdict.kind === 'clear' ? 'coin' : 'impact');
          this.feedback?.vibrate(verdict.kind === 'clear' ? 6 : 18);
          if (verdict.kind === 'hit') this.rig.shake(0.1);
        }
      }
      const rival = this.rivals.get(player.id);
      rival.row.classList.toggle('is-own', player.id === f.controlledId);
      rival.value.textContent = entry.finishedAt !== null ? timeText(entry.finishMs) : `${Math.floor(entry.progress)} m`;
      rival.fill.style.width = `${entry.progress}%`;
    });
    for (const hurdle of this.hurdles.values()) if (hurdle.userData.fellAt) {
      const t = Math.min(1, Math.max(0, (f.now - hurdle.userData.fellAt) / 260));
      hurdle.rotation.x = -Math.PI / 2 * (1 - Math.pow(1 - t, 3));
    }
  }

  afterAnimate() {
    this.kins.forEach(kin => {
      if (kin.userData.sprintAir) {
        // The pose folds the legs; only the shared parabola moves the soles.
        kin.userData.legs[0].rotation.x = -0.65;
        kin.userData.legs[1].rotation.x = 0.35;
      }
      kin.updateMatrixWorld(true);
      let sole = Infinity;
      kin.userData.legs.forEach(leg => { sole = Math.min(sole, footBounds.setFromObject(leg).min.y); });
      if (Number.isFinite(sole)) {
        if (kin.userData.sprintAir) kin.position.y += kin.userData.sprintHeight - sole;
        else if (sole < 0) kin.position.y -= sole;
      }
    });
  }

  drawHud(f) {
    const own = f.arcade?.players[f.controlledId]; if (!own) return;
    const ranked = f.players.slice().sort((a, b) => P.rank(f.arcade.players[b.id]) - P.rank(f.arcade.players[a.id]));
    const place = 1 + ranked.filter(p => P.rank(f.arcade.players[p.id]) > P.rank(own)).length;
    this.hudScore.textContent = `${place}.`;
    this.distance.textContent = own.finishedAt !== null ? timeText(own.finishMs) : `${Math.ceil(P.C.LENGTH - own.progress)} m`;
    this.energyText.textContent = `${Math.round(own.energy)} %`;
    this.energyFill.style.width = `${own.energy}%`;
    this.energyMeter.setAttribute('aria-valuenow', Math.round(own.energy));
    this.energyFill.classList.toggle('is-low', own.energy < P.C.RESUME_ENERGY);
    const stumble = f.now < own.stumbleUntil;
    this.status.textContent = own.finishedAt !== null ? 'Im Ziel' : !f.started ? 'Bereit am Start' : stumble ? 'Straucheln' : f.now < own.jumpUntil ? 'Im Sprung' : own.exhausted ? 'Erholen bis 30 %' : own.sprinting ? 'Sprint' : 'Erholen';
    this.sprintButton.disabled = own.finishedAt !== null || f.finale;
    this.jumpButton.disabled = own.finishedAt !== null || f.finale || !f.started || stumble || f.now < own.jumpReadyAt || Boolean(this.localJump);
    const hurdle = f.arcade.hurdles[own.nextHurdle];
    const predicted = { ...own, progress: own.progress + own.speed * Math.max(0, Math.min(0.1, (f.now - own.updatedAt) / 1000)) };
    const ready = !this.jumpButton.disabled && P.jumpWindow(predicted, hurdle);
    this.cue.classList.toggle('is-ready', ready);
    this.jumpButton.classList.toggle('is-hint', ready);
    this.cue.textContent = own.finishedAt !== null ? `${own.cleared}/7 Hürden · ${f.finale ? 'Rennen beendet' : 'Die anderen laufen noch'}` : !f.started ? 'Sprint halten · Sprung tippen' : stumble ? 'Hürde erwischt · weiter geht’s' : ready ? 'JETZT SPRINGEN' : hurdle ? `Hürde ${own.nextHurdle + 1}/7 · ${Math.ceil(Math.max(0, hurdle.at - own.progress))} m` : 'ZIELGERADE · Endspurt!';
  }
}
