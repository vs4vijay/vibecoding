# Design

## Context

The overlay is one self-contained module, `src/render3d/ui/UI.ts`: it builds its
own DOM + scoped stylesheet (`ddui-*` prefix), receives the full `RenderUiState`
every frame via `setState()`, and diffs before touching the DOM. It never
imports the sim; `game.ts` owns orchestration and reads input once per physics
tick from `core/Input`, where `fire` is an edge-queued flag consumed by
`read()`. Persistence is `SaveState` (run progress only). Keyboard menu
selection is a custom model (capture-phase keydown hijack, all buttons
`tabIndex = -1`). DESIGN.md's standing rule: simulation behavior must not
change, and the UI must stay on the 8-px grid / glass-panel / gold-hairline
system.

See proposal.md for motivation; the three spec deltas define the behavior
contract.

## Goals / Non-Goals

**Goals:**

- Touch playability with zero behavior change for keyboard players.
- Guidance and feedback additions that reuse the existing panel/toast/Screen
  system and diff-driven update model.
- Accessibility semantics without rebuilding the menu model.
- All new persistence in independent localStorage keys.

**Non-Goals:**

- Gamepad support, key remapping, a settings screen, quality options.
- Any change to physics, levels, enemies, or scoring math.
- Replacing the scoped-CSS-in-TS approach with a CSS framework or build step.

## Decisions

### D1 — Touch input: additive `press`/`release`/`queueFire` on `Input`

`Input` gains three public methods (`press(action)`, `release(action)`,
`queueFire()`) that reuse the existing `held`/`fireQueued` machinery — the same
paths `keyDown`/`keyUp` test hooks already exercise. The keyboard path is
byte-for-byte unchanged; `read()` semantics are untouched.

- Alternatives considered: synthesizing `KeyboardEvent`s from the touch layer
  (fragile, `isTrusted: false` indirection, and it would double-`preventDefault`
  against the real handler); merging a second `InputState` source inside
  `game.ts` (duplicates the fire edge/buffering logic and risks divergence from
  `holdFrames()` behavior that tests pin down).
- Rationale: fire is edge-queued *inside* `Input`, so any merge approach must
  reimplement edge logic; reusing `Input` keeps one source of truth. `Input` is
  input plumbing, not deterministic physics — the DESIGN.md "sim must not
  change" rule targets gameplay behavior, which is preserved exactly.

### D2 — TouchControls is a sibling module following the UI.ts pattern

New `src/render3d/ui/TouchControls.ts`: self-contained DOM + scoped CSS
(`ddtc-*` prefix), no sim imports. It exposes `{ onPress(action),
onRelease(action), onFire(), onPause() }` callbacks; `game.ts` wires them to
`Input`. Lifecycle: `game.ts` calls `setVisible(flow)`; visibility is gated on
both pointer capability and the "playing" flow, so the overlay is absent on
desktop and inert in menus.

- Pointer handling: Pointer Events with a `pointerId → action` map (true
  multi-touch), `pointercancel`/`lostpointercapture` release the action (no
  stuck keys), and per-control `setPointerCapture` so sliding off a button
  doesn't drop the hold.
- Detection: `matchMedia("(pointer: coarse)")` with `(hover: none)` as the
  fallback signal; `change` listeners re-evaluate on mode switches
  (convertibles).
- Layout: movement cluster bottom-left (left/right pads), action cluster
  bottom-right (jump, jetpack, fire arranged in an arc), pause chip top-right
  below the HUD panels; ≥44-px targets, `env(safe-area-inset-*)` padding,
  `touch-action: none` on every control.
- Alternative considered: rendering controls in-canvas in Three.js — rejected:
  DOM gives free hit-testing, focus, and styling consistency with the existing
  overlay.

### D3 — New Game confirmation lives entirely inside the UI

The confirmation is a UI-internal state within the `menu` flow (a small modal
card reusing `.ddui-panel`/`.ddui-card`), toggled from the NEW GAME item when
`syncMenuProgress` reports a save. `game.ts` gets one new callback,
`onStartConfirmed()` (wired to the same `startGame()`); cancel returns to the
menu. `RenderUiState` is unchanged for this feature.

- Alternative considered: a new `"confirm"` flow value in `RenderUiState` —
  rejected: the flow type describes game state, not menu sub-states, and
  routing it through `game.ts` would spread menu logic across modules.

