import "./shell.css";
import type { Game, GameMode } from "../Game";
import { HINTS, scheme, type HowtoRow, type Scheme } from "./Hints";

/**
 * The DOM shell (design D1): title / pause / results / how-to live as HTML in
 * the #shell layer above the WebGL + HUD canvases, styled with the storybook
 * palette (Hud.ts is the brand) and the bundled Baloo 2. The in-run HUD stays
 * on canvas; win/lose presentation moved here from Hud.drawBanner.
 *
 * Static control copy comes from the HINTS table (design D5) and follows the
 * latched input scheme: sync() dirty-checks the latch every frame and
 * rewrites the affected text nodes only when it flips.
 *
 * sync() runs once per frame from Game.frame and drives which screen is up
 * from the mode machine (+ loop phase for win/lose, + the resume-grace
 * counter). It is deliberately allocation-free: DOM is touched only when the
 * active screen, the pinned class, the scheme latch or the grace number
 * actually changes.
 *
 * Screens fade with short CSS transitions that collapse under
 * `prefers-reduced-motion` and under the `.pinned` capture kill-switch, so
 * pinned page screenshots settle instantly and stay byte-stable.
 */

/** Which shell screen is up (how-to is a modal state over title/pause). */
type ScreenId = "title" | "pause" | "win" | "lose" | "howto";

const TEMPLATE = `
  <section class="screen s-title" id="screen-title" aria-label="A Wild Bug">
    <div class="title-col">
      <svg class="title-ant" viewBox="0 0 120 88" aria-hidden="true" focusable="false">
        <g fill="none" stroke="#3b2607" stroke-width="4.5" stroke-linecap="round">
          <path d="M86 24 Q94 10 107 8" />
          <path d="M90 29 Q102 20 113 21" />
          <path d="M50 54 Q40 70 27 76" />
          <path d="M58 56 Q56 74 46 82" />
          <path d="M66 54 Q72 70 85 77" />
          <path d="M42 50 Q28 58 18 60" />
        </g>
        <ellipse cx="34" cy="44" rx="23" ry="17" fill="#4a3113" />
        <ellipse cx="27" cy="38" rx="10" ry="5.5" fill="#7a5626" opacity="0.65" />
        <ellipse cx="64" cy="42" rx="14" ry="11.5" fill="#553a14" />
        <ellipse cx="88" cy="35" rx="12.5" ry="10.5" fill="#4a3113" />
        <circle cx="92.5" cy="32" r="2.8" fill="#fff3d9" />
        <ellipse cx="99" cy="13" rx="6.5" ry="9" fill="#f0b452" transform="rotate(22 99 13)" />
        <path d="M99 6 Q102 12 99 20" stroke="#c9832e" stroke-width="1.6" fill="none" />
      </svg>
      <h1 class="logo">A Wild Bug</h1>
      <p class="tagline">Six grains before sunset.</p>
      <div class="stack">
        <button class="btn btn-primary" id="btn-start" type="button">Start foraging</button>
        <button class="btn btn-secondary" id="btn-howto-title" type="button">How to play</button>
      </div>
      <div class="toggles" role="group" aria-label="Audio toggles">
        <button class="toggle" id="tgl-music" type="button" aria-pressed="false">Music</button>
        <button class="toggle" id="tgl-sfx" type="button" aria-pressed="false">SFX</button>
      </div>
    </div>
      <p class="hint" id="title-hint">Enter start · H how to play</p>
    </section>

    <section class="screen s-pause" id="screen-pause" role="dialog" aria-labelledby="pause-heading">
      <div class="panel">
        <h2 id="pause-heading">Paused</h2>
        <div class="stack">
          <button class="btn btn-primary" id="btn-resume" type="button">Resume</button>
          <button class="btn btn-secondary" id="btn-restart" type="button">Restart day</button>
          <button class="btn btn-secondary" id="btn-howto-pause" type="button">How to play</button>
          <button class="btn btn-secondary" id="btn-quit" type="button">Quit to title</button>
        </div>
        <p class="hint-line" id="pause-hint">Esc / P resume</p>
      </div>
    </section>

  <section class="screen s-win" id="screen-win" role="dialog" aria-labelledby="win-heading">
    <div class="panel panel-win">
      <h2 id="win-heading">Quota met!</h2>
      <p class="r-sub">The colony eats tonight</p>
      <dl class="stats">
        <div><dt>Grains delivered</dt><dd id="win-grains">6 / 6</dd></div>
        <div><dt>Time</dt><dd id="win-time">0:00</dd></div>
      </dl>
      <p class="tease">Day 2 awaits…</p>
      <div class="row">
        <button class="btn btn-primary" id="btn-again-win" type="button">Forage again</button>
        <button class="btn btn-secondary" id="btn-title-win" type="button">Title</button>
      </div>
    </div>
  </section>

  <section class="screen s-lose" id="screen-lose" role="dialog" aria-labelledby="lose-heading">
    <div class="panel panel-lose">
      <h2 id="lose-heading">Hopper's shadow falls…</h2>
      <p class="r-sub">The colony goes hungry</p>
      <dl class="stats">
        <div><dt>Grains delivered</dt><dd id="lose-grains">0 / 6</dd></div>
        <div><dt>Time</dt><dd id="lose-time">0:00</dd></div>
      </dl>
      <div class="row">
        <button class="btn btn-primary" id="btn-again-lose" type="button">Forage again</button>
        <button class="btn btn-secondary" id="btn-title-lose" type="button">Title</button>
      </div>
    </div>
  </section>

  <section class="screen s-howto" id="screen-howto" role="dialog" aria-labelledby="howto-heading">
    <div class="panel panel-howto">
      <h2 id="howto-heading">How to play</h2>
      <p class="goal">Deliver six grains to the anthill before the sun sets. Watch the grasshopper — he steals carried grain.</p>
      <ul class="controls" id="howto-controls">
        <li><span class="key">WASD / ←↑↓→</span><span>move</span></li>
        <li><span class="key">Shift</span><span>sprint</span></li>
        <li><span class="key">Space</span><span>jump</span></li>
        <li><span class="key">E</span><span>pick up</span></li>
        <li><span class="key">F</span><span>throw</span></li>
        <li><span class="key">Q / E + drag</span><span>orbit camera</span></li>
        <li><span class="key">Wheel</span><span>zoom</span></li>
        <li><span class="key">Esc</span><span>pause</span></li>
      </ul>
      <p class="tip">Tip: spring seeds launch you to the apple crest — free grain grows up there.</p>
      <button class="btn btn-primary" id="btn-howto-back" type="button">Back</button>
    </div>
  </section>

  <button class="grace-chip" id="grace-chip" type="button" hidden>
    <span class="grace-num" id="grace-num">3</span>
    <span class="grace-label" id="grace-label">Resuming…</span>
  </button>
`;

