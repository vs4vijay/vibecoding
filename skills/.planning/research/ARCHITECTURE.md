# Architecture Research

**Domain:** Client-side WhatsApp chat archive PWA (parser + RAG web app)
**Researched:** 2026-07-28
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION LAYER                            │
│  ┌────────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Chat List  │  │ Message View │  │ Search Bar │  │ Import Zone │  │
│  │ (sidebar)  │  │ (virtual     │  │ (keyword)  │  │ (drag-drop  │  │
│  │            │  │  scrolling)  │  │            │  │  + picker)  │  │
│  └──────┬─────┘  └──────┬───────┘  └──────┬─────┘  └──────┬──────┘  │
│         │               │                 │               │         │
├─────────┴───────────────┴─────────────────┴───────────────┴─────────┤
│                        COMPOSITION / ORCHESTRATION                   │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │           App Shell / Router / State Coordinator              │    │
│  │        (React/Svelte + app-level state store)                 │    │
│  └──────┬──────────────┬──────────────────┬─────────────────────┘    │
│         │              │                  │                           │
├─────────┴──────────────┴──────────────────┴─────────────────────────┤
│                           SERVICE LAYER                              │
│  ┌───────────┐  ┌───────────────┐  ┌───────────────┐               │
│  │ Import    │  │ Search        │  │ Chat Query    │               │
│  │ Service   │  │ Service       │  │ Service       │               │
│  │ (parser   │  │ (tokenizer +  │  │ (CRUD +       │               │
│  │  routing) │  │  index scan)  │  │  pagination)  │               │
│  └─────┬─────┘  └───────┬───────┘  └───────┬───────┘               │
│        │                │                  │                         │
├────────┴────────────────┴──────────────────┴───────────────────────┤
│                         PERSISTENCE LAYER                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    IndexedDB (Dexie.js)                       │    │
│  │  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐    │    │
│  │  │ chats      │  │ messages   │  │ search_index         │    │    │
│  │  │ (metadata) │  │ (messages) │  │ (multiEntry terms    │    │    │
│  │  └────────────┘  └────────────┘  │  for full-text)      │    │    │
│  │                                  └─────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │   Parser Web Worker  │
                    │   (off-main-thread)  │
                    │   Streaming line-by- │
                    │   line parsing of    │
                    │   .txt / .zip files  │
                    └─────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|---------------|------------------------|
| **Import Zone** | Accept drag-drop and file-picker input; validate file type (.txt/.zip); show preview before committing | React/Svelte component with `onDrop`/`onChange` handlers; file size + format validation |
| **Parser Web Worker** | Stream-read exported chat file; detect platform (iOS/Android); parse lines into structured messages; handle multi-line continuations, system messages, media references | Offload via `new Worker('parser-worker.js')`; line-by-line regex matching with format auto-detection |
| **Chat List** | Display imported conversations grouped by name; show metadata (message count, date range, last message preview); support selection | Virtualized list sorted by most-recent-activity |
| **Message View** | Render messages as WhatsApp-style bubbles; show sender labels, timestamps, media placeholders; virtual scroll for large datasets | Virtual scrolling library (Virtua, react-window, or custom) for 100K+ messages |
| **Search Bar** | Accept keyword input; invoke search service; display results with context highlights | Debounced input (300ms); results show as filtered message list or overlay |
| **Search Service** | Tokenize query; probe multiEntry index for smallest term; scan matched messages for full query; return ranked results | IndexedDB cursor over `search_index` multiEntry store; tokenize + stem both query and stored terms |
| **Chat Query Service** | Load messages for a chat with pagination; support sorted queries (chronological); provide cursor-based incremental loading | IndexedDB compound index on `[chatId+timestamp]` with range queries |
| **Storage Layer (Dexie.js)** | Wrap IndexedDB with typed API; manage schema migrations; provide reactive queries | Dexie.js `liveQuery` for reactive UI binding; schema versioning in `onupgradeneeded` |
| **App Shell** | Coordinate between components; manage routing (chat selection, search mode); handle PWA lifecycle | React Router or SvelteKit; service worker registration; `beforeinstallprompt` handling |

