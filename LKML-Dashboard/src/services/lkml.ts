import { count, eq } from 'drizzle-orm';
import type { AppDb } from '../db/client';
import { patches, patchSeries, reviews, type ReviewKind, type SeriesStatus } from '../db/schema';
import { config } from '../config';

export interface SeriesPatchInput {
  position: number;
  subject: string;
  messageId?: string;
  state?: string;
  added?: number;
  removed?: number;
}

export interface SeriesReviewInput {
  author: string;
  kind: ReviewKind;
  subject?: string;
  body?: string;
  date: Date;
}

export interface SeriesSummary {
  messageId: string;
  subject: string;
  author: string;
  authorEmail?: string;
  date: Date;
  version: number;
  numPatches: number;
  status: SeriesStatus;
  source: string;
  project?: string;
  webUrl?: string;
  threadUrl?: string;
  coverLetter?: string;
  summary?: string;
  tags: string[];
  patches: SeriesPatchInput[];
  reviews: SeriesReviewInput[];
}

export type LkmlSource = 'patchwork' | 'lore' | 'sample';

export class LkmlFetchError extends Error {}

export interface IngestResult {
  source: string;
  fetched: number;
  inserted: number;
  updated: number;
  elapsedMs: number;
}

function parsePatchName(name: string): { version: number; position: number; total: number } {
  let version = 1;
  let position = 0;
  let total = 0;
  const v = name.match(/\[[^\]]*\bv(\d+)\b/i);
  if (v) version = Number.parseInt(v[1] ?? '1', 10) || 1;
  const pos = name.match(/\[[^\]]*?(\d+)\s*\/\s*(\d+)\]/);
  if (pos) {
    position = Number.parseInt(pos[1] ?? '0', 10) || 0;
    total = Number.parseInt(pos[2] ?? '0', 10) || 0;
  }
  return { version, position, total };
}

function extractTags(name: string): string[] {
  const m = name.match(/^\[([^\]]+)\]/);
  if (!m) return [];
  return (m[1] ?? '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 6);
}

export function deriveSeriesStatus(states: string[]): SeriesStatus {
  const seen = new Set(states.map((s) => s.toLowerCase()));
  if ([...seen].some((s) => s.includes('accept') || s.includes('merged'))) return 'accepted';
  if ([...seen].some((s) => s.includes('reject') || s.includes('withdrawn') || s.includes('nacked'))) return 'rejected';
  if ([...seen].some((s) => s.includes('superseded'))) return 'superseded';
  if (
    [...seen].some(
      (s) => s.includes('under review') || s.includes('changes requested') || s.includes('deferred'),
    )
  ) {
    return 'review';
  }
  return 'new';
}

function patchworkStateToStatus(state: string | undefined): SeriesStatus {
  if (!state) return 'new';
  return deriveSeriesStatus([state]);
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.LKML_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'lkml-pr-dashboard/0.1' },
      signal: controller.signal,
    });
    if (!res.ok) throw new LkmlFetchError(`GET ${url} -> HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

interface PwSeriesRef {
  id: number;
  name: string;
  version?: number | null;
  web_url?: string | null;
  date?: string | null;
}

interface PwPatch {
  msgid?: string;
  name?: string | null;
  date?: string | null;
  state?: string | null;
  submitter?: { name?: string | null; email?: string | null } | null;
  series?: PwSeriesRef[] | null;
  project?: {
    link_name?: string | null;
    list_archive_url_format?: string | null;
  } | null;
}

export async function fetchSeriesFromPatchwork(limit: number): Promise<SeriesSummary[]> {
  const perPage = Math.min(limit, 100);
  const url = `https://patchwork.kernel.org/api/1.3/patches/?order=-date&limit=${perPage}&expand=series&expand=project&expand=submitter`;
  const data = (await fetchJson(url)) as PwPatch[];
  if (!Array.isArray(data)) throw new LkmlFetchError('patchwork returned unexpected payload');

  const bySeries = new Map<number, { ref: PwSeriesRef; patches: PwPatch[] }>();
  for (const patch of data) {
    const series = patch.series?.[0];
    if (!series) continue;
    const entry = bySeries.get(series.id) ?? { ref: series, patches: [] };
    entry.patches.push(patch);
    bySeries.set(series.id, entry);
  }

  const out: SeriesSummary[] = [];
  for (const { ref, patches: group } of bySeries.values()) {
    const sorted = [...group].sort((a, b) => {
      const pa = parsePatchName(a.name ?? '');
      const pb = parsePatchName(b.name ?? '');
      return pa.position - pb.position;
    });
    const first = sorted[0];
    if (!first) continue;
    const name = ref.name?.trim() || first.name?.trim() || '';
    const submitter = first.submitter;
    const author = submitter?.name?.trim() || submitter?.email || 'Unknown';
    const authorEmail = submitter?.email ?? undefined;
    const messageId = first.msgid?.replace(/[<>]/g, '') ?? `patchwork-series-${ref.id}`;
    const threadUrl =
      first.project?.list_archive_url_format?.replace('{}', first.msgid ?? '') ?? undefined;
    const states = sorted.map((p) => p.state ?? 'new');
    const date = new Date(ref.date ?? first.date ?? new Date().toISOString());
    const parsedVersion = parsePatchName(name).version;

    out.push({
      messageId,
      subject: name,
      author,
      authorEmail,
      date,
      version: ref.version ?? parsedVersion,
      numPatches: sorted.length,
      status: deriveSeriesStatus(states),
      source: 'patchwork',
      project: first.project?.link_name ?? undefined,
      webUrl: ref.web_url ?? undefined,
      threadUrl,
      coverLetter: undefined,
      tags: extractTags(name),
      patches: sorted.map((p) => {
        const parsed = parsePatchName(p.name ?? '');
        return {
          position: parsed.position || 0,
          subject: p.name ?? '',
          messageId: p.msgid?.replace(/[<>]/g, ''),
          state: p.state ?? 'New',
        };
      }),
      reviews: [],
    });
  }
  return out;
}

