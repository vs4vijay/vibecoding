---
phase: 01-parser-library
reviewed: 2026-09-06T17:59:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/lib/parser/types.ts
  - src/lib/parser/patterns.ts
  - src/lib/parser/normalize.ts
  - src/lib/parser/classify.ts
  - src/lib/parser/dedup.ts
  - src/lib/parser/parseFile.ts
  - src/lib/parser/index.ts
  - src/lib/parser/__tests__/parser.test.ts
  - src/lib/parser/__tests__/classify.test.ts
  - src/lib/parser/__tests__/normalize.test.ts
  - src/lib/parser/__tests__/dedup.test.ts
  - src/lib/parser/__tests__/fixtures.test.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-06T17:59:00Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Reviewed the pure TypeScript WhatsApp export parser (`src/lib/parser/`): message-type classification (`classify.ts`), timestamp/date resolution (`patterns.ts`, `parseFile.ts`), Unicode normalization (`normalize.ts`), FNV-1a dedup hashing (`dedup.ts`), and the public API surface (`index.ts`), plus the full test suite and fixtures. The suite passes 95/95 (verified by running vitest). The code is well-structured, modular, and comprehensively tested across 24 benchmark fixtures.

However, adversarial verification confirms the **message classification logic (`classify.ts`) has real correctness bugs** that corrupt parsed output: substring-based system-keyword matching (`left`, `added`, `removed`) misclassifies ordinary user prose as system events, dropping the actual sender. Multiple WARNING-level issues also affect participant extraction and date interpretation. These are genuine defects found by tracing edge cases (not test failures — no test covers these paths). All findings below were reproduced with concrete test cases against the running code.

## Critical Issues

### CR-01: Substring-based system-keyword matching misclassifies real user messages as system events

