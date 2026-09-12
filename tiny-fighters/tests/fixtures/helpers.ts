import type { Fighter } from "../../src/sim/types";
import { createBuffer } from "../../src/sim/inputBuffer";

let nextId = 1;
export function makeFighter(over: Partial<Fighter> = {}): Fighter {
  return {
    id: nextId++, slot: 0, team: "independent", isBot: false,
    charId: "brawler", x: 800, y: 0, z: 60,
    vx: 0, vy: 0, vz: 0, facing: 1,
    state: "idle", stateTick: 0,
    hp: 240, mp: 100,
    invulnUntilTick: 0,
    hitIds: new Set(), comboCount: 0, comboLastTick: -999,
    buffer: createBuffer(),
    ...over,
  };
}
