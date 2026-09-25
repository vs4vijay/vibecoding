# Spec Delta: hud-ui-presentation

## Purpose

Defines the presentation standards for the DOM overlay (menu, HUD, game-over, loading) —
typography, icons, screen transitions, and feedback motion — so the interface layer matches
the quality of a polished arcade game rather than a default web form.

## ADDED Requirements

### Requirement: Game typography and icons

Titles and HUD numerals SHALL render in a bundled display typeface (not the browser default
system font), and score/coin/count indicators SHALL use inline vector icons rather than emoji
characters. The display typeface SHALL be a locally served asset (bundled with the client),
loadable offline via the existing PWA cache.

#### Scenario: Title uses display typeface
- **WHEN** the menu screen renders
- **THEN** the game title renders in the bundled display typeface, distinguishable from the
  browser default system font

#### Scenario: Coin indicator is vector, not emoji
- **WHEN** the HUD or game-over screen shows the coin count
- **THEN** the indicator icon is an inline SVG graphic rather than an emoji glyph

#### Scenario: Typeface available offline
- **WHEN** the PWA is loaded from cache with no network
- **THEN** the display typeface renders (served from the local bundle/cache, no font CDN)

### Requirement: Animated screen transitions

Transitions between menu, playing, and game-over screens SHALL animate (fade or slide) over a
short duration rather than toggling instantly.

#### Scenario: Run start transition
- **WHEN** the player starts a run
- **THEN** the menu screen animates out (fade) within roughly half a second as gameplay begins

#### Scenario: Game-over transition
- **WHEN** a run ends
- **THEN** the game-over screen animates in rather than appearing instantaneously

### Requirement: Score and combo feedback motion

The score display SHALL animate to new values (count-up tween) instead of jumping, and combo
gain SHALL produce a brief scale-pulse on the combo display. Both animations complete quickly
(enough to not lag behind rapid events).

#### Scenario: Score counts up
- **WHEN** the player collects a coin
- **THEN** the score display animates from its previous value toward the new value over a
  fraction of a second instead of snapping

#### Scenario: Combo pulses
- **WHEN** the combo counter increases while visible
- **THEN** the combo display scales up briefly and returns, per increase

### Requirement: Damage feedback

Ending a run by collision SHALL flash a red overlay on the screen before the game-over screen
appears, so the crash moment is felt.

#### Scenario: Crash flash
- **WHEN** a collision ends the run
- **THEN** a red flash covers the screen and fades out before or as the game-over screen
  animates in

### Requirement: Play vignette

During active gameplay, a subtle vignette (edge darkening) overlay SHALL be present, keeping
the center of the screen brightest.

#### Scenario: Vignette visible in play
- **WHEN** the game is in the playing state
- **THEN** the rendered screen shows darker edges relative to the center (vignette overlay
  present), without obscuring HUD legibility
