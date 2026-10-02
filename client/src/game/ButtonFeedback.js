// Druckgefühl gehört zur Eingabe, nicht zur Geschwindigkeit der Serverantwort.
// Delegation erfasst auch Knöpfe, die Lobby und Spiel laufend neu zeichnen.
export class ButtonFeedback {
  constructor(feedback) {
    this.feedback = feedback;
    this.pointers = new Map();
    this.keys = new Map();
    this.states = new Map();
    this.recentButton = null;
    this.recentAt = 0;
    this.listen(document, "pointerdown", event => {
      if (event.button > 0) return;
      const button = this.buttonAt(event.target);
      if (!button) return;
      this.pointers.set(event.pointerId, button);
      this.press(button);
      if (!button.closest("#minigame-controls, .practice-layer .minigame-controls")) {
        this.feedback?.sound("press");
        this.feedback?.vibrate(6);
      }
    });
    this.listen(window, "pointerup", event => this.releasePointer(event));
    this.listen(window, "pointercancel", event => this.releasePointer(event, true));
    this.listen(document, "lostpointercapture", event => this.releasePointer(event, true));
    this.listen(window, "keydown", event => this.keyDown(event));
    this.listen(window, "keyup", event => this.keyUp(event));
    this.listen(document, "click", event => {
      // Assistive Technik löst click ohne vorausgehende Pointer-Ereignisse aus.
      const button = this.buttonAt(event.target);
      if (!button || event.detail !== 0) return;
      if (button.closest("#minigame-controls, .practice-layer .minigame-controls")) {
        this.dispatch(button, "pointerdown", -100);
        this.dispatch(button, "pointerup", -100);
      } else this.pulse(button);
    });
    this.listen(window, "blur", () => this.reset());
    this.listen(document, "visibilitychange", () => { if (document.hidden) this.reset(); });
  }

  listen(target, type, fn) {
    target.addEventListener(type, fn, { capture: true });
  }

  buttonAt(target) {
    const button = target?.closest?.("button");
    return button && !button.disabled && !button.closest("[inert], [hidden]") ? button : null;
  }

  press(button) {
    const previous = this.states.get(button);
    clearTimeout(previous?.timer);
    this.states.set(button, { at: performance.now(), timer: null });
    button.classList.add("is-pressed");
    this.recentButton = button;
    this.recentAt = performance.now();
  }

  pulse(button) {
    if (!this.buttonAt(button)) return;
    // Ein Tipp ins Spielbild darf denselben Aktionsknopf eindrücken. Ein
    // tatsächlich gehaltener Finger bleibt dabei unverändert gedrückt.
    if ([...this.pointers.values()].includes(button)) return;
    this.press(button);
    this.release(button);
  }

  releasePointer(event, cancelled = false) {
    const button = this.pointers.get(event.pointerId);
    if (!button) return;
    this.pointers.delete(event.pointerId);
    this.release(button, cancelled);
  }

  release(button, immediate = false) {
    if ([...this.pointers.values(), ...this.keys.values()].includes(button)) return;
    const state = this.states.get(button);
    if (!state) return;
    clearTimeout(state.timer);
    const finish = () => { button.classList.remove("is-pressed"); this.states.delete(button); };
    // Auch ein sehr kurzer Tipp bleibt einen wahrnehmbaren Moment eingedrückt.
    const delay = immediate ? 0 : Math.max(0, 90 - (performance.now() - state.at));
    if (!delay) finish();
    else state.timer = setTimeout(finish, delay);
  }

  keyDown(event) {
    if (!["Space", "Enter"].includes(event.code)) return;
    const button = this.buttonAt(event.target);
    if (!button) return;
    if (event.repeat) {
      if (button.closest("#minigame-controls, .practice-layer .minigame-controls")) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    this.keys.set(event.code, button);
    if (button.closest("#minigame-controls, .practice-layer .minigame-controls")) {
      event.preventDefault();
      event.stopPropagation();
      this.dispatch(button, "pointerdown", event.code === "Space" ? -101 : -102);
    } else {
      this.press(button);
      this.feedback?.sound("press");
      this.feedback?.vibrate(6);
    }
  }

  keyUp(event) {
    const button = this.keys.get(event.code);
    if (!button) return;
    this.keys.delete(event.code);
    if (button.closest("#minigame-controls, .practice-layer .minigame-controls")) {
      event.preventDefault();
      event.stopPropagation();
      this.dispatch(button, "pointerup", event.code === "Space" ? -101 : -102);
    }
    this.release(button);
  }

  dispatch(button, type, pointerId) {
    const rect = button.getBoundingClientRect();
    button.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId, pointerType: "", button: 0,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
    }));
  }

  reset() {
    for (const [code, button] of this.keys) {
      if (button.closest("#minigame-controls, .practice-layer .minigame-controls")) this.dispatch(button, "pointercancel", code === "Space" ? -101 : -102);
    }
    this.keys.clear();
    this.pointers.clear();
    for (const [button, state] of this.states) {
      clearTimeout(state.timer);
      button.classList.remove("is-pressed");
    }
    this.states.clear();
    this.recentButton = null;
  }
}
