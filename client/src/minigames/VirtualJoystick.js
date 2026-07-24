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
      <div class="virtual-joystick" role="application" aria-label="${label}">
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
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.base.setPointerCapture?.(event.pointerId);
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
  }

  updatePointer(event) {
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
    }
  }

  emitDirection() {
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
    this.root.innerHTML = "";
  }
}
