# ui-ux-pass — integration verification notes (task 8.2)

## Determinism guard — ?freeze capture pairs (2026-09-27)

Tool: `.qa/serve.mjs` (static server with `Service-Worker-Allowed: /`, added
this change — python's http.server omits the header, which makes
pwa-register.js log a scope error that `shot.mjs` correctly counts as a
console-error failure) + existing `.qa/shot.mjs`.

New QA hook used for the shell screens: `?screen=menu|pause|results`
(client/js/src/qa/hooks.js) — forces the target shell state on top of the
frozen autostarted run, before the loop starts, so the 5 warmup frames render
the target state deterministically. Two small determinism alignments shipped
with it (client/js/src/main.js):

- MENU render branch now passes freeze-aware `dt` to `sky.update` /
  `run.updateRender` (same contract the PLAYING branch already had) —
  otherwise the sky clock advanced by real time even in frozen menu shots.
- `showGameOver` pins the DISPLAYED duration under `?freeze`
  (`shownDuration = qa.freeze ? Math.round(qa.time) || 5 : duration`);
  the real `performance.now()` delta still goes to the backend payload.
  Without this, whole-second jitter flips the mm:ss digit between loads.

Captures (all at 1600×900, seed=7, two fresh Chromium loads each):

| Screen | URL params | sha256 match | console/page errors |
|---|---|---|---|
| run | `?freeze=1&qa=1&seed=7&time=3` | ✅ identical (`5601415a…`) | 0 |
| menu | `?freeze=1&seed=7&screen=menu` | ✅ identical (`6b74ee42…`) | 0 |
| paused | `?freeze=1&qa=1&seed=7&time=3&screen=pause` | ✅ identical (`e315e91d…`) | 0 |
| results | `?freeze=1&qa=1&seed=7&time=3&screen=results` | ✅ identical (`60d44ffc…`) | 0 |

PNGs: `.qa/uiux-freeze/{run,menu,pause,results}-{a,b}.png`.

Result: 4/4 screen pairs byte-identical, zero console errors — the two
scenarios deferred by `.qa/ui-ux-acceptance.mjs` ("Frozen capture is stable",
"Frozen capture of a transition state") both PASS.
