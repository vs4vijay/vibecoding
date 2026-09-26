# Spec Delta — render/quality-gate

## Purpose

Define the acceptance bar that makes "AAA quality" enforceable rather than aspirational: an independent harsh-critic loop with blind side-by-side comparisons against AAA reference stills for every visual workstream, plus the re-pinned performance contract.

## ADDED Requirements

### Requirement: Blind side-by-side critic gate

Every visual workstream SHALL be accepted only after an independent critic pass judges its live capture side by side against a AAA reference still of comparable subject matter, with the critic blind to which image is which.

#### Scenario: Recorded verdict per workstream

- **WHEN** a workstream declares visual completion
- **THEN** a recorded verdict exists citing the comparison captures, the blind winner, and per-axis commentary; workstreams without a passing verdict are not done

#### Scenario: Critic rejection loops the work

- **WHEN** the critic rates the game capture below parity with the reference
- **THEN** the workstream continues iterating with the critic's specific complaints addressed before the next comparison round

### Requirement: Harsh critic rubric

The critic SHALL score each comparison on a fixed rubric — lighting, material/surface quality, silhouette/shape language, composition, motion/animation, and UI craft — requiring parity or better overall to pass, and SHALL name concrete deficiencies on failure.

#### Scenario: Rubric-cited verdict

- **WHEN** any critic verdict is recorded
- **THEN** it lists a score per rubric axis and, on failure, at least one concrete, actionable deficiency

### Requirement: Performance floor

At default quality settings the game SHALL sustain the pinned fps floor (60 fps target, ≥55 accepted) over a sustained in-combat measurement on the reference dev machine.

#### Scenario: Sustained fps measurement

- **WHEN** a 30 s in-combat run is traced at default settings
- **THEN** average fps meets the floor with frame-time spikes bounded by the pinned ceiling

### Requirement: Restated draw-call ceiling

The steady-state draw-call budget SHALL be re-pinned for the upgraded scene at the new ceiling (≤300 hard, ≤260 target), measured with the existing renderer-info dev hook, superseding the prior ≤120 figure.

#### Scenario: Draw call probe with full scene

- **WHEN** the full dressed scene renders at max entity density and the renderer-info probe is read
- **THEN** steady-state draw calls are at or below the target figure, and never above the hard ceiling

### Requirement: Pooling and allocation invariants preserved

All new visual systems SHALL obey the existing pooling contract: preallocated at construct, zero steady-state allocation in update paths, `startRun()` resets without reallocating.

#### Scenario: Heap stability across a run

- **WHEN** repeated run/restart cycles with combat execute
- **THEN** heap growth across cycles stays within the pinned tolerance and no per-frame allocation is observed in update paths

### Requirement: Evidence and regression discipline

Every workstream SHALL leave live-browser evidence (headless Chromium over CDP captures or DOM probes), the pure-logic test suite and typecheck SHALL remain green, and any logic-behavior change required by visuals (e.g., new events) SHALL arrive with mutation-tested unit coverage.

#### Scenario: Full gate passes before completion

- **WHEN** the change is declared implementation-complete
- **THEN** the vitest suite and typecheck pass, each workstream's evidence artifacts exist, and the final critic verdicts are all passes
