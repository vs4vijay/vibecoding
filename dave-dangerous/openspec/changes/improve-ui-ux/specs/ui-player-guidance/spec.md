# Spec Delta

## Purpose

Guides new players and protects progress: per-level intro banners and a
first-session controls hint teach the goal and controls, a confirmation guards
New Game against overwriting a saved run, and best-score visibility gives the
run a goal to beat.

## ADDED Requirements

### Requirement: Level intro banner
When a level begins, the system SHALL briefly display a non-interactive intro
banner showing the depth number ("DEPTH NN") and the level objective
("FIND THE TROPHY — OPEN THE EXIT"), which auto-dismisses after a few seconds.
The banner SHALL NOT block gameplay input or pointer interaction with the game
while it is visible.

#### Scenario: Banner on level start
- **WHEN** a level starts
- **THEN** an intro banner with the depth number and objective is visible and dismisses itself automatically

#### Scenario: Banner does not block play
- **WHEN** the intro banner is visible and the player moves Dave
- **THEN** movement responds immediately and no banner element intercepts input

### Requirement: First-session controls hint
The system SHALL show a compact controls hint during the first seconds of a
player's first session only, persisted so it does not reappear in later
sessions. The hint SHALL fade out on its own and SHALL be dismissible
immediately on any input.

#### Scenario: First session shows the hint
- **WHEN** a player starts play for the first time on a device (no prior dismissal recorded)
- **THEN** a controls hint appears near the start of play and fades out after a few seconds

#### Scenario: Hint shown once
- **WHEN** the player finishes or leaves a session that already displayed the hint and starts a new session
- **THEN** the hint does not appear again

### Requirement: New Game confirmation when a save exists
When a saved run exists, activating "NEW GAME" SHALL require an explicit
confirmation before the save is overwritten; canceling SHALL return to the
menu with the save intact. When no saved run exists, "NEW GAME" SHALL start
immediately without a confirmation step. "CONTINUE" SHALL NOT require
confirmation.

#### Scenario: Confirmation with save
- **WHEN** a saved run exists and the player activates NEW GAME
- **THEN** a confirmation prompt is shown and the game does not start until confirmed

#### Scenario: Cancel keeps the save
- **WHEN** the confirmation prompt is canceled (Esc, backdrop, or cancel button)
- **THEN** the menu is shown again and the saved run is unchanged and still offered via CONTINUE

#### Scenario: No save starts immediately
- **WHEN** no saved run exists and the player activates NEW GAME
- **THEN** the game starts immediately with no confirmation prompt

### Requirement: Best score tracking and visibility
The system SHALL track the best score achieved across runs, persisted locally.
The best score SHALL be updated when a run's score is banked (on level
completion or at game over) if it exceeds the stored best. The title screen
SHALL display the best score when one exists, and the game-over card SHALL
show the best score with a distinct "NEW BEST" badge when the finished run set
a new best.

#### Scenario: Title shows best score
- **WHEN** the title menu is shown and a best score greater than zero exists
- **THEN** the best score is displayed on the title screen

#### Scenario: New best on game over
- **WHEN** a run ends in game over with a score higher than the stored best
- **THEN** the game-over card shows the final score with a NEW BEST badge and the best is persisted

#### Scenario: No new best
- **WHEN** a run ends in game over with a score not exceeding the stored best
- **THEN** the game-over card shows the best score without the NEW BEST badge

### Requirement: Low-fuel warning toast
When jetpack fuel first falls below the low-fuel threshold during a run, the
system SHALL show a distinct warning toast (e.g., "FUEL LOW") exactly once per
depletion episode. The warning MAY be shown again only after the fuel has been
refilled above the threshold and falls low again; it SHALL NOT repeat while
the fuel remains low.

#### Scenario: One warning per episode
- **WHEN** fuel drops below the low threshold and the player keeps consuming it
- **THEN** a single FUEL LOW warning is shown and no further low-fuel warnings appear while fuel stays low

#### Scenario: Warning re-arms after refill
- **WHEN** fuel is refilled above the low threshold and then falls below it again
- **THEN** a new FUEL LOW warning is shown
