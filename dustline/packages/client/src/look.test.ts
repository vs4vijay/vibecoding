import { describe, expect, test } from 'bun:test';
import { cameraAnglesFromRotation, clampSensitivity, DEFAULT_SENSITIVITY } from './look.js';

describe('cameraAnglesFromRotation', () => {
  test('maps yaw to camera yaw and pitch to camera pitch', () => {
    expect(cameraAnglesFromRotation({ x: 1.5, y: -0.3 })).toEqual({ pitch: -0.3, yaw: 1.5 });
  });
  test('passes yaw through unbounded (no clamp client-side)', () => {
    expect(cameraAnglesFromRotation({ x: Math.PI * 3, y: 0 }).yaw).toBe(Math.PI * 3);
  });
});

describe('clampSensitivity', () => {
  test('clamps and falls back', () => {
    expect(clampSensitivity(0.005)).toBe(0.005);
    expect(clampSensitivity(99)).toBe(0.01);
    expect(clampSensitivity(NaN)).toBe(DEFAULT_SENSITIVITY);
  });
});
