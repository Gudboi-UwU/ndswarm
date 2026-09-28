CREATE TABLE runs (
  id              INTEGER PRIMARY KEY,
  test_id         INTEGER REFERENCES tests (id) ON DELETE SET NULL,
  project_id      INTEGER REFERENCES projects (id) ON DELETE SET NULL,
  test_name       TEXT    NOT NULL,
  config_json     TEXT    NOT NULL, -- the test as it ran (flows, load, settings) + environment name
  keys_json       TEXT    NOT NULL, -- [engine.Key]
  status          TEXT    NOT NULL, -- running | stopping | finished | failed | aborted
  verdict         TEXT,             -- pass | fail, only when finished
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  end_reason      TEXT    NOT NULL DEFAULT '',
  created_by      TEXT    NOT NULL,
  summary_json    TEXT              -- final snapshot (totals, per key, codes)
);

CREATE INDEX runs_test_id ON runs (test_id, started_at);
CREATE INDEX runs_started_at ON runs (started_at);

-- One row per second: key_id -1 is the whole run.
CREATE TABLE metrics_1s (
  run_id    INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  key_id    INTEGER NOT NULL,
  t         INTEGER NOT NULL, -- seconds since start
  count     INTEGER NOT NULL,
  ok        INTEGER NOT NULL,
  err       INTEGER NOT NULL,
  avg_ms    REAL    NOT NULL,
  min_ms    REAL    NOT NULL,
  max_ms    REAL    NOT NULL,
  p50       REAL    NOT NULL,
  p90       REAL    NOT NULL,
  p95       REAL    NOT NULL,
  p99       REAL    NOT NULL,
  bytes_in  INTEGER NOT NULL,
  bytes_out INTEGER NOT NULL,
  dns       REAL    NOT NULL, -- average phase durations, ms
  connect   REAL    NOT NULL,
  tls       REAL    NOT NULL,
  ttfb      REAL    NOT NULL,
  download  REAL    NOT NULL,
  vus       INTEGER NOT NULL,
  PRIMARY KEY (run_id, key_id, t)
) WITHOUT ROWID;

CREATE TABLE metrics_hdr (
  run_id  INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  key_id  INTEGER NOT NULL, -- -1 = whole run
  bucket  TEXT    NOT NULL, -- total
  hdr     BLOB    NOT NULL,
  PRIMARY KEY (run_id, key_id, bucket)
) WITHOUT ROWID;

CREATE TABLE status_counts (
  run_id  INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  key_id  INTEGER NOT NULL,
  code    TEXT    NOT NULL, -- HTTP status or error category
  count   INTEGER NOT NULL,
  PRIMARY KEY (run_id, key_id, code)
) WITHOUT ROWID;

CREATE TABLE run_events (
  run_id    INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  t_ms      INTEGER NOT NULL,
  type      TEXT    NOT NULL, -- start | stop | finish | warning
  data_json TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX run_events_run_id ON run_events (run_id, t_ms);
