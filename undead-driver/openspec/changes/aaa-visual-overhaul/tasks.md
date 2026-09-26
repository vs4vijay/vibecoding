# Tasks

Workstream rules (from design.md D9): after Group 1, groups 2–7 are **parallel sub-agent workstreams** — each gets its own implementer sub-agent and its own independent harsh-critic sub-agent. A workstream is done only when its critic records a passing blind side-by-side verdict (parity or better per rubric axis) in `evidence/aaa-visual-overhaul/`; a rejection reopens that workstream's tasks with the critic's deficiencies addressed. File ownership per group (listed in each header) prevents parallel edit conflicts; shared files (`src/config.ts`, `src/render/scene.ts`) are shaped in Group 1 and afterwards changed only via agreed additions.

## 1. Foundation — pipeline, textures, harness (owns: scene.ts, new textures.ts, new postfx.ts, new quality.ts, main.ts, config.ts)

- [x] 1.1 Add config sections `look`, `textures`, `quality`, `vfx`, `actors`, `ui` with all new tunables and defaults; verify `bun run typecheck` passes and no magic numbers appear in new render code
- [x] 1.2 Implement `src/render/textures.ts`: value-noise/fBm + Sobel height→normal as pure node-testable functions over Float32Array, plus canvas-backed `CanvasTexture` cache; verify unit tests pin noise determinism (same seed → same buffer) and cache reuse, and pure functions run in `rtk vitest run` (node env)
- [x] 1.3 Generate the dusk environment map via PMREM from a small procedural sky scene at boot; verify boot texture-generation time is within `CONFIG.textures.genBudgetMs` (log via dev hook)
- [x] 1.4 Enable ACES filmic tonemapping + sRGB output + `renderer.shadowMap` (PCFSoft) in `scene.ts`; render through `EffectComposer` (`RenderPass` → bloom → single combined vignette/grain/CA `ShaderPass` → `OutputPass`) in `src/render/postfx.ts` with `CONFIG.quality.postFx` bypass back to direct `renderer.render`; verify the rAF tail still self-schedules (game animates >3 s after PLAY per AGENTS.md gotcha) and `window.__zh.rendererInfo()` reports the composer path
- [x] 1.5 Implement pure `stepQuality` controller in `src/render/quality.ts` (EMA fps, hysteresis, degradation order resolution → post → particles → shadows) and wire its outputs (pixel ratio, pass toggles, density multipliers, shadow map size); verify unit tests cover step-down, step-up, cooldown-no-oscillation
- [x] 1.6 Build dependency-free CDP capture harness `tools/capture.mjs` (raw WebSocket + headless Chromium, pinned scenarios: `car-side-profile`, `combat-mid`, `horde-max`, `lamp-pool`, `title`, `game-over`); verify it produces PNGs in `evidence/` from `bun run dev` and that running it from a background pane is rejected by design (dedicated browser only)
- [x] 1.7 Extend `window.__zh.rendererInfo()` with per-system draw-call counts and fps EMA readout; verify probe output shape in a smoke capture
- [x] 1.8 Full regression gate: `rtk vitest run` + `bun run typecheck` green, pixel-compare captures vs pre-change baseline stored in `evidence/aaa-visual-overhaul/baseline/`

## 2. Lighting workstream (owns: lighting subset of scene.ts, carMesh headlight section, world lamp section) — spec: specs/render/lighting/spec.md

- [ ] 2.1 Shadowed sun: tight ortho frustum following the car, texel-snapped, instanced casters enabled; verify car-silhouette shadow visible in `combat-mid` capture and no edge popping across a long run capture
- [ ] 2.2 Headlight illumination + visible beam cones and lamp light pools (geometry/emissive fakes per D4); verify `lamp-pool` capture shows pool + beam, and road-in-cone brightness > road-out-of-cone at equal distance (pixel probe)
- [ ] 2.3 Level-progression mood shift (sun elevation/hue, fog color/density) driven by `CONFIG.look`; verify early-vs-late captures differ measurably and `render/readability` contrast scenarios still pass (existing probe script)
- [ ] 2.4 Workstream critic loop: blind side-by-side vs curated AAA dusk-lighting reference (rubric: lighting, materials, composition); loop until recorded pass in `evidence/aaa-visual-overhaul/lighting/verdict.json`

## 3. Materials workstream (owns: textures.ts surface generators, world.ts segment materials, carMesh/zombieMesh material bindings) — spec: specs/render/materials/spec.md

- [ ] 3.1 Asphalt PBR set (albedo/normal/roughness + lane wear), sand/dirt, rusted/burnt metal, zombie skin variants, car paint detail maps; verify boot budget holds and no external texture fetches (instrumented boot capture)
- [ ] 3.2 Migrate world/car/zombie/obstacle materials Lambert → MeshStandard(+Physical car paint/glass per D3) with damage-uniform roughness overlay; verify close-up variance, sheen variance, and adjacent-segment variation probes from the spec pass on captures
- [ ] 3.3 Re-tune all colors/lights under the new pipeline; record superseded `.plan.md` visual-spec values in `evidence/aaa-visual-overhaul/materials/retune.md`; verify `render/readability` scenarios still pass
- [ ] 3.4 Workstream critic loop: blind side-by-side vs AAA surface/material references (road close-up, car paint); loop until `materials/verdict.json` records a pass

## 4. World workstream (owns: world.ts, new props.ts, scene sky/skyline sections) — spec: specs/render/world/spec.md

