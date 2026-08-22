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
  /** Phase 13: second human player row (highlighted in P2 orange). */
  isPlayerTwo?: boolean;
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

/** One row of the championship standings table (Phase 15). */
export interface ChampStandingRow {
  pos: number;
  name: string;
  color: string;
  points: number;
  isPlayer: boolean;
  isPlayerTwo?: boolean;
}

/** Championship sidebar shown under the RACE result (Phase 15). */
export interface ChampResultsView {
  /** Number of races completed so far (the one just raced included). */
  afterRace: number;
  totalRaces: number;
  /** Preformatted continue prompt ("PRESS ENTER — …"). */
  prompt: string;
  standings: ChampStandingRow[];
}

/** One podium/finals-table entry with series totals (Phase 15). */
export interface PodiumEntry extends ChampStandingRow {
  /** Preformatted sum of finished race totals, "—" if none were finished. */
  time: string;
  wins: number;
}

/** Final screen data after the last championship race (Phase 15). */
export interface ChampPodiumView {
  /** Sorted 1st → 4th; screens renders top 3 as podium steps. */
  entries: PodiumEntry[];
}

export interface Screens {
  showTitle(subtitle?: string): void;
  /** Title-screen track picker: updates the displayed circuit name. */
  setTrackName(name: string): void;
  /** Title-screen best times for the displayed circuit (null = no record). */
  setBestTimes(lap: string | null, total: string | null): void;
  /** Title-screen tank picker: name, blurb and stat bars (Phase 7). */
  setTankCard(stats: TankStatsView): void;
  /** Phase 13: title-screen mode display ("1 PLAYER" / "2 PLAYERS") +
   * per-player control hints in 2P. */
  setMode(twoPlayer: boolean): void;
  /** Phase 14: title-screen ghost toggle display ("GHOST ON" / "GHOST OFF"). */
  setGhost(on: boolean): void;
  /** Phase 15: title-screen series pill + track-picker enable/disable. */
  setChampMode(championship: boolean): void;
  /** Phase 15: "RACE n/4" line under the track name (null hides it). */
  setChampRace(text: string | null): void;
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
    champ?: ChampResultsView,
  ): void;
  hideResults(): void;
  /** Phase 15: final championship screen (gold/silver/bronze podium). */
  showPodium(view: ChampPodiumView): void;
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
  let trackSelEl: HTMLDivElement | null = null;
  let bestTimesEl: HTMLDivElement | null = null;
  let champRaceEl: HTMLDivElement | null = null;
  let tankNameEl: HTMLDivElement | null = null;
  let statsCardEl: HTMLDivElement | null = null;
  let modeEl: HTMLDivElement | null = null;
  let ghostEl: HTMLDivElement | null = null;
  let champEl: HTMLDivElement | null = null;
  let controlsEl: HTMLDivElement | null = null;
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
    sub.textContent = "THREE CIRCUITS · 3 LAPS · 4 TANKS";
    card.appendChild(h1);
    card.appendChild(sub);

    // Track selector (Phase 6): LEFT/RIGHT cycles circuits.
    // Phase 15: dimmed + inert while championship mode is active (fixed order).
    const trackSel = document.createElement("div");
    trackSel.className = "track-select";
    trackSelEl = trackSel;
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

    // Phase 15: "RACE n OF 4" series line (championship mode only)
    champRaceEl = document.createElement("div");
    champRaceEl.id = "screen-champ-race";
    card.appendChild(champRaceEl);

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

    // Phase 13: mode toggle — C (or gamepad Y) flips 1 PLAYER / 2 PLAYERS
    modeEl = document.createElement("div");
    modeEl.id = "screen-mode-select";
    card.appendChild(modeEl);

    // Phase 14: ghost toggle — G flips the replay ghost on/off (persisted)
    ghostEl = document.createElement("div");
    ghostEl.id = "screen-ghost-select";
    card.appendChild(ghostEl);

    // Phase 15: series toggle — V flips SINGLE RACE / CHAMPIONSHIP (persisted)
    champEl = document.createElement("div");
    champEl.id = "screen-champ-select";
    card.appendChild(champEl);

    // Controls listing: rebuilt per mode by renderControls() (setMode)
    controlsEl = document.createElement("div");
    controlsEl.className = "controls";
    card.appendChild(controlsEl);

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

  // --- Phase 15: podium overlay -------------------------------------------------
  let podium: HTMLDivElement | null = null;
  function ensurePodium(): HTMLDivElement {
    if (!podium) {
      podium = document.createElement("div");
      podium.id = "screen-podium";
      podium.className = "screen-overlay dim";
      root.appendChild(podium);
    }
    return podium;
  }
  function hidePodiumNow(): void {
    if (podium) {
      podium.remove();
      podium = null;
    }
  }
  function hideCountdownNow(): void {
    if (countdown) countdown.textContent = "";
    if (countdownTag) countdownTag.textContent = "";
  }

  /** Rebuild the stat-bar card for one tank definition view. */
  function renderStatsCard(stats: TankStatsView): void {    const el = statsCardEl!;
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

  /** One "KEY — action" row of the controls listing. */
  function controlsRow(key: string, action: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "controls-row";
    const k = document.createElement("span");
    k.className = "key";
    k.textContent = key;
    const a = document.createElement("span");
    a.textContent = action;
    row.appendChild(k);
    row.appendChild(a);
    return row;
  }

  /**
   * Phase 13: rebuild the title-screen controls listing for the active mode.
   * 1P keeps the classic single list; 2P swaps it for side-by-side per-player
   * columns so both humans can see their keys at a glance.
   */
  function renderControls(twoPlayer: boolean): void {
    const el = controlsEl!;
    el.textContent = "";
    if (!twoPlayer) {
      for (const [key, action] of [
        ["W / ↑", "accelerate"],
        ["S / ↓", "brake / reverse"],
        ["A D / ← →", "steer"],
        ["SPACE", "fire shell"],
        ["P / ESC", "pause"],
        ["M", "mute"],
        ["← →", "choose track"],
        ["↑ ↓", "choose tank"],
        ["C", "toggle 2P mode"],
        ["V", "single / championship"],
        ["G", "toggle ghost"],
      ] as const) {
        el.appendChild(controlsRow(key, action));
      }
      return;
    }
    // 2P: two color-coded player columns + shared rows underneath
    const cols = document.createElement("div");
    cols.className = "controls-cols";
    for (const [tag, label, drive, fire] of [
      ["p1", "P1", "W A S D", "SPACE"],
      ["p2", "P2", "ARROW KEYS", "ENTER"],
    ] as const) {
      const col = document.createElement("div");
      col.className = `p-col ${tag}`;
      const h3 = document.createElement("h3");
      h3.textContent = label;
      col.appendChild(h3);
      col.appendChild(controlsRow(drive, "drive"));
      col.appendChild(controlsRow(fire, "fire"));
      cols.appendChild(col);
    }
    el.appendChild(cols);
    for (const [key, action] of [
      ["P / ESC", "pause"],
      ["M", "mute"],
      ["← →", "choose track"],
      ["↑ ↓", "choose tank (P1)"],
      ["C", "toggle mode"],
      ["V", "single / championship"],
      ["G", "toggle ghost"],
    ] as const) {
      el.appendChild(controlsRow(key, action));
    }
  }

  return {
    showTitle(subtitle?: string) {
      hideResultsNow();
      hidePodiumNow();
      hideCountdownNow();
      const card = ensureTitle();
      if (subtitle) {
        const sub = card.querySelector<HTMLElement>(".subtitle");
        if (sub) sub.textContent = `${subtitle} · ${sub.textContent}`;
      }
      card.style.display = "";
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
    setMode(twoPlayer: boolean) {
      ensureTitle(); // build the card so the elements exist
      if (modeEl) {
        modeEl.textContent = twoPlayer ? "2 PLAYERS — SPLIT SCREEN" : "1 PLAYER";
        modeEl.classList.toggle("two", twoPlayer);
      }
      renderControls(twoPlayer);
    },
    setGhost(on: boolean) {
      ensureTitle();
      if (ghostEl) {
        ghostEl.textContent = on ? "GHOST ON" : "GHOST OFF";
        ghostEl.classList.toggle("on", on);
      }
    },
    // Phase 15: series pill + track picker availability
    setChampMode(championship: boolean) {
      ensureTitle();
      if (champEl) {
        champEl.textContent = championship ? "CHAMPIONSHIP" : "SINGLE RACE";
        champEl.classList.toggle("on", championship);
      }
      if (trackSelEl) trackSelEl.classList.toggle("disabled", championship);
    },
    setChampRace(text: string | null) {
      ensureTitle();
      if (champRaceEl) champRaceEl.textContent = text ?? "";
    },
    showCountdownTag(text: string) {
      ensureCountdownTag().textContent = text;
    },
    showCountdown(text: string) {
      const el = ensureCountdown();
      // Leaving the title card: a starting race must not keep it on screen
      // (showTitle restores visibility when returning to the title).
      if (title) title.style.display = "none";
      el.textContent = text;
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
      champ?: ChampResultsView,
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
        line.className =
          "result-row" +
          (row.isPlayer ? " player" : "") +
          (row.isPlayerTwo ? " player-two" : "");

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

      // Phase 15: championship standings under the race result. Kept compact
      // (smaller font, tighter rows) so both tables fit on one screen.
      if (champ) {
        const divider = document.createElement("div");
        divider.className = "champ-divider";
        divider.textContent = `CHAMPIONSHIP STANDINGS · AFTER RACE ${champ.afterRace}/${champ.totalRaces}`;
        card.appendChild(divider);

        for (const row of champ.standings) {
          const line = document.createElement("div");
          line.className =
            "champ-row" +
            (row.isPlayer ? " player" : "") +
            (row.isPlayerTwo ? " player-two" : "");

          const pos = document.createElement("span");
          pos.className = "champ-pos";
          pos.textContent = `${row.pos}.`;

          const swatch = document.createElement("span");
          swatch.className = "result-swatch";
          swatch.style.background = row.color;

          const name = document.createElement("span");
          name.className = "result-name";
          name.textContent = row.name;

          const pts = document.createElement("span");
          pts.className = "champ-pts";
          pts.textContent = `${row.points} PTS`;

          line.appendChild(pos);
          line.appendChild(swatch);
          line.appendChild(name);
          line.appendChild(pts);
          card.appendChild(line);
        }
      }

      const press = document.createElement("p");
      press.className = "press blink";
      press.textContent = champ ? champ.prompt : "PRESS R TO RESTART";
      card.appendChild(press);

      el.appendChild(card);
    },
    hideResults() {
      hideResultsNow();
    },
    // --- Phase 15: final podium -------------------------------------------------
    showPodium(view: ChampPodiumView) {
      hideResultsNow();
      const el = ensurePodium();
      // Cover the title card completely when the series ends straight from boot
      if (title) title.style.display = "none";
      el.textContent = "";

      const card = document.createElement("div");
      card.className = "results-card podium-card";

      const h2 = document.createElement("h2");
      h2.textContent = "CHAMPIONSHIP COMPLETE";
      card.appendChild(h2);

      const sub = document.createElement("div");
      sub.className = "podium-champion-line";
      const champEntry = view.entries[0];
      const star = document.createElement("span");
      star.className = "podium-star";
      star.textContent = "★ ";
      sub.appendChild(star);
      sub.appendChild(document.createTextNode(`${champEntry.name} TAKES THE TITLE`));
      card.appendChild(sub);

      // Steps rendered 2nd / 1st / 3rd so the champion stands center + tall
      const steps = document.createElement("div");
      steps.className = "podium-steps";
      const layout: Array<{ entryIdx: number; cls: "gold" | "silver" | "bronze" }> = [
        { entryIdx: 1, cls: "silver" },
        { entryIdx: 0, cls: "gold" },
        { entryIdx: 2, cls: "bronze" },
      ];
      for (const { entryIdx, cls } of layout) {
        const entry = view.entries[entryIdx];
        if (!entry) continue;
        const step = document.createElement("div");
        step.className = `podium-step ${cls}` + (entryIdx === 0 ? " champion" : "");

        const pos = document.createElement("div");
        pos.className = "podium-pos";
        pos.textContent = ["1ST", "2ND", "3RD"][entry.pos - 1] ?? `${entry.pos}TH`;

        const swatch = document.createElement("span");
        swatch.className = "result-swatch";
        swatch.style.background = entry.color;

        const name = document.createElement("div");
        name.className = "podium-name";
        name.textContent = entry.name;

        const pts = document.createElement("div");
        pts.className = "podium-pts";
        pts.textContent = `${entry.points} PTS · ${entry.wins} WIN${entry.wins === 1 ? "" : "S"}`;

        step.appendChild(pos);
        step.appendChild(swatch);
        step.appendChild(name);
        step.appendChild(pts);
        if (entryIdx === 0) {
          const crown = document.createElement("div");
          crown.className = "podium-crown";
          crown.textContent = "★ CHAMPION ★";
          step.appendChild(crown);
        }
        steps.appendChild(step);
      }
      card.appendChild(steps);

      // Full final table (4th place included)
      for (const entry of view.entries) {
        const line = document.createElement("div");
        line.className =
          "champ-row" +
          (entry.isPlayer ? " player" : "") +
          (entry.isPlayerTwo ? " player-two" : "");
        const pos = document.createElement("span");
        pos.className = "champ-pos";
        pos.textContent = `${entry.pos}.`;
        const swatch = document.createElement("span");
        swatch.className = "result-swatch";
        swatch.style.background = entry.color;
        const name = document.createElement("span");
        name.className = "result-name";
        name.textContent = entry.name;
        const meta = document.createElement("span");
        meta.className = "champ-meta";
        meta.textContent = `${entry.time} · ${entry.wins}W`;
        const pts = document.createElement("span");
        pts.className = "champ-pts";
        pts.textContent = `${entry.points} PTS`;
        line.appendChild(pos);
        line.appendChild(swatch);
        line.appendChild(name);
        line.appendChild(meta);
        line.appendChild(pts);
        card.appendChild(line);
      }

      const press = document.createElement("p");
      press.className = "press blink";
      press.textContent = "PRESS ENTER FOR TITLE · ESC ABANDONS";
      card.appendChild(press);

      el.appendChild(card);
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