## Recommended Project Structure

```
src/
├── app/                    # App shell, routing, layout
│   ├── App.tsx             # Root component, PWA lifecycle
│   ├── router.tsx          # Route definitions (chat view, search, import)
│   └── layout.tsx          # Shell layout (sidebar + main area)
│
├── features/               # Feature modules (co-located by domain)
│   ├── import/             # Chat import feature
│   │   ├── ImportZone.tsx      # Drag-drop + file picker UI
│   │   ├── ImportPreview.tsx   # Preview parsed messages before commit
│   │   ├── useImport.ts        # Import hook / state machine
│   │   └── import.test.ts      # Import feature tests
│   │
│   ├── chat/               # Chat browsing feature
│   │   ├── ChatList.tsx        # Sidebar list of conversations
│   │   ├── ChatListItem.tsx    # Single chat row (name, preview, time)
│   │   ├── MessageView.tsx     # Message bubble viewport
│   │   ├── MessageBubble.tsx   # Single message bubble component
│   │   ├── MessageComposer.tsx # (future: RAG query input)
│   │   └── useChat.ts          # Chat query hook (pagination, subscribe)
│   │
│   ├── search/             # Search feature
│   │   ├── SearchBar.tsx       # Search input with results dropdown
│   │   ├── SearchResults.tsx   # Results list with context snippets
│   │   ├── useSearch.ts        # Search hook (debounce, query, cache)
│   │   └── SearchFilters.tsx   # (future: date range, sender filter)
│   │
│   └── settings/           # (future: preferences, export)
│       └── SettingsPanel.tsx
│
├── lib/                    # Pure business logic (no UI imports)
│   ├── parser/             # WhatsApp export parser
│   │   ├── types.ts            # Message, ParsedChat, MediaRef types
│   │   ├── detectFormat.ts     # Auto-detect iOS vs Android format
│   │   ├── parseLine.ts        # Parse single line into structured message
│   │   ├── tokenize.ts         # Multi-line message assembler
│   │   ├── classifyMessage.ts  # Message type detection (text/media/system)
│   │   └── index.ts            # Public API: parseString, parseFile
│   │
│   ├── search/             # Full-text search engine
│   │   ├── tokenizer.ts        # Tokenize: split words, lowercase, stem
│   │   ├── stopwords.ts        # Common word filter list
│   │   ├── stemmer.ts          # Light stemmer (Porter or simple suffix)
│   │   └── index.ts            # Search orchestration
│   │
│   └── format/             # Formatting utilities
│       ├── date.ts             # Timestamp formatting
│       ├── media.ts            # Media placeholder helpers
│       └── i18n.ts             # Locale-aware system message detection
│
├── db/                     # IndexedDB schema and repositories
│   ├── schema.ts              # Table definitions, indexes, versioning
│   ├── ChatRepository.ts      # Chat CRUD operations
│   ├── MessageRepository.ts   # Message CRUD + pagination
│   ├── SearchRepository.ts    # Search index read/write
│   └── migrations.ts          # Schema migration functions
│
├── workers/                # Web Worker entry points
│   ├── parser.worker.ts       # Off-main-thread parser worker
│   └── search.worker.ts       # (future: heavy search/embedding worker)
│
├── components/             # Shared UI components
│   ├── VirtualList.tsx         # Reusable virtual-scroll container
│   ├── FileDropzone.tsx        # Reusable file drop target
│   ├── Spinner.tsx
│   └── EmptyState.tsx
│
├── hooks/                  # Shared React hooks
│   ├── useIndexedDB.ts         # Generic DB access hook
│   ├── useDebounce.ts
│   └── useVirtualScroll.ts
│
└── types/                  # Global type definitions
    ├── message.ts             # Message, Chat, Attachment types
    ├── search.ts              # SearchQuery, SearchResult
    └── parser.ts              # ParserOptions, ParseResult
```

