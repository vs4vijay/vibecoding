# Spec Delta

## Purpose

Populates the city with ambient life: AI traffic cars that drive the road network believably and parked cars that act as obstacles, with physical collision against the player car.

## ADDED Requirements

### Requirement: Ambient AI traffic
The city SHALL be populated with traffic cars that drive along the road network, keeping to their lane side, following the road through intersections (including turns), and maintaining a steady cruising pace. Traffic SHALL remain populated around the player wherever they drive in the city.

#### Scenario: Traffic keeps to its lane
- **WHEN** a traffic car drives along a road past the player
- **THEN** it stays on its side of the road at a steady pace rather than weaving across the center line

#### Scenario: Traffic turns at intersections
- **WHEN** a traffic car reaches an intersection
- **THEN** it continues along a chosen road through the intersection (straight or turning) without leaving the road surface

#### Scenario: Traffic surrounds the player everywhere
- **WHEN** the player drives from one district to a distant one
- **THEN** traffic cars are present near the player throughout the trip, having been moved in and out of the active area seamlessly

### Requirement: Traffic avoidance
Traffic cars SHALL slow or stop for vehicles directly ahead of them in their path — both other traffic and the player — instead of driving through them, and SHALL resume when the path clears.

#### Scenario: Traffic brakes for a stopped player
- **WHEN** the player stops in a traffic lane and a traffic car approaches from behind
- **THEN** the traffic car slows and stops a safe distance behind the player and waits

#### Scenario: Traffic resumes after obstruction clears
- **WHEN** the obstruction ahead of a stopped traffic car moves away
- **THEN** the traffic car resumes driving within a short moment

### Requirement: Parked cars
Some streets SHALL have parked cars along the curb that act as solid obstacles for driving and racing, included in the collision world.

#### Scenario: Parked car is a solid obstacle
- **WHEN** the player swerves into a parked car
- **THEN** the collision stops or deflects the player car and the parked car does not move through buildings or other cars

### Requirement: Physical collisions with the player
Traffic cars SHALL participate in collisions as physical objects: an impact between the player and a traffic car affects both — deflecting, spinning, or slowing them according to the impact — and neither passes through the other.

#### Scenario: Side collision deflects both cars
- **WHEN** the player T-bones or side-swipes a moving traffic car
- **THEN** both cars react to the impact (deflection and/or spin) and separate afterwards without interpenetrating
