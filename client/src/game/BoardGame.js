import * as THREE from "/vendor/three/three.module.js";
import { drawDiceFace } from "./Dice.js?v=tumblekin126";
import { FIELD_COLORS } from "./GameState.js?v=tumblekin126";
import { boardTheme, createThemeLayout } from "./BoardThemes.js?v=tumblekin126";
import { CubeBurst, FloatingText } from "../minigames/VoxelKit.js?v=tumblekin126";
import { frameDecay, frameLerp } from "../minigames/Quality.js?v=tumblekin126";

const EVENT_FIELDS = new Set(["challenge", "gate", "star", "coin", "item", "luck", "trap"]);
const CAMERA_DAMPING = 6.5;
// Blickwinkel über der Brettebene für die Übersicht im Hochformat, in Grad.
// Die Brettthemen kommen mit rund 67° — fast senkrecht von oben.
const BOARD_TILT_PORTRAIT = 48;

export class BoardGame {
  constructor(container, feedback = null) {
    this.container = container;
    this.feedback = feedback;
    this.theme = boardTheme("mossback");
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.theme.background);
    this.scene.fog = new THREE.Fog(this.theme.fog, 16, 34);

    this.camera = new THREE.PerspectiveCamera(43, 1, 0.1, 80);
    this.camera.position.set(0.2, 8.6, 8.3);
    this.cameraTarget = new THREE.Vector3(0, 0.2, 0);
    this.cameraMode = "overview";
    this.cameraModeStartedAt = performance.now();
    this.cameraModeUntil = 0;
    this.cameraFieldIndex = 0;
    this.cameraFocus = new THREE.Vector3();
    this.lastFrameAt = performance.now();
    this.viewportRatio = 1;
    this.active = false;
    // Griff für die Messwerkzeuge, genau wie window.__tumblekinScene bei den
    // Minispielen. Kostet nichts und ist im Spiel nicht sichtbar.
    window.__tumblekinBoard = this;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.themeGroup = new THREE.Group();
    this.boardGroup = new THREE.Group();
    this.tokenGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.world.add(this.themeGroup, this.boardGroup, this.tokenGroup, this.fxGroup);

    this.fieldMeshes = [];
    this.fieldPositions = [];
    this.starBeacon = null;
    this.lastStarIndex = null;
    this.bursts = null;
    this.floaters = null;
    this.tokens = new Map();
    this.animations = new Map();
    this.animatingPlayers = new Set();
    this.state = null;
    this.currentFieldIndex = null;
    this.lastFieldSignature = "";
    this.lastBoardId = "";
    this.lastCurrentPlayerId = null;
    this.lastBoardStatus = null;
    this.diceSpinUntil = 0;
    this.diceHideAt = 0;
    this.dicePulse = 0;
    this.diceHome = new THREE.Vector3(0, 1.9, 0);
    this.animatedLandmarks = [];
    this.landingBursts = [];

