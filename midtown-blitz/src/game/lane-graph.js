/**
 * Lane graph over the road grid (Midtown Blitz, task 4.1).
 *
 * Derives the ambient-traffic road network as pure data from a generated
 * city layout (design Decision 7: "traffic as a lane graph, two lanes per
 * road, right-hand traffic"): one directed lane per travel direction on
 * every road segment between adjacent intersections, plus one node per
 * intersection with straight/left/right turn choices (U-turns excluded).
 * Task 4.2's pooled AI cars consume this graph; nothing here moves cars.
 *
 * Right-hand rule (derived once, from the codebase's documented frame):
 *  - Heading convention (src/game/config.js, car-physics): forward =
 *    (sin(heading), cos(heading)); heading 0 faces +Z, PI/2 faces +X, and
 *    INCREASING heading turns toward +X (positive steer), i.e. increasing
 *    heading is a LEFT turn, decreasing a RIGHT turn.
 *  - The driver's right of travel is the forward direction rotated by
 *    -PI/2: rightOfDir(dx, dz) = (-dz, dx). Evidence: src/main.js spawns
 *    the player "heading +Z ... the driver's right side is -X" at
 *    x = -laneOffsetM — so a +Z traveler's right-hand lane is offset -X.
 *  - Therefore each road segment carries its two lanes at
 *    +/- grid.laneOffsetM on the side given by rightOfDir:
 *      travel +Z -> lane at centerlineX - laneOffsetM
 *      travel -Z -> lane at centerlineX + laneOffsetM
 *      travel +X -> lane at centerlineZ + laneOffsetM
 *      travel -X -> lane at centerlineZ - laneOffsetM
 *    (same rule as driving on the right: opposing lanes never share a side).
 *
 * Geometry: each intersection owns a square "junction box" of half-size
 * roadM / 2 (7 m) around the node — the full asphalt of the crossing.
 * A lane's straight waypoints span from the from-node's box edge to the
 * to-node's box edge (the 64 m alongside each block); the gap inside the
 * boxes is bridged by {@link LaneGraph.nextChoice} connector waypoints:
 *  - straight: [box entry, box exit] along the same lane line;
 *  - left/right: a tangent quarter-circle arc from the incoming lane's end
 *    to the outgoing lane's start (radius roadM/2 -/+ laneOffsetM — 3.5 m
 *    right, 10.5 m left with the shipped constants), sampled at 25/50/75%
 *    plus its endpoints, so a waypoint follower traces a smooth arc that
 *    stays entirely on the junction asphalt.
 *
 * API surface for task 4.2:
 *  - {@link buildLaneGraph}(layout) -> graph with `nodes` and `lanes`
 *    (shapes: {@link LaneNode}, {@link Lane}).
 *  - graph.nextChoice(node, incomingLane, rng) -> { turn, exitLane,
 *    waypoints, arcRadiusM } (shape: {@link LaneTurnChoice}) — uniform
 *    pick among the available non-U-turn options, using the CALLER's rng
 *    stream (this module draws nothing itself). graph.choicesAt(node,
 *    incomingLane) exposes the full option list (weighted/filtered picks,
 *    tests).
 *  - graph.randomLaneAt(x, z, radius, rng) -> Lane | null — a random lane
 *    passing within `radius` of a world point (spawn/recycle near player).
 *  - graph.getLane(indexOrId), plus plain lane fields for traversal: every
 *    lane has fromNode/toNode indices, a fixed heading, and waypoints.
 *
 * Determinism: buildLaneGraph is a pure function of its layout argument —
 * no randomness, no clock (verified byte-identical by
 * scripts/lane-graph-test.mjs). All choice/spawn randomness is injected.
 *
 * Purity: plain data + math only — no three.js, no DOM, node-testable.
 * Deliberately NOT wired into src/main.js (task 4.2 owns integration).
 */

/** Layout/graph format version, bumped when the output shape changes. */
export const LANE_GRAPH_VERSION = 1;

/** Turn labels used in {@link LaneTurnChoice}.turn, in steering order. */
export const TURN_CHOICES = Object.freeze(['straight', 'left', 'right']);

/**
 * One x/z world point in meters (frozen in graph output).
 *
 * @typedef {object} LanePoint
 * @property {number} x World x (m).
 * @property {number} z World z (m).
 */

