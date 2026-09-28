CREATE TABLE request_logs (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  t_ms          INTEGER NOT NULL, -- wall clock, epoch ms
  sec           INTEGER NOT NULL, -- second of the run, 1-based like metrics_1s.t
  vu            INTEGER NOT NULL,
  iter          INTEGER NOT NULL,
  key_id        INTEGER NOT NULL,
  status        INTEGER NOT NULL, -- 0 = no response
  category      TEXT    NOT NULL, -- '' when OK
  latency_ms    REAL    NOT NULL,
  reason        TEXT    NOT NULL, -- error | sample | slowest
  error         TEXT    NOT NULL DEFAULT '',
  timing_json   TEXT    NOT NULL,
  detail        BLOB    NOT NULL  -- gzip JSON {request, response}
);

CREATE INDEX request_logs_run ON request_logs (run_id, id);
CREATE INDEX request_logs_run_sec ON request_logs (run_id, sec);
CREATE INDEX request_logs_t ON request_logs (t_ms);

CREATE TABLE error_groups (
  run_id         INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  key_id         INTEGER NOT NULL,
  category       TEXT    NOT NULL,
  message        TEXT    NOT NULL, -- numbers normalized, so similar errors group together
  count          INTEGER NOT NULL,
  example_log_id INTEGER,
  first_sec      INTEGER NOT NULL,
  last_sec       INTEGER NOT NULL,
  PRIMARY KEY (run_id, key_id, category, message)
) WITHOUT ROWID;
