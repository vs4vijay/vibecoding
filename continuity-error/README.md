# Continuity Error

Phase 1 mechanics-only heist for an isometric topology-rewiring game.

## Run and verify

```bash
rtk godot --editor --path .
rtk ./scripts/test.sh
rtk ./scripts/build.sh
```

The Web preset is intentionally single-threaded.

The Phase 1 heist supports two preparation routes, graph-driven traversal and
security, trace escalation, fail-forward memory corruption, anchors, evidence,
and JSON save/load. Controls are shown in-game: choose a route with `1` or `2`,
advance with `Space`, collect memories with `M`, trigger a trace with `T`,
preview/commit rewires with `R`, cancel with `C`, save/load with `K`/`L`, and
finish with `F`. `F3` toggles the graph, patrol, and signal debug overlay.
