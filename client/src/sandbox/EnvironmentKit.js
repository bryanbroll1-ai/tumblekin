import * as THREE from "/vendor/three/three.module.js";
import { createCloud, noise } from "../minigames/VoxelKit.js?v=tumblekin102";

// Reusable voxel environment sets and obstacles for every 3D minigame.
// All sets share one footprint: a ~12x12 diorama centered on the origin
// whose walkable ground surface sits at y = 0.

function lambert(color) {
  return new THREE.MeshLambertMaterial({ color });
}

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const ENVIRONMENT_SETS = [
  { id: "meadow", name: "Wiese & Natur", sky: "#9fdcf2" },
  { id: "beach", name: "Strand & Wasser", sky: "#8fd8f2" },
  { id: "city", name: "Stadt & Straße", sky: "#a8d4f2" },
  { id: "toyroom", name: "Spielzimmer", sky: "#f7d9e8" },
  { id: "skypark", name: "Himmel & Plattformen", sky: "#8fc8f7" },
  { id: "factory", name: "Fabrik & Baustelle", sky: "#d8dce8" }
];

export function createEnvironment(setId) {
  const group = new THREE.Group();
  group.userData.animated = [];
  const builders = {
    meadow: buildMeadow,
    beach: buildBeach,
    city: buildCity,
    toyroom: buildToyroom,
    skypark: buildSkypark,
    factory: buildFactory
  };
  (builders[setId] || buildMeadow)(group);
  return group;
}

function groundSlab(group, color, trimColor, size = 12) {
  const slab = box(size, 0.6, size, color, 0, -0.3, 0);
  group.add(slab);
  const trim = box(size + 0.4, 0.3, size + 0.4, trimColor, 0, -0.62, 0);
  group.add(trim);
  return slab;
}

function scatter(group, count, seedBase, factory) {
  for (let index = 0; index < count; index += 1) {
    const angle = noise(seedBase + index * 7) * Math.PI * 2;
    const radius = 3.4 + noise(seedBase + index * 13 + 3) * 2.2;
    const item = factory(index);
    item.position.x += Math.cos(angle) * radius;
    item.position.z += Math.sin(angle) * radius;
    group.add(item);
  }
}

// --- Wiese & Natur ------------------------------------------------------
function buildMeadow(group) {
  groundSlab(group, "#7dc45f", "#5a9147");
  const grassTop = box(11.4, 0.08, 11.4, "#8fd46e", 0, 0.02, 0);
  grassTop.receiveShadow = true;
  group.add(grassTop);

  scatter(group, 3, 11, (index) => {
    const tree = new THREE.Group();
    tree.add(box(0.34, 1.3, 0.34, "#8a5a35", 0, 0.65, 0));
    tree.add(box(1.1, 0.46, 1.1, "#4f9c58", 0, 1.5, 0));
    tree.add(box(0.8, 0.4, 0.8, "#6fbf62", 0, 1.9, 0));
    tree.add(box(0.5, 0.34, 0.5, "#95d96f", 0, 2.26, 0));
    tree.scale.setScalar(0.8 + noise(index * 3) * 0.35);
    return tree;
  });
  scatter(group, 5, 41, (index) => {
    const flower = new THREE.Group();
    flower.add(box(0.05, 0.26, 0.05, "#4f9c58", 0, 0.13, 0));
    flower.add(box(0.16, 0.16, 0.16, ["#ff8aa0", "#ffd15c", "#c5a9f0"][index % 3], 0, 0.32, 0));
    return flower;
  });
  scatter(group, 3, 71, (index) => {
    const shroom = new THREE.Group();
    shroom.add(box(0.09, 0.22, 0.09, "#f0e1bd", 0, 0.11, 0));
    shroom.add(box(0.26, 0.1, 0.26, index % 2 ? "#f48379" : "#7bc5e8", 0, 0.26, 0));
    return shroom;
  });
  const pond = box(1.8, 0.06, 1.3, "#55c9d1", 2.6, 0.03, -2.4);
  pond.material.transparent = true;
  pond.material.opacity = 0.85;
  group.add(pond);
}

