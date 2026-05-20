"use client";

import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function HarmonisationBefore({
  before,
  after,
}: {
  before: Record<string, Record<string, number>>;
  after: Record<string, Record<string, number>>;
}) {
  // For each modality, plot per-cohort means before vs after.
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {Object.keys(before).map((mod) => {
        const cohorts = Array.from(
          new Set([...Object.keys(before[mod] ?? {}), ...Object.keys(after[mod] ?? {})]),
        );
        const data = cohorts.map((c) => ({
          cohort: c,
          before: Number((before[mod]?.[c] ?? 0).toFixed(3)),
          after: Number((after[mod]?.[c] ?? 0).toFixed(3)),
        }));
        return (
          <div key={mod} className="rounded-md border border-slate-200 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {mod}
            </div>
            <div className="h-40">
              <ResponsiveContainer>
                <BarChart data={data}>
                  <XAxis dataKey="cohort" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="before" fill="#94a3b8" />
                  <Bar dataKey="after" fill="#2b6cb0" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
