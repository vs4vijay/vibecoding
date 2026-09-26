# Spec Delta

## Purpose

Defines the player's car: arcade driving physics, control inputs, camera behavior, collision response with the world and traffic, and recovery when stuck or flipped.

## ADDED Requirements

### Requirement: Arcade driving model
The player car SHALL behave as an arcade vehicle: it accelerates to a top speed on the order of 180–220 km/h (in-game scale) within a few seconds of full throttle, brakes to a stop, reverses, and steers with grip that permits both clean cornering and handbrake-induced slides. Speed, steering rate, and grip SHALL be tuned so the car is controllable at all speeds.

#### Scenario: Full throttle reaches top speed
- **WHEN** the player holds full throttle on a straight road
- **THEN** the speedometer climbs smoothly to the car's top speed within a few seconds and holds there

#### Scenario: Handbrake slides the car
- **WHEN** the player is cornering at speed and applies the handbrake
- **THEN** the rear of the car breaks traction and the car slides through the corner while remaining under player control

### Requirement: Control inputs
The car SHALL be controllable via keyboard: throttle/brake-reverse and steering on the WASD/arrow key clusters, handbrake on Space, reset on R, and camera view cycling on C. Input state SHALL be polled by the simulation each tick, and held inputs SHALL produce continuous (not event-only) responses.

#### Scenario: Steering responds continuously
- **WHEN** the player holds a steering key while driving forward
- **THEN** the car turns smoothly and continuously for as long as the key is held

#### Scenario: Reverse works
- **WHEN** the player holds brake/reverse from a standstill
- **THEN** the car accelerates backward up to a limited reverse speed

### Requirement: Camera
The game SHALL present a smoothed chase camera that follows the car from behind and above by default, keeping the car on screen during acceleration, braking, and cornering. At least two camera views (for example chase and hood/bonnet) SHALL be available via the camera-cycle input.

#### Scenario: Camera follows through a corner
- **WHEN** the player steers through a 90-degree intersection at speed
- **THEN** the camera remains behind and oriented along the car's travel so the road ahead stays visible

#### Scenario: Camera view toggles
- **WHEN** the player presses the camera-cycle control
- **THEN** the view switches to the next camera mode and the car remains visible and controllable

### Requirement: Collision response
The player car SHALL collide with the static city collision world, parked cars, and traffic cars: impacts stop or deflect the car according to the impact angle and speed, with the car never passing through a solid object. Hard impacts SHALL produce audible and visual feedback (impact sound, brief camera shake).

#### Scenario: Head-on impact stops the car
- **WHEN** the player drives head-on into a building at speed
- **THEN** the car decelerates abruptly to a stop against the wall, an impact sound plays, and the camera shakes briefly

#### Scenario: Glancing impact deflects
- **WHEN** the player clips a parked car at an angle
- **THEN** the car's heading and velocity are deflected rather than stopped dead, and neither car passes through the other

### Requirement: Reset and recovery
The player SHALL be able to reset the car at any time with the reset input, which SHALL place the car upright, on the nearest valid drivable surface, with zero velocity, within about one second. If the car is detected flipped or immovably stuck, the game SHALL offer an automatic reset prompt.

#### Scenario: Manual reset recovers the car
- **WHEN** the player presses the reset control after flipping the car
- **THEN** within about a second the car is upright on the nearest road with zero speed and can immediately drive

#### Scenario: Flipped car prompts recovery
- **WHEN** the car has been resting upside down for a couple of seconds
- **THEN** the game shows a reset prompt so the player can recover without guessing at controls
