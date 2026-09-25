/**
 * Finite-state machine for the game flow.
 *
 * Table: menu → levelSelect → playing → { paused | complete | gameover };
 * levelSelect and paused and the end states retry into playing or quit to
 * menu. Illegal transitions throw — a silent bad transition would corrupt the
 * whole run.
 */

export type GameStateName = 'menu' | 'levelSelect' | 'playing' | 'paused' | 'complete' | 'gameover';

type TransitionTable = Readonly<Record<GameStateName, readonly GameStateName[]>>;

const TRANSITIONS: TransitionTable = {
  menu: ['playing', 'levelSelect'],
  levelSelect: ['playing', 'menu'],
  playing: ['paused', 'complete', 'gameover'],
  paused: ['playing', 'menu'],
  complete: ['playing', 'menu'],
  gameover: ['playing', 'menu'],
};

export type StateListener = (state: GameStateName) => void;

export class GameState {
  private state: GameStateName = 'menu';
  private readonly listeners = new Set<StateListener>();

  public get name(): GameStateName {
    return this.state;
  }

  public get isPlaying(): boolean {
    return this.state === 'playing';
  }

  /**
   * Moves to `next` if the transition is legal, then notifies listeners.
   * Throws on an illegal transition — with the current and requested state.
   */
  public transition(next: GameStateName): void {
    const allowed = TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      throw new Error(`GameState: illegal transition ${this.state} → ${next}`);
    }
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
  }

  /** → playing: from the menu, level select, the results, or game over. */
  public start(): void {
    this.transition('playing');
  }

  /** menu → levelSelect: the player opened the campaign list. */
  public toLevelSelect(): void {
    this.transition('levelSelect');
  }

  /** playing → complete: the run reached the finish banner. */
  public complete(): void {
    this.transition('complete');
  }

  /** playing → gameover: Turbo was knocked off (slug contact, or a gap fall in Phase 4). */
  public gameOver(): void {
    this.transition('gameover');
  }

  /** playing → paused (Esc). The simulation simply stops stepping the run. */
  public pause(): void {
    this.transition('paused');
  }

  /** paused → playing (Esc / confirm). */
  public resume(): void {
    this.transition('playing');
  }

  /** levelSelect / paused / complete / gameover → menu. */
  public toMenu(): void {
    this.transition('menu');
  }

  /** Subscribes to state changes; returns an unsubscribe function. */
  public onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
