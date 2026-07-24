# Continuity Error

## Vertical Slice Development Plan

**Status:** Phases 0–4 complete; Phase 5 release-candidate tooling complete; external playtest rounds pending  
**Target:** Polished 30–45 minute public demo  
**Development model:** Solo developer with AI assistance  
**Schedule:** 20 weeks of planned production plus 4 weeks of contingency  
**Initial release:** Web only  
**Deferred platforms:** macOS, Windows, and native Android, considered only after the Web vertical slice ships  

---

## Development Guidelines

- Make use of godot ai mcp server
- build for web first (chromium for now), but keep in mind that macos, windows and android would come later.

---

## 1. Product Vision

Continuity Error is an original 3D isometric cyberpunk stealth-puzzle game inspired by themes of identity, artificial consciousness, memory ownership, and corporate power. It does not use the characters, setting, terminology, or plot of *Neuromancer*.

The player is Nera Voss, a disgraced intrusion specialist contacted by a digital copy of Asha Rhyne, her dead former lover and heist partner. Asha claims she is being held inside a corporate memory hospice that preserves, edits, and monetizes the minds of the dead.

The player prepares in a compact physical-world hub, enters an abstract corporate network, rewrites its live topology to evade security, and extracts Asha. The slice ends with a choice between granting the copy network autonomy and containing her until her identity can be verified.

### Core player fantasy

Plan and execute an impossible digital heist where the network is a physical place that can be rewired while the player is inside it.

### Design pillars

1. **The network is the level**
   - Connections determine paths, patrol routes, permissions, and signal flow.
   - Rewiring the graph changes the playable space in real time.

2. **Failure changes the story**
   - Detection does not reload a checkpoint automatically.
   - Traces corrupt collected memories, increase pressure, and alter available knowledge.

3. **Preparation creates different opportunities**
   - Trusting different contacts changes the route through the same heist.
   - Choices modify mechanics and information, not just dialogue.

4. **Personhood remains uncertain**
   - The game never provides a definitive test proving whether Asha is the original person.
   - The player must act despite incomplete and potentially manipulated evidence.

5. **Small spaces, dense meaning**
   - The slice contains one compact hub and one authored heist.
   - Environmental detail and reactive dialogue take priority over world size.

6. **True 3D with isometric readability**
   - The hub, network, characters, traversal, collisions, and security exist in a 3D world.
   - A perspective or orthographic `Camera3D` presents the game from a controlled isometric angle.
   - Height, occlusion, lighting, and spatial composition support gameplay without turning the slice into a free-camera action game.

### Explicit non-goals for the vertical slice

- Conventional combat
- Open-world exploration
- Character creation
- Multiplayer or online accounts
- Procedural contracts
- Loot, crafting, or an equipment economy
- Native mobile store releases
- Native desktop releases
- Full voice acting
- Photorealistic art
- Direct references to protected *Neuromancer* material

---

## 2. Vertical Slice Structure

### Target playtime

| Segment | Target duration | Purpose |
|---|---:|---|
| Opening and hub exploration | 8–12 minutes | Establish Nera, Asha, the three contacts, and the job |
| Preparation decision | 3–5 minutes | Select credentials or the hardware backdoor |
| Memory hospice intrusion | 18–25 minutes | Teach, combine, and test the core systems |
| Extraction decision | 2–4 minutes | Choose whether to free or contain Asha |
| Hub aftermath | 3–5 minutes | Demonstrate consequences and close the demo |

### Hub

The physical-world hub is one residential workshop building containing:

- Nera’s room and intrusion rig
- A shared corridor or communal area
- The fixer’s workspace
- A meeting point for the hospice employee
- The street technician’s workshop

The three contacts are:

1. **The fixer**
   - Introduces the hospice job and its practical risks.
   - Provides the baseline access package.
   - Reacts to Nera’s preparation and extraction choices.

2. **The hospice employee**
   - Provides a stolen staff identity.
   - Unlocks credential-gated paths and additional institutional context.
   - Creates a safer but more constrained intrusion route.

3. **The street technician**
   - Installs an illegal hardware backdoor.
   - Exposes unstable topology ports and more aggressive rewiring options.
   - Creates a flexible route with greater detection risk.

### Heist

The corporate memory hospice network contains five functional zones:

1. **Ingress**
   - Teaches movement, anchors, ports, and basic rewiring.
   - Introduces a single security patrol with an obvious route.

2. **Identity gate**
   - Demonstrates the stolen-identity route.
   - Allows the backdoor route to bypass it through unstable topology.

3. **Memory stacks**
   - Introduces collectible memory shards.
   - Teaches that traces can corrupt information instead of resetting progress.

4. **Quarantine lattice**
   - Combines patrol rerouting, permissions, signal flow, and time pressure.
   - Requires the selected preparation advantage without making the other route impossible to understand.

5. **Asha’s containment**
   - Reveals evidence supporting and undermining Asha’s claim to personhood.
   - Ends with the free-or-contain decision.

### Slice branches

The vertical slice supports two linked decisions:

- **Preparation:** stolen identity or hardware backdoor
- **Extraction:** free Asha or contain Asha

