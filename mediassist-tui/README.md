# mediassist-tui

Terminal UI for the Medi Assist (`portal.mediassist.in`) insurance portal. Drop a PDF or image, fields auto-extract locally, review/edit in a lazygit/k9s-style interface, and inspect the exact payload that *would* be submitted (dry-run only — actual submission is intentionally disabled).

See [PRD.md](./PRD.md) for the full spec.

## Setup

```bash
cd mediassist-tui
bun install
cp .env.example .env
```

## Run from source

```bash
bun start                              # interactive TUI (recommended)
bun run cli login                      # login from CLI
bun run cli policy                     # show policy + balance
bun run cli claims                     # list past claims
bun run cli extract <pdf-or-image>     # extract claim fields
bun run cli submit <file...>           # dry-run a claim (multiple files OK)
bun run ocr <file...>                  # OCR / text extraction
```

First TUI run prompts for Medi Assist username/password. The session cookie is saved to `.env`; the password is never stored. If the session expires mid-use, the TUI drops back to the login prompt and re-mounts.

## Building standalone binaries

The TUI compiles to a single executable that includes the Bun runtime — no Node.js, no `npm install` required on the target machine.

```bash
# Current platform (Windows here → mediassist-tui.exe)
bun run build              # → dist/current/mediassist-tui.exe (~110 MB)
bun run build:all          # → tui + cli + ocr binaries

# Cross-compile to other platforms
bun run build:windows      # → dist/bun-windows-x64/
bun run build:linux        # → dist/bun-linux-x64/
bun run build:macos-arm    # → dist/bun-darwin-arm64/
bun run build:macos-intel  # → dist/bun-darwin-x64/
```

The build script (`build.ts`) drives `Bun.build({ compile: ... })` with one custom touch: it stubs out `react-devtools-core` (which Ink references behind a never-true `DEV=true` guard) so the binary doesn't try to load a missing devtools package at startup.

Binary size: ~110 MB. That's the Bun runtime + your code + minified deps; Bun's compile is "single-file self-contained" rather than "small". Trade-off worth taking for zero-install distribution.

### Distribution

Drop the binary (plus an `.env` file in the same directory) on the target machine and run. No Bun, no Node, no install. The user's first run will prompt for credentials and persist the session.

```bash
./mediassist-tui            # Linux / macOS
mediassist-tui.exe          # Windows
```

### Known limitation: cross-compile from Windows

Cross-compiling from Windows to Linux/macOS occasionally fails with `Failed to extract executable for 'bun-linux-x64-…'`. This is a Bun-runtime download/extraction issue on Windows (often antivirus interference). Workaround: build on the target platform, or run the cross-compile inside WSL or a Linux container.

Compiling **for** Windows (from Windows) works perfectly.

## Project status

- ✅ Phase 1 — API layer + auth
- ✅ Phase 2 — Local document extraction (unpdf + tesseract.js + heuristics, pluggable)
- ✅ Phase 3A — Dry-run payload builders + lookups (submission deliberately not implemented; see [memory/feedback_mediassist_no_submit.md](../.../) in user memory)
- ✅ Phase 4 — Ink TUI (lazygit/k9s style)
- ✅ Phase 5 — Standalone binary builds via `bun build --compile`

## TUI design reference

See `../TUI-doc.md` for the playbook on building lazygit / k9s-style TUIs in Ink — distilled from designing this app.
