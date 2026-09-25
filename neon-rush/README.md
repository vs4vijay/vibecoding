# NEON RUSH: Hyperdrome

A synthwave endless runner for the browser — three lanes, phase shifts that
rewrite the rules mid-run, and a meta shop where every implant actually does
what it says. Built with vanilla ES modules + an import map and vendored
three.js r170: **no bundler, no build step** — the source tree *is* the game
(that contract lives in [ARCHITECTURE.md](./ARCHITECTURE.md)).

**Play online:** <https://vs4vijay.github.io/vibecoding/neon-rush/>

## Quickstart

```bash
bun install                # playwright devDep for the QA harness
bun run dev                # python3 tools/server.py → http://127.0.0.1:3050
bun run build              # pure staging copy → dist/ (dist IS the game)
bun run test               # harness smoke: menu/run/death screenshots + console check
                           #   (start `bun run dev` first)
```

Or plain: `python3 tools/server.py 3050` and open <http://127.0.0.1:3050>.

## Controls

| input | action |
| --- | --- |
| `←` `→` / `A` `D` | switch lane |
| `↑` / `W` / `Space` | jump (flap during flight phases) |
| `↓` / `S` | slide (dive) |
| `Shift` (hold) | drift |
| `P` | pause |
| touch | swipe to move/jump/slide · tap to flap · on-screen pause button |
| gamepad | standard mapping — d-pad/left stick move · `A` jump · `B` slide |

## The run

- **Phase bar** — the HUD bar up top fills toward the next phase shift. When
  it pops, the game changes its own rules: **RUN** (lanes + jump/slide),
  **FLIGHT** (hold to rise), **DRIFT**, **HOPPER**, **STACK**, **ORB**. No two
  runs sequence the same phases.
- **Combo** — pickups and near-misses stack a multiplier; 5 s of inactivity or
  a hit decays it. Combo tiers add music layers.
- **The Static** — a wall of glitch chases you the whole way. Slow down and it
  eats the run.

## Meta (it all really works)

- **Coins & XP** persist (`localStorage`), levels unlock characters.
- **Shop implants** — HEAD START (spawn 300 m ahead), MAGNET CORE (stronger
  orb pull), COMBO GUARD (combo decays 50% slower), AEGIS SHIELD (survive one
  crash per run).
- **Shield charges** — the mystery box stores extra absorptions; an unused
  charge survives the run.
- **Revive offer** — on death you can spend 250 coins to keep the run going
  (once per run).
- **Daily Run** — seeded track of the day, plus missions for bonus XP.

First-run tip: hug near-misses to build combo, grab a MAGNET CORE early, and
keep an AEGIS SHIELD armed before you chase your best.

## Repo plumbing

This folder lives in the vibecoding monorepo and ships via
`.github/workflows/games-pages-deploy.yml` (one Pages workflow for all
games). `bun run build` is a pure copy so `dist/` is byte-identical to the
game — no bundler by design.

Agent rules and the architecture contract: [AGENTS.md](./AGENTS.md) and
[ARCHITECTURE.md](./ARCHITECTURE.md). The screenshot/console harness lives in
`tools/` (`node tools/shot.mjs --set menu,run,death`).
