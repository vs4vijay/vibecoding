import { readFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";
import type { TextExtractor, TextResult } from "../types.ts";

const MIN_TEXT_LAYER_CHARS = 80;
/** Y delta (in PDF coord units) that indicates a line break between items. */
const LINE_Y_BREAK = 3;

/**
 * Layout-aware PDF text extractor.
 *
 * We walk pdfjs's text items in their natural reading order and insert line
 * breaks whenever the y-coordinate jumps. This preserves the original reading
 * flow (matters for regex-based extractors) while recovering line structure
 * that `mergePages: true` would otherwise collapse onto a single line.
 *
 * Multi-page PDFs get explicit `--- page N ---` separators.
 */
export const unpdfTextExtractor: TextExtractor = {
  name: "unpdf",
  extensions: [".pdf"],
  available: () => true,
  async extract(filePath: string): Promise<TextResult> {
    const buf = await readFile(filePath);
    const doc = await getDocumentProxy(new Uint8Array(buf));

    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pageTexts.push(itemsToText(content.items));
      page.cleanup?.();
    }

    const text =
      doc.numPages > 1
        ? pageTexts.map((t, i) => `--- page ${i + 1} ---\n${t}`).join("\n\n")
        : pageTexts.join("\n\n");

    const charCount = pageTexts.reduce((n, t) => n + t.replace(/\s+/g, "").length, 0);

    return {
      text: text.trim(),
      hasTextLayer: charCount >= MIN_TEXT_LAYER_CHARS,
      pageCount: doc.numPages,
    };
  },
};

type RawItem = {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
};

function itemsToText(items: unknown[]): string {
  const out: string[] = [];
  let prevY: number | null = null;
  let lineBuf = "";

  const flushLine = (): void => {
    const trimmed = lineBuf.replace(/\s+/g, " ").trim();
    if (trimmed) out.push(trimmed);
    lineBuf = "";
  };

  for (const raw of items as RawItem[]) {
    if (!raw || typeof raw.str !== "string") continue;
    if (raw.str.length === 0) {
      // pdfjs emits a zero-length item with hasEOL=true for hard line breaks.
      if (raw.hasEOL) flushLine();
      continue;
    }
    const transform = raw.transform;
    const y = transform && transform.length >= 6 ? transform[5] : null;

    if (prevY !== null && y !== null && Math.abs(y - prevY) > LINE_Y_BREAK) {
      flushLine();
    }

    if (lineBuf && !lineBuf.endsWith(" ") && !raw.str.startsWith(" ")) {
      lineBuf += " ";
    }
    lineBuf += raw.str;

    if (raw.hasEOL) flushLine();
    if (y !== null) prevY = y;
  }

  flushLine();
  return out.join("\n");
}
