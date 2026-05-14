import Link from "next/link";
import { getDb } from "@/lib/db";
import { sources, runs } from "@/lib/db/schema";
import { desc, eq, isNotNull } from "drizzle-orm";
import { ScheduleEditor } from "@/components/schedule-editor";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const db = getDb();
  const all = await db.select().from(sources).orderBy(desc(sources.id));
  const rows = await Promise.all(
    all.map(async (s) => {
      const [last] = await db
        .select()
        .from(runs)
        .where(eq(runs.sourceId, s.id))
        .orderBy(desc(runs.id))
        .limit(1);
      return { source: s, lastRun: last ?? null };
    })
  );

  return (
    <div className="col">
      <h1>Schedules</h1>
      <p className="muted">
        Edit cron expressions per source. Standard 5-field cron syntax.
      </p>
      <table>
        <thead>
          <tr>
            <th>id</th><th>name</th><th>enabled</th>
            <th>cron</th><th>last run</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ source, lastRun }) => (
            <tr key={source.id}>
              <td>{source.id}</td>
              <td>
                <Link href={`/sources/${source.id}`}>{source.name}</Link>
              </td>
              <td><code>{String(source.enabled)}</code></td>
              <td>
                <ScheduleEditor
                  sourceId={source.id}
                  enabled={source.enabled}
                  cron={source.scheduleCron}
                />
              </td>
              <td className="muted">
                {lastRun ? `${lastRun.status} · ${String(lastRun.startedAt)}` : "—"}
              </td>
              <td></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
