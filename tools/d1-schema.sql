-- PS Locator — Cloudflare D1 Schema (Phase 4)
-- รันด้วย: wrangler d1 execute ps-locator-stats --remote --file=tools/d1-schema.sql

CREATE TABLE IF NOT EXISTS site_stats (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ai_quota_daily (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS correction_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id TEXT NOT NULL,
  station_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  current_value TEXT,
  suggested_value TEXT NOT NULL,
  source_ref TEXT,
  reporter TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_correction_reports_status_created
  ON correction_reports (status, created_at DESC);
