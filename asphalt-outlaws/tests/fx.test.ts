import { describe, expect, test } from "bun:test";
import { ParticleSystem } from "../src/render/fx";
import type { BurstName } from "../src/render/fx";
import { RNG } from "../src/core/rng";

function fresh(seed = 7): ParticleSystem {
  return new ParticleSystem(new RNG(seed));
}

function stubCtx(): CanvasRenderingContext2D {
  const noop = (): void => {};
  // Minimal 2d-context stand-in: only the members ParticleSystem.draw touches.
  const stub = {
    globalAlpha: 1,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    arc: noop,
    fill: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    fillRect: noop,
    translate: noop,
    rotate: noop,
  };
  return stub as unknown as CanvasRenderingContext2D;
}

const BURSTS: BurstName[] = [
  "sparks",
  "dust",
  "smoke",
  "stars",
  "debris",
  "speedlines",
];

describe("ParticleSystem", () => {
  test("burst counts land in the designed ranges", () => {
    const ranges: Array<[BurstName, number, number]> = [
      ["sparks", 8, 14],
      ["dust", 6, 10],
      ["smoke", 4, 6],
      ["stars", 8, 8],
      ["debris", 6, 6],
      ["speedlines", 10, 10],
    ];
    for (const [name, min, max] of ranges) {
      const ps = fresh();
      ps.emit(name, 100, 100);
      expect(ps.count).toBeGreaterThanOrEqual(min);
      expect(ps.count).toBeLessThanOrEqual(max);
    }
  });

  test("opts.count overrides the default burst size", () => {
    const ps = fresh();
    ps.emit("sparks", 0, 0, { count: 3 });
    expect(ps.count).toBe(3);
  });

  test("step ages particles: full lives then progressive death", () => {
    const ps = fresh();
    ps.emit("sparks", 0, 0);
    const initial = ps.count;
    ps.step(0.1); // below the shortest spark life: nothing dies
    expect(ps.count).toBe(initial);
    ps.step(0.2); // total 0.3s: mid-range, some dead some alive
    expect(ps.count).toBeGreaterThan(0);
    expect(ps.count).toBeLessThan(initial);
    ps.step(0.6); // total 0.9s: everything dead
    expect(ps.count).toBe(0);
  });

  test("dust burst fully dies after one second", () => {
    const ps = fresh();
    ps.emit("dust", 0, 0);
    expect(ps.count).toBeGreaterThan(0);
    ps.step(1.0);
    expect(ps.count).toBe(0);
  });

  test("emitAmbientSnow maintains ~120 flakes (±40) and keeps them steady", () => {
    const ps = fresh();
    for (let i = 0; i < 90; i++) {
      ps.emitAmbientSnow(1280, 720, 1 / 60);
      ps.step(1 / 60);
    }
    expect(ps.count).toBeGreaterThanOrEqual(80);
    expect(ps.count).toBeLessThanOrEqual(160);
    for (let i = 0; i < 600; i++) {
      ps.emitAmbientSnow(1280, 720, 1 / 60);
      ps.step(1 / 60);
    }
    expect(ps.count).toBeGreaterThanOrEqual(80);
    expect(ps.count).toBeLessThanOrEqual(160);
  });

  test("positions stay finite (no NaN) over 500 steps", () => {
    const ps = fresh();
    for (const name of BURSTS) ps.emit(name, 640, 400);
    ps.emitAmbientSnow(1280, 720, 1);
    for (let i = 0; i < 500; i++) {
      if (i % 10 === 0) ps.emitAmbientSnow(1280, 720, 1 / 30);
      ps.step(1 / 30);
    }
    expect(ps.finite).toBe(true);
    expect(ps.count).toBeGreaterThan(0); // snow persists
  });

  test("clear() empties the system", () => {
    const ps = fresh();
    for (const name of BURSTS) ps.emit(name, 0, 0);
    ps.emitAmbientSnow(1280, 720, 1);
    expect(ps.count).toBeGreaterThan(0);
    ps.clear();
    expect(ps.count).toBe(0);
  });

  test("particle pool is capped at 600", () => {
    const ps = fresh();
    for (let i = 0; i < 100; i++) ps.emit("speedlines", 0, 0);
    expect(ps.count).toBeLessThanOrEqual(600);
  });

  test("draw() runs against a stub 2d context without throwing", () => {
    const ps = fresh();
    for (const name of BURSTS) ps.emit(name, 640, 360);
    ps.emitAmbientSnow(1280, 720, 1);
    expect(() => ps.draw(stubCtx())).not.toThrow();
  });

  test("same seed produces identical counts (determinism)", () => {
    const a = fresh(11);
    const b = fresh(11);
    for (const name of BURSTS) {
      a.emit(name, 5, 5);
      b.emit(name, 5, 5);
    }
    expect(a.count).toBe(b.count);
  });
});
