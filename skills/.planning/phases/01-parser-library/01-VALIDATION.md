---
phase: 1
slug: parser-library
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-28
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `vitest.config.ts` (Wave 0) |
| **Quick run command** | `bun vitest run --changed` |
| **Full suite command** | `bun vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun vitest run --changed`
- **After every plan wave:** Run `bun vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01-01 | 1 | IMPR-04 | T-01-01 | N/A | unit | `bun vitest run src/lib/parser/__tests__/parser.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-T2 | 01-01 | 1 | IMPR-04 | T-01-02 | N/A | unit | `bun vitest run src/lib/parser/__tests__/parser.test.ts` | ❌ W0 | ⬜ pending |
| 01-01-T3 | 01-01 | 1 | IMPR-04 | T-01-03 | N/A | unit | `bun vitest run src/lib/parser/__tests__/classify.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-T1 | 01-02 | 2 | IMPR-04 | T-01-04 | N/A | unit | `bun vitest run src/lib/parser/__tests__/normalize.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-T2 | 01-02 | 2 | IMPR-04 | T-01-05 | N/A | integration | `bun vitest run src/lib/parser/__tests__/fixtures.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/parser/__tests__/parser.test.ts` — core parse unit tests (IMPR-04)
- [ ] `src/lib/parser/__tests__/fixtures.test.ts` — 24-fixture benchmark integration
- [ ] `src/lib/parser/__tests__/normalize.test.ts` — digit translation, CJK AM/PM normalization
- [ ] `src/lib/parser/__tests__/classify.test.ts` — message type classification tests
- [ ] `src/lib/parser/__tests__/dedup.test.ts` — deterministic hash tests
- [ ] `vitest.config.ts` — Vitest configuration
- [ ] `fixtures/chattopdf-2026.07.json` — downloaded benchmark fixtures

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 40K message cap warning | IMPR-04 | Requires export with >40K messages | Run parser against known 40K+ export, verify warning message appears |
| Edge case date formats | IMPR-04 | Real-world exports may have undocumented formats | Run against user's own WhatsApp exports |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
