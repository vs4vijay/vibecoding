# Spec Delta

## Purpose

Make every screen transition and interruption path safe and complete: pause is reachable
from all schemes and offers restart/quit, resume is always grace-protected, the results
screen carries full run context, and audio settings distinguish music from sound effects.

## ADDED Requirements

### Requirement: Pause menu offers resume, restart, and quit

The pause overlay SHALL offer three actions: resume the current run, restart a new run,
and return to the menu. Each SHALL be a real control (touch target at least 44×44 CSS px)
and keyboard-selectable. Restarting or quitting from pause SHALL NOT double-count the
abandoned run's coins, games-played tally, or best score beyond what the run legitimately
earned before pausing.

#### Scenario: Touch player restarts from pause

- **WHEN** a touch player pauses and chooses restart
- **THEN** a fresh run begins with score/coins at zero and the prior partial run is not banked twice

#### Scenario: Quit from pause reaches the menu

- **WHEN** the player chooses menu from the pause overlay
- **THEN** the menu screen shows with up-to-date local stats and no paused run remains

### Requirement: Resume is grace-protected

Resuming from any pause (manual pause, or the automatic pause when the page is hidden)
SHALL NOT resume simulation instantly: the run SHALL remain frozen through a short,
skippable countdown or equivalent grace period, so the player is never returned to live
play without a moment to reorient. The grace period MUST NOT be counted as run time or
distance.

#### Scenario: Tab return does not kill

- **WHEN** the page becomes visible again after an automatic pause mid-run
- **THEN** the run stays frozen through the grace countdown before the simulation steps again

#### Scenario: Impatient player can skip the wait

- **WHEN** the player presses the resume action again during the grace countdown
- **THEN** the countdown shortens or skips and the run resumes immediately

### Requirement: Results screen carries run context

The game-over screen SHALL show, in addition to score: distance, coins, and the run's
elapsed duration. When the score is below the player's best, the screen SHALL communicate
the gap to the best; when the score sets a new best, the screen SHALL celebrate it
distinctively. The retry and menu actions SHALL remain reachable in one touch/keypress each.

#### Scenario: Losing run shows the gap

- **WHEN** a run ends with a score below the stored best
- **THEN** the results screen shows how far the run was from that best

#### Scenario: New best is celebrated

- **WHEN** a run ends with a score above the stored best
- **THEN** the results screen presents the new-best state distinctively from a normal result

### Requirement: Audio settings separate music and effects

The menu settings SHALL expose separate music and sound-effect toggles, each persisting
its state across sessions and reflecting it on boot. Both toggles SHALL be reflected in
a correct accessible pressed state. The in-run mute control SHALL continue to mute all
audio output as today.

#### Scenario: Music off, effects on

- **WHEN** the player turns music off but leaves effects on and starts a run
- **THEN** no music plays during the run while collect/crash effect sounds still play, and the choices persist after a page reload

### Requirement: Screen transitions do not jar

Screen-to-screen changes (menu → run, run → results, results → menu, pause show/hide)
SHALL use short transitions consistent with the shell's motion tokens, and SHALL collapse
to instant swaps under the freeze kill-switch so deterministic captures are unaffected.

#### Scenario: Frozen capture of a transition state

- **WHEN** a deterministic capture is taken while a screen transition would be mid-flight
- **THEN** the captured frame shows a settled, reproducible state
