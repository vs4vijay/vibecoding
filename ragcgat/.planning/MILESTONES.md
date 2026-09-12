# Project Milestones: RagChat

[Entries in reverse chronological order - newest first]

## v1.0 MVP — Import, Browse, Search (Shipped: 2026-09-12)

**Delivered:** Local-first WhatsApp archive web app — drag-drop .txt/.zip export import with preview and dedup, IndexedDB persistence, WhatsApp-style browsing with bounded windowing, and keyword search across/within chats with highlighted results and deep-linkable scroll-to-message navigation.

**Phases completed:** 1-5 (11 plans total)

**Key accomplishments:**
- Format-tolerant parser verified against a 24-fixture benchmark (14+ timestamp families, multiline grouping, dedup hashes, media classification)
- Versioned Dexie storage (v1→v3) with batched idempotent writes and limit-bounded reads
- Import vertical slice: worker parsing, .zip extraction, preview-before-commit, upsert merge
- Chat browsing: liveQuery sidebar, capped-window bubble view (100K-message safe), dark mode with no FOUC
- Full-text search: exact-count newest-first results, `<mark>` highlighting, ?at= deep links with scroll-to-message seek
- Two manual browser UAT passes; 5 defects found and fixed; gates: 270 tests, typecheck, svelte-check, biome, build — all green

**Stats:**
- 68 source files (TS + Svelte), 5,639 LOC
- 5 phases, 11 plans
- Project initialized 2026-07-28; phases 1-5 executed 2026-09-06 → 2026-09-12

**Git range:** Phase 1 parser commits → `1a9f2fa` (feat: Phase 05 search UI + result navigation)

**Known debt at close:** 10 acknowledged findings (see .planning/v1.0-MILESTONE-AUDIT.md); decision-worthy: dedup scope (N6)

**What's next:** v2 candidates — PWA install/offline/share-target, RAG Q&A (Transformers.js + vector search), bookmarks, analytics, data export

---
