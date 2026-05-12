// Phase 1: stubbed entry point. The interactive TUI lands in Phase 4 (see PRD.md §10).
// For now this just informs the user to use the CLI.
import { loadEnv } from "./config.ts";

loadEnv();

console.log(`mediassist-tui — Phase 1 (API layer only)

The interactive TUI is not built yet. Use the CLI instead:

  bun run cli login      # login and persist session
  bun run cli policy     # show policy + sum insured
  bun run cli claims     # list claims
  bun run cli whoami     # show current session info
  bun run cli logout     # clear session

See PRD.md for the full roadmap.
`);
