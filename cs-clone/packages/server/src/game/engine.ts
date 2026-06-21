import {
  TICK_INTERVAL_MS,
  SNAPSHOT_INTERVAL_MS,
  WARMUP_DURATION_MS,
  MATCH_DURATION_MS,
  ROUND_END_DURATION_MS,
  WEAPONS,
  PLAYER_HEIGHT,
  DEFAULT_MAP,
} from '@cs-clone/shared';
import type { GameSnapshot, InputState, Team } from '@cs-clone/shared';
import type { ServerGameState, ServerPlayer, ServerBullet, QueuedInput } from './types.js';
import {
  createPlayer,
  respawnPlayer,
  processPlayerInput,
  damagePlayer,
  getCurrentWeapon,
  switchWeapon,
  toPlayerState,
} from './player.js';
import { fireWeapon, startReload, finishReload, getWeaponMuzzlePosition } from './weapon.js';
import { intersectRayAABB, playerToAABB } from './collision.js';
export function generateId(): string {
  return crypto.randomUUID();
}

export function createGameState(): ServerGameState {
  return {
    match: {
      id: generateId(),
      status: 'warmup',
      tScore: 0,
      ctScore: 0,
      timeRemaining: WARMUP_DURATION_MS,
      mapData: DEFAULT_MAP,
      startTime: Date.now(),
      endTime: 0,
      tick: 0,
    },
    players: new Map(),
    bullets: [],
    entities: [...DEFAULT_MAP.entities],
    tick: 0,
    lastSnapshotTime: 0,
  };
}

export function addPlayer(state: ServerGameState, username: string, team: Team): ServerPlayer {
  const player = createPlayer(username, team);
  state.players.set(player.id, player);
  return player;
}

export function removePlayer(state: ServerGameState, playerId: string): void {
  state.players.delete(playerId);
}

export function queueInput(state: ServerGameState, playerId: string, input: InputState): void {
  const player = state.players.get(playerId);
  if (!player || player.isDead) return;

  processPlayerInput(
    player,
    {
      forward: input.forward,
      backward: input.backward,
      left: input.left,
      right: input.right,
      jump: input.jump,
      walk: input.walk,
      yaw: input.yaw,
      pitch: input.pitch,
    },
    state.entities,
    TICK_INTERVAL_MS / 1000
  );

  // Handle weapon switching
  if (input.weaponSlot) {
    switchWeapon(player, input.weaponSlot);
  }

  // Handle fire
  if (input.fire) {
    const weapon = getCurrentWeapon(player);
    if (weapon) {
      const fireResult = fireWeapon(weapon, player, Date.now());
      if (fireResult) {
        player.stats.shotsFired++;
        
        const muzzle = getWeaponMuzzlePosition(player);
        const bullet: ServerBullet = {
          id: generateId(),
          shooterId: player.id,
          origin: muzzle,
          direction: fireResult.direction,
          damage: WEAPONS[weapon.typeId].damage,
          createdAt: Date.now(),
          weaponId: weapon.typeId,
          hitPlayerId: null,
          expired: false,
        };
        state.bullets.push(bullet);
      }
    }
  }

  // Handle reload
  if (input.reload) {
    const weapon = getCurrentWeapon(player);
    if (weapon) {
      startReload(weapon, Date.now());
    }
  }

  // Process reload completion
  const weapon = getCurrentWeapon(player);
  if (weapon && weapon.isReloading) {
    finishReload(weapon, Date.now());
  }
}

export function tick(state: ServerGameState): GameSnapshot | null {
  const now = Date.now();
  state.tick++;
  state.match.tick = state.tick;

  // Update match timer
  if (state.match.status === 'warmup') {
    state.match.timeRemaining -= TICK_INTERVAL_MS;
    if (state.match.timeRemaining <= 0) {
      startMatch(state);
    }
  } else if (state.match.status === 'live') {
    state.match.timeRemaining -= TICK_INTERVAL_MS;
    if (state.match.timeRemaining <= 0) {
      endMatch(state, 'CT'); // CT wins on timeout
    }
  }

  // Process respawns
  for (const player of state.players.values()) {
    if (player.isDead) {
      player.respawnTimer += TICK_INTERVAL_MS;
      if (player.respawnTimer >= 3000) {
        respawnPlayer(player);
      }
    }
  }

  // Process bullets
  processBullets(state);

  // Check win conditions
  checkWinConditions(state);

  // Generate snapshot if needed
  let snapshot: GameSnapshot | null = null;
  if (now - state.lastSnapshotTime >= SNAPSHOT_INTERVAL_MS) {
    state.lastSnapshotTime = now;
    snapshot = createSnapshot(state);
  }

  return snapshot;
}

