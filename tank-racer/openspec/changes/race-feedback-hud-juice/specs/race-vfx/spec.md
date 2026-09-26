# Spec Delta

## Purpose

Scene-space visual effects that make tank motion legible and satisfying: skid marks under hard cornering and boost flames from the exhaust — pure eye candy with zero effect on physics, collisions, or race outcomes.

## ADDED Requirements

### Requirement: Skid marks under hard cornering
When a tank turns hard while moving fast (or spins out), the system SHALL place dark ground decals at the tank's rear that fade out over a few seconds. Marks SHALL have no collision, SHALL NOT affect grip, and SHALL be cleared on race restart and track switch.

#### Scenario: Hard turn leaves marks
- **WHEN** a tank corners hard above a speed threshold
- **THEN** dark decal marks appear on the road at the tank's rear

#### Scenario: Marks fade and are bounded
- **WHEN** marks have existed for a few seconds, or the live-mark cap is reached
- **THEN** old marks fade out and are removed; the live count never grows unbounded

#### Scenario: Cosmetic only
- **WHEN** a tank drives over skid marks
- **THEN** handling, grip, and collisions are unchanged

### Requirement: Boost flames
While a tank's boost is active (boost pad or pickup boost), the system SHALL emit flame particles from the tank's rear at a rate-gated cadence, and SHALL stop emitting when the boost ends. All tanks — human and AI — SHALL show flames.

#### Scenario: Flames while boosting
- **WHEN** any tank's boost is active
- **THEN** flame particles emit from the tank's rear at a steady rate-gated cadence

#### Scenario: Flames stop with boost
- **WHEN** the boost timer expires
- **THEN** no new flame particles are emitted (already-live ones finish their lifetime)

### Requirement: Pooled effects budget
All new effects SHALL reuse the existing pooled-particle approach (shared geometry and materials, bounded live counts), SHALL NOT allocate per-frame objects in steady state, and SHALL NOT reduce race framerate measurably.

#### Scenario: Steady-state allocation stays flat
- **WHEN** a race runs for several minutes with continuous skids and boosts
- **THEN** live effect counts remain bounded and no per-frame mesh/material allocation occurs
