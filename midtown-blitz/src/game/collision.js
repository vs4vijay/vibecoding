/**
 * Static collision world for the generated city (Midtown Blitz, task 2.3).
 *
 * Consumes the pure-data layout from {@link module:src/game/city-gen} and
 * indexes every solid static object as an axis-aligned bounding box (AABB)
 * in a uniform spatial hash (design Decision 5: "All buildings are
 * axis-aligned boxes registered in a uniform spatial hash of AABBs; props
 * that block ... registered likewise"):
 *
 *  - every `blocks[].buildings` entry becomes one box spanning the full
 *    footprint (x ± w/2, z ± d/2) from the block surface up to
 *    surfaceY + height;
 *  - every `props` entry with `collisionRadius > 0` (lamps AND trees — all
 *    generated props carry a radius) becomes a thin box of half-width
 *    `collisionRadius` around its trunk/pole, from its base `y` up to
 *    `y + height`.
 *
 * Queries are 2-D (x/z plane) because every registered box reaches the
 * ground where the car body lives; each record still carries its y extent
 * for debugging and future aerial checks. The car body (task 3.1) is a
 * circle or a two-circle capsule, so the query shapes here are circles and
 * capsules; body-vs-box response normals derive trivially from the record's
 * min/max fields.
 *
 * Elevation is NOT part of the hash: {@link CollisionWorld.surfaceHeightAt}
 * answers it with pure grid arithmetic — 0 on roads and the flat outer
 * margin, `CURB_M` (0.15) on every block surface (sidewalk ring, lot
 * interior, park lawn). The physics task treats crossing 0 <-> 0.15 as a
 * small bump-over step, never a wall (city-world spec "Curbs are
 * bump-over"): sample the surface under the body, lerp the wheels/ground
 * contact across the step, scrub a little speed if desired. A block's curb
 * line (|x - block.x| or |z - block.z| == blockM / 2) counts as block
 * surface (inclusive edge).
 *
 * Query contract (minimal allocation):
 *  - `circleHits` / `queryCapsule` return `null` when nothing is hit (the
 *    common case on open road — lets callers early-out with zero work), or
 *    a SHARED, REUSED array of AABB indices sorted arbitrarily. The array
 *    is owned by the world and is only valid until the next query call on
 *    that world; read `world.aabbs[i]` immediately, never retain or mutate
 *    the array. Concurrent/nested queries on one world are not supported
 *    (create a second world if ever needed).
 *  - `overlapsSolid` is the allocation-free boolean fast path.
 *  - Indices returned by earlier queries stay valid across `addAabb`
 *    (boxes are only ever appended).
 *
 * Purity: no three.js, no DOM, no randomness — a plain-node harness
 * (scripts/collision-test.mjs) builds a world from `generateCity()` and
 * cross-validates hash queries against brute-force scans, so the exact
 * same code path runs in the browser.
 *
 * Seams for later tasks:
 *  - Task 3.1 (car physics): drive the two-circle body with
 *    `overlapsSolid` for cheap probes and `queryCapsule` for resolution
 *    passes; compute push-out normals from `world.aabbs[i]` min/max
 *    fields; call `surfaceHeightAt` under the body each tick for the curb
 *    step.
 *  - Task 4.3 (parked cars): register each parked car at spawn time with
 *    `addAabb({x, z, w, d, y, height, tag, ref})` — O(cells touched),
 *    existing indices stay valid, queries see the box immediately.
 *  - Task 4.1 (lane graph) is collision-free by construction; nothing
 *    needed here.
 */

/** Layout/collision format version, bumped when the output shape changes. */
export const COLLISION_VERSION = 1;

/**
 * Uniform spatial hash cell size in meters (design Decision 5 range
 * ~16-32 m). A 78 m city pitch and building footprints <= ~58 m span at
 * most 3x3 cells per box; a car-sized query touches 1-4 cells.
 */
