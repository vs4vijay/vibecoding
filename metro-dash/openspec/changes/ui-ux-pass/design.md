# Design

## Context

The shell is one `main.js` state machine (LOADING → MENU → PLAYING → GAMEOVER plus a
`paused` flag) over a fixed-timestep sim, with a DOM overlay (`index.html` +
`style.css`, ~1,200 lines) styled by a token block (`--navy-*`, `--orange-*`, `--gold-*`,
glass chips). Constraints that shape every decision below:

- **Determinism**: `?freeze` + `.qa-freeze` must keep every captured frame identical; all
  new animation needs a kill-switch path and all new HUD writes must stay cached-DOM,
  transform/opacity-only (the existing `updateHud()` per-frame path already works this way).
- **Zero external assets**: system fonts + inline SVG only; no webfonts, no icon files.
- **Silent degradation**: the page never calls `/api/*` (service-worker relay only);
  localStorage is the source of truth.
- **Sim untouched in spirit**: gameplay feedback (combo streak) is already a UI-level
  layer reading sim state without mutating it — this change extends that pattern.

Current-code facts this design relies on:

- `InputManager` (core/input.js) listens on `window` with passive touch handlers; taps are
  disambiguated top-half jump / bottom-half roll — so a tap on any HUD button currently
  also fires a gameplay action.
- Pause is keyboard-only (`Escape`/`KeyP` → `"pause"` action) plus
  `visibilitychange` auto-pause; the pause overlay has exactly one button (RESUME), and
  `visibilitychange` **auto-resumes instantly** on return.
- `run.powerups = { magnet, jetpack, x2 }` holds remaining seconds, decremented each fixed
  step (run.js:335), and `collectPowerup(type, 10)` is fed by pickups. **Jetpack is a
  data-only stub**: its timer drains but nothing in the sim reads it (only magnet and x2
  have real effects).
- `AudioManager` already mixes through separate `musicBus` / `sfxBus` gains behind one
  master mute; there is no per-bus on/off.
- `showGameOver()` already computes run duration (`performance.now() - runStartedAt`) and
  the high score before persisting.
- `style.css` has `env(safe-area-inset-*)` nowhere; focus styling exists only for the
  username input; the `prefers-reduced-motion` block covers six named animations only.
- The `.qa/` harness pattern (wave6-smoke.mjs) is: bun-run static contract checks + logic
  probes in a sandbox, no browser; screenshots go through `?freeze` capture (`shot.mjs`).

## Goals / Non-Goals

**Goals:**

- Every UI surface becomes complete and honest: pause/restart/quit reachable from every
  scheme, resume always grace-protected, HUD shows only effects that exist.
- One visual refresh pass layered on the existing token system — no rebrand, no asset
  pipeline, no new dependencies.
- Accessibility baseline (safe-area, focus-visible, 44 px targets, global reduced-motion)
  applied once at the token/layout level rather than per-component patches.
- All additions keep `?freeze` captures deterministic and the `.qa-freeze` switch total.

**Non-Goals:**

- Any 3D-side visual work (world, character, camera, post pipeline).
- Implementing the jetpack effect (gameplay feature — separate change; the HUD must not
  pretend it exists).
- Achievements UI, backend/API changes, new persistence schema beyond additive flags.
- Gamepad support (never claimed by this game; not in this pass).

## Decisions

**D1 — Input-scheme detection is a latched coarse-pointer check in a new tiny module.**
`core/scheme.js` exports `detectScheme()` (boot: `matchMedia('(pointer: coarse)')` →
`"touch"` | `"keys"`) and `latchTouch()` (first real `touchstart` re-latches to `"touch"`
for the session — coarse-pointer desktops with mice self-correct on first touch). main.js
renders hint strings through one `applyHints()` helper that fills the menu/pause/results
hint elements from a two-wording map. Alternative considered: media-query-driven CSS text
swap (`content:` tricks) — rejected, hints are multi-element structured copy and JS is
already the shell's owner. `data-scheme="touch|keys"` on `<html>` also lets CSS hide/show
scheme-specific glyph pairs without re-render.

