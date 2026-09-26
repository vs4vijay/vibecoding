# Spec Delta — ui/hud

## Purpose

Make the in-run HUD legible at a glance and give every scoring and danger moment visible feedback: the weight/tilt story that decides survival, kill rewards, level-ups, and the death summary.

## ADDED Requirements

### Requirement: Tilt gauge legibility

The tilt gauge SHALL be prominently sized relative to the HUD, reflect the car's current tilt, and be color-graded by imbalance severity: neutral below the warning threshold, amber from the warning threshold, red-and-flashing in the critical band.

#### Scenario: Gauge ramps with danger

- **WHEN** imbalance rises from below the warning threshold into the critical band
- **THEN** the gauge transitions neutral → amber → red flashing, and the existing danger vignette still activates in the critical band

### Requirement: Per-side weight pips

The HUD SHALL display, for each side of the car, how many capacity units are currently occupied by attached zombies (walkers/runner = 1 unit, brute = 2 units, capacity 4 per side), updating as zombies attach and are removed.

#### Scenario: Pip reflects attach

- **WHEN** a walker attaches to the right side
- **THEN** the right pip row gains one filled unit and the left row is unchanged

#### Scenario: Pip reflects brute weight

- **WHEN** a brute attaches to the left side
- **THEN** the left pip row gains two filled units

#### Scenario: Pip clears on removal

- **WHEN** an attached zombie is killed or scraped off
- **THEN** its side's pip row releases the units it occupied

### Requirement: Side danger glow

When imbalance reaches the critical band, the screen edge on the heavier side SHALL glow red in addition to the existing whole-screen danger vignette.

#### Scenario: Glow follows the heavy side

- **WHEN** the right side is overloaded into the critical band
- **THEN** the right screen edge glows; when the heavy side switches to left, the glow moves with it

### Requirement: Kill score popups

Each zombie kill SHALL produce a floating score popup near the victim's projected screen position, showing the points awarded and, when the streak multiplier is ≥2, the multiplier. Popups are transient, non-interactive, and capped so bursts don't accumulate unbounded.

#### Scenario: Popup shows kill points

- **WHEN** a walker on the right flank is shot while the streak multiplier is ×2
- **THEN** a popup showing the awarded points and "×2" appears near the kill's screen position and fades out within ~1 s

#### Scenario: Popup flood capped

- **WHEN** more popups trigger than the configured concurrent cap
- **THEN** the oldest popups are recycled and the HUD stays responsive

### Requirement: Level-up banner with unlock subtitle

The level-up moment SHALL display the new level prominently; when that level unlocks a new zombie type, the banner SHALL also name the unlock.

#### Scenario: Unlock level names the type

- **WHEN** the player reaches the level that unlocks runners
- **THEN** the banner reads "LEVEL 2" with a "RUNNERS UNLOCKED" subtitle

#### Scenario: Non-unlock level has no subtitle

- **WHEN** the player reaches a level that unlocks nothing
- **THEN** the banner shows only the new level

### Requirement: Game-over card redesign

The game-over card SHALL present the death cause, the run's stats, and any NEW BEST badge in larger, higher-contrast type than the current layout, and SHALL restart the run when the player taps/clicks anywhere on the card (in addition to the RETRY button and Space/Enter).

#### Scenario: Tap anywhere retries

- **WHEN** the game-over card is visible and the player taps a non-button area of it
- **THEN** a new run starts exactly as if RETRY was pressed

#### Scenario: Keyboard retry preserved

- **WHEN** the game-over card is visible and Space/Enter is pressed
- **THEN** a new run starts

### Requirement: HUD does not intercept gameplay input

The HUD remains click-through (pointer-events disabled) except for controls that must be tappable (pause). New HUD layers — pips, glow, popups — SHALL NOT swallow steering drags or tap-to-fire.

#### Scenario: Fire tap passes through new layers

- **WHEN** the player taps a screen half where a popup or pip row is displayed
- **THEN** the shot fires on that side
