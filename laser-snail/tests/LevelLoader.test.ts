import { describe, expect, it } from 'vitest';

import { LevelLoadError, parseLevel, type LevelDefinition } from '../src/track/LevelLoader';

/** Inline level JSON (tests never depend on the levels/ directory). */
const VALID_LEVEL = {
  id: 7,
  name: 'Test Run',
  length: 1200,
  cruiseSpeed: 36,
  controlPoints: [
    [0, 0, 0],
    [0, 0, -200],
    [80, 10, -400],
    [0, 18, -600],
    [-80, 6, -800],
    [0, 0, -1000],
  ],
  features: [
    { type: 'packageArc', at: 200, lane: -1, count: 5 },
    { type: 'slug', at: 340, lane: 0 },
    { type: 'gap', at: 800, width: 60, jumpPod: true },
  ],
};

function expectLevelLoadError(run: () => unknown): LevelLoadError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(LevelLoadError);
  return caught as LevelLoadError;
}

describe('LevelLoader.parseLevel', () => {
  it('parses a valid level and preserves feature params', () => {
    const level: LevelDefinition = parseLevel(structuredClone(VALID_LEVEL));

    expect(level.id).toBe(7);
    expect(level.name).toBe('Test Run');
    expect(level.length).toBe(1200);
    expect(level.cruiseSpeed).toBe(36);
    expect(level.controlPoints).toHaveLength(6);
    expect(level.controlPoints[2]).toEqual([80, 10, -400]);

    expect(level.features).toHaveLength(3);
    expect(level.features[0]).toMatchObject({ type: 'packageArc', at: 200, params: { lane: -1, count: 5 } });
    expect(level.features[2]).toMatchObject({ type: 'gap', at: 800, params: { width: 60, jumpPod: true } });
  });

  it('accepts an empty features array', () => {
    const level = parseLevel({ ...structuredClone(VALID_LEVEL), features: [] });
    expect(level.features).toEqual([]);
  });

  it('hard-throws on an unknown feature type, naming the level id and type', () => {
    const bad = { ...structuredClone(VALID_LEVEL), features: [{ type: 'turret', at: 100 }] };
    const error = expectLevelLoadError(() => parseLevel(bad));

    expect(error.message).toContain('7'); // level id
    expect(error.message).toContain('turret'); // unknown type
  });

  it('throws when a feature is missing its type or position', () => {
    expectLevelLoadError(() =>
      parseLevel({ ...structuredClone(VALID_LEVEL), features: [{ at: 100 }] }),
    );
    expectLevelLoadError(() =>
      parseLevel({ ...structuredClone(VALID_LEVEL), features: [{ type: 'slug' }] }),
    );
    expectLevelLoadError(() =>
      parseLevel({ ...structuredClone(VALID_LEVEL), features: [{ type: 'slug', at: 'soon' }] }),
    );
  });

  it('throws when a feature sits outside the track range', () => {
    expectLevelLoadError(() =>
      parseLevel({ ...structuredClone(VALID_LEVEL), features: [{ type: 'slug', at: 1200.01 }] }),
    );
    expectLevelLoadError(() =>
      parseLevel({ ...structuredClone(VALID_LEVEL), features: [{ type: 'slug', at: -1 }] }),
    );
  });

  it('throws on malformed controlPoints', () => {
    const onePoint = { ...structuredClone(VALID_LEVEL), controlPoints: [[0, 0, 0]] };
    expectLevelLoadError(() => parseLevel(onePoint));

    const wrongShape = { ...structuredClone(VALID_LEVEL), controlPoints: [[0, 0], [1, 2, 3]] };
    expectLevelLoadError(() => parseLevel(wrongShape));

    const nonFinite = { ...structuredClone(VALID_LEVEL), controlPoints: [[0, Number.NaN, 0], [1, 2, 3]] };
    expectLevelLoadError(() => parseLevel(nonFinite));

    const notAnArray = { ...structuredClone(VALID_LEVEL), controlPoints: 'straight line' };
    expectLevelLoadError(() => parseLevel(notAnArray));
  });

  it('throws on missing or invalid scalar fields, including the id when known', () => {
    expectLevelLoadError(() => parseLevel('not an object'));
    expectLevelLoadError(() => parseLevel(null));

    const missingId = { ...structuredClone(VALID_LEVEL) } as Record<string, unknown>;
    delete missingId['id'];
    expectLevelLoadError(() => parseLevel(missingId));

    expectLevelLoadError(() => parseLevel({ ...structuredClone(VALID_LEVEL), id: 0 }));
    expectLevelLoadError(() => parseLevel({ ...structuredClone(VALID_LEVEL), id: 1.5 }));
    expectLevelLoadError(() => parseLevel({ ...structuredClone(VALID_LEVEL), name: '   ' }));
    expectLevelLoadError(() => parseLevel({ ...structuredClone(VALID_LEVEL), length: -5 }));
    expectLevelLoadError(() => parseLevel({ ...structuredClone(VALID_LEVEL), length: 'long' }));
    expectLevelLoadError(() => parseLevel({ ...structuredClone(VALID_LEVEL), cruiseSpeed: 0 }));
  });
});
