import { describe, expect, it } from "vitest";
import {
  fbm,
  generateAsphaltAlbedo,
  generateAsphaltNormal,
  generateAsphaltRoughness,
  getSurfaceBuffer,
  getSurfaceTexture,
  heightToNormal,
  mulberry32,
  radialFalloff,
  valueNoise,
} from "../src/render/textures";
import { CONFIG } from "../src/config";

describe("mulberry32", () => {
  it("is deterministic for a given seed", () => {
    const draw = (seed: number): number[] => {
      const r = mulberry32(seed);
      return Array.from({ length: 8 }, () => r());
    };
    expect(draw(42)).toEqual(draw(42));
  });

  it("yields different sequences for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });
});

describe("valueNoise", () => {
  it("is bit-for-bit deterministic for the same seed", () => {
    expect(valueNoise(64, 7, 6)).toEqual(valueNoise(64, 7, 6));
  });

  it("differs for a different seed", () => {
    expect(valueNoise(64, 7, 6)).not.toEqual(valueNoise(64, 8, 6));
  });

  it("stays in [0, 1]", () => {
    const n = valueNoise(64, 7, 6);
    for (const v of n) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of n) expect(v).toBeLessThanOrEqual(1);
  });

  it("accepts an out param and reuses it without allocating", () => {
    const expected = valueNoise(32, 3, 4);
    const out = new Float32Array(32 * 32);
    const returned = valueNoise(32, 3, 4, out);
    expect(returned).toBe(out);
    expect(returned).toEqual(expected);
  });
});

describe("fbm", () => {
  const size = 64;

  it("with one octave is exactly a single valueNoise pass", () => {
    const n = CONFIG.textures.noise;
    const single = fbm(size, 9, 4, 1, n.lacunarity, n.gain);
    expect(single).toEqual(valueNoise(size, 9, 4));
  });

  it("adding octaves changes the field but keeps it in [0, 1]", () => {
    const n = CONFIG.textures.noise;
    const one = fbm(size, 9, 4, 1, n.lacunarity, n.gain);
    const many = fbm(size, 9, 4, n.octaves, n.lacunarity, n.gain);
    expect(one).not.toEqual(many);
    for (const v of many) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic across calls", () => {
    const n = CONFIG.textures.noise;
    expect(fbm(size, 9, 4, n.octaves, n.lacunarity, n.gain)).toEqual(
      fbm(size, 9, 4, n.octaves, n.lacunarity, n.gain),
    );
  });
});

describe("heightToNormal", () => {
  it("maps a flat field to the +z identity normal", () => {
    const size = 16;
    const flat = new Float32Array(size * size); // all zeros
    const n = heightToNormal(flat, size, 1);
    for (let p = 0; p < size * size; p++) {
      expect(n[p * 3]).toBeCloseTo(0.5, 5);
      expect(n[p * 3 + 1]).toBeCloseTo(0.5, 5);
      expect(n[p * 3 + 2]).toBeCloseTo(1.0, 5);
    }
  });

  it("orients a +x ramp so normals tilt toward -x with +z still dominant", () => {
    const size = 16;
    const ramp = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) ramp[y * size + x] = x / (size - 1);
    }
    const n = heightToNormal(ramp, size, 1);
    // Interior pixel far from wrap seams.
    const i = (8 * size + 8) * 3;
    expect(n[i]).toBeLessThan(0.4); // red: -x tilt
    expect(n[i + 1]).toBeCloseTo(0.5, 5); // green: no y gradient
    expect(n[i + 2]).toBeGreaterThan(0.5); // blue: still outward
  });
});

describe("radialFalloff", () => {
  it("is 1 at the center and 0 at the edges", () => {
    const size = 33; // odd so the exact center lands on a pixel
    const f = radialFalloff(size, 2);
    const c = (size - 1) / 2;
    expect(f[c * size + c]).toBe(1);
    expect(f[0]).toBe(0);
    expect(f[size - 1]).toBe(0);
    expect(f[(size - 1) * size]).toBe(0);
  });
});

describe("asphalt exemplar generators", () => {
  const size = 64;

  it("are deterministic", () => {
    expect(generateAsphaltAlbedo(size, 12345)).toEqual(generateAsphaltAlbedo(size, 12345));
    expect(generateAsphaltNormal(size, 12345)).toEqual(generateAsphaltNormal(size, 12345));
    expect(generateAsphaltRoughness(size, 12345)).toEqual(generateAsphaltRoughness(size, 12345));
  });

  it("emit the right channel layout with values in [0, 1]", () => {
    const albedo = generateAsphaltAlbedo(size, 1);
    const normal = generateAsphaltNormal(size, 1);
    const roughness = generateAsphaltRoughness(size, 1);
    expect(albedo.channels).toBe(3);
    expect(normal.channels).toBe(3);
    expect(roughness.channels).toBe(1);
    expect(albedo.data.length).toBe(size * size * 3);
    expect(normal.data.length).toBe(size * size * 3);
    expect(roughness.data.length).toBe(size * size);
    for (const map of [albedo, normal, roughness]) {
      for (const v of map.data) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("buffer cache", () => {
  it("returns the same buffer object for the same identity", () => {
    const a = getSurfaceBuffer("asphalt", "albedo", 64);
    const b = getSurfaceBuffer("asphalt", "albedo", 64);
    expect(b).toBe(a);
  });

  it("treats a different variant as a different identity", () => {
    const a = getSurfaceBuffer("asphalt", "albedo", 64, 0);
    const b = getSurfaceBuffer("asphalt", "albedo", 64, 1);
    expect(b).not.toBe(a);
    expect(b.data).not.toEqual(a.data); // seeded per-segment variation must differ
  });

  it("serves every registered surface/kind pair with valid data", () => {
    const surfaces = [
      "asphalt",
      "sand",
      "metal",
      "zombieWalker",
      "zombieRunner",
      "zombieBrute",
      "carPaint",
      "debris",
      "foliage",
    ] as const;
    for (const surface of surfaces) {
      for (const kind of ["albedo", "normal", "roughness"] as const) {
        const map = getSurfaceBuffer(surface, kind, 32);
        expect(map.data.length).toBe(32 * 32 * map.channels);
        for (const v of map.data) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("canvas texture cache", () => {
  it("returns the same CanvasTexture object on a second request", () => {
    // Node test env has no DOM — the canvas layer is browser-only and must be
    // reachable (import stays side-effect free) but is exercised live instead.
    if (typeof document === "undefined") return;
    const a = getSurfaceTexture("asphalt", "albedo");
    const b = getSurfaceTexture("asphalt", "albedo");
    expect(b).toBe(a);
    expect(b.image.width).toBe(CONFIG.textures.defaultSize);
  });
});

describe("quality config pins", () => {
  it("pins the degradation order resolution → post → particles → shadows", () => {
    expect([...CONFIG.quality.degradationOrder]).toEqual(["resolution", "post", "particles", "shadows"]);
  });

  it("gives every tier a full knob set", () => {
    const q = CONFIG.quality;
    for (const key of ["pixelRatioScales", "particleDensity", "shadowMapSizes", "shadowsOn"] as const) {
      expect(q[key].length).toBe(q.startTier + 1);
    }
    expect(q.fpsTarget).toBe(60);
    expect(q.fpsFloor).toBeLessThanOrEqual(q.stepDownFps);
    expect(q.stepUpFps).toBeGreaterThan(q.fpsTarget);
  });
});
