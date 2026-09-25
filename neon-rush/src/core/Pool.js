// Pre-allocating object pool. create() lazily; reset() runs on release so a
// pooled object is always handed out clean. Zero allocations in game loops.
const registry = [];

export class Pool {
  constructor(create, reset, name) {
    this.create = create;
    this.reset = reset || (() => {});
    this.free = [];
    this.used = 0;
    this.name = name || 'pool';
    registry.push(this);
  }

  get() {
    let obj = this.free.pop();
    if (obj === undefined) obj = this.create();
    this.used++;
    return obj;
  }

  release(obj) {
    this.reset(obj);
    this.free.push(obj);
    this.used--;
  }

  prewarm(n) {
    for (let i = 0; i < n; i++) this.free.push(this.create());
  }
}

Pool.all = registry;
Pool.totalObjects = () => {
  let n = 0;
  for (let i = 0; i < registry.length; i++) n += registry[i].free.length + registry[i].used;
  return n;
};
