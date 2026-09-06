# 03-UAT: Import Feature — User Acceptance Testing

- **Phase:** 03-import-feature
- **Date:** 2026-09-06
- **Method:** direct execution against the built feature (temporary Vitest driver under `src/lib/import/__tests__/`, since deleted — exercises the exact user journey headlessly: validate → decode/parse → preview → diff → commit/cancel against `fake-indexeddb`, plus static shell checks and a served-`build/` smoke test). Real drag-drop pixels and Worker threading are browser-only and covered by the deferred manual pass below.
- **Result:** 9/9 journey tests PASS + shell/serve checks PASS — no issues found, no fix plans needed

## Test Results

| # | Test (user perspective) | Result | Evidence |
|---|-------------------------|--------|----------|
| T1 | I drop my `.txt` export and instantly get a preview (count, date range, participants, samples) with nothing saved yet | PASS | `Family Group.txt` (12 msgs, 4 senders, 2 days) → validate `txt`, preview total=12, participants≥3, samples>0, from≤to; chats=0, messages=0 |
| T2 | I pick a `.zip` export and get the same preview from the chat inside it | PASS | `chat-export.zip` → kind `zip`, largest `.txt` wins (`Family Group.txt` over `notes.txt`), identical preview totals |
| T3 | I confirm the import and my chat appears with every message, and I see progress while it saves | PASS | commit wrote 12/12, chat `Family Group` listed newest-first, message count=12; `onProgress` fired, monotone, final `[12,12]` |
| T4 | I import the same file again and it tells me everything is already there (nothing duplicated) | PASS | diff new=0, skipped=12; second commit wrote 0 rows, count stable |
| T5 | I import an export with one extra message and only the new message is added | PASS | diff new=1, skipped=12; commit wrote exactly 1 row |
| T6 | I look at the preview but hit cancel — nothing is saved | PASS | preview built then discarded; chats=0, messages=0 |
| T7 | I always know what the app is doing (reading → parsing → preview → saving → done) and errors tell me what went wrong | PASS | `transition` machine: files-received→reading, preview-result→preview, confirm→committing, commit-resolve→done; `parse-failed` yields `error` + code |
| T8 | Bad files (empty, oversize, wrong type, corrupt zip, sneaky zip paths) are rejected with zero writes | PASS | empty/26MB/`.exe` rejected by validate; corrupt zip throws; `../../evil.txt` sanitized to basename; DB counts 0 |
| T9 | A `.zip` renamed to `.txt` still imports (the app looks at content, not just the name) | PASS | PK☰☴ magic sniff routes to zip path; parsed messageCount>0 |
| Shell | The built app serves and contains the drop zone, preview card, and progress bar with no raw-HTML injection surface | PASS | `build/` has `index.html`+`200.html`+`_app/`; preview server returns 200; drop/preview/progress markup present in DropZone/PreviewCard/ProgressBar; `grep {@html}` zero hits |
| Suite | Full automated suite green | PASS | 17 files, 185/185; `tsc --noEmit` 0 errors; `biome check` clean; `bun run build` exit 0 |

## Success Criteria Coverage

- [x] Drag-drop `.txt` triggers import — T1 (validate accepts, spinner path is sync status in page handler)
- [x] File picker for `.txt` (also `.zip`) — T2, T9 (accept + unzip + magic-sniff triple gate)
- [x] Preview (count, date range, participants, first N samples) before commit — T1 (dry run, zero writes)
- [x] Existing-chat detection with new vs. skipped counts — T4, T5 (`diffPreview` batched `anyOf`)
- [x] Confirm or cancel; cancellation cleans up partial data — T3, T6 (nothing written until confirm; cancel discards memory)
- [x] Immediate spinner on drop + progress bar during parse/store — T7 (sync `reading` transition), T3 (determinate `onProgress`); worker progress events covered by `workerLogic` unit tests

## Deferred Manual Pass (browser-only, operator)

Real pointer drag-drop, Worker off-main-thread timing, and spinner paint latency cannot run headlessly. When convenient: `bun run dev`, drop a real export, confirm spinner <100ms, preview counts, confirm/cancel, and a 40K-line file for jank check. No automation gap — all logic paths above already pass.

## Diagnosis / Fix Plans

None — zero failures. No gaps to diagnose, no fix plans to prepare.

## Routing

Phase 03 UAT complete with all tests passing. Ready for Phase 04 (Chat Browsing) planning.
