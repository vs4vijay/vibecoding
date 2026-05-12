#!/usr/bin/env bun
/**
 * Single binary entry point.
 *
 *   mediassist-tui                    → opens the interactive TUI
 *   mediassist-tui <command> [args]   → runs a CLI command
 *
 * The CLI supports:  logout · whoami · policy · claims · extract · submit · ocr · help
 * Login is exclusively handled by the TUI's in-app login screen — CLI
 * commands reuse the cookie persisted in .env.
 */
import { loadEnv } from "./config.ts";

loadEnv();

const args = process.argv.slice(2);

if (args.length > 0) {
  const { runCli } = await import("./cli.ts");
  await runCli(args);
} else {
  if (!process.stdin.isTTY) {
    console.error(
      "mediassist-tui requires an interactive terminal (TTY) when launched without arguments.\n" +
        "Pass a command to run non-interactively, e.g. `mediassist-tui whoami`.",
    );
    process.exit(2);
  }
  const React = await import("react");
  const { render } = await import("ink");
  const { App } = await import("./ui/app.tsx");
  const { waitUntilExit } = render(React.createElement(App), { exitOnCtrlC: true });
  await waitUntilExit();
}
