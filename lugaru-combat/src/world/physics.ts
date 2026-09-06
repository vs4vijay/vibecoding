/**
 * Task 12 — Rapier physics world.
 *
 * Owns the Rapier engine instance and the terrain collider. Active fighters
 * stay analytic (src/combat, src/actors/controller); Rapier exists here for
 * cosmetic dynamics only: ragdolls, thrown knives, dropped weapons. The raw
 * engine handle is exposed so those modules share one body pool.
 *
 * Terrain: the analytic `heightAt` (src/world/terrain.ts) is sampled onto a
 * 64×64-cell grid covering the same 120m plane as the visual mesh
 * (buildTerrainMesh's 128×128-segment plane, also 120m) and handed to Rapier
 * as an explicit TRIANGLE MESH. A heightfield collider was tried first and
 * is unusable in rapier3d-compat 0.19.3 — contacts pass through it
 * non-deterministically even on a flat field. The trimesh is exact,
 * deterministic, and built from the same sampled heights `castGround`
 * interpolates, so gameplay queries match what bodies collide with
 * (triangles are planar per cell; bilinear vs planar differs by <1cm on
 * this terrain's curvature).
 *
 * Rapier WASM init is async: `PhysicsWorld.create` awaits `RAPIER.init()`
 * once per process (idempotent), so callers must await creation before
 * first use — the Game documents this init-before-start pattern.
 */
import * as RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY } from '../data/tuning';

/** Cells per axis of the physics heightfield (brief: 64×64). */
export const TERRAIN_GRID = 64;
/** World extent of the heightfield in metres (matches the visual plane). */
export const TERRAIN_SIZE = 120;

const HALF = TERRAIN_SIZE / 2;
const CELL = TERRAIN_SIZE / TERRAIN_GRID;
/** Friction shared by terrain and sandbox boxes. */
const TERRAIN_FRICTION = 0.7;

export class PhysicsWorld {
  /**
   * Shared engine handle — ragdoll / projectiles / drops create and remove
   * rigid bodies through it (single body pool per world).
   */
  readonly raw: RAPIER.World;

  /** Sampled heights, `heights[(gridZ + 1) * index + gridX]`. */
  private readonly heights: Float32Array;

  private constructor(raw: RAPIER.World, heights: Float32Array) {
    this.raw = raw;
    this.heights = heights;
  }

  /** Build the world: awaits Rapier WASM init, lays down the ground. */
  static async create(heightAt: (x: number, z: number) => number): Promise<PhysicsWorld> {
    await RAPIER.init();
    const raw = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });

    // Terrain as an explicit triangle mesh over the sampled grid: vertices
    // at every grid node, two triangles per cell (gridX, gridZ indexing).
    const n = TERRAIN_GRID;
    const heights = new Float32Array((n + 1) * (n + 1));
    const verts = new Float32Array((n + 1) * (n + 1) * 3);
    for (let gz = 0; gz <= n; gz++) {
      for (let gx = 0; gx <= n; gx++) {
        const x = -HALF + gx * CELL;
        const z = -HALF + gz * CELL;
        const h = heightAt(x, z);
        heights[gz * (n + 1) + gx] = h;
        const v = (gz * (n + 1) + gx) * 3;
        verts[v] = x;
        verts[v + 1] = h;
        verts[v + 2] = z;
      }
    }
    const indices: number[] = [];
    for (let gz = 0; gz < n; gz++) {
      for (let gx = 0; gx < n; gx++) {
        const a = gz * (n + 1) + gx;
        const b = a + 1;
        const c = a + (n + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const ground = RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(indices))
      .setFriction(TERRAIN_FRICTION);
    raw.createCollider(ground, raw.createRigidBody(RAPIER.RigidBodyDesc.fixed()));

    return new PhysicsWorld(raw, heights);
  }

  /** Advance the simulation by `dtSec` seconds (fixed-step from the caller). */
  step(dtSec: number): void {
    this.raw.timestep = dtSec;
    this.raw.step();
  }

  /**
   * Terrain surface height at (x, z) as the physics field sees it —
   * bilinear interpolation of the 64×64 heightfield, clamped to its extent.
   */
  castGround(x: number, z: number): number {
    const n = TERRAIN_GRID;
    const fx = (x + HALF) / CELL;
    const fz = (z + HALF) / CELL;
    const gx = Math.max(0, Math.min(n - 1, Math.floor(fx)));
    const gz = Math.max(0, Math.min(n - 1, Math.floor(fz)));
    const tx = Math.max(0, Math.min(1, fx - gx));
    const tz = Math.max(0, Math.min(1, fz - gz));
    const s = n + 1;
    const h00 = this.heights[gz * s + gx];
    const h10 = this.heights[gz * s + gx + 1];
    const h01 = this.heights[(gz + 1) * s + gx];
    const h11 = this.heights[(gz + 1) * s + gx + 1];
    return (1 - tx) * (1 - tz) * h00 + tx * (1 - tz) * h10 + (1 - tx) * tz * h01 + tx * tz * h11;
  }

  /** Add a static obstacle box (sandbox props, walls). */
  addBox(
    center: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number },
  ): void {
    const body = this.raw.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
    );
    const box = RAPIER.ColliderDesc.cuboid(
      halfExtents.x,
      halfExtents.y,
      halfExtents.z,
    ).setFriction(TERRAIN_FRICTION);
    this.raw.createCollider(box, body);
  }
}