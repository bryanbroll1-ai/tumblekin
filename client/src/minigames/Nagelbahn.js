// Nagelbrett: die Bahn EINER Kugel, genau wie der Server sie rechnet
// (plinkoStep in server.js) — Schwerkraft, Luftwiderstand quer, Wände und
// Nägel samt der festen Streuung am Nagel. Andere Kugeln kennt sie nicht; stösst
// die eigene an eine fremde, weicht die echte Bahn ab.
//
// Damit zeigt das Gerät vorher, wo die Kugel landet, wenn man JETZT stupst.
// Vorher war der Stups geraten: wie weit er trägt, hängt davon ab, wie viel Weg
// die Kugel noch hat und welche Nägel noch kommen, und das sah man nirgends.
// Ein Test auf dem Server hält beide Rechnungen gleich.

const SIDE_MAX = 0.32;        // wie PLINKO_SIDE_MAX
const BALL_R = 0.028;         // wie PLINKO_BALL_R
const MAX_PLINKS = 60;        // wie PLINKO_MAX_PLINKS
const STALL_KICK = 0.7;       // wie PLINKO_STALL_KICK
const STEP_S = 0.01;          // wie PLINKO_STEP_S
const DIVIDER_H = 0.14;       // wie PLINKO_DIVIDER_H

function noise(seed) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Wie plinkoDivider: zwischen den Töpfen prallt die Kugel an der Wand ab.
function divider(ball, slotCount, floorY, height) {
  if (ball.y < floorY - height) return;
  const k = Math.round(ball.x * slotCount);
  if (k <= 0 || k >= slotCount) return;
  const wall = k / slotCount;
  const off = ball.x - wall;
  if (Math.abs(off) >= BALL_R) return;
  const side = off > 0 || (off === 0 && ball.vx < 0) ? 1 : -1;
  ball.x = wall + side * BALL_R;
  if (Math.sign(ball.vx) === -side) ball.vx = -ball.vx * 0.5;
}

// Ein Rechenschritt, ball wird verändert. `rules`: { seed, pegs, gravity,
// sideDrag, slots, floorY, dividerH } (die letzten drei wie auf dem Server).
export function stepBall(ball, rules, dt) {
  ball.vy += rules.gravity * dt;
  ball.vx *= Math.exp(-rules.sideDrag * dt);
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  divider(ball, rules.slots ?? 7, rules.floorY ?? 1.3, rules.dividerH ?? DIVIDER_H);
  if (ball.x < 0.035) {
    ball.x = 0.035;
    ball.vx = Math.abs(ball.vx) * 0.6;
  } else if (ball.x > 0.965) {
    ball.x = 0.965;
    ball.vx = -Math.abs(ball.vx) * 0.6;
  }
  for (const peg of rules.pegs) {
    const dx = ball.x - peg.x;
    const dy = ball.y - peg.y;
    const distance = Math.hypot(dx, dy);
    const minDistance = peg.r + BALL_R;
    if (distance >= minDistance || distance === 0) continue;
    const nx = dx / distance;
    const ny = dy / distance;
    ball.x = peg.x + nx * minDistance;
    ball.y = peg.y + ny * minDistance;
    const dot = ball.vx * nx + ball.vy * ny;
    if (ball.plinks > MAX_PLINKS) {
      ball.vx = 0;
      ball.vy = Math.max(ball.vy, STALL_KICK);
      continue;
    }
    if (dot < 0) {
      ball.vx -= 2 * dot * nx;
      ball.vy -= 2 * dot * ny;
      ball.vx = clamp(ball.vx * 0.55, -SIDE_MAX, SIDE_MAX);
      ball.vy *= 0.55;
      ball.vx += (noise(rules.seed + ball.id * 7 + ball.plinks * 3) - 0.5) * 0.05;
      ball.plinks += 1;
    }
  }
}

// Wo die Kugel landet. `leadS`: so lange fällt sie noch ungestört, bevor der
// Stups ankommt; `nudge`: -1, 0 oder 1. Gibt null zurück, wenn sie schon
// unten ist, bevor der Stups wirken kann.
export function landingX(ball, rules, { leadS = 0, nudge = 0, push = 0.85, floorY = 1.3 } = {}) {
  const b = { x: ball.x, y: ball.y, vx: ball.vx || 0, vy: ball.vy || 0, id: ball.id, plinks: ball.plinks || 0 };
  const floor = floorY - 0.03;
  // Der Server rechnet in festen 10-ms-Schritten; ein Stups wirkt ab dem
  // nächsten ganzen Schritt.
  const leadSteps = Math.round(Math.max(0, leadS) / STEP_S);
  for (let i = 0; i < leadSteps && b.y < floor; i += 1) stepBall(b, rules, STEP_S);
  if (b.y >= floor) return null;
  if (nudge) b.vx = nudge * push;
  for (let i = 0; i < 600 && b.y < floor; i += 1) stepBall(b, rules, STEP_S);
  return b.x;
}
