// src/levels/levels.ts
import type { LevelData } from "../core/types";

const R = (rows: string[]): number[] => {
  const out: number[] = [];
  for (const row of rows) {
    for (const ch of row) out.push(ch === "." ? 0 : Number(ch));
  }
  return out;
};

// 20 wide × 13 tall. `.` empty, `1` ground, `2` brick platform, `3` lava, `4` tree.
export const LEVEL_1: LevelData = {
  id: 1,
  name: "Level 1",
  startScreen: 0,
  screens: [
    {
      width: 20,
      height: 13,
      tiles: R([
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        ".......22...........",
        "....................",
        "..2222......22......",
        "....................",
        "....................",
        ".................22.",
        "11111111111111111111",
      ]),
      entities: [
        { type: "dave", x: 3, y: 11 },
        { type: "orb", x: 5, y: 8 },
        { type: "orb", x: 9, y: 8 },
        { type: "blueDiamond", x: 12, y: 10 },
        { type: "blueDiamond", x: 14, y: 7 },
        { type: "orb", x: 7, y: 10 },
        { type: "trophy", x: 17, y: 10 },
        { type: "exitDoor", x: 18, y: 11 },
      ],
      warps: [],
    },
  ],
};

export const BONUS_1: LevelData = {
  id: "bonus1" as unknown as number,
  name: "Bonus Room 1",
  startScreen: 0,
  screens: [
    {
      width: 20,
      height: 13,
      tiles: R([
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "11111111111111111111",
      ]),
      entities: [
        { type: "dave", x: 2, y: 11 },
        { type: "orb", x: 4, y: 10 },
        { type: "orb", x: 5, y: 10 },
        { type: "blueDiamond", x: 8, y: 9 },
        { type: "redDiamond", x: 10, y: 8 },
        { type: "ring", x: 12, y: 8 },
        { type: "crown", x: 14, y: 7 },
        { type: "scepter", x: 16, y: 10 },
        { type: "trophy", x: 17, y: 10 },
        { type: "exitDoor", x: 18, y: 11 },
      ],
      warps: [],
    },
  ],
};

export const LEVELS: Record<number, LevelData> = { 1: LEVEL_1 };
export const BONUS_ROOMS: Record<number, LevelData> = { 1: BONUS_1 };
