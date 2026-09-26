/**
 * Blitz race definitions + medal mapping (Midtown Blitz game, task 5.4).
 *
 * Design Decision 9: "races as data". Every Blitz route is a frozen
 * definition object — a named start pose (position + heading) on the road
 * grid, an ordered list of checkpoint points placed ON grid intersections,
 * a time limit, and gold/silver/bronze medal thresholds — and ONE state
 * machine (src/game/race-controller.js) drives all of them. Cruise is the
 * same controller fed {@link CRUISE_EVENT}: no start override, no
 * checkpoints, no timer — it never finishes and only a pause-quit ends it
 * (race-events spec "Cruise free-roam mode").
 *
 * Grid geometry (src/game/city-gen.js): road centerlines sit at
 * `(i - 5) * 78` m for grid line i (10x10 blocks, 11 lines per axis, road
 * half-width 7 m, lane offset 3.5 m), so every coordinate below is an exact
 * intersection of one `grid.linesX` line and one `grid.linesZ` line —
 * the center of a junction box, the middle of clear asphalt at road level
 * (y = 0). Starts sit in the right-hand travel lane (3.5 m off a
 * centerline, per the lane-graph right-hand rule) a block or two before
 * the first checkpoint, heading along their road (heading 0 = +Z,
 * PI/2 = +X — the shared physics/camera convention), so every attempt
 * launches down open asphalt.
 *
 * Tuning model (documented so the numbers can be re-derived): let L be the
 * driving length of the route — the Manhattan sum of start -> cp1 ->
 * cp2 -> ... (each hop along grid roads, the shortest legal drive between
 * consecutive checkpoints). Thresholds are L divided by a target average
 * speed, rounded to the nearest half second:
 *   gold   = L / 31 m/s  (~112 km/h average — ~56% of the 55.56 m/s top
 *                         speed, so a clean 60-70% top-speed run beats gold;
 *                         race-events spec "gold achievable at ~60-70% of
 *                         top speed")
 *   silver = L / 26 m/s  (~94 km/h)
 *   bronze = L / 21.5 m/s (~77 km/h — a casual but continuous pace)
 *   limit  = L / 17 m/s  (~61 km/h — generous; running out of time takes
 *                         deliberate stalling)
 * All three routes share the model, so difficulty scales with length and
 * turn density, not with arbitrary per-route fudging.
 *
 * The three ids/names MUST stay equal to the menu's {@link MENU_EVENTS}
 * ids/names (src/ui/main-menu.js renders cards from that list and the save
 * records of task 5.5 key on these ids); the plain-node harness
 * (scripts/race-controller-test.mjs) cross-checks the two tables so a
 * rename cannot silently split them. main-menu.js imports the route data
 * from here for its card meta lines — the dependency points ui -> game,
 * never the reverse.
 *
 * Purity: frozen plain data + one pure function — no three.js, no DOM, no
 * randomness, no clock; identical imports are byte-identical.
 */

/**
 * Medal time thresholds in ms. `gold < silver < bronze < timeLimitMs`;
 * finishing at or under a threshold earns that medal or better.
 *
 * @typedef {object} MedalThresholds
 * @property {number} gold Gold cutoff (ms) — finish <= this for gold.
 * @property {number} silver Silver cutoff (ms).
 * @property {number} bronze Bronze cutoff (ms).
 */

/**
 * One checkpoint gate: an exact grid-intersection coordinate plus a label.
 * Shape-compatible with test-route.js's RouteCheckpoint (the HUD/marker
 * consumers take both).
 *
 * @typedef {object} RaceCheckpoint
 * @property {number} x World x (m; = grid.linesX[ix]).
 * @property {number} z World z (m; = grid.linesZ[iz]).
 * @property {string} label Display label ('CP i/n').
 */

/**
 * A Blitz route definition (frozen). See the module header for the
 * coordinate and tuning models.
 *
 * @typedef {object} BlitzRaceEvent
 * @property {string} id Stable event id (=== the menu card id; the task
 *   5.5 records key).
 * @property {'blitz'} type Controller discriminator: timed checkpoint race.
 * @property {string} name Display name (=== the menu card name; shown on
 *   the results screen).
 * @property {{ x: number, z: number, heading: number }} start Start pose —
 *   right-hand-lane position on a road, heading along it (rad; 0 = +Z).
 * @property {RaceCheckpoint[]} checkpoints Ordered gate list (>= 3).
 * @property {number} timeLimitMs Timer budget (ms); zero here = failure.
 * @property {MedalThresholds} thresholds Medal cutoffs (ms, ordered).
 */

