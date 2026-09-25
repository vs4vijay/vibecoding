import * as THREE from 'three';

import { createEntity, type Entity } from '../entities/Entity';
import { VISUAL_FACTORIES } from '../entities/factories';
import { createTrackFrame, type TrackCurve, type TrackFrame } from '../track/TrackCurve';
import { POD_EDGE_OFFSET } from '../track/TrackGaps';
import type { LevelDefinition, LevelFeature } from '../track/LevelLoader';
import { lowerBound } from './Collision';

/**
 * Entity streaming: activate entities in an s-window ahead of the player,
 * recycle them behind. Only window entities have a visible, animated mesh —
 * frame time stays flat no matter how long the level is, and the entity list
 * is built once per level load (pooling: retries reuse every record and
 * visual, so nothing allocates during play).
 *
 * The entities array is sorted by `s`, which the collision system relies on
 * for its sliding-window scan; window tracking itself is two monotonic
 * indices advanced amortized-O(1) per step.
 */

export interface SpawnerOptions {
  /** How far ahead of the player entities activate, in s units. Defaults to 250. */
  ahead?: number;
  /** How far behind the player entities recycle, in s units. Defaults to 50. */
  behind?: number;
}

/** Default spacing of packages inside a packageArc when `span` is not authored. */
const ARC_SPACING_S = 12;

export class Spawner {
  /** Scene root for every entity visual; add to the scene once. */
  public readonly group = new THREE.Group();

  private readonly track: TrackCurve;
  private readonly ahead: number;
  private readonly behind: number;

  private entityList: Entity[] = [];
  /** Window is the half-open range [loIndex, hiIndex) of the sorted list. */
  private loIndex = 0;
  private hiIndex = 0;
  private windowDirty = true;
  private elapsed = 0;

  // Reused scratch — activation runs per entity, never allocates.
  private readonly frame: TrackFrame = createTrackFrame();

  public constructor(track: TrackCurve, options: SpawnerOptions = {}) {
    this.track = track;
    this.ahead = options.ahead ?? 250;
    this.behind = options.behind ?? 50;
    if (!(this.ahead > 0) || !(this.behind > 0)) {
      throw new RangeError('Spawner ahead/behind windows must be positive');
    }
    this.group.name = 'entities';
  }

  /** Live entity records, sorted by ascending `s`. */
  public get entities(): readonly Entity[] {
    return this.entityList;
  }

  public get entityCount(): number {
    return this.entityList.length;
  }

  /** Number of entities currently inside the activation window. */
  public get activeCount(): number {
    let count = 0;
    for (let i = this.loIndex; i < this.hiIndex; i += 1) {
      if (this.entityList[i].active) count += 1;
    }
    return count;
  }

  /**
   * Rebuilds the pool from a level's features: expands packageArcs into
   * package chains, creates one pooled visual per entity, sorts by `s`.
   * Feature types with no factory (turboPad — a later phase) are skipped with
   * a warning; the loader already guaranteed they are registry-known.
   *
   * `gap` features are structure, not entities: the road hole lives in
   * TrackMesh/TrackGaps, but a `jumpPod: true` gap expands into the
   * road-spanning jumpPod entity at its leading edge. A standalone `jumpPod`
   * feature spawns the same entity (TrackGaps.spanForPod pairs it with the
   * gap it precedes at launch time).
   */
  public load(level: LevelDefinition): void {
    this.clear();

    const entities: Entity[] = [];
    const warned = new Set<string>();
    for (const feature of level.features) {
      const expanded = expandFeature(feature, level.length);
      if (expanded === null) {
        if (!warned.has(feature.type)) {
          warned.add(feature.type);
          console.warn(`Spawner: no factory for feature type "${feature.type}" — skipped`);
        }
        continue;
      }
      for (const entity of expanded) {
        entity.visual = VISUAL_FACTORIES[entity.type](entity);
        entity.visual.object.visible = false;
        this.group.add(entity.visual.object);
        entities.push(entity);
      }
    }

    entities.sort((a, b) => a.s - b.s || a.id - b.id);
    this.entityList = entities;
    this.windowDirty = true;
  }

  /**
   * Advances the activation window around `playerS` and animates the active
   * entities by `dt` seconds. Window indices only ever move forward —
   * amortized O(1) per step plus O(active) animation work.
   */
  public update(playerS: number, dt: number): void {
    this.elapsed += dt;

    if (this.windowDirty) {
      this.loIndex = lowerBound(this.entityList, playerS - this.behind);
      this.hiIndex = this.loIndex;
      this.windowDirty = false;
    }

    const entities = this.entityList;
    const aheadLimit = playerS + this.ahead;
    while (this.hiIndex < entities.length && entities[this.hiIndex].s <= aheadLimit) {
      this.activate(entities[this.hiIndex]);
      this.hiIndex += 1;
    }

    const behindLimit = playerS - this.behind;
    while (this.loIndex < this.hiIndex && entities[this.loIndex].s < behindLimit) {
      const entity = entities[this.loIndex];
      if (entity.active) {
        entity.active = false;
        if (entity.visual) entity.visual.object.visible = false;
      }
      this.loIndex += 1;
    }

    for (let i = this.loIndex; i < this.hiIndex; i += 1) {
      const entity = entities[i];
      if (entity.alive && entity.active && entity.visual) {
        entity.visual.update(dt, this.elapsed);
      }
    }
  }

