// src/state/GameState.ts
import type { ItemType } from "../core/types";
import type { SaveData } from "./SaveState";

export const ITEM_VALUES: Record<ItemType, number> = {
  orb: 50, blueDiamond: 100, redDiamond: 150, ring: 200, crown: 300, scepter: 500, trophy: 1000,
};
export const SCORE_CAP = 99999;
export const ONE_UP_EVERY = 20000;
export const EXIT_BONUS = 2000;

export class GameState {
  lives = 4;
  score = 0;
  level = 1;
  currentScreen = 0;
  hasGun = false;
  jetpackFuel = 0;
  private oneUpsEarned = 0;

  addScore(n: number): void {
    this.score = Math.min(SCORE_CAP, this.score + n);
  }
  loseLife(): boolean {
    this.lives--;
    return this.lives > 0;
  }
  addOneUp(): void {
    this.lives = Math.min(4, this.lives + 1);
  }
  maybeEarnOneUp(): void {
    const expected = Math.floor(this.score / ONE_UP_EVERY);
    while (this.oneUpsEarned < expected && this.lives < 4) {
      this.oneUpsEarned++;
      this.addOneUp();
    }
  }
  reset(level: number): void {
    this.lives = 4;
    this.score = 0;
    this.level = level;
    this.currentScreen = 0;
    this.hasGun = false;
    this.jetpackFuel = 0;
    this.oneUpsEarned = 0;
  }
  snapshot(): SaveData {
    return { lives: this.lives, score: this.score, level: this.level, hasGun: this.hasGun, jetpackFuel: this.jetpackFuel };
  }
  restore(s: SaveData): void {
    this.lives = s.lives; this.score = s.score; this.level = s.level;
    this.hasGun = s.hasGun; this.jetpackFuel = s.jetpackFuel;
  }
}
