#!/usr/bin/env bun
import { select as promptSelect, isCancel } from "@clack/prompts";
import { parseArgs } from "node:util";
import { listClaims } from "./api/claims.ts";
import { loadSession, logout } from "./api/auth.ts";
import { getOpdBalance, getPolicy, getSubmitBeneficiaries, type SubmitBeneficiary } from "./api/policy.ts";
import { getBankDetails } from "./api/bank.ts";
import { getBillTypes, lookupPincode, matchBillType } from "./api/lookups.ts";
import { buildPayloadsForDryRun, type SubmitContext } from "./api/submit.ts";
import { getUserContext } from "./api/user-context.ts";
import { extractClaim } from "./extract/index.ts";
import { runOcr } from "./ocr.ts";
import { loadEnv } from "./config.ts";
import type { MediAssistClient } from "./api/client.ts";

const COMMANDS = ["whoami", "logout", "policy", "claims", "extract", "submit", "ocr", "help"] as const;
type Command = (typeof COMMANDS)[number];

/**
 * CLI entry point. Called from index.ts when the binary is invoked with
 * arguments; also runnable directly via `bun run src/cli.ts <command>`.
 */
export async function runCli(args: string[]): Promise<void> {
  const [cmd = "help", ...rest] = args;

  if (!COMMANDS.includes(cmd as Command)) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  switch (cmd as Command) {
    case "help":
      printHelp();
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
    case "extract":
      await cmdExtract(rest);
      return;
    case "submit":
      await withSession((client) => cmdSubmit(client, rest));
      return;
    case "ocr":
      await runOcr(rest);
      return;
  }
}

function printHelp(): void {
  console.log(`mediassist-tui

Usage:
  mediassist-tui                       Open the interactive TUI (default)
  mediassist-tui <command> [args]      Run a CLI command instead

Commands:
  logout                 Clear stored session cookie
  whoami                 Show current logged-in user from .env
  policy                 Fetch policy and sum-insured details
  claims                 List past claims
  extract <file...>      Extract claim fields from one or more PDFs/images (globs OK)
  submit <file...>       DRY-RUN: extract + classify + resolve lookups + print
                         the payloads that would be POSTed. Does NOT submit.
                         Files are auto-classified as "bill" or "doc".
                         Options:
                           --for <name|relation>  Override beneficiary selection
                           --bill <path>          Force a file to be a bill
                           --doc <path>           Force a file to be a doc
                           --yes                  Skip interactive prompts
  ocr <file...>          Convert any file (PDF/image) to text (text-layer PDFs
                         use unpdf, images use tesseract.js). Pass --help for
                         OCR-specific options.
  help                   Show this message

Login is handled by the TUI (run \`mediassist-tui\` with no arguments). CLI
commands use the session stored in .env — they don't prompt for credentials.
`);
}

function cmdLogout(): void {
  logout();
  console.log("Session cleared.");
}

