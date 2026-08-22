import * as THREE from "three";
import {
  SHELL_DAMAGE,
  type TankState,
} from "./tank";
import { placeTankAtProgress } from "./track";
import type { World } from "./game";

// ---------------------------------------------------------------------------
// Tuning (spec Phase 3)
// ---------------------------------------------------------------------------

const SHELL_SPEED = 80; // u/s
const SHELL_LIFETIME = 2; // seconds
const SHELL_RADIUS = 0.35;
const HIT_RADIUS_SQ = 2.3 * 2.3; // shell-vs-tank hit distance (XZ)
const SPIN_DURATION = 1; // spin-out time after a hit
const WRECK_DURATION = 3; // immobile wreck time before respawn
const RESPAWN_INVULN = 2; // grace period after respawning
const TRIPLE_SPREAD = 0.12; // rad between the 3 spread shells
/** Barrel tip offset in tank-local space (barrel reaches ~z=3.4, y≈2.25). */
const MUZZLE_Z = 3.5;
const MUZZLE_Y = 2.2;

const WRECK_COLOR = 0x23231f;

// ---------------------------------------------------------------------------
// Shell visuals — shared geometry/materials, no per-shell lights
// ---------------------------------------------------------------------------

const shellGeo = new THREE.SphereGeometry(SHELL_RADIUS, 8, 6);
const shellMat = new THREE.MeshBasicMaterial({ color: 0xffcc44 });
const ghostGeo = new THREE.SphereGeometry(0.22, 6, 4);
const ghostMat = new THREE.MeshBasicMaterial({
  color: 0xff8830,
  transparent: true,
  opacity: 0.55,
});
const smokeGeo = new THREE.SphereGeometry(0.9, 7, 5);
const smokeMat = new THREE.MeshLambertMaterial({ color: 0x555550 });

interface Shell {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  owner: TankState;
  age: number;
}

/** Fading trail ghost / rising smoke puff (scale-down fade keeps it cheap). */
interface Puff {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  grow: number; // scale change per second (smoke grows, ghosts shrink)
  rise: number; // upward drift (u/s)
}

export interface Weapons {
  /** Fire if off cooldown and not wrecked. Handles triple-shot charges. */
  tryFire(tank: TankState): void;
  /** Advance shells, puffs, wreck visuals + respawn logic. Once per frame. */
  update(world: World, dt: number): void;
  /** Full reset for race restart: clear shells/puffs, restore wrecked tanks. */
  reset(world: World): void;
}

/** Optional audio/juice callbacks wired up by game.ts (Phase 5). */
export interface WeaponsHooks {
  onShot?(shooter: TankState): void;
  onHit?(target: TankState): void;
  onWreck?(target: TankState): void;
}

