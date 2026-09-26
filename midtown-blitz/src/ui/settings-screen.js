/**
 * Settings screen (Midtown Blitz UI, task 5.1).
 *
 * A DOM panel for the three persisted settings — master volume (0–100
 * slider), mute toggle, and graphics quality (low/medium/high chips) — plus
 * "reset to defaults" and a close action. Every change is applied LIVE
 * through caller-provided callbacks (audio setVolume/setMuted, the app's one
 * quality path) and handed to `persist` for the debounced save (design
 * Decision 10: whole-blob replace; ~250 ms debounce, flushed on close).
 *
 * Reachability: the panel works in NORMAL play (it is created on every boot,
 * not only behind ?debug), but nothing in the normal-play UI opens it yet —
 * task 5.2's menu owns that wiring. Until then main.js mounts a small
 * ?debug-only "Settings" corner button that calls `open()`.
 *
 * Styling follows the established JS-injected conventions (index.html stays
 * untouched): dark panels `rgba(5,7,12,…)`, amber `#ffd452` accent, Barlow
 * Condensed for the title, Inter for labels — all inline `style.cssText`
 * (no <style> tag), so the module is import-safe under plain node and the
 * headless boot harness's element stubs.
 *
 * DOM-free pieces are exported separately for the node harness:
 * {@link createSettingsWriter} (the debounced whole-blob writer) and the
 * factory itself does no DOM work until called.
 */

import { DEFAULT_SETTINGS } from '../game/save.js';

/** Debounce window for persisted writes (ms) — rapid slider drags coalesce. */
export const SETTINGS_WRITE_DEBOUNCE_MS = 250;

/**
 * Debounced writer for the save blob: `queue` replaces any pending payload
 * and schedules one `save` call after `delayMs`; `flush` writes immediately
 * (used on close); `dispose` flushes and stops the timer. Only the latest
 * queued payload is ever written — whole-blob replace makes coalescing safe.
 *
 * @typedef {object} SettingsWriter
 * @property {(data: unknown) => void} queue Coalesce `data` into the pending write.
 * @property {() => void} flush Write the pending payload now (no-op if none).
 * @property {() => void} dispose Flush and cancel the timer (idempotent enough).
 * @property {() => boolean} hasPending True while a write is scheduled.
 */

/**
 * Create the debounced blob writer.
 * @param {object} deps Collaborators.
 * @param {(data: unknown) => void} deps.save Receives the latest payload (calls saveSave).
 * @param {number} [delayMs=SETTINGS_WRITE_DEBOUNCE_MS] Debounce window.
 * @returns {SettingsWriter} The writer handle.
 */
export function createSettingsWriter({ save, delayMs = SETTINGS_WRITE_DEBOUNCE_MS }) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let pending = null;

  /** @type {SettingsWriter} */
  const handle = {
    /**
     * Replace the pending payload and (re)arm the debounce timer.
     * @param {unknown} data Latest whole-blob payload.
     * @returns {void}
     */
    queue(data) {
      pending = data;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (pending === null) return;
        const dataToSave = pending;
        pending = null;
        save(dataToSave);
      }, delayMs);
    },

    /**
     * Write the pending payload immediately and disarm the timer (used on
     * close so the last setting change survives without waiting).
     * @returns {void}
     */
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending === null) return;
      const dataToSave = pending;
      pending = null;
      save(dataToSave);
    },

    /**
     * Flush any pending write (the timer is disarmed first, so the write
     * happens exactly once).
     * @returns {void}
     */
    dispose() {
      handle.flush();
    },

    /** @returns {boolean} True while a debounced write is outstanding. */
    hasPending() {
      return pending !== null;
    },
  };

  return handle;
}

/**
 * Handle for the created settings screen.
 *
 * @typedef {object} SettingsScreen
 * @property {() => void} open Show the panel (re-syncs controls from `getSettings`).
 * @property {() => void} close Hide the panel and notify `onClose` (main flushes the pending save).
 * @property {() => void} toggle Show when hidden, close when shown.
 * @property {() => boolean} isOpen Whether the panel is currently visible.
 * @property {(settings: {volume: number, muted: boolean, quality: string}) => void} sync
 *   Update the controls from a settings object WITHOUT emitting changes or
 *   queueing a save (used on open so ?debug tier keys stay reflected).
 * @property {HTMLElement} root The panel element (already mounted).
 */

