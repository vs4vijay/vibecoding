// Phase 5: title / countdown / results overlay logic.
//
// Pure DOM: builds overlays inside #screens (index.html), shows/hides them on
// demand. game.ts owns the state machine and calls in; this module never reads
// game state. All elements are created lazily and reused (no per-frame DOM).

export interface ResultRow {
  name: string;
  /** CSS color for the little tank swatch. */
  color: string;
  isPlayer: boolean;
  /** Preformatted total race time, or "—" if the racer didn't finish. */
  time: string;
  /** Preformatted best lap, or "—" if no lap was completed. */
  best: string;
}

export interface Screens {
  showTitle(): void;
  showCountdown(text: string): void;
  hideCountdown(): void;
  /** Center banner ("FINAL LAP") that auto-fades via CSS animation. */
  flashBanner(text: string): void;
  showResults(rows: ResultRow[]): void;
  hideResults(): void;
  /** Small bottom-center notice (mute toggle). Auto-fades. */
  toast(text: string): void;
}

const SECONDS_PER_MINUTE = 60;

/** m:ss.t formatting shared by results + HUD callers. */
export function formatRaceTime(seconds: number): string {
  const m = Math.floor(seconds / SECONDS_PER_MINUTE);
  const s = Math.floor(seconds % SECONDS_PER_MINUTE);
  const t = Math.floor((seconds * 10) % 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${t}`;
}

export function createScreens(rootId = "screens"): Screens {
  const rootEl = document.getElementById(rootId);
  if (!rootEl) throw new Error(`#${rootId} missing from index.html`);
  const root: HTMLElement = rootEl;

  // --- Title ---------------------------------------------------------------
  let title: HTMLDivElement | null = null;
  function ensureTitle(): HTMLDivElement {
    if (title) return title;
    title = document.createElement("div");
    title.id = "screen-title";
    title.className = "screen-overlay";
    const card = document.createElement("div");
    card.className = "title-card";

    const h1 = document.createElement("h1");
    h1.textContent = "TANK RACER";
    const sub = document.createElement("p");
    sub.className = "subtitle";
    sub.textContent = "DESERT CIRCUIT · 3 LAPS · 4 TANKS";
    card.appendChild(h1);
    card.appendChild(sub);

    const controls = document.createElement("div");
    controls.className = "controls";
    for (const [key, action] of [
      ["W / ↑", "accelerate"],
      ["S / ↓", "brake / reverse"],
      ["A D / ← →", "steer"],
      ["SPACE", "fire shell"],
      ["M", "mute"],
    ] as const) {
      const row = document.createElement("div");
      row.className = "controls-row";
      const k = document.createElement("span");
      k.className = "key";
      k.textContent = key;
      const a = document.createElement("span");
      a.textContent = action;
      row.appendChild(k);
      row.appendChild(a);
      controls.appendChild(row);
    }
    card.appendChild(controls);

    const press = document.createElement("p");
    press.className = "press blink";
    press.textContent = "PRESS ENTER TO RACE";
    card.appendChild(press);

    title.appendChild(card);
    root.appendChild(title);
    return title;
  }

  // --- Countdown -------------------------------------------------------------
  let countdown: HTMLDivElement | null = null;
  function ensureCountdown(): HTMLDivElement {
    if (!countdown) {
      countdown = document.createElement("div");
      countdown.id = "screen-countdown";
      root.appendChild(countdown);
    }
    return countdown;
  }

  // --- Banner + toast share one fading element style --------------------------
  let banner: HTMLDivElement | null = null;
  let toastEl: HTMLDivElement | null = null;

  /** Restart a CSS fade animation by force-reflowing between class toggles. */
  function replayAnimation(el: HTMLElement, text: string): void {
    el.textContent = text;
    el.classList.remove("show");
    void el.offsetWidth; // reflow so the animation can restart
    el.classList.add("show");
  }

  // --- Results -----------------------------------------------------------------
  let results: HTMLDivElement | null = null;
  function ensureResults(): HTMLDivElement {
    if (results) return results;
    results = document.createElement("div");
    results.id = "screen-results";
    results.className = "screen-overlay dim";
    root.appendChild(results);
    return results;
  }

  // Local hide helpers — usable from any method below.
  function hideResultsNow(): void {
    if (results) {
      results.remove();
      results = null;
    }
  }
  function hideCountdownNow(): void {
    if (countdown) countdown.textContent = "";
  }

  return {
    showTitle() {
      hideResultsNow();
      hideCountdownNow();
      ensureTitle().style.display = "";
    },
    showCountdown(text: string) {
      ensureCountdown().textContent = text;
    },
    hideCountdown() {
      hideCountdownNow();
    },
    flashBanner(text: string) {
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "screen-banner";
        root.appendChild(banner);
      }
      replayAnimation(banner, text);
    },
    toast(text: string) {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.id = "screen-toast";
        root.appendChild(toastEl);
      }
      replayAnimation(toastEl, text);
    },
    showResults(rows: ResultRow[]) {
      const el = ensureResults();
      el.textContent = ""; // rebuild rows each race

      const card = document.createElement("div");
      card.className = "results-card";

      const h2 = document.createElement("h2");
      h2.textContent = "RACE COMPLETE";
      card.appendChild(h2);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const line = document.createElement("div");
        line.className = "result-row" + (row.isPlayer ? " player" : "");

        const pos = document.createElement("span");
        pos.className = "result-pos";
        pos.textContent = `${i + 1}${ORDINALS[i] ?? "th"}`;

        const swatch = document.createElement("span");
        swatch.className = "result-swatch";
        swatch.style.background = row.color;

        const name = document.createElement("span");
        name.className = "result-name";
        name.textContent = row.name;

        const time = document.createElement("span");
        time.className = "result-time";
        time.textContent = row.time;

        const best = document.createElement("span");
        best.className = "result-best";
        best.textContent = row.best === "—" ? "" : `best ${row.best}`;

        line.appendChild(pos);
        line.appendChild(swatch);
        line.appendChild(name);
        line.appendChild(best);
        line.appendChild(time);
        card.appendChild(line);
      }

      const press = document.createElement("p");
      press.className = "press blink";
      press.textContent = "PRESS R TO RESTART";
      card.appendChild(press);

      el.appendChild(card);
    },
    hideResults() {
      hideResultsNow();
    },
  };
}

const ORDINALS = ["st", "nd", "rd"] as const;
