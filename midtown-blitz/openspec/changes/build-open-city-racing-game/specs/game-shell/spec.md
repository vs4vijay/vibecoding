# Spec Delta

## Purpose

Owns the game's top-level flow: launching and loading the game, navigating between menu and play modes, pausing, presenting results, and persisting settings and player records between sessions.

## ADDED Requirements

### Requirement: Game bootstrap and loading screen
Opening the game SHALL display a branded loading screen with a progress indicator and SHALL transition to the main menu only once the city world and player car are ready to render. The game entry script SHALL load the graphics library and game code as ES modules from a local dev server or static build.

#### Scenario: First load shows progress
- **WHEN** the page is opened and world generation is in progress
- **THEN** the loading screen is visible showing the game title and a progress bar that advances toward completion

#### Scenario: Load completes into menu
- **WHEN** world generation and initial scene setup finish
- **THEN** the loading screen fades out and the main menu is displayed and interactive

### Requirement: Mode navigation state machine
The game SHALL manage a single active mode at a time — main menu, racing (any event type), paused, or results — and SHALL provide navigation between them: starting an event from the menu, pausing and resuming during play, restarting an event, and quitting back to the main menu. Quitting or restarting SHALL return the game to a consistent state with no leftover timers, audio, or mode UI from the previous run.

#### Scenario: Start a race from the menu
- **WHEN** the player selects a race from the main menu
- **THEN** the menu is dismissed, the race event initializes, and the player is in control of the car at the race start

#### Scenario: Pause and resume
- **WHEN** the player presses the pause control during a race
- **THEN** the simulation stops advancing, a pause menu with Resume / Restart / Quit options is shown, and choosing Resume returns to the exact prior race state with the timer resuming

#### Scenario: Quit to menu cleans up
- **WHEN** the player chooses Quit from the pause menu
- **THEN** the race's timers, sounds, and on-screen race UI are removed and the main menu is shown with no state carried over

### Requirement: Settings with immediate effect
The game SHALL provide user-adjustable settings, including at minimum master audio volume (with mute) and graphics quality, and changes SHALL take effect immediately without reload.

#### Scenario: Volume change applies immediately
- **WHEN** the player lowers the master volume in settings while any sound is playing
- **THEN** the change is audible immediately and reflected in the settings UI

#### Scenario: Quality change applies immediately
- **WHEN** the player selects a different graphics quality level
- **THEN** the renderer applies the corresponding setting (such as resolution scale or draw distance) immediately without a page reload

### Requirement: Persistence across sessions
The game SHALL persist user settings and player records (best times and medals per event) to browser local storage and restore them on the next session. If stored data is missing, corrupted, or unparsable, the game SHALL fall back to defaults and continue running without errors.

#### Scenario: Records survive reload
- **WHEN** the player earns a best time, then reloads the page
- **THEN** the main menu shows the saved best time for that event

#### Scenario: Corrupted storage tolerated
- **WHEN** local storage contains invalid data for the game's key
- **THEN** the game starts with default settings and empty records and overwrites the bad data on the next save

### Requirement: Frame-rate independence
The simulation SHALL advance deterministically with respect to elapsed time, so that car speeds, race timers, and physics outcomes are identical for the same inputs regardless of the rendered frame rate. Rendering and simulation SHALL be decoupled so a slow frame slows visuals smoothly without accelerating or skipping gameplay time beyond a bounded catch-up limit.

#### Scenario: Same pace at different frame rates
- **WHEN** the same full-throttle straight-line drive is performed on a machine rendering 30 fps and one rendering 60 fps
- **THEN** the car covers the same distance in the same wall-clock time and the race timer agrees with wall-clock time in both cases
