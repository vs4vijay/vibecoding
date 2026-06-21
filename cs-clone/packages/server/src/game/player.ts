import type { Team, Vec3, Vec2, WeaponState } from '@cs-clone/shared';
import {
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_ARMOR,
  PLAYER_GRAVITY,
  PLAYER_JUMP_FORCE,
  PLAYER_SPEED,
  PLAYER_WALK_SPEED,
  PLAYER_HEIGHT,
  WEAPONS,
  createDefaultWeaponState,
  DEFAULT_MAP,
} from '@cs-clone/shared';
import type { ServerPlayer } from './types.js';
import { resolvePlayerCollision } from './collision.js';
import type { EntityState } from '@cs-clone/shared';

let nextPlayerId = 1;

export function generatePlayerId(): string {
  return `p_${nextPlayerId++}`;
}

export function createPlayer(
  username: string,
  team: Team
): ServerPlayer {
  const spawn = findSpawnPoint(team);
  
  return {
    id: generatePlayerId(),
    username,
    team,
    position: { ...spawn.position },
    rotation: { ...spawn.rotation },
    velocity: { x: 0, y: 0, z: 0 },
    health: PLAYER_MAX_HEALTH,
    armor: PLAYER_MAX_ARMOR,
    isDead: false,
    isWalking: false,
    isGrounded: true,
    primaryWeapon: createDefaultWeaponState('ak47'),
    secondaryWeapon: createDefaultWeaponState('glock'),
    currentWeaponSlot: 'primary',
    inputSeq: 0,
    stats: {
      kills: 0,
      deaths: 0,
      assists: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      damageDealt: 0,
    },
    respawnTimer: 0,
    lastInputTime: Date.now(),
    onGround: true,
  };
}

function findSpawnPoint(team: Team): { position: Vec3; rotation: Vec2 } {
  const spawns = DEFAULT_MAP.spawnPoints.filter(s => s.team === team);
  if (spawns.length === 0) {
    return { position: { x: 0, y: PLAYER_HEIGHT / 2, z: 0 }, rotation: { x: 0, y: 0 } };
  }
  return spawns[Math.floor(Math.random() * spawns.length)];
}

export function respawnPlayer(player: ServerPlayer): void {
  const spawn = findSpawnPoint(player.team);
  player.position = { ...spawn.position };
  player.rotation = { ...spawn.rotation };
  player.velocity = { x: 0, y: 0, z: 0 };
  player.health = PLAYER_MAX_HEALTH;
  player.armor = PLAYER_MAX_ARMOR;
  player.isDead = false;
  player.isWalking = false;
  player.onGround = true;
  player.primaryWeapon = createDefaultWeaponState('ak47');
  player.secondaryWeapon = createDefaultWeaponState('glock');
  player.currentWeaponSlot = 'primary';
  player.respawnTimer = 0;
}

export function processPlayerInput(
  player: ServerPlayer,
  input: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    jump: boolean;
    walk: boolean;
    yaw: number;
    pitch: number;
  },
  entities: EntityState[],
  dt: number
): void {
  if (player.isDead) return;

  player.inputSeq++;
  player.lastInputTime = Date.now();

  // Update rotation
  player.rotation.x = input.yaw;
  player.rotation.y = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, input.pitch));

  // Calculate movement direction
  const speed = input.walk ? PLAYER_WALK_SPEED : PLAYER_SPEED;
  let moveX = 0;
  let moveZ = 0;

  if (input.forward) {
    moveX += Math.sin(player.rotation.x) * speed;
    moveZ += Math.cos(player.rotation.x) * speed;
  }
  if (input.backward) {
    moveX -= Math.sin(player.rotation.x) * speed;
    moveZ -= Math.cos(player.rotation.x) * speed;
  }
  if (input.left) {
    moveX += Math.sin(player.rotation.x - Math.PI / 2) * speed;
    moveZ += Math.cos(player.rotation.x - Math.PI / 2) * speed;
  }
  if (input.right) {
    moveX += Math.sin(player.rotation.x + Math.PI / 2) * speed;
    moveZ += Math.cos(player.rotation.x + Math.PI / 2) * speed;
  }

  // Normalize diagonal movement
  if (moveX !== 0 || moveZ !== 0) {
    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (len > speed) {
      moveX = (moveX / len) * speed;
      moveZ = (moveZ / len) * speed;
    }
  }

  player.velocity.x = moveX;
  player.velocity.z = moveZ;
  player.isWalking = input.walk;

  // Jump
  if (input.jump && player.onGround) {
    player.velocity.y = PLAYER_JUMP_FORCE;
    player.onGround = false;
  }

  // Gravity
  if (!player.onGround) {
    player.velocity.y -= PLAYER_GRAVITY * dt;
  }

  // Apply physics and collision
  const result = resolvePlayerCollision(player.position, player.velocity, entities, dt);
  player.position = result.position;
  player.velocity = result.velocity;
  player.onGround = result.onGround;

  // Keep player above ground minimum
  if (player.position.y < PLAYER_HEIGHT / 2) {
    player.position.y = PLAYER_HEIGHT / 2;
    player.velocity.y = 0;
    player.onGround = true;
  }
}

export function damagePlayer(player: ServerPlayer, damage: number): void {
  if (player.isDead) return;

  // Armor absorbs 66% of damage when available
  let actualDamage = damage;
  if (player.armor > 0) {
    const armorAbsorb = Math.min(player.armor, actualDamage * 0.66);
    player.armor -= armorAbsorb;
    actualDamage -= armorAbsorb;
  }

  player.health -= actualDamage;
  if (player.health <= 0) {
    player.health = 0;
    player.isDead = true;
  }
}

export function getCurrentWeapon(player: ServerPlayer): WeaponState | null {
  return player.currentWeaponSlot === 'primary' ? player.primaryWeapon : player.secondaryWeapon;
}

export function switchWeapon(player: ServerPlayer, slot: 'primary' | 'secondary'): void {
  if (slot === 'primary' && player.primaryWeapon) {
    player.currentWeaponSlot = 'primary';
  } else if (slot === 'secondary' && player.secondaryWeapon) {
    player.currentWeaponSlot = 'secondary';
  }
}

export function toPlayerState(player: ServerPlayer): import('@cs-clone/shared').PlayerState {
  return {
    id: player.id,
    username: player.username,
    team: player.team,
    position: { ...player.position },
    rotation: { ...player.rotation },
    velocity: { ...player.velocity },
    health: player.health,
    armor: player.armor,
    isDead: player.isDead,
    isWalking: player.isWalking,
    primaryWeapon: player.primaryWeapon ? { ...player.primaryWeapon } : null,
    secondaryWeapon: player.secondaryWeapon ? { ...player.secondaryWeapon } : null,
    currentWeaponSlot: player.currentWeaponSlot,
    inputSeq: player.inputSeq,
  };
}
