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

/** Which stored records the player beat this race (Phase 7). */
export interface NewBest {
  lap: boolean;
  total: boolean;
}

/** Title-screen stat card contents for one selectable tank (Phase 7). */
export interface TankStatsView {
  name: string;
  blurb: string;
  color: string;
  /** Bar fills, all normalized 0..1. */
  speed: number;
  armor: number;
  fire: number;
}

export interface Screens {
  showTitle(): void;
  /** Title-screen track picker: updates the displayed circuit name. */
  setTrackName(name: string): void;
  /** Title-screen best times for the displayed circuit (null = no record). */
  setBestTimes(lap: string | null, total: string | null): void;
  /** Title-screen tank picker: name, blurb and stat bars (Phase 7). */
  setTankCard(stats: TankStatsView): void;
  /** Tank name shown under the big countdown text (Phase 7). */
  showCountdownTag(text: string): void;
  showCountdown(text: string): void;
  hideCountdown(): void;
  /** Center banner ("FINAL LAP") that auto-fades via CSS animation. */
  flashBanner(text: string): void;
  showResults(
    rows: ResultRow[],
    trackName: string,
    newBest?: NewBest,
  ): void;
  hideResults(): void;
  /** Small bottom-center notice (mute toggle). Auto-fades. */
  toast(text: string): void;
  /** PAUSED overlay while the sim is frozen (Phase 9). */
  showPaused(): void;
  hidePaused(): void;
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
  let trackNameEl: HTMLDivElement | null = null;
  let bestTimesEl: HTMLDivElement | null = null;
  let tankNameEl: HTMLDivElement | null = null;
  let statsCardEl: HTMLDivElement | null = null;
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
    sub.textContent = "DESERT CIRCUITS · 3 LAPS · 4 TANKS";
    card.appendChild(h1);
    card.appendChild(sub);

    // Track selector (Phase 6): LEFT/RIGHT cycles circuits
    const trackSel = document.createElement("div");
    trackSel.className = "track-select";
    const prevArrow = document.createElement("span");
    prevArrow.className = "track-arrow";
    prevArrow.textContent = "◀";
    trackNameEl = document.createElement("div");
    trackNameEl.id = "screen-track-name";
    trackNameEl.textContent = "";
    const nextArrow = document.createElement("span");
    nextArrow.className = "track-arrow";
    nextArrow.textContent = "▶";
    trackSel.appendChild(prevArrow);
    trackSel.appendChild(trackNameEl);
    trackSel.appendChild(nextArrow);
    card.appendChild(trackSel);

    // Best times for the displayed circuit (Phase 7)
    bestTimesEl = document.createElement("div");
    bestTimesEl.id = "screen-best-times";
    bestTimesEl.textContent = "";
    card.appendChild(bestTimesEl);

    // Tank selector (Phase 7): UP/DOWN cycles tanks
    const tankSel = document.createElement("div");
    tankSel.className = "track-select";
    const upArrow = document.createElement("span");
    upArrow.className = "track-arrow";
    upArrow.textContent = "▲";
    tankNameEl = document.createElement("div");
    tankNameEl.id = "screen-tank-name";
    tankNameEl.textContent = "";
    const downArrow = document.createElement("span");
    downArrow.className = "track-arrow";
    downArrow.textContent = "▼";
    tankSel.appendChild(upArrow);
    tankSel.appendChild(tankNameEl);
    tankSel.appendChild(downArrow);
    card.appendChild(tankSel);

    // Stat bars for the selected tank (Phase 7)
    statsCardEl = document.createElement("div");
    statsCardEl.id = "screen-tank-stats";
    card.appendChild(statsCardEl);

    const trackHint = document.createElement("div");
    trackHint.className = "controls-row";
    const hintKey = document.createElement("span");
    hintKey.className = "key";
    hintKey.textContent = "← →";
    const hintText = document.createElement("span");
    hintText.textContent = "choose track";
    trackHint.appendChild(hintKey);
    trackHint.appendChild(hintText);

    const tankHint = document.createElement("div");
    tankHint.className = "controls-row";
    const tankHintKey = document.createElement("span");
    tankHintKey.className = "key";
    tankHintKey.textContent = "↑ ↓";
    const tankHintText = document.createElement("span");
    tankHintText.textContent = "choose tank";
    tankHint.appendChild(tankHintKey);
    tankHint.appendChild(tankHintText);

