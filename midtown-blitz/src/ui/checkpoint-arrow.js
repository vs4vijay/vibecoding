/**
 * Checkpoint screen-projection helper (Midtown Blitz UI, task 5.3).
 *
 * The pure math behind the HUD's checkpoint guidance (race-events spec:
 * "the HUD SHALL indicate its direction from anywhere in the city, including
 * when it is off-screen"). Given the camera's position, orientation basis,
 * and projection (fov/aspect) plus a world-space target, it decides:
 *
 *  - ON-SCREEN  -> the viewport-fraction position (0..1, left→right,
 *                  top→bottom) where a floating diamond marker should sit —
 *                  the exact projection, clamped into a small margin box so
 *                  a target near the screen edge stays visible.
 *  - OFF-SCREEN -> a point on a screen-edge rectangle (inset by
 *                  {@link EDGE_MARGIN}) where the edge arrow should sit, and
 *                  the CSS rotation angle (rad; 0 = pointing right, positive
 *                  = clockwise, matching `transform: rotate()`) pointing
 *                  toward the target.
 *
 * Direction math (the part worth spelling out):
 *  - d = target - camera; xr = dot(d, right), yu = dot(d, up) are the
 *    camera-space "screen-right" and "screen-up" amounts.
 *  - In front (zf = dot(d, forward) > 0) the perspective-correct screen
 *    direction is (xr, yu) / (zf * tanHalf) — used so the arrow angle
 *    matches the projected position exactly at the FOV boundary (smooth
 *    handoff between diamond and arrow).
 *  - BEHIND the camera the projection mirrors, but a guidance arrow must
 *    point the way the player should TURN, so the linear (xr, yu) direction
 *    is used unflipped: a checkpoint behind-left gets an arrow pointing
 *    left (turn left to face it), sweeping continuously as it comes around.
 *    Directly behind (degenerate direction) falls back to straight down.
 *
 * Everything is plain number math on caller-provided basis vectors — no
 * three.js, no DOM — so plain node harnesses assert exact screen-space
 * outcomes (scripts/hud-test.mjs). The caller (hud.js's
 * `updateCheckpoint`) extracts the basis from a THREE camera's matrixWorld
 * columns; a reusable `out` object keeps the per-frame call
 * allocation-light.
 */

/** Screen-edge rectangle inset (viewport fraction) for the off-screen arrow. */
export const EDGE_MARGIN = 0.08;

/** Margin box (viewport fraction) the on-screen diamond is clamped into. */
export const DIAMOND_MARGIN = 0.05;

/** 1 - DIAMOND_MARGIN, the clamp's upper bound. */
const DIAMOND_MARGIN_MAX = 1 - DIAMOND_MARGIN;

/**
 * Result object written by {@link computeCheckpointIndicator} (reuse one per
 * call site; the function overwrites every field).
 *
 * @typedef {object} CheckpointIndicator
 * @property {boolean} onScreen Whether the target projects inside the view.
 * @property {number} x Viewport-fraction x (0 = left, 1 = right) of the
 *   diamond (on-screen) or the edge arrow (off-screen).
 * @property {number} y Viewport-fraction y (0 = top, 1 = bottom).
 * @property {number} angleRad CSS rotation for the arrow (0 = point right,
 *   positive = clockwise); 0 when on-screen (the diamond does not rotate).
 * @property {number} distM Distance camera -> target (m; HUD/debug info).
 * @property {number} bearingRad Signed bearing of the target relative to the
 *   camera forward, positive toward the camera's screen-right (rad).
 */

/**
 * Parameters for {@link computeCheckpointIndicator} (plain numbers so the
 * helper stays three.js-free; hud.js fills them from a camera each frame).
 *
 * @typedef {object} CheckpointIndicatorParams
 * @property {number} camX Camera world x.
 * @property {number} camY Camera world y.
 * @property {number} camZ Camera world z.
 * @property {number} rightX Screen-right basis x (unit).
 * @property {number} rightY Screen-right basis y.
 * @property {number} rightZ Screen-right basis z.
 * @property {number} upX Screen-up basis x (unit).
 * @property {number} upY Screen-up basis y.
 * @property {number} upZ Screen-up basis z.
 * @property {number} forwardX View-forward basis x (unit).
 * @property {number} forwardY View-forward basis y.
 * @property {number} forwardZ View-forward basis z.
 * @property {number} fovYRad Vertical field of view (rad).
 * @property {number} aspect Viewport aspect ratio (width / height).
 * @property {number} targetX Target world x.
 * @property {number} targetY Target world y.
 * @property {number} targetZ Target world z.
 */

/**
 * Project a world-space checkpoint into HUD guidance (see module header).
 * Overwrites and returns `out` — no allocation.
 * @param {CheckpointIndicator} out Reused result object.
 * @param {CheckpointIndicatorParams} p Camera + target parameters.
 * @returns {CheckpointIndicator} The same `out`, filled in.
 */
export function computeCheckpointIndicator(out, p) {
  const dx = p.targetX - p.camX;
  const dy = p.targetY - p.camY;
  const dz = p.targetZ - p.camZ;
  const zf = dx * p.forwardX + dy * p.forwardY + dz * p.forwardZ;
  const xr = dx * p.rightX + dy * p.rightY + dz * p.rightZ;
  const yu = dx * p.upX + dy * p.upY + dz * p.upZ;

  out.distM = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.bearingRad = Math.atan2(xr, zf);

  let onScreen = false;
  if (zf > 0) {
    const tanHalfY = Math.tan(p.fovYRad / 2);
    const tanHalfX = tanHalfY * p.aspect;
    const ndcX = xr / (zf * tanHalfX);
    const ndcY = yu / (zf * tanHalfY);
    if (ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1) {
      onScreen = true;
      out.x = Math.min(
        DIAMOND_MARGIN_MAX,
        Math.max(DIAMOND_MARGIN, (ndcX + 1) / 2)
      );
      out.y = Math.min(
        DIAMOND_MARGIN_MAX,
        Math.max(DIAMOND_MARGIN, (1 - ndcY) / 2)
      );
      out.angleRad = 0;
    }
  }

  if (!onScreen) {
    // Screen-space direction toward the target (x right, y up): perspective-
    // corrected when in front, linear when behind (see module header).
    let dirX = xr;
    let dirY = yu;
    if (zf > 0) {
      const tanHalfY = Math.tan(p.fovYRad / 2);
      const tanHalfX = tanHalfY * p.aspect;
      dirX = xr / (zf * tanHalfX);
      dirY = yu / (zf * tanHalfY);
    }
    const len = Math.hypot(dirX, dirY);
    // Degenerate (dead behind): point straight down (turn-around cue).
    const nx = len > 1e-6 ? dirX / len : 0;
    const nyUp = len > 1e-6 ? dirY / len : -1;
    // CSS pixels: y grows downward.
    const cssX = nx;
    const cssY = -nyUp;
    out.angleRad = Math.atan2(cssY, cssX);
    // Ray from the viewport center to the edge rectangle (EDGE_MARGIN in).
    const halfW = 0.5 - EDGE_MARGIN;
    const halfH = 0.5 - EDGE_MARGIN;
    const ax = Math.abs(cssX);
    const ay = Math.abs(cssY);
    let t = Infinity;
    if (ax >= 1e-9) t = Math.min(t, halfW / ax);
    if (ay >= 1e-9) t = Math.min(t, halfH / ay);
    if (!Number.isFinite(t)) t = 0;
    out.x = 0.5 + cssX * t;
    out.y = 0.5 + cssY * t;
  }

  out.onScreen = onScreen;
  return out;
}