**D2 — HUD pause button + gesture exclusion via a `data-input-exclude` marker.**
A 44×44 px icon button sits bottom-left (mute stays bottom-right; symmetric corners read
as "system controls"). InputManager's `_onTouchStart` ignores gestures whose target is
inside an element with `data-input-exclude` (`e.target.closest('[data-input-exclude]')`),
which also fixes the existing latent bug where tapping the mute button triggers jump/roll.
The button fires on `pointerdown` (feels instant; `click` adds a 300 ms gamble on some
mobile stacks). Alternative considered: `stopPropagation()` in the button's own listener —
rejected, it depends on pointer/touch event ordering subtleties; the explicit target check
is order-independent and testable statically.

**D3 — Pause overlay becomes a three-action panel; quit/restart never double-banks.**
RESUME / RESTART / MENU buttons (44 px targets, keyboard-focusable in DOM order). Restart
calls the existing `startRun()`; MENU calls `showMenu()`. Today `endRun()`-side banking
happens only on death — quitting mid-run banks nothing today, which is already correct:
we keep that property explicitly (a run abandoned from pause awards its collected coins
only through the normal death path, i.e. not at all — documented in the panel with a small
"run abandoned" note is *not* needed; silence matches arcade convention).

**D4 — Safe resume is a real-time countdown in main.js, not a new sim state.**
`setPaused(false)` while PLAYING starts `graceT = 1.2 s` instead of resuming; the frame
loop skips sim stepping while `graceT > 0` (same branch that already skips when
`paused`), a minimal `#resume-grace` overlay shows a numeral + shrinking ring driven by
`transform: scaleX` (no layout), and any resume-affirming input (tap on the overlay,
resume key, pause key) skips to 0. `visibilitychange` return routes through the same path
(it currently calls `setPaused(false)` directly — the change is inside `setPaused`).
Distance/time cannot drift because the sim simply doesn't step; `?freeze` never enters the
paused path (QA autostart keeps `paused = false`). Alternative considered: 1 s
invulnerability after resume — rejected, it changes game rules to fix a UI problem.

**D5 — Powerup chips read `run.powerups` directly; jetpack gets no chip.**
`updateHud()` (per-frame, cached-DOM) reads the live `run.powerups` object — zero
allocation, no new event plumbing. Three pre-created chips; visible while their timer
> 0; drain shown by `scaleX(t / DURATION)` on a bar child with a `data-low` flip in the
last 25% (pulse via CSS, killed by `.qa-freeze`). Collect feedback reuses the existing
`powerup` event → `popBadge()` on the chip. **Jetpack shows a collect flash only** — its
timer is a stub with no sim effect, so a persistent chip would promise something the game
doesn't do (the exact dishonesty this pass exists to remove). Spec text ("while an effect
is active") is satisfied: no effect → no active period → no chip. When the jetpack effect
lands in a future change, its chip is one entry in the map.

**D6 — Music/SFX toggles ride the existing bus gains.**
`AudioManager` gains `setMusicOn(bool)` / `setSfxOn(bool)` persisted to new LS keys
`late_again_music` / `late_again_sfx` (default on; missing key = on). Music off idles the
scheduler (existing mute path already does this — reuse the same gate with `musicOn &&
!muted`); SFX off early-returns `play()`. Master mute (M key + HUD button) is unchanged on
top. Menu's single SOUND ON/OFF button becomes two toggle rows; `applyMuteUi()` extends to
keep three aria-pressed states in sync.

**D7 — Results gains duration + best-gap; celebration is CSS-only.**
`showGameOver()` already has duration and the pre-update high: display duration in the
stat rows; when losing, show "N from your best" (formatted `toLocaleString`); when it's a
new best, upgrade the existing badge into a full-width celebratory banner (existing gold
treatment + a short CSS particle-ish burst using a few absolutely-positioned spans,
animation-only). All of it is instant under `?freeze` (the count-up already is) and under
reduced motion. No backend rank line — the SW relay has no rank message type today and
adding one is scope creep.

