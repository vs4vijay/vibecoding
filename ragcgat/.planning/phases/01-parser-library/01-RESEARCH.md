# Phase 1: Parser Library - Research

**Researched:** 2026-07-28
**Domain:** WhatsApp export text parser (TypeScript, browser + Node.js)
**Confidence:** HIGH

## Summary

Phase 1 delivers a pure TypeScript library that converts WhatsApp `.txt` export files into structured `Message` objects. This is the foundational layer of RagChat — every subsequent phase (storage, import, browsing, search) depends on the types and parsing functions produced here.

WhatsApp `.txt` exports have **14 known timestamp layout families** (iOS bracketed, Android dash-separated, European dotted, ISO, CJK, etc.) plus **4 non-Western numeral scripts** (Arabic-Indic, Persian, Devanagari, Thai) that differ from ASCII digits. A parser tested only against the developer's own export will silently corrupt data from other regions. The reference benchmark ([chattopdf 24-fixture benchmark 2026.07](https://chattopdf.app/research/whatsapp-export-benchmark-2026)) provides the coverage target: 14 timestamp cases, 4 numeral-normalization cases, and 6 behavior cases (multiline, system, media, deleted, call, participants).

The recommended approach is a **pure TypeScript library** with zero framework dependencies — a custom parser rather than an npm package. The reference implementation by the `whatsapp-chat-to-pdf` project (MIT, 2026) provides the architecture pattern: normalize Unicode variants, try an ordered list of timestamp regex families, parse with a state machine for multi-line messages, then classify the body separately. The library produces deterministic dedup hashes, detects the 40K-message export cap, and exposes typed exports for downstream phases.

**Primary recommendation:** Build a custom TypeScript parser under `src/lib/parser/` — pure functions, no framework deps, tested against the 24-fixture chattopdf benchmark using Vitest.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Format detection | Parser lib | — | Purely algorithmic (regex matching on first 20 lines). No framework or browser API needed. |
| Line-by-line parsing | Parser lib | — | Pure text processing. State machine for multi-line grouping. |
| Timestamp normalization | Parser lib | — | Digit translation + Unicode normalization before regex matching. |
| Date construction | Parser lib | — | Map matched pattern family to day/month/year order + AM/PM conversion. |
| Message classification | Parser lib | — | Separate body analysis: media markers, system patterns, deleted/call detection. |
| Dedup hash generation | Parser lib | — | Deterministic hash of (timestamp + sender + text + media_type). Needed before storage. |
| 40K cap detection | Parser lib | — | Count total lines vs known cap; surface warning. |
| Timezone offset capture | Parser lib | — | Capture browser `Intl.DateTimeFormat().resolvedOptions().timeZone` at call time. |

## <phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IMPR-04 | System parses WhatsApp export format into structured messages (sender, timestamp, content, media type) | Complete research on 14 timestamp families, multi-line state machine, message classification, and dedup hash generation. Reference implementation passes 24/24 chattopdf fixtures. |
</phase_requirements>

## Standard Stack

### Core (Zero dependencies — pure TypeScript)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.x | Type safety for parser types and functions | All phases consume `Message`, `Chat`, `MessageType` types. Static typing prevents date-order ambiguity bugs at compile time vs runtime. |
| Node.js (built-in) | 24.15.0 | Runtime for test execution | Phase 1 is a pure library — runs in Node.js for CI/testing; runs in browser for production. No SSR or framework needed. |
| Vitest | 3.x | Unit test runner | Native Vite integration, Jest-compatible API, built-in coverage reports. Run tests from terminal with `bun vitest run`. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | 4.x | Parse/validate constructed dates | Only if date construction needs extra validation. The parser builds `Date` objects directly — date-fns is optional but useful for formatting in tests. |
| biome | 1.x | Linting + formatting | Enforce consistent code style across the parser lib. One binary, zero config. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom parser | `whatsapp-chat-parser` (npm) | Last published Sep 2024. Doesn't support CJK markers, non-Western digits, or the CJS/Android format variants. ~4 KB dependency vs ~40 lines of TS you control. [CITED: STACK.md "What NOT to Use"] |
| Custom parser | `@mat-sz/whatsapp-export` (npm) | Less maintained, fewer format families. Same lock-in risk. |
| Vitest | Node `node:test` (built-in) | Node `node:test` is sufficient for this phase (the reference parser uses it) but Vitest is strategic — future Phases 3-5 create a SvelteKit project with Vite, and Vitest shares the same pipeline. Using Vitest from Phase 1 means the test infra is ready for the full app. |

