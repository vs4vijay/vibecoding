// src/render/atlas.ts — sprite-atlas lookup: JSON frame list → pure key→rect index.
import type { AtlasFrame, Atlas } from "./types";

/**
 * Pure lookup over an atlas frame list. Throws on unknown keys so callers can
 * apply the §4 art-failure policy (magenta box + warn) instead of guessing rects.
 */
export function frameIndex(frames: readonly AtlasFrame[]): (spriteKey: string) => AtlasFrame {
  const byName = new Map<string, AtlasFrame>(frames.map((f) => [f.name, f]));
  return (spriteKey: string): AtlasFrame => {
    const f = byName.get(spriteKey);
    if (!f) throw new Error(`missing frame "${spriteKey}"`);
    return f;
  };
}

type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

/** Browser-side loader: fetch atlas PNG + twin JSON, pair them into one Atlas. */
export async function loadAtlas(pngUrl: string, jsonUrl: string, imageSource?: {
  load(url: string): Promise<ImageSource>;
}): Promise<Atlas> {
  const [image, frames] = await Promise.all([
    imageSource ? imageSource.load(pngUrl) : loadImage(pngUrl),
    fetch(jsonUrl).then((r) => {
      if (!r.ok) throw new Error(`atlas json ${jsonUrl}: HTTP ${r.status}`);
      return r.json() as Promise<AtlasFrame[]>;
    }),
  ]);
  return { image, frame: frameIndex(frames) };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`atlas png ${url} failed to load`));
  img.src = url;
  return promise;
}
