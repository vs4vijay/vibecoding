# Spec Delta

## Purpose

Teach the game's core verbs (lane switch, jump, roll) on the player's first run and render
every static control hint in the player's actual input scheme, so nobody has to mentally
translate "SWIPE" on a desktop or "ARROWS" on a phone. A how-to-play review stays
reachable from the menu.

## ADDED Requirements

### Requirement: Control hints match the active input scheme

Static control hints (menu, pause, results) SHALL reflect the detected input scheme:
coarse-pointer / touch devices SHALL see swipe/tap wording, keyboard devices SHALL see key
wording. Hints MUST NOT mix both schemes into one line, and MUST NOT claim a scheme the
device does not have. If the player interacts via a different scheme than detected, the
hints MAY correct on the next screen that shows them.

#### Scenario: Touch device sees swipe hints only

- **WHEN** the menu is shown on a coarse-pointer device
- **THEN** the hint line describes swipe/tap controls with no keyboard key names

#### Scenario: Desktop sees keyboard hints only

- **WHEN** the menu is shown on a fine-pointer device
- **THEN** the hint line describes arrow/space controls with no swipe wording

### Requirement: First run teaches the core verbs

On a player's first ever run (and only that run), the game SHALL present one-time
contextual hints covering lane switching, jumping, and rolling, timed to when each verb
becomes relevant. Hints MUST NOT pause, slow, or otherwise alter the simulation, MUST use
the player's input scheme wording, and SHALL NOT repeat on any later run. The teaching
state SHALL persist across sessions.

#### Scenario: First run shows hints once

- **WHEN** a brand-new player completes their first run and starts a second run
- **THEN** the first run showed contextual verb hints and the second run shows none

#### Scenario: Existing players are not re-taught

- **WHEN** a player with pre-existing save data (no teaching flag recorded) plays after updating
- **THEN** no first-run hints appear (missing flag on an existing save means already taught)

### Requirement: How-to-play is reviewable from the menu

The menu SHALL provide a reachable control that shows the control scheme for the player's
input scheme (and MAY show the alternate scheme). Viewing it MUST NOT start a run, and
closing it returns to the menu exactly as it was, with leaderboard/stats state intact.

#### Scenario: Player reviews controls without side effects

- **WHEN** the player opens and closes the how-to-play view from the menu
- **THEN** the menu is restored unchanged and no run has started
