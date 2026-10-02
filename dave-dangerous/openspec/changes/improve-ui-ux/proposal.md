# Proposal

## Why

The game's overlay UI already matches the CATACOMB DEPTHS art direction, but the
player experience has real gaps: the game is unplayable on touch devices (no
on-screen controls), a first-time player gets no in-game guidance about what to
do, starting a New Game silently destroys saved progress, and the overlay has no
accessibility semantics (no ARIA roles, no live regions, menu buttons are
unreachable by screen readers). These gaps hurt first-session retention and
exclude players on mobile and assistive tech.

## What Changes

- **Touch controls**: on-screen virtual controls (move left/right, jump,
  jetpack, fire) that appear automatically on coarse-pointer/touch devices;
  synthesized into the existing input pipeline without changing gameplay
  behavior for keyboard players.
- **Player guidance**: per-level intro banner ("DEPTH 01" + objective line), a
  fading controls hint during the first seconds of a first session, and an
  explicit confirmation before New Game overwrites a saved run.
- **Progress feedback**: best score tracked across runs, surfaced on the title
  screen and as a "NEW BEST" badge on the game-over card; score count-up
  animation on end-of-run cards; low-fuel warning toast.
- **Accessibility**: dialog semantics on modals, an `aria-live` toast region, a
  roving-focus menu model that screen readers can operate, and visible focus
  that works for both pointer and keyboard interaction.

Non-goals: gamepad support, remappable keys, settings storage beyond best
score/mute, redesign of the 3D scene rendering, changes to simulation physics
or level content.

## Capabilities

### New Capabilities

- `ui-touch-controls`: on-screen touch controls for coarse-pointer devices —
  when they appear, what each control does, how they merge with keyboard input,
  and how they stay out of the way on desktop.
- `ui-player-guidance`: level intro banners, first-session controls hint, New
  Game confirmation when a save exists, and best-score visibility on title and
  end-of-run screens.
- `ui-accessibility`: ARIA semantics for screens/dialogs/toasts, keyboard and
  assistive-tech operability of the menu, and motion-reduction behavior.

### Modified Capabilities

(none — the project has no existing specs; all three capabilities above are new)

## Impact

- `src/render3d/ui/UI.ts` — reworked: ARIA roles, intro banner, confirm flow,
  best-score readouts, count-up animation, low-fuel toast.
- `src/render3d/ui/TouchControls.ts` — **new**: touch overlay module (same
  self-contained pattern as UI.ts).
- `src/game.ts` — wires touch input into the frame update, best-score tracking,
  New Game confirmation flow.
- `src/core/Input.ts` — **additive only**: public `press`/`release`/`queueFire`
  injection methods so touch controls can drive the existing pipeline; the
  keyboard path and physics behavior are unchanged.
- `src/state/SaveState.ts` — **additive only**: best score in a separate
  localStorage key; existing `SaveData` schema untouched.
- `index.html` — `touch-action` handling so the page never scrolls/zooms under
  the touch overlay.
- Tests: unit coverage for the new `Input` injection API and pure UI helpers;
  existing 93-test suite must stay green; typecheck stays strict.
