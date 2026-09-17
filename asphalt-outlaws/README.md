# Asphalt Outlaws

Pseudo-3D motorcycle racing with fists — a Road Rash–style brawler-racer.
Outrun seven rivals down five highways of increasing hostility, punch and
kick riders off their bikes, dodge oncoming trucks, and don't let the
patrol cars pin you down.

Everything is procedural: Canvas2D rendering, WebAudio engine + sfx, seeded
deterministic sim. No assets, no network play, just you and the asphalt.

**Play online:** <https://vs4vijay.github.io/vibecoding/asphalt-outlaws/>

## Controls

| Key | Action |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake |
| `A` `D` / `←` `→` | steer |
| `J` / `Z` | punch left |
| `K` / `X` | kick right |
| `Enter` | confirm / start |
| `Esc` | pause / back |
| `M` | mute |

## The ladder

| Race | Track | Qualify | Prize |
|---|---|---|---|
| 1 | Pacific Run | top 5 | $1,500 |
| 2 | Dust Devils | top 4 | $3,000 |
| 3 | Sunset Strip (cops!) | top 3 | $5,000 |
| 4 | Canyon Rush | top 3 | $8,000 |
| 5 | Frostbite Pass | top 2 | $12,000 |

Fail a race and you can buy back in for $200. Wreck your bike (health to
zero) or get busted by the cops and the race is over.

## Quickstart

```bash
cd asphalt-outlaws
bun install
bun run dev        # http://localhost:5212
```

`bun run build` typechecks + builds to `dist/`; `bun test` runs the
pure-logic suites (physics, combat, AI, traffic, race flow — 140+ tests).

## Stack

TypeScript strict · Vite · Canvas2D · WebAudio · bun test. See
[`AGENTS.md`](./AGENTS.md) for architecture and invariants,
[`.plan.md`](./.plan.md) for the design spec.
