import type { TankInput } from "./tank";

/**
 * Keyboard → TankInput mapping.
 * W/↑ accelerate, S/↓ brake/reverse, A/D or ←/→ steer.
 */
export class PlayerInput {
  private keys = new Set<string>();
  /** Set on each Space keydown, consumed by the game loop (one shot per pull). */
  private fireQueued = false;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (e.code === "Space" && !e.repeat) this.fireQueued = true;
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

  /** Current input state derived from held keys. */
  read(): TankInput {
    const k = this.keys;
    const throttle = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) +
      (k.has("KeyS") || k.has("ArrowDown") ? -1 : 0);
    const steer = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) +
      (k.has("KeyA") || k.has("ArrowLeft") ? -1 : 0);
    return { throttle, steer };
  }
}