export async function fetchSeriesFromLore(limit: number): Promise<SeriesSummary[]> {
  const url = `https://lore.kernel.org/all/?q=PATCH&x=a&o=1&n=${limit}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'lkml-pr-dashboard/0.1', accept: 'application/atom+xml' },
    signal: AbortSignal.timeout(config.LKML_HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new LkmlFetchError(`GET ${url} -> HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes('anubis') || text.includes('Oh noes')) {
    throw new LkmlFetchError('lore.kernel.org is protected by Anubis anti-bot; use source=patchwork or sample');
  }
  const summaries: SeriesSummary[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = entryRe.exec(text)) && summaries.length < limit) {
    idx += 1;
    const entry = m[1] ?? '';
    const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1]?.trim() ?? '';
    if (!/\[PATCH/i.test(title)) continue;
    const author = /<author>[\s\S]*?<name>([^<]*)<\/name>/.exec(entry)?.[1]?.trim() ?? 'Unknown';
    const updated = /<updated>([^<]*)<\/updated>/.exec(entry)?.[1] ?? '';
    const id = /<id>([^<]*)<\/id>/.exec(entry)?.[1] ?? `lore-${idx}`;
    const parsed = parsePatchName(title);
    summaries.push({
      messageId: id.replace(/^<|>$/g, ''),
      subject: title,
      author,
      date: new Date(updated),
      version: parsed.version,
      numPatches: parsed.total || 1,
      status: 'new',
      source: 'lore',
      threadUrl: `https://lore.kernel.org/all/${id.replace(/^<|>$/g, '')}`,
      tags: extractTags(title),
      patches: [
        {
          position: parsed.position || 1,
          subject: title,
          state: 'New',
        },
      ],
      reviews: [],
    });
  }
  if (summaries.length === 0) throw new LkmlFetchError('lore returned no patch series');
  return summaries;
}

