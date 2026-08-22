import type { TankInput } from "./tank";

/**
 * Keyboard → TankInput mapping.
 *
 * 1P (default): W/↑ accelerate, S/↓ brake/reverse, A/D or ←/→ steer,
 * Space fire.
 *
 * 2P split-screen (Phase 13): P1 = WASD + Space fire; P2 = arrow keys +
 * Enter fire. While twoPlayer is active the arrows are REMOVED from P1's
 * mapping — they drive P2 exclusively. Enter only queues P2 fire; menu
 * Enter handling lives in game.ts and is phase-gated there, so the two
 * never collide (menus run on title/results, racing input during race).
 */
export class PlayerInput {
  private keys = new Set<string>();
  /** Set on each Space keydown, consumed by the game loop (one shot per pull). */
  private fireQueued = false;
  /** Set on each Enter keydown — P2's fire (2P mode only acts on it). */
  private fire2Queued = false;

  /** True while 2P split-screen is active: arrows belong to P2, not P1. */
  twoPlayer = false;

  setTwoPlayer(twoPlayer: boolean): void {
    this.twoPlayer = twoPlayer;
    // Mode flips only happen between races, but drop any half-pressed state
    // so a key held across the switch can't leak into the other player.
    this.fireQueued = false;
    this.fire2Queued = false;
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (!e.repeat) {
      if (e.code === "Space") this.fireQueued = true;
      else if (e.code === "Enter") this.fire2Queued = true;
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  /** True once per Space press; call exactly once per frame. */
  consumeFire(): boolean {
    const f = this.fireQueued;
    this.fireQueued = false;
    return f;
  }

  /** True once per Enter press (P2 fire); call exactly once per frame. */
  consumeFire2(): boolean {
    const f = this.fire2Queued;
    this.fire2Queued = false;
    return f;
  }

  /** P1 input: WASD always; arrows only while 2P is off. */
  read(): TankInput {
    const k = this.keys;
    const allowArrows = !this.twoPlayer;
    const throttle =
      (k.has("KeyW") ? 1 : 0) -
      (k.has("KeyS") ? 1 : 0) +
      (allowArrows && k.has("ArrowUp") ? 1 : 0) -
      (allowArrows && k.has("ArrowDown") ? 1 : 0);
    const steer =
      (k.has("KeyD") ? 1 : 0) -
      (k.has("KeyA") ? 1 : 0) +
      (allowArrows && k.has("ArrowRight") ? 1 : 0) -
      (allowArrows && k.has("ArrowLeft") ? 1 : 0);
    return { throttle, steer };
  }

  /** P2 input: arrow keys, active in 2P mode only. */
  read2(): TankInput {
    if (!this.twoPlayer) return { throttle: 0, steer: 0 };
    const k = this.keys;
    return {
      throttle: (k.has("ArrowUp") ? 1 : 0) - (k.has("ArrowDown") ? 1 : 0),
      steer: (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0),
    };
  }
}
