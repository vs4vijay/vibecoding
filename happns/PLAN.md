# PLAN — `meetup-lite` (vertically-sliced phases)

Each phase is a **thin, end-to-end working slice** the user can open in a browser and try. We never spend a phase on "just types" or "just scaffolding without UI" — every phase ships something visible.

See [PRD.md](./PRD.md) for stack rationale, scraping strategy, folder layout, and the full file inventory.

---

## Phase 0 — Hello world (scaffold + dev server runs)

**Goal:** A blank Next.js 16 + Tailwind 4 app boots on `bun run dev` and shows a styled "meetup-lite" homepage. Nothing meetup-specific yet — we only prove the toolchain.

**Files**
- `package.json` (Next 16, React 19, Tailwind 4, TS 5; **omit** Prisma/PGlite from starter)
- `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.gitignore`, `next-env.d.ts`
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- `README.md` (one-paragraph description + run instructions + scraping/ToS caveat)
- `AGENTS.md` (rtk + bun conventions, link to PRD)

**Done when**
- `bun install` succeeds
- `bun run dev` serves `http://localhost:3000` with a Tailwind-styled landing page
- `rtk tsc --noEmit` and `rtk lint` both clean

---

## Phase 1 — Event detail page (the thinnest real slice)

**Goal:** Open `/e/<groupSlug>/<eventId>` for a known public Meetup event and render its title, time, venue, host group, going count, and description. This proves the **entire scraping pipeline** end-to-end on the simplest possible target.

**Why this first:** It's the smallest unit where every layer (fetch → parse → type → render) gets exercised. Once it works, search and group pages reuse the same plumbing.

**Files**
- `src/lib/meetup/client.ts` — fetch wrapper with realistic User-Agent, `next: { revalidate: 600 }`, typed `FetchError`
- `src/lib/meetup/parse.ts` — `extractNextData(html)` reads `<script id="__NEXT_DATA__">` and returns `pageProps` + `apolloState`; falls back to `__APOLLO_STATE__`; **returns null on failure, never throws**
- `src/lib/meetup/types.ts` — `Event`, `Group`, `Venue`, `Host`
- `src/lib/meetup/event.ts` — `getEvent(groupSlug, eventId)` → `Event | null`
- `src/components/EventDetail.tsx` — presentational component
- `src/app/e/[groupSlug]/[eventId]/page.tsx` — Server Component; renders `<EventDetail>` or a "not found" state

**Done when**
- Visiting a real Meetup event URL through our app (e.g. `/e/<slug>/<id>` from a hand-picked public event) renders the same core facts you'd see on meetup.com
- A bogus URL renders a friendly "couldn't load this event" message (no 500 page)
- Tailwind styling looks intentional, not unstyled

---

## Phase 2 — Browse events by location

**Goal:** Type a city into the homepage search, get a list of upcoming events you can click into (deep-linking to Phase 1's detail page).

**Files**
- `src/lib/meetup/search.ts` — `searchEvents(location)` scrapes `meetup.com/find/?location=...&source=EVENTS`, returns `Event[]`
- `src/components/LocationSearch.tsx` — `'use client'` form that pushes to `/events?location=...`
- `src/components/EventCard.tsx` — compact card (title, time, group, going count, link)
- `src/components/EventList.tsx` — grid + empty state
- `src/app/page.tsx` — update to show LocationSearch front and center
- `src/app/events/page.tsx` — Server Component; reads `?location=`, calls `searchEvents`, renders `<EventList>`

**Done when**
- From the homepage, entering "San Francisco" (or any populated city) shows a populated grid within ~5s
- Each card links to the Phase 1 detail page and that page loads correctly
- Empty/unknown location renders an empty-state message, not a crash

---

## Phase 3 — Group detail page

**Goal:** Clicking a group name (from an event card or event detail) opens `/g/<urlname>` with the group's name, member count, city, topics, and a list of its upcoming events.

**Files**
- `src/lib/meetup/group.ts` — `getGroup(urlname)` → `{ group: Group, upcomingEvents: Event[] } | null`
- `src/components/GroupHeader.tsx`
- `src/app/g/[groupSlug]/page.tsx` — Server Component; renders header + reuses `<EventList>` from Phase 2

**Done when**
- Clicking the group name on any event card lands on a working group page
- Upcoming events on the group page link back into the event detail
- Unknown group renders friendly not-found

---

## Phase 4 — Save events locally

**Goal:** A bookmark icon on every event card and on the detail page toggles save state, persisted in `localStorage`. A `/saved` page lists what you saved.

**Why localStorage:** Real RSVP would need OAuth, which is out of scope. Saving is the closest user-value action we can ship without auth.

**Files**
- `src/lib/saved.ts` — `useSavedEvents()` hook + `getSaved/toggleSaved/isSaved` helpers; storage key `meetup-lite:saved`; SSR-safe (no `window` access during render)
- `src/components/SaveButton.tsx` — `'use client'`, accepts an `Event` summary, persists `{ id, groupSlug, title, dateTime }` so `/saved` can re-fetch fresh details
- Wire `<SaveButton>` into `EventCard` and `EventDetail`
- `src/app/saved/page.tsx` — `'use client'` page; reads saved list, re-fetches each via a small client `/api/event` route (added now since this is the first client-side fetch need)
- `src/app/api/event/route.ts` — thin proxy: `GET ?groupSlug=&eventId=` → `getEvent(...)`; this is the **first and only** API route we need

**Done when**
- Clicking save on any event card flips icon state immediately
- Refreshing the page preserves the save state
- `/saved` lists every saved event with fresh title/time and link to detail
- Unsaving from `/saved` removes the row without a reload

---

## Phase 5 — Polish, resilience & docs

**Goal:** Stop being a demo, start being a usable little app. No new features — just hardening.

**Tasks**
- Header with brand + nav (Home / Saved) on all pages
- Loading skeletons on search and detail pages (`loading.tsx` files per route)
- `error.tsx` per route for graceful failure
- Mobile-responsive check (cards stack, search input full-width)
- Dark mode via `prefers-color-scheme` (Tailwind 4 supports natively)
- README: features, run instructions, **explicit ToS/scraping disclaimer**, list of known fragility points
- Final pass: `rtk tsc --noEmit` clean, `rtk lint` clean, `rtk next build` succeeds

**Done when**
- App works on a phone-sized viewport
- Forced failures (bad slug, network kill) show friendly UI, never a stack trace
- README is good enough to hand to a stranger

---

## Sequencing notes

- **Phases are strictly ordered.** Each one depends on the previous slice's plumbing.
- **Don't pre-build infrastructure that the current phase doesn't need.** Add the `/api/event` route in Phase 4, not Phase 1. Add caching nuances only when a phase hits the actual problem.
- **Verify at the end of each phase by opening a browser**, not just by running `tsc`. Type checks pass on broken scrapers.
- If `__NEXT_DATA__` extraction fails in Phase 1, **stop and investigate before continuing** — every later phase rests on it.