This produces four supported playthrough combinations. All combinations share the same major environments while changing access, hazards, dialogue, evidence, and the aftermath scene.

---

## 3. Core Systems

### 3D isometric movement

- Use `Node3D` gameplay scenes, 3D collision, and navigation meshes.
- Click or tap to raycast onto a reachable 3D navigation surface.
- Support keyboard directional movement as an alternative.
- Keep a `Camera3D` at a fixed isometric angle during normal play.
- Permit limited zoom; camera rotation is optional and should be cut if it harms readability or Web performance.
- Fade, hide, or simplify foreground geometry when it occludes the player or an active topology interaction.
- Use navigation meshes for local movement and a separate graph for network connectivity.

### Network topology

Model the network as authored nodes connected through typed ports.

Each node can define:

- Walkable geometry
- Input and output ports
- Security permissions
- Patrol anchors
- Signal sources and receivers
- Memory shards
- Checkpoint anchors
- Route-specific availability

Connections affect:

- Player traversal
- Security patrol paths
- Power or signal delivery
- Door and permission states
- Detection propagation

### Topology-edit mode

- Holding the edit action slows the simulation sharply rather than pausing it.
- Valid ports become visible and display both color and shape identifiers.
- The player drags from one port to another to preview a connection.
- The preview displays affected paths, patrols, and powered systems.
- Invalid edits explain the violated rule without committing a change.
- Releasing or confirming commits the edit and recalculates affected routes.
- Cancelling restores the pre-edit state.

Initial implementation should use a configurable time scale near 15%, adjusted through playtesting.

### Security

The slice uses two readable security behaviors:

1. **Patrol constructs**
   - Travel between graph anchors.
   - Investigate detected topology changes.
   - Reroute when connections change.

2. **Trace pulses**
   - Propagate through connected nodes.
   - Can be redirected by changing signal flow.
   - Fill a detection meter when they reach the player’s node.

Security escalation has three tiers:

- Tier 0: normal patrols and complete route availability
- Tier 1: faster investigation and additional trace pulses
- Tier 2: closed safe paths, heightened patrol speed, and reduced edit tolerance

### Fail-forward memory corruption

- Memory shards provide story evidence and unlock contextual dialogue.
- A completed trace raises the alert tier and corrupts one carried shard.
- When more than one shard is available, the player chooses which one to sacrifice.
- A corrupted shard remains visible but its evidence becomes incomplete or unreliable.
- If no shard is available, the trace closes an optional safe route instead.
- The player resumes from the latest network anchor with committed topology changes preserved.
- Detection must never make the heist impossible to complete.

### Dialogue and narrative state

All dialogue is driven by explicit state conditions rather than duplicated scenes.

Relevant state includes:

- Selected preparation route
- Memories collected
- Memories corrupted
- Current alert tier
- Whether the player trusted Asha during key exchanges
- Final free-or-contain choice

All dialogue is subtitled. Only Asha and a small number of pivotal Nera lines are voiced.

### Save system

- Use versioned JSON save data.
- Save at hub transitions, network anchors, preparation selection, and the final decision.
- Keep one automatic save and one restart-the-slice option.
- Do not allow a save to capture topology halfway through a drag operation.
- Web saves use Godot’s persistent `user://` storage when browser storage is available.

---

## 4. Technical Foundation

### Game stack

- Godot 4.7.1 Standard
- GDScript
- Compatibility renderer and WebGL 2
- GdUnit4 for unit and integration tests
- Git for version control

The Web build is the source of truth throughout production. Features are accepted only after they work in an exported browser build, not merely in the editor. The Compatibility renderer is the project-wide baseline, and presentation must not rely on desktop-only rendering features.

### Platform strategy

#### Stage 1 — Web vertical slice

- Develop, test, optimize, and release only the Web build.
- Use a single-threaded export unless browser deployment testing proves a threaded build is worth its hosting requirements.
- Treat Chrome and Firefox desktop as required browsers.
- Treat Safari desktop as a best-effort compatibility target.
- Support responsive desktop browser layouts; tablet browser input is a smoke-test target, not a native Android commitment.
- Keep build size, startup time, shader compilation, browser storage, and WebGL context recovery visible from Phase 0 onward.

#### Stage 2 — Deferred ports

- Consider macOS first, Windows second, and native Android third only after the Web release gates pass.
- Create no native packaging, signing, store, certification, or platform-specific feature work during the Web vertical slice.
- Reuse the Web-tested content and systems, but give each later platform its own feasibility, performance, input, packaging, and release plan.
- iOS, Linux, consoles, and storefront integrations remain outside this plan.

### Supporting tools

- Blender 4.5 LTS for modular environments and character models
- Krita for textures, portraits, and UI assets
- Audacity or REAPER for dialogue and sound editing
- Bun for telemetry tooling, scripts, and package management
- Cloudflare Workers with TypeScript for telemetry ingestion
- Cloudflare D1 for short-lived anonymous telemetry storage

### Proposed project structure

