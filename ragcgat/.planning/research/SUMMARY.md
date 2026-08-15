# Project Research Summary

**Project:** RagChat
**Domain:** WhatsApp Chat Export Parser + RAG Web App (Client-Side PWA)
**Researched:** 2026-07-28
**Confidence:** HIGH

## Executive Summary

RagChat is a personal WhatsApp chat archive viewer that combines three capabilities no existing tool offers together: **persistent local storage** (survives browser sessions), **chat-style browsing** (WhatsApp Web-like UI), and **AI-powered Q&A** (future RAG phase). The competitive landscape has viewers (WhatsApp Backup Viewer, whats-reader) and AI tools (ThreadRecap, Lucen) but no player bridges persistent multi-chat browsing with semantic question-answering over the user's archive. The entire product runs client-side — no server, no uploads, no backend.

The recommended approach is a **SvelteKit + Dexie.js + Orama** stack. SvelteKit compiles to minimal JavaScript at build time (eliminating virtual DOM overhead) and its built-in stores remove the need for Redux/Zustand. Dexie.js provides schema-versioned IndexedDB persistence with reactive `liveQuery()` bindings. Orama handles both full-text keyword search (v1) and future vector search (RAG) in a single 2 KB package — no database migration needed when adding semantic search. A custom WhatsApp export parser (~40 lines of TypeScript) replaces abandoned npm packages, giving full control over date format detection and message type classification.

**Key risks** center on the parser and storage layers. WhatsApp exports have 14+ timestamp format families and 40+ locale-dependent system message patterns — the parser must be format-tolerant from day one, as retrofitting is a data-corruption risk. IndexedDB writes must be batched (500–1000 messages per transaction) or imports of 100K+ messages will take minutes instead of seconds. The search index must use persistent storage (FlexSearch with IndexedDB adapter or SQLite WASM FTS5) to avoid the 200–500 MB in-memory heap blowout seen in real-world projects. All three risks are manageable with up-front architecture decisions documented in the research.

## Key Findings

### Recommended Stack

The stack research recommends a minimal, framework-agnostic core with four primary dependencies. SvelteKit is the framework choice over React/Next.js because it produces ~15 KB gzipped bundles vs React's ~40 KB runtime with no SSR benefit for a fully client-side app. Dexie.js is the IndexedDB wrapper — it provides schema versioning with declarative migrations and `liveQuery()` for reactive UI binding, and critically, **WhatsApp Web itself uses Dexie.js under the hood**, proving its suitability for this data shape. Orama is the strategic pick for search: it does both full-text BM25 and vector/hybrid search in a single package, so the v1 keyword search infrastructure seamlessly graduates to semantic search in the RAG phase.

**Core technologies:**
- **SvelteKit 2.x (Svelte 5)**: App framework — compiles to minimal JS, built-in stores, static site generation via `adapter-static`
- **Dexie.js 4.x**: IndexedDB wrapper — schema versioning, transactions, `liveQuery()` for reactive UI, WhatsApp Web's own storage layer
- **@orama/orama 3.x**: Full-text + vector search — single 2 KB package does both BM25 keyword search (v1) and embeddings-based vector search (future RAG)
- **Tailwind CSS 4.x**: Utility-first styling — chat bubbles, timestamps, sender labels solved trivially with flexbox; CSS-first config model
- **Vite 6.x**: Dev server + bundler — bundled with SvelteKit, instant HMR, tree-shaking
- **vite-plugin-pwa 1.x**: PWA manifest + service worker generation — Workbox integration, manifests, runtime caching

**Supporting libraries:**
- **date-fns 4.x**: Tree-shakeable timestamp formatting for chat UI
- **Biome 1.x**: Linting + formatting — faster than ESLint + Prettier combined
- **Vitest 3.x / Playwright 1.x**: Unit and E2E testing
- **@xenova/transformers 2.x** (future RAG phase only): Client-side ONNX embedding via WebAssembly