function cmdWhoami(): void {
  const env = loadEnv();
  if (!env.MEDIASSIST_USER) {
    console.log("Not logged in. Run `mediassist-tui` to log in via the TUI.");
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
    console.error("No active session. Run `mediassist-tui` to log in.");
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

async function cmdExtract(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error(
      "Usage: bun run cli extract <file> [<file> ...]\n" +
        "       bun run cli extract '<glob>'   e.g. './samples/*.pdf'",
    );
    process.exitCode = 1;
    return;
  }

  const files = await expandFileArgs(args);
  if (files.length === 0) {
    console.error("No files matched.");
    process.exitCode = 1;
    return;
  }

  if (files.length === 1) {
    await extractAndPrintOne(files[0]!);
    return;
  }

  // Batch mode — concise per-file summary then totals.
  const t0 = performance.now();
  const rows: Array<{ file: string; ok: boolean; line: string }> = [];
  for (const f of files) {
    rows.push(await extractRow(f));
  }
  const ms = Math.round(performance.now() - t0);

  const fileCol = Math.min(48, Math.max(...rows.map((r) => basename(r.file).length)));
  console.log("");
  console.log(`${"File".padEnd(fileCol)}  Result`);
  console.log("-".repeat(Math.min(120, fileCol + 80)));
  for (const r of rows) {
    console.log(`${basename(r.file).padEnd(fileCol)}  ${r.line}`);
  }
  const okCount = rows.filter((r) => r.ok).length;
  console.log("");
  console.log(`${okCount}/${rows.length} extracted in ${ms} ms`);
  if (okCount < rows.length) process.exitCode = 1;
}

async function extractAndPrintOne(file: string): Promise<void> {
  try {
    const fields = await extractClaim(file);
    console.log("");
    console.log(`File:         ${file}`);
    console.log(`Bill Type:    ${fields.billType}`);
    console.log(`Bill Number:  ${fields.billNumber}`);
    console.log(`Bill Date:    ${fields.billDate}`);
    console.log(`Bill Amount:  ₹ ${formatINR(fields.billAmount)}`);
    console.log(`Clinic:       ${fields.clinicName}`);
    console.log(`Pincode:      ${fields.pincode ?? "—"}`);
    console.log(`Patient:      ${fields.beneficiaryHint ?? "—"}`);
    console.log(`Nature:       ${fields.natureOfIllness}`);
    const lowConf = Object.entries(fields.confidence ?? {})
      .filter(([, c]) => (c as number) < 0.7)
      .map(([k, c]) => `${k}=${(c as number).toFixed(2)}`)
      .join(", ");
    if (lowConf) console.log(`\nLow confidence: ${lowConf}`);
    const engines = fields.engines;
    console.log(
      `\nEngines: ${engines.text ?? engines.ocr ?? "—"} → ${engines.fields.join(" → ")}`,
    );
  } catch (err) {
    console.error(`Extract failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function extractRow(file: string): Promise<{ file: string; ok: boolean; line: string }> {
  try {
    const f = await extractClaim(file);
    const summary =
      `${f.billType.padEnd(22)} ` +
      `${(f.billNumber || "—").padEnd(12)} ` +
      `${(f.billDate || "—").padEnd(10)} ` +
      `${`₹ ${formatINR(f.billAmount)}`.padStart(10)}  ` +
      `${(f.beneficiaryHint ?? "—")}`;
    return { file, ok: true, line: summary };
  } catch (err) {
    return { file, ok: false, line: `ERROR: ${(err as Error).message}` };
  }
}

async function expandFileArgs(args: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const arg of args) {
    if (arg.includes("*") || arg.includes("?")) {
      // Bun.Glob — relative to cwd.
      const glob = new Bun.Glob(arg);
      for await (const match of glob.scan({ cwd: process.cwd(), absolute: true, onlyFiles: true })) {
        out.push(match);
      }
    } else {
      out.push(arg);
    }
  }
  return out;
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

async function cmdSubmit(client: MediAssistClient, args: string[]): Promise<void> {
  const opts = parseSubmitArgs(args);
  if (opts.files.length === 0) {
    console.error(
      "Usage: bun run cli submit <file> [<file>...] [--for <name|relation>] [--yes]\n" +
        "  --for <name|relation>  Beneficiary override (e.g. --for spouse)\n" +
        "  --yes                  Skip the interactive confirmation prompt\n" +
        "\nMultiple files become multiple bills on a single claim.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n📄 Extracting ${opts.files.length} file(s)...`);
  type Item = { file: string; fields: ClaimFieldsLike; kind: FileKind; override: boolean };
  const items: Item[] = [];
  for (const f of opts.files) {
    const fields = await extractClaim(f);
    let kind: FileKind = inferKind(fields);
    let override = false;
    if (opts.docs.includes(f)) {
      kind = "doc";
      override = true;
    } else if (opts.bills.includes(f)) {
      kind = "bill";
      override = true;
    }
    items.push({ file: f, fields, kind, override });
    const tag = `[${kind}${override ? "*" : ""}]`.padEnd(8);
    const detail =
      kind === "bill"
        ? `${fields.billType.padEnd(20)} ${fields.billNumber.padEnd(12)} ${fields.billDate.padEnd(11)} ₹ ${formatINR(fields.billAmount)}`
        : "(supporting document, upload only)";
    console.log(`   ${tag} ${basenameOf(f).padEnd(40)} ${detail}`);
  }

  const billItems = items.filter((i) => i.kind === "bill");
  if (billItems.length === 0) {
    console.error(
      "\n❌ No bills detected (every file was classified as a supporting doc).\n" +
        "   Use --bill <path> to force a file to be treated as a bill.",
    );
    process.exitCode = 1;
    return;
  }
  const bills = billItems.map((i) => i.fields);

  // Patient-hint coherence — bills should all be for the same person.
  const distinctHints = new Set(bills.map((b) => b.beneficiaryHint?.toLowerCase().trim()).filter(Boolean));
  if (distinctHints.size > 1) {
    console.log(`\n   ⚠  Bills have different patient hints (${[...distinctHints].join(", ")}).`);
    console.log(`     A claim is per-beneficiary; use --for to pick one or split into separate runs.`);
  }
  const fields = bills[0]!;

  console.log("\n🔍 Resolving lookups...");
  const [user, benefs, banks] = await Promise.all([
    getUserContext(client),
    getSubmitBeneficiaries(client),
    getBankDetails(client),
  ]);
  console.log(`   You:         ${user.fullName} (${user.empId}) @ ${user.entityCode}`);
  console.log(`   Mobile:      ${user.mobile || "—"}`);

  const benef = await chooseBeneficiary(benefs, fields.beneficiaryHint, opts);
  if (!benef) {
    process.exitCode = 1;
    return;
  }
  console.log(`   Beneficiary: ${benef.name} (${benef.relation}, ${benef.age}y) — MAID ${benef.maid}`);

  const bank = banks.find((b) => b.isActive && b.isPrimary) ?? banks[0];
  if (!bank) {
    console.error("\n❌ No bank account found on the policy.");
    process.exitCode = 1;
    return;
  }
  console.log(`   Bank:        ${bank.bankName} ${bank.ifscCode} (cheque leaf ${bank.chequeLeafId})`);

  const types = await getBillTypes(client, benef.policyId);
  const billType = matchBillType(types, fields.billType);
  if (!billType) {
    console.error(
      `\n❌ Could not map bill type "${fields.billType}" to a server ID.\n` +
        `   Server offered: ${types.map((t) => `${t.name}=${t.id}`).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`   Bill type:   ${billType.name} = ${billType.id}`);

  let cityId = 0;
  let cityName = "";
  let stateId = 0;
  let stateName = "";
  let locality = "";
  if (fields.pincode) {
    const localities = await lookupPincode(client, fields.pincode);
    const first = localities[0];
    if (first) {
      cityId = first.cityId;
      cityName = first.cityName;
      stateId = first.stateId;
      stateName = first.stateName;
      locality = first.locationName;
      console.log(`   Pincode:     ${fields.pincode} → ${locality}, ${cityName}, ${stateName}`);
    } else {
      console.log(`   Pincode:     ${fields.pincode} (no localities returned)`);
    }
  } else {
    console.log("   Pincode:     —");
  }

  const ctx: SubmitContext = {
    beneficiary: {
      id: benef.id,
      maid: benef.maid,
      name: benef.name,
      relation: benef.relation,
      relationId: benef.relationId,
      age: benef.age,
      alphaCode: benef.alphaCode,
      employeeCode: benef.employeeCode,
      policyId: benef.policyId,
      policyNumber: benef.policyNumber,
      insurer: benef.insurer,
    },
    bank,
    empId: user.empId || benef.employeeCode,
    entityId: user.entityId || benef.entityId,
    email: user.email || benef.email,
    mobile: user.mobile,
    cityId,
    cityName,
    stateId,
    stateName,
    pincode: fields.pincode ?? "",
    locality,
    billTypeId: billType.id,
    hospitalName: fields.clinicName,
    totalDocCount: 1,
  };

  ctx.totalDocCount = opts.files.length;
  const payloads = buildPayloadsForDryRun(bills, ctx, opts.files);

  const totalAmount = bills.reduce((s, b) => s + b.billAmount, 0);
  const docCount = items.filter((i) => i.kind === "doc").length;
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(
    `     DRY RUN — NO REQUESTS SENT  ·  ${bills.length} bill(s), ${docCount} doc(s), total ₹ ${formatINR(totalAmount)}`,
  );
  console.log("══════════════════════════════════════════════════════════════════");
  console.log("\n--- 1) POST /ServiceCalls/SaveDraft.aspx ---");
  printForm(payloads.saveDraft);
  payloads.fileUploads.forEach((u, i) => {
    console.log(`\n--- ${2 + i}) POST ${u.endpoint} (multipart) ---`);
    console.log(`     field "${u.field}" = <file at ${u.filePath}>`);
  });
  payloads.addClaimBills.forEach((body, i) => {
    console.log(
      `\n--- ${2 + payloads.fileUploads.length + i}) POST /ServiceCalls/AddClaimBill.aspx (bill ${i + 1} of ${payloads.addClaimBills.length}) ---`,
    );
    printForm(body);
  });
  console.log(
    `\n--- ${2 + payloads.fileUploads.length + payloads.addClaimBills.length}) POST /ServiceCalls/SubmitClaim.aspx ---`,
  );
  printForm(payloads.submitClaim);
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(" The above payloads were prepared but NOT sent.");
  console.log(" Submission is disabled by design — verify values manually and");
  console.log(" submit through the official portal when ready.");
  console.log("══════════════════════════════════════════════════════════════════");
}

type SubmitArgs = {
  files: string[];
  docs: string[];
  bills: string[];
  for?: string;
  yes: boolean;
};

function parseSubmitArgs(args: string[]): SubmitArgs {
  const { values, positionals } = parseArgs({
    args,
    options: {
      for: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
      doc: { type: "string", multiple: true },
      bill: { type: "string", multiple: true },
    },
    allowPositionals: true,
    strict: true,
  });
  const docs = (values.doc as string[] | undefined) ?? [];
  const bills = (values.bill as string[] | undefined) ?? [];
  return {
    files: [...positionals, ...docs, ...bills],
    docs,
    bills,
    for: values.for as string | undefined,
    yes: !!values.yes,
  };
}

type ClaimFieldsLike = Awaited<ReturnType<typeof extractClaim>>;

type FileKind = "bill" | "doc";

function inferKind(fields: ClaimFieldsLike): FileKind {
  const hasNum = fields.billNumber.trim().length > 0;
  const hasAmount = fields.billAmount > 0;
  const hasContext = !!fields.billDate || !!fields.clinicName;
  return hasNum && hasAmount && hasContext ? "bill" : "doc";
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * Selects which beneficiary the claim is for. Order of precedence:
 *   1. `--for <name|relation>` flag (explicit override)
 *   2. Patient hint from the invoice, if it uniquely matches one beneficiary
 *   3. Interactive prompt with the full beneficiary list
 *
 * In `--yes` mode (non-interactive), step 3 falls back to "Self" or fails.
 */
async function chooseBeneficiary(
  benefs: SubmitBeneficiary[],
  hint: string | undefined,
  opts: SubmitArgs,
): Promise<SubmitBeneficiary | null> {
  if (benefs.length === 0) {
    console.error("\n❌ No beneficiaries found on the policy.");
    return null;
  }

  if (opts.for) {
    const match = pickByOverride(benefs, opts.for);
    if (!match) {
      console.error(`\n❌ --for "${opts.for}" did not match any beneficiary.`);
      printBenefList(benefs);
      return null;
    }
    return match;
  }

  const hintMatches = hint ? fuzzyMatchByName(benefs, hint) : [];
  if (hintMatches.length === 1) return hintMatches[0]!;

  if (opts.yes) {
    // Non-interactive: hint must be unambiguous, else fall back to Self.
    if (hintMatches.length > 1) {
      console.error(
        `\n❌ Patient hint "${hint}" matched ${hintMatches.length} beneficiaries. Use --for to disambiguate.`,
      );
      printBenefList(benefs);
      return null;
    }
    const self = benefs.find((b) => b.relation.toLowerCase() === "self");
    if (self) {
      console.log(`   (no hint, --yes mode → defaulting to Self: ${self.name})`);
      return self;
    }
    return null;
  }

  // Interactive prompt
  console.log("");
  const initialValue =
    hintMatches[0]?.id ?? benefs.find((b) => b.relation.toLowerCase() === "self")?.id ?? benefs[0]!.id;
  const choice = await promptSelect({
    message: hint
      ? `Multiple beneficiaries — claim is for whom? (hint: "${hint}")`
      : "Which beneficiary is this claim for?",
    options: benefs.map((b) => ({
      value: b.id,
      label: `${b.name.padEnd(28)} ${b.relation.padEnd(10)} ${b.age}y`,
    })),
    initialValue,
  });
  if (isCancel(choice)) {
    console.log("Cancelled.");
    return null;
  }
  return benefs.find((b) => b.id === choice) ?? null;
}

function pickByOverride(benefs: SubmitBeneficiary[], override: string): SubmitBeneficiary | null {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const target = norm(override);
  // Exact relation match first (self/spouse/mother/father/son/daughter)
  const byRel = benefs.find((b) => norm(b.relation) === target);
  if (byRel) return byRel;
  // Then exact name
  const byName = benefs.find((b) => norm(b.name) === target);
  if (byName) return byName;
  // Then prefix
  const byPrefix = benefs.find((b) => norm(b.name).startsWith(target));
  if (byPrefix) return byPrefix;
  return null;
}

function fuzzyMatchByName(benefs: SubmitBeneficiary[], hint: string): SubmitBeneficiary[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const h = norm(hint);
  const exact = benefs.filter((b) => norm(b.name) === h);
  if (exact.length > 0) return exact;
  const firstName = h.split(" ")[0] ?? h;
  return benefs.filter((b) => {
    const name = norm(b.name);
    const nameFirst = name.split(" ")[0] ?? name;
    return name.startsWith(h) || name.includes(h) || nameFirst === firstName;
  });
}

function printBenefList(benefs: SubmitBeneficiary[]): void {
  console.error("   Beneficiaries on policy:");
  for (const b of benefs) {
    console.error(`     - ${b.name.padEnd(28)} (${b.relation}, ${b.age}y)`);
  }
}

function printForm(body: Record<string, string>): void {
  const keyWidth = Math.max(...Object.keys(body).map((k) => k.length));
  for (const [k, v] of Object.entries(body)) {
    const displayV = v.length > 80 ? v.slice(0, 80) + "…" : v;
    console.log(`   ${k.padEnd(keyWidth)} = ${displayV || "<empty>"}`);
  }
}

function formatINR(n: number): string {
  return n.toLocaleString("en-IN");
}

// Allow `bun run src/cli.ts <args>` for dev convenience.
if (import.meta.main) {
  loadEnv();
  await runCli(process.argv.slice(2));
}