    this.createLights();
    this.createParticles();
    this.createDice();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.loop();
  }

  setState(state) {
    if (!state) return;
    const previousState = this.state;
    this.state = state;
    const boardId = state.board?.id || state.boardId || "mossback";
    const signature = `${boardId}:${state.fieldTypes.join("|")}:${JSON.stringify(state.board?.routes || [])}`;
    const boardChanged = signature !== this.lastFieldSignature;
    if (boardChanged) {
      this.setTheme(boardId);
      this.createBoard(state.board || { fieldTypes: state.fieldTypes, routes: state.fieldTypes.map((_type, index) => [(index + 1) % state.fieldTypes.length]) });
      this.lastFieldSignature = signature;
    }
    this.syncPlayers(state);
    this.syncStarBeacon(state);
    this.highlightCurrent(state);
    const currentChanged = state.currentPlayerId !== this.lastCurrentPlayerId;
    const returning = previousState && previousState.status !== "board" && state.status === "board";
    if (returning) this.setCameraMode("return", { duration: 1250, fieldIndex: state.players.find((player) => player.id === state.currentPlayerId)?.position });
    else if (!boardChanged && currentChanged && state.phase === "waitingRoll") this.setCameraMode("turn", { duration: 1000, fieldIndex: state.players.find((player) => player.id === state.currentPlayerId)?.position });
    this.lastCurrentPlayerId = state.currentPlayerId;
    this.lastBoardStatus = state.status;
  }

  // An einer Kreuzung: die Kamera geht dicht heran, damit man beide Wege sieht,
  // zwischen denen man gerade wählt.
  focusField(fieldIndex) {
    if (fieldIndex === null || fieldIndex === undefined) return;
    this.setCameraMode("junction", { duration: 9000, fieldIndex });
  }

  // Parks the beacon on the lit star pad. Called on every state update, so it
  // follows the star as it jumps after each sale.
  syncStarBeacon(state) {
    const index = state.starIndex;
    // fieldPositions are expressed in world/boardGroup space, so the beacon and
    // the effect systems must be parented there too — attaching them to the
    // scene root put them in a different coordinate space and off screen.
    if (!this.bursts) this.bursts = new CubeBurst(this.fxGroup);
    if (!this.floaters) this.floaters = new FloatingText(this.fxGroup);
    if (!this.starBeacon) {
      this.starBeacon = createStarBeacon();
      this.fxGroup.add(this.starBeacon);
    }
    if (index === null || index === undefined || !this.fieldPositions[index]) {
      this.starBeacon.visible = false;
      this.lastStarIndex = null;
      return;
    }
    this.starBeacon.visible = true;
    if (index === this.lastStarIndex) return;
    const spot = this.fieldPositions[index];
    this.starBeacon.position.set(spot.x, spot.y + 1.35, spot.z);
    // A burst on arrival sells the "the star moved!" moment.
    if (this.lastStarIndex !== null) {
      this.spawnStarArrival(spot);
    }
    this.lastStarIndex = index;
  }

  // Confetti when the star relocates to a new pad.
  spawnStarArrival(spot) {
    if (!this.bursts) return;
    this.bursts.spawn(
      new THREE.Vector3(spot.x, spot.y + 0.4, spot.z),
      ["#ffe36b", "#ffb400", "#ffffff"],
      { count: 18, speed: 1.8, up: 2.2, size: 0.07, life: 0.8, drag: 1.4 }
    );
  }

  setActive(active) {
    this.active = Boolean(active);
    if (!this.active) return;
    this.lastFrameAt = performance.now();
    this.resize();
  }

  animateMove(move) {
    if (!move?.path?.length) return;
    const diceDelay = Math.max(750, move.diceDelayMs || 1050);
    this.rollDice(move.dice, move.from, Math.max(520, diceDelay - 260));
    const token = this.tokens.get(move.playerId);
    if (!token) return;

    const route = [move.from, ...move.path];
    const movementDuration = Math.max(0, (move.durationMs || 0) - diceDelay);
    const duration = Math.max(
      165,
      move.stepDurationMs || movementDuration / Math.max(1, route.length - 1)
    );
    const now = performance.now();
    token.scale.setScalar(0.84);
    this.animatingPlayers.add(move.playerId);
    this.animations.set(move.playerId, {
      route,
      duration,
      startedAt: now + diceDelay,
      lastSegment: -1
    });
    this.cameraFieldIndex = move.from;
    this.setCameraMode("dice", { duration: diceDelay, fieldIndex: move.from });
  }

  showLanding(landing) {
    this.cameraFieldIndex = landing.to;
    this.setCameraMode(landing.fieldType === "gate" ? "event" : "landing", {
      duration: landing.fieldType === "gate" ? 1250 : 920,
      fieldIndex: landing.to
    });
    const token = this.tokens.get(landing.playerId);
    const effect = landing.fieldEffect || {};
    // Der Sternkauf steht in einem EIGENEN Feld der Meldung, nicht in der
    // Feldwirkung: man kauft ihn im VORBEIGEHEN, die Feldwirkung gehört zum
    // Feld, auf dem man stehenbleibt. Hier wurde nur die Feldwirkung gelesen —
    // effect.starGained war damit nie wahr, und die ganze Sternfeier unten,
    // Konfetti samt Ausruf, hat nie ein einziges Mal ausgelöst. Der beste
    // Moment des Spiels lief völlig unbemerkt ab.
    const stern = landing.starPass?.starGained ? landing.starPass : null;
    // A star buy or a gamble win is worth a celebration; a trap or a lost bet
    // gets the sad slump. Everything else keeps the soft landing.
    const good = Boolean(stern) || effect.gamble === "win" || (effect.coins || 0) >= 6;
    const bad = effect.gamble === "loss" || (effect.coins || 0) < 0;
    let reactionType = "land";
    if (landing.fieldType === "challenge" || good) reactionType = "cheer";
    else if (bad) reactionType = "stumble";
    if (token) token.userData.reaction = { type: reactionType, startedAt: performance.now() };
    this.createLandingBurst(landing.to, landing.fieldType, Boolean(landing.gateEffects?.some((gate) => gate.coins > 0)));
    this.celebrateFieldEffect(landing, effect, stern);
  }

  // Pop-up text and confetti tuned to what actually happened, so the board
  // reads at a glance instead of only through the message bar.
  celebrateFieldEffect(landing, effect, stern = null) {
    const spot = this.fieldPositions[landing.to];
    if (!spot || !this.floaters) return;
    const at = new THREE.Vector3(spot.x, spot.y + 0.75, spot.z);

    if (stern) {
      this.floaters.pop(at, "⭐ STERN!", { color: "#ffe36b", size: 0.5, life: 1.5, rise: 1.2 });
      this.bursts?.spawn(at, ["#ffe36b", "#ffb400", "#ffffff"], { count: 30, speed: 2.6, up: 3, size: 0.09, life: 1.1, drag: 1.1 });
      this.bursts?.ring(new THREE.Vector3(spot.x, spot.y + 0.12, spot.z), "#ffe36b", { radius: 2.4, life: 0.8, opacity: 0.7, y: spot.y + 0.12 });
      return;
    }
    // Knapp vorbei zählt auch — und zwar in BEIDEN Fällen: wer auf dem Podest
    // landet und nicht zahlen kann, und wer im Vorbeigehen nicht genug hat.
    // Der zweite Fall steht wieder in starPass und wurde hier nie gelesen.
    if ((effect.type === "star" && effect.starAffordable === false)
      || landing.starPass?.affordable === false) {
      const preis = landing.starPass?.price ?? effect.starPrice;
      this.floaters.pop(at, preis ? `Zu teuer — ${preis}` : "Zu teuer!", { color: "#ff9aa8", size: 0.34, life: 1.2 });
      return;
    }
    if (effect.item) {
      this.floaters.pop(at, "ITEM!", { color: "#7bd0ff", size: 0.4, life: 1.2, rise: 1 });
      this.bursts?.spawn(at, ["#7bd0ff", "#ffffff"], { count: 14, speed: 1.8, up: 2, size: 0.07, life: 0.8, drag: 1.5 });
      return;
    }
    if (effect.gamble === "win") {
      this.floaters.pop(at, `+${effect.coins}`, { color: "#ffe36b", size: 0.46, life: 1.2, rise: 1 });
      this.bursts?.spawn(at, ["#ffd45c", "#ffffff", "#b98cff"], { count: 22, speed: 2.2, up: 2.6, size: 0.08, life: 0.9, drag: 1.3 });
      return;
    }
    if (effect.gamble === "loss") {
      this.floaters.pop(at, `${effect.coins}`, { color: "#b98cff", size: 0.38, life: 1 });
      return;
    }
    if (effect.blocked) {
      this.floaters.pop(at, "🛡️ GEBLOCKT", { color: "#7bd0ff", size: 0.38, life: 1.2 });
      return;
    }
    if ((effect.coins || 0) < 0) {
      this.floaters.pop(at, `${effect.coins}`, { color: "#ff9aa8", size: 0.4, life: 1.1 });
      this.bursts?.ring(new THREE.Vector3(spot.x, spot.y + 0.1, spot.z), "#ff6b7f", { radius: 1.4, life: 0.5, y: spot.y + 0.1 });
      return;
    }
    if ((effect.coins || 0) > 0) {
      this.floaters.pop(at, `+${effect.coins}`, {
        color: effect.coins >= 6 ? "#ffe36b" : "#ffffff",
        size: effect.coins >= 6 ? 0.4 : 0.3,
        life: 0.85,
        rise: 0.8
      });
    }
  }

  prepareMinigame() {
    this.setCameraMode("minigame", { duration: 900, fieldIndex: this.currentFieldIndex });
  }

  returnToBoard() {
    this.setCameraMode("return", { duration: 1250, fieldIndex: this.currentFieldIndex ?? 0 });
  }

  rollDice(value, fieldIndex = this.currentFieldIndex || 0, spinDurationMs = 790) {
    const texture = new THREE.CanvasTexture(drawDiceFace(value));
    texture.colorSpace = THREE.SRGBColorSpace;
    if (this.diceMesh.material.map) this.diceMesh.material.map.dispose();
    this.diceMesh.material.map = texture;
    this.diceMesh.material.needsUpdate = true;
    this.diceSpinUntil = performance.now() + spinDurationMs;
    this.diceHideAt = this.diceSpinUntil + 900;
    this.dicePulse = 1;
    const field = this.fieldPositions[fieldIndex];
    if (field) {
      // Hover well above the tile so the dice never cuts into tokens below.
      this.diceHome.set(field.x, field.y + 1.55, field.z);
      this.diceMesh.position.copy(this.diceHome);
    }
    this.diceMesh.visible = true;
    this.diceMesh.scale.setScalar(1);
  }

  createLights() {
    this.hemisphereLight = new THREE.HemisphereLight(0xdfefff, 0x9fce8a, 2.4);
    this.scene.add(this.hemisphereLight);

    const key = new THREE.DirectionalLight(0xfff4d6, 3.6);
    key.position.set(4.8, 9.5, 5.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    this.scene.add(key);
  }

  setTheme(boardId) {
    this.theme = boardTheme(boardId);
    this.lastBoardId = this.theme.id;
    disposeGroup(this.themeGroup);
    disposeGroup(this.fxGroup);
    this.animatedLandmarks = [];
    this.landingBursts = [];
    this.scene.background.set(this.theme.background);
    this.scene.fog.color.set(this.theme.fog);
    this.particles?.material?.color?.set(this.theme.particle);

    if (this.theme.id === "cloudpantry") {
      this.hemisphereLight.color.set("#fff2dc");
      this.hemisphereLight.groundColor.set("#c48fb2");
      this.createCloudPantryWorld();
    } else if (this.theme.id === "tideworks") {
      this.hemisphereLight.color.set("#e2fcff");
      this.hemisphereLight.groundColor.set("#5fb8c4");
      this.createTideworksWorld();
    } else {
      this.hemisphereLight.color.set("#eaffe2");
      this.hemisphereLight.groundColor.set("#8fce7a");
      this.createMossbackWorld();
    }
    this.setCameraMode("overview", { duration: 2200, fieldIndex: 0 });
  }

  createMossbackWorld() {
    const creature = new THREE.Group();
    const skin = material("#4a8a5c");
    const mantle = material("#7dc45f");
    const belly = material("#cfe8a0");
    const body = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1.3, 5.4), skin);
    body.position.y = -0.1;
    body.castShadow = true;
    body.receiveShadow = true;
    creature.add(body);

    // Grass top ends at exactly y=1.0 — all decoration sits on that surface.
    const back = new THREE.Mesh(new THREE.BoxGeometry(7.1, 0.5, 5), mantle);
    back.position.y = 0.75;
    back.castShadow = true;
    back.receiveShadow = true;
    creature.add(back);

    const head = createCreatureHead(skin, belly);
    head.position.set(-4.45, 0.5, 1.05);
    head.rotation.y = -0.35;
    creature.add(head);

    [[-3.3, 2.9], [3.1, 2.9], [-3.3, -2.9], [3.1, -2.9]].forEach(([x, z]) => {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1.1), skin);
      foot.position.set(x, -0.5, z);
      foot.castShadow = true;
      creature.add(foot);
    });

    const tail = new THREE.Group();
    [[3.95, 0.15, -1.6, 0.55], [4.55, 0.05, -1.85, 0.42], [5.0, 0, -2.0, 0.3]].forEach(([x, y, z, size]) => {
      const segment = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.7, size), skin);
      segment.position.set(x, y, z);
      segment.castShadow = true;
      tail.add(segment);
    });
    creature.add(tail);
    creature.userData = { kind: "creature", baseY: 0, phase: 0, body, back, head };
    this.themeGroup.add(creature);
    this.animatedLandmarks.push(creature);

    const tree = createFantasyTree();
    tree.scale.setScalar(0.72);
    tree.position.set(0.04, 1.0, -0.12);
    tree.userData = { kind: "sway", baseY: tree.position.y, phase: 0.6 };
    this.themeGroup.add(tree);
    this.animatedLandmarks.push(tree);

    [
      [-2.75, 1.0, 0.35, 0], [2.78, 1.0, 0.18, 2], [-1.72, 1.0, -1.8, 4], [1.92, 1.0, 1.72, 7]
    ].forEach(([x, y, z, seed]) => {
      const mushrooms = createMushroomCluster(seed);
      mushrooms.position.set(x, y, z);
      this.themeGroup.add(mushrooms);
    });

    const pond = createPond("#55c9b1", "#b9f06f");
    pond.position.set(2.15, 1.0, -0.1);
    pond.userData = { kind: "water", baseY: pond.position.y, phase: 1.2, material: pond.userData.material };
    this.themeGroup.add(pond);
    this.animatedLandmarks.push(pond);

    this.addWorldResidents([
      { x: -3.7, y: 1.21, z: -0.9, color: "#f2ad65" },
      { x: 3.25, y: 1.21, z: 1.25, color: "#a8e57d" },
      { x: -0.45, y: 1.21, z: 1.72, color: "#ef8790" },
      { x: 2.65, y: 1.21, z: -1.25, color: "#77d6c4" }
    ]);
  }

  createCloudPantryWorld() {
    const islands = [
      [-2.55, 0.34, 0.72, 2.2, 1.55, "#9d7690"],
      [-1.65, 0.46, -1.48, 1.8, 1.35, "#786c9f"],
      [2.45, 0.32, 0.72, 2.15, 1.55, "#bd7080"],
      [1.8, 0.44, -1.52, 1.8, 1.3, "#6679a8"]
    ].map((values, index) => {
      const island = createCloudIsland(...values, index);
      island.userData = { kind: "float", baseY: island.position.y, phase: index * 1.45, amount: 0.045 };
      this.themeGroup.add(island);
      this.animatedLandmarks.push(island);
      return island;
    });

    const vortex = new THREE.Group();
    for (let index = 0; index < 4; index += 1) {
      const size = 0.85 + index * 0.36;
      const ring = new THREE.Mesh(
        new THREE.BoxGeometry(size, 0.03, size),
        new THREE.MeshBasicMaterial({ color: index % 2 ? "#ffd06a" : "#88e7e8", transparent: true, opacity: 0.34 - index * 0.05 })
      );
      ring.rotation.y = index * 0.5;
      ring.position.y = 0.24 + index * 0.03;
      vortex.add(ring);
    }
    vortex.position.set(0, 0.42, 0.02);
    vortex.userData = { kind: "rotor", axis: "y", speed: 0.22, baseY: vortex.position.y, phase: 0 };
    this.themeGroup.add(vortex);
    this.animatedLandmarks.push(vortex);

    const rotor = createSkyRotor();
    rotor.position.set(3.55, 1.05, -2.25);
    rotor.rotation.y = -0.55;
    rotor.userData = { kind: "rotor", axis: "z", speed: 0.62, rotor: rotor.userData.rotor, baseY: rotor.position.y, phase: 0.4 };
    this.themeGroup.add(rotor);
    this.animatedLandmarks.push(rotor);

    [
      { centerX: 0, centerZ: 0, radius: 4.3, phase: 0.2, speed: 0.12, y: 1.75, color: "#f2937d" },
      { centerX: 0.2, centerZ: -0.15, radius: 3.65, phase: 3.5, speed: -0.1, y: 2.05, color: "#6cd7d5" }
    ].forEach((config, index) => {
      const ship = createAirship(config.color, index);
      ship.userData = { kind: "orbit", ...config, baseY: config.y };
      this.themeGroup.add(ship);
      this.animatedLandmarks.push(ship);
    });

    [[-4.15, 0.4, -2.35, 0], [4.2, 0.25, 2.1, 2], [0.35, 0.1, -3.35, 5]].forEach(([x, y, z, seed]) => {
      const rock = createCometRock(seed);
      rock.position.set(x, y, z);
      rock.userData = { kind: "float", baseY: y, phase: seed, amount: 0.07 };
      this.themeGroup.add(rock);
      this.animatedLandmarks.push(rock);
    });

    this.addWorldResidents([
      { x: -2.9, y: 0.72, z: 0.55, color: "#f49b82" },
      { x: 2.8, y: 0.7, z: 0.45, color: "#77d8d8" },
      { x: -1.55, y: 0.84, z: -1.42, color: "#ffd36e" },
      { x: 1.75, y: 0.82, z: -1.45, color: "#ad98e8" }
    ]);
  }

  createTideworksWorld() {
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(9.6, 0.24, 9.6),
      new THREE.MeshLambertMaterial({ color: "#2a9cb8", transparent: true, opacity: 0.88 })
    );
    water.position.y = -0.4;
    water.rotation.y = Math.PI / 4;
    water.userData = { kind: "water", baseY: water.position.y, phase: 0, material: water.material };
    this.themeGroup.add(water);
    this.animatedLandmarks.push(water);

    [
      [-2.55, 0, 1.3, 2.45, 1.8, "#265c61"],
      [2.5, 0, 1.15, 2.3, 1.75, "#255a68"],
      [-1.95, 0.08, -1.45, 2.2, 1.55, "#245663"],
      [1.75, 0.1, -1.52, 2.05, 1.48, "#315965"]
    ].forEach((values, index) => {
      const plate = createReefPlate(...values, index);
      this.themeGroup.add(plate);
    });

    const tideWheel = createTideWheel();
    tideWheel.position.set(0.05, 0.25, -0.62);
    tideWheel.rotation.y = -0.2;
    tideWheel.userData = { kind: "tidewheel", wheel: tideWheel.userData.wheel, baseY: tideWheel.position.y, phase: 0 };
    this.themeGroup.add(tideWheel);
    this.animatedLandmarks.push(tideWheel);

    const lighthouse = createLighthouse();
    lighthouse.position.set(-3.92, 0.18, -1.62);
    lighthouse.userData = { kind: "beacon", beam: lighthouse.userData.beam, baseY: lighthouse.position.y, phase: 0 };
    this.themeGroup.add(lighthouse);
    this.animatedLandmarks.push(lighthouse);

    [
      [-2.9, 0.62, 0.1, "#ff8878", 0], [2.9, 0.58, 0.12, "#ffd36a", 3],
      [-1.15, 0.72, -1.75, "#a98ae8", 5], [2.25, 0.65, 1.72, "#68e0cb", 8]
    ].forEach(([x, y, z, color, seed]) => {
      const coral = createCoralCluster(color, seed);
      coral.position.set(x, y, z);
      coral.userData = { kind: "sway", baseY: y, phase: seed * 0.5, amount: 0.018 };
      this.themeGroup.add(coral);
      this.animatedLandmarks.push(coral);
    });

    for (let index = 0; index < 3; index += 1) {
      const size = 0.5 + index * 0.1;
      const dome = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * 0.7, size),
        new THREE.MeshLambertMaterial({ color: "#8ff4ef", transparent: true, opacity: 0.32 })
      );
      dome.position.set(-0.9 + index * 0.95, 0.55, 1.55 - index * 0.14);
      dome.rotation.y = index * 0.4;
      this.themeGroup.add(dome);
    }

    this.addWorldResidents([
      { x: -2.55, y: 0.42, z: 1.15, color: "#65d9d0" },
      { x: 2.58, y: 0.42, z: 0.92, color: "#f3c85d" },
      { x: -1.65, y: 0.44, z: -1.38, color: "#f08082" },
      { x: 1.45, y: 0.45, z: -1.48, color: "#d7f4ed" }
    ]);
  }

  addWorldResidents(residents) {
    residents.forEach((config, index) => {
      const resident = createWorldBlob(config.color, index);
      resident.position.set(config.x, config.y, config.z);
      resident.userData = {
        kind: "wander",
        baseX: config.x,
        baseY: config.y,
        baseZ: config.z,
        phase: index * 2.1 + this.theme.cameraYaw,
        radius: 0.12 + index * 0.035
      };
      this.themeGroup.add(resident);
      this.animatedLandmarks.push(resident);
    });
  }

  setCameraMode(mode, { duration = 0, fieldIndex = this.cameraFieldIndex } = {}) {
    this.cameraMode = mode;
    this.cameraModeStartedAt = performance.now();
    this.cameraModeUntil = duration ? this.cameraModeStartedAt + duration : 0;
    if (Number.isInteger(fieldIndex)) this.cameraFieldIndex = fieldIndex;
  }

  cameraPose(now) {
    const portrait = this.viewportRatio < 0.78;
    const cameraConfig = this.theme.camera || {};
    const field = this.fieldPositions[this.cameraFieldIndex] || new THREE.Vector3(0, 0.4, 0);
    const token = this.state?.currentPlayerId ? this.tokens.get(this.state.currentPlayerId) : null;
    const rawFocus = this.cameraMode === "follow" && token ? token.position : field;
    const focus = rawFocus.clone();
    if ((this.cameraMode === "turn" || this.cameraMode === "follow") && portrait) {
      focus.lerp(new THREE.Vector3(0, focus.y, 0), 0.3);
    }
    const pose = {
      position: new THREE.Vector3(),
      target: new THREE.Vector3(focus.x, focus.y - (portrait ? 0.72 : 0.02), focus.z),
      fov: portrait ? 53 : 39
    };

    // Übersicht, Rückkehr UND der Wartezustand zeigen jetzt dasselbe: das ganze
    // Brett.
    //
    // Der Wartezustand hing vorher an derselben Nahaufnahme wie die Verfolgung.
    // Genau dann schaut man aber auf das Brett, um zu entscheiden — und sah
    // gemessen 13 von 36 Feldern, mit der eigenen Figur am linken Bildrand.
    // Nah dran gehört die Kamera beim Würfeln, beim Laufen und beim Landen;
    // dort bleibt sie es auch.
    if (this.cameraMode === "overview" || this.cameraMode === "return" || this.cameraMode === "turn") {
      pose.position.fromArray(portrait ? cameraConfig.overviewPortrait : cameraConfig.overviewLandscape);
      pose.target.fromArray(cameraConfig.target || [0, 0.5, 0]);
      pose.fov = portrait ? cameraConfig.overviewFovPortrait : cameraConfig.overviewFovLandscape;
      if (portrait) {
        // Flacher schauen. Die Bretter sind breit und flach; aus 67° von oben
        // wird auf einem hochkanten Handy ein schmales Band in der Bildmitte,
        // mit Himmel darüber und darunter. Die BREITE ist der Engpass, die Höhe
        // steht ungenutzt herum — ein flacherer Winkel dreht die Tiefe des
        // Bretts in genau diese Höhe hinein. Nebenbei sieht man den Feldern
        // wieder die Seiten an statt einer Landkarte von oben.
        const richtung = pose.position.clone().sub(pose.target);
        const waagerecht = Math.hypot(richtung.x, richtung.z) || 1;
        richtung.y = waagerecht * Math.tan(THREE.MathUtils.degToRad(BOARD_TILT_PORTRAIT));
        pose.position.copy(pose.target).add(richtung);
      }
      // Rückt Kamera und Ziel so, dass alle Felder im freien Streifen liegen.
      this.fitBoard(pose, { portrait });
    } else if (this.cameraMode === "dice") {
      pose.target.copy(this.diceMesh.position).add(new THREE.Vector3(0, -0.08, 0));
      pose.position.copy(pose.target).add(portrait ? new THREE.Vector3(0.3, 4.6, 3.7) : new THREE.Vector3(2.5, 3.1, 3.7));
      pose.fov = portrait ? 48 : 36;
    } else if (this.cameraMode === "junction") {
      // An der Kreuzung muss man BEIDE Wege sehen können, sonst ist die Wahl
      // blind. Deshalb deutlich weiter weg und weiter im Blickwinkel als bei
      // einer Landung — dort geht es um ein Feld, hier um eine Gabelung.
      pose.position.copy(pose.target).add(portrait
        ? new THREE.Vector3(0.1, 8.4, 6.6)
        : new THREE.Vector3(1.4, 7.4, 6.2));
      pose.fov = portrait ? 56 : 42;
    } else if (this.cameraMode === "landing" || this.cameraMode === "event") {
      const distance = this.cameraMode === "event" ? 4.5 : 3.8;
      pose.position.copy(pose.target).add(portrait ? new THREE.Vector3(0.18, distance + 0.7, distance) : new THREE.Vector3(2.2, distance - 0.5, distance));
      pose.fov = portrait ? 48 : 35;
    } else if (this.cameraMode === "minigame") {
      pose.position.copy(pose.target).add(new THREE.Vector3(0, 2.2, 2.1));
      pose.fov = 63;
    } else {
      const offset = portrait ? cameraConfig.followPortrait : cameraConfig.followLandscape;
      pose.position.copy(pose.target).add(new THREE.Vector3(...offset));
      pose.fov = portrait ? 53 : 38;
    }

    pose.position.x += Math.sin(now / 4200 + this.theme.cameraYaw) * 0.06;
    return pose;
  }

  createLandingBurst(fieldIndex, fieldType, bonusGained) {
    const origin = this.fieldPositions[fieldIndex];
    if (!origin) return;
    const color = bonusGained ? "#ffe36b" : (FIELD_COLORS[fieldType] || this.theme.edge);
    const burst = new THREE.Group();
    const pieces = [];
    for (let index = 0; index < 12; index += 1) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.07 + (index % 3) * 0.02, 0.07 + (index % 3) * 0.02, 0.07),
        new THREE.MeshBasicMaterial({ color, transparent: true })
      );
      const angle = index / 12 * Math.PI * 2;
      mesh.position.set(origin.x, origin.y + 0.5, origin.z);
      burst.add(mesh);
      pieces.push({ mesh, velocity: new THREE.Vector3(Math.cos(angle) * 0.85, 0.75 + (index % 4) * 0.12, Math.sin(angle) * 0.85) });
    }
    burst.userData = { startedAt: performance.now(), pieces };
    this.fxGroup.add(burst);
    this.landingBursts.push(burst);
  }

  createParticles() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    for (let index = 0; index < 90; index += 1) {
      const angle = seededNoise(index * 2.7) * Math.PI * 2;
      const radius = 4.6 + seededNoise(index * 5.1 + 2) * 4.2;
      positions.push(
        Math.cos(angle) * radius,
        0.35 + seededNoise(index * 7.3 + 4) * 4.4,
        Math.sin(angle) * radius
      );
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.particles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: "#cfff9a", size: 0.05, transparent: true, opacity: 0.52 })
    );
    this.scene.add(this.particles);
  }

  createDice() {
    const texture = new THREE.CanvasTexture(drawDiceFace(1));
    texture.colorSpace = THREE.SRGBColorSpace;
    this.diceMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.54, 0.54, 2, 2, 2),
      new THREE.MeshStandardMaterial({ color: "#ffffff", map: texture, roughness: 0.34, metalness: 0.03 })
    );
    this.diceMesh.position.copy(this.diceHome);
    this.diceMesh.rotation.set(0.42, 0.66, 0.18);
    this.diceMesh.castShadow = true;
    this.world.add(this.diceMesh);
  }

  createBoard(board) {
    disposeGroup(this.boardGroup);
    this.fieldMeshes = [];
    const fieldTypes = board.fieldTypes || [];
    // Ringgrösse getrennt von der Feldzahl: hinter dem Ring liegen die Felder
    // der Abkürzungen, und die dürfen den Umbruch am Ringende nicht verwirren.
    const ringSize = board.ringSize || fieldTypes.length;
    this.fieldPositions = createThemeLayout(this.theme.id, fieldTypes.length, board.branches || [])
      .map((point) => new THREE.Vector3(point.x, point.y, point.z));

    (board.routes || []).forEach((routes, index) => {
      routes.forEach((nextIndex, routeIndex) => {
        const from = this.fieldPositions[index];
        const to = this.fieldPositions[nextIndex];
        if (!from || !to) return;
        const connector = createConnector(from, to, {
          // Der zweite Ausgang einer Kreuzung IST die Abkürzung — und alles,
          // was aus einem Abkürzungsfeld herausführt, gehört auch dazu.
          shortcut: routeIndex > 0 || index >= ringSize,
          theme: this.theme,
          wrap: index === ringSize - 1 && nextIndex === 0
        });
        this.boardGroup.add(connector);

        // A small chevron on every connector shows the direction of travel,
        // so the loop's flow is obvious at a glance.
        const arrow = createPathArrow();
        arrow.position.set(
          (from.x + to.x) / 2,
          (from.y + to.y) / 2 + 0.12,
          (from.z + to.z) / 2
        );
        arrow.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
        this.boardGroup.add(arrow);
      });
    });

    // A golden START arch over field 0 anchors the whole loop.
    const startPos = this.fieldPositions[0];
    const nextPos = this.fieldPositions[1] || startPos;
    if (startPos) {
      const arch = createStartArch();
      arch.position.set(startPos.x, startPos.y + 0.28, startPos.z);
      arch.rotation.y = Math.atan2(nextPos.x - startPos.x, nextPos.z - startPos.z);
      this.boardGroup.add(arch);
    }

    fieldTypes.forEach((type, index) => {
      const position = this.fieldPositions[index];
      const style = fieldStyle(type, index, this.theme);
      const tileMaterial = new THREE.MeshLambertMaterial({
        color: style.color,
        emissive: style.color,
        emissiveIntensity: 0.035
      });

      const base = createFieldBase(this.theme, style, index);
      base.position.set(position.x, position.y + style.baseHeight / 2, position.z);
      this.boardGroup.add(base);

      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(style.size, style.height, style.size),
        tileMaterial
      );
      tile.position.copy(position);
      tile.position.y = position.y + style.baseHeight + style.height / 2;
      tile.userData = {
        baseY: tile.position.y,
        topY: tile.position.y + style.height / 2,
        special: style.special,
        index
      };
      tile.castShadow = true;
      tile.receiveShadow = true;
      this.boardGroup.add(tile);
      this.fieldMeshes[index] = tile;

      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(style.size * 0.86, 0.02, style.size * 0.86),
        new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.22 })
      );
      cap.position.y = style.height / 2 + 0.011;
      tile.add(cap);

      const rimMaterial = new THREE.MeshLambertMaterial({
        color: this.theme.fieldRim,
        emissive: this.theme.fieldRim,
        emissiveIntensity: style.special ? 0.28 : 0.06
      });
      const rimSize = style.size * 1.04;
      const rimBar = 0.045;
      [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dz]) => {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(dx === 0 ? rimSize : rimBar, style.special ? 0.05 : 0.035, dx === 0 ? rimBar : rimSize),
          rimMaterial
        );
        bar.position.set(dx * (rimSize / 2 - rimBar / 2), style.height / 2 + 0.012, dz * (rimSize / 2 - rimBar / 2));
        tile.add(bar);
      });

      const icon = createFieldIcon(type, style.special);
      icon.position.y = style.height / 2 + 0.041;
      icon.rotation.x = -Math.PI / 2;
      tile.add(icon);

      if (type === "gate") {
        const gate = createGateMarker(this.theme);
        gate.position.y = style.height / 2 + 0.05;
        tile.add(gate);
      }
    });
  }

  syncPlayers(state) {
    const liveIds = new Set(state.players.map((player) => player.id));
    const avatarIndexes = new Map(state.players.map((player, index) => [player.id, index]));
    for (const [id, token] of this.tokens.entries()) {
      if (!liveIds.has(id)) {
        this.tokenGroup.remove(token);
        disposeObject(token);
        this.tokens.delete(id);
      }
    }

    const grouped = new Map();
    state.players.forEach((player) => {
      const list = grouped.get(player.position) || [];
      list.push(player);
      grouped.set(player.position, list);
    });

    grouped.forEach((playersOnField, position) => {
      playersOnField.forEach((player, index) => {
        let token = this.tokens.get(player.id);
        if (!token) {
          token = createToken(player.color, avatarIndexes.get(player.id) || 0);
          this.tokens.set(player.id, token);
          this.tokenGroup.add(token);
        }
        token.userData.accentMaterials.forEach((material) => material.color.set(player.color));
        if (this.animatingPlayers.has(player.id)) return;
        // Bei Gedränge deutlich kleiner. Die Kachel ist nur 0.5 Einheiten breit;
        // mit 0.5 Massstab und ±0.13 Versatz standen vier Figuren praktisch
        // aufeinander — auf dem Startfeld, wo IMMER alle vier stehen, war das
        // das Erste, was man vom Brett sah.
        const crowd = playersOnField.length;
        const scale = crowd >= 3 ? 0.38 : (crowd === 2 ? 0.52 : 0.84);
        token.scale.setScalar(scale);
        token.position.copy(this.tokenPosition(position, index, playersOnField.length, scale));
        token.userData.restY = token.position.y;
        token.userData.homeX = token.position.x;
        token.userData.homeZ = token.position.z;
      });
    });
  }

  highlightCurrent(state) {
    const current = state.players.find((player) => player.id === state.currentPlayerId);
    this.currentFieldIndex = current?.position ?? null;
    this.fieldMeshes.forEach((mesh) => {
      mesh.scale.set(1, 1, 1);
      mesh.position.y = mesh.userData.baseY;
      mesh.material.emissiveIntensity = 0.035;
    });

    if (!current) {
      this.cameraFieldIndex = 0;
      return;
    }
    const tile = this.fieldMeshes[current.position];
    const fieldPosition = this.fieldPositions[current.position];
    if (tile) {
      // Only widen in XZ so the walking surface stays flush with the tokens.
      tile.scale.set(1.1, 1, 1.1);
      tile.material.emissiveIntensity = 0.5;
    }
    if (fieldPosition) {
      this.cameraFocus.copy(fieldPosition);
      if (this.cameraMode === "turn" || this.cameraMode === "overview") this.cameraFieldIndex = current.position;
    }
  }

  tokenPosition(fieldIndex, offsetIndex = 0, total = 1, scale = 0.84) {
    const base = this.fieldPositions[fieldIndex] || new THREE.Vector3();
    // Der Versatz richtet sich nach der ECHTEN Kachelbreite statt nach festen
    // Zahlen — sonst passt er nicht mehr, sobald ein Brett andere Kacheln
    // bekommt, und niemand denkt daran, hier nachzuziehen.
    const tileSize = this.fieldMeshes[fieldIndex]?.geometry?.parameters?.width || 0.5;
    const spread = tileSize * 0.3;
    // 2x2-Raster, damit jede (verkleinerte) Figur ganz auf der Kachel steht.
    const offsets = total <= 1
      ? [[0, 0]]
      : total === 2
        ? [[-spread, 0], [spread, 0]]
        : [[-spread, -spread], [spread, -spread], [-spread, spread], [spread, spread]];
    const [dx, dz] = offsets[Math.min(offsetIndex, offsets.length - 1)];
    const tileTop = this.fieldMeshes[fieldIndex]?.userData.topY || 0.34;
    return new THREE.Vector3(
      base.x + dx,
      tileTop + scale * 0.32,
      base.z + dz
    );
  }

  updateAnimations(now) {
    for (const [playerId, animation] of this.animations.entries()) {
      const token = this.tokens.get(playerId);
      if (!token) continue;
      const elapsed = now - animation.startedAt;
      if (elapsed < 0) continue;
      const segment = Math.min(animation.route.length - 2, Math.floor(elapsed / animation.duration));
      const segmentTime = (elapsed - segment * animation.duration) / animation.duration;
      const done = elapsed >= animation.duration * (animation.route.length - 1);

      if (done) {
        this.animations.delete(playerId);
        this.animatingPlayers.delete(playerId);
        if (this.state) this.syncPlayers(this.state);
        continue;
      }

      if (segment !== animation.lastSegment) {
        animation.lastSegment = segment;
        this.cameraFieldIndex = animation.route[Math.min(segment + 1, animation.route.length - 1)];
        if (now >= this.diceSpinUntil - 260) this.setCameraMode("follow", { fieldIndex: this.cameraFieldIndex });
        this.feedback?.sound("step");
        this.feedback?.vibrate(5);
      }

      const from = this.fieldPositions[animation.route[segment]];
      const to = this.fieldPositions[animation.route[segment + 1]];
      const t = easeInOut(clamp01(segmentTime));
      token.position.lerpVectors(from, to, t);
      const fromTop = this.fieldMeshes[animation.route[segment]]?.userData.topY || 0.34;
      const toTop = this.fieldMeshes[animation.route[segment + 1]]?.userData.topY || 0.34;
      // Leap higher over fields where someone is standing so the mover
      // vaults past bystanders instead of clipping through them.
      let arc = 0.3;
      for (const [otherId, other] of this.tokens.entries()) {
        if (otherId === playerId || this.animatingPlayers.has(otherId)) continue;
        const hx = other.userData.homeX ?? other.position.x;
        const hz = other.userData.homeZ ?? other.position.z;
        if (Math.hypot(to.x - hx, to.z - hz) < 0.45 || Math.hypot(from.x - hx, from.z - hz) < 0.45) {
          arc = 0.62;
          break;
        }
      }
      token.position.y = THREE.MathUtils.lerp(fromTop, toTop, t) + 0.27 + Math.sin(t * Math.PI) * arc;
      token.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
      token.userData.stepPhase = t * Math.PI * 2;
    }
  }

  // Wieviel der Leinwand ist überhaupt frei? Oben liegt die Kopfzeile darüber,
  // unten die Würfelleiste — auf einem hochkanten Handy zusammen fast 40 % der
  // Höhe. Das Brett in die MITTE der Leinwand zu legen heisst deshalb, es zur
  // Hälfte unter die Leiste zu schieben. Gemessen wird am echten Layout, damit
  // die Zahl auch nach der nächsten Änderung an der Leiste noch stimmt.
  freieBahn(portrait = true) {
    const rect = this.container.getBoundingClientRect?.();
    if (!rect?.height) return { oben: 0, unten: 0 };
    const screen = this.container.closest?.(".board-screen");
    const hud = screen?.querySelector(".game-hud")?.getBoundingClientRect();
    const leiste = screen?.querySelector(".board-bottom")?.getBoundingClientRect();
    const oben = hud ? Math.max(0, (hud.bottom - rect.top) / rect.height) : 0;
    const unten = leiste ? Math.max(0, (rect.bottom - leiste.top) / rect.height) : 0;
    // Im Querformat stapelt sich dieselbe Leiste auf einer knapp halb so hohen
    // Fläche und belegt rund die Hälfte davon. Das Brett vollständig darüber zu
    // quetschen macht es zur Briefmarke, es ganz darunter durchlaufen zu lassen
    // versteckt es. Ein Drittel ist der Kompromiss: gross genug zum Lesen, und
    // nur der untere Rand liegt hinter der Leiste. Ein Handy im Querformat ist
    // für diesen Aufbau schlicht zu flach — hochkant ist die gedachte Haltung.
    return {
      oben: Math.min(0.4, oben),
      unten: Math.min(portrait ? 0.45 : 0.3, unten)
    };
  }

  // Schiebt die Kamera so weit zurück und kippt das Ziel so weit, dass ALLE
  // Felder in dem Streifen liegen, der nicht von Kopfzeile und Würfelleiste
  // verdeckt ist.
  //
  // Von Hand war das nicht zu treffen: gemessen lagen im Wartemodus 23 von 36
  // Feldern ausserhalb des Bildes, und die eigene Figur klebte am linken Rand.
  // Die Zahlen dafür standen als geratene Kameraabstände in drei Brettthemen —
  // beim nächsten Layoutwechsel wären sie wieder falsch gewesen. Also gerechnet,
  // genau wie bei fitKinsInView für die Minispiele.
  fitBoard(pose, { rand = 0.94, pad = 0.5, portrait = true } = {}) {
    const punkte = this.fieldPositions;
    if (!punkte?.length) return;
    const blick = pose.target.clone().sub(pose.position).normalize();
    if (!Number.isFinite(blick.x)) return;
    const rechts = new THREE.Vector3().crossVectors(blick, this.camera.up).normalize();
    const oben = new THREE.Vector3().crossVectors(rechts, blick).normalize();
    const bahn = this.freieBahn(portrait);

    // Sichtbarer Streifen in Bildkoordinaten (-1 unten, +1 oben).
    const untenNdc = -1 + bahn.unten * 2;
    const obenNdc = 1 - bahn.oben * 2;
    const mitteNdc = (obenNdc + untenNdc) / 2;
    const halbNdc = Math.max(0.2, (obenNdc - untenNdc) / 2) * rand;

    const halbV = Math.tan(THREE.MathUtils.degToRad(pose.fov) / 2);
    const halbH = halbV * this.camera.aspect * rand;

    // Erst zurückgehen, bis alles hineinpasst. Entlang der Blickachse bleibt der
    // seitliche Abstand jedes Punktes gleich, nur die Tiefe wächst — damit folgt
    // die nötige Tiefe direkt aus |quer| ≤ Tiefe · tan(halbes Sichtfeld).
    let schub = 0;
    punkte.forEach((punkt) => {
      const relativ = punkt.clone().sub(pose.position);
      const tiefe = relativ.dot(blick);
      const quer = relativ.clone().sub(blick.clone().multiplyScalar(tiefe));
      // Ein Feld ist kein Punkt: es ist eine Kachel, auf der bis zu vier Figuren
      // nebeneinander stehen, und am Start steht ausserdem ein Torbogen. Ohne
      // diesen Zuschlag passt die Rechnung und das Bild trotzdem nicht — am
      // linken Rand war die eigene Figur angeschnitten, obwohl "alle Felder im
      // Bild" gemeldet wurde.
      const x = Math.abs(quer.dot(rechts)) + pad;
      const y = Math.abs(quer.dot(oben)) + pad;
      schub = Math.max(schub, x / halbH - tiefe, y / (halbV * halbNdc) - tiefe);
    });
    if (schub > 0) pose.position.addScaledVector(blick, -schub);

    // Dann das Ziel so weit senken, dass die Brettmitte in der MITTE des freien
    // Streifens landet statt in der Mitte der Leinwand.
    const mitte = new THREE.Vector3();
    punkte.forEach((punkt) => mitte.add(punkt));
    mitte.multiplyScalar(1 / punkte.length);
    const relativ = mitte.clone().sub(pose.position);
    const tiefe = Math.max(0.1, relativ.dot(blick));
    pose.target.copy(pose.position).addScaledVector(blick, tiefe);
    pose.target.addScaledVector(oben, -(mitteNdc * halbV * tiefe));
  }

  resize() {
    const width = Math.max(320, this.container.clientWidth || window.innerWidth);
    const height = Math.max(300, this.container.clientHeight || window.innerHeight);
    this.viewportRatio = width / height;
    this.world.scale.set(1, 1, 1);
    this.world.position.set(0, 0, 0);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  loop = () => {
    if (!this.active) {
      requestAnimationFrame(this.loop);
      return;
    }
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    this.updateAnimations(now);

    if (now < this.diceSpinUntil) {
      // Drehung je SEKUNDE, nicht je Bild: der Würfel drehte sich auf einem
      // 120-Hz-Schirm doppelt so schnell wie auf einem 60-Hz-Schirm.
      this.diceMesh.rotation.x += 8.7 * dt;
      this.diceMesh.rotation.y += 11.4 * dt;
      this.diceMesh.position.y = this.diceHome.y + Math.sin(now / 52) * 0.13;
    } else if (now < this.diceHideAt) {
      this.diceMesh.position.y += (this.diceHome.y - this.diceMesh.position.y) * frameLerp(0.12, dt);
      this.diceMesh.rotation.y += 0.18 * dt;
    } else if (this.diceMesh.visible) {
      // Float up and shrink away so tokens never walk through a resting dice.
      this.diceMesh.position.y += dt * 1.6;
      this.diceMesh.scale.multiplyScalar(Math.pow(0.02, dt));
      if (this.diceMesh.scale.x < 0.03) this.diceMesh.visible = false;
    }

    this.dicePulse *= frameDecay(0.91, dt);
    this.animatedLandmarks.forEach((landmark) => {
      const data = landmark.userData;
      if (data.kind === "creature") {
        const breath = Math.sin(now / 920 + data.phase);
        landmark.position.y = data.baseY + breath * 0.025;
        data.body.scale.y = 1 + breath * 0.02;
        data.back.scale.y = 1 + breath * 0.03;
        const blink = Math.sin(now / 760) > 0.986 ? 0.12 : 1;
        data.head.userData.eyes?.forEach((eye) => { eye.scale.y = blink; });
      } else if (data.kind === "sway") {
        landmark.rotation.z = Math.sin(now / 1250 + data.phase) * (data.amount || 0.025);
      } else if (data.kind === "water") {
        landmark.position.y = data.baseY + Math.sin(now / 1100 + data.phase) * 0.018;
        landmark.rotation.y += dt * 0.035;
        if (data.material) {
          data.baseOpacity ??= data.material.opacity;
          data.material.opacity = data.baseOpacity + Math.sin(now / 850 + data.phase) * 0.035;
        }
      } else if (data.kind === "float") {
        landmark.position.y = data.baseY + Math.sin(now / 720 + data.phase) * (data.amount || 0.045);
        landmark.rotation.z = Math.sin(now / 1350 + data.phase) * 0.012;
      } else if (data.kind === "rotor") {
        const rotor = data.rotor || landmark;
        const axis = data.axis || "y";
        rotor.rotation[axis] += dt * (data.speed || 0.4);
      } else if (data.kind === "orbit") {
        const angle = now / 1000 * data.speed + data.phase;
        landmark.position.set(
          data.centerX + Math.cos(angle) * data.radius,
          data.baseY + Math.sin(now / 680 + data.phase) * 0.08,
          data.centerZ + Math.sin(angle) * data.radius
        );
        landmark.rotation.y = -angle + (data.speed < 0 ? Math.PI : 0);
        landmark.rotation.z = Math.sin(now / 540 + data.phase) * 0.045;
      } else if (data.kind === "tidewheel") {
        data.wheel.rotation.z += dt * 0.46;
      } else if (data.kind === "breathe") {
        landmark.position.y = data.baseY + Math.sin(now / 900 + data.phase) * 0.035;
        landmark.rotation.z = Math.sin(now / 1500) * 0.018;
      } else if (data.kind === "drift") {
        landmark.position.y = data.baseY + Math.sin(now / 700 + data.phase) * 0.055;
        landmark.position.x = (data.baseX || 0) + Math.sin(now / 1300 + data.phase) * 0.045;
      } else if (data.kind === "stir") {
        landmark.rotation.y = Math.sin(now / 740) * 0.18;
        landmark.position.y = data.baseY + Math.sin(now / 520) * 0.025;
      } else if (data.kind === "gear") {
        landmark.rotation.y += dt * 0.045;
      } else if (data.kind === "turbine") {
        landmark.rotation.y -= dt * 0.58;
      } else if (data.kind === "beacon") {
        if (data.beam) data.beam.rotation.y += dt * 0.34;
        else landmark.rotation.y += dt * 0.22;
      } else if (data.kind === "wander") {
        const stride = now / 1100 + data.phase;
        landmark.position.x = data.baseX + Math.sin(stride) * data.radius;
        landmark.position.z = data.baseZ + Math.cos(stride * 0.82) * data.radius;
        landmark.position.y = data.baseY + Math.abs(Math.sin(now / 360 + data.phase)) * 0.055;
        landmark.rotation.y = Math.atan2(Math.cos(stride), -Math.sin(stride * 0.82));
      }
    });

    this.tokens.forEach((token, playerId) => {
      const data = token.userData;
      const moving = this.animatingPlayers.has(playerId);
      const blink = Math.sin(now / 820 + data.phase * 2.4) > 0.985 ? 0.12 : 1;
      data.eyes?.forEach((eye) => { eye.scale.y = blink; });
      if (moving) {
        const stride = Math.sin(data.stepPhase || 0);
        data.feet?.forEach((foot, index) => { foot.rotation.x = stride * (index === 0 ? 0.65 : -0.65); });
        // Arms swing opposite to the feet — a proper little march.
        data.arms?.forEach((arm, index) => {
          arm.rotation.x = stride * (index === 0 ? -0.8 : 0.8);
          arm.rotation.z = arm.userData.baseRotZ;
        });
        data.body.scale.set(1 - Math.abs(stride) * 0.04, 1 + Math.abs(stride) * 0.08, 1 - Math.abs(stride) * 0.04);
        return;
      }
      data.feet?.forEach((foot) => { foot.rotation.x *= frameDecay(0.82, dt); });
      data.arms?.forEach((arm) => { arm.rotation.x *= frameDecay(0.82, dt); });

      // Step aside when another kin walks through this field, then settle
      // back home — no more clipping through bystanders.
      const homeX = data.homeX ?? token.position.x;
      const homeZ = data.homeZ ?? token.position.z;
      let dodgeTargetX = 0;
      let dodgeTargetZ = 0;
      this.animatingPlayers.forEach((movingId) => {
        const mover = this.tokens.get(movingId);
        if (!mover) return;
        const dx = homeX - mover.position.x;
        const dz = homeZ - mover.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist >= 0.42) return;
        const push = (0.42 - dist) / 0.42;
        const len = Math.max(0.05, dist);
        dodgeTargetX += (dx / len) * push * 0.3;
        dodgeTargetZ += (dz / len) * push * 0.3;
      });
      data.dodgeX = THREE.MathUtils.lerp(data.dodgeX || 0, dodgeTargetX, frameLerp(0.24, dt));
      data.dodgeZ = THREE.MathUtils.lerp(data.dodgeZ || 0, dodgeTargetZ, frameLerp(0.24, dt));
      token.position.x = homeX + data.dodgeX;
      token.position.z = homeZ + data.dodgeZ;
      const dodging = Math.hypot(data.dodgeX, data.dodgeZ) > 0.03;

      let squashX = 1;
      let squashY = 1;
      let bodyTilt = Math.sin(now / 600 + data.phase) * 0.08;
      let hop = 0;
      if (dodging) {
        // A startled little shuffle while stepping aside.
        squashY -= 0.07;
        squashX += 0.05;
        data.feet?.forEach((foot, index) => { foot.rotation.x = Math.sin(now / 60 + index * Math.PI) * 0.5; });
      }
      const reactionDuration = data.reaction?.type === "cheer" ? 760 : 620;
      const reactionAge = now - (data.reaction?.startedAt || 0);
      if (data.reaction && reactionAge < reactionDuration) {
        const progress = clamp01(reactionAge / reactionDuration);
        const pulse = Math.sin(progress * Math.PI * 2.4) * (1 - progress);
        if (data.reaction.type === "stumble") {
          bodyTilt += pulse * 0.58;
          squashY -= Math.abs(pulse) * 0.15;
        } else if (data.reaction.type === "cheer") {
          // Two happy hops with a squash on take-off/landing — arms up!
          hop = Math.abs(Math.sin(progress * Math.PI * 2)) * (1 - progress) * 0.26;
          squashX += Math.sin(progress * Math.PI * 4) * 0.12 * (1 - progress);
          squashY += hop * 0.5;
          data.arms?.forEach((arm) => {
            arm.rotation.z = THREE.MathUtils.lerp(arm.userData.baseRotZ, arm.userData.side * -2.4, Math.sin(progress * Math.PI));
          });
        } else {
          squashX += Math.abs(pulse) * 0.16;
          squashY -= pulse * 0.18;
        }
      } else if (data.reaction) {
        data.reaction = null;
      }
      const breathe = 1 + Math.sin(now / 520 + data.phase) * 0.018;
      data.body.rotation.z = bodyTilt;
      data.body.scale.set(squashX * breathe, squashY * breathe, squashX * breathe);
      token.position.y = (data.restY ?? token.position.y) + Math.sin(now / 380 + data.phase) * 0.018 + hop;
    });

    // Special fields shimmer softly so gates and challenges stay
    // discoverable without shouting over the current-field highlight.
    this.fieldMeshes.forEach((mesh, index) => {
      if (!mesh?.userData.special || index === this.currentFieldIndex) return;
      mesh.material.emissiveIntensity = 0.05 + Math.abs(Math.sin(now / 640 + index * 1.7)) * 0.12;
    });

    this.landingBursts = this.landingBursts.filter((burst) => {
      const age = (now - burst.userData.startedAt) / 1000;
      burst.userData.pieces.forEach(({ mesh, velocity }) => {
        mesh.position.x += velocity.x * dt;
        mesh.position.y += (velocity.y - age * 1.7) * dt;
        mesh.position.z += velocity.z * dt;
        mesh.rotation.x += dt * 7;
        mesh.material.opacity = Math.max(0, 1 - age / 0.85);
      });
      if (age <= 0.85) return true;
      this.fxGroup.remove(burst);
      disposeObject(burst);
      return false;
    });

    this.particles.rotation.y += 0.021 * dt;

    if (this.cameraModeUntil && now >= this.cameraModeUntil) {
      if (this.cameraMode === "overview") this.setCameraMode("turn", { fieldIndex: this.currentFieldIndex });
      else if (this.cameraMode === "dice" && this.animations.size) this.setCameraMode("follow", { fieldIndex: this.cameraFieldIndex });
      else if (this.cameraMode === "landing" || this.cameraMode === "event" || this.cameraMode === "return") {
        this.setCameraMode("turn", { fieldIndex: this.currentFieldIndex });
      }
    }
    const pose = this.cameraPose(now);
    const damping = 1 - Math.exp(-CAMERA_DAMPING * dt);
    this.camera.position.lerp(pose.position, damping);
    this.cameraTarget.lerp(pose.target, damping);
    this.camera.fov += (pose.fov - this.camera.fov) * damping;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraTarget);
    updateStarBeacon(this.starBeacon, now);
    this.bursts?.update(dt);
    this.floaters?.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  };
}