### Structure Rationale

- **`features/`**: Groups all code for a feature (UI + logic + hooks + tests) in one directory. This keeps import/chat/search as independently developable modules. When RAG is added later, it gets its own feature folder.
- **`lib/parser/`**: Pure parsing logic with zero UI imports. Designed to be testable in isolation and portable if the parser ever needs to run in a Worker.
- **`lib/search/`**: The tokenizer+stemmer+indexer is pure logic that can run on either the main thread or in a Worker. Kept separate from the UI hooks.
- **`db/`**: All IndexedDB concerns are behind repository classes. The rest of the app never touches raw IndexedDB APIs — it calls `MessageRepository.getMessages(chatId, limit)` instead.
- **`workers/`**: Web Worker entry points. Each worker is a thin message-passing layer around a `lib/` module.

## Architectural Patterns

### Pattern 1: Repository Pattern for IndexedDB

**What:** Encapsulate all IndexedDB access behind typed repository classes. The rest of the app never imports `dexie` or writes raw IndexedDB queries.

**When to use:** Any app that uses IndexedDB as its primary store. Critical for testability — you can mock the repository in tests without IndexedDB.

**Trade-offs:** Slightly more boilerplate up front. Huge payoff when the schema changes (one file to update, not dozens of components with raw queries).

**Example:**
```typescript
// db/MessageRepository.ts
import { db } from './schema';

export class MessageRepository {
  async getMessages(
    chatId: string,
    limit = 50,
    beforeTimestamp?: number,
  ): Promise<Message[]> {
    let query = db.messages
      .where('[chatId+timestamp]')
      .between(
        [chatId, Dexie.minKey],
        [chatId, beforeTimestamp ?? Dexie.maxKey],
        true,
        beforeTimestamp ? false : true,
      )
      .reverse();

    const messages = await query.limit(limit).toArray();
    return messages.reverse(); // Return chronological
  }

  async insertBatch(messages: Message[]): Promise<void> {
    await db.transaction('rw', db.messages, async () => {
      // Deduplicate by clientId or (chatId + timestamp + sender)
      for (const msg of messages) {
        const existing = await db.messages
          .where({ chatId: msg.chatId, clientId: msg.clientId })
          .first();
        if (!existing) {
          await db.messages.add(msg);
        }
      }
    });
  }

  async searchByTerms(terms: string[]): Promise<Message[]> {
    // MultiEntry index probe — see Pattern 2
  }
}
```

### Pattern 2: MultiEntry Index Full-Text Search

**What:** IndexedDB has no native full-text search. The performant pattern for client-side search on 10K–1M messages is a `multiEntry` index on tokenized+stemmed search terms. When querying, count hits per term, pick the smallest result set, and scan only that subset for full matches.

**When to use:** When you need instant (<200ms) search on a local dataset of 10K–1M messages. For <10K messages, a naive cursor scan is simpler and fast enough.

**Trade-offs:**
- + Near-instant on large datasets (multi-term queries on 1M messages: ~50ms)
- + Pure IndexedDB — no external search engine needed
- - Index storage overhead (duplicates text as token arrays)
- - Write cost: every message insert requires tokenizing and storing terms
- - Requires tokenizer and stemmer logic (must be consistent between write and query)

