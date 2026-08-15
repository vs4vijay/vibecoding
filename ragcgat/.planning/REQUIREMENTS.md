# Requirements: RagChat

**Defined:** 2025-07-28
**Core Value:** Import WhatsApp exports and instantly search/query your conversation history

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Import

- [ ] **IMPR-01**: User can drag and drop WhatsApp .txt export files onto the app
- [ ] **IMPR-02**: User can select WhatsApp .txt export files via file picker
- [ ] **IMPR-03**: User sees a preview of detected messages before import confirms
- [ ] **IMPR-04**: System parses WhatsApp export format into structured messages (sender, timestamp, content, media type)
- [ ] **IMPR-05**: System detects if an imported chat already exists and upserts (creates new or merges into existing)
- [ ] **IMPR-06**: System stores all data locally in IndexedDB

### Chat Browsing

- [ ] **BROW-01**: User sees a sidebar listing all imported conversations by group/contact name
- [ ] **BROW-02**: User can click a conversation to view messages in chat-style bubble UI
- [ ] **BROW-03**: Messages display sender name, timestamp, and content in familiar WhatsApp-style layout
- [ ] **BROW-04**: Media attachments (images, video, audio) show as placeholders (e.g., "📷 Image" icon)

### Search

- [ ] **SRCH-01**: User can search across all messages in all conversations by keyword
- [ ] **SRCH-02**: User can search within a specific conversation by keyword
- [ ] **SRCH-03**: Search results show message context and link back to the conversation

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### PWA & Mobile

- **PWA-01**: App is installable as PWA on mobile devices
- **PWA-02**: App supports share target intent (receive WhatsApp export from share sheet)
- **PWA-03**: App works offline after initial load

### AI / RAG

- **RAG-01**: User can ask natural language questions about chat content
- **RAG-02**: System retrieves relevant messages and generates answers with citations
- **RAG-03**: Configurable backend (local model via Transformers.js or API key)

### Advanced

- **ADVN-01**: Dark mode toggle
- **ADVN-02**: Bookmark important messages
- **ADVN-03**: Calendar-based navigation
- **ADVN-04**: Cross-chat analytics (message counts, activity patterns)
- **ADVN-05**: Data export for backup or migration

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud sync / multi-device | Local-first only; data model supports future migration |
| Real-time WhatsApp integration | Not a WhatsApp client — purely archive-based |
| Media rendering (images/video/audio) | Placeholder only; full media support deferred |
| Multi-user accounts | Single-user personal archive |
| Voice message transcription | Deferred to future phase |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| IMPR-01 | Phase 3 | Pending |
| IMPR-02 | Phase 3 | Pending |
| IMPR-03 | Phase 3 | Pending |
| IMPR-04 | Phase 1 | Pending |
| IMPR-05 | Phase 3 | Pending |
| IMPR-06 | Phase 2 | Pending |
| BROW-01 | Phase 4 | Pending |
| BROW-02 | Phase 4 | Pending |
| BROW-03 | Phase 4 | Pending |
| BROW-04 | Phase 4 | Pending |
| SRCH-01 | Phase 5 | Pending |
| SRCH-02 | Phase 5 | Pending |
| SRCH-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✅

---

*Requirements defined: 2025-07-28*
*Last updated: 2025-07-28 after initial definition*
