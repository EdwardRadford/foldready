import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/web/admin-auth';
import { statsContext } from '@/web/jobs';
import { statsSummary, type CountRow, type StatsSummary } from '@/web/stats';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Stats — Fold Ready',
  robots: { index: false, follow: false },
};

const WINDOWS = [7, 30, 90] as const;

const KIND_LABEL: Record<string, string> = {
  visit: 'Visit',
  check_started: 'Check started',
  check_cached: 'Check (reused result)',
  check_refused: 'Check refused',
  check_done: 'Check finished',
  check_failed: 'Check failed',
  check_stopped: 'Check stopped',
};

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CountTable({ title, rows, empty }: { title: string; rows: CountRow[]; empty: string }) {
  return (
    <section className="stats-block">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="admin-empty">{empty}</p>
      ) : (
        <table className="admin-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="url">{r.key}</td>
                <td className="num">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin();

  const { days: rawDays } = await searchParams;
  const windowDays = WINDOWS.find((w) => String(w) === rawDays) ?? 7;

  const stats = await statsContext();
  const summary: StatsSummary | undefined = stats ? await statsSummary(stats.db, windowDays) : undefined;

  return (
    <div className="wrap">
      <div className="admin-page">
        <div className="admin-head">
          <h1>Stats</h1>
          <Link className="btn-quiet btn" href="/admin">
            Jobs
          </Link>
        </div>

        <div className="chip-row">
          {WINDOWS.map((w) => (
            <Link key={w} href={`/admin/stats?days=${w}`} className={`chip${w === windowDays ? ' on' : ''}`}>
              Last {w} days
            </Link>
          ))}
        </div>

        {!summary ? (
          <p className="admin-empty">Stats are only kept on the live site.</p>
        ) : (
          <>
            <p className="admin-counts">
              {summary.totals.visitors} visitor-days · {summary.totals.views} page views ·{' '}
              {summary.totals.started + summary.totals.cached} checks asked for · {summary.totals.done} finished ·{' '}
              {summary.totals.failed + summary.totals.stopped} did not finish
            </p>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Day (UTC)</th>
                    <th className="num">Visitors</th>
                    <th className="num">Views</th>
                    <th className="num">Started</th>
                    <th className="num">Reused</th>
                    <th className="num">Refused</th>
                    <th className="num">Finished</th>
                    <th className="num">Failed</th>
                    <th className="num">Stopped</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.days.length === 0 ? (
                    <tr>
                      <td colSpan={9}>Nothing yet in this window.</td>
                    </tr>
                  ) : (
                    summary.days.map((d) => (
                      <tr key={d.day}>
                        <td>{d.day}</td>
                        <td className="num">{d.visitors}</td>
                        <td className="num">{d.views}</td>
                        <td className="num">{d.started}</td>
                        <td className="num">{d.cached}</td>
                        <td className="num">{d.refused}</td>
                        <td className="num">{d.done}</td>
                        <td className="num">{d.failed}</td>
                        <td className="num">{d.stopped}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="stats-grid">
              <CountTable title="Pages" rows={summary.pages} empty="No visits yet." />
              <CountTable title="Came from" rows={summary.referrers} empty="No referring sites yet." />
              <CountTable title="Countries" rows={summary.countries} empty="None recorded yet." />
              <CountTable title="Sites checked" rows={summary.domains} empty="No checks yet." />
            </div>

            <section className="stats-block">
              <h2>Latest</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>When (UK)</th>
                      <th>What</th>
                      <th>Page or site</th>
                      <th>From</th>
                      <th>Country</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.recent.map((r, i) => (
                      <tr key={`${r.at}-${i}`}>
                        <td>{when(r.at)}</td>
                        <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                        <td className="url">{r.path ?? r.domain ?? '—'}</td>
                        <td>{r.referrer ?? '—'}</td>
                        <td>{r.country ?? '—'}</td>
                        <td>{r.job_id ? <Link href={`/r/${r.job_id}`}>view</Link> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="note">
              Visitors are counted once a day from a hash that changes daily, so the total is visitor-days, not
              people. No cookies; your own visits are not counted while you are signed in here.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