**Example:**
```typescript
// lib/search/tokenizer.ts
const STOPWORDS = new Set(['the', 'and', 'or', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'is', 'was']);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\b/)
    .map(t => t.replace(/[^\w]/g, ''))
    .filter(t => t.length > 1 && !STOPWORDS.has(t))
    .map(stem); // apply light stemming
}

// db/SearchRepository.ts
export class SearchRepository {
  async search(query: string, chatId?: string): Promise<Message[]> {
    const qTerms = [...new Set(tokenize(query))];
    if (qTerms.length === 0) return [];

    const index = db.messages.index('terms');
    
    // Probe: find the term with fewest matches
    let probeTerm: string;
    let minCount = Infinity;
    for (const term of qTerms) {
      const count = await index
        .filter((msg) => msg.terms.includes(term)) // or use IDBKeyRange.count
        .count();
      if (count < minCount) {
        minCount = count;
        probeTerm = term;
      }
    }

    // Scan only messages matching the probe term
    const results: Message[] = [];
    let queryBuilder = chatId
      ? db.messages.where('[chatId+terms]').equals([chatId, probeTerm])
      : db.messages.where('terms').equals(probeTerm);

    const candidates = await queryBuilder.toArray();
    for (const msg of candidates) {
      if (qTerms.every(t => msg.terms.includes(t))) {
        results.push(msg);
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }
}
```

### Pattern 3: Worker-Isolated Parsing

**What:** The most expensive operation (parsing a multi-MB chat export) runs in a dedicated Web Worker. The main thread receives parsed messages incrementally as they're ready, keeping the UI responsive even for 500K-message files.

**When to use:** Always. Chat exports can exceed 100MB. Blocking the main thread for >100ms creates a bad UX.

**Trade-offs:**
- + UI stays at 60fps during import
- + Easy to cancel mid-parse (terminate the worker)
- - Communication overhead (postMessage serialization)
- - Worker can't access IndexedDB directly (main thread must persist results)
- - Slightly complex state machine (idle → parsing → done/error)

**Example:**
```typescript
// workers/parser.worker.ts
import { parseString } from '../lib/parser';

self.onmessage = async (e: MessageEvent) => {
  const { fileId, text, options } = e.data;
  try {
    const result = parseString(text, options);
    // Post results back in chunks if very large
    const CHUNK_SIZE = 1000;
    for (let i = 0; i < result.messages.length; i += CHUNK_SIZE) {
      const chunk = result.messages.slice(i, i + CHUNK_SIZE);
      self.postMessage({ type: 'chunk', fileId, messages: chunk, done: false });
    }
    self.postMessage({ type: 'done', fileId, metadata: result.metadata });
  } catch (err) {
    self.postMessage({ type: 'error', fileId, error: err.message });
  }
};

// features/import/useImport.ts (main thread hook)
export function useImport() {
  const workerRef = useRef<Worker>();

  const importFile = useCallback(async (file: File) => {
    const text = await file.text();
    const worker = new Worker(new URL('../../workers/parser.worker.ts', import.meta.url));
    workerRef.current = worker;

    return new Promise((resolve, reject) => {
      let allMessages: Message[] = [];
      
      worker.onmessage = (e) => {
        if (e.data.type === 'chunk') {
          allMessages.push(...e.data.messages);
          // Optional: write chunks to IndexedDB progressively
        } else if (e.data.type === 'done') {
          worker.terminate();
          resolve({ messages: allMessages, metadata: e.data.metadata });
        } else if (e.data.type === 'error') {
          worker.terminate();
          reject(new Error(e.data.error));
        }
      };

      worker.postMessage({
        fileId: crypto.randomUUID(),
        text,
        options: { parseAttachments: true },
      });
    });
  }, []);

  return { importFile };
}
```

### Pattern 4: Preview-Before-Import Workflow

**What:** After parsing completes, show the user a preview of the parsed conversation (total messages, date range, participants) before committing to IndexedDB. The user can accept or discard.

