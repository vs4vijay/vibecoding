import { WEAPONS, PLAYER_HEIGHT } from '@cs-clone/shared';
import type { WeaponState, Vec3, Vec2 } from '@cs-clone/shared';
import type { ServerPlayer } from './types.js';

export function canFire(weapon: WeaponState, now: number): boolean {
  const weaponType = WEAPONS[weapon.typeId];
  if (!weaponType) return false;
  if (weapon.isReloading) return false;
  if (weapon.ammoInMagazine <= 0) return false;
  if (now - weapon.lastFireTime < weaponType.fireRate) return false;
  return true;
}

export function fireWeapon(
  weapon: WeaponState,
  player: ServerPlayer,
  now: number
): { hit: boolean; hitPosition?: Vec3; direction: Vec3 } | null {
  if (!canFire(weapon, now)) return null;

  const weaponType = WEAPONS[weapon.typeId];
  if (!weaponType) return null;

  weapon.ammoInMagazine--;
  weapon.lastFireTime = now;

  // Calculate direction from rotation with spread
  const yaw = player.rotation.x;
  const pitch = player.rotation.y;
  
  const spreadX = (Math.random() - 0.5) * 2 * weaponType.spread;
  const spreadY = (Math.random() - 0.5) * 2 * weaponType.spread;

  const direction: Vec3 = {
    x: Math.sin(yaw + spreadX) * Math.cos(pitch + spreadY),
    y: Math.sin(pitch + spreadY),
    z: Math.cos(yaw + spreadX) * Math.cos(pitch + spreadY),
  };

  // Normalize
  const len = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
  direction.x /= len;
  direction.y /= len;
  direction.z /= len;

  return { hit: false, direction };
}

export function startReload(weapon: WeaponState, now: number): boolean {
  if (weapon.isReloading) return false;
  const weaponType = WEAPONS[weapon.typeId];
  if (!weaponType) return false;
  if (weapon.ammoInMagazine >= weaponType.magazineSize) return false;
  if (weapon.ammoInReserve <= 0) return false;

  weapon.isReloading = true;
  weapon.reloadStartTime = now;
  return true;
}

export function finishReload(weapon: WeaponState, now: number): boolean {
  if (!weapon.isReloading) return false;
  const weaponType = WEAPONS[weapon.typeId];
  if (!weaponType) return false;
  if (now - weapon.reloadStartTime < weaponType.reloadTime) return false;

  const needed = weaponType.magazineSize - weapon.ammoInMagazine;
  const available = Math.min(needed, weapon.ammoInReserve);
  weapon.ammoInMagazine += available;
  weapon.ammoInReserve -= available;
  weapon.isReloading = false;
  return true;
}

export function getWeaponMuzzlePosition(player: ServerPlayer): Vec3 {
  const yaw = player.rotation.x;
  const pitch = player.rotation.y;
  
  return {
    x: player.position.x + Math.sin(yaw) * 0.3,
    y: player.position.y + PLAYER_HEIGHT * 0.85,
    z: player.position.z + Math.cos(yaw) * 0.3,
  };
}
