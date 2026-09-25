# AGENTS.md — rules for every agent working on NEON RUSH

Project: "NEON RUSH: Hyperdrome" — AAA-grade synthwave endless runner, three.js, browser.
Read `/workspace/neon-rush/ARCHITECTURE.md` first — it is a binding contract.

## Hard rules

1. **Stay in your lane**: only create/modify files listed in your task (TASKS.md wave table).
   Never edit another wave's files. If an interface is missing, add a *registration* or emit a
   bus event; if truly blocked, report the exact blocker in your final message.
2. **Read ARCHITECTURE.md** before writing code. Match its APIs exactly (names, signatures).
3. **AAA or nothing**: this is pitched at modern AAA polish. Every visual you ship must hold up
   in a side-by-side with top-tier titles (Neon Drive/Outrun-grade synthwave, Geometry Dash
   readability, Subway Surfers smoothness). Placeholder gray boxes are a fail.
4. **Performance**: obey the perf section of ARCHITECTURE.md. Zero allocations in hot loops.
5. **No dead ends**: the game must be playable end-to-end after your change. If you break boot,
   fix it before reporting. Verify with the harness (below).
6. **Code style**: modern ES modules, no semicolon-mandatory style policing, no external
   dependencies beyond `vendor/`. Comments only for non-obvious constraints.

## Self-verification loop (every agent, every iteration)

```bash
cd /workspace/neon-rush
python3 tools/server.py 3050 &     # if not already running
node tools/shot.mjs --set menu,run,death --out /tmp/shots_mine   # screenshots + console errors
node tools/perf.mjs                                              # fps/draw calls probe
```

- Fix ALL console errors/warnings before reporting.
- Look at your own screenshots (Read tool on PNGs) and be your own harsh critic before submitting.

## Honesty

Report exactly what works and what doesn't. Never claim visual/perf results you didn't observe
in a screenshot or perf probe.