**When to use:** First import of a chat. Prevents accidental duplicates and gives the user confidence that parsing worked correctly. Also essential for "update existing" flows (showing what's new since last import).

**Trade-offs:**
- + User control over data ingestion
- + Can detect parser issues before data is committed
- - Extra UI surface area
- - Requires holding parsed data in memory before DB write

```
[File dropped] → [Parse in Worker] → [Preview: "42K messages, 2020-2026, 15 participants"] 
                                    → [Accept] → [Write to IndexedDB]
                                    → [Discard] → [Free memory]
```

## Data Flow

### Import Flow

```
User drops .txt file onto ImportZone
    │
    ▼
ImportZone reads file via FileReader.text()
    │
    ▼
Post file text to Parser Web Worker (off-main-thread)
    │
    ▼
Parser Worker:
  1. Detect format (iOS/Android/locale) — test first 20 lines against regex patterns
  2. Stream lines through regex matching
  3. Handle multi-line continuations (lookahead for non-timestamp lines)
  4. Classify each message (text/media/system/deleted)
  5. PostMessage chunks of 1000 parsed messages back to main thread
    │
    ▼
ImportPreview component displays parsed summary:
  - Total message count, date range, participant list
  - First 10 messages as sample
  - (future: dedup info showing which messages are new)
    │
    ▼
User clicks "Import" → ChatRepository.insertChat() + MessageRepository.insertBatch()
    │
    ▼
IndexedDB stores chat metadata in `chats` table, messages in `messages` table,
search terms in `terms` multiEntry index
    │
    ▼
UI reactively updates (liveQuery): new chat appears in ChatList
```

### Chat Viewing Flow

```
User clicks a chat in ChatList
    │
    ▼
App sets selectedChatId in state
    │
    ▼
MessageView mounts → calls MessageRepository.getMessages(chatId, limit=50)
    │
    ▼
IndexedDB query on [chatId+timestamp] compound index → returns oldest 50 messages
    │
    ▼
Virtual list renders visible bubbles (only ~15-20 DOM nodes regardless of total)
    │
    ▼
User scrolls up → loadMore() triggered → fetch next oldest batch
    │
    ▼
New messages prepended, scroll position anchored
```

### Search Flow

```
User types in SearchBar
    │
    ▼
useSearch hook debounces (300ms)
    │
    ▼
SearchRepository.search(query):
  1. Tokenize query → [stem(word) for word in query if not stopword]
  2. Probe each term's match count via terms multiEntry index
  3. Pick smallest probe term
  4. Cursor over probe term matches
  5. Filter for messages matching ALL query terms
  6. Sort by timestamp
    │
    ▼
SearchResults displays matched messages with:
  - Highlighted matching terms
  - Chat name + timestamp + sender
  - Click navigates to that message in context
```

### State Management Flow

```
┌─────────────┐     ┌────────────────┐     ┌──────────────┐
│  User       │────▶│  React State   │────▶│  Dexie.js    │
│  Action     │     │  (useState/    │     │  liveQuery   │
│             │     │   useReducer)  │     │  (reactive)  │
└─────────────┘     └───────┬────────┘     └──────┬───────┘
                            │                     │
                            ▼                     ▼
                     ┌──────────────────────────────────┐
                     │  IndexedDB (single source of      │
                     │  truth for persisted data)        │
                     └──────────────────────────────────┘
```

**Key principle:** IndexedDB is the source of truth. Components read from Dexie `liveQuery` which auto-updates when data changes. There is no separate cache layer — the DB *is* the cache. This avoids sync bugs between in-memory state and persisted state.

The one exception is **transient UI state** (which chat is selected, scroll position, whether the search panel is open) — this lives in React state only and is not persisted (or persisted only to sessionStorage as a convenience).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0–1 chat, <10K messages | Naive cursor scan for search; no virtual scrolling needed; file re-parsed on each load (no IndexedDB persistence) |
| 1–50 chats, <100K messages | IndexedDB persistence; multiEntry search index; virtual scrolling for message view (build now) |
| 50–500 chats, <1M messages | Compound indexes for chat+time queries; lazy-loading of chat list; paginate message loading in chunks |
| 500+ chats, 1M–10M messages | Offload search to a Worker; consider WASM-based stemmer for speed; chunked import with progress indicator; periodic IndexedDB compaction |
| 10M+ messages or RAG | WASM vector embedding (all-MiniLM-L6-v2 via Candle); hybrid search (vector + BM25); potential switch to OPFS (Origin Private File System) for larger-than-RAM storage |

### Scaling Priorities

1. **First bottleneck:** Naive cursor scan on search. Mitigation: switch to multiEntry index once message count exceeds 10K.
2. **Second bottleneck:** UI jank on large import. Mitigation: Web Worker parsing from day one (not an optimization — a requirement).
3. **Third bottleneck:** IndexedDB query performance on 500K+ messages with compound indexes. Mitigation: ensure indexes are created on `[chatId+timestamp]` and `terms` (multiEntry) at schema v1 — adding indexes later requires a migration that blocks the DB.

## Anti-Patterns

### Anti-Pattern 1: Parsing on the Main Thread

**What people do:** Read the file and parse it directly in the component, because it's simpler and "my chat files are small."

**Why it's wrong:** A typical export with 100K messages is ~15MB. Parsing it with regex on the main thread blocks the UI for 2–5 seconds. The browser shows a "page unresponsive" warning. For larger exports (500K+), it can exceed the long-task threshold by 10x.

**Do this instead:** Use a Web Worker from day one. The overhead of `new Worker()` + `postMessage` is negligible. The wrapper hook (`useImport`) hides the complexity. Even for small files, the Worker keeps the UI thread free for animations and input.

### Anti-Pattern 2: Using IndexedDB as a Dumb Store (No Schema)

**What people do:** Store the entire parsed JSON blob in a single IndexedDB record with a key. Retrieve it all, filter in JS.

**Why it's wrong:** A 15MB chat loaded into memory on every page load. Search requires loading every message into JS memory and filtering. This bypasses IndexedDB's indexing capabilities entirely and wastes memory.

**Do this instead:** Design a proper schema with object stores for `chats` (metadata) and `messages` (individual messages with `[chatId+timestamp]` compound index). Create a `terms` multiEntry index for search. Query only what you need — index range lookups for pagination, index probes for search.

### Anti-Pattern 3: Coupling Parser Logic to the UI Framework

**What people do:** Write the parser as a React hook with `useState` for parsed messages, mixing DOM event handling with text processing.

**Why it's wrong:** The parser becomes untestable (requires React testing framework). Cannot be reused in a Worker (hooks don't work in Workers). If you switch frameworks (React → Svelte), the parser must be rewritten.

