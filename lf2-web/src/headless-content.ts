// src/headless-content.ts — disk-backed content injection for HEADLESS mode.
// Bun reads the authored JSON directly, so the replay runner needs no fetch
// and no dev server (spec §4 testing strategy).
import { CHARACTER_FILES, STAGE_FILES } from "./content/loader";

export default async function fetchInject(): Promise<Record<string, unknown>> {
  const inject: Record<string, unknown> = {};
  for (const id of CHARACTER_FILES) {
    inject[`characters/${id}.json`] = JSON.parse(
      await Bun.file(`src/data/characters/${id}.json`).text(),
    );
  }
  for (const id of STAGE_FILES) {
    inject[`stages/${id}.json`] = JSON.parse(
      await Bun.file(`src/data/stages/${id}.json`).text(),
    );
  }
  inject["weapons.json"] = await Bun.file("src/data/weapons.json").json();
  inject["items.json"] = await Bun.file("src/data/items.json").json();
  return inject;
}
