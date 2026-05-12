# mediassist-tui

Terminal UI for the Medi Assist (`portal.mediassist.in`) insurance portal. Submit OPD reimbursement claims by dropping in a PDF or image — fields are auto-extracted by Claude and reviewed before submission.

See [PRD.md](./PRD.md) for the full spec.

## Setup

```bash
cd mediassist-tui
bun install
cp .env.example .env
# add ANTHROPIC_API_KEY to .env
```

## Run

```bash
# TUI (default)
bun start

# CLI testing commands
bun run cli login
bun run cli policy
bun run cli claims
bun run cli extract <pdf-or-image-path>
```

First run prompts for Medi Assist username/password. The session cookie is saved to `.env`; password is never stored.

## Status

Phase 1 (API + auth) — in progress.