```text
continuity-error/
├── project.godot
├── addons/
├── assets/
│   ├── audio/
│   ├── fonts/
│   ├── materials/
│   ├── models/
│   ├── textures/
│   └── ui/
├── data/
│   ├── dialogue/
│   ├── networks/
│   └── narrative/
├── scenes/
│   ├── hub/
│   ├── hospice/
│   ├── shared/
│   └── ui/
├── scripts/
│   ├── autoload/
│   ├── dialogue/
│   ├── input/
│   ├── network/
│   ├── narrative/
│   ├── security/
│   └── telemetry/
├── tests/
├── telemetry/
│   ├── migrations/
│   ├── src/
│   └── package.json
└── docs/
```

### Primary data interfaces

#### `NetworkGraph`

Stores:

- Node identifiers and scene references
- Typed ports
- Active connections
- Route requirements
- Security anchors
- Signal sources and destinations

#### `RewireCommand`

Contains:

- Removed connection
- Added connection
- Validation result
- Affected nodes
- Preview state
- Commit and cancel behavior

#### `GameState`

Contains:

- Schema version
- Current scene and checkpoint
- Preparation choice
- Alert tier
- Collected and corrupted memories
- Relationship flags
- Final choice
- Accessibility and input settings

### Rendering constraints

- Use low-poly modular geometry and texture atlases.
- Budget every environment as a real 3D scene with bounded visible geometry, material count, lights, shadows, and draw calls.
- Prefer baked lighting and simple dynamic lights.
- Use unshaded or inexpensive materials for cyberspace.
- Pool repeating constructs and use `MultiMeshInstance3D` where appropriate.
- Avoid compute shaders, heavy transparency, real-time global illumination, and desktop-only post-processing.
- Provide low and standard quality presets from the first performance milestone.
- Test occlusion, depth readability, navigation, picking, and topology-port selection in the exported Web build.

### Input and accessibility

All gameplay actions must be represented through Godot’s InputMap.

Required inputs:

- Move or select destination
- Enter topology-edit mode
- Select and connect ports
- Cancel
- Interact
- Open evidence
- Pause
- Camera zoom

Required accessibility features:

- Remappable keyboard and mouse controls
- Scalable subtitles and UI
- Reduced camera motion
- Reduced flashing
- Separate music, effects, and voice levels
- High-contrast topology mode
- Shape identifiers in addition to color
- Pause during dialogue and evidence reading
- Touch-safe controls and safe-area-aware UI

---

## 5. Telemetry and Player Feedback

Telemetry is disabled until the player explicitly opts in.

### Event API

The game batches events to:

```text
POST /v1/events
```

Each batch contains:

- Schema version
- Build version
- Ephemeral anonymous session identifier
- Platform and renderer class
- Event name
- Timestamp
- Whitelisted event payload

Allowed events:

- `session_started`
- `scene_entered`
- `preparation_selected`
- `rewire_committed`
- `trace_triggered`
- `memory_collected`
- `memory_corrupted`
- `alert_tier_changed`
- `ending_selected`
- `session_completed`
- `performance_sample`
- `fatal_error`

### Privacy constraints

- Do not collect names, email addresses, account identifiers, dialogue text, or free-form input.
- Do not store IP addresses in D1.
- Rotate anonymous session identifiers between installs or when local data is cleared.
- Retain raw events for no longer than 30 days.
- Validate event names and payloads server-side.
- Apply request-size limits, rate limiting, and a production-origin allowlist.
- Telemetry failures must never interrupt gameplay or saving.

### Qualitative feedback

At the end of the demo, provide an optional external survey asking:

- Did the player understand how rewiring changed the network?
- Did detection feel consequential without feeling like lost progress?
- Why did the player free or contain Asha?
- Which preparation route did the player choose and why?
- Where did the player feel confused, bored, or unfairly punished?

---

## 6. Vertical-Slice Phases

The existing 2D prototype is reference material for mechanics, narrative flow, and test cases. It is not the production foundation for the 3D slice, and its prior completion records do not satisfy the 3D exit criteria below. No later phase begins until the previous phase's Web exit criteria pass.

## Phase 0 — 3D Web Feasibility

**Duration:** Weeks 1–3  
**Goal:** Prove that the core interaction is readable, performant, and technically viable as a true 3D browser game before producing content.  
**Implementation status:** Complete — verified 2026-07-24

### Phase 0 verification record

- Production entry point is now `scenes/phase0_feasibility.tscn`; the legacy 2D prototype remains intact as reference material.
- Automated suite: 109 checks passed, 0 failed, including six-node topology, invalid-edit rollback, slowed-time edit mode, and deterministic patrol rerouting.
- Single-threaded Compatibility-renderer Web export completed through `scripts/build.sh`.
- Exported build loaded a live WebGL canvas at 1280×720 in Playwright-managed Chromium and Firefox with zero console errors.
- Browser screenshots: `.screenshots/phase0-chromium.png`, `.screenshots/phase0-firefox.png`, and `.screenshots/phase0-edit-mode.png`.
- Reference runtime benchmark: 60 FPS in both exported browser captures; native diagnostic sample reported 43 draw calls, 74,206 visible primitives, 173 render objects, and 55,951,656 bytes static memory.
- Initial uncompressed export: 39 MB total (39,513,091-byte WASM and 857,872-byte PCK). Compression/hosting optimization remains a Phase 4 concern.
- Branded Google Chrome was unavailable on the reference machine; its Playwright-managed Chromium equivalent passed. Firefox passed directly.

