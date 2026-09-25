/**
 * Shared render-tuning envelope: every number that shapes how bright the
 * neon world renders — bloom, exposure, light intensities, and the HDR
 * accent-color budget — collected in one place so the look can be retuned
 * without touching render call sites.
 *
 * This module is deliberately **pure data**: it imports nothing (least of all
 * three.js), constructs no `THREE.Color` objects, and has zero side effects,
 * so it is trivially importable from node/vitest. Colors are plain
 * `[r, g, b]` tuples; callers spread them into `new THREE.Color(...tuple)`
 * at the call site.
 *
 * All values below are the **frozen 2026-09 readability pass**, per design D4
 * of OpenSpec change `fix-render-readability`: refined from the D1 starting
 * values by a screenshot-iteration loop (see the change's `evidence/` folder —
 * `2.1-*.png` "before", `final-*.png` verified captures). The dominant
 * failure mode was bloom from *large screen-area sources*: the edge rails
 * tile a huge area when the spiral is viewed edge-on, and UnrealBloom's mip
 * chain multiplies such sources ~2.5-3x, so the rails must sit *below* the
 * bloom threshold and read as solid neon tubes, while halo duty is carried by
 * the compact HDR accents (rings, ribbons, pods). Do not raise `rail` back
 * over `BLOOM_THRESHOLD` — the scene whites out again.
 */

/** A color as a plain readonly `[r, g, b]` tuple (HDR values may exceed 1). */
export type Rgb = readonly [number, number, number];

// -- Bloom + tone mapping (src/main.ts). -------------------------------------

/**
 * UnrealBloomPass threshold, in HDR luminance. Emissives above this feed the
 * bloom pass; main.ts passes the trio as `(strength, radius, threshold)`.
 */
export const BLOOM_THRESHOLD = 0.85;
/** UnrealBloomPass strength — how hard over-threshold pixels glow. */
export const BLOOM_STRENGTH = 0.3;
/** UnrealBloomPass radius — bloom spread in pixels-relative units. */
export const BLOOM_RADIUS = 0.25;
/** ACES filmic tone-mapping exposure (`renderer.toneMappingExposure`). */
export const TONE_MAPPING_EXPOSURE = 1.0;

// -- Lighting intensities (src/world/Lighting.ts). ----------------------------

/** AmbientLight fill intensity. */
export const AMBIENT_INTENSITY = 0.7;
/** DirectionalLight key intensity. */
export const KEY_INTENSITY = 1.2;
/** Cyan PointLight accent intensity. */
export const CYAN_INTENSITY = 8;
/** Magenta PointLight accent intensity. */
export const MAGENTA_INTENSITY = 6;
/** Blue back-rim PointLight intensity. */
export const RIM_INTENSITY = 5;

// -- Accent color budget ------------------------------------------------------
// The deliberately overdriven emissive colors that carry the neon look. Each
// declared accent gets a per-channel ceiling ("budget") just above its max
// channel (rounded up to a clean tenth), so a guard test can tell a
// deliberate retune inside the envelope from a color pushed past it.
// 2026-09 readability freeze: the large-area cyan accents (`rail`,
// `packageRibbon`, `pod`) are trimmed to ≈1.0-1.4 so their bodies render as
// saturated neon instead of white; `rail` sits just *below* the bloom
// threshold on purpose (see the header — its area would flood the bloom mip
// chain), while the compact accents (rings, heart, slug, lips, ribbons, pod)
// stay overdriven above it and carry the halos. Matte markings like
// `dash`/`chasmGlow` also sit below the threshold on purpose.

/** Declared accent elements, in table order. */
export const ACCENT_KEYS = [
  'rail',
  'dash',
  'lipStrip',
  'packageRibbon',
  'heart',
  'slug',
  'asteroidWire',
  'whiteRing',
  'yellowRing',
  'redRing',
  'pod',
  'chasmGlow',
] as const;

/** One declared accent element in the budget table. */
export interface AccentSpec {
  /** Current HDR accent color; channels >1 are deliberate bloom drivers. */
  readonly color: Rgb;
  /** Per-channel ceiling — every channel of `color` must stay at or below it. */
  readonly budget: number;
}

