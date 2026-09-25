import type { MedalTier } from '../systems/Medal';
import type { LevelSelectEntry } from './LevelSelectModel';

/**
 * Fullscreen flow screens: menu, level select, pause, results and game over.
 * DOM overlays in the neon look (dark glass, cyan title, magenta accents);
 * the in-race HUD (score/pips/progress) stays in HUD.ts.
 *
 * Phase 5: every show/hide cross-fades quickly (~180 ms) so menu → game and
 * back never hard-cuts; the results screen renders the medal badge, a
 * time-vs-par row and the unlock celebration banner; the level-select screen
 * lists the whole campaign with lock state, per-level bests, keyboard cursor
 * (main.ts drives it) and mouse clicks (rows call `onLevelClick`).
 */

export interface ResultsData {
  readonly levelName: string;
  readonly packagesCollected: number;
  /** Total packages the level offers (the medal's collection axis). */
  readonly packagesAvailable: number;
  readonly packagePoints: number;
  /** Destruction points (asteroid/slug kills, smart bomb). Shown when > 0. */
  readonly bonus?: number;
  readonly finish: number;
  readonly health: number;
  readonly total: number;
  readonly time: number;
  /** Par time from the medal rule — shown next to the finish time. */
  readonly parSeconds: number;
  readonly medal: MedalTier;
  readonly newBestTime: boolean;
  readonly newBestScore: boolean;
  /** Whether a next level exists — Enter continues instead of returning to menu. */
  readonly hasNextLevel: boolean;
  /** Unlock celebration banner text (e.g. "LEVEL 8 UNLOCKED!"), null = none. */
  readonly unlockBanner: string | null;
}

export interface ScreensOptions {
  /** Element the screens attach to. Defaults to document.body. */
  container?: HTMLElement;
}

const STYLE_ID = 'laser-snail-screens-style';
const ROOT_ID = 'laser-snail-screens';
/** Overlay cross-fade length in ms (the juice-pass "quick fade"). */
const FADE_MS = 180;

