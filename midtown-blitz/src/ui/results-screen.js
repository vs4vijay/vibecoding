/**
 * Results screen (Midtown Blitz UI, task 5.2 shell + task 5.4 data + 5.5
 * record callout).
 *
 * The RESULTS-mode overlay: event title, TIME / MEDAL / BEST slots, an
 * optional NEW RECORD badge, and RETRY / MENU actions. Task 5.4 feeds it
 * real race endings through `machine.enterMode('results', data)`: a won
 * Blitz race renders its finish time and medal; a timed-out race renders
 * the FAILURE variant (same slots — the elapsed-at-expiry time, no medal —
 * with the title switched to "TIME UP" and an explanatory note). The data
 * contract is the 5.2 shape extended, not redesigned: `{ eventName?,
 * timeMs?, medal?, bestTimeMs?, bestMedal?, eventId?, failed?, isNewBest? }`
 * — missing fields keep the em-dash placeholders. Task 5.5 fills the rest:
 * main.js passes the standing best (`bestTimeMs`, after the run) and sets
 * `isNewBest` on a record run — a distinct amber NEW RECORD badge between
 * the slots and the note (never on the failure variant). The medal slot is
 * tinted with the medal's color (the menu chip palette) while its text
 * stays the plain uppercased name. `eventId` rides along unused by the UI
 * (main.js's RETRY reads it from the machine's entry data to re-run the
 * same event).
 *
 * Styling follows the established JS-injected conventions (index.html stays
 * untouched, inline `style.cssText` only): dark panel, amber accent, Barlow
 * Condensed title. Layering: z-index 55 — above canvas/?debug panels,
 * below the settings screen (60).
 */

import { formatRecordTime, MEDAL_COLORS } from './main-menu.js';

/**
 * Handle for the created results screen.
 *
 * @typedef {object} ResultsScreen
 * @property {HTMLElement} root The overlay element (already mounted, hidden).
 * @property {(data?: {
 *   eventName?: string, timeMs?: number, medal?: string,
 *   bestTimeMs?: number, bestMedal?: string,
 *   eventId?: string, failed?: boolean, isNewBest?: boolean
 * }) => void} show Fill the slots from `data` (missing fields keep the '—'
 *   placeholders); `failed` switches to the TIME UP failure variant;
 *   `isNewBest` shows the NEW RECORD badge (win variant only).
 * @property {() => void} hide Hide the overlay.
 * @property {() => boolean} isOpen Whether the overlay is visible.
 * @property {{ retry: HTMLButtonElement, menu: HTMLButtonElement }} buttons
 *   The two actions — the automation/harness seam for "click RETRY".
 * @property {{ event: HTMLElement, time: HTMLElement, medal: HTMLElement, best: HTMLElement, title: HTMLElement, record: HTMLElement }} slots
 *   The rendered text slots (harness assertions; `title` switches between
 *   RESULTS and the TIME UP failure variant; `record` is the NEW RECORD
 *   badge, display-none unless `isNewBest` was shown on a win).
 */

/**
 * Build the results screen and mount it (hidden) on `mount`.
 * @param {object} deps Collaborators.
 * @param {() => void} deps.onRetry Fired when RETRY is clicked (main re-enters
 *   racing fresh for the same event — task 5.4 supplies the real event).
 * @param {() => void} deps.onMenu Fired when MENU is clicked (back to MENU).
 * @param {ParentNode} [deps.mount=document.body] Node to append the overlay to.
 * @returns {ResultsScreen} The results screen handle.
 */