// --- Strand & Wasser ----------------------------------------------------
function buildBeach(group) {
  groundSlab(group, "#f5d98f", "#d9b96a");
  const water = box(12, 0.14, 4.4, "#3cb0cf", 0, 0.02, 4);
  water.material.transparent = true;
  water.material.opacity = 0.9;
  group.add(water);
  water.userData = { kind: "waterline", baseY: water.position.y };
  group.userData.animated.push(water);
  const foam = box(12, 0.05, 0.3, "#ffffff", 0, 0.08, 1.85);
  foam.material.transparent = true;
  foam.material.opacity = 0.7;
  group.add(foam);

  scatter(group, 2, 21, (index) => {
    const palm = new THREE.Group();
    for (let seg = 0; seg < 4; seg += 1) {
      palm.add(box(0.24, 0.4, 0.24, "#a06a3a", seg * 0.06, 0.2 + seg * 0.4, 0));
    }
    [[0.55, 0], [-0.45, 0.3], [0, 0.55], [0, -0.55]].forEach(([lx, lz]) => {
      palm.add(box(0.7, 0.1, 0.32, "#4f9c58", 0.2 + lx, 1.85, lz));
    });
    palm.position.z = -2.5 - index;
    return palm;
  });
  const ball = new THREE.Group();
  ball.add(box(0.5, 0.5, 0.5, "#ff5d73", 0, 0.25, 0));
  ball.add(box(0.52, 0.17, 0.52, "#ffffff", 0, 0.25, 0));
  ball.position.set(-2.2, 0, -1.4);
  ball.rotation.y = 0.6;
  group.add(ball);
  const umbrella = new THREE.Group();
  umbrella.add(box(0.08, 1.7, 0.08, "#f0e1bd", 0, 0.85, 0));
  umbrella.add(box(1.5, 0.12, 1.5, "#ff8aa0", 0, 1.7, 0));
  umbrella.add(box(1.0, 0.12, 1.0, "#ffffff", 0, 1.82, 0));
  umbrella.position.set(2.4, 0, -2.2);
  umbrella.rotation.z = 0.12;
  group.add(umbrella);
}

// --- Stadt & Straße -----------------------------------------------------
function buildCity(group) {
  groundSlab(group, "#8a93a3", "#6a7383");
  const road = box(12, 0.06, 2.6, "#4a5262", 0, 0.03, 1.6);
  group.add(road);
  for (let stripe = 0; stripe < 6; stripe += 1) {
    group.add(box(0.8, 0.02, 0.16, "#ffe25c", -5 + stripe * 2, 0.07, 1.6));
  }
  const walk = box(12, 0.1, 1.4, "#b8bfcc", 0, 0.05, 3.6);
  group.add(walk);

  const buildings = [
    [-3.4, "#7fd4f0", 2.2], [-1, "#ff8aa0", 3], [1.6, "#ffd15c", 2.5], [3.9, "#95d96f", 3.4]
  ];
  buildings.forEach(([x, color, height], index) => {
    const building = new THREE.Group();
    building.add(box(1.7, height, 1.7, color, 0, height / 2, 0));
    for (let row = 0; row < Math.floor(height / 0.8); row += 1) {
      [-0.45, 0.45].forEach((wx) => {
        building.add(box(0.36, 0.36, 0.06, "#fff8e0", wx, 0.7 + row * 0.8, 0.88));
      });
    }
    building.add(box(1.9, 0.2, 1.9, "#ffffff", 0, height + 0.1, 0));
    building.position.set(x, 0, -2.6);
    building.rotation.y = index * 0.04;
    group.add(building);
  });

  const light = new THREE.Group();
  light.add(box(0.1, 1.9, 0.1, "#4a5262", 0, 0.95, 0));
  ["#ff5d73", "#ffd15c", "#71d97b"].forEach((color, index) => {
    light.add(box(0.22, 0.22, 0.14, color, 0, 2.15 - index * 0.28, 0.05));
  });
  light.position.set(-4.6, 0, 2.9);
  group.add(light);
}

