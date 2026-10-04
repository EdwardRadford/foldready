import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/web/admin-auth';
import { listJobs, storageUsage } from '@/web/jobs';
import type { Job } from '@/engine/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin — Fold Ready',
  robots: { index: false, follow: false },
};

type Filter = 'all' | 'patchable' | 'passes' | 'needs-more' | 'error';

const CHIPS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'patchable', label: 'Patchable' },
  { id: 'passes', label: 'Passes' },
  { id: 'needs-more', label: 'Needs more' },
  { id: 'error', label: 'Error' },
];

function category(job: Job): Filter {
  if (job.state === 'error') return 'error';
  if (job.result?.outcome) return job.result.outcome;
  return 'all';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireAdmin();

  const { filter: rawFilter } = await searchParams;
  const filter: Filter = CHIPS.some((c) => c.id === rawFilter) ? (rawFilter as Filter) : 'all';

  const [jobs, storage] = await Promise.all([listJobs(), storageUsage()]);
  const shown = filter === 'all' ? jobs : jobs.filter((j) => category(j) === filter);

  return (
    <div className="wrap">
      <div className="admin-page">
        <div className="admin-head">
          <h1>Jobs</h1>
          <Link className="btn-quiet btn" href="/admin/stats">
            Stats
          </Link>
          <form method="post" action="/api/admin/logout">
            <button className="btn-quiet btn" type="submit">
              Sign out
            </button>
          </form>
        </div>
        <p className="admin-counts">
          {jobs.length} job{jobs.length === 1 ? '' : 's'} · {formatBytes(storage.bytes)}{' '}
          {storage.label}
        </p>

        <div className="chip-row">
          {CHIPS.map((chip) => (
            <Link
              key={chip.id}
              href={chip.id === 'all' ? '/admin' : `/admin?filter=${chip.id}`}
              className={`chip${filter === chip.id ? ' on' : ''}`}
            >
              {chip.label}
            </Link>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="admin-empty">No jobs here.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>URL</th>
                  <th>State</th>
                  <th>Outcome</th>
                  <th>Score</th>
                  <th>Engine</th>
                  <th>Duration</th>
                  <th>Platform</th>
                  <th>Link</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((job) => (
                  <tr key={job.id}>
                    <td>{relativeTime(job.createdAt)}</td>
                    <td className="url" title={job.url}>
                      {job.url}
                    </td>
                    <td>{job.state}</td>
                    <td>{job.result?.outcome ?? '—'}</td>
                    <td>{job.result?.score ?? '—'}</td>
                    <td>{job.result?.engineVersion ?? '—'}</td>
                    <td>{formatDuration(job.result?.durationMs)}</td>
                    <td>{job.result?.platform ?? '—'}</td>
                    <td>
                      <Link href={`/r/${job.id}`}>view</Link>
                    </td>
                    <td>
                      <form method="post" action={`/api/admin/jobs/${job.id}/delete`}>
                        <button className="del-btn" type="submit">
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
