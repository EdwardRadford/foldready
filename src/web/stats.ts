// Usage stats, kept in D1 for the private /admin/stats page.
//
// Cookieless by design: nothing is written to the visitor's device, so there is nothing to ask
// consent for. Page views come from a beacon the page sends after it loads (/api/hit), which also
// keeps link-preview bots and crawlers out, since they do not run scripts. A visitor is counted
// once a day by hashing the IP and user agent with a random salt that lives for one day; raw IPs
// are never stored. Checks are counted server-side by the job store as they start and end.
//
// Recording is best effort: a stats write that fails never breaks a page or a check.

export type EventKind =
  | 'visit'
  | 'check_started'
  | 'check_cached'
  | 'check_refused'
  | 'check_done'
  | 'check_failed'
  | 'check_stopped';

export interface StatEvent {
  kind: EventKind;
  path?: string;
  domain?: string;
  jobId?: string;
  country?: string;
  referrer?: string;
  visitor?: string;
}

const EVENT_RETENTION_DAYS = 400;

/** YYYY-MM-DD in UTC. */
export function dayOf(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

const BOT_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|httpclient|go-http|axios|node-fetch/i;

/** Crawlers, link unfurlers and scripts. The beacon already excludes most of them. */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT_RE.test(userAgent);
}

/**
 * A page path for counting: no query or hash, and per-check pages folded together, because the
 * ids in them are noise in a table.
 */
export function cleanPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return undefined;
  let path = raw.split(/[?#]/)[0].slice(0, 200);
  if (path.length > 1) path = path.replace(/\/+$/, '');
  path = path.replace(/^\/r\/(?!sample$)[^/]+$/, '/r/:id').replace(/^\/fix\/[^/]+$/, '/fix/:id');
  if (path.startsWith('/admin') || path.startsWith('/api')) return undefined;
  return path;
}

/** The referring site's hostname, or undefined for none, ourselves, or junk. */
export function referrerHost(raw: unknown, ownHosts: string[] = []): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  let host: string;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    host = u.hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const bare = (h: string) => h.replace(/^www\./, '');
  if (ownHosts.some((own) => bare(own.toLowerCase()) === bare(host))) return undefined;
  return host.slice(0, 120);
}

/** The hostname of a checked site, for the domains table. */
export function domainOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Today's salt, created on first use. Older salts are deleted, which makes old hashes unlinkable. */
async function todaysSalt(db: D1Database, day: string): Promise<string> {
  const existing = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first<{ salt: string }>();
  if (existing) return existing.salt;
  await db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, randomSalt()).run();
  await db.prepare('DELETE FROM salts WHERE day < ?').bind(day).run();
  const row = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first<{ salt: string }>();
  return row?.salt ?? randomSalt();
}

/** A one-day pseudonym for a connection: salted hash of IP and user agent, 16 hex characters. */
export async function dailyHash(db: D1Database, ...parts: string[]): Promise<string> {
  const day = dayOf();
  const salt = await todaysSalt(db, day);
  return (await sha256Hex([salt, ...parts].join('|'))).slice(0, 16);
}

export async function recordEvent(db: D1Database, ev: StatEvent): Promise<void> {
  try {
    const now = new Date();
    await db
      .prepare(
        `INSERT INTO events (at, day, kind, path, domain, job_id, country, referrer, visitor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        now.toISOString(),
        dayOf(now),
        ev.kind,
        ev.path ?? null,
        ev.domain ?? null,
        ev.jobId ?? null,
        ev.country ?? null,
        ev.referrer ?? null,
        ev.visitor ?? null,
      )
      .run();
  } catch {
    // Stats are never worth failing a request over.
  }
}

/** Housekeeping for the store's hourly sweep. */
export async function sweepEvents(db: D1Database): Promise<void> {
  const cutoff = dayOf(new Date(Date.now() - EVENT_RETENTION_DAYS * 86400000));
  await db.prepare('DELETE FROM events WHERE day < ?').bind(cutoff).run();
}

// ---- Reading, for the admin page -------------------------------------------------------------

export interface DayRow {
  day: string;
  visitors: number;
  views: number;
  started: number;
  cached: number;
  refused: number;
  done: number;
  failed: number;
  stopped: number;
}

export interface CountRow {
  key: string;
  n: number;
}

export interface RecentRow {
  at: string;
  kind: EventKind;
  path: string | null;
  domain: string | null;
  job_id: string | null;
  country: string | null;
  referrer: string | null;
}

export interface StatsSummary {
  days: DayRow[];
  totals: DayRow;
  pages: CountRow[];
  referrers: CountRow[];
  countries: CountRow[];
  domains: CountRow[];
  recent: RecentRow[];
}

export async function statsSummary(db: D1Database, windowDays: number): Promise<StatsSummary> {
  const since = dayOf(new Date(Date.now() - (windowDays - 1) * 86400000));

  const byDay = await db
    .prepare(
      `SELECT day,
              count(DISTINCT CASE WHEN kind = 'visit' THEN visitor END) AS visitors,
              sum(kind = 'visit') AS views,
              sum(kind = 'check_started') AS started,
              sum(kind = 'check_cached') AS cached,
              sum(kind = 'check_refused') AS refused,
              sum(kind = 'check_done') AS done,
              sum(kind = 'check_failed') AS failed,
              sum(kind = 'check_stopped') AS stopped
         FROM events WHERE day >= ? GROUP BY day ORDER BY day DESC`,
    )
    .bind(since)
    .all<DayRow>();
  const days = byDay.results ?? [];

  // Visitors across the window cannot be summed from days (the salt changes daily), so the total
  // is "visitor-days": the sum of each day's distinct visitors. The page says so.
  const totals: DayRow = { day: 'total', visitors: 0, views: 0, started: 0, cached: 0, refused: 0, done: 0, failed: 0, stopped: 0 };
  for (const d of days) {
    for (const k of ['visitors', 'views', 'started', 'cached', 'refused', 'done', 'failed', 'stopped'] as const) {
      totals[k] += Number(d[k] ?? 0);
    }
  }

  const count = async (column: string, kinds: EventKind[], limit: number): Promise<CountRow[]> => {
    const marks = kinds.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT ${column} AS key, count(*) AS n FROM events
          WHERE day >= ? AND kind IN (${marks}) AND ${column} IS NOT NULL
          GROUP BY ${column} ORDER BY n DESC, key LIMIT ?`,
      )
      .bind(since, ...kinds, limit)
      .all<CountRow>();
    return results ?? [];
  };

  const [pages, referrers, countries, domains, recent] = await Promise.all([
    count('path', ['visit'], 20),
    count('referrer', ['visit'], 20),
    count('country', ['visit'], 20),
    count('domain', ['check_started', 'check_cached'], 50),
    db
      .prepare(
        `SELECT at, kind, path, domain, job_id, country, referrer FROM events
          WHERE day >= ? ORDER BY id DESC LIMIT 60`,
      )
      .bind(since)
      .all<RecentRow>()
      .then((r) => r.results ?? []),
  ]);

  return { days, totals, pages, referrers, countries, domains, recent };
}