### Deliverables

- Godot 4.7.1 3D production foundation using the Compatibility renderer, with the existing 2D prototype retained only as reference
- Single-threaded Web export preset and automated Web build command
- Small `Node3D` gray-box test room with representative verticality and occluders
- Mouse and keyboard input abstraction
- 3D raycast click-to-move and keyboard movement on a navigation mesh
- Fixed isometric `Camera3D` with zoom and foreground-occlusion handling
- Minimal graph containing six nodes and several typed ports
- 3D topology ports, drag/selection feedback, and slowed-time edit mode
- One 3D patrol that reroutes after a connection change
- Browser performance and download/startup benchmark scene
- Initial automated test harness

### Exit criteria

- The exported Web build runs in current Chrome and Firefox with no game-code console errors.
- A player can rewire a connection and visibly redirect a patrol.
- Invalid edits are rejected without corrupting graph state.
- Click-to-move, port selection, and navigation remain reliable across slopes, height changes, and occluding geometry.
- The benchmark holds 60 FPS at 1280×720 on the reference laptop in both required browsers.
- Initial download size, time to first interaction, draw calls, visible triangles, material count, and peak memory are measured and recorded before budgets are locked.

### Stop or redesign conditions

- If 3D graph changes cannot be communicated clearly, replace free dragging with authored connection slots or a focused edit camera before proceeding.
- If Web performance misses the target, reduce visible geometry, materials, shadows, lighting complexity, and graph size before producing final assets.
- If 3D navigation or picking remains unreliable, redesign movement and port interaction before building the mission.
- Do not begin hub art or final dialogue until this phase passes.

### Prior-prototype evidence to preserve

- The 2D prototype validated graph snapshots, typed-port rewiring, invalid-edit cancellation, patrol rerouting, and single-threaded Web export.
- These mechanics and tests should inform the 3D version, but all spatial interaction and performance gates must be revalidated in 3D.

---

## Phase 1 — Core Heist Systems

**Duration:** Weeks 4–7  
**Goal:** Produce a complete mechanics-only heist loop.
**Implementation status:** Complete — verified 2026-07-24

### Phase 1 verification record

- Production entry point is now `scenes/phase1_core_heist.tscn`, a true 3D mechanics-only mission; Phase 0 and the legacy 2D prototype remain intact as reference material.
- The authored seven-node graph supports stolen-identity and hardware-backdoor routes, typed ports, deterministic preview/commit/cancel rewiring, traversal changes, patrol rerouting, signal paths, and graph diagnostics.
- Detection is fail-forward: traces corrupt carried evidence, increase one of three alert tiers, restore the latest network anchor, and close an optional route when no clean memory remains.
- The mission remains completable at maximum alert through both preparation routes, including after topology edits and checkpoint restoration.
- Versioned JSON save/load reproduces preparation, topology, alert tier, checkpoint, collected/corrupted memories, and branching state.
- Automated suite: 143 checks passed, 0 failed. Coverage includes graph invariants, typed-port validation, rollback, both routes, traces, corruption, no-memory fallback, maximum-alert completion, and serialization.
- Single-threaded Compatibility-renderer Web export completed through `scripts/build.sh`.
- Exported build completed the mechanics loop at 1280×720 in Playwright-managed Chromium and Firefox with zero console errors.
- Browser screenshots: `.screenshots/phase1-chromium.png`, `.screenshots/phase1-firefox.png`, `.screenshots/phase1-complete-chromium.png`, and `.screenshots/phase1-complete-firefox.png`.
- The scene also launched live through the connected Godot 4.7.1 editor; the runtime game log contained no errors or warnings.

### Deliverables

- Data-driven `NetworkGraph` resources
- Rewire preview, validation, commit, and cancel flow
- Patrol constructs and trace pulses
- Three alert tiers
- Network anchors and checkpoint restoration
- Memory shard collection
- Trace-triggered memory corruption
- No-memory fallback consequence
- Evidence inventory
- Versioned `GameState` and save/load
- Debug overlays for graph state, patrol routes, and signal propagation
- 3D spatial feedback for traversal, patrol paths, trace direction, active ports, and affected geometry

### Exit criteria

- A 10-minute gray-box mission can be completed through at least two routes.
- Every committed edit produces deterministic route and signal changes.
- Detection changes the run without forcing a reload.
- The mission remains completable at maximum alert.
- Save/load reproduces preparation, topology, alert, and memory state.
- Automated tests cover graph invariants, corruption, branching state, and serialization.
- The exported Chrome and Firefox builds pass the mechanics loop and performance budget.

### Scope protection

- Use only two security behaviors.
- Do not add weapons, health, enemy combat, or skill trees.
- Prefer authored graph puzzles over procedural network generation.

