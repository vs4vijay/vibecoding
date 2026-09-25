/**
 * @file ui/pause.js
 * Pause DOM overlay controller: Resume / Restart / Quit over the live, frozen
 * world. Pure view — main.js owns the paused flag and calls show(); this
 * class never touches game state. Buttons use the shell's existing paths
 * (setPaused / enterGame / enterMenu). DOM-only, no canvas UI (bible
 * architecture); same .screen pattern as menu.js.
 */
export class PauseUI {
  /**
   * @param {{onResume: () => void, onRestart: () => void, onQuit: () => void}} handlers
   */
  constructor(handlers) {
    this.root = document.getElementById("pause");
    this.onResume = handlers.onResume;
    this.onRestart = handlers.onRestart;
    this.onQuit = handlers.onQuit;

    document.getElementById("pause-resume").addEventListener("click", this.onResume);
    document.getElementById("pause-restart").addEventListener("click", this.onRestart);
    document.getElementById("pause-quit").addEventListener("click", this.onQuit);
  }

  /** @param {boolean} on Mirror of main.js's paused flag (view only). */
  show(on) {
    this.root.classList.toggle("on", on);
  }
}
