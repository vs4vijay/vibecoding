// scripts/build-atlases.ts — compose production atlases from curated Kenney
// CC0 cells via ImageMagick 7 (`magick` must be on PATH). Pipeline per atlas:
// crop cell → optional uniform scale → optional palette tint → composite at
// its packed slot → emit PNG + twin JSON (AtlasFrame[] shape). Frame NAMES
// are frozen by src/data — never rename, only re-source.
//
// Sources (all CC0 1.0, license verified in each pack's License.txt):
//   TD  /tmp/kenney/tiny-dungeon/Tilemap/tilemap_packed.png      (16px grid, 12 cols)
//   RL  /tmp/kenney/roguelike-rpg/Spritesheet/roguelikeSheet_transparent.png (16px grid)
//   PP  /tmp/kenney/pixel-platformer/Tilemap/tilemap_packed.png  (18px grid, 20 cols)
//   PBG /tmp/kenney/pixel-platformer/Tilemap/tilemap-backgrounds_packed.png (3× 64x72 panes)
//   FX  /tmp/kenney/particle-pack/PNG (Transparent)/*.png        (512px sprites)
//
// Workflow: run `bun scripts/build-atlases.ts --contact-sheet` to emit labeled
// candidate grids under /tmp/kenney/contact-*.png, fill MANIFEST entries from
// them, then build and verify with the smoke test.
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { $ } from "bun";

const K = "/tmp/kenney";
const OUT = "public/assets/atlas";
const GUTTER = 1;

// Source sheets
const TD = `${K}/tiny-dungeon/Tilemap/tilemap_packed.png`; // 192x176, 16px cells
const RL = `${K}/roguelike-rpg/Spritesheet/roguelikeSheet_transparent.png`; // 968x526, 16px cells
const PP = `${K}/pixel-platformer/Tilemap/tilemap_packed.png`; // 360x162, 18px cells
const PBG = `${K}/pixel-platformer/Tilemap/tilemap-backgrounds_packed.png`; // 192x72, panes 64x72
const FX = `${K}/particle-pack/PNG (Transparent)`; // 512px particle sprites

// Tiny Dungeon sprite cast (16x16 cells on the packed sheet).
// Humanoids/monsters double as fighter poses; weapons are swing overlays.
const S = {
  mage: [0, 112], shirtless: [16, 112], bald: [32, 112], miner: [48, 112], tan: [64, 112],
  knight: [0, 128], helm: [16, 128], boy: [32, 128], girl: [48, 128], grandma: [64, 128],
  ghost: [0, 144], mummy: [16, 144], crab: [32, 144], wizard: [48, 144], elf: [64, 144],
  bat: [0, 160], golem: [16, 160], spider: [32, 160], scorpion: [48, 160], imp: [64, 160],
} as const;
const WEP = {
  dagger: [112, 128], sword: [128, 128], cleaver: [144, 128], sword2: [160, 128], sword3: [176, 128],
  hammer: [144, 144], axe: [176, 144], torch: [144, 160], torchLit: [160, 160], knife: [176, 160],
} as const;

interface Overlay {
  src: string; x: number; y: number; w: number; h: number; dx: number; dy: number;
  scale?: number; // tile scale factor (default 3); tile = w×h cropped, scaled, composited at (dx,dy)
}
interface TintPass { target: string; fill: string; fuzz?: number }
interface Cell {
  name: string; src: string; x: number; y: number; w: number; h: number;
  sw?: number; sh?: number; // frame size after scaling (defaults to w/h)
  tint?: string;       // uniform colorize (particle sprites: luminance tint)
  passes?: TintPass[]; // pixel-art palette swaps: chained -fill/-fuzz/-opaque
  overlay?: Overlay;   // second crop composited into the cell before tinting
}
interface AtlasSpec { out: string; cellW: number; cellH: number; cols?: number; pivot?: boolean; cells: Cell[] }