### Prior-prototype evidence to preserve

- The 2D prototype validated the intended graph, security, checkpoint, corruption, branching, and save logic.
- Port reusable data and logic selectively; rebuild presentation, navigation, collision, picking, and spatial tests for 3D.

---

## Phase 2 — Complete Gray-Box Vertical Slice

**Duration:** Weeks 8–11  
**Goal:** Make the entire demo playable from opening to aftermath before visual polish.
**Implementation status:** Complete — verified 2026-07-24

### Phase 2 verification record

- Production entry point is now `scenes/phase2_graybox_vertical_slice.tscn`, a true `Node3D` launch-to-credits gray-box slice. Phase 0, Phase 1, and the legacy 2D narrative prototype remain intact as reference material.
- The 3D residential workshop hub contains Nera's rig, three distinct contact stations, room dividers/occluders, fixed isometric framing, and readable choice/state overlays.
- Vale, Suri, and Moth are functional contacts with a complete subtitle-only dialogue draft. Meeting all three unlocks the stolen-identity or hardware-backdoor preparation decision.
- The verified Phase 1 heist is integrated as a five-zone mission with route-specific identity/bypass dialogue and hazards, tutorial instructions, supporting and undermining evidence, anchors, rewiring, traces, corruption, and fail-forward completion.
- Both extraction choices lead to route-and-choice-specific aftermath dialogue, visibly different hub states, and distinct credits summaries.
- Automated suite: 236 checks passed, 0 failed. All identity/free, identity/contain, backdoor/free, and backdoor/contain combinations reach credits with both evidence shards and without missing dialogue or unwinnable state.
- Single-threaded Compatibility-renderer Web export completed through `scripts/build.sh`.
- Exported Chromium completed identity/free from opening to credits at 1280×720 with zero console errors or warnings. Exported Firefox completed backdoor/contain with zero console errors; Firefox emitted three non-fatal engine/WebGL compatibility warnings.
- Browser screenshots: `.screenshots/phase2-hub-chromium.png`, `.screenshots/phase2-heist-chromium.png`, `.screenshots/phase2-complete-chromium.png`, `.screenshots/phase2-hub-firefox.png`, and `.screenshots/phase2-complete-firefox.png`.
- The scene launched live through the connected Godot 4.7.1 editor and rendered the opening over the 3D hub. The formal unassisted 30–45 minute human timing study remains part of the external playtest rounds; automated E2E runs intentionally skip reading time.

### Deliverables

- Complete gray-box hub
- Three functional contacts
- Opening briefing
- Stolen-identity preparation route
- Hardware-backdoor preparation route
- Five-zone memory hospice mission
- Tutorial prompts embedded in the opening zone
- Evidence supporting and undermining Asha’s identity
- Free-or-contain decision
- Four valid route-and-ending combinations
- Choice-dependent aftermath scene
- Complete subtitle-only dialogue draft
- Complete 3D gray-box environments, collision, navigation, camera framing, and occlusion treatment

### Exit criteria

- The demo can be played from launch to credits without developer intervention.
- Both preparation choices materially alter access and hazards.
- Both extraction choices produce distinct closing scenes.
- First-time internal testers complete the slice in 30–45 minutes.
- No choice produces missing dialogue, broken checkpoints, or an unwinnable state.
- The narrative clearly communicates the personhood question without resolving it.
- Every scene completes in exported Chrome and Firefox builds within the agreed Web memory and performance budgets.

### Content lock

At the end of this phase:

- Lock the number of rooms, network zones, characters, endings, and security behaviors.
- New ideas go into a post-slice backlog.
- Subsequent changes must replace existing content rather than expand total scope.

### Prior-prototype evidence to preserve

- The 2D prototype validated the launch-to-credits narrative flow, four branch combinations, content boundaries, and dialogue state coverage.
- Reuse the authored structure and test expectations while rebuilding and revalidating the complete slice in 3D.

---

## Phase 3 — Art, Audio, and Presentation

**Duration:** Weeks 12–16  
**Goal:** Replace the gray box with the final visual and audio identity.
**Implementation status:** Complete — verified 2026-07-24

### Phase 3 verification record

