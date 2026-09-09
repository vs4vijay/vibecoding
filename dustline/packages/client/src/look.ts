export function cameraAnglesFromRotation(rot: { x: number; y: number }): { pitch: number; yaw: number } {
  // rotation.x = yaw, rotation.y = pitch (see @dustline/shared types.ts)
  return { pitch: rot.y, yaw: rot.x };
}

export const DEFAULT_SENSITIVITY = 0.002;

export function clampSensitivity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SENSITIVITY;
  return Math.min(0.01, Math.max(0.0005, v));
}
