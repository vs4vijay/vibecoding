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
import { loadSession, login, logout } from "./api/auth.ts";
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

  // Loop so that a mid-session expiry can drop back into the login prompt
  // and re-mount the TUI without restarting the process.
  let forceLogin = false;
  let reason: "expired" | "first-run" = "first-run";

  while (true) {
    let client: MediAssistClient | null;
    if (forceLogin) {
      logout(); // wipe stored cookie so loadSession can't re-use it
      client = await interactiveLogin({ reason });
    } else {
      client = (await loadSession()) ?? (await interactiveLogin({ reason }));
    }
    if (!client) {
      console.error("Login cancelled.");
      process.exit(1);
    }

    const result = await runTui(client);
    if (result === "quit") return;

    forceLogin = true;
    reason = "expired";
  }
}

/**
 * Renders the Ink TUI and resolves when it exits. The result tells the outer
 * loop whether to relaunch the login flow ("relogin") or terminate ("quit").
 */
function runTui(client: MediAssistClient): Promise<"quit" | "relogin"> {
  return new Promise((resolve) => {
    let settled = false;
    const onSessionExpired = (): void => {
      if (settled) return;
      settled = true;
      unmount();
      resolve("relogin");
    };
    const { unmount, waitUntilExit } = render(
      React.createElement(App, { client, onSessionExpired }),
      { exitOnCtrlC: true },
    );
    waitUntilExit().then(() => {
      if (!settled) {
        settled = true;
        resolve("quit");
      }
    });
  });
}

/**
 * Prompts the user for credentials via `@clack/prompts` BEFORE Ink mounts so
 * the prompts don't conflict with Ink's raw-mode stdin handling. Used for
 * both first-run login and post-expiry re-auth.
 */
async function interactiveLogin(opts: { reason: "first-run" | "expired" }): Promise<MediAssistClient | null> {
  const env = loadEnv();
  intro(opts.reason === "expired" ? "Session expired — please log in again" : "Medi Assist Login");
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
