import type { InputFrame } from "./types";

export type Token = "D" | "<" | ">" | "^" | "v" | "A" | "J";

const RING_SIZE = 12;
const LOG_CAP = 24;
const NEUTRAL = (): InputFrame => ({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } });

export interface PressRecord { token: Token; tick: number }

/** Plain-data capture of the whole buffer — closures cannot survive structuredClone. */
export interface BufferSnapshot { ring: InputFrame[]; log: PressRecord[] }

export interface FighterBuffer {
  push(frame: InputFrame, tick: number): void;
  held(): InputFrame;
  pressLog(): PressRecord[];
  clear(): void;
  /** Deep copy; safe to hold while the source keeps ticking. */
  serialize(): BufferSnapshot;
  /** Replace contents with (copies of) a snapshot. */
  restore(snapshot: BufferSnapshot): void;
}

function edges(prev: InputFrame, cur: InputFrame): Token[] {
  const out: Token[] = [];
  if (cur.a && !prev.a) out.push("A");
  if (cur.j && !prev.j) out.push("J");
  if (cur.dir.x === -1 && prev.dir.x !== -1) out.push("<");
  if (cur.dir.x === 1 && prev.dir.x !== 1) out.push(">");
  if (cur.dir.z === -1 && prev.dir.z !== -1) out.push("^");
  if (cur.dir.z === 1 && prev.dir.z !== 1) out.push("v");
  if (cur.dHeld && !prev.dHeld) out.push("D");
  return out;
}

export function createBuffer(size = RING_SIZE): FighterBuffer {
  let ring: InputFrame[] = [];
  let log: PressRecord[] = [];
  return {
    push(cur, tick) {
      const prev = ring.length > 0 ? ring[ring.length - 1]! : NEUTRAL();
      const tokens = edges(prev, cur).map((token) => ({ token, tick }));
      if (tokens.length > 0) log.unshift(...tokens);
      if (log.length > LOG_CAP) log.length = LOG_CAP;
      ring.push(cur);
      if (ring.length > size) ring.shift();
    },
    held: () => ring[ring.length - 1] ?? NEUTRAL(),
    pressLog: () => log,
    clear() { ring = []; log = []; },
    serialize(): BufferSnapshot {
      return {
        ring: ring.map((f) => ({ ...f, dir: { ...f.dir } })),
        log: log.map((r) => ({ ...r })),
      };
    },
    restore(snapshot: BufferSnapshot) {
      ring = snapshot.ring.map((f) => ({ ...f, dir: { ...f.dir } }));
      log = snapshot.log.map((r) => ({ ...r }));
    },
  };
}