function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`shell: #${id} missing from template`);
  return el as T;
}

function asButton(id: string): HTMLButtonElement {
  return must<HTMLButtonElement>(id);
}

export class Shell {
  readonly root: HTMLElement;

  private readonly screens: Record<ScreenId, HTMLElement>;
  private readonly primary: Record<ScreenId, HTMLButtonElement>;
  private readonly chip: HTMLButtonElement;
  private readonly chipNum: HTMLElement;

  private active: ScreenId | null = null;
  private chipShown = false;
  private lastChipCount = 0;
  private lastMode: GameMode | "boot" = "boot";

  /** Scheme the hint copy currently renders (dirty-checked in sync, design D5). */
  private appliedScheme: Scheme | null = null;

  /** How-to overlay state: which screen it opened over, and what to restore. */
  private howtoOpen = false;
  private howtoFrom: "title" | "pause" = "title";
  private howtoTrigger: HTMLButtonElement | null = null;

  /** Auto-focus waits for the first real interaction (keeps boot frames clean). */
  private interacted = false;

  constructor(private readonly game: Game) {
    this.root = document.getElementById("shell") ?? this.createRoot();
    this.root.innerHTML = TEMPLATE;
    this.chip = asButton("grace-chip");
    this.chipNum = must("grace-num");

    this.screens = {
      title: must("screen-title"),
      pause: must("screen-pause"),
      win: must("screen-win"),
      lose: must("screen-lose"),
      howto: must("screen-howto"),
    };
    this.primary = {
      title: asButton("btn-start"),
      pause: asButton("btn-resume"),
      win: asButton("btn-again-win"),
      lose: asButton("btn-again-lose"),
      howto: asButton("btn-howto-back"),
    };

    // One-activation routing: every control routes through the mode machine.
    asButton("btn-start").addEventListener("click", () => this.act("startDayFromTitle"));
    asButton("btn-resume").addEventListener("click", () => this.act("resume"));
    asButton("btn-restart").addEventListener("click", () => this.act("restartDay"));
    asButton("btn-quit").addEventListener("click", () => this.act("quitToTitle"));
    asButton("btn-again-win").addEventListener("click", () => this.act("restartDay"));
    asButton("btn-again-lose").addEventListener("click", () => this.act("restartDay"));
    asButton("btn-title-win").addEventListener("click", () => this.act("quitToTitle"));
    asButton("btn-title-lose").addEventListener("click", () => this.act("quitToTitle"));
    asButton("btn-howto-title").addEventListener("click", (e) =>
      this.openHowto("title", e.currentTarget as HTMLButtonElement),
    );
    asButton("btn-howto-pause").addEventListener("click", (e) =>
      this.openHowto("pause", e.currentTarget as HTMLButtonElement),
    );
    asButton("btn-howto-back").addEventListener("click", () => this.closeHowto());
    this.chip.addEventListener("click", () => this.act("resume")); // skip the wait

    // Audio toggles (design D4): REAL bus switches. pressed = on, aria-pressed
    // mirrors the persisted choice from boot on, and clicks write through to
    // wb.audio.music / wb.audio.sfx (the Audio class persists + ramps gains).
    const musicBtn = asButton("tgl-music");
    const sfxBtn = asButton("tgl-sfx");
    this.applyToggle(musicBtn, this.game.audio.musicEnabled);
    this.applyToggle(sfxBtn, this.game.audio.sfxEnabled);
    musicBtn.addEventListener("click", () => {
      this.game.audio.setMusic(!this.game.audio.musicEnabled);
      this.applyToggle(musicBtn, this.game.audio.musicEnabled);
    });
    sfxBtn.addEventListener("click", () => {
      this.game.audio.setSfx(!this.game.audio.sfxEnabled);
      this.applyToggle(sfxBtn, this.game.audio.sfxEnabled);
    });

    // UI press tick (design D4): every shell button press ticks the sfx bus —
    // a no-op until the first gesture built the graph (pre-gesture silence).
    this.root.addEventListener("click", (e) => {
      if ((e.target as HTMLElement | null)?.closest("button")) this.game.audio.sfx("ui");
    });

    // Screen-level keyboard: Esc closes how-to / resumes, P toggles pause,
    // Enter/H act on the title. (Buttons themselves are natively operable.)
    // CAPTURE phase on purpose: Input's own Esc/P listener sits on the bubble
    // phase of the same window, and on a LIVE day both fire for ONE keydown —
    // bubble order would let Shell see the just-paused state and immediately
    // `act("resume")`, so the menu never appears and the day slips through a
    // grace back to live play. Capture-first gives each key ONE owner: Shell
    // acts only on states it can see pre-pause (resume/menu-toggle), Input's
    // pause() then no-ops or lands clean.
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("pointerdown", this.onFirstInteract, { capture: true, once: true });
    window.addEventListener("keydown", this.onFirstInteract, { capture: true, once: true });
  }

