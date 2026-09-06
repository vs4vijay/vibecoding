---
phase: 01-parser-library
verified: 2026-09-06T18:05:00Z
status: gaps_found
score: 5/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "All 6 behavior cases pass: multiline grouping, system event detection, media classification, deleted message detection, call detection, participant extraction"
    status: failed
    reason: "Message classification is not reliable for real-world input. The chattopdf benchmark fixtures pass because they are crafted to align with the current implementation, but ordinary user prose triggers false classifications and a deletion variant is missed. Independently reproduced against the running code (see 01-REVIEW.md CR-01/WR-01/WR-03/WR-04 and this report's Behavioral Spot-Checks)."
    artifacts:
      - path: "src/lib/parser/classify.ts"
        issue: "CR-01 (critical): systemPatterns matched with lowerBody.includes(p) — bare substrings 'left', 'added', 'removed' misclassify ordinary prose as system events. Reproduced: '[2024/07/09, 08:01:49] Alice: I left my keys at home' → type 'system'. WR-03/IN-01: /\\bIMG[-_]/i, /\\bVID[-_]/i, /\\bAUD[-_]/i and bare file-extension regexes false-positive on prose ('The IMG- tag is used for figures' → media/image; 'Check out this .gif url' → media). WR-04: 'You deleted this message' variant not matched → type 'text'."
      - path: "src/lib/parser/parseFile.ts"
        issue: "WR-01: buildChat participants computed as [...new Set(messages.map(m => m.sender).filter(Boolean))].filter(Boolean) only strips empty strings, so the literal 'system' placeholder (assigned at line 120 for all non-sender messages) pollutes the participants list. Reproduced: chat with one system event + one user message → participants ['system','Alice']. Undermines 'participant extraction'."
    missing:
      - "Use word-boundary / full-phrase matching for system keywords and restrict system classification to no-real-sender context; do not silently drop sender attribution on real messages"
      - "Require the full WhatsApp attachment filename shape (e.g. IMG-\\d{8}-WA) and/or anchor media extension matches to filename tokens instead of bare substrings"
      - "Add the 'You deleted this message' variant to deleted-message detection"
      - "Exclude the 'system' placeholder (and ideally any non-participant sentinel) from the participants set"
---

# Phase 1: Parser Library Verification Report

**Phase Goal:** WhatsApp export text can be reliably parsed into structured messages regardless of format variant (iOS bracketed, Android dash-separated, 14+ locale families)
**Verified:** 2026-09-06T18:05:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Executive Summary

The parser library is **substantive and broadly functional**: it compiles clean under `tsc --noEmit`, its full suite passes 95/95, and all 24 chattopdf benchmark fixtures pass. However, an adversarial audit (this report) independently **reproduced the critical finding from 01-REVIEW.md**: `classify.ts` misclassifies ordinary, real-world user prose as system events and media because it uses substring matching on common English words (`left`, `added`, `removed`, `IMG-`, `.gif`, etc.). This makes message classification — the core of the phase goal's "reliably parsed" qualifier — **incorrect on realistic input**. The benchmark passes only because its fixtures are crafted to avoid the failure modes. This is a BLOCKER: the phase goal is not achieved as written.

## Goal Achievement

The phase goal promises **reliable** parsing into structured messages. The timestamp/date parsing layers are reliable (14+ families, non-Western digits, edge cases — all verified). But the classification layer (message type, media type, system-event detection, participant extraction) is demonstrably unreliable for ordinary prose. Because the goal explicitly names reliability across format variants and the failure corrupts the structured output (real messages re-tagged as system events), the goal is **not achieved**.

### Observable Truths

| # | Truth   | Status     | Evidence       |
| - | ------- | ---------- | -------------- |
| 1 | All 14+ timestamp format families parse into correct Message objects without error | ✓ VERIFIED | 18 `TimestampPattern` entries in `patterns.ts` in specificity order; `dateResolver` in `parseFile.ts` handles all patternTypes; 24-fixture benchmark and 35 parser tests validate timestamps (UTC epoch ms) and pass. |
| 2 | Non-Western numeral scripts (Arabic-Indic, Persian, Devanagari, Thai) translated to ASCII digits before regex matching | ✓ VERIFIED | `translateDigits()` in `normalize.ts` maps all 4 ranges; `normalize.test.ts` has a test per script plus mixed-input; fixtures `digits-{arabic-indic,persian,devanagari,thai}` all pass. |
| 3 | All 6 behavior cases pass: multiline grouping, system event detection, media classification, deleted message detection, call detection, participant extraction | ✗ FAILED | Benchmark behavior fixtures pass, but behavior is wrong on real input. See Behavioral Spot-Checks below: system-event and media false-positives on prose, deleted-message miss ("You deleted this message"), and 'system' pollutes participants. |
| 4 | 24-fixture benchmark integration test reads fixture JSON and validates all 24 cases | ✓ VERIFIED | `fixtures.test.ts` reads `fixtures/chattopdf-2026.07.json` (24 entries), runs an individual `it()` per fixture with field-level assertions (messageCount, sender, text, type, year/month/day, hour/minute, participants, dedupHash `/^[0-9a-f]{16}$/`). All pass. |
| 5 | No regression in iOS/Android/European format parsing from Plan 1 | ✓ VERIFIED | All 35 `parser.test.ts` cases pass (iOS bracketed, Android dash, European dotted); `bun tsc --noEmit` reports 0 errors; `bunx biome check src/` reports 0 errors. |
| 6 | Edge cases handled: extremely long messages, empty input, preamble before first timestamp | ✓ VERIFIED | `parser.test.ts` has explicit passing tests: preamble, extremely long single-line, whitespace-only, single-line no-newline, fullwidth, Persian digits. Preamble capped at 50 lines (T-01-05), continuations capped at 1000 (T-01-01). |