function startMatch(state: ServerGameState): void {
  state.match.status = 'live';
  state.match.timeRemaining = MATCH_DURATION_MS;
  state.match.startTime = Date.now();
  
  // Reset all players
  for (const player of state.players.values()) {
    respawnPlayer(player);
    player.stats = {
      kills: 0,
      deaths: 0,
      assists: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      damageDealt: 0,
    };
  }
}

function endMatch(state: ServerGameState, winner: Team): void {
  state.match.status = 'ended';
  state.match.endTime = Date.now();
  if (winner === 'T') {
    state.match.tScore++;
  } else if (winner === 'CT') {
    state.match.ctScore++;
  }
  
  // Schedule next match
  setTimeout(() => {
    resetMatch(state);
  }, ROUND_END_DURATION_MS);
}

function resetMatch(state: ServerGameState): void {
  state.match.status = 'warmup';
  state.match.timeRemaining = WARMUP_DURATION_MS;
  state.match.id = generateId();
  
  for (const player of state.players.values()) {
    respawnPlayer(player);
  }
}

function checkWinConditions(state: ServerGameState): void {
  if (state.match.status !== 'live') return;

  let allTDead = true;
  let allCTDead = true;
  let tCount = 0;
  let ctCount = 0;

  for (const player of state.players.values()) {
    if (player.team === 'T') {
      tCount++;
      if (!player.isDead) allTDead = false;
    } else if (player.team === 'CT') {
      ctCount++;
      if (!player.isDead) allCTDead = false;
    }
  }

  if (tCount > 0 && allTDead) {
    endMatch(state, 'CT');
  } else if (ctCount > 0 && allCTDead) {
    endMatch(state, 'T');
  }
}

function processBullets(state: ServerGameState): void {
  const now = Date.now();
  const bulletsToRemove: number[] = [];

  for (let i = 0; i < state.bullets.length; i++) {
    const bullet = state.bullets[i];
    
    // Check if bullet expired (5 seconds max)
    if (now - bullet.createdAt > 5000) {
      bullet.expired = true;
    }

    if (bullet.expired || bullet.hitPlayerId) {
      bulletsToRemove.push(i);
      continue;
    }

    // Check collision with players
    for (const player of state.players.values()) {
      if (player.id === bullet.shooterId || player.isDead) continue;

      const playerAABB = playerToAABB(player.position);
      const hit = intersectRayAABB(bullet.origin, bullet.direction, playerAABB);
      
      if (hit && hit.t > 0 && (WEAPONS[bullet.weaponId]?.range || 100) > hit.t) {
        bullet.hitPlayerId = player.id;
        bullet.expired = true;

        // Calculate headshot (hit above 75% of player height)
        const headshot = hit.point.y > player.position.y + PLAYER_HEIGHT * 0.25;
        const damage = headshot ? bullet.damage * 2 : bullet.damage;

        damagePlayer(player, damage);

        const shooter = state.players.get(bullet.shooterId);
        if (shooter) {
          shooter.stats.damageDealt += damage;
          shooter.stats.shotsHit++;
          if (headshot) shooter.stats.headshots++;
          
          if (player.isDead) {
            shooter.stats.kills++;
            player.stats.deaths++;
          }
        }

        break;
      }
    }
  }

  // Remove expired bullets (reverse order to preserve indices)
  for (let i = bulletsToRemove.length - 1; i >= 0; i--) {
    state.bullets.splice(bulletsToRemove[i], 1);
  }
}

function createSnapshot(state: ServerGameState): GameSnapshot {
  return {
    tick: state.tick,
    timestamp: Date.now(),
    match: {
      id: state.match.id,
      status: state.match.status,
      tScore: state.match.tScore,
      ctScore: state.match.ctScore,
      timeRemaining: Math.max(0, state.match.timeRemaining),
      mapName: state.match.mapData.name,
    },
    players: Array.from(state.players.values()).map(toPlayerState),
    bullets: state.bullets.map(b => ({
      id: b.id,
      shooterId: b.shooterId,
      origin: { ...b.origin },
      direction: { ...b.direction },
      damage: b.damage,
      createdAt: b.createdAt,
    })),
    entities: state.entities.map(e => ({ ...e })),
  };
}

export function getPlayerStats(state: ServerGameState): { playerId: string; username: string; team: Team; kills: number; deaths: number; score: number }[] {
  return Array.from(state.players.values()).map(p => ({
    playerId: p.id,
    username: p.username,
    team: p.team,
    kills: p.stats.kills,
    deaths: p.stats.deaths,
    score: p.stats.kills * 100 - p.stats.deaths * 50 + p.stats.headshots * 50,
  }));
}
