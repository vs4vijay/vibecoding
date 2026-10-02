/**
 * @file core/events.js
 * Tiny synchronous event bus (wave 5).
 *
 * RunController owns an instance (`run.events`) and EMITS gameplay moments;
 * the VFX system and the audio manager SUBSCRIBE in main.js. Keeping this a
 * plain pub/sub (no globals, no DOM events) preserves determinism: emit() is
 * a pure notification — subscribers do their own bookkeeping, and everything
 * a subscriber reads (particle pools, audio queues) is driven from the fixed
 * simulation step.
 *
 * Interface is ADDITIVE: nothing else in run.js changes shape.
 */

export class Emitter {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe. @param {string} event @param {Function} fn
   * @returns {() => void} Unsubscribe.
   */
  on(event, fn) {
    let list = this._handlers.get(event);
    if (!list) {
      list = [];
      this._handlers.set(event, list);
    }
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * Emit. Handler exceptions are isolated so a VFX/audio bug can never kill
   * the simulation loop (and headless QA captures stay alive).
   * @param {string} event
   * @param {...*} args
   */
  emit(event, ...args) {
    const list = this._handlers.get(event);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](...args);
      } catch (err) {
        console.warn(`events: handler for '${event}' threw`, err);
      }
    }
  }
}
