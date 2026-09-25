/**
 * @file ui/gameover.js
 * Gameover DOM overlay controller: run stats grid (distance/score/pickups,
 * giant amber numerals over hairline rules), the mode's previous-best line,
 * a NEW BEST flag, Retry primary / Menu secondary over the halted world.
 * Pure view — main.js owns the state machine and calls setStats()/show();
 * this class never touches game state (the recordBest/currency/saveSave
 * writes live in main.js endRun, task 2.5). The previous best is
 * display-only here by contract: the screen shows the run's PREVIOUS best
 * with the flag carrying the beat-it read. DOM-only, no canvas UI
 * (bible architecture); same .screen pattern as pause.js.
 */
export class GameoverUI {
  /**
   * @param {{onRetry: () => void, onMenu: () => void}} handlers
   */
  constructor(handlers) {
    this.root = document.getElementById("gameover");
    this.onRetry = handlers.onRetry;
    this.onMenu = handlers.onMenu;
    this.flag = document.getElementById("go-flag");
    this.distance = document.getElementById("go-distance");
    this.score = document.getElementById("go-score");
    this.pickups = document.getElementById("go-pickups");
    this.best = document.getElementById("go-best");

    document.getElementById("go-retry").addEventListener("click", this.onRetry);
    document.getElementById("go-menu").addEventListener("click", this.onMenu);
  }

  /**
   * Fill the stats grid + best line (textContent only — no layout thrash)
   * and gate the NEW BEST flag on distance beating prevBest. Called once
   * per endRun, never per frame.
   * @param {{distance: number, pickups: number, score: number}} stats
   * @param {number} prevBest Mode's stored best distance (0 = none yet).
   */
  setStats(stats, prevBest) {
    const d = Math.max(0, Math.floor(stats.distance || 0));
    this.distance.textContent = d.toLocaleString();
    this.score.textContent = Math.max(0, Math.floor(stats.score || 0)).toLocaleString();
    this.pickups.textContent = Math.max(0, Math.floor(stats.pickups || 0)).toLocaleString();
    const best = Math.max(0, Math.floor(prevBest || 0));
    this.best.textContent = best > 0 ? `BEST — ${best.toLocaleString()} M` : "BEST — —";
    this.flag.classList.toggle("on", d > best); // first run (best 0) counts too
  }

  /** @param {boolean} on Mirror of main.js's GAMEOVER state (view only). */
  show(on) {
    this.root.classList.toggle("on", on);
  }
}
