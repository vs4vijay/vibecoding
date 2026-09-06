type Handler<Args extends unknown[]> = (...args: Args) => void;

export class Emitter<Events extends Record<string, unknown[]>> {
  #handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

  /** Subscribe; returns an off() that removes this handler. */
  on<K extends keyof Events>(event: K, fn: Handler<Events[K]>): () => void {
    let set = this.#handlers[event];
    if (!set) {
      set = new Set();
      this.#handlers[event] = set;
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  /** Invoke every handler for `event` with `args`; snapshot guards mutation during emit. */
  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.#handlers[event];
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }
}