/** Weapon swing overlay: TD weapon crop scaled ×2 (a 32px tile inside the
 *  48x48 cell) placed at (dx,dy). dx/dy must stay within [0,16] so the tile
 *  lands fully INSIDE the recorded frame rect (a 48px tile could only sit at
 *  0,0 and offsets would push it outside the blit). */
function swing(key: readonly [number, number], dx: number, dy: number): Overlay {
  return { src: TD, x: key[0], y: key[1], w: 16, h: 16, dx, dy, scale: 2 };
}
type Pose = [readonly [number, number], Overlay?];

// Tiny Dungeon palette (exact, sampled from the sheet): skin #F7C282/#E19A65,
// outline+robe dark #3F2631, hair #763B36, leather #BD6C4A, armor #8B9BB4 /
// #C0CBDC / #52607C, purple #9B4CA3/#D176D0, green #25956A, ghost mint
// #43E1B3/#69FFD4, crab red #E84537/#FF706D. Each archetype remaps every
// CLOTHING family onto its hue (light/base/dark shades); skin, hair and the
// shared outline stay untouched so sprites remain readable.
const CLOTHING_TARGETS: Array<[string, "base" | "light" | "dark"]> = [
  ["#bd6c4a", "base"],   // leather/pants
  ["#8b9bb4", "base"],   // armor mid
  ["#c0cbdc", "light"],  // armor light / beard / golem body
  ["#52607c", "dark"],   // armor dark
  ["#9b4ca3", "dark"],   // robe purple
  ["#d176d0", "light"],  // robe purple light
  ["#25956a", "dark"],   // elf tunic
  ["#43e1b3", "light"],  // ghost mint
  ["#69ffd4", "light"],  // ghost mint light
  ["#e84537", "dark"],   // crab red
  ["#ff706d", "light"],  // crab red light
  ["#763b36", "dark"],   // hair — tinted so poses shift hue with the cast
];
const passesFor = (base: string, light: string, dark: string, fuzz = 12): TintPass[] =>
  CLOTHING_TARGETS.map(([target, shade]) => ({
    target, fill: shade === "light" ? light : shade === "dark" ? dark : base, fuzz,
  }));

// ---- fighters manifest ------------------------------------------------------
// Six casts, one per archetype. Attack windups guard, actives lunge (monster
// pose + weapon overlay for melee), recovers return to the base sprite.

const BR_POSES: Record<string, Pose> = {
  _idle: [S.shirtless],
  p1_windup: [S.shirtless], p1_active: [S.crab], p1_recover: [S.shirtless],
  p2_windup: [S.shirtless], p2_active: [S.crab], p2_recover: [S.shirtless],
  p3_windup: [S.bald], p3_active: [S.golem], p3_recover: [S.shirtless],
  knee_crouch: [S.shirtless], knee_active: [S.imp], knee_land: [S.shirtless],
  blast_windup: [S.shirtless], blast_cast: [S.bald], blast_recover: [S.shirtless],
  grab_reach: [S.crab], grab_hold: [S.spider], grab_slam: [S.golem],
};

const SW_POSES: Record<string, Pose> = {
  _idle: [S.knight],
  slash1_windup: [S.helm, swing(WEP.sword, 4, 0)], slash1_active: [S.knight, swing(WEP.sword2, 16, 12)], slash1_recover: [S.knight],
  slash2_windup: [S.helm, swing(WEP.sword, 4, 0)], slash2_active: [S.crab, swing(WEP.sword2, 16, 12)], slash2_recover: [S.knight],
  slash3_windup: [S.helm, swing(WEP.sword, 6, 0)], slash3_active: [S.golem, swing(WEP.sword2, 14, 12)], slash3_recover: [S.knight],
  dash_crouch: [S.scorpion], dash_lunge: [S.crab, swing(WEP.sword2, 16, 10)], dash_land: [S.knight],
  beam_charge: [S.knight, swing(WEP.torch, 6, 0)], beam_cast: [S.knight, swing(WEP.torch, 16, 8)], beam_recover: [S.knight],
  grab_reach: [S.crab], grab_hold: [S.spider], grab_slam: [S.golem],
};