const STYLES = `
#${ROOT_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  font-family: system-ui, "Segoe UI", sans-serif;
  user-select: none;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at center, rgba(5, 6, 15, 0.35) 0%, rgba(5, 6, 15, 0.82) 100%);
  opacity: 1;
  transition: opacity ${FADE_MS}ms ease;
}
#${ROOT_ID}.sm-fading {
  opacity: 0;
}
#${ROOT_ID}.sm-hidden {
  display: none;
}
#${ROOT_ID} .sm-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
  padding: 0 24px;
  max-width: min(640px, 92vw);
}
#${ROOT_ID} h1 {
  margin: 0;
  font-size: clamp(30px, 6vw, 64px);
  font-weight: 800;
  letter-spacing: 0.28em;
  text-indent: 0.28em;
  color: #e9fbff;
  text-shadow: 0 0 18px rgba(63, 242, 255, 0.75), 0 0 46px rgba(63, 242, 255, 0.4);
}
#${ROOT_ID} h1.sm-danger {
  color: #ffd7ec;
  text-shadow: 0 0 18px rgba(255, 79, 125, 0.85), 0 0 46px rgba(255, 79, 125, 0.45);
}
#${ROOT_ID} .sm-subtitle {
  margin: -6px 0 0;
  font-size: clamp(14px, 2vw, 19px);
  letter-spacing: 0.14em;
  color: #8fe8ff;
}
#${ROOT_ID} .sm-medal {
  display: none;
  font-size: clamp(18px, 3vw, 28px);
  font-weight: 800;
  letter-spacing: 0.34em;
  text-indent: 0.34em;
}
#${ROOT_ID} .sm-medal.sm-show {
  display: block;
  animation: sm-medal-pop 420ms cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
#${ROOT_ID} .sm-medal.sm-gold {
  color: #ffe066;
  text-shadow: 0 0 16px rgba(255, 224, 102, 0.95), 0 0 44px rgba(255, 200, 60, 0.55);
}
#${ROOT_ID} .sm-medal.sm-silver {
  color: #dff4ff;
  text-shadow: 0 0 16px rgba(190, 235, 255, 0.9), 0 0 40px rgba(150, 220, 255, 0.5);
}
#${ROOT_ID} .sm-medal.sm-bronze {
  color: #ffab73;
  text-shadow: 0 0 16px rgba(255, 150, 90, 0.9), 0 0 40px rgba(255, 120, 60, 0.5);
}
#${ROOT_ID} .sm-medal.sm-none {
  color: rgba(143, 232, 255, 0.35);
  text-shadow: none;
  font-size: clamp(13px, 2vw, 18px);
}
@keyframes sm-medal-pop {
  0% { transform: scale(0.4); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
#${ROOT_ID} .sm-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: min(340px, 80vw);
  padding: 16px 22px;
  border: 1px solid rgba(63, 242, 255, 0.28);
  border-radius: 14px;
  background: rgba(10, 16, 40, 0.55);
}
#${ROOT_ID} .sm-row {
  display: flex;
  justify-content: space-between;
  gap: 28px;
  font-size: clamp(13px, 1.8vw, 16px);
  letter-spacing: 0.1em;
  color: #9adcf0;
}
#${ROOT_ID} .sm-row strong {
  color: #d7f9ff;
  font-weight: 600;
}
#${ROOT_ID} .sm-row.sm-total {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid rgba(63, 242, 255, 0.25);
  font-size: clamp(15px, 2.2vw, 19px);
  font-weight: 700;
  color: #e9fbff;
}
#${ROOT_ID} .sm-row.sm-total strong {
  color: #7df8ff;
  text-shadow: 0 0 12px rgba(63, 242, 255, 0.8);
}
#${ROOT_ID} .sm-unlock {
  display: none;
  margin: 2px 0;
  font-size: clamp(15px, 2.4vw, 22px);
  font-weight: 800;
  letter-spacing: 0.26em;
  text-indent: 0.26em;
  color: #fff3b0;
  text-shadow: 0 0 16px rgba(255, 236, 130, 0.95), 0 0 44px rgba(255, 220, 90, 0.55);
}
#${ROOT_ID} .sm-unlock.sm-show {
  display: block;
  animation: sm-unlock-glow 1.4s ease-in-out infinite;
}
@keyframes sm-unlock-glow {
  0%, 100% { filter: brightness(1); transform: scale(1); }
  50% { filter: brightness(1.5); transform: scale(1.04); }
}
#${ROOT_ID} .sm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: min(460px, 86vw);
  max-height: min(58vh, 480px);
  overflow-y: auto;
  padding: 12px;
  border: 1px solid rgba(63, 242, 255, 0.28);
  border-radius: 14px;
  background: rgba(10, 16, 40, 0.55);
  pointer-events: auto;
}
#${ROOT_ID} .sm-level-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  align-items: baseline;
  gap: 12px;
  padding: 9px 14px;
  border: 1px solid rgba(63, 242, 255, 0.16);
  border-radius: 10px;
  background: rgba(16, 26, 58, 0.5);
  cursor: pointer;
  transition: border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
}
#${ROOT_ID} .sm-level-row.sm-selected {
  border-color: rgba(63, 242, 255, 0.85);
  background: rgba(24, 44, 92, 0.65);
  box-shadow: 0 0 14px rgba(63, 242, 255, 0.45), inset 0 0 18px rgba(63, 242, 255, 0.12);
}
#${ROOT_ID} .sm-level-row:not(.sm-locked):hover {
  border-color: rgba(63, 242, 255, 0.55);
}
#${ROOT_ID} .sm-level-row.sm-locked {
  cursor: default;
  border-color: rgba(120, 130, 170, 0.14);
  background: rgba(14, 16, 30, 0.45);
}
#${ROOT_ID} .sm-level-num {
  font-size: clamp(13px, 1.8vw, 16px);
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #7df8ff;
  text-shadow: 0 0 10px rgba(63, 242, 255, 0.7);
}
#${ROOT_ID} .sm-level-name {
  font-size: clamp(13px, 1.9vw, 17px);
  font-weight: 700;
  letter-spacing: 0.16em;
  color: #d7f9ff;
  text-align: left;
}
#${ROOT_ID} .sm-level-row.sm-locked .sm-level-name {
  color: rgba(160, 175, 210, 0.4);
  text-shadow: none;
}
#${ROOT_ID} .sm-level-row.sm-locked .sm-level-num {
  color: rgba(120, 150, 190, 0.35);
  text-shadow: none;
}
#${ROOT_ID} .sm-level-meta {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: #6fd4e8;
  white-space: nowrap;
}
#${ROOT_ID} .sm-level-row.sm-locked .sm-level-meta {
  color: rgba(255, 79, 125, 0.45);
  font-weight: 700;
}
#${ROOT_ID} .sm-badge {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: #ffd7ec;
  text-shadow: 0 0 12px rgba(255, 79, 125, 0.8);
}
#${ROOT_ID} .sm-prompt {
  margin: 4px 0 0;
  font-size: clamp(13px, 1.8vw, 16px);
  letter-spacing: 0.16em;
  color: #8fe8ff;
  animation: sm-prompt-breathe 1.8s ease-in-out infinite;
}
#${ROOT_ID} .sm-hint {
  font-size: 12px;
  letter-spacing: 0.14em;
  color: rgba(143, 232, 255, 0.5);
}
@keyframes sm-prompt-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
`;

