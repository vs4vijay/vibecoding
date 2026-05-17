# AGENTS — meetup-lite

See [PRD.md](./PRD.md) for product/architecture rationale and [PLAN.md](./PLAN.md) for the phased build plan.

## Conventions

- Use **bun**, never npm. `bun install`, `bun run dev`, `bun run build`.
- Prefix dev/CI commands with **rtk** (see root AGENTS.md).
- App Router, Server Components by default. Add `'use client'` only when interactivity demands it (search input, save button, /saved page).
- Strict TypeScript — no `any`. Parser returns `null` on failure rather than throwing.
- Path alias: `@/*` → `./src/*`.
- No database, no API routes for MVP unless a phase explicitly requires one (only `/api/event` in Phase 4).

## Scraping foundation

All meetup.com requests go through `src/lib/meetup/client.ts` (single User-Agent, `next: { revalidate: 600 }`). Parsing is centralized in `src/lib/meetup/parse.ts` — read `__NEXT_DATA__`, fall back to `__APOLLO_STATE__`, and return `null` if both fail. Higher-level functions (`getEvent`, `getGroup`, `searchEvents`) should never re-implement HTTP or HTML parsing themselves.
