export class Feedback {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.compressor = null;
    this.enabled = localStorage.getItem("tumblekin-sound") !== "off";
    this.vibrationEnabled = localStorage.getItem("tumblekin-vibration") !== "off";
    this.unlocked = false;
  }

  setSoundEnabled(enabled) {
    this.enabled = Boolean(enabled);
    localStorage.setItem("tumblekin-sound", this.enabled ? "on" : "off");
  }

  setVibrationEnabled(enabled) {
    this.vibrationEnabled = Boolean(enabled);
    localStorage.setItem("tumblekin-vibration", this.vibrationEnabled ? "on" : "off");
  }

  attachUnlock() {
    const unlock = () => {
      this.ensureAudio();
      if (this.audioContext?.state === "suspended") this.audioContext.resume().catch(() => {});
      this.unlocked = true;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
  }

  vibrate(pattern = 18) {
    if (!this.vibrationEnabled) return;
    if (!("vibrate" in navigator)) return;
    const softened = Array.isArray(pattern)
      ? pattern.map((value, index) => Math.min(value, index % 2 === 0 ? 32 : 24))
      : Math.min(pattern, 28);
    navigator.vibrate(softened);
  }

  sound(name, { pan = 0 } = {}) {
    if (!this.enabled) return;
    const context = this.ensureAudio();
    if (!context || context.state !== "running") return;

    const sequences = {
      tap: [tone(520, 410, 0.065, "sine", 0.022)],
      move: [tone(270, 390, 0.09, "sine", 0.022)],
      step: [tone(245, 330, 0.055, "triangle", 0.014)],
      roll: [
        tone(145, 220, 0.13, "triangle", 0.032),
        tone(205, 310, 0.13, "triangle", 0.029, 0.07),
        tone(285, 430, 0.16, "sine", 0.027, 0.14)
      ],
      success: [
        tone(523, 520, 0.19, "sine", 0.033),
        tone(659, 655, 0.21, "sine", 0.03, 0.09),
        tone(784, 920, 0.28, "sine", 0.032, 0.18)
      ],
      land: [
        { noise: true, duration: 0.075, gain: 0.01 },
        tone(155, 92, 0.15, "triangle", 0.026)
      ],
      core: [
        tone(392, 523, 0.2, "sine", 0.029),
        tone(523, 784, 0.24, "sine", 0.031, 0.1),
        tone(784, 1175, 0.32, "triangle", 0.026, 0.22)
      ],
      perfect: [
        tone(660, 990, 0.16, "sine", 0.028),
        tone(990, 1480, 0.22, "sine", 0.025, 0.08)
      ],
      win: [
        tone(392, 523, 0.2, "triangle", 0.026),
        tone(523, 659, 0.22, "triangle", 0.028, 0.1),
        tone(659, 1047, 0.34, "sine", 0.032, 0.22)
      ],
      error: [
        tone(205, 138, 0.24, "triangle", 0.026),
        tone(154, 110, 0.22, "sine", 0.017, 0.07)
      ],
      countdown: [tone(680, 620, 0.1, "sine", 0.024)],
      coin: [
        tone(780, 1080, 0.11, "sine", 0.024),
        tone(1170, 1380, 0.15, "sine", 0.026, 0.08)
      ],
      portal: [
        tone(240, 720, 0.38, "sine", 0.027),
        tone(480, 980, 0.34, "triangle", 0.018, 0.07)
      ],
      paint: [tone(360, 720, 0.11, "sine", 0.02)],
      // Kreuzung: zwei aufsteigende Töne, die eine FRAGE stellen, statt eine
      // Bewegung zu begleiten — hier steht eine Entscheidung an. Der Ruf wurde
      // an der Kreuzung immer schon abgesetzt, aber nie definiert: der eine
      // Moment im Spiel, der ausdrücklich einen eigenen Ton haben sollte, war
      // stumm.
      select: [
        tone(430, 560, 0.1, "triangle", 0.026),
        tone(620, 780, 0.14, "sine", 0.024, 0.09)
      ],
      lock: [
        tone(390, 360, 0.1, "triangle", 0.024),
        tone(760, 920, 0.2, "sine", 0.032, 0.07)
      ],
      impact: [
        { noise: true, duration: 0.11, gain: 0.018 },
        tone(130, 76, 0.2, "triangle", 0.038)
      ],
      collision: [
        { noise: true, duration: 0.095, gain: 0.022 },
        tone(185, 72, 0.18, "square", 0.025)
      ],
      fall: [
        tone(330, 82, 0.46, "sine", 0.028),
        { noise: true, duration: 0.14, gain: 0.012, offset: 0.24 }
      ],
      pop: [
        { noise: true, duration: 0.03, gain: 0.014 },
        tone(340, 620, 0.08, "sine", 0.032)
      ],
      plink: [tone(820 + Math.random() * 320, 1350, 0.06, "sine", 0.02)],
      clack: [
        { noise: true, duration: 0.045, gain: 0.026 },
        tone(230, 150, 0.09, "triangle", 0.03)
      ],
      drop: [tone(520, 210, 0.12, "sine", 0.024)],
      whoosh: [
        { noise: true, duration: 0.2, gain: 0.016 },
        tone(180, 420, 0.18, "sine", 0.012, 0.02)
      ],
      combo: [
        tone(660, 880, 0.1, "sine", 0.026),
        tone(990, 1320, 0.15, "sine", 0.024, 0.06)
      ],
      sparkle: [
        tone(1180, 1760, 0.08, "sine", 0.019),
        tone(1560, 2200, 0.11, "sine", 0.015, 0.05)
      ],
      swish: [
        { noise: true, duration: 0.16, gain: 0.013 },
        tone(300, 640, 0.14, "sine", 0.01, 0.01)
      ]
    };

    const now = context.currentTime;
    const clampedPan = Math.max(-1, Math.min(1, pan));
    (sequences[name] || sequences.tap).forEach((preset) => {
      const start = now + (preset.offset || 0);
      if (preset.noise) this.playNoise(context, start, preset, clampedPan);
      else this.playTone(context, start, preset, clampedPan);
    });
  }

  // A per-voice output stage: optional stereo placement then the shared bus.
  voiceOutput(context, pan) {
    const destination = this.masterGain || context.destination;
    if (!pan || typeof context.createStereoPanner !== "function") return { input: destination, tail: null };
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(destination);
    return { input: panner, tail: panner };
  }

  playTone(context, start, preset, pan = 0) {
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const out = this.voiceOutput(context, pan);
    oscillator.type = preset.type;
    oscillator.detune.setValueAtTime((Math.random() - 0.5) * 5, start);
    oscillator.frequency.setValueAtTime(preset.frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, preset.endFrequency), start + preset.duration);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2400, start);
    filter.frequency.exponentialRampToValueAtTime(1100, start + preset.duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(preset.gain, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + preset.duration);
    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(out.input);
    oscillator.start(start);
    oscillator.stop(start + preset.duration + 0.02);
    if (out.tail) oscillator.addEventListener("ended", () => out.tail.disconnect());
  }

  playNoise(context, start, preset, pan = 0) {
    const length = Math.max(1, Math.floor(context.sampleRate * preset.duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      const fade = 1 - index / length;
      data[index] = (Math.random() * 2 - 1) * fade;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const out = this.voiceOutput(context, pan);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(760, start);
    filter.frequency.exponentialRampToValueAtTime(150, start + preset.duration);
    gain.gain.setValueAtTime(preset.gain, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + preset.duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out.input);
    source.start(start);
    if (out.tail) source.addEventListener("ended", () => out.tail.disconnect());
  }

  ensureAudio() {
    if (this.audioContext) return this.audioContext;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    this.audioContext = new AudioContext();
    this.masterGain = this.audioContext.createGain();
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.masterGain.gain.value = 0.72;
    this.compressor.threshold.value = -26;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.012;
    this.compressor.release.value = 0.24;
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.audioContext.destination);
    return this.audioContext;
  }
}

function tone(frequency, endFrequency, duration, type, gain, offset = 0) {
  return { frequency, endFrequency, duration, type, gain, offset };
}
