/**
 * Pure world→screen projection, used to anchor kill-score popups at a
 * victim's screen position.
 *
 * Deliberately three.js-free: `CameraLike` is the structural pair of
 * matrices that `THREE.Vector3.project(camera)` reads, so a real
 * THREE.PerspectiveCamera satisfies it outright (it carries
 * `matrixWorldInverse` and `projectionMatrix`) while node-env tests stub
 * it with plain objects — no WebGL-adjacent classes needed.
 */

/** Structural view of a world-space point (a three.js Vector3 in practice). */
export type Vector3Like = { x: number; y: number; z: number };

/** Structural view of a three.js Matrix4 — its column-major element array. */
export type Matrix4Like = { readonly elements: ArrayLike<number> };

/**
 * Structural stand-in for a three.js camera: exactly what
 * `Vector3.project(camera)` consumes. A real THREE.PerspectiveCamera
 * carries both fields, so it assigns without an adapter; tests supply
 * plain-object stubs instead. (Note the camera itself has no `project`
 * method in three.js — `project` lives on Vector3 — so an interface
 * shaped around `camera.project()` would reject a real camera.)
 */
export interface CameraLike {
  readonly matrixWorldInverse: Matrix4Like;
  readonly projectionMatrix: Matrix4Like;
}

/** Clamped CSS-pixel position plus an off-screen flag. */
export type ScreenPos = {
  /** CSS pixel x, clamped to [0, width]. */
  x: number;
  /** CSS pixel y (top-down), clamped to [0, height]. */
  y: number;
  /**
   * True when the point is not on screen: its unclamped NDC fell strictly
   * outside [-1, 1], or its projection w was ≤ 0 (behind / on the camera
   * plane). Exactly ±1 NDC is the on-screen edge → false.
   */
  offscreen: boolean;
};

// Module scratch — worldToScreen() fires per kill event, never per frame,
// but keeps the zero-allocation habit of every other update path. When
// `out` is omitted, one ScreenPos object is allocated per call: call sites
// are event-driven (a kill, not a frame), so that is fine by design.
const scratchPoint: Vector3Like = { x: 0, y: 0, z: 0 };

/**
 * Mirror of THREE.Vector3.applyMatrix4: transform then perspective divide,
 * in place on the passed point.
 */
function applyMatrix4(v: Vector3Like, m: Matrix4Like): void {
  const e = m.elements;
  const x = v.x;
  const y = v.y;
  const z = v.z;
  const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
  v.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
  v.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
  v.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
}

/** Clamp into [0, max]; non-finite values (degenerate w = 0) park at 0. */
function clampPx(t: number, max: number): number {
  return Number.isFinite(t) ? Math.min(max, Math.max(0, t)) : 0;
}

/**
 * Project world-space (x, y, z) to CSS pixels in a width × height
 * viewport — the same math as `point.project(camera)`.
 *
 * Off-screen rule: flagged iff the projection's w was ≤ 0 (behind or on
 * the camera plane — w ≤ 0 flips or degenerates the divide, so NDC bounds
 * alone would miss points just behind the camera) OR the unclamped NDC
 * x/y fell strictly outside [-1, 1]. x/y are ALWAYS clamped into the
 * viewport so a DOM popup positioned from them lands on a valid edge
 * even when flagged off-screen.
 */
export function worldToScreen(
  x: number,
  y: number,
  z: number,
  camera: CameraLike,
  width: number,
  height: number,
  out?: ScreenPos,
): ScreenPos {
  const v = scratchPoint;
  v.x = x;
  v.y = y;
  v.z = z;
  applyMatrix4(v, camera.matrixWorldInverse);
  const pe = camera.projectionMatrix.elements;
  const projW = pe[3] * v.x + pe[7] * v.y + pe[11] * v.z + pe[15];
  applyMatrix4(v, camera.projectionMatrix);
  // NDC → CSS px; y is flipped (NDC +1 is up, screen y grows down).
  const px = (v.x * 0.5 + 0.5) * width;
  const py = (-v.y * 0.5 + 0.5) * height;
  const result = out ?? { x: 0, y: 0, offscreen: false };
  result.x = clampPx(px, width);
  result.y = clampPx(py, height);
  result.offscreen =
    projW <= 0 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1;
  return result;
}
