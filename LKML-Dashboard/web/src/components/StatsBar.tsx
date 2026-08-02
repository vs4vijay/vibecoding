import type { Stats } from '../api';

export function StatsBar({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="stats-bar">Loading stats...</div>;

  const chips = [
    { label: 'Series', value: stats.series },
    { label: 'Patches', value: stats.patches },
    { label: 'Reviews', value: stats.reviews },
  ];

  return (
    <div className="stats-bar">
      {chips.map((c) => (
        <div className="stat" key={c.label}>
          <span className="stat-value">{c.value}</span>
          <span className="stat-label">{c.label}</span>
        </div>
      ))}
      {stats.byStatus.map((s) => (
        <div className="stat" key={s.status}>
          <span className="stat-value">{s.count}</span>
          <span className="stat-label">{s.status}</span>
        </div>
      ))}
      {stats.lastRun ? (
        <div className="stat stat-wide">
          <span className="stat-label">
            last ingest: {stats.lastRun.fallbackUsed ? 'sample (source fallback)' : stats.lastRun.source}
            {' · '}
            {new Date(stats.lastRun.at).toLocaleString()}
          </span>
        </div>
      ) : null}
    </div>
  );
}