const FC_POSES: Record<string, Pose> = {
  _idle: [S.wizard],
  spark1_windup: [S.wizard, swing(WEP.torch, 4, 0)], spark1_active: [S.ghost], spark1_recover: [S.wizard],
  spark2_windup: [S.wizard, swing(WEP.torchLit, 4, 0)], spark2_active: [S.ghost], spark2_recover: [S.wizard],
  sweep_crouch: [S.scorpion], sweep_active: [S.ghost], sweep_recover: [S.wizard],
  ball_charge: [S.wizard, swing(WEP.torchLit, 6, 0)], ball_cast: [S.wizard, swing(WEP.torchLit, 16, 8)], ball_recover: [S.wizard],
  meteor_charge: [S.wizard, swing(WEP.torch, 6, 0)], meteor_cast: [S.wizard, swing(WEP.torch, 16, 8)], meteor_recover: [S.wizard],
  grab_reach: [S.crab], grab_hold: [S.spider], grab_scorch: [S.golem],
};

const IC_POSES: Record<string, Pose> = {
  _idle: [S.mage],
  frost1_windup: [S.mage], frost1_active: [S.ghost], frost1_recover: [S.mage],
  frost2_windup: [S.mage], frost2_active: [S.ghost], frost2_recover: [S.mage],
  bolt_charge: [S.mage, swing(WEP.torchLit, 6, 0)], bolt_cast: [S.mage, swing(WEP.torchLit, 16, 8)], bolt_recover: [S.mage],
  charge_crouch: [S.mummy], charge_active: [S.mummy], charge_recover: [S.mage],
  pillar_cast: [S.mage], pillar_charge: [S.golem], pillar_recover: [S.mage],
  grab_reach: [S.crab], grab_hold: [S.spider], grab_shatter: [S.golem],
};

const NJ_POSES: Record<string, Pose> = {
  _idle: [S.elf],
  cut1_windup: [S.elf, swing(WEP.dagger, 4, 0)], cut1_active: [S.elf, swing(WEP.dagger, 16, 12)], cut1_recover: [S.elf],
  cut2_windup: [S.elf, swing(WEP.dagger, 4, 0)], cut2_active: [S.crab, swing(WEP.dagger, 16, 12)], cut2_recover: [S.elf],
  cut3_windup: [S.elf, swing(WEP.dagger, 6, 0)], cut3_active: [S.golem, swing(WEP.dagger, 14, 12)], cut3_recover: [S.elf],
  rush_crouch: [S.scorpion], rush_active: [S.crab], rush_land: [S.elf],
  volley_draw: [S.elf, swing(WEP.dagger, 4, 4)], volley_throw: [S.elf, swing(WEP.dagger, 16, 8)], volley_recover: [S.elf],
  tp_blur: [S.bat], tp_slash: [S.elf, swing(WEP.dagger, 16, 10)], tp_reappear: [S.elf],
  grab_reach: [S.crab], grab_hold: [S.spider], grab_toss: [S.golem],
};

const SM_POSES: Record<string, Pose> = {
  _idle: [S.grandma],
  pulse1_windup: [S.grandma], pulse1_active: [S.ghost], pulse1_recover: [S.grandma],
  pulse2_windup: [S.grandma], pulse2_active: [S.ghost], pulse2_recover: [S.grandma],
  heal_charge: [S.grandma], heal_cast: [S.mage], heal_recover: [S.grandma],
  ward_raise: [S.ghost], ward_hold: [S.ghost], ward_lower: [S.grandma],
  lance_charge: [S.mage, swing(WEP.torch, 6, 0)], lance_cast: [S.mage, swing(WEP.torch, 16, 8)], lance_recover: [S.mage],
  dash_crouch: [S.scorpion], dash_active: [S.crab], dash_recover: [S.grandma],
  grab_reach: [S.crab], grab_hold: [S.spider], grab_banish: [S.ghost],
};

