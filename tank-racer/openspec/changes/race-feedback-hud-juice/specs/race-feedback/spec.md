# Spec Delta

## Purpose

Gives the player readable, exciting moment-to-moment feedback during a race: animated countdowns, lap and position celebrations, damage warnings, wrong-way alerts, and pickup confirmation — in both single-player and 2P split-screen, without changing any race rules or physics.

## ADDED Requirements

### Requirement: Animated countdown
The countdown sequence SHALL animate each step ("3", "2", "1", "GO!") with a scale-in pop and fade-out instead of a hard text swap, and "GO!" SHALL render in a distinct accent color from the digits. The countdown's total duration SHALL remain unchanged.

#### Scenario: Digit step animates
- **WHEN** the countdown advances to a new digit
- **THEN** the new digit animates in with a scale pop and fades out before the next step replaces it

#### Scenario: GO is visually distinct
- **WHEN** the final "GO!" step shows
- **THEN** it renders in an accent color different from the digits and the race unlocks exactly as before

### Requirement: Lap-complete HUD feedback
When a human racer completes a lap that does not end the race, the system SHALL flash the HUD lap counter, pop the completed lap time, and play a lap chime. Existing lap banners (FINAL LAP, "<NAME> FINISHED!") SHALL be preserved. AI laps SHALL NOT trigger HUD feedback.

#### Scenario: Intermediate lap celebrated
- **WHEN** the player completes lap 1 of 3
- **THEN** the lap counter flashes, the lap time pops, and a chime plays

#### Scenario: Existing banners preserved
- **WHEN** the player begins their final lap, or any human finishes the race
- **THEN** the existing FINAL LAP / FINISHED banner still shows in addition to the new feedback

#### Scenario: AI laps are silent
- **WHEN** an AI tank completes a lap
- **THEN** no lap flash, pop, or chime occurs

### Requirement: Position-change callout
When a human's race position changes, the system SHALL pulse their POS readout and briefly indicate the direction of the change (gained or lost). Repeated changes SHALL be rate-limited so the readout does not strobe.

#### Scenario: Overtake feedback
- **WHEN** the player's position improves from 3rd to 2nd
- **THEN** the POS readout pulses once and shows a gained-position indication briefly

#### Scenario: No strobing
- **WHEN** positions change several times within a short window
- **THEN** callouts are rate-limited to at most one indication per short interval per player

### Requirement: Damage vignette
When a human's tank takes a shell hit, the system SHALL flash a red edge vignette across that player's view. While a human's health is at or below 30%, a persistent pulsing vignette SHALL warn until health is restored above the threshold. In 2P, each vignette SHALL be confined to that player's half of the screen.

#### Scenario: Hit flash
- **WHEN** the player's tank is hit by a shell
- **THEN** a red edge vignette flashes briefly in the player's view (camera shake and impact sounds unchanged)

#### Scenario: Low-health warning
- **WHEN** the player's health drops to 30% or below
- **THEN** a pulsing vignette persists until health is restored above 30% (e.g. by respawn)

#### Scenario: 2P vignette isolation
- **WHEN** P1's tank is hit in a 2P race
- **THEN** only P1's half shows the vignette; P2's half is unaffected

### Requirement: Wrong-way warning
The system SHALL detect sustained backwards travel along the circuit and show a flashing "WRONG WAY!" banner while it continues. The banner SHALL clear once the racer resumes forward progress. Only human tanks trigger the warning.

#### Scenario: Wrong way detected
- **WHEN** the player travels backwards along the track for a sustained interval
- **THEN** a flashing "WRONG WAY!" banner appears

#### Scenario: Cleared on recovery
- **WHEN** the player turns around and resumes forward progress
- **THEN** the banner disappears

#### Scenario: AI never triggers it
- **WHEN** an AI tank's progress briefly decreases
- **THEN** no wrong-way banner appears

### Requirement: Pickup slot feedback
When a human's tank arms a pickup (shield or triple-shot) or consumes a boost pickup, the HUD power-up slot SHALL animate in with a pop, and each pickup kind SHALL have a distinct sound identity (shield/triple sounds distinguishable from each other and from boost).

#### Scenario: Shield armed
- **WHEN** the player picks up a shield
- **THEN** the power-up slot pops in showing SHIELD and a shield-specific sound plays

#### Scenario: Pickup sounds distinguishable
- **WHEN** any two different pickup kinds are heard
- **THEN** their sounds are distinguishable (not one generic chime for all)

### Requirement: 2P split-screen parity
Every new HUD feedback element SHALL work in 2P split-screen: each half shows only its own player's lap, position, pickup, vignette, and wrong-way feedback, using the existing compact half-layout styling. Enabling the new feedback SHALL NOT change the 1P layout's geometry.

#### Scenario: Both halves independent
- **WHEN** P1 completes a lap while P2 is hit in the same instant
- **THEN** P1's half shows the lap celebration and P2's half shows the damage vignette, independently

#### Scenario: 1P layout unchanged
- **WHEN** the game runs in 1P mode
- **THEN** the classic HUD layout positions remain as they are today, with feedback integrated into them

### Requirement: Reduced-motion fallback
When the OS reports a reduced-motion preference, non-essential animations (pops, pulses, flashes) SHALL render as simple opacity fades instead of scale/flash motion.

#### Scenario: Reduced motion respected
- **WHEN** the user's system requests reduced motion
- **THEN** countdown steps, callouts, and vignettes appear/disappear via opacity-only transitions
