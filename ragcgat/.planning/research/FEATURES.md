# Feature Research

**Domain:** Personal WhatsApp chat archive viewer with search and AI-powered Q&A
**Researched:** 2026-07-28
**Confidence:** HIGH

## Feature Landscape

The competitive landscape falls into four categories: (1) browser-based local viewers (e.g., whats-reader, whatsapp-backup-viewer, ChatParser), (2) desktop offline apps (e.g., ChatXport), (3) analysis/statistics tools (e.g., ChatStats, WhatStats, Chatilyzer), and (4) AI recap tools (e.g., ThreadRecap, Lucen, Chattier). This project (RagChat) occupies a unique intersection: a persistent local-first archive with chat-style viewing *and* AI-powered Q&A, which no existing tool combines well.

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken. Every WhatsApp archive viewer surveyed ships these.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **WhatsApp .txt/.zip export import** | The entire product is useless without this — it's the entry point | LOW | Drag-drop + file picker; accept both `.txt` (text-only) and `.zip` (with media) exports |
| **Multi-format parser** | WhatsApp uses different date/sender formats per platform (iOS vs Android) and locale (US, EU, TR, etc.) | MEDIUM | Must handle iOS bracketed `[DD.MM.YYYY, HH:MM:SS] Name:` and Android dash-separated `DD/MM/YYYY, HH:MM - Name:` across locales; handle RTL markers, multiline messages |
| **Chat-style bubble UI** | Users expect the familiar WhatsApp Web look — green/gray bubbles, sender labels, timestamps | MEDIUM | Recreates WhatsApp Web visual language; green bubbles for "me", gray for others; date separators between days; system messages styled differently |
| **Group chat support** | Group exports are among the most common use cases; users expect sender names | LOW | Parses sender names from each message line, renders them in bubbles; color-hashed avatars optional |
| **Full-text search** | The core reason to have a digital archive — find that one message from years ago | MEDIUM | Instant search across all messages in a chat; highlight matches; navigate between results |
| **Media placeholders** | WhatsApp exports reference media as `<Media omitted>` or filename markers; users need to see what was shared | LOW | Render `[image omitted]`, `[video omitted]`, filenames as styled placeholders or inline previews when ZIP contains the actual files |
| **Light/dark mode** | Table stakes for any modern web app; users expect system-preference detection | LOW | Respect `prefers-color-scheme`; manual toggle optional; persist preference |
| **Local processing (privacy)** | Every competitor leads with "your data never leaves your device" — this is now table stakes, not a differentiator | LOW | All parsing in-browser via `FileReader`/`JSZip`; no upload to any server; no telemetry |
| **Import preview** | Users need to verify the parser got their chat right before committing to storage | LOW | Show first N messages after parsing; let user confirm sender mapping ("this is me") |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable for the long-term vision. RagChat's unique angle is *persistent archive with RAG Q&A* — most tools are ephemeral viewers or pure analytics.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Persistent local storage (IndexedDB)** | Most viewers re-parse the export every time you visit; persistent storage means fast re-opening, cross-session bookmarks, and the ability to accumulate an archive over years | MEDIUM | IndexedDB schema stores parsed messages, conversations, metadata; Dexie.js or idb wrapper; must handle incremental imports (upsert semantics) |
| **Multiple conversation management** | Single-user archive that grows with every export — organize by group/contact name, switch between conversations, see a list of all imported chats | MEDIUM | Sidebar list of conversations sorted by most recent message; each shows name, last message preview, date, message count |
| **AI-powered Q&A (RAG)** | Ask natural-language questions across your conversation history: "What did we decide about the venue?" or "When did Sarah say she was arriving?" | HIGH | Future phase (explicitly deferred in PROJECT.md); retrieval-augmented generation over indexed messages; local model by default, API key as upgrade |
| **Cross-chat search** | Search across *all* imported conversations at once, not just one at a time | MEDIUM | Full-text index across all messages in all conversations; show results grouped by conversation with context snippets |
| **Chat merge / deduplication** | Users export the same chat multiple times (months apart). Merging exports chronologically with deduplication reconstructs the full conversation across time | HIGH | Detect sibling exports (same contact, overlapping date ranges); deduplicate by timestamp+sender+content+type (4-field deterministic hash); rare but highly valued when needed |
| **Bookmarks / saved messages** | Mark important messages (decisions, addresses, dates) for quick recall | LOW | Per-message bookmark toggle; bookmarks view filters to show only saved messages; export bookmarks |
| **Analytics dashboard** | Message counts per participant, activity heatmaps, most active hours, emoji/sentiment trends | MEDIUM | Stats view (tab or page) with charts; message distribution over time, sender breakdown, busiest day, streak tracking |
| **Voice note transcription (Whisper)** | WhatsApp exports include `.opus` audio files; local Whisper via WebGPU transcribes them inline | HIGH | Requires WebGPU + Transformers.js; adds significant value for voice-heavy chats; Phase 2+ candidate |
| **Calendar / timeline navigation** | Jump to a specific date or month instead of endless scrolling | MEDIUM | Date-picker or scrollable timeline; "Jump to date" button; calendar heatmap showing activity density |
| **PDF / HTML export** | Generate a self-contained HTML or PDF of a conversation for sharing or offline reading | MEDIUM | Rendered view as a standalone file; watermark-free; includes messages + date context |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems for this project's scope.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Server-side / cloud sync** | "Access my archive from any device" | Defeats the core local-first, no-backend constraint; adds auth, hosting, sync conflict complexity | Future: export/import JSON archive between devices; PWA with Share Target for receiving exports |
| **Real-time WhatsApp integration** | "I want it to auto-import new messages" | WhatsApp's terms prohibit third-party live access; impossible without reverse-engineering WhatsApp Web protocol | Users manually export periodically; the archive grows with each export and merge |
| **Multi-user / shared archives** | "Share this archive with my family/friend/team" | Adds auth, permissions, conflict resolution, invites — massive scope expansion for a personal tool | Single-user archive; PDF export is the sharing mechanism; future: read-only share links (like sabrieker/whatsapp-archive does) |
| **Media editing / manipulation** | "Crop photos, trim audio clips" | Drift into media-editing territory; adds complexity without serving the core archive+search purpose | Show media inline; download original files; leave editing to dedicated tools |
| **Social features (comments, reactions)** | "React to old messages, leave notes" | Blurs the line between archive and social platform; users want to *read* history, not *participate* in it | Bookmark + notes per message is the boundary; leave reactions at that |
| **Full media extraction library** | "View all my photos as a gallery" | WhatsApp export includes media files in the ZIP but rendering them all requires building a full media player | Media grid view with thumbnails and basic playback (images, video placeholder, audio waveform) |
| **Delete messages from archive** | "I want to remove embarrassing messages" | Content integrity — the archive is a historical record; deletion could be mistaken for source-of-truth editing | Mark messages as "hidden" (not deleted); hidden view toggle; no destructive operations on source data |

