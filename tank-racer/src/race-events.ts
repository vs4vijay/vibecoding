// Pure race-event state machines — no framework imports so they stay testable
// headless (SPEC convention). Callers feed per-frame spline progress and
// standings; the detectors own no clocks and touch no DOM/THREE.

export interface WrongWayOptions {
  /** Seconds of continuous reverse travel required to arm. Default 0.6. */
  sustain?: number;
  /** Seconds of continuous forward travel required to clear after arming. Default 0.4. */
  clear?: number;
}

/**
 * Wrap-aware wrong-way detector over per-frame spline-t samples. Feed the
 * tank's spline t and the frame dt; returns true every frame while the
 * wrong-way state is armed (callers detect edges themselves).
 *
 * t wraps 1→0 at the start line, so the raw delta is re-centered into
 * (-0.5, 0.5) before it means anything. Arming requires `sustain` seconds of
 * continuous reverse; clearing requires `clear` seconds of continuous forward
 * — the hysteresis keeps spin-outs and wall scrapes from strobing the banner.
 */
export function createWrongWayDetector(
  options?: WrongWayOptions,
): (t: number, dt: number) => boolean {
  const sustain = options?.sustain ?? 0.6;
  const clear = options?.clear ?? 0.4;

  let prevT: number | undefined;
  let armed = false;
  let reverseTimer = 0;
  let forwardTimer = 0;

  return (t, dt) => {
    // The first sample only seeds the previous t — never arm off one frame.
    if (prevT === undefined) {
      prevT = t;
      return false;
    }

    // 0.99 → 0.01 must read as forward (+0.02), not a -0.98 jump.
    let d = t - prevT;
    if (d > 0.5) d -= 1;
    else if (d < -0.5) d += 1;
    prevT = t;

    // A backgrounded tab yields dt ≤ 0 or huge spikes; treat those frames as
    // no progress (neither timer moves) but keep tracking t so the next real
    // frame measures a sane delta.
    if (dt <= 0 || dt > 0.5) return armed;

    if (d > 0) {
      if (armed) {
        forwardTimer += dt;
        if (forwardTimer >= clear) {
          armed = false;
          reverseTimer = 0; // a re-arm needs a full fresh sustain window
        }
      } else {
        reverseTimer = 0; // forward progress discredits pending reverse
      }
    } else if (d < 0) {
      if (armed) {
        forwardTimer = 0; // reverse progress discredits pending clear
      } else {
        reverseTimer += dt;
        if (reverseTimer >= sustain) {
          armed = true;
          forwardTimer = 0;
          reverseTimer = 0;
        }
      }
    }
    // d === 0 (stationary on the parameter): leave both timers untouched.

    return armed;
  };
}

export interface PositionCalloutOptions {
  /** Minimum seconds between two callouts. Default 1.5. */
  cooldown?: number;
}

/**
 * Per-player position-change tracker (position 1 = best). Feed the current
 * race position and the current time in seconds; returns +1 when the position
 * improved, -1 when it worsened, null when nothing should be shown.
 *
 * A change inside the cooldown window is swallowed whole — neither the
 * reported position nor the fire time moves — so a flip-flop never strobes,
 * while a position that flipped and STAYED flipped still fires on the first
 * call after the window elapses.
 */
export function createPositionCalloutTracker(
  options?: PositionCalloutOptions,
): (pos: number, now: number) => number | null {
  const cooldown = options?.cooldown ?? 1.5;

  let lastReported: number | undefined;
  let lastFireTime = -Infinity; // never fired → first change is always due

  return (pos, now) => {
    // The starting grid is not an overtaking event.
    if (lastReported === undefined) {
      lastReported = pos;
      return null;
    }
    if (pos === lastReported) return null;
    if (now - lastFireTime < cooldown) return null;

    const gained = pos < lastReported ? 1 : -1;
    lastReported = pos;
    lastFireTime = now;
    return gained;
  };
}
