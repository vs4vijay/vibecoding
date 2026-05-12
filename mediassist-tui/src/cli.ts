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
import { extname, basename, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { extractClaim, extractTextFromFile } from "./extract/index.ts";
import { loadEnv } from "./config.ts";
import type { MediAssistClient } from "./api/client.ts";

const COMMANDS = ["whoami", "logout", "policy", "claims", "extract", "submit", "help"] as const;
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
  extract <file...>      Read PDFs/images. Text-layer PDFs use unpdf; scanned
                         PDFs and images go through tesseract.js OCR.
                         Outputs structured claim fields by default; use
                         --text for raw text, --json for both as JSON.
                         Options:
                           --text          Print raw text only (no field extraction)
                           --json          Output JSON [{file, text, fields, ms}]
                           -o, --out <dir> Write each file's text to <dir>/<basename>.txt
                           --lang <codes>  OCR languages (default: eng,hin)
                           --engine <name> OCR engine (default: tesseract)
                           --force-ocr     OCR a text-layer PDF anyway
                           -q, --quiet     Suppress headers; print only text
  submit <file...>       DRY-RUN: extract + classify + resolve lookups + print
                         the payloads that would be POSTed. Does NOT submit.
                         Files are auto-classified as "bill" or "doc".
                         Options:
                           --for <name|relation>  Override beneficiary selection
                           --bill <path>          Force a file to be a bill
                           --doc <path>           Force a file to be a doc
                           --yes                  Skip interactive prompts
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

type ExtractCliOpts = {
  text: boolean;
  json: boolean;
  out?: string;
  lang?: string;
  engine?: string;
  forceOcr: boolean;
  quiet: boolean;
};

async function cmdExtract(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      text: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      out: { type: "string", short: "o" },
      lang: { type: "string" },
      engine: { type: "string" },
      "force-ocr": { type: "boolean", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help || positionals.length === 0) {
    printExtractHelp();
    if (!values.help) process.exitCode = 1;
    return;
  }

  const opts: ExtractCliOpts = {
    text: !!values.text,
    json: !!values.json,
    out: values.out as string | undefined,
    lang: values.lang as string | undefined,
    engine: values.engine as string | undefined,
    forceOcr: !!values["force-ocr"],
    quiet: !!values.quiet,
  };
  if (opts.lang) process.env.TESSERACT_LANGS = opts.lang;
  if (opts.engine) process.env.OCR_ENGINE = opts.engine;

  const files = await expandFileArgs(positionals);
  if (files.length === 0) {
    console.error("No files matched.");
    process.exitCode = 1;
    return;
  }

  if (opts.out) await mkdir(opts.out, { recursive: true });

  type Row = {
    file: string;
    ok: boolean;
    ms: number;
    error?: string;
    text?: string;
    fields?: Awaited<ReturnType<typeof extractClaim>>;
    source?: { text?: string; ocr?: string };
  };

  const rows: Row[] = [];
  for (const file of files) {
    const t0 = performance.now();
    try {
      if (opts.text) {
        const r = await extractTextFromFile(file, opts.forceOcr);
        rows.push({ file, ok: true, ms: ms(t0), text: r.text, source: r.source });
      } else {
        const fields = await extractClaim(file, { forceOcr: opts.forceOcr });
        rows.push({
          file,
          ok: true,
          ms: ms(t0),
          fields,
          text: fields.rawText,
          source: { text: fields.engines.text, ocr: fields.engines.ocr },
        });
      }
    } catch (err) {
      rows.push({ file, ok: false, ms: ms(t0), error: (err as Error).message });
    }
  }

  if (opts.out) {
    for (const r of rows) {
      if (!r.ok || !r.text) continue;
      const ext = extname(r.file);
      await Bun.write(join(opts.out, `${basename(r.file, ext)}.txt`), r.text);
    }
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        rows.map((r) => ({
          file: r.file,
          ok: r.ok,
          ms: r.ms,
          source: r.source,
          text: r.text,
          fields: r.fields
            ? {
                billType: r.fields.billType,
                billNumber: r.fields.billNumber,
                billDate: r.fields.billDate,
                billAmount: r.fields.billAmount,
                clinicName: r.fields.clinicName,
                pincode: r.fields.pincode,
                beneficiaryHint: r.fields.beneficiaryHint,
                natureOfIllness: r.fields.natureOfIllness,
                confidence: r.fields.confidence,
              }
            : undefined,
          error: r.error,
        })),
        null,
        2,
      ),
    );
    if (rows.some((r) => !r.ok)) process.exitCode = 1;
    return;
  }

  // Pretty per-file output.
  if (files.length === 1) {
    const r = rows[0]!;
    if (!r.ok) {
      console.error(`Extract failed: ${r.error}`);
      process.exitCode = 1;
      return;
    }
    if (opts.text) {
      if (!opts.quiet) console.log(`=== ${basename(r.file)}  (${r.source?.text ?? r.source?.ocr ?? "—"}, ${r.ms} ms) ===`);
      console.log(r.text);
    } else {
      printFields(r.file, r.fields!);
    }
    return;
  }

  // Batch — compact per-file table.
  const nameWidth = Math.min(48, Math.max(...rows.map((r) => basename(r.file).length)));
  if (!opts.quiet) {
    console.log("");
    console.log(`${"File".padEnd(nameWidth)}  Result`);
    console.log("-".repeat(Math.min(120, nameWidth + 80)));
  }
  for (const r of rows) {
    const name = basename(r.file).padEnd(nameWidth);
    if (!r.ok) {
      console.log(`${name}  ERROR: ${r.error}`);
      continue;
    }
    if (opts.text) {
      console.log(`${name}  ${(r.text ?? "").replace(/\s+/g, " ").slice(0, 80)}…`);
    } else if (r.fields) {
      const f = r.fields;
      console.log(
        `${name}  ${f.billType.padEnd(22)} ${(f.billNumber || "—").padEnd(12)} ${(f.billDate || "—").padEnd(11)} ${`₹ ${formatINR(f.billAmount)}`.padStart(10)}  ${f.beneficiaryHint ?? "—"}`,
      );
    }
  }
  if (!opts.quiet) {
    const okCount = rows.filter((r) => r.ok).length;
    const totalMs = rows.reduce((s, r) => s + r.ms, 0);
    console.log("");
    console.log(`${okCount}/${rows.length} processed in ${totalMs} ms`);
  }
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
}

