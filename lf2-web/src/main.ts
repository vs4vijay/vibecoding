// src/main.ts — the composition root (spec §1: sole cross-layer point).
// Browser boot: loadAllContent → error overlay on failure → createAudio →
// SceneManager on #ui → title scene; audio.unlock() on the first gesture.
// HEADLESS=1: run a replay file through stepWorld, print sha256 of the
// canonical final state to stdout (Refinement 5 / Task 14 consumes this).
import { loadAllContent, ContentLoadError } from "./content/loader";
import { spawnMatch, stepWorld } from "./sim/world";
import { canonicalReplacer } from "./sim/canonical";
import fetchInject from "./headless-content";
import type { InputFrame, SlotConfig } from "./sim/types";
import { createAudio } from "./audio/audio";
import { SceneManager, type SceneCtx } from "./ui/scene-manager";
import { createSceneCtx, type SceneFactories } from "./ui/context";
import { createLoop } from "./ui/loop";
import { createTitleScene } from "./ui/scenes/title";
import { createModeScene } from "./ui/scenes/mode";
import { createSelectScene } from "./ui/scenes/select";
import { createStageSelectScene } from "./ui/scenes/stage-select";
import { createBattleScene } from "./ui/scenes/battle";
import { createResultsScene } from "./ui/scenes/results";
import { loadAtlas } from "./render/atlas";
import type { Assets } from "./render/types";

const TICK_MS = 1000 / 60;

main().catch((e) => {
  console.error(e);
  bootErrorOverlay(asContentError(e));
  if (typeof process !== "undefined") process.exit(1);
});

async function main(): Promise<void> {
  if (typeof process !== "undefined" && process.env.HEADLESS === "1") {
    await headlessMain();
    return;
  }

  // --- content ---------------------------------------------------------------
  let cache;
  try {
    cache = await loadAllContent();
  } catch (e) {
    if (e instanceof ContentLoadError) bootErrorOverlay(e);
    else throw e;
    return;
  }
  const simContext = { sheets: cache.sheets, weapons: cache.weapons, items: cache.items };

  // --- audio -----------------------------------------------------------------
  const audio = createAudio();
  const unlock = (): void => {
    void audio.unlock();
    globalThis.document.removeEventListener("pointerdown", unlock);
    globalThis.document.removeEventListener("keydown", unlock);
  };
  globalThis.document.addEventListener("pointerdown", unlock);
  globalThis.document.addEventListener("keydown", unlock);

  // --- scenes ----------------------------------------------------------------
  const host = document.getElementById("ui");
  if (host === null) throw new Error("main: #ui host missing");
  const sm = new SceneManager();
  const factories: SceneFactories = {
    title: () => createTitleScene(),
    mode: () => createModeScene(),
    select: () => createSelectScene(),
    "stage-select": () => createStageSelectScene(),
    battle: () => createBattleScene(() => ({ ctx: simContext, stages: cache.stages }), loadBattleArt),
    results: () => createResultsScene(),
  };
  const ctx = createSceneCtx(sm, audio, factories);
  sm.mount(host, ctx);
  ctx.goto("title");

  // UI ticker: scenes get update(dt) for animation/polling; the manager gets
  // draw() for its transition fade veil. The battle scene runs its own loop
  // for the sim — two rAF loops coexist (the browser coalesces frames).
  const uiLoop = createLoop({
    tickMs: TICK_MS,
    maxCatchUpMs: 250,
    update: () => sm.update(TICK_MS),
    render: () => sm.draw(),
  });
  uiLoop.start();
}

/** Per-category battle atlases (§3.6): relative URLs work in dev and build. */
async function loadBattleArt(): Promise<Omit<Assets, "sheets" | "stages">> {
  const [fighters, props, fx, bg] = await Promise.all([
    loadAtlas("assets/atlas/fighters.png", "assets/atlas/fighters.json"),
    loadAtlas("assets/atlas/props.png", "assets/atlas/props.json"),
    loadAtlas("assets/atlas/fx.png", "assets/atlas/fx.json"),
    loadAtlas("assets/atlas/bg.png", "assets/atlas/bg.json"),
  ]);
  return { fighters, props, fx, bg };
}

/** §4 failure handling: full-screen overlay naming the file + reason; Reload. */
function bootErrorOverlay(error: ContentLoadError): void {
  const host = document.getElementById("ui");
  if (host === null) return;
  host.innerHTML = "";
  const root = document.createElement("div");
  root.style.cssText =
    "position:absolute;inset:0;background:#300018;color:#fff;display:flex;" +
    "flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;";
  const title = document.createElement("div");
  title.textContent = "CONTENT LOAD FAILED";
  title.style.fontSize = "28px";
  const detail = document.createElement("pre");
  detail.style.cssText = "max-width:80ch;white-space:pre-wrap;color:#f99;font-size:12px;";
  detail.textContent = error.errors
    .map((e) => `${e.file} :: ${e.pointer} — ${e.message}`)
    .join("\n");
  const reload = document.createElement("button");
  reload.textContent = "RELOAD";
  reload.style.cssText = "font-size:18px;padding:8px 24px;cursor:pointer;";
  reload.addEventListener("click", () => location.reload());
  root.append(title, detail, reload);
  host.appendChild(root);
}

/** Coerce any boot throw into a ContentLoadError-shaped overlay payload. */
function asContentError(e: unknown): ContentLoadError {
  if (e instanceof ContentLoadError) return e;
  const message = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  return new ContentLoadError([{ file: "boot", pointer: "", message }]);
}
// --- HEADLESS replay runner (determinism gate for Task 14) ----------------------

interface ReplayFile {
  seed: number;
  stageId: string;
  slots: SlotConfig[];
  inputs: Array<Array<Partial<InputFrame>>>;
}

async function headlessMain(): Promise<void> {
  const args = process.argv.slice(2);
  const i = args.indexOf("--replay");
  const path = i >= 0 ? args[i + 1] : undefined;
  if (path === undefined) {
    console.error("HEADLESS=1 requires --replay <file.json>");
    process.exit(1);
  }
  const [replay, inject] = await Promise.all([
    Bun.file(path).json() as Promise<ReplayFile>,
    fetchInject(),
  ]);
  const cache = await loadAllContent(inject);
  if (cache.errors.length > 0) {
    console.error("content errors", cache.errors);
    process.exit(1);
  }
  const stage = cache.stages.get(replay.stageId);
  if (stage === undefined) {
    console.error(`unknown stage "${replay.stageId}"`);
    process.exit(1);
  }
  let world = spawnMatch({
    seed: replay.seed,
    stage,
    slots: replay.slots,
    sheets: cache.sheets,
  });
  const neutral: InputFrame = { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };
  for (const tickInputs of replay.inputs) {
    if (world.over) break;
    const inputs = tickInputs.map((f): InputFrame => ({
      a: f.a ?? false,
      j: f.j ?? false,
      dHeld: f.dHeld ?? false,
      dir: { x: (f.dir?.x ?? 0) as -1 | 0 | 1, z: (f.dir?.z ?? 0) as -1 | 0 | 1 },
    }));
    while (inputs.length < world.fighters.length) inputs.push(neutral);
    ({ state: world } = stepWorld(world, inputs, {
      sheets: cache.sheets, weapons: cache.weapons, items: cache.items,
    }));
  }
  // Canonical form: object keys sorted at every depth; live buffers serialized.
  const json = JSON.stringify(world, canonicalReplacer);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(json);
  process.stdout.write(hasher.digest("hex") + "\n");
}
