import { MINIGAME_SCENES as SCENES } from "../minigames/scenes.js?v=tumblekin210";
export const canPractice = type => Boolean(SCENES[type]);

export class PracticeSession {
  constructor(feedback, onChange, onError) {
    this.feedback = feedback;
    this.onChange = onChange;
    this.onError = onError;
    this.pending = new Map();
    this.active = false;
    this.serial = 0;
    this.generation = 0;
  }

  open(minigame, color) {
    if (this.active || !canPractice(minigame.type)) return;
    this.active = true;
    this.type = minigame.type;
    this.color = color;
    this.returnFocus = document.activeElement;
    const layer = document.createElement('section');
    layer.className = 'practice-layer';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'practice-title');
    layer.innerHTML = `<header class="practice-header">
      <div><strong id="practice-title">Übungsversuch</strong><small>Deine Partiepunkte bleiben unverändert</small></div>
      <button type="button" class="chip" data-practice-retry disabled>Neu</button>
      <button type="button" class="chip is-active" data-practice-close>Fertig</button>
      </header><canvas class="minigame-canvas"></canvas>
      <div class="minigame-controls"></div>
      <p class="practice-loading" role="status">Übung wird vorbereitet …</p>`;
    document.body.appendChild(layer);
    this.layer = layer;
    this.closeButton = layer.querySelector('[data-practice-close]');
    this.retryButton = layer.querySelector('[data-practice-retry]');
    this.loading = layer.querySelector('.practice-loading');
    this.closeButton.addEventListener('click', () => this.close());
    this.retryButton.addEventListener('click', () => {
      this.retryButton.disabled = true;
      this.loading.hidden = false;
      this.scene?.destroy();
      this.scene = null;
      cancelAnimationFrame(this.beginFrame);
      this.startAttempt();
    });
    this.keys = event => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
      if (event.key !== 'Tab') return;
      const buttons = [...layer.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    };
    document.addEventListener('keydown', this.keys);
    this.onChange();
    this.closeButton.focus();
    try {
      this.worker = new Worker('/src/practice/engine-worker.js?v=tumblekin210');
      this.worker.onerror = () => this.fail('Die Übung konnte nicht geladen werden.');
      this.bootTimer = setTimeout(() => this.fail('Die Übung konnte nicht geladen werden.'), 10000);
      this.worker.onmessage = ({ data }) => {
        if (!this.active) return;
        if (data.kind === 'error') { this.fail('Die Übung konnte nicht fortgesetzt werden.'); return; }
        if (data.generation !== this.generation) return;
        if (data.kind === 'reply') {
          const pending = this.pending.get(data.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(data.id);
          if (data.response?.ok) pending.resolve(data.response);
          else pending.reject(new Error(data.response?.error || 'Diese Aktion ist gerade nicht möglich.'));
        }
        if (data.kind !== 'state') return;
        clearTimeout(this.bootTimer);
        this.state = data.state;
        const game = data.state.currentMinigame;
        if (!this.scene) {
          try {
            this.scene = new SCENES[this.type]({
              canvas: layer.querySelector('canvas'), controls: layer.querySelector('.minigame-controls'),
              sendInput: input => this.sendInput(input), now: () => Date.now(),
              getState: () => this.state, getControlledPlayerId: () => 'practice',
              myPlayerId: 'practice', feedback: this.feedback
            });
            this.scene.onInputError = error => { if (this.active) this.onError(error.message); };
            this.scene.start(game);
            const generation = this.generation;
            this.beginFrame = requestAnimationFrame(() => {
              this.beginFrame = requestAnimationFrame(() => {
                if (this.active && generation === this.generation) this.worker.postMessage({ kind: 'begin', generation });
              });
            });
          } catch { this.fail('Die Übung konnte nicht dargestellt werden.'); return; }
        } else this.scene.handleUpdate(game);
        this.loading.hidden = !data.prepared;
        this.retryButton.disabled = data.prepared;
        const countdown = Math.ceil((game.startedAt - Date.now()) / 1000);
        layer.querySelector('#practice-title').textContent = game.finaleAt ? 'Probe beendet'
          : data.prepared ? 'Übung vorbereiten …' : countdown > 0 ? `Start in ${countdown} …` : 'Übungsversuch';
      };
      this.startAttempt();
    } catch { this.fail('Dein Browser konnte die Übung nicht starten.'); }
  }

  sendInput(input) {
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Die Übung antwortet gerade nicht.')); }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ kind: 'input', input, id, generation: this.generation });
    });
  }

  startAttempt() {
    this.generation++;
    // Replies and snapshots from the previous attempt may still be queued.
    // A fresh generation keeps them from rebuilding a discarded scene.
    this.pending.forEach(p => { clearTimeout(p.timer); p.resolve({ ok: true, cancelled: true }); });
    this.pending.clear();
    this.state = null;
    clearTimeout(this.bootTimer);
    this.bootTimer = setTimeout(() => this.fail('Die Übung konnte nicht geladen werden.'), 10000);
    this.worker.postMessage({ kind: 'start', type: this.type, color: this.color, generation: this.generation });
  }

  fail(message) { this.close(); this.onError(message); }

  close() {
    if (!this.active) return;
    this.active = false;
    cancelAnimationFrame(this.beginFrame);
    clearTimeout(this.bootTimer);
    this.worker?.terminate();
    this.worker = null;
    this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('Übung beendet.')); });
    this.pending.clear();
    this.scene?.destroy();
    this.scene = null;
    document.removeEventListener('keydown', this.keys);
    this.layer?.remove();
    this.layer = null;
    this.state = null;
    this.onChange();
    if (this.returnFocus?.isConnected && !this.returnFocus.disabled) this.returnFocus.focus({ preventScroll: true });
  }
}