/**
 * The Cruise free-roam "event": same controller, no objectives — no start
 * override (spawns at the app's documented spawn), no checkpoints, no
 * timer, no fail state. The id literal MUST stay equal to
 * CRUISE_EVENT_ID in src/ui/main-menu.js (harness-cross-checked).
 *
 * @typedef {object} CruiseEvent
 * @property {'cruise'} id === main-menu.js CRUISE_EVENT_ID.
 * @property {'cruise'} type Controller discriminator: free roam.
 * @property {string} name Display name (menu card title).
 */

/** The single Cruise event definition (see the typedef). */
export const CRUISE_EVENT = Object.freeze({
  id: 'cruise',
  type: 'cruise',
  name: 'CRUISE — FREE ROAM',
});

/**
 * The three Blitz routes, shortest/fastest first. Shapes per the typedef;
 * numbers derived by the module-header models from the shipped grid.
 *
 * @type {ReadonlyArray<BlitzRaceEvent>}
 */
export const RACE_EVENTS = Object.freeze([
  // ---------------------------------------------------------------- downtown
  // Short central sprint: straight run up the x=0 road, east through the
  // center crossing, a zigzag back west, finish crossing midtown north.
  // Fewest turns of the three — the "learn the game" route.
  Object.freeze({
    id: 'blitz-downtown',
    type: 'blitz',
    name: 'BLITZ · DOWNTOWN SPRINT',
    // x=0 road (grid line 5), right-hand lane (x - 3.5), mid-block between
    // the z=-312 and z=-234 centerlines, heading +Z at the (0,-156) junction.
    start: Object.freeze({ x: -3.5, z: -272, heading: 0 }),
    checkpoints: Object.freeze([
      Object.freeze({ x: 0, z: -156, label: 'CP 1/7' }),   // linesX[5] x linesZ[3]
      Object.freeze({ x: 156, z: -156, label: 'CP 2/7' }), // linesX[7] x linesZ[3]
      Object.freeze({ x: 156, z: 0, label: 'CP 3/7' }),    // linesX[7] x linesZ[5]
      Object.freeze({ x: 0, z: 78, label: 'CP 4/7' }),     // linesX[5] x linesZ[6]
      Object.freeze({ x: -156, z: 78, label: 'CP 5/7' }),  // linesX[3] x linesZ[6]
      Object.freeze({ x: -156, z: 234, label: 'CP 6/7' }), // linesX[3] x linesZ[8]
      Object.freeze({ x: 0, z: 234, label: 'CP 7/7' }),    // linesX[5] x linesZ[8]
    ]),
    timeLimitMs: 66500, // L = 1133.5 m driving
    thresholds: Object.freeze({ gold: 36500, silver: 43500, bronze: 52500 }),
  }),
  // ---------------------------------------------------------------- riverside
  // Full perimeter loop around the city's outer ring road (the map-edge
  // "waterfront" ring): four corners, mile-long straights, highest top
  // speed of the three — longest route, fewest decisions.
  Object.freeze({
    id: 'blitz-riverside',
    type: 'blitz',
    name: 'BLITZ · RIVERSIDE LOOP',
    // West ring road (x=-390, grid line 0), right-hand lane (x - 3.5),
    // at the z=-234 junction, heading +Z (north along the ring).
    start: Object.freeze({ x: -393.5, z: -234, heading: 0 }),
    checkpoints: Object.freeze([
      Object.freeze({ x: -390, z: -78, label: 'CP 1/9' }),  // [0,4]
      Object.freeze({ x: -390, z: 234, label: 'CP 2/9' }),  // [0,8]
      Object.freeze({ x: -156, z: 390, label: 'CP 3/9' }),  // [3,10] NW corner leg
      Object.freeze({ x: 156, z: 390, label: 'CP 4/9' }),   // [7,10] north edge
      Object.freeze({ x: 390, z: 234, label: 'CP 5/9' }),   // [10,8] NE corner leg
      Object.freeze({ x: 390, z: -78, label: 'CP 6/9' }),   // [10,4] east edge
      Object.freeze({ x: 156, z: -234, label: 'CP 7/9' }),  // [7,2] SE corner leg
      Object.freeze({ x: -234, z: -234, label: 'CP 8/9' }), // [2,2] south edge
      Object.freeze({ x: -390, z: -234, label: 'CP 9/9' }), // [0,2] loop closes at the start junction
    ]),
    timeLimitMs: 165500, // L = 2811.5 m driving
    thresholds: Object.freeze({ gold: 90500, silver: 108000, bronze: 131000 }),
  }),
  // -------------------------------------------------------------------- tower
  // Twisty mid-length run threaded past the landmark tower block (ix3,iz2 —
  // the route's CP 2/7 is its corner junction and the CP 2->3 leg rides its
  // west face), out to the west edge, back through midtown and the park
  // block's east side. Most turns of the three — the difficulty pick.
  Object.freeze({
    id: 'blitz-tower',
    type: 'blitz',
    name: 'BLITZ · TOWER RUN',
    // z=0 road (grid line 5), right-hand lane for +X travel (z + 3.5),
    // mid-block between the x=-312 and x=-234 centerlines, heading +X.
    start: Object.freeze({ x: -272, z: 3.5, heading: Math.PI / 2 }),
    checkpoints: Object.freeze([
      Object.freeze({ x: -156, z: 0, label: 'CP 1/8' }),    // [3,5]
      Object.freeze({ x: -156, z: -156, label: 'CP 2/8' }), // [3,3] tower block SW corner
      Object.freeze({ x: -234, z: -234, label: 'CP 3/8' }), // [2,2] past the tower's west face
      Object.freeze({ x: -312, z: -156, label: 'CP 4/8' }), // [1,3]
      Object.freeze({ x: -312, z: 78, label: 'CP 5/8' }),   // [1,6] west edge run
      Object.freeze({ x: 0, z: 78, label: 'CP 6/8' }),      // [5,6] midtown crossing
      Object.freeze({ x: 156, z: -78, label: 'CP 7/8' }),   // [7,4] past the park block
      Object.freeze({ x: 0, z: -156, label: 'CP 8/8' }),    // [5,3] final cut back SW
    ]),
    timeLimitMs: 99000, // L = 1679.5 m driving
    thresholds: Object.freeze({ gold: 54000, silver: 64500, bronze: 78000 }),
  }),
]);

