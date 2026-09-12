// tests/golden/replay.test.ts
// Golden determinism pin: run the committed replay through the PUBLIC sim API
// and hash the canonical final state. If this test fails after a sim edit,
// determinism broke — do NOT regenerate the hash without understanding why.
// Expected-failure check (run once after first creating the pin): flip the
// priority sort in src/sim/hitdetect.ts to ascending → this test must FAIL →
// revert with `git checkout -- src/sim/hitdetect.ts`.
import { describe, test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { spawnMatch, stepWorld } from "../../src/sim/world";
import type { SimContext } from "../../src/sim/world";
import { loadAllContent } from "../../src/content/loader";
import fetchInject from "../../src/headless-content";
import { canonicalReplacer } from "../../src/sim/canonical";
import type { InputFrame } from "../../src/sim/types";

const HASH_PATH = "tests/golden/match-001.sha256";

async function runReplay(): Promise<string> {
  const cache = await loadAllContent(await fetchInject());
  if (cache.errors.length > 0) throw new Error("content errors: " + JSON.stringify(cache.errors));
  const replay = (await Bun.file("tests/fixtures/replay-001.json").json()) as {
    seed: number; stageId: string;
    slots: Parameters<typeof spawnMatch>[0]["slots"];
    inputs: Array<Array<Partial<InputFrame>>>;
  };
  const stage = cache.stages.get(replay.stageId);
  if (stage === undefined) throw new Error(`unknown stage ${replay.stageId}`);
  let w = spawnMatch({ seed: replay.seed, stage, slots: replay.slots, sheets: cache.sheets });
  const ctx: SimContext = { sheets: cache.sheets, weapons: cache.weapons, items: cache.items };
  const neutral: InputFrame = { a: false, j: false, dHeld: false, dir: { x: 0, z: 0 } };
  for (const tickInputs of replay.inputs) {
    if (w.over) break;
    const inputs = tickInputs.map((f): InputFrame => ({
      a: f.a ?? false, j: f.j ?? false, dHeld: f.dHeld ?? false,
      dir: { x: (f.dir?.x ?? 0) as -1 | 0 | 1, z: (f.dir?.z ?? 0) as -1 | 0 | 1 },
    }));
    while (inputs.length < w.fighters.length) inputs.push(neutral);
    ({ state: w } = stepWorld(w, inputs, ctx));
  }
  return createHash("sha256").update(JSON.stringify(w, canonicalReplacer)).digest("hex");
}

describe("golden replay", () => {
  test("1200-tick scripted brawler-vs-swordsman match hashes stably", async () => {
    const hash = await runReplay();
    if (process.env.GOLDEN_WRITE === "1") {
      await Bun.write(HASH_PATH, hash + "\n");
      console.log("golden hash written:", hash);
    }
    expect(hash).toBe((await Bun.file(HASH_PATH).text()).trim());
  });

  test("HEADLESS runner agrees with the pinned hash", async () => {
    const proc = Bun.spawnSync({
      cmd: ["bun", "src/main.ts", "--replay", "tests/fixtures/replay-001.json"],
      env: { ...process.env, HEADLESS: "1" },
      stdout: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString().trim()).toBe((await Bun.file(HASH_PATH).text()).trim());
  });
});
