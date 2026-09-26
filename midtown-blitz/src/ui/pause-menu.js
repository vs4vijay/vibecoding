/**
 * Pause menu (Midtown Blitz UI, task 5.2).
 *
 * The PAUSED-mode overlay: a dimmed full-screen backdrop with a centered
 * panel offering RESUME (back to the exact prior state — main.js re-enters
 * racing without touching the frozen world), RESTART (fresh event entry —
 * main.js respawns the car), and QUIT TO MENU (full teardown back to MENU).
 *
 * Styling follows the established JS-injected conventions (index.html stays
 * untouched, inline `style.cssText` only): dark panel `rgba(5,7,12,…)`,
 * amber `#ffd452` accent, Barlow Condensed title. Layering: z-index 55 —
 * above the canvas and ?debug panels (50), below the settings screen (60),
 * so settings opened over a pause stays on top.
 */

/**
 * Handle for the created pause menu.
 *
 * @typedef {object} PauseMenu
 * @property {HTMLElement} root The overlay element (already mounted, hidden).
 * @property {() => void} show Make the overlay visible.
 * @property {() => void} hide Hide the overlay.
 * @property {() => boolean} isOpen Whether the overlay is visible.
 * @property {{ resume: HTMLButtonElement, restart: HTMLButtonElement, quit: HTMLButtonElement }} buttons
 *   The three actions — the automation/harness seam for "click RESUME".
 */

/**
 * Build the pause menu and mount it (hidden) on `mount`.
 * @param {object} deps Collaborators.
 * @param {() => void} deps.onResume Fired when RESUME is clicked.
 * @param {() => void} deps.onRestart Fired when RESTART is clicked.
 * @param {() => void} deps.onQuit Fired when QUIT TO MENU is clicked.
 * @param {ParentNode} [deps.mount=document.body] Node to append the overlay to.
 * @returns {PauseMenu} The pause menu handle.
 */
export function createPauseMenu({ onResume, onRestart, onQuit, mount = typeof document !== 'undefined' ? document.body : null }) {
  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Paused');
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
    // Dim the frozen scene behind the panel.
    'background:rgba(5,7,12,0.62)',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:10px',
    'width:min(320px, calc(100vw - 48px))',
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
  title.textContent = 'PAUSED';
  title.style.cssText =
    "font:600 34px/1.1 'Barlow Condensed', sans-serif;letter-spacing:6px;color:#ffd452;margin-bottom:8px";

  /**
   * A stacked menu button in the shared dark/amber language.
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
      'width:100%',
      "font:600 15px/1 'Barlow Condensed', sans-serif",
      'letter-spacing:3px',
      accent ? 'color:#0b0e14' : 'color:#cfe0ec',
      accent ? 'background:linear-gradient(135deg, #ffd452 0%, #ff8a3d 100%)' : 'background:#1a2030',
      accent ? 'border:1px solid rgba(255,212,82,0.7)' : 'border:1px solid rgba(207,224,236,0.25)',
      'border-radius:4px',
      'padding:12px 16px',
      'cursor:pointer',
    ].join(';');
    b.addEventListener('click', () => {
      onClick();
    });
    return b;
  }

  const buttons = {
    resume: makeButton('RESUME', () => onResume && onResume(), true),
    restart: makeButton('RESTART', () => onRestart && onRestart()),
    quit: makeButton('QUIT TO MENU', () => onQuit && onQuit()),
  };

  const hint = document.createElement('div');
  hint.textContent = 'ESC RESUMES · SIM FROZEN WHILE PAUSED';
  hint.style.cssText = 'margin-top:10px;font-size:10px;letter-spacing:2px;color:#5a617a';

  panel.append(title, buttons.resume, buttons.restart, buttons.quit, hint);
  root.appendChild(panel);
  if (mount) mount.appendChild(root);

  let isOpen = false;

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

    buttons,
  };
}
