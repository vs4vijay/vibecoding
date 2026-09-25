/**
 * The postal meter: 3 health pips.
 *
 * Phase 2 balance: slug contact knocks Turbo off outright (game over
 * regardless of pips), hearts restore one pip capped at 3, and pips feed the
 * finish health bonus. Pip *loss* arrives with asteroid damage in Phase 3 and
 * gap falls in Phase 4 — `damage` is already here so those phases only wire
 * events, not new systems.
 */

export const MAX_PIPS = 3;

export class Health {
  private current = MAX_PIPS;

  public get pips(): number {
    return this.current;
  }

  /** True when the meter is empty (kept for Phase 3+ damage death). */
  public get isDepleted(): boolean {
    return this.current <= 0;
  }

  /**
   * Restores up to `amount` pips, capped at MAX_PIPS.
   * Returns how many pips were actually restored (0 when already full).
   */
  public restore(amount = 1): number {
    if (amount <= 0) return 0;
    const restored = Math.min(amount, MAX_PIPS - this.current);
    this.current += restored;
    return restored;
  }

  /** Removes up to `amount` pips (floor 0). Returns the remaining count. */
  public damage(amount = 1): number {
    if (amount <= 0) return this.current;
    this.current = Math.max(0, this.current - amount);
    return this.current;
  }

  public reset(): void {
    this.current = MAX_PIPS;
  }
}
