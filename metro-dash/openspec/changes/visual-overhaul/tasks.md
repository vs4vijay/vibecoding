# Tasks

Verification for every tier: serve the client (`bun run build:client` + `bun run dev`), then
drive the game in a browser (Playwright) and check the stated observable. Draw-call reads use
`renderer.info.render.calls` exposed on `window.__renderStats` (set up in 1.2).

## 1. Baseline & scaffolding

- [x] 1.1 Capture pre-overhaul baseline: run the current game in a browser, record FPS and
      `renderer.info.render.calls` for the menu state and a ~60s gameplay run; write the
      numbers into `openspec/changes/visual-overhaul/baseline.md`. Verify: file exists with
      both states' draw-call counts and FPS.
- [x] 1.2 Create `client/js/visual/` with empty module skeletons (`textures.js`, `props.js`,
      `character.js`, `atmosphere.js`, `ui-motion.js`) and expose `window.__renderStats` =
      `{ calls, fps }` updated per frame in game.js. Verify: page loads without console
      errors; `window.__renderStats.calls` is a number in the browser console.

## 2. Materials & lighting (Tier A)

- [x] 2.1 Swap all world materials to `MeshStandardMaterial` with tuned roughness/metalness
      (ground matte, rails/train metallic, coins polished); keep ACES tone mapping, retune
      exposure to ~1.0. Verify: screenshot shows lit/shaded faces on buildings and highlight
      on rails/coins; game still playable end-to-end.
- [x] 2.2 Add procedural `RoomEnvironment` IBL via PMREMGenerator; set warm key light + cool
      fill/hemisphere rig. Verify: screenshot shows specular response on the train body and
      coin faces; no washed-out surfaces.
- [x] 2.3 Replace the 8-hue building palette with 4 curated type families (geometry + material
      per family, scaled per instance) in `visual/props.js`. Verify: screenshot shows a
      coherent palette (no carnival hues); draw calls lower than baseline for an equivalent
      scene state (fewer building meshes than before).

## 3. Track bed (Tier B)

- [x] 3.1 Add procedural ballast + sleeper `CanvasTexture` in `visual/textures.js`; apply to
      the ground strip with RepeatWrapping; upgrade rails to profiled metallic boxes. Verify:
      screenshot at gameplay camera shows repeating sleepers under rails and gravel texture
      between lanes with no visible seams over 200m of travel.

## 4. Props (Tier C)

- [x] 4.1 Build the subway-car train factory in `visual/props.js` (rounded body, window band,
      doors, bogies; 2–3 liveries, cloned per spawn) and use it for the train obstacle.
      Verify: screenshot of an approaching train shows windows/doors/wheels; collision
      behavior unchanged (jump/roll/dodge still resolve as before).
- [x] 4.2 Rebuild barrier (striped hazard CanvasTexture) and overhead (truss gantry) props.
      Verify: screenshot shows hazard stripes on barriers and gantry silhouette on overheads;
      roll-under and jump-over still work.
- [x] 4.3 Read `window.__renderStats.calls` in a mid-run state and compare against baseline.
      Verify: calls ≤ 1.5× baseline; if exceeded, apply the documented fallback (InstancedMesh
      for coins) and re-measure until within budget.

## 5. Character (Tier D)

- [x] 5.1 Rig limbs as pivot groups in `visual/character.js`; implement run cycle (sin swing
      phased by distance), jump tuck, roll tumble, and lane-change lean with ~100ms pose
      lerps. Verify: screen-record or frame captures show swinging limbs while running,
      tucked airborne pose, compact rotating roll, visible bank on lane change; hitbox-driven
      collisions unchanged.
- [x] 5.2 Add landing dust puff (pooled fading sprites) on jump landings. Verify: visible
      puff on landing in browser; sprite pool size stable (no unbounded scene growth —
      `scene.children.length` returns to steady state).

## 6. Atmosphere & camera (Tier E)

- [x] 6.1 Implement distance-driven day → sunset → night ramp in `visual/atmosphere.js`
      (sky/fog colors, key light color/intensity, facade emissive at night); deterministic
      function of distance. Verify: screenshots at ~0m, ~1.5km, ~3km show three distinct
      sky states; night shows lit windows; replaying to the same distance reproduces the
      same sky.
- [x] 6.2 Add billboard clouds (pooled, recycled ahead of camera). Verify: clouds visible and
      recycled with no pop-in; draw-call delta small (≤ ~8).
- [x] 6.3 Speed-reactive FOV (65 → ~75 lerp with speed) and landing camera kick. Verify:
      `camera.fov` at max speed measurably larger than at start; brief dip on landing that
      recovers within ~300ms.

## 7. UI overlay (Tier F)

- [x] 7.1 Bundle an OFL display woff2 in `client/fonts/` (subset, `font-display: swap`,
      fallback stack kept); apply to titles + HUD numerals; add to service-worker cache
      list. Verify: computed `font-family` on the title resolves to the bundled face; font
      file served same-origin; SW cache includes it.
- [x] 7.2 Replace emoji coin/count icons with inline SVG in index.html (menu, HUD, game
      over). Verify: no emoji glyphs remain in score/coin indicators (DOM check); SVG renders.
- [x] 7.3 Implement `visual/ui-motion.js`: score count-up tween (~300ms), combo punch-scale on
      increment, red damage flash on crash, fade transitions (≤ 400ms) replacing instant
      `.hidden` toggles between menu/playing/game-over, plus the play vignette overlay.
      Verify: coin pickup animates the score; combo pulses; crash shows red flash before
      game-over fades in; screens fade not snap; vignette visible during play.

## 8. Spec verification

- [x] 8.1 Walk both spec deltas scenario-by-scenario in the browser (desktop) and record
      results in the change folder. Verify: every scenario in `specs/render-visual-quality` and
      `specs/hud-ui-presentation` has a pass note or a filed follow-up.
- [x] 8.2 Performance check: 60s desktop gameplay run sustaining ~60 FPS; mid-run draw calls
      within budget; PWA offline load renders the display font. Verify: measured numbers
      appended to `baseline.md` meeting the spec's budget; offline font check passes.
