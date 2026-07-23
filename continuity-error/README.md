# Continuity Error

Phase 0 risk-validation prototype for an isometric topology-rewiring game.

## Run and verify

```bash
rtk godot --editor --path .
rtk ./scripts/test.sh
rtk ./scripts/build.sh
```

The Web preset is intentionally single-threaded. Hold `E` (or middle mouse) and drag between compatible circular data ports to edit the graph. On touch, begin a drag directly on a port. Invalid edits are rejected without changing graph state.
