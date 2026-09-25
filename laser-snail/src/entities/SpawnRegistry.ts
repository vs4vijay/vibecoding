/**
 * Registry of every feature type a level JSON may reference.
 *
 * The LevelLoader validates each feature's `type` against this registry and
 * hard-throws on unknown types, so a typo in level data fails at load time
 * instead of silently producing an empty stretch of road. Phase 2 attaches
 * mesh factories to these definitions; Phase 1 only needs the type set.
 */

/** Broad behavior family of a feature, for HUD color language and stats. */
export type FeatureCategory =
  | 'pickup' // packages, hearts — cyan/green, score or health
  | 'hazard' // slugs, asteroids — magenta, damage or fail
  | 'ring' // white/yellow/red tori — weapon ladder, bomb, trap
  | 'structure' // road modifications — gaps, jump pods
  | 'booster'; // positive utility — reserved (turbo pads, etc.)

/** Metadata for one feature type. `paramSchema` arrives with Phase 2 factories. */
export interface FeatureDefinition {
  readonly category: FeatureCategory;
  /** Human-readable summary, used in loader error messages. */
  readonly description: string;
}

/**
 * The full vertical-slice roster from the design spec (section 4). Types the
 * loader accepts but the game does not yet spawn are still valid level data —
 * levels may be authored ahead of the implementation.
 */
export const FEATURE_REGISTRY: Readonly<Record<string, FeatureDefinition>> = {
  package: { category: 'pickup', description: 'single mail package (+100 pts)' },
  packageArc: { category: 'pickup', description: 'arc of packages suggesting the racing line' },
  heart: { category: 'pickup', description: 'restores one postal-meter pip' },
  slug: { category: 'hazard', description: 'contact knocks Turbo off (fail)' },
  asteroid: { category: 'hazard', description: 'lane blocker, destructible by cannon' },
  whiteRing: { category: 'ring', description: 'weapon ladder up' },
  yellowRing: { category: 'ring', description: 'smart bomb — clears enemies in window' },
  redRing: { category: 'ring', description: 'trap — heavy speed cut' },
  gap: { category: 'structure', description: 'removed ribbon segment; fall = game over' },
  jumpPod: { category: 'structure', description: 'trampoline arc over gap segments' },
  turboPad: { category: 'booster', description: 'temporary speed boost' },
} as const;

/** All feature types the loader accepts. */
export const KNOWN_FEATURE_TYPES: readonly string[] = Object.keys(FEATURE_REGISTRY);

export function isKnownFeatureType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(FEATURE_REGISTRY, type);
}

/** Registry lookup; `undefined` for unknown types. */
export function getFeatureDefinition(type: string): FeatureDefinition | undefined {
  return isKnownFeatureType(type) ? FEATURE_REGISTRY[type] : undefined;
}
