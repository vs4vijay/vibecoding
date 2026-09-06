# 01-UAT: Parser Library — User Acceptance Testing

- **Phase:** 01-parser-library
- **Date:** 2026-09-06
- **Method:** direct execution against the built library (`parseString` from `src/lib/parser/index.ts` via `bun -e`), exercising each phase success criterion from the user's perspective
- **Result:** 13/13 PASS — no issues found, no fix plans needed

## Test Results

| # | Test (user perspective) | Result | Evidence |
|---|-------------------------|--------|----------|
| T1 | Importing my iOS export parses into structured messages | PASS | `sample-ios.txt` → 8 msgs, valid epoch timestamps, 16-char hex dedup hashes, participants `["Alice Johnson","Bob Smith"]` |
| T2 | Importing my Android export parses into structured messages | PASS | `sample-android.txt` → 7 msgs, valid timestamps, participants `["Alice Johnson","Bob Smith"]` |
| T3 | A message spanning multiple lines stays one message | PASS | 3-line message + follow-up → exactly 2 messages, continuation text merged |
| T4a | Normal chat text is typed `text` | PASS | `hello there` → `text` |
| T4b | Photo attachment is typed `media/image` | PASS | `IMG-20240709-WA0001.jpg` → `media/image` |
| T4c | Ordinary prose ("I left my keys at home") keeps my name, stays `text` | PASS | `text/Alice` (was `system` before 01-03 fix) |
| T4d | Same message always gets the same dedup hash | PASS | identical hash `3046b91a…` across two parses |
| T5 | Huge export warns about the 40K message cap | PASS | 35,001-line input → warning mentioning 40,000; small export → `capWarning: null` |
| T6a | Prose mentioning `IMG-` stays `text` | PASS | `The IMG- tag is used for figures` → `text` |
| T6b | Prose mentioning `.gif` stays `text` | PASS | `Check out this .gif url` → `text` |
| T6c | "You deleted this message" is typed `deleted` | PASS | → `deleted` |
| T6d | System notices don't appear as contacts | PASS | system event + Alice message → participants exactly `["Alice"]` |
| Suite | Full automated suite green | PASS | `bun vitest run` 105/105 (incl. 24/24 chattopdf benchmark), `tsc --noEmit` 0 errors, `biome check src/` clean |

## Success Criteria Coverage

- [x] iOS (bracketed) and Android (dash-separated) formats parse — T1, T2
- [x] Multi-line messages grouped singly — T3
- [x] Deterministic dedup hash + text/media/system classification — T4a–T4d, T6a–T6c
- [x] 40K export cap warning surfaced — T5
- [x] chattopdf 24-fixture benchmark (14+ locale families) — Suite (24/24)

## Diagnosis / Fix Plans

None — zero failures. No gaps to diagnose, no fix plans to prepare.

## Routing

Phase 01 UAT complete with all tests passing. Ready for milestone completion / Phase 02 (Storage Layer) planning.
