"use client";

type Diff = { added: any; deleted: any; updated: any };

export function DiffViewer({
  v1,
  v2,
  diff,
}: {
  v1: { label: string; version_num: number; payload: unknown };
  v2: { label: string; version_num: number; payload: unknown };
  diff: Diff;
}) {
  return (
    <div className="col">
      <h3>
        v{v1.version_num} ({v1.label}) → v{v2.version_num} ({v2.label})
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h4 className="muted">v{v1.version_num}</h4>
          <pre>{JSON.stringify(v1.payload, null, 2)}</pre>
        </div>
        <div>
          <h4 className="muted">v{v2.version_num}</h4>
          <pre>{JSON.stringify(v2.payload, null, 2)}</pre>
        </div>
      </div>
      <h4>changes</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <DiffBox title="added" color="#7e7" data={diff.added} />
        <DiffBox title="updated" color="#fc7" data={diff.updated} />
        <DiffBox title="deleted" color="#f88" data={diff.deleted} />
      </div>
    </div>
  );
}

function DiffBox({ title, color, data }: { title: string; color: string; data: any }) {
  const empty = !data || Object.keys(data).length === 0;
  return (
    <div style={{ border: `1px solid ${color}33`, borderRadius: 4, padding: 8 }}>
      <h5 style={{ margin: 0, color }}>{title}</h5>
      {empty ? <p className="muted">—</p> : <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
