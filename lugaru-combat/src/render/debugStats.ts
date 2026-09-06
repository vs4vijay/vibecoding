/**
 * F3-toggled on-screen debug readout. Updates twice per second (500ms),
 * independent of the render loop's frame count.
 *
 * Includes p95 frame-time metric computed from a preallocated ring buffer —
 * zero per-frame allocations.
 */
export class DebugStats {
  private readonly el: HTMLDivElement;
  /** Live score provider (Task 14) — shown when present. */
  private readonly scoreFn: (() => number) | null;
  /** Extra dev lines (wind, wall probe, lastHeard) — shown when present. */
  private readonly infoFn: (() => string) | null;
  private visible = false;
  private frames = 0;
  private msLeft = 0;
  private fps = 0;

  // P95 frame-time ring buffer (no alloc).
  private readonly ftBuf = new Float32Array(240);
  private ftIdx = 0;
  private ftCount = 0;
  private readonly ftScratch = new Float32Array(240);

  constructor(parent: HTMLElement, scoreFn?: () => number, infoFn?: () => string) {
    this.scoreFn = scoreFn ?? null;
    this.infoFn = infoFn ?? null;
    this.el = document.createElement('div');
    this.el.id = 'debug-stats';
    this.el.textContent = '';
    Object.assign(this.el.style, {
      position: 'absolute',
      top: '8px',
      left: '8px',
      padding: '6px 10px',
      font: '12px/1.5 ui-monospace, monospace',
      color: '#eee',
      background: 'rgba(0,0,0,0.55)',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '50',
    });
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    if (!this.visible) this.el.textContent = '';
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Feed one rendered frame; internally accumulates to a 2Hz refresh. */
  frame(realDtMs: number): void {
    if (!this.visible) return;

    // Record frame time for p95.
    this.ftBuf[this.ftIdx] = realDtMs;
    this.ftIdx = (this.ftIdx + 1) % this.ftBuf.length;
    if (this.ftCount < this.ftBuf.length) this.ftCount++;

    this.frames++;
    this.msLeft -= realDtMs;
    if (this.msLeft <= 0) {
      const span = 500 - this.msLeft; // actual elapsed, robust to hitches
      this.fps = Math.round((this.frames * 1000) / span);
      this.frames = 0;
      this.msLeft = 500;
      const p95 = p95FrameTimeMs(this.ftBuf, this.ftCount, this.ftScratch);
      this.el.textContent =
        `fps: ${this.fps}` +
        (p95 !== null ? `  p95: ${p95.toFixed(1)}ms` : '') +
        (this.scoreFn !== null ? `\nscore: ${this.scoreFn()}` : '') +
        (this.infoFn !== null ? `\n${this.infoFn()}` : '');
    }
  }
}

/**
 * Compute 95th-percentile frame time from a ring buffer of samples.
 * `scratch` is a same-length Float32Array reused for sorting (zero-alloc).
 */
export function p95FrameTimeMs(
  samples: Float32Array,
  count: number,
  scratch: Float32Array,
): number | null {
  if (count === 0) return null;
  const n = Math.min(count, samples.length);
  scratch.set(samples.subarray(0, n));
  scratch.subarray(0, n).sort();
  const idx = Math.min(n - 1, Math.ceil(n * 0.95) - 1);
  return scratch[idx];
}
