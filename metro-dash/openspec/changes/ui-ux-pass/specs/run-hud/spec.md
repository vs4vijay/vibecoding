# Spec Delta

## Purpose

Make the in-run HUD an actionable surface: the player must always be able to pause from
any input scheme, see which powerups are active and how long they last, and read the
score/coin state — without the HUD ever stealing gameplay input or blocking the view.

## ADDED Requirements

### Requirement: Touch-reachable pause control

During a run, an on-screen pause control SHALL be visible and activatable with a single
touch (target at least 44×44 CSS px). Activating it SHALL pause the run and show the pause
overlay. The control MUST NOT consume lane-swipe, jump, or roll gestures made elsewhere on
the screen, and the keyboard pause keys SHALL continue to work unchanged.

#### Scenario: Touch player pauses mid-run

- **WHEN** a touch player taps the on-screen pause control during a run
- **THEN** the run freezes, the pause overlay appears, and resuming returns to the same run state

#### Scenario: Swipes near the control still steer

- **WHEN** a touch player starts a horizontal swipe well away from the pause control
- **THEN** the lane change registers and the game does not pause

### Requirement: Active powerup status is surfaced

While a magnet, jetpack, or x2 pickup effect is active, the HUD SHALL show a status chip
naming that effect. While the effect has a finite remaining duration, the chip SHALL
communicate the remaining time (for example an exhaustible bar or countdown) and SHALL
disappear when the effect expires. Collecting a pickup SHALL produce visible HUD feedback
within one second of collection.

#### Scenario: Magnet pickup shows a chip

- **WHEN** the player collects a magnet pickup during a run
- **THEN** a magnet status chip appears in the HUD and disappears when the magnet effect ends

#### Scenario: Finite effect visibly winds down

- **WHEN** a finite-duration effect approaches its end
- **THEN** the chip communicates remaining time in a way that visibly decreases before expiry

### Requirement: HUD does not mislead

Score, coin, and multiplier readouts SHALL reflect the simulation's current values, SHALL
NOT display stale values after a run restart, and SHALL NOT require the player to divide
attention for more than a glance (readouts remain in their established screen regions).

#### Scenario: Restarted run shows fresh HUD

- **WHEN** a player restarts from game over and the new run begins
- **THEN** score and coins read zero (not the previous run's final values)

### Requirement: HUD respects determinism captures

All HUD additions SHALL remain compatible with the deterministic screenshot mode: when the
freeze kill-switch is active, HUD elements SHALL render in a settled, reproducible state
with no animation dependence.

#### Scenario: Frozen capture is stable

- **WHEN** a deterministic capture is taken with the freeze flag active
- **THEN** the HUD renders identically across repeated captures of the same seed