// The lit star pad's beacon: a big slowly spinning star on a column of light.
// This is the board's single most important read — it is the thing everybody is
// racing toward, so it is deliberately the tallest, brightest object in frame.
function createStarBeacon() {
  const group = new THREE.Group();

  const shape = new THREE.Shape();
  const points = 5;
  const outer = 0.3;
  const inner = 0.13;
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const star = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }),
    new THREE.MeshLambertMaterial({ color: "#ffe36b", emissive: "#ffb400", emissiveIntensity: 0.55 })
  );
  star.castShadow = true;
  group.add(star);

  // Light column so the pad is findable even when the star is off screen.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.26, 1.25, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: "#ffe36b", transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  beam.position.y = -0.62;
  group.add(beam);

  // Ground halo that pulses, so the exact tile is unambiguous.
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.42, 24),
    new THREE.MeshBasicMaterial({ color: "#ffe36b", transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -1.24;
  group.add(halo);

  group.userData = { star, beam, halo };
  group.visible = false;
  return group;
}

function updateStarBeacon(beacon, now) {
  if (!beacon?.visible) return;
  const { star, beam, halo } = beacon.userData;
  star.rotation.y = now / 900;
  star.position.y = Math.sin(now / 620) * 0.07;
  const pulse = 0.5 + Math.sin(now / 420) * 0.5;
  beam.material.opacity = 0.1 + pulse * 0.12;
  halo.material.opacity = 0.32 + pulse * 0.26;
  halo.scale.setScalar(1 + pulse * 0.14);
}

function createConnector(from, to, { shortcut = false, theme, wrap = false }) {
  const group = new THREE.Group();
  const start = from.clone().add(new THREE.Vector3(0, 0.1, 0));
  const end = to.clone().add(new THREE.Vector3(0, 0.1, 0));

  if (shortcut) {
    const stepMaterial = new THREE.MeshLambertMaterial({
      color: theme.edge,
      emissive: theme.edge,
      emissiveIntensity: 0.28,
      transparent: theme.pathStyle === "glass",
      opacity: theme.pathStyle === "glass" ? 0.85 : 1
    });
    for (let index = 1; index <= 6; index += 1) {
      const progress = index / 7;
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.18), stepMaterial);
      step.position.lerpVectors(start, end, progress);
      step.position.y += Math.sin(progress * Math.PI) * (theme.pathStyle === "skyrail" ? 0.5 : 0.34);
      step.rotation.y = index * 0.5;
      step.castShadow = true;
      group.add(step);
    }
    return group;
  }

  const middle = start.clone().lerp(end, 0.5);
  middle.y += wrap ? 0.3 : 0;
  const direction = end.clone().sub(start);
  const length = direction.length();

  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.08, length + 0.1),
    theme.pathStyle === "glass"
      ? new THREE.MeshLambertMaterial({ color: "#80e9e5", transparent: true, opacity: 0.62 })
      : material(theme.path)
  );
  plank.position.copy(middle);
  plank.lookAt(end);
  plank.castShadow = true;
  plank.receiveShadow = true;
  group.add(plank);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.035, length * 0.8),
    new THREE.MeshLambertMaterial({ color: theme.edge, emissive: theme.edge, emissiveIntensity: wrap ? 0.32 : 0.08 })
  );
  trim.position.copy(middle).add(new THREE.Vector3(0, 0.055, 0));
  trim.lookAt(end.clone().add(new THREE.Vector3(0, 0.055, 0)));
  group.add(trim);

  if (wrap) {
    [0.3, 0.7].forEach((t) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), material(theme.fieldBase));
      post.position.lerpVectors(start, end, t);
      post.position.y -= 0.24;
      group.add(post);
    });
  }
  return group;
}