- Production entry point is now `scenes/phase3_presentation_vertical_slice.tscn`; it layers the final presentation over the locked Phase 2 rooms, zones, characters, endings, and security behaviors.
- The physical hub now has an analog-grime presentation made from modular floor plates, pipes, cable runs, work benches, archive/rack props, localized work lights, and distinct lightweight silhouettes for Nera, Vale, Suri, and Moth.
- Cyberspace now uses a cold emissive palette, geometric signal monoliths, restyled mission geometry, ambient data particles, and choice-reactive extraction effects. Free and contain aftermaths use distinct cyan and magenta visual language.
- The final UI uses a consistent high-contrast visual treatment. Topology remains encoded by typed port shape/identifier as well as color, and all dialogue remains fully subtitled and usable with audio muted.
- Three original procedural soundscapes cover the hub, network, and aftermath. Low and standard quality presets adjust dynamic shadows and cyberspace particle density.
- All shipped presentation assets are original, generated from Godot primitives or synthesized waveforms; provenance is recorded in `docs/ASSET_LICENSES.md`. No third-party or protected-franchise assets are included.
- Automated suite: 316 checks passed, 0 failed. Coverage includes all identity/free, identity/contain, backdoor/free, and backdoor/contain combinations, presentation replacement, soundscape availability, both quality presets, subtitle/color-independent readability, extraction effects, evidence retention, and final credits.
- Single-threaded Compatibility-renderer Web export completed through `scripts/build.sh`.
- Exported Chromium completed identity/free from opening to credits at 1280×720 with a live WebGL 2 canvas and zero console errors or warnings.
- Exported Firefox completed backdoor/contain from opening to credits at 1280×720 with zero console errors. Firefox emitted three non-fatal engine/WebGL compatibility warnings.
- Browser screenshots: `.screenshots/phase3-hub-chromium.png`, `.screenshots/phase3-heist-chromium.png`, `.screenshots/phase3-complete-chromium.png`, and `.screenshots/phase3-complete-firefox.png`.
- The presentation scene also launched live through the connected Godot 4.7.1 editor. The current run reported no game-runtime errors; older retained editor diagnostics were cleared and code-shadowing warnings found during the audit were corrected.

### Deliverables

- Modular analog-grime hub environment
- Cold geometric cyberspace environment kit
- Final Nera and Asha representations
- Contact portraits or lightweight character models
- Final UI and evidence presentation
- Topology-edit visual language
- Patrol, trace, corruption, and extraction effects
- Ambient physical-world and cyberspace soundscapes
- Reactive detection and alert audio
- Selective Asha voice performance
- Pivotal voiced Nera lines
- Music for hub, intrusion, escalation, and aftermath
- Credits and asset-license manifest

### Exit criteria

- Every gray-box asset visible to players is replaced or deliberately styled.
- Topology state remains readable without relying on color alone.
- Dialogue remains understandable with voices muted.
- Audio communicates detection and trace direction without requiring UI focus.
- Standard and low quality presets meet their performance targets.
- All shipped assets have documented usage rights.

### Art direction constraints

- Spend detail on silhouettes, lighting contrast, and composition rather than texture resolution.
- Reuse modular pieces aggressively.
- Keep physical spaces tactile and crowded; keep cyberspace spacious and abstract.
- Avoid imagery or terminology strongly identifiable with existing cyberpunk franchises.

---

## Phase 4 — Accessibility, Telemetry, and Web Hardening

**Duration:** Weeks 17–20  
**Goal:** Convert the content-complete slice into a reliable public demo.
**Implementation status:** Complete — verified 2026-07-24

### Phase 4 verification record

- Production entry point is now `scenes/phase4_release_vertical_slice.tscn`, layered over the locked Phase 3 presentation.
- All gameplay actions are represented in the InputMap. Keyboard and mouse bindings can be remapped at runtime.
- Accessibility state supports independent UI and subtitle scaling, reduced motion, reduced flashing, high-contrast topology, and separate music/effects/voice levels.
- Loading, telemetry consent, pause, settings, restart, recoverable save-failure feedback, touch-safe controls, credits, and optional survey flows are present.
- Responsive layout checks pass at 1280×720, 1920×1080, 2560×1080 ultrawide, and 1024×768 tablet-shaped viewports.
- Telemetry remains disabled until explicit consent. Declining produces zero event requests; unknown events and non-whitelisted payload fields are rejected; missing endpoints and failed delivery do not interrupt play.
- The Cloudflare Worker/D1 implementation includes origin enforcement, a 64 KiB request limit, event/payload validation, batch insertion, a 30-day expiry schema, and a retention deletion task under `telemetry/`.
- Automated Godot suite: 332 checks passed, 0 failed. Worker validation: 2 checks passed, 0 failed. TypeScript strict typecheck passed.
- Single-threaded Compatibility-renderer Web export completed through `scripts/build.sh`: 39,513,091-byte WASM, 939,964-byte PCK, and 279,815-byte loader JavaScript before transport compression.
- Exported Chromium completed identity/free from consent to credits at 1280×720 with zero console errors or warnings and no telemetry request after declining consent.
- Exported Firefox completed backdoor/contain from consent to credits at 1024×768 with zero console errors. Firefox emitted the same three non-fatal engine/WebGL compatibility warnings recorded in prior phases.
- Browser screenshots: `.screenshots/phase4-consent-chromium.png`, `.screenshots/phase4-hub-chromium.png`, `.screenshots/phase4-complete-chromium.png`, and `.screenshots/phase4-complete-firefox.png`.
- The scene launched live through the connected Godot 4.7.1 editor. The current game-run log contains no errors or warnings; two older retained editor parse diagnostics predate this run and do not reproduce in headless tests, exports, either browser, or the current game log.
- Production hosting and the real D1 identifier/origin are intentionally deployment-time values; the build and Worker are release-ready without embedding credentials in source.

### Deliverables

