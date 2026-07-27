# Roadmap: RagChat

## Overview

Five phases delivering a local-first WhatsApp chat archive: build a format-tolerant parser, persist to IndexedDB, import via drag-drop with preview, browse conversations in a chat-style UI, and search every message by keyword. Each phase unlocks the next — parser enables storage, storage enables import, import populates browsing, browsing contextualizes search.

## Phases

- [ ] **Phase 1: Parser Library** - Build format-tolerant WhatsApp export parser with type definitions
- [ ] **Phase 2: Storage Layer** - IndexedDB schema, repositories, and batch persistence
- [ ] **Phase 3: Import Feature** - Drag-drop import with Web Worker parsing and preview-before-commit
- [ ] **Phase 4: Chat Browsing** - Conversation sidebar, chat-style bubble UI, and virtual scrolling
- [ ] **Phase 5: Full-Text Search** - Keyword search across and within conversations with result navigation

## Phase Details

### Phase 1: Parser Library
**Goal**: WhatsApp export text can be reliably parsed into structured messages regardless of format variant (iOS bracketed, Android dash-separated, 14+ locale families)
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: IMPR-04
**Success Criteria** (what must be TRUE):
  1. System correctly parses iOS (bracketed) and Android (dash-separated) WhatsApp export formats
  2. Multi-line messages are correctly grouped as single messages (not fragmented into spurious entries)
  3. Each parsed message has a deterministic dedup hash and is classified as text, media (with type), or system event (join/leave/name change)
  4. Parser detects the 40K message export cap and surfaces a warning
  5. Parser passes the chattopdf 24-fixture benchmark covering 14+ date format families
**Plans**: TBD
**Notes**: Pure library — no UI, no storage, no Worker. Testable from terminal. The 24-fixture benchmark is the coverage target.

---

### Phase 2: Storage Layer
**Goal**: Parsed messages persist in IndexedDB and can be queried efficiently — schema versioning, repositories, batch writes, paginated reads
**Mode**: mvp
**Depends on**: Phase 1 (uses types from parser)
**Requirements**: IMPR-06
**Success Criteria** (what must be TRUE):
  1. Chat and message tables exist with correct indexes: compound index on `[chatId+timestamp]`, multiEntry `terms` index for search
  2. Bulk inserts of 500–1000 messages per transaction complete within acceptable time (no per-message transactions)
  3. Messages load via cursor-based pagination (never via `getAll()` on full message store)
  4. `navigator.storage.persist()` is requested on first data write for storage durability
  5. Database versioning and migration path exist for future schema changes
**Plans**: TBD
**Notes**: Pure infrastructure — no UI. Dexie.js schema defined here is used by all downstream phases.

---

### Phase 3: Import Feature
**Goal**: Users can import WhatsApp exports by drag-drop or file picker, see a preview of detected messages, and confirm or cancel before data is committed
**Mode**: mvp
**Depends on**: Phase 1 (parser), Phase 2 (storage)
**Requirements**: IMPR-01, IMPR-02, IMPR-03, IMPR-05
**Success Criteria** (what must be TRUE):
  1. User can drag-and-drop `.txt` files onto the app to trigger import
  2. User can click a file picker button to select `.txt` files (also accepts `.zip`)
  3. User sees a preview of detected messages — total count, date range, participants, first N sample messages — before committing
  4. System detects if a chat already exists and shows new vs. skipped message counts (upsert)
  5. User can confirm or cancel the import; cancellation cleans up any partial data
  6. Import progress is visible — immediate spinner on drop, progress bar during parse/store
**Plans**: TBD
**UI hint**: yes
**Notes**: First phase with user-facing UI. Parsing runs in a Web Worker (off-main-thread). Prevents data corruption via deterministic dedup hashing from Phase 1.

---

### Phase 4: Chat Browsing
**Goal**: Users can browse their imported conversations in a WhatsApp-style chat interface with sender labels, timestamps, media placeholders, and virtual scrolling
**Mode**: mvp
**Depends on**: Phase 2 (storage), Phase 3 (data populated)
**Requirements**: BROW-01, BROW-02, BROW-03, BROW-04
**Success Criteria** (what must be TRUE):
  1. User sees a sidebar listing all imported conversations sorted by most recent message
  2. User clicks a conversation and messages display in WhatsApp-style bubble layout with sender labels and timestamps
  3. Messages with media attachments show typed placeholders (image, video, audio icons) — no actual media rendering
  4. Virtual scrolling keeps rendered DOM nodes under ~200 regardless of total message count (supports 100K+ message chats)
  5. Dark mode respects system `prefers-color-scheme` by default with manual toggle
**Plans**: TBD
**UI hint**: yes
**Notes**: Builds reactive chat query layer on Dexie `liveQuery()`. Media rendering is deferred — placeholders only in v1.

---

### Phase 5: Full-Text Search
**Goal**: Users can search their conversation history by keyword — across all conversations or within a specific one — with highlighted results and navigation back to the source message
**Mode**: mvp
**Depends on**: Phase 2 (search index), Phase 4 (result navigation UI)
**Requirements**: SRCH-01, SRCH-02, SRCH-03
**Success Criteria** (what must be TRUE):
  1. User can search across all conversations from a search bar in the app header
  2. User can search within a specific conversation from that conversation's view
  3. Search results show matching messages with highlighted keywords, sender name, timestamp, and conversation name
  4. User clicks a search result and the app navigates to that conversation, scrolled to that specific message
  5. Search results display result count (e.g., "142 results for 'birthday'")
**Plans**: TBD
**UI hint**: yes
**Notes**: Search index strategy needs a decision — Orama (forward-compatible with future RAG) vs Dexie multiEntry index (no extra dependency). Research recommends Orama for strategic alignment with v2 vector search.

---

## Research Flags

| Phase | Flag | Resolution |
|-------|------|------------|
| Phase 5 | Orama persistent index vs Dexie multiEntry index — both viable, affects v2 migration path | Research recommends Orama for forward compatibility with vector search in v2; confirm during Phase 5 planning |

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Parser Library | 0/0 | Not started | - |
| 2. Storage Layer | 0/0 | Not started | - |
| 3. Import Feature | 0/0 | Not started | - |
| 4. Chat Browsing | 0/0 | Not started | - |
| 5. Full-Text Search | 0/0 | Not started | - |
