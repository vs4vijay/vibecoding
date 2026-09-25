# Spec Delta

## Purpose

The mode-agnostic play shell and its UX loop: the application state machine
(playing/paused/gameover), the in-run HUD, the pause screen, the gameover screen with
instant retry, persistence of bests and currency, and gameplay input across keyboard and
touch. Every mode (RUN now, DRIVE and RIDE later) plugs into this shell unchanged.

## ADDED Requirements

### Requirement: Play state machine
The shell SHALL implement the states LOADING → MENU → PLAYING → GAMEOVER with a PAUSED
overlay inside PLAYING. Starting a mode from the menu SHALL enter PLAYING for that mode;
ending a run SHALL enter GAMEOVER; from GAMEOVER the player can retry (back into PLAYING,
same mode) or return to MENU.

#### Scenario: Run ends in gameover
- **WHEN** the active mode reports the run has ended (collision, zombie contact)
- **THEN** the shell shows the gameover screen with the run's stats

#### Scenario: Retry returns to play
- **WHEN** the player confirms retry on the gameover screen
- **THEN** a fresh run of the same mode starts without a full page reload

### Requirement: Pause
While PLAYING, the pause input (Esc key or on-screen pause control) SHALL freeze the
simulation and show a pause overlay with Resume, Restart, and Quit (to menu). Leaving the
tab (visibility change) SHALL trigger the same paused state. The shell MUST NOT silently
exit a live run: Esc pauses rather than quits.

#### Scenario: Pause and resume
- **WHEN** the player presses Esc during a run and then chooses Resume
- **THEN** the simulation freezes while paused and continues exactly where it stopped

#### Scenario: Auto-pause on tab hide
- **WHEN** the tab is hidden mid-run
- **THEN** the run pauses and the pause overlay is shown when the tab returns

### Requirement: In-run HUD
During PLAYING the shell SHALL show a minimal DOM HUD with distance, score, and pickups
(laid out per the active mode's HUD layout), and SHALL hide it in every other state. The
HUD MUST NOT use canvas rendering and MUST stay legible over both dusk and night scenes.

#### Scenario: HUD visibility follows state
- **WHEN** a run starts and later ends
- **THEN** the HUD is visible during play and hidden on the gameover and menu screens

### Requirement: Gameover screen and instant retry
The gameover screen SHALL show distance, score, pickups collected, and the mode's previous
best, and SHALL flag a new best when achieved. It SHALL offer Retry and Menu. Retry input
(Enter/Space, or tapping Retry) SHALL restart the run within about a second with no page
reload, and the UI MUST make the retry affordance the primary action.

#### Scenario: Gameover stats and new best
- **WHEN** a run ends with a distance greater than the stored best for that mode
- **THEN** the gameover screen shows the run's stats and a new-best flag

#### Scenario: Instant retry
- **WHEN** the player presses Enter (or taps Retry) on the gameover screen
- **THEN** a fresh run of the same mode starts within about a second, without reloading the page

### Requirement: Persistence of bests and currency
When a run ends, the shell SHALL record the mode's best distance (only when improved) and
credit accumulated pickup currency to the versioned save (`endless.save.v1`). The menu
SHALL reflect the saved bests.

#### Scenario: Best persisted across sessions
- **WHEN** a run sets a new best and the page is reloaded
- **THEN** the menu shows the recorded best for that mode

#### Scenario: Currency accrual
- **WHEN** a run ends with pickups collected
- **THEN** the credited currency total persists in the save

### Requirement: Gameplay input mapping
The shell SHALL map gameplay input in PLAYING only: left/right lane, jump, slide, and pause
from keyboard (WASD/arrows/Space/Esc), and swipe left/right/up/down plus tap zones from
touch. Menu interactions (1/2/3 select, Enter start, Esc back) MUST keep working unchanged,
and no gameplay action may fire while paused.

#### Scenario: Keyboard mapping
- **WHEN** the player uses A/D or ←/→, W/↑/Space, S/↓, and Esc during a run
- **THEN** lane change, jump, slide, and pause actions are delivered respectively

#### Scenario: Touch swipe mapping
- **WHEN** the player swipes left/right/up/down on the touch surface during a run
- **THEN** lane change, jump, and slide actions are delivered respectively

### Requirement: QA scenes for the shell
The QA contract SHALL gain `scene=gameover` and `scene=paused` staging (deterministic
screens for capture), alongside the existing menu/game scenes, with `window.__QA` gating
and zero-console-noise rules unchanged.

#### Scenario: Gameover capture ready
- **WHEN** the QA harness loads `?qa=1&scene=gameover` with a staged run result
- **THEN** the gameover screen renders with deterministic stats and `screenshotReady`
  flips under the existing warm-frames/queue/settle gates
