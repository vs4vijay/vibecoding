# Spec Delta

## Purpose

Make the shell usable everywhere it installs: notched PWA phones, keyboard-only players,
and reduced-motion preferences — safe-area insets, visible focus, touch-target floors, and
global reduced-motion coverage.

## ADDED Requirements

### Requirement: Notch and home-indicator safety

All interactive controls and readouts SHALL respect device safe-area insets so neither
notches, rounded corners, nor home indicators overlap or occlude them, in both portrait
and landscape orientations of an installed (standalone) PWA.

#### Scenario: Notched phone keeps controls tappable

- **WHEN** the game runs standalone on a device with a notch/home indicator
- **THEN** every HUD control and readout renders fully inside the safe area with its touch target intact

### Requirement: Keyboard focus is visible

Every interactive control in the shell (buttons, inputs, toggles) SHALL show a clearly
visible focus indicator when focused by keyboard, distinct from the unfocused and
hover/active states. Focus styles MUST NOT be suppressed globally; keyboard activation
(Space/Enter on a focused control) SHALL work for every control.

#### Scenario: Tabbing the menu shows where you are

- **WHEN** a keyboard player presses Tab repeatedly on the menu screen
- **THEN** each control in turn shows a visible focus indicator and Space/Enter activates the focused control

### Requirement: Touch targets meet the floor

Every interactive control added or restyled by the shell SHALL present a touch target of
at least 44×44 CSS px (padding may extend the target beyond the visual glyph). Existing
controls that already meet the floor SHALL NOT regress.

#### Scenario: Small glyph still has a big target

- **WHEN** a compact icon-only control is rendered
- **THEN** its tappable area is at least 44×44 CSS px even though the icon is smaller

### Requirement: Reduced motion is honored globally

When the user's system requests reduced motion, ALL shell animation and movement
transitions (not a subset) SHALL be disabled or reduced to opacity-only fades; no control
or readout may depend on motion to be understood. The freeze kill-switch SHALL continue to
disable everything for deterministic captures, independent of the user preference.

#### Scenario: Reduced-motion session is still complete

- **WHEN** the game is played end to end with reduced motion requested at the system level
- **THEN** every screen works with no decorative animation, and no information is lost relative to an animated session

### Requirement: Toggles expose state accessibly

Every toggle control in the shell SHALL expose its on/off state through the accessible
pressed/checked state matching the actual audio or setting state at all times, including
immediately after boot and after any state change.

#### Scenario: Muted state is announced correctly

- **WHEN** the player mutes audio and a screen reader queries the toggle
- **THEN** the toggle reports a pressed state consistent with the muted state
