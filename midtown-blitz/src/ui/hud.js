/**
 * HUD (Midtown Blitz UI, task 5.3).
 *
 * The racing-mode DOM overlay (design Decision 1: DOM-overlay UI — text
 * layout is far cheaper in DOM than in-canvas): speedometer (big km/h
 * number, bottom-right), race timer (top-center, m:ss.t), the giant center
 * countdown display (3 · 2 · 1 · GO with a scale/fade pop), the reset prompt
 * (absorbed from main.js's task-3.3 stuck-prompt overlay — same triggers,
 * same styling, now ONE prompt owned here), and the checkpoint guidance:
 * a floating diamond marker at the projected checkpoint while it is
 * on-screen, and a screen-edge arrow pointing along the target direction
 * while it is off-screen (pure math in src/ui/checkpoint-arrow.js).
 *
 * Styling follows the established JS-injected conventions (index.html stays
 * untouched, no <style> tag in it): dark panels `rgba(5,7,12,…)`, amber
 * `#ffd452` accent, Barlow Condensed display font, Inter body — inline
 * `style.cssText` on every element, so the module is import-safe under
 * plain node with the harnesses' element stubs. One exception: the countdown
 * pop animation needs @keyframes, which inline styles cannot express — the
 * module injects ONE <style> element (into document.head, falling back to
 * body) holding the two keyframes; index.html is still untouched. The pop
 * is retriggered per number by alternating between the two identical
 * keyframe names (restarting a CSS animation without a reflow hack).
 *
 * Layering: z-index 45 — above the canvas, below the ?debug panels (50) and
 * the menus (55). The whole HUD is non-interactive (pointer-events:none).
 *
 * Per-frame cost: `setSpeed`/`setTimer`/`showCountdown`/`showResetPrompt`
 * write textContent/style ONLY when the value changes (rounded, so a
 * steady speed writes nothing); `updateCheckpoint` positions the guidance
 * with change-gated transform writes and reuses one shared result object —
 * no per-frame allocations beyond two small strings when a rounded value
 * actually moved. `updateCheckpoint` reads a camera-LIKE object (position,
 * matrixWorld.elements, fov degrees, aspect) — three.js itself is NOT
 * imported here, so the module and its harnesses stay plain-node safe.
 *
 * Mode ownership: main.js calls `show(mode)` at every mode entry — only
 * 'racing' shows the HUD; every other mode hides it, so it can never leak
 * into menu/paused/results. main.js also registers a racing-mode teardown
 * (mode machine registry) that clears the countdown display, the reset
 * prompt, and the checkpoint target.
 */

import { computeCheckpointIndicator } from './checkpoint-arrow.js';

/** Amber accent shared with the rest of the UI. */
const AMBER = '#ffd452';

/**
 * @keyframes for the countdown pop (two identical copies — showing a new
 * number alternates the animation-name, which restarts the animation
 * without a reflow hack). Injected once per createHud() call.
 */
const HUD_STYLE_CSS = [
  '@keyframes hudCountA{0%{transform:scale(1.9);opacity:0}',
  '18%{transform:scale(1.15);opacity:1}',
  '100%{transform:scale(1);opacity:0.92}}',
  '@keyframes hudCountB{0%{transform:scale(1.9);opacity:0}',
  '18%{transform:scale(1.15);opacity:1}',
  '100%{transform:scale(1);opacity:0.92}}',
].join('\n');

/**
 * Format a race time in ms as `m:ss.t` (HUD timer resolution: tenths).
 * Non-finite or negative input renders as the dimmed placeholder value.
 * @param {number | null} ms Race time in milliseconds.
 * @returns {string} Formatted time (e.g. 81234 -> '1:21.2').
 */
export function formatRaceTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '0:00.0';
  const totalTenths = Math.floor(ms / 100);
  const m = Math.floor(totalTenths / 600);
  const s = Math.floor((totalTenths % 600) / 10);
  const t = totalTenths % 10;
  return `${m}:${String(s).padStart(2, '0')}.${t}`;
}

/**
 * The world-space checkpoint target fed to {@link Hud.setCheckpoint}.
 *
 * @typedef {object} HudCheckpointTarget
 * @property {number} x World x (m).
 * @property {number} [y] World y (m; defaults to 0 — road level).
 * @property {number} z World z (m).
 * @property {string} [label] Optional label (future: checkpoint index/name).
 */

