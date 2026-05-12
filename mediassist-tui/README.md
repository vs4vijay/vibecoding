# mediassist-tui

A single-binary terminal app for the Medi Assist (`portal.mediassist.in`) insurance portal. Run it with no arguments for the interactive TUI; pass a subcommand for CLI mode. Designed in the lazygit / k9s style — see [`../TUI-doc.md`](../TUI-doc.md) for the design playbook.

See [PRD.md](./PRD.md) for the project spec.

## Setup

```bash
cd mediassist-tui
bun install
cp .env.example .env
```

## Run from source

```bash
bun start                                # TUI (default — log in here)
bun run cli whoami                       # CLI subcommand
bun run cli policy
bun run cli claims
bun run cli extract <file>
bun run cli submit <file...>             # dry-run only — see PRD.md
bun run cli ocr <file>                   # PDF/image → text
```

`bun start` and `bun run cli` are aliases for the same dispatcher (`src/index.ts`). No args → TUI; with args → CLI.

**Login** is handled by the TUI itself. Run `bun start` (or the compiled binary with no arguments), enter username + password, the session cookie persists to `.env`. CLI subcommands reuse that cookie — they never prompt for credentials. If the session expires mid-use, the TUI swaps to the login screen in-place.

## Build a standalone binary

```bash
bun run build              # → bin/mediassist-tui[.exe]   (current platform)
bun run build:windows      # → bin/mediassist-tui-windows-x64.exe
bun run build:linux        # → bin/mediassist-tui-linux-x64
bun run build:macos-intel  # → bin/mediassist-tui-darwin-x64
bun run build:macos-arm    # → bin/mediassist-tui-darwin-arm64
bun run build:all          # all four platforms
```

Everything lands in `bin/` as a flat layout. Each binary is ~110 MB (bundled Bun runtime + your code + deps). Ship the binary plus an `.env` file (or let users create their own on first run) and you're done — no Bun, no Node, no install on the target machine.

The build script (`build.ts`) drives `Bun.build({ compile: ... })` and stubs out `react-devtools-core`, which Ink references behind a never-true `DEV=true` guard.

### Running the binary

```bash
./bin/mediassist-tui                   # TUI (Linux / macOS)
./bin/mediassist-tui.exe               # TUI (Windows)
./bin/mediassist-tui ocr invoice.pdf   # OCR subcommand
./bin/mediassist-tui submit *.pdf      # dry-run a multi-bill claim
```

### Known limitation: cross-compile from Windows

Cross-compile from Windows occasionally fails with `Failed to extract executable for 'bun-…'` — likely antivirus on the corporate machine. Compiling **for** Windows from Windows works perfectly; cross-compile in CI / WSL / a Linux container is reliable.

## Project status

- ✅ Phase 1 — API layer + auth
- ✅ Phase 2 — Local document extraction (unpdf + tesseract.js + heuristics, pluggable)
- ✅ Phase 3A — Dry-run payload builders + lookups (real submission **intentionally not implemented**; see saved feedback memory `feedback_mediassist_no_submit.md`)
- ✅ Phase 4 — Ink TUI (lazygit / k9s style, in-app login, single-binary dispatcher)
- ✅ Phase 5 — `bun build --compile` standalone binary distribution

## Design reference

`../TUI-doc.md` — full playbook on lazygit / k9s-style TUIs in Ink + Bun. Distilled from designing this app; portable to any new project.
