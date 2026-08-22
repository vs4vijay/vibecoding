import { CONFIG } from "../config";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const D = CONFIG.difficulty;

export type ZombieType = keyof typeof CONFIG.zombies;
export type Knobs = {
  level: number; spawnIntervalMs: number; maxZombies: number;
  leapAccuracy: number; cruiseSpeed: number; obstacleDensity: number; types: ZombieType[];
};

export function scoreForLevel(n: number): number {
  if (n <= 1) return 0;
  return Math.round(D.baseReq * Math.pow(n - 1, D.exp));
}
export function levelForScore(score: number): number {
  let lvl = 1;
  while (scoreForLevel(lvl + 1) <= score) lvl++;
  return lvl;
}
export function knobsForLevel(level: number): Knobs {
  const k = level - 1;
  const all: ZombieType[] = ["walker", "runner", "brute"];
  return {
    level,
    spawnIntervalMs: clamp(1600 - 90 * k, 450, 1600),
    maxZombies: Math.min(2 + Math.floor(0.75 * k), 8),
    leapAccuracy: clamp(0.55 + 0.05 * k, 0, 0.95),
    cruiseSpeed: clamp(28 + 1.5 * k, 28, 52),
    obstacleDensity: clamp(0.4 + 0.08 * k, 0, 1),
    types: all.filter((t) => level >= D.unlockLevel[t]),
  };
}
