import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { extractImages, getDocumentProxy } from "unpdf";

export type RasterizedPage = {
  /** 1-based page number. */
  page: number;
  /** PNG bytes ready for OCR. */
  data: Uint8Array;
};

/**
 * Pulls the embedded images out of a PDF page-by-page and re-wraps them as
 * PNGs ready for OCR. This is the "scanned PDF" path: most scans are stored
 * as one large image per page, so `extractImages` gives us exactly that data
 * without needing to re-render anything.
 *
 * Why not `renderPageAsImage`: unpdf's renderer needs a canvas factory for
 * its image-painting sub-operations, and the auto-discovery fails in Bun
 * even with an explicit `canvasImport`. Bypassing rendering avoids the
 * whole tangle.
 *
 * If a page has multiple embedded images we encode each one separately —
 * the OCR step will run them all and the text gets concatenated upstream.
 * (Pages with no embedded image are skipped.)
 */
export async function rasterizePdf(filePath: string): Promise<RasterizedPage[]> {
  const buf = await readFile(filePath);
  const doc = await getDocumentProxy(new Uint8Array(buf));

  const pages: RasterizedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const images = await extractImages(doc, i);
    for (const img of images) {
      pages.push({ page: i, data: encodeRawImageToPng(img) });
    }
  }
  await doc.destroy?.();
  return pages;
}

type RawImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  channels: 1 | 3 | 4;
};

/**
 * Wraps raw pixel data from `extractImages` as a PNG using @napi-rs/canvas.
 * Handles 1-channel grayscale (expand to RGB), 3-channel RGB (add alpha),
 * and 4-channel RGBA (passthrough).
 */
function encodeRawImageToPng(img: RawImage): Uint8Array {
  const { data, width, height, channels } = img;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(width, height);
  const target = out.data;

  if (channels === 4) {
    target.set(data);
  } else if (channels === 3) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      target[j] = data[i]!;
      target[j + 1] = data[i + 1]!;
      target[j + 2] = data[i + 2]!;
      target[j + 3] = 255;
    }
  } else {
    // 1-channel grayscale → write same value to R/G/B
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      const v = data[i]!;
      target[j] = v;
      target[j + 1] = v;
      target[j + 2] = v;
      target[j + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toBuffer("image/png");
}
