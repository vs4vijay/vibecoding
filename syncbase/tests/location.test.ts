import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { freshTestDb, cleanupTestDb } from "./helpers/test-db";
import { getDb } from "../lib/db";
import { sources } from "../lib/db/schema";
import { runPipeline } from "../lib/pipeline/run";
import { applyLocation, LocationRequiredError } from "../lib/pipeline/location";
import type { HttpConfig } from "../lib/pipeline/fetch";

// Capture every request the pipeline issues so we can assert on URLs / forms / bodies.
type Captured = { url: string; method: string; body: string; query: Record<string, string> };
let captured: Captured[] = [];
let server: { url: string; close: () => Promise<void> };

async function startMock() {
  const s = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => (query[k] = v));
      const body = await req.text();
      captured.push({ url: req.url, method: req.method, body, query });
      // Echo a single record so the pipeline succeeds.
      const payload = { data: [{ id: "x1", note: "ok" }] };
      return new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return { url: `http://localhost:${s.port}`, close: async () => s.stop(true) };
}

beforeAll(async () => {
  await freshTestDb();
  server = await startMock();
});
afterAll(async () => {
  await server?.close();
  await cleanupTestDb();
});

// Unit tests for applyLocation (no DB needed).

describe("applyLocation — unit", () => {
  const baseHttp: HttpConfig = { method: "GET", url: "https://api.example.com/list", params: { keep: "1" } };

  test("mode=none leaves http unchanged", () => {
    const out = applyLocation(baseHttp, { mode: "none", supports_all: true }, { city: "ajmer" }, "s");
    expect(out).toEqual(baseHttp);
  });

  test("mode=query merges field into params using city_values mapping", () => {
    const out = applyLocation(
      baseHttp,
      { mode: "query", field: "city_id", city_values: { ajmer: "16", bangalore: "23" }, supports_all: true },
      { city: "ajmer" },
      "s"
    );
    expect(out.params).toEqual({ keep: "1", city_id: "16" });
  });

  test("mode=query falls through to literal city when no mapping", () => {
    const out = applyLocation(
      baseHttp,
      { mode: "query", field: "q", supports_all: true },
      { city: "Bengaluru" },
      "s"
    );
    expect(out.params?.q).toBe("Bengaluru");
  });

  test("mode=form merges into form body", () => {
    const httpForm: HttpConfig = { method: "POST", url: "https://api.example.com/list", form: { sEcho: "1" } };
    const out = applyLocation(
      httpForm,
      { mode: "form", field: "state", state_values: { RJ: "8" }, supports_all: true },
      { state: "RJ" },
      "s"
    );
    expect(out.form).toEqual({ sEcho: "1", state: "8" });
  });

  test("mode=body merges into object body", () => {
    const httpBody: HttpConfig = { method: "POST", url: "https://api.example.com/list", body: { pageSize: 50 } };
    const out = applyLocation(
      httpBody,
      { mode: "body", field: "cityId", supports_all: true },
      { city: "23" },
      "s"
    );
    expect(out.body).toEqual({ pageSize: 50, cityId: "23" });
  });

  test("mode=body_path with dot notation writes nested field", () => {
    const httpBody: HttpConfig = {
      method: "POST",
      url: "https://x.example.com/multi_search",
      body: { searches: [{ collection: "properties", q: "*", filter_by: "status:active" }] },
    };
    const out = applyLocation(
      httpBody,
      {
        mode: "body_path",
        field: "searches.0.filter_by",
        value_template: "status:active && city_slug:{{value}}",
        supports_all: true,
      },
      { city: "bangalore" },
      "s"
    );
    expect((out.body as any).searches[0].filter_by).toBe("status:active && city_slug:bangalore");
    // Other fields preserved.
    expect((out.body as any).searches[0].collection).toBe("properties");
    expect((out.body as any).searches[0].q).toBe("*");
  });

  test("mode=body_path with JSON Pointer also works", () => {
    const httpBody: HttpConfig = {
      method: "POST",
      url: "https://x.example.com/multi_search",
      body: { searches: [{ filter_by: "x" }] },
    };
    const out = applyLocation(
      httpBody,
      { mode: "body_path", field: "/searches/0/filter_by", supports_all: true },
      { city: "Bengaluru" },
      "s"
    );
    expect((out.body as any).searches[0].filter_by).toBe("Bengaluru");
  });

  test("mode=body_path errors on missing intermediate path segment", () => {
    const httpBody: HttpConfig = { method: "POST", url: "https://x.example.com/", body: { foo: 1 } };
    expect(() =>
      applyLocation(
        httpBody,
        { mode: "body_path", field: "searches.0.filter_by", supports_all: true },
        { city: "x" },
        "ts"
      )
    ).toThrow(/does not exist/);
  });

  test("mode=body_path does not mutate input body", () => {
    const original = { searches: [{ filter_by: "x" }] };
    const httpBody: HttpConfig = { method: "POST", url: "https://x.example.com/", body: original };
    applyLocation(
      httpBody,
      { mode: "body_path", field: "searches.0.filter_by", supports_all: true },
      { city: "Y" },
      "s"
    );
    expect(original.searches[0].filter_by).toBe("x");
  });

  test("mode=path templates city slug into URL", () => {
    const out = applyLocation(
      { method: "GET", url: "ignored" },
      { mode: "path", templated: "https://api.example.com/locations/{{ location.city|slug }}/banks/all", supports_all: false },
      { city: "Bengaluru" },
      "s"
    );
    expect(out.url).toBe("https://api.example.com/locations/bengaluru/banks/all");
  });

  test("supports_all=false + empty location → LocationRequiredError", () => {
    expect(() =>
      applyLocation(
        baseHttp,
        { mode: "path", templated: "https://api.example.com/{{ location.city|slug }}", supports_all: false },
        undefined,
        "myseed"
      )
    ).toThrow(LocationRequiredError);
  });

  test("supports_all=true + empty location → http unchanged (fetch-all)", () => {
    const out = applyLocation(
      baseHttp,
      { mode: "query", field: "city", supports_all: true },
      undefined,
      "s"
    );
    expect(out).toEqual(baseHttp);
  });

  test("applyLocation does not mutate the input http", () => {
    const before = JSON.stringify(baseHttp);
    applyLocation(baseHttp, { mode: "query", field: "city", supports_all: true }, { city: "ajmer" }, "s");
    expect(JSON.stringify(baseHttp)).toBe(before);
  });
});

