export type SeriesStatus =
  | 'new'
  | 'review'
  | 'accepted'
  | 'superseded'
  | 'rejected'
  | 'merged'
  | 'ignored';

export type ReviewKind = 'comment' | 'acked' | 'reviewed' | 'tested' | 'nacked';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SeriesItem {
  id: string;
  messageId: string;
  subject: string;
  author: string;
  authorEmail?: string;
  date: string;
  version: number;
  numPatches: number;
  status: SeriesStatus;
  source: string;
  project?: string;
  webUrl?: string;
  threadUrl?: string;
  tags: string[];
  patchCount: number;
  reviewCount: number;
}

export interface Patch {
  id: string;
  position: number;
  subject: string;
  messageId?: string;
  state?: string;
  diffStats?: { added: number; removed: number } | null;
}

export interface Review {
  id: string;
  kind: ReviewKind;
  author: string;
  subject?: string;
  body?: string;
  date: string;
}

export interface SeriesDetail extends SeriesItem {
  patches: Patch[];
  reviews: Review[];
}

export interface Stats {
  series: number;
  patches: number;
  reviews: number;
  byStatus: { status: SeriesStatus; count: number }[];
  bySource: { source: string; count: number }[];
  lastRun: {
    source: string;
    requestedSource: string;
    fetched: number;
    inserted: number;
    updated: number;
    fallbackUsed: boolean;
    at: string;
  } | null;
}

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  availableAt: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface PublicConfig {
  dbBackend: string;
  lkmlSource: string;
  lkmlFetchLimit: number;
  lkmlFetchIntervalMs: number;
  workerConcurrency: number;
  autoIngest: boolean;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} -> HTTP ${res.status} ${text.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} -> HTTP ${res.status} ${text.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export interface SeriesListResponse {
  items: SeriesItem[];
  limit: number;
  offset: number;
  total: number;
}

export interface SeriesQuery {
  status?: SeriesStatus | '';
  source?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function fetchSeries(query: SeriesQuery = {}): Promise<SeriesListResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.source) params.set('source', query.source);
  if (query.q) params.set('q', query.q);
  params.set('limit', String(query.limit ?? 100));
  params.set('offset', String(query.offset ?? 0));
  return getJson<SeriesListResponse>(`/api/series?${params.toString()}`);
}

export function fetchSeriesDetail(id: string): Promise<{ series: SeriesDetail }> {
  return getJson<{ series: SeriesDetail }>(`/api/series/${id}`);
}

export function fetchStats(): Promise<Stats> {
  return getJson<Stats>('/api/stats');
}

export function fetchJobs(): Promise<{ items: Job[] }> {
  return getJson<{ items: Job[] }>('/api/jobs');
}

export function fetchMeta(): Promise<{ lastRun: Stats['lastRun'] }> {
  return getJson<{ lastRun: Stats['lastRun'] }>('/api/meta');
}

export function fetchConfig(): Promise<PublicConfig> {
  return getJson<PublicConfig>('/api/config');
}

export function enqueueJob(type: string, payload?: Record<string, unknown>): Promise<{ job: Job }> {
  return postJson<{ job: Job }>('/api/jobs', { type, payload });
}