export const HASH_CELL_M = 20;

/** Cell-key bit layout: 16 bits per axis, centered far from any real cell. */
const KEY_OFFSET = 32768;
const KEY_SPAN = 65536;

/**
 * One solid static box in the world. Axis-aligned; y extent is carried for
 * debugging/future use (current queries are 2-D, see module header).
 *
 * @typedef {object} CollisionAabb
 * @property {number} minX Minimum x (m).
 * @property {number} maxX Maximum x (m).
 * @property {number} minZ Minimum z (m).
 * @property {number} maxZ Maximum z (m).
 * @property {number} minY Base elevation (m).
 * @property {number} maxY Top elevation (m).
 * @property {'building' | 'prop' | string} tag Source category
 *   ('building'/'prop' from the layout; `addAabb` callers may add their
 *   own, e.g. 'parked-car').
 * @property {object} ref The source layout object (CityBuilding / CityProp)
 *   or the `addAabb` caller's payload — identity-compare against it.
 */

/**
 * Build-time counters plus spatial-hash health stats (harness/debug).
 *
 * @typedef {object} CollisionStats
 * @property {number} buildings Boxes registered from block buildings.
 * @property {number} props Boxes registered from blocking props.
 * @property {number} cells Occupied hash cells.
 * @property {number} maxPerCell Largest number of boxes in any one cell.
 * @property {number} avgPerCell Mean boxes per occupied cell.
 */

/**
 * @typedef {object} CollisionWorld
 * @property {number} version COLLISION_VERSION of the producing module.
 * @property {number} cellSizeM Spatial hash cell size (m; = HASH_CELL_M).
 * @property {CollisionAabb[]} aabbs All boxes in registration order.
 *   Read-only by convention — only `addAabb` may append.
 * @property {number} aabbCount Number of registered boxes (aabbs.length).
 * @property {(x: number, z: number, radius: number) => number[] | null} circleHits
 *   Boxes within `radius` of point (x, z): null or shared index array
 *   (see query contract in the module header).
 * @property {(x1: number, z1: number, x2: number, z2: number, radius: number) => number[] | null} queryCapsule
 *   Boxes within `radius` of the closed segment (x1,z1)-(x2,z2) — an
 *   exact capsule test, so it also covers a two-circle car body joined by
 *   its hull. Same shared-array contract as `circleHits`.
 * @property {(x: number, z: number, radius: number) => boolean} overlapsSolid
 *   Allocation-free boolean fast path: does the circle touch any box?
 * @property {(x: number, z: number) => number} surfaceHeightAt
 *   Ground elevation: 0 on roads/margin, grid.curbM on block surfaces
 *   (sidewalks, lots, park lawn). Curb line counts as block (inclusive).
 * @property {(box: {x: number, z: number, w: number, d: number, y?: number, height?: number, tag?: string, ref?: object}) => CollisionAabb} addAabb
 *   Register a static box after construction (task 4.3 parked cars).
 *   Center + full width/depth, base y (default 0) and height (default 0).
 *   Returns the stored record; O(cells touched); prior indices stay valid.
 * @property {CollisionStats} stats Build-time registration/hash stats.
 */

/**
 * Build a collision world from a generated city layout
 * (see {@link CollisionWorld} and the module header for the contract).
 * Pure with respect to its input: reads the layout, never mutates it.
 * Registers `blocks[].buildings` (all of them, tower included) and every
 * prop with `collisionRadius > 0`.
 *
 * @param {import('./city-gen.js').CityLayout} layout Generated city layout.
 * @returns {CollisionWorld} Queryable static collision world.
 */
