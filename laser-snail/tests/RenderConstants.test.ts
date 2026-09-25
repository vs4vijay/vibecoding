import { describe, expect, it } from 'vitest';

import {
  ACCENTS,
  ACCENT_KEYS,
  AMBIENT_INTENSITY,
  BLOOM_THRESHOLD,
  CYAN_INTENSITY,
  KEY_INTENSITY,
  MAGENTA_INTENSITY,
  NON_ACCENT_COLORS,
  NON_ACCENT_MAX,
  RIM_INTENSITY,
  TONE_MAPPING_EXPOSURE,
  type Rgb,
} from '../src/render/tuning';

/**
 * Regression guard for the 2026-09 readability pass (design D2/D3/D5 of
 * OpenSpec change `fix-render-readability`): pins the render-tuning envelope
 * declared in `src/render/tuning.ts` inside the bounds that keep the scene
 * readable. It pins structure, not beauty — the look itself is verified by
 * the screenshot pass archived in the change's `evidence/` folder.
 *
 * The white-out mechanism being guarded against (discovered by that pass):
 * bloom seeded from *large screen-area* sources. The edge rails tile a huge
 * area edge-on and UnrealBloom's mip chain amplifies such sources ~2.5–3x,
 * so any rail luminance over `BLOOM_THRESHOLD` floods the track (design D5).
 */

/** Rec.709 relative luminance of a linear-light `[r, g, b]` tuple. */
function rec709Luminance(color: Rgb): number {
  return 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
}

/**
 * Required headroom between the rail's luminance and `BLOOM_THRESHOLD`, as a
 * fraction of the threshold (design D5 plus the risks note "keep margins
 * ≥ 10% from clip points").
 */
const RAIL_BLOOM_MARGIN = 0.1;

/**
 * Readability floor for `BLOOM_THRESHOLD` — derived from the discovered
 * white-out mechanism, not arbitrarily. The rails are an extended accent that
 * must sit below the bloom threshold with ≥10%-of-threshold headroom, i.e.
 * `BLOOM_THRESHOLD ≥ railLuminance / (1 − 0.1)`. The frozen rail color
 * `[0.1, 0.92, 1.02]` has Rec.709 luminance ≈ 0.7529, so the floor is
 * 0.7529 / 0.9 ≈ 0.8365, rounded up to the clean value below. Lowering the
 * threshold back toward the pre-fix 0.28 fails this floor and re-whites the
 * scene.
 */
const BLOOM_THRESHOLD_FLOOR = 0.84;

/**
 * Readability ceilings for the light intensities: the frozen screenshot-pass
 * values plus ~10–15% headroom, rounded to clean numbers. Past these the base
 * render overexposes and mid-tone surfaces start feeding bloom again.
 */
const LIGHT_CEILINGS = {
  CYAN_INTENSITY: 10,
  MAGENTA_INTENSITY: 8,
  RIM_INTENSITY: 7,
  AMBIENT_INTENSITY: 0.85,
  KEY_INTENSITY: 1.4,
} as const;

/** Readability window for ACES tone-mapping exposure. */
const EXPOSURE_MIN = 0.9;
const EXPOSURE_MAX = 1.15;

