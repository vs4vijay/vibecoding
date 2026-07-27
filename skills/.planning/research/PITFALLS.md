# Pitfalls Research

**Domain:** WhatsApp chat export parser + RAG web app (client-side, IndexedDB-backed)
**Researched:** 2026-07-28
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Naive WhatsApp Export Parsing (Date-Format Tunnel Vision)

**What goes wrong:**
The parser works perfectly on the developer's own export but fails catastrophically on any other device/region combination. WhatsApp exports have at least 14 known timestamp layout families (iOS bracketed, ISO dashed, European dotted, Brazilian, CJK, etc.) plus locale-specific system message text. A parser that assumes one format silently corrupts data from other formats — wrong dates, dropped messages, misattributed senders.

**Why it happens:**
Developers test only against their own export. There is no official WhatsApp export format spec — the format is determined by device OS (iOS vs Android), WhatsApp version, device locale, export method (email vs direct), and whether the chat is individual or group. Date formats vary wildly: DD/MM/YYYY vs MM/DD/YYYY creates *ambiguous dates* that cannot be resolved without locale context. System messages ("John joined" vs "John se ha unido") are language-dependent. iOS uses `[bracketed timestamps]` while Android uses `dashed timestamps`. Some versions prepend a UTF-8 BOM that breaks regex patterns.