- Complete remapping and accessibility settings
- Responsive UI across supported aspect ratios
- Browser mouse and keyboard controls
- Opt-in consent flow
- Cloudflare Worker event ingestion
- D1 schema and retention task
- End-of-demo survey link
- Hosted compressed Web build
- Crash and fatal-error reporting without personal data
- Loading, pause, settings, restart, and credits flows
- Browser storage failure handling

### Exit criteria

- Chrome and Firefox pass the Web release checklist.
- Declining telemetry produces no network event requests.
- Offline or failed telemetry does not affect gameplay.
- Save failure produces a clear, recoverable message.
- UI remains usable at 1280×720, 1920×1080, ultrawide, and tablet-shaped viewports.
- The complete Web download is measured and optimized against an agreed release-size budget.

---

## Phase 5 — External Playtesting and Release Candidate

**Duration:** Weeks 21–24  
**Goal:** Use the contingency window for evidence-driven polish and release.
**Implementation status:** Release-candidate tooling implemented; external playtest rounds pending

### Phase 5 implementation record

- Production entry point is now `scenes/phase5_release_candidate.tscn`, identified in-game and in the Web shell as `rc1-2026.07.24`.
- Each run receives an anonymous local session ID and records bounded launch-to-credits milestone timings, route, ending, alert/evidence state, and predefined issue codes without names, contact details, recordings, or free-form text.
- Completed sessions save a local JSON report automatically; `F8` supports early-session report capture.
- `docs/PLAYTEST_PROTOCOL.md` defines the three independent rounds, observation boundaries, browser matrix, honest aggregation formulas, privacy rules, and release gates.
- Automated suite: 396 checks passed, 0 failed. Coverage includes all four route/ending combinations, bounded issue codes, milestone capture, privacy flags, and local report generation. Automated success does not count as external playtest evidence.
- Single-threaded Compatibility-renderer Web export completed through `scripts/build.sh`: 39,513,091-byte WASM, 948,668-byte PCK, and 279,815-byte loader JavaScript. The build script now rejects missing or empty artifacts, including disk-exhaustion failures that Godot's exporter may not surface.
- Exported Chromium completed identity/free from consent to credits at 1280×720 with a live WebGL 2 canvas, zero console errors or warnings, zero telemetry event requests after declining consent, and a visible confirmation that the anonymous playtest report was saved.
- Browser screenshots: `.screenshots/phase5-consent-chromium.png`, `.screenshots/phase5-hub-chromium.png`, `.screenshots/phase5-heist-chromium.png`, `.screenshots/phase5-extraction-chromium.png`, and `.screenshots/phase5-complete-chromium.png`.
- The release-candidate scene launched live through the connected Godot 4.7.1 editor. The current game-run log contained no errors or warnings; two retained editor parse diagnostics predate the run and do not reproduce in the 396-check headless suite, Web export, Chromium run, or current game log.
- Phase 5 was re-audited on 2026-07-24: 396 Godot checks, 2 Worker checks, and the strict TypeScript typecheck passed; the single-threaded Web export rebuilt successfully.
- A fresh exported Chromium smoke test loaded the WebGL 2 canvas at 1280×720 with zero console errors or warnings and successful WASM/PCK requests. Screenshot: `.screenshots/phase5-verification-chromium.png`.
- The smoke test exposed and fixed an RC build-label overlap with the bottom status strip; the build and report labels now use responsive top-edge anchors, and the corrected export was recaptured.
- Phase 5 was independently re-verified on 2026-07-24 before external testing: 396 Godot checks, 2 Worker checks, the strict TypeScript typecheck, and a fresh single-threaded Web export all passed. An exported Chromium identity/free run declined telemetry, met all contacts, committed a rewire, collected both evidence shards, resolved a trace, reached credits, and saved its anonymous local report with zero console errors or warnings and no telemetry event request. Audit screenshots: `.screenshots/phase5-audit-consent-chromium.png`, `.screenshots/phase5-audit-hub-chromium.png`, `.screenshots/phase5-audit-heist-chromium.png`, and `.screenshots/phase5-audit-complete-chromium.png`.
- Phase 5 engineering verification was refreshed on 2026-07-24 at the phase gate: all 396 Godot checks passed with zero failures and the single-threaded Web export rebuilt successfully. The exported Chromium WebGL 2 build completed the identity/free path from consent through locally saved anonymous report with zero console errors or warnings and no telemetry request after consent was declined. Fresh screenshots: `.screenshots/phase5-fresh-consent-chromium.png`, `.screenshots/phase5-fresh-hub-chromium.png`, `.screenshots/phase5-fresh-route-chromium.png`, `.screenshots/phase5-fresh-heist-chromium.png`, `.screenshots/phase5-fresh-extraction-chromium.png`, and `.screenshots/phase5-fresh-complete-chromium.png`. The production main scene also launched through the connected Godot 4.7.1 editor with a clean current-run game log.
- Phase 5 evidence handling was completed on 2026-07-24 with `scripts/aggregate_playtests.ts`. The Bun-based validator calculates the release gates from anonymous observer-enriched reports while rejecting duplicate sessions, synthetic evidence, assisted attempts, personal-data flags, unknown fields, and reports from another build. Three focused aggregator checks passed, including a ten-player passing sample and negative privacy/synthetic-evidence cases; the protocol now documents the assessment schema and archive command.
- The phase-gate verification was then rerun: 396 Godot checks, 3 aggregator checks, 2 Worker checks, strict Worker typecheck, and a fresh single-threaded Web export all passed. Exported Firefox completed consent-decline through identity/free credits and local anonymous-report save at 1280×720 with zero console errors, no telemetry request, and the three previously documented non-fatal Firefox/WebGL warnings. Fresh screenshots: `.screenshots/phase5-aggregate-consent-firefox.png`, `.screenshots/phase5-aggregate-hub-firefox.png`, `.screenshots/phase5-aggregate-heist-firefox.png`, `.screenshots/phase5-aggregate-extraction-firefox.png`, and `.screenshots/phase5-aggregate-complete-firefox.png`. The production main scene also launched through the connected Godot 4.7.1 editor with a clean current-run game log.
- External gates remain pending: at least ten first-time players across the comprehension and narrative rounds, followed by the Web release-candidate matrix. The phase must not be marked complete until genuine results satisfy every release gate.

