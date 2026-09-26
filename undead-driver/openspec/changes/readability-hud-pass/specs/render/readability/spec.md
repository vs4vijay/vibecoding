# Spec Delta — render/readability

## Purpose

Guarantee that every threat on the road — obstacles, zombies, and the player car itself — is visually distinguishable from the environment at the distances where the player must react, without losing the dusk mood or the game's performance budget.

## ADDED Requirements

### Requirement: Obstacles distinguishable from the road

Obstacles (wrecks and barriers) SHALL be visually distinguishable from the asphalt surface at the distance they spawn ahead of the car (~90 m), under the scene's dusk lighting and fog.

#### Scenario: Fresh spawn readability

- **WHEN** an obstacle row spawns at the standard spawn distance ahead of the car
- **THEN** a screenshot sampled at that frame shows obstacle pixels measurably distinct from adjacent road pixels (brightness/hue contrast above a pinned threshold)

#### Scenario: Barrier hazard markings

- **WHEN** a barrier obstacle is on screen
- **THEN** it displays alternating high-contrast chevron/striped markings on its face

### Requirement: Wreck brake lights

Wrecks SHALL carry emissive rear lights that are visible against the dusk scene.

#### Scenario: Wreck rear reads in fog band

- **WHEN** a wreck is within the visible corridor (inside fog far distance)
- **THEN** at least one emissive light pixel region is detectable on it

### Requirement: Proximity obstacle warning ring

As an obstacle approaches the car's z position, a ground warning ring SHALL fade in around it; the ring SHALL NOT be visible when the obstacle is far ahead. The approach distance at which the ring appears SHALL be a config tunable.

#### Scenario: Ring appears on approach

- **WHEN** an active obstacle's z is within the configured warning distance of the car
- **THEN** a ground ring renders around that obstacle and its opacity increases as the gap shrinks

#### Scenario: No ring at distance

- **WHEN** an active obstacle is beyond the configured warning distance
- **THEN** no warning ring renders for it

### Requirement: Car rear visibility

The player car SHALL have red emissive tail lights on its rear face (the face the chase camera sees), lit whenever the car is on screen. The car body SHALL use a tone that reads against the asphalt under scene lighting.

#### Scenario: Tail lights visible at run start

- **WHEN** a run starts and the chase camera frames the car from behind
- **THEN** two red emissive regions are present on the car's rear face

### Requirement: Zombie palette contrast

Zombie characters SHALL be visually distinguishable from the asphalt at mid distance, and the three types (walker, runner, brute) SHALL remain mutually distinguishable by body tint and size.

#### Scenario: Mid-distance zombie readability

- **WHEN** a zombie stands on the road at ~40 m ahead of the car
- **THEN** its pixels are measurably distinct from adjacent road pixels

#### Scenario: Type identity preserved

- **WHEN** one zombie of each type is on screen
- **THEN** the three differ visibly in tint and brute is visibly larger

### Requirement: Unmissable leap telegraph

During the leap telegraph window, a red ground flash SHALL render at the telegraphing zombie's position in addition to the existing crouch animation, such that the telegraph is noticeable without fixating on the zombie.

#### Scenario: Telegraph flash accompanies crouch

- **WHEN** a zombie enters the telegraph state
- **THEN** a red ground-level visual appears at its position for the duration of the telegraph and disappears when the leap begins

### Requirement: Exposure floor with dusk mood preserved

Scene tuning (ambient/hemisphere intensity, road albedo, fog color) SHALL be raised enough that the requirements above hold, while remaining recognizably a dusk scene (warm horizon gradient, fog-masked distance).

#### Scenario: Mood preserved after exposure lift

- **WHEN** the title scene and a mid-run scene are screenshotted after the change
- **THEN** the sky shows a warm dusk gradient and fog still masks the far road, and threat-contrast checks above still pass

### Requirement: Rendering budget respected

All visual additions SHALL use pooled/instanced rendering with no steady-state per-frame allocation, and total draw calls SHALL stay within the project's ≤120 steady-state budget (currently ~91).

#### Scenario: Draw budget holds with full scene

- **WHEN** a mid-run frame renders with 8 zombies and a full obstacle set active
- **THEN** the renderer's draw-call count is ≤120
