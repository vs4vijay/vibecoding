# TASKS.md — build waves & file ownership (orchestrator maintains)

Status legend: [ ] todo · [~] in progress · [x] done · [!] blocked

## Wave 0 — Foundation & Tooling (parallel)
- [x] W0-A FOUNDATION — `src/**` core+world+player+RunPhase MVP, index.html, main.js,
      debug API, menu/hud/death functional placeholders (clean but simple), playable end-to-end.
      Files: src/main.js, src/core/*, src/world/Track.js Chunk.js Patterns.js Obstacles.js,
      src/player/Player.js Camera.js (Character.js minimal stand-in), src/phases/Phase.js
      RunPhase.js, src/game/Scoring.js (basic), src/ui/UI.js + minimal screens, index.html,
      public/styles.css (base tokens only — W1-UI owns the AAA pass).
- [x] W0-B TOOLING — `tools/server.py`, `tools/shot.mjs`, `tools/perf.mjs` — all verified
      working (playwright chromium installed; baseline: 104 draw calls, 0 console errors).

## Wave 1 — Parallel builders (each owns listed files ONLY)
- [x] W1-VIS WORLD LOOK — Props/Static/Shaders/Textures landed; run/menu/death/orb/drift look
      strong. KNOWN WEAK: flight corridor (dark boxes, confusing ring), hopper (flat), stack
      (unclear gates) — re-entry via Wave-2 critic loop.
- [x] W1-FX POST & PARTICLES — PostFX + FX landed and wired in main.js.
- [x] W1-CHAR CHARACTERS — Character.js + skins.js landed (772 lines); needs critic pass.
- [x] W1-PHASES — all 5 phases landed and boot clean via ?photo=; needs critic pass (flight/hopper/stack visuals weak).
- [x] W1-AUDIO — src/audio/Audio.js (957 lines): 124 BPM 16-step sequencer, Am–F–C–G,
      4 combo tiers, 28 SFX, menu/run modes, stingers, mute persisted. Probe-verified.
- [x] W1-UI META — shop (14 skins + 4 implants), missions (3 slots, auto-refill), settings,
      daily runs + streak, XP/levels, toasts; Economy/Missions/Daily landed; Save extended
      (skin/shards/x2Next/charges). 40+ probe assertions pass.
- [x] W1-FEEL GAME FEEL — Feel.js (hitstop 80ms, slow-mo, FOV kick, haptics, 2s death cam
      with ring buffer), Director flow EMA + density, Scoring full (style:drift/perfect),
      mystery box world pickup + Economy.openBox, 2 Patterns fairness fixes. Fairness probe
      20/20 seeds clean; feel probe 15/15.

## Known cross-lane debts (fix in Wave 2)
- [ ] FX.js: spawnPop('near', 0, …) builds key 'near0' → wrong popup copy ("GREAT!" not
      "CLOSE!"); FX double-fires near-miss juice (listens to both near-miss and style:near-miss).
- [ ] Missions.js: no box:open mission template (mystery boxes now exist in-world).

## Wave 2 — Harsh critic QA loop (per subsystem, iterate ≤3+ rounds)
- [x] world-look — CLOSED after R1b/R2/R4/R6/R8/R10/R12 fix rounds vs R2/R3/R5/R7/R9/R11
      critics. R11 verdict: OVERALL PASS, all 9 scenes ≥8.1 (menu 8.7, run 8.6, drift 8.5,
      orb 8.4, run30 8.4, death 8.3, flight 8.2, stack 8.1, hopper 8.1), 0 console errors,
      105-129 draw calls. R12 craft-polish closed the critic's 6-item list (hopper cones +
      traffic family + t=0 dressing, stack cursor slab rebuild, flight avatar lit + violet
      wall beams, orb chip facets, death label chips, run30 sun halo). Notable fixes along
      the way: boot-breaking MAX_RINGS bug, death-screen GLSL compile error, phase
      first-frame identity-matrix bug (counts at max before update), sRGB/linear setRGB
      hazards, orb deep-warp nondeterminism (pre-existing — Wave 3 item).
- [x] FX/particles/postfx — CLOSED. R1 builder: 8 debts fixed (popup key, double-fire,
      toast dedupe, popup ordering, trail restyle, game-time transition FX, slash-streak
      root-cause, chevron anisotropy) + AAA audit. R1 critic: FAIL on popup stacking only.
      R2 builder: family collapse + ladder offset + Feel +25 suppression + trail/speedline
      tuning + MED ≤90 (implemented missing drawDistance consumer). R2 critic: PASS all
      families ≥8.5. R3 sweep: P0 warp nondeterminism fixed (Patterns.js boxGap module state
      survived Track.reset; proven 5/5+3/3+3/3 identical), title-pill dupe removed (3D
      cinematic card is the single title moment), tier-rebuild accounting, speed-line fever
      ramp, stack tower clip, popup copy pinning. 11/11 scenarios clean, 103-117 draw calls.
- [~] characters — critic round starting. Character.js + skins.js (772 lines, W1-CHAR)
      never critically reviewed.

## Wave 3 — Integration & perf
- [ ] main-agent playtest (browser-use), cross-system bugs, memory probe 10 min, mobile profile.

## Wave 4 — Final acceptance sweep (blind critics vs AAA bar) + ship
