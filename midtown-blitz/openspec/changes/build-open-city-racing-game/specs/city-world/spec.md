# Spec Delta

## Purpose

Provides the open city environment the game takes place in: a deterministic, procedurally generated city with a connected road network, varied buildings, props, atmosphere, and a collision world that the vehicle and traffic simulation query.

## ADDED Requirements

### Requirement: Deterministic procedural city generation
The city SHALL be generated procedurally from a fixed, versioned seed so that every session produces the same city layout, including road positions, building footprints and heights, props, and landmark placement. Generation SHALL complete fast enough that the loading screen's progress visibly advances and the game is playable within a few seconds on a mid-range laptop.

#### Scenario: Same city every run
- **WHEN** the game is started twice in a row (or reloaded)
- **THEN** the city layout — roads, buildings, landmarks — is identical between runs

#### Scenario: Generation finishes promptly
- **WHEN** a session starts on a mid-range laptop
- **THEN** city generation completes within a few seconds and the loading progress bar reflects the phases of generation

### Requirement: Connected drivable road network
The city SHALL contain a connected network of two-way roads with intersections forming city blocks, such that any intersection is reachable from any other by driving on roads. Roads SHALL be the primary drivable surface, and the network SHALL span at least an 8×8 grid of blocks so that crossing the city at speed takes on the order of a minute.

#### Scenario: Any destination reachable on roads
- **WHEN** the player drives from one intersection toward any other intersection following the road grid
- **THEN** the route is traversable entirely on road surfaces without leaving the road network

#### Scenario: City is large enough to explore
- **WHEN** the player crosses the city from one edge to the opposite edge at top speed
- **THEN** the trip takes roughly a minute, indicating a city of at least 8×8 blocks

### Requirement: City furniture and variety
City blocks SHALL contain buildings with varied footprints, heights, and coloring, raised sidewalks with drivable low curbs, and street props (such as streetlights and trees) placed along roads. The city SHALL include at least one distinct landmark (such as a park or tower) that is usable as an orientation point.

#### Scenario: Buildings vary across blocks
- **WHEN** the player looks across several adjacent blocks
- **THEN** buildings differ in size, height, and appearance rather than repeating a single identical model

#### Scenario: Curbs are bump-over
- **WHEN** the player drives slowly over a curb onto a sidewalk
- **THEN** the car crosses the elevation change without being destroyed or permanently stuck

#### Scenario: Landmark is identifiable
- **WHEN** the player views the skyline from a road
- **THEN** at least one distinctive landmark structure is visible and can be used for navigation

### Requirement: Static collision world
All solid static geometry — buildings, props, parked obstacles' surfaces (as provided by this capability's collision query interface) — SHALL be registered in a collision world. The vehicle and traffic simulations SHALL be able to query it so nothing passes through buildings or large props.

#### Scenario: Car cannot drive through buildings
- **WHEN** the player drives full speed into a building wall
- **THEN** the car is stopped or deflected by the wall and never appears inside the building

#### Scenario: Props block the car
- **WHEN** the player collides with a large street prop
- **THEN** the car is obstructed or the prop reacts (topples/shakes) but the car does not pass through

### Requirement: Sky, lighting, and atmosphere
The city SHALL be presented under a daytime sky with a sun providing directional lighting and shadows (quality permitting), ambient fill, and distance fog so distant geometry fades naturally into the horizon.

#### Scenario: Distant geometry fades
- **WHEN** the player looks down a long road toward the horizon
- **THEN** far buildings fade into fog rather than popping against the sky