- [ ] 4.1 Shader sky dome (sun disc, glow, haze bands) + 3-layer parallax skyline with lit windows; verify sun-disc/glow pixel probe and differential-parallax probe between two-position captures
- [ ] 4.2 Prop prototypes + per-type instanced pools with per-segment seeded slots (burnt wrecks, debris, fences, dead vegetation, street furniture); verify ≥pinned distinct prop types in any 200 m window and zero steady-state allocation across 60 recycles (heap probe)
- [ ] 4.3 Instanced ground-decal pool (oil, skids, cracks) with ring cursor, recycled with segments; verify decal presence in corridor and no orphans outside the recycle window
- [ ] 4.4 Atmospheric fog/haze retune; verify near/mid/far contrast curve matches the pinned profile on captures
- [ ] 4.5 Keep recycle/teleport test battery green unchanged: `rtk vitest run tests/worldStream.test.ts` passes with dressed segments; heap probe shows no growth
- [ ] 4.6 Workstream critic loop: blind side-by-side vs AAA post-apocalyptic highway references; loop until `world/verdict.json` records a pass

## 5. Characters workstream (owns: zombieMesh.ts, carMesh.ts body/wheels, new debris.ts) — spec: specs/render/characters/spec.md

- [ ] 5.1 Rebuild car composition (tapered hull, cabin glass, wells, bumpers, exhausts, lights) with physical paint + reflective glass; verify silhouette critic parity on `car-side-profile` capture and glass-distinct-from-paint probe
- [ ] 5.2 Wheel steering/spin + suspension response from existing tilt/weight state; verify transform probes: front-wheel yaw tracks input, body roll on hit settles within pinned window
- [ ] 5.3 Progressive car damage (material states, detachable trim, critical-health smoke) with thresholds in `CONFIG.actors`; verify detachment and smoke probes fire at pinned thresholds
- [ ] 5.4 Zombie articulation: 6 instanced parts, per-type procedural cycles (walker/runner/brute), cling flush + car roll; verify limb-phase transform probes and cling-side roll-direction probe
- [ ] 5.5 Gore: pooled blood particles hookup + overkill dismemberment via instanced debris with fake ballistics; verify overkill probe shows ≥pinned separated parts and no allocation growth; intensity default set in config
- [ ] 5.6 Character draw discipline: character path ≤12 calls at max horde via renderer-info probe; verify in `horde-max` capture metadata
- [ ] 5.7 Workstream critic loop: blind side-by-side vs AAA character/horde references (car beauty shot, horde mid-combat); loop until `characters/verdict.json` records a pass

## 6. VFX workstream (owns: fx.ts → new particles.ts, decal integration, cameraRig.ts feel, muzzle light) — spec: specs/render/vfx/spec.md

- [ ] 6.1 Pooled particle systems (blood, sparks, smoke, dust, muzzle) with per-event tunables and instanced rendering; verify kill blood-burst probe, 30 s combat heap-stability probe, particle path ≤8 draw calls
- [ ] 6.2 Blood/skid decals wired to kills/scrapes through the world decal pool (§4.3); verify decal-at-kill probe and pool bound respected
- [ ] 6.3 Camera feel: damage shake, scrape rumble, shot recoil with tunable envelopes decaying to zero; verify shake envelope probe (pulse + decay, no cross-event persistence)
- [ ] 6.4 Muzzle point light + emissive flash; verify scene-brightens-on-shot probe (returns to baseline within pinned duration)
- [ ] 6.5 Post stack tuning (bloom thresholds, grain/CA subtlety) + clean bypass; verify bloom-bleed probe vs bypassed capture and error-free bypass run
- [ ] 6.6 Workstream critic loop: blind side-by-side vs AAA combat-VFX references; loop until `vfx/verdict.json` records a pass

## 7. UI workstream (owns: ui/*.ts, style.css, index.html, menus attract camera) — spec: specs/ui/hud/spec.md

- [ ] 7.1 Design tokens + type system in style.css (palette, elevation, scale, system-font treatment, generated logo treatment, inline SVG icons); verify zero asset requests at boot
- [ ] 7.2 Attract-camera title screen (live world drift behind menu, animated logo/entrances); verify `title` capture shows animating world behind chrome
- [ ] 7.3 HUD redesign (icons, animated meters, hit markers, directional damage indicators, streak flare) preserving readability-pass semantics; verify hit-marker, left-bias, no-layout-thrash probes and existing HUD/subtitle tests stay green (`rtk vitest run tests/`)
- [ ] 7.4 Cinematic game-over sequence (staggered reveals, best flourish) + `prefers-reduced-motion` support; verify stagger-order probe and reduced-motion probe (animations suppressed, state legible)
- [ ] 7.5 Workstream critic loop: blind side-by-side vs AAA front-end/UI references; loop until `ui/verdict.json` records a pass

## 8. Quality gate — acceptance sweep (owns: evidence/, config budget pins, README/.plan.md notes)

- [ ] 8.1 Performance trace: 30 s in-combat CDP trace at defaults; verify fps ≥55 sustained, frame spikes bounded, `quality/` tier changes logged not oscillating
- [ ] 8.2 Budget probe at max density: renderer-info per-system counts; verify world ≤90, characters ≤12, particles ≤8, post ≤6, total ≤260 target / ≤300 hard; boot texture VRAM ≤ pinned cap
- [ ] 8.3 Heap/allocation sweep: repeated run/restart cycles with combat; verify growth within tolerance (pooling invariant intact)
- [ ] 8.4 rAF-tail + style-import gotcha checks after restructure: game animates >3 s after PLAY, stylesheet present, UI roots un-nested (`#hud` vs body roots); verify via live DOM probes in a capture session
- [ ] 8.5 Evidence sweep: every workstream verdict.json exists with rubric scores + blind winner; failures reopened until all pass; contact sheets committed, full-res captures gitignored
- [ ] 8.6 Final gate: `rtk vitest run` + `bun run typecheck` + `bun run build` all green; update `.plan.md` implementation history with the overhaul entry and superseded visual-spec note
