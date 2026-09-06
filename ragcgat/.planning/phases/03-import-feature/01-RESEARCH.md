# Phase 03: Import Feature - Research

**Researched:** 2026-09-06
**Domain:** Client-side import UX — drag-drop/file-picker ingestion, Web Worker parsing, .zip extraction, preview-before-commit + upsert on Dexie 4.x, first UI shell
**Confidence:** HIGH (scaffold/worker/DnD), MEDIUM (zip-library choice, SvelteKit-manual-install specifics)

## Summary

Phase 03 is the first user-facing phase: drag-drop or file-picker a WhatsApp `.txt` export (or `.zip` containing one), show a preview (count, date range, participants, sample messages, new-vs-skipped), then commit or cancel. All pure logic already exists: `parseString(raw)` (Phase 01, `src/lib/parser/`), `ChatRepository`/`MessageRepository.bulkSave` with dedup-before-write `anyOf` pre-query (Phase 02, `src/lib/db/`). What is missing is (a) a UI shell — the repo has **no** `index.html`, no `vite.config.ts` (app config; the existing `vitest.config.ts` is test-only), no framework, `src/` contains only `src/lib`; (b) `.zip` extraction; (c) off-main-thread parsing; (d) preview/upsert orchestration on top of the current repositories API.

**Primary recommendation:** Scaffold **SvelteKit 2.x (Svelte 5 runes) + `@sveltejs/adapter-static@3.0.10` + Tailwind 4.x via `@tailwindcss/vite`** now, installed **manually/additively** (never `sv create`, which would clobber `src/lib`). `src/lib` is already SvelteKit-shaped (`$lib` ≡ `src/lib`), so parser/db code moves zero lines. Parse in a **Vite-bundled Web Worker** (`new Worker(new URL(..., import.meta.url), { type: 'module' })`), unzip `.zip` with **`fflate@0.8.3`** [ASSUMED] on the main thread (small listing op) and hand the `.txt` bytes to the worker as a **transferred `ArrayBuffer`**, decode with `TextDecoder` in-worker, store via existing repositories **on the main thread**. Preview is a **dry-run with zero writes** (parse → hashes → `anyOf` lookup → counts); confirm reuses `bulkSave` + a new `findChatByName` upsert path; cancel discards in-memory state (nothing to clean up). Test with **Vitest only** — pure `buildPreview`/`diffPreview`/`unzip` helpers, no Playwright this phase.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IMPR-01 | Drag-drop `.txt` onto the app | DnD pattern §Architecture Patterns Pattern 4; MDN `DataTransfer.files` (drop-event only) |
| IMPR-02 | File picker for `.txt` (also accepts `.zip`) | `<input type=file accept=".txt,.zip">` + `File`/`Blob.arrayBuffer()`; fflate unzip listing (Pattern 3) |
| IMPR-03 | Preview of detected messages before confirm | `previewImport()` dry-run, zero writes (Pattern 5); stats + samples shape |
| IMPR-05 | Existing-chat detection, upsert (new vs skipped) | `findChatByName` + hash `anyOf` diff reusing `bulkSave`'s dedup pattern; commit path (Pattern 5) |
| SC (spinner) | Immediate spinner on drop (<100ms) | Synchronous state set in `drop` handler before any async work (Pitfall 1) |
| SC (progress) | Determinate progress bar during parse/store | Worker progress posts (parse) + `onProgress` chunk callback (store); bulkSave needs the hook added |

## Project Constraints (from AGENTS.md)