/**
 * An intersection node of the lane graph — one per grid crossing
 * (linesX.length * linesZ.length nodes; 121 for the shipped city).
 *
 * @typedef {object} LaneNode
 * @property {string} id Stable id `N{ix}:{iz}` (debug/dumps).
 * @property {number} ix Column index into grid.linesX (0..lines-1).
 * @property {number} iz Row index into grid.linesZ (0..lines-1).
 * @property {number} x Node world x (= grid.linesX[ix], m).
 * @property {number} z Node world z (= grid.linesZ[iz], m).
 * @property {number[]} inLanes Indices of lanes ENDING here (graph.lanes
 *   entries), in lane-creation order.
 * @property {number[]} outLanes Indices of lanes STARTING here.
 */

/**
 * One directed lane on one road segment, between two adjacent nodes.
 * `axis` is the TRAVEL axis: a 'z' lane drives along z on a vertical road
 * (whose centerline is grid.linesX[line]); an 'x' lane drives along x on a
 * horizontal road (centerline grid.linesZ[line]).
 *
 * @typedef {object} Lane
 * @property {string} id Stable id `{axis}{+|dir}{line}:{segment}`, e.g.
 *   `z+5:3` = +Z travel on the x-line 5 road, segment 3 (debug/dumps).
 * @property {number} index Index into LaneGraph.lanes.
 * @property {'x' | 'z'} axis Travel axis.
 * @property {number} dir Travel direction sign along the axis (+1 | -1).
 * @property {number} line Road-line index: into grid.linesX for axis 'z',
 *   into grid.linesZ for axis 'x'.
 * @property {number} segment Segment index between adjacent grid lines
 *   (0..lines-2): the lane runs between grid lines `segment` and
 *   `segment + 1` of the cross axis.
 * @property {number} fromNode Index of the node the lane starts at.
 * @property {number} toNode Index of the node the lane ends at.
 * @property {number} heading Yaw along the lane (rad; forward = (sin, cos)):
 *   0 (+Z), PI (-Z), PI/2 (+X), -PI/2 (-X) — matches the physics/camera
 *   convention, so `mesh.rotation.y = heading` faces travel.
 * @property {LanePoint[]} waypoints The straight part of the lane, from the
 *   from-node's junction-box edge to the to-node's box edge (2 points).
 *   The junction boxes at either end are bridged by turn connectors from
 *   {@link LaneGraph.nextChoice}.
 * @property {LanePoint} start First waypoint (=== waypoints[0]).
 * @property {LanePoint} end Last waypoint (=== waypoints[1]).
 * @property {LanePoint} midpoint Waypoint midpoint (spawn/recycling aid).
 * @property {number} lengthM Straight-part length (m).
 */

/**
 * One intersection traversal option: how to get from an incoming lane to
 * an outgoing lane through a node. Waypoints ALWAYS begin exactly at the
 * incoming lane's `end` and end exactly at the exit lane's `start`, so a
 * follower can chain lane -> choice -> lane -> ... seamlessly.
 *
 * @typedef {object} LaneTurnChoice
 * @property {'straight' | 'left' | 'right'} turn Maneuver label (relative
 *   to the incoming travel direction; 'right' = heading -PI/2, 'left' =
 *   heading +PI/2). U-turns are never offered.
 * @property {Lane} exitLane The outgoing lane to merge onto.
 * @property {LanePoint[]} waypoints Path through the junction: straight =
 *   [box entry, box exit] (2 points, collinear with the lane line); turns
 *   = [arc start (= incoming end), 25%, 50%, 75%, arc end (= exit start)]
 *   (5 points on a tangent quarter-circle).
 * @property {number} arcRadiusM Arc radius (m); 0 for straight. Useful for
 *   turn-speed limits (task 4.2 slows for turns).
 */

