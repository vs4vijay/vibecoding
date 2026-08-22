import * as THREE from "three";
import { getPoint, getTangent, type Vec2 } from "./spline";
import { applySpeedBoost, type TankState } from "./tank";
import type { World } from "./game";

// ---------------------------------------------------------------------------
// Tuning (spec Phase 3)
// ---------------------------------------------------------------------------

/** Crate t-values come from the TrackDef; alternate road sides per crate. */
const CRATE_LATERALS = [-2.5, 2.5, -2.5, 2.5];
const RESPAWN_DELAY = 8; // seconds after pickup before the crate returns
const PICKUP_RADIUS_SQ = 2.4 * 2.4;
const FLOAT_HEIGHT = 1.6;

const BOOST_MULTIPLIER = 1.4;
const BOOST_DURATION = 5;
const TRIPLE_CHARGES = 3;

// ---------------------------------------------------------------------------
// Crate visuals — shared geometry/materials across all crates
// ---------------------------------------------------------------------------

const crateGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
const crateMat = new THREE.MeshLambertMaterial({ color: 0xb07a35 });
const bandGeo = new THREE.BoxGeometry(1.78, 0.28, 1.78);
const bandMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });

interface Crate {
  x: number;
  z: number;
  mesh: THREE.Group;
  active: boolean;
  respawnTimer: number;
  phase: number; // bob/rotate phase offset so crates don't move in lockstep
}

export interface Powerups {
  /** Once per frame: crate spin/bob, pickups by any tank, shield bubbles. */
  update(world: World, dt: number): void;
  /** Full reset for race restart: all crates active, bubbles hidden. */
  reset(): void;
  /** Remove all crate meshes from the scene (track switch). */
  dispose(): void;
}

/** Optional audio callback wired up by game.ts (Phase 5). */
export interface PowerupHooks {
  onPickup?(tank: TankState, kind: "boost" | "shield" | "triple"): void;
}

export function createPowerups(
  scene: THREE.Scene,
  points: Vec2[],
  crateTs: number[],
  hooks: PowerupHooks = {},
): Powerups {
  const crates: Crate[] = [];
  for (let i = 0; i < crateTs.length; i++) {
    const p = getPoint(points, crateTs[i]);
    const tan = getTangent(points, crateTs[i]);
    const len = Math.hypot(tan.x, tan.z) || 1;
    const nx = tan.z / len; // right-hand normal in XZ
    const nz = -tan.x / len;
    const off = CRATE_LATERALS[i % CRATE_LATERALS.length];
    const x = p.x + nx * off;
    const z = p.z + nz * off;

    const mesh = new THREE.Group();
    const box = new THREE.Mesh(crateGeo, crateMat);
    box.castShadow = true;
    mesh.add(box);
    // Cross bands so it reads as a crate
    const bandH = new THREE.Mesh(bandGeo, bandMat);
    bandH.rotation.y = Math.PI / 4;
    mesh.add(bandH);

    mesh.position.set(x, FLOAT_HEIGHT, z);
    scene.add(mesh);
    crates.push({ x, z, mesh, active: true, respawnTimer: 0, phase: i * 1.7 });
  }

  // --- Shield bubble per tank (Map so reset() can hide them all) --------------
  const bubbleGeo = new THREE.SphereGeometry(3.1, 14, 10);
  const bubbles = new Map<TankState, THREE.Mesh>();
  function bubbleFor(tank: TankState): THREE.Mesh {
    let b = bubbles.get(tank);
    if (!b) {
      b = new THREE.Mesh(
        bubbleGeo,
        new THREE.MeshBasicMaterial({
          color: 0x41d9ff,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        }),
      );
      b.position.y = 1.8;
      b.visible = false;
      tank.mesh.root.add(b);
      bubbles.set(tank, b);
    }
    return b;
  }

  /** Random pickup: Speed Boost / Shield / Triple-Shot (equal odds). */
  function grantRandomPickup(tank: TankState): "boost" | "shield" | "triple" {
    const roll = Math.floor(Math.random() * 3);
    if (roll === 0) {
      applySpeedBoost(tank, BOOST_MULTIPLIER, BOOST_DURATION); // auto-consumed
      return "boost";
    }
    if (roll === 1) {
      tank.shield = true;
      return "shield";
    }
    tank.tripleShots = TRIPLE_CHARGES;
    return "triple";
  }

  function update(world: World, dt: number): void {
    const time = performance.now() / 1000;

    // --- Crates: animate, respawn, detect pickups ---------------------------
    for (const crate of crates) {
      if (!crate.active) {
        crate.respawnTimer -= dt;
        if (crate.respawnTimer <= 0) {
          crate.active = true;
          crate.mesh.visible = true;
        }
        continue;
      }
      crate.mesh.rotation.y += dt * 1.5;
      crate.mesh.position.y =
        FLOAT_HEIGHT + Math.sin(time * 2 + crate.phase) * 0.25;

      // Any tank driving over the crate picks it up
      for (const tank of world.tanks) {
        if (tank.wreckTimer > 0) continue;
        const dx = tank.position.x - crate.x;
        const dz = tank.position.z - crate.z;
        if (dx * dx + dz * dz <= PICKUP_RADIUS_SQ) {
          const kind = grantRandomPickup(tank);
          hooks.onPickup?.(tank, kind);
          crate.active = false;
          crate.mesh.visible = false;
          crate.respawnTimer = RESPAWN_DELAY;
          break;
        }
      }
    }

    // --- Sync shield bubble visuals ------------------------------------------
    for (const tank of world.tanks) {
      if (!tank.shield) continue;
      const b = bubbleFor(tank);
      b.visible = true;
      b.rotation.y += dt * 0.8;
    }
    // Hide bubbles whose shield was consumed (weapons.ts clears tank.shield)
    for (const tank of world.tanks) {
      if (tank.shield) continue;
      const b = bubbles.get(tank);
      if (b && b.visible) b.visible = false;
    }
  }

  function reset(): void {
    for (const crate of crates) {
      crate.active = true;
      crate.respawnTimer = 0;
      crate.mesh.visible = true;
    }
    for (const b of bubbles.values()) b.visible = false;
  }

  function dispose(): void {
    for (const crate of crates) scene.remove(crate.mesh);
  }

  return { update, reset, dispose };
}
