import { createWorker } from "tesseract.js";
import type { OcrEngine } from "../types.ts";

export const tesseractOcrEngine: OcrEngine = {
  name: "tesseract",
  extensions: [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"],
  available: () => true,
  async recognize(filePath: string): Promise<string> {
    const langs = (process.env.TESSERACT_LANGS ?? "eng,hin").split(",");
    const worker = await createWorker(langs);
    try {
      const { data } = await worker.recognize(filePath as never);
      return data.text.trim();
    } finally {
      await worker.terminate();
    }
  },
};
