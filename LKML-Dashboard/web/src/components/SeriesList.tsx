import { useState } from 'react';
import { fetchSeriesDetail, type SeriesDetail, type SeriesItem } from '../api';
import { StatusBadge } from './StatusBadge';
import { SeriesDetailView } from './SeriesDetail';

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  if (diff < 0) return 'now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Row({ item, onToggle, open, busy }: {
  item: SeriesItem;
  onToggle: () => void;
  open: boolean;
  busy: boolean;
}) {
  return (
    <button type="button" className="row" onClick={onToggle} aria-expanded={open}>
      <div className="row-main">
        <span className="row-subject">{item.subject}</span>
        <span className="row-meta">
          <StatusBadge status={item.status} />
          <span className="chip">v{item.version}</span>
          <span className="chip">{item.patchCount}/{item.numPatches} patches</span>
          <span className="chip">{item.reviewCount} reviews</span>
          <span className="chip chip-source">{item.source}</span>
          {item.project ? <span className="chip chip-project">{item.project}</span> : null}
        </span>
      </div>
      <div className="row-side">
        <span className="row-author">{item.author}</span>
        <span className="row-date" title={new Date(item.date).toLocaleString()}>
          {relativeTime(item.date)}
        </span>
        <span className="row-caret">{open ? '▾' : '▸'}</span>
      </div>
      {busy && open ? <span className="row-busy">loading…</span> : null}
    </button>
  );
}

export function SeriesList({ items, total }: { items: SeriesItem[]; total: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (item: SeriesItem) => {
    if (openId === item.id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(item.id);
    setBusy(true);
    setError(null);
    try {
      const res = await fetchSeriesDetail(item.id);
      setDetail(res.series);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="series-list">
      <div className="list-head">
        <span>{items.length} of {total} series</span>
      </div>
      {items.map((item) => (
        <div key={item.id}>
          <Row item={item} onToggle={() => void toggle(item)} open={openId === item.id} busy={busy} />
          {openId === item.id ? (
            <SeriesDetailView
              detail={detail}
              error={error}
              busy={busy}
              onClose={() => {
                setOpenId(null);
                setDetail(null);
              }}
            />
          ) : null}
        </div>
      ))}
      {items.length === 0 ? <div className="empty">No series match the current filters.</div> : null}
    </div>
  );
}
