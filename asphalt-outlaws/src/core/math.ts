// Small pure math helpers shared by sim and render.

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : clamp((v - a) / (b - a), 0, 1);
}

/** Move current toward target by at most delta. */
export function approach(current: number, target: number, delta: number): number {
  if (current < target) return Math.min(current + delta, target);
  return Math.max(current - delta, target);
}

export function easeIn(a: number, b: number, p: number): number {
  return a + (b - a) * p * p;
}

export function easeOut(a: number, b: number, p: number): number {
  return a + (b - a) * (1 - (1 - p) * (1 - p));
}

export function easeInOut(a: number, b: number, p: number): number {
  return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
}

export function easeInP(p: number): number {
  return p * p;
}

export function easeOutP(p: number): number {
  return 1 - (1 - p) * (1 - p);
}

export function easeInOutP(p: number): number {
  return -Math.cos(p * Math.PI) / 2 + 0.5;
}

/** Wrap v into [0, total). */
export function wrap(v: number, total: number): number {
  const m = v % total;
  return m < 0 ? m + total : m;
}
