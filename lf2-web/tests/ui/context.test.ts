// tests/ui/context.test.ts
import { describe, test, expect } from "bun:test";
import { makeFakeDocument, FakeElement } from "./fake-dom";
import { SceneManager, type Scene, type SceneCtx } from "../../src/ui/scene-manager";
import { createSceneCtx, type SceneFactories } from "../../src/ui/context";

let ctxAtEnter: SceneCtx | undefined;
function trackingScene(): Scene {
  return {
    enter(c?: SceneCtx) { ctxAtEnter = c; },
    exit() {},
    update() {},
    root: { style: {} } as unknown as HTMLElement,
  };
}

function makeFactories(): SceneFactories {
  return Object.fromEntries(
    (["title", "mode", "select", "stage-select", "battle", "results"] as const)
      .map((k) => [k, trackingScene]),
  ) as unknown as SceneFactories;
}

describe("createSceneCtx payload delivery", () => {
  test("goto stores arg on the SAME ctx object the entering scene reads", () => {
    globalThis.document = makeFakeDocument().doc as unknown as Document;
    const sm = new SceneManager();
    const ctx = createSceneCtx(sm, { onEvent() {}, playMusic() {}, toggleMute() { return false; } }, makeFactories());
    sm.mount(new FakeElement("div") as unknown as HTMLElement, ctx);

    const setup = { seed: 7 };
    ctx.goto("select", setup);
    expect(ctxAtEnter?.gotoArg).toBe(setup);          // identity, not deep-equal
  });

  test("goto without arg clears the previous payload", () => {
    globalThis.document = makeFakeDocument().doc as unknown as Document;
    const sm = new SceneManager();
    const ctx = createSceneCtx(sm, { onEvent() {}, playMusic() {}, toggleMute() { return false; } }, makeFactories());
    sm.mount(new FakeElement("div") as unknown as HTMLElement, ctx);

    ctx.goto("battle", { seed: 1 });
    expect(ctx.gotoArg).toEqual({ seed: 1 });
    ctx.goto("title");
    expect(ctx.gotoArg).toBeUndefined();
  });
});
