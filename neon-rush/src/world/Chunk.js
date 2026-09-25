import { Group } from 'three';

// Lane x positions (contract): x = -2.6, 0, +2.6. Lane index 0,1,2.
export const LANE_X = [-2.6, 0, 2.6];
export const laneX = (i) => LANE_X[i];

// A 60 m slice of track. Obstacles (pooled, owned by Obstacles module) and
// decorations attach here. Decorators (Track.decorate registrants, W1-VIS)
// must add objects via attach() so recycling can clean them up; if a
// decoration carries its own pool, set obj.userData.onRelease = (obj) => {...}.
export class Chunk {
  constructor(index) {
    this.index = index;
    this.group = new Group();
    this.baseZ = 0;          // world z of the chunk's near edge at scroll = baseZ + track.scroll
    this.safeLane = 1;       // guaranteed-clear lane entering this chunk
    this.spawnables = [];    // obstacle records spawned inside (managed by Obstacles)
    this.attached = [];      // decoration objects added via attach()
    this.pattern = '';
  }

  attach(obj) {
    this.group.add(obj);
    this.attached.push(obj);
  }

  // Clears decorations only — obstacle records are released by
  // Obstacles.releaseAllFor(chunk) BEFORE reset() is called by Track.
  reset() {
    for (let i = 0; i < this.attached.length; i++) {
      const o = this.attached[i];
      this.group.remove(o);
      const rel = o.userData && o.userData.onRelease;
      if (rel) rel(o);
    }
    this.attached.length = 0;
    this.spawnables.length = 0;
    this.safeLane = 1;
    this.pattern = '';
  }
}
