# Spec Delta — ui/hud

## Purpose

Raise the presentation layer to AAA grade: cinematic title and game-over flows, redesigned HUD with icons and animated feedback, directional damage indicators, hit markers, and polished motion design — while preserving the readability semantics delivered by `readability-hud-pass`.

## ADDED Requirements

### Requirement: Cinematic title screen

The title screen SHALL present over the live 3D scene with an attract-style camera drift, a treated animated logo, and animated menu transitions, so the game opens like a AAA front-end.

#### Scenario: Live scene behind menu

- **WHEN** the title screen is shown
- **THEN** the 3D world is visible and animating behind the menu chrome (canvas not occluded by an opaque layer)

#### Scenario: Logo and entrance animation

- **WHEN** the title screen appears
- **THEN** the logo and menu items play entrance animations (probe: animated classes/custom properties applied over the pinned sequence)

### Requirement: Redesigned HUD language

HUD elements (score, distance, level/progress, ammo, streak) SHALL use a cohesive AAA visual language — iconography, layered depth, animated meters — replacing plain text/number styling, with all values diff-updated without layout thrash.

#### Scenario: Animated meter response

- **WHEN** ammo is expended and reload completes
- **THEN** the ammo meter animates through its reload presentation (conic/segment animation) and settles in the full state

#### Scenario: No layout thrash

- **WHEN** HUD updates run for a 30 s combat sequence
- **THEN** no element reflows outside its preallocated box (probe: element bounding boxes unchanged across updates)

### Requirement: Hit markers and kill feedback

Successful shots SHALL produce a hit marker at the reticle/impact, kills SHALL produce an upgraded score popup with streak flare escalation, and these SHALL be preallocated and pooled.

#### Scenario: Hit marker on connect

- **WHEN** a shot damages a zombie
- **THEN** a hit marker becomes visible for the pinned duration at the impact projection

### Requirement: Directional damage indicators

Damage SHALL drive directional screen-edge indicators (blood vignette bias toward the threat side) consistent with the existing danger-edge semantics but with AAA treatment (animated, eased, pooled).

#### Scenario: Left-attack biases left edge

- **WHEN** damage arrives from a zombie on the left flank
- **THEN** the left edge indicator's intensity exceeds the right's for the pinned window

### Requirement: Cinematic game-over flow

The game-over presentation SHALL play as a sequence — slow beat, card entrance, staggered stat reveals, best-badge flourish — rather than appearing instantly.

#### Scenario: Staggered reveal sequence

- **WHEN** the run ends
- **THEN** the card and stat cells appear in the pinned staggered order with eased motion, and the retry control is interactive by sequence end

### Requirement: Motion and accessibility discipline

All HUD/menu motion SHALL be eased transitions with config tunables, and SHALL respect the user's reduced-motion preference by disabling nonessential animation while keeping state changes legible.

#### Scenario: Reduced motion honored

- **WHEN** the OS-level reduced-motion preference is set
- **THEN** entrance/loop animations are suppressed or minimized and all state changes remain visible

### Requirement: Readability semantics preserved

All information-carrying HUD behavior from the readability pass — tilt gauge weight pips with warn/critical bands, ammo pip rows with reload arcs, level progress, danger-edge strips — SHALL retain their semantic meaning and update rules; only presentation changes.

#### Scenario: Existing HUD probes stay green

- **WHEN** the existing HUD/substrate unit and probe tests run against the redesigned HUD
- **THEN** all pinned strings, state transitions, and update rules pass unchanged
