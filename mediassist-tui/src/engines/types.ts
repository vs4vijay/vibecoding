import type { ClaimFields } from "../types.ts";

/**
 * Converts a document file into raw text.
 * Implementations: unpdf (default), markitdown (future), pdfjs-dist, etc.
 */
export interface TextExtractor {
  readonly name: string;
  /** Extensions this engine handles (lowercase, with leading dot), e.g. [".pdf"]. */
  readonly extensions: readonly string[];
  /** Whether this engine is usable on the current system (binaries present, etc.). */
  available(): Promise<boolean> | boolean;
  extract(filePath: string): Promise<TextResult>;
}

export type TextResult = {
  text: string;
  /** True if a text layer was found; false for image-only documents needing OCR. */
  hasTextLayer: boolean;
  pageCount?: number;
};

/**
 * Performs OCR on an image (or rasterized PDF page).
 * Implementations: tesseract.js (default), native tesseract, paddleocr, etc.
 */
export interface OcrEngine {
  readonly name: string;
  readonly extensions: readonly string[];
  available(): Promise<boolean> | boolean;
  recognize(filePath: string): Promise<string>;
}

/**
 * Extracts structured ClaimFields from raw text. Engines are chained — the
 * first engine builds the initial guess; subsequent engines refine only
 * low-confidence or missing fields.
 *
 * Implementations: heuristic (default, always on), ollama (local LLM),
 * future: anthropic, openai, gemini, etc.
 */
export interface FieldExtractor {
  readonly name: string;
  available(): Promise<boolean> | boolean;
  extract(text: string, partial?: ClaimFields): Promise<ClaimFields>;
}
