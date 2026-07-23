# Continuity Error

## Vertical Slice Development Plan

**Status:** Planning reset for a true 3D, Web-first vertical slice — implementation not started  
**Target:** Polished 30–45 minute public demo  
**Development model:** Solo developer with AI assistance  
**Schedule:** 20 weeks of planned production plus 4 weeks of contingency  
**Initial release:** Web only  
**Deferred platforms:** macOS, Windows, and native Android, considered only after the Web vertical slice ships  

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
**Implementation status:** Not started

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
**Implementation status:** Blocked on Phase 0

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
**Implementation status:** Blocked on Phase 1

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
**Implementation status:** Blocked on Phase 2

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
**Implementation status:** Blocked on Phase 3

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
**Implementation status:** Blocked on Phase 4

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
