# Spec Delta

## Purpose

Makes the game playable on touch devices by providing on-screen virtual controls
that feed the same input pipeline as the keyboard, appearing only when the
device's primary pointer is coarse (touch) and staying out of the way otherwise.

## ADDED Requirements

### Requirement: Touch controls appear on touch devices
The system SHALL display the on-screen touch controls while a run is in the
"playing" flow when the device's primary pointer is coarse (touch), and SHALL
NOT display them on devices whose primary pointer is fine (mouse). The
visibility decision SHALL be re-evaluated when the available pointer
capabilities change (e.g., a convertible laptop switching modes).

#### Scenario: Touch device entering play
- **WHEN** a run starts on a device with a coarse primary pointer
- **THEN** the touch control overlay is visible during the "playing" flow

#### Scenario: Desktop device entering play
- **WHEN** a run starts on a device with a fine primary pointer (mouse)
- **THEN** no touch control overlay is displayed at any point during play

#### Scenario: Controls hidden outside active play
- **WHEN** the flow is menu, paused, game over, or level clear
- **THEN** the touch control overlay is hidden or non-interactive

### Requirement: Touch controls map to gameplay actions
The touch overlay SHALL provide controls for: hold-to-move left, hold-to-move
right, hold-to-jump, hold-to-fire-jetpack (vertical thrust), and tap-to-fire
(single shot). Firing SHALL be edge-triggered — one shot per tap — and SHALL
NOT auto-repeat while held, matching the keyboard fire behavior.

#### Scenario: Tap to fire
- **WHEN** the player taps the fire control once
- **THEN** exactly one shot is fired
- **WHEN** the player holds the fire control down
- **THEN** no additional shots fire after the first

#### Scenario: Hold to move and thrust
- **WHEN** the player holds the left control and the jetpack control
- **THEN** Dave moves left while jetpack thrust is applied for as long as both are held (subject to fuel)

### Requirement: Touch input merges with keyboard input
Touch controls and keyboard input SHALL work simultaneously without
interfering: releasing a touch control SHALL NOT release an action still held
on the keyboard, and releasing a key SHALL NOT release an action still held on
a touch control. Gameplay physics SHALL behave identically regardless of which
source produced an input state.

#### Scenario: Mixed release independence
- **WHEN** the player holds "right" on the keyboard and also holds the touch move-left control, then lifts the finger off the touch control
- **THEN** keyboard "right" remains active and Dave keeps moving right

### Requirement: Multi-touch gestures are supported
The touch controls SHALL track each pointer independently so that at least
three simultaneous touch interactions are possible (e.g., holding a move
control, holding jump, and tapping fire), with no dropped or stuck actions
when pointers are added or removed in any order.

#### Scenario: Simultaneous move, jump, and fire
- **WHEN** the player holds the right control with one finger, holds jump with a second finger, and taps fire with a third
- **THEN** all three actions register together and none is lost

#### Scenario: Pointers cancelled by the system
- **WHEN** an active touch is cancelled (e.g., an incoming call gesture or palm rejection)
- **THEN** the action that touch was holding is released and no control remains stuck

### Requirement: Touch pause affordance
While playing on a touch device, the system SHALL provide an on-screen pause
control so pausing is possible without a hardware keyboard.

#### Scenario: Pause from touch
- **WHEN** the player activates the on-screen pause control during play
- **THEN** the game enters the "paused" flow and the pause card is shown

### Requirement: Touch controls respect touch ergonomics
Touch control hit targets SHALL be at least 44×44 CSS pixels, placed along the
bottom corners of the viewport (movement on the left, actions on the right),
and SHALL NOT overlap or obscure the HUD readouts. The page under the overlay
SHALL NOT scroll, zoom, or select text in response to touches on the controls.

#### Scenario: Controls do not block the view
- **WHEN** the touch overlay is visible on a phone-sized viewport
- **THEN** the score, lives, and fuel HUD readouts remain fully visible and readable

#### Scenario: No accidental page interaction
- **WHEN** the player drags a finger across a touch control
- **THEN** the page does not scroll, zoom, or show a text-selection highlight