**Do this instead:** Keep parsing logic as pure functions in `lib/parser/`. The UI layer (`useImport`) is a thin wrapper that calls the library. The Worker entry point (`workers/parser.worker.ts`) imports the same library. Zero code duplication, framework-agnostic core.

### Anti-Pattern 4: Storing Raw Blob URLs Without Revocation

**What people do:** When importing a .zip with media, decompress files and create `URL.createObjectURL(blob)` for each attachment without tracking or revoking them.

**Why it's wrong:** Each `createObjectURL` allocates memory that persists until `revokeObjectURL` is called or the document is unloaded. For 1000+ media files in a chat, this can consume gigabytes of memory without the developer realizing it.

**Do this instead:** Create blob URLs lazily (only for visible messages in the viewport). Revoke them when the message scrolls out of view. Track active blob URLs in a `Map<fileName, string>` and clean up on chat switch. For v1, since media rendering is out of scope, this is a future concern — but the data model should store filenames, not blob URLs.

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Parser lib ↔ Parser Worker | `postMessage` (string → structured messages) | Worker imports lib as a module. Main thread never calls parser directly. |
| Parser Worker ↔ Import Hook | `postMessage` (chunks of parsed messages) | Progressive delivery — 1000 messages per chunk. Hook accumulates + persists. |
| Import Hook ↔ ChatRepository | Direct function call | Hook calls `ChatRepository.insertChat()` to persist after preview. |
| MessageView ↔ MessageRepository | Direct function call | View calls `getMessages()` for pagination. Repository handles IndexedDB queries. |
| SearchBar ↔ SearchRepository | Direct function call (debounced) | SearchRepository queries terms index, returns matching message IDs. |
| Components ↔ IndexedDB | NEVER direct | Always through repository classes. Enables testing and schema changes. |
| App shell ↔ Parser Worker | `new Worker()` lifecycle | App shell owns worker creation and teardown. One worker at a time (cancel previous if new import started). |