function createGateMarker(theme) {
  const group = new THREE.Group();
  const gateMaterial = new THREE.MeshLambertMaterial({
    color: theme.edge,
    emissive: theme.edge,
    emissiveIntensity: 0.5
  });
  const supportMaterial = material(theme.fieldBase);
  // Wide and tall enough that tokens standing on the tile never touch it.
  [-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.74, 0.1), supportMaterial);
    post.position.set(side * 0.3, 0.37, 0);
    post.castShadow = true;
    group.add(post);
  });
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.09, 0.12), gateMaterial);
  lintel.position.y = 0.78;
  group.add(lintel);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), gateMaterial);
  crest.position.y = 0.92;
  crest.rotation.set(0.6, 0.6, 0);
  group.add(crest);
  return group;
}

function material(color, _roughness = 0.7, _metalness = 0.02) {
  return new THREE.MeshLambertMaterial({ color });
}

function createFieldBase(theme, style, index) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(style.size * 1.08, style.baseHeight, style.size * 1.08),
    material(theme.fieldBase)
  );
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  if (theme.tileStyle === "gear") {
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dz], tooth) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, style.baseHeight * 0.7, 0.09),
        material(theme.fieldRim)
      );
      mesh.position.set(dx * style.size * 0.58, 0, dz * style.size * 0.58);
      mesh.rotation.y = tooth * 0.2;
      group.add(mesh);
    });
  } else if (theme.tileStyle === "stump") {
    for (let bark = 0; bark < 2; bark += 1) {
      const angle = bark * Math.PI + index * 0.61;
      const nub = new THREE.Mesh(new THREE.BoxGeometry(0.07, style.baseHeight * 0.8, 0.07), material(theme.path));
      nub.position.set(Math.cos(angle) * style.size * 0.55, -0.01, Math.sin(angle) * style.size * 0.55);
      group.add(nub);
    }
  } else {
    const light = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.07),
      new THREE.MeshBasicMaterial({ color: theme.edge, transparent: true, opacity: 0.78 })
    );
    light.position.set(Math.cos(index) * style.size * 0.56, -style.baseHeight * 0.3, Math.sin(index) * style.size * 0.56);
    group.add(light);
  }
  return group;
}

