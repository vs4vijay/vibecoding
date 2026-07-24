# Continuity Error RC1 Playtest Protocol

Use build `rc1-2026.07.24`. Each participant plays without verbal guidance. Do
not collect names, email addresses, recordings, or free-form text in the game.
Press `F8` if a session ends early; completed sessions save a local anonymous
JSON report automatically at credits.

## Round 1 — Comprehension

Recruit at least five first-time players. Observe without coaching. After play,
ask the participant to demonstrate movement and explain one topology edit,
detection, memory corruption, and the current objective. Record only the
anonymous session ID and these booleans:

- completed the heist
- correctly explained how rewiring changed a security route
- recognized detection as information corruption
- encountered a blocker, unwinnable state, or save corruption

Do not begin Round 2 until comprehension failures have been triaged.

## Round 2 — Narrative and choice

Recruit at least five different first-time players. Record the preparation and
ending from the generated report. Ask whether Asha seemed credible and whether
the final choice felt informed, recording only yes/no/uncertain. The combined
sample must include both preparation routes and both endings.

## Round 3 — Web release candidate

Run fresh-storage, save/load, consent-decline, telemetry-offline, and full-flow
checks in current Chrome and Firefox. Smoke-test Safari, Edge, and a
tablet-shaped viewport where available. Record browser version, pass/fail,
median FPS in the quarantine lattice, peak frame time, and any blocker code.

## Release gate calculation

Count only unassisted first attempts.

- Completion rate = completed sessions / valid sessions; required: at least 80%.
- Rewire comprehension = correct explanations / valid Round 1 sessions;
  required: at least 80%.
- Median completed-session playtime must be 30–45 minutes.
- Both preparation routes and both endings must appear in the sample.
- Blocker, save-corruption, and known unwinnable-state counts must be zero.
- Chrome and Firefox matrices must pass; quarantine performance must remain
  within the release budget.

The release gate cannot be marked passed from automated runs or synthetic
reports. Archive the anonymous reports and a dated aggregate, never participant
identities.
