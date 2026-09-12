// tests/render3d-vfx.test.ts — VFX layer checks that run without WebGL.
// CameraRig is pure math (node-safe); PostFX is exercised with a stub
// renderer-shaped object (its constructor chain never touches a GL context);
// GameView is checked at the prototype level since constructing it needs a
// real canvas.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraRig } from "../src/render3d/CameraRig";
import { PostFX } from "../src/render3d/PostFX";
import { GameView } from "../src/render3d/GameView";

const STEP = 1 / 60;
const ASPECT = 16 / 10;
const TAN_HALF_FOV = Math.tan((20 * Math.PI) / 180); // CameraRig uses a 40 deg fov

function settle(rig: CameraRig, seconds: number, velX = 0, velY = 0): void {
  const target = new THREE.Vector3(10, -6.5, 0); // playfield centre
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    rig.follow(target, STEP, velX, velY);
    rig.update(STEP, i * STEP);
  }
}

describe("CameraRig", () => {
  it("eases the follow target and converges on the playfield centre", () => {
    const rig = new CameraRig(ASPECT);
    settle(rig, 8);
    const p = rig.camera.position;
    // look target converges to centre (camera sits 0.35 above it)
    expect(p.x).toBeCloseTo(10, 1);
    expect(p.y).toBeCloseTo(-6.15, 1);
    // full-fit distance at 16:10: (13 + 1.2) / 2 / tan(20 deg) ≈ 19.5
    expect(p.z).toBeGreaterThan(18.5);
    expect(p.z).toBeLessThan(20.5);
  });

  it("keeps the whole playfield in frame when the target hits world bounds", () => {
    const rig = new CameraRig(ASPECT);
    const corner = new THREE.Vector3(0, 0, 0); // top-left of the playfield
    const steps = Math.round(8 / STEP);
    for (let i = 0; i < steps; i++) {
      rig.follow(corner, STEP);
      rig.update(STEP, i * STEP);
    }
    const p = rig.camera.position;
    // clamped toward the centre instead of tracking the raw corner
    expect(p.x).toBeGreaterThan(8);
    expect(p.x).toBeLessThanOrEqual(10);
    expect(p.y).toBeGreaterThan(-7);
    // invariant: the view frustum at the playfield plane still covers the world
    const dist = p.z;
    const halfW = dist * TAN_HALF_FOV * ASPECT;
    const halfH = dist * TAN_HALF_FOV;
    expect(p.x - halfW).toBeLessThanOrEqual(0.01);
    expect(p.x + halfW).toBeGreaterThanOrEqual(19.99);
    expect(p.y - 0.35 - halfH).toBeLessThanOrEqual(0.01);
    expect(p.y - 0.35 + halfH).toBeGreaterThanOrEqual(-12.99);
  });

  it("look-ahead leads into the movement direction, within bounds", () => {
    const rig = new CameraRig(ASPECT);
    settle(rig, 8, 2.5 * (60 / 16), 0); // WALK_MAX in world units/s
    const staticP = rig.camera.position.x;
    const rig2 = new CameraRig(ASPECT);
    settle(rig2, 8);
    // moving right pushes the eased target right of the static framing
    expect(staticP).toBeGreaterThan(rig2.camera.position.x);
  });

  it("shake displaces the camera and decays back to the baseline", () => {
    const rig = new CameraRig(ASPECT);
    settle(rig, 8);
    const baseline = rig.camera.position.clone();
    rig.shake(0.8, 0.1);
    let peak = 0;
    const t0 = 8;
    for (let i = 0; i < 40; i++) {
      rig.update(STEP, t0 + i * STEP);
      peak = Math.max(peak, rig.camera.position.distanceTo(baseline));
    }
    expect(peak).toBeGreaterThan(0.01); // visibly displaced
    for (let i = 40; i < Math.round(4 / STEP); i++) {
      rig.update(STEP, t0 + i * STEP);
    }
    expect(rig.camera.position.distanceTo(baseline)).toBeLessThan(0.005); // fully settled
  });

  it("menu mode dollies into a slow diorama pan and back out", () => {
    const rig = new CameraRig(ASPECT);
    settle(rig, 8);
    rig.setMenuMode(true, 0);
    const steps = Math.round(8 / STEP);
    for (let i = 0; i < steps; i++) rig.update(STEP, i * STEP);
    const p = rig.camera.position;
    expect(p.z).toBeLessThan(14); // ~0.6x of the ~19.5 fit distance
    expect(p.x).toBeGreaterThan(4); // panning, but staying near the world
    expect(p.x).toBeLessThan(16);
    rig.setMenuMode(false, 8);
    for (let i = 0; i < steps; i++) {
      rig.follow(new THREE.Vector3(10, -6.5, 0), STEP);
      rig.update(STEP, 8 + i * STEP);
    }
    expect(rig.camera.position.z).toBeGreaterThan(18.5); // back to full-fit framing
  });
});

/** Stub with just the two renderer reads EffectComposer makes at construction. */
function stubRenderer(w = 64, h = 48): THREE.WebGLRenderer {
  const size = new THREE.Vector2(w, h);
  return {
    getPixelRatio: () => 1,
    getSize: (target: THREE.Vector2) => target.copy(size),
  } as unknown as THREE.WebGLRenderer;
}

describe("PostFX", () => {
  it("builds render → bloom → grade → output and resizes without a GL context", () => {
    const fx = new PostFX(stubRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(fx.composer.passes.length).toBe(4);
    expect(() => fx.resize(128, 96)).not.toThrow();
    expect(() => {
      fx.setMenuGrade(true);
      fx.hitPulse(0.5);
      fx.update(STEP);
      fx.update(STEP);
    }).not.toThrow();
    expect(() => fx.dispose()).not.toThrow();
  });
});

describe("GameView contract", () => {
  it("exposes the DESIGN surface (methods checked without WebGL construction)", () => {
    expect(typeof GameView.prototype.resize).toBe("function");
    expect(typeof GameView.prototype.sync).toBe("function");
    expect(typeof GameView.prototype.setMenuMode).toBe("function");
    expect(typeof GameView.prototype.dispose).toBe("function");
  });
});