  /**
   * Per-frame state pump (called from Game.frame): applies the pinned capture
   * class, caches results stats on the transition into `results`, and flips
   * the active screen + grace chip. Cheap by construction — see class docs.
   */
  sync(): void {
    const g = this.game;
    this.root.classList.toggle("pinned", g.pinned);

    // Scheme-aware copy (design D5): one cheap comparison per frame; the
    // text-node rewrite happens only when the latch actually flips, so a
    // correction lands on the next frame a screen is visible.
    if (scheme.get() !== this.appliedScheme) this.applyScheme();

    // Results data is read at the moment the screen becomes visible, not
    // recomputed per frame.
    if (g.mode === "results" && this.lastMode !== "results") {
      const grains = `${g.loop.deposited} / ${g.loop.quota}`;
      const time = Shell.formatElapsed(g.loop.dayElapsed);
      must("win-grains").textContent = grains;
      must("lose-grains").textContent = grains;
      must("win-time").textContent = time;
      must("lose-time").textContent = time;
    }
    this.lastMode = g.mode;

    // The how-to is a modal state over a stable screen; if the mode moved
    // underneath it (no UI path does today), close rather than mis-show it.
    const expectedMode: GameMode = this.howtoFrom === "title" ? "title" : "paused";
    if (this.howtoOpen && g.mode !== expectedMode) this.howtoOpen = false;

    const grace = g.mode === "paused" && g.graceRemaining > 0;
    let next: ScreenId | null;
    if (this.howtoOpen) next = "howto";
    else if (g.mode === "title") next = "title";
    else if (g.mode === "paused" && !grace) next = "pause";
    else if (g.mode === "results") next = g.loop.phase === "lose" ? "lose" : "win";
    else next = null;
    this.setScreen(next);

    if (grace !== this.chipShown) {
      this.chipShown = grace;
      this.chip.hidden = !grace;
      this.lastChipCount = 0;
      if (grace) this.focusEl(this.chip);
    }
    if (grace) {
      const n = Math.max(1, Math.ceil(g.graceRemaining));
      if (n !== this.lastChipCount) {
        this.lastChipCount = n;
        this.chipNum.textContent = String(n);
        this.chip.setAttribute("aria-label", `Resuming in ${n}; activate to skip the wait`);
      }
    }
  }