function ms(t0: number): number {
  return Math.round(performance.now() - t0);
}

function printSubmitHelp(): void {
  console.log(`mediassist-tui submit — DRY-RUN a claim submission (no real submission via CLI).

Usage:
  mediassist-tui submit <file> [<file> ...] [options]

Files are auto-classified as "bill" (invoice with number + amount + date/clinic)
or "doc" (supporting document, upload only). Multiple files become multiple
bills on a single claim (one beneficiary per claim).

Options:
  --for <name|relation>  Override beneficiary (e.g. --for spouse, --for "Anju Soni")
  --bill <path>          Force a file to be a bill
  --doc <path>           Force a file to be a doc
  --yes, -y              Skip the interactive beneficiary picker
  -h, --help             Show this message

Real submission (with safety prompts) is only available in the TUI — run
\`mediassist-tui\` with no arguments and use the "New Claim" tab.
`);
}

function printExtractHelp(): void {
  console.log(`mediassist-tui extract — read PDFs / images and extract text or claim fields.

Usage:
  mediassist-tui extract <file> [<file> ...] [options]
  mediassist-tui extract '<glob>'

Output modes:
  (default)             Print structured claim fields (bill type, #, date, …)
  --text                Print raw text only (text-layer PDFs use unpdf;
                        scanned PDFs and images go through OCR)
  --json                Print [{ file, text, fields, source, ms, ok }] as JSON

Options:
  -o, --out <dir>       Write each file's text to <dir>/<basename>.txt
  --lang <codes>        OCR language codes (default: eng,hin)
  --engine <name>       OCR engine (default: tesseract)
  --force-ocr           Run OCR on a PDF even if it has a text layer
  -q, --quiet           Suppress headers — pipe-friendly
  -h, --help            Show this message

Examples:
  mediassist-tui extract invoice.pdf
  mediassist-tui extract --text scan.pdf
  mediassist-tui extract --json "./samples/*.pdf" > out.json
  mediassist-tui extract -o ./txt "./samples/*"
`);
}

function printFields(file: string, fields: Awaited<ReturnType<typeof extractClaim>>): void {
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

async function cmdSubmit(client: MediAssistClient, args: string[]): Promise<void> {
  const opts = parseSubmitArgs(args);
  if (opts.help || opts.files.length === 0) {
    printSubmitHelp();
    if (!opts.help) process.exitCode = 1;
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
    console.log(`   ${tag} ${basename(f).padEnd(40)} ${detail}`);
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

function parseSubmitArgs(args: string[]): SubmitArgs & { help: boolean } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      for: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
      doc: { type: "string", multiple: true },
      bill: { type: "string", multiple: true },
      help: { type: "boolean", short: "h", default: false },
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
    help: !!values.help,
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
