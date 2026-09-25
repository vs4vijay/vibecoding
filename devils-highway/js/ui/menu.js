/**
 * @file ui/menu.js
 * Title/menu DOM overlay controller: mode cards (RUN/DRIVE/RIDE) with
 * per-mode "BEST — N M" lines, selection highlight, footer stats (cross-mode
 * best), show/hide transitions. DOM-only — the live 3D dusk diorama renders
 * behind it; no canvas UI (bible architecture).
 */
export class MenuUI {
  /**
   * @param {{onSelect: (mode: string) => void}} handlers
   */
  constructor(handlers) {
    this.root = document.getElementById("menu");
    this.cards = Array.from(this.root.querySelectorAll(".card"));
    this.best = document.getElementById("menu-best");
    this.onSelect = handlers.onSelect;
    this.mode = "drive";

    for (const card of this.cards) {
      card.addEventListener("click", () => {
        const mode = card.dataset.mode;
        if (mode === this.mode) this.onSelect(mode);
        else this.setMode(mode);
      });
    }
  }

  /** @param {"run"|"drive"|"ride"} mode Highlight + remember. */
  setMode(mode) {
    if (mode !== "run" && mode !== "drive" && mode !== "ride") mode = "drive";
    this.mode = mode;
    for (const card of this.cards) {
      card.classList.toggle("sel", card.dataset.mode === mode);
    }
  }

  /** Enter/confirm the current selection. */
  confirm() {
    this.onSelect(this.mode);
  }

  show(on) {
    this.root.classList.toggle("on", on);
  }

  /**
   * Fill each card's per-mode best line (task 2.5). Same format as the
   * footer's cross-mode line; "—" until a mode has a saved run. Called by
   * main.js wherever the menu becomes visible (boot + quit paths).
   * @param {{run?: number, drive?: number, ride?: number}} bests Saved bests by mode.
   */
  setBests(bests) {
    for (const card of this.cards) {
      const el = card.querySelector(".card-best");
      if (!el) continue;
      const m = Math.max(0, Math.floor(bests?.[card.dataset.mode] || 0));
      el.textContent = m > 0 ? `BEST — ${m.toLocaleString()} M` : "BEST — —";
    }
  }

  /** @param {number} meters Best distance across modes. */
  setBest(meters) {
    const best = Math.max(0, Math.floor(meters));
    this.best.textContent = best > 0 ? `BEST — ${best.toLocaleString()} M` : "BEST — —";
  }
}