/**
 * Build the settings screen and mount it (hidden) on `mount`.
 *
 * Change flow (one change → live effect + one debounced persist):
 *  - volume slider `input` → `onApplyVolume(v01)` (v01 in [0, 1])
 *  - mute toggle click     → `onApplyMuted(muted)`
 *  - quality chip click    → `onApplyQuality(tier)` (the app's ONE quality path)
 *  - reset button          → re-applies {@link DEFAULT_SETTINGS} through those same paths
 * After each change `persist(nextSettings)` is called (main's debounced
 * whole-blob writer); `close()` calls `onClose` so main flushes the write.
 * Escape closes the panel (raw window listener, guarded against form-editing
 * targets — the input manager's keys are untouched).
 *
 * @param {object} deps Collaborators.
 * @param {{volume: number, muted: boolean, quality: string}} settings Initial
 *   (already-sanitized) settings to show.
 * @param {(v01: number) => void} deps.onApplyVolume Live volume apply (audio.setVolume).
 * @param {(muted: boolean) => void} deps.onApplyMuted Live mute apply (audio.setMuted).
 * @param {(tier: string) => void} deps.onApplyQuality Live tier apply (the app's one quality path).
 * @param {(settings: {volume: number, muted: boolean, quality: string}) => void} deps.persist
 *   Queue a debounced whole-blob save (main merges records + saveSave).
 * @param {() => void} [deps.onClose] Called after every close (main flushes the writer).
 * @param {() => {volume: number, muted: boolean, quality: string}} [deps.getSettings]
 *   Live settings reader; open() re-syncs from it (default: the initial snapshot).
 * @param {ParentNode} [deps.mount=document.body] Node to append the panel to.
 * @param {EventTarget} [deps.keyTarget=window] Escape-key listener target (injectable for tests).
 * @returns {SettingsScreen} The screen handle.
 */
