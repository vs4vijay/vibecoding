// Dual-side weapon mounts (D9 — the signature mechanic).
//
// Aim direction vs. car heading: the sign of the 2D cross product picks which
// mount fires. Aim left of heading → left mount; right → right mount. One aim
// point, both mounts always visible in the HUD. Ammo is unlimited; reload
// cycles gate refiring (spec).

import { weapons } from '../data/content.js';

// 2D cross(heading, aimDir) in the (x, z) plane.
// Verified geometry (see qa/units/mounts.test.mjs): with heading north
// (fwd = (0,-1)) the car's left is west (-1,0); aiming west gives
// dot(aim, leftVec) > 0 which equals -cross, so cross < 0 means LEFT.
export function aimSide(car, aimX, aimZ) {
  const fwdX = Math.cos(car.heading);
  const fwdZ = Math.sin(car.heading);
  const dx = aimX - car.x;
  const dz = aimZ - car.z;
  const len = Math.hypot(dx, dz) || 1;
  const ax = dx / len;
  const az = dz / len;
  const cross = fwdX * az - fwdZ * ax;
  return cross < 0 ? 'left' : 'right';
}

export function leftVector(heading) {
  return { x: Math.sin(heading), z: -Math.cos(heading) };
}

// World-space muzzle position for a mount.
export function muzzlePos(car, side, out = { x: 0, z: 0 }) {
  const fwdX = Math.cos(car.heading);
  const fwdZ = Math.sin(car.heading);
  const l = leftVector(car.heading);
  const s = side === 'left' ? 1 : -1;
  out.x = car.x + fwdX * 0.5 + l.x * 1.35 * s;
  out.z = car.z + fwdZ * 0.5 + l.z * 1.35 * s;
  return out;
}

export function makeMounts(state) {
  return {
    left: { weaponId: state.mounts.left, reloadLeft: 0, burstLeft: 0, burstGap: 0, burstAim: null, burstSide: 'left' },
    right: { weaponId: state.mounts.right, reloadLeft: 0, burstLeft: 0, burstGap: 0, burstAim: null, burstSide: 'right' },
  };
}

// Attempt to fire one mount at the aim point. Returns a description of what
// happened (for HUD feedback / debug), or { ok:false, reason:'reloading' }.
export function tryFire(combat, car, mount, side, aimX, aimZ, weaponDef, reloadSeconds) {
  if (!weaponDef) return { ok: false, reason: 'empty' };
  if (mount.reloadLeft > 0) return { ok: false, reason: 'reloading' };
  if (mount.burstLeft > 0) return { ok: false, reason: 'bursting' };

  const mz = muzzlePos(car, side);
  const dx = aimX - mz.x;
  const dz = aimZ - mz.z;
  const len = Math.hypot(dx, dz) || 1;
  const dirX = dx / len;
  const dirZ = dz / len;

  if (weaponDef.kind === 'burst') {
    mount.burstLeft = weaponDef.burst;
    mount.burstGap = 0;
    mount.burstAim = { x: aimX, z: aimZ };
    mount.burstDir = { x: dirX, z: dirZ };
    mount.reloadLeft = reloadSeconds; // reload covers the whole burst
    return { ok: true, kind: 'burst-started' };
  }

  if (weaponDef.kind === 'projectile') {
    combat.spawnRocket?.(car, mz.x, mz.z, dirX, dirZ, weaponDef);
    mount.reloadLeft = reloadSeconds;
    return { ok: true, kind: 'projectile' };
  }

  fireRayWeapon(combat, car, mz, dirX, dirZ, weaponDef);
  mount.reloadLeft = reloadSeconds;
  return { ok: true, kind: weaponDef.kind };
}

// Hitscan / shotgun spread: one ray per pellet.
export function fireRayWeapon(combat, shooter, mz, dirX, dirZ, weaponDef, spreadMult = 1) {
  const pellets = weaponDef.pellets ?? 1;
  const spreadRad = ((weaponDef.spreadDeg ?? 0) * Math.PI) / 180 * spreadMult;
  for (let i = 0; i < pellets; i++) {
    const a = pellets === 1 && spreadRad === 0 ? 0 : combat.rng.range(-spreadRad, spreadRad);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rx = dirX * ca - dirZ * sa;
    const rz = dirX * sa + dirZ * ca;
    const hit = combat.castRay(mz.x, mz.z, rx, rz, weaponDef.range, shooter);
    combat.spawnTracer(mz.x, mz.z, hit ? hit.x : mz.x + rx * weaponDef.range, hit ? hit.z : mz.z + rz * weaponDef.range);
    if (hit && hit.entity) {
      combat.applyDamage(hit.entity, weaponDef.damage, shooter);
    }
  }
  combat.sfx(weaponDef.class === 'shotgun' ? 'shotgun' : weaponDef.class === 'machinegun' ? 'mgShot' : 'pistol');
}

// Tick reload + pending burst shots. Called once per sim step.
export function stepMounts(combat, car, mounts, dt, weaponDefs, reloadTimeFor) {
  for (const side of ['left', 'right']) {
    const m = mounts[side];
    if (m.reloadLeft > 0) m.reloadLeft = Math.max(0, m.reloadLeft - dt);
    if (m.burstLeft > 0) {
      m.burstGap -= dt;
      if (m.burstGap <= 0) {
        const def = weaponDefs[m.weaponId];
        fireRayWeapon(combat, car, muzzlePos(car, side), m.burstDir.x, m.burstDir.z, def);
        m.burstLeft -= 1;
        m.burstGap = def.burstGap;
      }
    }
  }
}
