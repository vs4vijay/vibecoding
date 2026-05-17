# PRD — Lightweight Meetup.com Client (`meetup-lite`)

## Context

The user wants a lightweight web client for meetup.com using Next.js + Bun. Meetup's official GraphQL API in 2026 requires OAuth + a paid Meetup Pro account — there's no free public access. **The user chose to scrape public meetup.com pages instead** (gray-area but viable for read-only browsing).

Selected MVP features:
- Browse events near a location
- View event details
- Browse / view groups
- Save events locally (RSVP requires auth; we'll implement local-save instead)

The project will live as a new folder `meetup-lite/` in this monorepo, mirroring the stack of `vibecoding-starter` (Next.js 16, React 19, Tailwind 4, Bun, App Router) but **without** the Postgres/Prisma/job-queue layers — those aren't needed for a scraping read-only client.

## Stack

- **Runtime/Pkg mgr:** Bun
- **Framework:** Next.js 16.x (App Router, Server Components default)
- **UI:** React 19 + Tailwind CSS 4 (via `@tailwindcss/postcss`)
- **Language:** TypeScript 5 strict
- **HTTP:** native `fetch` with `next: { revalidate }` for caching
- **Parsing:** `node-html-parser` (lightweight, ~100KB) to extract `__NEXT_DATA__` JSON embedded by meetup.com's own Next.js SSR
- **Local persistence:** `localStorage` (saved events) — no DB

## Scraping Strategy

Meetup.com is itself a Next.js app. Every public page ships its full data inside a `<script id="__NEXT_DATA__">` tag containing JSON. **Parsing this JSON is dramatically more stable than DOM scraping** — we get typed data with the same shape Meetup's own UI uses, and it only breaks when they restructure their Apollo cache (rare).

Fallback if `__NEXT_DATA__` shape changes: there's also `window.__APOLLO_STATE__` embedded that mirrors GraphQL responses; parser will look for both.

Target URLs:
- Event detail: `https://www.meetup.com/<group-urlname>/events/<event-id>/`
- Group detail: `https://www.meetup.com/<group-urlname>/`
- Find events by city: `https://www.meetup.com/find/?location=<city>&source=EVENTS`
- Find groups: `https://www.meetup.com/find/?location=<city>&source=GROUPS`

## Folder Structure

```
meetup-lite/
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── AGENTS.md
├── README.md
├── src/
│   ├── app/
│   │   ├── layout.tsx          # shared header/footer + Tailwind
│   │   ├── page.tsx            # home: location search box
│   │   ├── globals.css
│   │   ├── events/
│   │   │   ├── page.tsx        # event list (Server Component, reads ?location=)
│   │   │   └── [groupSlug]/[eventId]/page.tsx
│   │   ├── groups/
│   │   │   └── [groupSlug]/page.tsx
│   │   └── saved/
│   │       └── page.tsx        # client component, reads localStorage
│   ├── components/
│   │   ├── EventCard.tsx
│   │   ├── EventList.tsx
│   │   ├── GroupCard.tsx
│   │   ├── LocationSearch.tsx  # 'use client' input + form
│   │   ├── SaveButton.tsx      # 'use client' localStorage toggle
│   │   └── Header.tsx
│   └── lib/
│       └── meetup/
│           ├── client.ts       # fetch wrapper: UA header, revalidate cache
│           ├── parse.ts        # extract __NEXT_DATA__ → typed objects
│           ├── types.ts        # Event, Group, Venue, Host
│           ├── search.ts       # searchEvents(location), searchGroups(location)
│           ├── event.ts        # getEvent(groupSlug, eventId)
│           └── group.ts        # getGroup(groupSlug)
```

## Key Implementation Notes

**`src/lib/meetup/client.ts`** — single fetch wrapper. Sets a realistic User-Agent (Meetup blocks default fetch UAs), uses `next: { revalidate: 600 }` so we cache scraped pages for 10 min, surfaces non-200 responses as typed errors.

**`src/lib/meetup/parse.ts`** — `extractNextData(html)`: regex/parse for `<script id="__NEXT_DATA__" type="application/json">` payload, returns `props.pageProps` plus `props.apolloState`. The Apollo cache is keyed by GraphQL `__typename` + id, which makes lookups for `Event:...`, `Group:...`, `Venue:...` straightforward.

**`src/lib/meetup/types.ts`** — minimal interfaces matching only the fields we render: Event (id, title, dateTime, venue, group, eventUrl, description, going), Group (urlname, name, memberCount, city, topics, upcomingEventCount), Venue (name, city, country).

**Server Components do the fetching.** No API routes needed — pages fetch directly. This is the canonical App Router pattern and keeps the surface area minimal.

**Saved events (client-only):**
- `src/lib/saved.ts` — small helper exporting `useSavedEvents()` hook with `getSaved/toggleSaved/isSaved` against `localStorage['meetup-lite:saved']`
- `SaveButton` is a client component sitting on EventCard and event detail page
- `/saved` page renders saved-event ids; for each, we still hit the meetup scrape to get fresh data (cached)

## Critical Files to Create

| File | Purpose |
|------|---------|
| `meetup-lite/package.json` | Mirror vibecoding-starter deps minus Prisma/PGlite; add `node-html-parser` |
| `meetup-lite/src/lib/meetup/client.ts` | Fetch + caching foundation |
| `meetup-lite/src/lib/meetup/parse.ts` | `__NEXT_DATA__` extractor — the heart of the scraper |
| `meetup-lite/src/lib/meetup/search.ts` | List events/groups by location |
| `meetup-lite/src/app/events/page.tsx` | Search-results entry route |
| `meetup-lite/src/app/events/[groupSlug]/[eventId]/page.tsx` | Event detail |
| `meetup-lite/src/app/groups/[groupSlug]/page.tsx` | Group detail |
| `meetup-lite/src/components/LocationSearch.tsx` | Simple location text input |
| `meetup-lite/src/components/SaveButton.tsx` | localStorage save toggle |

## Conventions to Follow

- Use **bun** not npm (per repo AGENTS.md)
- Use **rtk** prefix on all build/lint commands during development (per repo AGENTS.md)
- App Router only, Server Components default; add `'use client'` only where needed (search input, save button, /saved page)
- Path alias `@/*` → `./src/*` (matches starter)
- Strict TypeScript, no `any`
- No DB, no API routes for MVP — server components fetch directly

## Verification

1. **Install:** `cd meetup-lite && bun install`
2. **Dev:** `bun run dev` → opens at http://localhost:3000
3. **Smoke test scraping:** in browser, visit `/events?location=San+Francisco` — should render event cards within 5s
4. **Event detail:** click a card → renders title, venue, time, host group, description, going count
5. **Group page:** click group name on event card → group detail with upcoming events
6. **Save flow:** click save on an event → reload → visit `/saved` → event appears
7. **Type check:** `rtk tsc --noEmit`
8. **Lint:** `rtk lint`
9. **Resilience check:** confirm graceful error UI when (a) location returns no results, (b) meetup returns 404 / parser fails

## Out of Scope (MVP)

- Real RSVP (would require OAuth)
- Authentication / user profiles
- Hosting events
- Photos beyond hero image
- Comments
- Server-side persistence of saved events (using localStorage instead)
- i18n / multi-language

## Risk Notes

- Meetup's `__NEXT_DATA__` schema can change without notice. The parser should fail soft (return `null` and let pages render an empty state) rather than throwing.
- Scraping likely violates Meetup ToS — user has been informed and chose this path. Worth noting in README.
- Rate limiting: rely on Next's revalidate cache (10 min) to keep request volume low.
