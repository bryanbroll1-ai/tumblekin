export const BOARD_THEMES = {
  mossback: {
    id: "mossback",
    name: "Runa, die Wurzelwanderin",
    background: "#9fdcf2",
    fog: "#a8e0f5",
    particle: "#ffffff",
    path: "#7a4a2a",
    edge: "#b9f06f",
    fieldTint: "#eff9db",
    fieldBase: "#8a5a35",
    fieldRim: "#d9f0a0",
    pathStyle: "root",
    tileStyle: "stump",
    cameraYaw: 0.1,
    camera: {
      target: [0, 0.48, 0.08],
      overviewPortrait: [0.16, 16.47, 7.19],
      overviewLandscape: [0.53, 8.00, 9.51],
      overviewFovPortrait: 56,
      overviewFovLandscape: 38,
      followPortrait: [0.2, 7.6, 3.6],
      followLandscape: [2.55, 4.15, 4.75]
    }
  },
  cloudpantry: {
    id: "cloudpantry",
    name: "Miraris Kometenhafen",
    background: "#8fc8f7",
    fog: "#9fd2f7",
    particle: "#ffffff",
    path: "#c77b9e",
    edge: "#ffd06a",
    fieldTint: "#fff7de",
    fieldBase: "#a06a88",
    fieldRim: "#ffbd75",
    pathStyle: "skyrail",
    tileStyle: "saucer",
    cameraYaw: -0.18,
    camera: {
      target: [0, 0.52, 0.02],
      overviewPortrait: [0.16, 16.59, 7.31],
      overviewLandscape: [0.47, 8.29, 9.86],
      overviewFovPortrait: 56,
      overviewFovLandscape: 39,
      followPortrait: [0.16, 7.8, 3.7],
      followLandscape: [2.7, 4.2, 4.85]
    }
  },
  tideworks: {
    id: "tideworks",
    name: "Pelagos Leuchtriff",
    background: "#7fdbe8",
    fog: "#93e2ec",
    particle: "#ffffff",
    path: "#2a7ba8",
    edge: "#69f0dc",
    fieldTint: "#e9fff8",
    fieldBase: "#3a8ba0",
    fieldRim: "#f3c85d",
    pathStyle: "glass",
    tileStyle: "gear",
    cameraYaw: 0.22,
    camera: {
      target: [0, 0.3, 0.03],
      overviewPortrait: [0.13, 16.47, 7.08],
      overviewLandscape: [0.58, 7.77, 9.69],
      overviewFovPortrait: 55,
      overviewFovLandscape: 38,
      followPortrait: [0.18, 7.5, 3.55],
      followLandscape: [2.65, 4.0, 4.8]
    }
  }
};

const LAYOUTS = {
  mossback: [
    [-3.35, 0.68, 2.25], [-2.55, 0.76, 2.7], [-1.65, 0.86, 2.78], [-0.75, 0.98, 2.48],
    [0.05, 1.08, 2.16], [0.92, 1.12, 2.34], [1.85, 1.08, 2.58], [2.7, 1, 2.24],
    [3.28, 0.92, 1.55], [3.45, 0.9, 0.72], [3.3, 0.96, -0.12], [2.92, 1.04, -0.88],
    [2.35, 1.17, -1.47], [1.58, 1.28, -1.88], [0.72, 1.38, -2.04], [-0.14, 1.45, -1.95],
    [-0.98, 1.46, -1.68], [-1.8, 1.38, -1.4], [-2.55, 1.25, -0.96], [-3.1, 1.12, -0.34],
    [-3.35, 1.02, 0.42], [-3.12, 0.96, 1.14], [-2.62, 1, 1.72], [-1.94, 1.09, 1.92],
    [-1.28, 1.18, 1.52], [-0.68, 1.28, 1.07], [-0.05, 1.36, 0.64], [0.65, 1.34, 0.78],
    [1.28, 1.28, 1.18], [1.68, 1.2, 0.62], [1.2, 1.27, 0.05], [0.48, 1.36, -0.42]
  ],
  cloudpantry: [
    [-0.1, 1.45, 0.15], [-0.65, 1.32, 0.95], [-1.35, 1.18, 1.65], [-2.15, 1.02, 2.05],
    [-2.95, 0.86, 1.78], [-3.45, 0.74, 1.05], [-3.52, 0.7, 0.18], [-3.15, 0.78, -0.62],
    [-2.48, 0.9, -1.18], [-1.65, 1.05, -1.25], [-0.92, 1.2, -0.82], [-0.45, 1.34, -0.15],
    [0.1, 1.46, 0.55], [0.65, 1.34, 1.2], [1.35, 1.18, 1.7], [2.15, 1.02, 2],
    [2.95, 0.86, 1.68], [3.42, 0.74, 0.95], [3.5, 0.7, 0.08], [3.15, 0.78, -0.72],
    [2.5, 0.9, -1.3], [1.65, 1.05, -1.42], [0.9, 1.2, -1], [0.4, 1.34, -0.3],
    [-0.15, 1.46, -0.82], [-0.75, 1.34, -1.65], [-1.5, 1.18, -2.15], [-2.35, 1, -2.28],
    [-3.05, 0.85, -1.9], [-3.45, 0.74, -1.18], [-3.15, 0.78, -0.42], [-2.5, 0.92, 0.05]
  ],
  tideworks: [
    [-3.35, 0.55, 1.8], [-2.65, 0.62, 2.35], [-1.8, 0.7, 2.6], [-0.9, 0.76, 2.45],
    [-0.15, 0.82, 2.05], [0.55, 0.88, 1.55], [1.25, 0.92, 1.95], [2.1, 0.86, 2.35],
    [2.95, 0.72, 2.1], [3.42, 0.62, 1.4], [3.5, 0.56, 0.55], [3.28, 0.58, -0.3],
    [2.78, 0.68, -1.05], [2.12, 0.8, -1.55], [1.35, 0.9, -1.88], [0.55, 0.96, -2.15],
    [-0.25, 0.98, -2.25], [-1.05, 0.92, -2.1], [-1.8, 0.84, -1.78], [-2.5, 0.74, -1.28],
    [-3, 0.64, -0.62], [-3.3, 0.58, 0.15], [-3.18, 0.58, 0.9], [-2.65, 0.65, 1.45],
    [-1.98, 0.76, 1.22], [-1.35, 0.86, 0.78], [-0.72, 0.94, 0.35], [-0.05, 1, 0.05],
    [0.6, 0.96, 0.42], [1.18, 0.9, 0.88], [1.75, 0.84, 0.45], [1.15, 0.9, -0.08]
  ]
};

export function boardTheme(boardId) {
  return BOARD_THEMES[boardId] || BOARD_THEMES.mossback;
}

// Fields sit further apart than authored so the loop reads clearly at a
// glance — start, gates and everything between get breathing room.
const LAYOUT_SPREAD = 1.18;

export function createThemeLayout(boardId, count = 32) {
  const source = LAYOUTS[boardId] || LAYOUTS.mossback;
  return source.slice(0, count).map(([x, y, z]) => ({ x: x * LAYOUT_SPREAD, y, z: z * LAYOUT_SPREAD }));
}
