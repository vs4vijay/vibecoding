import { extname } from "node:path";
import type { ClaimFields } from "../types.ts";
import {
  getFieldExtractorChain,
  getOcrEngine,
  getTextExtractor,
} from "../engines/registry.ts";
import { rasterizePdf } from "../engines/rasterize.ts";

export type FieldsFromTextResult = ClaimFields & { engines: { fields: string[] } };

/**
 * Runs the configured field-extractor chain on a piece of already-extracted
 * text. Useful when text has been obtained from another source (e.g. the
 * `bun run ocr --fields` command which loads text itself).
 */
export async function extractFieldsFromText(
  text: string,
  opts: { fieldExtractors?: string } = {},
): Promise<FieldsFromTextResult> {
  if (opts.fieldExtractors) process.env.FIELD_EXTRACTORS = opts.fieldExtractors;

  const chain = await getFieldExtractorChain();
  let fields: ClaimFields | undefined;
  const used: string[] = [];
  for (const engine of chain) {
    if (fields && !hasLowConfidence(fields)) break;
    fields = await engine.extract(text, fields);
    used.push(engine.name);
  }
  if (!fields) throw new Error("No field extractor available");
  return { ...fields, engines: { fields: used } };
}

export type ExtractOptions = {
  /** Force OCR even if the PDF has a text layer. */
  forceOcr?: boolean;
  /** Override the field-extractor chain (comma-separated names). */
  fieldExtractors?: string;
};

export type ExtractResult = ClaimFields & {
  /** Path through the pipeline, useful for debugging. */
  engines: { text?: string; ocr?: string; fields: string[] };
};

/**
 * Orchestrates: text extraction → (OCR if needed) → chained field extractors.
 *
 * Engines are selected from environment variables — see `engines/registry.ts`:
 *   TEXT_EXTRACTOR    (default: unpdf)
 *   OCR_ENGINE        (default: tesseract)
 *   FIELD_EXTRACTORS  (default: heuristic,ollama)
 */
export async function extractClaim(
  filePath: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const ext = extname(filePath).toLowerCase();
  const { text, source } = await loadText(filePath, ext, opts.forceOcr ?? false);
  const fields = await extractFieldsFromText(text, opts);
  return {
    ...fields,
    engines: {
      text: source.text,
      ocr: source.ocr,
      fields: fields.engines.fields,
    },
  };
}

export type TextSource = { text: string; source: { text?: string; ocr?: string } };

/**
 * Returns the text contents of a file: text-layer extraction for PDFs that
 * have one, OCR for images and scanned PDFs.
 */
export async function extractTextFromFile(filePath: string, forceOcr = false): Promise<TextSource> {
  const ext = extname(filePath).toLowerCase();
  return loadText(filePath, ext, forceOcr);
}

async function loadText(filePath: string, ext: string, forceOcr: boolean): Promise<TextSource> {
  if (ext === ".pdf") {
    const textEngine = getTextExtractor();
    const result = await textEngine.extract(filePath);

    // Happy path: PDF has an embedded text layer → done.
    if (!forceOcr && result.hasTextLayer) {
      return { text: result.text, source: { text: textEngine.name } };
    }

    // Scanned PDF (or user forced OCR): rasterize each page and OCR it.
    const pages = await rasterizePdf(filePath);
    if (pages.length === 0) {
      throw new Error("PDF has no pages to render");
    }
    const ocr = getOcrEngine();
    const pageTexts: string[] = [];
    for (const p of pages) {
      const t = await ocr.recognize(p.data);
      pageTexts.push(t);
    }
    const text =
      pages.length > 1
        ? pageTexts.map((t, i) => `--- page ${i + 1} ---\n${t}`).join("\n\n").trim()
        : pageTexts.join("\n\n").trim();
    return { text, source: { text: textEngine.name, ocr: ocr.name } };
  }
  if ([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"].includes(ext)) {
    const ocr = getOcrEngine();
    const text = await ocr.recognize(filePath);
    return { text, source: { ocr: ocr.name } };
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

function hasLowConfidence(f: ClaimFields): boolean {
  const conf = f.confidence ?? {};
  for (const k of ["billNumber", "billDate", "billAmount", "clinicName"] as const) {
    if (!f[k] || (conf as Record<string, number>)[k]! < 0.7) return true;
  }
  return false;
}