function createCreatureHead(skinMaterial, bellyMaterial) {
  const group = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.35), skinMaterial);
  head.castShadow = true;
  group.add(head);

  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.5), bellyMaterial);
  muzzle.position.set(0, -0.22, 0.85);
  group.add(muzzle);

  const dark = new THREE.MeshLambertMaterial({ color: "#14251d" });
  const eyes = [];
  [-1, 1].forEach((side) => {
    const eyeWhite = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.06), material("#f5ffe8"));
    eyeWhite.position.set(side * 0.34, 0.18, 0.69);
    group.add(eyeWhite);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.05), dark);
    eye.position.set(side * 0.34, 0.16, 0.73);
    group.add(eye);
    eyes.push(eye);

    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.42, 0.2), skinMaterial);
    ear.position.set(side * 0.72, 0.62, 0.02);
    ear.rotation.z = side * -0.32;
    group.add(ear);
  });
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.08), dark);
  nose.position.set(0, -0.12, 1.12);
  group.add(nose);

  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.08), material("#b9f06f"));
  leaf.position.set(0.08, 0.72, 0.04);
  leaf.rotation.z = -0.5;
  group.add(leaf);
  group.userData.eyes = eyes;
  return group;
}

function createFantasyTree() {
  const group = new THREE.Group();
  const bark = material("#8a5a35");
  const leafMaterials = [material("#4f9c58"), material("#6fbf62"), material("#95d96f")];
  // Tall trunk lifts the crowns above token head height near the center tiles.
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.42, 2.1, 0.42), bark);
  trunk.position.y = 1.05;
  trunk.castShadow = true;
  group.add(trunk);

  [[0.42, 0.14, 0.1], [-0.4, 0.1, -0.24], [0.12, 0.12, 0.44]].forEach(([x, y, z]) => {
    const root = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.26), bark);
    root.position.set(x, y, z);
    root.castShadow = true;
    group.add(root);
  });

  [[0, 2.36, 0, 1.35], [0, 2.9, 0, 1.02], [0, 3.36, 0, 0.66]].forEach(([x, y, z, size], index) => {
    const crown = new THREE.Mesh(new THREE.BoxGeometry(size, 0.52, size), leafMaterials[index % leafMaterials.length]);
    crown.position.set(x, y, z);
    crown.rotation.y = index * 0.22;
    crown.castShadow = true;
    group.add(crown);
  });

  for (let fruit = 0; fruit < 4; fruit += 1) {
    const angle = fruit / 4 * Math.PI * 2 + 0.5;
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.13, 0.13),
      new THREE.MeshLambertMaterial({ color: "#ffe376", emissive: "#ffb72e", emissiveIntensity: 0.7 })
    );
    glow.position.set(Math.cos(angle) * 0.66, 2.4 + (fruit % 2) * 0.5, Math.sin(angle) * 0.66);
    glow.rotation.set(0.4, angle, 0);
    group.add(glow);
  }

  const heart = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshLambertMaterial({ color: "#ff8a7d", emissive: "#ff5d73", emissiveIntensity: 0.5 })
  );
  heart.position.set(0, 1.4, 0.3);
  heart.rotation.set(0.6, 0.6, 0);
  group.add(heart);

  const crownHeart = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.18),
    new THREE.MeshLambertMaterial({ color: "#ffaaa0", emissive: "#ff5d73", emissiveIntensity: 0.65 })
  );
  crownHeart.position.set(0.02, 3.82, 0.03);
  crownHeart.rotation.set(0.6, 0.8, 0);
  group.add(crownHeart);
  return group;
}