    const controls = document.createElement("div");
    controls.className = "controls";
    for (const [key, action] of [
      ["W / ↑", "accelerate"],
      ["S / ↓", "brake / reverse"],
      ["A D / ← →", "steer"],
      ["SPACE", "fire shell"],
      ["P / ESC", "pause"],
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
    controls.appendChild(trackHint);
    controls.appendChild(tankHint);
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

  /** Tank name under the countdown numbers (Phase 7). */
  let countdownTag: HTMLDivElement | null = null;
  function ensureCountdownTag(): HTMLDivElement {
    if (!countdownTag) {
      countdownTag = document.createElement("div");
      countdownTag.id = "screen-countdown-tag";
      root.appendChild(countdownTag);
    }
    return countdownTag;
  }

  // --- Banner + toast share one fading element style --------------------------
  let banner: HTMLDivElement | null = null;
  let toastEl: HTMLDivElement | null = null;
  let paused: HTMLDivElement | null = null;

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
    if (countdownTag) countdownTag.textContent = "";
  }

  /** Rebuild the stat-bar card for one tank definition view. */
  function renderStatsCard(stats: TankStatsView): void {
    const el = statsCardEl!;
    el.textContent = "";
    for (const [label, fill] of [
      ["SPEED", stats.speed],
      ["ARMOR", stats.armor],
      ["FIRE", stats.fire],
    ] as const) {
      const row = document.createElement("div");
      row.className = "stat-row";
      const name = document.createElement("span");
      name.className = "stat-label";
      name.textContent = label;
      const bar = document.createElement("span");
      bar.className = "stat-bar";
      const barFill = document.createElement("span");
      barFill.className = "stat-fill";
      barFill.style.width = `${Math.round(Math.max(0, Math.min(1, fill)) * 100)}%`;
      barFill.style.background = stats.color;
      bar.appendChild(barFill);
      row.appendChild(name);
      row.appendChild(bar);
      el.appendChild(row);
    }
    const blurb = document.createElement("div");
    blurb.id = "screen-tank-blurb";
    blurb.textContent = stats.blurb;
    el.appendChild(blurb);
  }

  return {
    showTitle() {
      hideResultsNow();
      hideCountdownNow();
      ensureTitle().style.display = "";
    },
    setTrackName(name: string) {
      ensureTitle(); // build the title card if needed so the element exists
      if (trackNameEl) trackNameEl.textContent = name;
    },
    setBestTimes(lap, total) {
      ensureTitle();
      if (!bestTimesEl) return;
      const fmt = (v: string | null) => v ?? "--:--.-";
      bestTimesEl.textContent = `BEST LAP ${fmt(lap)} · BEST TOTAL ${fmt(total)}`;
    },
    setTankCard(stats: TankStatsView) {
      ensureTitle();
      if (tankNameEl) tankNameEl.textContent = stats.name;
      if (statsCardEl) renderStatsCard(stats);
    },
    showCountdownTag(text: string) {
      ensureCountdownTag().textContent = text;
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
    showResults(
      rows: ResultRow[],
      trackName: string,
      newBest?: NewBest,
    ) {
      const el = ensureResults();
      el.textContent = ""; // rebuild rows each race

      const card = document.createElement("div");
      card.className = "results-card";

      const h2 = document.createElement("h2");
      h2.textContent = "RACE COMPLETE";
      card.appendChild(h2);

      const track = document.createElement("div");
      track.className = "results-track";
      track.textContent = trackName;
      card.appendChild(track);

      // Phase 7: highlight records broken this race
      if (newBest?.lap || newBest?.total) {
        const badge = document.createElement("div");
        badge.id = "screen-new-best";
        const parts: string[] = [];
        if (newBest.lap) parts.push("NEW BEST LAP!");
        if (newBest.total) parts.push("NEW BEST TOTAL!");
        badge.textContent = parts.join(" · ");
        card.appendChild(badge);
      }

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
    showPaused() {
      if (!paused) {
        paused = document.createElement("div");
        paused.id = "screen-paused";
        paused.className = "screen-overlay dim";
        const card = document.createElement("div");
        card.className = "results-card";
        const h2 = document.createElement("h2");
        h2.textContent = "PAUSED";
        const press = document.createElement("p");
        press.className = "press blink";
        press.textContent = "P / ESC RESUME · R RESTART";
        card.appendChild(h2);
        card.appendChild(press);
        paused.appendChild(card);
        root.appendChild(paused);
      }
      paused.style.display = "";
    },
    hidePaused() {
      if (paused) paused.style.display = "none";
    },
  };
}

const ORDINALS = ["st", "nd", "rd"] as const;
