# Proposal: Visual Overhaul

## Why

The game's 3D render reads as shabby and the DOM overlay as generic: every surface is a flat
`MeshLambertMaterial` solid color with no textures, buildings cycle eight saturated hues with
randomly scattered window boxes, props (trains, barriers) are bare primitives, the player
character glides with a sine-bounce instead of animating, and the HUD/menu use system fonts and
emoji icons with no transitions or feedback motion. The game is mechanically playable, so visual
quality is now the largest gap between it and a shippable endless runner.

## What Changes

- **Materials & lighting**: replace all `MeshLambertMaterial` with `MeshStandardMaterial` plus a
  `RoomEnvironment` environment map (IBL); warm-sun/cool-ambient light rig; curated building
  palette instead of 8 random saturated hues.
- **Track bed**: procedural `CanvasTexture` ballast with sleepers so the world reads as a subway
  track; proper rail geometry.
- **Props**: detailed subway-car trains (rounded body, window band, doors, bogies), striped hazard
  barriers, signal-gantry overheads; `InstancedMesh`/shared geometry for buildings, windows, and
  coins to cut draw calls.
- **Character**: procedural run cycle (swinging limbs), lean into lane changes, jump tuck, roll
  tumble, landing dust puff.
- **Atmosphere**: sky/fog color drifts day → sunset → night with distance (windows glow at night),
  billboard clouds, DOM vignette overlay.
- **Camera**: speed-reactive FOV (widens as speed ramps 15→40) and a small landing kick.
- **DOM UI**: display font for titles/HUD numerals, SVG coin icon replacing the emoji, fade
  transitions between menu/playing/game-over screens, score count-up tween, combo punch-scale,
  red damage flash on crash.

Non-goals (separate changes): gameplay mechanics (real magnet/jetpack behavior, combo/multiplier
rework, `obstaclesDodged` fix), audio, pause, leaderboard/achievements UI, leaderboard/achievements
backend work.

## Capabilities

### New Capabilities

- `render-visual-quality`: the 3D scene's presentation standards — PBR materials and lighting,
  track-bed and prop visual detail, character animation states, day/night atmosphere progression,
  and the performance budget that guards them on mobile.
- `hud-ui-presentation`: the DOM overlay's presentation standards — typography and icon rules,
  screen-transition behavior, and numeric/feedback motion for score, combo, and damage.

### Modified Capabilities

(none — OpenSpec has no existing specs; this project's first spec'd capabilities are the two above)

## Impact

- **Code**: `client/js/game.js` is the single file containing the entire render pipeline; changes
  concentrate there (or in new client modules it imports). `client/index.html` and
  `client/css/style.css` for the DOM UI work.
- **No backend changes**: `src/` (Elysia API, db, worker) is untouched.
- **No new dependencies**: three.js 0.172 addons (`RoomEnvironment`, `RoundedBoxGeometry`,
  `EffectComposer` family if needed) are already resolvable via the existing importmap; fonts are
  bundled as local assets, not CDN links.
- **Performance risk (guarded)**: PWA runs on mobile; instancing, shared textures/geometries, and
  pixel-ratio cap (already at 2) are the levers. Real bloom passes are explicitly avoided —
  emissive materials + ACES tone mapping fake the glow at zero cost.
