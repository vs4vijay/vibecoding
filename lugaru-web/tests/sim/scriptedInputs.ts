import type { InputFrame } from '../../src/core/input';

/** Deterministic InputFrame factory — all fields explicit, no edge noise. */
export function makeFrame(over: Partial<InputFrame> = {}): InputFrame {
  return {
    moveX: 0,
    moveZ: 0,
    lookDX: 0,
    lookDY: 0,
    pressed: { attack: false, jump: false, crouch: false },
    held: { attack: false, jump: false, crouch: false },
    ...over,
  };
}

/** Move forward at full run speed. */
export function forward(): InputFrame {
  return makeFrame({ moveZ: -1, held: { ...makeFrame().held, attack: false, jump: false, crouch: false } });
}

/** Move forward with attack held (for buffered attack during run). */
export function forwardAttackHeld(): InputFrame {
  return makeFrame({ moveZ: -1, held: { attack: true, jump: false, crouch: false } });
}

/** Single attack press edge (one frame), released next frame. */
export function attackPress(): InputFrame {
  return makeFrame({ pressed: { attack: true, jump: false, crouch: false } });
}

/** Attack held (no press edge). */
export function attackHeld(): InputFrame {
  return makeFrame({ held: { attack: true, jump: false, crouch: false } });
}

/** Single crouch press edge (reverse attempt when timed correctly). */
export function crouchPress(): InputFrame {
  return makeFrame({ pressed: { crouch: true, attack: false, jump: false } });
}

/** Crouch held (sneak). */
export function crouchHeld(): InputFrame {
  return makeFrame({ held: { crouch: true, attack: false, jump: false } });
}

/** Single jump press edge. */
export function jumpPress(): InputFrame {
  return makeFrame({ pressed: { jump: true, attack: false, crouch: false } });
}

/** Null input — dummy fighter (stands still, physics runs). */
export function none(): null {
  return null;
}

/**
 * Build a repeating sequence: `frames` is an array of [frame, count] pairs.
 * Returns a flat array of InputFrame|null of total length sum(count).
 */
export function repeatFrames(
  frames: Array<[InputFrame | null, number]>
): Array<InputFrame | null> {
  const out: Array<InputFrame | null> = [];
  for (const [frame, count] of frames) {
    for (let i = 0; i < count; i++) out.push(frame);
  }
  return out;
}