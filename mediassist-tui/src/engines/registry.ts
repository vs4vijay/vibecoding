import type { FieldExtractor, OcrEngine, TextExtractor } from "./types.ts";
import { unpdfTextExtractor } from "./text/unpdf.ts";
import { tesseractOcrEngine } from "./ocr/tesseract.ts";
import { heuristicFieldExtractor } from "./fields/heuristic.ts";
import { ollamaFieldExtractor } from "./fields/ollama.ts";

const TEXT_EXTRACTORS: Record<string, TextExtractor> = {
  unpdf: unpdfTextExtractor,
};

const OCR_ENGINES: Record<string, OcrEngine> = {
  tesseract: tesseractOcrEngine,
};

const FIELD_EXTRACTORS: Record<string, FieldExtractor> = {
  heuristic: heuristicFieldExtractor,
  ollama: ollamaFieldExtractor,
};

/**
 * Register a new engine implementation under a name. Useful for future
 * additions (markitdown, paddleocr, anthropic, openai, local-qwen) without
 * touching the orchestrator.
 */
export function registerTextExtractor(name: string, engine: TextExtractor): void {
  TEXT_EXTRACTORS[name] = engine;
}
export function registerOcrEngine(name: string, engine: OcrEngine): void {
  OCR_ENGINES[name] = engine;
}
export function registerFieldExtractor(name: string, engine: FieldExtractor): void {
  FIELD_EXTRACTORS[name] = engine;
}

export function getTextExtractor(): TextExtractor {
  const name = process.env.TEXT_EXTRACTOR ?? "unpdf";
  const engine = TEXT_EXTRACTORS[name];
  if (!engine) throw new Error(`Unknown TEXT_EXTRACTOR='${name}'. Available: ${Object.keys(TEXT_EXTRACTORS).join(", ")}`);
  return engine;
}

export function getOcrEngine(): OcrEngine {
  const name = process.env.OCR_ENGINE ?? "tesseract";
  const engine = OCR_ENGINES[name];
  if (!engine) throw new Error(`Unknown OCR_ENGINE='${name}'. Available: ${Object.keys(OCR_ENGINES).join(", ")}`);
  return engine;
}

/**
 * Returns the chain of field extractors to apply, in order. Configured via
 * `FIELD_EXTRACTORS` (comma-separated, default `heuristic,ollama`). Engines
 * whose `available()` returns false are skipped silently.
 */
export async function getFieldExtractorChain(): Promise<FieldExtractor[]> {
  const raw = process.env.FIELD_EXTRACTORS ?? "heuristic,ollama";
  const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const chain: FieldExtractor[] = [];
  for (const name of names) {
    const engine = FIELD_EXTRACTORS[name];
    if (!engine) throw new Error(`Unknown field extractor '${name}'. Available: ${Object.keys(FIELD_EXTRACTORS).join(", ")}`);
    if (await engine.available()) chain.push(engine);
  }
  if (chain.length === 0) {
    // Always fall back to heuristic so the pipeline never returns nothing.
    chain.push(heuristicFieldExtractor);
  }
  return chain;
}

export const _registeredNames = {
  textExtractors: () => Object.keys(TEXT_EXTRACTORS),
  ocrEngines: () => Object.keys(OCR_ENGINES),
  fieldExtractors: () => Object.keys(FIELD_EXTRACTORS),
};
