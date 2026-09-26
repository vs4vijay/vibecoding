# Midtown Blitz

Open-city arcade racing in a procedurally generated downtown — sprint through
checkpoint routes against the clock, thread traffic at 200 km/h, and chase
gold medals. Built with Vite + three.js + vanilla ESM JavaScript; every
visual and sound is generated in code (zero assets).

![genre](https://img.shields.io/badge/genre-open--city%20racing-b3541e)

**Play online:** <https://vs4vijay.github.io/vibecoding/midtown-blitz/>

## The game

- **Blitz races** — three checkpoint routes (Downtown Sprint, Riverside Loop,
  Tower Run) with countdown starts, live timers, world beam markers, an
  edge-arrow guide for off-screen gates, and gold/silver/bronze medal times.
  Best time and highest medal per route persist between sessions.
- **Cruise** — free roam with no objectives or fail state; ambient traffic
  obeys the lane graph, queues behind obstacles, and physically collides.
- **The city** — a deterministic 10×10-block downtown generated fresh each
  load (same seed every run): varied building blocks, raised sidewalks,
  lamp-lit streets, a park, and a 150 m landmark tower for orientation.
- **The car** — arcade bicycle-model handling with speed-sensitive steering,
  handbrake slides, curb hops, impact camera shake, and one-key reset.

## Controls

| input | action |
| --- | --- |
| `W` / `↑` | throttle |
| `S` / `↓` | brake / reverse |
| `A` `D` / `←` `→` | steer |
| `Space` | handbrake |
| `C` | cycle camera (chase / hood) |
| `R` | reset car to nearest road |
| `Esc` | pause (resume / restart / quit) |

## Run locally

```bash
bun install
bun run dev        # http://localhost:5173
bun run test       # 21 pure-logic harnesses (no browser needed)
bun run build      # production build to dist/
```

Add `?debug` to the URL for the debug overlays: input state, audio controls,
quality tier switcher, overhead camera (`V`), a stuck-car wedge (`F`), a
checkpoint test route (`T`), and an fps meter.

## Stack

Plain JavaScript ES modules, three.js ~0.171, Vite 6, Web Audio synthesis
(engine, skid, impacts, chimes, music — no audio files). Design and
implementation history in [`openspec/changes/`](./openspec/changes/).
