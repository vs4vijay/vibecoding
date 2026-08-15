<!-- GSD:project-start source:PROJECT.md -->

## Project

**RagChat**

A personal web app that imports WhatsApp chat exports, organizes them by group or contact, and provides chat-style viewing with keyword search and AI-powered Q&A. Designed as a single-user archive that grows with every export import — drag-drop a .txt file and instantly search your conversation history.

**Core Value:** Import WhatsApp exports and instantly search/query your conversation history.

### Constraints

- **Storage**: Must run entirely client-side using IndexedDB or equivalent — no backend server
- **Import**: Must handle standard WhatsApp .txt export format
- **Portability**: Data model should support future migration to cloud/export

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **SvelteKit** | 2.x (Svelte 5) | App framework, routing, PWA shell | Compiles to minimal JS at build time — no virtual DOM overhead. Built-in service worker support via `src/service-worker.js`. Stores are built-in (no Redux/Zustand dependency). For a single-user client-only app, SvelteKit produces smaller bundles than React/Next.js with less boilerplate. Svelte 5's runes API (`$state`, `$derived`) replaces the old `$:` reactive syntax with explicit reactivity. |
| **Dexie.js** | 4.x | IndexedDB wrapper for chat data persistence | Schema versioning with declarative migrations, full transactions across multiple object stores, `liveQuery()` for reactive UI binding. **WhatsApp Web itself uses Dexie.js under the hood** — same storage patterns apply here. v4.4.2 released March 2026, actively maintained. ~26 KB gzipped but worth it for the migration safety and query ergonomics. |
| **@orama/orama** | 3.x | Full-text search (v1) + vector search (future RAG) | Only library that does both full-text BM25 search AND vector/hybrid search in a single 2 KB zero-dependency package. v1 uses `mode: 'fulltext'` for keyword search. Future RAG phase keeps the same index, just adds `mode: 'vector'` embeddings — no database migration. Built-in `AnswerSession` for RAG chat generation. Published consistently (v3.2.0 June 2026). |
| **Tailwind CSS** | 4.x | Utility-first styling for chat UI | Chat bubbles, timestamps, and sender labels are a layout problem Tailwind solves trivially with flexbox utilities. v4 uses the CSS-first configuration model (no `tailwind.config.js` needed for most cases) and ships as a single PostCSS plugin. JIT compilation produces tiny production CSS. |
| **Vite** | 6.x | Dev server, bundler | Bundled with SvelteKit by default. The HMR is instant, and the production build tree-shakes effectively. SvelteKit's `adapter-static` produces a fully static site (no server runtime). |
| **vite-plugin-pwa** | 1.x | PWA manifest + service worker generation | Zero-config Workbox integration. Handles precaching, runtime caching, and manifest generation. Supports SvelteKit out of the box. v1.3.0 released May 2026 (actively maintained by Anthony Fu and team). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **date-fns** | 4.x | Timestamp formatting for chat UI | Format dates into "Yesterday", "12:30 PM", "14 Jun 2026" etc. Tree-shakeable — only import the functions you need. |
| **@xenova/transformers** | 2.x | Client-side embedding generation (RAG phase) | For future RAG phase only. Runs ONNX models (e.g. `all-MiniLM-L6-v2`) in-browser via WebAssembly. Embeddings feed into Orama's vector search. |
| **Vitest** | 3.x | Unit + integration testing | Native Vite integration, same transform pipeline as the app. Fast, Jest-compatible API, built-in coverage. |
| **Playwright** | 1.x | E2E testing | For testing the import flow end-to-end: drag-drop a .txt file → verify messages render. Can test IndexedDB state directly. |
| **Biome** | 1.x | Linting + formatting | Faster than ESLint + Prettier combined. Single binary, no config file needed for defaults. Formats, lints, and sorts imports in one command. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **Bun** | Package manager + runtime | Per project conventions (AGENTS.md: "make use of `bun` instead of `npm`"). Install deps with `bun install`, run scripts with `bun run`. |
| **TypeScript** | Type safety | SvelteKit + Dexie + Orama all have first-class TS support. The data model (Message, Conversation, Attachment types) benefits strongly from static typing. |
| **@sveltejs/adapter-static** | Static site generation | Since the app is fully client-side (no server), this adapter pre-renders the shell HTML and serves it from any static host. No Node.js server needed. |

