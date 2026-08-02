import type { Job } from '../api';

const JOB_BADGE: Record<Job['status'], string> = {
  pending: 'var(--status-new)',
  running: 'var(--status-review)',
  done: 'var(--status-accepted)',
  failed: 'var(--status-rejected)',
  cancelled: 'var(--status-ignored)',
};

export function JobsPanel({
  jobs,
  busy,
  onTriggerIngest,
}: {
  jobs: Job[];
  busy: boolean;
  onTriggerIngest: () => void;
}) {
  return (
    <aside className="jobs-panel">
      <div className="jobs-head">
        <h3>Background Jobs</h3>
        <button className="btn btn-small" disabled={busy} onClick={onTriggerIngest}>
          {busy ? 'Enqueuing…' : 'Trigger ingest'}
        </button>
      </div>
      <p className="jobs-note">
        Worker uses PostgreSQL <code>LISTEN / NOTIFY</code> +{' '}
        <code>FOR UPDATE SKIP LOCKED</code> for exactly-once claim.
      </p>
      <ul className="jobs-list">
        {jobs.slice(0, 12).map((job) => (
          <li key={job.id} className="job-item">
            <span className="job-dot" style={{ backgroundColor: JOB_BADGE[job.status] }} />
            <span className="job-info">
              <span className="job-type">{job.type}</span>
              <span className="job-status">
                {job.status}
                {job.attempts > 1 ? ` · ${job.attempts} attempts` : ''}
              </span>
              {job.error ? <span className="job-error">{job.error}</span> : null}
            </span>
            <span className="job-time">{new Date(job.createdAt).toLocaleTimeString()}</span>
          </li>
        ))}
      </ul>
      {jobs.length === 0 ? <div className="empty">No jobs yet.</div> : null}
    </aside>
  );
}
