import {
  TICK_INTERVAL_MS,
  SNAPSHOT_INTERVAL_MS,
  WARMUP_DURATION_MS,
  MATCH_DURATION_MS,
  ROUND_END_DURATION_MS,
  WEAPONS,
  DEFAULT_MAP,
} from '@dustline/shared';
import type { GameSnapshot, InputState, Team } from '@dustline/shared';
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
import { fireWeapon, startReload, finishReload, getWeaponMuzzlePosition, findBulletHit } from './weapon.js';
import type { RewoundTarget } from './weapon.js';
import { PositionHistory, rewoundHitboxToAABB, resolveShooterRewindTick } from './lagcomp.js';
export function generateId(): string {
  return crypto.randomUUID();
}

/** Called when a match transitions to 'ended' (e.g. for persistence). */
export type MatchEndListener = (state: ServerGameState, winner: Team) => void;

const matchEndListeners: MatchEndListener[] = [];

/** Register a listener fired when a match ends. Listener errors are contained. */
export function onMatchEnd(listener: MatchEndListener): void {
  matchEndListeners.push(listener);
}

/** Called when a match transitions from warmup to 'live'. */
export type MatchStartListener = (state: ServerGameState) => void;

const matchStartListeners: MatchStartListener[] = [];

/** Register a listener fired when a match starts. Listener errors are contained. */
export function onMatchStart(listener: MatchStartListener): void {
  matchStartListeners.push(listener);
}

function emitMatchStart(state: ServerGameState): void {
  for (const listener of matchStartListeners) {
    try {
      listener(state);
    } catch (err) {
      console.error('match-start listener failed:', err);
    }
  }
}

/** Payload for bullet-hit listeners (see onBulletHit). */
export interface BulletHitEvent {
  bullet: ServerBullet;
  shooter: ServerPlayer;
  victim: ServerPlayer;
  damage: number;
  headshot: boolean;
  killed: boolean;
}

export type BulletHitListener = (event: BulletHitEvent) => void;

const bulletHitListeners: BulletHitListener[] = [];

/**
 * Register a listener fired when a player's bullet lands on another player
 * (after damage + stats are applied, so victim health is post-hit). Returns
 * an unsubscribe function. Listener errors are contained so they can never
 * break the tick loop.
 */
export function onBulletHit(listener: BulletHitListener): () => void {
  bulletHitListeners.push(listener);
  return () => {
    const i = bulletHitListeners.indexOf(listener);
    if (i >= 0) bulletHitListeners.splice(i, 1);
  };
}

function emitBulletHit(event: BulletHitEvent): void {
  for (const listener of bulletHitListeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('bullet-hit listener failed:', err);
    }
  }
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
    history: new PositionHistory(),
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

/**
 * NOTE: despite the name, inputs are NOT queued for the next tick — they are
 * processed SYNCHRONOUSLY at message-arrival time (seq stamped, movement
 * simulated, fire resolved). Lag-comp rewind math depends on this timing:
 * the bullet's rewind tick is resolved against the history at this exact
 * moment (see resolveShooterRewindTick below).
 */
export function queueInput(state: ServerGameState, playerId: string, input: InputState): void {
  const player = state.players.get(playerId);
  if (!player) return;

  // Ack the input seq even when the input cannot be simulated (player dead):
  // the client trims its prediction queue for seqs <= lastInputSeq, so
  // dropping an input silently would leave it pending forever.
  if (input.seq > player.lastInputSeq) {
    player.lastInputSeq = input.seq;
  }
  if (player.isDead) return;

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
          // Test the shot against the world as this shooter saw it.
          rewindTick: resolveShooterRewindTick(state.history, player, state.tick),
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

  // Record player hitboxes for lag compensation (after all state updates of
  // this tick, so the frame reflects the state as of the end of tick).
  state.history.record(state.tick, state.players.values());

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

  // Notify listeners (match-start notifications). Errors are contained per
  // listener so they can never break the tick loop.
  emitMatchStart(state);
}

export function endMatch(state: ServerGameState, winner: Team): void {
  state.match.status = 'ended';
  state.match.endTime = Date.now();
  if (winner === 'T') {
    state.match.tScore++;
  } else if (winner === 'CT') {
    state.match.ctScore++;
  }

  // Notify listeners (persistence). Errors are contained per listener so
  // they can never break the tick loop.
  for (const listener of matchEndListeners) {
    try {
      listener(state, winner);
    } catch (err) {
      console.error('match-end listener failed:', err);
    }
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

    // Lag compensation: test the ray against targets as they were at the
    // shooter's rewind tick (targets without history fall back to live
    // positions inside findBulletHit).
    const result = findBulletHit(bullet, state.players.values(), rewoundTargetsFor(state, bullet.rewindTick));

    if (result) {
      bullet.hitPlayerId = result.player.id;
      bullet.expired = true;

      const damage = result.headshot ? bullet.damage * 2 : bullet.damage;
      damagePlayer(result.player, damage);

      const shooter = state.players.get(bullet.shooterId);
      if (shooter) {
        shooter.stats.damageDealt += damage;
        shooter.stats.shotsHit++;
        if (result.headshot) shooter.stats.headshots++;

        if (result.player.isDead) {
          shooter.stats.kills++;
          result.player.stats.deaths++;
        }

        // Hit confirmation for the shooter's client (connection.ts maps this
        // to a {type:'hit'} message on the shooter's websocket). A killing
        // shot may also produce the kill/death flow; the shooter getting both
        // a hit and a kill notification is fine.
        emitBulletHit({
          bullet,
          shooter,
          victim: result.player,
          damage,
          headshot: result.headshot,
          killed: result.player.isDead,
        });
      }
    }
  }

  // Remove expired bullets (reverse order to preserve indices)
  for (let i = bulletsToRemove.length - 1; i >= 0; i--) {
    state.bullets.splice(bulletsToRemove[i], 1);
  }
}

function rewoundTargetsFor(state: ServerGameState, tick: number): Map<string, RewoundTarget> {
  const targets = new Map<string, RewoundTarget>();
  for (const player of state.players.values()) {
    const hitbox = state.history.rewind(player.id, tick);
    if (hitbox) {
      targets.set(player.id, { position: hitbox.pos, aabb: rewoundHitboxToAABB(hitbox) });
    }
  }
  return targets;
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
