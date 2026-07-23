# Continuity Error

Phase 2 complete gray-box vertical slice for an isometric topology-rewiring game.

## Run and verify

```bash
rtk godot --editor --path .
rtk ./scripts/test.sh
rtk ./scripts/build.sh
```

The Web preset is intentionally single-threaded.

The playable loop runs from Asha's opening message through the three-contact
hub, preparation, all five hospice zones, the free-or-contain decision,
choice-dependent aftermath, and credits. Controls and objectives are shown
in-game. Dialogue advances with `Enter` or `Space`; numbered choices select
contacts and preparation; `Space` traverses the heist, `M` collects evidence,
and the final choice uses `F` or `C`.