  /** Marks an entity collected/destroyed: dead and inactive, hidden immediately. */
  public kill(entity: Entity): void {
    entity.alive = false;
    entity.active = false;
    if (entity.visual) entity.visual.object.visible = false;
  }

  /** Revives the whole pool for a retry and rewinds the window to `playerS`. */
  public reset(playerS = 0): void {
    for (const entity of this.entityList) {
      entity.alive = true;
      entity.active = false;
      if (entity.visual) entity.visual.object.visible = false;
    }
    this.elapsed = 0;
    this.loIndex = 0;
    this.hiIndex = 0;
    this.windowDirty = true;
    // Prewarm the window so the road ahead is populated on the first frame.
    this.update(playerS, 0);
  }

  /** Drops every entity and visual (called by `load` and on teardown). */
  public clear(): void {
    this.group.clear();
    this.entityList = [];
    this.loIndex = 0;
    this.hiIndex = 0;
    this.elapsed = 0;
    this.windowDirty = true;
  }

  /** First activation: place the pooled mesh in world space on the road. */
  private activate(entity: Entity): void {
    if (entity.active || !entity.alive) return;
    entity.active = true;
    this.track.sToWorld(entity.s, entity.x, this.frame);
    const object = entity.visual?.object;
    if (object) {
      object.position.copy(this.frame.position);
      object.quaternion.copy(this.frame.quaternion);
      object.visible = true;
    }
  }
}

/**
 * Expands one level feature into entity records. Returns null for known
 * feature types that have no Phase 2 factory yet. Throws RangeError on
 * malformed params — level JSON passes the loader, so this catches authoring
 * mistakes like `count: 0`.
 */
export function expandFeature(feature: LevelFeature, levelLength: number): Entity[] | null {
  switch (feature.type) {
    case 'package':
      return [createEntity('package', feature.at, requireLane(feature, 'lane'), { sourceType: 'package' })];
    case 'heart':
      return [createEntity('heart', feature.at, requireLane(feature, 'lane'), { sourceType: 'heart' })];
    case 'slug':
      return [createEntity('slug', feature.at, requireLane(feature, 'lane'), { sourceType: 'slug' })];
    case 'asteroid':
      return [createEntity('asteroid', feature.at, requireLane(feature, 'lane'), { sourceType: 'asteroid' })];
    case 'whiteRing':
      // Rings span the whole road — always at the lane-less center.
      return [createEntity('whiteRing', feature.at, 0, { sourceType: 'whiteRing' })];
    case 'yellowRing':
      return [createEntity('yellowRing', feature.at, 0, { sourceType: 'yellowRing' })];
    case 'redRing':
      // The trap is lane-placed and dodgeable — steer around it or eat −60%.
      return [createEntity('redRing', feature.at, requireLane(feature, 'lane'), { sourceType: 'redRing' })];
    case 'jumpPod':
      // Standalone trampoline; pairs with the gap it precedes at launch time.
      return [createEntity('jumpPod', feature.at, 0, { sourceType: 'jumpPod' })];
    case 'gap': {
      // The hole itself is track structure (TrackGaps + TrackMesh); a pod'd
      // gap contributes its launch entity just before the open air.
      const jumpPod = feature.params['jumpPod'] ?? false;
      if (jumpPod !== true) return [];
      const podS = Math.max(0, Math.min(levelLength, feature.at - POD_EDGE_OFFSET));
      return [createEntity('jumpPod', podS, 0, { sourceType: 'gap' })];
    }
    case 'packageArc':
      return expandPackageArc(feature, levelLength);
    default:
      return null;
  }
}

/**
 * A packageArc: `count` packages over `span` s-units whose lateral offsets
 * sweep from `lane` to `toLane` along a smoothstep curve — the chain traces
 * the racing line through the corner.
 */
function expandPackageArc(feature: LevelFeature, levelLength: number): Entity[] {
  const params = feature.params;
  const lane = requireLane(feature, 'lane');
  const toLane = params['toLane'] === undefined ? lane : requireLane(feature, 'toLane');
  const count = readCount(feature);
  const span =
    params['span'] === undefined ? Math.max(count - 1, 1) * ARC_SPACING_S : requireFinite(params['span'], 'span', feature);

  const entities: Entity[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0;
    const eased = t * t * (3 - 2 * t);
    const s = Math.min(levelLength, feature.at + span * t);
    entities.push(createEntity('package', s, lane + (toLane - lane) * eased, { sourceType: 'packageArc' }));
  }
  return entities;
}

function readCount(feature: LevelFeature): number {
  const raw = feature.params['count'] ?? 5;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new RangeError(`feature "${feature.type}" at ${feature.at}: "count" must be a positive integer, got ${String(raw)}`);
  }
  return raw;
}

function requireLane(feature: LevelFeature, field: 'lane' | 'toLane'): number {
  const raw = feature.params[field];
  return raw === undefined ? 0 : requireFinite(raw, field, feature);
}

function requireFinite(raw: unknown, field: string, feature: LevelFeature): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new RangeError(`feature "${feature.type}" at ${feature.at}: "${field}" must be a finite number, got ${String(raw)}`);
  }
  return raw;
}

/** Spawn types the Spawner can build today (used by the level validation test). */
export const SPAWNABLE_FEATURE_TYPES: readonly string[] = [
  'package',
  'packageArc',
  'heart',
  'slug',
  'asteroid',
  'whiteRing',
  'yellowRing',
  'redRing',
  'jumpPod',
  'gap',
];