export function createWeapons(scene: THREE.Scene, hooks: WeaponsHooks = {}): Weapons {
  const shells: Shell[] = [];
  const puffs: Puff[] = [];
  /** Tanks whose wreck visuals are currently applied. */
  const wrecksApplied = new WeakSet<TankState>();
  let ghostTimer = 0;
  let smokeTimer = 0;

  function spawnShell(owner: TankState, yawOffset: number): void {
    const dir = new THREE.Vector3(
      Math.sin(owner.heading + yawOffset),
      0,
      Math.cos(owner.heading + yawOffset),
    );
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.position.set(
      owner.position.x + dir.x * MUZZLE_Z,
      MUZZLE_Y,
      owner.position.z + dir.z * MUZZLE_Z,
    );
    scene.add(mesh);
    shells.push({ mesh, vel: dir.multiplyScalar(SHELL_SPEED), owner, age: 0 });
  }

  function tryFire(tank: TankState): void {
    if (tank.wreckTimer > 0 || tank.fireCooldown > 0) return;
    tank.fireCooldown = tank.fireCooldownMax; // Phase 7: per-tank cadence
    hooks.onShot?.(tank);
    if (tank.tripleShots > 0) {
      tank.tripleShots -= 1;
      spawnShell(tank, -TRIPLE_SPREAD);
      spawnShell(tank, 0);
      spawnShell(tank, TRIPLE_SPREAD);
    } else {
      spawnShell(tank, 0);
    }
  }

  function addPuff(
    x: number,
    y: number,
    z: number,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    life: number,
    startScale: number,
    grow: number,
    rise: number,
  ): void {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(startScale);
    scene.add(mesh);
    puffs.push({ mesh, age: 0, life, grow, rise });
  }

  /** Apply damage / spin-out / shield absorption to a hit tank. */
  function applyHit(target: TankState): void {
    if (target.invulnTimer > 0 || target.wreckTimer > 0) return;
    if (target.shield) {
      target.shield = false; // bubble absorbs the shell (bubble visual synced in powerups.ts)
      return;
    }
    target.hp -= SHELL_DAMAGE;
    target.spinTimer = SPIN_DURATION;
    target.spinDir = Math.random() < 0.5 ? -1 : 1;
    if (target.hp <= 0) {
      target.hp = 0;
      target.wreckTimer = WRECK_DURATION;
      target.tripleShots = 0;
      hooks.onWreck?.(target);
    }
  }

  function applyWreckVisuals(tank: TankState): void {
    for (const mat of tank.mesh.bodyMaterials) mat.color.setHex(WRECK_COLOR);
    // Tilted barrel: pitch the turret back like a dead tank
    tank.mesh.turret.rotation.x = -0.55;
    wrecksApplied.add(tank);
  }

  function restoreVisuals(tank: TankState): void {
    tank.mesh.bodyMaterials.forEach((mat, i) =>
      mat.color.setHex(tank.mesh.bodyColors[i]),
    );
    tank.mesh.turret.rotation.x = 0;
    wrecksApplied.delete(tank);
  }

  function respawn(tank: TankState, world: World): void {
    const racer = world.racers.find((r) => r.tank === tank);
    const t = racer ? racer.progress.lastCheckpointT : 0.005;
    placeTankAtProgress(tank, world.track, t);
    tank.hp = tank.maxHp; // Phase 7: per-tank max HP
    tank.spinTimer = 0;
    tank.invulnTimer = RESPAWN_INVULN;
    restoreVisuals(tank);
  }

  function update(world: World, dt: number): void {
    // --- Wreck state transitions --------------------------------------------
    for (const tank of world.tanks) {
      if (tank.wreckTimer > 0 && !wrecksApplied.has(tank)) {
        applyWreckVisuals(tank);
      }
      // Smoke while wrecked
      if (tank.wreckTimer > 0) {
        smokeTimer -= dt;
        if (smokeTimer <= 0) {
          smokeTimer = 0.35;
          addPuff(
            tank.position.x,
            2.6,
            tank.position.z,
            smokeGeo,
            smokeMat,
            1.1,
            0.35,
            0.9,
            1.6,
          );
        }
      }
      // Physics brought wreckTimer to 0 with hp still 0 → respawn now
      if (tank.hp <= 0 && tank.wreckTimer <= 0 && wrecksApplied.has(tank)) {
        respawn(tank, world);
      }
    }

    // --- Move shells + hit tests ---------------------------------------------
    ghostTimer -= dt;
    const dropGhost = ghostTimer <= 0;
    if (dropGhost) ghostTimer = 0.03;

    for (let i = shells.length - 1; i >= 0; i--) {
      const shell = shells[i];
      shell.age += dt;
      const step = shell.vel.clone().multiplyScalar(dt);
      shell.mesh.position.add(step);

      // Cheap trail: drop a fading ghost every few frames
      if (dropGhost) {
        addPuff(
          shell.mesh.position.x,
          shell.mesh.position.y,
          shell.mesh.position.z,
          ghostGeo,
          ghostMat,
          0.28,
          1,
          -3,
          0,
        );
      }

      let dead = shell.age >= SHELL_LIFETIME;
      if (!dead) {
        // Shells never hit their shooter (spec: keep it simple)
        for (const tank of world.tanks) {
          if (tank === shell.owner) continue;
          const dx = tank.position.x - shell.mesh.position.x;
          const dz = tank.position.z - shell.mesh.position.z;
          if (dx * dx + dz * dz <= HIT_RADIUS_SQ) {
            applyHit(tank);
            hooks.onHit?.(tank);
            dead = true;
            break;
          }
        }
      }

      if (dead) {
        scene.remove(shell.mesh);
        shells.splice(i, 1);
      }
    }

    // --- Fade puffs ------------------------------------------------------------
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        scene.remove(p.mesh);
        puffs.splice(i, 1);
        continue;
      }
      p.mesh.position.y += p.rise * dt;
      p.mesh.scale.addScalar(p.grow * dt);
      if (p.mesh.scale.x <= 0.01) p.mesh.scale.setScalar(0.01);
    }
  }

  function reset(world: World): void {
    // Clear live shells + puffs so nothing survives a restart
    for (const shell of shells) scene.remove(shell.mesh);
    shells.length = 0;
    for (const puff of puffs) scene.remove(puff.mesh);
    puffs.length = 0;
    // Undo wreck visuals on any tank still showing them
    for (const tank of world.tanks) {
      if (wrecksApplied.has(tank)) restoreVisuals(tank);
    }
  }

  return { tryFire, update, reset };
}


