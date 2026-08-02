import type { SeriesDetail } from '../api';
import { StatusBadge } from './StatusBadge';

const REVIEW_ICON: Record<string, string> = {
  acked: 'Ack',
  reviewed: 'Rv',
  tested: 'T',
  nacked: 'Nak',
  comment: 'C',
};

function DiffStat({ added, removed }: { added?: number; removed?: number }) {
  if (added === undefined && removed === undefined) return null;
  return (
    <span className={`diffstat ${removed ? 'diff-removed' : 'diff-added'}`}>
      +{added ?? 0}/-{removed ?? 0}
    </span>
  );
}

export function SeriesDetailView({
  detail,
  error,
  busy,
  onClose,
}: {
  detail: SeriesDetail | null;
  error: string | null;
  busy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="detail">
      {error ? <div className="detail-error">Failed to load detail: {error}</div> : null}
      {busy && !detail ? <div className="detail-loading">Loading detail…</div> : null}
      {detail ? (
        <>
          <div className="detail-head">
            <div className="detail-title">
              <h3>{detail.subject}</h3>
              <div className="detail-tags">
                <StatusBadge status={detail.status} />
                <span className="chip">v{detail.version}</span>
                <span className="chip">{detail.patchCount}/{detail.numPatches} patches</span>
                <span className="chip">{detail.reviewCount} reviews</span>
              </div>
            </div>
            <div className="detail-links">
              {detail.threadUrl ? (
                <a href={detail.threadUrl} target="_blank" rel="noreferrer">
                  lore thread ↗
                </a>
              ) : null}
              {detail.webUrl ? (
                <a href={detail.webUrl} target="_blank" rel="noreferrer">
                  patchwork ↗
                </a>
              ) : null}
              <button className="btn btn-small" onClick={onClose}>
                Close
              </button>
            </div>
          </div>

          <div className="detail-author">
            by <strong>{detail.author}</strong>
            {detail.authorEmail ? ` <${detail.authorEmail}>` : ''} ·{' '}
            {new Date(detail.date).toLocaleString()}
          </div>

          <section>
            <h4>Patches ({detail.patches.length})</h4>
            <ul className="patch-list">
              {detail.patches.map((p) => (
                <li key={p.id} className="patch-item">
                  <span className="patch-pos">{p.position}</span>
                  <span className="patch-subject">{p.subject}</span>
                  <DiffStat added={p.diffStats?.added} removed={p.diffStats?.removed} />
                  <span className="patch-state">{p.state}</span>
                </li>
              ))}
            </ul>
          </section>

          {detail.reviews.length > 0 ? (
            <section>
              <h4>Reviews ({detail.reviews.length})</h4>
              <ul className="review-list">
                {detail.reviews.map((r) => (
                  <li key={r.id} className={`review-item review-${r.kind}`}>
                    <span className="review-icon">{REVIEW_ICON[r.kind] ?? 'C'}</span>
                    <span className="review-body">
                      <span className="review-author">{r.author}</span>
                      {r.body ? <span className="review-text">{r.body}</span> : null}
                      <span className="review-date">{new Date(r.date).toLocaleString()}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
