import { describe, test, expect } from "bun:test";
import { validateCharacterSheet, validateStage, validateWeapons, validateItems } from "../../src/content/schema";
import { loadAllContent, ContentLoadError } from "../../src/content/loader";
import good from "../fixtures/good-brawler.json";
import badCancel from "../fixtures/bad-cancel.json";
import badKey from "../fixtures/bad-key.json";
import grasslandDojo from "../../src/data/stages/grassland-dojo.json";
import rooftopNight from "../../src/data/stages/rooftop-night.json";
import weaponsJson from "../../src/data/weapons.json";
import itemsJson from "../../src/data/items.json";

const CHAR_IDS = ["brawler", "swordsman", "fire-caster", "ice-caster", "ninja", "support-mage"] as const;

async function authoredFiles(): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    CHAR_IDS.map(async (id): Promise<[string, unknown]> => [
      `characters/${id}.json`,
      JSON.parse(await Bun.file(new URL(`../../src/data/characters/${id}.json`, import.meta.url)).text()),
    ]),
  );
  return Object.fromEntries(entries);
}

/** Minimal one-move sheet whose active-frame damage is a string. */
const badDamageType = {
  id: "brawler",
  maxHp: 240, maxMp: 100, mpRegenPerTick: 0.05,
  walkSpeed: 2.2, runSpeed: 5.0, jumpImpulse: -8.5,
  moves: {
    punch1: { frames: [
      { sprite: "br_p1_windup", durationTicks: 3, vx: 0.6, vy: 0, vz: 0 },
      { sprite: "br_p1_active", durationTicks: 4, vx: 1.4, vy: 0, vz: 0,
        cancelInto: ["punch2"],
        hitbox: { x: 26, y: -34, z: 0, w: 30, h: 18, d: 44,
          damage: "lots", knockback: { vx: 1.5, vy: 0 }, hitstunTicks: 14,
          type: "light", priority: 10 } },
      { sprite: "br_p1_recover", durationTicks: 5, vx: 0, vy: 0, vz: 0,
        cancelInto: ["punch2"] } ] },
  },
};

describe("character sheet validation", () => {
  test("accepts spec §3.2 brawler", () => {
    const errs = validateCharacterSheet(good, "good.json");
    expect(errs).toEqual([]);
  });

  test("rejects dangling cancelInto with pointer", () => {
    const errs = validateCharacterSheet(badCancel, "bad-cancel.json");
    expect(
      errs.some((e) => e.pointer.includes("cancelInto") && e.message.includes("punchX")),
    ).toBe(true);
  });

  test("closed schema rejects undeclared keys", () => {
    const errs = validateCharacterSheet(badKey, "bad-key.json");
    expect(errs.some((e) => e.message.includes("undeclared"))).toBe(true);
  });

  test("pointer addresses the exact offending field", () => {
    const errs = validateCharacterSheet(badDamageType, "ptr.json");
    expect(errs).toContainEqual(
      expect.objectContaining({
        pointer: "moves.punch1.frames[1].hitbox.damage",
        message: expect.stringContaining("integer"),
      }),
    );
  });
});

describe("stage/weapon/item validation", () => {
  test("accepts both authored stages verbatim shape", () => {
    expect(validateStage(grasslandDojo, "grassland-dojo.json")).toEqual([]);
    expect(validateStage(rooftopNight, "rooftop-night.json")).toEqual([]);
  });

  test("accepts weapons and items blocks", () => {
    expect(validateItems(itemsJson, "items.json")).toEqual([]);
  });

  test("rejects zero-durability heavy weapon with exact pointer", () => {
    const bad = {
      knife: { kind: "thrown", meleeDamage: 12, throwDamage: 28, throwVy: -4.0,
        durability: 0, breakOnThrowImpact: true, carrierSpeedMul: 1.0, repickupDelayTicks: 20 },
    };
    const errs = validateWeapons(bad, "weapons.json");
    expect(errs).toContainEqual(
      expect.objectContaining({ pointer: "knife.durability", message: expect.stringContaining(">= 1") }),
    );
  });

  test("rejects stage bounds exceeding nominal arena", () => {
    const bad = structuredClone(grasslandDojo);
    bad.bounds.w = 2000;
    const errs = validateStage(bad, "big.json");
    expect(errs.some((e) => e.pointer === "bounds.w")).toBe(true);
  });
});

describe("content loader", () => {
  test("all six authored sheets pass validation", async () => {
    const files = await authoredFiles();
    const cache = await loadAllContent(files);
    expect(cache.errors).toEqual([]);
    expect([...cache.sheets.keys()].sort()).toEqual([...CHAR_IDS].sort());
  });

  test("full pipeline loads stages, weapons, items; everything deeply frozen", async () => {
    const files: Record<string, unknown> = await authoredFiles();
    files["stages/grassland-dojo.json"] = grasslandDojo;
    files["stages/rooftop-night.json"] = rooftopNight;
    files["weapons.json"] = weaponsJson;
    files["items.json"] = itemsJson;
    const cache = await loadAllContent(files);
    expect(cache.errors).toEqual([]);

    expect(cache.stages.size).toBe(2);
    const grass = cache.stages.get("grassland-dojo")!;
    expect(grass.layers.length).toBe(3);
    expect(grass.drops.table["milk"]).toBe(3);

    expect(Object.keys(cache.weapons)).toEqual(["knife", "baseball-bat", "boulder", "box"]);
    expect(Object.keys(cache.items)).toEqual(["milk", "beer"]);

    // Deep freeze: every nested write must throw in strict mode.
    const sheet = cache.sheets.get("brawler")!;
    expect(() => {
      sheet.maxHp = 1;
    }).toThrow();
    const frame = sheet.moves.punch1!.frames[1]!;
    expect(() => {
      frame.vx = 99;
    }).toThrow();
    const stage = cache.stages.get("grassland-dojo")!;
    expect(() => {
      stage.walls.restitution = 9;
    }).toThrow();
    expect(() => {
      cache.weapons.knife!.durability = 9;
    }).toThrow();
  });

  test("accumulates errors across files into one ContentLoadError", async () => {
    const files: Record<string, unknown> = await authoredFiles();
    const brokenChar = structuredClone(badCancel);
    brokenChar.id = "broken-char";
    files["characters/broken.json"] = brokenChar;
    files["stages/bad-drops.json"] = {
      id: "bad-drops",
      walls: { left: 0, right: 1600, restitution: 0.4 },
      bounds: { w: 1600, h: 480, d: 120 },
      drops: { firstDropTick: 600, intervalTicks: 900, intervalJitterTicks: 180, table: { phaser: 3 } },
    };
    files["weapons.json"] = weaponsJson;
    files["items.json"] = itemsJson;
    let caught: unknown;
    try {
      await loadAllContent(files);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContentLoadError);
    const err = caught as ContentLoadError;
    expect(err.name).toBe("ContentLoadError");
    const filesHit = new Set(err.errors.map((e) => e.file));
    expect(filesHit.has("characters/broken.json")).toBe(true);
    expect(filesHit.has("stages/bad-drops.json")).toBe(true);
    expect(err.message).toContain("characters/broken.json :: ");
    expect(err.message).toContain("phaser");
  });

  test("parse failure becomes a file-level FieldError", async () => {
    const files: Record<string, unknown> = await authoredFiles();
    files["characters/oops.json"] = "{ not json";
    let caught: unknown;
    try {
      await loadAllContent(files);
    } catch (e) {
      caught = e;
    }
    const err = caught as ContentLoadError;
    expect(err.errors.some((e) => e.file === "characters/oops.json" && e.pointer === "")).toBe(true);
  });
});