**What NOT to use:**
- React/Next.js — overkill for a client-only app, adds ~40 KB runtime overhead
- Redux/Zustand — Svelte stores are built-in and sufficient
- RxDB — feature-rich but over-engineered for single-user IndexedDB
- `whatsapp-chat-parser` npm package — unmaintained since 2024, custom parser is ~40 lines and more controllable
- localForage — maintenance mode since 2021, no schema or indexes
- Lodash — tree-shakeable native JS + date-fns covers everything needed

### Expected Features

The competitive landscape falls into four categories: browser-based viewers, desktop offline apps, analysis/statistics tools, and AI recap tools. RagChat occupies a **unique intersection** of persistent local-first archive + chat-style viewing + AI Q&A that no existing tool combines well. The research uses a 15-tool competitive analysis to validate priorities.

**Must have (P1 — launch):**
- **WhatsApp .txt/.zip import**: Drag-drop + file picker; accept both text-only and ZIP-with-media exports
- **Multi-format parser**: Handle iOS bracketed and Android dash-separated formats across 14+ locale variants
- **Chat-style bubble UI**: WhatsApp Web visual language with green/gray bubbles, sender labels, timestamps
- **Full-text keyword search**: Instant search with match highlighting and result navigation
- **Group chat support**: Sender name parsing and labeling for group exports
- **Light/dark mode**: System preference detection with manual toggle
- **Local-only processing**: All parsing in-browser via FileReader/JSZip; no uploads
- **Import preview**: Show first N messages after parsing; let user confirm before committing
- **Basic conversation sidebar**: List of imported chats sorted by most recent message
- **Media placeholders**: Render `<Media omitted>`, filenames, and locale variants as typed placeholders

**Should have (P2 — differentiators):**
- **Persistent IndexedDB storage**: Cross-session access, incremental imports (most viewers re-parse every visit)
- **Multiple conversation management**: Store and switch between multiple chats
- **Bookmarks / saved messages**: Per-message bookmark toggle with dedicated filter view
- **Calendar / timeline navigation**: Jump to a specific date or month; date-picker
- **Analytics dashboard**: Message counts, activity heatmaps, sender breakdowns, trends
- **Cross-chat search**: Full-text search across all imported conversations at once

**Defer (v2+):**
- AI-powered Q&A (RAG) — deferred per PROJECT.md, requires persistence + full-text search + AI model integration
- Chat merge / deduplication — complex interleaving and deterministic dedup from multiple source files
- Voice note transcription (Whisper) — requires WebGPU + Transformers.js
- PDF / HTML export — self-contained conversation snapshots
- PWA / share target — installability; receiving exports from WhatsApp's share sheet

### Architecture Approach

The architecture follows a **layered, feature-module pattern** with four tiers: Presentation (Svelte components), Composition/Orchestration (app shell + state coordinator), Service Layer (import, search, chat query services), and Persistence (IndexedDB via Dexie.js repositories). All CPU-intensive work (parsing) is offloaded to a **Web Worker** from day one. The architecture is designed around a clear dependency chain: Parser Library → DB Schema + Repositories → Import Feature → Chat Browsing → Search → RAG, where each phase builds on the previous without requiring rewrites.

