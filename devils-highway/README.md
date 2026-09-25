# DEVIL'S HIGHWAY

A quiet-apocalypse desert-highway road movie you can play. A Southwest interstate
at dusk, a burning city on the horizon, evacuation convoys left where they died —
and the dead walking the lanes. Three modes share one world: **RUN** (on-foot
lane runner — jump, slide, survive), **DRIVE** (muscle-car highway survivor) and
**RIDE** (motorcycle combat runner). Kill zombies with guns and bumpers, dodge
what the evacuation left behind, and go as far as the road allows. Best distances,
currency and upgrades persist between runs.

RUN is playable end-to-end; DRIVE and RIDE are on the roadmap (their mode cards
are already in the menu).

**Play online:** <https://vs4vijay.github.io/vibecoding/devils-highway/>

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move / steer (lanes) | `A`/`D` or `←`/`→` | swipe left / right |
| Jump | `W`, `↑` or `Space` | swipe up |
| Slide | `S` or `↓` | swipe down |
| Select mode (menu) | `1` / `2` / `3` | tap a card |
| Start / confirm | `Enter` | tap |
| Pause / back | `Esc` | PAUSE button |

## Local development

No build step — vanilla ES modules with an importmap and three.js r172 vendored
under `vendor/three/`. Serve the folder (any static server works; the bundled one
adds correct MIME types):

```sh
node serve.mjs            # http://127.0.0.1:8123
```

QA harness (used by the monorepo's capture workflow): append `?qa=1` plus
`&seed=N`, `&time=dusk|night|<seconds>`, `&mode=run`, `&scene=menu|game|gameover|paused`,
`&staged=NAME`, `&cam=close|side|front|beauty`, `&freeze=1`. Headless captures:

```sh
bun .qa/shot.mjs "http://127.0.0.1:8123/index.html?qa=1&scene=menu&seed=1" /tmp/menu.png
bun .qa/contract_probe.mjs http://127.0.0.1:8123   # full QA contract matrix
bun .qa/run_probe.mjs http://127.0.0.1:8123        # gameplay probe
```

Both probes must end `ok: true` with `consoleErrors: []`.

## Architecture note — no build step

This game is the monorepo's no-build exception: everything is procedural
(canvas PBR textures, shader sky, WebAudio), three.js r172 is vendored and
mapped via an importmap, and the deploy workflow stages the folder verbatim
(like `games-hub/`) instead of running Vite. Internal codename is still
`endless` (localStorage keys, save version, cache internals) — that is
intentional; see AGENTS.md. The service worker cache name is
`devils-highway-v1` (caches are origin-global across the monorepo site).