**D8 — First-run teaching is distance-triggered toasts + one read-only hazard query.**
New LS flag `late_again_tutored`; **missing key = already taught** so existing players
never get retro-tips (same convention as the neon-rush save migration). On a run where the
flag is `false`, main.js (or a 30-line `game/coach.js`) emits three one-shot scheme-worded
toast hints in the first ~200 m: lane-switch at ~30 m, jump when a jumpable hazard first
closes within ~35 m, roll when an overhead first closes within ~35 m. The hazard check is
a new read-only query on the obstacle store (`nearestJumpable(z, range)` /
`nearestOverhead(z, range)` — it is lane-indexed and pooled already; the query touches
nothing). Flag set on run end by any path. Toasts are DOM chips (`#hint-toast`), no pause,
no sim interaction. Alternative considered: pattern-director-side triggers — rejected,
couples teaching into spawn ownership.

**D9 — Polish pass = tokens first, then per-screen sweeps.**
Add `--dur-1/2`, `--ease-out`, spacing/radius tokens; unify chip/panel radii and paddings
onto them; add a `.screen-enter` fade/slide (transform/opacity only) for menu/pause/
results transitions — disabled by `.qa-freeze` (existing selector already nukes all
animations) and by the extended reduced-motion block. Menu layout groups: hero title →
play card (input + PLAY) → stats row → settings (music/sfx) + how-to-play row →
leaderboard. Typography: display sizes move to `clamp()` so small phones and desktops
both get a deliberate scale. Loading screen gets only token alignment (it's already fine).

**D10 — Accessibility baseline is four mechanical sweeps.**
(a) `viewport-fit=cover` on the viewport meta + `env(safe-area-inset-*)`-aware padding on
`#hud`, the two corner buttons, and menu container. (b) One `:focus-visible` rule with a
2 px accent outline + offset on `button, input, [tabindex]`; no global outline removal
exists today, so nothing to undo. (c) Target audit: pause button is new-44 px; mute stays
44 px; settings rows and results buttons get padded targets ≥ 44 px. (d) Reduced-motion
block becomes global (`* { animation: none !important; transition-duration: ~0 }` inside
the media query) — the six-selector list is deleted. Independent of `.qa-freeze`, which
already wins via `!important` on a class — order the blocks so both apply cleanly.

## Risks / Trade-offs

- [New HUD controls eat gameplay swipes or trigger jump/roll] → `data-input-exclude`
  closest() check in touch handlers covers all current + future buttons; smoke test
  asserts taps on every `[data-input-exclude]` element produce no gameplay action.
- [Grace countdown annoyances on quick retry loops] → skippable by the same input that
  resumes; 1.2 s is below the "noticeable wait" threshold; QA autostart never enters it.
- [Jetpack chip omission reads as a bug to players who saw the collect flash] → the flash
  + sting already say "picked up"; a chip that lies for 10 s is worse; revisit when the
  effect exists.
- [Global reduced-motion rule kills useful state transitions] → transitions become
  instant rather than absent (state changes still render); information never depends on
  motion.
- [Scheme misdetection on hybrid laptops (touchscreen + keyboard)] → latching first-touch
  correction; worst case is one screen of wrong wording, fixed on first touch/keypress.
- [Quit-from-pause abandons coins players feel they earned] → arcade convention, and the
  alternative (banking partial runs from pause) double-counts on the restart path unless
  banking splits into transactions — explicitly out of scope.
- [Viewport `user-scalable=no` + `viewport-fit=cover` on old iOS Safaris] → env() falls
  back to 0 gracefully; padding uses `max()` so the old value remains the floor.

## Migration Plan

Additive only: two audio LS keys + one tutorial LS key; missing keys mean "on" / "already
taught" so existing saves load unchanged with no migration code. HTML changes are new
elements + copy swaps; CSS changes are token-level. Rollback is a plain revert; leftover
LS keys are inert. No backend, no schema, no contract changes.

## Open Questions

None blocking — grace duration starts at 1.2 s and powerup chip duration denominator reads
`collectPowerup`'s 10 s constant through `CONFIG`-adjacent naming; both are single-constant
tunings that touch no spec. If the jetpack effect lands mid-change, its chip is one map
entry and one task line.
