# Spec Delta

## Purpose

Provides the game's playable structure: Blitz checkpoint races with timers and medals, Cruise free-roam mode, race presentation (checkpoints, guidance, results), and record keeping per event.

## ADDED Requirements

### Requirement: Blitz checkpoint races
The game SHALL offer Blitz races: the player must reach a fixed sequence of checkpoints before the race timer reaches zero. Reaching a checkpoint SHALL advance to the next one with clear feedback; reaching the final checkpoint before time expires SHALL finish the race as a win; the timer reaching zero first SHALL end the race as a loss. At least three Blitz routes SHALL exist, differing in length and difficulty, each starting the player at a defined origin.

#### Scenario: Winning a blitz race
- **WHEN** the player passes all checkpoints of a Blitz race before the timer reaches zero
- **THEN** the race ends in a results screen showing the finish time and earned medal

#### Scenario: Time expires mid-route
- **WHEN** the race timer reaches zero before the player reaches the final checkpoint
- **THEN** the race ends immediately with a failure result and the option to retry or return to the menu

#### Scenario: Checkpoint advances in sequence
- **WHEN** the player passes the current target checkpoint
- **THEN** the target switches to the next checkpoint in the route with a confirmation cue (sound and visual), and checkpoints cannot be taken out of order

### Requirement: Checkpoint guidance
During a race the game SHALL continuously guide the player toward the current checkpoint: the checkpoint itself SHALL be visually marked in the world (for example a light beam and ring/gate), and the HUD SHALL indicate its direction from anywhere in the city, including when it is off-screen.

#### Scenario: Guidance points off-screen
- **WHEN** the current checkpoint is outside the camera view
- **THEN** the HUD shows a directional indicator (edge arrow) pointing toward it

#### Scenario: Checkpoint visible in the world
- **WHEN** the current checkpoint is within view at any distance
- **THEN** it is identifiable in the world by its marker before the player reaches it

### Requirement: Medals and record keeping
Each Blitz race SHALL define gold, silver, and bronze time thresholds. Finishing a race SHALL award the medal matching the finish time, and the game SHALL store the best finish time and highest medal per race across sessions (via the shell's persistence). The event selection SHALL show each race's saved best time and medal.

#### Scenario: Medal from finish time
- **WHEN** the player finishes a race with a time under its gold threshold
- **THEN** the results screen and the event selection show a gold medal for that race

#### Scenario: Best time updates
- **WHEN** the player finishes faster than their previously saved best
- **THEN** the new time replaces the saved best and the results screen notes a new record

### Requirement: Cruise free-roam mode
The game SHALL offer a Cruise mode: free driving in the city with no objectives, time limits, or fail states, using the same car, traffic, and city as race mode. The player SHALL be able to open the pause menu and leave Cruise at any time.

#### Scenario: Cruise has no fail state
- **WHEN** the player drives in Cruise mode for an extended period, including crashing and ignoring roads
- **THEN** no timer or failure ever ends the mode, and it continues until the player quits via the pause menu

### Requirement: Race start state
Starting any race SHALL place the player car at the route's designated start, reset the race timer, and begin with a short countdown before control begins, so attempts are repeatable and comparable.

#### Scenario: Countdown before control
- **WHEN** a race starts
- **THEN** a countdown is displayed and the player cannot accelerate until it finishes, with the timer starting as control begins