- **Use `bun` instead of `npm`** — all installs/run commands use `bun add`, `bun run`, `bunx`. (Never `npm install`.)
- **Use `uv` instead of `python`** — not relevant to this phase (no Python tooling).
- **TypeScript strict, ES2022 target** (`strict: true`, `moduleResolution bundler`, `lib: ["ES2022","DOM"]`). Worker files must typecheck under the same config — note `WebWorker` lib is NOT in `lib`; worker code that references `self.postMessage`/`onmessage` needs `/// <reference lib="webworker" />` or a `WorkerGlobalScope` shim (see Pitfall 4).
- **Lint/format with Biome** (`bun run lint` = `biome check`) — new UI/worker/import code must pass.
- **Tests with Vitest 3.x** (`bun run test` = `vitest run`, `setupFiles: src/lib/db/__tests__/setup.ts` with `fake-indexeddb/auto`) — Phase 03 tests extend this; no Playwright this phase.
- **STACK.md blessed path**: SvelteKit 2.x (Svelte 5 runes) + Dexie 4.x + Tailwind 4.x + Vite 6/7/8 + `adapter-static` + Vitest + Biome + `bun`. This research follows it for the scaffold decision.
- Root repo convention (parent AGENTS.md): web games follow `docs/GAMES.md` — not applicable to RagChat; ignore.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Drop zone / file picker / preview UI, progress + spinner | Browser / Client (SvelteKit page + components) | — | Fully client-side app; no server exists or is wanted |
| `.zip` listing + entry extraction | Browser / Client (main thread, fflate, small op) | — | Zip listing is ms-scale; only the *parse* is worker-worthy |
| `.txt` bytes → `Chat` parse + preview stats | Browser / Client (dedicated Web Worker) | — | Keeps 50K-line parses off the main thread; parse is pure CPU |
| Preview diff (new vs skipped hashes) | Browser / Client (main thread, Dexie `anyOf` read) | — | IndexedDB reads are async and must stay near the Dexie connection owner |
| Commit writes (`saveChat` + `bulkSave`) | Browser / Client (main thread, Dexie transactions) | — | Dexie *can* run in workers, but single-connection-on-main avoids transaction/proxy complexity (see Pattern 2) |
| File validation, size/zip-bomb caps | Browser / Client (before worker handoff) | — | Reject malicious/oversize inputs before spending CPU or memory |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `svelte` + `@sveltejs/kit` [VERIFIED: npm registry] | svelte `5.57.0`, kit `2.70.3` (both checked 2026-09-06) | UI framework + routing for the import page and all future phases | STACK.md-blessed; Svelte 5 runes (`$state`/`$derived`) replace legacy `$:`; `src/lib` already matches SvelteKit's `$lib` convention so zero code moves |
| `@sveltejs/adapter-static` [VERIFIED: npm registry + official docs] | `3.0.10` (published 2025-10-02; requires `@sveltejs/kit ^2.0.0`) | Static build (no server) for the client-only app | Official SvelteKit SSG/SPA adapter [CITED: https://svelte.dev/docs/kit/adapter-static]; `fallback` option covers SPA mode; peers Kit v2 exactly |
| `tailwindcss` + `@tailwindcss/vite` [VERIFIED: npm registry] | `4.3.3` (checked 2026-09-06) | Utility styling for drop zone, preview list, progress bar | STACK.md-blessed; v4 CSS-first config (no `tailwind.config.js`), single Vite plugin |
| `vite` [VERIFIED: npm registry] | `8.2.2` (checked 2026-09-06; SvelteKit pulls its own compatible Vite — do NOT pin independently, accept the Kit peer range) | Dev server + bundler (via SvelteKit) + Worker bundling | `new Worker(new URL(..., import.meta.url), {type:'module'})` is the documented Vite worker pattern; workers emit to `assets/` and work under adapter-static |
| `fflate` [ASSUMED — see audit] | `0.8.3` (latest, checked 2026-09-06; "High performance (de)compression in an 8kB package") | `.zip` listing + inflate in-browser, zero deps | ~8 KB vs jszip ~100 KB+; sync `unzipSync` suits the small main-thread listing op; runs in browser+bun; faster than pako/UZIP per benchmarks [CITED: https://www.npmjs.com/package/fflate] |
| `dexie` (exists) | `4.4.5` (already installed) | Preview diff reads + commit writes | No change; new code reuses `bulkSave`/`saveChat` + one new `findChatByName` query |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vite-plugin-pwa` [VERIFIED: npm registry] | `1.3.0` (checked 2026-09-06) | PWA manifest + Workbox service worker | Install now **only if** Phase 03 scope includes offline shell; otherwise defer to PWA phase (recommend defer — see Open Questions) |
| (none — stdlib only) | — | DnD (`DataTransfer.files`), file read (`Blob.arrayBuffer()`), decode (`TextDecoder`), worker (`Worker`/`postMessage`) | All platform APIs; no dependency warranted |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SvelteKit now | Vite-vanilla shell (`index.html` + `src/main.ts`) now, SvelteKit in Phase 4 | Vanilla is ~1 day faster and dodges SvelteKit config friction, but Phase 4 (routing, sidebar, chat view) would then pay a migration + rewrite of Phase 3 UI. Reject: pay scaffold once, now. Mitigation for risk: additive manual install (Pattern 1), never `sv create`. |
| SvelteKit now | React + Vite | Contradicts STACK.md; React ships ~40 KB runtime + VDOM for a custom drop-zone UI Svelte compiles away. Reject. |
| `fflate` | `jszip@3.10.1` | Friendlier docs/API, but ~10× larger and its async API still decompresses on the main thread (blocks UI per fflate maintainer discussion [CITED: https://github.com/101arrowz/fflate/discussions/177]). Acceptable fallback if `fflate` verification fails. |
| `fflate` | `@zip.js/zip.js@2.11.2` | Full-featured (Zip64, AES, worker pool, streams) [CITED: https://gildas-lormeau.github.io/zip.js] — overkill for "list entries, extract the biggest .txt"; heavier integration (configures its own worker pool). Reject for this use. |
| Worker parse | Main-thread `parseString` | `parseString` on 40K lines is ~100s of ms of sync regex work → dropped frames during the exact moment the spinner must paint. Reject (see Pitfall 1). |
| Store-on-main | Dexie inside the worker (`dexie-worker` proxy) | Technically possible (Dexie runs in workers [CITED: https://dexie.org/docs/dexie-worker/dexie-worker]), but adds a proxy lib + dual-connection transaction hazards for zero measured benefit at this scale. Reject. |

**Installation:**
```bash
bun add svelte @sveltejs/kit
bun add -D @sveltejs/adapter-static @sveltejs/vite-plugin-svelte vite tailwindcss @tailwindcss/vite
bun add fflate
```

**Version verification:** `bunx npm view` 2026-09-06: `svelte@5.57.0`, `@sveltejs/kit@2.70.3`, `@sveltejs/adapter-static@3.0.10`, `vite@8.2.2`, `fflate@0.8.3`, `jszip@3.10.1`, `tailwindcss@4.3.3`, `@zip.js/zip.js@2.11.2`, `vite-plugin-pwa@1.3.0`, `playwright@1.63.0`. (`gsd-tools query package-legitimacy check` could not run — binary not on PATH — so verdicts below are signal-based with a planner checkpoint.)

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `svelte` / `@sveltejs/kit` / `@sveltejs/adapter-static` | npm (sveltejs org) | ~8/4/5 yrs | tens of millions/wk (svelte, kit) | github.com/sveltejs/svelte, github.com/sveltejs/kit | OK | Approved — official docs at svelte.dev confirm canonical packages |
| `tailwindcss` / `@tailwindcss/vite` | npm (tailwindlabs org) | ~7 yrs / v4 since 2025 | ~10M+/wk | github.com/tailwindlabs/tailwindcss | OK | Approved |
| `vite` | npm (vitejs org) | ~6 yrs | ~15M+/wk | github.com/vitejs/vite | OK | Approved (version range owned by Kit — accept peer, don't pin) |
| `fflate` | npm | ~6 yrs (101arrowz), 0.8.3 current | high (bundler staple) | github.com/101arrowz/fflate | OK (signal-based) | Approved with checkpoint — seam gate unavailable; planner adds `checkpoint:human-verify` before install |

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious (SUS):** none (the `fflate` checkpoint is procedural — automated seam unavailable — not suspicion-driven)

*`fflate` as the chosen zip library is `[ASSUMED]` (sourced from ecosystem comparison + registry, not from project official docs). The planner must gate its install behind a `checkpoint:human-verify` task; the accepted fallback is `jszip`.*

## Architecture Patterns

### System Architecture Diagram

```
.txt / .zip file
  │  (drop onto zone  OR  <input type=file>)
  ▼
┌─ Main thread: ingest ─────────────────────────────┐
│ validate (ext, size ≤ cap) → spinner ON (sync)    │
│ .zip? → fflate unzipSync(list) → pick .txt entry  │
│         → transfer ArrayBuffer to worker          │
│ .txt? → file.arrayBuffer() → transfer to worker   │
└───────────────────────────────────────────────────┘
  │  postMessage({type:'parse-preview', buffer}, [buffer])  (zero-copy transfer)
  ▼
┌─ Worker: parse (src/lib/import/parse.worker.ts) ──┐
│ decode (TextDecoder utf-8 → windows-1252 retry)   │
│ parseString(text) → buildPreview(chat)            │
│ post progress events → post {type:'preview-result'}│
└───────────────────────────────────────────────────┘
  │  preview (in-memory only — ZERO Dexie writes)
  ▼
┌─ Main thread: preview + decision ─────────────────┐
│ previewImport(): hashes → anyOf diff →            │
│   { total, dateRange, participants, samples[N],   │
│     newCount, skippedCount, existingChat?,        │
│     capWarning }                                  │
│ UI: PreviewCard → [Confirm] / [Cancel]            │
└───────────────────────────────────────────────────┘
  │ confirm                              │ cancel
  ▼                                      ▼ (discard memory; no cleanup needed)
┌─ Main thread: commit ─────────────────────────────┐
│ findChatByName → reuse chatId OR saveChat         │
│ bulkSave(records, onProgress) — determinate bar   │
│ update messageCount → ensurePersistence()         │
└───────────────────────────────────────────────────┘
```

File-to-implementation mapping belongs in PLAN.md; proposed modules are in Recommended Project Structure below.

### Recommended Project Structure

```
src/
├── app.html                 # NEW (SvelteKit shell; worker-safe, no inline scripts)
├── routes/
│   ├── +layout.ts           # NEW (export const prerender = true; ssr note — Pattern 1)
│   └── +page.svelte         # NEW (import page: DropZone + PreviewCard + progress)
├── lib/                     # EXISTS (parser/, db/) — DO NOT MOVE; SvelteKit $lib ≡ src/lib
│   ├── parser/              # Phase 01 — DO NOT modify
│   ├── db/                  # Phase 02 — ADDITIVE only (findChatByName; onProgress hook)
│   └── import/              # NEW — framework-free import logic (testable without Svelte/Worker)
│       ├── validate.ts      # file validation (ext, size cap, kind sniff)
│       ├── unzip.ts         # fflate wrapper: listTxtEntries() + extractTxt()
│       ├── preview.ts       # buildPreview(chat) + diffPreview(db, hashes) — pure + thin DB fn
│       ├── commit.ts        # commitImport() upsert orchestration (find-or-create chat, bulkSave)
│       ├── workerProtocol.ts# shared message types (main ↔ worker)
│       ├── parse.worker.ts  # thin worker: decode → parseString → buildPreview → post
│       └── __tests__/       # validate/unzip/preview/commit tests (Vitest, fake-indexeddb)
└── components/              # (or co-locate under routes/) DropZone.svelte, PreviewCard.svelte, ProgressBar.svelte
svelte.config.js             # NEW — adapter-static, SPA/fallback decision (Pattern 1)
```

**Planner note:** whether components live in `src/components/` or `src/routes/` is stylistic — pick one and be consistent. Import logic MUST live in framework-free `src/lib/import/` so every rule is unit-testable without a browser, a Worker, or Svelte.

### Pattern 1: Additive SvelteKit install — never `sv create`
**What:** `sv create` scaffolds a *new* directory and would overwrite `package.json`/`tsconfig`/`src`. Instead `bun add` the packages and hand-write the ~5 shell files. `src/lib` stays byte-identical (and conveniently already matches SvelteKit's `$lib` alias — no `alias` config needed). [CITED: https://svelte.dev/docs/kit/adapter-static] (adapter install + config) [CITED: https://svelte.dev/docs/kit/single-page-apps] (SPA fallback mode)
**When to use:** Wave 0 of this phase, before any UI task.
**Shell files to create:**
```js
// svelte.config.js — static output, SPA fallback (import app is client-state-only)
import adapter from '@sveltejs/adapter-static';
/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ pages: 'build', assets: 'build', fallback: '200.html', strict: true }),
  },
};
export default config;
```
```ts
// src/routes/+layout.ts — prerender the shell; dynamic import state needs no SSR
export const prerender = true;
```
```js
// vite.config.ts — Kit plugin + Tailwind plugin (keep vitest `test` block!)
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config'; // vitest/config extends vite config — preserves test.setupFiles
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: { setupFiles: ['src/lib/db/__tests__/setup.ts'] },
});
```
**Notes for planner:**
- Do NOT let the scaffold touch `src/lib/parser` or `src/lib/db` (except the two additive API additions in Pattern 5).
- `tsconfig.json` currently has `"rootDir": "src"` + `"include": ["src"]` — SvelteKit needs generated `.svelte-kit/` types included; extend config (`"extends"` is invasive — prefer adding `".svelte-kit/types/**/*"` to `include` and verifying `bun run typecheck`). Flag as a Wave-0 verification step, not a foregone conclusion [ASSUMED friction point — standard SvelteKit/TS behavior, not verified against this exact tsconfig].
- `fallback: '200.html'` (not `index.html`) avoids conflict with the prerendered homepage, per official SPA guidance [CITED: https://svelte.dev/docs/kit/single-page-apps]. Any host serving static files works (no Node server).
- Tailwind v4: single `@import "tailwindcss";` in the root CSS file — no `tailwind.config.js` [VERIFIED: npm registry version; config model per STACK.md, LOW verification this session — re-confirm against https://tailwindcss.com/docs at plan time].

### Pattern 2: Parse-in-worker / store-on-main split (prescriptive)
**What:** The worker does **bytes → preview** only (decode + `parseString` + `buildPreview`). It NEVER touches Dexie. The main thread does **preview → commit** (diff reads + `bulkSave` writes). [CITED: https://dexie.org/docs/dexie-worker/dexie-worker] (Dexie officially supports workers — so this split is a choice, not a limitation; rationale: single-writer connection avoids dual-connection transaction hazards and keeps `fake-indexeddb` Vitest tests unchanged)
**Worker construction (Vite idiom):**
```ts
// Source: Vite worker pattern — new URL(..., import.meta.url) + { type: 'module' }
// (community-corroborated Vite behavior; exact bundling under adapter-static verified at build time)
const worker = new Worker(new URL('$lib/import/parse.worker.ts', import.meta.url), { type: 'module' });
```
**Rules:** one worker per import (terminate on done/cancel — no pool needed at this scale); large texts cross the boundary as **transferred `ArrayBuffer`** (zero-copy), never as cloned strings (see Pitfall 2); worker posts `{type:'progress', phase, done, total}` during long parses; all worker *logic* lives in pure functions in `preview.ts` so tests never instantiate a real `Worker`.

### Pattern 3: `.zip` handling with fflate (main thread, listing-scale op)
**What:** `file.arrayBuffer()` → `unzipSync(new Uint8Array(buf))` → filter `.txt` entries (skip directories, `__MACOSX/`, dotfiles) → pick largest `.txt` → hand its bytes to the worker path. Enforce zip-bomb caps BEFORE inflate completes where possible (compressed size cap on the `File` + uncompressed cap after listing via entry sizes). [CITED: https://www.npmjs.com/package/fflate] (API/size claims)
**When to use:** Only when `file.name` ends `.zip` (case-insensitive) or sniffed magic `PK\x03\x04`.
```ts
// Source: fflate API per https://www.npmjs.com/package/fflate (unzipSync → Record<string, Uint8Array>)
import { unzipSync } from 'fflate'; // [ASSUMED package — human-verify at install]