/**
 * Queryable lane graph over a city layout (see module header).
 *
 * @typedef {object} LaneGraph
 * @property {number} version LANE_GRAPH_VERSION of the producing module.
 * @property {LaneNode[]} nodes All intersection nodes (row-major: index =
 *   ix + iz * grid.linesX.length).
 * @property {Lane[]} lanes All directed lanes (creation order: z-axis
 *   lanes then x-axis lanes, line asc, segment asc, +dir before -dir).
 * @property {(nodeOrIndex: LaneNode | number | string, incomingLane: Lane | string | number, rng: import('../engine/rng.js').Rng) => LaneTurnChoice | null} nextChoice
 *   Pick a random available continuation through `node` after arriving on
 *   `incomingLane` (straight/left/right, U-turns excluded; only options
 *   whose exit segment exists are offered — corners offer exactly one).
 *   Returns a shared frozen choice (do not mutate) or null if the node
 *   offers no continuation. Draws from `rng` only.
 * @property {(nodeOrIndex: LaneNode | number | string, incomingLane: Lane | string | number) => LaneTurnChoice[]} choicesAt
 *   All available continuations through `node` after `incomingLane` (the
 *   exact array {@link LaneGraph.nextChoice} picks from; shared + frozen,
 *   do not mutate). Deterministic — no rng.
 * @property {(x: number, z: number, radius: number, rng: import('../engine/rng.js').Rng) => Lane | null} randomLaneAt
 *   Uniform random lane passing within `radius` of world point (x, z)
 *   (point-to-segment distance to the lane's straight part). Null when no
 *   lane is in range. Spawn/recycle aid for task 4.2; draws from `rng`.
 * @property {(indexOrId: number | string) => Lane} getLane
 *   Look up a lane by index or string id (throws when unknown).
 */

/**
 * Unit travel vector for a lane axis/direction (frozen).
 * @param {'x' | 'z'} axis Travel axis.
 * @param {number} dir Travel sign (+1 | -1).
 * @returns {LanePoint} Unit forward vector.
 */
function dirVector(axis, dir) {
  return axis === 'z' ? { x: 0, z: dir } : { x: dir, z: 0 };
}

/**
 * The driver's right of travel for a forward vector (module header rule):
 * rightOfDir(dx, dz) = (-dz, dx) — forward rotated by -PI/2.
 * @param {number} dx Forward x component.
 * @param {number} dz Forward z component.
 * @returns {LanePoint} Unit right vector.
 */
function rightOfDir(dx, dz) {
  return { x: -dz, z: dx };
}

/**
 * Yaw heading for a lane axis/direction (forward = (sin h, cos h)).
 * @param {'x' | 'z'} axis Travel axis.
 * @param {number} dir Travel sign (+1 | -1).
 * @returns {number} Heading in rad (multiple of PI/2).
 */
function headingOf(axis, dir) {
  if (axis === 'z') return dir > 0 ? 0 : Math.PI;
  return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
}

/**
 * Classify the maneuver from an incoming lane to an outgoing lane at a
 * shared node: 'straight' (same travel axis), else 'right' when the exit
 * direction equals the incoming right-of-travel, else 'left'. U-turns must
 * be filtered before calling (an opposite-direction lane on the same road
 * classifies as neither straight nor a 90-degree turn by construction —
 * callers exclude them first).
 * @param {Lane} inLane Incoming lane.
 * @param {Lane} outLane Outgoing lane.
 * @returns {'straight' | 'left' | 'right'} Maneuver label.
 */
function classifyTurn(inLane, outLane) {
  if (inLane.axis === outLane.axis) return 'straight';
  const fwd = dirVector(inLane.axis, inLane.dir);
  const right = rightOfDir(fwd.x, fwd.z);
  const out = dirVector(outLane.axis, outLane.dir);
  return out.x === right.x && out.z === right.z ? 'right' : 'left';
}

/**
 * Is `outLane` the reverse of `inLane` (a U-turn on the same road)?
 * @param {Lane} inLane Incoming lane.
 * @param {Lane} outLane Candidate exit lane.
 * @returns {boolean} True when the exit is the incoming lane reversed.
 */
function isUTurn(inLane, outLane) {
  return inLane.axis === outLane.axis && inLane.dir === -outLane.dir && inLane.line === outLane.line;
}

/**
 * Round a value to 10 decimals to keep exact arithmetic exact through
 * atan2/cos/sin sampling (pure, deterministic).
 * @param {number} v Value.
 * @returns {number} Rounded value.
 */
function snap(v) {
  return Math.round(v * 1e10) / 1e10;
}

