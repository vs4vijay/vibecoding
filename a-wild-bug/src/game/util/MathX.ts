import * as THREE from "three";

export const clamp = THREE.MathUtils.clamp;

/** Frame-rate independent exponential damping (lambda = smoothing rate). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Shortest signed angle from `from` to `to`, in [-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt));
}

const _smoothDampTmp = new THREE.Vector3();

/**
 * Critically-damped spring (Unity's SmoothDamp) for a Vector3.
 * `velocity` is persistent per-track state; result written into `out`.
 */
export function smoothDampVec3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  velocity: THREE.Vector3,
  smoothTime: number,
  dt: number,
  out: THREE.Vector3,
  maxSpeed = Infinity,
): THREE.Vector3 {
  smoothTime = Math.max(0.0001, smoothTime);
  dt = Math.min(dt, 0.1); // keep the spring stable across hitches
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  _smoothDampTmp.subVectors(current, target);
  const maxChange = maxSpeed * smoothTime;
  if (_smoothDampTmp.lengthSq() > maxChange * maxChange) {
    _smoothDampTmp.setLength(maxChange);
  }
  const dx = _smoothDampTmp.x;
  const dy = _smoothDampTmp.y;
  const dz = _smoothDampTmp.z;

  const tx = (velocity.x + omega * dx) * dt;
  const ty = (velocity.y + omega * dy) * dt;
  const tz = (velocity.z + omega * dz) * dt;
  velocity.set((velocity.x - omega * tx) * exp, (velocity.y - omega * ty) * exp, (velocity.z - omega * tz) * exp);

  out.set(target.x + (dx + tx) * exp, target.y + (dy + ty) * exp, target.z + (dz + tz) * exp);
  return out;
}
