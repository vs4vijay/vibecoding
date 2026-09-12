# Dangerous Dave — Catacomb Depths

A cinematic 2.5D Three.js remake of the classic Dangerous Dave side-scroller.
Guide Dave through a crumbling underground vault: run, jump, and hover the
jetpack across lava-lit catacombs, grab the gun, dodge spiders, collect
treasure, and reach the exit door of each level.

## Play online

<https://vs4vijay.github.io/vibecoding/dave-dangerous/>

## Quickstart

```sh
bun install
bun run dev        # Vite dev server (http://localhost:5199)
bun run build      # tsc --noEmit (strict) + vite build → dist/
```

## Controls

| Action               | Keys                              |
| -------------------- | --------------------------------- |
| Move                 | `A`/`D` or `←`/`→`                |
| Jump                 | `W` / `↑` / `Space`               |
| Jetpack              | `Ctrl` (either side)              |
| Shoot                | `Shift` or `Alt` (either side)    |
| Start (menu)         | `Enter`                           |
| Menu navigation      | `↑`/`↓` to move, `Enter` to select |
| Pause / resume       | `P` or `Esc`                      |
| Mute / unmute        | `M`                               |
| Restart (game over)  | `R`                               |

## Architecture & testing

```sh
bun run test       # vitest suite (93 tests)
bun run typecheck  # tsc --noEmit
```

The simulation core (`src/core`, `src/world`, `src/entities`, `src/state`,
`src/levels`) is deterministic and fully covered by vitest — physics, input
buffering, enemies, items, levels, and RNG are all pure logic with no DOM. The
presentation layer is separate: Three.js rendering (`src/render3d`) with
procedural PBR textures and camera/post-FX work, plus layered procedural audio
(`src/audio`, WebAudio, no asset files). Rendering and audio changes never
touch the sim core; see `DESIGN.md` for the art direction and module map.
