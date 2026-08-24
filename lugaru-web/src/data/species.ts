/**
 * Per-species body proportions and combat tuning. Pure data — no three.js.
 * Lengths in meters, speeds in m/s, masses in kg.
 */
export interface SpeciesDef {
  id: 'rabbit' | 'wolf';
  /** Resting pelvis height above ground (drives leg lengths + root offset). */
  hipHeight: number;
  /** Trunk length, pelvis joint → neck joint. */
  torsoLen: number;
  limbLens: {
    armUpper: number;
    armLower: number;
    legUpper: number;
    legLower: number;
  };
  massKg: number;
  maxHp: number;
  runSpeed: number;
  crouchSpeed: number;
  colors: { fur: number; belly: number };
  punchDmgMult: number;
}

export const SPECIES: Record<'rabbit' | 'wolf', SpeciesDef> = {
  rabbit: {
    id: 'rabbit',
    hipHeight: 0.62,
    torsoLen: 0.52,
    limbLens: { armUpper: 0.24, armLower: 0.24, legUpper: 0.33, legLower: 0.33 },
    massKg: 30,
    maxHp: 100,
    runSpeed: 6.2,
    crouchSpeed: 1.8,
    colors: { fur: 0x9a7b5a, belly: 0xd8c9b0 },
    punchDmgMult: 1.0,
  },
  wolf: {
    id: 'wolf',
    hipHeight: 0.85,
    torsoLen: 0.78,
    limbLens: { armUpper: 0.32, armLower: 0.32, legUpper: 0.44, legLower: 0.44 },
    massKg: 70,
    maxHp: 160,
    runSpeed: 6.6,
    crouchSpeed: 2.4,
    colors: { fur: 0x4c4a48, belly: 0x6b6660 },
    punchDmgMult: 1.6,
  },
};
