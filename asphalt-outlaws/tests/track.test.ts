import { describe, expect, test } from "bun:test";
import { LEVELS, SIM } from "../src/config";
import { RNG } from "../src/core/rng";
import {
  buildTrack,
  computeCamDepth,
  findSegment,
  projectPoint,
  trackLength,
} from "../src/sim/track";
import { fogStep, projectForSprite, updateCamera } from "../src/render/road";
import type { ProjPoint } from "../src/sim/types";
import { makeState } from "./helpers";

function pt(y: number, z: number): ProjPoint {
  return {
    world: { x: 0, y, z },
    camera: { x: 0, y: 0 },
    screen: { x: 0, y: 0, w: 0, scale: 0 },
  };
}

const EPS = 1e-9;

describe("buildTrack", () => {
  const level = LEVELS[0]!;
  const track = buildTrack(level, new RNG(42));
  const n = track.segments.length;

  test("segment count matches level.lengthSegs", () => {
    expect(n).toBe(level.lengthSegs);
  });

  test("trackLength correct", () => {
    expect(trackLength(track)).toBe(n * SIM.segmentLength);
  });

  test("z-continuity between consecutive segments", () => {
    for (let i = 0; i < n - 1; i++) {
      const a = track.segments[i]!;
      const b = track.segments[i + 1]!;
      expect(a.p2.world.z).toBe(b.p1.world.z);
      expect(a.p2.world.y).toBe(b.p1.world.y);
      expect(b.p1.world.z - a.p1.world.z).toBe(SIM.segmentLength);
    }
  });

  test("finishIndex within last 40 segments", () => {
    expect(track.finishIndex).toBeGreaterThanOrEqual(n - 40);
    expect(track.finishIndex).toBeLessThan(n);
  });

  test("colors alternate with period 2*rumbleLength", () => {
    const period = SIM.rumbleLength * 2;
    for (let i = 8; i < n - period; i++) {
      const a = track.segments[i]!.colors;
      const b = track.segments[i + period]!.colors;
      expect(a.road).toBe(b.road);
      expect(a.grass).toBe(b.grass);
      expect(a.rumble).toBe(b.rumble);
      const dark = Math.floor(i / SIM.rumbleLength) % 2 === 1;
      expect(a.lane !== null).toBe(dark);
    }
  });

  test("grid straight is long, flat and straight", () => {
    const limit = 100;
    expect(n).toBeGreaterThan(limit);
    for (let i = 0; i < limit; i++) {
      const seg = track.segments[i]!;
      expect(seg.curve).toBe(0);
      expect(seg.p1.world.y).toBe(0);
      expect(seg.p2.world.y).toBe(0);
    }
  });

  test("finish straight is straight", () => {
    for (let i = n - 40; i < n; i++) {
      expect(track.segments[i]!.curve).toBe(0);
    }
  });

  test("scenery offsets within [-3.5, -1.15] U [1.15, 3.5]", () => {
    let count = 0;
    for (const items of track.scenery.values()) {
      for (const item of items) {
        count++;
        expect(
          item.offset >= 1.15 - EPS || item.offset <= -1.15 + EPS,
        ).toBe(true);
        expect(Math.abs(item.offset)).toBeLessThanOrEqual(3.5 + EPS);
        expect(item.scale).toBeGreaterThanOrEqual(0.7);
        expect(item.scale).toBeLessThanOrEqual(1.6);
        expect(typeof item.flip).toBe("boolean");
      }
    }
    // Cheap: well under ~1.5 items per segment on average.
    expect(count / n).toBeLessThan(1.5);
  });

  test("every segment has finite p1/p2 numbers", () => {
    for (const seg of track.segments) {
      for (const p of [seg.p1, seg.p2]) {
        expect(Number.isFinite(p.world.x)).toBe(true);
        expect(Number.isFinite(p.world.y)).toBe(true);
        expect(Number.isFinite(p.world.z)).toBe(true);
      }
      expect(Number.isFinite(seg.curve)).toBe(true);
    }
  });

  test("deterministic for a given seed, differs across seeds", () => {
    const again = buildTrack(level, new RNG(42));
    const other = buildTrack(level, new RNG(7));
    const signature = (t: typeof track): string =>
      t.segments.map((s) => `${s.curve},${s.p1.world.y},${s.p1.world.z}`).join("|");
    expect(signature(again)).toBe(signature(track));
    expect(signature(other)).not.toBe(signature(track));
  });
});

describe("buildTrack twisty level (canyon-rush)", () => {
  const level = LEVELS[3]!;
  const track = buildTrack(level, new RNG(123));

  test("segment count matches", () => {
    expect(track.segments.length).toBe(level.lengthSegs);
  });

  test("curve sections exist", () => {
    let maxAbs = 0;
    for (const seg of track.segments) maxAbs = Math.max(maxAbs, Math.abs(seg.curve));
    expect(maxAbs).toBeGreaterThan(1);
  });

  test("elevation varies when hills > 0", () => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const seg of track.segments) {
      minY = Math.min(minY, seg.p1.world.y);
      maxY = Math.max(maxY, seg.p1.world.y);
    }
    expect(maxY - minY).toBeGreaterThan(1000);
  });
});

describe("computeCamDepth", () => {
  test("fov 100 is reasonable", () => {
    const d = computeCamDepth(100);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(2.5);
  });

  test("fov 90 gives exactly 1", () => {
    expect(computeCamDepth(90)).toBeCloseTo(1, 12);
  });
});

