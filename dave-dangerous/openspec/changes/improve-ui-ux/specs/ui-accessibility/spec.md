# Spec Delta

## Purpose

Makes the overlay perceivable and operable for assistive technology and
keyboard users: proper roles and names on screens and dialogs, live-region
announcements for toasts, a menu that keyboard and screen-reader users can
operate, visible focus, and respect for reduced-motion preferences.

## ADDED Requirements

### Requirement: Screens and dialogs expose correct semantics
Each overlay screen SHALL expose appropriate semantics: modal cards (pause,
game over, level clear, New Game confirmation) SHALL be announced as dialogs
with accessible names; the in-game HUD SHALL be exposed as a labeled region
that does not announce continuously during play.

#### Scenario: Pause dialog is announced
- **WHEN** the pause card appears
- **THEN** assistive technology can identify it as a dialog named for pausing, containing the RESUME and RESTART actions

#### Scenario: HUD is a labeled region
- **WHEN** a run is in progress
- **THEN** the HUD is exposed as a single labeled region rather than unlabeled scattered text

### Requirement: Toasts announce via a live region
Toast notifications SHALL be rendered inside a container marked as a polite
live region so their text is announced by assistive technology without moving
keyboard focus or interrupting the current announcement context.

#### Scenario: Pickup toast announced
- **WHEN** a pickup toast appears during play
- **THEN** its text is announced politely and keyboard focus does not move

### Requirement: Menu is keyboard and assistive-tech operable
Every interactive menu item SHALL be a real button with an accessible name and
an exposed selected state. The menu SHALL remain fully operable with keyboard
only: arrow keys move the selection, Enter/Space activates it, and Tab SHALL
also traverse the interactive items with the visible focus indicator. The
How-to-Play panel and Sound toggle SHALL be reachable and togglable without a
pointer.

#### Scenario: Arrow and Tab navigation
- **WHEN** the player uses ArrowDown/ArrowUp or Tab/Shift+Tab in the title menu
- **THEN** the selection moves between menu items and the selected state is both visually indicated and exposed to assistive technology

#### Scenario: Activate without a pointer
- **WHEN** a keyboard user focuses HOW TO PLAY and presses Enter or Space
- **THEN** the controls panel opens, and pressing Escape closes it

#### Scenario: Sound without a pointer
- **WHEN** a keyboard user activates the SOUND menu item or presses M
- **THEN** the mute state toggles and the new state is both shown in the menu and announced by the accessible name/state

### Requirement: Visible focus for all interaction
All interactive elements SHALL show a visible focus indicator when focused via
keyboard, and SHALL NOT leave a persistent focus ring after pointer
interaction. Focus SHALL be moved into a modal dialog when it opens and
returned to a sensible location when it closes, so keyboard users are never
left with focus on a hidden element.

#### Scenario: Keyboard focus visible, pointer focus clean
- **WHEN** a user Tabs to a menu item or button
- **THEN** a visible focus indicator appears
- **WHEN** a user clicks or taps the same element
- **THEN** no persistent focus ring remains after the interaction

#### Scenario: Focus enters and leaves dialogs
- **WHEN** the pause dialog opens
- **THEN** keyboard focus moves to an actionable control inside it, and when the dialog closes focus returns to the gameplay context rather than staying on a hidden element

### Requirement: Reduced motion is respected
When the user prefers reduced motion, the overlay SHALL disable or minimize
non-essential animation (entrance transitions, looping glows, shimmer,
equalizer bars, screen shake from UI) while keeping all information and
functionality intact.

#### Scenario: Reduced motion disables decoration only
- **WHEN** the user's system preference is reduced motion and the title menu is shown
- **THEN** elements appear without animated entrances or looping glow animations, and the menu remains fully usable

### Requirement: Text contrast meets accessibility thresholds
Overlay text SHALL meet WCAG AA contrast (4.5:1 for body text, 3:1 for large
text) against the panel and scene backgrounds it renders over, including the
dimmer label styles.

#### Scenario: Dim labels readable on panels
- **WHEN** the HUD or menu renders its dimmest label style over a glass panel
- **THEN** the text contrast against the effective background is at least 4.5:1