**Score:** 5/6 truths verified (1 failed)

### Deferred Items

None. No later milestone phase (2 Storage, 3 Import, 4 Browsing, 5 Search) addresses parser message-classification correctness. This gap belongs to Phase 1 and is not deferred.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/parser/types.ts` | Message, Chat, MessageType, MediaType, ParseOptions | ✓ VERIFIED | All 5 type definitions present; type aliases (not enums); fields match plan. |
| `src/lib/parser/normalize.ts` | normalize(), translateDigits() | ✓ VERIFIED | BOM, CRLF, directional marks, fullwidth, Arabic comma, CJK/Arabic/Persian AM-PM, 4 digit scripts all implemented. |
| `src/lib/parser/patterns.ts` | PATTERNS with 14+ families | ✓ VERIFIED | 18 TimestampPattern entries, ordered most→least specific; sender + system regex each. |
| `src/lib/parser/parseFile.ts` | parseString(), buildMessage(), buildChat(), detectCapWarning() | ✓ VERIFIED | State machine with multi-line, preamble, continuation cap, cap warning at 35000 headers, participants set, UTC dateResolver. |
| `src/lib/parser/classify.ts` | classifyMessage(), getClassificationLabel() | ✗ STUB-LEVEL-CORRECTNESS | Function exists and is wired, but classification logic has confirmed false-positive/false-negative defects (CR-01, WR-03, WR-04). Not a stub; a correctness gap. |
| `src/lib/parser/dedup.ts` | generateDedupHash(), hashMessage() | ✓ VERIFIED | FNV-1a 64-bit using BigInt, 16-char hex, deterministic (7 tests pass). |
| `src/lib/parser/index.ts` | Public API re-exports | ✓ VERIFIED | Re-exports parseString, classify, dedup, normalize, all types. |
| `fixtures/chattopdf-2026.07.json` | 24-entry benchmark | ✓ VERIFIED | 24 cases (14 timestamp + 4 normalization + 6 behavior). |
| `src/lib/parser/__tests__/fixtures.test.ts` | Benchmark integration test | ✓ VERIFIED | Reads JSON, per-fixture it() blocks, all pass. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | -- | ------ | ------- |
| `parseString()` | `normalize()` | call at parseFile.ts:173 | WIRED | Input normalized before pattern matching. |
| `parseString()` | `PATTERNS` | `matchesSenderOrSystem` at parseFile.ts:186-187 | WIRED | Ordered pattern iteration; first match wins. |
| `buildMessage()` | `classifyMessage()` | call at parseFile.ts:118 | WIRED | Classification invoked for type/mediaType. |
| `buildMessage()` | `generateDedupHash()` | call at parseFile.ts:125 | WIRED | Deterministic FNV-1a hash computed per message. |
| `index.ts` | all modules | re-exports | WIRED | Single public entry point. |
| `fixtures.test.ts` | `chattopdf-2026.07.json` → `parseString()` | readFileSync + per-fixture parse | WIRED | Real JSON read and validated end-to-end. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `parseString` → `Message.timestamp` | epoch ms | `Date.UTC` in `resolveDate` | Yes — real date components from fixtures (not hardcoded/empty) | ✓ FLOWING |
| `parseString` → `Message.type`/`mediaType` | classification | `classifyMessage` | Data flows, but **value correctness is unreliable** on prose (see gaps) | ⚠️ HOLLOW-CORRECTNESS |
| `parseString` → `Chat.participants` | sender set | `buildChat` | Flows, but includes fake `'system'` participant | ⚠️ POLLUTED |

### Behavioral Spot-Checks

Empirically reproduced against the running library (independent of the test suite, which does not cover these paths):

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Ordinary prose "I left my keys at home" | `parseString('[2024/07/09, 08:01:49] Alice: I left my keys at home')` | `type: 'system'` (should be `text`, Alice) | ✗ FAIL — CR-01 |
| Ordinary prose "I added sugar to the coffee" | same pattern | `type: 'system'` | ✗ FAIL — CR-01 |
| Ordinary prose "I removed him from the list" | same pattern | `type: 'system'` | ✗ FAIL — CR-01 |
| Prose "The IMG- tag is used for figures" | `parseString(... 'The IMG- tag is used for figures')` | `type: 'media', mediaType: 'image'` | ✗ FAIL — WR-03 |
| Prose "Check out this .gif url" | same | `type: 'media'` | ✗ FAIL — IN-01 |
| "You deleted this message" | `classifyMessage('You deleted this message','Alice','x')` | `type: 'text'` (should be `deleted`) | ✗ FAIL — WR-04 |
| System + user msg participants | `parseString('3/15/24, 2:30 PM - Messages and calls are end-to-end encrypted.\n... Alice: Hello')` | `participants: ['system','Alice']` | ✗ FAIL — WR-01 |

### Probe Execution

Not applicable. This is a library phase; no migration/CLI probes are declared in the plans or summaries (no `scripts/*/tests/probe-*.sh`). Standard validation commands were run instead (`bun tsc --noEmit`, `bun vitest run`, `bunx biome check src/`), all green.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| IMPR-04 | 01-01, 01-02 | System parses WhatsApp export format into structured messages (sender, timestamp, content, media type) | ⚠️ PARTIAL / BLOCKED | Parsing into Message objects, timestamps, sender, content all work (verified). But the **media type** and **type classification** semantics are corrupted by confirmed false-positives/negatives (CR-01, WR-03, WR-04), and participant extraction is polluted. Requirement cannot be considered fully satisfied. |

The requirement IMPR-04 is present in both plans' `requirements:` frontmatter and tracked in REQUIREMENTS.md (`IMPR-04 → Phase 1`). No orphaned requirements: IMPR-04 is the only ID assigned to this phase and it is claimed and addressed.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `src/lib/parser/classify.ts` | 29-33 | Substring system-keyword matching (`'left'`, `'added'`, `'removed'`) | 🛑 BLOCKER (CR-01) | Real messages silently re-tagged as system events; corrupts archive and search. |
| `src/lib/parser/classify.ts` | 38,44,47 | `\bIMG[-_]`, `\bVID[-_]`, `\bAUD[-_]` prefix matching | ⚠️ WARNING (WR-03) | Prose false-positive → media; wrong mediaType. |
| `src/lib/parser/classify.ts` | 39,46,50,52 | Bare file-extension regex in body (`\.gif`, `\.mp4`, ...) | ⚠️ WARNING (IN-01) | Prose containing an extension → media. |
| `src/lib/parser/classify.ts` | 61 | Deleted check misses "You deleted this message" | ⚠️ WARNING (WR-04) | A real deletion variant classified as text. |
| `src/lib/parser/parseFile.ts` | 140 | Participants includes literal `'system'` placeholder | ⚠️ WARNING (WR-01) | Fake contact pollutes participants/search/RAG. |

No `TBD`, `FIXME`, `XXX`, or `PLACEHOLDER` markers found in any modified file.

### Human Verification Required

Automated checks and independent reproduction were sufficient to expose the classification defects; no further manual testing is required to confirm this gap. Optional human spot-check for confidence:

1. **Real-export classification smoke test**
   - **Test:** Run the parser against a real WhatsApp export containing conversational prose with the words "left", "added", "removed", or filenames/mentions of `.gif`/`.mp4`, and inspect the resulting `type`/`sender`/`participants`.
   - **Expected:** Ordinary text messages stay `type: 'text'` with their actual sender; only genuine system notices are `system`; participants contain only real senders.
   - **Why human:** Validates the impact on the developer's own data, beyond synthetic fixtures.

### Gaps Summary

Five of six must-haves are verified. The single failing must-have — **the 6 behavior cases** — is the one that carries the phase goal's "reliably" contract. The confirmed defects are correctness bugs in `classify.ts` (system/media/deleted) and `parseFile.ts` (participants):

1. **CR-01 (critical):** System-keyword detection uses `lowerBody.includes('left'|'added'|'removed')`, false-positiving on ordinary prose and stripping meaningful classification. Verified on "I left my keys at home", "I added sugar", "I removed him".
2. **WR-03/IN-01:** Media detection false-positives on prose containing `IMG-`/`VID-`/`AUD-` prefixes or bare file extensions.
3. **WR-04:** "You deleted this message" not classified as `deleted`.
4. **WR-01:** The `'system'` placeholder leaks into `participants`, producing a fake contact.

These are not theoretical — each was reproduced against the running code. The benchmark fixtures pass only because they are written to match the current (defective) matchers. Because the phase goal explicitly promises **reliable** parsing and these defects corrupt real conversational output, the goal is **not achieved**. **BLOCKER: must not proceed to the next phase until classification is corrected.**

Suggested remediation (from 01-REVIEW.md and reproduced here):
- Restrict system classification to no-real-sender context and use word-boundary/full-phrase matching (e.g. `/^(.*?) (left|joined|added|removed)$/i`).
- Match the full WhatsApp attachment filename shape (`IMG-\d{8}-WA`) and anchor extension matches to filename tokens.
- Add the `'you deleted this message'` variant.
- Exclude the `'system'` sentinel from the participants set.

---

_Verified: 2026-09-06T18:05:00Z_
_Verifier: the agent (gsd-verifier)_
