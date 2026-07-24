# Continuity Error

Release candidate RC1 for a true-3D isometric topology-rewiring game.

## Run and verify

```bash
rtk godot --editor --path .
rtk ./scripts/test.sh
rtk ./scripts/build.sh
```

The Web preset is intentionally single-threaded.

The production entry point is the Phase 5 Web release candidate. Choose the stolen
identity or hardware-backdoor route with `1`/`2`, traverse with `Space`,
collect evidence with `M`, launch a trace with `T`, preview and commit a
rewire with `R`, cancel with `C`, save/load with `K`/`L`, and toggle graph
diagnostics with `F3`. Press `F8` to save an anonymous local playtest report.
See `docs/PLAYTEST_PROTOCOL.md` before running external sessions.

---

## Development Setup

codex mcp add godot-ai  --url http://localhost:8007/mcp
