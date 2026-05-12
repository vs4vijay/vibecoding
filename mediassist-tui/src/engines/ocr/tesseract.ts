import { mkdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createWorker } from "tesseract.js";
import type { OcrEngine } from "../types.ts";

/**
 * Pick a sensible cache directory for tesseract.js language models so they
 * don't litter the user's CWD with `*.traineddata` files. Follows OS app-data
 * conventions:
 *   Windows  %LOCALAPPDATA%\mediassist-tui\tesseract
 *   macOS    ~/Library/Caches/mediassist-tui/tesseract
 *   Linux    $XDG_CACHE_HOME/mediassist-tui/tesseract  (or ~/.cache/...)
 */
function cacheDir(): string {
  const APP = "mediassist-tui";
  switch (platform()) {
    case "win32":
      return join(
        process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
        APP,
        "tesseract",
      );
    case "darwin":
      return join(homedir(), "Library", "Caches", APP, "tesseract");
    default:
      return join(
        process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
        APP,
        "tesseract",
      );
  }
}

export const tesseractOcrEngine: OcrEngine = {
  name: "tesseract",
  extensions: [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"],
  available: () => true,
  async recognize(input: string | Uint8Array | Buffer): Promise<string> {
    const langs = (process.env.TESSERACT_LANGS ?? "eng,hin").split(",");
    const dir = cacheDir();
    await mkdir(dir, { recursive: true });
    const worker = await createWorker(langs, undefined, {
      cachePath: dir,
      // Without an explicit langPath, tesseract.js downloads models on first
      // use and stores them in `cachePath`. After that, runs are offline.
    });
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
