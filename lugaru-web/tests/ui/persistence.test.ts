// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadBests, saveBest } from '../../src/ui/persistence';

const LS_KEY = 'lugaru-best-scores';

describe('persistence — localStorage best scores', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('empty storage → loadBests returns null', () => {
    expect(loadBests()).toBeNull();
  });

  it('roundtrips: save then load', () => {
    expect(saveBest('normal', 533)).toBe(true);
    expect(loadBests()).toEqual({ normal: 533 });
  });

  it('multiple difficulties accumulated', () => {
    saveBest('easy', 120);
    saveBest('normal', 440);
    saveBest('hard', 770);
    expect(loadBests()).toEqual({ easy: 120, normal: 440, hard: 770 });
  });

  it('only overwrites when new score is higher', () => {
    saveBest('normal', 400);
    saveBest('normal', 600);
    expect(loadBests()).toEqual({ normal: 600 });
    saveBest('normal', 300); // lower — should not overwrite
    expect(loadBests()).toEqual({ normal: 600 });
  });

  it('corrupt JSON in localStorage → loadBests returns null', () => {
    localStorage.setItem(LS_KEY, '{corrupt!!!');
    expect(loadBests()).toBeNull();
  });

  it('saveBest returns false when setItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(saveBest('hard', 999)).toBe(false);
    spy.mockRestore();
  });
});

describe('persistence — localStorage unavailable', () => {
  let savedDescriptor: PropertyDescriptor | undefined;
  let savedLocalStorage: Storage | undefined;
  beforeEach(() => {
    savedLocalStorage = globalThis.localStorage;
    // Store the original property descriptor
    savedDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    // Remove localStorage so try/catch in persistence.ts hits the catch path
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
  });
  afterEach(() => {
    if (savedDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', savedDescriptor);
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        value: savedLocalStorage,
        configurable: true,
        writable: true,
      });
    }
  });

  it('loadBests returns null, saveBest returns false when localStorage is undefined', () => {
    expect(loadBests()).toBeNull();
    expect(saveBest('normal', 533)).toBe(false);
  });
});
