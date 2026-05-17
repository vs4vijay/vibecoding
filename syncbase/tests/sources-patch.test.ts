import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { PATCH } from "../app/api/sources/[id]/route";

beforeAll(async () => { await freshTestDb(); });
afterAll(async () => { await cleanupTestDb(); });

function mkReq(id: number, body: unknown): { req: any; params: any } {
  return {
    req: new Request(`http://localhost/api/sources/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id: String(id) }),
  };
}

describe("PATCH /api/sources/[id]", () => {
  test("dedup + cross_dedup pass through (previously silently dropped)", async () => {
    const db = getDb();
    const [src] = await db.insert(sources).values({
      name: "patch_seed",
      http: { url: "https://x.invalid/" },
      pagination: { style: "none" },
      recordsPath: "$.d",
      externalIdPath: "$.id",
    }).returning();

    const newDedup = {
      key_fields: [{ path: "$.address", normalize: "address" }],
      similarity_threshold: 0.8,
    };
    const newCrossDedup = { pincode: "$.pin", city: "$.city", price: "$.price" };

    const { req, params } = mkReq(src.id, {
      category: "bank-auction",
      dedup: newDedup,
      cross_dedup: newCrossDedup,
    });
    const resp = await PATCH(req as any, { params } as any);
    expect(resp.status).toBe(200);

    const [after] = await db.select().from(sources).where(eq(sources.id, src.id));
    expect((after as any).category).toBe("bank-auction");
    expect((after as any).dedup).toMatchObject(newDedup);
    expect((after as any).crossDedup).toMatchObject(newCrossDedup);
  });

  test("null clears the field", async () => {
    const db = getDb();
    const [src] = await db.select().from(sources).where(eq(sources.name, "patch_seed"));
    const { req, params } = mkReq(src!.id, { dedup: null, cross_dedup: null });
    const resp = await PATCH(req as any, { params } as any);
    expect(resp.status).toBe(200);

    const [after] = await db.select().from(sources).where(eq(sources.id, src!.id));
    expect((after as any).dedup).toBeNull();
    expect((after as any).crossDedup).toBeNull();
  });
});
