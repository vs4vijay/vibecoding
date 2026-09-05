/** Deterministic InputFrame factory — all fields explicit, no edge noise. */
export function makeFrame(over = {}) {
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
export function forward() {
    return makeFrame({ moveZ: -1, held: { ...makeFrame().held, attack: false, jump: false, crouch: false } });
}
/** Move forward with attack held (for buffered attack during run). */
export function forwardAttackHeld() {
    return makeFrame({ moveZ: -1, held: { attack: true, jump: false, crouch: false } });
}
/** Single attack press edge (one frame), released next frame. */
export function attackPress() {
    return makeFrame({ pressed: { attack: true, jump: false, crouch: false } });
}
/** Attack held (no press edge). */
export function attackHeld() {
    return makeFrame({ held: { attack: true, jump: false, crouch: false } });
}
/** Single crouch press edge (reverse attempt when timed correctly). */
export function crouchPress() {
    return makeFrame({ pressed: { crouch: true, attack: false, jump: false } });
}
/** Crouch held (sneak). */
export function crouchHeld() {
    return makeFrame({ held: { crouch: true, attack: false, jump: false } });
}
/** Single jump press edge. */
export function jumpPress() {
    return makeFrame({ pressed: { jump: true, attack: false, crouch: false } });
}
/** Null input — dummy fighter (stands still, physics runs). */
export function none() {
    return null;
}
/**
 * Build a repeating sequence: `frames` is an array of [frame, count] pairs.
 * Returns a flat array of InputFrame|null of total length sum(count).
 */
export function repeatFrames(frames) {
    const out = [];
    for (const [frame, count] of frames) {
        for (let i = 0; i < count; i++)
            out.push(frame);
    }
    return out;
}