describe('RenderConstants (render tuning envelope guard)', () => {
  it('keeps BLOOM_THRESHOLD at or above the rail-derived readability floor', () => {
    expect(
      BLOOM_THRESHOLD,
      `BLOOM_THRESHOLD ${BLOOM_THRESHOLD} is below the readability floor ${BLOOM_THRESHOLD_FLOOR} — white-out will return (design D5)`,
    ).toBeGreaterThanOrEqual(BLOOM_THRESHOLD_FLOOR);

    // The binding constraint behind the floor, checked live: the rail's
    // luminance must stay ≥10%-of-threshold below BLOOM_THRESHOLD.
    const railLuminance = rec709Luminance(ACCENTS.rail.color);
    expect(
      railLuminance + RAIL_BLOOM_MARGIN * BLOOM_THRESHOLD,
      `BLOOM_THRESHOLD ${BLOOM_THRESHOLD} does not clear the rail luminance ${railLuminance} by the required ${RAIL_BLOOM_MARGIN * 100}% margin — rail-seeded bloom whites out the scene (design D5)`,
    ).toBeLessThanOrEqual(BLOOM_THRESHOLD);
  });

  it('caps every light intensity at its readability ceiling', () => {
    const lights: ReadonlyArray<[string, number, number]> = [
      ['CYAN_INTENSITY', CYAN_INTENSITY, LIGHT_CEILINGS.CYAN_INTENSITY],
      ['MAGENTA_INTENSITY', MAGENTA_INTENSITY, LIGHT_CEILINGS.MAGENTA_INTENSITY],
      ['RIM_INTENSITY', RIM_INTENSITY, LIGHT_CEILINGS.RIM_INTENSITY],
      ['AMBIENT_INTENSITY', AMBIENT_INTENSITY, LIGHT_CEILINGS.AMBIENT_INTENSITY],
      ['KEY_INTENSITY', KEY_INTENSITY, LIGHT_CEILINGS.KEY_INTENSITY],
    ];
    for (const [name, value, ceiling] of lights) {
      expect(
        value,
        `${name} ${value} exceeds its readability ceiling ${ceiling} — the base render overexposes and the scene washes out`,
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  it('keeps TONE_MAPPING_EXPOSURE inside its readability window', () => {
    expect(
      TONE_MAPPING_EXPOSURE,
      `TONE_MAPPING_EXPOSURE ${TONE_MAPPING_EXPOSURE} is below the readability window minimum ${EXPOSURE_MIN} — the scene goes muddy`,
    ).toBeGreaterThanOrEqual(EXPOSURE_MIN);
    expect(
      TONE_MAPPING_EXPOSURE,
      `TONE_MAPPING_EXPOSURE ${TONE_MAPPING_EXPOSURE} is above the readability window maximum ${EXPOSURE_MAX} — the frame overexposes`,
    ).toBeLessThanOrEqual(EXPOSURE_MAX);
  });

  it('keeps every accent channel inside its declared budget', () => {
    expect(
      Object.keys(ACCENTS).sort(),
      `ACCENTS keys [${Object.keys(ACCENTS).sort().join(', ')}] do not match the declared ACCENT_KEYS [${[...ACCENT_KEYS].sort().join(', ')}]`,
    ).toEqual([...ACCENT_KEYS].sort());

    for (const key of ACCENT_KEYS) {
      const { color, budget } = ACCENTS[key];
      for (let i = 0; i < color.length; i += 1) {
        expect(
          color[i],
          `ACCENTS.${key}.color[${i}] ${color[i]} is negative — accent channels must be ≥ 0`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          color[i],
          `ACCENTS.${key}.color[${i}] ${color[i]} exceeds its budget ${budget} — raise the budget alongside the retune (budget stays a real ceiling)`,
        ).toBeLessThanOrEqual(budget);
      }
      const maxChannel = Math.max(...color);
      expect(
        budget,
        `ACCENTS.${key} budget ${budget} is not above its max channel ${maxChannel} — budget must stay a real ceiling`,
      ).toBeGreaterThan(maxChannel);
    }
  });

  it('keeps the rail (extended accent) below the bloom threshold — design D5', () => {
    const railLuminance = rec709Luminance(ACCENTS.rail.color);
    expect(
      railLuminance,
      `extended accent 'rail' luminance ${railLuminance} must stay below BLOOM_THRESHOLD ${BLOOM_THRESHOLD} — rail-seeded bloom whites out the scene (design D5)`,
    ).toBeLessThan(BLOOM_THRESHOLD);
  });

  it('caps every non-accent material channel at NON_ACCENT_MAX', () => {
    for (const [key, color] of Object.entries(NON_ACCENT_COLORS)) {
      for (let i = 0; i < color.length; i += 1) {
        expect(
          color[i],
          `NON_ACCENT_COLORS.${key}.color[${i}] ${color[i]} exceeds NON_ACCENT_MAX ${NON_ACCENT_MAX} — non-accent surfaces must not feed bloom`,
        ).toBeLessThanOrEqual(NON_ACCENT_MAX);
      }
    }
  });
});
