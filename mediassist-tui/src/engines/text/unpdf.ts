import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";
import type { TextExtractor, TextResult } from "../types.ts";

const MIN_TEXT_LAYER_CHARS = 80;

export const unpdfTextExtractor: TextExtractor = {
  name: "unpdf",
  extensions: [".pdf"],
  available: () => true,
  async extract(filePath: string): Promise<TextResult> {
    const buf = await readFile(filePath);
    const doc = await getDocumentProxy(new Uint8Array(buf));
    const { text, totalPages } = await extractText(doc, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    const cleaned = merged.replace(/ /g, " ").trim();
    return {
      text: cleaned,
      hasTextLayer: cleaned.length >= MIN_TEXT_LAYER_CHARS,
      pageCount: totalPages,
    };
  },
};