## Feature Dependencies

```
WhatsApp .txt/.zip import
    └──requires──> Multi-format parser
                       └──requires──> Message data model (types.ts)

Import preview
    └──requires──> Multi-format parser

Chat-style bubble UI
    └──requires──> Message data model
    └──requires──> Multi-format parser

Full-text search
    └──requires──> Persistent local storage (IndexedDB)
                       └──requires──> Message data model

Multiple conversation management
    └──requires──> Persistent local storage (IndexedDB)

Group chat support
    └──requires──> Multi-format parser (sender extraction)

Bookmarks
    └──requires──> Persistent local storage (IndexedDB)
    └──requires──> Chat-style bubble UI

Cross-chat search
    └──requires──> Full-text search
    └──requires──> Multiple conversation management

Analytics dashboard
    └──requires──> Persistent local storage (IndexedDB)
    └──requires──> Message data model

Calendar / timeline navigation
    └──requires──> Chat-style bubble UI
    └──requires──> Persistent local storage (IndexedDB)

Chat merge / deduplication
    └──requires──> Multi-format parser
    └──requires──> Persistent local storage (IndexedDB)
    └──requires──> Multiple conversation management

AI-powered Q&A (RAG) ──deferred──> Future phase
    └──requires──> Full-text search
    └──requires──> Persistent local storage (IndexedDB)

Voice note transcription
    └──requires──> Multi-format parser (media reference extraction)

PDF / HTML export
    └──requires──> Chat-style bubble UI
    └──requires──> Persistent local storage (IndexedDB)

Dark mode ──no dependencies──> Pure UI feature
```

### Dependency Notes

- **WhatsApp import requires multi-format parser:** The parser is the core transformation step — raw `_chat.txt` lines → structured `Message[]`. Everything downstream depends on this data model.
- **Full-text search requires IndexedDB:** In-memory search doesn't scale across sessions or large archives. IndexedDB enables indexed queries via Dexie.js or similar. This means the storage layer (Phase 2) must precede search (Phase 3).
- **Cross-chat search requires both full-text search and conversation management:** You need the index built per-chat and the ability to query across all chat stores.
- **Chat merge is the most complex feature:** It requires deterministic deduplication, chronological interleaving from multiple source files, and correct handling of partial overlaps. This is a Phase 2+ feature due to its testing surface.
- **AI Q&A requires persistent storage:** The RAG pipeline needs a stable message corpus to index and retrieve from. It also needs the full-text search index as its retrieval backbone.

## MVP Definition

### Launch With (v1)

The minimal feature set that makes the app useful: import, view, search, persist.

