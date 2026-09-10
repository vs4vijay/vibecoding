// src/render/camera.ts — fixed whole-arena framing (§1): the 1600×480×120 arena
// letterbox-fits into the 960×540 logical view, centered, no scrolling.
export interface CameraConfig {
  arenaW: number;
  arenaH: number;
  viewW: number;
  viewH: number;
}

export interface Camera {
  /** World→view scale: min(viewW/arenaW, viewH/arenaH). */
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  worldToScreen(x: number, y: number, z: number): { sx: number; sy: number; depth: number };
}
/**
 * Whole-arena camera. x maps across the view width; z (depth band 0..arenaH)
 * maps down the view height — a fighter's ground row is its screen baseline.
 * `y` is height above ground (negative up per Fighter docs) and lifts sprites
 * toward the top of the screen without changing their depth sort.
 * `depth = z` feeds the painter's-algorithm sort in renderer.ts.
 */
export function createCamera(cfg: CameraConfig): Camera {
  const scale = Math.min(cfg.viewW / cfg.arenaW, cfg.viewH / cfg.arenaH);
  const offsetX = (cfg.viewW - cfg.arenaW * scale) / 2;
  const offsetY = (cfg.viewH - cfg.arenaH * scale) / 2;
  return {
    scale,
    offsetX,
    offsetY,
    worldToScreen(x: number, y: number, z: number) {
      return {
        sx: offsetX + x * scale,
        sy: offsetY + (z - y) * scale,
        depth: z,
      };
    },
  };
}