describe("projectPoint", () => {
  const camDepth = computeCamDepth(100);
  const W = 1280;
  const H = 720;

  test("point at camera z gives very large scale", () => {
    const p = pt(0, 0.01);
    projectPoint(p, 0, 1000, 0, camDepth, W, H, SIM.roadWidth);
    expect(p.screen.scale).toBeGreaterThan(50);
  });

  test("scale decreases with distance", () => {
    const near = pt(0, 5000);
    const far = pt(0, 50000);
    projectPoint(near, 0, 1000, 0, camDepth, W, H, SIM.roadWidth);
    projectPoint(far, 0, 1000, 0, camDepth, W, H, SIM.roadWidth);
    expect(far.screen.scale).toBeLessThan(near.screen.scale);
    expect(far.screen.w).toBeLessThan(near.screen.w);
  });

  test("point below camera height projects below screen center", () => {
    const p = pt(0, 5000); // world y 0, camera y 1000
    projectPoint(p, 0, 1000, 0, camDepth, W, H, SIM.roadWidth);
    expect(p.camera.y).toBe(-1000);
    expect(p.screen.y).toBeGreaterThan(H / 2);
  });

  test("point right of camera projects right of center", () => {
    const p = pt(0, 5000);
    p.world.x = 500;
    projectPoint(p, 0, 1000, 0, camDepth, W, H, SIM.roadWidth);
    expect(p.screen.x).toBeGreaterThan(W / 2);
  });

  test("centered point projects to center x", () => {
    const p = pt(0, 5000);
    projectPoint(p, 0, 1000, 0, camDepth, W, H, SIM.roadWidth);
    expect(p.screen.x).toBe(W / 2);
    expect(p.screen.w).toBeGreaterThan(0);
  });
});

describe("findSegment / trackLength", () => {
  const track = buildTrack(LEVELS[0]!, new RNG(42));

  test("z inside a segment maps to its index", () => {
    expect(findSegment(track, 5 * SIM.segmentLength + 50).index).toBe(5);
    expect(findSegment(track, 2.5 * SIM.segmentLength).index).toBe(2);
  });

  test("wrap-around for negative and overflowing z", () => {
    expect(findSegment(track, -1).index).toBe(track.segments.length - 1);
    expect(findSegment(track, trackLength(track) + 100).index).toBe(0);
  });
});

describe("updateCamera", () => {
  test("derives depth, pullback, base segment and player Y", () => {
    const state = makeState(); // flat track, player z = 2 segs, x = 0
    const cam = updateCamera(state, 1280, 720);
    expect(cam.camDepth).toBe(computeCamDepth(SIM.fov));
    expect(cam.camZ).toBe(Math.max(0, state.player.z - SIM.cameraHeight * cam.camDepth));
    expect(cam.baseSegment).toBe(0);
    expect(cam.camX).toBe(0);
    expect(cam.camY).toBe(SIM.cameraHeight);
    expect(cam.playerY).toBe(0);
    expect(cam.width).toBe(1280);
    expect(cam.height).toBe(720);
  });

  test("lateral camera follows player x", () => {
    const state = makeState();
    state.player.x = 0.5;
    const cam = updateCamera(state, 1280, 720);
    expect(cam.camX).toBeCloseTo(0.5 * SIM.roadWidth, 10);
  });
});

describe("projectForSprite", () => {
  test("places an anchor on the road ahead", () => {
    const state = makeState();
    const cam = updateCamera(state, 1280, 720);
    const hit = projectForSprite(state, cam, 4000, 0);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBe(640); // straight, centered road
    expect(hit!.y).toBeGreaterThan(360); // road surface below the horizon
    expect(hit!.scale).toBeGreaterThan(0);
  });

  test("offset shifts laterally by fraction of road width", () => {
    const state = makeState();
    const cam = updateCamera(state, 1280, 720);
    const center = projectForSprite(state, cam, 4000, 0)!;
    const right = projectForSprite(state, cam, 4000, 1)!;
    const left = projectForSprite(state, cam, 4000, -1)!;
    expect(right.x).toBeGreaterThan(center.x);
    expect(left.x).toBeLessThan(center.x);
    expect(right.x - center.x).toBeCloseTo(center.x - left.x, 6);
  });

  test("null behind the camera and beyond the draw distance", () => {
    const state = makeState();
    state.player.z = 100 * SIM.segmentLength;
    const cam = updateCamera(state, 1280, 720);
    expect(projectForSprite(state, cam, cam.camZ - 500, 0)).toBeNull();
    expect(projectForSprite(state, cam, cam.camZ + 111 * SIM.segmentLength, 0)).toBeNull();
    // The player's own position sits at the camera pullback distance.
    const own = projectForSprite(state, cam, state.player.z, 0);
    expect(own).not.toBeNull();
    expect(own!.y).toBeGreaterThan(700); // road surface at the screen bottom
  });
});

describe("fogStep", () => {
  test("1 at the camera, decreasing and positive with distance", () => {
    expect(fogStep(0, 110, 3.3)).toBe(1);
    const a = fogStep(10, 110, 3.3);
    const b = fogStep(50, 110, 3.3);
    const c = fogStep(110, 110, 3.3);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeCloseTo(Math.exp(-3.3), 12);
  });
});
