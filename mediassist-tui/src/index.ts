#!/usr/bin/env bun
/**
 * Single binary entry point.
 *
 *   mediassist-tui                    → opens the interactive TUI
 *   mediassist-tui <command> [args]   → runs a CLI command
 *
 * The CLI supports:  logout · whoami · policy · claims · extract · submit · help
 * Login is exclusively handled by the TUI's in-app login screen — CLI
 * commands reuse the cookie persisted in .env.
 */
import { loadEnv } from "./config.ts";

loadEnv();

const args = process.argv.slice(2);

if (args.length > 0) {
  // CLI mode — stay in the normal screen so output is scrollable / pipeable.
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
  await runTui();
}

/**
 * Mounts the Ink TUI inside the terminal's alt-screen buffer (the same trick
 * vim / less / htop / k9s / lazygit use). The shell prompt and prior output
 * are restored on exit; the TUI doesn't pollute scrollback.
 *
 * Opt out by exporting NO_ALT_SCREEN=1 — useful when capturing output for
 * screenshots or debugging the render.
 */
async function runTui(): Promise<void> {
  const altScreen = !process.env.NO_ALT_SCREEN;

  if (altScreen) {
    // 1049h enters the alt buffer; pairs with 1049l on exit.
    process.stdout.write("\x1b[?1049h\x1b[H");
  }

  // Belt-and-braces: also restore on SIGINT and abnormal exit so we don't
  // leave the user stranded in the alt buffer with no shell.
  const restore = (): void => {
    if (altScreen) process.stdout.write("\x1b[?1049l");
  };
  process.on("exit", restore);

  try {
    const React = await import("react");
    const { render } = await import("ink");
    const { App } = await import("./ui/app.tsx");
    const { waitUntilExit } = render(React.createElement(App), { exitOnCtrlC: true });
    await waitUntilExit();
  } finally {
    restore();
    process.off("exit", restore);
  }
}