// Character sheets drive the frozen names: move frames use the short
// per-archetype code (br/sw/fc/ic/nj/sm), the idle fallback uses the full
// charId (`brawler_idle`, ... — see renderer's `${charId}_idle` fallback).
const CASTS: Array<{ id: string; code: string; poses: Record<string, Pose>; palette: TintPass[] }> = [
  //                       base        light       dark
  { id: "brawler", code: "br", poses: BR_POSES, palette: passesFor("#9aa2ac", "#c8ced6", "#6a7078") },
  { id: "swordsman", code: "sw", poses: SW_POSES, palette: passesFor("#b07840", "#d8a860", "#7a5028") },
  { id: "fire-caster", code: "fc", poses: FC_POSES, palette: passesFor("#d05030", "#ff8858", "#8a2e18") },
  { id: "ice-caster", code: "ic", poses: IC_POSES, palette: passesFor("#58a0e0", "#90c8f4", "#2e6aa8") },
  { id: "ninja", code: "nj", poses: NJ_POSES, palette: passesFor("#48a860", "#78d890", "#2a7040") },
  { id: "support-mage", code: "sm", poses: SM_POSES, palette: passesFor("#e8e4d8", "#ffffff", "#b0aa98") },
];

function buildFighterCells(): Cell[] {
  const cells: Cell[] = [];
  for (const cast of CASTS) {
    for (const [suffix, [sprite, overlay]] of Object.entries(cast.poses)) {
      const name = suffix === "_idle" ? `${cast.id}_idle` : `${cast.code}_${suffix}`;
      cells.push({
        name, src: TD, x: sprite[0], y: sprite[1], w: 16, h: 16,
        sw: 48, sh: 48, // 16px Kenney cells scaled ×3 to the mandated CELL=48 gameplay size
        passes: cast.palette,
        ...(overlay ? { overlay } : {}),
      });
    }
  }
  return cells;
}

// ---- props atlas ------------------------------------------------------------
// Weapons/items as `prop_<defId>` (src/data/weapons.json + items.json).
// Pickups present at gameplay size, so every cell is scaled ×2 to fill its
// declared 32px frame (the renderer blits frames at natural size); the
// off-grid 22x18 boulder aspect-fits to 32x26.
const PROP_CELLS: Cell[] = [
  { name: "prop_knife", src: TD, x: 112, y: 128, w: 16, h: 16, sw: 32, sh: 32 },        // TD dagger
  { name: "prop_baseball-bat", src: TD, x: 144, y: 144, w: 16, h: 16, sw: 32, sh: 32 }, // TD hammer (blunt melee)
  { name: "prop_boulder", src: RL, x: 916, y: 356, w: 22, h: 18, sw: 32, sh: 26 },      // RL gray rock
  { name: "prop_box", src: TD, x: 48, y: 80, w: 16, h: 16, sw: 32, sh: 32 },            // TD wooden crate
  { name: "prop_milk", src: TD, x: 80, y: 144, w: 16, h: 16, sw: 32, sh: 32 },          // TD pale bottle
  { name: "prop_beer", src: RL, x: 901, y: 341, w: 16, h: 16, sw: 32, sh: 32 },         // RL brown stein
];

// ---- fx atlas ---------------------------------------------------------------
// Projectile sprites from the (white) Particle Pack, luminance-colorized per
// element. Names are the frozen projectile `sprite` fields of src/data.
const P = (file: string) => `${FX}/${file}`;
const fxc = (name: string, file: string, tint: string): Cell =>
  ({ name, src: P(file), x: 0, y: 0, w: 512, h: 512, sw: 32, sh: 32, tint });