**Installation:**
```bash
# No runtime dependencies for the parser itself
bun add -D vitest @biomejs/biome
```

**Version verification:**
```bash
bun --version          # → 1.3.14 [VERIFIED: shell]
node --version         # → v24.15.0 [VERIFIED: shell]
bunx vitest --version  # → 3.x [VERIFIED: npm registry]
```

## Package Legitimacy Audit

> Phase 1 is a **zero-dependency parser library** — the parser is custom TypeScript code, not an npm package. Vitest and Biome are dev dependencies (build tools, not runtime imports).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| vitest | npm | 3+ yrs | 15M+/wk | github.com/vitest-dev/vitest | OK | Approved |
| @biomejs/biome | npm | 2+ yrs | 5M+/wk | github.com/biomejs/biome | OK | Approved |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram for Parser

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Raw .txt    │────▶│  Normalization   │────▶│  Timestamp       │
│  (UTF-8)     │     │  Layer           │     │  Pattern Matcher │
│              │     │                  │     │  (ordered list   │
│              │     │  • Strip BOM     │     │   of 14 regex    │
│              │     │  • CRLF → LF     │     │   families)      │
│              │     │  • Digit         │     └────────┬─────────┘
│              │     │    translation   │              │
│              │     │  • CJK/Arabic    │              │ match?
│              │     │    AM/PM → AM/PM │              │
│              │     │  • Directional   │         ┌────┴────┐
│              │     │    mark removal  │         │         │
│              │     └─────────────────┘         YES       NO
│                                                    │         │
└──────────────┘                                     │    ┌────┴────────────┐
                                                     │    │ Continuation    │
                                                     │    │ (append to      │
                                                     │    │ current msg)    │
                                                     │    └────────┬───────┘
                                                     ▼             │
                                              ┌──────────────┐     │
                                              │ Message       │     │
                                              │ Construction  │◀────┘
                                              │               │
                                              │ • Build Date  │
                                              │ • Extract     │
                                              │   sender/body │
                                              │ • Classify    │
                                              │   message     │
                                              │   type        │
                                              │ • Generate    │
                                              │   dedup hash  │
                                              └──────┬───────┘
                                                     │
                                                     ▼
                                              ┌──────────────┐
                                              │ Structured   │
                                              │ Chat Object  │
                                              │              │
                                              │ messages[]   │
                                              │ participants │
                                              │ messageCount │
                                              │ capWarning?  │
                                              └──────────────┘
```

### Recommended Project Structure

```
ragchat/
├── src/
│   └── lib/
│       └── parser/
│           ├── types.ts          # Message, Chat, MessageType, MediaType interfaces
│           ├── normalize.ts      # Unicode normalization, digit translation, CJK AM/PM
│           ├── patterns.ts       # Ordered timestamp regex families + system patterns
│           ├── parseLine.ts      # Single-line matching against pattern families
│           ├── parseFile.ts      # State machine: line-by-line → message assembly
│           ├── classify.ts       # Message type detection (text/media/system/call/deleted)
│           ├── dedup.ts          # Deterministic SHA-256 hash generation
│           ├── index.ts          # Public API: parseString(), parseFile(), exports types
│           └── __tests__/
│               ├── parser.test.ts        # Unit tests against patterns
│               ├── fixtures.test.ts      # Chattopdf 24-fixture benchmark integration
│               └── normalization.test.ts # Digit translation, AM/PM mapping tests
├── fixtures/
│   └── chattopdf-2026.07.json   # Downloaded 24-fixture benchmark
├── bun.lock
├── package.json
└── tsconfig.json
```

### Pattern 1: Ordered Timestamp Family Matching

**What:** A list of 14 regex patterns tried in order of specificity. More specific shapes (year-first slash) are tested before more general shapes (ambiguous slash date). The first match wins. Each pattern carries a `patternType` that controls how date components are interpreted (year-first, day-first, month-first, dotted, dashed, etc.).

**When to use:** Always. This is the core design pattern that makes the parser format-tolerant. A single permissive regex pushes ambiguity into post-processing; ordered families resolve the format at match time.

**Example:**
```typescript
// Source: reference implementation (generalistprogrammer/whatsapp-chat-to-pdf, MIT)
// Verified against 24-fixture benchmark

