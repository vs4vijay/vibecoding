// src/render3d/palette.ts — design tokens for the AAA presentation layer.
// Simulation coordinates map 1 tile = 1 world unit; +y flips (sim y grows down).
import * as THREE from "three";
import { PHYSICS } from "../core/types";

export const TILE = PHYSICS.TILE; // 16 px sim units per tile

/** sim pixel coords → world coords (1 tile = 1 unit, y up). */
export function worldTo3D(px: number, py: number): THREE.Vector2 {
  return new THREE.Vector2(px / TILE, -py / TILE);
}

/** Center of a sim-entity's 16×16 cell (items sit mid-cell visually). */
export function worldCenter(px: number, py: number): THREE.Vector3 {
  return new THREE.Vector3(px / TILE + 0.5, -(py / TILE) - 0.5, 0);
}

export const PALETTE = {
  // cavern shell
  cavernDeep: 0x05080c,
  cavernFog: 0x0b141b,
  cavernSlate: 0x16323d,
  cavernRidge: 0x1e4552,
  // warm accents
  ember: 0xffb347,
  emberHot: 0xffd27a,
  lavaCore: 0xff5a1f,
  gold: 0xd9a441,
  // hero
  daveCloth: 0xc93b2e,
  daveDark: 0x59201a,
  daveTrim: 0xe8c56a,
  daveSkin: 0xe8b58c,
  // flora / cool
  moss: 0x3e6b4f,
  mossDeep: 0x274434,
  // entities
  spiderBody: 0x241a26,
  spiderEyes: 0xff4d4d,
  bullet: 0xfff2b0,
  // UI
  uiPanel: 0x0a0f14,
  uiHairline: 0xd9a441,
} as const;
