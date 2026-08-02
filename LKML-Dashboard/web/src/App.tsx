import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import {
  enqueueJob,
  fetchConfig,
  fetchJobs,
  fetchSeries,
  fetchStats,
  type Job,
  type PublicConfig,
  type SeriesItem,
  type Stats,
} from './api';
import { FilterBar, type Filters } from './components/FilterBar';
import { JobsPanel } from './components/JobsPanel';
import { SeriesList } from './components/SeriesList';
import { StatsBar } from './components/StatsBar';

const REFRESH_MS = 30_000;

export default function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<SeriesItem[]>([]);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [filters, setFilters] = useState<Filters>({ status: '', source: '', q: '' });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [statsData, seriesData, jobsData, configData] = await Promise.all([
        fetchStats(),
        fetchSeries(filtersRef.current),
        fetchJobs(),
        fetchConfig(),
      ]);
      setStats(statsData);
      setItems(seriesData.items);
      setTotal(seriesData.total);
      setJobs(jobsData.items);
      setConfig(configData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    registerSW({ immediate: true });
  }, []);

  const triggerIngest = useCallback(async () => {
    setBusy(true);
    try {
      await enqueueJob('ingest.series', {});
      setError(null);
      setTimeout(() => void refresh(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [refresh]);

  const onFiltersChange = useCallback(
    (f: Filters) => {
      setFilters(f);
      void fetchSeries(f).then((res) => {
        setItems(res.items);
        setTotal(res.total);
      }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    },
    [],
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img src="/icon.svg" alt="" width="34" height="34" />
          <div>
            <h1>LKML Patch Review Dashboard</h1>
            <p className="subtitle">
              Patch series from the Linux Kernel Mailing List
              {config ? (
                <>
                  {' '}
                  · source <code>{config.lkmlSource}</code> · db{' '}
                  <code>{config.dbBackend}</code>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <div className="banner banner-error">API error: {error}</div> : null}

      <StatsBar stats={stats} />

      <FilterBar initial={filters} onChange={onFiltersChange} busy={busy} />

      <main className="layout">
        <section className="content">
          <SeriesList items={items} total={total} />
        </section>
        <JobsPanel jobs={jobs} busy={busy} onTriggerIngest={() => void triggerIngest()} />
      </main>

      <footer className="app-footer">
        <span>
          Auto-refresh every {REFRESH_MS / 1000}s · Background ingest via Postgres queue
        </span>
        {stats?.lastRun ? (
          <span className="footer-last">
            last ingest: {stats.lastRun.fallbackUsed ? `sample (${stats.lastRun.requestedSource} unavailable)` : stats.lastRun.source}{' '}
            · fetched {stats.lastRun.fetched} · inserted {stats.lastRun.inserted} · updated{' '}
            {stats.lastRun.updated} · {new Date(stats.lastRun.at).toLocaleString()}
          </span>
        ) : null}
      </footer>
    </div>
  );
}
