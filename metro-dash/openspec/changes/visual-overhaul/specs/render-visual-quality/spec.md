# Spec Delta: render-visual-quality

## Purpose

Defines the visual presentation standards for the 3D game scene — how surfaces, the track,
props, the player character, and the sky must look and animate — so the world reads as a
coherent, modern endless-runner subway environment, and bounds the performance cost of that
presentation on mobile hardware.

## ADDED Requirements

### Requirement: Lighting-responsive surfaces

All world geometry (ground, track, buildings, props, character) SHALL be shaded with
lighting-responsive materials such that no surface renders as a single flat unmodulated color:
each surface SHALL show at least two distinct brightness regions (lit and shaded) under the
scene lights, and SHALL pick up ambient light from the environment.

#### Scenario: Surfaces show directional shading
- **WHEN** the scene renders with the standard light rig
- **THEN** every visible world surface exhibits lit and shaded regions (e.g., a box's faces
  facing the key light are brighter than faces turned away), rather than uniform color

#### Scenario: Materials respond to environment light
- **WHEN** the environment lighting is present
- **THEN** specular/reflective surface types (coins, rails, train bodies) show a highlight that
  distinguishes them from matte surfaces (ground, buildings)

### Requirement: Track reads as railway

The ground beneath and between the three lanes SHALL visually read as a subway/railway track
bed: a repeating ballast (gravel) surface with cross sleepers (ties) under continuous rails.

#### Scenario: Track bed shows ballast and sleepers
- **WHEN** the game world renders at gameplay camera distance
- **THEN** the lane strip shows repeating cross sleepers and a gravel-like ballast texture
  between and beside the rails

#### Scenario: Track detail repeats seamlessly
- **WHEN** the player advances any distance
- **THEN** the track-bed pattern repeats without visible seams or stretching

### Requirement: Recognizable props

Obstacle props SHALL be visually distinguishable as real-world objects rather than bare
colored boxes: trains SHALL read as subway cars (window band, doors, and wheels/bogies
distinguishable at gameplay camera distance), low barriers SHALL show hazard striping, and
overhead obstacles SHALL read as signal gantries with visible support structure.

#### Scenario: Train reads as subway car
- **WHEN** a train obstacle approaches within gameplay camera distance
- **THEN** its render shows a window band, door outlines, and wheel/bogie detail

#### Scenario: Barrier and overhead are distinct silhouettes
- **WHEN** a low barrier and an overhead gantry are visible together
- **THEN** the barrier shows striped hazard markings and the overhead shows a gantry frame,
  each recognizable by silhouette alone

### Requirement: Character animation states

The player character SHALL animate through distinct visible states: a running cycle with
oscillating limbs, an airborne pose while jumping, a compact tumbling pose while rolling, and
a lateral lean toward the direction of a lane change.

#### Scenario: Running cycle
- **WHEN** the character runs on the ground
- **THEN** its arms and legs swing periodically (visible positional oscillation of limb meshes)

#### Scenario: Airborne pose
- **WHEN** the character jumps
- **THEN** the body assumes a pose distinct from the run cycle (limbs tucked) for the jump's
  duration

#### Scenario: Roll pose
- **WHEN** the character rolls
- **THEN** the body renders compact (visibly shorter than standing height) and rotates through
  the roll

#### Scenario: Lane-change lean
- **WHEN** the character changes lanes
- **THEN** the body banks (tilts) toward the target lane while moving laterally and returns
  upright on arrival

### Requirement: Atmosphere progresses with distance

The scene's sky and fog SHALL progress through a day → sunset → night color ramp as run
distance grows, and at night building windows SHALL render as lit (emissive). The ramp SHALL
be deterministic per run (same distance = same sky state).

#### Scenario: Day at run start
- **WHEN** a new run starts
- **THEN** sky and fog render in daylight colors

#### Scenario: Sunset mid-run
- **WHEN** the run reaches the middle of the ramp distance range
- **THEN** sky and fog render in sunset tones distinct from both day and night states

#### Scenario: Night with lit windows
- **WHEN** the run reaches the night end of the ramp
- **THEN** the sky renders in night tones and building windows show emissive lit coloring

### Requirement: Speed-reactive camera

The camera SHALL widen its field of view as run speed increases from base to maximum, and
SHALL apply a brief small downward kick on jump landing. FOV at maximum speed SHALL be
measurably larger than FOV at base speed.

#### Scenario: FOV grows with speed
- **WHEN** the run's speed reaches its maximum
- **THEN** the camera's field of view is larger than at run start

#### Scenario: Landing kick
- **WHEN** the character lands from a jump
- **THEN** the camera dips briefly and recovers within a fraction of a second

### Requirement: Visual performance budget

The visual upgrades SHALL NOT regress runtime performance: at default quality the game SHALL
sustain at least 30 FPS on a mid-range mobile device and 60 FPS on desktop, and per-frame
draw calls SHALL NOT exceed 1.5× the pre-overhaul baseline in an equivalent scene state.
All visual assets (including fonts and any textures) SHALL be served locally or generated
procedurally at runtime; no new network origins are introduced beyond those already used.

#### Scenario: Desktop frame rate holds
- **WHEN** the game runs at default quality on desktop
- **THEN** the frame rate sustains approximately 60 FPS during active gameplay

#### Scenario: Draw calls bounded
- **WHEN** a mid-run scene state is rendered before and after the overhaul
- **THEN** the post-overhaul draw-call count per frame is no more than 1.5× the baseline

#### Scenario: No new network origins
- **WHEN** the client loads all visual assets
- **THEN** every request goes to origins already used by the current client (same-origin plus
  the existing three.js CDN)
