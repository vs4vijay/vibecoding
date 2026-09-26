# Design

## Context

Current state (verified by code survey): renderer runs with antialias only — no tonemapping, no color management, no shadow pass; everything is `MeshLambertMaterial`/`MeshBasicMaterial` on raw primitives; the world is 6 recycled 30 m segments of 6 merged meshes each; zombies are 4 instanced box parts; the car is 2 boxes + cylinders; FX is a round-robin pool of 200 individual quads; the HUD is DOM with CSS gradients. The sim (fixed step, pooling, zero-allocation, pure `game/` logic) is solid and pinned by 20 test files — this change must not disturb it. Motivation and capability split: see proposal.md; behavioral contracts: see the seven spec deltas.

Hard constraints carried from AGENTS.md: deps allowlist (`three` + dev tools only), zero binary assets, all tunables in `src/config.ts`, pooling with zero steady-state allocation, `game/` never imports three.js, draw-call budget (re-pinned by `render/quality-gate`), verification via headless Chromium over CDP because vision models may be unavailable.

## Goals / Non-Goals

**Goals:**

- AAA-grade look: filmic pipeline, PBR materials, shadows, atmosphere, particles, post stack, character fidelity, cinematic UI.
- Enforceable quality bar: blind side-by-side critic loop per workstream, not vibes.
- 60 fps at default settings on the reference dev machine, with graceful degradation below that.
- All invariants preserved; prior tests stay green without weakening assertions.

**Non-Goals:**

- No gameplay/logic changes: combat, difficulty, scoring, spawner, car physics model, controls, storage keys stay as-is.
- No new runtime dependencies; no physics engine — visible physics is animation + VFX.
- No asset pipeline: no font/image/audio files; no GLTF loading; no engine refactor of `game/`.
- No multiplayer, mobile-native wrappers, or save-format changes.

## Decisions

### D1 — Post-processing: `three/examples/jsm` composer (no new dependency)

`EffectComposer` + `RenderPass` + `UnrealBloomPass` + one custom `ShaderPass` (vignette + film grain + chromatic aberration in a single pass) + `OutputPass` for tonemapping/color space. These ship inside the `three` package, so the allowlist holds. Alternative considered: hand-rolled framebuffer pipeline — rejected (weeks of work to reach worse quality); skipping post entirely — rejected (bloom/haze is most of the "AAA read"). A `CONFIG.quality.postFx` switch bypasses the composer back to `renderer.render` so the direct path never rots.

### D2 — Procedural texture factory (`src/render/textures.ts`)

One boot-time module generates and caches every map: value-noise/fBm in plain TS over `Float32Array`, height→normal via Sobel, written into canvases as `CanvasTexture` (512 px default, config-tunable). Surfaces: asphalt (albedo/normal/roughness + lane-wear decals), sand/dirt, rusted/burnt metal, zombie skin variants, car paint detail, debris. Env lighting comes from PMREM-filtering a tiny procedural dusk sky scene at boot — no HDR files. The pure math (noise, Sobel, seeded variation) lives in functions testable in node without canvas; only the canvas write is browser-side. Alternative: `DataTexture` everywhere — rejected (harder to author/debug for equal cost).

### D3 — Material migration: Lambert → `MeshStandardMaterial` (+ `MeshPhysicalMaterial` for car paint/glass)

All look values in `.plan.md`'s "Visual spec (exact)" get re-tuned under the new pipeline; that section is superseded. Car paint = clearcoat physical material driven by a generated detail/damage roughness overlay whose intensity is a damage-uniform; glass = env-reflective dark glass (no `transmission` — too costly for steady state). This is the riskiest visual regression point, so it lands first, alone, with before/after captures.

### D4 — Lighting: one shadowed sun + few real lights, faked everywhere else

`renderer.shadowMap` (PCFSoft) with a single `DirectionalLight` whose ortho frustum is tight and car-following (snapped to shadow-map texels to prevent shimmer). Instanced zombies/props cast shadows (three supports instanced shadow casting). Real dynamic lights stay bounded: sun, hemisphere, 2 car headlight spots (kept), 1 muzzle-flash point light. Streetlamp pools and light beams are geometry/emissive fakes (light-pool decal planes, additive beam cones with generated falloff texture). Alternatives: per-lamp real lights — rejected (light count explosion); SSAO/GI passes — rejected for web perf.

### D5 — Characters: extend the existing instanced-parts pattern instead of switching to skinned meshes

Zombies become 6 instanced parts (torso, head, 2 arms, 2 legs) with per-type procedural cycles (phase-offset limb sinusoids + lean/bob profiles) composed into instance matrices on CPU each frame — the exact pattern `zombieMesh.ts` already uses, scaled up. Skinned `SkinnedMesh` per zombie was rejected: breaks pooling/instancing budgets at horde density. Dismemberment: overkill kills swap affected parts for free rigid debris from a pooled instanced debris set with fake ballistics (gravity, bounce, spin). The car is rebuilt from a composed silhouette (tapered hull via shaped extrusions, cabin, glass, wells, bumpers, exhausts) with visual steering on front wheels, suspension offsets driven by existing tilt/weight state, and detachable trim at damage thresholds.

### D6 — World dressing: per-prop-type instanced pools seeded per segment

