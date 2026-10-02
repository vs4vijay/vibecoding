# Tasks

## 1. Shell foundation (tokens, accessibility baseline)

- [x] 1.1 Add motion/spacing/radius tokens (`--dur-1/2`, `--ease-out`, spacing + radius scale) to the `:root` token block and migrate chip/panel radii + paddings onto them — verify: `style.css` contains the tokens and no component hardcodes a one-off radius/padding value from the old set (grep sweep)
- [x] 1.2 Accessibility baseline sweep: `viewport-fit=cover` on the viewport meta; `env(safe-area-inset-*)`-aware padding (via `max()`) on `#hud`, both corner buttons, and the menu container; one `:focus-visible` accent-outline rule covering `button, input, [tabindex]`; extend the `prefers-reduced-motion` block to a global animation/transition kill — verify: `.qa/ui-ux-smoke.mjs` static checks assert all four (meta, env() usage, focus-visible rule, global reduced-motion block) and `.qa-freeze` still wins under both
- [x] 1.3 Touch-target audit: pause button (new, 44×44), mute (keep 44×44), settings rows and results buttons padded to ≥44 px targets — verify: smoke check computes target boxes from CSS for each control (or asserts min-height/min-width + padding rules) and all pass ≥44

## 2. Input scheme + gesture exclusion (onboarding, run-hud groundwork)

- [x] 2.1 Create `core/scheme.js`: boot-time `matchMedia('(pointer: coarse)')` detection, first-`touchstart` latch to touch mode, `data-scheme` attribute on `<html>` — verify: probe stubs `matchMedia` both ways and asserts attribute value; simulated touchstart flips keys→touch and sticks
- [x] 2.2 Add `data-input-exclude` gesture exclusion to `InputManager` touch handlers (ignore gestures starting inside a marked element); mark mute + new pause button — verify: probe dispatches a touch starting on a marked element and asserts no gameplay action, then a touch starting on the canvas asserts the action fires
- [x] 2.3 Scheme-aware hint helper: `applyHints()` fills menu/pause/results hint elements with swipe/tap or key wording per scheme (no mixed lines) — verify: probe with `data-scheme="touch"` asserts swipe copy and zero key names in hint elements; `"keys"` asserts the reverse; both schemes' strings exist in the map (static check)

## 3. Pause control, pause menu, safe resume (run-hud, game-flow)

- [x] 3.1 HUD pause button (bottom-left, 44×44, `data-input-exclude`, `pointerdown` → pause) alongside mute; keyboard Esc/P unchanged — verify: probe taps the button mid-run (RUN → paused overlay visible), resumes, and swipes elsewhere still change lanes; keyboard pause still toggles
- [x] 3.2 Pause overlay gains RESTART and MENU actions (DOM-order focusable, ≥44 px targets); restart calls the existing run-start path; quit returns to menu with refreshed stats and banks nothing — verify: probe restarts from pause (score/coins reset to zero, `games` tally unchanged), then quits from pause (menu shown, `games`/`totalCoins` unchanged from pause point)
- [x] 3.3 Safe resume grace: `setPaused(false)` during PLAYING starts a 1.2 s real-time countdown overlay (scaleX ring + numeral); sim does not step until it elapses; resume-affirming input skips it; `visibilitychange` return uses the same path; QA autostart/?freeze never enters it — verify: probe pauses, resumes, asserts sim distance frozen for ~0.6 s then advancing after ~1.3 s; a second resume with skip input advances immediately; distance delta across grace is exactly 0
- [x] 3.4 Screen-transition polish: `.screen-enter` transform/opacity fade on menu/pause/results show/hide, instant under `.qa-freeze` — verify: `?freeze` captures of each screen are byte-identical across two runs (existing `shot.mjs` compare), and smoke asserts `.screen-enter` exists and is animation-based

## 4. Powerup chips (run-hud)

