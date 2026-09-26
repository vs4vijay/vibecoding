# Spec Delta — render/world

## Purpose

Turn the bare six-mesh road corridor into a cinematic apocalypse environment — layered sky, deep skyline, dense themed roadside set dressing, and atmosphere — without breaking the pooled segment-recycling contract.

## ADDED Requirements

### Requirement: Layered dusk sky

The sky SHALL render as a layered dusk composition — gradient dome, sun disc with glow, and cloud/haze banding — instead of a single vertex gradient.

#### Scenario: Sun disc and glow present

- **WHEN** the sky is captured toward the sun azimuth
- **THEN** a sun disc region plus surrounding glow falloff are detectable, distinct from the plain gradient above the horizon

### Requirement: Multi-layer skyline with parallax

The distant city SHALL render as at least three silhouette layers at different depths with lit-window detail, producing visible parallax as the car moves.

#### Scenario: Differential parallax between layers

- **WHEN** screenshots are captured at two car positions separated by a pinned distance
- **THEN** nearer skyline layers shift more than farther layers between captures

### Requirement: Themed roadside set dressing

Roadside corridors SHALL contain recurring themed props (destroyed vehicles, debris piles, fences/barriers, dead vegetation, street furniture, ruined structures) with at least the pinned number of distinct prop types present in any 200 m window.

#### Scenario: Prop variety in corridor

- **WHEN** any 200 m corridor of active world is inspected
- **THEN** at least the pinned count of distinct prop types is present and all props come from pooled, preallocated sources

### Requirement: Ground storytelling decals

The environment SHALL include ground decals (oil stains, skid marks, cracks, blood remnants) placed by seeded rules and recycled with their segment.

#### Scenario: Decals present and recycling

- **WHEN** a corridor is inspected across recycling
- **THEN** decals are present somewhere in the window and no decal outlives its segment (no orphans outside the recycle window)

### Requirement: Cinematic atmosphere

Fog/atmosphere SHALL be tuned (exponential falloff, haze layering) so distant geometry fades cinematically and lamp/headlight light becomes visible in the haze.

#### Scenario: Distance falloff curve

- **WHEN** objects at pinned near/mid/far distances are sampled
- **THEN** their contrast against the sky falls along the pinned atmospheric curve (near full contrast, far heavily hazed)

### Requirement: Streaming invariants preserved with new content

The upgraded world SHALL keep the existing streaming contract: forward-only recycling, coverage window [carZ−30, carZ+150], and zero per-frame allocation in the update path.

#### Scenario: Recycle coverage with dressed segments

- **WHEN** the existing recycle/teleport test battery runs against the dressed world
- **THEN** all coverage and teleport-retry assertions pass unchanged, and a heap-probe across 60 recycled segments shows no steady-state growth
