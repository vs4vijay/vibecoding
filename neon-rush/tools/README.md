# QA tooling

Chromium headless runs WebGL2 via SwiftShader (CPU). FPS numbers are relative-only;
draw calls / triangles / heap are the primary headless signals.

```bash
python3 tools/server.py 3050            # static server (no-cache), root = project dir

node tools/shot.mjs --set menu,run,run30,death --out /tmp/shots [--width 1600] [--height 900] [--seed 7]
#   screenshots + <name>.console.json per scenario; exit 1 on any console/page error.
#   scenarios: menu run run30 flight drift hopper stack orb death shop menu-meta (see SCENARIOS in shot.mjs)

node tools/perf.mjs [--seconds 12] [--scenario run] [--leak]   # fps/draw-calls; --leak = 10-min heap probe
```

Adding scenarios: edit the `SCENARIOS` table in shot.mjs. Steps run after `__NR.ready`:
`['forceState','RUN']`, `['forcePhase','flight']`, `['warp',8]`, `['teleport',500]`,
`['ui','shop']`, `['emit','ui:toast',{...}]` — missing `__NR` methods mark the scenario
`skipped`, never crash the batch.