const MAX_ZIP_BYTES = 25_000_000;       // compressed cap [ASSUMED — planner confirms]
const MAX_UNZIPPED_BYTES = 50_000_000;  // uncompressed cap (zip-bomb guard)

export function extractTxtFromZip(data: Uint8Array): { name: string; bytes: Uint8Array } {
  const entries = unzipSync(data); // throws on corrupt zip → catch at call site → user error
  let best: { name: string; bytes: Uint8Array } | null = null;
  for (const [rawName, bytes] of Object.entries(entries)) {
    if (rawName.endsWith('/') || rawName.includes('__MACOSX/')) continue;   // dirs + macOS junk
    const base = rawName.split('/').pop() ?? '';
    if (!base.toLowerCase().endsWith('.txt') || base.startsWith('.')) continue; // traversal-safe: use basename only
    if (bytes.length > MAX_UNZIPPED_BYTES) throw new Error('zip-entry-too-large');
    if (!best || bytes.length > best.bytes.length) best = { name: base, bytes };
  }
  if (!best) throw new Error('no-txt-in-zip');
  return best;
}
```
**Notes:** Basename-only handling neutralizes zip path traversal (we never write to disk — names are display-only + chat-name derivation). Multi-`.txt` zips: import the largest (WhatsApp exports one chat per file; multi-chat zip import is deferred — see Open Questions).

### Pattern 4: Drag-drop + file picker (MDN normative behavior)
**What:** `dragover`/`dragenter` MUST `preventDefault()` or the browser navigates to the file; `DataTransfer.files` is readable **only inside `drop`** (protected mode elsewhere); mirror the same handler for `<input type=file>` so picker and drop share one `handleFiles(File[])` path. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files] [CITED: https://devdoc.net/web/developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop.html]
```svelte
<!-- DropZone.svelte sketch — spinner set SYNCHRONOUSLY in the drop handler (Pitfall 1) -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  let dragging = $state(false);
  const dispatch = createEventDispatcher<{ files: { files: File[] } }>();
  function onDrop(e: DragEvent) {
    e.preventDefault(); dragging = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) dispatch('files', { files }); // parent sets status='reading' in same tick
  }