Prop prototypes (burnt wreck reusing the car builder, debris piles, fences, dead vegetation via crossed alpha-tested planes with generated foliage texture, street furniture, ruined facade slabs in skyline layers) each get an `InstancedMesh` with fixed slots per segment. Recycling re-seeds a segment's slots from a deterministic hash of its index (stable within a run, varied across runs via run seed). Sky becomes a shader-dome (sun disc, glow, haze bands, starless dusk) with 3 skyline parallax bands at different depths. Ground decals (oil, skids, blood) use one instanced decal pool with a ring-cursor, projected slightly above road, recycled with the window. Segment merge/6-call budget is replaced by the new per-system budgets — the old "6 draw calls per segment" figure is explicitly retired in favor of the `render/quality-gate` ceiling.

### D7 — Adaptive quality controller (pure, unit-tested)

An EMA fps monitor with hysteresis steps quality down in the pinned order — resolution scale → post stack → particle density → shadow map size → shadows off — and back up when headroom returns, with cooldowns to prevent oscillation. The controller is a pure function (`stepQuality(state, fps, dt) → state`) in `src/render/quality.ts`, unit-tested in node; the browser side only applies its outputs (pixel ratio, pass toggles, pool density multipliers, shadow map size).

### D8 — UI: same DOM architecture, AAA design system

Keep the diffed-DOM pattern (preallocated elements, CSS custom props, class-restart animations) — it is already allocation-clean. Add: cohesive design tokens (palette, elevation, type scale — system font stack with strong tracking/weight treatment; a generated canvas/SVG logo treatment, not a font file), iconography as inline SVG, hit markers, directional damage indicators, streak flare escalation, staggered game-over reveal, attract-camera title screen (live world + slow camera drift while menus show), `prefers-reduced-motion` support. HUD semantics from `readability-hud-pass` are preserved element-for-element; only presentation changes.

### D9 — Process: parallel workstreams, each looped against a harsh blind critic

Apply phase runs as: **Stage 0 foundation** (pipeline, textures, config schema, adaptive-quality skeleton, composer path) in one stream — everything depends on it; then **7 parallel workstreams** (one per capability), each run by its own sub-agent. Per workstream loop:

1. Implement to its spec delta.
2. Capture live evidence: dedicated headless Chromium over CDP (never a background pane), screenshots at pinned scenarios from the spec.
3. Independent critic sub-agent — deliberately harsh, distinct from the implementer — runs a **blind side-by-side**: the workstream capture and a curated AAA reference still of comparable subject (dusk-highway/character/UI references gathered during apply into a gitignored `evidence/ref/`), shuffled and labeled A/B, scored per rubric axis (lighting, materials, silhouette, composition, motion, UI craft).
4. Verdict recorded as JSON under `evidence/aaa-visual-overhaul/` (verdicts + downscaled contact sheets committed; full-res captures gitignored). Below-parity verdicts list concrete deficiencies; the loop repeats until the critic passes — "wowed" means parity-or-better on the rubric with an explicit callout of what now beats the reference.

Rationale for reference stills rather than a running AAA build: a live AAA title cannot execute beside a web game; curated stills of comparable subject matter are the honest proxy, and the blind protocol prevents the critic from favoring either side by provenance.

### D10 — Budgets re-pinned and enforced

New ceilings (all in `config.ts`): steady-state draw calls ≤260 target / ≤300 hard (probe via the existing renderer-info hook, extended with per-system counts); character path ≤12 calls at max horde; particle path ≤8; post ≤6; world ≤90; UI is DOM (excluded). Total boot texture VRAM pinned (≤48 MB at defaults). FPS floor 60 target / 55 accepted, measured over 30 s in-combat CDP traces.

## Risks / Trade-offs

- [Standard-material migration shifts every tuned color/light value] → D3 lands first as its own commit with before/after captures; `.plan.md` visual spec explicitly superseded; readability contrast scenarios from `render/readability` re-verified.
- [Perf regression on integrated GPUs from shadows + post + texture fetches] → D7 adaptive quality with the exact degradation order; D10 budgets enforced by probe; instancing everywhere repeated geometry appears.
- [CPU cost of per-frame instance-matrix composition grows with new parts/particles] → reuse scratch objects/`Matrix4` compose pattern already in `zombieMesh.ts`; horde pose update measured in a unit-benchable pure function; density multipliers are the first quality step-down after resolution scale.
- [Shadow acne/peter-panning on instanced horde] → bias/normal-bias tunables in config; texel-snapped frustum; pinned shadow capture scenario in the evidence set.
- [Blind critic unavailable (vision models down) stalls loops] → AGENTS.md already mandates evidence-first verification: pixel-metric probes from the spec scenarios (contrast/variance thresholds) keep gating progress; critic verdicts backfill when vision returns; human review remains the final authority.
- [Three.js examples import churn across versions] → imports pinned by the existing `three` semver in package.json; no floating.
- [Gore/dismemberment intensity reads as gratuitous] → intensity is a config tunable with a restrained default; trivially dialed back without code changes.
- [Scope sprawl across 7 workstreams] → each workstream maps 1:1 to a spec delta with testable scenarios; tasks.md orders them so shared files (`config.ts`, `scene.ts`, `textures.ts`) are touched in Stage 0 and by allocation, not concurrently.

## Migration Plan

Land in order: Stage 0 foundation (pipeline + textures + composer + quality skeleton) → materials/lighting retune → world dressing → characters → vfx → UI → quality-gate hardening (traces, verdict sweep, budget probes). Each stage is a green (tests + typecheck) commit; any stage reverts cleanly with git. No data/storage migration (keys unchanged). Feature risk is front-loaded: if Stage 0 perf numbers miss budget, later stages adapt before being built.

## Open Questions

None blocking. Reference-still curation (exact source images per workstream) is gathered at apply time and does not change specs, approach, or task breakdown; gore intensity default and attract-camera drift speed are tunables to be dialed against critic verdicts.
