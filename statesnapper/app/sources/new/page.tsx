"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { JsonEditor } from "@/components/json-editor";
import { TestResults } from "@/components/test-results";

// -- Types ----------------------------------------------------------------

type KV = { key: string; value: string };
type TypedColumn = { name: string; jsonpath: string; sql_type: string; indexed: boolean };
type DisplayColumn = { label: string; jsonpath: string; primary: boolean };

type FormState = {
  // Basics
  name: string;
  enabled: boolean;

  // HTTP
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers: KV[];
  params: KV[];
  form: KV[];
  bodyRaw: string;

  // Pagination
  pagination_style: "none" | "page" | "offset";
  page_param: string;
  size_param: string;
  size: number | "";
  start_page: number | "";
  offset_param: string;
  start_offset: number | "";
  stop_when_empty: boolean;
  max_pages: number | "";

  // Extraction
  records_path: string;
  external_id_path: string;
  hash_fields_input: string; // comma separated, empty = null

  // Storage
  storage_mode: "generic" | "dedicated";
  typed_columns: TypedColumn[];

  // Display
  display_columns: DisplayColumn[];

  // Schedule
  schedule_cron: string;
};

const ALLOWED_TYPES = ["text", "integer", "bigint", "boolean", "numeric", "timestamptz", "date", "jsonb"];

