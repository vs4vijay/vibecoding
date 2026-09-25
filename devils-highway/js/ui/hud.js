/**
 * @file ui/hud.js
 * In-run HUD DOM controller (run-core-loop task 5.1, design decision 7):
 * distance/score/pickups numerals + touch pause chip over the live world.
 * Pure view — main.js owns the state machine and calls show() at GAME
 * enter/leave; the pause chip lands on the shell's EXISTING `pause` action
 * path (routeAction("pause") — the same route as Esc; input.js's pointerup
 * `tap` precedes the DOM click, so a tap on the chip processes under the old
 * flag exactly like the 2.3 buttons). The root placement class is supplied
 * by the active mode's hudLayout() (setLayout; no layout = never shown, so
 * layout-less stub modes stay HUD-free). update(stats) is driven by the mode
 * per render tick (run.js pushes score.snapshot()); it writes textContent
 * ONLY and only when a numeral's integer value changed — steady frames cost
 * zero DOM writes, distance updates at integer-metre cadence. DOM-only, no
 * canvas UI (bible architecture).
 */
export class HudUI {
  /**
   * @param {{onPause: () => void}} handlers
   */
  constructor(handlers) {
    this.root = document.getElementById("hud");
    this.distance = document.getElementById("hud-distance");
    this.score = document.getElementById("hud-score");
    this.pickups = document.getElementById("hud-pickups");
    this._cls = ""; // active placement class (hudLayout().root)
    // Caches mirror what is ON SCREEN (start "unset" so the first real
    // value always writes) — the display truth, no reset() needed.
    this._d = -1;
    this._s = -1;
    this._p = -1;

    document.getElementById("hud-pause").addEventListener("click", handlers.onPause);
    this.show(false);
  }

  /**
   * Mount the mode's placement class (hudLayout() → { root: "hud-run" }).
   * null/undefined clears it AND hides — the HUD exists only when a mode
   * supplies its layout (game-shell spec: per the active mode's layout).
   * @param {{root: string}|null} layout
   */
  setLayout(layout) {
    const cls = (layout && layout.root) || "";
    if (cls === this._cls) return;
    if (this._cls) this.root.classList.remove(this._cls);
    this._cls = cls;
    if (cls) this.root.classList.add(cls);
    else this.show(false);
  }

  /** @param {boolean} on Mirror of main.js's GAME state (view only). */
  show(on) {
    this.root.classList.toggle("on", on && !!this._cls);
  }

  /**
   * Per-render-tick stats push (score.snapshot() shape). Cached: each
   * numeral writes only when its integer value changed — distance throttles
   * to metre changes, score/pickups write in lockstep with the ledger.
   * @param {{distance: number, pickups: number, score: number}} s
   */
  update(s) {
    const d = Math.max(0, Math.floor(s.distance || 0));
    if (d !== this._d) {
      this._d = d;
      this.distance.textContent = d.toLocaleString();
    }
    const p = Math.max(0, Math.floor(s.pickups || 0));
    if (p !== this._p) {
      this._p = p;
      this.pickups.textContent = p.toLocaleString();
    }
    const sc = Math.max(0, Math.floor(s.score || 0));
    if (sc !== this._s) {
      this._s = sc;
      this.score.textContent = sc.toLocaleString();
    }
  }
}