function createMushroomCluster(seed = 0) {
  const group = new THREE.Group();
  const capColors = ["#f48379", "#ffd367", "#7bc5e8", "#c892e3"];
  for (let index = 0; index < 3; index += 1) {
    const height = 0.18 + seededNoise(seed + index * 2.7) * 0.18;
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.07, height, 0.07), material("#f0e1bd"));
    stem.position.set((index - 1) * 0.15, height / 2, (index % 2) * 0.1);
    group.add(stem);
    const capSize = 0.17 + index * 0.02;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(capSize, 0.08, capSize), material(capColors[(seed + index) % capColors.length]));
    cap.position.copy(stem.position);
    cap.position.y = height + 0.03;
    cap.castShadow = true;
    group.add(cap);
  }
  return group;
}

function createPond(waterColor, rimColor) {
  const group = new THREE.Group();
  const waterMaterial = new THREE.MeshLambertMaterial({ color: waterColor, transparent: true, opacity: 0.78 });
  const water = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.85), waterMaterial);
  group.add(water);
  const rimMaterial = material(rimColor);
  [[0, -0.47, 1.3, 0.09], [0, 0.47, 1.3, 0.09], [-0.61, 0, 0.09, 0.86], [0.61, 0, 0.09, 0.86]].forEach(([x, z, w, d]) => {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), rimMaterial);
    rim.position.set(x, 0.02, z);
    group.add(rim);
  });
  [[-0.25, 0.09], [0.16, -0.14], [0.34, 0.08]].forEach(([x, z], index) => {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.16 - index * 0.02, 0.02, 0.16 - index * 0.02), material("#5aa75e"));
    leaf.position.set(x, 0.05, z);
    leaf.rotation.y = index * 0.6;
    group.add(leaf);
  });
  group.userData.material = waterMaterial;
  return group;
}

