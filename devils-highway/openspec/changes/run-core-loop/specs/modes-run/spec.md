# Spec Delta

## Purpose

The RUN gameplay mode: an on-foot runner on the shared desert-highway world — three lanes,
jump/slide over and under hazards, chasing zombies, pickups, a distance-driven speed ramp,
and death on contact. It is the first consumer of the shared entity systems and the `Mode`
contract, and the reference the later DRIVE and RIDE modes follow.

## ADDED Requirements

### Requirement: Lane-based forward running
The mode SHALL move the player character forward along the highway at a speed that ramps
up with distance covered, and SHALL hold the player in one of three discrete lanes
(left/centre/right). Lane-change input SHALL move the player one lane with a short eased
transition and MUST clamp at the outer lanes.

#### Scenario: Lane change
- **WHEN** the player issues a left/right lane input while running
- **THEN** the character eases to the adjacent lane within a short fixed window and stays
  within the three-lane corridor

#### Scenario: Speed ramp
- **WHEN** the run continues past configured distance thresholds
- **THEN** forward speed increases stepwise up to a configured maximum

### Requirement: Jump and slide
The mode SHALL provide a jump (parabolic arc, clears low hazards) and a slide (reduced
profile, passes under overhead barriers). While airborne or sliding, the player's collision
profile MUST reflect that state so obstacles interact correctly with both actions.

#### Scenario: Jump clears low obstacle
- **WHEN** the player jumps and the arc carries them over a low barrier's span
- **THEN** no collision is registered with that barrier

#### Scenario: Slide passes under barrier
- **WHEN** the player slides under an overhead barrier
- **THEN** no collision is registered while the slide profile is active

### Requirement: Deterministic passable obstacle layout
Obstacles SHALL be placed ahead of the player in bands, with placement derived from the
seeded per-chunk RNG streams (same `?seed=` reproduces the same layout for the whole run).
Every obstacle band MUST leave at least one passable path (open lane, or an obstacle
clearable by jump/slide) at spawn time. Solid collision with an obstacle SHALL end the run.

#### Scenario: Passable band guaranteed
- **WHEN** the spawn director places an obstacle band in a chunk
- **THEN** at least one lane is open or holds only a clearable obstacle

#### Scenario: Collision ends run
- **WHEN** the player's collision profile intersects a solid obstacle
- **THEN** the run ends and the shell transitions to the gameover state

### Requirement: Chasing zombies
The mode SHALL spawn zombies (the shared pooled instanced zombie system) that run toward or
alongside the player from ahead, in all lanes. Contact with a zombie SHALL end the run.
Zombies MUST remain silhouette-readable per the art bible (instanced, animated, emissive
eyes at night) within the shared entity budget.

#### Scenario: Zombie contact ends run
- **WHEN** a zombie reaches the player's position in the same lane at ground level
- **THEN** the run ends and the shell transitions to the gameover state

#### Scenario: Zombie evasion
- **WHEN** the player changes lanes or jumps before a lunging zombie makes contact
- **THEN** the zombie misses and continues past without ending the run

### Requirement: Pickups and scoring
The mode SHALL place pickup strands along lanes (same seeded streams) that award score and
currency on collection. Score SHALL combine distance covered and pickup bonuses per
configured values.

#### Scenario: Pickup collected
- **WHEN** the player's path intersects a pickup
- **THEN** the pickup is consumed, its score bonus is added, and currency is credited

#### Scenario: Missed pickup
- **WHEN** a pickup passes behind the player uncollected
- **THEN** it despawns with the chunk and awards nothing

### Requirement: Run camera rig
During play the mode SHALL drive the chase camera from the run rig (behind and above the
player, looking ahead), smoothly transitioned from the menu rig at run start. The world
stream SHALL follow the player's position.

#### Scenario: Run start transition
- **WHEN** a run starts from the menu
- **THEN** the camera glides from the menu framing to the run chase framing without a cut,
  and chunks stream ahead of the player

### Requirement: Staged QA scenarios
The mode SHALL expose staged action setups through the QA contract so captures are
deterministic: at minimum `staged=gauntlet` (an obstacle/zombie/pickup sequence staged
ahead of the player), honouring `&freeze=1`, `&cam=`, and `&time=`.

#### Scenario: Gauntlet capture ready
- **WHEN** the QA harness loads `?qa=1&mode=run&scene=game&staged=gauntlet&freeze=1`
- **THEN** the staged sequence is laid out ahead of the player and `window.__QA.screenshotReady`
  flips true only after warm frames, a drained stream queue, and the staged settle time
