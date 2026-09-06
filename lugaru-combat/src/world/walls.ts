/**
 * Task 17 — boulder clusters: the arena's wall-kick walls.
 *
 * Pure layout data + a nearest-wall probe. No three, no Rapier: game.ts
 * feeds the same boxes to PhysicsWorld.addBox (colliders) and the scene
 * builder (meshes), and runs `nearestWall` every sim step to populate
 * FighterSimWorld.wall — without that probe wallKick/STYLE_WALLKICK stay
 * unreachable in production (Task 14 review P1, hard carry into T17).
 *
 * Boxes are axis-aligned (PhysicsWorld.addBox has no rotation) and stand on
 * the analytic terrain: `makeBox` raises each center by heightAt so the
 * collider, the mesh, and the probe agree on where the rock is.
 */
import { heightAt } from './terrain';
import { WALL_KICK_MIN_HEIGHT_M } from '../data/tuning';

/** One static boulder box: center + half-extents in world space. */
export interface WallBox {
  center: { x: number; y: number; z: number };
  halfExtents: { x: number; y: number; z: number };
}

/** Nearest-wall query result — shape-compatible with FighterSimWorld['wall']. */
export interface WallProbe {
  /** Distance (m) from the query point to the nearest box surface. */
  proximityM: number;
  /** Unit ground-plane vector pointing AWAY from that surface. */
  awayX: number;
  awayZ: number;
}

/** Box standing on the terrain at (cx, cz); (hx, hy, hz) are half-extents. */
function makeBox(cx: number, cz: number, hx: number, hy: number, hz: number): WallBox {
  return {
    center: { x: cx, y: heightAt(cx, cz) + hy, z: cz },
    halfExtents: { x: hx, y: hy, z: hz },
  };
}

/**
 * Three clusters of 2–4 boulders (brief Task 17), every box ≥1.6m tall.
 * Placed 10–25m out so both spawn points (player at origin, dummy at
 * (0, -3)) and the wolf's patrol ring stay clear.
 */
export const BOULDER_CLUSTERS: readonly (readonly WallBox[])[] = [
  // West of the dummy spawn — the "home" wall-kick wall.
  [
    makeBox(-10, -6, 1.2, 0.9, 0.6),
    makeBox(-8.2, -7.6, 0.8, 1.1, 0.7),
    makeBox(-11.8, -7.9, 1.0, 0.8, 0.5),
  ],
  // East field.
  [
    makeBox(12, -14, 1.3, 1.2, 0.65),
    makeBox(14.2, -12.4, 0.9, 0.85, 0.6),
  ],
  // South rim — four-stone pile.
  [
    makeBox(-5, -21, 1.1, 0.9, 0.7),
    makeBox(-3.1, -22.3, 0.7, 1.0, 0.6),
    makeBox(-7.2, -22.8, 0.9, 0.8, 0.55),
    makeBox(-4.6, -23.9, 0.6, 0.9, 0.5),
  ],
];

/** Flattened box list — the per-step probe iterates this. */
export const BOULDER_WALLS: readonly WallBox[] = BOULDER_CLUSTERS.flat();

/**
 * Nearest wall-kickable boulder face to `pos` (ground-plane test). Writes
 * the proximity + away-direction into `out` and returns true, or returns
 * false (out untouched) when there are no walls at all (open field).
 *
 * Boxes shorter than WALL_KICK_MIN_HEIGHT_M are skipped — you cannot kick
 * off a knee-high stone. A point inside a footprint resolves to the
 * nearest face with its outward normal, so a fighter wedged against/into a
 * boulder still gets a sane launch direction.
 */
export function nearestWall(
  pos: { x: number; z: number },
  boxes: readonly WallBox[],
  out: WallProbe,
): boolean {
  let bestD2 = Infinity;
  let bestAx = 0;
  let bestAz = 0;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.halfExtents.y * 2 < WALL_KICK_MIN_HEIGHT_M) continue; // too low to kick off

    const minX = b.center.x - b.halfExtents.x;
    const maxX = b.center.x + b.halfExtents.x;
    const minZ = b.center.z - b.halfExtents.z;
    const maxZ = b.center.z + b.halfExtents.z;

    // Closest point on the footprint; a point inside clamps to itself.
    const qx = pos.x < minX ? minX : pos.x > maxX ? maxX : pos.x;
    const qz = pos.z < minZ ? minZ : pos.z > maxZ ? maxZ : pos.z;
    const dx = pos.x - qx;
    const dz = pos.z - qz;
    const d2 = dx * dx + dz * dz;

    if (d2 < bestD2) {
      if (d2 > 1e-12) {
        // Outside: away = from surface point toward the fighter.
        const inv = 1 / Math.sqrt(d2);
        bestD2 = d2;
        bestAx = dx * inv;
        bestAz = dz * inv;
      } else {
        // Inside the footprint: nearest face's outward normal pushes out.
        const faces = [
          { d: pos.x - minX, ax: -1, az: 0 },
          { d: maxX - pos.x, ax: 1, az: 0 },
          { d: pos.z - minZ, az: -1, ax: 0 },
          { d: maxZ - pos.z, az: 1, ax: 0 },
        ];
        let near = faces[0];
        for (let f = 1; f < 4; f++) if (faces[f].d < near.d) near = faces[f];
        bestD2 = 0;
        bestAx = near.ax;
        bestAz = near.az;
      }
    }
  }

  if (bestD2 === Infinity) return false;
  out.proximityM = Math.sqrt(bestD2);
  out.awayX = bestAx;
  out.awayZ = bestAz;
  return true;
}
