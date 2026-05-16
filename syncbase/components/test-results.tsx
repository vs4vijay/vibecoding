"use client";

type TestResult = {
  ok: boolean;
  count?: number;
  external_id_path?: string;
  preview?: { external_id: string | null; hash: string; record: unknown }[];
  raw_sample?: unknown;
  error?: string;
};

export function TestResults({ result }: { result: TestResult | null }) {
  if (!result) return null;
  if (!result.ok) {
    return (
      <div style={{ border: "1px solid #b00", padding: 12, borderRadius: 4 }}>
        <strong>Test failed:</strong> {result.error}
      </div>
    );
  }
  return (
    <div className="col">
      <p>
        Parsed <strong>{result.count}</strong> records using{" "}
        <code>external_id_path = {result.external_id_path}</code>
      </p>
      <table>
        <thead>
          <tr>
            <th>external_id</th>
            <th>hash</th>
            <th>record</th>
          </tr>
        </thead>
        <tbody>
          {(result.preview ?? []).map((p, i) => (
            <tr key={i}>
              <td>
                {p.external_id == null ? (
                  <span style={{ color: "#c66" }}>null</span>
                ) : (
                  <code>{p.external_id}</code>
                )}
              </td>
              <td>
                <code style={{ fontSize: "0.75em" }}>{p.hash.slice(0, 12)}…</code>
              </td>
              <td>
                <pre style={{ maxHeight: 160, margin: 0 }}>
                  {JSON.stringify(p.record, null, 2)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary className="muted">Raw response sample</summary>
        <pre>{JSON.stringify(result.raw_sample, null, 2)}</pre>
      </details>
    </div>
  );
}