/**
 * The last per-frame guidance info computed by {@link Hud.updateCheckpoint}
 * (also exposed via `getCheckpointInfo()` for harnesses/console).
 *
 * @typedef {object} HudCheckpointInfo
 * @property {boolean} onScreen Whether the target projects inside the view.
 * @property {number} distM Distance camera -> target (m).
 * @property {number} bearingRad Signed bearing relative to the camera
 *   forward, positive toward screen-right (rad).
 */

/**
 * Handle for the created HUD.
 *
 * @typedef {object} Hud
 * @property {HTMLElement} root The overlay element (mounted, hidden).
 * @property {Record<string, HTMLElement>} parts Named child elements —
 *   speedoValue, speedoLabel, timer, countdownWrap, countdownText, diamond,
 *   edgeArrow, resetPrompt — the harness/console automation seam.
 * @property {(mode: string) => void} show Show the HUD (mode 'racing') or
 *   hide it (any other mode string) — called at every mode entry.
 * @property {() => void} hide Hide the HUD.
 * @property {() => boolean} isOpen Whether the HUD is visible.
 * @property {(kmh: number) => void} setSpeed Set the speedometer (km/h;
 *   non-finite reads as 0; DOM write only when the rounded value changes).
 * @property {(ms: number | null) => void} setTimer Set the race timer (ms)
 *   or null for the dimmed 0:00.0 placeholder (task 5.4 owns real timing).
 * @property {(n: number | string | null) => void} showCountdown Show the
 *   center countdown: 3/2/1 (number), 'GO' (or number 0), or null to clear.
 * @property {(target: HudCheckpointTarget | null) => void} setCheckpoint Set
 *   the current checkpoint world target (guidance on) or null (off).
 * @property {(camera: object) => HudCheckpointInfo | null} updateCheckpoint
 *   Per-frame guidance update from a camera-like object ({position,
 *   matrixWorld.elements, fov degrees, aspect}); returns the computed info
 *   (or null with no target). Call after the renderer has updated the
 *   camera's matrixWorld.
 * @property {(visible: boolean) => void} showResetPrompt Show/hide the
 *   absorbed stuck-reset prompt (write only on change).
 * @property {() => HudCheckpointInfo | null} getCheckpointInfo The last
 *   guidance info computed by updateCheckpoint (null with no target).
 */

/**
 * Build the HUD and mount it (hidden).
 * @param {object} [options] Configuration.
 * @param {ParentNode} [options.mount] Node to append the overlay to
 *   (defaults to document.body).
 * @param {number} [options.speedoBottomPx=16] Bottom offset of the
 *   speedometer in px — main.js lifts it above the ?debug audio block
 *   (bottom-right corner) when ?debug is on.
 * @returns {Hud} The HUD handle.
 */
