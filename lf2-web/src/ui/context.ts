// src/ui/context.ts — the ONE SceneCtx handed to every scene.
// goto(title, arg) delivers `arg` via ctx.gotoArg, which scenes read in
// enter(). History: main.ts used to write sm.gotoArg while scenes read
// ctx.gotoArg, so every payload (MatchSetup, MatchOutcome) was silently
// dropped and the flow dead-ended at character select. This factory makes
// the delivery path unit-testable so the two wirings cannot diverge again.
import type { AudioBridge, SceneManager, Scene, SceneCtx } from "./scene-manager";

export type SceneTitle = "title" | "mode" | "select" | "stage-select" | "battle" | "results";

export type SceneFactories = Record<SceneTitle, () => Scene>;

export function createSceneCtx(sm: SceneManager, audio: AudioBridge, factories: SceneFactories): SceneCtx {
  const ctx: SceneCtx = {
    sm,
    audio,
    gotoArg: undefined,
    goto(title, arg) {
      ctx.gotoArg = arg;
      sm.replace(factories[title]());
    },
    quit() {
      globalThis.window?.close();
    },
  };
  return ctx;
}