export function createCollisionWorld(layout) {
  const cell = HASH_CELL_M;
  /** @type {CollisionAabb[]} */
  const aabbs = [];
  /** @type {Map<number, number[]>} Cell key -> AABB indices (appendable). */
  const cells = new Map();

  let statsBuildings = 0;
  let statsProps = 0;

  /**
   * Stable integer key for a hash cell coordinate pair.
   * @param {number} cx Cell x index.
   * @param {number} cz Cell z index.
   * @returns {number} Map key.
   */
  function cellKey(cx, cz) {
    return (cx + KEY_OFFSET) * KEY_SPAN + (cz + KEY_OFFSET);
  }

  /**
   * Register an already-shaped record into every cell its bounds overlap.
   * @param {CollisionAabb} rec Box record (already pushed to `aabbs`).
   * @returns {void}
   */
  function insertIntoCells(rec) {
    const cx0 = Math.floor(rec.minX / cell);
    const cx1 = Math.floor(rec.maxX / cell);
    const cz0 = Math.floor(rec.minZ / cell);
    const cz1 = Math.floor(rec.maxZ / cell);
    // Guard against a pathological box flooding the hash (all real boxes
    // span a handful of cells; 64k cells is orders of magnitude above that).
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > 65536) {
      throw new RangeError(`addAabb: box spans too many hash cells (${(cx1 - cx0 + 1)}x${(cz1 - cz0 + 1)})`);
    }
    const idx = aabbs.length - 1;
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cz = cz0; cz <= cz1; cz += 1) {
        const key = cellKey(cx, cz);
        const bucket = cells.get(key);
        if (bucket) {
          bucket.push(idx);
        } else {
          cells.set(key, [idx]);
        }
      }
    }
  }

  /**
   * Shape + register one box from center/full-extent form.
   * @param {number} x Center x (m).
   * @param {number} z Center z (m).
   * @param {number} w Full width along x (m, > 0).
   * @param {number} d Full depth along z (m, > 0).
   * @param {number} minY Base elevation (m).
   * @param {number} maxY Top elevation (m).
   * @param {string} tag Source category.
   * @param {object} ref Source object.
   * @returns {CollisionAabb} The stored record.
   */
  function addBox(x, z, w, d, minY, maxY, tag, ref) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(w) || !Number.isFinite(d)) {
      throw new TypeError(`addAabb: x/z/w/d must be finite numbers (got ${x}, ${z}, ${w}, ${d})`);
    }
    if (w <= 0 || d <= 0) {
      throw new RangeError(`addAabb: w and d must be > 0 (got ${w} x ${d})`);
    }
    /** @type {CollisionAabb} */
    const rec = {
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      minY,
      maxY,
      tag,
      ref,
    };
    aabbs.push(rec);
    insertIntoCells(rec);
    return rec;
  }

  // --- register the generated city -----------------------------------------
  for (const block of layout.blocks) {
    for (const b of block.buildings) {
      addBox(b.x, b.z, b.w, b.d, block.surfaceY, block.surfaceY + b.height, 'building', b);
      statsBuildings += 1;
    }
  }
  for (const p of layout.props) {
    if (!(p.collisionRadius > 0)) continue; // non-blocking props would skip
    addBox(p.x, p.z, p.collisionRadius * 2, p.collisionRadius * 2, p.y, p.y + p.height, 'prop', p);
    statsProps += 1;
  }

  // --- spatial-hash stats ----------------------------------------------------
  let maxPerCell = 0;
  let totalRefs = 0;
  for (const bucket of cells.values()) {
    if (bucket.length > maxPerCell) maxPerCell = bucket.length;
    totalRefs += bucket.length;
  }
  const stats = Object.freeze({
    buildings: statsBuildings,
    props: statsProps,
    cells: cells.size,
    maxPerCell,
    avgPerCell: cells.size > 0 ? totalRefs / cells.size : 0,
  });

  // --- query scratch state (see module header contract) ----------------------
  // Per-box visited stamps make candidate gathering duplicate-free without
  // allocating a Set per query; `results` is the single shared hit buffer.
  let stamps = new Int32Array(Math.max(1024, aabbs.length));
  let stampVersion = 0;
  /** @type {number[]} */
  const results = [];

  /**
   * Gather the deduplicated indices of every box overlapping the given
   * world-space rect, into the shared `results` buffer.
   * @param {number} minX Rect minimum x (m).
   * @param {number} minZ Rect minimum z (m).
   * @param {number} maxX Rect maximum x (m).
   * @param {number} maxZ Rect maximum z (m).
   * @returns {number[]} Shared buffer of candidate indices (deduped).
   */
  function gatherCandidates(minX, minZ, maxX, maxZ) {
    while (stamps.length < aabbs.length) {
      stamps = new Int32Array(stamps.length * 2);
    }
    stampVersion += 1;
    const visited = stampVersion;
    results.length = 0;
    const cx0 = Math.floor(minX / cell);
    const cx1 = Math.floor(maxX / cell);
    const cz0 = Math.floor(minZ / cell);
    const cz1 = Math.floor(maxZ / cell);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cz = cz0; cz <= cz1; cz += 1) {
        const bucket = cells.get(cellKey(cx, cz));
        if (bucket === undefined) continue;
        for (let k = 0; k < bucket.length; k += 1) {
          const idx = bucket[k];
          if (stamps[idx] !== visited) {
            stamps[idx] = visited;
            results.push(idx);
          }
        }
      }
    }
    return results;
  }

  /**
   * Squared distance from a point to a box (0 when inside).
   * @param {number} x Point x (m).
   * @param {number} z Point z (m).
   * @param {CollisionAabb} rec Box record.
   * @returns {number} Squared distance (m^2).
   */
  function pointBoxDistSq(x, z, rec) {
    const dx = x < rec.minX ? rec.minX - x : x > rec.maxX ? x - rec.maxX : 0;
    const dz = z < rec.minZ ? rec.minZ - z : z > rec.maxZ ? z - rec.maxZ : 0;
    return dx * dx + dz * dz;
  }

  /**
   * Squared distance between two closed 2-D segments (Ericson, Real-Time
   * Collision Detection ch. 5.1.9, reduced to the plane). Degenerate
   * (zero-length) segments are handled as points.
   * @param {number} p1x Segment A start x.
   * @param {number} p1z Segment A start z.
   * @param {number} q1x Segment A end x.
   * @param {number} q1z Segment A end z.
   * @param {number} p2x Segment B start x.
   * @param {number} p2z Segment B start z.
   * @param {number} q2x Segment B end x.
   * @param {number} q2z Segment B end z.
   * @returns {number} Squared distance (m^2).
   */
  function segSegDistSq(p1x, p1z, q1x, q1z, p2x, p2z, q2x, q2z) {
    const d1x = q1x - p1x;
    const d1z = q1z - p1z;
    const d2x = q2x - p2x;
    const d2z = q2z - p2z;
    const rx = p1x - p2x;
    const rz = p1z - p2z;
    const a = d1x * d1x + d1z * d1z;
    const e = d2x * d2x + d2z * d2z;
    const f = d2x * rx + d2z * rz;
    const c = d1x * rx + d1z * rz;
    const b = d1x * d2x + d1z * d2z;
    const EPS = 1e-12;
    let s;
    let t;
    if (a <= EPS) {
      // Segment A degenerate: distance from point P1 to segment B.
      s = 0;
      t = e > EPS ? Math.min(1, Math.max(0, f / e)) : 0;
    } else if (e <= EPS) {
      // Segment B degenerate: distance from point P2 to segment A.
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
    const dx = p1x + d1x * s - (p2x + d2x * t);
    const dz = p1z + d1z * s - (p2z + d2z * t);
    return dx * dx + dz * dz;
  }

  /**
   * Squared distance from a closed segment to a box: 0 if either endpoint
   * is inside, else the minimum distance to the box's four edges (exact:
   * if the segment stays outside the box, its closest boundary point lies
   * on an edge).
   * @param {number} x1 Segment start x (m).
   * @param {number} z1 Segment start z (m).
   * @param {number} x2 Segment end x (m).
   * @param {number} z2 Segment end z (m).
   * @param {CollisionAabb} rec Box record.
   * @returns {number} Squared distance (m^2).
   */
  function segBoxDistSq(x1, z1, x2, z2, rec) {
    if (
      (x1 >= rec.minX && x1 <= rec.maxX && z1 >= rec.minZ && z1 <= rec.maxZ) ||
      (x2 >= rec.minX && x2 <= rec.maxX && z2 >= rec.minZ && z2 <= rec.maxZ)
    ) {
      return 0;
    }
    const top = segSegDistSq(x1, z1, x2, z2, rec.minX, rec.maxZ, rec.maxX, rec.maxZ);
    const bottom = segSegDistSq(x1, z1, x2, z2, rec.minX, rec.minZ, rec.maxX, rec.minZ);
    const left = segSegDistSq(x1, z1, x2, z2, rec.minX, rec.minZ, rec.minX, rec.maxZ);
    const right = segSegDistSq(x1, z1, x2, z2, rec.maxX, rec.minZ, rec.maxX, rec.maxZ);
    return Math.min(top, bottom, left, right);
  }

  /**
   * Circle query: every box within `radius` of (x, z).
   * @param {number} x Circle center x (m).
   * @param {number} z Circle center z (m).
   * @param {number} radius Circle radius (m, >= 0).
   * @returns {number[] | null} Shared array of AABB indices, or null.
   */
  function circleHits(x, z, radius) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) {
      throw new TypeError(`circleHits: needs finite x/z and radius >= 0 (got ${x}, ${z}, ${radius})`);
    }
    const radiusSq = radius * radius;
    const cand = gatherCandidates(x - radius, z - radius, x + radius, z + radius);
    let kept = 0;
    for (let k = 0; k < cand.length; k += 1) {
      const idx = cand[k];
      if (pointBoxDistSq(x, z, aabbs[idx]) <= radiusSq) {
        cand[kept] = idx;
        kept += 1;
      }
    }
    cand.length = kept;
    return kept > 0 ? cand : null;
  }

  /**
   * Capsule query: every box within `radius` of the closed segment
   * (x1,z1)-(x2,z2). Exact (segment-vs-box distance), so it covers both
   * endpoint circles and the hull between them — a two-circle car body can
   * pass its axle/center points directly.
   * @param {number} x1 Segment start x (m).
   * @param {number} z1 Segment start z (m).
   * @param {number} x2 Segment end x (m).
   * @param {number} z2 Segment end z (m).
   * @param {number} radius Capsule radius (m, >= 0).
   * @returns {number[] | null} Shared array of AABB indices, or null.
   */
  function queryCapsule(x1, z1, x2, z2, radius) {
    for (const v of [x1, z1, x2, z2, radius]) {
      if (!Number.isFinite(v)) {
        throw new TypeError(`queryCapsule: all inputs must be finite (got ${x1}, ${z1}, ${x2}, ${z2}, ${radius})`);
      }
    }
    if (radius < 0) {
      throw new RangeError(`queryCapsule: radius must be >= 0 (got ${radius})`);
    }
    const radiusSq = radius * radius;
    const minX = Math.min(x1, x2) - radius;
    const maxX = Math.max(x1, x2) + radius;
    const minZ = Math.min(z1, z2) - radius;
    const maxZ = Math.max(z1, z2) + radius;
    const cand = gatherCandidates(minX, minZ, maxX, maxZ);
    let kept = 0;
    for (let k = 0; k < cand.length; k += 1) {
      const idx = cand[k];
      if (segBoxDistSq(x1, z1, x2, z2, aabbs[idx]) <= radiusSq) {
        cand[kept] = idx;
        kept += 1;
      }
    }
    cand.length = kept;
    return kept > 0 ? cand : null;
  }

  /**
   * Allocation-free boolean fast path: does the circle touch any box?
   * Early-exits on the first hit; results otherwise match `circleHits`.
   * @param {number} x Circle center x (m).
   * @param {number} z Circle center z (m).
   * @param {number} radius Circle radius (m, >= 0).
   * @returns {boolean} True when at least one box overlaps the circle.
   */
  function overlapsSolid(x, z, radius) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) {
      throw new TypeError(`overlapsSolid: needs finite x/z and radius >= 0 (got ${x}, ${z}, ${radius})`);
    }
    const radiusSq = radius * radius;
    const cx0 = Math.floor((x - radius) / cell);
    const cx1 = Math.floor((x + radius) / cell);
    const cz0 = Math.floor((z - radius) / cell);
    const cz1 = Math.floor((z + radius) / cell);
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cz = cz0; cz <= cz1; cz += 1) {
        const bucket = cells.get(cellKey(cx, cz));
        if (bucket === undefined) continue;
        for (let k = 0; k < bucket.length; k += 1) {
          if (pointBoxDistSq(x, z, aabbs[bucket[k]]) <= radiusSq) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Ground elevation under a point (module header: elevation model). Pure
   * grid arithmetic — no hash, no per-block data. Points beyond the outer
   * blocks (flat world margin) read 0.
   *
   * @param {number} x World x (m).
   * @param {number} z World z (m).
   * @returns {number} Surface elevation: 0 (road/margin) or grid.curbM
   *   (block surface). Curb line counts as block surface (inclusive edge).
   */
  function surfaceHeightAt(x, z) {
    const { n, pitchM, blockM, curbM } = layout.grid;
    // Center coordinate of block column/row 0 (grid is symmetric on both
    // axes: blockCenter(i) = (i - (n - 1) / 2) * pitchM).
    const origin = (-(n - 1) / 2) * pitchM;
    const ix = Math.round((x - origin) / pitchM);
    const iz = Math.round((z - origin) / pitchM);
    if (ix < 0 || ix > n - 1 || iz < 0 || iz > n - 1) {
      return 0; // outside the block lattice: road margin flat ground
    }
    const dx = Math.abs(x - (origin + ix * pitchM));
    const dz = Math.abs(z - (origin + iz * pitchM));
    return dx <= blockM / 2 && dz <= blockM / 2 ? curbM : 0;
  }

  /**
   * Register a static box after construction (task 4.3 parked cars).
   * Appends to `aabbs` and the hash; indices from earlier queries stay
   * valid; subsequent queries immediately see the box.
   *
   * @param {object} box Center + full extents (same rect convention as the
   *   city layout), plus optional base elevation, height, category tag and
   *   caller payload ref.
   * @param {number} box.x Center x (m).
   * @param {number} box.z Center z (m).
   * @param {number} box.w Full width along x (m, > 0).
   * @param {number} box.d Full depth along z (m, > 0).
   * @param {number} [box.y=0] Base elevation (m).
   * @param {number} [box.height=0] Height above base (m).
   * @param {string} [box.tag='dynamic'] Category tag.
   * @param {object} [box.ref] Caller payload (identity-comparable).
   * @returns {CollisionAabb} The stored record.
   */
  function addAabb(box) {
    if (box === null || typeof box !== 'object') {
      throw new TypeError('addAabb: needs a {x, z, w, d, ...} box descriptor');
    }
    return addBox(box.x, box.z, box.w, box.d, box.y ?? 0, (box.y ?? 0) + (box.height ?? 0), box.tag ?? 'dynamic', box.ref ?? null);
  }

  return {
    version: COLLISION_VERSION,
    cellSizeM: HASH_CELL_M,
    aabbs,
    get aabbCount() {
      return aabbs.length;
    },
    circleHits,
    queryCapsule,
    overlapsSolid,
    surfaceHeightAt,
    addAabb,
    stats,
  };
}