**Major components:**
1. **Parser Web Worker + lib/parser/** — Pure logic for format detection, line parsing, multiline grouping, message classification. Zero UI imports, testable in isolation, runs off-main-thread. Framework-agnostic by design.
2. **IndexedDB Repository Layer (db/)** — Typed repository classes (`ChatRepository`, `MessageRepository`, `SearchRepository`) encapsulating all Dexie.js access. The rest of the app never touches raw IndexedDB. Schema versioning in migrations.
3. **Feature Modules (features/)** — Import (ImportZone + preview), Chat (ChatList + MessageView with virtual scroll), Search (SearchBar + SearchResults with debounce + multiEntry index probing). Each feature has colocated UI, hooks, and tests.
4. **MultiEntry Index Search** — Full-text search via Dexie multiEntry index on tokenized+stemmed terms. Probe strategy: find the least-common query term, scan only that subset for full matches. Provides sub-200ms search on 1M messages without external search dependencies.
5. **Virtual Scrolling** — Only renders visible messages + 2 screen buffers (~200 DOM nodes max). Prevents browser crashes on 100K+ message datasets.

### Critical Pitfalls

The pitfalls research catalogues 13 categorized pitfalls with specific prevention strategies and a pitfall-to-phase mapping. The most critical:

1. **Naive WhatsApp Export Parsing (Critical):** WhatsApp exports have 14+ timestamp format families (iOS bracketed, ISO dashed, European dotted, CJK, etc.) and locale-specific system message text. A parser tested only against the developer's own export will silently corrupt data from other formats. **Prevention:** Multi-stage auto-detection from first 20 lines; support 14+ format families using published fixture sets (chattopdf 24-fixture benchmark); locale parameter for date disambiguation; strip UTF-8 BOM; normalize line endings. **Must be built format-tolerant in Phase 1 — retrofitting is a rewrite.**

2. **Per-Message IndexedDB Writes (Critical):** Inserting 50,000 messages one transaction at a time takes 5+ minutes (25x slowdown vs batched). **Prevention:** Always batch writes (500–1000 messages per transaction using `dexie.bulkAdd()`). Use relaxed durability for imports. Implement "mergebounce" — collect writes over 50ms, flush in one batch. **Build into Phase 2 storage layer from day one.**

3. **Multiline Message Misalignment (Critical):** WhatsApp continuation lines lack timestamp prefixes. A naive parser fragments each multi-line message into separate spurious messages. **Prevention:** Look-ahead parsing — read ahead lines until finding a valid timestamp pattern, group intermediate lines as message body. Safety cap on message body length (1000 lines max). Preserve `\n` in stored body. **Phase 1 parser concern — cannot fix without reparsing.**

4. **In-Memory Search Index Memory Blowout (Critical):** Real-world experience (Fika post-mortem): Orama in-memory index consumed 300 MB for ~10K entities. For 100K WhatsApp messages, in-memory indexes hit 200–500 MB, crashing mobile tabs. **Prevention:** Use a persistent/disk-based search index from day one — FlexSearch with IndexedDB adapter or SQLite WASM FTS5. Build indexes in a Web Worker. Consider per-chat indexes vs monolithic. **Switching from in-memory to persistent requires full index rebuild with user data.**

5. **WhatsApp 40K Export Cap (Critical):** WhatsApp silently limits every export to the most recent 40,000 messages. No indicator in the file. Users believe they have a complete archive. **Prevention:** Show a warning on every import. Offer guidance on Android Backup Extractor / iMazing for older messages. Future merge-exports feature for overlapping date ranges.

6. **No Deduplication (Critical):** Importing the same chat twice doubles all messages with no undo path. **Prevention:** Deterministic dedup hash `SHA256(timestamp + sender + text + media_type)` as message primary key. Upsert semantics on import. Pre-import summary showing new vs skipped messages. **Build into Phase 1 parser — retrofitting is a migration nightmare.**

## Implications for Roadmap

Based on the combined research from all four files, the following phase structure is recommended. The ordering follows the dependency chain revealed by architecture analysis: each phase delivers something the next phase requires, and each phase avoids the pitfalls assigned to it by the pitfall-to-phase mapping.

### Phase 1: Parser Library & Type Definitions

**Rationale:** Everything depends on the parser. The data model (`Message`, `Chat`, `Attachment`, `MediaRef` types) is the shared language across all phases. Building parser-first means Phase 2–5 can import types and pure functions without circular dependencies. No UI, no DB, no Worker yet — just pure logic testable from the terminal.

**Delivers:**
- `lib/parser/types.ts` — Core type definitions (Message, Chat, MediaRef, MessageType enum)
- `lib/parser/detectFormat.ts` — Auto-detect iOS vs Android format from first 20 lines
- `lib/parser/parseLine.ts` — Parse single line with regex; multi-format pattern matching (14+ families)
- `lib/parser/tokenize.ts` — Multi-line message assembler with look-ahead grouping
- `lib/parser/classifyMessage.ts` — Message type detection (text/media/system) with locale-aware patterns
- `lib/format/date.ts` — Timestamp formatting utilities (date-fns wrappers)
- Comprehensive test suite against chattopdf's 24-fixture benchmark set

**Addresses FEATURES:** Multi-format parser, Group chat support, Local-only processing (computation happens locally by design)
**Avoids PITFALLS:** #1 (naive parsing), #3 (multiline misalignment), #5 (40k cap warning), #7 (dedup hash generation), #9 (media placeholder classification), #11 (timezone capture)

**Pitfalls that MUST be addressed in this phase:**
- Must pass chattopdf 24-fixture benchmark covering 14+ date format families
- Must detect iOS (bracketed) vs Android (dash-separated) formats
- Must strip UTF-8 BOM and normalize CRLF → LF
- Must implement look-ahead multiline grouping
- Must generate deterministic dedup hash per message
- Must classify media placeholders across 3+ locales
- Must capture browser timezone offset at import time
- Must warn about WhatsApp's 40K export cap

**Research flag:** Well-documented patterns. The WhatsApp export format is reverse-engineered thoroughly. Custom parser implementation has clear references (chattopdf blog, whatswizard blog). **Skip research-phase for planning.**

---

### Phase 2: Storage Layer (IndexedDB Schema + Repositories)

**Rationale:** Before any feature can persist or query data, the storage layer must exist. This phase establishes the Dexie.js schema, repository classes, and migration strategy. It's pure infrastructure — no UI, tested via direct API calls. Phase 3 and Phase 4 depend on it.

**Delivers:**
- `db/schema.ts` — Dexie.js database definition with `chats`, `messages` tables, compound index `[chatId+timestamp]`, multiEntry `terms` index for search
- `db/ChatRepository.ts` — CRUD for chat metadata (name, message count, date range, last message preview)
- `db/MessageRepository.ts` — Paginated message loading via compound index range queries, bulk insert with dedup, cursor-based incremental loading
- `db/SearchRepository.ts` — MultiEntry index search with probe-term optimization
- `db/migrations.ts` — Schema versioning and migration functions
- Batch write implementation (500–1000 messages per transaction)
- `navigator.storage.persist()` request on first data write
- Startup health check (database open, integrity check)

**Uses STACK:** Dexie.js 4.x (schema versioning, bulkAdd, liveQuery), TypeScript (typed repositories)
**Implements ARCHITECTURE:** Repository Pattern for IndexedDB, MultiEntry Search Index
**Addresses FEATURES:** Foundation for persistent storage (P2), foundation for search (P1)
**Avoids PITFALLS:** #2 (batch writes), #6 (corruption prevention — uses Dexie not SQLite WASM), #10 (getAll meltdown via pagination), #13 (startup latency — optimistic rendering)

**Pitfalls that MUST be addressed in this phase:**
- Batch writes only (never per-message transactions) — 500–1000 msgs/txn
- Paginated reads only (never `getAll()` on full message store)
- Use Dexie.js schema versioning (not SQLite WASM) to avoid corruption bugs
- Request `navigator.storage.persist()` for storage durability
- Compound index on `[chatId+timestamp]` for efficient message pagination
- MultiEntry index on `terms` for search (must be created at schema v1 — adding later requires migration)

**Research flag:** Well-documented patterns. Dexie.js is mature, the repository pattern is standard, and the multiEntry search technique has published examples. **Skip research-phase for planning.**

---

### Phase 3: Import Feature (Parser Worker + Import UI)

**Rationale:** First vertical slice connecting parser (Phase 1) to storage (Phase 2). The user drops a file → parser runs in a Web Worker → preview is shown → data commits to IndexedDB. This is the first phase with a user-facing component and is the gate to all later features — no data can be browsed or searched without it. The Web Worker architecture must be established now because moving parsing off the main thread later would require refactoring all import callers.

**Delivers:**
- `workers/parser.worker.ts` — Web Worker entry point importing Phase 1's parser library
- `features/import/useImport.ts` — Main-thread hook managing Worker lifecycle, chunk accumulation, cancellation
- `features/import/ImportZone.tsx` — Drag-drop zone + file picker (accepts .txt and .zip)
- `features/import/ImportPreview.tsx` — Parsing summary (message count, date range, participants, first 10 messages as sample) + Accept/Discard buttons
- Progress reporting (lines parsed vs total, batches stored vs total)
- Duplicate detection in preview ("X new messages, Y already imported")
- JSZip integration for .zip extraction
- Import cancellation with partial cleanup

**Uses STACK:** SvelteKit 2 (component + routing), Dexie.js 4 (persistence), Tailwind CSS 4 (import zone styling), Vite (Worker bundling)
**Implements ARCHITECTURE:** Worker-Isolated Parsing, Preview-Before-Import Workflow
**Addresses FEATURES:** WhatsApp .txt/.zip import (P1), Import preview (P1), Local-only processing (P1)
**Avoids PITFALLS:** #8 (import progress feedback), #12 (system message locale handling in preview)

**Pitfalls that MUST be addressed in this phase:**
- Show progress visible within 500ms of drag-and-drop, update at least every 2 seconds
- Accept both .txt and .zip files
- Extract `_chat.txt` from ZIP (ignore media files for now, store paths)
- Immediate spinner on drop → progress bar once line count known
- Preview before committing to storage
- Cancellation must clean up partial data

**Research flag:** Well-documented patterns. Web Workers, drag-drop, and file reading are standard web platform APIs. **Skip research-phase for planning.**

---

### Phase 4: Chat Browsing (Chat List + Message View + Virtual Scroll)

**Rationale:** With data in the database (Phase 3), users need to browse their chats. This phase delivers the core viewing experience: chat list sidebar, WhatsApp-style message bubbles, sender labels, timestamps, media placeholders. Virtual scrolling is critical — without it, 100K+ message chats crash the browser. The chat browsing architecture (component tree, scroll management, lazy loading) is built here and reused by search result navigation in Phase 5.

**Delivers:**
- `features/chat/ChatList.tsx` — Sidebar listing all imported conversations sorted by most recent message
- `features/chat/ChatListItem.tsx` — Row showing name, last message preview, date, message count
- `features/chat/MessageView.tsx` — Virtual-scrolled message viewport with bidirectional loading
- `features/chat/MessageBubble.tsx` — Individual bubble component (green for "me", gray for others, sender labels, timestamps, media placeholders)
- `features/chat/useChat.ts` — Chat query hook with pagination, liveQuery subscription
- `components/VirtualList.tsx` — Reusable virtual-scroll container (or use Svelte virtual list pattern)
- `app/layout.tsx` — Shell layout: sidebar + main area, responsive breakpoints
- Dark mode support (tailwind `dark:` variants, system preference detection)
- Empty state for first-time users ("Drag your WhatsApp export here to begin")
- System message rendering (joined/left/name-changed as compact timeline-style entries)

**Uses STACK:** SvelteKit 2, Tailwind CSS 4, date-fns 4, Dexie.js 4 (liveQuery for reactive updates)
**Implements ARCHITECTURE:** Chat browsing component tree, Repository pattern for data access
**Addresses FEATURES:** Chat-style bubble UI (P1), Group chat support with sender labeling (P1), Media placeholders (P1), Light/dark mode (P1), Basic conversation sidebar (P1)
**Avoids PITFALLS:** #10 (getAll meltdown — paginated loading only), #8 (no progress — progress from Phase 3)

**Pitfalls that MUST be addressed in this phase:**
- Virtual scrolling with <200 DOM nodes for any dataset size
- Paginated message loading (never load all messages at once)
- XSS prevention: render message content as text, never innerHTML
- Dark mode respects `prefers-color-scheme` by default
- Media placeholders rendered as typed elements (not raw text)
- Empty state with clear onboarding guidance

**Research flag:** Well-documented patterns. Chat bubble UI is a common pattern (WhatsApp Web as reference). Virtual scrolling has mature implementations. **Skip research-phase for planning.**

---

### Phase 5: Full-Text Search

**Rationale:** With data browsable (Phase 4), search is the core utility that makes an archive useful. This phase builds the persistent search index, search UI, and result navigation. Search depends on stored data (Phase 2 schema with multiEntry index), and the search index must be persistent from day one to avoid the memory-blowout pitfall. Orama is the recommended library because it keeps the same API for future vector search (Phase 7).

**Delivers:**
- Search index integration (Orama 3.x with persistent IndexedDB-backed index, or Dexie multiEntry index)
- `features/search/SearchBar.tsx` — Debounced input (300ms), keyboard navigation, search-as-you-type
- `features/search/SearchResults.tsx` — Results list with highlighted match terms, chat name, timestamp, sender, context snippets
- `features/search/useSearch.ts` — Search hook with debounce, index query, result caching
- Result-to-message navigation (click a result → open that chat scrolled to that message)
- Search result count ("142 results for 'dog'")

**Uses STACK:** @orama/orama 3.x (full-text BM25), Dexie.js 4 (persistence), SvelteKit 2
**Implements ARCHITECTURE:** MultiEntry Index Full-Text Search (or Orama persistent index)
**Addresses FEATURES:** Full-text keyword search (P1), Search result navigation (P1)
**Avoids PITFALLS:** #4 (in-memory search index blowout — must use persistent index)

**Critical decision:** Choose between Orama (strategic pick — same API for future RAG) and Dexie multiEntry index (no extra dependency, proven technique). **Recommend Orama** because the v1 keyword index graduates to vector search without migration. If choosing multiEntry, Phase 7 (RAG) will need a separate vector storage solution.

**Research flag:** The choice between Orama persistent index and Dexie multiEntry search needs a decision during roadmap planning. Both have tradeoffs documented in the architecture research. **May need `/gsd-plan-phase --research-phase`** to confirm the search index strategy before implementation.

---

### Phase 6: Advanced Features (P2)

**Rationale:** With core import-browse-search working, Phase 6 adds the features that make the app sticky: persistence as a feature (not just implementation detail), cross-chat search, bookmarks, analytics, and calendar navigation. These are independent features that build on the existing stack and can be implemented in any order within this phase.

**Delivers:**
- Persistent IndexedDB as a user-facing capability (cross-session loading, incremental imports)
- Multiple conversation management from sidebar
- Bookmarks: toggle per message, bookmarks-filter view, export
- Calendar / timeline navigation: date-picker, "Jump to date" button
- Analytics dashboard: message counts per participant, activity heatmaps, most active hours, emoji/sentiment trends
- Cross-chat search: unified search across all conversations

**Uses STACK:** SvelteKit 2, Dexie.js 4, Orama 3 (for cross-chat), date-fns 4, Tailwind CSS 4
**Addresses FEATURES:** All P2 features
**Avoids PITFALLS:** #7 (dedup — should already be handled in Phase 1; verify)

**Research flag:** Analytics dashboard is a broad sub-feature. **May need `/gsd-plan-phase --research-phase`** to research charting libraries and visualization patterns before implementation.

---

### Phase 7: AI-Powered Q&A (RAG) — Future

**Rationale:** Deferred per PROJECT.md. This phase adds semantic search and natural-language Q&A over the user's message archive. It builds on Phase 1's parser (message text as documents), Phase 2's storage (message corpus), and Phase 5's search infrastructure (Orama vector index). The embedding computation runs entirely in-browser via Transformers.js with WebGPU for acceleration.

**Delivers:**
- Client-side embedding generation (all-MiniLM-L6-v2 via Transformers.js)
- Orama vector index (same index as Phase 5, `mode: 'vector'`)
- RAG query UI (ask a question → retrieve relevant messages → generate answer)
- Optional API key upgrade path (OpenAI for higher quality)
- AnswerSession integration (Orama's built-in RAG pipeline)

**Uses STACK:** @xenova/transformers 2.x, @orama/orama 3.x (vector mode), SvelteKit 2
**Addresses FEATURES:** AI-powered Q&A (v2+)
**Avoids PITFALLS:** #4 (persistent index — matches Phase 5 choice)

**Research flag:** Requires significant research — client-side RAG, model quantization, WebGPU support matrix, and the interaction between Orama AnswerSession and the UI. **Will need `/gsd-plan-phase --research-phase`** before implementation.

---

### Phase Ordering Rationale

- **Parser first (P1):** The data model (types.ts) is the shared language across all phases. Building parser last would force retroactive type changes across the entire stack. The parser must handle 14+ formats from day one because changing the parser after data is in storage invalidates all previously imported data.
- **Storage second (P2):** Every downstream feature (import, browse, search) needs IndexedDB. Building storage before import means the import pipeline can persist as it goes — no in-memory buffering of 100K messages.
- **Import third (P3):** First vertical slice. Connects parser → storage → user preview. Without this phase, no data exists to browse or search. The Worker architecture is established here and reused by search indexing later.
- **Browsing fourth (P4):** Users need to see their data before they can search it. The virtual scroll component built here is reused by search result navigation in Phase 5.
- **Search fifth (P5):** Search depends on both storage (index) and browsing (result navigation). It's the core utility — the reason users want a digital archive.
- **Advanced features sixth (P6):** Independent enhancements that add stickiness. Each is well-documented and can be picked up by any developer.
- **RAG seventh (P7):** Technically complex, deferred per PROJECT.md, and depends on all previous phases for infrastructure.

### Research Flags

Phases needing deeper research during planning:
- **Phase 5 (Search):** Need to confirm Orama persistent index vs Dexie multiEntry index strategy. Both are viable; the choice affects Phase 7 migration path.
- **Phase 6 (Analytics):** Charting library selection (bare-chart? chart.js? Observable Plot?) needs research. Analytics is a broad sub-feature that merits a focused research pass.
- **Phase 7 (RAG):** Client-side embedding inference, WebGPU support matrix, model loading strategies, Orama AnswerSession API. Full `/gsd-plan-phase --research-phase` required.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Parser):** Well-documented WhatsApp export format. Multiple reference implementations. Chattopdf 24-fixture benchmark provides test coverage target.
- **Phase 2 (Storage):** Dexie.js schema patterns are well-documented. Repository pattern is standard. MultiEntry search index technique has published examples.
- **Phase 3 (Import):** Web Workers, drag-drop, file reading are standard web APIs. ZIP extraction via JSZip is well-documented.
- **Phase 4 (Browsing):** Chat UI is a solved pattern (WhatsApp Web as reference). Virtual scrolling has mature implementations in Svelte.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommendations verified against official docs and multiple production reference apps. SvelteKit + Dexie + Orama is validated by existing WhatsApp viewer implementations (whatsapp-backup-viewer, whats-reader, ChatParser). |
| Features | HIGH | Competitive analysis of 15 tools provides solid evidence for prioritization. Feature dependency tree is logically sound and consistent with architecture. PMF gap (persistent multi-chat + AI Q&A) is well-supported by research. |
| Architecture | HIGH | Patterns are battle-tested: repository pattern (Dexie docs), multiEntry search (IndexedDB full-text technique), Worker isolation (standard web pattern), preview-before-import (UX best practice). Build order matches dependency analysis. |
| Pitfalls | HIGH | Each pitfall is sourced from real-world production failures (Fika post-mortem, wa-sqlite bugs, IndexedDB performance research from Nolan Lawson, chattopdf benchmark). Prevention strategies reference specific libraries, APIs, and patterns with phase assignments. |

**Overall confidence:** HIGH

### Gaps to Address

- **Orama persistent index vs Dexie multiEntry search:** Both are viable for Phase 5 but lead to different Phase 7 (RAG) architectures. Roadmap planning should make this decision explicitly. Recommend Orama for forward compatibility with vector search.
- **Analytics dashboard scope:** "Analytics" could mean simple message counts or a full dashboard with charts, heatmaps, and sentiment analysis. The scope needs definition during Phase 6 planning to avoid scope creep.
- **Safari IndexedDB behavior:** Multiple pitfalls note Safari as the worst-performing IndexedDB implementation. Browser-specific testing is essential but no code changes can fully mitigate Safari's limitations. The gap is awareness, not architecture.
- **Chat merge / deduplication complexity:** Deferred to v2+, but the dedup hash generation must be built in Phase 1. The merge algorithm (interleaving multiple overlapping exports) needs separate research before implementation. The Phase 1 hash design must account for merge use cases.

## Sources

### Primary (HIGH confidence — official docs and reference implementations)
- **SvelteKit docs** (kit.svelte.dev): SSR/PWA patterns, adapter-static, Svelte 5 runes API
- **Dexie.js v4 docs** (dexie.org): Schema versioning, liveQuery, transaction API, bulkAdd
- **Orama docs** (docs.orama.com): Full-text + vector search, AnswerSession RAG pipeline
- **vite-plugin-pwa docs** (vite-pwa-org.netlify.app): SvelteKit integration, Workbox strategies
- **Tailwind CSS v4 docs** (tailwindcss.com): CSS-first configuration, Vite plugin
- **WhatsApp export format analysis** (whatswizard.com, wachattopdf.com): 14+ date format families, canonical regex, multi-line handling, locale variance
- **Full-Text Search with IndexedDB** (jmp.chat blog, 2026): MultiEntry index probing technique
- **Nolan Lawson IndexedDB performance series** (nolanlawson.com): Cursor vs getAll benchmarks, relaxed durability testing
- **ChatParser** (gavirubihan): React + Vite + Dexie.js + Virtua — production stack reference
- **whatsapp-backup-viewer** (itxshakil): React 19 + Dexie.js + Tailwind v4 — schema patterns, PWA support
- **whatsapp-archive-viewer** (nshah1d): Zero-dependency architecture with Worker parsing, deduplication, virtual DOM

### Secondary (MEDIUM confidence — community consensus, multiple sources)
- **whats-reader** (rodrigogs): SvelteKit/Electron viewer — Whisper transcription, bookmarks, statistics. AGPL-3.0.
- **whatsapp-chat-viewer-svelte** (InvictusNavarchus): Svelte + idb + compound indexes — alternative framework approach
- **whatsapp-chat-export-viewer** (mutluksap): Best-in-class multi-locale parser (15+ variants), WA Web-style UI
- **Client-side RAG survey** (deepap.dev): Transformers.js + WebGPU benchmarks, IndexedDB vector storage patterns
- **ThreadRecap** (threadrecap.com): AI recap tool — product positioning, feature set comparison
- **ChatVault** (marcoshernanz): Rust+Wasm BERT embeddings for local semantic search
- **Fika post-mortem** (news.lavx.hu): Real-world Orama → FlexSearch migration, memory consumption for 10K entities

### Tertiary (LOW confidence — single source or inference, needs validation)
- **SQLite WASM corruption reports** (wa-sqlite GitHub issues #258, #143, #111): IDBBatchAtomicVFS + FTS5 + page refresh corruption. Mitigated by choosing Dexie.js (not SQLite WASM) for primary storage.
- **ChatXport** (chatxport.com): Pricing and feature comparison data from proprietary product
- **Lucen.App** (lucen.app): AI relationship-focused analyzer — feature comparison only

---

*Research completed: 2026-07-28*
*Ready for roadmap: yes*