</script>
<div role="button" tabindex="0" aria-label="Drop WhatsApp export here"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop} class:dragover={dragging}>
  <slot />Drag & drop .txt/.zip here or <button>browse</button>
</div>
<input type="file" accept=".txt,.zip,.TXT,.ZIP" multiple={false} hidden
  onchange={(e) => dispatch('files', { files: [...(e.currentTarget.files ?? [])] })} />
```
**Rules:** `accept=".txt,.zip"` is a *hint*, not validation — always re-validate extension + magic + parseability in `validate.ts`; reset `input.value = ''` after each selection so re-picking the same file re-fires `change`.

### Pattern 5: Preview-before-commit + upsert against the CURRENT repositories API
**What:** The current API (`saveChat` always inserts; `bulkSave` dedupes by `dedupHash` but returns only `written`) needs exactly **two additive changes**, nothing more: (a) `ChatRepository.findChatByName(name): Promise<ChatRecord | undefined>` — `where('name').equals(name).first()` (`name` is already indexed in the v1 schema); (b) optional `onProgress(written, total)` hook on `bulkSave` for the determinate bar. Everything else is new code in `src/lib/import/`.
```ts
// preview.ts — pure (no Dexie) + thin diff. Testable without Worker/browser.
export interface PreviewSample { sender: string; timestamp: number; text: string; }
export interface ImportPreview {
  fileName: string; chatName: string; total: number;
  dateRange: { from: number; to: number } | null;
  participants: string[]; samples: PreviewSample[];
  capWarning: string | null;
}
export function buildPreview(chat: Chat, fileName: string, sampleSize = 5): ImportPreview {
  const ts = chat.messages.map((m) => m.timestamp).filter((t) => t > 0);
  return {
    fileName, chatName: deriveChatName(fileName), total: chat.messageCount,
    dateRange: ts.length ? { from: Math.min(...ts), to: Math.max(...ts) } : null,
    participants: chat.participants,
    samples: chat.messages.slice(0, sampleSize).map((m) => ({ sender: m.sender, timestamp: m.timestamp, text: m.text.slice(0, 280) })),
    capWarning: chat.capWarning,
  };
}
export interface UpsertDiff { newCount: number; skippedCount: number; existingChat?: ChatRecord; }
export async function diffPreview(db: RagChatDB, previewMsgs: { dedupHash: string }[], chatName: string): Promise<UpsertDiff> {
  const BATCH = 5000; // anyOf with 100K keys in one query risks IPC/structured-clone blowup [ASSUMED — chunk defensively]
  const seen = new Set<string>();
  for (let i = 0; i < previewMsgs.length; i += BATCH) {
    const keys = await db.messages.where('dedupHash').anyOf(previewMsgs.slice(i, i + BATCH).map((m) => m.dedupHash)).keys();
    for (const k of keys) seen.add(String(k));
  }
  const skippedCount = previewMsgs.filter((m) => seen.has(m.dedupHash)).length;
  const existingChat = await db.chats.where('name').equals(chatName).first();
  return { newCount: previewMsgs.length - skippedCount, skippedCount, existingChat };
}
// commit.ts — confirm path: find-or-create chat, bulkSave, refresh count, persist
export async function commitImport(db, chatName, parsed: Chat, onProgress?: (w, t) => void) {
  const chats = new ChatRepository(db); const msgs = new MessageRepository(db);
  const existing = await chats.findChatByName(chatName); // NEW method
  const chatId = existing?.id ?? await chats.saveChat({ name: chatName, messageCount: parsed.messageCount, participants: parsed.participants });
  const records = parsed.messages.map((m) => ({ chatId, timestamp: m.timestamp, sender: m.sender, text: m.text, type: m.type, mediaType: m.mediaType, dedupHash: m.dedupHash, terms: tokenize(m.text) }));
  const written = await msgs.bulkSave(records, onProgress); // onProgress = NEW optional param
  if (existing) await db.chats.update(chatId, { messageCount: (existing.messageCount ?? 0) + written });
  if (written > 0) void ensurePersistence().then((p) => console.info('persistent storage:', p));
  return { chatId, written };
}
```
**Cancel semantics (prescriptive):** preview performs **zero writes**, so Cancel = discard in-memory `{preview, buffer}` + `worker.terminate()` + reset UI state. No staged rows, no delete-cleanup path, no "partial-data cleanup" code — the success criterion is met structurally (nothing written until Confirm). The planner must NOT design a staged-write-then-rollback variant.
**Chat naming:** `deriveChatName(fileName)` = basename minus `.txt`/`.zip` (e.g. `Chat with Alice.txt` → `Chat with Alice`); user-editable in the preview card before confirm (text input bound to `chatName`, diff re-run on rename — cheap read).

### Anti-Patterns to Avoid
- **`sv create` / any scaffold that writes `src/`:** clobbers parser/db. Additive `bun add` + hand-written shell files only.
- **Staged-write + delete-on-cancel:** doubles write volume and leaves orphan rows on crash/kill. Preview writes nothing.
- **Dexie writes from the worker:** dual-connection + proxy complexity for no benefit at this scale (Pattern 2).
- **`FileReader.readAsText`:** legacy callback API with awkward encoding control; use `await file.arrayBuffer()` + `TextDecoder` (BOM-stripped, retry-able) instead [CITED: MDN FileReader vs modern `Blob.arrayBuffer()` — File API; MEDIUM confidence on deprecation tone, HIGH on API availability].
- **`{@html message.text}` in preview samples:** raw chat text is attacker-controlled HTML/JS. Svelte `{var}` auto-escapes — always use it (Security Domain).
- **`offset()`/unbounded reads in diff:** `diffPreview` uses keyed `anyOf` batches, never full-store scans (Phase 02 Pitfall 5 still applies).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SvelteKit project skeleton | Hand-assembled rollup/vite config + router | `svelte` + `@sveltejs/kit` + `adapter-static` | Routing, prerendering, HMR, asset hashing, worker bundling — years of edge cases |
| Zip inflate/list | Custom inflate or magic-byte carving | `fflate` | DEFLATE edge cases, Zip64, data descriptors; 8 KB, zero deps |
| DnD file plumbing beyond platform API | Custom drag-state machine lib | `DataTransfer.files` + `preventDefault` handlers | Platform API covers it; libs add nothing for single-file drop |
| Preview diff index | In-memory hash-set of the whole DB | Dexie `dedupHash.anyOf()` batched query | DB already holds the truth; loading all hashes to memory OOMs at scale |
| Progress/parse orchestration framework | Task-queue lib | `postMessage` protocol + chunked `bulkSave` callback | Three message types + one callback cover every success criterion |
| HTML sanitizer for preview | Regex strip-tags | Svelte `{var}` auto-escaping (display only) | No HTML rendering is needed — samples are plain text; escaping beats sanitizing |

**Key insight:** Phase 03's custom code should be: 5 shell files (svelte config, layout, page, app.html, css), 3 small Svelte components, 5 framework-free lib modules (`validate`, `unzip`, `preview`, `commit`, `workerProtocol`), 1 thin worker wrapper, plus 2 additive repository methods. Everything else — routing, bundling, zip inflate, persistence, dedup — is library/platform behavior.

## Unit-Testing Approach (Vitest only — no Playwright this phase)

**Decision (prescriptive):** No Playwright in Phase 03. STACK.md lists Playwright for E2E drag-drop, but real DnD E2E needs a bundled browser + static build + file fixtures — heavyweight for an MVP whose logic is fully separable. Every behavior is testable as pure functions + `fake-indexeddb` integration: `handleFiles` core takes `File`-like `{name, size, arrayBuffer()}` fakes (no browser needed); worker logic is tested via the pure functions the worker imports; components are thin bindings over tested logic. Defer Playwright drag-drop E2E to Phase 4/5 when real chat UI exists to drive. [ASSUMED judgment — planner records E2E as deferred follow-up, not scope cut.]
**Worker lib gap:** `tsconfig` `lib` lacks `WebWorker` — worker file gets `/// <reference lib="webworker" />` at top (or a minimal `WorkerDedicatedScope` declaration); verify with `bun run typecheck` in Wave 0 (Pitfall 4).
**What to test:** `validate.ts` (ext/size/magic rejects + accepts); `unzip.ts` (multi-entry zip picks largest `.txt`, ignores `__MACOSX`/dirs, traversal basenames, corrupt-zip throws, entry-cap throws — build fixture zips with fflate's own `zipSync` in-test); `preview.ts` (counts, date range with `timestamp: 0` preamble exclusion, participants passthrough, sample truncation, capWarning passthrough); `diffPreview` vs seeded DB (all-new → `newCount=N`; full re-import → `skippedCount=N`; partial overlap); `commitImport` (new chat creates + writes; existing name reuses `chatId` and bumps `messageCount`; second commit of same file writes 0); `workerProtocol` round-trip via direct pure-function call (no real `Worker` in tests); cancel path = preview produced zero `chats`/`messages` rows.

## Common Pitfalls

### Pitfall 1: Parsing on the main thread before the spinner paints
**What goes wrong:** `drop` handler calls `await file.text()` + `parseString()` synchronously — the browser can't paint the spinner until the task yields, so drops appear dead for seconds on large files.
**Why it happens:** `parseString` over 40K lines is hundreds of ms of sync regex; state set just before still needs a paint frame.
**How to avoid:** Set status synchronously, then `await new Promise(requestAnimationFrame)` (or `setTimeout(0)`) before heavy work; do the parse in the worker regardless. Success criterion "immediate spinner" = status set in the same tick as `drop`, verified by unit test on the state machine (not by E2E timing).
**Warning signs:** Manual test shows spinner appearing only after preview is already done.

### Pitfall 2: `postMessage(hugeString)` structured-clone jank
**What goes wrong:** Posting a 10 MB string to/from the worker copies it (clone), doubling peak memory and adding GC pauses.
**Why it happens:** Strings are cloned, not transferred — only `ArrayBuffer`/ports transfer.
**How to avoid:** Main → worker: `file.arrayBuffer()` → `postMessage({buffer}, [buffer])` (transfer, zero-copy). Worker → main: post the **parsed preview object** (small: stats + N samples), never the full text or full message array. The full `Chat` stays in the worker until confirm… but commit needs records on main — so on confirm, either (a) re-parse on main from a retained `Blob` (cheap enough, single extra parse, keeps memory flat), or (b) worker posts records in batches. Prescriptive choice: **(a) re-parse on confirm** — `parseString` is deterministic, the file `Blob` is retained in memory anyway, and it keeps the protocol to 3 message types. [ASSUMED tradeoff — (b) is the fallback if profiling shows re-parse jank; planner notes it.]

### Pitfall 3: Encoding — BOM + latin-1 WhatsApp exports
**What goes wrong:** `file.text()` (UTF-8) mangles Windows-1252 exports (smart quotes → `�`); BOM `\uFEFF` breaks the first line's timestamp regex.
**Why it happens:** WhatsApp exports vary by phone locale/OS; parser's `normalize()` handles `\uFEFF` [ASSUMED — verify against `normalize.ts` at plan time] but not non-UTF-8 bytes.
**How to avoid:** Decode in-worker: `new TextDecoder('utf-8', {fatal: true})` try → catch → `new TextDecoder('windows-1252')` fallback; strip leading `\uFEFF` explicitly before `parseString`. Unit-test with a latin-1 fixture (byte `0x93` etc.).

### Pitfall 4: Worker TypeScript lib + SvelteKit SSR import hazards
**What goes wrong:** (a) `tsc` errors on `self`/`postMessage` (no `WebWorker` lib); (b) importing `parse.worker.ts` (or Dexie/File APIs) from SSR-prerendered code crashes the build (`File`/`Worker` undefined in Node).
**Why it happens:** `tsconfig lib: ["ES2022","DOM"]` covers main-thread DOM, not worker scope; SvelteKit prerenders `+page` at build time in Node.
**How to avoid:** (a) `/// <reference lib="webworker" />` in the worker file only; (b) construct the `Worker` lazily inside an event handler/`onMount` (never at module top level), so prerender never executes it. Wave-0 check: `bun run build` must succeed — planner's first UI task ends with a green static build, not just `dev`.

### Pitfall 5: `anyOf()` with unbounded key arrays in diffPreview
**What goes wrong:** Passing 100K hashes to one `anyOf()` blows up the IPC/structured-clone or IDB key-range limits.
**Why it happens:** Treating the query like an in-memory `Set.has`.
**How to avoid:** Batch at 5,000 (Pattern 5 `BATCH`); each batch is one indexed query — still O(total), just bounded per round-trip. [ASSUMED limit — tune if measured; correctness unaffected.]

### Pitfall 6: Extension-only validation + zip-slip display names
**What goes wrong:** Spoofed `chat.txt.exe` passes naive checks; zip entry `../../evil.txt` rendered as chat name suggests filesystem writes that never happen (confusing) or, worse, future code `fetch()`es it.
**Why it happens:** Trusting user-controlled filenames.
**How to avoid:** Validate extension AND (magic bytes for zip `PK\x03\x04`; parse-success for txt); derive chat names from **basenames only**; treat names as display text (escaped). Never `eval`/`fetch`/write using entry names.

## Code Examples

### Lazy worker creation in a Svelte component (SSR-safe)
```svelte
<script lang="ts">
  import type { WorkerRequest, WorkerResponse } from '$lib/import/workerProtocol';
  let status = $state<'idle' | 'reading' | 'parsing' | 'preview' | 'committing' | 'done' | 'error'>('idle');
  let worker: Worker | null = null; // created lazily — never at module scope (Pitfall 4)
  function ensureWorker() {
    worker ??= new Worker(new URL('$lib/import/parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => { /* progress → status; result → preview */ };
    return worker;
  }
  async function handleFiles(files: File[]) {
    status = 'reading'; // SAME TICK as drop (Pitfall 1)
    await new Promise((r) => requestAnimationFrame(r)); // let the spinner paint
    // ... validate → arrayBuffer → transfer to ensureWorker()
  }
</script>
```

### Worker protocol (shared types — the entire main↔worker contract)
```ts
// src/lib/import/workerProtocol.ts — framework-free, imported by both sides
export type WorkerRequest =
  | { type: 'parse-preview'; buffer: ArrayBuffer; fileName: string; encoding?: string };
export type WorkerResponse =
  | { type: 'progress'; phase: 'decode' | 'parse'; done: number; total?: number }
  | { type: 'preview-result'; preview: ImportPreview; hashes: string[]; stats: { bytes: number; lines: number } }
  | { type: 'error'; code: string; message: string };
```

###validate.ts sketch (single gate for both entry points)
```ts
const ACCEPT_EXT = new Set(['.txt', '.zip']);
export const MAX_FILE_BYTES = 25_000_000; // [ASSUMED — planner confirms]
export function validateFile(f: { name: string; size: number }): { kind: 'txt' | 'zip' } {
  const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
  if (!ACCEPT_EXT.has(ext)) throw new Error('unsupported-type');
  if (f.size === 0) throw new Error('empty-file');
  if (f.size > MAX_FILE_BYTES) throw new Error('file-too-large');
  return { kind: ext === '.zip' ? 'zip' : 'txt' };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Svelte legacy reactivity (`$:`) | Svelte 5 runes (`$state`, `$derived`, `$effect`) | Svelte 5 (2024) | All new components use runes; do NOT install/scaffold Svelte 4 patterns |
| `FileReader.readAsText` | `Blob.arrayBuffer()` + `TextDecoder` | Platform evolution (~2020+) | Transferable buffers + explicit encoding fallback; FileReader is legacy here |
| `jszip` default for browser unzip | `fflate` for size-sensitive use | Ecosystem shift (~2021+) | 8 KB vs ~100 KB; sync API fits the listing-scale op |
| `adapter-auto` default scaffold | `adapter-static` + `fallback` for client-only | Project decision (STACK.md) | Locked — static host, no server |
| `whatsapp-chat-parser` npm | Custom parser (Phase 01) | Project decision (STACK.md) | Locked — not revisited |

**Deprecated/outdated:**
- `FileReader` event API for new file-read code — use `arrayBuffer()`/`text()` promises.
- `@orama/orama` — later search/RAG phase only; must NOT be installed in Phase 03.
- `dexie-worker` proxy package — rejected (Pattern 2); no install.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fflate` is the right zip lib (name/API/`unzipSync`) — ecosystem + registry sourced, not officially blessed | Standard Stack, Pattern 3 | LOW — `jszip` fallback is drop-in for this use; human-verify checkpoint gates install |
| A2 | Manual additive SvelteKit install keeps `src/lib` intact; tsconfig needs only an `include` addition for `.svelte-kit` types | Pattern 1 | MEDIUM — if `rootDir`/`include` fights Kit codegen, Wave-0 build check catches it; fallback is Vite-vanilla shell (documented tradeoff) |
| A3 | Tailwind v4 CSS-first (`@import "tailwindcss"` + `@tailwindcss/vite`) — per STACK.md, not re-verified against tailwind docs this session | Pattern 1 | LOW — plan-time doc check (`https://tailwindcss.com/docs`) closes it |
| A4 | 25 MB file / 50 MB unzipped caps + 5,000 `anyOf` batch size are sane | Patterns 3/5, validate.ts | LOW — tunable constants; tests use tiny fixtures either way |
| A5 | `normalize()` strips BOM but doesn't handle latin-1 (needs TextDecoder fallback) | Pitfall 3 | LOW — in-worker decode fallback covers both cases regardless |
| A6 | Re-parse-on-confirm (Pitfall 2, option a) keeps commit jank acceptable | Pitfall 2 | MEDIUM — fallback (worker posts record batches) is specified if profiling says otherwise |
| A7 | No Playwright this phase; Vitest + `File`-fakes cover all behaviors; E2E deferred to Phase 4/5 | Unit-Testing | LOW — explicit deferral, not a gap; recorded as follow-up |
| A8 | Multi-`.txt` zip → import largest only; multi-chat zip import deferred | Pattern 3 | LOW — matches WhatsApp single-chat export reality; Open Questions notes it |

## Open Questions

1. **Multi-chat `.zip` (several `.txt` entries, one per chat)?**
   - What we know: WhatsApp exports one chat per file; Google-Drive bulk exports could zip several.
   - What's unclear: whether users will ever drop such zips in v1.
   - Recommendation: largest-`.txt`-only for Phase 03; record multi-select/multi-import as deferred idea.
2. **`vite-plugin-pwa` now or later?**
   - What we know: STACK.md lists it; PWA requirements (PWA-01..03) are v2/deferred in REQUIREMENTS.md.
   - What's unclear: nothing blocking — installing now adds Workbox build complexity with no Phase 03 success criterion needing it.
   - Recommendation: defer to the PWA phase; note the decision in PLAN.md so Phase 4 doesn't re-litigate.
3. **Exact `+layout.ts` prerender/SSR flags vs installed Kit version behavior**
   - What we know: `prerender = true` + `fallback: '200.html'` is the documented SPA shape [CITED: https://svelte.dev/docs/kit/adapter-static] [CITED: https://svelte.dev/docs/kit/single-page-apps].
   - What's unclear: minor flag interactions (`ssr`, `trailingSlash`) depend on host + Kit patch version.
   - Recommendation: Wave-0 task ends with green `bun run build` + serving `build/` statically; adjust flags there, not in research.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bun | installs, test, typecheck, build | ✓ | 1.3.14 | — |
| node | Vitest/SvelteKit build runtime | ✓ | v24.15.0 | — |
| Browser IndexedDB / Worker / DnD / TextDecoder | runtime import flow | ✗ (Node env) | — | `fake-indexeddb` in tests; pure-function tests for worker logic; real behavior in browser |
| `navigator.storage.persist` | post-commit durability | ✗ (Node env) | — | existing guarded `ensurePersistence()` (Phase 02) |
| Playwright browsers | E2E (deferred) | not installed | — | Not needed — no Playwright this phase |

**Missing dependencies with no fallback:** none (all runtime APIs are browser-native; scaffold + `fflate` install in Wave 0).
**Missing dependencies with fallback:** browser-only APIs under Node → `fake-indexeddb` + `File`-fakes + pure-function worker tests (planned, not a blocker).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x (existing, `bun run test` = `vitest run`) |
| Config file | `vitest.config.ts` (exists — EXTEND with Kit plugin per Pattern 1, keep `setupFiles`) |
| Quick run command | `bun run test -- src/lib/import` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IMPR-01 | `handleFiles` core accepts dropped `File`-fakes; rejects empty/oversize/bad-ext | unit (File-fakes, no browser) | `bun run test -- src/lib/import/__tests__/validate.test.ts` | ❌ Wave 0 |
| IMPR-02 | Picker path shares `handleFiles`; `.zip` magic sniff; `input.value` reset note | unit + code-review (accept attr) | same file + `unzip.test.ts` | ❌ Wave 0 |
| IMPR-02 (zip) | Largest-`.txt` picked; `__MACOSX`/dirs ignored; corrupt zip → `no-txt-in-zip`/throw; entry-cap throws | unit (`zipSync` fixtures in-test) | `bun run test -- src/lib/import/__tests__/unzip.test.ts` | ❌ Wave 0 |
| IMPR-03 | `buildPreview`: total, date-range (excl. ts-0 preamble), participants, N samples truncated, capWarning passthrough | unit (pure) | `bun run test -- src/lib/import/__tests__/preview.test.ts` | ❌ Wave 0 |
| IMPR-05 | `diffPreview`: all-new / full-dup / partial overlap counts; `findChatByName` hit/miss | integration (fake-indexeddb) | `bun run test -- src/lib/import/__tests__/upsert.test.ts` | ❌ Wave 0 |
| IMPR-05 | `commitImport`: new chat writes; existing name reuses chatId + bumps count; re-commit writes 0; cancel writes 0 rows | integration | same file | ❌ Wave 0 |
| SC spinner | Status set synchronously on files-received (state-machine unit test) | unit | `bun run test -- src/lib/import/__tests__/importState.test.ts` (or component-logic module) | ❌ Wave 0 |
| SC progress | Worker emits progress events; `bulkSave` `onProgress` fires per chunk | unit (protocol) + integration | protocol test + `upsert.test.ts` progress assertion | ❌ Wave 0 |
| Worker | Pure fns the worker wraps: decode fallback (latin-1 fixture), protocol round-trip without real `Worker` | unit | `bun run test -- src/lib/import/__tests__/workerLogic.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test -- src/lib/import` + `bun run typecheck`
- **Per wave merge:** `bun run test` (full) + `bun run lint` + `bun run build` (static shell must stay green once scaffolded)
- **Phase gate:** Full suite green + `build/` serves the import page before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Scaffold: `bun add svelte @sveltejs/kit` + `-D @sveltejs/adapter-static @sveltejs/vite-plugin-svelte vite tailwindcss @tailwindcss/vite` (behind `checkpoint:human-verify`; `fflate` via `bun add fflate` same gate)
- [ ] `svelte.config.js`, `src/app.html`, `src/routes/+layout.ts`, root CSS with `@import "tailwindcss"`, extended `vitest.config.ts` (Kit + Tailwind plugins, keep `setupFiles`)
- [ ] `src/lib/db` additions: `ChatRepository.findChatByName` + `bulkSave(records, onProgress?)` optional param (additive, existing tests must stay green)
- [ ] `src/lib/import/__tests__/` — validate/unzip/preview/upsert/workerLogic/importState suites above
- [ ] `tsconfig` worker-lib check: `/// <reference lib="webworker" />` in `parse.worker.ts`; `bun run typecheck` green

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-user local app, no accounts |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | Same-origin IndexedDB isolation is browser-enforced |
| V5 Input Validation | yes | `validate.ts` gate (ext + size + magic + parseability); fflate entry caps; tokenizer/parser caps inherited (Phases 01–02) |
| V6 Cryptography | no | `dedupHash` is a dedup key, not a security control |

### Known Threat Patterns for browser import (txt/zip → preview → IndexedDB)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Zip bomb (tiny zip → GB of text → OOM) | Denial of service | Compressed cap (25 MB) + uncompressed entry cap (50 MB); reject before parse [ASSUMED thresholds — planner confirms] |
| Giant single line / pasted-log message → tokenizer/index bloat | Denial of service | Inherited Phase 01 `MAX_CONTINUATION_LINES`/truncation + Phase 02 term-cap; worker memory bounded by transfer + re-parse (Pitfall 2) |
| Path traversal in zip entry names (`../../x`) | Tampering (display confusion) | Basename-only names; entries never written to disk; names rendered escaped |
| HTML/JS injection via message text rendered in preview | Cross-site scripting (self-XSS surface) | Svelte `{var}` auto-escaping ONLY — never `{@html}` on chat/file/zip content; samples truncated display strings |
| Spoofed file type (`evil.txt.exe`, renamed binary) | Spoofing | Extension + zip-magic + parse-success triple gate; unparseable input → user-facing error, zero writes |
| Re-import flooding (same file committed N times) | Denial of service / integrity | `dedupHash` idempotency (`bulkSave` pre-query + unique index) — re-commit writes 0; `messageCount` only bumped by `written` |

## Sources

### Primary (HIGH confidence)
- SvelteKit adapter-static docs — https://svelte.dev/docs/kit/adapter-static — install, `pages`/`assets`/`fallback`/`strict` options, prerender requirement
- SvelteKit SPA docs — https://svelte.dev/docs/kit/single-page-apps — fallback-page pattern, `index.html` avoidance, prerender-what-you-can
- fflate npm page — https://www.npmjs.com/package/fflate — 8 kB, zero-dep, `unzipSync`, browser+Node, perf claims
- zip.js feature page — https://gildas-lormeau.github.io/zip.js — worker pool/Zip64/AES scope (basis for overkill verdict)
- MDN `DataTransfer.files` — https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files — drop-event-only readability, protected mode
- MDN file drag-and-drop guide — https://devdoc.net/web/developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop.html — `preventDefault` on dragover, `DataTransfer`/`DataTransferItemList` dual API
- Dexie dexie-worker docs — https://dexie.org/docs/dexie-worker/dexie-worker — Dexie runs in workers natively (basis for split being a choice)
- npm registry via `bunx npm view` (2026-09-06): svelte 5.57.0, @sveltejs/kit 2.70.3, @sveltejs/adapter-static 3.0.10, vite 8.2.2, fflate 0.8.3, jszip 3.10.1, tailwindcss 4.3.3, @zip.js/zip.js 2.11.2, vite-plugin-pwa 1.3.0, @sveltejs/vite-plugin-svelte 7.3.0, playwright 1.63.0

### Secondary (MEDIUM confidence)
- fflate migration discussion — https://github.com/101arrowz/fflate/discussions/177 — jszip blocks main thread vs fflate async/worker behavior, `unzip` parallelism notes
- Vite worker idiom (`new Worker(new URL(..., import.meta.url), {type:'module'})`) — widely corroborated community pattern; exact adapter-static asset emission verified at Wave-0 build, not this session
- `Blob.arrayBuffer()` + `TextDecoder` over `FileReader` — standard platform evolution; encoding-fallback shape is prescribed practice

### Tertiary (LOW confidence)
- Cap constants (25 MB file, 50 MB unzipped, 5,000 `anyOf` batch) — engineering judgment, tunable, flagged [ASSUMED]
- Re-parse-on-confirm memory tradeoff — reasoned default with specified fallback (Pitfall 2)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions registry-verified; SvelteKit/adapter-static/DnD claims cite official docs; only `fflate` choice is assumed (procedural checkpoint)
- Architecture: HIGH — builds directly on read-and-verified Phase 01/02 code (`parseString`, `bulkSave`, schema); worker/zip/DnD patterns cite official or registry sources
- Pitfalls: HIGH — 3 of 6 cite platform/docs behavior; remaining 3 are bounded judgment calls with fallbacks specified
- Testing: MEDIUM — Vitest + fake-indexeddb path is proven in-repo (Phase 02); worker-pure-function strategy is standard but not yet demonstrated in this repo

**Research date:** 2026-09-06
**Valid until:** ~30 days (SvelteKit 2.x / Vite / fflate stable; re-check only if `@sveltejs/kit@3` or `vite@9` appears)
