import * as THREE from '/vendor/three/three.module.js';
import { MinigameScene } from './MinigameScene.js?v=tumblekin209';
import { standOn } from './VoxelKit.js?v=tumblekin209';
import { kiste, lambert, viele } from './Kulisse.js?v=tumblekin209';
import { frameLerp } from './Quality.js?v=tumblekin209';
import './SprintPhysics.js?v=tumblekin209';

const P = globalThis.TumblekinSprintPhysics;
const METRE = 0.62;
const LANE = 1.55;
const footBounds = new THREE.Box3();
const timeText = ms => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

// A shared three-lane race: swipe to dodge, jump and slide; hold to sprint.
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
    this.localJump = null; this.localSlide = null; this.pointer = null; this.holdDelay = null;
    this.labelY = 0.9;
  }

  stage() {
    return { label: '3D Zielgerade – 100-Meter-Swipe-Rennen', background: '#b9e4ef',
      fog: ['#b9e4ef', 24, 78], lights: { sunPosition: [-8, 14, 8],
        skyColor: 0xe8f7ff, groundColor: 0x729579, sunIntensity: 2.5 } };
  }

  hudHtml() {
    return `<div class="kinetic-scorebar"><span data-kinetic-time>32s</span><strong data-kinetic-score>1.</strong><span data-sprint-distance>100 m</span></div>
      <div class="sprint-vitals"><div><strong data-sprint-state>Bereit am Start</strong><span data-sprint-energy>100 %</span></div><div class="sprint-energy-track" role="meter" aria-label="Ausdauer" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i data-sprint-fill></i></div></div>
      <div class="sprint-rivals" aria-label="Rennstand"></div>`;
  }

  laneX(lane) { return (lane - 1) * LANE; }
  groundHeightAt() { return 0; }

  build() {
    const players = this.getState().players;
    const width = 3 * LANE;
    const length = P.C.LENGTH * METRE;
    kiste(this.scene, width + 16, 0.4, length + 22, '#83b079', [0, -0.23, -length / 2]);
    kiste(this.scene, width + 0.2, 0.3, length + 8, '#b85b50', [0, -0.15, -length / 2]);
    const stripes = Array.from({ length: 4 }, (_, i) => ({ p: [(i - 1.5) * LANE, 0.006, -length / 2] }));
    viele(this.scene, new THREE.BoxGeometry(0.035, 0.012, length + 7), lambert('#fff3d6'), stripes);
    const marks = [];
    for (let m = 10; m < 100; m += 10) marks.push({ p: [0, 0.009, -m * METRE] });
    viele(this.scene, new THREE.BoxGeometry(width, 0.014, 0.045), lambert('#e8bcaa'), marks);
    kiste(this.scene, width, 0.018, 0.1, '#fff8e2', [0, 0.009, 0.45]);
    const checks = [[], []];
    for (let i = 0; i < 3 * 6; i++) for (let j = 0; j < 2; j++) {
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
    this.courseKey = JSON.stringify(course);
    players.forEach((player, index) => {
      const entry = this.minigame.arcade.players[player.id];
      const x = this.laneX(entry.lane);
      this.addKin(player, index, { x, facing: Math.PI });
      this.shadows.get(player.id).userData.manual = true;
      const row = document.createElement('div'); row.className = 'sprint-rival';
      const name = document.createElement('span'); name.textContent = player.name;
      const value = document.createElement('b'); value.textContent = '0 m';
      const track = document.createElement('div'), fill = document.createElement('i'); fill.style.background = player.color;
      track.appendChild(fill); row.append(name, value, track);
      this.hud.querySelector('.sprint-rivals').appendChild(row);
      this.rivals.set(player.id, { row, value, fill });
    });
    // One shared, readable course. Orange = jump, blue = duck, crate = dodge.
    course.forEach(row => row.lanes.forEach((kind, lane) => {
      if (!kind) return;
      const group = new THREE.Group(); group.position.set(this.laneX(lane), 0, -row.at * METRE);
      if (kind === 'block') {
        kiste(group, 1.24, 1.8, .65, '#dc9770', [0, .9, 0]);
        for (const side of [-1, 1]) kiste(group, .085, 1.8, .68, '#fbdca7', [side * .43, .9, 0]);
        kiste(group, 1.27, .08, .68, '#fbdca7', [0, .3, 0]);
        kiste(group, 1.27, .08, .68, '#fbdca7', [0, 1.5, 0]);
      } else {
        const height = kind === 'jump' ? P.C.HURDLE_HEIGHT : .86;
        for (const side of [-1, 1]) kiste(group, .09, height, .09, '#fff5e5', [side * .61, height / 2, 0]);
        kiste(group, 1.33, kind === 'jump' ? .1 : .30, .16, kind === 'jump' ? '#ffb858' : '#62cbdc', [0, kind === 'jump' ? height - .05 : .69, 0]);
        if (kind === 'slide') kiste(group, .3, .055, .19, '#fff5e5', [0, .7, .09]);
      }
      group.userData.kind = kind; group.userData.row = row.index; group.userData.lane = lane;
      this.scene.add(group); this.hurdles.set(`${row.index}:${lane}`, group);
    }));
    const ownColor = players.find(p => p.id === this.getControlledPlayerId())?.color || '#ffe07b';
    const haloGeo = new THREE.RingGeometry(.32, .38, 24); haloGeo.userData.block = true;
    this.ownHalo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({color:ownColor,side:THREE.DoubleSide}));
    this.ownHalo.rotation.x = -Math.PI / 2; this.ownHalo.position.y = .018; this.scene.add(this.ownHalo);
    this.energyFill = this.hud.querySelector('[data-sprint-fill]');
    this.energyText = this.hud.querySelector('[data-sprint-energy]');
    this.energyMeter = this.hud.querySelector('[role=meter]');
    this.status = this.hud.querySelector('[data-sprint-state]');
    this.distance = this.hud.querySelector('[data-sprint-distance]');
  }

  onUpdate(update) {
    const course = update.arcade?.hurdles;
    if (!course) return;
    const key = JSON.stringify(course);
    if (key === this.courseKey) return;
    this.courseKey = key;
    for (const hurdle of this.hurdles.values()) {
      const row = course[hurdle.userData.row];
      if (row) hurdle.position.z = -row.at * METRE;
    }
    this.verdicts.clear();
  }

  shot() {
    return { look: [0, 0.3, -3.8], frame: { w: 5.8, h: 6.6 }, yaw: 0,
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
    return { look: [0, 0.35, (own?.position.z || 0) - (landscape ? 2.3 : 4.4)],
      frame: { w: 5.8, h: landscape ? 3.9 : 6.6 } };
  }

  bind() {
    this.controls.innerHTML = `<div class="sprint-controls swipe-only"><p class="sprint-cue" data-sprint-cue>← → Spur · ↑ Sprung · ↓ Slide</p><p class="sprint-gesture-note">Auf dem Spielfeld halten: Sprint · loslassen: aufladen</p></div>`;
    this.cue = this.controls.querySelector('[data-sprint-cue]');
    this.gestureNote=this.controls.querySelector('.sprint-gesture-note');
    const surface = this.webglCanvas; surface.style.touchAction = 'none'; surface.tabIndex=0;
    surface.setAttribute('aria-label','Zielgerade: links/rechts wischen, hoch springen, runter sliden; halten sprintet.');
    this.controls.style.pointerEvents='none';
    this.on(surface, 'pointerdown', event => {
      if (this.pointer !== null || !this.canAct()) return;
      event.preventDefault(); surface.focus({preventScroll:true}); this.pointer = event.pointerId;
      this.anchor = {x:event.clientX,y:event.clientY}; this.lastSwipe = -1000;
      surface.setPointerCapture?.(event.pointerId);
      this.holdDelay = setTimeout(() => { if (this.pointer !== null) this.setHolding(true); }, 170);
      surface.classList.add('runner-touch'); this.feedback?.vibrate(6);
    });
    this.on(surface, 'pointermove', event => {
      if (event.pointerId !== this.pointer) return;
      event.preventDefault();
      const dx = event.clientX - this.anchor.x, dy = event.clientY - this.anchor.y;
      if (Math.hypot(dx,dy) < 28 || performance.now()-this.lastSwipe < 205) return;
      this.lastSwipe = performance.now(); this.anchor = {x:event.clientX,y:event.clientY};
      if (Math.abs(dx)>Math.abs(dy)) this.gesture('lane',dx<0?-1:1);
      else this.gesture(dy<0?'jump':'slide');
    });
    const end = event => { if (event.pointerId === this.pointer) this.release(); };
    for (const type of ['pointerup','pointercancel','lostpointercapture']) this.on(surface,type,end);
    this.on(window,'blur',()=>this.release()); this.on(window,'resize',()=>this.release());
    this.on(document,'visibilitychange',()=>{if(document.hidden)this.release();});
    this.on(window,'keydown',event=>{
      if(event.target?.closest('input,textarea,select,button') || !this.canAct())return;
      if(['ArrowLeft','KeyA','ArrowRight','KeyD','ArrowUp','KeyW','ArrowDown','KeyS','Space','ShiftLeft','ShiftRight'].includes(event.code)) {
        event.preventDefault();
        if(['Space','ShiftLeft','ShiftRight'].includes(event.code)) {this.setHolding(true);return;}
        if(event.repeat)return;
        this.gesture(['ArrowLeft','KeyA','ArrowRight','KeyD'].includes(event.code)?'lane':['ArrowUp','KeyW'].includes(event.code)?'jump':'slide', ['ArrowLeft','KeyA'].includes(event.code)?-1:1);
      }
    });
    this.on(window,'keyup',event=>{if(['Space','ShiftLeft','ShiftRight'].includes(event.code)){event.preventDefault();this.setHolding(false);}});
  }
  canAct() { const p=this.ownEntry(),g=this.update||this.minigame; return p && p.finishedAt===null && this.now()>=g.startedAt && !g.finaleAt && !this.controls.inert; }
  release() {
    clearTimeout(this.holdDelay); this.holdDelay=null;
    const id=this.pointer; this.pointer=null;
    if(id!==null && this.webglCanvas.hasPointerCapture?.(id))this.webglCanvas.releasePointerCapture(id);
    this.webglCanvas.classList.remove('runner-touch'); this.setHolding(false);
  }
  gesture(action,dir) {
    if(!this.canAct())return;
    if(action==='jump'){this.springen();return;}
    if(action==='slide'){
      const now=this.now(),p=this.ownEntry();
      if(now<p.slideReadyAt || now<p.stumbleUntil)return;
      this.localJump=null;this.localSlide={slideAt:now,slideUntil:now+P.C.SLIDE_MS,until:now+300,from:p.slideAt};
    }
    this.feedback?.sound(action==='lane'?'move':'swish');this.feedback?.vibrate(6);
    this.sendInput({action,...(action==='lane'?{dir}:{})}).catch(()=>{this.localSlide=null;});
  }
  ownEntry() { return (this.update || this.minigame)?.arcade?.players[this.getControlledPlayerId()]; }
  setHolding(active) {
    if (active && (this.ownEntry()?.finishedAt !== null || this.update?.finaleAt)) return;
    if (active && (!this.canAct() || this.holding)) return;
    this.holding = active;
    this.webglCanvas?.classList.toggle('runner-holding', active);
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
  unbind() { clearTimeout(this.holdDelay); clearInterval(this.holdTimer); this.holdTimer = null; this.holding = false; this.pointer = null; this.controls.style.pointerEvents=""; }
  onFinale() { this.release(); }

  tick(f) {
    if (!f.arcade) return;
    const own = f.arcade.players[f.controlledId];
    if (this.holding && (f.finale || own?.finishedAt !== null)) this.release();
    if (this.localJump && (own?.jumpAt !== this.localJump.fromJump || f.now > this.localJump.until)) this.localJump = null;
    if(this.localSlide && (own?.slideAt !== this.localSlide.from || f.now > this.localSlide.until))this.localSlide=null;
    f.players.forEach(player => {
      const entry = f.arcade.players[player.id]; if (!entry) return;
      const kin = this.kins.get(player.id), animator = this.animators.get(player.id);
      if (!kin) return;
      const predicted = Math.min(P.C.LENGTH, entry.progress + (f.started && entry.finishedAt === null ? entry.speed * Math.max(0, Math.min(0.1, (f.now - entry.updatedAt) / 1000)) : 0));
      kin.position.x = this.laneX(P.lanePosition(entry, f.now));
      kin.rotation.y += ((entry.finishedAt !== null ? 0 : Math.PI) - kin.rotation.y) * frameLerp(0.16, f.dt);
      if (entry.finishedAt !== null && !this.celebrated.has(player.id)) {
        this.celebrated.add(player.id);
        if (player.id === f.controlledId) { this.feedback?.sound('win'); this.feedback?.vibrate([12, 30, 12]); }
      }
      kin.position.z += (-predicted * METRE - kin.position.z) * frameLerp(0.45, f.dt);
      const jump = player.id === f.controlledId && this.localJump ? this.localJump : entry;
      const lift = P.height(jump, f.now);
      const sliding = player.id === f.controlledId && this.localSlide ? this.localSlide : entry;
      kin.userData.runnerSlide = P.slideFactor(sliding,f.now);
      const wasAir = kin.userData.sprintAir;
      kin.userData.sprintHeight = lift;
      kin.userData.sprintAir = lift > 0.01;
      animator.groundY = standOn(lift);
      animator.rate = Math.max(0.5, entry.speed / 5.8);
      animator.set(entry.finishedAt !== null ? 'cheer' : f.now < entry.stumbleUntil ? 'stumble' : lift > 0.01 ? 'ready' : kin.userData.runnerSlide > .05 ? 'slide' : !f.started ? 'ready' : entry.sprinting ? 'sprint' : 'run');
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
    const kin = this.kins.get(f.controlledId);
    if(kin)this.ownHalo.position.set(kin.position.x,.018,kin.position.z);

  }

  afterAnimate() {
    this.kins.forEach(kin => {
      kin.scale.y = 1 - (kin.userData.runnerSlide || 0) * .38;
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
        else if (kin.userData.runnerSlide > .01 || sole < 0) kin.position.y -= sole;
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
    this.controls.classList.toggle('is-holding',this.holding);
    this.gestureNote.textContent=this.holding ? own.exhausted?'Leer · loslassen zum Aufladen':'Sprint · Ausdauer wird verbraucht':'Auf dem Spielfeld halten: Sprint · loslassen: aufladen';
    const stumble = f.now < own.stumbleUntil;
    this.status.textContent = own.finishedAt !== null ? 'Im Ziel' : !f.started ? 'Bereit am Start' : stumble ? 'Straucheln' : f.now < own.jumpUntil ? 'Im Sprung' : P.slideFactor(own,f.now)>.05 ? 'Slide' : own.exhausted ? own.holding ? 'Leer · loslassen!' : 'Ausdauer lädt'  : own.sprinting ? 'Sprint' : 'Erholen';
    const row = f.arcade.hurdles[own.nextHurdle];
    const kind = row?.lanes[own.lane];
    const prediction = {...own,progress:own.progress+own.speed*Math.max(0,Math.min(.1,(f.now-own.updatedAt)/1000))};
    const ready = kind==='jump' && P.jumpWindow(prediction,row) || kind==='slide' && (row.at-prediction.progress)/Math.max(1,prediction.speed)<.5;
    this.cue.classList.toggle('is-ready',Boolean(ready));
    this.cue.textContent = own.finishedAt!==null ? `${own.cleared}/${f.arcade.hurdles.length} sauber · ${f.finale?'Rennen beendet':'Andere laufen noch'}` : !f.started ? '← → Spur · ↑ Sprung · ↓ Slide' : stumble ? 'Erwischt · weiter geht’s' : ready ? kind==='jump'?'↑ JETZT SPRINGEN':'↓ JETZT SLIDEN' : row ? `${kind==='block'?'← → SPUR WECHSELN':kind==='jump'?'↑ SPRUNG':kind==='slide'?'↓ SLIDE':'Freie Spur'} · ${Math.ceil(Math.max(0,row.at-own.progress))} m` : 'ZIELGERADE · ENDSPURT!';
  }
}