**How to avoid:**
- Write a multi-stage parser that auto-detects format from the first few lines
- Support all 14+ known timestamp families (use published fixture sets like chattopdf's 24-fixture benchmark)
- Accept a `locale` configuration parameter to disambiguate dates (DD/MM vs MM/DD)
- Use a locale-agnostic system message detection strategy (or maintain a pattern database)
- Strip UTF-8 BOM before regex matching
- Normalize line endings (CRLF → LF) before parsing
- **Do not** try to convert timestamps to UTC — WhatsApp exports are in local device time with no timezone info

**Warning signs:**
- Dates appear wrong by exactly 12 hours (AM/PM flipped)
- Some messages have no sender (likely system messages being parsed as user messages)
- First message shows a stray character (BOM not stripped)
- Same export parsed on different browsers gives different message counts

**Phase to address:**
Phase 1 (Import & Parse) — must be built format-tolerant from day one. Retrofitting format support after the data model is locked is a rewrite.

---

### Pitfall 2: Per-Message IndexedDB Writes (Transaction Overhead Death)

**What goes wrong:**
A WhatsApp export with 50,000 messages takes 5+ minutes to import. The browser tab appears hung. IndexedDB performance degrades to ~0.5 writes per second because each message creates a separate transaction.

**Why it happens:**
IndexedDB's performance killer is *transaction overhead*, not data throughput. Inserting 1,000 documents in a single transaction takes ~80ms. Inserting the same 1,000 documents with individual transactions takes ~2,000ms — a 25x slowdown. Chat archive projects routinely import 50k–500k messages in a single session. With per-message transactions, a 100k-message import takes 4+ minutes.

The root cause is that most IndexedDB tutorials use pattern `for (const msg of messages) { await store.add(msg) }`, which creates one transaction per iteration.

**How to avoid:**
- Always batch writes into bulk transactions
- Use `dexie`'s `bulkAdd()` or raw IndexedDB with a single transaction containing multiple `put()` calls
- Implement a "mergebounce" pattern: collect writes over 50ms, flush merged batch in one transaction
- Show import progress as batches complete (not per-message)
- Target 500–1000 messages per write transaction for optimal throughput
- Use relaxed durability (`transaction(db, 'readwrite', { durability: 'relaxed' })`) for import operations — this can be a strict durability upgrade after import

**Warning signs:**
- Import takes more than 2 seconds for 1,000 messages
- CPU usage spikes but storage barely grows
- Console shows rapid transaction creation
- Browser warns about unresponsive script

**Phase to address:**
Phase 2 (Storage & Data Model) — the storage layer must batch from day one. The import pipeline feeds into the batch system. Adding batching post-hoc requires refactoring the entire write path.

---

### Pitfall 3: Multiline Message Misalignment

**What goes wrong:**
Messages with line breaks are split into fragments — each fragment parsed as a separate message with fake timestamps. A 3-line message becomes 2 extra spurious messages (with no valid timestamp, assigned to the same sender or wrong sender). Message count inflates, search returns partial fragments, and conversation flow is broken.

**Why it happens:**
WhatsApp exports continuation lines of multi-line messages without a timestamp prefix. The line starts with content text, not a timestamp pattern. A naive line-by-line parser sees:
```
[1/15/24, 10:30 AM] Alice: First line
Second line
Third line
[1/15/24, 10:31 AM] Bob: Hello
```
A naive parser treats "Second line" and "Third line" as separate messages (or crashes). The fix requires look-ahead: a line that does not match the timestamp pattern is a continuation of the previous message.

**How to avoid:**
- Make multiline detection a first-class parsing concern, not an afterthought
- Use look-ahead parsing: read ahead lines until you find a valid timestamp pattern, then group all intermediate lines as message body
- Set a safety cap on message body length (e.g., `max_lines_per_message=1000`) to guard against corrupted exports where timestamp headers are lost
- Preserve `\n` in stored message body (don't strip or flatten)

**Warning signs:**
- Export contains more messages than WhatsApp shows
- Messages appear to be cut mid-sentence
- Search finds fragments of messages but not the full text
- Exported message count differs between iOS and Android exports of the same chat

**Phase to address:**
Phase 1 (Import & Parse) — the parser must implement look-ahead multiline grouping. Cannot be fixed in a later phase without reparsing all data.

---

### Pitfall 4: In-Memory Search Index Memory Blowout

**What goes wrong:**
With 50,000+ messages, a full-text search index built in-memory consumes 200–500MB of RAM. On mobile or lower-end devices, the tab crashes or the browser terminates the page. Users with years of chat history (100k–500k messages) are completely locked out of search.

**Why it happens:**
Client-side search libraries (Lunr.js, Fuse.js, Orama) build an inverted index *in JavaScript heap memory* by default. WhatsApp messages are short documents, but 100,000 messages × ~100 tokens each produces a 10M+ term index. Real-world case: Fika app hit ~300MB RAM for ~10k entities with Orama, and 100M characters of text was "crushing" for in-memory indexes.

The problem compounds when users import multiple chats — each chat adds to the index.

**How to avoid:**
- Use a persistent/disk-based search index, not in-memory:
  - **FlexSearch v0.8+ with IndexedDB adapter**: Persistent indexes stored in IndexedDB, ~10x less memory, sub-ms search latency after warmup
  - **SQLite WASM + FTS5**: Full BM25 scoring, disk-backed via OPFS or IndexedDB VFS
- Keep search index building in a Web Worker to avoid blocking the UI
- Build indexes lazily — index only when user first searches, not on import
- Consider chunking: separate indexes per chat rather than one monolithic index
- Show incremental indexing progress with a loading state

**Warning signs:**
- Search page load takes >3 seconds
- Memory usage spikes during first search
- Mobile browser kills the tab after search
- DevTools heap snapshot >200MB

**Phase to address:**
Phase 4 (Search) — must select a persistent-index search library from the start. Switching from in-memory to persistent after users have data requires full index rebuild.

---

### Pitfall 5: WhatsApp 40k Message Export Cap — Silent Data Loss

**What goes wrong:**
A user exports their 5-year group chat. The parser imports it successfully. Everything looks fine. But the last 3 years of messages are missing — silently. The export only contained the most recent 40,000 messages. There is no warning from WhatsApp or the parser.

**Why it happens:**
WhatsApp silently caps every chat export at the most recent 40,000 messages. There is no indicator in the export file that messages were truncated. The parser cannot detect this. The user believes they have a complete archive when they don't.

For long-running group chats, 40k messages can represent only 1–2 years of conversation.

**How to avoid:**
- Show a warning on import: "WhatsApp exports are limited to the 40,000 most recent messages. Older messages may not be included."
- Provide guidance on how to get older messages (Android Backup Extractor for `msgstore.db`, iMazing for iOS)
- Offer a "merge multiple exports" feature so users can export in overlapping date ranges and combine them
- Consider a "gaps detected" heuristic — if timestamps jump backward at the start of the file, warn the user

**Warning signs:**
- Chat history seems to start abruptly mid-conversation
- The last message date is recent but the first message date is suspiciously close to it
- Expected number of messages (based on chat duration × typical frequency) far exceeds parsed count

**Phase to address:**
Phase 1 (Import & Parse) — the importer should warn about the 40k cap at import time. Phase 5 (Multi-export merge) — a future merge feature mitigates this.

---

### Pitfall 6: IndexedDB Corruption with SQLite WASM + FTS5 + Page Refresh

**What goes wrong:**
A user imports a large chat, the app builds an FTS5 search index. The user refreshes the page during or shortly after the import. On next load, the database is corrupted: `"database disk image is malformed"`. All imported data is lost.

**Why it happens:**
Multiple known bugs in `IDBBatchAtomicVFS` (the IndexedDB storage layer for wa-sqlite) cause database corruption under specific conditions:
- FTS5 extension combined with batch atomic VFS can trigger writes that land outside the expected file boundaries (GitHub issue #258)
- `PRAGMA synchronous=OFF` with batch atomic guarantees zero journal protection and corrupts on any crash
- `PRAGMA cache_size` above a threshold triggers an Asyncify WASM memory reallocation bug that returns empty reads, reported as malformed database (#143, fixed in 0.9.11)
- Page refresh mid-transaction with `journal_mode=MEMORY` guarantees corruption with batch atomic

**How to avoid:**
- **Don't use `IDBBatchAtomicVFS` with FTS5 in production** — use `IDBMirrorVFS` (with fix from PR #259) or `OPFSCoopSyncVFS` instead
- Always use `PRAGMA journal_mode=DELETE` (not MEMORY or WAL) with IndexedDB-backed VFS
- Never use `PRAGMA synchronous=OFF` (or `PRAGMA synchronous=0`)
- Wrap import/indexing operations in explicit transactions with try/catch
- Implement a database health check on startup (`PRAGMA integrity_check`)
- Maintain a "last known good" backup of the database and restore on corruption detection
- Pre-grow WASM memory: `module._free(module._malloc(10000 * 4096 + 65536))` to prevent Asyncify reallocation bugs

**Warning signs:**
- `"database disk image is malformed"` error on page load
- Sporadic `SQL logic error` from SQLite
- Integrity check fails after large batch operations
- Users report data loss after page refresh

**Phase to address:**
Phase 2 (Storage & Data Model) — must decide on storage strategy (raw IndexedDB + FlexSearch vs SQLite WASM + FTS5) and bake in corruption safeguards from the start. Phase 4 (Search) must use the same storage backend consistently.

---

### Pitfall 7: No Deduplication / Duplicate Import Handling

**What goes wrong:**
A user exports the same chat twice (separate date ranges or accidentally), then imports both. The app now shows 2× the messages — every message appears twice. There's no way to undo without clearing everything and re-importing.

**Why it happens:**
WhatsApp exports don't include message IDs. The only stable identifiers are (timestamp + sender + text), but these can collide legitimately (two identical messages from the same person in the same second is rare but possible). Developers either ignore deduplication entirely or implement a brittle strategy that misses edges.

The problem compounds when users import overlapping date ranges: messages in the overlap are duplicated. The user has no UI to detect or resolve this.

**How to avoid:**
- Implement a deterministic deduplication hash: `SHA256(timestamp + sender + text + media_type)` as the message primary key
- On import, use "upsert" semantics: if a message with the same hash exists, skip it
- Show a pre-import summary: "This import contains X messages. Y of them already exist and will be skipped. Z are new."
- Allow the user to review skipped vs new messages before committing the import
- Store the import timestamp as metadata to allow manual rollback of a specific import session

**Warning signs:**
- Message counts are suspiciously round numbers (exact multiples of another chat)
- Searching for rare words returns identical messages in the same conversation
- Timeline view shows a "jump" where the same date range appears twice

**Phase to address:**
Phase 1 (Import & Parse) — dedup hash generation must be built into the parser. Phase 3 (UI — Chat View) must show pre-import diff. Retrofitting dedup after data is in storage is a migration nightmare.

---

### Pitfall 8: No Import Progress Feedback (The Frozen Tab Illusion)

**What goes wrong:**
User drags a 100MB export file onto the app. Nothing appears to happen for 30+ seconds. User assumes the app is broken, closes the tab, tries again — potentially corrupting a partial write. The actual import is progressing, but there's no visual feedback.

**Why it happens:**
Parsing a 50k-message export takes 2–10 seconds of JavaScript execution. Storing it in batches takes additional time. Developers either:
- Don't realize parsing is synchronous and blocks the UI
- Don't implement progress reporting because "the user will wait"
- Use a single `setTimeout(fn, 0)` at the end instead of yielding to the event loop

The `_chat.txt` parsing happens on the main thread. Without yielding (via `setTimeout`, `requestIdleCallback`, or Web Workers), the browser can't paint updates, so the progress bar never renders.

**How to avoid:**
- Move parsing to a **Web Worker** — message parsing is CPU-bound and blocks the main thread
- Report progress as a percentage (lines parsed / total lines, or batches stored / total batches)
- For the storage phase, report batch count: "Stored 12,500 / 50,000 messages"
- Use `requestAnimationFrame` or `postMessage` from the worker for progress updates
- If a Worker is not yet available, chunk the work with `setTimeout(fn, 0)` between batches to let the UI paint
- Show an indefinite spinner *immediately* on drop, then transition to progress bar once line count is known

**Warning signs:**
- Import takes >3 seconds with zero UI feedback
- "Page unresponsive" browser dialog appears during import
- Users open issues saying "app hangs on import"

**Phase to address:**
Phase 1 (Import & Parse) & Phase 3 (UI). The Worker architecture must be set up during import; the progress UI must exist before the first import attempt.

---

### Pitfall 9: Media Placeholder Fragility

**What goes wrong:**
Messages referencing media (images, videos, audio) appear as blank entries or garbled text. The app can't distinguish between `<Media omitted>`, `<image omitted>`, the actual filename (when media was included), and locale variants. Misclassification leads to "missing" messages in search results.

**Why it happens:**
WhatsApp media placeholders vary by:
- Whether media was included in the export (filename vs `<Media omitted>`)
- Device locale (English, Spanish, Hindi, etc.)
- Media type (image, video, audio, document, sticker, GIF)
- WhatsApp version (the placeholder format has changed over time)

A naive check for `"<Media omitted>"` misses `"Multimedia omitido"`, `"Immagine omessa"`, or the actual filename like `"VID-20230101-WA0001.mp4 (file attached)"`.

**How to avoid:**
- Use a regex pattern that matches known placeholder formats across locales
- Classify media messages into a typed field (`media_kind`: image, video, audio, document, sticker, GIF, deleted) rather than storing raw placeholder text
- When the actual filename is available, store it separately from the message body
- For `<Media omitted>`, preserve the media type hint even though content is absent — the user still wants to know "a photo was shared here"
- Treat `<Media omitted>` and deleted messages as separate types, not as text messages

**Warning signs:**
- Messages containing angle brackets in chat view (`<...>`)
- Media messages appearing as empty text messages in search results
- Different behavior when importing "with media" vs "without media" exports

**Phase to address:**
Phase 1 (Import & Parse) — media classification must be in the parser's type system. Phase 3 (UI — Chat View) renders the typed display.

---

### Pitfall 10: IndexedDB getAll() Memory Meltdown

**What goes wrong:**
Loading the chat list or performing a search calls `store.getAll()` on the messages object store. For a 100k-message database, this loads every message into JavaScript memory as individual structured clones. The browser freezes for 2–5 seconds, memory spikes to 500MB+, and on mobile, the tab crashes.

**Why it happens:**
`getAll()` is 10–20x faster than cursor iteration and is commonly recommended as a performance fix. But it fetches *every* record into memory at once. Each message undergoes the structured clone algorithm (deep copy). For 100k messages averaging 500 bytes each, that's ~50MB of raw data, ballooning to 200–400MB in JS heap due to object overhead.

**How to avoid:**
- Never call `getAll()` on the full messages store — always paginate or use range queries
- For the chat list view, store message metadata (id, timestamp, sender, preview snippet) in a separate lightweight store — not the full message body
- Use "chunked loading": cursor to collect keys, then `getAll(keyRange)` for pages of 100–500 messages at a time
- For search, use the search index (FlexSearch or FTS5) to get matching message IDs first, then fetch only those messages individually
- If using SQLite WASM, rely on SQL queries with LIMIT/OFFSET — the WASM engine handles paging internally

**Warning signs:**
- Loading the app after import takes >3 seconds
- "Page unresponsive" on initial data load
- Memory usage spikes when navigating between chats
- DevTools shows `getAll()` taking >500ms in the Performance tab

**Phase to address:**
Phase 2 (Storage & Data Model) — the data access layer must use pagination from day one. Phase 3 (UI — Chat View) must implement virtual scrolling to limit DOM nodes.

---

## Moderately Critical Pitfalls

### Pitfall 11: Timezone Agnosticism (Silent Shift)

**What goes wrong:**
Messages display with wrong times when viewed in a different timezone from the exporting device. The user can't tell if "3:00 PM" was their timezone or the sender's. The data model has no timezone field, and once stored, timestamps can't be corrected.

**Why it happens:**
WhatsApp exports timestamps in local device time with no timezone indicator. Developers store these as-is or attempt UTC conversion without knowing the offset. Either way, the original timezone context is lost. A message sent at 3:00 PM IST but viewed at 3:00 AM EST appears as "3:00 PM" — misleading, not wrong enough to notice immediately.

**How to avoid:**
- Store timestamps as the original string + parsed local datetime + a `timezone_offset` field (captured at import time from the browser)
- Display timestamps in the user's current timezone but with an indicator: "3:00 PM (imported from IST)"
- Document the limitation clearly: "Timestamps are in the exporting device's local time. Cross-timezone comparison may be inaccurate."
- Do NOT convert to UTC silently — this destroys information

**Warning signs:**
- Messages show timestamps in the future or past by several hours
- A conversation between two people in different timezones has messages "out of order"
- Importing the same export in different browsers shows different times

**Phase to address:**
Phase 1 (Import & Parse) — capture the browser's timezone offset at import time. The data model must include an optional timezone field.

---

### Pitfall 12: System Message Language Lock-In

**What goes wrong:**
The parser only detects English system messages. A user with a Spanish, Hindi, or Arabic WhatsApp exports a group chat. Every system message ("X joined", "Y left", "Group name changed to Z") is classified as a user message from a non-existent sender named "joined/left/Group name changed". Chat becomes cluttered with spurious user entries.

**Why it happens:**
WhatsApp system messages are translated into the exporting device's locale. The text "John joined using this group's invite link" in English becomes "John se ha unido usando el enlace de invitación de este grupo" in Spanish, "John beigetreten" in German, etc. System message classification patterns must cover all locales a user might encounter.

**How to avoid:**
- Make system message detection locale-agnostic where possible (no sender prefix before the colon, specific structural patterns)
- Maintain a per-locale pattern file for known system message texts (collected from WhatsApp's own localization strings)
- Support user-specified locale in parser config to select the right pattern set
- Fall back to structural detection (lines without `sender: content` pattern) when locale is unknown

**Warning signs:**
- Chat participants list includes names like "joined", "left", "changed"
- The first message of the chat is not from a known participant
- System events appear as user messages with empty names

**Phase to address:**
Phase 1 (Import & Parse). The system message classifier must support multiple locales from the start. Adding locale data later requires full re-import.

---

### Pitfall 13: IndexedDB Startup Latency Blindness

**What goes wrong:**
App loads, shows a blank screen or loading spinner, and stays there for 2–8 seconds. Users think the app is broken. On repeat visits, the delay is persistent because the IndexedDB database must be opened and verified.

**Why it happens:**
IndexedDB connection initialization time scales with database size. A 379MB database takes ~2 seconds to open on first load. As the database grows to 800MB, this can extend to 3+ seconds. On Apple M1 hardware, IndexedDB performance is ~6x worse than on Intel for certain operations.

The database must be "warmed up" — SQLite WASM initializes and loads metadata pages. Multiple database stores further compound the delay.

**How to avoid:**
- Don't block UI rendering on IndexedDB initialization — show shell UI immediately, load data in the background
- Implement optimistic UI rendering: show the last-viewed chat from session storage while IndexedDB initializes
- Use a single database (not multiple databases) to minimize initialization overhead
- Consider splitting databases per chat if initialization becomes problematic
- Pre-warm critical data: cache chat list metadata (names, last message, unread) in a small IndexedDB store separate from message bodies

**Warning signs:**
- App shell takes >1 second to show
- Loading spinner appears on every page load, even for returning users
- Chrome DevTools > Application > IndexedDB shows database open time >1s

**Phase to address:**
Phase 2 (Storage & Data Model) — startup architecture (optimistic vs blocking). Phase 3 (UI — Shell) must render without waiting for data.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Parse only one format (your own export) | Fast initial implementation. Ship faster. | Every user with a different locale/device gets corrupted data. Support burden explodes. | Never. Parsing is the foundation — format support must be comprehensive from day one. |
| Store messages as raw text without type field | Simpler data model, fewer columns. | Can't distinguish media from text. Search returns `<Media omitted>` as results. Media rendering impossible later. | Only in a throwaway prototype. Not for a real product. |
| Use per-message IndexedDB writes | Simplest code. Matches tutorials. | 25x slower import. Users abandon on large exports. Tab crashes. | Never. Batch writes are trivial to implement. |
| Single monolithic search index for all chats | Simpler search code. | Can't filter by chat. Rebuilding index touches everything. Memory scales with all chats combined. | Acceptable in MVP (v1) if using persistent IndexedDB-backed FlexSearch. Switch to per-chat indexes before adding multi-chat features. |
| Load all messages into memory with `getAll()` | Fastest reads. Simplest code. | Tab crash at ~100k messages. No mobile support. No scaling path. | Never in production. Always paginate. |
| No deduplication | Ship import faster. | Users re-import and get duplicates. No way to clean up. Trust destroyed. | Never. Dedup is trivial to implement at import time (hash on write). |
| Hardcode system message patterns in English | Quick localization support. | Spanish/Hindi/Arabic users get corrupted data. | Never. Use structural detection + locale-aware pattern files. |
| Skip pre-import preview | Faster import flow. | Users accidentally import wrong file. No chance to review duplicates. No undo. | Acceptable only in v0 prototype. Must add before v1. |
| Store messages without timezone info | Simpler datetime handling. | Timestamps ambiguous across timezones. Future timezone features impossible. | Never for a storage column. Acceptable only as a display concern if documented. |
| Implement search as `Array.filter().includes()` | Zero dependencies. Ships fast. | O(n) over 100k messages. Freezes UI. No relevance ranking. | Only for <1k messages. Not for production search. |
| No import progress feedback (blocking main thread) | Simplest implementation. | Users think app is frozen. Refresh mid-import → potential corruption. | Never. Always show progress. |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| **Drag-and-drop file input** | Only handling `.txt` files. WhatsApp exports can be `.zip` (when media included). | Accept both `.txt` and `.zip`. If ZIP, extract `_chat.txt` and ignore media files for now (store paths for future media rendering). |
| **File encoding detection** | Assuming UTF-8 without BOM. WhatsApp may export with BOM prefix. | Strip BOM bytes (`0xEF 0xBB 0xBF`) before any regex matching. Detect encoding from first 3 bytes. |
| **Line ending normalization** | Cross-platform issues: Android exports use CRLF (`\r\n`), macOS expects LF (`\n`). | Normalize all line endings to `\n` on input. Regex `$` anchors behave differently with trailing `\r`. |
| **IndexedDB version migration** | Changing schema without incrementing DB version → silent schema mismatch errors. | Always increment `db.version` when adding/changing object stores. Use `onupgradeneeded` for migration logic. Test migrations with real data. |
| **Browser storage quota** | Assuming unlimited IndexedDB. Browsers can evict data under storage pressure (especially Safari). | Request `navigator.storage.persist()` to mark storage as persistent. Warn users when approaching storage limits. |
| **Multiple tab access** | Two browser tabs both writing to IndexedDB simultaneously → race conditions or data loss. | Use a simple mutex via `navigator.locks.request()` (Web Locks API) for write operations. Or document as single-tab usage. |
| **Safari IndexedDB** | Safari's IndexedDB implementation has known stability issues with large databases and third-party cookie blocking. | Test specifically on Safari. Consider storing chat metadata separately. Safari has historically been the worst IndexedDB performer. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| **Cursor ping-pong** (per-item IDB iteration) | Loading 5k messages takes 2+ seconds. UI freezes on chat load. | Use `getAll(range, limit)` for paginated loads, or batch cursor (500 items per hop). | Breaks at ~1k messages on M1 Macs. Gets exponentially worse. |
| **Per-message transaction** | Import speed: ~0.5 msg/s. 50k messages takes 100+ seconds. | Batch writes: 500–1000 msgs/txn → ~80ms per 1k documents. | Breaks immediately. Even 100 messages is noticeably slow. |
| **In-memory search index** (Lunr/Fuse/Orama default) | Memory: 200–500MB for 50k messages. Tab crash on mobile. | FlexSearch with IndexedDB adapter or SQLite WASM FTS5. | Breaks at ~10k messages on mobile, ~50k on desktop. |
| **Naive `Array.filter().includes()` search** | Search takes 5–10 seconds. Blocks UI entirely during query. | Use a proper inverted index (FlexSearch, MiniSearch, FTS5). | Breaks at ~1k messages. Unusable beyond 5k. |
| **Loading full message bodies for chat list** | Chat list takes 3+ seconds to render. Uses `getAll()` = memory spike. | Store a lightweight "message summary" store (id, timestamp, sender, 100-char preview). | Breaks at ~20k messages. |
| **No virtual scrolling** | 50k DOM nodes for 50k messages. Browser struggles at 10k+, crashes at 100k+. | Virtual list rendering (only render visible + 2 screen buffers). 200 DOM nodes max. | Breaks at ~5k visible messages. |
| **SQLite WASM with `journal_mode=MEMORY`** | Page refresh during write = database corruption. | Always use `journal_mode=DELETE` with IndexedDB-backed VFS. | Breaks on first unexpected page refresh. |
| **Large key sizes in IndexedDB** (>100 bytes) | Query time increases linearly with key length. 200-byte keys with 50k records = 6s queries. | Use short keys: numeric IDs or short hashes. Avoid storing full UUIDs as primary keys. | Breaks at ~10k records with 200-byte keys in Chrome. |
| **Large value sizes in IndexedDB** (>1KB per record) | Read performance degrades linearly with value size. | Split message metadata (small) from message body (large). Store body separately or compress. | Breaks at ~50k records with 2KB average value size in Chrome. |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| **Storing chat data without `robots.txt` or auth if hosted** | Search engines index private WhatsApp conversations. | If deploying to a web server (even locally), add `robots.txt` with `Disallow: /`. Better: serve from a file:// URL or require authentication. |
| **XSS via message content** | User imports a chat where a message contains `<script>alert(1)</script>`. If rendered via `innerHTML`, it executes. | Always render message content via `textContent` or a sanitizer (DOMPurify). Never use `innerHTML` for message bodies. |
| **Path traversal via ZIP extract** | Malicious ZIP containing `../../etc/passwd` could escape extraction directory. | Validate extracted paths. Reject paths containing `..` or starting with `/`. |
| **IndexedDB cross-origin access** | Another site on the same origin could read the app's IndexedDB data. | None (by browser design). Mitigate by not hosting on shared subdomains. This is a deployment concern, not app-level. |
| **Export file sniffing** | Browser may try to render exported `.txt` or media files via MIME sniffing. | Serve export files with `Content-Type: text/plain` and `X-Content-Type-Options: nosniff`. |
| **No data deletion path** | User wants to delete all imported chats. No UI to clear IndexedDB. | Provide a "Clear all data" button that calls `indexedDB.deleteDatabase()`. Add individual chat deletion. |
| **Safari private browsing** | Safari may not persist IndexedDB data in private mode, causing data loss. | Detect private mode (test IndexedDB write on startup) and warn user. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| **No pre-import preview** | User imports wrong file or re-imports same chat → duplicates with no undo. | Show preview before commit: "52,341 messages found. 1,204 already imported. Import 51,137 new messages?" |
| **Chat view with no search affordance** | User can browse but can't find specific messages. Doesn't know search exists. | Prominent search bar in the UI, not hidden behind a menu. Search button visible in the header at all times. |
| **No search result count** | User searches "dog" and gets an empty page. No way to know if no results or search is still running. | Show "Searching..." during query, then "142 results for 'dog'" or "No results for 'dog'". |
| **No context around search results** | Search shows a message snippet but user can't tell which conversation or date it's from. | Show conversation name, date, and surrounding messages (context lines) for each search result. |
| **No import progress indicator** | User drags 100MB file. Nothing happens for 30 seconds. Clicks again → second import starts. | Show immediate spinner, then progress bar: "Parsing line 12,340 / 52,341...", then "Storing batch 15/53...". |
| **Dark mode only** | Users with light mode preference get blinded by dark screen. | Respect `prefers-color-scheme`. Default to system preference. |
| **No empty state** | User opens app for first time. Sees completely blank screen. No guidance. | Show onboarding: "Drag your WhatsApp export here to begin" with an illustration. |
| **No confirmation before clearing data** | User clicks "Delete" and all imported chats vanish instantly. No recovery. | "Delete all X chats? This cannot be undone." with explicit confirmation. |
| **Timestamps without context** | Message shows "3:00 PM" but user doesn't know if it's their time or sender's time. | Show "3:00 PM (local time at export)" in tooltip or label. |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces:

- [ ] **Parsing:** Works with iOS AND Android AND your own locale AND at least 3 other locale formats. Test with the chattopdf 24-fixture benchmark set.
- [ ] **Multiline messages:** Correctly groups continuation lines. Test with a message containing 10+ line breaks. Test with a message that is ONLY a newline.
- [ ] **System messages:** Correctly classifies joined/left/name-changed/encryption/admin-change messages in English AND at least 2 other languages (Spanish, Hindi).
- [ ] **Media placeholders:** Recognizes `<Media omitted>`, `<image omitted>`, `<video omitted>`, `<audio omitted>`, locale variants, and actual filenames — tested separately.
- [ ] **Deduplication:** Re-importing the same file produces zero new messages. Importing an overlapping date range only adds non-duplicate messages.
- [ ] **Search indexing:** Building the index doesn't freeze the UI. Progress is visible. Index survives page reload (persistent storage).
- [ ] **Search results:** Tapping a result scrolls to the message in context (not just the message in isolation).
- [ ] **Large chat handling:** 200k+ messages import without crash, display with virtual scrolling, search completes in <500ms.
- [ ] **Import cancellation:** User can cancel an import in progress. Partial data is cleaned up or marked as incomplete.
- [ ] **Data export:** User can export their imported data as JSON for backup. IndexedDB can be cleared without losing everything.
- [ ] **Storage persistence:** `navigator.storage.persist()` is requested. Data survives browser storage pressure in Chrome. Warns in Safari private mode.
- [ ] **Browser compatibility:** Works in Chrome, Firefox, and Safari. IndexedDB behavior differs significantly across browsers (Safari is worst). Test all three.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| **Parser misclassifies messages (wrong sender/date)** | HIGH — requires re-importing the source file | 1. Fix parser. 2. Add a "Re-import chat" button that clears and re-imports a specific chat. 3. Don't force user to re-import everything. |
| **Database corruption (SQLite WASM)** | HIGH — data loss if no backup | 1. Run `PRAGMA integrity_check` on startup. 2. If corrupted, attempt `PRAGMA quick_check`. 3. If unrecoverable, offer to restore from last backup or re-import source files. 4. Auto-backup on successful import completion. |
| **Duplicate messages from accidental re-import** | MEDIUM — requires dedup detection | 1. Add a "Remove duplicates" utility that finds and deletes messages with identical (timestamp + sender + text + media_type) hashes. 2. Show count before executing. 3. Make reversible (mark as hidden vs delete). |
| **User accidentally deleted all data** | MEDIUM — data loss if no backup | 1. Implement a "trash" retention period (24h) before permanent delete. 2. Or offer JSON export download before clearing. 3. Provide an "Undo" toast after delete action. |
| **Browser cleared IndexedDB (storage pressure)** | HIGH — total data loss | 1. Implement JSON export/backup feature in-app. 2. Warn user on startup if IndexedDB is unexpectedly empty. 3. Educate user: "Backup your chat data periodically." |
| **Import failed mid-way (partial data in DB)** | MEDIUM — incomplete data | 1. Wrap each import in a "session" with a unique session ID. 2. On startup, check for incomplete import sessions. 3. Offer to resume or rollback the partial import. |
| **Safari refuses to persist IndexedDB** | MEDIUM — data loss on tab close | 1. Detect private browsing mode on startup. 2. Show warning banner. 3. Suggest switching to Chrome/Firefox. 4. Offer download as JSON as workaround. |
| **Search index out of sync with messages** | LOW — rebuild required | 1. Add a "Rebuild search index" button in settings. 2. Show progress during rebuild. 3. Auto-detect inconsistency by comparing message count vs indexed document count. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Naive parser (single format) | Phase 1 (Import & Parse) | Pass chattopdf 24-fixture benchmark. Test with iOS, Android, English, Spanish, Arabic exports. |
| Per-message IndexedDB writes | Phase 2 (Storage & Data Model) | Time import of 50k messages: should be <10 seconds, not >2 minutes. |
| Multiline misalignment | Phase 1 (Import & Parse) | Test with 3-line, 10-line, and edge-case (newline-only) messages. Verify saved body preserves `\n`. |
| In-memory search index memory blowout | Phase 4 (Search) | Memory usage with 100k messages should be <50MB on search index. Not 200MB+. |
| WhatsApp 40k export cap | Phase 1 (Import & Parse) | Warning shown on every import. User guidance on multi-export merge. |
| SQLite WASM corruption | Phase 2 (Storage & Data Model) | `PRAGMA integrity_check` passes after 20 page refreshes during import. No "malformed" errors. |
| No deduplication | Phase 1 (Import & Parse) | Same file imported twice = exactly same message count. Overlapping import adds zero duplicates. |
| No import progress | Phase 1 + Phase 3 (UI) | Progress bar visible within 500ms of drag-and-drop. Updates at least every 2 seconds. |
| Media placeholder fragility | Phase 1 (Import & Parse) | `<Media omitted>` in 3 locales classified correctly. Filename references stored separately from text. |
| `getAll()` memory meltdown | Phase 2 (Storage & Data Model) | Loading 100k messages uses <50MB. Chat list renders in <500ms. |
| Timezone loss | Phase 1 (Import & Parse) | Timezone offset captured at import and stored alongside each chat's timestamps. |
| System message language lock-in | Phase 1 (Import & Parse) | Structural detection catches unknown languages. At minimum English + Spanish + Hindi patterns. |
| IndexedDB startup latency | Phase 2 (Storage & Data Model) | Shell UI renders in <200ms. Data loads in background. No blank screen >1s. |
| XSS via message content | Phase 3 (UI — Chat View) | `<script>alert(1)</script>` message renders as text, not executable script. |
| Storage persistence | Phase 2 (Storage & Data Model) | `navigator.storage.persist()` called on first data write. Confirmed persistent. |
| Virtual scrolling | Phase 3 (UI — Chat View) | 200k messages rendered with <200 DOM nodes. 60fps scrolling. |
| Search result context | Phase 4 (Search) | Tapping a search result scrolls to the message with surrounding messages visible. |

## Sources

- **chattopdf.app/research/whatsapp-export-benchmark-2026** — 24 fixture WhatsApp export benchmark covering date format families, multiline messages, system messages, and numeric normalization
- **wachattopdf.com/blog/whatsapp-data-export-structure** — Detailed analysis of WhatsApp export format structural complexity, locale variance, and timezone limitations
- **threadrecap.com** — Encoding pitfalls (UTF-8 BOM, CRLF line endings) in WhatsApp exports
- **generalistprogrammer.com** — Lessons from building a WhatsApp chat parser: edge cases consume 90% of development effort
- **rxdb.info/slow-indexeddb.html** — IndexedDB transaction overhead analysis: per-document vs batched, sharding strategies, relaxed durability
- **nolanlawson.com (IndexedDB performance series)** — Cursor vs getAll benchmarks, relaxed durability testing, paginated cursor implementations
- **loke.dev/blog/indexeddb-cursor-performance-bottleneck** — Chunked loading pattern for large IndexedDB datasets, structured clone overhead analysis
- **marksgarden.co.uk** — IndexedDB key/value size impact on performance, M1 hardware performance degradation
- **github.com/rhashimoto/wa-sqlite/issues/258** — Database corruption with IDBBatchAtomicVFS + FTS5 + page refresh
- **github.com/rhashimoto/wa-sqlite/issues/143** — Asyncify WASM memory reallocation bug causing empty reads / malformed database
- **github.com/rhashimoto/wa-sqlite/issues/111** — PRAGMA synchronous=OFF corruption with batch atomic VFS
- **github.com/rhashimoto/wa-sqlite/pull/259** — Fix for IDBMirrorVFS database corruption from unfilled blocks
- **sqlite.org/forum/forumpost/7823af6ccb** — SQLite batch atomic + synchronous=OFF sketchy behavior analysis
- **news.lavx.hu (Fika post-mortem)** — Real-world case study: Orama → FlexSearch migration, 300MB memory for 10k entities, 9-second mobile index rebuilds
- **nextapps-de/flexsearch** — Persistent IndexedDB adapter documentation, benchmark comparisons
- **github.com/subframe7536/sqlite-wasm** — SQLite WASM with FTS5, multiple IndexedDB/OPFS persistence strategies
- **github.com/KnugiHK/Whatsapp-Chat-Exporter/issues/218** — WhatsApp reply message parsing edge case (iOS ZMETADATA)
- **emmaakachukwu/whatsapp-chat-parser-rb** — Deterministic parsing patterns, platform handling structure
- **starkdmi/whats_json** — System message pattern generation from WhatsApp localization strings
- **github.com/inexorabletash** — W3C IndexedDB fulltext search proof-of-concept
- **opkode.com (mergebounce)** — Production experience with IndexedDB batch write optimization in Converse (XMPP chat client)
- **github.com/nshah1d/whatsapp-archive-viewer** — Zero-dependency WhatsApp archive viewer architecture patterns (virtual DOM, deduplication)
- **github.com/marcoshernanz/ChatVault** — Web Worker-based WhatsApp semantic search architecture

---

*Pitfalls research for: RagChat (WhatsApp chat export parser + RAG web app)*
*Researched: 2026-07-28*