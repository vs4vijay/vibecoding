# RagChat

## What This Is

A personal web app that imports WhatsApp chat exports, organizes them by group or contact, and provides chat-style viewing with keyword search and AI-powered Q&A. Designed as a single-user archive that grows with every export import — drag-drop a .txt file and instantly search your conversation history.

## Core Value

Import WhatsApp exports and instantly search/query your conversation history.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Import WhatsApp chat export .txt files (drag-drop + file picker)
- [ ] Parse WhatsApp export format into structured messages (sender, timestamp, content, media placeholders)
- [ ] Organize conversations by group/contact name with upsert semantics (create new / update existing)
- [ ] Display conversations in chat-style UI (message bubbles, timestamps, sender labels)
- [ ] Full-text keyword search across all messages
- [ ] Media placeholders in chat view for attached media (images, videos, audio)
- [ ] Local-first storage using IndexedDB or equivalent
- [ ] Data model designed for future export/sharing capability

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
| Web-first, PWA deferred | Faster iteration on core functionality | — Pending |
| Local-first storage (IndexedDB) | No backend, single-user, fully client-side | — Pending |
| Chat-style UI (bubbles) | Familiar to WhatsApp users | — Pending |
| Preview-before-import | User control over what gets merged | — Pending |
| Configurable RAG (future) | Local model by default, API key as upgrade | — Pending |

---

*Last updated: 2025-07-28 after initialization*
