# 01-03 SUMMARY: Classification Hardening (System/Media/Deleted) + Participants Fix

## Completion Status
- **Plan**: 01-03 (Wave 3) — Close the 4 verified classification defects (CR-01/WR-01/WR-03/WR-04/IN-01)
- **Date**: 2026-09-06
- **Executor**: subagent (execute-plan workflow)

## What Was Built

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/parser/classify.ts` | System matchers: bare-substring `left`/`added`/`removed` replaced with end-anchored canonical-notice regexes (`\bleft`, `\bjoined`, `\bwas added`, `\bwas removed`, `\badded\s+\S+`, `\bremoved\s+\S+`), tested via `.test()` alongside existing string entries; media matchers: IMG/VID/AUD prefixes now require full WhatsApp filename shape (`PREFIX-\d{8}-WA\d+.\w+`), bare extensions anchored to filename tokens (`\b[\w-]+\.ext`), bare `gif` word blocked when dot-prefixed (`(?<!\.)\bgif\b`); deleted check gains `you deleted this message` variant |
| `src/lib/parser/parseFile.ts` | `buildChat` participants filter now rejects the literal `'system'` sentinel in addition to falsy values (one-line change, buildChat only) |
| `src/lib/parser/__tests__/classify.test.ts` | 8 new regression tests: left/added/removed prose stays text, IMG- prose stays text, bare `.gif` prose stays text, `You deleted this message` is deleted, invite-link join still system, canonical `Alice left` still system |
| `src/lib/parser/__tests__/parser.test.ts` | 2 new end-to-end tests: `parseString` of `Alice: I left my keys at home` yields type text + sender Alice; system-event + Alice input yields participants exactly `['Alice']` |

### Untouched (per plan constraints)
Timestamp, normalization, dedup, call, and date logic unchanged (`resolveDate` identical — WR-02 out of scope); null/empty-sender early return to system unchanged; `<Media omitted>`, omitted variants, voice message, call patterns untouched; no new packages (bun-only, existing toolchain).

## Verification Results
- `bun vitest run src/lib/parser/__tests__/classify.test.ts src/lib/parser/__tests__/parser.test.ts` — 59/59 pass (22 classify incl. all 12 pre-existing, 37 parser)
- `bun tsc --noEmit` — 0 errors
- `bun vitest run` (full suite) — 105/105 pass across 5 files, incl. `fixtures.test.ts` 24/24 benchmark cases
- `bunx biome check src/` — 0 errors (one auto-fixable formatting nit in a new test, fixed via `biome check --write`)
- Explicit spot-checks: `I left my keys at home` → text/Alice; `I added sugar…` / `I removed him…` → text; `The IMG- tag…` → text; `Check out this .gif url` → text; `You deleted this message` → deleted; canonical `Alice left` / `Alice added Bob` / `Bob was removed` / invite-link join → system; true attachment filenames (`IMG-/VID-/AUD-…WA…`, `document.pdf`, `<Media omitted>`, `GIF omitted`) still media; `Missed voice call` still call; mixed system+Alice chat → participants `['Alice']`

## Acceptance Criteria Met
- [x] CR-01 fixed: left/added/removed prose stays text with real sender
- [x] WR-03/IN-01 fixed: IMG-/.gif prose stays text, true attachment filenames still media
- [x] WR-04 fixed: You deleted this message is deleted
- [x] WR-01 fixed: participants excludes 'system' sentinel
- [x] All pre-existing tests green, 24/24 benchmark passing, tsc + biome clean
- [x] No date-resolution (WR-02), preamble-hash (IN-02), timestamp, storage, UI, or worker changes

## Threat Model Compliance
- [x] T-01-01 (system matcher tampering): end-anchored/full-phrase matching; real-sender prose never re-tagged
- [x] T-01-02 (media matcher tampering): full filename shape + filename-token-anchored extensions
- [x] T-01-SC (npm installs): no new packages; bun-only with existing toolchain

## Next
Phase 1 classification defects closed. VERIFICATION gap set (D-gap) resolved — ready for re-verification of Phase 1.
