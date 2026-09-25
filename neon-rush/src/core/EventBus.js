// Global event bus. Emit/consume, never poll.
// NOTE: hot events ('coin', 'near-miss', 'speed:change') reuse a shared payload
// object — handlers must read it synchronously, never retain it.
export class EventBus {
  constructor() {
    this.map = new Map();
  }

  on(event, fn) {
    let set = this.map.get(event);
    if (!set) { set = new Set(); this.map.set(event, set); }
    set.add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this.map.get(event);
    if (set) set.delete(fn);
  }

  emit(event, payload) {
    const set = this.map.get(event);
    if (set) for (const fn of set) fn(payload);
  }
}

export const bus = new EventBus();
