-- Usage stats for the private /admin/stats page. Cookieless: nothing is stored on the visitor's
-- device. A visitor is counted per day by a hash of (daily salt, IP, user agent); the salt is
-- random, kept one day, then deleted, so yesterday's hashes cannot be linked to anyone or to today's.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,          -- ISO time
  day TEXT NOT NULL,         -- YYYY-MM-DD, UTC
  kind TEXT NOT NULL,        -- visit | check_started | check_cached | check_refused | check_done | check_failed | check_stopped
  path TEXT,                 -- visits: the page path, no query string
  domain TEXT,               -- checks: the public site's hostname
  job_id TEXT,
  country TEXT,              -- two-letter code from Cloudflare
  referrer TEXT,             -- visits: the referring site's hostname only
  visitor TEXT               -- visits: the salted daily hash
);
CREATE INDEX events_day_kind ON events (day, kind);

CREATE TABLE salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);

-- rate_hits now holds a salted hash, not the raw address. Its rows only ever cover ten minutes.
DELETE FROM rate_hits;
