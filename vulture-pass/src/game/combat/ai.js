// Enemy AI (D8). Archetypes compute throttle/steer for the shared driving
// model and request shots through their weapon cycle. All randomness comes
// from the battle-seeded rng so combat stays deterministic.

import { enemyWeapons } from '../data/content.js';

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function steerTo(enemy, tx, tz, gain = 2.4) {
  const desired = Math.atan2(tz - enemy.z, tx - enemy.x);
  let diff = desired - enemy.heading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  enemy.drive.steer = clamp(diff * gain, -1, 1);
  return Math.abs(diff);
}

// Nudge steering away from obstacles in front of the car.
function avoidObstacles(combat, enemy) {
  const fx = Math.cos(enemy.heading);
  const fz = Math.sin(enemy.heading);
  const px = enemy.x + fx * (enemy.radius + 6);
  const pz = enemy.z + fz * (enemy.radius + 6);
  for (const o of combat.obstacles) {
    if (px > o.minX - 2 && px < o.maxX + 2 && pz > o.minZ - 2 && pz < o.maxZ + 2) {
      const cx = (o.minX + o.maxX) / 2 - enemy.x;
      const cz = (o.minZ + o.maxZ) / 2 - enemy.z;
      const side = fx * cz - fz * cx; // obstacle on left (+) or right (-)
      enemy.drive.steer = clamp(enemy.drive.steer + (side > 0 ? -0.9 : 0.9), -1, 1);
      return;
    }
  }
}

// Shared enemy shooting: ray at the player with archetype spread.
export function enemyFire(combat, enemy) {
  if (enemy.reloadLeft > 0) return;
  const def = enemyWeapons[enemy.weapon];
  const player = combat.player;
  const dx = player.x - enemy.x;
  const dz = player.z - enemy.z;
  const dist = Math.hypot(dx, dz);
  if (dist > def.range) return;
  const jitter = ((def.spreadDeg * Math.PI) / 180) * (enemy.aimWobble ?? 1);
  const a = Math.atan2(dz, dx) + combat.rng.range(-jitter, jitter);
  const dirX = Math.cos(a);
  const dirZ = Math.sin(a);
  const shots = def.kind === 'burst' ? def.burst : 1;
  // burst enemies resolve the whole burst as spaced ray volleys over their cycle
  for (let i = 0; i < shots; i++) {
    if (i > 0) {
      const a2 = a + combat.rng.range(-jitter, jitter) * 0.6;
      const rdirX = Math.cos(a2);
      const rdirZ = Math.sin(a2);
      const hit = combat.castRay(enemy.x, enemy.z, rdirX, rdirZ, def.range, enemy);
      combat.spawnTracer(enemy.x, enemy.z, hit ? hit.x : enemy.x + rdirX * def.range, hit ? hit.z : enemy.z + rdirZ * def.range);
      if (hit?.entity) combat.applyDamage(hit.entity, def.damage, enemy);
    } else {
      const hit = combat.castRay(enemy.x, enemy.z, dirX, dirZ, def.range, enemy);
      combat.spawnTracer(enemy.x, enemy.z, hit ? hit.x : enemy.x + dirX * def.range, hit ? hit.z : enemy.z + dirZ * def.range);
      if (hit?.entity) combat.applyDamage(hit.entity, def.damage, enemy);
    }
  }
  combat.sfx(def.kind === 'burst' ? 'mgShot' : 'pistol');
  enemy.reloadLeft = def.reload;
}

// ------------------------------------------------------------ scout
// Orbits at mid-range taking pistol pot-shots.
export function scoutUpdate(combat, enemy, dt) {
  const player = combat.player;
  const R = enemy.ai.orbitRadius ?? 16;
  const toX = player.x - enemy.x;
  const toZ = player.z - enemy.z;
  const dist = Math.hypot(toX, toZ) || 1;
  const nx = toX / dist;
  const nz = toZ / dist;

  if (dist > R + 10) {
    steerTo(enemy, player.x, player.z);
    enemy.drive.throttle = 1;
  } else {
    // orbit tangent blended with ring-distance correction
    const dir = enemy.ai.orbitDir;
    const tx = -nz * dir;
    const tz = nx * dir;
    const corr = clamp((dist - R) * 0.35, -1, 1);
    const gx = enemy.x + (tx * 8 + nx * corr * 6);
    const gz = enemy.z + (tz * 8 + nz * corr * 6);
    steerTo(enemy, gx, gz);
    enemy.drive.throttle = dist < R * 0.5 ? 0.55 : 0.85;
  }
  avoidObstacles(combat, enemy);
  enemyFire(combat, enemy);
}

// ------------------------------------------------------------ bruiser
// Heavy pressure: charges the player with slight lead, shotgun when close.
// Slow turn rate means committed lanes and wide U-turns.
export function bruiserUpdate(combat, enemy, dt) {
  const player = combat.player;
  const lead = 0.45; // seconds of player velocity to lead
  const tx = player.x + player.vx * lead;
  const tz = player.z + player.vz * lead;
  const dist = Math.hypot(player.x - enemy.x, player.z - enemy.z);

  steerTo(enemy, tx, tz, 1.6);
  enemy.drive.throttle = dist < 6 ? 0.8 : 1;
  avoidObstacles(combat, enemy);
  if (dist < 15) enemyFire(combat, enemy);
}

// ------------------------------------------------------------ gunner
// Keeps a firing lane at range: approaches if far, strafes if in the band,
// flees if crowded. MG bursts on cycle.
export function gunnerUpdate(combat, enemy, dt) {
  const player = combat.player;
  const toX = player.x - enemy.x;
  const toZ = player.z - enemy.z;
  const dist = Math.hypot(toX, toZ) || 1;
  const nx = toX / dist;
  const nz = toZ / dist;
  const near = 24;
  const far = 34;

  if (dist > far) {
    steerTo(enemy, player.x, player.z);
    enemy.drive.throttle = 1;
  } else if (dist < near) {
    // flee directly away, no shooting while running
    steerTo(enemy, enemy.x - nx * 20, enemy.z - nz * 20, 2.0);
    enemy.drive.throttle = 1;
  } else {
    // circle the band, throttle modulated to hold range
    const dir = enemy.ai.orbitDir;
    const tx = -nz * dir;
    const tz = nx * dir;
    const corr = clamp((dist - (near + far) / 2) * 0.25, -1, 1);
    steerTo(enemy, enemy.x + (tx * 10 + nx * corr * 8), enemy.z + (tz * 10 + nz * corr * 8), 2.2);
    enemy.drive.throttle = 0.7;
  }
  avoidObstacles(combat, enemy);
  if (dist >= near - 2) enemyFire(combat, enemy);
}

export const archetypes = {
  scout: scoutUpdate,
  bruiser: bruiserUpdate,
  gunner: gunnerUpdate,
};
