#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { extname, join, basename } from "node:path";
import { parseArgs } from "node:util";
import { getOcrEngine, getTextExtractor } from "./engines/registry.ts";
import { extractFieldsFromText, type FieldsFromTextResult } from "./extract/index.ts";

type Cli = {
  lang?: string;
  engine?: string;
  out?: string;
  json: boolean;
  quiet: boolean;
  fields: boolean;
  help: boolean;
};

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"];
const PDF_EXTS = [".pdf"];
const ALL_EXTS = [...IMAGE_EXTS, ...PDF_EXTS];

type FileResult = {
  file: string;
  text: string;
  ms: number;
  ok: boolean;
  source: "ocr" | "pdf-text" | "skip";
  pages?: number;
  error?: string;
  fields?: FieldsFromTextResult;
};

export async function runOcr(args: string[]): Promise<void> {
  const { cli, files } = parseCli(args);
  if (cli.help || files.length === 0) {
    printHelp();
    if (cli.help) return;
    process.exitCode = 1;
    return;
  }

  if (cli.lang) process.env.TESSERACT_LANGS = cli.lang;
  if (cli.engine) process.env.OCR_ENGINE = cli.engine;

  const expanded = await expandGlobs(files);
  if (expanded.length === 0) {
    console.error("No files matched.");
    process.exit(1);
  }

  if (cli.out) await mkdir(cli.out, { recursive: true });

  const results: FileResult[] = [];
  for (const file of expanded) {
    const r = await processFile(file);
    if (r.ok && cli.fields) {
      try {
        r.fields = await extractFieldsFromText(r.text);
      } catch (err) {
        r.error = `Field extraction failed: ${(err as Error).message}`;
      }
    }
    results.push(r);
  }

  await writeOutputs(results, cli);
  printOutputs(results, cli);

  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

async function processFile(file: string): Promise<FileResult> {
  const ext = extname(file).toLowerCase();
  const t0 = performance.now();

  try {
    if (IMAGE_EXTS.includes(ext)) {
      const text = await getOcrEngine().recognize(file);
      return { file, text, ms: ms(t0), ok: true, source: "ocr" };
    }

    if (PDF_EXTS.includes(ext)) {
      const pdfText = await getTextExtractor().extract(file);
      if (pdfText.hasTextLayer) {
        return {
          file,
          text: pdfText.text,
          ms: ms(t0),
          ok: true,
          source: "pdf-text",
          pages: pdfText.pageCount,
        };
      }
      return {
        file,
        text: "",
        ms: ms(t0),
        ok: false,
        source: "skip",
        error:
          "Scanned PDF (no text layer). Export pages to images and run OCR on those.",
      };
    }

    return {
      file,
      text: "",
      ms: 0,
      ok: false,
      source: "skip",
      error: `Unsupported extension '${ext}' (supported: ${ALL_EXTS.join(", ")})`,
    };
  } catch (err) {
    return {
      file,
      text: "",
      ms: ms(t0),
      ok: false,
      source: "skip",
      error: (err as Error).message,
    };
  }
}

async function writeOutputs(results: FileResult[], cli: Cli): Promise<void> {
  if (!cli.out) return;
  for (const r of results) {
    if (!r.ok) continue;
    const ext = extname(r.file);
    await Bun.write(join(cli.out, `${basename(r.file, ext)}.txt`), r.text);
  }
}

function printOutputs(results: FileResult[], cli: Cli): void {
  if (cli.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    if (cli.quiet) {
      if (r.ok) console.log(r.text);
      continue;
    }
    const meta = r.ok
      ? `${r.source}${r.pages ? `, ${r.pages} page${r.pages > 1 ? "s" : ""}` : ""}, ${r.ms} ms`
      : "skipped";
    const header = `=== ${basename(r.file)}  (${meta})`;
    console.log("");
    console.log(header);
    console.log("-".repeat(Math.min(80, header.length)));
    if (r.ok) {
      console.log(r.text);
      if (r.fields) printFields(r.fields);
    } else {
      console.log(`ERROR: ${r.error}`);
    }
  }

  if (!cli.quiet) {
    const okCount = results.filter((r) => r.ok).length;
    const totalMs = results.reduce((s, r) => s + r.ms, 0);
    console.log("");
    console.log(`${okCount}/${results.length} processed in ${totalMs} ms`);
  }
}

function parseCli(args: string[]): { cli: Cli; files: string[] } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      lang: { type: "string" },
      langs: { type: "string" },
      engine: { type: "string" },
      out: { type: "string", short: "o" },
      json: { type: "boolean", default: false },
      quiet: { type: "boolean", short: "q", default: false },
      fields: { type: "boolean", short: "f", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    cli: {
      lang: values.lang ?? values.langs,
      engine: values.engine,
      out: values.out,
      json: !!values.json,
      quiet: !!values.quiet,
      fields: !!values.fields,
      help: !!values.help,
    },
    files: positionals,
  };
}

