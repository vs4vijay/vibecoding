# meetup-lite

A lightweight read-only web client for public [meetup.com](https://meetup.com) events and groups, built with Next.js 16, React 19, Tailwind 4, and Bun.

Meetup's official GraphQL API requires OAuth + a paid Pro account. Instead, this app extracts the `__NEXT_DATA__` JSON payload that meetup.com's own Next.js SSR embeds in every public page. It is **read-only** — no RSVP, no auth, just browsing.

## Features

- **Search events by city** — type a city, get a grid of upcoming events
- **Event detail pages** — title, time, venue, host group, going count, description, photo
- **Group detail pages** — name, member count, topics, description, upcoming events
- **Save events locally** — bookmark events to `localStorage`; view them on `/saved`
- **Graceful failures** — per-route `loading.tsx` skeletons and `error.tsx` fallbacks; the parser returns `null` rather than throwing when Meetup's schema shifts
- **Server-side caching** — every meetup.com fetch is cached for 10 minutes via Next.js `revalidate`

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
|-------|---------------|
| `/` | Home with city search |
| `/events?location=<city>` | Event grid for a location |
| `/e/<groupSlug>/<eventId>` | Single event detail |
| `/g/<groupSlug>` | Group detail + upcoming events |
| `/saved` | Your locally bookmarked events |
| `/api/event?groupSlug=…&eventId=…` | JSON proxy used by `/saved` for fresh data |

## ToS / scraping caveat

This project scrapes public meetup.com pages, which is a gray area under Meetup's Terms of Service. It is intended for **personal/educational use only**. If you're considering deploying this publicly or commercially, you should use the official Meetup API (which requires OAuth + a paid Meetup Pro account) instead.

## Known fragility points

The whole app rests on a thin scraping foundation. The places most likely to break:

- **`src/lib/meetup/parse.ts`** — relies on meetup.com embedding `__NEXT_DATA__` on every page with `pageProps.__APOLLO_STATE__`. If Meetup ships a different SSR strategy (e.g., RSC streaming) this returns `null` and every page renders an empty state.
- **Apollo cache keys with inline args** — the `going` count lives at `rsvps({"filter":{"rsvpStatus":["YES"]}}).totalCount`, and group upcoming events live at a similarly stringified key. If Meetup changes those argument shapes, the values disappear.
- **Location resolution** — Meetup's `/find/?location=…` endpoint can geo-bias results based on the request's IP. Free-text city names work, but quality varies; canonical Meetup location slugs (e.g. `us--ca--san-francisco`) give the best results.
- **Rate limiting** — Meetup may block aggressive scraping. The default User-Agent is a real Chrome string and all fetches go through a 10-minute revalidate cache to keep volume low.

## Architecture

```
src/
├── app/                  # App Router pages
│   ├── e/[groupSlug]/[eventId]/   # Event detail
│   ├── g/[groupSlug]/    # Group detail
│   ├── events/           # Search results
│   ├── saved/            # Local bookmarks (client component)
│   └── api/event/        # JSON proxy used by /saved
├── components/           # Presentational + small client components
└── lib/
    ├── meetup/
    │   ├── client.ts     # fetch wrapper (UA header, revalidate cache)
    │   ├── parse.ts      # __NEXT_DATA__ / Apollo extractor
    │   ├── types.ts      # Event / Group / Venue / Host
    │   ├── event.ts      # getEvent(groupSlug, eventId)
    │   ├── group.ts      # getGroup(urlname)
    │   └── search.ts     # searchEvents(location)
    └── saved.ts          # localStorage-backed useSavedEvents hook
```

Server Components do all scraping. The only API route (`/api/event`) exists solely so the client-only `/saved` page can re-fetch fresh data for stored event IDs.