/* ---------- deterministic sample data (offline + tests) ---------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_SUBJECTS = [
  ['net: ixgbe: fix use-after-free in reset path', 6],
  ['mm: use VMA lock for kernel faults on user addresses', 2],
  ['iio: adc: pac1934: add missing mutex in trigger handler', 1],
  ['crypto: hisilicon/sec - fix element drop and UAF in sec_send_request()', 1],
  ['drm/i915: handle display hotplug on probe', 3],
  ['wifi: mac80211: disconnect on CSA to channel 0', 1],
  ['usb: dwc3: gadget: avoid NULL deref in ep disable', 2],
  ['dt-bindings: net: qcom,ethqos: document SM8475 ethernet', 1],
  ['fs/btrfs: fix directory fsync after rename', 4],
  ['selftests: kvm: add test for vmx eoi bitmap', 2],
  ['pinctrl: qcom: add SM8475 TLMM pinctrl support', 3],
  ['bluetooth: fix OOB read in AVRCP GetFolderItems parsing', 1],
  ['ALSA: hda/realtek: add quirk for LG gram 16', 1],
  ['power: supply: ucs1002: fix use-after-free on remove', 1],
  ['io_uring/cmd: fix iovec leak when async cmd is not recycled', 1],
  ['hwmon: (nct7904) fix temperature limit register', 1],
  ['tracing: wprobe: x86: add wprobe for watchpoint', 11],
  ['perf: make perf_event_open return EINVAL for cpu < 0', 1],
  ['block: fix blk_mq timeout handling for passthrough', 2],
  ['arm64: dts: qcom: sm8650: add ethernet node', 2],
  ['bpf: selftests: fix verifier test expectation', 1],
  ['vfio/pci: enable MSI-X in a more robust order', 3],
  ['netfilter: nf_tables: fix table lock ordering', 2],
  ['x86/kvm: fix VM-exit due to emulator stack misalignment', 1],
  ['input: synaptics: handle PS/2 probe failure', 1],
] as const;

const SAMPLE_AUTHORS: ReadonlyArray<[string, string]> = [
  ['Ada Kernel Maintainer', 'ada@example.org'],
  ['Kai Review Bot', 'kai@example.org'],
  ['Sam Plumber', 'sam@example.org'],
  ['Mira Driver Dev', 'mira@example.org'],
  ['Leo Optimizer', 'leo@example.org'],
  ['Nia Testrunner', 'nia@example.org'],
  ['Omar Filesystem Fixer', 'omar@example.org'],
  ['Eva Power Domain', 'eva@example.org'],
  ['Ben Networking', 'ben@example.org'],
  ['Riya Display Team', 'riya@example.org'],
];

const SAMPLE_REVIEWERS: ReadonlyArray<[string, ReviewKind, string]> = [
  ['Kai Review Bot', 'acked', 'Reviewed-by: Kai Review Bot <kai@example.org>'],
  ['Sam Plumber', 'reviewed', 'The refactoring looks good to me. One nit: please drop the stray blank line.'],
  ['Mira Driver Dev', 'tested', 'Tested on QEMU arm64 and x86_64, works as expected.'],
  ['Leo Optimizer', 'comment', 'Would it be cheaper to use xchg here instead of a full spinlock?'],
  ['Nia Testrunner', 'nacked', 'This breaks the existing selftest for CONFIG_DEBUG_VM. Please rebase.'],
  ['Omar Filesystem Fixer', 'reviewed', 'Series looks correct. Please also update the documentation patch.'],
  ['Eva Power Domain', 'acked', 'Acked-by: Eva Power Domain <eva@example.org>'],
  ['Ben Networking', 'comment', 'Can we split patch 2 into two logical changes?'],
];

const SAMPLE_PATCH_TITLES = [
  'add support for the new register layout',
  'fix off-by-one in ring buffer accounting',
  'convert to devm_platform_ioremap_resource',
  'document the new device-tree binding',
  'handle short reads from the hardware FIFO',
  'drop redundant locking in the hot path',
  'refresh the selftest expectations',
  'update the MAINTAINERS entry',
];

function generateSampleSeries(seed: number, limit: number, nowMs: number = Date.now()): SeriesSummary[] {
  const rnd = mulberry32(seed);
  const now = nowMs;
  const out: SeriesSummary[] = [];
  const used = new Set<number>();

  for (let i = 0; i < limit; i++) {
    let idx = Math.floor(rnd() * SAMPLE_SUBJECTS.length);
    while (used.has(idx)) idx = Math.floor(rnd() * SAMPLE_SUBJECTS.length);
    used.add(idx);
    const [base, size] = SAMPLE_SUBJECTS[idx]!;
    const [author, email] = SAMPLE_AUTHORS[Math.floor(rnd() * SAMPLE_AUTHORS.length)]!;
    const version = 1 + Math.floor(rnd() * 3);
    const numPatches = size;
    const statusRoll = rnd();
    const status: SeriesStatus =
      statusRoll < 0.3 ? 'new' : statusRoll < 0.55 ? 'review' : statusRoll < 0.7 ? 'accepted' : statusRoll < 0.82 ? 'superseded' : statusRoll < 0.92 ? 'merged' : 'rejected';
    const date = new Date(now - Math.floor(rnd() * 6) * 86_400_000 - Math.floor(rnd() * 86_400_000));

    const patchesList: SeriesPatchInput[] = [];
    for (let p = 1; p <= numPatches; p++) {
      const title = p === 1 ? base : SAMPLE_PATCH_TITLES[Math.floor(rnd() * SAMPLE_PATCH_TITLES.length)]!;
      patchesList.push({
        position: p,
        subject: `[PATCH v${version} ${p}/${numPatches}] ${title}`,
        messageId: `<20260802.${(i + 1).toString(36)}${p}.${email}>`,
        state: status === 'accepted' && p === 1 ? 'Accepted' : status === 'superseded' ? 'Superseded' : status === 'rejected' ? 'Rejected' : status === 'merged' ? 'Accepted' : rnd() < 0.3 ? 'Under Review' : 'New',
      });
    }

    const reviewsList: SeriesReviewInput[] = [];
    const numReviews = status === 'review' || status === 'accepted' ? 2 + Math.floor(rnd() * 2) : Math.floor(rnd() * 2);
    for (let r = 0; r < numReviews; r++) {
      const [authorName, kind, body] = SAMPLE_REVIEWERS[Math.floor(rnd() * SAMPLE_REVIEWERS.length)]!;
      reviewsList.push({
        author: authorName,
        kind,
        subject: `Re: [PATCH v${version} ${numPatches}/${numPatches}] ${base}`,
        body,
        date: new Date(date.getTime() + Math.floor(rnd() * 60_000) + 3_600_000),
      });
    }

    out.push({
      messageId: `sample-2026${(i + 1).toString().padStart(4, '0')}-${email.split('@')[0]}`,
      subject: `[PATCH v${version} 0/${numPatches}] ${base}`,
      author,
      authorEmail: email,
      date,
      version,
      numPatches,
      status,
      source: 'sample',
      project: idx % 2 === 0 ? 'linux-kernel' : undefined,
      webUrl: undefined,
      threadUrl: `https://lore.kernel.org/all/sample-2026${(i + 1).toString().padStart(4, '0')}/`,
      tags: ['PATCH', ...(version > 1 ? [`V${version}`] : [])],
      patches: patchesList,
      reviews: reviewsList,
    });
  }
  out.sort((a, b) => b.date.getTime() - a.date.getTime());
  return out;
}

export function generateSampleSeriesPublic(
  seed: number,
  limit: number,
  nowMs?: number,
): SeriesSummary[] {
  return generateSampleSeries(seed, limit, nowMs);
}

export async function fetchRecentSeries(source: LkmlSource, limit: number): Promise<SeriesSummary[]> {
  switch (source) {
    case 'patchwork':
      return fetchSeriesFromPatchwork(limit);
    case 'lore':
      return fetchSeriesFromLore(limit);
    case 'sample':
      return generateSampleSeries(20260802, limit);
    default:
      throw new LkmlFetchError(`unknown source: ${String(source)}`);
  }
}

/* ---------- persistence ---------- */

