# happns

A lightweight read-only browser for public community events. Built with Next.js 16, React 19, Tailwind 4, and Bun.

Today **happns** aggregates events from **Meetup** and **Luma**. GDG, HasGeek and more are on the roadmap. The strategy is the same for every source: extract the JSON payload that each platform's own SSR already embeds in its public pages (typically `__NEXT_DATA__`) and normalize it into a single `Event` shape. No accounts, no login walls, no API keys.

> Previously known as `meetup-lite` while the app was Meetup-only.

## Sources today

| Source | Status | Method |
|---|---|---|
| Meetup | ✅ live | `__NEXT_DATA__` → Apollo cache |
| Luma | ✅ live | `__NEXT_DATA__` → `pageProps.initialData.data.events` |
| GDG (`gdg.community.dev`) | 🚧 planned | `__NEXT_DATA__` → `prerenderData.upcomingEvents` |
| HasGeek | 🚧 planned | DOM scraping of the homepage + project pages |
| Sahaj.ai | ⏸ deferred | Page is almost entirely past events |

## Features

- **Search across sources** — type a city, get one merged feed of upcoming events
- **Source badges** — every card shows where it came from (Meetup red, Luma purple)
- **Time filter** — Today / This week / This weekend / This month
- **Category filter (Meetup)** — multi-select category chips powered by Meetup's keyword search; OR-merged across categories
- **Event detail pages** (Meetup) — title, time, venue, host group, going count, description, photo
- **Group detail pages** (Meetup) — name, member count, topics, description, upcoming events
- **Save events locally** — bookmark events to `localStorage`; view them on `/saved`
- **Graceful failures** — per-route `loading.tsx` skeletons and `error.tsx` fallbacks; if one source dies the rest still render
- **Server-side caching** — every upstream fetch is cached for 10 minutes via Next.js `revalidate`

## Run locally

```bash
bun install
bun run dev
```

Open <http://localhost:3300>.

## Scripts

- `bun run dev` — start the dev server on port 3300
- `bun run build` — production build
- `bun run start` — run the production build
- `rtk tsc --noEmit` — type check
- `rtk lint` — lint

## Routes

| Route | What it shows |
|---|---|
| `/` | Home with city search |
| `/events?location=<city>&categories=…&when=…` | Multi-source event grid |
| `/e/<groupSlug>/<eventId>` | Meetup event detail |
| `/g/<groupSlug>` | Meetup group detail |
| `/saved` | Your locally bookmarked events |
| `/api/event?groupSlug=…&eventId=…` | JSON proxy used by `/saved` for fresh Meetup data |

Luma events open externally to luma.com — internal detail pages for Luma are not built yet.

## Architecture

```
src/
├── app/                  # App Router pages
└── lib/
    ├── sources/
    │   ├── types.ts      # Shared Event, Group, Venue, Host, SourceAdapter, SourceId
    │   ├── registry.ts   # SOURCES + searchAcrossSources(adapters, query)
    │   ├── meetup/       # client.ts, parse.ts, event.ts, group.ts, search.ts, categories.ts, index.ts (meetupAdapter)
    │   └── luma/         # client.ts, parse.ts, normalize.ts, search.ts, index.ts (lumaAdapter)
    ├── timeWindow.ts     # Time-window filter helper (source-agnostic)
    └── saved.ts          # localStorage-backed useSavedEvents hook
```

Each source implements a single `SourceAdapter` interface with `searchEvents`, and optionally `getEvent` / `getGroup`. The `/events` page fans out to every registered adapter via `Promise.allSettled`, dedupes by `${source}:${id}`, and sorts by date. One source failing never sinks the rest.

## ToS / scraping caveat

This project scrapes public pages on Meetup, Luma, and other providers. It's a gray area under most of their Terms of Service. Intended for **personal/educational use only**. If you're considering deploying this publicly or commercially, you should switch to each provider's official API.

## Known fragility points

- **Schema drift** — each source's parser depends on the shape of the embedded JSON they ship. When they restructure their cache, the relevant adapter returns empty and the source quietly disappears from the feed (other sources keep working).
- **Apollo cache keys with inline args (Meetup)** — `going` count lives at `rsvps({"filter":{"rsvpStatus":["YES"]}}).totalCount`; if Meetup changes that arg shape the value disappears.
- **City slug mapping (Luma)** — Luma's `/<city>` pages aren't uniformly named: `bangalore→bengaluru`, `san francisco→sf`, `new york→nyc`. See `src/lib/sources/luma/search.ts:CITY_ALIASES`.
- **Rate limiting** — every adapter sets a realistic User-Agent and routes through Next's 10-minute revalidate cache to keep request volume low.