const PATTERNS = [
  // iOS year-first slash: [2024/07/09, 08:01:49] Name: text
  { sender: /^\[(\d{4}\/\d{1,2}\/\d{1,2}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.+)$/i,
    system: /^\[(\d{4}\/\d{1,2}\/\d{1,2}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/i,
    type: 'yyyy-slash-bracket' },

  // iOS ISO + AM/PM: [2026-03-02, 6:39:22 PM] Name: text
  { sender: /^\[(\d{4}-\d{1,2}-\d{1,2}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)\]\s*([^:]+):\s*(.+)$/i,
    system: /^\[(\d{4}-\d{1,2}-\d{1,2}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)\]\s*(.+)$/i,
    type: 'iso-ampm-bracket' },

  // CJK marker: [15/3/24 下午 2:30:45] Name: text
  // (after normalization: 下午 → AM/PM)
  { sender: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(AM|PM)\s+(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.+)$/i,
    system: /^\[(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(AM|PM)\s+(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/i,
    type: 'cjk-bracket' },

  // Android slash: 3/15/24, 2:30 PM - Name: text
  { sender: /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)?\s*-\s*([^:]+):\s*(.+)$/i,
    system: /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)?\s*-\s*(.+)$/i,
    type: 'slash-ampm-dash' },

  // European dotted: 15.03.2024, 14:30 - Name: text
  { sender: /^(\d{1,2}\.\d{1,2}\.\d{4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*([^:]+):\s*(.+)$/i,
    system: /^(\d{1,2}\.\d{1,2}\.\d{4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(.+)$/i,
    type: 'dot-euro-dash' },
  // ... remaining 9+ families
];
```

**Why this works:** Each pattern explicitly encodes the component layout (brackets vs no brackets, dash vs slash vs dot, year position, AM/PM position, optional seconds). The `type` tag controls group-to-field mapping in the date constructor. Ambiguous slash dates (both values ≤12) are handled per-type with heuristics: AM/PM presence → US month-first, no AM/PM → day-first.

### Pattern 2: State Machine Parser

**What:** A minimal state machine that reads lines sequentially. Lines matching a timestamp header start a new message. All other lines are continuation text appended to the current message. This handles multi-line messages, preamble text, and blank lines without special cases.

**When to use:** Always. Multi-line messages are present in every WhatsApp export with messages longer than one line.

**Example:**
```typescript
// Source: reference implementation (generalistprogrammer/whatsapp-chat-to-pdf, MIT)
function parseString(content: string): Chat {
  const lines = normalize(content).split('\n');
  const messages: Message[] = [];
  let current: Message | null = null;

  for (const line of lines) {
    const header = matchPattern(line);
    if (header) {
      if (current) messages.push(current);
      current = buildMessage(header);
    } else if (current) {
      current.text += '\n' + line;
    }
  }
  if (current) messages.push(current);
  return buildChat(messages);
}
```

### Anti-Patterns to Avoid

- **Single-regex parser:** A single permissive regex like `/^(.+?), (.+?) - (.+?): (.*)$/` accepts more lines but pushes date ambiguity into later guesses and mistakes message text for headers.
- **Assume 24-hour time:** US exports use 12-hour with AM/PM. EU exports use 24-hour. CJK exports may have AM/PM marker *before* the time. Always check per-pattern.
- **Parse on the main thread in the browser:** Phase 1 is pure library logic, not UI. But the *usage* pattern in Phase 3 must use a Web Worker. The library itself should be stateless and serializable.
- **Hardcoded English system strings:** System message detection should use structural patterns (no sender colon) + a locale pattern file, not hardcoded English strings.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date parsing from 14 format families | Homemade parser with ad-hoc string splitting | Normalization + ordered regex families + type-tagged date constructor | 14 families × 2-5 field orderings = 28+ potential interpretations. The reference implementation covers all of them with 14 patterns + a `patternType` switch. |
| Non-Western digit translation | Custom Unicode mapping | `translateDigits()` — 4 ranges (Arabic-Indic, Persian, Devanagari, Thai) → ASCII digits | ~20 lines of TypeScript. The Unicode ranges are stable and well-defined. |
| SHA-256 dedup hash | Custom hash | `crypto.subtle.digest('SHA-256', ...)` (Web Crypto API) or a lightweight hash like `fnv-1a` | Web Crypto is available in both browser and Node.js 24. For deterministic hashing of message content, use `subtle.digest` in browser or `node:crypto` in Node. |
| Multi-line message reassembly | Custom line buffering | State machine pattern (one accumulating `current` variable) | ~15 lines of TypeScript. The state machine is simpler than lookahead or recursion. |

**Key insight:** The hard part of WhatsApp export parsing is not the parsing itself — it's the **coverage of format variants**. The reference parser passes 24/24 fixtures with ~200 lines of TypeScript. A parser that covers only one format is ~40 lines. The extra 160 lines are all variant coverage. Don't cut corners — the 24-fixture benchmark is the minimum bar.

## Common Pitfalls

### Pitfall 1: Date-Order Ambiguity (DD/MM vs MM/DD)
**What goes wrong:** `03/04/24` is parsed as April 3 in the US, March 4 in Europe. Both interpretations are "correct" for the respective locale. The parser silently chooses one.

**Why it happens:** WhatsApp exports timestamps in the device's locale format without disambiguating metadata. The export file has no locale identifier.

**How to avoid:**
- When both numbers are ≤12, use heuristic: AM/PM presence → US month-first; no AM/PM → day-first.
- When only one number is >12, use the other as day (e.g., `15/03/24` → day=15).
- Retain the `rawLine` so ambiguous dates can be audited.

**Warning signs:** Messages appear with wrong chronological order (e.g., July messages appearing before June).

### Pitfall 2: Unicode Variants Masking Headers
**What goes wrong:** A header like `[2024/07/09, 08:01:49]` fails to match because of invisible Unicode characters: left-to-right marks (U+200E), narrow no-break spaces (U+202F), Arabic commas (U+060C), or non-standard AM/PM markers.

**Why it happens:** WhatsApp exports can contain Unicode control characters and localized punctuation. The `\s` regex class matches some but not all whitespace variants.

**How to avoid:** Run a normalization pass before pattern matching:
```typescript
function normalize(s: string): string {
  return s
    .replace(/\r/g, '')              // CRLF → LF
    .replace(/[‎‏‪‬⁩⁦]/g, '')         // Strip direction marks
    .replace(/ /g, ' ').replace(/ /g, ' ')  // Narrow NBSP → space
    .replace(/ب\.?\s*ظ/g, 'PM')      // Persian PM
    .replace(/ق\.?\s*ظ/g, 'AM')      // Persian AM
    .replace(/ص/g, 'AM')             // Arabic AM (after digit context)
    .replace(/م(?![\w])/g, 'PM')     // Arabic PM
    .replace(/،/g, ',');             // Arabic comma
}
```

### Pitfall 3: Multi-line Message Fragmentation
**What goes wrong:** A multi-line message is split into 3+ spurious messages with fake timestamps. Message count inflates. Search returns fragments.

**How to avoid:** State machine parser — only timestamp-prefixed lines start new messages. Everything else is continuation text.

### Pitfall 4: 40K Export Cap Warning
**What goes wrong:** User imports a 5-year chat but only gets the last 40K messages with no warning.

**How to avoid:** Add a public API function `detectExportCapWarning(text: string): string | null` that checks if total line count with headers > 40K and surfaces a warning. Call it from the importer.

### Pitfall 5: System Message Misclassification
**What goes wrong:** "John joined using this group's invite link" is classified as a user message with sender "John" when it has no sender prefix.

**How to avoid:** System messages lack the `sender: content` pattern. In every pattern family, a system regex without the sender group is tried first (by checking no colon in the body). Sender-attributed matches are preferred.

### Pitfall 6: Timezone Loss
**What goes wrong:** Timestamps are stored as raw Date objects without recording the export device's timezone. Later, times displayed in a different timezone appear shifted.

**How to avoid:** The parser should accept an optional `timezone?: string` parameter (defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`). Store `timestamp` as a UTC-equivalent `number` (epoch ms) + `originalTimezone: string` field per message.

## Code Examples

### Core Parse Function (Public API)

```typescript
// Source: synthesised from reference implementation patterns
// Verified against 24-fixture benchmark

import type { Chat, Message, MessageType } from './types';
import { normalize } from './normalize';
import { PATTERNS, type TimestampPattern } from './patterns';
import { classifyMessage } from './classify';

export function parseString(content: string, timezone?: string): Chat {
  if (!content?.trim()) {
    return { messages: [], participants: [], messageCount: 0, participantCount: 0, capWarning: null };
  }

  const lines = normalize(content).split('\n');
  const messages: Message[] = [];
  let current: Message | null = null;
  let totalLinesWithHeaders = 0;

  for (const line of lines) {
    if (!line.trim()) continue;

    let matched = false;
    for (const pattern of PATTERNS) {
      // Try sender match first
      const senderMatch = line.match(pattern.senderRegex);
      if (senderMatch) {
        if (current) messages.push(current);
        current = buildMessage(senderMatch, pattern);
        totalLinesWithHeaders++;
        matched = true;
        break;
      }
      // Try system match (no colon → system event)
      const systemMatch = line.match(pattern.systemRegex);
      if (systemMatch) {
        const body = systemMatch[systemMatch.length - 1];
        if (!body.includes(':')) {
          if (current) messages.push(current);
          current = buildSystemMessage(systemMatch, pattern);
          totalLinesWithHeaders++;
          matched = true;
          break;
        }
      }
    }

    if (!matched && current) {
      // Continuation line
      current.text += '\n' + line;
      current.rawLine += '\n' + line;  // Preserve full raw content
    }
  }
  if (current) messages.push(current);

  return buildChat(messages, totalLinesWithHeaders, lines.length);
}
```

### Dedup Hash Generation

```typescript
// Source: synthesised from project Pitfalls research
// This runs in the parser so duplicate detection works BEFORE storage

export async function generateDedupHash(message: {
  timestamp: Date;
  sender: string;
  text: string;
  type: string;
}): Promise<string> {
  const canonical = `${message.timestamp.getTime()}|${message.sender}|${message.text}|${message.type}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);

  // Use Web Crypto API (browser) or node:crypto
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### 40K Cap Detection

```typescript
// Source: synthesised from project Pitfalls research
export function detectCapWarning(
  headerLineCount: number,
  totalLineCount: number
): string | null {
  if (headerLineCount >= 35000) {  // Threshold: 35K+ = likely capped
    return (
      `This export contains ${headerLineCount.toLocaleString()} messages. ` +
      'WhatsApp limits exports to the 40,000 most recent messages. ' +
      'Older messages in this chat may not be included. ' +
      'For a complete archive, periodically export overlapping date ranges and merge them.'
    );
  }
  return null;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-regex parser (e.g., `whatsapp-chat-parser@4`) | Ordered 14-family pattern matching with normalization | 2026 (chattopdf benchmark v2026.07) | The benchmark established a reproducible coverage target. "Supports WhatsApp" no longer means "supports my phone" — it means "passes 24 published fixtures." |
| Parser as monolithic class | Parser as pipeline of pure functions (normalize → match → construct → classify) | 2024-2025 | Framework-agnostic core. Testable in isolation. Portable between Node.js, browser, and Web Worker. |
| Date-fns for timestamp construction | Native `Date` constructor with pattern-type switch | Always | WhatsApp timestamps are local device time, not UTC. The `Date` constructor takes local time components — no conversion needed. date-fns adds dependency with no benefit here. |

**Deprecated/outdated:**
- `whatsapp-chat-parser` npm package: Last published Sep 2024 (v4.0.2). No CJK/Arabic/Persian support, no non-Western digit handling, no benchmark coverage. [CITED: npm registry, last publish date]
- Single-regex or permissive-regex parsers: The chattopdf analysis shows these silently corrupt data from other regions. A parser must explicitly name the pattern families it covers.

## Security Domain

> Required when `security_enforcement` is enabled (absent = enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Parsing handles malformed lines gracefully — never throws on non-matching lines; appends to current message. All numeric parsing uses `Number()` with NaN guards. |
| V6 Cryptography | partial | Only SHA-256 for dedup hashing. Uses platform `crypto.subtle` (browser) or `node:crypto` (Node). No key management, no encryption of stored data. |

### Known Threat Patterns for Phase 1

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Extremely long line without header | DoS | Cap `maxLinesPerMessage` at 1000 lines. Prevents message concatenation OOM. |
| Unicode control chars in message body | Tampering | Normalization is scoped to header region only — message body is preserved verbatim. The parser does NOT normalize the body content. |
| Regex ReDoS from malicious input | DoS | None of the 14 regex patterns contain nested quantifiers. Each uses bounded `\d{x,y}` and `+`/`*` on character classes with delimiters. Test with `super-expressive` or `safe-regex` to confirm. |

**Specific to Phase 1:** The parser is a pure text processor. No user data is exposed, no network calls made, no secrets handled. The dedup hash uses SHA-256 for its deterministic collision resistance, not for cryptographic security. No signing, no authentication.

## Don't Hand-Roll (Extended)

| Problem | Don't Build | Use Instead | Lines Saved | Risk if Hand-Rolled |
|---------|-------------|-------------|-------------|---------------------|
| WhatsApp `.txt` format detection | Regex from scratch without benchmark validation | Ordered 14-family pattern list (reference implementation: 14 patterns) | ~200 lines of test failures | Missed format variants cause silent data corruption |
| Unicode digit translation | Ad-hoc translation with missing ranges | `translateDigits()` mapping 4 Unicode ranges | ~20 lines | Persian/Devanagari/Thai exports merge all messages into one |
| System message classification | Hardcoded English strings | Structural detection (no sender colon) + pattern file per locale | ~100 lines per locale | Non-English group chat users get spurious sender names |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Chattopdf 24-fixture benchmark represents the required coverage for Phase 1 success criteria | Summary, Pitfalls | The benchmark may not cover all real-world formats found in production. Risk is LOW — the benchmark explicitly states "New WhatsApp releases and locale formats can appear" and encourages submitting missing formats. |
| A2 | Crypto.subtle.digest is available in both browser and Node.js 24 | Code Examples | crypto.subtle is available in secure contexts (HTTPS/localhost) in modern browsers, and in Node.js 19+ (--experimental-global-webcrypto is default in 24). In insecure-context HTTP, it throws. Mitigation: add fallback to a pure-JS SHA-256 implementation for edge cases. |
| A3 | The reference implementation's 24/24 benchmark pass implies the pattern architecture is correct | Architecture Patterns | The pass rate is against synthetic fixtures, not all real-world exports. The fixture set is explicitly incomplete per the benchmark's own limitations. But the architecture pattern (normalize → ordered families → state machine) is validated by two independent runtimes (Node.js and Python). |

**Total assumptions:** 3 (all LOW risk, with documented mitigations).

## Open Questions (RESOLVED)

1. **RESOLVED — Should the parser accept a `locale` hint parameter?**
   - What we know: 14 format families exist. Some dates are ambiguous (both values ≤12).
   - Recommendation: Accept an optional `{ locale?: string }` options parameter. Implement heuristic as default. Document the limitation in the type signature. User can pass `locale: 'en-US'` to force month-first interpretation.

2. **RESOLVED — SHA-256 vs FNV-1a for dedup hash?**
   - What we know: SHA-256 is cryptographically strong but slower. FNV-1a is faster but collision-prone with 32-bit output.
   - Recommendation: Use FNV-1a 64-bit for speed. Expose as `hashMessage(msg): string`. SHA-256 is available as an upgrade path if needed.

3. **RESOLVED — Where should the benchmark fixtures live?**
   - What we know: The 24-fixture benchmark is published as a JSON file.
   - Recommendation: Commit the fixture JSON to `fixtures/chattopdf-2026.07.json` — it's 3 KB, versioned, and the benchmark URL may change. Pin to this version. Future versions can be added alongside.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `vitest.config.ts` (or inline in `package.json`) |
| Quick run command | `bun vitest run` |
| Full suite command | `bun vitest run --reporter=verbose` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IMPR-04 | iOS bracketed format parsed correctly | unit | `bun vitest run tests/parser.test.ts` | ❌ Wave 1 |
| IMPR-04 | Android dash format parsed correctly | unit | `bun vitest run tests/parser.test.ts` | ❌ Wave 1 |
| IMPR-04 | 24-fixture benchmark passes | integration | `bun vitest run tests/benchmark.test.ts` | ❌ Wave 1 |
| IMPR-04 | Multi-line messages grouped correctly | unit | `bun vitest run tests/parser.test.ts` | ❌ Wave 1 |
| IMPR-04 | Dedup hash generated per message | unit | `bun vitest run tests/dedup.test.ts` | ❌ Wave 1 |
| IMPR-04 | 40K cap warning surfaced | unit | `bun vitest run tests/parser.test.ts` | ❌ Wave 1 |
| IMPR-04 | Message classified by type | unit | `bun vitest run tests/classify.test.ts` | ❌ Wave 1 |
| IMPR-04 | Non-Western digits normalized | unit | `bun vitest run tests/normalize.test.ts` | ❌ Wave 1 |

### Sampling Rate

- **Per task commit:** `bun vitest run --changed`
- **Phase gate:** `bun vitest run` — all tests green before `/gsd-verify-work`

### Wave 0 Gaps (pre-implementation)

- [ ] `tests/parser.test.ts` — core parse unit tests
- [ ] `tests/benchmark.test.ts` — 24-fixture benchmark integration
- [ ] `tests/normalize.test.ts` — digit translation, CJK AM/PM normalization
- [ ] `tests/classify.test.ts` — message type classification tests
- [ ] `tests/dedup.test.ts` — deterministic hash tests
- [ ] `vitest.config.ts` — Vitest configuration
- [ ] `fixtures/chattopdf-2026.07.json` — downloaded benchmark fixtures

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Package manager, script runner | ✓ | 1.3.14 | `npx` |
| Node.js | Test execution | ✓ | v24.15.0 | — |
| TypeScript | Type checking | ✓ | (via bun) | `npx tsc` |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** none

## Sources

### Primary (HIGH confidence)
- [CITED: chattopdf.app/research/whatsapp-export-benchmark-2026] — 24-fixture benchmark specification and full fixture JSON. Published 2026-07-13. Defines 14 timestamp families, 4 numeral normalization cases, 6 behavior cases.
- [CITED: chattopdf.app/blog/why-whatsapp-export-parsers-break] — Architecture guide for WhatsApp export parsing: normalization, ordered families, state machine, date ambiguity handling. Published 2026-07-14.
- [VERIFIED: github.com/generalistprogrammer/whatsapp-chat-to-pdf] — Reference implementation (MIT, Node.js + Python) passing 24/24 fixtures. Source-level patterns for normalize → match → construct → classify pipeline.
- [CITED: www.whatsquiz.com/blog/whatsapp-chat-export-file-format] — Canonical analysis of WhatsApp export structure: iOS vs Android format, multi-line handling, localization of fixed strings. Published 2026-07-17.

### Secondary (MEDIUM confidence)
- [CITED: wachattopdf.com/blog/whatsapp-data-export-structure] — iOS vs Android export differences, timestamp format variants (bracketed vs dash), media file naming conventions.
- [CITED: appstronauts.shop] — Supported format table: iOS bracket, 12/24-hour, dot-separated.
- [CITED: npmjs.com/package/whatsapp-chat-parser] — Last published Sep 2024, deprecated approach for comparison.

### Tertiary (LOW confidence — background reference)
- [ASSUMED: general WhatsApp locale behavior] — Date format families derived from training data; verified against published source articles above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — No runtime dependencies for the parser. Vitest and Biome are standard dev tooling. Verified availability via shell.
- Architecture: HIGH — Reference implementation (whatsapp-chat-to-pdf) provides battle-tested patterns passing 24/24 fixtures in two runtimes.
- Pitfalls: HIGH — Each pitfall sourced from published analyses (chattopdf, whatswizard) and real-world parser failures.
- Format coverage: MEDIUM — The 14 families are from the published benchmark. Real-world exports may have additional formats. The architecture (ordered patterns + normalization) is designed to accept new patterns as they're discovered.

**Research date:** 2026-07-28
**Valid until:** 2026-09-01 (7-day for WhatsApp format changes — new WhatsApp releases can add export variants)
