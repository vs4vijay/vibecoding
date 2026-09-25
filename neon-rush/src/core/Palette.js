import { Color } from 'three';

// Exact palette from ARCHITECTURE.md.
export const HEX = {
  cyan: '#00f0ff',
  magenta: '#ff2bd6',
  gold: '#ffd24a',
  red: '#ff3355',
  orange: '#ff7a1a',
  deep: '#0b0518',
  grid: '#2a1a5e',
};

export const cyan = new Color(HEX.cyan);
export const magenta = new Color(HEX.magenta);
export const gold = new Color(HEX.gold);
export const red = new Color(HEX.red);
export const orange = new Color(HEX.orange);
export const deep = new Color(HEX.deep);
export const grid = new Color(HEX.grid);

// Readability rule: hazards red/orange, collectibles cyan/gold, neutral
// geometry desaturated. Other modules MUST pull hazard/pickup colors from here.
export const HAZARD = [red, orange];
export const PICKUP = [cyan, gold];

export const COL = { cyan, magenta, gold, red, orange, deep, grid };
