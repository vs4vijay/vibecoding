/**
 * @file world/ring.js
 * World-locked slot-ring helper for global instanced dressing (buildings,
 * catenary, posters, ...). A ring covers [playerZ - back, playerZ + ahead]
 * with `slots` world-index slots spaced `spacing` apart; advancing allocates
 * the next world index into the cell that just left the window. Every cell's
 * look is a pure function of its world index, so ring position never leaks
 * into the result (deterministic under ?seed / ?freeze) and recycling never
 * allocates.
 */

/**
 * Advance a ring to cover the window around playerZ.
 * @param {{first: number|null}} state Mutable ring state (first world index).
 * @param {number} playerZ
 * @param {number} spacing Slot spacing in metres.
 * @param {number} slots Number of slots in the window.
 * @param {number} back Metres kept behind the player.
 * @param {(wi: number) => void} reassign Called per (re)assigned world index.
 * @returns {boolean} True if anything was reassigned.
 */
export function refreshRing(state, playerZ, spacing, slots, back, reassign) {
  const first = Math.floor((playerZ - back) / spacing);
  if (state.first === null || first < state.first) {
    // Initial build or rewind (run restart): rebuild the whole window.
    for (let k = 0; k < slots; k++) reassign(first + k);
    state.first = first;
    return true;
  }
  let changed = false;
  while (state.first < first) {
    reassign(state.first + slots);
    state.first++;
    changed = true;
  }
  return changed;
}

/** Deterministic positive modulo for ring cell mapping. */
export function ringCell(wi, slots) {
  return ((wi % slots) + slots) % slots;
}
