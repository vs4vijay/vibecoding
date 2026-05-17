# AGENTS — happns

A lightweight multi-source event aggregator (Meetup + Luma today; GDG + HasGeek planned). Previously called `meetup-lite`. The directory is still named `meetup-lite/` — the rename is package/branding only for now.

See [PRD.md](./PRD.md) for the original Meetup-only rationale and [PLAN.md](./PLAN.md) for the historical phased build plan. The current state is **post-pivot**: read this file plus the README for an accurate picture.

## Conventions

- Use **bun**, never npm. `bun install`, `bun run dev`, `bun run build`.
- Prefix dev/CI commands with **rtk** (see root AGENTS.md). RTK silently masks build failures — for verification runs, prefer `bun run build` and `bunx tsc --noEmit` directly.
- App Router, Server Components by default. Add `'use client'` only when interactivity demands it (search input, save button, filters, /saved page).
- Strict TypeScript — no `any`. Adapters return `null` / empty arrays on failure rather than throwing.
- Path alias: `@/*` → `./src/*`.
- Dev server runs on **port 3300**, not 3000.
- Don't run `bun run build` while `bun run dev` is running — they fight over `.next/`.

## Source adapter pattern

Every event source is a `SourceAdapter` (see `src/lib/sources/types.ts`):

```ts
interface SourceAdapter {
  id: SourceId;
  label: string;
  description: string;
  searchEvents(query: SearchQuery): Promise<Event[]>;
  getEvent?(slug: string, eventId: string): Promise<Event | null>;
  getGroup?(slug: string): Promise<GroupPageData | null>;
}
```

- Add a new source: create `src/lib/sources/<id>/` with its own `client.ts`, `parse.ts`, `normalize.ts`, `search.ts`, `index.ts`, then push the exported adapter onto `SOURCES` in `src/lib/sources/registry.ts`.
- Every adapter must swallow its own errors. The multi-source fan-out uses `Promise.allSettled` so one source's crash doesn't sink the feed, but adapters that throw waste a retry cycle.
- Every `Event` must carry `source: SourceId`. Optional `detailHref` is the internal app route; when absent, cards open `eventUrl` externally in a new tab.

## Scraping foundation per source

- **Meetup** — `src/lib/sources/meetup/`. `__NEXT_DATA__` → `pageProps.__APOLLO_STATE__`. Apollo cache keyed by `Event:<id>`, `Group:<id>`, etc. Connection fields use inline-stringified args (`rsvps({"filter":{"rsvpStatus":["YES"]}})`).
- **Luma** — `src/lib/sources/luma/`. `__NEXT_DATA__` → `pageProps.initialData.data.events` (or `featured_items` on curated-calendar URLs). City slug is inconsistent across cities; `CITY_ALIASES` map covers the common ones, with `/discover/<slug>` as fallback.

## Routes

- `/`, `/events`, `/e/<groupSlug>/<eventId>` (Meetup-only), `/g/<groupSlug>` (Meetup-only), `/saved`, `/api/event` (Meetup detail proxy).
- Luma events use `eventUrl` directly (external). Internal Luma detail pages are not built yet.