export function createResultsScreen({ onRetry, onMenu, mount = typeof document !== 'undefined' ? document.body : null }) {
  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Results');
  root.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'right:0',
    'bottom:0',
    'z-index:55',
    'display:none',
    'align-items:center',
    'justify-content:center',
    'pointer-events:auto',
    'user-select:none',
    'background:rgba(5,7,12,0.62)',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:8px',
    'width:min(380px, calc(100vw - 48px))',
    'padding:26px 28px 24px',
    "font:14px/1.5 'Inter', system-ui, sans-serif",
    'color:#e8ecf4',
    'background:rgba(5,7,12,0.92)',
    'border:1px solid rgba(255,212,82,0.45)',
    'border-radius:8px',
    'box-shadow:0 18px 60px rgba(0,0,0,0.55)',
    'text-align:center',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'RESULTS';
  title.style.cssText =
    "font:600 34px/1.1 'Barlow Condensed', sans-serif;letter-spacing:6px;color:#ffd452";

  const eventName = document.createElement('div');
  eventName.textContent = '—';
  eventName.style.cssText =
    "font:600 20px/1.2 'Barlow Condensed', sans-serif;letter-spacing:2px;color:#cfe0ec;margin-bottom:8px";

  /**
   * One labeled slot row: small uppercase label left, value right.
   * @param {string} label Row label.
   * @returns {{ row: HTMLDivElement, value: HTMLDivElement }} Row + value cell.
   */
  function makeSlot(label) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;width:100%;gap:18px';
    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size:11px;letter-spacing:2px;color:#7a8299';
    const value = document.createElement('div');
    value.textContent = '—';
    value.style.cssText =
      "font:600 18px/1.2 'Barlow Condensed', sans-serif;letter-spacing:1px;color:#e8ecf4";
    row.append(labelEl, value);
    return { row, value };
  }

  const timeSlot = makeSlot('TIME');
  const medalSlot = makeSlot('MEDAL');
  const bestSlot = makeSlot('BEST');

  // Task 5.5: the record callout — an amber-gradient pill (the primary
  // button's language) shown only when main reports a new-best finish.
  // Hidden by default and on the failure variant.
  const recordBadge = document.createElement('div');
  recordBadge.textContent = 'NEW RECORD';
  recordBadge.style.cssText = [
    'display:none',
    "font:600 15px/1 'Barlow Condensed', sans-serif",
    'letter-spacing:3px',
    'color:#0b0e14',
    'background:linear-gradient(135deg, #ffd452 0%, #ff8a3d 100%)',
    'border:1px solid rgba(255,212,82,0.7)',
    'border-radius:999px',
    'padding:6px 16px',
    'margin-top:4px',
  ].join(';');

  const note = document.createElement('div');
  note.style.cssText = 'margin-top:8px;font-size:10px;letter-spacing:2px;color:#5a617a';

  /**
   * Panel button in the shared dark/amber language.
   * @param {string} label Button text.
   * @param {() => void} onClick Click handler.
   * @param {boolean} [accent] Amber highlight (primary action).
   * @returns {HTMLButtonElement} The button.
   */
  function makeButton(label, onClick, accent = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = [
      'flex:1',
      "font:600 15px/1 'Barlow Condensed', sans-serif",
      'letter-spacing:3px',
      accent ? 'color:#0b0e14' : 'color:#cfe0ec',
      accent ? 'background:linear-gradient(135deg, #ffd452 0%, #ff8a3d 100%)' : 'background:#1a2030',
      accent ? 'border:1px solid rgba(255,212,82,0.7)' : 'border:1px solid rgba(207,224,236,0.25)',
      'border-radius:4px',
      'padding:11px 16px',
      'cursor:pointer',
    ].join(';');
    b.addEventListener('click', () => {
      onClick();
    });
    return b;
  }

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display:flex;gap:10px;width:100%;margin-top:10px';
  const buttons = {
    retry: makeButton('RETRY', () => onRetry && onRetry(), true),
    menu: makeButton('MENU', () => onMenu && onMenu()),
  };
  buttonRow.append(buttons.retry, buttons.menu);

  panel.append(
    title,
    eventName,
    timeSlot.row,
    medalSlot.row,
    bestSlot.row,
    recordBadge,
    note,
    buttonRow
  );
  root.appendChild(panel);
  if (mount) mount.appendChild(root);

  let isOpen = false;

  return {
    root,

    /**
     * Fill the slots from `data` and show the overlay. Missing or invalid
     * fields keep the em-dash placeholders. `failed: true` renders the
     * timeout variant: "TIME UP" title in red, the at-expiry time, no
     * medal, and the explanatory note. A win renders the medal tinted with
     * its palette color, `bestTimeMs` as the standing best (main passes the
     * record as it stands AFTER the run), and — when `isNewBest` is set —
     * the NEW RECORD badge (task 5.5; failure variant never shows it).
     * @param {object} [data] Optional results payload (see the typedef).
     * @returns {void}
     */
    show(data = {}) {
      const d = data && typeof data === 'object' ? data : {};
      const failed = d.failed === true;
      title.textContent = failed ? 'TIME UP' : 'RESULTS';
      title.style.color = failed ? '#ff5a4e' : '#ffd452';
      eventName.textContent =
        typeof d.eventName === 'string' && d.eventName ? d.eventName : '—';
      timeSlot.value.textContent = formatRecordTime(d.timeMs);
      const medal = typeof d.medal === 'string' && d.medal ? d.medal : null;
      medalSlot.value.textContent = medal ? medal.toUpperCase() : '—';
      medalSlot.value.style.color = medal ? MEDAL_COLORS[medal] ?? '#e8ecf4' : '#e8ecf4';
      const hasBest = typeof d.bestTimeMs === 'number';
      bestSlot.value.textContent = hasBest ? formatRecordTime(d.bestTimeMs) : '—';
      recordBadge.style.display = !failed && d.isNewBest === true ? 'inline-block' : 'none';
      note.textContent = failed
        ? 'TIME EXPIRED BEFORE THE FINAL CHECKPOINT'
        : '';
      note.style.display = failed ? 'block' : 'none';
      isOpen = true;
      root.style.display = 'flex';
    },

    /** @returns {void} */
    hide() {
      isOpen = false;
      root.style.display = 'none';
    },

    /** @returns {boolean} Whether the overlay is visible. */
    isOpen() {
      return isOpen;
    },

    buttons,
    slots: {
      title,
      event: eventName,
      time: timeSlot.value,
      medal: medalSlot.value,
      best: bestSlot.value,
      record: recordBadge,
    },
  };
}
