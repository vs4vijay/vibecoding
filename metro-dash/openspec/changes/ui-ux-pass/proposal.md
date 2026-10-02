# Proposal

## Why

Late Again's 3D world already passes visual review (8.5–9.2/10 across six views), but the
DOM shell around it lags behind and leaks UX gaps a fresh player hits within one session:
a touch player cannot pause at all (Esc/P are keyboard-only), the pause overlay is a dead
end (resume or nothing — no restart, no quit to menu), returning to the tab auto-resumes
instantly into whatever obstacle is next, control hints show "SWIPE / ARROWS" mixed copy on
every device, and powerup pickups fire VFX/audio with zero HUD feedback about what is
active or how long it lasts. None of these are rendering problems — they are shell,
flow, and feedback problems that cap how good the game feels regardless of scene quality.

## What Changes

- **Touch-reachable pause** — an on-screen pause control joins the HUD (alongside the mute
  button), so every input scheme can pause; keyboard pause keys stay unchanged.
- **Pause becomes a real menu** — the overlay gains RESTART and MENU actions next to
  RESUME, with confirm-safe placement, so a bad run can be abandoned without killing the tab.
- **Safe resume** — resuming after pause or tab-switch shows a short 3-2-1 countdown (or
  equal grace) before the sim steps again; no more instant death on tab return.
- **Active powerup feedback in the HUD** — collecting magnet / jetpack / x2 surfaces a
  status chip with remaining duration, driven by run-state the sim already knows.
- **Input-scheme-aware hints** — menu, pause, and game-over hint lines show swipe/tap
  wording on coarse-pointer devices and key wording on fine-pointer devices, never mixed.
- **First-run onboarding** — the first ever run gets one-time contextual hints for the core
  verbs (lane switch, jump, roll), persisted so they never repeat; a compact HOW TO PLAY
  review becomes reachable from the menu.
- **Results screen earns its moment** — game over adds run duration, delta-to-best context
  ("2,150 from your best"), and a proper celebration treatment for a new personal best.
- **Settings beyond one toggle** — separate MUSIC and SFX controls (the audio system
  already owns both buses) replace the single SOUND ON/OFF button in the menu.
- **Shell polish pass** — one visual refresh across loading/menu/HUD/pause/results on the
  existing brand (navy + orange/gold, system fonts, inline SVG): tighter type hierarchy,
  coherent spacing/motion tokens, screen-transition fades, and a menu layout that groups
  play / stats / settings / leaderboard into a deliberate hierarchy.
- **Accessibility baseline** — safe-area insets for notched PWA phones, visible keyboard
  focus styles on every control, ≥44×44 px touch targets, `prefers-reduced-motion`
  extended from the current six selectors to all transitions/animations, and correct
  aria-pressed state on every toggle.

Out of scope (future changes): achievements UI (backend endpoints exist but surfacing them
is a feature, not a UX fix), any 3D world/renderer/character visual work, new game
mechanics, backend API changes, rebranding or external fonts/assets.

## Capabilities

### New Capabilities

- `run-hud`: The in-run HUD must surface state the player can act on — a touch-reachable
  pause control, active powerup status with remaining duration, and score/coin counters
  that stay accurate — without blocking gameplay input.
- `game-flow`: Every screen transition and interruption path must be safe and complete:
  pause reachable from all schemes, restart/quit reachable from pause, resume always
  grace-protected, results carrying full run context, and settings split across audio buses.
- `onboarding`: The game must teach its core verbs on the player's first run and render
  every static control hint in the player's actual input scheme; a how-to-play review is
  reachable from the menu.
- `ui-accessibility`: The shell must be usable on notched phones, keyboards, and
  reduced-motion preferences — safe-area insets, focus visibility, touch-target floors,
  and global reduced-motion coverage.

### Modified Capabilities

(none — `openspec/specs/` is empty; no capability exists yet to modify)

## Impact

- **Code** (all under `subway-surfers/client/`): `index.html` (new HUD pause button,
  powerup chip, pause menu buttons, settings row, how-to-play panel, results additions),
  `css/style.css` (token refresh, new components, safe-area/focus/reduced-motion baseline),
  `js/src/main.js` (pause/restart/quit wiring, resume countdown, scheme detection +
  hint swapping, powerup HUD updates, music/SFX settings, results delta/duration),
  `js/src/core/input.js` (scheme detection helper or coarse-pointer hook), `js/src/core/audio.js`
  (expose separate music/sfx mute setters if not already public), `js/src/game/run.js`
  (expose active powerup + remaining duration in `getStats()` or an event payload).
- **Contracts kept**: fixed-timestep 60 Hz sim and deterministic QA captures
  (`?freeze` / `.qa-freeze` kill-switch must disable all new animation); localStorage
  persistence keys additive only; service-worker relay contract untouched; zero external
  assets (system fonts + inline SVG only); no per-frame allocation in hot loops (HUD
  writes stay cached-DOM, transform/opacity-only).
- **Verification**: `.qa/` smoke tests extended — static contract checks (element IDs,
  `.qa-freeze`, no external assets) plus new probe assertions for pause/resume/restart
  flows, scheme-aware hint copy, powerup chip behavior, and reduced-motion/safe-area/focus
  CSS presence; `?freeze` screenshot determinism must hold on every screen.
