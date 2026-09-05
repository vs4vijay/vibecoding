/**
 * F3-toggled on-screen debug readout. Updates twice per second (500ms),
 * independent of the render loop's frame count.
 */
export class DebugStats {
    el;
    /** Live score provider (Task 14) — shown when present. */
    scoreFn;
    visible = false;
    frames = 0;
    msLeft = 0;
    fps = 0;
    constructor(parent, scoreFn) {
        this.scoreFn = scoreFn ?? null;
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
    toggle(force) {
        this.visible = force ?? !this.visible;
        this.el.style.display = this.visible ? 'block' : 'none';
        if (!this.visible)
            this.el.textContent = '';
    }
    get isVisible() {
        return this.visible;
    }
    /** Feed one rendered frame; internally accumulates to a 2Hz refresh. */
    frame(realDtMs) {
        if (!this.visible)
            return;
        this.frames++;
        this.msLeft -= realDtMs;
        if (this.msLeft <= 0) {
            const span = 500 - this.msLeft; // actual elapsed, robust to hitches
            this.fps = Math.round((this.frames * 1000) / span);
            this.frames = 0;
            this.msLeft = 500;
            this.el.textContent =
                this.scoreFn !== null ? `fps: ${this.fps}\nscore: ${this.scoreFn()}` : `fps: ${this.fps}`;
        }
    }
}
