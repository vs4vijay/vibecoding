# Tasks

## 1. Input injection API (foundation for touch)

- [x] 1.1 Add `press(action)`, `release(action)`, `queueFire()` to `src/core/Input.ts` reusing the existing `held`/`fireQueued` machinery, and unit-test them in `tests/input.test.ts` against `read()`/`holdFrames()` (press→held true, release→false, queueFire→exactly one fire edge, keyboard `keyDown`/`keyUp` behavior unchanged). Verify: `bun run test tests/input.test.ts` passes.
- [x] 1.2 Extend the determinism-adjacent checks: confirm `read()`/`tick()` semantics are untouched by running the full suite. Verify: `bun run test` passes with no modified expectations.

## 2. Best-score persistence and UI state plumbing

- [x] 2.1 Create `src/state/BestScore.ts` (`load`/`save`/`submit(score) → isNewBest`, key `dave-dangerous-best`, try/catch no-ops like `SaveState`) and unit-test load/save/submit/first-run/corrupt-data cases. Verify: new test file passes.
- [x] 2.2 Add additive fields `best: number` and `newBest: boolean` to `RenderUiState` in `src/render3d/viewTypes.ts` and populate them in `game.ts` `uiState()` (best via `BestScore.load()`; `newBest` true only for the run that just set it). Verify: `bun run typecheck` passes.
- [x] 2.3 In `game.ts`, bank the best score where runs already persist — on `level:complete` (alongside `SaveState.persist`) and when the flow transitions to game over — and verify with a unit test in `tests/game.test.ts` that a higher-than-best run sets `newBest` exactly once and persists. Verify: `bun run test tests/game.test.ts` passes.

## 3. Accessibility foundations in UI.ts

- [x] 3.1 Adopt roving tabindex in the menu model: `applySelection()` sets the selected item `tabIndex = 0` and others `-1`, and expose selection with `aria-current="true"`; keep arrow/Enter behavior identical. Verify: manual DOM check via dev-server page — Tab reaches the selected item, arrows move selection, `bun run test` passes.
- [x] 3.2 Add dialog semantics and focus management to modal cards (pause, game over, clear, plus the 4.x confirm dialog): `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the card title, focus the primary button on open, trap Tab while open, restore previous focus on close. Verify: keyboard walkthrough on the dev server — open pause with P, Tab cycles inside, Esc closes and focus leaves the hidden card.
- [x] 3.3 Mark the toast container `aria-live="polite"`, wrap the HUD as `role="region"` + `aria-label`, and convert the HUD sound pill into a real `<button>` with `aria-pressed` mirroring mute state (click toggles mute). Verify: `bun run typecheck` + manual check that the pill toggles mute and reflects M-key state.
- [x] 3.4 Add a JS-level `prefers-reduced-motion` guard (`matchMedia`) used by animated features from groups 4–5 so reduced-motion users get instant states. Verify: emulate reduced motion in devtools — entrance animations and loops are inert while states still render.

## 4. Menu: New Game confirmation

- [x] 4.1 Implement the UI-internal confirm modal (per design D3): NEW GAME with an existing save opens a small `.ddui-panel` confirm card; confirm calls a new `onStartConfirmed` callback (wired to `startGame()` in `game.ts`), cancel/Esc/backdrop returns to the menu with the save intact. Verify: manual check on the dev server with a seeded save — confirm starts fresh, cancel returns with CONTINUE still offered.
- [x] 4.2 Verify no-save New Game still starts immediately and CONTINUE never prompts. Verify: manual check with cleared localStorage + a unit test in `tests/game.test.ts` covering the callback wiring.

## 5. Guidance and feedback features

- [x] 5.1 Level intro banner: on `setState` level diff during play, show a passive top-center banner ("DEPTH NN — FIND THE TROPHY · OPEN THE EXIT") that auto-dismisses (~2.6 s via `later()`), re-arms per level, and never intercepts input. Verify: dev-server check that movement works under the banner and it dismisses itself.
- [x] 5.2 First-session controls hint: show a compact hint for ~6 s on the first entry to `playing` (flag `dave-dangerous-hinted`), fade automatically, dismiss early on any key/pointer, touch-adapted copy when pointer is coarse. Verify: dev-server check — appears once, second session with flag present shows nothing.
- [x] 5.3 Low-fuel toast: fire "FUEL LOW" once when `lowFuel` flips true, re-arm when it flips false (extend the existing diff cache). Verify: unit-testable helper logic asserted in a new UI-helpers test + dev-server sanity check.
- [x] 5.4 Best-score surfaces: best score line on the title screen (when > 0), and on the game-over card show best with a "NEW BEST" badge when `newBest` is set. Verify: dev-server check with a seeded best value.
- [x] 5.5 Score count-up on game-over/clear cards (eased ~0.8 s, ends exactly at the cached value, skipped under reduced motion). Verify: dev-server check that the final displayed value always equals the real score.

## 6. Touch controls

- [x] 6.1 Create `src/render3d/ui/TouchControls.ts` per design D2: `ddtc-*` scoped CSS, pointer-event map (`pointerId → action`), `press/release/queueFire` wired to callbacks, `pointercancel`/`lostpointercapture` releases, `setPointerCapture` per control, ≥44-px targets, safe-area padding, `touch-action: none`. Verify: new unit tests for the pure mapping logic (id map add/remove/cancel) pass.
- [x] 6.2 Gate visibility: mount only when `matchMedia("(pointer: coarse)")` (fallback `(hover: none)`) and flow is `playing`; re-evaluate on media-query `change`; destroy cleanly in `dispose()`. Verify: dev-server check with pointer emulation — no DOM on desktop emulation, overlay appears under coarse emulation and toggles with flow.
- [x] 6.3 Wire into `game.ts`: construct with callbacks → `Input`, call `setVisible` from the render loop's flow, and add the on-screen pause control hooked to `togglePause()`. Verify: coarse-emulation playthrough — move, jump, jetpack, single-shot fire per tap, pause chip pauses.
- [x] 6.4 Add `touch-action: none` guards in `index.html` for the app/overlay so page scroll/zoom/selection never triggers under the controls. Verify: dev-server check — dragging on controls does not scroll or select.

## 7. Integration verification

- [x] 7.1 Full quality gates: `bun run test` (all existing + new tests green), `bun run typecheck` strict, dev-server console clean. Verify: commands exit 0.
- [x] 7.2 Keyboard scenario checklist (per design Risks): arrows/Tab/Enter/Esc across menu ↔ confirm ↔ pause ↔ game over, focus restored after each dialog, M toggling sound from every screen. Verify: checklist executed on the dev server with outcomes recorded in the PR description.
- [x] 7.3 Mobile spot-check at ~390×844 and ~768×1024: HUD readable, controls reachable one-handed, no overlap with HUD readouts, no stuck actions after multi-touch and pointercancel. Verify: dev-server responsive-mode walkthrough.
- [x] 7.4 Contrast spot-check: dimmest label tokens over panel backgrounds ≥ 4.5:1 (computed), adjust a token only if a check fails. Verify: computed-style audit recorded in the PR description.