/**
 * The Blitz events keyed by id (menu-card lookup; unknown ids miss).
 *
 * @type {Readonly<Record<string, BlitzRaceEvent>>}
 */
export const RACE_EVENT_BY_ID = Object.freeze(
  Object.fromEntries(RACE_EVENTS.map((event) => [event.id, event]))
);

/**
 * Resolve a menu event id to its controller-ready event definition:
 * the Blitz route with that id, the Cruise event for 'cruise', or null for
 * an unknown id (main.js falls back to Cruise so a stale id can never
 * wedge the racing mode).
 * @param {string | undefined | null} eventId Event id from a menu card.
 * @returns {BlitzRaceEvent | CruiseEvent | null} The event definition.
 */
export function resolveRaceEvent(eventId) {
  if (eventId === CRUISE_EVENT.id) return CRUISE_EVENT;
  return RACE_EVENT_BY_ID[eventId] ?? null;
}

/**
 * Medal for a finish time per a route's thresholds (pure; boundaries are
 * inclusive — finishing EXACTLY on a cutoff earns it). Faster than bronze
 * but over the bronze cutoff finishes the race with NO medal (null) — the
 * win stands, no award (task 5.5 renders/persists the empty medal).
 *
 * @param {number} timeMs Finish time in ms (>= 0).
 * @param {MedalThresholds} thresholds The route's ordered cutoffs.
 * @returns {'gold' | 'silver' | 'bronze' | null} The medal, or null when
 *   the finish beat the timer but not the bronze cutoff.
 */
export function medalForTime(timeMs, thresholds) {
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs) || timeMs < 0) return null;
  if (timeMs <= thresholds.gold) return 'gold';
  if (timeMs <= thresholds.silver) return 'silver';
  if (timeMs <= thresholds.bronze) return 'bronze';
  return null;
}
