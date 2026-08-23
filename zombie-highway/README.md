# Undead Highway

Endless zombie-driving arcade game for the browser. Auto-throttle down a
divided desert highway at dusk; zombies lurk on the shoulders, telegraph, and
leap at your car. Shoot them off, graze them into obstacles, or dodge — but
keep the weight balanced or the car flips.

## Quickstart

```sh
bun install
bun run dev        # dev server
bun run build      # production build → dist/
```

`bun run build` emits fully static files in `dist/` — serve them from any
static file server (`vite preview`, nginx, S3, …). No backend required.

## Controls

| Action         | Touch                        | Desktop      |
| -------------- | ---------------------------- | ------------ |
| Steer          | horizontal drag anywhere     | A/D or ←/→   |
| Shoot left     | tap left half (<200 ms)      | `,`          |
| Shoot right    | tap right half (<200 ms)     | `.`          |
| Pause          | pause button                 | Esc/P        |
| Start/restart  | big button                   | Space/Enter  |

## Tuning

Every gameplay constant — speeds, weights, gun stats, spawn cadence, scoring,
difficulty curve, camera — lives in [`src/config.ts`](src/config.ts).

## Development

```sh
bun run test       # vitest suite
bun run typecheck  # tsc --noEmit
```

Stack: TypeScript, Vite, three.js. Fixed 60 Hz simulation decoupled from
render; pooled entities throughout.