/**
 * Build the turn connector for one (incoming lane, exit lane) pair at a
 * node: straight crosses the junction box along the lane line; turns are
 * tangent quarter-circle arcs from the incoming end to the exit start.
 * The arc center is the corner where the entry lane's line meets the exit
 * lane's line, which makes the radius exactly roadM/2 - laneOffsetM for
 * right turns and roadM/2 + laneOffsetM for left turns, and keeps every
 * sampled point inside the junction box (on asphalt).
 * @param {Lane} inLane Incoming lane (uses `.end`).
 * @param {Lane} outLane Exit lane (uses `.start`).
 * @param {'straight' | 'left' | 'right'} turn Maneuver label.
 * @returns {{ waypoints: LanePoint[], arcRadiusM: number }} Connector data.
 */
function buildConnector(inLane, outLane, turn) {
  const e = inLane.end;
  const s = outLane.start;
  if (turn === 'straight') {
    return { waypoints: [e, s], arcRadiusM: 0 };
  }
  // Arc center: on the line through the entry point perpendicular to the
  // entry travel (so tangent at the incoming lane's end) and on the line
  // through the exit point perpendicular to the exit travel (tangent at
  // the outgoing lane's start). Entry along z -> those lines are
  // x = exit.x / z = entry.x; mirrored for entry along x.
  const cx = inLane.axis === 'z' ? s.x : e.x;
  const cz = inLane.axis === 'z' ? e.z : s.z;
  const r = Math.hypot(e.x - cx, e.z - cz);
  const a0 = Math.atan2(e.z - cz, e.x - cx);
  const a1 = Math.atan2(s.z - cz, s.x - cx);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2; // exactly +/-PI/2: shortest arc
  const waypoints = [e];
  for (const t of [0.25, 0.5, 0.75]) {
    const a = a0 + sweep * t;
    waypoints.push({ x: snap(cx + r * Math.cos(a)), z: snap(cz + r * Math.sin(a)) });
  }
  waypoints.push(s);
  return { waypoints, arcRadiusM: r };
}

/**
 * Derive the lane graph from a generated city layout (module header for
 * the rule set and shapes). Pure: reads `layout.grid` only, mutates
 * nothing, draws no randomness; the same layout always yields a
 * byte-identical graph.
 *
 * @param {import('./city-gen.js').CityLayout} layout Generated city layout
 *   (uses grid.linesX/linesZ/roadM/laneOffsetM).
 * @returns {LaneGraph} Frozen, queryable lane graph.
 */
