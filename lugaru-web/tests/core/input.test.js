// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../../src/core/input';
/** Dispatch a KeyboardEvent with the given type/code on document. */
function key(type, code) {
    document.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}
let el;
const input = new InputManager();
function mouse(type, init = {}) {
    // Bubbling mirrors real browsers: mouseup/mousemove must reach window.
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
}
describe('InputManager', () => {
    beforeEach(() => {
        el = document.createElement('div');
        document.body.appendChild(el);
        input.attach(el);
    });
    afterEach(() => {
        input.detach();
        el.remove();
    });
    it('idle sample returns zeroed frame and keeps same object identity', () => {
        const a = input.sample();
        const b = input.sample();
        expect(b).toEqual({
            moveX: 0,
            moveZ: 0,
            lookDX: 0,
            lookDY: 0,
            pressed: { attack: false, jump: false, crouch: false },
            held: { attack: false, jump: false, crouch: false },
        });
        expect(a).toBe(b); // preallocated frame mutated in place, zero alloc
    });
    it('mousedown presses attack edge once; held persists until mouseup', () => {
        mouse('mousedown', { button: 0 });
        let f = input.sample();
        expect(f.pressed.attack).toBe(true);
        f = input.sample(); // edges clear; button still held
        expect(f.pressed.attack).toBe(false);
        expect(f.held.attack).toBe(true);
        mouse('mouseup', { button: 0 });
        f = input.sample();
        expect(f.pressed.attack).toBe(false);
        expect(f.held.attack).toBe(false);
    });
    it('W+D normalizes move to (≈0.707, ≈-0.707)', () => {
        key('keydown', 'KeyW');
        key('keydown', 'KeyD');
        const f = input.sample();
        expect(f.moveX).toBeCloseTo(Math.SQRT1_2, 5);
        expect(f.moveZ).toBeCloseTo(-Math.SQRT1_2, 5);
        key('keyup', 'KeyW');
        key('keyup', 'KeyD');
    });
    it('arrows map like WASD, single axis unit / two axes normalized', () => {
        key('keydown', 'ArrowUp');
        expect(input.sample().moveZ).toBe(-1);
        key('keydown', 'ArrowLeft');
        const f = input.sample();
        expect(f.moveZ).toBeCloseTo(-Math.SQRT1_2, 5);
        expect(f.moveX).toBeCloseTo(-Math.SQRT1_2, 5);
        key('keyup', 'ArrowUp');
        key('keyup', 'ArrowLeft');
    });
    it('mousemove accumulates movementX/Y into lookDX/DY and clears on sample (while locked)', () => {
        lockTo(el);
        mouse('mousemove', { movementX: 12, movementY: -4 });
        mouse('mousemove', { movementX: -2, movementY: 6 });
        let f = input.sample();
        expect(f.lookDX).toBe(10);
        expect(f.lookDY).toBe(2);
        f = input.sample();
        expect(f.lookDX).toBe(0);
        expect(f.lookDY).toBe(0);
        unlock();
    });
    it('unlocked mousemove produces zero look delta', () => {
        expect(input.isLocked).toBe(false);
        mouse('mousemove', { movementX: 50, movementY: 25 });
        const f = input.sample();
        expect(f.lookDX).toBe(0);
        expect(f.lookDY).toBe(0);
    });
    it('pointer-lock loss clears pending look deltas', () => {
        lockTo(el);
        mouse('mousemove', { movementX: 30, movementY: -10 }); // pending
        unlock(); // fires pointerlockchange with cleared element
        const f = input.sample();
        expect(f.lookDX).toBe(0);
        expect(f.lookDY).toBe(0);
    });
    it('Space press+release mirrors attack edge/held semantics', () => {
        key('keydown', 'Space');
        let f = input.sample();
        expect(f.pressed.jump).toBe(true);
        expect(f.held.jump).toBe(true);
        key('keyup', 'Space');
        f = input.sample();
        expect(f.pressed.jump).toBe(false);
        expect(f.held.jump).toBe(false);
    });
    it('ShiftLeft keyup clears held.crouch', () => {
        key('keydown', 'ShiftLeft');
        expect(input.sample().held.crouch).toBe(true);
        key('keyup', 'ShiftLeft');
        expect(input.sample().held.crouch).toBe(false);
    });
    it('pointerlockchange flips isLocked; loss neither throws nor spams', () => {
        expect(input.isLocked).toBe(false);
        Object.defineProperty(document, 'pointerLockElement', {
            value: el,
            configurable: true,
        });
        document.dispatchEvent(new Event('pointerlockchange'));
        expect(input.isLocked).toBe(true);
        // Pointer-lock loss must not throw.
        Object.defineProperty(document, 'pointerLockElement', {
            value: null,
            configurable: true,
        });
        expect(() => document.dispatchEvent(new Event('pointerlockchange'))).not.toThrow();
        expect(input.isLocked).toBe(false);
    });
    /** Simulate acquiring pointer lock on `target` (jsdom has no impl). */
    function lockTo(target) {
        Object.defineProperty(document, 'pointerLockElement', {
            value: target,
            configurable: true,
        });
        document.dispatchEvent(new Event('pointerlockchange'));
    }
    /** Simulate losing pointer lock. */
    function unlock() {
        Object.defineProperty(document, 'pointerLockElement', {
            value: null,
            configurable: true,
        });
        document.dispatchEvent(new Event('pointerlockchange'));
    }
    it('requestPointerLock is safe when unsupported (jsdom)', () => {
        expect(() => input.requestPointerLock()).not.toThrow();
        expect(input.isLocked).toBe(false);
    });
    it('detach stops listening: events after detach are ignored', () => {
        input.detach();
        key('keydown', 'KeyA');
        mouse('mousemove', { movementX: 99, movementY: 0 });
        const f = input.sample();
        expect(f.moveX).toBe(0);
        expect(f.lookDX).toBe(0);
    });
    it('re-attach after detach works', () => {
        input.detach();
        input.attach(el);
        key('keydown', 'KeyS');
        expect(input.sample().moveZ).toBe(1);
    });
});