  // --- internals ---------------------------------------------------------------

  /** aria-pressed mirrors the actual bus state (accessibility spec). */
  private applyToggle(btn: HTMLButtonElement, on: boolean): void {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /**
   * Rewrites every scheme-flavored text node from the HINTS table (design
   * D5): the title hint, the pause hint line, the grace-chip label and the
   * how-to control listing. Runs only when the latched scheme flips, so the
   * DOM writes cost nothing in steady state.
   */
  private applyScheme(): void {
    const s = scheme.get();
    this.appliedScheme = s;
    must("title-hint").textContent = HINTS.titleHint[s];
    must("pause-hint").textContent = HINTS.pauseHint[s];
    must("grace-label").textContent = HINTS.graceChip[s];

    const rows: HowtoRow[] = HINTS.howtoControls[s];
    const items: HTMLLIElement[] = [];
    for (const row of rows) {
      const li = document.createElement("li");
      const chip = document.createElement("span");
      // Key rows keep the keycap face; touch rows wear the brown-glass button
      // chip so the listing reads like the widgets it names.
      chip.className = s === "touch" ? "key chip" : "key";
      chip.textContent = row.label;
      const text = document.createElement("span");
      text.textContent = row.text;
      li.append(chip, text);
      items.push(li);
    }
    const list = must<HTMLUListElement>("howto-controls");
    list.replaceChildren(...items);
  }

  /** Runs one mode-machine action, then re-syncs for immediate feedback. */
  private act(action: "startDayFromTitle" | "resume" | "restartDay" | "quitToTitle"): void {
    this.game[action]();
    this.sync();
  }

  private setScreen(next: ScreenId | null): void {
    if (next === this.active) return;
    if (this.active !== null) this.screens[this.active].classList.remove("on");
    this.active = next;
    if (next !== null) {
      this.screens[next].classList.add("on");
      this.focusEl(this.primary[next]);
    }
  }

  private openHowto(from: "title" | "pause", trigger: HTMLButtonElement): void {
    this.howtoOpen = true;
    this.howtoFrom = from;
    this.howtoTrigger = trigger;
    this.sync();
  }

  /** Returns exactly to where how-to opened from (title restored / pause held). */
  private closeHowto(): void {
    const trigger = this.howtoTrigger;
    this.howtoOpen = false;
    this.howtoTrigger = null;
    this.sync();
    if (trigger) this.focusEl(trigger);
  }

  /** Focus moves only after real interaction and never during pinned captures. */
  private focusEl(el: HTMLElement | null): void {
    if (!el || !this.interacted || this.game.pinned) return;
    el.focus({ preventScroll: true });
  }

  private readonly onFirstInteract = (): void => {
    this.interacted = true;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const g = this.game;
    switch (e.code) {
      case "Escape":
        if (this.howtoOpen) {
          e.preventDefault();
          this.closeHowto();
        } else if (g.mode === "paused" && g.graceRemaining === 0) {
          e.preventDefault();
          this.act("resume");
        }
        break;
      case "KeyP":
        // Pause/resume toggle. Mid-grace this is the "second activation"
        // that skips the countdown (Game.resume handles both roles).
        if (g.mode === "playing") {
          g.pause();
          this.sync();
        } else if (g.mode === "paused" && !this.howtoOpen) {
          g.resume();
          this.sync();
        }
        break;
      case "KeyH":
        if (g.mode === "title" && !this.howtoOpen) {
          e.preventDefault();
          this.openHowto("title", asButton("btn-howto-title"));
        }
        break;
      case "Enter":
        // A focused button owns Enter (native activation); start the day
        // only when focus rests on the page itself.
        if (
          g.mode === "title" &&
          !this.howtoOpen &&
          !(document.activeElement instanceof HTMLButtonElement)
        ) {
          this.act("startDayFromTitle");
        }
        break;
      default:
        break;
    }
  };

  private createRoot(): HTMLElement {
    const el = document.createElement("div");
    el.id = "shell";
    document.body.appendChild(el);
    return el;
  }

  /** m:ss — the results clock (loop day-seconds, not wall time). */
  private static formatElapsed(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
}
