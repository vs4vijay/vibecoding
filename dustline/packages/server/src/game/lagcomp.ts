import { HISTORY_TICKS, PLAYER_HEIGHT, PLAYER_RADIUS } from '@dustline/shared';
import type { Vec3 } from '@dustline/shared';
import type { AABB } from './collision.js';
import type { ServerPlayer } from './types.js';

/**
 * A player hitbox captured at a past tick, used to test shots against the
 * world as the shooter saw it.
 */
export interface RewoundHitbox {
  /** Player position (AABB center) at the recorded tick. */
  pos: Vec3;
  /** Eye offset above pos. The client camera sits at position.y + PLAYER_HEIGHT / 2,
   *  so hitboxes span pos.y ± eyeHeight — the same box playerToAABB builds. */
  eyeHeight: number;
  /** Horizontal hit radius. */
  radius: number;
}

const EYE_HEIGHT = PLAYER_HEIGHT / 2;

interface HistoryEntry {
  hitbox: RewoundHitbox;
  lastInputSeq: number;
}

/**
 * Bounded ring of per-tick player hitboxes. Keeps the last HISTORY_TICKS
 * frames; older ticks are evicted so memory stays flat over long matches.
 */
export class PositionHistory {
  private frames = new Map<number, Map<string, HistoryEntry>>();

  /** Number of retained ticks (≤ HISTORY_TICKS). */
  get size(): number {
    return this.frames.size;
  }

  /** Capture every player's hitbox and acked input seq for this tick. */
  record(tick: number, players: Iterable<ServerPlayer>): void {
    const frame = new Map<string, HistoryEntry>();
    for (const player of players) {
      frame.set(player.id, {
        hitbox: {
          pos: { ...player.position },
          eyeHeight: EYE_HEIGHT,
          radius: PLAYER_RADIUS,
        },
        lastInputSeq: player.lastInputSeq,
      });
    }
    this.frames.set(tick, frame);
    while (this.frames.size > HISTORY_TICKS) {
      const oldest = this.frames.keys().next();
      if (oldest.done) break;
      this.frames.delete(oldest.value);
    }
  }

  /** The player's hitbox at the given tick, or null if unknown/evicted. */
  rewind(playerId: string, tick: number): RewoundHitbox | null {
    const entry = this.frames.get(tick)?.get(playerId);
    return entry ? { ...entry.hitbox, pos: { ...entry.hitbox.pos } } : null;
  }

  /**
   * The first recorded tick whose state reflects the given input seq having
   * been processed (i.e. the oldest frame with lastInputSeq >= seq), or null
   * when no retained frame does.
   */
  findTickForInputSeq(playerId: string, seq: number): number | null {
    for (const [tick, frame] of this.frames) {
      const entry = frame.get(playerId);
      if (entry && entry.lastInputSeq >= seq) return tick;
    }
    return null;
  }
}

/** Rebuild the full body AABB from a recorded hitbox. */
export function rewoundHitboxToAABB(hitbox: RewoundHitbox): AABB {
  return {
    min: {
      x: hitbox.pos.x - hitbox.radius,
      y: hitbox.pos.y - hitbox.eyeHeight,
      z: hitbox.pos.z - hitbox.radius,
    },
    max: {
      x: hitbox.pos.x + hitbox.radius,
      y: hitbox.pos.y + hitbox.eyeHeight,
      z: hitbox.pos.z + hitbox.radius,
    },
  };
}

/**
 * The tick a shot from this shooter should be tested against: the tick at
 * which the shooter's acked input (lastInputSeq) was processed, clamped to
 * [currentTick - HISTORY_TICKS, currentTick]. Falls back to currentTick when
 * no retained frame reflects the acked input.
 */
export function resolveRewindTick(
  history: PositionHistory,
  playerId: string,
  lastInputSeq: number,
  currentTick: number
): number {
  const found = history.findTickForInputSeq(playerId, lastInputSeq);
  if (found === null) return currentTick;
  return Math.max(currentTick - HISTORY_TICKS, Math.min(found, currentTick));
}