function summaryToRow(s: SeriesSummary) {
  return {
    messageId: s.messageId,
    subject: s.subject,
    author: s.author,
    authorEmail: s.authorEmail,
    date: s.date,
    version: s.version,
    numPatches: s.numPatches,
    status: s.status,
    source: s.source,
    project: s.project,
    webUrl: s.webUrl,
    threadUrl: s.threadUrl,
    coverLetter: s.coverLetter,
    summary: s.summary,
    tags: s.tags,
    updatedAt: new Date(),
  };
}

export async function upsertSeries(db: AppDb, summaries: SeriesSummary[]): Promise<IngestResult> {
  const started = Date.now();
  let inserted = 0;
  let updated = 0;
  for (const s of summaries) {
    const existing = await db.query.patchSeries.findFirst({
      where: eq(patchSeries.messageId, s.messageId),
    });

    let seriesId: string;
    if (existing) {
      const [row] = await db
        .update(patchSeries)
        .set(summaryToRow(s))
        .where(eq(patchSeries.id, existing.id))
        .returning();
      seriesId = row?.id ?? existing.id;
      updated += 1;
    } else {
      const [row] = await db
        .insert(patchSeries)
        .values(summaryToRow(s))
        .returning();
      seriesId = row?.id ?? '';
      inserted += 1;
    }

    if (!seriesId) continue;

    await db.delete(patches).where(eq(patches.seriesId, seriesId));
    await db.delete(reviews).where(eq(reviews.seriesId, seriesId));

    if (s.patches.length > 0) {
      await db.insert(patches).values(
        s.patches.map((p) => ({
          seriesId,
          position: p.position,
          subject: p.subject,
          messageId: p.messageId,
          state: p.state,
          diffStats: p.added || p.removed ? { added: p.added ?? 0, removed: p.removed ?? 0 } : null,
        })),
      );
    }
    if (s.reviews.length > 0) {
      await db.insert(reviews).values(
        s.reviews.map((r) => ({
          seriesId,
          kind: r.kind,
          author: r.author,
          subject: r.subject,
          body: r.body,
          date: r.date,
        })),
      );
    }
  }
  return { source: summaries[0]?.source ?? 'unknown', fetched: summaries.length, inserted, updated, elapsedMs: Date.now() - started };
}

export async function countSeries(db: AppDb): Promise<number> {
  const [row] = await db.select({ value: count() }).from(patchSeries);
  return row?.value ?? 0;
}