export class Screens {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly subtitle: HTMLParagraphElement;
  private readonly medalBadge: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly unlockBanner: HTMLDivElement;
  private readonly prompt: HTMLParagraphElement;
  private readonly hint: HTMLParagraphElement;
  /** Rows of the level-select list, index-matched to the entries passed in. */
  private levelRows: HTMLDivElement[] = [];
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Called when an unlocked level row is clicked (pointerdown) — main.ts
   * starts that level directly. Locked rows never invoke it.
   */
  public onLevelClick: ((levelId: number) => void) | null = null;

  public constructor(options: ScreensOptions = {}) {
    const container = options.container ?? document.body;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    this.root = document.createElement('div');
    this.root.id = ROOT_ID;
    this.root.className = 'sm-hidden sm-fading'; // first show() fades in

    const panel = document.createElement('div');
    panel.className = 'sm-panel';

    this.title = document.createElement('h1');
    this.subtitle = document.createElement('p');
    this.subtitle.className = 'sm-subtitle';
    this.medalBadge = document.createElement('div');
    this.medalBadge.className = 'sm-medal';
    this.body = document.createElement('div');
    this.body.className = 'sm-body';
    this.list = document.createElement('div');
    this.list.className = 'sm-list';
    this.unlockBanner = document.createElement('div');
    this.unlockBanner.className = 'sm-unlock';
    this.prompt = document.createElement('p');
    this.prompt.className = 'sm-prompt';
    this.hint = document.createElement('p');
    this.hint.className = 'sm-hint';

    panel.append(
      this.title,
      this.subtitle,
      this.medalBadge,
      this.body,
      this.list,
      this.unlockBanner,
      this.prompt,
      this.hint,
    );
    this.root.appendChild(panel);
    container.appendChild(this.root);
  }

  /** menu: title + level card + controls hint. */
  public showMenu(levelNumber: number, levelName: string, options: { muted?: boolean } = {}): void {
    this.title.textContent = 'LASER SNAIL';
    this.title.classList.remove('sm-danger');
    this.subtitle.textContent = `Level ${levelNumber} — ${levelName}`;
    this.medalBadge.classList.remove('sm-show');
    this.setBody([]);
    this.list.replaceChildren();
    this.levelRows = [];
    this.unlockBanner.classList.remove('sm-show');
    this.prompt.textContent = 'Press Enter or click to race · ↓ Level Select';
    this.hint.textContent = `Arrows / WASD steer · Z / Space fire · Esc pause · M ${options.muted ? 'unmute' : 'mute'}`;
    this.show();
  }