const FX_CELLS: Cell[] = [
  fxc("fx_blade_wave", "slash_02.png", "#d8e8f8"),
  fxc("fx_energy_shot", "light_01.png", "#ffd878"),
  fxc("fx_flame_ball", "fire_01.png", "#ff8830"),
  fxc("fx_freeze_pillar", "light_02.png", "#78c8f8"),
  fxc("fx_heal_orb", "magic_03.png", "#78e878"),
  fxc("fx_ice_bolt", "star_02.png", "#a8d8f8"),
  fxc("fx_meteor_core", "fire_02.png", "#ff5828"),
  fxc("fx_prism_lance", "magic_04.png", "#b090f8"),
  fxc("fx_shuriken", "star_01.png", "#c8ccd8"),
];

// ---- bg atlas ---------------------------------------------------------------
// Layer strips composed from Pixel Platformer sources. The renderer tiles each
// layer horizontally at natural pixel size and pins its BOTTOM edge to
// baselineY·scale + offsetY (camera: scale 0.6, offsetY 126 → stage baselines
// at screen y≈184/251/378). Strip heights cover each layer's visible band.
const STRIPS = `${K}/strips`;

async function tileStrip(src: string, outW: number): Promise<string> {
  // Tile a small source horizontally to outW (integer repeats, then crop).
  const meta = await $`magick identify -format %w ${src}`.quiet().text();
  const w = parseInt(meta!.trim(), 10);
  const parts = Array.from({ length: Math.ceil(outW / w) }, () => src);
  const tiled = `${src}.tiled.png`;
  await $`magick ${parts} +append -crop ${outW}x+0+0 +repage ${tiled}`.quiet();
  return tiled;
}

async function buildBgStrips(): Promise<void> {
  rmSync(STRIPS, { recursive: true, force: true });
  mkdirSync(STRIPS, { recursive: true });
  const SKY_BAND = `${STRIPS}/s.png`;  // pane1 sky→cloud band, rows 0..40
  const TREE_BAND = `${STRIPS}/t.png`; // pane1 tree silhouettes, rows 22..48
  await $`magick ${PBG} -crop 64x40+0+0 +repage ${SKY_BAND}`.quiet();
  await $`magick ${PBG} -crop 64x26+0+22 +repage ${TREE_BAND}`.quiet();

  // grassland-dojo — bright pasture
  const skyTile = await tileStrip(SKY_BAND, 960); // 960x40, sky → cloud band
  await $`magick -size 960x184 xc:"#bfe8f2" ${skyTile} -geometry +0+51 -composite ${STRIPS}/bg_dojo_sky.png`.quiet();
  const treeTile = await tileStrip(TREE_BAND, 960); // 960x26
  await $`magick -size 960x160 xc:"#ffffff" ${treeTile} -geometry +0+59 -composite -fill "#a8dade" -draw "rectangle 0,85 959,159" ${STRIPS}/bg_dojo_hills.png`.quiet();
  // floor: grass-top row + dirt row; 18px tiles inset to 16px (kills the
  // transparent corner/edge pixels) then scaled ×6 → 96px bands
  const grass = `${STRIPS}/g.png`, dirt = `${STRIPS}/d.png`;
  await $`magick ${PP} -crop 16x16+1+1 +repage -scale 600% ${grass}`.quiet();
  await $`magick ${PP} -crop 16x16+55+1 +repage -scale 600% ${dirt}`.quiet();
  const grassRow = await tileStrip(grass, 960);
  const dirtRow = await tileStrip(dirt, 960);
  await $`magick ${grassRow} ${dirtRow} -append ${STRIPS}/bg_dojo_floor.png`.quiet();

  // rooftop-night — navy sky, dark skyline, dim panels
  const stars = [
    [60, 14], [130, 30], [210, 8], [290, 24], [370, 12], [450, 32], [520, 6],
    [600, 20], [680, 36], [750, 10], [830, 26], [900, 16], [170, 44], [410, 46],
    [560, 42], [720, 46], [880, 40], [40, 40], [900, 46],
  ].map(([x, y]) => `point ${x},${y}`).join(" ");
  await $`magick -size 960x184 xc:"#141b2e" -fill "#c8d4e8" -draw ${stars} ${STRIPS}/bg_rooftop_sky.png`.quiet();
  const cityBand = `${STRIPS}/cb.png`;
  await $`magick ${TREE_BAND} -fuzz 25% -transparent "#ffffff" -fuzz 30% -fill "#26304a" -opaque "#a5d8dd" ${cityBand}`.quiet();
  const cityTile = await tileStrip(cityBand, 960);
  await $`magick -size 960x160 xc:none ${cityTile} -geometry +0+54 -composite -fill "#26304a" -draw "rectangle 0,80 959,159" ${STRIPS}/bg_rooftop_city.png`.quiet();
  const plank = `${STRIPS}/p.png`, tan = `${STRIPS}/tn.png`;
  await $`magick ${PP} -crop 16x16+1+37 +repage -scale 600% -modulate 72,85 ${plank}`.quiet();
  await $`magick ${PP} -crop 16x16+1+55 +repage -scale 600% -modulate 72,85 ${tan}`.quiet();
  const plankRow = await tileStrip(plank, 960);
  const tanRow = await tileStrip(tan, 960);
  await $`magick ${plankRow} ${tanRow} -append ${STRIPS}/bg_rooftop_floor.png`.quiet();
}