**File:** `src/lib/parser/classify.ts:15-33`
**Issue:** The `systemPatterns` array is matched with plain `lowerBody.includes(p)` (line 30). Several entries are common English words that appear as substrings inside ordinary user prose, not just in WhatsApp system notices. Because a match forces `{ type: 'system' }` and `parseFile.ts:120` then rewrites the sender to the literal `'system'`, any real message containing these words **loses its sender attribution and is re-tagged as a system event**, silently corrupting the conversation archive (the project's core value is searchable history).

Reproduced with `parseString`:
- `[2024/07/09, 08:01:49] Alice: I left my keys at home` → `type: 'system'`, `sender: 'system'` (should be `text`, `Alice`)
- `[2024/07/09, 08:01:49] Alice: I added sugar to the coffee` → `system` (should be `text`)
- `[2024/07/09, 08:01:49] Alice: I removed him from the list` → `system` (should be `text`)

The `left`, `added`, `removed` substrings are the worst offenders and are extremely common in everyday speech.

**Fix:** Use word-boundary matching for these short, common keywords, and restrict them to the system-message context (no real sender). At minimum anchor to standalone words; ideally only treat as system when the message reads as a system notice:
```typescript
const systemPatterns = [
	"joined using this group's invite link",
	'joined using invite link',
	/\bleft( the group)?\s*$/i,
	/\badded\b/i,
	/\bremoved\b/i,
	'changed the group',
	"changed this group's icon",
	'security code changed',
	'messages and calls are end-to-end encrypted',
	'created group',
	'changed the subject',
	"changed this group's subject",
];
for (const p of systemPatterns) {
	const hit = typeof p === 'string' ? lowerBody.includes(p) : p.test(lowerBody);
	if (hit) return { type: 'system' };
}
```
Even with word boundaries, `added`/`removed` remain risky in prose ("I added X", "I removed Y" are common). Stronger fix: only classify as system when `sender` is a phone number/non-name or the message has no colon sender structure — or match the full canonical system phrasing (e.g. `/^(.*?) (left|joined|was added|was removed)$/`).

## Warnings

### WR-01: Literal `'system'` fake participant pollutes the participants list

**File:** `src/lib/parser/parseFile.ts:140`
**Issue:** `buildChat` computes participants as `[...new Set(messages.map(m => m.sender).filter(Boolean))]`. `.filter(Boolean)` only removes empty strings, not the literal `'system'` placeholder that `finalSender` assigns to every non-sender message (line 120). Any export containing a system message therefore lists `'system'` as a contact/participant. Reproduced: a chat with one normal + one "joined" message yields `participants = ['Alice', 'system']`. This surfaces a fake contact in the UI and pollutes downstream search/RAG by treating `system` as a person.

**Fix:** Exclude the `'system'` placeholder when building participants:
```typescript
const participants = [...new Set(
	messages.map((m) => m.sender).filter((s) => Boolean(s) && s !== 'system')
)];
```

### WR-02: Ambiguous slash-date (both components ≤ 12) is interpreted arbitrarily, wrong for a whole locale convention

**File:** `src/lib/parser/parseFile.ts:62-74, 93-100`
**Issue:** For `cjk-bracket`, `slash-numeric-bracket`, `slash-numeric-dash`, `slash-ampm-bracket`, `slash-ampm-dash`, when both month and day components are ≤ 12 the code falls back to heuristics that produce different results per branch and per AM/PM presence. For a US-format date `10/11/2024` (Oct 11), `slash-numeric-bracket` (no AM/PM) returns **Nov 10** via `Date.UTC(y, b-1, a)` (line 73), while `slash-ampm-bracket` returns **Oct 11** via `Date.UTC(y, a-1, b)` (line 99). The same input gives different dates depending on which pattern and whether AM/PM is present. Reproduced: `[10/11/2024, 08:00:00]` parses to month=11, day=10.

**Fix:** Since the ambiguity is inherent to the export format, make the interpretation deterministic and documented. Add a `ParseOptions` hint for date-order (e.g. `dateOrder: 'MDY' | 'DMY' | 'auto'`), defaulting to a single consistent order for all slash sub-branches, and normalize the four branches so they cannot disagree on the same input. At minimum, make the non-AM/PM branch use the same convention as the AM/PM branch.

### WR-03: Media `IMG-`/`VID-`/`AUD-` prefix patterns false-positive on prose containing the substring

**File:** `src/lib/parser/classify.ts:38, 44, 47`
**Issue:** Patterns `/\bIMG[-_]/i`, `/\bVID[-_]/i`, `/\bAUD[-_]/i` match any substring beginning with those tokens. Prose such as `The IMG- tag is used for figures` is misclassified as `media`/`image` (reproduced). These prefixes are meant to match WhatsApp attachment filenames, which always carry a date suffix (e.g. `IMG-20240709-WA001.jpg`).

**Fix:** Require the full filename shape before classifying as media, e.g. `/^(?:IMG|VID|AUD)-\d{8}-WA/i` (match at message start), or combine the prefix match with a file-extension check. Also note `image omitted`, `video omitted`, `audio omitted`, `document omitted` (lines 40,45,48,51) are English-phrase matches that would only appear in localized (non-English) exports — confirm they are intended.

### WR-04: "You deleted this message" variant is not classified as `deleted`

**File:** `src/lib/parser/classify.ts:61`
**Issue:** The deleted-message check only matches `'this message was deleted'` and `'this message has been deleted'`. WhatsApp also emits **"You deleted this message"** for messages the sender removed. That variant falls through and is classified as `text`. Reproduced: `classifyMessage('You deleted this message', 'Alice', ...)` → `type: 'text'`.

**Fix:** Add the sender variant:
```typescript
if (
	lowerBody.includes('this message was deleted') ||
	lowerBody.includes('this message has been deleted') ||
	lowerBody.includes('you deleted this message')
) {
	return { type: 'deleted' };
}
```

## Info

### IN-01: File-extension media patterns (`\.(jpg|png|gif|webp|mp4|mp3|pdf)\b`) match extensions inside arbitrary prose

**File:** `src/lib/parser/classify.ts:39, 46, 50, 52`
**Issue:** Extension patterns like `/\.(jpg|jpeg|png|gif|webp)\b/i` are tested against the body, so a normal message containing text like `check this .gif` is also classified as `media` (reproduced: `'Check out this .gif url'` → `media`). This is a lower-severity variant of WR-03 but shares the same root cause.

**Fix:** Consider whether a media classification should be inferred from a bare extension in prose at all, or require it to appear within a filename token (`\b\w+\.(jpg|...)\b` anchored to a filename-like token). If standalone-extension prose matching is intentional, document it; otherwise tighten the regex.

### IN-02: Preamble dedup hash recomputed for the entire accumulated text on every appended line

**File:** `src/lib/parser/parseFile.ts:227-233`
**Issue:** In the preamble branch, `currentMessage.dedupHash` is regenerated from the full growing `text` string on every continuation line (lines 227-233). This is repeated O(n) hashing of an ever-growing string. Bounded by `MAX_PREAMBLE_LINES = 50`, so impact is small, but the hash is recomputed only to capture the concatenated text and could instead be derived once at finalize.

**Fix:** Defer hash computation until the message is finalized (when pushed at line 251), computing `generateDedupHash` once from the final text rather than after each append.

---

_Reviewed: 2026-09-06T17:59:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
