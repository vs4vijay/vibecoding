# Spec Delta — render/lighting

## Purpose

Replace flat Lambert-only lighting with a physically credible cinematic dusk lighting pipeline — filmic tonemapping, shadow casting, image-based ambient, and real light sources — so every surface reads with depth comparable to a modern AAA release.

## ADDED Requirements

### Requirement: Filmic color pipeline

The renderer SHALL apply filmic (ACES-family) tonemapping with correct sRGB output color space, exposed so that highlights roll off smoothly and shadows retain visible detail.

#### Scenario: Highlight rolloff on emissives

- **WHEN** a frame containing emissive elements (brake lights, lamps, muzzle flash) is captured
- **THEN** sampled emissive pixels sit below pure white (no clipped plateau) and neighboring pixels show a smooth brightness falloff rather than a hard edge

#### Scenario: Shadow detail retained

- **WHEN** the darkest ground region under the car is sampled
- **THEN** pixel values remain above the pinned shadow-floor threshold (detail survives, no crushed black)

### Requirement: Shadow-casting key light

The sun SHALL cast dynamic shadows from the car, zombies, obstacles, and roadside props onto the road, within a configured shadow radius that follows the play area.

#### Scenario: Car casts a directional shadow

- **WHEN** the car is rendered under the sun
- **THEN** a shadow with an identifiable car silhouette is detectable on the road surface, offset in the sun's direction, distinct from any legacy blob-shadow

#### Scenario: Shadow coverage follows the car

- **WHEN** the car travels far enough that the shadow volume would be exceeded
- **THEN** the shadow volume re-centers on the car without visible shadow popping at the screen edges

### Requirement: Image-based environment lighting

PBR-lit surfaces SHALL receive ambient illumination from a procedurally generated environment map that matches the dusk sky, so metallic and smooth surfaces pick up sky-tinted reflections.

#### Scenario: Sky reflection on car paint

- **WHEN** the car body is captured at a grazing angle
- **THEN** the paint shows a brightness gradient consistent with the sky (brighter toward the horizon direction), not a uniform flat shade

### Requirement: Real headlight illumination

The car's headlights SHALL illuminate the road surface ahead as real lights in addition to any beam visual, with range and intensity as config tunables.

#### Scenario: Road brightened ahead of car

- **WHEN** headlights are active
- **THEN** road pixels in the headlight cone ahead of the car are measurably brighter than road pixels outside the cone at equal distance

### Requirement: Streetlamp light pools

Streetlamps SHALL produce visible light pools on the road beneath them and a visible glow/beacon at the lamp head.

#### Scenario: Light pool under lamp

- **WHEN** a lit streetlamp is within the visible corridor
- **THEN** an elliptical bright region is detectable on the road directly beneath the lamp head

### Requirement: Atmosphere evolves with level progress

Scene lighting mood (sun elevation/hue, fog color and density) SHALL shift gradually with level progression, driven by config tunables, without breaking readability of threats.

#### Scenario: Late-level mood shift

- **WHEN** the run progresses across multiple levels
- **THEN** captured fog/sun sampled values differ measurably between early and late levels, while obstacle and zombie readability contrast thresholds still pass