/**
 * The declared HDR accent budget table, keyed by element name. Sources:
 * `rail`/`dash`/`lipStrip`/`chasmGlow` from TrackMesh.ts, the rest from
 * entities/factories.ts.
 */
export const ACCENTS = {
  /** Track edge rails (TrackMesh `RAIL_GLOW`) — below the bloom threshold on purpose (see header). */
  rail: { color: [0.1, 0.92, 1.02], budget: 1.2 },
  /** Center-line speed dashes (TrackMesh `DASH_GLOW`). */
  dash: { color: [0.12, 0.62, 0.72], budget: 0.8 },
  /** Magenta gap-lip warning strips (TrackMesh `LIP_STRIP_COLOR`). */
  lipStrip: { color: [1.7, 0.25, 1.5], budget: 1.8 },
  /** Package ribbon cross (factories `PACKAGE_RIBBON_COLOR`). */
  packageRibbon: { color: [0.2, 1.25, 1.4], budget: 1.5 },
  /** Heart pickup glow (factories `HEART_GLOW`). */
  heart: { color: [1.8, 0.45, 0.74], budget: 1.9 },
  /** Slug eyes/hazard glow (factories `SLUG_GLOW`). */
  slug: { color: [1.8, 0.24, 1.47], budget: 1.9 },
  /** Asteroid wireframe hazard rim (factories `ASTEROID_GLOW`). */
  asteroidWire: { color: [1.7, 0.3, 1.35], budget: 1.8 },
  /** Weapon-ladder reward ring (factories `WHITE_RING_COLOR`). */
  whiteRing: { color: [1.63, 1.63, 1.8], budget: 1.9 },
  /** Smart-bomb ring + its dashes (factories `YELLOW_RING_COLOR`). */
  yellowRing: { color: [1.8, 1.5, 0.26], budget: 1.9 },
  /** Trap ring double rim (factories `RED_RING_COLOR`). */
  redRing: { color: [1.8, 0.22, 0.27], budget: 1.9 },
  /** Jump-pod strip + chevrons (factories `POD_GLOW`). */
  pod: { color: [0.15, 1.25, 1.4], budget: 1.5 },
  /** Dim hazard glow on chasm floors (TrackMesh `CHASM_GLOW`). */
  chasmGlow: { color: [0.5, 0.07, 0.2], budget: 0.6 },
} as const satisfies Record<(typeof ACCENT_KEYS)[number], AccentSpec>;

// -- Non-accent material colors ----------------------------------------------
// Plain (non-bloom-driving) material colors, pinned at or below
// NON_ACCENT_MAX per channel. Stored as normalized sRGB `[r, g, b]`
// (each hex byte / 0xff), the same values the source files author as
// hex literals today.

/** Per-channel ceiling for every non-accent material color. */
export const NON_ACCENT_MAX = 1.0;

/**
 * The non-accent material colors, keyed by element name. Sources: the first
 * four from TrackMesh.ts, the last two from entities/factories.ts.
 */
export const NON_ACCENT_COLORS = {
  /** Road surface (TrackMesh `ROAD_COLOR` = 0x131a38). */
  road: [0x13 / 0xff, 0x1a / 0xff, 0x38 / 0xff],
  /** Road emissive tint (TrackMesh `ROAD_EMISSIVE` = 0x0d1534). */
  roadEmissive: [0x0d / 0xff, 0x15 / 0xff, 0x34 / 0xff],
  /** Chasm shaft walls, also their emissive (TrackMesh `CHASM_WALL_COLOR` = 0x080a16). */
  chasmWall: [0x08 / 0xff, 0x0a / 0xff, 0x16 / 0xff],
  /** Finish-gate posts + crossbar (TrackMesh gate `structureMaterial` = 0x1b2450). */
  gateFrame: [0x1b / 0xff, 0x24 / 0xff, 0x50 / 0xff],
  /** Package body base color (factories `PACKAGE_COLOR` = 0x27d8ef). */
  package: [0x27 / 0xff, 0xd8 / 0xff, 0xef / 0xff],
  /** Asteroid rock base color (factories `ASTEROID_COLOR` = 0x453a5c). */
  asteroid: [0x45 / 0xff, 0x3a / 0xff, 0x5c / 0xff],
} as const satisfies Record<string, Rgb>;
