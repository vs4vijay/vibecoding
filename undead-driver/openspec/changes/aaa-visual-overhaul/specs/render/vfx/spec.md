# Spec Delta — render/vfx

## Purpose

Deliver AAA game-feel: a post-processing stack, pooled particle and decal systems for gore/sparks/smoke/dust, light-reactive impacts, and physical camera reactions — all within the performance contract.

## ADDED Requirements

### Requirement: Post-processing stack

Frames SHALL render through a post-processing stack including bloom, vignette, film grain, and subtle chromatic aberration, each with config tunables and a quality tier that can bypass the stack (direct render) without errors.

#### Scenario: Bloom on emissives

- **WHEN** a muzzle flash or brake light is on screen with bloom enabled
- **THEN** a brightness bleed halo around the emissive region is detectable versus the stack-bypassed capture

#### Scenario: Stack bypass is clean

- **WHEN** quality is set to bypass post-processing
- **THEN** the game renders directly with no console errors and gameplay is unaffected

### Requirement: Pooled particle vocabulary

Combat and world events SHALL produce particles — blood, sparks, smoke, dust, muzzle — from fixed preallocated pools, with per-event counts, lifetimes, and gravity as config tunables.

#### Scenario: Kill blood burst

- **WHEN** a zombie is killed by gunfire
- **THEN** at least the pinned count of blood particles is visible for at least the pinned duration

#### Scenario: Zero steady-state allocation

- **WHEN** a sustained combat sequence runs (shots, kills, scrapes for 30 s)
- **THEN** heap growth attributable to the particle path is within the pinned zero-allocation tolerance

### Requirement: Persistent ground decals

Combat SHALL leave decals — blood pools under kills, scorch/skid marks — that persist in the active window and recycle via a bounded pool.

#### Scenario: Blood decal under kill

- **WHEN** a zombie dies on the road
- **THEN** a blood decal appears at the kill location within the pinned frames and decal count never exceeds the pool bound

### Requirement: Camera impact feel

Gameplay impacts SHALL drive camera reactions: damage shakes, scrape rumbles, shot recoil kicks, and death-cam dramatization, each with tunable amplitude/duration and decaying smoothly.

#### Scenario: Damage shake envelope

- **WHEN** the car takes a hit
- **THEN** a measurable camera offset pulse occurs and decays to zero within the pinned window, and no shake persists into the next unrelated event

### Requirement: Impact light response

Gunfire and explosions SHALL produce short light pulses in the scene (flash lighting nearby geometry), not just screen-space quads.

#### Scenario: Shot lights the scene

- **WHEN** a shot is fired
- **THEN** geometry near the muzzle measurably brightens on the shot frame(s) and returns to baseline within the pinned duration

### Requirement: Adaptive quality protection

When measured fps falls below the floor for the pinned duration, the game SHALL degrade visual quality in a documented order (resolution scale → post effects → particle density → shadow quality) and restore quality when headroom returns, so the performance floor in `render/quality-gate` holds on weaker hardware.

#### Scenario: Degradation under load

- **WHEN** the sim is artificially loaded to below the fps floor for the pinned duration
- **THEN** quality steps down in the documented order and fps recovers above the floor; when load is removed quality steps back up without errors
