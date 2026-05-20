"use client";

import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function RiskChart({ predictions }: { predictions: any[] }) {
  const sorted = [...predictions].sort((a, b) => a.horizonYears - b.horizonYears);
  const data = sorted.map((p) => ({
    horizon: p.horizonYears,
    risk: Number((p.riskPoint * 100).toFixed(2)),
    lo80: Number((p.riskLo80 * 100).toFixed(2)),
    hi80: Number((p.riskHi80 * 100).toFixed(2)),
    lo95: Number((p.riskLo95 * 100).toFixed(2)),
    hi95: Number((p.riskHi95 * 100).toFixed(2)),
    band80: [
      Number((p.riskLo80 * 100).toFixed(2)),
      Number((p.riskHi80 * 100).toFixed(2)),
    ],
    band95: [
      Number((p.riskLo95 * 100).toFixed(2)),
      Number((p.riskHi95 * 100).toFixed(2)),
    ],
  }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <XAxis dataKey="horizon" tickFormatter={(v) => `${v}y`} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <Tooltip formatter={(v: any) => (typeof v === "number" ? `${v.toFixed(1)}%` : v)} />
          <Area dataKey="band95" stroke="none" fill="#94c5e8" fillOpacity={0.3} isAnimationActive={false} />
          <Area dataKey="band80" stroke="none" fill="#4c8fc1" fillOpacity={0.4} isAnimationActive={false} />
          <Line dataKey="risk" stroke="#2b6cb0" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