// RERA Rajasthan starter
const STARTER: FormState = {
  name: "rera_raj_projects",
  enabled: true,
  method: "POST",
  url: "https://rera.rajasthan.gov.in/Home/GetProjectsList",
  headers: [
    { key: "User-Agent", value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0" },
    { key: "Content-Type", value: "application/x-www-form-urlencoded; charset=UTF-8" },
    { key: "Origin", value: "https://rera.rajasthan.gov.in" },
  ],
  params: [],
  form: [
    { key: "v", value: "" },
    { key: "District", value: "1063" },
    { key: "teshil", value: "" },
    { key: "projectName", value: "" },
    { key: "promoterName", value: "" },
    { key: "certificateNo", value: "" },
    { key: "applicationStatus", value: "3" },
  ],
  bodyRaw: "",
  pagination_style: "page",
  page_param: "page",
  size_param: "PageSize",
  size: 200,
  start_page: 1,
  offset_param: "",
  start_offset: "",
  stop_when_empty: true,
  max_pages: "",
  records_path: "$.Data",
  external_id_path: "$.RegNo",
  hash_fields_input: "",
  storage_mode: "generic",
  typed_columns: [],
  display_columns: [],
  schedule_cron: "",
};

const TABS = [
  { id: "basics",     label: "Basics" },
  { id: "http",       label: "HTTP" },
  { id: "pagination", label: "Pagination" },
  { id: "extraction", label: "Extraction" },
  { id: "storage",    label: "Storage" },
  { id: "display",    label: "Display" },
  { id: "schedule",   label: "Schedule" },
  { id: "review",     label: "Review & Test" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// -- Helpers --------------------------------------------------------------

function kvToObject(list: KV[]): Record<string, string> | undefined {
  const filtered = list.filter((k) => k.key.trim() !== "");
  if (filtered.length === 0) return undefined;
  const obj: Record<string, string> = {};
  for (const { key, value } of filtered) obj[key] = value;
  return obj;
}

function buildPayload(s: FormState) {
  const http: any = {
    method: s.method,
    url: s.url,
  };
  const headers = kvToObject(s.headers); if (headers) http.headers = headers;
  const params = kvToObject(s.params);   if (params)  http.params = params;
  const form = kvToObject(s.form);       if (form)    http.form = form;
  if (s.bodyRaw.trim()) {
    try { http.body = JSON.parse(s.bodyRaw); } catch { http.body = s.bodyRaw; }
  }

  let pagination: any;
  if (s.pagination_style === "none") {
    pagination = { style: "none" };
  } else if (s.pagination_style === "page") {
    pagination = {
      style: "page",
      page_param: s.page_param || "page",
    };
    if (s.size_param)        pagination.size_param   = s.size_param;
    if (s.size !== "")       pagination.size         = Number(s.size);
    if (s.start_page !== "") pagination.start_page   = Number(s.start_page);
    if (s.stop_when_empty)   pagination.stop_when    = "empty_records";
    if (s.max_pages !== "")  pagination.max_pages    = Number(s.max_pages);
  } else {
    pagination = {
      style: "offset",
      offset_param: s.offset_param || "offset",
      size: s.size === "" ? 100 : Number(s.size),
    };
    if (s.size_param)        pagination.size_param   = s.size_param;
    if (s.start_offset !== "") pagination.start_offset = Number(s.start_offset);
    if (s.stop_when_empty)   pagination.stop_when    = "empty_records";
    if (s.max_pages !== "")  pagination.max_pages    = Number(s.max_pages);
  }

  const hash_fields = s.hash_fields_input.trim()
    ? s.hash_fields_input.split(",").map((x) => x.trim()).filter(Boolean)
    : null;

  const payload: any = {
    name: s.name,
    enabled: s.enabled,
    http,
    pagination,
    records_path: s.records_path,
    external_id_path: s.external_id_path,
    hash_fields,
    schedule_cron: s.schedule_cron.trim() || null,
    storage_mode: s.storage_mode,
  };
  if (s.storage_mode === "dedicated") payload.typed_columns = s.typed_columns;
  if (s.display_columns.length) payload.display_columns = s.display_columns;
  return payload;
}

// -- Page -----------------------------------------------------------------

export default function NewSourcePage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("basics");
  const [s, setS] = useState<FormState>(STARTER);
  const [rawMode, setRawMode] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setS((p) => ({ ...p, ...patch }));

  const payload = useMemo(() => {
    if (rawMode) {
      try { return JSON.parse(rawJson); } catch { return null; }
    }
    return buildPayload(s);
  }, [rawMode, rawJson, s]);

  async function runTest() {
    setError(null); setTesting(true); setTestResult(null);
    try {
      const p = payload;
      if (!p) { setError("Raw JSON is invalid"); return; }
      const res = await fetch("/api/sources/test-dryrun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally { setTesting(false); }
  }

  async function save() {
    setError(null); setSaving(true);
    try {
      const p = payload;
      if (!p) { setError("Raw JSON is invalid"); return; }
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? JSON.stringify(data)); return; }
      router.push(`/sources/${data.source.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally { setSaving(false); }
  }

  function suggestDisplayColumnsFromTest() {
    const preview = testResult?.preview?.[0]?.record as Record<string, unknown> | undefined;
    if (!preview || typeof preview !== "object") return;
    const candidates = Object.keys(preview).filter((k) => {
      const v = (preview as any)[k];
      return v != null && (typeof v === "string" || typeof v === "number");
    });
    const ranked = candidates.sort((a, b) => {
      const ka = a.toLowerCase(), kb = b.toLowerCase();
      const pri = ["name", "title", "label", "projectname", "company", "displayname"];
      const ia = pri.findIndex((p) => ka.includes(p));
      const ib = pri.findIndex((p) => kb.includes(p));
      const sa = ia === -1 ? 99 : ia;
      const sb = ib === -1 ? 99 : ib;
      return sa - sb;
    });
    const picked = ranked.slice(0, 3);
    update({
      display_columns: picked.map((k, i) => ({
        label: k,
        jsonpath: `$.${k}`,
        primary: i === 0,
      })),
    });
  }

  function suggestTypedColumnsFromTest() {
    const preview = testResult?.preview?.[0]?.record as any;
    if (!preview || typeof preview !== "object") return;
    const keys = Object.keys(preview).slice(0, 10);
    update({
      typed_columns: keys.map((k) => ({
        name: k.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40),
        jsonpath: `$.${k}`,
        sql_type: typeForValue(preview[k]),
        indexed: false,
      })),
    });
  }

  function toggleRaw() {
    if (!rawMode) {
      setRawJson(JSON.stringify(buildPayload(s), null, 2));
    } else {
      try {
        const p = JSON.parse(rawJson);
        applyPayloadToState(p, setS);
      } catch {
        setError("Cannot exit raw mode — JSON is invalid");
        return;
      }
    }
    setRawMode(!rawMode);
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>New source</h1>
          <p className="muted" style={{ margin: 0 }}>
            Configure how statesnapper pulls, identifies, stores, and displays records from an HTTP API.
          </p>
        </div>
        <div className="row">
          <button className="btn-ghost" onClick={toggleRaw}>
            {rawMode ? "← Form view" : "Raw JSON"}
          </button>
        </div>
      </div>

      {rawMode ? (
        <div className="col">
          <div className="help">
            <h4>Raw JSON mode</h4>
            <p style={{ margin: 0 }}>
              Edit the full source payload. Switching back to the form parses this JSON.
              The schema matches the POST <code>/api/sources</code> body.
            </p>
          </div>
          <JsonEditor value={rawJson} onChange={setRawJson} height={520} />
        </div>
      ) : (
        <>
          <Tabs tab={tab} setTab={setTab} />
          {tab === "basics"     && <BasicsTab s={s} update={update} />}
          {tab === "http"       && <HttpTab s={s} update={update} />}
          {tab === "pagination" && <PaginationTab s={s} update={update} />}
          {tab === "extraction" && <ExtractionTab s={s} update={update} />}
          {tab === "storage"    && (
            <StorageTab
              s={s}
              update={update}
              hasTestPreview={!!testResult?.preview?.[0]?.record}
              suggest={suggestTypedColumnsFromTest}
            />
          )}
          {tab === "display"    && (
            <DisplayTab
              s={s}
              update={update}
              hasTestPreview={!!testResult?.preview?.[0]?.record}
              suggest={suggestDisplayColumnsFromTest}
            />
          )}
          {tab === "schedule"   && <ScheduleTab s={s} update={update} />}
          {tab === "review"     && <ReviewTab payload={payload} />}
        </>
      )}

      <div className="card" style={{ position: "sticky", bottom: 0, marginTop: 8 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <button onClick={runTest} disabled={testing}>
              {testing ? "Testing…" : "Test fetch"}
            </button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save source"}
            </button>
            {error && <span style={{ color: "var(--danger)" }}>{error}</span>}
          </div>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            Test runs against page 1 only. No DB writes.
          </div>
        </div>
        {testResult && (
          <details style={{ marginTop: 12 }} open>
            <summary className="muted">Test results</summary>
            <TestResults result={testResult} />
          </details>
        )}
      </div>
    </div>
  );
}

// -- Tabs ----------------------------------------------------------------

function Tabs({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  return (
    <div className="tabs">
      {TABS.map((t, i) => (
        <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
          <span className="step">{i + 1}</span>{t.label}
        </button>
      ))}
    </div>
  );
}

// -- Tab: Basics --------------------------------------------------------

function BasicsTab({ s, update }: { s: FormState; update: (p: Partial<FormState>) => void }) {
  return (
    <div className="col">
      <Help title="What is a source?">
        A source is one HTTP endpoint statesnapper will poll on a schedule (or on demand).
        Give it a stable machine-friendly <code>name</code> — it identifies the source everywhere
        (URLs, change_log rows, scheduler jobs, dedicated tables). Names cannot be changed later.
      </Help>
      <div className="card col">
        <div className="field">
          <label>Name <span className="dim">(required, lowercase letters/digits/underscore)</span></label>
          <input
            value={s.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="rera_raj_projects"
            pattern="^[a-z][a-z0-9_]{0,62}$"
          />
          <span className="hint">Regex: <code>^[a-z][a-z0-9_]{`{0,62}`}$</code></span>
        </div>
        <div className="field">
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
              style={{ width: "auto" }}
            />
            Enabled
          </label>
          <span className="hint">Disabled sources are skipped by the scheduler and refuse adhoc runs.</span>
        </div>
      </div>
    </div>
  );
}

// -- Tab: HTTP ----------------------------------------------------------

function HttpTab({ s, update }: { s: FormState; update: (p: Partial<FormState>) => void }) {
  return (
    <div className="col">
      <Help title="HTTP request">
        Define the upstream request statesnapper will send each run.
        <ul>
          <li><strong>Headers</strong>: static request headers (e.g. <code>Authorization: Bearer …</code>).</li>
          <li><strong>Query params</strong>: appended to the URL as <code>?k=v</code>.</li>
          <li><strong>Form body</strong>: sent as <code>application/x-www-form-urlencoded</code>. Pagination params (page/size) are merged into the form when set.</li>
          <li><strong>Body</strong>: raw JSON body (parsed if valid JSON, otherwise sent as a string).</li>
        </ul>
      </Help>
      <div className="card col">
        <div className="row" style={{ gap: 8 }}>
          <div className="field" style={{ width: 110 }}>
            <label>Method</label>
            <select value={s.method} onChange={(e) => update({ method: e.target.value as any })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>URL <span className="dim">(absolute, including protocol)</span></label>
            <input
              value={s.url}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="https://api.example.com/items"
            />
          </div>
        </div>
        <KvEditor title="Headers" list={s.headers} onChange={(v) => update({ headers: v })} />
        <KvEditor title="Query params" list={s.params} onChange={(v) => update({ params: v })} />
        <KvEditor title="Form fields" list={s.form} onChange={(v) => update({ form: v })} />
        <div className="field">
          <label>Raw body <span className="dim">(JSON or string, leave empty if using form)</span></label>
          <textarea
            value={s.bodyRaw}
            onChange={(e) => update({ bodyRaw: e.target.value })}
            rows={4}
            style={{ fontFamily: "ui-monospace, monospace" }}
            placeholder='{"filter": {"status": "active"}}'
          />
        </div>
      </div>
    </div>
  );
}

// -- Tab: Pagination ----------------------------------------------------

function PaginationTab({ s, update }: { s: FormState; update: (p: Partial<FormState>) => void }) {
  return (
    <div className="col">
      <Help title="Pagination strategy">
        Choose how statesnapper walks the upstream pages until exhausted.
        <ul>
          <li><strong>none</strong> — single request, no paging.</li>
          <li><strong>page</strong> — increments a <em>page number</em> param (e.g. <code>?page=1</code>, <code>?page=2</code>).</li>
          <li><strong>offset</strong> — increments an <em>offset</em> param by page size.</li>
        </ul>
        Pagination params are merged into the query string for GET, into the form for form-bodied POSTs.
      </Help>
      <div className="card col">
        <div className="field" style={{ width: 200 }}>
          <label>Style</label>
          <select
            value={s.pagination_style}
            onChange={(e) => update({ pagination_style: e.target.value as any })}
          >
            <option value="none">none — single request</option>
            <option value="page">page — incrementing page number</option>
            <option value="offset">offset — fixed-size windows</option>
          </select>
        </div>

        {s.pagination_style === "page" && (
          <div className="row wrap" style={{ gap: 12 }}>
            <FieldInput label="page_param" value={s.page_param} onChange={(v) => update({ page_param: v })} placeholder="page" />
            <FieldInput label="size_param" value={s.size_param} onChange={(v) => update({ size_param: v })} placeholder="PageSize" />
            <FieldNum   label="size"       value={s.size}       onChange={(v) => update({ size: v })} />
            <FieldNum   label="start_page" value={s.start_page} onChange={(v) => update({ start_page: v })} />
            <FieldNum   label="max_pages (optional)" value={s.max_pages} onChange={(v) => update({ max_pages: v })} />
            <label className="row" style={{ gap: 6, alignSelf: "flex-end" }}>
              <input
                type="checkbox"
                checked={s.stop_when_empty}
                onChange={(e) => update({ stop_when_empty: e.target.checked })}
                style={{ width: "auto" }}
              />
              stop when empty records
            </label>
          </div>
        )}

        {s.pagination_style === "offset" && (
          <div className="row wrap" style={{ gap: 12 }}>
            <FieldInput label="offset_param"  value={s.offset_param}  onChange={(v) => update({ offset_param: v })} placeholder="offset" />
            <FieldInput label="size_param"    value={s.size_param}    onChange={(v) => update({ size_param: v })} placeholder="limit" />
            <FieldNum   label="size"          value={s.size}          onChange={(v) => update({ size: v })} />
            <FieldNum   label="start_offset"  value={s.start_offset}  onChange={(v) => update({ start_offset: v })} />
            <FieldNum   label="max_pages"     value={s.max_pages}     onChange={(v) => update({ max_pages: v })} />
            <label className="row" style={{ gap: 6, alignSelf: "flex-end" }}>
              <input
                type="checkbox"
                checked={s.stop_when_empty}
                onChange={(e) => update({ stop_when_empty: e.target.checked })}
                style={{ width: "auto" }}
              />
              stop when empty records
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

// -- Tab: Extraction ----------------------------------------------------

function ExtractionTab({ s, update }: { s: FormState; update: (p: Partial<FormState>) => void }) {
  return (
    <div className="col">
      <Help title="Records extraction (JSONPath)">
        Tell statesnapper how to dig into the response JSON.
        <ul>
          <li><strong>records_path</strong> — JSONPath that resolves to the array of records.
              Examples: <code>$</code> (response is the array), <code>$.data</code>, <code>$.results.items</code>.</li>
          <li><strong>external_id_path</strong> — JSONPath on each record that yields a stable upstream id.
              Examples: <code>$.id</code>, <code>$.RegNo</code>, <code>$.uuid</code>.</li>
          <li><strong>hash_fields</strong> (optional) — comma-separated key names. If set, only these fields
              participate in change detection. Leave empty to hash the entire record.</li>
        </ul>
        Use the <strong>Test fetch</strong> button at the bottom to verify both paths against a real response.
      </Help>
      <div className="card col">
        <FieldInput label="records_path"     value={s.records_path}     onChange={(v) => update({ records_path: v })} placeholder="$.data" required />
        <FieldInput label="external_id_path" value={s.external_id_path} onChange={(v) => update({ external_id_path: v })} placeholder="$.id" required />
        <div className="field">
          <label>hash_fields <span className="dim">(comma-separated; empty = whole record)</span></label>
          <input
            value={s.hash_fields_input}
            onChange={(e) => update({ hash_fields_input: e.target.value })}
            placeholder="name, status, updated_at"
          />
          <span className="hint">Only changes in listed top-level keys will register as a change.</span>
        </div>
      </div>
    </div>
  );
}

// -- Tab: Storage -------------------------------------------------------

function StorageTab({
  s,
  update,
  hasTestPreview,
  suggest,
}: {
  s: FormState;
  update: (p: Partial<FormState>) => void;
  hasTestPreview: boolean;
  suggest: () => void;
}) {
  return (
    <div className="col">
      <Help title="Storage mode">
        <p style={{ margin: 0 }}>
          <strong>generic</strong> — records land in the shared <code>entities</code> table as JSONB.
          Zero DDL, fastest to set up. Use this unless you need typed columns.
        </p>
        <p style={{ margin: "6px 0 0 0" }}>
          <strong>dedicated</strong> — provisions <code>entities_&lt;name&gt;</code> with optional STORED
          generated columns extracted from the payload via JSONPath. Allows native SQL filters/joins/indexes
          on typed fields. <strong>Storage mode cannot be changed after creation.</strong>
        </p>
      </Help>
      <div className="card col">
        <div className="row">
          <label className="row" style={{ gap: 6 }}>
            <input
              type="radio"
              checked={s.storage_mode === "generic"}
              onChange={() => update({ storage_mode: "generic" })}
              style={{ width: "auto" }}
            />
            generic (shared <code>entities</code>)
          </label>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="radio"
              checked={s.storage_mode === "dedicated"}
              onChange={() => update({ storage_mode: "dedicated" })}
              style={{ width: "auto" }}
            />
            dedicated (typed per-source table)
          </label>
        </div>

        {s.storage_mode === "dedicated" && (
          <div className="col">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>Typed columns</strong>
              <div className="row">
                <button onClick={suggest} disabled={!hasTestPreview}>Suggest from test</button>
                <button onClick={() => update({ typed_columns: [...s.typed_columns, { name: "", jsonpath: "", sql_type: "text", indexed: false }] })}>
                  + add column
                </button>
              </div>
            </div>
            {s.typed_columns.length === 0 && (
              <p className="muted">No typed columns yet. Run <strong>Test fetch</strong> first, then click <em>Suggest from test</em>, or add manually.</p>
            )}
            {s.typed_columns.map((c, idx) => (
              <div key={idx} className="row" style={{ gap: 8 }}>
                <input
                  placeholder="column_name"
                  value={c.name}
                  onChange={(e) => update({ typed_columns: s.typed_columns.map((x, i) => i === idx ? { ...x, name: e.target.value } : x) })}
                  style={{ width: 160 }}
                />
                <input
                  placeholder="$.JsonPath"
                  value={c.jsonpath}
                  onChange={(e) => update({ typed_columns: s.typed_columns.map((x, i) => i === idx ? { ...x, jsonpath: e.target.value } : x) })}
                  style={{ width: 200 }}
                />
                <select
                  value={c.sql_type}
                  onChange={(e) => update({ typed_columns: s.typed_columns.map((x, i) => i === idx ? { ...x, sql_type: e.target.value } : x) })}
                >
                  {ALLOWED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="row" style={{ gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={c.indexed}
                    onChange={(e) => update({ typed_columns: s.typed_columns.map((x, i) => i === idx ? { ...x, indexed: e.target.checked } : x) })}
                    style={{ width: "auto" }}
                  />
                  indexed
                </label>
                <button
                  className="btn-danger"
                  onClick={() => update({ typed_columns: s.typed_columns.filter((_, i) => i !== idx) })}
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -- Tab: Display -------------------------------------------------------

function DisplayTab({
  s,
  update,
  hasTestPreview,
  suggest,
}: {
  s: FormState;
  update: (p: Partial<FormState>) => void;
  hasTestPreview: boolean;
  suggest: () => void;
}) {
  return (
    <div className="col">
      <Help title="Display fields — human-friendly labels">
        statesnapper normally identifies records by <code>external_id</code>, which is good for joins but
        opaque to humans. Configure <strong>display fields</strong> to surface friendlier values like a
        project name or title in the Entities table, change feed, and detail pages.
        <ul>
          <li><strong>label</strong> — how the field is named in the UI.</li>
          <li><strong>jsonpath</strong> — where to find it inside the payload (e.g. <code>$.ProjectName</code>).</li>
          <li><strong>primary</strong> — exactly one should be marked primary; it becomes the headline title.</li>
        </ul>
      </Help>
      <div className="card col">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Display columns</strong>
          <div className="row">
            <button onClick={suggest} disabled={!hasTestPreview}>Suggest from test</button>
            <button onClick={() => update({ display_columns: [...s.display_columns, { label: "", jsonpath: "", primary: s.display_columns.length === 0 }] })}>
              + add field
            </button>
          </div>
        </div>
        {s.display_columns.length === 0 && (
          <p className="muted">
            No display fields yet. Run <strong>Test fetch</strong> and click <em>Suggest from test</em> — statesnapper
            will pick up to 3 likely-readable string/number fields.
          </p>
        )}
        {s.display_columns.length > 0 && (
          <div className="kv-grid" style={{ gridTemplateColumns: "1fr 1.5fr 110px auto" }}>
            <div className="muted" style={{ fontSize: "0.78rem" }}>Label</div>
            <div className="muted" style={{ fontSize: "0.78rem" }}>JSONPath</div>
            <div className="muted" style={{ fontSize: "0.78rem" }}>Primary</div>
            <div></div>
            {s.display_columns.map((c, idx) => (
              <DisplayRow
                key={idx}
                col={c}
                onChange={(patch) =>
                  update({
                    display_columns: s.display_columns.map((x, i) => {
                      if (i !== idx) {
                        // ensure only one primary
                        return patch.primary === true ? { ...x, primary: false } : x;
                      }
                      return { ...x, ...patch };
                    }),
                  })
                }
                onRemove={() => update({ display_columns: s.display_columns.filter((_, i) => i !== idx) })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DisplayRow({
  col,
  onChange,
  onRemove,
}: {
  col: DisplayColumn;
  onChange: (patch: Partial<DisplayColumn>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input placeholder="Project name" value={col.label} onChange={(e) => onChange({ label: e.target.value })} />
      <input placeholder="$.ProjectName" value={col.jsonpath} onChange={(e) => onChange({ jsonpath: e.target.value })} />
      <label className="row" style={{ gap: 4 }}>
        <input
          type="checkbox"
          checked={col.primary}
          onChange={(e) => onChange({ primary: e.target.checked })}
          style={{ width: "auto" }}
        />
        primary
      </label>
      <button className="btn-danger" onClick={onRemove}>×</button>
    </>
  );
}

// -- Tab: Schedule ------------------------------------------------------

function ScheduleTab({ s, update }: { s: FormState; update: (p: Partial<FormState>) => void }) {
  return (
    <div className="col">
      <Help title="Schedule (cron)">
        Optional. Standard 5-field cron syntax. Leave blank to only run adhoc.
        <ul>
          <li><code>*/5 * * * *</code> — every 5 minutes</li>
          <li><code>0 * * * *</code> — top of every hour</li>
          <li><code>30 2 * * *</code> — daily at 02:30</li>
          <li><code>0 0 * * 1</code> — every Monday at midnight</li>
        </ul>
      </Help>
      <div className="card">
        <FieldInput
          label="schedule_cron"
          value={s.schedule_cron}
          onChange={(v) => update({ schedule_cron: v })}
          placeholder="*/15 * * * *"
        />
      </div>
    </div>
  );
}

// -- Tab: Review --------------------------------------------------------

function ReviewTab({ payload }: { payload: any }) {
  return (
    <div className="col">
      <Help title="Review & test">
        This is the payload that will be sent to <code>POST /api/sources</code>. Click <strong>Test fetch</strong>
        below to fetch page 1 against the live endpoint (no DB write), then <strong>Save source</strong>
        once the preview looks right.
      </Help>
      <div className="card">
        <pre style={{ maxHeight: 480 }}>{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </div>
  );
}

// -- Generic primitives -------------------------------------------------

function Help({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="help">
      <h4>{title}</h4>
      <div>{children}</div>
    </div>
  );
}

function FieldInput({
  label, value, onChange, placeholder, required,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div className="field" style={{ flex: 1, minWidth: 180 }}>
      <label>{label}{required && <span style={{ color: "var(--danger)" }}> *</span>}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function FieldNum({
  label, value, onChange,
}: { label: string; value: number | ""; onChange: (v: number | "") => void }) {
  return (
    <div className="field" style={{ width: 160 }}>
      <label>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    </div>
  );
}

function KvEditor({
  title, list, onChange,
}: { title: string; list: KV[]; onChange: (v: KV[]) => void }) {
  return (
    <div className="col-sm">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong style={{ fontSize: "0.9rem" }}>{title}</strong>
        <button className="btn-ghost" onClick={() => onChange([...list, { key: "", value: "" }])}>+ add</button>
      </div>
      {list.length === 0 ? (
        <p className="dim" style={{ fontSize: "0.85rem", margin: 0 }}>(none)</p>
      ) : (
        <div className="kv-grid">
          {list.map((kv, idx) => (
            <KvRow
              key={idx}
              kv={kv}
              onChange={(patch) => onChange(list.map((x, i) => i === idx ? { ...x, ...patch } : x))}
              onRemove={() => onChange(list.filter((_, i) => i !== idx))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KvRow({
  kv, onChange, onRemove,
}: { kv: KV; onChange: (patch: Partial<KV>) => void; onRemove: () => void }) {
  return (
    <>
      <input placeholder="key" value={kv.key}   onChange={(e) => onChange({ key: e.target.value })} />
      <input placeholder="value" value={kv.value} onChange={(e) => onChange({ value: e.target.value })} />
      <button className="btn-danger" onClick={onRemove}>×</button>
    </>
  );
}

// -- Helpers (form <-> payload) ----------------------------------------

function typeForValue(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "numeric";
  if (typeof v === "boolean") return "boolean";
  if (v !== null && typeof v === "object") return "jsonb";
  return "text";
}

function objToKv(obj: unknown): KV[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).map(([key, value]) => ({
    key, value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

function applyPayloadToState(p: any, setS: React.Dispatch<React.SetStateAction<FormState>>) {
  const http = p.http ?? {};
  const pag = p.pagination ?? { style: "none" };
  setS({
    name: p.name ?? "",
    enabled: p.enabled ?? true,
    method: (http.method ?? "GET") as any,
    url: http.url ?? "",
    headers: objToKv(http.headers),
    params: objToKv(http.params),
    form: objToKv(http.form),
    bodyRaw: http.body == null ? "" : typeof http.body === "string" ? http.body : JSON.stringify(http.body, null, 2),
    pagination_style: pag.style ?? "none",
    page_param: pag.page_param ?? "page",
    size_param: pag.size_param ?? "",
    size: pag.size ?? "",
    start_page: pag.start_page ?? "",
    offset_param: pag.offset_param ?? "",
    start_offset: pag.start_offset ?? "",
    stop_when_empty: pag.stop_when === "empty_records",
    max_pages: pag.max_pages ?? "",
    records_path: p.records_path ?? "",
    external_id_path: p.external_id_path ?? "",
    hash_fields_input: Array.isArray(p.hash_fields) ? p.hash_fields.join(", ") : "",
    storage_mode: p.storage_mode ?? "generic",
    typed_columns: Array.isArray(p.typed_columns) ? p.typed_columns : [],
    display_columns: Array.isArray(p.display_columns) ? p.display_columns : [],
    schedule_cron: p.schedule_cron ?? "",
  });
}
