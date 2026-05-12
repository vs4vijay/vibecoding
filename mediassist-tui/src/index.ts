#!/usr/bin/env bun
import React from "react";
import { render } from "ink";
import {
  intro,
  outro,
  password as promptPassword,
  text as promptText,
  isCancel,
} from "@clack/prompts";
import { loadEnv } from "./config.ts";
import { loadSession, login } from "./api/auth.ts";
import type { MediAssistClient } from "./api/client.ts";
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

  const client = (await loadSession()) ?? (await interactiveLogin());
  if (!client) process.exit(1);

  const { waitUntilExit } = render(React.createElement(App, { client }), {
    exitOnCtrlC: true,
  });
  await waitUntilExit();
}

/**
 * Prompts the user for credentials and runs the WebForms login flow. Returns
 * an authenticated client on success, or `null` if the user cancelled.
 *
 * The prompts run via `@clack/prompts` BEFORE Ink mounts so they don't
 * conflict with Ink's raw-mode stdin handling.
 */
async function interactiveLogin(): Promise<MediAssistClient | null> {
  const env = loadEnv();
  intro("Medi Assist Login");
  const usernameInput = await promptText({
    message: "Username",
    initialValue: env.MEDIASSIST_USER ?? "",
    validate: (v) => (v.trim().length === 0 ? "Username is required" : undefined),
  });
  if (isCancel(usernameInput)) {
    outro("Cancelled");
    return null;
  }
  const passwordInput = await promptPassword({
    message: "Password",
    validate: (v) => (v.length === 0 ? "Password is required" : undefined),
  });
  if (isCancel(passwordInput)) {
    outro("Cancelled");
    return null;
  }
  try {
    const client = await login(usernameInput.trim(), passwordInput);
    outro(`Logged in as ${usernameInput.trim()}`);
    return client;
  } catch (err) {
    outro(`Login failed: ${(err as Error).message}`);
    return null;
  }
}

await main();