### External Services (None — 100% Client-Side)

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Server/Backend | NONE | All processing and storage is client-side. No data ever leaves the browser. |
| OpenAI API (future RAG) | REST call from browser (API key stored locally) | Query embedding only — chat content never sent. Optional upgrade path. |
| Local LLM (future RAG) | WebGPU/WASM inference in Worker | Fully offline RAG using quantized models (e.g., all-MiniLM-L6-v2 via Candle). |

## Build Order Implications

The architecture reveals a clear dependency chain for phased building:

```
Phase 1: Parser library (lib/parser/) + type definitions
  └── Needed by: everything. Pure logic, testable in isolation.
        No UI, no DB, no Worker yet. Parse + console.log to verify.

Phase 2: IndexedDB schema + repositories (db/)
  └── Needed by: persistence. Depends on types from Phase 1.
        No UI. Insert + query via console to verify.

Phase 3: Import feature (ImportZone + Worker)
  └── Depends on: Phase 1 (parser), Phase 2 (persistence)
        First vertical slice: user drops file → parsed → stored → displayed in console

Phase 4: Chat browsing (ChatList + MessageView + virtual scroll)
  └── Depends on: Phase 2 (read from DB), Phase 3 (data exists in DB)
        First visible UI: user sees their chats rendered

Phase 5: Full-text search (SearchRepository + SearchBar + SearchResults)
  └── Depends on: Phase 2 (terms index in DB), Phase 4 (chats exist to search)
        Builds on existing data — no new import needed for testing

Phase 6: RAG / AI Q&A (future)
  └── Depends on: Phase 5 (search infrastructure), Phase 4 (chat browsing)
        Adds semantic search layer on top of keyword search
```

## Sources

- **whatsapp-archive-viewer** (amitdubeylilly): Reference implementation showing zero-dependency PWA architecture with Worker parsing, IndexedDB storage, virtual scrolling — github.com/amitdubeylilly/whatsapp-archive-viewer
- **ChatParser** (gavirubihan): React + Vite + Dexie.js + Virtua stack — typical modern framework approach — github.com/gavirubihan/ChatParser
- **whatsapp-backup-viewer** (itxshakil): React 19 + Dexie.js + Tailwind v4 — shows schema patterns for chat storage — github.com/itxshakil/whatsapp-backup-viewer
- **whatsapp-chat-viewer-svelte** (InvictusNavarchus): Svelte + idb library + compound indexes — shows alternative framework approach — github.com/InvictusNavarchus/whatsapp-chat-viewer-svelte
- **chatlume** (ParasSharma2306): Vanilla JS approach, HTML export feature — github.com/ParasSharma2306/chatlume
- **Full Text Search with IndexedDB** (jmp.chat blog, 2026): MultiEntry index probing technique for performant client-side search — blog.jmp.chat/b/2026-full-text-search-indexeddb
- **Frontend System Design: Chat Application** (javascriptbit.com): Architecture pattern of UI ← IndexedDB (not UI ← server) — javascriptbit.com/frontend-system-design-chat-application/
- **whatsapp-chat-parser** (npm): Reference JS library for WhatsApp export parsing — npmjs.com/package/whatsapp-chat-parser
- **WhatsApp Data Export Structure** (wachattopdf.com): Comprehensive guide to _chat.txt format variations — wachattopdf.com/blog/whatsapp-data-export-structure
- **ChatVault** (marcoshernanz): Rust+Wasm BERT embeddings for local semantic search — github.com/marcoshernanz/chatvault

---
*Architecture research for: RagChat (WhatsApp chat export parser + RAG web app)*
*Researched: 2026-07-28*