- [x] **WhatsApp .txt/.zip import (drag-drop + file picker)** — entry point; without this the app does nothing
- [x] **Multi-format parser (iOS + Android, multiple locales)** — correctly handles the user's actual export format
- [x] **Chat-style bubble UI (WhatsApp Web-like)** — makes the archive feel familiar and readable
- [x] **Full-text keyword search** — the core value: "find that message"
- [x] **Group chat support with sender labeling** — most exports are group chats
- [x] **Light/dark mode** — table stakes UX expectation
- [x] **Local-only processing (no uploads)** — privacy is table stakes, not a feature
- [x] **Import preview** — user verification before persisting
- [x] **Basic conversation sidebar** — list all imported chats, switch between them
- [x] **Media placeholders** — show what was shared even without rendering media

### Add After Validation (v1.x)

Features to add once core is working and the user has had a chance to use it.

- [ ] **Persistent IndexedDB storage** — the current v1 likely re-parses on each visit (acceptable for MVP); persistence adds cross-session access and is the foundation for all later features
- [ ] **Multiple conversations from sidebar** — store and switch between multiple imported chats
- [ ] **Bookmarks** — lets the user curate their archive during real use
- [ ] **Calendar / timeline navigation** — common request from users with years of history
- [ ] **Analytics dashboard** — "what's in my archive?" stats; motivates the user to import more chats
- [ ] **Cross-chat search** — once multiple conversations are imported, users will ask "search everything"

### Future Consideration (v2+)

Features deferred until product-market fit is established and the archive is working well.

