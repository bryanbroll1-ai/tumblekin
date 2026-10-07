export class VirtualJoystick {
  constructor({ root, onDirection, onVector, onEngage, feedback, label = "Steuern", intervalMs = 105 }) {
    this.root = root;
    this.onDirection = onDirection;
    this.onVector = onVector; // optional analog callback: (x, y) each in [-1, 1]
    this.onEngage = onEngage;
    this.feedback = feedback;
    this.intervalMs = intervalMs;
    this.pointerId = null;
    this.direction = null;
    this.vecX = 0;
    this.vecY = 0;
    this.engaged = false;
    this.timer = null;

    this.root.innerHTML = `
      <div class="virtual-joystick" role="application" tabindex="0" aria-label="${label}: ziehen oder Pfeiltasten">
        <span class="joystick-axis horizontal"></span>
        <span class="joystick-axis vertical"></span>
        <span class="joystick-knob"></span>
      </div>
    `;
    this.base = this.root.querySelector(".virtual-joystick");
    this.knob = this.root.querySelector(".joystick-knob");
    this.bind();
  }

  bind() {
    this.onPointerDown = (event) => {
      event.preventDefault();
      if (this.pointerId !== null || event.button > 0 || this.root.closest("[inert]")) return;
      this.base.focus({ preventScroll: true });
      this.pointerId = event.pointerId;
      try {
        this.base.setPointerCapture?.(event.pointerId);
      } catch {
        // Zeiger schon weg (siehe MinigameScene.capturePointer).
      }
      this.base.classList.add("active");
      this.feedback?.vibrate(8);
      this.engaged = false;
      this.updatePointer(event);
      this.timer = setInterval(() => this.emitDirection(), this.intervalMs);
    };
    this.onPointerMove = (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this.updatePointer(event);
    };
    this.onPointerEnd = (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this.reset();
    };

    this.base.addEventListener("pointerdown", this.onPointerDown);
    this.base.addEventListener("pointermove", this.onPointerMove);
    this.base.addEventListener("pointerup", this.onPointerEnd);
    this.base.addEventListener("pointercancel", this.onPointerEnd);
    this.base.addEventListener("lostpointercapture", this.onPointerEnd);
    this.onBlur = () => this.reset();
    this.onVisibility = () => { if (document.hidden) this.reset(); };
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.keys = new Set();
    const keyDirection = { ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1] };
    const keyboardVector = () => {
      const x = [...this.keys].reduce((sum, key) => sum + keyDirection[key][0], 0);
      const y = [...this.keys].reduce((sum, key) => sum + keyDirection[key][1], 0);
      const length = Math.max(1, Math.hypot(x, y));
      this.vecX = x / length; this.vecY = y / length;
      this.direction = Math.abs(x) > Math.abs(y) ? (x < 0 ? "left" : "right") : y ? (y < 0 ? "up" : "down") : x ? (x < 0 ? "left" : "right") : null;
      const travel = this.base.getBoundingClientRect().width * 0.31;
      this.knob.style.transform = `translate(${this.vecX * travel}px, ${this.vecY * travel}px)`;
      this.base.classList.toggle("active", Boolean(this.direction));
      this.emitDirection();
    };
    this.onKeyDown = event => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!keyDirection[key] || this.pointerId !== null || this.root.closest("[inert]")) return;
      event.preventDefault();
      if (event.repeat) return;
      this.keys.add(key);
      keyboardVector();
      if (!this.timer) this.timer = setInterval(() => this.emitDirection(), this.intervalMs);
    };
    this.onKeyUp = event => {
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (!this.keys.has(key)) return;
      event.preventDefault();
      this.keys.delete(key);
      keyboardVector();
      if (!this.keys.size) { clearInterval(this.timer); this.timer = null; }
    };
    this.base.addEventListener("keydown", this.onKeyDown);
    this.base.addEventListener("keyup", this.onKeyUp);
    this.base.addEventListener("blur", this.onBlur);
  }

  updatePointer(event) {
    const oldX = this.vecX, oldY = this.vecY;
    const rect = this.base.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const maxDistance = rect.width * 0.31;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > maxDistance ? maxDistance / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    this.knob.style.transform = `translate(${x}px, ${y}px)`;

    // Analog vector, normalised to the knob's travel radius.
    const deadZoneVec = maxDistance * 0.28;
    if (distance < deadZoneVec) {
      this.vecX = 0;
      this.vecY = 0;
    } else {
      this.vecX = x / maxDistance;
      this.vecY = y / maxDistance;
    }

    const deadZone = rect.width * 0.09;
    const nextDirection = distance < deadZone
      ? null
      : (Math.abs(rawX) > Math.abs(rawY) ? (rawX < 0 ? "left" : "right") : (rawY < 0 ? "up" : "down"));
    if (nextDirection !== this.direction) {
      this.direction = nextDirection;
      if (nextDirection) {
        this.feedback?.sound("move");
        this.emitDirection();
        if (!this.engaged) {
          this.engaged = true;
          this.onEngage?.(nextDirection);
        }
      }
      if (!nextDirection) this.emitDirection();
    } else if (this.onVector && Math.hypot(this.vecX - oldX, this.vecY - oldY) > 0.015 && performance.now() - (this.lastEmitAt || 0) >= 25) {
      this.emitDirection();
    }
  }

  emitDirection() {
    this.lastEmitAt = performance.now();
    if (this.onVector) this.onVector(this.vecX, this.vecY);
    if (this.direction && this.onDirection) this.onDirection(this.direction);
  }

  reset() {
    clearInterval(this.timer);
    this.timer = null;
    this.pointerId = null;
    this.direction = null;
    this.vecX = 0;
    this.vecY = 0;
    this.engaged = false;
    this.keys?.clear();
    this.base.classList.remove("active");
    this.knob.style.transform = "translate(0px, 0px)";
    this.onVector?.(0, 0);
  }

  destroy() {
    this.reset();
    this.base.removeEventListener("pointerdown", this.onPointerDown);
    this.base.removeEventListener("pointermove", this.onPointerMove);
    this.base.removeEventListener("pointerup", this.onPointerEnd);
    this.base.removeEventListener("pointercancel", this.onPointerEnd);
    this.base.removeEventListener("lostpointercapture", this.onPointerEnd);
    this.base.removeEventListener("keydown", this.onKeyDown);
    this.base.removeEventListener("keyup", this.onKeyUp);
    this.base.removeEventListener("blur", this.onBlur);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.root.innerHTML = "";
  }
}
