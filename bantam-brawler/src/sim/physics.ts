import { GRAVITY, GROUND_FRICTION, AIR_DRAG, ARENA_W, ARENA_D } from "./constants";
import type { Fighter, Projectile, StageRuntime } from "./types";

const DEFAULT_WALLS = { left: 0, right: ARENA_W, restitution: 0.4 };

/** Reflect an overshoot distance off both walls until it lands inside [left, right]. */
function fold(overshoot: number, walls: typeof DEFAULT_WALLS): number {
  const span = walls.right - walls.left;
  if (span <= 0) return walls.left;
  let m = overshoot % (2 * span);
  if (m < 0) m += 2 * span;
  return m <= span ? m : 2 * span - m;
}

export function integrateFighter(f: Fighter, _tick: number): void {
  const walls = DEFAULT_WALLS;
  const airborne = f.y < 0;

  if (airborne) {
    f.vy += GRAVITY;
    f.vx *= AIR_DRAG;
  } else {
    f.vy = 0;
    // Walk/dash/attack keep air drag on vx; everything else sticks to ground friction.
    if (f.state !== "walk" && f.state !== "dash" && f.state !== "attack") f.vx *= GROUND_FRICTION;
    else f.vx *= AIR_DRAG;
  }

  f.x += f.vx;
  f.y += f.vy;
  f.z += f.vz;

  // Walls: reflect with restitution; repeated folding keeps x inside the band for any overshoot.
  if (f.x < walls.left) { f.x = fold(walls.left - f.x, walls); f.vx = Math.abs(f.vx) * walls.restitution; }
  if (f.x > walls.right) { f.x = walls.right - fold(f.x - walls.right, walls); f.vx = -Math.abs(f.vx) * walls.restitution; }
  // Depth band: hard clamp
  if (f.z < 0) { f.z = 0; f.vz = 0; }
  if (f.z > ARENA_D) { f.z = ARENA_D; f.vz = 0; }
  // Ground clamp
  if (f.y >= 0) { f.y = 0; if (f.vy > 0) f.vy = 0; }
}

export function integrateProjectile(p: Projectile, stage?: StageRuntime): boolean {
  p.ttl -= 1;
  p.vy += p.gravity;
  p.x += p.vx;
  p.y += p.vy;
  const right = stage?.walls.right ?? ARENA_W;
  if (p.ttl <= 0) return false;
  if (p.x < 0 || p.x > right) return false;
  if (p.y > 0) return false;                 // fell past floor
  return true;
}
