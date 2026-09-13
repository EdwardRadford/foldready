-- Jobs for the Workers front end. See documents/ENGINE-API.md.
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  state TEXT NOT NULL,            -- queued | running | done | error
  progress TEXT NOT NULL DEFAULT '',
  engine_job_id TEXT,
  engine_version INTEGER,
  outcome TEXT,
  score INTEGER,
  created_at TEXT NOT NULL,
  checked_at TEXT,
  result_json TEXT,
  error TEXT
);
CREATE INDEX jobs_url_checked ON jobs (url, checked_at);
CREATE TABLE rate_hits (ip TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX rate_hits_ip ON rate_hits (ip, at);
