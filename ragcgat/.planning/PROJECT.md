# RagChat

## What This Is

A personal web app that imports WhatsApp chat exports, organizes them by group or contact, and provides chat-style viewing with keyword search and AI-powered Q&A. Designed as a single-user archive that grows with every export import — drag-drop a .txt file and instantly search your conversation history.

## Core Value

Import WhatsApp exports and instantly search/query your conversation history.

## Requirements

### Validated (v1.0 — shipped 2026-09-12)

- [x] Import WhatsApp chat export .txt files (drag-drop + file picker; .zip with _chat.txt also supported)
- [x] Parse WhatsApp export format into structured messages (sender, timestamp, content, media placeholders)
- [x] Organize conversations by group/contact name with upsert semantics (create new / merge into existing)
- [x] Display conversations in chat-style UI (message bubbles, timestamps, sender labels, capped windowing)
- [x] Full-text keyword search across all messages and within a conversation (exact counts, highlighted results, scroll-to-message deep links)
- [x] Media placeholders in chat view for attached media (images, videos, audio, documents, stickers, GIFs)
- [x] Local-first storage using IndexedDB (Dexie, schema v1→v3)
- [x] Data model designed for future export/sharing capability (deterministic dedup hashes, stable ids, denormalized stats)

Bonus (not originally scoped): dark mode with OS detection + persisted toggle; svelte-check in the standard gate set.

### Out of Scope

- Media rendering (images, video, audio playback) — placeholders only for now
- PWA installation / offline support — web app first
- Share target / intent integration — import via drag-drop and file picker
- RAG / AI-powered Q&A — keyword search covers v1
- Multi-user or cloud sync

## Context

Personal project to archive and make searchable the user's WhatsApp conversation history. The app should feel familiar to WhatsApp's own chat UI. Built as a single-page web app with local-first storage. The user intends to eventually add PWA capabilities, share-intent integration, and RAG-based Q&A, but those are explicitly deferred past v1.

## Constraints

- **Storage**: Must run entirely client-side using IndexedDB or equivalent — no backend server
- **Import**: Must handle standard WhatsApp .txt export format
- **Portability**: Data model should support future migration to cloud/export

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Web-first, PWA deferred | Faster iteration on core functionality | ✅ Validated — v1.0 shipped web-only |
| Local-first storage (IndexedDB) | No backend, single-user, fully client-side | ✅ Validated — Dexie v1→v3, 270 tests green |
| Chat-style UI (bubbles) | Familiar to WhatsApp users | ✅ Validated — Phase 4 UAT manual pass |
| Preview-before-import | User control over what gets merged | ✅ Validated — new/skipped diff on every import |
| Custom parser over npm packages | 14+ format families need first-class tolerance | ✅ Validated — 24-fixture benchmark green |
| Dexie multiEntry over Orama (v1 search) | Query layer pre-built; native persistence; v2 RAG picks its own vector store | ✅ Validated — 05-UAT 8/8 |
| Capped-window over full virtualization | 120 rows ≤ 200 budget covers 100K msgs via keyset pagination | ✅ Validated — budget never trips |
| Configurable RAG (future) | Local model by default, API key as upgrade | Pending — v2 |

*Last updated: 2026-09-13 — v1.0 milestone close (audit: v1.0-MILESTONE-AUDIT.md)*