// Integration tests through runPipeline → real HTTP server.

describe("runPipeline — location integration", () => {
  test("AC-L1: mode=query with city_values → upstream sees ?city_id=16", async () => {
    captured = [];
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "loc_query_seed",
        http: { method: "GET", url: `${server.url}/q` },
        pagination: { style: "none" },
        recordsPath: "$.data",
        externalIdPath: "$.id",
        location: { mode: "query", field: "city_id", city_values: { ajmer: "16" }, supports_all: true },
      })
      .returning();
    const r = await runPipeline(src, "adhoc", { city: "ajmer" });
    expect(r.status).toBe("success");
    expect(captured).toHaveLength(1);
    expect(captured[0].query.city_id).toBe("16");
  });

  test("AC-L2: empty location + supports_all=true → upstream sees no city_id", async () => {
    captured = [];
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "loc_query_seed_empty",
        http: { method: "GET", url: `${server.url}/q2` },
        pagination: { style: "none" },
        recordsPath: "$.data",
        externalIdPath: "$.id",
        location: { mode: "query", field: "city_id", city_values: { ajmer: "16" }, supports_all: true },
      })
      .returning();
    const r = await runPipeline(src, "adhoc", undefined);
    expect(r.status).toBe("success");
    expect(captured).toHaveLength(1);
    expect(captured[0].query.city_id).toBeUndefined();
  });

  test("AC-L3: mode=path renders city slug into URL", async () => {
    captured = [];
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "loc_path_seed",
        http: { method: "GET", url: "https://placeholder.invalid/" },
        pagination: { style: "none" },
        recordsPath: "$.data",
        externalIdPath: "$.id",
        location: {
          mode: "path",
          templated: `${server.url}/locations/{{ location.city|slug }}/all`,
          supports_all: false,
        },
      })
      .returning();
    const r = await runPipeline(src, "adhoc", { city: "Bengaluru" });
    expect(r.status).toBe("success");
    expect(captured[0].url).toContain("/locations/bengaluru/all");
  });

  test("AC-L4: supports_all=false + empty location → run errors with LOCATION_REQUIRED", async () => {
    captured = [];
    const db = getDb();
    const [src] = await db
      .insert(sources)
      .values({
        name: "loc_required_seed",
        http: { method: "GET", url: "https://placeholder.invalid/" },
        pagination: { style: "none" },
        recordsPath: "$.data",
        externalIdPath: "$.id",
        location: {
          mode: "path",
          templated: `${server.url}/{{ location.city|slug }}`,
          supports_all: false,
        },
      })
      .returning();
    const r = await runPipeline(src, "adhoc", undefined);
    expect(r.status).toBe("error");
    expect(r.errorMessage).toContain("requires a location");
    expect(captured).toHaveLength(0);
  });
});