function createCloudIsland(x, y, z, scaleX, scaleZ, color, index = 0) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = index * 0.42;
  const top = new THREE.Mesh(new THREE.BoxGeometry(scaleX * 1.9, 0.26, scaleZ * 1.7), material(color));
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  const grass = new THREE.Mesh(
    new THREE.BoxGeometry(scaleX * 1.78, 0.07, scaleZ * 1.58),
    material(new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.28))
  );
  grass.position.y = 0.16;
  group.add(grass);

  const underside = new THREE.Mesh(new THREE.ConeGeometry(Math.max(scaleX, scaleZ) * 0.8, 0.92, 4), material("#5d628f"));
  underside.position.y = -0.56;
  underside.rotation.set(Math.PI, 0.4, 0);
  group.add(underside);

  const cloudMaterial = new THREE.MeshLambertMaterial({ color: "#f2fbf7", transparent: true, opacity: 0.92 });
  for (let puff = 0; puff < 4; puff += 1) {
    const angle = puff / 4 * Math.PI * 2 + 0.4;
    const size = 0.34 + (puff % 2) * 0.12;
    const cloud = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.5, size), cloudMaterial);
    cloud.position.set(Math.cos(angle) * scaleX * 0.8, -0.18, Math.sin(angle) * scaleZ * 0.78);
    cloud.rotation.y = puff * 0.5;
    group.add(cloud);
  }

  const dock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), material(index % 2 ? "#f5a580" : "#6fd1d3"));
  dock.position.set(index % 2 ? -0.5 : 0.48, 0.24, index % 2 ? 0.15 : -0.12);
  group.add(dock);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), material("#ffd06a"));
  mast.position.copy(dock.position).add(new THREE.Vector3(0, 0.36, 0));
  group.add(mast);
  const pennant = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.03), material(index % 2 ? "#76dfdc" : "#f58c8c"));
  pennant.position.copy(mast.position).add(new THREE.Vector3(0.14, 0.2, 0));
  group.add(pennant);
  return group;
}

function createSkyRotor() {
  const group = new THREE.Group();
  const frameMaterial = material("#ffd06a");
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.08, 0.14), material("#6e5573"));
  mast.position.y = 0.42;
  group.add(mast);
  const rotor = new THREE.Group();
  rotor.position.y = 0.92;
  for (let blade = 0; blade < 4; blade += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.48, 0.06), frameMaterial);
    mesh.position.y = 0.25;
    mesh.rotation.z = blade * Math.PI / 2;
    rotor.add(mesh);
  }
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.14), material("#7fe4df"));
  rotor.add(hub);
  group.add(rotor);
  group.userData.rotor = rotor;
  return group;
}

function createAirship(color, variant = 0) {
  const group = new THREE.Group();
  const balloon = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.5, 0.5), material(color));
  balloon.castShadow = true;
  group.add(balloon);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.54, 0.54), material("#ffd06a"));
  group.add(band);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), material(variant ? "#345c6d" : "#6e485f"));
  cabin.position.y = -0.38;
  group.add(cabin);
  [-1, 1].forEach((side) => {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.035), material("#f0d9a4"));
    strut.position.set(side * 0.13, -0.24, 0);
    group.add(strut);
  });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.06), material("#ffd06a"));
  tail.position.x = -0.62;
  group.add(tail);
  group.scale.setScalar(0.72);
  return group;
}

function createCometRock(seed = 0) {
  const group = new THREE.Group();
  const size = 0.48 + seededNoise(seed) * 0.14;
  const rock = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.85, size), material(seed % 2 ? "#8f82c4" : "#c487a3"));
  rock.rotation.set(seed * 0.3, seed, seed * 0.5);
  group.add(rock);
  const crystal = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.16, 0.16),
    new THREE.MeshLambertMaterial({ color: "#ffe478", emissive: "#ffc657", emissiveIntensity: 0.45 })
  );
  crystal.position.set(0.18, 0.24, 0.04);
  crystal.rotation.set(0.6, 0.4, 0);
  group.add(crystal);
  return group;
}

function createReefPlate(x, y, z, scaleX, scaleZ, color, index = 0) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = index * 0.34;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(scaleX * 1.9, 0.3, scaleZ * 1.75), material(color));
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);
  const sand = new THREE.Mesh(
    new THREE.BoxGeometry(scaleX * 1.7, 0.07, scaleZ * 1.55),
    material(index % 2 ? "#8fd0a8" : "#93dcc0")
  );
  sand.position.y = 0.18;
  group.add(sand);
  for (let rock = 0; rock < 4; rock += 1) {
    const angle = rock / 4 * Math.PI * 2 + index;
    const size = 0.2 + (rock % 2) * 0.09;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.65, size), material("#3b6870"));
    mesh.position.set(Math.cos(angle) * scaleX * 0.78, 0.24, Math.sin(angle) * scaleZ * 0.72);
    mesh.rotation.y = rock * 0.7;
    group.add(mesh);
  }
  return group;
}

function createTideWheel() {
  const group = new THREE.Group();
  const metal = material("#f3c85d");
  const support = material("#285a66");
  const wheel = new THREE.Group();
  wheel.position.y = 0.78;
  for (let spoke = 0; spoke < 8; spoke += 1) {
    const angle = spoke / 8 * Math.PI * 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.68, 0.07), metal);
    arm.position.set(Math.sin(angle) * 0.34, Math.cos(angle) * 0.34, 0);
    arm.rotation.z = -angle;
    wheel.add(arm);
    const paddle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.13), material(spoke % 2 ? "#65e0d3" : "#ef827d"));
    paddle.position.set(Math.sin(angle) * 0.74, Math.cos(angle) * 0.74, 0);
    paddle.rotation.z = -angle;
    wheel.add(paddle);
  }
  const hub = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), support);
  wheel.add(hub);
  group.add(wheel);
  [-1, 1].forEach((side) => {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.16), support);
    stand.position.set(side * 0.5, 0.36, 0.12);
    group.add(stand);
  });
  group.userData.wheel = wheel;
  return group;
}