### Playtest rounds

1. **Comprehension test**
   - Five or more players
   - No verbal guidance
   - Focus on movement, rewiring, detection, and objectives

2. **Narrative and choice test**
   - Five or more new players
   - Focus on Asha’s credibility, preparation reasoning, and final choice

3. **Web release-candidate test**
   - Required browser matrix
   - Save/load, fresh install, telemetry consent, offline, and performance coverage

### Release gates

- At least 80% of unassisted testers complete the heist.
- At least 80% can explain how their rewiring changed a security route.
- Players recognize that detection corrupted information rather than merely removing health.
- Both preparation routes and endings appear in the test sample.
- No blocker or save-corruption defects remain.
- No known path leaves the game unwinnable.
- Median playtime remains between 30 and 45 minutes.
- Performance targets hold during the quarantine-lattice peak.

### Cut order if the schedule slips

Cut or simplify in this order:

1. Extra environmental props and incidental animations
2. Nonessential voice lines
3. Optional memory shards
4. Secondary dialogue variations
5. Camera rotation
6. Cosmetic cyberspace effects

Do not cut:

- Topology rewriting
- Both preparation routes
- Fail-forward memory corruption
- Free-or-contain decision
- Choice-dependent aftermath
- Web release build
- Accessibility basics

---

## 7. Test Matrix

### Automated tests

- Port compatibility and connection validation
- Graph reachability after every valid edit
- Patrol rerouting
- Trace propagation
- Alert-tier transitions
- Memory collection and corruption
- No-memory trace fallback
- Checkpoint restoration
- Save schema validation and migration
- Preparation-route conditions
- Dialogue condition evaluation
- All four branch combinations
- Telemetry event validation and consent gating

### Manual scenarios

- Complete both routes without detection.
- Complete both routes after reaching maximum alert.
- Trigger a trace before collecting any memory.
- Corrupt each memory shard and confirm resulting dialogue.
- Save and reload at every anchor.
- Close the browser during and after a save.
- Disable browser storage.
- Lose network connectivity after opting into telemetry.
- Switch quality, subtitle, and accessibility settings mid-mission.
- Use keyboard-only, mouse-only where practical, and touch controls.
- Resize the browser throughout dialogue and topology editing.

### Web release matrix

| Target | Release requirement |
|---|---|
| Chrome, latest two stable versions | Full release gate |
| Firefox, latest two stable versions | Full release gate |
| Safari desktop | Best-effort smoke test |
| Edge desktop | Best-effort smoke test |
| Tablet-sized browser viewport | Responsive-layout smoke test |
| macOS native | Deferred until after Web release |
| Windows native | Deferred until after Web release |
| Android native | Deferred until after Web release |

---

## 8. Definition of Done

The vertical slice is complete when:

- A new player can finish a polished 30–45 minute demo without assistance.
- The hub, preparation choice, heist, extraction choice, and aftermath form one coherent loop.
- Rewriting topology changes traversal, patrols, permissions, and signal flow.
- Failure causes persistent but recoverable memory corruption.
- Both preparation routes and both endings are complete and tested.
- The Web build meets stability, startup, download-size, memory, and performance requirements in Chrome and Firefox.
- Browser-responsive UI is present; native mobile controls and packages are deferred.
- Accessibility basics and full subtitles ship with the first public build.
- Telemetry is anonymous, optional, validated, and non-blocking.
- Every asset has traceable rights and the game contains no copied *Neuromancer* IP.

---

## 9. Post-Slice Backlog

Only consider these after the release candidate passes:

- macOS feasibility and native release plan
- Windows feasibility and native release plan
- Native Android feasibility, touch redesign, and release plan
- Native iOS releases
- Controller support
- Additional hub locations
- More network security archetypes
- Additional heists
- Character progression and software loadouts
- Broader faction reputation
- Localization
- Expanded voice acting
- Linux certification
- Steam or storefront integration
- Full-game production plan for the 8–12 hour campaign