const BG_CELLS: Cell[] = [
  { name: "bg_dojo_sky", src: `${STRIPS}/bg_dojo_sky.png`, x: 0, y: 0, w: 960, h: 184 },
  { name: "bg_dojo_hills", src: `${STRIPS}/bg_dojo_hills.png`, x: 0, y: 0, w: 960, h: 160 },
  { name: "bg_dojo_floor", src: `${STRIPS}/bg_dojo_floor.png`, x: 0, y: 0, w: 960, h: 192 },
  { name: "bg_rooftop_sky", src: `${STRIPS}/bg_rooftop_sky.png`, x: 0, y: 0, w: 960, h: 184 },
  { name: "bg_rooftop_city", src: `${STRIPS}/bg_rooftop_city.png`, x: 0, y: 0, w: 960, h: 160 },
  { name: "bg_rooftop_floor", src: `${STRIPS}/bg_rooftop_floor.png`, x: 0, y: 0, w: 960, h: 192 },
];

// ---- manifest ---------------------------------------------------------------

const MANIFEST: AtlasSpec[] = [
  { out: "fighters", cellW: 48, cellH: 48, pivot: true, cells: buildFighterCells() },
  { out: "props", cellW: 32, cellH: 32, cells: PROP_CELLS },
  { out: "fx", cellW: 32, cellH: 32, cells: FX_CELLS },
  { out: "bg", cellW: 960, cellH: 192, cols: 2, cells: BG_CELLS },
];

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

async function tint(cell: Cell, scaled: string): Promise<void> {
  if (cell.passes) {
    // Pixel-art palette swap: chain -fill/-fuzz/-opaque per pass.
    const args: string[] = [];
    for (const p of cell.passes) args.push("-fill", p.fill, "-fuzz", `${p.fuzz ?? 12}%`, "-opaque", p.target);
    await $`magick ${scaled} ${args} ${scaled}`.quiet();
  } else if (cell.tint !== undefined) {
    // Grayscale particle art: colorize by luminance.
    await $`magick ${scaled} -fill ${cell.tint} -tint 100 ${scaled}`.quiet();
  }
}

