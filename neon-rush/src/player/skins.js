// Skin catalog — pure data, consumed by Character.js. 14 skins (12+ required).
// A skin is palette + material response + proportions + accessory flags; all
// geometry is procedural and shared, setSkin() only rewires materials/flags.
//
// c:          hex palette { primary, secondary, dark, accent, visor? }
// slots:      optional per-slot color overrides (hex) for decals etc.
// glow:       emissive intensity scale (bloom threshold is 0.85)
// alpha:      <1 makes the whole suit translucent (Ghost)
// scale/w/len/head/thick: proportion knobs (see Character._applyProportions)
// acc:        accessory flags — hood scarf drone pads crest antenna decals circuit

export const SKINS = {
  vector: {
    name: 'VECTOR',
    c: { primary: '#7f92ac', secondary: '#182338', dark: '#0a0e1a', accent: '#00f0ff' },
    metal: 0.3, rough: 0.42, glow: 1,
    scale: 1, w: 1, len: 1, head: 1, thick: 1,
    acc: {},
  },
  nova: {
    name: 'NOVA',
    c: { primary: '#221733', secondary: '#120b1d', dark: '#090611', accent: '#ff2bd6' },
    metal: 0.55, rough: 0.35, glow: 1.1,
    scale: 1.01, w: 0.97, len: 1.02, head: 0.98, thick: 1,
    acc: {},
  },
  bit: {
    name: 'BIT',
    c: { primary: '#3d3117', secondary: '#28200e', dark: '#15100a', accent: '#ffd24a' },
    metal: 0.4, rough: 0.4, glow: 1.15,
    scale: 0.8, w: 1.04, len: 0.8, head: 1.45, thick: 1.12,
    acc: {},
  },
  rogue: {
    name: 'ROGUE',
    c: { primary: '#231627', secondary: '#150d19', dark: '#0b070e', accent: '#ff3355' },
    metal: 0.25, rough: 0.6, glow: 1,
    scale: 1, w: 1, len: 1, head: 1, thick: 1.02,
    acc: { hood: 1 },
  },
  titan: {
    name: 'TITAN',
    c: { primary: '#2e3b4a', secondary: '#1c2530', dark: '#101720', accent: '#ff7a1a' },
    metal: 0.55, rough: 0.4, glow: 0.95,
    scale: 1.02, w: 1.3, len: 0.96, head: 0.9, thick: 1.42,
    acc: { pads: 1 },
  },
  ghost: {
    name: 'GHOST',
    c: { primary: '#c6d4ec', secondary: '#93a5c8', dark: '#a3b5d8', accent: '#9fdcff' },
    metal: 0, rough: 0.9, glow: 0.42, alpha: 0.55,
    scale: 1, w: 0.98, len: 1.01, head: 1, thick: 0.98,
    acc: {},
  },
  circuit: {
    name: 'CIRCUIT',
    c: { primary: '#10291b', secondary: '#0a1b11', dark: '#06110a', accent: '#2bff88' },
    metal: 0.4, rough: 0.35, glow: 1.3,
    scale: 1, w: 0.98, len: 1.01, head: 0.99, thick: 1,
    acc: { circuit: 1, antenna: 1 },
  },
  vandal: {
    name: 'VANDAL',
    c: { primary: '#2d2318', secondary: '#1b150e', dark: '#0f0b07', accent: '#ff7a1a', visor: '#00f0ff' },
    metal: 0.3, rough: 0.55, glow: 1.05,
    scale: 1, w: 1.02, len: 0.99, head: 1.02, thick: 1.02,
    slots: { crest: '#ffd24a', dec1: '#ffd24a', dec2: '#00f0ff', dec3: '#e8e8e8' },
    acc: { decals: 1 },
  },
  oracle: {
    name: 'ORACLE',
    c: { primary: '#b5a06b', secondary: '#6d5730', dark: '#4c3b20', accent: '#ffd24a' },
    metal: 0.68, rough: 0.28, glow: 1.1,
    scale: 1.05, w: 0.86, len: 1.1, head: 0.93, thick: 0.85,
    acc: { antenna: 1 },
  },
  rook: {
    name: 'ROOK',
    c: { primary: '#3f4956', secondary: '#282f39', dark: '#171c23', accent: '#9fd8ff' },
    metal: 0.6, rough: 0.42, glow: 0.95,
    scale: 1.01, w: 1.12, len: 0.99, head: 0.96, thick: 1.24,
    acc: { pads: 1, crest: 1 },
  },
  jett: {
    name: 'JETT',
    c: { primary: '#172c3f', secondary: '#101e2c', dark: '#091119', accent: '#00f0ff' },
    metal: 0.35, rough: 0.45, glow: 1.05,
    scale: 1, w: 0.94, len: 1.03, head: 0.99, thick: 0.96,
    acc: { scarf: 1 },
  },
  kilo: {
    name: 'KILO',
    c: { primary: '#96a2b8', secondary: '#647088', dark: '#616c84', accent: '#ffd24a' },
    metal: 0.35, rough: 0.5, glow: 1.05,
    scale: 0.94, w: 1.02, len: 0.92, head: 1.16, thick: 1.05,
    acc: { drone: 1 },
  },
  hexa: {
    name: 'HEXA',
    c: { primary: '#10302f', secondary: '#0a201f', dark: '#061414', accent: '#2bffd0' },
    metal: 0.45, rough: 0.38, glow: 1.1,
    scale: 1, w: 0.98, len: 1, head: 1, thick: 1,
    acc: { crest: 1 },
  },
  dusk: {
    name: 'DUSK',
    c: { primary: '#2a1c48', secondary: '#181030', dark: '#0d0918', accent: '#ffd24a', visor: '#ff2bd6' },
    metal: 0.5, rough: 0.36, glow: 1.05,
    scale: 1, w: 1, len: 1.01, head: 1, thick: 1,
    acc: {},
  },
};

// Legacy ids keep working (Player.js boots with 'cyber').
const ALIASES = { cyber: 'vector', blaze: 'nova', volt: 'bit' };

export const DEFAULT_SKIN = 'vector';

// Resolve an id to a def (adds .id). Unknown ids fall back to the default skin.
export function resolveSkin(id) {
  const key = ALIASES[id] || (Object.prototype.hasOwnProperty.call(SKINS, id) ? id : DEFAULT_SKIN);
  const def = SKINS[key];
  if (!def.resolved) {
    def.id = key;
    def.c.visor = def.c.visor || def.c.accent;
    def.resolved = true;
  }
  return def;
}

export const SKIN_IDS = Object.keys(SKINS);
