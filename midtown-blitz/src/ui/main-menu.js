/**
 * Main menu (Midtown Blitz UI, task 5.2).
 *
 * The full-screen DOM overlay shown in MENU mode: big MIDTOWN BLITZ gradient
 * title (the index.html loading-screen look), the event list — three Blitz
 * race cards plus the CRUISE FREE ROAM card — a SETTINGS button (opens the
 * task 5.1 settings screen), and a version/hint footer. The live 3D city
 * shows through a dark radial vignette behind the panel.
 *
 * Clicking any event/cruise card fires `onStartMode(eventId)`; main.js owns
 * what that starts (task 5.4: the real Blitz route definitions in
 * src/game/races.js — this module imports their checkpoint counts and time
 * limits for the card meta lines; the dependency points ui -> game only).
 * Best time + medal render from the save module's records map (task 5.1
 * shape); task 5.5 writes real records (main.js applies every finish
 * through src/game/records.js) and re-feeds them via `setRecords` on every
 * menu entry. The medal chip is a colored glyph + the uppercased medal
 * name ({@link MEDAL_COLORS}, shared with the results screen's medal
 * slot); no record yet shows the dimmed "NO RECORD" placeholder.
 *
 * Styling follows the established JS-injected conventions (index.html stays
 * untouched, no <style> tag): dark panels `rgba(5,7,12,…)`, amber `#ffd452`
 * accent, Barlow Condensed titles, Inter body — all inline `style.cssText`,
 * so the module is import-safe under plain node and the headless harness's
 * element stubs. Layering: z-index 55 — above the canvas and the ?debug
 * panels (50), below the settings screen (60) so SETTINGS opens on top.
 */

import { RACE_EVENT_BY_ID } from '../game/races.js';

/**
 * Format a time limit in ms as short `m:ss` for the card meta lines (the
 * full m:ss.mmm record format is {@link formatRecordTime}).
 * @param {number} ms Time in ms (non-finite renders '—').
 * @returns {string} e.g. 66500 -> '1:06' (floored seconds).
 */
function formatLimitMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The menu's event list (stable ids — task 5.5 keys records by them). The
 * ids/names MUST stay equal to the route definitions' ids/names in
 * src/game/races.js ({@link RACE_EVENTS}; the plain-node harness
 * cross-checks the two tables), and the card meta lines below render the
 * matching route's checkpoint count + time limit from there.
 */
export const MENU_EVENTS = Object.freeze([
  Object.freeze({ id: 'blitz-downtown', name: 'BLITZ · DOWNTOWN SPRINT' }),
  Object.freeze({ id: 'blitz-riverside', name: 'BLITZ · RIVERSIDE LOOP' }),
  Object.freeze({ id: 'blitz-tower', name: 'BLITZ · TOWER RUN' }),
]);

/** The free-roam card's event id (Cruise mode controller lands in 5.4). */
export const CRUISE_EVENT_ID = 'cruise';

/**
 * Medal chip colors, keyed by the save module's medal names (gold = the
 * amber accent, silver = the cool UI light, bronze = warm orange). Shared
 * with the results screen's medal slot so both read as one system.
 */
export const MEDAL_COLORS = Object.freeze({
  gold: '#ffd452',
  silver: '#cfe0ec',
  bronze: '#ff9a5c',
});

/** Glyph prefixed to a record's medal name on the card chips (task 5.5). */
const MEDAL_GLYPH = '●';

/**
 * Format a record time in ms as `m:ss.mmm` (e.g. 91234 -> '1:31.234').
 * Anything that is not a finite non-negative number renders as the em-dash
 * placeholder (no record yet).
 * @param {number | undefined} ms Finish time in milliseconds.
 * @returns {string} Formatted time or '—'.
 */
export function formatRecordTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.floor(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mmm = String(total % 1000).padStart(3, '0');
  return `${m}:${String(s).padStart(2, '0')}.${mmm}`;
}

/**
 * Handle for the created main menu.
 *
 * @typedef {object} MainMenu
 * @property {HTMLElement} root The overlay element (already mounted, hidden).
 * @property {() => void} show Make the overlay visible.
 * @property {() => void} hide Hide the overlay.
 * @property {() => boolean} isOpen Whether the overlay is visible.
 * @property {(records: Record<string, {bestTimeMs?: number, bestMedal?: string}>)} setRecords
 *   Re-render the per-event best time/medal chips from a records map (the
 *   save module's shape; called on every menu entry by main.js).
 * @property {Record<string, HTMLButtonElement>} cardButtons Card button per
 *   event id (the three MENU_EVENTS ids plus {@link CRUISE_EVENT_ID}) — the
 *   automation/harness seam for "click a card".
 * @property {HTMLButtonElement} settingsButton The SETTINGS button.
 */