export function createHud({ mount, speedoBottomPx = 16 } = {}) {
  const host = mount ?? (typeof document !== 'undefined' ? document.body : null);
  if (!host) {
    throw new Error('createHud: no mount node (pass { mount } or provide document.body)');
  }

  // One injected <style> for the countdown keyframes (see module header).
  const styleEl = document.createElement('style');
  styleEl.textContent = HUD_STYLE_CSS;
  (document.head || host).appendChild(styleEl);

  const root = document.createElement('div');
  root.setAttribute('aria-label', 'Race HUD');
  root.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'right:0',
    'bottom:0',
    'z-index:45',
    'display:none',
    'pointer-events:none',
    'user-select:none',
    "font:13px/1.4 'Inter', system-ui, sans-serif",
    'color:#e8ecf4',
  ].join(';');

  // --- speedometer (bottom-right) -------------------------------------------
  const speedo = document.createElement('div');
  speedo.style.cssText = [
    'position:absolute',
    'right:18px',
    `bottom:${Math.round(speedoBottomPx)}px`,
    'text-align:right',
    'text-shadow:0 2px 8px rgba(5,7,12,0.9)',
  ].join(';');
  const speedoValue = document.createElement('div');
  speedoValue.textContent = '0';
  speedoValue.style.cssText =
    "font:700 54px/1 'Barlow Condensed', sans-serif;letter-spacing:1px;color:#e8ecf4;" +
    'font-variant-numeric:tabular-nums';
  const speedoLabel = document.createElement('div');
  speedoLabel.textContent = 'KM/H';
  speedoLabel.style.cssText =
    "margin-top:2px;font:600 11px/1 'Inter', system-ui, sans-serif;letter-spacing:3px;color:#7a8299";
  speedo.append(speedoValue, speedoLabel);

  // --- race timer (top-center) -----------------------------------------------
  const timer = document.createElement('div');
  timer.textContent = '0:00.0';
  timer.setAttribute('role', 'timer');
  timer.style.cssText = [
    'position:absolute',
    'top:14px',
    'left:50%',
    'transform:translateX(-50%)',
    "font:600 30px/1 'Barlow Condensed', sans-serif",
    'letter-spacing:2px',
    'color:#e8ecf4',
    'font-variant-numeric:tabular-nums',
    'text-shadow:0 2px 8px rgba(5,7,12,0.9)',
    'opacity:0.35', // dimmed placeholder until 5.4 feeds a real race timer
  ].join(';');

  // --- countdown display (center) --------------------------------------------
  const countdownWrap = document.createElement('div');
  countdownWrap.style.cssText = [
    'position:absolute',
    'left:50%',
    'top:44%',
    'transform:translate(-50%,-50%)',
    'display:none',
  ].join(';');
  const countdownText = document.createElement('div');
  countdownText.style.cssText =
    "font:800 130px/1 'Barlow Condensed', sans-serif;letter-spacing:6px;color:#ffd452;" +
    'text-shadow:0 0 24px rgba(255,212,82,0.55), 0 4px 18px rgba(5,7,12,0.9)';
  countdownWrap.appendChild(countdownText);

  // --- checkpoint guidance: diamond (on-screen) + edge arrow (off-screen) ----
  const diamond = document.createElement('div');
  diamond.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'width:16px',
    'height:16px',
    'border:2px solid #ffd452',
    'background:rgba(255,212,82,0.25)',
    'box-shadow:0 0 10px rgba(255,212,82,0.65)',
    'display:none',
    'will-change:transform',
  ].join(';');
  const edgeArrow = document.createElement('div');
  edgeArrow.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'width:0',
    'height:0',
    'border-top:9px solid transparent',
    'border-bottom:9px solid transparent',
    'border-left:16px solid #ffd452',
    'filter:drop-shadow(0 0 6px rgba(255,212,82,0.8))',
    'display:none',
    'will-change:transform',
  ].join(';');

  // --- reset prompt (bottom-center; absorbed from main.js task 3.3) ----------
  const resetPrompt = document.createElement('div');
  resetPrompt.setAttribute('role', 'status');
  resetPrompt.setAttribute('aria-live', 'polite');
  resetPrompt.style.cssText = [
    'position:absolute',
    'left:50%',
    'bottom:88px',
    'transform:translateX(-50%)',
    'padding:10px 22px',
    "font:600 20px/1.2 'Barlow Condensed', sans-serif",
    'letter-spacing:2px',
    `color:${AMBER}`,
    'background:rgba(5,7,12,0.78)',
    'border:1px solid rgba(255,212,82,0.45)',
    'border-radius:6px',
    'text-align:center',
    'white-space:nowrap',
    'display:none',
  ].join(';');
  resetPrompt.textContent = 'STUCK — PRESS R TO RESET';

  root.append(speedo, timer, countdownWrap, diamond, edgeArrow, resetPrompt);
  host.appendChild(root);

  // --- change-gated display state --------------------------------------------
  let open = false;
  let lastSpeed = -1;
  let lastTimerText = '0:00.0';
  let lastTimerDimmed = true;
  let lastCountdown = undefined; // undefined = nothing shown yet
  /** @type {HudCheckpointTarget | null} */
  let target = null;
  // Task 6.2: the per-frame guidance info lives in ONE persistent object
  // (mutated in place by updateCheckpoint, never reassigned) plus a validity
  // flag — no object allocation per rendered frame. getCheckpointInfo hands
  // the live object out, so callers must read it, not stash it.
  /** @type {HudCheckpointInfo} */
  const lastInfo = { onScreen: false, distM: 0, bearingRad: 0 };
  let hasLastInfo = false;
  let promptVisible = false;
  let diamondShown = false;
  let arrowShown = false;
  // Task 6.2: guidance transforms are change-gated on the rounded NUMBERS
  // (cheaper than building the transform string every frame just to
  // compare it) — the string is only built when a component actually moved.
  let lastDiamondX = -1;
  let lastDiamondY = -1;
  let lastArrowX = -1;
  let lastArrowY = -1;
  let lastArrowCentirad = -1;
  let countdownAnimFlip = false;

  // Shared, reused projection objects (no per-frame allocation).
  /** @type {import('./checkpoint-arrow.js').CheckpointIndicator} */
  const indicator = { onScreen: false, x: 0, y: 0, angleRad: 0, distM: 0, bearingRad: 0 };
  /** @type {import('./checkpoint-arrow.js').CheckpointIndicatorParams} */
  const params = {
    camX: 0,
    camY: 0,
    camZ: 0,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    upX: 0,
    upY: 1,
    upZ: 0,
    forwardX: 0,
    forwardY: 0,
    forwardZ: 1,
    fovYRad: Math.PI / 3,
    aspect: 16 / 9,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  };

  /**
   * @param {number} n
   * @returns {number}
   */
  function clamp01(n) {
    return Math.min(1, Math.max(0, n));
  }

  /** @type {Hud} */
  const hud = {
    root,
    parts: {
      speedoValue,
      speedoLabel,
      timer,
      countdownWrap,
      countdownText,
      diamond,
      edgeArrow,
      resetPrompt,
    },

    /**
     * Show the HUD for a mode ('racing') or hide it for any other mode.
     * @param {string} mode The mode being entered.
     * @returns {void}
     */
    show(mode) {
      open = mode === 'racing';
      root.style.display = open ? 'block' : 'none';
    },

    /** @returns {void} */
    hide() {
      open = false;
      root.style.display = 'none';
    },

    /** @returns {boolean} Whether the HUD is visible. */
    isOpen() {
      return open;
    },

    /**
     * Update the speedometer (km/h; write only when the rounded value
     * changes).
     * @param {number} kmh Speed in km/h (non-finite reads as 0).
     * @returns {void}
     */
    setSpeed(kmh) {
      const v = Number.isFinite(kmh) ? Math.max(0, Math.round(kmh)) : 0;
      if (v === lastSpeed) return;
      lastSpeed = v;
      speedoValue.textContent = String(v);
    },

    /**
     * Update the race timer (write only when the formatted value or the
     * dimmed state changes).
     * @param {number | null} ms Race time in ms; null shows the dimmed
     *   placeholder (no race timer yet — task 5.4 feeds the real one).
     * @returns {void}
     */
    setTimer(ms) {
      const dimmed = ms === null || !Number.isFinite(ms);
      const text = formatRaceTime(ms);
      if (text === lastTimerText && dimmed === lastTimerDimmed) return;
      lastTimerText = text;
      lastTimerDimmed = dimmed;
      timer.textContent = text;
      timer.style.opacity = dimmed ? '0.35' : '1';
    },

    /**
     * Show the center countdown (write only on change; each new display
     * re-pops the animation by alternating keyframe names).
     * @param {number | string | null} n 3/2/1, 'GO' (or number 0), or null
     *   to clear.
     * @returns {void}
     */
    showCountdown(n) {
      const key = n === null || n === undefined ? null : n === 0 || n === 'GO' ? 'GO' : String(n);
      if (key === lastCountdown) return;
      lastCountdown = key;
      if (key === null) {
        countdownWrap.style.display = 'none';
        countdownText.style.animation = '';
        return;
      }
      countdownWrap.style.display = 'block';
      countdownText.textContent = key;
      countdownAnimFlip = !countdownAnimFlip;
      countdownText.style.animation = `hudCount${countdownAnimFlip ? 'B' : 'A'} 0.9s ease-out both`;
    },

    /**
     * Set the current checkpoint guidance target (called on target CHANGE,
     * not per frame; per-frame positioning is updateCheckpoint).
     * @param {HudCheckpointTarget | null} next World position or null.
     * @returns {void}
     */
    setCheckpoint(next) {
      target = next && typeof next.x === 'number' && typeof next.z === 'number' ? next : null;
      hasLastInfo = false;
      if (!target) {
        if (diamondShown) {
          diamondShown = false;
          diamond.style.display = 'none';
        }
        if (arrowShown) {
          arrowShown = false;
          edgeArrow.style.display = 'none';
        }
        // Reset the numeric transform gates so a re-shown target always
        // rewrites its transform even at the same rounded position.
        lastDiamondX = -1;
        lastDiamondY = -1;
        lastArrowX = -1;
        lastArrowY = -1;
        lastArrowCentirad = -1;
      }
    },

    /**
     * Per-frame guidance: project the target with the camera and position
     * the diamond (on-screen) or edge arrow (off-screen). No-op while the
     * HUD is hidden or no target is set. Call AFTER the renderer updated
     * the camera's matrixWorld.
     * @param {object} camera Camera-like ({position, matrixWorld.elements,
     *   fov in degrees, aspect}).
     * @returns {HudCheckpointInfo | null} The computed info (null with no
     *   target).
     */
    updateCheckpoint(camera) {
      if (!target) {
        hasLastInfo = false;
        return null;
      }
      if (!open) {
        hasLastInfo = false;
        return null;
      }
      const e = camera.matrixWorld.elements;
      params.camX = camera.position.x;
      params.camY = camera.position.y;
      params.camZ = camera.position.z;
      // Column-major matrixWorld: column 0 = right, 1 = up, 2 = back (the
      // camera looks down -Z, so forward = -column 2).
      params.rightX = e[0];
      params.rightY = e[1];
      params.rightZ = e[2];
      params.upX = e[4];
      params.upY = e[5];
      params.upZ = e[6];
      params.forwardX = -e[8];
      params.forwardY = -e[9];
      params.forwardZ = -e[10];
      params.fovYRad = (camera.fov * Math.PI) / 180;
      params.aspect = camera.aspect;
      params.targetX = target.x;
      params.targetY = target.y ?? 0;
      params.targetZ = target.z;
      computeCheckpointIndicator(indicator, params);

      const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
      const vh = (typeof window !== 'undefined' && window.innerHeight) || 720;
      const px = Math.round(indicator.x * vw);
      const py = Math.round(indicator.y * vh);

      if (indicator.onScreen) {
        if (!diamondShown) {
          diamondShown = true;
          diamond.style.display = 'block';
        }
        if (arrowShown) {
          arrowShown = false;
          edgeArrow.style.display = 'none';
        }
        if (px !== lastDiamondX || py !== lastDiamondY) {
          lastDiamondX = px;
          lastDiamondY = py;
          diamond.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%) rotate(45deg)`;
        }
      } else {
        if (diamondShown) {
          diamondShown = false;
          diamond.style.display = 'none';
        }
        if (!arrowShown) {
          arrowShown = true;
          edgeArrow.style.display = 'block';
        }
        const centirad = Math.round(indicator.angleRad * 100);
        if (px !== lastArrowX || py !== lastArrowY || centirad !== lastArrowCentirad) {
          lastArrowX = px;
          lastArrowY = py;
          lastArrowCentirad = centirad;
          edgeArrow.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%) rotate(${centirad / 100}rad)`;
        }
      }

      // Fill the persistent info object in place (task 6.2: no per-frame
      // allocation) and mark it valid for getCheckpointInfo.
      lastInfo.onScreen = indicator.onScreen;
      lastInfo.distM = indicator.distM;
      lastInfo.bearingRad = indicator.bearingRad;
      hasLastInfo = true;
      return lastInfo;
    },

    /**
     * Show/hide the absorbed stuck-reset prompt (write only on change).
     * @param {boolean} visible Desired visibility.
     * @returns {void}
     */
    showResetPrompt(visible) {
      const next = Boolean(visible);
      if (next === promptVisible) return;
      promptVisible = next;
      resetPrompt.style.display = next ? 'block' : 'none';
    },

    /** @returns {HudCheckpointInfo | null} The last guidance info (or null). */
    getCheckpointInfo() {
      return hasLastInfo ? lastInfo : null;
    },
  };

  return hud;
}
