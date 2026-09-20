/**
 * Pure helpers behind the kill-score popup pool — DOM-free and node-testable,
 * so the pool's reuse order and the popup text format are pinned by unit
 * tests (see tests/popups.test.ts). The DOM side lives in Hud.popup().
 */

/**
 * Round-robin pool cursor: maps the monotonically increasing spawn counter
 * to the slot index to overwrite. Once the pool has wrapped, slot 0 is the
 * oldest live popup, so bursts longer than the cap recycle popups
 * oldest-first and the DOM never grows. Count is CONFIG.hud.popupCount (> 0).
 */
export function nextPopupSlot(counter: number, count: number): number {
  return ((counter % count) + count) % count;
}

/**
 * Popup text: the awarded points (integer) plus ` ×N` when the STREAK
 * multiplier is ≥ 2. At ×1 — including a scrape kill that doubled the
 * points without a streak — the points stand alone, per the HUD spec.
 */
export function formatPopupText(points: number, multiplier: number): string {
  const pts = String(Math.floor(points));
  return multiplier >= 2 ? `${pts} ×${multiplier}` : pts;
}
