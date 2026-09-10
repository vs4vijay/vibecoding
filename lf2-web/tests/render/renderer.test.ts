import { describe, test, expect } from "bun:test";
import { createRenderer } from "../../src/render/renderer";
import { frameIndex } from "../../src/render/atlas";
import type { AtlasFrame, Assets } from "../../src/render/types";
import type { Fighter, WorldState } from "../../src/sim/types";
import type { FighterBuffer } from "../../src/sim/inputBuffer";
/** Records every drawImage/rect call so draw order can be asserted. */
class RecordingCtx {
  calls: string[] = [];
  imageSmoothingEnabled = true;
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  font = "";
  textAlign: CanvasTextAlign = "left";
  drawImage(): void { this.calls.push("blit"); }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push(`rect:${this.fillStyle}:${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`);
  }
  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}
  beginPath(): void {}
  ellipse(): void { this.calls.push("ring"); }
  stroke(): void {}
  fillText(): void { this.calls.push("text"); }
}

function frame(name: string): AtlasFrame {
  return { name, x: 0, y: 0, w: 48, h: 64 };
}

function makeAssets(overrides: Partial<Record<"fighters" | "props" | "fx" | "bg", string[]>> = {}): Assets {
  const image = { width: 1024, height: 1024 } as unknown as HTMLImageElement;
  const atlas = (keys?: string[]): Assets["fighters"] => ({
    image,
    frame: keys
      ? frameIndex(keys.map(frame))
      : (() => { throw new Error("missing frame"); }) as never,
  });
  return {
    fighters: atlas(overrides.fighters),
    props: atlas(overrides.props),
    fx: atlas(overrides.fx),
    bg: atlas(overrides.bg),
    sheets: new Map(),
    stages: new Map(),
  };
}


function fighter(partial: Partial<Fighter>): Fighter {
  const buffer: FighterBuffer = {
    push() {}, held: () => ({ a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } }),
    pressLog: () => [], clear() {},
    serialize: () => ({ ring: [], log: [] }) as never,
    restore() {},
  };
  return {
    id: 0, slot: 0, team: "independent", isBot: false,
    charId: "brawler",
    x: 800, y: 0, z: 60, vx: 0, vy: 0, vz: 0,
    facing: 1, state: "idle", stateTick: 0,
    hp: 100, mp: 50, invulnUntilTick: 0,
    hitIds: new Set<number>(), comboCount: 0, comboLastTick: -999,
    buffer,
    ...partial,
  };
}

function world(fighters: Fighter[]): WorldState {
  return {
    tick: 0, seed: 1, rngState: 1,
    stage: {
      id: "grassland-dojo",
      walls: { left: 0, right: 1600, restitution: 0.4 },
      bounds: { w: 1600, h: 480, d: 120 },
      drops: { firstDropTick: 600, intervalTicks: 900, intervalJitterTicks: 180, table: {} },
    },
    fighters, projectiles: [], pickups: [], nextEntityId: fighters.length, over: false,
  };
}

describe("renderer smoke (recording stub context)", () => {
  test("missing art draws magenta boxes without throwing and warns once", () => {
    const stub = new RecordingCtx();
    const ctx = stub as unknown as CanvasRenderingContext2D;
    const r = createRenderer();
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (m: string) => warns.push(m);
    r.draw(world([fighter({})]), ctx, makeAssets());
    console.warn = orig;
    expect(stub.calls.filter((c) => c.startsWith("rect:#FF00FF")).length).toBeGreaterThan(0);
    expect(warns.length).toBe(1); // once per missing key, not per frame
  });
  test("fighters blit back-to-front by ground z; only team fighters get a ring", () => {
    const stub = new RecordingCtx();
    const ctx = stub as unknown as CanvasRenderingContext2D;
    const r = createRenderer();
    r.draw(world([
      fighter({ charId: "brawler", z: 100 }),
      fighter({ charId: "ninja", z: 20, team: "blue" }),
    ]), ctx, makeAssets({ fighters: ["brawler_idle", "ninja_idle"] }));
    // The z=20 fighter sorts first; its ring is drawn under its sprite.
    const firstRing = stub.calls.indexOf("ring");
    const ninjaBlit = stub.calls.indexOf("blit");
    expect(firstRing).toBeGreaterThanOrEqual(0);
    expect(firstRing).toBeLessThan(ninjaBlit);
    expect(stub.calls.filter((c) => c === "ring").length).toBe(1);
  });

  test("HUD bars close the draw pass after all world sprites", () => {
    const stub = new RecordingCtx();
    const ctx = stub as unknown as CanvasRenderingContext2D;
    const r = createRenderer();
    r.draw(world([fighter({ team: "red" })]), ctx, makeAssets({ fighters: ["br_idle"] }));
    expect(stub.calls.lastIndexOf("ring")).toBeLessThan(stub.calls.indexOf("text"));
  });
});