export function buildLaneGraph(layout) {
  if (!layout || !layout.grid) {
    throw new TypeError('buildLaneGraph: needs a city layout with a grid');
  }
  const { linesX, linesZ, roadM, laneOffsetM } = layout.grid;
  if (!Array.isArray(linesX) || !Array.isArray(linesZ) || linesX.length < 2 || linesZ.length < 2) {
    throw new TypeError('buildLaneGraph: grid.linesX/linesZ must be arrays of >= 2 centerlines');
  }
  for (const v of [...linesX, ...linesZ]) {
    if (!Number.isFinite(v)) throw new TypeError('buildLaneGraph: grid centerlines must be finite');
  }
  if (!Number.isFinite(roadM) || roadM <= 0 || !Number.isFinite(laneOffsetM) || laneOffsetM <= 0) {
    throw new RangeError('buildLaneGraph: grid.roadM and grid.laneOffsetM must be positive');
  }

  const H = roadM / 2; // junction box half-size: the crossing's full asphalt
  const nX = linesX.length;
  const nZ = linesZ.length;

  const freezePoint = (p) => Object.freeze({ x: p.x, z: p.z });

  // --- nodes: one per grid crossing (ix + iz * nX) --------------------------
  /** @type {LaneNode[]} */
  const nodes = [];
  for (let iz = 0; iz < nZ; iz += 1) {
    for (let ix = 0; ix < nX; ix += 1) {
      nodes.push({
        id: `N${ix}:${iz}`,
        ix,
        iz,
        x: linesX[ix],
        z: linesZ[iz],
        inLanes: [],
        outLanes: [],
      });
    }
  }
  const nodeIndex = (ix, iz) => ix + iz * nX;

  // --- lanes: two directed lanes per segment per road line ------------------
  /** @type {Lane[]} */
  const lanes = [];

  /**
   * Create one directed lane and register it with its end nodes.
   * @param {'x' | 'z'} axis Travel axis.
   * @param {number} dir Travel sign.
   * @param {number} line Road-line index (linesX for 'z', linesZ for 'x').
   * @param {number} segment Cross-axis segment index.
   * @param {LanePoint} start Straight-part start (box edge of fromNode).
   * @param {LanePoint} end Straight-part end (box edge of toNode).
   * @param {number} fromIx From-node column index.
   * @param {number} fromIz From-node row index.
   * @param {number} toIx To-node column index.
   * @param {number} toIz To-node row index.
   * @returns {void}
   */
  function addLane(axis, dir, line, segment, start, end, fromIx, fromIz, toIx, toIz) {
    const from = nodeIndex(fromIx, fromIz);
    const to = nodeIndex(toIx, toIz);
    const w0 = freezePoint(start);
    const w1 = freezePoint(end);
    /** @type {Lane} */
    const lane = {
      id: `${axis}${dir > 0 ? '+' : '-'}${line}:${segment}`,
      index: lanes.length,
      axis,
      dir,
      line,
      segment,
      fromNode: from,
      toNode: to,
      heading: headingOf(axis, dir),
      waypoints: Object.freeze([w0, w1]),
      start: w0,
      end: w1,
      midpoint: Object.freeze({ x: (w0.x + w1.x) / 2, z: (w0.z + w1.z) / 2 }),
      lengthM: Math.hypot(w1.x - w0.x, w1.z - w0.z),
    };
    lanes.push(lane);
    nodes[from].outLanes.push(lane.index);
    nodes[to].inLanes.push(lane.index);
  }

  // Vertical roads (centerlines linesX[i]): lanes travel along z. Right-hand
  // rule: +Z travel keeps to -X (module header), -Z travel to +X.
  for (let i = 0; i < nX; i += 1) {
    const cx = linesX[i];
    for (let j = 0; j + 1 < nZ; j += 1) {
      const z0 = linesZ[j];
      const z1 = linesZ[j + 1];
      addLane('z', +1, i, j, { x: cx - laneOffsetM, z: z0 + H }, { x: cx - laneOffsetM, z: z1 - H }, i, j, i, j + 1);
      addLane('z', -1, i, j, { x: cx + laneOffsetM, z: z1 - H }, { x: cx + laneOffsetM, z: z0 + H }, i, j + 1, i, j);
    }
  }
  // Horizontal roads (centerlines linesZ[j]): lanes travel along x. Right-hand
  // rule: +X travel keeps to +Z, -X travel to -Z.
  for (let j = 0; j < nZ; j += 1) {
    const cz = linesZ[j];
    for (let i = 0; i + 1 < nX; i += 1) {
      const x0 = linesX[i];
      const x1 = linesX[i + 1];
      addLane('x', +1, j, i, { x: x0 + H, z: cz + laneOffsetM }, { x: x1 - H, z: cz + laneOffsetM }, i, j, i + 1, j);
      addLane('x', -1, j, i, { x: x1 - H, z: cz - laneOffsetM }, { x: x0 + H, z: cz - laneOffsetM }, i + 1, j, i, j);
    }
  }

  // --- intersection choices: per node, parallel to node.inLanes -------------
  // choices[nodeIndex][k] is the option list for node.inLanes[k]; each entry
  // is precomputed (connector included) so nextChoice is allocation-free.
  /** @type {LaneTurnChoice[][][]} */
  const choicesByNode = nodes.map((node) =>
    node.inLanes.map((inLaneIndex) => {
      const inLane = lanes[inLaneIndex];
      /** @type {LaneTurnChoice[]} */
      const options = [];
      for (const outIndex of node.outLanes) {
        const outLane = lanes[outIndex];
        if (isUTurn(inLane, outLane)) continue; // no U-turns (traffic spec)
        const turn = classifyTurn(inLane, outLane);
        const connector = buildConnector(inLane, outLane, turn);
        options.push(
          Object.freeze({
            turn,
            exitLane: outLane,
            waypoints: Object.freeze(connector.waypoints.map(freezePoint)),
            arcRadiusM: connector.arcRadiusM,
          })
        );
      }
      return Object.freeze(options);
    })
  );

  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const nodeIndexById = new Map(nodes.map((node) => [node.id, nodeIndex(node.ix, node.iz)]));

  /**
   * Normalize a lane argument (object, index, or id string) to a lane.
   * @param {Lane | string | number} ref Lane reference.
   * @returns {Lane} The lane.
   */
  function toLane(ref) {
    if (typeof ref === 'string') {
      const lane = laneById.get(ref);
      if (!lane) throw new RangeError(`lane-graph: unknown lane id "${ref}"`);
      return lane;
    }
    if (typeof ref === 'number') {
      const lane = lanes[ref];
      if (!lane) throw new RangeError(`lane-graph: unknown lane index ${ref}`);
      return lane;
    }
    if (ref && typeof ref === 'object' && lanes[ref.index] === ref) return ref;
    throw new TypeError('lane-graph: expected a Lane, lane index, or lane id');
  }

  /**
   * Squared distance from point (x, z) to a lane's straight segment.
   * @param {Lane} lane Lane to measure against.
   * @param {number} x Point x (m).
   * @param {number} z Point z (m).
   * @returns {number} Squared distance (m^2).
   */
  function distSqToLane(lane, x, z) {
    const [a, b] = lane.waypoints;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minZ = Math.min(a.z, b.z);
    const maxZ = Math.max(a.z, b.z);
    const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
    return dx * dx + dz * dz;
  }

  /**
   * Resolve a node argument (object, index, or id string) to its node.
   * @param {LaneNode | number | string} ref Node reference.
   * @returns {LaneNode | null} The node, or null when unresolvable.
   */
  function resolveNode(ref) {
    if (typeof ref === 'number') return nodes[ref] ?? null;
    if (typeof ref === 'string') {
      const ix = nodeIndexById.get(ref);
      return ix === undefined ? null : nodes[ix];
    }
    if (ref && typeof ref === 'object' && Array.isArray(ref.inLanes)) return ref;
    return null;
  }

  /** @type {LaneGraph} */
  const graph = {
    version: LANE_GRAPH_VERSION,
    nodes,
    lanes,

    nextChoice(nodeOrIndexOrId, incomingLane, rng) {
      if (typeof rng?.int !== 'function') {
        throw new TypeError('lane-graph: nextChoice needs an rng with .int() (caller-owned stream)');
      }
      const options = graph.choicesAt(nodeOrIndexOrId, incomingLane);
      if (options.length === 0) return null;
      return options[rng.int(0, options.length - 1)];
    },

    choicesAt(nodeOrIndexOrId, incomingLane) {
      const node = resolveNode(nodeOrIndexOrId);
      if (!node) throw new TypeError('lane-graph: choicesAt needs a LaneNode, node index, or node id');
      const lane = toLane(incomingLane);
      const k = node.inLanes.indexOf(lane.index);
      if (k < 0) {
        throw new RangeError(`lane-graph: lane ${lane.id} does not end at node ${node.id}`);
      }
      return choicesByNode[nodeIndex(node.ix, node.iz)][k];
    },

    randomLaneAt(x, z, radius, rng) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) {
        throw new TypeError(`lane-graph: randomLaneAt needs finite x/z and radius >= 0 (got ${x}, ${z}, ${radius})`);
      }
      if (typeof rng?.int !== 'function') {
        throw new TypeError('lane-graph: randomLaneAt needs an rng with .int() (caller-owned stream)');
      }
      const radiusSq = radius * radius;
      let count = 0;
      for (const lane of lanes) {
        if (distSqToLane(lane, x, z) <= radiusSq) count += 1;
      }
      if (count === 0) return null;
      let pick = rng.int(0, count - 1);
      for (const lane of lanes) {
        if (distSqToLane(lane, x, z) <= radiusSq) {
          if (pick === 0) return lane;
          pick -= 1;
        }
      }
      return null; // unreachable
    },

    getLane(indexOrId) {
      return toLane(indexOrId);
    },
  };

  // Freeze nodes/lanes and the graph shell so consumers cannot corrupt the
  // network (functions stay callable; JSON dumps see only data fields).
  for (const node of nodes) {
    node.inLanes = Object.freeze(node.inLanes);
    node.outLanes = Object.freeze(node.outLanes);
    Object.freeze(node);
  }
  for (const lane of lanes) Object.freeze(lane);
  return Object.freeze(graph);
}
