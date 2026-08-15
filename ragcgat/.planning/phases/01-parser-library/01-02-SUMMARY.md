# 01-02 SUMMARY: Extended Pattern Coverage + 24-Fixture Benchmark

## Completion Status
- **Plan**: 01-02 (Wave 2) — 14+ pattern families, fullwidth/CJK normalization, 24-fixture benchmark
- **Date**: 2026-07-28
- **Executor**: inline (opencode, sequential)

## What Was Built

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/parser/patterns.ts` | Expanded from 3 to 18 TimestampPattern entries — all 14 benchmark families covered plus extras |
| `src/lib/parser/normalize.ts` | Fullwidth digit/colon/slash/comma/hyphen normalization; CJK AM/PM integrated via translateDigits; Arabic AM/PM markers now match standalone only (no body-text corruption) |
| `src/lib/parser/parseFile.ts` | Complete UTC-based dateResolver handling all 18 patternTypes; preamble capture (up to 50 lines, T-01-05); sender set to 'system' for system messages for benchmark compatibility |

### New Files
| File | Purpose |
|------|---------|
| `fixtures/chattopdf-2026.07.json` | Canonical 24-fixture benchmark from chattopdf (14 timestamp + 4 normalization + 6 behavior cases) |
| `src/lib/parser/__tests__/fixtures.test.ts` | Benchmark integration test — reads JSON, validates all 24 fixtures with field-level assertions |

### New Patterns Added
Ordered from most specific to least:
1. `yyyy-slash-bracket` — iOS YYYY/MM/DD (existing)
2. `yyyy-dot-bracket` — iOS YYYY.MM.DD
3. `iso-ampm-bracket` — iOS ISO + AM/PM
4. `iso-numeric-bracket` — iOS ISO 24h
5. `cjk-year-bracket` — CJK year-first kanji (2024年7月9日)
6. `cjk-bracket` — CJK AM/PM-before-time (15/3/24 下午 2:30:45)
7. `slash-ampm-bracket` — iOS slash + AM/PM
8. `slash-numeric-bracket` — iOS slash 24h
9. `euro-dot-bracket` — European dotted bracketed (dd.mm.yyyy)
10. `ddd-mm-yy-bracket` — Dutch bracketed DD-MM-YYYY
11. `yy-mm-dd-bracket` — Spanish short year (YY-MM-DD + AM/PM)
12. `iso-ampm-dash` — Android ISO + AM/PM
13. `iso-numeric-dash` — Android ISO 24h
14. `android-yyyy-slash-dash` — Android YYYY/MM/DD
15. `slash-ampm-dash` — Android slash + AM/PM (existing)
16. `slash-numeric-dash` — Android slash 24h / Brazilian (no comma)
17. `dot-euro-dash` — European dotted (existing)
18. `dot-euro-ampm-dash` — European dotted + AM/PM
19. `euro-dot-short-dash` — European dotted short year
20. `dutch-dash-dash` — Dutch DD-MM-YYYY no brackets

## Verification Results
- `bun tsc --noEmit` — 0 errors
- `bun vitest run` — 95/95 tests passing (0 failures)
- `bunx biome check src/` — 0 errors

## Acceptance Criteria Met
- [x] PATTERNS array has 18 timestamp format families (14+ from plan)
- [x] Date resolver handles all patternType variants correctly (UTC-based)
- [x] CJK normalization maps 上午/下午 to AM/PM
- [x] Fullwidth character normalization (digits U+FF10-U+FF19, colon U+FF1A, slash U+FF0F, comma U+FF0C, hyphen U+FF0D, space U+3000)
- [x] Arabic AM/PM markers match standalone only (no body text corruption)
- [x] Benchmark fixture JSON committed to fixtures/chattopdf-2026.07.json
- [x] fixtures.test.ts loads JSON and validates all 24 fixtures
- [x] All 24 benchmark fixtures pass (message count, sender, text, timestamp components, type, dedup hash)
- [x] Behavior cases pass: multiline, system, media, deleted, call, participants
- [x] Edge case tests pass: empty input, long lines, preamble, whitespace-only, single-line
- [x] No regression in Plan 1 tests (35 original tests still pass)

## Edge Case Handling
- **Preamble**: Lines before first timestamp accumulated as system message (max 50, T-01-05)
- **Long messages**: 1000 continuation line cap with [truncated...] (T-01-01)
- **Empty/whitespace**: Returns empty Chat with 0 messages
- **Fullwidth/CJK**: Normalized before pattern matching
- **Ambiguous dates**: Heuristic based on AM/PM presence and value > 12

## Benchmark Results
24/24 chattopdf 2026.07 benchmark fixtures pass:
- 14 timestamp variants across iOS, Android, CJK, European, Dutch, Brazilian, Spanish, ISO formats
- 4 numeral normalization cases (Arabic-Indic, Persian, Devanagari, Thai)
- 6 behavior cases (multiline, system, media, deleted, call, participants)

## Threat Model Compliance
- [x] T-01-05 (preamble DoS): MAX_PREAMBLE_LINES=50, preamble truncated
- [x] T-01-06 (14+ pattern iteration): O(patterns) per line, acceptable
- [x] T-01-07 (fixture tampering): Accepted (single-user project)
- [x] T-01-08 (fullwidth normalization): Specific Unicode ranges only
- [x] T-01-SC (benchmark download): JSON.parse only, no code execution

## Next
Phase 1 (Parser Library) is complete. Ready for next phase.