// --- Spielzimmer --------------------------------------------------------
function buildToyroom(group) {
  groundSlab(group, "#d9a56a", "#b8854f");
  for (let plank = 0; plank < 6; plank += 1) {
    group.add(box(12, 0.02, 0.05, "#b8854f", 0, 0.02, -5 + plank * 2));
  }
  const rug = box(4.6, 0.05, 3.4, "#c5a9f0", -1.2, 0.04, 0.6);
  group.add(rug);
  group.add(box(3.8, 0.05, 2.6, "#e8c8f2", -1.2, 0.07, 0.6));

  const letters = [["#ff5d73", -3.4, -2.2, 0.2], ["#7fd4f0", -2.5, -2.6, -0.15], ["#ffd15c", -2.9, -1.4, 0.35]];
  letters.forEach(([color, x, z, rot]) => {
    const block = box(0.9, 0.9, 0.9, color, x, 0.45, z);
    block.rotation.y = rot;
    group.add(block);
  });
  const stack = new THREE.Group();
  stack.add(box(0.9, 0.9, 0.9, "#95d96f", 0, 0.45, 0));
  stack.add(box(0.9, 0.9, 0.9, "#ff8aa0", 0.12, 1.35, -0.06));
  stack.position.set(3.2, 0, -2.4);
  group.add(stack);

  const duck = new THREE.Group();
  duck.add(box(0.8, 0.55, 0.6, "#ffd15c", 0, 0.35, 0));
  duck.add(box(0.45, 0.45, 0.42, "#ffd15c", 0.42, 0.75, 0));
  duck.add(box(0.24, 0.14, 0.2, "#ff9a3a", 0.72, 0.7, 0));
  duck.add(box(0.06, 0.1, 0.05, "#172126", 0.55, 0.85, 0.2));
  duck.position.set(2.6, 0, 1.9);
  duck.rotation.y = -0.7;
  group.add(duck);

  const pencil = new THREE.Group();
  pencil.add(box(2.2, 0.24, 0.24, "#ffd15c", 0, 0.12, 0));
  pencil.add(box(0.3, 0.24, 0.24, "#f0a8c0", -1.24, 0.12, 0));
  pencil.add(box(0.32, 0.18, 0.18, "#f0e1bd", 1.25, 0.12, 0));
  pencil.position.set(-0.4, 0, 3.4);
  pencil.rotation.y = 0.4;
  group.add(pencil);
}

// --- Himmel & Plattformen ----------------------------------------------
function buildSkypark(group) {
  const main = box(6, 0.6, 6, "#c487a3", 0, -0.3, 0);
  group.add(main);
  group.add(box(5.6, 0.1, 5.6, "#e8c8f2", 0, 0.03, 0));
  const under = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.6, 4), lambert("#8f82c4"));
  under.rotation.set(Math.PI, Math.PI / 4, 0);
  under.position.y = -1.4;
  group.add(under);

  [[-4.2, 0.6, -1.4, 1.8], [4.1, 1.1, 0.8, 1.5], [-3.4, 1.7, 2.8, 1.3], [3.2, 2.2, -3, 1.2]].forEach(([x, y, z, size], index) => {
    const isle = new THREE.Group();
    isle.add(box(size, 0.34, size, ["#7fd4f0", "#95d96f", "#ffd15c", "#ff8aa0"][index], 0, 0, 0));
    isle.add(box(size * 0.9, 0.08, size * 0.9, "#ffffff", 0, 0.2, 0));
    isle.position.set(x, y, z);
    isle.userData = { kind: "float", baseY: y, phase: index * 1.6 };
    group.add(isle);
    group.userData.animated.push(isle);
  });

  for (let step = 0; step < 5; step += 1) {
    const arc = box(0.5, 0.16, 0.5, ["#ff5d73", "#ff9a3a", "#ffd15c", "#71d97b", "#7fd4f0"][step], -2.4 + step * 0.5, 2.6 + Math.sin(step / 4 * Math.PI) * 0.7, -4.2);
    group.add(arc);
  }
  [[-2.4, 3.4, 3.4, 8], [2.8, 3.9, 2.4, 9]].forEach(([x, y, z, seed]) => {
    const cloud = createCloud(seed);
    cloud.position.set(x, y, z);
    cloud.userData = { kind: "float", baseY: y, phase: seed };
    group.add(cloud);
    group.userData.animated.push(cloud);
  });
}

