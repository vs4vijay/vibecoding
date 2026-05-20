import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";
import { ensureSchema } from "@/lib/db/bootstrap";
import { EnqueueNoopButton } from "@/components/enqueue-noop";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  await ensureSchema();
  const d = db();
  const rows = await d.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="mt-1 text-sm text-slate-600">{rows.length} recent</p>
        </div>
        <EnqueueNoopButton />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Attempts</th>
              <th className="px-3 py-2">Worker</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Finished</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((j) => (
              <tr key={j.id}>
                <td className="px-3 py-2 font-mono">{j.id.slice(0, 16)}</td>
                <td className="px-3 py-2">{j.kind}</td>
                <td className="px-3 py-2">
                  <StatusPill status={j.status} />
                </td>
                <td className="px-3 py-2">{j.attempts}/{j.maxAttempts}</td>
                <td className="px-3 py-2 font-mono text-[10px]">{j.lockedBy ?? "-"}</td>
                <td className="px-3 py-2">{new Date(j.createdAt).toLocaleTimeString()}</td>
                <td className="px-3 py-2">{j.finishedAt ? new Date(j.finishedAt).toLocaleTimeString() : "-"}</td>
                <td className="px-3 py-2 text-rose-700">{j.error ? j.error.slice(0, 80) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-center text-slate-500" colSpan={8}>
                  No jobs yet. Click "Enqueue noop" to test.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "succeeded"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : status === "failed"
        ? "border-rose-300 bg-rose-50 text-rose-700"
        : status === "running"
          ? "border-amber-300 bg-amber-50 text-amber-700"
          : "border-slate-300 bg-slate-50 text-slate-700";
  return <span className={`pill ${cls}`}>{status}</span>;
}