## Installation

# Core framework + static adapter

# Add storage and search

# UI and formatting

# PWA support

# Dev tooling

# Future RAG (install when phase arrives)

# bun add @xenova/transformers

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **SvelteKit** | **React + Next.js** | Your team already knows React and you need the broader ecosystem (Radix UI, TanStack Table, etc). For a single-user chat app, Next.js adds ~80 KB more JS than SvelteKit with no benefit. |
| **SvelteKit** | **Vanilla JS + Vite** | The data set is small enough (< 10 conversations) that you don't need routing or component hydration. SvelteKit overhead is ~15 KB gzipped — worth it for maintainability. |
| **Dexie.js** | **idb (Jake Archibald)** | You need only basic key-value storage with zero frills. idb adds ~1.2 KB vs Dexie's ~26 KB. The tradeoff is no schema versioning, no transactions, and manual migration code. For a data model that WILL evolve (adding message types, attachment metadata), Dexie's migration API saves real debugging time. |
| **@orama/orama** | **MiniSearch** | You want the simplest possible full-text search for v1 and are comfortable migrating to a different vector search solution for RAG later. MiniSearch is easier to set up for keyword-only search. Orama is the strategic pick — one library for both phases. |
| **@orama/orama** | **Fuse.js** | You only need fuzzy string matching on short fields (searching contact names, not message bodies). Fuse.js has no indexing — it scans every record on every search. Unacceptable for 10K+ message datasets. |
| **Tailwind CSS** | **CSS Modules** | You prefer co-located CSS files and don't want utility classes in HTML. Valid aesthetic preference, but chat UI has many small layout variations (bubble alignment, timestamps, media placeholders) where Tailwind's utility model reduces total CSS. |
| **Biome** | **ESLint + Prettier** | You need ESLint's plugin ecosystem (React-specific rules, etc). For a SvelteKit project, Biome covers linting + formatting + import sorting in one tool with 10× the speed. Svelte support in Biome is mature. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **React** | Overkill for a single-user client-only app. React 19 still ships ~40 KB runtime + virtual DOM overhead. Svelte 5 compiles away the framework entirely — the output is vanilla JS. React's ecosystem advantage (component libraries, hooks) doesn't help a chat app that needs custom bubble UI anyway. | SvelteKit |
| **Redux / Zustand / Pinia** | Svelte has built-in stores (`$state`, `$derived`, writable stores). Adding a state management library is dead weight — Svelte's reactivity IS the state manager. | Svelte stores (built-in) |
| **RxDB** | Feature-rich but over-engineered for this use case. RxDB is designed for multi-tab sync, replication, and Observed-based reactivity at the database level. For a single-user IndexedDB app, the schema system adds complexity without benefit. Dexie's `liveQuery()` provides the same reactive binding without the RxDB abstraction tax. | Dexie.js |
| **whatsapp-chat-parser (npm)** | Last published Sep 2024 (v4.0.2). The WhatsApp export format is a simple regex (`/^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2}(?:\s?[AP]M)?) - ([^:]+): (.*)$/`) with multi-line continuations. Writing a custom parser is ~40 lines of TypeScript vs. importing a +4 KB dependency that hasn't been updated in 2 years. The custom parser also lets you control date format detection and message type classification. | Custom parser (~40 lines of TypeScript) |
| **localForage** | Maintenance mode since 2021. No schema, no indexes, no queries — just key-value. For a message database that needs timestamp-range queries and full-text search, localForage is the wrong abstraction layer. | Dexie.js |
| **Lodash** | Date formatting and array operations are covered by built-in JS methods + date-fns. Lodash's `_.groupBy` and `_.orderBy` are each ~50 lines — not worth the full library import. | date-fns + native Array methods |
| **Webpack** | Vite is SvelteKit's default bundler. Webpack config for Svelte is non-trivial and significantly slower for HMR. There's no reason to use it. | Vite (via SvelteKit) |

