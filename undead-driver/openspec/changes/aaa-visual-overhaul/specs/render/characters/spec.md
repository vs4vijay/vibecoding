# Spec Delta — render/characters

## Purpose

Rebuild the two heroes of the screen — the car and the zombie horde — from boxes into AAA-credible characters: recognizable silhouettes, articulated animation, progressive damage, and gory deaths, all under the instancing/pooling budget.

## ADDED Requirements

### Requirement: Hero car silhouette and detail

The car SHALL read as a distinctive muscle-car composition — body shell, cabin with glass, wheel wells, bumpers, exhausts, lights — recognizable by silhouette alone, with glass showing environment reflection.

#### Scenario: Silhouette recognition

- **WHEN** a side-profile capture of the car is compared against the pinned proportion reference
- **THEN** the independent visual critic rates the silhouette at parity or better versus the reference (see `render/quality-gate`)

#### Scenario: Glass reads as glass

- **WHEN** the cabin is captured at an angle
- **THEN** the glass region shows reflection/tonal behavior distinct from the body paint

### Requirement: Wheel and suspension animation

Wheels SHALL visually steer with steering input, spin with speed, and the body SHALL show suspension response (pitch/roll/heave) to acceleration, hits, and road events.

#### Scenario: Visual steering follows input

- **WHEN** sustained left or right input is applied
- **THEN** front-wheel yaw transforms visibly track the input direction within the pinned latency

#### Scenario: Hit suspension response

- **WHEN** the car takes a hit or hard scrape
- **THEN** a body roll/heave offset is detectable and settles within the pinned window

### Requirement: Progressive car damage visuals

Visible damage SHALL accrue on the car with damage taken: panel deformation cues, detachable parts (bumper/trim) at thresholds, and engine smoke at critical health.

#### Scenario: Critical-health smoke

- **WHEN** car health reaches the critical threshold
- **THEN** a smoke emitter is visible at the hood and persists while critical

#### Scenario: Part detachment at threshold

- **WHEN** damage crosses the pinned detachment threshold
- **THEN** the configured part is no longer attached to the body and appears as debris

### Requirement: Articulated zombie animation

Zombies SHALL have articulated bodies (head, torso, two arms, two legs) driven by procedural per-type animation cycles — walker shamble, runner sprint, brute stomp — with phase-offset limbs and secondary motion.

#### Scenario: Limb cycle present

- **WHEN** a moving zombie is sampled across consecutive frames
- **THEN** its limb transforms show phase-offset cyclic motion consistent with its type's cycle (probe-readable transforms)

### Requirement: Cling and struggle fidelity

Clinging zombies SHALL visually lock onto the car side with a struggle animation, and the car body SHALL react (roll/lean) proportionally to attached weight, keeping the existing danger-edge HUD semantics intact.

#### Scenario: Cling visual lock

- **WHEN** a zombie clings
- **THEN** it is flush against the car flank with continuous struggle motion, and the car roll offset direction matches the cling side

### Requirement: Gore and death variety

Kills SHALL produce graded death visuals: standard kills tumble/fall with blood; overkill damage produces dismemberment with independent part physics-feel; all corpse parts recycle via pools.

#### Scenario: Overkill dismemberment

- **WHEN** a zombie is killed by overkill damage
- **THEN** at least the pinned count of body parts separates with independent tumble motion

#### Scenario: Pooled cleanup

- **WHEN** corpses/parts exceed their recycle window or pool bounds
- **THEN** they are reused or parked hidden with no allocation growth

### Requirement: Horde draw discipline

The full zombie horde at maximum spawn density SHALL stay within the pinned draw-call allocation for characters via instanced rendering.

#### Scenario: Draw calls at max density

- **WHEN** the maximum horde is alive and the renderer info probe is read
- **THEN** character-related draw calls are at or below the pinned character budget
