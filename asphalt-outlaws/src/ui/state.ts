import type { UiAction } from "../core/input";
import type { Results } from "../sim/types";
import { BIKES, ECONOMY, LEVELS } from "../config";

// OWNER: Agent D. App state machine + career progression rules. Contract per
// .plan.md §5. Do not change signatures or transition semantics.
//
// Phase flow:
//   title --confirm--> select --confirm--> intent start-race (main boots race)
//   race (main-driven) --Esc--> paused --confirm/pause--> race
//                                    \--back--> intent quit-to-title
//   race ends: main calls showResults(results)
//   results --confirm--> qualified & more levels ? advance + intent start-race
//                       : qualified & final   ? credits
//                       : otherwise           ? gameover
//   gameover --confirm--> retry (money >= fee: deduct, intent start-race)
//                       : title ; --back--> title
//   credits --confirm--> fresh career, title

export type AppPhase =
  | "title"
  | "select"
  | "race"
  | "paused"
  | "results"
  | "gameover"
  | "credits";

export interface Career {
  levelIdx: number;
  money: number;
}

export type AppIntent =
  | { type: "start-race"; levelIdx: number; bikeIdx: number }
  | { type: "quit-to-title" }
  | null;

export class AppModel {
  phase: AppPhase = "title";
  career: Career = { levelIdx: 0, money: 500 }; // overwritten in ctor
  bikeIdx = 0;
  lastResults: Results | null = null;
  muted = false;
  intent: AppIntent = null;

  private readonly startMoney: number;
  private listeners: Array<() => void> = [];

  constructor(startMoney: number) {
    this.career = { levelIdx: 0, money: startMoney };
    this.startMoney = startMoney;
  }

  onDidChange(cb: () => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private touch(): void {
    for (const cb of this.listeners.slice()) cb();
  }

  setPhase(p: AppPhase): void {
    this.phase = p;
    this.touch();
  }

  /** Main calls this on every UI action; UI phases mutate state here. */
  handleAction(a: UiAction): void {
    if (a === "mute") return; // handled by main
    switch (this.phase) {
      case "race":
        return; // main-driven
      case "title":
        if (a === "confirm") this.setPhase("select");
        return;
      case "select": {
        const n = BIKES.length;
        if (a === "menu-left") {
          this.bikeIdx = (this.bikeIdx + n - 1) % n;
          this.touch();
        } else if (a === "menu-right") {
          this.bikeIdx = (this.bikeIdx + 1) % n;
          this.touch();
        } else if (a === "confirm") {
          this.intent = {
            type: "start-race",
            levelIdx: this.career.levelIdx,
            bikeIdx: this.bikeIdx,
          };
          this.touch();
        } else if (a === "back") {
          this.setPhase("title");
        }
        return;
      }
      case "paused":
        if (a === "confirm" || a === "pause") {
          this.setPhase("race");
        } else if (a === "back") {
          // Intent accompanies the phase change: setPhase's touch covers both.
          this.intent = { type: "quit-to-title" };
          this.setPhase("title");
        }
        return;
      case "results": {
        if (a === "back") {
          this.setPhase("title"); // abandon the ladder
          return;
        }
        if (a !== "confirm") return;
        const r = this.lastResults;
        if (!r) {
          this.setPhase("title");
          return;
        }
        if (r.qualified) {
          if (this.career.levelIdx + 1 >= LEVELS.length) {
            this.setPhase("credits");
          } else {
            this.career.levelIdx += 1;
            this.intent = {
              type: "start-race",
              levelIdx: this.career.levelIdx,
              bikeIdx: this.bikeIdx,
            };
            this.touch();
          }
        } else {
          this.setPhase("gameover");
        }
        return;
      }
      case "gameover":
        if (a === "back") {
          this.setPhase("title");
          return;
        }
        if (a !== "confirm") return;
        if (this.canRetry()) {
          this.career.money -= ECONOMY.retryFee;
          this.intent = {
            type: "start-race",
            levelIdx: this.career.levelIdx,
            bikeIdx: this.bikeIdx,
          };
          this.touch();
        } else {
          this.setPhase("title");
        }
        return;
      case "credits":
        if (a === "confirm") {
          this.resetCareer();
          this.setPhase("title");
        }
        return;
    }
  }

  /** Main calls this when a race ends; adds prize money and flips to results. */
  showResults(r: Results): void {
    this.lastResults = r;
    this.career.money += r.prize;
    this.phase = "results";
    this.touch();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.touch();
    return this.muted;
  }

  canRetry(): boolean {
    return this.career.money >= ECONOMY.retryFee;
  }

  /** Reset career to the start (after credits). */
  resetCareer(): void {
    this.career = { levelIdx: 0, money: this.startMoney };
    this.touch();
  }
}