  /**
   * level select: the full campaign list with lock state and bests. Keyboard
   * navigation is main.ts's job (`updateLevelSelectSelection` moves the
   * cursor); clicking an unlocked row calls `onLevelClick` and starts it.
   */
  public showLevelSelect(entries: readonly LevelSelectEntry[], selectedIndex: number): void {
    this.title.textContent = 'SELECT LEVEL';
    this.title.classList.remove('sm-danger');
    this.subtitle.textContent = 'Arrows move · Enter race · Esc menu';
    this.medalBadge.classList.remove('sm-show');
    this.setBody([]);
    this.unlockBanner.classList.remove('sm-show');
    this.prompt.textContent = 'Press Enter to race the selected level';
    this.hint.textContent = 'Up / Down (or Left / Right) navigate · mouse click picks directly';

    this.levelRows = entries.map((entry) => {
      const row = document.createElement('div');
      row.className = 'sm-level-row';

      const num = document.createElement('span');
      num.className = 'sm-level-num';
      num.textContent = String(entry.id).padStart(2, '0');

      const name = document.createElement('span');
      name.className = 'sm-level-name';
      name.textContent = entry.name;

      const meta = document.createElement('span');
      meta.className = 'sm-level-meta';
      if (!entry.unlocked) {
        meta.textContent = 'LOCKED';
      } else {
        const bests: string[] = [];
        if (entry.bestTime !== null) bests.push(`${entry.bestTime.toFixed(1)} s`);
        if (entry.bestScore !== null) bests.push(String(entry.bestScore));
        meta.textContent = bests.length > 0 ? `★ ${bests.join(' · ')}` : '—';
      }

      row.append(num, name, meta);
      if (!entry.unlocked) row.classList.add('sm-locked');
      // Rows are the only pointer-event surface: clicking a row must not
      // leak a confirm edge into the global window listener.
      row.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if (entry.unlocked) this.onLevelClick?.(entry.id);
      });
      return row;
    });

    this.list.replaceChildren(...this.levelRows);
    this.updateLevelSelectSelection(selectedIndex);
    this.show();
  }

  /** Moves the keyboard cursor without rebuilding the list. */
  public updateLevelSelectSelection(selectedIndex: number): void {
    this.levelRows.forEach((row, index) => {
      row.classList.toggle('sm-selected', index === selectedIndex);
    });
  }

  /** pause: dim overlay, resume prompt. */
  public showPause(): void {
    this.title.textContent = 'PAUSED';
    this.title.classList.remove('sm-danger');
    this.subtitle.textContent = '';
    this.medalBadge.classList.remove('sm-show');
    this.setBody([]);
    this.list.replaceChildren();
    this.levelRows = [];
    this.unlockBanner.classList.remove('sm-show');
    this.prompt.textContent = 'Press Enter to resume · Esc quits to menu';
    this.hint.textContent = '';
    this.show();
  }

  /** results: medal + score breakdown card + unlock celebration. */
  public showResults(data: ResultsData): void {
    this.title.textContent = 'LEVEL COMPLETE';
    this.title.classList.remove('sm-danger');
    this.subtitle.textContent = data.levelName;

    this.medalBadge.className = `sm-medal sm-${data.medal} sm-show`;
    this.medalBadge.textContent =
      data.medal === 'gold'
        ? '★ GOLD'
        : data.medal === 'silver'
          ? '★ SILVER'
          : data.medal === 'bronze'
            ? '★ BRONZE'
            : 'NO MEDAL';

    const rows: Array<[string, string]> = [
      [`Packages × ${data.packagesCollected} / ${data.packagesAvailable}`, String(data.packagePoints)],
    ];
    if (data.bonus !== undefined && data.bonus > 0) rows.push(['Destruction bonus', String(data.bonus)]);
    rows.push(['Finish bonus', String(data.finish)], ['Health bonus', String(data.health)]);
    rows.push([
      'Time',
      `${data.time.toFixed(1)} s (par ${data.parSeconds > 0 ? data.parSeconds.toFixed(1) : '—'} s)`,
    ]);
    this.setBody(rows, ['TOTAL', String(data.total)]);

    this.list.replaceChildren();
    this.levelRows = [];

    if (data.unlockBanner) {
      this.unlockBanner.textContent = data.unlockBanner;
      this.unlockBanner.classList.add('sm-show');
    } else {
      this.unlockBanner.classList.remove('sm-show');
    }

    const bests: string[] = [];
    if (data.newBestTime) bests.push('NEW BEST TIME!');
    if (data.newBestScore) bests.push('NEW BEST SCORE!');
    this.prompt.textContent =
      bests.length > 0
        ? `${bests.join('  ·  ')} — ${data.hasNextLevel ? 'Press Enter for the next level' : 'Press Enter for the menu'}`
        : data.hasNextLevel
          ? 'Press Enter for the next level'
          : 'Press Enter for the menu';
    this.hint.textContent = '';
    this.show();
  }

  /** game over: score + retry prompt. */
  public showGameOver(score: number): void {
    this.title.textContent = 'KNOCKED OFF!';
    this.title.classList.add('sm-danger');
    this.subtitle.textContent = 'Turbo lost the mail';
    this.medalBadge.classList.remove('sm-show');
    this.setBody([['Packages × 100', String(score)]], ['SCORE', String(score)]);
    this.list.replaceChildren();
    this.levelRows = [];
    this.unlockBanner.classList.remove('sm-show');
    this.prompt.textContent = 'Press Enter to retry · Esc for menu';
    this.hint.textContent = '';
    this.show();
  }

  /** Fades the overlay away, then removes it from layout. */
  public hide(): void {
    if (this.root.classList.contains('sm-hidden')) return;
    this.clearHideTimer();
    this.root.classList.add('sm-fading');
    this.hideTimer = setTimeout(() => {
      this.root.classList.add('sm-hidden');
      this.hideTimer = null;
    }, FADE_MS);
  }

  /** Removes the screens from the DOM. */
  public dispose(): void {
    this.clearHideTimer();
    this.root.remove();
  }

  /** Rebuilds the breakdown card; an optional total row is emphasized. */
  private setBody(rows: Array<[string, string]>, total?: [string, string]): void {
    this.body.replaceChildren();
    if (rows.length === 0 && !total) {
      this.body.style.display = 'none';
      return;
    }
    this.body.style.display = '';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'sm-row';
      const labelNode = document.createElement('span');
      labelNode.textContent = label;
      const valueNode = document.createElement('strong');
      valueNode.textContent = value;
      row.append(labelNode, valueNode);
      this.body.appendChild(row);
    }
    if (total) {
      const row = document.createElement('div');
      row.className = 'sm-row sm-total';
      const labelNode = document.createElement('span');
      labelNode.textContent = total[0];
      const valueNode = document.createElement('strong');
      valueNode.textContent = total[1];
      row.append(labelNode, valueNode);
      this.body.appendChild(row);
    }
  }

  /** Brings the overlay back: clear any pending hide, fade in from transparent. */
  private show(): void {
    this.clearHideTimer();
    this.root.classList.remove('sm-hidden');
    // Force a reflow while transparent so the fade-in transition runs.
    void this.root.offsetWidth;
    this.root.classList.remove('sm-fading');
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
