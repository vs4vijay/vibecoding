#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import { loadSession } from "./api/auth.ts";
import { loadEnv } from "./config.ts";
import { App } from "./ui/app.tsx";

loadEnv();

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(
      "mediassist-tui requires an interactive terminal (TTY).\n" +
        "Run it directly — do not pipe stdin from a file.\n" +
        "For non-interactive use, see: bun run cli <command>",
    );
    process.exit(2);
  }

  const client = await loadSession();
  if (!client) {
    console.error("Not logged in. Run: bun run cli login");
    process.exit(1);
  }

  const { waitUntilExit } = render(React.createElement(App, { client }), {
    exitOnCtrlC: true,
  });
  await waitUntilExit();
}

await main();
