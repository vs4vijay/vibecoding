import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  worldToScreen,
  type CameraLike,
  type ScreenPos,
} from "../src/ui/worldToScreen";

// Viewport shared by every case: 800 × 400 CSS px → center (400, 200).
const W = 800;
const H = 400;

/**
 * Stub camera: world == view (identity matrixWorldInverse) and a pure
 * ×0.5 projection scale with w ≡ 1. World (x, y) therefore maps to NDC
 * (x/2, y/2) exactly (0.5 is a binary-exact scale, so assertions are
 * free of float noise) and the camera can never be "behind" anything.
 */
function affineStub(): CameraLike {
  return {
    matrixWorldInverse: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    projectionMatrix: { elements: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  };
}

/**
 * Stub camera with a perspective-style w row (w = −z), i.e. the camera
 * looks down −z: points with z > 0 are behind it. Mirrors how a real
 * perspective projection makes the divide flip for behind-camera points,
 * which is what the projW ≤ 0 guard exists for.
 */
function perspectiveStub(): CameraLike {
  return {
    matrixWorldInverse: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    projectionMatrix: { elements: [0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0] },
  };
}

describe("worldToScreen", () => {
  it("maps the view center to the viewport center", () => {
    const p = worldToScreen(0, 0, 0, affineStub(), W, H);
    expect(p.x).toBe(400);
    expect(p.y).toBe(200);
    expect(p.offscreen).toBe(false);
  });

  it("maps NDC x +1 to the right edge and counts it on-screen", () => {
    // World x=2 → NDC 1 → px (1*0.5 + 0.5) * 800 = 800.
    const p = worldToScreen(2, 0, 0, affineStub(), W, H);
    expect(p.x).toBe(800);
    expect(p.y).toBe(200);
    expect(p.offscreen).toBe(false);
  });

  it("flips y: NDC y −1 is the BOTTOM edge, on-screen", () => {
    // World y=−2 → NDC −1 → py (−(−1)*0.5 + 0.5) * 400 = 400.
    const p = worldToScreen(0, -2, 0, affineStub(), W, H);
    expect(p.x).toBe(400);
    expect(p.y).toBe(400);
    expect(p.offscreen).toBe(false);
  });

  it("clamps out-of-range NDC into the viewport and flags offscreen", () => {
    // World x=6 → NDC 3 → unclamped px 1600 → clamped to 800.
    const right = worldToScreen(6, 0, 0, affineStub(), W, H);
    expect(right.x).toBe(800);
    expect(right.y).toBe(200);
    expect(right.offscreen).toBe(true);
    // World y=−6 → NDC −3 → unclamped py 800 → clamped to 400.
    const below = worldToScreen(0, -6, 0, affineStub(), W, H);
    expect(below.x).toBe(400);
    expect(below.y).toBe(400);
    expect(below.offscreen).toBe(true);
  });

  it("flags points behind the camera even when their NDC lands in range", () => {
    // w = −z: the point at z=+10 is behind the camera; its flipped NDC is
    // (−0, −0), inside [-1, 1] — only the projW ≤ 0 rule catches it.
    const behind = worldToScreen(0, 0, 10, perspectiveStub(), W, H);
    expect(behind.offscreen).toBe(true);
    expect(Number.isFinite(behind.x)).toBe(true);
    expect(Number.isFinite(behind.y)).toBe(true);
    // Same for an off-axis behind point whose flipped NDC stays in range.
    const behindOffAxis = worldToScreen(-4, 0, 8, perspectiveStub(), W, H);
    expect(behindOffAxis.offscreen).toBe(true);
    // In front of the same camera: not flagged.
    const front = worldToScreen(0, 0, -10, perspectiveStub(), W, H);
    expect(front.x).toBe(400);
    expect(front.offscreen).toBe(false);
  });

  it("keeps coordinates finite for a point exactly on the camera plane (w = 0)", () => {
    const p = worldToScreen(0, 0, 0, perspectiveStub(), W, H);
    expect(p.offscreen).toBe(true);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });

  it("reuses the out object: same identity, values overwritten", () => {
    const out: ScreenPos = { x: -1, y: -1, offscreen: true };
    const first = worldToScreen(0, 0, 0, affineStub(), W, H, out);
    expect(first).toBe(out);
    expect(out.x).toBe(400);
    expect(out.y).toBe(200);
    expect(out.offscreen).toBe(false);
    worldToScreen(6, 0, 0, affineStub(), W, H, out);
    expect(out.x).toBe(800);
    expect(out.offscreen).toBe(true);
  });

  it("accepts a real three.js PerspectiveCamera and projects via its matrices", () => {
    // Type-level + runtime proof that CameraLike structurally accepts a
    // real camera: passing `cam` into worldToScreen() must typecheck
    // (construction needs no WebGL in node).
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 200);
    cam.updateMatrixWorld();
    // Default camera at origin looks down −z, so the point dead ahead
    // projects to the viewport center.
    const center = worldToScreen(0, 0, -10, cam, 1600, 900);
    expect(center.x).toBeCloseTo(800, 6);
    expect(center.y).toBeCloseTo(450, 6);
    expect(center.offscreen).toBe(false);
    // Far off-axis → flagged and clamped to the right edge.
    const off = worldToScreen(100, 0, -10, cam, 1600, 900);
    expect(off.offscreen).toBe(true);
    expect(off.x).toBe(1600);
    // Behind the camera → flagged by the w rule.
    const behind = worldToScreen(0, 0, 10, cam, 1600, 900);
    expect(behind.offscreen).toBe(true);
  });
});