### D4 — Best score: separate key + additive `RenderUiState` fields

New `src/state/BestScore.ts` mirroring the `SaveState` pattern (try/catch
no-op on storage failure), key `dave-dangerous-best`. `game.ts` banks the best
wherever a run's score is already persisted (`level:complete` →
`SaveState.persist`, and at the transition to game over), tracking `newBest`
for the card. `RenderUiState` gains two additive fields: `best: number` and
`newBest: boolean` — it is a UI-facing view type (`viewTypes.ts`), not sim
core, so extending it does not affect determinism. `SaveData` schema is
untouched, so existing saves stay valid.

### D5 — Guidance features are UI-internal, timer-driven

- **Level intro banner**: UI shows it when `setState` diffs `level` upward
  during play; passive (existing `pointer-events: none` HUD pattern), lives
  top-center below the HUD, auto-dismisses via the existing `later()` timer,
  and re-arms on the next level change. No `game.ts` involvement.
- **First-session hint**: `localStorage` flag `dave-dangerous-hinted`; shown
  on the first entry to `playing`, fades after ~6 s, and any key/pointer
  dismisses it early (hook the existing gesture listeners). Copy adapts to
  touch devices (UI already knows pointer capability for D2).
- **Low-fuel toast**: UI fires once when `lowFuel` flips true, re-arms when it
  flips false — a one-line extension of the existing diff cache.
- **Score count-up**: end-of-run cards animate the displayed value to the
  final score over ~0.8 s with an ease-out; `cache.score` is set immediately so
  the diff engine never re-triggers mid-animation. Count-up and banner skip
  animation under `prefers-reduced-motion` (JS `matchMedia` check — the CSS
  override alone doesn't stop JS-driven steps).

### D6 — Accessibility within the existing menu model

- Menu items stay native `<button>`s but adopt a **roving tabindex**: selected
  item `tabIndex = 0`, others `-1`, updated in `applySelection()`. Arrow keys
  keep the custom model; Tab now works natively. Selected state is exposed
  with `aria-current="true"`.
- Modal cards get `role="dialog"` + `aria-modal="true"` +
  `aria-labelledby` pointing at their title, a minimal focus trap while open,
  focus moves to the primary button on open, and focus is restored to the
  previously focused element on close.
- Toast container gets `aria-live="polite"`; the HUD wrapper gets
  `role="region"` + `aria-label`; the HUD sound pill becomes a real `<button>`
  with `aria-pressed` mirroring mute state.
- The existing `:focus-visible` styling becomes the single visible-focus
  mechanism; pointer interactions keep it hidden because `:focus-visible`
  doesn't match pointer-initiated focus in modern browsers.
- Contrast: current dim-label token (`#93a6b1`) on the panel background
  computes to ≈7:1 — passes AA; tokens stay as-is, verified in tasks.

## Risks / Trade-offs

- [Capture-phase menu keydown must coexist with Tab focus + dialog traps] →
  one shared keydown decision table in UI (flow → allowed keys), covered by a
  keyboard-scenario checklist task before merge.
- [Touch overlay regressing desktop] → zero DOM is created on fine-pointer
  devices (visibility gate short-circuits before mount); desktop rendering is
  verified by the existing smoke tests plus a pointer-emulation check.
- [Additive `Input` methods drifting from keyboard semantics] → unit tests
  mirror the `keyDown`/`keyUp` hooks: press/release/queueFire asserted against
  the same `read()`/`holdFrames()` outputs.
- [localStorage unavailable (private mode)] → all new storage paths use the
  existing try/catch no-op pattern; the game runs with best score/hint simply
  absent.
- [Focus restoration leaving keyboard users stranded] → dialogs store and
  restore `document.activeElement`; verified in the keyboard checklist.
- [Count-up racing the diff cache] → animation writes only the text node and
  ends exactly at the cached value; a `setState` arriving mid-animation is a
  no-op because the cache is already current.

## Migration Plan

No data migration: best score and hint flag are new independent localStorage
keys; `SaveData` is untouched. Rollback is a plain revert — orphaned keys are
harmless. Deploy follows the existing GitHub Pages workflow.

## Open Questions

None material. Exact copy strings (banner text, hint lines) are deferrable and
owned by tasks.md.
