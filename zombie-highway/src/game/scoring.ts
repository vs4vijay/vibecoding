import { CONFIG } from "../config";
import { levelForScore, type ZombieType } from "./difficulty";

const S = CONFIG.score;

function multiplierFor(streak: number): number {
  let m = 1;
  for (let i = 0; i < S.streakTiers.length; i++) {
    if (streak >= S.streakTiers[i]) m = S.multipliers[i];
  }
  return m;
}

export class Scoring {
  score = 0;
  distanceM = 0;
  kills = 0;
  streak = 0;
  multiplier = 1;
  private idleS = 0;

  reset(): void {
    this.score = 0;
    this.distanceM = 0;
    this.kills = 0;
    this.streak = 0;
    this.multiplier = 1;
    this.idleS = 0;
  }

  addDistance(m: number): void {
    this.distanceM += m;
    this.score += m;
  }

  registerKill(type: ZombieType, viaScrape: boolean): number {
    this.streak++;
    this.multiplier = multiplierFor(this.streak);
    const points = CONFIG.zombies[type].points * this.multiplier * (viaScrape ? 2 : 1);
    this.score += points;
    this.kills++;
    this.idleS = 0;
    return points;
  }

  update(dt: number): void {
    this.idleS += dt;
    if (this.idleS >= S.streakDecayS && this.streak > 0) {
      this.streak = 0;
      this.multiplier = 1;
    }
  }

  level(): number {
    return levelForScore(this.score);
  }
}
