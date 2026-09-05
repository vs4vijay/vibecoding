/**
 * Pointer-lock input manager.
 *
 * Pure DOM event state — imports nothing from three/Rapier. All listeners are
 * bound once in the constructor (stable identity for cheap attach/detach);
 * attach(el) only registers them. sample() returns a preallocated InputFrame
 * mutated in place: look deltas and pressed edges clear per call, held/move
 * reflect live key/button state. Zero allocation after construction.
 */
export class InputManager {
    el = null;
    frame = {
        moveX: 0,
        moveZ: 0,
        lookDX: 0,
        lookDY: 0,
        pressed: { attack: false, jump: false, crouch: false },
        held: { attack: false, jump: false, crouch: false },
    };
    keysDown = new Set();
    pressedKeys = new Set();
    constructor() {
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onPointerLockChange = this.onPointerLockChange.bind(this);
        this.blur = this.blur.bind(this);
    }
    get isLocked() {
        return document.pointerLockElement === this.el;
    }
    attach(el) {
        this.detach();
        this.el = el;
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('pointerlockchange', this.onPointerLockChange);
        window.addEventListener('blur', this.blur);
        el.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('mousemove', this.onMouseMove);
    }
    detach() {
        const el = this.el;
        if (!el)
            return;
        this.el = null;
        this.keysDown.clear();
        this.pressedKeys.clear();
        this.frame.lookDX = 0;
        this.frame.lookDY = 0;
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('pointerlockchange', this.onPointerLockChange);
        window.removeEventListener('blur', this.blur);
        // Element may already be gone from the DOM; removal via captured
        // reference still works.
        el.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('mousemove', this.onMouseMove);
    }
    requestPointerLock() {
        try {
            const maybePromise = this.el?.requestPointerLock();
            // Chrome returns a Promise that rejects when the request fails (e.g.
            // lock lost too recently); swallow it — pointer-lock failure is normal.
            if (maybePromise instanceof Promise) {
                maybePromise.catch(() => { });
            }
        }
        catch {
            /* jsdom / unsupported browsers: pointer lock unavailable */
        }
    }
    /** Returns the shared InputFrame, clearing edge + look-delta state. */
    sample() {
        const f = this.frame;
        let mx = 0;
        let mz = 0;
        if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp'))
            mz -= 1;
        if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown'))
            mz += 1;
        if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft'))
            mx -= 1;
        if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight'))
            mx += 1;
        if (mx !== 0 && mz !== 0) {
            const inv = Math.SQRT1_2;
            mx *= inv;
            mz *= inv;
        }
        f.moveX = mx;
        f.moveZ = mz;
        f.pressed.jump = this.pressedKeys.has('Space');
        f.pressed.crouch = this.pressedKeys.has('ShiftLeft');
        f.pressed.attack = this.pressedButtons.has(0);
        f.held.attack = this.buttons.has(0);
        f.held.jump = this.keysDown.has('Space');
        f.held.crouch = this.keysDown.has('ShiftLeft');
        this.pressedKeys.clear();
        this.pressedButtons.clear();
        f.lookDX = this.accDX;
        f.lookDY = this.accDY;
        this.accDX = 0;
        this.accDY = 0;
        return f;
    }
    buttons = new Set();
    pressedButtons = new Set();
    accDX = 0;
    accDY = 0;
    onKeyDown(e) {
        if (e.repeat)
            return;
        if (!this.keysDown.has(e.code))
            this.pressedKeys.add(e.code);
        this.keysDown.add(e.code);
    }
    onKeyUp(e) {
        this.keysDown.delete(e.code);
    }
    onMouseDown(e) {
        if (!this.buttons.has(e.button))
            this.pressedButtons.add(e.button);
        this.buttons.add(e.button);
    }
    onMouseUp(e) {
        this.buttons.delete(e.button);
    }
    onMouseMove(e) {
        // Unlocked cursor movement over the page must not orbit the camera.
        if (!this.isLocked)
            return;
        this.accDX += e.movementX ?? 0;
        this.accDY += e.movementY ?? 0;
    }
    onPointerLockChange() {
        // State is derived (isLocked getter); nothing to do here. Loss must not
        // throw or log — the game simply keeps running unlocked.
        if (!this.isLocked) {
            this.accDX = 0;
            this.accDY = 0;
        }
    }
    /** Window blur: drop all held state so keys/buttons don't stick. */
    blur() {
        this.keysDown.clear();
        this.pressedKeys.clear();
        this.pressedButtons.clear();
        this.buttons.clear();
        this.accDX = 0;
        this.accDY = 0;
    }
}
