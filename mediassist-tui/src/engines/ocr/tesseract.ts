import { createWorker } from "tesseract.js";
import type { OcrEngine } from "../types.ts";

export const tesseractOcrEngine: OcrEngine = {
  name: "tesseract",
  extensions: [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"],
  available: () => true,
  async recognize(input: string | Uint8Array | Buffer): Promise<string> {
    const langs = (process.env.TESSERACT_LANGS ?? "eng,hin").split(",");
    const worker = await createWorker(langs);
    try {
      // tesseract.js accepts string (path/URL), Buffer, or various ImageLike
      // types. Cast to `never` to bypass the union arg's strict typing.
      const { data } = await worker.recognize(input as never);
      return data.text.trim();
    } finally {
      await worker.terminate();
    }
  },
};