/**
 * Build the main menu and mount it (hidden) on `mount`.
 * @param {object} deps Collaborators.
 * @param {(eventId: string) => void} deps.onStartMode Fired when an event or
 *   cruise card is clicked; receives the event id (see {@link MENU_EVENTS}).
 * @param {() => void} deps.onOpenSettings Fired when SETTINGS is clicked.
 * @param {Record<string, {bestTimeMs?: number, bestMedal?: string}>} [deps.records]
 *   Initial records map (save module shape) for the first render.
 * @param {string} [deps.version] Footer version string.
 * @param {ParentNode} [deps.mount=document.body] Node to append the overlay to.
 * @returns {MainMenu} The menu handle.
 */
export function createMainMenu({
  onStartMode,
  onOpenSettings,
  records = {},
  version = 'PRE-ALPHA · OPEN CITY PLAYTEST',
  mount = typeof document !== 'undefined' ? document.body : null,
}) {
  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Main menu');
  root.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'right:0',
    'bottom:0',
    'z-index:55',
    'display:none',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:10px',
    'pointer-events:auto',
    'user-select:none',
    'text-align:center',
    "font:14px/1.5 'Inter', system-ui, sans-serif",
    'color:#e8ecf4',
    // Dark vignette over the live city render (loading-screen palette).
    'background:radial-gradient(ellipse at 50% 32%, rgba(5,7,12,0.30) 0%, rgba(5,7,12,0.82) 62%, rgba(5,7,12,0.96) 100%)',
  ].join(';');

  // --- title block (index.html's gradient heading) --------------------------
  const title = document.createElement('div');
  title.textContent = 'MIDTOWN BLITZ';
  title.style.cssText =
    "font:800 76px/1 'Barlow Condensed', sans-serif;letter-spacing:8px;" +
    'background:linear-gradient(135deg, #ffd452 0%, #ff8a3d 100%);' +
    '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent';
  const subtitle = document.createElement('div');
  subtitle.textContent = 'OPEN-CITY ARCADE RACING';
  subtitle.style.cssText = 'margin-top:6px;color:#7a8299;font-size:13px;letter-spacing:4px';

  // --- event cards ------------------------------------------------------------
  const cardsWrap = document.createElement('div');
  cardsWrap.style.cssText =
    'display:flex;flex-direction:column;gap:10px;margin-top:26px;width:min(560px, 88vw)';

  /** @type {Record<string, HTMLButtonElement>} eventId -> card button. */
  const cardButtons = {};
  /** @type {Record<string, {time: HTMLDivElement, medal: HTMLDivElement}>} */
  const recordSlots = {};

  /**
   * One clickable card row: name + meta on the left, record/status chip on
   * the right.
   * @param {object} card Card descriptor.
   * @param {string} card.id Event id passed to onStartMode.
   * @param {string} card.name Card title.
   * @param {string} card.meta Second line (placeholder meta for now).
   * @param {boolean} card.accent Amber-highlighted (race) vs plain (cruise).
   * @returns {HTMLButtonElement} The card button.
   */
  function makeCard({ id, name, meta, accent }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Start ${name}`);
    b.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:16px',
      'width:100%',
      'padding:12px 18px',
      'cursor:pointer',
      'text-align:left',
      'border-radius:6px',
      accent
        ? 'background:rgba(26,32,48,0.88);border:1px solid rgba(255,212,82,0.45)'
        : 'background:rgba(26,32,48,0.72);border:1px solid rgba(207,224,236,0.25)',
    ].join(';');

    const left = document.createElement('div');
    left.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    const nameEl = document.createElement('div');
    nameEl.textContent = name;
    nameEl.style.cssText =
      "font:600 20px/1.1 'Barlow Condensed', sans-serif;letter-spacing:2px;color:#e8ecf4";
    const metaEl = document.createElement('div');
    metaEl.textContent = meta;
    metaEl.style.cssText = 'font-size:11px;letter-spacing:1px;color:#7a8299';
    left.append(nameEl, metaEl);

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px';
    const timeEl = document.createElement('div');
    timeEl.textContent = '—';
    timeEl.style.cssText =
      "font:600 16px/1.1 'Barlow Condensed', sans-serif;letter-spacing:1px;color:#cfe0ec";
    const medalEl = document.createElement('div');
    medalEl.textContent = 'NO RECORD';
    medalEl.style.cssText = 'font-size:10px;letter-spacing:2px;color:#7a8299';
    right.append(timeEl, medalEl);

    b.append(left, right);
    b.addEventListener('click', () => {
      if (onStartMode) onStartMode(id);
    });
    cardButtons[id] = b;
    recordSlots[id] = { time: timeEl, medal: medalEl };
    return b;
  }

  // Card meta from the REAL route data (src/game/races.js — task 5.4):
  // checkpoint count + time limit. The ids match RACE_EVENT_BY_ID (harness
  // cross-check); a missing definition falls back to a plain race label.
  for (const event of MENU_EVENTS) {
    const route = RACE_EVENT_BY_ID[event.id];
    cardsWrap.appendChild(
      makeCard({
        id: event.id,
        name: event.name,
        meta: route
          ? `BLITZ RACE · ${route.checkpoints.length} CHECKPOINTS · LIMIT ${formatLimitMs(route.timeLimitMs)}`
          : 'BLITZ RACE',
        accent: true,
      })
    );
  }
  cardsWrap.appendChild(
    makeCard({
      id: CRUISE_EVENT_ID,
      name: 'CRUISE — FREE ROAM',
      meta: 'NO OBJECTIVE · NO FAIL STATE · EXIT VIA PAUSE (ESC)',
      accent: false,
    })
  );

  // --- settings + footer ------------------------------------------------------
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.textContent = 'SETTINGS';
  settingsButton.setAttribute('aria-label', 'Open settings');
  settingsButton.style.cssText = [
    'margin-top:18px',
    "font:600 13px/1 'Inter', system-ui, sans-serif",
    'letter-spacing:2px',
    'color:#ffd452',
    'background:rgba(5,7,12,0.78)',
    'border:1px solid rgba(255,212,82,0.45)',
    'border-radius:6px',
    'padding:9px 22px',
    'cursor:pointer',
  ].join(';');
  settingsButton.addEventListener('click', () => {
    if (onOpenSettings) onOpenSettings();
  });

  const footer = document.createElement('div');
  footer.style.cssText = 'margin-top:22px;font-size:10px;letter-spacing:2px;color:#5a617a';
  footer.textContent = `${version} · WASD/ARROWS DRIVE · ESC PAUSE · C CAMERA · R RESET`;

  root.append(title, subtitle, cardsWrap, settingsButton, footer);
  if (mount) mount.appendChild(root);

  let isOpen = false;

  /**
   * Re-render the record chips of all race cards from the given map (unknown
   * / empty events keep the em-dash placeholder). A stored medal renders as
   * a colored glyph + the uppercased name ({@link MEDAL_COLORS}); no record
   * yet keeps the dimmed placeholder.
   * @param {Record<string, {bestTimeMs?: number, bestMedal?: string}>} next Records map.
   * @returns {void}
   */
  function renderRecords(next) {
    for (const event of MENU_EVENTS) {
      const slot = recordSlots[event.id];
      if (!slot) continue;
      const entry = next && typeof next === 'object' ? next[event.id] : null;
      const hasTime = !!entry && typeof entry.bestTimeMs === 'number';
      slot.time.textContent = hasTime ? formatRecordTime(entry.bestTimeMs) : '—';
      const medal = entry && typeof entry.bestMedal === 'string' ? entry.bestMedal : null;
      const hasMedal = medal != null && MEDAL_COLORS[medal] != null;
      slot.medal.textContent = hasMedal ? `${MEDAL_GLYPH} ${medal.toUpperCase()}` : 'NO RECORD';
      slot.medal.style.color = hasMedal ? MEDAL_COLORS[medal] : '#7a8299';
    }
  }

  renderRecords(records);

  return {
    root,

    /** @returns {void} */
    show() {
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

    /**
     * Swap the records map and re-render the chips (no change events).
     * @param {Record<string, {bestTimeMs?: number, bestMedal?: string}>} next Records map.
     * @returns {void}
     */
    setRecords(next) {
      renderRecords(next);
    },

    cardButtons,
    settingsButton,
  };
}
