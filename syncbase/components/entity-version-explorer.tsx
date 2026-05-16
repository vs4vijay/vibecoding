"use client";
import { useState } from "react";
import { DiffViewer } from "./diff-viewer";

type VersionRow = { version_num: number; valid_from: string; valid_to: string };

export function EntityVersionExplorer({
  storageTable,
  entityId,
  currentVersionNum,
  versions,
}: {
  storageTable: string;
  entityId: number;
  currentVersionNum: number;
  versions: VersionRow[];
}) {
  const [v1, setV1] = useState<string>(versions[0]?.version_num.toString() ?? "1");
  const [v2, setV2] = useState<string>("current");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function loadDiff() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/entities/${encodeURIComponent(storageTable)}/${entityId}/diff?v1=${v1}&v2=${v2}`
      );
      setData(await res.json());
    } finally {
      setBusy(false);
    }
  }

  if (versions.length === 0) {
    return <p className="muted">No prior versions yet.</p>;
  }

  const opts = [
    ...versions.map((v) => ({ value: v.version_num.toString(), label: `v${v.version_num}` })),
    { value: "current", label: `current (v${currentVersionNum})` },
  ];

  return (
    <div className="col">
      <table>
        <thead>
          <tr>
            <th>version</th>
            <th>valid_from</th>
            <th>valid_to</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version_num}>
              <td>v{v.version_num}</td>
              <td className="muted">{v.valid_from}</td>
              <td className="muted">{v.valid_to}</td>
            </tr>
          ))}
          <tr>
            <td>v{currentVersionNum} (current)</td>
            <td className="muted">—</td>
            <td className="muted">now</td>
          </tr>
        </tbody>
      </table>
      <div className="row">
        <label>
          v1:{" "}
          <select value={v1} onChange={(e) => setV1(e.target.value)}>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>
          v2:{" "}
          <select value={v2} onChange={(e) => setV2(e.target.value)}>
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <button onClick={loadDiff} disabled={busy}>
          {busy ? "Loading…" : "Show diff"}
        </button>
      </div>
      {data && data.diff && (
        <DiffViewer v1={data.v1} v2={data.v2} diff={data.diff} />
      )}
      {data && data.error && <p style={{ color: "#e88" }}>{data.error}</p>}
    </div>
  );
}
