import { describe, expect, it } from 'vitest';

import { Input } from '../src/core/Input';

/**
 * Menu navigation edges (Phase 5 level select): up/down (+ left/right) move
 * the cursor, Backspace backs out — same consume-once model as confirm.
 */

/** Minimal event-target stand-in that records listeners and dispatches codes. */
class FakeTarget {
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  public addEventListener(type: string, listener: (event: Event) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public key(code: string, repeat = false): void {
    const event = { code, repeat, preventDefault: () => undefined } as unknown as Event;
    for (const listener of this.listeners.get('keydown') ?? []) listener(event);
    for (const listener of this.listeners.get('keyup') ?? []) listener(event);
  }

  /** Sends keydown only — the key stays held until `release` is called. */
  public press(code: string, repeat = false): void {
    const event = { code, repeat, preventDefault: () => undefined } as unknown as Event;
    for (const listener of this.listeners.get('keydown') ?? []) listener(event);
  }

  /** Sends keyup only. */
  public release(code: string): void {
    const event = { code, repeat: false, preventDefault: () => undefined } as unknown as Event;
    for (const listener of this.listeners.get('keyup') ?? []) listener(event);
  }

  public pointerDown(): void {
    for (const listener of this.listeners.get('pointerdown') ?? []) listener(new Event('pointerdown'));
  }
}

function press(input: Input, target: FakeTarget, code: string, repeat = false): void {
  target.key(code, repeat);
  input.consumeConfirm();
  input.consumeNavigate();
  input.consumeBack();
  input.consumeMute();
}

describe('Input menu navigation edges', () => {
  it('down/right queue +1, up/left queue -1 (W/S included)', () => {
    const target = new FakeTarget();
    const input = new Input(target as unknown as ConstructorParameters<typeof Input>[0]);

    target.key('ArrowDown');
    expect(input.consumeNavigate()).toBe(1);
    expect(input.consumeNavigate()).toBe(0); // consumed once

    target.key('KeyS');
    expect(input.consumeNavigate()).toBe(1);
    target.key('KeyW');
    expect(input.consumeNavigate()).toBe(-1);
    target.key('ArrowRight');
    expect(input.consumeNavigate()).toBe(1);
    target.key('ArrowLeft');
    expect(input.consumeNavigate()).toBe(-1);
    input.dispose();
  });

  it('rapid presses accumulate into a net step count', () => {
    const target = new FakeTarget();
    const input = new Input(target as unknown as ConstructorParameters<typeof Input>[0]);

    target.key('ArrowDown');
    target.key('ArrowDown');
    target.key('ArrowUp');
    expect(input.consumeNavigate()).toBe(1);
    input.dispose();
  });

  it('held keys do not auto-repeat (one press = one row)', () => {
    const target = new FakeTarget();
    const input = new Input(target as unknown as ConstructorParameters<typeof Input>[0]);

    target.key('ArrowDown', true); // OS key-repeat event
    expect(input.consumeNavigate()).toBe(0);
    target.key('ArrowDown'); // real press still registers afterwards
    expect(input.consumeNavigate()).toBe(1);
    input.dispose();
  });

  it('Backspace queues the back edge exactly once', () => {
    const target = new FakeTarget();
    const input = new Input(target as unknown as ConstructorParameters<typeof Input>[0]);

    expect(input.consumeBack()).toBe(false);
    target.key('Backspace');
    expect(input.consumeBack()).toBe(true);
    expect(input.consumeBack()).toBe(false);
    input.dispose();
  });

  it('the existing confirm/pause/mute edges are untouched by navigation', () => {
    const target = new FakeTarget();
    const input = new Input(target as unknown as ConstructorParameters<typeof Input>[0]);

    target.key('Enter');
    expect(input.consumeConfirm()).toBe(true);
    target.key('Escape');
    expect(input.consumePause()).toBe(true);
    target.key('KeyM');
    expect(input.consumeMute()).toBe(true);
    target.pointerDown();
    expect(input.consumeConfirm()).toBe(true);

    // Arrow keys never leak into confirm/pause.
    press(input, target, 'ArrowUp');
    expect(input.consumeConfirm()).toBe(false);
    expect(input.consumePause()).toBe(false);
    input.dispose();
  });

  it('steering (arrows + WASD) and fire (Z/Space) work simultaneously', () => {
    const target = new FakeTarget();
    const input = new Input(target as unknown as ConstructorParameters<typeof Input>[0]);

    // Both steering families held together cancel out (net axis 0) while fire
    // stays held — exactly the mixed-key layout a player ends up using.
    target.press('ArrowLeft');
    target.press('KeyD');
    target.press('KeyZ');
    expect(input.lateral).toBe(0);
    expect(input.isFireHeld).toBe(true);

    // Releasing one left source leaves the other: full right + still firing.
    target.release('ArrowLeft');
    expect(input.lateral).toBe(1);
    expect(input.isFireHeld).toBe(true);

    // Either fire source alone keeps firing; Z down, Space up or reverse.
    target.press('Space');
    target.release('KeyZ');
    expect(input.isFireHeld).toBe(true);
    target.release('Space');
    expect(input.isFireHeld).toBe(false);

    // WASD steers on its own (release the earlier KeyD first).
    target.release('KeyD');
    target.press('KeyA');
    expect(input.lateral).toBe(-1);
    target.press('KeyD');
    expect(input.lateral).toBe(0);
    input.dispose();
  });

  it('releaseAll drops held keys and queued edges (window blur hygiene)', () => {
    const target = new FakeTarget();
    const input = new Input(target as unknown as ConstructorParameters<typeof Input>[0]);

    target.press('ArrowLeft');
    target.press('Space');
    target.press('Enter');
    target.press('Escape');
    expect(input.lateral).toBe(-1);
    expect(input.isFireHeld).toBe(true);

    input.releaseAll();

    // Nothing is held anymore, and the queued confirm/pause edges were
    // dropped — refocusing the window must never act as a button press.
    expect(input.lateral).toBe(0);
    expect(input.isFireHeld).toBe(false);
    expect(input.consumeConfirm()).toBe(false);
    expect(input.consumePause()).toBe(false);
    expect(input.consumeNavigate()).toBe(0);
    input.dispose();
  });
});
