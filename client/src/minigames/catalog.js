export const GESTURES = {
  tap: { icon: "👆", label: "Tippen" },
  taps: { icon: "👆👆", label: "Schnell tippen" },
  joystick: { icon: "🕹️", label: "Stick ziehen" },
  drag: { icon: "👆↔️", label: "Horizontal ziehen" },
  swipeUp: { icon: "👆⬆️", label: "Nach oben wischen" }
};

export const MINIGAME_CATALOG = [
  { type: "bounceArena", title: "Bumper Bloom", gesture: "joystick", help: "Drängen, rammen, auf der Platte bleiben." },
  { type: "driftDocks", title: "Drift Docks", family: "kinetic", gesture: "joystick", help: "Münzen holen und dem Dreharm ausweichen." },
  { type: "lanternLift", title: "Lantern Lift", family: "direct", gesture: "drag", help: "Den Korb ziehen, Lichter fangen, Stürme meiden." },
  { type: "balanceBrew", title: "Balance Brew", family: "direct", gesture: "drag", help: "Die Kugel im wandernden Ruhefeld halten." },
  { type: "canopyClimb", title: "Vine Vault", gesture: "tap", help: "Zur richtigen Blattseite springen." },
  { type: "fluxFloor", title: "Glow Grid", gesture: "tap", help: "Fläche erobern und Rivalen verdrängen." },
  { type: "dodgeBlocks", title: "Cloudbreak", gesture: "tap", help: "Den Warnungen ausweichen." },
  { type: "timingStop", title: "Pulse Pin", gesture: "tap", help: "Den Puls im hellen Sektor stoppen." },
  { type: "petalPanic", title: "Petal Panic", family: "choice", gesture: "tap", help: "Springe sofort auf das tragende Blatt." },
  { type: "orbitDrop", title: "Orbit Drop", family: "timing", gesture: "tap", help: "Ein Versuch pro Umlauf. Triff die Fassung." },
  { type: "tideTap", title: "Tide Tap", family: "timing", gesture: "tap", help: "Triff den wechselnden Wellenkamm." },
  { type: "fireflySweep", title: "Coin Sweep", family: "steer", gesture: "joystick", help: "Jage die Münze mit dem Joystick." },
  { type: "iceDrift", title: "Ice Drift", family: "steer", gesture: "joystick", help: "Zwischen den Eisbrocken driften." },
  { type: "magnetMates", title: "Magnet Mates", family: "steer", gesture: "joystick", help: "Am bewegten Magnetkern bleiben." },
  { type: "gravityGarden", title: "Gravity Garden", family: "steer", gesture: "joystick", help: "Im wandernden Schwerkraftfeld bleiben." },
  { type: "sparkSort", title: "Coin Sort", family: "target", gesture: "tap", help: "Goldmünzen treffen, rote Nieten meiden." },
  { type: "bubblePop", title: "Bubble Bay", family: "target", gesture: "tap", help: "Aufsteigende Blasen sanft zerplatzen lassen." },
  { type: "plinkoDrop", title: "Plinko Falls", family: "plinko", gesture: "tap", help: "Kugeln fallen lassen und die Mitte treffen." },
  { type: "curlingSlide", title: "Slide Stones", family: "curling", gesture: "swipeUp", help: "Steine ins Ziel schlittern lassen." }
];

export const ARCADE_TYPES = new Set(
  MINIGAME_CATALOG.filter((game) => game.family).map((game) => game.type)
);

export function minigameMeta(type) {
  return MINIGAME_CATALOG.find((game) => game.type === type) || null;
}

export function gestureMeta(type) {
  const meta = minigameMeta(type);
  return GESTURES[meta?.gesture] || GESTURES.tap;
}
