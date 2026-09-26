# Spec Delta — render/materials

## Purpose

Give every surface in the game AAA-grade PBR materials with runtime-generated albedo/normal/roughness maps — asphalt, car paint, zombie skin, metal, props — while keeping the zero-binary-assets rule: every texture is generated in code at boot.

## ADDED Requirements

### Requirement: All textures generated in code

All texture maps SHALL be generated at runtime in code (no network fetches, no binary asset files), generated once at boot, cached, and reused.

#### Scenario: No external texture loads

- **WHEN** the game boots with network requests instrumented
- **THEN** zero requests fetch image/binary texture assets, and all renderer textures originate from in-memory generated sources

#### Scenario: Generation budget and cache reuse

- **WHEN** texture generation runs at boot
- **THEN** it completes within the pinned time budget and each requested map identity is generated exactly once (cache hit on second request)

### Requirement: Asphalt surface detail

The road SHALL use a PBR asphalt material with albedo/normal/roughness detail that reads as texture up close and stays readable at distance, with lane markings as durable decals rather than bare flat color.

#### Scenario: Close-up surface variance

- **WHEN** a close-up frame of the road is captured
- **THEN** local pixel variance and normal-map-driven shading variation are above the pinned flat-color threshold, while the 90 m spawn-distance readability contrast from `render/readability` still passes

### Requirement: Non-repeating segment variation

Repeated world surfaces (asphalt segments, shoulders) SHALL carry seeded per-segment variation (tint, wear, decal placement) so adjacent segments are not visually identical.

#### Scenario: Adjacent segments differ measurably

- **WHEN** two adjacent road segments are captured in one frame
- **THEN** their sampled surface statistics differ measurably above a pinned threshold

### Requirement: Car paint and damage material states

The car SHALL use a metallic clearcoat paint material with environment reflections, and its material SHALL progress through visible damage states (micro-scratches → worn → battered) driven by accumulated damage.

#### Scenario: Damage state visible after hits

- **WHEN** the car accumulates damage across pinned thresholds
- **THEN** captured body material shows measurably increased surface break-up (scratch/roughness variation) between states

### Requirement: Zombie skin material identity

Zombie skin SHALL use a PBR material with normal/roughness detail and per-type tint/saturation identity so all three types read distinctly at combat distance.

#### Scenario: Type identity at combat distance

- **WHEN** walker, runner, and brute are captured side by side
- **THEN** their sampled tints and silhouettes are distinguishable above the pinned contrast thresholds

### Requirement: Wet-look and ground-in wear

Key horizontal surfaces (asphalt, car roof/hood) SHALL show environmental wear (subtle wet/sheen variance in low areas, dust on upward faces) via roughness maps rather than uniform finish.

#### Scenario: Sheen variance present

- **WHEN** the road is captured under the sun at a raking angle
- **THEN** specular sheen varies across the surface (low spots brighter) above a pinned variance threshold
