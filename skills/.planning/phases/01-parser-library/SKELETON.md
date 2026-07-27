# Walking Skeleton — RagChat Parser Library

**Phase:** 1
**Generated:** 2026-07-28

## Capability Proven End-to-End

A developer can run `bun tsc --noEmit && bun vitest run` and verify that a WhatsApp iOS bracketed export and an Android dash-separated export are both correctly parsed into structured `Message` arrays with proper dedup hashes and type classification.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language | TypeScript 5.x with strict mode | All downstream phases consume Message, Chat, MessageType types. Static typing catches date-order ambiguity at compile time. |
| Build tooling | Vitest 3.x + Biome 1.x | Shared pipeline with future SvelteKit app (Phase 3+). Vitest's native Vite integration means zero config overhead when the app project starts. |
| Package manager | Bun | Per project conventions (AGENTS.md). Faster installs and script execution than npm. |
| Parser architecture | Pure function pipeline: normalize -> match -> parse -> classify -> hash | Framework-agnostic. Every function is a pure input-to-output transformation. Testable in isolation. Portable between Node.js, browser, and Web Worker without modification. |
| Pattern matching | Ordered 14+ regex families with type-tagged date interpretation | Most specific patterns (ISO yyyy-mm-dd) tried before ambiguous (dd/mm vs mm/dd). The patternType tag controls how captured groups map to date fields. Resolves format ambiguity at match time. |
| Multi-line handling | State machine accumulator (MessageAccumulator) | Single pass, O(n). Each line either starts a new message (matches a timestamp pattern) or appends to the current message. No lookahead, no recursion, no re-parsing. |
| Dedup hash | FNV-1a 64-bit | Deterministic hash of (epochMs | sender | text | type). 64-bit collision probability < 1e-6 for 500K messages. Approximately 10x faster than SHA-256 with no Web Crypto dependency requirement. |
| Classification | Structural detection (no sender colon indicates system event) plus content pattern matching | Avoids hardcoded language-specific strings. Media markers, deleted message patterns, and call patterns are detected via regex on message body. |
| Timezone handling | Optional `timezone` parameter, defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone` | Timestamps stored as epoch ms for timezone-independent sorting. Original timezone name preserved per message for display. |
| 40K cap detection | Header line count threshold at 35,000 messages with warning string | WhatsApp hard-caps exports at 40,000 messages. Warning explains the limitation and suggests periodic overlapping exports. |
| Zero runtime dependencies | Pure TypeScript, no npm packages at runtime | The parser is approximately 300 lines of TypeScript. Every npm alternative either does not cover the format variants or adds maintenance burden without benefit. |

## Stack Touched in Phase 1

- [x] Project scaffold (TypeScript 5.x, Vitest 3.x, Biome 1.x, Bun)
- [x] Type definitions (Message, Chat, MessageType, MediaType, ParseOptions)
- [x] Unicode normalization (BOM strip, CRLF to LF, digit translation for 4 non-Western scripts, CJK AM/PM mapping, directional mark removal)
- [x] Timestamp pattern matching (14+ regex families: iOS bracket, Android dash, ISO, CJK, European dot, plus variants)
- [x] State machine parser (line-by-line with timestamp header detection, multi-line continuation)
- [x] Message type classification (text, media with sub-type, system event, call, deleted)
- [x] Dedup hash generation (FNV-1a 64-bit)
- [x] 40K export cap detection and warning
- [x] 24-fixture benchmark passing (chattopdf 2026.07)
- [x] Dev build verification: `bun tsc --noEmit` and `bun vitest run` both pass

## Out of Scope (Deferred to Later Slices)

- IndexedDB persistence (Phase 2)
- Web Worker execution (Phase 3)
- Drag-drop file import UI (Phase 3)
- SvelteKit project scaffold (Phase 3)
- Chat browsing UI (Phase 4)
- Full-text search indexing (Phase 5)
- PWA service worker / manifest (Phase 3+)

## Subsequent Slice Plan

- Phase 2: Storage Layer — Dexie.js schema, chat/message repositories, batch write, cursor pagination
- Phase 3: Import Feature — SvelteKit scaffold, drag-drop UI, Web Worker parsing, preview-before-commit
- Phase 4: Chat Browsing — Conversation sidebar, chat bubble UI, virtual scrolling, dark mode
- Phase 5: Full-Text Search — Orama index, keyword search across/all conversations, result navigation
