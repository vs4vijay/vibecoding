import { describe, expect, it, vi } from 'vitest';

import { GameState } from '../src/core/GameState';

describe('GameState', () => {
  it('starts in menu and walks the legal happy path', () => {
    const game = new GameState();
    expect(game.name).toBe('menu');

    game.start();
    expect(game.name).toBe('playing');
    expect(game.isPlaying).toBe(true);

    game.complete();
    expect(game.name).toBe('complete');
    expect(game.isPlaying).toBe(false);
  });

  it('restarts from the completion screen back into playing', () => {
    const game = new GameState();
    game.start();
    game.complete();
    game.start(); // complete → playing
    expect(game.name).toBe('playing');

    game.complete();
    game.toMenu(); // complete → menu
    expect(game.name).toBe('menu');
  });

  it('throws on illegal transitions', () => {
    const game = new GameState();

    expect(() => game.complete()).toThrow(/menu → complete/);
    game.start();
    expect(() => game.toMenu()).toThrow(/playing → menu/); // pause lands in Phase 2
    game.complete();
    expect(() => game.start()).not.toThrow();
  });

  it('notifies listeners on every transition and supports unsubscribe', () => {
    const game = new GameState();
    const listener = vi.fn();
    const unsubscribe = game.onChange(listener);

    game.start();
    game.complete();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, 'playing');
    expect(listener).toHaveBeenNthCalledWith(2, 'complete');

    unsubscribe();
    game.start();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('pauses and resumes playing', () => {
    const game = new GameState();
    game.start();
    game.pause();
    expect(game.name).toBe('paused');
    expect(game.isPlaying).toBe(false);

    game.resume();
    expect(game.name).toBe('playing');
    expect(game.isPlaying).toBe(true);
  });

  it('walks the death → retry path through gameover', () => {
    const game = new GameState();
    game.start();
    game.gameOver();
    expect(game.name).toBe('gameover');
    expect(game.isPlaying).toBe(false);

    game.start(); // retry: gameover → playing
    expect(game.name).toBe('playing');

    game.gameOver();
    game.toMenu(); // gameover → menu
    expect(game.name).toBe('menu');
  });

  it('quits to menu from paused and results', () => {
    const game = new GameState();
    game.start();
    game.pause();
    game.toMenu();
    expect(game.name).toBe('menu');

    game.start();
    game.complete();
    game.toMenu();
    expect(game.name).toBe('menu');
  });

  it('rejects illegal Phase 2 transitions', () => {
    const game = new GameState();

    expect(() => game.gameOver()).toThrow(/menu → gameover/);
    expect(() => game.pause()).toThrow(/menu → paused/);

    game.start();
    expect(() => game.complete()).not.toThrow();
    game.start();

    game.pause();
    expect(() => game.complete()).toThrow(/paused → complete/);
    expect(() => game.gameOver()).toThrow(/paused → gameover/);
    game.resume();

    game.complete();
    expect(() => game.gameOver()).toThrow(/complete → gameover/);
    game.start();
  });

  it('walks menu → levelSelect → playing (Phase 5 level select)', () => {
    const game = new GameState();

    game.toLevelSelect();
    expect(game.name).toBe('levelSelect');
    expect(game.isPlaying).toBe(false);

    game.start(); // picking a level starts it directly
    expect(game.name).toBe('playing');

    // Back from playing is still illegal — level select is only reachable from the menu.
    game.pause();
    expect(() => game.toLevelSelect()).toThrow(/paused → levelSelect/);
  });

  it('level select backs out to the menu and rejects skipping the menu', () => {
    const game = new GameState();
    expect(() => game.toMenu()).toThrow(/menu → menu/);

    game.toLevelSelect();
    game.toMenu(); // Esc / Backspace from the list
    expect(game.name).toBe('menu');

    game.toLevelSelect();
    expect(() => game.complete()).toThrow(/levelSelect → complete/);
    expect(() => game.pause()).toThrow(/levelSelect → paused/);
    expect(() => game.gameOver()).toThrow(/levelSelect → gameover/);
  });

  it('levelSelect → menu → levelSelect is a repeatable loop', () => {
    const game = new GameState();
    game.toLevelSelect();
    game.toMenu();
    game.toLevelSelect();
    game.toMenu();
    expect(game.name).toBe('menu');
  });
});