- [ ] **AI-powered Q&A (RAG)** — the stated long-term vision, but deferred per PROJECT.md; requires persistence + full-text search + AI model integration
- [ ] **Chat merge / deduplication** — complex to implement well; users only need it after multiple exports of the same chat
- [ ] **Voice note transcription (Whisper)** — technically advanced (WebGPU); adds dimension to voice-heavy chats
- [ ] **PDF / HTML export** — nice-to-have for sharing; not needed for the core archive experience
- [ ] **PWA / share target** — installability + receiving exports from WhatsApp's share sheet; deferred per PROJECT.md
- [ ] **JSON archive export** — data portability, future cloud migration

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| WhatsApp .txt/.zip import | HIGH | LOW | P1 |
| Multi-format parser | HIGH | MEDIUM | P1 |
| Chat-style bubble UI | HIGH | MEDIUM | P1 |
| Full-text keyword search | HIGH | MEDIUM | P1 |
| Group chat support | HIGH | LOW | P1 |
| Light/dark mode | MEDIUM | LOW | P1 |
| Local-only processing | HIGH | LOW | P1 |
| Import preview | MEDIUM | LOW | P1 |
| Basic conversation sidebar | HIGH | LOW | P1 |
| Media placeholders | MEDIUM | LOW | P1 |
| Persistent IndexedDB storage | HIGH | MEDIUM | P2 |
| Multiple conversations | HIGH | MEDIUM | P2 |
| Bookmarks | MEDIUM | LOW | P2 |
| Calendar / timeline navigation | MEDIUM | MEDIUM | P2 |
| Analytics dashboard | MEDIUM | MEDIUM | P2 |
| Cross-chat search | MEDIUM | MEDIUM | P2 |
| AI-powered Q&A (RAG) | HIGH | HIGH | P3 |
| Chat merge / deduplication | LOW | HIGH | P3 |
| Voice note transcription | MEDIUM | HIGH | P3 |
| PDF / HTML export | MEDIUM | MEDIUM | P3 |
| PWA / share target | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | ChatXport | whats-reader | WhatsApp Backup Viewer | whatsapp-chat-export-viewer | ThreadRecap | RagChat (This Project) |
|---------|-----------|-------------|----------------------|----------------------------|-------------|------------------------|
| **Local processing** | ✅ Desktop offline | ✅ Browser + Electron | ✅ Browser only | ✅ Browser only | ⚠️ Parses locally, sends text for AI | ✅ Browser only |
| **Chat-style bubble UI** | ✅ 3 views (bubble/table/timeline) | ✅ Bubble | ✅ Bubble | ✅ WA Web-style | ❌ Text report | ✅ Bubble |
| **Multi-format parser** | ✅ | ✅ | ✅ | ✅ (best I've seen — 15+ locale variants) | ✅ | ✅ (planned) |
| **Full-text search** | ✅ Cross-chat | ✅ | ✅ | ⏳ (on roadmap) | ✅ | ✅ |
| **Persistent storage** | ✅ | ❌ (re-parses) | ✅ IndexedDB | ❌ (re-parses) | ❌ (session only) | ✅ (planned P2) |
| **Multiple conversations** | ✅ Workspaces | ❌ (single chat) | ✅ | ❌ (single chat) | ❌ (single chat) | ✅ (planned P2) |
| **AI Q&A** | ❌ | ❌ | ❌ | ❌ | ✅ (structured reports + follow-up Q) | ✅ (deferred P3) |
| **Voice transcription** | ❌ | ✅ Whisper (local, WebGPU) | ❌ | ❌ | ✅ Whisper (server-side) | ⏳ (deferred P3) |
| **Analytics** | ✅ | ✅ Stats + charts | ✅ Deep analytics | ❌ | ✅ Structured reports | ⏳ (planned P2) |
| **Bookmarks** | ✅ With notes | ✅ With notes | ❌ | ❌ | ❌ | ⏳ (planned P2) |
| **Media inline** | ✅ | ✅ Gallery view | ✅ Gallery view | ✅ Inline rendering | ❌ (text only) | ⏳ (placeholders in P1) |
| **Chat merge/dedup** | ❌ | ❌ | ❌ | ❌ | ❌ | ⏳ (deferred P3) |
| **PDF export** | ✅ | ⏳ (on roadmap) | ❌ | ❌ | ✅ | ⏳ (deferred P3) |
| **Dark mode** | ✅ | ✅ | ✅ | ✅ (WA Web palette) | ❌ | ✅ |
| **Open source** | ❌ (proprietary) | ✅ AGPL-3.0 | ✅ | ✅ (MIT) | ❌ (proprietary) | ✅ |
| **Pricing** | Free tier + $29–$69 one-time | Free | Free | Free | Free + $2 credit packs | Free |
| **PWA** | ❌ (Electron desktop) | ❌ | ✅ | ❌ | ❌ | ⏳ (deferred) |

**Key insight:** No existing tool combines *persistent multi-chat archive* with *AI-powered Q&A*. ThreadRecap has AI but no persistent browsing or media. ChatXport has persistence but no AI. whats-reader has transcription and bookmarks but no persistent multi-conversation management. RagChat's unique position is the intersection: a local-first persistent archive that you can both browse and query with AI.

## Sources

- [ChatXport](https://www.chatxport.com/) — Desktop offline viewer with 3 view modes, bookmarks, PDF/XLS export. Pricing: free 300-msg tier, Personal $29, Pro $69.
- [whats-reader (rodrigogs)](https://github.com/rodrigogs/whats-reader) — Open-source SvelteKit/Electron viewer with Whisper voice transcription, bookmarks, perspective mode, statistics. AGPL-3.0.
- [WhatsApp Backup Viewer (itxshakil)](https://github.laiyagushi.com/itxshakil/whatsapp-backup-viewer) — React 19 + Dexie.js viewer with analytics, media gallery, PWA support.
- [whatsapp-chat-export-viewer (mutluksap)](https://github.com/mutluksap/whatsapp-chat-export-viewer) — Next.js viewer with best-in-class multi-locale parser (15+ variants), WA Web-style UI, MIT license.
- [ThreadRecap](https://www.threadrecap.com/) — AI recap tool producing structured output (summary, decisions, action items, open questions). Free + $2 credit packs.
- [ChatStats](https://chatstats.io/) — Analytics tool with 50+ metrics, AI summaries, activity heatmaps. Free.
- [ChatParser (gavirubihan)](https://github.com/gavirubihan/ChatParser) — React 19 + Vite 8 viewer with virtualization for 500k+ messages, PWA, Share Target API.
- [Chat Explorer](https://chatexplorer.app/) — Native iOS/macOS viewer with analytics, timeline, milestones, semantic search. Free + Pro subscription.
- [nshah1d/whatsapp-archive-viewer](https://github.com/nshah1d/whatsapp-archive-viewer) — Zero-dependency viewer with virtual DOM, chat merge engine, token auth. PHP + vanilla JS.
- [WhatsApp Chat Analyzer (Streamlit)](https://whats-chat-detective.streamlit.app/) — Python-based analyzer with word clouds, emoji analysis, response time stats.
- [ThreadRecap comparison page](https://www.threadrecap.com/en/blog/whatsapp-chat-analyzer-tools-compared) — Categorizes the landscape into Stats, Generic AI, Voice Transcription, and Outcome-focused tools.
- [WhatsViz (smrayyans)](https://tools.smrayyans.me/whatsviz/) — Free browser analyzer with PWA, Share Target API, file browser, analytics.
- [ChatToPDF](https://chattopdf.app/whatsapp-chat-viewer) — Viewer + PDF generator; excellent explanation of what viewers can/cannot recover from exports.
- [Lucen.App](https://lucen.app/whatsapp-chat-analyzer) — Relationship-focused AI analyzer; red flags, interest scoring, sentiment tracking.

---

*Feature research for: RagChat (WhatsApp chat archive viewer + RAG web app)*
*Researched: 2026-07-28*
