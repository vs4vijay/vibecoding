#!/usr/bin/env bun
import { password as promptPassword, text as promptText, isCancel, intro, outro } from "@clack/prompts";
import { listClaims } from "./api/claims.ts";
import { loadSession, login, logout } from "./api/auth.ts";
import { getOpdBalance, getPolicy } from "./api/policy.ts";
import { loadEnv } from "./config.ts";
import type { MediAssistClient } from "./api/client.ts";

const COMMANDS = ["login", "whoami", "logout", "policy", "claims", "help"] as const;
type Command = (typeof COMMANDS)[number];

async function main(): Promise<void> {
  loadEnv();
  const [cmd = "help"] = process.argv.slice(2);

  if (!COMMANDS.includes(cmd as Command)) {
    printHelp();
    process.exit(1);
  }

  switch (cmd as Command) {
    case "help":
      printHelp();
      return;
    case "login":
      await cmdLogin();
      return;
    case "logout":
      cmdLogout();
      return;
    case "whoami":
      cmdWhoami();
      return;
    case "policy":
      await withSession(cmdPolicy);
      return;
    case "claims":
      await withSession(cmdClaims);
      return;
  }
}

function printHelp(): void {
  console.log(`mediassist-tui CLI

Usage:
  bun run cli <command>

Commands:
  login       Login (interactive) and persist session cookie to .env
  logout      Clear stored session cookie
  whoami      Show current logged-in user from .env
  policy      Fetch policy and sum-insured details
  claims      List past claims
  help        Show this message
`);
}

async function cmdLogin(): Promise<void> {
  intro("Medi Assist Login");
  const env = loadEnv();
  const usernameInput = await promptText({
    message: "Username",
    initialValue: env.MEDIASSIST_USER ?? "",
    validate: (v) => (v.trim().length === 0 ? "Username is required" : undefined),
  });
  if (isCancel(usernameInput)) {
    outro("Cancelled");
    return;
  }
  const passwordInput = await promptPassword({
    message: "Password",
    validate: (v) => (v.length === 0 ? "Password is required" : undefined),
  });
  if (isCancel(passwordInput)) {
    outro("Cancelled");
    return;
  }

  try {
    await login(usernameInput.trim(), passwordInput);
    outro(`Logged in as ${usernameInput.trim()} — session saved to .env`);
  } catch (err) {
    outro(`Login failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function cmdLogout(): void {
  logout();
  console.log("Session cleared.");
}

function cmdWhoami(): void {
  const env = loadEnv();
  if (!env.MEDIASSIST_USER) {
    console.log("Not logged in. Run: bun run cli login");
    return;
  }
  const expiresAt = env.MEDIASSIST_COOKIE_EXPIRES_AT
    ? Number(env.MEDIASSIST_COOKIE_EXPIRES_AT)
    : 0;
  const remaining = expiresAt - Date.now();
  console.log(`User:   ${env.MEDIASSIST_USER}`);
  console.log(
    `Session: ${
      remaining > 0 ? `valid for ~${Math.round(remaining / 60_000)} min` : "expired / unknown"
    }`,
  );
}

async function withSession(fn: (client: MediAssistClient) => Promise<void>): Promise<void> {
  const client = await loadSession();
  if (!client) {
    console.error("No active session. Run: bun run cli login");
    process.exitCode = 1;
    return;
  }
  try {
    await fn(client);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function cmdPolicy(client: MediAssistClient): Promise<void> {
  const [policy, opd] = await Promise.all([getPolicy(client), getOpdBalance(client)]);
  console.log("");
  console.log(`Policy:        ${policy.policyNumber}`);
  console.log(`Holder:        ${policy.policyHolder}`);
  console.log(`Insurer:       ${policy.insurer}`);
  console.log(`Sum Insured:   ₹ ${formatINR(policy.sumInsured)}  (available: ₹ ${formatINR(policy.available)})`);
  console.log(`OPD limit:     ₹ ${formatINR(opd.familyLimit)}  (available: ₹ ${formatINR(opd.familyBalance)})`);
  if (policy.validTill) console.log(`Valid till:    ${policy.validTill}`);
  if (policy.beneficiaries.length > 0) {
    console.log("");
    console.log("Beneficiaries:");
    for (const b of policy.beneficiaries) {
      console.log(`  - ${b.name.padEnd(30)} ${b.relation.padEnd(10)} ${b.dob ?? ""}`);
    }
  }
}

async function cmdClaims(client: MediAssistClient): Promise<void> {
  const claims = await listClaims(client);
  if (claims.length === 0) {
    console.log("No claims found.");
    return;
  }
  console.log("");
  console.log(`${"Claim #".padEnd(22)}${"Beneficiary".padEnd(22)}${"Date".padEnd(13)}${"Amount".padStart(12)}  Status`);
  console.log("-".repeat(90));
  for (const c of claims) {
    console.log(
      `${c.claimNumber.padEnd(22)}${c.beneficiary.padEnd(22)}${c.submittedOn.padEnd(13)}${`₹ ${formatINR(c.amount)}`.padStart(12)}  ${c.status}`,
    );
  }
}

function formatINR(n: number): string {
  return n.toLocaleString("en-IN");
}

await main();