function createLighthouse() {
  const group = new THREE.Group();
  const segments = [
    [0.52, 0.34, "#e8f2e6"],
    [0.46, 0.22, "#ef746f"],
    [0.42, 0.3, "#e8f2e6"],
    [0.38, 0.2, "#ef746f"]
  ];
  let towerY = 0;
  segments.forEach(([size, height, color]) => {
    const block = new THREE.Mesh(new THREE.BoxGeometry(size, height, size), material(color));
    block.position.y = towerY + height / 2;
    block.castShadow = true;
    group.add(block);
    towerY += height;
  });
  const balcony = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.09, 0.58), material("#f3c85d"));
  balcony.position.y = towerY + 0.045;
  group.add(balcony);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.3, 0.32),
    new THREE.MeshLambertMaterial({ color: "#c9ffed", emissive: "#f7df72", emissiveIntensity: 0.7, transparent: true, opacity: 0.85 })
  );
  lamp.position.y = towerY + 0.25;
  group.add(lamp);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.26, 4), material("#285a66"));
  roof.position.y = towerY + 0.52;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  const beam = new THREE.Group();
  beam.position.y = towerY + 0.25;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.38, 2.4, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: "#fff0a4", transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false })
  );
  cone.position.x = 1.2;
  cone.rotation.z = -Math.PI / 2;
  beam.add(cone);
  group.add(beam);
  group.userData.beam = beam;
  return group;
}

function createCoralCluster(color, seed = 0) {
  const group = new THREE.Group();
  const coralMaterial = material(color);
  for (let branch = 0; branch < 5; branch += 1) {
    const height = 0.25 + seededNoise(seed + branch * 1.9) * 0.34;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, height, 0.09), coralMaterial);
    mesh.position.set((branch - 2) * 0.1, height / 2, Math.sin(branch * 2.2) * 0.07);
    mesh.rotation.z = (branch - 2) * 0.09;
    group.add(mesh);
    if (branch % 2 === 0) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.11), material("#f4e8b7"));
      tip.position.set(mesh.position.x, height + 0.03, mesh.position.z);
      group.add(tip);
    }
  }
  return group;
}

function createWorldBlob(color, variant = 0) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.27), new THREE.MeshLambertMaterial({ color }));
  body.castShadow = true;
  group.add(body);

  const dark = new THREE.MeshBasicMaterial({ color: "#172126" });
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.015), dark);
    eye.position.set(side * 0.065, 0.03, 0.14);
    group.add(eye);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.13), dark);
    foot.position.set(side * 0.08, -0.185, 0.02);
    group.add(foot);
  });

  const topper = new THREE.Mesh(
    new THREE.BoxGeometry(variant % 2 ? 0.16 : 0.09, variant % 2 ? 0.03 : 0.12, variant % 2 ? 0.16 : 0.09),
    new THREE.MeshLambertMaterial({ color: "#ffe36b" })
  );
  topper.position.y = 0.22;
  topper.rotation.y = Math.PI / 4;
  group.add(topper);
  return group;
}

function createToken(color, styleIndex = 0) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const accentMaterials = [];
  const eyes = [];
  const feet = [];
  const style = styleIndex % 4;

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.06, 0.4),
    new THREE.MeshLambertMaterial({ color: "#20302c" })
  );
  base.position.y = -0.27;
  base.castShadow = true;
  group.add(base);

  const accent = new THREE.MeshLambertMaterial({ color });
  const accentLight = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.35) });
  const dark = new THREE.MeshLambertMaterial({ color: "#18231e" });
  const gold = new THREE.MeshLambertMaterial({ color: "#ffe36b", emissive: "#9d7420", emissiveIntensity: 0.12 });
  accentMaterials.push(accent, accentLight);

  const bodyShapes = [
    [1, 1.08, 0.92],
    [0.96, 1.02, 0.96],
    [1.06, 0.96, 0.92],
    [0.98, 1.12, 0.9]
  ];
  const blob = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.38), accent);
  blob.scale.set(...bodyShapes[style]);
  blob.position.y = 0.015;
  blob.castShadow = true;
  body.add(blob);

  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.02), accentLight);
  belly.position.set(0, -0.08, 0.19 * bodyShapes[style][2] + 0.002);
  body.add(belly);

  if (style === 0) {
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), gold);
    peak.position.set(-0.04, 0.32, 0);
    peak.rotation.set(0.5, 0.5, 0.3);
    body.add(peak);
  } else if (style === 1) {
    const halo = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.24), gold);
    halo.position.y = 0.36;
    halo.rotation.y = Math.PI / 4;
    body.add(halo);
  } else if (style === 2) {
    [-1, 1].forEach((side) => {
      const nub = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), gold);
      nub.position.set(side * 0.12, 0.3, 0);
      nub.rotation.z = side * 0.4;
      body.add(nub);
    });
  } else {
    [-1, 0, 1].forEach((position, index) => {
      const point = new THREE.Mesh(new THREE.BoxGeometry(0.08, index === 1 ? 0.17 : 0.12, 0.08), gold);
      point.position.set(position * 0.11, 0.31, 0);
      point.rotation.z = position * -0.14;
      body.add(point);
    });
  }

  [-1, 1].forEach((side) => {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.2), dark);
    foot.position.set(side * 0.12, -0.26, 0.05);
    body.add(foot);
    feet.push(foot);
  });

  const arms = [];
  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.17, 0.1), accent);
    arm.position.set(side * 0.26, -0.02, 0.005);
    arm.rotation.z = side * -0.4;
    arm.userData = { side, baseRotZ: side * -0.4 };
    body.add(arm);
    arms.push(arm);
  });

  const faceY = 0.05;
  const frontZ = 0.19 * bodyShapes[style][2] + 0.012;
  [-1, 1].forEach((direction) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.02), dark);
    eye.position.set(direction * 0.09, faceY + 0.03, frontZ);
    body.add(eye);
    eyes.push(eye);
  });
  [-1, 1].forEach((direction) => {
    const cheek = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.035, 0.015),
      new THREE.MeshLambertMaterial({ color: "#f9826b", transparent: true, opacity: 0.8 })
    );
    cheek.position.set(direction * 0.15, faceY - 0.05, frontZ);
    body.add(cheek);
  });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.028, 0.02), dark);
  mouth.position.set(0, faceY - 0.07, frontZ);
  body.add(mouth);

  group.add(body);

  group.userData = {
    body,
    accentMaterials,
    eyes,
    feet,
    arms,
    mouth,
    style,
    phase: styleIndex * 1.4 + Math.random() * 0.3,
    restY: 0,
    reaction: null,
    stepPhase: 0
  };
  group.scale.setScalar(0.84);
  return group;
}

function fieldStyle(type, index, theme) {
  const special = EVENT_FIELDS.has(type);
  return {
    color: FIELD_COLORS[type] || "#ffffff",
    special,
    height: special ? 0.19 : 0.165,
    baseHeight: theme.tileStyle === "saucer" ? 0.16 : 0.145,
    // Slightly tighter tiles leave visible gaps along the path, so the loop
    // reads as separate steps instead of a solid band.
    size: special ? 0.58 : 0.5
  };
}

function createFieldIcon(type, special) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  drawFieldIcon(ctx, type);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const size = special ? 0.265 : 0.225;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
  );
}

function drawFieldIcon(ctx, type) {
  const ink = "#17231e";
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (type === "start") {
    ctx.beginPath();
    ctx.moveTo(42, 94);
    ctx.lineTo(42, 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(48, 32);
    ctx.lineTo(94, 48);
    ctx.lineTo(48, 65);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (type === "normal") {
    // Understated dot so normal fields stay calm and uniform.
    ctx.beginPath();
    ctx.arc(64, 64, 10, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (type === "challenge") {
    [[43, 43], [85, 43], [43, 85], [85, 85]].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 13, 0, Math.PI * 2);
      ctx.fill();
    });
    return;
  }
  if (type === "gate") {
    ctx.beginPath();
    ctx.moveTo(30, 96);
    ctx.lineTo(30, 59);
    ctx.quadraticCurveTo(30, 27, 64, 27);
    ctx.quadraticCurveTo(98, 27, 98, 59);
    ctx.lineTo(98, 96);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(64, 43);
    ctx.lineTo(81, 64);
    ctx.lineTo(64, 85);
    ctx.lineTo(47, 64);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (type === "coin") {
    // A fat coin with a slot, so it reads as money at tile size.
    ctx.beginPath();
    ctx.arc(64, 64, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(64, 64, 14, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (type === "item") {
    // Question mark in a box: the universal "surprise" language.
    ctx.lineWidth = 10;
    roundRectPath(ctx, 30, 30, 68, 68, 14);
    ctx.stroke();
    ctx.font = "900 54px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 64, 66);
    return;
  }
  if (type === "luck") {
    // A diamond split light/dark — a coin flip you can read at a glance.
    ctx.beginPath();
    ctx.moveTo(64, 26);
    ctx.lineTo(102, 64);
    ctx.lineTo(64, 102);
    ctx.lineTo(26, 64);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(64, 26);
    ctx.lineTo(102, 64);
    ctx.lineTo(64, 102);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (type === "trap") {
    // A bold cross — the only field that takes something away.
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(36, 36);
    ctx.lineTo(92, 92);
    ctx.moveTo(92, 36);
    ctx.lineTo(36, 92);
    ctx.stroke();
    return;
  }
  if (type === "star") {
    drawStarPath(ctx, 64, 64, 38, 17);
    ctx.fill();
    return;
  }
  ctx.font = "900 72px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", 64, 67);
}

function roundRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawStarPath(ctx, cx, cy, outer, inner, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Flat white chevron lying on the path, pointing toward the next field.
function createPathArrow() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.62, depthWrite: false });
  [-1, 1].forEach((side) => {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.05), material);
    wing.position.set(side * 0.048, 0, -0.028);
    wing.rotation.y = side * -0.82;
    group.add(wing);
  });
  group.renderOrder = 2;
  return group;
}

// Blocky golden arch with a START banner over field 0.
function createStartArch() {
  const group = new THREE.Group();
  const gold = new THREE.MeshLambertMaterial({ color: "#ffb400", emissive: "#a86a00", emissiveIntensity: 0.25 });
  [-1, 1].forEach((side) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.86, 0.08), gold);
    post.position.set(side * 0.44, 0.43, 0);
    post.castShadow = true;
    group.add(post);
  });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.13, 0.11), gold);
  beam.position.y = 0.9;
  beam.castShadow = true;
  group.add(beam);

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 44px ui-rounded, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("START", 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.18),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
  );
  label.position.y = 0.9;
  label.position.z = 0.062;
  group.add(label);
  const labelBack = label.clone();
  labelBack.position.z = -0.062;
  labelBack.rotation.y = Math.PI;
  group.add(labelBack);
  return group;
}

function drawIconStar(ctx, x, y, outer, inner) {
  ctx.beginPath();
  for (let point = 0; point < 10; point += 1) {
    const radius = point % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + point / 10 * Math.PI * 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (point === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function disposeGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}

function disposeObject(object) {
  object.traverse?.((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach((material) => {
      material.map?.dispose?.();
      material.dispose?.();
    });
  });
}

function seededNoise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
