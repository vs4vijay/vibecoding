// src/render/renderer.ts — Canvas2D presentation pass. READS ONLY: never mutates
// the WorldState it draws. Draw order per §1: background layers (parallax) →
// pickups → depth-sorted fighters+projectiles → team rings → HUD bars.
// Missing art never crashes the battle: magenta box + one warn per missing key (§4).
import { createCamera } from "./camera";
import type { Camera } from "./camera";
import { ARENA_H, ARENA_W, MAX_FIGHTERS } from "../sim/constants";
import type { Assets } from "./types";
import type {
  CharacterSheet, Fighter, Pickup, Projectile, WorldState,
} from "../sim/types";

const VIEW_W = 960;
const VIEW_H = 540;

const MAGENTA = "#FF00FF";
const RED = "#E23B3B";
const BLUE = "#4A6FE3";

/** Placeholder stand-in box for missing fighter art, sized like a cell. */
const FIGHTER_BOX = { w: 48, h: 64 };

export interface Renderer {
  draw(w: WorldState, g: CanvasRenderingContext2D, assets: Assets): void;
}

export function createRenderer(viewW = VIEW_W, viewH = VIEW_H): Renderer {
  const camera: Camera = createCamera({ arenaW: ARENA_W, arenaH: ARENA_H, viewW, viewH });
  const warned = new Set<string>();
  const warnOnce = (key: string): void => {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[render] missing frame "${key}" — magenta placeholder`);
    }
  };

  return {
    draw(w, g, assets) {
      g.imageSmoothingEnabled = false;
      const layers = assets.stages.get(w.stage.id)?.layers ?? [];
      drawBackground(g, assets, layers, camera, viewW, viewH, warnOnce);
      for (const p of w.pickups) drawPickup(g, p, assets, camera, warnOnce);
      // Painter's algorithm by ground point (z); fighters and projectiles interleave.
      const sprites: Array<{ kind: "fighter" | "proj"; ent: Fighter | Projectile }> = [
        ...w.fighters.filter((f) => f.state !== "dead").map((f) => ({ kind: "fighter" as const, ent: f })),
        ...w.projectiles.map((p) => ({ kind: "proj" as const, ent: p })),
      ].sort((a, b) => a.ent.z - b.ent.z);
      for (const s of sprites) {
        if (s.kind === "fighter") {
          const f = s.ent as Fighter;
          if (f.team !== "independent") drawTeamRing(g, f, camera); // under sprite
          drawFighter(g, f, assets, camera, warnOnce);
        } else {
          drawProjectile(g, s.ent as Projectile, assets, camera, warnOnce);
        }
      }
      drawBars(g, w, assets.sheets);
    },
  };
}

function drawFighter(
  g: CanvasRenderingContext2D,
  f: Fighter,
  assets: Assets,
  cam: Camera,
  warnOnce: (key: string) => void,
): void {
  // Sheet lookup: sprite key comes from the move frame; missing sheet → idle fallback.
  const sheet = assets.sheets.get(f.charId);
  const mv = sheet !== undefined && f.moveId !== undefined ? sheet.moves[f.moveId] : undefined;
  const sprite = mv?.frames[f.frameIdx ?? 0]?.sprite;
  const key = sprite !== undefined ? sprite : `${f.charId}_idle`;
  let fr;
  try {
    fr = assets.fighters.frame(key);
  } catch {
    // No real tile: magenta placeholder sized to a declared frame box (§4).
    warnOnce(key);
    blitMagentaBox(g, cam.worldToScreen(f.x, f.y, f.z), FIGHTER_BOX.w, FIGHTER_BOX.h, f.facing);
    return;
  }
  blitAtGroundRow(g, assets.fighters.image, fr, cam.worldToScreen(f.x, f.y, f.z), f.facing);
}

/** Blit with feet-center pivot: anchor sits on the ground row, flip via scale(-1,1). */
function blitAtGroundRow(
  g: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  fr: { x: number; y: number; w: number; h: number },
  pos: { sx: number; sy: number; depth: number },
  facing: 1 | -1,
): void {
  const dw = Math.round(fr.w);
  const dh = Math.round(fr.h);
  g.save();
  g.translate(Math.round(pos.sx), Math.round(pos.sy));
  if (facing === -1) g.scale(-1, 1);
  g.drawImage(image, fr.x, fr.y, fr.w, fr.h, -dw / 2, -dh, dw, dh);
  g.restore();
}

function blitMagentaBox(
  g: CanvasRenderingContext2D,
  pos: { sx: number; sy: number; depth: number },
  w: number,
  h: number,
  facing: 1 | -1,
): void {
  g.save();
  g.translate(Math.round(pos.sx), Math.round(pos.sy));
  if (facing === -1) g.scale(-1, 1);
  g.fillStyle = MAGENTA;
  g.fillRect(-Math.round(w / 2), -Math.round(h), Math.round(w), Math.round(h));
  g.restore();
}

/** Team ring geometry: a flat ellipse hugging the fighter's ground row (§4). */
const RING = { rx: 16, ry: 5, drop: 3 };

/** Team ring: red/blue under the sprite; only called for non-independent fighters (§4). */
function drawTeamRing(g: CanvasRenderingContext2D, f: Fighter, cam: Camera): void {
  const pos = cam.worldToScreen(f.x, 0, f.z); // ring hugs the ground row
  g.strokeStyle = f.team === "red" ? RED : BLUE;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(pos.sx, pos.sy - RING.drop, RING.rx, RING.ry, 0, 0, Math.PI * 2);
  g.stroke();
}

function drawProjectile(
  g: CanvasRenderingContext2D,
  pr: Projectile,
  assets: Assets,
  cam: Camera,
  warnOnce: (key: string) => void,
): void {
  // §3.3 thrown weapons ride in-flight as projectiles with `prop_*` keys
  // (mirrors drawPickup's `prop_${defId}` resolution); every other
  // projectile spriteKey lives in the fx atlas.
  const atlas = pr.spriteKey.startsWith("prop_") ? assets.props : assets.fx;
  let fr;
  try {
    fr = atlas.frame(pr.spriteKey);
  } catch {
    warnOnce(pr.spriteKey);
    return;
  }
  blitAtGroundRow(g, atlas.image, fr, cam.worldToScreen(pr.x, pr.y, pr.z), pr.vx < 0 ? -1 : 1);
}

function drawPickup(
  g: CanvasRenderingContext2D,
  p: Pickup,
  assets: Assets,
  cam: Camera,
  warnOnce: (key: string) => void,
): void {
  const key = `prop_${p.defId}`;
  let fr;
  try {
    fr = assets.props.frame(key);
  } catch {
    warnOnce(key);
    return;
  }
  blitAtGroundRow(g, assets.props.image, fr, cam.worldToScreen(p.x, p.y, p.z), 1);
}

type LayerLike = { atlasKey: string; parallax: number; baselineY: number };

/** Parallax backdrop layers composited back-to-front; each tiles the view width. */
function drawBackground(
  g: CanvasRenderingContext2D,
  assets: Assets,
  layers: readonly LayerLike[],
  cam: Camera,
  viewW: number,
  viewH: number,
  warnOnce: (key: string) => void,
): void {
  g.fillStyle = "#000";
  g.fillRect(0, 0, viewW, viewH);
  for (const layer of layers) {
    let fr;
    try {
      fr = assets.bg.frame(layer.atlasKey);
    } catch {
      warnOnce(layer.atlasKey);
      continue;
    }
    // Fixed whole-arena camera ⇒ a fractional parallax factor becomes a static
    // scroll offset per layer (spec §3.5). Tile left→right across the FULL view
    // width (P1-2: the old left-marching loop covered only ~x ≤ 512).
    const scrollX = ((1 - layer.parallax) * fr.w * cam.scale) % fr.w;
    const y = Math.round(cam.offsetY + layer.baselineY * cam.scale - fr.h);
    for (let x = -(scrollX % fr.w); x < viewW; x += fr.w) {
      g.drawImage(assets.bg.image, fr.x, fr.y, fr.w, fr.h, Math.round(x), y, fr.w, fr.h);
    }
  }
}

const BAR_ROW_H = 26;
const BAR_PAD_X = 8;
const BAR_PAD_Y = 4;
const HP_BAR_H = 6;
const MP_BAR_H = 4;

/**
 * HUD bars along the top edge: HP red over MP blue, ≤8 fighters legible via a
 * 2-row × 4-column layout; right-half cells drain right→left (§4 HUD).
 */
function drawBars(g: CanvasRenderingContext2D, w: WorldState, sheets: ReadonlyMap<string, CharacterSheet>): void {
  const fighters = [...w.fighters].sort((a, b) => a.slot - b.slot).slice(0, MAX_FIGHTERS);
  if (fighters.length === 0) return;
  const cols = fighters.length > 4 ? 4 : fighters.length;
  const cellW = VIEW_W / cols;
  for (let i = 0; i < fighters.length; i++) {
    const f = fighters[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const mirrored = cols > 1 && col >= Math.ceil(cols / 2); // odd counts split 2|1 (P3-4)
    const x = col * cellW + BAR_PAD_X;
    const y = row * BAR_ROW_H + BAR_PAD_Y;
    const barW = cellW - BAR_PAD_X * 2;
    // Sheet maxima; unknown sheets fall back to the fighter's current values.
    const sheet = sheets.get(f.charId);
    const maxHp = Math.max(sheet?.maxHp ?? f.hp, 1);
    const maxMp = Math.max(sheet?.maxMp ?? f.mp, 1);
    // Fractions clamp to [0,1] so over/underflowing sim values can't smear bars.
    const hpFrac = f.hp < 0 ? 0 : f.hp > maxHp ? 1 : f.hp / maxHp;
    const mpFrac = f.mp < 0 ? 0 : f.mp > maxMp ? 1 : f.mp / maxMp;
    // Name plate
    g.fillStyle = "#FFF";
    g.font = "10px monospace";
    g.textAlign = mirrored ? "right" : "left";
    g.fillText(f.charId, mirrored ? x + barW : x, y + 9);
    // HP — red, top edge of the cell
    const hpY = y + 12;
    g.fillStyle = "#333";
    g.fillRect(x, hpY, barW, HP_BAR_H);
    g.fillStyle = RED;
    g.fillRect(mirrored ? x + barW - barW * hpFrac : x, hpY, barW * hpFrac, HP_BAR_H);
    // MP — blue, directly under
    const mpY = hpY + HP_BAR_H + 1;
    g.fillStyle = "#333";
    g.fillRect(x, mpY, barW, MP_BAR_H);
    g.fillStyle = BLUE;
    g.fillRect(mirrored ? x + barW - barW * mpFrac : x, mpY, barW * mpFrac, MP_BAR_H);
  }
}