async function pack(spec: AtlasSpec): Promise<void> {
  if (spec.cells.length === 0) throw new Error(`atlas ${spec.out}: no cells in MANIFEST`);
  const cols = spec.cols ?? Math.ceil(Math.sqrt(spec.cells.length));
  const rows = Math.ceil(spec.cells.length / cols);
  const sizeW = nextPow2(cols * (spec.cellW + GUTTER) + GUTTER);
  const sizeH = nextPow2(rows * (spec.cellH + GUTTER) + GUTTER);
  const tmp = "/tmp/kenney/cells";
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const canvas = `${tmp}/${spec.out}-canvas.png`;
  // PNG32 forces an RGBA canvas: a plain `xc:none` canvas stays GRAYSCALE and
  // silently strips color from every composited cell.
  await $`magick -size ${sizeW}x${sizeH} xc:none PNG32:${canvas}`.quiet();
  const frames: Array<Record<string, number | string>> = [];
  // Sequential: every job rewrites the shared canvas PNG.
  for (let i = 0; i < spec.cells.length; i++) {
    const cell = spec.cells[i]!;
    const fw = cell.sw ?? cell.w, fh = cell.sh ?? cell.h;
    const px = GUTTER + (i % cols) * (spec.cellW + GUTTER);
    const py = GUTTER + Math.floor(i / cols) * (spec.cellH + GUTTER);
    if (px + fw + GUTTER > sizeW || py + fh + GUTTER > sizeH) {
      throw new Error(`${spec.out}: cell ${cell.name} (${fw}x${fh} at +${px}+${py}) overflows ${sizeW}x${sizeH}`);
    }
    const scaled = `${tmp}/scaled-${i}.png`;
    await $`magick ${cell.src} -crop ${cell.w}x${cell.h}+${cell.x}+${cell.y} +repage -scale ${fw}x${fh}! ${scaled}`.quiet();
    if (cell.overlay) {
      const ov = `${tmp}/ov-${i}.png`;
      const os = cell.overlay.scale ?? 3;
      const w3 = cell.overlay.w * os, h3 = cell.overlay.h * os;
      await $`magick ${cell.overlay.src} -crop ${cell.overlay.w}x${cell.overlay.h}+${cell.overlay.x}+${cell.overlay.y} +repage -scale ${w3}x${h3}! ${ov}`.quiet();
      await $`magick ${scaled} ${ov} -geometry +${cell.overlay.dx}+${cell.overlay.dy} -composite ${scaled}`.quiet();
    }
    await tint(cell, scaled);
    await $`magick ${canvas} ${scaled} -geometry +${px}+${py} -composite ${canvas}`.quiet();
    frames.push({
      name: cell.name, x: px, y: py, w: fw, h: fh,
      ...(spec.pivot ? { pivotX: px + fw / 2, pivotY: py + fh } : {}),
    });
  }
  await $`magick ${canvas} PNG32:${OUT}/${spec.out}.png`.quiet();
  writeFileSync(`${OUT}/${spec.out}.json`, `${JSON.stringify(frames, null, "\t")}\n`);
  console.log(`${spec.out}: ${spec.cells.length} cells → ${sizeW}x${sizeH}`);
}

if (process.argv.includes("--contact-sheet")) {
  // Contact sheets: candidate cells at 3x so MANIFEST entries can be read
  // straight off the image (TD grid = 16px cells; RL = 16px cells).
  for (const packPath of ["Tiny Dungeon/Tilemap/tilemap_packed.png", "Roguelike RPG/Spritesheet/roguelikeSheet_transparent.png"]) {
    const src = `${K}/${packPath}`;
    if (existsSync(src)) {
      const name = packPath.split("/")[0]!.replace(/\s+/g, "-").toLowerCase();
      await $`magick ${src} -scale 300% -background "#404050" /tmp/kenney/contact-${name}.png`.quiet();
      console.log(`contact sheet: /tmp/kenney/contact-${name}.png`);
    }
  }
} else {
  await buildBgStrips();
  for (const spec of MANIFEST) {
    await pack(spec);
  }
}