## Stack Patterns by Variant

- Replace `@orama/orama` with **MiniSearch** (v7.x). Simpler API for pure full-text, no vector overhead. Orama is still fine but MiniSearch is simpler if you'll never need vectors.
- Use **React 19 + Vite** (not Next.js). For a fully client-side app, Next.js adds SSR infrastructure you won't use. Use `react-router` v7 for routing. Keep Dexie.js and Orama — they're framework-agnostic. Add `@tanstack/react-query` for reactive IndexedDB reads (bridges Dexie callbacks to React re-renders).
- Upgrade Dexie.js to **RxDB** or **Dexie Cloud**. Dexie Cloud adds real-time sync as a paid add-on. RxDB is free and open source. This is a future concern — not needed for v1.
- Keep Dexie.js for storage (it handles 100K+ records). For search, consider moving from Orama in-memory index to an **Orama persisted index** (store the serialized index in Dexie). For vector search at this scale, server-side becomes more practical.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `svelte@5` | `@sveltejs/kit@2`, `@sveltejs/adapter-static@3` | Svelte 5 uses runes API. SvelteKit 2 supports both legacy and runes mode — use runes for new projects. |
| `dexie@4.x` | All browsers with IndexedDB | Dexie 4 has breaking changes from Dexie 3 (new `dexie-cloud-addon` API). Use `dexie@4.4+` for the latest stable. |
| `@orama/orama@3.x` | All modern browsers, no deps | v3 has a different API from v2 (new `create` returns a promise). Do NOT install `@orama/orama@2.x`. |
| `vite-plugin-pwa@1.x` | `@sveltejs/kit@2`, `vite@5/6/7/8` | v1 requires `workbox-build@7` as a peer dependency. Explicitly install it: `bun add -D workbox-build`. |
| `tailwindcss@4` | `vite@5/6`, `@tailwindcss/vite` plugin | v4 uses CSS-first config (`.css` file with `@import "tailwindcss"`). No `tailwind.config.js` needed. Import `tailwindcss` PostCSS plugin or use `@tailwindcss/vite`. |
| `@xenova/transformers@2` | Browser with WebAssembly support | Model files (~23 MB for `all-MiniLM-L6-v2`) cache in browser Cache API after first load. Works in all modern browsers. WebGPU reduces inference time 5-10× but is optional. |

## Sources

- **SvelteKit docs** — https://kit.svelte.dev/docs — Verified SSR/PWA patterns. Svelte 5 runes API migration guide.
- **Dexie.js v4 docs** — https://dexie.org/docs — Schema versioning, liveQuery, transaction API. v4 changelog.
- **Orama docs** — https://docs.orama.com/docs/orama-js — Full-text + vector search API, AnswerSession RAG pipeline.
- **vite-plugin-pwa docs** — https://vite-pwa-org.netlify.app/ — SvelteKit integration, Workbox strategies.
- **Tailwind CSS v4 docs** — https://tailwindcss.com/docs — CSS-first configuration, Vite plugin.
- **WhatsApp export format analysis** — https://www.whatsquiz.com/blog/whatsapp-chat-export-file-format/ — Canonical regex pattern, date format variants, multi-line message handling.
- **Client-side RAG survey** — https://deepap.dev/blogs/client-side-rag-browser-ai — Transformers.js + WebGPU performance benchmarks, IndexedDB vector storage patterns.
- **Orama browser vector search demo** — https://nearform.github.io/vector-search-web/ — Production example of Orama in browser with Transformers.js embeddings. Published Feb 2026 by Nearform.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| skill-creator | Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy. | `.agents/skills/skill-creator/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
