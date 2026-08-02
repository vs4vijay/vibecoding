import { useState } from 'react';
import type { SeriesStatus } from '../api';

const STATUSES: (SeriesStatus | '')[] = [
  '',
  'new',
  'review',
  'accepted',
  'superseded',
  'rejected',
  'merged',
];

export interface Filters {
  status: SeriesStatus | '';
  source: string;
  q: string;
}

export function FilterBar({
  initial,
  onChange,
  busy,
}: {
  initial: Filters;
  onChange: (f: Filters) => void;
  busy: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(initial);
  const [q, setQ] = useState(initial.q);

  const apply = (next: Filters) => {
    setFilters(next);
    onChange(next);
  };

  return (
    <div className="filter-bar">
      <input
        type="search"
        placeholder="Search subject..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply({ ...filters, q: q.trim() });
        }}
      />
      <select
        value={filters.status}
        onChange={(e) => apply({ ...filters, status: e.target.value as SeriesStatus | '' })}
      >
        <option value="">all statuses</option>
        {STATUSES.filter(Boolean).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        value={filters.source}
        onChange={(e) => apply({ ...filters, source: e.target.value })}
      >
        <option value="">all sources</option>
        <option value="patchwork">patchwork</option>
        <option value="lore">lore</option>
        <option value="sample">sample</option>
      </select>
      <button className="btn" disabled={busy} onClick={() => onChange(filters)}>
        {busy ? 'Loading...' : 'Apply'}
      </button>
    </div>
  );
}
