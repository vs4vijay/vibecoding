"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { JsonEditor } from "@/components/json-editor";
import { TestResults } from "@/components/test-results";

const STARTER = {
  name: "rera_raj_projects",
  enabled: true,
  http: {
    method: "POST",
    url: "https://rera.rajasthan.gov.in/Home/GetProjectsList",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: "https://rera.rajasthan.gov.in",
    },
    form: {
      v: "",
      District: "1063",
      teshil: "",
      projectName: "",
      promoterName: "",
      certificateNo: "",
      applicationStatus: "3",
    },
  },
  pagination: {
    style: "page",
    page_param: "page",
    size_param: "PageSize",
    size: 200,
    start_page: 1,
    stop_when: "empty_records",
  },
  records_path: "$.Data",
  external_id_path: "$.RegNo",
  hash_fields: null,
  schedule_cron: null,
  storage_mode: "generic",
};

const ALLOWED_TYPES = ["text", "integer", "bigint", "boolean", "numeric", "timestamptz", "date", "jsonb"];

type TypedColumn = { name: string; jsonpath: string; sql_type: string; indexed: boolean };

export default function NewSourcePage() {
  const router = useRouter();
  const [json, setJson] = useState(JSON.stringify(STARTER, null, 2));
  const [storageMode, setStorageMode] = useState<"generic" | "dedicated">("generic");
  const [typedColumns, setTypedColumns] = useState<TypedColumn[]>([]);
  const [testResult, setTestResult] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildPayload() {
    const parsed = JSON.parse(json);
    parsed.storage_mode = storageMode;
    if (storageMode === "dedicated") parsed.typed_columns = typedColumns;
    return parsed;
  }

  async function runTest() {
    setError(null);
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload();
      const res = await fetch("/api/sources/test-dryrun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload = buildPayload();
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? JSON.stringify(data));
        return;
      }
      router.push(`/sources/${data.source.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function addColumn() {
    setTypedColumns((cs) => [...cs, { name: "", jsonpath: "", sql_type: "text", indexed: false }]);
  }
  function removeColumn(idx: number) {
    setTypedColumns((cs) => cs.filter((_, i) => i !== idx));
  }
  function updateColumn(idx: number, patch: Partial<TypedColumn>) {
    setTypedColumns((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function suggestColumnsFromTest() {
    const preview = testResult?.preview?.[0]?.record;
    if (!preview || typeof preview !== "object") return;
    const keys = Object.keys(preview as object).slice(0, 10);
    setTypedColumns(
      keys.map((k) => ({
        name: k.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40),
        jsonpath: `$.${k}`,
        sql_type: typeForValue((preview as any)[k]),
        indexed: false,
      }))
    );
  }

  return (
    <div className="col">
      <h1>New source</h1>
      <p className="muted">
        Paste the source config as JSON, click <strong>Test</strong> to fetch the first page and
        confirm <code>records_path</code> / <code>external_id_path</code>, then <strong>Save</strong>.
      </p>
      <JsonEditor value={json} onChange={setJson} />
      <div className="row">
        <label className="row" style={{ gap: 6 }}>
          <input
            type="radio"
            checked={storageMode === "generic"}
            onChange={() => setStorageMode("generic")}
          />
          generic (shared <code>entities</code> table)
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="radio"
            checked={storageMode === "dedicated"}
            onChange={() => setStorageMode("dedicated")}
          />
          dedicated (per-source typed table)
        </label>
      </div>
      {storageMode === "dedicated" && (
        <div className="col" style={{ border: "1px solid #2a2a2a", padding: 12, borderRadius: 4 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Typed columns</h3>
            <div className="row">
              <button onClick={suggestColumnsFromTest} disabled={!testResult?.preview?.[0]?.record}>
                Suggest from test
              </button>
              <button onClick={addColumn}>+ add column</button>
            </div>
          </div>
          {typedColumns.length === 0 && (
            <p className="muted">No typed columns yet. Click <strong>Test</strong> then <strong>Suggest from test</strong>, or add manually.</p>
          )}
          {typedColumns.map((c, idx) => (
            <div key={idx} className="row" style={{ gap: 8 }}>
              <input
                placeholder="column_name"
                value={c.name}
                onChange={(e) => updateColumn(idx, { name: e.target.value })}
                style={{ width: 140 }}
              />
              <input
                placeholder="$.JsonPath"
                value={c.jsonpath}
                onChange={(e) => updateColumn(idx, { jsonpath: e.target.value })}
                style={{ width: 160 }}
              />
              <select value={c.sql_type} onChange={(e) => updateColumn(idx, { sql_type: e.target.value })}>
                {ALLOWED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <label className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={c.indexed}
                  onChange={(e) => updateColumn(idx, { indexed: e.target.checked })}
                />
                indexed
              </label>
              <button onClick={() => removeColumn(idx)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <button onClick={runTest} disabled={testing}>
          {testing ? "Testing…" : "Test"}
        </button>
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {error && <span style={{ color: "#e88" }}>{error}</span>}
      </div>
      <TestResults result={testResult} />
    </div>
  );
}

function typeForValue(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "numeric";
  if (typeof v === "boolean") return "boolean";
  if (v !== null && typeof v === "object") return "jsonb";
  return "text";
}
