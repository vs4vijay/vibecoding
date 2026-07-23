# Continuity Error

Phase 1 complete mechanics-only 3D heist loop for an isometric topology-rewiring game.

## Run and verify

```bash
rtk godot --editor --path .
rtk ./scripts/test.sh
rtk ./scripts/build.sh
```

The Web preset is intentionally single-threaded.

The production entry point is a true 3D gray-box mission. Choose the stolen
identity or hardware-backdoor route with `1`/`2`, traverse with `Space`,
collect evidence with `M`, launch a trace with `T`, preview and commit a
rewire with `R`, cancel with `C`, save/load with `K`/`L`, and toggle graph
diagnostics with `F3`.

---

## Development Setup

codex mcp add godot-ai  --url http://localhost:8007/mcp
