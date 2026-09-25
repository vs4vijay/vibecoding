import { isKnownFeatureType, KNOWN_FEATURE_TYPES } from '../entities/SpawnRegistry';
import type { Vec3Tuple } from './TrackCurve';

/**
 * Level JSON → runtime level definition.
 *
 * `parseLevel` is a pure validator (no Vite-specific code) so tests feed it
 * inline JSON. `loadBundledLevels` is the production path: it pulls every
 * `levels/*.json` into the bundle at build time via `import.meta.glob`
 * (eager, no fetch at runtime) and parses each through the same validator.
 */

/** One validated feature entry from a level's `features` array. */
export interface LevelFeature {
  /** Registry-validated feature type (see SpawnRegistry). */
  readonly type: string;
  /** Arc-length position along the track, in [0, length]. */
  readonly at: number;
  /** Any remaining type-specific fields from the JSON (lane, count, width, ...). */
  readonly params: Readonly<Record<string, unknown>>;
}

/** A fully validated level, ready for TrackCurve/TrackMesh/Spawner construction. */
export interface LevelDefinition {
  readonly id: number;
  readonly name: string;
  /** Declared track length; TrackCurve verifies the spline matches it. */
  readonly length: number;
  /** Auto-forward speed in world units per second. */
  readonly cruiseSpeed: number;
  readonly controlPoints: readonly Vec3Tuple[];
  readonly features: readonly LevelFeature[];
}

/** Level data is unusable — message always carries the offending level id. */
export class LevelLoadError extends Error {
  public constructor(levelId: string, message: string) {
    super(`Level ${levelId}: ${message}`);
    this.name = 'LevelLoadError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(record: Record<string, unknown>, field: string, levelId: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LevelLoadError(levelId, `field "${field}" must be a finite number, got ${JSON.stringify(value) ?? String(value)}`);
  }
  return value;
}

function requirePositiveInteger(record: Record<string, unknown>, field: string, levelId: string): number {
  const value = requireNumber(record, field, levelId);
  if (!Number.isInteger(value) || value <= 0) {
    throw new LevelLoadError(levelId, `field "${field}" must be a positive integer, got ${value}`);
  }
  return value;
}

function parseControlPoints(raw: unknown, levelId: string): Vec3Tuple[] {
  if (!Array.isArray(raw)) {
    throw new LevelLoadError(levelId, `"controlPoints" must be an array of [x, y, z] triples`);
  }
  if (raw.length < 2) {
    throw new LevelLoadError(levelId, `"controlPoints" needs at least 2 points to define a curve, got ${raw.length}`);
  }
  return raw.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 3) {
      throw new LevelLoadError(levelId, `controlPoints[${index}] must be an [x, y, z] triple`);
    }
    const [x, y, z] = point;
    for (const component of [x, y, z]) {
      if (typeof component !== 'number' || !Number.isFinite(component)) {
        throw new LevelLoadError(levelId, `controlPoints[${index}] contains a non-finite component: ${JSON.stringify(point)}`);
      }
    }
    return [x, y, z] as Vec3Tuple;
  });
}

function parseFeatures(raw: unknown, levelId: string, length: number, name: string): LevelFeature[] {
  if (!Array.isArray(raw)) {
    throw new LevelLoadError(levelId, `"features" must be an array`);
  }
  return raw.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new LevelLoadError(levelId, `features[${index}] must be an object, got ${JSON.stringify(entry) ?? String(entry)}`);
    }
    const { type, at, ...rest } = entry;
    if (typeof type !== 'string' || type.length === 0) {
      throw new LevelLoadError(levelId, `features[${index}] is missing a string "type"`);
    }
    if (!isKnownFeatureType(type)) {
      // Hard throw: unknown feature types would silently skip spawning.
      throw new LevelLoadError(
        levelId,
        `feature ${index} in "${name}" has unknown type "${type}" (known types: ${KNOWN_FEATURE_TYPES.join(', ')})`,
      );
    }
    if (typeof at !== 'number' || !Number.isFinite(at)) {
      throw new LevelLoadError(levelId, `features[${index}] ("${type}") needs a finite number "at"`);
    }
    if (at < 0 || at > length) {
      throw new LevelLoadError(levelId, `features[${index}] ("${type}") at=${at} is outside the track range [0, ${length}]`);
    }
    return { type, at, params: rest };
  });
}

/**
 * Validates one raw level (e.g. a parsed JSON file) into a LevelDefinition.
 * Throws LevelLoadError with the level id in the message on any problem.
 */
export function parseLevel(raw: unknown): LevelDefinition {
  if (!isPlainObject(raw)) {
    throw new LevelLoadError('unknown', `level JSON must be an object, got ${raw === null ? 'null' : typeof raw}`);
  }

  // The id is extracted first so every later error message can carry it.
  const id = requirePositiveInteger(raw, 'id', 'unknown');
  const levelId = String(id);

  const name = raw['name'];
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new LevelLoadError(levelId, `"name" must be a non-empty string`);
  }

  const length = requireNumber(raw, 'length', levelId);
  if (length <= 0) {
    throw new LevelLoadError(levelId, `"length" must be positive, got ${length}`);
  }

  const cruiseSpeed = requireNumber(raw, 'cruiseSpeed', levelId);
  if (cruiseSpeed <= 0) {
    throw new LevelLoadError(levelId, `"cruiseSpeed" must be positive, got ${cruiseSpeed}`);
  }

  const controlPoints = parseControlPoints(raw['controlPoints'], levelId);
  const features = parseFeatures(raw['features'], levelId, length, name);

  return { id, name, length, cruiseSpeed, controlPoints, features };
}

/**
 * Loads every bundled `levels/*.json` (build-time import.meta.glob, eager) and
 * returns them keyed by level id. Duplicate ids are a hard error.
 *
 * Note: the glob pattern must be a string literal — Vite rewrites it at build
 * time, so it cannot be lifted into a constant.
 */
export function loadBundledLevels(): Map<number, LevelDefinition> {
  // Eager + default import: the JSON is parsed and inlined into the bundle,
  // so no network fetch is ever involved.
  const modules = import.meta.glob('../../levels/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

  const levels = new Map<number, LevelDefinition>();
  for (const [path, raw] of Object.entries(modules)) {
    const level = parseLevel(raw);
    if (levels.has(level.id)) {
      throw new LevelLoadError(String(level.id), `duplicate level id ${level.id} (also defined by ${path})`);
    }
    levels.set(level.id, level);
  }
  if (levels.size === 0) {
    throw new LevelLoadError('unknown', 'no level files matched "../../levels/*.json"');
  }
  return levels;
}

/** Loads the lowest-id bundled level — the default campaign start. */
export function loadDefaultLevel(): LevelDefinition {
  const levels = loadBundledLevels();
  const lowestId = Math.min(...levels.keys());
  return levels.get(lowestId) as LevelDefinition;
}
