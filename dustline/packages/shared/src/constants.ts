import type { WeaponType, MapData, Vec3 } from './types.js';

export const TICK_RATE = 60;
export const TICK_INTERVAL_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 30;
export const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_RATE;

export const MAX_PLAYERS = 16;
export const WARMUP_DURATION_MS = 30000;
export const MATCH_DURATION_MS = 120000;
export const ROUND_END_DURATION_MS = 5000;

export const PLAYER_SPEED = 5.5;
export const PLAYER_WALK_SPEED = 2.5;
export const PLAYER_JUMP_FORCE = 8;
export const PLAYER_GRAVITY = 20;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.3;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_MAX_ARMOR = 100;

export const WEAPONS: Record<string, WeaponType> = {
  ak47: {
    id: 'ak47',
    name: 'AK-47',
    damage: 36,
    fireRate: 100,
    reloadTime: 2500,
    magazineSize: 30,
    totalAmmo: 90,
    range: 100,
    spread: 0.02,
    automatic: true,
  },
  glock: {
    id: 'glock',
    name: 'Glock-18',
    damage: 20,
    fireRate: 150,
    reloadTime: 1500,
    magazineSize: 20,
    totalAmmo: 120,
    range: 50,
    spread: 0.015,
    automatic: false,
  },
};

export const DEFAULT_MAP: MapData = {
  name: 'de_dust',
  spawnPoints: [
    // T spawns
    { team: 'T', position: { x: -15, y: 0.9, z: -15 }, rotation: { x: 0, y: 0 } },
    { team: 'T', position: { x: -13, y: 0.9, z: -17 }, rotation: { x: 0, y: 0 } },
    { team: 'T', position: { x: -17, y: 0.9, z: -13 }, rotation: { x: 0, y: 0 } },
    { team: 'T', position: { x: -15, y: 0.9, z: -19 }, rotation: { x: 0, y: 0 } },
    { team: 'T', position: { x: -19, y: 0.9, z: -15 }, rotation: { x: 0, y: 0 } },
    { team: 'T', position: { x: -11, y: 0.9, z: -15 }, rotation: { x: 0, y: 0 } },
    { team: 'T', position: { x: -15, y: 0.9, z: -11 }, rotation: { x: 0, y: 0 } },
    { team: 'T', position: { x: -13, y: 0.9, z: -13 }, rotation: { x: 0, y: 0 } },
    // CT spawns
    { team: 'CT', position: { x: 15, y: 0.9, z: 15 }, rotation: { x: Math.PI, y: 0 } },
    { team: 'CT', position: { x: 13, y: 0.9, z: 17 }, rotation: { x: Math.PI, y: 0 } },
    { team: 'CT', position: { x: 17, y: 0.9, z: 13 }, rotation: { x: Math.PI, y: 0 } },
    { team: 'CT', position: { x: 15, y: 0.9, z: 19 }, rotation: { x: Math.PI, y: 0 } },
    { team: 'CT', position: { x: 19, y: 0.9, z: 15 }, rotation: { x: Math.PI, y: 0 } },
    { team: 'CT', position: { x: 11, y: 0.9, z: 15 }, rotation: { x: Math.PI, y: 0 } },
    { team: 'CT', position: { x: 15, y: 0.9, z: 11 }, rotation: { x: Math.PI, y: 0 } },
    { team: 'CT', position: { x: 13, y: 0.9, z: 13 }, rotation: { x: Math.PI, y: 0 } },
  ],
  entities: [
    // Ground
    { id: 'ground', type: 'floor', position: { x: 0, y: 0, z: 0 }, size: { x: 60, y: 0.2, z: 60 } },
    // Outer walls
    { id: 'wall-north', type: 'wall', position: { x: 0, y: 2, z: -30 }, size: { x: 60, y: 4, z: 0.5 } },
    { id: 'wall-south', type: 'wall', position: { x: 0, y: 2, z: 30 }, size: { x: 60, y: 4, z: 0.5 } },
    { id: 'wall-east', type: 'wall', position: { x: 30, y: 2, z: 0 }, size: { x: 0.5, y: 4, z: 60 } },
    { id: 'wall-west', type: 'wall', position: { x: -30, y: 2, z: 0 }, size: { x: 0.5, y: 4, z: 60 } },
    // Central cover - large box
    { id: 'box-center', type: 'box', position: { x: 0, y: 1.5, z: 0 }, size: { x: 4, y: 3, z: 4 } },
    // T side cover
    { id: 'box-t1', type: 'box', position: { x: -10, y: 1, z: -10 }, size: { x: 3, y: 2, z: 3 } },
    { id: 'box-t2', type: 'box', position: { x: -5, y: 0.5, z: -15 }, size: { x: 2, y: 1, z: 2 } },
    { id: 'wall-t1', type: 'wall', position: { x: -8, y: 1, z: -5 }, size: { x: 0.5, y: 2, z: 6 } },
    // CT side cover
    { id: 'box-ct1', type: 'box', position: { x: 10, y: 1, z: 10 }, size: { x: 3, y: 2, z: 3 } },
    { id: 'box-ct2', type: 'box', position: { x: 5, y: 0.5, z: 15 }, size: { x: 2, y: 1, z: 2 } },
    { id: 'wall-ct1', type: 'wall', position: { x: 8, y: 1, z: 5 }, size: { x: 0.5, y: 2, z: 6 } },
    // Mid cover
    { id: 'box-mid1', type: 'box', position: { x: -5, y: 0.5, z: 5 }, size: { x: 2, y: 1, z: 2 } },
    { id: 'box-mid2', type: 'box', position: { x: 5, y: 0.5, z: -5 }, size: { x: 2, y: 1, z: 2 } },
    { id: 'wall-mid', type: 'wall', position: { x: 0, y: 1, z: 8 }, size: { x: 10, y: 2, z: 0.5 } },
  ],
  skyColor: '#87CEEB',
  ambientLight: 0.6,
};

export function createDefaultWeaponState(typeId: string) {
  const weapon = WEAPONS[typeId];
  if (!weapon) return null;
  return {
    typeId,
    ammoInMagazine: weapon.magazineSize,
    ammoInReserve: weapon.totalAmmo,
    isReloading: false,
    lastFireTime: 0,
    reloadStartTime: 0,
  };
}