export function createSettingsScreen({
  settings,
  onApplyVolume,
  onApplyMuted,
  onApplyQuality,
  persist,
  onClose,
  getSettings,
  mount = typeof document !== 'undefined' ? document.body : null,
  keyTarget = typeof window !== 'undefined' ? window : null,
}) {
  /** Mutable copy of the last-known settings (kept in sync by the setters). */
  let current = { ...settings };
  let isOpen = false;

  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Settings');
  root.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:50%',
    'transform:translate(-50%,-50%)',
    'z-index:60',
    'display:none',
    'width:min(400px, calc(100vw - 32px))',
    'padding:22px 24px 20px',
    'pointer-events:auto',
    "font:13px/1.5 'Inter', system-ui, sans-serif",
    'color:#e8ecf4',
    'background:rgba(5,7,12,0.92)',
    'border:1px solid rgba(255,212,82,0.45)',
    'border-radius:8px',
    'box-shadow:0 18px 60px rgba(0,0,0,0.55)',
    'text-align:left',
    'user-select:none',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'SETTINGS';
  title.style.cssText =
    "font:600 26px/1.1 'Barlow Condensed', sans-serif;letter-spacing:4px;color:#ffd452;margin-bottom:16px";

  /**
   * A settings row: uppercase label on the left, control on the right.
   * @param {string} label Row label.
   * @returns {{ row: HTMLDivElement, control: HTMLDivElement }} Row + control cell.
   */
  function makeRow(label) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:14px';
    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    labelEl.style.cssText = 'flex:0 0 118px;font-size:11px;letter-spacing:1.5px;color:#7a8299';
    const control = document.createElement('div');
    control.style.cssText = 'flex:1;display:flex;align-items:center;gap:8px';
    row.append(labelEl, control);
    return { row, control };
  }

  /**
   * Panel button in the shared dark/amber language (bigger than the ?debug
   * chips, same family).
   * @param {string} label Initial label.
   * @returns {HTMLButtonElement} The button.
   */
  function makeButton(label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = [
      'font:600 12px/1 \'Inter\', system-ui, sans-serif',
      'letter-spacing:1px',
      'color:#cfe0ec',
      'background:#1a2030',
      'border:1px solid rgba(207,224,236,0.25)',
      'border-radius:4px',
      'padding:7px 12px',
      'cursor:pointer',
    ].join(';');
    return b;
  }

  // --- volume row -----------------------------------------------------------
  const volumeRow = makeRow('MASTER VOLUME');
  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.min = '0';
  volumeSlider.max = '100';
  volumeSlider.step = '1';
  volumeSlider.style.cssText = 'flex:1;accent-color:#ffd452;cursor:pointer';
  const volumeValue = document.createElement('div');
  volumeValue.style.cssText = 'flex:0 0 42px;text-align:right;color:#cfe0ec';
  volumeRow.control.append(volumeSlider, volumeValue);

  // --- mute row ---------------------------------------------------------------
  const muteRow = makeRow('MUTE');
  const muteButton = makeButton('OFF');
  muteRow.control.append(muteButton);

  // --- quality row ------------------------------------------------------------
  const qualityRow = makeRow('QUALITY');
  /** @type {Record<string, HTMLButtonElement>} Tier name -> chip. */
  const qualityChips = {};
  for (const tier of ['low', 'medium', 'high']) {
    const chip = makeButton(tier.toUpperCase());
    chip.style.padding = '7px 10px';
    chip.addEventListener('click', () => {
      setQuality(tier);
    });
    qualityChips[tier] = chip;
    qualityRow.control.append(chip);
  }

  // --- footer: reset + close ----------------------------------------------------
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:space-between;margin-top:6px';
  const resetButton = makeButton('RESET TO DEFAULTS');
  resetButton.style.color = '#ffb0a0';
  const closeButton = makeButton('CLOSE');
  footer.append(resetButton, closeButton);

  root.append(title, volumeRow.row, muteRow.row, qualityRow.row, footer);
  if (mount) mount.appendChild(root);

  /**
   * Push the current settings into the controls (no change events fired).
   * @returns {void}
   */
  function renderControls() {
    volumeSlider.value = String(Math.round(current.volume * 100));
    volumeValue.textContent = `${Math.round(current.volume * 100)}%`;
    muteButton.textContent = current.muted ? 'ON' : 'OFF';
    muteButton.style.color = current.muted ? '#ffd452' : '#cfe0ec';
    muteButton.style.borderColor = current.muted
      ? 'rgba(255,212,82,0.7)'
      : 'rgba(207,224,236,0.25)';
    for (const [tier, chip] of Object.entries(qualityChips)) {
      const active = tier === current.quality;
      chip.style.color = active ? '#ffd452' : '#cfe0ec';
      chip.style.borderColor = active ? 'rgba(255,212,82,0.7)' : 'rgba(207,224,236,0.25)';
    }
  }

  /**
   * Set volume: live apply + persist. Re-rendering writes the rounded value
   * back into the slider, which is harmless while dragging (the slider's
   * step is 1, so the written value equals what the user already sees).
   * @param {number} v01 Volume in [0, 1].
   * @returns {void}
   */
  function setVolume(v01) {
    current.volume = v01;
    onApplyVolume(v01);
    persist({ ...current });
    renderControls();
  }

  /**
   * Set mute: live apply + persist.
   * @param {boolean} muted Next mute flag.
   * @returns {void}
   */
  function setMuted(muted) {
    current.muted = muted;
    onApplyMuted(muted);
    persist({ ...current });
    renderControls();
  }

  /**
   * Set quality tier: live apply (the app's one quality path) + persist.
   * @param {string} tier 'low' | 'medium' | 'high'.
   * @returns {void}
   */
  function setQuality(tier) {
    current.quality = tier;
    onApplyQuality(tier);
    persist({ ...current });
    renderControls();
  }

  volumeSlider.addEventListener('input', () => {
    const pct = Number.parseFloat(volumeSlider.value);
    setVolume(Number.isFinite(pct) ? Math.min(1, Math.max(0, pct / 100)) : 0);
  });
  muteButton.addEventListener('click', () => {
    setMuted(!current.muted);
  });
  resetButton.addEventListener('click', () => {
    setVolume(DEFAULT_SETTINGS.volume);
    setMuted(DEFAULT_SETTINGS.muted);
    setQuality(DEFAULT_SETTINGS.quality);
  });
  closeButton.addEventListener('click', () => {
    closeScreen();
  });

  /**
   * Show the panel, re-synced from `getSettings` when provided (so ?debug
   * tier switches are reflected on open).
   * @returns {void}
   */
  function openScreen() {
    if (getSettings) current = { ...getSettings() };
    renderControls();
    isOpen = true;
    root.style.display = 'block';
  }

  /**
   * Hide the panel and notify `onClose` (main flushes the debounced write).
   * @returns {void}
   */
  function closeScreen() {
    if (!isOpen) return;
    isOpen = false;
    root.style.display = 'none';
    if (onClose) onClose();
  }

  // Escape closes (panel is above everything; guarded like input.js so a
  // user typing into a form control never triggers it).
  if (keyTarget) {
    keyTarget.addEventListener('keydown', (event) => {
      if (!isOpen || !event || event.code !== 'Escape') return;
      if (isEditableTarget(event.target)) return;
      closeScreen();
    });
  }

  /**
   * Whether an event target is an editable form control (mirrors main.js's
   * ?debug guard; kept local so this module stays dependency-free).
   * @param {unknown} node Event target.
   * @returns {boolean} True for INPUT/TEXTAREA/SELECT/contentEditable.
   */
  function isEditableTarget(node) {
    if (!node || typeof node.tagName !== 'string') return false;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return node.isContentEditable === true;
  }

  renderControls();

  return {
    open: openScreen,
    close: closeScreen,

    /**
     * Show when hidden, close when shown.
     * @returns {void}
     */
    toggle() {
      if (isOpen) closeScreen();
      else openScreen();
    },

    /** @returns {boolean} Whether the panel is currently visible. */
    isOpen() {
      return isOpen;
    },

    /**
     * Re-sync the controls from a settings object WITHOUT emitting changes
     * or queueing a save.
     * @param {{volume: number, muted: boolean, quality: string}} next Settings to reflect.
     * @returns {void}
     */
    sync(next) {
      current = { ...next };
      renderControls();
    },

    root,
  };
}