async function expandGlobs(args: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const arg of args) {
    if (arg.includes("*") || arg.includes("?")) {
      const glob = new Bun.Glob(arg);
      for await (const m of glob.scan({ cwd: process.cwd(), absolute: true, onlyFiles: true })) {
        out.push(m);
      }
    } else {
      out.push(arg);
    }
  }
  return out;
}

function ms(t0: number): number {
  return Math.round(performance.now() - t0);
}

function printFields(f: FieldsFromTextResult): void {
  console.log("");
  console.log("--- Extracted fields ---");
  console.log(`Bill Type:    ${f.billType}`);
  console.log(`Bill Number:  ${f.billNumber || "—"}`);
  console.log(`Bill Date:    ${f.billDate || "—"}`);
  console.log(`Bill Amount:  ₹ ${(f.billAmount ?? 0).toLocaleString("en-IN")}`);
  console.log(`Clinic:       ${f.clinicName || "—"}`);
  console.log(`Pincode:      ${f.pincode ?? "—"}`);
  console.log(`Patient:      ${f.beneficiaryHint ?? "—"}`);
  console.log(`Nature:       ${f.natureOfIllness || "—"}`);
  const lowConf = Object.entries(f.confidence ?? {})
    .filter(([, c]) => (c as number) < 0.7)
    .map(([k, c]) => `${k}=${(c as number).toFixed(2)}`)
    .join(", ");
  if (lowConf) console.log(`Low confidence: ${lowConf}`);
  console.log(`Field engines: ${f.engines.fields.join(" → ")}`);
}

function printHelp(): void {
  console.log(`Convert any supported file to text.
- Images → OCR via the configured engine (default: tesseract.js)
- PDFs   → text-layer extraction via the configured extractor (default: unpdf)

Usage:
  mediassist-tui ocr [options] <file...>

Options:
  --lang <codes>      Comma-separated language codes (default: eng,hin)
  --engine <name>     OCR engine (default: tesseract)
  -o, --out <dir>     Write each file's text to <dir>/<basename>.txt
  --json              Output JSON [{ file, text, ms, ok, source, pages, error?, fields? }]
  -q, --quiet         Suppress headers/footers; print only the text
  -f, --fields        Also run the field extractor and print ClaimFields
  -h, --help          Show this message

Supported: ${ALL_EXTS.join(", ")}

Examples:
  mediassist-tui ocr photo.jpg
  mediassist-tui ocr "./scans/*.pdf"
  mediassist-tui ocr -o ./txt "./samples/*"
  mediassist-tui ocr --json "./mixed/*" > out.json
`);
}

// Allow `bun run src/ocr.ts <args>` for dev convenience.
if (import.meta.main) {
  const { loadEnv } = await import("./config.ts");
  loadEnv();
  await runOcr(process.argv.slice(2));
}