- [x] 4.1 Three pre-created HUD chips (magnet/x2 with drain bar + `data-low` pulse; jetpack intentionally chip-less) reading `run.powerups` in the existing `updateHud()` path; collect feedback pops the chip on the existing `powerup` event; chips hidden at timer expiry and on run reset — verify: probe collects magnet (chip appears within 1 s, bar shrinks between two samples, disappears after simulated expiry) and x2 (chip + doubled multiplier visible); jetpack collect shows flash only, no persistent chip
- [x] 4.2 HUD accuracy on restart: after game-over → retry, score/coins/multiplier caches re-sync to zero and no stale combo/powerup chips render — verify: probe ends a run with nonzero values, restarts, asserts HUD text reads 0/0 and chips hidden on the first rendered frame

## 5. Results screen context (game-flow)

- [x] 5.1 Add run duration to results stat rows (from the existing `runStartedAt` delta, mm:ss format); losing runs show "N from your best" using the pre-update high — verify: probe ends a run below best and asserts the gap line shows `high - score` formatted; duration row matches the probe's measured run seconds (±1)
- [x] 5.2 New-best celebration: full-width banner upgrade of the existing badge plus a short CSS-only burst (animation-only, killed by `.qa-freeze` and reduced-motion) — verify: probe with score above best asserts banner visible; `?freeze` capture byte-identical; reduced-motion probe asserts no running animation on the banner

## 6. Audio settings (game-flow)

- [x] 6.1 `AudioManager.setMusicOn/setSfxOn` gating scheduler and `play()` (music off = scheduler idles, sfx off = `play()` early-return), LS keys `late_again_music`/`late_again_sfx`, missing key = on; master mute unchanged — verify: probe toggles each off, asserts no scheduled music nodes / no sfx playback calls while the other bus still fires, reload-with-persisted-keys asserts boot state
- [x] 6.2 Menu settings row: replace the single SOUND button with MUSIC and SFX toggle rows (≥44 px targets, aria-pressed synced through the extended `applyMuteUi`); HUD mute still mutes everything — verify: smoke asserts two toggle IDs + labels present; probe flips each and asserts aria-pressed + label state; M key still global-mutes with both toggles on

## 7. First-run teaching + how-to-play (onboarding)

- [x] 7.1 `late_again_tutored` LS flag (missing = taught); on a flagged-false first run, three one-shot scheme-worded toast hints in the first ~200 m: lane-switch at ~30 m, jump/roll when the matching hazard first closes within ~35 m via a new read-only obstacle query — verify: probe with fresh storage asserts all three hints fire once during run one and zero fire in run two; pre-existing save without the key gets zero hints; sim distance/score deltas identical with hints on vs off
- [x] 7.2 Toast UI: `#hint-toast` chip (scheme wording, auto-dismiss ~2.5 s, animation-only enter/exit, `data-input-exclude` not needed — non-interactive) — verify: probe asserts single toast at a time, auto-dismiss timing, and `.qa-freeze` renders it settled
- [x] 7.3 How-to-play panel from menu: button opens scheme-worded controls list (plus alternate scheme section), close restores menu unchanged without starting a run — verify: probe opens/closes and asserts menu DOM state (stats, leaderboard visibility) identical before/after and state stays MENU

## 8. Integration verification

- [x] 8.1 Full smoke sweep: run the complete `.qa/` suite (existing wave smokes + new `ui-ux-smoke.mjs`) — 0 failures, including the static contract checks for every new element ID referenced by `main.js` existing in `index.html`
- [x] 8.2 Determinism guard: `?freeze` screenshot pairs (menu, run, paused, results) captured twice per seed are byte-identical, and no capture logs console errors — verify: `shot.mjs`-based compare pass recorded in the task notes
- [x] 8.3 Spec-by-spec acceptance walk: scenario-by-scenario scripted probe across all four deltas (run-hud 4, game-flow 5, onboarding 3, ui-accessibility 5 requirements) with pass/fail recorded per scenario in the final report
