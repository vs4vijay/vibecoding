import type { SeriesStatus } from '../api';

const LABELS: Record<SeriesStatus, string> = {
  new: 'New',
  review: 'Under Review',
  accepted: 'Accepted',
  superseded: 'Superseded',
  rejected: 'Rejected',
  merged: 'Merged',
  ignored: 'Ignored',
};

const COLORS: Record<SeriesStatus, string> = {
  new: 'var(--status-new)',
  review: 'var(--status-review)',
  accepted: 'var(--status-accepted)',
  superseded: 'var(--status-superseded)',
  rejected: 'var(--status-rejected)',
  merged: 'var(--status-merged)',
  ignored: 'var(--status-ignored)',
};

export function StatusBadge({ status }: { status: SeriesStatus }) {
  return (
    <span className="badge" style={{ backgroundColor: COLORS[status] ?? 'var(--muted)' }}>
      {LABELS[status] ?? status}
    </span>
  );
}