// --- Fabrik & Baustelle -------------------------------------------------
function buildFactory(group) {
  groundSlab(group, "#9aa0ad", "#7a808d");
  for (let stripe = 0; stripe < 5; stripe += 1) {
    group.add(box(0.5, 0.04, 0.5, stripe % 2 ? "#ffd15c" : "#2b3440", -5.2 + stripe * 0.5, 0.03, -5.2));
  }

  const belt = new THREE.Group();
  belt.add(box(4.6, 0.4, 1.2, "#4a5262", 0, 0.2, 0));
  for (let roller = 0; roller < 6; roller += 1) {
    belt.add(box(0.16, 0.5, 1.3, "#2b3440", -2 + roller * 0.8, 0.2, 0));
  }
  belt.add(box(4.6, 0.08, 1.1, "#6a7383", 0, 0.44, 0));
  belt.position.set(-1.2, 0, -2.8);
  group.add(belt);

  [[1.9, -2.6], [2.7, -2.4], [2.3, -1.8]].forEach(([x, z], index) => {
    const crate = box(0.8, 0.8, 0.8, index % 2 ? "#c9873f" : "#d9a56a", x, 0.4, z);
    crate.rotation.y = index * 0.4;
    group.add(crate);
  });

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.85, 8), lambert("#ff9a3a"));
  barrel.position.set(-3.6, 0.42, 1.8);
  barrel.castShadow = true;
  group.add(barrel);
  group.add(box(0.9, 0.06, 0.9, "#2b3440", -3.6, 0.02, 1.8));

  const crane = new THREE.Group();
  crane.add(box(0.34, 3.2, 0.34, "#ffd15c", 0, 1.6, 0));
  crane.add(box(2.6, 0.26, 0.3, "#ffd15c", 1.1, 3.1, 0));
  crane.add(box(0.06, 1.0, 0.06, "#2b3440", 2.2, 2.5, 0));
  crane.add(box(0.3, 0.24, 0.3, "#8a93a3", 2.2, 1.95, 0));
  crane.position.set(3.6, 0, 2.6);
  crane.rotation.y = -0.5;
  group.add(crane);
}

// --- Obstacles ----------------------------------------------------------

export const OBSTACLE_TYPES = [
  { id: "crate", name: "Kiste" },
  { id: "log", name: "Baumstamm" },
  { id: "cone", name: "Pylone" },
  { id: "platform", name: "Plattform" },
  { id: "door", name: "Tür" },
  { id: "ramp", name: "Rampe" },
  { id: "spring", name: "Feder" },
  { id: "bumper", name: "Bumper" },
  { id: "spinner", name: "Drehstange" }
];

