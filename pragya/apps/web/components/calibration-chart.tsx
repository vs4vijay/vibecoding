"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function CalibrationChart({
  horizon,
  bins,
}: {
  horizon: string;
  bins: Array<{ predicted: number; observed: number; n: number }>;
}) {
  // Add a reference y=x line so deviations are visually obvious.
  const data = bins.map((b) => ({
    predicted: Number((b.predicted * 100).toFixed(2)),
    observed: Number((b.observed * 100).toFixed(2)),
    ref: Number((b.predicted * 100).toFixed(2)),
    n: b.n,
  }));
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500">Horizon: {horizon}y</div>
      <div className="h-48">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="predicted"
              type="number"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              label={{ value: "Predicted", position: "insideBottom", offset: -2, fontSize: 10 }}
            />
            <YAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              label={{ value: "Observed", angle: -90, position: "insideLeft", fontSize: 10 }}
            />
            <Tooltip formatter={(v: any, n: any) => (typeof v === "number" ? `${v.toFixed(1)}%` : v)} />
            <Line dataKey="ref" stroke="#94a3b8" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line dataKey="observed" stroke="#2b6cb0" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