// Every obstacle gets userData.obstacle = { type, radius } for simple
// circle-based interactions plus optional animation hooks.
export function createObstacle(type) {
  const group = new THREE.Group();
  group.userData.obstacle = { type, radius: 0.55 };

  if (type === "crate") {
    group.add(box(0.72, 0.72, 0.72, "#d9a56a", 0, 0.36, 0));
    group.add(box(0.78, 0.1, 0.14, "#c9873f", 0, 0.36, 0));
    group.add(box(0.14, 0.1, 0.78, "#c9873f", 0, 0.36, 0));
    group.userData.obstacle.radius = 0.55;
  } else if (type === "log") {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.7, 8), lambert("#8a5a35"));
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.3;
    log.castShadow = true;
    group.add(log);
    [-0.85, 0.85].forEach((x) => {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 8), lambert("#d9b98a"));
      end.rotation.z = Math.PI / 2;
      end.position.set(x, 0.3, 0);
      group.add(end);
    });
    group.userData.obstacle.radius = 0.7;
  } else if (type === "cone") {
    group.add(box(0.5, 0.08, 0.5, "#ff9a3a", 0, 0.04, 0));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.62, 4), lambert("#ff9a3a"));
    cone.position.y = 0.39;
    cone.rotation.y = Math.PI / 4;
    cone.castShadow = true;
    group.add(cone);
    group.add(box(0.34, 0.09, 0.34, "#ffffff", 0, 0.34, 0));
    group.userData.obstacle.radius = 0.4;
  } else if (type === "platform") {
    const plate = box(1.3, 0.2, 1.3, "#7fd4f0", 0, 0.1, 0);
    group.add(plate);
    group.add(box(1.16, 0.06, 1.16, "#ffffff", 0, 0.23, 0));
    group.userData.obstacle.radius = 0.8;
    group.userData.obstacle.animate = (item, now) => {
      item.position.x = item.userData.homeX + Math.sin(now / 1100 + item.userData.phase) * 1.1;
    };
  } else if (type === "door") {
    group.add(box(0.16, 1.5, 0.16, "#8a5a35", -0.55, 0.75, 0));
    group.add(box(0.16, 1.5, 0.16, "#8a5a35", 0.55, 0.75, 0));
    group.add(box(1.26, 0.18, 0.2, "#8a5a35", 0, 1.55, 0));
    const panel = box(0.92, 1.34, 0.08, "#ff8aa0", 0, 0.72, 0);
    group.add(panel);
    group.userData.obstacle.radius = 0.7;
    group.userData.obstacle.panel = panel;
    group.userData.obstacle.animate = (item, now) => {
      const open = (Math.sin(now / 1400 + item.userData.phase) + 1) / 2;
      item.userData.obstacle.panel.position.y = 0.72 + open * 1.2;
      item.userData.obstacle.open = open > 0.55;
    };
  } else if (type === "ramp") {
    const ramp = box(1.3, 0.18, 1.7, "#95d96f", 0, 0.32, 0);
    ramp.rotation.x = -0.42;
    group.add(ramp);
    group.add(box(1.3, 0.62, 0.24, "#6fbf62", 0, 0.31, -0.78));
    group.userData.obstacle.radius = 0.85;
  } else if (type === "spring") {
    [0, 1, 2].forEach((coil) => {
      group.add(box(0.5 - coil * 0.04, 0.09, 0.5 - coil * 0.04, coil % 2 ? "#8a93a3" : "#b8bfcc", 0, 0.09 + coil * 0.14, 0));
    });
    const pad = box(0.66, 0.14, 0.66, "#ff5d73", 0, 0.48, 0);
    group.add(pad);
    group.userData.obstacle.radius = 0.5;
    group.userData.obstacle.pad = pad;
    group.userData.obstacle.bounce = true;
  } else if (type === "bumper") {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.5, 8), lambert("#ff5d73"));
    body.position.y = 0.25;
    body.castShadow = true;
    group.add(body);
    const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 8), lambert("#ffffff"));
    capMesh.position.y = 0.55;
    group.add(capMesh);
    group.userData.obstacle.radius = 0.65;
    group.userData.obstacle.push = true;
    group.userData.obstacle.bodyMesh = body;
  } else if (type === "spinner") {
    group.add(box(0.3, 0.9, 0.3, "#4a5262", 0, 0.45, 0));
    const bar = new THREE.Group();
    for (let seg = 0; seg < 4; seg += 1) {
      bar.add(box(0.66, 0.18, 0.2, seg % 2 ? "#ffffff" : "#ff5d73", -0.99 + seg * 0.66, 0, 0));
    }
    bar.position.y = 0.42;
    group.add(bar);
    group.userData.obstacle.radius = 1.35;
    group.userData.obstacle.bar = bar;
    group.userData.obstacle.spin = true;
    group.userData.obstacle.animate = (item, now) => {
      item.userData.obstacle.bar.rotation.y = now / 900 + item.userData.phase;
    };
  }

  return group;
}
